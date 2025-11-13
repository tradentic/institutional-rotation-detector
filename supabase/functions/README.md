# Supabase Edge Functions

Serverless TypeScript functions that run on Deno Deploy. These are thin wrappers around the core handlers in `apps/api/src/handlers/`.

## Available Functions

| Function | Method | Path | Description |
|----------|--------|------|-------------|
| `events` | GET | `/functions/v1/events` | Query rotation events |
| `graph` | GET | `/functions/v1/graph` | Get rotation graph |
| `graph-paths` | GET | `/functions/v1/graph-paths` | Find graph paths |
| `graph-explain` | POST | `/functions/v1/graph-explain` | AI explanations |
| `run` | POST | `/functions/v1/run` | Trigger workflows |

## Local Development

### Prerequisites

```bash
# Install Supabase CLI
brew install supabase/tap/supabase

# Or with npm
npm install -g supabase
```

### Start Supabase Locally

```bash
# From project root
supabase start
```

**Note on Import Warnings**: You may see warnings like "failed to read file: ...temporal-worker/src/..." when starting Supabase. This is expected during local development. The edge functions import handlers from `apps/api/src/handlers/` which reference TypeScript files in temporal-worker using `.js` extensions (required for ESM). These warnings are harmless and don't affect functionality - the imports work correctly when the functions are deployed/bundled.

### Serve Functions

```bash
# Serve all functions
supabase functions serve --no-verify-jwt

# Serve specific function
supabase functions serve events --no-verify-jwt

# With environment variables
supabase functions serve events --env-file ./apps/temporal-worker/.env
```

### Test Locally

```bash
# Events
curl "http://localhost:54321/functions/v1/events?ticker=AAPL"

# Graph
curl "http://localhost:54321/functions/v1/graph?ticker=AAPL&period=2024-01"

# Run workflow
curl -X POST "http://localhost:54321/functions/v1/run?ticker=AAPL&from=2024-01-01&to=2024-12-31"

# Graph explain
curl -X POST "http://localhost:54321/functions/v1/graph-explain" \
  -H "Content-Type: application/json" \
  -d '{"edgeIds":["uuid1","uuid2"],"question":"Why?"}'
```

## Deployment

### Setup

1. **Create Supabase Project** (if not already done)
```bash
# Link to existing project
supabase link --project-ref your-project-ref

# Or create new
supabase projects create your-project-name
```

2. **Set Environment Variables**

```bash
# Set secrets for the functions
supabase secrets set SUPABASE_URL=https://your-project.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
supabase secrets set TEMPORAL_ADDRESS=your-temporal-address:7233
supabase secrets set TEMPORAL_NAMESPACE=default
supabase secrets set TEMPORAL_TASK_QUEUE=rotation-detector
supabase secrets set OPENAI_API_KEY=sk-your-key
```

### Deploy Functions

```bash
# Deploy all functions
supabase functions deploy events
supabase functions deploy graph
supabase functions deploy run
supabase functions deploy graph-paths
supabase functions deploy graph-explain

# Or deploy all at once
for func in events graph run graph-paths graph-explain; do
  supabase functions deploy $func
done
```

### Verify Deployment

```bash
# List deployed functions
supabase functions list

# Check logs
supabase functions logs events
```

### Access Deployed Functions

```bash
# Get your project URL
SUPABASE_URL=$(supabase status | grep "API URL" | awk '{print $3}')

# Test deployed function
curl "$SUPABASE_URL/functions/v1/events?ticker=AAPL" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

## Authentication

By default, Edge Functions require authentication. To make them public:

```typescript
// In each function's index.ts
Deno.serve(async (req) => {
  // Check auth header if needed
  const authHeader = req.headers.get('Authorization');

  if (!authHeader) {
    return new Response('Unauthorized', { status: 401 });
  }

  // ... rest of handler
});
```

Or configure in Supabase Dashboard:
1. Go to Edge Functions
2. Select function
3. Click "Settings"
4. Toggle "Verify JWT" off (for public access)

## CORS

All functions include CORS headers:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization`

To restrict origins, modify the CORS headers in each function:

```typescript
headers.set('Access-Control-Allow-Origin', 'https://yourdomain.com');
```

## Monitoring

### View Logs

```bash
# Real-time logs
supabase functions logs events --tail

# Filter by time
supabase functions logs events --since 1h
```

### Metrics

View metrics in Supabase Dashboard:
1. Go to Edge Functions
2. Select function
3. View "Metrics" tab

## Troubleshooting

### Import Errors

If you get import errors, ensure `import_map.json` is correctly configured:

```json
{
  "imports": {
    "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2.80.0",
    "@temporalio/client": "npm:@temporalio/client@1.13.1"
  }
}
```

### Connection Errors

For Temporal connection issues:
1. Verify `TEMPORAL_ADDRESS` environment variable
2. Ensure Temporal server is accessible from Supabase
3. Check if you need Temporal Cloud credentials

### Module Not Found

If handlers can't be found, verify the import path:
```typescript
import { GET } from '../../../apps/api/src/handlers/events.ts';
//                    ^^^ Three levels up from supabase/functions/events/
```

## Architecture

```
supabase/functions/
├── events/
│   └── index.ts          # Thin wrapper
├── graph/
│   └── index.ts
└── import_map.json       # Deno import map

apps/api/src/handlers/
├── events.ts             # Core logic (reusable)
├── graph.ts
└── index.ts
```

Edge Functions import from `apps/api/src/handlers/` to keep logic reusable across different server frameworks.

## Performance

- **Cold Start**: ~200-500ms
- **Warm Start**: ~10-50ms
- **Max Duration**: 60 seconds (Supabase limit)
- **Memory**: 512MB default (configurable)

For long-running operations (>10s), consider:
1. Using async workflows (trigger and return immediately)
2. Implementing webhooks for completion notifications
3. Polling status endpoints

## Cost

Supabase Edge Functions pricing (as of 2024):
- **Free tier**: 500K invocations/month
- **Pro tier**: 2M invocations/month included
- **Additional**: $2 per 1M invocations

Monitor usage in Supabase Dashboard → Edge Functions → Usage

## Related Documentation

- [Handlers README](../../apps/api/README.md) - Core handler documentation
- [Supabase Functions Docs](https://supabase.com/docs/guides/functions)
- [Deno Deploy Docs](https://deno.com/deploy/docs)
