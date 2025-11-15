# `@airnub/resilient-http-policies` — Spec v0.2

**Status:** Draft for implementation  \
**Previous:** v0.1  \
**Depends on:**
- `@tradentic/resilient-http-core` v0.6+
- (Optional) `@airnub/resilient-http-pagination` v0.2+

**Scope:** Policy and budget engine for HTTP requests built on `resilient-http-core`, with first-class support for AI/LLM-heavy systems and agent workloads.

v0.2 refines the initial v0.1 design to:

- Integrate tightly with **core v0.6** features: `ResilienceProfile`, `ErrorClassifier`, `RateLimitFeedback`, `RequestOutcome`, `HttpRequestInterceptor`, `AgentContext`, and `extensions`.
- Provide a **central policy engine** that can enforce:
  - Concurrency limits
  - Rate limits and budgets (request-based, optionally token-based via external estimators)
  - Priority and preemption between different classes of work
  - Fail-fast vs best-effort behaviours
- Remain **agnostic** about specific providers (OpenAI, Anthropic, etc.), while exposing conventional hooks to handle them cleanly.

The library is designed so that:

- It never directly talks to HTTP or LLM providers; it operates on **policy contexts** and is wired in via `HttpRequestInterceptor` and/or higher-level orchestration.
- It can be used in simple monolithic services as well as advanced agentic environments.

---

## 1. Goals

1. Provide a **configurable policy engine** that can:
   - Apply different policies by **scope** (per-client, per-operation, per-agent, per-provider/model, etc.).
   - Decide whether a request is allowed immediately, should be delayed, or must be denied.
   - Optionally adjust the `ResilienceProfile` used for the request (e.g., tightening timeouts for low-priority traffic).

2. Exploit **core v0.6 telemetry**:
   - Use `RateLimitFeedback` to adapt concurrency and delay decisions.
   - Use `RequestOutcome` to track SLOs and failure rates per policy.

3. Be **safe defaults but customizable**:
   - Provide simple in-memory implementations and useful defaults.
   - Allow plugging in alternative persistence layers (Redis, DB) and custom policy evaluators in future versions.

4. Fit naturally into AI / agent systems:
   - Policies can be defined per-agent (`AgentContext.agent`), per-run (`AgentContext.runId`), per-provider/model (via `extensions['ai.provider']`, `extensions['ai.model']`).
   - No hard-coded AI semantics in the library; AI awareness arises from how scopes and keys are mapped.

---

## 2. Non-goals

- The library does **not**:
  - Implement HTTP transport or direct LLM provider calls.
  - Store historical metrics or long-term analytics (this is for external observability systems).
  - Define conversation semantics (`response_id`, `previous_response_id`, etc.).
  - Replace core retry/backoff or error classification logic; instead, it **influences and constrains** how often requests run.

- It must not:
  - Directly depend on OTEL, any specific metrics system, or any particular configuration framework.

---

## 3. Conceptual Model

### 3.1 Policy Scope

A **policy** applies to a subset of requests identified by a `PolicyScope` — fields derived from `HttpRequestOptions`, `AgentContext`, and optional AI conventions in `extensions`.

```ts
export interface PolicyScope {
  /** Name of the HTTP client, typically from HttpClientConfig. */
  client?: string;

  /** Logical operation name, e.g. 'finra.getWeeklySummary', 'openai.chat.completions'. */
  operation?: string;

  /** Agent name, from AgentContext.agent. */
  agent?: string;

  /** Agent run identifier, from AgentContext.runId. */
  agentRunId?: string;

  /** Optional provider, e.g. from extensions['ai.provider']. */
  provider?: string;

  /** Optional model, e.g. from extensions['ai.model']. */
  model?: string;

  /**
   * Arbitrary bucket / tenant / environment key. Can be used for per-tenant
   * quotas or environment-level policies.
   */
  bucket?: string;
}
```

The `PolicyScope` is a **derived view** of the underlying request. A single request may match multiple policies (e.g., global, client-scoped, agent-scoped).

### 3.2 Request Class

To distinguish between different “classes” of work, define:

```ts
export type RequestClass = 'interactive' | 'background' | 'batch';
```

- `interactive`: user-facing, low-latency operations.
- `background`: non-user-facing but time-sensitive (e.g., scheduled jobs).
- `batch`: large offline jobs, allowed to be slower.

The request class can be inferred from `HttpRequestOptions.extensions['request.class']`, or explicitly configured per-policy.

### 3.3 Policy Key

Policies are internally keyed by a **policy key** (string), derived deterministically from `PolicyScope` and possibly `RequestClass`. For example:

```ts
// Example (implementation detail):
client=openai;operation=chat;provider=openai;model=gpt-5.1;class=interactive
```

The exact encoding is internal to the library but must be stable across runs.

---

## 4. Policy Configuration Types

### 4.1 Rate Limits & Budgets

The library supports **request-based** rate limits, with optional hooks for token-based limits via external estimators.

```ts
export interface PolicyRateLimit {
  /**
   * Maximum allowed requests in one interval for this policy key.
   * If omitted, no explicit request rate limit is enforced by this policy.
   */
  maxRequestsPerInterval?: number;

  /** Interval length in milliseconds for request-based rate limiting. */
  intervalMs?: number;

  /**
   * Maximum allowed logical "tokens" in one interval (optional). Tokens
   * are conceptually separate from HTTP requests (e.g. LLM tokens).
   * The policy engine does not know how to count tokens; it consumes values
   * supplied in PolicyRequestContext.
   */
  maxTokensPerInterval?: number;
}
```

### 4.2 Concurrency Limits

```ts
export interface PolicyConcurrencyLimit {
  /** Maximum number of in-flight requests for this policy key. */
  maxConcurrent?: number;
}
```

### 4.3 Resilience Hints

Policies can suggest overrides for `ResilienceProfile` to adjust how the core behaves.

```ts
export interface PolicyResilienceHints {
  /** Optional default ResilienceProfile to apply for matching requests. */
  defaultProfile?: ResilienceProfile;

  /**
   * Optional hard cap on maxEndToEndLatencyMs for this policy if not set
   * explicitly on the request.
   */
  maxEndToEndLatencyMsOverride?: number;

  /**
   * If true, lower-priority requests (e.g., background, batch) may be
   * forced to use failFast=true to reduce pressure.
   */
  enforceFailFastForLowPriority?: boolean;
}
```

### 4.4 PolicyDefinition

A single policy definition combines scope matching and controls.

```ts
export interface PolicyDefinition {
  /** Identifier for this policy, unique within the policy store. */
  id: string;

  /**
   * Optional scope filter. Omitted fields act as wildcards. For example,
   * a policy with only client='openai' applies to all operations for that client.
   */
  scope?: PolicyScope;

  /** Optional request class override for matching requests. */
  requestClass?: RequestClass;

  /** Rate limit configuration (optional). */
  rateLimit?: PolicyRateLimit;

  /** Concurrency limit configuration (optional). */
  concurrency?: PolicyConcurrencyLimit;

  /** Resilience hints (optional). */
  resilience?: PolicyResilienceHints;

  /**
   * Priority of this policy relative to others. Higher values are applied later
   * and can override lower-priority policies.
   */
  priority?: number;
}
```

Policies are applied in priority order; multiple matching policies can contribute constraints that are merged.

---

## 5. Policy Engine API

### 5.1 PolicyRequestContext

The policy engine evaluates requests based on a simplified context derived from core types.

```ts
export interface PolicyRequestContext {
  /** Scope derived from clientName, operation, AgentContext, extensions. */
  scope: PolicyScope;

  /** Request class for this call (interactive/background/batch). */
  requestClass?: RequestClass;

  /**
   * The underlying HTTP request options. Must not be mutated by the policy
   * engine, but can be referenced by custom user hooks.
   */
  request: HttpRequestOptions;

  /**
   * Optional estimated tokens for this call. For LLM APIs, callers can
   * provide prompt+completion token estimates.
   */
  estimatedTokens?: number;

  /**
   * Wall-clock timestamp (ms since epoch) at which the policy check occurs.
   */
  now: number;
}
```

### 5.2 PolicyDecision

The decision returned by the policy engine before a request is sent.

```ts
export type PolicyDecisionType = 'allow' | 'delay' | 'deny';

export interface PolicyDecision {
  /** allow, delay, or deny the request. */
  type: PolicyDecisionType;

  /**
   * If type === 'delay', the minimum delay in ms before this request
   * should be attempted. The caller may choose to wait longer.
   */
  delayMs?: number;

  /** Human-readable reason (for logging/debugging). */
  reason?: string;

  /** IDs of the policies that contributed to this decision. */
  policyIds: string[];

  /**
   * Optional ResilienceProfile overrides suggested by this decision.
   * The caller is responsible for merging this with the request's existing
   * ResilienceProfile.
   */
  resilienceOverrides?: ResilienceProfile;
}
```

### 5.3 PolicyResultContext

After a request finishes (success or failure), the policy engine receives a result context.

```ts
export interface PolicyResultContext {
  /** Same scope as in PolicyRequestContext. */
  scope: PolicyScope;

  /** Same request class as earlier. */
  requestClass?: RequestClass;

  /** Original request options. */
  request: HttpRequestOptions;

  /** Decision returned earlier (for correlation). */
  decision: PolicyDecision;

  /**
   * Outcome at the HTTP level, if available. Typically derived from
   * core's RequestOutcome or recomputed by the caller.
   */
  outcome?: RequestOutcome;

  /** Latest rate-limit feedback, if available for this call. */
  rateLimit?: RateLimitFeedback;

  /** Timestamp when the request finished. */
  finishedAt: number;
}
```

### 5.4 PolicyEngine Interface

```ts
export interface PolicyEngine {
  /**
   * Evaluate policy constraints before a request is sent.
   * The engine may update internal counters (e.g., reserved concurrency slots).
   */
  evaluate(ctx: PolicyRequestContext): Promise<PolicyDecision>;

  /**
   * Notify the engine of the result of a request so it can update counters,
   * sliding windows, error rates, etc.
   */
  onResult(ctx: PolicyResultContext): Promise<void>;
}
```

The library should provide an **in-memory** implementation, `InMemoryPolicyEngine`, suitable for single-process deployments, with a design that can later be extended to distributed backends.

---

## 6. Integration with `resilient-http-core` v0.6

### 6.1 Policy-aware HttpRequestInterceptor

To connect policies to actual HTTP calls, the library provides a helper to create a `HttpRequestInterceptor` for core v0.6:

```ts
export interface PolicyInterceptorConfig {
  /** The policy engine to use. */
  engine: PolicyEngine;

  /**
   * Map from HttpRequestOptions to PolicyScope. If not provided, use a
   * default mapping based on clientName, operation, AgentContext, and
   * extensions.
   */
  scopeMapper?: (opts: HttpRequestOptions, clientName?: string) => PolicyScope;

  /**
   * Optional function to compute estimatedTokens for PolicyRequestContext
   * from the HttpRequestOptions (e.g., by inspecting AI request bodies).
   */
  tokenEstimator?: (opts: HttpRequestOptions) => number | undefined;

  /**
   * Optional function to infer RequestClass from the request.
   */
  requestClassResolver?: (opts: HttpRequestOptions) => RequestClass | undefined;
}

export function createPolicyInterceptor(
  config: PolicyInterceptorConfig
): HttpRequestInterceptor;
```

#### 6.1.1 beforeSend behaviour

In `beforeSend`:

1. Derive `PolicyScope` via `scopeMapper` or default mapping:
   - `client`: from `HttpClient` clientName (passed in via closure when interceptor is created) or `extensions['client']`.
   - `operation`: from `opts.operation`.
   - `agent`: from `opts.agentContext?.agent`.
   - `agentRunId`: from `opts.agentContext?.runId`.
   - `provider`: from `opts.extensions?.['ai.provider']` (if present).
   - `model`: from `opts.extensions?.['ai.model']` (if present).

2. Resolve `RequestClass` via `requestClassResolver` or default logic (e.g., extensions or operation naming).

3. Build `PolicyRequestContext` and call `engine.evaluate(ctx)`.

4. Interpret `PolicyDecision`:
   - If `type === 'deny'`: throw a `PolicyDeniedError` (custom error type) to prevent the request from being sent.
   - If `type === 'delay'` and `delayMs > 0`:
     - Await a delay (capped by any request-level `ResilienceProfile` budgets where necessary).
   - If `resilienceOverrides` is present:
     - Merge into `opts.resilience`, with `resilienceOverrides` winning on conflict.

5. Return the possibly updated `HttpRequestOptions`.

#### 6.1.2 afterResponse / onError behaviour

- `afterResponse`:
  - Construct `PolicyResultContext` with:
    - The same `PolicyScope` and `RequestClass` used in `beforeSend`.
    - The original `PolicyDecision`.
    - A request-level `RequestOutcome` computed from status and timestamps (if available).
    - Optional `RateLimitFeedback` extracted from response headers.
  - Call `engine.onResult(ctx)`.
  - Return the (possibly unchanged) `Response`.

- `onError`:
  - Similar to `afterResponse`, except:
    - `outcome.ok = false`.
    - `outcome.status` may be undefined.
    - `errorCategory` may be set to `'unknown'` or a category derived by the caller from classified errors.
  - Call `engine.onResult(ctx)`.

> Note: The interceptor must **not** swallow errors or modify the response in ways that surprise callers; its job is to update the policy engine.

### 6.2 Interaction with ResilienceProfile

- When a policy suggests `resilienceOverrides`, the interceptor merges it with `opts.resilience` before passing options to the core.
- Policies can enforce stronger or weaker resilience constraints based on:
  - Request class
  - Scope (e.g., provider/model)
  - Current load/quotas

However, core v0.6 semantics still govern how `ResilienceProfile` is actually applied.

### 6.3 Interaction with RateLimitFeedback & RequestOutcome

- The interceptor may implement minimal header parsing to extract rate-limit information and populate `RateLimitFeedback` in `PolicyResultContext`.
- `RequestOutcome` at this layer can be a simplified version (e.g., based on final status and attempts) until tighter integration with core metrics is implemented.
- The policy engine may use these fields to:
  - Reduce concurrency or increase delays when close to provider limits.
  - Mark certain policies as degraded or temporarily paused.

---

## 7. In-Memory PolicyEngine Behaviour (v0.2)

### 7.1 Internal State

`InMemoryPolicyEngine` should maintain:

- A collection of `PolicyDefinition`s.
- Per-policy-key:
  - Sliding window counters for request-based rate limits.
  - Optional token counters (if `estimatedTokens` is supplied).
  - Current in-flight count for concurrency limits.

A simple, time-bucketed sliding window is sufficient for v0.2.

### 7.2 evaluate()

When `evaluate()` is called:

1. Determine all policies whose `scope` matches `ctx.scope`.
2. Merge their constraints in order of ascending `priority`, with later policies overriding earlier ones in case of conflict.
3. Compute a `PolicyDecision` based on:
   - Current window counts vs `maxRequestsPerInterval` / `maxTokensPerInterval`.
   - Current in-flight count vs `maxConcurrent`.
   - Available budgets and `ctx.estimatedTokens`.
4. If limits are exceeded:
   - Decide between `delay` and `deny` based on configuration (v0.2 may default to `delay` with a minimal wait, or `deny` if the overshoot is severe).
5. Attach any `resilienceOverrides` derived from `PolicyResilienceHints`.

### 7.3 onResult()

When `onResult()` is called:

1. Update sliding window counters:
   - Increment the request count for the applicable interval.
   - Increment consumed tokens if provided in `PolicyRequestContext` / `PolicyResultContext`.
2. Decrement in-flight concurrency count for this policy key (if it was incremented in `evaluate`).
3. Optionally track short-term error rates per policy:
   - e.g., count of `outcome.ok === false` over the last N seconds.
4. Optionally adapt future behaviour:
   - For example, if error rates are high, it may begin recommending `resilienceOverrides.failFast = true` for background traffic.

v0.2 should keep this adaptation simple and well-documented, leaving more advanced behaviours to future versions.

---

## 8. Testing & Validation

The implementation should include tests that cover:

1. **Scope matching & priority**:
   - Multiple policies matching the same request, with different priorities.
   - Ensuring higher-priority policies override lower-priority ones.

2. **Rate limiting**:
   - `maxRequestsPerInterval` enforcement.
   - Requests being delayed or denied when limits are exceeded.

3. **Concurrency limits**:
   - In-flight request counts and release on completion.
   - Deny or delay when `maxConcurrent` is reached.

4. **Resilience overrides**:
   - Policies injecting `ResilienceProfile` hints and being merged into the request.

5. **Interceptor integration**:
   - `beforeSend` calling `evaluate` and respecting `allow/delay/deny` decisions.
   - `afterResponse` and `onError` calling `onResult` with appropriate contexts.

6. **AI-related scopes (via extensions)**:
   - Policies scoped by `provider` and/or `model` using `extensions['ai.provider']` and `extensions['ai.model']`.

7. **Basic behaviour under load**:
   - Simulated bursts of requests to verify the policy engine throttles as expected.

---

## 9. Future Extensions (Beyond v0.2)

- Distributed policy engines using Redis or other backends.
- Richer token accounting integrated with LLM-specific tooling (e.g. actual token counts from providers).
- Dynamic policy reconfiguration at runtime (e.g., via an admin API).
- More advanced adaptive algorithms that set or adjust `ResilienceProfile` and concurrency based on error and latency trends.

v0.2 focuses on providing a solid, composable basis for all of these while integrating cleanly with `@tradentic/resilient-http-core` v0.6 and remaining provider-agnostic.

