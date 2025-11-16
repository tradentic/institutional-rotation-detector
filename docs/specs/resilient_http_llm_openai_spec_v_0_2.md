# HTTP LLM OpenAI — Specification v0.2.0

> **Status:** Draft, aligned with:
> - `@airnub/resilient-http-core` v0.7.0
> - `@airnub/agent-conversation-core` v0.2.0
>
> **Scope:** A resilient, HTTP-only client for the OpenAI **Responses API** (and related LLM endpoints) plus an optional **ProviderAdapter** implementation for `agent-conversation-core`.
>
> **Non-goals:**
> - No direct gRPC support (HTTP/HTTPS only).
> - No generic "any provider" abstraction (this package is OpenAI-specific; multi-provider lives elsewhere).
> - No opinionated orchestration or tools beyond what’s required to integrate with `agent-conversation-core`.

This spec defines `@airnub/http-llm-openai` v0.2.0. It must be sufficient for a developer or coding agent to implement the package using only this document plus the core and conversation specs.

---

## 1. Design Goals & Principles

1. **Resilient HTTP wrapper, not a full SDK**  
   - Use `HttpClient` from `resilient-http-core` v0.7 as the only transport.
   - Provide a small, typed surface for OpenAI LLM calls (primarily `responses.create`).

2. **First-class conversation support**  
   - Support OpenAI’s `previous_response_id` chaining to maintain conversation state on OpenAI’s side.
   - Provide an optional `ProviderAdapter` implementation to plug directly into `agent-conversation-core`.

3. **Metadata-friendly**  
   - Always annotate HTTP calls with `extensions` such as `ai.provider`, `ai.model`, `ai.operation`, `ai.tenant` to cooperate with policies & telemetry.

4. **Zero external dependencies by default**  
   - Reference implementation MUST be usable with only `resilient-http-core` and standard library.
   - No hard dependency on Redis, DBs, or other satellites.

5. **Config-driven and testable**  
   - Accept an injected `HttpClient` and/or create one via `createDefaultHttpClient` with opinionated defaults.

---

## 2. Dependencies & Environment

### 2.1 Type Dependencies

```ts
import type {
  HttpClient,
  HttpMethod,
  HttpRequestOptions,
  HttpResponse,
  AgentContext,
  Extensions,
} from "@airnub/resilient-http-core";

import type {
  ProviderAdapter,
  ProviderMessage,
  ProviderToolDefinition,
  ProviderToolCall,
  ProviderCallParams,
  ProviderCallResult,
  ProviderStream,
  ProviderStreamEvent,
  TokenUsage,
} from "@airnub/agent-conversation-core";
```

### 2.2 Runtime Assumptions

- TypeScript/JavaScript targeting ES2019+.
- Access to `URL` for URL construction (or equivalent polyfill).

---

## 3. Configuration & Client Setup

### 3.1 OpenAIHttpClientConfig

```ts
export interface OpenAIHttpClientConfig {
  /** Required API key (secret). */
  apiKey: string;

  /** Optional organization and project identifiers. */
  organizationId?: string; // maps to OpenAI-Organization header
  projectId?: string;      // maps to OpenAI-Project header

  /**
   * Base URL for the OpenAI API. Default:
   *   "https://api.openai.com/v1"
   * May be overridden for proxies/Azure/etc.
   */
  baseUrl?: string;

  /** Logical client name for telemetry/policies. Default: "openai". */
  clientName?: string;

  /** Optional preconfigured HttpClient. If omitted, a default is created. */
  httpClient?: HttpClient;

  /**
   * Optional global extensions applied to every request. These are merged
   * with per-call extensions (per-call wins on conflict).
   */
  extensions?: Extensions;

  /**
   * Optional factory to derive AgentContext for requests (e.g. from tenant
   * or actor information). May be overridden per call.
   */
  agentContextFactory?: () => AgentContext | undefined;
}
```

### 3.2 createOpenAIHttpClient

The main factory returns a composite client with an underlying `HttpClient` and an LLM-focused responses API.

```ts
export interface OpenAIHttpClient {
  /** Underlying resilient HttpClient used for all calls. */
  readonly http: HttpClient;

  /**
   * LLM responses client (primary entry point).
   */
  readonly responses: OpenAIResponsesClient;
}

export function createOpenAIHttpClient(
  config: OpenAIHttpClientConfig
): OpenAIHttpClient;
```

**Behavioural requirements:**

- If `config.httpClient` is provided, use it.
- Else, create a new `HttpClient` via the core’s `createDefaultHttpClient` (name `config.clientName ?? "openai"`) with safe defaults.
- Do **not** automatically attach policies/guardrails; those are configured by the host app using interceptors.

---

## 4. OpenAI Responses Domain Model

### 4.1 Roles & Input Messages

```ts
export type OpenAIRole =
  | "system"
  | "user"
  | "assistant"
  | "developer"
  | "tool"; // tool results/messages

export interface OpenAITextBlock {
  type: "text";
  text: string;
}

export type OpenAIInputContent =
  | string
  | OpenAITextBlock
  | (OpenAITextBlock | Record<string, unknown>)[];

export interface OpenAIInputMessage {
  role: OpenAIRole;
  content: OpenAIInputContent;
}
```

### 4.2 Tools (Function Calling)

```ts
export interface OpenAIFunctionTool {
  type: "function"; // fixed literal
  name: string;
  description?: string;
  /** JSON-schema-like parameters object, passed through as-is. */
  parameters: unknown;
}

export type OpenAIToolDefinition = OpenAIFunctionTool | Record<string, unknown>;
```

### 4.3 Token Usage

To align with `agent-conversation-core`, reuse `TokenUsage`.

```ts
export type OpenAITokenUsage = TokenUsage; // { inputTokens, outputTokens, totalTokens? }
```

### 4.4 Normalized Response Objects

`OpenAIResponseObject` is a normalized view of a Responses API response.

```ts
export interface OpenAIResponseObject {
  /** Underlying unique response ID returned by OpenAI. */
  id: string;

  /** Model name returned by the API. */
  model: string;

  /** Creation time mapped to Date. */
  createdAt: Date;

  /**
   * Primary assistant message content as a simple text string, if present.
   * This is typically derived from the first text output.
   */
  outputText?: string;

  /** Assistant message in provider-agnostic form for agent-conversation-core. */
  providerMessage?: ProviderMessage;

  /** Any tool calls the model requested. */
  toolCalls?: ProviderToolCall[];

  /** Token usage summary if provided by OpenAI. */
  usage?: OpenAITokenUsage;

  /** Raw decoded JSON response from the OpenAI API. */
  raw: unknown;
}
```

Implementations should:

- Populate `outputText` with the concatenated text of the main assistant output.
- Populate `providerMessage` from the same content (see mapping rules below).
- Extract tool calls (if any) into `toolCalls`.

### 4.5 Conversation Chaining State

```ts
export interface OpenAIConversationState {
  /**
   * ID of the most recent response in this conversation chain (if using
   * previous_response_id for server-side state).
   */
  lastResponseId?: string;

  /**
   * Optional metadata for host apps (e.g. tags, conversation title). Not
   * sent to OpenAI.
   */
  metadata?: Record<string, unknown>;
}
```

---

## 5. Responses API — Requests & Client Interface

### 5.1 CreateResponseRequest

`CreateResponseRequest` is a normalized subset of the OpenAI Responses API request payload.

```ts
export interface CreateResponseRequest {
  /** Model identifier, e.g. "gpt-4.1-mini", "gpt-5.1". */
  model: string;

  /** Input content: simple string or chat-style messages. */
  input: string | OpenAIInputMessage | OpenAIInputMessage[];

  /**
   * Optional modalities requested (e.g. text, audio, json). For this
   * package, at least "text" SHOULD be supported.
   */
  modalities?: ("text" | string)[];

  /** Optional tools for function calling or other provider tools. */
  tools?: OpenAIToolDefinition[];

  /** Provider tool choice hint; passed through as-is. */
  toolChoice?: unknown;

  /** Optional max tokens or equivalent budget. */
  maxOutputTokens?: number | Record<string, unknown>;

  /** Store response server-side? Default: provider default (usually true). */
  store?: boolean;

  /** Additional provider metadata (e.g. response_format, reasoning_effort). */
  extraParams?: Record<string, unknown>;

  /**
   * Optional chaining to previous Responses API call.
   * If provided, the underlying HTTP payload MUST set `previous_response_id`.
   */
  previousResponseId?: string;

  /** Optional OpenAI-side metadata; forwarded as-is to the API. */
  metadata?: Record<string, unknown>;
}
```

### 5.2 Per-call Options

```ts
export interface CreateResponseOptions {
  /** Optional AgentContext for telemetry and policies. */
  agentContext?: AgentContext;

  /** Additional extensions to merge with client-level extensions. */
  extensions?: Extensions;

  /**
   * Optional conversation state. If provided and state.lastResponseId is
   * set, it MAY be used as previousResponseId if the request does not
   * already specify one.
   */
  conversationState?: OpenAIConversationState;
}
```

### 5.3 OpenAIResponsesClient Interface

```ts
export interface OpenAIResponsesClient {
  /**
   * Perform a non-streaming Responses API call.
   */
  create(
    request: CreateResponseRequest,
    options?: CreateResponseOptions
  ): Promise<OpenAIResponseObject>;

  /**
   * Optional streaming variant. If not implemented, callers must fall back
   * to non-streaming create.
   */
  createStream?(
    request: CreateResponseRequest,
    options?: CreateResponseOptions
  ): Promise<OpenAIResponseStream>;
}
```

### 5.4 Streaming Types

```ts
export type OpenAIResponseStreamEvent =
  | { type: "text-delta"; textDelta: string }
  | { type: "tool-call"; toolCall: ProviderToolCall }
  | { type: "done"; result: OpenAIResponseObject };

export interface OpenAIResponseStream
  extends AsyncIterable<OpenAIResponseStreamEvent> {
  /** Resolves once a final "done" event has been emitted. */
  final: Promise<OpenAIResponseObject>;
}
```

Streaming specifics (SSE vs other mechanisms) are an implementation detail, but the public shape MUST conform to the above.

---

## 6. HTTP Integration Semantics

### 6.1 Request Construction

For `responses.create` calls, the client MUST construct `HttpRequestOptions` as follows:

- `method`: `"POST" as HttpMethod`.
- `operation`: `"openai.responses.create"`.
- `urlParts.baseUrl`: from `OpenAIHttpClientConfig.baseUrl` or default.
- `urlParts.path`: `/responses`.
- `headers`:
  - `Authorization: Bearer ${apiKey}`.
  - `Content-Type: application/json`.
  - `OpenAI-Organization: organizationId` (if provided).
  - `OpenAI-Project: projectId` (if provided).
- `body`: JSON-encoded representation of `CreateResponseRequest` mapped to OpenAI’s schema, including `previous_response_id` when appropriate.

### 6.2 Extensions & AgentContext

- Merge `OpenAIHttpClientConfig.extensions` with `CreateResponseOptions.extensions`; per-call wins on conflict.
- Set `request.extensions` to include at minimum:
  - `"ai.provider" = "openai"`.
  - `"ai.model" = request.model`.
  - `"ai.operation" = "responses.create"`.
  - `"ai.tenant" = organizationId ?? projectId` (if any).
- Set `request.agentContext` to:
  - `options.agentContext` if provided.
  - Else `config.agentContextFactory?.()` if available.

These annotations allow `resilient-http-policies` and other telemetry to make scope-aware decisions.

### 6.3 Error Handling

- Non-2xx HTTP responses MAY be mapped to domain-specific errors, but the minimal requirement is to:
  - Let `HttpClient` apply its resilience logic (retries, timeouts, error classification).
  - Surface the final error to the caller (throw), optionally attaching parsed OpenAI error payload.

---

## 7. Mapping Between Provider Messages and OpenAI

### 7.1 ProviderMessage → OpenAIInputMessage

Implement a helper (non-exported or exported) with the following semantics:

- For each `ProviderMessage`:
  - Map `role` directly to `OpenAIRole` (same string values except `developer`, which MAY be derived from metadata if needed).
  - For `content` parts:
    - `ProviderTextPart` → `OpenAITextBlock { type: "text", text }`.
    - Other parts → `Record<string, unknown>` blocks passed through as-is.

This mapping is used by the `OpenAIProviderAdapter` (see below).

### 7.2 OpenAIResponseObject → ProviderMessage

For non-streaming responses:

- Extract the primary assistant output:
  - Implementation-specific logic MAY choose the first text output from the response JSON.
- Construct a `ProviderMessage` with:
  - `role: "assistant"`.
  - `content` containing at least one `ProviderTextPart` with the extracted text.
- Parse any function/tool calls into an array of `ProviderToolCall` objects.

Populate `OpenAIResponseObject.providerMessage` and `.toolCalls` with these values.

---

## 8. Provider Adapter for agent-conversation-core

### 8.1 OpenAIProviderAdapterConfig

```ts
export interface OpenAIProviderAdapterConfig {
  /** Underlying OpenAI client created via createOpenAIHttpClient. */
  client: OpenAIHttpClient;

  /** Default model if ProviderCallParams does not specify one. */
  defaultModel: string;

  /** Optional function to obtain or update conversation state per call. */
  getConversationState?: () => OpenAIConversationState | undefined;
  setConversationState?: (state: OpenAIConversationState) => void;
}
```

### 8.2 OpenAIProviderAdapter

```ts
export class OpenAIProviderAdapter implements ProviderAdapter {
  constructor(config: OpenAIProviderAdapterConfig);

  complete(params: ProviderCallParams): Promise<ProviderCallResult>;

  completeStream?(params: ProviderCallParams): Promise<ProviderStream>;
}
```

### 8.3 Behaviour — complete

1. Determine model:
   - From `params.metadata.model` if present.
   - Else from `config.defaultModel`.

2. Map `params.messages: ProviderMessage[]` to `OpenAIInputMessage[]` using the mapping rules from §7.1.

3. Build a `CreateResponseRequest`:

   ```ts
   const request: CreateResponseRequest = {
     model,
     input: mappedMessages,
     tools: mapProviderTools(params.tools), // if provided
     toolChoice: params.toolChoice,         // passed through
     extraParams: params.extraParams,       // if defined by host
   };
   ```

4. If `config.getConversationState` is provided and returns a state with `lastResponseId`, and `request.previousResponseId` is not already set, set `request.previousResponseId` accordingly.

5. Call `client.responses.create(request, { agentContext: params.agentContext, extensions: params.metadata.extensions, conversationState })`.

6. Convert `OpenAIResponseObject` into `ProviderCallResult`:

   ```ts
   const result: ProviderCallResult = {
     id: response.id,
     createdAt: response.createdAt,
     message: response.providerMessage ?? fallbackMessage,
     toolCalls: response.toolCalls,
     usage: response.usage,
     raw: response.raw,
   };
   ```

7. If `config.setConversationState` is provided, update it with a new `OpenAIConversationState` where `lastResponseId = response.id`.

8. Return `result`.

### 8.4 Behaviour — completeStream (Optional)

If implemented, `completeStream` MUST:

- Use `client.responses.createStream` with the same mapping as above.
- Adapt `OpenAIResponseStreamEvent` → `ProviderStreamEvent`:
  - `"text-delta"` → `{ type: "delta", delta: ProviderMessage }` representing the current aggregate text.
  - `"tool-call"` → `{ type: "tool-call", toolCall }`.
  - `"done"` → `{ type: "done", result: ProviderCallResult }` (constructed as in non-streaming).
- Return a `ProviderStream` whose `final` resolves to the final `ProviderCallResult`.

If not implemented, the method MAY be omitted entirely.

---

## 9. Versioning & Stability

The following types and functions are part of the **stable public surface** of `@airnub/http-llm-openai` v0.2.0 and SHOULD remain backward compatible (with only additive changes) across 0.2.x and 1.x:

- Config & client:
  - `OpenAIHttpClientConfig`
  - `OpenAIHttpClient`
  - `createOpenAIHttpClient`

- Domain types:
  - `OpenAIRole`
  - `OpenAITextBlock`
  - `OpenAIInputContent`
  - `OpenAIInputMessage`
  - `OpenAIFunctionTool`
  - `OpenAIToolDefinition`
  - `OpenAITokenUsage`
  - `OpenAIResponseObject`
  - `OpenAIConversationState`

- Responses API:
  - `CreateResponseRequest`
  - `CreateResponseOptions`
  - `OpenAIResponsesClient`
  - `OpenAIResponseStreamEvent`
  - `OpenAIResponseStream`

- Provider adapter:
  - `OpenAIProviderAdapterConfig`
  - `OpenAIProviderAdapter`

Breaking changes to these MUST be reserved for a new major version.

---

## 10. Reference Implementation Notes (Non-normative)

1. **JSON shapes and future OpenAI changes**  
   The internal mapping from raw OpenAI JSON to `OpenAIResponseObject` SHOULD be implemented in a way that tolerates additional fields and minor schema changes without breaking callers.

2. **Conversation chaining nuances**  
   When using `previous_response_id`, OpenAI may not automatically carry over all instruction context; host apps SHOULD continue to send critical system/developer messages explicitly as part of `input`.

3. **Token usage mapping**  
   OpenAI usage fields may differ slightly across models; map them into `TokenUsage` conservatively (unknown fields can be placed into `OpenAIResponseObject.raw`).

4. **Testing**  
   - Unit tests for:
     - Request construction (headers, URL, payload) for `responses.create`.
     - Mapping between `ProviderMessage` and `OpenAIInputMessage`.
     - Mapping between response JSON and `OpenAIResponseObject`/`ProviderCallResult`.
   - Integration tests using a mocked `HttpClient` to verify behaviour without real network calls.

With this specification, a developer or coding agent can implement `@airnub/http-llm-openai` v0.2.0, plug it into `resilient-http-core` for resilient HTTP, and use it as a provider within `agent-conversation-core` for OpenAI-based agent workflows.