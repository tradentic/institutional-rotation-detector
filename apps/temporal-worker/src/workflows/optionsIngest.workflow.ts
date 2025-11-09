import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities/index.activities.js';

const {
  // Tier 1 endpoints (MUST HAVE)
  fetchOptionContracts,        // Volume + OI + IV (single endpoint!)
  fetchOptionsFlowByExpiry,    // Aggregated flow by expiration
  fetchFlowAlerts,             // Unusual activity (pre-filtered)

  // Tier 2 endpoints (IMPORTANT)
  fetchOptionsFlowByStrike,    // Strike-level flow
  fetchGreekExposure,          // GEX trends
  fetchGreekExposureByExpiry,  // GEX by expiration

  // Helper endpoints
  fetchOptionChains,           // Contract discovery
  fetchGreeksForExpiration,    // Greeks per expiration

  // Computation
  calculateOptionsMetrics,     // Calculate all documented metrics
  computeOptionsSummary,
  computeOptionsBaselines,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '30s',
    maximumInterval: '5m',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

export interface OptionsIngestParams {
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

/**
 * Optimal workflow for daily options data ingestion
 * Uses Tier 1 endpoints by default (minimal API calls, meets all requirements)
 *
 * Implements workflows documented in unusualwhales-api-analysis.md:
 * - Daily Full Options Snapshot
 * - Unusual Activity Detection
 * - Historical Options Analysis
 */
export async function optionsIngestWorkflow(params: OptionsIngestParams): Promise<{
  ticker: string;
  date: string;
  contractsIngested: number;
  flowExpirations: number;
  alertsDetected: number;
  gexDays: number;
  gexExpirations: number;
  greeksExpirations: number;
  summaryComputed: boolean;
  baselinesComputed: boolean;
  metricsCalculated: boolean;
  apiCallsUsed: number;
}> {
  const {
    ticker,
    date = new Date().toISOString().substring(0, 10),
    includeContracts = true,   // Tier 1: Volume + OI + IV
    includeFlow = true,         // Tier 1: Aggregated flow
    includeAlerts = true,       // Tier 1: Unusual activity
    includeGEX = false,         // Tier 2: GEX trends (optional)
    includeGEXByExpiry = false, // Tier 3: GEX by expiration (optional)
    includeGreeks = false,      // Tier 2: Full greeks (expensive!)
    includeBaselines = false,   // Computation step
    calculateMetrics = false,   // Calculate all documented metrics
  } = params;

  let contractsIngested = 0;
  let flowExpirations = 0;
  let alertsDetected = 0;
  let gexDays = 0;
  let gexExpirations = 0;
  let greeksExpirations = 0;
  let apiCallsUsed = 0;

  // ============================================================
  // TIER 1: MUST HAVE (Meets all 4 requirements)
  // ============================================================

  // Step 1: Fetch ALL contracts (Volume + OI + IV)
  // This single endpoint provides:
  // ✅ Requirement 1: Volume by strike/expiry
  // ✅ Requirement 2: Open Interest by strike/expiry
  // ✅ Requirement 3: Put/Call ratio (volume and OI)
  // ✅ Requirement 4: Unusual activity (vol/OI ratio, vol>OI filter)
  // ✅ Bonus: IV for skew calculation
  if (includeContracts) {
    const contractsResult = await fetchOptionContracts({
      ticker,
      excludeZeroVol: true,
      excludeZeroOI: true,
      limit: 500,
    });
    contractsIngested = contractsResult.contracts;
    apiCallsUsed++;
  }

  // Step 2: Fetch aggregated flow by expiration
  // Provides ask/bid breakdown and OTM data
  if (includeFlow) {
    const flowResult = await fetchOptionsFlowByExpiry({ ticker });
    flowExpirations = flowResult.expirations;
    apiCallsUsed++;
  }

  // Step 3: Fetch unusual activity alerts (pre-filtered)
  // UnusualWhales already computed volume/OI ratios and flagged unusual activity
  if (includeAlerts) {
    const alertsResult = await fetchFlowAlerts({
      ticker,
      minPremium: 50000, // $50k minimum
      limit: 100,
    });
    alertsDetected = alertsResult.activities;
    apiCallsUsed++;
  }

  // ============================================================
  // TIER 2: IMPORTANT (Optional enhancements)
  // ============================================================

  // Step 4: Fetch GEX trends (optional)
  if (includeGEX) {
    const gexResult = await fetchGreekExposure({
      ticker,
      timeframe: '1m', // 30 days
    });
    gexDays = gexResult.days;
    apiCallsUsed++;
  }

  // Step 4b: Fetch GEX by expiration (Tier 3, optional)
  if (includeGEXByExpiry) {
    const gexExpiryResult = await fetchGreekExposureByExpiry({ ticker, date });
    gexExpirations = gexExpiryResult.expirations;
    apiCallsUsed++;
  }

  // Step 5: Fetch full Greeks (expensive - per expiration!)
  // Only do this if explicitly requested
  if (includeGreeks) {
    // First get list of expirations
    const chainsResult = await fetchOptionChains({ ticker, date });
    apiCallsUsed++;

    // Limit to 3 nearest expirations to avoid excessive API calls
    const nearestExpirations = chainsResult.expirations.slice(0, 3);

    for (const expiry of nearestExpirations) {
      await fetchGreeksForExpiration({ ticker, expiry, date });
      greeksExpirations++;
      apiCallsUsed++;
    }
  }

  // ============================================================
  // COMPUTATION STEPS
  // ============================================================

  // Step 6: Compute daily summary
  const summaryResult = await computeOptionsSummary({ ticker, date });
  const summaryComputed = summaryResult.processed;

  // Step 7: Compute historical baselines (optional)
  let baselinesComputed = false;
  if (includeBaselines) {
    const baselineResult = await computeOptionsBaselines({
      ticker,
      asOfDate: date,
      windowDays: 30,
    });
    baselinesComputed = baselineResult.processed;
  }

  // Step 8: Calculate all documented metrics (optional)
  let metricsCalculated = false;
  if (calculateMetrics) {
    await calculateOptionsMetrics({ ticker, date });
    metricsCalculated = true;
  }

  return {
    ticker,
    date,
    contractsIngested,
    flowExpirations,
    alertsDetected,
    gexDays,
    gexExpirations,
    greeksExpirations,
    summaryComputed,
    baselinesComputed,
    metricsCalculated,
    apiCallsUsed,
  };
}

/**
 * Minimal workflow using ONLY Tier 1 endpoints
 * Meets all 4 requirements with just 3 API calls!
 */
export async function optionsMinimalIngestWorkflow(params: {
  ticker: string;
  date?: string;
}): Promise<{
  ticker: string;
  date: string;
  success: boolean;
  apiCallsUsed: number;
}> {
  const { ticker, date = new Date().toISOString().substring(0, 10) } = params;

  // Call Tier 1 endpoints only
  await fetchOptionContracts({ ticker, excludeZeroVol: true, excludeZeroOI: true });
  await fetchOptionsFlowByExpiry({ ticker });
  await fetchFlowAlerts({ ticker, minPremium: 50000 });

  // Compute summary
  await computeOptionsSummary({ ticker, date });

  return {
    ticker,
    date,
    success: true,
    apiCallsUsed: 3, // option-contracts + flow-per-expiry + flow-alerts
  };
}

/**
 * Scheduled workflow to ingest unusual options activity daily
 * Runs market-wide (no ticker filter) to capture all unusual activity
 */
export async function unusualOptionsActivityCronWorkflow(params: {
  date?: string;
  minPremium?: number;
}): Promise<{ date: string; activities: number }> {
  const date = params.date || new Date(Date.now() - 86400000).toISOString().substring(0, 10);
  const minPremium = params.minPremium || 50000; // $50k minimum premium

  // Fetch unusual activity across ALL tickers (no ticker filter)
  const result = await fetchFlowAlerts({
    minPremium,
    limit: 200,
  });

  return {
    date,
    activities: result.activities,
  };
}

/**
 * Batch workflow to ingest options data for multiple tickers
 * Uses minimal workflow by default (3 API calls per ticker)
 */
export async function optionsBatchIngestWorkflow(params: {
  tickers: string[];
  date: string;
  useMinimal?: boolean;
}): Promise<{ processed: number; errors: number; totalApiCalls: number }> {
  const { tickers, date, useMinimal = true } = params;

  let processed = 0;
  let errors = 0;
  let totalApiCalls = 0;

  for (const ticker of tickers) {
    try {
      if (useMinimal) {
        // Use minimal workflow (3 API calls)
        const result = await optionsMinimalIngestWorkflow({ ticker, date });
        totalApiCalls += result.apiCallsUsed;
      } else {
        // Use full workflow (configurable)
        const result = await optionsIngestWorkflow({
          ticker,
          date,
          includeContracts: true,
          includeFlow: true,
          includeAlerts: true,
          includeGEX: false,      // Skip GEX in batch mode
          includeGreeks: false,   // Skip expensive Greeks in batch mode
          includeBaselines: false,
        });
        totalApiCalls += result.apiCallsUsed;
      }
      processed++;
    } catch (error) {
      console.error(`Error ingesting options for ${ticker}:`, error);
      errors++;
    }
  }

  return { processed, errors, totalApiCalls };
}

/**
 * Deep analysis workflow with ALL data (Tier 1 + Tier 2 + Tier 3)
 * Use for high-priority tickers or on-demand analysis
 * Implements complete "Daily Full Options Snapshot" workflow from documentation
 */
export async function optionsDeepAnalysisWorkflow(params: {
  ticker: string;
  date?: string;
}): Promise<{
  ticker: string;
  date: string;
  apiCallsUsed: number;
  metricsCalculated: boolean;
}> {
  const { ticker, date = new Date().toISOString().substring(0, 10) } = params;

  // Run full workflow with all options enabled
  const result = await optionsIngestWorkflow({
    ticker,
    date,
    includeContracts: true,   // Volume + OI + IV
    includeFlow: true,         // Aggregated flow
    includeAlerts: true,       // Unusual activity
    includeGEX: true,          // GEX trends
    includeGEXByExpiry: true,  // GEX by expiration
    includeGreeks: true,       // Full greeks (expensive!)
    includeBaselines: true,    // Historical baselines
    calculateMetrics: true,    // Calculate all documented metrics
  });

  return {
    ticker,
    date,
    apiCallsUsed: result.apiCallsUsed,
    metricsCalculated: result.metricsCalculated,
  };
}
