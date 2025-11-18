# Resilient HTTP Core — Specification v0.8.0 (Full, Evolutionary)

> **Package:** `@airnub/resilient-http-core`  
> **Status:** Draft / Source of truth for implementation  
> **Supersedes:** v0.7 spec (this document is self‑contained)  
> **Compatibility:** v0.5–v0.7 behaviour preserved; v0.8 is an *evolution*, not a rewrite.

---

## 1. Goals, Non‑Goals, and Design Intent

### 1.1 Goals

`@airnub/resilient-http-core` provides a **small, boring, provider‑agnostic HTTP substrate** for Node and browser runtimes:

- A single `HttpClient` abstraction on top of fetch‑like transports.
- First‑class **resilience**: retries, timeouts, rate‑limit awareness, and optional circuit breaking.
- First‑class **telemetry hooks**: logging, metrics, tracing.
- A single, unified **interceptor** surface for extension, guardrails, and policies.
- **Agent‑friendly metadata**: correlation IDs, agent context, and an extensions bag.
- **Zero external dependencies by default**:
  - Default transport built on global `fetch`.
  - In‑memory defaults for rate limiting and circuit breaking are optional helpers, not hard dependencies.

### 1.2 Non‑Goals

Core does *not* provide:

- gRPC or non‑HTTP protocols.
- Domain‑specific APIs (FINRA, SEC, OpenAI, etc.).
- Heavy resilience frameworks or telemetry frameworks.
- Rich policy engines or pagination orchestrators (these live in satellites such as `@airnub/resilient-http-policies` and `@airnub/resilient-http-pagination`).

### 1.3 Design Intent for v0.8

v0.8 has three explicit intents:

1. **No behaviour removals** relative to v0.7.
   - All v0.7 semantics remain valid.
   - Anything removed is explicitly marked `legacy` or `deprecated` and must be *implemented* for compatibility, even if it is discouraged for new code.

2. **Clarify and strengthen resilience semantics** without changing the execution model.
   - The existing v0.7 retry and backoff loop is preserved.
   - Rate limiting and circuit breaking remain first‑class *behaviours*.
   - Ownership of resilience decisions between `ResilienceProfile`, `ErrorClassifier`, and policy interceptors is clearly documented.

3. **Address the v0.7 critique** by adding missing hooks and guidance:
   - Clearer metadata scoping (correlation vs agent context vs extensions).
   - Formal `HttpTransport` abstraction and test transports (record / replay) as official extension points.
   - A small set of **out‑of‑the‑box templates** (`createDefaultHttpClient`, etc.) for a zero‑deps experience.
   - Streaming guidance so long‑running responses fit the resilience model.

v0.8 is therefore a **refinement and completion pass** on v0.7, not a greenfield design.

---

## 2. Versioning & Compatibility

### 2.1 Historical recap

- **v0.5**
  - Introduced `HttpClient` on top of `fetch`‑like transports.
  - Added logging, metrics, tracing hooks.
  - Optional `HttpCache`, `HttpRateLimiter`, `CircuitBreaker`.

- **v0.6**
  - Added `ResilienceProfile`, `ErrorCategory`, `ErrorClassifier`, `RequestOutcome`, `RateLimitFeedback`.
  - Introduced `HttpRequestInterceptor` (`beforeSend`, `afterResponse`, `onError`).

- **v0.7**
  - Consolidated prior specs into a single doc.
  - Clarified URL building, correlation, and resilience budgets.
  - Tightened interceptor contracts and formalised backoff & rate‑limit handling.
  - Marked pagination fields as legacy; encouraged satellites.

- **v0.8 (this spec)**
  - **Preserves** all v0.7 behaviours and public surfaces.
  - Adds clarifications and new helpers but does not change the shape or return type of existing methods.
  - Formalises `HttpTransport` and test transports as extension points.
  - Introduces additive helpers such as `requestJsonResponse` that return rich `HttpResponse<T>` without breaking existing APIs.

### 2.2 Compatibility rules

A v0.8 implementation MUST:

1. Implement all v0.7 types and behaviours as specified.
2. Keep all v0.7 request helpers (`requestJson`, `requestText`, `requestArrayBuffer`, `requestRaw`) with the same signatures and semantics.
3. Retain:
   - Caching semantics (`HttpCache`, `cacheKey`, `cacheTtlMs`).
   - Rate‑limit header parsing into `RateLimitFeedback`.
   - Interceptor semantics and legacy hooks (`beforeRequest`, `afterResponse`) via a bridge interceptor.
   - Legacy pagination fields (`pageSize`, `pageOffset`).
   - Legacy `RequestBudget` mapping into resilience.
   - Legacy `policyWrapper` behaviour (as a legacy wrapper hook) where used.
4. Only add new capabilities in a **backwards‑compatible** manner:
   - New fields and helper methods are additive.
   - Behavioural changes are limited to bugfixes and fully documented refinements.

---

## 3. Core Concepts & Behavioural Guarantees

This section describes the concepts that must remain true from v0.7 to v0.8.

An implementation of `@airnub/resilient-http-core` v0.8 MUST provide:

1. **Canonical retry and backoff loop**
   - Driven by a merged `ResilienceProfile` and optional `RequestBudget`.
   - Supports per‑attempt timeout and overall deadline.

2. **Rate limiting as a first‑class behaviour**
   - Optional `HttpRateLimiter` hook consults per‑request context and may delay or reject requests.
   - Hooks are called on success and failure so external rate limiters can update state.

3. **Circuit breaking as a first‑class behaviour**
   - Optional `CircuitBreaker` hook can block new attempts when a dependency is flapping.
   - It is called before each attempt and updated on success and failure.

4. **Error classification**
   - All outbound requests must be classified into `ErrorCategory` values using an `ErrorClassifier`.
   - Classification must influence retry vs fail‑fast.

5. **Telemetry**
   - A `MetricsSink` is invoked once per logical request with a `RequestOutcome` summarising attempts and rate‑limit feedback.
   - A `TracingAdapter` can wrap each logical request in a span, with correlation and agent metadata attached.

6. **Extension via interceptors only**
   - There is a single, well‑defined interceptor surface for cross‑cutting behaviour.
   - Legacy hooks are implemented as interceptors internally.

7. **Zero‑deps default client**
   - There is a `createDefaultHttpClient` helper that returns a usable, fetch‑based client with reasonable resilience defaults and no external dependencies.

These behaviours are core and MUST NOT be removed in any future minor version.

---

## 4. Core Types

All types are exported from `src/types.ts`.

### 4.1 HTTP primitives

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
  baseUrl?: string;
  path?: string;
  query?: Record<
    string,
    string | number | boolean | (string | number | boolean)[] | undefined
  >;
}
```

Two mutually exclusive ways to specify the target:

- `url` — full URL string, used as‑is.
- `urlParts` — base, path, and query that the client composes.

Legacy `path` and `query` on `HttpRequestOptions` are still supported and treated as described later.

### 4.2 Correlation & AgentContext

```ts
export interface CorrelationInfo {
  requestId: string;
  correlationId?: string;
  parentCorrelationId?: string;
}

export interface AgentContext {
  agent?: string;
  runId?: string;
  labels?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export type Extensions = Record<string, unknown>;
```

Rules:

- `requestId` is **always present**. If the caller does not provide one, the client MUST generate a reasonably unique ID (for example using a UUID factory).
- `correlationId` models a logical trace; `parentCorrelationId` represents the parent span or request.
- `AgentContext` is about **who** is acting and in what run; it is not about HTTP topology.
- `extensions` is the per‑request metadata bag for domain labels and AI‑specific tags, for example:
  - `ai.provider`, `ai.model`, `ai.operation`.
  - `tenant.id`, `request.class`, `environment`.

### 4.3 ErrorCategory, ClassifiedError, FallbackHint

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
  statusCode?: number;
  retryable?: boolean;
  suggestedBackoffMs?: number;
  reason?: string;
}

export interface FallbackHint {
  retryAfterMs?: number;
  degradeToOperation?: string;
}

export interface ResponseClassification {
  treatAsError?: boolean;
  overrideStatus?: number;
  category?: ErrorCategory;
  fallback?: FallbackHint;
}
```

### 4.4 ResilienceProfile and RequestBudget

```ts
export interface ResilienceProfile {
  maxAttempts?: number;
  retryEnabled?: boolean;

  perAttemptTimeoutMs?: number;
  overallTimeoutMs?: number;

  baseBackoffMs?: number;
  maxBackoffMs?: number;
  jitterFactorRange?: [number, number];

  // v0.6 legacy
  maxEndToEndLatencyMs?: number;
}

export interface RequestBudget {
  maxAttempts?: number;
  maxTotalDurationMs?: number;
}
```

Semantics:

- `ResilienceProfile` is the primary declarative description of how resilient a request should be.
- `RequestBudget` is a legacy, simplified form. If `budget` is present on `HttpRequestOptions`, the client MUST map:
  - `budget.maxAttempts` to `maxAttempts` when `maxAttempts` is not already set.
  - `budget.maxTotalDurationMs` to `overallTimeoutMs` when `overallTimeoutMs` is not already set.
- The client merges resilience settings from three layers:
  1. `HttpClientConfig.defaultResilience`.
  2. Optional operation defaults (if the implementation exposes them).
  3. Per‑request `resilience` and `budget`.

### 4.5 RateLimitFeedback and RequestOutcome

```ts
export interface RateLimitFeedback {
  limitRequests?: number;
  remainingRequests?: number;
  resetRequestsAt?: Date;

  limitTokens?: number;
  remainingTokens?: number;
  resetTokensAt?: Date;

  isRateLimited?: boolean;
  rawHeaders?: Record<string, string>;
}

export interface RequestOutcome {
  ok: boolean;
  status?: number;
  errorCategory?: ErrorCategory;
  attempts: number;
  startedAt: number;
  finishedAt: number;
  rateLimitFeedback?: RateLimitFeedback;
}
```

### 4.6 HttpResponse

v0.8 introduces a richer `HttpResponse<T>` type for callers that want both body and metadata without changing existing helper signatures.

```ts
export interface HttpResponse<T = unknown> {
  status: number;
  headers: HttpHeaders;
  body: T;

  rawResponse?: Response;

  correlation: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;

  outcome: RequestOutcome;
}
```

This type is used by new helper methods such as `requestJsonResponse`, but it does not change the return type of existing helpers like `requestJson`.

### 4.7 ErrorClassifier and HttpError

```ts
export interface ErrorClassifier {
  classifyNetworkError(err: unknown): ClassifiedError;
  classifyResponse(response: Response, bodyText?: string): ClassifiedError;
}

export class HttpError extends Error {
  status: number;
  category: ErrorCategory;
  body?: unknown;
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

A default classifier implementation MUST be provided and used when `HttpClientConfig.errorClassifier` is not supplied.

---

## 5. HttpClient API and Configuration

### 5.1 HttpRequestOptions

```ts
export interface HttpRequestOptions {
  operation: string;
  method: HttpMethod;

  // URL
  url?: string;
  urlParts?: UrlParts;

  // Legacy URL fields (v0.6)
  path?: string;
  query?: Record<string, unknown>;
  pageSize?: number;
  pageOffset?: number;

  // Body
  body?: BodyInit | unknown;
  headers?: HttpHeaders;
  idempotencyKey?: string;

  // Resilience and budgets
  resilience?: ResilienceProfile;
  budget?: RequestBudget;

  // Correlation, agent, metadata
  correlation?: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;

  // Internal / advanced
  attempt?: number;
}
```

### 5.2 HttpClientConfig

```ts
export interface HttpClientConfig {
  clientName: string;
  baseUrl?: string;

  transport?: HttpTransport;
  defaultHeaders?: HttpHeaders;

  defaultResilience?: ResilienceProfile;
  defaultAgentContext?: AgentContext;

  interceptors?: HttpRequestInterceptor[];
  logger?: Logger;
  metrics?: MetricsSink;
  tracing?: TracingAdapter;

  resolveBaseUrl?: (opts: HttpRequestOptions) => string | undefined;
  cache?: HttpCache;
  rateLimiter?: HttpRateLimiter;
  circuitBreaker?: CircuitBreaker;

  // Legacy hooks (v0.6)
  beforeRequest?: (opts: HttpRequestOptions) => void | Promise<void>;
  afterResponse?: (opts: HttpRequestOptions, res: Response) => void | Promise<void>;

  responseClassifier?: (res: Response, bodyText?: string) => Promise<ResponseClassification | void>;
  errorClassifier?: ErrorClassifier;

  // Legacy policy wrapper (v0.6)
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

Notes:

- `rateLimiter` and `circuitBreaker` remain optional hooks in v0.8 and MUST continue to function where configured.
- `beforeRequest`, `afterResponse`, and `policyWrapper` are retained for compatibility and MUST be implemented via internal bridge interceptors (see later) but should be considered legacy for new code.

### 5.3 HttpClient interface

```ts
export class HttpClient {
  constructor(config: HttpClientConfig);

  getClientName(): string;

  // v0.7 helpers (unchanged)
  requestJson<T>(opts: HttpRequestOptions): Promise<T>;
  requestText(opts: HttpRequestOptions): Promise<string>;
  requestArrayBuffer(opts: HttpRequestOptions): Promise<ArrayBuffer>;
  requestRaw(opts: HttpRequestOptions): Promise<Response>;

  // v0.8 additive helpers
  requestJsonResponse<T>(opts: HttpRequestOptions): Promise<HttpResponse<T>>;
  requestTextResponse(opts: HttpRequestOptions): Promise<HttpResponse<string>>;
  requestArrayBufferResponse(opts: HttpRequestOptions): Promise<HttpResponse<ArrayBuffer>>;
}
```

Rules:

- The v0.7 helper methods MUST retain their existing semantics.
- The new `*Response` helpers MUST internally delegate to the same execution pipeline and build an `HttpResponse<T>` from the final attempt.

### 5.4 Body serialization rules

Same as v0.7:

- If `body` is already a valid `BodyInit`, it is passed through unchanged.
- If `body` is a plain object or array, it is serialized as JSON and `Content‑Type: application/json` is set if not already present.
- If `body` is undefined or null, no body is sent.

### 5.5 URL resolution rules

Resolution order:

1. If `url` is provided, it is used directly.
2. Else, if `urlParts` is provided, `baseUrl` comes from `urlParts.baseUrl` or `config.baseUrl` or `config.resolveBaseUrl(opts)`.
3. Else, legacy `path` and `query` are used with `config.baseUrl` or `resolveBaseUrl`.

Legacy `pageSize` and `pageOffset` MUST still be appended as `limit` and `offset` query parameters when set.

---

## 6. Interceptors, Legacy Hooks, and HttpTransport

### 6.1 HttpRequestInterceptor

```ts
export interface BeforeSendContext {
  request: HttpRequestOptions;
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

Rules:

- `beforeSend` is called in registration order for each attempt and may mutate `request`.
- `afterResponse` is called in reverse registration order on successful responses.
- `onError` is called in reverse registration order when an attempt throws.
- Interceptor failures MUST NOT crash the client; they should be logged via `Logger` and swallowed unless explicitly designed otherwise.

### 6.2 Legacy hooks as bridge interceptor

Implementations MUST internally construct a legacy bridge interceptor when `beforeRequest` or `afterResponse` are set in `HttpClientConfig`:

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

The bridge interceptor MUST be appended after user‑provided interceptors so that modern interceptors run first.

If `policyWrapper` is provided, implementations MUST wrap the entire request execution loop with this wrapper. The wrapper may apply additional policies or metrics but MUST NOT break the core resilience semantics.

### 6.3 HttpTransport abstraction

v0.8 formalises the transport abstraction used by `HttpClient`.

```ts
export interface TransportRequest {
  url: string;
  init: RequestInit;
}

export type HttpTransport = (req: TransportRequest) => Promise<Response>;
```

A default `fetchTransport` implementation MUST be provided that calls global `fetch`.

`HttpClient` MUST use `transport` exclusively for network calls. This enables test transports (record / replay) and alternate transports (for example `undici`, `node-fetch`) without changing the client.

---

## 7. Resilience, Retries, Rate Limiting, Circuit Breaking

### 7.1 Execution model

`requestRaw` is the canonical implementation; all helpers delegate to it or reuse its pipeline.

For a given `HttpRequestOptions`:

1. Merge resilience:
   - Start from `defaultResilience`.
   - Overlay operation defaults if applicable.
   - Overlay `opts.resilience` and legacy `opts.budget`.
2. Compute `maxAttempts` and `overallDeadline`.
3. For each attempt until completion or exhaustion:
   - Clone `opts` to `attemptOpts` and set `attempt`.
   - If `overallDeadline` is exceeded before attempting, throw `TimeoutError`.
   - Build the URL and headers for this attempt.
   - Create an `AbortController` for per‑attempt timeout.
   - Run all `beforeSend` interceptors.
   - If `rateLimiter` is configured, call its throttle method (see below) with the relevant context and honour any delay or deny decision.
   - If `circuitBreaker` is configured, call its `beforeRequest` hook; if it indicates the circuit is open, short‑circuit with an appropriate `HttpError`.
   - Call `transport` with the resolved URL and `RequestInit`.
   - If a timeout is hit, throw a `TimeoutError`.
   - Read response headers and optionally a text body for classification.
   - Apply `responseClassifier` or `errorClassifier.classifyResponse` to determine whether this is an error.
   - If the response is considered success:
     - Update `rateLimiter` and `circuitBreaker` success hooks if present.
     - Call `afterResponse` interceptors.
     - Build `RequestOutcome` with `ok = true` and return `Response`.
   - If the response is considered error:
     - Update `rateLimiter` and `circuitBreaker` failure hooks.
     - Call `onError` interceptors.
     - Use the classifier result and `ResilienceProfile` to decide whether to retry.
     - If not retryable, throw a `HttpError` and record metrics.
     - If retryable and attempts remain and deadline permits:
       - Compute a backoff delay, sleep, then continue to next attempt.

Finally, compute a `RequestOutcome` summarising attempts and duration and pass it to `MetricsSink` and `TracingAdapter`.

### 7.2 Rate limiting hooks

The precise type signatures may vary between implementations; a recommended interface is:

```ts
export interface HttpRateLimiterContext {
  clientName: string;
  operation: string;
  method: HttpMethod;
  url: string;
  correlation: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;
}

export interface HttpRateLimiter {
  beforeRequest(ctx: HttpRateLimiterContext): Promise<void> | void;
  onSuccess?(ctx: HttpRateLimiterContext, outcome: RequestOutcome): Promise<void> | void;
  onError?(ctx: HttpRateLimiterContext, outcome: RequestOutcome, error: unknown): Promise<void> | void;
}
```

v0.8 requires that:

- If a `HttpRateLimiter` is configured, it MUST be called before each attempt and on final success or failure.
- The rate limiter MUST be able to veto a request by throwing an error; the client MUST propagate that as `HttpError` or a domain‑specific error.

Existing implementations that use different method names may keep them but SHOULD alias them to this shape over time.

### 7.3 Circuit breaker hooks

Similarly, a recommended interface is:

```ts
export interface CircuitBreakerContext {
  clientName: string;
  operation: string;
  method: HttpMethod;
  url: string;
}

export interface CircuitBreaker {
  beforeRequest(ctx: CircuitBreakerContext): Promise<void> | void;
  onSuccess(ctx: CircuitBreakerContext): Promise<void> | void;
  onFailure(ctx: CircuitBreakerContext, error: unknown): Promise<void> | void;
}
```

Rules:

- If `beforeRequest` throws (for example because the circuit is open), the client MUST treat this as a failure and skip the actual network call.
- `onSuccess` and `onFailure` MUST be called for each attempted request that reaches the circuit breaker stage.

### 7.4 Backoff and retry algorithm

The backoff algorithm from v0.7 remains valid. Implementations may refine jitter behaviour but MUST obey the following:

- Respect `ClassifiedError.suggestedBackoffMs` if present.
- Respect `FallbackHint.retryAfterMs` and `Retry‑After` headers where present.
- Use exponential backoff with jitter bounded by `baseBackoffMs`, `maxBackoffMs`, and `jitterFactorRange`.

---

## 8. Caching

Caching remains as in v0.7 and MUST be implemented.

```ts
export interface HttpCache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
}
```

Request options:

```ts
export interface HttpRequestOptions {
  cacheKey?: string;
  cacheTtlMs?: number;
}
```

Rules:

- Only `requestJson` and `requestJsonResponse` participate in caching.
- When `cache`, `cacheKey`, and `cacheTtlMs > 0` are present:
  - Attempt to read from cache first; on hit, return cached value and record metrics with `cacheHit = true`.
  - On miss, run the normal pipeline and write the result into cache asynchronously.
- Cache errors MUST be logged but must not fail the HTTP request.

---

## 9. Metrics and Tracing

### 9.1 MetricsSink

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

A v0.8 implementation MUST call `recordRequest` once per logical request with final metrics.

### 9.2 Logger and TracingAdapter

The logger and tracing types are unchanged from v0.7 and MUST be implemented.

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

Implementations SHOULD create a span for each logical request with attributes that include client, operation, method, and correlation IDs.

---

## 10. Streaming Guidance

v0.8 does not change the core to a streaming API but provides guidance:

- `requestRaw` MAY be used for streaming responses where the body is consumed progressively.
- `perAttemptTimeoutMs` SHOULD be interpreted as a connect and headers timeout, not a total stream duration.
- Implementations MAY add optional streaming‑specific resilience profile fields in a backwards‑compatible way, but they are not required by this spec.
- For LLM and SSE‑style streaming, higher‑level libraries (for example `@airnub/http-llm-openai`) SHOULD build on `requestRaw` and manage stream lifecycles while still feeding `RequestOutcome` and `RateLimitFeedback` back into metrics.

---

## 11. Out‑of‑the‑Box Templates

v0.8 requires a simple, zero‑deps default client factory for ease of adoption.

### 11.1 createDefaultHttpClient

```ts
export interface DefaultHttpClientOptions {
  clientName: string;
  baseUrl?: string;
  defaultResilience?: ResilienceProfile;
  logger?: Logger;
}

export function createDefaultHttpClient(
  options: DefaultHttpClientOptions,
): HttpClient;
```

Requirements:

- Uses `fetchTransport`.
- Uses reasonable default resilience (for example, 3 attempts for transient errors, per‑attempt timeout and overall timeout values set to safe defaults).
- Uses a default `ErrorClassifier` implementation.
- Configures no cache, rate limiter, or circuit breaker by default.
- Configures no external telemetry backends; logs may go to console if a logger is provided.

### 11.2 Example higher‑level templates (non‑normative)

This spec recommends, but does not require, additional factory helpers in separate modules or satellites:

- `createEnterpriseHttpClient` — wraps a default client with policy interceptors and telemetry integrations.
- `createAgentRuntime` — in higher‑level packages, wires `HttpClient` with conversation core, LLM providers, and browser guardrails.

These are mentioned here to show how core is expected to fit into the wider ecosystem; their detailed specs live in satellite documents.

---

## 12. Legacy Features and Deprecation Policy

The following features are **legacy but required** in v0.8:

- `HttpRequestOptions.path`, `query`, `pageSize`, `pageOffset`.
- `HttpRequestOptions.budget` (`RequestBudget`).
- `HttpClientConfig.beforeRequest`, `afterResponse`, and `policyWrapper`.

Rules:

- Implementations MUST support these fields and hooks as described.
- New code SHOULD prefer `url` or `urlParts`, `resilience`, and interceptors.
- Future major versions may remove these legacy surfaces, but only with a documented migration path.

---

## 13. Implementation Checklist (v0.8)

A `@airnub/resilient-http-core` implementation is considered v0.8 complete when:

1. All v0.7 types and behaviours are present and tested.
2. `HttpTransport` is implemented and all network calls go through it.
3. `HttpClient` exposes the v0.7 helper methods unchanged and the new `*Response` helpers.
4. The retry and backoff loop conforms to the resilience model and still calls rate limiter and circuit breaker hooks when configured.
5. Caching behaves as documented, including error handling and metrics flags.
6. Legacy hooks and options are implemented via bridge interceptor and compatibility logic.
7. Metrics and tracing are wired to final `RequestOutcome` per logical request.
8. `createDefaultHttpClient` is implemented with a zero‑deps configuration.
9. The library compiles under strict TypeScript settings and has tests covering:
   - Retry and backoff semantics.
   - Timeouts and deadlines.
   - Rate limiting and circuit breaking hooks.
   - Caching behaviour.
   - Interceptor ordering and error handling.
   - Error classification.
   - Metrics and tracing metadata.

This document is the canonical specification for `@airnub/resilient-http-core` v0.8 and SHOULD be stored as:

`docs/specs/resilient_http_core_spec_v_0_8.md`

