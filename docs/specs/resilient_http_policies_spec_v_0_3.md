# Resilient HTTP Policies — Specification v0.3.0

> **Status:** Draft, aligned with `@airnub/resilient-http-core` v0.7.0  
> **Scope:** Policy engine and HTTP interceptor(s) for coordinating rate limits, concurrency and resilience budgets across requests using `HttpClient`.
>
> **Non-goals:**
> - Implementing low-level retries, timeouts, or transport behaviour (these live in core).
> - Acting as a content-safety or browser-guardrail system (that lives in `agent-browser-guardrails`).
> - Acting as a replacement for external rate-limit backends (Redis, DB) — these may be used behind policy engines but are not mandated.

This spec defines `@airnub/resilient-http-policies` v0.3.0. It is intended to be complete enough that a developer or coding agent can implement the package using only this document plus the `resilient-http-core` v0.7.0 spec.

---

## 1. Design Goals & Principles

1. **Central policy brain, thin HTTP integration**
   - Concentrate rate limits, concurrency caps, and budget decisions in a single policy engine.
   - Integrate with HTTP via `HttpRequestInterceptor` only.

2. **Scope-aware decisions**
   - Policies may vary by client, operation, HTTP method, class of work (interactive/background/batch), and AI metadata (provider/model/tenant/tool) found in `AgentContext` and `extensions`.

3. **Budget steering, not transport rewriting**
   - Policies adjust `ResilienceProfile` (attempts, timeouts, fail-fast hints) or reject requests; they do not implement their own retries.

4. **Config-driven & embeddable**
   - The core engine is pure TypeScript logic.
   - It should be straightforward to load policy definitions from JSON/YAML in an app.

5. **No external dependencies by default**
   - The reference `InMemoryPolicyEngine` must work with no Redis/DB/queues.
   - External backends are optional and live behind interfaces.

---

## 2. Dependencies & Environment

- Depends on `@airnub/resilient-http-core` v0.7.0:
  - Types: `HttpClient`, `HttpRequestOptions`, `HttpRequestInterceptor`, `HttpMethod`, `ResilienceProfile`, `RequestOutcome`, `ErrorCategory`, `AgentContext`, `Extensions`, `CorrelationInfo`.
- TypeScript (ES2019 or later) is assumed for reference implementation.

All HTTP retries, timeouts, trace/metrics hooks are owned by the core `HttpClient` and its interceptors. Policies only influence or coordinate those decisions.

---

## 3. Core Concepts & Types

### 3.1 RequestClass

`RequestClass` expresses how time-sensitive or user-facing a request is.

```ts
export type RequestClass =
  | "interactive"  // user-facing, low-latency
  | "background"   // async, but still important
  | "batch";       // large offline jobs, can be heavily throttled
```

### 3.2 PolicyScope (Runtime View)

`PolicyScope` is the runtime view of a request seen by the policy engine.

```ts
export interface PolicyScope {
  clientName: string;         // from HttpClientConfig.clientName
  operation: string;          // from HttpRequestOptions.operation
  method: HttpMethod;         // from HttpRequestOptions.method

  /** Optional classification hint supplied by caller or defaulting logic. */
  requestClass?: RequestClass;

  /** Derived AI/tenant metadata from extensions (if present). */
  aiProvider?: string;        // extensions["ai.provider"]
  aiModel?: string;           // extensions["ai.model"]
  aiOperation?: string;       // extensions["ai.operation"]
  aiTool?: string;            // extensions["ai.tool"]
  aiTenant?: string;          // extensions["ai.tenant"]

  /** Tenant information derived from extensions, if any. */
  tenantId?: string;          // extensions["tenant.id"]
  tenantTier?: string;        // extensions["tenant.tier"]

  /** Agent identity from HttpRequestOptions.agentContext. */
  agentContext?: AgentContext;

  /** Raw extensions in case a policy engine needs custom fields. */
  extensions?: Extensions;
}
```

**NOTE:** The policy implementation is allowed to derive extra fields from `extensions` and `agentContext`, but the above represent the common attributes that should be supported by all engines.

### 3.3 ScopeSelector (Config View)

`ScopeSelector` describes which requests a policy applies to.

```ts
export type StringMatcher = string | string[] | "*"; // exact or one-of or wildcard

export interface ScopeSelector {
  clientName?: StringMatcher;
  operation?: StringMatcher;   // e.g. "openai.responses.create" or ["finra.*", "sec.*"]
  method?: HttpMethod | HttpMethod[];

  requestClass?: RequestClass | RequestClass[];

  aiProvider?: StringMatcher;
  aiModel?: StringMatcher;
  aiOperation?: StringMatcher;
  aiTool?: StringMatcher;
  aiTenant?: StringMatcher;

  tenantId?: StringMatcher;
  tenantTier?: StringMatcher;
}
```

A runtime engine must be able to evaluate whether a `PolicyScope` matches a `ScopeSelector` using the following semantics:

- If a selector field is `undefined`, it does not constrain the scope.
- If a selector field is `"*"`, it matches any non-empty value.
- If a selector field is a string, it matches when `scopeField === selector`.
- If a selector field is an array, it matches when `scopeField` equals any element.

### 3.4 PolicyKey & Priority

```ts
export type PolicyKey = string; // unique identifier

export type PolicyPriority = number; // larger number = higher priority
```

Policies with higher priority are evaluated first when multiple policies match.

### 3.5 PolicyDefinition

`PolicyDefinition` describes a single policy.

```ts
export interface RateLimitRule {
  /** Max requests allowed per window, per key (e.g. per tenant, per model). */
  maxRequests: number;
  /** Window length in milliseconds. */
  windowMs: number;

  /** Optional key template for bucketing, e.g. "${clientName}:${aiModel}". */
  bucketKeyTemplate?: string;
}

export interface ConcurrencyRule {
  /** Max concurrent in-flight requests for this scope. */
  maxConcurrent: number;

  /** Optional key template, e.g. "${clientName}:${tenantId}". */
  bucketKeyTemplate?: string;
}

export interface ResilienceOverride {
  /** Overrides for the per-request ResilienceProfile. */
  resilience: ResilienceProfile;
}

export type FailureMode =
  | "failOpen"    // if policy engine/storage is unavailable, allow requests
  | "failClosed"; // if policy engine/storage is unavailable, deny requests

export interface PolicyDefinition {
  /** Unique policy key. */
  key: PolicyKey;

  /** Human-readable description for logs and admin UIs. */
  description?: string;

  /** Which requests this policy applies to. */
  selector: ScopeSelector;

  /** Priority; higher wins when multiple policies would conflict. */
  priority?: PolicyPriority; // default: 0

  /** Optional rate limit rule. */
  rateLimit?: RateLimitRule;

  /** Optional concurrency rule. */
  concurrency?: ConcurrencyRule;

  /** Optional resilience overrides. */
  resilienceOverride?: ResilienceOverride;

  /**
   * Optional queueing behaviour for this policy. If set, the engine MAY
   * queue requests when concurrency is exceeded instead of denying them.
   */
  queue?: {
    /** Maximum queued requests. If exceeded, newer requests are denied. */
    maxQueueSize: number;
    /** Maximum time a request is allowed to stay queued, in ms. */
    maxQueueTimeMs: number;
  };

  /** Failure mode if the policy engine itself malfunctions. */
  failureMode?: FailureMode; // default: "failOpen"
}
```

### 3.6 PolicyDecision

`PolicyDecision` is the engine’s decision before each HTTP attempt.

```ts
export type PolicyEffect =
  | "allow"   // allow now
  | "delay"   // allow but only after waiting
  | "deny";   // do not send

export interface PolicyDecision {
  effect: PolicyEffect;

  /**
   * If effect === "delay", the interceptor MUST delay this attempt
   * by the specified number of milliseconds before sending.
   */
  delayBeforeSendMs?: number;

  /**
   * Optional override for the request's ResilienceProfile. The interceptor
   * MUST merge this override with any existing profile (override wins).
   */
  resilienceOverride?: ResilienceProfile;

  /** Optional policy key that produced this decision. */
  policyKey?: PolicyKey;

  /** Optional human-readable reason for logging. */
  reason?: string;
}
```

### 3.7 PolicyOutcome

`PolicyOutcome` summarizes how a finished request interacted with policies.

```ts
export interface PolicyOutcome {
  /** Policy key that governed this request, if any. */
  policyKey?: PolicyKey;

  /** Actual wait/delay time before sending, if any. */
  delayMs?: number;

  /** Whether the request was denied by policy (versus network error). */
  denied?: boolean;

  /** Effective bucket key(s) used for rate limit or concurrency. */
  buckets?: string[];
}
```

### 3.8 PolicyEvaluationContext & Result

```ts
export interface PolicyEvaluationContext {
  scope: PolicyScope;
  /**
   * Current HttpRequestOptions for this attempt. The engine MUST NOT mutate
   * these options directly; it may return a resilienceOverride instead.
   */
  request: HttpRequestOptions;
}

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  outcome?: PolicyOutcome;
}
```

### 3.9 PolicyEngine

`PolicyEngine` is the central interface.

```ts
export interface PolicyEngine {
  /**
   * Evaluate a request before it is sent. The engine may consult in-memory
   * counters, external stores, or both to decide whether to allow, delay,
   * or deny the attempt.
   */
  evaluate(
    ctx: PolicyEvaluationContext
  ): Promise<PolicyEvaluationResult>;

  /**
   * Notify the engine after a request completes (or fails). Used to update
   * internal counters, sliding windows, etc.
   */
  onResult(
    ctx: PolicyScope,
    outcome: RequestOutcome,
    policyOutcome?: PolicyOutcome
  ): Promise<void>;
}
```

The engine MUST NOT itself perform retries or adjust low-level HTTP behaviour beyond what is expressible via `PolicyDecision`.

---

## 4. Policy Errors

### 4.1 PolicyDeniedError

When a policy decides `effect: "deny"`, the interceptor MUST throw a `PolicyDeniedError`.

```ts
export class PolicyDeniedError extends Error {
  readonly policyKey?: PolicyKey;
  readonly scope: PolicyScope;
  readonly reason?: string;

  constructor(options: {
    message?: string;
    policyKey?: PolicyKey;
    scope: PolicyScope;
    reason?: string;
  }) {
    super(options.message ?? "Request denied by policy");
    this.name = "PolicyDeniedError";
    this.policyKey = options.policyKey;
    this.scope = options.scope;
    this.reason = options.reason;
  }
}
```

Implementations SHOULD:

- Set `ErrorCategory = "quota"` or `"safety"` when logging/metrics see a `PolicyDeniedError`.
- Include `policyKey` and `reason` in log metadata.

---

## 5. Policy Interceptor

### 5.1 createPolicyInterceptor

The integration point with `HttpClient` is a `HttpRequestInterceptor`.

```ts
export interface PolicyInterceptorOptions {
  engine: PolicyEngine;

  /**
   * Optional function to map HttpRequestOptions into a RequestClass.
   * If omitted, implementations may use simple defaults (e.g. default
   * to "interactive" unless operation name suggests batch).
   */
  classifyRequestClass?: (request: HttpRequestOptions) => RequestClass;
}

export function createPolicyInterceptor(
  options: PolicyInterceptorOptions
): HttpRequestInterceptor;
```

### 5.2 Scope Construction Rules

The interceptor MUST construct a `PolicyScope` for each attempt as follows:

- `clientName`: from `HttpClientConfig.clientName` (it MUST be available via closure).
- `operation`: from `request.operation`.
- `method`: from `request.method`.
- `requestClass`:
  - If `classifyRequestClass` is provided, call it with `request`.
  - Else, default to:
    - `"interactive"` for methods `GET`, `HEAD`.
    - `"background"` for `POST`, `PUT`, `PATCH`, `DELETE`.

- Extract AI metadata from `request.extensions` if present:
  - `aiProvider = extensions["ai.provider"]` (string).
  - `aiModel = extensions["ai.model"]`.
  - `aiOperation = extensions["ai.operation"]`.
  - `aiTool = extensions["ai.tool"]`.
  - `aiTenant = extensions["ai.tenant"]`.
- Tenant metadata:
  - `tenantId = extensions["tenant.id"]`.
  - `tenantTier = extensions["tenant.tier"]`.
- `agentContext` from `request.agentContext`.
- `extensions` from `request.extensions`.

### 5.3 Interceptor Behaviour

The interceptor MUST implement the following behaviour:

#### beforeSend

```ts
beforeSend: async (ctx: BeforeSendContext) => {
  // 1. Construct PolicyScope from ctx.request
  // 2. Call engine.evaluate({ scope, request: ctx.request })
  // 3. Apply decision:
  //    - if effect === "deny": throw PolicyDeniedError
  //    - if effect === "delay": await delay(decision.delayBeforeSendMs)
  //    - if resilienceOverride present: merge into ctx.request.resilience
}
```

Merge semantics for `resilienceOverride`:

- Shallow merge where override wins:

```ts
ctx.request.resilience = {
  ...(ctx.request.resilience ?? {}),
  ...decision.resilienceOverride,
};
```

- The interceptor MUST NOT increase `maxAttempts` or `overallTimeoutMs` beyond what the underlying client can enforce (though the core spec does not restrict this explicitly, the engine SHOULD act conservatively when tightening budgets).

#### afterResponse & onError

- Both should call `engine.onResult(scope, outcome, policyOutcome)` where:
  - `scope` is the same as used in `evaluate`.
  - `outcome` is the `RequestOutcome` derived by the `HttpClient`.
  - `policyOutcome` is any bucket/delay information returned from `evaluate`.

Implementations MAY need to obtain `RequestOutcome` from a higher layer or recompute minimal information if the core does not expose per-request outcomes directly. At minimum, they SHOULD call `onResult` with:

- `ok`, `status`, `errorCategory`, `attempts`, `startedAt`, `finishedAt`.

---

## 6. In-Memory Policy Engine

`@airnub/resilient-http-policies` MUST provide a zero-dependency `InMemoryPolicyEngine` implementation suitable for local development, tests, and single-process deployments.

### 6.1 InMemoryPolicyEngineConfig

```ts
export interface InMemoryPolicyEngineConfig {
  policies: PolicyDefinition[];
}
```

### 6.2 createInMemoryPolicyEngine

```ts
export function createInMemoryPolicyEngine(
  config: InMemoryPolicyEngineConfig
): PolicyEngine;
```

### 6.3 Behavioural Guidelines

The in-memory engine:

- MUST implement `evaluate` and `onResult` based only on in-process state.
- MUST:
  - Match policies using `ScopeSelector` semantics.
  - If multiple policies match:
    - Choose the one with highest `priority`.
    - If equal priority, use deterministic tie-breaking (e.g. lexicographic `key`).

- Rate limiting:
  - For each `RateLimitRule`, maintain counters in a sliding or fixed window (implementation detail).
  - If `maxRequests` would be exceeded in the current window, return `effect: "delay"` or `"deny"` depending on queueing config and engine design.

- Concurrency:
  - For each `ConcurrencyRule`, track concurrent in-flight requests per bucket.
  - If `maxConcurrent` is reached:
    - If a `queue` config exists and queue is not full: place the request into a queue and return `effect: "delay"` with an appropriate delay.
    - If queue is full or not configured: return `effect: "deny"`.

- Failure mode:
  - If an internal error occurs (e.g. broken state), consult `PolicyDefinition.failureMode`:
    - `"failOpen"`: return `effect: "allow"` and emit a log warning.
    - `"failClosed"`: return `effect: "deny"`.

**NOTE:** The in-memory engine is **not suitable** for multi-process coordination. Documentation MUST clearly state that for real distributed quotas, a custom engine backed by Redis/DB should be used.

---

## 7. Basic Helper Factories

To make simple use-cases ergonomic, the library MUST provide a small set of convenience functions that assemble policies and engines.

### 7.1 createBasicRateLimitPolicy

```ts
export interface BasicRateLimitOptions {
  key: PolicyKey;
  clientName: string;
  maxRps: number;         // average requests per second
  maxBurst?: number;      // optional burst capacity, defaults to maxRps

  /** Optional scope refinement. If omitted, policy applies to entire client. */
  selector?: Partial<ScopeSelector>;
}

export function createBasicRateLimitPolicy(
  opts: BasicRateLimitOptions
): PolicyDefinition;
```

**Behaviour (definition-level only):**

- Convert `maxRps` into a window (e.g. 1s) and `maxRequests = maxRps`.
- If a `selector` is provided, merge it with `{ clientName }`.
- `priority` MAY default to 0.

### 7.2 createBasicConcurrencyPolicy

```ts
export interface BasicConcurrencyOptions {
  key: PolicyKey;
  clientName: string;
  maxConcurrent: number;

  /** Optional scope refinement. */
  selector?: Partial<ScopeSelector>;
}

export function createBasicConcurrencyPolicy(
  opts: BasicConcurrencyOptions
): PolicyDefinition;
```

### 7.3 createBasicInMemoryPolicyEngine

```ts
export interface BasicPolicyEngineOptions {
  clientName: string;
  rateLimit?: BasicRateLimitOptions;
  concurrency?: BasicConcurrencyOptions;
}

export function createBasicInMemoryPolicyEngine(
  opts: BasicPolicyEngineOptions
): PolicyEngine;
```

**Behaviour:**

- Internally constructs `PolicyDefinition[]` using `createBasicRateLimitPolicy` and/or `createBasicConcurrencyPolicy`.
- Passes them to `createInMemoryPolicyEngine`.

This helper is intended to cover the very common use-case: "I just want a client with simple rate limit and concurrency caps."

---

## 8. Relationship to Core Resilience & Guardrails

### 8.1 No Independent Retries

The policy engine and interceptor MUST NOT perform their own retries. All retries are governed by `ResilienceProfile` and the core `HttpClient`.

### 8.2 ResilienceProfile Authority

When `resilienceOverride` is provided by a policy decision:

- The interceptor MUST merge it into `request.resilience`.
- The effective profile is then used by the core for all attempts.
- Policy engines SHOULD avoid raising retry counts or timeouts beyond global defaults; they are best used to **tighten** budgets (e.g. for low-priority background work).

### 8.3 Layering vs Guardrails

- Policies answer: **"Is this request allowed right now, given quotas and concurrency budgets?"**
- Browser guardrails answer: **"Is this request surface safe/allowed at all?"** (host, method, path, body).

Applications SHOULD:

- Run guardrails interceptors either before or after policies, but must understand that a guardrail denial will throw a different error type (`GuardrailViolationError`) than policies (`PolicyDeniedError`).

---

## 9. Versioning & Stability

The following are the **stable surface** of `@airnub/resilient-http-policies` v0.3.0 and SHOULD maintain backwards compatibility (with only additive changes) through 0.3.x and 1.x:

- Types:
  - `RequestClass`
  - `PolicyScope`
  - `StringMatcher`
  - `ScopeSelector`
  - `PolicyKey`
  - `PolicyPriority`
  - `RateLimitRule`
  - `ConcurrencyRule`
  - `ResilienceOverride`
  - `FailureMode`
  - `PolicyDefinition`
  - `PolicyEffect`
  - `PolicyDecision`
  - `PolicyOutcome`
  - `PolicyEvaluationContext`
  - `PolicyEvaluationResult`
  - `PolicyEngine`
  - `PolicyDeniedError`
  - `PolicyInterceptorOptions`
  - `InMemoryPolicyEngineConfig`
  - `BasicRateLimitOptions`
  - `BasicConcurrencyOptions`
  - `BasicPolicyEngineOptions`

- Functions/classes:
  - `createPolicyInterceptor`
  - `createInMemoryPolicyEngine`
  - `createBasicRateLimitPolicy`
  - `createBasicConcurrencyPolicy`
  - `createBasicInMemoryPolicyEngine`
  - `PolicyDeniedError`

Breaking changes to these shapes MUST be reserved for a major version.

---

## 10. Reference Implementation Notes (Non-normative)

1. **Scope derivation helper**
   - Implement an internal helper to build a `PolicyScope` from `HttpRequestOptions` + clientName + optional `classifyRequestClass`. Reuse it across interceptor and tests.

2. **Template substitution for bucket keys**
   - For `bucketKeyTemplate`, a minimal template engine is sufficient:

```ts
// e.g. "${clientName}:${aiModel}:${tenantId}" => "openai:gpt-5.1:acme"
function formatBucket(template: string, scope: PolicyScope): string {
  return template.replace(/\$\{(.*?)\}/g, (_, key) => {
    const value = (scope as any)[key];
    return value == null ? "" : String(value);
  });
}
```

3. **Rate limit windows**
   - For the in-memory engine, a fixed window per `windowMs` is acceptable. A more advanced sliding window can be built later without breaking the public API.

4. **Concurrency accounting**
   - Decrement concurrency counts in `onResult` regardless of success or failure.
   - Guard against leaks by ensuring `onResult` is called in finally-blocks in the interceptor.

5. **Testing**
   - Cover:
     - Matching logic for `ScopeSelector`.
     - Priority resolution when multiple policies apply.
     - Rate limit decisions at boundaries.
     - Concurrency caps with and without queueing.
     - `failOpen` vs `failClosed` behaviour when internal errors are simulated.
   - Integration-test a small `HttpClient` + `createPolicyInterceptor` stack to ensure delays and denies behave as expected.

With this specification, a developer or coding agent can implement `@airnub/resilient-http-policies` v0.3.0 and know how it interacts cleanly with `@airnub/resilient-http-core` v0.7.0 and other satellites (pagination, browser guardrails, agent-conversation, and provider clients).

