import { upsertWorkflowSearchAttributes, type WorkflowSearchAttributes } from './utils.js';

export type TestProbeInput = WorkflowSearchAttributes & {
  ticker?: string;
  cik: string;
  runKind: 'backfill' | 'daily' | 'query';
  windowKey: string;
  periodEnd: string;
  batchId: string;
};

export async function testSearchAttributesWorkflow(input: TestProbeInput) {
  const applied = await upsertWorkflowSearchAttributes({
    ticker: input.ticker,
    cik: input.cik,
    runKind: input.runKind,
    windowKey: input.windowKey,
    periodEnd: input.periodEnd,
    batchId: input.batchId,
    filerCik: input.filerCik,
    form: input.form,
    accession: input.accession,
  });
  return applied;
}
