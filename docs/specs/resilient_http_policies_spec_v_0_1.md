# `@airnub/resilient-http-policies` — Architecture & Implementation Spec (v0.1.0)

> **Status:** Design spec for a new standalone package.
>
> **Audience:** Maintainers and coding agents in the Airnub ecosystem who want to plug different resilience libraries (cockatiel, resilience4ts, resilience-typescript, custom policies) into `@airnub/resilient-http-core` **without** coupling the core to any particular dependency.

---

## 1. Purpose & Scope

### 1.1 Problem

`@airnub/resilient-http-core` provides the base HTTP engine:

- `HttpClient` with retries, backoff, timeouts, budgets.
- Interfaces for `HttpRateLimiter`, `CircuitBreaker`, etc.
- A `policyWrapper` hook in `BaseHttpClientConfig` intended for **pluggable resilience stacks**.

However, each project still needs to decide how to:

- Compose higher-level resilience patterns (circuit breakers, bulkheads, retry policies) using libraries such as:
  - **cockatiel**
  - **resilience4ts**
  - **resilience-typescript**
- Wire these policies around the HTTP request call.

We want:

- A **dedicated policy adapter package** that:
  - Exposes ready-made wrappers for common resilience libraries.
  - Encodes best practices for resilient HTTP usage.
  - Stays decoupled from any particular API domain (FINRA/UW/SEC/OpenAI/etc.).
  - Integrates cleanly with `@airnub/resilient-http-core` via `policyWrapper`.

### 1.2 Goals

- Provide a set of **policy wrapper factories** that return a `policyWrapper` compatible with the core’s `BaseHttpClientConfig`:

  ```ts
  export type PolicyWrapper = <T>(fn: () => Promise<T>, ctx: PolicyContext) => Promise<T>;
  ```

- Support, at minimum:
  - A **no-op wrapper** (identity policy) as a reference implementation.
  - A **cockatiel-based wrapper** in v0.1.0.
- Make it easy to add other libraries later (resilience4ts, resilience-typescript, custom policies).
- Use **interfaces and small adapter shims** so this package can evolve independently of the core.
- Work seamlessly in environments such as:
  - Node.js services (Temporal workers, Next.js APIs, CLIs).
  - Serverless/Lambda.

### 1.3 Non-Goals

- Do not move the `policyWrapper` type definition out of `@airnub/resilient-http-core` (core remains the single source of truth for core types).
- Do not bake any particular policy library into `@airnub/resilient-http-core`.
- Do not implement domain-specific retry rules (e.g. FINRA vs SEC vs OpenAI); those belong in client configs or higher-level agent libs.

---

## 2. Package Overview

### 2.1 Package name & entrypoints

- NPM name: `@airnub/resilient-http-policies`
- Primary entry: `src/index.ts`
- Submodules (for tree-shaking / optional imports):
  - `src/noopPolicy.ts`
  - `src/cockatielPolicy.ts`
  - Future: `src/resilience4tsPolicy.ts`, `src/resilienceTypescriptPolicy.ts`

### 2.2 Relationship to `@airnub/resilient-http-core`

- This package depends on the **types** from the core, not vice versa.
- Key type imports:

  ```ts
  import type { PolicyWrapper, PolicyContext } from '@airnub/resilient-http-core';
  ```

- Usage from a consumer:

  ```ts
  import { HttpClient } from '@airnub/resilient-http-core';
  import { createCockatielPolicyWrapper } from '@airnub/resilient-http-policies';

  const policyWrapper = createCockatielPolicyWrapper({ /* config */ });

  const client = new HttpClient({
    // ...other BaseHttpClientConfig,
    policyWrapper,
  });
  ```

---

## 3. Core Types in This Package

> Note: `PolicyWrapper` and `PolicyContext` are defined in the core. This package may define its **own config types** and helper interfaces, but must not redefine core types.

### 3.1 Imported Core Types

From `@airnub/resilient-http-core` (names may need to be aligned with actual implementation):

```ts
export interface PolicyContext {
  clientName: string;        // e.g. 'finra', 'sec', 'openai'
  operation: string;         // e.g. 'finra.weeklySummary', 'openai.responses.create'
  attempt: number;           // retry attempt counter starting at 1
  timeoutMs?: number;        // effective timeout for this operation
  agentContext?: AgentContext;   // correlationId, parentCorrelationId, source, attributes
  extensions?: Record<string, unknown>; // LLM / agent metadata, etc.
}

export type PolicyWrapper = <T>(
  fn: () => Promise<T>,
  ctx: PolicyContext
) => Promise<T>;
```

> If the exact shape differs in the core, this spec should be adjusted to match; this package is a **consumer** of the core types.

### 3.2 Local Types

#### 3.2.1 Base policy config

```ts
export interface BasePolicyConfig {
  /**
   * Optional human-readable name for this policy wrapper.
   * Useful for logging and debugging.
   */
  name?: string;

  /**
   * Optional logger interface from core, for debug-level logs.
   */
  logger?: {
    debug(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
}
```

> Using a narrow logger interface keeps this package decoupled from any particular logger implementation; consumers can pass a `Logger` from the core or a thin adapter.

#### 3.2.2 Cockatiel policy config (v0.1)

```ts
export interface CockatielPolicyConfig extends BasePolicyConfig {
  /**
   * Optional custom retry strategy. If omitted, use a sensible default
   * (e.g. exponential backoff with jitter for transient errors).
   * The exact type aligns with cockatiel's Policy builder.
   */
  retryOptions?: {
    maxAttempts?: number;           // default: 3
    baseDelayMs?: number;           // default: 100
    maxDelayMs?: number;            // default: 5_000
    /**
     * A predicate to decide if an error is retryable. If not provided,
     * a default predicate will be used (e.g. network errors, 5xx).
     */
    isRetryableError?: (err: unknown, ctx: PolicyContext) => boolean;
  };

  /**
   * Optional circuit breaker configuration.
   */
  circuitBreakerOptions?: {
    failureThreshold?: number;      // fraction between 0 and 1, default e.g. 0.5
    minimumRps?: number;            // minimal sample size before tripping
    halfOpenAfterMs?: number;       // sleep window before trying half-open
  };

  /**
   * Optional timeout override in milliseconds; if provided, this may be used
   * to set an upper bound independent of the HttpClient's timeout.
   */
  hardTimeoutMs?: number;
}
```

> The concrete mapping from this config into cockatiel's actual `Policy` types will be implemented inside this package but does not need to mirror every cockatiel feature. The goal is a pragmatic, opinionated adapter.

---

## 4. API Surface

### 4.1 No-op policy wrapper

A reference implementation and fallback when no external library is desired.

```ts
export function createNoopPolicyWrapper(config?: BasePolicyConfig): PolicyWrapper;
```

**Behaviour:**

- Returns a `PolicyWrapper` that simply calls `fn()` with no additional behavior:

  ```ts
  const policyWrapper: PolicyWrapper = async (fn, ctx) => fn();
  ```

- Optionally logs debug information (if `config.logger` is provided) such as:

  ```ts
  logger?.debug('NoopPolicyWrapper: invoking fn', {
    name: config.name ?? 'noop',
    clientName: ctx.clientName,
    operation: ctx.operation,
  });
  ```

**Use cases:**

- Testing.
- As a baseline implementation or fallback when no advanced policies are needed.

### 4.2 Cockatiel-based policy wrapper (v0.1)

```ts
export function createCockatielPolicyWrapper(
  config?: CockatielPolicyConfig
): PolicyWrapper;
```

**High-level behaviour:**

- Builds a composite cockatiel policy stack, typically:
  - Retry policy → Circuit breaker → Timeout
- Wraps `fn` in that stack, using information from `PolicyContext`:
  - `ctx.clientName`
  - `ctx.operation`
  - `ctx.attempt`
  - `ctx.timeoutMs`
  - `ctx.agentContext` / `ctx.extensions` for logging/tracing only.

**Expected implementation sketch:**

1. **Create a retry policy** using cockatiel, with:
   - `maxAttempts` from `config.retryOptions.maxAttempts` or fallback to default (e.g. 3).
   - Exponential backoff using `baseDelayMs` and `maxDelayMs`.
   - An `isRetryableError` predicate that:
     - Uses `config.retryOptions.isRetryableError` if provided.
     - Otherwise defaults to a standard transient error check (HTTP 5xx, 429, network errors) when error shape is known.

2. **Create a circuit breaker policy** (optional):
   - Enabled only if `config.circuitBreakerOptions` is provided or if a reasonable default is desired.
   - Use failure thresholds and half-open delay from config.

3. **Combine policies**:
   - Compose policies according to cockatiel best-practices, e.g.:

     ```ts
     const policy = Policy.wrap(timeoutPolicy, circuitBreakerPolicy, retryPolicy);
     ```

4. **Return a `PolicyWrapper`** that:

   ```ts
   const wrapper: PolicyWrapper = async <T>(fn: () => Promise<T>, ctx: PolicyContext): Promise<T> => {
     const start = Date.now();

     try {
       const result = await policy.execute(() => fn());
       config.logger?.debug?.('CockatielPolicyWrapper: success', {
         clientName: ctx.clientName,
         operation: ctx.operation,
         durationMs: Date.now() - start,
         correlationId: ctx.agentContext?.correlationId,
         parentCorrelationId: ctx.agentContext?.parentCorrelationId,
       });
       return result;
     } catch (err) {
       config.logger?.warn?.('CockatielPolicyWrapper: error', {
         clientName: ctx.clientName,
         operation: ctx.operation,
         durationMs: Date.now() - start,
         correlationId: ctx.agentContext?.correlationId,
         parentCorrelationId: ctx.agentContext?.parentCorrelationId,
         error: String(err),
       });
       throw err;
     }
   };
   ```

5. Use `ctx.timeoutMs` and/or `config.hardTimeoutMs` to derive the effective timeout for the cockatiel timeout policy.

**Notes:**

- The adapter should be implemented in such a way that if cockatiel is not installed, importing `createCockatielPolicyWrapper` will fail clearly (peer dependency error), but other imports (like `createNoopPolicyWrapper`) are unaffected.
- This package may declare cockatiel as a regular dependency or peer dependency; choose a strategy that best fits the monorepo’s dependency management.

### 4.3 Future extension points (placeholders only)

To keep the design future-proof, this package should reserve named exports for additional adapters, even if they are not implemented in v0.1:

```ts
// Future additions (not implemented in v0.1):
// export function createResilience4tsPolicyWrapper(/* config */): PolicyWrapper;
// export function createResilienceTypescriptPolicyWrapper(/* config */): PolicyWrapper;
```

The spec should note that these are **planned** and must not be used until implemented.

---

## 5. Integration with HttpClient

`@airnub/resilient-http-core`’s `HttpClient` accepts a `policyWrapper` in its configuration (exact field name must match the core implementation, e.g. `BaseHttpClientConfig.policyWrapper`).

### 5.1 Example: No-op policy

```ts
import { HttpClient } from '@airnub/resilient-http-core';
import { createNoopPolicyWrapper } from '@airnub/resilient-http-policies';

const client = new HttpClient({
  clientName: 'sec',
  baseUrl: 'https://www.sec.gov',
  policyWrapper: createNoopPolicyWrapper({ name: 'sec-noop' }),
});
```

### 5.2 Example: Cockatiel policy

```ts
import { HttpClient } from '@airnub/resilient-http-core';
import { createCockatielPolicyWrapper } from '@airnub/resilient-http-policies';

const client = new HttpClient({
  clientName: 'finra',
  baseUrl: 'https://api.finra.org',
  policyWrapper: createCockatielPolicyWrapper({
    name: 'finra-cockatiel',
    retryOptions: {
      maxAttempts: 4,
      baseDelayMs: 200,
      maxDelayMs: 5_000,
    },
  }),
});
```

From the perspective of `HttpClient`, nothing changes; it simply calls `policyWrapper(fn, ctx)`.

---

## 6. Error Semantics & Logging

### 6.1 Error propagation

- The `PolicyWrapper` must **not** swallow errors.
- If the underlying `fn()` call ultimately fails after all retries/policies, the error is propagated unchanged to the caller.
- The wrapper may log errors and may wrap them in a policy-specific error type **only if** it preserves the original error as `cause` or in a clearly documented field.

### 6.2 Logging with AgentContext

- If `ctx.agentContext` is present, the adapter should include:
  - `correlationId`
  - `parentCorrelationId`
  - `source`
  - `attributes`

  in any debug/warn/error logs as structured fields.

- If `ctx.extensions` contains metadata (e.g., LLM provider, model, conversation IDs), the adapter **may** include high-level tags (like `provider`, `model`) in logs, but must not assume any particular schema (leave detailed interpretation to higher-level libraries).

---

## 7. Testing Strategy

### 7.1 Unit tests for `createNoopPolicyWrapper`

- Test that the wrapper:
  - Calls `fn` exactly once.
  - Returns its result.
  - Propagates thrown errors.
  - Optionally logs debug information when a logger is provided.

### 7.2 Unit tests for `createCockatielPolicyWrapper`

Use a **fake fn** that simulates transient and permanent errors to validate:

- **Retry behaviour**:
  - When `isRetryableError` returns true, `fn` is retried up to `maxAttempts`.
  - When `isRetryableError` returns false, `fn` is not retried.
- **Circuit breaker behaviour** (if configured):
  - After enough failures, calls are short-circuited (depending on cockatiel configuration).
- **Timeout behaviour**:
  - If `hardTimeoutMs` is set and `fn` exceeds it, the policy times out.
- **Logging**:
  - On success, a debug log is emitted with `clientName`, `operation`, `durationMs`.
  - On failure, a warn/error log is emitted with the same plus error information.

### 7.3 Integration-style tests with HttpClient

- In a test environment where `@airnub/resilient-http-core` is available:
  - Create a `HttpClient` with `policyWrapper` from `createCockatielPolicyWrapper`.
  - Use a fake transport that can simulate transient failures and verify that:
    - The number of transport calls matches the expected number of retries.

> If maintaining such integration tests inside this package is cumbersome, they may live in the core or a dedicated integration-test project, but this spec recommends having at least one end-to-end path.

---

## 8. Dependencies & Packaging

### 8.1 Dependencies

- **Runtime dependencies (v0.1):**
  - `cockatiel` (version range to be decided; e.g. `^3.x`).

- **Dev dependencies:**
  - TypeScript
  - Jest / Vitest (or monorepo standard)

This package must **not** depend on:

- OpenTelemetry
- Any logging framework (pino, winston, etc.)
- Domain-specific libraries

### 8.2 Peer dependency considerations

There are two options for cockatiel:

1. **Regular dependency:** simpler for monorepo usage, ensures cockatiel is always available when this package is installed.
2. **Peer dependency:** more flexible for external consumers but requires them to manage the version.

For the institutional-rotation-detector monorepo, option (1) is acceptable initially. This spec leaves room to adjust later.

### 8.3 Export surface

From `src/index.ts`:

```ts
export type { BasePolicyConfig, CockatielPolicyConfig } from './types';

export { createNoopPolicyWrapper } from './noopPolicy';
export { createCockatielPolicyWrapper } from './cockatielPolicy';

// Future planned exports:
// export { createResilience4tsPolicyWrapper } from './resilience4tsPolicy';
// export { createResilienceTypescriptPolicyWrapper } from './resilienceTypescriptPolicy';
```

---

## 9. Future Extensions (Beyond v0.1)

The following ideas are intentionally **out of scope** for v0.1, but the design should allow them to be added without breaking changes:

1. **Additional policy libraries**
   - `createResilience4tsPolicyWrapper`
   - `createResilienceTypescriptPolicyWrapper`
   - Custom enterprise policy stacks.

2. **Policy composition helpers**
   - Functions to merge multiple `PolicyWrapper`s into one (e.g. apply service-level policies on top of client-level policies).

3. **Dynamic policy selection**
   - Choose different policies based on `PolicyContext` (e.g. different retries for `GET` vs `POST`, or for certain operations).

4. **Budget-aware policies**
   - Integrate more deeply with `HttpRequestBudget` from the core (time/attempt budgets) to decide when to stop retrying.

5. **Metrics integration helpers**
   - Small utilities to wire policy events into metrics sinks (e.g. policy success/failure counters).

These can be added in later minor versions of `@airnub/resilient-http-policies` without changing the v0.1 API surface.

---

## 10. Versioning & Adoption Plan

- Initial release: **v0.1.0**.
- Integration steps for the institutional-rotation-detector repo:
  1. Implement `@airnub/resilient-http-policies` following this spec in the monorepo.
  2. Wire `createNoopPolicyWrapper` or `createCockatielPolicyWrapper` into selected HTTP clients (e.g. FINRA, SEC) via `policyWrapper`.
  3. Add integration tests in the apps/temporal-worker layer to validate end-to-end behavior.

With this package in place, all HTTP clients can share a consistent, configurable resilience layer while keeping `@airnub/resilient-http-core` small, dependency-light, and domain-agnostic.

