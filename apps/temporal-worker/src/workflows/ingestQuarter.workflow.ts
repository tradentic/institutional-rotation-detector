import { proxyActivities, startChild } from '@temporalio/workflow';
import { DEFAULT_ETF_UNIVERSE, quarterBounds, upsertWorkflowSearchAttributes } from './utils';
import type { RotationDetectInput } from './rotationDetect.workflow';

const activities = proxyActivities<{
  fetchFilings: (cik: string, quarter: { start: string; end: string }, forms: string[]) => Promise<any>;
  parse13FInfoTables: (accessions: any[]) => Promise<number>;
  parse13G13D: (accessions: any[]) => Promise<number>;
  fetchMonthly: (cik: string, months: { month: string }[]) => Promise<number>;
  fetchDailyHoldings: (cusips: string[], funds: string[], cik?: string) => Promise<number>;
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
  entityKind?: 'issuer' | 'manager' | 'fund' | 'etf';
}

/**
 * Generate FINRA settlement dates (15th and month-end) between from and to dates
 */
function generateSettlementDates(from: string, to: string): string[] {
  const start = new Date(from);
  const end = new Date(to);
  const settlements: string[] = [];

  let current = new Date(start.getFullYear(), start.getMonth(), 1);

  while (current <= end) {
    // Mid-month (15th)
    const midMonth = new Date(current.getFullYear(), current.getMonth(), 15);
    if (midMonth >= start && midMonth <= end) {
      settlements.push(midMonth.toISOString().slice(0, 10));
    }

    // Month-end
    const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
    if (monthEnd >= start && monthEnd <= end) {
      settlements.push(monthEnd.toISOString().slice(0, 10));
    }

    // Move to next month
    current.setMonth(current.getMonth() + 1);
  }

  return settlements;
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

/**
 * Generate all week-ending Fridays between from and to dates
 * FINRA ATS data is published weekly for week-ending dates
 */
function generateWeekEndingDates(from: string, to: string): string[] {
  const start = new Date(from);
  const end = new Date(to);
  const weeks: string[] = [];

  // Find first Friday on or after start date
  let current = new Date(start);
  const dayOfWeek = current.getDay();
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  current.setDate(current.getDate() + daysUntilFriday);

  // Generate all Fridays until end date
  while (current <= end) {
    weeks.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 7); // Next Friday
  }

  return weeks;
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

  // Generate all FINRA settlement dates (15th and month-end) for the quarter
  const settlementDates = generateSettlementDates(bounds.start, bounds.end);
  await activities.fetchShortInterest(input.cik, settlementDates);

  // Generate all week-ending Fridays for FINRA ATS data
  const weekEndingDates = generateWeekEndingDates(bounds.start, bounds.end);
  await activities.fetchATSWeekly(input.cik, weekEndingDates);

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
