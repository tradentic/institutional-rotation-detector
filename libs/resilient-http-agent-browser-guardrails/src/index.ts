import type {
  AgentContext,
  BeforeSendContext,
  Extensions,
  HttpHeaders,
  HttpMethod,
  HttpRequestInterceptor,
  HttpRequestOptions,
} from "@airnub/resilient-http-core";

export type GuardedRequestKind = "http-request" | "browser-navigation";

export type StringMatcher = string | string[] | "*";

export type GuardrailRuleKey = string;
export type GuardrailPriority = number;

export interface GuardrailSelector {
  protocol?: StringMatcher;
  hostname?: StringMatcher;
  port?: number | number[];
  pathPrefix?: StringMatcher;
  method?: HttpMethod | HttpMethod[];
  category?: StringMatcher;
  tenantId?: StringMatcher;
  agentName?: StringMatcher;
}

export interface HeaderRedactionConfig {
  stripHeaders?: string[];
  allowOnlyHeaders?: string[];
}

export interface QueryParamMaskConfig {
  maskParams?: string[];
  dropMaskedParams?: boolean;
}

export interface BodyGuardrailConfig {
  maxBodyBytes?: number;
  allowedContentTypes?: string[];
}

export type GuardrailEffect = "allow" | "block";

export interface GuardrailAction {
  effect: GuardrailEffect;
  headers?: HeaderRedactionConfig;
  query?: QueryParamMaskConfig;
  body?: BodyGuardrailConfig;
  reason?: string;
}

export interface GuardrailDecision extends GuardrailAction {
  ruleKey?: GuardrailRuleKey;
}

export interface GuardrailScope {
  kind: GuardedRequestKind;
  url: string;
  protocol: string;
  hostname: string;
  port?: number;
  pathname: string;
  search?: string;
  method?: HttpMethod;
  headers?: HttpHeaders;
  contentType?: string;
  bodySizeBytes?: number;
  category?: string;
  agentContext?: AgentContext;
  extensions?: Extensions;
}

interface ScopeBuilderInput {
  url: string;
  kind: GuardedRequestKind;
  method?: HttpMethod;
  headers?: HttpHeaders;
  agentContext?: AgentContext;
  extensions?: Extensions;
  category?: string;
  bodySizeBytes?: number;
}

export interface GuardrailRule {
  key: GuardrailRuleKey;
  description?: string;
  selector: GuardrailSelector;
  priority?: GuardrailPriority;
  action: GuardrailAction;
}

export interface GuardrailEvaluationContext {
  scope: GuardrailScope;
}

export interface GuardrailEvaluationResult {
  decision: GuardrailDecision;
}

export interface GuardrailEngine {
  evaluate(ctx: GuardrailEvaluationContext): Promise<GuardrailEvaluationResult>;
}

export class GuardrailViolationError extends Error {
  readonly ruleKey?: GuardrailRuleKey;
  readonly scope: GuardrailScope;
  readonly reason?: string;

  constructor(options: { message?: string; ruleKey?: GuardrailRuleKey; scope: GuardrailScope; reason?: string }) {
    super(options.message ?? "Request blocked by browser guardrails");
    this.name = "GuardrailViolationError";
    this.ruleKey = options.ruleKey;
    this.scope = options.scope;
    this.reason = options.reason;
  }
}

export interface GuardrailEvaluation {
  engine: GuardrailEngine;
}

export interface HttpGuardrailInterceptorOptions {
  clientName: string;
  engine: GuardrailEngine;
  classifyScope?: (request: HttpRequestOptions) => Partial<{ category: string; tenantId: string }>;
}

export interface BrowserNavigationRequest {
  url: string;
  referrer?: string;
  agentContext?: AgentContext;
  extensions?: Extensions;
  category?: string;
}

export interface BrowserNavigationGuard {
  checkNavigation(request: BrowserNavigationRequest): Promise<GuardrailDecision>;
}

export function createBrowserNavigationGuard(options: { engine: GuardrailEngine }): BrowserNavigationGuard {
  return {
    async checkNavigation(request) {
      const scope: GuardrailScope = buildScopeFromUrl({
        url: request.url,
        kind: "browser-navigation",
        method: undefined,
        headers: undefined,
        agentContext: request.agentContext,
        extensions: request.extensions,
        category: request.category,
      });
      const result = await options.engine.evaluate({ scope });
      if (result.decision.effect === "block") {
        throw new GuardrailViolationError({
          scope,
          ruleKey: result.decision.ruleKey,
          reason: result.decision.reason,
        });
      }
      return result.decision;
    },
  };
}

export interface InMemoryGuardrailEngineConfig {
  rules: GuardrailRule[];
  defaultAction?: GuardrailAction;
}

export function createInMemoryGuardrailEngine(config: InMemoryGuardrailEngineConfig): GuardrailEngine {
  const rules = config.rules.slice();
  const defaultAction: GuardrailAction = config.defaultAction ?? { effect: "block", reason: "No matching guardrail rule" };

  const engine: GuardrailEngine = {
    async evaluate(ctx) {
      const matched = rules
        .filter((rule) => matchesSelector(ctx.scope, rule.selector))
        .sort((a, b) => {
          const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
          if (priorityDiff !== 0) return priorityDiff;
          return a.key.localeCompare(b.key);
        });
      const decisionRule = matched[0];
      if (!decisionRule) {
        return { decision: { ...defaultAction } };
      }
      return { decision: { ...decisionRule.action, ruleKey: decisionRule.key } };
    },
  };
  return engine;
}

export interface HostAllowlistGuardrailsOptions {
  allowedHosts: string[];
  allowedProtocols?: string[];
  sensitiveHeaders?: string[];
}

export function createHostAllowlistGuardrails(opts: HostAllowlistGuardrailsOptions): GuardrailEngine {
  const protocols = opts.allowedProtocols ?? ["https:"];
  const allowedHosts = opts.allowedHosts;
  const sensitiveHeaders = opts.sensitiveHeaders ?? [];
  const rules: GuardrailRule[] = [
    {
      key: "allow-listed-hosts",
      selector: { protocol: protocols, hostname: allowedHosts, pathPrefix: "/" },
      priority: 10,
      action: { effect: "allow" },
    },
    {
      key: "strip-sensitive-third-party",
      selector: { protocol: protocols, hostname: "*", pathPrefix: "/" },
      priority: 1,
      action: { effect: "allow", headers: { stripHeaders: sensitiveHeaders } },
    },
  ];

  return createInMemoryGuardrailEngine({
    rules,
    defaultAction: { effect: "block", reason: "Host not allowlisted" },
  });
}

function matchesStringMatcher(value: string | undefined, matcher: StringMatcher | undefined): boolean {
  if (matcher === undefined) return true;
  if (matcher === "*") return value !== undefined && value !== "";
  if (Array.isArray(matcher)) return matcher.some((m) => matchesStringMatcher(value, m));
  if (value === undefined) return false;
  if (matcher.startsWith("*")) {
    const suffix = matcher.slice(1);
    return value.endsWith(suffix) && value.length > suffix.length;
  }
  return value === matcher;
}

function matchesPathPrefix(value: string | undefined, matcher: StringMatcher | undefined): boolean {
  if (matcher === undefined) return true;
  if (value === undefined) return false;
  if (matcher === "*") return true;
  if (Array.isArray(matcher)) return matcher.some((m) => matchesPathPrefix(value, m));
  return value.startsWith(matcher);
}

function matchesHost(value: string | undefined, matcher: StringMatcher | undefined): boolean {
  if (matcher === undefined) return true;
  if (matcher === "*") return value !== undefined && value !== "";
  if (Array.isArray(matcher)) return matcher.some((m) => matchesHost(value, m));
  if (!value) return false;
  if (matcher.startsWith("*")) {
    const suffix = matcher.slice(1);
    return value === suffix || value.endsWith(`.${suffix}`);
  }
  return value === matcher;
}

function matchesPort(value: number | undefined, matcher: number | number[] | undefined): boolean {
  if (matcher === undefined) return true;
  if (Array.isArray(matcher)) return matcher.includes(value ?? -1);
  return value === matcher;
}

function matchesSelector(scope: GuardrailScope, selector: GuardrailSelector): boolean {
  if (!matchesStringMatcher(scope.protocol, selector.protocol)) return false;
  if (!matchesHost(scope.hostname, selector.hostname)) return false;
  if (!matchesPort(scope.port, selector.port)) return false;
  if (!matchesPathPrefix(scope.pathname, selector.pathPrefix)) return false;
  if (!matchesMethod(scope.method, selector.method)) return false;
  if (!matchesStringMatcher(scope.category, selector.category)) return false;
  if (!matchesStringMatcher(scope.extensions?.["tenant.id"] as string | undefined, selector.tenantId)) return false;
  if (!matchesStringMatcher(scope.agentContext?.agent, selector.agentName)) return false;
  return true;
}

function matchesMethod(value: HttpMethod | undefined, matcher: HttpMethod | HttpMethod[] | undefined): boolean {
  if (matcher === undefined) return true;
  if (Array.isArray(matcher)) return matcher.includes(value as HttpMethod);
  return value === matcher;
}

function deriveContentType(headers?: HttpHeaders): string | undefined {
  if (!headers) return undefined;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type");
  return entry?.[1];
}

function sanitizeHeaders(headers: HttpHeaders | undefined, config?: HeaderRedactionConfig): HttpHeaders | undefined {
  if (!headers || !config) return headers;
  let sanitized: HttpHeaders = { ...headers };
  if (config.allowOnlyHeaders) {
    const allowed = config.allowOnlyHeaders.map((h) => h.toLowerCase());
    sanitized = Object.fromEntries(
      Object.entries(sanitized).filter(([k]) => allowed.includes(k.toLowerCase()))
    );
  }
  if (config.stripHeaders) {
    const strip = config.stripHeaders.map((h) => h.toLowerCase());
    sanitized = Object.fromEntries(
      Object.entries(sanitized).filter(([k]) => !strip.includes(k.toLowerCase()))
    );
  }
  return sanitized;
}

function applyQueryMask(url: URL, config?: QueryParamMaskConfig): void {
  if (!config) return;
  const maskParams = new Set((config.maskParams ?? []).map((p) => p.toLowerCase()));
  for (const [key] of url.searchParams) {
    if (maskParams.has(key.toLowerCase())) {
      if (config.dropMaskedParams) {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, "***");
      }
    }
  }
}

function enforceBodyConstraints(request: HttpRequestOptions, scope: GuardrailScope, bodyConfig?: BodyGuardrailConfig): void {
  if (!bodyConfig) return;
  const bodySize = getBodySizeBytes(request);
  if (bodyConfig.maxBodyBytes !== undefined && bodySize !== undefined) {
    if (bodySize > bodyConfig.maxBodyBytes) {
      throw new GuardrailViolationError({
        scope,
        reason: "Body too large",
      });
    }
  }
  if (bodyConfig.allowedContentTypes && scope.contentType) {
    const allowed = bodyConfig.allowedContentTypes;
    const matches = allowed.some((ct) => scope.contentType?.startsWith(ct));
    if (!matches) {
      throw new GuardrailViolationError({ scope, reason: "Content-Type not allowed" });
    }
  }
}

function resolveUrl(request: HttpRequestOptions): URL {
  if (request.url) {
    return new URL(request.url);
  }
  if (request.urlParts) {
    const base = request.urlParts.baseUrl ?? "";
    const path = request.urlParts.path ?? "";
    const url = new URL(path, base || "http://localhost");
    const query = request.urlParts.query ?? {};
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        v.forEach((val) => url.searchParams.append(k, String(val)));
      } else {
        url.searchParams.append(k, String(v));
      }
    }
    return url;
  }
  const path = request.path ?? "";
  return new URL(path, "http://localhost");
}

function buildScopeFromUrl(input: ScopeBuilderInput): GuardrailScope {
  const parsed = new URL(input.url);
  return {
    kind: input.kind,
    url: parsed.toString(),
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : undefined,
    pathname: parsed.pathname,
    search: parsed.search || undefined,
    method: input.method,
    headers: input.headers,
    contentType: deriveContentType(input.headers),
    bodySizeBytes: input.bodySizeBytes,
    category: input.category,
    agentContext: input.agentContext,
    extensions: input.extensions,
  };
}

function getBodySizeBytes(request: HttpRequestOptions): number | undefined {
  return (request as { bodySizeBytes?: number }).bodySizeBytes;
}

export function createHttpGuardrailInterceptor(options: HttpGuardrailInterceptorOptions): HttpRequestInterceptor {
  return {
    beforeSend: async ({ request }: BeforeSendContext) => {
      const resolvedUrl = resolveUrl(request);
      const scope: GuardrailScope = {
        kind: "http-request",
        url: resolvedUrl.toString(),
        protocol: resolvedUrl.protocol,
        hostname: resolvedUrl.hostname,
        port: resolvedUrl.port ? Number(resolvedUrl.port) : undefined,
        pathname: resolvedUrl.pathname,
        search: resolvedUrl.search || undefined,
        method: request.method,
        headers: request.headers as HttpHeaders | undefined,
        contentType: deriveContentType(request.headers as HttpHeaders | undefined),
        bodySizeBytes: getBodySizeBytes(request),
        agentContext: request.agentContext,
        extensions: request.extensions,
      };

      if (options.classifyScope) {
        const hints = options.classifyScope(request);
        scope.category = hints.category ?? scope.category;
        if (hints.tenantId && !scope.extensions) {
          scope.extensions = { "tenant.id": hints.tenantId };
        } else if (hints.tenantId) {
          (scope.extensions as Extensions)["tenant.id"] = hints.tenantId;
        }
      }

      const result = await options.engine.evaluate({ scope });
      if (result.decision.effect === "block") {
        throw new GuardrailViolationError({
          scope,
          ruleKey: result.decision.ruleKey,
          reason: result.decision.reason,
        });
      }

      const sanitizedHeaders = sanitizeHeaders(request.headers as HttpHeaders | undefined, result.decision.headers);
      if (sanitizedHeaders) {
        request.headers = sanitizedHeaders;
      }

      applyQueryMask(resolvedUrl, result.decision.query);
      if (result.decision.query && resolvedUrl.toString() !== scope.url) {
        if (request.url) {
          request.url = resolvedUrl.toString();
        } else if (request.urlParts) {
          request.urlParts = {
            ...request.urlParts,
            query: Object.fromEntries(resolvedUrl.searchParams.entries()),
          };
        } else {
          request.url = resolvedUrl.toString();
        }
      }

      enforceBodyConstraints(request, scope, result.decision.body);
    },
  };
}
