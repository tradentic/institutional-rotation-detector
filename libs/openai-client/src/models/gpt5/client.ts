/**
 * GPT-5 Client Implementation
 *
 * This is the GPT-5-specific implementation of the AIClient interface.
 * When GPT-6 is released, a similar gpt6/client.ts will be created.
 *
 * All core logic (CoT sessions, E2B) is model-agnostic and lives in /core.
 * This file only contains GPT-5-specific API calls and configurations.
 */

import OpenAI from 'openai';
import type {
  AIClient,
  ModelConfig,
  RequestParams,
  ResponseResult,
  ResponseItem,
} from '../../core/types.js';
import type { GPT5Model, GPT5Config } from './types.js';

/**
 * GPT-5 Client
 *
 * Implements the model-agnostic AIClient interface using GPT-5's Responses API.
 */
export class GPT5Client implements AIClient {
  private openai: OpenAI;
  private model: GPT5Model;
  private config: ModelConfig;

  constructor(config: GPT5Config) {
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY missing');
    }

    this.openai = new OpenAI({ apiKey });
    this.model = config.model;
    this.config = {
      version: config.model,
      apiKey,
    };
  }

  /**
   * Get the model name
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Get configuration
   */
  getConfig(): ModelConfig {
    return { ...this.config };
  }

  /**
   * Create a response using GPT-5's Responses API
   */
  async createResponse(params: RequestParams): Promise<ResponseResult> {
    // Validate no deprecated parameters
    this.validateParams(params);

    // Build request body for GPT-5 Responses API
    const requestBody: any = {
      model: this.model,
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

    // Handle E2B code execution
    if (params.e2b_execution?.enabled) {
      requestBody.tools = requestBody.tools || [];
      requestBody.tools.push({
        type: 'custom',
        name: 'code_exec',
        description: 'Executes Python code in a sandboxed E2B environment.',
      });
    }

    // Call GPT-5 Responses API
    const response = await this.openai.post('/v1/responses', {
      body: requestBody,
    }) as Response;

    const data = await response.json() as any;

    // Parse items
    const items: ResponseItem[] = (data.items || []).map((item: any) => {
      if (item.type === 'reasoning') {
        return { type: 'reasoning', reasoning: item.content };
      } else if (item.type === 'function_call') {
        // Function calls have JSON-encoded arguments
        return {
          type: 'function_call',
          function_call: {
            id: item.id,
            call_id: item.call_id,
            name: item.name,
            arguments: item.arguments,
          },
        };
      } else if (item.type === 'custom_tool_call') {
        // Custom tool calls have plain text input
        return {
          type: 'custom_tool_call',
          custom_tool_call: {
            id: item.id,
            call_id: item.call_id,
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

  /**
   * Validate that deprecated parameters are not used
   */
  private validateParams(params: any): void {
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
}

/**
 * Helper function to create a GPT-5 client
 */
export function createGPT5Client(model: GPT5Model = 'gpt-5-mini', apiKey?: string): GPT5Client {
  return new GPT5Client({ model, apiKey });
}

/**
 * SAFEGUARD: Prevents using deprecated chat.completions API
 */
export function preventDeprecatedChatCompletions(): never {
  throw new Error(
    `❌ DEPRECATED API: client.chat.completions.create() is DEPRECATED for GPT-5\n\n` +
    `Use the Responses API instead:\n` +
    `  - Use createClient() from @libs/openai-client\n` +
    `  - This automatically handles model-specific APIs\n\n` +
    `Migration guide:\n` +
    `  1. Replace chat.completions.create() with client.createResponse()\n` +
    `  2. Change "messages" parameter to "input"\n` +
    `  3. Remove temperature, top_p, logprobs\n` +
    `  4. Add reasoning.effort and text.verbosity\n\n` +
    `See: https://platform.openai.com/docs/guides/gpt-5/migration`
  );
}

/**
 * Legacy compatibility wrapper
 * Maps old GPT-4 style calls to GPT-5
 */
export async function runResponses(options: {
  client?: GPT5Client;
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
  const client = options.client ?? createGPT5Client();

  // Warn about deprecated parameters
  if (options.input.temperature !== undefined) {
    console.warn(
      '⚠️  WARNING: temperature parameter is deprecated for GPT-5.\n' +
      '   It has been ignored. Use reasoning.effort instead.'
    );
  }

  // Map old model to GPT-5 variant
  const oldModel = options.input.model.toLowerCase();
  let effort: 'minimal' | 'low' | 'medium' | 'high';

  if (oldModel.includes('gpt-4.1') || oldModel.includes('gpt-4-turbo')) {
    effort = 'minimal';
  } else if (oldModel.includes('gpt-4') || oldModel.includes('o3')) {
    effort = 'medium';
  } else if (oldModel.includes('o4-mini') || oldModel.includes('gpt-4-mini')) {
    effort = 'low';
  } else {
    effort = 'low';
  }

  const response = await client.createResponse({
    input: options.input.input,
    reasoning: { effort },
    text: { verbosity: 'medium' },
    max_output_tokens: options.input.max_tokens,
  });

  return response.output_text;
}

/**
 * Helper: Choose appropriate GPT-5 model based on use case
 */
export function chooseGPT5Model(useCase: {
  complexity: 'simple' | 'medium' | 'complex';
  domain: 'code' | 'analysis' | 'chat' | 'classification';
  latency: 'critical' | 'normal' | 'flexible';
}): { model: GPT5Model; effort: 'minimal' | 'low' | 'medium' | 'high'; verbosity: 'low' | 'medium' | 'high' } {
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
