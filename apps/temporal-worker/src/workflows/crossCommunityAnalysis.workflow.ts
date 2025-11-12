import { proxyActivities } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils';
import type {
  AnalyzeCrossCommunitiesInput,
  AnalyzeCrossCommunitiesResult,
} from '../activities/graphrag.activities';

const { analyzeCrossCommunityPatterns } = proxyActivities<{
  analyzeCrossCommunityPatterns(input: AnalyzeCrossCommunitiesInput): Promise<AnalyzeCrossCommunitiesResult>;
}>(
  {
    startToCloseTimeout: '10 minutes', // Cross-community synthesis needs time
    scheduleToCloseTimeout: '15 minutes',
  }
);

export interface CrossCommunityAnalysisWorkflowInput {
  periodStart: string;
  periodEnd: string;
  minCommunities?: number;
  runKind?: 'analysis' | 'research';
}

/**
 * Cross-Community Analysis Workflow
 *
 * Identifies systemic patterns and trends across multiple communities
 * within a time period using GPT-5 with high reasoning effort.
 *
 * Example use cases:
 *
 * 1. Sector-Wide Rotations:
 *    "Are there coordinated rotations across tech sector communities?"
 *
 * 2. Market Regime Shifts:
 *    "What systemic patterns emerged during Q1 2024?"
 *
 * 3. Institutional Behavior:
 *    "Are communities showing correlated buying/selling patterns?"
 *
 * The workflow:
 * 1. Fetches all communities in period
 * 2. GPT-5 synthesizes cross-community patterns (CoT with high effort)
 * 3. Identifies systemic trends
 * 4. Compares communities
 * 5. Extracts key insights
 */
export async function crossCommunityAnalysisWorkflow(
  input: CrossCommunityAnalysisWorkflowInput
): Promise<AnalyzeCrossCommunitiesResult> {
  const runKind = input.runKind ?? 'analysis';

  await upsertWorkflowSearchAttributes({
    runKind,
    windowKey: `cross-community:${input.periodStart}:${input.periodEnd}`,
    periodEnd: input.periodEnd,
    batchId: `cross-community-analysis:${runKind}:${Date.now()}`,
    dataset: 'GRAPH_COMMUNITIES',
  });

  const result = await analyzeCrossCommunityPatterns({
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    minCommunities: input.minCommunities,
  });

  return result;
}
