import { proxyActivities } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils.js';
import type { DownloadedIexFile } from '../activities/iex.hist.activities.js';

const activities = proxyActivities<{
  downloadDaily: (tradeDate: string) => Promise<DownloadedIexFile>;
  parseDailyVolume: (file: DownloadedIexFile, options?: { symbols?: string[] }) => Promise<number>;
}>(
  {
    startToCloseTimeout: '10 minutes',
  }
);

export interface IexDailyIngestInput {
  symbols?: string[];
  from?: string;
  to?: string;
  runKind?: 'backfill' | 'daily';
}

function normalizeDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid trade date ${date}`);
  }
  return parsed.toISOString().slice(0, 10);
}

function enumerateDates(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (start > end) {
    throw new Error('from must be before to');
  }
  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export async function iexDailyIngestWorkflow(input: IexDailyIngestInput) {
  const runKind = input.runKind ?? 'daily';
  const toDate = normalizeDate(input.to ?? input.from ?? new Date().toISOString().slice(0, 10));
  const fromDate = normalizeDate(input.from ?? toDate);
  const dates = enumerateDates(fromDate, toDate);
  const symbol = input.symbols && input.symbols.length === 1 ? input.symbols[0]!.toUpperCase() : undefined;
  for (const tradeDate of dates) {
    await upsertWorkflowSearchAttributes({
      dataset: 'IEX_HIST',
      tradeDate,
      runKind,
      symbol,
      provenance: 'IEX_HIST',
      batchId: `iex-hist:${tradeDate}`,
    });
    const downloaded = await activities.downloadDaily(tradeDate);
    await activities.parseDailyVolume(downloaded, { symbols: input.symbols });
  }
}
