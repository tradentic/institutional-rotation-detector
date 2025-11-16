# CODING_AGENT_PROMPT.md — `@airnub/http-llm-openai` v0.2

## 0. Role & Scope

You are a **senior TypeScript engineer** working in the `tradentic/institutional-rotation-detector` monorepo.

Your job in this prompt is **only** to implement and align the package:

> `@airnub/http-llm-openai`

with its v0.2 spec, built on top of **`@airnub/resilient-http-core` v0.7** and designed to plug into `@airnub/agent-conversation-core`.

Do not modify other packages except where necessary for wiring (e.g., adding an adapter implementation). Other packages have their own prompts.

---

## 1. Source of Truth

Treat these documents as the **source of truth** for this package:

- Core v0.7 spec:
  - `docs/specs/resilient_http_core_spec_v_0_7.md`
- OpenAI HTTP wrapper v0.2 spec:
  - `docs/specs/resilient_http_llm_openai_spec_v_0_2.md`
- Agent conversation core v0.2 spec (for adapter interface alignment):
  - `docs/specs/resilient_http_agent_conversation_core_spec_v_0_2.md`

If code and docs disagree, **the docs win**.

---

## 2. Global Constraints

- Language: **TypeScript** with `strict: true`.
- Depends on:
  - `@airnub/resilient-http-core` for `HttpClient` and types.
  - `@airnub/agent-conversation-core` for `ProviderAdapter` interfaces.
- Must not:
  - Call `fetch` directly — always use core’s `HttpClient`.
  - Implement its own resilience backoff or metrics — rely on core v0.7.

---

## 3. Implementation Tasks

### 3.1 Configuration & Client Types

Implement all public types described in `resilient_http_llm_openai_spec_v_0_2.md`, including:

- Configuration:
  - `OpenAIHttpClientConfig` (API key, base URL, organization, default model, etc.).
  - Optional default `ResilienceProfile` and `AgentContext`.
- Client:
  - `OpenAIHttpClient` interface with at least:
    - `responses.create(...)` (non-streaming).
    - Optionally `responses.createStream(...)` (streaming) per the spec.
  - `OpenAIResponsesClient` sub-interface if the spec splits concerns.

### 3.2 Request & Response Models

Define and export types that model the OpenAI Responses API as per the spec, including:

- Request types:
  - `OpenAIResponseCreateRequest` or equivalent, including:
    - `model`, `input`, `messages`, `tools`, `metadata`, etc.
    - `previous_response_id` support for response-chaining.
- Response types:
  - `OpenAIResponseObject` (id, model, status, output, metadata, etc.).
  - Streaming types:
    - `OpenAIResponseStream`.
    - `OpenAIResponseStreamEvent` (chunk types, e.g., `response.delta`, `response.completed`).

Adhere to the spec’s field names and structures (it may be a simplified subset of the official API; don’t over-extend it).

### 3.3 Integration with Core v0.7

Implement a factory function, for example:

```ts
export function createOpenAIHttpClient(config: OpenAIHttpClientConfig): OpenAIHttpClient;
```

This client must:

- Internally construct or receive a `HttpClient` from `@airnub/resilient-http-core`.
- For each operation (e.g., Responses `create`):
  - Build `HttpRequestOptions` according to v0.7:
    - `operation`: e.g., `"openai.responses.create"`.
    - `method`: `"POST"`.
    - `urlParts` or `url` pointing to the correct OpenAI endpoint.
    - `headers`: `Authorization: Bearer <api_key>`, `Content-Type: application/json`, etc.
    - `body`: JSON-encoded request.
    - Optional `resilience` overrides appropriate for OpenAI (e.g., `maxAttempts`, timeouts), as per spec.
  - Set metadata:
    - `agentContext` from config + per-request overrides.
    - `extensions['ai.provider'] = 'openai'`.
    - `extensions['ai.model'] = <model>`.
    - `extensions['ai.request_type'] = 'chat' | 'responses'` per spec.

Use `HttpClient.requestJson` / `requestRaw` to perform the actual HTTP calls.

### 3.4 Streaming Support (If Required by Spec)

If the v0.2 spec requires streaming responses:

- Implement a streaming method (`responses.createStream` or similar) that:
  - Sends the request with `stream: true` in the body if required.
  - Uses `HttpClient.requestRaw` and decodes the streaming protocol (e.g., SSE or chunked JSON) into `OpenAIResponseStreamEvent`s.
  - Returns an async iterator or callback-style interface per the spec.

Keep the streaming parsing logic self-contained and focused on the OpenAI Responses API.

### 3.5 Provider Adapter for Agent Conversation Core

Implement an `OpenAIProviderAdapter` that satisfies the `ProviderAdapter` interface from `@airnub/agent-conversation-core`:

- Adapt `Conversation`/`Turn` inputs into `OpenAIResponseCreateRequest`:
  - Map messages from the internal representation to OpenAI’s `messages` or `input` format.
  - Attach `previous_response_id` when continuing a chain.
- Call the `OpenAIHttpClient` to perform the request.
- Map `OpenAIResponseObject` (and optionally stream events) back into the agent-conversation domain types (`ProviderResponse`, etc.).

All correlation, resilience, and telemetry concerns must flow through `HttpClient` in the core.

---

## 4. Tests

Add tests for this package to cover:

- Request construction:
  - The correct URL, method, and headers are used for `responses.create`.
  - The JSON body matches the spec given a sample `OpenAIResponseCreateRequest`.
- Response mapping:
  - Successful responses are decoded into `OpenAIResponseObject` correctly.
  - Error responses are propagated as `HttpError` with correct status/category.
- Streaming (if implemented):
  - Example SSE or chunked responses are parsed into `OpenAIResponseStreamEvent`s.
- Conversation adapter integration:
  - Given a sample conversation and turn from `agent-conversation-core`, verify the adapter builds the expected request and maps the response back.

Use a fake `HttpClient` (or stub transport) from core to avoid hitting real OpenAI endpoints.

---

## 5. Done Definition

You are **done** for this prompt when:

- `@airnub/http-llm-openai` compiles and exports all types/interfaces described in `resilient_http_llm_openai_spec_v_0_2.md`.
- All HTTP uses `@airnub/resilient-http-core`’s `HttpClient` and follows v0.7 conventions (operation names, metadata, resilience, correlation).
- The package integrates cleanly with `@airnub/agent-conversation-core` via an `OpenAIProviderAdapter`.
- Tests cover request/response mapping and adapter behaviour.

Do not modify core or other satellites beyond what is necessary for type imports and adapter wiring.

