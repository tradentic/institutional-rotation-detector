import { continueAsNew, proxyActivities, startChild } from '@temporalio/workflow';
import { DEFAULT_ETF_UNIVERSE, quarterBounds, resolveQuarterRange, upsertWorkflowSearchAttributes } from './utils';
import type { IngestQuarterInput, IngestQuarterResult } from './ingestQuarter.workflow';
import type { IngestIssuerResult } from './types';

const { resolveCIK } = proxyActivities<{ resolveCIK: (ticker: string) => Promise<{ cik: string; cusips: string[] }> }>(
  {
    startToCloseTimeout: '1 minute',
  }
);

export interface IngestIssuerInput {
  ticker: string;
  minPct: number;
  from: string;
  to: string;
  runKind: 'backfill' | 'daily';
  quarters?: string[];
  quarterBatch?: number;
}

export async function ingestIssuerWorkflow(input: IngestIssuerInput): Promise<IngestIssuerResult> {
  const startTime = Date.now();
  const quarterBatch = input.quarterBatch ?? 8;
  const quarters = input.quarters ?? resolveQuarterRange(input.from, input.to);
  const { cik, cusips } = await resolveCIK(input.ticker);
  const etfUniverse = [...DEFAULT_ETF_UNIVERSE];
  const currentBatch = quarters.slice(0, quarterBatch);
  const remaining = quarters.slice(quarterBatch);
  const firstQuarter = (currentBatch[0] ?? quarters[0]) ?? null;
  const bounds = firstQuarter ? quarterBounds(firstQuarter) : { start: input.from, end: input.to };

  await upsertWorkflowSearchAttributes({
    ticker: input.ticker,
    cik,
    runKind: input.runKind,
    windowKey: firstQuarter ?? `${bounds.start}:${bounds.end}`,
    periodEnd: bounds.end,
    batchId: `issuer:${input.runKind}:${input.ticker}:${currentBatch.length}`,
  });

  const quarterResults: IngestIssuerResult['quarterResults'] = [];
  let totalSucceeded = 0;
  let totalFailed = 0;
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const quarter of currentBatch) {
    const quarterBoundsForChild = quarterBounds(quarter);
    try {
      const child = await startChild<typeof import('./ingestQuarter.workflow').ingestQuarterWorkflow>('ingestQuarterWorkflow', {
        args: [
          {
            cik,
            cusips,
            quarter,
            ticker: input.ticker,
            runKind: input.runKind,
            quarterStart: quarterBoundsForChild.start,
            quarterEnd: quarterBoundsForChild.end,
            etfUniverse,
            entityKind: 'issuer',
          } satisfies IngestQuarterInput,
        ],
      });

      const result = await child.result();

      quarterResults.push({
        quarter,
        status: result.status === 'success' ? 'success' : 'failed',
        message: result.message,
      });

      if (result.status === 'success') {
        totalSucceeded++;
      } else {
        totalFailed++;
        if (result.errors) {
          errors.push(...result.errors.map(e => `${quarter}: ${e}`));
        }
      }

      if (result.warnings) {
        warnings.push(...result.warnings.map(w => `${quarter}: ${w}`));
      }
    } catch (error) {
      quarterResults.push({
        quarter,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
      totalFailed++;
      errors.push(`${quarter}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const endTime = Date.now();
  const hasMoreQuarters = remaining.length > 0;

  // If more quarters to process, continue as new
  if (hasMoreQuarters) {
    await continueAsNew<typeof ingestIssuerWorkflow>({
      ...input,
      quarters: remaining,
    });
  }

  // Build result summary
  const status = totalFailed === 0 ? 'success' : (totalSucceeded > 0 ? 'partial_success' : 'failed');
  const result: IngestIssuerResult = {
    status,
    message: `Processed ${currentBatch.length} quarters for ${input.ticker}: ${totalSucceeded} succeeded, ${totalFailed} failed${hasMoreQuarters ? ` (${remaining.length} more to process)` : ''}`,
    metrics: {
      processed: currentBatch.length,
      succeeded: totalSucceeded,
      failed: totalFailed,
      skipped: 0,
    },
    timing: {
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date(endTime).toISOString(),
      durationMs: endTime - startTime,
    },
    entity: {
      ticker: input.ticker,
      cik,
      cusips,
    },
    dateRange: {
      start: input.from,
      end: input.to,
    },
    quarters: currentBatch,
    hasMoreQuarters,
    quarterResults,
    warnings: warnings.length > 0 ? warnings : undefined,
    errors: errors.length > 0 ? errors : undefined,
    links: {
      queries: [
        `-- View rotation events for ${input.ticker}`,
        `SELECT * FROM rotation_events WHERE issuer_cik = '${cik}' ORDER BY anchor_filing DESC LIMIT 10;`,
        ``,
        `-- View ATS data for ${input.ticker}`,
        `SELECT week_end, cusip, venue, shares FROM ats_weekly WHERE cusip IN (${cusips.map(c => `'${c}'`).join(',')}) ORDER BY week_end DESC LIMIT 20;`,
      ],
    },
  };

  return result;
}
