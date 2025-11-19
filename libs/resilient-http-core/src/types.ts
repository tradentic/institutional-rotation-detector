/**
 * v0.8 HttpCache interface with entry-based storage.
 * Cache entries include expiration timestamps for TTL management.
 */
export interface HttpCacheEntry<T = unknown> {
  value: T;
  expiresAt: number; // epoch millis
}

export interface HttpCache {
  get<T = unknown>(key: string): Promise<HttpCacheEntry<T> | undefined>;
  set<T = unknown>(key: string, entry: HttpCacheEntry<T>): Promise<void>;
  delete?(key: string): Promise<void>;
}

export type HttpMethod = 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type HttpHeaders = Record<string, string>;

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface UrlParts {
  baseUrl?: string;   // e.g. "https://api.example.com"
  path?: string;      // e.g. "/v1/items"
  query?: QueryParams;
}

export interface CorrelationInfo {
  requestId?: string;
  correlationId?: string;
  parentCorrelationId?: string;
}

export type RequestClass = "interactive" | "background" | "batch";

export interface AgentContext {
  agentName?: string;
  agentVersion?: string;
  tenantId?: string;
  requestClass?: RequestClass;
  sessionId?: string;
  userId?: string;

  /**
   * @deprecated Legacy v0.7 field. Use agentName instead.
   */
  agent?: string;
  /**
   * @deprecated Legacy v0.7 field. Use sessionId instead.
   */
  runId?: string;
  /**
   * @deprecated Legacy v0.7 field. Use extensions or custom fields instead.
   */
  labels?: Record<string, string>;
  /**
   * @deprecated Legacy v0.7 field. Use extensions or custom fields instead.
   */
  metadata?: Record<string, unknown>;
}

export type Extensions = Record<string, unknown>;

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

  /**
   * @deprecated Legacy v0.7 field. Use jitterFactor instead.
   */
  jitterFactorRange?: [number, number];
  /**
   * @deprecated Legacy v0.7 field. Use overallTimeoutMs instead.
   */
  maxEndToEndLatencyMs?: number;
  /**
   * @deprecated Legacy field from pre-v0.7. Use policy-based prioritization via @airnub/resilient-http-policies instead.
   */
  priority?: 'low' | 'normal' | 'high' | 'critical';
  /**
   * @deprecated Legacy field from pre-v0.7. Use maxAttempts directly.
   */
  maxAttemptsOverride?: number;
  /**
   * @deprecated Legacy field from pre-v0.7. Use retryEnabled: false or maxAttempts: 1 instead.
   */
  failFast?: boolean;
  /**
   * @deprecated Legacy field from pre-v0.7. Failover logic should be implemented via custom interceptors.
   */
  allowFailover?: boolean;
}

/**
 * v0.8 budget hints for token and cost tracking.
 * Shared structure used by core, policies, and conversation engines.
 */
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

/**
 * @deprecated Legacy v0.7 type. Use BudgetHints instead.
 */
export interface RequestBudget {
  maxAttempts?: number;
  maxTotalDurationMs?: number;
}

export type HttpRequestBudget = RequestBudget;

export interface RateLimiterContext {
  method: string;
  path: string;
  operation: string;
  attempt: number;
  requestId?: string;
  correlationId?: string;
  parentCorrelationId?: string;
  agentContext?: AgentContext;
  extensions?: Extensions;
  [key: string]: unknown;
}

export interface HttpRateLimiter {
  throttle(key: string, context: RateLimiterContext): Promise<void>;
  onSuccess?(key: string, context: RateLimiterContext): void | Promise<void>;
  onError?(key: string, error: unknown, context: RateLimiterContext): void | Promise<void>;
}

export interface CircuitBreaker {
  beforeRequest(key: string): Promise<void>;
  onSuccess(key: string): Promise<void>;
  onFailure(key: string, error: unknown): Promise<void>;
}

export type LoggerMeta = Record<string, unknown> & {
  correlation?: CorrelationInfo;
  requestId?: string;
  correlationId?: string;
  parentCorrelationId?: string;
  agentContext?: AgentContext;
  extensions?: Extensions;
};

export interface Logger {
  debug(message: string, meta?: LoggerMeta): void;
  info(message: string, meta?: LoggerMeta): void;
  warn(message: string, meta?: LoggerMeta): void;
  error(message: string, meta?: LoggerMeta): void;
}

/**
 * Error category classification for HTTP errors (v0.8).
 *
 * Standard v0.8 categories:
 * - 'none': No error
 * - 'auth': Authentication/authorization failure (401, 403)
 * - 'validation': Client input validation error (400, 422)
 * - 'quota': Quota/payment required (402)
 * - 'rate_limit': Rate limit exceeded (429)
 * - 'timeout': Request timeout (408)
 * - 'transient': Temporary server error, retryable (5xx)
 * - 'network': Network-level error (connection failed, DNS, etc.)
 * - 'canceled': Request was canceled by client
 * - 'unknown': Unclassified error
 *
 * @deprecated Legacy categories (pre-v0.8, use modern equivalents):
 * - 'not_found': Use 'validation' or handle 404s in application logic
 * - 'safety': Use 'validation' or custom error handling
 * - 'quota_exceeded': Use 'quota' or 'rate_limit'
 * - 'server': Use 'transient' for 5xx errors
 */
export type ErrorCategory =
  | 'none'
  | 'auth'
  | 'validation'
  | 'quota'
  | 'rate_limit'
  | 'timeout'
  | 'transient'
  | 'network'
  | 'canceled'
  | 'unknown'
  // Legacy categories for backwards compatibility:
  | 'not_found'
  | 'safety'
  | 'quota_exceeded'
  | 'server';

export interface ErrorContext {
  request: HttpRequestOptions;
  response?: Response;
  error?: unknown;
}

/**
 * v0.8 fallback hint for error recovery guidance.
 */
export interface FallbackHint {
  retryAfterMs?: number;
  retryable?: boolean;
  hint?: string;
  /**
   * @deprecated Legacy v0.7 field. Use hint instead.
   */
  degradeToOperation?: string;
  /**
   * @deprecated Legacy v0.7 field. Use hint instead.
   */
  reason?: string;
  [key: string]: unknown;
}

/**
 * v0.8 classified error result.
 */
export interface ClassifiedError {
  category: ErrorCategory;
  statusCode?: number;
  reason?: string;
  fallback?: FallbackHint;

  /**
   * @deprecated Legacy v0.7 field. Use fallback.retryable instead.
   */
  retryable?: boolean;
  /**
   * @deprecated Legacy v0.7 field. Use fallback.retryAfterMs instead.
   */
  suggestedBackoffMs?: number;
  /**
   * @deprecated Legacy v0.7 field. No longer used.
   */
  policyKey?: string;
}

/**
 * v0.8 transport layer raw HTTP response.
 */
export interface RawHttpResponse {
  status: number;
  headers: HttpHeaders;
  body: ArrayBuffer;
}

/**
 * v0.8 error classifier context.
 */
export interface ErrorClassifierContext {
  method: HttpMethod;
  url: string;
  attempt: number;
  request: HttpRequestOptions;
  response?: RawHttpResponse;
  error?: unknown;
}

/**
 * v0.8 error classifier interface (unified classify method).
 * Supports legacy v0.7 classifyNetworkError/classifyResponse for backwards compatibility.
 */
export interface ErrorClassifier {
  /**
   * v0.8 unified classify method (recommended).
   * Classifies both network errors and HTTP responses.
   */
  classify(ctx: ErrorClassifierContext): ClassifiedError;

  /**
   * @deprecated Legacy v0.7 method. Use classify(ctx) instead.
   */
  classifyNetworkError?(error: unknown, ctx?: ErrorContext): ClassifiedError;

  /**
   * @deprecated Legacy v0.7 method. Use classify(ctx) instead.
   */
  classifyResponse?(response: Response, bodyText?: string, ctx?: ErrorContext): ClassifiedError;
}

/**
 * @deprecated Legacy v0.7 interface. Use ErrorClassifier with classify(ctx) instead.
 */
export interface LegacyErrorClassifier {
  classify(ctx: ErrorContext): ClassifiedError;
}

/**
 * v0.8 rate limit feedback from HTTP headers.
 */
export interface RateLimitFeedback {
  remainingRequests?: number;
  limitRequests?: number;
  resetAt?: Date;

  remainingTokens?: number;
  limitTokens?: number;
  tokenResetAt?: Date;

  raw?: Record<string, string>;

  /**
   * @deprecated Legacy v0.7 field. Use resetAt instead.
   */
  resetRequestsAt?: Date;
  /**
   * @deprecated Legacy v0.7 field. Use tokenResetAt instead.
   */
  resetTokensAt?: Date;
  /**
   * @deprecated Legacy v0.7 field. Check remainingRequests === 0 instead.
   */
  isRateLimited?: boolean;
  /**
   * @deprecated Legacy v0.7 field. Use raw instead.
   */
  rawHeaders?: Record<string, string>;
}

/**
 * v0.8 request outcome summary for a logical HTTP request.
 */
export interface RequestOutcome {
  ok: boolean;
  status?: number;
  category: ErrorCategory;
  attempts: number;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  statusFamily?: number;  // 2xx, 4xx, 5xx
  errorMessage?: string;
  rateLimit?: RateLimitFeedback;

  /**
   * @deprecated Legacy v0.7 field. Use category instead.
   */
  errorCategory?: ErrorCategory;
  /**
   * @deprecated Legacy v0.7 field. Use rateLimit instead.
   */
  rateLimitFeedback?: RateLimitFeedback;
}

/**
 * v0.8 metrics information for a logical HTTP request.
 */
export interface MetricsRequestInfo {
  operation?: string;
  method: HttpMethod;
  url: string;
  correlation?: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;
  outcome: RequestOutcome;

  /**
   * @deprecated Legacy v0.7 field. Use outcome.status instead.
   */
  status?: number;
  /**
   * @deprecated Legacy v0.7 field. Use outcome.category instead.
   */
  errorCategory?: ErrorCategory;
  /**
   * @deprecated Legacy v0.7 field. Use outcome.durationMs instead.
   */
  durationMs?: number;
  /**
   * @deprecated Legacy v0.7 field. Use outcome.attempts instead.
   */
  attempts?: number;
  /**
   * @deprecated Legacy v0.7 field. Track cache hits separately via interceptors.
   */
  cacheHit?: boolean;
  /**
   * @deprecated Legacy v0.7 field. Use outcome.rateLimit instead.
   */
  rateLimitFeedback?: RateLimitFeedback;
  /**
   * @deprecated Legacy v0.7 field. No longer required at metrics level.
   */
  clientName?: string;
  /**
   * @deprecated Legacy v0.7 field. Use correlation instead.
   */
  correlation2?: CorrelationInfo;
}

export interface MetricsSink {
  recordRequest?(info: MetricsRequestInfo): void | Promise<void>;
}

/**
 * v0.8 transport request structure.
 */
export interface TransportRequest {
  method: HttpMethod;
  url: string;
  headers: HttpHeaders;
  body?: ArrayBuffer;
}

/**
 * v0.8 HTTP transport abstraction.
 * Takes a transport request and abort signal, returns a raw HTTP response.
 */
export interface HttpTransport {
  (req: TransportRequest, signal: AbortSignal): Promise<RawHttpResponse>;
}

/**
 * @deprecated Legacy v0.7 transport signature. Use v0.8 HttpTransport instead.
 */
export interface LegacyHttpTransport {
  (url: string, init: RequestInit): Promise<Response>;
}

export interface ResponseClassification {
  treatAsError?: boolean;
  overrideStatus?: number;
  category?: ErrorCategory;
  fallback?: FallbackHint;
}

export type ResponseClassifier = (
  response: Response,
  bodyText?: string,
) => Promise<ResponseClassification | void> | ResponseClassification | void;

/**
 * v0.8 tracing span interface.
 */
export interface TracingSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  recordException(error: Error): void;
}

/**
 * v0.8 tracing adapter interface.
 */
export interface TracingAdapter {
  startSpan(info: MetricsRequestInfo): TracingSpan | undefined;
  endSpan(span: TracingSpan, outcome: RequestOutcome): void | Promise<void>;
}

/**
 * @deprecated Legacy v0.7 tracing start options. Use v0.8 TracingAdapter instead.
 */
export interface TracingStartOptions {
  attributes?: Record<string, string | number | boolean | null>;
  agentContext?: AgentContext;
  extensions?: Extensions;
}

/**
 * @deprecated Legacy v0.7 TracingAdapter. Use v0.8 TracingAdapter instead.
 */
export interface LegacyTracingAdapter {
  startSpan(name: string, options?: TracingStartOptions): TracingSpan & { end(): void };
}

export interface PolicyContext {
  client: string;
  operation: string;
  correlation?: CorrelationInfo;
  requestId?: string;
  correlationId?: string;
  parentCorrelationId?: string;
  agentContext?: AgentContext;
  extensions?: Extensions;
}

export type PolicyWrapper = <T>(fn: () => Promise<T>, context: PolicyContext) => Promise<T>;

export interface OperationDefaults {
  timeoutMs?: number;
  maxRetries?: number;
  idempotent?: boolean;
}

/**
 * v0.8 HTTP client configuration.
 */
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

  /**
   * @deprecated Legacy v0.7 field. No longer required.
   */
  clientName?: string;
  /**
   * @deprecated Legacy v0.7 field. Use defaultExtensions or agentContext instead.
   */
  defaultAgentContext?: AgentContext;
  /**
   * @deprecated Legacy v0.7 field. Use metricsSink instead.
   */
  metrics?: MetricsSink;
  /**
   * @deprecated Legacy v0.7 field. Use tracingAdapter instead.
   */
  tracing?: TracingAdapter;
  /**
   * @deprecated Legacy v0.7 field. Use interceptor-based URL resolution instead.
   */
  resolveBaseUrl?: (opts: HttpRequestOptions) => string | undefined;
  /**
   * @deprecated Legacy v0.7 field. Use interceptors for custom rate limiting.
   */
  rateLimiter?: HttpRateLimiter;
  /**
   * @deprecated Legacy v0.7 field. Use interceptors for custom circuit breaking.
   */
  circuitBreaker?: CircuitBreaker;
  /**
   * @deprecated Legacy v0.7 field. Use interceptors with type checking instead.
   */
  logger?: Logger;
  /**
   * @deprecated Legacy hook from pre-v0.7. Use interceptors array with HttpRequestInterceptor.beforeSend instead.
   */
  beforeRequest?: (opts: HttpRequestOptions) => void | Promise<void>;
  /**
   * @deprecated Legacy hook from pre-v0.7. Use interceptors array with HttpRequestInterceptor.afterResponse instead.
   */
  afterResponse?: (opts: HttpRequestOptions, res: Response) => void | Promise<void>;
  /**
   * @deprecated Legacy hook from pre-v0.7. Use interceptors or errorClassifier instead.
   */
  responseClassifier?: ResponseClassifier;
  /**
   * @deprecated Legacy hook from pre-v0.7. Use @airnub/resilient-http-policies with createPolicyInterceptor instead.
   */
  policyWrapper?: PolicyWrapper;
  /**
   * @deprecated Legacy field from pre-v0.7. Use defaultResilience.perAttemptTimeoutMs instead.
   */
  timeoutMs?: number;
  /**
   * @deprecated Legacy field from pre-v0.7. Use defaultResilience.maxAttempts instead.
   */
  maxRetries?: number;
  /**
   * @deprecated Legacy field from pre-v0.7. Set resilience per-operation via request options instead.
   */
  operationDefaults?: Record<string, OperationDefaults>;
}

export type BaseHttpClientConfig = HttpClientConfig;

/**
 * v0.8 HTTP request options.
 */
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

  cacheMode?: "default" | "bypass" | "refresh";
  cacheKey?: string;

  /** Optional idempotency key; recommended for POST/PUT/PATCH. */
  idempotencyKey?: string;

  /**
   * @deprecated Legacy v0.7 field. Use urlParts.path instead.
   */
  path?: string;
  /**
   * @deprecated Legacy v0.7 field. Use pagination helpers from @airnub/resilient-http-pagination.
   */
  pageSize?: number;
  /**
   * @deprecated Legacy v0.7 field. Use pagination helpers from @airnub/resilient-http-pagination.
   */
  pageOffset?: number;
  /**
   * @deprecated Legacy v0.7 field. Use budget: BudgetHints instead.
   */
  budget2?: RequestBudget;
  /**
   * @deprecated Legacy field from pre-v0.7. Use resilience.retryEnabled and request-level classification instead.
   */
  idempotent?: boolean;
  /**
   * @deprecated Legacy field from pre-v0.7. Use resilience.perAttemptTimeoutMs or resilience.overallTimeoutMs instead.
   */
  timeoutMs?: number;
  /**
   * @deprecated Legacy field from pre-v0.7. Use resilience.maxAttempts instead.
   */
  maxRetries?: number;
  /**
   * @deprecated Legacy field from pre-v0.7. Use cacheMode and cacheKey instead.
   */
  cacheTtlMs?: number;
  /**
   * @deprecated Legacy field from pre-v0.7. Use correlation.requestId instead.
   */
  requestId?: string;
  /**
   * @deprecated Legacy field from pre-v0.7. Use correlation.correlationId instead.
   */
  correlationId?: string;
  /**
   * @deprecated Legacy field from pre-v0.7. Use correlation.parentCorrelationId instead.
   */
  parentCorrelationId?: string;
  /**
   * @deprecated Internal field, do not use directly.
   */
  attempt?: number;
}

/**
 * v0.8 HTTP response wrapper.
 * Wraps the decoded body together with status, headers, and request outcome.
 */
export interface HttpResponse<TBody = unknown> {
  status: number;
  headers: HttpHeaders;
  body: TBody;
  outcome: RequestOutcome;

  /**
   * Optional access to the underlying Response object for advanced use cases.
   * Available when using v0.7 compatibility mode or when needed for streaming, etc.
   */
  rawResponse?: Response;

  /**
   * Correlation information propagated with the request.
   * Useful for distributed tracing and request correlation.
   */
  correlation: CorrelationInfo;

  /**
   * Agent context information for multi-tenant or agent-based systems.
   */
  agentContext?: AgentContext;

  /**
   * Extension fields for custom metadata.
   */
  extensions?: Extensions;
}

/**
 * v0.8 interceptor context for beforeSend hook.
 */
export interface BeforeSendContext {
  request: HttpRequestOptions;
  attempt: number;
  signal: AbortSignal;
}

/**
 * v0.8 interceptor context for afterResponse hook.
 */
export interface AfterResponseContext<TBody = unknown> {
  request: HttpRequestOptions;
  attempt: number;
  response: HttpResponse<TBody>;
}

/**
 * v0.8 interceptor context for onError hook.
 */
export interface OnErrorContext {
  request: HttpRequestOptions;
  attempt: number;
  error: Error | unknown;
}

/**
 * v0.8 HTTP request interceptor for cross-cutting concerns.
 *
 * Interceptors are the primary extension mechanism in v0.8. They run in a well-defined order:
 *
 * **Execution Order:**
 * 1. `beforeSend`: Runs in **registration order** (first registered runs first)
 *    - Called before each HTTP attempt (including retries)
 *    - Can mutate the request (headers, URL, body, resilience settings)
 *    - Can throw to prevent the request (e.g., policy denial, guardrail violation)
 *    - Receives BeforeSendContext with request, attempt number, and AbortSignal
 *
 * 2. `afterResponse`: Runs in **reverse registration order** (last registered runs first)
 *    - Called after each successful HTTP response (including retries)
 *    - Receives AfterResponseContext with request, response, and attempt number
 *    - Cannot prevent further processing, but can record metrics/logs
 *
 * 3. `onError`: Runs in **reverse registration order** (last registered runs first)
 *    - Called after each failed HTTP attempt (network errors, non-2xx status if classified as error)
 *    - Receives OnErrorContext with request, error, and attempt number
 *    - Cannot suppress the error, but can record metrics/logs
 *
 * **Best Practices:**
 * - Use interceptors for: policies, guardrails, telemetry, caching, auth injection, request ID generation
 * - Avoid heavy computation in interceptors (they run on every attempt)
 * - Interceptors run *inside* the retry loop, so they execute once per attempt
 * - To run logic once per logical request (not per attempt), use metrics/tracing hooks instead
 * - Interceptors **must not** implement their own retry loops
 *
 * @see HttpClientConfig.interceptors - Where to register interceptors
 */
export interface HttpRequestInterceptor {
  beforeSend?(ctx: BeforeSendContext): Promise<void> | void;

  afterResponse?<TBody = unknown>(
    ctx: AfterResponseContext<TBody>
  ): Promise<void> | void;

  onError?(ctx: OnErrorContext): Promise<void> | void;
}
