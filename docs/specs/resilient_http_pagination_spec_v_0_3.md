# Resilient HTTP Pagination — Specification v0.3.0

> **Status:** Draft, aligned with `@airnub/resilient-http-core` v0.7.0
>
> **Scope:** Pagination utilities built on top of `HttpClient` (core v0.7). Provides a small set of composable primitives and opinionated presets for fetching multi-page HTTP resources in a resilient, observable way.
>
> **Non-goals:**
> - Not a data-frame or ORM layer.
> - Not responsible for low-level HTTP retries or timeouts (these live in core).
> - Not a scraping/HTML parsing framework.

This spec defines `@airnub/resilient-http-pagination` v0.3.0. It is intended to be complete enough that a developer or coding agent can implement the library purely from this document plus the `resilient-http-core` v0.7.0 spec.

---

## 1. Design Goals & Principles

1. **Layered on core HTTP**
   - Always use `HttpClient` from `@airnub/resilient-http-core` v0.7.
   - Never implement its own retry logic; respect `ResilienceProfile`.

2. **Model-agnostic pagination**
   - Support common models (offset/limit, cursor, link-header) via strategies.
   - Allow custom strategies for exotic APIs.

3. **Two primary ways to consume data**
   - **Collected:** fetch all pages (subject to limits) and return a single result.
   - **Streaming:** async generator yielding each page and then returning the same result.

4. **Budget-aware**
   - Respect caller-provided `PaginationLimits` (max pages, max items, max latency) in addition to the core `ResilienceProfile`.

5. **Telemetry-friendly**
   - Emit structured `PaginationResult` and optional observer callbacks that downstream metrics/telemetry can consume.

6. **Out-of-the-box presets**
   - Provide offset/cursor presets so common APIs require minimal ceremony.

---

## 2. Dependencies & Environment

- Depends on `@airnub/resilient-http-core` v0.7.0:
  - `HttpClient`, `HttpRequestOptions`, `RequestOutcome`, `HttpMethod`, `ErrorCategory`, `AgentContext`, `Extensions`.
- TypeScript (ES2019 target or later) is assumed for the reference implementation.

All HTTP retries, timeouts, rate limits, circuit breakers, and low-level metrics are handled by the underlying `HttpClient`.

---

## 3. Core Concepts & Types

### 3.1 Page & PaginationResult

Pagination utilities deal in **pages** (raw responses + extracted items) and a **final result** summarising the run.

```ts
export interface Page<TItem = unknown, TRaw = unknown> {
  /** Zero-based index of this page (0 = first page). */
  index: number;

  /** Items extracted from this page. */
  items: TItem[];

  /** Raw parsed response value for the page (e.g. JSON body). */
  raw: TRaw;

  /**
   * HttpRequestOptions actually used for this page’s request, including
   * any modifications by pagination logic or interceptors.
   */
  request: HttpRequestOptions;
}

export interface PaginationResult<TItem = unknown, TRaw = unknown> {
  /** All pages fetched, in order. */
  pages: Page<TItem, TRaw>[];

  /** Flattened list of all items from all pages. */
  items: TItem[];

  /** Total number of pages fetched. */
  pageCount: number;

  /** Total number of items (same as items.length). */
  itemCount: number;

  /**
   * Outcomes for each individual page request in order. The length MUST
   * equal pageCount.
   */
  pageOutcomes: RequestOutcome[];

  /**
   * Optional aggregate outcome (e.g. based on the last page or a derived
   * status) that callers may use for reporting.
   */
  aggregateOutcome?: RequestOutcome;

  /** True if pagination stopped early due to limits or an error. */
  truncated: boolean;

  /** If truncated due to limits, indicates which limit was hit. */
  truncationReason?: "maxPages" | "maxItems" | "maxDurationMs" | "error";

  /** Total wall-clock duration of pagination in milliseconds. */
  durationMs: number;
}
```

### 3.2 PaginationLimits

These are high-level budgets for pagination, separate from HTTP-level `ResilienceProfile`.

```ts
export interface PaginationLimits {
  /** Maximum number of pages to fetch. Default: Infinity. */
  maxPages?: number;

  /** Maximum total items (across all pages). Default: Infinity. */
  maxItems?: number;

  /**
   * Maximum wall-clock duration in milliseconds for the entire pagination
   * run. Default: Infinity.
   */
  maxDurationMs?: number;
}
```

### 3.3 PaginationModel

Describes how a remote API exposes pagination controls.

```ts
export type PaginationModel =
  | "offsetLimit"     // offset & limit fields in query/body
  | "cursor"          // opaque cursor/nextToken in body or query
  | "linkHeader"      // RFC 5988-style Link headers
  | "pageNumber"      // explicit page numbers
  | "custom";         // user-defined
```

### 3.4 PageExtractor

`PageExtractor` knows how to pull items and next-page state from a raw response.

```ts
export interface PageExtraction<TItem = unknown, TRaw = unknown> {
  /** Items extracted from the current page. */
  items: TItem[];
  /** Raw parsed value (e.g. JSON) for the page. */
  raw: TRaw;
  /** Opaque state used by the strategy to compute the next request. */
  state?: unknown;
}

export interface PageExtractor<TItem = unknown, TRaw = unknown> {
  /**
   * Parse the raw body (typically JSON) into items and an optional state.
   * This MUST NOT perform another HTTP call.
   */
  extractPage(raw: unknown, pageIndex: number): PageExtraction<TItem, TRaw>;
}
```

### 3.5 PaginationStrategy

`PaginationStrategy` determines whether and how to fetch the next page.

```ts
export interface PaginationStrategyContext {
  /** Zero-based index of the page just fetched. */
  pageIndex: number;
  /** Last page extraction result. */
  lastExtraction: PageExtraction<any, any>;
  /** Last HttpRequestOptions used. */
  lastRequest: HttpRequestOptions;
}

export interface NextPageDecision {
  /** If false, pagination stops. */
  hasNext: boolean;
  /**
   * Next request options if hasNext is true. This MUST NOT mutate
   * lastRequest; instead it should create a new object or shallow clone.
   */
  nextRequest?: HttpRequestOptions;
}

export interface PaginationStrategy {
  /**
   * Decide whether a next page exists and construct the next request
   * options if so.
   */
  getNextPage(context: PaginationStrategyContext): NextPageDecision;
}
```

### 3.6 PaginationObserver (Optional Telemetry Hook)

Allows callers to hook into key pagination events without coupling to any specific metrics library.

```ts
export interface PaginationObserverContext<TItem = unknown, TRaw = unknown> {
  /** Client used for all page requests. */
  clientName: string;
  /** Operation name from the initial request. */
  operation: string;

  /** Limits applied to this run. */
  limits: Required<PaginationLimits>;
}

export interface PaginationObserver<TItem = unknown, TRaw = unknown> {
  /** Called once before the first page request. */
  onStart?(ctx: PaginationObserverContext<TItem, TRaw>): void | Promise<void>;

  /** Called after each page is fetched and parsed. */
  onPage?(page: Page<TItem, TRaw>, outcome: RequestOutcome): void | Promise<void>;

  /** Called once when pagination completes or fails. */
  onComplete?(result: PaginationResult<TItem, TRaw>): void | Promise<void>;
}
```

### 3.7 JsonDecoder

A small abstraction for parsing bodies; allows custom JSON parsing if needed.

```ts
export interface JsonDecoder<TRaw = unknown> {
  /**
   * Decode the response body into a raw value (typically JSON). Implementers
   * may use response.json() or custom logic.
   */
  decode(response: Response): Promise<TRaw>;
}
```

A reference implementation SHOULD provide a default `JsonDecoder` that uses `response.json()`.

---

## 4. Core Pagination APIs

### 4.1 PaginateOptions

```ts
export interface PaginateOptions<TItem = unknown, TRaw = unknown> {
  /** HttpClient instance from resilient-http-core v0.7. */
  client: HttpClient;

  /** Initial request options for the first page. */
  initialRequest: HttpRequestOptions;

  /** Pagination model to use (offset, cursor, link-header, etc.). */
  model: PaginationModel;

  /** Strategy that decides when/how to fetch the next page. */
  strategy: PaginationStrategy;

  /** Extractor that parses each page’s raw body into items and state. */
  extractor: PageExtractor<TItem, TRaw>;

  /** Limits on pages, items, and duration. */
  limits?: PaginationLimits;

  /** Optional observer for telemetry or logging. */
  observer?: PaginationObserver<TItem, TRaw>;

  /**
   * Optional decoder for raw bodies. Defaults to JSON decoder. If provided,
   * it MUST be used instead of Response.json().
   */
  decoder?: JsonDecoder<TRaw>;
}
```

`initialRequest` MUST:

- Provide at least `method`, `operation`, and either `url` or `urlParts` (per core spec).
- Typically use `GET`, but non-GET is not forbidden.

### 4.2 paginate (Collected)

```ts
export async function paginate<TItem = unknown, TRaw = unknown>(
  options: PaginateOptions<TItem, TRaw>
): Promise<PaginationResult<TItem, TRaw>>;
```

**Behavioural requirements:**

1. Apply defaults to `limits`:
   - `maxPages`: `Infinity` if not provided.
   - `maxItems`: `Infinity` if not provided.
   - `maxDurationMs`: `Infinity` if not provided.

2. Record `startTime = Date.now()`.

3. Invoke `observer.onStart` if provided.

4. Loop:
   - For each page index `i` (starting at 0):
     - Check `maxPages`, `maxItems`, `maxDurationMs` before issuing a new request:
       - If any limit is exceeded, stop and mark `truncated = true` and `truncationReason` accordingly.
     - Issue a request via `client.requestRaw(request)` where `request` starts as `initialRequest` for `i = 0` and is the `nextRequest` from previous iteration thereafter.
     - Decode the response via `decoder.decode(response)` (or JSON by default).
     - Use `extractor.extractPage(raw, i)` to get `PageExtraction`.
     - Construct a `Page` with:
       - `index`, `items`, `raw`, and the `request` used.
     - Determine or retrieve a `RequestOutcome` for this page:
       - Implementations SHOULD derive this based on the `HttpClient`’s telemetry, but MAY construct a minimal outcome using status and timestamps.
     - Append page and outcome to accumulators.
     - Call `observer.onPage` if provided.
     - If `PageExtraction.items.length > 0`, update the total item count.
     - Determine next page via `strategy.getNextPage` with `PaginationStrategyContext`.
       - If `hasNext` is false, stop.
       - Otherwise, set `request = nextRequest` and continue with next iteration.

5. After loop:
   - Compute `durationMs = Date.now() - startTime`.
   - Compute `itemCount` as total items.
   - Compute `pageCount` as total pages.
   - Optionally derive `aggregateOutcome` (e.g. last page’s outcome or a combined status).

6. Construct `PaginationResult` and call `observer.onComplete` if provided.

7. Return the `PaginationResult`.

Implementation MUST ensure:

- It does not perform any retries beyond those configured in the `HttpClient`’s `ResilienceProfile`.
- It obeys the `limits` independently from HTTP timeouts.

### 4.3 paginateStream (Async Generator)

```ts
export async function* paginateStream<TItem = unknown, TRaw = unknown>(
  options: PaginateOptions<TItem, TRaw>
): AsyncGenerator<Page<TItem, TRaw>, PaginationResult<TItem, TRaw>, void>;
```

`paginateStream` behaves like `paginate`, but yields each `Page` as it is fetched and parsed.

**Requirements:**

- It MUST share core logic with `paginate` (e.g. via an internal helper) to avoid behavioural drift.
- It MUST yield each `Page` in order.
- When pages are exhausted or a limit is hit, it MUST return the same `PaginationResult` it would have returned from `paginate`.
- If an error occurs mid-way, it MUST:
  - Stop yielding.
  - Reject the generator with the error.
  - Any partially constructed `PaginationResult` MAY be lost to the caller (but the implementation may log it internally).

Usage example:

```ts
const stream = paginateStream({ /* options */ });

for await (const page of stream) {
  // process page.items
}

// After the loop, you may optionally access the return value by consuming the final next():
// const { value: result } = await stream.next(); // if needed
```

Because async generators don’t surface the return value through a simple `for await` loop, consumers who want the `PaginationResult` SHOULD call `paginate` directly. `paginateStream` is primarily for streaming page processing.

---

## 5. Strategy & Extractor Presets

To minimise ceremony for common cases, the library MUST provide a small set of helper constructors for strategies and extractors.

### 5.1 Offset/Limit Strategy

#### 5.1.1 OffsetLimitConfig

```ts
export interface OffsetLimitConfig {
  /** Name of the query param for offset. Default: "offset". */
  offsetParam?: string;
  /** Name of the query param for limit. Default: "limit". */
  limitParam?: string;
  /** Page size (limit) to request. Required. */
  pageSize: number;
}
```

#### 5.1.2 createOffsetLimitStrategy

```ts
export function createOffsetLimitStrategy(
  config: OffsetLimitConfig
): PaginationStrategy;
```

**Behaviour:**

- For page index `i`, compute `offset = i * pageSize`.
- For `i = 0`, use `initialRequest` as-is but ensure its query contains `offsetParam=0` and `limitParam=pageSize`.
- For subsequent pages, clone `lastRequest` and update query params for the new offset.
- `hasNext` SHOULD be `true` as long as the previous page returned at least one item; if a page returns zero items, `hasNext` SHOULD be `false`.

### 5.2 Cursor Strategy

#### 5.2.1 CursorConfig

```ts
export interface CursorConfig {
  /** Name of the query parameter or body field for the cursor. */
  cursorParam: string;
  /**
   * Function to extract the next cursor from the raw response and/or
   * PageExtraction state. If it returns null/undefined, pagination stops.
   */
  getNextCursor(raw: unknown, pageIndex: number): string | null | undefined;
}
```

#### 5.2.2 createCursorStrategy

```ts
export function createCursorStrategy(
  config: CursorConfig
): PaginationStrategy;
```

**Behaviour:**

- For `pageIndex = 0`, use `initialRequest` as-is (no cursor).
- For subsequent pages, call `getNextCursor(lastExtraction.raw, pageIndex)`:
  - If null/undefined, `hasNext = false`.
  - Otherwise, `hasNext = true` and clone `lastRequest`, updating the query/body with the new cursor value under `cursorParam`.

### 5.3 PageExtractor Presets

The library SHOULD provide a few basic extractors.

#### 5.3.1 createArrayFieldExtractor

```ts
export interface ArrayFieldExtractorConfig<TItem = unknown, TRaw = any> {
  /** Path to the items array within the raw object (dot-separated). */
  itemsPath: string; // e.g. "data.items"
}

export function createArrayFieldExtractor<TItem = unknown, TRaw = any>(
  config: ArrayFieldExtractorConfig<TItem, TRaw>
): PageExtractor<TItem, TRaw>;
```

**Behaviour:**

- Interprets `raw` as an object.
- Navigates the `itemsPath` to find an array.
- Returns `items` as that array (or `[]` if not found).
- Sets `raw` to the original raw object and `state` to undefined.

Other simple extractors (e.g. path-to-array-of-objects) MAY be provided but are not strictly required by the spec.

---

## 6. High-Level Helper APIs

To support common flows and AI-friendly patterns, the library MUST expose a small set of convenience functions built on top of `paginate`.

### 6.1 paginateOffsetLimit

```ts
export interface PaginateOffsetLimitOptions<TItem = unknown, TRaw = any>
  extends Omit<PaginateOptions<TItem, TRaw>, "model" | "strategy"> {
  offsetConfig: OffsetLimitConfig;
}

export function paginateOffsetLimit<TItem = unknown, TRaw = any>(
  options: PaginateOffsetLimitOptions<TItem, TRaw>
): Promise<PaginationResult<TItem, TRaw>>;
```

**Behaviour:**

- Internally calls `paginate` with:
  - `model: "offsetLimit"`.
  - `strategy: createOffsetLimitStrategy(offsetConfig)`.

### 6.2 paginateCursor

```ts
export interface PaginateCursorOptions<TItem = unknown, TRaw = any>
  extends Omit<PaginateOptions<TItem, TRaw>, "model" | "strategy"> {
  cursorConfig: CursorConfig;
}

export function paginateCursor<TItem = unknown, TRaw = any>(
  options: PaginateCursorOptions<TItem, TRaw>
): Promise<PaginationResult<TItem, TRaw>>;
```

**Behaviour:**

- Internally calls `paginate` with:
  - `model: "cursor"`.
  - `strategy: createCursorStrategy(cursorConfig)`.

### 6.3 paginateUntil (AI-Friendly Predicate)

```ts
export interface PaginateUntilOptions<TItem = unknown, TRaw = any>
  extends PaginateOptions<TItem, TRaw> {
  /** Stop early if this predicate returns true for any item. */
  stopWhen?: (item: TItem, page: Page<TItem, TRaw>) => boolean;
}

export async function paginateUntil<TItem = unknown, TRaw = any>(
  options: PaginateUntilOptions<TItem, TRaw>
): Promise<PaginationResult<TItem, TRaw>>;
```

**Behaviour:**

- Behaves like `paginate` but after each page is extracted:
  - Iterates `page.items`.
  - If `stopWhen` returns true for any item, stops pagination and sets:
    - `truncated = true`.
    - `truncationReason = "maxItems"` or a special internal reason (implementation-specific, but MUST be documented).

This is intended to support “scan until a condition is found” use cases common in AI pipelines.

---

## 7. Relationship to Resilience & Policies

### 7.1 Resilience

- All HTTP-level retries, backoffs, and timeouts are governed by the `HttpClient`’s `ResilienceProfile` and interceptors.
- `@airnub/resilient-http-pagination` MUST NOT implement its own retries.
- It MAY set or adjust `ResilienceProfile` on per-page `HttpRequestOptions` (e.g. to tighten budget mid-run), but SHOULD do so sparingly and document any behaviour.

### 7.2 Policies & Rate Limits

- Policy engines and rate limiters live in other libraries (e.g. `@airnub/resilient-http-policies`).
- Pagination MUST treat them as transparent: each page request is just another `HttpClient` call that may be delayed or denied.
- If a page request is denied (e.g. by a policy interceptor throwing), pagination MUST propagate the error and mark the result (if constructed) as `truncated` with `truncationReason = "error"` if it chooses to capture a partial result internally.

---

## 8. Versioning & Stability

The following types and functions are considered the **public, stable surface** of `@airnub/resilient-http-pagination` v0.3.0 and SHOULD remain compatible across 0.3.x and 1.x with only additive changes:

- Types:
  - `Page<TItem, TRaw>`
  - `PaginationResult<TItem, TRaw>`
  - `PaginationLimits`
  - `PaginationModel`
  - `PageExtraction<TItem, TRaw>`
  - `PageExtractor<TItem, TRaw>`
  - `PaginationStrategyContext`
  - `NextPageDecision`
  - `PaginationStrategy`
  - `PaginationObserverContext<TItem, TRaw>`
  - `PaginationObserver<TItem, TRaw>`
  - `JsonDecoder<TRaw>`
  - `PaginateOptions<TItem, TRaw>`
  - `OffsetLimitConfig`, `CursorConfig`
  - `ArrayFieldExtractorConfig<TItem, TRaw>`
  - `PaginateOffsetLimitOptions<TItem, TRaw>`
  - `PaginateCursorOptions<TItem, TRaw>`
  - `PaginateUntilOptions<TItem, TRaw>`

- Functions:
  - `paginate`
  - `paginateStream`
  - `createOffsetLimitStrategy`
  - `createCursorStrategy`
  - `createArrayFieldExtractor`
  - `paginateOffsetLimit`
  - `paginateCursor`
  - `paginateUntil`

Breaking changes to these MUST be made only in a new major version.

---

## 9. Reference Implementation Notes (Non-normative)

1. **Shared engine:**
   - Implement an internal `runPagination` helper that contains the loop logic, used by both `paginate` and `paginateStream`.

2. **Avoid double JSON parsing:**
   - Use a single `JsonDecoder` instance per run; do not call `response.json()` multiple times.

3. **RequestOutcome integration:**
   - If the `HttpClient` implementation exposes a way to attach `RequestOutcome` to responses or via callbacks, integrate directly.
   - Otherwise, synthesize a minimal `RequestOutcome` (status, attempts = 1, duration, errorCategory) for each page.

4. **Performant cloning:**
   - When constructing `nextRequest`, prefer shallow clones of `HttpRequestOptions` and nested objects (headers, query) to avoid mutation bugs.

5. **Testing:**
   - Add tests for:
     - Each pagination model and preset strategy.
     - Limit enforcement (pages, items, duration).
     - Observer callbacks order and behaviour.
     - Error propagation when `HttpClient` fails.

This spec, together with the `resilient-http-core` v0.7.0 spec, is sufficient for a developer or coding agent to implement `@airnub/resilient-http-pagination` v0.3.0 in a new codebase.