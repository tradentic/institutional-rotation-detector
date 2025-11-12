# Applications

This directory contains the application components of the Institutional Rotation Detector system.

## Directory Structure

```
apps/
├── api/                    # REST API server
│   └── routes/            # API endpoint handlers
│       ├── events.get.ts  # Get rotation events
│       ├── explain.post.ts # Generate event explanation
│       ├── graph.get.ts   # Get rotation graph
│       ├── run.post.ts    # Trigger analysis workflow
│       └── graph/         # Graph-specific endpoints
│           ├── communities.get.ts  # Get graph communities
│           ├── explain.post.ts     # Graph-based explanation
│           └── paths.get.ts        # Find paths in graph
│
└── temporal-worker/       # Temporal.io worker application
    ├── src/
    │   ├── workflows/     # Durable workflow definitions
    │   ├── activities/    # Activity implementations
    │   ├── lib/          # Shared libraries
    │   └── __tests__/    # Test suites
    ├── temporal.config.ts # Worker configuration
    └── package.json      # Dependencies
```

## Components

### API Server (`api/`)

REST API for querying rotation data and triggering workflows.

**Purpose:**
- Expose rotation events, graphs, and explanations
- Trigger ingestion and analysis workflows
- Provide programmatic access to the system

**Technology:**
- Lightweight HTTP handlers (framework-agnostic)
- Direct Supabase queries for read operations
- Temporal client for workflow orchestration

**Key Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/run` | POST | Start rotation analysis |
| `/api/events` | GET | Query rotation events |
| `/api/graph` | GET | Fetch rotation graph |
| `/api/graph/communities` | GET | Get detected communities |
| `/api/graph/paths` | GET | Find entity paths |
| `/api/explain` | POST | Generate AI explanation |
| `/api/graph/explain` | POST | Graph-based explanation |

**Usage Example:**
```bash
# Trigger analysis for AAPL Q1 2024
curl -X POST "http://localhost:3000/api/run?ticker=BLK&from=2024Q1&to=2024Q1&runKind=daily"

# Get rotation events
curl "http://localhost:3000/api/events?ticker=BLK"

# Get graph for January 2024
curl "http://localhost:3000/api/graph?ticker=BLK&period=2024-01"
```

See [API Documentation](../docs/API.md) for full endpoint reference (Phase 2).

### Temporal Worker (`temporal-worker/`)

Long-running worker process that executes workflows and activities.

**Purpose:**
- Orchestrate multi-step ingestion and analysis processes
- Execute business logic (scoring, graph building, etc.)
- Integrate with external services (SEC, FINRA, OpenAI)

**Architecture:**

```
temporal-worker/
├── workflows/          # Orchestration logic (deterministic)
│   ├── ingestIssuer.workflow.ts     # Multi-quarter ingestion
│   ├── ingestQuarter.workflow.ts    # Single quarter processing
│   ├── rotationDetect.workflow.ts   # Rotation detection & scoring
│   ├── eventStudy.workflow.ts       # Market impact analysis
│   ├── graphBuild.workflow.ts       # Graph construction
│   ├── graphSummarize.workflow.ts   # Community detection
│   ├── graphQuery.workflow.ts       # Graph queries
│   └── testProbe.workflow.ts        # Search attribute testing
│
├── activities/         # Business logic (stateless)
│   ├── edgar.activities.ts          # SEC filing downloads
│   ├── nport.activities.ts          # N-PORT processing
│   ├── finra.activities.ts          # Short interest data
│   ├── etf.activities.ts            # ETF holdings
│   ├── compute.activities.ts        # Rotation scoring
│   ├── graph.activities.ts          # Graph construction
│   ├── graphrag.activities.ts       # Community analysis
│   ├── rag.activities.ts            # RAG operations
│   ├── sankey.activities.ts         # Flow visualization
│   └── longcontext.activities.ts    # Long-context synthesis
│
└── lib/               # Shared utilities
    ├── schema.ts                    # Data types
    ├── supabase.ts                  # Database client
    ├── secClient.ts                 # SEC EDGAR client
    ├── openai.ts                    # OpenAI integration
    ├── graph.ts                     # Graph utilities
    ├── pagerank_louvain.ts          # Community detection
    ├── scoring.ts                   # Scoring algorithms
    ├── rateLimit.ts                 # Rate limiting
    └── indexCalendar.ts             # Index rebalance dates
```

**Running the Worker:**

```bash
# Install dependencies (from repo root)
pnpm install

# Build TypeScript (from repo root)
pnpm run build:worker

# Run tests (from repo root)
pnpm test

# Start worker (from repo root)
pnpm run start:worker
```

**Configuration:**

Set environment variables in `.env`:
- `TEMPORAL_NAMESPACE` - Temporal namespace (default: `default`)
- `TEMPORAL_TASK_QUEUE` - Task queue name (default: `rotation-detector`)
- `SUPABASE_URL` - Database URL
- `SUPABASE_SERVICE_ROLE_KEY` - Database credentials
- `OPENAI_API_KEY` - OpenAI API key
- `SEC_USER_AGENT` - SEC EDGAR user agent

See [Setup Guide](../docs/SETUP.md) for full configuration details.

## Development

### Local Development Setup

1. **Start Temporal Server**
   ```bash
   temporal server start-dev
   ```

2. **Start Worker**
   ```bash
   # From repo root
   pnpm run build:worker
   pnpm run start:worker
   ```

3. **Start API Server** (if developing API)
   ```bash
   cd apps/api
   # (Start your HTTP server)
   ```

### Testing

```bash
cd apps/temporal-worker
npm test
```

**Test Types:**
- Unit tests: Activities in isolation
- Integration tests: Workflow execution with mocked activities
- End-to-end tests: Full workflow with real database

### Adding New Endpoints

1. Create route file in `apps/api/routes/`
2. Implement handler function
3. Query Supabase or trigger Temporal workflow
4. Return JSON response

Example:
```typescript
// apps/api/routes/myendpoint.get.ts
import { createSupabaseClient } from '../../temporal-worker/src/lib/supabase.js';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const param = url.searchParams.get('param');

  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('my_table')
    .select('*')
    .eq('field', param);

  if (error) {
    return new Response(error.message, { status: 500 });
  }

  return Response.json(data);
}
```

### Adding New Workflows

1. Create workflow file in `apps/temporal-worker/src/workflows/`
2. Define input interface
3. Implement deterministic workflow logic
4. Export workflow function
5. Register in worker configuration

Example:
```typescript
// apps/temporal-worker/src/workflows/myWorkflow.workflow.ts
import { proxyActivities } from '@temporalio/workflow';

const { myActivity } = proxyActivities({ startToCloseTimeout: '5 minutes' });

export interface MyWorkflowInput {
  param: string;
}

export async function myWorkflow(input: MyWorkflowInput) {
  const result = await myActivity(input.param);
  return result;
}
```

### Adding New Activities

1. Create or update activity file in `apps/temporal-worker/src/activities/`
2. Implement stateless function
3. Handle errors gracefully
4. Return serializable data
5. Add tests

Example:
```typescript
// apps/temporal-worker/src/activities/myActivity.ts
import { createSupabaseClient } from '../lib/supabase.js';

export async function myActivity(param: string): Promise<string> {
  const supabase = createSupabaseClient();

  // Perform work
  const { data, error } = await supabase
    .from('my_table')
    .select('*')
    .eq('field', param);

  if (error) {
    throw new Error(`Activity failed: ${error.message}`);
  }

  return data;
}
```

## Monitoring

### Temporal UI

Access workflow execution details:
```bash
# Local development
open http://localhost:8233

# Search workflows
temporal workflow list --namespace ird --query 'ticker="BLK"'

# Describe specific workflow
temporal workflow describe --namespace ird --workflow-id <id>
```

### Logs

```bash
# Worker logs
tail -f apps/temporal-worker/logs/worker.log

# API logs (depends on your HTTP server)
tail -f apps/api/logs/api.log
```

## Deployment

### Worker Deployment

**Docker:**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY apps/temporal-worker/package*.json ./
RUN npm ci --production
COPY apps/temporal-worker/dist ./dist
CMD ["node", "dist/worker.js"]
```

**Scaling:**
- Run multiple worker instances
- All connect to same task queue
- Temporal distributes work automatically

### API Deployment

Deploy as serverless functions or containerized service:
- Vercel, Netlify, AWS Lambda (serverless)
- Docker + Kubernetes (containerized)
- Cloud Run, ECS (managed containers)

## Related Documentation

- [Architecture Overview](../docs/ARCHITECTURE.md)
- [Setup Guide](../docs/SETUP.md)
- [Workflow Reference](../docs/WORKFLOWS.md) (Phase 2)
- [API Reference](../docs/API.md) (Phase 2)
- [Development Guide](../docs/DEVELOPMENT.md) (Phase 2)

---

For questions or issues, see [main README](../README.md#support).
