import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils.js';
import { incrementIteration, DEFAULT_MAX_ITERATIONS } from './continueAsNewHelper.js';
import type {
  NportMonthlyPlanInput,
  NportMonthlyPlanResult,
} from '../activities/nport.activities.js';

const DEFAULT_CADENCE_MS = 12 * 60 * 60 * 1000; // 12 hours

const activities = proxyActivities<{
  planNportMonthlySnapshots: (input: NportMonthlyPlanInput) => Promise<NportMonthlyPlanResult>;
  fetchMonthly: (cik: string, months: { month: string }[]) => Promise<number>;
}>({
  startToCloseTimeout: '10 minutes',
});

export interface NportMonthlyTimerInput {
  cadenceMs?: number;
  lastMonth?: string | null;
  maxMonths?: number;
  iterationCount?: number;
  maxIterations?: number;
}

function currentDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function nportMonthlyTimerWorkflow(input: NportMonthlyTimerInput = {}) {
  const cadenceMs = input.cadenceMs ?? DEFAULT_CADENCE_MS;
  const lastMonth = input.lastMonth ?? null;
  const maxMonths = input.maxMonths ?? 1;
  const maxIter = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const iterationCount = incrementIteration(input.iterationCount, maxIter);

  const plan = await activities.planNportMonthlySnapshots({
    lastMonth,
    now: currentDateString(),
    maxMonths,
  });

  if (plan.months.length > 0 && plan.ciks.length > 0) {
    for (const cik of plan.ciks) {
      await activities.fetchMonthly(cik, plan.months);
    }
  }

  const nextCursor = plan.nextCursor ?? lastMonth;

  await upsertWorkflowSearchAttributes({
    runKind: 'daily',
    windowKey: plan.months[0]?.month ? `nport:${plan.months[0]?.month}` : undefined,
    batchId: 'nport-monthly',
  });

  await sleep(cadenceMs);

  // Continue-As-New to prevent unbounded history growth
  await continueAsNew<typeof nportMonthlyTimerWorkflow>({
    ...input,
    cadenceMs,
    lastMonth: nextCursor,
    maxMonths,
    iterationCount,
    maxIterations: maxIter,
  });
}
