import { fetchTransport } from './transport/fetchTransport';
import type {
  BaseHttpClientConfig,
  HttpRequestOptions,
  HttpTransport,
  Logger,
} from './types';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

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
    const { cache, metrics, rateLimiter, circuitBreaker } = this.config;
    const cacheKey = opts.cacheKey;
    const cacheTtlMs = opts.cacheTtlMs ?? 0;

    if (cache && cacheKey && cacheTtlMs > 0) {
      try {
        const cached = await cache.get<T>(cacheKey);
        if (cached !== undefined) {
          await metrics?.recordRequest?.({
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
      } catch (err) {
        this.logger?.warn('http.cache.error', {
          client: this.clientName,
          operation: opts.operation,
          cacheKey,
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    const maxAttempts = opts.idempotent === false ? 1 : this.maxRetries + 1;
    const rateLimitKey = `${this.clientName}:${opts.operation}`;

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptContext = { attempt };
      try {
        await rateLimiter?.throttle(rateLimitKey, attemptContext);
        await circuitBreaker?.beforeRequest(rateLimitKey);
      } catch (err) {
        this.logger?.error('http.preAttemptFailed', {
          client: this.clientName,
          operation: opts.operation,
          attempt,
          error: err instanceof Error ? err.message : err,
        });
        throw err;
      }

      const executeAttempt = async () => {
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
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
        let response: Response;
        try {
          response = await this.transport(url, init);
        } catch (err) {
          if (controller.signal.aborted) {
            await metrics?.recordRequest?.({
              client: this.clientName,
              operation: opts.operation,
              durationMs: Date.now() - start,
              status: 408,
              attempt,
            });
            throw new TimeoutError('Request timed out');
          }
          await metrics?.recordRequest?.({
            client: this.clientName,
            operation: opts.operation,
            durationMs: Date.now() - start,
            status: 0,
            attempt,
          });
          throw err;
        } finally {
          clearTimeout(timeoutHandle);
        }
        const durationMs = Date.now() - start;

        const status = response.status;
        let parsed: T;
        if (response.status === 204) {
          parsed = undefined as T;
        } else {
          const text = await response.text();
          parsed = text ? (JSON.parse(text) as T) : (undefined as T);
        }

        await metrics?.recordRequest?.({
          client: this.clientName,
          operation: opts.operation,
          durationMs,
          status,
          attempt,
        });

        if (!response.ok) {
          throw new HttpError(`HTTP ${status}`, {
            status,
            body: parsed,
            headers: response.headers,
          });
        }

        if (cache && cacheKey && cacheTtlMs > 0) {
        cache
          .set(cacheKey, parsed, cacheTtlMs)
          .catch((error) =>
            this.logger?.warn('http.cache.setError', {
              client: this.clientName,
              operation: opts.operation,
              cacheKey,
              error: error instanceof Error ? error.message : error,
            }),
          );
        }

        return { parsed, status, durationMs };
      };

      const wrapped = this.config.policyWrapper
        ? this.config.policyWrapper(executeAttempt, {
            client: this.clientName,
            operation: opts.operation,
          })
        : executeAttempt;

      try {
        const result = await wrapped();
        await rateLimiter?.onSuccess?.(rateLimitKey, attemptContext);
        await circuitBreaker?.onSuccess(rateLimitKey);
        return result.parsed;
      } catch (error) {
        lastError = error;
        await rateLimiter?.onError?.(rateLimitKey, error, attemptContext);
        await circuitBreaker?.onFailure(rateLimitKey, error);
        const retry = this.shouldRetry(error);
        if (!(error instanceof HttpError)) {
          await metrics?.recordRequest?.({
            client: this.clientName,
            operation: opts.operation,
            durationMs: 0,
            status: error instanceof TimeoutError ? 408 : 0,
            attempt,
          });
        }
        this.logger?.warn('http.request.failed', {
          client: this.clientName,
          operation: opts.operation,
          attempt,
          maxAttempts,
          error: error instanceof Error ? error.message : error,
        });
        if (!retry || attempt >= maxAttempts) {
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
        if (value === undefined || value === null) continue;
        url.searchParams.append(key, String(value));
      }
    }
    return url.toString();
  }

  private buildHeaders(opts: HttpRequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(opts.headers ?? {}),
    };
    return headers;
  }

  private serializeBody(body: unknown, headers: Record<string, string>): BodyInit {
    if (typeof body === 'string' || body instanceof URLSearchParams || body instanceof Blob || body instanceof FormData) {
      return body;
    }
    if (body instanceof ArrayBuffer) {
      return body;
    }
    if (ArrayBuffer.isView(body)) {
      return body.buffer as ArrayBuffer;
    }
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
    return JSON.stringify(body);
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
        const parsed = Number(retryAfter);
        if (!Number.isNaN(parsed)) {
          return parsed * 1000;
        }
        const date = Date.parse(retryAfter);
        if (!Number.isNaN(date)) {
          const delay = date - Date.now();
          if (delay > 0) {
            return delay;
          }
        }
      }
    }
    const baseDelay = 250 * 2 ** (attempt - 1);
    const jitter = Math.random() * 100;
    return Math.min(baseDelay + jitter, 10_000);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
