# Resilient HTTP Core — Spec Evolution & Critique (v0.1 → v0.7)

> This document captures how `@airnub/resilient-http-core` evolved from the earlier specs (up to **v0.6**) to the **v0.7** design, and evaluates whether v0.7 addresses the issues identified in the v0.6 critique.
>
> It is intended as a *meta-spec* / ADR-style record for humans and coding agents.

---

## 1. Context & Goals

### 1.1 Original goals (pre–v0.7)

The core library was always intended to:

- Provide a **boring, reusable HTTP substrate** for all clients.
- Centralise **resilience** (timeouts, retries, backoff, rate limiting, circuit breaking).
- Expose **telemetry hooks** (logging, metrics, tracing) without hard dependencies.
- Carry rich **metadata** for AI/agents (correlation IDs, agent context, extensions).

The v0.6 spec + implementation got close but accumulated some design debt, especially around hooks, resilience layering, and the shape of `HttpRequestOptions`.

### 1.2 v0.6 critique — headline findings

The v0.6 review (captured in the previous `resilient_http_core_spec_evolution_and_critique` doc) highlighted several issues:

1. **Two overlapping hook systems**:
   - `beforeRequest` / `afterResponse` on the config.
   - `HttpRequestInterceptor` chain.
   - Ordering and responsibilities were unclear.

2. **Overlapping resilience layers**:
   - Local retries/backoff/timeouts inside `HttpClient`.
   - A `policyWrapper` capable of its own retries/budgets.
   - A separate `budget` object and `resilience` hints.

3. **`HttpRequestOptions` as a kitchen sink**:
   - Mixed URL building, resilience knobs, metadata, and pagination hints.

4. **Metadata fragmentation**:
   - `AgentContext`, ad‑hoc telemetry fields, and `extensions` were all present with fuzzy guidance.

5. **Unclear extensibility** for policies and providers:
   - `policyWrapper` was powerful but ambiguous.
   - Rate-limit feedback was somewhat provider-flavoured.

6. **Metrics & rate limit semantics**:
   - Unclear whether metrics were per attempt or per logical request.
   - `RateLimitFeedback` parsing was tightly coupled to specific headers.

7. **Pagination and domain concerns leaking into core**.

The v0.7 spec and new `HttpClient` are an explicit attempt to address these.

---

## 2. Hooks & Interceptors

### 2.1 Problem in v0.6

- Two parallel systems:
  - Config-level hooks: `beforeRequest`, `afterResponse`.
  - Interceptor chain: `HttpRequestInterceptor.beforeSend`, `.afterResponse`, `.onError`.
- Behavioural questions:
  - Which runs first?
  - Do interceptors see cache hits, classification, and retries?
  - Do some code paths bypass interceptors entirely?

### 2.2 v0.7 design

- **Interceptors are canonical.**
  - `HttpClient` maintains a single `interceptors: HttpRequestInterceptor[]` array.
  - It always executes:
    - `beforeSend` in registration order.
    - `afterResponse` and `onError` in reverse order.

- **Legacy hooks are adapted into an interceptor**:
  - The constructor appends a bridge interceptor via `buildLegacyInterceptor(config)`.
  - This adapter calls `config.beforeRequest` and `config.afterResponse` from inside interceptor callbacks.

### 2.3 Evaluation

- The ambiguity and duplication from v0.6 are **resolved**:
  - There is a single pipeline.
  - Interceptors are the main extension mechanism.
  - Legacy hooks are clearly secondary and implemented on top of interceptors.
- Follow‑up recommendation:
  - Explicitly document in the v0.7 spec that `beforeRequest`/`afterResponse` are considered legacy and that new code should use interceptors.

**Status:** ✅ **Issue addressed.**

---

## 3. Resilience Layer & `policyWrapper`

### 3.1 Problem in v0.6

- The `HttpClient` had its own internal retry/backoff/timeout logic.
- A `policyWrapper` could wrap each attempt and apply further logic.
- A `budget` object and `resilience` hints co-existed.
- This made it easy to accidentally implement:
  - Double retries.
  - Conflicting time budgets.
  - Hard-to-reason-about behaviour under load.

### 3.2 v0.7 design

- **`policyWrapper` has been removed** from the core client.
- Resilience is governed by a unified `ResilienceProfile`:
  - `maxAttempts`
  - `retryEnabled`
  - `perAttemptTimeoutMs`
  - `overallTimeoutMs`
  - (plus backoff knobs as defined in the 0.7 spec).
- The retry loop in `requestRaw`:
  - Reads `ResilienceProfile` once per request.
  - Uses per-attempt timeout with `AbortController`.
  - Enforces overall deadline.
  - Uses `ErrorClassifier` and `ErrorCategory` to decide retry vs fail.

- **Rate limiter & circuit breaker are advisory hooks only**:
  - `rateLimiter.throttle` / `onSuccess` / `onError`.
  - `circuitBreaker.beforeRequest` / `onSuccess` / `onFailure`.
  - They do not own retries or budgets.

### 3.3 Evaluation

- The overlapping resilience layers are now **collapsed** into one clear model:
  - Single `ResilienceProfile` per request.
  - No `policyWrapper` inside core.
- Higher-level policy engines can still exist, but are implemented as satellites or interceptors, not by wrapping the retry loop.

**Status:** ✅ **Issue addressed.**

---

## 4. `HttpRequestOptions` Shape

### 4.1 Problem in v0.6

- `HttpRequestOptions` mixed:
  - URL construction (`baseUrl`, `path`, `query`, `pageSize`, `pageOffset`).
  - Timeouts, retries, budgets, resilience hints.
  - Metadata (IDs, correlation, agent info, tags).
  - Pagination hints that really belonged in a satellite.

### 4.2 v0.7 design

- URL handling is structured:
  - `url?: string` (fully resolved URL wins).
  - `urlParts?: { baseUrl?: string; path?: string; query?: Record<string, unknown> }`.
  - Core merges `url`/`urlParts` with the client’s `baseUrl`.

- Resilience is encapsulated in:
  - `resilience?: ResilienceProfile`.

- Metadata is structured:
  - `correlation?: CorrelationInfo`.
  - `agentContext?: AgentContext`.
  - `extensions?: Record<string, unknown>`.

- Pagination concerns are removed from core:
  - Fields like `pageSize`, `pageOffset` are no longer part of the core options and instead belong in the pagination satellite.

### 4.3 Evaluation

- `HttpRequestOptions` is still rich, but now **coherent**:
  - URL concerns separated from resilience and metadata.
  - No pagination or domain-specific concerns.
  - Clean structuring of correlation and agent context (see next section).

**Status:** ✅ **Issue mostly addressed.**

The remaining risk is the natural tendency for downstream code to keep adding fields here; the v0.7 spec should continue to push domain-specific knobs into satellites/interceptors.

---

## 5. Metadata: Correlation, AgentContext, Extensions

### 5.1 Problem in v0.6

- Metadata could be attached in multiple places:
  - Fields like `requestId` / `correlationId` directly on the request.
  - `AgentContext` with `agent`, `runId`, `labels`, `metadata`.
  - Free-form `extensions` for tagging.
- It wasn’t obvious what belonged where, especially for AI/LLM use-cases.

### 5.2 v0.7 design

- **Correlation info**:
  - `correlation?: CorrelationInfo` with:
    - `requestId`
    - `correlationId`
    - `parentCorrelationId`
  - `ensureCorrelation()` guarantees a `requestId` using `crypto.randomUUID()` if absent.

- **Actor context**:
  - `agentContext?: AgentContext`.
  - Merged with `defaultAgentContext` in `prepareRequestOptions()`.

- **Free-form tags**:
  - `extensions?: Record<string, unknown>`.

- Metrics receive a consolidated view:

  ```ts
  MetricsRequestInfo = {
    clientName,
    operation,
    method,
    url,
    status,
    errorCategory,
    durationMs,
    attempts,
    correlation,
    agentContext,
    extensions,
    rateLimitFeedback,
  };
  ```

### 5.3 Evaluation

- The roles are now clear:
  - `correlation` → trace & causality.
  - `agentContext` → which agent/run is calling.
  - `extensions` → domain labels (`ai.provider`, `ai.model`, `traffic.class`, `tenant`, etc.).

**Status:** ✅ **Issue addressed.**

Follow‑up suggestion: define a small recommended set of `extensions` keys for AI/LLM usage in the satellite specs (OpenAI wrapper, agent conversation core), not in core.

---

## 6. Policies & `policyWrapper`

### 6.1 Problem in v0.6

- `policyWrapper` allowed arbitrary wrapping of the request execution.
- It could inadvertently duplicate retry logic or override time budgets.
- It blurred the separation between core resilience and higher-level policies.

### 6.2 v0.7 design

- `policyWrapper` is **removed** from core.
- Policies are intended to be implemented as:
  - Interceptors that adjust `resilience`/delay/deny.
  - Satellite library (`@airnub/resilient-http-policies`) with a `PolicyEngine` and `createPolicyInterceptor`.

### 6.3 Evaluation

- The separation of concerns is much cleaner:
  - Core: resilience, telemetry, hook contracts.
  - Satellite: policies & budgets.

**Status:** ✅ **Issue addressed.**

---

## 7. Metrics & Rate Limit Semantics

### 7.1 Problem in v0.6

- Ambiguity about whether metrics were:
  - Per attempt, or
  - Per logical request.
- `RateLimitFeedback` and rate-limit header parsing were somewhat tangled with provider specifics.

### 7.2 v0.7 design

- **Metrics are per logical request**:
  - `requestRaw` maintains a single `RequestOutcome` per logical request.
  - `recordMetrics(prepared, outcome)` is called once after all attempts.
  - Attempts are captured by `outcome.attempts` and used for analysis.

- **Rate-limit feedback**:
  - Structured via `ErrorCategory` and `ClassifiedError`.
  - `RateLimitFeedback` is attached to `RequestOutcome` when appropriate.
  - Detailed header parsing can be delegated to:
    - `ErrorClassifier`, or
    - Provider-specific wrappers (e.g. OpenAI satellite).

### 7.3 Evaluation

- Semantics are now clear and provider-agnostic:
  - 1 metrics event per logical request.
  - Attempts and backoff details are captured but not exploded into multiple metric rows.

**Status:** ✅ **Issue addressed.**

---

## 8. Interceptors as the Plugin Mechanism

### 8.1 Problem in v0.6

- Interceptors existed but competed with config hooks and `policyWrapper`.
- It was unclear whether they were the canonical extension point for pagination, policies, guardrails, etc.

### 8.2 v0.7 design

- Interceptors are the primary mechanism for:
  - **Policies** (via `resilient-http-policies`).
  - **Browser/tool guardrails** (via `agent-browser-guardrails`).
  - **Telemetry adapters** (logging, metrics, tracing wiring).
  - Optional caching layers.

- Interceptors operate with clear context structs:
  - `BeforeSendContext`.
  - `AfterResponseContext`.
  - `OnErrorContext`.

### 8.3 Evaluation

- The design now encourages:
  - Thin core.
  - Rich satellites that plug in via interceptors.

**Status:** ✅ **Issue addressed.**

---

## 9. Out-of-the-box Experience & Template Stacks

### 9.1 Goal from the critique

- Provide:
  - A **default client factory** for a zero-config experience.
  - A few **opinionated stacks** (e.g. Node logging + OTEL + policies) as copy-paste recipes or helpers.

### 9.2 v0.7 status

- 0.7’s contracts make this **easy** to do:
  - `defaultResilience`, `defaultAgentContext`, structured `MetricsRequestInfo`.
  - Interceptors for logging, policies, guardrails.

- However, as of the v0.7 code:
  - There is no explicit `createDefaultHttpClient` or stack helper yet.
  - These are mentioned in the roadmap, not implemented as stable APIs.

### 9.3 Evaluation

- The **structural blockers are gone**, but the DX work remains.
- Recommended for a future version (v0.8+):
  - Define and implement:
    - `createDefaultHttpClient(config)`.
    - A small set of `createNodeStackHttpClient(config)` recipes in satellite or companion packages.

**Status:** ⚠️ **Partially addressed (design-ready, not yet implemented).**

---

## 10. Satellite Libraries & Core Boundaries

### 10.1 Goals

- Keep core focused on *single-request HTTP*.
- Move higher-level concerns to satellites:
  - Pagination.
  - Policies & budgets.
  - Agent/LLM conversation semantics.
  - Provider-specific wrappers.
  - Browser/tool guardrails.

### 10.2 v0.7 impact

- Core no longer exposes pagination fields or semantics.
- `ResilienceProfile`, `ErrorClassifier`, interceptors, and metadata types are designed to support satellites cleanly.
- Satellite specs (pagination v0.3, policies v0.3, conversation core v0.2, OpenAI v0.2, browser guardrails v0.2) are written to:
  - Consume core’s types.
  - Use interceptors instead of forking logic.

### 10.3 Evaluation

- Core is now a **clean foundation** for the satellite family.
- Remaining work is primarily satellite implementation and polish, not core redesign.

**Status:** ✅ **Core-side issues addressed.**

---

## 11. New v0.7 Considerations & Migration Notes

While v0.7 fixes the v0.6 issues, it introduces some **intentional breaking changes** and design choices that should be documented.

### 11.1 ErrorCategory naming

- Older categories used snake_case strings (e.g. `'rate_limit'`).
- v0.7 uses more idiomatic names (e.g. `'rateLimit'`, `'transient'`).
- Any downstream logic matching on `ErrorCategory` must be updated.

**Action:**
- Document the canonical `ErrorCategory` values in the v0.7 spec.
- Provide a simple mapping table for migrations.

### 11.2 Caching

- v0.6 had built-in caching in `requestJson` using `HttpCache` and `cacheKey/cacheTtlMs` fields.
- The v0.7 `HttpClient` implementation shown does **not** include cache integration.

**Decision needed:**

- Either:
  - Move caching entirely into a satellite/interceptor package; or
  - Reintroduce a **small, interceptor-based cache integration** with clear semantics.

Given the core’s mandate to stay small and boring, **pushing caching into a satellite** is a reasonable choice, but it should be explicitly stated.

### 11.3 UUID generation

- `ensureCorrelation()` uses `crypto.randomUUID()`.
- This requires runtimes with crypto support (Node 18+ or modern browsers).

**Action:**
- Document the minimum supported runtimes.
- Optionally, add a `requestIdFactory` to `HttpClientConfig` to override ID generation when needed.

### 11.4 Metrics format changes

- `MetricsRequestInfo` changed shape between v0.6 and v0.7.
- Metrics adapters (OTEL, Prometheus, etc.) must adjust accordingly.

**Action:**
- Document the new `MetricsRequestInfo` type in the v0.7 spec.
- Provide migration guidance for existing adapters.

---

## 12. Overall Verdict

### 12.1 Which v0.6 issues are fixed?

The v0.7 spec + implementation effectively address the major v0.6 critique points:

- ✅ Dual hook systems → unified interceptor pipeline with legacy adapter.
- ✅ Overlapping resilience layers → single `ResilienceProfile` model; `policyWrapper` removed.
- ✅ Kitchen-sink `HttpRequestOptions` → structured URL, resilience, and metadata; pagination removed.
- ✅ Metadata fragmentation → clear split into `CorrelationInfo`, `AgentContext`, and `extensions`.
- ✅ Policy ambiguity → policies live in satellites/interceptors, not core.
- ✅ Metrics semantics → per logical request, with aggregated `RequestOutcome`.
- ✅ Interceptors as plugins → now clearly the primary extension point.

### 12.2 What remains open?

- ⚠️ **Out-of-the-box stacks** — not yet implemented, but the design is ready.
- ⚠️ **Caching story** — needs a deliberate decision (core vs interceptor vs satellite).
- ⚠️ **Migration documentation** — error category names, metrics shape, and runtime assumptions should be spelled out.

### 12.3 Recommended next steps

1. **Lock the v0.7 surface** as the stable contract for satellites.
2. **Write a short migration doc** (v0.6 → v0.7) referencing this critique.
3. **Decide the caching strategy** (and update specs accordingly).
4. **Introduce at least one default client factory** (even if very small) to improve first-run DX.

Once those are in place, `@airnub/resilient-http-core` will be in a strong position to serve as a long-lived foundation for both enterprise HTTP clients and AI/agent workflows, with satellites providing the fast-moving, opinionated features around it.

