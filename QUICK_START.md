# Quick Start Guide - Institutional Rotation Detector

This guide will get you up and running in under 10 minutes.

## Prerequisites

- Docker Desktop (running)
- Node.js 20+
- pnpm (package manager) - Install with: `npm install -g pnpm`
- Git

## Local Development Setup

### 1. Install Dependencies

**Install workspace dependencies (from repo root):**
```bash
pnpm install
```

This installs all dependencies for all apps and libraries in the monorepo.

### 2. Install CLIs

**Supabase CLI:**
```bash
# macOS
brew install supabase/tap/supabase

# Linux/Windows
pnpm install -g supabase
```

**Temporal CLI:**
```bash
# macOS
brew install temporal

# Linux
curl -sSf https://temporal.download/cli.sh | sh
```

### 3. Start Services

**Terminal 1 - Supabase:**
```bash
cd institutional-rotation-detector
supabase start
```

**Terminal 2 - Temporal (with persistent storage):**
```bash
./tools/start-temporal.sh
# OR: temporal server start-dev --db-filename .temporal/data/temporal.db
```

**Note:** Using `--db-filename` ensures namespaces and workflows persist across restarts.

**Terminal 3 - Setup & Worker:**
```bash
# Setup Temporal search attributes
./tools/setup-temporal-attributes.sh

# Sync environment variables automatically
./tools/sync-supabase-env.sh   # Syncs Supabase credentials to all apps
./tools/sync-temporal-env.sh   # Syncs Temporal config to all apps

# Add your API keys (required)
cd apps/temporal-worker
nano .env.local

# Add these values to .env.local:
# - OPENAI_API_KEY=sk-your-key
# - SEC_USER_AGENT=YourName your.email@domain.com
# (Supabase and Temporal config already synced automatically)

# Build and start temporal worker (from repo root)
cd ../..
pnpm run build:worker
pnpm run start:worker
```

### 4. Verify Everything Works

```bash
# In Terminal 4 - Test workflow
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type testSearchAttributesWorkflow \
  --input '{"ticker":"TEST"}'
```

**Access UIs:**
- Temporal UI: http://localhost:8233
- Supabase Studio: http://localhost:54323

---

**💡 Pro Tip:** You can build all apps at once from the repo root:
```bash
pnpm run build        # Build all apps and libraries
pnpm run build:worker # Build just temporal-worker
pnpm run build:api    # Build just API
pnpm run build:admin  # Build just admin UI
```

## GitHub Codespaces Setup

### 1. Open in Codespaces

Click "Code" → "Codespaces" → "Create codespace on main"

Wait for devcontainer to build (3-5 minutes). **Everything is automated!** The setup:

**✅ Services Started:**
- Supabase (with migrations applied)
- Temporal server (with persistent storage)
- Redis
- Temporal search attributes configured

**✅ Dependencies & Build:**
- All workspace dependencies installed (`pnpm install`)
- Temporal worker built and ready (`pnpm run build:worker`)
- Environment variables synced to all apps

### 2. Add Your API Keys

The **only** manual step - add your API keys to `.env.local`:

```bash
cd apps/temporal-worker
nano .env.local
```

Add these two values:
```bash
OPENAI_API_KEY=sk-your-key-here
SEC_USER_AGENT=YourName your.email@domain.com
```

All other values (Supabase, Temporal) are already configured automatically!

**Note:** The API app uses the same configuration from `apps/temporal-worker`, so you don't need a separate `.env.local` file for it.

### 3. Start Worker

```bash
# Worker is already built, just start it from repo root!
pnpm run start:worker
```

### 4. Access Forwarded Ports

Codespaces automatically forwards:
- **Port 8233** - Temporal UI
- **Port 54323** - Supabase Studio
- **Port 3000** - API (when running)

Click the "Ports" tab to access them.

## Running Your First Analysis

### Example: Ingest BlackRock (BLK) 13F Filings

**Note:** Use institutional investor tickers (BLK, GS, MS, etc.) that file 13F forms, not issuer tickers.

```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type ingestIssuerWorkflow \
  --input '{
    "ticker": "BLK",
    "from": "2024Q1",
    "to": "2024Q1",
    "runKind": "daily",
    "minPct": 5
  }'
```

Monitor progress in Temporal UI: http://localhost:8233

### Query Results

```bash
# Using psql
psql postgresql://postgres:postgres@localhost:54322/postgres

SELECT ticker, anchor_date, r_score, dump_magnitude, uptake_next
FROM rotation_events
WHERE ticker = 'BLK'
ORDER BY r_score DESC
LIMIT 10;
```

## Common Commands

### Supabase

```bash
# Start
supabase start

# Stop
supabase stop

# Reset database (WARNING: deletes all data)
supabase db reset

# View status
supabase status
```

### Temporal

```bash
# List workflows
temporal workflow list --namespace ird

# Describe workflow
temporal workflow describe --namespace ird --workflow-id <id>

# List search attributes
temporal operator search-attribute list --namespace ird
```

### Worker

```bash
# Rebuild from repo root
pnpm run build:worker

# Or rebuild from worker directory
cd apps/temporal-worker
pnpm run build

# Run from repo root
cd ../..
pnpm run start:worker

# Run with environment variables
TEMPORAL_ADDRESS=localhost:7233 pnpm run start:worker
```

## Troubleshooting

### Supabase won't start
```bash
supabase stop
docker ps -a | grep supabase | awk '{print $1}' | xargs docker rm -f
supabase start
```

### Temporal connection refused
```bash
# Check if running
temporal server health

# If not, start it
temporal server start-dev
```

### Worker errors - "missing activity"
```bash
# Rebuild from root
pnpm run build:worker

# Or from worker directory
cd apps/temporal-worker
pnpm run build
```

### Database connection failed
```bash
# Get connection string
supabase status | grep "DB URL"

# Test connection
psql <connection-string> -c "SELECT 1"
```

### Reset Temporal data
```bash
# If you need to start fresh with Temporal
rm -rf .temporal/data/
./tools/start-temporal.sh
./tools/setup-temporal-attributes.sh
```

## Next Steps

1. **Read the docs**: Check `docs/LOCAL_DEVELOPMENT.md` for detailed setup
2. **Explore workflows**: See `docs/WORKFLOWS.md` for all available workflows
3. **Understand the architecture**: Review `docs/ARCHITECTURE.md`
4. **Run examples**: Try the workflows in `docs/WORKFLOWS.md#running-workflows`

## Environment Variables Reference

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for LLM features | `sk-proj-...` |
| `SEC_USER_AGENT` | SEC EDGAR API identifier | `YourName your@email.com` |

### Supabase (Auto-configured locally)

| Variable | Default | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | `http://localhost:54321` | Supabase API URL |
| `SUPABASE_ANON_KEY` | From `supabase start` | Public API key |
| `SUPABASE_SERVICE_ROLE_KEY` | From `supabase start` | Admin API key |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:54322/postgres` | Direct DB connection |

### Temporal (Auto-configured locally)

| Variable | Default | Description |
|----------|---------|-------------|
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal server address |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `TEMPORAL_TASK_QUEUE` | `rotation-detector` | Task queue name |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_MODEL` | `gpt-4-turbo-preview` | OpenAI model to use |
| `RATE_LIMIT_PER_SECOND` | `10` | SEC API rate limit |
| `MIN_DUMP_PCT` | `5` | Minimum dump threshold (%) |

## Support

- **Issues**: Open an issue on GitHub
- **Documentation**: See `docs/` directory
- **Architecture**: See `DEVELOPMENT_ISSUES.md` for known limitations

---

**Last Updated**: 2025-11-09
**Version**: 1.0.0
