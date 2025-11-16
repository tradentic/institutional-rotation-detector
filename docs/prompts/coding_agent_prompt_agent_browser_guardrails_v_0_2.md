# CODING_AGENT_PROMPT.md — `@airnub/agent-browser-guardrails` v0.2

## 0. Role & Context

You are a **senior TypeScript engineer**. Your task is to implement or align `@airnub/agent-browser-guardrails` with the v0.2 spec.

This package provides **surface-level safety** for AI-driven HTTP and browser navigation: host/path/method restrictions, header redaction, and URL classification. It is separate from quotas/policies.

---

## 1. Source of Truth

Use this spec as authoritative:

- `docs/specs/resilient_http_agent_browser_guardrails_spec_v_0_2.md`

If existing code disagrees with the spec, the spec wins.

---

## 2. Global Constraints

- TypeScript with `strict: true`.
- No direct network calls.
- No dependency on `@airnub/resilient-http-policies` (they are separate concerns).

---

## 3. Tasks

### 3.1 Core Types

Implement or align the following types exactly as per the spec:

- `GuardedRequestKind` — `'http-request' | 'browser-navigation'`.
- `GuardrailScope` — normalized URL view (protocol, hostname, port, pathname, search, method, headers, contentType, bodySizeBytes, category, agentContext, extensions).
- `StringMatcher` and `GuardrailSelector` — match on protocol, hostname (with wildcard semantics), port, pathPrefix, method, category, tenantId, agentName.
- `GuardrailRuleKey`, `GuardrailPriority`.
- `GuardrailAction` — `effect: 'allow' | 'block'`, plus header/query/body rules.
- `GuardrailRule` — `selector`, `action`, `priority`, `key`, `description?`.
- `GuardrailDecision` and `GuardrailEvaluationResult`.
- `GuardrailEngine` interface — `evaluate(ctx)`.

### 3.2 Error Type

Implement `GuardrailViolationError`:

- Contains `ruleKey?`, `scope`, optional human-readable `reason`.
- Thrown whenever a request or navigation is blocked.

### 3.3 HTTP Integration

Implement `createHttpGuardrailInterceptor(options)` as a `HttpRequestInterceptor` compatible with `@airnub/resilient-http-core`:

- Build a `GuardrailScope` from `HttpRequestOptions`:
  - Construct full URL from `url` or `urlParts`.
  - Parse using `URL`.
  - Map `method`, `headers`, `AgentContext`, `extensions`.
  - Derive `contentType` from headers.
  - Optionally add `category`/`tenantId` via `classifyScope`.
- Call `engine.evaluate({ scope })`.
- If decision is `block`, throw `GuardrailViolationError`.
- If `allow`, apply:
  - Header redaction (`allowOnlyHeaders`, `stripHeaders`).
  - Query parameter masking/dropping.
  - Body size/content-type enforcement.

The interceptor must **not** handle retries or quotas.

### 3.4 Browser Navigation Integration

Implement:

- `BrowserNavigationRequest`.
- `BrowserNavigationGuard` interface.
- `createBrowserNavigationGuard(options)`:
  - Build `GuardrailScope` with `kind = 'browser-navigation'`.
  - Call `engine.evaluate({ scope })`.
  - Throw `GuardrailViolationError` on `block`.

This is designed for use with headless browsers (Playwright, etc.) outside this package.

### 3.5 In-Memory Engine & Helpers

Implement:

- `createInMemoryGuardrailEngine(config)` with `GuardrailRule[]` and a default action.
- Selection rules:
  - Match rules via `GuardrailSelector` semantics.
  - Pick the highest `priority` rule; break ties deterministically.
- Opinionated helper:
  - `createHostAllowlistGuardrails(options)` for simple host allowlisting.

---

## 4. Tests

Create tests that use fake `HttpRequestOptions` and browser navigation requests:

- Host/path/method allow/block cases.
- Header redaction and query masking:
  - `allowOnlyHeaders` vs `stripHeaders`.
  - Mask vs drop query params.
- Body constraints:
  - Block on size too large.
  - Block on disallowed content-types.
- Distinction from policies:
  - Ensure this package does not reference `PolicyEngine` or `PolicyDeniedError`.

---

## 5. Acceptance Criteria

- Public API matches `resilient_http_agent_browser_guardrails_spec_v_0_2.md`.
- `createHttpGuardrailInterceptor` and `createBrowserNavigationGuard` work with a `GuardrailEngine` and throw `GuardrailViolationError` on blocked surfaces.
- In-memory engine and helpers are covered by deterministic tests.
- No coupling to rate limiting or budgets (those belong to `@airnub/resilient-http-policies`).

