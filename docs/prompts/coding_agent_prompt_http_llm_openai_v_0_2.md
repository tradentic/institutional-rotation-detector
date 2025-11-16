# CODING_AGENT_PROMPT.md — `@airnub/http-llm-openai` v0.2

## 0. Role & Context

You are a **senior TypeScript engineer**. Your task is to implement or align `@airnub/http-llm-openai` with the v0.2 spec.

This package is a **thin HTTP wrapper** around the OpenAI Responses API using `@airnub/resilient-http-core` v0.7, plus an optional `ProviderAdapter` implementation for `@airnub/agent-conversation-core`.

---

## 1. Source of Truth

Use this spec as authoritative:

- `docs/specs/resilient_http_llm_openai_spec_v_0_2.md`

If existing code disagrees with the spec, the spec wins.

---

## 2. Global Constraints

- TypeScript with `strict: true`.
- No dependency on OpenAI’s official SDK — use `HttpClient` from `@airnub/resilient-http-core`.
- No gRPC.

---

## 3. Tasks

### 3.1 Config & Client

Implement:

- `OpenAIHttpClientConfig` with:
  - `apiKey` (required).
  - `organizationId?`, `projectId?`.
  - `baseUrl?` (default `https://api.openai.com/v1`).
  - `clientName?` (default `"openai"`).
  - `httpClient?` (injected `HttpClient`).
  - `extensions?` (global extensions).
  - `agentContextFactory?`.

- `OpenAIHttpClient` with:
  - `http: HttpClient`.
  - `responses: OpenAIResponsesClient`.

- `createOpenAIHttpClient(config)`:
  - Use injected `httpClient` if provided.
  - Else call `createDefaultHttpClient` from core with `clientName`.

### 3.2 Domain Types

Implement:

- Roles & messages:
  - `OpenAIRole`
  - `OpenAITextBlock`
  - `OpenAIInputContent`
  - `OpenAIInputMessage`

- Tools:
  - `OpenAIFunctionTool`
  - `OpenAIToolDefinition`

- Usage & responses:
  - `OpenAITokenUsage` (alias of `TokenUsage`).
  - `OpenAIResponseObject` (id, model, createdAt, outputText, providerMessage, toolCalls, usage, raw).
  - `OpenAIConversationState` (lastResponseId, metadata?).

### 3.3 Responses Client

Implement:

- `CreateResponseRequest` as per spec, including:
  - `model`
  - `input` (string or `OpenAIInputMessage | OpenAIInputMessage[]`).
  - `modalities?`, `tools?`, `toolChoice?`, `maxOutputTokens?`, `store?`, `extraParams?`, `previousResponseId?`, `metadata?`.

- `CreateResponseOptions` with `agentContext?`, `extensions?`, `conversationState?`.

- `OpenAIResponsesClient` with:
  - `create(request, options?)` → `Promise<OpenAIResponseObject>`.
  - Optional `createStream(request, options?)` → `Promise<OpenAIResponseStream>`.

- `OpenAIResponseStreamEvent` and `OpenAIResponseStream` as spec’d.

### 3.4 HTTP Integration

For `responses.create`:

- Build `HttpRequestOptions` with:
  - `method: 'POST'`.
  - URL: `{baseUrl}/responses`.
  - Headers:
    - `Authorization: Bearer ${apiKey}`.
    - `Content-Type: application/json`.
    - `OpenAI-Organization` and `OpenAI-Project` when provided.
  - Body: JSON encoding of OpenAI’s concrete request payload, including `previous_response_id` when present.

- Extensions:
  - Merge client-level and per-call `extensions`.
  - Always set:
    - `extensions['ai.provider'] = 'openai'`.
    - `extensions['ai.model'] = request.model`.
    - `extensions['ai.operation'] = 'responses.create'`.
    - Optionally `extensions['ai.tenant'] = organizationId ?? projectId`.

- AgentContext:
  - Use `options.agentContext` if provided, else `config.agentContextFactory?.()`.

### 3.5 Mapping & Conversation Chaining

Implement helpers for:

- `ProviderMessage[]` → `OpenAIInputMessage[]` mapping (roles + text parts).
- Raw Responses → `OpenAIResponseObject`:
  - Extract `outputText` from the primary assistant text output.
  - Build `ProviderMessage` for `providerMessage`.
  - Parse any tool calls into `ProviderToolCall[]`.
  - Populate `usage` if present.

- Conversation chaining:
  - If `CreateResponseRequest.previousResponseId` is not set and `options.conversationState?.lastResponseId` is defined, use that as `previous_response_id` in the payload.

### 3.6 Provider Adapter

Implement:

- `OpenAIProviderAdapterConfig` (client, defaultModel, getConversationState?, setConversationState?).
- `OpenAIProviderAdapter implements ProviderAdapter` from `@airnub/agent-conversation-core`:

`complete(params: ProviderCallParams)` must:

1. Determine model from `params.metadata.model` or `defaultModel`.
2. Map `params.messages` → `OpenAIInputMessage[]`.
3. Build `CreateResponseRequest` from messages, tools, toolChoice, extraParams.
4. Use `getConversationState`/`setConversationState` for `previousResponseId` chaining.
5. Call `client.responses.create(...)`.
6. Map `OpenAIResponseObject` → `ProviderCallResult`.

If `completeStream` is implemented, adapt `OpenAIResponseStreamEvent` → `ProviderStreamEvent`.

---

## 4. Tests

Use a **fake `HttpClient`** (no real OpenAI calls):

- Verify request construction (URL, headers, body) given `CreateResponseRequest`.
- Verify extensions and `AgentContext` are attached correctly.
- Verify mapping from fake response JSON → `OpenAIResponseObject` and `ProviderCallResult`.
- Verify `OpenAIProviderAdapter.complete` wires everything together correctly, including conversation chaining.

---

## 5. Acceptance Criteria

- Public API matches `resilient_http_llm_openai_spec_v_0_2.md`.
- No OpenAI SDK or gRPC dependencies.
- `OpenAIProviderAdapter` can be plugged into `@airnub/agent-conversation-core` in tests using a fake `HttpClient` and can successfully run a full turn end-to-end.

