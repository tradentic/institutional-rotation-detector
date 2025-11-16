# Resilient HTTP Core Spec – Evolution & Critique (v0.1 → v0.7)

This document captures how the Resilient HTTP Core spec and its satellite libraries have evolved from v0.1 to v0.7, and critiques the design with a view toward a future v0.8 / v1.0 that is:

- Boring, stable, small-core.
- Truly zero-external-deps by default.
- First-class for AI/agent workloads.
- Attractive to both small teams and large enterprises.

---

## 1. Big Picture

### 1.1 Core trajectory

Rough arc:

- **v0.1–v0.2:** A monorepo HTTP engine for rotation-detector: retries, backoff, timeouts, cache, rate limiting, circuit breaker, logging/metrics, policy wrapper.
- **v0.3–v0.4:** Generalisation: base URL resolver, pre/post hooks, pagination helper, and the first `AgentContext` + `extensions` story.
- **v0.5–v0.6:** Consolidation: separate agent identity from HTTP correlation, add resilience profiles, error classification, rate-limit feedback, request outcomes, and an interceptor chain.
- **v0.7:** Stabilisation: a single self-contained spec under `@airnub`, with a clear small core, interceptor layering, URL and correlation semantics, and satellites for anything that moves faster (pagination, policies, AI/LLM, guardrails, telemetry).

### 1.2 Satellite trajectory

Satellites emerged as you pulled specialised concerns out of the core:

- **Policies:** from a cockatiel wrapper to a dedicated policy engine + interceptor.
- **Pagination:** from ad-hoc helpers inside core to a strategy-based paginator package.
- **Agent conversation core:** from vaguely HTTP-coupled adapters to a clean conversation model above any transport.
- **HTTP LLM OpenAI:** a provider wrapper that plugs core HttpClient into conversation-core.
- **Browser guardrails:** an interceptor-oriented guardrail layer for agent browsing and tools.

The big architectural move is correct: a small, stable core with satellites handling providers, policies, guardrails, and AI specifics.

---

## 2. Core Evolution (v0.1 → v0.7)

### 2.1 v0.1–v0.2 – Monorepo engine, early resilience

**Key moves:**

- A `HttpClient` abstraction shared across rotation-detector clients (SEC, FINRA, IEX, OpenAI, etc.).
- Features: URL building and query encoding, retries with exponential backoff, timeouts via AbortController, optional caching, rate limiting, circuit breaking, logging, and metrics.
- A `policyWrapper` hook that allowed wrapping the whole request in an external policy layer.
- Early agent-/AI-friendly hooks for budgets and error classification.

**Pros:**

- Clear responsibilities: transport + resilience + telemetry.
- Fetch-first but transport-pluggable.
- Recognises that AI/agent workloads need budgets and error classification early on.

**Cons / risks:**

- `policyWrapper` is vague and overlaps later with interceptors and policies.
- No clear separation yet between HTTP correlation and agent identity.
- Caching, rate limiting, and CB are only interfaces; out-of-box experience is still "no cache, no RL, no CB" unless you bring implementations.

---

### 2.2 v0.3–v0.4 – Hooks, pagination helper, first AgentContext

**Key moves:**

- Adds `resolveBaseUrl` to support multi-host APIs.
- Introduces `beforeRequest` / `afterResponse` hooks, and operation-level defaults.
- Extracts pagination into a helper based on `HttpClient`.
- Introduces `AgentContext` with correlation-centric fields and an `extensions` bag.
- Guarantees propagation of `parentCorrelationId` wherever `correlationId` goes.

**Pros:**

- Pagination is pulled out of the core request path and made into a helper layer.
- `resolveBaseUrl` is a useful pattern for complex providers.
- `AgentContext` + `extensions` is the first clear attempt to separate HTTP from higher-level agent metadata.

**Cons / risks:**

- `AgentContext` mixes HTTP trace concerns (correlation IDs) with agent identity and attributes.
- `extensions` and `AgentContext.attributes` act as overlapping "bags of stuff".
- Pre/post hooks add another extension mechanism alongside `policyWrapper`.

---

### 2.3 v0.5 – Clean split: Agent identity vs HTTP correlation

**Key moves:**

- Redefines `AgentContext` around agent identity and runs (agent name, runId, labels, metadata).
- Moves `correlationId`, `parentCorrelationId`, and `requestId` into `HttpRequestOptions` and telemetry types.
- Keeps `extensions` as the canonical per-request metadata bag.
- Positions the core explicitly as a stable foundation for satellites.

**Pros:**

- Much cleaner separation of concerns:
  - Agent identity and run-level attributes → `AgentContext`.
  - HTTP traceability → correlation IDs on the request/response/metrics types.
  - Per-request metadata → `extensions`.
- Makes it easier to write satellite libraries (conversation, policies, LLMs) without polluting core types.

**Cons / risks:**

- Migration burden: older `AgentContext` semantics now diverge from the new shape.
- `AgentContext.metadata` vs `extensions` is still a double-bag problem without clear rules.

---

### 2.4 v0.6 – ResilienceProfile, ErrorClassifier, interceptors

**Key moves:**

- Introduces `ResilienceProfile`:
  - Priority, maximum end-to-end latency, max attempts, fail-fast/failover hints.
- Adds `ErrorCategory`, `ErrorClassifier`, and `ClassifiedError`.
- Adds telemetry: `RequestOutcome`, `RateLimitFeedback`.
- Defines `HttpRequestInterceptor` with `beforeSend`, `afterResponse`, `onError`.
- Documents conventions for AI metadata in `extensions` (`ai.provider`, `ai.model`, etc.).

**Pros:**

- Strong pivot towards AI/agent workloads while staying provider-agnostic.
- `ResilienceProfile` gives a declarative way to express budgets and behaviour per request.
- `ErrorClassifier` + `RequestOutcome` + `RateLimitFeedback` provide a solid telemetry basis.
- Interceptors become a flexible, composable extension surface.

**Cons / risks:**

- Concept overlap with earlier `responseClassifier` hooks and policy layers.
- Interceptor semantics (ordering, propagation of modified options, interactions with retries) must be nailed down in implementation.
- Streaming and long-running operations are not yet clearly defined in terms of `ResilienceProfile`.

---

### 2.5 v0.7 – Consolidation under @airnub, small core + satellites

**Key moves:**

- Rebrands as `@airnub/resilient-http-core` and consolidates prior versions into a single self-contained spec.
- Clarifies goals: small, boring, provider-agnostic core with no external deps by default.
- Introduces `UrlParts` as a first-class way to build URLs.
- Canonicalises `CorrelationInfo` with a required `requestId` and optional `correlationId`/`parentCorrelationId`.
- Tightens `ErrorCategory` and `ErrorClassifier` semantics.
- Formalises budgets and `ResilienceProfile`/request-budget interaction.
- Clarifies interceptor contracts and marks legacy pagination fields as deprecated in favour of a dedicated pagination satellite.
- Roadmap explicitly defines satellites and the ecosystem around core.

**Pros:**

- A single, coherent spec replaces a stack of incremental documents.
- `UrlParts` and `CorrelationInfo` reduce footguns around URL building and traceability.
- Pagination and policies are clearly pushed into satellites.
- Versioning and stable surfaces are defined.

**Cons / risks:**

- The spec is large and can be intimidating for newcomers.
- Some legacy concepts (old hooks, legacy pagination knobs, older classifier ideas) still linger in backcompat sections.

---

## 3. Satellite Evolution & Critique

### 3.1 Policies (resilient-http-policies)

**Evolution:**

- v0.1: Essentially a wrapper around cockatiel policies; maps core `RequestOutcome` into retry/concurrency decisions.
- v0.2: Introduces a clearer `PolicyDefinition` and `PolicyEngine` shape with categories (rate limit, concurrency, etc.).
- v0.3: Fully embraces interceptor integration, with `createPolicyInterceptor` that:
  - Evaluates `PolicyDecision` (allow, delay, deny).
  - Applies `resilienceOverride` to the core `ResilienceProfile`.
  - Feeds actual outcomes back into the policy engine.

**Strengths:**

- Clean separation: core defines telemetry; policies interpret it.
- `PolicyEngine` + interceptor gives a natural extension point for enterprise and multi-tenant setups.
- In-memory engine by default keeps zero-deps story.

**Risks / issues:**

- Overlap between `ResilienceProfile` (declared budgets) and policy decisions (enforced budgets) can become confusing.
- Without clear canonical dimensions (e.g. agent, operation, request class, tenant, provider/model), different apps might define incompatible policy keys.

**Recommendations:**

- Treat `ResilienceProfile` as a declarative input and policies as the canonical decision-maker.
- Define a standard set of dimensions for policies (agent, operation, request.class, ai.provider, ai.model, tenant) and use them consistently.
- Prepare a `PolicyStore` abstraction for future Redis/DB-backed engines.

---

### 3.2 Pagination (resilient-http-pagination)

**Evolution:**

- v0.1/v0.2: Pagination helpers live near the core; essentially follow-your-nose iterators based on next/offset parameters.
- v0.3: Pagination is redesigned around:
  - `PaginationStrategy` describing how to extract next token/offset and page size.
  - `PageResult` describing page payload + metadata.
  - helpers like `paginate` and `paginateStream` that orchestrate multiple `HttpClient` calls.

**Strengths:**

- Moves pagination out of core and into its own satellite.
- Strategy pattern makes the paginator generic across providers.
- Streaming helpers are a natural fit for ETL and big-result workloads.

**Risks / issues:**

- Legacy pagination fields on `HttpRequestOptions` can continue to be used by new code if not clearly deprecated.
- There’s a risk of reintroducing ad-hoc pagination logic in clients instead of using the satellite.

**Recommendations:**

- Mark legacy pagination fields in core types as deprecated at the type level.
- Provide before/after examples in docs to show migration to `resilient-http-pagination`.

---

### 3.3 Agent Conversation Core (agent-conversation-core)

**Evolution:**

- v0.1:
  - Conversation modelling is tightly coupled to `@tradentic/resilient-http-core` v0.6.
  - Defines `Conversation`, `Turn`, and provider adapters (`sendChat`, `streamChat`).
  - Uses HTTP-level thinking in some types (e.g. provider call records with HTTP-like structure).
- v0.2:
  - Rebased on `@airnub/resilient-http-core` v0.7 types; core is now transport-agnostic.
  - Defines clear domain types: `Conversation`, `ConversationMessage`, `ConversationTurn`, `TokenUsage`, `ProviderAdapter`, `ConversationStore`, `HistoryBuilder`.
  - Supports streaming via `StreamingTurn` and `StreamingTurnEvent`.
  - HTTP is just one possible transport; the core only knows about `AgentContext` and `extensions`.

**Strengths:**

- Provides a clean, provider-agnostic conversation model that can sit above any HTTP/GRPC/WebSocket layer.
- Integrates naturally with core through `AgentContext` + `extensions`.
- Streaming turns and token usage tracking align well with real-world LLM usage.

**Risks / issues:**

- Budgets exist in both conversation (token/turn limits) and policy world (rate/concurrency) but are not yet unified.
- Without clear guidance, different projects may implement their own history/budget strategies.

**Recommendations:**

- Introduce a shared `BudgetUsage` / `BudgetDimension` base type to be used by both conversation and policies.
- Provide a `createDefaultConversationEngine` that wires in an in-memory store and a basic history builder.

---

### 3.4 HTTP LLM OpenAI (http-llm-openai)

**Current shape (v0.2):**

- Uses `HttpClient` from core as its only transport dependency.
- Provides typed wrappers around OpenAI Responses API.
- Exposes an OpenAI provider adapter compatible with `agent-conversation-core`.
- Can either accept an injected `HttpClient` or create a default one with opinionated settings.

**Strengths:**

- Clean example of how to build a provider library on top of core.
- Good bridge between HTTP core and conversation core: provider adapter is first-class.
- Ready to serve as the default building block for AI agent templates.

**Risks / issues:**

- Needs to be kept in lockstep with OpenAI API changes and new model features.
- If too much logic creeps into this package, it can start to feel like a monolith (fine-tuning, files, assistants, etc.).

**Recommendations:**

- Keep OpenAI-specific complexity here, not in conversation-core.
- Provide a `createDefaultOpenAIChatAgent` helper that wires HttpClient + provider adapter + conversation engine for the common path.

---

### 3.5 Browser Guardrails (agent-browser-guardrails)

**Current shape (v0.2+ roadmap):**

- Interceptor-based guardrails that:
  - Enforce host/method/protocol allowlists.
  - Apply payload and response size limits.
  - Strip sensitive headers.
- Designed to work alongside policies rather than replacing them.

**Strengths:**

- Clean separation between structural safety (guardrails) and dynamic budgets (policies).
- Naturally integrated via interceptors.
- A good fit for agent tool calling and browsing use cases.

**Risks / issues:**

- Without sensible defaults, users may misconfigure guardrails or skip them entirely.
- There is a risk of duplication between host allowlists in guardrails and policy rules.

**Recommendations:**

- Provide `createDefaultGuardrailInterceptor` with safe defaults (GET/HEAD only, restricted hosts, auth header stripping, size limits).
- Document clearly how guardrails differ from policies and how to use them together.

---

## 4. Design Strengths

1. **Small core, rich satellites:** By v0.7 the architecture really is "small, boring core" plus satellites for policies, pagination, conversation, providers, guardrails, and telemetry.

2. **Agent and AI friendly without provider lock-in:** Core never mentions conversations or providers explicitly, but `AgentContext`, `extensions`, and resilience telemetry give you everything you need to hang AI/agent behaviour off the HTTP layer.

3. **Single interceptor surface:** `HttpRequestInterceptor` gives a consistent way to implement cross-cutting concerns (policies, guardrails, logging, test harnesses) without changing core.

4. **Zero external deps by default:** Both core and satellites are designed to work in-process (in-memory caches, in-memory policies/stores) with optional Redis/OTEL/DB layers.

5. **Stable surfaces and spec-first thinking:** Explicit definitions of which types are stable, plus spec-driven development, make this attractive to teams that care about long-term compatibility.

---

## 5. Design Risks & Smells

### 5.1 Concept and knob overlap

There are multiple overlapping concept layers:

- Core: `ResilienceProfile`, `ErrorClassifier`, `RequestOutcome`, `RateLimitFeedback`.
- Policies: `PolicyDefinition`, `PolicyDecision`, `resilienceOverride`.
- Earlier remnants: `responseClassifier`, `policyWrapper`, pre/post hooks.

Risk:

- Confusion about who really decides retry, timeout, and concurrency behavior.
- Potential for double retry or conflicting decisions.

**Mitigation:**

- Define clear ownership: policies make decisions; `ResilienceProfile` expresses intended budgets; core enforces the final shape after policy overrides.
- Deprecate or adapt older concepts into the interceptor/policy model.

---

### 5.2 Hook surface sprawl and legacy hooks

You currently have:

- Legacy `policyWrapper`.
- Legacy `beforeRequest` / `afterResponse` hooks.
- The modern `HttpRequestInterceptor` chain.

Risk:

- Users and future maintainers might not know which one to use, or how they interact.

**Mitigation:**

- Officially declare interceptors as the sole modern extension surface.
- Provide shims that wrap old hooks into interceptors and mark the old hooks as deprecated.

---

### 5.3 Ambiguous placement of metadata

You have three places for metadata:

- `AgentContext.metadata` (run-level data).
- `extensions` (per-request metadata).
- Headers (protocol-level data, sometimes duplicated).

Risk:

- The same concept (tenant, environment, request class) gets stored in multiple places.

**Mitigation:**

- Document clear scoping rules:
  - Agent-run / workflow → `AgentContext.labels` and `AgentContext.metadata`.
  - Per-request, infra/AI metadata → `extensions` with namespaced keys (e.g. `ai.*`, `tenant.*`).
  - Protocol-level behaviour → headers.
- Provide helpers to build canonical `extensions` for AI requests.

---

### 5.4 Streaming and long-running operations

The current resilience model is tailored to classic request/response, but AI workloads frequently use streaming and long-running operations.

Risk:

- Unclear semantics around `maxEndToEndLatencyMs` for streaming operations.
- Developers may bypass core resilience features to support streams.

**Mitigation:**

- Introduce a streaming mode or sub-profile:
  - Distinguish connect timeout vs stream idle timeout.
  - Document recommended patterns for streams (e.g. `requestStream` helper built on `requestRaw`).

---

### 5.5 Pagination legacy and future drift

There are still legacy pagination fields in core, while the canonical paginator lives in a satellite.

Risk:

- New code continues to use legacy fields, undermining the paginator satellite.

**Mitigation:**

- Mark these fields as deprecated at the type level.
- Provide migration examples to `resilient-http-pagination`.

---

### 5.6 Namespace / version drift

Some older specs and code are under `@tradentic`, while newer work is under `@airnub`.

Risk:

- Confusion for new users about which package is canonical.

**Mitigation:**

- Clearly state in README/specs that `@airnub/resilient-http-core` v0.7+ is canonical and `@tradentic` is legacy.
- Provide a short migration guide mapping old types/packages to new ones.

---

## 6. Missing Hooks & Extensibility Points

### 6.1 Testability and recorded transports

There is no explicit, blessed story for testing yet.

**Needed:**

- A formal `HttpTransport` abstraction with test-friendly implementations:
  - `InMemoryTransport`.
  - `RecordingTransport` / `ReplayingTransport`.
- A `createTestHttpClient` helper that:
  - Disables retries by default.
  - Uses deterministic IDs.
  - Records requests/responses.

---

### 6.2 Persistence plugin patterns

Policies and conversations both need persistence for serious deployments.

**Needed:**

- A consistent pattern for plugging in persistence:
  - `createRedisPolicyEngine(redisClient, options)`.
  - `createRedisConversationStore(redisClient, options)`.
- These do not need a shared implementation, but should share naming and config conventions.

---

### 6.3 Unified budget concepts

Budgets appear in multiple places:

- Conversation (token budgets, history length).
- Policies (rate, concurrency, quotas).

**Needed:**

- A small shared vocabulary: `BudgetDimension` / `BudgetUsage` types.
- The ability for policy engine and conversation engine to exchange budget usage in a consistent way.

---

## 7. Out-of-the-Box, Zero-Deps Story

You explicitly want:

- Zero external deps by default.
- Opinionated template setups for both services and AI agents.

### 7.1 What is already in place

- Core and satellites can all run in-memory.
- In-memory policy engine exists.
- In-memory conversation store exists.
- http-llm-openai can create its own default client.

### 7.2 Proposed template setups

#### Template A – Core-only microservice

- `createDefaultHttpClient()`:
  - Fetch-based transport.
  - Simple retry strategy (e.g. 3 attempts for transient errors).
  - Basic timeouts.
  - Console logger.
  - No policy engine, no external deps.
- Example: call a generic REST API, observe correlation IDs and basic logs.

#### Template B – Enterprise service with policies & telemetry

- `createEnterpriseHttpClient()` composing:
  - `createDefaultHttpClient()`.
  - `createPolicyInterceptor()` with `InMemoryPolicyEngine` by default.
  - Optional telemetry interceptor integrating with OTEL/logging.
- Example: define per-agent, per-operation rate limits and see them enforced.

#### Template C – AI agent pipeline

- `createDefaultAgentRuntime()` composing:
  - A `HttpClient` from Templates A/B.
  - `http-llm-openai` provider wrapper.
  - `agent-conversation-core` with in-memory store and history builder.
  - `agent-browser-guardrails` interceptor for tool/browsing calls.
- Example: create an agent runtime, start conversations, run turns, and yet stay zero-deps.

---

## 8. Recommendations for v0.8 / v1.0

This section translates the critique into concrete steps.

### 8.1 Core

1. **Lock in the interceptor model**
   - Deprecate legacy hooks (`beforeRequest`, `afterResponse`, `policyWrapper`).
   - Provide adapter helpers to wrap legacy hooks as interceptors.
   - Document interceptor ordering and error propagation rules.

2. **Clarify ownership of resilience decisions**
   - Let policies and interceptors be the actual decision-makers for retries, backoff, concurrency, and timeouts.
   - Keep `ResilienceProfile` as declarative intent that can be overridden.

3. **Add a "Minimal Core Quickstart"**
   - A one-page guide showing how to use `createDefaultHttpClient()` in a small service.

4. **Define streaming semantics**
   - Add a streaming flag/sub-profile.
   - Clarify how budgets and timeouts apply to streaming vs non-streaming requests.

### 8.2 Policies

5. **Standardise policy dimensions**
   - Decide on a canonical set of classification fields (agent, operation, request.class, tenant, ai.provider, ai.model) and bake them into docs and examples.

6. **Introduce a PolicyStore abstraction**
   - Prepare for Redis/DB-backed engines with a standard storage interface.

### 8.3 Agent Conversation & OpenAI

7. **Create default conversation engine/setup**
   - `createDefaultConversationEngine()` with an in-memory store and simple history builder.

8. **Create default OpenAI chat agent**
   - `createDefaultOpenAIChatAgent()` that wires HttpClient + OpenAI provider adapter + conversation engine.

9. **Start unifying budgets**
   - Add shared budget types used by both conversation and policies.

### 8.4 Browser Guardrails

10. **Ship a default guardrail interceptor**
    - Safe defaults: allow GET/HEAD, restricted host allowlist, strip auth headers except for configured hosts, size limits.

11. **Document guardrails vs policies**
    - Make it crystal-clear when to use guardrails, when to use policies, and how they complement each other.

### 8.5 Templates & Developer Experience

12. **Implement template helpers**
    - `createDefaultHttpClient`, `createEnterpriseHttpClient`, `createDefaultAgentRuntime` in code, each with examples.

13. **Create a "coding agent quickstart" doc**
    - A doc written for coding agents and humans that explains:
      - The minimal core types.
      - How to use HttpClient to wrap any API.
      - How to plug in policy, pagination, conversation, and provider packages.

---

## 9. Closing

By v0.7, the Resilient HTTP ecosystem has evolved from a monorepo helper into a credible small-core + satellites platform. The major architectural decisions are sound. The work for v0.8 / v1.0 is largely about:

- Simplifying and unifying concepts (classification, hooks, budgets).
- Tightening the story around who owns resilience decisions.
- Delivering true out-of-the-box experiences and template setups.

Executed well, this becomes not just a reusable HTTP client, but a default backbone for resilient AI-enabled applications and workflows, for both humans and AI coding agents.

