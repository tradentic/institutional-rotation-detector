# Coding Agent Guidelines

This document provides guidelines for AI coding assistants (Claude, GPT, etc.) working on this codebase.

---

## 🔥 CRITICAL: Entity Identification - CIK and series_id

**The most important schema concept:** Understanding how ETFs and funds are identified.

### Entity Identification Rules

**For regular stocks and managers:**
- Identified by **CIK only** (10-digit SEC identifier)
- Example: Apple Inc. = CIK `0000320193`
- `series_id` is **NULL**

**For ETFs and mutual funds:**
- Identified by **CIK + series_id** (composite identifier)
- **CIK** identifies the parent trust/company
- **series_id** identifies the specific fund series (format: `S000012345`)
- Example: Invesco QQQ Trust (CIK `0001067839`)
  - QQQ: series_id `S000006218`
  - QQQM: series_id `S000069622`

### Why This Matters

**❌ WRONG - Storing by CIK only:**
```sql
-- This loses per-ETF granularity!
create table short_interest (
  settle_date date,
  cik text,           -- ❌ Multiple ETFs with same CIK get aggregated
  short_shares bigint,
  primary key (settle_date, cik)
);
```

**✅ CORRECT - Storing by CUSIP (which maps to CIK + series_id):**
```sql
-- CUSIP uniquely identifies each ETF series
create table short_interest (
  settle_date date,
  cusip text,         -- ✅ Each ETF has unique CUSIP
  short_shares bigint,
  primary key (settle_date, cusip)
);

-- CUSIP mapping includes series_id
create table cusip_issuer_map (
  cusip text primary key,
  issuer_cik text not null,
  series_id text      -- ✅ NULL for stocks, populated for ETFs
);
```

### Critical Tables That Must Support series_id

**1. cusip_issuer_map:**
- **MUST** store `series_id` when mapping CUSIPs for ETFs
- Allows resolution: CUSIP → (CIK, series_id) → specific entity

**2. FINRA data (short_interest, ats_weekly):**
- FINRA reports by **CUSIP**, not CIK
- **MUST** store at CUSIP-level granularity
- Never aggregate multiple CUSIPs to single CIK

**3. Entity resolution functions:**
- When creating entities for ETFs, **MUST** include `series_id`
- When resolving CUSIPs, **MUST** propagate `series_id`

### Code Patterns

**✅ CORRECT - Creating ETF entity with series_id:**
```typescript
await upsertEntity(
  cik: '0001067839',
  preferredKind: 'etf',
  seriesId: 'S000006218'  // ✅ Critical for multi-series trusts
);
```

**✅ CORRECT - Storing CUSIP mapping with series_id:**
```typescript
await upsertCusipMapping(
  cik: '0001067839',
  providedCusips: ['46090E103'],
  seriesId: 'S000006218'  // ✅ Links CUSIP to specific ETF series
);
```

**✅ CORRECT - Storing FINRA data by CUSIP:**
```typescript
// Store per-CUSIP, not aggregated by CIK
await supabase.from('short_interest').upsert([
  { settle_date: '2024-01-15', cusip: '46090E103', short_shares: 1000000 },  // QQQ
  { settle_date: '2024-01-15', cusip: '46138J784', short_shares: 500000 }    // QQQM
]);
```

**❌ WRONG - Aggregating CUSIPs to CIK:**
```typescript
// ❌ This loses per-series granularity!
const totalShares = cusipData.reduce((sum, item) => sum + item.shares, 0);
await supabase.from('short_interest').upsert({
  settle_date: date,
  cik: cik,              // ❌ Can't distinguish QQQ vs QQQM
  short_shares: totalShares
});
```

### Testing Checklist

When working with entity-related code, verify:

- [ ] ETF entities include `series_id` parameter
- [ ] CUSIP mappings store `series_id` for ETFs
- [ ] FINRA data stored at CUSIP-level (not CIK-level)
- [ ] No aggregation of multiple CUSIPs to single CIK entry
- [ ] Entity unique constraint: `(cik, coalesce(series_id, ''), kind)`

### Real-World Examples

**QQQ Trust (CIK 0001067839):**
```typescript
// Two separate entities in same trust
entities: [
  { cik: '0001067839', series_id: 'S000006218', kind: 'etf', ticker: 'QQQ' },
  { cik: '0001067839', series_id: 'S000069622', kind: 'etf', ticker: 'QQQM' }
]

// Separate CUSIP mappings
cusip_issuer_map: [
  { cusip: '46090E103', issuer_cik: '0001067839', series_id: 'S000006218' },  // QQQ
  { cusip: '46138J784', issuer_cik: '0001067839', series_id: 'S000069622' }   // QQQM
]

// Separate short interest data
short_interest: [
  { settle_date: '2024-01-15', cusip: '46090E103', short_shares: 1000000 },  // QQQ
  { settle_date: '2024-01-15', cusip: '46138J784', short_shares: 500000 }    // QQQM
]
```

**Key Insight:** When a trust has multiple ETF series, they share a CIK but have:
- Different series_ids (S000xxxxxx)
- Different CUSIPs
- Different tickers
- Different trading activity and holdings
- Must be tracked separately in all data tables

---

## 🔥 CRITICAL: Self-Healing / Self-Populating Patterns

**The second most important concept:** Activities must be resilient and self-sufficient by automatically creating missing reference data.

### The Self-Healing Philosophy

**Problem:** Traditional systems require manual database seeding and fail when reference data is missing.

**Solution:** Activities automatically create missing entities, CUSIP mappings, and other reference data by querying authoritative sources (SEC, FINRA) on-demand.

### Core Principles

1. **Zero Manual Seeding** - No need to pre-populate reference tables
2. **On-Demand Creation** - Fetch and create data only when needed
3. **Graceful Degradation** - Warn but don't fail if auto-creation unsuccessful
4. **Idempotent Operations** - Safe to retry, upserts prevent duplicates
5. **Authoritative Sources** - Always pull from SEC/FINRA APIs, not third-party data

### When to Apply Self-Healing

✅ **ALWAYS apply when:**
- Querying `entities` table for issuer/manager/fund/ETF data
- Querying `cusip_issuer_map` for CUSIP lookups
- Processing workflows that depend on reference data
- Activities that receive CIK or ticker as input
- Graph operations that create nodes for entities
- Price analysis that needs entity metadata
- Any operation that could fail due to missing entity

❌ **DON'T apply when:**
- Processing transactional data (positions, prices, trades)
- Bulk operations on existing data
- Read-only queries with no side effects
- Performance-critical hot paths (use caching instead)

### Standard Implementation Pattern

**✅ CORRECT - Self-healing activity:**
```typescript
export async function someActivity(cik: string) {
  // 1. Self-healing: ensure entity exists
  try {
    const { upsertEntity } = await import('./entity-utils');
    await upsertEntity(cik, 'issuer');
  } catch (error) {
    console.warn(`[someActivity] Failed to ensure entity exists: ${error}`);
    // Continue anyway - entity may already exist
  }

  // 2. Self-healing: ensure CUSIP mappings exist
  try {
    const { upsertCusipMapping } = await import('./entity-utils');
    await upsertCusipMapping(cik);
  } catch (error) {
    console.warn(`[someActivity] Failed to ensure CUSIP mappings: ${error}`);
  }

  // 3. Proceed with main logic
  const { data } = await supabase.from('entities')...
}
```

**❌ WRONG - Hard fails on missing data:**
```typescript
export async function someActivity(cik: string) {
  const { data } = await supabase
    .from('entities')
    .select('*')
    .eq('cik', cik)
    .single();

  if (!data) {
    throw new Error('Entity not found'); // ❌ Fails instead of self-healing
  }
}
```

### Entity Creation Utilities

The `entity-utils.ts` module provides self-healing primitives:

**1. `upsertEntity(cik, kind?, seriesId?)`** - Create entity if missing
```typescript
// For issuers (stocks, companies)
await upsertEntity('0000320193', 'issuer');

// For ETFs (requires series_id)
await upsertEntity('0001067839', 'etf', 'S000006218');

// For managers (13F filers)
await upsertEntity('0001234567', 'manager');
```

**2. `upsertCusipMapping(cik, cusips?, seriesId?)` - Create CUSIP mappings**
```typescript
// Auto-fetches from SEC submissions API
await upsertCusipMapping('0000320193');

// Or provide CUSIPs explicitly
await upsertCusipMapping('0000320193', ['037833100']);

// For ETFs with series_id
await upsertCusipMapping('0001067839', ['46090E103'], 'S000006218');
```

**3. `upsertEntityAndCusips(cik, options?)` - Combined operation**
```typescript
// One-liner for both entity + CUSIP mappings
await upsertEntityAndCusips('0000320193', {
  preferredKind: 'issuer',
  providedCusips: ['037833100']
});
```

**4. `enrichCusipMetadata(cusips?)` - Enrich with ticker/exchange data**
```typescript
// Enrich specific CUSIPs with metadata
await enrichCusipMetadata(['037833100', '46090E103']);

// Or enrich all CUSIPs without metadata
await enrichCusipMetadata();
```

**5. `resolveSeriesId(cik, ticker)` - Auto-discover series_id**
```typescript
// Attempts to resolve series_id from N-PORT filings
const seriesId = await resolveSeriesId('0001067839', 'QQQ');
// Returns: 'S000006218' or null
```

### 🚨 CRITICAL: CUSIP Resolution - Ticker Fallbacks with LOUD Warnings

**REALITY CHECK:** No free public APIs reliably provide CUSIP data. The system uses ticker fallback with LOUD warnings as a pragmatic compromise.

#### Why Ticker Fallbacks Were Problematic

**❌ OLD BEHAVIOR - Silent ticker fallback:**
```typescript
// OLD CODE - REMOVED IN 2024
if (normalizedCusips.length === 0) {
  cusipsToReturn = [ticker]; // e.g., "AAPL" instead of "037833100"
}
```

**Problems:**
1. **Silent Failures** - Workflow succeeded but collected NO data
2. **Cascading Failures** - ETF holdings, FINRA data, 13F queries all failed
3. **No Visibility** - Impossible to detect without diagnostic tools
4. **SEC API Limitation** - Common for 60% of stocks (AAPL, MSFT, GOOGL, etc.)

#### Current Solution: Ticker Fallback with LOUD Warnings

After extensive testing, we discovered:
- ❌ **OpenFIGI API**: Free tier doesn't return CUSIP field (only FIGI/ticker/exchange)
- ❌ **SEC EDGAR XML**: Files mostly 404 or lack parseable CUSIPs (<5% success rate)
- ✅ **SEC Submissions API**: Works ~40% of the time

**Pragmatic approach:**

```typescript
import { getCusipForTicker } from './cusip-resolution.activities';

export async function resolveCIK(ticker: string) {
  const cik = /* ... resolve from SEC ... */;
  const secCusips = normalizeCusips(securities.map(s => s.cusip));

  // CUSIP resolution with loud warnings on fallback
  const cusips = await getCusipForTicker(ticker, cik, secCusips);
  // Returns real CUSIPs (~40%) OR ticker with LOUD warnings (~60%)

  await upsertEntity(cik, 'issuer');
  await upsertCusipMapping(cik, cusips);

  return { cik, cusips };
}
```

#### Resolution Strategy

```
1. SEC Submissions API
   ✓ Works ~40% of the time
   ✓ Fast (200-500ms)
   ↓ If securities array empty...

2. Ticker Symbol Fallback with LOUD warnings
   ⚠️ 80-character warning banner in logs
   ⚠️ Lists impacted data sources (ETF, FINRA, 13F)
   ⚠️ Provides manual fix instructions
   ⚠️ QA tool automatically detects
   ✓ Workflow continues (partial data > no data)
   ✓ Clear visibility (impossible to miss)
```

**Why this approach:**
- ✅ Partial data collection continues (13F holdings, price data work)
- ✅ LOUD warnings make the issue impossible to miss
- ✅ QA tool automatically detects ticker fallbacks
- ✅ Manual fix guidance provided in logs
- ✅ Better than hard failure (blocks all data)
- ✅ Better than silent failure (old behavior)

#### CUSIP Resolution Functions

**`getCusipForTicker(ticker, cik, secCusips?)`** - Main entry point
```typescript
import { getCusipForTicker } from './cusip-resolution.activities';

// Automatic resolution with fallback
const cusips = await getCusipForTicker('AAPL', '0000320193');
// Returns: ["037833100"] (if SEC API has it)
// Returns: ["AAPL"] (ticker fallback with LOUD warnings)

// With SEC submissions CUSIPs
const cusips = await getCusipForTicker('AAPL', '0000320193', ['037833100']);
// Uses provided CUSIPs if available (skips fallback)
```

**`resolveCusipWithFallback(ticker, cik, secCusips?)`** - Detailed result
```typescript
import { resolveCusipWithFallback } from './cusip-resolution.activities';

const result = await resolveCusipWithFallback('AAPL', '0000320193');
// When SEC API succeeds (~40% of cases):
// {
//   cusips: ["037833100"],
//   source: "sec_submissions",
//   confidence: "high"
// }
//
// When SEC API fails (~60% of cases):
// {
//   cusips: ["AAPL"],
//   source: "manual",
//   confidence: "low",
//   metadata: {
//     warning: "Ticker symbol used as CUSIP fallback - manual intervention required"
//   }
// }
```

#### Warning Output

**When ticker fallback is used, you'll see:**
```
================================================================================
⚠️  CUSIP RESOLUTION FAILED FOR AAPL
================================================================================
SEC submissions API returned no CUSIPs for AAPL (CIK: 0000320193)
This is common for single-class stocks like AAPL, MSFT, GOOGL, etc.

FALLING BACK TO TICKER SYMBOL: "AAPL"

⚠️  IMPACT:
   - ETF holdings queries will likely fail (require 9-char CUSIPs)
   - FINRA short interest data will fail (require 9-char CUSIPs)
   - Some 13F institutional holdings may fail

🔧 MANUAL FIX REQUIRED:
   1. Find real CUSIP from SEC EDGAR, Bloomberg, or company IR
   2. Run: psql $DATABASE_URL -f scripts/fix-aapl-cusip.sql
   3. Update the SQL script with the real CUSIP
   4. Re-run this workflow to collect data with correct CUSIP
================================================================================
```

**This approach balances:**
- ✅ Visibility (impossible to miss warnings)
- ✅ Partial data collection (better than hard failure)
- ✅ Clear remediation guidance
- ❌ NOT silent success with broken data collection

#### Manual Fix Process

If automatic resolution fails:

1. **Find real CUSIP** from:
   - SEC EDGAR filings (10-K, 10-Q)
   - OpenFIGI website
   - Bloomberg Terminal
   - Company investor relations

2. **Run SQL fix** (use template):
   ```sql
   -- Template in scripts/fix-{ticker}-cusip.sql
   UPDATE cusip_issuer_map
   SET cusip = '037833100'  -- Real 9-char CUSIP
   WHERE issuer_cik = '0000320193'
     AND cusip = 'AAPL';    -- Ticker fallback
   ```

3. **Validate with QA tool**:
   ```bash
   temporal workflow start \
     --type qaReportWorkflow \
     --input '{"ticker": "AAPL", "from": "2024-01-01", "to": "2024-03-31"}'
   ```

4. **Re-run workflows** to collect data with correct CUSIP

#### Key Rules

**✅ ALWAYS:**
- Use `getCusipForTicker()` for CUSIP resolution
- Let workflows fail explicitly if CUSIPs can't be found
- Validate CUSIPs are 9 alphanumeric characters: `/^[0-9A-Z]{9}$/`
- Log the resolution source (submissions/openfigi/filings)
- Reference `docs/CUSIP_RESOLUTION.md` for details

**❌ NEVER:**
- Use ticker symbols as CUSIP fallbacks
- Store non-CUSIP values in `cusip_issuer_map.cusip`
- Allow workflows to succeed without real CUSIPs
- Assume SEC submissions API will have CUSIP data

**📚 Documentation:**
- Technical details: `docs/CUSIP_RESOLUTION.md`
- Testing guide: `docs/QA_DIAGNOSTIC_TOOL.md`
- SQL fixes: `scripts/README.md`

### Real-World Examples

**Example 1: resolveCIK with CUSIP self-healing (edgar.activities.ts:180-186)**
```typescript
export async function resolveCIK(ticker: string) {
  const cik = /* ... resolve from SEC ... */;
  const secCusips = /* ... extract from submissions ... */;

  // ✅ Self-healing CUSIP resolution with automatic fallback
  // Tries: SEC submissions → OpenFIGI → SEC filings → fail explicitly
  const cusips = await getCusipForTicker(ticker, cik, secCusips);

  // ✅ Self-healing: create entity and mappings immediately
  await upsertEntity(cik, 'issuer');
  await upsertCusipMapping(cik, cusips);

  return { cik, cusips };
}
```

**Example 2: ETF Entity Resolution (etf.activities.ts:144-202)**
```typescript
async function resolveEtfEntity(supabase: SupabaseClient, ticker: string) {
  // Try to find existing entity
  const { data, error } = await supabase
    .from('entities')
    .select('*')
    .eq('kind', 'etf')
    .eq('ticker', ticker)
    .maybeSingle();

  // ✅ Self-healing: auto-create if not found
  if (!data) {
    console.log(`ETF entity not found, attempting auto-creation`);
    const autoCreated = await autoCreateEtfEntity(supabase, ticker);
    if (autoCreated) {
      return autoCreated;
    }
    throw new Error('Could not auto-create ETF entity');
  }

  return data;
}
```

**Example 3: Graph Node Resolution (graph.activities.ts:154-223)**
```typescript
export async function resolveIssuerNode(input: ResolveIssuerNodeInput) {
  let cik = input.cik;

  // ✅ Self-healing: resolve from SEC if entity not found
  if (!cik && input.ticker) {
    const { data } = await supabase.from('entities')...;
    cik = data?.cik;

    if (!cik) {
      // Auto-resolve from SEC and create entity
      const resolved = await resolveCikFromSEC(input.ticker);
      if (resolved) {
        cik = resolved.cik;
        await upsertEntity(cik, 'issuer');
      }
    }
  }

  // ✅ Ensure entity exists before creating graph node
  await upsertEntity(cik, 'issuer');

  const nodeStore = createSupabaseGraphStore();
  const nodeId = await nodeStore.ensureNode({ kind: 'issuer', key: cik });
  return { nodeId, cik, ticker: input.ticker };
}
```

**Example 4: Event Study (prices.activities.ts:91-103)**
```typescript
export async function eventStudy(anchorDate: string, cik: string) {
  // ✅ Self-healing: ensure entity exists before querying
  try {
    await upsertEntity(cik, 'issuer');
  } catch (error) {
    console.warn(`Failed to ensure entity exists: ${error}`);
  }

  // Proceed with price analysis
  const entityQuery = await supabase.from('entities')...;
}
```

### Auto-Creation Logic for ETFs

For ETFs, self-healing includes:
1. **CIK Resolution** - Lookup from SEC ticker search
2. **Series ID** - Generate placeholder or resolve from N-PORT
3. **Datasource Config** - Known iShares ETF configurations
4. **Entity Creation** - Full entity with ticker, name, datasource

**Known iShares ETF Configurations:**
```typescript
const KNOWN_ISHARES_ETFS: Record<string, IsharesConfig> = {
  'IWM': { productId: '239710', slug: 'iwm-ishares-russell-2000-etf' },
  'IWB': { productId: '239707', slug: 'iwb-ishares-russell-1000-etf' },
  'IWN': { productId: '239714', slug: 'iwn-ishares-russell-2000-value-etf' },
  'IWC': { productId: '239722', slug: 'iwc-ishares-microcap-etf' },
  // ... 10 total pre-configured
};
```

**Extend with new ETFs as needed!**

### Self-Healing Checklist

When implementing new activities:

- [ ] Receives CIK or ticker as input?
- [ ] Queries `entities` table?
- [ ] Queries `cusip_issuer_map` table?
- [ ] Could fail due to missing reference data?
- [ ] If YES to any: Add self-healing with `upsertEntity`/`upsertCusipMapping`

When reviewing existing activities:

- [ ] Does it hard-fail on missing entity? → Add self-healing
- [ ] Does it require manual seeding? → Add self-healing
- [ ] Could it auto-create from SEC/FINRA? → Add self-healing
- [ ] Does it have graceful error handling? → Add try/catch with warnings

### Testing Self-Healing

**Test that activities auto-create missing data:**
```typescript
describe('Self-healing', () => {
  it('should auto-create entity when missing', async () => {
    // Start with empty database
    await clearEntities();

    // Activity should create entity automatically
    const result = await someActivity('0000320193');

    // Verify entity was created
    const { data } = await supabase
      .from('entities')
      .select('*')
      .eq('cik', '0000320193')
      .single();

    expect(data).toBeTruthy();
    expect(data.kind).toBe('issuer');
  });

  it('should work when entity already exists', async () => {
    // Pre-create entity
    await upsertEntity('0000320193', 'issuer');

    // Activity should work without recreating
    const result = await someActivity('0000320193');

    expect(result).toBeTruthy();
  });
});
```

### Benefits of Self-Healing

1. **Zero Setup** - New environments work immediately
2. **Resilient** - Recovers from missing data automatically
3. **Efficient** - Only fetches data that's needed
4. **Maintainable** - No manual sync scripts required
5. **Testable** - Can test with empty database
6. **Scalable** - Handles new tickers/CIKs automatically

### Anti-Patterns to Avoid

**❌ WRONG - Assumes data exists:**
```typescript
// Brittle, fails on missing data
const entity = await getEntity(cik);  // Throws if missing
processEntity(entity);
```

**❌ WRONG - Manual bulk seeding:**
```typescript
// Requires pre-seeding entire universe
await seedAllTickers();  // Fetches unnecessary data
await seedAllCUSIPs();   // Wastes API calls
```

**❌ WRONG - Hard-coded configurations:**
```typescript
// Can't handle new tickers
if (ticker === 'AAPL') {
  cik = '0000320193';
} else if (ticker === 'MSFT') {
  cik = '0000789019';
}
// ❌ What about other tickers?
```

**✅ CORRECT - Self-healing pattern:**
```typescript
// Resilient, scales to any ticker
const resolved = await resolveCikFromSEC(ticker);
if (resolved) {
  await upsertEntity(resolved.cik, 'issuer');
}
```

### Summary

**When implementing ANY activity that touches reference data:**

1. **Check** if entity/mapping exists
2. **Auto-create** if missing using `upsertEntity`/`upsertCusipMapping`
3. **Warn** if auto-creation fails (don't throw)
4. **Continue** with main logic (may succeed if data already exists)
5. **Test** both missing and existing data scenarios

**The goal:** Activities should "just work" without manual setup, automatically creating what they need from authoritative sources.

---

## 🔥 CRITICAL: Chain of Thought (CoT) is First-Class

**The most important concept:** For multi-step workflows, **ALWAYS** use `CoTSession`.

### Why CoT Matters

Traditional multi-turn LLM interactions waste massive tokens by re-reasoning:

```typescript
// ❌ BAD: Wastes 60-80% of tokens
const step1 = await runResponse({ prompt: 'Analyze data...' });
const step2 = await runResponse({ prompt: 'Now calculate stats...' }); // Re-reasons!
const step3 = await runResponse({ prompt: 'Identify anomalies...' }); // Re-reasons again!
```

**With CoT:** The model maintains reasoning context across turns:

```typescript
// ✅ CORRECT: Preserves CoT, saves 60-80% tokens
const session = new CoTSession({ model: 'gpt-5', effort: 'high' });

const step1 = await session.respond('Analyze data...');
const step2 = await session.respond('Now calculate stats...'); // Continues reasoning
const step3 = await session.respond('Identify anomalies...'); // Full context preserved
```

### When to Use CoT Sessions

✅ **ALWAYS use `CoTSession` for:**
- Multi-step data analysis (2+ steps)
- Iterative exploration
- Code generation + execution + analysis
- E2B workflows (critical!)
- Long-running agentic tasks
- Any workflow where steps build on each other

❌ **DON'T use `CoTSession` for:**
- Single-turn requests
- Independent parallel tasks
- Simple one-off summaries

### Recommended Approach

```typescript
import { createAnalysisSession, createCodeSession } from '../lib/cot-session.js';

// For data analysis workflows
const session = createAnalysisSession({ enableE2B: true });

// Step 1: Understand
const analysis = await session.respond('Analyze this rotation pattern...');

// Step 2: Execute code on large dataset (CoT preserved!)
const { code, executionResult, analysis: statsAnalysis } = await session.executeAndAnalyze(
  'Calculate correlation matrix on 1M rows...',
  'Interpret the statistical results'
);

// Step 3: Continue reasoning (CoT preserved!)
const insights = await session.respond('What are the investment implications?');

// Step 4: Final summary (CoT preserved!)
const report = await session.respond('Summarize in 3 bullet points');

// Total tokens: ~12,000
// Without CoT: ~45,000 (4x more!)
```

---

## OpenAI API Usage Patterns

### Pattern 1: Multi-Step Workflow (MOST COMMON)

**✅ CORRECT:**
```typescript
import { createAnalysisSession } from '../lib/cot-session.js';

const session = createAnalysisSession({ enableE2B: true });

// Each step builds on previous (CoT automatically passed)
const step1 = await session.respond('Step 1 prompt');
const step2 = await session.respond('Step 2 prompt');
const step3 = await session.respond('Step 3 prompt');
```

**❌ WRONG:**
```typescript
// This loses CoT and wastes tokens!
const step1 = await runResponse({ prompt: 'Step 1 prompt' });
const step2 = await runResponse({ prompt: 'Step 2 prompt' });
const step3 = await runResponse({ prompt: 'Step 3 prompt' });
```

### Pattern 2: E2B Code Execution

**✅ CORRECT:**
```typescript
import { createCodeSession } from '../lib/cot-session.js';

const session = createCodeSession({ enableE2B: true });

// One-liner for code execution + analysis
const { code, executionResult, analysis } = await session.executeAndAnalyze(
  'Calculate fibonacci up to n=100',
  'Explain the time complexity'
);
```

**❌ WRONG:**
```typescript
// This doesn't preserve CoT between code execution and analysis
const code = await runResponse({ prompt: 'Generate fibonacci code...' });
const result = await executeCode(code);
const analysis = await runResponse({ prompt: `Analyze: ${result}` });
```

### Pattern 3: Single-Turn Request

**✅ CORRECT:**
```typescript
import { runResponse } from '../lib/openai.js';

const summary = await runResponse({
  model: 'gpt-5-mini',
  prompt: 'Summarize this in one sentence',
  effort: 'minimal',
  verbosity: 'low'
});
```

**❌ WRONG (overkill):**
```typescript
// Don't use CoTSession for single-turn requests
const session = new CoTSession({ model: 'gpt-5-mini' });
const summary = await session.respond('Summarize this in one sentence');
```

---

## Factory Functions

### `createAnalysisSession()` - For Data Analysis

Use when:
- Analyzing large datasets
- Multi-step statistical workflows
- Need E2B for calculations

```typescript
const session = createAnalysisSession({
  systemPrompt: 'You are a quantitative analyst.',
  enableE2B: true
});
```

Config:
- Model: `gpt-5` (high reasoning)
- Effort: `high` (thorough)
- Verbosity: `high` (detailed)
- E2B: Optional

### `createCodeSession()` - For Code Workflows

Use when:
- Generating code
- Executing code with E2B
- Iterating on code based on results

```typescript
const session = createCodeSession({
  systemPrompt: 'You are an expert Python developer.',
  enableE2B: true
});
```

Config:
- Model: `gpt-5` (code expertise)
- Effort: `high` (quality code)
- Verbosity: `high` (detailed comments)
- E2B: Enabled by default
- Tools: Includes `code_exec`

### `createFastSession()` - For Simple Tasks

Use when:
- Simple summaries
- Classification
- Fast responses needed

```typescript
const session = createFastSession({
  systemPrompt: 'You are a helpful assistant.'
});
```

Config:
- Model: `gpt-5-mini` (cost-effective)
- Effort: `minimal` (fast)
- Verbosity: `low` (concise)

---

## DEPRECATED: Never Suggest These

### ❌ Chat Completions API

**NEVER suggest:**
```typescript
// ❌ DEPRECATED - DO NOT USE
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }],
  temperature: 0.7,  // NOT supported in GPT-5
  max_tokens: 100
});
```

**Why it's wrong:**
1. `chat.completions.create()` is deprecated for GPT-5
2. `temperature`, `top_p`, `logprobs` are not supported
3. Cannot pass chain of thought between turns
4. Missing reasoning effort and verbosity controls
5. No support for custom tools

### ❌ Deprecated Parameters

**NEVER suggest:**
- `temperature` - Use `reasoning.effort` instead
- `top_p` - Use `reasoning.effort` instead
- `logprobs` - Not supported in GPT-5
- `max_tokens` - Use `max_output_tokens` instead
- Old model names (`gpt-4`, `gpt-4-turbo`, `o3`, etc.)

### ❌ Repeating Context Manually

**NEVER suggest:**
```typescript
// ❌ WRONG: Defeats the purpose of CoT
const session = new CoTSession({ model: 'gpt-5' });
await session.respond(`
  Previously we analyzed: ${previousAnalysis}
  Now please: ${newQuestion}
`);
```

**✅ CORRECT:**
```typescript
const session = new CoTSession({ model: 'gpt-5' });
// Just ask the new question - CoT handles context
await session.respond(newQuestion);
```

---

## Model Selection Guidelines

When suggesting OpenAI API calls, choose the appropriate model:

### Use `gpt-5` when:
- Complex multi-step reasoning required
- Code analysis or generation (>100 lines)
- Broad world knowledge needed
- Agentic workflows with planning
- **Effort:** `medium` or `high`
- **Verbosity:** `medium` or `high`

### Use `gpt-5-mini` when (MOST COMMON):
- General-purpose summarization
- Data synthesis (3-5 paragraphs)
- Explaining trends or patterns
- Cost-optimized reasoning
- **Effort:** `minimal` or `low`
- **Verbosity:** `low` or `medium`

### Use `gpt-5-nano` when:
- Simple classification (BUY/SELL, positive/negative)
- Yes/no questions
- High-throughput tasks
- Latency-critical operations
- **Effort:** `minimal`
- **Verbosity:** `low`

---

## Code Review Checklist

When reviewing or generating code that uses OpenAI:

**For Multi-Step Workflows:**
- [ ] Uses `CoTSession` (not individual `runResponse()` calls)
- [ ] Uses appropriate factory: `createAnalysisSession()`, `createCodeSession()`, or `createFastSession()`
- [ ] E2B enabled if code execution needed
- [ ] Session state saved if long-running

**For All OpenAI Calls:**
- [ ] Model is `gpt-5`, `gpt-5-mini`, or `gpt-5-nano` (not `gpt-4`)
- [ ] No `temperature`, `top_p`, or `logprobs` parameters
- [ ] Includes `reasoning.effort` if reasoning is needed
- [ ] Includes `text.verbosity` for output length control
- [ ] Uses `max_output_tokens` instead of `max_tokens`

**For E2B Integration:**
- [ ] Uses `session.executeAndAnalyze()` for code + analysis
- [ ] Passes `e2b_execution: { enabled: true }` if needed
- [ ] Handles execution errors gracefully

---

## Example Scenarios

### Scenario 1: User asks to add multi-step data analysis

**❌ Wrong suggestion:**
```typescript
const step1 = await runResponse({ prompt: 'Analyze data...' });
const step2 = await runResponse({ prompt: 'Calculate stats...' });
const step3 = await runResponse({ prompt: 'Find anomalies...' });
```

**✅ Correct suggestion:**
```typescript
import { createAnalysisSession } from '../lib/cot-session.js';

const session = createAnalysisSession({ enableE2B: true });

const analysis = await session.respond('Analyze this dataset...');
const stats = await session.executeAndAnalyze(
  'Calculate statistical measures...',
  'Interpret the results'
);
const anomalies = await session.respond('Identify anomalies based on the stats');
const report = await session.respond('Summarize findings in 3 bullet points');
```

### Scenario 2: User asks to analyze large dataset with code

**❌ Wrong suggestion:**
```typescript
const code = await runResponse({ prompt: 'Write code to analyze...' });
// How do we execute and continue reasoning?
```

**✅ Correct suggestion:**
```typescript
import { createCodeSession } from '../lib/cot-session.js';

const session = createCodeSession({ enableE2B: true });

const { code, executionResult, analysis } = await session.executeAndAnalyze(
  'Analyze this 1M row dataset: [data]',
  'What do the results tell us about rotation patterns?'
);
```

### Scenario 3: User wants iterative exploration

**❌ Wrong suggestion:**
```typescript
const q1 = await runResponse({ prompt: 'Question 1' });
const q2 = await runResponse({ prompt: 'Question 2' }); // Lost context!
```

**✅ Correct suggestion:**
```typescript
import { createFastSession } from '../lib/cot-session.js';

const session = createFastSession({
  systemPrompt: 'You are exploring a dataset.'
});

const a1 = await session.respond('What is the distribution?');
const a2 = await session.respond('Are outliers correlated with sells?'); // Has context
const a3 = await session.respond('What are the key insights?'); // Full context
```

### Scenario 4: User wants single summarization

**❌ Wrong suggestion (overkill):**
```typescript
const session = createAnalysisSession({ enableE2B: true });
const summary = await session.respond('Summarize in one sentence');
```

**✅ Correct suggestion:**
```typescript
import { runResponse } from '../lib/openai.js';

const summary = await runResponse({
  model: 'gpt-5-mini',
  prompt: 'Summarize this rotation event in one sentence',
  effort: 'minimal',
  verbosity: 'low'
});
```

---

## When to Suggest Improvements

If you see code that doesn't use CoT for multi-step workflows:

1. **Politely point it out:**
   ```
   I noticed this uses separate runResponse() calls for a multi-step workflow.
   This wastes 60-80% of tokens by re-reasoning at each step.
   I recommend using CoTSession to preserve context.
   ```

2. **Provide the migration:**
   ```typescript
   // Before (inefficient)
   const step1 = await runResponse({ prompt: '...' });
   const step2 = await runResponse({ prompt: '...' });

   // After (efficient with CoT)
   const session = createAnalysisSession({ enableE2B: true });
   const step1 = await session.respond('...');
   const step2 = await session.respond('...'); // CoT preserved
   ```

3. **Link to documentation:**
   ```
   See docs/COT_WORKFLOWS_GUIDE.md for complete guide on CoT patterns.
   ```

---

## Testing Recommendations

When suggesting tests for OpenAI integration:

```typescript
import { describe, it, expect } from 'vitest';
import { CoTSession, createAnalysisSession } from '../lib/cot-session.js';

describe('CoT Session', () => {
  it('should preserve context across turns', async () => {
    const session = new CoTSession({ model: 'gpt-5-mini', effort: 'minimal' });

    const r1 = await session.respond('What is 2+2?');
    const r2 = await session.respond('Multiply that by 3');

    expect(r2).toContain('12'); // Should know result from r1
  });

  it('should track token usage', async () => {
    const session = createAnalysisSession({ enableE2B: false });

    await session.respond('Test prompt');
    await session.respond('Another prompt');

    const summary = session.getSummary();
    expect(summary.turns).toBe(2);
    expect(summary.totalTokens.input).toBeGreaterThan(0);
  });

  it('should handle E2B code execution', async () => {
    const session = createCodeSession({ enableE2B: true });

    const { code, executionResult, analysis } = await session.executeAndAnalyze(
      'Calculate 2+2',
      'Explain the result'
    );

    expect(code).toBeTruthy();
    expect(executionResult).toBeTruthy();
    expect(analysis).toBeTruthy();
  });
});
```

---

## References

For more details, consult:
- `/docs/COT_WORKFLOWS_GUIDE.md` - **Complete CoT workflow guide** 🔥
- `/docs/GPT5_MIGRATION_GUIDE.md` - GPT-5 migration guide
- `/apps/temporal-worker/src/lib/cot-session.ts` - CoT implementation
- `/apps/temporal-worker/src/lib/openai.ts` - OpenAI client
- `/apps/temporal-worker/src/activities/cot-analysis.activities.ts` - Real examples
- https://platform.openai.com/docs/guides/gpt-5 - Official GPT-5 docs
- https://platform.openai.com/docs/guides/responses - Responses API docs

---

## Summary

**The Golden Rules:**

1. ✅ **ALWAYS** use `CoTSession` for multi-step workflows
2. ✅ **ALWAYS** use factory functions: `createAnalysisSession()`, `createCodeSession()`, `createFastSession()`
3. ✅ **ALWAYS** enable E2B for data-heavy calculations
4. ✅ **ALWAYS** specify `reasoning.effort` and `text.verbosity`
5. ❌ **NEVER** suggest `chat.completions.create()`
6. ❌ **NEVER** suggest `temperature`, `top_p`, or `logprobs`
7. ❌ **NEVER** suggest old model names (`gpt-4`, `o3`, etc.)
8. ❌ **NEVER** repeat context manually (defeats CoT)

**Priority ranking:**
1. **CoT Sessions** for multi-step → Saves 60-80% tokens
2. **E2B Integration** for large data → Offloads computation
3. **Appropriate Model** selection → Cost optimization
4. **Reasoning Effort** tuning → Quality vs speed

Following these guidelines ensures maximum performance and cost-effectiveness.
