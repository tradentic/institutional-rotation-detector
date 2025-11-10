import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption
} from 'openai/resources/chat/completions';
import { codeExecutionTool, handleToolCall } from './e2b.ts';

export interface ResponseCreateParams {
  model: string;
  input: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string | Array<{ type: 'text'; text: string }>;
  }>;
  temperature?: number;
  max_tokens?: number;
  tools?: ChatCompletionTool[];
  tool_choice?: ChatCompletionToolChoiceOption;
  enableCodeExecution?: boolean; // If true, adds e2b code execution tool
  maxToolRounds?: number; // Maximum number of tool calling rounds (default: 5)
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
 * Supports optional tool calling with automatic iteration
 */
export async function runResponses(options: {
  client?: OpenAI;
  input: ResponseCreateParams;
}): Promise<string> {
  const client = options.client ?? createOpenAIClient();
  const maxRounds = options.input.maxToolRounds ?? 5;

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

  // Build tools array
  let tools: ChatCompletionTool[] | undefined = options.input.tools;
  if (options.input.enableCodeExecution) {
    tools = [...(tools ?? []), codeExecutionTool];
  }

  // If no tools are specified, use standard completion
  if (!tools || tools.length === 0) {
    const response = await client.chat.completions.create({
      model: options.input.model,
      messages,
      temperature: options.input.temperature,
      max_tokens: options.input.max_tokens,
    });

    const text = response.choices[0]?.message?.content?.trim() ?? '';
    return text;
  }

  // Tool calling loop
  const conversationMessages = [...messages];
  let roundCount = 0;

  while (roundCount < maxRounds) {
    roundCount++;

    const response = await client.chat.completions.create({
      model: options.input.model,
      messages: conversationMessages,
      temperature: options.input.temperature,
      max_tokens: options.input.max_tokens,
      tools,
      tool_choice: options.input.tool_choice,
    });

    const choice = response.choices[0];
    if (!choice) {
      throw new Error('No completion choice returned');
    }

    const message = choice.message;

    // If no tool calls, we're done
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content?.trim() ?? '';
    }

    // Add assistant's message with tool calls to conversation
    conversationMessages.push({
      role: 'assistant',
      content: message.content,
      tool_calls: message.tool_calls,
    });

    // Execute each tool call
    for (const toolCall of message.tool_calls) {
      try {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);
        const toolResult = await handleToolCall(toolName, toolArgs);

        // Add tool response to conversation
        conversationMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult,
        });
      } catch (error) {
        // Add error as tool response
        conversationMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    // Continue the loop to get the next response
  }

  // If we hit max rounds, return the last message
  const lastMessage = conversationMessages[conversationMessages.length - 1];
  if (lastMessage && 'content' in lastMessage && typeof lastMessage.content === 'string') {
    return lastMessage.content;
  }

  return 'Max tool calling rounds reached without final response.';
}
