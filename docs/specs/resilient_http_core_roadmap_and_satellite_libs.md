# Resilient HTTP Core — Roadmap & Satellite Libraries Guidance

> Draft document to store under `docs/specs/` as roadmap guidance.
>
> Goal: Keep `@tradentic/resilient-http-core` **small, boring, and reusable**, while outlining a family of **satellite libraries** that handle richer concerns (pagination, policies, telemetry, LLM/agent semantics) via hooks and plugins.
>
> This document is aligned with **`@tradentic/resilient-http-core` v0.6**.

---

## 1. Core Library: `@tradentic/resilient-http-core`

**Status:** Implemented & evolving (v0.6+)

### 1.1 Responsibility

Cross-cutting HTTP concerns for all clients in the monorepo (and future external users):

- **Transport & abstraction**
  - `HttpTransport` (fetch by default, pluggable).
  - `HttpClient` / `HttpRequestOptions` as the main interface.

- **Resilience primitives**
  - Timeouts, retries, exponential backoff, idempotency hints.
  - Rate limiting and circuit breaking via *interfaces* (`HttpRateLimiter`, `CircuitBreaker`).
  - Caching via `HttpCache` interface.

- **Telemetry hooks**
  - Logging via `Logger`.
  - Metrics via `MetricsSink` (with `MetricsRequestInfo`).
  - Tracing via `TracingAdapter`.

- **v0.6 features** (AI-friendly but provider-agnostic):
  - `ResilienceProfile` attached to `HttpRequestOptions.resilience` (priority, latency budgets, max attempts, failFast, allowFailover hints).
  - `ErrorClassifier` interface and `ErrorCategory` + `ClassifiedError` to let higher layers implement provider-aware retry decisions.
  - `RateLimitFeedback` surfaced on metrics to carry rate-limit headers (requests/tokens + resets).
  - `RequestOutcome` (ok/status/attempts/duration/errorCategory) for each request.
  - `HttpRequestInterceptor` chain (`beforeSend`, `afterResponse`, `onError`) to allow external libraries to hook into requests without modifying the core.

- **Metadata & correlation**
  - `AgentContext` (v0.5 shape):
    - `agent?: string`
    - `runId?: string`
    - `labels?: Record<string, string>`
    - `metadata?: Record<string, unknown>`
  - `requestId`, `correlationId`, `parentCorrelationId` on `HttpRequestOptions` and `MetricsRequestInfo`.
  - `extensions` bag for arbitrary, opaque metadata (LLM/agent plugins, tenant IDs, etc.).

### 1.2 Non-goals

- **No direct dependency** on any specific resilience library:
  - No direct references to cockatiel, resilience4ts, resilience-typescript.

- **No telemetry framework baked in**:
  - No OpenTelemetry, Prometheus, or logging framework dependency.

- **No domain-specific logic**:
  - No FINRA, Unusual Whales, SEC, IEX, OpenAI, Anthropic, Gemini, etc.
  - No conversation / LLM semantics (`conversation_id`, `response_id`, etc.).

### 1.3 Design Constraint

Everything else in this roadmap should plug into the core via its **public types and hooks** (interfaces, interceptors, metrics) — *never* by forking or bloating the core.

The philosophy:

> **Core: stable contracts & boring HTTP.  \
> Satellites: all the interesting, fast-moving stuff.**

---

## 2. Pagination Helpers — `@airnub/resilient-http-pagination`

**Status:** Spec v0.2 (designed for core v0.6)

### 2.1 Scope

A small, `HttpClient`-based pagination helper library that:

- Builds on top of `@tradentic/resilient-http-core`.
- Supports common pagination patterns used across:
  - FINRA APIs
  - Unusual Whales APIs
  - SEC Data API endpoints
  - IEX, GitHub, etc.
  - Any paged REST/JSON API (including LLM dashboards / admin APIs).
- Treats a pagination **run** as a first-class operation with limits and outcomes.

### 2.2 Core API (v0.2)

- **Models & types**
  - `PaginationModel` (`'offset-limit' | 'cursor' | 'link-header' | 'custom'`).
  - `Page<TItem>` — single page (items + status + request + optional response/state).
  - `PaginationResult<TItem>` — run-level result (pages/items/completed/RequestOutcome).
  - `PageExtractor<TItem>` — parse a `Response` into `PageExtraction<TItem>`.
  - `PaginationStrategy` — build initial/next `HttpRequestOptions` given state.
  - `PaginationLimits` — `maxPages`, `maxItems`, `maxEndToEndLatencyMs`.
  - `PaginationResilience` — per-page `ResilienceProfile` hints.
  - `PaginationObserver` — `onPage` / `onComplete` callbacks.

- **APIs**
  - `paginate<TItem>(options: PaginateOptions<TItem>): Promise<PaginationResult<TItem>>`.
  - `paginateStream<TItem>(options: PaginateOptions<TItem>): AsyncGenerator<Page<TItem>, PaginationResult<TItem>, void>`.

- **Built-in strategies**
  - `OffsetLimitStrategy` — offset/limit style.
  - `CursorStrategy` — token/cursor-based pagination.
  - `LinkHeaderStrategy` — `Link: <...>; rel="next"` style.

### 2.3 Why separate from core

- Keeps core focused on **single-request** resilience and telemetry.
- Allows rapid iteration on pagination semantics without touching the core.
- Optional dependency: clients that don’t page results don’t need to depend on this package.

### 2.4 Interaction with core v0.6

- Uses `HttpClient` and `HttpRequestOptions` directly.
- Propagates `AgentContext`, `correlationId`, `parentCorrelationId`, and `extensions` to every page request.
- Uses `ResilienceProfile` for per-page resilience.
- Wraps multi-page runs in a **run-level `RequestOutcome`** (aggregated attempts, duration, success flag).

---

## 3. Policy & Budget Engine — `@airnub/resilient-http-policies`

**Status:** Spec v0.2 (designed for core v0.6)

### 3.1 Scope

A policy and budget engine that sits **around** `@tradentic/resilient-http-core` and:

- Applies **per-scope** constraints (client, operation, agent, provider, model, tenant/bucket).
- Enforces:
  - Request-based rate limits.
  - Optional token-based budgets (when provided by the caller).
  - Concurrency limits.
  - Different behaviours for `interactive` vs `background` vs `batch` traffic.
- Influences (but does not own) `ResilienceProfile` for each request.

### 3.2 Core concepts & types

- `PolicyScope` — derived from `HttpRequestOptions` + `AgentContext` + AI metadata:
  - `client`, `operation`, `agent`, `agentRunId`, `provider`, `model`, `bucket`.
- `RequestClass` — `'interactive' | 'background' | 'batch'`.
- `PolicyRateLimit` — `maxRequestsPerInterval`, `intervalMs`, optional `maxTokensPerInterval`.
- `PolicyConcurrencyLimit` — `maxConcurrent`.
- `PolicyResilienceHints` — overrides / guidance for `ResilienceProfile`.
- `PolicyDefinition` — per-scope policy with `rateLimit`, `concurrency`, `resilience`, `priority`.
- `PolicyRequestContext` — what the engine sees before a request.
- `PolicyDecision` — `'allow' | 'delay' | 'deny'` + `delayMs` + `resilienceOverrides`.
- `PolicyResultContext` — what the engine sees after a request (`RequestOutcome`, `RateLimitFeedback`).
- `PolicyEngine` — `evaluate()` + `onResult()`.

### 3.3 Integration with core v0.6

The package exposes a **policy-aware interceptor** helper:

```ts
export function createPolicyInterceptor(config: PolicyInterceptorConfig): HttpRequestInterceptor;
```

This interceptor:

- In `beforeSend`:
  - Derives `PolicyScope` from `HttpRequestOptions`, `AgentContext`, and AI-related `extensions` (e.g. `ai.provider`, `ai.model`).
  - Calls `engine.evaluate()` to get a `PolicyDecision`.
  - Enforces `allow/delay/deny` and merges `resilienceOverrides` into `opts.resilience`.

- In `afterResponse` / `onError`:
  - Builds a `PolicyResultContext` with outcome + rate-limit info.
  - Calls `engine.onResult()` so the engine can update sliding windows/concurrency/error-rate stats.

### 3.4 In-memory engine (first implementation)

- `InMemoryPolicyEngine` for single-process use:
  - Stores `PolicyDefinition`s.
  - Maintains per-policy-key sliding-window counters and concurrency counts.
- Future versions can add Redis/distributed engines while preserving the interface.

### 3.5 Why separate from core

- Policies change quickly; different apps want different configurations.
- Doesn’t belong in the core because:
  - It’s opinionated about rate limits, concurrency semantics, and load shedding.
  - It may pull in additional dependencies (storage, admin APIs) long-term.

---

## 4. Telemetry Adapters — OTEL, Logging, Metrics

**Package ideas (future):**

- `@airnub/resilient-http-otel`
- `@airnub/resilient-http-logging-pino`
- `@airnub/resilient-http-logging-winston`

### 4.1 Scope

Provide concrete implementations for the core telemetry interfaces:

- `TracingAdapter` → OpenTelemetry spans.
- `Logger` → structured logging (console, pino, winston, etc.).
- `MetricsSink` → OTEL or Prometheus-friendly metrics.

### 4.2 Responsibilities

- Map core metadata into telemetry:
  - `AgentContext` (`agent`, `runId`, `labels`, `metadata`).
  - `correlationId`, `parentCorrelationId`.
  - `extensions` (e.g. `ai.provider`, `ai.model`, `request.class`, `tenant`, etc.).
  - v0.6-specific fields: `ResilienceProfile`, `RequestOutcome`, `RateLimitFeedback`.

- Provide wiring helpers:

  ```ts
  export function createOtelTracingAdapter(/* config */): TracingAdapter;
  export function createOtelMetricsSink(/* config */): MetricsSink;
  export function createPinoLogger(/* config */): Logger;
  ```

### 4.3 Non-goals

- No telemetry-specific code inside `@tradentic/resilient-http-core`.
- The core **must not** take a hard dependency on OTEL or logging frameworks.

---

## 5. Agentic / LLM Conversation Core — `@airnub/agent-conversation-core`

**Status:** Future satellite library

### 5.1 Scope

Introduce higher-level, domain-specific concepts for LLM/agent workflows:

- `Conversation` — app-level logical conversation.
- `Turn` — one step/interaction in that conversation.
- `ProviderSession` — per-provider, per-conversation context.

Responsibilities:

- Manage multi-provider quirks:
  - OpenAI: conversation/response IDs, streaming vs non-streaming.
  - Anthropic: stateless API, full-history messages.
  - Gemini: sessions & contents.
- Maintain conversation state:
  - Store history and metadata (in memory, Redis, DB, etc.).
  - Truncate and compress history for token budgets.
- Drive provider selection & routing:
  - Which provider/model to use for a given turn.
  - When to fail over to a secondary provider (in combination with policies/core resilience).

### 5.2 Interaction with `resilient-http-core`

- Uses `@tradentic/resilient-http-core` for all HTTP requests.
- Sets `AgentContext` and `correlationId` at **conversation/turn** level, e.g.:

  ```ts
  agentContext: {
    agent: 'rotation-score-agent',
    runId: 'conv-1234:turn-7',
    labels: { tier: 'experiment' },
    metadata: { scenario: 'irbt-rotation' },
  }
  ```

- Uses `extensions` for LLM metadata, without the core understanding it:

  ```ts
  extensions: {
    'ai.provider': 'openai',
    'ai.model': 'gpt-5.1-mini',
    'ai.request_type': 'chat',
    'ai.streaming': true,
  }
  ```

- Optionally uses `@airnub/resilient-http-policies` to set different budgets for interactive vs background agent work.

### 5.3 Non-goals

- No direct HTTP client logic — always goes through `resilient-http-core`.
- No requirement for a particular agent framework; it should be compatible with multiple.

---

## 6. Provider-Specific LLM HTTP Wrappers

**Package ideas (future):**

- `@airnub/http-llm-openai`
- `@airnub/http-llm-anthropic`
- `@airnub/http-llm-gemini`

### 6.1 Scope

Thin, strongly-typed HTTP wrappers for specific LLM APIs using `resilient-http-core`:

- Typed request/response models.
- Helpers for core operations:
  - Chat/messages.
  - Responses / tools.
  - Embeddings / vectors.
  - Files/batches where relevant.
- Streaming support using core transport + interceptors.

### 6.2 Responsibilities

- Know provider-specific details:
  - Auth headers, base URLs.
  - Endpoint paths and query/body shapes.
  - Rate-limit headers and error shapes.

- Expose factory helpers, e.g.:

  ```ts
  export function createOpenAiHttpClient(config: OpenAiHttpConfig): OpenAiHttpClient;
  ```

### 6.3 Interaction with core & satellites

- Use `HttpClient` and `HttpRequestOptions` internally.
- Configure operation-level defaults (`operation`, timeouts, idempotency hints).
- Let `@airnub/resilient-http-policies` enforce budgets.
- Let `@airnub/agent-conversation-core` orchestrate high-level conversations.

---

## 7. Browser & Tool Guardrails (AI Browsers)

**Package idea (future):** `@airnub/agent-browser-guardrails`

### 7.1 Scope

Leverage `HttpRequestInterceptor` to enforce safety and guardrails for AI-driven browsing and tools:

- Host allowlists and denylists.
- Method restrictions (e.g. read-only vs write-endpoints).
- Payload size limits.
- Content-type allowlists.

### 7.2 Interaction with core

- Implemented purely as one or more `HttpRequestInterceptor`s.
- Uses `AgentContext` and `extensions` (e.g. tool IDs) to vary guardrails by agent/tool.
- May integrate with `@airnub/resilient-http-policies` to tighten policies for risky targets.

---

## 8. High-Level Roadmap / Phasing

### Phase 1 — Core v0.6 Stabilisation (in progress)

- Finalise and implement v0.6 in `@tradentic/resilient-http-core`:
  - `ResilienceProfile` on requests.
  - `ErrorClassifier` integration.
  - `RateLimitFeedback` and `RequestOutcome` on metrics.
  - `HttpRequestInterceptor` chain.
  - Confirm `AgentContext`, `correlationId`, `parentCorrelationId`, and `extensions` are properly wired everywhere.
- Refactor existing clients (FINRA, Unusual Whales, OpenAI, SEC, IEX) to use core v0.6 consistently.

### Phase 2 — Pagination Extraction (`@airnub/resilient-http-pagination` v0.2)

- Implement v0.2 spec for pagination as a separate package.
- Gradually migrate clients that need pagination to use it.
- Keep pagination logic out of core.

### Phase 3 — Policies & Budgets (`@airnub/resilient-http-policies` v0.2)

- Implement in-memory `PolicyEngine` + `createPolicyInterceptor`.
- Integrate into selected apps (e.g. Temporal worker) to enforce:
  - Per-client/per-provider budgets.
  - Different classes of traffic (interactive vs background vs batch).
- Add basic policy configuration for IRD workloads.

### Phase 4 — Telemetry Adapters

- Implement `@airnub/resilient-http-otel` for tracing + metrics.
- Implement at least one logging adapter (`pino` or `winston`).
- Wire into IRD services, but keep them optional.

### Phase 5 — Agent & Provider Layers

- Design and implement `@airnub/agent-conversation-core`.
- Implement first provider wrappers:
  - `@airnub/http-llm-openai`.
  - Possibly `@airnub/http-llm-anthropic`.
- Use `resilient-http-core` under the hood for all AI/LLM HTTP traffic.

### Phase 6 — Externalisation & Open Source

- Once stable, consider:
  - Splitting core & satellites into their own repos (e.g. an `airnub-http` or `resilient-http` org).
  - Maintaining versioned specs in each repo’s `docs/specs/`.
  - Cross-repo test harnesses for end-to-end flows.

---

## 9. Design Guardrails

To keep the ecosystem maintainable and clean:

1. **Core stays small and agnostic**
   - No domain-specific logic (no FINRA, UW, SEC, LLM providers, etc.).
   - No heavy dependencies baked in (no OTEL, no external resilience libs).

2. **Everything else is opt-in**
   - Pagination, policies, telemetry, agents, provider wrappers, and browser guardrails are all separate layers.
   - Apps explicitly choose which layers they need.

3. **Contracts are stable and additive**
   - `HttpClient`, `HttpRequestOptions`, `AgentContext`, `ResilienceProfile`, `ErrorClassifier`, `RateLimitFeedback`, `RequestOutcome`, `HttpRequestInterceptor`, and core telemetry interfaces form the stable surface area.
   - Satellite libraries build *on* these; changes should be additive and backwards compatible.

4. **Observability is first-class**
   - Always propagate `requestId`, `correlationId`, `parentCorrelationId`, and `AgentContext`.
   - Always carry `extensions` through to telemetry so higher layers can apply their own semantics (LLM, agent, tenant, experiment tags).

5. **AI agents are first-class *users* of the stack, not baked into it**
   - Core provides the resilience and telemetry substrate.
   - Satellite libraries and apps encode AI/agent semantics.

This roadmap should guide future evolution, ensuring `@tradentic/resilient-http-core` remains a solid, boring foundation while enabling a rich ecosystem around resilience, telemetry, and agentic AI on top.

