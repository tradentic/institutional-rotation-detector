import { fetchTransport } from './transport/fetchTransport';
import type {
  BaseHttpClientConfig,
  ErrorCategory,
  FallbackHint,
  HttpRequestOptions,
  HttpTransport,
  Logger,
  MetricsRequestInfo,
  OperationDefaults,
  RateLimiterContext,
  ResponseClassification,
} from './types';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 60_000;
const BASE_BACKOFF_MS = 250;
const RETRYABLE_ERROR_CATEGORIES = new Set<ErrorCategory>(['rate_limit', 'server', 'network', 'timeout']);

interface ExecuteOptions {
  parseJson: boolean;
  allowRetries: boolean;
  maxAttemptsOverride?: number;
}

interface AttemptSuccess<T> {
  value: T;
  status: number;
  response: Response;
}

export class HttpClient {
  private readonly baseUrl?: string;
  private readonly clientName: string;
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxRetries: number;
  private readonly transport: HttpTransport;
  private readonly logger?: Logger;

  constructor(private readonly config: BaseHttpClientConfig) {
    this.baseUrl = this.normalizeBaseUrl(config.baseUrl);
    this.clientName = config.clientName;
    this.defaultTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.defaultMaxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.transport = config.transport ?? fetchTransport;
    this.logger = config.logger;
  }

  async requestJson<T>(opts: HttpRequestOptions): Promise<T> {
    const preparedOpts = this.prepareRequestOptions(opts);
    const span = this.startSpan(preparedOpts);
    const cache = this.config.cache;
    const cacheKey = preparedOpts.cacheKey;
    const cacheTtlMs = preparedOpts.cacheTtlMs ?? 0;

    if (cache && cacheKey && cacheTtlMs > 0) {
      try {
        const cached = await cache.get<T>(cacheKey);
        if (cached !== undefined) {
          await this.recordMetrics({
            client: this.clientName,
            operation: preparedOpts.operation,
            durationMs: 0,
            status: 200,
            cacheHit: true,
            attempt: 0,
            requestId: preparedOpts.requestId,
          });
          this.logger?.debug('http.cache.hit', this.baseLogMeta(preparedOpts));
          span?.end();
          return cached;
        }
      } catch (error) {
        this.logger?.warn('http.cache.get.error', {
          ...this.baseLogMeta(preparedOpts),
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    try {
      const result = await this.executeWithRetries<T>(preparedOpts, {
        parseJson: true,
        allowRetries: this.getIdempotent(preparedOpts),
      });

      if (cache && cacheKey && cacheTtlMs > 0) {
        Promise.resolve(cache.set(cacheKey, result, cacheTtlMs)).catch((error) =>
          this.logger?.warn('http.cache.set.error', {
            ...this.baseLogMeta(preparedOpts),
            error: error instanceof Error ? error.message : error,
          }),
        );
      }

      span?.end();
      return result;
    } catch (error) {
      span?.recordException?.(error);
      span?.end();
      throw error;
    }
  }

  async requestRaw(opts: HttpRequestOptions): Promise<Response> {
    const preparedOpts = this.prepareRequestOptions(opts);
    const span = this.startSpan(preparedOpts);
    try {
      const response = await this.executeWithRetries<Response>(preparedOpts, {
        parseJson: false,
        allowRetries: false,
        maxAttemptsOverride: 1,
      });
      span?.end();
      return response;
    } catch (error) {
      span?.recordException?.(error);
      span?.end();
      throw error;
    }
  }

  private startSpan(opts: HttpRequestOptions) {
    return this.config.tracing?.startSpan(`${this.clientName}.${opts.operation}`, {
      client: this.clientName,
      operation: opts.operation,
      method: opts.method,
      path: opts.path,
      requestId: opts.requestId ?? null,
    });
  }

  private async executeWithRetries<T>(opts: HttpRequestOptions, executeOptions: ExecuteOptions): Promise<T> {
    const url = this.buildUrl(opts);
    const baseAttempts =
      executeOptions.maxAttemptsOverride ?? opts.budget?.maxAttempts ?? this.getMaxRetries(opts) + 1;
    const maxAttempts = executeOptions.allowRetries ? Math.max(baseAttempts, 1) : 1;
    const rateLimitKey = `${this.clientName}:${opts.operation}`;
    const deadline =
      opts.budget?.maxTotalDurationMs !== undefined
        ? Date.now() + opts.budget.maxTotalDurationMs
        : undefined;
    let lastError: unknown;
    const idempotent = this.getIdempotent(opts);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptContext = this.createRateLimiterContext(opts, attempt);
      const logMeta = { ...this.baseLogMeta(opts), attempt, maxAttempts };
      this.logger?.debug('http.request.attempt', logMeta);

      const executeAttempt = async () =>
        this.runAttempt<T>({
          opts,
          url,
          attemptContext,
          rateLimitKey,
          deadline,
          parseJson: executeOptions.parseJson,
        });

      const runner = this.config.policyWrapper
        ? () =>
            this.config.policyWrapper!(executeAttempt, {
              client: this.clientName,
              operation: opts.operation,
              requestId: opts.requestId,
              agentContext: opts.agentContext,
            })
        : executeAttempt;

      const attemptStart = Date.now();
      try {
        const result = await runner();
        const durationMs = Date.now() - attemptStart;
        await this.callOptionalHook('rateLimiter.onSuccess', () =>
          this.config.rateLimiter?.onSuccess?.(rateLimitKey, attemptContext),
        );
        await this.callOptionalHook('circuitBreaker.onSuccess', () =>
          this.config.circuitBreaker?.onSuccess(rateLimitKey),
        );
        await this.recordMetrics({
          client: this.clientName,
          operation: opts.operation,
          durationMs,
          status: result.status,
          attempt,
          requestId: opts.requestId,
        });
        this.logger?.info('http.request.success', {
          ...logMeta,
          status: result.status,
          durationMs,
        });
        await this.config.afterResponse?.(result.response, opts);
        return result.value;
      } catch (error) {
        lastError = error;
        const durationMs = Date.now() - attemptStart;
        const status = error instanceof HttpError ? error.status : error instanceof TimeoutError ? 408 : 0;
        const category = error instanceof HttpError ? error.category : error instanceof TimeoutError ? 'timeout' : 'network';
        await this.recordMetrics({
          client: this.clientName,
          operation: opts.operation,
          durationMs,
          status,
          attempt,
          requestId: opts.requestId,
          errorCategory: category,
        });
        await this.callOptionalHook('rateLimiter.onError', () =>
          this.config.rateLimiter?.onError?.(rateLimitKey, error, attemptContext),
        );
        await this.callOptionalHook('circuitBreaker.onFailure', () =>
          this.config.circuitBreaker?.onFailure(rateLimitKey, error),
        );

        const retryable =
          executeOptions.allowRetries && attempt < maxAttempts && this.shouldRetry(error, idempotent);
        const failureMeta = {
          ...logMeta,
          status,
          error: error instanceof Error ? error.message : error,
          errorCategory: category,
        };
        if (retryable) {
          this.logger?.warn('http.request.failed', failureMeta);
        } else {
          this.logger?.error('http.request.failed', failureMeta);
        }

        if (!retryable) {
          throw error;
        }

        const delay = this.getRetryDelay(error, attempt);
        await this.sleep(delay);
      }
    }

    throw lastError ?? new Error('Request failed');
  }

  private async runAttempt<T>(params: {
    opts: HttpRequestOptions;
    url: string;
    attemptContext: RateLimiterContext;
    rateLimitKey: string;
    deadline?: number;
    parseJson: boolean;
  }): Promise<AttemptSuccess<T>> {
    const { opts, url, attemptContext, rateLimitKey, deadline, parseJson } = params;

    await this.config.rateLimiter?.throttle(rateLimitKey, attemptContext);
    await this.config.circuitBreaker?.beforeRequest(rateLimitKey);

    const timeoutMs = this.computeAttemptTimeout(opts, deadline);
    const controller = new AbortController();
    let didTimeout = false;
    const timeoutHandle = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);

    const headers = this.buildHeaders(opts);
    const init: RequestInit = {
      method: opts.method,
      headers,
      signal: controller.signal,
    };

    if (opts.body !== undefined && opts.body !== null) {
      init.body = this.serializeBody(opts.body, headers);
    }

    try {
      const response = await this.transport(url, init);
      const bodyText = parseJson ? await response.clone().text() : undefined;
      const classification = await this.classifyResponse(response, bodyText);
      const status = classification.overrideStatus ?? response.status;
      const category = classification.category ?? this.mapStatusToCategory(status);
      const fallback = this.mergeFallback(classification.fallback, response);
      const treatAsError = classification.treatAsError ?? !response.ok;

      if (treatAsError) {
        const errorBody = parseJson ? this.parseBodyFromText(bodyText ?? '') : await this.tryReadText(response);
        throw new HttpError(`HTTP ${status}`, {
          status,
          body: errorBody,
          headers: response.headers,
          category,
          fallback,
        });
      }

      if (!parseJson) {
        return { value: response as unknown as T, status, response };
      }

      const parsed = this.parseBodyFromText<T>(bodyText ?? '');
      return { value: parsed as T, status, response };
    } catch (error) {
      if (didTimeout && !(error instanceof TimeoutError)) {
        throw new TimeoutError(`Request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private buildUrl(opts: HttpRequestOptions): string {
    if (this.isAbsoluteUrl(opts.path)) {
      const url = new URL(opts.path);
      this.applyQueryParameters(url, opts);
      return url.toString();
    }

    const base = this.resolveBaseUrlForRequest(opts);
    if (!base) {
      throw new Error('No baseUrl provided and request path is not an absolute URL');
    }
    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    const path = opts.path.startsWith('/') ? opts.path.slice(1) : opts.path;
    const url = new URL(path, normalizedBase);
    this.applyQueryParameters(url, opts);
    return url.toString();
  }

  private applyQueryParameters(url: URL, opts: HttpRequestOptions) {
    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const entry of value) {
            url.searchParams.append(key, String(entry));
          }
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }
    if (opts.pageSize !== undefined) {
      url.searchParams.set('limit', String(opts.pageSize));
    }
    if (opts.pageOffset !== undefined) {
      url.searchParams.set('offset', String(opts.pageOffset));
    }
  }

  private resolveBaseUrlForRequest(opts: HttpRequestOptions): string | undefined {
    const resolved = this.normalizeBaseUrl(this.config.resolveBaseUrl?.(opts));
    return resolved ?? this.baseUrl;
  }

  private isAbsoluteUrl(path: string): boolean {
    try {
      new URL(path);
      return true;
    } catch {
      return false;
    }
  }

  private normalizeBaseUrl(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    return trimmed.replace(/\/+$/, '') || trimmed;
  }

  private prepareRequestOptions(opts: HttpRequestOptions): HttpRequestOptions {
    let effective: HttpRequestOptions = {
      ...opts,
      headers: opts.headers ? { ...opts.headers } : undefined,
      query: opts.query ? { ...opts.query } : undefined,
    };
    if (this.config.beforeRequest) {
      const modified = this.config.beforeRequest(effective);
      if (modified) {
        effective = { ...effective, ...modified };
      }
    }
    return effective;
  }

  private getOperationDefaults(opts: HttpRequestOptions): OperationDefaults | undefined {
    return this.config.operationDefaults?.[opts.operation];
  }

  private getTimeoutMs(opts: HttpRequestOptions): number {
    return this.getOperationDefaults(opts)?.timeoutMs ?? this.defaultTimeoutMs;
  }

  private getMaxRetries(opts: HttpRequestOptions): number {
    return this.getOperationDefaults(opts)?.maxRetries ?? this.defaultMaxRetries;
  }

  private getIdempotent(opts: HttpRequestOptions): boolean {
    if (opts.idempotent !== undefined) {
      return opts.idempotent;
    }
    const opDefaults = this.getOperationDefaults(opts);
    if (opDefaults?.idempotent !== undefined) {
      return opDefaults.idempotent;
    }
    return ['GET', 'HEAD'].includes(opts.method);
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

  private parseBodyFromText<T>(text: string): T | undefined {
    if (!text) {
      return undefined;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  private async tryReadText(response: Response): Promise<string | undefined> {
    try {
      return await response.clone().text();
    } catch {
      return undefined;
    }
  }

  private hasHeader(headers: Record<string, string>, name: string): boolean {
    return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
  }

  private createRateLimiterContext(opts: HttpRequestOptions, attempt: number): RateLimiterContext {
    return {
      method: opts.method,
      path: opts.path,
      operation: opts.operation,
      attempt,
      requestId: opts.requestId,
      agentContext: opts.agentContext,
    };
  }

  private async recordMetrics(info: MetricsRequestInfo): Promise<void> {
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

  private baseLogMeta(opts: Pick<HttpRequestOptions, 'operation' | 'method' | 'path' | 'requestId'>) {
    return {
      client: this.clientName,
      operation: opts.operation,
      method: opts.method,
      path: opts.path,
      requestId: opts.requestId,
    };
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

  private shouldRetry(error: unknown, idempotent: boolean): boolean {
    if (!idempotent) {
      return false;
    }
    if (error instanceof TimeoutError) {
      return true;
    }
    if (error instanceof HttpError) {
      return RETRYABLE_ERROR_CATEGORIES.has(error.category);
    }
    return true;
  }

  private getRetryDelay(error: unknown, attempt: number): number {
    if (error instanceof HttpError) {
      const retryAfter = error.fallback?.retryAfterMs ?? this.parseRetryAfterHeader(error.headers?.get('retry-after'));
      if (retryAfter) {
        return Math.min(retryAfter, MAX_RETRY_DELAY_MS);
      }
    }
    const baseDelay = BASE_BACKOFF_MS * 2 ** (attempt - 1);
    const jitterFactor = 1 + (Math.random() * 0.4 - 0.2);
    return Math.min(baseDelay * jitterFactor, MAX_RETRY_DELAY_MS);
  }

  private parseRetryAfterHeader(value?: string | null): number | undefined {
    if (!value) return undefined;
    const seconds = Number(value);
    if (!Number.isNaN(seconds)) {
      return seconds * 1000;
    }
    const date = Date.parse(value);
    if (!Number.isNaN(date)) {
      const diff = date - Date.now();
      return diff > 0 ? diff : undefined;
    }
    return undefined;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private computeAttemptTimeout(opts: HttpRequestOptions, deadline?: number): number {
    const timeoutMs = this.getTimeoutMs(opts);
    if (!deadline) {
      return timeoutMs;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new TimeoutError('Budget exceeded before request could start');
    }
    return Math.min(timeoutMs, remaining);
  }

  private async classifyResponse(response: Response, bodyText?: string): Promise<ResponseClassification> {
    const classification = await this.config.responseClassifier?.(response, bodyText);
    return (
      classification ?? {
        treatAsError: undefined,
        overrideStatus: undefined,
        category: undefined,
      }
    );
  }

  private mergeFallback(hint: FallbackHint | undefined, response: Response): FallbackHint | undefined {
    const retryAfterMs = hint?.retryAfterMs ?? this.parseRetryAfterHeader(response.headers.get('retry-after'));
    if (retryAfterMs) {
      return { ...hint, retryAfterMs };
    }
    return hint;
  }

  private mapStatusToCategory(status: number): ErrorCategory {
    if (status === 401 || status === 403) return 'auth';
    if (status === 404) return 'not_found';
    if (status === 400 || status === 422) return 'validation';
    if (status === 402) return 'quota_exceeded';
    if (status === 429) return 'rate_limit';
    if (status === 408) return 'timeout';
    if (status >= 500) return 'server';
    if (status === 0) return 'network';
    return 'unknown';
  }
}

export class HttpError extends Error {
  status: number;
  body: unknown;
  headers?: Headers;
  category: ErrorCategory;
  fallback?: FallbackHint;

  constructor(
    message: string,
    options: { status: number; body?: unknown; headers?: Headers; category: ErrorCategory; fallback?: FallbackHint },
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = options.status;
    this.body = options.body;
    this.headers = options.headers;
    this.category = options.category;
    this.fallback = options.fallback;
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}
