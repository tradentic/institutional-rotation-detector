import { continueAsNew, proxyActivities, startChild } from '@temporalio/workflow';
import {
  quarterBounds,
  quarterWindowKey,
  rangeWindowKey,
  resolveQuarterRange,
  upsertWorkflowSearchAttributes,
} from './utils.js';
import type { IngestQuarterInput } from './ingestQuarter.workflow.js';

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

export async function ingestIssuerWorkflow(input: IngestIssuerInput) {
  const quarterBatch = input.quarterBatch ?? 8;
  const quarters = input.quarters ?? resolveQuarterRange(input.from, input.to);
  const { cik, cusips } = await resolveCIK(input.ticker);
  const etfUniverse = ['IWB', 'IWM', 'IWN', 'IWC'];
  const currentBatch = quarters.slice(0, quarterBatch);
  const remaining = quarters.slice(quarterBatch);
  const firstQuarter = (currentBatch[0] ?? quarters[0]) ?? null;
  const bounds = firstQuarter ? quarterBounds(firstQuarter) : { start: input.from, end: input.to };
  const windowKey = firstQuarter
    ? quarterWindowKey(firstQuarter)
    : rangeWindowKey(bounds.start, bounds.end, 'issuer-range');

  await upsertWorkflowSearchAttributes({
    ticker: input.ticker,
    cik,
    runKind: input.runKind,
    windowKey,
    periodEnd: bounds.end,
    batchId: `issuer:${input.runKind}:${input.ticker}:${currentBatch.length}`,
  });

  for (const quarter of currentBatch) {
    const quarterBoundsForChild = quarterBounds(quarter);
    const child = await startChild<IngestQuarterInput>('ingestQuarterWorkflow', {
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
        } satisfies IngestQuarterInput,
      ],
    });
    await child.result();
  }

  if (remaining.length > 0) {
    await continueAsNew<typeof ingestIssuerWorkflow>({
      ...input,
      quarters: remaining,
    });
  }
}
