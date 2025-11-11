/**
 * Core Types - Model Agnostic
 *
 * These types define the interface that all model implementations must follow.
 * Whether using GPT-5, GPT-6, or future models, they all implement these types.
 */

/**
 * Reasoning effort level - universal across models
 */
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

/**
 * Output verbosity level - universal across models
 */
export type Verbosity = 'low' | 'medium' | 'high';

/**
 * Custom tool definition for freeform text inputs
 */
export interface CustomTool {
  type: 'custom';
  name: string;
  description: string;
  grammar?: string; // Optional context-free grammar (Lark format)
}

/**
 * Function tool definition for structured inputs
 */
export interface FunctionTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export type Tool = CustomTool | FunctionTool;

/**
 * Allowed tools choice for restricting tool usage
 */
export interface AllowedToolsChoice {
  type: 'allowed_tools';
  mode: 'auto' | 'required';
  tools: Array<{ type: 'function'; name: string } | { type: 'custom'; name: string }>;
}

/**
 * E2B code execution configuration
 */
export interface E2BCodeExecutionConfig {
  enabled: boolean;
  sandboxId?: string;
  timeout?: number; // milliseconds
}

/**
 * Response item - can be message, function call, custom tool call, or reasoning
 */
export interface ResponseItem {
  type: 'message' | 'function_call' | 'custom_tool_call' | 'reasoning';
  content?: string;
  // For function calls (JSON schema driven)
  function_call?: {
    id: string;
    call_id: string;
    name: string;
    arguments: string; // JSON encoded
  };
  // For custom tool calls (free form text)
  custom_tool_call?: {
    id: string;
    call_id: string;
    name: string;
    input: string; // Plain text
  };
  reasoning?: string;
}

/**
 * Response result from model
 */
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

/**
 * Input message for model
 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string }>;
}

/**
 * Request parameters - model agnostic
 */
export interface RequestParams {
  input: string | Message[];
  reasoning?: {
    effort: ReasoningEffort;
  };
  text?: {
    verbosity: Verbosity;
  };
  max_output_tokens?: number;
  tools?: Tool[];
  tool_choice?: 'auto' | 'required' | AllowedToolsChoice;
  previous_response_id?: string; // For CoT
  e2b_execution?: E2BCodeExecutionConfig;
}

/**
 * Model configuration
 */
export interface ModelConfig {
  /**
   * Model version to use (e.g., 'gpt-5', 'gpt-6')
   */
  version?: string;

  /**
   * Default reasoning effort
   */
  defaultEffort?: ReasoningEffort;

  /**
   * Default verbosity
   */
  defaultVerbosity?: Verbosity;

  /**
   * API key (falls back to OPENAI_API_KEY env var)
   */
  apiKey?: string;
}

/**
 * Abstract Client Interface
 *
 * All model implementations (GPT-5, GPT-6, etc.) must implement this interface.
 */
export interface AIClient {
  /**
   * Create a response from the model
   */
  createResponse(params: RequestParams): Promise<ResponseResult>;

  /**
   * Get the model name/version
   */
  getModel(): string;

  /**
   * Get default configuration
   */
  getConfig(): ModelConfig;
}
