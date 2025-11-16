import { fetchTransport } from './transport/fetchTransport';
import type {
  AgentContext,
  BaseHttpClientConfig,
  BeforeSendContext,
  ClassifiedError,
  CorrelationInfo,
  ErrorCategory,
  ErrorClassifier,
  Extensions,
  FallbackHint,
  HttpHeaders,
  HttpRequestInterceptor,
  HttpRequestOptions,
  HttpTransport,
  Logger,
  MetricsRequestInfo,
  OperationDefaults,
  RateLimitFeedback,
  RateLimiterContext,
  RequestOutcome,
  ResponseClassification,
  ResilienceProfile,
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

class DefaultErrorClassifier implements ErrorClassifier {
  classifyNetworkError(error: unknown): ClassifiedError {
    if (error instanceof TimeoutError) {
      return { category: 'timeout', statusCode: 408, retryable: true, reason: 'timeout' };
    }

    if (error instanceof Error && error.name === 'AbortError') {
      return { category: 'canceled', retryable: false, reason: 'aborted' };
    }

    if (error instanceof HttpError) {
      return {
        category: error.category,
        statusCode: error.status,
        retryable: RETRYABLE_ERROR_CATEGORIES.has(error.category),
        suggestedBackoffMs: error.fallback?.retryAfterMs,
        reason: 'http_error',
      };
    }

    return { category: 'transient', retryable: true, reason: 'network_error' };
  }

  classifyResponse(response: Response, bodyText?: string): ClassifiedError {
    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
    const category = statusToCategory(response.status);
    return {
      category,
      statusCode: response.status,
      retryable: RETRYABLE_ERROR_CATEGORIES.has(category),
      suggestedBackoffMs: retryAfter,
      reason: bodyText ? 'http_response_with_body' : 'http_response',
    };
  }

  classify(ctx: { request: HttpRequestOptions; response?: Response; error?: unknown }): ClassifiedError {
    if (ctx.response) {
      return this.classifyResponse(ctx.response);
    }
    return this.classifyNetworkError(ctx.error);
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
    this.clientName = config.clientName;
    this.defaultTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.defaultMaxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.transport = config.transport ?? fetchTransport;
    this.logger = config.logger;
    this.interceptors = this.buildInterceptors(config);
  }

  private buildInterceptors(config: BaseHttpClientConfig): HttpRequestInterceptor[] {
    const interceptors = [...(config.interceptors ?? [])];
    if (config.beforeRequest || config.afterResponse) {
      interceptors.push({
        beforeSend: config.beforeRequest
          ? ({ request }: BeforeSendContext) => config.beforeRequest?.(request)
          : undefined,
        afterResponse: config.afterResponse
          ? ({ request, response }: { request: HttpRequestOptions; response: Response }) =>
              config.afterResponse?.(response, request)
          : undefined,
      });
    }
    return interceptors;
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
          const now = Date.now();
          await this.recordMetrics({
            clientName: this.clientName,
            operation: preparedOpts.operation,
            method: preparedOpts.method,
            url: this.safeBuildUrl(preparedOpts),
            durationMs: 0,
            status: 200,
            cacheHit: true,
            attempts: 0,
            correlation: this.getCorrelationInfo(preparedOpts),
            agentContext: preparedOpts.agentContext,
            extensions: preparedOpts.extensions,
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
        allowRetries: this.getIdempotent(preparedOpts),
      });
      span?.end();
      return response;
    } catch (error) {
      span?.recordException?.(error);
      span?.end();
      throw error;
    }
  }

  /**
   * Performs an HTTP request and resolves with the raw text body.
   *
   * This is a thin wrapper around {@link requestRaw}, so it inherits the same
   * retry, tracing, metrics, classification, and hook behaviour. Use it when an
   * endpoint returns plain text (CSV, NDJSON, etc.).
   */
  async requestText(opts: HttpRequestOptions): Promise<string> {
    const response = await this.requestRaw(opts);
    return response.text();
  }

  /**
   * Performs an HTTP request and resolves with an ArrayBuffer of the response
   * body.
   *
   * Like {@link requestText}, this method simply delegates to
   * {@link requestRaw} to ensure all resilience features apply consistently
   * before decoding the payload into binary form.
   */
  async requestArrayBuffer(opts: HttpRequestOptions): Promise<ArrayBuffer> {
    const response = await this.requestRaw(opts);
    return response.arrayBuffer();
  }

  private startSpan(opts: HttpRequestOptions) {
    const attributes: Record<string, string | number | boolean | null> = {
      client: this.clientName,
      operation: opts.operation,
      method: opts.method,
      path: opts.path,
      requestId: opts.requestId ?? opts.correlation?.requestId ?? null,
    };

    const correlation = opts.correlation;
    if (correlation?.correlationId ?? opts.correlationId) {
      attributes['correlation_id'] = correlation?.correlationId ?? opts.correlationId;
    }
    if (correlation?.parentCorrelationId ?? opts.parentCorrelationId) {
      attributes['parent_correlation_id'] = correlation?.parentCorrelationId ?? opts.parentCorrelationId;
    }

    const agentContext = opts.agentContext;
    if (agentContext?.agent) {
      attributes['agent.name'] = agentContext.agent;
    }
    if (agentContext?.runId) {
      attributes['agent.run_id'] = agentContext.runId;
    }
    if (agentContext?.labels) {
      for (const [key, value] of Object.entries(agentContext.labels)) {
        attributes[`agent.label.${key}`] = value;
      }
    }

    return this.config.tracing?.startSpan(`${this.clientName}.${opts.operation}`, {
      attributes,
      agentContext,
      extensions: opts.extensions,
    });
  }

  private async executeWithRetries<T>(opts: HttpRequestOptions, executeOptions: ExecuteOptions): Promise<T> {
    const startedAt = Date.now();
    const resilience = opts.resilience ?? {};
    const configuredAttempts =
      executeOptions.maxAttemptsOverride ??
      resilience.maxAttemptsOverride ??
      resilience.maxAttempts ??
      opts.budget?.maxAttempts ??
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
      const attemptStart = Date.now();
      try {
        const controller = new AbortController();
        attemptOpts = await this.prepareAttemptOptions(opts, controller.signal);
        lastAttemptOpts = attemptOpts;
        attemptContext = this.createRateLimiterContext(attemptOpts, attempt);
        const logMeta = { ...this.baseLogMeta(attemptOpts), attempt, maxAttempts };
        this.logger?.debug('http.request.attempt', logMeta);

        const resolvedUrl = this.buildUrl(attemptOpts);

        const executeAttempt = async () =>
          this.runAttempt({
            opts: attemptOpts as AttemptHttpRequestOptions,
            attemptContext: attemptContext as RateLimiterContext,
            rateLimitKey,
            deadline,
            parseJson: executeOptions.parseJson,
            controller,
            url: resolvedUrl,
          });

        const runner = this.config.policyWrapper
          ? () =>
              this.config.policyWrapper!(executeAttempt, {
                client: this.clientName,
                operation: attemptOpts.operation,
                requestId: attemptOpts.requestId,
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
        response = await this.applyAfterResponseInterceptors(attemptOpts, response, attempt);

        lastRateLimit = this.extractRateLimit(response.headers) ?? lastRateLimit;
        const finishedAt = Date.now();
        const aggregateOutcome: RequestOutcome = {
          ok: true,
          status: attemptResult.status,
          attempts: attempt,
          startedAt,
          finishedAt,
          rateLimitFeedback: lastRateLimit,
        };

        const parsedValue = await this.resolveResponseValue<T>(
          response,
          executeOptions.parseJson,
          attemptResult.bodyText,
        );
        await this.recordMetrics({
          clientName: this.clientName,
          operation: attemptOpts.operation,
          method: attemptOpts.method,
          url: attemptResult.url,
          durationMs: finishedAt - startedAt,
          status: attemptResult.status,
          attempts: attempt,
          rateLimitFeedback: lastRateLimit,
          correlation: this.getCorrelationInfo(attemptOpts),
          agentContext: attemptOpts.agentContext,
          extensions: attemptOpts.extensions,
          errorCategory: aggregateOutcome.errorCategory,
        });
        this.logger?.info('http.request.success', {
          ...logMeta,
          status: attemptResult.status,
          durationMs,
        });
        return parsedValue;
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
          const aggregateOutcome: RequestOutcome = {
            ok: false,
            status,
            errorCategory: category,
            attempts: attempt,
            startedAt,
            finishedAt,
            rateLimitFeedback: lastRateLimit,
          };
          await this.recordMetrics({
            clientName: this.clientName,
            operation: attemptOpts.operation ?? opts.operation,
            method: attemptOpts.method,
            url: resolvedUrl,
            durationMs: finishedAt - startedAt,
            status,
            attempts: attempt,
            errorCategory: category,
            agentContext: attemptOpts.agentContext,
            extensions: attemptOpts.extensions,
            rateLimitFeedback: lastRateLimit,
            correlation: this.getCorrelationInfo(attemptOpts),
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
    const aggregateOutcome: RequestOutcome = {
      ok: false,
      status,
      errorCategory: lastClassified?.category ?? (lastStatus === 408 ? 'timeout' : undefined),
      attempts: maxAttempts,
      startedAt,
      finishedAt,
      rateLimitFeedback: lastRateLimit,
    };
    const metricsOpts = lastAttemptOpts ?? opts;
    const url = this.safeBuildUrl(metricsOpts);
    await this.recordMetrics({
      clientName: this.clientName,
      operation: metricsOpts.operation ?? opts.operation,
      method: metricsOpts.method,
      url,
      durationMs: finishedAt - startedAt,
      status,
      attempts: maxAttempts,
      errorCategory: aggregateOutcome.errorCategory,
      agentContext: metricsOpts.agentContext,
      extensions: metricsOpts.extensions,
      rateLimitFeedback: lastRateLimit,
      correlation: this.getCorrelationInfo(metricsOpts),
    });

    if (lastStatus === 408 || (deadline !== undefined && Date.now() >= deadline)) {
      throw new TimeoutError('Request timed out');
    }

    throw lastError ?? new Error('Request failed');
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
          response,
          correlation: opts.correlation ?? {
            requestId: opts.requestId!,
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

  private normalizeCorrelation(opts: HttpRequestOptions) {
    const generated = this.generateRequestId();
    const correlation = opts.correlation ?? {};
    const requestId = opts.requestId ?? correlation.requestId ?? generated;
    return {
      requestId,
      correlationId: opts.correlationId ?? correlation.correlationId,
      parentCorrelationId: opts.parentCorrelationId ?? correlation.parentCorrelationId,
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
  ): Promise<AttemptHttpRequestOptions> {
    const cloned = this.cloneRequestOptions(opts);
    let attempt: AttemptHttpRequestOptions = {
      ...cloned,
      headers: this.buildHeaders(cloned.headers),
    };

    attempt = await this.applyBeforeSendInterceptors(attempt, signal);
    return attempt;
  }

  private getOperationDefaults(opts: HttpRequestOptions): OperationDefaults | undefined {
    return this.config.operationDefaults?.[opts.operation];
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
  ): Promise<AttemptHttpRequestOptions> {
    let current = opts;
    for (const interceptor of this.interceptors) {
      if (!interceptor.beforeSend) continue;
      const ctx: BeforeSendContext = { request: current, signal };
      try {
        const result = await interceptor.beforeSend(ctx as never);
        current = ctx.request as AttemptHttpRequestOptions;
        if (result && typeof result === 'object') {
          current = {
            ...current,
            ...(result as HttpRequestOptions),
            headers: this.buildHeaders((result as HttpRequestOptions).headers ?? current.headers),
            query: (result as HttpRequestOptions).query ?? current.query,
          };
        }
      } catch (error) {
        try {
          const fallback = await (interceptor.beforeSend as (opts: HttpRequestOptions) => unknown)(current);
          if (fallback && typeof fallback === 'object') {
            current = {
              ...current,
              ...(fallback as HttpRequestOptions),
              headers: this.buildHeaders((fallback as HttpRequestOptions).headers ?? current.headers),
              query: (fallback as HttpRequestOptions).query ?? current.query,
            };
          }
        } catch (hookError) {
          this.logger?.warn('http.interceptor.beforeSend.failed', {
            client: this.clientName,
            operation: opts.operation,
            error: hookError instanceof Error ? hookError.message : hookError,
          });
          throw hookError;
        }
      }
    }
    return current;
  }

  private async applyAfterResponseInterceptors(
    opts: HttpRequestOptions,
    response: Response,
    attempt: number,
  ): Promise<Response> {
    let current = response;
    for (const interceptor of [...this.interceptors].reverse()) {
      if (!interceptor.afterResponse) continue;
      const ctx = { request: opts, response: current, attempt };
      try {
        const result = await interceptor.afterResponse(ctx as never);
        current = (ctx as { response: Response }).response;
        if (result instanceof Response) {
          current = result;
        }
      } catch (error) {
        try {
          const legacyResult = await (interceptor.afterResponse as (opts: HttpRequestOptions, res: Response) => Response | void)(
            opts,
            current,
          );
          if (legacyResult instanceof Response) {
            current = legacyResult;
          }
        } catch (hookError) {
          this.logger?.warn('http.interceptor.afterResponse.failed', {
            client: this.clientName,
            operation: opts.operation,
            error: hookError instanceof Error ? hookError.message : hookError,
          });
          throw hookError;
        }
      }
    }
    return current;
  }

  private async runErrorInterceptors(opts: HttpRequestOptions, error: unknown, attempt: number): Promise<void> {
    for (const interceptor of [...this.interceptors].reverse()) {
      if (!interceptor.onError) continue;
      const ctx = { request: opts, error, attempt };
      try {
        await interceptor.onError(ctx as never);
      } catch (firstError) {
        try {
          await (interceptor.onError as (opts: HttpRequestOptions, err: unknown) => void)(opts, error);
        } catch (hookError) {
          this.logger?.warn('http.interceptor.onError.failed', {
            client: this.clientName,
            operation: opts.operation,
            error: hookError instanceof Error ? hookError.message : hookError,
          });
          throw firstError;
        }
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
      operation: opts.operation,
      attempt,
      requestId: opts.requestId,
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
      if (response && typeof classifier.classifyResponse === 'function') {
        return classifier.classifyResponse(response, undefined, { request, response, error });
      }
      if (typeof classifier.classifyNetworkError === 'function') {
        return classifier.classifyNetworkError(error, { request, response, error });
      }
      if (typeof classifier.classify === 'function') {
        return classifier.classify({ request, response, error });
      }
      return undefined;
    } catch (classifierError) {
      this.logger?.warn('http.classifier.error', {
        client: this.clientName,
        operation: request.operation,
        error: classifierError instanceof Error ? classifierError.message : classifierError,
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
    return (
      opts.correlation ?? {
        requestId: opts.requestId!,
        correlationId: opts.correlationId,
        parentCorrelationId: opts.parentCorrelationId,
      }
    );
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
      return classified.retryable;
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
    const budgetDeadline =
      opts.budget?.maxTotalDurationMs !== undefined ? startedAt + opts.budget.maxTotalDurationMs : undefined;

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

/**
 * Console logger implementation for use with createDefaultHttpClient.
 * Logs to console.debug, console.info, console.warn, and console.error.
 */
class ConsoleLogger implements Logger {
  debug(message: string, meta?: Record<string, unknown>): void {
    console.debug(message, meta);
  }
  info(message: string, meta?: Record<string, unknown>): void {
    console.info(message, meta);
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(message, meta);
  }
  error(message: string, meta?: Record<string, unknown>): void {
    console.error(message, meta);
  }
}

/**
 * Creates an HttpClient with sensible, zero-dependency defaults suitable for most use cases.
 *
 * Defaults applied:
 * - Transport: fetch-based (via fetchTransport)
 * - Base URL: none (must be provided per-request or via config.baseUrl)
 * - Resilience: 3 max attempts, 30s timeout, exponential backoff with jitter
 * - Logger: console logger
 * - Error classifier: default classifier (maps status codes to error categories)
 * - No external dependencies (no Redis, no OTEL, no rate limiters)
 *
 * @example
 * ```typescript
 * const client = createDefaultHttpClient({
 *   clientName: 'my-api',
 *   baseUrl: 'https://api.example.com',
 * });
 *
 * const data = await client.requestJson({
 *   method: 'GET',
 *   operation: 'getUser',
 *   urlParts: { path: '/users/123' },
 * });
 * ```
 *
 * @param config - Partial HttpClientConfig; all fields optional except clientName
 * @returns HttpClient instance with default configuration
 */
export function createDefaultHttpClient(
  config: Partial<BaseHttpClientConfig> & { clientName: string }
): HttpClient {
  const defaultConfig: BaseHttpClientConfig = {
    clientName: config.clientName,
    baseUrl: config.baseUrl,
    transport: config.transport ?? fetchTransport,
    defaultHeaders: config.defaultHeaders,
    defaultResilience: {
      maxAttempts: 3,
      retryEnabled: true,
      perAttemptTimeoutMs: 30_000,
      overallTimeoutMs: 90_000,
      baseBackoffMs: 250,
      maxBackoffMs: 60_000,
      jitterFactorRange: [0.8, 1.2],
      ...config.defaultResilience,
    },
    defaultAgentContext: config.defaultAgentContext,
    interceptors: config.interceptors ?? [],
    logger: config.logger ?? new ConsoleLogger(),
    metrics: config.metrics,
    tracing: config.tracing,
    resolveBaseUrl: config.resolveBaseUrl,
    cache: config.cache,
    rateLimiter: config.rateLimiter,
    circuitBreaker: config.circuitBreaker,
    beforeRequest: config.beforeRequest,
    afterResponse: config.afterResponse,
    responseClassifier: config.responseClassifier,
    errorClassifier: config.errorClassifier ?? new DefaultErrorClassifier(),
    policyWrapper: config.policyWrapper,
  };

  return new HttpClient(defaultConfig);
}
