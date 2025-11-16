# CODING_AGENT_PROMPT.md — `@airnub/resilient-http-policies` v0.3

## 0. Role & Context

You are a **senior TypeScript engineer**. Your task is to implement or align `@airnub/resilient-http-policies` with its v0.3 spec, so it can apply **rate limits, concurrency limits, and resilience overrides** around `@airnub/resilient-http-core`.

This package must be completely decoupled from core, using only public types and an interceptor.

---

## 1. Source of Truth

Use this spec as authoritative:

- `docs/specs/resilient_http_policies_spec_v_0_3.md`

If code disagrees with the spec, the spec wins.

---

## 2. Global Constraints

- TypeScript with `strict: true`.
- No direct network calls.
- No required external storage (Redis, DB, etc.) — in-memory engine first.
- No modifications to `@airnub/resilient-http-core`.

---

## 3. Tasks

### 3.1 Core Types & Engine Interface

Implement or align these types exactly as per the spec:

- `RequestClass` — `'interactive' | 'background' | 'batch'`.
- `PolicyScope` — derived from `HttpRequestOptions`, `AgentContext`, `extensions`.
- `ScopeSelector` — configuration for matching scopes (client, operation, method, requestClass, ai.provider/model/tool, tenant, etc.).
- `PolicyDefinition` — includes:
  - `key`, `priority`.
  - `rateLimit?: RateLimitRule`.
  - `concurrency?: ConcurrencyRule`.
  - `resilienceOverride?: ResilienceOverride`.
  - Queueing / failure mode settings (e.g. `failOpen`/`failClosed`).
- `PolicyDecision` — `'allow' | 'delay' | 'deny'` + `delayBeforeSendMs` + `resilienceOverride`.
- `PolicyOutcome` — includes policy key, delayMs, bucket keys, etc.
- `PolicyEngine` interface — `evaluate()` + `onResult()`.

### 3.2 In-Memory Policy Engine

Implement `createInMemoryPolicyEngine(config)` as in the spec:

- Holds `PolicyDefinition[]`.
- Evaluates `PolicyScope` against definitions using `ScopeSelector` semantics.
- Tracks per-bucket:
  - Sliding-window request counts for rate limits.
  - In-flight counts for concurrency.
- Produces `PolicyDecision` with `allow`/`delay`/`deny` and resilience overrides.
- Exposes `onResult` to update internal counters based on `RequestOutcome` and `RateLimitFeedback`.

Add helper factories:

- `createBasicRateLimitPolicy(...)`.
- `createBasicConcurrencyPolicy(...)`.
- `createBasicInMemoryPolicyEngine(...)`.

### 3.3 HTTP Interceptor

Implement `createPolicyInterceptor(options)` that returns a `HttpRequestInterceptor` compatible with `@airnub/resilient-http-core`:

- In `beforeSend`:
  - Derive `PolicyScope` from `HttpRequestOptions`, `AgentContext`, and `extensions`.
  - Call `engine.evaluate(scope)`.
  - If decision is `deny`, throw a well-typed error (e.g. `PolicyDeniedError`).
  - If `delay`, await the specified delay.
  - Merge `resilienceOverride` into `request.resilience`.

- In `afterResponse` / `onError`:
  - Build a `PolicyOutcome` from the decision + `RequestOutcome`.
  - Call `engine.onResult(...)`.

Ensure this interceptor does **not** own retries or low-level resilience (core handles that).

---

## 4. Tests

Create tests that verify:

- Scope matching and precedence (priority wins).
- Rate limiting behaviour:
  - Requests allowed until the window is full.
  - Subsequent requests delayed or denied according to policy.
- Concurrency limits:
  - Only `maxConcurrent` requests in-flight per bucket.
  - Additional requests delayed/denied as configured.
- Fail-open vs fail-closed options when the engine itself errors.
- Correct propagation of `resilienceOverride` into `HttpRequestOptions.resilience`.

Use fake time (e.g., Jest fake timers) and a fake `HttpClient` to keep tests deterministic.

---

## 5. Acceptance Criteria

- Public types and functions match `resilient_http_policies_spec_v_0_3.md`.
- Policies are enforced purely via interceptors; core is unchanged.
- In-memory engine works for single-process usage and is covered by tests.
- Example configuration exists (in tests or docs) for limiting requests per client/provider/model.

