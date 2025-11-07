import { continueAsNew, proxyActivities, startChild, upsertSearchAttributes } from '@temporalio/workflow';
import { resolveQuarterRange } from './utils.js';
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
  await upsertSearchAttributes({
    ticker: [input.ticker],
    cik: [cik],
    run_kind: [input.runKind],
  });

  const remaining = quarters.slice(quarterBatch);
  const currentBatch = quarters.slice(0, quarterBatch);

  for (const quarter of currentBatch) {
    const child = await startChild<IngestQuarterInput>('ingestQuarterWorkflow', {
      args: [
        {
          cik,
          cusips,
          quarter,
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
