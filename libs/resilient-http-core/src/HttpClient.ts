// ============================================================================
// HttpClient – Resilient HTTP v0.8.0
// ============================================================================

import { fetchTransport } from './transport/fetchTransport';
import type {
  BeforeSendContext,
  AfterResponseContext,
  OnErrorContext,
  ClassifiedError,
  ErrorCategory,
  ErrorClassifier,
  ErrorClassifierContext,
  FallbackHint,
  HttpClientConfig,
  HttpHeaders,
  HttpMethod,
  HttpRequestInterceptor,
  HttpRequestOptions,
  HttpResponse,
  HttpTransport,
  MetricsRequestInfo,
  QueryParams,
  RateLimitFeedback,
  RawHttpResponse,
  RequestOutcome,
  ResilienceProfile,
  TracingSpan,
  TransportRequest,
  UrlParts,
} from './types';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_OVERALL_TIMEOUT_MS = 30_000;
const DEFAULT_BASE_BACKOFF_MS = 200;
const DEFAULT_MAX_BACKOFF_MS = 2_000;
const DEFAULT_JITTER_FACTOR = 0.2;
const DEFAULT_MAX_SUGGESTED_RETRY_DELAY_MS = 60_000;

const RETRYABLE_CATEGORIES: Set<ErrorCategory> = new Set([
  'rate_limit',
  'transient',
  'network',
  'timeout',
]);

// ============================================================================
// Default Error Classifier
// ============================================================================

class DefaultErrorClassifier implements ErrorClassifier {
  classify(ctx: ErrorClassifierContext): ClassifiedError {
    // If we have a response, classify based on status
    if (ctx.response) {
      return this.classifyResponse(ctx.response, ctx.request.method);
    }

    // Otherwise, classify based on error
    return this.classifyError(ctx.error);
  }

  private classifyResponse(response: RawHttpResponse, method: HttpMethod): ClassifiedError {
    const status = response.status;
    const retryAfterMs = this.parseRetryAfter(response.headers['retry-after']);

    if (status === 401 || status === 403) {
      return { category: 'auth', statusCode: status, reason: 'Authentication/authorization failure' };
    }

    if (status === 404) {
      return { category: 'validation', statusCode: status, reason: 'Not found' };
    }

    if (status === 400 || status === 422) {
      return { category: 'validation', statusCode: status, reason: 'Invalid request' };
    }

    if (status === 402) {
      return { category: 'quota', statusCode: status, reason: 'Payment required' };
    }

    if (status === 429) {
      return {
        category: 'rate_limit',
        statusCode: status,
        reason: 'Rate limit exceeded',
        fallback: { retryable: true, retryAfterMs },
      };
    }

    if (status === 408) {
      return {
        category: 'timeout',
        statusCode: status,
        reason: 'Request timeout',
        fallback: { retryable: true },
      };
    }

    if (status >= 500 && status !== 501 && status !== 505) {
      return {
        category: 'transient',
        statusCode: status,
        reason: 'Server error',
        fallback: { retryable: true, retryAfterMs },
      };
    }

    return { category: 'unknown', statusCode: status, reason: 'Unknown error' };
  }

  private classifyError(error: unknown): ClassifiedError {
    if (!error) {
      return { category: 'unknown', reason: 'Unknown error' };
    }

    // Check for abort/cancellation
    if (error instanceof Error && error.name === 'AbortError') {
      return { category: 'canceled', reason: 'Request was aborted' };
    }

    // Check for timeout
    if (error instanceof Error && error.message.toLowerCase().includes('timeout')) {
      return { category: 'timeout', statusCode: 408, reason: 'Request timed out', fallback: { retryable: true } };
    }

    // Network errors are retryable
    return { category: 'network', reason: 'Network error', fallback: { retryable: true } };
  }

  private parseRetryAfter(value?: string): number | undefined {
    if (!value) return undefined;

    // Try parsing as seconds
    const seconds = Number(value);
    if (!Number.isNaN(seconds)) {
      return seconds * 1000;
    }

    // Try parsing as HTTP date
    const date = Date.parse(value);
    if (!Number.isNaN(date)) {
      const diff = date - Date.now();
      return diff > 0 ? diff : undefined;
    }

    return undefined;
  }
}

// ============================================================================
// HttpClient Implementation
// ============================================================================

export class HttpClient {
  private readonly config: Required<
    Pick<HttpClientConfig, 'transport' | 'interceptors' | 'errorClassifier'>
  > &
    HttpClientConfig;

  constructor(config: HttpClientConfig = {}) {
    this.config = {
      ...config,
      transport: config.transport ?? fetchTransport,
      interceptors: config.interceptors ?? [],
      errorClassifier: config.errorClassifier ?? new DefaultErrorClassifier(),
    };
  }

  // --------------------------------------------------------------------------
  // Public API Methods
  // --------------------------------------------------------------------------

  async requestRaw<T = unknown>(opts: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.executeRequest<T>(opts, false);
  }

  async requestJson<T = unknown>(opts: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.executeRequest<T>(opts, true);
  }

  async requestJsonBody<T = unknown>(opts: HttpRequestOptions): Promise<T> {
    const response = await this.requestJson<T>(opts);
    return response.body;
  }

  async getJson<T = unknown>(
    urlOrParts: string | UrlParts,
    opts?: Omit<HttpRequestOptions, 'method' | 'url' | 'urlParts'>
  ): Promise<T> {
    const requestOpts: HttpRequestOptions = {
      method: 'GET',
      ...(typeof urlOrParts === 'string' ? { url: urlOrParts } : { urlParts: urlOrParts }),
      ...opts,
    };
    return this.requestJsonBody<T>(requestOpts);
  }

  async postJson<T = unknown>(
    urlOrParts: string | UrlParts,
    body: unknown,
    opts?: Omit<HttpRequestOptions, 'method' | 'url' | 'urlParts' | 'body'>
  ): Promise<T> {
    const requestOpts: HttpRequestOptions = {
      method: 'POST',
      ...(typeof urlOrParts === 'string' ? { url: urlOrParts } : { urlParts: urlOrParts }),
      body,
      ...opts,
    };
    return this.requestJsonBody<T>(requestOpts);
  }

  async putJson<T = unknown>(
    urlOrParts: string | UrlParts,
    body: unknown,
    opts?: Omit<HttpRequestOptions, 'method' | 'url' | 'urlParts' | 'body'>
  ): Promise<T> {
    const requestOpts: HttpRequestOptions = {
      method: 'PUT',
      ...(typeof urlOrParts === 'string' ? { url: urlOrParts } : { urlParts: urlOrParts }),
      body,
      ...opts,
    };
    return this.requestJsonBody<T>(requestOpts);
  }

  async deleteJson<T = unknown>(
    urlOrParts: string | UrlParts,
    opts?: Omit<HttpRequestOptions, 'method' | 'url' | 'urlParts'>
  ): Promise<T> {
    const requestOpts: HttpRequestOptions = {
      method: 'DELETE',
      ...(typeof urlOrParts === 'string' ? { url: urlOrParts } : { urlParts: urlOrParts }),
      ...opts,
    };
    return this.requestJsonBody<T>(requestOpts);
  }

  // --------------------------------------------------------------------------
  // Core Request Execution
  // --------------------------------------------------------------------------

  private async executeRequest<T>(
    opts: HttpRequestOptions,
    parseJson: boolean
  ): Promise<HttpResponse<T>> {
    const startedAt = new Date();
    let tracingSpan: TracingSpan | undefined;

    try {
      // Prepare request options
      const preparedOpts = this.prepareRequest(opts);
      const resolvedUrl = this.buildUrl(preparedOpts);

      // Check cache
      if (this.config.cache && preparedOpts.cacheMode !== 'bypass' && preparedOpts.cacheKey) {
        const cached = await this.tryGetFromCache<T>(preparedOpts.cacheKey);
        if (cached && preparedOpts.cacheMode !== 'refresh') {
          const outcome: RequestOutcome = {
            ok: true,
            status: 200,
            category: 'none',
            attempts: 0,
            startedAt,
            finishedAt: new Date(),
            durationMs: 0,
            statusFamily: 2,
          };

          // Record metrics for cache hit
          if (this.config.metricsSink) {
            await this.recordMetrics(preparedOpts, resolvedUrl, outcome);
          }

          return {
            status: 200,
            headers: {},
            body: cached,
            outcome,
          };
        }
      }

      // Start tracing
      if (this.config.tracingAdapter) {
        const metricsInfo: MetricsRequestInfo = {
          operation: preparedOpts.operation,
          method: preparedOpts.method,
          url: resolvedUrl,
          correlation: preparedOpts.correlation,
          agentContext: preparedOpts.agentContext,
          extensions: preparedOpts.extensions,
          outcome: {} as RequestOutcome, // Will be filled later
        };
        tracingSpan = this.config.tracingAdapter.startSpan(metricsInfo);
      }

      // Execute with retries
      const result = await this.executeWithRetries<T>(preparedOpts, resolvedUrl, parseJson, startedAt);

      // Update cache on success
      if (
        this.config.cache &&
        preparedOpts.cacheKey &&
        preparedOpts.cacheMode !== 'bypass' &&
        result.outcome.ok
      ) {
        await this.trySetCache(preparedOpts.cacheKey, result.body);
      }

      // Record metrics
      if (this.config.metricsSink) {
        await this.recordMetrics(preparedOpts, resolvedUrl, result.outcome);
      }

      // End tracing
      if (tracingSpan && this.config.tracingAdapter) {
        await this.config.tracingAdapter.endSpan(tracingSpan, result.outcome);
      }

      return result;
    } catch (error) {
      // Record exception in tracing
      if (tracingSpan) {
        if (error instanceof Error) {
          tracingSpan.recordException(error);
        }
        const finishedAt = new Date();
        const outcome: RequestOutcome = {
          ok: false,
          category: error instanceof HttpError ? error.category : 'unknown',
          attempts: error instanceof HttpError ? error.attemptCount : 1,
          startedAt,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          errorMessage: error instanceof Error ? error.message : String(error),
        };
        if (this.config.tracingAdapter) {
          await this.config.tracingAdapter.endSpan(tracingSpan, outcome);
        }
      }

      throw error;
    }
  }

  private async executeWithRetries<T>(
    opts: HttpRequestOptions,
    url: string,
    parseJson: boolean,
    startedAt: Date
  ): Promise<HttpResponse<T>> {
    const resilience = this.mergeResilience(opts.resilience);
    const maxAttempts = resilience.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const overallTimeoutMs = resilience.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS;
    const deadline = startedAt.getTime() + overallTimeoutMs;

    let lastError: Error | null = null;
    let lastCategory: ErrorCategory = 'unknown';
    let lastStatus: number | undefined;
    let lastRateLimit: RateLimitFeedback | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStartMs = Date.now();

      try {
        // Check overall timeout
        if (Date.now() >= deadline) {
          throw new TimeoutError('Overall timeout exceeded before attempt could start', {
            url,
            method: opts.method,
            requestId: opts.correlation?.requestId,
            correlationId: opts.correlation?.correlationId,
            operation: opts.operation,
            attemptCount: attempt,
          });
        }

        // Execute single attempt
        const result = await this.executeSingleAttempt<T>(opts, url, parseJson, attempt, deadline);

        // Success - build outcome and return
        const finishedAt = new Date();
        const outcome: RequestOutcome = {
          ok: true,
          status: result.status,
          category: 'none',
          attempts: attempt,
          startedAt,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          statusFamily: Math.floor(result.status / 100),
          rateLimit: result.rateLimit ?? lastRateLimit,
        };

        return {
          status: result.status,
          headers: result.headers,
          body: result.body,
          outcome,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Extract error details
        if (error instanceof HttpError) {
          lastCategory = error.category;
          lastStatus = error.statusCode;
        } else if (error instanceof Error && error.name === 'AbortError') {
          lastCategory = 'canceled';
        } else {
          lastCategory = 'network';
        }

        // Classify error
        const classified = this.config.errorClassifier.classify({
          method: opts.method,
          url,
          attempt,
          request: opts,
          error,
        });

        lastCategory = classified.category;
        if (classified.statusCode) {
          lastStatus = classified.statusCode;
        }

        // Call error interceptors
        await this.callErrorInterceptors(opts, attempt, lastError);

        // Determine if we should retry
        const shouldRetry = this.shouldRetryError(
          classified,
          attempt,
          maxAttempts,
          opts.method,
          resilience
        );

        if (!shouldRetry) {
          break;
        }

        // Calculate backoff delay
        const delay = this.calculateBackoff(attempt, classified, resilience);
        const remainingTime = deadline - Date.now();

        if (remainingTime <= 0) {
          break;
        }

        const actualDelay = Math.min(delay, remainingTime);
        await this.sleep(actualDelay);
      }
    }

    // All retries exhausted - build error
    const finishedAt = new Date();
    const outcome: RequestOutcome = {
      ok: false,
      status: lastStatus,
      category: lastCategory,
      attempts: maxAttempts,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      statusFamily: lastStatus ? Math.floor(lastStatus / 100) : undefined,
      errorMessage: lastError?.message,
      rateLimit: lastRateLimit,
    };

    // Record metrics for failed request
    if (this.config.metricsSink) {
      await this.recordMetrics(opts, url, outcome);
    }

    // Throw enhanced error
    if (lastError instanceof HttpError) {
      throw lastError;
    }

    throw new HttpError(lastError?.message ?? 'Request failed', {
      category: lastCategory,
      statusCode: lastStatus,
      url,
      method: opts.method,
      requestId: opts.correlation?.requestId,
      correlationId: opts.correlation?.correlationId,
      operation: opts.operation,
      attemptCount: maxAttempts,
      outcome,
      cause: lastError ?? undefined,
    });
  }

  private async executeSingleAttempt<T>(
    opts: HttpRequestOptions,
    url: string,
    parseJson: boolean,
    attempt: number,
    deadline: number
  ): Promise<{ status: number; headers: HttpHeaders; body: T; rateLimit?: RateLimitFeedback }> {
    // Create abort controller for this attempt
    const controller = new AbortController();
    const resilience = this.mergeResilience(opts.resilience);
    const perAttemptTimeoutMs = resilience.perAttemptTimeoutMs;

    // Set per-attempt timeout if configured
    let timeoutHandle: NodeJS.Timeout | undefined;
    if (perAttemptTimeoutMs) {
      const remainingTime = deadline - Date.now();
      const actualTimeout = Math.min(perAttemptTimeoutMs, remainingTime);

      timeoutHandle = setTimeout(() => {
        controller.abort();
      }, actualTimeout);
    }

    try {
      // Call beforeSend interceptors
      await this.callBeforeSendInterceptors(opts, attempt, controller.signal);

      // Build transport request
      const transportReq: TransportRequest = {
        method: opts.method,
        url,
        headers: this.buildHeaders(opts),
        body: this.serializeBody(opts.body, opts.headers),
      };

      // Execute transport
      const rawResponse = await this.config.transport(transportReq, controller.signal);

      // Parse response body
      const body = parseJson ? this.parseJsonBody<T>(rawResponse.body) : (rawResponse.body as unknown as T);

      // Extract rate limit feedback
      const rateLimit = this.extractRateLimit(rawResponse.headers);

      // Build HttpResponse for interceptors
      const httpResponse: HttpResponse<T> = {
        status: rawResponse.status,
        headers: rawResponse.headers,
        body,
        outcome: {} as RequestOutcome, // Interceptors don't need full outcome
      };

      // Call afterResponse interceptors
      await this.callAfterResponseInterceptors(opts, attempt, httpResponse);

      // Check if response indicates error
      if (rawResponse.status >= 400) {
        throw new HttpError(`HTTP ${rawResponse.status}`, {
          category: this.config.errorClassifier.classify({
            method: opts.method,
            url,
            attempt,
            request: opts,
            response: rawResponse,
          }).category,
          statusCode: rawResponse.status,
          url,
          method: opts.method,
          requestId: opts.correlation?.requestId,
          correlationId: opts.correlation?.correlationId,
          operation: opts.operation,
          attemptCount: attempt,
        });
      }

      return {
        status: rawResponse.status,
        headers: rawResponse.headers,
        body,
        rateLimit,
      };
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Helper Methods
  // --------------------------------------------------------------------------

  private prepareRequest(opts: HttpRequestOptions): HttpRequestOptions {
    // Validate url XOR urlParts
    if (opts.url && opts.urlParts) {
      throw new Error('Cannot specify both url and urlParts');
    }
    if (!opts.url && !opts.urlParts) {
      throw new Error('Must specify either url or urlParts');
    }

    // Generate request ID and correlation ID if needed
    const requestId = opts.correlation?.requestId ?? this.generateId();
    const correlationId = opts.correlation?.correlationId ?? requestId;

    return {
      ...opts,
      correlation: {
        requestId,
        correlationId,
        parentCorrelationId: opts.correlation?.parentCorrelationId,
      },
      headers: { ...this.config.defaultHeaders, ...opts.headers },
      extensions: { ...this.config.defaultExtensions, ...opts.extensions },
    };
  }

  private buildUrl(opts: HttpRequestOptions): string {
    if (opts.url) {
      const url = new URL(opts.url);
      this.applyQueryParams(url, opts.query);
      return url.toString();
    }

    if (opts.urlParts) {
      const baseUrl = opts.urlParts.baseUrl ?? this.config.baseUrl;
      if (!baseUrl) {
        throw new Error('No baseUrl available for urlParts');
      }

      const path = opts.urlParts.path ?? '';
      const url = new URL(path, baseUrl);
      this.applyQueryParams(url, opts.urlParts.query);
      this.applyQueryParams(url, opts.query);
      return url.toString();
    }

    throw new Error('Invalid request options');
  }

  private applyQueryParams(url: URL, query?: QueryParams): void {
    if (!query) return;

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    }
  }

  private buildHeaders(opts: HttpRequestOptions): HttpHeaders {
    const headers: HttpHeaders = { ...this.config.defaultHeaders, ...opts.headers };

    // Add correlation headers
    if (opts.correlation?.requestId) {
      headers['X-Request-ID'] = opts.correlation.requestId;
    }
    if (opts.correlation?.correlationId) {
      headers['X-Correlation-ID'] = opts.correlation.correlationId;
    }

    return headers;
  }

  private serializeBody(body: unknown, headers?: HttpHeaders): ArrayBuffer | undefined {
    if (body === undefined || body === null) {
      return undefined;
    }

    // If already ArrayBuffer, return as-is
    if (body instanceof ArrayBuffer) {
      return body;
    }

    // If ArrayBufferView, extract buffer
    if (ArrayBuffer.isView(body)) {
      return body.buffer;
    }

    // Otherwise, JSON stringify and convert to ArrayBuffer
    const json = JSON.stringify(body);
    const encoder = new TextEncoder();
    return encoder.encode(json).buffer;
  }

  private parseJsonBody<T>(buffer: ArrayBuffer): T {
    const decoder = new TextDecoder();
    const text = decoder.decode(buffer);

    if (!text || text.trim() === '') {
      return undefined as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      // If JSON parse fails, return text as-is
      return text as unknown as T;
    }
  }

  private mergeResilience(resilience?: ResilienceProfile): ResilienceProfile {
    return {
      ...this.config.defaultResilience,
      ...resilience,
    };
  }

  private shouldRetryError(
    classified: ClassifiedError,
    attempt: number,
    maxAttempts: number,
    method: HttpMethod,
    resilience: ResilienceProfile
  ): boolean {
    // No more attempts left
    if (attempt >= maxAttempts) {
      return false;
    }

    // Check if retries are enabled
    if (resilience.retryEnabled === false) {
      return false;
    }

    // Check fallback hint
    if (classified.fallback?.retryable === false) {
      return false;
    }

    if (classified.fallback?.retryable === true) {
      return true;
    }

    // Check category
    if (RETRYABLE_CATEGORIES.has(classified.category)) {
      return true;
    }

    // For non-idempotent methods, don't retry unless explicitly marked retryable
    const retryIdempotent = resilience.retryIdempotentMethodsByDefault ?? true;
    if (!retryIdempotent && !this.isIdempotentMethod(method)) {
      return false;
    }

    return false;
  }

  private isIdempotentMethod(method: HttpMethod): boolean {
    return method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || method === 'PUT' || method === 'DELETE';
  }

  private calculateBackoff(
    attempt: number,
    classified: ClassifiedError,
    resilience: ResilienceProfile
  ): number {
    // Check for explicit retry-after
    if (classified.fallback?.retryAfterMs) {
      const maxSuggested = resilience.maxSuggestedRetryDelayMs ?? DEFAULT_MAX_SUGGESTED_RETRY_DELAY_MS;
      return Math.min(classified.fallback.retryAfterMs, maxSuggested);
    }

    // Calculate exponential backoff
    const baseBackoffMs = resilience.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    const maxBackoffMs = resilience.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    const jitterFactor = resilience.jitterFactor ?? DEFAULT_JITTER_FACTOR;

    const exponentialDelay = baseBackoffMs * Math.pow(2, attempt - 1);
    const jitter = 1 + (Math.random() * 2 - 1) * jitterFactor;
    const delayWithJitter = exponentialDelay * jitter;

    return Math.min(delayWithJitter, maxBackoffMs);
  }

  private extractRateLimit(headers: HttpHeaders): RateLimitFeedback | undefined {
    const feedback: RateLimitFeedback = {};
    let hasAnyField = false;

    // Parse request limits
    if (headers['x-ratelimit-limit-requests']) {
      feedback.limitRequests = parseInt(headers['x-ratelimit-limit-requests'], 10);
      hasAnyField = true;
    }
    if (headers['x-ratelimit-remaining-requests']) {
      feedback.remainingRequests = parseInt(headers['x-ratelimit-remaining-requests'], 10);
      hasAnyField = true;
    }
    if (headers['x-ratelimit-reset-requests']) {
      feedback.resetAt = new Date(parseInt(headers['x-ratelimit-reset-requests'], 10) * 1000);
      hasAnyField = true;
    }

    // Parse token limits
    if (headers['x-ratelimit-limit-tokens']) {
      feedback.limitTokens = parseInt(headers['x-ratelimit-limit-tokens'], 10);
      hasAnyField = true;
    }
    if (headers['x-ratelimit-remaining-tokens']) {
      feedback.remainingTokens = parseInt(headers['x-ratelimit-remaining-tokens'], 10);
      hasAnyField = true;
    }
    if (headers['x-ratelimit-reset-tokens']) {
      feedback.tokenResetAt = new Date(parseInt(headers['x-ratelimit-reset-tokens'], 10) * 1000);
      hasAnyField = true;
    }

    return hasAnyField ? feedback : undefined;
  }

  private generateId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --------------------------------------------------------------------------
  // Cache Helpers
  // --------------------------------------------------------------------------

  private async tryGetFromCache<T>(key: string): Promise<T | undefined> {
    if (!this.config.cache) return undefined;

    try {
      const entry = await this.config.cache.get<T>(key);
      if (!entry) return undefined;

      // Check if expired
      if (entry.expiresAt < Date.now()) {
        // Delete expired entry
        if (this.config.cache.delete) {
          await this.config.cache.delete(key);
        }
        return undefined;
      }

      return entry.value;
    } catch {
      return undefined;
    }
  }

  private async trySetCache<T>(key: string, value: T): Promise<void> {
    if (!this.config.cache) return;

    try {
      // Default TTL: 5 minutes
      const ttlMs = 5 * 60 * 1000;
      const expiresAt = Date.now() + ttlMs;

      await this.config.cache.set(key, { value, expiresAt });
    } catch {
      // Ignore cache errors
    }
  }

  // --------------------------------------------------------------------------
  // Interceptors
  // --------------------------------------------------------------------------

  private async callBeforeSendInterceptors(
    opts: HttpRequestOptions,
    attempt: number,
    signal: AbortSignal
  ): Promise<void> {
    const ctx: BeforeSendContext = { request: opts, attempt, signal };

    for (const interceptor of this.config.interceptors) {
      if (interceptor.beforeSend) {
        await interceptor.beforeSend(ctx);
      }
    }
  }

  private async callAfterResponseInterceptors<T>(
    opts: HttpRequestOptions,
    attempt: number,
    response: HttpResponse<T>
  ): Promise<void> {
    const ctx: AfterResponseContext<T> = { request: opts, attempt, response };

    // Call in reverse order
    for (let i = this.config.interceptors.length - 1; i >= 0; i--) {
      const interceptor = this.config.interceptors[i];
      if (interceptor.afterResponse) {
        await interceptor.afterResponse(ctx);
      }
    }
  }

  private async callErrorInterceptors(
    opts: HttpRequestOptions,
    attempt: number,
    error: Error
  ): Promise<void> {
    const ctx: OnErrorContext = { request: opts, attempt, error };

    // Call in reverse order
    for (let i = this.config.interceptors.length - 1; i >= 0; i--) {
      const interceptor = this.config.interceptors[i];
      if (interceptor.onError) {
        try {
          await interceptor.onError(ctx);
        } catch {
          // Ignore interceptor errors
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Metrics & Tracing
  // --------------------------------------------------------------------------

  private async recordMetrics(
    opts: HttpRequestOptions,
    url: string,
    outcome: RequestOutcome
  ): Promise<void> {
    if (!this.config.metricsSink) return;

    try {
      const info: MetricsRequestInfo = {
        operation: opts.operation,
        method: opts.method,
        url,
        correlation: opts.correlation,
        agentContext: opts.agentContext,
        extensions: opts.extensions,
        outcome,
      };

      await this.config.metricsSink.recordRequest(info);
    } catch {
      // Ignore metrics errors
    }
  }
}

// ============================================================================
// Error Classes (re-export from types with constructor implementation)
// ============================================================================

export { HttpError, TimeoutError } from './types';

// ============================================================================
// Default Client Factory
// ============================================================================

export interface DefaultClientOptions {
  baseUrl?: string;
  enableConsoleLogging?: boolean; // default: false
}

export function createDefaultHttpClient(options?: DefaultClientOptions): HttpClient {
  const config: HttpClientConfig = {
    baseUrl: options?.baseUrl,
    transport: fetchTransport,
    defaultResilience: {
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      retryEnabled: true,
      overallTimeoutMs: DEFAULT_OVERALL_TIMEOUT_MS,
      baseBackoffMs: DEFAULT_BASE_BACKOFF_MS,
      maxBackoffMs: DEFAULT_MAX_BACKOFF_MS,
      jitterFactor: DEFAULT_JITTER_FACTOR,
      retryIdempotentMethodsByDefault: true,
      maxSuggestedRetryDelayMs: DEFAULT_MAX_SUGGESTED_RETRY_DELAY_MS,
    },
    errorClassifier: new DefaultErrorClassifier(),
    interceptors: [],
  };

  if (options?.enableConsoleLogging) {
    config.interceptors = [
      {
        beforeSend: (ctx) => {
          console.log('[HTTP] Request:', ctx.request.method, ctx.request.url ?? ctx.request.urlParts);
        },
        afterResponse: (ctx) => {
          console.log('[HTTP] Response:', ctx.response.status, ctx.request.method);
        },
        onError: (ctx) => {
          console.error('[HTTP] Error:', ctx.error);
        },
      },
    ];

    config.metricsSink = {
      recordRequest: (info) => {
        console.log('[HTTP] Metrics:', {
          operation: info.operation,
          method: info.method,
          outcome: info.outcome,
        });
      },
    };
  }

  return new HttpClient(config);
}
