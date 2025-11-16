# CODING_AGENT_PROMPT.md — `@airnub/resilient-http-core` v0.7

## 0. Role & Context

You are a **senior TypeScript platform engineer**. Your task is to **implement and/or refactor** `@airnub/resilient-http-core` so it exactly matches the v0.7 spec.

This package is the **boring, stable HTTP foundation**. All other `@airnub/*` satellite libraries depend on it.

---

## 1. Source of Truth

Treat this spec as authoritative:

- `docs/specs/resilient_http_core_spec_v_0_7.md`

If existing code disagrees with the spec, **the spec wins**. Preserve backwards compatibility where possible via small shims or deprecations.

---

## 2. Global Constraints

- TypeScript with `strict: true`.
- No gRPC. HTTP(S) only.
- No hard dependency on external resilience libraries (cockatiel, resilience4ts, etc.).
- No hard dependency on OTEL, Prometheus, Datadog, or logging frameworks.
- No domain-specific logic (no FINRA, SEC, LLM providers, etc.).

---

## 3. Tasks

### 3.1 Core Types & Interfaces

Implement or align the following to match the spec exactly:

- Transport & client:
  - `HttpTransport`
  - `HttpClient`
  - `HttpRequestOptions`
  - `HttpResponse`

- Resilience primitives:
  - `ResilienceProfile` (priority, maxAttempts, latency budgets, backoff hints, failFast, failover hints).
  - Retry & timeout behaviour driven by `ResilienceProfile`.

- Error classification:
  - `ErrorCategory`
  - `ClassifiedError`
  - `ErrorClassifier` interface.

- Outcomes & rate-limit feedback:
  - `RequestOutcome` (status, attempts, duration, errorCategory, etc.).
  - `RateLimitFeedback`.

- Interceptors:
  - `HttpRequestInterceptor` with `beforeSend`, `afterResponse`, `onError` hooks.
  - Interceptor chain runner inside `HttpClient`.

- Context & metadata:
  - `AgentContext` (agent, runId, labels, metadata).
  - `requestId`, `correlationId`, `parentCorrelationId`.
  - `extensions: Extensions` bag for arbitrary metadata.

### 3.2 Default Client

Implement `createDefaultHttpClient(config?)` as defined in the spec:

- Uses `fetch` (or existing transport abstraction) with **sane defaults**.
- Configures:
  - Reasonable timeouts.
  - Retry policy driven by `ResilienceProfile`.
- Requires **no external dependencies** (no Redis, DB, OTEL).

### 3.3 Telemetry Hooks

Ensure telemetry interfaces exist and are wired:

- `Logger`
- `MetricsSink` with `MetricsRequestInfo` including `RequestOutcome` and `RateLimitFeedback`.
- `TracingAdapter`

All hooks must receive:

- `AgentContext`
- `requestId`, `correlationId`, `parentCorrelationId`
- `extensions`

### 3.4 gRPC Removal

- Remove or deprecate any gRPC-related code. This package must be HTTP(S)-only.

---

## 4. Tests

Add or update tests to cover:

- Basic request flow with and without interceptors.
- Retry behaviour according to `ResilienceProfile`.
- Timeout behaviour.
- Error classification via `ErrorClassifier`.
- `RequestOutcome` + `RateLimitFeedback` wiring into `MetricsSink`.
- Propagation of `AgentContext`, correlation IDs, and `extensions`.

Tests must be deterministic and use fake/mock transports (no real network calls).

---

## 5. Acceptance Criteria

- Public API matches `resilient_http_core_spec_v_0_7.md`.
- `createDefaultHttpClient` works as a standalone, zero-dependency HTTP client.
- All tests pass under `strict: true` TypeScript.
- There is no gRPC-related code.
- Other packages can depend on this core without needing Redis/OTEL/logging frameworks by default.

