# GPT-5 Migration Guide

This document describes the migration from GPT-4/o3/o4 models to GPT-5, and from the deprecated Chat Completions API to the new Responses API.

## Version Information

**OpenAI SDK Version**: v6.8.1 (Latest - Upgraded from v4.54.0)

This version includes important fixes and improvements:
- Enhanced stability and performance
- Improved error handling
- Bug fixes and security patches
- Full compatibility with existing GPT-5 Responses API

## Summary

All OpenAI API calls in this project have been upgraded to use:
- **OpenAI SDK**: v6.8.1 (latest stable version)
- **GPT-5 models**: `gpt-5`, `gpt-5-mini`, `gpt-5-nano`
- **Responses API**: `client.responses.create()` instead of `client.chat.completions.create()`
- **New parameters**: `reasoning.effort`, `text.verbosity`, custom tools
- **Safeguards**: Prevents accidental use of deprecated APIs

## What Changed

### 1. Models Upgraded

| Old Model | New Model | Use Case | Reasoning Effort |
|-----------|-----------|----------|------------------|
| `gpt-4.1` | `gpt-5-mini` | Summarization, synthesis | minimal-low |
| `gpt-4` | `gpt-5-mini` | Simple summaries | minimal |
| `o3` | `gpt-5` | Complex reasoning | medium-high |
| `o4-mini` | `gpt-5-mini` | Cost-optimized tasks | low |

### 2. API Migration

**Before (Deprecated):**
```typescript
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }],
  temperature: 0.7,
  max_tokens: 100
});

const text = response.choices[0]?.message?.content;
```

**After (GPT-5 Responses API):**
```typescript
import { runResponse } from '../lib/openai.js';

const text = await runResponse({
  model: 'gpt-5-mini',
  prompt: 'Hello',
  effort: 'minimal',
  verbosity: 'low',
  maxTokens: 100
});
```

### 3. Removed Parameters

These parameters are **NOT** supported in GPT-5:
- ❌ `temperature`
- ❌ `top_p`
- ❌ `logprobs`

Use these instead:
- ✅ `reasoning.effort`: `'minimal' | 'low' | 'medium' | 'high'`
- ✅ `text.verbosity`: `'low' | 'medium' | 'high'`
- ✅ `max_output_tokens`

## Model Selection Guide

### GPT-5 (gpt-5)
**Best for:**
- Complex multi-step reasoning
- Code-heavy tasks with broad context
- Agentic workflows requiring planning
- Tasks needing deep world knowledge

**Reasoning effort:**
- `high`: Most thorough reasoning (slower, more expensive)
- `medium`: Balanced reasoning (recommended starting point)

**Example:**
```typescript
const result = await createResponse({
  model: 'gpt-5',
  input: 'Find the null pointer exception in this 10,000 line codebase...',
  reasoning: { effort: 'high' },
  text: { verbosity: 'high' }
});
```

### GPT-5 Mini (gpt-5-mini)
**Best for:**
- General-purpose summarization
- Data synthesis and analysis
- Cost-optimized reasoning
- Most production use cases

**Reasoning effort:**
- `low`: Fast, cost-effective (recommended)
- `minimal`: Ultra-fast, minimal reasoning
- `medium`: More thorough analysis

**Example:**
```typescript
const summary = await runResponse({
  model: 'gpt-5-mini',
  prompt: 'Summarize this investor rotation event...',
  effort: 'low',
  verbosity: 'medium'
});
```

### GPT-5 Nano (gpt-5-nano)
**Best for:**
- High-throughput classification
- Simple instruction-following
- Latency-critical tasks
- Very cost-sensitive workloads

**Reasoning effort:**
- `minimal`: Recommended for nano

**Example:**
```typescript
const category = await runResponse({
  model: 'gpt-5-nano',
  prompt: 'Classify this transaction: BUY or SELL?',
  effort: 'minimal',
  verbosity: 'low'
});
```

## Current Usage in Project

### 1. Investor Rotation Synthesis
**File:** `apps/temporal-worker/src/activities/longcontext.activities.ts`

**Function:** `synthesizeWithOpenAI()`

**Model:** `gpt-5-mini` with `minimal` reasoning

**Use case:** Explaining rotation edges using provided data (3 paragraphs, cite accessions)

```typescript
const content = await runResponses({
  client,
  input: {
    model: 'gpt-4.1', // Automatically mapped to gpt-5-mini
    input: [
      {
        role: 'system',
        content: 'Use only supplied facts. Provide accession citations like [ACC].',
      },
      {
        role: 'user',
        content: [...] // Edges, accessions, excerpts
      },
    ],
  },
});
```

**Migrated to:** GPT-5-mini with minimal reasoning effort (automatic via `runResponses` wrapper)

### 2. Community Summarization
**File:** `apps/temporal-worker/src/activities/graphrag.activities.ts`

**Function:** `summarizeCommunity()`

**Model:** `gpt-5-mini` with `minimal` reasoning

**Use case:** Summarizing investor flow communities (2 paragraphs)

```typescript
const text = await runResponses({
  client,
  input: {
    model: 'gpt-4.1', // Automatically mapped to gpt-5-mini
    input: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  },
});
```

**Migrated to:** GPT-5-mini with minimal reasoning effort (automatic via `runResponses` wrapper)

### 3. Cluster Summary Creation
**File:** `apps/temporal-worker/src/activities/filing-chunks.activities.ts`

**Function:** `createClusterSummary()`

**Model:** `gpt-5-mini` with `minimal` reasoning

**Use case:** Creating rotation cluster summaries (2-3 sentences)

**Before:**
```typescript
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: prompt }],
  max_tokens: 300,
});

const summary = response.choices[0]?.message?.content ?? 'No summary generated.';
```

**After:**
```typescript
const summary = await runResponse({
  client: openai,
  model: 'gpt-5-mini',
  prompt,
  effort: 'minimal',
  verbosity: 'low',
  maxTokens: 300,
});
```

## New Features

### 1. Custom Tools

GPT-5 supports freeform text inputs to tools (not just structured JSON).

**Example:**
```typescript
const response = await createResponse({
  model: 'gpt-5',
  input: 'Calculate the area of a circle with radius 10',
  tools: [
    {
      type: 'custom',
      name: 'code_exec',
      description: 'Executes arbitrary Python code'
    }
  ]
});

// GPT-5 can send raw Python code as the tool input
// "import math\nradius = 10\narea = math.pi * radius ** 2\nprint(area)"
```

### 2. E2B Code Execution (Optional)

When enabled, GPT-5 can execute Python code in sandboxed E2B environments.

**Setup:**
```bash
# 1. Install E2B SDK (optional)
npm install @e2b/sdk

# 2. Set API key
export E2B_API_KEY=your_api_key
```

**Usage:**
```typescript
const response = await createResponse({
  model: 'gpt-5',
  input: 'Calculate the fibonacci sequence up to n=10',
  e2b_execution: { enabled: true }
});

// GPT-5 will automatically use code_exec tool if needed
```

**Check status:**
```typescript
import { getE2BStatus } from '../lib/e2b-executor.js';

const status = getE2BStatus();
console.log(status);
// { available: true, apiKeyConfigured: true, sdkInstalled: false }
```

### 3. Multi-Turn Conversations with CoT

Pass `previous_response_id` to maintain chain of thought across turns:

```typescript
const response1 = await createResponse({
  model: 'gpt-5',
  input: 'What is 2+2?',
  reasoning: { effort: 'medium' }
});

const response2 = await createResponse({
  model: 'gpt-5',
  input: 'Now multiply that by 3',
  previous_response_id: response1.id, // Passes reasoning from previous turn
  reasoning: { effort: 'medium' }
});
```

This avoids re-reasoning and improves performance.

## Safeguards

### 1. Deprecated Parameter Detection

The library automatically detects and blocks deprecated parameters:

```typescript
// This will throw an error:
await createResponse({
  model: 'gpt-5',
  input: 'Hello',
  temperature: 0.7, // ❌ NOT SUPPORTED
});

// Error:
// ❌ DEPRECATED PARAMETERS DETECTED: temperature
// These parameters are NOT supported in GPT-5 models.
// Instead use:
//   - Reasoning depth: reasoning: { effort: "minimal" | "low" | "medium" | "high" }
//   - Output verbosity: text: { verbosity: "low" | "medium" | "high" }
```

### 2. Chat Completions Blocker

If you accidentally try to use `chat.completions.create()`:

```typescript
import { preventDeprecatedChatCompletions } from '../lib/openai.js';

// This throws a helpful error message
preventDeprecatedChatCompletions();

// Error:
// ❌ DEPRECATED API: client.chat.completions.create() is DEPRECATED for GPT-5
// Use the Responses API instead:
//   - client.responses.create({ model: "gpt-5", input: "...", reasoning: { effort: "medium" } })
```

## Testing

Run the test suite to verify the migration:

```bash
cd apps/temporal-worker
npm test
```

Key test files:
- `src/__tests__/longcontext.test.ts`
- `src/__tests__/graphrag.test.ts`
- `src/__tests__/filing-chunks.test.ts`

## Environment Variables

```bash
# Required
OPENAI_API_KEY=sk-...

# Optional (for E2B code execution)
E2B_API_KEY=e2b_...
```

## Cost Optimization

GPT-5 models offer better performance per dollar:

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Best For |
|-------|----------------------|------------------------|----------|
| gpt-5 | $5.00 | $15.00 | Complex reasoning |
| gpt-5-mini | $0.50 | $2.00 | Most tasks |
| gpt-5-nano | $0.10 | $0.40 | High-throughput |

**Tips:**
1. Use `gpt-5-nano` for classification and simple tasks
2. Use `gpt-5-mini` for most production workloads
3. Use `gpt-5` only for truly complex reasoning
4. Set `effort: 'minimal'` when possible to reduce reasoning tokens
5. Set `verbosity: 'low'` for concise outputs

## Rollback Plan

If you need to rollback to GPT-4:

1. The `runResponses()` wrapper provides backward compatibility
2. Old code will continue to work with automatic model mapping
3. To force GPT-4 usage, you can temporarily:

```typescript
// Bypass wrapper (not recommended for GPT-5)
const response = await openai.chat.completions.create({
  model: 'gpt-4-turbo',
  messages: [...]
});
```

However, this defeats the purpose of the migration and loses GPT-5 benefits.

## References

- [GPT-5 Guide](https://platform.openai.com/docs/guides/gpt-5)
- [Responses API Documentation](https://platform.openai.com/docs/guides/responses)
- [Migration Guide from OpenAI](https://platform.openai.com/docs/guides/gpt-5/migration)
- [Custom Tools Documentation](https://platform.openai.com/docs/guides/function-calling)
- [E2B Documentation](https://e2b.dev/docs)

## Support

For questions or issues:
1. Check this migration guide
2. Review `/apps/temporal-worker/src/lib/openai.ts` for implementation details
3. See examples in `/apps/temporal-worker/src/activities/*.activities.ts`
4. Open an issue with the development team
