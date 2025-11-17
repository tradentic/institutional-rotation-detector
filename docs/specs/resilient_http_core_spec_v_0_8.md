# Resilient HTTP Ecosystem – Core Spec v0.8.0 (Full)

> **Status:** v0.8.0 – Greenfield baseline (supersedes v0.1–v0.7)**  
> **Scope:** Core HTTP client + satellites + testing & runtime composition utilities
>
> - `@airnub/resilient-http-core`
> - `@airnub/resilient-http-policies`
> - `@airnub/resilient-http-pagination`
> - `@airnub/agent-conversation-core`
> - `@airnub/http-llm-openai`
> - `@airnub/agent-browser-guardrails`
> - `@airnub/resilient-http-testing` (new testing helpers)
> - `@airnub/agent-runtime` (opinionated agent runtime)
>
> **Compatibility:** This is a **greenfield spec**. We do **not** maintain
> compatibility with earlier drafts. All legacy/deprecated hooks and shapes from
> v0.7 and earlier are removed.

---

## 1. Design Goals & Non‑Goals

### 1.1 Goals

1. **Small, boring core**
   - A minimal, well‑typed `HttpClient` with built‑in resilience, metrics hooks,
     and a single extension mechanism (interceptors).

2. **Zero external deps by default**
   - All packages are usable with:
     - global `fetch` in browsers/edge, or
     - a tiny fetch polyfill in Node.
   - No required Redis, OTEL, or queue dependencies; those plug in via
     interfaces.

3. **Single interceptor model**
   - Interceptors are the *only* way to customize requests/responses:
     - Auth, logging, tracing, caching, policies, guardrails, test transport
       recording/replay, etc.

4. **Classification‑driven resilience**
   - Retries and backoff controlled by:
     - `ResilienceProfile` (per request), and
     - `ErrorClassifier` → `ErrorCategory` + `FallbackHint`.

5. **Telemetry‑first**
   - Every logical request emits a `RequestOutcome` and a `MetricsRequestInfo`.
   - Optional tracing spans can be created around each logical request.

6. **First‑class AI & multi‑tenant semantics**
   - `AgentContext` + `extensions` carry agent/tenant/AI metadata.
   - Policies and guardrails can base decisions on client, tenant, provider,
     model, and request class.

7. **Testable & agent‑friendly**
   - A dedicated testing package with record/replay transports and a
     `createTestHttpClient` helper.
   - Agent‑focused runtime that composes core + OpenAI + conversation +
     guardrails + policies into a simple factory.

8. **Self‑contained for coding agents**
   - This spec alone should be enough for a senior engineer or coding agent to
     implement the entire ecosystem from scratch.

### 1.2 Non‑Goals

1. **Shipping infra backends**
   - We define `PolicyStore`, but do not prescribe Redis/SQL schemas.

2. **Full provider zoo**
   - Only OpenAI‑style LLM HTTP is specified; other providers can follow the
     same patterns.

3. **Domain‑specific business rules**
   - Sector-specific rules (finance, media, healthcare) live outside this
     ecosystem.

---

## 2. Package Overview & Dependency Graph

### 2.1 Packages

- **Core**
  - `@airnub/resilient-http-core` – HttpClient, resilience, interceptors,
    metrics, tracing, caching.

- **Satellites**
  - `@airnub/resilient-http-policies` – policy engine, stores, and interceptor.
  - `@airnub/resilient-http-pagination` – pagination helpers.
  - `@airnub/agent-conversation-core` – abstract conversation & agent runtime
    primitives.
  - `@airnub/http-llm-openai` – OpenAI(-compatible) client built on core.
  - `@airnub/agent-browser-guardrails` – outbound HTTP and navigation guardrails.

- **Testing & Runtime Composition**
  - `@airnub/resilient-http-testing` – recording/replay transports and
    test-friendly HttpClient factories.
  - `@airnub/agent-runtime` – opinionated agent runtime factory wiring together
    core, OpenAI client, policies, guardrails, and conversation core.

### 2.2 Dependency Graph

- `@airnub/resilient-http-core`
  - No runtime deps on other ecosystem packages.

- `@airnub/resilient-http-policies`
  - Depends on core types and interceptor interfaces.

- `@airnub/resilient-http-pagination`
  - Depends on core `HttpClient`.

- `@airnub/agent-conversation-core`
  - Independent (no HttpClient dependency).

- `@airnub/http-llm-openai`
  - Depends on core `HttpClient` and conversation types for the ProviderAdapter.

- `@airnub/agent-browser-guardrails`
  - Depends on core interceptor types and AgentContext.

- `@airnub/resilient-http-testing`
  - Depends on core `HttpTransport`, `HttpClient`, and metrics types.

- `@airnub/agent-runtime`
  - Depends on:
    - core `HttpClient`
    - policies, guardrails (optional)
    - conversation core
    - OpenAI client

---

## 3. Core Concepts

### 3.1 Logical request vs attempt

- **Logical request:** one call to `HttpClient.request*`.
- **Attempt:** one actual HTTP round trip.

A logical request may contain multiple attempts due to retries. Metrics and
`RequestOutcome` are defined at the logical-request level.

### 3.2 Operations

- Stable string identifiers for logical operations, e.g.
  - `"sec.getIssuerFilings"`
  - `"openai.responses.create"`.

Operations group metrics, policies, and guardrails.

### 3.3 Correlation & AgentContext

- **CorrelationInfo**: `requestId`, `correlationId`, `parentCorrelationId`.
- **AgentContext**: describes the *caller*:
  - `agentName`, `agentVersion`
  - `tenantId`, `sessionId`, `userId`
  - `requestClass`: `"interactive" | "background" | "batch"`.

### 3.4 Extensions & AI metadata

- `extensions: Record<string, unknown>` carries arbitrary metadata.
- Standardised key patterns (recommended, not enforced):
  - `ai.provider` – `"openai"`, `"anthropic"`, etc.
  - `ai.model` – model identifier.
  - `ai.operation` – provider operation name.
  - `ai.tool` – tool/function name.
  - `tenant.tier` – `"free" | "pro" | ...`.

### 3.5 Budget hints

A shared structure used by core, policies, and conversation engines.

```ts
export interface BudgetHints {
  /** Maximum tokens to consume (input + output) for this logical request. */
  maxTokens?: number;

  /** Approximate per-token cost and budget limit, for policies/metrics. */
  tokenCostCents?: number;
  maxCostCents?: number;

  /** Maximum requests allowed in a group (e.g., for bulk operations). */
  maxRequests?: number;

  /** Arbitrary numeric hints for policy/agent decisions. */
  attributes?: Record<string, number>;
}
```

Core attaches `BudgetHints` as `budget?: BudgetHints` on `HttpRequestOptions`.
Conversation-core uses the same shape to express conversation-level budgets.

### 3.6 ResilienceProfile

`ResilienceProfile` describes how to retry, backoff, and time out a logical
request.

```ts
export interface ResilienceProfile {
  maxAttempts?: number;          // Default: 3
  retryEnabled?: boolean;        // Default: true

  perAttemptTimeoutMs?: number;  // Default: undefined (no per-attempt limit)
  overallTimeoutMs?: number;     // Default: 30_000

  baseBackoffMs?: number;        // Default: 200
  maxBackoffMs?: number;         // Default: 2_000
  jitterFactor?: number;         // Default: 0.2 (20% jitter)

  retryIdempotentMethodsByDefault?: boolean;  // Default: true
  maxSuggestedRetryDelayMs?: number;          // Default: 60_000
}
```

---

## 4. Core API – `@airnub/resilient-http-core`

### 4.1 Basic Types

```ts
export type HttpMethod =
  | "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

export type HttpHeaders = Record<string, string>;

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface UrlParts {
  baseUrl?: string;   // e.g. "https://api.example.com"
  path?: string;      // e.g. "/v1/items"
  query?: QueryParams;
}
```

### 4.2 Correlation, AgentContext, Extensions

```ts
export interface CorrelationInfo {
  requestId?: string;
  correlationId?: string;
  parentCorrelationId?: string;
}

export type RequestClass = "interactive" | "background" | "batch";

export interface AgentContext {
  agentName?: string;
  agentVersion?: string;
  tenantId?: string;
  requestClass?: RequestClass;
  sessionId?: string;
  userId?: string;
}

export type Extensions = Record<string, unknown>;
```

### 4.3 Error Model & Classification

```ts
export type ErrorCategory =
  | "auth"
  | "validation"
  | "quota"
  | "rate_limit"
  | "timeout"
  | "transient"
  | "network"
  | "canceled"
  | "none"
  | "unknown";

export interface FallbackHint {
  retryAfterMs?: number;
  retryable?: boolean;
  hint?: string;
}

export interface ClassifiedError {
  category: ErrorCategory;
  statusCode?: number;
  reason?: string;
  fallback?: FallbackHint;
}

export interface ErrorClassifierContext {
  method: HttpMethod;
  url: string;
  attempt: number;
  request: HttpRequestOptions;
  response?: RawHttpResponse;
  error?: unknown;
}

export interface ErrorClassifier {
  classify(ctx: ErrorClassifierContext): ClassifiedError;
}

export class HttpError extends Error {
  readonly category: ErrorCategory;
  readonly statusCode?: number;
  readonly url: string;
  readonly method: HttpMethod;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly operation?: string;
  readonly attemptCount: number;
  readonly outcome?: RequestOutcome;

  constructor(message: string, options: {
    category: ErrorCategory;
    statusCode?: number;
    url: string;
    method: HttpMethod;
    requestId?: string;
    correlationId?: string;
    operation?: string;
    attemptCount: number;
    outcome?: RequestOutcome;
    cause?: unknown;
  });
}

export class TimeoutError extends HttpError {}
```

### 4.4 Transport Abstraction

```ts
export interface RawHttpResponse {
  status: number;
  headers: HttpHeaders;
  body: ArrayBuffer;
}

export interface TransportRequest {
  method: HttpMethod;
  url: string;
  headers: HttpHeaders;
  body?: ArrayBuffer;
}

export interface HttpTransport {
  (req: TransportRequest, signal: AbortSignal): Promise<RawHttpResponse>;
}
```

Default transport uses global `fetch`.

### 4.5 Request, Response & Outcome

```ts
export interface HttpRequestOptions {
  method: HttpMethod;

  url?: string;
  urlParts?: UrlParts;  // exactly one of url or urlParts must be provided

  headers?: HttpHeaders;
  query?: QueryParams;

  body?: unknown;       // encoded by body serialization interceptor

  operation?: string;

  correlation?: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;

  resilience?: ResilienceProfile;
  budget?: BudgetHints;

  cacheMode?: "default" | "bypass" | "refresh";
  cacheKey?: string;

  /** Optional idempotency key; recommended for POST/PUT/PATCH. */
  idempotencyKey?: string;
}

export interface RateLimitFeedback {
  remainingRequests?: number;
  limitRequests?: number;
  resetAt?: Date;

  remainingTokens?: number;
  limitTokens?: number;
  tokenResetAt?: Date;

  raw?: Record<string, string>;
}

export interface RequestOutcome {
  ok: boolean;
  status?: number;
  category: ErrorCategory;
  attempts: number;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  statusFamily?: number;
  errorMessage?: string;
  rateLimit?: RateLimitFeedback;
}

export interface HttpResponse<TBody = unknown> {
  status: number;
  headers: HttpHeaders;
  body: TBody;
  outcome: RequestOutcome;
}
```

### 4.6 Interceptors

```ts
export interface BeforeSendContext {
  request: HttpRequestOptions;
  attempt: number;
  signal: AbortSignal;
}

export interface AfterResponseContext<TBody = unknown> {
  request: HttpRequestOptions;
  attempt: number;
  response: HttpResponse<TBody>;
}

export interface OnErrorContext {
  request: HttpRequestOptions;
  attempt: number;
  error: HttpError | Error;
}

export interface HttpRequestInterceptor {
  beforeSend?(ctx: BeforeSendContext): Promise<void> | void;

  afterResponse?<TBody = unknown>(
    ctx: AfterResponseContext<TBody>
  ): Promise<void> | void;

  onError?(ctx: OnErrorContext): Promise<void> | void;
}
```

Interceptors run in registration order for `beforeSend` and reverse order for
`afterResponse`/`onError`.

Interceptors **must not** implement their own retry loops.

### 4.7 Caching

```ts
export interface HttpCacheEntry<T = unknown> {
  value: T;
  expiresAt: number; // epoch millis
}

export interface HttpCache {
  get<T = unknown>(key: string): Promise<HttpCacheEntry<T> | undefined>;
  set<T = unknown>(key: string, entry: HttpCacheEntry<T>): Promise<void>;
  delete?(key: string): Promise<void>;
}
```

Core only defines the interface and simple semantics; in-memory implementation
is optional.

### 4.8 Metrics & Tracing

```ts
export interface MetricsRequestInfo {
  operation?: string;
  method: HttpMethod;
  url: string;
  correlation?: CorrelationInfo;
  agentContext?: AgentContext;
  extensions?: Extensions;
  outcome: RequestOutcome;
}

export interface MetricsSink {
  recordRequest(info: MetricsRequestInfo): void | Promise<void>;
}

export interface TracingSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  recordException(error: Error): void;
}

export interface TracingAdapter {
  startSpan(info: MetricsRequestInfo): TracingSpan | undefined;
  endSpan(span: TracingSpan, outcome: RequestOutcome): void | Promise<void>;
}
```

### 4.9 HttpClientConfig & HttpClient

```ts
export interface HttpClientConfig {
  baseUrl?: string;
  transport?: HttpTransport;
  defaultHeaders?: HttpHeaders;
  defaultExtensions?: Extensions;
  defaultResilience?: ResilienceProfile;
  cache?: HttpCache;
  metricsSink?: MetricsSink;
  tracingAdapter?: TracingAdapter;
  interceptors?: HttpRequestInterceptor[];
  errorClassifier?: ErrorClassifier;
}

export class HttpClient {
  constructor(config?: HttpClientConfig);

  requestRaw<T = unknown>(opts: HttpRequestOptions): Promise<HttpResponse<T>>;

  requestJson<T = unknown>(opts: HttpRequestOptions): Promise<HttpResponse<T>>;

  requestJsonBody<T = unknown>(opts: HttpRequestOptions): Promise<T>;

  getJson<T = unknown>(
    urlOrParts: string | UrlParts,
    opts?: Omit<HttpRequestOptions, "method" | "url" | "urlParts">
  ): Promise<T>;

  // Additional convenience methods: postJson, putJson, deleteJson, etc.
}
```

Implementation requirements:

- Enforce `url` XOR `urlParts`.
- Resolve `UrlParts` into a full URL.
- Merge default headers and extensions.
- Merge `ResilienceProfile` layers (client defaults + request overrides).
- Generate `requestId` and `correlationId` if missing.
- Implement a single retry loop with per-attempt and overall timeouts.
- Use `ErrorClassifier` to classify failures and decide retry.
- Use cache when configured and `cacheMode` is not `"bypass"`.
- Emit metrics/tracing once per logical request.

### 4.10 Default Client Factory

```ts
export interface DefaultClientOptions {
  baseUrl?: string;
  enableConsoleLogging?: boolean; // default: false
}

export function createDefaultHttpClient(
  options?: DefaultClientOptions
): HttpClient;
```

Requirements:

- Uses fetch-based transport with sensible defaults.
- Configures sane resilience defaults (as described in ResilienceProfile).
- Uses a built-in classifier that:
  - Maps 429 → `rate_limit` (retryable with `retryAfterMs`).
  - Maps 5xx (except 501/505) → `transient`.
  - Maps 4xx auth errors → `auth`; other 4xx → `validation`.
- If `enableConsoleLogging` is true, attaches a console logging interceptor and
  a simple metrics sink that logs request outcomes.

### 4.11 Standard Interceptors (Recommended)

Core includes **recommended** interceptors as separate exports:

```ts
export interface AuthInterceptorOptions {
  getToken: () => Promise<string | null> | string | null;
  headerName?: string; // default: "Authorization"
  formatToken?: (token: string) => string; // default: (t) => `Bearer ${t}`
}

export function createAuthInterceptor(
  opts: AuthInterceptorOptions
): HttpRequestInterceptor;

export interface JsonBodyInterceptorOptions {
  defaultContentType?: string; // default: "application/json"
}

export function createJsonBodyInterceptor(
  opts?: JsonBodyInterceptorOptions
): HttpRequestInterceptor;

export interface IdempotencyInterceptorOptions {
  headerName?: string; // default: "Idempotency-Key"
}

export function createIdempotencyInterceptor(
  opts?: IdempotencyInterceptorOptions
): HttpRequestInterceptor;
```

These interceptors are optional but codified to address auth and body
serialization concerns in a standard way.

---

## 5. Policies – `@airnub/resilient-http-policies` v0.4.0

### 5.1 Policy Model

```ts
export interface PolicyScope {
  clientName?: string;
  operation?: string;
  method?: HttpMethod;
  tenantId?: string;
  requestClass?: RequestClass;
  aiProvider?: string;
  aiModel?: string;
}

export type PolicyEffect = "allow" | "deny";

export interface RateLimitRule {
  requestsPerInterval?: number;
  intervalMs?: number;
  tokensPerInterval?: number;
  tokenIntervalMs?: number;
}

export interface ConcurrencyRule {
  maxConcurrent?: number;
  maxQueueSize?: number; // 0 = no queue
}

export interface ResilienceOverride {
  maxAttempts?: number;
  perAttemptTimeoutMs?: number;
  overallTimeoutMs?: number;
}

export interface PolicyDefinition {
  id: string;
  description?: string;
  match: PolicyScope & { operationPattern?: string };
  effect: PolicyEffect;
  rateLimit?: RateLimitRule;
  concurrency?: ConcurrencyRule;
  resilienceOverride?: ResilienceOverride;
  denyMessage?: string;
}

export interface PolicyDecision {
  effect: PolicyEffect;
  policyId?: string;
  reason?: string;
  delayBeforeSendMs?: number;
  resilienceOverride?: ResilienceOverride;
}

export interface PolicyRequestContext {
  scope: PolicyScope;
  request: HttpRequestOptions;
}

export interface PolicyResultContext {
  scope: PolicyScope;
  request: HttpRequestOptions;
  outcome: RequestOutcome;
}

export interface PolicyEngine {
  evaluate(ctx: PolicyRequestContext): Promise<PolicyDecision>;
  onResult?(ctx: PolicyResultContext): Promise<void> | void;
}
```

### 5.2 PolicyStore Abstraction

```ts
export interface PolicyStore {
  getPolicies(): Promise<PolicyDefinition[]>;
  putPolicies(policies: PolicyDefinition[]): Promise<void>;

  // Optional fine-grained methods
  addPolicy?(policy: PolicyDefinition): Promise<void>;
  removePolicy?(id: string): Promise<void>;
}
```

The in-memory engine can keep policies directly in memory; a more advanced
engine can load policies from a `PolicyStore` backed by Redis/SQL/etc.

### 5.3 In-memory PolicyEngine

```ts
export interface InMemoryPolicyEngineOptions {
  policies: PolicyDefinition[];
  failOpenOnError?: boolean; // default: true
}

export function createInMemoryPolicyEngine(
  options: InMemoryPolicyEngineOptions
): PolicyEngine;
```

### 5.4 Policy Interceptor

```ts
export interface PolicyInterceptorOptions {
  engine: PolicyEngine;
  clientName: string;
}

export function createPolicyInterceptor(
  options: PolicyInterceptorOptions
): HttpRequestInterceptor;
```

Behaviour:

- `beforeSend`:
  - Derives `PolicyScope` from `HttpRequestOptions`.
  - Calls `engine.evaluate`.
  - On deny → throws `HttpError` with `quota` or `rate_limit` category.
  - On `delayBeforeSendMs` → awaits.
  - On `resilienceOverride` → merges into `request.resilience`.

- `afterResponse` / `onError`:
  - Calls `engine.onResult` with final `RequestOutcome`.

### 5.5 Policy Presets

```ts
export function createSimpleRateLimitPolicy(opts: {
  clientName: string;
  requestsPerMinute: number;
}): PolicyDefinition;

export function createSimpleConcurrencyPolicy(opts: {
  clientName: string;
  maxConcurrent: number;
  maxQueueSize?: number;
}): PolicyDefinition;
```

---

## 6. Pagination – `@airnub/resilient-http-pagination` v0.4.0

```ts
export interface PaginationLimits {
  maxPages?: number;
  maxItems?: number;
  maxDurationMs?: number;
}

export interface Page<TItem> {
  items: TItem[];
  rawResponse: HttpResponse<unknown>;
}

export interface PaginationResult<TItem> {
  pages: Page<TItem>[];
  totalItems: number;
  truncated: boolean;
  truncatedReason?: "maxPages" | "maxItems" | "maxDuration";
  durationMs: number;
}

export interface PaginateOptions<TItem> {
  client: HttpClient;
  initialRequest: HttpRequestOptions;
  extractItems: (response: HttpResponse<unknown>) => TItem[];
  getNextRequest: (
    prevRequest: HttpRequestOptions,
    prevResponse: HttpResponse<unknown>,
    pageIndex: number
  ) => HttpRequestOptions | undefined;
  limits?: PaginationLimits;
}

export async function paginate<TItem>(
  options: PaginateOptions<TItem>
): Promise<PaginationResult<TItem>>;

export async function* paginateStream<TItem>(
  options: PaginateOptions<TItem>
): AsyncGenerator<Page<TItem>, PaginationResult<TItem>, void>;
```

### 6.1 Strategy Helpers

```ts
export function createOffsetLimitStrategy(
  pageSize: number
): {
  initial: HttpRequestOptions;
  getNextRequest: PaginateOptions<unknown>["getNextRequest"];
};

export function createCursorStrategy(
  cursorParamName: string,
  extractCursor: (response: HttpResponse<unknown>) => string | undefined
): {
  initial: HttpRequestOptions;
  getNextRequest: PaginateOptions<unknown>["getNextRequest"];
};
```

---

## 7. Conversation Core – `@airnub/agent-conversation-core` v0.3.0

### 7.1 Types

```ts
export type Role = "user" | "assistant" | "system" | "tool" | "function";

export interface MessagePart {
  type: "text" | "tool-call" | "tool-result";
  text?: string;
  toolCall?: ProviderToolCall;
  toolResult?: unknown;
}

export interface ConversationMessage {
  id: string;
  role: Role;
  parts: MessagePart[];
  createdAt: Date;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ProviderCallRecord {
  provider: string;
  model: string;
  operation: string;
  startedAt: Date;
  finishedAt: Date;
  usage?: TokenUsage;
  rawResponse?: unknown;
}

export interface ConversationTurn {
  id: string;
  messages: ConversationMessage[];
  providerCalls: ProviderCallRecord[];
  createdAt: Date;
}

export interface Conversation {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### 7.2 Store & History

```ts
export interface ConversationStore {
  getConversation(id: string): Promise<Conversation | null>;
  createConversation(initial?: Partial<Conversation>): Promise<Conversation>;
  appendTurn(conversationId: string, turn: ConversationTurn): Promise<void>;
  listTurns(conversationId: string): Promise<ConversationTurn[]>;
}

export interface HistoryBudget extends BudgetHints {
  maxMessages?: number;
  maxTurns?: number;
}

export interface HistoryBuilder {
  buildHistory(
    conversationId: string,
    store: ConversationStore,
    budget?: HistoryBudget
  ): Promise<ConversationMessage[]>;
}

export class RecentNTurnsHistoryBuilder implements HistoryBuilder {
  constructor(maxTurns: number);
  buildHistory(
    conversationId: string,
    store: ConversationStore,
    budget?: HistoryBudget
  ): Promise<ConversationMessage[]>;
}
```

### 7.3 ProviderAdapter & Engine

```ts
export interface ProviderAdapterConfig {
  provider: string;
  model: string;
}

export interface ProviderToolDefinition {
  name: string;
  description?: string;
  jsonSchema: unknown;
}

export interface ProviderCallInput {
  systemMessages: ConversationMessage[];
  history: ConversationMessage[];
  userMessage: ConversationMessage;
  tools?: ProviderToolDefinition[];
  budget?: BudgetHints;
}

export interface ProviderCallResult {
  messages: ConversationMessage[];
  usage?: TokenUsage;
  rawResponse?: unknown;
}

export interface ProviderAdapter {
  complete(
    config: ProviderAdapterConfig,
    input: ProviderCallInput
  ): Promise<ProviderCallResult>;

  completeStream?(
    config: ProviderAdapterConfig,
    input: ProviderCallInput
  ): AsyncGenerator<ProviderCallResult, ProviderCallResult, void>;
}

export interface ConversationEngineConfig {
  store: ConversationStore;
  historyBuilder: HistoryBuilder;
  provider: ProviderAdapter;
  defaultModel: string;
  defaultProvider?: string;
}

export class ConversationEngine {
  constructor(config: ConversationEngineConfig);

  processTurn(
    conversationId: string | null,
    userMessage: Omit<ConversationMessage, "id" | "createdAt">,
    opts?: { model?: string; tools?: ProviderToolDefinition[]; budget?: HistoryBudget }
  ): Promise<{ conversationId: string; turn: ConversationTurn }>;

  processTurnStream(
    conversationId: string | null,
    userMessage: Omit<ConversationMessage, "id" | "createdAt">,
    opts?: { model?: string; tools?: ProviderToolDefinition[]; budget?: HistoryBudget }
  ): AsyncGenerator<
    { conversationId: string; partialTurn: ConversationTurn },
    { conversationId: string; turn: ConversationTurn },
    void
  >;
}
```

---

## 8. OpenAI HTTP Client – `@airnub/http-llm-openai` v0.3.0

```ts
export interface OpenAIHttpClientConfig {
  httpClient: HttpClient;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

export interface OpenAIResponsesCreateInput {
  model?: string;
  input: unknown;
  tools?: ProviderToolDefinition[];
  maxOutputTokens?: number;
  temperature?: number;
  [key: string]: unknown;
}

export interface OpenAIResponseObject {
  id: string;
  model: string;
  createdAt: Date;
  outputText?: string;
  messages: ConversationMessage[];
  toolCalls?: ProviderToolCall[];
  usage?: TokenUsage;
  rawResponse: unknown;
}

export interface OpenAIStreamEvent {
  type: "text-delta" | "tool-call" | "done";
  textDelta?: string;
  toolCall?: ProviderToolCall;
  finalResponse?: OpenAIResponseObject;
}

export interface OpenAIStream {
  [Symbol.asyncIterator](): AsyncIterator<OpenAIStreamEvent>;
  final: Promise<OpenAIResponseObject>;
}

export class OpenAIHttpClient {
  constructor(config: OpenAIHttpClientConfig);

  responses: {
    create(input: OpenAIResponsesCreateInput): Promise<OpenAIResponseObject>;
    createStream(input: OpenAIResponsesCreateInput): Promise<OpenAIStream>;
  };
}

export function createOpenAIProviderAdapter(
  client: OpenAIHttpClient
): ProviderAdapter;
```

Implementation notes:

- Use `HttpClient` with `operation = "openai.responses.create"`.
- Set `extensions["ai.provider"] = "openai"`, `extensions["ai.model"] = model`.
- Map raw responses into `OpenAIResponseObject` consistently for streaming and
  non-streaming.

---

## 9. Browser Guardrails – `@airnub/agent-browser-guardrails` v0.3.0

```ts
export interface GuardrailScope {
  method: HttpMethod;
  url: string;
  agentContext?: AgentContext;
  extensions?: Extensions;
}

export type GuardrailEffect = "allow" | "deny";

export interface HeaderGuardConfig {
  stripHeaders?: string[];
}

export interface BodyGuardConfig {
  maxBodyBytes?: number;
}

export interface GuardrailRule {
  id: string;
  description?: string;
  hostPattern?: string;
  protocol?: "http" | "https";
  methods?: HttpMethod[];
  agentName?: string;
  tenantId?: string;
  effect: GuardrailEffect;
  headers?: HeaderGuardConfig;
  body?: BodyGuardConfig;
}

export interface GuardrailDecision {
  effect: GuardrailEffect;
  ruleId?: string;
  reason?: string;
  headersToStrip?: string[];
}

export interface GuardrailEngine {
  evaluate(scope: GuardrailScope): GuardrailDecision;
}

export interface InMemoryGuardrailEngineOptions {
  rules: GuardrailRule[];
  defaultEffect?: GuardrailEffect; // default: "deny"
}

export function createInMemoryGuardrailEngine(
  opts: InMemoryGuardrailEngineOptions
): GuardrailEngine;

export interface GuardrailInterceptorOptions {
  engine: GuardrailEngine;
}

export function createHttpGuardrailInterceptor(
  options: GuardrailInterceptorOptions
): HttpRequestInterceptor;

export interface BrowserNavigationGuard {
  checkNavigation(
    url: string,
    ctx?: { agent?: AgentContext; extensions?: Extensions }
  ): void;
}

export function createBrowserNavigationGuard(
  engine: GuardrailEngine
): BrowserNavigationGuard;

export interface DefaultGuardrailOptions {
  allowInternalHosts?: string[];  // e.g. ["api.myapp.local"]
  allowReadOnlyWeb?: boolean;     // if true, allow GET/HEAD to https hosts
}

export function createDefaultGuardrailEngine(
  opts?: DefaultGuardrailOptions
): GuardrailEngine;
```

---

## 10. Testing – `@airnub/resilient-http-testing` v0.1.0

### 10.1 Recording & Replay Transports

```ts
export interface RecordedRequest {
  request: TransportRequest;
  response: RawHttpResponse;
}

export interface RecordingTransportOptions {
  underlying: HttpTransport;
  onRecord: (entry: RecordedRequest) => void | Promise<void>;
}

export function createRecordingTransport(
  opts: RecordingTransportOptions
): HttpTransport;

export interface ReplayTransportOptions {
  recordings: RecordedRequest[];
  match?: (req: TransportRequest, rec: RecordedRequest) => boolean;
}

export function createReplayTransport(
  opts: ReplayTransportOptions
): HttpTransport;
```

### 10.2 Test HttpClient Factory

```ts
export interface TestHttpClientOptions {
  baseUrl?: string;
  recordings?: RecordedRequest[];
  recordNew?: boolean;
  seed?: string; // for deterministic IDs
}

export function createTestHttpClient(
  opts?: TestHttpClientOptions
): { client: HttpClient; recordings: RecordedRequest[] };
```

Requirements:

- No retries by default (maxAttempts = 1) to keep tests deterministic.
- Deterministic `requestId` generation based on `seed`.
- In replay mode, throw if a matching recording is not found.

---

## 11. Opinionated Agent Runtime – `@airnub/agent-runtime` v0.1.0

### 11.1 Purpose

Provide a one-call runtime factory for typical agentic apps that want:

- Resilient HttpClient
- OpenAI client
- Policies
- Guardrails
- Conversation engine

### 11.2 Types & Factory

```ts
export interface AgentRuntimeConfig {
  openai: {
    apiKey: string;
    baseUrl?: string;   // default: "https://api.openai.com/v1"
    defaultModel: string;
  };

  policies?: {
    definitions?: PolicyDefinition[];
  };

  guardrails?: DefaultGuardrailOptions;

  history?: {
    maxTurns?: number;
  };
}

export interface AgentRuntime {
  httpClient: HttpClient;
  openaiClient: OpenAIHttpClient;
  conversationEngine: ConversationEngine;
  guardrails: GuardrailEngine;
  policyEngine: PolicyEngine;
}

export function createDefaultAgentRuntime(
  config: AgentRuntimeConfig
): AgentRuntime;
```

Implementation guidelines:

- Use `createDefaultHttpClient` for httpClient.
- Use `createInMemoryPolicyEngine` with given definitions (or empty).
- Wrap httpClient with `createPolicyInterceptor` and `createHttpGuardrailInterceptor`.
- Create `OpenAIHttpClient` and `createOpenAIProviderAdapter`.
- Use an in-memory ConversationStore (simple array-based) and
  `RecentNTurnsHistoryBuilder`.

---

## 12. Implementation Checklist

A library is v0.8-compliant when:

1. Core HttpClient and all related types are implemented per this spec.
2. Default client factory behaves as specified.
3. Standard interceptors (auth/json/idempotency) exist.
4. Policies, pagination, conversation core, OpenAI client, and guardrails match
   their sections.
5. Testing helpers (record/replay, test client) are present.
6. Agent runtime factory is implemented and composes the ecosystem correctly.
7. TypeScript builds under `strict: true`.
8. Tests cover retry, timeouts, classification, caching, policies, guardrails,
   pagination, conversation engine, OpenAI mapping, testing transports, and
   agent runtime wiring.

This v0.8 spec is self-contained and suitable as a single source of truth for
building the entire resilient HTTP ecosystem and runtime from scratch.

