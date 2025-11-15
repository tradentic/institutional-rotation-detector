# Resilient HTTP Core — Architecture & Implementation Spec (v0.2.0)

> **This is an evolution of v0.1.0.** It preserves the original design but adds:
> - Agentic / AI‑workflow friendly hooks (budgets, context, error classification).
> - Optional telemetry & tracing hooks (OTEL‑ready, but no OTEL dependency).
> - A clear pattern for OpenAI streaming support **without polluting the core**.

The core must remain:

- Small and dependency‑light.
- Transport‑agnostic (fetch‑first, adapters for others).
- Resilience‑focused (retries, backoff, cache, rate‑limit, CB).
- Domain‑agnostic (no FINRA/UW/OpenAI specifics baked in).
- Future‑portable (easy to split into its own repo later).

All agent/OTEL/streaming enhancements are exposed as **hooks and metadata only**. Heavy integrations live in companion packages or at the app layer.

---

## 1. Purpose & Context

Resilient HTTP Core is a shared foundation for all HTTP‑based API clients in the **institutional‑rotation‑detector** monorepo, including (but not limited to):

- FINRA data APIs
- Unusual Whales APIs
- OpenAI APIs

It provides:

- A **single HTTP engine** (`HttpClient`) with:
  - Retries, backoff, `Retry‑After` support
  - Timeouts
  - Caching and cache TTLs
  - Rate limiting & circuit breaking hooks
  - Logging & metrics hooks
- Shared interfaces for:
  - `HttpCache`, `HttpRateLimiter`, `CircuitBreaker`, `Logger`, `MetricsSink`, `HttpTransport`
- Optional hooks for:
  - **Agent metadata & budgets** (for tool‑like calls from AI agents).
  - **Error classification & fallback hints** (so agents can adapt strategies).
  - **Response classification** (to normalise non‑standard APIs like FINRA).
  - **Tracing/telemetry adapters** (OTEL‑ready but no OTEL dependency).

**Package / path (unchanged):**

- Folder: `libs/resilient-http-core`
- NPM name: `@tradentic/resilient-http-core`

---

## 2. Design Principles

1. **Fetch‑first, transport‑pluggable**
   - Default transport uses Node’s built‑in `fetch`.
   - Other HTTP stacks (axios, custom fetch, test doubles) attach via adapters.

2. **Policy‑engine agnostic**
   - No direct dependency on cockatiel, resilience4ts, resilience‑typescript, etc.
   - A generic `policyWrapper` hook allows any policy engine to wrap a single attempt.

3. **Domain‑agnostic core**
   - No FINRA/UW/OpenAI knowledge in the core.
   - Domain quirks handled via **config hooks** (e.g., `responseClassifier`).

4. **Agent‑friendly but not agent‑bound**
   - The core supports metadata and hooks to make AI agent calls resilient.
   - It does *not* implement an agent framework; that belongs in higher layers.

5. **Telemetry‑ready but not telemetry‑dependent**
   - Interfaces for metrics/logging/tracing, not hard deps.
   - OTEL, pino, etc. integrate via separate adapter packages.

6. **Future portability**
   - The library should be extractable into its own repo with minimal surgery.

---

## 3. Core Types & Interfaces

All types live in `libs/resilient-http-core/src/types.ts` and are exported via `src/index.ts`.

### 3.1 Transport & cache

```ts
export interface HttpTransport {
  (url: string, init: RequestInit): Promise<Response>;
}

export interface HttpCache {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}
```

### 3.2 Rate limiter & circuit breaker

```ts
export interface RateLimiterContext {
  operation: string;
  agentName?: string;
  sessionId?: string;
  toolName?: string;
  priority?: 'low' | 'normal' | 'high';
  // extendable by implementations
  [key: string]: unknown;
}

export interface HttpRateLimiter {
  throttle(key: string, context?: RateLimiterContext): Promise<void>;

  onSuccess?(key: string, context?: RateLimiterContext): void | Promise<void>;

  onError?(key: string, error: unknown, context?: RateLimiterContext):
    | void
    | Promise<void>;
}

export interface CircuitBreaker {
  beforeRequest(key: string): Promise<void>;
  onSuccess(key: string): Promise<void>;
  onFailure(key: string, error: unknown): Promise<void>;
}
```

### 3.3 Logging & metrics

```ts
export interface LoggerMeta {
  requestId?: string;
  client?: string;
  operation?: string;
  status?: number;
  attempt?: number;
  cacheHit?: boolean;
  durationMs?: number;
  errorCategory?: ErrorCategory;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, meta?: LoggerMeta): void;
  info(message: string, meta?: LoggerMeta): void;
  warn(message: string, meta?: LoggerMeta): void;
  error(message: string, meta?: LoggerMeta): void;
}

export interface MetricsRequestInfo {
  client: string;
  operation: string;
  durationMs: number;
  status: number; // 0 allowed for network errors
  cacheHit?: boolean;
  attempt?: number;
  pageSize?: number;
  pageOffset?: number;
}

export interface MetricsSink {
  recordRequest?(info: MetricsRequestInfo): void | Promise<void>;
}
```

### 3.4 Error model (enhanced)

```ts
export type ErrorCategory =
  | 'rate_limit'
  | 'quota_exceeded'
  | 'auth'
  | 'validation'
  | 'not_found'
  | 'server'
  | 'network'
  | 'timeout'
  | 'unknown';

export interface FallbackHint {
  retryAfterMs?: number;
  suggestBackoffFactor?: number; // e.g. x2, x4
  considerDownscaling?: boolean; // use fewer symbols/smaller model/etc.
  considerCachedData?: boolean;  // safe to use stale cache
  considerStopCalling?: boolean; // e.g., quota exhausted
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
    public readonly headers?: Record<string, string>,
    public readonly category: ErrorCategory = 'unknown',
    public readonly fallback?: FallbackHint,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class TimeoutError extends Error {
  constructor(message = 'Request timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}
```

### 3.5 Response classifier hook

Allows domain clients (e.g., FINRA) to map non‑standard success payloads to errors.

```ts
export interface ResponseClassification {
  treatAsError?: boolean;
  overrideStatus?: number;
  category?: ErrorCategory;
  fallback?: FallbackHint;
}

export type ResponseClassifier = (
  response: Response,
  bodyText: string
) => ResponseClassification | void;
```

- Default: `undefined` → core uses standard HTTP status logic.
- Domain clients may supply a classifier via config.

### 3.6 Agent / tool call context & budgets

These are **pure metadata**; core doesn’t enforce global budgets, but will honour per‑request limits.

```ts
export interface HttpRequestBudget {
  maxTotalDurationMs?: number; // wall-clock upper bound for this request
  maxAttempts?: number;        // overrides config.maxRetries for this call
  maxCostUnits?: number;       // domain-specific cost hint (e.g. tokens)
}

export interface AgentContext {
  agentName?: string;
  sessionId?: string;
  toolName?: string;
  toolCallId?: string; // unique per agent tool invocation
  [key: string]: unknown;
}
```

### 3.7 Tracing adapter (OTEL‑ready)

```ts
export interface TracingSpan {
  spanId: string;
  end(error?: Error): void;
}

export interface TracingAdapter {
  startSpan(
    name: string,
    attributes?: Record<string, unknown>
  ): TracingSpan;
}
```

- The core **does not depend on OTEL**.
- A separate adapter package can map this to `@opentelemetry/api`.

### 3.8 Client config & request options

```ts
export interface BaseHttpClientConfig {
  baseUrl: string;
  clientName: string; // e.g. 'finra', 'unusualwhales', 'openai'

  timeoutMs?: number;   // default: 30000
  maxRetries?: number;  // default: 3

  logger?: Logger;
  metrics?: MetricsSink;
  cache?: HttpCache;
  rateLimiter?: HttpRateLimiter;
  circuitBreaker?: CircuitBreaker;
  tracing?: TracingAdapter;
  responseClassifier?: ResponseClassifier;

  /**
   * Optional policy engine hook (cockatiel, resilience4ts, etc.).
   * The core will call this to wrap a single attempt.
   */
  policyWrapper?: <T>(
    fn: () => Promise<T>,
    context: { client: string; operation: string }
  ) => Promise<T>;

  transport?: HttpTransport; // default: fetchTransport
}

export interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string; // relative to baseUrl

  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string | undefined>;
  body?: unknown; // auto-JSON-encoded unless already a string/Buffer

  operation: string;  // stable operation name for metrics/logs
  idempotent?: boolean; // default: true for GET/HEAD, false otherwise

  cacheKey?: string;
  cacheTtlMs?: number;

  requestId?: string;     // correlates logs/metrics/spans
  budget?: HttpRequestBudget;
  agentContext?: AgentContext;

  pageSize?: number;      // optional pagination hints for metrics
  pageOffset?: number;
}
```

---

## 4. `HttpClient` Behaviour

`HttpClient` lives in `src/HttpClient.ts`.

```ts
export class HttpClient {
  constructor(private readonly config: BaseHttpClientConfig) {}

  async requestJson<T>(opts: HttpRequestOptions): Promise<T> {
    // JSON-focused helper, as in v0.1.0, plus enhancements.
  }

  async requestRaw(opts: HttpRequestOptions): Promise<Response> {
    // For streaming or non-JSON payloads (see section 8).
  }
}
```

### 4.1 URL & request construction

- Normalise `baseUrl` and `opts.path` to avoid double slashes.
- Serialize `opts.query` into a query string, omitting undefined values.
- Build headers:
  - Start from `opts.headers`.
  - Auto‑set `Content-Type: application/json` if `body` is a plain object and header not already set.
- For `requestJson`, **always** parse `response.text()` and then JSON.

### 4.2 Timeout & budgets

- For each call, compute an effective timeout:

  ```ts
  const timeoutMs = opts.budget?.maxTotalDurationMs ?? config.timeoutMs ?? 30000;
  ```

- Use `AbortController` to enforce this per attempt (the outer budget effectively caps total operations; per‑attempt budgets are derived from this and `maxRetries`).
- Throw `TimeoutError` on timeout.

### 4.3 Cache semantics

- If `config.cache`, `opts.cacheKey`, and `opts.cacheTtlMs > 0`:
  - Try `cache.get(cacheKey)` before making a network call.
  - On hit:
    - Log debug.
    - Record metrics with `cacheHit: true`, `attempt: 0`.
    - Return cached value.
  - On cache errors:
    - Log warn and continue to network (fail‑open behaviour; fail‑closed logic, if desired, is implemented in the cache itself).
- After a successful response:
  - Asynchronously call `cache.set(cacheKey, parsedValue, cacheTtlMs)`.
  - Log and swallow any cache errors.

### 4.4 Rate limiter & circuit breaker

- Compute `rateLimitKey = `${clientName}:${opts.operation}``.
- Construct a `RateLimiterContext` from `opts.agentContext` plus `operation`.
- For each attempt:
  - Before HTTP:
    - `rateLimiter.throttle(rateLimitKey, ctx)`.
    - `circuitBreaker.beforeRequest(rateLimitKey)`.
  - After attempt:
    - On success: `rateLimiter.onSuccess`, `circuitBreaker.onSuccess`.
    - On failure: `rateLimiter.onError`, `circuitBreaker.onFailure`.

### 4.5 Tracing

- If `config.tracing` is provided:
  - Start a span per call with name `${clientName}.${opts.operation}` and attributes:
    - `http.method`, `http.url` (sanitised), `client`, `operation`, `requestId`.
  - End span on success or error.

### 4.6 Response classification & error handling

1. Execute a single attempt with the transport and timeout.
2. Get `status` and `bodyText`.
3. If `config.responseClassifier` exists:
   - Call it with `(response, bodyText)`.
   - Merge any overrides into the decision (e.g. treat a 200 with "No data" as a `not_found` error).
4. Determine whether the request is successful:
   - If `treatAsError` from classifier, or `status >= 400`, construct an `HttpError` with:
     - `status` (possibly `overrideStatus`)
     - `bodyText`
     - `headers`
     - `category` from classifier or inferred from status
     - `fallback` from classifier or inferred from headers (e.g. `Retry-After`).
5. For `requestJson`, JSON‑parse the body on success and return `T`.

### 4.7 Retry & backoff

- Effective max attempts =

  ```ts
  const maxAttempts = opts.budget?.maxAttempts
    ?? (config.maxRetries ?? 3) + 1; // retries + initial
  ```

- Retry on:
  - `TimeoutError`
  - `HttpError` with `category` in `{ 'rate_limit', 'server', 'network', 'timeout' }`.
- Don’t retry when:
  - `opts.idempotent === false`.
  - `category` is `auth`, `validation`, `not_found`, `quota_exceeded` (unless overridden by higher‑level policy via `policyWrapper`).
- Backoff:
  - If `fallback.retryAfterMs` is present, sleep that long (bounded by a sane max).
  - Else, exponential backoff with jitter.

### 4.8 Policy wrapper

- Define `executeAttempt` (single HTTP attempt).
- If `config.policyWrapper` is provided, wrap the attempt with it:

  ```ts
  const exec = config.policyWrapper
    ? () => config.policyWrapper(executeAttempt, { client: clientName, operation: opts.operation })
    : executeAttempt;
  ```

- The outer retry loop calls `exec()` for each attempt.

### 4.9 Logging & metrics

- For each attempt:
  - Log `debug`/`info`/`warn`/`error` with `LoggerMeta` containing at least: `requestId`, `client`, `operation`, `status`, `attempt`, `cacheHit`, `durationMs`, `errorCategory`.
  - Call `metrics.recordRequest` with `MetricsRequestInfo`.

---

## 5. Transport Helpers

### 5.1 Fetch transport

`src/transport/fetchTransport.ts`:

```ts
export const fetchTransport: HttpTransport = (url, init) => fetch(url, init);
```

- Used as the default when no custom `transport` is provided.

### 5.2 Axios transport adapter

`src/transport/axiosTransport.ts`:

- Accepts an `AxiosInstance` (type‑only import) and returns a `HttpTransport` by mapping axios responses to `Response`.
- Core does **not** depend on axios at runtime.

---

## 6. Integration Guidance for Domain Clients

### 6.1 FINRA client

- Implement `FinraClient` using a single internal `HttpClient` configured with:
  - `clientName: 'finra'`.
  - `responseClassifier` that recognises payloads such as "No data found" and maps them to `ErrorCategory: 'not_found'` when appropriate.
- Use `defaultCacheTtls` per endpoint (weekly summary, short interest, etc.).
- Ensure all weekly summary calls use **week start date** semantics.

### 6.2 Unusual Whales client

- Implement `UnusualWhalesClient` with `clientName: 'unusualwhales'`.
- Optionally set a `responseClassifier` if UW returns non‑standard error payloads.
- Use TTLs only for slow‑moving or historical endpoints.

### 6.3 OpenAI client (non‑streaming)

- Implement `OpenAiClient` with `clientName: 'openai'`.
- Add default headers for `Authorization` and JSON.
- Map OpenAI error payloads into `ErrorCategory` and `FallbackHint`:
  - 429 rate limit vs quota exceeded.
  - 401/403 auth.
  - 400 validation.

---

## 7. Agentic Integration (Hooks Only)

The core **does not implement** an agent framework. It only:

- Carries `AgentContext` in `HttpRequestOptions`.
- Carries `RateLimiterContext` into the rate limiter.
- Supports per‑request budgets via `HttpRequestBudget`.
- Classifies errors to make them machine‑readable.

Higher‑level agent packages can:

- Wrap `HttpClient` with:
  - Conversation/task‑level time & cost budgets.
  - Per‑tool call metrics dashboards.
  - Intelligent backoff / fallback strategies based on `ErrorCategory` and `FallbackHint`.

This keeps `@tradentic/resilient-http-core` small and re‑usable, and allows a future `resilient-http-agent-adapter` (in its own repo) to provide richer AI‑specific behaviour.

---

## 8. OpenAI Streaming Support Pattern

Streaming is domain‑specific (OpenAI SSE / chunked responses). To support it without polluting the core:

1. **Core responsibility**:
   - Provide `requestRaw(opts: HttpRequestOptions): Promise<Response>`:
     - Applies the same preflight logic: rate limit, circuit breaker, timeout, tracing, logging, metrics.
     - Performs at most **one attempt** (no retries once a stream has started).
     - Returns the raw `Response` so the caller can consume `response.body` as a stream.
   - Error classification still applies based on initial headers & status.

2. **OpenAI client responsibility**:
   - Implement `createChatCompletionStream` (or similar) that:
     - Calls `httpClient.requestRaw` with `operation: 'chatCompletions.stream'`.
     - Asserts `response.ok`.
     - Parses the SSE / chunked body from `response.body`.
     - Emits domain‑level events or an async iterator of chunks.
   - It may choose to:
     - Apply additional OpenAI‑specific logic (e.g. decoding `data: [DONE]`).

3. **Agent layer**:
   - For streaming tools, the agent orchestrator can:
     - Use a shorter `timeoutMs` or `maxTotalDurationMs` for tool calls.
     - Use `requestId` / `toolCallId` to tie logs and spans together.

By keeping streaming logic in the OpenAI client and only exposing `requestRaw` in the core, we avoid coupling `resilient-http-core` to OpenAI semantics while still centralising resilience.

---

## 9. Telemetry & OTEL Integration (Out‑of‑Core)

The core provides:

- `MetricsSink`
- `Logger`
- `TracingAdapter`

**Adapters** to OTEL, pino, winston, etc., live in **separate packages** such as:

- `@tradentic/resilient-http-otel`
- `@tradentic/resilient-http-logging-pino`

These adapters:

- Implement `MetricsSink` and/or `TracingAdapter`.
- Compose with existing OTEL SDKs or loggers.

This design keeps `@tradentic/resilient-http-core` independent and portable while making it straightforward to wire into rich telemetry stacks when needed.

---

## 10. Testing & Rollout

Tests (unit level) must cover:

- Existing v0.1.0 behaviours (success, retry, cache, errors).
- New behaviours:
  - Error classification (`ErrorCategory`).
  - Response classifier hook.
  - Budgets (`maxTotalDurationMs`, `maxAttempts`).
  - Agent/RateLimiter context propagation.
  - Tracing hook invocation (using a fake `TracingAdapter`).
  - `requestRaw` semantics (single attempt, no JSON parsing).

Rollout:

- Version `@tradentic/resilient-http-core` as `0.2.0`.
- Update domain clients (FINRA, UW, OpenAI) to:
  - Use `requestJson`/`requestRaw` where appropriate.
  - Configure `responseClassifier` and error mappings.
  - Optionally pass agent context / budgets where the Temporal worker or higher layers support it.

---

## 11. Summary

v0.2.0 keeps the core philosophy of v0.1.0 but:

- Makes the library **agent-aware** (via metadata and budgets) without binding it to any specific agent framework.
- Standardises **error classification and fallback hints** so higher layers can react intelligently.
- Adds **response classification hooks** to normalise odd APIs like FINRA.
- Provides a clean, minimal pattern for **OpenAI streaming** via `requestRaw`, with streaming logic in the OpenAI client.
- Enables rich **telemetry and OTEL integration** via adapters, not hard dependencies.

The library remains small, transport‑agnostic, domain‑agnostic, and is ready to be split into its own repo in the future without redesign.

