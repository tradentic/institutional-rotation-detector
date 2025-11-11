# E2B Code Execution Guide

This guide explains how to use E2B code execution with the `@libs/openai-client` library in two ways:
1. **Automatic via Tool Calling** (Model decides when to execute code)
2. **Explicit Direct Execution** (You control when to execute code)

## Prerequisites

Set the E2B API key:
```bash
export E2B_API_KEY=e2b_...
```

## Pattern 1: Automatic via Tool Calling (Recommended)

The model automatically decides when to execute Python code using the `code_exec` custom tool.

### Configuration

E2B is configured as a **custom tool** (not a function tool). This follows OpenAI's recommendations for code execution:

```typescript
{
  type: 'custom',
  name: 'code_exec',
  description: 'Executes Python code in a sandboxed environment.',
}
```

Custom tools receive **plain text input** (Python code), not JSON. This is perfect for code execution.

### Example: Using CoT Sessions

```typescript
import { createClient, createCodeSession } from '@libs/openai-client';

// Create client and session with E2B enabled
const client = createClient({ model: 'gpt-5' });
const session = createCodeSession({
  client,
  enableE2B: true, // Adds code_exec custom tool
});

// The model will automatically use code_exec when it needs to run code
const result = await session.respond(
  'Calculate the correlation matrix for this dataset: [1,2,3,4,5], [2,4,6,8,10]'
);

console.log(result);
// Model generates Python code, executes it via E2B, and returns analysis
```

### Example: Multi-Step with executeAndAnalyze

```typescript
import { createClient, createAnalysisSession } from '@libs/openai-client';

const client = createClient({ model: 'gpt-5' });
const session = createAnalysisSession({
  client,
  enableE2B: true,
});

// Step 1: Model generates code
// Step 2: Code executes in E2B automatically
// Step 3: Model analyzes results with CoT preserved
const { code, executionResult, analysis } = await session.executeAndAnalyze(
  'Process this CSV data and calculate summary statistics: [large dataset]',
  'What patterns do you see in the statistics?'
);

console.log('Generated Code:', code);
console.log('Execution Output:', executionResult);
console.log('Analysis:', analysis);
```

### Example: Manual Tool Control

You can also control tool usage explicitly:

```typescript
import { createClient, CoTSession } from '@libs/openai-client';

const client = createClient({ model: 'gpt-5' });
const session = new CoTSession({
  client,
  tools: [
    {
      type: 'custom',
      name: 'code_exec',
      description: 'Executes Python code in a sandboxed E2B environment.',
    },
  ],
  e2b: { enabled: true },
});

// Use tool_choice to force code execution
const response = await session.respondFull(
  'Calculate fibonacci(100)',
  {
    // Force tool usage (optional)
    // tool_choice: { type: 'custom', name: 'code_exec' }
  }
);

// Check for custom tool calls
for (const item of response.items) {
  if (item.type === 'custom_tool_call') {
    console.log('Tool:', item.custom_tool_call?.name);
    console.log('Input Code:', item.custom_tool_call?.input);
  }
}
```

### How It Works (Under the Hood)

1. **Request:** You enable E2B via `e2b_execution: { enabled: true }`
2. **Tool Added:** The library automatically adds the `code_exec` custom tool:
   ```typescript
   tools: [{
     type: 'custom',
     name: 'code_exec',
     description: 'Executes Python code in a sandboxed E2B environment.',
   }]
   ```
3. **Model Response:** Model returns `custom_tool_call` with Python code as plain text:
   ```json
   {
     "type": "custom_tool_call",
     "call_id": "call_123",
     "name": "code_exec",
     "input": "import pandas as pd\ndf = pd.DataFrame(...)"
   }
   ```
4. **Execution:** Library automatically executes the code in E2B sandbox
5. **Result:** Execution output is passed back to the model for analysis

## Pattern 2: Explicit Direct Execution

Execute code directly without involving the model's tool calling system.

### Example: Direct Code Execution

```typescript
import { executeCode, isE2BAvailable } from '@libs/openai-client';

// Check if E2B is available
if (!isE2BAvailable()) {
  throw new Error('E2B_API_KEY not configured');
}

// Execute Python code directly
const result = await executeCode(`
import numpy as np

# Calculate correlation matrix
data = np.array([[1,2,3,4,5], [2,4,6,8,10]])
correlation = np.corrcoef(data)

print("Correlation Matrix:")
print(correlation)
`, {
  timeout: 30000, // 30 second timeout
});

if (result.exitCode === 0) {
  console.log('Success:', result.stdout);
} else {
  console.error('Error:', result.stderr);
}
```

### Example: Hybrid Approach (Model + Manual Execution)

```typescript
import {
  createClient,
  CoTSession,
  executeCode,
} from '@libs/openai-client';

const client = createClient({ model: 'gpt-5' });
const session = new CoTSession({ client });

// Step 1: Ask model to generate code (no tool calling)
const codeResponse = await session.respond(
  'Write Python code to calculate the fibonacci sequence up to n=100'
);

// Step 2: Extract code from response (you implement this)
const pythonCode = extractCodeFromResponse(codeResponse);

// Step 3: Execute code directly with E2B
const execution = await executeCode(pythonCode, {
  timeout: 10000,
});

// Step 4: Pass results back to model for analysis
const analysis = await session.respond(
  `Here are the results from executing your code:\n\nSTDOUT:\n${execution.stdout}\n\nSTDERR:\n${execution.stderr}\n\nAnalyze these results.`
);

console.log(analysis);

function extractCodeFromResponse(response: string): string {
  // Extract code blocks from markdown
  const match = response.match(/```python\n([\s\S]*?)\n```/);
  return match ? match[1] : response;
}
```

### Example: Check E2B Status

```typescript
import { getE2BStatus } from '@libs/openai-client';

const status = getE2BStatus();

console.log('E2B Available:', status.available);
console.log('API Key Configured:', status.apiKeyConfigured);
console.log('SDK Installed:', status.sdkInstalled);

if (!status.available) {
  console.warn('E2B is not available. Set E2B_API_KEY environment variable.');
}
```

## Comparison: Automatic vs Explicit

| Aspect | Automatic (Tool Calling) | Explicit (Direct) |
|--------|--------------------------|-------------------|
| **When to use** | Model needs to decide when to run code | You know exactly when to run code |
| **Control** | Model decides | Full developer control |
| **Context** | CoT preserved across execution | Manual context passing |
| **Simplicity** | Very simple (1 line) | More verbose |
| **Use case** | Analysis workflows, Q&A | Batch processing, pipelines |

## Best Practices

### 1. Always Enable E2B for Analysis Sessions

```typescript
const session = createAnalysisSession({
  client,
  enableE2B: true, // ✅ Allow model to execute code when needed
});
```

### 2. Use Direct Execution for Known Code

```typescript
// ✅ Good: You already have the code
const result = await executeCode(knownPythonCode);

// ❌ Overkill: Asking model to generate simple code
const session = createCodeSession({ client, enableE2B: true });
await session.respond('Print hello world');
```

### 3. Set Appropriate Timeouts

```typescript
// For quick calculations
await executeCode(code, { timeout: 5000 }); // 5s

// For large datasets
await executeCode(code, { timeout: 60000 }); // 60s
```

### 4. Handle Errors Gracefully

```typescript
const result = await executeCode(code);

if (result.error) {
  console.error('Execution failed:', result.error);
  console.error('Stderr:', result.stderr);
} else {
  console.log('Success:', result.stdout);
}
```

## Tool Calling Configuration Reference

### Custom Tool (for E2B)

```typescript
{
  type: 'custom',
  name: 'code_exec',
  description: 'Executes Python code in a sandboxed environment.',
  // No format parameter = free text input
}
```

**Why custom, not function?**
- Function tools require JSON schema for structured input
- Code is plain text, not JSON
- Custom tools accept free-form text (perfect for code)

### Function Tool (for structured data)

```typescript
{
  type: 'function',
  name: 'get_weather',
  description: 'Get weather for a location',
  parameters: {
    type: 'object',
    properties: {
      location: { type: 'string' },
    },
    required: ['location'],
  },
}
```

## Troubleshooting

### E2B_API_KEY not configured

**Error:** `E2B_API_KEY not configured. Code execution is disabled.`

**Solution:**
```bash
export E2B_API_KEY=e2b_your_key_here
```

### Timeout errors

**Error:** Execution times out after 30 seconds

**Solution:** Increase timeout:
```typescript
await executeCode(code, { timeout: 60000 }); // 60 seconds
```

### Model not using code_exec tool

**Problem:** Model returns code in text instead of calling tool

**Solutions:**
1. Make prompt more explicit: "Use the code_exec tool to calculate..."
2. Force tool usage:
   ```typescript
   await session.respond(prompt, {
     // Force model to call a tool
     tool_choice: 'required'
   });
   ```

### Custom tool call not recognized

**Problem:** `handleCodeExecutionToolCall` not being called

**Checklist:**
- ✅ Tool configured with `type: 'custom'`
- ✅ Tool name is exactly `'code_exec'`
- ✅ E2B config passed: `e2b: { enabled: true }`
- ✅ Using latest version of library with custom_tool_call parsing

## Summary

**For most use cases, use automatic tool calling:**
```typescript
const client = createClient({ model: 'gpt-5' });
const session = createCodeSession({ client, enableE2B: true });
const result = await session.respond('Your prompt...');
```

**For specific control, use direct execution:**
```typescript
const result = await executeCode(pythonCode);
console.log(result.stdout);
```

**The library handles everything for you:**
- ✅ Configures custom tools correctly
- ✅ Parses custom_tool_call responses
- ✅ Executes code in E2B sandbox
- ✅ Returns results to model with CoT preserved
