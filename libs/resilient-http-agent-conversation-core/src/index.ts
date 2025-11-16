import type { AgentContext, Extensions } from "@airnub/resilient-http-core";

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

export interface ProviderCallMetadata {
  provider: string;
  model: string;
  extensions?: Extensions;
}

export interface ProviderCallParams {
  messages: ProviderMessage[];
  tools?: ProviderToolDefinition[];
  toolChoice?: unknown;
  maxTokens?: number;
  metadata: ProviderCallMetadata;
  agentContext?: AgentContext;
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
  | { type: "delta"; delta: ProviderMessage }
  | { type: "tool-call"; toolCall: ProviderToolCall }
  | { type: "done"; result: ProviderCallResult };

export interface ProviderStream extends AsyncIterable<ProviderStreamEvent> {
  final: Promise<ProviderCallResult>;
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
  createConversation(input: {
    id?: ConversationId;
    title?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Conversation>;

  getConversation(id: ConversationId): Promise<Conversation | null>;

  updateConversation(
    id: ConversationId,
    updates: Partial<Pick<Conversation, "title" | "metadata">>
  ): Promise<Conversation | null>;

  listConversations(options?: ListConversationsOptions): Promise<Conversation[]>;

  appendMessages(messages: ConversationMessage[]): Promise<void>;

  listMessages(
    conversationId: ConversationId,
    options?: ListMessagesOptions
  ): Promise<ConversationMessage[]>;

  appendTurn(turn: ConversationTurn): Promise<void>;

  listTurns(conversationId: ConversationId): Promise<ConversationTurn[]>;
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
  private readonly maxTurns: number;

  constructor(options: RecentNTurnsHistoryBuilderOptions) {
    this.maxTurns = options.maxTurns;
  }

  async buildHistory(req: HistoryBuildRequest): Promise<HistoryBuildResult> {
    const turns = await req.store.listTurns(req.conversation.id);
    const sortedTurns = [...turns].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );
    const truncated = sortedTurns.length > this.maxTurns;
    const selectedTurns = sortedTurns.slice(-this.maxTurns);
    let selectedMessages = selectedTurns.flatMap((turn) => [
      ...turn.userMessages,
      ...turn.assistantMessages,
      ...(turn.toolMessages ?? []),
    ]);

    if (selectedMessages.length === 0) {
      const messagesFromStore = await req.store.listMessages(req.conversation.id, {
        ascending: true,
      });
      selectedMessages = messagesFromStore;
    }

    const messages = [...selectedMessages];
    for (const msg of req.newUserMessages) {
      if (!messages.find((m) => m.id === msg.id)) {
        messages.push(msg);
      }
    }

    messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    let constrainedMessages = messages;
    if (req.budget?.maxMessages && messages.length > req.budget.maxMessages) {
      constrainedMessages = messages.slice(-req.budget.maxMessages);
    }

    if (req.budget?.maxChars || req.budget?.maxTokens) {
      constrainedMessages = this.applyContentBudgets(
        constrainedMessages,
        req.budget
      );
    }

    return { messages: constrainedMessages, truncated };
  }

  private applyContentBudgets(
    messages: ConversationMessage[],
    budget?: HistoryBudget
  ): ConversationMessage[] {
    if (!budget?.maxChars && !budget?.maxTokens) {
      return messages;
    }

    const maxChars = budget?.maxChars ?? Number.POSITIVE_INFINITY;
    const maxTokens = budget?.maxTokens ?? Number.POSITIVE_INFINITY;
    let currentChars = 0;
    let currentTokens = 0;
    const result: ConversationMessage[] = [];

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      const textContent = message.content
        .filter((part): part is TextContentPart => part.type === "text")
        .map((part) => part.text)
        .join(" ");
      currentChars += textContent.length;
      currentTokens += textContent.split(/\s+/).length;
      if (currentChars > maxChars || currentTokens > maxTokens) {
        break;
      }
      result.unshift(message);
    }

    return result;
  }
}

export interface TurnInput {
  conversationId: ConversationId;
  userMessages: ConversationMessage[];
  provider: ProviderAdapter;
  providerParams: Omit<ProviderCallParams, "messages">;
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
  | { type: "delta"; delta: ConversationMessage }
  | { type: "tool-call"; toolCall: ToolCallContentPart }
  | { type: "completed"; output: TurnOutput };

export interface StreamingTurn extends AsyncIterable<StreamingTurnEvent> {
  final: Promise<TurnOutput>;
}

export interface ConversationEngine {
  readonly store: ConversationStore;
  readonly historyBuilder: HistoryBuilder;
  runTurn(input: TurnInput): Promise<TurnOutput>;
  runStreamingTurn?(input: TurnInput): Promise<StreamingTurn>;
}

export interface DefaultConversationEngineOptions {
  store: ConversationStore;
  historyBuilder: HistoryBuilder;
}

export class DefaultConversationEngine implements ConversationEngine {
  readonly store: ConversationStore;
  readonly historyBuilder: HistoryBuilder;

  constructor(options: DefaultConversationEngineOptions) {
    this.store = options.store;
    this.historyBuilder = options.historyBuilder;
  }

  async runTurn(input: TurnInput): Promise<TurnOutput> {
    const conversation = await this.getConversationOrThrow(input.conversationId);

    this.assertUserMessagesBelongToConversation(input.conversationId, input.userMessages);
    await this.store.appendMessages(input.userMessages);

    const history = await this.historyBuilder.buildHistory({
      conversation,
      store: this.store,
      newUserMessages: input.userMessages,
      budget: input.historyBudget,
    });

    const providerMessages = mapConversationMessagesToProvider(history.messages);
    const providerResult = await input.provider.complete({
      ...input.providerParams,
      messages: providerMessages,
      agentContext: input.agentContext,
    });

    return this.finalizeTurn({
      conversation,
      input,
      providerResult,
    });
  }

  async runStreamingTurn(input: TurnInput): Promise<StreamingTurn> {
    if (!input.provider.completeStream) {
      throw new Error("Provider does not support streaming");
    }

    const conversation = await this.getConversationOrThrow(input.conversationId);
    this.assertUserMessagesBelongToConversation(input.conversationId, input.userMessages);
    await this.store.appendMessages(input.userMessages);

    const history = await this.historyBuilder.buildHistory({
      conversation,
      store: this.store,
      newUserMessages: input.userMessages,
      budget: input.historyBudget,
    });

    const providerMessages = mapConversationMessagesToProvider(history.messages);
    const finalize = async (providerResult: ProviderCallResult) =>
      this.finalizeTurn({ conversation, input, providerResult });

    const { iterable, final } = this.createStreamingIterable(
      stream,
      finalize,
      conversation.id
    );

    return { ...iterable, final };
  }

  private createStreamingIterable(
    stream: ProviderStream,
    finalize: (result: ProviderCallResult) => Promise<TurnOutput>,
    conversationId: ConversationId
  ): { iterable: AsyncIterable<StreamingTurnEvent>; final: Promise<TurnOutput> } {
    const deferred = createDeferred<TurnOutput>();

    const iterable: AsyncIterable<StreamingTurnEvent> = {
      async *[Symbol.asyncIterator]() {
        try {
          for await (const event of stream) {
            if (event.type === "delta") {
              yield {
                type: "delta",
                delta: mapProviderMessageToConversation(event.delta, conversationId),
              };
            } else if (event.type === "tool-call") {
              yield {
                type: "tool-call",
                toolCall: {
                  type: "tool-call",
                  name: event.toolCall.name,
                  arguments: event.toolCall.arguments,
                },
              };
            } else if (event.type === "done") {
              const output = await finalize(event.result);
              deferred.resolve(output);
              yield { type: "completed", output };
              return;
            }
          }

          const finalResult = await stream.final;
          const output = await finalize(finalResult);
          deferred.resolve(output);
          yield { type: "completed", output };
        } catch (err) {
          deferred.reject(err as Error);
          throw err;
        }
      },
    };

    return { iterable, final: deferred.promise };
  }

  private async finalizeTurn(params: {
    conversation: Conversation;
    input: TurnInput;
    providerResult: ProviderCallResult;
  }): Promise<TurnOutput> {
    const { conversation, input, providerResult } = params;
    const assistantMessage = mapProviderMessageToConversation(
      providerResult.message,
      conversation.id
    );
    const toolMessages: ConversationMessage[] | undefined = providerResult.toolCalls?.map(
      (toolCall) =>
        createMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: [
            {
              type: "tool-call",
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          ],
        })
    );

    const providerCall: ProviderCallRecord = {
      id: providerResult.id,
      createdAt: providerResult.createdAt,
      metadata: input.providerParams.metadata,
      usage: providerResult.usage,
      raw: providerResult.raw,
    };

    const turn: ConversationTurn = {
      id: createId("turn"),
      conversationId: conversation.id,
      createdAt: new Date(),
      userMessages: input.userMessages,
      assistantMessages: [assistantMessage],
      toolMessages,
      providerCalls: [providerCall],
    };

    const assistantMessages = [assistantMessage];
    await this.store.appendMessages([...assistantMessages, ...(toolMessages ?? [])]);
    await this.store.appendTurn(turn);

    conversation.updatedAt = new Date();
    await this.store.updateConversation(conversation.id, {
      title: conversation.title,
      metadata: conversation.metadata,
    });

    return { conversation, turn, assistantMessages, toolMessages };
  }

  private async getConversationOrThrow(conversationId: ConversationId): Promise<Conversation> {
    const conversation = await this.store.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }
    return conversation;
  }

  private assertUserMessagesBelongToConversation(
    conversationId: ConversationId,
    messages: ConversationMessage[]
  ) {
    const invalid = messages.find((msg) => msg.conversationId !== conversationId);
    if (invalid) {
      throw new Error("User messages must belong to the provided conversationId");
    }
  }
}

export class InMemoryConversationStore implements ConversationStore {
  private conversations: Map<ConversationId, Conversation> = new Map();
  private messages: Map<ConversationId, ConversationMessage[]> = new Map();
  private turns: Map<ConversationId, ConversationTurn[]> = new Map();

  async createConversation(input: {
    id?: ConversationId;
    title?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Conversation> {
    const now = new Date();
    const conversation: Conversation = {
      id: input.id ?? createId("conv"),
      title: input.title,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.set(conversation.id, conversation);
    this.messages.set(conversation.id, []);
    this.turns.set(conversation.id, []);
    return conversation;
  }

  async getConversation(id: ConversationId): Promise<Conversation | null> {
    return this.conversations.get(id) ?? null;
  }

  async updateConversation(
    id: ConversationId,
    updates: Partial<Pick<Conversation, "title" | "metadata">>
  ): Promise<Conversation | null> {
    const existing = this.conversations.get(id);
    if (!existing) return null;
    const updated: Conversation = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };
    this.conversations.set(id, updated);
    return updated;
  }

  async listConversations(options?: ListConversationsOptions): Promise<Conversation[]> {
    let convos = Array.from(this.conversations.values());
    if (options?.before) {
      convos = convos.filter((c) => c.updatedAt < options.before!);
    }
    convos.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    if (options?.limit) {
      convos = convos.slice(0, options.limit);
    }
    return convos.map((c) => ({ ...c }));
  }

  async appendMessages(messages: ConversationMessage[]): Promise<void> {
    for (const message of messages) {
      const list = this.messages.get(message.conversationId);
      if (!list) {
        throw new Error(`Conversation ${message.conversationId} not found`);
      }
      list.push(message);
      const conversation = this.conversations.get(message.conversationId);
      if (conversation) {
        conversation.updatedAt = new Date();
        this.conversations.set(message.conversationId, conversation);
      }
    }
  }

  async listMessages(
    conversationId: ConversationId,
    options?: ListMessagesOptions
  ): Promise<ConversationMessage[]> {
    const list = this.messages.get(conversationId) ?? [];
    const ordered = options?.ascending
      ? [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      : [...list];
    const limited = options?.limit ? ordered.slice(-options.limit) : ordered;
    return limited.map((m) => ({ ...m, content: [...m.content] }));
  }

  async appendTurn(turn: ConversationTurn): Promise<void> {
    const list = this.turns.get(turn.conversationId);
    if (!list) {
      throw new Error(`Conversation ${turn.conversationId} not found`);
    }
    list.push(turn);
    const conversation = this.conversations.get(turn.conversationId);
    if (conversation) {
      conversation.updatedAt = new Date();
      this.conversations.set(turn.conversationId, conversation);
    }
  }

  async listTurns(conversationId: ConversationId): Promise<ConversationTurn[]> {
    return [...(this.turns.get(conversationId) ?? [])];
  }
}

function mapConversationMessagesToProvider(
  messages: ConversationMessage[]
): ProviderMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content.map((part) => {
      if (part.type === "text") return { type: "text", text: part.text } as ProviderTextPart;
      return { ...part } as ProviderContentPart;
    }),
  }));
}

function mapProviderMessageToConversation(
  message: ProviderMessage,
  conversationId: ConversationId
): ConversationMessage {
  const contentParts: MessageContentPart[] = message.content.map((part) => {
    if ((part as ProviderTextPart).type === "text") {
      return { type: "text", text: (part as ProviderTextPart).text };
    }
    if ((part as any).type === "tool-call") {
      const tc = part as ToolCallContentPart;
      return { type: "tool-call", name: tc.name, arguments: tc.arguments };
    }
    return { type: "metadata", data: part };
  });

  return createMessage({
    conversationId,
    role: message.role,
    content: contentParts,
  });
}

function createMessage(input: {
  conversationId: ConversationId;
  role: MessageRole;
  content: MessageContentPart[];
}): ConversationMessage {
  return {
    id: createId("msg"),
    conversationId: input.conversationId,
    role: input.role,
    createdAt: new Date(),
    content: input.content,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
