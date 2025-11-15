# Resilient HTTP Core — Architecture & Implementation Spec (v0.3.0)

> **This is an evolution of v0.2.0.** It keeps all existing behaviours and adds:
>
> - Multi–base URL selection via a `resolveBaseUrl` hook.
> - Pre-/post-request hooks for header shaping and response inspection.
> - Operation-level default configuration.
> - Thin convenience methods for text/arrayBuffer responses.
> - A **separate, pluggable pagination helper** (Octokit-style) built on top of `HttpClient`, not inside it.
>
> All enhancements must:
>
> - Keep `@tradentic/resilient-http-core` **lightweight, domain-agnostic, and dependency-light**.
> - Be implemented as **hooks or helpers**, not domain-specific behaviour.
> - Allow future extraction of both the core and pagination helpers into **separate repos/packages**.

---

## 1. Purpose & Context

Resilient HTTP Core v0.3.0 continues to serve as the shared HTTP engine for all API clients in the **institutional-rotation-detector** monorepo, including:

- FINRA data APIs
- Unusual Whales APIs
- OpenAI APIs
- SEC EDGAR/Data APIs
- IEX historical (HIST) data

The v0.3.0 enhancements are driven by:

- **SEC client patterns**:
  - Different base URLs for different path classes (main EDGAR vs data API).
  - Path-based caching TTLs.
- **IEX client patterns**:
  - Downloading large binary files (pcap/csv) with retries.
  - CSV parsing and row normalisation on top of resilient downloads.
- **General pagination needs** across FINRA, UW, SEC data API, OpenAI list endpoints, etc.

The goal: provide *generic* hooks and helpers that handle these patterns without baking SEC/IEX/GitHub logic into the core.

---

## 2. Design Principles (Recap + New)

The existing v0.2 principles remain in force:

1. **Fetch-first, transport-pluggable**
2. **Policy-engine agnostic**
3. **Domain-agnostic core**
4. **Agent-friendly but not agent-bound**
5. **Telemetry-ready but not telemetry-dependent**
6. **Future portability**

v0.3 adds:

7. **Base URL resolution via hook**
   - Multi-host or multi-baseUrl support lives in a resolver function.
8. **Pre-/post-request hooks**
   - Headers and low-level invariants are adjusted via hooks, not ad-hoc code in every caller.
9. **Operation-level defaults**
   - Idiomatic way to specify per-operation defaults (timeouts, retries, idempotency) without repeating code.
10. **Pagination as a separate helper layer**
    - `@tradentic/resilient-http-core` stays focused on *single* HTTP calls.
    - Pagination logic is built on top via a separate helper/module.

---

## 3. Core Enhancements in v0.3.0

This section describes **new/extended types and behaviours** that sit alongside the v0.2 model.

### 3.1 Base URL Resolver

**Problem:** Some APIs (e.g., SEC EDGAR) use different base URLs for different classes of paths:

- `https://www.sec.gov` for `/files/`, `/Archives/`, etc.
- `https://data.sec.gov` for `/submissions/*.json`.

**Solution:** Add a `resolveBaseUrl` hook to `BaseHttpClientConfig`.

```ts
export interface BaseHttpClientConfig {
  baseUrl?: string; // still supported; acts as default
  // existing fields from v0.2 ...

  /**
   * Optional resolver for base URL per request. If provided, this is invoked
   * for every request; if it returns a non-empty string, that value is used
   * as the base URL for that call. Otherwise, `baseUrl` is used.
   */
  resolveBaseUrl?: (opts: HttpRequestOptions) => string | undefined;
}
```

**HttpClient behaviour:**

- When building the URL for a request:

  1. If `config.resolveBaseUrl` is provided, call it with the final `HttpRequestOptions`.
  2. If it returns a non-empty string, use that as the base URL.
  3. Otherwise, fall back to `config.baseUrl`.

- If neither `resolveBaseUrl` nor `baseUrl` produce a value, treat `opts.path` as either:
  - a fully qualified URL (if it looks like one), or
  - throw a clear error if it is not.

**Example: SEC client wrapper (pseudo-code):**

```ts
const http = new HttpClient({
  clientName: 'sec',
  baseUrl: process.env.EDGAR_BASE ?? 'https://www.sec.gov',
  resolveBaseUrl: (opts) =>
    opts.path?.startsWith('/submissions/')
      ? process.env.EDGAR_DATA_API_BASE ?? 'https://data.sec.gov'
      : undefined,
  // rateLimiter, cache, logger, etc.
});
```

This keeps SEC logic out of the core while supporting the pattern generically.

### 3.2 Pre-/Post-request Hooks

**Problems addressed:**

- SEC always requires a `User-Agent` and compression headers.
- IEX needs specific `Accept` headers for binary/CSV responses.
- Some clients may want to inspect headers for rate-limit usage after a response.

**Solution:** Add `beforeRequest` and `afterResponse` hooks in `BaseHttpClientConfig`.

```ts
export interface BaseHttpClientConfig {
  // ... existing fields ...

  /**
   * Optional hook to mutate/augment request options before the transport call.
   * Should be pure and side-effect free beyond changing the options.
   */
  beforeRequest?: (opts: HttpRequestOptions) => HttpRequestOptions | void;

  /**
   * Optional hook called after a successful HTTP response, before returning
   * parsed data to the caller. Can be used for custom logging/metrics.
   */
  afterResponse?: (
    response: Response,
    opts: HttpRequestOptions
  ) => void | Promise<void>;
}
```

**HttpClient behaviour:**

- After computing effective options (URL, timeout, derived headers, agent context, etc.) and before invoking the rate limiter:

  ```ts
  if (config.beforeRequest) {
    const modified = config.beforeRequest(effectiveOpts);
    if (modified) {
      effectiveOpts = { ...effectiveOpts, ...modified };
    }
  }
  ```

- After a *successful* HTTP call (before returning parsed data), but after internal logging & metrics:

  ```ts
  if (config.afterResponse) {
    await config.afterResponse(response, effectiveOpts);
  }
  ```

- Errors thrown in `beforeRequest` or `afterResponse` propagate as normal errors (they will be treated like application errors and can be retried/handled by callers if desired).

**Example: SEC headers via hook:**

```ts
beforeRequest: (opts) => ({
  ...opts,
  headers: {
    'User-Agent': secUserAgent,
    'Accept-Encoding': 'gzip, deflate',
    ...opts.headers,
  },
})
```

### 3.3 Operation-level Defaults

**Problem:** Some operations always have different semantics:

- Certain endpoints are non-idempotent.
- Some need longer timeouts (e.g. large EDGAR downloads).
- Some should default to more retries.

You can currently pass this in per-call, but that gets repetitive.

**Solution:** Add an optional `operationDefaults` map to `BaseHttpClientConfig`.

```ts
export interface OperationDefaults {
  timeoutMs?: number;
  maxRetries?: number;
  idempotent?: boolean;
  // future: default cache ttl, etc. (if really needed)
}

export interface BaseHttpClientConfig {
  // ... existing fields ...
  operationDefaults?: Record<string, OperationDefaults>;
}
```

**HttpClient behaviour:**

- Before evaluating timeouts, max retries, or idempotency:

  ```ts
  const opDefaults = config.operationDefaults?.[opts.operation] ?? {};
  const timeoutMs =
    opts.budget?.maxTotalDurationMs ??
    opts.timeoutMs ?? // if you add per-request timeout in future
    opDefaults.timeoutMs ??
    config.timeoutMs ??
    30000;

  const maxRetries =
    opts.budget?.maxAttempts ??
    (opDefaults.maxRetries ?? config.maxRetries ?? 3);

  const idempotent =
    opts.idempotent ??
    opDefaults.idempotent ??
    defaultIdempotentForMethod(opts.method);
  ```

- Public API remains unchanged; this is an internal precedence order.

**Usage example:**

```ts
const http = new HttpClient({
  clientName: 'iex',
  baseUrl: DEFAULT_BASE_URL,
  operationDefaults: {
    'hist.downloadDaily': { timeoutMs: 120_000 }, // large file download
  },
});
```

### 3.4 Convenience Methods: `requestText` and `requestArrayBuffer`

**Problem:** Many APIs (SEC, IEX) deal heavily with text or binary payloads, not JSON. Clients can already use `requestRaw`, but it’s repetitive to always write `arrayBuffer()` and `text()` boilerplate.

**Solution:** Add two thin convenience methods on `HttpClient`:

```ts
export class HttpClient {
  // existing constructor, requestJson, requestRaw

  async requestText(opts: HttpRequestOptions): Promise<string> {
    const res = await this.requestRaw(opts);
    return res.text();
  }

  async requestArrayBuffer(opts: HttpRequestOptions): Promise<ArrayBuffer> {
    const res = await this.requestRaw(opts);
    return res.arrayBuffer();
  }
}
```

**Notes:**

- Both methods must reuse **all resilience features** (rate limiting, circuit breaking, tracing, budgets, response classification, logging, metrics) already in `requestRaw`.
- The methods do not introduce any new behaviour beyond payload decoding.

**Example: IEX HIST:**

```ts
const buffer = await http.requestArrayBuffer({
  method: 'GET',
  path: `/hist/IEXTP1_TOPS_${dateStr}.pcap.gz`,
  operation: 'hist.downloadDaily',
});
// then compute sha256, parse, etc., in the IEX client layer
```

---

## 4. Pagination Helper (Separate Layer)

Pagination is a cross-cutting concern, but we intentionally **keep it out of `HttpClient`** to avoid overloading the core and to make it easy to move into its own package.

v0.3 introduces a **pagination helper** implemented in a separate module that depends on `HttpClient` and `HttpRequestOptions`.

### 4.1 Location & Packaging

- For now, implement as **`libs/resilient-http-core/src/pagination.ts`**.
- Export from `src/index.ts` under a clearly separate surface:

  ```ts
  export * from './pagination';
  ```

- When/if extracted, it can become its own package:

  - `@tradentic/resilient-http-pagination`

  with only import changes required in client libraries.

### 4.2 Types

```ts
export interface PaginationState<TPage> {
  pageIndex: number;   // 0-based index of the page
  itemsSoFar: number;  // total items accumulated across pages
  lastPage?: TPage;    // last page returned (if any)
}

export interface PaginationResult<TItem> {
  items: TItem[];
  pages: number;       // number of pages fetched
}

export interface PaginationConfig<TPage, TItem> {
  /** Initial request options (path, method, query, operation, etc.). */
  initial: HttpRequestOptions;

  /**
   * Given the last page and current state, return the next request options
   * or null to stop. This is where you implement offset/cursor logic.
   */
  getNextRequest: (
    lastPage: TPage | undefined,
    state: PaginationState<TPage>
  ) => HttpRequestOptions | null;

  /** Extracts items from a page (e.g. page.data.items, page.results, etc.). */
  extractItems: (page: TPage) => TItem[];

  /** Soft safety limits to prevent unbounded pagination. */
  maxPages?: number;
  maxItems?: number;
}
```

### 4.3 `paginateAll` helper

```ts
export async function paginateAll<TPage, TItem>(
  client: HttpClient,
  config: PaginationConfig<TPage, TItem>
): Promise<PaginationResult<TItem>> {
  const items: TItem[] = [];
  let state: PaginationState<TPage> = { pageIndex: 0, itemsSoFar: 0 };
  let nextOpts: HttpRequestOptions | null = config.initial;
  let pages = 0;

  while (nextOpts) {
    const page = await client.requestJson<TPage>(nextOpts);
    const pageItems = config.extractItems(page);

    items.push(...pageItems);
    pages += 1;

    state = {
      pageIndex: state.pageIndex + 1,
      itemsSoFar: items.length,
      lastPage: page,
    };

    if (config.maxPages && pages >= config.maxPages) break;
    if (config.maxItems && items.length >= config.maxItems) break;

    nextOpts = config.getNextRequest(page, state);
  }

  return { items, pages };
}
```

**Notes:**

- All resilience (retries, budgets, rate limiting, tracing, etc.) is handled inside `requestJson`.
- The helper is generic: it doesn’t know anything about FINRA, UW, SEC, IEX, or OpenAI.

### 4.4 `paginateIterator` helper

For streaming/page-by-page consumption (like Octokit’s iterator), provide an async iterator:

```ts
export async function* paginateIterator<TPage>(
  client: HttpClient,
  initial: HttpRequestOptions,
  getNextRequest: (
    lastPage: TPage | undefined,
    state: PaginationState<TPage>
  ) => HttpRequestOptions | null
): AsyncIterable<TPage> {
  let state: PaginationState<TPage> = { pageIndex: 0, itemsSoFar: 0 };
  let nextOpts: HttpRequestOptions | null = initial;

  while (nextOpts) {
    const page = await client.requestJson<TPage>(nextOpts);
    yield page;

    state = {
      pageIndex: state.pageIndex + 1,
      itemsSoFar: state.itemsSoFar, // caller can update if they track items
      lastPage: page,
    };

    nextOpts = getNextRequest(page, state);
  }
}
```

**Usage patterns:**

- FINRA: implement `getNextRequest` using page number or offset.
- UW: implement using `page`/`cursor` with last page’s cursor.
- SEC data API: implement using whatever paging contract they provide.
- OpenAI: implement for list endpoints (files, batches, etc.).

This mirrors Octokit’s `paginate` + iterator concepts while staying out of the core class.

---

## 5. Integration Guidance by Client

This section shows how SEC and IEX, in particular, can exploit v0.3 features, and how FINRA/UW/OpenAI can benefit from pagination and base URL hooks.

### 5.1 SEC (EDGAR/Data API)

- Use a single `HttpClient` with:
  - `clientName: 'sec'`.
  - `baseUrl: EDGAR_BASE`.
  - `resolveBaseUrl`: picks `EDGAR_DATA_API_BASE` for `/submissions/` paths.
  - `beforeRequest`: inject `User-Agent` and compression headers.
- Implement path-based TTLs in the SEC-specific client wrapper:
  - Optionally map to `cacheKey` + `cacheTtlMs` per call.
- All rate limiting should use an implementation of `HttpRateLimiter` compatible with your existing `DistributedRateLimiter`.

### 5.2 IEX HIST

- Use `HttpClient` with:
  - `clientName: 'iex'`.
  - `baseUrl: IEX_HIST_BASE_URL`.
  - `beforeRequest`: inject `User-Agent` and `Accept` for binary/csv.
  - `operationDefaults.hist.downloadDaily.timeoutMs`: set a larger timeout for big files.
- For downloads:
  - Call `requestArrayBuffer` to get the raw `ArrayBuffer`, then wrap as `Buffer` and compute `sha256` in the IEX client.
- For parsing CSV:
  - Keep parsing and row mapping as domain logic *outside* the core.

### 5.3 FINRA & Unusual Whales

- Continue to use `requestJson` with per-endpoint TTLs and operation names.
- If/when server-side pagination is used, wrap multi-page fetches with `paginateAll` or `paginateIterator`.
- You can use `operationDefaults` to simplify per-operation retry and timeout policies.

### 5.4 OpenAI

- Non-streaming endpoints: `requestJson` as in v0.2.
- Streaming endpoints: `requestRaw` for SSE / chunked responses, handled entirely in the OpenAI client.
- List endpoints (models, files, batches, vector stores, etc.):
  - Use `paginateAll` or `paginateIterator` to fetch multi-page results if/when needed.

---

## 6. Non-goals & Constraints

- **No domain-specific logic in the core:**
  - No SEC/IEX/OpenAI/FINRA/UW-specific constants or URL patterns.
  - All such logic lives in client wrappers or separate helper packages.

- **No new mandatory runtime dependencies:**
  - v0.3 must not pull in axios, OTEL, or other heavy libraries.
  - Axios/OTEL integrations remain in separate adapter packages.

- **Backwards compatibility:**
  - Default behaviour of `requestJson`/`requestRaw` when new hooks are not provided must match v0.2 semantics.

- **Pagination module is optional:**
  - `HttpClient` must not depend on pagination.
  - Users can ignore `paginateAll`/`paginateIterator` if they prefer custom logic.

---

## 7. Testing & Rollout

### 7.1 Core tests

Extend `HttpClient` tests to cover:

- `resolveBaseUrl` precedence and fallback to `baseUrl`.
- `beforeRequest` mutation of headers.
- `afterResponse` execution on success.
- `operationDefaults` precedence over global config, but below per-request overrides.
- `requestText` and `requestArrayBuffer` behaviours.

### 7.2 Pagination tests

In `src/__tests__/pagination.test.ts`:

- Use a fake `HttpClient` (or a real one with fake transport) to test:
  - `paginateAll` stops when `getNextRequest` returns `null`.
  - `maxPages` and `maxItems` stop conditions.
  - `paginateIterator` yields pages in order and stops correctly.

### 7.3 Rollout steps

1. Implement all v0.3 features behind the scenes without changing existing client code.
2. Gradually refactor SEC/IEX/FINRA/UW/OpenAI clients to:
   - Use `resolveBaseUrl` (SEC).
   - Use `beforeRequest` for headers.
   - Use `operationDefaults` where it simplifies code.
   - Use `requestArrayBuffer` for IEX downloads.
   - Use `paginateAll`/`paginateIterator` where appropriate.
3. Run workspace-level build and tests and keep CI green.

---

## 8. Summary

Resilient HTTP Core v0.3.0 refines the design by:

- Adding **multi-base URL** support via `resolveBaseUrl`.
- Introducing **pre-/post-request hooks** for low-level header shaping and response inspection.
- Providing **operation-level defaults** for timeouts, retries, and idempotency.
- Exposing thin **text/arrayBuffer** helpers built on `requestRaw` for binary/text-heavy APIs.
- Introducing a **separate pagination helper layer** (`paginateAll` and `paginateIterator`) that builds on `HttpClient` while keeping the core small and domain-agnostic.

These enhancements are expressed entirely as hooks and helpers so that:

- `@tradentic/resilient-http-core` remains clean and ready to be moved into its own repo.
- Additional helpers like `@tradentic/resilient-http-pagination` and agent-specific libraries can build on top without requiring a redesign of the core.

