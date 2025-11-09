import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities/index.js';

const {
  fetchOptionsChain,
  fetchOptionsFlow,
  fetchUnusualOptionsActivity,
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
  date: string;
  includeChain?: boolean;
  includeFlow?: boolean;
  includeBaselines?: boolean;
}

/**
 * Workflow to ingest options data for a specific ticker and date
 */
export async function optionsIngestWorkflow(params: OptionsIngestParams): Promise<{
  ticker: string;
  date: string;
  chainContracts: number;
  flowRecords: number;
  summaryComputed: boolean;
  baselinesComputed: boolean;
}> {
  const {
    ticker,
    date,
    includeChain = true,
    includeFlow = true,
    includeBaselines = false,
  } = params;

  let chainContracts = 0;
  let flowRecords = 0;
  let summaryComputed = false;
  let baselinesComputed = false;

  // Step 1: Fetch options chain (full snapshot)
  if (includeChain) {
    const chainResult = await fetchOptionsChain({ ticker, date });
    chainContracts = chainResult.contracts;
  }

  // Step 2: Fetch options flow (transactions)
  if (includeFlow) {
    const flowResult = await fetchOptionsFlow({ ticker, date });
    flowRecords = flowResult.flows;
  }

  // Step 3: Compute daily summary
  if (chainContracts > 0 || flowRecords > 0) {
    const summaryResult = await computeOptionsSummary({ ticker, date });
    summaryComputed = summaryResult.processed;
  }

  // Step 4: Compute historical baselines (optional)
  if (includeBaselines) {
    const baselineResult = await computeOptionsBaselines({
      ticker,
      asOfDate: date,
      windowDays: 30,
    });
    baselinesComputed = baselineResult.processed;
  }

  return {
    ticker,
    date,
    chainContracts,
    flowRecords,
    summaryComputed,
    baselinesComputed,
  };
}

/**
 * Scheduled workflow to ingest unusual options activity daily
 */
export async function unusualOptionsActivityCronWorkflow(params: {
  date?: string;
  minPremium?: number;
}): Promise<{ date: string; activities: number }> {
  // Get date (default to yesterday)
  const date = params.date || new Date(Date.now() - 86400000).toISOString().substring(0, 10);
  const minPremium = params.minPremium || 50000; // $50k minimum premium

  // Fetch unusual activity across all tickers
  const result = await fetchUnusualOptionsActivity({
    date,
    minPremium,
  });

  return {
    date,
    activities: result.activities,
  };
}

/**
 * Batch workflow to ingest options data for multiple tickers
 */
export async function optionsBatchIngestWorkflow(params: {
  tickers: string[];
  date: string;
}): Promise<{ processed: number; errors: number }> {
  const { tickers, date } = params;

  let processed = 0;
  let errors = 0;

  for (const ticker of tickers) {
    try {
      await optionsIngestWorkflow({
        ticker,
        date,
        includeChain: true,
        includeFlow: true,
        includeBaselines: false,
      });
      processed++;
    } catch (error) {
      console.error(`Error ingesting options for ${ticker}:`, error);
      errors++;
    }
  }

  return { processed, errors };
}
