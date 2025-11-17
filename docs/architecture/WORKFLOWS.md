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

### Core Ingestion & Analysis Workflows

| Workflow | Purpose | Duration | Complexity | Type |
|----------|---------|----------|------------|------|
| `ingestIssuerWorkflow` | Multi-quarter ingestion | 1-4 hours | High | Parent |
| `ingestQuarterWorkflow` | Single quarter processing | 10-30 min | Medium | Child |
| `rotationDetectWorkflow` | Rotation detection & scoring | 5-10 min | High | Child |
| `eventStudyWorkflow` | Market impact analysis | 2-5 min | Low | Child |

### Graph Workflows

| Workflow | Purpose | Duration | Complexity | Type |
|----------|---------|----------|------------|------|
| `graphBuildWorkflow` | Knowledge graph construction | 5-15 min | Medium | Standalone |
| `graphSummarizeWorkflow` | Community detection & summaries | 5-10 min | Medium | Standalone |
| `graphQueryWorkflow` | Graph traversal & queries | 1-3 min | Medium | Standalone |
| `graphExploreWorkflow` | Multi-turn Q&A with CoT | 3-5 min | Medium | Standalone |
| `crossCommunityAnalysisWorkflow` | Systemic pattern analysis | 5-10 min | High | Standalone |
| `clusterEnrichmentWorkflow` | Rotation cluster narrative | 2-5 min | Low | Child |

### Scheduled Data Watchers (Cron Workflows)

| Workflow | Purpose | Schedule | Complexity | Type |
|----------|---------|----------|------------|------|
| `edgarSubmissionsPollerWorkflow` | Near-real-time SEC filings | Per CIK | Medium | Cron |
| `nportMonthlyTimerWorkflow` | N-PORT monthly ingestion | Monthly (M+60) | Low | Cron |
| `etfDailyCronWorkflow` | Daily ETF holdings | Daily EOD | Low | Cron |
| `finraShortPublishWorkflow` | FINRA short interest | Semi-monthly | Low | Cron |
| `form4DailyCronWorkflow` | Form 4 insider transactions | Daily | Low | Cron |
| `unusualOptionsActivityCronWorkflow` | Unusual options activity | Daily EOD | Low | Cron |

### Microstructure Workflows

| Workflow | Purpose | Duration | Complexity | Type |
|----------|---------|----------|------------|------|
| `finraOtcWeeklyIngestWorkflow` | FINRA OTC transparency data | 5-10 min | Medium | Standalone |
| `iexDailyIngestWorkflow` | IEX exchange volume proxy | 2-5 min | Low | Standalone |
| `offexRatioComputeWorkflow` | Off-exchange ratio calculation | 3-5 min | Medium | Standalone |
| `flip50DetectWorkflow` | Detect off-exchange <50% flips | 2-3 min | Low | Standalone |
| `shortInterestIngestWorkflow` | FINRA short interest ingestion | 2-5 min | Low | Standalone |
| `microstructureAnalysisWorkflow` | VPIN, Kyle's lambda, attribution | 5-10 min | High | Standalone |

### Options Flow Workflows

| Workflow | Purpose | Duration | Complexity | Type |
|----------|---------|----------|------------|------|
| `optionsIngestWorkflow` | Full daily options ingestion | 5-10 min | Medium | Standalone |
| `optionsMinimalIngestWorkflow` | Minimal 3-endpoint ingestion | 2-3 min | Low | Standalone |
| `optionsBatchIngestWorkflow` | Batch process multiple tickers | 10-30 min | Medium | Parent |
| `optionsDeepAnalysisWorkflow` | Deep analysis with full Greeks | 10-20 min | High | Standalone |

### Advanced Analytics Workflows

| Workflow | Purpose | Duration | Complexity | Type |
|----------|---------|----------|------------|------|
| `statisticalAnalysisWorkflow` | E2B-powered statistical analysis | 5-10 min | High | Standalone |

### Testing & Utilities

| Workflow | Purpose | Duration | Complexity | Type |
|----------|---------|----------|------------|------|
| `testSearchAttributesWorkflow` | Search attribute testing | <1 min | Low | Test only |

**Total Workflows: 29**

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
    "from": "2024-01-01",
    "to": "2024-12-31",
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
2. **Parse 13F** - Extract institutional positions (auto-creates fund manager entities as needed)
3. **Parse 13G/13D** - Extract beneficial ownership
4. **Fetch N-PORT** - Monthly fund holdings
5. **Fetch ETF Holdings** - Daily ETF positions
6. **Fetch Short Interest** - FINRA short data
7. **Fetch ATS Data** - Alternative trading system volumes
8. **Launch Child** - `rotationDetectWorkflow`

**Note:** The workflow automatically creates missing fund manager entities when parsing 13F filings. No manual seeding is required, though pre-seeding with `pnpm run seed:managers` is recommended for faster first runs.

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

### `graphExploreWorkflow`

**Purpose:** Interactive multi-turn Q&A about the institutional investor graph with Chain of Thought context preservation.

**Approach:** **Graph algorithms + CoT sessions** (saves 60%+ tokens across turns).

**Input:**
```typescript
interface GraphExploreWorkflowInput {
  ticker?: string;
  cik?: string;
  periodStart: string;
  periodEnd: string;
  questions: string[];
  runKind?: 'query' | 'analysis';
}
```

**Workflow Logic:**
1. Accept multiple questions in sequence
2. Use CoT sessions to preserve context across questions
3. Each question builds on previous answers
4. Significant token savings (60%+) vs. independent queries

**Example Use Cases:**
- "Which institutions rotated out of AAPL in Q1 2024?"
- "Did those same institutions rotate into other tech stocks?"
- "What was the total dollar value of these flows?"

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type graphExploreWorkflow \
  --input '{
    "ticker": "AAPL",
    "periodStart": "2024-01-01",
    "periodEnd": "2024-03-31",
    "questions": [
      "Which institutions rotated out?",
      "Where did they rotate to?",
      "What was the total flow?"
    ]
  }'
```

**Activities Called:**
- `exploreGraph` - Multi-turn graph exploration with CoT

**Duration:** 3-5 minutes

---

### `crossCommunityAnalysisWorkflow`

**Purpose:** Identifies systemic patterns and trends across multiple communities using GPT-5 with high reasoning effort.

**Input:**
```typescript
interface CrossCommunityAnalysisWorkflowInput {
  periodStart: string;
  periodEnd: string;
  minCommunities?: number;
  runKind?: 'analysis' | 'research';
}
```

**Workflow Logic:**
1. Fetch all communities in the specified period
2. GPT-5 synthesizes cross-community patterns (high reasoning effort)
3. Identifies systemic trends
4. Compares communities
5. Extracts key insights

**Example Use Cases:**
- "Are there coordinated rotations across tech sector communities?"
- "What systemic patterns emerged during Q1 2024?"
- "Are communities showing correlated buying/selling patterns?"

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type crossCommunityAnalysisWorkflow \
  --input '{
    "periodStart": "2024-01-01",
    "periodEnd": "2024-03-31",
    "minCommunities": 3
  }'
```

**Activities Called:**
- `analyzeCrossCommunityPatterns` - GPT-5 synthesis with high reasoning effort

**Duration:** 5-10 minutes

---

### `clusterEnrichmentWorkflow`

**Purpose:** Enriches a rotation cluster with narrative explanation using graph structure + long context synthesis.

**Input:**
```typescript
interface ClusterEnrichmentInput {
  clusterId: string;
  issuerCik: string;
  runKind: 'backfill' | 'daily';
}
```

**Workflow Logic:**
1. Fetch cluster details (sellers, buyers, flows)
2. Generate narrative summary using LLM
3. No vector embeddings (direct long context)

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type clusterEnrichmentWorkflow \
  --input '{
    "clusterId": "cluster-uuid-123",
    "issuerCik": "0000320193",
    "runKind": "daily"
  }'
```

**Activities Called:**
- `createClusterSummary` - LLM-powered narrative generation

**Output:**
```typescript
interface ClusterEnrichmentOutput {
  summary: string;
}
```

**Duration:** 2-5 minutes

---

## Microstructure Workflows

### `finraOtcWeeklyIngestWorkflow`

**Purpose:** Ingests FINRA OTC Transparency weekly data (ATS + non-ATS venue-level volumes).

**Input:**
```typescript
interface FinraOtcWeeklyIngestInput {
  symbols?: string[];
  fromWeek?: string; // YYYY-MM-DD (week end date)
  toWeek?: string;   // YYYY-MM-DD (week end date)
  runKind?: 'backfill' | 'daily';
}
```

**Workflow Logic:**
1. For each week in range:
   - Fetch ATS venue-level data
   - Fetch non-ATS venue-level data
   - Aggregate to symbol-level weekly totals
2. Store with provenance (file IDs, SHA-256 hashes)

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type finraOtcWeeklyIngestWorkflow \
  --input '{
    "symbols": ["AAPL", "MSFT"],
    "fromWeek": "2024-01-05",
    "toWeek": "2024-01-26",
    "runKind": "backfill"
  }'
```

**Activities Called:**
- `fetchOtcWeeklyVenue` - Download ATS/non-ATS data
- `aggregateOtcSymbolWeek` - Symbol-level aggregation

**Duration:** 5-10 minutes

---

### `iexDailyIngestWorkflow`

**Purpose:** Ingests IEX HIST daily matched volume data (T+1 availability, free on-exchange proxy).

**Input:**
```typescript
interface IexDailyIngestInput {
  symbols?: string[];
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  runKind?: 'backfill' | 'daily';
}
```

**Workflow Logic:**
1. For each trading day in range:
   - Download IEX HIST matched volume
   - Store with provenance (file ID, SHA-256)
2. Used as on-exchange volume proxy for off-exchange ratio calculations

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type iexDailyIngestWorkflow \
  --input '{
    "from": "2024-01-01",
    "to": "2024-01-31",
    "runKind": "daily"
  }'
```

**Activities Called:**
- `downloadIexDaily` - Download and parse IEX HIST data
- `listIexHistDates` - Generate date range

**Duration:** 2-5 minutes

---

### `offexRatioComputeWorkflow`

**Purpose:** Computes off-exchange percentage ratios from FINRA OTC weekly data and daily volume sources.

**Input:**
```typescript
interface OffexRatioComputeInput {
  symbols: string[];
  from?: string; // week end date
  to?: string;   // week end date
}
```

**Workflow Logic:**
1. For each symbol and week:
   - Compute weekly official ratio (if consolidated data available)
   - Compute daily approximations (apportioned from weekly total)
2. Quality flags: 'official', 'official_partial', 'approx', 'iex_proxy'

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type offexRatioComputeWorkflow \
  --input '{
    "symbols": ["AAPL", "MSFT"],
    "from": "2024-01-05",
    "to": "2024-01-26"
  }'
```

**Activities Called:**
- `computeWeeklyOfficial` - Weekly ratio calculation
- `computeDailyApprox` - Daily approximation

**Duration:** 3-5 minutes

---

### `flip50DetectWorkflow`

**Purpose:** Detects "Flip50" events where off-exchange percentage crosses below 50% after being above 50% for N consecutive days.

**Input:**
```typescript
interface Flip50DetectInput {
  symbol: string;
  lookbackDays?: number;         // default 90
  consecutiveDaysThreshold?: number; // default 20
  triggerEventStudy?: boolean;   // default true
}
```

**Event Definition:**
- First day: offex_pct < 0.50
- Preceded by: ≥N consecutive trading days with offex_pct ≥ 0.50

**Workflow Logic:**
1. Detect Flip50 events in lookback window
2. Store event with pre-period statistics
3. Optionally trigger event study for CAR analysis

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type flip50DetectWorkflow \
  --input '{
    "symbol": "AAPL",
    "lookbackDays": 90,
    "consecutiveDaysThreshold": 20
  }'
```

**Activities Called:**
- `detectFlip50` - Event detection algorithm

**Duration:** 2-3 minutes

---

### `shortInterestIngestWorkflow`

**Purpose:** Ingests FINRA short interest data (semi-monthly settlement dates: 15th and month-end).

**Input:**
```typescript
interface ShortInterestIngestInput {
  symbols?: string[];
  fromDate?: string;
  toDate?: string;
  runKind?: 'backfill' | 'daily';
}
```

**Workflow Logic:**
1. Fetch FINRA short interest for settlement dates
2. Publication timing: T+2 business days after settlement
3. Store with provenance

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type shortInterestIngestWorkflow \
  --input '{
    "symbols": ["AAPL"],
    "fromDate": "2024-01-01",
    "toDate": "2024-01-31",
    "runKind": "daily"
  }'
```

**Duration:** 2-5 minutes

---

### `microstructureAnalysisWorkflow`

**Purpose:** Comprehensive microstructure analysis including VPIN (toxicity), Kyle's lambda (price impact), broker attribution, and institutional flow detection.

**Input:**
```typescript
interface MicrostructureAnalysisWorkflowInput {
  symbol: string;
  fromDate: string;
  toDate: string;
  buildMapping?: boolean;    // Build broker-dealer mappings
  minConfidence?: number;    // Min attribution confidence (default 0.7)
}
```

**Workflow Logic:**
1. Optionally build broker-dealer → institution mappings
2. Compute daily microstructure metrics:
   - **VPIN** (toxicity) - probability of informed trading
   - **Kyle's lambda** - price impact per unit volume
   - **Order imbalance** - buy/sell pressure
   - **Block trades** - institutional footprint
3. Attribute flows to specific institutions
4. Generate microstructure signals for rotation scoring

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type microstructureAnalysisWorkflow \
  --input '{
    "symbol": "AAPL",
    "fromDate": "2024-01-01",
    "toDate": "2024-01-31",
    "buildMapping": false,
    "minConfidence": 0.7
  }'
```

**Activities Called:**
- `buildBrokerMapping` - Map ATS venues to institutions
- `getMicrostructureSignals` - Compute VPIN, lambda, etc.
- `attributeInstitutionalFlows` - Flow attribution

**Output:**
```typescript
interface MicrostructureSignals {
  vpinAvg: number;              // Average toxicity level
  vpinSpike: boolean;           // Extreme event detected
  lambdaAvg: number;            // Price impact (bps/$1M)
  orderImbalanceAvg: number;    // Sell pressure
  blockRatioAvg: number;        // % institutional blocks
  flowAttributionScore: number;
  microConfidence: number;
}
```

**Duration:** 5-10 minutes

---

## Options Flow Workflows

### `optionsIngestWorkflow`

**Purpose:** Full daily options data ingestion using UnusualWhales API (Tier 1 + Tier 2 endpoints).

**Input:**
```typescript
interface OptionsIngestParams {
  ticker: string;
  date?: string;
  includeContracts?: boolean;    // Volume + OI + IV (Tier 1)
  includeFlow?: boolean;          // Aggregated flow (Tier 1)
  includeAlerts?: boolean;        // Unusual activity (Tier 1)
  includeGEX?: boolean;           // Greek exposure trends (Tier 2)
  includeGEXByExpiry?: boolean;  // GEX by expiration (Tier 3)
  includeGreeks?: boolean;        // Full greeks per expiration (Tier 2, expensive!)
  includeBaselines?: boolean;     // Historical baselines
  calculateMetrics?: boolean;     // Calculate all documented metrics
}
```

**Workflow Logic:**
1. **Tier 1 (MUST HAVE)**: 3 API calls
   - Fetch option contracts (volume + OI + IV)
   - Fetch aggregated flow by expiration
   - Fetch unusual activity alerts
2. **Tier 2 (OPTIONAL)**: Enhanced data
   - Greek exposure trends
   - Full Greeks per expiration (expensive!)
3. **Computation**:
   - Compute daily summary
   - Calculate P/C ratios, IV skew, Vol/OI ratios
   - Optionally compute baselines

**Meets All 4 Original Requirements:**
- ✅ Daily options volume (by strike/expiry)
- ✅ Open Interest (by strike/expiry)
- ✅ Put/Call ratio (volume AND OI)
- ✅ Unusual activity (Volume/OI ratio >3x)

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type optionsIngestWorkflow \
  --input '{
    "ticker": "AAPL",
    "includeContracts": true,
    "includeFlow": true,
    "includeAlerts": true,
    "includeGEX": false,
    "calculateMetrics": true
  }'
```

**Activities Called:**
- `fetchOptionContracts` - Volume + OI + IV
- `fetchOptionsFlowByExpiry` - Aggregated flow
- `fetchFlowAlerts` - Unusual activity
- `fetchGreekExposure` - GEX trends (optional)
- `computeOptionsSummary` - Daily summary

**API Calls:** 3 (Tier 1) to 7+ (with Tier 2/3)

**Duration:** 5-10 minutes

---

### `optionsMinimalIngestWorkflow`

**Purpose:** Minimal daily options ingestion using only 3 API calls (meets all requirements).

**Input:**
```typescript
interface OptionsMinimalIngestParams {
  ticker: string;
  date?: string;
}
```

**Workflow Logic:**
- Uses only Tier 1 endpoints (3 API calls total)
- Optimized for cost and speed
- Meets all 4 original requirements

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type optionsMinimalIngestWorkflow \
  --input '{"ticker": "AAPL"}'
```

**API Calls:** Exactly 3

**Duration:** 2-3 minutes

---

### `optionsBatchIngestWorkflow`

**Purpose:** Batch process options ingestion for multiple tickers.

**Input:**
```typescript
interface OptionsBatchIngestParams {
  tickers: string[];
  date?: string;
  includeContracts?: boolean;
  includeFlow?: boolean;
  includeAlerts?: boolean;
}
```

**Workflow Logic:**
1. Launch child `optionsIngestWorkflow` for each ticker
2. Process in parallel (respects rate limits)
3. Aggregate results

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type optionsBatchIngestWorkflow \
  --input '{
    "tickers": ["AAPL", "MSFT", "GOOGL"],
    "includeContracts": true,
    "includeFlow": true,
    "includeAlerts": true
  }'
```

**Duration:** 10-30 minutes (depends on ticker count)

---

### `optionsDeepAnalysisWorkflow`

**Purpose:** Deep options analysis with full Greeks per expiration (expensive, comprehensive).

**Input:**
```typescript
interface OptionsDeepAnalysisParams {
  ticker: string;
  date?: string;
  maxExpirations?: number; // Limit to N nearest expirations
}
```

**Workflow Logic:**
1. Fetch all Tier 1 + Tier 2 data
2. Fetch full Greeks for each expiration (expensive!)
3. Compute advanced metrics (GEX trends, gamma flips, IV surface)

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type optionsDeepAnalysisWorkflow \
  --input '{
    "ticker": "AAPL",
    "maxExpirations": 3
  }'
```

**API Calls:** 7+ (expensive)

**Duration:** 10-20 minutes

---

## Scheduled Data Watchers

### `form4DailyCronWorkflow`

**Purpose:** Daily scheduled ingestion of Form 4 insider transactions (2-day reporting lag).

**Input:**
```typescript
interface Form4DailyCronInput {
  lookbackDays?: number; // Default 3
}
```

**Schedule:** Daily at market close

**Workflow Logic:**
1. Fetch Form 4 filings from last N days
2. Parse insider transactions (buys/sells)
3. Store in database for rotation validation

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type form4DailyCronWorkflow \
  --input '{"lookbackDays": 3}'
```

**Duration:** <5 minutes

---

### `unusualOptionsActivityCronWorkflow`

**Purpose:** Daily scheduled detection of unusual options activity.

**Input:**
```typescript
interface UnusualOptionsActivityCronInput {
  tickers?: string[]; // Default: all tracked tickers
  minPremium?: number; // Default $50k
}
```

**Schedule:** Daily EOD

**Workflow Logic:**
1. Fetch flow alerts from UnusualWhales
2. Filter by minimum premium
3. Store unusual activity events

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type unusualOptionsActivityCronWorkflow \
  --input '{"minPremium": 100000}'
```

**Duration:** <5 minutes

---

## Advanced Analytics Workflows

### `statisticalAnalysisWorkflow`

**Purpose:** E2B-powered statistical analysis on rotation data using GPT-5 + Python code execution.

**Input:**
```typescript
interface StatisticalAnalysisWorkflowInput {
  analysisType: 'correlation' | 'regression' | 'anomaly' | 'custom';
  dataQuery: {
    table: 'rotation_events' | 'rotation_edges' | 'graph_edges';
    filters?: Record<string, any>;
    periodStart?: string;
    periodEnd?: string;
    limit?: number;
  };
  question: string;
  customCode?: string;
  runKind?: 'analysis' | 'research';
}
```

**Workflow Logic:**
1. Fetch data from database
2. GPT-5 plans statistical approach (CoT)
3. Generates Python code
4. Executes code in E2B sandbox
5. Analyzes results (CoT preserved)
6. Draws conclusions (CoT preserved)

**Example Use Cases:**
1. **Correlation Analysis**: "Is there correlation between dump Z-score and cumulative abnormal returns?"
2. **Anomaly Detection**: "Find outliers in rotation events using isolation forest"
3. **Regression Analysis**: "Does uptake predict CAR? Run linear regression with significance tests"
4. **Custom Analysis**: Provide your own Python code for complex statistical tests

**Example:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type statisticalAnalysisWorkflow \
  --input '{
    "analysisType": "regression",
    "dataQuery": {
      "table": "rotation_events",
      "periodStart": "2024-01-01",
      "periodEnd": "2024-03-31"
    },
    "question": "Does uptake same quarter predict CAR? Run linear regression."
  }'
```

**Activities Called:**
- `performStatisticalAnalysis` - GPT-5 + E2B code execution

**Output:**
```typescript
interface StatisticalAnalysisResult {
  analysis: string;      // GPT-5 analysis with CoT
  code: string;          // Generated Python code
  results: any;          // Execution results
  plots?: string[];      // Base64-encoded plots
}
```

**Duration:** 5-10 minutes

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
  --input '{"ticker":"AAPL","from":"2024-01-01","to":"2024-12-31","runKind":"daily","minPct":5}'

# Execute and wait for result
temporal workflow execute \
  --namespace ird \
  --task-queue rotation-detector \
  --type graphQueryWorkflow \
  --input '{"ticker":"AAPL","from":"2024-01-01","to":"2024-03-31","hops":2}'

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
      from: '2024-01-01',
      to: '2024-12-31',
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
curl -X POST "http://localhost:3000/api/run?ticker=AAPL&from=2024-01-01&to=2024-12-31&runKind=daily"
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

### 🔥 CRITICAL: Always Return Meaningful Workflow Results

**Every workflow MUST return a structured result** that provides visibility in the Temporal UI for debugging and monitoring.

#### The Standard Pattern

All workflows should return a result type that extends `WorkflowExecutionSummary`:

```typescript
interface WorkflowExecutionSummary {
  status: 'success' | 'partial_success' | 'failed';
  message: string;
  metrics: {
    processed: number;
    succeeded: number;
    failed: number;
    skipped: number;
  };
  timing?: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
  entity: {
    ticker?: string;
    cik?: string;
    cusips?: string[];
  };
  warnings?: string[];
  errors?: string[];
}
```

#### Required Implementation Steps

1. **Track timing** - Capture `startTime` and calculate `durationMs`
2. **Collect warnings** - Non-fatal issues that don't stop execution
3. **Collect errors** - Failures that should be visible
4. **Set status correctly**:
   - `'success'` - No warnings or errors
   - `'partial_success'` - Has warnings but completed
   - `'failed'` - Critical failure (caught in try/catch)
5. **Use descriptive messages** - Clear, concise summary of what happened
6. **Return results even on failure** - Use try/catch to return structured failure results

#### Example Implementation

```typescript
export async function myWorkflow(input: MyInput): Promise<MyResult> {
  const startTime = Date.now();
  const startedAt = new Date().toISOString();
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    // Set search attributes
    await upsertWorkflowSearchAttributes({
      ticker: input.ticker,
      cik: input.cik,
    });

    // Do work...
    const result = await activities.doSomething(input);

    // Collect warnings
    if (result.missingData) {
      warnings.push(`Missing data: ${result.missingData}`);
    }

    // Return comprehensive result
    return {
      status: warnings.length > 0 ? 'partial_success' : 'success',
      message: `Processed ${input.ticker} successfully`,
      metrics: {
        processed: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
      },
      timing: {
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      },
      entity: {
        ticker: input.ticker,
        cik: input.cik,
      },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    // Even failures return structured results
    return {
      status: 'failed',
      message: `Failed to process ${input.ticker}: ${error.message}`,
      metrics: { processed: 1, succeeded: 0, failed: 1, skipped: 0 },
      timing: {
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      },
      entity: { ticker: input.ticker, cik: input.cik },
      errors: [error.message],
    };
  }
}
```

#### Anti-Patterns to Avoid

❌ **NEVER return void** - Provides zero visibility in Temporal UI
❌ **NEVER return simple values** (boolean, number) - No context or debugging info
❌ **NEVER throw without catching** - Temporal shows exception but no structured result
❌ **NEVER omit warnings** - Silent partial failures are impossible to debug
❌ **NEVER use vague messages** - "Done" or "OK" provides no useful information

#### Why This Matters

Without meaningful workflow results:
- ❌ Debugging is nearly impossible
- ❌ No visibility into what was processed
- ❌ Warnings and partial failures are hidden
- ❌ Performance analysis is impossible
- ❌ Audit trails are incomplete

With meaningful workflow results:
- ✅ Instant status visibility in Temporal UI
- ✅ Clear error and warning messages
- ✅ Performance metrics for optimization
- ✅ Complete audit trail
- ✅ Easy troubleshooting and debugging

**See the full guide:** `docs/internal/CODING_AGENT_GUIDELINES.md` (search for "Meaningful Workflow Results")

---

## Related Documentation

- [Architecture](ARCHITECTURE.md) - System design
- [API Reference](API.md) - REST endpoints
- [Setup Guide](SETUP.md) - Installation
- [Development](DEVELOPMENT.md) - Contributing guide

---

For questions or issues, see [main README](../README.md#support).
