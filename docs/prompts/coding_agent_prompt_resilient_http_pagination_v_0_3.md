# CODING_AGENT_PROMPT.md — `@airnub/resilient-http-pagination` v0.3

## 0. Role & Scope

You are a **senior TypeScript engineer** working in the `tradentic/institutional-rotation-detector` monorepo.

Your job in this prompt is **only** to implement and align the package:

> `@airnub/resilient-http-pagination`

with its v0.3 pagination spec, building on **`@airnub/resilient-http-core` v0.7**.

Do not modify other packages except for minimal type/import fixes. Other packages have their own prompts.

---

## 1. Source of Truth

Treat these documents as the **source of truth** for this package:

- Core v0.7 spec:
  - `docs/specs/resilient_http_core_spec_v_0_7.md`
- Pagination v0.3 spec:
  - `docs/specs/resilient_http_pagination_spec_v_0_3.md`

If code disagrees with these docs, **the docs win**. The pagination package must not re-implement core’s resilience or telemetry; it must *use* the v0.7 core primitives.

---

## 2. Global Constraints

- Language: **TypeScript** with `strict: true`.
- Dependencies:
  - It may depend on `@airnub/resilient-http-core`.
  - It must not pull in heavy external resilience or telemetry libraries.
- No API-specific or provider-specific logic (no FINRA/SEC/UW/OpenAI semantics here).

---

## 3. Implementation Tasks

### 3.1 Public API & Types

Implement the public API exactly as described in `resilient_http_pagination_spec_v_0_3.md`:

- Functions:
  - `paginate<TItem>(options: PaginateOptions<TItem>): Promise<PaginationResult<TItem>>`.
  - `paginateStream<TItem>(options: PaginateOptions<TItem>): AsyncGenerator<Page<TItem>, PaginationResult<TItem>, void>`.

- Core types:
  - `PaginationModel` (`'offset-limit' | 'cursor' | 'link-header' | 'custom'`, or whatever the spec defines).
  - `Page<TItem>` — single page (items + metadata).
  - `PaginationResult<TItem>` — run-level summary.
  - `PaginationLimits` — `maxPages`, `maxItems`, `maxEndToEndLatencyMs` (or equivalent per spec).
  - `PaginationResilience` — hints for per-page `ResilienceProfile`.
  - `PageExtractor<TItem>` and `PageExtraction<TItem>`.
  - `PaginationStrategy`.
  - `PaginationObserver` — callbacks (`onPage`, `onComplete`, `onError` as per spec).

Export all required types from this package’s public barrel file.

### 3.2 Integration with Core v0.7

Use `@airnub/resilient-http-core` types and client:

- Accept a `HttpClient` instance from core and `HttpRequestOptions` for the initial request.
- Do **not** re-implement HTTP transports, retries, or metrics.
- For each page request:
  - Clone and adjust the `HttpRequestOptions` (e.g., query params) via `PaginationStrategy`.
  - Preserve and propagate:
    - `correlation` (`CorrelationInfo`), updating `requestId` per page if spec requires or keeping per-run if specified.
    - `agentContext` (`AgentContext`).
    - `extensions` (including `ai.provider`, `ai.model`, etc., if present).
  - Optionally use per-page `ResilienceProfile` hints (`PaginationResilience`) that merge into core’s `HttpRequestOptions.resilience`.

Aggregate a **run-level `RequestOutcome`** (attempts, duration, final status, errorCategory, RateLimitFeedback) for the entire pagination run when the spec requires it.

### 3.3 Built-in Strategies

Implement built-in `PaginationStrategy` implementations described in the spec, e.g.:

- `OffsetLimitStrategy`:
  - Uses query parameters like `limit` and `offset`.
- `CursorStrategy`:
  - Uses a cursor/token returned in the response body for the next page.
- `LinkHeaderStrategy`:
  - Parses `Link` headers (e.g., `rel="next"`) to determine the next URL or parameters.

Each strategy must:

- Provide initial `HttpRequestOptions` based on the `PaginateOptions`.
- Provide next `HttpRequestOptions` given a `PageExtraction` and current state.
- Signal completion (no more pages) correctly.

### 3.4 Page Extraction

Implement `PageExtractor<TItem>` abstractions that:

- Parse a `Response` (or its decoded JSON) into:
  - `items: TItem[]`.
  - Paging state (cursor, next offset, hasMore, etc.) as defined in the spec.
  - Optional additional metadata (status code, raw response, etc.).

Allow callers to plug custom extractors for odd-shaped APIs.

### 3.5 Limits & Stop Conditions

Implement `PaginationLimits` semantics exactly as per the spec:

- Stop when `maxPages` is reached.
- Stop when `maxItems` is reached.
- Stop when max end-to-end latency is exceeded.

Ensure the run-level result reports whether completion was natural or due to a limit being hit, if specified by the spec.

### 3.6 Observers & Streaming

- `paginate` must:
  - Execute all pages until a stop condition.
  - Invoke `PaginationObserver` callbacks (`onPage`, `onComplete`, `onError`) as defined.
  - Return a final `PaginationResult<TItem>`.

- `paginateStream` must:
  - Yield `Page<TItem>` objects as they are fetched.
  - Respect the same limits and stop conditions.
  - Return the final `PaginationResult<TItem>` when the iterator completes.

Both functions must use `HttpClient.requestJson` / `requestRaw` depending on what the extractor expects.

---

## 4. Tests

Add tests under this package to cover:

- Offset/limit, cursor, and link-header strategies with fake `HttpClient` responses.
- Stop conditions for `maxPages`, `maxItems`, and time-based limits.
- Error handling mid-run (e.g., early failure vs partial results).
- Propagation of `correlation`, `agentContext`, and `extensions` across pages.
- Correct aggregation of run-level `RequestOutcome`.

Use stubs/mocks for `HttpClient` from `@airnub/resilient-http-core`.

---

## 5. Done Definition

You are **done** for this prompt when:

- The package compiles with all types and exports matching `resilient_http_pagination_spec_v_0_3.md`.
- It depends on `@airnub/resilient-http-core` and uses its `HttpClient` correctly.
- No resilience/telemetry logic is duplicated from core; the package only orchestrates pagination.
- Tests pass and validate strategies, limits, and core integration.

Do not modify core or other satellites in this prompt beyond what’s required to satisfy imports and types.

