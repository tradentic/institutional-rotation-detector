import { CodeInterpreter } from '@e2b/code-interpreter';

export interface E2BOptions {
  apiKey?: string;
  timeoutMs?: number;
}

export interface CodeExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  logs?: string[];
}

/**
 * Execute code in an E2B sandbox environment.
 * This provides a safe environment for LLMs to run arbitrary code.
 */
export async function executeCode(
  code: string,
  language: 'python' | 'javascript' = 'python',
  options: E2BOptions = {}
): Promise<CodeExecutionResult> {
  const apiKey = options.apiKey ?? process.env.E2B_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: 'E2B_API_KEY not configured. Code execution disabled.',
    };
  }

  let sandbox: CodeInterpreter | null = null;

  try {
    // Create a sandboxed environment
    sandbox = await CodeInterpreter.create({ apiKey });

    // Execute the code
    const execution = await sandbox.notebook.execCell(code, {
      onStderr: (msg) => console.error('[E2B stderr]:', msg),
      onStdout: (msg) => console.log('[E2B stdout]:', msg),
    });

    // Check for errors
    if (execution.error) {
      return {
        success: false,
        error: `${execution.error.name}: ${execution.error.value}\n${execution.error.traceback}`,
        logs: execution.logs.stdout.concat(execution.logs.stderr),
      };
    }

    // Get results
    const results = execution.results
      .map((result) => {
        if (result.text) return result.text;
        if (result.html) return result.html;
        if (result.json) return JSON.stringify(result.json, null, 2);
        if (result.png) return `[PNG image data]`;
        if (result.jpeg) return `[JPEG image data]`;
        if (result.svg) return result.svg;
        if (result.pdf) return `[PDF data]`;
        return String(result);
      })
      .join('\n');

    return {
      success: true,
      output: results || execution.logs.stdout.join('\n'),
      logs: execution.logs.stdout.concat(execution.logs.stderr),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // Always close the sandbox
    if (sandbox) {
      await sandbox.close();
    }
  }
}

/**
 * Tool definition for OpenAI function calling.
 * This allows the LLM to request code execution when needed.
 */
export const codeExecutionTool = {
  type: 'function' as const,
  function: {
    name: 'execute_code',
    description:
      'Execute Python or JavaScript code in a secure sandbox environment. Use this when you need to perform calculations, data analysis, or run code that you cannot execute yourself.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The code to execute',
        },
        language: {
          type: 'string',
          enum: ['python', 'javascript'],
          description: 'Programming language to use',
          default: 'python',
        },
      },
      required: ['code'],
    },
  },
};

/**
 * Handle a tool call from OpenAI.
 * Routes to the appropriate tool handler.
 */
export async function handleToolCall(
  toolName: string,
  toolArgs: Record<string, unknown>
): Promise<string> {
  if (toolName === 'execute_code') {
    const code = String(toolArgs.code || '');
    const language = (toolArgs.language as 'python' | 'javascript') ?? 'python';
    const result = await executeCode(code, language);

    if (result.success) {
      return result.output || 'Code executed successfully with no output.';
    } else {
      return `Error executing code: ${result.error}`;
    }
  }

  return `Unknown tool: ${toolName}`;
}
