# CODING_AGENT_PROMPT.md — `@airnub/agent-conversation-core` v0.2

## 0. Role & Scope

You are a **senior TypeScript engineer** working in the `tradentic/institutional-rotation-detector` monorepo.

Your job in this prompt is **only** to implement and align the package:

> `@airnub/agent-conversation-core`

with its v0.2 spec, built on top of **`@airnub/resilient-http-core` v0.7**.

Do not modify other packages except for minimal wiring (e.g., adding this as a dependency or adapter registration). Other packages have their own prompts.

---

## 1. Source of Truth

Treat these documents as the **source of truth** for this package:

- Core v0.7 spec:
  - `docs/specs/resilient_http_core_spec_v_0_7.md`
- Agent conversation core v0.2 spec:
  - `docs/specs/resilient_http_agent_conversation_core_spec_v_0_2.md`

If code and docs disagree, **the docs win**.

---

## 2. Global Constraints

- Language: **TypeScript** with `strict: true`.
- Depends on:
  - `@airnub/resilient-http-core` for all HTTP.
  - Optionally, provider-specific wrappers (like `@airnub/http-llm-openai`) via interfaces.
- Must not:
  - Call `fetch` or other transports directly.
  - Contain provider-specific HTTP details — those live in provider adapter packages.

---

## 3. Implementation Tasks

### 3.1 Core Concepts & Types

Implement all types from `resilient_http_agent_conversation_core_spec_v_0_2.md`, including:

- Conversation primitives:
  - `ConversationId`, `TurnId` (as specified).
  - `Conversation` (metadata, participants, tags, etc.).
  - `Turn` (who spoke, role, messages, tool calls, timestamps).
- Provider abstraction:
  - `ProviderSession` (per-provider, per-conversation state).
  - `ProviderAdapter` interface (for OpenAI, Anthropic, Gemini, etc.).
  - `ProviderMessage`, `ProviderResponse` abstractions.
- History management:
  - `HistoryItem`, `HistoryBuilder` (build provider-specific message lists from conversation turns).
- Engine:
  - `ConversationStore` interface for state persistence.
  - `ConversationEngine` or similar orchestrator that executes turns using a `ProviderAdapter`.

Export all public types and core interfaces from this package’s barrel file.

### 3.2 Integration with Core v0.7

All HTTP traffic must go through `@airnub/resilient-http-core`:

- Provider adapters should accept a `HttpClient` (or provider-specific wrapper that itself uses core).
- For each provider call, set:
  - `HttpRequestOptions.operation` to something meaningful (e.g., `"openai.responses.create"`).
  - `agentContext` with:
    - `agent`: current high-level agent name.
    - `runId`: derived from conversation and turn IDs (e.g., `conv-<id>:turn-<n>`).
    - `labels` and `metadata` as useful tags (e.g., environment, experiment name).
  - `extensions` with AI metadata:
    - `extensions['ai.provider'] = '<provider-name>'`.
    - `extensions['ai.model'] = '<model-id>'`.
    - `extensions['ai.request_type'] = 'chat' | 'tool_call' | 'embedding'` (per spec).

Do **not** duplicate resilience logic; rely on core’s `ResilienceProfile` and policies.

### 3.3 Conversation Engine Behaviour

Implement a `ConversationEngine` (or equivalent) with capabilities described in the spec:

- Creating new conversations.
- Appending user/assistant/tool turns.
- Building provider-specific request payloads via `HistoryBuilder`.
- Calling the `ProviderAdapter` to perform the actual LLM/API call.
- Updating conversation state with model responses, tool calls, and follow-up messages as needed.
- Handling streaming vs non-streaming flows if the spec requires it.

All persistent state should go through the `ConversationStore` abstraction, which may have:

- `getConversation(id)`, `saveConversation(conversation)`.
- `appendTurn(conversationId, turn)`.
- Possibly indexing or querying conversations depending on the spec.

### 3.4 Provider Adapter Contracts

Define `ProviderAdapter` interface(s) from the spec, such as:

- `sendTurn(context: ProviderContext): Promise<ProviderResponse>`.
- Optional streaming variants (`sendTurnStream`, etc.).

Ensure that adapter implementations can be implemented in separate packages (e.g., `@airnub/http-llm-openai`) without needing to change this package.

### 3.5 History & Truncation

If the spec defines token budgeting or history truncation:

- Implement a `HistoryBuilder` that:
  - Converts conversation state into provider-specific messages.
  - Applies truncation/compression rules to fit within model token budgets.
  - Exposes hooks for different provider strategies (e.g., summarisation vs dropping oldest messages).

Use core’s `AgentContext.metadata` or `extensions` to tag token-budget decisions if useful for telemetry.

---

## 4. Tests

Add tests under this package to cover:

- Creating and updating conversations and turns.
- Building provider-specific message arrays from a multi-turn conversation.
- Invoking a fake `ProviderAdapter` and storing the model’s reply.
- Propagating `agentContext`, `correlation`, and `extensions` into provider calls.
- Handling simple error scenarios (provider error, store failure) gracefully according to the spec.

Use in-memory implementations for `ConversationStore` and provider adapters in tests.

---

## 5. Done Definition

You are **done** for this prompt when:

- `@airnub/agent-conversation-core` compiles and exports all types and interfaces described in `resilient_http_agent_conversation_core_spec_v_0_2.md`.
- The package contains no direct `fetch` or low-level HTTP logic; all HTTP goes through `@airnub/resilient-http-core` (possibly via provider wrappers).
- Conversations and turns can be created, updated, and turned into provider requests via `HistoryBuilder`.
- Tests pass and demonstrate end-to-end flows for at least one fake provider.

Do not modify core or other satellite packages in this prompt beyond what’s necessary for types and wiring.

