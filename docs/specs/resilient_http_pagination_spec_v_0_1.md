# `@airnub/resilient-http-pagination` — Architecture & Implementation Spec (v0.1.0)

> **Status:** Design spec for a new standalone package.
>
> **Audience:** Maintainers and coding agents working in the Airnub ecosystem (including the institutional-rotation-detector project) who need a reusable, resilient pagination helper that builds on top of `@airnub/resilient-http-core` but remains usable with any HTTP client that follows the same patterns.

---

## 1. Purpose & Scope

### 1.1 Problem

Many APIs in the ecosystem are paginated:

- FINRA datasets
- Unusual Whales endpoints
- SEC EDGAR/Data API
- IEX or other exchange data endpoints
- OpenAI / LLM list endpoints (models, files, batches, etc.)

Each of these has slightly different pagination schemes (page + size, offsets, cursors, next links), but the **control flow** is always the same:

- Make a request for the next page
- Extract items
- Decide whether to continue or stop (based on presence of a token, max pages, max items, etc.)
- Repeat with full resilience (retries, rate limiting, budgets) handled by the underlying HTTP client

Right now, each client ends up hand-rolling some variant of this. We want:

- A **small, standalone pagination helper** that:
  - Delegates all resilience to `@airnub/resilient-http-core` (or compatible clients)
  - Is agnostic to FINRA/UW/SEC/OpenAI specifics
  - Is fully reusable across all Airnub repos

### 1.2 Goals

- Provide a reusable, type-safe pagination module:
  - Works with `HttpClient` from `@airnub/resilient-http-core`.
  - Can also work with any custom client that implements a similar `requestJson` API.
- Support both:
  - **Collect-all pagination** (`paginateAll`) where you want all items in memory.
  - **Streaming-style pagination** (`paginateIterator`) where you want to iterate page-by-page.
- Make **no assumptions** about pagination style:
  - Offset/limit
  - Page number/size
  - Cursor/next token
  - Link headers
- Allow call sites to:
  - Impose limits (`maxPages`, `maxItems`).
  - Use any combination of query parameters, headers, or body changes to move between pages.
- Keep this library **dependency-light** and easily extractable into its own repo later.

### 1.3 Non-Goals

- Do not bake in any particular API’s schema (no FINRA/UW/SEC/OpenAI logic).
- Do not implement HTTP retries/backoff/rate-limiting here; rely on the underlying client.
- Do not require use of `@airnub/resilient-http-core`; the design should be compatible but not hard-coupled.
- Do not implement parallel/multi-shard pagination in v0.1 (sequential only).

---

## 2. Package Overview

### 2.1 Package name & entrypoint

- NPM name: `@airnub/resilient-http-pagination`
- Entry file: `src/index.ts`
- Distributed as ESM with TypeScript typings.

### 2.2 Core concepts

The library is designed around **3 types** and **2 core functions**:

- Types:
  - `PaginationState<TPage>`: what the library tracks between pages.
  - `PaginationConfig<TPage, TItem>`: how to navigate pages and extract items.
  - `PaginationResult<TItem>`: the output of `paginateAll`.

- Functions:
  - `paginateAll(client, config)` → collects items and returns `PaginationResult<TItem>`.
  - `paginateIterator(client, initial, getNextRequest)` → async iterator over pages.

The caller provides functions that know how to:

- Build the next page’s `request` options (e.g., next cursor, incremented page index, etc.).
- Extract items from each page’s payload.

The pagination library handles:

- Looping until no more pages (or until a limit is reached).
- Returning a consistent result shape.

---

## 3. Types & Interfaces

### 3.1 Http-like client abstraction

To avoid hard coupling to `@airnub/resilient-http-core`, the pagination helpers rely on a minimal Http-like client interface.

```ts
export interface JsonRequestOptions {
  // This type should be compatible with the subset of HttpRequestOptions
  // needed by pagination. For v0.1, keep it minimal.
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  body?: unknown;
  operation?: string;
  // We intentionally do NOT include all of HttpRequestOptions to keep
  // this package reusable; call sites can pass extra fields via intersection.
  // e.g. JsonRequestOptions & HttpRequestOptions.
  [key: string]: unknown;
}

export interface JsonHttpClient {
  requestJson<TResponse>(opts: JsonRequestOptions): Promise<TResponse>;
}
```

- `@airnub/resilient-http-core`’s `HttpClient` *already* exposes `requestJson<T>` with a richer `HttpRequestOptions` type.
- Call sites using `HttpClient` can pass it directly where `JsonHttpClient` is expected because:
  - `HttpClient` matches the method signature.
  - `HttpRequestOptions` extends the minimal `JsonRequestOptions` in practice.

### 3.2 PaginationState

Represents the pagination state tracked by the helper between calls.

```ts
export interface PaginationState<TPage> {
  /** 0-based index of the page being requested next. */
  pageIndex: number;

  /** Total number of items collected so far (for paginateAll). */
  itemsSoFar: number;

  /** The last page that was fetched, if any. */
  lastPage?: TPage;
}
```

### 3.3 PaginationResult

Result of `paginateAll`.

```ts
export interface PaginationResult<TItem> {
  /** All items collected across pages, in order. */
  items: TItem[];

  /** Number of pages fetched. */
  pages: number;
}
```

### 3.4 PaginationConfig

Configuration for `paginateAll`.

```ts
export interface PaginationConfig<TPage, TItem> {
  /**
   * Initial request options for the first page.
   * Typically includes the base path + initial query params.
   */
  initial: JsonRequestOptions;

  /**
   * Given the last page and current state, return the next request
   * options, or null to stop.
   *
   * Examples:
   *  - Page-based: increment page number until no more items.
   *  - Cursor-based: use nextCursor token from lastPage.
   */
  getNextRequest: (
    lastPage: TPage | undefined,
    state: PaginationState<TPage>
  ) => JsonRequestOptions | null;

  /**
   * Extract the items from a page. The library does not assume any
   * field name; you decide where the items live.
   */
  extractItems: (page: TPage) => TItem[];

  /**
   * Optional hard cap on how many pages to fetch. If reached, the
   * loop stops even if getNextRequest would return another page.
   */
  maxPages?: number;

  /**
   * Optional hard cap on how many items to collect. If reached,
   * the loop stops even if there are more items available.
   */
  maxItems?: number;
}
```

Notes:

- `getNextRequest` may decide to stop pagination by returning `null`.
- `extractItems` can return an empty array; pagination continues unless `getNextRequest` or the limits stop it.

---

## 4. Core Functions

### 4.1 `paginateAll`

Collect all items (subject to limits) into memory.

```ts
export async function paginateAll<TPage, TItem>(
  client: JsonHttpClient,
  config: PaginationConfig<TPage, TItem>
): Promise<PaginationResult<TItem>> {
  const items: TItem[] = [];
  let state: PaginationState<TPage> = { pageIndex: 0, itemsSoFar: 0 };
  let nextOpts: JsonRequestOptions | null = config.initial;
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

#### Behaviour

- Uses the underlying `client.requestJson` for each page.
- Respects `maxPages` and `maxItems` if provided.
- Stops when:
  - `getNextRequest` returns `null`, OR
  - `maxPages` or `maxItems` limits are hit.
- Assumes `client` handles all resilience (retries, rate limiting, etc.).

#### Integration with `@airnub/resilient-http-core`

- `HttpClient` from the core is a valid `JsonHttpClient`:

  ```ts
  const httpClient = new HttpClient(baseConfig);

  await paginateAll(httpClient, {
    initial: {
      method: 'GET',
      path: '/v1/items',
      query: { page: 1, per_page: 100 },
      operation: 'items.list',
    },
    getNextRequest: (lastPage, state) => {
      if (!lastPage || lastPage.items.length === 0) return null;
      return {
        method: 'GET',
        path: '/v1/items',
        query: { page: state.pageIndex + 1, per_page: 100 },
        operation: 'items.list',
      };
    },
    extractItems: (page) => page.items,
    maxPages: 10,
  });
  ```

- Any `AgentContext`, `extensions`, or other core-specific fields can be included in the `JsonRequestOptions` via intersection types in the caller; the pagination library treats them as opaque.

### 4.2 `paginateIterator`

Async iterator over pages (for streaming-style use).

```ts
export async function* paginateIterator<TPage>(
  client: JsonHttpClient,
  initial: JsonRequestOptions,
  getNextRequest: (
    lastPage: TPage | undefined,
    state: PaginationState<TPage>
  ) => JsonRequestOptions | null
): AsyncIterable<TPage> {
  let state: PaginationState<TPage> = { pageIndex: 0, itemsSoFar: 0 };
  let nextOpts: JsonRequestOptions | null = initial;

  while (nextOpts) {
    const page = await client.requestJson<TPage>(nextOpts);
    yield page;

    state = {
      pageIndex: state.pageIndex + 1,
      itemsSoFar: state.itemsSoFar, // Caller can track items externally if desired
      lastPage: page,
    };

    nextOpts = getNextRequest(page, state);
  }
}
```

#### Behaviour

- Similar logic to `paginateAll`, but does **not** accumulate items.
- The caller controls consumption of pages and can break early simply by `break`-ing from the `for await` loop.
- `maxPages`/`maxItems` style limits are not built-in; if needed, they can be encoded in `getNextRequest` or enforced externally.

#### Example usage

```ts
for await (const page of paginateIterator<MyPageType>(httpClient, initialOpts, getNextRequest)) {
  const items = page.items;
  // Process items...
  if (shouldStop(items)) break; // early exit if desired
}
```

---

## 5. Error Handling & Cancellation

### 5.1 Error propagation

- Any error thrown by `client.requestJson` is:
  - Propagated out of `paginateAll` and `paginateIterator` as-is.
- The pagination helpers do **not** wrap errors or implement their own retry logic.
- This allows the underlying HTTP client / resilience stack to:
  - Perform retries according to its own policies.
  - Surface domain-specific errors (e.g. `HttpError`, `TimeoutError`).

### 5.2 Cancellation

For v0.1, cancellation support follows whatever `client.requestJson` supports:

- If `client.requestJson` accepts an abort signal via `JsonRequestOptions` (e.g. `signal: AbortSignal`), the caller can include it in `initial` and subsequent requests via `getNextRequest`.
- The pagination helpers do not manage abort signals themselves; they simply pass through the options provided.

Future versions may introduce a higher-level `PaginationController` abstraction, but that is out of scope for v0.1.

---

## 6. Testing Strategy

### 6.1 Test harness

- Implement a **fake JsonHttpClient** for tests that:
  - Accepts a mapping from request options to responses.
  - Records each call for assertion.

Example:

```ts
class FakeJsonClient implements JsonHttpClient {
  constructor(private readonly responses: ((opts: JsonRequestOptions) => unknown)[]) {}

  private callIndex = 0;

  async requestJson<TResponse>(opts: JsonRequestOptions): Promise<TResponse> {
    const fn = this.responses[this.callIndex];
    if (!fn) throw new Error('Unexpected call');
    this.callIndex += 1;
    return fn(opts) as TResponse;
  }
}
```

### 6.2 `paginateAll` tests

- **Basic multi-page success**:
  - 3 pages of data, items aggregated correctly, `pages` === 3.
- **Stop when `getNextRequest` returns null`**:
  - Simulate `getNextRequest` returning `null` after the second page.
- **Stop when `maxPages` reached**:
  - Provide 5 pages; set `maxPages: 2` and assert only 2 pages fetched.
- **Stop when `maxItems` reached`**:
  - Provide e.g. 3 items per page, `maxItems: 5` → should fetch 2 pages and collect 6 or cut at 5 depending on exact semantics.
  - v0.1 behaviour: once `items.length >= maxItems`, break the loop (but don’t trim collected items).
- **Empty pages**:
  - Allow some pages to return empty `items` and ensure `getNextRequest` logic determines whether to continue or stop.

### 6.3 `paginateIterator` tests

- **Basic multi-page iteration**:
  - Feed 3 pages; ensure all 3 are yielded in order.
- **Stop when `getNextRequest` returns null`**:
  - Ensure iterator ends gracefully.
- **Early break from consumer**:
  - Consumer breaks after first page; assert underlying client only receives 1 call.

### 6.4 Type-level tests (via TS compilation)

- Ensure `HttpClient` from `@airnub/resilient-http-core` can be passed where `JsonHttpClient` is expected without casts.
- Ensure call sites can intersect `JsonRequestOptions` with richer option types (e.g. including `agentContext`, `extensions`) without type errors.

---

## 7. Dependencies & Packaging

### 7.1 Dependencies

- **Runtime dependencies:** None (v0.1).
- **Dev dependencies:**
  - TypeScript
  - Jest / Vitest (or the monorepo’s standard test runner)

### 7.2 Build & publish

- Expose the following from `src/index.ts`:

  ```ts
  export type { JsonHttpClient, JsonRequestOptions } from './types';
  export type { PaginationState, PaginationConfig, PaginationResult } from './pagination';

  export { paginateAll, paginateIterator } from './pagination';
  ```

- Follow the monorepo’s standard build/publish scripts.
- Keep the package name and scope aligned with Airnub naming: `@airnub/resilient-http-pagination`.

---

## 8. Future Extensions (Beyond v0.1)

The following ideas are intentionally **out of scope for v0.1**, but this design should leave room for them:

1. **Parallel pagination**
   - Fetch multiple pages in parallel when the server and rate limits allow.
   - Requires careful interaction with rate limiting and budgets.

2. **Built-in `maxDurationMs`** per pagination run
   - Stop pagination when a wall-clock budget is exceeded.
   - Likely integrate with `AgentContext` and budgets defined in `@airnub/resilient-http-core`.

3. **Higher-level presets**
   - Convenience helpers for common patterns:
     - Offset/limit
     - Page/size
     - Cursor token
   - Possibly as separate functions or config factories.

4. **Tighter integration with `AgentContext` and `extensions`**
   - Pass through `AgentContext` and `extensions` from initial options to subsequent pages by default.
   - Allow per-page overrides where necessary.

5. **Pagination controllers and cancellation**
   - Provide a `PaginationController` that can be used to cancel mid-run from outside.

This v0.1 spec focuses on the minimal building blocks needed to standardize pagination usage across Airnub projects while keeping the core HTTP library clean and agnostic.