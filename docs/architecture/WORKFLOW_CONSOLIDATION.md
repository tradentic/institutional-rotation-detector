# Workflow Consolidation Plan

**Status:** Proposed
**Goal:** Reduce from 29 workflows to ~20 workflows
**Principle:** Consolidate redundant workflows while preserving all functionality through configuration parameters

---

## Executive Summary

**Current State:** 29 workflows
**Proposed State:** 20 workflows
**Reduction:** 9 workflows (-31%)

**Key Benefits:**
- Simplified mental model for developers
- Easier monitoring and debugging
- Reduced code duplication
- Lower maintenance burden
- Clearer workflow boundaries

**Preserved:**
- All functionality through configuration flags
- Backward compatibility via workflow aliases
- All business logic and features

---

## Consolidation Strategy

### Category 1: Options Flow Workflows (5 → 2)

**Current (5 workflows):**
- `optionsIngestWorkflow` - Full ingestion with all features
- `optionsMinimalIngestWorkflow` - Minimal 3-endpoint version
- `optionsBatchIngestWorkflow` - Batch multiple tickers
- `optionsDeepAnalysisWorkflow` - Deep analysis with Greeks
- `unusualOptionsActivityCronWorkflow` - Daily unusual activity

**Proposed (2 workflows):**

#### 1. `optionsIngestWorkflow` (CONSOLIDATED)
Merge: `optionsIngestWorkflow` + `optionsMinimalIngestWorkflow` + `optionsDeepAnalysisWorkflow`

**Rationale:**
- All three serve the same purpose (ingest options data) with different feature flags
- `optionsIngestWorkflow` already has comprehensive configuration
- Redundant to maintain 3 separate workflows

**New Interface:**
```typescript
interface OptionsIngestParams {
  ticker: string;
  date?: string;

  // Tier selection (replaces separate workflows)
  tier?: 'minimal' | 'standard' | 'deep';  // NEW

  // OR granular control (existing)
  includeContracts?: boolean;
  includeFlow?: boolean;
  includeAlerts?: boolean;
  includeGEX?: boolean;
  includeGreeks?: boolean;
  calculateMetrics?: boolean;
}
```

**Presets:**
- `tier: 'minimal'` → 3 API calls (replaces optionsMinimalIngestWorkflow)
- `tier: 'standard'` → Default behavior (current optionsIngestWorkflow)
- `tier: 'deep'` → Full Greeks + all features (replaces optionsDeepAnalysisWorkflow)

#### 2. `optionsCronWorkflow` (RENAMED + CONSOLIDATED)
Merge: `unusualOptionsActivityCronWorkflow` + batch functionality from `optionsBatchIngestWorkflow`

**Rationale:**
- Scheduled ingestion should be unified
- Batch processing can be handled by parent workflow spawning children
- Clear separation: on-demand (`optionsIngestWorkflow`) vs. scheduled (`optionsCronWorkflow`)

**New Interface:**
```typescript
interface OptionsCronInput {
  tickers?: string[];           // Default: all tracked tickers
  tier?: 'minimal' | 'standard'; // Default: minimal
  minPremium?: number;           // For unusual activity filtering
  schedule?: 'daily' | 'weekly'; // Default: daily
}
```

**Savings: 3 workflows eliminated**

---

### Category 2: Microstructure Workflows (6 → 4)

**Current (6 workflows):**
- `finraOtcWeeklyIngestWorkflow` - FINRA OTC data
- `iexDailyIngestWorkflow` - IEX volume data
- `offexRatioComputeWorkflow` - Off-exchange ratio calculation
- `flip50DetectWorkflow` - Flip50 event detection
- `shortInterestIngestWorkflow` - FINRA short interest
- `microstructureAnalysisWorkflow` - VPIN, Kyle's lambda

**Proposed (4 workflows):**

#### 1. `microstructureIngestWorkflow` (NEW CONSOLIDATED)
Merge: `finraOtcWeeklyIngestWorkflow` + `iexDailyIngestWorkflow` + `shortInterestIngestWorkflow`

**Rationale:**
- All three are data ingestion workflows for microstructure
- Often run together on same schedule
- Can be parallelized within single workflow

**New Interface:**
```typescript
interface MicrostructureIngestInput {
  symbols?: string[];
  fromDate?: string;
  toDate?: string;

  // Data sources (all enabled by default)
  includeFINRAOTC?: boolean;    // Weekly OTC transparency
  includeIEX?: boolean;          // Daily matched volume
  includeShortInterest?: boolean; // Semi-monthly short interest

  runKind?: 'backfill' | 'daily';
}
```

**Workflow Logic:**
1. Determine date ranges for each source (weekly vs daily vs semi-monthly)
2. Run ingestion activities in parallel
3. Aggregate results

#### 2. `offexRatioComputeWorkflow` (KEEP)
No changes - distinct computational workflow

#### 3. `flip50DetectWorkflow` (KEEP)
No changes - distinct event detection workflow

#### 4. `microstructureAnalysisWorkflow` (KEEP)
No changes - complex analysis workflow

**Savings: 2 workflows eliminated**

---

### Category 3: Graph Workflows (6 → 5)

**Current (6 workflows):**
- `graphBuildWorkflow` - Graph construction
- `graphSummarizeWorkflow` - Community detection
- `graphQueryWorkflow` - Graph traversal + queries
- `graphExploreWorkflow` - Multi-turn Q&A
- `crossCommunityAnalysisWorkflow` - Systemic patterns
- `clusterEnrichmentWorkflow` - Cluster narratives

**Proposed (5 workflows):**

#### Merge: `graphQueryWorkflow` + `graphExploreWorkflow` → `graphQueryWorkflow`

**Rationale:**
- Both perform graph queries with AI synthesis
- `graphExploreWorkflow` is just `graphQueryWorkflow` with multiple questions
- Can be unified with a `questions` array parameter

**New Interface:**
```typescript
interface GraphQueryInput {
  ticker?: string;
  cik?: string;
  from: string;
  to: string;
  hops: number;

  // Single question OR multiple (replaces graphExploreWorkflow)
  question?: string;          // Single query
  questions?: string[];       // Multi-turn exploration (NEW)

  runKind?: 'backfill' | 'daily' | 'query';
  edgeIds?: string[];
}
```

**Behavior:**
- If `questions` provided → Multi-turn CoT session (old graphExploreWorkflow)
- If `question` provided → Single query with synthesis
- If neither → Pure graph algorithms only

**Other workflows remain separate:**
- `graphBuildWorkflow` - Pure construction (no AI)
- `graphSummarizeWorkflow` - Community detection (specific algorithm)
- `crossCommunityAnalysisWorkflow` - Cross-cutting analysis (different scope)
- `clusterEnrichmentWorkflow` - Child workflow (called by rotationDetect)

**Savings: 1 workflow eliminated**

---

### Category 4: Scheduled Watchers (6 → 6)

**Current (6 workflows):**
- `edgarSubmissionsPollerWorkflow`
- `nportMonthlyTimerWorkflow`
- `etfDailyCronWorkflow`
- `finraShortPublishWorkflow`
- `form4DailyCronWorkflow`
- `unusualOptionsActivityCronWorkflow`

**Proposed: NO CHANGES**

**Rationale:**
- Each watcher monitors a distinct data source with different schedules
- Clear separation of concerns (one watcher per source)
- No redundancy to eliminate
- `unusualOptionsActivityCronWorkflow` moves to `optionsCronWorkflow` (handled in Category 1)

---

### Category 5: Core Workflows (4 → 4)

**Current (4 workflows):**
- `ingestIssuerWorkflow` - Parent orchestration
- `ingestQuarterWorkflow` - Quarter processing
- `rotationDetectWorkflow` - Rotation detection & scoring
- `eventStudyWorkflow` - Event study (CAR analysis)

**Proposed: NO CHANGES**

**Rationale:**
- Core business logic with clear boundaries
- Each serves distinct purpose in rotation detection pipeline
- Well-designed hierarchy (parent → child → grandchild)

---

### Category 6: Advanced Analytics (1 → 1)

**Current (1 workflow):**
- `statisticalAnalysisWorkflow`

**Proposed: NO CHANGES**

**Rationale:**
- Single specialized workflow
- No redundancy

---

### Category 7: Testing & Utilities (1 → 1)

**Current (1 workflow):**
- `testSearchAttributesWorkflow`

**Proposed: NO CHANGES**

**Rationale:**
- Test-only utility
- Keep for debugging

---

## Summary Table

| Category | Current | Proposed | Change | Workflows Eliminated |
|----------|---------|----------|--------|---------------------|
| Options Flow | 5 | 2 | -3 | `optionsMinimal`, `optionsDeep`, `optionsBatch` |
| Microstructure | 6 | 4 | -2 | `finraOtcWeekly`, `iexDaily`, `shortInterestIngest` (merged) |
| Graph | 6 | 5 | -1 | `graphExplore` (merged into `graphQuery`) |
| Scheduled Watchers | 6 | 5 | -1 | `unusualOptionsActivityCron` (merged) |
| Core Ingestion | 4 | 4 | 0 | - |
| Advanced Analytics | 1 | 1 | 0 | - |
| Testing | 1 | 1 | 0 | - |
| **TOTAL** | **29** | **20** | **-9** | **9 workflows consolidated** |

---

## Before & After

### Before (29 workflows)

```
Core (4):
├── ingestIssuerWorkflow
├── ingestQuarterWorkflow
├── rotationDetectWorkflow
└── eventStudyWorkflow

Graph (6):
├── graphBuildWorkflow
├── graphSummarizeWorkflow
├── graphQueryWorkflow
├── graphExploreWorkflow          ← CONSOLIDATE
├── crossCommunityAnalysisWorkflow
└── clusterEnrichmentWorkflow

Scheduled Watchers (6):
├── edgarSubmissionsPollerWorkflow
├── nportMonthlyTimerWorkflow
├── etfDailyCronWorkflow
├── finraShortPublishWorkflow
├── form4DailyCronWorkflow
└── unusualOptionsActivityCronWorkflow  ← CONSOLIDATE

Microstructure (6):
├── finraOtcWeeklyIngestWorkflow   ← CONSOLIDATE
├── iexDailyIngestWorkflow         ← CONSOLIDATE
├── shortInterestIngestWorkflow    ← CONSOLIDATE
├── offexRatioComputeWorkflow
├── flip50DetectWorkflow
└── microstructureAnalysisWorkflow

Options (5):
├── optionsIngestWorkflow
├── optionsMinimalIngestWorkflow   ← CONSOLIDATE
├── optionsBatchIngestWorkflow     ← CONSOLIDATE
├── optionsDeepAnalysisWorkflow    ← CONSOLIDATE
└── unusualOptionsActivityCronWorkflow (see Watchers)

Analytics (1):
└── statisticalAnalysisWorkflow

Testing (1):
└── testSearchAttributesWorkflow
```

### After (20 workflows)

```
Core (4):
├── ingestIssuerWorkflow
├── ingestQuarterWorkflow
├── rotationDetectWorkflow
└── eventStudyWorkflow

Graph (5):
├── graphBuildWorkflow
├── graphSummarizeWorkflow
├── graphQueryWorkflow             [+multi-turn support]
├── crossCommunityAnalysisWorkflow
└── clusterEnrichmentWorkflow

Scheduled Watchers (5):
├── edgarSubmissionsPollerWorkflow
├── nportMonthlyTimerWorkflow
├── etfDailyCronWorkflow
├── finraShortPublishWorkflow
└── form4DailyCronWorkflow

Microstructure (4):
├── microstructureIngestWorkflow   [NEW: FINRA+IEX+ShortInt]
├── offexRatioComputeWorkflow
├── flip50DetectWorkflow
└── microstructureAnalysisWorkflow

Options (2):
├── optionsIngestWorkflow          [+tier presets]
└── optionsCronWorkflow            [NEW: cron+batch]

Analytics (1):
└── statisticalAnalysisWorkflow

Testing (1):
└── testSearchAttributesWorkflow
```

---

## Migration Path

### Phase 1: Add Configuration Support (Week 1)

**Objective:** Extend existing workflows with new parameters without breaking changes

**Tasks:**
1. Add `tier` parameter to `optionsIngestWorkflow`
2. Add `questions[]` support to `graphQueryWorkflow`
3. Create new `microstructureIngestWorkflow` (parallel to old workflows)
4. Create new `optionsCronWorkflow` (parallel to old workflows)

**Impact:** Zero - additive changes only

---

### Phase 2: Deprecation Warnings (Week 2)

**Objective:** Mark old workflows as deprecated, log warnings

**Tasks:**
1. Add deprecation notice to workflow start
2. Log migration guidance to Temporal
3. Update documentation with "DEPRECATED" badges

**Example deprecation message:**
```typescript
// In optionsMinimalIngestWorkflow
console.warn(
  'DEPRECATED: optionsMinimalIngestWorkflow is deprecated. ' +
  'Use optionsIngestWorkflow with tier="minimal" instead. ' +
  'See docs/architecture/WORKFLOW_CONSOLIDATION.md for migration guide.'
);
```

**Impact:** Low - warnings only, no functional changes

---

### Phase 3: Update Callers (Week 3-4)

**Objective:** Migrate all internal callers to new workflows

**Tasks:**
1. Update scheduled cron jobs
2. Update parent workflows that spawn children
3. Update documentation and examples
4. Update tests

**Example migrations:**

**Before:**
```typescript
await client.workflow.execute(optionsMinimalIngestWorkflow, {
  args: [{ ticker: 'AAPL' }]
});
```

**After:**
```typescript
await client.workflow.execute(optionsIngestWorkflow, {
  args: [{
    ticker: 'AAPL',
    tier: 'minimal'  // Equivalent behavior
  }]
});
```

**Impact:** Medium - requires code changes but behavior unchanged

---

### Phase 4: Remove Deprecated Workflows (Week 5)

**Objective:** Delete old workflow files

**Tasks:**
1. Remove deprecated workflow files
2. Remove from workflow registration
3. Remove from exports
4. Archive old documentation

**Impact:** High - breaking change for external callers

**Mitigation:**
- Provide workflow aliases (Temporal feature) for backward compatibility
- Keep deprecation warnings active for 2 months before removal

---

## Backward Compatibility

### Workflow Aliases

Temporal supports workflow aliases to maintain backward compatibility:

```typescript
// In worker registration
export const workflows = {
  // New workflows
  optionsIngestWorkflow,
  optionsCronWorkflow,

  // Aliases for backward compatibility (deprecated)
  optionsMinimalIngestWorkflow: optionsIngestWorkflow,  // Alias
  optionsDeepAnalysisWorkflow: optionsIngestWorkflow,   // Alias
  optionsBatchIngestWorkflow: optionsCronWorkflow,      // Alias
};
```

**Behavior:**
- Old workflow names still work
- Route to new implementation
- Log deprecation warnings
- Remove after grace period (3 months)

---

## Testing Strategy

### Unit Tests

For each consolidated workflow, test all previous configurations:

```typescript
describe('optionsIngestWorkflow (consolidated)', () => {
  it('should work with tier=minimal (legacy optionsMinimalIngestWorkflow)', async () => {
    const result = await executeWorkflow(optionsIngestWorkflow, {
      ticker: 'AAPL',
      tier: 'minimal'
    });

    expect(result.apiCallsUsed).toBe(3);
  });

  it('should work with tier=deep (legacy optionsDeepAnalysisWorkflow)', async () => {
    const result = await executeWorkflow(optionsIngestWorkflow, {
      ticker: 'AAPL',
      tier: 'deep',
      maxExpirations: 3
    });

    expect(result.apiCallsUsed).toBeGreaterThan(7);
  });

  it('should work with granular flags (legacy behavior)', async () => {
    const result = await executeWorkflow(optionsIngestWorkflow, {
      ticker: 'AAPL',
      includeContracts: true,
      includeFlow: true,
      includeAlerts: false
    });

    expect(result.contractsIngested).toBeGreaterThan(0);
  });
});
```

### Integration Tests

Test end-to-end scenarios:
1. Scheduled cron → consolidated workflow
2. Parent workflow → consolidated child
3. Backward compatibility via aliases

---

## Monitoring & Metrics

### Key Metrics to Track

**Before Consolidation:**
```
workflow_executions_total{workflow="optionsMinimalIngestWorkflow"} 100
workflow_executions_total{workflow="optionsIngestWorkflow"} 50
workflow_executions_total{workflow="optionsDeepAnalysisWorkflow"} 20
```

**After Consolidation:**
```
workflow_executions_total{workflow="optionsIngestWorkflow",tier="minimal"} 100
workflow_executions_total{workflow="optionsIngestWorkflow",tier="standard"} 50
workflow_executions_total{workflow="optionsIngestWorkflow",tier="deep"} 20
```

### Dashboards

Update Temporal dashboards to:
1. Group by consolidated workflow name
2. Filter by `tier` parameter
3. Show migration progress (old vs new workflow usage)

---

## Benefits Analysis

### Developer Experience

**Before:**
- 29 workflows to understand
- Confusion about which workflow to use
- Code duplication across similar workflows

**After:**
- 20 workflows with clear purposes
- Configuration-driven behavior
- Single source of truth per feature

### Maintenance Burden

**Before:**
- Bug fix requires updating 3 options workflows
- Documentation scattered across multiple files
- Test coverage duplicated

**After:**
- Single workflow to fix
- Unified documentation
- Shared test suite

### Monitoring

**Before:**
- 29 workflow metrics to track
- Unclear which workflow failed
- Complex alerting rules

**After:**
- 20 workflow metrics
- Clear failure attribution
- Simplified alerts

---

## Risks & Mitigation

### Risk 1: Breaking Changes for External Callers

**Mitigation:**
- Workflow aliases for backward compatibility
- 3-month deprecation period with warnings
- Clear migration documentation
- Automated migration script

### Risk 2: Increased Workflow Complexity

**Concern:** Consolidated workflows have more parameters

**Mitigation:**
- Clear parameter presets (`tier: 'minimal'`)
- Comprehensive examples in documentation
- TypeScript types prevent misconfiguration
- Default values for all optional parameters

### Risk 3: Performance Regression

**Concern:** Unified workflow might be slower

**Mitigation:**
- Parallel execution of independent steps
- Early exit when features disabled
- Benchmarking before/after
- Rollback plan if performance degrades >10%

---

## Success Criteria

### Quantitative

- [x] Reduce from 29 to 20 workflows (-31%)
- [ ] Zero regression bugs after Phase 4
- [ ] <5% increase in average workflow duration
- [ ] 100% test coverage on consolidated workflows
- [ ] Zero support tickets about migration

### Qualitative

- [ ] Developers report improved clarity
- [ ] Documentation is simpler
- [ ] Monitoring is easier
- [ ] New contributors onboard faster

---

## Implementation Timeline

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| Phase 1: Add Configuration | Week 1 | New parameters, no breaking changes |
| Phase 2: Deprecation Warnings | Week 2 | Warnings logged, docs updated |
| Phase 3: Migrate Callers | Week 3-4 | All internal usage migrated |
| Phase 4: Remove Old Workflows | Week 5 | Deprecated workflows deleted |
| **Total** | **5 weeks** | **20 workflows, full compatibility** |

---

## Rollback Plan

If consolidation causes issues:

### Immediate Rollback (< 24 hours)
1. Revert workflow registration to include old workflows
2. Update scheduled crons to use old workflow names
3. Deploy worker with old workflows

### Long-term Rollback (> 24 hours)
1. Keep both old and new workflows in production
2. Gradually migrate back to old workflows
3. Document lessons learned
4. Revisit consolidation strategy

---

## Appendix A: Detailed Workflow Mappings

### Options Workflows

| Old Workflow | New Workflow | Configuration |
|-------------|--------------|---------------|
| `optionsMinimalIngestWorkflow` | `optionsIngestWorkflow` | `tier: 'minimal'` |
| `optionsIngestWorkflow` | `optionsIngestWorkflow` | `tier: 'standard'` (default) |
| `optionsDeepAnalysisWorkflow` | `optionsIngestWorkflow` | `tier: 'deep'` |
| `optionsBatchIngestWorkflow` | `optionsCronWorkflow` | `tickers: [...]` |
| `unusualOptionsActivityCronWorkflow` | `optionsCronWorkflow` | Default behavior |

### Microstructure Workflows

| Old Workflow | New Workflow | Configuration |
|-------------|--------------|---------------|
| `finraOtcWeeklyIngestWorkflow` | `microstructureIngestWorkflow` | `includeFINRAOTC: true` |
| `iexDailyIngestWorkflow` | `microstructureIngestWorkflow` | `includeIEX: true` |
| `shortInterestIngestWorkflow` | `microstructureIngestWorkflow` | `includeShortInterest: true` |
| All three | `microstructureIngestWorkflow` | All flags true (default) |

### Graph Workflows

| Old Workflow | New Workflow | Configuration |
|-------------|--------------|---------------|
| `graphQueryWorkflow` | `graphQueryWorkflow` | `question: "..."` (single) |
| `graphExploreWorkflow` | `graphQueryWorkflow` | `questions: [...]` (multi-turn) |

---

## Appendix B: Code Examples

### Example 1: Options Ingestion

**Before (3 separate workflows):**

```typescript
// Minimal ingestion
await client.workflow.execute(optionsMinimalIngestWorkflow, {
  workflowId: 'options-minimal-AAPL',
  args: [{ ticker: 'AAPL' }]
});

// Standard ingestion
await client.workflow.execute(optionsIngestWorkflow, {
  workflowId: 'options-standard-AAPL',
  args: [{
    ticker: 'AAPL',
    includeContracts: true,
    includeFlow: true
  }]
});

// Deep analysis
await client.workflow.execute(optionsDeepAnalysisWorkflow, {
  workflowId: 'options-deep-AAPL',
  args: [{
    ticker: 'AAPL',
    maxExpirations: 3
  }]
});
```

**After (1 workflow with tiers):**

```typescript
// Minimal ingestion
await client.workflow.execute(optionsIngestWorkflow, {
  workflowId: 'options-AAPL-minimal',
  args: [{
    ticker: 'AAPL',
    tier: 'minimal'
  }]
});

// Standard ingestion
await client.workflow.execute(optionsIngestWorkflow, {
  workflowId: 'options-AAPL-standard',
  args: [{
    ticker: 'AAPL',
    tier: 'standard'  // or omit (default)
  }]
});

// Deep analysis
await client.workflow.execute(optionsIngestWorkflow, {
  workflowId: 'options-AAPL-deep',
  args: [{
    ticker: 'AAPL',
    tier: 'deep',
    maxExpirations: 3
  }]
});
```

---

### Example 2: Microstructure Ingestion

**Before (3 separate workflows):**

```typescript
// FINRA OTC
await client.workflow.execute(finraOtcWeeklyIngestWorkflow, {
  args: [{
    symbols: ['AAPL'],
    fromWeek: '2024-01-05',
    toWeek: '2024-01-26'
  }]
});

// IEX Daily
await client.workflow.execute(iexDailyIngestWorkflow, {
  args: [{
    symbols: ['AAPL'],
    from: '2024-01-01',
    to: '2024-01-31'
  }]
});

// Short Interest
await client.workflow.execute(shortInterestIngestWorkflow, {
  args: [{
    symbols: ['AAPL'],
    fromDate: '2024-01-01',
    toDate: '2024-01-31'
  }]
});
```

**After (1 workflow, parallel execution):**

```typescript
// All microstructure data at once
await client.workflow.execute(microstructureIngestWorkflow, {
  args: [{
    symbols: ['AAPL'],
    fromDate: '2024-01-01',
    toDate: '2024-01-31',
    // All sources enabled by default
    includeFINRAOTC: true,
    includeIEX: true,
    includeShortInterest: true
  }]
});

// Or selectively
await client.workflow.execute(microstructureIngestWorkflow, {
  args: [{
    symbols: ['AAPL'],
    fromDate: '2024-01-01',
    toDate: '2024-01-31',
    includeFINRAOTC: true,   // Only FINRA
    includeIEX: false,
    includeShortInterest: false
  }]
});
```

---

## Appendix C: Migration Checklist

### For Platform Team

- [ ] Implement new parameters in target workflows
- [ ] Add deprecation warnings to old workflows
- [ ] Create workflow aliases for backward compatibility
- [ ] Update worker registration
- [ ] Update monitoring dashboards
- [ ] Update alerting rules
- [ ] Write migration tests
- [ ] Update documentation
- [ ] Prepare rollback plan

### For Application Developers

- [ ] Review workflow consolidation plan
- [ ] Identify usage of deprecated workflows
- [ ] Update workflow calls to use new parameters
- [ ] Update scheduled cron jobs
- [ ] Test changes in staging
- [ ] Monitor for errors after deployment
- [ ] Remove old workflow calls after grace period

---

## Questions & Answers

**Q: Will this break existing scheduled workflows?**

A: No. Workflow aliases ensure backward compatibility during migration period.

**Q: What if I need the old behavior exactly?**

A: All old behavior is preserved through configuration parameters.

**Q: When will deprecated workflows be removed?**

A: After 3-month grace period with active deprecation warnings.

**Q: Can I still use the old workflow names?**

A: Yes, via workflow aliases, but you'll see deprecation warnings.

**Q: What's the benefit of this consolidation?**

A: Simpler codebase, easier maintenance, clearer mental model, less duplication.

---

## References

- [WORKFLOWS.md](./WORKFLOWS.md) - Current workflow documentation
- [Requirements Alignment Review](../review-requirements-alignment.md) - Original analysis
- [Temporal Workflow Aliases](https://docs.temporal.io/workflows#workflow-type) - Backward compatibility
- [Configuration Patterns](https://docs.temporal.io/dev-guide/typescript/foundations#workflow-parameters) - Best practices

---

**Document Owner:** Platform Team
**Last Updated:** 2025-01-13
**Status:** Proposed - Pending Approval
