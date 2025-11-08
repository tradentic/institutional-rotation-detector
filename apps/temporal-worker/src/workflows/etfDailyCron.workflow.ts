import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils.js';
import type {
  EtfDailyPlanInput,
  EtfDailyPlanResult,
} from '../activities/etf.activities.js';

const DEFAULT_FUNDS = ['IWB', 'IWM', 'IWN', 'IWC'];
const DEFAULT_CADENCE_MS = 24 * 60 * 60 * 1000; // daily

const activities = proxyActivities<{
  planEtfDailySnapshots: (input: EtfDailyPlanInput) => Promise<EtfDailyPlanResult>;
  fetchDailyHoldings: (cusips: string[], funds: string[]) => Promise<number>;
}>({
  startToCloseTimeout: '10 minutes',
});

export interface EtfDailyCronInput {
  cadenceMs?: number;
  lastAsOf?: string | null;
  funds?: string[];
}

function previousDay(date: Date): string {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() - 1);
  return copy.toISOString().slice(0, 10);
}

function nextDay(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export async function etfDailyCronWorkflow(input: EtfDailyCronInput = {}) {
  const cadenceMs = input.cadenceMs ?? DEFAULT_CADENCE_MS;
  const funds = input.funds && input.funds.length > 0 ? input.funds : DEFAULT_FUNDS;

  const now = new Date();
  const targetAsOf = input.lastAsOf ?? previousDay(now);

  const plan = await activities.planEtfDailySnapshots({
    asOf: targetAsOf,
    funds,
  });

  if (plan.funds.length > 0 && plan.cusips.length > 0) {
    await activities.fetchDailyHoldings(plan.cusips, plan.funds);
  }

  const nextAsOf = plan.nextAsOf ?? nextDay(targetAsOf);

  await upsertWorkflowSearchAttributes({
    runKind: 'daily',
    windowKey: `etf:${plan.asOf}`,
    batchId: 'etf-daily',
  });

  await sleep(cadenceMs);

  await continueAsNew<typeof etfDailyCronWorkflow>({
    ...input,
    cadenceMs,
    funds,
    lastAsOf: nextAsOf,
  });
}
