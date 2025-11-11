/**
 * GPT-5 Specific Types
 *
 * These types are specific to the GPT-5 implementation.
 * GPT-6 would have its own types file.
 */

/**
 * GPT-5 model variants
 */
export type GPT5Model =
  | 'gpt-5'              // Complex reasoning, broad world knowledge, code-heavy tasks
  | 'gpt-5-mini'         // Cost-optimized reasoning (recommended for most use cases)
  | 'gpt-5-nano'         // High-throughput, simple instruction-following
  | 'gpt-5-chat-latest'; // Latest chat-optimized variant

/**
 * GPT-5 specific configuration
 */
export interface GPT5Config {
  /**
   * GPT-5 model variant
   */
  model: GPT5Model;

  /**
   * API key (falls back to OPENAI_API_KEY env var)
   */
  apiKey?: string;
}
