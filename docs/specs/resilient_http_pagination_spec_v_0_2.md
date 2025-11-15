# `@airnub/resilient-http-pagination` — Spec v0.2

**Status:** Draft for implementation  \
**Previous:** v0.1  \
**Depends on:** `@tradentic/resilient-http-core` v0.6+  \
**Scope:** Higher-level pagination helpers built on top of `resilient-http-core`, supporting both traditional APIs and AI/agent workloads.

v0.2 updates the initial v0.1 design to:

- Integrate with **core v0.6** features: `ResilienceProfile`, `ErrorClassifier`, `RateLimitFeedback`, `RequestOutcome`, `HttpRequestInterceptor`.
- Treat multi-page fetches as **first-class operations** with budgets and telemetry, not just loops.
- Remain **transport-agnostic** (i.e. only depend on core `HttpClient` and types, not on any specific provider SDK).

The library is intended for use by:

- Traditional HTTP clients (REST/JSON, offset/limit or cursor-based pagination).
- AI agent systems (e.g., fetching multi-page logs, result sets, or provider dashboards).

---

## 1. Goals

1. Provide a small, composable API for **paginated fetches** built on top of `resilient-http-core`:
   - Offset/limit pagination.
   - Cursor/continuation-token pagination.
   - Link-based pagination (e.g. `next` URL in headers).
   - A pluggable, custom strategy.

2. Integrate pagination with **v0.6 resilience features**:
   - Each page fetch uses the same core retry/circuit/metrics mechanisms.
   - A pagination run has its own **budgets** (`maxPages`, `maxItems`, `maxEndToEndLatencyMs`).
   - Pagination can respect provider **rate-limit feedback** and core-level `ResilienceProfile`.

3. Offer both:
   - A **collected** `paginate` API (returns all items/pages).
   - A **streaming** async iterator API for incremental consumption.

4. Keep the library **agnostic and small**:
   - No provider-specific logic (e.g. OpenAI, Anthropic) baked in.
   - AI/agent-specific logic lives in satellite libs (e.g. `@airnub/agent-conversation-core`).

---

## 2. Compatibility

- v0.2 is a superset of v0.1. Where v0.1 types or behaviours differ, v0.2 should:
  - Maintain existing exports where feasible, or
  - Provide adapter shims and clear migration notes.
- The major change is that v0.2 now expects `@tradentic/resilient-http-core` v0.6 and integrates with:
  - `HttpRequestOptions.resilience`.
  - `ErrorClassifier` via the underlying `HttpClient`.
  - `RateLimitFeedback` and `RequestOutcome` via metrics.

---

## 3. Core Concepts

### 3.1 PaginationModel

To support different API styles, define a simple enumeration:

```ts
export type PaginationModel =
  | 'offset-limit'
  | 'cursor'
  | 'link-header'
  | 'custom';
```

- **`offset-limit`**: requests use `offset` + `limit` (or `page` + `pageSize`) query params.
- **`cursor`**: requests include a cursor/continuation token in query or body.
- **`link-header`**: the next page URL is extracted from `Link` or similar headers.
- **`custom`**: user-defined `PaginationStrategy` handles both request building and next-page logic.

### 3.2 Page & PaginationResult

A _page_ is a single HTTP response and its extracted items.

```ts
export interface Page<TItem> {
  /** 0-based page index for this run. */
  index: number;

  /** Items extracted from this page. */
  items: TItem[];

  /** Raw HTTP status for this page. */
  status: number;

  /** Original HttpRequestOptions used for this page. */
  request: HttpRequestOptions;

  /** Raw Response, if needed by callers (may be optional/omitted in some helpers). */
  response?: Response;

  /**
   * Opaque state returned by the pagination strategy (e.g. next cursor).
   * The core does not interpret this.
   */
  state?: unknown;
}

export interface PaginationResult<TItem> {
  /** All pages returned (may be truncated by limits). */
  pages: Page<TItem>[];

  /** Flattened list of items across all pages. */
  items: TItem[];

  /**
   * True if the run stopped because there were no more pages.
   * False if it stopped due to a limit or external stop condition.
   */
  completed: boolean;

  /** Total number of items collected. */
  totalItems: number;

  /** Number of pages fetched. */
  totalPages: number;

  /** High-level summary of the run outcome. */
  outcome: RequestOutcome;
}
```

> `RequestOutcome` is re-used from core v0.6, but at the **pagination run** level, not just per page. See §4.4 for details.

### 3.3 Extractor & Strategy

Pagination is separated into:

1. A **page extractor** that converts a `Response` into items and pagination state.
2. A **strategy** that knows how to build the next `HttpRequestOptions` given state.

#### 3.3.1 PageExtractor

```ts
export interface PageExtraction<TItem> {
  /** Items extracted from this response. */
  items: TItem[];

  /** State used to compute the next page (cursor, next offset, etc.). */
  state?: unknown;

  /** True if there are no further pages. */
  done?: boolean;
}

export type PageExtractor<TItem> = (response: Response) => Promise<PageExtraction<TItem>>;
```

The library does not interpret the body; the user (or provider-specific helper) parses JSON, XML, etc., and returns `PageExtraction`.

#### 3.3.2 PaginationStrategy

```ts
export interface PaginationStrategyState {
  /** 0-based page index. */
  pageIndex: number;

  /** Count of items collected so far (from previous pages). */
  collectedItems: number;

  /**
   * Opaque user state carried between pages. May include cursor, offsets,
   * or any provider-specific info.
   */
  userState?: unknown;
}

export interface PaginationStrategy {
  /**
   * Build the HttpRequestOptions for the first page.
   */
  buildInitialRequest(base: HttpRequestOptions): HttpRequestOptions;

  /**
   * Given previous request, page extraction, and strategy state, construct
   * the next request options or return undefined if there are no more pages.
   */
  buildNextRequest(
    previousRequest: HttpRequestOptions,
    previousExtraction: PageExtraction<unknown>,
    state: PaginationStrategyState
  ): HttpRequestOptions | undefined;
}
```

> Note: The core generic APIs will wrap `PaginationStrategy` in a type-erased manner for different `TItem`, so `PageExtraction<unknown>` is acceptable here.

The library should ship built-in strategies for:

- `OffsetLimitStrategy`: implements `offset-limit`.
- `CursorStrategy`: implements `cursor`-style pagination.
- `LinkHeaderStrategy`: implements `link-header` pagination.

A `CustomStrategy` can be created by users implementing `PaginationStrategy` directly.

---

## 4. API Surface

### 4.1 Configuration Types

#### 4.1.1 PaginationLimits

Controls the bounds of a single pagination run.

```ts
export interface PaginationLimits {
  /** Maximum number of pages to fetch (inclusive). */
  maxPages?: number;

  /** Maximum total items to collect across all pages. */
  maxItems?: number;

  /**
   * Optional hard cap on end-to-end latency of the pagination run,
   * in milliseconds. If set, the run must stop once exceeded.
   */
  maxEndToEndLatencyMs?: number;
}
```

#### 4.1.2 PaginationResilience

Allows the caller to provide optional resilience hints specific to the pagination run.

```ts
export interface PaginationResilience {
  /**
   * Optional ResilienceProfile to apply to each page request.
   * May be merged with or override the profile in baseRequest.resilience.
   */
  pageProfile?: ResilienceProfile;

  /**
   * If true, the library should attempt to keep individual page requests
   * within a uniform per-page latency budget derived from maxEndToEndLatencyMs.
   */
  normalizePerPageLatency?: boolean;
}
```

#### 4.1.3 PaginationObserver

Hook for observability and external policy controllers.

```ts
export interface PaginationObserver<TItem = unknown> {
  /**
   * Called after each successful page fetch.
   */
  onPage?(page: Page<TItem>, ctx: PaginationRunContext): void | Promise<void>;

  /**
   * Called when the pagination run completes (successfully or not).
   */
  onComplete?(result: PaginationResult<TItem>, ctx: PaginationRunContext): void | Promise<void>;
}
```

`PaginationRunContext` captures run-level metadata:

```ts
export interface PaginationRunContext {
  /**
   * User-supplied identifier for this pagination run (optional).
   */
  runId?: string;

  /**
   * The agent context for this run, if any.
   */
  agentContext?: AgentContext;

  /**
   * The original base request options.
   */
  baseRequest: HttpRequestOptions;

  /**
   * Limits and resilience configuration in effect for this run.
   */
  limits: PaginationLimits;
  resilience?: PaginationResilience;
}
```

### 4.2 `paginate` (collecting API)

#### 4.2.1 Signature

```ts
export interface PaginateOptions<TItem> {
  /** The core HTTP client to use. */
  client: HttpClient;

  /**
   * Base request options (method, path, query, headers, etc.).
   * For GET-style pagination, method is typically 'GET'.
   */
  baseRequest: HttpRequestOptions;

  /** Pagination model to use. */
  model: PaginationModel;

  /** Strategy for constructing next-page requests. */
  strategy?: PaginationStrategy; // optional for built-in models

  /** Extractor for items and per-page state. */
  extractPage: PageExtractor<TItem>;

  /** Run-level limits (maxPages, maxItems, maxEndToEndLatencyMs). */
  limits?: PaginationLimits;

  /** Optional resilience hints for page requests. */
  resilience?: PaginationResilience;

  /**
   * Optional observer to receive page-level and run-level callbacks.
   */
  observer?: PaginationObserver<TItem>;

  /**
   * Stop condition: if provided and returns true, pagination stops
   * after the current page.
   */
  stopWhen?: (page: Page<TItem>, context: PaginationRunContext) => boolean | Promise<boolean>;
}

export declare function paginate<TItem>(
  options: PaginateOptions<TItem>
): Promise<PaginationResult<TItem>>;
```

#### 4.2.2 Behaviour

- **Initialization**:
  - Record `runStartedAt` timestamp.
  - Initialize `PaginationRunContext` with:
    - `runId` (from `baseRequest.agentContext?.runId` or generated).
    - `agentContext` (from `baseRequest.agentContext`).
    - `baseRequest` (as provided).
    - `limits` and `resilience` (normalized with defaults).
  - Build the first request using `strategy.buildInitialRequest(baseRequest)` or a built-in strategy based on `model`.

- **Page loop**:
  - For each page:
    - Apply **core interceptors** and send request via `client`.
    - Let the core handle retries, backoff, and `ErrorClassifier` decisions.
    - On success:
      - Call `extractPage(response)` to get `items`, `state`, `done`.
      - Build a `Page<TItem>` with `index`, `items`, `status`, `request`, `response`, `state`.
      - Append to `pages` and update accumulated `items`.
      - Invoke `observer.onPage` if present.
      - Check termination conditions:
        - `done === true`.
        - Limits (`maxPages`, `maxItems`, `maxEndToEndLatencyMs`).
        - `stopWhen` callback (if returns true).
      - If no termination condition is met, compute the next request via `strategy.buildNextRequest(...)`.
    - On error:
      - The error will already have been classified and retried by `client` according to its policies.
      - If an error escapes, the pagination run ends with `completed = false`.

- **Completion**:
  - Record `runFinishedAt`.
  - Build `RequestOutcome` for the run:
    - `ok`: whether the run ended due to `done` or a stop condition, not due to an uncaught error.
    - `status`: last page status or undefined if no pages.
    - `errorCategory`: derived from last classified error if applicable.
    - `attempts`: total number of HTTP attempts across all pages (sum of per-page attempts; requires cooperation from `HttpClient`, see §4.4.2).
    - `startedAt`/`finishedAt`: run-level timestamps.
  - Build `PaginationResult<TItem>`.
  - Invoke `observer.onComplete` if present.

### 4.3 `paginateStream` (async iterator API)

#### 4.3.1 Signature

```ts
export declare function paginateStream<TItem>(
  options: PaginateOptions<TItem>
): AsyncGenerator<Page<TItem>, PaginationResult<TItem>, void>;
```

#### 4.3.2 Behaviour

- Behaves like `paginate`, but yields each `Page<TItem>` as it is fetched.
- When the stream finishes (due to `done`, limits, or stop condition), the generator returns a `PaginationResult<TItem>`.
- If an error escapes (post-retries), the generator throws and no final `PaginationResult` is produced by the generator.

### 4.4 Interaction with Core v0.6 Types

#### 4.4.1 ResilienceProfile

- If `PaginationResilience.pageProfile` is provided:
  - For each page, start from `baseRequest.resilience` and merge with `pageProfile`, where `pageProfile` wins on conflicts.
  - The merged profile is attached to each per-page `HttpRequestOptions`.
- If `limits.maxEndToEndLatencyMs` is set and `PaginationResilience.normalizePerPageLatency` is true:
  - The library may compute a per-page `maxEndToEndLatencyMs` budget based on remaining global budget and expected remaining pages.
  - This budget should be passed into each per-page `ResilienceProfile` (e.g., as `maxEndToEndLatencyMs`).

#### 4.4.2 RequestOutcome & attempts aggregation

- The core `HttpClient` v0.6 tracks per-request attempts and emits a `RequestOutcome` in metrics.
- Pagination cannot directly access internal client metrics but can:
  - Use `observer` callbacks and `extensions` to correlate per-page outcomes, or
  - Accept an optional `onPageMetrics` hook in a future version.
- For v0.2, the pagination run-level `RequestOutcome.attempts` is defined as:
  - The count of **logical** page attempts (one per successful page response + one per failed page that terminates the run).
  - Implementations may optionally include per-page retry counts based on additional integration work; for now, a simpler approximation is acceptable.

#### 4.4.3 AgentContext & correlation

- `baseRequest.agentContext`, `correlationId`, `parentCorrelationId` must be preserved on each page request unless explicitly overridden.
- Pagination must not generate new correlation IDs per page unless specifically requested; the run should share a correlation context for easier tracing.

#### 4.4.4 Extensions & AI conventions

- Pagination should respect any existing `baseRequest.extensions` and propagate them to each page request.
- If AI conventions are used (e.g. `extensions['ai.provider']`, `extensions['ai.model']`), pagination must not alter them.

---

## 5. Built-in Strategies

### 5.1 OffsetLimitStrategy

Configuration:

```ts
export interface OffsetLimitConfig {
  offsetParam?: string; // default: 'offset'
  limitParam?: string;  // default: 'limit'
  initialOffset?: number; // default: 0
  pageSize?: number; // required unless set in baseRequest.query
}
```

Factory:

```ts
export function createOffsetLimitStrategy(config?: OffsetLimitConfig): PaginationStrategy;
```

Behaviour:

- `buildInitialRequest`:
  - Adds `offsetParam = initialOffset` and `limitParam = pageSize` to `base.query`.
- `buildNextRequest`:
  - If `previousExtraction.done === true` or previous page had `items.length === 0`, returns `undefined`.
  - Otherwise increments offset by `pageSize` and returns a new request.

### 5.2 CursorStrategy

Configuration:

```ts
export interface CursorConfig {
  cursorParam?: string; // e.g. 'cursor'
  initialCursor?: string | null;
}
```

Factory:

```ts
export function createCursorStrategy(config?: CursorConfig): PaginationStrategy;
```

Behaviour:

- Expects `PageExtraction.state` to contain the next cursor (e.g., a string or null).
- `buildInitialRequest`:
  - If `initialCursor` is set, include it in query/body under `cursorParam`.
- `buildNextRequest`:
  - If `previousExtraction.done === true` or `state` has no cursor, return `undefined`.
  - Otherwise, include cursor in next request.

### 5.3 LinkHeaderStrategy

Configuration:

```ts
export interface LinkHeaderConfig {
  rel?: string; // default: 'next'
}
```

Factory:

```ts
export function createLinkHeaderStrategy(config?: LinkHeaderConfig): PaginationStrategy;
```

Behaviour:

- `buildInitialRequest`: returns `baseRequest` as-is.
- `buildNextRequest`:
  - Reads `Link` (or configurable header) from the previous `Response` (available via `Page.state` if needed or via an internal mapping).
  - If no `next` link is present, return `undefined`.
  - Otherwise, build a request for the `next` URL (may override base `path` and `query`).

> Implementation detail: the strategy may need access to the `Response` headers; this can be achieved by storing relevant header info into `PageExtraction.state` during extraction.

---

## 6. Testing & Validation

The implementation must include tests that cover:

1. **OffsetLimitStrategy basics**:
   - Correct initial query parameters.
   - Correct next-page request construction.
   - Stopping when items run out or `done` is set.

2. **CursorStrategy basics**:
   - Correct cursor propagation.
   - Stopping when no cursor is returned or `done` is set.

3. **LinkHeaderStrategy basics**:
   - Correct parsing of `Link` headers.
   - Stopping when no `rel=next` is present.

4. **Limits & stop conditions**:
   - `maxPages` and `maxItems` enforcement.
   - `stopWhen` short-circuiting.
   - `maxEndToEndLatencyMs` from `PaginationLimits`.

5. **Resilience integration**:
   - Respect of `PaginationResilience.pageProfile` merging.
   - Propagation of `AgentContext`, `correlationId`, and `extensions` to each page.

6. **Observer callbacks**:
   - `onPage` is called for each page.
   - `onComplete` is called exactly once with the final `PaginationResult`.

7. **Streaming API (`paginateStream`)**:
   - Pages are yielded incrementally.
   - Final `PaginationResult` is returned when iteration finishes.

---

## 7. Future Extensions (Beyond v0.2)

- Deeper integration with `RateLimitFeedback` and `RequestOutcome` metrics from core to compute per-run attempts more precisely.
- Concurrency control for fetching multiple pages in parallel when supported by APIs.
- Higher-level helpers for specific providers (e.g., GitHub, SEC EDGAR) in separate packages.
- Policy-driven pagination profiles in `@airnub/resilient-http-policies` (e.g., different limits for background vs interactive workloads).

v0.2 provides the foundational abstractions and hooks needed for those future enhancements while remaining minimal and provider-agnostic.