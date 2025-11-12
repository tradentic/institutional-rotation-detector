# Workflow Reference

Complete reference for all Temporal workflows in the Institutional Rotation Detector.

## Table of Contents

- [Overview](#overview)
- [Workflow Catalog](#workflow-catalog)
- [Ingestion Workflows](#ingestion-workflows)
- [Analysis Workflows](#analysis-workflows)
- [Graph Workflows](#graph-workflows)
- [Search Attributes](#search-attributes)
- [Running Workflows](#running-workflows)
- [Monitoring & Debugging](#monitoring--debugging)

## Overview

Workflows are durable, fault-tolerant orchestrations that coordinate activities. They handle:

- **Long-running processes** (hours/days)
- **Retries** on transient failures
- **State persistence** across restarts
- **Child workflow management**
- **Continue-as-new** for infinite loops

### Workflow Guarantees

✅ **Deterministic** - Same inputs produce same outputs
✅ **Resumable** - Survive crashes and restarts
✅ **Observable** - Full execution history in Temporal UI
✅ **Versioned** - Safe code updates without breaking running workflows

### Workflow Constraints

⛔ **No non-deterministic operations** (random, Date.now(), etc.)
⛔ **No direct I/O** (use activities instead)
⛔ **No unbounded iterations** (use continue-as-new)
⛔ **No side effects** in workflow code

## Workflow Catalog

| Workflow | Purpose | Duration | Complexity | Parent/Child |
|----------|---------|----------|------------|--------------|
| `ingestIssuerWorkflow` | Multi-quarter ingestion | 1-4 hours | High | Parent |
| `ingestQuarterWorkflow` | Single quarter processing | 10-30 min | Medium | Child |
| `rotationDetectWorkflow` | Rotation detection & scoring | 5-10 min | High | Child |
| `eventStudyWorkflow` | Market impact analysis | 2-5 min | Low | Child |
| `graphBuildWorkflow` | Knowledge graph construction | 5-15 min | Medium | Standalone |
| `graphSummarizeWorkflow` | Community detection | 5-10 min | Medium | Standalone |
| `graphQueryWorkflow` | Graph traversal & queries | 1-3 min | Medium | Standalone |
| `testProbeWorkflow` | Search attribute testing | <1 min | Low | Test only |

## Ingestion Workflows

### `ingestIssuerWorkflow`

**Purpose:** Orchestrates ingestion of all quarters for a ticker.

**Input:**
```typescript
interface IngestIssuerInput {
  ticker: string;          // Stock ticker (e.g., "AAPL")
  minPct: number;          // Minimum dump % to detect (e.g., 5)
  from: string;            // Start date (YYYY-MM-DD or YYYYQN)
  to: string;              // End date (YYYY-MM-DD or YYYYQN)
  runKind: 'backfill' | 'daily';
  quarters?: string[];     // Optional: pre-calculated quarters
  quarterBatch?: number;   // Quarters per batch (default: 8)
}
```

**Workflow Logic:**
1. Resolve ticker to CIK via `resolveCIK` activity
2. Split date range into quarters (e.g., 2024Q1, 2024Q2, ...)
3. Process quarters in batches (default: 8 at a time)
4. Launch child `ingestQuarterWorkflow` for each quarter
5. Use **continue-as-new** if more quarters remain

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type ingestIssuerWorkflow \
  --input '{
    "ticker": "AAPL",
    "minPct": 5,
    "from": "2024Q1",
    "to": "2024Q4",
    "runKind": "daily",
    "quarterBatch": 8
  }'
```

**Search Attributes:**
- `ticker` - Stock ticker
- `cik` - SEC CIK
- `runKind` - "backfill" or "daily"
- `quarterStart` - First quarter start date
- `quarterEnd` - First quarter end date

**Continue-As-New Pattern:**
```typescript
if (remaining.length > 0) {
  await continueAsNew<typeof ingestIssuerWorkflow>({
    ...input,
    quarters: remaining,
  });
}
```

**Duration:** 1-4 hours (depends on number of quarters)

---

### `ingestQuarterWorkflow`

**Purpose:** Processes a single quarter: fetch filings, extract positions, detect rotations.

**Input:**
```typescript
interface IngestQuarterInput {
  cik: string;              // Issuer CIK
  cusips: string[];         // Security CUSIPs
  quarter: string;          // Quarter (e.g., "2024Q1")
  ticker: string;           // Stock ticker
  runKind: 'backfill' | 'daily';
  quarterStart: string;     // Quarter start date (YYYY-MM-DD)
  quarterEnd: string;       // Quarter end date (YYYY-MM-DD)
  etfUniverse?: string[];   // ETFs to track (default: IWB, IWM, IWN, IWC)
}
```

**Workflow Logic:**
1. **Fetch Filings** - Download 13F-HR, 13G/D, 10-K/Q, 8-K
2. **Parse 13F** - Extract institutional positions
3. **Parse 13G/13D** - Extract beneficial ownership
4. **Fetch N-PORT** - Monthly fund holdings
5. **Fetch ETF Holdings** - Daily ETF positions
6. **Fetch Short Interest** - FINRA short data
7. **Fetch ATS Data** - Alternative trading system volumes
8. **Launch Child** - `rotationDetectWorkflow`

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type ingestQuarterWorkflow \
  --input '{
    "cik": "0000320193",
    "cusips": ["037833100"],
    "quarter": "2024Q1",
    "ticker": "AAPL",
    "runKind": "daily",
    "quarterStart": "2024-01-01",
    "quarterEnd": "2024-03-31",
    "etfUniverse": ["IWB", "IWM", "IWN", "IWC"]
  }'
```

**Activities Called:**
- `fetchFilings` - Download SEC filings
- `parse13FInfoTables` - Extract 13F positions
- `parse13G13D` - Extract beneficial ownership
- `fetchMonthly` - N-PORT data
- `fetchDailyHoldings` - ETF holdings
- `fetchShortInterest` - FINRA short data
- `fetchATSWeekly` - ATS volume data

**Duration:** 10-30 minutes

---

## Analysis Workflows

### `rotationDetectWorkflow`

**Purpose:** Detects institutional rotation events and scores them using multiple signals.

**Input:**
```typescript
interface RotationDetectInput {
  cik: string;              // Issuer CIK
  cusips: string[];         // Security CUSIPs
  quarter: string;          // Quarter (e.g., "2024Q1")
  ticker: string;           // Stock ticker
  runKind: 'backfill' | 'daily';
  quarterStart: string;     // Quarter start date
  quarterEnd: string;       // Quarter end date
}
```

**Workflow Logic:**
1. **Detect Dumps** - Identify large institutional sell-offs (>5% reduction)
2. **Calculate Uptake** - Measure buying by other institutions (same/next quarter)
3. **Compute UHF** - Ultra-high-frequency trading patterns
4. **Options Overlay** - Options activity (puts/calls)
5. **Short Interest Relief** - Change in short interest
6. **Score Event** - Combine signals into R-score
7. **Build Edges** - Create graph edges (seller → buyer flows)
8. **Launch Event Study** - Child workflow for CAR analysis

**Scoring Signals:**

| Signal | Weight | Description |
|--------|--------|-------------|
| `dumpZ` | 2.0 | Dump magnitude (z-score) |
| `uSame` | 1.0 | Uptake same quarter |
| `uNext` | 0.85 | Uptake next quarter |
| `uhfSame` | 0.7 | UHF same quarter |
| `uhfNext` | 0.6 | UHF next quarter |
| `optSame` | 0.5 | Options same quarter |
| `optNext` | 0.4 | Options next quarter |
| `shortRelief` | 0.4 | Short interest relief |

**Gating Logic:**
- Requires `dumpZ >= 1.5` AND
- At least one uptake/UHF signal > 0

**End-of-Window Multiplier:**
- If dump occurs in last 5 days of quarter: 1.2x multiplier on "next" signals

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type rotationDetectWorkflow \
  --input '{
    "cik": "0000320193",
    "cusips": ["037833100"],
    "quarter": "2024Q1",
    "ticker": "AAPL",
    "runKind": "daily",
    "quarterStart": "2024-01-01",
    "quarterEnd": "2024-03-31"
  }'
```

**Activities Called:**
- `detectDumpEvents` - Identify sell-offs
- `uptakeFromFilings` - Calculate uptake metrics
- `uhf` - Ultra-high-frequency analysis
- `optionsOverlay` - Options analysis
- `shortReliefV2` - Short interest change
- `scoreV4_1` - Compute final R-score
- `buildEdges` - Create graph edges

**Output:**
- Rotation event record in `rotation_events` table
- Graph edges in `rotation_edges` table

**Duration:** 5-10 minutes

---

### `eventStudyWorkflow`

**Purpose:** Calculates cumulative abnormal returns (CAR) around rotation events.

**Input:**
```typescript
interface EventStudyInput {
  anchorDate: string;       // Rotation event date
  cik: string;              // Issuer CIK
  ticker: string;           // Stock ticker
  runKind: 'backfill' | 'daily';
  quarterStart: string;     // Quarter start
  quarterEnd: string;       // Quarter end
}
```

**Workflow Logic:**
1. Call `eventStudy` activity with anchor date and CIK
2. Activity calculates:
   - CAR from -5 to +20 days
   - Time to +20 days
   - Maximum return in week 13
3. Updates `rotation_events` table with metrics

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type eventStudyWorkflow \
  --input '{
    "anchorDate": "2024-03-15",
    "cik": "0000320193",
    "ticker": "AAPL",
    "runKind": "daily",
    "quarterStart": "2024-01-01",
    "quarterEnd": "2024-03-31"
  }'
```

**Activities Called:**
- `eventStudy` - Calculate CAR metrics

**Output:**
- Updates `rotation_events` table:
  - `car_m5_p20` - Cumulative abnormal return
  - `t_to_plus20_days` - Days to +20
  - `max_ret_w13` - Max return week 13

**Duration:** 2-5 minutes

---

## Graph Workflows

### `graphBuildWorkflow`

**Purpose:** Constructs knowledge graph from rotation edges.

**Approach:** **Pure graph algorithms** - no LLM/AI required.

**Input:**
```typescript
interface GraphBuildInput {
  cik: string;                    // Root issuer CIK
  quarter: string;                // Quarter (e.g., "2024Q1")
  ticker?: string;                // Optional ticker
  runKind: 'backfill' | 'daily';
  cursor?: string;                // Resume cursor (for continue-as-new)
  maxEdgesBeforeContinue?: number; // Default: 5000
}
```

**Workflow Logic:**
1. Build graph nodes (entities, securities) - from `rotation_edges` table
2. Build graph edges (holds, bought, sold relationships) - from position deltas
3. Compute edge weights based on position sizes
4. If edges exceed threshold, use **continue-as-new**

**No AI/LLM Used:** This is pure data transformation and graph construction.

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type graphBuildWorkflow \
  --input '{
    "cik": "0000320193",
    "quarter": "2024Q1",
    "ticker": "AAPL",
    "runKind": "daily"
  }'
```

**Activities Called:**
- `buildGraphForQuarter` - Construct graph from edges

**Output:**
```typescript
interface GraphBuilderResult {
  edgesUpserted: number;
  processedAccessions: string[];
}
```

**Continue-As-New Pattern:**
```typescript
if (result.edgesUpserted >= threshold) {
  await continueAsNew({
    ...input,
    cursor: result.processedAccessions.join(',')
  });
}
```

**Duration:** 5-15 minutes

---

### `graphSummarizeWorkflow`

**Purpose:** Detects communities in graph and generates AI summaries.

**Approach:** **Graph algorithms + Short AI summaries** (hybrid).

**Input:**
```typescript
interface GraphSummarizeInput {
  cik: string;              // Root issuer CIK
  quarter: string;          // Quarter (e.g., "2024Q1")
  ticker?: string;          // Optional ticker
  runKind: 'backfill' | 'daily';
  rootNodeId?: string;      // Optional specific node
}
```

**Workflow Logic:**
1. **Compute Communities** - Run **Louvain algorithm** on graph (pure algorithm, no LLM)
2. **For each community:**
   - Extract top nodes by **PageRank** (pure algorithm)
   - Generate AI summary using GPT-5-mini (**short prompt**, not long context)
   - Store in `graph_communities` table

**Uses:**
- **Graph algorithms**: Louvain community detection, PageRank
- **Short AI summaries**: GPT-5-mini with ~500 token prompts (minimal reasoning effort, low verbosity)

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type graphSummarizeWorkflow \
  --input '{
    "cik": "0000320193",
    "quarter": "2024Q1",
    "ticker": "AAPL",
    "runKind": "daily"
  }'
```

**Activities Called:**
- `computeCommunities` - Louvain algorithm
- `summarizeCommunity` - GPT-5 summary generation (gpt-5-mini, minimal effort)

**Output:**
```typescript
interface GraphSummarizeResult {
  communityIds: string[];   // Community UUIDs
  summaries: string[];      // AI-generated summaries
}
```

**Duration:** 5-10 minutes (depends on graph size and GPT-5 API latency)

---

### `graphQueryWorkflow`

**Purpose:** Traverses graph to find k-hop neighborhoods and generate explanations.

**Approach:** **Both graph algorithms AND long context synthesis** (full GraphRAG).

**Input:**
```typescript
interface GraphQueryInput {
  ticker?: string;          // Optional ticker
  cik?: string;             // Optional CIK
  from: string;             // Period start (YYYY-MM-DD)
  to: string;               // Period end (YYYY-MM-DD)
  hops: number;             // Number of hops (1-3 typical)
  runKind?: 'backfill' | 'daily' | 'query';
  edgeIds?: string[];       // Optional specific edges
  question?: string;        // Optional question for AI
}
```

**Workflow Logic:**

**Part 1: Graph Algorithms** (activities from `graphrag.activities.ts`)
1. **Resolve Issuer** - Get node ID from ticker/CIK
2. **K-Hop Neighborhood** - Traverse graph k hops from root (pure algorithm)
3. **Extract Paths** - Find important paths in subgraph (pure algorithm)

**Part 2: Long Context Synthesis** (activities from `longcontext.activities.ts`)
4. **Bundle for Synthesis** - Combine graph edges + filing chunks (12K token budget)
5. **Generate Explanation** - GPT-5 with **200K context window** (if question provided)

**Uses:**
- **Graph algorithms**: K-hop traversal, path finding (fast, no API calls)
- **Long context synthesis**: GPT-5 with bundled edges + filing text (high reasoning effort)

**This is the only workflow that uses BOTH approaches together.**

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type graphQueryWorkflow \
  --input '{
    "ticker": "AAPL",
    "from": "2024-01-01",
    "to": "2024-03-31",
    "hops": 2,
    "question": "What institutional investors are rotating in/out?"
  }'
```

**Activities Called:**
- `resolveIssuerNode` - Ticker/CIK → node ID
- `kHopNeighborhood` - Graph traversal
- `bundleForSynthesis` - Prepare data
- `synthesizeWithOpenAI` - Generate explanation (GPT-5 with high reasoning effort)

**Output:**
```typescript
interface GraphQueryOutput {
  issuer: ResolveIssuerNodeResult;
  neighborhood: NeighborhoodResult;
  explanation?: SynthesizeResult;
}
```

**Duration:** 1-3 minutes

---

## Search Attributes

Search attributes enable querying workflows in Temporal UI and CLI.

### Required Attributes

These must be created before running workflows:

```bash
./tools/setup-temporal-attributes.sh
```

### Querying Workflows

**By ticker:**
```bash
temporal workflow list --namespace ird --query 'Ticker="AAPL"'
```

**By run kind:**
```bash
temporal workflow list --namespace ird --query 'RunKind="backfill"'
```

**By date range:**
```bash
temporal workflow list --namespace ird --query 'PeriodEnd >= "2024-01-01T00:00:00Z" AND PeriodEnd <= "2024-12-31T23:59:59Z"'
```

**Complex query:**
```bash
temporal workflow list --namespace ird --query 'Ticker="AAPL" AND RunKind="daily" AND WindowKey="2024Q1"'
```

---

## Running Workflows

### Via Temporal CLI

```bash
# Start workflow
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type ingestIssuerWorkflow \
  --workflow-id my-custom-id \
  --input '{"ticker":"BLK","from":"2024Q1","to":"2024Q4","runKind":"daily","minPct":5}'

# Execute and wait for result
temporal workflow execute \
  --namespace ird \
  --task-queue rotation-detector \
  --type graphQueryWorkflow \
  --input '{"ticker":"BLK","from":"2024-01-01","to":"2024-03-31","hops":2}'

# Describe workflow
temporal workflow describe --namespace ird --workflow-id my-custom-id

# Show execution history
temporal workflow show --namespace ird --workflow-id my-custom-id
```

### Via API

```typescript
import { createTemporalConnection } from './temporal.config.js';

const temporal = await createTemporalConnection({
  namespace: 'default',
  taskQueue: 'rotation-detector',
});

const handle = await temporal.connection
  .workflowClient()
  .start('ingestIssuerWorkflow', {
    args: [{
      ticker: 'AAPL',
      from: '2024Q1',
      to: '2024Q4',
      runKind: 'daily',
      minPct: 5,
    }],
    taskQueue: 'rotation-detector',
    workflowId: `ingestion-AAPL-${Date.now()}`,
  });

console.log(`Started: ${handle.id}`);
const result = await handle.result();
console.log('Result:', result);
```

### Via REST API

```bash
curl -X POST "http://localhost:3000/api/run?ticker=BLK&from=2024Q1&to=2024Q4&runKind=daily"
```

---

## Monitoring & Debugging

### Temporal UI

**Access:** http://localhost:8233 (local) or Temporal Cloud URL

**Features:**
- View workflow execution history
- See activity inputs/outputs
- Inspect errors and stack traces
- Query by search attributes
- Retry failed workflows

### Common Issues

**Workflow Failed:**
1. Check Temporal UI for error details
2. Look at activity that failed
3. Check activity logs for root cause
4. Retry if transient failure

**Workflow Stuck:**
1. Check if worker is running
2. Verify task queue name matches
3. Look for resource exhaustion (DB connections, memory)

**Continue-As-New Not Working:**
1. Ensure workflow terminates after calling `continueAsNew`
2. Check that new inputs are valid
3. Verify no infinite loops

### Debugging Tips

**Enable verbose logging:**
```typescript
import { DefaultLogger, Runtime } from '@temporalio/worker';

Runtime.install({
  logger: new DefaultLogger('DEBUG'),
});
```

**Replay workflows locally:**
```bash
temporal workflow replay \
  --namespace ird \
  --workflow-id my-workflow-id
```

**Test workflows:**
```typescript
import { TestWorkflowEnvironment } from '@temporalio/testing';

const testEnv = await TestWorkflowEnvironment.createLocal();
const { client } = testEnv;

const result = await client.workflow.execute(myWorkflow, {
  args: [{ /* test input */ }],
  taskQueue: 'test',
  workflowId: 'test-workflow',
});

expect(result).toEqual(/* expected output */);
await testEnv.teardown();
```

---

## Best Practices

1. **Use Search Attributes** - Always set ticker, cik, runKind for queryability
2. **Handle Continue-As-New** - Use for long iterations to avoid history bloat
3. **Idempotent Activities** - Activities should be safe to retry
4. **Workflow IDs** - Use meaningful, unique IDs (include timestamp or UUID)
5. **Timeouts** - Set appropriate timeouts for activities (default: 5 minutes)
6. **Error Handling** - Let Temporal retry transient errors, catch permanent ones
7. **Testing** - Use `@temporalio/testing` for unit tests
8. **Versioning** - Use workflow versioning for safe upgrades

---

## Related Documentation

- [Architecture](ARCHITECTURE.md) - System design
- [API Reference](API.md) - REST endpoints
- [Setup Guide](SETUP.md) - Installation
- [Development](DEVELOPMENT.md) - Contributing guide

---

For questions or issues, see [main README](../README.md#support).
