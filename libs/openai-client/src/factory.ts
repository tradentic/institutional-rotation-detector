/**
 * Model Factory
 *
 * Creates the appropriate AI client based on configuration.
 * This allows runtime selection of models (GPT-5, GPT-6, etc.)
 */

import type { AIClient } from './core/types.js';
import { GPT5Client, createGPT5Client } from './models/gpt5/client.js';
import type { GPT5Model } from './models/gpt5/types.js';

export interface ClientConfig {
  /**
   * Model to use. Can be:
   * - GPT-5 variants: 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-chat-latest'
   * - GPT-6 variants: 'gpt-6', 'gpt-6-mini' (when available)
   * - Or from env: process.env.OPENAI_MODEL
   */
  model?: string;

  /**
   * API key (optional, defaults to OPENAI_API_KEY env var)
   */
  apiKey?: string;
}

/**
 * Create an AI client based on model name
 *
 * @example
 * ```typescript
 * // Explicit model
 * const client = createClient({ model: 'gpt-5-mini' });
 *
 * // From environment variable
 * const client = createClient();
 *
 * // Use the client
 * const result = await client.createResponse({
 *   input: 'Analyze this...',
 *   reasoning: { effort: 'medium' }
 * });
 * ```
 */
export function createClient(config: ClientConfig = {}): AIClient {
  const modelName = config.model ?? process.env.OPENAI_MODEL ?? 'gpt-5-mini';
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;

  // Route to appropriate model implementation
  if (isGPT5Model(modelName)) {
    return createGPT5Client(modelName as GPT5Model, apiKey);
  }

  // Future: GPT-6 support
  // if (isGPT6Model(modelName)) {
  //   return createGPT6Client(modelName as GPT6Model, apiKey);
  // }

  // Default to GPT-5 mini
  console.warn(`Unknown model '${modelName}', defaulting to gpt-5-mini`);
  return createGPT5Client('gpt-5-mini', apiKey);
}

/**
 * Check if model name is a GPT-5 variant
 */
function isGPT5Model(model: string): boolean {
  return model.startsWith('gpt-5');
}

// Future: Check if model name is a GPT-6 variant
// function isGPT6Model(model: string): boolean {
//   return model.startsWith('gpt-6');
// }
