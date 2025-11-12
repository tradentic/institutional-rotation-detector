# Development Guide

Guide for contributing to the Institutional Rotation Detector project.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Environment](#development-environment)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Debugging](#debugging)
- [Contributing](#contributing)
- [Release Process](#release-process)

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 15+ with pgvector
- Temporal CLI
- Git
- Code editor (VS Code recommended)

### Initial Setup

```bash
# Clone repository
git clone https://github.com/yourusername/institutional-rotation-detector.git
cd institutional-rotation-detector

# Install dependencies (from repo root - installs all apps and libs)
pnpm install

# Install Supabase and Temporal CLIs
brew install supabase/tap/supabase temporal

# Start Supabase (Terminal 1)
supabase start

# Apply all database migrations via Supabase CLI
supabase db reset

# (Optional) Seed fund managers for faster first run
pnpm run seed:managers  # Pre-seeds 20+ common institutional fund managers
pnpm run seed:index     # Seeds index calendar data
# Note: Seeding is optional - workflows auto-create missing fund manager entities

# Sync environment variables to all apps
./tools/sync-supabase-env.sh
./tools/sync-temporal-env.sh

# Add your API keys to apps/temporal-worker/.env.local
# - OPENAI_API_KEY
# - SEC_USER_AGENT

# Start Temporal dev server (Terminal 2)
temporal server start-dev

# Create search attributes
./tools/setup-temporal-attributes.sh

# Build project (from repo root)
pnpm build

# Run tests
pnpm test
```

---

## Development Environment

### Recommended Tools

**VS Code Extensions:**
- ESLint
- Prettier
- TypeScript and JavaScript Language Features
- Temporal extension
- PostgreSQL client

**Configuration:**

`.vscode/settings.json`:
```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.preferences.importModuleSpecifier": "non-relative"
}
```

### Environment Variables

Create `.env` in `apps/temporal-worker/`:

```bash
# Development environment
NODE_ENV=development

# Database
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Temporal
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=rotation-detector
TEMPORAL_ADDRESS=localhost:7233

# OpenAI
OPENAI_API_KEY=sk-your-test-key
OPENAI_MODEL=gpt-4-turbo-preview

# SEC
SEC_USER_AGENT=YourName your.email@domain.com

# Application
QUARTER_BATCH=2  # Lower for faster dev iterations
RATE_LIMIT_PER_SECOND=10
```

### Running Services

**Terminal 1: Temporal Server**
```bash
temporal server start-dev
```

**Terminal 2: Worker**
```bash
# Build from repo root
pnpm run build:worker

# Start worker
cd apps/temporal-worker
node dist/worker.js
```

**Terminal 3: Tests**
```bash
# Run tests from repo root
pnpm test

# Or run in watch mode
pnpm test --watch
```

---

## Project Structure

```
institutional-rotation-detector/
├── apps/
│   ├── api/                      # REST API
│   │   └── routes/              # API route handlers
│   │       ├── events.get.ts
│   │       ├── explain.post.ts
│   │       ├── graph.get.ts
│   │       ├── run.post.ts
│   │       └── graph/           # Graph-specific routes
│   │
│   └── temporal-worker/         # Temporal worker
│       ├── src/
│       │   ├── workflows/       # Workflow definitions
│       │   │   ├── ingestIssuer.workflow.ts
│       │   │   ├── rotationDetect.workflow.ts
│       │   │   ├── graphBuild.workflow.ts
│       │   │   └── ...
│       │   │
│       │   ├── activities/      # Activity implementations
│       │   │   ├── edgar.activities.ts
│       │   │   ├── compute.activities.ts
│       │   │   ├── graph.activities.ts
│       │   │   └── ...
│       │   │
│       │   ├── lib/             # Shared libraries
│       │   │   ├── schema.ts    # TypeScript types
│       │   │   ├── supabase.ts  # DB client
│       │   │   ├── scoring.ts   # Scoring engine
│       │   │   └── ...
│       │   │
│       │   └── __tests__/       # Test files
│       │       ├── workflow.test.ts
│       │       ├── graph.test.ts
│       │       └── ...
│       │
│       ├── temporal.config.ts   # Worker configuration
│       ├── package.json
│       └── tsconfig.json
│
├── db/
│   └── migrations/              # SQL migrations
│       ├── 001_init.sql
│       ├── 002_indexes.sql
│       └── ...
│
├── docs/                        # Documentation
│   ├── SETUP.md
│   ├── ARCHITECTURE.md
│   ├── WORKFLOWS.md
│   └── ...
│
└── tools/                       # Utility scripts
    ├── backfill-2019-2025.ts
    └── seed-index-calendar.ts
```

### File Naming Conventions

- **Workflows**: `*.workflow.ts`
- **Activities**: `*.activities.ts`
- **Tests**: `*.test.ts`
- **API Routes**: `<name>.<method>.ts` (e.g., `events.get.ts`)
- **Libraries**: `<name>.ts` (e.g., `scoring.ts`)

---

## Coding Standards

### TypeScript

**Use strict types:**
```typescript
// Good
interface RotationInput {
  cik: string;
  quarter: string;
}

function processRotation(input: RotationInput): Promise<RotationEvent> {
  // ...
}

// Bad
function processRotation(input: any): any {
  // ...
}
```

**Prefer interfaces over types for objects:**
```typescript
// Good
interface GraphNode {
  id: string;
  label: string;
}

// Acceptable for unions/intersections
type NodeOrEdge = GraphNode | GraphEdge;
```

**Use readonly for immutable data:**
```typescript
interface Config {
  readonly apiKey: string;
  readonly timeout: number;
}
```

### Naming Conventions

- **Variables/Functions**: camelCase
- **Interfaces/Types**: PascalCase
- **Constants**: UPPER_SNAKE_CASE
- **Private fields**: prefix with `_` (optional)

```typescript
const MAX_RETRIES = 3;

interface RotationEvent {
  clusterId: string;
  issuerCik: string;
}

function calculateScore(inputs: ScoreInputs): number {
  const _intermediate = inputs.dumpZ * 2.0;
  return _intermediate + inputs.uSame;
}
```

### Error Handling

**Activities: Throw descriptive errors**
```typescript
export async function fetchFilings(cik: string): Promise<Filing[]> {
  const response = await fetch(`https://sec.gov/.../${cik}`);

  if (!response.ok) {
    throw new Error(`SEC API error: HTTP ${response.status} for CIK ${cik}`);
  }

  return response.json();
}
```

**Workflows: Let Temporal retry**
```typescript
export async function myWorkflow(input: WorkflowInput) {
  // Don't catch errors - let Temporal handle retries
  const result = await activities.fetchData(input.id);
  return result;
}
```

**Handle permanent failures:**
```typescript
export async function parseXML(xml: string): Promise<Data> {
  try {
    return parseXMLStrict(xml);
  } catch (error) {
    if (error instanceof XMLSyntaxError) {
      // Permanent error - don't retry
      throw ApplicationFailure.nonRetryable(
        `Invalid XML format: ${error.message}`
      );
    }
    // Transient error - let Temporal retry
    throw error;
  }
}
```

### Database Queries

**Use parameterized queries:**
```typescript
// Good
const { data } = await supabase
  .from('rotation_events')
  .select('*')
  .eq('issuer_cik', cik);

// Bad - SQL injection risk
const query = `SELECT * FROM rotation_events WHERE issuer_cik = '${cik}'`;
```

**Prefer upserts for idempotency:**
```typescript
await supabase
  .from('rotation_events')
  .upsert(event, {
    onConflict: 'cluster_id',
  });
```

---

## Testing

### Test Structure

Tests use **Vitest** framework.

**Unit Tests:**
```typescript
// apps/temporal-worker/src/__tests__/scoring.test.ts
import { describe, it, expect } from 'vitest';
import { computeRotationScore } from '../lib/scoring.js';

describe('Rotation Scoring', () => {
  it('should compute r_score correctly', () => {
    const inputs = {
      dumpZ: 3.0,
      uSame: 0.5,
      uNext: 0.3,
      uhfSame: 0.4,
      uhfNext: 0.2,
      optSame: 0.1,
      optNext: 0.05,
      shortReliefV2: 0.25,
      indexPenalty: 0.1,
      eow: false,
    };

    const result = computeRotationScore(inputs);

    expect(result.gated).toBe(true);
    expect(result.rScore).toBeCloseTo(9.255, 2);
  });

  it('should gate low dumps', () => {
    const inputs = {
      dumpZ: 1.0,  // Below threshold
      uSame: 0.5,
      // ... other inputs
    };

    const result = computeRotationScore(inputs);

    expect(result.gated).toBe(false);
    expect(result.rScore).toBe(0);
  });
});
```

**Workflow Tests:**
```typescript
// apps/temporal-worker/src/__tests__/workflow.test.ts
import { describe, it, expect } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { rotationDetectWorkflow } from '../workflows/rotationDetect.workflow.js';

describe('Rotation Detection Workflow', () => {
  it('should detect rotation events', async () => {
    const testEnv = await TestWorkflowEnvironment.createLocal();

    try {
      const { client } = testEnv;

      const result = await client.workflow.execute(rotationDetectWorkflow, {
        args: [{
          cik: '0000320193',
          cusips: ['037833100'],
          quarter: '2024Q1',
          ticker: 'AAPL',
          runKind: 'daily',
          quarterStart: '2024-01-01',
          quarterEnd: '2024-03-31',
        }],
        taskQueue: 'test',
        workflowId: 'test-rotation-detect',
      });

      expect(result).toBeDefined();
    } finally {
      await testEnv.teardown();
    }
  });
});
```

**Activity Tests:**
```typescript
// apps/temporal-worker/src/__tests__/edgar.test.ts
import { describe, it, expect } from 'vitest';
import { fetchFilings } from '../activities/edgar.activities.js';

describe('EDGAR Activities', () => {
  it('should fetch filings for valid CIK', async () => {
    const filings = await fetchFilings('0000320193', {
      start: '2024-01-01',
      end: '2024-03-31',
    }, ['13F-HR']);

    expect(filings).toBeInstanceOf(Array);
    expect(filings.length).toBeGreaterThan(0);
  });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- workflow.test.ts

# Watch mode
npm test -- --watch

# Coverage
npm test -- --coverage
```

### Test Data

**Use realistic but anonymized data:**
```typescript
const testEvent = {
  cluster_id: '550e8400-e29b-41d4-a716-446655440000',
  issuer_cik: '0000000000',  // Fake CIK
  dumpz: 3.5,
  u_same: 0.45,
  // ...
};
```

**Mock external services:**
```typescript
import { vi } from 'vitest';

vi.mock('../lib/openai.js', () => ({
  generateCompletion: vi.fn(() => Promise.resolve('Mocked response')),
}));
```

---

## Debugging

### Temporal Workflows

**View execution history:**
```bash
temporal workflow show --workflow-id <id>
```

**Describe workflow:**
```bash
temporal workflow describe --workflow-id <id>
```

**Query workflows:**
```bash
temporal workflow list --query 'ticker="AAPL" AND runKind="daily"'
```

### Worker Logs

**Enable debug logging:**
```typescript
import { DefaultLogger, Runtime } from '@temporalio/worker';

Runtime.install({
  logger: new DefaultLogger('DEBUG'),
});
```

**Structured logging:**
```typescript
import { Context } from '@temporalio/activity';

export async function myActivity() {
  const logger = Context.current().log;

  logger.info('Processing started', { cik: '0000320193' });
  logger.error('Failed to fetch', { error: err.message });
}
```

### Database Queries

**Enable query logging:**
```sql
ALTER DATABASE rotation_detector SET log_statement = 'all';
ALTER DATABASE rotation_detector SET log_min_duration_statement = 100;
```

**Explain queries:**
```sql
EXPLAIN ANALYZE
SELECT * FROM positions_13f
WHERE entity_id = $1 AND asof >= $2;
```

### VS Code Debugging

`.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Worker",
      "program": "${workspaceFolder}/apps/temporal-worker/dist/worker.js",
      "preLaunchTask": "npm: build",
      "outFiles": ["${workspaceFolder}/apps/temporal-worker/dist/**/*.js"]
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Tests",
      "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
      "args": ["run", "${file}"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

---

## Contributing

### Workflow

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/my-feature
   ```
3. **Make changes**
4. **Write tests**
5. **Run tests and linter**
   ```bash
   npm test
   npm run lint
   ```
6. **Commit with descriptive messages**
   ```bash
   git commit -m "Add rotation scoring for index penalty"
   ```
7. **Push to your fork**
   ```bash
   git push origin feature/my-feature
   ```
8. **Create Pull Request**

### Commit Messages

Follow conventional commits:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `refactor`: Code refactoring
- `test`: Add/update tests
- `chore`: Build, dependencies, etc.

**Examples:**
```
feat(scoring): add index penalty calculation

Rotation scores now include a penalty for events occurring during
index rebalance windows. This reduces false positives from forced
rebalancing flows.

Closes #42

fix(edgar): handle rate limit 429 responses

SEC EDGAR API returns 429 when rate limit exceeded. Added exponential
backoff retry logic.

docs(api): add example for graph explain endpoint
```

### Pull Request Checklist

- [ ] Tests pass (`npm test`)
- [ ] Linter passes (`npm run lint`)
- [ ] Added tests for new functionality
- [ ] Updated documentation if needed
- [ ] Descriptive PR title and description
- [ ] Linked related issues

### Code Review

**For Reviewers:**
- Check for type safety
- Verify error handling
- Ensure tests cover edge cases
- Look for SQL injection risks
- Check for non-determinism in workflows

**For Authors:**
- Respond to feedback promptly
- Make requested changes
- Keep PR scope focused
- Update based on reviews

---

## Release Process

### Versioning

Follow Semantic Versioning (semver):
- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes

### Release Steps

1. **Update version**
   ```bash
   npm version minor  # or major/patch
   ```

2. **Update CHANGELOG.md**
   ```markdown
   ## [1.2.0] - 2024-11-08

   ### Added
   - GraphRAG community detection workflow
   - Index penalty in rotation scoring

   ### Fixed
   - Rate limiting for SEC EDGAR API
   - Workflow timeout handling
   ```

3. **Create git tag**
   ```bash
   git tag -a v1.2.0 -m "Release v1.2.0"
   git push origin v1.2.0
   ```

4. **Build and test**
   ```bash
   npm run build
   npm test
   ```

5. **Deploy**
   - Update production environment variables
   - Deploy worker and API
   - Run smoke tests

6. **Monitor**
   - Check Temporal UI for workflow health
   - Monitor error rates
   - Check database performance

---

## Common Tasks

### Adding a New Workflow

1. Create workflow file: `src/workflows/myWorkflow.workflow.ts`
2. Define input interface
3. Implement workflow logic
4. Add to exports in `src/workflows/index.ts`
5. Write tests in `src/__tests__/myWorkflow.test.ts`
6. Register in worker config (if needed)

### Adding a New Activity

1. Create or update activity file: `src/activities/myActivity.ts`
2. Implement stateless function
3. Add type definitions
4. Write tests
5. Use in workflows via `proxyActivities`

### Adding a Database Table

1. Create migration: `supabase migration new description`
2. Edit the generated migration file in `supabase/migrations/`
3. Add TypeScript interface in `apps/temporal-worker/src/lib/schema.ts`
4. Apply migration: `supabase db reset`
5. Update documentation in `docs/DATA_MODEL.md`
6. Create indexes in the same or separate migration if needed

**Important:** Always use `supabase migration new` and `supabase db reset` - never manually create or run migrations with psql.

### Adding an API Endpoint

1. Create route file: `apps/api/routes/myroute.<method>.ts`
2. Implement handler
3. Add to documentation in `docs/API.md`
4. Test manually with curl/Postman
5. Consider adding rate limiting

---

## Getting Help

- **Documentation**: See `docs/` directory
- **Issues**: Open issue on GitHub
- **Discussions**: Use GitHub Discussions
- **Temporal**: https://temporal.io/slack

---

## Related Documentation

- [Setup Guide](SETUP.md) - Installation
- [Architecture](ARCHITECTURE.md) - System design
- [Workflows](WORKFLOWS.md) - Workflow reference
- [API Reference](API.md) - REST API

---

For questions or issues, see [main README](../README.md#support).
