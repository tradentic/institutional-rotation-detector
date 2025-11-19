import { fetchTransport } from './transport/fetchTransport';
import type {
  AfterResponseContext,
  AgentContext,
  BaseHttpClientConfig,
  BeforeSendContext,
  ClassifiedError,
  CorrelationInfo,
  ErrorCategory,
  ErrorClassifier,
  ErrorClassifierContext,
  Extensions,
  FallbackHint,
  HttpHeaders,
  HttpRequestInterceptor,
  HttpRequestOptions,
  HttpResponse,
  HttpTransport,
  Logger,
  MetricsRequestInfo,
  OnErrorContext,
  OperationDefaults,
  RateLimitFeedback,
  RateLimiterContext,
  RawHttpResponse,
  RequestOutcome,
  ResponseClassification,
  ResilienceProfile,
  TracingSpan,
  TransportRequest,
} from './types';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 60_000;
const BASE_BACKOFF_MS = 250;
const RETRYABLE_ERROR_CATEGORIES = new Set<ErrorCategory>([
  'rate_limit',
  'server',
  'network',
  'timeout',
  'transient',
]);

const statusToCategory = (status: number): ErrorCategory => {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 400 || status === 422) return 'validation';
  if (status === 402) return 'quota';
  if (status === 429) return 'rate_limit';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'transient';
  if (status === 0) return 'network';
  return 'unknown';
};

/**
 * Helper to convert v0.8 RawHttpResponse to v0.7 Response for backwards compatibility.
 * Creates a Response object from ArrayBuffer body and headers.
 */
function rawResponseToResponse(raw: RawHttpResponse): Response {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw.headers)) {
    headers.set(key, value);
  }
  return new Response(raw.body, {
    status: raw.status,
    headers,
  });
}

/**
 * Helper to convert Headers object to plain HttpHeaders object.
 */
function headersToPlainObject(headers: Headers): HttpHeaders {
  const result: HttpHeaders = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

const parseRetryAfter = (value?: string | null): number | undefined => {
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
};

/**
 * v0.8 default error classifier with unified classify method.
 * Also supports legacy classifyNetworkError/classifyResponse for backwards compatibility.
 */
class DefaultErrorClassifier implements ErrorClassifier {
  classify(ctx: import('./types').ErrorClassifierContext): ClassifiedError {
    // Classify based on response or error
    if (ctx.error) {
      return this.classifyError(ctx.error);
    }
    // Note: In v0.8, response would be RawHttpResponse, but for now we handle both
    return this.classifyStatus(ctx.response?.status);
  }

  private classifyError(error: unknown): ClassifiedError {
    if (error instanceof TimeoutError) {
      return {
        category: 'timeout',
        statusCode: 408,
        reason: 'timeout',
        fallback: { retryable: true },
      };
    }

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        category: 'canceled',
        reason: 'aborted',
        fallback: { retryable: false },
      };
    }

    if (error instanceof HttpError) {
      return {
        category: error.category,
        statusCode: error.status,
        reason: 'http_error',
        fallback: {
          retryable: RETRYABLE_ERROR_CATEGORIES.has(error.category),
          retryAfterMs: error.fallback?.retryAfterMs,
        },
      };
    }

    return {
      category: 'transient',
      reason: 'network_error',
      fallback: { retryable: true },
    };
  }

  private classifyStatus(status?: number): ClassifiedError {
    if (!status) {
      return {
        category: 'network',
        reason: 'no_status',
        fallback: { retryable: true },
      };
    }

    const category = statusToCategory(status);
    return {
      category,
      statusCode: status,
      reason: 'http_response',
      fallback: {
        retryable: RETRYABLE_ERROR_CATEGORIES.has(category),
      },
    };
  }

  // Legacy v0.7 compatibility methods
  classifyNetworkError(error: unknown): ClassifiedError {
    return this.classifyError(error);
  }

  classifyResponse(response: Response, bodyText?: string): ClassifiedError {
    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
    const category = statusToCategory(response.status);
    return {
      category,
      statusCode: response.status,
      reason: bodyText ? 'http_response_with_body' : 'http_response',
      fallback: {
        retryable: RETRYABLE_ERROR_CATEGORIES.has(category),
        retryAfterMs: retryAfter,
      },
      // Legacy fields for backwards compat
      retryable: RETRYABLE_ERROR_CATEGORIES.has(category),
      suggestedBackoffMs: retryAfter,
    };
  }
}

interface ExecuteOptions {
  parseJson: boolean;
  allowRetries: boolean;
  maxAttemptsOverride?: number;
}

interface AttemptSuccess {
  status: number;
  response: Response;
  url: string;
  bodyText?: string;
}

interface ExecuteResult<T> {
  value: T;
  outcome: RequestOutcome;
  status: number;
  headers: HttpHeaders;
  rawResponse?: Response;
}

type AttemptHttpRequestOptions = HttpRequestOptions & { headers: Record<string, string> };

export class HttpClient {
  private readonly baseUrl?: string;
  private readonly clientName: string;
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxRetries: number;
  private readonly transport: HttpTransport;
  private readonly logger?: Logger;
  private readonly interceptors: HttpRequestInterceptor[];
  private readonly defaultErrorClassifier: ErrorClassifier = new DefaultErrorClassifier();

  constructor(private readonly config: BaseHttpClientConfig) {
    this.baseUrl = this.normalizeBaseUrl(config.baseUrl);
    this.clientName = config.clientName ?? 'http-client'; // v0.8: clientName is optional
    this.defaultTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.defaultMaxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.transport = config.transport ?? fetchTransport;
    this.logger = config.logger;
    this.interceptors = this.buildInterceptors(config);
  }

  private buildInterceptors(config: BaseHttpClientConfig): HttpRequestInterceptor[] {
    const interceptors = [...(config.interceptors ?? [])];
    // Bridge legacy hooks to v0.8 interceptors
    if (config.beforeRequest || config.afterResponse) {
      const legacyBridge: HttpRequestInterceptor = {};

      if (config.beforeRequest) {
        legacyBridge.beforeSend = ({ request }: BeforeSendContext) => config.beforeRequest?.(request);
      }

      if (config.afterResponse) {
        // Bridge: v0.7 hook expects (opts, Response), but v0.8 interceptor gets HttpResponse<T>
        // We'll convert HttpResponse back to Response for legacy hooks
        legacyBridge.afterResponse = async ({ request, response }: AfterResponseContext) => {
          // For legacy hooks, we need to reconstruct a Response object
          // However, at this point we only have headers and status, not the full response body
          // The legacy hook was called with the actual Response object
          // For now, we just call it with a minimal Response-like object
          // In practice, most legacy hooks just inspect headers/status, not body
          const legacyResponse = new Response(null, {
            status: response.status,
            headers: new Headers(response.headers),
          });
          await config.afterResponse?.(request, legacyResponse);
        };
      }

      interceptors.push(legacyBridge);
    }
    return interceptors;
  }

  async requestJson<T>(opts: HttpRequestOptions): Promise<T> {
    const preparedOpts = this.prepareRequestOptions(opts);
    const cache = this.config.cache;
    const cacheKey = preparedOpts.cacheKey;
    const cacheTtlMs = preparedOpts.cacheTtlMs ?? 0;
    const cacheMode = preparedOpts.cacheMode ?? 'default';

    // Check cache if enabled and not bypassed
    if (cache && cacheKey && cacheTtlMs > 0 && cacheMode !== 'bypass') {
      try {
        const cacheEntry = await cache.get<T>(cacheKey);
        if (cacheEntry && cacheEntry.expiresAt > Date.now() && cacheMode !== 'refresh') {
          const now = Date.now();
          // Create a minimal outcome for cache hit
          const cacheOutcome: RequestOutcome = {
            ok: true,
            status: 200,
            category: 'none',
            attempts: 0,
            startedAt: new Date(now),
            finishedAt: new Date(now),
            durationMs: 0,
            statusFamily: 200,
          };
          await this.recordMetrics({
            operation: preparedOpts.operation,
            method: preparedOpts.method,
            url: this.safeBuildUrl(preparedOpts),
            correlation: this.getCorrelationInfo(preparedOpts),
            agentContext: preparedOpts.agentContext,
            extensions: preparedOpts.extensions,
            outcome: cacheOutcome,
            // Legacy fields
            clientName: this.clientName,
            durationMs: 0,
            status: 200,
            cacheHit: true,
            attempts: 0,
          });
          this.logger?.debug('http.cache.hit', this.baseLogMeta(preparedOpts));
          return cacheEntry.value;
        }
      } catch (error) {
        this.logger?.warn('http.cache.get.error', {
          ...this.baseLogMeta(preparedOpts),
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    // DRY: Call requestJsonResponse and extract body
    const response = await this.requestJsonResponse<T>(opts);

    // Store in cache if enabled
    if (cache && cacheKey && cacheTtlMs > 0) {
      const cacheEntry = {
        value: response.body,
        expiresAt: Date.now() + cacheTtlMs,
      };
      Promise.resolve(cache.set(cacheKey, cacheEntry)).catch((error) =>
        this.logger?.warn('http.cache.set.error', {
          ...this.baseLogMeta(preparedOpts),
          error: error instanceof Error ? error.message : error,
        }),
      );
    }

    return response.body;
  }

  async requestRaw(opts: HttpRequestOptions): Promise<Response> {
    const preparedOpts = this.prepareRequestOptions(opts);
    const span = this.startSpan(preparedOpts);
    try {
      const response = await this.executeWithRetries<Response>(preparedOpts, {
        parseJson: false,
        allowRetries: this.getIdempotent(preparedOpts),
      });
      // Span ending is handled by executeWithRetries via endSpan helper
      return response;
    } catch (error) {
      if (span && error instanceof Error) {
        span.recordException?.(error);
      }
      // Span ending is handled by executeWithRetries via endSpan helper
      throw error;
    }
  }

  /**
   * Performs an HTTP request and resolves with the raw text body.
   *
   * This is a thin wrapper around {@link requestTextResponse}, so it inherits the same
   * retry, tracing, metrics, classification, and hook behaviour. Use it when an
   * endpoint returns plain text (CSV, NDJSON, etc.).
   */
  async requestText(opts: HttpRequestOptions): Promise<string> {
    const response = await this.requestTextResponse(opts);
    return response.body;
  }

  /**
   * Performs an HTTP request and resolves with an ArrayBuffer of the response
   * body.
   *
   * Like {@link requestText}, this method simply delegates to
   * {@link requestArrayBufferResponse} to ensure all resilience features apply consistently
   * before decoding the payload into binary form.
   */
  async requestArrayBuffer(opts: HttpRequestOptions): Promise<ArrayBuffer> {
    const response = await this.requestArrayBufferResponse(opts);
    return response.body;
  }

  /**
   * v0.8 method: Performs an HTTP request and returns HttpResponse<T> with the parsed JSON body and request outcome.
   *
   * This method returns the full v0.8 HttpResponse wrapper which includes:
   * - status: HTTP status code
   * - headers: Response headers
   * - body: Parsed JSON body of type T
   * - outcome: RequestOutcome with retry/timing information
   *
   * Use this method when you need access to the full request outcome (attempts, duration, etc.).
   * For simple cases where you only need the body, use {@link requestJson} instead.
   *
   * @example
   * ```typescript
   * const response = await client.requestJsonResponse<User>({
   *   method: 'GET',
   *   operation: 'getUser',
   *   urlParts: { path: '/users/123' },
   * });
   * console.log(response.body); // User object
   * console.log(response.outcome.attempts); // Number of attempts
   * console.log(response.outcome.durationMs); // Total duration
   * ```
   */
  async requestJsonResponse<T>(opts: HttpRequestOptions): Promise<HttpResponse<T>> {
    const preparedOpts = this.prepareRequestOptions(opts);
    const result = await this.executeWithRetriesInternal<T>(preparedOpts, {
      parseJson: true,
      allowRetries: this.getIdempotent(preparedOpts),
    });

    return {
      status: result.status,
      headers: result.headers,
      body: result.value,
      outcome: result.outcome,
      correlation: this.getCorrelationInfo(preparedOpts),
      agentContext: preparedOpts.agentContext,
      extensions: preparedOpts.extensions,
    };
  }

  /**
   * v0.8 method: Performs an HTTP request and returns HttpResponse<string> with the text body and request outcome.
   *
   * This method returns the full v0.8 HttpResponse wrapper which includes:
   * - status: HTTP status code
   * - headers: Response headers
   * - body: Response body as string
   * - outcome: RequestOutcome with retry/timing information
   *
   * Use this when an endpoint returns plain text (CSV, NDJSON, etc.) and you need outcome metadata.
   * For simple cases where you only need the text, use {@link requestText} instead.
   */
  async requestTextResponse(opts: HttpRequestOptions): Promise<HttpResponse<string>> {
    const preparedOpts = this.prepareRequestOptions(opts);
    const result = await this.executeWithRetriesInternal<Response>(preparedOpts, {
      parseJson: false,
      allowRetries: this.getIdempotent(preparedOpts),
    });

    const text = await result.value.text();

    return {
      status: result.status,
      headers: result.headers,
      body: text,
      outcome: result.outcome,
      rawResponse: result.rawResponse,
      correlation: this.getCorrelationInfo(preparedOpts),
      agentContext: preparedOpts.agentContext,
      extensions: preparedOpts.extensions,
    };
  }

  /**
   * v0.8 method: Performs an HTTP request and returns HttpResponse<ArrayBuffer> with the binary body and request outcome.
   *
   * This method returns the full v0.8 HttpResponse wrapper which includes:
   * - status: HTTP status code
   * - headers: Response headers
   * - body: Response body as ArrayBuffer
   * - outcome: RequestOutcome with retry/timing information
   *
   * Use this when you need binary data with outcome metadata.
   * For simple cases where you only need the ArrayBuffer, use {@link requestArrayBuffer} instead.
   */
  async requestArrayBufferResponse(opts: HttpRequestOptions): Promise<HttpResponse<ArrayBuffer>> {
    const preparedOpts = this.prepareRequestOptions(opts);
    const result = await this.executeWithRetriesInternal<Response>(preparedOpts, {
      parseJson: false,
      allowRetries: this.getIdempotent(preparedOpts),
    });

    const arrayBuffer = await result.value.arrayBuffer();

    return {
      status: result.status,
      headers: result.headers,
      body: arrayBuffer,
      outcome: result.outcome,
      rawResponse: result.rawResponse,
      correlation: this.getCorrelationInfo(preparedOpts),
      agentContext: preparedOpts.agentContext,
      extensions: preparedOpts.extensions,
    };
  }

  /**
   * v0.8 method: Performs an HTTP request and returns HttpResponse<RawHttpResponse> with the raw response and request outcome.
   *
   * This method returns the full v0.8 HttpResponse wrapper which includes:
   * - status: HTTP status code
   * - headers: Response headers
   * - body: RawHttpResponse (v0.8 transport-level response)
   * - outcome: RequestOutcome with retry/timing information
   *
   * Use this for low-level access to the transport response with full outcome metadata.
   * For simple cases where you only need the Response object, use {@link requestRaw} instead.
   */
  async requestRawResponse(opts: HttpRequestOptions): Promise<HttpResponse<RawHttpResponse>> {
    const preparedOpts = this.prepareRequestOptions(opts);
    const result = await this.executeWithRetriesInternal<Response>(preparedOpts, {
      parseJson: false,
      allowRetries: this.getIdempotent(preparedOpts),
    });

    // Convert Response to RawHttpResponse
    const rawResponse: RawHttpResponse = {
      status: result.status,
      headers: result.headers,
      body: await result.value.arrayBuffer(),
    };

    return {
      status: result.status,
      headers: result.headers,
      body: rawResponse,
      outcome: result.outcome,
      rawResponse: result.rawResponse,
      correlation: this.getCorrelationInfo(preparedOpts),
      agentContext: preparedOpts.agentContext,
      extensions: preparedOpts.extensions,
    };
  }

  private startSpan(opts: HttpRequestOptions): TracingSpan | undefined {
    // For v0.8, we need a full MetricsRequestInfo with outcome, but we don't have it yet at start
    // For backwards compatibility with v0.7 tracing, we check both new and legacy signatures
    const tracingAdapter = this.config.tracing ?? this.config.tracingAdapter;
    if (!tracingAdapter) return undefined;

    // Check if it's the new v0.8 TracingAdapter
    if ('startSpan' in tracingAdapter && typeof tracingAdapter.startSpan === 'function') {
      // For v0.8, startSpan expects MetricsRequestInfo which includes outcome
      // We'll create a minimal info object and update it later
      // For now, return undefined and handle tracing at the end of requests
      // This is a known limitation of the v0.8 tracing model
      return undefined;
    }

    // Legacy v0.7 tracing path
    const attributes: Record<string, string | number | boolean | null> = {
      client: this.clientName,
      operation: opts.operation ?? '',
      method: opts.method,
      path: opts.path ?? null,
      requestId: opts.requestId ?? opts.correlation?.requestId ?? null,
    };

    const correlation = opts.correlation;
    if (correlation?.correlationId ?? opts.correlationId) {
      attributes['correlation_id'] = correlation?.correlationId ?? opts.correlationId ?? null;
    }
    if (correlation?.parentCorrelationId ?? opts.parentCorrelationId) {
      attributes['parent_correlation_id'] = correlation?.parentCorrelationId ?? opts.parentCorrelationId ?? null;
    }

    const agentContext = opts.agentContext;
    if (agentContext?.agent || agentContext?.agentName) {
      attributes['agent.name'] = agentContext.agentName ?? agentContext.agent ?? '';
    }
    if (agentContext?.runId || agentContext?.sessionId) {
      attributes['agent.run_id'] = agentContext.sessionId ?? agentContext.runId ?? '';
    }
    if (agentContext?.labels) {
      for (const [key, value] of Object.entries(agentContext.labels)) {
        attributes[`agent.label.${key}`] = value;
      }
    }

    // Legacy tracing adapter with startSpan(name, options) signature
    const span = (tracingAdapter as any).startSpan?.(`${this.clientName}.${opts.operation ?? 'unknown'}`, {
      attributes,
      agentContext,
      extensions: opts.extensions,
    });

    return span;
  }

  private endSpan(span: TracingSpan | undefined, outcome: RequestOutcome): void {
    if (!span) return;

    const tracingAdapter = this.config.tracing ?? this.config.tracingAdapter;
    if (!tracingAdapter) return;

    // Check if it's the new v0.8 TracingAdapter with endSpan method
    if ('endSpan' in tracingAdapter && typeof tracingAdapter.endSpan === 'function') {
      Promise.resolve(tracingAdapter.endSpan(span, outcome)).catch(() => {
        // Ignore tracing errors
      });
    } else {
      // Legacy v0.7 tracing with span.end() method
      if ('end' in span && typeof (span as any).end === 'function') {
        (span as any).end();
      }
    }
  }

  private async executeWithRetriesInternal<T>(opts: HttpRequestOptions, executeOptions: ExecuteOptions): Promise<ExecuteResult<T>> {
    const startedAt = Date.now();
    const resilience = opts.resilience ?? {};
    // Legacy RequestBudget support (deprecated)
    const legacyBudget = opts.budget2;
    const configuredAttempts =
      executeOptions.maxAttemptsOverride ??
      resilience.maxAttemptsOverride ??
      resilience.maxAttempts ??
      legacyBudget?.maxAttempts ??
      this.getMaxRetries(opts) + 1;
    const allowRetries = executeOptions.allowRetries && (resilience.retryEnabled ?? true) && configuredAttempts > 1;
    const maxAttempts = allowRetries ? Math.max(configuredAttempts, 1) : 1;
    const rateLimitKey = `${this.clientName}:${opts.operation}`;
    const deadline = this.computeDeadline(opts, startedAt);
    let lastError: unknown;
    let lastClassified: ClassifiedError | undefined;
    let lastStatus: number | undefined;
    let lastRateLimit: RateLimitFeedback | undefined;

    let lastAttemptOpts: AttemptHttpRequestOptions | HttpRequestOptions = opts;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let attemptOpts: AttemptHttpRequestOptions | HttpRequestOptions = opts;
      let attemptContext: RateLimiterContext | undefined;
      let resolvedUrl: string | undefined;
      const attemptStart = Date.now();
      try {
        const controller = new AbortController();
        attemptOpts = await this.prepareAttemptOptions(opts, controller.signal, attempt);
        lastAttemptOpts = attemptOpts;
        attemptContext = this.createRateLimiterContext(attemptOpts, attempt);
        const logMeta = { ...this.baseLogMeta(attemptOpts), attempt, maxAttempts };
        this.logger?.debug('http.request.attempt', logMeta);

        resolvedUrl = this.buildUrl(attemptOpts);

        const executeAttempt = async () =>
          this.runAttempt({
            opts: attemptOpts as AttemptHttpRequestOptions,
            attemptContext: attemptContext as RateLimiterContext,
            rateLimitKey,
            deadline,
            parseJson: executeOptions.parseJson,
            controller,
            url: resolvedUrl!,
          });

        const runner = this.config.policyWrapper
          ? () =>
              this.config.policyWrapper!(executeAttempt, {
                client: this.clientName,
                operation: attemptOpts.operation ?? '',
                requestId: attemptOpts.requestId ?? '',
                correlationId: attemptOpts.correlationId,
                parentCorrelationId: attemptOpts.parentCorrelationId,
                agentContext: attemptOpts.agentContext,
                extensions: attemptOpts.extensions,
              })
          : executeAttempt;

        const attemptResult = await runner();
        const durationMs = Date.now() - attemptStart;
        await this.callOptionalHook('rateLimiter.onSuccess', () =>
          this.config.rateLimiter?.onSuccess?.(rateLimitKey, attemptContext as RateLimiterContext),
        );
        await this.callOptionalHook('circuitBreaker.onSuccess', () =>
          this.config.circuitBreaker?.onSuccess(rateLimitKey),
        );

        let response = attemptResult.response;
        response = await this.applyAfterResponseInterceptors(attemptOpts, response, attempt, attemptStart);

        lastRateLimit = this.extractRateLimit(response.headers) ?? lastRateLimit;
        const finishedAt = Date.now();
        const aggregateOutcome: RequestOutcome = {
          ok: true,
          status: attemptResult.status,
          category: 'none',
          attempts: attempt,
          startedAt: new Date(startedAt),
          finishedAt: new Date(finishedAt),
          durationMs: finishedAt - startedAt,
          statusFamily: Math.floor(attemptResult.status / 100) * 100,
          rateLimit: lastRateLimit,
          // Legacy fields for backwards compat
          errorCategory: undefined,
          rateLimitFeedback: lastRateLimit,
        };

        const parsedValue = await this.resolveResponseValue<T>(
          response,
          executeOptions.parseJson,
          attemptResult.bodyText,
        );
        await this.recordMetrics({
          operation: attemptOpts.operation,
          method: attemptOpts.method,
          url: attemptResult.url,
          correlation: this.getCorrelationInfo(attemptOpts),
          agentContext: attemptOpts.agentContext,
          extensions: attemptOpts.extensions,
          outcome: aggregateOutcome,
          // Legacy fields for backwards compat
          clientName: this.clientName,
          status: attemptResult.status,
          durationMs: finishedAt - startedAt,
          attempts: attempt,
          rateLimitFeedback: lastRateLimit,
          errorCategory: undefined,
        });
        this.logger?.info('http.request.success', {
          ...logMeta,
          status: attemptResult.status,
          durationMs,
        });

        // Return full result including outcome for v0.8 HttpResponse<T> support
        return {
          value: parsedValue,
          outcome: aggregateOutcome,
          status: attemptResult.status,
          headers: headersToPlainObject(response.headers),
          rawResponse: response,
        };
      } catch (error) {
        lastError = error;
        const durationMs = Date.now() - attemptStart;
        const status = error instanceof HttpError ? error.status : error instanceof TimeoutError ? 408 : 0;
        lastStatus = status;
        const classifiedError = this.classifyError(
          error,
          attemptOpts,
          error instanceof HttpError ? error.response : undefined,
        );
        lastClassified = classifiedError;
        const category =
          classifiedError?.category ??
          (error instanceof HttpError ? error.category : error instanceof TimeoutError ? 'timeout' : 'network');
        const rateLimit = this.extractRateLimit(error instanceof HttpError ? error.headers : undefined);
        if (rateLimit) {
          lastRateLimit = rateLimit;
        }
        if (attemptContext) {
          await this.callOptionalHook('rateLimiter.onError', () =>
            this.config.rateLimiter?.onError?.(rateLimitKey, error, attemptContext as RateLimiterContext),
          );
        }
        await this.callOptionalHook('circuitBreaker.onFailure', () =>
          this.config.circuitBreaker?.onFailure(rateLimitKey, error),
        );
        await this.runErrorInterceptors(attemptOpts, error, attempt);

        const retryable =
          allowRetries && attempt < maxAttempts && this.shouldRetry(error, classifiedError, this.getIdempotent(attemptOpts));
        const logMeta = { ...this.baseLogMeta(attemptOpts), attempt, maxAttempts };
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
          const finishedAt = Date.now();
          const errorMsg = error instanceof Error ? error.message : String(error);
          const aggregateOutcome: RequestOutcome = {
            ok: false,
            status,
            category,
            attempts: attempt,
            startedAt: new Date(startedAt),
            finishedAt: new Date(finishedAt),
            durationMs: finishedAt - startedAt,
            statusFamily: status ? Math.floor(status / 100) * 100 : undefined,
            errorMessage: errorMsg,
            rateLimit: lastRateLimit,
            // Legacy fields for backwards compat
            errorCategory: category,
            rateLimitFeedback: lastRateLimit,
          };
          await this.recordMetrics({
            operation: attemptOpts.operation ?? opts.operation,
            method: attemptOpts.method,
            url: resolvedUrl ?? this.safeBuildUrl(attemptOpts),
            correlation: this.getCorrelationInfo(attemptOpts),
            agentContext: attemptOpts.agentContext,
            extensions: attemptOpts.extensions,
            outcome: aggregateOutcome,
            // Legacy fields for backwards compat
            clientName: this.clientName,
            status,
            durationMs: finishedAt - startedAt,
            attempts: attempt,
            errorCategory: category,
            rateLimitFeedback: lastRateLimit,
          });
          throw error;
        }

        let delay = this.getRetryDelay(error, attempt, classifiedError, attemptOpts);
        if (deadline !== undefined) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            throw new TimeoutError('Budget exceeded before retry');
          }
          delay = Math.min(delay, Math.max(0, remaining));
        }
        await this.sleep(delay);
      }
    }

    const finishedAt = Date.now();
    const status = lastStatus ?? 0;
    const category = lastClassified?.category ?? (lastStatus === 408 ? 'timeout' : 'unknown');
    const errorMsg = lastError instanceof Error ? lastError.message : String(lastError ?? 'Request failed');
    const aggregateOutcome: RequestOutcome = {
      ok: false,
      status,
      category,
      attempts: maxAttempts,
      startedAt: new Date(startedAt),
      finishedAt: new Date(finishedAt),
      durationMs: finishedAt - startedAt,
      statusFamily: status ? Math.floor(status / 100) * 100 : undefined,
      errorMessage: errorMsg,
      rateLimit: lastRateLimit,
      // Legacy fields for backwards compat
      errorCategory: category,
      rateLimitFeedback: lastRateLimit,
    };
    const metricsOpts = lastAttemptOpts ?? opts;
    const url = this.safeBuildUrl(metricsOpts);
    await this.recordMetrics({
      operation: metricsOpts.operation ?? opts.operation,
      method: metricsOpts.method,
      url,
      correlation: this.getCorrelationInfo(metricsOpts),
      agentContext: metricsOpts.agentContext,
      extensions: metricsOpts.extensions,
      outcome: aggregateOutcome,
      // Legacy fields for backwards compat
      clientName: this.clientName,
      status,
      durationMs: finishedAt - startedAt,
      attempts: maxAttempts,
      errorCategory: category,
      rateLimitFeedback: lastRateLimit,
    });

    if (lastStatus === 408 || (deadline !== undefined && Date.now() >= deadline)) {
      throw new TimeoutError('Request timed out');
    }

    throw lastError ?? new Error('Request failed');
  }

  /**
   * Backwards-compatible wrapper that extracts just the value.
   * Legacy code expects Promise<T>, not Promise<ExecuteResult<T>>.
   */
  private async executeWithRetries<T>(opts: HttpRequestOptions, executeOptions: ExecuteOptions): Promise<T> {
    const result = await this.executeWithRetriesInternal<T>(opts, executeOptions);
    return result.value;
  }

  private async runAttempt(params: {
    opts: AttemptHttpRequestOptions;
    attemptContext: RateLimiterContext;
    rateLimitKey: string;
    deadline?: number;
    parseJson: boolean;
    controller: AbortController;
    url: string;
  }): Promise<AttemptSuccess> {
    const { opts, attemptContext, rateLimitKey, deadline, parseJson, controller, url } = params;

    await this.config.rateLimiter?.throttle(rateLimitKey, attemptContext);
    await this.config.circuitBreaker?.beforeRequest(rateLimitKey);

    const timeoutMs = this.computeAttemptTimeout(opts, deadline);
    let didTimeout = false;
    const timeoutHandle = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);

    const headers = opts.headers;

    // Prepare body for transport (v0.8 expects ArrayBuffer if body is provided)
    let transportBody: ArrayBuffer | undefined;
    if (opts.body !== undefined && opts.body !== null) {
      const serialized = this.serializeBody(opts.body, headers);
      if (typeof serialized === 'string') {
        const encoder = new TextEncoder();
        transportBody = encoder.encode(serialized).buffer;
      } else if (serialized instanceof ArrayBuffer) {
        transportBody = serialized;
      } else if (ArrayBuffer.isView(serialized)) {
        transportBody = serialized.buffer;
      } else if (serialized instanceof Blob) {
        transportBody = await serialized.arrayBuffer();
      } else {
        // For other BodyInit types, convert to string then ArrayBuffer
        const str = String(serialized);
        const encoder = new TextEncoder();
        transportBody = encoder.encode(str).buffer;
      }
    }

    // Create v0.8 transport request
    const transportRequest: TransportRequest = {
      method: opts.method,
      url,
      headers,
      body: transportBody,
    };

    try {
      // Call v0.8 transport
      const rawResponse = await this.transport(transportRequest, controller.signal);

      // Convert RawHttpResponse back to Response for backwards compatibility
      const response = rawResponseToResponse(rawResponse);

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
          response,
          correlation: opts.correlation ?? {
            requestId: opts.requestId ?? '',
            correlationId: opts.correlationId,
            parentCorrelationId: opts.parentCorrelationId,
          },
          agentContext: opts.agentContext,
          extensions: opts.extensions,
        });
      }

      if (!parseJson) {
        return { status, response, url };
      }

      return { status, response, bodyText, url };
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
    if (opts.url) {
      const url = new URL(opts.url);
      this.applyQueryParameters(url, opts);
      return url.toString();
    }

    const urlParts = opts.urlParts;
    if (urlParts?.path || urlParts?.baseUrl) {
      const path = urlParts.path ?? '';
      const base = this.normalizeBaseUrl(urlParts.baseUrl ?? this.resolveBaseUrlForRequest(opts));
      let url: URL;

      if (path && this.isAbsoluteUrl(path)) {
        url = new URL(path);
      } else {
        if (!base) {
          throw new Error('No baseUrl provided and request path is not an absolute URL');
        }
        const normalizedBase = base.endsWith('/') ? base : `${base}/`;
        const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
        url = new URL(normalizedPath, normalizedBase);
      }

      this.applyQueryParameters(url, opts, urlParts.query);
      return url.toString();
    }

    const path = opts.path ?? '';
    const base = this.resolveBaseUrlForRequest(opts);
    if (path && this.isAbsoluteUrl(path)) {
      const url = new URL(path);
      this.applyQueryParameters(url, opts);
      return url.toString();
    }

    if (!base) {
      throw new Error('No baseUrl provided and request path is not an absolute URL');
    }
    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(normalizedPath, normalizedBase);
    this.applyQueryParameters(url, opts);
    return url.toString();
  }

  private applyQueryParameters(url: URL, opts: HttpRequestOptions, fromUrlParts?: HttpRequestOptions['query']) {
    const apply = (query?: HttpRequestOptions['query']) => {
      if (!query) return;
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const entry of value) {
            url.searchParams.append(key, String(entry));
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    };

    apply(fromUrlParts);
    apply(opts.query);

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
    const correlation = this.normalizeCorrelation(opts);
    const resilience = this.mergeResilience(opts.resilience);
    const agentContext = { ...this.config.defaultAgentContext, ...opts.agentContext };
    const headers: HttpHeaders | undefined = this.mergeHeaders(this.config.defaultHeaders, opts.headers);
    const path = this.resolvePath(opts);

    return {
      ...opts,
      path,
      headers,
      resilience,
      agentContext,
      requestId: correlation.requestId,
      correlationId: correlation.correlationId,
      parentCorrelationId: correlation.parentCorrelationId,
      correlation,
    };
  }

  private mergeHeaders(
    defaults?: HttpHeaders | Record<string, string | undefined>,
    provided?: HttpHeaders | Record<string, string | undefined>,
  ): HttpHeaders | undefined {
    if (!defaults && !provided) return provided as HttpHeaders | undefined;
    const result: Record<string, string> = {};
    for (const source of [defaults, provided]) {
      if (!source) continue;
      for (const [key, value] of Object.entries(source)) {
        if (value !== undefined) {
          result[key] = value;
        }
      }
    }
    return result;
  }

  private mergeResilience(resilience?: ResilienceProfile): ResilienceProfile | undefined {
    if (!this.config.defaultResilience && !resilience) return resilience;
    return { ...this.config.defaultResilience, ...resilience };
  }

  private normalizeCorrelation(opts: HttpRequestOptions): CorrelationInfo {
    const generated = this.generateRequestId();
    const correlation = opts.correlation;
    const requestId = opts.requestId ?? correlation?.requestId ?? generated;
    return {
      requestId, // Always defined (string)
      correlationId: opts.correlationId ?? correlation?.correlationId,
      parentCorrelationId: opts.parentCorrelationId ?? correlation?.parentCorrelationId,
    };
  }

  private generateRequestId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? (crypto.randomUUID as () => string)()
      : Math.random().toString(36).slice(2);
  }

  private resolvePath(opts: HttpRequestOptions): string | undefined {
    if (opts.path) return opts.path;
    if (opts.urlParts?.path) return opts.urlParts.path;
    if (opts.url) {
      try {
        return new URL(opts.url).pathname;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private cloneRequestOptions(opts: HttpRequestOptions): HttpRequestOptions {
    return {
      ...opts,
      headers: opts.headers ? { ...opts.headers } : undefined,
      query: opts.query ? { ...opts.query } : undefined,
      urlParts: opts.urlParts ? { ...opts.urlParts, query: opts.urlParts.query ? { ...opts.urlParts.query } : undefined } : undefined,
    };
  }

  private async prepareAttemptOptions(
    opts: HttpRequestOptions,
    signal: AbortSignal,
    attemptNumber: number,
  ): Promise<AttemptHttpRequestOptions> {
    const cloned = this.cloneRequestOptions(opts);
    let attempt: AttemptHttpRequestOptions = {
      ...cloned,
      headers: this.buildHeaders(cloned.headers),
    };

    attempt = await this.applyBeforeSendInterceptors(attempt, signal, attemptNumber);
    return attempt;
  }

  private getOperationDefaults(opts: HttpRequestOptions): OperationDefaults | undefined {
    if (!opts.operation || !this.config.operationDefaults) return undefined;
    return this.config.operationDefaults[opts.operation];
  }

  private getTimeoutMs(opts: HttpRequestOptions): number {
    const opDefaults = this.getOperationDefaults(opts);
    return opts.resilience?.perAttemptTimeoutMs ?? opts.timeoutMs ?? opDefaults?.timeoutMs ?? this.defaultTimeoutMs;
  }

  private getMaxRetries(opts: HttpRequestOptions): number {
    const opDefaults = this.getOperationDefaults(opts);
    return opts.maxRetries ?? opDefaults?.maxRetries ?? this.defaultMaxRetries;
  }

  private getIdempotent(opts: HttpRequestOptions): boolean {
    if (opts.idempotent !== undefined) {
      return opts.idempotent;
    }
    const opDefaults = this.getOperationDefaults(opts);
    if (opDefaults?.idempotent !== undefined) {
      return opDefaults.idempotent;
    }
    return opts.method === 'GET' || opts.method === 'HEAD' || opts.method === 'OPTIONS';
  }

  private buildHeaders(source?: Record<string, string | undefined>): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (source) {
      for (const [key, value] of Object.entries(source)) {
        if (value !== undefined) {
          headers[key] = value;
        }
      }
    }
    return headers;
  }

  private async applyBeforeSendInterceptors(
    opts: AttemptHttpRequestOptions,
    signal: AbortSignal,
    attempt: number,
  ): Promise<AttemptHttpRequestOptions> {
    let current = opts;
    for (const interceptor of this.interceptors) {
      if (!interceptor.beforeSend) continue;
      const ctx: BeforeSendContext = { request: current, signal, attempt };
      try {
        await interceptor.beforeSend(ctx);
        // Interceptor may mutate ctx.request directly
        current = ctx.request as AttemptHttpRequestOptions;
      } catch (error) {
        this.logger?.warn('http.interceptor.beforeSend.failed', {
          client: this.clientName,
          operation: opts.operation ?? '',
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
    return current;
  }

  private async applyAfterResponseInterceptors(
    opts: HttpRequestOptions,
    response: Response,
    attempt: number,
    attemptStart: number,
  ): Promise<Response> {
    // Build a minimal HttpResponse for v0.8 interceptors
    // Note: This is a per-attempt outcome, not the final aggregate outcome
    const attemptDuration = Date.now() - attemptStart;
    const tempOutcome: RequestOutcome = {
      ok: response.ok,
      status: response.status,
      category: response.ok ? 'none' : statusToCategory(response.status),
      attempts: attempt,
      startedAt: new Date(attemptStart),
      finishedAt: new Date(attemptStart + attemptDuration),
      durationMs: attemptDuration,
      statusFamily: Math.floor(response.status / 100) * 100,
    };

    const httpResponse: HttpResponse<unknown> = {
      status: response.status,
      headers: headersToPlainObject(response.headers),
      body: undefined, // We don't have the parsed body yet at this point
      outcome: tempOutcome,
      rawResponse: response,
      correlation: this.getCorrelationInfo(opts),
      agentContext: opts.agentContext,
      extensions: opts.extensions,
    };

    for (const interceptor of this.interceptors) {
      if (!interceptor.afterResponse) continue;
      const ctx: AfterResponseContext<unknown> = {
        request: opts,
        attempt,
        response: httpResponse,
      };
      try {
        await interceptor.afterResponse(ctx);
        // Interceptor may mutate ctx.response
        // Update our response if needed (though typically interceptors just observe)
      } catch (error) {
        this.logger?.warn('http.interceptor.afterResponse.failed', {
          client: this.clientName,
          operation: opts.operation ?? '',
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't throw - allow other interceptors to run
      }
    }

    return response;
  }

  private async runErrorInterceptors(opts: HttpRequestOptions, error: unknown, attempt: number): Promise<void> {
    for (const interceptor of [...this.interceptors].reverse()) {
      if (!interceptor.onError) continue;
      const ctx: OnErrorContext = { request: opts, error, attempt };
      try {
        await interceptor.onError(ctx);
      } catch (hookError) {
        this.logger?.warn('http.interceptor.onError.failed', {
          client: this.clientName,
          operation: opts.operation ?? '',
          error: hookError instanceof Error ? hookError.message : String(hookError),
        });
        // Don't throw - allow other error interceptors to run
      }
    }
  }

  private async resolveResponseValue<T>(
    response: Response,
    parseJson: boolean,
    cachedBodyText?: string,
  ): Promise<T> {
    if (!parseJson) {
      return response as unknown as T;
    }
    const text = cachedBodyText ?? (await response.clone().text());
    return this.parseBodyFromText<T>(text) as T;
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
      path: opts.path ?? '',
      operation: opts.operation ?? '',
      attempt,
      requestId: opts.requestId ?? '',
      correlationId: opts.correlationId,
      parentCorrelationId: opts.parentCorrelationId,
      agentContext: opts.agentContext,
      extensions: opts.extensions,
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

  private classifyError(
    error: unknown,
    request: HttpRequestOptions,
    response?: Response,
  ): ClassifiedError | undefined {
    const classifier = this.config.errorClassifier ?? this.defaultErrorClassifier;
    try {
      // Try v0.8 unified classify method first
      if ('classify' in classifier && typeof classifier.classify === 'function') {
        const ctx: ErrorClassifierContext = {
          method: request.method,
          url: this.safeBuildUrl(request),
          attempt: 1, // We don't have attempt context here
          request,
          response: response ? undefined : undefined, // v0.8 expects RawHttpResponse, not Response
          error,
        };
        return classifier.classify(ctx);
      }
      // Fall back to legacy v0.7 methods
      if (response && 'classifyResponse' in classifier && typeof classifier.classifyResponse === 'function') {
        return classifier.classifyResponse(response, undefined);
      }
      if ('classifyNetworkError' in classifier && typeof classifier.classifyNetworkError === 'function') {
        return classifier.classifyNetworkError(error);
      }
      return undefined;
    } catch (classifierError) {
      this.logger?.warn('http.classifier.error', {
        client: this.clientName,
        operation: request.operation ?? '',
        error: classifierError instanceof Error ? classifierError.message : String(classifierError),
      });
      return undefined;
    }
  }

  private baseLogMeta(
    opts: Pick<
      HttpRequestOptions,
      'operation' | 'method' | 'path' | 'requestId' | 'correlationId' | 'parentCorrelationId' | 'agentContext' | 'extensions'
    >,
  ) {
    return {
      client: this.clientName,
      operation: opts.operation,
      method: opts.method,
      path: opts.path,
      requestId: opts.requestId,
      correlationId: opts.correlationId,
      parentCorrelationId: opts.parentCorrelationId,
      agentContext: opts.agentContext,
      extensions: opts.extensions,
    };
  }

  private getCorrelationInfo(opts: HttpRequestOptions): CorrelationInfo {
    if (opts.correlation) {
      return opts.correlation;
    }
    return {
      requestId: opts.requestId ?? this.generateRequestId(),
      correlationId: opts.correlationId,
      parentCorrelationId: opts.parentCorrelationId,
    };
  }

  private safeBuildUrl(opts: HttpRequestOptions): string {
    try {
      return this.buildUrl(opts);
    } catch {
      return opts.url ?? opts.path ?? '';
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

  private shouldRetry(error: unknown, classified: ClassifiedError | undefined, idempotent: boolean): boolean {
    if (classified) {
      return classified.retryable ?? false;
    }
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

  private getRetryDelay(
    error: unknown,
    attempt: number,
    classified: ClassifiedError | undefined,
    opts: HttpRequestOptions,
  ): number {
    if (classified?.suggestedBackoffMs !== undefined) {
      return Math.min(classified.suggestedBackoffMs, MAX_RETRY_DELAY_MS);
    }
    if (error instanceof HttpError) {
      const retryAfter = error.fallback?.retryAfterMs ?? this.parseRetryAfterHeader(error.headers?.get('retry-after'));
      if (retryAfter) {
        return Math.min(retryAfter, MAX_RETRY_DELAY_MS);
      }
    }
    const baseBackoffMs = opts.resilience?.baseBackoffMs ?? BASE_BACKOFF_MS;
    const maxBackoffMs = opts.resilience?.maxBackoffMs ?? MAX_RETRY_DELAY_MS;
    const [minJitter, maxJitter] = opts.resilience?.jitterFactorRange ?? [0.8, 1.2];
    const baseDelay = baseBackoffMs * 2 ** (attempt - 1);
    const jitterFactor = minJitter + Math.random() * (maxJitter - minJitter);
    return Math.min(baseDelay * jitterFactor, maxBackoffMs);
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

  private parseResetHeader(value?: string | null): Date | undefined {
    if (!value) return undefined;
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      if (numeric > Date.now()) {
        return new Date(numeric);
      }
      return new Date(Date.now() + numeric * 1000);
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed);
    }
    return undefined;
  }

  private extractRateLimit(headers?: Headers): RateLimitFeedback | undefined {
    if (!headers) return undefined;

    const headerNames = [
      'x-ratelimit-limit-requests',
      'x-ratelimit-remaining-requests',
      'x-ratelimit-reset-requests',
      'x-ratelimit-limit-tokens',
      'x-ratelimit-remaining-tokens',
      'x-ratelimit-reset-tokens',
      'retry-after',
    ];

    const raw: Record<string, string> = {};
    const feedback: RateLimitFeedback = {};

    const getNumber = (value?: string | null) => {
      if (value === null || value === undefined) return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    const maybeAssign = (key: keyof RateLimitFeedback, value?: number) => {
      if (value !== undefined) {
        feedback[key] = value as never;
      }
    };

    for (const name of headerNames) {
      const val = headers.get(name);
      if (val !== null && val !== undefined) {
        raw[name] = val;
      }
    }

    maybeAssign('limitRequests', getNumber(headers.get('x-ratelimit-limit-requests')));
    maybeAssign('remainingRequests', getNumber(headers.get('x-ratelimit-remaining-requests')));
    const resetRequestsAt = this.parseResetHeader(headers.get('x-ratelimit-reset-requests'));
    if (resetRequestsAt) {
      feedback.resetRequestsAt = resetRequestsAt;
    }

    maybeAssign('limitTokens', getNumber(headers.get('x-ratelimit-limit-tokens')));
    maybeAssign('remainingTokens', getNumber(headers.get('x-ratelimit-remaining-tokens')));
    const resetTokensAt = this.parseResetHeader(headers.get('x-ratelimit-reset-tokens'));
    if (resetTokensAt) {
      feedback.resetTokensAt = resetTokensAt;
    }

    const retryAfter = this.parseRetryAfterHeader(headers.get('retry-after'));
    if (retryAfter) {
      const date = new Date(Date.now() + retryAfter);
      feedback.resetRequestsAt = feedback.resetRequestsAt ?? date;
      feedback.resetTokensAt = feedback.resetTokensAt ?? date;
    }

    if (Object.keys(raw).length > 0) {
      feedback.rawHeaders = raw;
    }

    if (
      feedback.limitRequests !== undefined ||
      feedback.remainingRequests !== undefined ||
      feedback.resetRequestsAt !== undefined ||
      feedback.limitTokens !== undefined ||
      feedback.remainingTokens !== undefined ||
      feedback.resetTokensAt !== undefined ||
      feedback.rawHeaders
    ) {
      return feedback;
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

  private computeDeadline(opts: HttpRequestOptions, startedAt: number): number | undefined {
    const endToEndDeadline =
      opts.resilience?.maxEndToEndLatencyMs !== undefined
        ? startedAt + opts.resilience.maxEndToEndLatencyMs
        : undefined;
    const overallDeadline =
      opts.resilience?.overallTimeoutMs !== undefined ? startedAt + opts.resilience.overallTimeoutMs : undefined;
    // Legacy RequestBudget support (deprecated)
    const legacyBudget = opts.budget2;
    const budgetDeadline =
      legacyBudget?.maxTotalDurationMs !== undefined ? startedAt + legacyBudget.maxTotalDurationMs : undefined;

    const candidates = [endToEndDeadline, overallDeadline, budgetDeadline].filter(
      (value): value is number => value !== undefined,
    );
    if (!candidates.length) return undefined;
    return Math.min(...candidates);
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
    return statusToCategory(status);
  }
}

export class HttpError extends Error {
  status: number;
  body: unknown;
  headers?: Headers;
  category: ErrorCategory;
  fallback?: FallbackHint;
  response?: Response;
  correlation?: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;

  constructor(
    message: string,
    options: {
      status: number;
      body?: unknown;
      headers?: Headers;
      category: ErrorCategory;
      fallback?: FallbackHint;
      response?: Response;
      correlation?: CorrelationInfo;
      agentContext?: AgentContext;
      extensions?: Extensions;
    },
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = options.status;
    this.body = options.body;
    this.headers = options.headers;
    this.category = options.category;
    this.fallback = options.fallback;
    this.response = options.response;
    this.correlation = options.correlation;
    this.agentContext = options.agentContext;
    this.extensions = options.extensions;
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}