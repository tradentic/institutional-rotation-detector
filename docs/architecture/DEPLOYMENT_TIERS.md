# Deployment Tiers: Minimal / Standard / Advanced

**Purpose:** Configuration-based deployment modes to optimize for different use cases and budgets
**Status:** Specification
**Last Updated:** 2025-01-13
**Related:** WORKFLOW_CONSOLIDATION.md, FEATURE_VALUE_AUDIT.md

---

## Executive Summary

The institutional rotation detector can be deployed in three tiers based on use case, budget, and alpha requirements:

| Tier | Workflows | Monthly Cost | Use Case | Alpha Expectation |
|------|-----------|--------------|----------|-------------------|
| **Minimal** | 8 core | ~$150-300 | Hobbyist, proof-of-concept | Core rotation signals only |
| **Standard** | 14 production | ~$500-800 | Small fund, serious trader | Enhanced signals + validation |
| **Advanced** | 20 full suite | ~$1,200-2,000 | Institutional, research | All features + experimental |

**Key Principle:** All tiers run the same core rotation algorithm. Higher tiers add validation, enrichment, and research capabilities.

---

## Tier 1: Minimal (Core Alpha Only)

### Philosophy
**"Just the rotation signals, as fast and cheap as possible"**

Focus on the proven alpha generators with minimal operational overhead. Ideal for:
- Individual traders testing the system
- Proof-of-concept deployments
- Budget-constrained operations
- High signal-to-noise preference

### Enabled Workflows (8)

#### Core Ingestion (3)
1. **ingestIssuerWorkflow** - Download and parse 13F-HR filings
2. **ingestQuarterWorkflow** - Batch process entire quarter's filings
3. **etfDailyCronWorkflow** - Daily tracking of Russell 1000/2000 composition

#### Core Analysis (2)
4. **rotationDetectWorkflow** - R-score calculation (rotation detection)
5. **eventStudyWorkflow** - CAR validation of rotation signals

#### AI Enhancement (1)
6. **AI analysis (embedded)** - Anomaly detection + narrative generation
   - Via `analyzeRotationEvent` activity in rotationDetectWorkflow
   - ~$0.03 per event (GPT-5 with CoT)

#### Scheduled Watchers (2)
7. **edgarSubmissionsPollerWorkflow** - Monitor for new 13F filings
8. **nportMonthlyTimerWorkflow** - Monthly N-PORT ETF data sync

### Disabled Features

**Options Flow** - Not available
- No unusual options activity tracking
- No options overlay in R-score (falls back to default penalty)

**Microstructure** - Not available
- No VPIN, Kyle's lambda
- No off-exchange ratio
- No flip50 detection

**Graph Analysis** - Not available
- No holder network analysis
- No cross-community detection
- No cluster enrichment

**Form 4 Insider** - Not available
- Uses 13F data only (45-day lag)
- No early validation from Form 4 (2-day lag)

### Cost Breakdown

| Component | Volume | Unit Cost | Monthly |
|-----------|--------|-----------|---------|
| SEC EDGAR API | ~2,000 filings | Free | $0 |
| Supabase (rows) | ~100K rows | $0.01/10K | $10 |
| GPT-5 CoT | ~200 events | $0.03 each | $6 |
| Compute (worker) | 1 instance | ~$140/mo | $140 |
| **TOTAL** | | | **~$156/mo** |

**Cost scaling:**
- More tickers tracked → More compute hours ($140 → $300)
- More rotation events → More AI analysis ($6 → $50)

### Expected Performance

**Alpha Sources:**
- R-score v5.0: Multi-signal rotation detection
- AI analysis: Anomaly filtering (reduces false positives by ~40%)
- Event study: Post-hoc validation of signals

**Expected CAR:**
- Per rotation_score_v_5.md: 4-6% average gain over [+0, +20] days
- Sharpe ratio: 0.8-1.2 (based on signal quality)
- Hit rate: 60-70% (percentage of positive CARs)

**Limitations:**
- No options validation → Some false positives
- No Form 4 validation → 45-day lag before confirmation
- No microstructure → Can't filter toxic flow

### Configuration

#### Environment Variables
```bash
# Minimal tier configuration
DEPLOYMENT_TIER=minimal

# Core features only
ENABLE_OPTIONS_FLOW=false
ENABLE_MICROSTRUCTURE=false
ENABLE_GRAPH_ANALYSIS=false
ENABLE_FORM4_TRACKING=false

# Required API keys
SEC_USER_AGENT="YourCompany contact@yourcompany.com"
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-key
OPENAI_API_KEY=sk-your-key
```

#### TypeScript Configuration
```typescript
import { DeploymentTier, createTierConfig } from './deployment-tiers';

const config = createTierConfig(DeploymentTier.MINIMAL);
// Returns: {
//   enabledWorkflows: ['ingestIssuer', 'rotationDetect', ...],
//   optionsFlow: { enabled: false },
//   microstructure: { enabled: false },
//   graphAnalysis: { enabled: false },
//   form4Tracking: { enabled: false }
// }
```

---

## Tier 2: Standard (Production Trading)

### Philosophy
**"Proven alpha generators + key validation layers"**

Adds options overlay, Form 4 early validation, and selective graph analysis. Ideal for:
- Small funds managing real capital
- Professional traders
- Production deployments
- Balance of cost vs. signal quality

### Enabled Workflows (14)

**Everything from Minimal (8) PLUS:**

#### Options Flow (2)
9. **optionsIngestWorkflow** (tier: 'minimal')
   - 3 API calls per ticker: Contracts + Flow + Alerts
   - UnusualWhales Tier 1 endpoints only
   - Options overlay in R-score (optSame, optNext)

10. **unusualOptionsActivityCronWorkflow**
    - Daily scan for unusual options volume
    - Validates rotation signals with options activity

#### Form 4 Insider Tracking (2)
11. **form4IngestWorkflow** - Parse insider transactions
12. **form4DailyCronWorkflow** - Daily Form 4 filing monitor

#### Graph Analysis (2)
13. **graphBuildWorkflow** - Build holder network graph
14. **graphSummarizeWorkflow** - Summarize community structure

### Disabled Features

**Deep Options Analysis** - Not available
- No Tier 2/3 UnusualWhales endpoints
- No Greeks calculation
- No GEX (gamma exposure)
- Cost savings: ~$200/month

**Microstructure** - Not available
- No VPIN, Kyle's lambda
- No off-exchange ratio
- No flip50 detection
- Rationale: Per FEATURE_VALUE_AUDIT.md, microstructure is unproven alpha

**Advanced Graph** - Not available
- No cross-community analysis
- No cluster enrichment
- No graph exploration workflows
- Rationale: Research tools, not production signals

### Cost Breakdown

| Component | Volume | Unit Cost | Monthly |
|-----------|--------|-----------|---------|
| **Minimal tier** | | | $156 |
| UnusualWhales API | 3 endpoints | ~$100/mo | $100 |
| Form 4 ingestion | ~500 filings/day | Free | $0 |
| Graph compute | Weekly rebuild | ~$50/mo | $50 |
| Increased DB usage | +200K rows | $0.01/10K | $20 |
| **TOTAL** | | | **~$326/mo** |

**With realistic scaling:**
- More tickers (50 → 200) → More API calls ($100 → $300)
- More workers (2 instances) → More compute ($140 → $280)
- **Realistic: $500-800/month**

### Expected Performance

**Alpha Sources (vs. Minimal):**
- ✅ Same core R-score
- ✅ Same AI analysis
- ✅ Same event study
- ➕ **Options validation** - Filters false positives
- ➕ **Form 4 early signal** - 43 days faster than 13F
- ➕ **Holder network** - Community structure insights

**Expected Improvement:**
- Hit rate: 60-70% → **70-75%** (options filtering)
- Sharpe ratio: 0.8-1.2 → **1.0-1.4** (Form 4 validation)
- False positive reduction: ~30% (options + Form 4)

### Configuration

#### Environment Variables
```bash
# Standard tier configuration
DEPLOYMENT_TIER=standard

# Enhanced features
ENABLE_OPTIONS_FLOW=true
ENABLE_FORM4_TRACKING=true
ENABLE_GRAPH_ANALYSIS=true

# Options tier (minimal = 3 API calls)
OPTIONS_TIER=minimal

# Microstructure still disabled
ENABLE_MICROSTRUCTURE=false

# Required API keys
SEC_USER_AGENT="YourCompany contact@yourcompany.com"
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-key
OPENAI_API_KEY=sk-your-key
UNUSUALWHALES_API_KEY=your-key  # NEW
```

#### TypeScript Configuration
```typescript
const config = createTierConfig(DeploymentTier.STANDARD);
// Returns: {
//   enabledWorkflows: [...minimal, 'optionsIngest', 'form4DailyCron', ...],
//   optionsFlow: {
//     enabled: true,
//     tier: 'minimal',  // 3 API calls
//     endpoints: ['contracts', 'flow', 'alerts']
//   },
//   microstructure: { enabled: false },
//   graphAnalysis: {
//     enabled: true,
//     includeAdvanced: false  // Build + summarize only
//   },
//   form4Tracking: { enabled: true }
// }
```

---

## Tier 3: Advanced (Institutional + Research)

### Philosophy
**"Everything enabled, including experimental features"**

Full feature set including microstructure, deep options analysis, and research tools. Ideal for:
- Institutional asset managers
- Quantitative research teams
- Academic institutions
- Feature validation and backtesting

### Enabled Workflows (20)

**Everything from Standard (14) PLUS:**

#### Advanced Options (2)
15. **optionsIngestWorkflow** (tier: 'deep')
    - All UnusualWhales endpoints (Tier 1-3)
    - Greeks calculation
    - GEX (gamma exposure)

16. **optionsBatchIngestWorkflow**
    - Batch processing for backtests

#### Microstructure (6)
17. **finraOtcWeeklyIngestWorkflow** - FINRA OTC transparency
18. **iexDailyIngestWorkflow** - IEX matched volume
19. **offexRatioComputeWorkflow** - Off-exchange ratio
20. **flip50DetectWorkflow** - Flip50 event detection
21. **shortInterestIngestWorkflow** - FINRA short interest
22. **microstructureAnalysisWorkflow** - VPIN, Kyle's lambda

#### Advanced Graph (2)
23. **crossCommunityAnalysisWorkflow** - Cross-community flows
24. **clusterEnrichmentWorkflow** - Cluster metadata enrichment

#### Research Tools (1)
25. **statisticalAnalysisWorkflow** - Ad-hoc statistical tests

### All Features Enabled

✅ Core rotation detection
✅ AI-powered analysis
✅ Event study validation
✅ Options flow (full Tier 1-3)
✅ Form 4 insider tracking
✅ Graph analysis (full)
✅ Microstructure layer (VPIN, Kyle's lambda, etc.)
✅ Research and experimental workflows

### Cost Breakdown

| Component | Volume | Unit Cost | Monthly |
|-----------|--------|-----------|---------|
| **Standard tier** | | | $500-800 |
| UnusualWhales Tier 2/3 | Advanced | ~$300/mo | $300 |
| FINRA API | OTC data | $100/mo | $100 |
| IEX API | Volume data | ~$150/mo | $150 |
| Microstructure compute | Daily | ~$200/mo | $200 |
| Advanced graph | Weekly | ~$100/mo | $100 |
| **TOTAL** | | | **~$1,350/mo** |

**With realistic usage:**
- More workers (3-4 instances) → $280-420
- High-volume options ingestion → $400-500
- **Realistic: $1,200-2,000/month**

### Expected Performance

**Alpha Sources (vs. Standard):**
- ✅ All Standard features
- ➕ **Deep options** - Greeks, GEX for volatility signals
- ➕ **Microstructure** - VPIN for toxic flow detection
- ➕ **Advanced graph** - Cross-community rotation patterns

**Expected Improvement:**
- Hit rate: **Unknown** - Microstructure unproven
- Sharpe ratio: **Validate via backtest**
- Decision criteria (per FEATURE_VALUE_AUDIT.md):
  - If ΔSharpe < 0.2 → Microstructure adds no value
  - If ΔSharpe ≥ 0.2 → Microstructure worth the cost

**Use Case:**
- **Not for production** (unless microstructure validated)
- **For research** - Feature validation, backtesting, academic papers
- **For development** - Test new signals before promoting to Standard

### Configuration

#### Environment Variables
```bash
# Advanced tier configuration
DEPLOYMENT_TIER=advanced

# All features enabled
ENABLE_OPTIONS_FLOW=true
ENABLE_FORM4_TRACKING=true
ENABLE_GRAPH_ANALYSIS=true
ENABLE_MICROSTRUCTURE=true        # NEW
ENABLE_RESEARCH_WORKFLOWS=true    # NEW

# Options tier (deep = all endpoints)
OPTIONS_TIER=deep

# Required API keys
SEC_USER_AGENT="YourCompany contact@yourcompany.com"
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-key
OPENAI_API_KEY=sk-your-key
UNUSUALWHALES_API_KEY=your-key
FINRA_API_CLIENT=your-client
FINRA_API_SECRET=your-secret
IEX_API_KEY=your-key               # NEW
```

#### TypeScript Configuration
```typescript
const config = createTierConfig(DeploymentTier.ADVANCED);
// Returns: {
//   enabledWorkflows: [...all 20 workflows...],
//   optionsFlow: {
//     enabled: true,
//     tier: 'deep',
//     endpoints: ['contracts', 'flow', 'alerts', 'greeks', 'gex', ...]
//   },
//   microstructure: {
//     enabled: true,
//     includeVPIN: true,
//     includeKylesLambda: true,
//     includeOffexRatio: true,
//     includeFlip50: true
//   },
//   graphAnalysis: {
//     enabled: true,
//     includeAdvanced: true  // Cross-community, enrichment
//   },
//   form4Tracking: { enabled: true }
// }
```

---

## Comparison Matrix

### Feature Availability

| Feature | Minimal | Standard | Advanced |
|---------|---------|----------|----------|
| **Core rotation detection** | ✅ | ✅ | ✅ |
| **AI-powered analysis** | ✅ | ✅ | ✅ |
| **Event study (CAR)** | ✅ | ✅ | ✅ |
| **13F ingestion** | ✅ | ✅ | ✅ |
| **ETF tracking** | ✅ | ✅ | ✅ |
| **Options flow (minimal)** | ❌ | ✅ | ✅ |
| **Options flow (deep)** | ❌ | ❌ | ✅ |
| **Form 4 insider** | ❌ | ✅ | ✅ |
| **Graph analysis (basic)** | ❌ | ✅ | ✅ |
| **Graph analysis (advanced)** | ❌ | ❌ | ✅ |
| **Microstructure (VPIN, etc.)** | ❌ | ❌ | ✅ |
| **Research workflows** | ❌ | ❌ | ✅ |

### Workflow Count

| Category | Minimal | Standard | Advanced |
|----------|---------|----------|----------|
| Core ingestion | 3 | 3 | 3 |
| Core analysis | 2 | 2 | 2 |
| AI enhancement | 1 | 1 | 1 |
| Scheduled watchers | 2 | 2 | 2 |
| **Subtotal (base)** | **8** | **8** | **8** |
| Options flow | 0 | +2 | +3 |
| Form 4 insider | 0 | +2 | +2 |
| Graph analysis | 0 | +2 | +4 |
| Microstructure | 0 | 0 | +6 |
| Research | 0 | 0 | +1 |
| **TOTAL** | **8** | **14** | **24** |

**Note:** Advanced tier has 24 workflows (not 20) because it includes:
- All 14 from Standard
- +3 options workflows (deep tier, batch)
- +2 advanced graph (cross-community, enrichment)
- +6 microstructure
- +1 research

After workflow consolidation (per WORKFLOW_CONSOLIDATION.md), Advanced will have **20 workflows**.

### Cost Summary

| Tier | Monthly Cost | Cost per Signal | Workflows | Value Proposition |
|------|--------------|-----------------|-----------|-------------------|
| **Minimal** | $150-300 | ~$0.75 | 8 | Core alpha only, budget-friendly |
| **Standard** | $500-800 | ~$1.25 | 14 | Production trading with validation |
| **Advanced** | $1,200-2,000 | ~$2.50 | 20 | Full feature set, research-grade |

**Assumptions:**
- ~200 rotation signals per month (based on Russell 2000 coverage)
- Cost per signal = Monthly cost / 200

---

## Migration Paths

### Upgrading: Minimal → Standard

**When to upgrade:**
- Managing real capital (> $100K)
- Need higher hit rate (fewer false positives)
- Want early signals (Form 4 vs. 13F lag)
- Options activity is relevant to strategy

**Steps:**
1. Add UnusualWhales API key to environment
2. Set `DEPLOYMENT_TIER=standard`
3. Set `ENABLE_OPTIONS_FLOW=true`
4. Set `ENABLE_FORM4_TRACKING=true`
5. Set `ENABLE_GRAPH_ANALYSIS=true`
6. Restart worker
7. Backfill Form 4 data (last 90 days)
8. Backfill options data (last 30 days)

**Migration time:** 2-4 hours (mostly backfill)

**Cost increase:** +$200-500/month

**Expected benefit:**
- Hit rate: +5-10 percentage points
- Sharpe ratio: +0.2-0.3
- False positive reduction: ~30%

### Upgrading: Standard → Advanced

**When to upgrade:**
- Research team validating new features
- Backtesting microstructure signals
- Academic research project
- High-budget institutional deployment

**Steps:**
1. Add FINRA, IEX API keys
2. Set `DEPLOYMENT_TIER=advanced`
3. Set `ENABLE_MICROSTRUCTURE=true`
4. Set `ENABLE_RESEARCH_WORKFLOWS=true`
5. Set `OPTIONS_TIER=deep`
6. Restart worker
7. Backfill microstructure data (last 180 days)

**Migration time:** 1-2 days (large backfill)

**Cost increase:** +$700-1,200/month

**Expected benefit:**
- **Unknown** - Validate via backtest
- Recommendation: Run parallel deployment
  - Standard tier: Production trading
  - Advanced tier: Research and validation
- After 3-6 months: Evaluate ΔSharpe
  - If ΔSharpe ≥ 0.2 → Promote microstructure to Standard
  - If ΔSharpe < 0.2 → Deprecate microstructure

### Downgrading: Advanced → Standard

**When to downgrade:**
- Microstructure provided no alpha (ΔSharpe < 0.2)
- Cost reduction needed
- Moving from research to production

**Steps:**
1. Set `DEPLOYMENT_TIER=standard`
2. Set `ENABLE_MICROSTRUCTURE=false`
3. Set `ENABLE_RESEARCH_WORKFLOWS=false`
4. Set `OPTIONS_TIER=minimal`
5. Restart worker
6. Optionally: Archive microstructure data

**Cost savings:** -$700-1,200/month

**Data retention:**
- Keep microstructure data in database (cheap)
- Can re-enable later without backfill
- Archive to cold storage if cost-sensitive

---

## Implementation Guide

### Phase 1: Configuration Infrastructure (Week 1-2)

**1.1 Create TypeScript Types**

File: `apps/temporal-worker/src/config/deployment-tiers.ts`

```typescript
export enum DeploymentTier {
  MINIMAL = 'minimal',
  STANDARD = 'standard',
  ADVANCED = 'advanced',
}

export interface TierConfig {
  tier: DeploymentTier;
  enabledWorkflows: string[];
  optionsFlow: OptionsFlowConfig;
  microstructure: MicrostructureConfig;
  graphAnalysis: GraphAnalysisConfig;
  form4Tracking: Form4TrackingConfig;
}

export interface OptionsFlowConfig {
  enabled: boolean;
  tier?: 'minimal' | 'standard' | 'deep';
  endpoints?: string[];
}

export interface MicrostructureConfig {
  enabled: boolean;
  includeVPIN?: boolean;
  includeKylesLambda?: boolean;
  includeOffexRatio?: boolean;
  includeFlip50?: boolean;
}

export interface GraphAnalysisConfig {
  enabled: boolean;
  includeAdvanced?: boolean;
}

export interface Form4TrackingConfig {
  enabled: boolean;
}
```

**1.2 Create Tier Config Factory**

```typescript
export function createTierConfig(tier: DeploymentTier): TierConfig {
  const baseWorkflows = [
    'ingestIssuer',
    'ingestQuarter',
    'rotationDetect',
    'eventStudy',
    'edgarSubmissionsPoller',
    'nportMonthlyTimer',
    'etfDailyCron',
  ];

  switch (tier) {
    case DeploymentTier.MINIMAL:
      return {
        tier,
        enabledWorkflows: baseWorkflows,
        optionsFlow: { enabled: false },
        microstructure: { enabled: false },
        graphAnalysis: { enabled: false },
        form4Tracking: { enabled: false },
      };

    case DeploymentTier.STANDARD:
      return {
        tier,
        enabledWorkflows: [
          ...baseWorkflows,
          'optionsIngest',
          'unusualOptionsActivityCron',
          'form4Ingest',
          'form4DailyCron',
          'graphBuild',
          'graphSummarize',
        ],
        optionsFlow: {
          enabled: true,
          tier: 'minimal',
          endpoints: ['contracts', 'flow', 'alerts'],
        },
        microstructure: { enabled: false },
        graphAnalysis: {
          enabled: true,
          includeAdvanced: false,
        },
        form4Tracking: { enabled: true },
      };

    case DeploymentTier.ADVANCED:
      return {
        tier,
        enabledWorkflows: [
          ...baseWorkflows,
          // Options
          'optionsIngest',
          'unusualOptionsActivityCron',
          'optionsBatch',
          // Form 4
          'form4Ingest',
          'form4DailyCron',
          // Graph
          'graphBuild',
          'graphSummarize',
          'crossCommunityAnalysis',
          'clusterEnrichment',
          // Microstructure
          'finraOtcWeeklyIngest',
          'iexDailyIngest',
          'offexRatioCompute',
          'flip50Detect',
          'shortInterestIngest',
          'microstructureAnalysis',
          // Research
          'statisticalAnalysis',
        ],
        optionsFlow: {
          enabled: true,
          tier: 'deep',
          endpoints: ['contracts', 'flow', 'alerts', 'greeks', 'gex'],
        },
        microstructure: {
          enabled: true,
          includeVPIN: true,
          includeKylesLambda: true,
          includeOffexRatio: true,
          includeFlip50: true,
        },
        graphAnalysis: {
          enabled: true,
          includeAdvanced: true,
        },
        form4Tracking: { enabled: true },
      };
  }
}
```

**1.3 Load from Environment**

```typescript
export function loadTierConfigFromEnv(): TierConfig {
  const tierStr = process.env.DEPLOYMENT_TIER || 'minimal';
  const tier = tierStr as DeploymentTier;

  if (!Object.values(DeploymentTier).includes(tier)) {
    throw new Error(`Invalid DEPLOYMENT_TIER: ${tierStr}`);
  }

  return createTierConfig(tier);
}
```

### Phase 2: Worker Integration (Week 3)

**2.1 Update Worker to Use Tier Config**

File: `apps/temporal-worker/src/worker.ts`

```typescript
import { loadTierConfigFromEnv } from './config/deployment-tiers';

async function run() {
  // Load tier configuration
  const tierConfig = loadTierConfigFromEnv();

  console.log(`🚀 Starting Temporal Worker (${tierConfig.tier} tier)...`);

  // ... existing connection code ...

  // Create worker with tier-aware configuration
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath: join(__dirname, 'workflows'),
    activities,
    maxCachedWorkflows: 100,
    maxConcurrentActivityTaskExecutions: 50,
    maxConcurrentWorkflowTaskExecutions: 20,
  });

  console.log('✅ Worker created successfully');
  console.log('');
  console.log(`📋 Enabled Workflows (${tierConfig.tier} tier):`);

  tierConfig.enabledWorkflows.forEach((wf) => {
    console.log(`   - ${wf}`);
  });

  console.log('');
  console.log('🎯 Feature Configuration:');
  console.log(`   Options Flow: ${tierConfig.optionsFlow.enabled ? '✅ ' + tierConfig.optionsFlow.tier : '❌'}`);
  console.log(`   Form 4 Tracking: ${tierConfig.form4Tracking.enabled ? '✅' : '❌'}`);
  console.log(`   Graph Analysis: ${tierConfig.graphAnalysis.enabled ? '✅' : '❌'}`);
  console.log(`   Microstructure: ${tierConfig.microstructure.enabled ? '✅' : '❌'}`);

  await worker.run();
}
```

**2.2 Create Workflow Guard**

File: `apps/temporal-worker/src/utils/workflow-guard.ts`

```typescript
import { loadTierConfigFromEnv } from '../config/deployment-tiers';

/**
 * Check if a workflow is enabled in the current deployment tier
 */
export function isWorkflowEnabled(workflowName: string): boolean {
  const config = loadTierConfigFromEnv();
  return config.enabledWorkflows.includes(workflowName);
}

/**
 * Throw error if workflow is not enabled in current tier
 */
export function requireWorkflow(workflowName: string): void {
  if (!isWorkflowEnabled(workflowName)) {
    const config = loadTierConfigFromEnv();
    throw new Error(
      `Workflow '${workflowName}' is not enabled in ${config.tier} tier. ` +
      `Upgrade to a higher tier or enable manually via environment variables.`
    );
  }
}
```

### Phase 3: Activity Guards (Week 4)

**3.1 Guard Expensive Activities**

File: `apps/temporal-worker/src/activities/options.activities.ts`

```typescript
import { loadTierConfigFromEnv } from '../config/deployment-tiers';

export async function fetchOptionsGreeks(input: FetchGreeksInput) {
  const config = loadTierConfigFromEnv();

  // Greeks only available in 'deep' tier
  if (config.optionsFlow.tier !== 'deep') {
    throw new Error(
      'Options Greeks require ADVANCED tier (OPTIONS_TIER=deep). ' +
      'Current tier: ' + config.tier
    );
  }

  // ... actual fetching logic ...
}
```

**3.2 Guard Microstructure Activities**

```typescript
export async function calculateVPIN(input: VPINInput) {
  const config = loadTierConfigFromEnv();

  if (!config.microstructure.enabled) {
    throw new Error(
      'VPIN calculation requires ADVANCED tier with ENABLE_MICROSTRUCTURE=true'
    );
  }

  // ... actual calculation ...
}
```

### Phase 4: Documentation & Testing (Week 5)

**4.1 Update README**

Add tier selection guide to main README:

```markdown
## Deployment Tiers

Choose your deployment tier based on use case and budget:

- **Minimal** ($150-300/mo): Core rotation signals only
- **Standard** ($500-800/mo): Production trading with options + Form 4
- **Advanced** ($1,200-2,000/mo): Full feature set for research

See [DEPLOYMENT_TIERS.md](./docs/architecture/DEPLOYMENT_TIERS.md) for details.
```

**4.2 Create Example .env Files**

```bash
# .env.example.minimal
DEPLOYMENT_TIER=minimal
ENABLE_OPTIONS_FLOW=false
ENABLE_MICROSTRUCTURE=false
# ... minimal keys only ...

# .env.example.standard
DEPLOYMENT_TIER=standard
ENABLE_OPTIONS_FLOW=true
OPTIONS_TIER=minimal
ENABLE_FORM4_TRACKING=true
# ... standard keys ...

# .env.example.advanced
DEPLOYMENT_TIER=advanced
ENABLE_OPTIONS_FLOW=true
OPTIONS_TIER=deep
ENABLE_MICROSTRUCTURE=true
# ... all keys ...
```

**4.3 Add Integration Tests**

```typescript
describe('Deployment Tiers', () => {
  it('Minimal tier disables expensive workflows', () => {
    process.env.DEPLOYMENT_TIER = 'minimal';
    const config = loadTierConfigFromEnv();
    expect(config.optionsFlow.enabled).toBe(false);
    expect(config.microstructure.enabled).toBe(false);
  });

  it('Standard tier enables options and Form 4', () => {
    process.env.DEPLOYMENT_TIER = 'standard';
    const config = loadTierConfigFromEnv();
    expect(config.optionsFlow.enabled).toBe(true);
    expect(config.optionsFlow.tier).toBe('minimal');
    expect(config.form4Tracking.enabled).toBe(true);
  });

  it('Advanced tier enables all features', () => {
    process.env.DEPLOYMENT_TIER = 'advanced';
    const config = loadTierConfigFromEnv();
    expect(config.microstructure.enabled).toBe(true);
    expect(config.optionsFlow.tier).toBe('deep');
  });
});
```

---

## Validation & Rollout

### Validation Criteria

Before promoting features from Advanced → Standard tier:

| Feature | Metric | Threshold | Test Period |
|---------|--------|-----------|-------------|
| Microstructure | ΔSharpe ratio | ≥ 0.2 | 3-6 months |
| Advanced graph | Hit rate improvement | ≥ +5pp | 3 months |
| Deep options | CAR improvement | ≥ +1% | 3 months |

**Test methodology:**
1. Run parallel deployments (Standard + Advanced)
2. Track signals from both tiers in separate tables
3. Calculate CAR for both signal sets
4. Compare Sharpe, hit rate, max drawdown
5. Statistical significance test (t-test, p < 0.05)

### Rollout Plan

**Month 1-2: Infrastructure**
- Implement tier config system
- Add workflow guards
- Create example .env files
- Update documentation

**Month 3-4: Testing**
- Internal testing of all three tiers
- Validate cost estimates
- Fix bugs and edge cases

**Month 5-10: Advanced Tier Validation**
- Deploy Advanced tier for research
- Collect 6 months of data
- Backtest microstructure signals
- Decide: Keep or deprecate

**Month 11-12: Productionize**
- If validated: Promote microstructure to Standard
- If not: Deprecate and archive
- Update tier definitions based on learnings

---

## FAQ

### Q: Can I mix-and-match features across tiers?

**A:** Yes, via environment variables:

```bash
DEPLOYMENT_TIER=standard
ENABLE_MICROSTRUCTURE=true  # Enable Advanced feature in Standard tier
```

The tier preset is just a starting point. You can override individual features.

### Q: What happens if I call a disabled workflow?

**A:** The workflow will throw an error:

```
Error: Workflow 'microstructureAnalysis' is not enabled in standard tier.
Upgrade to a higher tier or enable manually via ENABLE_MICROSTRUCTURE=true
```

### Q: Can I run multiple tiers simultaneously?

**A:** Yes, deploy separate workers:

```bash
# Worker 1: Production (Standard tier)
DEPLOYMENT_TIER=standard
TEMPORAL_TASK_QUEUE=rotation-detector-prod

# Worker 2: Research (Advanced tier)
DEPLOYMENT_TIER=advanced
TEMPORAL_TASK_QUEUE=rotation-detector-research
```

### Q: How do I backtest a tier before deploying?

**A:**

1. Set tier in environment
2. Run `ingestQuarterWorkflow` for historical data
3. Run `rotationDetectWorkflow` for past quarters
4. Analyze results in `rotation_scores` table
5. Compare to baseline (Minimal tier)

### Q: What if I want only microstructure, no options?

**A:**

```bash
DEPLOYMENT_TIER=minimal
ENABLE_MICROSTRUCTURE=true
ENABLE_OPTIONS_FLOW=false
```

Tier is just a preset. Override as needed.

---

## Related Documentation

- [WORKFLOW_CONSOLIDATION.md](./WORKFLOW_CONSOLIDATION.md) - Workflow reduction plan
- [FEATURE_VALUE_AUDIT.md](./FEATURE_VALUE_AUDIT.md) - Alpha generation analysis
- [WORKFLOWS.md](./WORKFLOWS.md) - Comprehensive workflow catalog
- [rotation_score_v_5.md](../specs/rotation_score_v_5.md) - Core rotation algorithm

---

## Appendix: Decision Tree

```
Choose your tier:

START
  │
  ├─ Budget < $500/mo?
  │   └─ YES → MINIMAL
  │
  ├─ Managing real capital?
  │   ├─ NO → MINIMAL
  │   └─ YES → Continue
  │
  ├─ Need options/Form 4 validation?
  │   ├─ NO → MINIMAL
  │   └─ YES → STANDARD
  │
  ├─ Running research/backtests?
  │   ├─ NO → STANDARD
  │   └─ YES → Continue
  │
  ├─ Validating microstructure?
  │   ├─ NO → STANDARD
  │   └─ YES → ADVANCED
  │
  └─ END
```

**Recommendation:** Start with Minimal, upgrade to Standard when managing capital, only use Advanced for research.
