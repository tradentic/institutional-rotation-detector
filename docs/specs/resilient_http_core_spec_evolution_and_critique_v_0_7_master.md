# Resilient HTTP Core — Master Evolution & Critique (v0.1 → v0.7)

> This master document merges:
>
> - The **ADR-style v0.6 → v0.7 audit** (did v0.7 fix the v0.6 issues?).
> - The broader **ecosystem evolution & design critique** (core + satellites + roadmap).
>
> It is intended as a single source of truth for humans and coding agents reviewing the
> `@airnub/resilient-http-core` v0.7 spec and designing v0.8 / v1.0.

---

## 1. Context & Goals

### 1.1 Original intent of the core

The Resilient HTTP Core was always meant to be:

- A **boring, reusable HTTP substrate** for all clients.
- The central place for **resilience**: timeouts, retries, backoff, rate limiting, circuit breaking.
- A host for **telemetry hooks**: logging, metrics, tracing (without hard dependencies).
- A carrier of rich **metadata for AI/agents**: correlation IDs, agent context, extensions.

By v0.6, the spec and implementation were powerful but had accumulated design debt around:

- Multiple overlapping hook systems.
- Overlapping resilience layers (`policyWrapper` vs built-in retries/budgets).
- `HttpRequestOptions` being a “kitchen sink”.
- Fragmented metadata (correlation vs agent vs extensions).
- Fuzzy extensibility for policies & providers.
- Ambiguous metrics & rate-limit semantics.
- Pagination/domain concerns leaking into core.

v0.7 is an explicit attempt to:

- Cleanly fix the v0.6 issues.
- Stabilise the core under `@airnub`.
- Provide a solid base for an ecosystem of satellite libraries.

### 1.2 Goals for v0.8 / v1.0

Looking forward, the desired properties are:

- **Small, stable core**: minimal surface, hard guarantees.
- **Zero external deps by default**: in-memory, fetch-based out-of-the-box.
- **First-class for AI/agents**: budgets, metadata, guardrails, conversation layers.
- **Enterprise-ready**: policies, telemetry, testability, multi-tenant friendliness.

This document evaluates v0.7 and sketches the changes needed to get there.

---

## 2. Core Evolution (v0.1 → v0.7)

### 2.1 v0.1–v0.2 — Monorepo engine, early resilience

**Key moves**

- Introduced a `HttpClient` abstraction shared across rotation-detector clients (SEC, FINRA, IEX, OpenAI, etc.).
- Implemented URL building + query encoding, retries with exponential backoff, timeouts via `AbortController`, optional caching, rate limiting, circuit breaking, logging, and metrics.
- Added a generic `policyWrapper` hook to wrap the entire request execution.
- Started adding AI/agent-adjacent hooks (budgets, early error classification).

**Pros**

- Clear responsibilities: transport + resilience + telemetry.
- Fetch-first but transport-pluggable via adapters.
- Recognises early that AI/agent workloads need budgets and classification.

**Cons / risks**

- `policyWrapper` is vague and later conflicts with interceptor/policy designs.
- No clear separation between HTTP correlation and agent identity.
- Caching, rate limiting, CB are only interfaces; out-of-box experience is still “no cache, no RL, no CB” unless implementations are provided.

---

### 2.2 v0.3–v0.4 — Hooks, pagination helper, first AgentContext

**Key moves**

- Added `resolveBaseUrl` for multi-host APIs.
- Introduced config-level `beforeRequest` / `afterResponse` hooks and operation defaults.
- Extracted pagination into a helper built on `HttpClient`.
- Introduced `AgentContext` (correlation-focused) and an `extensions` bag.
- Guaranteed `parentCorrelationId` propagation wherever `correlationId` is used.

**Pros**

- Pulls pagination out of the core request path.
- `resolveBaseUrl` generalises URL handling.
- `AgentContext` + `extensions` starts a separation between HTTP and agent metadata.

**Cons / risks**

- `AgentContext` mixes correlation IDs (HTTP concerns) with agent identity.
- `extensions` vs `AgentContext.attributes` creates overlapping “bags of stuff”.
- Pre/post hooks add yet another extension surface alongside `policyWrapper`.

---

### 2.3 v0.5 — Clean split: agent identity vs HTTP correlation

**Key moves**

- Redefined `AgentContext` around **agent identity and runs**:
  - `agent`, `runId`, `labels`, `metadata`.
- Moved `correlationId`, `parentCorrelationId`, `requestId` into `HttpRequestOptions` + telemetry types.
- Kept `extensions` as the canonical per-request metadata bag.
- Explicitly positioned core as a stable foundation for satellites.

**Pros**

- Much cleaner separation of concerns:
  - Agent identity/run → `AgentContext`.
  - HTTP traceability → correlation IDs.
  - Per-request metadata → `extensions`.
- Makes satellite libraries (conversation, policies, LLMs) easier to design.

**Cons / risks**

- Migration burden for projects using the old `AgentContext` semantics.
- `AgentContext.metadata` vs `extensions` still needs clear guidance.

---

### 2.4 v0.6 — ResilienceProfile, ErrorClassifier, interceptors

**Key moves**

- Introduced `ResilienceProfile` with:
  - Priority, `maxAttempts`, `retryEnabled`, `maxEndToEndLatencyMs`, fail-fast/failover hints.
- Added `ErrorCategory`, `ErrorClassifier`, `ClassifiedError`.
- Added telemetry types: `RequestOutcome`, `RateLimitFeedback`.
- Defined `HttpRequestInterceptor` with `beforeSend`, `afterResponse`, `onError`.
- Documented conventions for AI metadata in `extensions` (`ai.provider`, `ai.model`, `ai.operation`, etc.).

**Pros**

- Strong pivot towards AI/agent workloads while staying provider-agnostic.
- Declarative resilience via `ResilienceProfile`.
- `ErrorClassifier` + `RequestOutcome` + `RateLimitFeedback` give a solid telemetry base.
- Interceptors provide a flexible cross-cutting hook.

**Cons / risks**

- Overlap with older `responseClassifier` hooks and early policy layers.
- Interceptor semantics (ordering, retry interaction, error propagation) must be carefully defined.
- Streaming and long-running operations are not yet explicitly modelled.

---

### 2.5 v0.7 — Consolidation under @airnub, small core + satellites

**Key moves**

- Rebranded as `@airnub/resilient-http-core` and consolidated all prior spec changes into a single self-contained v0.7 spec.
- Clarified goals: small, boring, provider-agnostic core with no external deps by default.
- Introduced `UrlParts` as a first-class URL builder.
- Canonicalised `CorrelationInfo` with a required `requestId` and optional `correlationId` / `parentCorrelationId`.
- Tightened `ErrorCategory` / `ErrorClassifier` semantics and naming.
- Formalised budgets and interaction between `ResilienceProfile` and request-level deadlines.
- Clarified interceptor contracts; marked legacy pagination fields as deprecated in favour of a pagination satellite.
- Published a roadmap defining the satellite ecosystem (policies, pagination, conversation-core, OpenAI, browser guardrails, telemetry adapters).

**Pros**

- A single coherent spec replaces incremental stacks.
- `UrlParts` + `CorrelationInfo` reduce URL and traceability footguns.
- Pagination and policies are cleanly pushed into satellites.
- Stable surfaces and versioning are defined.

**Cons / risks**

- The spec is long and can be intimidating for newcomers.
- Some legacy concepts still appear in compatibility sections.

---

## 3. v0.6 → v0.7 Audit: Did v0.7 Fix the Issues?

This section preserves the ADR-style evaluation of whether v0.7 addresses the v0.6 critique.

### 3.1 Hooks & Interceptors

**v0.6 problem**

- Two overlapping hook systems:
  - Config-level `beforeRequest` / `afterResponse`.
  - `HttpRequestInterceptor` chain.
- Unclear ordering and responsibilities; risk of some paths bypassing interceptors.

**v0.7 design**

- Interceptors are canonical:
  - `HttpClient` maintains `interceptors: HttpRequestInterceptor[]`.
  - Executes `beforeSend` in registration order, `afterResponse`/`onError` in reverse order.
- Legacy hooks are adapted into a single “bridge” interceptor via `buildLegacyInterceptor(config)`.

**Evaluation**

- Ambiguity and duplication have been removed:
  - Single extension pipeline.
  - Legacy hooks implemented on top of interceptors.

**Status:** ✅ **Issue addressed**.

**Follow-up:** v0.7 spec/docs should mark the old hooks as *legacy* and recommend interceptors for all new code.

---

### 3.2 Resilience Layer & `policyWrapper`

**v0.6 problem**

- Local retries/backoff/timeout in `HttpClient`.
- `policyWrapper` capable of its own retries/budgets.
- Separate `budget` object and resilience hints.
- Easy to end up with double retries and conflicting time budgets.

**v0.7 design**

- `policyWrapper` removed from core.
- Single `ResilienceProfile` governs retries and timeouts:
  - `maxAttempts`, `retryEnabled`, `perAttemptTimeoutMs`, `overallTimeoutMs`, etc.
- Retry loop reads `ResilienceProfile` once per request.
- Rate limiter and circuit breaker are advisory hooks only (no retries/budget ownership).

**Evaluation**

- Overlapping resilience layers are collapsed into a single model.
- Higher-level policy engines live outside core as interceptors/satellites.

**Status:** ✅ **Issue addressed**.

---

### 3.3 `HttpRequestOptions` shape

**v0.6 problem**

- `HttpRequestOptions` mixed URL building, resilience knobs, metadata, backups, pagination hints, and domain-specific concerns.

**v0.7 design**

- URL handling structured as:
  - `url` (fully resolved) or
  - `urlParts` (`baseUrl`, `path`, `query`), merged with client baseUrl.
- Resilience encapsulated in `resilience?: ResilienceProfile`.
- Metadata structured as:
  - `correlation?: CorrelationInfo`.
  - `agentContext?: AgentContext`.
  - `extensions?: Record<string, unknown>`.
- Pagination/domain concerns removed from core options.

**Evaluation**

- Still rich, but now coherent and better factored.

**Status:** ✅ **Issue mostly addressed**.

Remaining risk is future drift: maintain discipline to keep domain-specific knobs out of core options.

---

### 3.4 Metadata: Correlation, AgentContext, Extensions

**v0.6 problem**

- Metadata spread across:
  - Request fields (`requestId`, `correlationId`).
  - `AgentContext` (agent, run, labels, metadata).
  - `extensions` (free-form tags).
- No clear guidance on what belongs where.

**v0.7 design**

- `correlation?: CorrelationInfo` (trace & causality) with required `requestId`.
- `agentContext?: AgentContext` (agent identity + run-level context).
- `extensions?: Record<string, unknown>` (per-request tags).
- Metrics receive a consolidated `MetricsRequestInfo` object bundling all of the above.

**Evaluation**

- Roles are clearly separated:
  - Correlation → tracing.
  - AgentContext → actor/agent.
  - Extensions → domain labels (AI provider, model, tenant, request class, etc.).

**Status:** ✅ **Issue addressed**.

---

### 3.5 Policies & `policyWrapper`

**v0.6 problem**

- `policyWrapper` overlapped with built-in resilience and was too powerful/ambiguous.

**v0.7 design**

- `policyWrapper` removed from core.
- Policies implemented as interceptors via `@airnub/resilient-http-policies`:
  - `PolicyEngine` + `createPolicyInterceptor` adjusting `resilience` and injecting delays/denies.

**Evaluation**

- Policies are cleanly separated from core; core remains a pure HTTP+resilience engine.

**Status:** ✅ **Issue addressed**.

---

### 3.6 Metrics & Rate-Limit Semantics

**v0.6 problem**

- Ambiguity between metrics “per attempt” vs “per request”.
- `RateLimitFeedback` and header parsing mixed core with provider-specific behaviour.

**v0.7 design**

- Metrics are per logical **request**:
  - One `RequestOutcome` per request capturing attempts and duration.
- `recordMetrics()` called once, summarising attempts.
- `RateLimitFeedback` is an optional structured field, fed by classifiers or provider wrappers.

**Evaluation**

- Semantics are now clear and provider-agnostic.

**Status:** ✅ **Issue addressed**.

---

### 3.7 Interceptors as plugin mechanism

**v0.6 problem**

- Interceptors existed but competed with config hooks and `policyWrapper`.

**v0.7 design**

- Interceptors are the primary extension mechanism.
- Satellites (policies, guardrails, telemetry, caching) plug in exclusively via interceptors.

**Evaluation**

- Extension story is much clearer and easier to reason about.

**Status:** ✅ **Issue addressed**.

---

### 3.8 Out-of-the-box stacks

**Goal**

- Provide default client factories and template stacks (e.g. core-only, enterprise with policies, AI agent pipeline).

**v0.7 status**

- Design is ready; interceptors + typed config make this straightforward.
- Concrete helpers like `createDefaultHttpClient` / `createEnterpriseHttpClient` / `createDefaultAgentRuntime` are not yet implemented as stable APIs.

**Evaluation**

- Structurally unblocked but not yet realised.

**Status:** ⚠️ **Partially addressed**.

---

### 3.9 Caching, UUIDs, Metrics Format — Migration Notes

v0.7 introduces intentional behaviour changes:

- `ErrorCategory` names changed (older snake_case vs newer camelCase-like).
- Core caching integration removed/moved; caching to be defined via interceptors/satellites.
- `ensureCorrelation()` uses `crypto.randomUUID()` → runtime assumptions.
- `MetricsRequestInfo` shape changed → adapters need migration.

These are not flaws, but require explicit migration docs.

---

## 4. Satellite Evolution & Critique

### 4.1 Policies (`@airnub/resilient-http-policies`)

**Evolution**

- v0.1: Thin wrapper around cockatiel, mapping `RequestOutcome` to retry/concurrency decisions.
- v0.2: Introduces `PolicyDefinition` / `PolicyEngine`, policy categories (rate-limit, concurrency, etc.).
- v0.3: Embraces interceptors:
  - `createPolicyInterceptor` calling `PolicyEngine.evaluate()` to produce `PolicyDecision`.
  - Applies `resilienceOverride` to requests.
  - Feeds results back into the engine.

**Strengths**

- Clean separation: core emits telemetry; policies interpret and enforce.
- In-memory engine keeps zero-deps story.
- Natural fit for multi-tenant, per-agent, per-operation budgeting.

**Risks / issues**

- Overlap between `ResilienceProfile` (declared intent) and policy decisions (enforced budgets) can be confusing.
- Without canonical dimensions (e.g. agent, operation, request class, tenant, provider/model), teams might invent incompatible key schemes.

**Recommendations**

- Treat `ResilienceProfile` as declarative; `PolicyEngine` as the canonical decision-maker.
- Standardise policy dimensions (agent, operation, request.class, tenant, ai.provider, ai.model) and use them consistently.
- Introduce a `PolicyStore` abstraction for Redis/DB-backed engines.

---

### 4.2 Pagination (`@airnub/resilient-http-pagination`)

**Evolution**

- Early: pagination helpers near core; ad-hoc, provider-specific.
- v0.3: Strategy-based design:
  - `PaginationStrategy` (how to extract next token/offset + size).
  - `PageResult` (payload + metadata).
  - `paginate` / `paginateStream` orchestrating multiple `HttpClient` calls.

**Strengths**

- Properly separated from core.
- Strategy pattern makes it reusable across providers.
- Streaming helpers suit ETL / large result sets.

**Risks / issues**

- Legacy pagination fields on core types might still tempt new code.

**Recommendations**

- Type-level deprecation on legacy pagination fields.
- Before/after examples showing how to migrate to `resilient-http-pagination`.

---

### 4.3 Agent Conversation Core (`@airnub/agent-conversation-core`)

**Evolution**

- v0.1: Conversation model coupled to `@tradentic/resilient-http-core` v0.6; provider adapters with HTTP-flavoured call records.
- v0.2:
  - Rebased on `@airnub/resilient-http-core` v0.7, transport-agnostic.
  - Domain types: `Conversation`, `ConversationMessage`, `ConversationTurn`, `TokenUsage`, `ProviderAdapter`, `ConversationStore`, `HistoryBuilder`.
  - Streaming support via `StreamingTurn` / `StreamingTurnEvent`.
  - Uses only `AgentContext` + `extensions` from core, not `HttpClient` directly.

**Strengths**

- Clean, provider-agnostic conversation layer above any transport.
- Integrates naturally with core metadata.
- Streaming support and token accounting align with real LLM usage.

**Risks / issues**

- Budgets (token/turn vs rate/concurrency) not yet unified with policies.
- History/budget strategies may be reinvented across projects.

**Recommendations**

- Introduce shared `BudgetDimension` / `BudgetUsage` base types used by both conversation and policies.
- Provide `createDefaultConversationEngine()` using in-memory store and a simple history builder.

---

### 4.4 HTTP LLM OpenAI (`@airnub/http-llm-openai`)

**Current shape (v0.2)**

- Wraps OpenAI Responses API using `HttpClient` from core.
- Provides typed models and an OpenAI provider adapter for `agent-conversation-core`.
- Can take an injected `HttpClient` or create a default with opinionated settings.

**Strengths**

- Good example of a provider library built on core.
- Strong bridge between HTTP core and conversation core.
- Ready building block for AI agent templates.

**Risks / issues**

- Must track OpenAI API evolution.
- Risk of sliding into “do everything” monolith (fine-tuning, files, assistants) if not scoped.

**Recommendations**

- Keep OpenAI-specific complexity here, not in conversation core.
- Provide `createDefaultOpenAIChatAgent()` wiring HttpClient + provider adapter + conversation engine for the common path.

---

### 4.5 Browser Guardrails (`@airnub/agent-browser-guardrails`)

**Current shape (v0.2+ roadmap)**

- Interceptor-based guardrails that:
  - Enforce host/method/protocol allowlists.
  - Apply payload/response size limits.
  - Strip sensitive headers.
- Designed to complement, not replace, policies.

**Strengths**

- Clean separation: structural safety (guardrails) vs dynamic budgets (policies).
- Natural fit for agent tool/browse use-cases.

**Risks / issues**

- Without defaults, users might omit or misconfigure guardrails.
- Possible duplication between host allowlists in guardrails vs policy rules.

**Recommendations**

- Provide `createDefaultGuardrailInterceptor()` with safe defaults (GET/HEAD only, restricted hosts, auth header stripping, size limits).
- Document clearly how guardrails and policies differ and how to use them together.

---

## 5. Design Strengths

1. **Small core, rich satellites**
   - By v0.7, the architecture is genuinely “small, boring core” plus satellite libraries for policies, pagination, conversation, providers, guardrails, telemetry.

2. **Agent & AI friendly, provider-agnostic**
   - Core never mentions conversations or providers directly, but `AgentContext`, `extensions`, and resilience telemetry are enough to support rich AI/agent behaviour.

3. **Single interceptor surface**
   - `HttpRequestInterceptor` is the primary way to implement cross-cutting concerns (policies, guardrails, logging, test harnesses, caching integrations) without changing core.

4. **Zero external deps by default**
   - Core and satellites can all run with in-memory implementations.
   - Redis/OTEL/DB can be adopted later via satellite-specific hooks.

5. **Spec-first, stable surfaces**
   - Explicitly documented stable types and versioning make the ecosystem attractive for long-lived projects.

---

## 6. Design Risks & Smells

### 6.1 Concept & knob overlap

- Multiple layers influence resilience and classification:
  - Core: `ResilienceProfile`, `ErrorClassifier`, `RequestOutcome`, `RateLimitFeedback`.
  - Policies: `PolicyDefinition`, `PolicyDecision`, `resilienceOverride`.
  - Legacy remnants: `responseClassifier`, old hooks.

**Risk**

- Confusion over who truly decides retries, timeouts, concurrency.
- Potential double retries or contradictory behaviour.

**Mitigation**

- Clearly define ownership:
  - `ResilienceProfile` = declarative intent.
  - Policies/interceptors = final decision-makers.
- Deprecate or adapt older concepts (`responseClassifier`, legacy hooks) into the interceptor/policy model.

---

### 6.2 Hook surface sprawl & legacy hooks

- Legacy `policyWrapper`, `beforeRequest`, `afterResponse` coexist with interceptors.

**Risk**

- Confusion about which mechanism to use and how they interact.

**Mitigation**

- Officially declare interceptors as the only modern extension surface.
- Provide shims to wrap legacy hooks as interceptors and mark them deprecated.

---

### 6.3 Ambiguous metadata placement

- Three places for metadata:
  - `AgentContext.metadata`.
  - `extensions`.
  - Headers.

**Risk**

- Same concept (tenant, environment, request class) spread across multiple locations.

**Mitigation**

- Document scoping rules:
  - Agent-run/workflow → `AgentContext.labels`/`metadata`.
  - Per-request infra/AI metadata → `extensions` (namespaced keys like `ai.*`, `tenant.*`).
  - Protocol behaviour → headers.
- Provide helpers to build canonical `extensions` for AI requests.

---

### 6.4 Streaming & long-running operations

- Resilience model is tuned for request/response.

**Risk**

- Unclear how `maxEndToEndLatencyMs` interacts with streaming.
- Developers may bypass core to implement streaming.

**Mitigation**

- Introduce a streaming mode or sub-profile:
  - Distinguish connect timeout vs stream idle timeout.
  - Provide a `requestStream` helper or recommended pattern using `requestRaw`.

---

### 6.5 Pagination legacy & drift

- Legacy pagination fields can still exist in core types.

**Risk**

- New code may keep using them instead of the pagination satellite.

**Mitigation**

- Mark them as deprecated at type level and in docs.
- Provide migration examples to `resilient-http-pagination`.

---

### 6.6 Namespace / version drift (@tradentic vs @airnub)

- Old specs/packages under `@tradentic`, new under `@airnub`.

**Risk**

- Confusion about which package is canonical.

**Mitigation**

- Clearly mark `@airnub/resilient-http-core` v0.7+ as canonical; `@tradentic` as legacy.
- Provide a short migration guide mapping old types/packages to new.

---

## 7. Missing Hooks & Extensibility

### 7.1 Testability & recorded transports

**Need**

- Formal `HttpTransport` abstraction with test transports (in-memory, recording, replaying).
- `createTestHttpClient()` helper that disables retries, uses deterministic IDs, and records requests/responses.

### 7.2 Persistence plugin patterns

**Need**

- Consistent patterns for storage-backed implementations:
  - `createRedisPolicyEngine(redisClient, options)`.
  - `createRedisConversationStore(redisClient, options)`.
- Shared naming and config conventions, even if implementations live in different packages.

### 7.3 Unified budget concepts

**Need**

- Shared vocabulary for budgets across policies and conversation:
  - `BudgetDimension`, `BudgetUsage`.
- Allow policy engine and conversation engine to coordinate on quotas (requests, tokens, cost).

---

## 8. Out-of-the-Box, Zero-Deps Story

### 8.1 Current state

- Core and satellites can all be used in-memory.
- In-memory policy engine and conversation store exist.
- `http-llm-openai` can build its own default HttpClient.
- But there is no single, canonical “just give me a client/agent runtime” entry point.

### 8.2 Proposed template setups

#### Template A — Core-only microservice

- `createDefaultHttpClient()`:
  - Fetch-based transport.
  - Simple retry strategy (e.g. 3 attempts for transient errors).
  - Basic timeouts.
  - Console logger.
  - No policy engine, no external deps.
- Docs: example calling a generic REST API with correlation IDs and logs.

#### Template B — Enterprise service with policies & telemetry

- `createEnterpriseHttpClient()` composing:
  - `createDefaultHttpClient()`.
  - `createPolicyInterceptor()` with `InMemoryPolicyEngine` by default.
  - Optional telemetry interceptor for OTEL/logging.
- Docs: examples of per-agent, per-operation rate limits and basic dashboards.

#### Template C — AI agent pipeline

- `createDefaultAgentRuntime()` composing:
  - HttpClient from Templates A/B.
  - `http-llm-openai` provider wrapper.
  - `agent-conversation-core` with in-memory store + history builder.
  - `agent-browser-guardrails` interceptor for tool/browse calls.
- Docs: examples of starting a conversation, running turns, and enforcing guardrails.

---

## 9. Migration & Compatibility Notes (v0.6 → v0.7)

Key changes that require explicit migration:

1. **ErrorCategory naming**
   - Old snake_case → new camelCase-like names.
   - Downstream match logic needs updating.

2. **Caching**
   - v0.6 had built-in caching in `requestJson`.
   - v0.7 core de-emphasises built-in caching; caching is now expected to be interceptor/satellite-driven.
   - Decision: document that caching is out-of-core, or reintroduce a small, interceptor-based default.

3. **UUID generation / runtime assumptions**
   - `ensureCorrelation()` uses `crypto.randomUUID()`.
   - Requires modern Node/browsers, or a user-supplied `requestIdFactory`.

4. **Metrics shape**
   - `MetricsRequestInfo` has changed; adapters must be updated.

5. **Legacy hooks**
   - `beforeRequest` / `afterResponse` are still present but should be treated as legacy.
   - New features should rely on interceptors.

---

## 10. Recommendations for v0.8 / v1.0

### 10.1 Core

1. **Lock in interceptors**
   - Deprecate legacy hooks (`beforeRequest`, `afterResponse`, `policyWrapper`).
   - Provide adapters to wrap them as interceptors for backcompat.
   - Document interceptor ordering and error propagation rules explicitly.

2. **Clarify resilience ownership**
   - Let policies/interceptors own retry/backoff/concurrency decisions.
   - Keep `ResilienceProfile` as declarative intent.

3. **Streaming semantics**
   - Add streaming flags/sub-profiles.
   - Define how connect vs stream idle timeouts work.
   - Provide a recommended streaming helper.

4. **Minimal core quickstart**
   - Publish a short “Core Quickstart” doc using `createDefaultHttpClient()`.

### 10.2 Policies

5. **Standardise classification dimensions**
   - Canonical fields: agent, operation, request.class, tenant, ai.provider, ai.model.
   - Use them in examples and default engines.

6. **PolicyStore abstraction**
   - Define an interface for persistent policy engines (Redis/DB), even if only in docs at first.

### 10.3 Agent Conversation & OpenAI

7. **Default conversation engine**
   - Implement `createDefaultConversationEngine()` with in-memory store + history builder.

8. **Default OpenAI chat agent**
   - Implement `createDefaultOpenAIChatAgent()` wiring HttpClient + OpenAI provider + conversation engine.

9. **Unified budgets**
   - Introduce shared budget types used by both conversation and policies.

### 10.4 Browser Guardrails

10. **Default guardrail interceptor**
    - Implement `createDefaultGuardrailInterceptor()` with safe defaults.

11. **Guardrails vs policies docs**
    - Add a clear comparison and usage guide.

### 10.5 Templates & Developer Experience

12. **Template helpers**
    - Implement `createDefaultHttpClient`, `createEnterpriseHttpClient`, `createDefaultAgentRuntime` in code, with tested examples.

13. **Coding agent quickstart**
    - A doc for human and AI agents explaining:
      - Minimal core types.
      - How to wrap APIs using HttpClient.
      - How to plug in policies, pagination, conversation, OpenAI, and guardrails.

---

## 11. Closing

By v0.7, the Resilient HTTP ecosystem has evolved from a monorepo helper into a credible small-core + satellites platform. The major architectural decisions are sound, and the v0.7 design effectively fixes the v0.6 issues while providing a solid base for satellites.

The work for v0.8 / v1.0 is less about fundamental redesign and more about:

- Simplifying and unifying overlapping concepts (classification, hooks, budgets).
- Tightening the story around who owns resilience decisions.
- Filling in missing hooks for testing, persistence, and streaming.
- Delivering true out-of-the-box, zero-deps experiences and template setups.

Executed well, this will turn `@airnub/resilient-http-core` + satellites into a default backbone for resilient, AI-enabled applications and workflows — suitable for both enterprises and AI coding agents that want an out-of-the-box resilient HTTP pipeline.

