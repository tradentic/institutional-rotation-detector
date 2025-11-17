# Resilient HTTP Core v0.8 — Alignment with v0.6 / v0.7 Critiques

This document gives a quick mapping between the major critique points raised in the
spec-evolution/critique docs for v0.6 and v0.7 and how the v0.8 spec responds.

It groups items as:
- **Fully addressed in v0.8**
- **Partially addressed in v0.8**
- **Intentionally deferred / still open for v0.9+ or v1.0**

## 1. Hook / Extension Model

### 1.1 Dual hook systems (beforeRequest/afterResponse vs interceptors)

**Critique (v0.6 & v0.7 docs)**
- Two overlapping extension systems caused confusion and potential double-handling.
- Recommendation: make interceptors canonical; treat old hooks as legacy.

**v0.8 response**
- **Fully addressed.**
- v0.8 removes legacy `beforeRequest` / `afterResponse` hooks from the core surface.
- `HttpRequestInterceptor` is the only extension mechanism documented.
- Any notion of legacy hooks is gone rather than shimmed.

## 2. Resilience Ownership & policyWrapper

### 2.1 Overlapping resilience layers

**Critique**
- `policyWrapper` plus built-in retries plus future policy engine created overlapping layers.

**v0.8 response**
- **Fully addressed.**
- `policyWrapper` is not present in v0.8 at all.
- HttpClient + `ResilienceProfile` is defined as the canonical retry/backoff/timeout layer.
- Policies only adjust `ResilienceProfile` and add delays/denies via an interceptor; they do not perform independent retries.

## 3. HttpRequestOptions “kitchen sink”

### 3.1 Overloaded options type

**Critique**
- Request options accumulated too many unrelated concerns.

**v0.8 response**
- **Mostly addressed.**
- v0.8 groups concerns more clearly:
  - URL/URL-parts.
  - `resilience` sub-object.
  - `cache` sub-object.
  - `correlation`, `agentContext`, `extensions`.
- Pagination and other domain-specific hints live entirely in satellites.

## 4. Metadata semantics (AgentContext, extensions, telemetry)

### 4.1 Double-tagging risk

**Critique**
- Unclear what belongs in AgentContext vs extensions vs telemetry meta.

**v0.8 response**
- **Fully addressed.**
- v0.8 explicitly defines semantics:
  - AgentContext = who/what (agent/run + stable labels).
  - Correlation = request/trace IDs.
  - Extensions = per-request metadata (AI, tenant, request class, etc.).
- Recommended key patterns for AI (ai.provider / ai.model / ai.operation / ai.tenant / ai.tool) are documented.

## 5. Missing / weak hooks & plugins

### 5.1 Auth, serialization, idempotency, concurrency

**Critique**
- Need clear places for auth, body serialization, idempotency and bulkheads to live, without bloating core.

**v0.8 response**
- **Partially addressed.**
- v0.8:
  - Reaffirms that these belong in interceptors / satellites, not core.
  - Mentions patterns for auth and serialization.
  - Adds an explicit `idempotencyKey` field in `HttpRequestOptions`, with a recommended interceptor pattern to map it to headers.
  - Concurrency is handled via policies (rate-limit + concurrency rules) in the policies satellite.
- A future version can still deepen guidance with concrete example interceptors.

## 6. Out-of-the-box experience & templates

### 6.1 Default client / stacks

**Critique**
- Need a true zero-deps, opinionated default client and a few stack templates.

**v0.8 response**
- **Mostly addressed for core; partially for stacks.**
- v0.8 defines `createDefaultHttpClient` with:
  - Fetch transport.
  - Default resilience profile + classifier.
  - No-op metrics/tracing, optional console logging.
  - Optional in-memory cache interface.
- Templates that wire multiple satellites together (e.g. a full agent runtime) are still mostly described at the level of satellites, not as one exported factory. Those remain good candidates for v0.9+.

## 7. Policies & classification

### 7.1 Standardised dimensions & minimal paths

**Critique**
- PolicyEngine is powerful but complex; need standard dimensions and simpler presets.

**v0.8 response**
- **Partially addressed.**
- v0.8 policies spec:
  - Calls out canonical dimensions: client, operation, agent/tenant, provider/model, request class.
  - Provides simple helpers like `createSimpleRateLimitPolicy` and `createSimpleConcurrencyPolicy`.
- A general `PolicyStore` abstraction for Redis/DB is still left as a future enhancement rather than fully specified.

## 8. Pagination

### 8.1 Legacy bleed-through & presets

**Critique**
- Legacy pagination hints in core could cause drift; need clearer presets.

**v0.8 response**
- **Fully addressed.**
- Core options have no pagination-related fields.
- Pagination satellite defines `paginate` / `paginateStream` and strategy helpers (`createOffsetLimitStrategy`, `createCursorStrategy`).

## 9. Conversation core & budgets

### 9.1 Streaming, history strategies, budgets

**Critique**
- Conversation engine needs better streaming support and history/budget strategies; coordination with policies is desirable.

**v0.8 response**
- **Partially addressed.**
- v0.8 conversation-core:
  - Defines streaming methods on the ConversationEngine.
  - Adds a pluggable HistoryBuilder abstraction (including a default “recent N turns” implementation).
- Unified budget objects shared with policies are still only roughly aligned conceptually; full type-level unification is deferred.

## 10. OpenAI client

### 10.1 Defaults, mapping, and provider adapter

**Critique**
- Need clear mapping to Responses API, streaming semantics, and a provider adapter for conversation-core.

**v0.8 response**
- **Fully addressed.**
- v0.8 http-llm-openai:
  - Specifies non-streaming + streaming interfaces.
  - Defines mapping from raw OpenAI responses into typed response objects.
  - Provides `createOpenAIProviderAdapter` for agent-conversation-core.

## 11. Browser guardrails

### 11.1 Default profiles and clarity vs policies

**Critique**
- Guardrails vs policies can be confusing; need default safe profiles.

**v0.8 response**
- **Mostly addressed.**
- v0.8 guardrails spec:
  - Defines an in-memory guardrail engine and interceptor.
  - Encourages default deny semantics.
  - Suggests typical default rule sets (read-only web, internal-API-only).
- A fully baked `createDefaultGuardrailInterceptor()` factory is conceptually described but can be elaborated more in a future DX-focused iteration.

## 12. Testability & transports

### 12.1 Recorded / test transports

**Critique**
- Need a clear pattern for test transports (record/replay) and deterministic IDs.

**v0.8 response**
- **Not fully addressed.**
- v0.8 continues to rely on the `HttpTransport` abstraction, which makes test transports possible, but it does not yet:
  - Standardise `createRecordingTransport` / `createReplayTransport`.
  - Define `createTestHttpClient()` with deterministic IDs.

These are good candidates for a dedicated testing satellite or a 0.9+ enhancement.

## 13. Templates & coding-agent quickstart

### 13.1 Unified stacks & agent quickstart

**Critique**
- Desire for `createDefaultAgentRuntime()` and a coding-agent-friendly quickstart that wires core + satellites.

**v0.8 response**
- **Partially addressed.**
- v0.8 puts all the necessary building blocks in place and describes how satellites should be wired, but stops short of defining a single exported runtime factory.
- A future iteration can introduce opinionated stacks (core-only, enterprise, agentic) and a dedicated coding-agent quickstart document.

## 14. Overall Summary

- The **highest-impact structural issues** from the v0.6 and v0.7 critiques are **fully addressed** in v0.8:
  - Single interceptor-based extension model.
  - Removal of `policyWrapper` and overlapping resilience layers.
  - Cleaned-up HttpRequestOptions with domain concerns pushed into satellites.
  - Clear semantics for AgentContext vs correlation vs extensions.
  - Stronger out-of-the-box default client for the core.

- Several **DX and ecosystem-level enhancements** are **partially addressed**:
  - Policies now have clearer dimensions and simple presets, but persistent stores remain an advanced topic.
  - Conversation-core and policies share compatible concepts but not a single unified budget type.
  - Guardrails, templates, and coding-agent runtimes are described conceptually but could ship more default factories.

- A few **testing-focused and convenience features** are **still open**:
  - Standard recording/replay transports.
  - Standard `createTestHttpClient()` helper.
  - Fully opinionated multi-satellite runtimes.

In short: v0.8 resolves nearly all of the **architectural and design-risk critiques** from the v0.6/v0.7 reviews and leaves mainly **DX, testing, and runtime-composition** improvements for a future iteration.

