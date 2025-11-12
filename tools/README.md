# Tools

Utility scripts for data backfilling, seeding, and maintenance operations.

## Overview

This directory contains standalone scripts for administrative tasks that are run outside of normal workflow execution. These tools are typically used for:

- Initial data loading (backfills)
- Seeding reference data
- One-off data migrations
- Maintenance operations

## Available Tools

### Development Helper Scripts

#### `dev-start.sh`

Starts the complete local development environment (Supabase + Temporal).

**Purpose:**
- One-command startup for development
- Handles dependency checks
- Provides helpful access URLs

**Usage:**
```bash
./tools/dev-start.sh
```

**What it does:**
1. Checks for required CLI tools (supabase, temporal, docker)
2. Starts Supabase locally
3. Starts Temporal server (foreground)
4. Displays access URLs and next steps

**Access Points:**
- Supabase Studio: http://localhost:54323
- Temporal UI: http://localhost:8233
- PostgreSQL: postgresql://postgres:postgres@localhost:54322/postgres

---

#### `dev-stop.sh`

Stops all local development services.

**Usage:**
```bash
./tools/dev-stop.sh
```

**What it does:**
1. Stops Supabase
2. Kills Temporal server process

---

#### `start-temporal.sh`

Starts Temporal development server with persistent SQLite storage.

**Purpose:**
- Persist namespaces, workflows, and history across restarts
- Avoid data loss when stopping Temporal server
- Simplify local development workflow

**Usage:**
```bash
./tools/start-temporal.sh
```

**What it does:**
1. Checks for Temporal CLI
2. Creates `.temporal/data/` directory
3. Starts Temporal with `--db-filename .temporal/data/temporal.db`
4. Displays access URLs

**Benefits:**
- ✅ Namespaces persist across restarts
- ✅ Workflow history retained
- ✅ Search attributes remain configured
- ✅ Works in local development and GitHub Codespaces

**Database Location:**
- `.temporal/data/temporal.db` (SQLite, gitignored)

**Alternative:** Run manually with:
```bash
temporal server start-dev --db-filename .temporal/data/temporal.db
```

**To reset Temporal data:**
```bash
rm -rf .temporal/data/
./tools/start-temporal.sh
```

---

#### `setup-temporal-attributes.sh`

Creates Temporal search attributes for the project.

**Purpose:**
- One-time setup for Temporal search attributes
- Idempotent (safe to run multiple times)
- Waits for Temporal to be ready

**Usage:**
```bash
./tools/setup-temporal-attributes.sh
```

**What it does:**
1. Waits for Temporal server to be healthy
2. Creates search attributes:
   - Ticker (Keyword)
   - CIK (Keyword)
   - FilerCIK (Keyword)
   - Form (Keyword)
   - Accession (Keyword)
   - PeriodEnd (Datetime)
   - WindowKey (Keyword)
   - BatchId (Keyword)
   - RunKind (Keyword)

---

#### `db-reset.sh`

Resets the local database with all migrations.

**Purpose:**
- Fresh database state for testing
- Apply all migrations in correct order
- Confirm before destroying data

**Usage:**
```bash
./tools/db-reset.sh
```

**What it does:**
1. Prompts for confirmation (destructive!)
2. Copies migrations to supabase/migrations/
3. Runs `supabase db reset`

**⚠️ WARNING:** This deletes all local data!

---

### Environment Sync Scripts

Scripts for automatically configuring environment variables by extracting values from running services.

#### `sync-supabase-env.sh`

Extracts Supabase credentials from `supabase status` and writes them to `.env.local` files.

**Purpose:**
- Auto-configure Supabase connection for local development
- Eliminate manual copying of credentials from `supabase status`
- Keep apps/temporal-worker and apps/api in sync

**Usage:**
```bash
# Sync to all apps (temporal-worker and api)
./tools/sync-supabase-env.sh

# Sync to a specific directory
./tools/sync-supabase-env.sh apps/temporal-worker
```

**What it does:**
1. Checks if Supabase is running
2. Extracts: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`
3. Updates or creates `.env.local` in target directories

**Requirements:**
- Supabase CLI installed and running (`supabase start`)

---

#### `sync-temporal-env.sh`

Configures Temporal connection settings with defaults for local development.

**Purpose:**
- Auto-configure Temporal connection settings
- Eliminate manual entry of Temporal configuration
- Ensure consistent defaults across apps

**Usage:**
```bash
# Sync to all apps (temporal-worker and api)
./tools/sync-temporal-env.sh

# Sync to a specific directory
./tools/sync-temporal-env.sh apps/temporal-worker
```

**What it does:**
1. Sets default Temporal configuration:
   - `TEMPORAL_ADDRESS=localhost:7233`
   - `TEMPORAL_NAMESPACE=default`
   - `TEMPORAL_TASK_QUEUE=rotation-detector`
2. Updates or creates `.env.local` in target directories

**Requirements:**
- Temporal server running (`temporal server start-dev`)

---

#### Complete Environment Setup Example

```bash
# 1. Start services
supabase start                    # Terminal 1
./tools/start-temporal.sh         # Terminal 2 (with persistence)

# 2. Sync all environment variables (Terminal 3)
./tools/sync-supabase-env.sh     # Extract Supabase credentials to all apps
./tools/sync-temporal-env.sh     # Set Temporal defaults for all apps

# 3. Add your API keys (these can't be auto-detected)
cd apps/temporal-worker
nano .env.local
# Add: OPENAI_API_KEY and SEC_USER_AGENT

# 4. Build and start
cd ../..
pnpm install && pnpm run build:worker
pnpm run start:worker
```

**Note:** In GitHub Codespaces, environment sync happens automatically in the `post-start.sh` hook!

---

### Data Management Tools

### `backfill-2019-2025.ts`

Triggers a backfill workflow to ingest historical data for a ticker from 2019 to 2025.

**Purpose:**
- Load historical rotation data for analysis
- Populate database with past quarters
- Build historical knowledge graphs

**Usage:**
```bash
cd apps/temporal-worker
npm run build

# Backfill single ticker
ts-node ../../tools/backfill-2019-2025.ts AAPL
```

**What it does:**
1. Connects to Temporal server
2. Starts `ingestIssuerWorkflow` with:
   - Date range: 2019-01-01 to 2025-12-31
   - Run kind: `backfill`
   - Quarter batch size: 8 (configurable via env var)
3. Returns workflow ID for monitoring

**Configuration:**
- `TEMPORAL_NAMESPACE` - Temporal namespace (default: `default`)
- `TEMPORAL_TASK_QUEUE` - Task queue (default: `rotation-detector`)
- `QUARTER_BATCH` - Quarters per batch (default: `8`)

**Example:**
```bash
# Backfill Apple from 2019-2025
ts-node tools/backfill-2019-2025.ts AAPL

# Monitor progress
temporal workflow list --namespace ird --query 'ticker="AAPL" AND runKind="backfill"'
```

**Runtime:**
- Depends on quarters and data availability
- Typical: 2-4 hours for full backfill
- Respects SEC rate limits (10 req/sec)

**Output:**
```
Started workflow backfill-AAPL-1699123456 run abc123def456
```

---

### `seed-index-calendar.ts`

Populates the `index_windows` table with Russell and S&P index rebalance dates.

**Purpose:**
- Seed reference data for index rebalance detection
- Support rotation scoring (index penalty calculation)
- Enable filtering of index-driven events

**Usage:**
```bash
cd apps/temporal-worker
npm run build

ts-node ../../tools/seed-index-calendar.ts
```

**What it does:**
1. Connects to Supabase/PostgreSQL
2. Generates index rebalance windows for:
   - **Russell Annual**: May 15 - July 15 (2019-2025)
   - **Russell Semi-annual**: May & Oct-Dec (2026-2030)
   - **S&P Quarterly**: Mar, Jun, Sep, Dec (2019-2030)
3. Upserts records into `index_windows` table

**Data Generated:**

| Index | Phase | Window | Count |
|-------|-------|--------|-------|
| Russell | Annual | May 15 - Jul 15 | 7 years (2019-2025) |
| Russell | Effective | Jun 1 - Jun 30 | 7 years (2019-2025) |
| Russell | Semi-annual | May & Oct-Dec | 5 years (2026-2030) |
| S&P | Quarterly | Mar, Jun, Sep, Dec | 12 years (2019-2030) |

**Configuration:**
- `SUPABASE_URL` - Database URL
- `SUPABASE_SERVICE_ROLE_KEY` - Database credentials

**Example:**
```bash
ts-node tools/seed-index-calendar.ts
# Output: Seeded 156 windows
```

**Verification:**
```sql
SELECT index_name, phase, COUNT(*)
FROM index_windows
GROUP BY index_name, phase;
```

**When to run:**
- After initial database setup
- When adding new years to analysis range
- If index calendar data is missing

---

### `seed-fund-managers.ts`

Populates the `entities` table with common institutional fund managers.

**Purpose:**
- Pre-seed fund manager entities for faster first ingestion
- Avoid repeated SEC API calls during 13F parsing
- Provide known entity names instead of placeholders

**Important Note:**
As of the latest update, the system **auto-creates missing fund manager entities** when parsing 13F filings. This seed script is **optional but recommended** to speed up the first ingestion run.

**Usage:**
```bash
# From repo root (recommended)
pnpm run seed:managers

# Or directly with tsx
tsx --env-file=apps/temporal-worker/.env.local tools/seed-fund-managers.ts
```

**What it does:**
1. Connects to Supabase/PostgreSQL
2. Seeds 20+ common institutional fund managers:
   - Berkshire Hathaway Inc.
   - Vanguard Group Inc.
   - BlackRock Inc.
   - Fidelity Investments
   - State Street Global Advisors
   - And 15+ more major fund managers
3. Upserts records into `entities` table with `kind='manager'`
4. Uses conflict resolution on `(cik, kind)` - safe to run multiple times

**How Auto-Creation Works:**

When the `ingestIssuerWorkflow` encounters a fund manager that doesn't exist in the database:
1. It fetches the entity name from SEC's `/submissions/CIK{cik}.json` API
2. Creates a new `entities` record with the fetched name (or a placeholder)
3. Continues processing the 13F filing

This means you can start with an **empty database** and the workflow will populate fund managers automatically.

**Why Pre-Seed?**

While auto-creation works, pre-seeding has benefits:
- ✅ Faster first run (no SEC API calls for common managers)
- ✅ Known entity names instead of placeholders
- ✅ Reduces risk of SEC rate limiting during ingestion
- ✅ Better for batch ingestion of multiple issuers

**Configuration:**
- `SUPABASE_URL` - Database URL
- `SUPABASE_SERVICE_ROLE_KEY` - Database credentials

**Example:**
```bash
pnpm run seed:managers
# Output: ✓ Successfully seeded 20 fund managers
```

**Verification:**
```sql
SELECT name, cik, kind
FROM entities
WHERE kind = 'manager'
ORDER BY name;
```

**When to run:**
- After initial database setup (optional)
- Before large backfills to speed up ingestion
- If you want proper entity names instead of placeholders

**Related:**
- See [SETUP.md](../docs/guides/SETUP.md#seeding-initial-data) for full setup instructions
- Fund manager auto-creation is in `apps/temporal-worker/src/activities/edgar.activities.ts:293-344`

---

## Creating New Tools

### Best Practices

1. **Standalone Execution**: Tools should run independently, not within workflows
2. **Idempotent**: Safe to run multiple times (use upserts)
3. **Error Handling**: Catch errors and exit with proper codes
4. **Logging**: Clear output for monitoring progress
5. **Configuration**: Use environment variables for credentials

### Template

```typescript
// tools/my-tool.ts
import { createSupabaseClient } from '../apps/temporal-worker/src/lib/supabase.js';

async function main() {
  // Parse arguments
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: ts-node my-tool.ts <arg>');
    process.exit(1);
  }

  // Initialize clients
  const supabase = createSupabaseClient();

  // Perform work
  console.log('Starting operation...');
  const { data, error } = await supabase
    .from('my_table')
    .upsert({ /* data */ });

  if (error) {
    throw error;
  }

  console.log(`Completed: ${data.length} records processed`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
```

### Running Tools

```bash
# Build TypeScript first
cd apps/temporal-worker
npm run build

# Run tool with ts-node
ts-node ../../tools/my-tool.ts [args]

# Or compile and run
tsc ../../tools/my-tool.ts
node ../../tools/my-tool.js [args]
```

## Common Use Cases

### Backfill Multiple Tickers

```bash
# Create a shell script
#!/bin/bash
TICKERS="AAPL MSFT GOOGL AMZN TSLA"
for ticker in $TICKERS; do
  echo "Backfilling $ticker..."
  ts-node tools/backfill-2019-2025.ts $ticker
  sleep 5  # Brief pause between starts
done
```

### Re-seed Reference Data

```bash
# Re-run seed script (idempotent)
ts-node tools/seed-index-calendar.ts
```

### Trigger Custom Date Range

Create a custom backfill script:

```typescript
// tools/backfill-custom.ts
import { createTemporalConnection } from '../apps/temporal-worker/temporal.config.js';

async function main() {
  const [ticker, from, to] = process.argv.slice(2);

  const temporal = await createTemporalConnection({
    namespace: 'default',
    taskQueue: 'rotation-detector',
  });

  const handle = await temporal.connection
    .workflowClient()
    .start('ingestIssuerWorkflow', {
      args: [{
        ticker,
        from,
        to,
        minPct: 5,
        runKind: 'backfill',
        quarterBatch: 8,
      }],
      taskQueue: 'rotation-detector',
    });

  console.log(`Started: ${handle.id}`);
}

main().catch(console.error);
```

Usage:
```bash
ts-node tools/backfill-custom.ts AAPL 2023Q1 2024Q4
```

## Monitoring

### Check Workflow Progress

```bash
# List backfill workflows
temporal workflow list --namespace ird --query 'runKind="backfill"'

# Describe specific workflow
temporal workflow describe --namespace ird --workflow-id <id>

# Show workflow history
temporal workflow show --namespace ird --workflow-id <id>
```

### Check Database

```sql
-- Count filings by ticker
SELECT
  e.name,
  COUNT(DISTINCT f.accession) as filing_count
FROM filings f
JOIN entities e ON e.cik = f.cik
WHERE e.kind = 'issuer'
GROUP BY e.name
ORDER BY filing_count DESC;

-- Check rotation events
SELECT issuer_cik, COUNT(*)
FROM rotation_events
GROUP BY issuer_cik;

-- Verify index windows
SELECT * FROM index_windows ORDER BY window_start;
```

## Troubleshooting

### Tool Cannot Connect to Temporal

**Issue:** `Error: Unable to connect to Temporal server`

**Solution:**
- Verify Temporal server is running: `temporal server health`
- Check environment variables: `TEMPORAL_NAMESPACE`, `TEMPORAL_ADDRESS`
- For Temporal Cloud, verify certificates are configured

### Database Connection Failed

**Issue:** `Error: Connection refused`

**Solution:**
- Verify Supabase credentials: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Test connection: `psql "postgresql://..."`
- Check network connectivity

### Workflow Takes Too Long

**Issue:** Backfill workflow runs for many hours

**Solution:**
- Reduce `QUARTER_BATCH` to lower parallelism
- Check SEC rate limiting (should be 10 req/sec)
- Monitor Temporal worker logs for bottlenecks
- Consider splitting into multiple smaller backfills

### Out of Memory

**Issue:** Node process crashes with OOM error

**Solution:**
```bash
# Increase Node.js memory limit
NODE_OPTIONS="--max-old-space-size=4096" ts-node tools/backfill-2019-2025.ts AAPL
```

## Future Tools

Ideas for additional utility scripts:

- `export-rotation-events.ts` - Export events to CSV/JSON
- `cleanup-old-data.ts` - Archive/delete old positions
- `verify-data-integrity.ts` - Check for missing filings or inconsistencies
- `recalculate-scores.ts` - Re-score existing rotation events
- `rebuild-graphs.ts` - Regenerate knowledge graphs for a period
- `benchmark-queries.ts` - Performance testing for common queries

## Related Documentation

- [Setup Guide](../docs/SETUP.md) - Initial setup and configuration
- [Architecture](../docs/ARCHITECTURE.md) - System design overview
- [Workflows](../docs/WORKFLOWS.md) - Workflow documentation (Phase 2)
- [Development](../docs/DEVELOPMENT.md) - Contributing guide (Phase 2)

---

For questions or issues, see [main README](../README.md#support).
