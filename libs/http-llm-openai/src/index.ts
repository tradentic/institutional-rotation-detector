import type { HttpClient, HttpRequestOptions } from "@tradentic/resilient-http-core";

export interface OpenAIHttpClientConfig {
  client: HttpClient;
  baseUrl?: string;
  apiKey: string;
}

export interface OpenAIResponseObject {
  id: string;
  content: Array<{ type: string; text?: string }>;
  raw?: unknown;
  model?: string;
}

export interface OpenAIResponseStreamEvent {
  type: string;
  data: unknown;
}

export type OpenAIResponseStream = AsyncGenerator<OpenAIResponseStreamEvent, OpenAIResponseObject, void>;

export interface OpenAIResponsesClient {
  create(request: OpenAICreateRequest): Promise<OpenAIResponseObject>;
  createStream?(request: OpenAICreateRequest): OpenAIResponseStream;
}

export interface OpenAICreateRequest {
  model: string;
  messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
  metadata?: Record<string, unknown>;
  previous_response_id?: string;
  operation?: string;
  agentContext?: unknown;
  extensions?: Record<string, unknown>;
}

export interface OpenAIHttpClient {
  responses: OpenAIResponsesClient;
}

export function createOpenAIHttpClient(config: OpenAIHttpClientConfig): OpenAIHttpClient {
  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  const makeRequest = async (options: HttpRequestOptions) => {
    const headers = {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    } as Record<string, string>;
    return config.client.requestJson<OpenAIResponseObject>({
      ...options,
      headers,
    });
  };

  const responses: OpenAIResponsesClient = {
    async create(request) {
      const body = {
        model: request.model,
        messages: request.messages,
        metadata: request.metadata,
        previous_response_id: request.previous_response_id,
      };
      const result = await makeRequest({
        method: "POST",
        operation: request.operation ?? "openai.responses.create",
        url: `${baseUrl}/responses`,
        body,
        agentContext: request.agentContext,
        extensions: { ...request.extensions, "ai.provider": "openai", "ai.model": request.model },
      });
      return result;
    },
  };

  return { responses };
}

