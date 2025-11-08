# Troubleshooting Guide

Common issues and solutions for the Institutional Rotation Detector.

## Table of Contents

- [Local Development Issues](#local-development-issues)
- [Supabase Issues](#supabase-issues)
- [Temporal Issues](#temporal-issues)
- [Worker Issues](#worker-issues)
- [Data Issues](#data-issues)
- [Performance Issues](#performance-issues)
- [Production Issues](#production-issues)

---

## Local Development Issues

### Supabase Won't Start

**Problem:** `supabase start` fails with Docker errors

**Symptoms:**
```
Error: failed to start containers: <container-id>
```

**Solutions:**

**1. Docker not running:**
```bash
# macOS: Open Docker Desktop
open -a Docker

# Linux: Start Docker service
sudo systemctl start docker

# Verify
docker ps
```

**2. Port conflicts:**
```bash
# Check what's using ports
lsof -i :54321  # API
lsof -i :54322  # Database
lsof -i :54323  # Studio

# Kill conflicting processes
kill -9 <PID>

# Or change ports in supabase/config.toml
[api]
port = 54421

[db]
port = 54422
```

**3. Corrupted containers:**
```bash
# Stop all
supabase stop

# Remove containers
docker ps -a | grep supabase | awk '{print $1}' | xargs docker rm -f

# Remove volumes
docker volume ls | grep supabase | awk '{print $2}' | xargs docker volume rm

# Restart fresh
supabase start
```

**4. Out of disk space:**
```bash
# Check disk space
df -h

# Clean Docker
docker system prune -a --volumes

# Restart
supabase start
```

---

### Temporal Server Connection Refused

**Problem:** Worker can't connect to Temporal

**Symptoms:**
```
Error: Failed to connect to Temporal server at localhost:7233
connection refused
```

**Solutions:**

**1. Temporal not running:**
```bash
# Check if running
lsof -i :7233

# If not, start it
temporal server start-dev
```

**2. Wrong address:**
```bash
# Check .env
cat apps/temporal-worker/.env | grep TEMPORAL_ADDRESS

# Should be:
TEMPORAL_ADDRESS=localhost:7233

# For Temporal Cloud:
TEMPORAL_ADDRESS=your-namespace.tmprl.cloud:7233
```

**3. Firewall blocking:**
```bash
# macOS: Check firewall
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate

# Allow Temporal
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add temporal
```

---

### Environment Variables Not Loading

**Problem:** Worker starts but crashes immediately

**Symptoms:**
```
Error: OPENAI_API_KEY is required
```

**Solutions:**

**1. .env file missing:**
```bash
# Check if .env exists
ls -la apps/temporal-worker/.env

# If not, copy example
cp .env.example apps/temporal-worker/.env

# Edit with your keys
nano apps/temporal-worker/.env
```

**2. .env in wrong location:**
```bash
# .env must be in apps/temporal-worker/
# NOT in root directory

# Correct:
apps/temporal-worker/.env

# Incorrect:
.env
```

**3. Environment variables not loaded:**
```bash
# Add to worker.ts
import dotenv from 'dotenv';
dotenv.config();

# Or run with dotenv
npm install -g dotenv-cli
dotenv -e .env node dist/worker.js
```

---

### TypeScript Build Errors

**Problem:** `npm run build` fails

**Symptoms:**
```
error TS2307: Cannot find module './workflows/index.js'
```

**Solutions:**

**1. Missing dependencies:**
```bash
cd apps/temporal-worker
rm -rf node_modules package-lock.json
npm install
```

**2. TypeScript version mismatch:**
```bash
# Check version
npx tsc --version

# Should be 5.4.x
# Update if needed
npm install --save-dev typescript@^5.4.5
```

**3. Module resolution:**
```typescript
// Ensure imports use .js extension
import { myWorkflow } from './workflows/index.js';  // ✅ Correct
import { myWorkflow } from './workflows/index';      // ❌ Wrong
```

**4. Clean build:**
```bash
rm -rf dist
npm run build
```

---

## Supabase Issues

### Database Connection Failed

**Problem:** Can't connect to database

**Symptoms:**
```
Error: Connection terminated unexpectedly
Connection refused
```

**Solutions:**

**1. Check Supabase status:**
```bash
supabase status

# If stopped
supabase start
```

**2. Verify connection string:**
```bash
# Local
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres

# Check if port is correct
psql "postgresql://postgres:postgres@localhost:54322/postgres" -c "SELECT 1;"
```

**3. Connection limit reached:**
```sql
-- Check active connections
SELECT count(*) FROM pg_stat_activity;

-- Kill idle connections
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle'
  AND state_change < current_timestamp - INTERVAL '5 minutes';
```

**4. Connection pooling:**
```bash
# Use pooler for production
DATABASE_URL=postgresql://postgres:[PASSWORD]@pooler.supabase.com:5432/postgres
```

---

### Migration Errors

**Problem:** `supabase db reset` fails

**Symptoms:**
```
Error executing migration 001_init.sql:
ERROR: relation "entities" already exists
```

**Solutions:**

**1. Drop database and recreate:**
```bash
# Full reset
supabase db reset --force

# Or manually
psql postgresql://postgres:postgres@localhost:54322/postgres << 'EOF'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
EOF

# Then run migrations
supabase db reset
```

**2. Fix migration order:**
```bash
# Ensure migrations are numbered correctly
ls -la supabase/migrations/

# Should be:
# 20240101000001_init.sql
# 20240101000002_indexes.sql
# ...
```

**3. SQL syntax errors:**
```bash
# Test migration manually
psql postgresql://postgres:postgres@localhost:54322/postgres \
  -f supabase/migrations/20240101000001_init.sql

# Fix any syntax errors in the file
```

---

### pgvector Extension Not Found

**Problem:** Vector operations fail

**Symptoms:**
```
ERROR: type "vector" does not exist
```

**Solutions:**

**1. Install pgvector:**
```sql
-- In psql or Supabase SQL Editor
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify
SELECT * FROM pg_extension WHERE extname = 'vector';
```

**2. Wrong database:**
```bash
# Ensure you're connected to correct database
psql postgresql://postgres:postgres@localhost:54322/postgres

# Not to template1 or other database
```

**3. Insufficient privileges:**
```sql
-- Grant permissions
GRANT USAGE ON SCHEMA public TO postgres;
GRANT CREATE ON SCHEMA public TO postgres;
```

---

## Temporal Issues

### Workflow Failed with Non-Determinism Error

**Problem:** Workflow fails after code changes

**Symptoms:**
```
NonDeterministicError: Workflow execution history is non-deterministic
```

**Solutions:**

**1. Workflow versioning:**
```typescript
import { patched } from '@temporalio/workflow';

export async function myWorkflow(input: Input) {
  // Old code
  const result = patched(
    () => oldActivity(input),
    () => newActivity(input)
  );

  return result;
}
```

**2. Don't use non-deterministic operations:**
```typescript
// ❌ Bad: Non-deterministic
export async function badWorkflow() {
  const now = Date.now();  // Different each replay
  const random = Math.random();  // Different each replay
}

// ✅ Good: Deterministic
export async function goodWorkflow() {
  // Use workflow info for timestamps
  const now = workflowInfo().currentBuildId;

  // Use activities for random values
  const random = await activities.generateRandom();
}
```

**3. Complete the old workflow:**
```bash
# Let running workflows finish
temporal workflow list --query 'WorkflowType="myWorkflow" AND ExecutionStatus="Running"'

# Wait for completion or cancel
temporal workflow cancel --workflow-id <id>
```

---

### Search Attributes Not Working

**Problem:** Can't query workflows by search attributes

**Symptoms:**
```
Error: search attribute "Ticker" is not defined
```

**Solutions:**

**1. Create search attributes:**
```bash
./tools/setup-temporal-attributes.sh

# Verify
temporal operator search-attribute list --namespace default
```

**2. Upsert in workflow:**
```typescript
import { upsertWorkflowSearchAttributes } from '../workflows/utils.js';

export async function myWorkflow(input: Input) {
  await upsertWorkflowSearchAttributes({
    ticker: input.ticker,
    cik: input.cik,
    runKind: input.runKind,
    windowKey: input.windowKey,
    periodEnd: input.periodEnd,
    batchId: input.batchId,
  });

  // Rest of workflow...
}
```

**3. Query syntax:**
```bash
# Correct
temporal workflow list --query 'Ticker="AAPL"'

# Incorrect
temporal workflow list --query 'Ticker=AAPL'  # Missing quotes
```

---

### Workflow Stuck in Running State

**Problem:** Workflow never completes

**Symptoms:**
- Workflow shows "Running" for hours
- No activity is executing
- No errors in logs

**Solutions:**

**1. Check worker is running:**
```bash
# Verify worker is connected
# Look for "Worker started" in logs

# Restart worker
npm run build && node dist/worker.js
```

**2. Check task queue:**
```bash
# Ensure task queue matches
# In workflow start:
--task-queue rotation-detector

# In worker config:
TEMPORAL_TASK_QUEUE=rotation-detector
```

**3. Activity timeout:**
```typescript
// Check activity timeout settings
const { myActivity } = proxyActivities({
  startToCloseTimeout: '5 minutes',  // Increase if needed
});
```

**4. Deadlock:**
```typescript
// Check for circular dependencies
// Example: WorkflowA waits for WorkflowB which waits for WorkflowA

// Fix: Redesign workflow dependencies
```

---

## Worker Issues

### Worker Crashes on Startup

**Problem:** Worker starts then immediately exits

**Symptoms:**
```
Worker started successfully
[Error] Process exited with code 1
```

**Solutions:**

**1. Check logs:**
```bash
# Run with verbose logging
NODE_ENV=development node dist/worker.js

# Look for stack trace
```

**2. Missing dependencies:**
```bash
npm install
npm run build
```

**3. Invalid configuration:**
```bash
# Verify all environment variables
cat .env

# Test each one
echo $OPENAI_API_KEY
echo $SUPABASE_URL
```

**4. Port conflicts:**
```bash
# Worker doesn't listen on a port, but activities might
# Check for other processes
lsof -i :3000  # If running API alongside
```

---

### Out of Memory Errors

**Problem:** Worker crashes with OOM

**Symptoms:**
```
FATAL ERROR: Reached heap limit
Allocation failed - JavaScript heap out of memory
```

**Solutions:**

**1. Increase Node.js memory:**
```bash
# In package.json scripts
"start": "node --max-old-space-size=4096 dist/worker.js"

# Or environment variable
NODE_OPTIONS="--max-old-space-size=4096" node dist/worker.js
```

**2. Memory leak detection:**
```bash
# Use heapdump
npm install heapdump

# In code
import heapdump from 'heapdump';

// Trigger dump
heapdump.writeSnapshot('./heap-' + Date.now() + '.heapsnapshot');

# Analyze with Chrome DevTools
```

**3. Reduce concurrency:**
```typescript
// In worker config
maxConcurrentActivityTaskExecutions: 10,  // Lower from default
maxConcurrentWorkflowTaskExecutions: 50,  // Lower from default
```

**4. Batch processing:**
```typescript
// Process in chunks
import pMap from 'p-map';

const items = [...]; // Large array
await pMap(items, processItem, { concurrency: 10 });
```

---

## Data Issues

### Duplicate Filings

**Problem:** Same filing ingested multiple times

**Symptoms:**
```sql
SELECT accession, COUNT(*)
FROM filings
GROUP BY accession
HAVING COUNT(*) > 1;
```

**Solutions:**

**1. Use ON CONFLICT:**
```typescript
await supabase
  .from('filings')
  .upsert(filing, {
    onConflict: 'accession',  // Don't insert duplicates
  });
```

**2. Clean up duplicates:**
```sql
-- Delete duplicates, keeping oldest
DELETE FROM filings a USING filings b
WHERE a.accession = b.accession
  AND a.ctid < b.ctid;
```

---

### Missing Position Data

**Problem:** Positions not showing up

**Symptoms:**
```sql
SELECT COUNT(*) FROM positions_13f WHERE entity_id = '...';
-- Returns 0
```

**Solutions:**

**1. Check entity exists:**
```sql
SELECT * FROM entities WHERE cik = '0000320193';

-- If missing, insert
INSERT INTO entities (cik, name, kind)
VALUES ('0000320193', 'Apple Inc.', 'issuer');
```

**2. Check filing was parsed:**
```sql
SELECT * FROM filings WHERE accession = '...';

-- If present but no positions, re-parse
```

**3. Verify CUSIP mapping:**
```sql
SELECT * FROM cusip_issuer_map WHERE cusip = '037833100';

-- If missing, add
INSERT INTO cusip_issuer_map (cusip, issuer_cik)
VALUES ('037833100', '0000320193');
```

---

### Rotation Events Not Detected

**Problem:** No rotation events for known rotations

**Symptoms:**
```sql
SELECT COUNT(*) FROM rotation_events WHERE issuer_cik = '...';
-- Returns 0
```

**Solutions:**

**1. Check dump detection:**
```typescript
// In compute.activities.ts
export async function detectDumpEvents() {
  // Add logging
  console.log('Checking for dumps...');
  console.log('Found dumps:', dumps);
}
```

**2. Verify gating logic:**
```typescript
// dumpZ must be >= 1.5
// AND at least one uptake signal > 0

// Check scoring inputs
console.log('Scoring inputs:', {
  dumpZ,
  uSame,
  uNext,
  uhfSame,
  uhfNext,
});
```

**3. Check data completeness:**
```sql
-- Need positions for at least 2 quarters
SELECT asof, COUNT(DISTINCT entity_id)
FROM positions_13f
WHERE cusip = '037833100'
GROUP BY asof
ORDER BY asof DESC;
```

---

## Performance Issues

### Slow Database Queries

**Problem:** Queries take >5 seconds

**Symptoms:**
```sql
EXPLAIN ANALYZE SELECT * FROM positions_13f WHERE cusip = '...';
-- Shows sequential scan
```

**Solutions:**

**1. Create indexes:**
```sql
CREATE INDEX idx_positions_cusip ON positions_13f(cusip);
CREATE INDEX idx_positions_asof ON positions_13f(asof);
```

**2. Vacuum and analyze:**
```sql
VACUUM ANALYZE positions_13f;
VACUUM ANALYZE rotation_events;
```

**3. Partition large tables:**
```sql
-- Partition positions by year
CREATE TABLE positions_13f_2024 PARTITION OF positions_13f
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
```

**4. Use connection pooling:**
```bash
# Supabase pooler
DATABASE_URL=postgresql://...@pooler.supabase.com:5432/postgres
```

---

### Workflow Taking Too Long

**Problem:** Workflow runs for hours

**Symptoms:**
- Workflow stuck in "Running"
- Low activity completion rate
- High queue lag

**Solutions:**

**1. Increase parallelism:**
```typescript
// Use Promise.all for parallel activities
const [filings, positions, short] = await Promise.all([
  activities.fetchFilings(cik, quarter),
  activities.fetchPositions(cik, quarter),
  activities.fetchShortInterest(cik, quarter),
]);
```

**2. Reduce batch size:**
```typescript
// Process fewer items per workflow
quarterBatch: 2,  // Instead of 8
```

**3. Scale workers:**
```bash
# Add more workers
docker-compose up --scale worker=5
```

**4. Profile activities:**
```typescript
export async function myActivity() {
  const start = Date.now();

  // Do work

  const duration = Date.now() - start;
  console.log(`Activity took ${duration}ms`);
}
```

---

## Production Issues

### High API Costs (OpenAI)

**Problem:** OpenAI bills are unexpectedly high

**Solutions:**

**1. Cache responses:**
```typescript
const cache = new Map<string, string>();

export async function generateExplanation(context: string) {
  const key = hash(context);

  if (cache.has(key)) {
    return cache.get(key);
  }

  const result = await openai.chat.completions.create({...});

  cache.set(key, result);
  return result;
}
```

**2. Use cheaper model:**
```typescript
// Instead of gpt-4-turbo-preview
model: 'gpt-4o-mini',  // 97% cheaper
```

**3. Reduce token usage:**
```typescript
// Truncate context
const truncated = context.slice(0, 2000);  // First 2000 chars

// Use shorter prompts
const prompt = `Summarize: ${truncated}`;
```

---

### SEC Rate Limiting

**Problem:** Getting 429 errors from SEC

**Symptoms:**
```
Error: HTTP 429 Too Many Requests
```

**Solutions:**

**1. Reduce rate:**
```bash
# In .env
RATE_LIMIT_PER_SECOND=5  # Lower from 10
```

**2. Implement backoff:**
```typescript
export async function fetchWithBackoff(url: string, retries = 3) {
  try {
    return await fetch(url);
  } catch (error) {
    if (error.status === 429 && retries > 0) {
      const delay = Math.pow(2, 4 - retries) * 1000;  // 2s, 4s, 8s
      await sleep(delay);
      return fetchWithBackoff(url, retries - 1);
    }
    throw error;
  }
}
```

**3. Verify User-Agent:**
```bash
# Must be in format: "Name email@domain.com"
SEC_USER_AGENT=YourCompany contact@yourcompany.com
```

---

### Database Connection Pool Exhausted

**Problem:** "too many clients" error

**Symptoms:**
```
Error: sorry, too many clients already
```

**Solutions:**

**1. Use connection pooling:**
```bash
# Supabase pooler
DATABASE_URL=postgresql://...@pooler.supabase.com:5432/postgres
```

**2. Close connections:**
```typescript
// Don't create new client per request
// Use singleton

let supabase: SupabaseClient;

export function getClient() {
  if (!supabase) {
    supabase = createClient(URL, KEY);
  }
  return supabase;
}
```

**3. Increase pool size:**
```sql
-- In PostgreSQL config
max_connections = 200;  -- Increase from default 100
```

---

## Getting Help

### Diagnostic Information to Collect

When reporting issues, include:

**1. Environment:**
```bash
# Node version
node --version

# OS
uname -a  # Linux/macOS
systeminfo  # Windows

# Docker version
docker --version
```

**2. Logs:**
```bash
# Worker logs
tail -100 worker.log

# Temporal logs
temporal workflow show --workflow-id <id>

# Database logs
supabase logs
```

**3. Configuration:**
```bash
# Environment variables (redact secrets)
cat .env | sed 's/=.*/=***/'

# Temporal config
cat temporal.config.ts

# Supabase config
cat supabase/config.toml
```

**4. Error Messages:**
- Full stack trace
- Workflow ID
- Timestamp
- Steps to reproduce

### Support Channels

- **GitHub Issues**: https://github.com/yourusername/institutional-rotation-detector/issues
- **Temporal Community**: https://temporal.io/slack
- **Supabase Discord**: https://discord.supabase.com

---

## Related Documentation

- [Local Development](LOCAL_DEVELOPMENT.md) - Setup guide
- [Deployment](DEPLOYMENT.md) - Production deployment
- [Architecture](ARCHITECTURE.md) - System design
- [Workflows](WORKFLOWS.md) - Workflow reference

---

For questions or issues, see [main README](../README.md#support).
