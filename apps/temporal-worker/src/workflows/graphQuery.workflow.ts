import { proxyActivities } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils';
import type {
  ResolveIssuerNodeInput,
  ResolveIssuerNodeResult,
} from '../activities/graph.activities';
import type { KHopInput, NeighborhoodResult } from '../activities/graphrag.activities';
import type {
  BundleForSynthesisInput,
  SynthesisBundle,
  SynthesizeInput,
  SynthesizeResult,
} from '../activities/longcontext.activities';

const {
  resolveIssuerNode,
  kHopNeighborhood,
  bundleForSynthesis,
  synthesizeWithOpenAI,
} = proxyActivities<{
  resolveIssuerNode(input: ResolveIssuerNodeInput): Promise<ResolveIssuerNodeResult>;
  kHopNeighborhood(input: KHopInput): Promise<NeighborhoodResult>;
  bundleForSynthesis(input: BundleForSynthesisInput): Promise<SynthesisBundle>;
  synthesizeWithOpenAI(input: SynthesizeInput): Promise<SynthesizeResult>;
}>(
  {
    startToCloseTimeout: '3 minutes',
    scheduleToCloseTimeout: '10 minutes',
  }
);

export interface GraphQueryInput {
  ticker?: string;
  cik?: string;
  from: string;
  to: string;
  hops: number;
  runKind?: 'backfill' | 'daily' | 'query';
  edgeIds?: string[];
  question?: string;
}

export interface GraphQueryOutput {
  issuer: ResolveIssuerNodeResult;
  neighborhood: NeighborhoodResult;
  explanation?: SynthesizeResult;
}

export async function graphQueryWorkflow(input: GraphQueryInput): Promise<GraphQueryOutput> {
  let issuer: ResolveIssuerNodeResult;
  let neighborhood: NeighborhoodResult = { nodes: [], edges: [], paths: [] };
  const windowKey = `graph:${input.from}:${input.to}`;
  const runKind = input.runKind ?? 'query';
  const batchId = `graph-query:${runKind}:${input.hops}`;
  if (input.ticker || input.cik) {
    issuer = await resolveIssuerNode({ ticker: input.ticker, cik: input.cik });
    await upsertWorkflowSearchAttributes({
      cik: issuer.cik,
      ticker: input.ticker ?? issuer.ticker,
      runKind,
      windowKey,
      periodEnd: input.to,
      batchId,
    });
    neighborhood = await kHopNeighborhood({
      rootNodeId: issuer.nodeId,
      hops: input.hops,
      periodStart: input.from,
      periodEnd: input.to,
    });
  } else {
    issuer = { nodeId: 'unknown', cik: 'unknown', ticker: undefined };
    await upsertWorkflowSearchAttributes({
      cik: issuer.cik !== 'unknown' ? issuer.cik : undefined,
      runKind,
      windowKey,
      periodEnd: input.to,
      batchId,
    });
  }
  let explanation: SynthesizeResult | undefined;
  const edgeIds = input.edgeIds && input.edgeIds.length > 0 ? input.edgeIds : neighborhood.paths.flatMap((path) => path.edgeIds);
  if ((input.question || edgeIds.length > 0) && edgeIds.length > 0) {
    const bundle = await bundleForSynthesis({ edgeIds: [...new Set(edgeIds)], question: input.question });
    explanation = await synthesizeWithOpenAI({ bundle });
  }
  return { issuer, neighborhood, explanation };
}
