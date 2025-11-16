# CODING_AGENT_PROMPT.md — `@airnub/resilient-http-policies` v0.3

## 0. Role & Scope

You are a **senior TypeScript engineer** working in the `tradentic/institutional-rotation-detector` monorepo.

Your job in this prompt is **only** to implement and align the package:

> `@airnub/resilient-http-policies`

with its v0.3 spec, built on top of **`@airnub/resilient-http-core` v0.7**.

Do not modify other packages except for minimal type/import fixes.

---

## 1. Source of Truth

Treat these documents as the **source of truth** for this package:

- Core v0.7 spec:
  - `docs/specs/resilient_http_core_spec_v_0_7.md`
- Policies v0.3 spec:
  - `docs/specs/resilient_http_policies_spec_v_0_3.md`

If code and docs disagree, **the docs win**.

---

## 2. Global Constraints

- Language: **TypeScript** with `strict: true`.
- Depends on `@airnub/resilient-http-core` types and interceptor interfaces.
- Must not:
  - Implement its own HTTP transport.
  - Pull in heavy resilience/telemetry frameworks.
  - Embed FINRA/SEC/UW/OpenAI-specific policies — all domain-specific usage should live in consumers.

---

## 3. Implementation Tasks

### 3.1 Core Concepts & Types

Implement all types defined in `resilient_http_policies_spec_v_0_3.md`, including:

- Policy scoping & classification:
  - `PolicyScope` (fields for client, operation, agent, runId, provider, model, bucket, etc.).
  - `RequestClass` (e.g., `'interactive' | 'background' | 'batch'`).
- Limits & hints:
  - `PolicyRateLimit` (max requests/tokens per interval).
  - `PolicyConcurrencyLimit` (max concurrent requests).
  - `PolicyResilienceHints` (overrides/guidance for `ResilienceProfile`).
  - `PolicyDefinition` (combining the above with priority).
- Flow types:
  - `PolicyRequestContext` (what the engine sees before a request).
  - `PolicyDecision` (`'allow' | 'delay' | 'deny'` + delayMs + resilienceOverrides).
  - `PolicyResultContext` (outcome, including `RequestOutcome` and `RateLimitFeedback`).
- Engine interface:
  - `PolicyEngine` with `evaluate()` and `onResult()`.

Export all public types from this package’s barrel file.

### 3.2 In-Memory Policy Engine

Implement an `InMemoryPolicyEngine` that satisfies `PolicyEngine`:

- Stores `PolicyDefinition`s keyed by some combination of `PolicyScope` dimensions.
- Computes sliding-window rate limits per key.
- Tracks in-flight request counts for concurrency limits.
- Supports different priority or specificity rules when multiple policies match.
- Computes `PolicyDecision` with:
  - `allow`: request may proceed now.
  - `delay`: caller must wait `delayMs` before sending.
  - `deny`: request is rejected (caller should fail fast).

`InMemoryPolicyEngine` is single-process only; future engines (Redis/distributed) can reuse the same interface.

### 3.3 Policy-Aware Interceptor

Implement `createPolicyInterceptor(config: PolicyInterceptorConfig): HttpRequestInterceptor` using the v0.7 interceptor types from core:

- `beforeSend`:
  - Derive a `PolicyScope` from `ctx.request`:
    - `client` (from `HttpClientConfig.clientName`, passed via config or extensions).
    - `operation` from `ctx.request.operation`.
    - `agent`, `runId` from `ctx.request.agentContext`.
    - AI fields from `ctx.request.extensions` (e.g., `ai.provider`, `ai.model`).
    - Any bucket/tenant from `extensions`/headers as per spec.
  - Build a `PolicyRequestContext` and call `engine.evaluate()`.
  - Enforce the decision:
    - `allow`: proceed.
    - `delay`: `await` a `sleep(decision.delayMs)` before proceeding.
    - `deny`: throw a descriptive error (include scope + rule info).
  - If `resilienceOverrides` is set, merge them into `ctx.request.resilience` following the core-v0.7 merging rules.

- `afterResponse` / `onError`:
  - Build a `PolicyResultContext` with:
    - The final `RequestOutcome` (if available) or derive an outcome approximation from status/category.
    - Any `RateLimitFeedback` attached in `extensions` or from response headers.
  - Call `engine.onResult()` so the engine can update its internal stats (sliding windows, error rates, concurrency).

Ensure the interceptor is compatible with core v0.7’s `HttpRequestInterceptor` shape.

### 3.4 Configuration & Matching

- Implement a small matching layer that maps a `PolicyScope` to applicable `PolicyDefinition`s.
- Allow matching by:
  - Exact values (e.g., `client === 'finra'`, `provider === 'openai'`).
  - Wildcards/suffix matches where required by the spec.
- When multiple policies match, apply precedence rules defined in the spec (e.g., most specific wins, or highest priority field).

---

## 4. Tests

Add tests under this package to cover:

- Rate-limiting behaviour:
  - Requests allowed under limit.
  - Requests delayed when near/exceeding limit.
  - Requests denied when clearly over limit.
- Concurrency limits:
  - Max concurrent enforced per policy key.
- Policy scoping & matching:
  - Correct matching by client, operation, provider, model, bucket, etc.
- Resilience overrides:
  - Interceptor merges `resilienceOverrides` into `HttpRequestOptions` correctly.
- Integration with core v0.7 interceptors:
  - Use a fake `HttpClient` + `HttpRequestInterceptor` chain to validate that decisions are respected.

---

## 5. Done Definition

You are **done** for this prompt when:

- The package compiles and exports all types/APIs required by `resilient_http_policies_spec_v_0_3.md`.
- The `InMemoryPolicyEngine` behaves correctly under unit tests.
- `createPolicyInterceptor` integrates cleanly with core v0.7’s `HttpRequestInterceptor` and respects `ResilienceProfile`.
- No HTTP transports, heavy resilience libs, or telemetry frameworks are added here.

Do not modify other packages beyond necessary types/imports.

