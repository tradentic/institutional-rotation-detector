# Resilient HTTP Core — Architecture & Implementation Spec (v0.4.0)

> **This is an incremental evolution of v0.3.0.**
>
> v0.4 introduces:
>
> - Explicit support for the HTTP `OPTIONS` method alongside existing methods.
> - A refined, minimal `AgentContext` shape (no conversation or LLM semantics) geared towards generic hooks and plugins.
> - A new `extensions` field on requests and metrics, designed as the primary mechanism for agentic/LLM libraries to attach arbitrary metadata without polluting the core.
> - A strict rule that **`parentCorrelationId` is propagated wherever `correlationId` is propagated**, so hierarchical workflows can always be reconstructed from logs, metrics, and traces.
>
> All changes are **backwards compatible** with v0.3.0 and preserve the core goals:
>
> - Lightweight, dependency-light, and domain-agnostic.
> - Pluggable and future-proof for higher-level libraries (LLM/agent frameworks, telemetry, etc.).

---

## 1. Purpose & Context

Resilient HTTP Core is the shared HTTP engine for all API clients in the
**institutional-rotation-detector** monorepo, including:

- FINRA data APIs
- Unusual Whales APIs
- OpenAI APIs
- SEC EDGAR/Data APIs
- IEX historical data

In v0.3, the core gained:

- Base URL resolution via `resolveBaseUrl`.
- `beforeRequest` / `afterResponse` hooks.
- `operationDefaults` for per-operation policies.
- Convenience `requestText` / `requestArrayBuffer` helpers.
- A separate pagination helper module.

v0.4 focuses on:

1. **Protocol completeness**: explicitly supporting the HTTP `OPTIONS` method.
2. **Agent/extension friendly metadata model**: ensure the core has a clean, minimal `AgentContext`, and a generic `extensions` bag that higher-level agentic/LLM libraries can use to propagate arbitrary metadata (including conversation-related data) without the core itself knowing about conversations.
3. **Reliable hierarchical correlation**: guarantee that `parentCorrelationId` is always carried alongside `correlationId` wherever the context is surfaced, so multi-hop workflows and agents can be debugged from observability data alone.

The HTTP core should never know what a “conversation” is. It should only:

- Transport opaque metadata.
- Surface it to hooks (logging, metrics, tracing, rate limiting, etc.).

---

## 2. Design Principles (v0.4 additions)

Existing principles from v0.2/v0.3 remain in force. v0.4 adds:

1. **HTTP-Complete Method Support (Safe Set)**
   - The core explicitly supports `GET`, `HEAD`, `OPTIONS`, `POST`, `PUT`, `PATCH`, `DELETE` (and any others already defined) in its method union.
   - `OPTIONS` is treated as a **safe, idempotent** method for retry/idempotency defaults.

2. **Minimal, Generic AgentContext**
   - `AgentContext` is not allowed to encode domain concepts like “conversation” or “LLM provider”.
   - It should carry only what is universally useful for infrastructure and observability:
     - Correlation IDs (including a parent link for hierarchies)
     - High-level source information (who/what is making the call)
     - Simple key/value attributes (for generic tagging)

3. **Extensions for Higher-Level Metadata**
   - Arbitrary LLM- or agent-specific metadata (e.g. `conversationId`, `previous_response_id`, `llm_provider`) must live in:
     - A generic `extensions` bag on `HttpRequestOptions` and metrics/logging contexts, and/or
     - A higher-level agent/LLM library that builds on top of this core.
   - The core treats `extensions` as an opaque bag and never interprets its contents.

4. **Correlation Pair Propagation**
   - Wherever `correlationId` is propagated (logs, metrics, traces, rate limiters, caches), `parentCorrelationId` **must also** be propagated if present.
   - This enables reconstruction of tree/graph structures of workflows and agent calls purely from observability data.

---

## 3. HTTP Method Support — Add `OPTIONS`

### 3.1 Type-level changes

In `libs/resilient-http-core/src/types.ts`, update the HTTP method type union used by `HttpRequestOptions`.

Example (shape may differ slightly depending on current code):

```ts
export type HttpMethod =
  | 'GET'
  | 'HEAD'
  | 'OPTIONS'  // v0.4 addition
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE';

export interface HttpRequestOptions {
  method: HttpMethod;
  path: string;
  // ... existing fields (query, headers, body, operation, etc.)
}
```

### 3.2 Idempotency defaults

Wherever default idempotency is inferred based on method (e.g. in `HttpClient` when `opts.idempotent` is not explicitly set), ensure `OPTIONS` is treated like `HEAD` and `GET`:

- Safe + idempotent by default.

Example helper:

```ts
function defaultIdempotentForMethod(method: HttpMethod): boolean {
  switch (method) {
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
      return true;
    default:
      return false;
  }
}
```

All existing retry behaviour that uses the `idempotent` flag continues unchanged; `OPTIONS` simply falls into the same safe category as `HEAD`.

### 3.3 No special semantics

The core does **not** need to implement any specific logic for `OPTIONS` beyond:

- Accepting it as a valid method.
- Applying default idempotency.
- Allowing callers to use it like any other method.

CORS preflight, capability discovery, and other semantics remain entirely in the domain of the calling code and the server.

---

## 4. AgentContext v0.4 — Minimal & Generic

### 4.1 Goals

- Provide a small, generic context object that can be used by:
  - Logging
  - Metrics
  - Tracing
  - Rate limiting
  - Caching

- Avoid hard-coding domain concepts such as:
  - Conversations
  - LLM providers/models
  - End-user identities

Anything domain-specific must be carried via `extensions` or in higher-level libraries.

### 4.2 AgentContext shape

In `libs/resilient-http-core/src/types.ts`, redefine `AgentContext` as follows (or adjust the existing shape to match):

```ts
export interface AgentContext {
  /**
   * A high-level logical correlation identifier for the caller.
   * For example: a workflow run ID, a job ID, or an agent task ID.
   */
  correlationId?: string;

  /**
   * Optional parent correlation ID, useful for representing hierarchical
   * workflows. For example: a parent job ID when spawning sub-tasks.
   */
  parentCorrelationId?: string;

  /**
   * A short label for the source of the call (e.g. "temporal-worker",
   * "rotation-score-scanner", "cli"), primarily for logging and metrics.
   */
  source?: string;

  /**
   * Free-form key/value attributes for generic tagging. Keys should be
   * small, stable identifiers; values should be simple JSON-serializable
   * scalars. This is intentionally generic and not LLM-specific.
   */
  attributes?: Record<string, string | number | boolean>;
}
```

### 4.3 Usage rules

- `AgentContext` **must not** contain fields that encode specific concepts like:
  - `conversationId`
  - `turnId`
  - `llmProvider`
  - `openaiConversationId`

- If higher-level code needs to tag requests with those concepts, it should either:
  - Place simplified tags in `AgentContext.attributes`, *if they are truly generic and useful for infrastructure-level observability* (e.g. `attributes.llm = true`, `attributes.provider_group = 'llm'`), or
  - Put rich, provider-specific details into `extensions` (see Section 5).

### 4.4 Propagation and exposure

Ensure `AgentContext` continues to be:

- An optional field on `HttpRequestOptions`:

  ```ts
  export interface HttpRequestOptions {
    // ... existing fields
    agentContext?: AgentContext;
  }
  ```

- Propagated to:
  - `Logger` as part of `LoggerMeta` (e.g. `meta.agentContext`).
  - `MetricsSink.recordRequest` via its `info` parameter (e.g. `info.agentContext`).
  - `TracingAdapter.startSpan` / `TracingSpan` as part of span attributes.
  - `HttpRateLimiter` and `HttpCache` implementations where relevant.

### 4.5 Correlation + ParentCorrelation Propagation Rule

**Propagation requirement:**

- Wherever `AgentContext` is forwarded or surfaced (logs, metrics, traces, rate limiters, caches), **both** `correlationId` and `parentCorrelationId` MUST be preserved when present.
- Implementations must not drop `parentCorrelationId` when copying or serializing the context.

Concretely:

- If `agentContext.correlationId` is copied into:
  - `MetricsRequestInfo.agentContext`
  - `LoggerMeta.agentContext`
  - Tracing span attributes

  then `agentContext.parentCorrelationId` must also be copied as part of the same `AgentContext` object, if defined.

This requirement ensures that hierarchical workflows (e.g. parent/child Temporal activities, nested agent calls) can be reconstructed from observability data alone.

---

## 5. Extensions — Primary Hook for Agent/LLM Metadata

### 5.1 Motivation

Higher-level features such as agentic LLM workflows, multi-provider conversation orchestration, and rich semantic metadata need a place to attach information like:

- App-level conversation IDs
- LLM provider choices and model names
- Provider-specific threading IDs (e.g. `previous_response_id`)
- Tool-call metadata

These concepts should **not** be baked into the core HTTP types, but they need a consistent, structured place to live so that plugins and hooks can use them.

### 5.2 `extensions` on HttpRequestOptions

In `libs/resilient-http-core/src/types.ts`, extend `HttpRequestOptions` with a new `extensions` field:

```ts
export interface HttpRequestOptions {
  method: HttpMethod;
  path: string;
  // existing fields: query, headers, body, operation, cacheKey, cacheTtlMs, etc.

  /**
   * Opaque extension metadata for higher-level libraries and plugins.
   * The core does not inspect or mutate this; it is passed through to
   * logging, metrics, and tracing hooks as-is.
   */
  extensions?: Record<string, unknown>;

  agentContext?: AgentContext;
  // ... other existing fields
}
```

**Constraints:**

- `extensions` is intentionally untyped at the generic level (`Record<string, unknown>`).
- The core must treat `extensions` as **opaque**:
  - No branching logic by key.
  - No validation of contents.

### 5.3 `extensions` in Metrics and Logging

Update the relevant types to expose `extensions` so observability tooling and plugins can use them.

Example:

```ts
export interface MetricsRequestInfo {
  client: string;
  operation: string;
  durationMs: number;
  status: number;
  cacheHit?: boolean;
  attempt?: number;
  // existing fields (budget info, etc.)

  agentContext?: AgentContext;

  /**
   * Extension metadata pulled from HttpRequestOptions.extensions, for
   * advanced consumers that need to tag metrics with high-level context
   * (e.g., LLM provider, conversation cohort, etc.).
   */
  extensions?: Record<string, unknown>;
}
```

`LoggerMeta` may also gain an `extensions` field, or it may simply carry the original `HttpRequestOptions` and/or `AgentContext`. The key requirement is that any piece of infrastructure that wants to consume extension metadata can do so.

### 5.4 HttpClient behaviour

In `HttpClient`:

- When constructing `MetricsRequestInfo` for `metrics.recordRequest`, copy `extensions` from `HttpRequestOptions`.
- When invoking `logger` or `tracing` hooks, ensure `extensions` is available within the meta/attributes structure those hooks receive.
- When forwarding `AgentContext`, always preserve both `correlationId` and `parentCorrelationId` if present.

The core **never** modifies or interprets `extensions`; it only transports them.

### 5.5 Example usage (in a higher-level LLM library)

*This is illustrative only; it does not belong in the core implementation.*

A multi-provider LLM library might build a request like:

```ts
const opts: HttpRequestOptions = {
  method: 'POST',
  path: '/v1/responses',
  operation: 'llm.generate',
  body: openAiRequestBody,
  agentContext: {
    correlationId: 'wf-1234',
    parentCorrelationId: 'wf-root',
    source: 'rotation-score-agent',
    attributes: {
      tier: 'experiment',
    },
  },
  extensions: {
    llm: {
      provider: 'openai',
      model: 'gpt-5.1-mini',
      appConversationId: 'conv-abc',
      providerConversationId: '...',
      previousResponseId: '...',
    },
  },
};
```

A separate plugin or `beforeRequest` hook can then:

- Read `opts.extensions.llm`,
- Apply provider-specific headers/body tweaks, or
- Update its own in-memory conversation/session state.

The HTTP core remains agnostic.

---

## 6. Testing & Rollout

### 6.1 HTTP method / `OPTIONS` tests

In `libs/resilient-http-core/src/__tests__/HttpClient.test.ts`:

- Add/extend tests to verify that:
  - `HttpClient` accepts `OPTIONS` as a valid method.
  - When `idempotent` is not provided, `OPTIONS` is treated as idempotent by default.
  - Retry logic behaves as expected for `OPTIONS` (same as other idempotent methods).

### 6.2 AgentContext tests

- Verify that `AgentContext` fields (`correlationId`, `parentCorrelationId`, `source`, `attributes`) are:
  - Accepted in `HttpRequestOptions`.
  - Passed through correctly to:
    - `MetricsSink.recordRequest`.
    - `TracingAdapter.startSpan`.
    - Any `Logger` meta wiring.

- Specifically test that when `AgentContext` is attached to a request:
  - Both `correlationId` and `parentCorrelationId` appear in the downstream meta objects (metrics, logging, tracing).

### 6.3 Extensions tests

- Add tests that:
  - Pass a simple `extensions` object into `HttpRequestOptions` and assert that:
    - It appears intact in `MetricsRequestInfo.extensions`.
    - It is visible to any logging/tracing hooks that are configured.
  - Confirm that the core does not drop or mutate `extensions`.

### 6.4 Backwards compatibility

- Build and test all affected packages:

  ```bash
  pnpm --filter @tradentic/resilient-http-core test
  pnpm --filter @tradentic/resilient-http-core build
  pnpm --filter finra-client build
  pnpm --filter unusualwhales-client build
  pnpm --filter openai-client build
  pnpm --filter apps/temporal-worker build
  ```

- Fix any type or runtime issues while ensuring that v0.4 defaults behave identically to v0.3 when:
  - No `AgentContext` is provided.
  - No `extensions` are provided.
  - `OPTIONS` is not used.

---

## 7. Versioning & Summary

- Bump `libs/resilient-http-core/package.json` version from `0.3.x` to `0.4.0`.
- Add/rename the spec file in the repo to `docs/specs/resilient_http_core_spec_v_0_4.md` with this content.

**Summary of v0.4 changes:**

1. **HTTP `OPTIONS` support**
   - Included in the `HttpMethod` union.
   - Treated as safe and idempotent by default.

2. **Minimal, generic `AgentContext`**
   - Contains only correlation IDs (with optional parent link), source labels, and generic attributes.
   - No conversation or LLM-specific fields.

3. **`extensions` bag for advanced metadata**
   - Added to `HttpRequestOptions` (and reflected into metrics/logging/tracing).
   - Intended for higher-level agentic/LLM libraries to attach arbitrary metadata.
   - Core treats it as opaque and domain-agnostic.

4. **Correlation + ParentCorrelation propagation guarantee**
   - Wherever `AgentContext` is propagated (logs, metrics, traces), both `correlationId` and `parentCorrelationId` are preserved when present.
   - This enables reconstruction of hierarchical workflows and multi-agent call graphs using observability data alone.

With v0.4, `@tradentic/resilient-http-core` is better aligned with advanced agent/LLM use cases, without compromising its core design constraints or introducing domain-specific coupling.

