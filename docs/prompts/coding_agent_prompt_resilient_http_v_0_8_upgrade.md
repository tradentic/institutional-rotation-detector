# Coding Agent Prompt — Upgrade Resilient HTTP Core to v0.8 (Evolution, Not Rewrite)

## 0. Role & Mindset

You are a **senior TypeScript library engineer** and **spec‑driven coding agent**.

Your job is to:

1. **Ingest and strictly follow** the v0.8 core spec document:
   - `docs/specs/resilient_http_core_spec_v_0_8.md`
2. **Treat v0.8 as an evolution of v0.7, not a rewrite.**
3. Systematically upgrade the existing `@airnub/resilient-http-core` implementation to be **v0.8 compliant** while **preserving all v0.7 behaviours**.

You are making a **controlled refactor**, not designing a new HTTP client from scratch.

---

## 1. Hard Guardrails (Non‑Negotiable Rules)

Before you plan or change any code, internalise these rules. Violating them means your plan is wrong.

### 1.1 Evolution, not rewrite

- You MUST **reuse the existing v0.7 HttpClient execution pipeline**:
  - The core retry/backoff loop.
  - How per‑attempt and overall timeouts are applied.
  - Where rate limiting and circuit breaking are invoked.
  - How metrics and tracing are emitted.
- You MUST NOT:
  - Delete or completely replace `HttpClient.ts`.
  - Introduce a brand‑new `HttpClient` implementation divorced from the current pipeline.
  - Change the signatures of existing public helpers (`requestJson`, `requestText`, `requestArrayBuffer`, `requestRaw`).

### 1.2 Preserve resilience behaviours

You MUST preserve all of these behaviours from v0.7:

- **Retry & backoff** driven by `ResilienceProfile` (and legacy `RequestBudget`).
- **Rate limiting** via `HttpRateLimiter` (or equivalent rate‑limiter hooks).
- **Circuit breaking** via `CircuitBreaker` (or equivalent circuit‑breaker hooks).
- **Caching** via `HttpCache`, `cacheKey`, `cacheTtlMs`.
- **Error classification** into `ErrorCategory` and `HttpError`.
- **Telemetry** via `MetricsSink`, `Logger`, `TracingAdapter`.

You MAY refactor *how* these are wired (e.g. adjust types to match the v0.8 spec), but you MUST NOT remove any of these behaviours.

### 1.3 Do not delete key types / hooks

You MUST NOT delete or stub out the following without a clearly documented, equivalent replacement that preserves behaviour:

- `HttpRateLimiter` (and any associated context types).
- `CircuitBreaker`.
- Any retry/backoff implementation that enforces `maxAttempts`, timeouts, and backoff.
- `HttpCache`.
- Legacy hooks: `beforeRequest`, `afterResponse`, `policyWrapper`.

For legacy hooks, you MUST:

- Implement them via a **bridge interceptor** (as described in the v0.8 spec), not by removing them.

### 1.4 Only additive or shaping changes

You MAY:

- Align types and interfaces to the v0.8 spec.
- Add new helper methods, types, and internal utilities.
- Introduce new `*Response` helpers that return `HttpResponse<T>`.
- Introduce `HttpTransport` abstractions and test transports.

You MUST NOT:

- Break or remove existing public methods.
- Change what existing public methods return.
- Remove behaviours that the v0.7 spec and implementation provided.

If in doubt, **prefer migration/adaptation over deletion**.

---

## 2. Inputs You Must Read First

Before touching code, you MUST carefully read:

1. `docs/specs/resilient_http_core_spec_v_0_8.md`
   - This is the **canonical v0.8 spec**.
   - It explicitly states that v0.8 is an **evolution of v0.7** and that v0.7 behaviours must remain.
2. The existing v0.7 implementation of `@airnub/resilient-http-core` in this repo, especially:
   - `HttpClient.ts` (or equivalent core file).
   - `types.ts` / `interfaces.ts` (core types).
   - Any files defining `HttpRateLimiter`, `CircuitBreaker`, `HttpCache`, `MetricsSink`, `TracingAdapter`.

You will be aligning the implementation to the v0.8 spec **without discarding** the v0.7 behaviour.

---

## 3. Repository & Scope

- Repo: the current workspace (monorepo) that contains `@airnub/resilient-http-core`.
- Focus package for this prompt:
  - `libs/resilient-http-core/**` (or equivalent path containing `HttpClient`, types, and config).

You MAY touch satellite packages later, but this prompt is focused on **core**.

---

## 4. Safety Check Before Planning

Before generating an implementation plan, perform this mental checklist:

If your plan includes any of the following, **stop and revise**:

1. “Delete `HttpClient.ts` and create a new implementation.”
2. “Remove `HttpRateLimiter` / `CircuitBreaker` because v0.8 spec doesn’t mention them explicitly.”
3. “Change `requestJson<T>` to return `HttpResponse<T>` instead of `T`.”
4. “Remove `RequestBudget`, legacy pagination fields, or legacy hooks without implementing compatibility.”

If any of these are present, you are treating v0.8 as a **rewrite**, which is explicitly forbidden.

Only once you have a plan that avoids these anti‑patterns should you proceed.

---

## 5. Phase 1 — Inventory Current Implementation vs v0.8 (With Guardrails)

### 5.1 Map current types and APIs

1. Locate the following in the codebase:
   - `HttpClient` class and its public methods.
   - `HttpRequestOptions`, `ResilienceProfile`, `RequestBudget`.
   - `ErrorCategory`, `ErrorClassifier`, `HttpError`, `TimeoutError`.
   - `HttpRateLimiter` and related context types.
   - `CircuitBreaker`.
   - `HttpCache` and caching settings (`cacheKey`, `cacheTtlMs`).
   - `MetricsSink`, `Logger`, `TracingAdapter`.
   - Legacy hooks: `beforeRequest`, `afterResponse`, `policyWrapper`.

2. Compare each of these against the v0.8 spec and create a **diff list**:
   - Fields/props that exist in code but not in spec.
   - Fields defined by spec but missing in code.
   - Shape differences (e.g. type names, optional vs required).

### 5.2 Classify differences as “shape” vs “behaviour”

For each difference, decide:

- **Shape differences** (allowed):
  - Types or field names that can be safely refactored without changing behaviour.
  - Example: rename or extend an error classifier type to match the spec, while keeping logic the same.

- **Behaviour differences** (dangerous):
  - Anything that would change:
    - When/if we retry.
    - How we backoff.
    - Whether we enforce timeouts.
    - Whether we apply rate limiting or circuit breaking.
    - Whether we touch the cache.

Your plan MUST **only change shapes**, not behaviours, unless the v0.8 spec explicitly calls out a behaviour bugfix.

---

## 6. Phase 2 — Type & Interface Alignment (Shape‑Only)

Your first code changes should be **types-only or mostly type‑level**.

### 6.1 Align types to v0.8 spec

1. Update type declarations to match `resilient_http_core_spec_v_0_8.md`:
   - `HttpRequestOptions`, `ResilienceProfile`, `RequestBudget`, `ErrorCategory`, `ClassifiedError`, `RequestOutcome`, `RateLimitFeedback`, `CorrelationInfo`, `AgentContext`, `Extensions`.
2. When aligning types:
   - Prefer extending existing types and keeping fields, rather than deleting fields.
   - For fields that spec marks as legacy/compat but still required, keep them and document them.

3. Introduce the new `HttpResponse<T>` type as per the v0.8 spec:
   - `status`, `headers`, `body`, `correlation`, `agentContext`, `extensions`, `outcome`.
   - This is **additional**; do not change existing methods to use it yet.

### 6.2 Introduce HttpTransport abstraction

1. Add the `HttpTransport` interface from the spec.
2. Implement a default `fetchTransport` that calls global `fetch`.
3. Update `HttpClient` internal code to use `transport` instead of directly calling `fetch`.
4. Keep the behaviour identical (same RequestInit, same error/timeout semantics).

At this stage, behaviour must still match v0.7.

---

## 7. Phase 3 — Additive Helpers (No Breakage)

### 7.1 `*Response` helpers

1. Implement:
   - `requestJsonResponse<T>(opts): Promise<HttpResponse<T>>`.
   - `requestTextResponse(opts): Promise<HttpResponse<string>>`.
   - `requestArrayBufferResponse(opts): Promise<HttpResponse<ArrayBuffer>>`.

2. Each `*Response` helper MUST:
   - Delegate to the existing pipeline (e.g. via `requestRaw` or the same core execution function).
   - Build `HttpResponse<T>` by:
     - Decoding the body as in the legacy helper.
     - Computing a `RequestOutcome` based on the same metrics data used today.
   - **Not change** how existing helpers work.

3. Do **not** modify `requestJson<T>` or other existing helpers: they must still return plain `T` or `string` etc.

---

## 8. Phase 4 — Legacy Hook Bridge & Interceptor Model

### 8.1 Bridge legacy hooks to interceptors

1. Implement a **bridge interceptor** which:
   - Calls `beforeRequest` on `beforeSend`.
   - Calls `afterResponse` on `afterResponse`.
2. Ensure this interceptor is only added when these hooks exist in config.
3. Ensure it is added **after user interceptors** so modern interceptors run first.

### 8.2 Preserve policyWrapper semantics

1. Wrap the **entire request execution loop** inside `policyWrapper` when provided, exactly as v0.7 does.
2. Do not move policy logic into interceptors unless you are preserving the same behaviour.

---

## 9. Phase 5 — Resilience, RateLimiter, CircuitBreaker (Behaviour‑Preserving Refactor)

### 9.1 Document current behaviour first

Before changing any resilience code, document (in comments or notes):

- Where retries are implemented (`executeWithRetries` or equivalent).
- When `HttpRateLimiter` is invoked (pre‑attempt, post‑attempt).
- When `CircuitBreaker` is invoked.
- How backoff is calculated.

Do **not** change this logic unless the v0.8 spec explicitly calls out a bug.

### 9.2 Align signatures, not semantics

1. If the v0.8 spec suggests specific shapes for rate limiter / circuit breaker contexts, adapt your existing types to them **without changing call sites’ meaning**.
2. If you need to rename methods or parameters, do so, but keep when/why they’re called identical.
3. If the spec expects additional error classification hints, extend your existing classifier; don’t remove existing logic.

### 9.3 Verify resilience behaviour with tests

Add or update tests to ensure that after refactoring:

- Same number of attempts are made for the same failure scenarios.
- Timeouts still occur as before.
- Rate‑limited responses still respect backoff / retryAfter.
- Circuit breaker still opens/closes as before.

---

## 10. Phase 6 — Caching, Metrics, Tracing

### 10.1 Caching

- Ensure `HttpCache`, `cacheKey`, `cacheTtlMs` are still used exactly as in v0.7.
- Only adjust type shapes to match the spec.
- Add tests for cache hit/miss, TTL expiry, and error handling.

### 10.2 Metrics & Tracing

- Align `MetricsRequestInfo` and `TracingAdapter` types with the spec.
- Verify that:
  - Metrics are still emitted once per logical request.
  - Spans are started and ended as before.
  - Correlation and agent metadata flow through unchanged.

---

## 11. Phase 7 — `createDefaultHttpClient`

1. Implement or update `createDefaultHttpClient(options)` exactly as the v0.8 spec defines.
2. It MUST:
   - Use `fetchTransport`.
   - Set sane default resilience.
   - Use the default error classifier.
   - **Not** attach any external dependencies (no Redis, no OTEL by default).

This function is additive and must not change existing client constructors.

---

## 12. Final Validation

Before considering the upgrade complete:

1. Ensure all public APIs from v0.7 still exist with the same signatures.
2. Ensure all v0.7 behaviours (retry, backoff, rate limiting, circuit breaking, caching, metrics, tracing) still work.
3. Ensure all new v0.8 types and helpers are present and aligned with the spec.
4. Run the full TypeScript build under `strict`.
5. Run the full test suite and add tests where gaps exist.

If any step required changing a behaviour, ensure it is explicitly justified by the v0.8 spec (e.g. to fix a bug) and documented in a changelog.

---

## 13. Summary for the Coding Agent

- **Do not rewrite HttpClient.** Refactor it to align with the v0.8 spec while keeping the existing resilience pipeline.
- **Do not delete rate limiter or circuit breaker logic.** Adapt their types and wiring to match the spec.
- **Do not break existing method signatures.** Add new helpers instead.
- **Use the v0.8 spec as the shape authority and v0.7 implementation as the behaviour authority.**

Only when both shape and behaviour are aligned are you done.

