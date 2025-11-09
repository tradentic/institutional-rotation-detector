import { proxyActivities } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils.js';

const activities = proxyActivities<{
  computeWeeklyOfficial: (symbol: string, weekEnd: string) => Promise<{ upserted: boolean; qualityFlag: string }>;
  computeDailyApprox: (symbol: string, weekEnd: string) => Promise<{ upsertCount: number; qualityFlag: string }>;
}>({
  startToCloseTimeout: '3 minutes',
  scheduleToCloseTimeout: '5 minutes',
});

export interface OffexRatioComputeInput {
  symbols: string[];
  from?: string; // week end date
  to?: string;   // week end date
}

/**
 * Off-Exchange Ratio Compute Workflow
 *
 * Computes off-exchange percentage ratios from FINRA OTC weekly data
 * and daily volume sources (consolidated or IEX proxy).
 *
 * For each symbol and week:
 * 1. Compute weekly official ratio (if consolidated data available)
 * 2. Compute daily approximations (apportioned from weekly total)
 *
 * Quality flags:
 * - 'official': FINRA week + full consolidated week
 * - 'official_partial': FINRA week only
 * - 'approx': daily apportion with consolidated
 * - 'iex_proxy': daily apportion with IEX matched shares
 */
export async function offexRatioComputeWorkflow(
  input: OffexRatioComputeInput
): Promise<{ weeklyComputed: number; dailyComputed: number }> {
  const weeks = input.from && input.to
    ? generateWeekEnds(input.from, input.to)
    : input.from
    ? [input.from]
    : [];

  let weeklyComputed = 0;
  let dailyComputed = 0;

  for (const symbol of input.symbols) {
    for (const weekEnd of weeks) {
      // Compute weekly official ratio
      const weeklyResult = await activities.computeWeeklyOfficial(symbol, weekEnd);
      if (weeklyResult.upserted) {
        weeklyComputed++;
      }

      // Compute daily approximations
      const dailyResult = await activities.computeDailyApprox(symbol, weekEnd);
      dailyComputed += dailyResult.upsertCount;
    }
  }

  await upsertWorkflowSearchAttributes({
    Dataset: 'OFFEX_RATIO',
    RunKind: 'compute',
  });

  return { weeklyComputed, dailyComputed };
}

function generateWeekEnds(fromWeek: string, toWeek: string): string[] {
  const start = new Date(fromWeek);
  const end = new Date(toWeek);
  const weeks: string[] = [];

  let current = new Date(start);
  while (current <= end) {
    weeks.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 7);
  }

  return weeks;
}
