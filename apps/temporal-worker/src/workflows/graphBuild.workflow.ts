import { proxyActivities, continueAsNew } from '@temporalio/workflow';
import { quarterBounds, upsertWorkflowSearchAttributes } from './utils.js';
import type { GraphBuilderResult } from '../lib/graph.js';
import type { GraphBuildActivityInput } from '../activities/graph.activities.js';

const { buildGraphForQuarter } = proxyActivities<{ buildGraphForQuarter(input: GraphBuildActivityInput): Promise<GraphBuilderResult> }>(
  {
    startToCloseTimeout: '1 minute',
    scheduleToCloseTimeout: '5 minutes',
  }
);

export interface GraphBuildInput {
  cik: string;
  quarter: string;
  ticker?: string;
  runKind: 'backfill' | 'daily';
  cursor?: string;
  maxEdgesBeforeContinue?: number;
}

export async function graphBuildWorkflow(input: GraphBuildInput): Promise<GraphBuilderResult> {
  const bounds = quarterBounds(input.quarter);
  await upsertWorkflowSearchAttributes({
    cik: input.cik,
    ticker: input.ticker,
    runKind: input.runKind,
    windowKey: input.quarter,
    periodEnd: bounds.end,
    batchId: `graph-build:${input.runKind}:${input.quarter}`,
  });
  const result = await buildGraphForQuarter({
    cik: input.cik,
    quarterStart: bounds.start,
    quarterEnd: bounds.end,
    ticker: input.ticker,
    cursor: input.cursor,
  });
  const threshold = input.maxEdgesBeforeContinue ?? 5000;
  if (result.edgesUpserted >= threshold) {
    await continueAsNew({ ...input, cursor: result.processedAccessions.join(',') });
  }
  return result;
}
