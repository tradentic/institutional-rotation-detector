export interface HttpCache {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export type HttpMethod = 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type HttpHeaders = Record<string, string>;

export interface UrlParts {
  baseUrl?: string;
  path?: string;
  query?: Record<string, string | number | boolean | (string | number | boolean)[] | undefined>;
}

export interface CorrelationInfo {
  requestId: string;
  correlationId?: string;
  parentCorrelationId?: string;
}

export interface AgentContext {
  agent?: string;
  runId?: string;
  labels?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export type Extensions = Record<string, unknown>;

export interface ResilienceProfile {
  maxAttempts?: number;
  retryEnabled?: boolean;
  perAttemptTimeoutMs?: number;
  overallTimeoutMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  jitterFactorRange?: [number, number];
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
 * Error category classification for HTTP errors.
 *
 * Standard v0.7 categories:
 * - 'none': No error
 * - 'auth': Authentication/authorization failure (401, 403)
 * - 'validation': Client input validation error (400, 422)
 * - 'not_found': Resource not found (404)
 * - 'quota': Quota/payment required (402)
 * - 'rate_limit': Rate limit exceeded (429)
 * - 'timeout': Request timeout (408)
 * - 'transient': Temporary server error, retryable (5xx)
 * - 'network': Network-level error (connection failed, DNS, etc.)
 * - 'canceled': Request was canceled by client
 * - 'unknown': Unclassified error
 *
 * @deprecated Legacy categories (pre-v0.7, use modern equivalents):
 * - 'safety': Use 'validation' or custom error handling
 * - 'quota_exceeded': Use 'quota' or 'rate_limit'
 * - 'server': Use 'transient' for 5xx errors
 */
export type ErrorCategory =
  | 'none'
  | 'auth'
  | 'validation'
  | 'not_found'
  | 'quota'
  | 'rate_limit'
  | 'timeout'
  | 'transient'
  | 'network'
  | 'canceled'
  | 'unknown'
  | 'safety'
  | 'quota_exceeded'
  | 'server';

export interface ErrorContext {
  request: HttpRequestOptions;
  response?: Response;
  error?: unknown;
}

export interface ClassifiedError {
  category: ErrorCategory;
  statusCode?: number;
  retryable?: boolean;
  suggestedBackoffMs?: number;
  reason?: string;
  policyKey?: string;
}

export interface ErrorClassifier {
  classifyNetworkError(error: unknown, ctx?: ErrorContext): ClassifiedError;
  classifyResponse(response: Response, bodyText?: string, ctx?: ErrorContext): ClassifiedError;
  /** Legacy classifier hook retained for backwards compatibility */
  classify?(ctx: ErrorContext): ClassifiedError;
}

export interface LegacyErrorClassifier {
  classify(ctx: ErrorContext): ClassifiedError;
}

export interface FallbackHint {
  retryAfterMs?: number;
  degradeToOperation?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface RateLimitFeedback {
  limitRequests?: number;
  remainingRequests?: number;
  resetRequestsAt?: Date;
  limitTokens?: number;
  remainingTokens?: number;
  resetTokensAt?: Date;
  isRateLimited?: boolean;
  rawHeaders?: Record<string, string>;
}

export interface RequestOutcome {
  ok: boolean;
  status?: number;
  errorCategory?: ErrorCategory;
  attempts: number;
  startedAt: number;
  finishedAt: number;
  rateLimitFeedback?: RateLimitFeedback;
}

export interface MetricsRequestInfo {
  clientName: string;
  operation: string;
  method: HttpMethod;
  url: string;

  status?: number;
  errorCategory?: ErrorCategory;
  durationMs: number;
  attempts: number;

  cacheHit?: boolean;
  rateLimitFeedback?: RateLimitFeedback;

  correlation: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;
}

export interface MetricsSink {
  recordRequest?(info: MetricsRequestInfo): void | Promise<void>;
}

export interface TransportRequest {
  url: string;
  init: RequestInit;
}

export interface HttpTransport {
  (req: TransportRequest): Promise<Response>;
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

export interface TracingSpan {
  setAttribute(key: string, value: string | number | boolean | null): void;
  recordException(error: unknown): void;
  end(): void;
}

export interface TracingStartOptions {
  attributes?: Record<string, string | number | boolean | null>;
  agentContext?: AgentContext;
  extensions?: Extensions;
}

export interface TracingAdapter {
  startSpan(name: string, options?: TracingStartOptions): TracingSpan;
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

export interface HttpResponse<T = unknown> {
  status: number;
  headers: HttpHeaders;
  body: T;

  rawResponse?: Response;

  correlation: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;

  outcome: RequestOutcome;
}

export interface HttpClientConfig {
  clientName: string;
  baseUrl?: string;

  transport?: HttpTransport;
  defaultHeaders?: HttpHeaders;

  defaultResilience?: ResilienceProfile;
  defaultAgentContext?: AgentContext;

  interceptors?: HttpRequestInterceptor[];
  logger?: Logger;
  metrics?: MetricsSink;
  tracing?: TracingAdapter;

  resolveBaseUrl?: (opts: HttpRequestOptions) => string | undefined;
  cache?: HttpCache;
  rateLimiter?: HttpRateLimiter;
  circuitBreaker?: CircuitBreaker;

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
  errorClassifier?: ErrorClassifier | LegacyErrorClassifier;
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

export interface HttpRequestOptions {
  operation: string;
  method: HttpMethod;

  url?: string;
  urlParts?: UrlParts;
  path?: string;
  query?: Record<string, string | number | boolean | (string | number | boolean)[] | undefined>;
  pageSize?: number;
  pageOffset?: number;

  body?: BodyInit | unknown;
  headers?: HttpHeaders | Record<string, string | undefined>;
  idempotencyKey?: string;

  resilience?: ResilienceProfile;
  budget?: RequestBudget;

  correlation?: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;

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
   * @deprecated Legacy field from pre-v0.7. Caching should be implemented via interceptors.
   */
  cacheKey?: string;
  /**
   * @deprecated Legacy field from pre-v0.7. Caching should be implemented via interceptors.
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

export interface BeforeSendContext {
  request: HttpRequestOptions;
  signal: AbortSignal;
}

export interface AfterResponseContext {
  request: HttpRequestOptions;
  response: Response;
  attempt: number;
}

export interface OnErrorContext {
  request: HttpRequestOptions;
  error: unknown;
  attempt: number;
}

/**
 * HTTP request interceptor for cross-cutting concerns (logging, metrics, policies, guardrails, etc.).
 *
 * Interceptors are the primary extension mechanism in v0.7+. They run in a well-defined order:
 *
 * **Execution Order:**
 * 1. `beforeSend`: Runs in **registration order** (first registered runs first)
 *    - Called before each HTTP attempt (including retries)
 *    - Can mutate the request (headers, URL, body, resilience settings)
 *    - Can throw to prevent the request (e.g., policy denial, guardrail violation)
 *    - Receives BeforeSendContext with request and AbortSignal
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
 *
 * **Example:**
 * ```typescript
 * const loggingInterceptor: HttpRequestInterceptor = {
 *   beforeSend: ({ request }) => {
 *     console.log('Sending request:', request.operation);
 *   },
 *   afterResponse: ({ response, attempt }) => {
 *     console.log('Got response:', response.status, 'on attempt', attempt);
 *   },
 *   onError: ({ error, attempt }) => {
 *     console.error('Request failed on attempt', attempt, error);
 *   },
 * };
 * ```
 *
 * @see HttpClientConfig.interceptors - Where to register interceptors
 */
export interface HttpRequestInterceptor {
  beforeSend?:
  | ((ctx: BeforeSendContext) => Promise<void> | void)
  | ((opts: HttpRequestOptions) => Promise<HttpRequestOptions | void> | HttpRequestOptions | void);
  afterResponse?:
  | ((ctx: AfterResponseContext) => Promise<void> | void)
  | ((opts: HttpRequestOptions, res: Response) => Promise<Response | void> | Response | void);
  onError?:
  | ((ctx: OnErrorContext) => Promise<void> | void)
  | ((opts: HttpRequestOptions, error: unknown) => Promise<void> | void);
}
