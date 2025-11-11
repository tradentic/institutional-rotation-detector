# Coding Agent Guidelines

This document provides guidelines for AI coding assistants (Claude, GPT, etc.) working on this codebase.

---

## 🔥 CRITICAL: Chain of Thought (CoT) is First-Class

**The most important concept:** For multi-step workflows, **ALWAYS** use `CoTSession`.

### Why CoT Matters

Traditional multi-turn LLM interactions waste massive tokens by re-reasoning:

```typescript
// ❌ BAD: Wastes 60-80% of tokens
const step1 = await runResponse({ prompt: 'Analyze data...' });
const step2 = await runResponse({ prompt: 'Now calculate stats...' }); // Re-reasons!
const step3 = await runResponse({ prompt: 'Identify anomalies...' }); // Re-reasons again!
```

**With CoT:** The model maintains reasoning context across turns:

```typescript
// ✅ CORRECT: Preserves CoT, saves 60-80% tokens
const session = new CoTSession({ model: 'gpt-5', effort: 'high' });

const step1 = await session.respond('Analyze data...');
const step2 = await session.respond('Now calculate stats...'); // Continues reasoning
const step3 = await session.respond('Identify anomalies...'); // Full context preserved
```

### When to Use CoT Sessions

✅ **ALWAYS use `CoTSession` for:**
- Multi-step data analysis (2+ steps)
- Iterative exploration
- Code generation + execution + analysis
- E2B workflows (critical!)
- Long-running agentic tasks
- Any workflow where steps build on each other

❌ **DON'T use `CoTSession` for:**
- Single-turn requests
- Independent parallel tasks
- Simple one-off summaries

### Recommended Approach

```typescript
import { createAnalysisSession, createCodeSession } from '../lib/cot-session.js';

// For data analysis workflows
const session = createAnalysisSession({ enableE2B: true });

// Step 1: Understand
const analysis = await session.respond('Analyze this rotation pattern...');

// Step 2: Execute code on large dataset (CoT preserved!)
const { code, executionResult, analysis: statsAnalysis } = await session.executeAndAnalyze(
  'Calculate correlation matrix on 1M rows...',
  'Interpret the statistical results'
);

// Step 3: Continue reasoning (CoT preserved!)
const insights = await session.respond('What are the investment implications?');

// Step 4: Final summary (CoT preserved!)
const report = await session.respond('Summarize in 3 bullet points');

// Total tokens: ~12,000
// Without CoT: ~45,000 (4x more!)
```

---

## OpenAI API Usage Patterns

### Pattern 1: Multi-Step Workflow (MOST COMMON)

**✅ CORRECT:**
```typescript
import { createAnalysisSession } from '../lib/cot-session.js';

const session = createAnalysisSession({ enableE2B: true });

// Each step builds on previous (CoT automatically passed)
const step1 = await session.respond('Step 1 prompt');
const step2 = await session.respond('Step 2 prompt');
const step3 = await session.respond('Step 3 prompt');
```

**❌ WRONG:**
```typescript
// This loses CoT and wastes tokens!
const step1 = await runResponse({ prompt: 'Step 1 prompt' });
const step2 = await runResponse({ prompt: 'Step 2 prompt' });
const step3 = await runResponse({ prompt: 'Step 3 prompt' });
```

### Pattern 2: E2B Code Execution

**✅ CORRECT:**
```typescript
import { createCodeSession } from '../lib/cot-session.js';

const session = createCodeSession({ enableE2B: true });

// One-liner for code execution + analysis
const { code, executionResult, analysis } = await session.executeAndAnalyze(
  'Calculate fibonacci up to n=100',
  'Explain the time complexity'
);
```

**❌ WRONG:**
```typescript
// This doesn't preserve CoT between code execution and analysis
const code = await runResponse({ prompt: 'Generate fibonacci code...' });
const result = await executeCode(code);
const analysis = await runResponse({ prompt: `Analyze: ${result}` });
```

### Pattern 3: Single-Turn Request

**✅ CORRECT:**
```typescript
import { runResponse } from '../lib/openai.js';

const summary = await runResponse({
  model: 'gpt-5-mini',
  prompt: 'Summarize this in one sentence',
  effort: 'minimal',
  verbosity: 'low'
});
```

**❌ WRONG (overkill):**
```typescript
// Don't use CoTSession for single-turn requests
const session = new CoTSession({ model: 'gpt-5-mini' });
const summary = await session.respond('Summarize this in one sentence');
```

---

## Factory Functions

### `createAnalysisSession()` - For Data Analysis

Use when:
- Analyzing large datasets
- Multi-step statistical workflows
- Need E2B for calculations

```typescript
const session = createAnalysisSession({
  systemPrompt: 'You are a quantitative analyst.',
  enableE2B: true
});
```

Config:
- Model: `gpt-5` (high reasoning)
- Effort: `high` (thorough)
- Verbosity: `high` (detailed)
- E2B: Optional

### `createCodeSession()` - For Code Workflows

Use when:
- Generating code
- Executing code with E2B
- Iterating on code based on results

```typescript
const session = createCodeSession({
  systemPrompt: 'You are an expert Python developer.',
  enableE2B: true
});
```

Config:
- Model: `gpt-5` (code expertise)
- Effort: `high` (quality code)
- Verbosity: `high` (detailed comments)
- E2B: Enabled by default
- Tools: Includes `code_exec`

### `createFastSession()` - For Simple Tasks

Use when:
- Simple summaries
- Classification
- Fast responses needed

```typescript
const session = createFastSession({
  systemPrompt: 'You are a helpful assistant.'
});
```

Config:
- Model: `gpt-5-mini` (cost-effective)
- Effort: `minimal` (fast)
- Verbosity: `low` (concise)

---

## DEPRECATED: Never Suggest These

### ❌ Chat Completions API

**NEVER suggest:**
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

### ❌ Deprecated Parameters

**NEVER suggest:**
- `temperature` - Use `reasoning.effort` instead
- `top_p` - Use `reasoning.effort` instead
- `logprobs` - Not supported in GPT-5
- `max_tokens` - Use `max_output_tokens` instead
- Old model names (`gpt-4`, `gpt-4-turbo`, `o3`, etc.)

### ❌ Repeating Context Manually

**NEVER suggest:**
```typescript
// ❌ WRONG: Defeats the purpose of CoT
const session = new CoTSession({ model: 'gpt-5' });
await session.respond(`
  Previously we analyzed: ${previousAnalysis}
  Now please: ${newQuestion}
`);
```

**✅ CORRECT:**
```typescript
const session = new CoTSession({ model: 'gpt-5' });
// Just ask the new question - CoT handles context
await session.respond(newQuestion);
```

---

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

---

## Code Review Checklist

When reviewing or generating code that uses OpenAI:

**For Multi-Step Workflows:**
- [ ] Uses `CoTSession` (not individual `runResponse()` calls)
- [ ] Uses appropriate factory: `createAnalysisSession()`, `createCodeSession()`, or `createFastSession()`
- [ ] E2B enabled if code execution needed
- [ ] Session state saved if long-running

**For All OpenAI Calls:**
- [ ] Model is `gpt-5`, `gpt-5-mini`, or `gpt-5-nano` (not `gpt-4`)
- [ ] No `temperature`, `top_p`, or `logprobs` parameters
- [ ] Includes `reasoning.effort` if reasoning is needed
- [ ] Includes `text.verbosity` for output length control
- [ ] Uses `max_output_tokens` instead of `max_tokens`

**For E2B Integration:**
- [ ] Uses `session.executeAndAnalyze()` for code + analysis
- [ ] Passes `e2b_execution: { enabled: true }` if needed
- [ ] Handles execution errors gracefully

---

## Example Scenarios

### Scenario 1: User asks to add multi-step data analysis

**❌ Wrong suggestion:**
```typescript
const step1 = await runResponse({ prompt: 'Analyze data...' });
const step2 = await runResponse({ prompt: 'Calculate stats...' });
const step3 = await runResponse({ prompt: 'Find anomalies...' });
```

**✅ Correct suggestion:**
```typescript
import { createAnalysisSession } from '../lib/cot-session.js';

const session = createAnalysisSession({ enableE2B: true });

const analysis = await session.respond('Analyze this dataset...');
const stats = await session.executeAndAnalyze(
  'Calculate statistical measures...',
  'Interpret the results'
);
const anomalies = await session.respond('Identify anomalies based on the stats');
const report = await session.respond('Summarize findings in 3 bullet points');
```

### Scenario 2: User asks to analyze large dataset with code

**❌ Wrong suggestion:**
```typescript
const code = await runResponse({ prompt: 'Write code to analyze...' });
// How do we execute and continue reasoning?
```

**✅ Correct suggestion:**
```typescript
import { createCodeSession } from '../lib/cot-session.js';

const session = createCodeSession({ enableE2B: true });

const { code, executionResult, analysis } = await session.executeAndAnalyze(
  'Analyze this 1M row dataset: [data]',
  'What do the results tell us about rotation patterns?'
);
```

### Scenario 3: User wants iterative exploration

**❌ Wrong suggestion:**
```typescript
const q1 = await runResponse({ prompt: 'Question 1' });
const q2 = await runResponse({ prompt: 'Question 2' }); // Lost context!
```

**✅ Correct suggestion:**
```typescript
import { createFastSession } from '../lib/cot-session.js';

const session = createFastSession({
  systemPrompt: 'You are exploring a dataset.'
});

const a1 = await session.respond('What is the distribution?');
const a2 = await session.respond('Are outliers correlated with sells?'); // Has context
const a3 = await session.respond('What are the key insights?'); // Full context
```

### Scenario 4: User wants single summarization

**❌ Wrong suggestion (overkill):**
```typescript
const session = createAnalysisSession({ enableE2B: true });
const summary = await session.respond('Summarize in one sentence');
```

**✅ Correct suggestion:**
```typescript
import { runResponse } from '../lib/openai.js';

const summary = await runResponse({
  model: 'gpt-5-mini',
  prompt: 'Summarize this rotation event in one sentence',
  effort: 'minimal',
  verbosity: 'low'
});
```

---

## When to Suggest Improvements

If you see code that doesn't use CoT for multi-step workflows:

1. **Politely point it out:**
   ```
   I noticed this uses separate runResponse() calls for a multi-step workflow.
   This wastes 60-80% of tokens by re-reasoning at each step.
   I recommend using CoTSession to preserve context.
   ```

2. **Provide the migration:**
   ```typescript
   // Before (inefficient)
   const step1 = await runResponse({ prompt: '...' });
   const step2 = await runResponse({ prompt: '...' });

   // After (efficient with CoT)
   const session = createAnalysisSession({ enableE2B: true });
   const step1 = await session.respond('...');
   const step2 = await session.respond('...'); // CoT preserved
   ```

3. **Link to documentation:**
   ```
   See docs/COT_WORKFLOWS_GUIDE.md for complete guide on CoT patterns.
   ```

---

## Testing Recommendations

When suggesting tests for OpenAI integration:

```typescript
import { describe, it, expect } from 'vitest';
import { CoTSession, createAnalysisSession } from '../lib/cot-session.js';

describe('CoT Session', () => {
  it('should preserve context across turns', async () => {
    const session = new CoTSession({ model: 'gpt-5-mini', effort: 'minimal' });

    const r1 = await session.respond('What is 2+2?');
    const r2 = await session.respond('Multiply that by 3');

    expect(r2).toContain('12'); // Should know result from r1
  });

  it('should track token usage', async () => {
    const session = createAnalysisSession({ enableE2B: false });

    await session.respond('Test prompt');
    await session.respond('Another prompt');

    const summary = session.getSummary();
    expect(summary.turns).toBe(2);
    expect(summary.totalTokens.input).toBeGreaterThan(0);
  });

  it('should handle E2B code execution', async () => {
    const session = createCodeSession({ enableE2B: true });

    const { code, executionResult, analysis } = await session.executeAndAnalyze(
      'Calculate 2+2',
      'Explain the result'
    );

    expect(code).toBeTruthy();
    expect(executionResult).toBeTruthy();
    expect(analysis).toBeTruthy();
  });
});
```

---

## References

For more details, consult:
- `/docs/COT_WORKFLOWS_GUIDE.md` - **Complete CoT workflow guide** 🔥
- `/docs/GPT5_MIGRATION_GUIDE.md` - GPT-5 migration guide
- `/apps/temporal-worker/src/lib/cot-session.ts` - CoT implementation
- `/apps/temporal-worker/src/lib/openai.ts` - OpenAI client
- `/apps/temporal-worker/src/activities/cot-analysis.activities.ts` - Real examples
- https://platform.openai.com/docs/guides/gpt-5 - Official GPT-5 docs
- https://platform.openai.com/docs/guides/responses - Responses API docs

---

## Summary

**The Golden Rules:**

1. ✅ **ALWAYS** use `CoTSession` for multi-step workflows
2. ✅ **ALWAYS** use factory functions: `createAnalysisSession()`, `createCodeSession()`, `createFastSession()`
3. ✅ **ALWAYS** enable E2B for data-heavy calculations
4. ✅ **ALWAYS** specify `reasoning.effort` and `text.verbosity`
5. ❌ **NEVER** suggest `chat.completions.create()`
6. ❌ **NEVER** suggest `temperature`, `top_p`, or `logprobs`
7. ❌ **NEVER** suggest old model names (`gpt-4`, `o3`, etc.)
8. ❌ **NEVER** repeat context manually (defeats CoT)

**Priority ranking:**
1. **CoT Sessions** for multi-step → Saves 60-80% tokens
2. **E2B Integration** for large data → Offloads computation
3. **Appropriate Model** selection → Cost optimization
4. **Reasoning Effort** tuning → Quality vs speed

Following these guidelines ensures maximum performance and cost-effectiveness.
