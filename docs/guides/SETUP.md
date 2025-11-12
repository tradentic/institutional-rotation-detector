# Setup Guide

Complete installation and configuration instructions for the Institutional Rotation Detector.

## Table of Contents

- [System Requirements](#system-requirements)
- [Database Setup](#database-setup)
- [Temporal Setup](#temporal-setup)
- [Application Configuration](#application-configuration)
- [Environment Variables](#environment-variables)
- [First Run](#first-run)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)

## System Requirements

### Hardware

- **CPU**: 4+ cores recommended (for parallel workflow execution)
- **RAM**: 8GB minimum, 16GB recommended
- **Storage**: 100GB+ for production data (SEC filings, graphs, vectors)

### Software

- **Node.js**: 20.x or higher
- **PostgreSQL**: 15.x or higher
- **Temporal Server**: 1.10.x or higher (local or cloud)
- **Operating System**: Linux, macOS, or Windows with WSL2

### External Services

- **Supabase Account** (or self-hosted PostgreSQL with compatible REST API)
- **OpenAI API Key** (GPT-4 access recommended)
- **SEC EDGAR Access** (no authentication required, but respect rate limits)

## Database Setup

### Option 1: Supabase Cloud (Production)

1. **Create Supabase Project**
   - Sign up at https://supabase.com
   - Create a new project
   - Note your project URL and API keys

2. **Enable pgvector Extension**
   - Navigate to Database → Extensions in Supabase dashboard
   - Enable `vector` extension

3. **Link Local Project to Cloud**
   ```bash
   # Install Supabase CLI
   brew install supabase/tap/supabase  # macOS
   # or visit https://supabase.com/docs/guides/cli for other platforms

   # Link to your cloud project
   supabase link --project-ref <your-project-ref>

   # Push migrations to cloud
   supabase db push
   ```

### Option 2: Supabase Local (Development - Recommended)

1. **Install Supabase CLI**
   ```bash
   # macOS
   brew install supabase/tap/supabase

   # Linux/Windows
   # See: https://supabase.com/docs/guides/cli
   ```

2. **Start Supabase Locally**
   ```bash
   cd institutional-rotation-detector
   supabase start
   ```

   This automatically:
   - Starts PostgreSQL with pgvector extension
   - Starts all Supabase services (API, Studio, Auth, Storage)
   - Provides local connection credentials

3. **Apply Migrations**
   ```bash
   supabase db reset
   ```

   This applies all 19 migrations from `supabase/migrations/` in order.

### Option 3: Self-Hosted PostgreSQL (Advanced)

For self-hosted PostgreSQL without Supabase, see [Local Development Guide](LOCAL_DEVELOPMENT.md) for detailed instructions. Note that you'll need to manually configure the REST API layer that Supabase provides.

### Database Schema Overview

The `supabase db reset` command applies 19 migrations that create:

- **Core Tables**: entities, filings, positions_13f, rotation_events, rotation_edges
- **Microstructure Tables**: finra_otc_data, iex_hist_data, short_interest
- **GraphRAG Tables**: graph_nodes, graph_edges, graph_communities, node_bindings
- **Insider Data**: insider_transactions (Form 4 data)
- **Options Flow**: options_flow, unusual_options_activity
- **Supporting Data**: cusip_issuer_map, index_calendar

All migrations include proper indexes, constraints, and the pgvector extension for embeddings.

### Seeding Initial Data

#### Fund Manager Entities (Optional but Recommended)

The `ingestIssuerWorkflow` requires entities in the database for fund managers who file 13F reports. The system now **auto-creates missing fund manager entities** when parsing 13F filings, so manual seeding is optional.

However, pre-seeding common fund managers can significantly speed up the first ingestion run:

```bash
# From repo root
pnpm run seed:managers
```

This seeds 20+ common institutional fund managers (Berkshire Hathaway, Vanguard, BlackRock, etc.).

**How Auto-Creation Works:**

When the workflow encounters a fund manager that doesn't exist in the database:
1. It fetches the entity name from SEC's submissions API
2. Creates a new `entities` record with `kind='manager'`
3. Continues processing the 13F filing

This means you can start with an **empty database** and the workflow will populate fund managers automatically as it discovers them in 13F filings.

**Why It Matters:**

The workflow correctly fetches **only 13F filings related to the specified issuer** (e.g., Apple), not all 13Fs in the system. However, those 13F filings are submitted by fund managers, and the database needs an `entity_id` for each fund manager to store position data.

#### Index Calendar (Optional)

The index calendar tracks Russell index rebalance dates for rotation detection:

```bash
# From repo root
pnpm run seed:index
```

This seeds Russell and S&P rebalance windows from 2019-2030.

## Temporal Setup

### Option 1: Temporal Cloud (Production)

1. **Sign up** at https://temporal.io/cloud
2. **Create Namespace**
3. **Download Certificates**
4. **Note Connection Details**
   - Namespace name
   - Endpoint URL
   - Certificate paths

### Option 2: Local Development

1. **Install Temporal CLI**
   ```bash
   # macOS
   brew install temporal

   # Linux
   curl -sSf https://temporal.download/cli.sh | sh
   ```

2. **Start Temporal Server**
   ```bash
   temporal server start-dev
   ```

3. **Create Search Attributes**

   The system requires custom search attributes for workflow visibility:

   ```bash
   ./tools/setup-temporal-attributes.sh
   ```

4. **Verify Search Attributes**
   ```bash
   temporal operator search-attribute list --namespace ird
   ```

## Application Configuration

### Install Dependencies

**Always install from repo root** to properly set up the pnpm workspace:

```bash
cd institutional-rotation-detector
pnpm install
```

This installs dependencies for all apps (temporal-worker, api, admin) and shared libraries.

### Build TypeScript

**Build from repo root:**

```bash
# Build all apps
pnpm build

# Or build specific apps
pnpm run build:worker  # Just the temporal worker
pnpm --filter api build  # Just the API
```

### Run Tests (Optional)

```bash
pnpm test
```

## Environment Variables

Create a `.env` file in `apps/temporal-worker/`:

```bash
# Database Configuration (Supabase)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Or for direct PostgreSQL connection
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Temporal Configuration
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=rotation-detector
TEMPORAL_ADDRESS=localhost:7233

# For Temporal Cloud
TEMPORAL_CLIENT_CERT_PATH=/path/to/client.crt
TEMPORAL_CLIENT_KEY_PATH=/path/to/client.key

# OpenAI Configuration
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_MODEL=gpt-4-turbo-preview

# SEC EDGAR Configuration
SEC_USER_AGENT=YourCompany contact@yourcompany.com

# Application Settings
QUARTER_BATCH=8  # Number of quarters to process in parallel
MIN_DUMP_PCT=5   # Minimum % change to detect as dump event
RATE_LIMIT_PER_SECOND=10  # SEC EDGAR rate limit

# API Configuration (if running API server)
API_PORT=3000
```

### Required Variables

- `SUPABASE_URL` or `DATABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (if using Supabase)
- `TEMPORAL_NAMESPACE`
- `TEMPORAL_TASK_QUEUE`
- `OPENAI_API_KEY`
- `SEC_USER_AGENT` (format: "Company Name email@domain.com")

### Optional Variables

- `TEMPORAL_ADDRESS` (default: localhost:7233)
- `QUARTER_BATCH` (default: 8)
- `MIN_DUMP_PCT` (default: 5)
- `RATE_LIMIT_PER_SECOND` (default: 10)
- `API_PORT` (default: 3000)

## First Run

### Start the Temporal Worker

```bash
# From repo root
pnpm run build:worker
pnpm run start:worker
```

You should see output indicating the worker is connected:

```
Worker connected to Temporal server
Task queue: rotation-detector
Namespace: default
Registered workflows: ingestIssuerWorkflow, rotationDetectWorkflow, ...
```

### Seed Initial Data (Optional)

While the system auto-creates missing entities, pre-seeding can speed up the first run:

```bash
# Seed common fund managers (recommended)
pnpm run seed:managers

# Seed index calendar for rotation detection (optional)
pnpm run seed:index
```

### Run First Ingestion

Using the API (if running API server):

```bash
# Start a small test run (single quarter)
curl -X POST "http://localhost:3000/api/run?ticker=AAPL&from=2024Q1&to=2024Q1&runKind=daily&min_pct=5"
```

Or trigger directly via Temporal CLI:

```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type ingestIssuerWorkflow \
  --workflow-id test-run-$(date +%s) \
  --input '{"ticker":"AAPL","from":"2024Q1","to":"2024Q1","runKind":"daily","minPct":5}'
```

### Monitor Workflow Execution

```bash
# Via Temporal UI
open http://localhost:8233  # For local Temporal server

# Via Temporal CLI
temporal workflow list --namespace ird --query 'ticker="AAPL"'
temporal workflow describe --namespace ird --workflow-id <workflow-id>
```

## Verification

### Check Database

```sql
-- Verify filings were ingested
SELECT COUNT(*) FROM filings WHERE cik = (
  SELECT cik FROM entities WHERE name LIKE '%APPLE%'
);

-- Check for rotation events
SELECT * FROM rotation_events LIMIT 10;

-- Verify graph was built
SELECT COUNT(*) FROM graph_nodes;
SELECT COUNT(*) FROM graph_edges;
```

### Query API

```bash
# Get rotation events
curl "http://localhost:3000/api/events?ticker=AAPL"

# Get rotation graph
curl "http://localhost:3000/api/graph?ticker=AAPL&period=2024-01"

# Get graph communities
curl "http://localhost:3000/api/graph/communities?cik=0000320193&period=2024-01"
```

### Check Logs

```bash
# Worker logs
tail -f apps/temporal-worker/logs/worker.log

# Temporal server logs (local)
tail -f ~/.temporal/server.log
```

## Troubleshooting

### Worker Cannot Connect to Temporal

**Issue**: `Error: Unable to connect to Temporal server`

**Solution**:
- Verify Temporal server is running: `temporal server health`
- Check `TEMPORAL_ADDRESS` environment variable
- For cloud: verify certificate paths are correct

### Database Connection Errors

**Issue**: `Error: Connection refused` or `ECONNREFUSED`

**Solution**:
- Verify PostgreSQL is running
- Check `SUPABASE_URL` or `DATABASE_URL`
- Ensure database migrations have been applied
- Check network connectivity and firewall rules

### Search Attribute Not Found

**Issue**: `search attribute "Ticker" is not defined`

**Solution**:
```bash
# Create missing search attributes
./tools/setup-temporal-attributes.sh
```

### SEC EDGAR Rate Limiting

**Issue**: `429 Too Many Requests` from SEC

**Solution**:
- Reduce `RATE_LIMIT_PER_SECOND` in .env
- Ensure `SEC_USER_AGENT` is properly formatted
- SEC allows 10 requests/second with proper user agent

### OpenAI API Errors

**Issue**: `401 Unauthorized` or rate limit errors

**Solution**:
- Verify `OPENAI_API_KEY` is valid
- Check API quota and billing
- Consider switching to `gpt-4-turbo-preview` for better rate limits

### Entity Not Found Errors

**Issue**: `Entity not found for CIK 0001234567` when running workflow

**Explanation**:
The workflow fetches 13F filings **related to the issuer** (e.g., Apple) from the SEC. These 13F filings are submitted by fund managers, and the database needs an entry for each fund manager to store position data.

**Solution**:
This should no longer occur as of the latest update - the system now auto-creates missing fund manager entities. If you still encounter this error:
- Rebuild the temporal worker: `pnpm run build:worker`
- Restart the worker: `pnpm run start:worker`
- Optionally pre-seed common fund managers: `pnpm run seed:managers`

### Workflow Failures

**Issue**: Workflows fail with timeout or activity errors

**Solution**:
- Check activity logs in Temporal UI
- Increase timeouts in workflow definitions if needed
- Verify external service availability (SEC, OpenAI)
- Check database performance and connection pool settings

## Next Steps

- Review [Architecture Documentation](ARCHITECTURE.md) to understand system design
- See [API Reference](API.md) for querying data (Phase 2)
- Explore [Workflow Guide](WORKFLOWS.md) for advanced usage (Phase 2)
- Read [Development Guide](DEVELOPMENT.md) to contribute (Phase 2)

---

**Need Help?** Open an issue on GitHub with:
- Error messages and stack traces
- Environment details (OS, Node version, PostgreSQL version)
- Steps to reproduce the issue
