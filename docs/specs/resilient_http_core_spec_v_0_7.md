# Resilient HTTP Core — Specification v0.7.0

> **Package:** `@airnub/resilient-http-core`  
> **Status:** Draft / Source of truth for implementation  
> **Supersedes:** v0.6 spec (this document is self‑contained and includes all v0.6 semantics + v0.7 refinements)

---

## 1. Goals & Non‑Goals

### 1.1 Goals

`@airnub/resilient-http-core` provides a **small, boring, provider‑agnostic HTTP substrate** for Node/browser runtimes:

- A single **`HttpClient`** abstraction on top of `fetch`‑like transports.
- First‑class **resilience**: retries, timeouts, rate‑limit awareness.
- First‑class **telemetry hooks**: logging, metrics, tracing.
- **Interceptors** for extension, guardrails, and policies.
- **Agent‑friendly metadata**: `AgentContext`, correlation IDs, `extensions` bag.
- **Zero external dependencies by default** (no Redis, OTEL, specific resilience libs).

### 1.2 Non‑Goals

- No built‑in support for:
  - gRPC (HTTP(S) only).
  - Domain‑specific APIs (FINRA, SEC, OpenAI, etc.).
  - Heavy resilience frameworks (cockatiel, resilience4ts, etc.).
  - Telemetry frameworks (OpenTelemetry, Prometheus, Datadog, etc.).
- No opinionated pagination or policy engines in core:
  - Those live in satellites: `@airnub/resilient-http-pagination`, `@airnub/resilient-http-policies`.

---

## 2. Versioning & Compatibility

- **v0.5** introduced:
  - Basic `HttpClient` on top of `fetchTransport`.
  - Logging, metrics, tracing hooks.
  - Optional cache, rate limiter, circuit breaker.
- **v0.6** added:
  - `ResilienceProfile` on requests.
  - `ErrorCategory`, `ClassifiedError`, and `ErrorClassifier`.
  - `RequestOutcome` and `RateLimitFeedback` into metrics.
  - `HttpRequestInterceptor` chain (`beforeSend`, `afterResponse`, `onError`).
- **v0.7 (this spec)**:
  - Consolidates v0.5 + v0.6 semantics into a single spec.
  - Clarifies **URL building**, **correlation**, and **resilience budgets**.
  - Tightens **interceptor contracts** into structured context objects.
  - Formalises **backoff & rate‑limit handling**.
  - Marks pagination‑specific fields as legacy and encourages satellites.

> **Design intent:** v0.7 is **additive** over v0.6.  
> Existing v0.6 behaviour **must remain valid** (or be supported via shims) while new features are available.

---

## 3. Core Types

All types are exported from `src/types.ts`.

### 3.1 HTTP primitives

```ts
export type HttpMethod =
  | 'GET'
  | 'HEAD'
  | 'OPTIONS'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE';

export type HttpHeaders = Record<string, string>;

export interface UrlParts {
  baseUrl?: string;      // e.g. 'https://api.example.com'
  path?: string;         // e.g. '/v1/items'
  query?: Record<string, string | number | boolean | (string | number | boolean)[] | undefined>;
}
```

The client supports two mutually exclusive ways to specify the target:

- `url` — full URL string, used as‑is (except query merging).
- `urlParts` — base, path, and query that the client composes.

Legacy `path` + `query` are still supported (see § 8), but v0.7 encourages `url`/`urlParts`.

### 3.2 Correlation & AgentContext

```ts
export interface CorrelationInfo {
  requestId: string;             // required; auto‑generated when absent
  correlationId?: string;        // logical trace id
  parentCorrelationId?: string;  // parent span/request id
}

export interface AgentContext {
  agent?: string;                      // e.g. 'rotation-score-agent'
  runId?: string;                      // e.g. 'conv-123:turn-4'
  labels?: Record<string, string>;     // e.g. { tier: 'experiment' }
  metadata?: Record<string, unknown>;  // arbitrary, small metadata
}

export type Extensions = Record<string, unknown>;
```

The client **must always ensure** a `CorrelationInfo.requestId` exists:

- If the caller provides `correlation.requestId`, it is preserved.
- Otherwise, the client generates a UUID (e.g. `crypto.randomUUID()` in Node/browser).

### 3.3 ErrorCategory & ClassifiedError

```ts
export type ErrorCategory =
  | 'none'
  | 'auth'
  | 'validation'
  | 'not_found'
  | 'quota'
  | 'rate_limit'
  | 'timeout'
  | 'transient'
  | 'network'
  | 'canceled'
  | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  statusCode?: number;          // HTTP status where applicable
  retryable?: boolean;          // defaults to heuristic if undefined
  suggestedBackoffMs?: number;  // may be used to override backoff
  reason?: string;              // human‑readable explanation
}

export interface ResponseClassification {
  treatAsError?: boolean;         // default: !response.ok
  overrideStatus?: number;        // override response.status for metrics & errors
  category?: ErrorCategory;       // override derived category
  fallback?: FallbackHint;        // provider‑specific fallback
}

export interface FallbackHint {
  retryAfterMs?: number;          // ms to wait before retrying
  degradeToOperation?: string;    // e.g., 'fallback-model', for higher layers
}
```

> **Note:** v0.6 used some categories with slightly different names (e.g. `rateLimit`).  
> v0.7 **canonicalises** to the kebab style above; classifier implementations must map older names to these.

### 3.4 ResilienceProfile & budgets

```ts
export interface ResilienceProfile {
  // Attempts / retry
  maxAttempts?: number;           // total attempts (default: 1)
  retryEnabled?: boolean;         // global on/off (default: true when maxAttempts > 1)

  // Timing
  perAttemptTimeoutMs?: number;   // per‑attempt timeout (ms)
  overallTimeoutMs?: number;      // end‑to‑end deadline (ms)

  // Backoff
  baseBackoffMs?: number;         // base backoff (ms), default 250
  maxBackoffMs?: number;          // cap for backoff, default 60_000
  jitterFactorRange?: [number, number]; // e.g. [0.8, 1.2]

  // Legacy fields (v0.6)
  maxEndToEndLatencyMs?: number;  // maps onto overallTimeoutMs
}

export interface RequestBudget {
  maxAttempts?: number;
  maxTotalDurationMs?: number;
}
```

Semantics:

- **Primary knobs in v0.7**:
  - `maxAttempts` / `retryEnabled`.
  - `perAttemptTimeoutMs` / `overallTimeoutMs`.
  - `baseBackoffMs`, `maxBackoffMs`, `jitterFactorRange`.
- **Legacy v0.6 knobs**:
  - `maxEndToEndLatencyMs` → treated as `overallTimeoutMs`.
  - `RequestBudget` is still honoured if present on `HttpRequestOptions.budget`.

The client must **merge** resilience from three layers:

1. A library‑wide default (`HttpClientConfig.defaultResilience`).
2. Operation‑level defaults (if exposed, optional).
3. Per‑request override (`HttpRequestOptions.resilience`).

The merged profile drives **attempt count**, **timeouts**, and **backoff**.

### 3.5 RateLimitFeedback

```ts
export interface RateLimitFeedback {
  // Request‑based limits
  limitRequests?: number;
  remainingRequests?: number;
  resetRequestsAt?: Date;

  // Token‑based limits (LLMs, etc.)
  limitTokens?: number;
  remainingTokens?: number;
  resetTokensAt?: Date;

  // Derived booleans
  isRateLimited?: boolean;      // true when response is clearly a rate limit

  // Raw headers for debugging
  rawHeaders?: Record<string, string>;
}
```

The client must expose best‑effort rate‑limit information parsed from common headers:

- `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `x-ratelimit-reset-requests`
- `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-tokens`, `x-ratelimit-reset-tokens`
- `retry-after`

### 3.6 RequestOutcome

```ts
export interface RequestOutcome {
  ok: boolean;
  status?: number;                 // effective HTTP status, or 0 on network errors
  errorCategory?: ErrorCategory;   // 'none' when ok
  attempts: number;                // attempts made
  startedAt: number;               // epoch ms
  finishedAt: number;              // epoch ms
  rateLimitFeedback?: RateLimitFeedback;
}
```

`RequestOutcome` is computed **once**, after the last attempt, and passed to metrics and tracing.

---

## 4. HttpClient API

### 4.1 HttpRequestOptions

```ts
export interface HttpRequestOptions {
  operation: string;            // logical operation name, e.g. 'finra.getShortInterest'
  method: HttpMethod;

  // URL
  url?: string;                 // absolute URL, highest precedence
  urlParts?: UrlParts;          // base + path + query

  // Legacy URL fields (v0.6)
  path?: string;                // relative or absolute URL
  query?: Record<string, unknown>;
  pageSize?: number;            // see § 8 (legacy pagination)
  pageOffset?: number;          // see § 8 (legacy pagination)

  // Body
  body?: BodyInit | unknown;    // see § 4.4 for serialization rules
  headers?: HttpHeaders;
  idempotencyKey?: string;      // for POST/PUT idempotency

  // Resilience & budgets
  resilience?: ResilienceProfile;
  budget?: RequestBudget;       // legacy; folded into resilience

  // Correlation, agent & metadata
  correlation?: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;

  // Internal / advanced (optional)
  attempt?: number;             // populated by HttpClient during retries
}
```

### 4.2 HttpClientConfig

```ts
export interface HttpClientConfig {
  clientName: string;               // e.g. 'finra', 'openai'
  baseUrl?: string;                 // default base for UrlParts and legacy path

  transport?: HttpTransport;        // defaults to fetchTransport
  defaultHeaders?: HttpHeaders;     // applied to every request

  defaultResilience?: ResilienceProfile;
  defaultAgentContext?: AgentContext;

  interceptors?: HttpRequestInterceptor[];
  logger?: Logger;
  metrics?: MetricsSink;
  tracing?: TracingAdapter;

  // Optional helpers
  resolveBaseUrl?: (opts: HttpRequestOptions) => string | undefined;  // legacy helper
  cache?: HttpCache;                // optional cache (see § 6.3)
  rateLimiter?: HttpRateLimiter;    // optional rate limiter
  circuitBreaker?: CircuitBreaker;  // optional circuit breaker

  // Legacy hooks (wrapped into interceptors in v0.7)
  beforeRequest?: (opts: HttpRequestOptions) => void | Promise<void>;
  afterResponse?: (opts: HttpRequestOptions, res: Response) => void | Promise<void>;

  // Error classification
  responseClassifier?: (res: Response, bodyText?: string) => Promise<ResponseClassification | void>;
  errorClassifier?: ErrorClassifier;

  // Policy wrapper (v0.6 legacy, superseded by @airnub/resilient-http-policies)
  policyWrapper?: (
    runner: () => Promise<unknown>,
    ctx: {
      client: string;
      operation: string;
      correlation: CorrelationInfo;
      agentContext?: AgentContext;
      extensions?: Extensions;
    },
  ) => Promise<unknown>;
}
```

### 4.3 HttpClient interface

```ts
export class HttpClient {
  constructor(config: HttpClientConfig);

  getClientName(): string;

  requestJson<T>(opts: HttpRequestOptions): Promise<T>;
  requestText(opts: HttpRequestOptions): Promise<string>;
  requestArrayBuffer(opts: HttpRequestOptions): Promise<ArrayBuffer>;
  requestRaw(opts: HttpRequestOptions): Promise<Response>;
}
```

- `requestJson<T>`
  - Applies caching (if configured), resilience, interceptors, metrics, tracing.
  - Parses response body as JSON (falling back to text if JSON parse fails), returning `T`.
- `requestText`
  - As above, but resolves `string`.
- `requestArrayBuffer`
  - As above, but resolves `ArrayBuffer`.
- `requestRaw`
  - Runs the full resilience pipeline but returns the raw `Response` without body decoding.

### 4.4 Body serialization rules

To preserve v0.6 ergonomics while remaining explicit:

- If `opts.body` is already a valid `BodyInit` (string, Blob, ArrayBuffer, FormData, URLSearchParams, etc.), it is passed through unchanged.
- If `opts.body` is a plain object or array:
  - The client **MUST** serialize as JSON: `JSON.stringify(body)`.
  - It **MUST** set `Content-Type: application/json` if no content‑type header is present.
- If `opts.body` is `undefined`/`null`, no body is sent.

### 4.5 URL resolution rules

1. If `opts.url` is provided, it is used verbatim (except that query from `urlParts.query` or `query` may be merged if explicitly required by implementation).
2. Else, if `opts.urlParts` is provided:
   - `baseUrl` is taken from `opts.urlParts.baseUrl` or `config.baseUrl` or `config.resolveBaseUrl(opts)`.
   - `path` is taken from `opts.urlParts.path`.
   - `query` from `opts.urlParts.query`.
3. Else, legacy fields are used:
   - `config.resolveBaseUrl(opts)` → `config.baseUrl` → error if missing and `path` is relative.
   - `path` and `query` are joined.
   - `pageSize` and `pageOffset` are appended as `limit` and `offset` query params (see § 8 for deprecation).

The implementation **must** handle absolute `path` values (`https://...`) by constructing a `URL` directly from `path`.

---

## 5. Interceptors & Hooks

### 5.1 HttpRequestInterceptor (v0.7 shape)

```ts
export interface BeforeSendContext {
  request: HttpRequestOptions;   // mutable
  signal: AbortSignal;
}

export interface AfterResponseContext {
  request: HttpRequestOptions;
  response: Response;
  attempt: number;
}

export interface OnErrorContext {
  request: HttpRequestOptions;
  error: unknown;
  attempt: number;
}

export interface HttpRequestInterceptor {
  beforeSend?: (ctx: BeforeSendContext) => void | Promise<void>;
  afterResponse?: (ctx: AfterResponseContext) => void | Promise<void>;
  onError?: (ctx: OnErrorContext) => void | Promise<void>;
}
```

Semantics:

- `beforeSend`:
  - Called **in registration order** for each attempt.
  - May mutate `ctx.request` in place (e.g. add headers, adjust URL, attach metadata).
- `afterResponse`:
  - Called **in reverse registration order** after a successful attempt.
- `onError`:
  - Called **in reverse registration order** when an attempt throws.

The client must:

- Apply interceptors to the **per‑attempt cloned request**.
- Ensure a failing interceptor does **not** crash the client:
  - Errors should be logged via `Logger` and then swallowed, unless explicitly designed otherwise.

### 5.2 Legacy `beforeRequest` / `afterResponse` hooks

To preserve v0.6 compatibility, `HttpClient` must internally construct a **legacy bridge interceptor** when either hook is provided on `HttpClientConfig`:

```ts
function buildLegacyInterceptor(config: HttpClientConfig): HttpRequestInterceptor | undefined {
  if (!config.beforeRequest && !config.afterResponse) return undefined;
  return {
    beforeSend: async ({ request }) => {
      await config.beforeRequest?.(request);
    },
    afterResponse: async ({ request, response }) => {
      await config.afterResponse?.(request, response);
    },
  };
}
```

This interceptor must be appended **after** any user‑provided interceptors, so that user interceptors run first and legacy hooks last.

---

## 6. Resilience, Retries, & Telemetry

### 6.1 Execution model

`requestRaw` is the canonical implementation; all other helpers delegate to it.

For a given `HttpRequestOptions`:

1. Merge resilience:
   - `config.defaultResilience` → operation defaults (if any) → `opts.resilience` → legacy `opts.budget`.
2. Compute attempt count & deadlines:
   - `maxAttempts = merged.maxAttempts ?? 1`.
   - `overallDeadline = now + merged.overallTimeoutMs` (or from legacy `maxEndToEndLatencyMs` / `budget.maxTotalDurationMs`).
3. For each attempt:
   - Clone request options; set `attempt` field.
   - Enforce `overallDeadline` (if exceeded before attempt, abort with `TimeoutError`).
   - Run `beforeSend` interceptors.
   - Invoke `rateLimiter.throttle(key, ctx)` if configured.
   - Invoke `circuitBreaker.beforeRequest(key)` if configured.
   - Execute actual HTTP call via `transport(url, init)` with `AbortController` for per‑attempt timeout.
   - If timeout triggered, throw `TimeoutError`.
   - Run response classification.
   - If classification says **OK**:
     - Run `rateLimiter.onSuccess`, `circuitBreaker.onSuccess`.
     - Run `afterResponse` interceptors.
     - Build `RequestOutcome` with `ok = true`.
     - Record metrics + tracing.
     - Return `Response`.
   - If classification says **error**:
     - Run `rateLimiter.onError`, `circuitBreaker.onFailure`.
     - Run `onError` interceptors.
     - Decide whether to retry:
       - Using `ClassifiedError.retryable` (when set) or fall back to category heuristics.
       - Respect `retryEnabled`, `maxAttempts`, and deadlines.
     - If not retryable → build `HttpError`, mark `RequestOutcome.ok = false`, record metrics/tracing, throw.
     - If retryable → compute backoff delay and `sleep` before next attempt.

### 6.2 Backoff & retry

The client must implement **exponential backoff with jitter**, taking into account:

- `ClassifiedError.suggestedBackoffMs`.
- `Retry-After` header from responses.
- `ResilienceProfile.baseBackoffMs`, `maxBackoffMs`, `jitterFactorRange`.

Algorithm (per attempt):

```ts
function computeRetryDelay(
  attempt: number,
  classified?: ClassifiedError,
  resilience?: ResilienceProfile,
  retryAfterHeaderMs?: number,
): number {
  const maxBackoff = resilience?.maxBackoffMs ?? 60_000;
  const base = resilience?.baseBackoffMs ?? 250;
  const [minJ, maxJ] = resilience?.jitterFactorRange ?? [0.8, 1.2];

  if (classified?.suggestedBackoffMs != null) {
    return Math.min(classified.suggestedBackoffMs, maxBackoff);
  }
  if (retryAfterHeaderMs != null) {
    return Math.min(retryAfterHeaderMs, maxBackoff);
  }
  const ideal = base * 2 ** (attempt - 1);
  const jitter = ideal * (minJ + Math.random() * (maxJ - minJ));
  return Math.min(jitter, maxBackoff);
}
```

### 6.3 Caching

The core **retains** v0.6 cache semantics.

```ts
export interface HttpCache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
}
```

Optional request fields:

```ts
export interface HttpRequestOptions {
  cacheKey?: string;
  cacheTtlMs?: number;  // > 0 to enable caching
}
```

Semantics:

- Only `requestJson<T>` participates in caching.
- When `cache`, `cacheKey`, and `cacheTtlMs > 0` are configured:
  1. `requestJson` first attempts `cache.get<T>(cacheKey)`.
  2. If hit:
     - It records metrics with `cacheHit: true` and `RequestOutcome.ok = true`, `attempts = 0`.
     - Returns cached value without calling `transport`.
  3. If miss or cache error:
     - Proceeds with normal `executeWithRetries` flow.
     - After success, writes `cache.set(cacheKey, result, cacheTtlMs)` in the background.

- Errors from cache `get`/`set` must be logged but **never** cause request failure.

Metrics must support a `cacheHit?: boolean` field.

### 6.4 MetricsSink & MetricsRequestInfo

```ts
export interface MetricsRequestInfo {
  clientName: string;
  operation: string;
  method: HttpMethod;
  url: string;

  status?: number;
  errorCategory?: ErrorCategory;
  durationMs: number;
  attempts: number;

  cacheHit?: boolean;
  rateLimitFeedback?: RateLimitFeedback;

  correlation: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;
}

export interface MetricsSink {
  recordRequest?(info: MetricsRequestInfo): Promise<void> | void;
}
```

The client must call `metrics.recordRequest` **once per logical request** (after the last attempt) with the final `RequestOutcome`.

### 6.5 Logger & TracingAdapter

```ts
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface TracingSpan {
  end(): void;
  recordException?(err: unknown): void;
}

export interface TracingAdapter {
  startSpan(
    name: string,
    ctx: {
      attributes?: Record<string, string | number | boolean | null>;
      agentContext?: AgentContext;
      extensions?: Extensions;
    },
  ): TracingSpan | undefined;
}
```

Guidelines:

- For each `requestRaw` call, the client may create a span named `${clientName}.${operation}`.
- Attributes should include:
  - `client`, `operation`, `method`, `path`/`url`.
  - `correlation_id`, `parent_correlation_id`, `request_id`.
  - `agent.name`, `agent.run_id`, `agent.label.*` from `AgentContext`.
- On error, the client should call `span.recordException(error)` before `span.end()`.

---

## 7. ErrorClassifier & HttpError

### 7.1 ErrorClassifier

```ts
export interface ErrorClassifier {
  classifyNetworkError(err: unknown): ClassifiedError;
  classifyResponse(response: Response, bodyText?: string): ClassifiedError;
}
```

Requirements:

- `classifyNetworkError` should handle at least:
  - `TimeoutError` → `timeout`, `retryable: true`.
  - `AbortError` (from `fetch`) → `canceled`, `retryable: false`.
  - generic `Error` → `transient`, `retryable: true`.
- `classifyResponse` should:
  - Map 5xx → `transient`, retryable.
  - 429 → `rate_limit`, retryable.
  - 401/403 → `auth`, not retryable.
  - 400/404/422 → `validation` / `not_found`, not retryable.
  - Everything else → `unknown`.

A default implementation (`DefaultErrorClassifier`) must be provided and used when `config.errorClassifier` is not supplied.

### 7.2 HttpError & TimeoutError

```ts
export class HttpError extends Error {
  status: number;
  category: ErrorCategory;
  body?: unknown;       // optional, decoded body
  headers?: Headers;
  fallback?: FallbackHint;
  response?: Response;

  correlation?: CorrelationInfo;
  agentContext?: AgentContext;
}

export class TimeoutError extends Error {
  constructor(message: string);
}
```

Semantics:

- `HttpError` is thrown when:
  - Classification treats the response as an error **and** no more retries will be attempted.
- `TimeoutError` is thrown when:
  - Per‑attempt timeout is exceeded.
  - Overall deadline is exceeded before or during an attempt.

The client should attach:

- `status`, `category`, `fallback`, `response`, `headers`.
- Optional `body` when cheaply available (JSON or text of error payload).
- `correlation` and `agentContext` for observability.

---

## 8. Legacy Pagination Fields & Migration

v0.6 surfaced primitive pagination knobs on `HttpRequestOptions`:

- `pageSize` → appended as `limit` query param.
- `pageOffset` → appended as `offset` query param.

v0.7 marks these as **legacy** and encourages migration to `@airnub/resilient-http-pagination`.

### 8.1 Required backwards compatibility

- The core **must continue** to append `pageSize` / `pageOffset` as `limit` / `offset` when set.
- New code **should not add additional pagination semantics** to `HttpClient`.

### 8.2 Migration guidance

- For multi‑page workflows, use `@airnub/resilient-http-pagination`:
  - It builds on `HttpClient` and `HttpRequestOptions`.
  - It treats pagination runs and stop‑conditions as first‑class concepts.

---

## 9. Backwards Compatibility with v0.6

To be considered a conformant v0.7 implementation, `@airnub/resilient-http-core` must:

1. **Retain caching semantics** as specified in v0.6.
2. **Retain rate‑limit header parsing** into `RateLimitFeedback`.
3. **Retain interceptor capabilities**, either:
   - via the v0.7 context‑mutating model, or
   - by preserving the v0.6 `beforeSend(opts) => opts` contract and adapting it.
4. **Retain JSON serialization defaults** for non‑BodyInit objects.
5. **Retain tracing hooks** (`TracingAdapter`) wired at request boundaries.
6. **Retain policy wrapper support**, even though policies are moving to satellites.

Where behaviour changed in v0.7 (e.g. correlation consolidation, UrlParts), the implementation must:

- Provide **adapters/shims** so that v0.6 callers continue to function.
- Document deprecated fields clearly and provide migration notes.

---

## 10. Implementation Checklist

A v0.7 implementation is considered complete when:

1. `HttpClient` and `HttpClientConfig` match this spec.
2. All four request helpers (`requestJson`, `requestText`, `requestArrayBuffer`, `requestRaw`) share the same resilience, interceptor, and telemetry behaviour.
3. `ResilienceProfile` and `RequestBudget` drive attempts, deadlines, backoff, and classification decisions.
4. `RateLimitFeedback` is populated from headers and propagated into metrics.
5. `HttpCache` behaviour is implemented for `requestJson` with cache hit/miss metrics.
6. Interceptors follow the v0.7 context contract and legacy hooks are bridged.
7. `ErrorClassifier`, `HttpError`, and `TimeoutError` are implemented as specified.
8. `MetricsSink` and `TracingAdapter` are exercised in tests with representative metadata.
9. Legacy pagination fields (`pageSize`, `pageOffset`) are honoured but no new pagination logic is added.
10. The library compiles under `strict: true` TypeScript and is covered by tests for:
    - Retry/backoff.
    - Timeouts.
    - Caching.
    - Rate‑limit feedback.
    - Interceptor ordering.
    - Error classification.

This document is the single source of truth for `@airnub/resilient-http-core` v0.7 and should be stored as:

```text
docs/specs/resilient_http_core_spec_v_0_7.md
```

