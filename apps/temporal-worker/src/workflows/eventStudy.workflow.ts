import { proxyActivities } from '@temporalio/workflow';

const { eventStudy } = proxyActivities<{ eventStudy: (anchorDate: string, cik: string) => Promise<any> }>(
  {
    startToCloseTimeout: '1 minute',
  }
);

export interface EventStudyInput {
  anchorDate: string;
  cik: string;
}

export async function eventStudyWorkflow(input: EventStudyInput) {
  return eventStudy(input.anchorDate, input.cik);
}
