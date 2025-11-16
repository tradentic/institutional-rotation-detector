import type {
  AgentContext,
  ErrorCategory,
  HttpMethod,
  HttpRequestInterceptor,
  HttpRequestOptions,
  RequestOutcome,
  ResilienceProfile,
} from '@airnub/resilient-http-core';

export type RequestClass = 'interactive' | 'background' | 'batch';

export type StringMatcher = string | string[] | '*';

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
  extensions?: Record<string, unknown>;
}

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

export type FailureMode = 'failOpen' | 'failClosed';

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

export type PolicyEffect = 'allow' | 'delay' | 'deny';

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
  onResult(scope: PolicyScope, outcome: RequestOutcome, policyOutcome?: PolicyOutcome): Promise<void>;
}

export class PolicyDeniedError extends Error {
  readonly policyKey?: PolicyKey;
  readonly scope: PolicyScope;
  readonly reason?: string;

  constructor(options: { message?: string; policyKey?: PolicyKey; scope: PolicyScope; reason?: string }) {
    super(options.message ?? 'Request denied by policy');
    this.name = 'PolicyDeniedError';
    this.policyKey = options.policyKey;
    this.scope = options.scope;
    this.reason = options.reason;
  }
}

function matchString(value: string | undefined, matcher?: StringMatcher): boolean {
  if (matcher === undefined) return true;
  if (matcher === '*') return Boolean(value);
  if (Array.isArray(matcher)) return matcher.includes(value ?? '');
  return value === matcher;
}

function matchMethod(method: HttpMethod, matcher?: HttpMethod | HttpMethod[]): boolean {
  if (!matcher) return true;
  return Array.isArray(matcher) ? matcher.includes(method) : matcher === method;
}

function matchRequestClass(cls: RequestClass | undefined, matcher?: RequestClass | RequestClass[]): boolean {
  if (!matcher) return true;
  return Array.isArray(matcher) ? matcher.includes(cls as RequestClass) : cls === matcher;
}

export function scopeMatchesSelector(scope: PolicyScope, selector: ScopeSelector): boolean {
  return (
    matchString(scope.clientName, selector.clientName) &&
    matchString(scope.operation, selector.operation) &&
    matchMethod(scope.method, selector.method) &&
    matchRequestClass(scope.requestClass, selector.requestClass) &&
    matchString(scope.aiProvider, selector.aiProvider) &&
    matchString(scope.aiModel, selector.aiModel) &&
    matchString(scope.aiOperation, selector.aiOperation) &&
    matchString(scope.aiTool, selector.aiTool) &&
    matchString(scope.aiTenant, selector.aiTenant) &&
    matchString(scope.tenantId, selector.tenantId) &&
    matchString(scope.tenantTier, selector.tenantTier)
  );
}

function pickPolicy(policies: PolicyDefinition[], scope: PolicyScope): PolicyDefinition | undefined {
  const matches = policies.filter((p) => scopeMatchesSelector(scope, p.selector));
  if (matches.length === 0) return undefined;
  return matches.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.key.localeCompare(b.key))[0];
}

function formatBucket(template: string | undefined, scope: PolicyScope): string | undefined {
  if (!template) return undefined;
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) => {
    const value = (scope as Record<string, unknown>)[key];
    return value === undefined ? '' : String(value);
  });
}

interface WindowState {
  windowStart: number;
  count: number;
}

export interface InMemoryPolicyEngineConfig {
  policies: PolicyDefinition[];
}

export function createInMemoryPolicyEngine(config: InMemoryPolicyEngineConfig): PolicyEngine {
  const windowCounters = new Map<string, WindowState>();
  const concurrencyCounters = new Map<string, number>();

  function getBucketKey(template: string | undefined, fallback: string): string {
    return template ? template : fallback;
  }

  return {
    async evaluate(ctx: PolicyEvaluationContext): Promise<PolicyEvaluationResult> {
      const policy = pickPolicy(config.policies, ctx.scope);
      if (!policy) {
        return { decision: { effect: 'allow' } };
      }

      const buckets: string[] = [];
      const now = Date.now();

      if (policy.rateLimit) {
        const bucket = formatBucket(policy.rateLimit.bucketKeyTemplate, ctx.scope) ??
          getBucketKey(policy.rateLimit.bucketKeyTemplate, `${ctx.scope.clientName}:${ctx.scope.operation}`);
        buckets.push(bucket);
        const state = windowCounters.get(bucket) ?? { windowStart: now, count: 0 };
        if (now - state.windowStart >= policy.rateLimit.windowMs) {
          state.windowStart = now;
          state.count = 0;
        }
        if (state.count >= policy.rateLimit.maxRequests) {
          return {
            decision: { effect: 'deny', policyKey: policy.key, reason: 'rate-limit exceeded' },
            outcome: { policyKey: policy.key, denied: true, buckets },
          };
        }
        state.count += 1;
        windowCounters.set(bucket, state);
      }

      if (policy.concurrency) {
        const bucket = formatBucket(policy.concurrency.bucketKeyTemplate, ctx.scope) ??
          getBucketKey(policy.concurrency.bucketKeyTemplate, `${ctx.scope.clientName}:${ctx.scope.operation}`);
        buckets.push(bucket);
        const active = concurrencyCounters.get(bucket) ?? 0;
        if (active >= policy.concurrency.maxConcurrent) {
          return {
            decision: { effect: 'delay', delayBeforeSendMs: policy.queue ? 10 : 0, policyKey: policy.key, reason: 'concurrency cap' },
            outcome: { policyKey: policy.key, delayMs: policy.queue ? 10 : 0, buckets },
          };
        }
        concurrencyCounters.set(bucket, active + 1);
      }

      return {
        decision: {
          effect: 'allow',
          resilienceOverride: policy.resilienceOverride?.resilience,
          policyKey: policy.key,
        },
        outcome: { policyKey: policy.key, buckets },
      };
    },

    async onResult(scope: PolicyScope, _outcome: RequestOutcome, policyOutcome?: PolicyOutcome): Promise<void> {
      if (!policyOutcome?.buckets) return;
      for (const bucket of policyOutcome.buckets) {
        const active = concurrencyCounters.get(bucket);
        if (active && active > 0) {
          concurrencyCounters.set(bucket, active - 1);
        }
      }
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
      bucketKeyTemplate: `${opts.clientName}:${opts.selector?.operation ?? '*'}:${opts.selector?.aiModel ?? '*'}`,
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
    concurrency: {
      maxConcurrent: opts.maxConcurrent,
      bucketKeyTemplate: `${opts.clientName}:${opts.selector?.operation ?? '*'}`,
    },
  };
}

export interface BasicInMemoryPolicyEngineConfig {
  clientName: string;
  maxRps?: number;
  maxConcurrent?: number;
  selector?: Partial<ScopeSelector>;
}

export function createBasicInMemoryPolicyEngine(config: BasicInMemoryPolicyEngineConfig): PolicyEngine {
  const policies: PolicyDefinition[] = [];
  if (config.maxRps !== undefined) {
    policies.push(
      createBasicRateLimitPolicy({ key: `${config.clientName}:rps`, clientName: config.clientName, maxRps: config.maxRps, selector: config.selector })
    );
  }
  if (config.maxConcurrent !== undefined) {
    policies.push(
      createBasicConcurrencyPolicy({ key: `${config.clientName}:concurrent`, clientName: config.clientName, maxConcurrent: config.maxConcurrent, selector: config.selector })
    );
  }
  return createInMemoryPolicyEngine({ policies });
}

export interface PolicyInterceptorOptions {
  clientName: string;
  engine: PolicyEngine;
}

function buildScopeFromRequest(clientName: string, request: HttpRequestOptions): PolicyScope {
  return {
    clientName,
    operation: request.operation ?? 'unknown',
    method: request.method ?? 'GET',
    requestClass: request.extensions?.['request.class'] as RequestClass | undefined,
    aiProvider: request.extensions?.['ai.provider'] as string | undefined,
    aiModel: request.extensions?.['ai.model'] as string | undefined,
    aiOperation: request.extensions?.['ai.operation'] as string | undefined,
    aiTool: request.extensions?.['ai.tool'] as string | undefined,
    aiTenant: request.extensions?.['ai.tenant'] as string | undefined,
    tenantId: request.extensions?.['tenant.id'] as string | undefined,
    tenantTier: request.extensions?.['tenant.tier'] as string | undefined,
    agentContext: request.agentContext,
    extensions: request.extensions,
  };
}

function buildOutcomeFromResponse(response: Response, attempts: number): RequestOutcome {
  return {
    ok: response.ok,
    status: response.status,
    errorCategory: response.ok ? ('none' as ErrorCategory) : ('unknown' as ErrorCategory),
    attempts,
    startedAt: Date.now(),
    finishedAt: Date.now(),
  };
}

export function createPolicyInterceptor(options: PolicyInterceptorOptions): HttpRequestInterceptor {
  let lastOutcome: PolicyOutcome | undefined;
  return {
    async beforeSend(ctx) {
      const scope = buildScopeFromRequest(options.clientName, ctx.request);
      const evaluation = await options.engine.evaluate({ scope, request: ctx.request });
      lastOutcome = evaluation.outcome;
      if (evaluation.decision.resilienceOverride) {
        ctx.request.resilience = {
          ...(ctx.request.resilience ?? {}),
          ...evaluation.decision.resilienceOverride,
        };
      }
      if (evaluation.decision.effect === 'deny') {
        throw new PolicyDeniedError({ policyKey: evaluation.decision.policyKey, scope, reason: evaluation.decision.reason });
      }
      if (evaluation.decision.effect === 'delay' && evaluation.decision.delayBeforeSendMs) {
        await new Promise((resolve) => setTimeout(resolve, evaluation.decision.delayBeforeSendMs));
      }
    },
    async afterResponse(ctx) {
      const scope = buildScopeFromRequest(options.clientName, ctx.request);
      const outcome = buildOutcomeFromResponse(ctx.response, ctx.attempt);
      await options.engine.onResult(scope, outcome, lastOutcome);
    },
    async onError(ctx) {
      const scope = buildScopeFromRequest(options.clientName, ctx.request);
      const outcome: RequestOutcome = {
        ok: false,
        status: undefined,
        errorCategory: 'unknown',
        attempts: ctx.attempt,
        startedAt: Date.now(),
        finishedAt: Date.now(),
      };
      await options.engine.onResult(scope, outcome, lastOutcome);
    },
  };
}

