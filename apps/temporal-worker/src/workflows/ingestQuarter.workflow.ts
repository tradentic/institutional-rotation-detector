import { proxyActivities, startChild } from '@temporalio/workflow';
import { DEFAULT_ETF_UNIVERSE, quarterBounds, upsertWorkflowSearchAttributes } from './utils';
import type { RotationDetectInput, RotationDetectResult } from './rotationDetect.workflow';
import type { IngestQuarterResult } from './types';

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

export type { IngestQuarterResult };

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


export async function ingestQuarterWorkflow(input: IngestQuarterInput): Promise<IngestQuarterResult> {
  const startTime = Date.now();
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

  const activityCounts: IngestQuarterResult['activities'] = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    // Fetch filings
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
    activityCounts.filingsFetched = Array.isArray(filings) ? filings.length : 0;

    // Filter filings by form type before parsing
    const filings13F = filings.filter((f: any) => f.form === '13F-HR' || f.form === '13F-HR/A');
    const filings13G13D = filings.filter((f: any) =>
      f.form === '13G' || f.form === '13G-A' || f.form === '13G/A' ||
      f.form === '13D' || f.form === '13D-A' || f.form === '13D/A'
    );

    // Parse 13F
    if (filings13F.length > 0) {
      activityCounts.positions13f = await activities.parse13FInfoTables(filings13F);
    }

    // Parse 13G/13D
    if (filings13G13D.length > 0) {
      activityCounts.positions13g13d = await activities.parse13G13D(filings13G13D);
    }

    // Generate all months in the quarter for N-PORT holdings
    const months = generateMonths(bounds.start, bounds.end);

    // Only fetch N-PORT monthly holdings for funds (not for issuers)
    if (!input.entityKind || input.entityKind === 'fund' || input.entityKind === 'manager') {
      activityCounts.nportHoldings = await activities.fetchMonthly(input.cik, months);
    }

    // Fetch ETF holdings
    activityCounts.etfHoldings = await activities.fetchDailyHoldings(
      input.cusips,
      input.etfUniverse ?? [...DEFAULT_ETF_UNIVERSE],
      input.cik
    );

    // Fetch FINRA data
    activityCounts.shortInterest = await activities.fetchShortInterest(input.cik, bounds);
    activityCounts.atsWeekly = await activities.fetchATSWeekly(input.cik, bounds);

    // Run rotation detection
    const child = await startChild<typeof import('./rotationDetect.workflow').rotationDetectWorkflow>(
      'rotationDetectWorkflow',
      {
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
      }
    );

    const rotationResult = await child.result();

    // Check for warnings
    if (activityCounts.atsWeekly === 0) {
      warnings.push('No ATS weekly data found - check FINRA API or CUSIP resolution');
    }
    if (activityCounts.shortInterest === 0) {
      warnings.push('No short interest data found');
    }
    if ((activityCounts.etfHoldings ?? 0) === 0) {
      warnings.push('No ETF holdings found');
    }

    const endTime = Date.now();

    return {
      status: 'success',
      message: `Successfully ingested ${input.quarter} for ${input.ticker} (CIK: ${input.cik})`,
      metrics: {
        processed: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
      },
      timing: {
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date(endTime).toISOString(),
        durationMs: endTime - startTime,
      },
      entity: {
        ticker: input.ticker,
        cik: input.cik,
        cusips: input.cusips,
      },
      dateRange: {
        start: bounds.start,
        end: bounds.end,
      },
      quarter: input.quarter,
      activities: activityCounts,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    const endTime = Date.now();
    const errorMsg = error instanceof Error ? error.message : String(error);
    errors.push(errorMsg);

    return {
      status: 'failed',
      message: `Failed to ingest ${input.quarter} for ${input.ticker}: ${errorMsg}`,
      metrics: {
        processed: 1,
        succeeded: 0,
        failed: 1,
        skipped: 0,
      },
      timing: {
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date(endTime).toISOString(),
        durationMs: endTime - startTime,
      },
      entity: {
        ticker: input.ticker,
        cik: input.cik,
        cusips: input.cusips,
      },
      dateRange: {
        start: bounds.start,
        end: bounds.end,
      },
      quarter: input.quarter,
      activities: activityCounts,
      errors,
    };
  }
}
