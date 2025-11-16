import type {
  AgentContext,
  Extensions,
  HttpClient,
  HttpHeaders,
  HttpRequestOptions,
} from "@airnub/resilient-http-core";
import { HttpClient as CoreHttpClient } from "@airnub/resilient-http-core";

export type OpenAIRole = "system" | "user" | "assistant" | "developer" | "tool";

export interface OpenAITextBlock {
  type: "text";
  text: string;
}

export type OpenAIInputContent = string | OpenAITextBlock | (OpenAITextBlock | Record<string, unknown>)[];

export interface OpenAIInputMessage {
  role: OpenAIRole;
  content: OpenAIInputContent;
}

export interface OpenAIFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters: unknown;
}

export type OpenAIToolDefinition = OpenAIFunctionTool | Record<string, unknown>;

export interface OpenAIConversationState {
  lastResponseId?: string;
  metadata?: Record<string, unknown>;
}

export interface OpenAIResponseObject {
  id: string;
  model: string;
  createdAt: Date;
  outputText?: string;
  providerMessage?: ProviderMessage;
  toolCalls?: ProviderToolCall[];
  usage?: TokenUsage;
  raw: unknown;
}

export type OpenAIResponseStreamEvent =
  | { type: "text-delta"; textDelta: string }
  | { type: "tool-call"; toolCall: ProviderToolCall }
  | { type: "done"; result: OpenAIResponseObject };

export interface OpenAIResponseStream extends AsyncIterable<OpenAIResponseStreamEvent> {
  final: Promise<OpenAIResponseObject>;
}

export type OpenAITokenUsage = TokenUsage;

export interface CreateResponseRequest {
  model: string;
  input: string | OpenAIInputMessage | OpenAIInputMessage[];
  modalities?: ("text" | string)[];
  tools?: OpenAIToolDefinition[];
  toolChoice?: unknown;
  maxOutputTokens?: number | Record<string, unknown>;
  store?: boolean;
  extraParams?: Record<string, unknown>;
  previousResponseId?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateResponseOptions {
  agentContext?: AgentContext;
  extensions?: Extensions;
  conversationState?: OpenAIConversationState;
}

export interface OpenAIResponsesClient {
  create(request: CreateResponseRequest, options?: CreateResponseOptions): Promise<OpenAIResponseObject>;
  createStream?(request: CreateResponseRequest, options?: CreateResponseOptions): Promise<OpenAIResponseStream>;
}

export interface OpenAIHttpClientConfig {
  apiKey: string;
  organizationId?: string;
  projectId?: string;
  baseUrl?: string;
  clientName?: string;
  httpClient?: HttpClient;
  extensions?: Extensions;
  agentContextFactory?: () => AgentContext | undefined;
}

export interface OpenAIHttpClient {
  readonly http: HttpClient;
  readonly responses: OpenAIResponsesClient;
}

export interface ProviderMessage {
  role: "system" | "user" | "assistant" | "tool" | "developer";
  content: ProviderContentPart[];
}

export interface ProviderTextPart {
  type: "text";
  text: string;
}

export type ProviderContentPart = ProviderTextPart | { [key: string]: any };

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
}

export function createOpenAIHttpClient(config: OpenAIHttpClientConfig): OpenAIHttpClient {
  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  const http = config.httpClient ?? new CoreHttpClient({ clientName: config.clientName ?? "openai", baseUrl });

  const buildHeaders = (): HttpHeaders => {
    const headers: HttpHeaders = {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    };
    if (config.organizationId) {
      headers["OpenAI-Organization"] = config.organizationId;
    }
    if (config.projectId) {
      headers["OpenAI-Project"] = config.projectId;
    }
    return headers;
  };

  const normalizeInput = (input: CreateResponseRequest["input"]): string | OpenAIInputMessage[] => {
    if (typeof input === "string") return input;
    if (Array.isArray(input)) return input;
    return [input];
  };

  const mapToolCalls = (toolCalls: any[] | undefined): ProviderToolCall[] | undefined => {
    if (!toolCalls) return undefined;
    return toolCalls.map((call, idx) => ({
      id: call.id ?? `${idx}`,
      name: call.function?.name ?? call.name ?? "tool",
      arguments: call.function?.arguments ?? call.arguments ?? call.input ?? {},
    }));
  };

  const mapToResponseObject = (raw: any): OpenAIResponseObject => {
    const createdValue = raw?.created ?? raw?.created_at ?? Date.now();
    const createdAt = new Date(
      typeof createdValue === "number" ? (createdValue > 2_000_000_000 ? createdValue : createdValue * 1000) : createdValue,
    );
    const model = raw?.model ?? "";
    let outputText: string | undefined;

    const collectText = (content: any): string => {
      if (!content) return "";
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .map((part) => {
            if (typeof part === "string") return part;
            if (part?.text) return part.text;
            if (part?.type === "text") return part.text ?? "";
            return "";
          })
          .join("");
      }
      if (content?.text) return content.text;
      return "";
    };

    if (raw?.output_text !== undefined) {
      outputText = collectText(raw.output_text);
    } else if (raw?.output?.[0]?.content) {
      outputText = collectText(raw.output[0].content);
    } else if (raw?.choices?.[0]?.message?.content) {
      outputText = collectText(raw.choices[0].message.content);
    }

    const toolCalls = mapToolCalls(raw?.tool_calls ?? raw?.output?.[0]?.tool_calls ?? raw?.choices?.[0]?.message?.tool_calls);
    const providerMessage: ProviderMessage | undefined = outputText
      ? { role: "assistant", content: [{ type: "text", text: outputText }] }
      : undefined;

    return {
      id: raw?.id ?? "",
      model,
      createdAt,
      outputText: outputText || undefined,
      providerMessage,
      toolCalls,
      usage: raw?.usage as TokenUsage | undefined,
      raw,
    };
  };

  const mergeExtensions = (model: string, options?: CreateResponseOptions): Extensions => ({
    ...config.extensions,
    ...options?.extensions,
    "ai.provider": "openai",
    "ai.model": model,
    "ai.operation": "responses.create",
    ...(config.organizationId ? { "ai.tenant": config.organizationId } : {}),
    ...(config.projectId ? { "ai.project": config.projectId } : {}),
  });

  const buildRequestOptions = (
    body: Record<string, unknown>,
    model: string,
    options?: CreateResponseOptions,
  ): HttpRequestOptions => ({
    method: "POST",
    operation: "openai.responses.create",
    urlParts: { baseUrl, path: "/responses" },
    headers: buildHeaders(),
    body,
    agentContext: options?.agentContext ?? config.agentContextFactory?.(),
    extensions: mergeExtensions(model, options),
  });

  const responses: OpenAIResponsesClient = {
    async create(request, options) {
      const normalizedInput = normalizeInput(request.input);
      const previousResponseId = request.previousResponseId ?? options?.conversationState?.lastResponseId;
      const body = {
        model: request.model,
        input: normalizedInput,
        modalities: request.modalities,
        tools: request.tools,
        tool_choice: request.toolChoice,
        max_output_tokens: request.maxOutputTokens,
        store: request.store,
        response_format: request.extraParams?.response_format,
        previous_response_id: previousResponseId,
        metadata: request.metadata,
        ...request.extraParams,
      };
      const result = await http.requestJson<unknown>(buildRequestOptions(body, request.model, options));
      return mapToResponseObject(result);
    },
    async createStream(request, options) {
      const normalizedInput = normalizeInput(request.input);
      const previousResponseId = request.previousResponseId ?? options?.conversationState?.lastResponseId;
      const body = {
        model: request.model,
        input: normalizedInput,
        modalities: request.modalities,
        tools: request.tools,
        tool_choice: request.toolChoice,
        max_output_tokens: request.maxOutputTokens,
        store: request.store,
        response_format: request.extraParams?.response_format,
        previous_response_id: previousResponseId,
        metadata: request.metadata,
        stream: true,
        ...request.extraParams,
      };

      const response = await http.requestRaw(buildRequestOptions(body, request.model, options));
      const decoder = new TextDecoder();
      const reader = response.body?.getReader();
      if (!reader) {
        const fallback = mapToResponseObject(await response.json());
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: "done", result: fallback } as OpenAIResponseStreamEvent;
            return fallback;
          },
          final: Promise.resolve(fallback),
        } satisfies OpenAIResponseStream;
      }

      let buffer = "";
      let finalResponse: OpenAIResponseObject | undefined;
      let resolveFinal!: (value: OpenAIResponseObject) => void;
      let rejectFinal!: (reason?: unknown) => void;
      const final = new Promise<OpenAIResponseObject>((resolve, reject) => {
        resolveFinal = resolve;
        rejectFinal = reject;
      });

      const asyncIterator: AsyncGenerator<OpenAIResponseStreamEvent, OpenAIResponseObject, void> = (async function* () {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split(/\r?\n\r?\n/);
            buffer = parts.pop() ?? "";
            for (const part of parts) {
              const lines = part.split(/\r?\n/).filter(Boolean);
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const data = trimmed.slice(5).trim();
                if (data === "[DONE]") {
                    if (!finalResponse) {
                      finalResponse = mapToResponseObject({ id: "", model: request.model });
                    }
                  yield { type: "done", result: finalResponse };
                  return finalResponse;
                }
                try {
                  const parsed = JSON.parse(data);
                  if (parsed?.type?.includes?.("output_text.delta") || parsed?.type === "text_delta") {
                    const textDelta = parsed.delta?.text ?? parsed.text ?? "";
                    yield { type: "text-delta", textDelta };
                  }
                  if (parsed?.type?.includes?.("tool_call")) {
                    const toolCall = mapToolCalls([parsed.tool_call ?? parsed]).at(0);
                    if (toolCall) {
                      yield { type: "tool-call", toolCall };
                    }
                  }
                  if (parsed?.response || parsed?.type === "response.completed") {
                    finalResponse = mapToResponseObject(parsed.response ?? parsed);
                  }
                } catch (err) {
                  // ignore malformed chunks
                  continue;
                }
              }
            }
          }
        } catch (err) {
          rejectFinal(err);
          throw err;
        } finally {
          if (finalResponse) {
            resolveFinal(finalResponse);
            return finalResponse;
          }
            const fallback = mapToResponseObject({ id: "", model: request.model });
            resolveFinal(fallback);
            return fallback;
          }
        })();

      return {
          async *[Symbol.asyncIterator]() {
            for await (const event of asyncIterator) {
              if (event.type === "done") {
                finalResponse = event.result;
              }
              yield event;
            }
            finalResponse ??= mapToResponseObject({ id: "", model: request.model });
            return finalResponse;
          },
        final,
      } satisfies OpenAIResponseStream;
    },
  };

  return { http, responses };
}

