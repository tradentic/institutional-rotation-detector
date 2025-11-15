# Resilient HTTP Core — Roadmap & Satellite Libraries Guidance

> Draft document to store under `docs/specs/` as roadmap guidance.
>
> Goal: Keep `@tradentic/resilient-http-core` small, boring, and reusable, while outlining a family of **satellite libraries** that handle richer concerns (pagination, policies, telemetry, LLM/agent semantics) via hooks and plugins.

---

## 1. Core Library: `@tradentic/resilient-http-core`

**Status:** Implemented (v0.4+)

**Responsibility:**

- Cross-cutting HTTP concerns for all clients in the monorepo:
  - Transport abstraction (`HttpTransport` – fetch by default, pluggable).
  - Timeouts, retries, backoff, idempotency.
  - Rate limiting and circuit breaking via interfaces.
  - Caching via `HttpCache` interface.
  - Logging, metrics, tracing via `Logger`, `MetricsSink`, `TracingAdapter`.
  - Policy composition via `policyWrapper` (for external resilience libs).
  - Pagination-independent: one request at a time.

- Metadata & hooks (v0.3–v0.4):
  - `resolveBaseUrl`, `beforeRequest`, `afterResponse` hooks.
  - `operationDefaults` for per-operation policies.
  - `requestJson`, `requestRaw`, `requestText`, `requestArrayBuffer`.
  - `AgentContext` for correlation IDs, parent correlation IDs, source label, generic attributes.
  - `extensions` bag for arbitrary, opaque metadata (LLM/agent plugins, etc.).

**Non-goals:**

- No direct dependency on any specific resilience library (cockatiel, resilience4ts, resilience-typescript).
- No OpenTelemetry or logging framework dependency baked in.
- No domain-specific logic (FINRA, UW, SEC, IEX, OpenAI, Anthropic, Gemini, etc.).
- No conversation / LLM semantics.

**Design constraint:** Everything else in this roadmap should plug into the core via its public types and hooks, not by forking or bloating the core itself.

---

## 2. Pagination Helpers

### 2.1 Package Idea: `@tradentic/resilient-http-pagination`

**Scope:**

- Provide a small, **HTTP-client-agnostic** set of pagination helpers that build on top of `HttpClient` (or its equivalent) and `HttpRequestOptions`.
- Encapsulate common pagination patterns used across:
  - FINRA APIs
  - Unusual Whales APIs
  - SEC Data API endpoints
  - OpenAI list endpoints
  - Any paged REST or JSON API

**Core API:** (already drafted in v0.3 spec, but intended to be separable)

- Types:
  - `PaginationState<TPage>`
  - `PaginationConfig<TPage, TItem>`
  - `PaginationResult<TItem>`
- Functions:
  - `paginateAll(client, config)` → fetch all items/pages with configurable limits.
  - `paginateIterator(client, initial, getNextRequest)` → async iterator over pages.

**Why separate:**

- Keeps `@tradentic/resilient-http-core` focused on single-request resilience.
- Allows rapid iteration on pagination strategies (page/token/offset/continuation) without touching the core.
- Optional dependency: clients that don’t need pagination don’t need the package.

**Interaction with core:**

- Depends on:
  - `HttpClient`
  - `HttpRequestOptions`
- Uses core resilience features (retries, rate limiting, etc.) transparently via `HttpClient`.

---

## 3. Policy / Resilience Adapters

### 3.1 Package Ideas:

- `@tradentic/resilient-http-policies` (generic policy wiring helper)
- Optional adapters:
  - `@tradentic/resilient-http-cockatiel`
  - `@tradentic/resilient-http-resilience4ts`
  - `@tradentic/resilient-http-resilience-typescript`

**Scope:**

- Implement pluggable resilience stacks using the `policyWrapper` hook provided by core.
- Provide ready-made adapters to integrate:
  - cockatiel policies (retry, circuit breaker, bulkhead, timeout).
  - resilience4ts or resilience-typescript patterns.

**Responsibilities:**

- Translate `HttpClient` context into whichever interface the resilience library expects.
- Implement policy composition functions like:

  ```ts
  export function createCockatielPolicyWrapper(/* config */): BaseHttpClientConfig['policyWrapper'];
  ```

- Ensure policies are **opt-in** and do not change the default behaviour of `resilient-http-core`.

**Non-goals:**

- Do not bring cockatiel/resilience4ts into the core package.
- Do not encode domain-specific retry rules (leave that to client configs or higher-level libraries).

**Interaction with core:**

- Depends on:
  - `BaseHttpClientConfig['policyWrapper']`
  - `HttpClient` configuration shapes.
- Purely wraps the `fn: () => Promise<T>` callable passed by the core.

---

## 4. Telemetry Adapters (OTEL, Logging, Metrics)

### 4.1 Package Ideas:

- `@tradentic/resilient-http-otel`
- Optional logging helpers:
  - `@tradentic/resilient-http-logging-pino`
  - `@tradentic/resilient-http-logging-winston`

**Scope:**

- Provide concrete implementations for the core interfaces:
  - `TracingAdapter` → OpenTelemetry spans.
  - `Logger` → structured logging (console, pino, winston, etc.).
  - `MetricsSink` → OTEL metrics or Prometheus-friendly metrics.

**Responsibilities:**

- Map `AgentContext` fields (`correlationId`, `parentCorrelationId`, `source`, `attributes`) into OTEL span attributes and log fields.
- Use `extensions` to tag metrics/traces with higher-level metadata (e.g. `llm.provider`, `conversation_cohort`), without the core knowing about these concepts.
- Provide simple wiring helpers:

  ```ts
  export function createOtelTracingAdapter(/* config */): TracingAdapter;
  export function createOtelMetricsSink(/* config */): MetricsSink;
  export function createPinoLogger(/* config */): Logger;
  ```

**Non-goals:**

- No telemetry code in `@tradentic/resilient-http-core` itself.
- No mandatory OTEL/metrics dependency for core users.

**Interaction with core:**

- Implements:
  - `Logger`
  - `MetricsSink`
  - `TracingAdapter`
- Consumes:
  - `AgentContext` (incl. `parentCorrelationId` propagation)
  - `HttpRequestOptions.extensions`

---

## 5. Agentic / LLM Conversation Core

### 5.1 Package Idea: `@tradentic/agent-conversation-core`

**Scope:**

- Introduce higher-level, domain-specific concepts for LLM/agent workflows:
  - `Conversation`: app-level logical conversation.
  - `Turn`: one step/interaction in a conversation.
  - `ProviderSession`: per-provider, per-conversation context.

- Handle multi-provider quirks:
  - OpenAI responses: `conversation_id`, `previous_response_id`.
  - Anthropic messages: stateless API, full history in each call.
  - Gemini contents/sessions: history arrays, session IDs.

- Provide a unified abstraction that:
  - Maintains per-conversation state.
  - Chooses providers/models.
  - Orchestrates prompts, tools, and follow-ups.

**Responsibilities:**

- Own the **semantic model** of conversations and turns.
- Decide how to:
  - Store history (e.g. in memory, Redis, database).
  - Compress or truncate history (token budgets).
  - Map conversations/turns to provider-specific API calls.

**Non-goals:**

- Do not implement HTTP resilience directly (leave that to `resilient-http-core`).
- Do not couple to any single LLM provider.

**Interaction with core:**

- Uses `@tradentic/resilient-http-core` as the HTTP transport and resilience layer.
- Populates:
  - `AgentContext` with correlation IDs for conversations and turns **at an infrastructure level**, e.g.:

    ```ts
    agentContext: {
      correlationId: 'conv-1234:turn-7',
      parentCorrelationId: 'conv-1234:turn-6',
      source: 'rotation-score-agent',
      attributes: { tier: 'experiment' },
    }
    ```

  - `extensions` with rich LLM metadata, e.g.:

    ```ts
    extensions: {
      llm: {
        provider: 'openai',
        model: 'gpt-5.1-mini',
        appConversationId: 'conv-1234',
        providerConversationId: '...',
        previousResponseId: '...',
      },
    }
    ```

- Agent/LLM logic lives entirely outside the core; the core just transports metadata and performs HTTP.

---

## 6. Provider-Specific LLM HTTP Wrappers

### 6.1 Package Ideas:

- `@tradentic/http-llm-openai`
- `@tradentic/http-llm-anthropic`
- `@tradentic/http-llm-gemini`

**Scope:**

- Provide thin, strongly-typed HTTP wrappers for specific LLM APIs using `resilient-http-core`:
  - Typed request/response models for each provider.
  - Helpers for common operations (chat completions, responses, embeddings, etc.).
- Play nicely with `@tradentic/agent-conversation-core` but not strictly depend on it.

**Responsibilities:**

- Know provider-specific quirks:
  - Auth headers, base URLs, rate limits.
  - Endpoint paths, pagination, streaming modes.
  - Expected error shapes.

- Offer factory helpers, e.g.:

  ```ts
  export function createOpenAiHttpClient(config: OpenAiHttpConfig): OpenAiHttpClient;
  ```

**Non-goals:**

- Do not reimplement conversation logic; that belongs to `agent-conversation-core`.
- Do not bake in any particular agent framework.

**Interaction with core:**

- Use `HttpClient` internally for all HTTP requests.
- Use `operationDefaults`, `beforeRequest`, `afterResponse` hooks for provider-specific nuances.
- Emit metrics/logging/tracing via the core’s interfaces.

---

## 7. High-Level Roadmap / Phasing

### Phase 1 — Core Stabilisation (v0.4+)

- Finalize and implement v0.4 in `@tradentic/resilient-http-core`:
  - `OPTIONS` support.
  - Minimal `AgentContext` with `correlationId`, `parentCorrelationId`, `source`, `attributes`.
  - `extensions` field on `HttpRequestOptions` and metrics, fully wired to logging/tracing.
- Refactor existing clients (FINRA, UW, OpenAI, SEC, IEX) to use v0.4 where appropriate.

### Phase 2 — Pagination Helper Extraction

- Move pagination helpers into `@tradentic/resilient-http-pagination` (or keep in core short-term, but design as if they can be split).
- Standardize pagination usage across clients (optional but recommended).

### Phase 3 — Policy & Telemetry Adapters

- Implement `@tradentic/resilient-http-policies` with cockatiel or resilience4ts wrappers.
- Implement `@tradentic/resilient-http-otel` and one logging adapter (`pino` or `winston`).
- Wire them into selected apps (e.g. Temporal worker) as optional enhancements.

### Phase 4 — Agent/LLM Layer

- Design and implement `@tradentic/agent-conversation-core` for multi-provider agent workflows.
- Implement first provider-specific wrappers (`@tradentic/http-llm-openai`, etc.).
- Use `resilient-http-core` under the hood for all LLM HTTP traffic.

### Phase 5 — Externalisation & Open Source

- Once stable, consider splitting these packages into separate repositories (e.g. a `tradentic-http` org) while preserving:
  - Versioned specs in `docs/specs/`.
  - Cross-repo test harnesses for end-to-end flows.

---

## 8. Design Guardrails

To keep the ecosystem maintainable and clean:

1. **Core stays small and agnostic**
   - No domain-specific logic (no knowledge of FINRA/UW/SEC/LLM providers).
   - No heavy dependencies (OTEL, big resilience libraries) baked in.

2. **Everything else is opt-in**
   - Pagination, policies, telemetry, agents, LLM wrappers are all separate layers.
   - Apps choose which layers they need.

3. **Hooks and contracts are stable**
   - `HttpClient`, `BaseHttpClientConfig`, `HttpRequestOptions`, `AgentContext`, `extensions`, and core interfaces (Logger, MetricsSink, TracingAdapter, HttpCache, HttpRateLimiter, CircuitBreaker) form the stable surface area.
   - Satellite libraries build on these contracts; changes should be additive and backwards compatible.

4. **No shortcuts in observability**
   - Always propagate `AgentContext` (correlationId + parentCorrelationId + source + attributes).
   - Always carry `extensions` through to telemetry so higher layers can observe their semantics.

This roadmap should guide future evolution, ensuring `@tradentic/resilient-http-core` remains a solid foundation while enabling richer ecosystems around resilience, telemetry, and agentic AI.
