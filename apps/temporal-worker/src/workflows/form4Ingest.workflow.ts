import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities/index.activities.js';

const { fetchForm4Filings, downloadForm4Filing, computeInsiderSummary } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '30s',
    maximumInterval: '5m',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

export interface Form4IngestParams {
  issuerCik: string;
  startDate: string;
  endDate: string;
}

/**
 * Workflow to ingest Form 4 insider transactions for a given issuer and date range
 */
export async function form4IngestWorkflow(params: Form4IngestParams): Promise<{
  filings: number;
  transactions: number;
  summaries: number;
}> {
  const { issuerCik, startDate, endDate } = params;

  // Step 1: Fetch list of Form 4 filings
  const fetchResult = await fetchForm4Filings({
    issuerCik,
    startDate,
    endDate,
  });

  if (fetchResult.count === 0) {
    return { filings: 0, transactions: 0, summaries: 0 };
  }

  // Step 2: Download and parse each filing
  let totalTransactions = 0;
  for (const filing of fetchResult.filings) {
    const downloadResult = await downloadForm4Filing(filing.accessionNumber);
    totalTransactions += downloadResult.transactions;
  }

  // Step 3: Compute daily insider summaries
  const summaryResult = await computeInsiderSummary({
    ticker: undefined,
    cusip: undefined,
    startDate,
    endDate,
  });

  return {
    filings: fetchResult.count,
    transactions: totalTransactions,
    summaries: summaryResult.processed,
  };
}

/**
 * Scheduled workflow to ingest Form 4 filings daily for tracked issuers
 */
export async function form4DailyCronWorkflow(params: {
  date?: string;
}): Promise<{ processed: number }> {
  // Get date (default to yesterday)
  const date = params.date || new Date(Date.now() - 86400000).toISOString().substring(0, 10);

  // TODO: Query database for list of tracked issuers (those in rotation_events or watch list)
  // For now, this is a stub that would need to be implemented with actual issuer list

  return { processed: 0 };
}
