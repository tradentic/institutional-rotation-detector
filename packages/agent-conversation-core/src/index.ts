import type { AgentContext, Extensions } from '@airnub/resilient-http-core';

export type ConversationId = string;
export type TurnId = string;
export type MessageId = string;
export type ProviderCallId = string;

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type ProviderName = string;

export interface TextContentPart {
  type: 'text';
  text: string;
}

export type MessageContent = TextContentPart;

export interface ConversationMessage {
  id?: MessageId;
  role: MessageRole;
  createdAt: Date;
  content: MessageContent[];
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  id: ConversationId;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface ProviderCallMetadata {
  provider: ProviderName;
  model?: string;
  operation?: string;
  extensions?: Extensions;
}

export interface ProviderToolDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ProviderMessage {
  role: MessageRole;
  content: MessageContent[];
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ProviderCallResult {
  id: ProviderCallId;
  createdAt: Date;
  message: ProviderMessage;
  toolCalls?: ProviderToolCall[];
  usage?: TokenUsage;
  raw?: unknown;
}

export type ProviderStreamEvent =
  | { type: 'delta'; delta: ProviderMessage }
  | { type: 'tool-call'; toolCall: ProviderToolCall }
  | { type: 'done'; result: ProviderCallResult };

export interface ProviderStream extends AsyncIterable<ProviderStreamEvent> {
  final: Promise<ProviderCallResult>;
}

export interface ProviderCallParams {
  messages: ProviderMessage[];
  model: string;
  tools?: ProviderToolDefinition[];
  extensions?: Extensions;
  agentContext?: AgentContext;
}

export interface ProviderAdapter {
  complete(params: ProviderCallParams): Promise<ProviderCallResult>;
  completeStream?(params: ProviderCallParams): Promise<ProviderStream>;
}

export interface ProviderCallRecord {
  id: ProviderCallId;
  createdAt: Date;
  metadata: ProviderCallMetadata;
  usage?: TokenUsage;
  raw?: unknown;
}

export interface ConversationTurn {
  id: TurnId;
  conversationId: ConversationId;
  createdAt: Date;
  userMessages: ConversationMessage[];
  assistantMessages: ConversationMessage[];
  toolMessages?: ConversationMessage[];
  providerCalls: ProviderCallRecord[];
  metadata?: Record<string, unknown>;
}

export interface ListConversationsOptions {
  limit?: number;
  before?: Date;
}

export interface ListMessagesOptions {
  limit?: number;
  ascending?: boolean;
}

export interface ConversationStore {
  createConversation(input: { id?: ConversationId; title?: string; metadata?: Record<string, unknown> }): Promise<Conversation>;
  getConversation(id: ConversationId): Promise<Conversation | undefined>;
  listConversations(options?: ListConversationsOptions): Promise<Conversation[]>;
  addMessages(conversationId: ConversationId, messages: ConversationMessage[]): Promise<void>;
  listMessages(conversationId: ConversationId, options?: ListMessagesOptions): Promise<ConversationMessage[]>;
  recordTurn(turn: ConversationTurn): Promise<void>;
}

export class InMemoryConversationStore implements ConversationStore {
  private conversations = new Map<ConversationId, Conversation>();
  private messages = new Map<ConversationId, ConversationMessage[]>();
  private turns = new Map<ConversationId, ConversationTurn[]>();

  async createConversation(input: { id?: ConversationId; title?: string; metadata?: Record<string, unknown> }): Promise<Conversation> {
    const now = new Date();
    const conversation: Conversation = {
      id: input.id ?? `conv-${Date.now()}`,
      title: input.title,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata,
    };
    this.conversations.set(conversation.id, conversation);
    this.messages.set(conversation.id, []);
    this.turns.set(conversation.id, []);
    return conversation;
  }

  async getConversation(id: ConversationId): Promise<Conversation | undefined> {
    return this.conversations.get(id);
  }

  async listConversations(options?: ListConversationsOptions): Promise<Conversation[]> {
    let results = Array.from(this.conversations.values());
    if (options?.before) {
      results = results.filter((c) => c.updatedAt < options.before!);
    }
    results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    if (options?.limit !== undefined) {
      results = results.slice(0, options.limit);
    }
    return results;
  }

  async addMessages(conversationId: ConversationId, messages: ConversationMessage[]): Promise<void> {
    const list = this.messages.get(conversationId);
    if (!list) throw new Error('conversation not found');
    list.push(...messages);
    const conv = this.conversations.get(conversationId);
    if (conv) {
      conv.updatedAt = new Date();
      this.conversations.set(conversationId, conv);
    }
  }

  async listMessages(conversationId: ConversationId, options?: ListMessagesOptions): Promise<ConversationMessage[]> {
    const list = this.messages.get(conversationId) ?? [];
    const copy = [...list];
    if (options?.ascending === false) {
      copy.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } else {
      copy.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    }
    if (options?.limit !== undefined) {
      return copy.slice(-options.limit);
    }
    return copy;
  }

  async recordTurn(turn: ConversationTurn): Promise<void> {
    const list = this.turns.get(turn.conversationId);
    if (!list) throw new Error('conversation not found');
    list.push(turn);
    const conv = this.conversations.get(turn.conversationId);
    if (conv) {
      conv.updatedAt = turn.createdAt;
      this.conversations.set(turn.conversationId, conv);
    }
  }
}

export interface HistoryBudget {
  maxMessages?: number;
  maxChars?: number;
  maxTokens?: number;
}

export interface HistoryBuildRequest {
  conversation: Conversation;
  store: ConversationStore;
  newUserMessages: ConversationMessage[];
  budget?: HistoryBudget;
}

export interface HistoryBuildResult {
  messages: ConversationMessage[];
  truncated: boolean;
}

export interface HistoryBuilder {
  buildHistory(req: HistoryBuildRequest): Promise<HistoryBuildResult>;
}

export interface RecentNTurnsHistoryBuilderOptions {
  maxTurns: number;
}

export class RecentNTurnsHistoryBuilder implements HistoryBuilder {
  constructor(private readonly options: RecentNTurnsHistoryBuilderOptions) {}

  async buildHistory(req: HistoryBuildRequest): Promise<HistoryBuildResult> {
    const existing = await req.store.listMessages(req.conversation.id, { ascending: true });
    const truncated = existing.length > this.options.maxTurns;
    const selected = truncated ? existing.slice(-this.options.maxTurns) : existing;
    const messages = [...selected, ...req.newUserMessages];
    return { messages, truncated };
  }
}

export interface TurnInput {
  conversationId: ConversationId;
  userMessages: ConversationMessage[];
  provider: ProviderAdapter;
  providerParams: Omit<ProviderCallParams, 'messages'>;
  historyBudget?: HistoryBudget;
  agentContext?: AgentContext;
}

export interface TurnOutput {
  conversation: Conversation;
  turn: ConversationTurn;
  assistantMessages: ConversationMessage[];
  toolMessages?: ConversationMessage[];
}

export type StreamingTurnEvent =
  | { type: 'assistant-message'; message: ConversationMessage }
  | { type: 'tool-message'; message: ConversationMessage }
  | { type: 'done'; output: TurnOutput };

export interface StreamingTurn extends AsyncIterable<StreamingTurnEvent> {
  final: Promise<TurnOutput>;
}

export interface ConversationEngine {
  runTurn(input: TurnInput): Promise<TurnOutput>;
  runTurnStream?(input: TurnInput): Promise<StreamingTurn>;
}

export interface DefaultConversationEngineOptions {
  store: ConversationStore;
  historyBuilder: HistoryBuilder;
}

export class DefaultConversationEngine implements ConversationEngine {
  constructor(private readonly options: DefaultConversationEngineOptions) {}

  private async ensureConversation(id: ConversationId): Promise<Conversation> {
    const existing = await this.options.store.getConversation(id);
    if (existing) return existing;
    return this.options.store.createConversation({ id });
  }

  async runTurn(input: TurnInput): Promise<TurnOutput> {
    const conversation = await this.ensureConversation(input.conversationId);
    await this.options.store.addMessages(input.conversationId, input.userMessages);
    const history = await this.options.historyBuilder.buildHistory({
      conversation,
      store: this.options.store,
      newUserMessages: input.userMessages,
      budget: input.historyBudget,
    });
    const providerResult = await input.provider.complete({
      ...input.providerParams,
      messages: history.messages.map((m) => ({ role: m.role, content: m.content })),
      agentContext: input.agentContext,
    });
    const assistantMessages: ConversationMessage[] = [
      {
        id: `msg-${Date.now()}`,
        role: providerResult.message.role,
        createdAt: providerResult.createdAt,
        content: providerResult.message.content,
      },
    ];
    const turn: ConversationTurn = {
      id: `turn-${Date.now()}`,
      conversationId: input.conversationId,
      createdAt: providerResult.createdAt,
      userMessages: input.userMessages,
      assistantMessages,
      providerCalls: [
        {
          id: providerResult.id,
          createdAt: providerResult.createdAt,
          metadata: {
            provider: input.providerParams.model,
            model: input.providerParams.model,
            extensions: input.providerParams.extensions,
          },
          usage: providerResult.usage,
          raw: providerResult.raw,
        },
      ],
    };
    await this.options.store.addMessages(input.conversationId, assistantMessages);
    await this.options.store.recordTurn(turn);
    return { conversation: await this.ensureConversation(input.conversationId), turn, assistantMessages };
  }

  async runTurnStream(input: TurnInput): Promise<StreamingTurn> {
    if (!input.provider.completeStream) {
      const output = await this.runTurn(input);
      const iterator: AsyncIterable<StreamingTurnEvent> = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'done', output } as StreamingTurnEvent;
        },
      };
      return { ...iterator, final: Promise.resolve(output) };
    }

    const conversation = await this.ensureConversation(input.conversationId);
    await this.options.store.addMessages(input.conversationId, input.userMessages);
    const history = await this.options.historyBuilder.buildHistory({
      conversation,
      store: this.options.store,
      newUserMessages: input.userMessages,
      budget: input.historyBudget,
    });
    const stream = await input.provider.completeStream({
      ...input.providerParams,
      messages: history.messages.map((m) => ({ role: m.role, content: m.content })),
      agentContext: input.agentContext,
    });

    const events: StreamingTurnEvent[] = [];
    const finalPromise = (async () => {
      let finalResult: ProviderCallResult | undefined;
      for await (const evt of stream) {
        if (evt.type === 'delta') {
          const message: ConversationMessage = {
            id: `msg-${Date.now()}`,
            role: evt.delta.role,
            createdAt: new Date(),
            content: evt.delta.content,
          };
          events.push({ type: 'assistant-message', message });
        }
        if (evt.type === 'tool-call') {
          const message: ConversationMessage = {
            id: `msg-${Date.now()}`,
            role: 'tool',
            createdAt: new Date(),
            content: [{ type: 'text', text: JSON.stringify(evt.toolCall) }],
          };
          events.push({ type: 'tool-message', message });
        }
        if (evt.type === 'done') {
          finalResult = evt.result;
        }
      }
      if (!finalResult) throw new Error('stream ended without done');
      const assistantMessages: ConversationMessage[] = [
        {
          id: `msg-${Date.now()}`,
          role: finalResult.message.role,
          createdAt: finalResult.createdAt,
          content: finalResult.message.content,
        },
      ];
      const turn: ConversationTurn = {
        id: `turn-${Date.now()}`,
        conversationId: input.conversationId,
        createdAt: finalResult.createdAt,
        userMessages: input.userMessages,
        assistantMessages,
        providerCalls: [
          {
            id: finalResult.id,
            createdAt: finalResult.createdAt,
            metadata: { provider: input.providerParams.model, model: input.providerParams.model },
            usage: finalResult.usage,
            raw: finalResult.raw,
          },
        ],
      };
      await this.options.store.addMessages(input.conversationId, assistantMessages);
      await this.options.store.recordTurn(turn);
      const output: TurnOutput = { conversation: await this.ensureConversation(input.conversationId), turn, assistantMessages };
      events.push({ type: 'done', output });
      return output;
    })();

    const iterator: AsyncIterable<StreamingTurnEvent> = {
      async *[Symbol.asyncIterator]() {
        while (events.length > 0) {
          yield events.shift()!;
        }
        await finalPromise;
        while (events.length > 0) {
          yield events.shift()!;
        }
      },
    };

    return { ...iterator, final: finalPromise };
  }
}

