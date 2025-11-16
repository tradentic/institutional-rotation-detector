import type {
  AgentContext,
  Extensions,
  HttpHeaders,
  HttpMethod,
  HttpRequestInterceptor,
  HttpRequestOptions,
} from '@airnub/resilient-http-core';
import { PolicyDeniedError } from '@airnub/resilient-http-policies';

export type GuardedRequestKind = 'http-request' | 'browser-navigation';
export type GuardrailRuleKey = string;
export type GuardrailPriority = number;

export interface GuardrailScope {
  kind: GuardedRequestKind;
  url: string;
  protocol: string;
  hostname: string;
  port?: number;
  pathname: string;
  method?: HttpMethod;
  headers?: HttpHeaders;
  agentContext?: AgentContext;
  extensions?: Extensions;
}

export type StringMatcher = string | string[] | '*';

export interface GuardrailSelector {
  kind?: GuardedRequestKind | GuardedRequestKind[];
  protocol?: StringMatcher;
  hostname?: StringMatcher;
  port?: number | number[];
  pathname?: StringMatcher;
  method?: HttpMethod | HttpMethod[];
}

export type GuardrailEffect = 'allow' | 'block' | 'redact-headers';

export interface GuardrailAction {
  effect: GuardrailEffect;
  reason?: string;
  redactedHeaders?: string[];
}

export interface GuardrailRule {
  key: GuardrailRuleKey;
  description?: string;
  selector: GuardrailSelector;
  action: GuardrailAction;
  priority?: GuardrailPriority;
}

export interface GuardrailDecision {
  effect: GuardrailEffect;
  ruleKey?: GuardrailRuleKey;
  reason?: string;
  redactedHeaders?: string[];
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
    super(options.message ?? 'Request blocked by browser guardrails');
    this.name = 'GuardrailViolationError';
    this.ruleKey = options.ruleKey;
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

function matchMethod(method: HttpMethod | undefined, matcher?: HttpMethod | HttpMethod[]): boolean {
  if (!matcher) return true;
  return Array.isArray(matcher) ? matcher.includes(method as HttpMethod) : matcher === method;
}

function scopeMatchesRule(scope: GuardrailScope, selector: GuardrailSelector): boolean {
  const kindMatch = selector.kind === undefined ? true : Array.isArray(selector.kind) ? selector.kind.includes(scope.kind) : selector.kind === scope.kind;
  return (
    kindMatch &&
    matchString(scope.protocol, selector.protocol) &&
    matchString(scope.hostname, selector.hostname) &&
    (selector.port === undefined || (Array.isArray(selector.port) ? selector.port.includes(scope.port ?? 0) : selector.port === scope.port)) &&
    matchString(scope.pathname, selector.pathname) &&
    matchMethod(scope.method, selector.method)
  );
}

export interface InMemoryGuardrailEngineConfig {
  rules: GuardrailRule[];
  defaultAction?: GuardrailAction;
}

export function createInMemoryGuardrailEngine(config: InMemoryGuardrailEngineConfig): GuardrailEngine {
  return {
    async evaluate(ctx: GuardrailEvaluationContext): Promise<GuardrailEvaluationResult> {
      const matches = config.rules.filter((r) => scopeMatchesRule(ctx.scope, r.selector));
      const rule = matches.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.key.localeCompare(b.key))[0];
      if (rule) {
        return { decision: { ...rule.action, ruleKey: rule.key } };
      }
      const action = config.defaultAction ?? { effect: 'block', reason: 'No matching guardrail rule; default deny' };
      return { decision: { ...action } };
    },
  };
}

export interface HttpGuardrailInterceptorOptions {
  clientName: string;
  engine: GuardrailEngine;
}

export function createHttpGuardrailInterceptor(options: HttpGuardrailInterceptorOptions): HttpRequestInterceptor {
  return {
    async beforeSend(ctx) {
      const url = new URL(ctx.request.url ?? '', ctx.request.baseUrl ?? undefined);
      const scope: GuardrailScope = {
        kind: 'http-request',
        url: url.toString(),
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        pathname: url.pathname,
        method: ctx.request.method,
        headers: ctx.request.headers,
        agentContext: ctx.request.agentContext,
        extensions: ctx.request.extensions,
      };
      const { decision } = await options.engine.evaluate({ scope });
      if (decision.effect === 'block') {
        throw new GuardrailViolationError({ ruleKey: decision.ruleKey, scope, reason: decision.reason });
      }
      if (decision.effect === 'redact-headers' && decision.redactedHeaders?.length) {
        for (const header of decision.redactedHeaders) {
          if (ctx.request.headers?.[header]) {
            delete ctx.request.headers[header];
          }
        }
      }
    },
    async onError(ctx) {
      // surface policy denied errors to guardrail engine for parity
      if (ctx.error instanceof PolicyDeniedError) {
        throw ctx.error;
      }
    },
  };
}

export interface BrowserNavigationGuard {
  checkNavigation(scope: GuardrailScope): Promise<GuardrailDecision>;
}

export function createBrowserNavigationGuard(engine: GuardrailEngine): BrowserNavigationGuard {
  return {
    async checkNavigation(scope: GuardrailScope): Promise<GuardrailDecision> {
      const { decision } = await engine.evaluate({ scope });
      if (decision.effect === 'block') {
        throw new GuardrailViolationError({ ruleKey: decision.ruleKey, scope, reason: decision.reason });
      }
      return decision;
    },
  };
}

