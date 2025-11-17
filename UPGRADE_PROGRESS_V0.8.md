# Resilient HTTP v0.8 Upgrade Progress

## Summary

This document tracks the progress of upgrading the Resilient HTTP ecosystem from v0.7 to v0.8 according to the full evolution spec at `docs/specs/resilient_http_core_spec_v_0_8.md`.

## Completed

### ✅ Phase 1: resilient-http-core v0.8.0

**Package:** `@airnub/resilient-http-core`
**Status:** Fully upgraded to v0.8.0

#### Changes Made:

1. **types.ts** - Completely rewritten to v0.8 spec:
   - Replaced `RequestBudget` with `BudgetHints`
   - Updated `ErrorCategory` to remove deprecated categories (`not_found`, `safety`, `quota_exceeded`, `server`)
   - Updated `ErrorClassifier` to use single `classify(ctx)` method instead of separate `classifyNetworkError`/`classifyResponse`
   - Updated `ClassifiedError` and `FallbackHint` to match spec
   - Updated `AgentContext` with new fields (`agentName`, `agentVersion`, `tenantId`, `requestClass`, `sessionId`, `userId`)
   - Added `HttpResponse<T>` type with embedded `RequestOutcome`
   - Added `RawHttpResponse` and `TransportRequest` types
   - Updated `HttpTransport` signature to `(req: TransportRequest, signal: AbortSignal): Promise<RawHttpResponse>`
   - Updated `HttpCache` to use `HttpCacheEntry<T>` with `expiresAt`
   - Updated `RequestOutcome` to include `category`, `durationMs`, `statusFamily`, etc.
   - Removed deprecated fields from `HttpRequestOptions` (`path`, `pageSize`, `pageOffset`, `idempotent`, `timeoutMs`, `maxRetries`, `cacheKey` with TTL, legacy correlation fields)
   - Added `cacheMode` and proper `cacheKey` support
   - Updated `ResilienceProfile` to match spec (removed legacy fields, added `jitterFactor`, `retryIdempotentMethodsByDefault`, `maxSuggestedRetryDelayMs`)
   - Updated `BeforeSendContext`, `AfterResponseContext`, `OnErrorContext` to match spec
   - Updated `MetricsRequestInfo`, `TracingSpan`, `TracingAdapter` to match spec
   - Updated `HttpClientConfig` to be minimal and clean

2. **fetchTransport.ts** - Updated to new signature:
   - Now accepts `TransportRequest` and `AbortSignal`
   - Returns `RawHttpResponse` with `ArrayBuffer` body
   - Converts Headers to plain object

3. **axiosTransport.ts** - Updated to new signature:
   - Marked as deprecated (favor fetch)
   - Updated to match new transport interface

4. **HttpClient.ts** - Complete rewrite for v0.8:
   - Returns `HttpResponse<T>` from all methods
   - Added `requestJsonBody<T>` convenience method
   - Added convenience methods: `getJson`, `postJson`, `putJson`, `deleteJson`
   - Implements proper url XOR urlParts validation
   - Updated error classification to use new `ErrorClassifier.classify(ctx)` method
   - Updated caching to use `HttpCacheEntry` with expiration
   - Removed `policyWrapper` support (use `@airnub/resilient-http-policies` instead)
   - Removed legacy hooks (`beforeRequest`/`afterResponse` at config level)
   - Simplified interceptor model (clean `BeforeSendContext`, `AfterResponseContext`, `OnErrorContext`)
   - Updated metrics/tracing to match new interfaces
   - Proper retry loop with per-attempt and overall timeouts
   - Exponential backoff with jitter
   - `HttpError` and `TimeoutError` constructors match spec
   - Default error classifier follows spec mapping

5. **interceptors.ts** - NEW FILE:
   - `createAuthInterceptor` - Pluggable token provider and header format
   - `createJsonBodyInterceptor` - JSON serialization and content-type
   - `createIdempotencyInterceptor` - Maps `idempotencyKey` to header

6. **index.ts** - Updated exports:
   - Clean v0.8 exports
   - Standard interceptors exported
   - Removed deprecated pagination exports

7. **package.json** - Updated to v0.8.0

8. **Removed deprecated files:**
   - `pagination.ts` (belongs in `@airnub/resilient-http-pagination`)
   - `__tests__/pagination.test.ts`

#### Migration Notes for Core v0.8:

- All methods now return `HttpResponse<T>` instead of just `T` or `Response`
- Use `requestJsonBody<T>()` if you only need the body (backward compatibility helper)
- `RequestBudget` → `BudgetHints` (rename your types)
- `ErrorClassifier` now has single `classify(ctx)` method
- No more `path`, `pageSize`, `pageOffset` on requests (use `url` or `urlParts` + separate pagination package)
- No more `policyWrapper` (use `@airnub/resilient-http-policies` with `createPolicyInterceptor`)
- `HttpCache.get/set` now uses `HttpCacheEntry<T>` with `expiresAt` (epoch millis)
- Interceptors are cleaner and well-typed

## Remaining Work

### 🔄 Phase 2: resilient-http-policies v0.4.0

**Package:** `@airnub/resilient-http-policies`
**Current Version:** v0.3.0
**Target Version:** v0.4.0

#### Required Changes:

- Update types to match v0.8 spec:
  - `PolicyScope`, `PolicyDefinition`, `PolicyDecision`
  - `RateLimitRule`, `ConcurrencyRule`, `ResilienceOverride`
  - `PolicyEngine`, `PolicyStore`
- Implement `createInMemoryPolicyEngine`
- Implement `createPolicyInterceptor`
- Implement policy presets: `createSimpleRateLimitPolicy`, `createSimpleConcurrencyPolicy`
- Update to use `BudgetHints` instead of `RequestBudget`
- Update to use new `HttpRequestOptions` and `RequestOutcome`

### 🔄 Phase 3: resilient-http-pagination v0.4.0

**Package:** `@airnub/resilient-http-pagination`
**Current Version:** v0.3.0
**Target Version:** v0.4.0

#### Required Changes:

- Update types to match v0.8 spec:
  - `PaginationResult`, `Page`, `PaginationLimits`
  - `PaginateOptions`, `paginate`, `paginateStream`
- Implement strategy helpers:
  - `createOffsetLimitStrategy`
  - `createCursorStrategy`
- Update to use `HttpResponse<T>` instead of raw responses
- Remove any dependency on core pagination hints

### 🔄 Phase 4: agent-conversation-core v0.3.0

**Package:** `@airnub/resilient-http-agent-conversation-core`
**Current Version:** v0.2.0
**Target Version:** v0.3.0

#### Required Changes:

- Update types to match v0.8 spec:
  - `ConversationMessage`, `MessagePart`, `ConversationTurn`, `Conversation`
  - `ProviderToolCall`, `ProviderCallRecord`, `TokenUsage`
  - `ConversationStore`, `HistoryBuilder`, `RecentNTurnsHistoryBuilder`
  - `ProviderAdapter`, `ConversationEngine`
- Implement `HistoryBudget` using `BudgetHints`
- Implement `processTurn` and `processTurnStream`

### 🔄 Phase 5: http-llm-openai v0.3.0

**Package:** `@airnub/resilient-http-llm-openai`
**Current Version:** (unknown)
**Target Version:** v0.3.0

#### Required Changes:

- Update types to match v0.8 spec:
  - `OpenAIHttpClientConfig`, `OpenAIResponsesCreateInput`, `OpenAIResponseObject`
  - `OpenAIStreamEvent`, `OpenAIStream`
- Implement `OpenAIHttpClient` using `HttpResponse<T>`
- Implement `createOpenAIProviderAdapter`
- Set `operation`, `extensions["ai.provider"]`, `extensions["ai.model"]` for all calls

### 🔄 Phase 6: agent-browser-guardrails v0.3.0

**Package:** `@airnub/resilient-http-agent-browser-guardrails`
**Current Version:** (unknown)
**Target Version:** v0.3.0

#### Required Changes:

- Update types to match v0.8 spec:
  - `GuardrailRule`, `GuardrailDecision`, `GuardrailEngine`
  - `BrowserNavigationGuard`
- Implement `createInMemoryGuardrailEngine`
- Implement `createHttpGuardrailInterceptor`
- Implement `createBrowserNavigationGuard`
- Implement `createDefaultGuardrailEngine`

### 🆕 Phase 7: resilient-http-testing v0.1.0 (NEW PACKAGE)

**Package:** `@airnub/resilient-http-testing`
**Status:** Does not exist, needs to be created

#### Required Implementation:

- Create package structure
- Implement `createRecordingTransport`
- Implement `createReplayTransport`
- Implement `createTestHttpClient` with:
  - Deterministic `requestId` generation based on `seed`
  - No retries by default (`maxAttempts = 1`)
  - Optional replay/record transports
- Implement types: `RecordedRequest`, `RecordingTransportOptions`, `ReplayTransportOptions`, `TestHttpClientOptions`

### 🆕 Phase 8: agent-runtime v0.1.0 (NEW PACKAGE)

**Package:** `@airnub/agent-runtime`
**Status:** Does not exist, needs to be created

#### Required Implementation:

- Create package structure
- Implement `createDefaultAgentRuntime` factory that wires together:
  - `HttpClient` via `createDefaultHttpClient`
  - `PolicyEngine` with `createInMemoryPolicyEngine` + `PolicyInterceptor`
  - `GuardrailEngine` via `createDefaultGuardrailEngine` + `HttpGuardrailInterceptor`
  - `OpenAIHttpClient`
  - In-memory `ConversationStore`
  - `RecentNTurnsHistoryBuilder`
  - `OpenAI` `ProviderAdapter` via `createOpenAIProviderAdapter`
  - `ConversationEngine`
- Implement types: `AgentRuntimeConfig`, `AgentRuntime`

### 🔄 Phase 9: Testing & Validation

- Update all tests to work with v0.8 changes
- Add new tests for v0.8 features
- Ensure TypeScript builds with `strict: true`
- Validate all packages work together

### 📝 Phase 10: Documentation & Commit

- Create `CHANGELOG_resilient_http_v0.8.md`
- Update README files as needed
- Commit all changes with descriptive messages

## Next Steps

1. **Continue with Phase 2** - Upgrade `@airnub/resilient-http-policies` to v0.4
2. **Work through Phases 3-6** - Upgrade remaining existing packages
3. **Create new packages** - Phases 7-8 for testing and runtime
4. **Test and validate** - Phase 9
5. **Document and commit** - Phase 10

## Important Notes

- The v0.8 spec is an **evolution of v0.7**, not a complete rewrite
- All changes follow `docs/specs/resilient_http_core_spec_v_0_8.md` as the single source of truth
- Core execution model (retry loop, resilience, metrics/tracing) is preserved
- All deprecated/legacy code paths from pre-v0.7 have been removed
- TypeScript strict mode is enforced

## Files Modified in Phase 1

- `libs/resilient-http-core/src/types.ts` - Complete rewrite
- `libs/resilient-http-core/src/HttpClient.ts` - Complete rewrite
- `libs/resilient-http-core/src/transport/fetchTransport.ts` - Updated signature
- `libs/resilient-http-core/src/transport/axiosTransport.ts` - Updated signature
- `libs/resilient-http-core/src/interceptors.ts` - NEW FILE
- `libs/resilient-http-core/src/index.ts` - Updated exports
- `libs/resilient-http-core/package.json` - Version bump to 0.8.0
- `libs/resilient-http-core/src/pagination.ts` - DELETED (moved to separate package)
- `libs/resilient-http-core/src/__tests__/pagination.test.ts` - DELETED

---

**Last Updated:** 2025-11-17
**Author:** Claude (Coding Agent)
**Spec Reference:** `docs/specs/resilient_http_core_spec_v_0_8.md`
