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

### Option 1: Supabase (Recommended)

1. **Create Supabase Project**
   ```bash
   # Sign up at https://supabase.com
   # Create a new project
   # Note your project URL and API keys
   ```

2. **Enable pgvector Extension**
   - Navigate to Database → Extensions in Supabase dashboard
   - Enable `vector` extension

3. **Run Migrations**
   ```bash
   # Connect to your Supabase database
   psql "postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT].supabase.co:5432/postgres"

   # Run migrations in order
   \i db/migrations/001_init.sql
   \i db/migrations/002_indexes.sql
   \i db/migrations/010_graphrag_init.sql
   \i db/migrations/011_graphrag_indexes.sql
   ```

### Option 2: Self-Hosted PostgreSQL

1. **Install PostgreSQL**
   ```bash
   # Ubuntu/Debian
   sudo apt-get install postgresql-15 postgresql-contrib

   # macOS
   brew install postgresql@15
   ```

2. **Install pgvector Extension**
   ```bash
   # Clone and install pgvector
   git clone https://github.com/pgvector/pgvector.git
   cd pgvector
   make
   sudo make install
   ```

3. **Create Database**
   ```sql
   createdb rotation_detector
   psql rotation_detector

   CREATE EXTENSION vector;
   ```

4. **Run Migrations**
   ```bash
   psql rotation_detector -f db/migrations/001_init.sql
   psql rotation_detector -f db/migrations/002_indexes.sql
   psql rotation_detector -f db/migrations/010_graphrag_init.sql
   psql rotation_detector -f db/migrations/011_graphrag_indexes.sql
   ```

### Database Schema Overview

The migrations create the following table groups:

- **Core Tables** (001_init.sql):
  - `entities` - Institutional investors, issuers, ETFs
  - `filings` - SEC filing metadata
  - `positions_13f` - 13F position holdings
  - `bo_snapshots` - Beneficial ownership snapshots
  - `uhf_positions` - Ultra-high-frequency trading positions
  - `rotation_events` - Detected rotation events
  - `rotation_edges` - Graph edges representing flows

- **Indexes** (002_indexes.sql):
  - Performance indexes on frequently queried columns

- **GraphRAG Tables** (010_graphrag_init.sql):
  - `graph_nodes` - Knowledge graph nodes
  - `graph_edges` - Knowledge graph edges
  - `graph_communities` - Detected communities
  - `node_bindings` - Node lookup mappings
  - `graph_explanations` - AI-generated explanations

- **GraphRAG Indexes** (011_graphrag_indexes.sql):
  - Indexes for graph query performance

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
   temporal operator search-attribute list --namespace default
   ```

## Application Configuration

### Install Dependencies

```bash
cd apps/temporal-worker
pnpm install
```

### Build TypeScript

```bash
pnpm run build
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
cd apps/temporal-worker
npm run build
node dist/worker.js
```

You should see output indicating the worker is connected:

```
Worker connected to Temporal server
Task queue: rotation-detector
Namespace: default
Registered workflows: ingestIssuerWorkflow, rotationDetectWorkflow, ...
```

### Seed Index Calendar (Optional)

The index calendar tracks Russell index rebalance dates:

```bash
node dist/tools/seed-index-calendar.js
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
temporal workflow list --query 'ticker="AAPL"'
temporal workflow describe --workflow-id <workflow-id>
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
