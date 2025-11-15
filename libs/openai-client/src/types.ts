import type {
  CircuitBreaker,
  HttpCache,
  HttpRateLimiter,
  HttpTransport,
  Logger,
  MetricsSink,
} from '@libs/http-client-core';

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
  constructor(
    message: string,
    status: number,
    responseBody?: string,
    retryAfterMs?: number,
  ) {
    super(message, status, responseBody, retryAfterMs);
    this.name = 'OpenAiRequestError';
  }
}

export interface OpenAiCacheTtls {
  listModelsMs?: number;
  listFilesMs?: number;
}

export interface OpenAiClientConfig {
  apiKey: string;
  baseUrl?: string;
  organizationId?: string;
  maxRetries?: number;
  baseRetryDelayMs?: number;
  timeoutMs?: number;
  rateLimiter?: HttpRateLimiter;
  cache?: HttpCache;
  circuitBreaker?: CircuitBreaker;
  logger?: Logger;
  metrics?: MetricsSink;
  transport?: HttpTransport;
  defaultCacheTtls?: OpenAiCacheTtls;
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

export interface OpenAiFileDescriptor {
  id: string;
  object: string;
  bytes: number;
  created_at: number;
  filename: string;
  purpose: string;
  status?: string;
}

export interface OpenAiFileListResponse {
  object: string;
  data: OpenAiFileDescriptor[];
}
