# CODING_AGENT_PROMPT.md — Implement the Resilient HTTP Ecosystem (Core v0.7 + Satellites)

## 0. Role & Scope

You are a **senior TypeScript engineer** working in the `tradentic/institutional-rotation-detector` monorepo.

Your job is to **implement and align the entire Resilient HTTP ecosystem** with the latest specs:

- Core: `@airnub/resilient-http-core` **v0.7**
- Satellites:
  - `@airnub/resilient-http-pagination` **v0.3**
  - `@airnub/resilient-http-policies` **v0.3**
  - `@airnub/agent-conversation-core` **v0.2`** (spec file name starts with `resilient_http_…`)
  - `@airnub/agent-browser-guardrails` **v0.2**
  - `@airnub/http-llm-openai` **v0.2**

You must treat the **spec documents as the source of truth** and refactor the monorepo to match them.

Do **not** invent new behaviours beyond the specs. Where existing code contradicts the spec, the spec wins (but preserve backwards compatibility where the spec requires it).

---

## 1. Source of Truth — Specs & Docs

Use these documents as authoritative (paths may vary slightly; search by filename if needed):

- Core v0.7 spec (just created):
  - `docs/specs/resilient_http_core_spec_v_0_7.md`
- Core roadmap & satellites:
  - `docs/specs/resilient_http_core_roadmap_and_satellite_libs.md`
- Pagination spec:
  - `docs/specs/resilient_http_pagination_spec_v_0_3.md`
- Policies spec:
  - `docs/specs/resilient_http_policies_spec_v_0_3.md`
- Agent conversation core spec:
  - `docs/specs/resilient_http_agent_conversation_core_spec_v_0_2.md`
- Browser guardrails spec:
  - `docs/specs/resilient_http_agent_browser_guardrails_spec_v_0_2.md`
- OpenAI LLM HTTP wrapper spec:
  - `docs/specs/resilient_http_llm_openai_spec_v_0_2.md`

If the code and these docs disagree, **assume the docs are correct** and adjust the code accordingly.

---

## 2. Global Constraints & Non‑Goals

- **Language:** TypeScript with `strict: true`.
- **Runtime:** Node (for now), but keep browser compatibility in mind (no Node‑only globals without guards).
- **Transport:** use `fetchTransport` as the default `HttpTransport` implementation.
- **No gRPC support** in this ecosystem. Everything is HTTP(S) on top of `fetch`‑style requests.
- **No heavy external resilience libs** (cockatiel, resilience4ts, etc.).
- **No telemetry frameworks** baked into core (OTEL, Prometheus, Datadog, etc.).
- **No domain‑specific logic** in core or generic satellites:
  - No FINRA/UW/SEC/IEX/OpenAI logic in core.
  - Provider/LLM logic lives in `@airnub/http-llm-openai` etc.

---

## 3. High‑Level Tasks (Phased)

Work in **phases**, committing in small, reviewable chunks. The phases are ordered; complete earlier ones first.

### Phase 1 — Align `@airnub/resilient-http-core` to v0.7

**Target package:** `libs/resilient-http-core`

1. **Read the spec carefully**
   - `docs/specs/resilient_http_core_spec_v_0_7.md`
   - Pay special attention to:
     - `HttpClientConfig`, `HttpRequestOptions`.
     - `ResilienceProfile`, `RequestBudget`.
     - `ErrorCategory`, `ClassifiedError`, `ErrorClassifier`.
     - `HttpRequestInterceptor` contexts.
     - Caching, backoff, rate‑limit feedback, tracing, metrics.
     - Legacy fields: `pageSize`, `pageOffset`, `budget`, `maxEndToEndLatencyMs`, `beforeRequest`/`afterResponse`.

2. **Refactor `HttpClient.ts` to match the spec**

   - Keep the good structural changes from the existing 0.7 attempt:
     - Use `url` / `urlParts` where available.
     - Consolidate `correlation` into `CorrelationInfo`.
     - Provide `defaultResilience` and `defaultAgentContext` on the config.
     - Use interceptors with `BeforeSendContext`, `AfterResponseContext`, `OnErrorContext`.
   - Restore or implement all required behaviours from v0.6 that the spec retains:
     - **Caching**: `HttpCache`, `cacheKey`, `cacheTtlMs` on `requestJson<T>`.
     - **Backoff & delay** between retries:
       - Use `ClassifiedError.suggestedBackoffMs`, `Retry-After` header, and exponential backoff with jitter.
     - **RateLimitFeedback**:
       - Parse rate‑limit headers (`x-ratelimit-*`, `retry-after`) into a structured `RateLimitFeedback`.
     - **JSON body handling**:
       - Serialize plain objects/arrays to JSON and set `Content-Type: application/json` when missing.
       - Pass through `BodyInit` unchanged.
     - **Tracing**:
       - Implement `TracingAdapter` support (`startSpan`, `recordException`, `end`).
       - Attach attributes (client, operation, method, path/url, correlation IDs, agent labels, etc.).
     - **ErrorClassifier & HttpError**:
       - Implement `ErrorClassifier` (default + config override).
       - `HttpError` must carry `status`, `category`, optional `body`, `headers`, `fallback`, `response`, `correlation`, `agentContext`.
     - **MetricsSink integration**:
       - Emit a single `MetricsRequestInfo` per logical request with final `RequestOutcome`.
     - **RateLimiter & CircuitBreaker hooks**:
       - `throttle` / `onSuccess` / `onError` for rate limiter.
       - `beforeRequest` / `onSuccess` / `onFailure` for circuit breaker.

   - Ensure **retry loop semantics** match the v0.7 spec:
     - `maxAttempts` from merged `ResilienceProfile` + legacy `RequestBudget`.
     - `overallTimeoutMs` vs per‑attempt timeouts.
     - Respect `retryEnabled` and category/`retryable` flags.

3. **Interceptors & legacy hooks**

   - Define `HttpRequestInterceptor` with context objects:

     ```ts
     interface BeforeSendContext { request: HttpRequestOptions; signal: AbortSignal; }
     interface AfterResponseContext { request: HttpRequestOptions; response: Response; attempt: number; }
     interface OnErrorContext { request: HttpRequestOptions; error: unknown; attempt: number; }
     ```

   - Implement:
     - `runBeforeSend(ctx)` in registration order.
     - `runAfterResponse(ctx)` in **reverse** registration order.
     - `runOnError(ctx)` in **reverse** registration order.

   - Implement a **legacy bridge interceptor** when `beforeRequest` / `afterResponse` are present on `HttpClientConfig`, as per spec.

4. **URL building & legacy pagination fields**

   - Implement URL resolution exactly as described:
     - Prefer `opts.url`.
     - Else `opts.urlParts`.
     - Else legacy `path` + `query`.
   - For legacy pagination fields in `HttpRequestOptions`:
     - If `pageSize` is defined → append `limit` query param.
     - If `pageOffset` is defined → append `offset` query param.
   - Do **not** implement full pagination in core; just these legacy query params.

5. **Complete types & exports**

   - Ensure all core types in the spec are exported from `src/types.ts`:
     - `HttpClientConfig`, `HttpRequestOptions`, `HttpMethod`, `HttpHeaders`, `UrlParts`.
     - `CorrelationInfo`, `AgentContext`, `Extensions`.
     - `ResilienceProfile`, `RequestBudget`, `ErrorCategory`, `ClassifiedError`, `ResponseClassification`, `FallbackHint`.
     - `RateLimitFeedback`, `RequestOutcome`, `MetricsRequestInfo`, `MetricsSink`.
     - `HttpRequestInterceptor` and contexts.
     - `ErrorClassifier`, `HttpError`, `TimeoutError`.

6. **Tests for core**

   - Add or update tests under `libs/resilient-http-core/src/__tests__/` to cover:
     - Retry + backoff timing decisions (no tight retry loops; delay is applied).
     - Caching: hit and miss, metrics `cacheHit` flag.
     - Rate‑limit header parsing into `RateLimitFeedback`.
     - Interceptor ordering (beforeSend order, afterResponse/onError reverse order).
     - Error classification and `HttpError` shape.
     - Tracing integration (mock adapter).
     - Legacy `beforeRequest`/`afterResponse` proxy behaviour.

### Phase 2 — `@airnub/resilient-http-pagination` v0.3

**Target package:** `packages/resilient-http-pagination`

1. **Implement the spec** `resilient_http_pagination_spec_v_0_3.md`:
   - Export public API:
     - `paginate<TItem>(options: PaginateOptions<TItem>): Promise<PaginationResult<TItem>>`.
     - `paginateStream<TItem>(options: PaginateOptions<TItem>): AsyncGenerator<Page<TItem>, PaginationResult<TItem>, void>`.
   - Implement models:
     - `PaginationModel`, `Page<T>`, `PaginationResult<T>`, `PaginationLimits`, `PaginationResilience`, `PaginationObserver`.
     - `PageExtractor<T>`, `PaginationStrategy`.
   - Provide built‑in strategies:
     - Offset/limit, cursor, link‑header.

2. **Core assumptions**
   - Use `HttpClient` from `@airnub/resilient-http-core` only.
   - Do **not** add new behaviour back into core.
   - Propagate correlation, agentContext, and extensions from the initial request to all pages.
   - Aggregate a **run‑level `RequestOutcome`** for the pagination run.

3. **Tests**
   - Use a fake `HttpClient` to simulate paged APIs.
   - Test stop conditions: `maxPages`, `maxItems`, `maxEndToEndLatencyMs`.
   - Test error handling mid‑run and that partial results are represented correctly.

### Phase 3 — `@airnub/resilient-http-policies` v0.3

**Target package:** `packages/resilient-http-policies`

1. **Implement spec** `resilient_http_policies_spec_v_0_3.md`:
   - Core concepts:
     - `PolicyScope`, `RequestClass`, `PolicyRateLimit`, `PolicyConcurrencyLimit`, `PolicyResilienceHints`, `PolicyDefinition`.
     - `PolicyRequestContext`, `PolicyDecision`, `PolicyResultContext`.
     - `PolicyEngine` interface.
   - Implement `InMemoryPolicyEngine`.

2. **Policy‑aware interceptor**
   - Implement `createPolicyInterceptor(config: PolicyInterceptorConfig): HttpRequestInterceptor`:
     - `beforeSend`:
       - Build `PolicyScope` from `HttpRequestOptions`, `AgentContext`, and `extensions`.
       - Call `engine.evaluate()` → `PolicyDecision`.
       - Enforce `allow`/`delay`/`deny` and apply any `resilienceOverrides` to the request.
     - `afterResponse` / `onError`:
       - Build `PolicyResultContext` with `RequestOutcome` + any `RateLimitFeedback`.
       - Call `engine.onResult()`.

3. **Configuration**
   - Support per‑scope policies (by client, operation, provider, model, bucket, etc.).
   - Expose a simple in‑memory config loader for tests.

### Phase 4 — `@airnub/agent-conversation-core` v0.2

**Target package:** `packages/agent-conversation-core`

1. **Implement spec** `resilient_http_agent_conversation_core_spec_v_0_2.md`:
   - Concepts:
     - `Conversation`, `Turn`, `ProviderSession`.
     - `ProviderAdapter` interface (for OpenAI, Anthropic, etc.).
     - `ConversationStore` interface (for in‑memory/Redis/DB storage).
     - `HistoryBuilder` for building provider‑specific message arrays.
     - `ConversationEngine` to drive multi‑turn flows.

2. **Integration with core**
   - All outbound HTTP calls must go through `@airnub/resilient-http-core`.
   - Set `agentContext` and `extensions` appropriately for each turn:
     - `extensions['ai.provider']`, `extensions['ai.model']`, `extensions['ai.request_type']`, etc.

3. **Tests**
   - Use fake `ProviderAdapter`s and a fake `ConversationStore`.
   - Show that multi‑turn flows transform correctly into provider calls and that correlation/agent metadata is set.

### Phase 5 — `@airnub/agent-browser-guardrails` v0.2

**Target package:** `packages/agent-browser-guardrails`

1. **Implement spec** `resilient_http_agent_browser_guardrails_spec_v_0_2.md`:
   - Guardrail concepts:
     - Host allowlist/denylist.
     - Method restrictions (read‑only vs mutating verbs).
     - Path/pattern constraints.
     - Payload size limits.
   - Guardrail engine & selectors (per agent, per tool, etc.).

2. **HttpRequestInterceptor implementation**
   - Implement `createBrowserGuardrailsInterceptor(config): HttpRequestInterceptor`:
     - `beforeSend`: inspect target URL + method + agent/tool metadata from `AgentContext`/`extensions`; throw a descriptive error when a rule is violated.
     - Optionally annotate `extensions` with decision info.

3. **Tests**
   - Verify blocked vs allowed URLs/methods.
   - Verify per‑agent/per‑tool overrides.

### Phase 6 — `@airnub/http-llm-openai` v0.2

**Target package:** `packages/http-llm-openai`

1. **Implement spec** `resilient_http_llm_openai_spec_v_0_2.md`:
   - Implement configuration, client factory, and domain types:
     - `OpenAIHttpClientConfig`, `OpenAIHttpClient`.
     - `OpenAIResponsesClient` with `create` (+ optional `createStream`).
     - `OpenAIResponseObject`, `OpenAIResponseStream`, `OpenAIResponseStreamEvent`.
   - Map:
     - Agent/Provider messages ↔ OpenAI messages.
     - Raw OpenAI Responses API objects ↔ `OpenAIResponseObject`.
     - `previous_response_id` and conversation chaining.

2. **Integration with `agent-conversation-core`**
   - Implement `OpenAIProviderAdapter` that satisfies `ProviderAdapter`.
   - Use `@airnub/resilient-http-core` for all HTTP.
   - Set `extensions['ai.provider'] = 'openai'` and `extensions['ai.model']` appropriately.

3. **Tests**
   - Use fake `HttpClient` to assert request shapes.
   - Verify message/response mapping and `previous_response_id` behaviour.

---

## 4. Consumer Clients (FINRA, SEC, etc.)

After core + satellites are aligned, update client libraries in `libs/` to use the new ecosystem:

- `libs/finra-client`
- Any other HTTP clients present in the repo.

For each client:

1. Inject `HttpClient` from `@airnub/resilient-http-core` via config.
2. Use `requestJson` / `requestText` / `requestRaw` as appropriate.
3. Set `operation` for every request (e.g. `'finra.getShortInterest'`).
4. Pass meaningful `agentContext` and `extensions` where available (e.g. for background jobs vs interactive calls).
5. Use `@airnub/resilient-http-pagination` for any multi‑page APIs instead of hand‑rolled paging.
6. Integrate `@airnub/resilient-http-policies` where you need budgets/rate‑limit enforcement.

Do **not** add FINRA/SEC/UW‑specific logic to core or satellites.

---

## 5. Safety & Regression Guardrails

When refactoring, **do not regress** the following behaviours:

- Caching support for `requestJson` (when configured).
- Retry with backoff and use of `Retry-After`/`suggestedBackoffMs` when provided.
- Rate‑limit feedback parsing into `RateLimitFeedback`.
- Interceptor ordering and ability to mutate requests.
- JSON serialization defaults and `Content-Type` handling.
- Tracing and metrics hooks.
- Legacy pagination fields (`pageSize`, `pageOffset`) behaviour.
- Legacy `beforeRequest` / `afterResponse` hooks via the interceptor bridge.

If you need to change any of the above, adjust the spec **first**, then change the implementation.

---

## 6. Done Definition

You are **done** when:

- `@airnub/resilient-http-core` compiles and is fully aligned with `resilient_http_core_spec_v_0_7.md`.
- All satellite packages compile and match their respective specs.
- The HTTP clients in `libs/` use the new core and satellites where appropriate.
- All tests pass, and you have added new tests for:
  - Core retry/backoff, caching, rate‑limit feedback, interceptors, metrics, tracing.
  - Pagination strategies and limits.
  - Policies engine decisions and interceptor.
  - Agent conversation flows and provider adapters.
  - Browser guardrails blocking/allowing requests.
  - OpenAI HTTP wrapper request/response mapping.
- No package introduces gRPC, heavy resilience frameworks, or telemetry frameworks as dependencies.

Throughout, keep the ecosystem:

> **Core: stable contracts & boring HTTP.**  
> **Satellites: all the interesting, fast‑moving stuff.**

