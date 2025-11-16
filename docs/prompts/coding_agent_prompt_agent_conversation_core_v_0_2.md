# CODING_AGENT_PROMPT.md — `@airnub/agent-conversation-core` v0.2

## 0. Role & Context

You are a **senior TypeScript engineer**. Your task is to implement or align `@airnub/agent-conversation-core` with the v0.2 spec.

This package defines **provider-agnostic conversation primitives** (conversations, turns, provider messages) for LLM/agent workflows. It does **not** perform HTTP itself.

---

## 1. Source of Truth

Use this spec as authoritative:

- `docs/specs/resilient_http_agent_conversation_core_spec_v_0_2.md`

If existing code disagrees with the spec, the spec wins.

---

## 2. Global Constraints

- TypeScript with `strict: true`.
- No direct network or provider SDK dependencies.
- No dependency on `@airnub/resilient-http-core` — this package is HTTP-agnostic.

---

## 3. Tasks

### 3.1 Core Domain Types

Implement or align the following types exactly as per the spec:

- Conversation structures:
  - `Conversation`
  - `ConversationMessage`
  - `ConversationTurn`
  - Roles: `system | user | assistant | tool`.
  - Content parts (e.g., `text`, `tool-call`, `tool-result`, `metadata`).

- Token usage:
  - `TokenUsage` shared with provider adapters.

### 3.2 Provider Abstractions

Implement:

- `ProviderMessage`
- `ProviderToolDefinition`
- `ProviderToolCall`
- `ProviderCallParams`
- `ProviderCallResult`
- Streaming types: `ProviderStreamEvent`, `ProviderStream` (if defined in the spec).
- `ProviderAdapter` interface with `complete` (+ optional `completeStream`).

These abstractions must be **provider-agnostic** (OpenAI, Anthropic, Gemini, local models, etc.).

### 3.3 Conversation Store

Implement `ConversationStore` interface and an in-memory implementation:

- `InMemoryConversationStore`
- Methods to:
  - Create and retrieve conversations.
  - Append and list messages.
  - Append and list turns.

Ensure the store is pluggable so future implementations (Redis/DB) can be added without changing the interface.

### 3.4 History Builder

Implement a history builder that builds the context window for a provider call:

- Types:
  - `HistoryBudget` (token/message limits).
  - `HistoryBuildRequest`.
  - `HistoryBuildResult`.
- Implementation:
  - `RecentNTurnsHistoryBuilder` (or similar) that selects the most recent turns within the budget.

### 3.5 Conversation Engine

Implement a `ConversationEngine` and default implementation (e.g. `DefaultConversationEngine`) that:

- Accepts a new user message + optional metadata.
- Fetches conversation + history from `ConversationStore`.
- Uses `HistoryBuilder` to build a provider-ready message list.
- Calls a `ProviderAdapter` (`complete` / `completeStream`).
- Persists new messages and a `ConversationTurn`.
- Returns a turn-level result including assistant message, tool calls, and token usage.

Streaming support is optional but should match the spec if included.

---

## 4. Tests

Create tests using a **fake `ProviderAdapter`** (no real LLM calls):

- Conversation lifecycle:
  - Create a conversation.
  - Append multiple user/assistant messages.
  - Run one or more turns with the engine.
- History behaviour:
  - Verify that `HistoryBuilder` respects budgets.
  - Confirm ordering and content in the built history.
- Store behaviour:
  - Ensure `InMemoryConversationStore` correctly persists and retrieves conversations, messages, and turns.

---

## 5. Acceptance Criteria

- Public API matches `resilient_http_agent_conversation_core_spec_v_0_2.md`.
- No HTTP or provider-specific logic appears in this package.
- `DefaultConversationEngine` + `InMemoryConversationStore` work together in tests to execute full turns using a fake provider adapter.

