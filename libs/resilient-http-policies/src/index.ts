import type {
  AgentContext,
  Extensions,
  HttpMethod,
  HttpRequestInterceptor,
  HttpRequestOptions,
  RequestOutcome,
  ResilienceProfile,
} from "@tradentic/resilient-http-core";

export type RequestClass = "interactive" | "background" | "batch";

export interface PolicyScope {
  clientName: string;
  operation: string;
  method: HttpMethod;
  requestClass?: RequestClass;
  aiProvider?: string;
  aiModel?: string;
  aiOperation?: string;
  aiTool?: string;
  aiTenant?: string;
  tenantId?: string;
  tenantTier?: string;
  agentContext?: AgentContext;
  extensions?: Extensions;
}

export type StringMatcher = string | string[] | "*";

export interface ScopeSelector {
  clientName?: StringMatcher;
  operation?: StringMatcher;
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

export type PolicyKey = string;
export type PolicyPriority = number;

export interface RateLimitRule {
  maxRequests: number;
  windowMs: number;
  bucketKeyTemplate?: string;
}

export interface ConcurrencyRule {
  maxConcurrent: number;
  bucketKeyTemplate?: string;
}

export interface ResilienceOverride {
  resilience: ResilienceProfile;
}

export type FailureMode = "failOpen" | "failClosed";

export interface PolicyDefinition {
  key: PolicyKey;
  description?: string;
  selector: ScopeSelector;
  priority?: PolicyPriority;
  rateLimit?: RateLimitRule;
  concurrency?: ConcurrencyRule;
  resilienceOverride?: ResilienceOverride;
  queue?: {
    maxQueueSize: number;
    maxQueueTimeMs: number;
  };
  failureMode?: FailureMode;
}

export interface PolicyRequestContext {
  scope: PolicyScope;
  request: HttpRequestOptions;
  correlationId?: string;
}

export interface PolicyDecision {
  allow: boolean;
  delayMs?: number;
  reason?: string;
  appliedResilience?: ResilienceProfile;
  policyKey?: PolicyKey;
}

export interface PolicyResultContext {
  scope: PolicyScope;
  request: HttpRequestOptions;
  outcome: RequestOutcome;
  rateLimitFeedback?: unknown;
  policyKey?: PolicyKey;
}

export interface PolicyEngine {
  evaluate(ctx: PolicyRequestContext): Promise<PolicyDecision>;
  onResult?(ctx: PolicyResultContext): Promise<void> | void;
}

function matchesString(value: string | undefined, matcher?: StringMatcher): boolean {
  if (matcher === undefined) return true;
  if (matcher === "*") return !!value;
  if (Array.isArray(matcher)) return matcher.includes(value ?? "");
  return value === matcher;
}

function matchesMethod(value: HttpMethod, matcher?: HttpMethod | HttpMethod[]): boolean {
  if (matcher === undefined) return true;
  if (Array.isArray(matcher)) return matcher.includes(value);
  return value === matcher;
}

export class InMemoryPolicyEngine implements PolicyEngine {
  private definitions: PolicyDefinition[];
  private rateLimits: Map<string, { windowStart: number; count: number }> = new Map();
  private concurrency: Map<string, number> = new Map();

  constructor(definitions: PolicyDefinition[] = []) {
    this.definitions = definitions.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  private matchScope(scope: PolicyScope, selector: ScopeSelector): boolean {
    return (
      matchesString(scope.clientName, selector.clientName) &&
      matchesString(scope.operation, selector.operation) &&
      matchesMethod(scope.method, selector.method) &&
      matchesString(scope.requestClass, selector.requestClass as any) &&
      matchesString(scope.aiProvider, selector.aiProvider) &&
      matchesString(scope.aiModel, selector.aiModel) &&
      matchesString(scope.aiOperation, selector.aiOperation) &&
      matchesString(scope.aiTool, selector.aiTool) &&
      matchesString(scope.aiTenant, selector.aiTenant) &&
      matchesString(scope.tenantId, selector.tenantId) &&
      matchesString(scope.tenantTier, selector.tenantTier)
    );
  }

  private renderBucket(template: string | undefined, scope: PolicyScope): string {
    if (!template) return `${scope.clientName}:${scope.operation}`;
    return template
      .replace("${clientName}", scope.clientName)
      .replace("${operation}", scope.operation)
      .replace("${aiModel}", scope.aiModel ?? "")
      .replace("${aiProvider}", scope.aiProvider ?? "")
      .replace("${tenantId}", scope.tenantId ?? "");
  }

  async evaluate(ctx: PolicyRequestContext): Promise<PolicyDecision> {
    const definition = this.definitions.find((def) => this.matchScope(ctx.scope, def.selector));
    if (!definition) {
      return { allow: true };
    }

    if (definition.rateLimit) {
      const bucket = this.renderBucket(definition.rateLimit.bucketKeyTemplate, ctx.scope);
      const now = Date.now();
      const entry = this.rateLimits.get(bucket) ?? { windowStart: now, count: 0 };
      if (now - entry.windowStart >= definition.rateLimit.windowMs) {
        entry.windowStart = now;
        entry.count = 0;
      }
      if (entry.count >= definition.rateLimit.maxRequests) {
        return { allow: false, reason: "rateLimit", policyKey: definition.key };
      }
      entry.count += 1;
      this.rateLimits.set(bucket, entry);
    }

    if (definition.concurrency) {
      const bucket = this.renderBucket(definition.concurrency.bucketKeyTemplate, ctx.scope);
      const inFlight = this.concurrency.get(bucket) ?? 0;
      if (inFlight >= definition.concurrency.maxConcurrent) {
        return { allow: false, reason: "concurrency", policyKey: definition.key };
      }
      this.concurrency.set(bucket, inFlight + 1);
    }

    return {
      allow: true,
      appliedResilience: definition.resilienceOverride?.resilience,
      policyKey: definition.key,
    };
  }

  async onResult(ctx: PolicyResultContext): Promise<void> {
    if (!ctx.policyKey) return;
    const definition = this.definitions.find((d) => d.key === ctx.policyKey);
    if (!definition?.concurrency) return;
    const bucket = this.renderBucket(definition.concurrency.bucketKeyTemplate, ctx.scope);
    const inFlight = this.concurrency.get(bucket) ?? 0;
    this.concurrency.set(bucket, Math.max(0, inFlight - 1));
  }
}

function buildScope(request: HttpRequestOptions): PolicyScope {
  const extensions = request.extensions ?? {};
  return {
    clientName: request.clientName ?? "unknown",
    operation: request.operation ?? "unknown",
    method: request.method,
    requestClass: extensions["request.class"] as RequestClass | undefined,
    aiProvider: extensions["ai.provider"] as string | undefined,
    aiModel: extensions["ai.model"] as string | undefined,
    aiOperation: extensions["ai.operation"] as string | undefined,
    aiTool: extensions["ai.tool"] as string | undefined,
    aiTenant: extensions["ai.tenant"] as string | undefined,
    tenantId: extensions["tenant.id"] as string | undefined,
    tenantTier: extensions["tenant.tier"] as string | undefined,
    agentContext: request.agentContext,
    extensions,
  };
}

export interface PolicyInterceptorConfig {
  engine: PolicyEngine;
  defaultRequestClass?: RequestClass;
}

export function createPolicyInterceptor(config: PolicyInterceptorConfig): HttpRequestInterceptor {
  return {
    beforeSend: async ({ request }) => {
      const scope = buildScope(request);
      if (!scope.requestClass && config.defaultRequestClass) {
        scope.requestClass = config.defaultRequestClass;
      }
      const decision = await config.engine.evaluate({ scope, request });
      if (!decision.allow) {
        throw new Error(decision.reason ?? "Request denied by policy");
      }
      if (decision.appliedResilience) {
        request.resilience = { ...request.resilience, ...decision.appliedResilience };
      }
      if (decision.delayMs && decision.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, decision.delayMs));
      }
    },
    afterResponse: async ({ request, response }) => {
      const scope = buildScope(request);
      await config.engine.onResult?.({
        scope,
        request,
        outcome: (response as any).outcome ?? { status: response.status, attempts: 1, durationMs: 0 },
        policyKey: undefined,
      });
    },
    onError: async ({ request }) => {
      const scope = buildScope(request);
      await config.engine.onResult?.({
        scope,
        request,
        outcome: { status: 0, attempts: 1, durationMs: 0, errorCategory: "network" as any },
        policyKey: undefined,
      });
    },
  };
}

