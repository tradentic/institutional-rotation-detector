import type {
  AgentContext,
  HttpClient,
  HttpRequestOptions,
  HttpResponse,
  Extensions,
} from '@airnub/resilient-http-core';
import type {
  ProviderAdapter,
  ProviderCallParams,
  ProviderCallResult,
  ProviderMessage,
  ProviderStream,
  ProviderStreamEvent,
  TokenUsage,
} from '@airnub/agent-conversation-core';

export interface OpenAIHttpClientConfig {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  client?: HttpClient;
  defaultHeaders?: Record<string, string>;
}

export interface CreateResponseRequest {
  model: string;
  messages: ProviderMessage[];
  tools?: unknown[];
  previous_response_id?: string;
  metadata?: Record<string, unknown>;
  stream?: boolean;
  extensions?: Extensions;
  agentContext?: AgentContext;
}

export interface OpenAIResponseChoice {
  message: ProviderMessage;
}

export interface OpenAIResponseUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface OpenAIResponse {
  id: string;
  created: number;
  model: string;
  choices: OpenAIResponseChoice[];
  usage?: OpenAIResponseUsage;
}

export class OpenAIHttpClient {
  private readonly baseUrl: string;
  private readonly client: HttpClient;
  private readonly headers: Record<string, string>;

  constructor(private readonly config: OpenAIHttpClientConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://api.openai.com').replace(/\/?$/, '');
    if (!config.client) {
      throw new Error('OpenAIHttpClient requires an HttpClient instance');
    }
    this.client = config.client;
    this.headers = {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      ...config.defaultHeaders,
    };
    if (config.organization) {
      this.headers['OpenAI-Organization'] = config.organization;
    }
    if (config.project) {
      this.headers['OpenAI-Project'] = config.project;
    }
  }

  async createResponse(body: CreateResponseRequest): Promise<OpenAIResponse> {
    const options: HttpRequestOptions = {
      method: 'POST',
      url: `${this.baseUrl}/v1/responses`,
      headers: { ...this.headers },
      body: JSON.stringify(body),
      operation: 'openai.responses.create',
      extensions: {
        'ai.provider': 'openai',
        'ai.model': body.model,
        'ai.operation': 'responses.create',
        ...body.extensions,
      },
      agentContext: body.agentContext,
    };
    return this.client.requestJson<OpenAIResponse>(options);
  }
}

export interface OpenAIProviderAdapterConfig {
  client: OpenAIHttpClient;
}

export class OpenAIProviderAdapter implements ProviderAdapter {
  constructor(private readonly config: OpenAIProviderAdapterConfig) {}

  async complete(params: ProviderCallParams): Promise<ProviderCallResult> {
    const response = await this.config.client.createResponse({
      model: params.model,
      messages: params.messages,
      metadata: params.extensions,
      stream: false,
      agentContext: params.agentContext,
    });
    const choice = response.choices[0];
    const usage: TokenUsage | undefined = response.usage
      ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined;
    return {
      id: response.id,
      createdAt: new Date(response.created * 1000),
      message: choice.message,
      usage,
      raw: response,
    };
  }

  async completeStream(params: ProviderCallParams): Promise<ProviderStream> {
    // For this minimal implementation, reuse the non-streaming path and emit a single done event.
    const result = await this.complete(params);
    const iterator: AsyncIterable<ProviderStreamEvent> = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'done', result } as ProviderStreamEvent;
      },
    };
    return { ...iterator, final: Promise.resolve(result) };
  }
}

