# Local Development Setup

Complete guide for setting up a local development environment with Supabase and Temporal running locally.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Supabase Local Setup](#supabase-local-setup)
- [Temporal Local Setup](#temporal-local-setup)
- [Application Setup](#application-setup)
- [Running the Stack](#running-the-stack)
- [Verification](#verification)
- [Development Workflow](#development-workflow)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Software

**1. Node.js 20+ and pnpm**
```bash
# macOS
brew install node@20

# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm (if not already installed)
npm install -g pnpm

# Verify
node --version  # Should be v20.x.x
pnpm --version  # Should be 9.x or 10.x
```

**2. Docker Desktop**
```bash
# macOS
brew install --cask docker

# Ubuntu/Debian
sudo apt-get install docker.io docker-compose

# Start Docker
# macOS: Open Docker Desktop app
# Linux: sudo systemctl start docker

# Verify
docker --version
docker-compose --version
```

**3. Supabase CLI**
```bash
# macOS
brew install supabase/tap/supabase

# Linux/Windows (using pnpm)
pnpm install -g supabase

# Verify
supabase --version
```

**4. Temporal CLI**
```bash
# macOS
brew install temporal

# Linux
curl -sSf https://temporal.download/cli.sh | sh

# Verify
temporal --version
```

**5. Git**
```bash
# Should already be installed
git --version
```

### Optional but Recommended

**PostgreSQL Client (for manual database access)**
```bash
# macOS
brew install postgresql@15

# Ubuntu/Debian
sudo apt-get install postgresql-client-15
```

**VS Code with Extensions**
- ESLint
- Prettier
- TypeScript and JavaScript Language Features
- Temporal
- PostgreSQL

---

## Quick Start

For the impatient, here's the fastest path to a working local environment:

```bash
# 1. Clone repository
git clone https://github.com/yourusername/institutional-rotation-detector.git
cd institutional-rotation-detector

# 2. Install dependencies (all apps and libraries)
pnpm install

# 3. Start Supabase first (in Terminal 1)
supabase start

# 4. Sync environment variables automatically
./tools/sync-supabase-env.sh    # Extracts Supabase credentials to all apps
./tools/sync-temporal-env.sh    # Sets Temporal defaults for all apps

# 5. Add your API keys
cd apps/temporal-worker
nano .env.local
# Add: OPENAI_API_KEY and SEC_USER_AGENT
# (Supabase and Temporal config already synced!)
cd ../..

# 6. Apply migrations
supabase db reset

# 7. Start Temporal with persistent storage (in Terminal 2)
./tools/start-temporal.sh
# OR: temporal server start-dev --db-filename .temporal/data/temporal.db

# 8. Create search attributes (in Terminal 3)
./tools/setup-temporal-attributes.sh

# 9. Build worker
pnpm run build:worker

# 10. Start worker (same Terminal 3, from repo root)
pnpm run start:worker

# 11. Test (in Terminal 4)
curl -X POST "http://localhost:3000/api/run?ticker=BLK&from=2024Q1&to=2024Q1&runKind=daily"
```

---

## Supabase Local Setup

### Initialize Supabase

The repository already includes Supabase configuration in `supabase/config.toml`. You just need to start it.

**Start Supabase:**
```bash
supabase start
```

This will:
- Pull Docker images (first time only, ~5 minutes)
- Start PostgreSQL, PostgREST, GoTrue, Realtime, Storage, Inbucket
- Initialize the database
- Display connection credentials

**Expected Output:**
```
Started supabase local development setup.

         API URL: http://localhost:54321
     GraphQL URL: http://localhost:54321/graphql/v1
          DB URL: postgresql://postgres:postgres@localhost:54322/postgres
      Studio URL: http://localhost:54323
    Inbucket URL: http://localhost:54324
      JWT secret: super-secret-jwt-token-with-at-least-32-characters-long
        anon key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
service_role key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Important:** Save these credentials! They're in your `.env` file but good to verify.

### Apply Database Migrations

Both migrations and seed data paths are configured in `supabase/config.toml` to load from the `supabase/migrations/` directory.

**Reset database with all migrations:**

```bash
supabase db reset
```

This will:
- Drop the database
- Apply all migrations from `supabase/migrations/` in order (19 migrations total)
- Run any seed files from `supabase/seed/` in alphabetical order
- Initialize all tables, indexes, and extensions including pgvector

**Note:** Always use `supabase db reset` to manage migrations. Do NOT manually run SQL files with psql - the Supabase CLI handles proper migration ordering and tracking.

### Verify Database Setup

**Using Supabase Studio (Recommended):**

Open http://localhost:54323 in your browser and navigate to "Table Editor" to browse all tables.

**Using psql (Optional):**
```bash
psql postgresql://postgres:postgres@localhost:54322/postgres

# List tables
\dt

# Expected tables:
# entities, filings, positions_13f, rotation_events, rotation_edges,
# graph_nodes, graph_edges, graph_communities, etc.

# Check pgvector extension
SELECT * FROM pg_extension WHERE extname = 'vector';

# Exit
\q
```

**Using Supabase Studio:**

Open http://localhost:54323 in your browser.

- Navigate to "Table Editor"
- You should see all tables listed
- Click on a table to view schema

### Supabase Commands

**Common operations:**

```bash
# Start Supabase
supabase start

# Stop Supabase
supabase stop

# Restart Supabase
supabase stop && supabase start

# View status
supabase status

# View logs
supabase logs

# Reset database (WARNING: destroys all data)
supabase db reset

# Create new migration
supabase migration new my_migration_name

# Diff local vs remote (if linked to cloud project)
supabase db diff -f my_changes
```

### Supabase Studio (Web UI)

Access at http://localhost:54323

**Features:**
- **Table Editor**: Browse and edit data
- **SQL Editor**: Run custom queries
- **Database**: View schema, relationships, indexes
- **Authentication**: Manage users (not used in this project)
- **Storage**: File storage (not used in this project)

---

## Temporal Local Setup

### Start Temporal Server

**Development Mode (Easiest):**

```bash
temporal server start-dev
```

This starts:
- Temporal Server (port 7233)
- Temporal Web UI (port 8233)
- SQLite for persistence (in-memory mode)

**Expected Output:**
```
Temporal server is starting...
Server started on localhost:7233
Web UI available at http://localhost:8233
```

**Leave this running in a dedicated terminal.**

### Create Search Attributes

Search attributes must be created before running workflows:

```bash
# In a new terminal
./tools/setup-temporal-attributes.sh
```

**Verify:**
```bash
temporal operator search-attribute list --namespace ird
```

**Expected Output:**
```
+-------------+----------+
|    NAME     |   TYPE   |
+-------------+----------+
| Accession   | Keyword  |
| BatchId     | Keyword  |
| CIK         | Keyword  |
| FilerCIK    | Keyword  |
| Form        | Keyword  |
| PeriodEnd   | Datetime |
| RunKind     | Keyword  |
| Ticker      | Keyword  |
| WindowKey   | Keyword  |
+-------------+----------+
```

### Temporal Web UI

Access at http://localhost:8233

**Features:**
- View all workflows
- Search by workflow ID or search attributes
- Inspect workflow history
- See pending/running/completed workflows
- View activity inputs/outputs
- Debug failed workflows

### Temporal Data Persistence

By default, `temporal server start-dev` uses an **in-memory** database that loses all data when stopped. To persist your namespaces, workflows, and history across restarts, use the `--db-filename` flag:

```bash
# Using the helper script (recommended)
./tools/start-temporal.sh

# OR manually with the flag
temporal server start-dev --db-filename .temporal/data/temporal.db
```

**Benefits:**
- ✅ Namespaces persist across restarts
- ✅ Workflow history is retained
- ✅ Search attributes remain configured
- ✅ Works in both local development and GitHub Codespaces

**Database Location:**
- Local: `.temporal/data/temporal.db` (gitignored)
- Codespaces: Persisted in the workspace (survives rebuilds)

**Note:** The `.temporal/` directory is already included in `.gitignore`, so your local Temporal data won't be committed.

---

## Application Setup

### Install Dependencies

**Always install from repo root:**
```bash
# Installs dependencies for all apps and libraries in the workspace
pnpm install
```

This uses the pnpm workspace configuration (`pnpm-workspace.yaml`) to install and link all dependencies across the monorepo (apps/temporal-worker, apps/api, apps/admin, and all libs).

**Important:** Do NOT run `pnpm install` in individual app directories - always run from repo root to ensure proper workspace linking.

### Configure Environment Variables

**Automated Setup (Recommended):**

Use the provided sync scripts to automatically configure environment variables:

```bash
# 1. Sync Supabase credentials from 'supabase status'
./tools/sync-supabase-env.sh

# 2. Sync Temporal configuration
./tools/sync-temporal-env.sh
```

These scripts will create/update `.env.local` files in `apps/temporal-worker`, `apps/api`, and `apps/admin` with the correct values.

**Add Your API Keys:**

After running the sync scripts, add your required API keys:

```bash
cd apps/temporal-worker
nano .env.local  # or use your preferred editor
```

Add these values:

```bash
# ⚠️ MUST ADD: Your OpenAI API key
OPENAI_API_KEY=sk-your-actual-openai-api-key-here

# ⚠️ MUST ADD: Your SEC User-Agent
SEC_USER_AGENT=YourName your.email@domain.com
```

All other values (Supabase URL, keys, Temporal config) are already set by the sync scripts!

**Manual Setup (Alternative):**

If you prefer manual configuration:

```bash
# Copy example to temporal-worker (API uses the same config)
cd apps/temporal-worker
cp ../../.env.example .env.local

# Get Supabase credentials
supabase status

# Edit .env.local and add all required values manually
nano .env.local
```

**Required values when configuring manually:**

```bash
# OpenAI Configuration
OPENAI_API_KEY=sk-your-actual-openai-api-key-here

# SEC EDGAR Configuration
SEC_USER_AGENT=YourName your.email@domain.com

# Supabase (from 'supabase status'):
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=<your_anon_key_from_supabase_status>
SUPABASE_SERVICE_ROLE_KEY=<your_service_role_key_from_supabase_status>
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres

# Temporal (defaults for local dev):
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=rotation-detector
TEMPORAL_ADDRESS=localhost:7233
```

**Note:** The `sync-supabase-env.sh` and `sync-temporal-env.sh` scripts automatically configure all apps (`temporal-worker`, `api`, and `admin`) with the correct environment variables.

### Build TypeScript

**Build from repo root:**
```bash
# Build just the worker
pnpm run build:worker

# Or build all apps
pnpm build

# Or build specific apps
pnpm --filter temporal-worker build
pnpm --filter api build
pnpm --filter admin build
```

**Expected Output:**
```
> rotation-detector-temporal-worker@1.0.0 build
> tsc -p tsconfig.json

✓ Built successfully
```

### Run Tests (Optional)

```bash
pnpm test
```

---

## Running the Stack

### Full Stack Startup

**Terminal 1: Supabase**
```bash
cd ~/institutional-rotation-detector
supabase start
# Leave running
```

**Terminal 2: Temporal**
```bash
./tools/start-temporal.sh
# OR: temporal server start-dev --db-filename .temporal/data/temporal.db
# Leave running
```

**Terminal 3: Worker**
```bash
cd ~/institutional-rotation-detector
pnpm run build:worker && pnpm run start:worker
# Leave running
```

**Expected Worker Output:**
```
Worker started successfully
Task queue: rotation-detector
Namespace: default
Registered workflows:
  - ingestIssuerWorkflow
  - ingestQuarterWorkflow
  - rotationDetectWorkflow
  - eventStudyWorkflow
  - graphBuildWorkflow
  - graphSummarizeWorkflow
  - graphQueryWorkflow
Listening for tasks...
```

### Helper Scripts (Alternative)

Create a script to start all services:

**`tools/dev-start.sh`:**
```bash
#!/bin/bash
set -e

echo "🚀 Starting Institutional Rotation Detector Development Environment"

# Start Supabase
echo "📦 Starting Supabase..."
supabase start

# Start Temporal in background
echo "⏰ Starting Temporal..."
temporal server start-dev &
TEMPORAL_PID=$!

# Wait for Temporal to be ready
echo "⏳ Waiting for Temporal to be ready..."
sleep 5

# Create search attributes
echo "🔍 Creating search attributes..."
./tools/setup-temporal-attributes.sh

echo "✅ Development environment ready!"
echo ""
echo "📊 Access points:"
echo "  Supabase Studio: http://localhost:54323"
echo "  Temporal UI:     http://localhost:8233"
echo "  PostgreSQL:      postgresql://postgres:postgres@localhost:54322/postgres"
echo ""
echo "Next steps:"
echo "  1. cd apps/temporal-worker"
echo "  2. pnpm install && pnpm run build"
echo "  3. node dist/worker.js"
echo ""
echo "Press Ctrl+C to stop Temporal server"
wait $TEMPORAL_PID
```

Make executable:
```bash
chmod +x tools/dev-start.sh
```

Run:
```bash
./tools/dev-start.sh
```

---

## Verification

### 1. Check Supabase

```bash
# Check status
supabase status

# Verify database connection
psql postgresql://postgres:postgres@localhost:54322/postgres -c "SELECT COUNT(*) FROM entities;"

# Should return 0 (no data yet)
```

### 2. Check Temporal

```bash
# List workflows (should be empty initially)
temporal workflow list --namespace ird

# Check server health
curl http://localhost:8233/api/v1/health
```

### 3. Test Worker

**Trigger a test workflow:**

```bash
cd apps/temporal-worker

# Using Temporal CLI
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type testProbeWorkflow \
  --input '{"ticker":"TEST"}' \
  --workflow-id test-$(date +%s)
```

**Check in Temporal UI:**

Open http://localhost:8233, you should see the test workflow.

### 4. Run End-to-End Test

**Seed test data:**

```bash
# Connect to database
psql postgresql://postgres:postgres@localhost:54322/postgres

-- Insert test entity
INSERT INTO entities (cik, name, kind)
VALUES ('0000320193', 'Apple Inc.', 'issuer');

-- Verify
SELECT * FROM entities;

\q
```

**Trigger analysis:**

```bash
# Using API (if you have API server running)
curl -X POST "http://localhost:3000/api/run?ticker=BLK&from=2024Q1&to=2024Q1&runKind=daily"

# Or using Temporal CLI
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type ingestIssuerWorkflow \
  --input '{"ticker":"BLK","from":"2024Q1","to":"2024Q1","runKind":"daily","minPct":5}' \
  --workflow-id ingest-aapl-$(date +%s)
```

**Monitor progress:**
- Temporal UI: http://localhost:8233
- Worker logs: Check Terminal 3
- Database: Query `rotation_events` table

---

## Development Workflow

### Typical Development Session

**1. Start Services**
```bash
# Terminal 1
supabase start

# Terminal 2
./tools/start-temporal.sh
```

**2. Make Code Changes**
```bash
cd apps/temporal-worker/src
# Edit workflows, activities, or lib files
```

**3. Rebuild and Restart Worker**
```bash
# In Terminal 3 (from repo root)
pnpm run build:worker && pnpm run start:worker
```

**4. Test Changes**
```bash
# Trigger workflow
temporal workflow start --namespace ird --task-queue rotation-detector --type myWorkflow --input '{}'

# View in UI
open http://localhost:8233
```

**5. Query Data**
```bash
# Check database
psql postgresql://postgres:postgres@localhost:54322/postgres

SELECT * FROM rotation_events ORDER BY r_score DESC LIMIT 10;
```

### Hot Reload (Optional)

For faster iteration, use `nodemon`:

```bash
pnpm install -g nodemon

# Run with auto-reload
nodemon --watch src --exec "pnpm run build && node dist/worker.js"
```

### Database Migrations

**Create new migration:**

```bash
# Using Supabase CLI (recommended)
supabase migration new add_new_table

# This creates a timestamped file in supabase/migrations/
# Edit the generated file, then apply all migrations:
supabase db reset
```

**Important:** Always use the Supabase CLI for migrations:
- ✅ `supabase db reset` - Apply all migrations from scratch
- ✅ `supabase migration new <name>` - Create new migration
- ✅ `supabase db diff -f <name>` - Generate migration from schema changes
- ❌ Do NOT use `psql -f migration.sql` manually - breaks migration tracking

**Seed Data:**

Place SQL seed files in `supabase/seed/`. They'll be executed alphabetically after migrations when running `supabase db reset`.

```bash
# Example: Create a seed file
cat > supabase/seed/01_example_data.sql << 'EOF'
INSERT INTO entities (cik, name, entity_type) VALUES
  ('0001234567', 'Example Fund', 'institutional_investor');
EOF

# Apply migrations and seed data
supabase db reset
```

---

## Troubleshooting

### Supabase Won't Start

**Problem:** `supabase start` fails

**Solution:**
```bash
# Stop all containers
supabase stop
docker ps -a | grep supabase | awk '{print $1}' | xargs docker rm -f

# Remove volumes
docker volume ls | grep supabase | awk '{print $2}' | xargs docker volume rm

# Restart
supabase start
```

### Temporal Connection Refused

**Problem:** Worker can't connect to Temporal

**Solution:**
```bash
# Check if Temporal is running
lsof -i :7233

# If not, start it
temporal server start-dev

# Verify
temporal server health
```

### Port Already in Use

**Problem:** Port 54321, 54322, or 7233 already in use

**Solution:**

**For Supabase:**
Edit `supabase/config.toml`:
```toml
[api]
port = 54421  # Change to different port

[db]
port = 54422  # Change to different port
```

**For Temporal:**
```bash
# Start on different port
temporal server start-dev --port 7333

# Update .env
TEMPORAL_ADDRESS=localhost:7333
```

### Database Connection Failed

**Problem:** Can't connect to database

**Solution:**
```bash
# Check Supabase status
supabase status

# If stopped, start it
supabase start

# Test connection
psql postgresql://postgres:postgres@localhost:54322/postgres -c "SELECT 1;"
```

### Workflow Execution Failed

**Problem:** Workflow fails with errors

**Solution:**

1. **Check Temporal UI** (http://localhost:8233)
   - View workflow history
   - Check error messages
   - Inspect activity inputs

2. **Check Worker Logs**
   - Look for exceptions
   - Check activity errors

3. **Verify Environment Variables**
   ```bash
   cat apps/temporal-worker/.env
   # Ensure all required variables are set
   ```

4. **Check Database**
   ```bash
   psql postgresql://postgres:postgres@localhost:54322/postgres

   -- Check if migrations applied
   \dt

   -- Check data
   SELECT * FROM entities LIMIT 5;
   ```

### OpenAI API Errors

**Problem:** `401 Unauthorized` or rate limit errors

**Solution:**
```bash
# Verify API key
echo $OPENAI_API_KEY

# Test API key
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# If invalid, update .env with correct key
```

### SEC EDGAR Rate Limiting

**Problem:** `429 Too Many Requests`

**Solution:**
```bash
# Reduce rate limit in .env
RATE_LIMIT_PER_SECOND=5  # Lower from 10

# Ensure proper User-Agent
SEC_USER_AGENT=YourName your.email@domain.com
```

---

## Next Steps

After your local environment is running:

1. **Read the Documentation**
   - [Architecture](ARCHITECTURE.md) - Understand system design
   - [Workflows](WORKFLOWS.md) - Learn workflow details
   - [Development](DEVELOPMENT.md) - Contributing guidelines

2. **Run Example Workflows**
   - Ingest a single ticker
   - Build a rotation graph
   - Generate explanations

3. **Explore the Data**
   - Use Supabase Studio
   - Run SQL queries
   - Visualize graphs

4. **Make Changes**
   - Add new activities
   - Modify scoring logic
   - Create custom workflows

---

## GitHub Codespaces

For Codespaces setup, see the [QUICK_START.md](../QUICK_START.md#github-codespaces-setup) guide.

Codespaces automatically:
- Installs all dependencies (`pnpm install`)
- Builds the temporal worker (`pnpm run build:worker`)
- Starts Supabase, Temporal, and Redis
- Syncs environment variables

You only need to add your `OPENAI_API_KEY` and `SEC_USER_AGENT` to `apps/temporal-worker/.env.local` and start the worker.

---

## Related Documentation

- [Setup Guide](SETUP.md) - Production setup
- [Development](DEVELOPMENT.md) - Contributing guide
- [Workflows](WORKFLOWS.md) - Workflow reference
- [Troubleshooting](TROUBLESHOOTING.md) - Common issues

---

**Last Updated**: 2025-11-11

For questions or issues, see [main README](../README.md#support).
