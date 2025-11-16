# CODING_AGENT_PROMPT.md — `@airnub/agent-browser-guardrails` v0.2

## 0. Role & Scope

You are a **senior TypeScript engineer** working in the `tradentic/institutional-rotation-detector` monorepo.

Your job in this prompt is **only** to implement and align the package:

> `@airnub/agent-browser-guardrails`

with its v0.2 spec, built on top of **`@airnub/resilient-http-core` v0.7**.

This package provides **safety guardrails** for AI-driven HTTP usage (agentic browsing, tools). Do not modify other packages except for minimal wiring.

---

## 1. Source of Truth

Treat these documents as the **source of truth** for this package:

- Core v0.7 spec:
  - `docs/specs/resilient_http_core_spec_v_0_7.md`
- Browser guardrails v0.2 spec:
  - `docs/specs/resilient_http_agent_browser_guardrails_spec_v_0_2.md`

If code and docs disagree, **the docs win**.

---

## 2. Global Constraints

- Language: **TypeScript** with `strict: true`.
- Depends on `@airnub/resilient-http-core` for `HttpRequestInterceptor` and related types.
- Must not:
  - Implement its own HTTP transport.
  - Introduce heavy security frameworks — keep it lightweight policies + interceptors.

---

## 3. Implementation Tasks

### 3.1 Guardrail Concepts & Types

Implement all core types from `resilient_http_agent_browser_guardrails_spec_v_0_2.md`, including:

- Configuration types:
  - Host rules: allowlists, denylists, wildcard patterns.
  - Method rules: allowed methods per host or pattern (e.g. read-only vs mutating).
  - Path rules: path prefixes/regexes allowed or denied.
  - Payload limits: maximum body size, allowed content types.
  - Per-agent/per-tool overrides keyed off `AgentContext` and `extensions` (e.g., `toolId`).
- Decision/result types:
  - `GuardrailDecision` (e.g. `allow`, `deny`, `modify`, with reason codes).
  - Optional annotations that can be attached to `extensions` for telemetry (e.g., `extensions['guardrail.decision']`).

Export all public types from this package’s barrel file.

### 3.2 Interceptor Implementation

Implement a function:

```ts
export function createBrowserGuardrailsInterceptor(config: BrowserGuardrailsConfig): HttpRequestInterceptor;
```

Using v0.7 core interceptor contexts:

- `beforeSend(ctx: BeforeSendContext)`:
  - Extract:
    - Target URL from `ctx.request.url` / `urlParts` / legacy `path`.
    - HTTP method from `ctx.request.method`.
    - Agent and tool metadata from `ctx.request.agentContext` and `ctx.request.extensions` (e.g., `extensions['tool.id']`).
  - Evaluate guardrail rules:
    - Host allow/deny rules.
    - Method restrictions (e.g., disallow `POST/PUT/DELETE` to certain hosts or paths).
    - Path and query constraints.
    - Payload size bounds (if `body` length can be computed cheaply).
  - If a rule is violated:
    - Throw a descriptive error that explains which rule was triggered and why.
    - Optionally annotate `ctx.request.extensions` with guardrail info before throwing.

- `afterResponse` / `onError`:
  - The spec may define post-response checks (e.g., content-type filtering, response size limits). Implement those if required.
  - Use `AfterResponseContext` and `OnErrorContext` as defined in core v0.7.

Ensure the interceptor is pure relative to the HTTP core — it must not call `fetch` or other transports itself.

### 3.3 Agent/Tool-Aware Rules

Support rules that vary by:

- `agentContext.agent` (e.g., `"browser-agent"`, `"scraper-agent"`).
- `agentContext.labels` (e.g., environment, risk level).
- `extensions['tool.id']` or similar fields for specific tools.

Implement a simple override system so that, for example:

- Default: only GET/HEAD allowed to external hosts.
- Specific tool: allow POST to a safe internal API endpoint.

Matching and precedence rules must align with the v0.2 spec (e.g., more specific rules override global defaults).

### 3.4 Error Design

Errors thrown by guardrails should:

- Extend `Error` and include a machine-readable code (e.g., `"GUARDRAIL_BLOCKED_HOST"`).
- Include context for diagnostics (host, method, path, agent/tool IDs — but avoid leaking sensitive data).

These errors may be surfaced to higher-level agent orchestration, so keep the message clear.

---

## 4. Tests

Add tests under this package to cover:

- Host allow/deny behaviour for various URLs (HTTP/HTTPS, ports, subdomains).
- Method restrictions for different hosts and paths.
- Path and payload size checks.
- Per-agent/per-tool overrides (different outcomes for same URL/method based on metadata).
- That the interceptor works correctly in a chain with other core v0.7 interceptors.

Use fake `HttpRequestOptions` and context objects to test rule evaluation without making real HTTP calls.

---

## 5. Done Definition

You are **done** for this prompt when:

- The package compiles and exports all guardrail types and the `createBrowserGuardrailsInterceptor` function described in `resilient_http_agent_browser_guardrails_spec_v_0_2.md`.
- The interceptor integrates with core v0.7’s `HttpRequestInterceptor` interfaces and does not perform HTTP itself.
- Tests demonstrate correct blocking/allowing behaviour under different rules and agent/tool contexts.

Do not modify `@airnub/resilient-http-core` or other satellites in this prompt beyond what is necessary for type imports.

