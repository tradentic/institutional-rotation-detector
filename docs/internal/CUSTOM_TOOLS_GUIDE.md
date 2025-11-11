# Custom Tools Guide - Freeform Inputs & CFGs

This guide covers advanced custom tool features in GPT-5, including freeform text inputs, context-free grammars (CFGs), and allowed_tools restrictions.

## Table of Contents

- [Freeform Inputs](#freeform-inputs)
- [Context-Free Grammars (CFGs)](#context-free-grammars-cfgs)
- [Allowed Tools](#allowed-tools)
- [Tool Choice Options](#tool-choice-options)
- [Best Practices](#best-practices)

## Freeform Inputs

Custom tools accept **any raw text** as input—code, SQL queries, shell commands, configuration files, or long-form prose—without JSON structure constraints.

### Basic Example

```typescript
import { createClient, CoTSession } from '@libs/openai-client';

const client = createClient({ model: 'gpt-5' });
const session = new CoTSession({
  client,
  tools: [
    {
      type: 'custom',
      name: 'code_exec',
      description: 'Executes arbitrary Python code',
      // No format = accepts any freeform text
    },
  ],
});

const response = await session.respondFull(
  'Use code_exec to calculate fibonacci(100)'
);

// Model returns custom_tool_call with Python code as plain text
for (const item of response.items) {
  if (item.type === 'custom_tool_call') {
    console.log('Tool:', item.custom_tool_call?.name);
    console.log('Code:', item.custom_tool_call?.input);
  }
}
```

### Why Custom Tools for Code?

| Aspect | Function Tools (JSON) | Custom Tools (Text) |
|--------|----------------------|---------------------|
| **Input Format** | JSON schema required | Plain text |
| **Code Execution** | Must wrap in JSON | Direct code string |
| **Complexity** | High (schema definition) | Low (just description) |
| **Use Case** | Structured data (weather, search) | Freeform (code, SQL, prose) |

**✅ Correct for Code:**
```typescript
{
  type: 'custom',
  name: 'code_exec',
  description: 'Executes arbitrary Python code',
}
```

**❌ Overkill for Code:**
```typescript
{
  type: 'function',
  name: 'code_exec',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string' }, // Unnecessary wrapper
    },
  },
}
```

## Context-Free Grammars (CFGs)

Constrain custom tool outputs to specific syntax or DSLs using Lark or regex grammars.

### Lark Grammar Example (SQL Constraints)

```typescript
import { createClient, CoTSession, type CustomTool } from '@libs/openai-client';

const sqlTool: CustomTool = {
  type: 'custom',
  name: 'sql_query',
  description: 'Generates SELECT queries for the database',
  format: {
    type: 'grammar',
    syntax: 'lark',
    definition: `
      start: select_stmt

      select_stmt: "SELECT" columns "FROM" table_name where_clause?

      columns: column_name ("," column_name)*
      column_name: /[a-z_][a-z0-9_]*/

      table_name: /[a-z_][a-z0-9_]*/

      where_clause: "WHERE" condition
      condition: column_name operator value
      operator: "=" | ">" | "<" | ">=" | "<="
      value: /[0-9]+/ | /"[^"]*"/

      %import common.WS
      %ignore WS
    `,
  },
};

const client = createClient({ model: 'gpt-5' });
const session = new CoTSession({
  client,
  tools: [sqlTool],
});

const response = await session.respondFull(
  'Use sql_query to find all users older than 25'
);

// Model output will conform to the Lark grammar
// Valid:   SELECT name, age FROM users WHERE age > 25
// Invalid: DROP TABLE users;  ❌ (not in grammar)
```

### Regex Grammar Example (Date Formatting)

```typescript
import { createClient, CoTSession, type CustomTool } from '@libs/openai-client';

const timestampTool: CustomTool = {
  type: 'custom',
  name: 'timestamp',
  description: 'Saves timestamp in specific format',
  format: {
    type: 'grammar',
    syntax: 'regex',
    definition: '^(?P<month>January|February|March|April|May|June|July|August|September|October|November|December)\\s+(?P<day>\\d{1,2})(?:st|nd|rd|th)?\\s+(?P<year>\\d{4})\\s+at\\s+(?P<hour>0?[1-9]|1[0-2])(?P<ampm>AM|PM)$',
  },
};

const client = createClient({ model: 'gpt-5' });
const session = new CoTSession({
  client,
  tools: [timestampTool],
});

const response = await session.respondFull(
  'Use timestamp tool to save: August 7th 2025 at 10AM'
);

// Model output: "August 7th 2025 at 10AM" ✅
// Invalid:       "2025-08-07 10:00" ❌ (doesn't match regex)
```

### Math Expression Grammar (Lark)

```typescript
const mathTool: CustomTool = {
  type: 'custom',
  name: 'math_exp',
  description: 'Creates valid mathematical expressions',
  format: {
    type: 'grammar',
    syntax: 'lark',
    definition: `
      start: expr

      expr: term (SP ADD SP term)* -> add
          | term

      term: factor (SP MUL SP factor)* -> mul
          | factor

      factor: INT

      SP: " "
      ADD: "+"
      MUL: "*"

      %import common.INT
    `,
  },
};

// Valid outputs: "4 + 4", "2 * 3 + 5", "10"
// Invalid: "4 / 2" ❌ (division not in grammar)
```

### CFG Best Practices

#### ✅ Correct: Single Bounded Terminal

```lark
start: SENTENCE

SENTENCE: /[A-Za-z, ]*(the hero|a dragon|an old man|the princess)[A-Za-z, ]*(fought|saved|found|lost)[A-Za-z, ]*(a treasure|the kingdom|a secret|his way)[A-Za-z, ]*\./
```

**Why:** Lexer matches entire pattern once with exact structure.

#### ❌ Incorrect: Splitting Across Rules

```lark
start: sentence

sentence: /[A-Za-z, ]+/ subject /[A-Za-z, ]+/ verb /[A-Za-z, ]+/ object /[A-Za-z, ]+/
```

**Why:** Lexer greedily matches free text—you lose control over structure.

#### Key CFG Rules

1. **Keep grammars simple** - Complex grammars may be rejected by API
2. **Use bounded quantifiers** - `{0,10}` instead of unbounded `*`
3. **Explicit whitespace** - Don't rely on `%ignore` directives
4. **Terminals vs Rules** - Terminals for tokens, rules for composition
5. **Test first** - Use [Lark IDE](https://www.lark-parser.org/ide/) to verify grammar

## Allowed Tools

Restrict model to a subset of available tools for safety and predictability.

### Basic Usage

```typescript
import { createClient, CoTSession, type ToolChoice } from '@libs/openai-client';

const client = createClient({ model: 'gpt-5' });

// Define all possible tools
const allTools = [
  { type: 'function', name: 'get_weather', /* ... */ },
  { type: 'function', name: 'search_docs', /* ... */ },
  { type: 'custom', name: 'code_exec', /* ... */ },
  { type: 'function', name: 'send_email', /* ... */ },
];

const session = new CoTSession({
  client,
  tools: allTools, // All tools available
});

// Restrict to only weather and search
const toolChoice: ToolChoice = {
  type: 'allowed_tools',
  mode: 'auto', // Model may pick any of these (or none)
  tools: [
    { type: 'function', name: 'get_weather' },
    { type: 'function', name: 'search_docs' },
  ],
};

const response = await session.respondFull(
  'What is the weather in Paris and find docs about climate',
  { tool_choice: toolChoice }
);

// Model can ONLY call get_weather or search_docs
// Will NOT call code_exec or send_email
```

### Mode: Auto vs Required

```typescript
// Mode: auto - Model may call 0, 1, or multiple allowed tools
const autoChoice: ToolChoice = {
  type: 'allowed_tools',
  mode: 'auto',
  tools: [
    { type: 'function', name: 'get_weather' },
    { type: 'custom', name: 'code_exec' },
  ],
};

// Mode: required - Model MUST call at least one allowed tool
const requiredChoice: ToolChoice = {
  type: 'allowed_tools',
  mode: 'required',
  tools: [
    { type: 'function', name: 'get_weather' },
  ],
};
```

### Benefits of Allowed Tools

1. **Safety** - Prevent unintended tool usage (e.g., don't allow email in analysis phase)
2. **Predictability** - Control which tools can be called at each conversation step
3. **Prompt Caching** - Define all tools once, restrict dynamically
4. **No Brittle Prompts** - Avoid hard-coded "only use X" instructions

### Example: Multi-Step Workflow

```typescript
import { createClient, CoTSession } from '@libs/openai-client';

const client = createClient({ model: 'gpt-5' });
const session = new CoTSession({
  client,
  tools: [
    { type: 'function', name: 'fetch_data', /* ... */ },
    { type: 'custom', name: 'code_exec', /* ... */ },
    { type: 'function', name: 'send_report', /* ... */ },
  ],
});

// Step 1: Only allow data fetching
const step1 = await session.respondFull('Get user data', {
  tool_choice: {
    type: 'allowed_tools',
    mode: 'required',
    tools: [{ type: 'function', name: 'fetch_data' }],
  },
});

// Step 2: Only allow code execution for analysis
const step2 = await session.respondFull('Analyze the data', {
  tool_choice: {
    type: 'allowed_tools',
    mode: 'auto',
    tools: [{ type: 'custom', name: 'code_exec' }],
  },
});

// Step 3: Only allow sending report
const step3 = await session.respondFull('Send summary to stakeholders', {
  tool_choice: {
    type: 'allowed_tools',
    mode: 'required',
    tools: [{ type: 'function', name: 'send_report' }],
  },
});
```

## Tool Choice Options

Complete reference of all tool choice options.

### String Options

```typescript
// Auto: Model decides (0, 1, or multiple tools)
tool_choice: 'auto'

// Required: Model must call at least one tool
tool_choice: 'required'

// None: Don't call any tools
tool_choice: 'none'
```

### Force Specific Function

```typescript
import type { ToolChoice } from '@libs/openai-client';

const forceWeather: ToolChoice = {
  type: 'function',
  name: 'get_weather',
};

const response = await session.respondFull('What should I do today?', {
  tool_choice: forceWeather, // MUST call get_weather
});
```

### Force Specific Custom Tool

```typescript
import type { ToolChoice } from '@libs/openai-client';

const forceCode: ToolChoice = {
  type: 'custom',
  name: 'code_exec',
};

const response = await session.respondFull('Calculate fibonacci', {
  tool_choice: forceCode, // MUST call code_exec
});
```

### Allowed Tools (Subset)

```typescript
import type { ToolChoice } from '@libs/openai-client';

const allowedChoice: ToolChoice = {
  type: 'allowed_tools',
  mode: 'auto', // or 'required'
  tools: [
    { type: 'function', name: 'get_weather' },
    { type: 'custom', name: 'code_exec' },
  ],
};
```

## Best Practices

### 1. Use Custom Tools for Freeform Text

✅ **Good:**
```typescript
{
  type: 'custom',
  name: 'code_exec',
  description: 'Executes arbitrary Python code',
}
```

❌ **Bad:**
```typescript
{
  type: 'function',
  name: 'code_exec',
  parameters: { /* complex JSON schema for code */ },
}
```

### 2. Write Clear Tool Descriptions

✅ **Good:**
```typescript
{
  type: 'custom',
  name: 'code_exec',
  description: 'Executes Python code in a sandboxed E2B environment. Use this for calculations, data analysis, or any computational task. The code will be executed and results returned.',
}
```

❌ **Bad:**
```typescript
{
  type: 'custom',
  name: 'code_exec',
  description: 'Runs code',
}
```

### 3. Validate Outputs Server-Side

```typescript
import { executeCode } from '@libs/openai-client';

async function handleCustomToolCall(toolCall: CustomToolCall) {
  if (toolCall.name === 'code_exec') {
    const code = toolCall.input;

    // ✅ Validate for safety
    if (code.includes('import os') || code.includes('subprocess')) {
      return 'ERROR: Unsafe imports detected';
    }

    // Execute in sandbox
    const result = await executeCode(code, { timeout: 10000 });
    return result.stdout;
  }
}
```

### 4. Use CFGs for Domain-Specific Languages

If you have a specific syntax (SQL, DSL, config format), use CFGs:

```typescript
// ✅ Good: Enforce SQL grammar
{
  type: 'custom',
  name: 'sql_query',
  description: 'Generates SQL SELECT queries',
  format: {
    type: 'grammar',
    syntax: 'lark',
    definition: sqlGrammar,
  },
}

// ❌ Bad: Hope model follows instructions
{
  type: 'custom',
  name: 'sql_query',
  description: 'Generates SQL queries. IMPORTANT: Only use SELECT statements!',
}
```

### 5. Use Allowed Tools for Safety

```typescript
// ✅ Good: Explicitly restrict dangerous tools
const analysisChoice: ToolChoice = {
  type: 'allowed_tools',
  mode: 'auto',
  tools: [
    { type: 'custom', name: 'code_exec' },
    { type: 'function', name: 'search_docs' },
  ],
  // Excludes: send_email, delete_data, etc.
};

// ❌ Bad: Allow all tools and hope for the best
tool_choice: 'auto'
```

### 6. Test Grammars Iteratively

1. Start simple
2. Test in [Lark IDE](https://www.lark-parser.org/ide/)
3. Iterate on grammar definition
4. Update prompt/description if model goes out of distribution
5. Consider higher reasoning effort for complex grammars

## Complete Example: Multi-Tool Workflow

```typescript
import {
  createClient,
  CoTSession,
  type CustomTool,
  type FunctionTool,
  type ToolChoice,
} from '@libs/openai-client';

// Define tools
const tools = [
  {
    type: 'function',
    name: 'fetch_dataset',
    description: 'Fetches dataset from database',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
  } as FunctionTool,

  {
    type: 'custom',
    name: 'code_exec',
    description: 'Executes Python code for analysis',
  } as CustomTool,

  {
    type: 'custom',
    name: 'sql_query',
    description: 'Generates validated SQL queries',
    format: {
      type: 'grammar',
      syntax: 'lark',
      definition: sqlGrammar,
    },
  } as CustomTool,
];

const client = createClient({ model: 'gpt-5' });
const session = new CoTSession({ client, tools });

// Step 1: Fetch data (only allow database fetch)
const dataFetch = await session.respondFull('Get user analytics data', {
  tool_choice: {
    type: 'allowed_tools',
    mode: 'required',
    tools: [{ type: 'function', name: 'fetch_dataset' }],
  },
});

// Step 2: Analyze with code (only allow code execution)
const analysis = await session.respondFull('Calculate correlation matrix', {
  tool_choice: {
    type: 'allowed_tools',
    mode: 'auto',
    tools: [{ type: 'custom', name: 'code_exec' }],
  },
});

// Step 3: Generate SQL for storage (force SQL tool)
const sqlGen = await session.respondFull('Create SQL to store results', {
  tool_choice: {
    type: 'custom',
    name: 'sql_query',
  },
});

console.log('Workflow complete!');
console.log('Analysis:', analysis.output_text);
```

## Troubleshooting

### Model Not Using Custom Tool

**Problem:** Model returns code in text instead of calling custom tool

**Solutions:**
1. Make prompt explicit: "Use the code_exec tool to calculate..."
2. Force tool usage: `tool_choice: { type: 'custom', name: 'code_exec' }`
3. Improve tool description with examples

### Grammar Too Complex

**Error:** API rejects grammar as too complex

**Solutions:**
1. Simplify grammar rules
2. Remove unbounded quantifiers (`*`, `+`)
3. Use bounded quantifiers: `{0,10}`
4. Remove `%ignore` directives

### Model Goes Out of Distribution with CFG

**Problem:** Outputs are syntactically valid but semantically wrong

**Solutions:**
1. Tighten grammar rules
2. Add few-shot examples to prompt
3. Improve tool description
4. Increase reasoning effort: `effort: 'high'`

## Resources

- [Lark Parser IDE](https://www.lark-parser.org/ide/) - Test Lark grammars
- [Rust Regex Syntax](https://docs.rs/regex/latest/regex/#syntax) - For regex CFGs
- [OpenAI Function Calling Cookbook](https://cookbook.openai.com/) - More examples
- [E2B Usage Guide](./E2B_USAGE_GUIDE.md) - E2B code execution details
