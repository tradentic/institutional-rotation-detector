export interface HttpCache {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export type HttpMethod = 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ResiliencePriority = 'low' | 'normal' | 'high' | 'critical';

export interface ResilienceProfile {
  priority?: ResiliencePriority;
  maxEndToEndLatencyMs?: number;
  maxAttemptsOverride?: number;
  failFast?: boolean;
  allowFailover?: boolean;
}

export interface AgentContext {
  /**
   * Logical name/identifier of the calling agent, component, or workflow.
   */
  agent?: string;

  /**
   * Stable identifier for the current agent run / job / workflow.
   */
  runId?: string;

  /**
   * Low-cardinality tags describing this agent run.
   */
  labels?: Record<string, string>;

  /**
   * Opaque metadata bag for agent frameworks and higher-level tooling.
   */
  metadata?: Record<string, unknown>;
}

export interface HttpRequestBudget {
  maxTotalDurationMs?: number;
  maxAttempts?: number;
}

export interface RateLimiterContext {
  method: string;
  path: string;
  operation: string;
  attempt: number;
  requestId?: string;
  correlationId?: string;
  parentCorrelationId?: string;
  agentContext?: AgentContext;
  extensions?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface HttpRateLimiter {
  throttle(key: string, context: RateLimiterContext): Promise<void>;
  onSuccess?(key: string, context: RateLimiterContext): void | Promise<void>;
  onError?(key: string, error: unknown, context: RateLimiterContext): void | Promise<void>;
}

export interface CircuitBreaker {
  beforeRequest(key: string): Promise<void>;
  onSuccess(key: string): Promise<void>;
  onFailure(key: string, error: unknown): Promise<void>;
}

export type LoggerMeta = Record<string, unknown> & {
  requestId?: string;
  correlationId?: string;
  parentCorrelationId?: string;
  agentContext?: AgentContext;
  extensions?: Record<string, unknown>;
};

export interface Logger {
  debug(message: string, meta?: LoggerMeta): void;
  info(message: string, meta?: LoggerMeta): void;
  warn(message: string, meta?: LoggerMeta): void;
  error(message: string, meta?: LoggerMeta): void;
}

export type ErrorCategory =
  | 'transient'
  | 'rate_limit'
  | 'validation'
  | 'auth'
  | 'safety'
  | 'quota'
  | 'unknown'
  // Legacy categories retained for backwards compatibility
  | 'not_found'
  | 'quota_exceeded'
  | 'server'
  | 'network'
  | 'timeout';

export interface ErrorContext {
  request: HttpRequestOptions;
  response?: Response;
  error?: unknown;
}

export interface ClassifiedError {
  category: ErrorCategory;
  retryable: boolean;
  suggestedBackoffMs?: number;
  policyKey?: string;
}

export interface ErrorClassifier {
  classify(ctx: ErrorContext): ClassifiedError;
}

export interface FallbackHint {
  retryAfterMs?: number;
  downgrade?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface RateLimitFeedback {
  limitRequests?: number;
  remainingRequests?: number;
  resetRequestsAt?: Date;
  limitTokens?: number;
  remainingTokens?: number;
  resetTokensAt?: Date;
  rawHeaders?: Record<string, string>;
}

export interface RequestOutcome {
  ok: boolean;
  status?: number;
  errorCategory?: ErrorCategory;
  attempts: number;
  startedAt: number;
  finishedAt: number;
}

export interface MetricsRequestInfo {
  client: string;
  operation: string;
  durationMs: number;
  status: number;
  attempt?: number;
  cacheHit?: boolean;
  errorCategory?: ErrorCategory;
  requestId?: string;
  correlationId?: string;
  parentCorrelationId?: string;
  agentContext?: AgentContext;
  extensions?: Record<string, unknown>;
  rateLimit?: RateLimitFeedback;
  outcome?: RequestOutcome;
}

export interface MetricsSink {
  recordRequest?(info: MetricsRequestInfo): void | Promise<void>;
}

export interface HttpTransport {
  (url: string, init: RequestInit): Promise<Response>;
}

export interface ResponseClassification {
  treatAsError?: boolean;
  overrideStatus?: number;
  category?: ErrorCategory;
  fallback?: FallbackHint;
}

export type ResponseClassifier = (
  response: Response,
  bodyText?: string,
) => Promise<ResponseClassification | void> | ResponseClassification | void;

export interface TracingSpan {
  setAttribute(key: string, value: string | number | boolean | null): void;
  recordException(error: unknown): void;
  end(): void;
}

export interface TracingStartOptions {
  attributes?: Record<string, string | number | boolean | null>;
  agentContext?: AgentContext;
  extensions?: Record<string, unknown>;
}

export interface TracingAdapter {
  startSpan(name: string, options?: TracingStartOptions): TracingSpan;
}

export interface PolicyContext {
  client: string;
  operation: string;
  requestId?: string;
  correlationId?: string;
  parentCorrelationId?: string;
  agentContext?: AgentContext;
  extensions?: Record<string, unknown>;
}

export type PolicyWrapper = <T>(fn: () => Promise<T>, context: PolicyContext) => Promise<T>;

export interface OperationDefaults {
  timeoutMs?: number;
  maxRetries?: number;
  idempotent?: boolean;
}

export interface BaseHttpClientConfig {
  baseUrl?: string;
  clientName: string;
  timeoutMs?: number;
  maxRetries?: number;
  logger?: Logger;
  metrics?: MetricsSink;
  cache?: HttpCache;
  rateLimiter?: HttpRateLimiter;
  circuitBreaker?: CircuitBreaker;
  policyWrapper?: PolicyWrapper;
  transport?: HttpTransport;
  tracing?: TracingAdapter;
  responseClassifier?: ResponseClassifier;
  errorClassifier?: ErrorClassifier;
  resolveBaseUrl?: (opts: HttpRequestOptions) => string | undefined;
  beforeRequest?: (opts: HttpRequestOptions) => HttpRequestOptions | void;
  afterResponse?: (response: Response, opts: HttpRequestOptions) => void | Promise<void>;
  interceptors?: HttpRequestInterceptor[];
  operationDefaults?: Record<string, OperationDefaults>;
}

export interface HttpRequestOptions {
  method: HttpMethod;
  path: string;
  operation: string;
  query?: Record<string, string | number | boolean | (string | number | boolean)[] | undefined>;
  headers?: Record<string, string | undefined>;
  body?: unknown;
  idempotent?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  cacheKey?: string;
  cacheTtlMs?: number;
  budget?: HttpRequestBudget;
  requestId?: string;
  correlationId?: string;
  parentCorrelationId?: string;
  agentContext?: AgentContext;
  extensions?: Record<string, unknown>;
  resilience?: ResilienceProfile;
  pageSize?: number;
  pageOffset?: number;
}

export interface HttpRequestInterceptor {
  beforeSend?(opts: HttpRequestOptions): Promise<HttpRequestOptions> | HttpRequestOptions;
  afterResponse?(opts: HttpRequestOptions, res: Response): Promise<Response> | Response;
  onError?(opts: HttpRequestOptions, error: unknown): Promise<void> | void;
}
