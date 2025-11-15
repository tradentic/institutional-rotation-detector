export interface HttpCache {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface HttpRateLimiter {
  throttle(key: string, context?: Record<string, unknown>): Promise<void>;
  onSuccess?(key: string, context?: Record<string, unknown>): void | Promise<void>;
  onError?(key: string, error: unknown, context?: Record<string, unknown>): void | Promise<void>;
}

export interface CircuitBreaker {
  beforeRequest(key: string): Promise<void>;
  onSuccess(key: string): Promise<void>;
  onFailure(key: string, error: unknown): Promise<void>;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface MetricsSink {
  recordRequest?(info: {
    client: string;
    operation: string;
    durationMs: number;
    status: number;
    cacheHit?: boolean;
    attempt?: number;
  }): void | Promise<void>;
}

export interface HttpTransport {
  (url: string, init: RequestInit): Promise<Response>;
}

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
  policyWrapper?: <T>(fn: () => Promise<T>, context: {
    client: string;
    operation: string;
  }) => () => Promise<T>;
  transport?: HttpTransport;
}

export interface HttpRequestOptions {
  method: string;
  path: string;
  operation: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  body?: unknown;
  idempotent?: boolean;
  cacheKey?: string;
  cacheTtlMs?: number;
}
