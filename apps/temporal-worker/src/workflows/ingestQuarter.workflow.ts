import { proxyActivities, startChild } from '@temporalio/workflow';
import { DEFAULT_ETF_UNIVERSE, quarterBounds, upsertWorkflowSearchAttributes } from './utils';
import type { RotationDetectInput } from './rotationDetect.workflow';

const activities = proxyActivities<{
  fetchFilings: (cik: string, quarter: { start: string; end: string }, forms: string[]) => Promise<any>;
  parse13FInfoTables: (accessions: any[]) => Promise<number>;
  parse13G13D: (accessions: any[]) => Promise<number>;
  fetchMonthly: (cik: string, months: { month: string }[]) => Promise<number>;
  fetchDailyHoldings: (cusips: string[], funds: string[], cik?: string) => Promise<number>;
  fetchShortInterest: (cik: string, dateRange: { start: string; end: string }) => Promise<number>;
  fetchATSWeekly: (cik: string, dateRange: { start: string; end: string }) => Promise<number>;
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
  entityKind?: 'issuer' | 'manager' | 'fund' | 'etf';
}

/**
 * Generate all months (YYYY-MM) between from and to dates
 */
function generateMonths(from: string, to: string): Array<{ month: string }> {
  const start = new Date(from);
  const end = new Date(to);
  const months: Array<{ month: string }> = [];

  let current = new Date(start.getFullYear(), start.getMonth(), 1);

  while (current <= end) {
    months.push({ month: current.toISOString().slice(0, 7) });
    current.setMonth(current.getMonth() + 1);
  }

  return months;
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

  // CUSIP mappings are now auto-populated by activities via upsertCusipMapping()
  // Each activity (fetchShortInterest, fetchATSWeekly, computeDumpContext) handles this internally

  // Generate all months in the quarter for N-PORT holdings
  const months = generateMonths(bounds.start, bounds.end);

  // Only fetch N-PORT monthly holdings for funds (not for issuers)
  // Funds file N-PORT, issuers don't
  if (!input.entityKind || input.entityKind === 'fund' || input.entityKind === 'manager') {
    await activities.fetchMonthly(input.cik, months);
  }

  await activities.fetchDailyHoldings(input.cusips, input.etfUniverse ?? [...DEFAULT_ETF_UNIVERSE], input.cik);

  // Fetch FINRA short interest for entire quarter (activity will filter by settlement dates)
  await activities.fetchShortInterest(input.cik, { start: bounds.start, end: bounds.end });

  // Fetch FINRA ATS data for entire quarter (activity will filter by week-ending dates)
  await activities.fetchATSWeekly(input.cik, { start: bounds.start, end: bounds.end });

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
