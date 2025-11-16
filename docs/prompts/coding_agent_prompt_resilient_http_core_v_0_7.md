# CODING_AGENT_PROMPT.md — `@airnub/resilient-http-core` v0.7

## 0. Role & Scope

You are a **senior TypeScript engineer** working in the `tradentic/institutional-rotation-detector` monorepo.

Your job in this prompt is **only** to implement and align the package:

> `@airnub/resilient-http-core` (likely under `libs/resilient-http-core`)

with the **v0.7 core spec**.

Do not touch other packages in this prompt unless strictly necessary to fix type errors. Other packages have their own prompts.

---

## 1. Source of Truth

Treat the following spec as the **single source of truth** for this package:

- Core v0.7 spec:
  - `docs/specs/resilient_http_core_spec_v_0_7.md`

If existing code and the spec disagree, **the spec wins**, but v0.7 explicitly requires preserving key v0.6 behaviours (caching, backoff, rate-limit feedback, etc.).

---

## 2. Global Constraints

- Language: **TypeScript** with `strict: true`.
- Runtime: Node first, but keep browser compatibility in mind.
- Default transport: `fetchTransport` implementing `HttpTransport`.
- **No gRPC** support in this package.
- **No heavy resilience libraries** (resilience4ts, cockatiel, etc.).
- **No telemetry frameworks** as hard dependencies (no OTEL, Prometheus, Datadog).

---

## 3. Implementation Tasks

### 3.1 Types & Public Surface

1. Open `docs/specs/resilient_http_core_spec_v_0_7.md` and carefully inspect all type definitions.
2. In `libs/resilient-http-core/src/types.ts` (or equivalent), ensure all of the following are fully defined and exported exactly as per the spec:
   - HTTP primitives: `HttpMethod`, `HttpHeaders`, `UrlParts`.
   - Metadata: `CorrelationInfo`, `AgentContext`, `Extensions`.
   - Resilience & budgets: `ResilienceProfile`, `RequestBudget`.
   - Errors: `ErrorCategory`, `ClassifiedError`, `ResponseClassification`, `FallbackHint`.
   - Rate limits & outcomes: `RateLimitFeedback`, `RequestOutcome`.
   - Telemetry: `MetricsRequestInfo`, `MetricsSink`, `Logger`, `TracingAdapter`, `TracingSpan`.
   - Core config & options: `HttpClientConfig`, `HttpRequestOptions`.
   - Interceptors & contexts: `BeforeSendContext`, `AfterResponseContext`, `OnErrorContext`, `HttpRequestInterceptor`.
   - Error primitives: `ErrorClassifier`, `HttpError`, `TimeoutError`.
   - Optional helpers: `HttpCache`, `HttpRateLimiter`, `CircuitBreaker` (if defined in the spec).

3. Ensure all types match the **field names and semantics** in the v0.7 spec, including legacy fields (e.g. `pageSize`, `pageOffset`, `budget`, `maxEndToEndLatencyMs`).

### 3.2 `HttpClient` Behaviour

Refactor `HttpClient.ts` so that its behaviour **exactly matches** the v0.7 spec while preserving v0.6 features.

Key requirements:

1. **URL handling**
   - Implement resolution order:
     1. `opts.url` (absolute URL) if present.
     2. `opts.urlParts` (baseUrl + path + query) if present.
     3. Legacy `path` + `query` + `pageSize`/`pageOffset` if present.
   - Handle absolute `path` (starting with `http` or a full URL) correctly.
   - Append `pageSize` → `limit` and `pageOffset` → `offset` query parameters to preserve v0.6 behaviour.

2. **Request options merging**
   - Implement `HttpClientConfig.defaultResilience` and `HttpClientConfig.defaultAgentContext`.
   - On each request:
     - Merge resilience from default → operation defaults (if present) → request-specific `resilience` → legacy `budget`.
     - Build/ensure `correlation: CorrelationInfo` with a guaranteed `requestId`.
     - Merge `agentContext` from default + request.

3. **Resilience, retries & deadlines**
   - Implement the execution model from the spec:
     - `maxAttempts` from `ResilienceProfile` (and legacy `RequestBudget.maxAttempts`).
     - `overallTimeoutMs` from resilience and legacy `maxEndToEndLatencyMs` / `RequestBudget.maxTotalDurationMs`.
     - `perAttemptTimeoutMs` enforced via `AbortController`.
   - For each attempt:
     - Respect the overall deadline and per-attempt timeout.
     - Call `rateLimiter.throttle(key, ctx)` and `circuitBreaker.beforeRequest(key)` when configured.
     - Run `beforeSend` interceptors.
     - Execute the HTTP request with the merged options.
     - Run classification and determine whether the response is an error.
     - Decide retry vs fail using:
       - `ClassifiedError.retryable` when available.
       - Fallback on `ErrorCategory` heuristics otherwise.
       - Respect `ResilienceProfile.retryEnabled` and `maxAttempts`.
     - Sleep between attempts using the backoff algorithm (see below).

4. **Backoff & retry delay**
   - Implement **exponential backoff with jitter** as described in the v0.7 spec.
   - Use the precedence:
     - If `ClassifiedError.suggestedBackoffMs` is set, prefer it.
     - Else, if `Retry-After` header is set, use its parsed value.
     - Else, exponential backoff based on `ResilienceProfile.baseBackoffMs`, `maxBackoffMs`, `jitterFactorRange`.
   - Never spin in a tight retry loop — there must always be a delay between retryable attempts.

5. **Caching (v0.6 behaviour)**
   - Implement `HttpCache` semantics for `requestJson<T>`:
     - Only use cache when `config.cache`, `opts.cacheKey`, and `opts.cacheTtlMs > 0` are present.
     - On cache hit:
       - Return cached value directly.
       - Emit metrics with `cacheHit: true` and `RequestOutcome` representing a zero-duration, zero-attempt success.
     - On miss or cache error:
       - Proceed with normal resilience flow.
       - After a successful fetch, schedule `cache.set(cacheKey, result, cacheTtlMs)`.
       - Never fail the HTTP request due to cache errors.

6. **Body serialization & headers**
   - If `opts.body` is a plain object or array:
     - Serialize to JSON and set `Content-Type: application/json` if no content-type header is present.
   - If `opts.body` is already a `BodyInit`, pass it through unchanged.
   - Set a sensible default `Accept: application/json` unless overridden.

7. **Error classification & HttpError**
   - Implement or use a `DefaultErrorClassifier` that conforms to the spec.
   - Integrate classification for:
     - Network errors (including `TimeoutError` and `AbortError`).
     - HTTP responses.
   - Build `HttpError` instances on final failure with:
     - `status`, `category`, `fallback`, `headers`, `response`.
     - Optional decoded `body` (JSON or text when cheap to read).
     - `correlation` and `agentContext` fields.

8. **Rate-limit feedback**
   - Implement a function that reads headers like:
     - `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `x-ratelimit-reset-requests`.
     - `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-tokens`, `x-ratelimit-reset-tokens`.
     - `retry-after`.
   - Populate a `RateLimitFeedback` structure attached to the final `RequestOutcome`.

9. **Interceptors**
   - Implement `HttpRequestInterceptor` with context objects:
     - `BeforeSendContext`, `AfterResponseContext`, `OnErrorContext`.
   - Implement `runBeforeSend` in registration order and `runAfterResponse` / `runOnError` in **reverse registration order**.
   - Interceptors must be able to mutate `ctx.request` in place.
   - Errors thrown by interceptors should be logged via `Logger` and swallowed unless the spec explicitly requires propagation.

10. **Legacy hooks bridging**
    - If `HttpClientConfig.beforeRequest` or `afterResponse` is set, construct a `HttpRequestInterceptor` that:
      - Calls `beforeRequest(request)` in `beforeSend`.
      - Calls `afterResponse(request, response)` in `afterResponse`.
    - Append this interceptor **after** user-specified interceptors so user interceptors run first.

11. **RateLimiter & CircuitBreaker hooks**
    - Ensure the client calls:
      - `rateLimiter.throttle(key, ctx)` before each attempt.
      - `rateLimiter.onSuccess(key, ctx)` / `rateLimiter.onError(key, err, ctx)` appropriately.
      - `circuitBreaker.beforeRequest(key)` / `onSuccess(key)` / `onFailure(key, err)` appropriately.

12. **Metrics & tracing**
    - Emit exactly one `MetricsRequestInfo` per logical request, with fields specified in the spec, including the final `RequestOutcome`.
    - Integrate `TracingAdapter`:
      - Start a span for each logical request.
      - Attach client, operation, method, URL, correlation IDs, agent labels, and extensions as attributes.
      - Call `recordException` on error and always `end` the span.

---

## 4. Tests

Add or update tests under `libs/resilient-http-core/src/__tests__/` to cover at least:

- Retry and backoff behaviour (ensure delays, not tight loops).
- Per-attempt vs overall timeout behaviour.
- Caching semantics (hit/miss, metrics, error resilience).
- Rate-limit feedback parsing from common headers.
- Interceptor ordering and ability to mutate requests.
- Legacy hooks (`beforeRequest`, `afterResponse`) bridging via interceptors.
- Error classification for network, timeout, auth, validation, not-found, quota, rate-limit, and 5xx.
- Metrics and tracing integration with mocks.

---

## 5. Done Definition

You are **done** for this prompt when:

- `@airnub/resilient-http-core` builds cleanly.
- The public types and behaviour match `resilient_http_core_spec_v_0_7.md`.
- All v0.6 behaviours explicitly preserved by the spec (caching, rate-limit feedback, legacy pagination fields, legacy hooks, tracing) are working and covered by tests.
- There are no gRPC, heavy resilience libraries, or telemetry frameworks introduced as dependencies.

Do not modify other packages or specs in this prompt.

