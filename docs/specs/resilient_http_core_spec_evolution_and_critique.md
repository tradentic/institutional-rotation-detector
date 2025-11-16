# Resilient HTTP Core — Spec Evolution & Design Critique (No-gRPC Focus)

> Internal guidance document summarising how the spec evolved from v0.1 → v0.6, what’s strong, what’s risky, and how to shape hooks/templates for an out‑of‑the‑box HTTP client that works for both enterprises and AI agents. This document intentionally excludes any gRPC plans.

---

## 1. Evolution Overview (v0.1 → v0.6 + Roadmap)

### 1.1 v0.1 — Unifying the HTTP Mess

**Core themes**

- Monorepo‑driven origin (FINRA, UnusualWhales, OpenAI, Temporal worker) but with an explicit goal of being portable and domain‑agnostic.
- Fetch‑first design with a pluggable `HttpTransport` abstraction and adapters such as `createAxiosTransport`.
- Centralised cross‑cutting concerns:
  - Retries with jitter backoff and `Retry-After` support.
  - Timeouts via `AbortController`.
  - Optional interfaces for `HttpCache`, `HttpRateLimiter`, `CircuitBreaker`, `Logger`, `MetricsSink`.
- A generic `HttpClient` defined via:
  - `BaseHttpClientConfig` for global configuration.
  - `HttpRequestOptions` for per‑request configuration.
  - `policyWrapper` as a generic escape hatch to let external resilience libraries (Cockatiel / Resilience4ts, etc.) wrap attempts.

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
  - Streaming and SSE are left to higher‑level libraries (e.g. OpenAI client), keeping core free of protocol‑specific complexity.

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

## 2. Strong Design Choices vs Future Pain Points

### 2.1 Strong Design Choices

These elements are solid and should age well:

1. **Fetch‑first, pluggable transport**
   - `HttpTransport` with adapters (e.g. axios) keeps you portable across runtimes (Node, browser, edge) and frameworks.

2. **No mandatory external deps**
   - No hard dependency on OTEL, Cockatiel, axios, or specific logging/metrics libraries.
   - Makes it attractive for both small codebases and enterprises with strict dependency policies.

3. **Clear core vs satellite boundary**
   - Core types are protocol‑level and resilience‑focused.
   - Pagination, policies, telemetry adapters, agents, and guardrails live in satellite packages.

4. **Observability‑first design**
   - Request IDs, correlation IDs, parent correlation IDs.
   - AgentContext + `extensions` are propagated into metrics/logging/traces.
   - Enables centralised analysis and debugging in complex systems.

5. **Resilience aligned with industry practice**
   - Retry/backoff, timeouts, circuit breakers, rate limiting, budgets, and error categorisation mirror patterns used in mainstream resilience libraries.

6. **Interceptors (v0.6)**
   - A standard, composable middleware pattern that users already expect from libraries like Axios.

These decisions give you a strong foundation for both small services and large enterprise deployments.

---

### 2.2 Things Likely to Bite Later

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

This keeps backward compatibility while avoiding long‑term ambiguity.

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

**Recommendation**

- Declare a single **normative retry layer**:
  - `HttpClient` + `ResilienceProfile` is the primary retry mechanism.
- Treat `policyWrapper` as a **legacy/advanced escape hatch** only:
  - Consider marking it as "discouraged for new code" once the policy engine is in place.
- Ensure the policy engine does **not** independently call retries that conflict with `HttpClient`.
- Make it explicit in the spec that all retry decisions must respect `ResilienceProfile`.

Long term, you may want a v1.0 step that formally deprecates `policyWrapper` in favour of policy interceptors.

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
- Inconsistent naming for the same logical fields (e.g. `tenantId` vs `tenant` vs `customer`).

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

## 3. Hook & Plugin Surfaces to Prioritise

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

## 4. Out‑of‑the‑Box Experience & Template Setups

Right now the spec is very interface‑heavy, which is great for flexibility but doesn’t yet shout “clone this and you’re productive in 5 minutes”.

To fix that, standardise some **default implementations** and **template setups**.

### 4.1 Default Implementations (No External Dependencies)

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

### 4.2 Opinionated Template Setups (Documentation Patterns)

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


#### Template B — Production Microservice

Goals:

- Fully observable.
- Externalised state for cache/rate limiting.

Example characteristics:

- `createHttpClient` with:
  - Redis `HttpCache` implementation.
  - Redis‑backed `HttpRateLimiter`.
  - OTEL adapters wired to the existing `TracingAdapter` and `MetricsSink` interfaces.
- A `createPolicyInterceptor` configured with:
  - Per‑client budgets.
  - Per‑operation `ResilienceProfile` overrides.
- Logging adapter to something like pino/winston.


#### Template C — AI Agent / LLM Pipeline Client

Goals:

- Optimised for AI provider calls.
- Integration with agent frameworks.

Example characteristics:

- Same as Template B, plus:
  - `ErrorClassifier` tuned for LLM provider semantics (rate limits, safety blocks, quota, etc.).
  - Standard `extensions` usage:
    - `ai.provider`, `ai.model`, `ai.operation`, `ai.tenant`, `ai.tool`.
  - A small helper for building per‑request `ResilienceProfile` based on task type:
    - Interactive vs background vs batch.
- Plays nicely with `agent-conversation-core` and provider wrappers.

These templates live in docs/specs but dramatically lower activation energy for real‑world use.

---

## 5. Clarifying Metadata Semantics

To prevent drift and double‑tagging, add a dedicated section in the spec that defines metadata rules.

### 5.1 AgentContext

`AgentContext` should answer: **Who/what is making this call?**

- `agent`: name or identifier of the agent or service.
- `runId`: unique run or task ID.
- `labels`: stable, low‑cardinality properties (`"env": "prod"`, `"component": "billing-worker"`).
- `metadata`: additional structured info that is stable over the life of that agent run.

### 5.2 Extensions

`extensions` should answer: **What extra attributes does this specific request have that might affect policies or routing?**

Examples:

- AI provider: `ai.provider`, `ai.model`, `ai.operation`, `ai.tool`, `ai.tenant`.
- Tenanting: `tenant.id`, `tenant.tier`.
- Feature flags: `feature.experimentId`, `feature.variant`.

### 5.3 Telemetry Meta

Telemetry meta (for logging/metrics/tracing) should be **derived** from `AgentContext`, `extensions`, correlation IDs, and the final `RequestOutcome`.

- Logging meta: high‑level tags + error details.
- Metrics: status, latency, request volume, rate limit feedback.
- Tracing: span attributes mapping key metadata and correlation IDs.

Avoid introducing *new* semantic keys at the telemetry layer; that keeps semantics consistent across different observability backends.

---

## 6. Concrete Next Spec Steps (v0.7 → v1.0 Path)

To move toward a stable v1.0 that is attractive for both small teams and enterprises:

1. **Canonicalise Interceptors**
   - Declare `HttpRequestInterceptor` the official extension mechanism.
   - Implement `beforeRequest`/`afterResponse` as a compatibility layer, marked deprecated.

2. **Unify Resilience Layering**
   - Define `HttpClient` + `ResilienceProfile` as the single normative retry and backoff mechanism.
   - Mark `policyWrapper` as a legacy/advanced hook and discourage it for new implementations.

3. **Add Out‑of‑the‑Box Defaults**
   - Ship `createDefaultHttpClient` with no external dependencies and sane defaults.
   - Document Template A/B/C setups (small service, production, AI pipeline).

4. **Clarify Metadata Semantics**
   - Add explicit guidance for what belongs in `AgentContext`, `extensions`, and telemetry meta.
   - Publish a recommended key table for AI and multi‑tenant use cases.

5. **Introduce Idempotency Keys**
   - Add `idempotencyKey` to `HttpRequestOptions`.
   - Document how to implement idempotency via an interceptor.

6. **Lock In Core Contracts, Move Everything Else to Satellites**
   - Treat the following as the frozen core API surface:
     - `HttpClient`, `HttpRequestOptions`, `HttpResponse` shape (if defined), `HttpTransport`.
     - `AgentContext`, `ResilienceProfile`, `ErrorClassifier`, `RateLimitFeedback`, `RequestOutcome`.
     - `HttpRequestInterceptor`, `MetricsSink`, `Logger`, `TracingAdapter`.
   - Continue to refactor pagination, policies, telemetry adapters, agents, and guardrails into satellite libraries.

With these changes, `resilient-http-core` becomes a compact, stable, no‑deps HTTP resilience substrate that:

- Works out of the box in simple apps.
- Scales into a fully observable production layout.
- Is a natural base for AI agents and HTTP‑based provider SDKs.
- Avoids feature creep and ambiguity by pushing opinions into documented templates and satellites.

