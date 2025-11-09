import { proxyActivities } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils.js';
import type { EventStudyResult } from '../activities/prices.activities.js';

const { eventStudy } = proxyActivities<{
  eventStudy: (anchorDate: string, cik: string) => Promise<EventStudyResult>;
}>({
  startToCloseTimeout: '5 minutes',
});

export interface EventStudyInput {
  anchorDate: string;
  cik: string;
  ticker: string;
  runKind: 'backfill' | 'daily';
  quarterStart: string;
  quarterEnd: string;
}

export async function eventStudyWorkflow(input: EventStudyInput): Promise<EventStudyResult> {
  await upsertWorkflowSearchAttributes({
    ticker: input.ticker,
    cik: input.cik,
    runKind: input.runKind,
    windowKey: `event:${input.anchorDate}`,
    periodEnd: input.anchorDate,
    batchId: `event-study:${input.cik}:${input.anchorDate}`,
  });

  // Compute event study metrics (CAR, max return, time to +20%, max drawdown)
  const result = await eventStudy(input.anchorDate, input.cik);

  return result;
}
