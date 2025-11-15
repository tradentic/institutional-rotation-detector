import { fetchTransport } from './transport/fetchTransport';
import type { BaseHttpClientConfig, HttpRequestOptions, HttpTransport, Logger } from './types';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRY_DELAY_MS = 60_000;
const BASE_BACKOFF_MS = 250;

export class HttpClient {
  private readonly baseUrl: string;
  private readonly clientName: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly transport: HttpTransport;
  private readonly logger?: Logger;
  private readonly config: BaseHttpClientConfig;

  constructor(config: BaseHttpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '') || config.baseUrl;
    this.clientName = config.clientName;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.transport = config.transport ?? fetchTransport;
    this.logger = config.logger;
    this.config = config;
  }

  async requestJson<T>(opts: HttpRequestOptions): Promise<T> {
    const cache = this.config.cache;
    const cacheKey = opts.cacheKey;
    const cacheTtlMs = opts.cacheTtlMs ?? 0;

    if (cache && cacheKey && cacheTtlMs > 0) {
      try {
        const cached = await cache.get<T>(cacheKey);
        if (cached !== undefined) {
          await this.recordMetrics({
            client: this.clientName,
            operation: opts.operation,
            durationMs: 0,
            status: 200,
            cacheHit: true,
            attempt: 0,
          });
          this.logger?.debug('http.cache.hit', {
            client: this.clientName,
            operation: opts.operation,
            cacheKey,
          });
          return cached;
        }
      } catch (error) {
        this.logger?.warn('http.cache.get.error', {
          client: this.clientName,
          operation: opts.operation,
          cacheKey,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    const isIdempotent = opts.idempotent ?? ['GET', 'HEAD'].includes(opts.method);
    const maxAttempts = isIdempotent ? this.maxRetries + 1 : 1;
    const rateLimitKey = `${this.clientName}:${opts.operation}`;
    const baseAttemptContext = {
      method: opts.method,
      path: opts.path,
      operation: opts.operation,
    };

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptContext = { ...baseAttemptContext, attempt };
      this.logger?.debug('http.request.attempt', {
        client: this.clientName,
        operation: opts.operation,
        attempt,
        maxAttempts,
      });

      const executeAttempt = async () => {
        await this.config.rateLimiter?.throttle(rateLimitKey, attemptContext);
        await this.config.circuitBreaker?.beforeRequest(rateLimitKey);

        const controller = new AbortController();
        let didTimeout = false;
        const timeoutHandle = setTimeout(() => {
          didTimeout = true;
          controller.abort();
        }, this.timeoutMs);

        const url = this.buildUrl(opts);
        const headers = this.buildHeaders(opts);
        const init: RequestInit = {
          method: opts.method,
          headers,
          signal: controller.signal,
        };
        if (opts.body !== undefined && opts.body !== null) {
          init.body = this.serializeBody(opts.body, headers);
        }

        const start = Date.now();
        let response: Response | undefined;
        let parsed: T | undefined;
        try {
          response = await this.transport(url, init);
          parsed = (await this.parseResponse<T>(response)) as T;

          if (!response.ok) {
            throw new HttpError(`HTTP ${response.status}`, {
              status: response.status,
              body: parsed,
              headers: response.headers,
            });
          }

          const durationMs = Date.now() - start;
          await this.recordMetrics({
            client: this.clientName,
            operation: opts.operation,
            durationMs,
            status: response.status,
            attempt,
          });

          if (cache && cacheKey && cacheTtlMs > 0) {
            Promise.resolve(cache.set(cacheKey, parsed, cacheTtlMs)).catch((error) =>
              this.logger?.warn('http.cache.set.error', {
                client: this.clientName,
                operation: opts.operation,
                cacheKey,
                error: error instanceof Error ? error.message : error,
              }),
            );
          }

          return { parsed: parsed as T, status: response.status, durationMs };
        } catch (error) {
          const durationMs = Date.now() - start;
          const finalError = didTimeout && !(error instanceof TimeoutError)
            ? new TimeoutError(`Request timed out after ${this.timeoutMs}ms`)
            : error;
          const status = finalError instanceof HttpError
            ? finalError.status
            : finalError instanceof TimeoutError
              ? 408
              : response?.status ?? 0;
          await this.recordMetrics({
            client: this.clientName,
            operation: opts.operation,
            durationMs,
            status,
            attempt,
          });
          throw finalError;
        } finally {
          clearTimeout(timeoutHandle);
        }
      };

      const runAttempt = this.config.policyWrapper
        ? () => this.config.policyWrapper!(executeAttempt, {
            client: this.clientName,
            operation: opts.operation,
          })
        : executeAttempt;

      try {
        const { parsed, status, durationMs } = await runAttempt();
        await this.callOptionalHook('rateLimiter.onSuccess', () =>
          this.config.rateLimiter?.onSuccess?.(rateLimitKey, attemptContext),
        );
        await this.callOptionalHook('circuitBreaker.onSuccess', () =>
          this.config.circuitBreaker?.onSuccess?.(rateLimitKey),
        );
        this.logger?.info('http.request.success', {
          client: this.clientName,
          operation: opts.operation,
          attempt,
          durationMs,
          status,
        });
        return parsed;
      } catch (error) {
        lastError = error;
        await this.callOptionalHook('rateLimiter.onError', () =>
          this.config.rateLimiter?.onError?.(rateLimitKey, error, attemptContext),
        );
        await this.callOptionalHook('circuitBreaker.onFailure', () =>
          this.config.circuitBreaker?.onFailure?.(rateLimitKey, error),
        );

        const retryable = isIdempotent && this.shouldRetry(error);
        const level = retryable && attempt < maxAttempts ? 'warn' : 'error';
        const logMeta = {
          client: this.clientName,
          operation: opts.operation,
          attempt,
          maxAttempts,
          error: error instanceof Error ? error.message : error,
        };
        if (level === 'warn') {
          this.logger?.warn('http.request.retry', logMeta);
        } else {
          this.logger?.error('http.request.failed', logMeta);
        }

        if (!retryable || attempt >= maxAttempts) {
          throw error;
        }

        const delay = this.getRetryDelay(error, attempt);
        await this.sleep(delay);
      }
    }

    throw lastError ?? new Error('Request failed');
  }

  private buildUrl(opts: HttpRequestOptions): string {
    const base = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
    const path = opts.path.startsWith('/') ? opts.path.slice(1) : opts.path;
    const url = new URL(path, base);
    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const entry of value) {
            url.searchParams.append(key, String(entry));
          }
          continue;
        }
        url.searchParams.append(key, String(value));
      }
    }
    return url.toString();
  }

  private buildHeaders(opts: HttpRequestOptions): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.headers) {
      for (const [key, value] of Object.entries(opts.headers)) {
        if (value !== undefined) {
          headers[key] = value;
        }
      }
    }
    return headers;
  }

  private serializeBody(body: unknown, headers: Record<string, string>): BodyInit {
    if (
      typeof body === 'string' ||
      body instanceof URLSearchParams ||
      body instanceof Blob ||
      body instanceof FormData
    ) {
      return body;
    }
    if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) {
      return body;
    }
    if (ArrayBuffer.isView(body)) {
      return body.buffer as ArrayBuffer;
    }
    if (typeof Buffer !== 'undefined' && typeof Buffer.isBuffer === 'function' && Buffer.isBuffer(body)) {
      return body as unknown as BodyInit;
    }
    if (!this.hasHeader(headers, 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
    return JSON.stringify(body);
  }

  private async parseResponse<T>(response: Response): Promise<T | undefined> {
    if (response.status === 204) {
      return undefined;
    }
    const text = await response.clone().text();
    if (!text) {
      return undefined;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  private hasHeader(headers: Record<string, string>, name: string): boolean {
    return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
  }

  private shouldRetry(error: unknown): boolean {
    if (error instanceof TimeoutError) {
      return true;
    }
    if (error instanceof HttpError) {
      return RETRYABLE_STATUS.has(error.status);
    }
    return true;
  }

  private getRetryDelay(error: unknown, attempt: number): number {
    if (error instanceof HttpError) {
      const retryAfter = error.headers?.get?.('retry-after');
      if (retryAfter) {
        const seconds = Number(retryAfter);
        if (!Number.isNaN(seconds)) {
          return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
        }
        const date = Date.parse(retryAfter);
        if (!Number.isNaN(date)) {
          const delay = date - Date.now();
          if (delay > 0) {
            return Math.min(delay, MAX_RETRY_DELAY_MS);
          }
        }
      }
    }
    const baseDelay = BASE_BACKOFF_MS * 2 ** (attempt - 1);
    const jitterFactor = 1 + (Math.random() * 0.4 - 0.2);
    return Math.min(baseDelay * jitterFactor, MAX_RETRY_DELAY_MS);
  }

  private async recordMetrics(info: {
    client: string;
    operation: string;
    durationMs: number;
    status: number;
    cacheHit?: boolean;
    attempt?: number;
  }): Promise<void> {
    try {
      await this.config.metrics?.recordRequest?.(info);
    } catch (error) {
      this.logger?.warn('http.metrics.error', {
        client: this.clientName,
        operation: info.operation,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  private async callOptionalHook(name: string, fn?: () => void | Promise<void>): Promise<void> {
    if (!fn) return;
    try {
      await fn();
    } catch (error) {
      this.logger?.warn(`${name}.failed`, {
        client: this.clientName,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export class HttpError extends Error {
  status!: number;
  body: unknown;
  headers?: Headers;

  constructor(message: string, options?: { status?: number; body?: unknown; headers?: Headers }) {
    super(message);
    this.name = 'HttpError';
    if (options?.status !== undefined) {
      this.status = options.status;
    }
    this.body = options?.body;
    this.headers = options?.headers;
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}
