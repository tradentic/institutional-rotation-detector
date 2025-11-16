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
  maxAttempts?: number; // default 1
  perAttemptTimeoutMs?: number;
  overallTimeoutMs?: number;
  retryEnabled?: boolean; // default true when maxAttempts>1
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
  isRateLimited: boolean;
  resetAt?: Date;
  limit?: number;
  remaining?: number;
}

export interface RequestOutcome {
  ok: boolean;
  status?: number;
  errorCategory: ErrorCategory;
  attempts: number;
  startedAt: Date;
  finishedAt: Date;
  rateLimitFeedback?: RateLimitFeedback;
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

export interface HttpCacheEntry {
  status: number;
  headers: HttpHeaders;
  body: ArrayBuffer;
  expiresAt?: Date;
}

export interface HttpCache {
  get(key: string): Promise<HttpCacheEntry | null> | HttpCacheEntry | null;
  set(key: string, entry: HttpCacheEntry): Promise<void> | void;
  delete?(key: string): Promise<void> | void;
}

export interface RateLimiterContext {
  clientName: string;
  operation: string;
  method: HttpMethod;
  extensions?: Extensions;
}

export interface HttpRateLimiter {
  acquire(ctx: RateLimiterContext): Promise<void>;
}

export interface CircuitBreakerContext {
  clientName: string;
  operation: string;
}

export interface HttpCircuitBreaker {
  beforeRequest(ctx: CircuitBreakerContext): Promise<void> | void;
  afterRequest(ctx: CircuitBreakerContext, outcome: RequestOutcome): Promise<void> | void;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void;
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
  rateLimitFeedback?: RateLimitFeedback;
  agentContext?: AgentContext;
  extensions?: Extensions;
  correlation?: CorrelationInfo;
  outcome?: RequestOutcome;
}

export interface MetricsSink {
  recordRequest(info: MetricsRequestInfo): void;
}

export interface Span {
  setAttribute(key: string, value: unknown): void;
  end(): void;
}

export interface TracingAdapter {
  startRequestSpan(info: {
    clientName: string;
    operation: string;
    method: HttpMethod;
    url: string;
    correlation?: CorrelationInfo;
    agentContext?: AgentContext;
    extensions?: Extensions;
  }): Span | null;
}

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

export interface HttpClientConfig {
  clientName: string;
  baseUrl?: string;
  transport: HttpTransport;
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
  errorClassifier?: ErrorClassifier;
}

export interface DefaultHttpClientConfig {
  clientName: string;
  baseUrl?: string;
  logger?: Logger;
}

export interface HttpClient {
  requestRaw(options: HttpRequestOptions): Promise<Response>;
  requestJson<T = unknown>(options: HttpRequestOptions): Promise<T>;
  requestText(options: HttpRequestOptions): Promise<string>;
  requestArrayBuffer(options: HttpRequestOptions): Promise<ArrayBuffer>;
}

export type HttpTransport = (url: string, init: RequestInit) => Promise<Response>;
