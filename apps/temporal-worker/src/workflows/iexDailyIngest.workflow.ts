import { proxyActivities } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils.js';
import type {
  IexDailyIngestInput as ActivityInput,
  IexDailyIngestResult,
} from '../activities/iex.activities.js';

const activities = proxyActivities<{
  downloadIexDaily: (input: ActivityInput) => Promise<IexDailyIngestResult>;
  listIexHistDates: (fromDate: string, toDate: string) => Promise<string[]>;
}>({
  startToCloseTimeout: '5 minutes',
  scheduleToCloseTimeout: '10 minutes',
});

export interface IexDailyIngestInput {
  symbols?: string[];
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  runKind?: 'backfill' | 'daily';
}

/**
 * IEX Daily Ingest Workflow
 *
 * Ingests IEX HIST daily matched volume data (T+1) for a date range.
 * IEX HIST provides on-exchange matched volume for free.
 *
 * Search Attributes:
 * - Dataset: 'IEX_HIST'
 * - TradeDate: trade date
 * - RunKind: 'backfill' | 'daily'
 * - Provenance: file IDs
 */
export async function iexDailyIngestWorkflow(
  input: IexDailyIngestInput
): Promise<{ datesProcessed: number; totalRecords: number }> {
  const runKind = input.runKind ?? 'daily';
  const symbols = input.symbols ?? undefined;

  // Generate trade dates in the range
  const dates = input.from && input.to
    ? await activities.listIexHistDates(input.from, input.to)
    : input.from
    ? [input.from]
    : [getPreviousBusinessDay()];

  let totalRecords = 0;
  const fileIds: string[] = [];

  for (const tradeDate of dates) {
    const result = await activities.downloadIexDaily({
      symbols,
      tradeDate,
    });

    totalRecords += result.upsertCount;
    fileIds.push(result.fileId);

    // Set search attributes for this date
    await upsertWorkflowSearchAttributes({
      Dataset: 'IEX_HIST',
      TradeDate: tradeDate,
      RunKind: runKind,
      Provenance: result.fileId,
    });
  }

  return {
    datesProcessed: dates.length,
    totalRecords,
  };
}

/**
 * Get the previous business day (skips weekends)
 */
function getPreviousBusinessDay(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();

  let daysBack = 1;
  if (dayOfWeek === 0) {
    // Sunday -> go back to Friday
    daysBack = 2;
  } else if (dayOfWeek === 1) {
    // Monday -> go back to Friday
    daysBack = 3;
  }

  const previous = new Date(now);
  previous.setDate(now.getDate() - daysBack);
  return previous.toISOString().slice(0, 10);
}
