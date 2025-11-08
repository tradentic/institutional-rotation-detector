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

**1. Node.js 20+**
```bash
# macOS
brew install node@20

# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version  # Should be v20.x.x
npm --version
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

# Linux/Windows (using npm)
npm install -g supabase

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

# 2. Copy environment template
cp .env.example apps/temporal-worker/.env

# 3. Edit .env and add your OpenAI API key and SEC User-Agent
# OPENAI_API_KEY=sk-your-key-here
# SEC_USER_AGENT=YourName your.email@domain.com

# 4. Start Supabase (in Terminal 1)
supabase start

# 5. Apply migrations
supabase db reset

# 6. Start Temporal (in Terminal 2)
temporal server start-dev

# 7. Create search attributes (in Terminal 3)
temporal operator search-attribute create --namespace default --name ticker --type Keyword
temporal operator search-attribute create --namespace default --name cik --type Keyword
temporal operator search-attribute create --namespace default --name quarter_start --type Datetime
temporal operator search-attribute create --namespace default --name quarter_end --type Datetime
temporal operator search-attribute create --namespace default --name run_kind --type Keyword

# 8. Install dependencies and build
cd apps/temporal-worker
npm install
npm run build

# 9. Start worker (same Terminal 3)
node dist/worker.js

# 10. Test (in Terminal 4)
curl -X POST "http://localhost:3000/api/run?ticker=AAPL&from=2024Q1&to=2024Q1&runKind=daily"
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

**Method 1: Using Supabase CLI (Recommended)**

First, link migrations to Supabase:

```bash
# Copy migrations to Supabase directory
cp db/migrations/001_init.sql supabase/migrations/20240101000001_init.sql
cp db/migrations/002_indexes.sql supabase/migrations/20240101000002_indexes.sql
cp db/migrations/010_graphrag_init.sql supabase/migrations/20240101000010_graphrag_init.sql
cp db/migrations/011_graphrag_indexes.sql supabase/migrations/20240101000011_graphrag_indexes.sql

# Reset database with migrations
supabase db reset
```

**Method 2: Using psql Directly**

```bash
psql postgresql://postgres:postgres@localhost:54322/postgres -f db/migrations/001_init.sql
psql postgresql://postgres:postgres@localhost:54322/postgres -f db/migrations/002_indexes.sql
psql postgresql://postgres:postgres@localhost:54322/postgres -f db/migrations/010_graphrag_init.sql
psql postgresql://postgres:postgres@localhost:54322/postgres -f db/migrations/011_graphrag_indexes.sql
```

### Verify Database Setup

**Using psql:**
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
temporal operator search-attribute create \
  --namespace default \
  --name ticker --type Keyword

temporal operator search-attribute create \
  --namespace default \
  --name cik --type Keyword

temporal operator search-attribute create \
  --namespace default \
  --name quarter_start --type Datetime

temporal operator search-attribute create \
  --namespace default \
  --name quarter_end --type Datetime

temporal operator search-attribute create \
  --namespace default \
  --name run_kind --type Keyword
```

**Verify:**
```bash
temporal operator search-attribute list --namespace default
```

**Expected Output:**
```
+------------------+----------+
|       NAME       |   TYPE   |
+------------------+----------+
| ticker           | Keyword  |
| cik              | Keyword  |
| quarter_start    | Datetime |
| quarter_end      | Datetime |
| run_kind         | Keyword  |
+------------------+----------+
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

---

## Application Setup

### Install Dependencies

```bash
cd apps/temporal-worker
npm install
```

### Configure Environment Variables

```bash
# Copy example
cp ../../.env.example .env

# Edit .env
nano .env  # or use your preferred editor
```

**Required Changes:**

```bash
# ⚠️ MUST CHANGE: Add your OpenAI API key
OPENAI_API_KEY=sk-your-actual-openai-api-key-here

# ⚠️ MUST CHANGE: Add your SEC User-Agent
SEC_USER_AGENT=YourName your.email@domain.com

# These should work as-is for local development:
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=rotation-detector
TEMPORAL_ADDRESS=localhost:7233
```

### Build TypeScript

```bash
npm run build
```

**Expected Output:**
```
> rotation-detector-temporal-worker@1.0.0 build
> tsc -p tsconfig.json

✓ Built successfully
```

### Run Tests (Optional)

```bash
npm test
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
temporal server start-dev
# Leave running
```

**Terminal 3: Worker**
```bash
cd ~/institutional-rotation-detector/apps/temporal-worker
npm run build && node dist/worker.js
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
temporal operator search-attribute create --namespace default --name ticker --type Keyword || true
temporal operator search-attribute create --namespace default --name cik --type Keyword || true
temporal operator search-attribute create --namespace default --name quarter_start --type Datetime || true
temporal operator search-attribute create --namespace default --name quarter_end --type Datetime || true
temporal operator search-attribute create --namespace default --name run_kind --type Keyword || true

echo "✅ Development environment ready!"
echo ""
echo "📊 Access points:"
echo "  Supabase Studio: http://localhost:54323"
echo "  Temporal UI:     http://localhost:8233"
echo "  PostgreSQL:      postgresql://postgres:postgres@localhost:54322/postgres"
echo ""
echo "Next steps:"
echo "  1. cd apps/temporal-worker"
echo "  2. npm install && npm run build"
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
temporal workflow list

# Check server health
curl http://localhost:8233/api/v1/health
```

### 3. Test Worker

**Trigger a test workflow:**

```bash
cd apps/temporal-worker

# Using Temporal CLI
temporal workflow start \
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
curl -X POST "http://localhost:3000/api/run?ticker=AAPL&from=2024Q1&to=2024Q1&runKind=daily"

# Or using Temporal CLI
temporal workflow start \
  --task-queue rotation-detector \
  --type ingestIssuerWorkflow \
  --input '{"ticker":"AAPL","from":"2024Q1","to":"2024Q1","runKind":"daily","minPct":5}' \
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
temporal server start-dev
```

**2. Make Code Changes**
```bash
cd apps/temporal-worker/src
# Edit workflows, activities, or lib files
```

**3. Rebuild and Restart Worker**
```bash
# In Terminal 3
npm run build && node dist/worker.js
```

**4. Test Changes**
```bash
# Trigger workflow
temporal workflow start --task-queue rotation-detector --type myWorkflow --input '{}'

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
npm install -g nodemon

# Run with auto-reload
nodemon --watch src --exec "npm run build && node dist/worker.js"
```

### Database Migrations

**Create new migration:**

```bash
# Using Supabase CLI
supabase migration new add_new_table

# Edit the generated file in supabase/migrations/
# Then apply
supabase db reset
```

**Or manually:**

```bash
# Create migration file
cat > db/migrations/012_my_changes.sql << 'EOF'
CREATE TABLE my_new_table (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);
EOF

# Apply
psql postgresql://postgres:postgres@localhost:54322/postgres -f db/migrations/012_my_changes.sql
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

## Related Documentation

- [Setup Guide](SETUP.md) - Production setup
- [Development](DEVELOPMENT.md) - Contributing guide
- [Workflows](WORKFLOWS.md) - Workflow reference
- [Troubleshooting](TROUBLESHOOTING.md) - Common issues

---

For questions or issues, see [main README](../README.md#support).
