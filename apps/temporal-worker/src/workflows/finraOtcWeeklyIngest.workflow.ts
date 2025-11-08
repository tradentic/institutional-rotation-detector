import { proxyActivities } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils.js';
import type {
  DownloadedFinraFile,
  FinraWeeklyFileDescriptor,
} from '../activities/finra.otc.activities.js';

const activities = proxyActivities<{
  listWeeklyFiles: (reportType: 'ATS' | 'NON_ATS', weekEnd: string) => Promise<FinraWeeklyFileDescriptor[]>;
  downloadWeeklyFile: (file: FinraWeeklyFileDescriptor) => Promise<DownloadedFinraFile>;
  parseVenueCsv: (file: DownloadedFinraFile, options?: { symbols?: string[] }) => Promise<number>;
  aggregateSymbolWeek: (weekEnd: string, symbols?: string[]) => Promise<number>;
}>(
  {
    startToCloseTimeout: '10 minutes',
  }
);

export interface FinraOtcWeeklyIngestInput {
  symbols?: string[];
  fromWeek?: string;
  toWeek?: string;
  runKind?: 'backfill' | 'daily';
}

function normalizeWeek(date: string): string {
  const normalized = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(normalized.getTime())) {
    throw new Error(`Invalid week boundary ${date}`);
  }
  return normalized.toISOString().slice(0, 10);
}

function enumerateWeeks(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (start > end) {
    throw new Error('fromWeek cannot be after toWeek');
  }
  const weeks: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    weeks.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weeks;
}

export async function finraOtcWeeklyIngestWorkflow(input: FinraOtcWeeklyIngestInput) {
  const runKind = input.runKind ?? 'daily';
  const toWeek = normalizeWeek(input.toWeek ?? input.fromWeek ?? new Date().toISOString().slice(0, 10));
  const fromWeek = normalizeWeek(input.fromWeek ?? toWeek);
  const symbol = input.symbols && input.symbols.length === 1 ? input.symbols[0]!.toUpperCase() : undefined;

  const weeks = enumerateWeeks(fromWeek, toWeek);
  for (const week of weeks) {
    await upsertWorkflowSearchAttributes({
      dataset: 'FINRA_OTC',
      granularity: 'weekly',
      weekEnd: week,
      runKind,
      symbol,
      provenance: 'FINRA_OTC',
      batchId: `finra-otc:${week}`,
    });
    for (const reportType of ['ATS', 'NON_ATS'] as const) {
      const files = await activities.listWeeklyFiles(reportType, week);
      for (const descriptor of files) {
        const downloaded = await activities.downloadWeeklyFile(descriptor);
        await activities.parseVenueCsv(downloaded, { symbols: input.symbols });
      }
    }
    await activities.aggregateSymbolWeek(week, input.symbols);
  }
}
