# CODING_AGENT_PROMPT.md — Implement the Resilient HTTP Ecosystem (Core v0.7 + Satellites)

## 0. Role & Context

You are a **senior TypeScript platform engineer** and **refactoring specialist**. Your task is to refactor and extend this monorepo so that it fully implements the **Resilient HTTP Core v0.7 ecosystem** and the associated satellite libraries, as described in the specs under `docs/specs/`.

You MUST treat the spec documents as the **source of truth**. Where repo code and specs disagree, the specs win (but you should try to preserve backwards compatibility with minimal shims where feasible).

This repo uses `@airnub/*` naming for the shared HTTP ecosystem.

---

## 1. Specs & Documents to Use as Source of Truth

Before you write or change any code, carefully read these spec documents (they should already exist in `docs/specs/` or equivalent):

- **Core & roadmap**
  - `docs/specs/resilient_http_core_spec_v_0_7.md`
  - `docs/specs/resilient_http_core_roadmap_and_satellite_libs_v0_7.md`

- **Satellites**
  - `docs/specs/resilient_http_pagination_spec_v_0_3.md`
  - `docs/specs/resilient_http_policies_spec_v_0_3.md`
  - `docs/specs/resilient_http_agent_conversation_core_spec_v_0_2.md`
  - `docs/specs/resilient_http_agent_browser_guardrails_spec_v_0_2.md`
  - `docs/specs/resilient_http_llm_openai_spec_v_0_2.md`

Your implementation MUST follow these specs exactly unless directed otherwise in this prompt.

---

## 2. Global Constraints & Conventions

1. **Language & strictness**
   - All packages are in **TypeScript** with `strict: true` in `tsconfig.json`.
   - Prefer `unknown` over `any`. Use narrow types and discriminated unions as described in the specs.

2. **Zero external dependencies by default**
   - Core and satellite packages must work **without Redis, DBs, OTEL, or logging frameworks**.
   - External integrations (e.g., OTEL, pino, Redis) MUST be optional, via separate adapters or configuration hooks.

3. **HTTP-only**
   - This ecosystem is HTTP(S)-only. **Do not introduce gRPC support**.
   - Do not add gRPC-specific code paths or dependencies.

4. **Backwards compatibility**
   - Where existing clients (FINRA, SEC, IEX, etc.) already use an older version of the core, prefer **thin compatibility wrappers** rather than breaking changes.
   - You can deprecate older APIs with `/** @deprecated */` but keep them working while you migrate call sites.

5. **No fabricated data or behaviour**
   - Do not stub behaviour that contradicts the specs.
   - If a spec describes an interface or behaviour, implement it properly or explicitly mark TODOs where integration is outside the current repo.

6. **Testing & quality**
   - Every new public function or class MUST have unit tests.
   - Keep tests deterministic; use fake/mocked transports instead of real network IO.
   - Prefer Jest or the existing test framework configured in the repo.

7. **Documentation**
   - For each package, ensure there is a `README.md` that:
     - Explains the purpose.
     - Shows minimal usage examples.
     - Points to the relevant spec in `docs/specs/`.
   - Keep code-level docs in TSDoc style.

---

## 3. Repository Structure (Target)

Bring the monorepo into (or close to) this structure, using existing folders where possible:

```text
packages/
  resilient-http-core/              # @airnub/resilient-http-core
  resilient-http-pagination/        # @airnub/resilient-http-pagination
  resilient-http-policies/          # @airnub/resilient-http-policies
  agent-conversation-core/          # @airnub/agent-conversation-core
  agent-browser-guardrails/         # @airnub/agent-browser-guardrails
  http-llm-openai/                  # @airnub/http-llm-openai

docs/specs/
  resilient_http_core_spec_v_0_7.md
  resilient_http_core_roadmap_and_satellite_libs_v0_7.md
  resilient_http_pagination_spec_v_0_3.md
  resilient_http_policies_spec_v_0_3.md
  resilient_http_agent_conversation_core_spec_v_0_2.md
  resilient_http_agent_browser_guardrails_spec_v_0_2.md
  resilient_http_llm_openai_spec_v_0_2.md
```

If existing packages already use slightly different names, you may:

- Keep the current on-disk paths but expose the new `@airnub/*` names via `package.json`.
- Add `"name": "@airnub/..."` and fix import paths in the monorepo.

---

## 4. Implementation Plan — High-Level Steps

Follow these steps in order. Do **not** skip ahead without ensuring earlier steps are complete and tests are passing.

1. **Stabilise `@airnub/resilient-http-core` to match v0.7 spec.**
2. **Extract/align pagination into `@airnub/resilient-http-pagination` v0.3.**
3. **Implement `@airnub/resilient-http-policies` v0.3 and wire in via interceptors.**
4. **Implement `@airnub/agent-conversation-core` v0.2 (conversation model + engine).**
5. **Implement `@airnub/agent-browser-guardrails` v0.2.**
6. **Implement `@airnub/http-llm-openai` v0.2 and its ProviderAdapter.**
7. **Refactor existing API clients to use core v0.7 + satellites.**
8. **Add template setups and documentation examples as described in the roadmap.**

Each step below is detailed with concrete tasks and acceptance criteria.

---

## 5. Step 1 — Core v0.7 Implementation (`@airnub/resilient-http-core`)

### 5.1 Tasks

1. Open `docs/specs/resilient_http_core_spec_v_0_7.md` and compare the spec to the current implementation.
2. Ensure the following public types and interfaces exist and match the spec (names and shapes):
   - `HttpClient`, `HttpRequestOptions`, `HttpResponse`, `HttpTransport`.
   - `ResilienceProfile` and its fields (priority, maxAttempts, latency budgets, backoff hints, failFast, failover hints, etc.).
   - `ErrorCategory`, `ClassifiedError`, `ErrorClassifier` interface.
   - `RequestOutcome` and any related metrics shapes.
   - `RateLimitFeedback`.
   - `HttpRequestInterceptor` with `beforeSend`, `afterResponse`, `onError` hooks.
   - `AgentContext`, `extensions`, `requestId`, `correlationId`, `parentCorrelationId` wiring.
3. Implement or refine a `createDefaultHttpClient(config?)` helper as specified:
   - Uses fetch (or existing transport abstraction) with sane defaults.
   - Sets a sensible default `ResilienceProfile`.
   - Does not require Redis or OTEL.
4. Ensure metrics and logging hooks receive full context:
   - `MetricsSink` should be called with `RequestOutcome`, `RateLimitFeedback`, `AgentContext`, `correlationId`, and `extensions`.
   - `Logger` should have enough information to debug failures without leaking secrets.
5. Remove or deprecate any gRPC-related code. The core must be HTTP-only.

### 5.2 Acceptance Criteria

- All types and interfaces listed in the v0.7 spec are present and match the documented shape.
- Tests cover:
  - Basic request flow with and without interceptors.
  - Resilience behaviour (retries, timeouts) aligned with `ResilienceProfile`.
  - Error classification via `ErrorClassifier`.
- `createDefaultHttpClient` can be imported and used in a small example script without any other packages.

---

## 6. Step 2 — Pagination (`@airnub/resilient-http-pagination` v0.3)

### 6.1 Tasks

1. Read `docs/specs/resilient_http_pagination_spec_v_0_3.md`.
2. Create the `packages/resilient-http-pagination` package with the types and APIs defined there:
   - `PaginationModel`, `Page<T>`, `PaginationResult<T>`, `PaginationLimits`, `PageExtractor<T>`, `PaginationStrategy`, `PaginationObserver`.
   - `paginate` and `paginateStream` core functions.
   - Strategy builders like `createOffsetLimitStrategy`, `createCursorStrategy`, and array field extractors.
3. Ensure every request made via pagination:
   - Uses a provided `HttpClient`.
   - Propagates `AgentContext`, `correlationId`, and `extensions`.
   - Applies per-page `ResilienceProfile` as specified.
4. Add tests that:
   - Use a fake `HttpClient` returning deterministic pages.
   - Verify limit behaviour (`maxPages`, `maxItems`, `maxEndToEndLatencyMs`).
   - Confirm aggregation of `RequestOutcome` across pages.

### 6.2 Acceptance Criteria

- No pagination logic remains inside `@airnub/resilient-http-core` or individual API clients (beyond minimal glue).
- `paginate` and `paginateStream` work with a fake `HttpClient` and are covered by tests.

---

## 7. Step 3 — Policies & Budgets (`@airnub/resilient-http-policies` v0.3)

### 7.1 Tasks

1. Read `docs/specs/resilient_http_policies_spec_v_0_3.md`.
2. Create the `packages/resilient-http-policies` package with:
   - Core types: `RequestClass`, `PolicyScope`, `ScopeSelector`, `PolicyDefinition`, `PolicyDecision`, `PolicyOutcome`, `PolicyEngine`.
   - In-memory engine: `createInMemoryPolicyEngine`.
   - Helper factories: `createBasicRateLimitPolicy`, `createBasicConcurrencyPolicy`, `createBasicInMemoryPolicyEngine`.
   - Interceptor: `createPolicyInterceptor(options)`.
3. Implement the interceptor according to the spec:
   - Derive `PolicyScope` from `HttpRequestOptions`, `AgentContext`, `extensions`.
   - Call `engine.evaluate()` in `beforeSend` and enforce `allow/delay/deny`.
   - Merge resilience overrides into `request.resilience`.
   - Call `engine.onResult()` in `afterResponse`/`onError` with `RequestOutcome` + any `RateLimitFeedback`.
4. Add tests covering:
   - Allow vs delay vs deny.
   - Concurrency limits and queueing behaviour.
   - Fail-open vs fail-closed options when the policy engine errors.

### 7.2 Acceptance Criteria

- Policies are fully decoupled from core; core does not know about them beyond using interceptors.
- At least one demo configuration exists (in tests or examples) that limits requests per client/model.

---

## 8. Step 4 — Agent Conversation Core (`@airnub/agent-conversation-core` v0.2)

### 8.1 Tasks

1. Read `docs/specs/resilient_http_agent_conversation_core_spec_v_0_2.md`.
2. Implement the package with the following exported primitives:
   - Domain types: `Conversation`, `ConversationMessage`, `ConversationTurn`, roles, content parts (`text`, `tool-call`, `tool-result`, `metadata`).
   - Provider abstractions: `ProviderMessage`, `ProviderToolDefinition`, `ProviderToolCall`, `ProviderAdapter`, `ProviderStream`, etc.
   - Store: `ConversationStore`, `InMemoryConversationStore`.
   - History: `HistoryBuilder`, `RecentNTurnsHistoryBuilder`.
   - Engine: `ConversationEngine`, `DefaultConversationEngine` with `runTurn` and optional `runStreamingTurn`.
3. Ensure mapping functions exist (internal or exported) to:
   - Convert `ConversationMessage[]` to `ProviderMessage[]`.
   - Convert provider responses back to assistant messages and turns.
4. Add tests that:
   - Use a fake `ProviderAdapter` to simulate responses.
   - Cover conversation creation, history building, and turn persistence.

### 8.2 Acceptance Criteria

- `DefaultConversationEngine` supports at least basic non-streaming turns.
- `InMemoryConversationStore` is usable for tests and local prototyping.

---

## 9. Step 5 — Browser Guardrails (`@airnub/agent-browser-guardrails` v0.2)

### 9.1 Tasks

1. Read `docs/specs/resilient_http_agent_browser_guardrails_spec_v_0_2.md`.
2. Implement the package with:
   - Core types: `GuardedRequestKind`, `GuardrailScope`, `GuardrailSelector`, `GuardrailRule`, `GuardrailAction`, `GuardrailDecision`, `GuardrailEngine`.
   - Error: `GuardrailViolationError`.
   - HTTP integration: `createHttpGuardrailInterceptor(options)`.
   - Browser integration: `BrowserNavigationGuard`, `createBrowserNavigationGuard(options)`.
   - In-memory engine: `createInMemoryGuardrailEngine(config)`.
   - Opinionated helper: `createHostAllowlistGuardrails(options)`.
3. Implement host/path/method matching and header/query/body rules as per spec.
4. Add tests for:
   - Allow/block decisions.
   - Header redaction and query param masking.
   - Body size/content-type enforcement.

### 9.2 Acceptance Criteria

- Guardrails and policies are clearly distinct (guardrails = surface allow/block; policies = budget/quotas).
- Interceptors throw `GuardrailViolationError` on blocked requests.

---

## 10. Step 6 — OpenAI HTTP Wrapper (`@airnub/http-llm-openai` v0.2)

### 10.1 Tasks

1. Read `docs/specs/resilient_http_llm_openai_spec_v_0_2.md`.
2. Implement the package with:
   - Config & client: `OpenAIHttpClientConfig`, `OpenAIHttpClient`, `createOpenAIHttpClient(config)`.
   - Domain types: `OpenAIRole`, `OpenAIInputMessage`, `OpenAIToolDefinition`, `OpenAIResponseObject`, `OpenAIConversationState`.
   - Responses client: `OpenAIResponsesClient` with `create(...)` and optional `createStream(...)`.
   - Provider adapter: `OpenAIProviderAdapterConfig`, `OpenAIProviderAdapter` implementing `ProviderAdapter` from `agent-conversation-core`.
3. Wire all HTTP calls via `HttpClient` from `resilient-http-core`:
   - `POST {baseUrl}/responses`.
   - Correct headers (`Authorization`, `OpenAI-Organization`, `OpenAI-Project`).
   - `extensions` including `ai.provider`, `ai.model`, `ai.operation`, and optionally `ai.tenant`.
4. Implement mapping:
   - `ProviderMessage[]` → `OpenAIInputMessage[]`.
   - Raw responses → `OpenAIResponseObject` → `ProviderCallResult`.
   - `previous_response_id` chaining using `OpenAIConversationState`.
5. Add tests using a fake `HttpClient` (no real network calls).

### 10.2 Acceptance Criteria

- `OpenAIProviderAdapter` can be plugged into `DefaultConversationEngine` and used to run a full turn with a fake underlying OpenAI HTTP client.
- The client does not depend on SDKs; only `resilient-http-core` for HTTP.

---

## 11. Step 7 — Refactor Existing API Clients

### 11.1 Tasks

1. Identify all existing HTTP clients in the monorepo (e.g., FINRA, SEC, IEX, any custom services).
2. For each client:
   - Ensure it uses `@airnub/resilient-http-core` v0.7 as the transport layer.
   - Remove any bespoke resilience wrappers now superseded by `ResilienceProfile` and interceptors.
   - If the client does pagination, replace ad-hoc logic with `@airnub/resilient-http-pagination`.
   - If the client needs budgets/quotas, integrate `@airnub/resilient-http-policies` via `createPolicyInterceptor`.
   - If the client will be called by agents or tools, consider layering `agent-browser-guardrails` (for unsafe surfaces).
3. Add or update tests to ensure behaviour is preserved (same endpoints, same auth, same core semantics).

### 11.2 Acceptance Criteria

- All HTTP clients depend on `@airnub/resilient-http-core` as their only HTTP abstraction.
- Pagination and policy behaviour are implemented via the new satellites, not custom code.

---

## 12. Step 8 — Template Stacks & Examples

### 12.1 Tasks

1. Based on the roadmap doc, add a `docs/` or `examples/` section with three template setups:
   - **Minimal Core Stack**
   - **Data Ingest / ETL Stack**
   - **AI / Agentic Stack**
2. For each stack, add:
   - A short markdown description.
   - Example TypeScript snippet showing how to wire:
     - `createDefaultHttpClient`.
     - Optional pagination/policies/guardrails.
     - For AI stack: `ConversationEngine` + `OpenAIProviderAdapter`.
3. Ensure examples compile (either via example tsconfig or by including them in tests).

### 12.2 Acceptance Criteria

- Developers can open `docs/specs/resilient_http_core_roadmap_and_satellite_libs_v0_7.md` and follow links/code references to real examples that compile in the repo.

---

## 13. Definition of Done

The implementation/refactor is **complete** when:

1. All specs listed in Section 1 are implemented and the public APIs match.
2. All packages build successfully with TypeScript `strict` mode.
3. All tests pass, including new tests for satellites and refactored clients.
4. The example/template stacks compile and demonstrate:
   - A minimal core-only HTTP client.
   - A paginated + rate-limited data ingest worker.
   - A small agentic stack using conversation core + OpenAI HTTP wrapper + guardrails.
5. There are no stray gRPC-specific dependencies or code paths.
6. Documentation is consistent:
   - Each package has a `README.md`.
   - Specs in `docs/specs/` are referenced from the relevant package README.

When you make changes, prefer small, focused commits that reference the relevant spec section (e.g., `core v0.7 §3.1 ResilienceProfile`). This makes future audits and externalisation to a dedicated `airnub-http` org much easier.

