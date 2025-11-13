# GPT-5 Optimization Implementation Plan

> **⚠️ STATUS: ✅ COMPLETED (2025-11-10)**
> **This document is archived for historical reference.**
> **AI-powered rotation analysis is now fully implemented in production.**
> **See:** `apps/temporal-worker/src/activities/rotation-analysis.activities.ts`

**Original Status:** Ready for Implementation
**Completion Date:** 2025-11-10
**Estimated Effort:** 2-3 weeks
**Actual Effort:** ~2 weeks
**Expected Impact:** 10x improvement in actionable intelligence, 60%+ token cost reduction
**Achieved:** ✅ AI analysis live, 60-80% token savings via CoT

---

## ✅ What Was Implemented

**Phase 2: Rotation Event Analysis** — ✅ **COMPLETED**
- Created `rotation-analysis.activities.ts` with 4-turn CoT analysis
- Integrated into `rotationDetectWorkflow`
- Database schema updated with AI analysis fields
- All rotation events now receive AI-powered analysis

**Key Features Live:**
- ✅ Anomaly detection (0-10 scale)
- ✅ Suspicion flags (HIGH_ANOMALY, EXTREME_DUMP, etc.)
- ✅ Narrative generation with filing citations
- ✅ Trading implications with confidence levels
- ✅ 60-80% token savings via Chain of Thought

**Files:**
- `apps/temporal-worker/src/activities/rotation-analysis.activities.ts` (263 lines)
- `apps/temporal-worker/src/workflows/rotationDetect.workflow.ts` (integrated at line 109)
- Database migration 20251111 (ai_narrative, anomaly_score, etc.)

---

## ⏸️ What Was Not Implemented

**Phase 1: Foundation** — ⏸️ **DEFERRED**
- Upgrading longcontext/graphrag activities to explicit config
- Reason: Current implementation works well; not urgent

**Phase 3: Enhanced Filing Context** — ⏸️ **DEFERRED**
- Filing excerpts in cluster summaries
- Reason: Can be incremental improvement later

**Phase 4: Interactive Graph Exploration** — ⏸️ **PARTIAL**
- `graphExploreWorkflow` exists and works
- Could be enhanced with CoT sessions

**Phase 5: E2B Code Execution** — ⏸️ **DEFERRED**
- Statistical analysis workflow exists (`statisticalAnalysisWorkflow`)
- E2B integration not prioritized

---

## Original Plan (For Historical Reference)

---

## Phase 1: Foundation (Week 1)

**Goal:** Upgrade existing GPT-5 activities to modern API with explicit configuration

### Task 1.1: Upgrade longcontext.activities.ts

**Effort:** 2 hours
**Priority:** HIGH

**Changes:**
- Replace `createGPT5Client()` + `runResponses()` with `createClient()`
- Add explicit `reasoning: { effort: 'medium' }` for long context
- Add explicit `text: { verbosity: 'medium' }`
- Use 'gpt-5' model (not 'gpt-4.1') for long context synthesis

**File:** `apps/temporal-worker/src/activities/longcontext.activities.ts:102-156`

**Test:** Run `graphQueryWorkflow` with test data, verify output quality unchanged, check token usage

### Task 1.2: Upgrade graphrag.activities.ts

**Effort:** 1 hour
**Priority:** HIGH

**Changes:**
- Replace `createGPT5Client()` + `runResponses()` with `createClient()`
- Add explicit `reasoning: { effort: 'minimal' }` for community summaries
- Add explicit `text: { verbosity: 'low' }`
- Use 'gpt-5-mini' model (not 'gpt-4.1')

**File:** `apps/temporal-worker/src/activities/graphrag.activities.ts:86-141`

**Test:** Run `graphSummarizeWorkflow` with test data, verify summaries are concise

### Task 1.3: Verify filing-chunks.activities.ts

**Effort:** 30 minutes
**Priority:** LOW

**Changes:**
- Already uses `runResponse()` with explicit config ✅
- No changes needed, just verify

**File:** `apps/temporal-worker/src/activities/filing-chunks.activities.ts:166-172`

**Test:** Run `clusterEnrichmentWorkflow`, verify it still works

### Task 1.4: Update Tests

**Effort:** 2 hours
**Priority:** MEDIUM

**Changes:**
- Update tests for `longcontext.activities.ts`
- Update tests for `graphrag.activities.ts`
- Add token usage assertions

**Files:** `apps/temporal-worker/src/__tests__/`

---

## Phase 2: Rotation Event Analysis (Week 1-2)

**Goal:** Add AI-powered analysis to rotation detection workflow

### Task 2.1: Create rotation-analysis.activities.ts

**Effort:** 1 day
**Priority:** HIGH

**Changes:**
- Create new file: `apps/temporal-worker/src/activities/rotation-analysis.activities.ts`
- Implement `analyzeRotationEvent()` activity
- Use `createAnalysisSession()` with CoT
- Multi-step analysis: signal assessment → anomaly check → narrative → implications

**Dependencies:** Phase 1 complete

**Test:**
```bash
# Manual test with actual rotation event
temporal activity test \
  --activity analyzeRotationEvent \
  --input '{"clusterId":"...","issuerCik":"...","signals":{...}}'
```

### Task 2.2: Modify rotationDetect.workflow.ts

**Effort:** 2 hours
**Priority:** HIGH

**Changes:**
- Add `analyzeRotationEvent` to activity proxy
- Call after `scoreV4_1` for each anchor
- Store results (decide: extend `rotation_events` table or create `rotation_analysis` table)

**File:** `apps/temporal-worker/src/workflows/rotationDetect.workflow.ts:72-126`

**Test:** Run end-to-end rotation detection on test issuer, verify analysis is generated

### Task 2.3: Database Schema Update

**Effort:** 1 hour
**Priority:** HIGH

**Changes:**
- Decide on schema (extend existing or new table)
- Option A: Add columns to `rotation_events`:
  - `anomaly_score` (numeric)
  - `suspicion_flags` (jsonb)
  - `ai_narrative` (text)
  - `trading_implications` (text)
  - `ai_confidence` (numeric)
- Option B: Create new `rotation_analysis` table with FK to `rotation_events`

**Recommendation:** Option A (simpler, keeps data together)

**Migration:**
```sql
ALTER TABLE rotation_events
ADD COLUMN anomaly_score NUMERIC,
ADD COLUMN suspicion_flags JSONB,
ADD COLUMN ai_narrative TEXT,
ADD COLUMN trading_implications TEXT,
ADD COLUMN ai_confidence NUMERIC;

CREATE INDEX idx_rotation_events_anomaly_score ON rotation_events(anomaly_score);
CREATE INDEX idx_rotation_events_suspicion_flags ON rotation_events USING GIN(suspicion_flags);
```

### Task 2.4: Update Activity to Store Results

**Effort:** 30 minutes
**Priority:** MEDIUM

**Changes:**
- Modify `analyzeRotationEvent()` to store results in database
- Return analysis result to workflow

**Test:** Verify data is written correctly to database

### Task 2.5: Integration Testing

**Effort:** 4 hours
**Priority:** HIGH

**Tests:**
1. Run `rotationDetectWorkflow` on known rotation event
2. Verify analysis is generated and stored
3. Check token usage is reasonable (<5K tokens per analysis)
4. Manually review quality of narratives
5. Verify anomaly detection catches known edge cases

**Success Criteria:**
- ✅ Analysis generated for 100% of rotation events
- ✅ Narratives are actionable and accurate
- ✅ Anomaly detection identifies suspicious patterns
- ✅ Token usage <5K per event
- ✅ No workflow failures

---

## Phase 3: Enhanced Filing Context (Week 2)

**Goal:** Enrich cluster summaries with filing excerpts

### Task 3.1: Modify createClusterSummary

**Effort:** 3 hours
**Priority:** MEDIUM

**Changes:**
- Fetch filing chunks for top 3 accessions
- Include excerpts in prompt
- Increase max tokens to 400

**File:** `apps/temporal-worker/src/activities/filing-chunks.activities.ts:110-198`

**Test:** Compare summaries before/after, verify they're more detailed and cite filings

---

## Phase 4: Interactive Graph Exploration (Week 2-3)

**Goal:** Enable multi-turn graph Q&A with CoT

### Task 4.1: Create graph-exploration.activities.ts

**Effort:** 1 day
**Priority:** MEDIUM

**Changes:**
- Create new file: `apps/temporal-worker/src/activities/graph-exploration.activities.ts`
- Implement `exploreGraph()` activity
- Use `createAnalysisSession()` with graph context
- Support multiple questions with CoT preserved

**Test:** Test with series of related questions, verify context is maintained

### Task 4.2: Create graphExploreWorkflow

**Effort:** 2 hours
**Priority:** MEDIUM

**Changes:**
- Create new file: `apps/temporal-worker/src/workflows/graphExplore.workflow.ts`
- Orchestrate graph exploration
- Support interactive Q&A

**Test:** Run workflow with test questions

### Task 4.3: API Endpoint for Interactive Exploration

**Effort:** 4 hours
**Priority:** LOW

**Changes:**
- Add REST endpoint: `POST /api/graph/explore`
- Support session management
- Return exploration results

**File:** `apps/api/src/routes/graph.routes.ts` (if exists)

---

## Phase 5: E2B Code Execution (Optional - Week 3+)

**Goal:** Enable statistical analysis on large datasets

### Task 5.1: Add E2B to Rotation Analysis

**Effort:** 2 days
**Priority:** LOW

**Changes:**
- Modify `analyzeRotationEvent()` to enable E2B
- Allow GPT-5 to generate and execute Python for:
  - Correlation analysis across rotation participants
  - Statistical tests (t-tests, chi-square)
  - Custom metrics calculation
- Use `executeAndAnalyze()` pattern

**Test:** Verify E2B executes correctly, results are analyzed

### Task 5.2: Create Statistical Analysis Workflow

**Effort:** 3 days
**Priority:** LOW

**Changes:**
- Create new workflow for ad-hoc statistical analysis
- Support user-defined questions
- Execute Python code on rotation/graph data
- Return analysis with visualizations (if possible)

---

## Testing Strategy

### Unit Tests

For each new activity:
```typescript
// apps/temporal-worker/src/__tests__/rotation-analysis.test.ts
import { analyzeRotationEvent } from '../activities/rotation-analysis.activities';

describe('analyzeRotationEvent', () => {
  it('should generate analysis for valid rotation event', async () => {
    const result = await analyzeRotationEvent({
      clusterId: 'test-cluster',
      issuerCik: '0000320193',
      signals: {
        dumpZ: 2.5,
        uSame: 0.3,
        uNext: 0.4,
        // ...
        rScore: 8.5,
      },
    });

    expect(result.anomalyScore).toBeGreaterThanOrEqual(0);
    expect(result.anomalyScore).toBeLessThanOrEqual(10);
    expect(result.narrative).toBeTruthy();
    expect(result.tradingImplications).toBeTruthy();
  });

  it('should detect high anomaly scores for suspicious patterns', async () => {
    const result = await analyzeRotationEvent({
      clusterId: 'suspicious-cluster',
      issuerCik: '0000320193',
      signals: {
        dumpZ: 10.0, // Extreme
        uSame: 0.0,  // No uptake
        uNext: 0.0,
        // ...
        rScore: 12.0,
      },
    });

    expect(result.anomalyScore).toBeGreaterThan(7);
    expect(result.suspicionFlags).toContain('HIGH_ANOMALY');
  });
});
```

### Integration Tests

```typescript
// apps/temporal-worker/src/__tests__/rotationDetect.integration.test.ts
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { rotationDetectWorkflow } from '../workflows/rotationDetect.workflow';

describe('rotationDetectWorkflow integration', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createLocal();
  });

  afterAll(async () => {
    await testEnv?.teardown();
  });

  it('should generate AI analysis for detected rotations', async () => {
    const { client } = testEnv;

    const handle = await client.workflow.start(rotationDetectWorkflow, {
      args: [{
        cik: '0000320193',
        cusips: ['037833100'],
        quarter: '2024Q1',
        ticker: 'AAPL',
        runKind: 'backfill',
        quarterStart: '2024-01-01',
        quarterEnd: '2024-03-31',
      }],
      taskQueue: 'test',
      workflowId: 'test-rotation-detect',
    });

    await handle.result();

    // Verify analysis was created in database
    // (would need Supabase mock or test database)
  });
});
```

### Performance Tests

```typescript
// apps/temporal-worker/src/__tests__/performance.test.ts
import { analyzeRotationEvent } from '../activities/rotation-analysis.activities';

describe('Performance tests', () => {
  it('should complete rotation analysis in <10 seconds', async () => {
    const start = Date.now();

    await analyzeRotationEvent({
      clusterId: 'test-cluster',
      issuerCik: '0000320193',
      signals: {/* ... */},
    });

    const duration = Date.now() - start;
    expect(duration).toBeLessThan(10000); // 10 seconds
  });

  it('should use <5000 tokens for typical analysis', async () => {
    // Would need to instrument activity to track token usage
    // via session.getSummary()
  });
});
```

---

## Rollout Plan

### Stage 1: Dark Launch (Week 1)
- Deploy Phase 1 upgrades to production
- Monitor token usage and quality
- No user-facing changes

**Success Criteria:**
- ✅ No regressions in existing workflows
- ✅ Token usage similar or reduced
- ✅ Output quality unchanged

### Stage 2: Rotation Analysis Beta (Week 2)
- Deploy Phase 2 to production
- Generate analyses but don't expose to users yet
- Monitor quality and accuracy

**Success Criteria:**
- ✅ Analyses generated for all rotation events
- ✅ <5% failure rate
- ✅ Manual review shows >80% quality

### Stage 3: Full Launch (Week 3)
- Expose rotation analysis in UI/API
- Add graph exploration capability
- Monitor usage and feedback

**Success Criteria:**
- ✅ Users find analyses valuable
- ✅ Token costs within budget
- ✅ No performance issues

---

## Risk Mitigation

### Risk 1: High Token Costs
**Mitigation:**
- Set max_output_tokens limits
- Use gpt-5-mini for simple tasks
- Monitor token usage with alerts
- Implement rate limiting

### Risk 2: Poor Quality Outputs
**Mitigation:**
- Manual review before full launch
- Use higher reasoning effort if needed
- Iterate on prompts based on feedback
- A/B test different configurations

### Risk 3: Performance Issues
**Mitigation:**
- Set timeouts on all GPT-5 calls
- Implement retries with exponential backoff
- Cache results where appropriate
- Monitor P95 latency

### Risk 4: Integration Bugs
**Mitigation:**
- Comprehensive test coverage
- Gradual rollout
- Feature flags for easy rollback
- Monitor error rates

---

## Monitoring & Metrics

### Key Metrics to Track

1. **Token Usage**
   - Total tokens per day
   - Tokens per workflow/activity
   - Cost per rotation analysis
   - Target: <5K tokens per rotation event

2. **Quality Metrics**
   - User feedback on narratives
   - Anomaly detection accuracy
   - False positive rate
   - Target: >80% useful analyses

3. **Performance Metrics**
   - P50, P95, P99 latency
   - Failure rate
   - Timeout rate
   - Target: <10s P95, <5% failures

4. **Business Metrics**
   - Rotation events analyzed
   - High-confidence signals identified
   - Trading actions taken based on analysis

### Dashboards

Create Grafana dashboard with:
- Token usage over time (by workflow, activity, model)
- Latency distribution
- Error rates
- Cost breakdown

### Alerts

Set up alerts for:
- Token usage >10K per hour (cost spike)
- Error rate >10% (quality issue)
- P95 latency >30s (performance issue)
- Any workflow failures (critical)

---

## Budget

### Token Cost Estimates

**Current State:**
- `graphQueryWorkflow`: ~2K tokens per execution
- `graphSummarizeWorkflow`: ~500 tokens per community
- `clusterEnrichmentWorkflow`: ~300 tokens per cluster
- **Total:** ~5-10K tokens/day @ $0.50 per 1M input tokens = **$0.005-0.01/day**

**After Implementation:**
- `rotationDetectWorkflow` with analysis: +4K tokens per rotation event
- `graphQueryWorkflow` with CoT: -1K tokens (savings from CoT)
- `graphExploreWorkflow`: ~3K tokens per session
- **Total:** ~20-30K tokens/day @ $0.50 per 1M input tokens = **$0.01-0.015/day**

**Net Cost Increase:** ~$0.005-0.01/day = **~$3-5/month**

**Value:** 10x improvement in actionable intelligence >> $5/month cost

### Development Time

- Phase 1: 1 day
- Phase 2: 3 days
- Phase 3: 1 day
- Phase 4: 2 days
- **Total:** 7 days (~1.5 weeks)

---

## Success Criteria

### Phase 1 Success
- ✅ All GPT-5 activities use modern API
- ✅ Explicit reasoning effort configured
- ✅ No regressions in quality
- ✅ Token usage reduced by 10-15%

### Phase 2 Success
- ✅ Rotation analysis generated for all events
- ✅ >80% of analyses are actionable
- ✅ Anomaly detection catches edge cases
- ✅ Token usage <5K per event
- ✅ Latency <10s P95

### Phase 3 Success
- ✅ Cluster summaries include filing citations
- ✅ Summaries rated >4/5 by users

### Phase 4 Success
- ✅ Graph exploration supports multi-turn Q&A
- ✅ CoT reduces token usage by 60%+ on follow-ups
- ✅ Users can drill down into patterns

### Overall Success
- ✅ System provides 10x more actionable intelligence
- ✅ Token costs reduced by 60%+ where CoT is used
- ✅ No performance regressions
- ✅ User satisfaction with AI features >80%

---

## Next Steps

1. **Review & Approval** (1 day)
   - Review this plan with team
   - Get approval for budget and timeline
   - Assign tasks to developers

2. **Kickoff** (1 day)
   - Set up tracking (Jira/Linear tickets)
   - Create feature branch
   - Set up monitoring

3. **Implementation** (2-3 weeks)
   - Follow phase-by-phase plan
   - Daily standups to track progress
   - Weekly demos of completed phases

4. **Launch** (ongoing)
   - Stage 1: Dark launch (Week 1)
   - Stage 2: Beta (Week 2)
   - Stage 3: Full launch (Week 3)
   - Continuous monitoring and iteration

---

## Questions & Decisions Needed

1. **Database Schema:** Option A (extend `rotation_events`) or Option B (new `rotation_analysis` table)?
   - **Recommendation:** Option A (simpler)

2. **Expose Analysis in UI?** When/how to surface AI analysis to users?
   - **Recommendation:** Add to rotation event detail page in Week 3

3. **E2B Priority:** Should we include E2B in initial implementation or defer?
   - **Recommendation:** Defer to Phase 5 (optional)

4. **Budget Approval:** Is $5/month additional cost acceptable?
   - **Expected:** Yes (huge ROI)

5. **Resource Allocation:** Who will implement each phase?
   - **TBD:** Assign to team members

---

## Contact

For questions about this implementation plan:
- See `/docs/TEMPORAL_GPT5_WORKFLOW_REVIEW.md` for detailed review
- See `/docs/COT_WORKFLOWS_GUIDE.md` for CoT patterns
- See `/apps/temporal-worker/src/activities/cot-analysis.activities.ts` for examples
