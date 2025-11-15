import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions';
import type {
  CreateEmbeddingResponse,
  EmbeddingCreateParams,
} from 'openai/resources/embeddings';
import {
  DEFAULT_BASE_RETRY_DELAY_MS,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  InMemoryCache,
  NoopRateLimiter,
  OpenAiHttpClient,
} from './httpClient';
import type {
  OpenAiCacheTtls,
  OpenAiClientConfig,
  OpenAiFileListResponse,
  OpenAiModelDescription,
  OpenAiModelListResponse,
  OpenAiResponsesRequest,
  OpenAiResponsesResult,
} from './types';
export type {
  HttpRateLimiter as RateLimiter,
  HttpCache as Cache,
  CircuitBreaker,
  Logger,
  MetricsSink,
  HttpTransport,
} from '@libs/http-client-core';

export { ApiRequestError, OpenAiRequestError } from './types';
export { InMemoryCache, NoopRateLimiter } from './httpClient';
export type {
  OpenAiClientConfig,
  OpenAiCacheTtls,
  OpenAiResponsesRequest,
  OpenAiResponsesResult,
  OpenAiModelListResponse,
  OpenAiModelDescription,
  OpenAiFileListResponse,
} from './types';

interface CacheOptions {
  cacheTtlMs?: number;
}

export class OpenAiClient {
  public readonly config: OpenAiClientConfig;

  private readonly http: OpenAiHttpClient;

  private readonly defaultCacheTtls?: OpenAiCacheTtls;

  constructor(config: OpenAiClientConfig) {
    const normalizedConfig: OpenAiClientConfig = {
      ...config,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      baseRetryDelayMs: config.baseRetryDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };

    this.config = normalizedConfig;
    this.http = new OpenAiHttpClient(normalizedConfig);
    this.defaultCacheTtls = normalizedConfig.defaultCacheTtls;
  }

  async createResponse(body: OpenAiResponsesRequest): Promise<OpenAiResponsesResult> {
    return this.http.requestJson<OpenAiResponsesResult>({
      method: 'POST',
      path: '/responses',
      body,
      operation: 'responses.create',
      idempotent: false,
    });
  }

  async createChatCompletion(
    params: ChatCompletionCreateParamsNonStreaming,
  ): Promise<ChatCompletion> {
    return this.http.requestJson<ChatCompletion>({
      method: 'POST',
      path: '/chat/completions',
      body: params,
      operation: 'chatCompletions.create',
      idempotent: false,
    });
  }

  async createEmbedding(params: EmbeddingCreateParams): Promise<CreateEmbeddingResponse> {
    return this.http.requestJson<CreateEmbeddingResponse>({
      method: 'POST',
      path: '/embeddings',
      body: params,
      operation: 'embeddings.create',
      idempotent: true,
    });
  }

  async listModels(options?: CacheOptions): Promise<OpenAiModelListResponse> {
    const cacheTtlMs = this.resolveCacheTtl(
      options?.cacheTtlMs,
      this.defaultCacheTtls?.listModelsMs,
      5 * 60_000,
    );
    return this.http.requestJson<OpenAiModelListResponse>({
      method: 'GET',
      path: '/models',
      cacheTtlMs,
      operation: 'models.list',
    });
  }

  async listFiles(options?: CacheOptions): Promise<OpenAiFileListResponse> {
    const cacheTtlMs = this.resolveCacheTtl(
      options?.cacheTtlMs,
      this.defaultCacheTtls?.listFilesMs,
      60_000,
    );
    return this.http.requestJson<OpenAiFileListResponse>({
      method: 'GET',
      path: '/files',
      cacheTtlMs,
      operation: 'files.list',
    });
  }

  private resolveCacheTtl(
    override: number | undefined,
    configured?: number,
    fallback?: number,
  ): number | undefined {
    if (override !== undefined) {
      return override;
    }
    if (configured !== undefined) {
      return configured;
    }
    return fallback;
  }
}

export function createOpenAiClientFromEnv(
  overrides: Partial<OpenAiClientConfig> = {},
): OpenAiClient {
  const apiKey = overrides.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const baseUrl = overrides.baseUrl ?? process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL;
  const organizationId = overrides.organizationId
    ?? process.env.OPENAI_ORGANIZATION
    ?? process.env.OPENAI_ORG_ID;
  const maxRetries = overrides.maxRetries ?? parseOptionalNumber(process.env.OPENAI_MAX_RETRIES);
  const baseRetryDelayMs = overrides.baseRetryDelayMs
    ?? parseOptionalNumber(process.env.OPENAI_BASE_RETRY_DELAY_MS);
  const timeoutMs = overrides.timeoutMs ?? parseOptionalNumber(process.env.OPENAI_TIMEOUT_MS);

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
    defaultCacheTtls: overrides.defaultCacheTtls,
  });
}

function parseOptionalNumber(value: string | number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
