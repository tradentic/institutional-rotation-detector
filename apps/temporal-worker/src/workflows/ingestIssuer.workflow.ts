import { continueAsNew, proxyActivities, startChild } from '@temporalio/workflow';
import { DEFAULT_ETF_UNIVERSE, quarterBounds, resolveQuarterRange, upsertWorkflowSearchAttributes } from './utils';
import type { IngestQuarterInput } from './ingestQuarter.workflow';

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

  for (const quarter of currentBatch) {
    const quarterBoundsForChild = quarterBounds(quarter);
    const child = await startChild('ingestQuarterWorkflow', {
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
    await child.result();
  }

  if (remaining.length > 0) {
    await continueAsNew<typeof ingestIssuerWorkflow>({
      ...input,
      quarters: remaining,
    });
  }
}
