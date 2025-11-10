# LLM Tool Calling and Code Execution

This document describes the tool calling and code execution capabilities added to the temporal workflow LLM integrations.

## Overview

All GPT-based LLM activities in the temporal workflows now support optional tool calling, including e2b code execution for scenarios where the LLM needs to run calculations or data analysis.

## Supported Activities

The following activities now support tool calling:

1. **`synthesizeWithOpenAI`** (longcontext.activities.ts)
   - Used for synthesizing investor rotation edges with long context
   - Model: gpt-4.1

2. **`summarizeCommunity`** (graphrag.activities.ts)
   - Used for summarizing investor flow communities
   - Model: gpt-4.1

3. **`createClusterSummary`** (filing-chunks.activities.ts)
   - Used for creating rotation cluster summaries
   - Model: gpt-4

## Configuration

### Environment Variables

To enable e2b code execution, set the following environment variable:

```bash
E2B_API_KEY=your_e2b_api_key_here
```

If the API key is not set, code execution requests will fail gracefully with an informative error message, and the LLM will continue without code execution capabilities.

### Enabling Code Execution

Each activity accepts an optional `enableCodeExecution` parameter:

```typescript
// Example: Enable code execution for synthesis
await synthesizeWithOpenAI({
  bundle: synthesisBundle,
  enableCodeExecution: true, // Enable e2b code execution
});

// Example: Enable code execution for community summarization
await summarizeCommunity({
  communityId: 'some-id',
  enableCodeExecution: true,
});

// Example: Enable code execution for cluster summary
await createClusterSummary({
  clusterId: 'some-id',
  enableCodeExecution: true,
});
```

By default, `enableCodeExecution` is `false` to maintain backward compatibility.

## How It Works

### Tool Calling Flow

1. The LLM receives a request with access to the `execute_code` tool
2. If the LLM determines it needs to run code (e.g., for calculations), it makes a tool call
3. The code is executed in a secure e2b sandbox environment
4. The execution result (or error) is returned to the LLM
5. The LLM incorporates the result into its response
6. This process can repeat up to 5 times (configurable via `maxToolRounds`)

### E2B Code Execution

When the LLM calls the `execute_code` tool:

- Code runs in an isolated sandbox (CodeInterpreter environment)
- Supports both Python and JavaScript
- Default language is Python
- Safe execution with stdout/stderr capture
- Returns text, JSON, or image data

### Custom Tools

You can also provide custom tools by extending the `tools` parameter in `ResponseCreateParams`:

```typescript
const result = await runResponses({
  client,
  input: {
    model: 'gpt-4.1',
    input: messages,
    tools: [
      {
        type: 'function',
        function: {
          name: 'custom_tool',
          description: 'Description of what the tool does',
          parameters: {
            type: 'object',
            properties: {
              // Tool parameters
            },
          },
        },
      },
    ],
    enableCodeExecution: true, // Can be combined with custom tools
  },
});
```

## Implementation Details

### Files Modified

- **`src/lib/openai.ts`**: Enhanced `runResponses()` to support tool calling loop
- **`src/lib/e2b.ts`**: New file with e2b integration and tool definitions
- **`src/activities/longcontext.activities.ts`**: Added tool calling support
- **`src/activities/graphrag.activities.ts`**: Added tool calling support
- **`src/activities/filing-chunks.activities.ts`**: Added tool calling support

### Key Features

1. **Backward Compatible**: All changes are opt-in via parameters
2. **Automatic Tool Loop**: Handles multiple rounds of tool calls automatically
3. **Error Handling**: Graceful degradation when e2b is not configured
4. **Extensible**: Easy to add more tools beyond code execution

## Use Cases

### When to Enable Code Execution

Enable code execution when the LLM might need to:

- Perform complex numerical calculations
- Analyze statistical data
- Parse or transform structured data
- Generate visualizations or charts
- Run data validation or verification

### Example Scenarios

1. **Financial Calculations**: Computing returns, ratios, or correlations from filing data
2. **Statistical Analysis**: Running significance tests on rotation patterns
3. **Data Aggregation**: Summing, averaging, or grouping large datasets
4. **Validation**: Checking data consistency or constraints

## Security Considerations

- **Sandboxed Execution**: All code runs in isolated e2b environments
- **Timeout Protection**: Code execution has built-in timeouts
- **API Key Required**: Code execution requires explicit e2b API configuration
- **Audit Trail**: All tool calls and results are logged in the Temporal workflow history

## Troubleshooting

### Code Execution Fails

If you see errors like "E2B_API_KEY not configured":
1. Ensure `E2B_API_KEY` is set in your environment
2. Verify the API key is valid
3. Check e2b service status

### Tool Calls Not Triggering

If the LLM isn't using tools when expected:
1. Ensure `enableCodeExecution` is set to `true`
2. Check that the prompt encourages code usage
3. Review the system message for tool usage instructions

### Max Rounds Reached

If you see "Max tool calling rounds reached":
1. The LLM made too many tool calls (default: 5)
2. Consider increasing `maxToolRounds` if legitimate
3. Or review prompts to avoid unnecessary iterations
