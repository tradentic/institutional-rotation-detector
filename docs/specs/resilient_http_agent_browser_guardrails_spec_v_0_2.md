# Agent Browser Guardrails — Specification v0.2.0

> **Status:** Draft, aligned with `@airnub/resilient-http-core` v0.7.0 and `@airnub/resilient-http-policies` v0.3.0  
> **Scope:** Surface-level guardrails for AI-driven HTTP and browser navigation (host/path/method restrictions, header redaction, and URL classification).  
> **Non-goals:** Content-level safety (prompt/response moderation), LLM policy steering, or quota/rate-limiting (those live in other satellites).

This document defines `@airnub/agent-browser-guardrails` v0.2.0. It is intended to be complete enough for a developer or coding agent to implement the library using only this spec plus `resilient-http-core` v0.7.0 and, optionally, `resilient-http-policies` v0.3.0.

---

## 1. Design Goals & Principles

1. **Surface-centric safety for agents**  
   Guard what *surfaces* an AI agent can touch (which hosts, which paths, which methods, which headers), not what words it says.

2. **Provider- and transport-agnostic**  
   Guardrails focus on URLs, hosts, and HTTP semantics. Integration with HTTP happens via `HttpRequestInterceptor`. Integration with headless browsers happens via a simple `BrowserNavigationGuard` interface.

3. **Config-driven, small core**  
   A small rule language (`GuardrailRule` + `GuardrailSelector` + `GuardrailAction`) that can be expressed as JSON/YAML and embedded in any app.

4. **Composability with policies**  
   Guardrails answer: *“Is this surface allowed at all?”* Policies answer: *“Is this allowed right now given quotas?”* Their errors and interceptors are distinct and composable.

5. **Zero external dependencies by default**  
   A reference `InMemoryGuardrailEngine` MUST be provided and require no DB/Redis.

---

## 2. Dependencies & Environment

### 2.1 Type Dependencies

This package depends on types from `@airnub/resilient-http-core` v0.7:

```ts
import type {
  HttpMethod,
  HttpHeaders,
  HttpRequestOptions,
  HttpRequestInterceptor,
  AgentContext,
  Extensions,
} from "@airnub/resilient-http-core";
```

It does **not** depend on `HttpClient` directly; the HTTP integration happens via interceptors that are provided a `clientName` by closure.

### 2.2 Runtime Assumptions

- TypeScript/JavaScript targeting ES2019+.
- Standard `URL` class available in the runtime (or polyfill).

---

## 3. Core Concepts & Types

### 3.1 GuardedRequestKind

```ts
export type GuardedRequestKind =
  | "http-request"       // outbound HTTP performed via HttpClient
  | "browser-navigation"; // navigation/load in a browser-like environment
```

### 3.2 GuardrailScope (Runtime View)

`GuardrailScope` is the normalized view of a URL/surface presented to the engine.

```ts
export interface GuardrailScope {
  kind: GuardedRequestKind;

  /** Full URL as requested (may be relative before normalization). */
  url: string;

  /** Parsed URL components after normalization. */
  protocol: string;      // e.g. "http:", "https:"
  hostname: string;      // e.g. "api.example.com"
  port?: number;         // derived from URL or default (80/443)
  pathname: string;      // e.g. "/v1/resources"
  search?: string;       // raw query string, e.g. "?q=foo"

  /** HTTP-specific details; undefined for pure navigation contexts. */
  method?: HttpMethod;
  headers?: HttpHeaders;
  contentType?: string;        // from headers["content-type"] if any
  bodySizeBytes?: number;      // optional hint from caller

  /** Optional classification hints (e.g. first-party vs third-party). */
  category?: string;           // free-form, e.g. "first-party-api", "login"

  /** Agent identity and metadata. */
  agentContext?: AgentContext;
  extensions?: Extensions;
}
```

**Normalization rules (reference behaviour):**

- `protocol`, `hostname`, `pathname`, `search` MUST be derived using the standard `URL` parser.
- `port` should be set explicitly even for default ports if the implementation chooses (but this is not required by the spec, only recommended for deterministic matching).
- `contentType` MAY be taken from `headers['content-type']` in a case-insensitive way.

### 3.3 Config View — StringMatcher & Patterns

```ts
export type StringMatcher = string | string[] | "*";
```

For host and path patterning, the following conventions are used:

- Host patterns MAY include a leading wildcard:
  - `"example.com"` matches exactly `example.com`.
  - `"*.example.com"` matches `foo.example.com` but **not** `example.com`.
- Path patterns are simple prefix match strings:
  - `"/api/"` matches `/api/users` and `/api/v1/items`.
  - `"/"` matches all paths.

```ts
export interface GuardrailSelector {
  protocol?: StringMatcher;    // e.g. "https:" or ["https:", "http:"]
  hostname?: StringMatcher;    // exact or leading-wildcard
  port?: number | number[];
  pathPrefix?: StringMatcher;  // prefix pattern(s) as described above

  method?: HttpMethod | HttpMethod[];

  /** Optional category/tag match (e.g. "first-party-api", "login"). */
  category?: StringMatcher;

  /**
   * Optional tenant/agent filters derived from extensions or AgentContext.
   * These are free-form and only meaningful if the caller populates them.
   */
  tenantId?: StringMatcher;    // e.g. extensions["tenant.id"]
  agentName?: StringMatcher;   // e.g. agentContext.agent
}
```

Matching semantics:

- If a selector field is `undefined`, it does not constrain the scope.
- `StringMatcher` semantics are the same as in the policies spec:
  - `"*"` matches any non-empty value.
  - `string` matches exact (hostnames honour wildcard semantics described above).
  - `string[]` matches if any element matches.
- `pathPrefix` is a prefix match on `scope.pathname` (case-sensitive).

### 3.4 Rule Keys & Priority

```ts
export type GuardrailRuleKey = string;   // unique identifier
export type GuardrailPriority = number;  // larger number = higher priority
```

Higher priority rules win when multiple rules would conflict.

### 3.5 Guardrail Actions

```ts
export type GuardrailEffect =
  | "allow"       // allow request/navigation, possibly after sanitation
  | "block";      // prevent request/navigation entirely

export interface HeaderRedactionConfig {
  /** Header names to remove (case-insensitive) before sending. */
  stripHeaders?: string[];
  /** If provided, only these headers are allowed; others are removed. */
  allowOnlyHeaders?: string[];
}

export interface QueryParamMaskConfig {
  /** Query parameter names whose values should be masked or dropped. */
  maskParams?: string[];
  /** If true, masked params are removed entirely; else, set to "***". */
  dropMaskedParams?: boolean;
}

export interface BodyGuardrailConfig {
  /** Maximum allowed body size in bytes; larger bodies are blocked. */
  maxBodyBytes?: number;
  /** Optional allowed content-types (prefix match, e.g. "application/json"). */
  allowedContentTypes?: string[];
}

export interface GuardrailAction {
  effect: GuardrailEffect;

  /** Header redaction/sanitization rules. */
  headers?: HeaderRedactionConfig;

  /** Query parameter masking rules. */
  query?: QueryParamMaskConfig;

  /** Request body constraints. */
  body?: BodyGuardrailConfig;

  /** Optional human-readable reason or hint for logs/UX. */
  reason?: string;
}
```

### 3.6 GuardrailRule

```ts
export interface GuardrailRule {
  key: GuardrailRuleKey;
  description?: string;

  /** Which scopes this rule applies to. */
  selector: GuardrailSelector;

  /** Priority; higher number wins. Default: 0. */
  priority?: GuardrailPriority;

  /** Action to apply when this rule matches. */
  action: GuardrailAction;
}
```

---

## 4. Decisions, Results, and Engine Interface

### 4.1 GuardrailDecision

`GuardrailDecision` is the runtime decision from the engine.

```ts
export interface GuardrailDecision extends GuardrailAction {
  /** Rule key that produced this decision, if any. */
  ruleKey?: GuardrailRuleKey;
}
```

The engine may also produce decisions not directly tied to a rule (e.g. synthetic defaults); in that case, `ruleKey` MAY be omitted.

### 4.2 GuardrailEvaluationContext & Result

```ts
export interface GuardrailEvaluationContext {
  scope: GuardrailScope;
}

export interface GuardrailEvaluationResult {
  /** Final decision. */
  decision: GuardrailDecision;
}
```

### 4.3 GuardrailEngine

```ts
export interface GuardrailEngine {
  /**
   * Evaluate the guardrails for a given scope and return a decision.
   * This MUST NOT perform the actual HTTP or navigation operation.
   */
  evaluate(
    ctx: GuardrailEvaluationContext
  ): Promise<GuardrailEvaluationResult>;
}
```

The engine MUST NOT implement retries or timeouts and MUST NOT modify requests directly. That is the job of callers / interceptors.

---

## 5. Errors & Violation Handling

### 5.1 GuardrailViolationError

If a guardrail decides to block, integration layers MUST throw a `GuardrailViolationError`.

```ts
export class GuardrailViolationError extends Error {
  readonly ruleKey?: GuardrailRuleKey;
  readonly scope: GuardrailScope;
  readonly reason?: string;

  constructor(options: {
    message?: string;
    ruleKey?: GuardrailRuleKey;
    scope: GuardrailScope;
    reason?: string;
  }) {
    super(options.message ?? "Request blocked by browser guardrails");
    this.name = "GuardrailViolationError";
    this.ruleKey = options.ruleKey;
    this.scope = options.scope;
    this.reason = options.reason;
  }
}
```

### 5.2 Relationship to Policies

- `GuardrailViolationError` indicates that a *surface* is not allowed at all (e.g. host/path forbidden).  
- `PolicyDeniedError` (from `resilient-http-policies`) indicates that a surface is allowed but not under current quota/conditions.

Applications MAY:

- Treat `GuardrailViolationError` as a harder failure class (e.g. not retryable, surfaced to users/admins).  
- Treat `PolicyDeniedError` as a softer, quota-related failure.

---

## 6. HTTP Integration — createHttpGuardrailInterceptor

### 6.1 HttpGuardrailInterceptorOptions

```ts
export interface HttpGuardrailInterceptorOptions {
  /** Logical client name for logging and matching (from HttpClientConfig). */
  clientName: string;

  /** Guardrail engine to use. */
  engine: GuardrailEngine;

  /** Optional classification function for category/tenant metadata. */
  classifyScope?: (request: HttpRequestOptions) => Partial<{
    category: string;
    tenantId: string;
  }>;
}
```

### 6.2 createHttpGuardrailInterceptor

```ts
export function createHttpGuardrailInterceptor(
  options: HttpGuardrailInterceptorOptions
): HttpRequestInterceptor;
```

### 6.3 Interceptor Behaviour

For each attempt (`beforeSend`):

1. Construct a URL string from `HttpRequestOptions`:
   - Prefer `options.url` if present.
   - Otherwise, combine `options.urlParts.baseUrl` + `options.urlParts.path` + query.

2. Build a `GuardrailScope`:
   - `kind = "http-request"`.
   - Parse the URL via `new URL(url)` to get `protocol`, `hostname`, `port`, `pathname`, `search`.
   - Map `options.method`, `options.headers`, `options.agentContext`, `options.extensions`.
   - Infer `contentType` from headers.
   - If `classifyScope` is provided, merge its `category` and `tenantId` into `scope`.

3. Call `engine.evaluate({ scope })` and obtain `decision`.

4. If `decision.effect === "block"`:
   - Throw `GuardrailViolationError` with `scope`, `decision.ruleKey`, and `decision.reason`.

5. If `decision.effect === "allow"`:
   - Apply header redaction:
     - If `decision.headers?.allowOnlyHeaders` present: remove all other headers (case-insensitive).
     - Then remove any `decision.headers?.stripHeaders`.
   - Apply query param masking on the URL:
     - If `decision.query` provided, mask or drop specified params and update the URL in `HttpRequestOptions` (or `urlParts.query`).
   - Enforce body constraints:
     - If `decision.body?.maxBodyBytes` is provided and `request.bodySizeBytes` is known and exceeds it, throw `GuardrailViolationError`.
     - If `decision.body?.allowedContentTypes` present and `contentType` is known and does not match any prefix, throw `GuardrailViolationError`.

6. Continue request pipeline.

The interceptor MUST NOT modify `request.method` or perform any retries. It is strictly pre-flight validation and sanitization.

---

## 7. Browser Navigation Integration

Many agent stacks use a headless browser (e.g. Playwright) in addition to raw HTTP. For these, guardrails are applied before navigation.

### 7.1 BrowserNavigationRequest

```ts
export interface BrowserNavigationRequest {
  url: string;
  /** Optional referring URL, if known. */
  referrer?: string;

  agentContext?: AgentContext;
  extensions?: Extensions;

  /** Optional category hint (e.g. "search", "docs", "product-page"). */
  category?: string;
}
```

### 7.2 BrowserNavigationGuard

```ts
export interface BrowserNavigationGuard {
  /**
   * Evaluate navigation; MUST throw GuardrailViolationError on block.
   */
  checkNavigation(request: BrowserNavigationRequest): Promise<GuardrailDecision>;
}
```

### 7.3 createBrowserNavigationGuard

```ts
export interface BrowserNavigationGuardOptions {
  engine: GuardrailEngine;
}

export function createBrowserNavigationGuard(
  options: BrowserNavigationGuardOptions
): BrowserNavigationGuard;
```

**Behaviour:**

- For `checkNavigation`:
  - Parse `request.url` into a `GuardrailScope` with `kind = "browser-navigation"`.
  - Map `agentContext`, `extensions`, and `category` into the scope.
  - Call `engine.evaluate({ scope })`.
  - If `effect === "block"`, throw `GuardrailViolationError`.
  - Else, return the `GuardrailDecision`.

The decision MAY be used by higher layers to add extra hints (e.g. log or annotate the navigation), but it does not directly modify the browser API.

---

## 8. In-Memory Guardrail Engine

### 8.1 InMemoryGuardrailEngineConfig

```ts
export interface InMemoryGuardrailEngineConfig {
  rules: GuardrailRule[];

  /** Optional default action if no rule matches. Default: block all. */
  defaultAction?: GuardrailAction;
}
```

### 8.2 createInMemoryGuardrailEngine

```ts
export function createInMemoryGuardrailEngine(
  config: InMemoryGuardrailEngineConfig
): GuardrailEngine;
```

### 8.3 Behavioural Guidelines

The in-memory engine MUST:

- Match rules using `GuardrailSelector` semantics.
- If multiple rules match:
  - Select rule with highest `priority`.
  - If equal priority, break ties deterministically (e.g. by lexicographic `key`).
- If no rule matches:
  - Use `defaultAction` if provided.
  - Else, treat as `effect: "block"` with a generic reason (e.g. "No matching guardrail rule; default deny").

The engine SHOULD:

- Be purely synchronous in memory, though the interface uses `Promise` to allow future async engines.
- Have no side effects beyond evaluating rules.

---

## 9. Opinionated Helper Factories

To support out-of-the-box safe defaults, the package MUST provide at least one convenience helper.

### 9.1 createHostAllowlistGuardrails

```ts
export interface HostAllowlistGuardrailsOptions {
  /** Allowed hostnames (exact or wildcard, e.g. "*.example.com"). */
  allowedHosts: string[];

  /** Optional additional allowed protocols; default: ["https:"] */
  allowedProtocols?: string[];

  /** Optional list of headers that are always stripped on third-party hosts. */
  sensitiveHeaders?: string[]; // e.g. ["authorization", "cookie"]
}

export function createHostAllowlistGuardrails(
  opts: HostAllowlistGuardrailsOptions
): GuardrailEngine;
```

**Reference behaviour:**

- Build an `InMemoryGuardrailEngine` with rules that:
  - Allow `https:` (and optionally `http:`) to the allowlisted hosts.
  - Block all other hosts.
  - Strip `sensitiveHeaders` for any host that is not explicitly allowlisted (if desired, or simply block them).

This helper is intended for:

- “I only want my agent to touch these domains and nothing else.”

---

## 10. Versioning & Stability

The following are the **stable surface** of `@airnub/agent-browser-guardrails` v0.2.0 and SHOULD maintain backwards compatibility (with only additive changes) through 0.2.x and 1.x:

- Types:
  - `GuardedRequestKind`
  - `GuardrailScope`
  - `StringMatcher`
  - `GuardrailSelector`
  - `GuardrailRuleKey`
  - `GuardrailPriority`
  - `GuardrailEffect`
  - `HeaderRedactionConfig`
  - `QueryParamMaskConfig`
  - `BodyGuardrailConfig`
  - `GuardrailAction`
  - `GuardrailRule`
  - `GuardrailDecision`
  - `GuardrailEvaluationContext`
  - `GuardrailEvaluationResult`
  - `GuardrailEngine`
  - `GuardrailViolationError`
  - `HttpGuardrailInterceptorOptions`
  - `BrowserNavigationRequest`
  - `BrowserNavigationGuard`
  - `BrowserNavigationGuardOptions`
  - `InMemoryGuardrailEngineConfig`
  - `HostAllowlistGuardrailsOptions`

- Functions/classes:
  - `createHttpGuardrailInterceptor`
  - `createBrowserNavigationGuard`
  - `createInMemoryGuardrailEngine`
  - `createHostAllowlistGuardrails`
  - `GuardrailViolationError`

Breaking changes to these MUST be reserved for a major version.

---

## 11. Reference Implementation Notes (Non-normative)

1. **Pattern matching helpers**  
   Implement small helpers for wildcard host matching and path prefix matching. Avoid complex regex DSLs in the spec; keep behaviour predictable.

2. **Header name case-insensitivity**  
   When applying redaction rules, normalise header names to a common case (e.g. lower-case) for comparison, but preserve original casing when forwarding if needed.

3. **URL reconstruction**  
   When modifying query params via the interceptor, carefully reconstruct the URL or `urlParts` so that downstream layers see a consistent view.

4. **Test matrix**  
   Include tests for:
   - Allow/block combinations for hosts, protocols, and paths.
   - Header redaction (strip vs allow-only).
   - Query masking modes (drop vs `***`).
   - Body size and content-type enforcement.
   - Interaction with `HttpClient` and policies (e.g. that `GuardrailViolationError` vs `PolicyDeniedError` are distinct).

5. **Local development presets**  
   Consider shipping a small preset for local dev (e.g. allow `localhost`, `127.0.0.1`, and a configured dev domain) but keep production defaults locked down (deny by default unless explicitly allowed).

With this specification, a developer or coding agent can implement `@airnub/agent-browser-guardrails` v0.2.0, wire it into `@airnub/resilient-http-core` via interceptors, and protect both HTTP calls and browser navigations driven by AI agents with a small, expressive, config-driven rule set.

