# Resilient HTTP Core — Roadmap & Satellite Libraries Guidance (v0.7-aligned)

> Draft document to store under `docs/specs/` as roadmap guidance.
>
> Goal: Keep `@airnub/resilient-http-core` **small, boring, and reusable**, while outlining a family of **satellite libraries** that handle richer concerns (pagination, policies, telemetry, LLM/agent semantics, browser guardrails) via hooks and plugins.
>
> This document is aligned with **`@airnub/resilient-http-core` v0.7.0** and the following satellite spec baselines:
>
> - `@airnub/resilient-http-pagination` v0.3.0
> - `@airnub/resilient-http-policies` v0.3.0
> - `@airnub/agent-conversation-core` v0.2.0
> - `@airnub/agent-browser-guardrails` v0.2.0
> - `@airnub/http-llm-openai` v0.2.0

---

## 1. Core Library: `@airnub/resilient-http-core`

**Status:** Implemented & evolving (v0.7+)

### 1.1 Responsibility

Cross-cutting HTTP concerns for all clients in the monorepo (and future external users):

- **Transport & abstraction**
  - `HttpTransport` (fetch by default, pluggable).
  - `HttpClient` / `HttpRequestOptions` as the main interface.
  - No hard dependency on Node vs browser: transport is injected or created via a small default factory.

- **Resilience primitives**
  - Timeouts, retries, exponential backoff, idempotency hints.
  - Rate limiting and circuit breaking via *interfaces* only (e.g. `HttpRateLimiter`, `CircuitBreaker`).
  - Caching via `HttpCache` interface.

- **Telemetry hooks**
  - Logging via `Logger`.
  - Metrics via `MetricsSink` (with `MetricsRequestInfo`).
  - Tracing via `TracingAdapter`.

- **v0.7 features** (AI-friendly but provider-agnostic):
  - `ResilienceProfile` attached to `HttpRequestOptions.resilience`:
    - Priority, latency budgets, max attempts, backoff hints, fail-fast, and failover hints.
  - `ErrorClassifier` interface and stable `ErrorCategory` + `ClassifiedError` so higher layers can implement provider-aware retry decisions without modifying core.
  - `RateLimitFeedback` surfaced on metrics to carry rate-limit headers (requests/tokens + resets).
  - `RequestOutcome` (ok/status/attempts/duration/errorCategory) for each request.
  - **Stable `HttpRequestInterceptor` chain** (`beforeSend`, `afterResponse`, `onError`) so external libraries can hook into requests without modifying core.
  - Request-scoped context propagation:
    - `AgentContext` (v0.7 shape):
      - `agent?: string`
      - `runId?: string`
      - `labels?: Record<string, string>`
      - `metadata?: Record<string, unknown>`
    - `requestId`, `correlationId`, `parentCorrelationId` on `HttpRequestOptions` and `MetricsRequestInfo`.
    - `extensions` bag for arbitrary, opaque metadata (LLM/agent plugins, tenant IDs, experiment tags, etc.).

- **Out-of-the-box experience**
  - A `createDefaultHttpClient` helper that:
    - Uses fetch (or a compatible transport) with sane defaults.
    - Configures basic retry + timeout behaviour.
    - Does **not** require Redis/DB/OTEL to get value.
  - Everything else is opt-in via interceptors and satellite libraries.

### 1.2 Non-goals

- **No direct dependency** on any specific resilience library:
  - No direct references to cockatiel, resilience4ts, resilience-typescript, etc.

- **No telemetry framework baked in**:
  - No OpenTelemetry, Prometheus, Datadog, or logging framework dependency.

- **No domain-specific logic**:
  - No FINRA, Unusual Whales, SEC, IEX, OpenAI, Anthropic, Gemini, etc.
  - No conversation / LLM semantics (`conversation_id`, `response_id`, tool-calls, etc.).

- **No gRPC transport**:
  - This core is HTTP(S)-only. gRPC (if ever used) would live in separate wrappers that internally adapt to `HttpTransport`-like interfaces or different client packages.

### 1.3 Design Constraint

Everything else in this roadmap should plug into the core via its **public types and hooks** (interfaces, interceptors, metrics) — *never* by forking or bloating the core.

The philosophy:

> **Core: stable contracts & boring HTTP.  \
> Satellites: all the interesting, fast-moving stuff.**

---

## 2. Pagination Helpers — `@airnub/resilient-http-pagination`

**Status:** Spec v0.3.0 (designed for core v0.7.0)

### 2.1 Scope

A small, `HttpClient`-based pagination helper library that:

- Builds on top of `@airnub/resilient-http-core`.
- Supports common pagination patterns used across:
  - FINRA APIs
  - SEC Data API endpoints
  - IEX, GitHub, etc.
  - Any paged REST/JSON API (including internal admin/LLM dashboards).
- Treats a pagination **run** as a first-class operation with limits and outcomes, not just a `while(nextPage)` loop.

### 2.2 Core API (v0.3)

**Models & types:**

- `PaginationModel` (e.g. `'offset-limit' | 'cursor' | 'link-header' | 'custom'`).
- `Page<TItem>` — single page (items + status + `RequestOutcome` and optional raw response/state).
- `PaginationResult<TItem>` — run-level result (pages, flattened items, completed flag, aggregated outcome).
- `PaginationLimits` — `maxPages`, `maxItems`, `maxEndToEndLatencyMs`.
- `PageExtractor<TItem>` — parse an HTTP response into a typed `Page`.
- `PaginationStrategy` — build initial/next `HttpRequestOptions` given state.
- `PaginationObserver` — hooks (`onPage`, `onComplete`) for logging/metrics.

**APIs:**

- `paginate<TItem>(options: PaginateOptions<TItem>): Promise<PaginationResult<TItem>>`.
- `paginateStream<TItem>(options: PaginateOptions<TItem>): AsyncGenerator<Page<TItem>, PaginationResult<TItem>, void>`.

**Built-in helpers:**

- Strategy builders:
  - `createOffsetLimitStrategy(...)`.
  - `createCursorStrategy(...)`.
  - `createArrayFieldExtractor(...)` for common JSON shapes.
- Opinionated helpers:
  - `paginateOffsetLimit(...)` — one-liner for classic `?offset=&limit=` APIs.
  - `paginateCursor(...)` — token/cursor-based APIs.
  - `paginateUntil(...)` — predicate-based termination (AI/scan friendly).

### 2.3 Why separate from core

- Keeps core focused on **single-request** resilience and telemetry.
- Allows rapid iteration on pagination semantics without touching the core.
- Optional dependency: clients that don’t page results don’t need to depend on this package.

### 2.4 Interaction with core v0.7

- Uses `HttpClient` and `HttpRequestOptions` directly.
- Propagates `AgentContext`, `correlationId`, `parentCorrelationId`, and `extensions` to every page request.
- Uses `ResilienceProfile` for per-page resilience (e.g. lower budgets for deep pagination).
- Wraps multi-page runs in a **run-level `RequestOutcome`** (aggregated attempts, duration, success flag).

---

## 3. Policy & Budget Engine — `@airnub/resilient-http-policies`

**Status:** Spec v0.3.0 (designed for core v0.7.0)

### 3.1 Scope

A policy and budget engine that sits **around** `@airnub/resilient-http-core` and:

- Applies **per-scope** constraints (client, operation, method, agent, provider, model, tenant/bucket).
- Enforces:
  - Request-based rate limits.
  - Concurrency limits.
  - Optional queueing when concurrency is hit.
  - Different behaviours for `interactive` vs `background` vs `batch` traffic.
- Influences (but does not own) `ResilienceProfile` for each request.

### 3.2 Core concepts & types (v0.3)

- `RequestClass` — `'interactive' | 'background' | 'batch'`.
- `PolicyScope` — derived from `HttpRequestOptions` + `AgentContext` + extensions (e.g. `ai.provider`, `ai.model`, `tenant.id`, etc.).
- `ScopeSelector` — config view for matching scopes (clientName, operation, method, requestClass, aiProvider/model/tool/tenant, etc.).
- `PolicyDefinition` — per-scope policy with:
  - `rateLimit?: RateLimitRule` (maxRequests/window, bucketKeyTemplate).
  - `concurrency?: ConcurrencyRule` (maxConcurrent, bucketKeyTemplate).
  - `resilienceOverride?: ResilienceOverride` (overrides for `ResilienceProfile`).
  - Optional `queue` and `failureMode` (`failOpen` / `failClosed`).
  - `priority` and `key`.
- `PolicyDecision` — `'allow' | 'delay' | 'deny'` + `delayBeforeSendMs` + `resilienceOverride`.
- `PolicyOutcome` — summaries (delayMs, denied, bucket keys, policyKey).
- `PolicyEngine` — `evaluate()` + `onResult()`.

### 3.3 Integration with core v0.7

The package exposes a **policy-aware interceptor** helper:

```ts
export function createPolicyInterceptor(config: PolicyInterceptorOptions): HttpRequestInterceptor;
```

This interceptor:

- In `beforeSend`:
  - Builds `PolicyScope` from `HttpRequestOptions`, `AgentContext`, and AI-related `extensions`.
  - Calls `engine.evaluate()` to get a `PolicyDecision`.
  - Enforces `allow/delay/deny` and merges `resilienceOverride` into `request.resilience`.

- In `afterResponse` / `onError`:
  - Builds a `PolicyOutcome` combined with the `RequestOutcome` from core.
  - Calls `engine.onResult()` so the engine can update windows, concurrency, and stats.

### 3.4 In-memory engine (first implementation)

- `createInMemoryPolicyEngine` for single-process use:
  - Stores `PolicyDefinition[]`.
  - Maintains per-bucket sliding-window counters and concurrency counts.
- Helper factories:
  - `createBasicRateLimitPolicy(...)`.
  - `createBasicConcurrencyPolicy(...)`.
  - `createBasicInMemoryPolicyEngine(...)`.

### 3.5 Why separate from core

- Policies change quickly; different apps want different configurations.
- Doesn’t belong in the core because:
  - It’s opinionated about rate limits, concurrency semantics, and load shedding.
  - It may later pull in external storage (Redis, etc.) for distributed quotas.

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
  - v0.7-specific fields: `ResilienceProfile`, `RequestOutcome`, `RateLimitFeedback`.

- Provide wiring helpers, e.g.:

  ```ts
  export function createOtelTracingAdapter(/* config */): TracingAdapter;
  export function createOtelMetricsSink(/* config */): MetricsSink;
  export function createPinoLogger(/* config */): Logger;
  ```

### 4.3 Non-goals

- No telemetry-specific code inside `@airnub/resilient-http-core`.
- The core **must not** take a hard dependency on OTEL or logging frameworks.

---

## 5. Agentic / LLM Conversation Core — `@airnub/agent-conversation-core`

**Status:** Spec v0.2.0 (initial implementation planned)

### 5.1 Scope

Introduce higher-level, domain-specific concepts for LLM/agent workflows:

- `Conversation` — app-level logical conversation.
- `ConversationMessage` — individual message with typed content parts.
- `ConversationTurn` — one step/interaction in that conversation.
- Provider-agnostic abstractions:
  - `ProviderAdapter` (e.g. OpenAI, Anthropic, Gemini, local models).
  - `ProviderMessage`, `ProviderToolDefinition`, `ProviderToolCall`.

Responsibilities:

- Maintain conversation state:
  - Store history and metadata (via `ConversationStore` abstraction: memory, Redis, DB, etc.).
  - Build context windows within token/length/message budgets via `HistoryBuilder`.
- Drive provider selection & orchestration:
  - Which provider/model to use for a given turn.
  - Streaming vs non-streaming.
- Provide a `ConversationEngine` that:
  - Accepts new user messages.
  - Builds history.
  - Calls a `ProviderAdapter`.
  - Persists messages and turns.

### 5.2 Interaction with `resilient-http-core`

- Does **not** call HTTP directly; provider-specific packages (e.g. `http-llm-openai`) do.
- Uses `AgentContext` and `extensions` to annotate provider calls so they can be:
  - Rate-limited and budgeted by `@airnub/resilient-http-policies`.
  - Observed by telemetry adapters.

Example extensions from a turn:

```ts
extensions: {
  'ai.provider': 'openai',
  'ai.model': 'gpt-5.1-mini',
  'ai.operation': 'chat',
  'ai.tenant': 'acme-inc',
}
```

### 5.3 Non-goals

- No direct HTTP client logic — always goes through provider-specific wrappers built on `resilient-http-core`.
- No requirement for a particular agent framework; it should be compatible with multiple.

---

## 6. Provider-Specific LLM HTTP Wrappers

**Examples:**

- `@airnub/http-llm-openai` (spec v0.2.0)
- Future: `@airnub/http-llm-anthropic`, `@airnub/http-llm-gemini`, etc.

### 6.1 Scope

Thin, strongly-typed HTTP wrappers for specific LLM APIs using `resilient-http-core`:

- Typed request/response models.
- Helpers for core operations (for OpenAI Responses API in v0.2):
  - `responses.create` (non-streaming + optional streaming).
  - Chaining via `previous_response_id`.
- Optional implementation of `ProviderAdapter` for `agent-conversation-core`.

### 6.2 Responsibilities

- Know provider-specific details:
  - Auth headers, base URLs.
  - Endpoint paths and query/body shapes.
  - Rate-limit headers and error shapes.

- Expose factory helpers, e.g.:

  ```ts
  export function createOpenAIHttpClient(config: OpenAIHttpClientConfig): OpenAIHttpClient;
  ```

- Always attach core-aligned metadata:
  - `extensions['ai.provider'] = 'openai'`.
  - `extensions['ai.model'] = model`.
  - `extensions['ai.operation'] = 'responses.create'`.

### 6.3 Interaction with core & satellites

- Use `HttpClient` and `HttpRequestOptions` internally.
- Configure operation-level defaults (`operation`, timeouts, idempotency hints).
- Let `@airnub/resilient-http-policies` enforce budgets.
- Let `@airnub/agent-conversation-core` orchestrate high-level conversations.

---

## 7. Browser & Tool Guardrails (AI Browsers) — `@airnub/agent-browser-guardrails`

**Status:** Spec v0.2.0

### 7.1 Scope

Leverage `HttpRequestInterceptor` and a simple browser-guard interface to enforce safety and guardrails for AI-driven browsing and tools:

- Host allowlists and denylists.
- Protocol restrictions.
- Method restrictions (e.g. read-only vs write endpoints).
- Payload size limits and content-type allowlists.
- Header redaction (e.g. strip `authorization` and `cookie` for untrusted hosts).

### 7.2 Interaction with core

- Implemented as one or more `HttpRequestInterceptor`s:
  - `createHttpGuardrailInterceptor` for HTTP.
  - `BrowserNavigationGuard` for headless browsers.
- Uses `AgentContext` and `extensions` (e.g. tool IDs) to vary guardrails by agent/tool/tenant.
- Clear separation from policies:
  - Guardrails answer: *"Is this surface allowed at all?"*
  - Policies answer: *"Is this allowed right now, given quotas and budgets?"*

---

## 8. High-Level Roadmap / Phasing

### Phase 1 — Core v0.7 Stabilisation (in progress)

- Finalise and implement v0.7 in `@airnub/resilient-http-core`:
  - `ResilienceProfile` enhancements.
  - Stable `ErrorClassifier` integration.
  - `RateLimitFeedback` and `RequestOutcome` on metrics.
  - `HttpRequestInterceptor` chain.
  - Confirm `AgentContext`, `correlationId`, `parentCorrelationId`, and `extensions` are properly wired everywhere.
- Refactor existing clients (FINRA, SEC, IEX, OpenAI wrappers, etc.) to use core v0.7 consistently.

### Phase 2 — Pagination (`@airnub/resilient-http-pagination` v0.3)

- Implement v0.3 spec as a separate package.
- Gradually migrate clients that need pagination to use it.
- Keep pagination logic out of core.

### Phase 3 — Policies & Budgets (`@airnub/resilient-http-policies` v0.3)

- Implement `PolicyEngine` + `createPolicyInterceptor`.
- Provide `InMemoryPolicyEngine` and basic factories.
- Integrate into selected apps to enforce:
  - Per-client/per-provider budgets.
  - Different classes of traffic (interactive vs background vs batch).

### Phase 4 — Telemetry Adapters

- Implement `@airnub/resilient-http-otel` for tracing + metrics.
- Implement at least one logging adapter (`pino` or `winston`).
- Wire into key services, but keep them optional.

### Phase 5 — Agent & Provider Layers

- Implement `@airnub/agent-conversation-core` v0.2.
- Implement `@airnub/http-llm-openai` v0.2 on top of core.
- Use the combination of:
  - `resilient-http-core`
  - `resilient-http-policies`
  - `agent-browser-guardrails`
  - `agent-conversation-core`
  - `http-llm-openai`

  as the **reference stack** for AI/agentic workloads.

### Phase 6 — Externalisation & Open Source

- Once stable, consider:
  - Splitting core & satellites into their own org/repo (`airnub-http`, `resilient-http`, etc.).
  - Maintaining versioned specs in each repo’s `docs/specs/`.
  - Cross-repo test harnesses for end-to-end flows.

---

## 9. Opinionated Template Setups

To make the ecosystem approachable for both small apps and larger systems, we will document a few **template stacks**.

### 9.1 Minimal Core Stack

For small services or scripts that just need resilient HTTP:

- `@airnub/resilient-http-core` only.
- Use `createDefaultHttpClient()`.
- Optional: a simple logging interceptor.

### 9.2 Data Ingest / ETL Stack

For jobs that call many third-party APIs (e.g., SEC, FINRA):

- `@airnub/resilient-http-core`
- `@airnub/resilient-http-pagination`
- `@airnub/resilient-http-policies` (basic rate limits + concurrency per client)
- Optional telemetry adapters.

### 9.3 AI / Agentic Stack

For LLM-based agents and tools:

- `@airnub/resilient-http-core`
- `@airnub/resilient-http-policies` (per-tenant/model budgets)
- `@airnub/agent-browser-guardrails` (surface safety)
- `@airnub/agent-conversation-core` (conversation/turn model)
- `@airnub/http-llm-openai` (and future providers)
- Telemetry adapters (OTEL + logging) recommended.

Each template will have:

- A small diagram.
- Example `HttpClient` wiring.
- Example policy configuration.
- Example agent/provider wiring.

---

## 10. Design Guardrails

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

This roadmap should guide future evolution, ensuring `@airnub/resilient-http-core` remains a solid, boring foundation while enabling a rich ecosystem around resilience, telemetry, and agentic AI on top.