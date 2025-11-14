# HTTP Client Library Specification — FINRA & Unusual Whales

**Project:** Institutional Rotation Detector  
**Libraries:**
- `@tradentic/finra-client` (libs/finra-client)
- `@tradentic/unusualwhales-client` (libs/unusualwhales-client)

**Version:** v0.1.0 (spec)  
**Audience:** Library authors + application developers (Temporal worker, future services)

---

## 1. Goals & Design Principles

### 1.1 Primary Goals

1. Provide **robust, typed, reusable HTTP clients** for FINRA and Unusual Whales APIs.
2. Work **out-of-the-box** with zero additional dependencies (no Redis, no Upstash, no Temporal required).
3. Allow **easy opt-in integration** with:
   - In-memory & distributed **rate limiting** (e.g., Redis, @upstash/ratelimit).
   - In-memory & distributed **caching** (e.g., Redis, Upstash Redis).
   - **Circuit breakers**, custom logging and metrics, and pluggable HTTP transports.
4. Respect **upstream API rate limits**, including 429 responses and `Retry-After` headers, not just local limits.
5. Provide **strong typing** and a friendly API surface: named methods per endpoint, no `any` in public APIs.

### 1.2 Non-Goals

- Do not embed **Temporal**, Redis, Upstash, or any infra-specific dependencies inside the core libraries.
- Do not implement WebSocket clients in this spec (HTTP-only).
- Do not enforce a specific logging, metrics, or circuit-breaker framework; only provide hooks.

---

## 2. Library Layout & Packages

### 2.1 Core Packages

- **FINRA client**
  - NPM name: `@tradentic/finra-client`
  - Repo location: `libs/finra-client`
- **Unusual Whales client**
  - NPM name: `@tradentic/unusualwhales-client`
  - Repo location: `libs/unusualwhales-client`

Both packages:

- Are pure TypeScript libraries built with `tsc` to `dist/`.
- Export ESM and CJS entrypoints via `package.json` `exports` field.
- Have no runtime dependencies beyond what’s strictly necessary (ideally zero for the core HTTP logic).

### 2.2 Application Consumers

Primary consumer (currently):

- `apps/temporal-worker`
  - Instantiates library clients using `fromEnv()` factories.
  - Injects **rate limiting**, **caching**, and future **circuit-breaker** implementations (e.g., Upstash + Redis) via interfaces defined in the libraries.

Other future consumers may include CLI tools, other services, or external users (when published to npm).

---

## 3. Core Abstractions (Shared Across Clients)

These abstractions live in each library (`libs/finra-client` and `libs/unusualwhales-client`), but follow the same design.

> Note: names may be shared or duplicated between the two packages; they do not need to be cross-package shared in this phase.

### 3.1 RateLimiter

```ts
export interface RateLimiter {
  /**
   * Called before a request is sent.
   * Implementations may wait, throw, or reject if limits are exceeded.
   */
  throttle(key?: string): Promise<void>;

  /**
   * Called when a request has succeeded.
   */
  onSuccess?(key?: string): void | Promise<void>;

  /**
   * Called when a request fails.
   * Implementations can use `status` and `retryAfterMs` for adaptive backoff.
   */
  onError?(key: string | undefined, error: ApiRequestError): void | Promise<void>;
}
```

- **Key**: typically derived from endpoint + API key (e.g., `finra:short-interest`, `uw:flow:IRBT`).
- **ApiRequestError** includes HTTP status code and `retryAfterMs` derived from `Retry-After` header.

Default implementation:

- `NoopRateLimiter` (no-op), used when no limiter is provided.

### 3.2 Cache

```ts
export interface Cache {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete?(key: string): Promise<void>;
}
```

- **Key**: typically derived from URL + normalized query params.
- `ttlMs`: optional time-to-live in milliseconds.

Default implementation:

- A simple `InMemoryCache` **may be provided in the library**, but is **not** used by default to avoid unexpected memory growth. Instead, caching is off unless the consumer explicitly passes a `cache` instance and TTL.

### 3.3 CircuitBreaker

```ts
export interface CircuitBreaker {
  beforeRequest(key?: string): Promise<void>; // may throw if OPEN
  onSuccess(key?: string): void | Promise<void>;
  onFailure(key?: string, err: ApiRequestError): void | Promise<void>;
}
```

- Provides a hook for circuit-breaker behavior (open/half-open/closed states).
- Core libraries ship with a `NoopCircuitBreaker` implementation.
- Temporal apps or other consumers can inject a Redis-based or library-based circuit breaker.

### 3.4 Logger & MetricsSink

Optional interfaces for observability:

```ts
export interface Logger {
  debug?(msg: string, meta?: unknown): void;
  info?(msg: string, meta?: unknown): void;
  warn?(msg: string, meta?: unknown): void;
  error?(msg: string, meta?: unknown): void;
}

export interface MetricsSink {
  recordRequest(options: {
    endpoint: string;
    method: string;
    durationMs: number;
    status: number;
    retries: number;
    cacheHit: boolean;
  }): void | Promise<void>;
}
```

- Libraries never import a logging or metrics framework; they only call `logger?.debug(...)` etc. if provided.

### 3.5 HttpTransport (Advanced / Testing)

```ts
export interface HttpTransport {
  (url: string, init: RequestInit): Promise<Response>;
}
```

- Defaults to global `fetch`.
- Consumers may provide custom transports (e.g., for Cloudflare workers, proxies, or unit tests).

---

## 4. Error Model

Each client defines a custom error type, extending `Error`:

```ts
export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody?: string,
    /**
     * Milliseconds suggested to wait before retrying.
     * Derived from HTTP 429/`Retry-After` when present.
     */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}
```

For FINRA, this may be a subtype:

```ts
export class FinraRequestError extends ApiRequestError {
  constructor(message: string, status: number, responseBody?: string, retryAfterMs?: number) {
    super(message, status, responseBody, retryAfterMs);
    this.name = 'FinraRequestError';
  }
}
```

For Unusual Whales:

```ts
export class UnusualWhalesRequestError extends ApiRequestError {
  constructor(message: string, status: number, responseBody?: string, retryAfterMs?: number) {
    super(message, status, responseBody, retryAfterMs);
    this.name = 'UnusualWhalesRequestError';
  }
}
```

**Behavior:**

- All non-2xx responses result in an `ApiRequestError` subtype.
- `status`, `responseBody`, and `retryAfterMs` are always set when available.
- Errors are passed to `RateLimiter.onError` and `CircuitBreaker.onFailure`.

---

## 5. Request Pipeline & Retry / Backoff

### 5.1 Request Flow

Each client exposes a core `request` and `get` method:

```ts
export type QueryParams = Record<string, string | number | boolean | string[] | number[]>;

export interface RequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  method?: string;           // default: 'GET'
  params?: QueryParams;      // query string
  cacheTtlMs?: number;       // optional cache TTL for GET
  timeoutMs?: number;        // per-request timeout override
}

class BaseClient {
  async request<T>(path: string, options: RequestOptions = {}): Promise<T>;
  async get<T>(path: string, params?: QueryParams, options?: Omit<RequestOptions, 'params' | 'method'>): Promise<T>;
}
```

**Steps in `requestWithRetries`** (pseudo):

1. Build **cache key** from `path + normalized params`.
2. If `cache` and `cacheTtlMs` are provided and `method === 'GET'`:
   - Attempt `cache.get<T>(cacheKey)`.
   - If found: record metrics (`cacheHit = true`), return cached value.
3. Generate **rate-limit/circuit key** from `path` (and optionally API key or symbol).
4. Call `circuitBreaker.beforeRequest(key)` and `rateLimiter.throttle(key)`.
5. Perform HTTP request via `transport(url, init)` with **timeout** using `AbortController`.
6. Parse response:
   - If HTTP status **429**:
     - Derive `retryAfterMs` from `Retry-After` header (seconds or HTTP date).
     - Throw `ApiRequestError` with `status = 429`, `retryAfterMs`.
   - If HTTP status **5xx**: throw `ApiRequestError` (no `retryAfterMs`, unless provided).
   - If other non-2xx: throw `ApiRequestError`.
7. On success:
   - Parse JSON (or other format if needed).
   - If cacheable: `cache.set(cacheKey, data, cacheTtlMs)`.
   - Call `rateLimiter.onSuccess(key)` and `circuitBreaker.onSuccess(key)`.
   - Record metrics via `metrics.recordRequest`.

### 5.2 Retry Policy

Implement a `requestWithRetries` wrapper around `requestOnce`:

- Configurable per-client and per-request:
  - `maxRetries` (default: 3).
  - `baseRetryDelayMs` (default: 500ms).

**Retry conditions:**

- Retry on:
  - HTTP **429** (Too Many Requests).
  - HTTP **503** / **504** (transient server errors).
  - Network-level errors (timeouts, DNS, ECONNRESET, etc.).

**Backoff:**

- If `ApiRequestError.retryAfterMs` is set (from `Retry-After` header):
  - Prefer that exact `retryAfterMs` as the delay.
- Otherwise, use **exponential backoff with jitter**:

  ```ts
  function computeBackoffWithJitter(baseMs: number, attempt: number): number {
    const exp = baseMs * 2 ** attempt;
    const jitter = Math.random() * baseMs;
    return exp + jitter;
  }
  ```

- Do **not** retry beyond `maxRetries`.
- On each retry, log a warning via `logger?.warn` and record metrics.

---

## 6. Caching Behavior

### 6.1 Default

- By default, **no caching** is applied (unless caller passes a `cache` instance **and** a `cacheTtlMs` value per request or via helper).
- The library may provide a basic `InMemoryCache` implementation but does not enable it automatically.

### 6.2 Cache Integration

- For **GET** requests where caching makes sense (e.g., static metadata, slowly-changing data), helper methods may accept an optional `cacheTtlMs`.
- Cache key derivation:
  - `"<baseUrl>|<path>?<sortedQueryString>"`.
  - Sorting query params ensures stable keys.

### 6.3 Distributed Cache in Temporal Worker

- In `apps/temporal-worker`, a `RedisCache` (e.g., using Upstash Redis) can implement the `Cache` interface.
- Temporal worker factories:

  ```ts
  import { UnusualWhalesClient, createUnusualWhalesClientFromEnv } from '@tradentic/unusualwhales-client';
  import { RedisCache } from './redisCache';
  import { UpstashRateLimiter } from './upstashRateLimiter';

  export function createTemporalUnusualWhalesClient(): UnusualWhalesClient {
    const cache = new RedisCache();
    const rateLimiter = new UpstashRateLimiter();

    return createUnusualWhalesClientFromEnv({
      cache,
      rateLimiter,
      // optional: override timeouts or maxRetries
    });
  }
  ```

---

## 7. Circuit-Breaker Integration

- The core libraries **do not implement** a full circuit breaker; they only expose the `CircuitBreaker` interface and call the hooks.
- Typical usage pattern in an app:
  - Use Redis (or an in-memory library) to track error rates per endpoint.
  - When error rate or number of consecutive failures exceeds a threshold, mark the key as **OPEN** and throw in `beforeRequest`.
  - Use `retryAfterMs` and `status === 429` to drive **cooldown windows**.

Example sketch for Temporal app side:

```ts
class RedisCircuitBreaker implements CircuitBreaker {
  async beforeRequest(key?: string) {
    if (!key) return;
    const state = await redis.get(`cb:${key}`);
    if (state === 'OPEN') {
      throw new Error(`Circuit breaker OPEN for ${key}`);
    }
  }

  async onSuccess(key?: string) {
    if (!key) return;
    await redis.del(`cb_failures:${key}`);
  }

  async onFailure(key: string | undefined, err: ApiRequestError) {
    if (!key) return;
    const failures = await redis.incr(`cb_failures:${key}`);
    if (failures > 5) {
      await redis.set(`cb:${key}`, 'OPEN', { px: 60_000 }); // open for 60s
    }
  }
}
```

---

## 8. Observability Hooks

### 8.1 Logging

- All log output is routed through the optional `Logger` interface.
- Recommended log points:
  - Before sending request: method, path, key fields (ticker, symbol, date).
  - On retry: attempt number, status, `retryAfterMs`, backoff delay.
  - On non-retryable failure: status, path, message.
  - On unexpected parsing errors.

### 8.2 Metrics

- `MetricsSink.recordRequest` is called once per completed request (whether successful or failed after retries):

  ```ts
  metrics?.recordRequest({
    endpoint: path,
    method,
    durationMs,
    status,
    retries: attempts,
    cacheHit,
  });
  ```

- Applications can export these to Prometheus, CloudWatch, or any APM.

---

## 9. Endpoint-Level API Design (High-Level)

> Details of each FINRA / Unusual Whales endpoint are captured in their respective `types.ts` files. Below is the **shape** of the public API.

### 9.1 FINRA Client

**Package:** `@tradentic/finra-client`

**Config:**

```ts
export interface FinraClientConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;      // default: https://api.finra.org
  tokenUrl?: string;     // default: FINRA OAuth2 endpoint
  pageSize?: number;     // default: 5000
  maxRetries?: number;   // default: 3
  baseRetryDelayMs?: number; // default: 500
  timeoutMs?: number;    // default: e.g. 30_000
  rateLimiter?: RateLimiter;
  cache?: Cache;
  circuitBreaker?: CircuitBreaker;
  logger?: Logger;
  metrics?: MetricsSink;
  transport?: HttpTransport;
}
```

**Construction:**

- `new FinraClient(config: FinraClientConfig)`
- `createFinraClientFromEnv(overrides?: Partial<Omit<FinraClientConfig, 'clientId' | 'clientSecret'>>): FinraClient`

**Key methods (typed):**

- Short interest:
  - `fetchShortInterest(settlementDate: string): Promise<FinraShortInterestRow[]>`
  - `fetchShortInterestRange(startDate: string, endDate: string, identifiers?: { symbols?: string[] }): Promise<FinraShortInterestRow[]>`
- ATS weekly summary:
  - `fetchATSWeekly(weekEndDate: string): Promise<FinraWeeklySummaryRow[]>`
  - `fetchATSWeeklyRange(startDate: string, endDate: string, identifiers?: { symbols?: string[] }): Promise<FinraWeeklySummaryRow[]>`
- Reg SHO daily:
  - `fetchRegShoDaily(date: string, symbol: string): Promise<FinraRegShoDailyRow[]>`
- Threshold list:
  - `fetchThresholdList(date: string): Promise<FinraThresholdListRow[]>`
- Low-level helpers:
  - `queryDataset<T>(group: string, name: string, request: FinraPostRequest): Promise<T[]>`

All return types are fully typed based on FINRA metadata responses.

### 9.2 Unusual Whales Client

**Package:** `@tradentic/unusualwhales-client`

**Config:**

```ts
export interface UnusualWhalesClientConfig {
  apiKey: string;
  baseUrl?: string;         // default: https://api.unusualwhales.com
  maxRetries?: number;      // default: 3
  baseRetryDelayMs?: number;// default: 500
  timeoutMs?: number;       // default: e.g. 30_000
  rateLimiter?: RateLimiter;
  cache?: Cache;
  circuitBreaker?: CircuitBreaker;
  logger?: Logger;
  metrics?: MetricsSink;
  transport?: HttpTransport;
}
```

**Construction:**

- `new UnusualWhalesClient(config: UnusualWhalesClientConfig)`
- `createUnusualWhalesClientFromEnv(overrides?: Partial<Omit<UnusualWhalesClientConfig, 'apiKey'>>): UnusualWhalesClient`

**Key method categories (all typed based on OpenAPI spec):**

- **Shorts**
  - `getShortData(ticker: string): Promise<UwShortDataResponse>`
  - `getShortFtds(ticker: string): Promise<UwShortFtdsResponse>`
  - `getShortInterestAndFloat(ticker: string): Promise<UwShortInterestAndFloatResponse>`
  - `getShortVolumeAndRatio(ticker: string): Promise<UwShortVolumeAndRatioResponse>`
  - `getShortVolumeByExchange(ticker: string): Promise<UwShortVolumeByExchangeResponse>`

- **Stock-level options & flow**
  - `getOiPerStrike(ticker: string, params: OiPerStrikeParams): Promise<UwOiPerStrikeResponse>`
  - `getOiPerExpiry(ticker: string, params: OiPerExpiryParams): Promise<UwOiPerExpiryResponse>`
  - `getOiChange(ticker: string, params: OiChangeParams): Promise<UwOiChangeResponse>`
  - `getMaxPain(ticker: string, params: MaxPainParams): Promise<UwMaxPainResponse>`
  - `getNope(ticker: string, params: NopeParams): Promise<UwNopeResponse>`
  - `getOhlc(ticker: string, params: OhlcParams): Promise<UwOhlcResponse>`

- **Greeks / exposure / option chains**
  - `getGreeks(ticker: string, params: GreeksParams): Promise<UwGreeksResponse>`
  - `getOptionChains(ticker: string, params: OptionChainsParams): Promise<UwOptionChainsResponse>`
  - `getOptionContracts(ticker: string, params: OptionContractsParams): Promise<UwOptionContractsResponse>`
  - `getGreekExposure(ticker: string, params: GreekExposureParams): Promise<UwGreekExposureResponse>`
  - `getGreekExposureByExpiry(ticker: string, params: GreekExposureByExpiryParams): Promise<UwGreekExposureByExpiryResponse>`
  - `getFlowPerExpiry(ticker: string): Promise<UwFlowPerExpiryResponse>`
  - `getFlowPerStrike(ticker: string, params: FlowPerStrikeParams): Promise<UwFlowPerStrikeResponse>`

- **Flow tape / alerts**
  - `getFlowAlerts(params: FlowAlertsParams): Promise<UwFlowAlertsResponse>`
  - `getFullTape(params: FullTapeParams): Promise<UwFullTapeResponse>`

- **Institutions & screeners**
  - `getInstitutionHoldings(name: string, params: InstitutionHoldingsParams): Promise<UwInstitutionHoldingsResponse>`
  - `screenStocks(params: StockScreenerParams): Promise<UwStockScreenerResponse>`

- **Market overlays & seasonality**
  - `getMarketTopNetImpact(params: MarketTopNetImpactParams): Promise<UwMarketTopNetImpactResponse>`
  - `getSectorTide(sector: string, params: SectorTideParams): Promise<UwSectorTideResponse>`
  - `getMarketSeasonality(params: MarketSeasonalityParams): Promise<UwMarketSeasonalityResponse>`
  - `getSeasonalityMonthPerformers(month: string, params: SeasonalityMonthParams): Promise<UwSeasonalityMonthPerformersResponse>`
  - `getSeasonalityMonthlyForTicker(ticker: string, params: SeasonalityTickerParams): Promise<UwSeasonalityMonthlyTickerResponse>`
  - `getSeasonalityYearMonthForTicker(ticker: string, params: SeasonalityTickerParams): Promise<UwSeasonalityYearMonthTickerResponse>`

- **Escape hatch**
  - `get<T>(path: string, params?: QueryParams): Promise<T>`
  - `request<T>(path: string, options: RequestOptions): Promise<T>`

The escape hatches are public but discouraged for internal use in the main app; they are there for external callers or rare experimental endpoints.

---

## 10. Environment-Based Factories

Both clients expose `fromEnv`-style factories to make standard usage trivial while allowing overrides.

Example for Unusual Whales:

```ts
export function createUnusualWhalesClientFromEnv(
  overrides: Partial<Omit<UnusualWhalesClientConfig, 'apiKey'>> = {},
): UnusualWhalesClient {
  const apiKey = process.env.UNUSUALWHALES_API_KEY;
  if (!apiKey) {
    throw new Error('UNUSUALWHALES_API_KEY is required');
  }

  return new UnusualWhalesClient({
    apiKey,
    baseUrl: process.env.UNUSUALWHales_BASE_URL ?? 'https://api.unusualwhales.com',
    maxRetries: envOrDefault('UNUSUALWHales_MAX_RETRIES', 3),
    baseRetryDelayMs: envOrDefault('UNUSUALWHales_RETRY_DELAY_MS', 500),
    timeoutMs: envOrDefault('UNUSUALWHales_TIMEOUT_MS', 30_000),
    ...overrides,
  });
}
```

Similar factory exists for FINRA using `FINRA_API_CLIENT`, `FINRA_API_SECRET`, etc.

---

## 11. Application-Level Composition (Temporal Worker)

In `apps/temporal-worker`:

- **Rate limiting**
  - Use `@upstash/ratelimit` or similar to implement `RateLimiter`.
  - Respect internal quotas and also 429 feedback from upstream APIs using `onError` and the `retryAfterMs` field.

- **Caching**
  - Use Upstash Redis or standard Redis to implement the `Cache` interface.
  - Configure TTLs per endpoint based on data volatility.

- **Circuit breaker**
  - Optional, implemented through `CircuitBreaker` interface.

- **Validation**
  - Use Zod schemas (or similar) at the Temporal level, wrapping calls with a helper like `fetchAndParse(fetcher, schema, context)`.

---

## 12. Publishing & Versioning

- Both packages are intended to be publishable:
  - `@tradentic/finra-client`
  - `@tradentic/unusualwhales-client`
- Versioning uses semver.
- Breaking changes to public methods or types require a major version bump.

---

## 13. Implementation Checklist

1. Align `FinraClient` and `UnusualWhalesClient` configs with this spec.
2. Implement shared abstractions: `RateLimiter`, `Cache`, `CircuitBreaker`, `Logger`, `MetricsSink`, `HttpTransport`.
3. Implement `ApiRequestError` and per-client subtypes with `retryAfterMs`.
4. Add 429-aware retry/backoff logic with `Retry-After` parsing.
5. Add optional caching behavior (`cacheTtlMs` on requests).
6. Add logging and metrics hooks.
7. Ensure all public methods are fully typed (no `any`).
8. Provide in-memory defaults (no-op limiter, optional in-memory cache implementation).
9. Verify Temporal worker composes these clients with Upstash-based rate limiting and Redis caching via adapters.
10. Add regression tests for:
    - 429 + `Retry-After` handling (with and without header).
    - Retry behavior for 5xx and network errors.
    - Cache hits vs misses.
    - RateLimiter and CircuitBreaker hooks being invoked as expected.

