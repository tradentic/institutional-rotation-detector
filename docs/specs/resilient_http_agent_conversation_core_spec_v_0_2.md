# Agent Conversation Core — Specification v0.2.0

> **Status:** Draft, aligned with `@airnub/resilient-http-core` v0.7.0  
> **Scope:** Provider-agnostic conversation model, history building, and turn orchestration for LLM-style agents.  
> **Non-goals:** Implement HTTP transports, provider-specific SDKs, or guardrails.

This document defines `@airnub/agent-conversation-core` v0.2.0. It is intended to be complete enough for a developer or coding agent to implement the library using only this spec plus `resilient-http-core` v0.7.0.

---

## 1. Design Goals & Principles

1. **Provider-agnostic core**  
   Conversation, message, turn, and history types are independent of any vendor (OpenAI, Anthropic, etc.).

2. **Stable, minimal domain model**  
   Clearly-defined `Conversation`, `ConversationMessage`, and `ConversationTurn` types that can be stored in any DB.

3. **Pluggable providers**  
   A `ProviderAdapter` abstraction for LLM calls (non-streaming and streaming) that can be backed by `@airnub/http-llm-openai` or any other implementation.

4. **Budget-aware history building**  
   A `HistoryBuilder` interface that can build context windows using token/length/message budgets rather than naive "last N messages" slicing.

5. **First-class turn orchestration**  
   `ConversationEngine` to run turns, record provider calls, and produce conversation-aware results.

6. **Telemetry-friendly metadata**  
   Uses `AgentContext` and `Extensions` from `resilient-http-core` to tie provider calls into HTTP telemetry without hard-wiring HTTP dependencies.

---

## 2. Dependencies & Environment

### 2.1 Type Dependencies

This package depends only on **types** from `@airnub/resilient-http-core` v0.7:

```ts
import type { AgentContext, Extensions } from "@airnub/resilient-http-core";
```

It does **not** depend on `HttpClient` directly; provider implementations may use `HttpClient`, but the core conversation layer is transport-agnostic.

### 2.2 Runtime Assumptions

- TypeScript or JavaScript (ES2019+).
- Standard `Date` and `Promise` types.

---

## 3. Core Domain Types

### 3.1 Identifiers

```ts
export type ConversationId = string;
export type TurnId = string;
export type MessageId = string;
export type ProviderCallId = string;
```

Implementations MAY choose any ID format (UUID, ULID, snowflake, etc.) as long as they are unique within their domain.

### 3.2 Roles

```ts
export type MessageRole = "system" | "user" | "assistant" | "tool";
```

- `system`: high-level instructions or configuration.
- `user`: human or external caller messages.
- `assistant`: LLM assistant messages.
- `tool`: messages representing tool results (returned back into the model).

### 3.3 Message Content Model

Messages may contain multiple parts (text, tool calls, tool results, other metadata). The content model is deliberately flexible but typed.

```ts
export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ToolCallContentPart {
  type: "tool-call";
  /** Tool name or identifier. */
  name: string;
  /** Opaque arguments, usually a JSON object. */
  arguments: unknown;
}

export interface ToolResultContentPart {
  type: "tool-result";
  /** Tool name or identifier. */
  name: string;
  /** Result payload (JSON, text, etc.). */
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
```

### 3.4 ConversationMessage

```ts
export interface ConversationMessage {
  id: MessageId;
  conversationId: ConversationId;
  role: MessageRole;
  createdAt: Date;

  /** Ordered content parts for this message. */
  content: MessageContentPart[];

  /** Optional free-form metadata (e.g. source, tags, UI hints). */
  metadata?: Record<string, unknown>;
}
```

### 3.5 Conversation

```ts
export interface Conversation {
  id: ConversationId;
  createdAt: Date;
  updatedAt: Date;

  /** Optional human-friendly title. */
  title?: string;

  /** Arbitrary metadata (e.g. tenant, topic, labels). */
  metadata?: Record<string, unknown>;
}
```

### 3.6 Token & Usage Accounting

The core provides basic usage types; providers may add vendor-specific details via `raw` fields.

```ts
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Total tokens if known; otherwise derived as input + output. */
  totalTokens?: number;
}
```

---

## 4. Provider Abstractions

The library is provider-agnostic. A `ProviderAdapter` bridges between the generic conversation model and a specific LLM API.

### 4.1 Provider Messages

Provider messages are structurally similar to conversation messages but optimised for provider APIs.

```ts
export type ProviderRole = MessageRole; // "system" | "user" | "assistant" | "tool"

export interface ProviderTextPart {
  type: "text";
  text: string;
}

export type ProviderContentPart = ProviderTextPart | { [key: string]: any };

export interface ProviderMessage {
  role: ProviderRole;
  content: ProviderContentPart[];
}
```

### 4.2 Tools & Tool Calls (Provider View)

```ts
export interface ProviderToolDefinition {
  name: string;
  description?: string;
  /** Provider-specific schema (e.g. JSON schema for arguments). */
  schema?: unknown;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: unknown;
}
```

### 4.3 Provider Call Types

```ts
export interface ProviderCallMetadata {
  /** Underlying provider name, e.g. "openai". */
  provider: string;
  /** Model name or identifier, e.g. "gpt-5.1-mini". */
  model: string;

  /** Optional request-level metadata. */
  extensions?: Extensions;
}

export interface ProviderCallParams {
  messages: ProviderMessage[];
  tools?: ProviderToolDefinition[];

  /** Optional tool choice hint; provider-specific semantics. */
  toolChoice?: unknown;

  /**
   * Optional max tokens or similar budget hints. Semantics are provider-
   * specific; the core does not interpret these.
   */
  maxTokens?: number;

  /** Provider metadata (model, provider id, etc.). */
  metadata: ProviderCallMetadata;

  /**
   * Optional AgentContext propagated from the caller; may be threaded into
   * HTTP metadata in provider implementations.
   */
  agentContext?: AgentContext;
}

export interface ProviderCallResult {
  id: ProviderCallId;
  createdAt: Date;

  /** Single assistant message returned by the provider. */
  message: ProviderMessage;

  /** Optional tool calls produced by this response. */
  toolCalls?: ProviderToolCall[];

  /** Token usage. */
  usage?: TokenUsage;

  /** Provider-specific raw response. */
  raw?: unknown;
}
```

### 4.4 Streaming

Streaming is optional but first-class.

```ts
export type ProviderStreamEvent =
  | { type: "delta"; delta: ProviderMessage }
  | { type: "tool-call"; toolCall: ProviderToolCall }
  | { type: "done"; result: ProviderCallResult };

export interface ProviderStream
  extends AsyncIterable<ProviderStreamEvent> {
  /** Resolves when the stream sends its final "done" event. */
  final: Promise<ProviderCallResult>;
}
```

### 4.5 ProviderAdapter Interface

```ts
export interface ProviderAdapter {
  /**
   * Perform a non-streaming completion call.
   */
  complete(params: ProviderCallParams): Promise<ProviderCallResult>;

  /**
   * Optional streaming completion. If implemented, MUST resolve to a
   * ProviderStream whose final event is of type "done".
   */
  completeStream?(params: ProviderCallParams): Promise<ProviderStream>;
}
```

The conversation core does not prescribe how the provider maps to HTTP; that is the job of provider-specific packages (e.g. `http-llm-openai`).

---

## 5. Conversation Store

`ConversationStore` is the persistence abstraction for conversations, messages, and turns.

### 5.1 Turn Metadata

```ts
export interface ProviderCallRecord {
  id: ProviderCallId;
  createdAt: Date;

  /** Provider metadata (model, provider name). */
  metadata: ProviderCallMetadata;

  /** Token usage summary. */
  usage?: TokenUsage;

  /** Provider-specific raw response, if stored. */
  raw?: unknown;
}

export interface ConversationTurn {
  id: TurnId;
  conversationId: ConversationId;
  createdAt: Date;

  /** Messages sent by the user for this turn. */
  userMessages: ConversationMessage[];

  /** Assistant message(s) returned by the provider for this turn. */
  assistantMessages: ConversationMessage[];

  /** Any tool messages used during this turn. */
  toolMessages?: ConversationMessage[];

  /** Provider call records involving this turn. */
  providerCalls: ProviderCallRecord[];

  /** Optional free-form metadata. */
  metadata?: Record<string, unknown>;
}
```

### 5.2 ConversationStore Interface

```ts
export interface ListConversationsOptions {
  limit?: number;   // default: 50
  before?: Date;    // list conversations updated before this date
}

export interface ListMessagesOptions {
  limit?: number;   // default: all
  /**
   * If true, messages MUST be returned in ascending time order (oldest
   * first). If false or undefined, implementation MAY choose any order
   * but SHOULD document it (recommended: ascending).
   */
  ascending?: boolean;
}

export interface ConversationStore {
  // Conversations
  createConversation(input: {
    id?: ConversationId;          // optional, implementation may generate
    title?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Conversation>;

  getConversation(id: ConversationId): Promise<Conversation | null>;

  updateConversation(
    id: ConversationId,
    updates: Partial<Pick<Conversation, "title" | "metadata">>
  ): Promise<Conversation | null>;

  listConversations(
    options?: ListConversationsOptions
  ): Promise<Conversation[]>;

  // Messages
  appendMessages(messages: ConversationMessage[]): Promise<void>;

  listMessages(
    conversationId: ConversationId,
    options?: ListMessagesOptions
  ): Promise<ConversationMessage[]>;

  // Turns
  appendTurn(turn: ConversationTurn): Promise<void>;

  listTurns(conversationId: ConversationId): Promise<ConversationTurn[]>;
}
```

### 5.3 In-Memory Store

The package MUST provide a zero-dependency `InMemoryConversationStore` suitable for tests and local runs. Its behaviour MAY be simple (in-memory arrays/maps) and it SHOULD NOT be used in production by default.

---

## 6. History Building

A `HistoryBuilder` constructs the sequence of messages to send to the provider, given a conversation, store, and budgets.

### 6.1 HistoryBuildRequest & Result

```ts
export interface HistoryBudget {
  /** Max total messages to include (including the new user messages). */
  maxMessages?: number;

  /** Max total characters across all text content. */
  maxChars?: number;

  /** Approximate max tokens across all text content. */
  maxTokens?: number;
}

export interface HistoryBuildRequest {
  conversation: Conversation;
  /** Store from which to load prior messages. */
  store: ConversationStore;

  /** New user messages that triggered this turn. */
  newUserMessages: ConversationMessage[];

  /** History budget constraints. */
  budget?: HistoryBudget;
}

export interface HistoryBuildResult {
  /** Messages to send to the provider, in the correct order. */
  messages: ConversationMessage[];

  /** Optional truncated flag if older messages had to be dropped. */
  truncated: boolean;
}
```

### 6.2 HistoryBuilder Interface

```ts
export interface HistoryBuilder {
  buildHistory(req: HistoryBuildRequest): Promise<HistoryBuildResult>;
}
```

### 6.3 Default History Builders

The package MUST provide at least one default implementation:

#### 6.3.1 RecentNTurnsHistoryBuilder

```ts
export interface RecentNTurnsHistoryBuilderOptions {
  /** Number of most recent turns to include before the new user message(s). */
  maxTurns: number;
}

export class RecentNTurnsHistoryBuilder implements HistoryBuilder {
  constructor(options: RecentNTurnsHistoryBuilderOptions);
  buildHistory(req: HistoryBuildRequest): Promise<HistoryBuildResult>;
}
```

**Behaviour:**

- Fetch all previous messages for the conversation (or turns if the store supports that efficiently).
- Take the most recent `maxTurns` worth of messages.
- Append the new user messages.
- Return them in chronological order.
- Set `truncated = true` if any older messages were excluded.

A more advanced `BudgetedHistoryBuilder` MAY be added later, but is not required by this v0.2 spec.

---

## 7. Conversation Engine

`ConversationEngine` orchestrates turns using a `ConversationStore`, `HistoryBuilder`, and `ProviderAdapter`.

### 7.1 Turn Requests & Results

```ts
export interface TurnInput {
  conversationId: ConversationId;

  /**
   * New user messages to append and include in this turn. These MUST
   * belong to the provided conversationId.
   */
  userMessages: ConversationMessage[];

  /** Provider to use for this turn. */
  provider: ProviderAdapter;

  /** Provider parameters (model, tools, etc.). */
  providerParams: Omit<ProviderCallParams, "messages">;

  /** Optional history budget for building context. */
  historyBudget?: HistoryBudget;

  /** Optional AgentContext for telemetry. */
  agentContext?: AgentContext;
}

export interface TurnOutput {
  /** Conversation after this turn (updatedAt may change). */
  conversation: Conversation;

  /** Turn record that was persisted to the store. */
  turn: ConversationTurn;

  /** Assistant messages for this turn. */
  assistantMessages: ConversationMessage[];

  /** Any tool messages involved in this turn. */
  toolMessages?: ConversationMessage[];
}
```

### 7.2 Streaming Turn Output

For streaming, the engine emits partial events and a final result.

```ts
export type StreamingTurnEvent =
  | { type: "delta"; delta: ConversationMessage }
  | { type: "tool-call"; toolCall: ToolCallContentPart }
  | { type: "completed"; output: TurnOutput };

export interface StreamingTurn
  extends AsyncIterable<StreamingTurnEvent> {
  /** Resolves once a completed event has been emitted. */
  final: Promise<TurnOutput>;
}
```

### 7.3 ConversationEngine Interface

```ts
export interface ConversationEngine {
  /** Underlying store used for persistence. */
  readonly store: ConversationStore;

  /** History strategy used for context windows. */
  readonly historyBuilder: HistoryBuilder;

  /**
   * Run a non-streaming turn: build history, call provider, persist
   * messages and turn, and return the turn output.
   */
  runTurn(input: TurnInput): Promise<TurnOutput>;

  /**
   * Optional streaming variant. If not implemented, callers may emulate
   * streaming at higher layers.
   */
  runStreamingTurn?(input: TurnInput): Promise<StreamingTurn>;
}
```

### 7.4 DefaultConversationEngine

The package MUST provide a `DefaultConversationEngine` implementation.

```ts
export interface DefaultConversationEngineOptions {
  store: ConversationStore;
  historyBuilder: HistoryBuilder;
}

export class DefaultConversationEngine implements ConversationEngine {
  readonly store: ConversationStore;
  readonly historyBuilder: HistoryBuilder;

  constructor(options: DefaultConversationEngineOptions);

  runTurn(input: TurnInput): Promise<TurnOutput>;

  runStreamingTurn?(input: TurnInput): Promise<StreamingTurn>;
}
```

#### 7.4.1 Non-streaming Behaviour

For `runTurn`:

1. Load conversation from `store.getConversation(conversationId)`.
   - If missing, the engine MAY either throw or create a new conversation; this MUST be documented. A reference implementation SHOULD throw.

2. Persist `userMessages` via `store.appendMessages`.

3. Build history via `historyBuilder.buildHistory` using:
   - `conversation`, `store`, and `newUserMessages`.

4. Map `ConversationMessage[]` → `ProviderMessage[]` for the provider.

5. Call `provider.complete` with `ProviderCallParams` built from:
   - `messages` (from step 4), tools and metadata from `providerParams`, and optional `agentContext`.

6. Convert the `ProviderCallResult.message` into one or more `ConversationMessage` objects with role `"assistant"`.

7. If `ProviderCallResult.toolCalls` is present, create corresponding `ConversationMessage`s with role `"assistant"` and `tool-call` content, plus placeholder `tool`-role messages as needed (or leave tool execution to a higher layer).

8. Construct `ConversationTurn` with:
   - `userMessages`, `assistantMessages`, optional `toolMessages`, and one `ProviderCallRecord` built from `ProviderCallResult`.

9. Persist turn via `store.appendTurn` and assistant/tool messages via `store.appendMessages`.

10. Update `conversation.updatedAt` and persist via `updateConversation`.

11. Return `TurnOutput` with the updated conversation, turn, and assistant/tool messages.

#### 7.4.2 Streaming Behaviour (If Implemented)

For `runStreamingTurn`:

- Steps 1–3 are the same as non-streaming.
- Step 5 uses `provider.completeStream` instead of `complete`.
- As `ProviderStreamEvent`s arrive:
  - Map `delta` events into `ConversationMessage` deltas and emit `StreamingTurnEvent` with `type: "delta"`.
  - For `tool-call` events, emit `StreamingTurnEvent` with `type: "tool-call"` containing a `ToolCallContentPart`.
- When a `"done"` event arrives:
  - Treat its `result` as the final `ProviderCallResult` and proceed with steps 6–11 as in non-streaming.
  - Emit a `"completed"` event with the final `TurnOutput`.
  - Resolve `StreamingTurn.final` with the same `TurnOutput`.

Implementations MAY choose not to implement streaming; in that case, `runStreamingTurn` can be omitted.

---

## 8. Metadata & Telemetry Semantics

### 8.1 AgentContext

`AgentContext` is threaded into provider calls (via `ProviderCallParams.agentContext`) and SHOULD be reused when constructing HTTP metadata (e.g. in `HttpRequestOptions` for provider-specific clients).

### 8.2 Extensions

`ProviderCallMetadata.extensions` is an `Extensions` bag consistent with `resilient-http-core` semantics:

- Providers MAY set keys like `ai.provider`, `ai.model`, `ai.operation`, `ai.tool`, `ai.tenant`.
- This metadata is intended to flow into HTTP calls and policies but is not interpreted by `agent-conversation-core` itself.

### 8.3 Usage & Turn Summaries

Implementations SHOULD:

- Summarise `TokenUsage` at the turn level (e.g. accumulate across multiple provider calls if a turn triggers more than one call).
- Optionally expose this usage in `ConversationTurn.metadata`.

---

## 9. Versioning & Stability

The following types and interfaces are considered the **stable surface** of `@airnub/agent-conversation-core` v0.2.0 and SHOULD remain backward compatible (with only additive changes) for 0.2.x and 1.x:

- Identifiers and roles:
  - `ConversationId`, `TurnId`, `MessageId`, `ProviderCallId`, `MessageRole`.
- Content types:
  - `TextContentPart`, `ToolCallContentPart`, `ToolResultContentPart`, `MetadataContentPart`, `MessageContentPart`.
- Core domain:
  - `ConversationMessage`, `Conversation`, `TokenUsage`.
- Provider abstractions:
  - `ProviderRole`, `ProviderTextPart`, `ProviderContentPart`, `ProviderMessage`.
  - `ProviderToolDefinition`, `ProviderToolCall`.
  - `ProviderCallMetadata`, `ProviderCallParams`, `ProviderCallResult`.
  - `ProviderStreamEvent`, `ProviderStream`, `ProviderAdapter`.
- Store & turns:
  - `ProviderCallRecord`, `ConversationTurn`.
  - `ListConversationsOptions`, `ListMessagesOptions`, `ConversationStore`.
- History:
  - `HistoryBudget`, `HistoryBuildRequest`, `HistoryBuildResult`, `HistoryBuilder`.
  - `RecentNTurnsHistoryBuilderOptions`, `RecentNTurnsHistoryBuilder`.
- Engine:
  - `TurnInput`, `TurnOutput`, `StreamingTurnEvent`, `StreamingTurn`, `ConversationEngine`.
  - `DefaultConversationEngineOptions`, `DefaultConversationEngine`.

Breaking changes to these shapes MUST be reserved for a major version.

---

## 10. Reference Implementation Notes (Non-normative)

1. **Mapping ConversationMessage → ProviderMessage**  
   Implement a helper to map `ConversationMessage[]` into `ProviderMessage[]`, combining multiple `TextContentPart`s into provider `content` arrays.

2. **ID generation**  
   Use a dedicated ID factory function to keep storage backends free to choose their own formats.

3. **Token estimation**  
   Token usage may not be known a priori; a reference implementation can rely on provider-reported token counts rather than recalculating.

4. **Partial persistence for streaming**  
   Decide whether to persist partial assistant messages as they stream or only persist the final message; document the chosen trade-off.

5. **Testing**  
   - Unit tests for:
     - History building with various budgets.
     - Store implementations (in-memory).
     - Mapping of messages to provider calls.
   - Integration tests for:
     - `DefaultConversationEngine.runTurn` with a fake provider.
     - Optional streaming behaviour with a synthetic `ProviderStream`.

With this specification, a developer or coding agent can implement `@airnub/agent-conversation-core` v0.2.0, integrate it with HTTP-based provider clients, and rely on a stable conversation/turn model that fits into the broader `resilient-http-core` ecosystem.