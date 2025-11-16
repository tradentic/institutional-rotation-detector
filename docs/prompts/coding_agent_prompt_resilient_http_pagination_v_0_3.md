# CODING_AGENT_PROMPT.md — `@airnub/resilient-http-pagination` v0.3

## 0. Role & Context

You are a **senior TypeScript engineer**. Your task is to implement or align `@airnub/resilient-http-pagination` with its v0.3 spec, using `@airnub/resilient-http-core` v0.7 as the transport.

This package must handle **multi-page HTTP runs** (REST/JSON pagination) on top of the core, without adding new concerns into the core itself.

---

## 1. Source of Truth

Use this spec as authoritative:

- `docs/specs/resilient_http_pagination_spec_v_0_3.md`

If code disagrees with the spec, the spec wins. Preserve existing behaviour where possible.

---

## 2. Global Constraints

- TypeScript with `strict: true`.
- No direct network code; always go through `HttpClient` from `@airnub/resilient-http-core`.
- No dependencies on Redis/DBs/OTEL.
- This package must not modify `@airnub/resilient-http-core`.

---

## 3. Tasks

### 3.1 Core Types & Models

Implement or align the following types exactly as described in the spec:

- `PaginationModel` (e.g. `'offset-limit' | 'cursor' | 'link-header' | 'custom'`).
- `Page<TItem>` — a single page of results plus associated metadata.
- `PaginationResult<TItem>` — run-level summary (pages, items, completed flag, aggregated outcome).
- `PaginationLimits` — `maxPages`, `maxItems`, `maxEndToEndLatencyMs`.
- `PageExtractor<TItem>` — parses an HTTP response into a `Page<TItem>`.
- `PaginationStrategy` — generates initial and next `HttpRequestOptions`.
- `PaginationObserver` — hooks for `onPage`, `onComplete`.

### 3.2 Core API Functions

Implement:

- `paginate<TItem>(options: PaginateOptions<TItem>): Promise<PaginationResult<TItem>>`
- `paginateStream<TItem>(options: PaginateOptions<TItem>): AsyncGenerator<Page<TItem>, PaginationResult<TItem>, void>`

Ensure both:

- Use a provided `HttpClient` for each page.
- Propagate `AgentContext`, `correlationId`, and `extensions` to each `HttpRequestOptions`.
- Respect `PaginationLimits` strictly.

### 3.3 Built-in Strategies & Helpers

Implement helpers described in the spec, such as:

- Strategy builders:
  - `createOffsetLimitStrategy(...)`
  - `createCursorStrategy(...)`
- Extractors:
  - `createArrayFieldExtractor(...)` for common JSON response shapes.
- Convenience functions:
  - `paginateOffsetLimit(...)`
  - `paginateCursor(...)`
  - `paginateUntil(...)` (predicate-based termination).

These must be thin wrappers over the core `paginate`/`paginateStream`.

### 3.4 Resilience & Outcome Aggregation

- Each page request must accept a `ResilienceProfile` (potentially different from single-call defaults).
- Aggregate `RequestOutcome` from each page into a run-level summary as described in the spec.

---

## 4. Tests

Create tests that use a **fake `HttpClient`**:

- Simulate paged APIs (offset/limit and cursor-based) with deterministic responses.
- Verify:
  - Correct number of requests for given `maxPages` / `maxItems`.
  - Correct aggregation of all items into `PaginationResult.items`.
  - Correct `completed` flag when:
    - There are no more pages.
    - Limits are hit.
  - Correct aggregation of `RequestOutcome`.
  - Propagation of `AgentContext`, correlation IDs, and `extensions`.

---

## 5. Acceptance Criteria

- Public API matches `resilient_http_pagination_spec_v_0_3.md`.
- Core remains untouched; pagination logic is fully contained in this package.
- `paginate` and `paginateStream` are covered by deterministic tests.
- Existing HTTP clients that need pagination can be migrated to this package without changes to core.

