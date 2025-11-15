# Resilient HTTP Core — Architecture & Implementation Spec (v0.1.0)

## 1. Purpose & Context

This spec defines a reusable, framework‑agnostic **Resilient HTTP Core** library to be used across the **institutional‑rotation‑detector** monorepo (and future Airnub/Tradentic projects).

The core library will:

- Provide a **minimal but powerful HTTP abstraction** for API clients (FINRA, Unusual Whales, OpenAI, etc.).
- Centralise cross‑cutting concerns:
  - Retries & backoff
  - Timeouts
  - Caching
  - Rate limiting
  - Circuit‑breaking
  - Logging & metrics
- Use **Node’s built‑in `fetch`** (Undici in Node ≥ 18) as the default transport.
- Allow developers to plug in advanced resilience libraries like **cockatiel** or **resilience4ts** as *optional* policy engines.
- Allow developers to use any HTTP stack (axios, custom fetch, etc.) via **transport adapters**, without hard dependencies.

This replaces the idea of a custom `libs/http-client-core` with a more focused and extensible **resilient HTTP core** that remains small, dependency‑light, and library‑agnostic.

Working name (folder & package):

- Folder: `libs/resilient-http-core`
- Package name: `@tradentic/resilient-http-core`

If desired, an alias package `@tradentic/http-core` can be created in future; for v0.1.0 we standardise on `resilient-http-core`.

---

## 2. High‑Level Goals

### 2.1 Functional Goals

1. **Shared HTTP Types & Behaviour**
   - Single source of truth for:
     - `HttpCache`, `HttpRateLimiter`, `CircuitBreaker`, `Logger`, `MetricsSink`, `HttpTransport`.
   - A generic `HttpClient` that handles:
     - URL building and query encoding
     - Timeouts (via AbortController)
     - Retries and exponential backoff (with jitter)
     - Handling of `Retry-After` header where present
     - Optional caching
     - Optional rate limiting & circuit‑breaking
     - Logging and metrics hooks

2. **Transport Agnostic, Fetch‑First**
   - Default transport: Node’s global `fetch`.
   - Additional adapters (axios, etc.) are **opt‑in** and provided as helpers that accept a caller‑supplied instance.

3. **Policy Engine Agnostic**
   - No hard dependency on cockatiel, resilience4ts, or resilience-typescript.
   - Public hook `policyWrapper` to integrate any resilience library that wraps async functions.

4. **Reuse Across Client Libraries**
   - `libs/finra-client`, `libs/unusualwhales-client`, and `libs/openai-client` must all use `@tradentic/resilient-http-core` for:
     - Shared types
     - Shared HTTP behaviour
   - Remove duplicated retry/cache/logging logic from those clients.

5. **Simplify Temporal Redis Types**
   - `apps/temporal-worker/src/lib/redisApiCache.ts` and `redisRateLimiter.ts` should implement `HttpCache` and `HttpRateLimiter` directly.
   - Eliminate intersection types like `FinraCache & UwCache & OpenAiCache`.

### 2.2 Non‑Goals

- Do **not** introduce a mandatory dependency on:
  - cockatiel
  - resilience4ts
  - resilience-typescript
  - axios (or any other HTTP client)
- Do not bake FINRA/UW/OpenAI domain logic into the core.
- Do not attempt to be a full “kitchen sink” HTTP client with every possible feature.
- Do not redesign public APIs of existing clients beyond what’s required to route through `resilient-http-core`; aim for backwards compatibility.

---

## 3. Naming & Structure

### 3.1 Library Structure

New library:

- Path: `libs/resilient-http-core`
- Example `package.json` name: `"@tradentic/resilient-http-core"`
- Exports:
  - Core types (`HttpCache`, `HttpRateLimiter`, `CircuitBreaker`, `Logger`, `MetricsSink`, `HttpTransport`)
  - `BaseHttpClientConfig`, `HttpRequestOptions`
  - `HttpClient` implementation
  - Transport helpers:
    - `fetchTransport` (default)
    - `createAxiosTransport(axiosInstance)` (optional helper; axios not a dependency)

### 3.2 Future Adapter Packages (Optional)

Additional small packages may be added later (not part of v0.1.0 implementation, but supported by design):

- `@tradentic/resilient-http-core-cockatiel`
- `@tradentic/resilient-http-core-resilience4ts`

These would supply helper functions to build a `policyWrapper` from cockatiel or resilience4ts policies.

---

## 4. Core Types & Interfaces

All types live in `libs/resilient-http-core/src/types.ts` and are exported via `src/index.ts`.

### 4.1 `HttpCache`

```ts
export interface HttpCache {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}
```

Notes:

- `ttlMs` is the TTL in milliseconds from the time of `set`.
- Implementations may choose fail‑open vs fail‑closed semantics (configurable at construction time).

### 4.2 `HttpRateLimiter`

```ts
export interface HttpRateLimiter {
  throttle(key: string, context?: Record<string, unknown>): Promise<void>;

  onSuccess?(key: string, context?: Record<string, unknown>): void | Promise<void>;

  onError?(key: string, error: unknown, context?: Record<string, unknown>):
    | void
    | Promise<void>;
}
```

Notes:

- `key` typically encodes client + operation (e.g., `"finra:getWeeklySummary"`).
- `context` can include metadata such as account, symbol, or request ID.

### 4.3 `CircuitBreaker`

```ts
export interface CircuitBreaker {
  beforeRequest(key: string): Promise<void>;
  onSuccess(key: string): Promise<void>;
  onFailure(key: string, error: unknown): Promise<void>;
}
```

Notes:

- Implementations may throw in `beforeRequest` if circuit is open.

### 4.4 `Logger`

```ts
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
```

Notes:

- No assumptions about logging backend; Temporal worker may use its own logger, apps may use pino/winston/console.

### 4.5 `MetricsSink`

```ts
export interface MetricsSink {
  recordRequest?(info: {
    client: string;
    operation: string;
    durationMs: number;
    status: number;
    cacheHit?: boolean;
    attempt?: number;
  }): void | Promise<void>;
}
```

Notes:

- Designed to be compatible with simple logging, Prometheus metrics, or more advanced telemetry.

### 4.6 `HttpTransport`

```ts
export interface HttpTransport {
  (url: string, init: RequestInit): Promise<Response>;
}
```

Notes:

- Default transport uses Node’s global `fetch`.
- Alternative transports (axios, custom fetch, test doubles) must conform to this interface.

### 4.7 Client Config & Request Options

```ts
export interface BaseHttpClientConfig {
  baseUrl: string;
  clientName: string; // e.g., 'finra', 'unusualwhales', 'openai'

  timeoutMs?: number; // default: ~30000
  maxRetries?: number; // default: 3

  logger?: Logger;
  metrics?: MetricsSink;
  cache?: HttpCache;
  rateLimiter?: HttpRateLimiter;
  circuitBreaker?: CircuitBreaker;

  /**
   * Optional policy engine hook.
   *
   * If provided, the HttpClient will use this to wrap the
   * low-level "doSingleAttempt" function, enabling integration
   * with cockatiel, resilience4ts, etc.
   */
  policyWrapper?: <T>(
    fn: () => Promise<T>,
    context: { client: string; operation: string }
  ) => Promise<T>;

  transport?: HttpTransport; // default: fetchTransport
}

export interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string; // path relative to baseUrl; may (or may not) start with '/'

  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string | undefined>;
  body?: unknown; // will be JSON-encoded by default

  operation: string; // stable name for metrics/logging, e.g. 'weeklySummary.get'

  idempotent?: boolean; // influences retry; default true for GET/HEAD
  cacheKey?: string;    // if provided, enables cache lookups when cacheTtlMs > 0
  cacheTtlMs?: number;  // time to cache successful responses (ms)
}
```

---

## 5. `HttpClient` Behaviour

`HttpClient` is the central implementation in `libs/resilient-http-core/src/HttpClient.ts`.

### 5.1 Class Skeleton

```ts
export class HttpClient {
  constructor(private readonly config: BaseHttpClientConfig) {}

  async requestJson<T>(opts: HttpRequestOptions): Promise<T> {
    // Implementation details below.
  }
}
```

### 5.2 URL & Request Construction

1. Ensure `baseUrl` ends without a trailing slash (or handle double slashes robustly).
2. Combine `baseUrl` + `opts.path` into a full URL.
3. Serialize `opts.query` into query string; skip undefined values.
4. For `opts.body`:
   - If `body` is `undefined`, omit.
   - Otherwise, JSON.stringify by default and set `Content-Type: application/json` (unless explicitly overridden in `opts.headers`).

### 5.3 Timeout Handling

- Honour `config.timeoutMs` per request.
- Use `AbortController` to abort the `fetch` call if timeout elapses.
- Treat timeout as a transient error, eligible for retry (subject to `maxRetries` and `idempotent`).

### 5.4 Retry & Backoff Strategy

Defaults (align with FINRA/UW existing behaviour):

- `maxRetries` default: 3 (meaning up to 4 total attempts including the first).
- Retry on:
  - HTTP status 408, 429, 500, 502, 503, 504
  - Network/transport errors (including timeout)
- Respect `Retry-After` header when present:
  - If header present and parseable, use it as delay (cap at some reasonable max, e.g., 30–60 seconds).
- Otherwise use exponential backoff with jitter, e.g.:
  - `baseDelayMs = 250` (configurable in implementation)
  - `delay = baseDelayMs * 2 ** attempt + randomJitter(-0.2..+0.2)`
- Honour `opts.idempotent`:
  - If `idempotent === false`, you may choose not to retry on some statuses (e.g., 5xx) to avoid duplicate side effects.

### 5.5 Cache Semantics

If both `config.cache` and `opts.cacheTtlMs` are provided and `opts.cacheKey` is non‑empty:

1. **Before network call**
   - `cache.get(cacheKey)`
   - If non‑undefined, treat as cache hit:
     - `metrics.recordRequest` with `cacheHit: true`, `attempt: 0`, `status: 200` (or some synthetic code; doc behaviour).
     - Return cached value as `T`.

2. **After successful network response**
   - `cache.set(cacheKey, parsedJson, cacheTtlMs)`

Notes:

- Cache implementations (e.g., RedisApiCache) are free to fail open or fail closed based on their own config.
- Errors during `get`/`set` must **not** prevent the main request from completing unless explicitly configured.

### 5.6 Rate Limiter & Circuit Breaker Hooks

For each attempt:

1. Compute a rate‑limit key, e.g. `rateLimitKey = `${config.clientName}:${opts.operation}`.`

2. If `config.rateLimiter` exists:
   - Before request:
     - `await rateLimiter.throttle(rateLimitKey, { method, path, operation })`

3. If `config.circuitBreaker` exists:
   - `await circuitBreaker.beforeRequest(rateLimitKey)`

4. After each attempt:
   - On success:
     - `rateLimiter.onSuccess?.(rateLimitKey, ctx)`
     - `circuitBreaker.onSuccess(rateLimitKey)`
   - On failure:
     - `rateLimiter.onError?.(rateLimitKey, error, ctx)`
     - `circuitBreaker.onFailure(rateLimitKey, error)`

### 5.7 Policy Wrapper Integration

If `config.policyWrapper` is defined:

- Wrap the **inner single‑attempt logic** with `policyWrapper`.

Example flow:

```ts
const executeAttempt = async () => {
  // 1. rateLimiter.throttle
  // 2. circuitBreaker.beforeRequest
  // 3. do fetch with timeout
  // 4. handle status codes & parse JSON
};

const execWithPolicy = config.policyWrapper
  ? () => config.policyWrapper(executeAttempt, {
      client: config.clientName,
      operation: opts.operation,
    })
  : executeAttempt;

// Retry loop wraps execWithPolicy, not executeAttempt directly.
```

This allows callers to use cockatiel, resilience4ts, or any other policy engine without coupling `resilient-http-core` to them.

### 5.8 Logging & Metrics

- Before request (debug):
  - `logger?.debug('http.request.start', {...})`
- After response (info/warn/error):
  - On success: `info` with status, duration, attempt count.
  - On error but before final retry: `warn`.
  - On final failure: `error`.
- Metrics:
  - Call `metrics.recordRequest` **once per attempt** with:
    - `client`, `operation`, `durationMs`, `status`, `cacheHit`, `attempt`.

---

## 6. Transport Helpers

### 6.1 Default Fetch Transport

`libs/resilient-http-core/src/transport/fetchTransport.ts`:

```ts
export const fetchTransport: HttpTransport = (url, init) => {
  return fetch(url, init);
};
```

Notes:

- For Node ≥ 18, `fetch` is globally available.
- For environments without global `fetch`, the app can supply a custom transport.

### 6.2 Axios Transport Adapter

`libs/resilient-http-core/src/transport/axiosTransport.ts`:

```ts
import type { AxiosInstance } from 'axios';

export function createAxiosTransport(axios: AxiosInstance): HttpTransport {
  return async (url, init) => {
    const response = await axios.request({
      url,
      method: init.method as any,
      headers: init.headers as any,
      data: init.body,
      validateStatus: () => true,
    });

    // Normalise into a Fetch-like Response.
    const body = typeof response.data === 'string'
      ? response.data
      : JSON.stringify(response.data);

    return new Response(body, {
      status: response.status,
      headers: response.headers as any,
    });
  };
}
```

Notes:

- `@tradentic/resilient-http-core` **does not** depend on axios; this file only types against it.
- Consumers who want axios must:
  - Install axios themselves.
  - Construct an axios instance.
  - Pass `transport: createAxiosTransport(axiosInstance)` into their client config.

---

## 7. Integration with Existing Clients

### 7.1 FINRA Client (`libs/finra-client`)

**Goal:** Replace internal HTTP types and retry logic with `resilient-http-core` while keeping public API stable.

Steps:

1. Remove local HTTP abstractions:
   - Delete or deprecate local `RateLimiter`, `Cache`, `CircuitBreaker`, `Logger`, `Metrics`, `HttpTransport` types.
2. Import shared types from `@tradentic/resilient-http-core`:

   ```ts
   import type {
     HttpCache,
     HttpRateLimiter,
     CircuitBreaker,
     Logger,
     MetricsSink,
     HttpTransport,
     HttpClient,
   } from '@tradentic/resilient-http-core';
   ```

3. Update `FinraClientConfig`:

   ```ts
   export interface FinraCacheTtls {
     weeklySummaryMs?: number;
     weeklySummaryHistoricMs?: number;
     consolidatedShortInterestMs?: number;
     regShoDailyMs?: number;
     thresholdListMs?: number;
   }

   export interface FinraClientConfig {
     baseUrl: string; // existing or new
     apiKey?: string; // if applicable

     cache?: HttpCache;
     rateLimiter?: HttpRateLimiter;
     circuitBreaker?: CircuitBreaker;
     logger?: Logger;
     metrics?: MetricsSink;
     transport?: HttpTransport;

     timeoutMs?: number;
     maxRetries?: number;

     defaultCacheTtls?: FinraCacheTtls;

     policyWrapper?: BaseHttpClientConfig['policyWrapper'];
   }
   ```

4. Construct an internal `HttpClient`:

   ```ts
   class FinraClient {
     private http: HttpClient;

     constructor(private readonly config: FinraClientConfig) {
       this.http = new HttpClient({
         baseUrl: config.baseUrl,
         clientName: 'finra',
         timeoutMs: config.timeoutMs ?? 30000,
         maxRetries: config.maxRetries ?? 3,
         cache: config.cache,
         rateLimiter: config.rateLimiter,
         circuitBreaker: config.circuitBreaker,
         logger: config.logger,
         metrics: config.metrics,
         policyWrapper: config.policyWrapper,
         transport: config.transport,
       });
     }

     // existing methods delegate to this.http.requestJson
   }
   ```

5. Update each FINRA method to call `this.http.requestJson` using:
   - `operation` = stable name (e.g., `weeklySummary.get`, `shortInterest.get`)
   - Appropriate `cacheKey` & `cacheTtlMs` using `defaultCacheTtls` when `options.cacheTtlMs` not specified.

6. Ensure FINRA normalisation logic (`createNormalizedRow`) is left intact but used consistently; remove duplicate row normalisation in Temporal activities where possible.

### 7.2 UnusualWhales Client (`libs/unusualwhales-client`)

Same pattern as FINRA:

1. Delete/replace local HTTP types with imports from `@tradentic/resilient-http-core`.
2. Add `defaultCacheTtls` for safe-to-cache endpoints (e.g., seasonality, slow-moving metrics).
3. Build `HttpClient` with `clientName: 'unusualwhales'`.
4. Wire each method to `requestJson` with appropriate `operation`, `cacheKey`, `cacheTtlMs`.
5. Be conservative for near-real-time endpoints (e.g., intraday options flow): default to no cache unless explicitly requested.

### 7.3 OpenAI Client (`libs/openai-client`)

1. Replace ad‑hoc HTTP logic with `HttpClient` and shared types.
2. Define `OpenAiClientConfig`:

   ```ts
   export interface OpenAiCacheTtls {
     listModelsMs?: number;
     listFilesMs?: number;
   }

   export interface OpenAiClientConfig {
     apiKey: string;
     baseUrl?: string; // default: 'https://api.openai.com/v1'

     cache?: HttpCache;
     rateLimiter?: HttpRateLimiter;
     circuitBreaker?: CircuitBreaker;
     logger?: Logger;
     metrics?: MetricsSink;
     transport?: HttpTransport;
     timeoutMs?: number;
     maxRetries?: number;
     defaultCacheTtls?: OpenAiCacheTtls;
     policyWrapper?: BaseHttpClientConfig['policyWrapper'];
   }
   ```

3. Construct `HttpClient` with `clientName: 'openai'`.
4. Implement typed methods:
   - `createChatCompletion`
   - `createEmbedding`
   - `listModels` (with default cache TTL from `defaultCacheTtls.listModelsMs`)
   - Any other endpoints in current use.
5. Implement factory function `createOpenAiClientFromEnv` that reads `OPENAI_API_KEY` and `OPENAI_BASE_URL` and accepts overrides for cache/rateLimiter/transport/policyWrapper.

---

## 8. Temporal Worker Integration

### 8.1 Redis Cache & Rate Limiter Types

In `apps/temporal-worker/src/lib/redisApiCache.ts`:

- Implement `HttpCache` directly:

  ```ts
  import type { HttpCache } from '@tradentic/resilient-http-core';

  export class RedisApiCache implements HttpCache {
    // existing redis connection / constructor options (namespace, failOpen, etc.)
    // implement get/set/delete according to HttpCache
  }
  ```

In `apps/temporal-worker/src/lib/redisRateLimiter.ts`:

- Implement `HttpRateLimiter` directly:

  ```ts
  import type { HttpRateLimiter } from '@tradentic/resilient-http-core';

  export class RedisRateLimiter implements HttpRateLimiter {
    // existing logic for rate limiting, with optional failOpen/failClosed semantics
  }
  ```

### 8.2 Client Wiring

In:

- `apps/temporal-worker/src/lib/finraClient.ts`
- `apps/temporal-worker/src/lib/unusualWhalesClient.ts`
- `apps/temporal-worker/src/lib/openaiClient.ts`

Perform the following:

1. Instantiate a single shared `RedisApiCache` (or one per logical namespace) implementing `HttpCache`.
2. Instantiate a `RedisRateLimiter` implementing `HttpRateLimiter` (with appropriate `identifier`, `maxPerSecond`, namespaces, failOpen config).
3. Construct clients using their new configs, passing in:
   - `cache`, `rateLimiter`
   - (optional) `policyWrapper` if/when future adapters are added

Ensure memoisation so that only one instance of each client exists per worker process.

### 8.3 FINRA Weekly Summary Semantics

- In `apps/temporal-worker/src/activities/finra.activities.ts`, ensure that:
  - Functions dealing with weekly summary explicitly use a `weekStartDate` parameter (first business day / Monday according to FINRA docs).
  - All call sites convert arbitrary dates to the correct week start using a helper like `getFinraWeekStartDate(date: string): string`.
  - JSDoc comments reflect this for future maintainers.

---

## 9. Example: Cockatiel Integration (Future Adapter)

*This is not required for v0.1.0, but the design should support it.*

`@tradentic/resilient-http-core-cockatiel` might export:

```ts
import { Policy, handleAll } from 'cockatiel';
import type { BaseHttpClientConfig } from '@tradentic/resilient-http-core';

export function createCockatielPolicyWrapper(
  options?: { maxAttempts?: number; timeoutMs?: number }
): BaseHttpClientConfig['policyWrapper'] {
  const retryPolicy = Policy.handleAll().retry().attempts(options?.maxAttempts ?? 3);

  // Optional: circuit breaker, timeout, etc.

  const combined = Policy.wrap(retryPolicy /*, circuitBreaker, timeout, etc.*/);

  return async <T>(fn: () => Promise<T>, _ctx: { client: string; operation: string }) => {
    return combined.execute(fn);
  };
}
```

Consumers can then pass:

```ts
const policyWrapper = createCockatielPolicyWrapper();

const client = new HttpClient({
  baseUrl: 'https://api.example.com',
  clientName: 'example',
  policyWrapper,
  // ... other config
});
```

No changes required in `resilient-http-core` itself.

---

## 10. Testing & Validation

### 10.1 Unit Tests

Add tests under `libs/resilient-http-core/src/__tests__` for:

- `HttpClient` basic success path:
  - GET, POST with JSON body
- Timeout behaviour:
  - Simulated slow transport, assert abort
- Retry logic:
  - Simulate transient 5xx responses and ensure retry backoff
  - Respect `maxRetries`
- Cache behaviour:
  - With and without cache configured
  - Cache hit short‑circuit
- Rate limiter & circuit breaker hooks:
  - Ensure `throttle`, `beforeRequest`, `onSuccess`, `onFailure` are called appropriately
- Policy wrapper:
  - Inject a mock wrapper that counts executions, ensure it’s invoked

### 10.2 Integration Tests (within repo)

- Update finra/unusualwhales/openai client tests to use the new `HttpClient`.
- Ensure `apps/temporal-worker` builds and its tests pass, including:
  - Redis cache/rate limiter typing
  - FINRA weekly summary date usage

---

## 11. Versioning & Rollout

- Initial version: `@tradentic/resilient-http-core@0.1.0`.
- Changes to existing clients (FINRA, UW, OpenAI) should be released as minor versions if public APIs remain stable; bump major only if unavoidable breaking changes occur.
- Keep the implementation small and focused; revisit in future if we need:
  - Streaming support
  - Advanced per‑operation policy configuration
  - Auto‑generated client wrappers.

---

## 12. Summary

- We introduce a small, focused **Resilient HTTP Core** library to unify HTTP behaviour across FINRA, UW, and OpenAI clients.
- The core is **fetch‑first**, **policy‑agnostic**, and **transport‑pluggable**.
- FINRA/UW/OpenAI clients migrate to this core, eliminating duplicated HTTP logic and simplifying Redis integration in the Temporal worker.
- The design deliberately **does not** fork or depend on cockatiel, resilience4ts, or resilience-typescript, but allows them to be integrated via the `policyWrapper` hook or small adapter packages.
- This provides a solid foundation for expansion across the broader Airnub/Tradentic ecosystem while keeping the current repo clean, testable, and resilient by default.

