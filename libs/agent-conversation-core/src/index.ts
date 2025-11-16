import type { AgentContext, Extensions } from "@tradentic/resilient-http-core";

export type ConversationId = string;
export type TurnId = string;
export type MessageId = string;
export type ProviderCallId = string;

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ToolCallContentPart {
  type: "tool-call";
  name: string;
  arguments: unknown;
}

export interface ToolResultContentPart {
  type: "tool-result";
  name: string;
  result: unknown;
}

export interface MetadataContentPart {
  type: "metadata";
  data: unknown;
}

export type MessageContentPart =
  | TextContentPart
  | ToolCallContentPart
  | ToolResultContentPart
  | MetadataContentPart;

export interface ConversationMessage {
  id: MessageId;
  conversationId: ConversationId;
  role: MessageRole;
  createdAt: Date;
  content: MessageContentPart[];
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  id: ConversationId;
  createdAt: Date;
  updatedAt: Date;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
}

export type ProviderRole = MessageRole;
export interface ProviderTextPart {
  type: "text";
  text: string;
}
export type ProviderContentPart = ProviderTextPart | { [key: string]: any };

export interface ProviderMessage {
  role: ProviderRole;
  content: ProviderContentPart[];
}

export interface ProviderToolDefinition {
  name: string;
  description?: string;
  schema?: unknown;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ProviderToolResult {
  id: string;
  name: string;
  result: unknown;
}

export interface ProviderCallMetadata {
  id: ProviderCallId;
  provider: string;
  model?: string;
  createdAt: Date;
  raw?: unknown;
  usage?: TokenUsage;
}

export interface ProviderCall<TResponse = unknown> {
  id: ProviderCallId;
  response: TResponse;
  metadata: ProviderCallMetadata;
}

export interface ProviderAdapter<TResponse = unknown, TStream = unknown> {
  name: string;
  sendMessages(request: ProviderRequest): Promise<ProviderCall<TResponse>>;
  sendMessagesStream?(request: ProviderRequest): AsyncGenerator<TStream, ProviderCall<TResponse>, void>;
}

export interface ProviderRequest {
  conversationId: ConversationId;
  messages: ProviderMessage[];
  tools?: ProviderToolDefinition[];
  agentContext?: AgentContext;
  extensions?: Extensions;
  metadata?: Record<string, unknown>;
}

export interface ProviderSession {
  conversationId: ConversationId;
  provider: string;
  model?: string;
  createdAt: Date;
  lastCallId?: ProviderCallId;
}

export interface Turn {
  id: TurnId;
  conversationId: ConversationId;
  createdAt: Date;
  userMessage?: ConversationMessage;
  assistantMessage?: ConversationMessage;
  providerCall?: ProviderCall;
}

export interface ConversationStore {
  saveConversation(conversation: Conversation): Promise<void>;
  saveMessages(messages: ConversationMessage[]): Promise<void>;
  saveTurn(turn: Turn): Promise<void>;
  getConversation(id: ConversationId): Promise<Conversation | undefined>;
  getMessages(conversationId: ConversationId): Promise<ConversationMessage[]>;
}

export interface HistoryBuilderContext {
  conversation: Conversation;
  messages: ConversationMessage[];
  newUserMessage?: ConversationMessage;
}

export interface HistoryBuilder {
  buildHistory(ctx: HistoryBuilderContext): ProviderMessage[];
}

export interface ConversationEngineOptions {
  store: ConversationStore;
  provider: ProviderAdapter;
  historyBuilder: HistoryBuilder;
  conversationFactory?: () => Conversation;
}

export class ConversationEngine {
  private store: ConversationStore;
  private provider: ProviderAdapter;
  private historyBuilder: HistoryBuilder;
  private conversationFactory?: () => Conversation;

  constructor(options: ConversationEngineOptions) {
    this.store = options.store;
    this.provider = options.provider;
    this.historyBuilder = options.historyBuilder;
    this.conversationFactory = options.conversationFactory;
  }

  async ensureConversation(conversation?: Conversation): Promise<Conversation> {
    if (conversation) return conversation;
    const created = this.conversationFactory?.() ?? {
      id: `${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.store.saveConversation(created);
    return created;
  }

  async runTurn(conversation: Conversation | undefined, userMessage: ConversationMessage): Promise<Turn> {
    const convo = await this.ensureConversation(conversation);
    const existingMessages = await this.store.getMessages(convo.id);
    const history = this.historyBuilder.buildHistory({ conversation: convo, messages: existingMessages, newUserMessage: userMessage });
    const providerCall = await this.provider.sendMessages({
      conversationId: convo.id,
      messages: history,
      agentContext: userMessage.metadata?.agentContext as AgentContext | undefined,
      extensions: userMessage.metadata?.extensions as Extensions | undefined,
    });

    const assistantMessage: ConversationMessage = {
      id: `${Date.now()}-assistant`,
      conversationId: convo.id,
      role: "assistant",
      createdAt: new Date(),
      content: [{ type: "text", text: String((providerCall.response as any)?.text ?? "") }],
    };

    const turn: Turn = {
      id: `${Date.now()}-turn`,
      conversationId: convo.id,
      createdAt: new Date(),
      userMessage,
      assistantMessage,
      providerCall,
    };

    await this.store.saveMessages([userMessage, assistantMessage]);
    await this.store.saveTurn(turn);
    return turn;
  }
}

