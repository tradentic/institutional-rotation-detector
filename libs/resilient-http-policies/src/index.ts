import type {
  AfterResponseContext,
  AgentContext,
  BeforeSendContext,
  Extensions,
  HttpMethod,
  HttpRequestInterceptor,
  HttpRequestOptions,
  OnErrorContext,
  RequestOutcome,
  ResilienceProfile,
} from "@airnub/resilient-http-core";

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

export type PolicyEffect = "allow" | "delay" | "deny";

export interface PolicyDecision {
  effect: PolicyEffect;
  delayBeforeSendMs?: number;
  resilienceOverride?: ResilienceProfile;
  policyKey?: PolicyKey;
  reason?: string;
}

export interface PolicyOutcome {
  policyKey?: PolicyKey;
  delayMs?: number;
  denied?: boolean;
  buckets?: string[];
}

export interface PolicyEvaluationContext {
  scope: PolicyScope;
  request: HttpRequestOptions;
}

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  outcome?: PolicyOutcome;
}

export interface PolicyEngine {
  evaluate(ctx: PolicyEvaluationContext): Promise<PolicyEvaluationResult>;
  onResult?(scope: PolicyScope, outcome: RequestOutcome, policyOutcome?: PolicyOutcome):
    | Promise<void>
    | void;
}

export class PolicyDeniedError extends Error {
  readonly policyKey?: PolicyKey;
  readonly scope: PolicyScope;
  readonly reason?: string;

  constructor(options: { message?: string; policyKey?: PolicyKey; scope: PolicyScope; reason?: string }) {
    super(options.message ?? "Request denied by policy");
    this.name = "PolicyDeniedError";
    this.policyKey = options.policyKey;
    this.scope = options.scope;
    this.reason = options.reason;
  }
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

export interface InMemoryPolicyEngineConfig {
  policies: PolicyDefinition[];
}

export class InMemoryPolicyEngine implements PolicyEngine {
  private definitions: PolicyDefinition[];
  private rateLimits: Map<string, { windowStart: number; count: number }> = new Map();
  private concurrency: Map<string, number> = new Map();
  private queues: Map<string, number> = new Map();

  constructor(definitions: PolicyDefinition[] = []) {
    this.definitions = definitions
      .slice()
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.key.localeCompare(b.key));
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
    return template.replace(/\$\{(.*?)\}/g, (_, key) => {
      const value = (scope as any)[key];
      return value == null ? "" : String(value);
    });
  }

  private pickDefinition(scope: PolicyScope): PolicyDefinition | undefined {
    return this.definitions.find((def) => this.matchScope(scope, def.selector));
  }

  private applyRateLimit(definition: PolicyDefinition, scope: PolicyScope, now: number, outcome: PolicyOutcome) {
    if (!definition.rateLimit) return undefined;
    const bucket = this.renderBucket(definition.rateLimit.bucketKeyTemplate, scope);
    outcome.buckets = [...(outcome.buckets ?? []), bucket];
    const entry = this.rateLimits.get(bucket) ?? { windowStart: now, count: 0 };
    if (now - entry.windowStart >= definition.rateLimit.windowMs) {
      entry.windowStart = now;
      entry.count = 0;
    }
    if (entry.count >= definition.rateLimit.maxRequests) {
      return { bucket, exceeded: true } as const;
    }
    entry.count += 1;
    this.rateLimits.set(bucket, entry);
    return { bucket, exceeded: false } as const;
  }

  private applyConcurrency(definition: PolicyDefinition, scope: PolicyScope, outcome: PolicyOutcome) {
    if (!definition.concurrency) return { bucket: undefined, allowed: true } as const;
    const bucket = this.renderBucket(definition.concurrency.bucketKeyTemplate, scope);
    outcome.buckets = [...(outcome.buckets ?? []), bucket];
    const inFlight = this.concurrency.get(bucket) ?? 0;
    if (inFlight >= definition.concurrency.maxConcurrent) {
      return { bucket, allowed: false } as const;
    }
    this.concurrency.set(bucket, inFlight + 1);
    return { bucket, allowed: true } as const;
  }

  async evaluate(ctx: PolicyEvaluationContext): Promise<PolicyEvaluationResult> {
    const now = Date.now();
    const definition = this.pickDefinition(ctx.scope);
    if (!definition) {
      return { decision: { effect: "allow" } };
    }

    const outcome: PolicyOutcome = { policyKey: definition.key, buckets: [] };
    try {
      const rateLimitResult = this.applyRateLimit(definition, ctx.scope, now, outcome);
      if (rateLimitResult?.exceeded) {
        const queueSize = this.queues.get(rateLimitResult.bucket) ?? 0;
        if (definition.queue && queueSize < definition.queue.maxQueueSize) {
          this.queues.set(rateLimitResult.bucket, queueSize + 1);
          const delay = definition.queue.maxQueueTimeMs;
          outcome.delayMs = delay;
          return {
            decision: {
              effect: "delay",
              delayBeforeSendMs: delay,
              policyKey: definition.key,
              reason: "rateLimit",
            },
            outcome,
          };
        }
        return {
          decision: { effect: "deny", policyKey: definition.key, reason: "rateLimit" },
          outcome: { ...outcome, denied: true },
        };
      }

      const concurrencyResult = this.applyConcurrency(definition, ctx.scope, outcome);
      if (concurrencyResult.bucket && !concurrencyResult.allowed) {
        const queueSize = this.queues.get(concurrencyResult.bucket) ?? 0;
        if (definition.queue && queueSize < definition.queue.maxQueueSize) {
          this.queues.set(concurrencyResult.bucket, queueSize + 1);
          const delay = definition.queue.maxQueueTimeMs;
          outcome.delayMs = delay;
          return {
            decision: {
              effect: "delay",
              delayBeforeSendMs: delay,
              policyKey: definition.key,
              reason: "concurrency",
            },
            outcome,
          };
        }
        return {
          decision: { effect: "deny", policyKey: definition.key, reason: "concurrency" },
          outcome: { ...outcome, denied: true },
        };
      }

      const delay = outcome.delayMs;
      return {
        decision: {
          effect: delay && delay > 0 ? "delay" : "allow",
          delayBeforeSendMs: delay,
          resilienceOverride: definition.resilienceOverride?.resilience,
          policyKey: definition.key,
          reason: definition.description,
        },
        outcome,
      };
    } catch (err) {
      const failMode = definition.failureMode ?? "failOpen";
      if (failMode === "failClosed") {
        return {
          decision: { effect: "deny", policyKey: definition.key, reason: (err as Error)?.message },
          outcome: { ...outcome, denied: true },
        };
      }
      return { decision: { effect: "allow" }, outcome };
    }
  }

  async onResult(scope: PolicyScope, outcome: RequestOutcome, policyOutcome?: PolicyOutcome): Promise<void> {
    const key = policyOutcome?.policyKey;
    if (!key) return;
    const definition = this.definitions.find((d) => d.key === key);
    if (!definition) return;

    if (definition.concurrency && policyOutcome?.buckets) {
      for (const bucket of policyOutcome.buckets) {
        const inFlight = this.concurrency.get(bucket) ?? 0;
        if (inFlight > 0) {
          this.concurrency.set(bucket, inFlight - 1);
        }
      }
    }

    if (definition.queue && policyOutcome?.buckets) {
      for (const bucket of policyOutcome.buckets) {
        const queued = this.queues.get(bucket) ?? 0;
        if (queued > 0) {
          this.queues.set(bucket, queued - 1);
        }
      }
    }
  }
}

export function createInMemoryPolicyEngine(config: InMemoryPolicyEngineConfig): PolicyEngine {
  return new InMemoryPolicyEngine(config.policies);
}

function buildScope(
  request: HttpRequestOptions,
  classify?: (request: HttpRequestOptions) => RequestClass,
): PolicyScope {
  const extensions = request.extensions ?? {};
  const classified = classify?.(request);
  const baseClass = classified
    ? classified
    : request.method === "GET" || request.method === "HEAD"
      ? "interactive"
      : "background";
  const requestClass = (extensions["request.class"] as RequestClass | undefined) ?? baseClass;
  return {
    clientName: request.operation ?? "unknown",
    operation: request.operation ?? "unknown",
    method: request.method,
    requestClass,
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

export interface PolicyInterceptorOptions {
  engine: PolicyEngine;
  classifyRequestClass?: (request: HttpRequestOptions) => RequestClass;
  /** @deprecated use classifyRequestClass */
  defaultRequestClass?: RequestClass;
}

export function createPolicyInterceptor(options: PolicyInterceptorOptions): HttpRequestInterceptor {
  const evaluations = new WeakMap<HttpRequestOptions, PolicyEvaluationResult>();
  const starts = new WeakMap<HttpRequestOptions, number>();

  return {
    beforeSend: async ({ request }: BeforeSendContext) => {
      const scope = buildScope(request, options.classifyRequestClass ?? (() => options.defaultRequestClass as any));
      const evaluation = await options.engine.evaluate({ scope, request });
      evaluations.set(request, evaluation);
      starts.set(request, Date.now());
      const decision = evaluation.decision;
      if (decision.effect === "deny") {
        throw new PolicyDeniedError({ policyKey: decision.policyKey, scope, reason: decision.reason });
      }
      if (decision.resilienceOverride) {
        request.resilience = { ...(request.resilience ?? {}), ...decision.resilienceOverride };
      }
      if (decision.effect === "delay" && (decision.delayBeforeSendMs ?? 0) > 0) {
        await new Promise((resolve) => setTimeout(resolve, decision.delayBeforeSendMs));
      }
    },
    afterResponse: async ({ request, response, attempt }: AfterResponseContext) => {
      const evaluation = evaluations.get(request);
      const scope = buildScope(request, options.classifyRequestClass ?? (() => options.defaultRequestClass as any));
      const startedAt = starts.get(request) ?? Date.now();
      const finishedAt = Date.now();
      const outcome: RequestOutcome = {
        ok: response.ok,
        status: response.status,
        attempts: attempt,
        startedAt,
        finishedAt,
      };
      await options.engine.onResult?.(scope, outcome, evaluation?.outcome);
    },
    onError: async ({ request, error, attempt }: OnErrorContext) => {
      const evaluation = evaluations.get(request);
      const scope = buildScope(request, options.classifyRequestClass ?? (() => options.defaultRequestClass as any));
      const startedAt = starts.get(request) ?? Date.now();
      const finishedAt = Date.now();
      const status = (error as any)?.status ?? 0;
      await options.engine.onResult?.(
        scope,
        {
          ok: false,
          status,
          attempts: attempt,
          startedAt,
          finishedAt,
          errorCategory: (error as any)?.category,
        },
        evaluation?.outcome,
      );
    },
  };
}

export interface BasicRateLimitOptions {
  key: PolicyKey;
  clientName: string;
  maxRps: number;
  maxBurst?: number;
  selector?: Partial<ScopeSelector>;
}

export function createBasicRateLimitPolicy(opts: BasicRateLimitOptions): PolicyDefinition {
  const windowMs = 1000;
  const maxRequests = opts.maxBurst ?? opts.maxRps;
  return {
    key: opts.key,
    selector: { clientName: opts.clientName, ...(opts.selector ?? {}) },
    rateLimit: {
      maxRequests,
      windowMs,
    },
  };
}

export interface BasicConcurrencyOptions {
  key: PolicyKey;
  clientName: string;
  maxConcurrent: number;
  selector?: Partial<ScopeSelector>;
}

export function createBasicConcurrencyPolicy(opts: BasicConcurrencyOptions): PolicyDefinition {
  return {
    key: opts.key,
    selector: { clientName: opts.clientName, ...(opts.selector ?? {}) },
    concurrency: { maxConcurrent: opts.maxConcurrent },
  };
}

export interface BasicPolicyEngineOptions {
  clientName: string;
  rateLimit?: BasicRateLimitOptions;
  concurrency?: BasicConcurrencyOptions;
}

export function createBasicInMemoryPolicyEngine(opts: BasicPolicyEngineOptions): PolicyEngine {
  const policies: PolicyDefinition[] = [];
  if (opts.rateLimit) {
    policies.push(createBasicRateLimitPolicy({ ...opts.rateLimit, clientName: opts.clientName }));
  }
  if (opts.concurrency) {
    policies.push(createBasicConcurrencyPolicy({ ...opts.concurrency, clientName: opts.clientName }));
  }
  return createInMemoryPolicyEngine({ policies });
}

