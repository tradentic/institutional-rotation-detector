# Resilient HTTP Ecosystem – Core Spec v0.8.0 (Updated)

> **Status:** v0.8.0 – Evolution of v0.7  
> Cleans up deprecated fields, introduces shared `BudgetHints`, and adds satellites/testing/runtime.  
> Assumes no *runtime* compatibility is required with pre‑0.7 drafts, but the core `HttpClient` execution model is unchanged from v0.7.
>
> **Scope:** Core HTTP client + satellites + testing & runtime composition utilities
>
> - `@airnub/resilient-http-core`
> - `@airnub/resilient-http-policies`
> - `@airnub/resilient-http-pagination`
> - `@airnub/agent-conversation-core`
> - `@airnub/http-llm-openai`
> - `@airnub/agent-browser-guardrails`
> - `@airnub/resilient-http-testing` (testing helpers)
> - `@airnub/agent-runtime` (opinionated agent runtime)
>
> **Compatibility:** This spec is an **evolution of v0.7**. The `HttpClient` execution
> model (merge resilience → retry loop → classification → metrics/tracing) remains
> the same. v0.8 refines types, removes deprecated fields, and adds satellites,
> testing utilities, and an agent runtime. Implementers with a v0.7‑aligned
> client should treat v0.8 as a **refactor**, not a ground‑up rewrite.

---

## 1. Design Goals & Non‑Goals

### 1.1 Goals

1. **Small, boring core**
   - A minimal, well‑typed `HttpClient` with built‑in resilience, metrics hooks,
     and a single extension mechanism (interceptors).

2. **Zero external deps by default**
   - All packages are usable with:
     - global `fetch` in browsers/edge, or
     - a tiny fetch polyfill in Node.
   - No required Redis, OTEL, or queue dependencies; those plug in via
     interfaces.

3. **Single interceptor model**
   - Interceptors are the *only* way to customize requests/responses:
     - Auth, logging, tracing, caching, policies, guardrails, test transport
       recording/replay, etc.

4. **Classification‑driven resilience**
   - Retries and backoff controlled by:
     - `ResilienceProfile` (per request), and
     - `ErrorClassifier` → `ErrorCategory` + `FallbackHint`.

5. **Telemetry‑first**
   - Every logical request emits a `RequestOutcome` and a `MetricsRequestInfo`.
   - Optional tracing spans can be created around each logical request.

6. **First‑class AI & multi‑tenant semantics**
   - `AgentContext` + `extensions` carry agent/tenant/AI metadata.
   - Policies and guardrails can base decisions on client, tenant, provider,
     model, and request class.

7. **Testable & agent‑friendly**
   - A dedicated testing package with record/replay transports and a
     `createTestHttpClient` helper.
   - Agent‑focused runtime that composes core + OpenAI + conversation +
     guardrails + policies into a simple factory.

8. **Self‑contained for coding agents**
   - This spec alone should be enough for a senior engineer or coding agent to
     implement the entire ecosystem from scratch—or to evolve an existing
     v0.7‑style implementation with minimal disruption.

### 1.2 Non‑Goals

1. **Shipping infra backends**
   - We define `PolicyStore`, but do not prescribe Redis/SQL schemas.

2. **Full provider zoo**
   - Only OpenAI‑style LLM HTTP is specified; other providers can follow the
     same patterns.

3. **Domain‑specific business rules**
   - Sector-specific rules (finance, media, healthcare) live outside this
     ecosystem.

---

## 2. Package Overview & Dependency Graph

_(unchanged from previous v0.8 draft; omitted here for brevity in this summary – keep the full package list and dependency graph as already defined.)_

---

## 3. Core Concepts

_(unchanged conceptually; keep sections on logical request vs attempt, operations, correlation/AgentContext, extensions, `BudgetHints`, `ResilienceProfile` as in the previous v0.8 spec.)_

---

## 4. Core API – `@airnub/resilient-http-core`

The v0.8 `HttpClient` **execution model is identical to v0.7**:

1. Merge client‑level defaults, per‑request overrides, and resilience profile.
2. Start a logical request with `requestId` and `correlationId`.
3. Enter a retry loop that:
   - Creates a per‑attempt `AbortController` with a per‑attempt timeout (if set).
   - Calls the transport once per attempt.
   - Classifies failures via `ErrorClassifier`.
   - Decides retry vs fail based on category, `FallbackHint`, method idempotency,
     and `ResilienceProfile`.
   - Applies exponential backoff with jitter and respects `retryAfterMs` when
     appropriate.
4. After the last attempt, compute a `RequestOutcome` representing the whole
   logical request.
5. Emit a single metrics/tracing event per logical request.

**v0.8 does not introduce a new algorithm here**; it **refines types and
surface area**:

- Returns a structured `HttpResponse<T>` that wraps the decoded body together
  with `RequestOutcome`.
- Cleans up deprecated request fields.
- Standardises budgeting and metadata across core and satellites.

### 4.1 Types & Surfaces

_(keep the detailed type definitions from the full v0.8 spec: HttpMethod, HttpHeaders, UrlParts, CorrelationInfo, AgentContext, Extensions, ErrorCategory, FallbackHint, ClassifiedError, ErrorClassifierContext, ErrorClassifier, HttpError, TimeoutError, RawHttpResponse, TransportRequest, HttpTransport, HttpRequestOptions with `url`/`urlParts`/`query`/`body`/`operation`/`resilience`/`budget`/`cacheMode`/`cacheKey`/`idempotencyKey`/`correlation`/`agentContext`/`extensions`, RateLimitFeedback, RequestOutcome, HttpResponse<T>, interceptors, HttpCache, MetricsSink, TracingAdapter, HttpClientConfig, HttpClient methods, DefaultClientOptions, `createDefaultHttpClient`, and standard interceptors.)_

When migrating from v0.7, **reuse the existing retry/metrics implementation** and
adapt it to build and return `HttpResponse<T>` instead of raw `Response`.

---

## 5. Policies, Pagination, Conversation Core, OpenAI Client, Guardrails, Testing, Agent Runtime

_(Keep all the detailed v0.8 sections for these packages as previously written; no behavioural change is required to make them evolutionary relative to 0.7, since they mostly add functionality rather than change HttpClient semantics.)_

---

## 6. Migration from v0.7 → v0.8

This appendix is **normative guidance** for implementers who already have a
v0.7‑aligned client. It describes how to treat v0.8 as a **controlled refactor**
rather than a rewrite.

### 6.1 What to Keep (Execution Model)

If you already implemented v0.7, keep the core pipeline:

- The retry loop and how it applies `ResilienceProfile`.
- The way you:
  - start logical requests,
  - track attempts,
  - enforce per‑attempt and overall timeouts,
  - emit metrics/tracing once per logical request.
- The basic semantics of interceptors.

v0.8 expects the same behaviour; only the **types and public API shapes** evolve.

### 6.2 What to Remove (Deprecated v0.7 Fields/Concepts)

Remove these from your implementation and public surface:

- Legacy URL and pagination fields on `HttpRequestOptions`:
  - `path`, `pageSize`, `pageOffset`.
- Legacy budgeting type:
  - `RequestBudget`.
- Legacy hook surfaces:
  - `beforeRequest`, `afterResponse` config hooks that are not the v0.8
    `HttpRequestInterceptor` interface.
- `policyWrapper`:
  - All policy application should happen via the v0.8 `PolicyEngine` and
    `PolicyInterceptor` satellite, not a core wrapper.

These removals are deliberately **surgical**. They should not require you to
redesign the core pipeline.

### 6.3 What to Adapt (Types & Wrappers)

1. **HttpResponse<T>**
   - Introduce `HttpResponse<T>` as defined in this spec.
   - At the end of your existing v0.7 execution path (where you previously
     returned `Response` or decoded body), instead:
     - Decode the body as needed.
     - Compute `RequestOutcome` (you likely have equivalent metrics data).
     - Return a `HttpResponse<T>` wrapping status, headers, decoded body, and
       outcome.

2. **Public methods**
   - Update `requestJson<T>` to return `Promise<HttpResponse<T>>` instead of
     `Promise<T>`.
   - Implement `requestJsonBody<T>` as a thin convenience wrapper over
     `requestJson<T>` that returns `.body`.
   - For call sites that only care about the body, migrate from
     `requestJson<T>` to `requestJsonBody<T>`.

3. **Budgeting**
   - Replace the old `RequestBudget` type with the new `BudgetHints` type.
   - Map your existing budget fields into `BudgetHints`’ `maxTokens`,
     `maxCostCents`, `maxRequests`, and `attributes` fields where relevant.

4. **Error classification**
   - Implement the new `ErrorClassifier.classify(ctx)` method.
   - If you previously had `classifyNetworkError` and `classifyResponse`, simply
     wrap them inside `classify(ctx)` based on whether `ctx.error` or
     `ctx.response` is present.

5. **URL handling**
   - Where you previously used `path`/`pageSize`/`pageOffset`, switch to:
     - `url` or `urlParts` + `query` for URL construction.
     - The pagination satellite (`@airnub/resilient-http-pagination`) for
       page/offset handling.

### 6.4 What to Add (New v0.8 Functionality)

1. **Standard interceptors**
   - Implement `createAuthInterceptor`, `createJsonBodyInterceptor`, and
     `createIdempotencyInterceptor` exactly as specified, on top of your
     existing interceptor chain.

2. **Testing package**
   - Add the `@airnub/resilient-http-testing` package with:
     - `createRecordingTransport`, `createReplayTransport`, and
       `createTestHttpClient`.
   - These build on the existing `HttpTransport` abstraction; no pipeline change
     is needed.

3. **Agent runtime**
   - Add `@airnub/agent-runtime` and implement `createDefaultAgentRuntime`,
     wiring together:
     - `HttpClient` (via `createDefaultHttpClient`),
     - Policies (`PolicyEngine` + interceptor),
     - Guardrails (`GuardrailEngine` + interceptor),
     - `OpenAIHttpClient` + provider adapter,
     - `ConversationEngine` with an in‑memory store and `RecentNTurnsHistoryBuilder`.
   - This is an **additive** layer on top of core; HttpClient does not change.

### 6.5 Recommended Migration Order

To keep the refactor manageable:

1. **Introduce `HttpResponse<T>` and adapt core to return it.**
2. **Add `requestJsonBody<T>` and migrate body-only call sites.**
3. **Swap `RequestBudget` → `BudgetHints`.**
4. **Remove deprecated URL fields and `policyWrapper`.**
5. **Update `ErrorClassifier` to the unified `classify(ctx)` interface.**
6. **Implement standard interceptors.**
7. **Add testing and agent runtime packages.**

Following this order allows you to keep the working v0.7 pipeline intact while
incrementally evolving the surface to match v0.8.

---

## 7. Summary

- v0.8 keeps the v0.7 `HttpClient` execution model **unchanged** and focuses on:
  - Type refinement (`HttpResponse<T>`, `BudgetHints`).
  - Deprecation cleanup (`path`/`pageSize`/`pageOffset`, `RequestBudget`,
    legacy hooks, `policyWrapper`).
  - Adding satellites (policies, pagination, conversation, OpenAI client,
    guardrails), testing utilities, and an agent runtime.
- Existing v0.7‑aligned implementations should treat this as a **refactor**,
  not a rewrite: reuse the retry/metrics pipeline, adapt types, and layer on the
  new packages.

The rest of this document (not reproduced in full here) continues to define all
core types and satellite package APIs exactly as in the previous v0.8 full
spec, with the clarified evolutionary framing and migration appendix above.

