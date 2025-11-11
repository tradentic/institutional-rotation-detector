/**
 * @libs/openai-client
 *
 * Model-agnostic OpenAI client library with support for GPT-5, GPT-6 (future), and beyond.
 *
 * ## Architecture
 *
 * - **Core**: Model-agnostic abstractions (CoT sessions, E2B, types)
 * - **Models**: Model-specific implementations (gpt5/, gpt6/)
 * - **Factory**: Runtime model selection
 *
 * ## Usage
 *
 * ```typescript
 * import { createClient, CoTSession, runResponse } from '@libs/openai-client';
 *
 * // Option 1: Quick single-turn
 * const result = await runResponse({
 *   model: 'gpt-5-mini',
 *   prompt: 'Analyze...',
 *   effort: 'minimal'
 * });
 *
 * // Option 2: Multi-turn with CoT
 * const client = createClient({ model: 'gpt-5-mini' });
 * const session = new CoTSession({ client });
 * const r1 = await session.respond('Step 1...');
 * const r2 = await session.respond('Step 2...');
 * ```
 *
 * ## Future-Proof Design
 *
 * When GPT-6 is released, simply add `models/gpt6/client.ts` implementing `AIClient`.
 * All core logic (CoT, E2B, sessions) is reused automatically.
 */

// ============================================================================
// Primary API - Model-Agnostic Factory
// ============================================================================

export { createClient, type ClientConfig } from './factory.js';

// ============================================================================
// Core Types (Model-Agnostic)
// ============================================================================

export type {
  AIClient,
  ModelConfig,
  RequestParams,
  ResponseResult,
  ResponseItem,
  Message,
  ReasoningEffort,
  Verbosity,
  CustomTool,
  FunctionTool,
  Tool,
  AllowedToolsChoice,
  E2BCodeExecutionConfig,
} from './core/types.js';

// ============================================================================
// CoT Session Exports (Model-Agnostic)
// ============================================================================

export {
  CoTSession,
  createAnalysisSession,
  createCodeSession,
  createFastSession,
  restoreSession,
  type CoTSessionConfig,
  type CoTSessionState,
  type CoTTurn,
} from './core/session.js';

// ============================================================================
// E2B Code Execution (Explicit usage outside of tool calling)
// ============================================================================

export {
  executeCode,
  handleCodeExecutionToolCall,
  isE2BAvailable,
  getE2BStatus,
  type E2BExecutionResult,
  type E2BSandboxConfig,
} from './core/e2b.js';

// ============================================================================
// GPT-5 Specific Exports
// ============================================================================

export {
  GPT5Client,
  createGPT5Client,
  preventDeprecatedChatCompletions,
  runResponses, // Legacy compatibility
  chooseGPT5Model,
} from './models/gpt5/client.js';

export type { GPT5Model, GPT5Config } from './models/gpt5/types.js';

// ============================================================================
// Convenience Functions (Temporary - using GPT-5 directly)
// ============================================================================

import type { ReasoningEffort, Verbosity, ResponseResult, RequestParams } from './core/types.js';

/**
 * Quick single-turn response
 *
 * NOTE: Currently uses GPT-5 directly. Will be refactored to use factory.
 */
export async function runResponse(options: {
  model?: string;
  prompt: string;
  systemPrompt?: string;
  effort?: ReasoningEffort;
  verbosity?: Verbosity;
  maxTokens?: number;
  apiKey?: string;
}): Promise<string> {
  const { createGPT5Client } = await import('./models/gpt5/client.js');
  const client = createGPT5Client(options.model as any ?? 'gpt-5-mini', options.apiKey);

  const input = options.systemPrompt
    ? [
        { role: 'system' as const, content: options.systemPrompt },
        { role: 'user' as const, content: options.prompt },
      ]
    : options.prompt;

  const response = await client.createResponse({
    input,
    reasoning: options.effort ? { effort: options.effort } : undefined,
    text: options.verbosity ? { verbosity: options.verbosity } : undefined,
    max_output_tokens: options.maxTokens,
  });

  return response.output_text;
}

/**
 * Advanced response creation
 *
 * NOTE: Currently uses GPT-5 directly. Will be refactored to use factory.
 */
export async function createResponse(
  params: RequestParams & { model?: string; apiKey?: string }
): Promise<ResponseResult> {
  const { createGPT5Client } = await import('./models/gpt5/client.js');
  const { model, apiKey, ...requestParams } = params as any;
  const client = createGPT5Client(model ?? 'gpt-5-mini', apiKey);
  return client.createResponse(requestParams);
}
