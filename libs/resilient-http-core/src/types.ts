export type HttpMethod =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS';

export type HttpHeaders = Record<string, string>;

export interface UrlParts {
  baseUrl?: string;
  path?: string;
  query?: Record<string, string | number | boolean | undefined>;
}

export interface AgentContext {
  agent?: string;
  runId?: string;
  labels?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export type Extensions = Record<string, unknown>;

export interface CorrelationInfo {
  requestId?: string;
  correlationId?: string;
  parentCorrelationId?: string;
}

export interface ResilienceProfile {
  maxAttempts?: number;
  perAttemptTimeoutMs?: number;
  overallTimeoutMs?: number;
  retryEnabled?: boolean;
  failFast?: boolean;
  policyBucket?: string;
}

export type ErrorCategory =
  | 'none'
  | 'transient'
  | 'rateLimit'
  | 'auth'
  | 'validation'
  | 'quota'
  | 'safety'
  | 'canceled'
  | 'timeout'
  | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  reason?: string;
  statusCode?: number;
  retryable?: boolean;
}

export interface ErrorClassifier {
  classifyNetworkError(err: unknown): ClassifiedError;
  classifyResponse(response: Response): ClassifiedError;
}

export interface RateLimitFeedback {
  /** True if the response definitively indicates we hit a rate limit. */
  isRateLimited: boolean;
  /** Optional provider-specified reset time (e.g. from headers). */
  resetAt?: Date;
  /** Optional numeric limit and remaining values if known. */
  limit?: number;
  remaining?: number;
}

export interface RequestOutcome {
  ok: boolean;
  status?: number;
  errorCategory: ErrorCategory;
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
  errorCategory: ErrorCategory;
  durationMs: number;
  attempts: number;
  agentContext?: AgentContext;
  extensions?: Extensions;
  correlation?: CorrelationInfo;
  rateLimitFeedback?: RateLimitFeedback;
}

export interface MetricsSink {
  recordRequest?(info: MetricsRequestInfo): void | Promise<void>;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void;
}

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

export interface HttpCache {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: T, value: T extends unknown ? T : T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface RateLimiterContext {
  method: string;
  url: string;
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

export interface HttpCircuitBreaker {
  beforeRequest(key: string): Promise<void>;
  onSuccess(key: string): Promise<void>;
  onFailure(key: string, error: unknown): Promise<void>;
}

export interface ResponseClassification {
  treatAsError?: boolean;
  overrideStatus?: number;
  category?: ErrorCategory;
}

export type ResponseClassifier = (
  response: Response,
  bodyText?: string,
) => Promise<ResponseClassification | void> | ResponseClassification | void;

export interface HttpRequestOptions {
  method: HttpMethod;
  url?: string;
  urlParts?: UrlParts;
  headers?: HttpHeaders;
  body?: BodyInit | null;
  operation: string;
  idempotent?: boolean;
  idempotencyKey?: string;
  correlation?: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;
  resilience?: ResilienceProfile;
  cacheEnabled?: boolean;
  cacheKey?: string;
  cacheTtlMs?: number;
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

export interface ErrorContext {
  request: HttpRequestOptions;
  error: unknown;
  attempt: number;
}

export interface HttpRequestInterceptor {
  beforeSend?(ctx: BeforeSendContext): Promise<void> | void;
  afterResponse?(ctx: AfterResponseContext): Promise<void> | void;
  onError?(ctx: ErrorContext): Promise<void> | void;
}

export interface LegacyRequestHooks {
  beforeRequest?(options: HttpRequestOptions): void | Promise<void>;
  afterResponse?(options: HttpRequestOptions, response: Response): void | Promise<void>;
}

export interface HttpClientConfig extends LegacyRequestHooks {
  clientName: string;
  baseUrl?: string;
  transport?: HttpTransport;
  defaultHeaders?: HttpHeaders;
  defaultResilience?: ResilienceProfile;
  logger?: Logger;
  metrics?: MetricsSink;
  tracing?: TracingAdapter;
  interceptors?: HttpRequestInterceptor[];
  cache?: HttpCache;
  rateLimiter?: HttpRateLimiter;
  circuitBreaker?: HttpCircuitBreaker;
  defaultAgentContext?: AgentContext;
  responseClassifier?: ResponseClassifier;
  errorClassifier?: ErrorClassifier;
}

export type HttpTransport = (url: string, init: RequestInit) => Promise<Response>;

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class HttpError extends Error {
  readonly status?: number;
  readonly category: ErrorCategory;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly parentCorrelationId?: string;

  constructor(message: string, params: { status?: number; category: ErrorCategory } & Partial<CorrelationInfo>) {
    super(message);
    this.name = 'HttpError';
    this.status = params.status;
    this.category = params.category;
    this.requestId = params.requestId;
    this.correlationId = params.correlationId;
    this.parentCorrelationId = params.parentCorrelationId;
  }
}
