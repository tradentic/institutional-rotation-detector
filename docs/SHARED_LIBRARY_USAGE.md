# Shared Library Usage Guide

This guide explains how to use the shared `@libs/openai-gpt5` library from any app in the monorepo.

## Library Location

```
/libs/openai-gpt5/
├── src/
│   ├── index.ts           # Main export interface
│   ├── openai.ts          # GPT-5 Responses API client
│   ├── cot-session.ts     # Chain of Thought session manager
│   └── e2b-executor.ts    # E2B code execution
├── package.json
├── tsconfig.json
└── README.md
```

## Import Methods

### Method 1: TypeScript Path Alias (Recommended)

The cleanest approach using `@libs/openai-gpt5`:

```typescript
// Any app: temporal-worker, api, etc.
import { runResponse, createAnalysisSession } from '@libs/openai-gpt5';

const result = await runResponse({
  model: 'gpt-5-mini',
  prompt: 'Analyze this data...',
  effort: 'minimal'
});
```

**Configuration:** Already configured in `tsconfig.json` for:
- `apps/temporal-worker`
- `apps/api`

To add to other apps, add to `tsconfig.json`:
```json
{
  "compilerOptions": {
    "paths": {
      "@libs/openai-gpt5": ["../../libs/openai-gpt5/src/index.ts"],
      "@libs/openai-gpt5/*": ["../../libs/openai-gpt5/src/*"]
    }
  }
}
```

### Method 2: Relative Path (Always Works)

Direct relative import:

```typescript
// From apps/temporal-worker/src/activities/
import { runResponse } from '../../../../libs/openai-gpt5/src/index.js';

// From apps/api/src/handlers/
import { runResponse } from '../../../libs/openai-gpt5/src/index.js';
```

**Note:** Use `.js` extension even though files are `.ts` (ESM requirement).

---

## Usage Examples by App

### Temporal Worker Activities

```typescript
// apps/temporal-worker/src/activities/my-activity.ts
import { createAnalysisSession } from '@libs/openai-gpt5';

export async function analyzeRotations(input: RotationInput) {
  const session = createAnalysisSession({ enableE2B: true });

  const patterns = await session.respond('Analyze rotation patterns...');
  const stats = await session.executeAndAnalyze(
    'Calculate statistics on 10K rows...',
    'Interpret results'
  );
  const insights = await session.respond('Key insights?');

  return { patterns, stats, insights };
}
```

### API Handlers

```typescript
// apps/api/src/handlers/analyze.ts
import { runResponse, createFastSession } from '@libs/openai-gpt5';

export async function POST(request: Request): Promise<Response> {
  const { data } = await request.json();

  // Option 1: Single-turn
  const analysis = await runResponse({
    model: 'gpt-5-mini',
    prompt: `Analyze: ${JSON.stringify(data)}`,
    effort: 'low',
    verbosity: 'medium'
  });

  // Option 2: Multi-turn session
  const session = createFastSession();
  const overview = await session.respond('Analyze this data...');
  const details = await session.respond('Provide more details');

  return Response.json({ analysis, overview, details });
}
```

### Supabase Edge Functions

```typescript
// supabase/functions/my-function/index.ts
import { createFastSession } from '../../../libs/openai-gpt5/src/index.ts';

Deno.serve(async (req) => {
  const session = createFastSession({
    systemPrompt: 'You are a helpful assistant.'
  });

  const { question } = await req.json();
  const answer = await session.respond(question);

  return Response.json({ answer });
});
```

### Standalone Scripts/Tools

```typescript
// tools/analyze-data.ts
import { createCodeSession } from '../libs/openai-gpt5/src/index.js';

async function main() {
  const session = createCodeSession({ enableE2B: true });

  const { code, executionResult, analysis } = await session.executeAndAnalyze(
    'Process this CSV file and calculate summary statistics',
    'What do the statistics reveal?'
  );

  console.log('Analysis:', analysis);
}

main();
```

---

## Available Exports

### Core API

```typescript
import {
  // Single-turn requests
  runResponse,
  createResponse,

  // Client factory
  createOpenAIClient,

  // Legacy compatibility
  runResponses,

  // Types
  type GPT5Model,
  type ReasoningEffort,
  type Verbosity,
  type ResponseResult,
} from '@libs/openai-gpt5';
```

### Chain of Thought (CoT)

```typescript
import {
  // Main class
  CoTSession,

  // Factory functions
  createAnalysisSession,
  createCodeSession,
  createFastSession,

  // Utilities
  restoreSession,

  // Types
  type CoTSessionConfig,
  type CoTSessionState,
  type CoTTurn,
} from '@libs/openai-gpt5';
```

### E2B Code Execution

```typescript
import {
  // Execution
  executeCode,
  handleCodeExecutionToolCall,

  // Status checks
  isE2BAvailable,
  getE2BStatus,

  // Types
  type E2BExecutionResult,
  type E2BSandboxConfig,
} from '@libs/openai-gpt5';
```

---

## Common Patterns

### Pattern 1: Simple Summarization

```typescript
import { runResponse } from '@libs/openai-gpt5';

const summary = await runResponse({
  model: 'gpt-5-mini',
  prompt: 'Summarize this rotation event in one sentence',
  effort: 'minimal',
  verbosity: 'low'
});
```

### Pattern 2: Multi-Step Analysis

```typescript
import { createAnalysisSession } from '@libs/openai-gpt5';

const session = createAnalysisSession({ enableE2B: true });

const step1 = await session.respond('Analyze dataset...');
const step2 = await session.respond('Calculate metrics...');
const step3 = await session.respond('Identify anomalies...');
const summary = await session.respond('Summarize findings');
```

### Pattern 3: Code Execution + Analysis

```typescript
import { createCodeSession } from '@libs/openai-gpt5';

const session = createCodeSession({ enableE2B: true });

const { code, executionResult, analysis } = await session.executeAndAnalyze(
  'Calculate correlation matrix on 1M rows: [data]',
  'Identify significant correlations'
);
```

### Pattern 4: Session Persistence

```typescript
import { createAnalysisSession, restoreSession } from '@libs/openai-gpt5';

// Start session
const session = createAnalysisSession({ enableE2B: true });
await session.respond('Initial analysis...');

// Save state
const state = session.getState();
await db.saveSession(state);

// Later: restore
const savedState = await db.loadSession(sessionId);
const session = restoreSession(savedState);
await session.respond('Continue analysis...');
```

---

## Environment Variables

Required in any app using the library:

```bash
# Required
OPENAI_API_KEY=sk-...

# Optional (for E2B)
E2B_API_KEY=e2b_...
E2B_TIMEOUT=30000
```

---

## Adding to New Apps

To add the library to a new app:

1. **Add TypeScript path configuration:**

```json
// your-app/tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@libs/openai-gpt5": ["../../libs/openai-gpt5/src/index.ts"],
      "@libs/openai-gpt5/*": ["../../libs/openai-gpt5/src/*"]
    }
  }
}
```

2. **Import and use:**

```typescript
import { runResponse } from '@libs/openai-gpt5';

const result = await runResponse({
  model: 'gpt-5-mini',
  prompt: 'Hello world',
  effort: 'minimal'
});
```

3. **Set environment variables:**

```bash
OPENAI_API_KEY=sk-...
```

---

## Benefits of Shared Library

### ✅ No Code Duplication
- Single source of truth
- All apps use same implementation
- Bug fixes benefit everyone

### ✅ Easy to Import
- Clean `@libs/openai-gpt5` alias
- Or direct relative imports
- Works in any app

### ✅ Type Safety
- Full TypeScript support
- Shared types across apps
- IDE autocomplete

### ✅ Consistent API
- Same interface everywhere
- Same safeguards everywhere
- Same CoT behavior everywhere

### ✅ Easy to Update
- Update library once
- All apps get improvements
- No refactoring needed

---

## Migration from Old Code

### Before (App-Specific)

```typescript
// apps/temporal-worker/src/activities/my-activity.ts
import { runResponses } from '../lib/openai.js';

const result = await runResponses({
  input: { model: 'gpt-4.1', input: [...] }
});
```

### After (Shared Library)

```typescript
// apps/temporal-worker/src/activities/my-activity.ts
import { createAnalysisSession } from '@libs/openai-gpt5';

const session = createAnalysisSession({ enableE2B: true });
const result = await session.respond('...');
```

**Benefits:**
- Access to CoT sessions
- E2B integration
- Token savings (60-80%)
- Same API in API handlers, edge functions, tools

---

## Troubleshooting

### Import Error: Cannot find module '@libs/openai-gpt5'

**Solution:** Check `tsconfig.json` has paths configured:

```json
{
  "compilerOptions": {
    "paths": {
      "@libs/openai-gpt5": ["../../libs/openai-gpt5/src/index.ts"]
    }
  }
}
```

### Import Error: Module not found (relative path)

**Solution:** Use `.js` extension even for `.ts` files:

```typescript
// ❌ Wrong
import { runResponse } from '../../../../libs/openai-gpt5/src/index.ts';

// ✅ Correct
import { runResponse } from '../../../../libs/openai-gpt5/src/index.js';
```

### Type Error: Missing OpenAI dependency

**Solution:** Install openai package in your app:

```bash
cd apps/your-app
npm install openai
```

---

## Documentation

For complete documentation, see:
- **Library README**: `/libs/openai-gpt5/README.md`
- **GPT-5 Migration Guide**: `/docs/GPT5_MIGRATION_GUIDE.md`
- **CoT Workflows Guide**: `/docs/COT_WORKFLOWS_GUIDE.md`
- **Coding Guidelines**: `/docs/CODING_AGENT_GUIDELINES.md`

---

## Summary

**The shared library provides:**
1. ✅ Single source of truth for OpenAI integration
2. ✅ Easy imports via `@libs/openai-gpt5`
3. ✅ Full TypeScript support
4. ✅ CoT session management
5. ✅ E2B code execution
6. ✅ Comprehensive safeguards
7. ✅ Works in all apps (temporal-worker, api, edge functions, tools)

**To use in any app:**
```typescript
import { createAnalysisSession } from '@libs/openai-gpt5';

const session = createAnalysisSession({ enableE2B: true });
const result = await session.respond('Your prompt...');
```

That's it! 🚀
