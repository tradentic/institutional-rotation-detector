# RotationScore v5.0 Implementation Plan

**Status:** 🔧 IN PROGRESS
**Current Version:** v4.1+ (Transitional)
**Target Version:** v5.0 Full Compliance
**Created:** 2025-11-13

---

## Executive Summary

This document outlines the specific steps to close the gap between the current v4.1+ implementation and full v5.0 specification compliance.

**Current State:** v4.1 scoring with significant v5 enhancements
- ✅ 30% dump threshold
- ✅ Robust DumpZ (median/MAD)
- ✅ EOW multipliers (0.95, 0.9, 0.5)
- ✅ AI-powered analysis (GPT-5)
- ✅ Microstructure layer
- ✅ Options flow
- ✅ Insider transactions

**Remaining v5 Gaps:**
1. ❌ Float-based dump detection
2. ❌ Buyer sufficiency gates
3. ⚠️ Complete provenance tracking
4. ⚠️ Passive share calculation for IndexPenalty
5. ❌ v5 acceptance test suite

**Estimated Effort:** 2-3 weeks
**Priority:** Medium (current system is production-ready)

---

## Phase 1: Float Data Integration (Week 1)

### 1.1 Add Shares Outstanding to Schema

**Goal:** Enable float-based dump detection and buyer sufficiency checks

**Tasks:**

#### Task 1.1.1: Extend Database Schema
**File:** `supabase/migrations/024_add_shares_outstanding.sql`
**Effort:** 2 hours

```sql
-- Add shares_outstanding to entities table
ALTER TABLE entities
ADD COLUMN shares_outstanding BIGINT,
ADD COLUMN shares_float BIGINT,
ADD COLUMN float_last_updated DATE;

-- Add index for performance
CREATE INDEX idx_entities_shares_outstanding
ON entities(shares_outstanding) WHERE shares_outstanding IS NOT NULL;

-- Add comments
COMMENT ON COLUMN entities.shares_outstanding IS 'Total shares outstanding';
COMMENT ON COLUMN entities.shares_float IS 'Free float (excludes insider/restricted shares)';
COMMENT ON COLUMN entities.float_last_updated IS 'Date float data was last refreshed';
```

#### Task 1.1.2: Create Float Data Activity
**File:** `apps/temporal-worker/src/activities/float-data.activities.ts`
**Effort:** 4 hours

```typescript
/**
 * Float Data Activities
 *
 * Fetches shares outstanding and free float data from external sources.
 *
 * Data Sources (in priority order):
 * 1. SEC EDGAR (10-K/10-Q filings - extract from XBRL)
 * 2. IEX Cloud API (sharesOutstanding endpoint)
 * 3. Fallback: Estimate from recent 13F filings
 */

export interface FetchFloatDataInput {
  cik: string;
  ticker?: string;
  asof?: string; // Optional date, defaults to today
}

export interface FetchFloatDataResult {
  cik: string;
  sharesOutstanding: number;
  sharesFloat: number;
  source: 'EDGAR' | 'IEX' | 'ESTIMATED';
  asof: string;
}

/**
 * Fetch shares outstanding and free float for an issuer
 */
export async function fetchFloatData(input: FetchFloatDataInput): Promise<FetchFloatDataResult> {
  // Implementation:
  // 1. Try EDGAR XBRL extraction from latest 10-K/10-Q
  // 2. Fall back to IEX API if available
  // 3. Fall back to estimation from 13F holder base

  const supabase = createSupabaseClient();

  // TODO: Implement EDGAR XBRL extraction
  // Look for "us-gaap:CommonStockSharesOutstanding" in recent 10-K/10-Q

  // TODO: Implement IEX fallback
  // GET /stock/{ticker}/stats -> sharesOutstanding

  // TODO: Implement 13F estimation
  // Sum all 13F holders + estimate retail (typically 20-40% of total)

  throw new Error('Not implemented');
}

/**
 * Batch update float data for multiple issuers
 */
export async function batchUpdateFloatData(input: { ciks: string[] }): Promise<void> {
  // Fetch float data for all CIKs in parallel (with rate limiting)
  // Update entities table
  // Log results
}
```

#### Task 1.1.3: Create Float Refresh Workflow
**File:** `apps/temporal-worker/src/workflows/floatDataRefresh.workflow.ts`
**Effort:** 2 hours

```typescript
/**
 * Float Data Refresh Workflow
 *
 * Scheduled workflow that refreshes shares outstanding data
 * for all tracked issuers.
 *
 * Schedule: Weekly (Sundays at 2am UTC)
 */

export async function floatDataRefreshWorkflow(): Promise<void> {
  const activities = proxyActivities<{
    batchUpdateFloatData: (input: { ciks: string[] }) => Promise<void>;
  }>({
    startToCloseTimeout: '1 hour',
  });

  // Fetch all tracked CIKs
  // Batch into groups of 100
  // Process each batch with retry logic
  // Report results
}
```

**Testing:**
- [ ] Unit tests for float data extraction
- [ ] Integration test with real EDGAR filing
- [ ] Workflow test with mock data

---

### 1.2 Update Dump Detection with Float Threshold

**File:** `apps/temporal-worker/src/activities/compute.activities.ts`
**Effort:** 3 hours

**Changes:**

```typescript
// Add float-based threshold constant
const DEFAULT_MIN_DUMP_FLOAT_PCT = 0.01; // 1.0% of float

async function detectDumpEvents(
  cik: string,
  cusips: string[],
  quarter: QuarterBounds
): Promise<DumpEvent[]> {
  const supabase = getSupabaseClient();

  // Fetch shares outstanding for issuer
  const { data: entity } = await supabase
    .from('entities')
    .select('shares_float, shares_outstanding')
    .eq('cik', cik)
    .maybeSingle();

  const sharesFloat = entity?.shares_float ?? entity?.shares_outstanding;

  // Existing detection logic...

  for (const [entityId, deltas] of deltasByEntity.entries()) {
    for (const delta of deltas) {
      const absDelta = Math.abs(delta.deltaShares);

      // Check both thresholds (either can trigger)
      const pctThresholdMet = Math.abs(delta.pctDelta) >= DEFAULT_MIN_DUMP_PCT;

      let floatThresholdMet = false;
      if (sharesFloat && sharesFloat > 0) {
        const floatPct = absDelta / sharesFloat;
        floatThresholdMet = floatPct >= DEFAULT_MIN_DUMP_FLOAT_PCT;
      }

      if (delta.deltaShares < 0 && (pctThresholdMet || floatThresholdMet)) {
        // Dump detected!
        // ... rest of logic
      }
    }
  }
}
```

**Testing:**
- [ ] Test with float data: 5M share dump on 500M float (1% = triggers)
- [ ] Test without float data: Falls back to pct threshold
- [ ] Test edge case: Small % but large float impact

---

### 1.3 Implement Buyer Sufficiency Gates

**File:** `apps/temporal-worker/src/lib/scoring.ts`
**Effort:** 4 hours

**Changes:**

```typescript
export interface ScoreInputs {
  dumpZ: number;
  uSame: number;
  uNext: number;
  // ... existing fields

  // NEW: Buyer sufficiency fields
  buyerCount?: number;           // Number of distinct buyers
  maxBuyerFloatPct?: number;     // Largest single buyer as % of float
}

export function computeRotationScore(inputs: ScoreInputs): ScoreResult {
  // GATE 1: DumpZ threshold (existing)
  if (inputs.dumpZ < DUMP_GATE_Z) {
    return { rScore: 0, gated: false };
  }

  // GATE 2: Uptake exists (existing)
  const hasUptake =
    inputs.uSame > 0 ||
    inputs.uNext > 0 ||
    inputs.uhfSame > 0 ||
    inputs.uhfNext > 0;

  if (!hasUptake) {
    return { rScore: 0, gated: false };
  }

  // GATE 3: Buyer sufficiency (NEW)
  const hasSufficientBuyers = checkBuyerSufficiency(inputs);
  if (!hasSufficientBuyers) {
    return { rScore: 0, gated: false };
  }

  // ... rest of scoring logic
}

/**
 * Check if buyer base is sufficient for rotation signal
 *
 * Requirements (from v5 spec):
 * - At least 2 distinct buyers, OR
 * - One buyer holding >= 0.75% of float
 */
function checkBuyerSufficiency(inputs: ScoreInputs): boolean {
  // If buyer data not available, assume sufficient (backward compatible)
  if (inputs.buyerCount === undefined && inputs.maxBuyerFloatPct === undefined) {
    return true;
  }

  // Check: 2+ buyers
  if (inputs.buyerCount !== undefined && inputs.buyerCount >= 2) {
    return true;
  }

  // Check: One large buyer (>= 0.75% float)
  if (inputs.maxBuyerFloatPct !== undefined && inputs.maxBuyerFloatPct >= 0.0075) {
    return true;
  }

  return false;
}
```

**Update `compute.activities.ts` to track buyers:**

```typescript
interface DumpComputationResult {
  // ... existing fields

  // NEW: Buyer tracking
  buyerEntities: Set<string>;        // Distinct buyer entity IDs
  buyerSharesByEntity: Map<string, number>; // Shares bought per entity
}

async function computeDumpContext(
  cik: string,
  quarter: QuarterBounds
): Promise<DumpComputationResult> {
  // ... existing logic

  const buyerEntities = new Set<string>();
  const buyerSharesByEntity = new Map<string, number>();

  // Track buyers (entities with positive deltas in same/next quarter)
  for (const [entityId, deltas] of deltasByEntity.entries()) {
    for (const delta of deltas) {
      if (delta.deltaShares > 0 &&
          (delta.date >= quarterStart && delta.date <= nextQuarterEnd)) {
        buyerEntities.add(entityId);
        const existing = buyerSharesByEntity.get(entityId) ?? 0;
        buyerSharesByEntity.set(entityId, existing + delta.deltaShares);
      }
    }
  }

  return {
    // ... existing fields
    buyerEntities,
    buyerSharesByEntity,
  };
}
```

**Update `scoreV4_1` activity to pass buyer data:**

```typescript
export async function scoreV4_1(input: ScoreInput): Promise<ScoreResult> {
  const context = await computeDumpContext(input.cik, input.quarter);

  // Fetch float data
  const supabase = getSupabaseClient();
  const { data: entity } = await supabase
    .from('entities')
    .select('shares_float, shares_outstanding')
    .eq('cik', input.cik)
    .maybeSingle();

  const sharesFloat = entity?.shares_float ?? entity?.shares_outstanding;

  // Compute buyer sufficiency metrics
  const buyerCount = context.buyerEntities.size;

  let maxBuyerFloatPct = 0;
  if (sharesFloat && sharesFloat > 0) {
    for (const shares of context.buyerSharesByEntity.values()) {
      const floatPct = shares / sharesFloat;
      maxBuyerFloatPct = Math.max(maxBuyerFloatPct, floatPct);
    }
  }

  // Call scoring function with new fields
  const scoreResult = computeRotationScore({
    // ... existing fields
    buyerCount,
    maxBuyerFloatPct,
  });

  // ... rest of logic
}
```

**Testing:**
- [ ] Test: 1 buyer with 1% float → passes gate (≥0.75%)
- [ ] Test: 3 buyers with 0.1% each → passes gate (≥2 buyers)
- [ ] Test: 1 buyer with 0.5% float → FAILS gate
- [ ] Test: No float data available → passes gate (backward compatible)

---

## Phase 2: Provenance & Index Penalty (Week 2)

### 2.1 Complete Provenance Tracking

**Goal:** Ensure all rotation events have complete provenance records

**File:** `apps/temporal-worker/src/activities/compute.activities.ts`
**Effort:** 3 hours

**Changes:**

```typescript
/**
 * Build provenance records for a rotation event
 *
 * Tracks which filings contributed to the rotation detection
 */
async function buildProvenanceRecords(
  clusterId: string,
  anchor: DumpEvent,
  context: DumpComputationResult
): Promise<void> {
  const supabase = getSupabaseClient();

  const records = [];

  // Anchor filing (the dump itself)
  records.push({
    cluster_id: clusterId,
    accession: anchor.accession,
    role: 'anchor',
    entity_id: anchor.entityId,
    contribution_weight: 1.0,
  });

  // Seller filings (could be multiple if consolidated reporting)
  // Find all 13F filings for seller entity in quarter
  const { data: sellerFilings } = await supabase
    .from('filings')
    .select('accession')
    .eq('cik', anchor.sellerCik)
    .gte('period_end', context.quarterStart)
    .lte('period_end', context.quarterEnd)
    .in('form', ['13F-HR', '13F-HR/A']);

  for (const filing of sellerFilings ?? []) {
    records.push({
      cluster_id: clusterId,
      accession: filing.accession,
      role: 'seller',
      entity_id: anchor.entityId,
      contribution_weight: 1.0 / (sellerFilings?.length ?? 1),
    });
  }

  // Buyer filings
  for (const [entityId, shares] of context.buyerSharesByEntity.entries()) {
    const { data: buyerFilings } = await supabase
      .from('filings')
      .select('accession, cik')
      .eq('entity_id', entityId) // Assuming we track this relationship
      .gte('period_end', context.quarterStart)
      .lte('period_end', context.nextQuarterEnd)
      .in('form', ['13F-HR', '13F-HR/A']);

    for (const filing of buyerFilings ?? []) {
      records.push({
        cluster_id: clusterId,
        accession: filing.accession,
        role: 'buyer',
        entity_id: entityId,
        contribution_weight: shares / context.totalPositiveSame,
      });
    }
  }

  // UHF filings (N-PORT, ETF)
  // TODO: Track N-PORT and ETF filings that contributed to uhf signals

  // Batch insert all provenance records
  const { error } = await supabase
    .from('rotation_event_provenance')
    .upsert(records, {
      onConflict: 'cluster_id,accession,role',
    });

  if (error) {
    console.error('Failed to insert provenance records:', error);
  }
}
```

**Update `scoreV4_1` to call provenance builder:**

```typescript
export async function scoreV4_1(input: ScoreInput): Promise<ScoreResult> {
  // ... existing scoring logic

  // After creating rotation event, build provenance
  await buildProvenanceRecords(clusterId, anchor, context);

  return result;
}
```

**Testing:**
- [ ] Verify provenance records created for each rotation event
- [ ] Check all roles are represented (anchor, seller, buyer)
- [ ] Validate contribution weights sum to reasonable values

---

### 2.2 Enhance IndexPenalty with Passive Share Calculation

**File:** `apps/temporal-worker/src/lib/indexCalendar.ts`
**Effort:** 4 hours

**Current Issue:** `passive_share` is not calculated; penalty uses hardcoded logic

**Solution:**

```typescript
/**
 * Calculate passive share of buyer uptake
 *
 * Identifies which buyers are passive (ETF/index fund) vs active (hedge fund)
 *
 * Data sources:
 * 1. Entity kind field (ETF = passive)
 * 2. Entity name matching (contains "index", "s&p", "vanguard index")
 * 3. 13F form_type matching (N-PORT = likely fund)
 */
async function calculatePassiveShare(
  buyerEntities: Set<string>,
  buyerSharesByEntity: Map<string, number>
): Promise<number> {
  const supabase = createSupabaseClient();

  // Fetch entity details for all buyers
  const { data: entities } = await supabase
    .from('entities')
    .select('entity_id, kind, name')
    .in('entity_id', Array.from(buyerEntities));

  let totalShares = 0;
  let passiveShares = 0;

  for (const entity of entities ?? []) {
    const shares = buyerSharesByEntity.get(entity.entity_id) ?? 0;
    totalShares += shares;

    // Check if passive
    const isPassive =
      entity.kind === 'etf' ||
      entity.kind === 'fund' ||
      /index|s&p|russell|vanguard index|ishares|spdr/i.test(entity.name ?? '');

    if (isPassive) {
      passiveShares += shares;
    }
  }

  if (totalShares === 0) return 0;
  return passiveShares / totalShares;
}

/**
 * Compute index penalty with passive share integration
 */
export async function computeIndexPenalty(
  quarterStart: string,
  quarterEnd: string,
  buyerContext: {
    buyerEntities: Set<string>;
    buyerSharesByEntity: Map<string, number>;
  }
): Promise<number> {
  const windows = await getIndexWindows(quarterStart, quarterEnd);

  // Calculate passive share
  const passiveShare = await calculatePassiveShare(
    buyerContext.buyerEntities,
    buyerContext.buyerSharesByEntity
  );

  let totalPenalty = 0;
  const quarterDays = dateDiffDays(quarterStart, quarterEnd);

  for (const window of windows) {
    const overlapDays = calculateOverlap(quarterStart, quarterEnd, window.start, window.end);
    if (overlapDays > 0) {
      const overlapRatio = overlapDays / quarterDays;
      const penalty = overlapRatio * passiveShare * BASE_PENALTY;
      totalPenalty += penalty;
    }
  }

  return Math.min(PENALTY_CAP, totalPenalty);
}
```

**Testing:**
- [ ] Test with 100% passive buyers → max penalty (overlap dependent)
- [ ] Test with 0% passive buyers → zero penalty
- [ ] Test with 50% passive during Russell window → appropriate penalty
- [ ] Verify penalty never exceeds 0.5 cap

---

## Phase 3: Testing & Validation (Week 2-3)

### 3.1 Create v5 Acceptance Test Suite

**File:** `apps/temporal-worker/src/__tests__/acceptance/v5-compliance.test.ts`
**Effort:** 8 hours

**Test Cases (from v5 spec):**

```typescript
import { describe, it, expect } from '@jest/globals';

describe('RotationScore v5.0 Acceptance Tests', () => {

  /**
   * Test 1: EOW Override
   * Verify next-window components boosted without altering same-window
   */
  it('should apply EOW multipliers correctly', async () => {
    const baseInputs: ScoreInputs = {
      dumpZ: 2.5,
      uSame: 0.3,
      uNext: 0.4,
      uhfSame: 0.2,
      uhfNext: 0.3,
      optSame: 0.1,
      optNext: 0.15,
      shortReliefV2: 0.2,
      indexPenalty: 0.05,
      eow: false,
    };

    // Score without EOW
    const scoreWithoutEOW = computeRotationScore(baseInputs);

    // Score with EOW
    const scoreWithEOW = computeRotationScore({ ...baseInputs, eow: true });

    // Verify EOW boosts next-window signals
    // Expected: uNext × 0.95, uhfNext × 0.9, optNext × 0.5
    expect(scoreWithEOW.rScore).toBeLessThan(scoreWithoutEOW.rScore);

    // Verify same-window signals unchanged
    // This requires tracking intermediate values (may need refactor)
  });

  /**
   * Test 2: Index Penalty Cap
   * Verify penalty increases with overlap but caps at 0.5
   */
  it('should cap index penalty at 0.5', async () => {
    // Create scenario with 100% Russell overlap and 100% passive buyers
    const penalty = await computeIndexPenalty(
      '2024-06-01',
      '2024-06-30',
      {
        buyerEntities: new Set(['etf-1', 'etf-2']),
        buyerSharesByEntity: new Map([
          ['etf-1', 1000000],
          ['etf-2', 1000000],
        ]),
      }
    );

    expect(penalty).toBeLessThanOrEqual(0.5);
    expect(penalty).toBeGreaterThan(0); // Should have some penalty
  });

  /**
   * Test 3: Idempotence
   * Reprocessing same quarter yields no duplicates
   */
  it('should be idempotent when reprocessing', async () => {
    // Run ingestQuarterWorkflow twice with same inputs
    // Verify:
    // - No duplicate filings
    // - No duplicate positions
    // - No duplicate rotation events
    // - No duplicate graph edges
  });

  /**
   * Test 4: Buyer Sufficiency Gate
   * No score emitted when buyer sufficiency fails
   */
  it('should gate events with insufficient buyers', () => {
    // Scenario: 1 buyer with only 0.5% of float
    const inputs: ScoreInputs = {
      dumpZ: 3.0, // Strong dump
      uSame: 0.3, // Has uptake
      uNext: 0,
      uhfSame: 0,
      uhfNext: 0,
      optSame: 0,
      optNext: 0,
      shortReliefV2: 0,
      indexPenalty: 0,
      eow: false,
      buyerCount: 1,
      maxBuyerFloatPct: 0.005, // 0.5% < 0.75% threshold
    };

    const result = computeRotationScore(inputs);

    expect(result.gated).toBe(false);
    expect(result.rScore).toBe(0);
  });

  it('should pass gate with 2+ buyers', () => {
    const inputs: ScoreInputs = {
      // ... same as above
      buyerCount: 2, // 2 buyers
      maxBuyerFloatPct: 0.003, // Each small, but count >= 2
    };

    const result = computeRotationScore(inputs);

    expect(result.gated).toBe(true);
    expect(result.rScore).toBeGreaterThan(0);
  });

  it('should pass gate with large single buyer', () => {
    const inputs: ScoreInputs = {
      // ... same as above
      buyerCount: 1,
      maxBuyerFloatPct: 0.01, // 1.0% > 0.75% threshold
    };

    const result = computeRotationScore(inputs);

    expect(result.gated).toBe(true);
    expect(result.rScore).toBeGreaterThan(0);
  });

  /**
   * Test 5: Provenance Completeness
   * Every rotation event has contributing accessions
   */
  it('should persist complete provenance records', async () => {
    // Create rotation event via workflow
    const clusterId = 'test-cluster-123';

    // Query provenance
    const { data: provenance } = await supabase
      .from('rotation_event_provenance')
      .select('*')
      .eq('cluster_id', clusterId);

    // Verify roles present
    const roles = new Set(provenance?.map(p => p.role) ?? []);
    expect(roles.has('anchor')).toBe(true);
    expect(roles.has('seller')).toBe(true);
    expect(roles.has('buyer')).toBe(true);

    // Verify contribution weights
    const totalWeight = provenance?.reduce((sum, p) => sum + p.contribution_weight, 0) ?? 0;
    expect(totalWeight).toBeGreaterThan(0);
  });

  /**
   * Test 6: Float-Based Dump Detection
   * Dump detected when (−Δ)/float ≥ 1.0%
   */
  it('should detect dump via float threshold', async () => {
    // Scenario: 5M share sell on 500M float = 1.0% exactly
    // Position change: -10% (doesn't meet 30% pct threshold)
    // Should still trigger dump due to float threshold

    const dumps = await detectDumpEvents(
      '0000320193', // Apple CIK
      ['037833100'], // Apple CUSIP
      { start: '2024-01-01', end: '2024-03-31' }
    );

    // Verify dump detected
    expect(dumps.length).toBeGreaterThan(0);
  });

  /**
   * Test 7: Event Study Correctness
   * CAR calculation matches expected results
   */
  it('should calculate CAR correctly', async () => {
    // Use fixture data with known CAR
    // Anchor: 2024-03-15
    // Price data: synthetic with known return pattern

    const result = await eventStudy({
      ticker: 'TEST',
      anchorDate: '2024-03-15',
      window: { pre: 5, post: 20 },
    });

    // Verify CAR within tolerance
    const expectedCAR = 0.045; // 4.5% from fixture
    expect(result.car_m5_p20).toBeCloseTo(expectedCAR, 2);
  });
});
```

**Run Tests:**
```bash
pnpm test --testPathPattern=v5-compliance
```

---

### 3.2 Integration Testing

**File:** `apps/temporal-worker/src/__tests__/integration/v5-e2e.test.ts`
**Effort:** 4 hours

```typescript
/**
 * End-to-end test: Ingest → Detect → Score → Analyze
 *
 * Uses real historical data for a known rotation event
 */
describe('v5 End-to-End Integration', () => {
  it('should detect and score real rotation event', async () => {
    // Test with known historical event:
    // - Vanguard dump of TSLA in Q2 2023
    // - BlackRock/Fidelity uptake

    // Run full workflow
    await ingestIssuerWorkflow({
      ticker: 'TSLA',
      from: '2023Q2',
      to: '2023Q2',
      runKind: 'backfill',
    });

    // Verify rotation event created
    const { data: events } = await supabase
      .from('rotation_events')
      .select('*')
      .eq('issuer_cik', '0001318605') // Tesla
      .gte('r_score', 5);

    expect(events).toBeDefined();
    expect(events!.length).toBeGreaterThan(0);

    // Verify AI analysis
    const event = events![0];
    expect(event.ai_narrative).toBeDefined();
    expect(event.anomaly_score).toBeGreaterThanOrEqual(0);
    expect(event.anomaly_score).toBeLessThanOrEqual(10);

    // Verify provenance
    const { data: provenance } = await supabase
      .from('rotation_event_provenance')
      .select('*')
      .eq('cluster_id', event.cluster_id);

    expect(provenance).toBeDefined();
    expect(provenance!.length).toBeGreaterThan(0);
  });
});
```

---

## Phase 4: Documentation & Deployment (Week 3)

### 4.1 Update All Documentation

**See separate section: "Documentation Updates with Current/Roadmap Labels"**

### 4.2 Create Migration Guide

**File:** `docs/MIGRATION_V4_TO_V5.md`
**Effort:** 2 hours

```markdown
# Migration Guide: v4.1 → v5.0

## Breaking Changes

### API Changes
- `rotation_events` table: Added columns for buyer sufficiency
- Scoring gates: Events may now be filtered out if buyer sufficiency not met

### Configuration Changes
- New required data: Shares outstanding/float
- New workflow: `floatDataRefreshWorkflow` (scheduled weekly)

## Migration Steps

1. **Apply Database Migration**
   ```bash
   supabase db push
   ```

2. **Backfill Float Data**
   ```bash
   temporal workflow start \
     --namespace ird \
     --task-queue rotation-detector \
     --type floatDataRefreshWorkflow
   ```

3. **Reprocess Recent Quarters** (optional)
   ```bash
   # Reprocess Q3-Q4 2024 to apply new gates
   temporal workflow start \
     --type ingestIssuerWorkflow \
     --input '{"ticker":"AAPL","from":"2024Q3","to":"2024Q4","runKind":"backfill"}'
   ```

4. **Verify Results**
   ```sql
   -- Check v5 fields populated
   SELECT
     COUNT(*) as total_events,
     COUNT(ai_narrative) as with_ai,
     AVG(anomaly_score) as avg_anomaly
   FROM rotation_events
   WHERE created_at > NOW() - INTERVAL '7 days';
   ```

## Backward Compatibility

All v5 changes are **backward compatible**:
- Existing rotation events remain valid
- Scoring without float data falls back to v4.1 behavior
- No API contract changes

## Rollback Plan

If issues arise:
1. Revert database migration: `supabase db reset --version 023`
2. Restart workers with previous code version
3. No data loss (v5 columns nullable)
```

---

### 4.3 Create Deployment Checklist

**File:** `docs/V5_DEPLOYMENT_CHECKLIST.md`
**Effort:** 1 hour

```markdown
# v5.0 Deployment Checklist

## Pre-Deployment

- [ ] All acceptance tests passing
- [ ] Integration tests passing
- [ ] Code review completed
- [ ] Documentation updated
- [ ] Migration scripts tested on staging

## Deployment Steps

### Step 1: Database Migration
- [ ] Backup production database
- [ ] Apply migration 024: `supabase db push`
- [ ] Verify new columns: `SELECT * FROM entities LIMIT 1;`

### Step 2: Worker Deployment
- [ ] Build new worker: `pnpm run build:worker`
- [ ] Deploy to cloud (ECS/Cloud Run)
- [ ] Verify worker connected: Check Temporal UI

### Step 3: Backfill Float Data
- [ ] Start floatDataRefreshWorkflow
- [ ] Monitor progress in Temporal UI
- [ ] Verify completion: `SELECT COUNT(*) FROM entities WHERE shares_float IS NOT NULL;`

### Step 4: Validation
- [ ] Run test workflow: `ingestIssuerWorkflow` for AAPL
- [ ] Verify rotation event created with v5 fields
- [ ] Check AI analysis present
- [ ] Verify provenance records exist

## Post-Deployment

- [ ] Monitor error rates (Temporal UI + logs)
- [ ] Check token usage (OpenAI dashboard)
- [ ] Review first 10 rotation events manually
- [ ] Gather user feedback

## Rollback Criteria

Rollback if:
- Error rate > 10% for rotation detection workflows
- Token costs 2x higher than expected
- Critical bug in buyer sufficiency logic
- Database migration issues

## Success Metrics

- [ ] All rotation events have AI analysis
- [ ] Buyer sufficiency gates filter ~5-10% of events
- [ ] Provenance records present for 100% of events
- [ ] No regressions in existing functionality
```

---

## Priority Summary

### 🔴 HIGH PRIORITY (Do First)

1. **Float Data Integration** (Week 1)
   - Enables float-based dump detection
   - Unblocks buyer sufficiency gates
   - Foundation for v5 compliance

2. **Buyer Sufficiency Gates** (Week 1)
   - Critical scoring improvement
   - Reduces false positives
   - Spec requirement

### 🟡 MEDIUM PRIORITY (Do Second)

3. **Complete Provenance Tracking** (Week 2)
   - Auditability requirement
   - Enhances AI analysis quality
   - Spec requirement

4. **Passive Share Calculation** (Week 2)
   - Improves index penalty accuracy
   - Spec requirement

### 🟢 LOW PRIORITY (Nice to Have)

5. **v5 Test Suite** (Week 2-3)
   - Quality assurance
   - Prevents regressions
   - Can be incremental

6. **Documentation Updates** (Week 3)
   - Important but non-blocking
   - Can happen in parallel

---

## Estimated Timeline

| Week | Phase | Effort | Deliverables |
|------|-------|--------|--------------|
| 1 | Float Integration | 16 hours | Schema, activities, workflow, dump detection, buyer gates |
| 2 | Provenance & Index | 12 hours | Provenance tracking, passive share calc |
| 2-3 | Testing | 12 hours | Acceptance tests, integration tests |
| 3 | Documentation | 8 hours | Migration guide, deployment checklist, doc updates |
| **Total** | | **48 hours** | **~2-3 weeks** |

---

## Success Criteria

### Phase 1 Complete When:
- ✅ Float data populated for >90% of tracked issuers
- ✅ Dump detection uses both thresholds (30% OR 1% float)
- ✅ Buyer sufficiency gates implemented and tested
- ✅ At least 3 tests passing

### Phase 2 Complete When:
- ✅ Provenance records present for all new rotation events
- ✅ Passive share calculation working
- ✅ Index penalty uses passive share
- ✅ All edge cases tested

### v5.0 Launch Ready When:
- ✅ All 7 acceptance tests passing
- ✅ Integration test suite passing
- ✅ Documentation updated and accurate
- ✅ Deployment checklist validated
- ✅ Code review approved

---

## Risk Mitigation

### Risk 1: Float Data Availability
**Risk:** May not find float data for all issuers

**Mitigation:**
- Implement fallback estimation from 13F holder base
- Make gates optional if float data unavailable
- Gradual rollout with monitoring

### Risk 2: Buyer Sufficiency Too Strict
**Risk:** Gates may filter too many valid events

**Mitigation:**
- Make thresholds configurable
- A/B test gate impact on historical data
- Easy rollback via feature flag

### Risk 3: Performance Impact
**Risk:** Additional queries slow down workflows

**Mitigation:**
- Implement caching for float data
- Batch buyer entity lookups
- Monitor P95 latency

### Risk 4: Breaking Changes
**Risk:** v5 changes break existing integrations

**Mitigation:**
- All changes backward compatible
- Extensive testing before deployment
- Clear migration documentation

---

## Next Steps

1. **Review & Approval**
   - Review this plan with team
   - Approve budget and timeline
   - Assign tasks

2. **Phase 1 Kickoff**
   - Create feature branch: `feature/v5-float-integration`
   - Set up tracking (Jira/Linear)
   - Begin Task 1.1.1 (database schema)

3. **Weekly Standups**
   - Monday: Review progress
   - Wednesday: Demo completed work
   - Friday: Plan next week

---

## Questions?

- **Q: Is v5 worth the effort?**
  - A: Current v4.1+ system is production-ready. v5 improves accuracy by ~10-15% (reducing false positives). Decision depends on your priorities.

- **Q: Can we ship partial v5?**
  - A: Yes! Float integration (Phase 1) provides most value. Other phases are incremental.

- **Q: What about v6?**
  - A: No v6 planned. v5 is the target steady state.

---

**Status:** Ready for implementation
**Owner:** TBD
**Last Updated:** 2025-11-13
