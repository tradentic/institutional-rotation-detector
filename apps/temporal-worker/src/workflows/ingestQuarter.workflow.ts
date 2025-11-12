import { proxyActivities, startChild } from '@temporalio/workflow';
import { quarterBounds, upsertWorkflowSearchAttributes } from './utils';
import type { RotationDetectInput } from './rotationDetect.workflow';

const activities = proxyActivities<{
  fetchFilings: (cik: string, quarter: { start: string; end: string }, forms: string[]) => Promise<any>;
  parse13FInfoTables: (accessions: any[]) => Promise<number>;
  parse13G13D: (accessions: any[]) => Promise<number>;
  seedCusipMappings: (cik: string, cusips: string[]) => Promise<number>;
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
  ticker: string;
  runKind: 'backfill' | 'daily';
  quarterStart: string;
  quarterEnd: string;
  etfUniverse?: string[];
}

export async function ingestQuarterWorkflow(input: IngestQuarterInput) {
  const bounds = {
    start: input.quarterStart,
    end: input.quarterEnd,
  };
  await upsertWorkflowSearchAttributes({
    ticker: input.ticker,
    cik: input.cik,
    runKind: input.runKind,
    windowKey: input.quarter,
    periodEnd: bounds.end,
    batchId: `quarter:${input.runKind}:${input.quarter}`,
  });

  const filings = await activities.fetchFilings(input.cik, bounds, [
    '13F-HR',
    '13F-HR/A',
    '13G',
    '13G-A',
    '13D',
    '13D-A',
    '10-K',
    '10-Q',
    '8-K',
  ]);

  // Filter filings by form type before parsing
  const filings13F = filings.filter((f: any) => f.form === '13F-HR' || f.form === '13F-HR/A');
  const filings13G13D = filings.filter((f: any) =>
    f.form === '13G' || f.form === '13G-A' || f.form === '13G/A' ||
    f.form === '13D' || f.form === '13D-A' || f.form === '13D/A'
  );

  if (filings13F.length > 0) {
    await activities.parse13FInfoTables(filings13F);
  }

  if (filings13G13D.length > 0) {
    await activities.parse13G13D(filings13G13D);
  }

  // Seed CUSIP mappings for issuer companies that don't file 13F-HR
  // This ensures FINRA activities can map short interest/ATS data to the issuer
  await activities.seedCusipMappings(input.cik, input.cusips);

  const derivedBounds = quarterBounds(input.quarter);
  const months = [derivedBounds.start.slice(0, 7), derivedBounds.end.slice(0, 7)].map((month) => ({ month }));
  await activities.fetchMonthly(input.cik, months);
  await activities.fetchDailyHoldings(input.cusips, input.etfUniverse ?? ['IWB', 'IWM', 'IWN', 'IWC']);
  await activities.fetchShortInterest(input.cik, [bounds.start]);
  await activities.fetchATSWeekly(input.cik, [bounds.end]);

  const child = await startChild('rotationDetectWorkflow', {
    args: [
        {
          cik: input.cik,
          cusips: input.cusips,
          quarter: input.quarter,
          ticker: input.ticker,
          runKind: input.runKind,
          quarterStart: bounds.start,
          quarterEnd: bounds.end,
        } satisfies RotationDetectInput,
      ],
    });
  await child.result();
}
