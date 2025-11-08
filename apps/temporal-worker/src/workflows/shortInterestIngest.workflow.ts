import { proxyActivities } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils.js';

const activities = proxyActivities<{
  loadCalendar: (year: number) => Promise<{ settlementDate: string; publicationDate: string }[]>;
  fetchShortInterest: (params: { symbol: string; settlementDate: string; publicationDate?: string }) => Promise<number>;
}>(
  {
    startToCloseTimeout: '5 minutes',
  }
);

export interface ShortInterestIngestInput {
  symbols: string[];
  year?: number;
  from?: string;
  to?: string;
  runKind?: 'backfill' | 'daily';
}

function normalize(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date ${date}`);
  }
  return parsed.toISOString().slice(0, 10);
}

export async function shortInterestIngestWorkflow(input: ShortInterestIngestInput) {
  if (!input.symbols || input.symbols.length === 0) {
    throw new Error('symbols are required');
  }
  const runKind = input.runKind ?? 'daily';
  const today = new Date();
  const toDate = normalize(input.to ?? today.toISOString().slice(0, 10));
  const fromDate = normalize(input.from ?? toDate);
  const fromYear = Number(fromDate.slice(0, 4));
  const toYear = Number(toDate.slice(0, 4));
  for (let year = fromYear; year <= toYear; year += 1) {
    const calendar = await activities.loadCalendar(year);
    for (const symbol of input.symbols) {
      const normalizedSymbol = symbol.toUpperCase();
      for (const entry of calendar) {
        if (entry.settlementDate < fromDate || entry.settlementDate > toDate) {
          continue;
        }
        await upsertWorkflowSearchAttributes({
          dataset: 'SHORT_INT',
          granularity: 'semi_monthly',
          tradeDate: entry.settlementDate,
          symbol: normalizedSymbol,
          runKind,
          provenance: 'FINRA_SHORT_INTEREST',
          batchId: `short-interest:${normalizedSymbol}:${entry.settlementDate}`,
        });
        await activities.fetchShortInterest({
          symbol: normalizedSymbol,
          settlementDate: entry.settlementDate,
          publicationDate: entry.publicationDate,
        });
      }
    }
  }
}
