import OpenAI from 'openai';

/**
 * GPT-5 OpenAI Client Library
 *
 * This library uses the Responses API (https://api.openai.com/v1/responses)
 * which is the recommended way to use GPT-5 models.
 *
 * IMPORTANT: The Chat Completions API is DEPRECATED for GPT-5 models.
 * Do NOT use client.chat.completions.create() with GPT-5 models.
 *
 * @see https://platform.openai.com/docs/guides/responses
 */

// ============================================================================
// Types
// ============================================================================

export type GPT5Model =
  | 'gpt-5'              // Complex reasoning, broad world knowledge, code-heavy tasks
  | 'gpt-5-mini'         // Cost-optimized reasoning and chat
  | 'gpt-5-nano'         // High-throughput, simple instruction-following
  | 'gpt-5-chat-latest'; // Latest chat-optimized variant

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
export type Verbosity = 'low' | 'medium' | 'high';

export interface CustomTool {
  type: 'custom';
  name: string;
  description: string;
  grammar?: string; // Optional context-free grammar (Lark format)
}

export interface FunctionTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export type Tool = CustomTool | FunctionTool;

export interface AllowedToolsChoice {
  type: 'allowed_tools';
  mode: 'auto' | 'required';
  tools: Array<{ type: 'function'; name: string } | { type: 'custom'; name: string }>;
}

export interface E2BCodeExecutionConfig {
  enabled: boolean;
  sandboxId?: string;
  timeout?: number; // milliseconds
}

export interface ResponseCreateParams {
  model: GPT5Model;
  input: string | Array<{
    role: 'system' | 'user' | 'assistant';
    content: string | Array<{ type: 'text'; text: string }>;
  }>;
  reasoning?: {
    effort: ReasoningEffort;
  };
  text?: {
    verbosity: Verbosity;
  };
  max_output_tokens?: number;
  tools?: Tool[];
  tool_choice?: 'auto' | 'required' | AllowedToolsChoice;
  previous_response_id?: string; // For multi-turn conversations (passes CoT)
  e2b_execution?: E2BCodeExecutionConfig;
}

export interface ResponseItem {
  type: 'message' | 'tool_call' | 'reasoning';
  content?: string;
  tool_call?: {
    id: string;
    name: string;
    input: string | Record<string, unknown>;
  };
  reasoning?: string;
}

export interface ResponseResult {
  id: string;
  model: string;
  items: ResponseItem[];
  output_text: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens?: number;
  };
}

export interface OpenAIOptions {
  apiKey?: string;
}

// ============================================================================
// Client Factory
// ============================================================================

export function createOpenAIClient(options: OpenAIOptions = {}): OpenAI {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY missing');
  }
  return new OpenAI({ apiKey });
}

// ============================================================================
// Safeguards
// ============================================================================

/**
 * SAFEGUARD: Validates that deprecated parameters are not used
 * @throws Error if deprecated parameters are detected
 */
function validateNoDeprecatedParams(params: any): void {
  const deprecatedParams = ['temperature', 'top_p', 'logprobs'];
  const found = deprecatedParams.filter(param => param in params);

  if (found.length > 0) {
    throw new Error(
      `❌ DEPRECATED PARAMETERS DETECTED: ${found.join(', ')}\n\n` +
      `These parameters are NOT supported in GPT-5 models.\n` +
      `Instead use:\n` +
      `  - Reasoning depth: reasoning: { effort: "minimal" | "low" | "medium" | "high" }\n` +
      `  - Output verbosity: text: { verbosity: "low" | "medium" | "high" }\n` +
      `  - Output length: max_output_tokens\n\n` +
      `See: https://platform.openai.com/docs/guides/gpt-5`
    );
  }
}

/**
 * SAFEGUARD: Prevents using chat.completions API
 * This function throws an error to guide developers to use the Responses API
 */
export function preventDeprecatedChatCompletions(): never {
  throw new Error(
    `❌ DEPRECATED API: client.chat.completions.create() is DEPRECATED for GPT-5\n\n` +
    `Use the Responses API instead:\n` +
    `  - client.responses.create({ model: "gpt-5", input: "...", reasoning: { effort: "medium" } })\n\n` +
    `Migration guide:\n` +
    `  1. Replace chat.completions.create() with responses.create()\n` +
    `  2. Change "messages" parameter to "input"\n` +
    `  3. Remove temperature, top_p, logprobs\n` +
    `  4. Add reasoning.effort and text.verbosity\n\n` +
    `See: https://platform.openai.com/docs/guides/gpt-5/migration`
  );
}

// ============================================================================
// Main Response API
// ============================================================================

/**
 * Create a response using GPT-5 Responses API
 *
 * This is the RECOMMENDED way to use GPT-5 models.
 * Supports chain of thought, custom tools, and all GPT-5 features.
 *
 * @example
 * ```ts
 * const response = await createResponse({
 *   model: 'gpt-5-mini',
 *   input: 'Explain quantum computing',
 *   reasoning: { effort: 'low' },
 *   text: { verbosity: 'medium' }
 * });
 * console.log(response.output_text);
 * ```
 */
export async function createResponse(
  params: ResponseCreateParams,
  client?: OpenAI
): Promise<ResponseResult> {
  validateNoDeprecatedParams(params);

  const openai = client ?? createOpenAIClient();

  // Build request body
  const requestBody: any = {
    model: params.model,
    input: params.input,
  };

  if (params.reasoning) {
    requestBody.reasoning = params.reasoning;
  }

  if (params.text) {
    requestBody.text = params.text;
  }

  if (params.max_output_tokens) {
    requestBody.max_output_tokens = params.max_output_tokens;
  }

  if (params.tools && params.tools.length > 0) {
    requestBody.tools = params.tools;
  }

  if (params.tool_choice) {
    requestBody.tool_choice = params.tool_choice;
  }

  if (params.previous_response_id) {
    requestBody.previous_response_id = params.previous_response_id;
  }

  // Handle E2B code execution if enabled
  if (params.e2b_execution?.enabled) {
    requestBody.tools = requestBody.tools || [];

    // Add code execution custom tool
    requestBody.tools.push({
      type: 'custom',
      name: 'code_exec',
      description: 'Executes Python code in a sandboxed E2B environment. Returns stdout, stderr, and any generated output.',
    });
  }

  // Call the Responses API
  const response = await openai.post('/v1/responses', {
    body: requestBody,
  });

  const data = await response.json() as any;

  // Parse items
  const items: ResponseItem[] = (data.items || []).map((item: any) => {
    if (item.type === 'reasoning') {
      return { type: 'reasoning', reasoning: item.content };
    } else if (item.type === 'tool_call') {
      return {
        type: 'tool_call',
        tool_call: {
          id: item.id,
          name: item.name,
          input: item.input,
        },
      };
    } else {
      return { type: 'message', content: item.content };
    }
  });

  // Extract output text
  const messageItems = items.filter(item => item.type === 'message');
  const output_text = messageItems.map(item => item.content).join('\n').trim();

  return {
    id: data.id,
    model: data.model,
    items,
    output_text,
    usage: data.usage,
  };
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Simplified response creation for common use cases
 *
 * @example
 * ```ts
 * const text = await runResponse({
 *   model: 'gpt-5-mini',
 *   prompt: 'What is the capital of France?',
 *   effort: 'minimal',
 *   verbosity: 'low'
 * });
 * ```
 */
export async function runResponse(options: {
  client?: OpenAI;
  model?: GPT5Model;
  prompt: string;
  systemPrompt?: string;
  effort?: ReasoningEffort;
  verbosity?: Verbosity;
  maxTokens?: number;
  previousResponseId?: string;
}): Promise<string> {
  const input = options.systemPrompt
    ? [
        { role: 'system' as const, content: options.systemPrompt },
        { role: 'user' as const, content: options.prompt },
      ]
    : options.prompt;

  const response = await createResponse(
    {
      model: options.model ?? 'gpt-5-mini',
      input,
      reasoning: options.effort ? { effort: options.effort } : undefined,
      text: options.verbosity ? { verbosity: options.verbosity } : undefined,
      max_output_tokens: options.maxTokens,
      previous_response_id: options.previousResponseId,
    },
    options.client
  );

  return response.output_text;
}

/**
 * LEGACY WRAPPER: For backward compatibility with old runResponses() calls
 *
 * @deprecated Use createResponse() or runResponse() instead
 * This function maps old parameters to new GPT-5 Responses API
 */
export async function runResponses(options: {
  client?: OpenAI;
  input: {
    model: string;
    input: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string | Array<{ type: 'text'; text: string }>;
    }>;
    temperature?: number;
    max_tokens?: number;
  };
}): Promise<string> {
  const client = options.client ?? createOpenAIClient();

  // Warn about deprecated parameters
  if (options.input.temperature !== undefined) {
    console.warn(
      '⚠️  WARNING: temperature parameter is deprecated for GPT-5.\n' +
      '   It has been ignored. Use reasoning.effort instead.'
    );
  }

  // Map old model names to GPT-5
  let model: GPT5Model;
  let effort: ReasoningEffort;
  let verbosity: Verbosity;

  const oldModel = options.input.model.toLowerCase();

  if (oldModel.includes('gpt-4.1') || oldModel.includes('gpt-4-turbo')) {
    model = 'gpt-5-mini';
    effort = 'minimal';
    verbosity = 'medium';
  } else if (oldModel.includes('gpt-4') || oldModel.includes('o3')) {
    model = 'gpt-5';
    effort = 'medium';
    verbosity = 'medium';
  } else if (oldModel.includes('o4-mini') || oldModel.includes('gpt-4-mini')) {
    model = 'gpt-5-mini';
    effort = 'low';
    verbosity = 'medium';
  } else if (oldModel.includes('nano')) {
    model = 'gpt-5-nano';
    effort = 'minimal';
    verbosity = 'low';
  } else {
    // Default to gpt-5-mini for unknown models
    model = 'gpt-5-mini';
    effort = 'low';
    verbosity = 'medium';
  }

  const response = await createResponse(
    {
      model,
      input: options.input.input,
      reasoning: { effort },
      text: { verbosity },
      max_output_tokens: options.input.max_tokens,
    },
    client
  );

  return response.output_text;
}

// ============================================================================
// Model Selection Helpers
// ============================================================================

/**
 * Choose the appropriate GPT-5 model based on use case
 */
export function chooseModel(useCase: {
  complexity: 'simple' | 'medium' | 'complex';
  domain: 'code' | 'analysis' | 'chat' | 'classification';
  latency: 'critical' | 'normal' | 'flexible';
}): { model: GPT5Model; effort: ReasoningEffort; verbosity: Verbosity } {
  // High-throughput, simple tasks
  if (useCase.latency === 'critical' || useCase.complexity === 'simple') {
    return {
      model: 'gpt-5-nano',
      effort: 'minimal',
      verbosity: 'low',
    };
  }

  // Complex reasoning and code tasks
  if (useCase.complexity === 'complex' || useCase.domain === 'code') {
    return {
      model: 'gpt-5',
      effort: 'high',
      verbosity: 'high',
    };
  }

  // Default: cost-optimized for most tasks
  return {
    model: 'gpt-5-mini',
    effort: 'medium',
    verbosity: 'medium',
  };
}
