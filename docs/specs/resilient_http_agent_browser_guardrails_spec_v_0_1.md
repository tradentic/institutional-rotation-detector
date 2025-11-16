# `@airnub/agent-browser-guardrails` — Spec v0.1

**Status:** Draft for implementation  \
**Depends on:** `@tradentic/resilient-http-core` v0.6+  \
**Optional dependencies:** `@airnub/resilient-http-policies` v0.2+, `@airnub/agent-conversation-core` v0.1+  \
**Scope:** Enforce safety and guardrails for AI-driven HTTP/browsing and tool calls, built on top of the resilient HTTP core, without hard‑coding any specific agent or provider.

---

## 1. Goals

1. Provide a **reusable guardrail layer** for AI agents and AI browsers that:
   - Restricts where they can send HTTP requests (hosts, schemes, ports).
   - Restricts *how* they can interact (methods, headers, content types, payload sizes).
   - Enforces per-agent / per-tool safety rules.

2. Integrate cleanly with **`@tradentic/resilient-http-core` v0.6**:
   - Implement guardrails as one or more `HttpRequestInterceptor`s.
   - Use `AgentContext`, `correlationId`, and `extensions` to scope rules by agent/tool.
   - Leverage telemetry hooks (`Logger`, `MetricsSink`, `TracingAdapter`) for observability.

3. Keep the library **agnostic** and **lightweight**:
   - No dependency on specific LLM providers or agent frameworks.
   - Rules expressed in generic HTTP + metadata terms.

4. Make guardrails **opt-in and composable**:
   - A single, simple default `createBrowserGuardrailsInterceptor` for most use cases.
   - Extensible rule model for more advanced scenarios.

---

## 2. Non-goals

- Do **not**:
  - Implement HTTP transport or retries (core responsibility).
  - Replace security best practices like OAuth, mTLS, or WAFs.
  - Implement sandboxing or network-level isolation.
  - Tie to a specific browser automation library (e.g. Playwright/Puppeteer).
  - Inject or modify agent prompts.

Guardrails act as a **policy firewall** at the HTTP layer, not as a full security solution.

---

## 3. Conceptual Model

- **Agent** – Logical actor performing HTTP calls (e.g. `rotation-score-agent`, `browser-agent`).
- **Tool** – Named capability exposed to agents that may perform HTTP calls (e.g. `fetch_url`, `download_file`).
- **Guardrail Rule** – One unit of policy describing what is allowed or denied (and optionally why).
- **Guardrail Engine** – Evaluates HTTP requests against a set of rules and returns a decision.
- **Guardrail Decision** – `allow`, `modify`, or `deny` an HTTP request.

All of the above are expressed strictly in terms of:

- HTTP request properties (`url`, `method`, `headers`, `body size`, `content-type`), and
- Agent/Tool metadata embedded via `AgentContext` and `HttpRequestOptions.extensions`.

---

## 4. Data Model & Types

### 4.1 GuardrailScope

Scope is used to target rules at particular agents, tools, or environments.

```ts
export interface GuardrailScope {
  /**
   * Logical agent name — from AgentContext.agent.
   */
  agent?: string;

  /**
   * Tool identifier (e.g. 'browser.fetch', 'scraper.download').
   * Typically sourced from HttpRequestOptions.extensions['tool.id'].
   */
  toolId?: string;

  /**
   * Optional tenant / project / environment identifier.
   */
  tenantId?: string;

  /**
   * Optional tag for the kind of operation; e.g. 'browser', 'api', 'download'.
   * Typically sourced from extensions['guardrail.kind'] or similar.
   */
  kind?: string;
}
```

`GuardrailScope` is a **matching filter** — omitted fields act as wildcards.

### 4.2 Host & URL Constraints

```ts
export interface HostPattern {
  /**
   * Hostname, optionally with wildcards: 'example.com', '*.example.com'.
   */
  host: string;

  /** Optional allowed schemes; default is ['https']. */
  schemes?: string[]; // e.g. ['https', 'http']

  /** Optional allowed ports; if omitted, defaults to 80/443 per scheme. */
  ports?: number[];
}

export interface UrlPattern {
  /** Optional host pattern filter. */
  host?: HostPattern;

  /**
   * Optional path pattern; simple glob (e.g. '/api/*') or prefix (e.g. '/docs/').
   * v0.1 can implement prefix-only; glob support is a future enhancement.
   */
  pathPrefix?: string;

  /** Optional query parameter allow/deny list (v0.1: allow-only). */
  allowedQueryParams?: string[];
}
```

### 4.3 Method & Header Constraints

```ts
export type HttpMethod =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | 'TRACE'
  | string; // extensible

export interface MethodRule {
  /** Allowed HTTP methods. */
  allow?: HttpMethod[];

  /** Explicitly denied HTTP methods. */
  deny?: HttpMethod[];
}

export interface HeaderRule {
  /**
   * Allowed header names (case-insensitive). If set, any header not in this list
   * may be stripped or cause denial according to the rule.
   */
  allowedHeaders?: string[];

  /**
   * Headers that are explicitly forbidden, e.g. 'Authorization' in a browser agent
   * that must not forward user secrets.
   */
  deniedHeaders?: string[];

  /**
   * Header value patterns to deny (e.g. block certain origins, tokens, etc.).
   * v0.1 can implement simple substring or exact match.
   */
  deniedValueSubstrings?: Record<string, string[]>; // headerName -> substrings
}
```

### 4.4 Body & Content-Type Constraints

```ts
export interface BodyRule {
  /** Max allowed body size in bytes. */
  maxBytes?: number;

  /**
   * Optional allowed content types (prefix match, e.g. 'application/json').
   * If omitted, any content-type is allowed unless blocked by other rules.
   */
  allowedContentTypes?: string[];

  /** Explicitly denied content types. */
  deniedContentTypes?: string[];
}
```

### 4.5 GuardrailRule

A single rule definition:

```ts
export type GuardrailEffect = 'allow' | 'deny';

export interface GuardrailRule {
  /** Unique identifier for the rule. */
  id: string;

  /** Optional scope filter (agent, tool, tenant, kind). */
  scope?: GuardrailScope;

  /** Optional URL-level constraints. */
  url?: {
    /** Allowed URL patterns; if present, everything else is denied (within this rule). */
    allow?: UrlPattern[];
    /** Explicitly denied URL patterns. */
    deny?: UrlPattern[];
  };

  /** Optional method-level constraints. */
  methods?: MethodRule;

  /** Optional header-level constraints. */
  headers?: HeaderRule;

  /** Optional body/content-type constraints. */
  body?: BodyRule;

  /**
   * Overall effect when this rule matches. In v0.1, rules are primarily
   * allow/deny. Future versions can support 'audit' or 'modify'.
   */
  effect: GuardrailEffect;

  /**
   * Optional human-readable description for logs and diagnostics.
   */
  description?: string;

  /**
   * Priority of this rule relative to others. Higher values are evaluated later
   * and can override lower-priority decisions.
   */
  priority?: number;
}
```

### 4.6 GuardrailDecision

The outcome returned by the guardrail engine for a specific request.

```ts
export type GuardrailDecisionType = 'allow' | 'deny'; // v0.1

export interface GuardrailDecision {
  type: GuardrailDecisionType;

  /**
   * Rules that contributed to the decision, in evaluation order.
   */
  ruleIds: string[];

  /**
   * A short machine-readable code for the reason (e.g. 'HOST_NOT_ALLOWED').
   */
  reasonCode?: string;

  /** Human-readable explanation for logs and error messages. */
  reason?: string;

  /**
   * Optional safe URL preview (scheme/host/path) for logging when the full
   * URL must not be logged.
   */
  safeUrlPreview?: string;
}
```

---

## 5. Guardrail Engine API

### 5.1 Request Context

A simplified view of an HTTP request relevant to guardrails.

```ts
export interface GuardrailRequestContext {
  /** Parsed URL. */
  url: URL;

  /** HTTP method. */
  method: HttpMethod;

  /** Request headers (normalized to lower-case keys). */
  headers: Record<string, string>;

  /**
   * Optional body length in bytes (if known). If unknown, guardrails may
   * treat it as unbounded for maxBytes checks.
   */
  bodyLength?: number;

  /**
   * Optional content-type header parsed aside from headers.
   */
  contentType?: string;

  /** Scope derived from AgentContext and extensions. */
  scope: GuardrailScope;

  /** Raw HttpRequestOptions (for advanced, user-defined rules). */
  requestOptions: HttpRequestOptions;
}
```

### 5.2 Engine Interface

```ts
export interface GuardrailEngine {
  /** Evaluate guardrails for a request and return a decision. */
  evaluate(ctx: GuardrailRequestContext): Promise<GuardrailDecision>;
}
```

### 5.3 InMemoryGuardrailEngine (v0.1)

- Holds an in-memory list of `GuardrailRule`s.
- Evaluation strategy:
  1. Compute a derived `GuardrailScope` from `AgentContext` and `extensions`.
  2. Filter rules whose `scope` matches the request scope.
  3. Sort applicable rules by `priority` ascending, then rule `id` for stability.
  4. For each rule:
     - Check URL constraints (host, scheme, port, path, query).
     - Check method constraints.
     - Check headers and body constraints.
     - If all constraints are satisfied, apply the rule’s `effect` (`allow`/`deny`).
  5. If no rule matches:
     - Default policy is configurable (e.g. **deny by default** for browser agents).

- v0.1 may support only **exact** and **prefix** checks; advanced pattern matching is a future enhancement.

---

## 6. Integration with `resilient-http-core` v0.6

### 6.1 Interceptor Configuration

```ts
export interface BrowserGuardrailsInterceptorConfig {
  /** Guardrail engine instance (typically InMemoryGuardrailEngine for v0.1). */
  engine: GuardrailEngine;

  /**
   * Optional function to derive GuardrailScope from HttpRequestOptions.
   * If omitted, use a default mapping.
   */
  scopeMapper?: (opts: HttpRequestOptions) => GuardrailScope;

  /**
   * Optional logger; if omitted, rely on HttpClient’s logger.
   */
  logger?: Logger;

  /**
   * If true, full URLs will never be logged; only safeUrlPreview will be used.
   */
  redactUrlsInLogs?: boolean;
}

export function createBrowserGuardrailsInterceptor(
  config: BrowserGuardrailsInterceptorConfig,
): HttpRequestInterceptor;
```

### 6.2 Default Scope Mapping

Default `scopeMapper` should:

- Use `AgentContext`:
  - `agent` from `opts.agentContext?.agent`.
- Use `extensions`:
  - `toolId` from `opts.extensions?.['tool.id']` or `opts.extensions?.['agent.toolId']`.
  - `tenantId` from `opts.extensions?.['tenant.id']`.
  - `kind` from `opts.extensions?.['guardrail.kind']` or fallback `'browser'` when used by AI browsers.

This ensures rules can be targeted like:

- “Allow only `GET` on `https://en.wikipedia.org/*` for `browser-agent`.”
- “Deny any POST/PUT/PATCH/DELETE for `toolId='browser.fetch'`.”

### 6.3 Interceptor Behaviour

- `beforeSend`:
  1. Parse `opts.url` into a `URL` instance.
  2. Build `GuardrailRequestContext` from `HttpRequestOptions`:
     - `url`, `method`, headers, `bodyLength` (if available from options/metadata), `contentType`.
     - `scope` from `scopeMapper` or default mapping.
  3. Call `engine.evaluate(ctx)`.
  4. If decision is `deny`:
     - Log a warning/error via `logger` or HttpClient logger.
     - Emit metrics via `MetricsSink` if configured (e.g. `guardrail_blocked_requests` counter).
     - Throw a `GuardrailViolationError` (custom error type) containing:

       ```ts
       class GuardrailViolationError extends Error {
         constructor(
           message: string,
           public readonly decision: GuardrailDecision,
         ) {
           super(message);
           this.name = 'GuardrailViolationError';
         }
       }
       ```

  5. If decision is `allow`, return `opts` unchanged.

- `afterResponse` / `onError`:
  - v0.1 does **not** modify responses; guardrails are purely pre-flight.
  - Optional enhancement: emit telemetry about allowed/denied requests.

### 6.4 Interaction with Policies & Resilience

- Guardrails run **before** the request is sent, typically early in the interceptor chain.
- `@airnub/resilient-http-policies` can run alongside guardrails, but they serve different purposes:
  - Guardrails: *safety and allowed-surface area*.
  - Policies: *budgets and rate limits*.
- Both can use the same metadata from `AgentContext` and `extensions`.

---

## 7. Configuration Patterns & Examples

> These are patterns for documentation and tests; actual examples in code/docs.

### 7.1 Safe Read-Only Browser Agent

- Agent: `browser-agent`.
- Tool: `browser.fetch`.
- Rules:
  - Only `GET` and `HEAD`.
  - Only `https`.
  - Only whitelisted hosts: `en.wikipedia.org`, `*.trusted.com`.
  - Max body size: e.g. 1 MB.

### 7.2 Internal API Tool with Strict Headers

- Tool: `internal.api.fetch`.
- Rules:
  - Allowed hosts: `api.internal.local`.
  - Allow `GET`, `POST`.
  - Strip or deny any custom `Authorization` header unless explicitly allowed.

### 7.3 Tenant-Specific Restrictions

- Use `extensions['tenant.id']` for tenant-based limitations.
- Example: for free-tier tenants, deny all requests to certain expensive domains or large downloads.

---

## 8. Testing & Validation

The initial implementation should include tests for:

1. **Scope matching**
   - Rules targeting specific agents/tools vs wildcard.
   - Tenant/kind-based rules.

2. **URL & host restrictions**
   - Allowed hosts and paths.
   - Denied hosts.
   - Scheme and port restrictions.

3. **Methods & headers**
   - Denying unsafe methods (e.g. POST/PUT) for browser agents.
   - Blocking denied headers and header value substrings.

4. **Body & content-type limits**
   - Enforcing `maxBytes` when `bodyLength` is provided.
   - Blocking denied content types.

5. **Interceptor behaviour**
   - `createBrowserGuardrailsInterceptor` denies disallowed requests by throwing `GuardrailViolationError`.
   - Allowed requests pass through unchanged.

6. **Telemetry hooks (basic)**
   - Guardrail decisions are logged with minimal but useful information.

---

## 9. Future Extensions (Beyond v0.1)

- **Response guardrails**:
  - Inspect responses (content-type, size, safety signals) and optionally block or redact.

- **Adaptive policies**:
  - Combine with `@airnub/resilient-http-policies` for dynamic tightening/loosening of guardrails based on observed behaviour.

- **Richer pattern matching**:
  - RegExp or glob-based path and query matching.

- **Admin APIs & configuration**:
  - Hot-reloadable rule sets from a config service.

- **UI tooling**:
  - Visual rule editors and diff tools for ops teams.

v0.1 focuses on a clean, composable guardrail layer that can be wired into any AI agent/browsing workflow on top of `@tradentic/resilient-http-core` v0.6, without introducing provider- or framework-specific assumptions.

