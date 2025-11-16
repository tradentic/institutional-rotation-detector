import {
  type AgentContext,
  type BeforeSendContext,
  type ClassifiedError,
  type CorrelationInfo,
  type DefaultHttpClientConfig,
  type ErrorCategory,
  type ErrorClassifier,
  type ErrorContext,
  type Extensions,
  type HttpClient,
  type HttpClientConfig,
  type HttpHeaders,
  type HttpMethod,
  type HttpRequestInterceptor,
  type HttpRequestOptions,
  type HttpTransport,
  type Logger,
  type MetricsRequestInfo,
  type MetricsSink,
  type RateLimitFeedback,
  type RequestOutcome,
  type ResilienceProfile,
  type Span,
  type TracingAdapter,
} from './types';

const DEFAULT_PER_ATTEMPT_TIMEOUT_MS = 10_000;
const DEFAULT_OVERALL_TIMEOUT_MS = 25_000;

const IDEMPOTENT_METHODS: HttpMethod[] = ['GET', 'HEAD', 'OPTIONS'];

export class DefaultError extends Error {
  constructor(
    message: string,
    public readonly category: ErrorCategory,
    public readonly status?: number,
    public readonly response?: Response,
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

export class DefaultErrorClassifier implements ErrorClassifier {
  classifyNetworkError(err: unknown): ClassifiedError {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { category: 'canceled', retryable: false };
    }
    return { category: 'transient', retryable: true };
  }

  classifyResponse(response: Response): ClassifiedError {
    const status = response.status;
    if (status >= 500) return { category: 'transient', statusCode: status, retryable: true };
    if (status === 429) return { category: 'rateLimit', statusCode: status, retryable: true };
    if (status === 401 || status === 403)
      return { category: 'auth', statusCode: status, retryable: false };
    if (status >= 400)
      return { category: 'validation', statusCode: status, retryable: false };
    return { category: 'none', statusCode: status, retryable: false };
  }
}

export class SimpleLogger implements Logger {
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void {
    const payload = meta ? `${message} ${JSON.stringify(meta)}` : message;
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](payload);
  }
}

export class DefaultHttpClient implements HttpClient {
  private readonly clientName: string;
  private readonly baseUrl?: string;
  private readonly transport: HttpTransport;
  private readonly logger?: Logger;
  private readonly metrics?: MetricsSink;
  private readonly tracing?: TracingAdapter;
  private readonly interceptors: HttpRequestInterceptor[];
  private readonly defaultHeaders?: HttpHeaders;
  private readonly defaultResilience?: ResilienceProfile;
  private readonly defaultAgentContext?: AgentContext;
  private readonly classifier: ErrorClassifier;

  constructor(private readonly config: HttpClientConfig) {
    this.clientName = config.clientName;
    this.baseUrl = config.baseUrl;
    this.transport = config.transport;
    this.logger = config.logger;
    this.metrics = config.metrics;
    this.tracing = config.tracing;
    this.interceptors = config.interceptors ?? [];
    this.defaultHeaders = config.defaultHeaders;
    this.defaultResilience = config.defaultResilience;
    this.defaultAgentContext = config.defaultAgentContext;
    this.classifier = config.errorClassifier ?? new DefaultErrorClassifier();
  }

  async requestRaw(options: HttpRequestOptions): Promise<Response> {
    const prepared = this.prepareOptions(options);
    const outcome = await this.execute(prepared, async (response) => response);
    return outcome;
  }

  async requestJson<T = unknown>(options: HttpRequestOptions): Promise<T> {
    const prepared = this.prepareOptions(options);
    const response = await this.execute(prepared, async (res) => {
      if (!res.ok) {
        throw new DefaultError(`HTTP ${res.status}`, 'unknown', res.status, res);
      }
      return res.json() as Promise<T>;
    });
    return response as T;
  }

  async requestText(options: HttpRequestOptions): Promise<string> {
    const prepared = this.prepareOptions(options);
    const response = await this.execute(prepared, async (res) => {
      if (!res.ok) {
        throw new DefaultError(`HTTP ${res.status}`, 'unknown', res.status, res);
      }
      return res.text();
    });
    return response as string;
  }

  async requestArrayBuffer(options: HttpRequestOptions): Promise<ArrayBuffer> {
    const prepared = this.prepareOptions(options);
    const response = await this.execute(prepared, async (res) => {
      if (!res.ok) {
        throw new DefaultError(`HTTP ${res.status}`, 'unknown', res.status, res);
      }
      return res.arrayBuffer();
    });
    return response as ArrayBuffer;
  }

  private prepareOptions(options: HttpRequestOptions): HttpRequestOptions {
    const mergedHeaders = { ...(this.defaultHeaders ?? {}), ...(options.headers ?? {}) };
    const correlation: CorrelationInfo = {
      ...options.correlation,
      requestId: options.correlation?.requestId ?? this.generateRequestId(),
    };
    const resilience = { ...this.defaultResilience, ...options.resilience };
    const agentContext = { ...this.defaultAgentContext, ...options.agentContext };
    return { ...options, headers: mergedHeaders, correlation, resilience, agentContext };
  }

  private async execute<T>(options: HttpRequestOptions, onSuccess: (response: Response) => Promise<T>): Promise<T> {
    const startedAt = new Date();
    const maxAttempts = this.resolveMaxAttempts(options);
    const overallDeadline = this.computeOverallDeadline(options, startedAt);
    const url = this.resolveUrl(options);
    const span = this.tracing?.startRequestSpan({
      clientName: this.clientName,
      operation: options.operation,
      method: options.method,
      url,
      correlation: options.correlation,
      agentContext: options.agentContext,
      extensions: options.extensions,
    });

    await this.config.circuitBreaker?.beforeRequest({
      clientName: this.clientName,
      operation: options.operation,
    });

    let attempt = 0;
    let lastError: unknown;
    let rateLimitFeedback: RateLimitFeedback | undefined;
    while (attempt < maxAttempts) {
      attempt += 1;
      const attemptOptions: HttpRequestOptions = { ...options, attempt };
      const perAttemptSignal = this.createAbortSignal(attemptOptions, overallDeadline);
      const requestContext: BeforeSendContext = { request: attemptOptions, signal: perAttemptSignal };
      await this.runBeforeSendInterceptors(requestContext);
      let response: Response;
      try {
        await this.config.rateLimiter?.acquire({
          clientName: this.clientName,
          operation: attemptOptions.operation,
          method: attemptOptions.method,
          extensions: attemptOptions.extensions,
        });
        response = await this.transport(url, {
          method: attemptOptions.method,
          headers: attemptOptions.headers,
          body: attemptOptions.body ?? undefined,
          signal: perAttemptSignal,
        });
      } catch (error) {
        lastError = error;
        await this.runOnErrorInterceptors(attemptOptions, error, attempt);
        if (!this.shouldRetryNetwork(error, attemptOptions, attempt, maxAttempts, overallDeadline)) {
          span?.setAttribute('error', true);
          span?.setAttribute('error.message', error instanceof Error ? error.message : String(error));
          const outcome = this.buildOutcome(false, attempt, startedAt, new Date(), undefined, error);
          await this.finalize(outcome, attemptOptions, url, rateLimitFeedback, span);
          throw error;
        }
        continue;
      }

      const classification = this.classifier.classifyResponse(response);
      rateLimitFeedback = this.extractRateLimit(response, classification);
      const shouldTreatAsError = !response.ok;
      if (shouldTreatAsError) {
        const error = new DefaultError(`HTTP ${response.status}`, classification.category, response.status, response);
        lastError = error;
        await this.runAfterResponseInterceptors(attemptOptions, response, attempt);
        await this.runOnErrorInterceptors(attemptOptions, error, attempt);
        if (!this.shouldRetryClassification(classification, attemptOptions, attempt, maxAttempts, overallDeadline)) {
          const outcome = this.buildOutcome(
            false,
            attempt,
            startedAt,
            new Date(),
            rateLimitFeedback,
            error,
            classification.category,
            response.status,
          );
          await this.finalize(outcome, attemptOptions, url, rateLimitFeedback, span);
          throw error;
        }
        continue;
      }

      await this.runAfterResponseInterceptors(attemptOptions, response, attempt);
      const parsed = await onSuccess(response);
      const finishedAt = new Date();
      const outcome = this.buildOutcome(true, attempt, startedAt, finishedAt, rateLimitFeedback, undefined, 'none', response.status);
      await this.finalize(outcome, attemptOptions, url, rateLimitFeedback, span);
      return parsed;
    }

    span?.end();
    throw lastError ?? new Error('Request failed');
  }

  private resolveMaxAttempts(options: HttpRequestOptions): number {
    const profile = options.resilience;
    const configured = profile?.maxAttempts ?? this.defaultResilience?.maxAttempts;
    if (configured !== undefined) return configured;
    if (this.isIdempotent(options)) return 3;
    return 1;
  }

  private computeOverallDeadline(options: HttpRequestOptions, startedAt: Date): number | undefined {
    const profile = { ...this.defaultResilience, ...options.resilience };
    const overall = profile.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS;
    return overall ? startedAt.getTime() + overall : undefined;
  }

  private createAbortSignal(options: HttpRequestOptions, overallDeadline?: number): AbortSignal {
    const controller = new AbortController();
    const perAttemptTimeout = this.resolvePerAttemptTimeout(options, overallDeadline);
    if (perAttemptTimeout !== undefined) {
      setTimeout(() => controller.abort(), perAttemptTimeout).unref?.();
    }
    return controller.signal;
  }

  private resolvePerAttemptTimeout(options: HttpRequestOptions, overallDeadline?: number): number | undefined {
    const profile = { ...this.defaultResilience, ...options.resilience };
    const perAttempt = profile.perAttemptTimeoutMs ?? DEFAULT_PER_ATTEMPT_TIMEOUT_MS;
    if (overallDeadline === undefined) return perAttempt;
    const remaining = overallDeadline - Date.now();
    return Math.max(0, Math.min(perAttempt, remaining));
  }

  private shouldRetryNetwork(
    error: unknown,
    options: HttpRequestOptions,
    attempt: number,
    maxAttempts: number,
    overallDeadline?: number,
  ): boolean {
    if (attempt >= maxAttempts) return false;
    const classification = this.classifier.classifyNetworkError(error);
    if (classification.retryable === false) return false;
    if (!this.isIdempotent(options)) return false;
    if (overallDeadline && Date.now() >= overallDeadline) return false;
    return true;
  }

  private shouldRetryClassification(
    classification: ClassifiedError,
    options: HttpRequestOptions,
    attempt: number,
    maxAttempts: number,
    overallDeadline?: number,
  ): boolean {
    if (attempt >= maxAttempts) return false;
    const retryEnabled = options.resilience?.retryEnabled ?? this.defaultResilience?.retryEnabled;
    if (retryEnabled === false) return false;
    if (!this.isIdempotent(options)) return false;
    const retryable = classification.retryable ?? ['transient', 'rateLimit', 'timeout'].includes(classification.category);
    if (!retryable) return false;
    if (overallDeadline && Date.now() >= overallDeadline) return false;
    return true;
  }

  private async runBeforeSendInterceptors(ctx: BeforeSendContext): Promise<void> {
    for (const interceptor of this.interceptors) {
      if (interceptor.beforeSend) {
        await interceptor.beforeSend(ctx);
      }
    }
  }

  private async runAfterResponseInterceptors(options: HttpRequestOptions, response: Response, attempt: number): Promise<void> {
    const ctx = { request: options, response, attempt };
    for (let i = this.interceptors.length - 1; i >= 0; i -= 1) {
      await this.interceptors[i].afterResponse?.(ctx);
    }
  }

  private async runOnErrorInterceptors(options: HttpRequestOptions, error: unknown, attempt: number): Promise<void> {
    const ctx: ErrorContext = { request: options, error, attempt };
    for (let i = this.interceptors.length - 1; i >= 0; i -= 1) {
      await this.interceptors[i].onError?.(ctx);
    }
  }

  private isIdempotent(options: HttpRequestOptions): boolean {
    if (options.idempotent !== undefined) return options.idempotent;
    return IDEMPOTENT_METHODS.includes(options.method);
  }

  private resolveUrl(options: HttpRequestOptions): string {
    if (options.url) return options.url;
    const base = options.urlParts?.baseUrl ?? this.baseUrl;
    const path = options.urlParts?.path ?? '';
    if (!base) {
      throw new Error('No baseUrl provided');
    }
    const normalized = base.endsWith('/') ? base.slice(0, -1) : base;
    const finalPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${normalized}${finalPath}`);
    const queryParams = options.urlParts?.query ?? {};
    for (const [key, value] of Object.entries(queryParams)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private buildOutcome(
    ok: boolean,
    attempts: number,
    startedAt: Date,
    finishedAt: Date,
    rateLimitFeedback?: RateLimitFeedback,
    error?: unknown,
    errorCategory?: ErrorCategory,
    status?: number,
  ): RequestOutcome {
    let category: ErrorCategory = errorCategory ?? 'none';
    if (!ok && category === 'none') {
      category = error instanceof DefaultError ? error.category : 'unknown';
    }
    return { ok, attempts, startedAt, finishedAt, status, rateLimitFeedback, errorCategory: category };
  }

  private extractRateLimit(response: Response, classification?: ClassifiedError): RateLimitFeedback | undefined {
    const isRateLimited = classification?.category === 'rateLimit' || response.status === 429;
    const resetHeader = response.headers.get('retry-after');
    const limit = response.headers.get('x-ratelimit-limit');
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (!isRateLimited && !resetHeader && !limit && !remaining) return undefined;
    const feedback: RateLimitFeedback = { isRateLimited };
    if (resetHeader) {
      const parsed = Number(resetHeader);
      const resetAt = Number.isFinite(parsed)
        ? new Date(Date.now() + parsed * 1000)
        : new Date(resetHeader);
      if (!Number.isNaN(resetAt.getTime())) feedback.resetAt = resetAt;
    }
    if (limit !== null && limit !== undefined) {
      const parsedLimit = Number(limit);
      if (Number.isFinite(parsedLimit)) feedback.limit = parsedLimit;
    }
    if (remaining !== null && remaining !== undefined) {
      const parsedRemaining = Number(remaining);
      if (Number.isFinite(parsedRemaining)) feedback.remaining = parsedRemaining;
    }
    return feedback;
  }

  private async recordTelemetry(
    options: HttpRequestOptions,
    url: string,
    outcome: RequestOutcome,
    rateLimitFeedback?: RateLimitFeedback,
  ): Promise<void> {
    const durationMs = outcome.finishedAt.getTime() - outcome.startedAt.getTime();
    const info: MetricsRequestInfo = {
      clientName: this.clientName,
      operation: options.operation,
      method: options.method,
      url,
      status: outcome.status,
      errorCategory: outcome.errorCategory,
      durationMs,
      attempts: outcome.attempts,
      rateLimitFeedback,
      agentContext: options.agentContext,
      extensions: options.extensions,
      correlation: options.correlation,
      outcome,
    };
    try {
      this.metrics?.recordRequest(info);
    } catch (error) {
      this.logger?.log('warn', 'metrics.recordRequest failed', { error });
    }
    if (outcome.ok) {
      this.logger?.log('info', 'http.request.success', { url, status: outcome.status, attempts: outcome.attempts });
    } else {
      this.logger?.log('error', 'http.request.failed', {
        url,
        status: outcome.status,
        attempts: outcome.attempts,
        errorCategory: outcome.errorCategory,
      });
    }
  }

  private async finalize(
    outcome: RequestOutcome,
    options: HttpRequestOptions,
    url: string,
    rateLimitFeedback: RateLimitFeedback | undefined,
    span: Span | null | undefined,
  ): Promise<void> {
    if (span) {
      if (outcome.status !== undefined) {
        span.setAttribute('http.status_code', outcome.status);
      }
      if (!outcome.ok) {
        span.setAttribute('error', true);
      }
    }
    await this.recordTelemetry(options, url, outcome, rateLimitFeedback);
    await this.config.circuitBreaker?.afterRequest(
      { clientName: this.clientName, operation: options.operation },
      outcome,
    );
    span?.end();
  }

  private generateRequestId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return (crypto as Crypto).randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function createDefaultHttpClient(config: DefaultHttpClientConfig): HttpClient {
  const logger = config.logger ?? new SimpleLogger();
  const transport: HttpTransport = (url, init) => fetch(url, init);
  const defaultResilience: ResilienceProfile = {
    maxAttempts: undefined,
    perAttemptTimeoutMs: DEFAULT_PER_ATTEMPT_TIMEOUT_MS,
    overallTimeoutMs: DEFAULT_OVERALL_TIMEOUT_MS,
  };
  const classifier = new DefaultErrorClassifier();
  const httpClient = new DefaultHttpClient({
    clientName: config.clientName,
    baseUrl: config.baseUrl,
    logger,
    transport,
    defaultResilience,
    errorClassifier: classifier,
  });
  return httpClient;
}
