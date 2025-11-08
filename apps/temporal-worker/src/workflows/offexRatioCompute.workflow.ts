import { proxyActivities } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils.js';

const activities = proxyActivities<{
  computeWeeklyOfficial: (symbol: string, weekEnd: string) => Promise<void>;
  computeDailyApprox: (symbol: string, weekEnd: string) => Promise<void>;
}>(
  {
    startToCloseTimeout: '5 minutes',
  }
);

export interface OffexRatioComputeInput {
  symbols: string[];
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

function enumerateWeeks(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (start > end) {
    throw new Error('from must be before to');
  }
  const weeks: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    weeks.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weeks;
}

export async function offexRatioComputeWorkflow(input: OffexRatioComputeInput) {
  if (!input.symbols || input.symbols.length === 0) {
    throw new Error('symbols are required');
  }
  const runKind = input.runKind ?? 'daily';
  const toWeek = normalize(input.to ?? input.from ?? new Date().toISOString().slice(0, 10));
  const fromWeek = normalize(input.from ?? toWeek);
  const weeks = enumerateWeeks(fromWeek, toWeek);
  for (const symbol of input.symbols) {
    const normalizedSymbol = symbol.toUpperCase();
    for (const week of weeks) {
      await upsertWorkflowSearchAttributes({
        dataset: 'FINRA_OTC',
        granularity: 'daily',
        weekEnd: week,
        runKind,
        symbol: normalizedSymbol,
        provenance: 'FINRA_OTC_RATIO',
        batchId: `offex-ratio:${normalizedSymbol}:${week}`,
      });
      await activities.computeWeeklyOfficial(normalizedSymbol, week);
      await activities.computeDailyApprox(normalizedSymbol, week);
    }
  }
}
