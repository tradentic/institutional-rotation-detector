export interface HttpCache {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface AgentContext {
  agent?: string;
  runId?: string;
  labels?: Record<string, string>;
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
  agentContext?: AgentContext;
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

export type LoggerMeta = Record<string, unknown>;

export interface Logger {
  debug(message: string, meta?: LoggerMeta): void;
  info(message: string, meta?: LoggerMeta): void;
  warn(message: string, meta?: LoggerMeta): void;
  error(message: string, meta?: LoggerMeta): void;
}

export type ErrorCategory =
  | 'auth'
  | 'validation'
  | 'not_found'
  | 'rate_limit'
  | 'quota_exceeded'
  | 'server'
  | 'network'
  | 'timeout'
  | 'unknown';

export interface FallbackHint {
  retryAfterMs?: number;
  downgrade?: string;
  reason?: string;
  [key: string]: unknown;
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

export interface TracingAdapter {
  startSpan(name: string, attributes?: Record<string, string | number | boolean | null>): TracingSpan;
}

export interface PolicyContext {
  client: string;
  operation: string;
  requestId?: string;
  agentContext?: AgentContext;
}

export type PolicyWrapper = <T>(fn: () => Promise<T>, context: PolicyContext) => Promise<T>;

export interface BaseHttpClientConfig {
  baseUrl: string;
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
}

export interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  path: string;
  operation: string;
  query?: Record<string, string | number | boolean | (string | number | boolean)[] | undefined>;
  headers?: Record<string, string | undefined>;
  body?: unknown;
  idempotent?: boolean;
  cacheKey?: string;
  cacheTtlMs?: number;
  budget?: HttpRequestBudget;
  agentContext?: AgentContext;
  requestId?: string;
  pageSize?: number;
  pageOffset?: number;
}
