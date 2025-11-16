import { fetchTransport } from './transport/fetchTransport';
import type {
  AfterResponseContext,
  ClassifiedError,
  ErrorCategory,
  ErrorClassifier,
  HttpClientConfig,
  HttpHeaders,
  HttpRequestInterceptor,
  HttpRequestOptions,
  HttpTransport,
  MetricsRequestInfo,
  RequestOutcome,
  ResponseClassification,
} from './types';
import {
  HttpError,
  TimeoutError,
  type AgentContext,
  type CorrelationInfo,
  type HttpMethod,
  type Logger,
  type MetricsSink,
  type ResilienceProfile,
} from './types';

const DEFAULT_RESILIENCE: ResilienceProfile = {
  maxAttempts: 1,
  retryEnabled: true,
};

const RETRYABLE_CATEGORIES: ErrorCategory[] = ['transient', 'rateLimit', 'timeout', 'unknown'];

export class HttpClient {
  private readonly baseUrl?: string;
  private readonly clientName: string;
  private readonly transport: HttpTransport;
  private readonly defaultHeaders?: HttpHeaders;
  private readonly interceptors: HttpRequestInterceptor[];
  private readonly logger?: Logger;
  private readonly metrics?: MetricsSink;
  private readonly defaultResilience: ResilienceProfile;
  private readonly defaultAgentContext?: AgentContext;
  private readonly responseClassifier?: (res: Response, bodyText?: string) => Promise<ResponseClassification | void>;
  private readonly errorClassifier: ErrorClassifier;

  constructor(private readonly config: HttpClientConfig) {
    this.baseUrl = config.baseUrl?.replace(/\/?$/, '');
    this.clientName = config.clientName;
    this.transport = config.transport ?? fetchTransport;
    this.defaultHeaders = config.defaultHeaders;
    this.interceptors = [...(config.interceptors ?? []), ...this.buildLegacyInterceptor(config)];
    this.logger = config.logger;
    this.metrics = config.metrics;
    this.defaultResilience = config.defaultResilience ?? DEFAULT_RESILIENCE;
    this.defaultAgentContext = config.defaultAgentContext;
    this.responseClassifier = config.responseClassifier;
    this.errorClassifier = config.errorClassifier ?? new DefaultErrorClassifier();
  }

  getClientName(): string {
    return this.clientName;
  }

  async requestJson<T>(opts: HttpRequestOptions): Promise<T> {
    const response = await this.requestRaw(opts);
    if (!response.ok) {
      throw this.toHttpError(response, opts);
    }
    return response.json() as Promise<T>;
  }

  async requestText(opts: HttpRequestOptions): Promise<string> {
    const response = await this.requestRaw(opts);
    if (!response.ok) {
      throw this.toHttpError(response, opts);
    }
    return response.text();
  }

  async requestArrayBuffer(opts: HttpRequestOptions): Promise<ArrayBuffer> {
    const response = await this.requestRaw(opts);
    if (!response.ok) {
      throw this.toHttpError(response, opts);
    }
    return response.arrayBuffer();
  }

  async requestRaw(opts: HttpRequestOptions): Promise<Response> {
    const prepared = this.prepareRequestOptions(opts);
    const startTime = Date.now();
    const resilience = this.mergeResilience(prepared.resilience);
    const maxAttempts = resilience.maxAttempts ?? DEFAULT_RESILIENCE.maxAttempts!;
    let attempt = 0;
    let lastError: unknown;
    let response: Response | undefined;
    const outcome: RequestOutcome = {
      ok: false,
      attempts: 0,
      startedAt: startTime,
      finishedAt: startTime,
      errorCategory: 'unknown',
    };

    while (attempt < (maxAttempts ?? 1)) {
      attempt += 1;
      const attemptOptions = { ...prepared, attempt };
      const attemptStart = Date.now();

      if (resilience.overallTimeoutMs && attemptStart - startTime >= resilience.overallTimeoutMs) {
        lastError = new TimeoutError('overall timeout exceeded');
        break;
      }

      const controller = new AbortController();
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      try {
        await this.runBeforeSend(attemptOptions, controller.signal);
        await this.config.rateLimiter?.throttle(this.buildRateLimiterKey(attemptOptions), this.buildRateLimiterContext(attemptOptions));
        await this.config.circuitBreaker?.beforeRequest(this.buildCircuitKey(attemptOptions));

        const transportPromise = this.transport(
          this.buildUrl(attemptOptions),
          this.buildRequestInit(attemptOptions, controller.signal),
        );
        const timedPromise =
          resilience.perAttemptTimeoutMs !== undefined
            ? Promise.race<Awaited<Response>>([
                transportPromise,
                new Promise<never>((_, reject) => {
                  timeoutHandle = setTimeout(() => {
                    reject(new TimeoutError('per-attempt timeout exceeded'));
                  }, resilience.perAttemptTimeoutMs);
                }),
              ])
            : transportPromise;

        response = await timedPromise;
        if (timeoutHandle) clearTimeout(timeoutHandle);

        await this.runAfterResponse({ request: attemptOptions, response, attempt });

        const classified = await this.classifyResponse(response);
        if (classified.treatAsError || !response.ok) {
          const retryable = this.shouldRetry(classified, attempt, resilience);
          if (!retryable) {
            outcome.ok = false;
            outcome.status = classified.overrideStatus ?? response.status;
            outcome.errorCategory = classified.category ?? 'unknown';
            lastError = this.toHttpError(response, attemptOptions, classified);
            break;
          }

          await this.config.rateLimiter?.onError?.(
            this.buildRateLimiterKey(attemptOptions),
            response,
            this.buildRateLimiterContext(attemptOptions),
          );
          await this.config.circuitBreaker?.onFailure(this.buildCircuitKey(attemptOptions), response);
          continue;
        }

        await this.config.rateLimiter?.onSuccess?.(
          this.buildRateLimiterKey(attemptOptions),
          this.buildRateLimiterContext(attemptOptions),
        );
        await this.config.circuitBreaker?.onSuccess(this.buildCircuitKey(attemptOptions));

        outcome.ok = true;
        outcome.status = response.status;
        outcome.errorCategory = 'none';
        outcome.attempts = attempt;
        outcome.finishedAt = Date.now();
        await this.recordMetrics(attemptOptions, outcome);
        return response;
      } catch (error) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        lastError = error;
        await this.runOnError({ request: attemptOptions, error, attempt });

        const classified = this.classifyNetworkError(error);
        const retryable = this.shouldRetry({ category: classified.category }, attempt, resilience);
        if (!retryable) {
          outcome.ok = false;
          outcome.errorCategory = classified.category;
          outcome.status = classified.statusCode;
          break;
        }
      }
    }

    outcome.attempts = attempt;
    outcome.finishedAt = Date.now();
    await this.recordMetrics(prepared, outcome);
    if (response) {
      throw lastError ?? this.toHttpError(response, prepared);
    }
    throw lastError ?? new Error('request failed');
  }

  private buildRequestInit(opts: HttpRequestOptions, signal: AbortSignal): RequestInit {
    const headers: HttpHeaders = {
      ...(this.defaultHeaders ?? {}),
      ...(opts.headers ?? {}),
    };

    if (opts.idempotencyKey) {
      headers['Idempotency-Key'] = opts.idempotencyKey;
    }

    return {
      method: opts.method,
      headers,
      body: opts.body,
      signal,
    } satisfies RequestInit;
  }

  private buildUrl(opts: HttpRequestOptions): string {
    if (opts.url) return opts.url;
    const base = opts.urlParts?.baseUrl ?? this.baseUrl ?? '';
    const rawPath = opts.urlParts?.path ?? '';
    const query = opts.urlParts?.query;
    const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    const combined = normalizedBase ? `${normalizedBase}${normalizedPath}` : normalizedPath;
    const url = normalizedBase ? new URL(combined) : new URL(combined, 'http://placeholder');
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return normalizedBase ? url.toString() : `${url.pathname}${url.search}`;
  }

  private buildRateLimiterKey(opts: HttpRequestOptions): string {
    return `${opts.method}:${opts.operation}`;
  }

  private buildCircuitKey(opts: HttpRequestOptions): string {
    return `${opts.method}:${opts.operation}`;
  }

  private prepareRequestOptions(opts: HttpRequestOptions): HttpRequestOptions {
    const correlation = this.ensureCorrelation(opts.correlation);
    const resilience = this.mergeResilience(opts.resilience);
    return {
      ...opts,
      correlation,
      resilience,
      agentContext: { ...this.defaultAgentContext, ...opts.agentContext },
    };
  }

  private ensureCorrelation(info?: CorrelationInfo): CorrelationInfo {
    return {
      requestId: info?.requestId ?? crypto.randomUUID(),
      correlationId: info?.correlationId,
      parentCorrelationId: info?.parentCorrelationId,
    };
  }

  private mergeResilience(override?: ResilienceProfile): ResilienceProfile {
    return {
      ...DEFAULT_RESILIENCE,
      ...this.defaultResilience,
      ...override,
    };
  }

  private async runBeforeSend(request: HttpRequestOptions, signal: AbortSignal) {
    for (const interceptor of this.interceptors) {
      await interceptor.beforeSend?.({ request, signal });
    }
  }

  private async runAfterResponse(ctx: AfterResponseContext) {
    for (const interceptor of [...this.interceptors].reverse()) {
      await interceptor.afterResponse?.(ctx);
    }
  }

  private async runOnError(ctx: { request: HttpRequestOptions; error: unknown; attempt: number }) {
    for (const interceptor of [...this.interceptors].reverse()) {
      await interceptor.onError?.(ctx);
    }
  }

  private classifyNetworkError(err: unknown): ClassifiedError {
    return this.errorClassifier.classifyNetworkError(err);
  }

  private async classifyResponse(response: Response): Promise<ResponseClassification> {
    const classification = await this.responseClassifier?.(response);
    if (classification) return classification;
    const base = this.errorClassifier.classifyResponse(response);
    return {
      treatAsError: !response.ok,
      category: base.category,
      overrideStatus: base.statusCode,
    };
  }

  private shouldRetry(classified: ResponseClassification | ClassifiedError, attempt: number, resilience: ResilienceProfile) {
    if (resilience.retryEnabled === false) return false;
    const category = 'category' in classified ? classified.category : 'unknown';
    const maxAttempts = resilience.maxAttempts ?? DEFAULT_RESILIENCE.maxAttempts ?? 1;
    if (attempt >= maxAttempts) return false;
    return RETRYABLE_CATEGORIES.includes(category as ErrorCategory);
  }

  private toHttpError(response: Response, opts: HttpRequestOptions, classification?: ResponseClassification): HttpError {
    const status = classification?.overrideStatus ?? response.status;
    const category = classification?.category ?? this.errorClassifier.classifyResponse(response).category;
    return new HttpError(`HTTP ${status} for ${opts.operation}`, {
      status,
      category,
      requestId: opts.correlation?.requestId,
      correlationId: opts.correlation?.correlationId,
      parentCorrelationId: opts.correlation?.parentCorrelationId,
    });
  }

  private async recordMetrics(opts: HttpRequestOptions, outcome: RequestOutcome) {
    if (!this.metrics?.recordRequest) return;
    const info: MetricsRequestInfo = {
      clientName: this.clientName,
      operation: opts.operation,
      method: opts.method,
      url: opts.url ?? this.buildUrl(opts),
      status: outcome.status,
      errorCategory: outcome.errorCategory,
      durationMs: outcome.finishedAt - outcome.startedAt,
      attempts: outcome.attempts,
      requestId: opts.correlation?.requestId,
      correlationId: opts.correlation?.correlationId,
      parentCorrelationId: opts.correlation?.parentCorrelationId,
      agentContext: opts.agentContext,
      extensions: opts.extensions,
    };
    await this.metrics.recordRequest(info);
  }

  private buildLegacyInterceptor(config: HttpClientConfig): HttpRequestInterceptor[] {
    if (!config.beforeRequest && !config.afterResponse) return [];
    return [
      {
        beforeSend: async ({ request }) => {
          await config.beforeRequest?.(request);
        },
        afterResponse: async ({ request, response }) => {
          await config.afterResponse?.(request, response);
        },
      },
    ];
  }
}

class DefaultErrorClassifier implements ErrorClassifier {
  classifyNetworkError(err: unknown): ClassifiedError {
    if (err instanceof TimeoutError) {
      return { category: 'timeout', retryable: true, reason: err.message };
    }
    if (err instanceof Error && err.name === 'AbortError') {
      return { category: 'canceled', retryable: false, reason: err.message };
    }
    return { category: 'transient', retryable: true };
  }

  classifyResponse(response: Response): ClassifiedError {
    const status = response.status;
    if (status >= 500) return { category: 'transient', statusCode: status, retryable: true };
    if (status === 429) return { category: 'rateLimit', statusCode: status, retryable: true };
    if (status === 401 || status === 403) return { category: 'auth', statusCode: status, retryable: false };
    if (status === 400 || status === 404 || status === 422) return { category: 'validation', statusCode: status };
    return { category: 'unknown', statusCode: status };
  }
}
