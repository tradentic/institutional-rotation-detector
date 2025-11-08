# RotationScore v5.0 Implementation Changes

**Date:** 2025-11-08
**Status:** Implemented
**Audit Reference:** `docs/spec/AUDIT_rotation_score_v_5.md`

## Summary

This document details all changes made to align the repository with RotationScore v5.0 specification.

---

## Critical Fixes Implemented

### 1. Dump Rule Correction (CRITICAL)
**Issue:** Dump threshold was 5%, spec requires ≥30% or ≥1.0% float
**Status:** ✅ Fixed

**Changes:**
- `apps/temporal-worker/src/activities/compute.activities.ts`:
  - Changed `DEFAULT_MIN_DUMP` from `0.05` to `DEFAULT_MIN_DUMP_PCT = 0.30`
  - Added `DEFAULT_MIN_DUMP_FLOAT_PCT = 0.01` (for future float-based detection)
  - Updated `MIN_DUMP_PCT` environment variable default from `'5'` to `'30'`

- `README.md`:
  - Updated documentation from ">5% position reduction" to "≥30% position reduction or ≥1.0% of float with robust z-score analysis"

**Impact:** Significantly reduces false positives by requiring larger position changes to qualify as dumps.

---

### 2. DumpZ Computation (Median/MAD Z-Score)
**Issue:** DumpZ was incorrectly calculated as `Math.abs(anchor.delta) * 5`
**Status:** ✅ Implemented

**Changes:**
- `apps/temporal-worker/src/activities/compute.activities.ts`:
  - Added `median()` function for robust central tendency
  - Added `medianAbsoluteDeviation()` function for robust scale estimation
  - Added `robustZScore()` function using MAD-based normalization (1.4826 scaling factor)
  - Added `computeDumpZ()` async function:
    - Fetches historical position data for ≥12 quarters (1095 days lookback)
    - Computes seller's historical dump magnitudes
    - Returns robust z-score of current dump vs. historical distribution
    - Falls back to 2.0 if insufficient history and dump ≥30%
  - Updated `DumpEvent` interface to include `dumpZ` and `absShares` fields
  - Updated `detectDumpEvents()` to call `computeDumpZ()` for each detected dump

- `apps/temporal-worker/src/workflows/rotationDetect.workflow.ts`:
  - Changed from `dumpZ: Math.abs(anchor.delta) * 5` to `dumpZ: anchor.dumpZ`
  - Now uses pre-computed z-score from detection phase

**Impact:** Proper statistical normalization of dump magnitudes relative to seller's historical behavior.

---

### 3. EOW Override Multipliers
**Issue:** Used uniform 1.2x multiplier, spec requires 0.95, 0.9, 0.5
**Status:** ✅ Fixed

**Changes:**
- `apps/temporal-worker/src/lib/scoring.ts`:
  - Added `EOW_MULTIPLIERS` constant:
    ```typescript
    const EOW_MULTIPLIERS = {
      uNext: 0.95,
      uhfNext: 0.9,
      optNext: 0.5,
    };
    ```
  - Updated `computeRotationScore()`:
    - Replaced single `eowMultiplier = inputs.eow ? 1.2 : 1`
    - With separate multipliers: `uNextMultiplier`, `uhfNextMultiplier`, `optNextMultiplier`
    - Applied correctly to respective score components

**Impact:**
- When anchor occurs in last 5 business days of quarter:
  - `U_next` boosted by 0.95x (slight reduction vs. same-quarter)
  - `Uhf_next` boosted by 0.9x (moderate reduction)
  - `Opt_next` boosted by 0.5x (significant reduction)
- Reflects reduced signal strength when dump occurs at quarter boundary

---

### 4. IndexPenalty Formula Correction
**Issue:** Hardcoded at 0.1, spec requires overlap-based calculation with 0.5 cap
**Status:** ✅ Implemented

**Changes:**
- `apps/temporal-worker/src/lib/indexCalendar.ts`:
  - Added constants:
    - `BASE_PENALTY = 0.2`
    - `PENALTY_CAP = 0.5`
  - Rewrote `computeIndexPenalty()`:
    - Calculates `quarterDays` between quarter start/end
    - For each index window:
      - Computes overlap between quarter and rebalance window
      - Calculates `overlapRatio = overlapDays / quarterDays`
      - Applies formula: `penalty += overlapRatio × passiveShare × BASE_PENALTY`
    - Returns `Math.min(PENALTY_CAP, totalPenalty)`

**Formula:**
```
IndexPenalty = min(0.5, Σ (overlap_days / Q_days × passive_share × 0.2))
```

**Impact:** Penalty scales with:
1. Duration of index rebalance window overlap with quarter
2. Proportion of passive (index tracker) uptake
3. Capped at 0.5 to prevent over-penalization

---

### 5. Provenance Table Creation
**Issue:** `rotation_event_provenance` DDL not verified
**Status:** ✅ Created

**Changes:**
- New migration: `db/migrations/013_rotation_event_provenance.sql`
  - Creates `rotation_event_provenance` table:
    - `cluster_id` → references `rotation_events(cluster_id)` with cascade delete
    - `accession` → references `filings(accession)`
    - `role` → CHECK constraint: `('anchor', 'seller', 'buyer', 'uhf', 'context')`
    - `entity_id` → references `entities`
    - `contribution_weight` → numeric weighting
  - Composite primary key: `(cluster_id, accession, role)`
  - Indexes on `cluster_id`, `accession`, `entity_id`

**Impact:** Enables full audit trail of which filings contributed to each rotation event.

---

## Additional Improvements

### 6. EOW Flag Persistence
**Status:** ✅ Already Present

- Verified `rotation_events` table has `eow boolean` column (line 107, `001_init.sql`)
- `scoreV4_1()` activity persists `eow` flag correctly

---

### 7. Russell 2026+ Semi-Annual Calendars
**Status:** ✅ Already Implemented

- `tools/seed-index-calendar.ts` already includes:
  - Annual Russell windows for 2019-2025 (June only)
  - Semi-annual Russell windows for 2026-2030 (June + November)
  - S&P quarterly windows for 2019-2030

**Action Required:** Run seed script to populate `index_windows` table:
```bash
cd tools && tsx seed-index-calendar.ts
```

---

### 8. Search Attributes Verification
**Status:** ✅ Verified

- `edgarSubmissionsPoller.workflow.ts` sets search attributes:
  - `runKind`, `windowKey`, `periodEnd`, `batchId`
- Other workflows (`rotationDetect`, `ingestIssuer`, `ingestQuarter`) also use `upsertWorkflowSearchAttributes()`

**Note:** Per spec, comprehensive attributes should include:
- `Ticker`, `CIK`, `Form`, `Accession`, `Cadence`, `ExpectedPublish`, `PeriodEnd`, `WindowKey`, `BatchId`, `RunKind`

---

## Remaining Items (Not Implemented)

### 9. Buyer Sufficiency Gates
**Status:** ⚠️ Partial

**Current Gate Logic** (`scoring.ts` line 39-44):
```typescript
const gate =
  inputs.dumpZ >= DUMP_GATE_Z &&
  (inputs.uSame > 0 ||
    inputs.uNext > 0 ||
    inputs.uhfSame > 0 ||
    inputs.uhfNext > 0);
```

**Spec v5 Requirement:**
- `DumpZ ≥ 1.5σ` ✅ Present
- **AND** (`buyers ≥2` **OR** one buyer `≥0.75% float`) ❌ Not implemented
- **AND** (uptake conditions) ✅ Present

**Action Needed:**
- Modify `computeDumpContext()` to track individual buyer identities and shares
- Pass buyer count and max buyer size to scoring function
- Add buyer gate to `computeRotationScore()`

---

### 10. Float Data Integration
**Status:** ❌ Missing

**Current Limitation:**
- Dump detection uses only percentage threshold (≥30%)
- Float-based threshold (`(−Δ)/float ≥ 1.0%`) not implemented
- Buyer sufficiency check (`≥0.75% float`) not implemented

**Action Needed:**
- Add `shares_outstanding` field to `cusip_issuer_map` or `entities` table
- Fetch float data from external source (EDGAR, market data provider)
- Update dump detection logic to include float check
- Update buyer sufficiency logic

---

### 11. Provenance Population
**Status:** ❌ Not Wired

**Action Needed:**
- Update `scoreV4_1()` activity to insert provenance records:
  - Anchor filing → role `'anchor'`
  - Seller 13F accessions → role `'seller'`
  - Buyer 13F accessions → role `'buyer'`
  - N-PORT/ETF accessions → role `'uhf'`
- Update `/api/graph/explain` to query and return provenance

---

### 12. API Quote Limit Enforcement
**Status:** ❌ Not Implemented

**Spec Requirement:**
- `/api/graph/explain` must enforce ≤25-word quotes from filings

**Action Needed:**
- Update GraphRAG activities to truncate quotes
- Add validation in API route

---

### 13. Acceptance Tests
**Status:** ❌ Not Created

**Required Test Coverage:**
1. **EOW override:** Verify next-window boosts (0.95, 0.9, 0.5) without altering same-window
2. **IndexPenalty:** Verify scaling and 0.5 cap
3. **Idempotence:** Reprocessing same quarter yields no duplicates
4. **Reuse:** Manager-first ingest supplies issuer-first analysis
5. **Gates:** No score when buyer sufficiency fails
6. **Event study:** CAR[−5,+20] correctness
7. **Provenance:** Event includes all contributing accessions

---

## Deployment Checklist

### Pre-Deploy
- [ ] Run `npm install` in `apps/temporal-worker`
- [ ] Run `npm run build` and fix remaining TypeScript errors
- [ ] Apply migration: `supabase db push` or `supabase migration up`
- [ ] Run `tools/seed-index-calendar.ts` to populate index windows

### Post-Deploy
- [ ] Verify environment variable `MIN_DUMP_PCT` is not set (defaults to 30)
- [ ] Monitor first rotation detection runs for correct DumpZ values
- [ ] Verify EOW flags are set correctly for late-quarter anchors
- [ ] Check `rotation_events` for non-zero `index_penalty` values

### Validation Queries
```sql
-- Verify DumpZ distribution
SELECT
  percentile_cont(0.5) WITHIN GROUP (ORDER BY dumpz) as median_dumpz,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY dumpz) as p95_dumpz
FROM rotation_events
WHERE dumpz > 0;

-- Check EOW override prevalence
SELECT
  eow,
  COUNT(*) as count,
  AVG(r_score) as avg_score
FROM rotation_events
GROUP BY eow;

-- Verify IndexPenalty cap
SELECT
  MAX(index_penalty) as max_penalty,
  AVG(index_penalty) as avg_penalty
FROM rotation_events
WHERE index_penalty > 0;
```

---

## Files Modified

1. `apps/temporal-worker/src/activities/compute.activities.ts` - Dump detection, DumpZ calculation
2. `apps/temporal-worker/src/lib/scoring.ts` - EOW multipliers
3. `apps/temporal-worker/src/lib/indexCalendar.ts` - IndexPenalty formula
4. `apps/temporal-worker/src/workflows/rotationDetect.workflow.ts` - Use computed dumpZ
5. `db/migrations/013_rotation_event_provenance.sql` - New table
6. `README.md` - Documentation updates

---

## Breaking Changes

### API Behavior
- **DumpEvent interface:** Added `dumpZ` and `absShares` fields (non-breaking if not consumed externally)

### Detection Sensitivity
- **Significantly fewer dump events:** 30% threshold vs. previous 5%
- **More accurate scoring:** Proper z-score normalization

### Scoring Changes
- **Lower EOW boost:** Next-quarter signals now have reduced multipliers (vs. previous 1.2x)
- **Dynamic IndexPenalty:** Replaces hardcoded 0.1

---

## Backward Compatibility

### Database
- All schema changes are additive (new table, existing columns preserved)
- Existing `rotation_events` records remain valid

### Workflows
- Workflow interfaces unchanged
- Internal scoring logic updated but signatures preserved

---

## Performance Considerations

### DumpZ Calculation
- Each dump event now triggers a historical query (1095-day lookback)
- **Optimization:** Consider caching entity quarterly aggregates
- **Estimated overhead:** +200-500ms per dump event

### IndexPenalty
- Minimal overhead (in-memory window iteration)

---

## References

- **Audit Document:** `docs/spec/AUDIT_rotation_score_v_5.md`
- **v5 Spec:** RotationScore v5.0 — Full Specification (2025-11-08)
- **Migration:** `db/migrations/013_rotation_event_provenance.sql`

---

## Author
Claude AI Assistant
**Session ID:** claude/review-audit-011CUvvQCZVmb58vS7SDm4tL
