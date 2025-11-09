import { proxyActivities } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils.js';
import type {
  CreateClusterSummaryInput,
  CreateClusterSummaryResult,
} from '../activities/filing-chunks.activities.js';

const activities = proxyActivities<{
  createClusterSummary(input: CreateClusterSummaryInput): Promise<CreateClusterSummaryResult>;
  chunkFiling(input: { accession: string }): Promise<{ chunksCreated: number }>;
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
 * Enrich a rotation cluster with:
 * 1. Cluster summary (narrative explanation)
 * 2. Filing chunks with embeddings (for related filings)
 *
 * This enables GraphRAG-based explainability and semantic search.
 */
export async function clusterEnrichmentWorkflow(
  input: ClusterEnrichmentInput
): Promise<{ summary: string; filingsChunked: number }> {
  await upsertWorkflowSearchAttributes({
    cik: input.issuerCik,
    runKind: input.runKind,
    batchId: `cluster-enrichment:${input.clusterId}`,
  });

  // Generate cluster summary with LLM
  const summaryResult = await activities.createClusterSummary({
    clusterId: input.clusterId,
  });

  // TODO: Optionally chunk related filings
  // For now, skip filing chunking to avoid rate limits
  const filingsChunked = 0;

  return {
    summary: summaryResult.summary,
    filingsChunked,
  };
}
