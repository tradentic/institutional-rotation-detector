# `@tradentic/resilient-http-core` — Spec v0.6

**Status:** Draft for implementation  \
**Previous:** v0.5  \
**Scope:** Extend the HTTP core to be the preferred resilience layer for AI agents and traditional systems, while preserving provider-agnostic, library-agnostic design.

v0.6 builds directly on v0.5:

- All v0.5 semantics (AgentContext shape, correlation IDs on HttpRequestOptions, OPTIONS support, telemetry wiring) remain valid unless explicitly amended here.
- v0.6 adds new abstractions for **resilience profiles**, **error classification**, **rate-limit feedback**, **request outcomes**, and **interceptors**, with a focus on AI-agent use cases.

---

## 1. Goals for v0.6

v0.6 turns `@tradentic/resilient-http-core` into a **first-class resilience substrate for AI agents** while remaining:

- HTTP-focused and provider-agnostic.
- Lightweight and dependency-minimal.
- Extensible via hooks and satellite libraries (e.g. `@airnub/agent-conversation-core`, `@airnub/resilient-http-policies`, `@airnub/resilient-http-pagination`).

Concretely, v0.6 introduces:

1. **Resilience profiles per request**  \
   A small `ResilienceProfile` attached to each `HttpRequestOptions` to describe latency budgets, allowed attempts, and failover preferences.

2. **Pluggable error classifiers**  \
   An `ErrorClassifier` interface that converts provider-specific responses/errors into a small set of categories (transient, rate limit, validation, auth, safety, quota, unknown) plus retry hints.

3. **Rate-limit feedback in metrics**  \
   Structured `RateLimitFeedback` attached to `MetricsRequestInfo`, allowing observers to auto-tune concurrency or budgets based on provider headers.

4. **Request outcome metadata**  \
   A compact `RequestOutcome` object summarizing attempts, duration, and error category for each request.

5. **Interceptors for before/after/error hooks**  \
   A simple `HttpRequestInterceptor` chain that allows higher-level libraries to inject headers, enforce safety policies, or transform responses without altering the core client logic.

6. **Recommended extension key conventions for AI use cases**  \
   Documentation-only guidance on how AI/agent libraries should use `HttpRequestOptions.extensions` to tag provider/model/operation details in a standard way.

All AI-specific behaviour (e.g., parsing OpenAI/Anthropic headers, understanding provider error shapes, multi-provider failover) remains in satellite libraries. The core only defines the hooks and common abstractions.

---

## 2. Compatibility & Non-goals

### 2.1 Backwards compatibility

- v0.6 is a **strict superset** of v0.5:
  - The v0.5 shapes of `AgentContext`, `HttpRequestOptions`, `MetricsRequestInfo`, logging meta, and tracing remain valid.
  - New fields are optional; if not provided, behaviour is unchanged.
- No existing public APIs should break; all additions are additive.

### 2.2 Non-goals

- No hard-coded knowledge of specific AI providers (OpenAI, Anthropic, etc.) in the core.
- No direct coupling to OTEL, Temporal, or any particular metrics/logging/tracing implementation.
- No changes to existing retry/backoff/caching/rate limiting semantics beyond what is necessary to honor `ResilienceProfile` and `ErrorClassifier` hints.
- No introduction of conversation-level concepts (e.g., `response_id`, `previous_response_id`) into core types.

---

## 3. New Core Concepts in v0.6

### 3.1 ResilienceProfile

Each HTTP request may include an optional `ResilienceProfile` describing how aggressive or conservative the core should be about retries, time budgets, and failover.

#### 3.1.1 Type definition

```ts
export type ResiliencePriority = 'low' | 'normal' | 'high' | 'critical';

export interface ResilienceProfile {
  /**
   * Priority hint for schedulers and policy engines.
   * - `low`: best-effort, can be throttled or dropped.
   * - `normal`: default behaviour.
   * - `high`: should be prioritized over low-priority work.
   * - `critical`: correctness is more important than throughput; prefer
   *   stronger guarantees (e.g., no risky fallbacks).
   */
  priority?: ResiliencePriority;

  /**
   * Upper bound on total latency for this request, including retries,
   * in milliseconds. If set, the client should enforce this as a hard
   * ceiling, even if global timeouts are higher.
   */
  maxEndToEndLatencyMs?: number;

  /**
   * Optional override for the maximum number of attempts (initial + retries).
   * When set, this should take precedence over any client-level maxRetries
   * for this request.
   */
  maxAttemptsOverride?: number;

  /**
   * If true, the client should prefer failing fast instead of attempting
   * fallback strategies (e.g., provider failover or multiple endpoints).
   */
  failFast?: boolean;

  /**
   * If true, indicates that higher-level systems may perform multi-provider
   * or multi-endpoint failover for this request. The core does not implement
   * failover itself but exposes this hint to policy engines.
   */
  allowFailover?: boolean;
}
```

#### 3.1.2 Integration into HttpRequestOptions

`HttpRequestOptions` (from v0.5) is extended to include:

```ts
export interface HttpRequestOptions {
  // v0.5 fields...
  resilience?: ResilienceProfile;
}
```

#### 3.1.3 Behavioural expectations

- If `resilience` is omitted, existing v0.5 behaviour applies.
- If `resilience.maxEndToEndLatencyMs` is set, the implementation must ensure that:
  - The total wall-clock time from the start of the first attempt to the final outcome does not exceed this value.
  - This may involve shortening per-attempt timeouts, limiting backoff duration, or cutting off further retries when the budget is nearly exhausted.
- If `resilience.maxAttemptsOverride` is set, it must cap the maximum attempts for this request, overriding any client-level default `maxRetries`.
- `priority`, `failFast`, and `allowFailover` are hints exposed to:
  - Metrics (for analytics/capacity planning).
  - External policy controllers and schedulers (e.g., in `@airnub/resilient-http-policies`).

The core client is not required to interpret `priority`, `failFast`, or `allowFailover` beyond passing them into telemetry; however, implementations may use them to tweak scheduling or queue ordering.

---

### 3.2 ErrorClassifier

Different providers (especially AI LLM APIs) expose rich, provider-specific error shapes. v0.6 introduces an `ErrorClassifier` interface so that the decision to retry and the categorization of errors can be provider-aware without polluting the core.

#### 3.2.1 Types

```ts
export interface ErrorContext {
  /** The request that triggered this error. */
  request: HttpRequestOptions;

  /** HTTP response, if available (may be undefined for network errors). */
  response?: Response;

  /** Raw error object thrown by fetch/transport or by the client. */
  error?: unknown;
}

export type ErrorCategory =
  | 'transient'     // network glitches, timeouts, etc.
  | 'rate_limit'    // 429/too many requests / token quotas
  | 'validation'    // invalid input, bad parameters, schema errors
  | 'auth'          // 401/403, bad API keys, permission issues
  | 'safety'        // content filters, safety policy stops
  | 'quota'         // hard quota reached (daily/monthly limits)
  | 'unknown';

export interface ClassifiedError {
  /** High-level category for this error. */
  category: ErrorCategory;

  /** Whether this error is considered retryable. */
  retryable: boolean;

  /**
   * Optional backoff override in ms (e.g., derived from Retry-After).
   * If present, the client should prefer this value over default backoff.
   */
  suggestedBackoffMs?: number;

  /** Optional key for selecting a policy/circuit (e.g. per-provider). */
  policyKey?: string;
}

export interface ErrorClassifier {
  classify(ctx: ErrorContext): ClassifiedError;
}
```

#### 3.2.2 Integration into HttpClientConfig

The core client config gains an optional classifier:

```ts
export interface HttpClientConfig {
  // existing config fields: baseUrl, transport, logger, metrics, tracing, etc.

  /** Optional error classifier for provider-specific retry and categorization logic. */
  errorClassifier?: ErrorClassifier;
}
```

#### 3.2.3 Behavioural expectations

- When a request fails (non-2xx response, transport error, timeout, etc.), the client must build an `ErrorContext` and:
  - If `config.errorClassifier` exists, call `classify(ctx)` and use the result to inform retry decisions and telemetry.
  - If no classifier is provided, fall back to existing v0.5 logic (status-code-based retry rules).
- On each failure, the client must:
  - Use `ClassifiedError.retryable` to decide whether to attempt another retry.
  - Use `ClassifiedError.suggestedBackoffMs` when provided, preferring it over default backoff.
  - Expose `ClassifiedError.category` and `policyKey` via `RequestOutcome` and metrics (see §3.4 and §3.3).

Satellite libraries (e.g., `@airnub/agent-conversation-core`) can ship provider-specific classifiers (OpenAI, Anthropic, etc.) that plug in here.

---

### 3.3 RateLimitFeedback in Metrics

Providers often expose rate limits via HTTP headers (e.g., `x-ratelimit-*`, `anthropic-ratelimit-*`). v0.6 introduces a structured `RateLimitFeedback` attached to `MetricsRequestInfo`.

#### 3.3.1 Types

```ts
export interface RateLimitFeedback {
  /** Request-based limits (if exposed by the provider). */
  limitRequests?: number;
  remainingRequests?: number;
  resetRequestsAt?: Date;

  /** Token-based limits (if exposed by the provider). */
  limitTokens?: number;
  remainingTokens?: number;
  resetTokensAt?: Date;

  /**
   * Raw headers used to derive the above, for debugging and future
   * provider-specific extensions.
   */
  rawHeaders?: Record<string, string>;
}
```

`MetricsRequestInfo` is extended:

```ts
export interface MetricsRequestInfo {
  // v0.5 fields: client, operation, durationMs, status, cacheHit, attempt,
  // requestId, correlationId, parentCorrelationId, agentContext, extensions

  /** Optional rate-limit feedback derived from response headers. */
  rateLimit?: RateLimitFeedback;
}
```

#### 3.3.2 Behavioural expectations

- The core client should attempt to extract rate-limit signals when possible, but remain generic:
  - It may look for headers like `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `x-ratelimit-reset-requests`, `x-ratelimit-limit-tokens`, etc.
  - It may also capture `Retry-After` and provider-specific headers.
- All extracted values should be placed into `RateLimitFeedback`, and the raw relevant headers stored in `rawHeaders`.
- If no rate-limit headers are present, `rateLimit` should be `undefined`.

This enables external controllers (e.g. `@airnub/resilient-http-policies`) to:

- Auto-tune concurrency and per-agent quotas.
- Pause non-critical workloads when near limits.
- Implement backpressure for AI-heavy workloads.

---

### 3.4 RequestOutcome

v0.6 introduces a compact `RequestOutcome` structure summarizing each request’s success/failure, attempts, and duration. This is primarily used to enrich metrics and diagnostics.

#### 3.4.1 Type

```ts
export interface RequestOutcome {
  /** Whether the request ultimately succeeded (2xx) or not. */
  ok: boolean;

  /** Final HTTP status code, if available. */
  status?: number;

  /** Error category (from ErrorClassifier) for failed requests. */
  errorCategory?: ErrorCategory;

  /** Total number of attempts made (including the initial attempt). */
  attempts: number;

  /** Milliseconds since epoch when the first attempt started. */
  startedAt: number;

  /** Milliseconds since epoch when the request completed or failed. */
  finishedAt: number;
}
```

`MetricsRequestInfo` is extended with an optional `outcome` field:

```ts
export interface MetricsRequestInfo {
  // existing v0.5 fields...
  rateLimit?: RateLimitFeedback;
  outcome?: RequestOutcome;
}
```

#### 3.4.2 Behavioural expectations

- `HttpClient` must:
  - Set `startedAt` when the first attempt begins.
  - Increment an internal attempt counter for each retry.
  - Set `finishedAt` when the final outcome is known.
  - Mark `ok` as `true` for final successful responses (2xx), `false` otherwise.
  - Fill `status` with the final HTTP status if available.
  - Set `errorCategory` for failed requests when an `ErrorClassifier` is present; otherwise it may default to `'unknown'`.
- `MetricsRequestInfo.outcome` should be included on every call to `metrics.recordRequest`.

This allows higher-level systems to compute per-agent and per-operation SLOs, success rates, and reliability profiles.

---

### 3.5 HttpRequestInterceptor

To support safety checks, provider routing, and response transformations (especially for AI browsers and agent tool calls), v0.6 adds a simple interceptor chain.

#### 3.5.1 Types

```ts
export interface HttpRequestInterceptor {
  /**
   * Called before the request is sent. May modify and return the options.
   * Interceptors run in the order they are defined.
   */
  beforeSend?(opts: HttpRequestOptions): Promise<HttpRequestOptions> | HttpRequestOptions;

  /**
   * Called after a successful HTTP response.
   * May inspect or transform the response.
   * Interceptors run in reverse order of beforeSend.
   */
  afterResponse?(opts: HttpRequestOptions, res: Response): Promise<Response> | Response;

  /**
   * Called when an error occurs (HTTP error, transport error, or classified error).
   * Must not swallow the error unless explicitly documented by the caller.
   */
  onError?(opts: HttpRequestOptions, error: unknown): Promise<void> | void;
}

export interface HttpClientConfig {
  // existing fields
  interceptors?: HttpRequestInterceptor[];
}
```

#### 3.5.2 Execution order

- `beforeSend` interceptors must run **in the order** they are registered:

  ```ts
  for (const interceptor of interceptors) {
    if (interceptor.beforeSend) {
      opts = await interceptor.beforeSend(opts);
    }
  }
  ```

- `afterResponse` interceptors must run **in reverse order** (LIFO) to support symmetric transformations:

  ```ts
  for (const interceptor of [...interceptors].reverse()) {
    if (interceptor.afterResponse) {
      res = await interceptor.afterResponse(opts, res);
    }
  }
  ```

- `onError` interceptors should run in reverse order as well, but the exact order may be implementation-defined; the important requirement is that all registered `onError` handlers are invoked.

#### 3.5.3 Behavioural expectations

- Interceptors **must not** be used by the core to implement provider-specific logic.
  - Instead, higher-level libraries can add interceptors for:
    - Injecting provider headers and auth tokens.
    - Enforcing URL/host allowlists for AI browsers.
    - Normalizing responses into a common shape.
- Errors thrown inside `beforeSend` or `afterResponse` should be treated like any other error:
  - They should be classified (via `ErrorClassifier`) if applicable.
  - They should be passed to `onError` interceptors.

---

### 3.6 Recommended Extension Conventions for AI Use Cases

v0.6 does **not** add AI-specific fields to core types, but it provides documentation on recommended keys in `HttpRequestOptions.extensions` for AI workloads.

The core must not depend on these keys; they are conventions for satellite libraries and observability tooling.

Recommended keys (non-exhaustive):

- `extensions['ai.provider']`: provider identifier (e.g., `"openai"`, `"anthropic"`, `"google"`).
- `extensions['ai.model']`: model name (e.g., `"gpt-5.1"`, `"claude-3.5-sonnet"`).
- `extensions['ai.request_type']`: request type (e.g., `"chat"`, `"embedding"`, `"tool"`, `"batch"`).
- `extensions['ai.streaming']`: boolean flag indicating streaming vs non-streaming.

Satellite libraries such as `@airnub/agent-conversation-core` should:

- Populate these keys when issuing LLM calls.
- Use `AgentContext` for agent/run metadata.
- Use `correlationId` / `parentCorrelationId` for cross-service observability.

The core simply forwards `extensions` into metrics, logging, and tracing meta as already defined in v0.5.

---

## 4. Updated Core Types Summary

This section summarizes the cumulative shapes of the key types after applying v0.6 (building on v0.5).

> Note: Only changed or new fields are shown here. Implementations must merge these with the full definitions from v0.5.

### 4.1 AgentContext (unchanged from v0.5)

```ts
export interface AgentContext {
  agent?: string;
  runId?: string;
  labels?: Record<string, string>;
  metadata?: Record<string, unknown>;
}
```

### 4.2 HttpRequestOptions (additions marked)

```ts
export interface HttpRequestOptions {
  method: HttpMethod;
  path: string;

  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: Record<string, string>;
  body?: unknown;

  operation?: string;
  idempotent?: boolean;

  cacheKey?: string;
  cacheTtlMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;

  // v0.5 correlation & agent
  requestId?: string;
  correlationId?: string;
  parentCorrelationId?: string;
  agentContext?: AgentContext;
  extensions?: Record<string, unknown>;

  // v0.6
  resilience?: ResilienceProfile;
}
```

### 4.3 HttpClientConfig (additions)

```ts
export interface HttpClientConfig {
  // existing fields: baseUrl, transport, logger, metrics, tracing, etc.

  errorClassifier?: ErrorClassifier;
  interceptors?: HttpRequestInterceptor[];
}
```

### 4.4 MetricsRequestInfo (additions)

```ts
export interface MetricsRequestInfo {
  client: string;
  operation: string;
  durationMs: number;
  status: number;
  cacheHit?: boolean;
  attempt?: number;

  requestId?: string;
  correlationId?: string;
  parentCorrelationId?: string;

  agentContext?: AgentContext;
  extensions?: Record<string, unknown>;

  // v0.6
  rateLimit?: RateLimitFeedback;
  outcome?: RequestOutcome;
}
```

---

## 5. Implementation Plan (for Coding Agent)

This section is a high-level checklist for implementing v0.6.

### 5.1 Introduce new types

1. In `libs/resilient-http-core/src/types.ts` (or equivalent):
   - Add `ResiliencePriority`, `ResilienceProfile`.
   - Add `ErrorContext`, `ErrorCategory`, `ClassifiedError`, `ErrorClassifier`.
   - Add `RateLimitFeedback`.
   - Add `RequestOutcome`.
   - Add `HttpRequestInterceptor`.

2. Update `HttpRequestOptions`, `HttpClientConfig`, `MetricsRequestInfo` as per §4.

### 5.2 Wire ResilienceProfile into HttpClient

1. When executing a request:
   - Track `startedAt` and an internal attempt counter.
   - For each attempt, ensure per-attempt timeout/backoff respects `resilience.maxEndToEndLatencyMs` if set.
   - When `resilience.maxAttemptsOverride` is set, enforce it as the maximum number of attempts.

2. Existing retry/backoff logic should remain the default unless overridden by `resilience` or `ErrorClassifier` hints.

### 5.3 Integrate ErrorClassifier

1. In the core request loop error path:
   - Build `ErrorContext` with `request`, `response` (if any), and the thrown `error`.
   - If `config.errorClassifier` exists, call `classify(ctx)`.
   - Use `ClassifiedError.retryable` to decide whether to retry.
   - Use `ClassifiedError.suggestedBackoffMs` to override backoff if provided.
   - Capture `ClassifiedError.category` and `policyKey` for inclusion in `RequestOutcome` and metrics.

2. If no classifier is configured, retain the existing v0.5 retry logic.

### 5.4 Extract RateLimitFeedback from responses

1. After a successful response (or even error responses with headers), inspect headers for rate-limit signals.
2. Populate `RateLimitFeedback` when possible; leave it undefined otherwise.
3. Attach `rateLimit` to `MetricsRequestInfo` passed to `metrics.recordRequest`.

### 5.5 Populate RequestOutcome

1. For each request, track:
   - `startedAt` (ms since epoch when first attempt starts).
   - `finishedAt` (ms since epoch when final outcome is known).
   - `attempts` (total attempts, including retries).

2. Build `RequestOutcome` when metrics are emitted:

   ```ts
   const outcome: RequestOutcome = {
     ok: finalSuccess,
     status: finalStatus,
     errorCategory: classifiedError?.category ?? undefined,
     attempts,
     startedAt,
     finishedAt,
   };
   ```

3. Attach `outcome` to `MetricsRequestInfo`.

### 5.6 Implement interceptor chain

1. Apply `beforeSend` interceptors in-order to `HttpRequestOptions` before building the actual fetch request.
2. After receiving a successful `Response`, apply `afterResponse` interceptors in reverse order, allowing them to transform the response.
3. When any error occurs, ensure `onError` is called for each interceptor (reverse order recommended) before propagating the error.

### 5.7 Tests & Validation

Add or update tests in `libs/resilient-http-core/src/__tests__/` to cover:

- `ResilienceProfile` behaviour (latency budget and maxAttemptsOverride enforcement).
- `ErrorClassifier` integration (retry decisions and error categories).
- `RateLimitFeedback` extraction from headers (including both request- and token-based limits).
- `RequestOutcome` correctness (attempt counts, timestamps, ok/status).
- Interceptor chaining and order (beforeSend/afterResponse/onError).

Then:

- Run `pnpm build` at the repo root.
- Run `pnpm test --filter @tradentic/resilient-http-core` and any additional tests impacted by the changes.

---

## 6. Future Work (Beyond v0.6)

v0.6 lays the foundational hooks for AI-aware resilience without baking provider specifics into the core. Future work is expected to occur in satellite packages, for example:

- `@airnub/agent-conversation-core`: provider-specific classifiers, conversation abstractions, multi-provider routing.
- `@airnub/resilient-http-policies`: budgets, per-agent profiles, concurrency controllers.
- `@airnub/resilient-http-pagination`: common pagination strategies using the interceptor and resilience hooks.
- `@airnub/agent-browser-guardrails`: safety policies for AI-driven browsing using interceptors to enforce allowlists/denylists.

The core must remain stable and small so that these libraries can evolve independently while relying on v0.6’s types and hooks as their foundation.

