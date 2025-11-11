import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils.js';
import type {
  FinraShortPlanInput,
  FinraShortPlanResult,
} from '../activities/finra.activities.js';

const DEFAULT_CADENCE_MS = 7 * 24 * 60 * 60 * 1000; // weekly cadence

const activities = proxyActivities<{
  planFinraShortInterest: (input: FinraShortPlanInput) => Promise<FinraShortPlanResult>;
  fetchShortInterest: (cik: string, settleDates: string[]) => Promise<number>;
}>({
  startToCloseTimeout: '10 minutes',
});

export interface FinraShortPublishInput {
  cadenceMs?: number;
  lastSettle?: string | null;
  windowSize?: number;
}

function currentDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function finraShortPublishWorkflow(input: FinraShortPublishInput = {}) {
  const cadenceMs = input.cadenceMs ?? DEFAULT_CADENCE_MS;
  const lastSettle = input.lastSettle ?? null;
  const windowSize = input.windowSize ?? 2;

  const plan = await activities.planFinraShortInterest({
    lastSettle,
    now: currentDate(),
    windowSize,
  });

  if (plan.settleDates.length > 0 && plan.ciks.length > 0) {
    for (const cik of plan.ciks) {
      await activities.fetchShortInterest(cik, plan.settleDates);
    }
  }

  const nextCursor = plan.nextCursor ?? lastSettle;

  await upsertWorkflowSearchAttributes({
    runKind: 'daily',
    windowKey: plan.settleDates[0] ? `finra:${plan.settleDates[0]}` : undefined,
    batchId: 'finra-short',
  });

  await sleep(cadenceMs);

  await continueAsNew<typeof finraShortPublishWorkflow>({
    ...input,
    cadenceMs,
    lastSettle: nextCursor,
    windowSize,
  });
}
