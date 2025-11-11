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
 * Context-free grammar for constraining custom tool outputs
 */
export interface ToolGrammar {
  type: 'grammar';
  syntax: 'lark' | 'regex';
  definition: string;
}

/**
 * Custom tool definition for freeform text inputs
 *
 * Custom tools accept any raw text as input (code, SQL, shell commands, prose)
 * without JSON structure constraints. Optionally constrain outputs with CFGs.
 *
 * @example
 * ```typescript
 * // Freeform code execution (no constraints)
 * {
 *   type: 'custom',
 *   name: 'code_exec',
 *   description: 'Executes arbitrary Python code',
 * }
 *
 * // With Lark CFG to constrain SQL syntax
 * {
 *   type: 'custom',
 *   name: 'sql_query',
 *   description: 'Generates SQL queries',
 *   format: {
 *     type: 'grammar',
 *     syntax: 'lark',
 *     definition: 'start: select_stmt\nselect_stmt: ...'
 *   }
 * }
 * ```
 */
export interface CustomTool {
  type: 'custom';
  name: string;
  description: string;
  format?: ToolGrammar; // Optional CFG to constrain outputs
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
 * Tool choice options
 */

/** Restrict model to subset of available tools */
export interface AllowedToolsChoice {
  type: 'allowed_tools';
  mode: 'auto' | 'required';
  tools: Array<{ type: 'function'; name: string } | { type: 'custom'; name: string }>;
}

/** Force calling a specific function tool */
export interface ForcedFunctionChoice {
  type: 'function';
  name: string;
}

/** Force calling a specific custom tool */
export interface ForcedCustomChoice {
  type: 'custom';
  name: string;
}

export type ToolChoice =
  | 'auto' // Model decides (0, 1, or multiple tools)
  | 'required' // Model must call 1+ tools
  | 'none' // Don't call any tools
  | AllowedToolsChoice // Restrict to subset
  | ForcedFunctionChoice // Force specific function
  | ForcedCustomChoice; // Force specific custom tool

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
  tool_choice?: ToolChoice;
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
