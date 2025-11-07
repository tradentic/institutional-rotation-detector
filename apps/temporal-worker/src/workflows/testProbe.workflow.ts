import { upsertWorkflowSearchAttributes, type WorkflowSearchAttributes } from './utils.js';

export type TestProbeInput = WorkflowSearchAttributes & { ticker?: string };

export async function testSearchAttributesWorkflow(input: TestProbeInput) {
  const applied = await upsertWorkflowSearchAttributes({
    ticker: input.ticker,
    cik: input.cik,
    runKind: input.runKind,
    quarterStart: input.quarterStart,
    quarterEnd: input.quarterEnd,
  });
  return applied;
}
