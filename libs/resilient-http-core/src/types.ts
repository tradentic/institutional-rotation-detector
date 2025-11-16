export interface HttpCache {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export type HttpMethod = 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type HttpHeaders = Record<string, string>;

export interface UrlParts {
  baseUrl?: string;
  path?: string;
  query?: Record<string, string | number | boolean | (string | number | boolean)[] | undefined>;
}

export interface CorrelationInfo {
  requestId: string;
  correlationId?: string;
  parentCorrelationId?: string;
}

export interface AgentContext {
  agent?: string;
  runId?: string;
  labels?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export type Extensions = Record<string, unknown>;

export interface ResilienceProfile {
  maxAttempts?: number;
  retryEnabled?: boolean;
  perAttemptTimeoutMs?: number;
  overallTimeoutMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  jitterFactorRange?: [number, number];
  maxEndToEndLatencyMs?: number;
  // Legacy/compatibility fields retained from earlier revisions
  priority?: 'low' | 'normal' | 'high' | 'critical';
  maxAttemptsOverride?: number;
  failFast?: boolean;
  allowFailover?: boolean;
}

export interface RequestBudget {
  maxAttempts?: number;
  maxTotalDurationMs?: number;
}

export type HttpRequestBudget = RequestBudget;

export interface RateLimiterContext {
  method: string;
  path: string;
  operation: string;
  attempt: number;
  requestId?: string;
  correlationId?: string;
  parentCorrelationId?: string;
  agentContext?: AgentContext;
  extensions?: Extensions;
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
  correlation?: CorrelationInfo;
  requestId?: string;
  correlationId?: string;
  parentCorrelationId?: string;
  agentContext?: AgentContext;
  extensions?: Extensions;
};

export interface Logger {
  debug(message: string, meta?: LoggerMeta): void;
  info(message: string, meta?: LoggerMeta): void;
  warn(message: string, meta?: LoggerMeta): void;
  error(message: string, meta?: LoggerMeta): void;
}

export type ErrorCategory =
  | 'none'
  | 'auth'
  | 'validation'
  | 'not_found'
  | 'quota'
  | 'rate_limit'
  | 'timeout'
  | 'transient'
  | 'network'
  | 'canceled'
  | 'unknown'
  // Legacy categories retained for backwards compatibility
  | 'safety'
  | 'quota_exceeded'
  | 'server';

export interface ErrorContext {
  request: HttpRequestOptions;
  response?: Response;
  error?: unknown;
}

export interface ClassifiedError {
  category: ErrorCategory;
  statusCode?: number;
  retryable?: boolean;
  suggestedBackoffMs?: number;
  reason?: string;
  policyKey?: string;
}

export interface ErrorClassifier {
  classify(ctx: ErrorContext): ClassifiedError;
}

export interface FallbackHint {
  retryAfterMs?: number;
  degradeToOperation?: string;
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
  isRateLimited?: boolean;
  rawHeaders?: Record<string, string>;
}

export interface RequestOutcome {
  ok: boolean;
  status?: number;
  errorCategory?: ErrorCategory;
  attempts: number;
  startedAt: number;
  finishedAt: number;
  rateLimitFeedback?: RateLimitFeedback;
}

export interface MetricsRequestInfo {
  clientName: string;
  operation: string;
  method: HttpMethod;
  url: string;

  status?: number;
  errorCategory?: ErrorCategory;
  durationMs: number;
  attempts: number;

  cacheHit?: boolean;
  rateLimitFeedback?: RateLimitFeedback;

  correlation: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;
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
  extensions?: Extensions;
}

export interface TracingAdapter {
  startSpan(name: string, options?: TracingStartOptions): TracingSpan;
}

export interface PolicyContext {
  client: string;
  operation: string;
  correlation?: CorrelationInfo;
  requestId?: string;
  correlationId?: string;
  parentCorrelationId?: string;
  agentContext?: AgentContext;
  extensions?: Extensions;
}

export type PolicyWrapper = <T>(fn: () => Promise<T>, context: PolicyContext) => Promise<T>;

export interface OperationDefaults {
  timeoutMs?: number;
  maxRetries?: number;
  idempotent?: boolean;
}

export interface HttpClientConfig {
  clientName: string;
  baseUrl?: string;

  transport?: HttpTransport;
  defaultHeaders?: HttpHeaders;

  defaultResilience?: ResilienceProfile;
  defaultAgentContext?: AgentContext;

  interceptors?: HttpRequestInterceptor[];
  logger?: Logger;
  metrics?: MetricsSink;
  tracing?: TracingAdapter;

  resolveBaseUrl?: (opts: HttpRequestOptions) => string | undefined;
  cache?: HttpCache;
  rateLimiter?: HttpRateLimiter;
  circuitBreaker?: CircuitBreaker;

  beforeRequest?: (opts: HttpRequestOptions) => void | Promise<void>;
  afterResponse?: (opts: HttpRequestOptions, res: Response) => void | Promise<void>;

  responseClassifier?: ResponseClassifier;
  errorClassifier?: ErrorClassifier;
  policyWrapper?: PolicyWrapper;

  // Legacy configuration retained for compatibility
  timeoutMs?: number;
  maxRetries?: number;
  operationDefaults?: Record<string, OperationDefaults>;
}

export type BaseHttpClientConfig = HttpClientConfig;

export interface HttpRequestOptions {
  operation: string;
  method: HttpMethod;

  url?: string;
  urlParts?: UrlParts;
  path?: string;
  query?: Record<string, string | number | boolean | (string | number | boolean)[] | undefined>;
  pageSize?: number;
  pageOffset?: number;

  body?: BodyInit | unknown;
  headers?: HttpHeaders | Record<string, string | undefined>;
  idempotencyKey?: string;

  resilience?: ResilienceProfile;
  budget?: RequestBudget;

  correlation?: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;

  // Legacy/compatibility fields
  idempotent?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  cacheKey?: string;
  cacheTtlMs?: number;
  requestId?: string;
  correlationId?: string;
  parentCorrelationId?: string;
  attempt?: number;
}

export interface BeforeSendContext {
  request: HttpRequestOptions;
  signal: AbortSignal;
}

export interface AfterResponseContext {
  request: HttpRequestOptions;
  response: Response;
  attempt: number;
}

export interface OnErrorContext {
  request: HttpRequestOptions;
  error: unknown;
  attempt: number;
}

export interface HttpRequestInterceptor {
  beforeSend?:
    | ((ctx: BeforeSendContext) => Promise<void> | void)
    | ((opts: HttpRequestOptions) => Promise<HttpRequestOptions | void> | HttpRequestOptions | void);
  afterResponse?:
    | ((ctx: AfterResponseContext) => Promise<void> | void)
    | ((opts: HttpRequestOptions, res: Response) => Promise<Response | void> | Response | void);
  onError?:
    | ((ctx: OnErrorContext) => Promise<void> | void)
    | ((opts: HttpRequestOptions, error: unknown) => Promise<void> | void);
}
