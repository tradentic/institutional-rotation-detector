import { setTimeout as sleep } from 'timers/promises';
import type {
  CircuitBreaker,
  HttpCache,
  HttpRateLimiter,
  HttpTransport,
  Logger,
  MetricsSink,
} from '@libs/http-client-core';
import { ApiRequestError, OpenAiRequestError, type OpenAiClientConfig } from './types';

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_BASE_RETRY_DELAY_MS = 500;
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface RequestOptions {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: HeadersInit;
  operation?: string;
  cacheKey?: string;
  cacheTtlMs?: number;
  idempotent?: boolean;
  timeoutMs?: number;
}

export class NoopRateLimiter implements HttpRateLimiter {
  async throttle(): Promise<void> {}
  onSuccess?(): void {}
  onError?(_key?: string, _error?: unknown): void {}
}

export class InMemoryCache implements HttpCache {
  private store = new Map<string, { value: unknown; expiresAt?: number }>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T = unknown>(key: string, value: T, ttlMs: number): Promise<void> {
    const expiresAt = ttlMs ? Date.now() + ttlMs : undefined;
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

export class OpenAiHttpClient {
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly baseRetryDelayMs: number;
  private readonly timeoutMs: number;
  private readonly rateLimiter: HttpRateLimiter;
  private readonly cache?: HttpCache;
  private readonly circuitBreaker?: CircuitBreaker;
  private readonly logger?: Logger;
  private readonly metrics?: MetricsSink;
  private readonly transport: HttpTransport;
  private readonly apiKey: string;
  private readonly organizationId?: string;

  constructor(private readonly config: OpenAiClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.organizationId = config.organizationId;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseRetryDelayMs = config.baseRetryDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.rateLimiter = config.rateLimiter ?? new NoopRateLimiter();
    this.cache = config.cache;
    this.circuitBreaker = config.circuitBreaker;
    this.logger = config.logger;
    this.metrics = config.metrics;
    this.transport = config.transport ?? ((url, init) => fetch(url, init));
  }

  async requestJson<T>(options: RequestOptions): Promise<T> {
    const method = options.method ?? 'GET';
    const url = this.buildUrl(options.path, options.query);
    const endpoint = options.path;
    const operation = options.operation ?? endpoint;
    const timeout = options.timeoutMs ?? this.timeoutMs;
    const effectiveTimeout = timeout > 0 ? timeout : undefined;

    const explicitCacheKey = options.cacheKey;
    const cacheEligible = Boolean(
      options.cacheTtlMs &&
        options.cacheTtlMs > 0 &&
        this.cache &&
        (method === 'GET' || explicitCacheKey)
    );
    const cacheKey = cacheEligible
      ? explicitCacheKey ?? this.computeCacheKey(url)
      : undefined;

    if (cacheEligible && cacheKey) {
      const cached = await this.cache!.get<T>(cacheKey);
      if (cached !== undefined) {
        await this.metrics?.recordRequest?.({
          client: 'openai',
          operation,
          durationMs: 0,
          status: 200,
          cacheHit: true,
          attempt: 0,
        });
        return cached;
      }
    }

    const headers = new Headers(options.headers ?? undefined);
    headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${this.apiKey}`);
    if (this.organizationId) {
      headers.set('OpenAI-Organization', this.organizationId);
    }

    const body = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    if (body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const init: RequestInit = {
      method,
      headers,
      body: body ?? null,
    };

    const key = `${method}:${endpoint}`;
    const idempotent = options.idempotent ?? (method === 'GET');

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const start = Date.now();
      try {
        await this.circuitBreaker?.beforeRequest(key);
        await this.rateLimiter.throttle(key);

        const response = await this.executeHttp(url, init, effectiveTimeout);
        if (!response.ok) {
          const retryAfterMs = parseRetryAfter(response);
          const bodyText = await safeReadBody(response);
          const error = new OpenAiRequestError(
            `OpenAI request failed with status ${response.status}`,
            response.status,
            bodyText,
            retryAfterMs,
          );
          await this.handleFailure(key, error, operation, start, attempt);

          if (!this.shouldRetry(error.status, idempotent) || attempt === this.maxRetries) {
            throw error;
          }

          await this.waitForRetry(error, attempt, operation);
          continue;
        }

        const payload = await parseJson<T>(response);
        await this.rateLimiter.onSuccess?.(key);
        await this.circuitBreaker?.onSuccess?.(key);

        await this.metrics?.recordRequest?.({
          client: 'openai',
          operation,
          durationMs: Date.now() - start,
          status: response.status,
          cacheHit: false,
          attempt,
        });

        if (cacheEligible && cacheKey && options.cacheTtlMs) {
          await this.cache!.set(cacheKey, payload, options.cacheTtlMs);
        }

        return payload;
      } catch (err) {
        const error: ApiRequestError = err instanceof ApiRequestError
          ? err
          : new OpenAiRequestError(
              err instanceof Error ? err.message : 'OpenAI request failed',
              0,
            );

        await this.handleFailure(key, error, operation, start, attempt);

        if (!this.shouldRetry(error.status, idempotent) || attempt === this.maxRetries) {
          throw error;
        }

        await this.waitForRetry(error, attempt, operation);
      }
    }

    throw new OpenAiRequestError('OpenAI request exceeded retries', 0);
  }

  private async executeHttp(url: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
    if (!timeoutMs) {
      try {
        return await this.transport(url, init);
      } catch (error) {
        throw new OpenAiRequestError(
          `OpenAI request failed: ${(error as Error)?.message ?? 'network error'}`,
          0,
        );
      }
    }

    const controller = new AbortController();
    const originalSignal = init.signal ?? undefined;
    const abortHandler = () => controller.abort();

    if (originalSignal) {
      if (originalSignal.aborted) {
        controller.abort(originalSignal.reason);
      } else {
        originalSignal.addEventListener('abort', abortHandler);
      }
    }

    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await this.transport(url, { ...init, signal: controller.signal });
    } catch (error) {
      throw new OpenAiRequestError(
        `OpenAI request failed: ${(error as Error)?.message ?? 'network error'}`,
        0,
      );
    } finally {
      clearTimeout(timeoutId);
      if (originalSignal) {
        originalSignal.removeEventListener('abort', abortHandler);
      }
    }
  }

  private shouldRetry(status: number, idempotent: boolean): boolean {
    if (!idempotent) {
      return false;
    }
    if (status === 0 || status === 429) {
      return true;
    }
    return status === 500 || status === 502 || status === 503 || status === 504;
  }

  private async handleFailure(
    key: string,
    error: ApiRequestError,
    operation: string,
    start: number,
    attempt: number,
  ): Promise<void> {
    await this.rateLimiter.onError?.(key, error);
    await this.circuitBreaker?.onFailure?.(key, error);
    await this.metrics?.recordRequest?.({
      client: 'openai',
      operation,
      durationMs: Date.now() - start,
      status: error.status,
      cacheHit: false,
      attempt,
    });
  }

  private async waitForRetry(
    error: ApiRequestError,
    attempt: number,
    operation: string,
  ): Promise<void> {
    const delayMs = error.retryAfterMs && error.retryAfterMs > 0
      ? error.retryAfterMs
      : computeBackoffWithJitter(this.baseRetryDelayMs, attempt);

    this.logger?.warn?.(
      `[OpenAiHttpClient] Retrying ${operation} after ${delayMs}ms due to status ${error.status}`,
    );

    await sleep(delayMs);
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(path, this.baseUrl);
    if (query) {
      const entries = Object.entries(query).filter(([, value]) => value !== undefined);
      entries.sort(([a], [b]) => a.localeCompare(b));
      for (const [key, value] of entries) {
        url.searchParams.append(key, String(value));
      }
    }
    return url.toString();
  }

  private computeCacheKey(url: string): string {
    return `openai:${url}`;
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

async function safeReadBody(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}

function parseRetryAfter(res: Response): number | undefined {
  const header = res.headers.get('retry-after');
  if (!header) {
    return undefined;
  }

  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return seconds * 1000;
  }

  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    const diff = date - Date.now();
    return diff > 0 ? diff : 0;
  }

  return undefined;
}

function computeBackoffWithJitter(baseMs: number, attempt: number): number {
  const exp = baseMs * 2 ** attempt;
  const jitter = Math.random() * baseMs;
  return exp + jitter;
}
