// ============================================================================
// Core Types – Resilient HTTP v0.8.0
// ============================================================================

// ----------------------------------------------------------------------------
// Basic HTTP Types
// ----------------------------------------------------------------------------

export type HttpMethod =
  | 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

export type HttpHeaders = Record<string, string>;

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface UrlParts {
  baseUrl?: string;   // e.g. "https://api.example.com"
  path?: string;      // e.g. "/v1/items"
  query?: QueryParams;
}

// ----------------------------------------------------------------------------
// Correlation, AgentContext, Extensions
// ----------------------------------------------------------------------------

export interface CorrelationInfo {
  requestId?: string;
  correlationId?: string;
  parentCorrelationId?: string;
}

export type RequestClass = 'interactive' | 'background' | 'batch';

export interface AgentContext {
  agentName?: string;
  agentVersion?: string;
  tenantId?: string;
  requestClass?: RequestClass;
  sessionId?: string;
  userId?: string;
}

export type Extensions = Record<string, unknown>;

// ----------------------------------------------------------------------------
// Budget Hints (shared by core, policies, conversation)
// ----------------------------------------------------------------------------

export interface BudgetHints {
  /** Maximum tokens to consume (input + output) for this logical request. */
  maxTokens?: number;

  /** Approximate per-token cost and budget limit, for policies/metrics. */
  tokenCostCents?: number;
  maxCostCents?: number;

  /** Maximum requests allowed in a group (e.g., for bulk operations). */
  maxRequests?: number;

  /** Arbitrary numeric hints for policy/agent decisions. */
  attributes?: Record<string, number>;
}

// ----------------------------------------------------------------------------
// Resilience Profile
// ----------------------------------------------------------------------------

export interface ResilienceProfile {
  maxAttempts?: number;          // Default: 3
  retryEnabled?: boolean;        // Default: true

  perAttemptTimeoutMs?: number;  // Default: undefined (no per-attempt limit)
  overallTimeoutMs?: number;     // Default: 30_000

  baseBackoffMs?: number;        // Default: 200
  maxBackoffMs?: number;         // Default: 2_000
  jitterFactor?: number;         // Default: 0.2 (20% jitter)

  retryIdempotentMethodsByDefault?: boolean;  // Default: true
  maxSuggestedRetryDelayMs?: number;          // Default: 60_000
}

// ----------------------------------------------------------------------------
// Error Model & Classification
// ----------------------------------------------------------------------------

export type ErrorCategory =
  | 'auth'
  | 'validation'
  | 'quota'
  | 'rate_limit'
  | 'timeout'
  | 'transient'
  | 'network'
  | 'canceled'
  | 'none'
  | 'unknown';

export interface FallbackHint {
  retryAfterMs?: number;
  retryable?: boolean;
  hint?: string;
}

export interface ClassifiedError {
  category: ErrorCategory;
  statusCode?: number;
  reason?: string;
  fallback?: FallbackHint;
}

export interface ErrorClassifierContext {
  method: HttpMethod;
  url: string;
  attempt: number;
  request: HttpRequestOptions;
  response?: RawHttpResponse;
  error?: unknown;
}

export interface ErrorClassifier {
  classify(ctx: ErrorClassifierContext): ClassifiedError;
}

// ----------------------------------------------------------------------------
// HTTP Errors
// ----------------------------------------------------------------------------

export class HttpError extends Error {
  readonly category: ErrorCategory;
  readonly statusCode?: number;
  readonly url: string;
  readonly method: HttpMethod;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly operation?: string;
  readonly attemptCount: number;
  readonly outcome?: RequestOutcome;

  constructor(message: string, options: {
    category: ErrorCategory;
    statusCode?: number;
    url: string;
    method: HttpMethod;
    requestId?: string;
    correlationId?: string;
    operation?: string;
    attemptCount: number;
    outcome?: RequestOutcome;
    cause?: unknown;
  }) {
    super(message, { cause: options.cause });
    this.name = 'HttpError';
    this.category = options.category;
    this.statusCode = options.statusCode;
    this.url = options.url;
    this.method = options.method;
    this.requestId = options.requestId;
    this.correlationId = options.correlationId;
    this.operation = options.operation;
    this.attemptCount = options.attemptCount;
    this.outcome = options.outcome;
  }
}

export class TimeoutError extends HttpError {
  constructor(message: string, options: {
    url: string;
    method: HttpMethod;
    requestId?: string;
    correlationId?: string;
    operation?: string;
    attemptCount: number;
    outcome?: RequestOutcome;
  }) {
    super(message, {
      ...options,
      category: 'timeout',
      statusCode: 408,
    });
    this.name = 'TimeoutError';
  }
}

// ----------------------------------------------------------------------------
// Transport Abstraction
// ----------------------------------------------------------------------------

export interface RawHttpResponse {
  status: number;
  headers: HttpHeaders;
  body: ArrayBuffer;
}

export interface TransportRequest {
  method: HttpMethod;
  url: string;
  headers: HttpHeaders;
  body?: ArrayBuffer;
}

export interface HttpTransport {
  (req: TransportRequest, signal: AbortSignal): Promise<RawHttpResponse>;
}

// ----------------------------------------------------------------------------
// Request & Response
// ----------------------------------------------------------------------------

export interface HttpRequestOptions {
  method: HttpMethod;

  url?: string;
  urlParts?: UrlParts;  // exactly one of url or urlParts must be provided

  headers?: HttpHeaders;
  query?: QueryParams;

  body?: unknown;       // encoded by body serialization interceptor

  operation?: string;

  correlation?: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;

  resilience?: ResilienceProfile;
  budget?: BudgetHints;

  cacheMode?: 'default' | 'bypass' | 'refresh';
  cacheKey?: string;

  /** Optional idempotency key; recommended for POST/PUT/PATCH. */
  idempotencyKey?: string;
}

export interface RateLimitFeedback {
  remainingRequests?: number;
  limitRequests?: number;
  resetAt?: Date;

  remainingTokens?: number;
  limitTokens?: number;
  tokenResetAt?: Date;

  raw?: Record<string, string>;
}

export interface RequestOutcome {
  ok: boolean;
  status?: number;
  category: ErrorCategory;
  attempts: number;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  statusFamily?: number;
  errorMessage?: string;
  rateLimit?: RateLimitFeedback;
}

export interface HttpResponse<TBody = unknown> {
  status: number;
  headers: HttpHeaders;
  body: TBody;
  outcome: RequestOutcome;
}

// ----------------------------------------------------------------------------
// Interceptors
// ----------------------------------------------------------------------------

export interface BeforeSendContext {
  request: HttpRequestOptions;
  attempt: number;
  signal: AbortSignal;
}

export interface AfterResponseContext<TBody = unknown> {
  request: HttpRequestOptions;
  attempt: number;
  response: HttpResponse<TBody>;
}

export interface OnErrorContext {
  request: HttpRequestOptions;
  attempt: number;
  error: HttpError | Error;
}

export interface HttpRequestInterceptor {
  beforeSend?(ctx: BeforeSendContext): Promise<void> | void;

  afterResponse?<TBody = unknown>(
    ctx: AfterResponseContext<TBody>
  ): Promise<void> | void;

  onError?(ctx: OnErrorContext): Promise<void> | void;
}

// ----------------------------------------------------------------------------
// Caching
// ----------------------------------------------------------------------------

export interface HttpCacheEntry<T = unknown> {
  value: T;
  expiresAt: number; // epoch millis
}

export interface HttpCache {
  get<T = unknown>(key: string): Promise<HttpCacheEntry<T> | undefined>;
  set<T = unknown>(key: string, entry: HttpCacheEntry<T>): Promise<void>;
  delete?(key: string): Promise<void>;
}

// ----------------------------------------------------------------------------
// Metrics & Tracing
// ----------------------------------------------------------------------------

export interface MetricsRequestInfo {
  operation?: string;
  method: HttpMethod;
  url: string;
  correlation?: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;
  outcome: RequestOutcome;
}

export interface MetricsSink {
  recordRequest(info: MetricsRequestInfo): void | Promise<void>;
}

export interface TracingSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  recordException(error: Error): void;
}

export interface TracingAdapter {
  startSpan(info: MetricsRequestInfo): TracingSpan | undefined;
  endSpan(span: TracingSpan, outcome: RequestOutcome): void | Promise<void>;
}

// ----------------------------------------------------------------------------
// HttpClient Config
// ----------------------------------------------------------------------------

export interface HttpClientConfig {
  baseUrl?: string;
  transport?: HttpTransport;
  defaultHeaders?: HttpHeaders;
  defaultExtensions?: Extensions;
  defaultResilience?: ResilienceProfile;
  cache?: HttpCache;
  metricsSink?: MetricsSink;
  tracingAdapter?: TracingAdapter;
  interceptors?: HttpRequestInterceptor[];
  errorClassifier?: ErrorClassifier;
}

// ----------------------------------------------------------------------------
// Legacy Types (deprecated, for backwards compatibility during migration)
// ----------------------------------------------------------------------------

/**
 * @deprecated Use BudgetHints instead
 */
export interface RequestBudget {
  maxAttempts?: number;
  maxTotalDurationMs?: number;
}

/**
 * @deprecated Legacy logger interface. Use interceptors for logging instead.
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
