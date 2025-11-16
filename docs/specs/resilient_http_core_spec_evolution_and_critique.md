# Resilient HTTP Core & Satellites — Spec Evolution & Design Critique (HTTP‑Only)

> Internal guidance document summarising how the **core** spec evolved from v0.1 → v0.6 and how the **satellite libraries** evolved, what’s strong, what’s risky, and how to shape hooks/templates for an out‑of‑the‑box HTTP client that works for both enterprises and AI agents. This document intentionally excludes any gRPC plans.

---

## 1. Core Evolution Overview (v0.1 → v0.6 + Roadmap)

### 1.1 v0.1 — Unifying the HTTP Mess

**Core themes**

- Monorepo‑driven origin (FINRA, UnusualWhales, OpenAI, worker services) with an explicit goal of being portable and domain‑agnostic.
- Fetch‑first design with a pluggable `HttpTransport` abstraction and adapters such as `createAxiosTransport`.
- Centralised cross‑cutting concerns:
  - Retries with jitter backoff and `Retry-After` support.
  - Timeouts via `AbortController`.
  - Optional interfaces for `HttpCache`, `HttpRateLimiter`, `CircuitBreaker`, `Logger`, `MetricsSink`.
- A generic `HttpClient` defined via:
  - `BaseHttpClientConfig` for global configuration.
  - `HttpRequestOptions` for per‑request configuration.
  - `policyWrapper` as a generic escape hatch to let external resilience libraries wrap attempts.

**Intent:** one resilient HTTP client to serve all libraries in the monorepo, with strong bias toward zero hard dependencies and domain‑agnostic design.

---

### 1.2 v0.2 — Agent‑Aware and Telemetry‑Ready

**Key upgrades**

- **Agent / tool awareness** via `RateLimiterContext` and related metadata:
  - `operation`, `agentName`, `toolName`, `priority`, etc.
  - Allows rate limiters to differentiate traffic by origin and importance.
- **Error classification**
  - Introduces `ErrorCategory` and an `ErrorClassifier` hook to decide whether failures are transient, auth, validation, rate limit, quota, etc.
  - Adds a `responseClassifier` mechanism so odd APIs can be normalised.
- **Telemetry hooks**
  - `MetricsSink` for metrics.
  - `Logger` for structured logging.
  - `TracingAdapter` for tracing (OTEL‑friendly, but no OTEL hard dependency).
- **Streaming hook**
  - `requestRaw` that returns the raw `Response` and performs only a single attempt.
  - Streaming and SSE are left to higher‑level libraries (e.g. provider clients), keeping core free of protocol‑specific complexity.

**Intent:** make the client friendly for AI/agent use cases and observability without hard‑wiring any particular LLM or tracing stack.

---

### 1.3 v0.3 — Ergonomics & Pagination Helpers

**New features**

- **Base URL resolution**
  - `resolveBaseUrl` plus per‑client `baseUrl` to support multi‑region / multi‑host scenarios.
- **Pre/post hooks**
  - `beforeRequest` and `afterResponse` to tweak headers, inspect responses, and perform low‑level operations.
- **Operation‑level defaults**
  - `operationDefaults` for `timeoutMs`, `maxAttempts`, idempotency hints, and more.
- **Convenience helpers**
  - `requestText` and `requestArrayBuffer` built on top of `requestRaw` for common response types.
- **Pagination helpers**
  - `paginateAll` and `paginateIterator` defined as helpers, not as core responsibilities.

**Intent:** improve everyday ergonomics and start peeling pagination into a separate conceptual layer while keeping the core small.

---

### 1.4 v0.4 — Metadata Discipline & Extensions

**Key refinements**

- **Protocol completeness**
  - Full support for HTTP `OPTIONS`, treated as safe/idempotent.
- **AgentContext simplification**
  - Moves towards a minimal, stable `AgentContext` type that captures identity and labels, not transport details.
- **Opaque extensions bag**
  - Adds `extensions: Record<string, unknown>` to `HttpRequestOptions` and propagates it into metrics, logging, and tracing.
  - This becomes the main carrier for AI/LLM‑specific metadata and other caller‑defined context.
- **Correlation guarantees**
  - Clarifies handling of correlation IDs: when `correlationId` is present, `parentCorrelationId` is propagated, so you can reconstruct request trees.

**Intent:** draw a clear line: core moves correlation/metadata; higher‑level libraries interpret them.

---

### 1.5 v0.5 — Correlation & AgentContext Cleanup

**Reshaping of metadata**

- Moves fields like `requestId`, `correlationId`, `parentCorrelationId`, `agentContext`, and `extensions` onto `HttpRequestOptions` explicitly.
- Ensures these fields are surfaced in:
  - `MetricsRequestInfo` for metrics.
  - Logging meta for structured logs.
  - Tracing attributes for span tagging.
- Refines `AgentContext` into:
  - `agent?: string`
  - `runId?: string`
  - `labels?: Record<string, string>`
  - `metadata?: Record<string, unknown>`
- Removes correlation ID concerns from `AgentContext` so correlation is the responsibility of the HTTP layer.

**Intent:** separate *who/what* is calling (AgentContext) from *how requests are correlated* across systems (correlation IDs).

---

### 1.6 v0.6 — Resilience Substrate & Interceptors

This is the big pivot toward making `resilient-http-core` a true resilience substrate for HTTP.

**New abstractions**

1. **ResilienceProfile**
   - Defines how much budget a request has:
     - Latency budgets.
     - Max attempts.
     - Fail‑fast vs fail‑open decisions.
     - Failover hints.

2. **ErrorClassifier**
   - Formalises how raw responses/errors map into `ErrorCategory` such as:
     - `transient`, `rateLimit`, `validation`, `auth`, `quota`, `safety`, `unknown`, etc.
   - Provides retry and backoff hints.

3. **RateLimitFeedback**
   - Structured feedback attached to metrics to inform rate limiters and policy engines.
   - Enables dynamic adjustment of concurrency and budgets.

4. **RequestOutcome**
   - Compact summary of a request used for telemetry:
     - `ok`, `status`, `attempts`, `startedAt`, `finishedAt`, `errorCategory`.

5. **HttpRequestInterceptor chain**
   - `beforeSend`, `afterResponse`, `onError` hooks that can be composed.
   - Cross‑cutting concerns (policies, guardrails, auth, AI tags, cache, etc.) live here instead of inside `HttpClient`.

6. **AI extension key conventions**
   - Recommended patterns for using `extensions` (e.g. `ai.provider`, `ai.model`, `ai.operation`) while keeping the core ignorant of provider‑specific semantics.

**Intent:** lock in a stable set of core contracts (`HttpClient`, `HttpRequestOptions`, `AgentContext`, `ResilienceProfile`, `ErrorClassifier`, `RateLimitFeedback`, `RequestOutcome`, `HttpRequestInterceptor`, telemetry interfaces) and push fast‑moving complexity into satellites.

---

### 1.7 Roadmap & Satellite Libraries

The roadmap externalises everything that changes quickly or is domain‑specific:

- Pagination helpers and policies.
- Policy engine & budgets.
- Telemetry adapters (OTEL, Prometheus, etc.).
- Agent conversation and AI/provider wrappers.
- Browser guardrails and content safety checks.

**Core design philosophy:**

> Core is small and boring. Satellites are where opinions and velocity live.

This matches how modern HTTP libraries and platform SDKs structure themselves: a minimal, stable transport layer plus higher‑level, fast‑moving layers.

---

## 2. Core Strengths vs Future Pain Points

### 2.1 Strong Core Design Choices

These elements are solid and should age well:

1. **Fetch‑first, pluggable transport**
   - `HttpTransport` with adapters (e.g. axios) keeps you portable across runtimes (Node, browser, edge) and frameworks.

2. **No mandatory external deps**
   - No hard dependency on OTEL, specific resilience libraries, axios, or logging/metrics libraries.
   - Makes it attractive for both small codebases and enterprises with strict dependency policies.

3. **Clear core vs satellite boundary**
   - Core types are protocol‑level and resilience‑focused.
   - Pagination, policies, telemetry adapters, agents, and guardrails live in satellite packages.

4. **Observability‑first design**
   - Request IDs, correlation IDs, parent correlation IDs.
   - AgentContext + `extensions` propagated into metrics/logging/traces.
   - Enables centralised analysis and debugging in complex systems.

5. **Resilience aligned with industry practice**
   - Retry/backoff, timeouts, circuit breakers, rate limiting, budgets, and error categorisation mirror mainstream resilience patterns.

6. **Interceptors (v0.6)**
   - A standard, composable middleware pattern that users already expect from libraries like Axios.

These decisions give you a strong foundation for both small services and large enterprise deployments.

---

### 2.2 Core Issues Likely to Bite Later

#### 2.2.1 Dual Hook Systems: `beforeRequest/afterResponse` vs Interceptors

- v0.3 introduced `beforeRequest`/`afterResponse` as top‑level hooks.
- v0.6 introduced `HttpRequestInterceptor` with `beforeSend`/`afterResponse`/`onError`.

If both are supported in the implementation without clear rules, you now have two overlapping extension mechanisms.

**Risks**

- Unclear where to put logic (policies/auth in `beforeRequest`, interceptors, or both?).
- Potential double execution of cross‑cutting code.
- Confusing execution order when both exist.

**Recommendation**

- Declare **interceptors** as the canonical mechanism.
- Implement `beforeRequest`/`afterResponse` *internally* as a thin compatibility interceptor.
- Mark `beforeRequest`/`afterResponse` as **deprecated** in the spec.
- Document interceptor execution order clearly (global interceptors, client‑specific, operation‑specific, etc.).

---

#### 2.2.2 Overlapping Resilience Layers & Retry Storms

Currently you have or plan to have:

- Built‑in retry logic in `HttpClient`.
- Optional `policyWrapper` hook allowing external resilience wrappers.
- A policy engine (via satellites) that uses `ResilienceProfile`, `ErrorClassifier`, and `RateLimitFeedback`.

If callers use **all three**, it’s easy to accidentally nest retries and create retry storms and cascading failures.

**Risks**

- Duplicate retries across layers.
- Confusing behaviour when different layers disagree on budgets.
- Harder to reason about latency and load.

**Recommendations**

- Declare a single **normative retry layer**:
  - `HttpClient` + `ResilienceProfile` is the primary retry mechanism.
- Treat `policyWrapper` as a **legacy/advanced escape hatch** only:
  - Consider marking it as "discouraged for new code" once the policy engine is in place.
- Ensure the policy engine does **not** independently call retries that conflict with `HttpClient`.
- Make it explicit in the spec that all retry decisions must respect `ResilienceProfile`.

Long term, plan a v1.0 step that formally deprecates `policyWrapper` in favour of policy interceptors.

---

#### 2.2.3 `HttpRequestOptions` Becoming a Kitchen Sink

Over several versions, `HttpRequestOptions` has accumulated many responsibilities:

- Base URL hints and path info.
- Operation name and idempotency hints.
- Timeouts and retry settings.
- AgentContext.
- Correlation IDs and request IDs.
- ResilienceProfile.
- Cache controls.
- `extensions`.

This is all useful, but the type is now doing a lot of work.

**Risks**

- Intimidating for new users and AI frameworks.
- Harder to evolve because everything is in one mega type.

**Recommendations**

- Clearly define a *minimal* shape for most callers:
  - e.g. `method`, `path/url`, `operation`, optional `body`, simple `timeoutMs`.
- Group advanced settings into sub‑objects where sensible:
  - `resilience`, `cache`, `agentContext`, `extensions`.
- Move ultra‑advanced knobs (low‑level backoff tuning) to `HttpClientConfig` or policy layers, not per‑request.

This preserves power users’ flexibility while giving normal users a smaller mental model.

---

#### 2.2.4 AgentContext vs Extensions vs Telemetry Meta (Double‑Tagging)

You now have three places to put metadata:

- `AgentContext` — identity of the caller (`agent`, `runId`, stable labels).
- `extensions` — per‑request metadata (LLM model, tenant, tool, etc.).
- Telemetry meta (`Logger` meta, `MetricsRequestInfo`) — which can also carry extra fields.

**Risks**

- Different teams or satellites duplicating the same concepts in multiple places.
- Inconsistent naming for the same logical fields.

**Recommendations**

- Codify semantics:
  - `AgentContext` = who/what is making the call.
  - `extensions` = request‑level metadata that might influence policies or routing.
  - Telemetry meta is derived from those two and only adds technical fields like `durationMs`, `status`, etc.
- Provide a small table of **recommended extension keys**, especially for AI:
  - `ai.provider`, `ai.model`, `ai.operation`, `ai.tenant`, `ai.tool`, etc.

This keeps metadata consistent and makes observability usable.

---

#### 2.2.5 Questionable Long‑Term Value of `policyWrapper`

`policyWrapper` made sense early on as a generic “wrap the whole attempt” hook. But with:

- `ResilienceProfile`.
- Interceptors.
- Policy engine + `ErrorClassifier`.

…it becomes a second way of expressing the same idea.

**Risks**

- Encourages users to build nested, opaque resilience logic.
- Harder for metrics and tracing to see individual attempts.

**Recommendation**

- Mark `policyWrapper` as **legacy** or "advanced escape hatch".
- Encourage new code to use interceptors + policy engine instead.

---

#### 2.2.6 Minor Over‑Specification Risks

A few areas might be over‑detailed for core types:

- Some `RateLimiterContext` fields (like `toolName`) could live in `extensions` rather than the core context shape.
- Make sure you clearly define whether `MetricsSink.recordRequest` is called per **attempt** or per **end‑to‑end request**, and stick with that.

These are small but worth tightening before v1.0.

---

## 3. Core Hook & Plugin Surfaces to Prioritise

For an HTTP client that both enterprises and AI agents are happy to adopt, these are the most important extension points.

### 3.1 Auth & Credentials

Everyone needs a place to plug in auth:

- OAuth2 token fetch + refresh.
- API key header injection.
- Cloud‑specific signing (e.g. AWS SigV4, custom HMAC schemes).

**Design stance**

- Auth is implemented as **interceptors**, not as core logic.
- Optionally define a small `AuthInterceptor` pattern in satellites, but keep core generic.

This allows credential strategies to evolve without touching `HttpClient`.

---

### 3.2 Serialization / Content Negotiation

The core is based on `RequestInit` + `Response`, which is good, but real clients often want:

- A "body serializer" that knows how to handle:
  - `{ json: any }` → JSON body + `Content-Type: application/json`.
  - `{ form: Record<string, string> }` → `application/x-www-form-urlencoded`.
  - Streams / `Readable` bodies.
- Optional compression/decompression hooks.

**Design stance**

- Implement via an interceptor that inspects the request options (e.g. `extensions.contentType` or specific fields) and mutates `init.body` + headers accordingly.
- Keep the core strict about only dealing with `RequestInit` and `Response`.

---

### 3.3 Idempotency Keys

You already have idempotency hints at the operation level. For some APIs (payments, orders) users will require explicit idempotency keys.

**Recommendation**

- Add an optional `idempotencyKey?: string` field on `HttpRequestOptions`.
- Document a pattern where an interceptor maps this to the correct header (e.g. `Idempotency-Key`).

This keeps the core neutral while providing a clear pattern for safe retries on non‑GET operations.

---

### 3.4 Bulkheads & Concurrency Limits

The roadmap already gestures at policy engines and concurrency controls based on `PolicyScope` and `ResilienceProfile`.

**Design stance**

- Concurrency control lives in **policy layers and interceptors**, not inside `HttpClient`.
- Provide a stable interface for external implementations (e.g. Redis‑backed policy engine).

This gives enterprises the isolation patterns they expect without bloating the core.

---

## 4. Out‑of‑the‑Box Core Experience & Template Setups

Right now the core spec is very interface‑heavy, which is great for flexibility but doesn’t yet shout “clone this and you’re productive in 5 minutes”.

To fix that, standardise some **default implementations** and **template setups**.

### 4.1 Default Core Implementations (No External Dependencies)

Provide a helper like:

```ts
createDefaultHttpClient(config: DefaultHttpClientConfig): HttpClient
```

Where `DefaultHttpClientConfig` is intentionally small and simple.

**Default wiring**

- Transport:
  - `fetchTransport` (global `fetch` or a polyfill; runtime detection as needed).
- Cache:
  - In‑memory `Map`‑based `HttpCache` with bounded size and TTL.
- Rate Limiting:
  - Simple in‑memory token bucket `HttpRateLimiter`.
- Circuit Breaker:
  - Either none, or a minimal in‑memory circuit breaker, depending on complexity appetite.
- Logging:
  - `ConsoleLogger` implementing `Logger`.
- Metrics & Tracing:
  - `NoopMetricsSink` and `NoopTracingAdapter`.
- Policies:
  - A single `PolicyInterceptor` with very simple defaults (e.g. max 3 attempts, exponential backoff, 2s timeout) wired to `ResilienceProfile`.

This yields a **Template 0**: fully self‑contained, zero‑deps, ready‑to‑use HTTP client that works in Node and (optionally) browser.

---

### 4.2 Core‑Only Opinionated Templates (Documentation Patterns)

Add short, copy‑pastable templates in the docs/spec to demonstrate real usage.

#### Template A — Small Node Service

Goals:

- Minimal configuration.
- Good defaults for timeouts and retries.

Example characteristics:

- `createDefaultHttpClient({ baseUrl, clientName })`.
- Console logger.
- In‑memory cache.
- Simple per‑operation overrides for timeouts.

#### Template B — Production Microservice (Core‑Only)

Goals:

- Fully observable.
- Externalised state for cache/rate limiting.

Example characteristics:

- `createHttpClient` with:
  - Redis or other external `HttpCache` implementation.
  - External `HttpRateLimiter` implementation.
  - OTEL adapters wired to the existing `TracingAdapter` and `MetricsSink` interfaces.
- A `createPolicyInterceptor` configured with:
  - Per‑client budgets.
  - Per‑operation `ResilienceProfile` overrides.
- Logging adapter to a structured logger (pino/winston/etc.).

These templates live in docs/specs but dramatically lower activation energy for real‑world use.

---

## 5. Satellite Libraries — Evolution & Critique

This section covers the satellite libraries and how they support the core: pagination, policies, agent conversation, browser guardrails, and the OpenAI HTTP client.

---

### 5.1 `@airnub/resilient-http-pagination`

#### 5.1.1 Evolution: v0.1 → v0.2

**v0.1**

- Very small, elegant helper library.
- Works against a minimal `JsonHttpClient` interface (`requestJson<T>`).
- Two primitives:
  - `paginateAll` — collect everything into memory.
  - `paginateIterator` — async iterator over pages.
- Caller supplies:
  - Initial request.
  - `getNextRequest(lastPage, state)` → next `JsonRequestOptions | null`.
  - `extractItems(page)` → items.
- Resilience completely delegated to the underlying client.

**v0.2**

- Hard-targets `resilient-http-core` v0.6.
- Introduces:
  - `PaginationModel` (`offset-limit`, `cursor`, `link-header`, `custom`).
  - `PaginationStrategy` and `PageExtractor` abstractions.
  - Run-level `PaginationLimits` (max pages, max items, max end-to-end latency).
  - `PaginationResilience` and `PaginationObserver`.
  - `Page<TItem>` and `PaginationResult<TItem>` with a run-level `RequestOutcome`.
- Two main APIs:
  - `paginate(options)` → collects pages & items, returns `PaginationResult<TItem>`.
  - `paginateStream(options)` → async generator yielding pages, then returning the `PaginationResult` when done.

#### 5.1.2 Strengths

- **Clean separation of responsibilities**
  - Strategies understand how to move between pages.
  - Extractors understand what to pull from each response.
  - Core loop is generic and reusable.

- **Run-level limits and budget awareness**
  - `maxPages`, `maxItems`, `maxEndToEndLatencyMs` fit the resilience story and are exactly what you want for long-running agent scrapes.

- **Alignment with core v0.6**
  - Reusing `ResilienceProfile` and `RequestOutcome` keeps pagination as "just another operation" in your telemetry model.

#### 5.1.3 Pain Points & Risks

- **Complexity jump from v0.1 to v0.2**
  - v0.1 is "anyone can use this in 2 minutes"; v0.2 requires more conceptual overhead.
  - If both APIs remain, you risk duplicated mental models and confusion.

- **Type-erasure friction**
  - `PageExtraction.state?: unknown` and generic strategies mean frequent downcasts in real code.

- **Telemetry precision vs implementation reality**
  - If your implementation approximates per-page attempt counts or outcomes, you risk misleading metrics. Better to provide simpler but accurate signals.

#### 5.1.4 Gaps & Recommended Hooks

- **Out-of-the-box presets**
  - Ship helpers like `paginateOffsetLimit` and `paginateCursor` for common patterns, where users only specify a handful of obvious fields.

- **AI-friendly patterns**
  - Provide wrappers that:
    - Fetch up to `N` items or stop when a predicate returns true.
    - Respect a per-run latency or token budget in a way that maps directly to an agent turn.

---

### 5.2 `@airnub/resilient-http-policies`

#### 5.2.1 Evolution: v0.1 → v0.2

**v0.1**

- Simple adapter package:
  - Re-exported a `PolicyWrapper` type from core.
  - `createNoopPolicyWrapper()` — identity wrapper.
  - `createCockatielPolicyWrapper()` — plug a third-party resilience library into core’s `policyWrapper`.

**v0.2**

- Becomes a full **policy engine**:
  - `PolicyScope` (client, operation, agent, provider, model, bucket).
  - `RequestClass` (`interactive | background | batch`).
  - `PolicyDefinition` with rate limits, concurrency caps, resilience hints, priority.
  - `PolicyEngine` interface (`evaluate` + `onResult`).
  - `InMemoryPolicyEngine` as the first implementation.
  - `createPolicyInterceptor` to turn the engine into a `HttpRequestInterceptor`.

#### 5.2.2 Strengths

- **Expressive scope model**
  - Can differentiate between OpenAI calls vs internal APIs, interactive vs batch, or multiple tenants.

- **Clean integration point**
  - Interceptor simply derives scope from `HttpRequestOptions` + `AgentContext` + `extensions`, calls `engine.evaluate`, applies decisions, and notifies `engine.onResult` afterwards.

- **Good separation from core**
  - Core only knows about interceptors and profiles; policy complexity is entirely in this satellite.

#### 5.2.3 Pain Points & Risks

- **Overlap with guardrails**
  - Policies can deny requests, and so can browser guardrails. Without clear docs, devs won’t know whether a rejected request came from policies or guardrails.

- **High cognitive overhead for simple use cases**
  - For small projects that just want "3 retries and don’t exceed X RPS", a full policy engine feels heavy.

- **In-memory engine limitations**
  - Works well for single-process tests and local dev.
  - Not suitable by default for multi-process / multi-pod deployments where quotas must be shared.

- **Overlap with `ResilienceProfile` semantics**
  - Many policy hints (latency budgets, fail-fast behaviour) mirror what `ResilienceProfile` already does. If you treat them as fully independent axes, configs can drift.

#### 5.2.4 Gaps & Recommended Hooks

- **Minimal path for common cases**
  - Provide helpers like:
    - `createBasicRateLimitPolicy({ clientName, rps, burst })`.
    - `createBasicConcurrencyPolicy({ clientName, maxConcurrent })`.
  - Wrap these into simple factories so users can get started without learning the full engine.

- **Config loading story**
  - Add guidance or helpers for loading `PolicyDefinition[]` from YAML/JSON config so policies can be managed outside of code.

---

### 5.3 `@airnub/agent-conversation-core` (v0.1)

#### 5.3.1 What It Is

- A provider-agnostic **conversation and turn model**:
  - `Conversation`, `ConversationTurn`, `ConversationMessage` types.
  - `ProviderAdapter` abstraction for LLMs.
  - `ConversationStore` interface with an in-memory implementation.
  - `ConversationEngine` that builds history, delegates to providers, and records turns and provider call records.

- Tightly aligned with HTTP core telemetry:
  - Uses `AgentContext` and `extensions` to thread conversation/turn IDs and AI metadata down into `HttpRequestOptions`.

#### 5.3.2 Strengths

- **Clean separation from HTTP core**
  - Core doesn’t know about conversations, tools, or prompts; it only sees metadata.

- **Provider adapter boundary is well-defined**
  - Allows building provider-specific adapters (OpenAI, etc.) on top of `http-llm-openai` without contaminating the core.

- **Turn-centric design**
  - Fits the mental model of “LLM call → response → recorded turn” while remaining vendor-agnostic.

#### 5.3.3 Pain Points & Risks

- **Streaming support is under-specified**
  - The provider adapter includes streaming capabilities, but the `ConversationEngine` API is non-streaming.
  - Real-world usage will expect streaming for UX; you’ll need a `runStreamingTurn` or equivalent.

- **Message `content: unknown`**
  - Flexible but awkward for daily use; most consumers expect either text or structured tool calls.

- **Naïve storage**
  - `ConversationStore` is simple by design, but it’s easy for users to implement stores that:
    - Scan entire conversations on every turn.
    - Grow unbounded in length.
    - Lack a story for truncation, archiving, or summarisation.

#### 5.3.4 Gaps & Recommended Hooks

- **History strategies based on budgets**
  - Introduce a `HistoryBuilder` concept that composes messages until a token/size budget is reached, rather than a fixed count.

- **Tool-calling model**
  - Extend message and turn models to capture tool-call flows in a structured way without overcomplicating the base types.

---

### 5.4 `@airnub/agent-browser-guardrails` (v0.1)

#### 5.4.1 What It Is

- A **guardrail layer for HTTP browsing** expressed as a `HttpRequestInterceptor`.
- Core concepts:
  - `GuardrailScope` (agent, tool, tenant, kind).
  - `GuardrailRule` with URL/method/header/body constraints and an `effect` (`allow` / `deny`).
  - `GuardrailEngine` + `InMemoryGuardrailEngine`.
  - `createBrowserGuardrailsInterceptor` that derives scope from `AgentContext` + `extensions`, evaluates rules, and throws `GuardrailViolationError` on deny.

#### 5.4.2 Strengths

- **Strict HTTP-surface focus**
  - Only cares about hosts, paths, methods, headers, and body constraints; doesn’t try to be a generic content-safety system.

- **Consistent scoping with the rest of the ecosystem**
  - Uses the same kind of agent/tool/tenant scopes as policies and core metadata.

- **Default-deny stance for agents**
  - Encourages safe-by-default browsing behaviour.

#### 5.4.3 Pain Points & Risks

- **Overlap with policy engine in user perception**
  - Both can deny requests; it’s not always obvious to app developers which layer did so without good logging.

- **Pattern matching is intentionally minimal**
  - Prefix/exact matches are a good v0.1 tradeoff but might prove too weak for complex API patterns.

#### 5.4.4 Gaps & Recommended Hooks

- **Pre-baked profiles**
  - Provide pre-defined rule sets like:
    - `safeReadOnlyWebBrowser(agentName)` → HTTPS-only, GET/HEAD-only, small bodies.
    - `internalApiOnly(toolId, hosts[])` → allow-list specific hosts, enforce headers, block arbitrary auth.

- **Admin/debug visibility**
  - Helpers to inspect rules, compute a dry-run decision for a given URL and scope, and explain which rule would fire.

---

### 5.5 `@airnub/http-llm-openai` (v0.1)

#### 5.5.1 What It Is

- A thin OpenAI HTTP client built on `resilient-http-core`, focused on:
  - Responses API.
  - Embeddings.
  - Model listing.
- Key pieces:
  - `OpenAiHttpClient` wrapping `HttpClient`.
  - `OpenAiResponsesClient` for non-streaming + streaming calls.
  - `OpenAiEmbeddingsClient` and `OpenAiModelsClient`.
  - `createOpenAiErrorClassifier` tuned for OpenAI error semantics.
  - Strong use of `AgentContext` and `extensions['ai.*']`.

#### 5.5.2 Strengths

- **Deliberately scoped**
  - Focuses on modern OpenAI APIs rather than trying to be a full general SDK.

- **Designed to integrate with agent-conversation-core**
  - Provider adapters can cleanly map conversation messages to Responses API requests and feed back usage and IDs.

- **Error classification baked in**
  - First-class classifier gives you better retry and policy decisions.

#### 5.5.3 Pain Points & Risks

- **API churn**
  - OpenAI evolves quickly; you’ll need to keep types at least loosely in sync or risk surprises for coding agents.

- **Boundary creep risk**
  - There’s a temptation to put conversation, history, or tool logic into this package “because it’s OpenAI-specific.” Keeping the boundary clean is critical.

#### 5.5.4 Gaps & Recommended Hooks

- **Opinionated defaults**
  - Provide `createDefaultOpenAiClient({ apiKey })` with sane defaults for resilience and metadata wiring.

- **Helpers for continuation**
  - Export helpers for building `previous_response_id` continuation requests from earlier responses to make it easy to chain calls correctly.

---

## 6. Stacks & Templates Across Core + Satellites

Right now, everything is **beautifully decomposed** but not yet assembled into fully opinionated stacks. To hit the "complete out-of-the-box experience with no external dependencies by default" goal, you should define a small set of stack factories that wire core + satellites together.

### 6.1 Stack 1 — Basic HTTP Core Stack (No AI)

Goals:

- Minimal configuration.
- Good defaults.
- No external dependencies.

Characteristics:

- Uses `createDefaultHttpClient` from the core.
- Adds:
  - In-memory pagination support via `resilient-http-pagination` v0.2 with built-in offset/cursor presets.
  - Optional basic policy interceptor using in-memory policies for backoff and simple rate limits.
- Intended for small services and CLI tools.

### 6.2 Stack 2 — LLM Provider Client Stack (OpenAI-Focused)

Goals:

- Turnkey stack for calling OpenAI reliably.

Characteristics:

- `HttpClient` with:
  - OpenAI base URL.
  - OpenAI error classifier.
  - `ResilienceProfile` tuned for OpenAI latency and retry expectations.
- `PolicyInterceptor` configured for:
  - Per-model limits and priorities.
- `OpenAiHttpClient` with:
  - Responses client.
  - Embeddings client.
  - Models client.

All of this can still avoid external dependencies by default; external rate limit stores are optional.

### 6.3 Stack 3 — Agentic HTTP + Browser Stack

Goals:

- Provide a complete HTTP + LLM + browsing substrate for agents.

Characteristics:

- Includes all of Stack 2.
- Adds:
  - `agent-conversation-core` with:
    - In-memory conversation store.
    - Simple history strategy (e.g. recent N turns or approximate token budget).
  - `agent-browser-guardrails` with:
    - Safe browsing defaults for a named agent or tool.
  - `resilient-http-pagination` for agent-driven paginated scrapes.
  - `resilient-http-policies` for:
    - Per-tenant/per-agent policy rules.
    - Simple concurrency limits on browsing and provider traffic.

For all stacks, provide example code snippets and configuration templates so users and coding agents can bootstrap quickly.

---

## 7. Metadata Semantics Recap

To prevent drift and double-tagging across core and satellites, standardise metadata semantics.

### 7.1 AgentContext

`AgentContext` answers: **Who/what is making this call?**

- `agent`: name or identifier of the agent or service.
- `runId`: unique ID for this run/task.
- `labels`: stable, low-cardinality properties (`"env": "prod"`, `"component": "billing-worker"`).
- `metadata`: structured info stable for the life of the run.

### 7.2 Extensions

`extensions` answers: **What extra attributes does this specific request have that might affect policies or routing?**

Examples:

- AI provider:
  - `ai.provider`, `ai.model`, `ai.operation`, `ai.tool`, `ai.tenant`.
- Tenanting:
  - `tenant.id`, `tenant.tier`.
- Feature flags:
  - `feature.experimentId`, `feature.variant`.

### 7.3 Telemetry Meta

Telemetry meta is **derived** from `AgentContext`, `extensions`, correlation IDs, and `RequestOutcome`.

- Logging meta: tags + error details.
- Metrics: status, latency, request volume, rate limit feedback.
- Tracing: span attributes mapping key metadata and correlation IDs.

Avoid introducing new semantic keys at the telemetry layer; this keeps the model consistent across backends and satellites.

---

## 8. Concrete Next Spec Steps (v0.7 → v1.0 Path)

To move toward a stable v1.0 that is attractive for both small teams and enterprises:

1. **Canonicalise Interceptors in Core**
   - Declare `HttpRequestInterceptor` the official extension mechanism.
   - Implement `beforeRequest`/`afterResponse` as a compatibility layer, marked deprecated.

2. **Unify Resilience Layering**
   - Define `HttpClient` + `ResilienceProfile` as the single normative retry/backoff mechanism.
   - Mark `policyWrapper` as a legacy/advanced hook and discourage it for new implementations.

3. **Add Out-of-the-Box Core Defaults**
   - Ship `createDefaultHttpClient` with no external dependencies and sane defaults.
   - Document Template A/B (small service, production) at the core level.

4. **Integrate Satellites into Stack Templates**
   - Define Stack 1/2/3 factories (basic HTTP, LLM provider, agentic HTTP + browser).
   - Provide code examples and recommended configurations in the docs.

5. **Clarify Metadata Semantics**
   - Add explicit guidance for what belongs in `AgentContext`, `extensions`, and telemetry meta.
   - Publish a recommended key table for AI and multi-tenant use cases.

6. **Introduce Idempotency Keys**
   - Add `idempotencyKey` to `HttpRequestOptions`.
   - Document how to implement idempotency via an interceptor.

7. **Lock In Core Contracts, Move Everything Else to Satellites**
   - Treat the following as the frozen core API surface:
     - `HttpClient`, `HttpRequestOptions`, `HttpTransport`.
     - `AgentContext`, `ResilienceProfile`, `ErrorClassifier`, `RateLimitFeedback`, `RequestOutcome`.
     - `HttpRequestInterceptor`, `MetricsSink`, `Logger`, `TracingAdapter`.
   - Continue to refactor pagination, policies, telemetry adapters, agents, and guardrails as satellites with their own versioned specs.

With these changes, `resilient-http-core` plus its satellites becomes a compact, stable, HTTP-only resilience substrate that:

- Works out of the box in simple apps.
- Scales into fully observable production layouts.
- Is a natural base for AI agents and HTTP-based provider SDKs.
- Avoids feature creep and ambiguity by pushing opinions into documented stacks and satellite libraries.

