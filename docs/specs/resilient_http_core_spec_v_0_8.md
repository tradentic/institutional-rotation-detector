# Resilient HTTP Ecosystem – Core Spec v0.8.0

> **Status:** Draft, greenfield baseline
>
> **Scope:** `@airnub/resilient-http-core` and its first‑class satellites:
> - `@airnub/resilient-http-policies`
> - `@airnub/resilient-http-pagination`
> - `@airnub/agent-conversation-core`
> - `@airnub/http-llm-openai`
> - `@airnub/agent-browser-guardrails`
>
> **Compatibility:** v0.8 **supersedes** all earlier drafts (0.1–0.7). It is treated as a
> greenfield spec: we **do not** maintain API compatibility with those earlier
> versions. All deprecated/legacy fields and hooks from v0.7 are removed.

---

## 1. Design Goals & Non‑Goals

### 1.1 Goals

1. **Clean, opinionated core**
   - Provide a small, well‑typed `HttpClient` with built‑in resilience, metrics,
     and extension hooks.
   - No legacy hooks or compatibility shims; v0.8 is the canonical shape.

2. **Zero external runtime dependencies by default**
   - Core and satellites must be usable with:
     - global `fetch` (browser/edge/runtime‑provided), or
     - a simple polyfill in Node.
   - No required Redis, OTEL SDKs, or other infra libraries. These integrate via
     user‑supplied adapters.

3. **Interceptors as the *only* extension mechanism**
   - One interceptor model for logging, auth, tracing, caching, policies,
     guardrails, and anything else.
   - No second set of legacy hook signatures.

4. **Classification‑driven resilience**
   - Retries, backoff, and fallbacks are controlled by:
     - a single `ResilienceProfile` per logical request, and
     - an `ErrorClassifier` that converts failures into `ErrorCategory` + hints.

5. **Telemetry‑first**
   - Every logical request yields a `RequestOutcome` and structured metrics.
   - Correlation IDs and `AgentContext` flow throughout, enabling multi‑service
     tracing and AI agent pipelines.

6. **First‑class AI and agent support**
   - `AgentContext` and `extensions` carry:
     - tenant info, request class (interactive/batch), and AI metadata
       (`ai.provider`, `ai.model`, etc.).
   - Satellites (`policies`, `conversation-core`, `http-llm-openai`,
     `browser-guardrails`) build on this to support robust agent runtimes.

7. **Out‑of‑the‑box defaults**
   - Provide `createDefaultHttpClient()` and simple presets so small apps and AI
     agents can start with minimal configuration.

### 1.2 Non‑Goals

1. **We do not ship infra backends**
   - No built‑in Redis, Postgres, or distributed rate‑limiter implementations.
   - We define interfaces and in‑memory defaults only.

2. **We do not abstract every HTTP feature**
   - Core covers common REST/JSON use cases and basic streaming primitives.
   - Advanced streaming/file transfer concerns (range requests, resume) are left
     to higher‑level libraries.

3. **We do not include business‑specific policies**
   - Policies and guardrails are generic. Sector‑specific rules (finance, media,
     etc.) live in separate projects.

---

## 2. Package Layout & Dependency Graph

### 2.1 Packages

- **Core**
  - `@airnub/resilient-http-core` – HttpClient, resilience, interceptors, metrics.

- **Satellites (built on core)**
  - `@airnub/resilient-http-policies` – policy engine + interceptor to enforce
    per‑tenant budgets, rate limits, and request classes.
  - `@airnub/resilient-http-pagination` – pagination helpers on top of
    `HttpClient` (offset/limit and cursor models).
  - `@airnub/agent-conversation-core` – provider‑agnostic conversation and agent
    runtime abstractions (messages, turns, history builders, engines).
  - `@airnub/http-llm-openai` – OpenAI‑compatible client built on `HttpClient`.
  - `@airnub/agent-browser-guardrails` – HTTP and navigation guardrail engine
    + interceptor for agent safety.

### 2.2 Dependency Graph

- `@airnub/resilient-http-core`
  - **Does NOT depend** on any other airnub packages.

- `@airnub/resilient-http-policies`
  - Depends on `@airnub/resilient-http-core` types (`HttpRequestOptions`,
    `ResilienceProfile`, `ErrorCategory`, `RequestOutcome`, `AgentContext`).

- `@airnub/resilient-http-pagination`
  - Depends on `@airnub/resilient-http-core` (`HttpClient`).

- `@airnub/agent-conversation-core`
  - Does **not** depend on `HttpClient` directly.
  - Depends on generic abstractions and may optionally import
    `ErrorCategory` for consistency.

- `@airnub/http-llm-openai`
  - Depends on `@airnub/resilient-http-core` and, optionally,
    `@airnub/agent-conversation-core` to provide a `ProviderAdapter`.

- `@airnub/agent-browser-guardrails`
  - Depends on `@airnub/resilient-http-core` interceptor types and `AgentContext`.

---

## 3. Core Concepts

### 3.1 Logical request vs attempt

- **Logical request:** one call from user code to `HttpClient.request*`.
- **Attempt:** one actual HTTP round‑trip performed by the client.

A logical request may involve multiple attempts due to retries. Metrics and
`RequestOutcome` pertain to the logical request; per‑attempt details are
internal but may be exposed for debugging.

### 3.2 Operation

- An **operation** is a stable string identifier for a logical request type,
  e.g. `"sec.getIssuerFilings"` or `"openai.responses.create"`.
- Every request **SHOULD** set an `operation` for:
  - Logging
  - Metrics grouping
  - Policy decisions

### 3.3 Correlation & AgentContext

- **CorrelationInfo**:
  - `requestId`: unique ID for this logical request.
  - `correlationId`: shared across related requests (e.g. incoming API request
    and all its downstream HTTP calls).
  - `parentCorrelationId`: correlation of upstream request, if applicable.

- **AgentContext** is an optional structured object describing:
  - `agentName` – name/id of the AI agent or client.
  - `tenantId` – multi‑tenant isolation.
  - `requestClass` – `"interactive" | "background" | "batch"`.
  - Optional extra fields for agent runtimes (e.g. `sessionId`, `userRole`).

### 3.4 Extensions

- `extensions: Record<string, unknown>` is an opaque metadata bag carried
  end‑to‑end. Examples:
  - `extensions["ai.provider"] = "openai"`
  - `extensions["ai.model"] = "gpt-5.1"
  - `extensions["tenant.tier"] = "free"`

Interceptors, policies, and guardrails may read `extensions` to make decisions.

### 3.5 ResilienceProfile

- A `ResilienceProfile` describes how to handle retries, timeouts, and backoff
  for a request.
- One profile is derived per logical request by merging:
  1. Client default
  2. Operation default (optional, if implemented)
  3. Request‑level overrides

Retries are driven **only** by this profile and the `ErrorClassifier`.

---

## 4. Core API Surface – `@airnub/resilient-http-core`

All types below are part of the public API, unless noted as internal.

### 4.1 Basic Types

```ts
export type HttpMethod =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS";

export type HttpHeaders = Record<string, string>;

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface UrlParts {
  /** Base URL, e.g. "https://api.example.com" */
  baseUrl?: string;
  /** Path relative to baseUrl, e.g. "/v1/items" */
  path?: string;
  /** Query parameters to append/merge */
  query?: QueryParams;
}
```

### 4.2 Correlation & Context

```ts
export interface CorrelationInfo {
  requestId?: string; // generated if omitted
  correlationId?: string; // inherited or generated if omitted
  parentCorrelationId?: string;
}

export type RequestClass = "interactive" | "background" | "batch";

export interface AgentContext {
  agentName?: string;
  agentVersion?: string;
  tenantId?: string;
  requestClass?: RequestClass;
  sessionId?: string;
  userId?: string;
  // extensions-specific agent data MAY also be placed here if strongly typed
}

export type Extensions = Record<string, unknown>;
```

### 4.3 Resilience & Budgets

```ts
export interface ResilienceProfile {
  /** Max attempts for this logical request, including the first. Default: 3. */
  maxAttempts?: number;

  /** If true, retries are allowed (subject to classification and method). */
  retryEnabled?: boolean;

  /**
   * Max duration (ms) for each attempt, implemented via AbortController.
   * If omitted, attempts are limited only by overallTimeoutMs.
   */
  perAttemptTimeoutMs?: number;

  /**
   * Max end-to-end duration (ms) for the logical request.
   * If exceeded, the client throws TimeoutError with category "timeout".
   */
  overallTimeoutMs?: number;

  /** Base backoff delay (ms) before the first retry. Default: 200. */
  baseBackoffMs?: number;

  /** Max backoff delay (ms) between retries. Default: 2000. */
  maxBackoffMs?: number;

  /**
   * Jitter factor in [0,1]. 0 = no jitter, 1 = full jitter.
   * Applied to backoff delays to avoid thundering herds.
   */
  jitterFactor?: number;

  /**
   * Whether to retry idempotent methods by default.
   * If false, classification MUST explicitly mark errors as retryable.
   * Default: true for GET/HEAD/OPTIONS, false for others.
   */
  retryIdempotentMethodsByDefault?: boolean;

  /**
   * Max retry delay suggested by classification (e.g. Retry-After).
   * If a classifier suggests a delay > maxSuggestedRetryDelayMs, it is
   * clamped to this value.
   */
  maxSuggestedRetryDelayMs?: number;
}

export interface RequestBudget {
  /**
   * Optional token budget for downstream AI calls or expensive operations.
   * Used primarily by policy/AI layers; core does not enforce it beyond
   * attaching to metrics/contexts.
   */
  maxTokens?: number;

  /** Arbitrary budget attributes for policies to interpret. */
  attributes?: Record<string, number | string | boolean>;
}
```

### 4.4 Error Model & Classification

```ts
export type ErrorCategory =
  | "auth"        // authentication or authorization failure
  | "validation"  // client-side invalid request
  | "quota"       // account quota exceeded
  | "rate_limit"  // rate-limited (e.g. 429)
  | "timeout"     // client- or server-side timeout
  | "transient"   // transient server error (e.g. 5xx deemed retryable)
  | "network"     // low-level network error (DNS, TCP reset, etc.)
  | "canceled"    // aborted by caller or cancellation token
  | "none"        // no error
  | "unknown";    // unclassified error

export interface FallbackHint {
  /** Suggested delay in ms before retrying (e.g. from Retry-After header). */
  retryAfterMs?: number;

  /** True if caller MAY safely retry (subject to idempotency). */
  retryable?: boolean;

  /** Optional human-readable hint for logs/metrics. */
  hint?: string;
}

export interface ClassifiedError {
  category: ErrorCategory;
  /** HTTP status code if available. */
  statusCode?: number;
  /** Optional machine-readable reason or code from upstream. */
  reason?: string;
  fallback?: FallbackHint;
}

export interface ErrorClassifierContext {
  method: HttpMethod;
  url: string;
  attempt: number;
  request: HttpRequestOptions;
  response?: RawHttpResponse;
  error?: unknown; // underlying error (e.g. network error)
}

export interface ErrorClassifier {
  classify(ctx: ErrorClassifierContext): ClassifiedError;
}

export class HttpError extends Error {
  readonly category: ErrorCategory;
  readonly statusCode?: number;
  readonly url: string;
  readonly method: HttpMethod;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly operation?: string;
  readonly attemptCount: number;
  readonly outcome?: RequestOutcome;

  constructor(message: string, options: {
    category: ErrorCategory;
    statusCode?: number;
    url: string;
    method: HttpMethod;
    requestId?: string;
    correlationId?: string;
    operation?: string;
    attemptCount: number;
    outcome?: RequestOutcome;
    cause?: unknown;
  });
}

export class TimeoutError extends HttpError {}
```

### 4.5 Transport Abstraction

```ts
export interface RawHttpResponse {
  status: number;
  headers: HttpHeaders;
  /** Body as an ArrayBuffer; higher layers map it to string/JSON/etc. */
  body: ArrayBuffer;
}

export interface HttpTransport {
  (req: TransportRequest, signal: AbortSignal): Promise<RawHttpResponse>;
}

export interface TransportRequest {
  method: HttpMethod;
  url: string;
  headers: HttpHeaders;
  body?: ArrayBuffer;
}
```

The default implementation uses global `fetch` when available.

### 4.6 Request Options & Response Types

```ts
export interface HttpRequestOptions {
  method: HttpMethod;

  /** Exactly one of `url` or `urlParts` MUST be provided. */
  url?: string;
  urlParts?: UrlParts;

  headers?: HttpHeaders;
  query?: QueryParams;

  /**
   * Request body. The client will encode this appropriately:
   * - string -> UTF-8
   * - Uint8Array/ArrayBuffer -> binary
   * - object -> JSON (with Content-Type: application/json)
   */
  body?: unknown;

  /**
   * Operation name used for logging, metrics, policies, etc.
   */
  operation?: string;

  /** Correlation & agent metadata. */
  correlation?: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;

  /** Resilience profile; merged with client defaults. */
  resilience?: ResilienceProfile;

  /** Optional logical budget (e.g., token or cost). */
  budget?: RequestBudget;

  /**
   * Optional custom cache behaviour; see HttpCache.
   * - "default": use cache if configured
   * - "bypass": do not read/write cache
   * - "refresh": bypass read, write new value
   */
  cacheMode?: "default" | "bypass" | "refresh";

  /** Explicit cache key override (otherwise derived from method+URL+headers). */
  cacheKey?: string;
}

export interface HttpResponse<TBody = unknown> {
  status: number;
  headers: HttpHeaders;
  body: TBody;
  /**
   * Outcome for the logical request that produced this response.
   * This is only present on the final response for the logical request,
   * not per attempt.
   */
  outcome: RequestOutcome;
}

export interface RequestOutcome {
  ok: boolean;
  status?: number; // undefined if no response (pure network error)
  category: ErrorCategory;
  attempts: number;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  /**
   * Optional HTTP status family, e.g. 2, 4, 5. Convenience for metrics.
   */
  statusFamily?: number;
  errorMessage?: string;
  rateLimit?: RateLimitFeedback;
}

export interface RateLimitFeedback {
  /** e.g. requests remaining in this window */
  remainingRequests?: number;
  limitRequests?: number;
  resetAt?: Date;

  /** e.g. tokens remaining for AI providers */
  remainingTokens?: number;
  limitTokens?: number;
  tokenResetAt?: Date;

  /** Raw headers or provider-specific fields for debugging. */
  raw?: Record<string, string>;
}
```

### 4.7 Interceptors

```ts
export interface BeforeSendContext {
  request: HttpRequestOptions;
  attempt: number;
  signal: AbortSignal;
}

export interface AfterResponseContext<TBody = unknown> {
  request: HttpRequestOptions;
  attempt: number;
  response: HttpResponse<TBody>;
}

export interface OnErrorContext {
  request: HttpRequestOptions;
  attempt: number;
  error: HttpError | Error;
}

export interface HttpRequestInterceptor {
  /**
   * Called before each attempt. May mutate `request` (e.g., add headers).
   * Runs in registration order.
   */
  beforeSend?(ctx: BeforeSendContext): Promise<void> | void;

  /**
   * Called after a successful response. Runs in reverse registration order.
   */
  afterResponse?<TBody = unknown>(
    ctx: AfterResponseContext<TBody>
  ): Promise<void> | void;

  /**
   * Called after a failed attempt once classification/HttpError is available.
   * Runs in reverse registration order.
   */
  onError?(ctx: OnErrorContext): Promise<void> | void;
}
```

Ordering:

- For a given logical request:
  - For each attempt N:
    - `beforeSend` is invoked for each interceptor in registration order.
    - Transport is called.
    - If attempt succeeds and no retry is needed, `afterResponse` is invoked for
      each interceptor in **reverse** registration order.
    - If attempt fails, `onError` is invoked for each interceptor in reverse
      registration order.

Interceptors **MUST NOT** perform their own retry loops; they may influence
resilience by mutating `request.resilience` or attaching hints in
`extensions`/`agentContext`.

### 4.8 Metrics & Tracing

```ts
export interface MetricsRequestInfo {
  operation?: string;
  method: HttpMethod;
  url: string; // without query or with redacted query, implementation choice

  correlation?: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;

  outcome: RequestOutcome;
}

export interface MetricsSink {
  recordRequest(info: MetricsRequestInfo): void | Promise<void>;
}

export interface TracingAdapter {
  /** Called before the first attempt of a logical request. */
  startSpan(info: MetricsRequestInfo): TracingSpan | undefined;

  /** Called when the logical request completes. */
  endSpan(span: TracingSpan, outcome: RequestOutcome): void | Promise<void>;
}

export interface TracingSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  recordException(error: Error): void;
}
```

Metrics and tracing are **optional**. If not provided, core uses no‑op
implementations.

### 4.9 Caching

```ts
export interface HttpCacheEntry<T = unknown> {
  value: T;
  /** Epoch millis or ISO string when this entry expires. */
  expiresAt: number;
}

export interface HttpCache {
  get<T = unknown>(key: string): Promise<HttpCacheEntry<T> | undefined>;
  set<T = unknown>(key: string, entry: HttpCacheEntry<T>): Promise<void>;
  delete?(key: string): Promise<void>;
}
```

Caching is only applied when:

- The client is configured with a `cache` implementation, and
- `request.cacheMode` is not `"bypass"`.

By default, only `GET` and `HEAD` requests are cacheable.

Cache key derivation (when no custom key provided):

- Method + fully resolved URL + a subset of headers (e.g., `Accept` and
  `Authorization` if configured as part of the cache key).

### 4.10 HttpClientConfig & HttpClient

```ts
export interface HttpClientConfig {
  /** Optional base URL; can be overridden per request with url/urlParts. */
  baseUrl?: string;

  /** Underlying transport, default: fetch-based implementation. */
  transport?: HttpTransport;

  /** Default headers merged into each request. */
  defaultHeaders?: HttpHeaders;

  /** Default extensions merged into each request. */
  defaultExtensions?: Extensions;

  /** Default resilience profile for all requests. */
  defaultResilience?: ResilienceProfile;

  /** Optional cache implementation. */
  cache?: HttpCache;

  /** Optional metrics and tracing. */
  metricsSink?: MetricsSink;
  tracingAdapter?: TracingAdapter;

  /**
   * Interceptors run in the order provided.
   */
  interceptors?: HttpRequestInterceptor[];

  /**
   * Error classifier controlling categories and retry hints.
   * A sensible default is provided if omitted.
   */
  errorClassifier?: ErrorClassifier;
}

export class HttpClient {
  constructor(config?: HttpClientConfig);

  /** Low-level call returning a typed body. */
  requestRaw<T = unknown>(opts: HttpRequestOptions): Promise<HttpResponse<T>>;

  /** Convenience method for JSON APIs. */
  requestJson<T = unknown>(
    opts: HttpRequestOptions
  ): Promise<HttpResponse<T>>;

  /**
   * Helper for JSON APIs where callers only care about the body.
   * Throws HttpError on non-2xx.
   */
  requestJsonBody<T = unknown>(opts: HttpRequestOptions): Promise<T>;

  /** Convenience shorthand methods (optional but recommended). */
  getJson<T = unknown>(
    urlOrParts: string | UrlParts,
    opts?: Omit<HttpRequestOptions, "method" | "url" | "urlParts">
  ): Promise<T>;

  // Similarly: postJson, putJson, deleteJson, etc.
}
```

The implementation **MUST**:

- Validate that exactly one of `url` or `urlParts` is provided.
- Resolve `UrlParts` by merging `baseUrl`, path, and query params.
- Merge headers and extensions from client defaults and request.
- Derive a `ResilienceProfile` by merging defaults and `opts.resilience`.
- Generate a `requestId` and `correlationId` if not provided.
- Execute attempts with:
  - `AbortController` for per‑attempt timeout
  - End‑to‑end timeout for overall duration
  - Backoff delay with jitter between retries
- Use `ErrorClassifier` to decide:
  - `ErrorCategory`
  - Whether to retry
  - Suggested delay via `FallbackHint.retryAfterMs`
- Emit a **single** `RequestOutcome` to `metricsSink` per logical request.

### 4.11 Default Client Factory

```ts
export interface DefaultClientOptions {
  baseUrl?: string;
  /**
   * If true, logs basic request/response info to console.
   * Default: false.
   */
  enableConsoleLogging?: boolean;
}

export function createDefaultHttpClient(
  options?: DefaultClientOptions
): HttpClient;
```

`createDefaultHttpClient` **MUST**:

- Use the fetch‑based transport.
- Provide sensible `defaultResilience`:
  - `maxAttempts = 3`
  - `retryEnabled = true`
  - `perAttemptTimeoutMs = 10_000`
  - `overallTimeoutMs = 30_000`
  - `baseBackoffMs = 200`, `maxBackoffMs = 2000`, `jitterFactor = 0.2`
- Use a built‑in `ErrorClassifier` with conservative, provider‑agnostic rules,
  e.g.:
  - 429 → `rate_limit`, retryable with `retryAfterMs` if provided.
  - 5xx → `transient`, retryable (except 501/505 where appropriate).
  - 4xx → `validation` or `auth` depending on status.
- Attach a console‑based interceptor and metrics sink if
  `enableConsoleLogging` is true.

---

## 5. Policies Satellite – `@airnub/resilient-http-policies` v0.4.0

### 5.1 Purpose

Provide a pluggable policy engine and interceptor for:

- Rate limiting (requests and tokens)
- Concurrency limits
- Request budgets (per tenant/agent/operation)
- Simple deny/allow rules based on method, operation, or AI metadata

### 5.2 Types & Interfaces

```ts
export interface PolicyScope {
  clientName?: string; // e.g. "openai", "sec", "media-proxy"
  operation?: string;  // e.g. "openai.responses.create"
  method?: HttpMethod;
  tenantId?: string;
  requestClass?: RequestClass;
  aiProvider?: string; // extensions["ai.provider"]
  aiModel?: string;    // extensions["ai.model"]
}

export type PolicyEffect = "allow" | "deny";

export interface RateLimitRule {
  requestsPerInterval?: number;
  intervalMs?: number;

  tokensPerInterval?: number;
  tokenIntervalMs?: number;
}

export interface ConcurrencyRule {
  maxConcurrent?: number;
  maxQueueSize?: number; // optional queue; 0 means no queue
}

export interface ResilienceOverride {
  maxAttempts?: number;
  perAttemptTimeoutMs?: number;
  overallTimeoutMs?: number;
}

export interface PolicyDefinition {
  id: string;
  description?: string;

  /** Matching scope. */
  match: PolicyScope & {
    /** glob-style pattern, e.g. "openai.*" */
    operationPattern?: string;
  };

  effect: PolicyEffect;

  rateLimit?: RateLimitRule;
  concurrency?: ConcurrencyRule;

  resilienceOverride?: ResilienceOverride;

  /** Optional fallback behaviour if this policy denies. */
  denyMessage?: string;
}

export interface PolicyDecision {
  effect: PolicyEffect;
  policyId?: string;
  reason?: string;

  /** Optional delay before sending request (ms). */
  delayBeforeSendMs?: number;

  resilienceOverride?: ResilienceOverride;
}

export interface PolicyRequestContext {
  scope: PolicyScope;
  request: HttpRequestOptions;
}

export interface PolicyResultContext {
  scope: PolicyScope;
  request: HttpRequestOptions;
  outcome: RequestOutcome;
}

export interface PolicyEngine {
  evaluate(ctx: PolicyRequestContext): Promise<PolicyDecision>;
  onResult?(ctx: PolicyResultContext): Promise<void> | void;
}
```

### 5.3 In‑Memory Policy Engine

`@airnub/resilient-http-policies` **MUST** provide an in‑memory implementation:

```ts
export interface InMemoryPolicyEngineOptions {
  policies: PolicyDefinition[];
  /**
   * If true (default), evaluation errors are logged and treated as "fail open"
   * (allow with no delay/override). If false, they result in deny.
   */
  failOpenOnError?: boolean;
}

export function createInMemoryPolicyEngine(
  options: InMemoryPolicyEngineOptions
): PolicyEngine;
```

Features:

- Uses simple in‑memory counters and timestamps.
- Supports rate limiting per `(clientName, tenantId, operationPattern)`.
- Supports concurrency + optional queue per scope.

### 5.4 Policy Interceptor

```ts
export interface PolicyInterceptorOptions {
  engine: PolicyEngine;
  /** For logging only. */
  clientName: string;
}

export function createPolicyInterceptor(
  options: PolicyInterceptorOptions
): HttpRequestInterceptor;
```

Behaviour:

- `beforeSend`:
  - Derives `PolicyScope` from `HttpRequestOptions` (using `agentContext` and
    `extensions`).
  - Calls `engine.evaluate`. On:
    - `effect = "deny"` → throws a `HttpError` with category `quota` or
      `rate_limit` and 429 or 403 status.
    - `delayBeforeSendMs` → awaits a timer before proceeding.
    - `resilienceOverride` → merges into `request.resilience`.

- `afterResponse` / `onError`:
  - Calls `engine.onResult` (if provided) with `RequestOutcome`.

### 5.5 Presets

The package **SHOULD** expose helpers:

```ts
export function createSimpleRateLimitPolicy(
  opts: {
    clientName: string;
    requestsPerMinute: number;
  }
): PolicyDefinition;

export function createSimpleConcurrencyPolicy(
  opts: {
    clientName: string;
    maxConcurrent: number;
    maxQueueSize?: number;
  }
): PolicyDefinition;
```

These are convenience builders over `PolicyDefinition`.

---

## 6. Pagination Satellite – `@airnub/resilient-http-pagination` v0.4.0

### 6.1 Purpose

Provide simple pagination helpers built on `HttpClient`, supporting:

- Offset/limit APIs
- Cursor‑based APIs

### 6.2 Types

```ts
export interface PaginationLimits {
  maxPages?: number;
  maxItems?: number;
  maxDurationMs?: number;
}

export interface Page<TItem> {
  items: TItem[];
  rawResponse: HttpResponse<unknown>;
}

export interface PaginationResult<TItem> {
  pages: Page<TItem>[];
  totalItems: number;
  truncated: boolean;
  truncatedReason?: "maxPages" | "maxItems" | "maxDuration";
  durationMs: number;
}

export interface PaginateOptions<TItem> {
  client: HttpClient;
  initialRequest: HttpRequestOptions;
  extractItems: (response: HttpResponse<unknown>) => TItem[];
  getNextRequest: (
    prevRequest: HttpRequestOptions,
    prevResponse: HttpResponse<unknown>,
    pageIndex: number
  ) => HttpRequestOptions | undefined;
  limits?: PaginationLimits;
}
```

### 6.3 Functions

```ts
export async function paginate<TItem>(
  options: PaginateOptions<TItem>
): Promise<PaginationResult<TItem>>;

export async function* paginateStream<TItem>(
  options: PaginateOptions<TItem>
): AsyncGenerator<Page<TItem>, PaginationResult<TItem>, void>;
```

Semantics:

- `paginate` collects pages until:
  - `getNextRequest` returns `undefined`, or
  - a limit is hit (`maxPages`, `maxItems`, `maxDurationMs`).
- `paginateStream` yields `Page` objects as they arrive and returns the final
  `PaginationResult` when iteration completes.

### 6.4 Strategy Helpers

```ts
export interface OffsetLimitState {
  offset: number;
  limit: number;
}

export function createOffsetLimitStrategy(
  pageSize: number
): {
  initial: HttpRequestOptions;
  getNextRequest: PaginateOptions<unknown>["getNextRequest"];
};

export interface CursorState {
  cursor?: string;
}

export function createCursorStrategy(
  cursorParamName: string,
  extractCursor: (response: HttpResponse<unknown>) => string | undefined
): {
  initial: HttpRequestOptions;
  getNextRequest: PaginateOptions<unknown>["getNextRequest"];
};
```

These are helpers only; callers can build their own `getNextRequest` functions.

---

## 7. Agent Conversation Core – `@airnub/agent-conversation-core` v0.3.0

### 7.1 Purpose

Provide provider‑agnostic abstractions for multi‑turn AI conversations and
agent workflows:

- Conversation and message models
- Turn records with provider call results
- History builders and budgets
- Provider adapters

### 7.2 Core Types

```ts
export type Role = "user" | "assistant" | "system" | "tool" | "function";

export interface MessagePart {
  type: "text" | "tool-call" | "tool-result";
  /** Free-text content for text parts. */
  text?: string;
  /** Tool/function call payload. */
  toolCall?: ProviderToolCall;
  /** Tool/function result payload. */
  toolResult?: unknown;
}

export interface ConversationMessage {
  id: string;
  role: Role;
  parts: MessagePart[];
  createdAt: Date;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ProviderCallRecord {
  provider: string; // e.g. "openai"
  model: string;
  operation: string; // e.g. "responses.create"
  startedAt: Date;
  finishedAt: Date;
  usage?: TokenUsage;
  rawResponse?: unknown; // optional raw payload for audit/debug
}

export interface ConversationTurn {
  id: string;
  messages: ConversationMessage[]; // user + assistant + tools for this turn
  providerCalls: ProviderCallRecord[];
  createdAt: Date;
}

export interface Conversation {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### 7.3 Store & History Interfaces

```ts
export interface ConversationStore {
  getConversation(id: string): Promise<Conversation | null>;
  createConversation(initial?: Partial<Conversation>): Promise<Conversation>;

  appendTurn(conversationId: string, turn: ConversationTurn): Promise<void>;
  listTurns(conversationId: string): Promise<ConversationTurn[]>;
}

export interface HistoryBudget {
  maxMessages?: number;
  maxTurns?: number;
  maxTokens?: number; // optional, provider-specific estimation
}

export interface HistoryBuilder {
  buildHistory(
    conversationId: string,
    store: ConversationStore,
    budget?: HistoryBudget
  ): Promise<ConversationMessage[]>;
}
```

The package **MUST** provide a `RecentNTurnsHistoryBuilder` implementation
keeping the last N turns within a given limit.

### 7.4 Provider Adapter & Engine

```ts
export interface ProviderAdapterConfig {
  provider: string;
  model: string;
}

export interface ProviderCallInput {
  systemMessages: ConversationMessage[];
  history: ConversationMessage[];
  userMessage: ConversationMessage;
  tools?: ProviderToolDefinition[];
}

export interface ProviderToolDefinition {
  name: string;
  description?: string;
  jsonSchema: unknown; // JSON Schema describing parameters
}

export interface ProviderCallResult {
  messages: ConversationMessage[]; // typically assistant + tool calls
  usage?: TokenUsage;
  rawResponse?: unknown;
}

export interface ProviderAdapter {
  complete(
    config: ProviderAdapterConfig,
    input: ProviderCallInput
  ): Promise<ProviderCallResult>;

  completeStream?(
    config: ProviderAdapterConfig,
    input: ProviderCallInput
  ): AsyncGenerator<ProviderCallResult, ProviderCallResult, void>;
}

export interface ConversationEngineConfig {
  store: ConversationStore;
  historyBuilder: HistoryBuilder;
  provider: ProviderAdapter;
  defaultModel: string;
  defaultProvider?: string; // default: "openai"
}

export class ConversationEngine {
  constructor(config: ConversationEngineConfig);

  /**
   * Process a new user message for the given conversation.
   * If `conversationId` is null/undefined, a new conversation is created.
   */
  processTurn(
    conversationId: string | null,
    userMessage: Omit<ConversationMessage, "id" | "createdAt">,
    opts?: { model?: string; tools?: ProviderToolDefinition[] }
  ): Promise<{ conversationId: string; turn: ConversationTurn }>;

  /**
   * Same as processTurn, but streaming provider output.
   */
  processTurnStream(
    conversationId: string | null,
    userMessage: Omit<ConversationMessage, "id" | "createdAt">,
    opts?: { model?: string; tools?: ProviderToolDefinition[] }
  ): AsyncGenerator<
    { conversationId: string; partialTurn: ConversationTurn },
    { conversationId: string; turn: ConversationTurn },
    void
  >;
}
```

The engine **must not** perform HTTP calls directly; it only talks to
`ProviderAdapter`, enabling decoupling from `HttpClient`.

---

## 8. OpenAI HTTP Client – `@airnub/http-llm-openai` v0.3.0

### 8.1 Purpose

Provide an OpenAI (or OpenAI‑compatible) client built on `HttpClient` and a
`ProviderAdapter` for `agent-conversation-core`.

### 8.2 Config & Client

```ts
export interface OpenAIHttpClientConfig {
  httpClient: HttpClient;
  /** Base URL for the OpenAI-like API. */
  baseUrl: string;
  /** API key or token. */
  apiKey: string;
  /** Default model name. */
  defaultModel: string;
}

export interface OpenAIResponsesCreateInput {
  model?: string;
  input: unknown; // provider-specific; often { messages: [...] }
  tools?: ProviderToolDefinition[];
  maxOutputTokens?: number;
  temperature?: number;
  // Additional provider-specific fields allowed
  [key: string]: unknown;
}

export interface OpenAIResponseObject {
  id: string;
  model: string;
  createdAt: Date;
  outputText?: string;
  messages: ConversationMessage[];
  toolCalls?: ProviderToolCall[];
  usage?: TokenUsage;
  rawResponse: unknown;
}

export interface OpenAIStreamEvent {
  type: "text-delta" | "tool-call" | "done";
  textDelta?: string;
  toolCall?: ProviderToolCall;
  finalResponse?: OpenAIResponseObject;
}

export interface OpenAIStream {
  [Symbol.asyncIterator](): AsyncIterator<OpenAIStreamEvent>;
  /** Resolves to the final response when streaming finishes. */
  final: Promise<OpenAIResponseObject>;
}

export class OpenAIHttpClient {
  constructor(config: OpenAIHttpClientConfig);

  responses = {
    create(input: OpenAIResponsesCreateInput): Promise<OpenAIResponseObject>,
    createStream(input: OpenAIResponsesCreateInput): Promise<OpenAIStream>,
  };
}
```

For each request, the client **MUST**:

- Use `HttpClient` with:
  - `operation = "openai.responses.create"`
  - `extensions["ai.provider"] = "openai"`
  - `extensions["ai.model"] = model`
- Map raw OpenAI responses into `OpenAIResponseObject`;
  - For streaming, assemble `finalResponse` as events arrive.

### 8.3 ProviderAdapter

```ts
export function createOpenAIProviderAdapter(
  client: OpenAIHttpClient
): ProviderAdapter;
```

The adapter **MUST**:

- For `complete`, call `client.responses.create`.
- For `completeStream`, call `client.responses.createStream` and convert stream
  events into `ProviderCallResult` deltas.

---

## 9. Browser Guardrails – `@airnub/agent-browser-guardrails` v0.3.0

### 9.1 Purpose

Provide a guardrail engine and interceptor to:

- Allow/deny outgoing HTTP requests by:
  - host, protocol, method
  - tenant/agent
- Strip sensitive headers for untrusted hosts
- Optionally limit payload/body sizes
- Guard browser navigation in agent UIs

### 9.2 Types

```ts
export interface GuardrailScope {
  method: HttpMethod;
  url: string;
  agentContext?: AgentContext;
  extensions?: Extensions;
}

export type GuardrailEffect = "allow" | "deny";

export interface HeaderGuardConfig {
  stripHeaders?: string[];
}

export interface BodyGuardConfig {
  maxBodyBytes?: number;
}

export interface GuardrailRule {
  id: string;
  description?: string;

  hostPattern?: string; // glob e.g. "*.example.com" or "*"
  protocol?: "http" | "https";
  methods?: HttpMethod[];

  agentName?: string;
  tenantId?: string;

  effect: GuardrailEffect;

  headers?: HeaderGuardConfig;
  body?: BodyGuardConfig;
}

export interface GuardrailDecision {
  effect: GuardrailEffect;
  ruleId?: string;
  reason?: string;

  headersToStrip?: string[];
}

export interface GuardrailEngine {
  evaluate(scope: GuardrailScope): GuardrailDecision;
}
```

### 9.3 In‑Memory Engine & Interceptor

```ts
export interface InMemoryGuardrailEngineOptions {
  rules: GuardrailRule[];
  defaultEffect?: GuardrailEffect; // default: "deny"
}

export function createInMemoryGuardrailEngine(
  opts: InMemoryGuardrailEngineOptions
): GuardrailEngine;

export interface GuardrailInterceptorOptions {
  engine: GuardrailEngine;
}

export function createHttpGuardrailInterceptor(
  options: GuardrailInterceptorOptions
): HttpRequestInterceptor;
```

The interceptor `beforeSend` MUST:

- Call `engine.evaluate` with `method`, full URL, `agentContext`, and
  `extensions`.
- If decision is `deny`, throw a `HttpError` with category `validation` or
  `auth` depending on context.
- If `headersToStrip` is set, remove those headers from the request.
- If `body.maxBodyBytes` is configured in a rule and a body size is known to
  exceed it, throw a `HttpError` with category `validation`.

### 9.4 Navigation Guard

For browser/agent UIs, provide:

```ts
export interface BrowserNavigationGuard {
  checkNavigation(url: string, ctx?: { agent?: AgentContext; extensions?: Extensions }): void;
}

export function createBrowserNavigationGuard(
  engine: GuardrailEngine
): BrowserNavigationGuard;
```

`checkNavigation` MUST throw if navigation is not allowed by the engine.

---

## 10. Implementation Checklist (v0.8)

A library implementation is considered v0.8‑compliant when:

1. **Core**
   - HttpClient, types, and interceptors are implemented exactly as specified.
   - A default fetch‑based transport is provided.
   - The retry loop is driven exclusively by `ResilienceProfile` + `ErrorClassifier`.
   - Per‑attempt and overall timeouts are enforced with `AbortController`.
   - `ErrorClassifier` categorizes common classes of errors and provides
     retry hints.
   - Caching is supported via `HttpCache` interface.
   - Metrics and tracing hooks are called once per logical request.
   - `createDefaultHttpClient` exists and works with zero external deps.

2. **Policies**
   - In‑memory `PolicyEngine` (rate limit + concurrency) is implemented.
   - `createPolicyInterceptor` integrates policies into HttpClient via
     interceptors.
   - Simple presets (`createSimpleRateLimitPolicy`, etc.) exist.

3. **Pagination**
   - `paginate` and `paginateStream` are implemented and tested.
   - Offset/limit and cursor strategy helpers exist.

4. **Conversation Core**
   - Conversation, messages, turns, store, and history builder interfaces are
     implemented.
   - `ConversationEngine` exists with `processTurn` and `processTurnStream`.

5. **OpenAI Client**
   - `OpenAIHttpClient` wraps `HttpClient` and maps responses into
     `OpenAIResponseObject`.
   - Streaming responses are supported via `OpenAIStream`.
   - A `ProviderAdapter` implementation bridges into conversation core.

6. **Browser Guardrails**
   - In‑memory `GuardrailEngine` and `createHttpGuardrailInterceptor` exist.
   - Navigation guard is implemented.

7. **Tests & Strictness**
   - The project builds under `strict: true` TypeScript settings.
   - Tests cover:
     - Retry & backoff, including jitter
     - Timeout behaviour
     - Error classification and HttpError fields
     - Cache hit/miss behaviour
     - Policy decisions (allow/deny/delay)
     - Guardrail decisions (allow/deny, header stripping)
     - Pagination truncation conditions
     - Conversation engine happy path for both streaming and non‑streaming
     - OpenAI client mapping and streaming

This spec is self‑contained and intended to give a senior engineer or coding
agent enough detail to implement the entire v0.8 ecosystem from scratch, or to
upgrade an existing v0.7‑aligned implementation by removing legacy fields and
aligning to the simplified, non‑deprecated surfaces described above.

