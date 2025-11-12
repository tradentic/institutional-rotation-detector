/**
 * Chain of Thought (CoT) Session Manager
 *
 * First-class support for multi-turn conversations with CoT persistence.
 * Model-agnostic - works with any AIClient implementation (GPT-5, GPT-6, etc).
 *
 * Critical for efficient agentic workflows that need to:
 * 1. Analyze data with AI
 * 2. Execute code with E2B on large datasets
 * 3. Continue reasoning with results WITHOUT re-reasoning from scratch
 *
 * Benefits:
 * - Automatic previous_response_id tracking
 * - Reduced reasoning tokens (avoids re-reasoning)
 * - Higher cache hit rates
 * - Lower latency
 * - Better context continuity
 *
 * @example
 * ```typescript
 * import { createClient } from '../factory';
 *
 * const client = createClient({ model: 'gpt-5' });
 * const session = new CoTSession({ client });
 *
 * // Turn 1: Initial analysis
 * const step1 = await session.respond('Analyze this dataset structure...');
 *
 * // Turn 2: Execute code (CoT automatically passed)
 * const step2 = await session.respond('Now calculate the correlation matrix', {
 *   e2b_execution: { enabled: true }
 * });
 *
 * // Turn 3: Continue reasoning with results (CoT preserved)
 * const step3 = await session.respond('Based on these correlations, identify anomalies');
 * ```
 */

import type {
  AIClient,
  ReasoningEffort,
  Verbosity,
  Tool,
  RequestParams,
  ResponseResult,
  ResponseItem,
  E2BCodeExecutionConfig,
} from './types';
import { executeCode, handleCodeExecutionToolCall } from './e2b';

// ============================================================================
// Types
// ============================================================================

export interface CoTSessionConfig {
  /**
   * AI client (required) - create with createClient() from factory
   */
  client: AIClient;

  /**
   * Optional overrides (defaults from client if not provided)
   */
  effort?: ReasoningEffort;
  verbosity?: Verbosity;
  systemPrompt?: string;
  maxTurns?: number;
  tools?: Tool[];
  e2b?: E2BCodeExecutionConfig;
}

export interface CoTTurn {
  turnNumber: number;
  input: string;
  responseId: string;
  output: string;
  items: ResponseItem[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens?: number;
  };
  toolCalls?: Array<{
    id: string;
    name: string;
    input: string | Record<string, unknown>;
    output?: string;
  }>;
  timestamp: Date;
}

export interface CoTSessionState {
  sessionId: string;
  model: string; // Model-agnostic (gpt-5, gpt-6, etc.)
  effort: ReasoningEffort;
  verbosity: Verbosity;
  systemPrompt?: string;
  turns: CoTTurn[];
  currentResponseId?: string;
  totalTokens: {
    input: number;
    output: number;
    reasoning: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// CoT Session Manager
// ============================================================================

export class CoTSession {
  private state: CoTSessionState;
  private client: AIClient;
  private tools: Tool[];
  private e2bConfig?: E2BCodeExecutionConfig;

  constructor(config: CoTSessionConfig) {
    this.client = config.client;
    this.tools = config.tools ?? [];
    this.e2bConfig = config.e2b;

    this.state = {
      sessionId: this.generateSessionId(),
      model: this.client.getModel(),
      effort: config.effort ?? 'medium',
      verbosity: config.verbosity ?? 'medium',
      systemPrompt: config.systemPrompt,
      turns: [],
      totalTokens: {
        input: 0,
        output: 0,
        reasoning: 0,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Send a message and get a response, automatically maintaining CoT
   *
   * This is the main method for multi-turn conversations. It:
   * 1. Automatically passes previous_response_id
   * 2. Handles tool calls (including E2B code execution)
   * 3. Tracks all turns and usage
   * 4. Maintains reasoning context
   *
   * @example
   * ```typescript
   * const session = new CoTSession({ model: 'gpt-5', effort: 'high' });
   *
   * // Turn 1
   * const r1 = await session.respond('What is 2+2?');
   * console.log(r1); // "4"
   *
   * // Turn 2 - CoT automatically passed
   * const r2 = await session.respond('Multiply that by 3');
   * console.log(r2); // "12"
   * ```
   */
  async respond(
    input: string,
    overrides: {
      effort?: ReasoningEffort;
      verbosity?: Verbosity;
      maxTokens?: number;
      tools?: Tool[];
      e2b_execution?: E2BCodeExecutionConfig;
    } = {}
  ): Promise<string> {
    const turnNumber = this.state.turns.length + 1;

    // Build request params
    const params: RequestParams = {
      input: this.buildInput(input),
      reasoning: {
        effort: overrides.effort ?? this.state.effort,
      },
      text: {
        verbosity: overrides.verbosity ?? this.state.verbosity,
      },
      max_output_tokens: overrides.maxTokens,
      tools: overrides.tools ?? this.tools,
      previous_response_id: this.state.currentResponseId, // 🔑 KEY: Pass CoT
      e2b_execution: overrides.e2b_execution ?? this.e2bConfig,
    };

    // Make request (model-agnostic!)
    const response = await this.client.createResponse(params);

    // Handle tool calls if present
    const toolCalls = await this.handleToolCalls(response);

    // Record turn
    const turn: CoTTurn = {
      turnNumber,
      input,
      responseId: response.id,
      output: response.output_text,
      items: response.items,
      usage: response.usage,
      toolCalls,
      timestamp: new Date(),
    };

    this.state.turns.push(turn);
    this.state.currentResponseId = response.id;
    this.state.updatedAt = new Date();

    // Update token counters
    if (response.usage) {
      this.state.totalTokens.input += response.usage.input_tokens;
      this.state.totalTokens.output += response.usage.output_tokens;
      this.state.totalTokens.reasoning += response.usage.reasoning_tokens ?? 0;
    }

    return response.output_text;
  }

  /**
   * Get full response with items (includes reasoning, tool calls, etc.)
   */
  async respondFull(
    input: string,
    overrides: Parameters<CoTSession['respond']>[1] = {}
  ): Promise<ResponseResult> {
    const turnNumber = this.state.turns.length + 1;

    const params: RequestParams = {
      input: this.buildInput(input),
      reasoning: { effort: overrides.effort ?? this.state.effort },
      text: { verbosity: overrides.verbosity ?? this.state.verbosity },
      max_output_tokens: overrides.maxTokens,
      tools: overrides.tools ?? this.tools,
      previous_response_id: this.state.currentResponseId,
      e2b_execution: overrides.e2b_execution ?? this.e2bConfig,
    };

    const response = await this.client.createResponse(params);

    const toolCalls = await this.handleToolCalls(response);

    const turn: CoTTurn = {
      turnNumber,
      input,
      responseId: response.id,
      output: response.output_text,
      items: response.items,
      usage: response.usage,
      toolCalls,
      timestamp: new Date(),
    };

    this.state.turns.push(turn);
    this.state.currentResponseId = response.id;
    this.state.updatedAt = new Date();

    if (response.usage) {
      this.state.totalTokens.input += response.usage.input_tokens;
      this.state.totalTokens.output += response.usage.output_tokens;
      this.state.totalTokens.reasoning += response.usage.reasoning_tokens ?? 0;
    }

    return response;
  }

  /**
   * Execute code with E2B and continue conversation with results
   *
   * This is a specialized method for the common pattern:
   * 1. Ask GPT-5 to generate code
   * 2. Execute it in E2B
   * 3. Pass results back to GPT-5 for analysis
   *
   * @example
   * ```typescript
   * const session = new CoTSession({ model: 'gpt-5' });
   *
   * const analysis = await session.executeAndAnalyze(
   *   'Calculate the correlation matrix for this dataset: [data]',
   *   'Identify which correlations are statistically significant'
   * );
   * ```
   */
  async executeAndAnalyze(
    codePrompt: string,
    analysisPrompt: string,
    codeExecutionConfig?: E2BCodeExecutionConfig
  ): Promise<{
    code: string;
    executionResult: string;
    analysis: string;
  }> {
    // Step 1: Get code from GPT-5
    const codeResponse = await this.respondFull(codePrompt, {
      e2b_execution: codeExecutionConfig ?? { enabled: true },
    });

    // Extract code from response
    let code = '';
    const toolCall = codeResponse.items.find(item => item.type === 'custom_tool_call');
    if (toolCall?.custom_tool_call) {
      code = typeof toolCall.custom_tool_call.input === 'string'
        ? toolCall.custom_tool_call.input
        : JSON.stringify(toolCall.custom_tool_call.input);
    } else {
      code = codeResponse.output_text;
    }

    // Step 2: Execute code in E2B
    const executionResult = await handleCodeExecutionToolCall(
      code,
      codeExecutionConfig
    );

    // Step 3: Pass results back to GPT-5 for analysis (CoT preserved)
    const analysisInput = `${analysisPrompt}\n\nExecution results:\n${executionResult}`;
    const analysis = await this.respond(analysisInput);

    return {
      code,
      executionResult,
      analysis,
    };
  }

  /**
   * Get conversation history
   */
  getHistory(): CoTTurn[] {
    return [...this.state.turns];
  }

  /**
   * Get conversation summary
   */
  getSummary(): {
    sessionId: string;
    model: string;
    turns: number;
    totalTokens: {
      input: number;
      output: number;
      reasoning: number;
    };
    duration: number; // milliseconds
  } {
    return {
      sessionId: this.state.sessionId,
      model: this.state.model,
      turns: this.state.turns.length,
      totalTokens: this.state.totalTokens,
      duration: this.state.updatedAt.getTime() - this.state.createdAt.getTime(),
    };
  }

  /**
   * Get current session state (for serialization)
   */
  getState(): CoTSessionState {
    return { ...this.state };
  }

  /**
   * Reset session (clears all turns and CoT)
   */
  reset(): void {
    this.state.turns = [];
    this.state.currentResponseId = undefined;
    this.state.totalTokens = { input: 0, output: 0, reasoning: 0 };
    this.state.createdAt = new Date();
    this.state.updatedAt = new Date();
  }

  /**
   * Fork session (create a new session with same config but clean state)
   */
  fork(): CoTSession {
    return new CoTSession({
      client: this.client,
      effort: this.state.effort,
      verbosity: this.state.verbosity,
      systemPrompt: this.state.systemPrompt,
      tools: [...this.tools],
      e2b: this.e2bConfig,
    });
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private buildInput(userInput: string): RequestParams['input'] {
    if (this.state.systemPrompt) {
      return [
        { role: 'system' as const, content: this.state.systemPrompt },
        { role: 'user' as const, content: userInput },
      ];
    }
    return userInput;
  }

  private async handleToolCalls(
    response: ResponseResult
  ): Promise<CoTTurn['toolCalls']> {
    const toolCalls: CoTTurn['toolCalls'] = [];

    for (const item of response.items) {
      // Handle function calls (JSON schema driven)
      if (item.type === 'function_call' && item.function_call) {
        const { id, name, arguments: args } = item.function_call;

        toolCalls.push({
          id,
          name,
          input: args // JSON string
        });
      }

      // Handle custom tool calls (free form text)
      else if (item.type === 'custom_tool_call' && item.custom_tool_call) {
        const { id, name, input } = item.custom_tool_call;

        // Handle code_exec custom tool
        if (name === 'code_exec') {
          const output = await handleCodeExecutionToolCall(
            input,
            this.e2bConfig
          );
          toolCalls.push({ id, name, input, output });
        } else {
          // Other custom tools
          toolCalls.push({ id, name, input });
        }
      }
    }

    return toolCalls.length > 0 ? toolCalls : undefined;
  }

  private generateSessionId(): string {
    return `cot_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
}

// ============================================================================
// Factory Functions (Model-Agnostic)
// ============================================================================

/**
 * Create a CoT session optimized for data analysis workflows
 *
 * @example
 * ```typescript
 * import { createClient } from '../factory';
 *
 * const client = createClient({ model: 'gpt-5' });
 * const session = createAnalysisSession({ client, enableE2B: true });
 * ```
 */
export function createAnalysisSession(config: {
  client: AIClient;
  systemPrompt?: string;
  enableE2B?: boolean;
}): CoTSession {
  return new CoTSession({
    client: config.client,
    effort: 'high',
    verbosity: 'high',
    systemPrompt: config.systemPrompt ?? 'You are an expert data analyst. Provide detailed, step-by-step analysis.',
    e2b: config.enableE2B ? { enabled: true } : undefined,
  });
}

/**
 * Create a CoT session optimized for fast, cost-effective tasks
 *
 * @example
 * ```typescript
 * import { createClient } from '../factory';
 *
 * const client = createClient({ model: 'gpt-5-mini' });
 * const session = createFastSession({ client });
 * ```
 */
export function createFastSession(config: {
  client: AIClient;
  systemPrompt?: string;
}): CoTSession {
  return new CoTSession({
    client: config.client,
    effort: 'minimal',
    verbosity: 'low',
    systemPrompt: config.systemPrompt,
  });
}

/**
 * Create a CoT session optimized for code generation and execution
 *
 * @example
 * ```typescript
 * import { createClient } from '../factory';
 *
 * const client = createClient({ model: 'gpt-5' });
 * const session = createCodeSession({ client, enableE2B: true });
 * ```
 */
export function createCodeSession(config: {
  client: AIClient;
  systemPrompt?: string;
  enableE2B?: boolean;
}): CoTSession {
  return new CoTSession({
    client: config.client,
    effort: 'high',
    verbosity: 'high',
    systemPrompt: config.systemPrompt ?? 'You are an expert programmer. Write clean, efficient, well-documented code.',
    e2b: config.enableE2B !== false ? { enabled: true } : undefined,
    tools: [
      {
        type: 'custom',
        name: 'code_exec',
        description: 'Executes Python code in a sandboxed environment. Use this to run calculations, data analysis, or any computational task.',
      },
    ],
  });
}

/**
 * Restore a session from saved state
 *
 * @example
 * ```typescript
 * import { createClient } from '../factory';
 *
 * const client = createClient({ model: 'gpt-5-mini' });
 * const savedState = await loadSessionState(sessionId);
 * const session = restoreSession(savedState, client);
 * ```
 */
export function restoreSession(
  state: CoTSessionState,
  client: AIClient
): CoTSession {
  const session = new CoTSession({
    client,
    effort: state.effort,
    verbosity: state.verbosity,
    systemPrompt: state.systemPrompt,
  });

  // Restore state (override model from client)
  session['state'] = { ...state, model: client.getModel() };

  return session;
}
