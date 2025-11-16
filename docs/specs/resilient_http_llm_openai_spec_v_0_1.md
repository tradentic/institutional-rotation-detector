# `@airnub/http-llm-openai` — Spec v0.1

**Status:** Draft for implementation  \
**Intended file path:** `docs/specs/http_llm_openai_spec_v_0_1.md`  \
**Depends on:**
- `@tradentic/resilient-http-core` v0.6+
- (Optional) `@airnub/agent-conversation-core` v0.1+
- (Optional) `@airnub/resilient-http-policies` v0.2+
- (Optional) `@airnub/resilient-http-pagination` v0.2+

**Scope:**  
Provider-specific HTTP wrapper for the **OpenAI API**, built on top of `resilient-http-core`, with:

- First-class support for **GPT‑5 conversations** via the **Responses API** and `previous_response_id`.
- A small, focused surface:
  - Responses (GPT‑4/5, tools, JSON / assistant-style outputs).
  - Embeddings & models listing as utilities.
  - Optional thin legacy chat helper only where needed.
- Clean integration points for **agent-conversation-core** via provider-style abstractions.

Goal: be the **canonical OpenAI HTTP wrapper** for AI agents in this ecosystem, while keeping conversation semantics out of the HTTP core and inside satellite libraries.

---

## 1. Goals

1. Provide a thin but strongly-typed client for OpenAI that:
   - Uses `@tradentic/resilient-http-core` for all HTTP resilience.
   - Exposes **Responses API** helpers with `previous_response_id` for GPT‑5 conversation continuation.
   - Supports both **non-streaming** and **streaming** responses.

2. Integrate gracefully with `@airnub/agent-conversation-core`:
   - Make it easy to build an `OpenAiProviderAdapter` that maps conversations/turns to Responses API calls.
   - Propagate provider-specific metadata (e.g. `response.id`, `response.usage`, `response.metadata`) back to the agent layer via structured types.

3. Keep it **OpenAI-specific but agent-agnostic**:
   - No direct code dependency on `agent-conversation-core`.
   - No assumptions about how conversations are stored; just provide hooks and fields that make mapping easy.

4. Treat AI/LLM calls as **first-class HTTP citizens**:
   - Fill `AgentContext`, `correlationId`, `parentCorrelationId`, `extensions['ai.*']` appropriately.
   - Use `ResilienceProfile`, `ErrorClassifier`, `RequestOutcome`, `RateLimitFeedback` from core v0.6.

---

## 2. Non-goals

- Do **not** re-implement the official OpenAI Node SDK.
- Do **not** provide every OpenAI endpoint; v0.1 focuses on:
  - Responses API (GPT‑4/5, tools, JSON results).
  - Embeddings.
  - Models listing.
  - (Optionally) a minimal legacy chat wrapper if needed.
- Do **not** own conversation state; that’s `@airnub/agent-conversation-core`’s job.
- Do **not** implement global policies or budgets; that’s `@airnub/resilient-http-policies`.

---

## 3. High-Level Architecture

### 3.1 Package structure

```text
libs/http-llm-openai/
  package.json        // name: @airnub/http-llm-openai
  tsconfig.json
  src/
    index.ts
    config.ts
    types.ts
    httpClient.ts
    responsesClient.ts
    embeddingsClient.ts
    modelsClient.ts
    errorClassifier.ts
    streaming.ts
    __tests__/
      responsesClient.test.ts
      embeddingsClient.test.ts
      modelsClient.test.ts
```

### 3.2 Core building block: underlying HttpClient

All HTTP calls go through `HttpClient` from `@tradentic/resilient-http-core`:

```ts
import {
  HttpClient,
  HttpClientConfig,
  HttpRequestOptions,
  ResilienceProfile,
  AgentContext,
} from '@tradentic/resilient-http-core';
```

`@airnub/http-llm-openai` is:

- A thin configuration of `HttpClient` (base URL, auth header, default resilience profile).
- A set of OpenAI-specific helper methods that:
  - Construct `HttpRequestOptions`.
  - Parse responses into OpenAI-specific types.

---

## 4. Configuration & Core Types

### 4.1 `OpenAiClientConfig`

```ts
export interface OpenAiClientConfig {
  /** Required API key, used for Authorization header. */
  apiKey: string;

  /** Optional organization header for OpenAI (OpenAI-Organization). */
  organizationId?: string;

  /** Optional project header for OpenAI (OpenAI-Project). */
  projectId?: string;

  /** Base URL for OpenAI API, defaults to 'https://api.openai.com/v1'. */
  baseUrl?: string;

  /** Optional client name for telemetry, defaults to 'openai'. */
  clientName?: string;

  /** Optional default model for responses/embeddings helpers. */
  defaultModel?: string;

  /** Optional default resilience profile for all OpenAI calls. */
  defaultResilience?: ResilienceProfile;

  /** Optional HttpClient configuration overrides. */
  http?: Partial<HttpClientConfig>;
}
```

### 4.2 `OpenAiHttpClient`

```ts
export class OpenAiHttpClient {
  readonly http: HttpClient;
  readonly config: OpenAiClientConfig;

  constructor(config: OpenAiClientConfig) { /* ... */ }

  /** Low-level request helper used internally by higher-level clients. */
  protected request<T = unknown>(opts: Omit<HttpRequestOptions, 'headers'> & {
    operation: string;
  }): Promise<T>;
}
```

Responsibilities:

- Inject OpenAI auth and base headers:
  - `Authorization: Bearer <apiKey>`
  - `Content-Type: application/json` for JSON bodies.
  - `OpenAI-Organization` / `OpenAI-Project` when configured.
- Normalize `baseUrl` like `https://api.openai.com/v1`.
- Apply default resilience profile when not overridden.
- Set helpful extensions:
  - `extensions['ai.provider'] = 'openai'`.
  - `extensions['ai.request_type']` (e.g. `'response'`, `'embedding'`).
  - `extensions['ai.model']` when known.
- Pass through `agentContext`, `correlationId`, `parentCorrelationId`, `resilience`, and other `HttpRequestOptions` fields unchanged.


### 4.3 `OpenAiRequestOptions`

Wrapper for passing agent- and core-related options into helpers:

```ts
export interface OpenAiRequestOptions {
  correlationId?: string;
  parentCorrelationId?: string;
  agentContext?: AgentContext;
  resilience?: ResilienceProfile;
  extensions?: Record<string, unknown>;

  /** Optional per-call timeout override (ms). */
  timeoutMs?: number;
}
```

---

## 5. Responses API (GPT‑5 priority)

### 5.1 Types (trimmed / future-proof)

Focus on fields we need for GPT‑5 conversational use, but keep extensible.

```ts
export interface OpenAiResponseUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  [key: string]: unknown;
}

export interface OpenAiResponseMessageContentText {
  type: 'text';
  text: {
    value: string;
    annotations?: unknown[];
  };
}

export interface OpenAiResponseMessage {
  role: 'assistant';
  content: OpenAiResponseMessageContentText[];
  [key: string]: unknown;
}

export interface OpenAiResponseOutputItem {
  type: 'message' | 'tool_call' | 'other';
  message?: OpenAiResponseMessage;
  [key: string]: unknown;
}

export interface OpenAiResponse {
  id: string;
  object: 'response';
  model: string;
  created_at: number;

  output?: OpenAiResponseOutputItem[];
  usage?: OpenAiResponseUsage;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}
```

Request shape (high-level, matching Responses API semantics while staying flexible):

```ts
export type OpenAiResponseRole = 'user' | 'system' | 'assistant';

export interface OpenAiResponseInputMessage {
  role: OpenAiResponseRole;
  /** Text or structured content; we allow both. */
  content: string | Array<{ type: 'text'; text: string }>;
}

export interface CreateResponseRequest {
  model: string;

  /** Messages passed to Responses API. */
  input: OpenAiResponseInputMessage[];

  /** Tools / function definitions / JSON modes etc. */
  tools?: unknown[];

  /** Arbitrary metadata stored with the response. */
  metadata?: Record<string, unknown>;

  /** Generation parameters. */
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;

  /**
   * For GPT‑5-style conversations: continue from a prior response.
   * See §5.3.
   */
  previous_response_id?: string;

  /** Streaming flag, used for streaming helper. */
  stream?: boolean;

  /** Future fields: response_format, tool_choice, etc. */
  [key: string]: unknown;
}
```

### 5.2 Responses client

```ts
export class OpenAiResponsesClient {
  constructor(private readonly client: OpenAiHttpClient) {}

  /**
   * Non-streaming create response.
   * Supports GPT‑5 conversations via `previous_response_id`.
   */
  async createResponse(
    request: CreateResponseRequest,
    options?: OpenAiRequestOptions,
  ): Promise<OpenAiResponse>;

  /**
   * Streaming Responses API.
   * Implementation can use fetch streaming, SSE, or provider conventions
   * but must normalize into `OpenAiResponseStreamChunk`.
   */
  async streamResponse(
    request: CreateResponseRequest,
    options: OpenAiStreamOptions,
  ): Promise<OpenAiStreamHandle>;
}
```

### 5.3 GPT‑5 conversations and `previous_response_id`

- The library **does not** own conversation state.
- It exposes `previous_response_id` support via:
  - `CreateResponseRequest.previous_response_id`.
  - `OpenAiResponse.id` on returned responses.
- Higher-level libraries (e.g. `@airnub/agent-conversation-core`) or the app:
  - Store `OpenAiResponse.id` in conversation state.
  - Pass it as `previous_response_id` when continuing the conversation.

Helper to make continuation ergonomics explicit:

```ts
export interface ContinueResponseOptions {
  userInput: string;
  previousResponse: OpenAiResponse;
}

export function buildContinuationRequest(
  options: ContinueResponseOptions,
): CreateResponseRequest {
  const { previousResponse, userInput } = options;
  return {
    model: previousResponse.model,
    input: [
      { role: 'user', content: userInput },
    ],
    previous_response_id: previousResponse.id,
  };
}
```

### 5.4 Streaming types

```ts
export interface OpenAiResponseStreamChunk {
  /** Response id if known from the stream. */
  responseId?: string;

  /** Model used. */
  model?: string;

  /** Text delta output (simplified). */
  delta?: string;

  /** Optional partial usage as it becomes available. */
  usageDelta?: {
    input_tokens?: number;
    output_tokens?: number;
  };

  /** Raw provider event/chunk for advanced consumers. */
  rawEvent?: unknown;
}

export interface OpenAiStreamOptions extends OpenAiRequestOptions {
  onChunk: (chunk: OpenAiResponseStreamChunk) => void | Promise<void>;
  onError?: (err: unknown) => void | Promise<void>;
  onComplete?: () => void | Promise<void>;
}

export interface OpenAiStreamHandle {
  /** Abort the underlying stream. */
  abort: () => void;
}
```

---

## 6. Embeddings & Models Helpers

### 6.1 Embeddings

```ts
export interface CreateEmbeddingRequest {
  model: string;
  input: string | string[];
  encoding_format?: 'float' | 'base64';
  metadata?: Record<string, unknown>;
}

export interface CreateEmbeddingResponseItem {
  embedding: number[] | string; // depending on encoding_format
  index: number;
}

export interface CreateEmbeddingResponse {
  data: CreateEmbeddingResponseItem[];
  model: string;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
  [key: string]: unknown;
}

export class OpenAiEmbeddingsClient {
  constructor(private readonly client: OpenAiHttpClient) {}

  createEmbedding(
    request: CreateEmbeddingRequest,
    options?: OpenAiRequestOptions,
  ): Promise<CreateEmbeddingResponse>;
}
```

### 6.2 Models

```ts
export interface OpenAiModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  [key: string]: unknown;
}

export interface ListModelsResponse {
  data: OpenAiModel[];
  object: 'list';
  [key: string]: unknown;
}

export class OpenAiModelsClient {
  constructor(private readonly client: OpenAiHttpClient) {}

  listModels(
    options?: OpenAiRequestOptions & { cacheTtlMs?: number },
  ): Promise<ListModelsResponse>;
}
```

Implementation notes:

- `listModels` is safe to cache by default (e.g. 5–15 minutes) using `cacheKey` + `cacheTtlMs`.
- Mark `idempotent: true` and let resilient-http-core handle retry semantics.

---

## 7. Error Classification & Resilience Integration

### 7.1 OpenAI ErrorClassifier

Provide an OpenAI-aware error classifier and use it as default for the underlying `HttpClient` when none is provided.

```ts
import {
  ErrorClassifier,
  ErrorClassification,
  ErrorCategory,
} from '@tradentic/resilient-http-core';

export function createOpenAiErrorClassifier(): ErrorClassifier {
  return (err, context): ErrorClassification | undefined => {
    // Implementation guidelines below
  };
}
```

Guidelines:

- Consider HTTP status and body shape (when available):
  - 429 → `category: 'rate_limit'`, `retryable: true`, `suggestedDelayMs` from `Retry-After` header or JSON body.
  - 500–504 → `category: 'transient'`, `retryable: true`.
  - 401/403 → `category: 'auth'`, `retryable: false`.
  - 400 with validation errors → `category: 'validation'`, `retryable: false`.
  - Safety/blocked content → `category: 'safety'`, `retryable: false`.
- Attach `context.operation` (e.g. `responses.create`) for observability.

### 7.2 Default ResilienceProfile

- `OpenAiHttpClient` may set a default profile (documented in code comments) such as:
  - `maxAttempts`: 3 or 4.
  - `latencyBudgetMs`: 30_000 or 60_000.
  - `jitter`: enabled.
- Callers can override per-request via `OpenAiRequestOptions.resilience` when needed (interactive vs background workloads).

---

## 8. Integration with `@airnub/agent-conversation-core`

This package remains **agent-agnostic** but should be easy to use from a provider adapter.

### 8.1 Mapping to ProviderAdapter (informative)

In `@airnub/agent-conversation-core`, you’ll have:

```ts
export interface ProviderChatRequest {
  model: string;
  messages: ChatInputMessage[]; // normalized logical messages
  parameters?: Record<string, unknown>;
}

export interface ProviderChatResult {
  messages: ConversationMessage[];
  usage?: TokenUsage;
  raw?: unknown;
}
```

An `OpenAiProviderAdapter` (implemented in the agent library) would:

1. Construct `CreateResponseRequest` from `ProviderChatRequest`:
   - Map `ChatInputMessage[]` to `OpenAiResponseInputMessage[]`.
   - Set `model` from request or defaults.
   - Pass `previous_response_id` from prior `OpenAiResponse.id` where appropriate.
2. Call `OpenAiResponsesClient.createResponse()`.
3. Convert the returned `OpenAiResponse` to:
   - `ConversationMessage[]` using the `output` message content.
   - `TokenUsage` from `response.usage`.
   - `raw` from the full `OpenAiResponse`.

This package can optionally provide **helper types** but must not depend on `agent-conversation-core` code.

### 8.2 AgentContext & extensions conventions

When a higher layer (e.g. agent-conversation-core) calls this client, it should:

- Set `agentContext` with:

  ```ts
  agentContext: {
    agent: 'my-agent',
    runId: 'conv-123:turn-7',
    labels: {
      conversationId: 'conv-123',
      turnId: 'turn-7',
    },
    metadata: { /* agent-specific */ },
  }
  ```

- Set extensions for telemetry/policies:

  ```ts
  extensions: {
    'ai.provider': 'openai',
    'ai.model': request.model,
    'ai.request_type': 'response',
    'ai.streaming': request.stream === true,
    // optional, for correlation with agent-conversation-core:
    'ai.app_conversation_id': conversationId,
    'ai.turn_id': turnId,
  }
  ```

- Use `correlationId` and `parentCorrelationId` values that align with their tracing model.

This package must **pass these fields through unchanged** when calling `HttpClient` so that:

- `@tradentic/resilient-http-core` can record them.
- `@airnub/resilient-http-policies` can use them for per-provider/model budgets.
- Telemetry adapters (OTEL, logging) can derive spans and logs from them.

---

## 9. Testing & Validation

Initial implementation should cover:

1. **Header & config tests**
   - Authorization header is set correctly.
   - Organization/project headers are added when configured.
   - Base URL normalization.

2. **Responses API tests**
   - `createResponse()` POSTs to correct path with expected shape.
   - `previous_response_id` is sent when provided.
   - Returned JSON is parsed into `OpenAiResponse` shape.

3. **Embeddings & Models tests**
   - `createEmbedding()` and `listModels()` call correct endpoints.
   - `listModels()` respects optional `cacheTtlMs`.

4. **Error classification tests**
   - 429 is mapped to `rate_limit` and `retryable: true`.
   - 500 is mapped to `transient` and `retryable: true`.
   - 400/401/403 mapped appropriately.

5. **Streaming tests (basic)**
   - Mock streaming transport and verify `onChunk`, `onError`, `onComplete` are invoked correctly.

6. **Type-level checks**
   - Ensure public APIs are fully typed and easy to consume from TypeScript.

---

## 10. Implementation Notes (for coding agents)

1. **Start with `OpenAiHttpClient`:**
   - Accept `OpenAiClientConfig`.
   - Compose `HttpClientConfig` with defaults and `createOpenAiErrorClassifier()`.
   - Implement `request<T>()` to:
     - Merge headers with auth and content-type.
     - Fill `operation`, `extensions`, and let callers pass `agentContext` and `resilience`.

2. **Implement Responses client:**
   - POST `/responses` (or `/v1/responses` depending on `baseUrl`).
   - Non-streaming first; streaming can be added with a simple fetch-based stream wrapper.

3. **Implement Embeddings and Models clients:**
   - `POST /embeddings` and `GET /models` with minimal parsing.

4. **Keep future-proof:**
   - Use `Record<string, unknown>` for flexible metadata.
   - Do not hardcode model names.

5. **Do not couple to `agent-conversation-core`:**
   - Provide types and doc comments that make usage obvious.
   - Let provider adapters live in `agent-conversation-core` repo or a future satellite lib.

This v0.1 spec should give both human devs and coding agents enough structure to implement `@airnub/http-llm-openai` so that it plays nicely with `resilient-http-core` v0.6 and can be dropped into your agent ecosystem as