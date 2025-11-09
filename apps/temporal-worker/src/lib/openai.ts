import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export interface ResponseCreateParams {
  model: string;
  input: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string | Array<{ type: 'text'; text: string }>;
  }>;
  temperature?: number;
  max_tokens?: number;
}

export interface OpenAIOptions {
  apiKey?: string;
}

export function createOpenAIClient(options: OpenAIOptions = {}): OpenAI {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY missing');
  }
  return new OpenAI({ apiKey });
}

/**
 * Run OpenAI chat completion with our custom input format
 * Converts our ResponseCreateParams to standard Chat Completions API
 */
export async function runResponses(options: {
  client?: OpenAI;
  input: ResponseCreateParams;
}): Promise<string> {
  const client = options.client ?? createOpenAIClient();

  // Convert our input format to OpenAI chat completions format
  const messages: ChatCompletionMessageParam[] = options.input.input.map((msg) => {
    if (typeof msg.content === 'string') {
      return {
        role: msg.role,
        content: msg.content,
      };
    } else {
      // Handle array of content parts (multimodal)
      return {
        role: msg.role,
        content: msg.content.map((part) => ({
          type: 'text' as const,
          text: part.text,
        })),
      };
    }
  });

  const response = await client.chat.completions.create({
    model: options.input.model,
    messages,
    temperature: options.input.temperature,
    max_tokens: options.input.max_tokens,
  });

  const text = response.choices[0]?.message?.content?.trim() ?? '';
  return text;
}
