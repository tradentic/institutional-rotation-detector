import { proxyActivities } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils.ts';
import type {
  CreateClusterSummaryInput,
  CreateClusterSummaryResult,
} from '../activities/filing-chunks.activities.ts';

const activities = proxyActivities<{
  createClusterSummary(input: CreateClusterSummaryInput): Promise<CreateClusterSummaryResult>;
}>({
  startToCloseTimeout: '5 minutes',
  scheduleToCloseTimeout: '10 minutes',
});

export interface ClusterEnrichmentInput {
  clusterId: string;
  issuerCik: string;
  runKind: 'backfill' | 'daily';
}

/**
 * Enrich a rotation cluster with narrative explanation.
 *
 * Uses graph structure + long context synthesis (no vector embeddings).
 */
export async function clusterEnrichmentWorkflow(
  input: ClusterEnrichmentInput
): Promise<{ summary: string }> {
  await upsertWorkflowSearchAttributes({
    cik: input.issuerCik,
    runKind: input.runKind,
    batchId: `cluster-enrichment:${input.clusterId}`,
  });

  // Generate cluster summary with LLM
  const summaryResult = await activities.createClusterSummary({
    clusterId: input.clusterId,
  });

  return {
    summary: summaryResult.summary,
  };
}
