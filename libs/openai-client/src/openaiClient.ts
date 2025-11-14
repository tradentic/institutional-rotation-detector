import { setTimeout as sleep } from 'timers/promises';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_RETRY_DELAY_MS = 500;
const DEFAULT_TIMEOUT_MS = 30_000;

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export class OpenAiRequestError extends ApiRequestError {
  constructor(message: string, status: number, responseBody?: string, retryAfterMs?: number) {
    super(message, status, responseBody, retryAfterMs);
    this.name = 'OpenAiRequestError';
  }
}

export interface RateLimiter {
  throttle(key?: string): Promise<void>;
  onSuccess?(key?: string): void | Promise<void>;
  onError?(key: string | undefined, error: ApiRequestError): void | Promise<void>;
}

export class NoopRateLimiter implements RateLimiter {
  // eslint-disable-next-line class-methods-use-this
  async throttle(): Promise<void> {}

  // eslint-disable-next-line class-methods-use-this
  onSuccess?(): void {}

  // eslint-disable-next-line class-methods-use-this
  onError?(): void {}
}

export interface Cache {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete?(key: string): Promise<void>;
}

export class InMemoryCache implements Cache {
  private readonly store = new Map<string, { value: unknown; expiresAt?: number }>();

  async get<T>(key: string): Promise<T | undefined> {
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

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const expiresAt = ttlMs ? Date.now() + ttlMs : undefined;
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

export interface CircuitBreaker {
  beforeRequest(key?: string): Promise<void>;
  onSuccess(key?: string): void | Promise<void>;
  onFailure(key: string | undefined, err: ApiRequestError): void | Promise<void>;
}

export interface Logger {
  debug?(msg: string, meta?: unknown): void;
  info?(msg: string, meta?: unknown): void;
  warn?(msg: string, meta?: unknown): void;
  error?(msg: string, meta?: unknown): void;
}

export interface MetricsSink {
  recordRequest(options: {
    endpoint: string;
    method: string;
    durationMs: number;
    status: number;
    retries: number;
    cacheHit: boolean;
  }): void | Promise<void>;
}

export interface HttpTransport {
  (url: string, init: RequestInit): Promise<Response>;
}

export type QueryParamValue = string | number | boolean | string[] | number[] | undefined;
export type QueryParams = Record<string, QueryParamValue>;

export interface RequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  method?: string;
  body?: BodyInit | null;
  params?: QueryParams;
  cacheTtlMs?: number;
  cacheKey?: string;
  timeoutMs?: number;
}

export interface OpenAiClientConfig {
  apiKey: string;
  baseUrl?: string;
  organizationId?: string;
  maxRetries?: number;
  baseRetryDelayMs?: number;
  timeoutMs?: number;
  rateLimiter?: RateLimiter;
  cache?: Cache;
  circuitBreaker?: CircuitBreaker;
  logger?: Logger;
  metrics?: MetricsSink;
  transport?: HttpTransport;
}

export interface OpenAiResponsesRequest {
  model: string;
  input: unknown;
  reasoning?: { effort: string };
  text?: { verbosity: string };
  max_output_tokens?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  previous_response_id?: string;
  metadata?: Record<string, unknown>;
}

export interface OpenAiResponseItem {
  type: string;
  id?: string;
  call_id?: string;
  name?: string;
  content?: string;
  input?: unknown;
  arguments?: unknown;
  [key: string]: unknown;
}

export interface OpenAiResponsesResult {
  id: string;
  model: string;
  items: OpenAiResponseItem[];
  output_text?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens?: number;
  };
}

export interface OpenAiModelDescription {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  [key: string]: unknown;
}

export interface OpenAiModelListResponse {
  object: string;
  data: OpenAiModelDescription[];
}

export class OpenAiClient {
  private readonly baseUrl: string;

  private readonly maxRetries: number;

  private readonly baseRetryDelayMs: number;

  private readonly timeoutMs: number;

  private readonly rateLimiter: RateLimiter;

  private readonly cache?: Cache;

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

  async createResponse(body: OpenAiResponsesRequest): Promise<OpenAiResponsesResult> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    return this.requestWithRetries<OpenAiResponsesResult>(
      '/responses',
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers,
      },
      parseJson,
    );
  }

  async listModels(options?: { cacheTtlMs?: number }): Promise<OpenAiModelListResponse> {
    return this.requestWithRetries<OpenAiModelListResponse>(
      '/models',
      {
        method: 'GET',
        cacheTtlMs: options?.cacheTtlMs,
      },
      parseJson,
    );
  }

  private async requestWithRetries<T>(
    path: string,
    options: RequestOptions,
    parser: (response: Response) => Promise<T>,
  ): Promise<T> {
    const method = (options.method ?? 'GET').toUpperCase();
    const url = this.buildUrl(path, options.params);
    const endpoint = path;
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
        await this.metrics?.recordRequest({
          endpoint,
          method,
          durationMs: 0,
          status: 200,
          retries: 0,
          cacheHit: true,
        });
        return cached;
      }
    }

    const headers: HeadersInit = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      ...(options.headers ?? {}),
    };
    if (this.organizationId) {
      (headers as Record<string, string>)['OpenAI-Organization'] = this.organizationId;
    }

    const { params: _p, cacheTtlMs, timeoutMs, cacheKey: _cacheKey, ...rest } = options;
    const init: RequestInit = {
      ...rest,
      method,
      headers,
    };

    const key = `${method}:${endpoint}`;

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
          await this.handleFailure(key, error, endpoint, method, start, attempt);

          if (!this.shouldRetry(error.status) || attempt === this.maxRetries) {
            throw error;
          }

          await this.waitForRetry(error, attempt, method, endpoint);
          continue;
        }

        const data = await parser(response);
        await this.rateLimiter.onSuccess?.(key);
        await this.circuitBreaker?.onSuccess?.(key);
        await this.metrics?.recordRequest({
          endpoint,
          method,
          durationMs: Date.now() - start,
          status: response.status,
          retries: attempt,
          cacheHit: false,
        });

        if (cacheEligible && cacheKey) {
          await this.cache!.set(cacheKey, data, cacheTtlMs);
        }

        return data;
      } catch (err) {
        const error = err instanceof ApiRequestError
          ? err
          : new OpenAiRequestError(
              err instanceof Error ? err.message : 'OpenAI request failed',
              0,
            );

        await this.handleFailure(key, error, endpoint, method, start, attempt);

        if (!this.shouldRetry(error.status) || attempt === this.maxRetries) {
          throw error;
        }

        await this.waitForRetry(error, attempt, method, endpoint);
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

  private shouldRetry(status: number): boolean {
    if (status === 0 || status === 429) {
      return true;
    }
    if (status === 500 || status === 502 || status === 503 || status === 504) {
      return true;
    }
    return false;
  }

  private async handleFailure(
    key: string,
    error: ApiRequestError,
    endpoint: string,
    method: string,
    start: number,
    attempt: number,
  ): Promise<void> {
    await this.rateLimiter.onError?.(key, error);
    await this.circuitBreaker?.onFailure?.(key, error);
    await this.metrics?.recordRequest({
      endpoint,
      method,
      durationMs: Date.now() - start,
      status: error.status,
      retries: attempt,
      cacheHit: false,
    });
  }

  private async waitForRetry(
    error: ApiRequestError,
    attempt: number,
    method: string,
    endpoint: string,
  ): Promise<void> {
    const delayMs = error.retryAfterMs && error.retryAfterMs > 0
      ? error.retryAfterMs
      : computeBackoffWithJitter(this.baseRetryDelayMs, attempt);

    this.logger?.warn?.(
      `[OpenAiClient] Retrying ${method} ${endpoint} after ${delayMs}ms due to status ${error.status}`,
    );

    await sleep(delayMs);
  }

  private buildUrl(path: string, params?: QueryParams): string {
    const url = new URL(path, this.baseUrl);
    if (params) {
      const entries = Object.entries(params).filter(([, value]) => value !== undefined);
      entries.sort(([a], [b]) => a.localeCompare(b));
      for (const [key, value] of entries) {
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private computeCacheKey(url: string): string {
    return `openai:${url}`;
  }
}

export function createOpenAiClientFromEnv(
  overrides: Partial<Omit<OpenAiClientConfig, 'apiKey'>> = {},
): OpenAiClient {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const baseUrl = overrides.baseUrl ?? process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL;
  const organizationId = overrides.organizationId ?? process.env.OPENAI_ORGANIZATION ?? process.env.OPENAI_ORG_ID;
  const maxRetries = overrides.maxRetries ?? (process.env.OPENAI_MAX_RETRIES ? Number(process.env.OPENAI_MAX_RETRIES) : undefined);
  const baseRetryDelayMs = overrides.baseRetryDelayMs ?? (process.env.OPENAI_BASE_RETRY_DELAY_MS ? Number(process.env.OPENAI_BASE_RETRY_DELAY_MS) : undefined);
  const timeoutMs = overrides.timeoutMs ?? (process.env.OPENAI_TIMEOUT_MS ? Number(process.env.OPENAI_TIMEOUT_MS) : undefined);

  return new OpenAiClient({
    apiKey,
    baseUrl,
    organizationId,
    maxRetries,
    baseRetryDelayMs,
    timeoutMs,
    rateLimiter: overrides.rateLimiter,
    cache: overrides.cache,
    circuitBreaker: overrides.circuitBreaker,
    logger: overrides.logger,
    metrics: overrides.metrics,
    transport: overrides.transport,
  });
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

function computeBackoffWithJitter(baseDelayMs: number, attempt: number): number {
  const exp = baseDelayMs * 2 ** attempt;
  const jitter = Math.random() * baseDelayMs;
  return exp + jitter;
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}
