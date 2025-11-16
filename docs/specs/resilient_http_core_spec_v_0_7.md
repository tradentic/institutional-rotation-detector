# Resilient HTTP Core — Specification v0.7.0

> **Status:** Draft (intended to become the first “API-stable” 1.0 base)
>
> **Scope:** HTTP-only resilience + observability core for Node/Browser/Edge runtimes.
>
> **Non-goals:** gRPC, WebSockets, domain-specific SDKs, or high-level agent logic.

This document defines the **v0.7.0** specification for `@airnub/resilient-http-core`. It is intended to be complete enough that a developer or coding agent can implement a conforming TypeScript library without referring to previous versions.

---

## 1. Design Goals & Principles

### 1.1 Primary Goals

1. **Single, resilient HTTP substrate** for all Airnub/Tradentic libraries and apps.
2. **Runtime-agnostic** (Node, Browser, Edge), with **fetch-first** design.
3. **No mandatory external dependencies** by default (no OTEL, no Redis, no Cockatiel).
4. **First-class resilience & observability:**
   - Timeouts, retries, budgets, error classification.
   - Request IDs, correlation IDs, AgentContext.
   - Metrics, logs, and tracing hooks.
5. **Extensible via interceptors**, not inheritance or deep configuration trees.
6. **Stable core, fast-moving satellites:**
   - Core knows HTTP + resilience + telemetry shapes.
   - Satellite libraries implement pagination, policy engines, agent logic, provider clients, browser guardrails, etc.

### 1.2 Non-Goals

- Not a full OpenAPI client generator.
- Not a generic RPC framework.
- Not a content-safety or guardrail engine (that lives in satellites).
- Not a job scheduler or queue.

---

## 2. Core TypeScript Environment

The spec assumes a TypeScript environment with the following:

- `fetch`, `Request`, `Response`, `AbortController` (or polyfills).
- ES2019 or later.

All type examples below use TypeScript-style syntax, but a conforming implementation can be in any language as long as the semantics are preserved.

---

## 3. Core Data Types & Interfaces

### 3.1 HTTP Basics

```ts
export type HttpMethod =
  | "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

export type HttpHeaders = Record<string, string>;

export interface UrlParts {
  /** Base URL such as "https://api.example.com". */
  baseUrl?: string;
  /** Path, e.g. "/v1/resources". Must NOT contain query string. */
  path?: string;
  /** Query parameters merged with any existing query on url/baseUrl+path. */
  query?: Record<string, string | number | boolean | undefined>;
}
```

### 3.2 AgentContext & Metadata

`AgentContext` answers: **who/what is making this call?**

```ts
export interface AgentContext {
  /** Logical agent or component name (e.g. "rotation-detector", "browser-agent"). */
  agent?: string;
  /** Unique run/workflow ID (e.g. a job id, trace id, or agent run id). */
  runId?: string;
  /** Stable, low-cardinality labels (e.g. env, logical subsystem). */
  labels?: Record<string, string>;
  /** Additional metadata stable for the life of this run. */
  metadata?: Record<string, unknown>;
}
```

**Extensions** answer: **what extra attributes does this specific request have that might affect routing or policies?**

```ts
export type Extensions = Record<string, unknown>;
```

Implementations SHOULD treat extensions as an opaque bag, but RECOMMEND the following conventional keys for AI/LLM use cases:

- `ai.provider` (e.g. `"openai"`, `"anthropic"`).
- `ai.model` (e.g. `"gpt-5.1-mini"`).
- `ai.operation` (e.g. `"responses.create"`, `"chat"`).
- `ai.tool` (agent/tool identifier making the call).
- `ai.tenant` (tenant identifier).

### 3.3 Correlation IDs & Request Identity

Each request MAY carry the following identifiers:

```ts
export interface CorrelationInfo {
  /** Unique identifier for this HTTP request attempt chain. */
  requestId?: string;
  /** Correlates this logical request across services. */
  correlationId?: string;
  /** ID of the parent request (e.g. upstream call) if any. */
  parentCorrelationId?: string;
}
```

**Rules:**

- If `correlationId` is set and `parentCorrelationId` is not, implementations MAY propagate the parent from a higher context.
- Implementations MUST ensure `requestId` is unique per end-to-end request invocation (including all retries).
- Implementations SHOULD surface these IDs in logs, metrics, and traces.

### 3.4 ResilienceProfile

`ResilienceProfile` specifies how a request may use time and attempts.

```ts
export interface ResilienceProfile {
  /**
   * Maximum number of attempts (including the first) that the client is
   * allowed to make for this logical request.
   */
  maxAttempts?: number; // default: 1 (no retries)

  /**
   * Maximum per-attempt timeout in milliseconds. If exceeded, the attempt
   * MUST be aborted and MAY be retried (subject to maxAttempts and error
   * classification).
   */
  perAttemptTimeoutMs?: number;

  /**
   * Maximum end-to-end time budget for all attempts combined, in ms.
   * If exceeded, the client MUST NOT start a new attempt and MUST fail.
   */
  overallTimeoutMs?: number;

  /**
   * Hints for retry behaviour. Concrete backoff policies live in interceptors
   * or implementation details.
   */
  retryEnabled?: boolean; // default: true if maxAttempts > 1

  /**
   * If true, errors should fail fast without queuing or waiting for backlog
   * to drain. Used by policy engines/bulkheads.
   */
  failFast?: boolean;

  /**
   * Optional name of a policy or bucket (for policy engines). The core
   * does not interpret this value.
   */
  policyBucket?: string;
}
```

### 3.5 Error Classification

```ts
export type ErrorCategory =
  | "none"           // no error
  | "transient"      // network/5xx/transient provider error
  | "rateLimit"      // 429 or equivalent
  | "auth"           // auth/permission error
  | "validation"     // bad request, schema/validation error
  | "quota"          // usage limit exceeded
  | "safety"         // safety/guardrail/provider-enforced block
  | "canceled"       // caller aborted
  | "timeout"        // client-side timeout
  | "unknown";       // everything else

export interface ClassifiedError {
  category: ErrorCategory;
  /** Optional human-readable reason or code. */
  reason?: string;
  /** HTTP status code, if known. */
  statusCode?: number;
  /** Hint: is this error retryable? Defaults derived from category if unset. */
  retryable?: boolean;
}

export interface ErrorClassifier {
  classifyNetworkError(err: unknown): ClassifiedError;
  classifyResponse(response: Response): ClassifiedError;
}
```

An implementation MUST provide a default `ErrorClassifier` with sensible mapping from HTTP statuses and network errors to `ErrorCategory` values.

### 3.6 Rate Limit Feedback

`RateLimitFeedback` communicates rate-limit signal to metrics/policy engines.

```ts
export interface RateLimitFeedback {
  /** True if the response definitively indicates we hit a rate limit. */
  isRateLimited: boolean;
  /** Optional provider-specified reset time (e.g. from headers). */
  resetAt?: Date;
  /** Optional numeric limit and remaining values if known. */
  limit?: number;
  remaining?: number;
}
```

The `ErrorClassifier` or implementation MAY derive this from HTTP headers (e.g. `Retry-After`, `X-RateLimit-Remaining`).

### 3.7 RequestOutcome

`RequestOutcome` captures the final result of a logical HTTP request (after all attempts).

```ts
export interface RequestOutcome {
  ok: boolean;
  status?: number;            // final HTTP status, if any
  errorCategory: ErrorCategory;
  attempts: number;           // total attempts made
  startedAt: Date;
  finishedAt: Date;
  rateLimitFeedback?: RateLimitFeedback;
}
```

Implementations MUST populate `RequestOutcome` for each `HttpClient` call and pass it to telemetry sinks.

### 3.8 HttpTransport

`HttpTransport` is the low-level bridge to `fetch` or other HTTP libraries.

```ts
export type HttpTransport = (url: string, init: RequestInit) => Promise<Response>;
```

A conforming implementation:

- MUST use an `AbortController` to represent timeouts.
- MAY wrap other HTTP clients (e.g. axios) as long as the behaviour is consistent with `fetch`.

---

## 4. HttpRequestOptions & Client Configuration

### 4.1 HttpRequestOptions

`HttpRequestOptions` describes a logical HTTP request. It is intentionally rich but must support a **minimal happy path** for casual use.

```ts
export interface HttpRequestOptions {
  // ---- Required basics ----
  method: HttpMethod;

  /** Optional fully-qualified URL. If omitted, baseUrl + path + query are used. */
  url?: string;

  /** Optional URL parts. Used if url is not provided. */
  urlParts?: UrlParts;

  headers?: HttpHeaders;
  body?: BodyInit | null; // raw body; higher-level serializers live in interceptors

  // ---- Operation identity ----
  /**
   * Logical operation name, e.g. "openai.responses.create" or "finra.otc.get".
   * Used for metrics, policies, and debugging.
   */
  operation: string;

  /** True if this operation is safe/idempotent for retries (e.g. GET). */
  idempotent?: boolean;

  /**
   * Optional idempotency key for safe retry of non-GET operations. The core
   * does not interpret this value; interceptors may convert it to headers.
   */
  idempotencyKey?: string;

  // ---- Metadata & correlation ----
  correlation?: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;

  // ---- Resilience & timeouts ----
  resilience?: ResilienceProfile;

  // ---- Cache hints (optional) ----
  /** Whether the request is allowed to hit cache. Default true. */
  cacheEnabled?: boolean;
  /** Optional cache key override. */
  cacheKey?: string;
  /** Optional TTL in ms for successful responses. */
  cacheTtlMs?: number;

  // ---- Internal / advanced ----
  /** Attempt number (1-based) for interceptors; set by the client, not callers. */
  attempt?: number;
}
```

**Minimal usage example** (what a simple caller might provide):

```ts
const result = await client.requestJson<MyType>({
  method: "GET",
  operation: "github.repos.list",
  url: "https://api.github.com/user/repos",
});
```

### 4.2 HttpClientConfig

```ts
export interface HttpClientConfig {
  /** Name for metrics/logging (e.g. "finra-client", "openai-client"). */
  clientName: string;

  /** Optional default base URL. */
  baseUrl?: string;

  /** Transport implementation (e.g. fetch). */
  transport: HttpTransport;

  /** Default headers applied to every request (caller headers override). */
  defaultHeaders?: HttpHeaders;

  /** Default resilience profile applied to requests (overridden per-request). */
  defaultResilience?: ResilienceProfile;

  /** Telemetry sinks (may be no-op). */
  logger?: Logger;
  metrics?: MetricsSink;
  tracing?: TracingAdapter;

  /**
   * Interceptors applied in order. The implementation MUST respect this
   * order for beforeSend and reverse for afterResponse/onError.
   */
  interceptors?: HttpRequestInterceptor[];

  /**
   * Optional cache, rate limiter, and circuit breaker hooks. These are
   * not required for a minimal implementation.
   */
  cache?: HttpCache;
  rateLimiter?: HttpRateLimiter;
  circuitBreaker?: HttpCircuitBreaker;

  /** Default AgentContext merged into per-request values. */
  defaultAgentContext?: AgentContext;
}
```

### 4.3 DefaultHttpClientConfig

`DefaultHttpClientConfig` is a simplified config used by `createDefaultHttpClient` (section 7).

```ts
export interface DefaultHttpClientConfig {
  clientName: string;
  baseUrl?: string;
  /** Optional override for console logger. */
  logger?: Logger;
}
```

---

## 5. HttpClient Interface

A conforming implementation MUST provide an `HttpClient` interface with the following methods.

```ts
export interface HttpClient {
  /**
   * Core request method returning a raw Response. Respects resilience
   * settings, interceptors, cache, rate limiting, and circuit breaker.
   */
  requestRaw(options: HttpRequestOptions): Promise<Response>;

  /**
   * Request and parse JSON. If the response status is 2xx, the body MUST be
   * parsed as JSON. Non-2xx statuses MAY throw or return a rejected promise,
   * depending on implementation (documented behaviour is required).
   */
  requestJson<T = unknown>(options: HttpRequestOptions): Promise<T>;

  /** Request and return text body. */
  requestText(options: HttpRequestOptions): Promise<string>;

  /** Request and return an ArrayBuffer. */
  requestArrayBuffer(options: HttpRequestOptions): Promise<ArrayBuffer>;
}
```

### 5.1 Behavioural Requirements

1. **Resilience & attempts**
   - `requestRaw` MUST enforce `ResilienceProfile` constraints:
     - Abort attempts exceeding `perAttemptTimeoutMs`.
     - Respect `overallTimeoutMs` when considering new attempts.
     - Never exceed `maxAttempts`.
   - `requestJson`, `requestText`, and `requestArrayBuffer` MUST call `requestRaw` internally and MUST NOT implement their own additional retries.

2. **Interceptors**
   - Interceptors MUST be invoked for each attempt (see Section 6).

3. **Correlation & metadata**
   - For each logical request, the implementation MUST assign a new `requestId` if not provided.
   - It MUST pass `CorrelationInfo`, `AgentContext`, and `extensions` into interceptors and telemetry.

4. **Telemetry**
   - After all attempts complete, the implementation MUST compute a `RequestOutcome` and pass it to the `MetricsSink` and `Logger`/`TracingAdapter` (where appropriate).

5. **Error semantics**
   - For JSON/text/ArrayBuffer methods, non-2xx responses SHOULD throw or reject with an error that carries `status` and `ErrorCategory` information, unless the implementation explicitly documents alternative behaviour.

---

## 6. Interceptors (Canonical Extension Mechanism)

Interceptors are the **only canonical way** to plug cross-cutting behaviour into the HTTP client (aside from the transport).

> **NOTE:** Previous `beforeRequest`/`afterResponse` hooks are considered deprecated in v0.7 and SHOULD be implemented internally as a compatibility interceptor.

### 6.1 HttpRequestInterceptor Interface

```ts
export interface BeforeSendContext {
  /** Mutable HttpRequestOptions for this attempt (attempt number included). */
  request: HttpRequestOptions;
  /** AbortSignal for this attempt. */
  signal: AbortSignal;
}

export interface AfterResponseContext {
  request: HttpRequestOptions;
  response: Response;
  /** Number of this attempt (1-based). */
  attempt: number;
}

export interface ErrorContext {
  request: HttpRequestOptions;
  error: unknown;
  /** Number of this attempt (1-based). */
  attempt: number;
}

export interface HttpRequestInterceptor {
  beforeSend?(ctx: BeforeSendContext): Promise<void> | void;
  afterResponse?(ctx: AfterResponseContext): Promise<void> | void;
  onError?(ctx: ErrorContext): Promise<void> | void;
}
```

### 6.2 Ordering Rules

- For a given attempt:
  - `beforeSend` MUST run in the order interceptors were provided in `HttpClientConfig.interceptors`.
  - `afterResponse` MUST run in reverse order.
  - `onError` MUST run in reverse order when an attempt fails.
- Interceptors MAY mutate `ctx.request` and associated metadata.
- Interceptors MUST NOT directly perform retries; they MAY modify `ResilienceProfile` or set flags that the client respects.

### 6.3 Deprecated Hooks: beforeRequest/afterResponse

A v0.7 implementation MAY expose the legacy options:

```ts
export interface LegacyRequestHooks {
  beforeRequest?(options: HttpRequestOptions): void | Promise<void>;
  afterResponse?(options: HttpRequestOptions, response: Response): void | Promise<void>;
}
```

If provided, the implementation MUST:

- Internally construct an `HttpRequestInterceptor` that calls these hooks.
- Mark them as deprecated in its public API.

No new code SHOULD use these hooks; interceptors are the canonical mechanism.

---

## 7. Telemetry Interfaces

### 7.1 Logger

```ts
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void;
}
```

Implementations SHOULD at minimum support `info` and `error` and may route to `console` by default.

### 7.2 MetricsSink

```ts
export interface MetricsRequestInfo {
  clientName: string;
  operation: string;
  method: HttpMethod;
  url: string;
  status?: number;
  errorCategory: ErrorCategory;
  durationMs: number;
  attempts: number;
  rateLimitFeedback?: RateLimitFeedback;

  // Derived metadata (from AgentContext, extensions, correlation)
  agentContext?: AgentContext;
  extensions?: Extensions;
  correlation?: CorrelationInfo;
}

export interface MetricsSink {
  recordRequest(info: MetricsRequestInfo): void;
}
```

A conforming implementation MUST call `recordRequest` **once per end-to-end request**, not per attempt.

### 7.3 TracingAdapter

```ts
export interface Span {
  setAttribute(key: string, value: unknown): void;
  end(): void;
}

export interface TracingAdapter {
  /**
   * Start a span for an HTTP request. Implementations MAY ignore this.
   */
  startRequestSpan(info: {
    clientName: string;
    operation: string;
    method: HttpMethod;
    url: string;
    correlation?: CorrelationInfo;
    agentContext?: AgentContext;
    extensions?: Extensions;
  }): Span | null;
}
```

The HTTP client MUST:

- Create a span at the beginning of an end-to-end request (if `tracing` is provided).
- Set status and error attributes on the span based on `RequestOutcome`.
- End the span when the request completes.

---

## 8. Cache, Rate Limiter, Circuit Breaker Interfaces

These interfaces are optional but recommended for a complete implementation.

### 8.1 HttpCache

```ts
export interface HttpCacheEntry {
  status: number;
  headers: HttpHeaders;
  body: ArrayBuffer; // cached as binary, user API may convert to text/json
  expiresAt?: Date;
}

export interface HttpCache {
  get(key: string): Promise<HttpCacheEntry | null> | HttpCacheEntry | null;
  set(key: string, entry: HttpCacheEntry): Promise<void> | void;
  delete?(key: string): Promise<void> | void;
}
```

### 8.2 HttpRateLimiter

```ts
export interface RateLimiterContext {
  clientName: string;
  operation: string;
  method: HttpMethod;
  extensions?: Extensions;
}

export interface HttpRateLimiter {
  acquire(ctx: RateLimiterContext): Promise<void>;
}
```

If a rate limiter is provided, the client MUST call `acquire` **before each attempt**.

### 8.3 HttpCircuitBreaker

```ts
export interface CircuitBreakerContext {
  clientName: string;
  operation: string;
}

export interface HttpCircuitBreaker {
  /** Throws/ rejects if the circuit is open. */
  beforeRequest(ctx: CircuitBreakerContext): Promise<void> | void;
  /** Notified with outcome so breaker can update state. */
  afterRequest(ctx: CircuitBreakerContext, outcome: RequestOutcome): Promise<void> | void;
}
```

The client MUST call `beforeRequest` once per end-to-end request and `afterRequest` when it completes.

---

## 9. Default Client Factory (createDefaultHttpClient)

To support an out-of-the-box experience with no external dependencies, a conforming library MUST expose a `createDefaultHttpClient` function.

### 9.1 Signature

```ts
export function createDefaultHttpClient(
  config: DefaultHttpClientConfig
): HttpClient;
```

### 9.2 Behaviour

- **Transport:**
  - Use global `fetch` where available; otherwise require the user to polyfill or provide a transport in a non-default constructor.

- **Resilience defaults:**
  - `maxAttempts`: 3 for idempotent methods (`GET`, `HEAD`, `OPTIONS`); 1 otherwise.
  - `perAttemptTimeoutMs`: 10_000 (10 seconds).
  - `overallTimeoutMs`: 25_000 (25 seconds).

- **Error classification:**
  - Provide a default classifier:
    - 5xx, network errors, and timeouts → `transient`.
    - 429 → `rateLimit`.
    - 4xx auth-related (401/403) → `auth`.
    - 4xx others → `validation`.

- **Logging:**
  - Use `console`-based logger implementing `Logger` by default.

- **Metrics & tracing:**
  - Use no-op `MetricsSink` and `TracingAdapter`.

- **Interceptors:**
  - No interceptors by default.
  - Implementations MAY include a simple interceptor that:
    - Applies default headers.
    - Sets `requestId` if not provided.

- **Cache, rate limiter, circuit breaker:**
  - Default implementation MAY omit these entirely or provide simple in-memory stand-ins with small, fixed limits.
  - They MUST NOT require external services.

`createDefaultHttpClient` SHOULD be the recommended entry point for small services and tests.

---

## 10. Idempotency & Retries

### 10.1 Idempotency Hints

The `idempotent` flag on `HttpRequestOptions` and HTTP method semantics SHOULD guide retry behaviour:

- If `idempotent` is true and `maxAttempts > 1`, the client MAY retry transient errors.
- If `idempotent` is false and `idempotencyKey` is not provided, the client SHOULD be conservative about retries and MAY only retry network errors where it is certain the request did not reach the server.

### 10.2 Idempotency Keys

- `idempotencyKey` is an opaque string supplied by the caller.
- The core DOES NOT automatically send it as a header; an interceptor MAY map it to `Idempotency-Key` or another header.
- Recommended pattern:

```ts
const idempotencyInterceptor: HttpRequestInterceptor = {
  beforeSend({ request }) {
    if (request.idempotencyKey) {
      request.headers = {
        ...(request.headers ?? {}),
        "Idempotency-Key": request.idempotencyKey,
      };
    }
  },
};
```

Implementations SHOULD document their default behaviour for retries and idempotency.

---

## 11. Backwards Compatibility & Deprecated Features

### 11.1 policyWrapper

Previous versions allowed a `policyWrapper` function to wrap the entire request pipeline with external resilience libraries.

- In v0.7, `policyWrapper` is considered **legacy**.
- New code SHOULD use `HttpRequestInterceptor`s, together with `ResilienceProfile` and external policy engines (see satellite `@airnub/resilient-http-policies`).
- Implementations MAY continue to expose `policyWrapper` for backwards compatibility but SHOULD:
  - Document that it MUST NOT apply additional retries beyond those controlled by `ResilienceProfile`.
  - Warn users against combining it with policy interceptors to avoid nested retries.

### 11.2 beforeRequest/afterResponse

- As noted, these hooks are deprecated and MUST be implemented internally as a thin compatibility layer over interceptors.

---

## 12. Metadata & Telemetry Semantics (Summary)

To avoid confusion across core and satellites:

- `AgentContext` = **who/what is calling** (agent name, run id, labels, stable metadata).
- `extensions` = **request-level attributes** relevant for routing, policies, AI metadata, tenanting, experiments.
- Telemetry meta = **derived** from `AgentContext`, `extensions`, correlation IDs, and `RequestOutcome`.

No layer should invent new semantic keys that duplicate existing ones (e.g. `tenant` vs `tenant.id`) without documenting the mapping.

---

## 13. Versioning & Stability Guarantees

- v0.7 is intended to be the last pre-1.0 spec.
- The following types and interfaces are considered **core surface** and SHOULD remain stable across 1.x:
  - `HttpClient`, `HttpRequestOptions`, `HttpTransport`.
  - `AgentContext`, `Extensions`, `CorrelationInfo`.
  - `ResilienceProfile`, `ErrorCategory`, `ClassifiedError`, `ErrorClassifier`.
  - `RateLimitFeedback`, `RequestOutcome`.
  - `HttpRequestInterceptor`, `BeforeSendContext`, `AfterResponseContext`, `ErrorContext`.
  - `Logger`, `MetricsSink`, `TracingAdapter`.
  - `HttpCache`, `HttpRateLimiter`, `HttpCircuitBreaker`.
  - `createDefaultHttpClient`, `DefaultHttpClientConfig`, `HttpClientConfig`.

Breaking changes to these shapes SHOULD only occur in a major version.

---

## 14. Reference Implementation Notes (Non-normative)

This section is guidance for implementers and coding agents and is not normative.

1. **Internal request pipeline**:
   - Build a single `executeWithRetries` function that:
     - Applies `ResilienceProfile` to attempt loop.
     - Calls rate limiter, circuit breaker, interceptors, and transport.
     - Aggregates attempts into a final `RequestOutcome`.

2. **Transport abstraction**:
   - Consider a `createFetchTransport` helper that adapts global `fetch` to `HttpTransport` and handles `AbortController` wiring.

3. **Testing strategy**:
   - Unit tests for:
     - Retry behaviour respecting `maxAttempts` and timeouts.
     - Error classification mapping various HTTP statuses.
     - Interceptor ordering.
     - Cache hits/misses.
   - Integration tests against a small HTTP test server that can simulate slow, flaky, and error responses.

4. **Performance**:
   - Avoid unnecessary cloning of `HttpRequestOptions` for each interceptor.
   - Use lazy JSON parsing (only parse when `requestJson` is called).

5. **Documentation for users**:
   - Provide quick-start examples with `createDefaultHttpClient`.
   - Document how to add interceptors for:
     - Auth headers.
     - Idempotency keys.
     - Logging & metrics.
     - Policies and guardrails (via satellite libraries).

With this specification, a developer or coding agent should be able to implement `@airnub/resilient-http-core` v0.7 in a new codebase and know how it will interact with existing satellites (pagination, policies, agent conversation, browser guardrails, and provider clients) while remaining strictly HTTP-only.

