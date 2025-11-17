# Coding Agent Prompt — Upgrade Resilient HTTP Ecosystem to v0.8 (Full Spec)

## 0. Role & Mindset

You are a **senior TypeScript library engineer** and **spec-driven coding agent**.

Your job is to:

1. **Ingest and strictly follow** the v0.8 full spec document:
   - `docs/specs/resilient_http_core_spec_v_0_8.md`
2. **Systematically upgrade** the existing `resilient-http-*` implementation in
   this repo from v0.7 to v0.8.
3. Produce clean, well-typed, well-tested code that matches the v0.8 full spec
   (including testing utilities and the opinionated agent runtime), removing all
   legacy/compatibility layers.

You must treat the v0.8 full spec as the **single source of truth**. If existing
code conflicts with the spec, the spec wins.

---

## 1. Repository & Scope

### 1.1 Repo

- Target repo: `tradentic/institutional-rotation-detector` (this workspace).

### 1.2 Packages in Scope

Within this repo, you must focus on the following packages/libs (actual folder
names may differ; map them by intent):

- Core & satellites:
  - `@airnub/resilient-http-core`
  - `@airnub/resilient-http-policies`
  - `@airnub/resilient-http-pagination`
  - `@airnub/agent-conversation-core`
  - `@airnub/http-llm-openai`
  - `@airnub/agent-browser-guardrails`
- New packages from the v0.8 full spec:
  - `@airnub/resilient-http-testing`
  - `@airnub/agent-runtime`

Assume a monorepo layout similar to:

- `libs/resilient-http-core/**`
- `libs/resilient-http-policies/**`
- `libs/resilient-http-pagination/**`
- `libs/agent-conversation-core/**`
- `libs/http-llm-openai/**`
- `libs/agent-browser-guardrails/**`
- `libs/resilient-http-testing/**` (create if missing)
- `libs/agent-runtime/**` (create if missing)

When names differ, use a combination of package.json names and existing exports
(`HttpClient`, `PolicyEngine`, `paginate`, `ConversationEngine`, `OpenAIHttpClient`,
`GuardrailEngine`, etc.) to locate the right modules.

---

## 2. High-Level Objectives

1. **Align all APIs** with the full v0.8 spec:
   - Core: `HttpClient`, `HttpClientConfig`, `HttpRequestOptions`,
     `ResilienceProfile`, `BudgetHints`, `ErrorCategory`, `ErrorClassifier`,
     `HttpError`, interceptors, caching, metrics, tracing.
   - Satellites: policies, pagination, conversation core, OpenAI client,
     browser guardrails.
   - New packages: testing helpers, opinionated agent runtime.
2. **Remove all legacy/deprecated code paths** from pre-0.7 specs:
   - Legacy hooks (`beforeRequest`/`afterResponse`), `policyWrapper`, core-level
     pagination hints, etc.
3. **Implement standard interceptors** from the spec:
   - Auth, JSON body serialization, idempotency.
4. **Implement testing utilities** (`resilient-http-testing`) and
   **agent runtime factory** (`agent-runtime`).
5. **Ensure TypeScript `strict` correctness** and solid unit/integration tests
   per the v0.8 Implementation Checklist.

---

## 3. Operating Principles

1. **Spec as source of truth**
   - Align types, behaviour, and naming with `resilient_http_core_spec_v_0_8.md`.
   - Only introduce deviations when absolutely necessary, and document them
     with comments explaining why.

2. **No backwards compatibility**
   - Remove all deprecated/legacy surfaces from pre-0.7.
   - Do not re-introduce compatibility shims or alias types.

3. **Minimal but clear public surface**
   - Only expose what the spec declares as public.
   - Keep helpers that are purely internal as non-exported.

4. **Small, coherent changes**
   - Group edits by package and concern.
   - Ensure the repo builds/tests successfully after each major refactor.

5. **Testing & determinism**
   - Use `@airnub/resilient-http-testing` helpers to keep tests deterministic.
   - Avoid flaky timing-dependent tests.

---

## 4. Phase 1 — Load & Internalise the v0.8 Full Spec

1. Open `docs/specs/resilient_http_core_spec_v_0_8.md`.
2. Carefully read and internalise:
   - Core HTTP API & types.
   - Resilience + error classification model.
   - Interceptor model, standard interceptors.
   - Caching, metrics, tracing.
   - Policy model, PolicyStore, in-memory engine, interceptor & presets.
   - Pagination APIs & strategies.
   - Conversation-core abstractions & engine.
   - OpenAI HTTP client and provider adapter.
   - Browser guardrails (including default engine factory).
   - Testing helpers (record/replay, test client).
   - Agent-runtime factory and wiring.
3. Build a brief internal checklist of required types/exports per package.

You will keep cross-checking this spec every time you touch the code.

---

## 5. Phase 2 — Inventory Current Implementation vs v0.8

For each package, create an internal TODO list of **gaps and mismatches**.

### 5.1 Core (`@airnub/resilient-http-core`)

1. Find the core implementation (e.g. `libs/resilient-http-core/src/**`).
2. Compare current types and exports to the spec:
   - `HttpClient`, `HttpClientConfig`, `HttpRequestOptions`.
   - `ResilienceProfile`, `BudgetHints` (or equivalent).
   - `ErrorCategory`, `ClassifiedError`, `FallbackHint`, `ErrorClassifier`.
   - `HttpError`, `TimeoutError`, `RequestOutcome`, `RateLimitFeedback`.
   - Interceptor interfaces, `HttpCache`, `MetricsSink`, `TracingAdapter`.
3. Identify:
   - Fields present in code but **not** in spec → mark for removal.
   - Fields present in spec but **missing** in code → mark for addition.
   - Behaviour mismatches (e.g. retry logic, caching semantics, correlation ID
     generation).
4. Check for legacy constructs:
   - `policyWrapper`.
   - Legacy hooks (`beforeRequest`, `afterResponse`) that are not the standard
     interceptor interfaces.
   - Core-level pagination hints or flags.

### 5.2 Policies (`@airnub/resilient-http-policies`)

1. Locate policy engine, types, and any interceptors.
2. Compare:
   - `PolicyScope`, `PolicyDefinition`, `PolicyDecision`.
   - `RateLimitRule`, `ConcurrencyRule`, `ResilienceOverride`.
   - `PolicyEngine`, `PolicyStore` (if present).
3. Identify where current shapes differ from the spec and record required
   additions/removals.

### 5.3 Pagination (`@airnub/resilient-http-pagination`)

1. Inspect pagination helpers.
2. Compare with v0.8 types and functions:
   - `paginate`, `paginateStream`.
   - `PaginationResult`, `Page`.
   - offset/limit and cursor strategies.
3. Confirm there is **no** dependency on any legacy core pagination hints.

### 5.4 Conversation Core (`@airnub/agent-conversation-core`)

1. Locate conversation models and engine:
   - Messages, parts, turns, conversation, store, history builder.
2. Compare with spec types & classes, especially:
   - `ConversationMessage`, `MessagePart`, `ConversationTurn`, `Conversation`.
   - `ConversationStore`, `HistoryBuilder`, `RecentNTurnsHistoryBuilder`.
   - `ConversationEngine` (including streaming methods).
3. Note any missing fields or methods.

### 5.5 OpenAI Client (`@airnub/http-llm-openai`)

1. Inspect OpenAI client implementation.
2. Compare with spec types & behaviour:
   - `OpenAIHttpClient`, `OpenAIResponsesCreateInput`, `OpenAIResponseObject`.
   - Streaming: `OpenAIStream`, `OpenAIStreamEvent`.
   - `createOpenAIProviderAdapter`.
3. Note any mismatches.

### 5.6 Guardrails (`@airnub/agent-browser-guardrails`)

1. Locate guardrails engine, interceptor, navigation guard.
2. Compare with spec:
   - `GuardrailRule`, `GuardrailDecision`, `GuardrailEngine`.
   - `createInMemoryGuardrailEngine`, `createHttpGuardrailInterceptor`.
   - `BrowserNavigationGuard`, `createBrowserNavigationGuard`.
   - `createDefaultGuardrailEngine`.
3. Identify required additions/removals.

### 5.7 Testing (`@airnub/resilient-http-testing`) & Agent Runtime (`@airnub/agent-runtime`)

1. If these packages exist, inventory them.
2. Otherwise, plan to **create them from scratch** according to the spec.

Produce a per-package TODO list before making structural changes.

---

## 6. Phase 3 — Core v0.8 Alignment

### 6.1 Types & Surfaces

1. Align all core types to match the spec exactly:
   - `HttpMethod`, `HttpHeaders`, `UrlParts`, `HttpRequestOptions`.
   - `ResilienceProfile`, `BudgetHints`.
   - Error model (`ErrorCategory`, `ClassifiedError`, `FallbackHint`,
     `ErrorClassifier`), `HttpError`, `TimeoutError`.
   - `TransportRequest`, `RawHttpResponse`, `HttpTransport`.
   - `HttpResponse<T>`, `RequestOutcome`, `RateLimitFeedback`.
   - Interceptor interfaces.
   - `HttpCache`, `HttpCacheEntry`, `MetricsSink`, `TracingAdapter`.
2. Remove any types or fields not defined in the v0.8 full spec.

### 6.2 HttpClient Implementation

Refactor `HttpClient` methods to match spec semantics:

- Validate `url` XOR `urlParts`.
- Resolve `UrlParts` into a full URL (respecting `baseUrl`).
- Merge default and per-request headers and extensions.
- Derive `ResilienceProfile` and `BudgetHints` for each logical request.
- Generate `requestId` and `correlationId` when unspecified.
- Implement a single retry loop with:
  - Per-attempt `AbortController` timeout.
  - Overall timeout.
  - Classification-driven retry decisions.
  - Exponential backoff with jitter and `FallbackHint.retryAfterMs`.
- Use `cache` when configured and `cacheMode !== "bypass"`.
- Emit one `RequestOutcome` per logical request and send it to `metricsSink` and
  `tracingAdapter`.

### 6.3 Standard Interceptors

Implement and export the standard interceptors defined in the spec:

- `createAuthInterceptor` (pluggable token provider & header format).
- `createJsonBodyInterceptor` (JSON serialization and content-type).
- `createIdempotencyInterceptor` (maps `idempotencyKey` to header).

Ensure they are **not** hard-coded into HttpClient; they should be attached
through `HttpClientConfig.interceptors` or the default factory.

### 6.4 Default Client Factory

Implement `createDefaultHttpClient(options?: DefaultClientOptions)` exactly as
specified:

- Fetch-based transport.
- Recommended `ResilienceProfile` defaults.
- A sensible default `ErrorClassifier`.
- Optional console logging interceptor and basic metrics sink when
  `enableConsoleLogging` is true.

### 6.5 Core Tests

Update/add tests for:

- Retries and backoff (including jitter and `retryAfterMs`).
- Per-attempt and overall timeout behaviour.
- Error classification and resulting `HttpError` fields.
- Interceptor ordering, including error paths.
- Cache behaviour (`default`, `bypass`, `refresh`).
- Metrics & tracing hooks (via injectible test doubles).

---

## 7. Phase 4 — Policies v0.4 Alignment

1. Align types to spec:
   - `PolicyScope`, `PolicyDefinition`, `PolicyDecision`, `RateLimitRule`,
     `ConcurrencyRule`, `ResilienceOverride`.
   - `PolicyRequestContext`, `PolicyResultContext`, `PolicyEngine`.
   - `PolicyStore` abstraction.
2. Implement or refine `createInMemoryPolicyEngine`:
   - Policies can be kept in-memory or loaded from a `PolicyStore`.
   - Support rate limits and concurrency rules.
   - Honour `failOpenOnError` semantics.
3. Implement `createPolicyInterceptor`:
   - Derive scope from `HttpRequestOptions` (clientName from config, plus
     operation, tenant, provider, model, etc. from AgentContext/Extensions).
   - Call `engine.evaluate` in `beforeSend` and act on the decision.
   - Call `engine.onResult` in `afterResponse`/`onError` with final
     `RequestOutcome`.
4. Implement policy presets:
   - `createSimpleRateLimitPolicy`.
   - `createSimpleConcurrencyPolicy`.
5. Add tests for allow/deny, rate limits, concurrency, resilience overrides, and
   fail-open vs fail-closed behaviour.

---

## 8. Phase 5 — Pagination v0.4 Alignment

1. Ensure `paginate` and `paginateStream` match spec signatures and behaviour.
2. Implement `PaginationResult`, `Page`, `PaginationLimits` exactly.
3. Implement strategy helpers:
   - `createOffsetLimitStrategy`.
   - `createCursorStrategy`.
4. Confirm pagination uses `HttpClient` and preserves `operation`,
   `AgentContext`, `extensions` across pages.
5. Add tests for multi-page scenarios, truncation (`maxPages`, `maxItems`,
   `maxDurationMs`), and streaming behaviour.

---

## 9. Phase 6 — Conversation Core v0.3 Alignment

1. Align all conversation-related types with the spec:
   - `ConversationMessage`, `MessagePart`, `ConversationTurn`, `Conversation`.
   - `ProviderToolCall`, `ProviderCallRecord`, `TokenUsage`.
2. Implement `ConversationStore` interface and at least one simple in-memory
   implementation (e.g. arrays in memory, suitable for agent-runtime).
3. Implement `HistoryBuilder` and `RecentNTurnsHistoryBuilder` per spec.
4. Implement `ConversationEngine` with `processTurn` and `processTurnStream`.
   - It should be **HTTP-agnostic**, only talking to a `ProviderAdapter`.
5. Add tests:
   - Happy path with stub provider (non-stream & stream).
   - History trimming behaviour with `HistoryBudget`.
   - Usage recording via `ProviderCallRecord`.

---

## 10. Phase 7 — OpenAI HTTP Client v0.3 Alignment

1. Ensure `OpenAIHttpClientConfig`, `OpenAIResponsesCreateInput`,
   `OpenAIResponseObject`, `OpenAIStreamEvent`, `OpenAIStream` match the spec.
2. Implement `OpenAIHttpClient` so that `responses.create` and
   `responses.createStream` use `HttpClient` and map raw responses into the
   typed objects consistently.
3. Set `operation`, `extensions["ai.provider"]`, `extensions["ai.model"]` for
   every call.
4. Implement `createOpenAIProviderAdapter` that turns `OpenAIHttpClient` into a
   `ProviderAdapter` for conversation-core.
5. Add tests for mapping of non-streaming and streaming responses, including
   usage fields and tool calls.

---

## 11. Phase 8 — Browser Guardrails v0.3 Alignment

1. Align `GuardrailRule`, `GuardrailDecision`, `GuardrailEngine` with the spec.
2. Implement `createInMemoryGuardrailEngine` and `createHttpGuardrailInterceptor`.
3. Implement `BrowserNavigationGuard` and `createBrowserNavigationGuard`.
4. Implement `createDefaultGuardrailEngine` for a safe default profile.
5. Add tests for:
   - Allow/deny decisions based on host/method/protocol.
   - Header stripping behaviour.
   - Body size enforcement where applicable.
   - Navigation guard rejection.

---

## 12. Phase 9 — Testing Utilities (`@airnub/resilient-http-testing`)

1. Create (or align) `libs/resilient-http-testing` to the spec:
   - `RecordedRequest`, `RecordingTransportOptions`, `ReplayTransportOptions`.
   - `createRecordingTransport`, `createReplayTransport`.
   - `TestHttpClientOptions`, `createTestHttpClient`.
2. Ensure:
   - Recording transport wraps a provided `HttpTransport` and calls `onRecord`.
   - Replay transport uses `recordings` and throws when no match is found.
   - `createTestHttpClient` builds a `HttpClient` with:
     - Optional replay/record transports.
     - Deterministic `requestId` generation based on `seed`.
     - No retries by default (`maxAttempts = 1`).
3. Add tests verifying recording, replay, mismatch behaviour, and deterministic
   IDs.

---

## 13. Phase 10 — Agent Runtime (`@airnub/agent-runtime`)

1. Create (or align) `libs/agent-runtime` to the spec:
   - `AgentRuntimeConfig`, `AgentRuntime` types.
   - `createDefaultAgentRuntime(config)` factory.
2. Implement `createDefaultAgentRuntime` as follows:
   - Create a default `HttpClient` via `createDefaultHttpClient`.
   - Create a `PolicyEngine` with `createInMemoryPolicyEngine` and attach a
     `PolicyInterceptor` to the HttpClient.
   - Create a `GuardrailEngine` via `createDefaultGuardrailEngine` and attach
     `createHttpGuardrailInterceptor` to the HttpClient.
   - Create an `OpenAIHttpClient` wired to the HttpClient.
   - Create a simple in-memory `ConversationStore` and a
     `RecentNTurnsHistoryBuilder`.
   - Create `OpenAI` `ProviderAdapter` via `createOpenAIProviderAdapter`.
   - Build `ConversationEngine` using the store, history builder and adapter.
3. Return all components as `AgentRuntime`.
4. Add tests that:
   - Validate wiring (e.g. operations/metadata set on HttpClient calls).
   - Exercise a simple end-to-end turn (user → OpenAI → assistant response).

---

## 14. Phase 11 — Final Validation & Documentation

1. Run TypeScript build with `strict: true` across all affected packages.
2. Run the full test suite and ensure all tests pass.
3. Update or add:
   - `docs/specs/resilient_http_core_spec_v_0_8.md` if needed (ensuring
     code matches spec, not vice versa).
   - A short `docs/CHANGELOG_resilient_http_v0_8.md` summarising API changes
     from v0.7 → v0.8.
4. Optionally add a `docs/AGENT_RUNTIME_quickstart.md` showing how to use
   `createDefaultAgentRuntime` in an application.

---

## 15. Deliverables

Your work as this coding agent should result in:

1. **Updated code** in all relevant packages, fully aligned with
   `resilient_http_core_spec_v_0_8.md`.
2. **New or updated tests** that satisfy the v0.8 Implementation Checklist.
3. **New testing and runtime packages** (`resilient-http-testing`,
   `agent-runtime`) implemented per the spec.
4. **No legacy v0.7 or earlier code paths** remaining.

Always cross-check changes against the v0.8 full spec and favour the
simpler/cleaner design when in doubt.

