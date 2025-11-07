import { proxyActivities, setSearchAttributes, startChild } from '@temporalio/workflow';
import { quarterBounds } from './utils.js';
import type { RotationDetectInput } from './rotationDetect.workflow.js';

const activities = proxyActivities<{
  fetchFilings: (cik: string, quarter: { start: string; end: string }, forms: string[]) => Promise<any>;
  parse13FInfoTables: (accessions: any[]) => Promise<number>;
  parse13G13D: (accessions: any[]) => Promise<number>;
  fetchMonthly: (cik: string, months: { month: string }[]) => Promise<number>;
  fetchDailyHoldings: (cusips: string[], funds: string[]) => Promise<number>;
  fetchShortInterest: (cik: string, settleDates: string[]) => Promise<number>;
  fetchATSWeekly: (cik: string, weeks: string[]) => Promise<number>;
}>(
  {
    startToCloseTimeout: '5 minutes',
  }
);

export interface IngestQuarterInput {
  cik: string;
  cusips: string[];
  quarter: string;
}

export async function ingestQuarterWorkflow(input: IngestQuarterInput) {
  const bounds = quarterBounds(input.quarter);
  await setSearchAttributes({
    quarter_start: bounds.start,
    quarter_end: bounds.end,
  });

  const filings = await activities.fetchFilings(input.cik, bounds, [
    '13F-HR',
    '13G',
    '13G-A',
    '13D',
    '13D-A',
    '10-K',
    '10-Q',
    '8-K',
  ]);

  await activities.parse13FInfoTables(filings);
  await activities.parse13G13D(filings);

  const months = [bounds.start.slice(0, 7), bounds.end.slice(0, 7)].map((month) => ({ month }));
  await activities.fetchMonthly(input.cik, months);
  await activities.fetchDailyHoldings(input.cusips, process.env.ISHARES_FUNDS?.split(',') ?? []);
  await activities.fetchShortInterest(input.cik, [bounds.start]);
  await activities.fetchATSWeekly(input.cik, [bounds.end]);

  const child = await startChild<RotationDetectInput>('rotationDetectWorkflow', {
    args: [
      {
        cik: input.cik,
        cusips: input.cusips,
        quarter: input.quarter,
      } satisfies RotationDetectInput,
    ],
  });
  await child.result();
}
