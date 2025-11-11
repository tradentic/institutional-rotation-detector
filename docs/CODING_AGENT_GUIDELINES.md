# Coding Agent Guidelines

This document provides guidelines for AI coding assistants (Claude, GPT, etc.) working on this codebase.

## CRITICAL: OpenAI API Usage

### ✅ DO: Use GPT-5 Responses API

**Correct approach:**
```typescript
import { runResponse, createResponse } from '../lib/openai.js';

// Simple use case
const summary = await runResponse({
  model: 'gpt-5-mini',
  prompt: 'Summarize this data...',
  effort: 'minimal',
  verbosity: 'low'
});

// Advanced use case with custom tools
const response = await createResponse({
  model: 'gpt-5',
  input: 'Calculate fibonacci sequence...',
  reasoning: { effort: 'medium' },
  text: { verbosity: 'medium' },
  tools: [
    {
      type: 'custom',
      name: 'code_exec',
      description: 'Executes Python code'
    }
  ]
});
```

### ❌ DON'T: Use Deprecated Chat Completions API

**NEVER suggest this:**
```typescript
// ❌ DEPRECATED - DO NOT USE
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }],
  temperature: 0.7,  // NOT supported in GPT-5
  max_tokens: 100
});
```

**Why it's wrong:**
1. `chat.completions.create()` is deprecated for GPT-5
2. `temperature`, `top_p`, `logprobs` are not supported
3. Cannot pass chain of thought between turns
4. Missing reasoning effort and verbosity controls
5. No support for custom tools

### ❌ DON'T: Suggest Deprecated Parameters

When you see code review requests or new features, **NEVER** suggest:
- `temperature` - Use `reasoning.effort` instead
- `top_p` - Use `reasoning.effort` instead
- `logprobs` - Not supported in GPT-5
- `max_tokens` - Use `max_output_tokens` instead
- Old model names (`gpt-4`, `gpt-4-turbo`, `o3`, etc.) - Use `gpt-5`, `gpt-5-mini`, `gpt-5-nano`

## Model Selection Guidelines

When suggesting OpenAI API calls, choose the appropriate model:

### Use `gpt-5` when:
- Complex multi-step reasoning required
- Code analysis or generation (>100 lines)
- Broad world knowledge needed
- Agentic workflows with planning
- **Effort:** `medium` or `high`
- **Verbosity:** `medium` or `high`

### Use `gpt-5-mini` when (MOST COMMON):
- General-purpose summarization
- Data synthesis (3-5 paragraphs)
- Explaining trends or patterns
- Cost-optimized reasoning
- **Effort:** `minimal` or `low`
- **Verbosity:** `low` or `medium`

### Use `gpt-5-nano` when:
- Simple classification (BUY/SELL, positive/negative)
- Yes/no questions
- High-throughput tasks
- Latency-critical operations
- **Effort:** `minimal`
- **Verbosity:** `low`

## Code Review Checklist

When reviewing or generating code that uses OpenAI:

- [ ] Uses `runResponse()` or `createResponse()` from `../lib/openai.js`
- [ ] Model is `gpt-5`, `gpt-5-mini`, or `gpt-5-nano` (not `gpt-4`)
- [ ] No `temperature`, `top_p`, or `logprobs` parameters
- [ ] Includes `reasoning.effort` if reasoning is needed
- [ ] Includes `text.verbosity` for output length control
- [ ] Uses `max_output_tokens` instead of `max_tokens`
- [ ] If multi-turn, uses `previous_response_id` to pass CoT
- [ ] If using tools, defines them as `CustomTool` or `FunctionTool` type

## Example Scenarios

### Scenario 1: User asks to add summarization

**❌ Wrong suggestion:**
```typescript
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: prompt }],
  temperature: 0.7
});
```

**✅ Correct suggestion:**
```typescript
import { runResponse } from '../lib/openai.js';

const summary = await runResponse({
  model: 'gpt-5-mini',
  prompt: 'Summarize this investor rotation event...',
  effort: 'low',
  verbosity: 'medium'
});
```

### Scenario 2: User asks to classify data

**❌ Wrong suggestion:**
```typescript
const completion = await openai.chat.completions.create({
  model: 'gpt-3.5-turbo',
  messages: [{ role: 'user', content: 'Classify: ' + text }]
});
```

**✅ Correct suggestion:**
```typescript
import { runResponse } from '../lib/openai.js';

const category = await runResponse({
  model: 'gpt-5-nano',  // Fast, cost-effective for classification
  prompt: `Classify this transaction as BUY or SELL: ${text}`,
  effort: 'minimal',
  verbosity: 'low'
});
```

### Scenario 3: User asks to add code analysis

**❌ Wrong suggestion:**
```typescript
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'system', content: 'You are a code reviewer' },
    { role: 'user', content: code }
  ],
  max_tokens: 500
});
```

**✅ Correct suggestion:**
```typescript
import { runResponse } from '../lib/openai.js';

const analysis = await runResponse({
  model: 'gpt-5',  // Complex reasoning for code
  systemPrompt: 'You are an expert code reviewer',
  prompt: code,
  effort: 'high',  // Deep analysis
  verbosity: 'high',  // Detailed output
  maxTokens: 500
});
```

### Scenario 4: User wants to execute code

**✅ Correct suggestion with E2B:**
```typescript
import { createResponse } from '../lib/openai.js';

const response = await createResponse({
  model: 'gpt-5',
  input: 'Calculate the first 10 fibonacci numbers',
  reasoning: { effort: 'medium' },
  e2b_execution: { enabled: true }  // Enables code execution
});

// GPT-5 will automatically use code_exec custom tool
console.log(response.output_text);
```

## When to Suggest Improvements

If you see deprecated API usage in the codebase:

1. **Politely point it out:**
   ```
   I noticed this code uses the deprecated chat.completions API.
   I recommend migrating to the Responses API for better performance.
   ```

2. **Provide the migration:**
   ```typescript
   // Before (deprecated)
   const response = await openai.chat.completions.create({...});

   // After (recommended)
   const summary = await runResponse({...});
   ```

3. **Link to documentation:**
   ```
   See docs/GPT5_MIGRATION_GUIDE.md for full details.
   ```

## Testing Recommendations

When suggesting tests for OpenAI integration:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runResponse } from '../lib/openai.js';

describe('OpenAI Integration', () => {
  it('should use GPT-5 mini for summarization', async () => {
    const summary = await runResponse({
      model: 'gpt-5-mini',
      prompt: 'Test prompt',
      effort: 'minimal',
      verbosity: 'low'
    });

    expect(summary).toBeTruthy();
    expect(typeof summary).toBe('string');
  });

  it('should not use deprecated parameters', () => {
    // This should throw an error
    expect(() => {
      createResponse({
        model: 'gpt-5',
        input: 'test',
        temperature: 0.7  // ❌ Deprecated
      });
    }).toThrow(/DEPRECATED PARAMETERS/);
  });
});
```

## References

For more details, consult:
- `/docs/GPT5_MIGRATION_GUIDE.md` - Complete migration guide
- `/apps/temporal-worker/src/lib/openai.ts` - Implementation
- https://platform.openai.com/docs/guides/gpt-5 - Official GPT-5 docs
- https://platform.openai.com/docs/guides/responses - Responses API docs

## Summary

When working with this codebase:

1. ✅ **ALWAYS** use `runResponse()` or `createResponse()`
2. ✅ **ALWAYS** choose appropriate GPT-5 model variant
3. ✅ **ALWAYS** specify `reasoning.effort` and `text.verbosity`
4. ❌ **NEVER** suggest `chat.completions.create()`
5. ❌ **NEVER** suggest `temperature`, `top_p`, or `logprobs`
6. ❌ **NEVER** suggest old model names (`gpt-4`, `o3`, etc.)

Following these guidelines ensures code quality, performance, and cost-effectiveness.
