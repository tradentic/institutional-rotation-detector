export interface HttpCache {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface HttpRateLimiter {
  throttle(key?: string): Promise<void>;
  onSuccess?(key?: string): void | Promise<void>;
  onError?(key: string | undefined, error: unknown): void | Promise<void>;
}

export interface CircuitBreaker {
  beforeRequest(key?: string): Promise<void>;
  onSuccess?(key?: string): void | Promise<void>;
  onFailure?(key: string | undefined, error: unknown): void | Promise<void>;
}

export interface Logger {
  debug?(message: string, meta?: unknown): void;
  info?(message: string, meta?: unknown): void;
  warn?(message: string, meta?: unknown): void;
  error?(message: string, meta?: unknown): void;
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
