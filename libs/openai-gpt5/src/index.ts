/**
 * @libs/openai-gpt5
 *
 * Shared OpenAI GPT-5 client library for all apps in the monorepo.
 *
 * This library provides:
 * - GPT-5 Responses API client (with safeguards against deprecated APIs)
 * - Chain of Thought (CoT) session management for multi-turn conversations
 * - E2B code execution integration
 * - Comprehensive TypeScript types
 *
 * Usage in any app:
 * ```typescript
 * import {
 *   runResponse,
 *   createResponse,
 *   CoTSession,
 *   createAnalysisSession,
 *   createCodeSession
 * } from '@libs/openai-gpt5';
 * ```
 *
 * @see docs/GPT5_MIGRATION_GUIDE.md
 * @see docs/COT_WORKFLOWS_GUIDE.md
 * @see docs/CODING_AGENT_GUIDELINES.md
 */

// ============================================================================
// OpenAI Client Exports
// ============================================================================

export {
  // Types
  type GPT5Model,
  type ReasoningEffort,
  type Verbosity,
  type CustomTool,
  type FunctionTool,
  type Tool,
  type AllowedToolsChoice,
  type E2BCodeExecutionConfig,
  type ResponseCreateParams,
  type ResponseItem,
  type ResponseResult,
  type OpenAIOptions,

  // Client factory
  createOpenAIClient,

  // Main API
  createResponse,
  runResponse,

  // Legacy compatibility
  runResponses,

  // Safeguards
  preventDeprecatedChatCompletions,

  // Utilities
  chooseModel,
} from './openai.js';

// ============================================================================
// Chain of Thought Session Exports
// ============================================================================

export {
  // Types
  type CoTSessionConfig,
  type CoTTurn,
  type CoTSessionState,

  // Main class
  CoTSession,

  // Factory functions
  createAnalysisSession,
  createCodeSession,
  createFastSession,

  // Utilities
  restoreSession,
} from './cot-session.js';

// ============================================================================
// E2B Code Execution Exports
// ============================================================================

export {
  // Types
  type E2BExecutionResult,
  type E2BSandboxConfig,

  // Main functions
  executeCode,
  handleCodeExecutionToolCall,

  // Utilities
  isE2BAvailable,
  getE2BStatus,
} from './e2b-executor.js';
