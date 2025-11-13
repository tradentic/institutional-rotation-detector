# API Handlers

Modular, reusable API handlers for the Institutional Rotation Detector. These handlers can be used in **any server framework** including:

- ✅ Supabase Edge Functions (Deno)
- ✅ Express.js
- ✅ Hono
- ✅ Fastify
- ✅ Next.js API Routes
- ✅ Vercel Serverless Functions
- ✅ Cloudflare Workers

## Architecture

```
apps/api/
├── src/
│   └── handlers/           # Core handler logic (framework-agnostic)
│       ├── events.ts       # GET /events - Query rotation events
│       ├── graph.ts        # GET /graph - Get rotation graph
│       ├── graph-paths.ts  # GET /graph/paths - Find graph paths
│       ├── graph-explain.ts# POST /graph/explain - AI explanations
│       ├── run.ts          # POST /run - Trigger workflows
│       └── index.ts        # Export all handlers
└── routes/                 # Original route files (deprecated)
```

## Handler Design

Each handler exports:

1. **Core function** (`handleXxx`) - Pure business logic that accepts typed parameters
2. **Web Standard handler** (`GET/POST`) - Accepts `Request`, returns `Response`

This design allows you to:
- Use core functions with any framework (pass params directly)
- Use Web Standard handlers in modern frameworks (Deno, Cloudflare Workers, etc.)
- Easily test handlers in isolation

## Usage Examples

### Supabase Edge Functions (Current Implementation)

Edge Functions are deployed in `supabase/functions/` and import from handlers:

```typescript
// supabase/functions/events/index.ts
import { GET } from '../../../apps/api/src/handlers/events.ts';

Deno.serve(async (req) => {
  const response = await GET(req);
  // Add CORS, error handling, etc.
  return response;
});
```

**Deploy:**
```bash
supabase functions deploy events
supabase functions deploy graph
supabase functions deploy run
```

**Local development:**
```bash
supabase functions serve events --no-verify-jwt
```

**Access:**
```bash
curl "https://your-project.supabase.co/functions/v1/events?ticker=AAPL"
```

### Express.js Server

```typescript
import express from 'express';
import { handleGetEvents, handlePostRun } from '@rotation-detector/api';

const app = express();
app.use(express.json());

// Use core functions
app.get('/api/events', async (req, res) => {
  const response = await handleGetEvents({
    ticker: req.query.ticker,
    cik: req.query.cik,
  });

  res.status(response.status).send(await response.text());
});

// Or use Web Standard handlers
app.all('/api/run', async (req, res) => {
  const webRequest = new Request(`http://localhost${req.url}`, {
    method: req.method,
    headers: req.headers,
  });

  const { postRun } = await import('@rotation-detector/api');
  const response = await postRun(webRequest);

  res.status(response.status).send(await response.json());
});

app.listen(3000);
```

### Hono (Cloudflare Workers)

```typescript
import { Hono } from 'hono';
import { getEvents, getGraph, postRun } from '@rotation-detector/api';

const app = new Hono();

// Web Standard handlers work directly
app.get('/api/events', (c) => getEvents(c.req.raw));
app.get('/api/graph', (c) => getGraph(c.req.raw));
app.post('/api/run', (c) => postRun(c.req.raw));

export default app;
```

### Next.js API Routes

```typescript
// pages/api/events.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { handleGetEvents } from '@rotation-detector/api';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const response = await handleGetEvents({
    ticker: req.query.ticker as string,
    cik: req.query.cik as string,
  });

  const data = await response.json();
  res.status(response.status).json(data);
}
```

### Fastify

```typescript
import Fastify from 'fastify';
import { handleGetEvents, handleGetGraph } from '@rotation-detector/api';

const fastify = Fastify();

fastify.get('/api/events', async (request, reply) => {
  const response = await handleGetEvents({
    ticker: request.query.ticker,
    cik: request.query.cik,
  });

  return response.json();
});

fastify.listen({ port: 3000 });
```

## Available Handlers

### GET /events
Query rotation events for a ticker or CIK.

```typescript
import { handleGetEvents, type EventsParams } from '@rotation-detector/api';

const params: EventsParams = {
  ticker: 'AAPL', // or cik: '0000320193'
};

const response = await handleGetEvents(params);
```

### GET /graph
Get rotation graph nodes and edges for a period.

```typescript
import { handleGetGraph, type GraphParams } from '@rotation-detector/api';

const params: GraphParams = {
  ticker: 'AAPL',
  period: '2024-01',
};

const response = await handleGetGraph(params);
```

### GET /graph/paths
Find paths via k-hop neighborhood traversal.

```typescript
import { handleGetGraphPaths, type GraphPathsParams } from '@rotation-detector/api';

const params: GraphPathsParams = {
  ticker: 'AAPL',
  from: '2024-01-01',
  to: '2024-03-31',
  hops: 2,
};

const response = await handleGetGraphPaths(params);
```

### POST /graph/explain
Generate AI explanations for edges.

```typescript
import { handlePostGraphExplain, type GraphExplainParams } from '@rotation-detector/api';

const params: GraphExplainParams = {
  edgeIds: ['uuid1', 'uuid2'],
  question: 'Why are institutions selling Apple?',
};

const response = await handlePostGraphExplain(params);
```

### POST /run
Trigger rotation analysis workflow.

```typescript
import { handlePostRun, type RunParams, type TemporalConfig } from '@rotation-detector/api';

const params: RunParams = {
  ticker: 'AAPL',
  from: '2024-01-01',
  to: '2024-12-31',
  runKind: 'daily',
};

const temporalConfig: TemporalConfig = {
  namespace: 'default',
  taskQueue: 'rotation-detector',
};

const response = await handlePostRun(params, temporalConfig);
```

## Development

### Install Dependencies

```bash
cd apps/api
pnpm install
```

### Type Check

```bash
pnpm typecheck
```

### Build

```bash
pnpm build
```

## Testing

### Unit Tests (Handlers)

```typescript
import { handleGetEvents } from '@rotation-detector/api';

test('returns 400 when no identifier provided', async () => {
  const response = await handleGetEvents({});
  expect(response.status).toBe(400);
});
```

### Integration Tests (Supabase Functions)

```bash
# Serve locally
supabase functions serve events --no-verify-jwt

# Test
curl "http://localhost:54321/functions/v1/events?ticker=AAPL"
```

## Environment Variables

Handlers read from `process.env` (or `Deno.env` in Edge Functions):

| Variable | Description | Default |
|----------|-------------|---------|
| `SUPABASE_URL` | Supabase API URL | Required |
| `SUPABASE_ANON_KEY` | Supabase anon key | Required |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service key | Required |
| `TEMPORAL_ADDRESS` | Temporal server address | `localhost:7233` |
| `TEMPORAL_NAMESPACE` | Temporal namespace | `default` |
| `TEMPORAL_TASK_QUEUE` | Temporal task queue | `rotation-detector` |

## Migration from Old Routes

Old routes in `apps/api/routes/` are deprecated. Use handlers instead:

**Before:**
```typescript
// apps/api/routes/events.get.ts
export async function GET(request: Request) { /* ... */ }
```

**After:**
```typescript
// Import from handlers
import { GET } from '../api/src/handlers/events.ts';

// Or use core function
import { handleGetEvents } from '../api/src/handlers/events.ts';
```

## Contributing

When adding new endpoints:

1. Create handler in `src/handlers/`
2. Export core function (`handleXxx`) and Web Standard handler (`GET/POST`)
3. Create Supabase Edge Function wrapper in `supabase/functions/`
4. Update this README with usage examples
5. Add types to `index.ts` exports

## License

[Your License]
