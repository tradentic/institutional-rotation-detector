import { proxyActivities } from '@temporalio/workflow';
import { quarterBounds, upsertWorkflowSearchAttributes } from './utils.js';
import type { ComputeCommunitiesInput, SummarizeCommunityInput } from '../activities/graphrag.activities.js';

const {
  computeCommunities,
  summarizeCommunity,
} = proxyActivities<{
  computeCommunities(input: ComputeCommunitiesInput): Promise<{ communityIds: string[] }>;
  summarizeCommunity(input: SummarizeCommunityInput): Promise<string>;
}>(
  {
    startToCloseTimeout: '2 minutes',
    scheduleToCloseTimeout: '10 minutes',
  }
);

export interface GraphSummarizeInput {
  cik: string;
  quarter: string;
  ticker?: string;
  runKind: 'backfill' | 'daily';
  rootNodeId?: string;
}

export async function graphSummarizeWorkflow(input: GraphSummarizeInput): Promise<{ communityIds: string[]; summaries: string[] }> {
  const bounds = quarterBounds(input.quarter);
  await upsertWorkflowSearchAttributes({
    cik: input.cik,
    ticker: input.ticker,
    runKind: input.runKind,
    quarterStart: bounds.start,
    quarterEnd: bounds.end,
  });
  const result = await computeCommunities({
    periodStart: bounds.start,
    periodEnd: bounds.end,
    rootNodeId: input.rootNodeId,
  });
  const summaries: string[] = [];
  for (const communityId of result.communityIds) {
    const summary = await summarizeCommunity({ communityId });
    summaries.push(summary);
  }
  return { communityIds: result.communityIds, summaries };
}
