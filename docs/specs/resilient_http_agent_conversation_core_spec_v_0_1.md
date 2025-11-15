# `@airnub/agent-conversation-core` — Spec v0.1

**Status:** Draft for implementation  \
**Depends on:** `@tradentic/resilient-http-core` v0.6+  \
**Scope:** Conversation and turn abstraction for multi-provider, agentic AI workflows, built *on top of* a resilient HTTP layer, without leaking conversation semantics into the HTTP core.

---

## 1. Goals

1. Provide a **provider-agnostic conversation model** suitable for:
   - Single- and multi-agent workflows.
   - Multi-provider environments (OpenAI, Anthropic, Gemini, etc.).
   - Both chat-style and tool-augmented agents (tooling is future extensible).

2. Keep `@tradentic/resilient-http-core` **clean and agnostic**:
   - All conversation semantics live here.
   - HTTP core only sees `AgentContext`, `correlationId`, and `extensions` metadata.

3. Define **clear interfaces & types** for:
   - Conversations, turns, messages.
   - Provider adapters (how to plug in OpenAI/Anthropic/Gemini wrappers).
   - Conversation storage (in-memory + pluggable stores).
   - Hooks for pre/post turn processing.

4. Integrate cleanly with **core v0.6** features:
   - Use `AgentContext` consistently.
   - Use core `HttpClient` via provider adapters (but no hard dependency on a specific provider lib).
   - Support `correlationId`/`parentCorrelationId` and `extensions` so that HTTP telemetry can link to conversations and turns.

---

## 2. Non-goals

- Do **not**:
  - Implement HTTP transport directly (that’s `resilient-http-core`).
  - Hard-depend on any specific LLM provider (OpenAI/Anthropic/etc.).
  - Define or enforce prompt formats beyond simple message structures.
  - Own global rate limits or budgets (that’s `@airnub/resilient-http-policies`).
  - Tie to a specific orchestration framework (Temporal, LangChain, Swarm, etc.).

- v0.1 focuses on **conversations & turns** only:
  - Tool-calling, multi-step planning, and advanced routing are future extensions.

---

## 3. Core Concepts & Terminology

- **Agent**: A logical actor that initiates or handles conversation turns (e.g., `rotation-score-agent`).
- **Conversation**: A long-lived logical thread of interaction between an agent and one or more participants (human, tools, other agents).
- **Turn**: A single interaction step within a conversation: some input messages + provider calls → output messages.
- **Message**: A single piece of content held in the conversation history (user/system/assistant/tool/etc.).
- **Provider**: A specific LLM API or backend (e.g., `openai`, `anthropic`, `gemini`).
- **Model**: A particular model name/ID (e.g. `gpt-5.1-mini`, `claude-3.5-sonnet`).
- **Provider Adapter**: A thin, provider-specific adapter that knows how to call the provider’s API and normalize responses into conversation messages.

---

## 4. Data Model

### 4.1 IDs & Basic Types

```ts
export type ConversationId = string; // e.g. UUID or ULID
export type TurnId = string;        // unique within the system
export type MessageId = string;

export type ProviderId = string;    // e.g. 'openai', 'anthropic', 'gemini'
export type ModelId = string;       // provider-specific model ID

export type Role = 'system' | 'user' | 'assistant' | 'tool' | 'other';
```

### 4.2 Message

A normalized message type used by this library across all providers.

```ts
export interface ConversationMessage {
  id: MessageId;
  conversationId: ConversationId;

  /** Role in the conversation. */
  role: Role;

  /** Free-form content; commonly text, but could be JSON or other. */
  content: unknown;

  /**
   * Optional name for the speaker (e.g. agent name, tool name, user label).
   */
  name?: string;

  /** ISO 8601 timestamp. */
  createdAt: string;

  /**
   * Optional provider-side linkage (e.g. OpenAI message ID) for debugging.
   */
  providerMessageId?: string;

  /**
   * Opaque metadata for higher layers (e.g. token counts per message, UI hints).
   */
  metadata?: Record<string, unknown>;
}
```

> **Note:** `content` is intentionally `unknown` to allow both plain text and richer structured content. Higher layers may define more specific shapes.

### 4.3 Token Usage (optional)

```ts
export interface TokenUsage {
  /** Prompt/input tokens. */
  inputTokens?: number;
  /** Output/completion tokens. */
  outputTokens?: number;
  /** Total tokens, if provided. */
  totalTokens?: number;

  /**
   * Provider-specific breakdown can be attached here (e.g. per-cache type).
   */
  breakdown?: Record<string, unknown>;
}
```

### 4.4 Provider Call Record

A low-level record describing a single provider invocation during a turn.

```ts
export type ProviderOperation = 'chat' | 'embedding' | 'other';

export interface ProviderCallRecord {
  id: string; // e.g. ULID for the provider call

  conversationId: ConversationId;
  turnId: TurnId;

  provider: ProviderId;
  model: ModelId;
  operation: ProviderOperation;

  /**
   * Optional HTTP-level correlation IDs if the provider adapter uses
   * @tradentic/resilient-http-core.
   */
  requestId?: string;
  correlationId?: string;
  parentCorrelationId?: string;

  /**
   * Provider-specific request metadata (never sent back to the provider).
   * For example, payload hashes, routing decisions, safety settings.
   */
  requestMetadata?: Record<string, unknown>;

  /**
   * Provider-specific response metadata.
   */
  responseMetadata?: Record<string, unknown>;

  /** Optional token usage. */
  usage?: TokenUsage;

  /**
   * High-level outcome, compatible with core v0.6 RequestOutcome.
   * This can be derived by the provider adapter.
   */
  outcome?: RequestOutcome;

  startedAt: string; // ISO 8601
  finishedAt?: string; // ISO 8601, omitted if still in progress
}
```

### 4.5 Turn

```ts
export type TurnStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ConversationTurn {
  id: TurnId;
  conversationId: ConversationId;

  /** The logical agent handling this turn. */
  agent: string;

  /**
   * Input messages that triggered this turn (subset of conversation history).
   */
  inputMessages: ConversationMessage[];

  /**
   * Output messages produced by this turn (assistant or tool messages).
   */
  outputMessages: ConversationMessage[];

  /** Provider calls made during this turn. */
  providerCalls: ProviderCallRecord[];

  status: TurnStatus;

  /** E.g. 'user_message', 'tool_result', 'system_trigger'. */
  triggerType?: string;

  startedAt: string; // ISO
  finishedAt?: string; // ISO

  /** Optional high-level error info when status === 'failed'. */
  error?: {
    message: string;
    code?: string;
    provider?: ProviderId;
    raw?: unknown;
  };

  /** Free-form metadata (e.g. routing decisions, prompts, etc.). */
  metadata?: Record<string, unknown>;
}
```

### 4.6 Conversation

```ts
export interface Conversation {
  id: ConversationId;

  /** Primary agent responsible for this conversation (not necessarily exclusive). */
  agent: string;

  /** Optional human or tenant identifier. */
  subjectId?: string;

  /**
   * Optional title or label for UI purposes.
   */
  title?: string;

  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;

  /**
   * Conversation-level metadata (e.g., scenario type, experiment cohort).
   */
  metadata?: Record<string, unknown>;
}
```

> The library does not prescribe how many turns/messages are stored in memory vs persisted; that’s the job of the `ConversationStore`.

---

## 5. Storage Abstractions

### 5.1 ConversationStore

The library does not own persistence; it defines an interface and provides a simple in-memory implementation.

```ts
export interface ConversationStore {
  createConversation(conv: Conversation): Promise<void>;
  getConversation(id: ConversationId): Promise<Conversation | null>;
  updateConversation(conv: Conversation): Promise<void>;

  appendMessages(conversationId: ConversationId, messages: ConversationMessage[]): Promise<void>;
  getMessages(conversationId: ConversationId, options?: {
    /** Optional limit; if undefined, returns all messages. */
    limit?: number;
    /** Optional sort order; default is ascending by createdAt. */
    order?: 'asc' | 'desc';
  }): Promise<ConversationMessage[]>;

  createTurn(turn: ConversationTurn): Promise<void>;
  updateTurn(turn: ConversationTurn): Promise<void>;
  getTurn(conversationId: ConversationId, turnId: TurnId): Promise<ConversationTurn | null>;

  listTurns(conversationId: ConversationId, options?: {
    limit?: number;
    order?: 'asc' | 'desc';
  }): Promise<ConversationTurn[]>;
}
```

### 5.2 InMemoryConversationStore

- A simple in-memory implementation suitable for tests and low-volume use.
- Not intended for production; future versions can add Redis/DB-backed stores.

---

## 6. Provider Abstractions

### 6.1 ProviderChatRequest & Result

To keep the library provider-agnostic, it defines a **normalized chat request** and expects adapters to translate it as needed.

```ts
export interface ChatInputMessage {
  role: Role;
  content: unknown;
  name?: string;
}

export interface ProviderChatRequest {
  /**
   * Messages to send to the provider for this call (already truncated/adapted).
   */
  messages: ChatInputMessage[];

  /** Model to use for this call. */
  model: ModelId;

  /**
   * Optional max tokens, temperature, etc. Provider adapters may map
   * or ignore as appropriate.
   */
  parameters?: Record<string, unknown>;
}

export interface ProviderChatResult {
  /** Messages to append to the conversation (assistant/tool/etc.). */
  messages: ConversationMessage[];

  /** Token usage, if provided. */
  usage?: TokenUsage;

  /** Provider-specific raw response for logging/debugging. */
  raw?: unknown;
}
```

### 6.2 Streaming

Streaming support is optional but should have a common shape.

```ts
export interface ProviderStreamChunk {
  /**
   * Partial message content (often text, but may be richer structures).
   */
  delta?: unknown;

  /**
   * Optional indication that a complete message is now available.
   */
  isMessageComplete?: boolean;

  /**
   * Optional final usage info when stream completes.
   */
  usage?: TokenUsage;

  /** Provider-specific raw chunk. */
  raw?: unknown;
}
```

### 6.3 ProviderAdapter

A provider adapter binds this library’s abstractions to an underlying provider-specific client (which likely uses `@tradentic/resilient-http-core`).

```ts
export interface ProviderCallOptions {
  /**
   * Conversation and turn context, for logging/telemetry.
   */
  conversationId: ConversationId;
  turnId: TurnId;

  /**
   * Agent identity for this call.
   */
  agent: string;

  /**
   * Optional HTTP-level context hooks (e.g. to build AgentContext).
   * This is where the provider adapter can plug in resilient-http-core.
   */
  buildAgentContext?: () => AgentContext;

  /**
   * Optional additional metadata for logging and routing.
   */
  metadata?: Record<string, unknown>;
}

export interface ProviderAdapter {
  /** Provider ID, e.g. 'openai', 'anthropic', 'gemini'. */
  id: ProviderId;

  /** Whether this adapter supports streaming chat responses. */
  supportsStreaming: boolean;

  /**
   * Non-streaming chat.
   */
  sendChat(request: ProviderChatRequest, options: ProviderCallOptions): Promise<ProviderChatResult>;

  /**
   * Streaming chat; if not implemented, callers should fall back to sendChat.
   */
  streamChat?(request: ProviderChatRequest, options: ProviderCallOptions): AsyncIterable<ProviderStreamChunk>;
}
```

> **Important:** `ProviderAdapter` itself does **not** require `HttpClient`; it is free to use `@tradentic/resilient-http-core` under the hood, but this library does not assume that.

---

## 7. Conversation Engine API

The main entrypoint is a `ConversationEngine` (or similar) that coordinates:

- Conversation creation and lookup.
- Turn creation.
- History assembly/truncation.
- Provider selection and invocation.
- Recording messages and provider call records.

### 7.1 Configuration

```ts
export interface ConversationEngineConfig {
  /** Default agent name, if not specified per operation. */
  defaultAgent: string;

  /** Conversation and turn storage. */
  store: ConversationStore;

  /** Provider adapters by ID. */
  providers: Record<ProviderId, ProviderAdapter>;

  /**
   * Default model per provider, if not specified per turn.
   */
  defaultModels?: Record<ProviderId, ModelId>;

  /**
   * Optional history builder used to construct ProviderChatRequest.messages
   * from stored messages.
   */
  historyBuilder?: HistoryBuilder;

  /**
   * Optional hook for turn-level orchestration (e.g., routing decisions).
   */
  planner?: TurnPlanner;

  /**
   * Optional hook for pre/post-processing.
   */
  hooks?: ConversationHooks;
}
```

### 7.2 HistoryBuilder

Responsible for selecting and shaping the subset of messages to send to the provider for a given turn.

```ts
export interface HistoryBuilderContext {
  conversation: Conversation;
  messages: ConversationMessage[];
  nextTurnId: TurnId;
  agent: string;
}

export interface HistoryBuilder {
  buildHistory(ctx: HistoryBuilderContext): Promise<ChatInputMessage[]>;
}
```

A default implementation can:

- Use the full message history.
- Optionally limit by count or approximate token count.

### 7.3 TurnPlanner

Optional orchestration logic to decide provider, model, and parameters for a new turn.

```ts
export interface PlanTurnInput {
  conversation: Conversation;
  messages: ConversationMessage[];
  agent: string;
  /** Optional hint from the caller; e.g. desired provider or model. */
  hints?: Record<string, unknown>;
}

export interface PlannedTurn {
  provider: ProviderId;
  model: ModelId;
  /** Provider-specific parameters (temperature, max tokens, etc.). */
  parameters?: Record<string, unknown>;
}

export interface TurnPlanner {
  planTurn(input: PlanTurnInput): Promise<PlannedTurn>;
}
```

A default planner may simply choose a configured default model for a single provider.

### 7.4 ConversationHooks

Hooks for instrumentation, modification, or side effects.

```ts
export interface ConversationHooks {
  /** Called when a new conversation is created. */
  onConversationCreated?(conv: Conversation): void | Promise<void>;

  /** Called before a turn is executed. */
  beforeTurn?(turn: ConversationTurn, ctx: { conversation: Conversation }): void | Promise<void>;

  /** Called after a turn successfully completes. */
  afterTurnSuccess?(turn: ConversationTurn, ctx: { conversation: Conversation }): void | Promise<void>;

  /** Called when a turn fails. */
  afterTurnError?(turn: ConversationTurn, error: unknown, ctx: { conversation: Conversation }): void | Promise<void>;
}
```

### 7.5 Engine Interface

```ts
export interface ConversationEngine {
  /**
   * Create a new conversation with optional initial system/user messages.
   */
  createConversation(options?: {
    agent?: string;
    subjectId?: string;
    title?: string;
    initialMessages?: ConversationMessage[];
    metadata?: Record<string, unknown>;
  }): Promise<Conversation>;

  /** Load an existing conversation. */
  getConversation(id: ConversationId): Promise<Conversation | null>;

  /**
   * Append messages to an existing conversation (e.g. new user input).
   */
  appendMessages(conversationId: ConversationId, messages: ConversationMessage[]): Promise<void>;

  /**
   * Execute a new turn: assemble history, choose provider/model, call adapter,
   * and record output messages + providerCall records.
   */
  runTurn(options: {
    conversationId: ConversationId;
    agent?: string;
    triggerType?: string;
    /**
     * Optional hints for planner or provider adapter.
     */
    hints?: Record<string, unknown>;
  }): Promise<ConversationTurn>;
}
```

Implementation details (v0.1):

1. **runTurn workflow**:
   - Load conversation + all messages.
   - Generate a new `TurnId` and create a `ConversationTurn` with `status = 'running'`.
   - Use `historyBuilder.buildHistory()` to compute `ChatInputMessage[]`.
   - Use `planner.planTurn()` to select provider/model/parameters.
   - Build a `ProviderChatRequest`.
   - Invoke `hooks.beforeTurn()`.
   - Create `ProviderCallRecord` with `startedAt` and optional `AgentContext` via `buildAgentContext`.
   - Call `provider.sendChat()` (or `streamChat()` in future versions) and await result.
   - Convert `ProviderChatResult.messages` into `ConversationMessage[]` (if not already in that shape) and append to store.
   - Update `ProviderCallRecord` with `finishedAt`, `usage`, and `outcome`.
   - Update `ConversationTurn` with `status = 'succeeded'`, `outputMessages`, `providerCalls`.
   - Persist turn & conversation `updatedAt`.
   - Call `hooks.afterTurnSuccess()`.

2. **Error handling**:
   - If adapter throws or provider call fails, mark the turn as `failed` with `error` metadata.
   - Call `hooks.afterTurnError()`.
   - Re-throw or return error according to library design; v0.1 may throw by default.

---

## 8. Integration with `resilient-http-core` v0.6

`@airnub/agent-conversation-core` does not depend directly on `HttpClient`, but is intentionally designed to integrate cleanly via provider adapters.

### 8.1 AgentContext & correlation

When a provider adapter uses `@tradentic/resilient-http-core`, it should:

- Set `AgentContext` on `HttpRequestOptions` roughly as:

  ```ts
  const agentContext: AgentContext = {
    agent: options.agent,              // e.g. 'rotation-score-agent'
    runId: `${options.conversationId}:${options.turnId}`,
    labels: {
      conversationId: options.conversationId,
      turnId: options.turnId,
      provider: adapter.id,
      model: request.model,
    },
    metadata: options.metadata,
  };
  ```

- Use `correlationId` equal to `runId` and `parentCorrelationId` equal to a previous turn’s run ID if applicable (this logic may live in higher-level orchestration and be passed into `buildAgentContext`).

- Attach AI-related metadata to `HttpRequestOptions.extensions`, e.g.:

  ```ts
  extensions: {
    'ai.provider': adapter.id,
    'ai.model': request.model,
    'ai.request_type': 'chat',
    'ai.streaming': false,
  }
  ```

This allows `resilient-http-core` and satellite libraries (`resilient-http-policies`, telemetry adapters, etc.) to treat AI requests as first-class citizens *without* the core knowing about conversations.

### 8.2 Policies & budgets

- `@airnub/resilient-http-policies` can use the `extensions` and `AgentContext` fields set by provider adapters to:
  - Enforce different rate limits/budgets for providers/models.
  - Distinguish interactive vs background agent traffic via `extensions['request.class']` or `labels`.

- `agent-conversation-core` itself does not apply policies; it merely ensures the necessary metadata is present.

---

## 9. Testing & Validation

The initial implementation should include tests that cover:

1. **Conversation lifecycle**:
   - Creating a conversation with/without initial messages.
   - Loading and updating a conversation.

2. **Turn execution**:
   - Single turn run with a simple `InMemoryConversationStore` and a mock `ProviderAdapter`.
   - Storing input/output messages and provider call records.

3. **HistoryBuilder & planner integration**:
   - Custom `HistoryBuilder` limiting the number of messages.
   - Custom `TurnPlanner` selecting different providers/models based on hints.

4. **Hooks**:
   - `onConversationCreated`, `beforeTurn`, `afterTurnSuccess`, `afterTurnError` all invoked appropriately.

5. **Error handling**:
   - Provider adapter throws → turn marked as `failed` and `afterTurnError` invoked.

6. **Core metadata wiring (via a fake provider adapter)**:
   - `AgentContext` correctly populated with conversation/turn IDs.
   - `extensions` populated with provider/model info.
   - `ProviderCallRecord` carries outcome + timing.

---

## 10. Future Extensions (Beyond v0.1)

- Tool-calling abstractions:
  - Represent tools/functions and tool call results as first-class messages/turns.
  - Propagate tool metadata to provider adapters.

- Multi-step planning:
  - Add planning hooks and richer `TurnPlanner` outputs (e.g., multi-hop plans).

- Conversation store modules:
  - Redis-backed and SQL-backed `ConversationStore` implementations.

- Richer message/content typing:
  - Distinguish plain text, structured tool calls, and UI elements more explicitly.

- Deeper integration with token accounting:
  - Use `TokenUsage` to drive budgets in `@airnub/resilient-http-policies`.

v0.1 focuses on a clean, provider-agnostic conversation abstraction that integrates naturally with `@tradentic/resilient-http-core` v0.6 while keeping all conversation semantics fully outside the HTTP core.

