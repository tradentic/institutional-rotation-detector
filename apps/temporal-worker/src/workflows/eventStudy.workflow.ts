import { proxyActivities } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils.js';

const { eventStudy } = proxyActivities<{ eventStudy: (anchorDate: string, cik: string) => Promise<any> }>(
  {
    startToCloseTimeout: '1 minute',
  }
);

export interface EventStudyInput {
  anchorDate: string;
  cik: string;
  ticker: string;
  runKind: 'backfill' | 'daily';
  quarterStart: string;
  quarterEnd: string;
}

export async function eventStudyWorkflow(input: EventStudyInput) {
  await upsertWorkflowSearchAttributes({
    ticker: input.ticker,
    cik: input.cik,
    runKind: input.runKind,
    quarterStart: input.quarterStart,
    quarterEnd: input.quarterEnd,
  });
  return eventStudy(input.anchorDate, input.cik);
}
