/**
 * Graph Paths Handler
 *
 * Finds paths in the rotation graph via k-hop neighborhood traversal.
 * This handler can be used in any server framework.
 */

import { Connection, WorkflowClient } from '@temporalio/client';
import type { GraphQueryInput } from '../../../temporal-worker/src/workflows/graphQuery.workflow.js';

export interface GraphPathsParams {
  ticker?: string;
  cik?: string;
  from: string;
  to: string;
  hops?: number;
}

export interface TemporalConfig {
  namespace?: string;
  taskQueue?: string;
  address?: string;
}

/**
 * Core handler logic
 */
export async function handleGetGraphPaths(
  params: GraphPathsParams,
  temporalConfig: TemporalConfig = {}
): Promise<Response> {
  const { ticker, cik, from, to, hops = 2 } = params;

  if ((!ticker && !cik) || !from || !to) {
    return new Response('Missing parameters', { status: 400 });
  }

  // Connect to Temporal
  const connection = await Connection.connect({
    address: temporalConfig.address ?? process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
  });

  const client = new WorkflowClient({
    connection,
    namespace: temporalConfig.namespace ?? process.env.TEMPORAL_NAMESPACE ?? 'default',
  });

  // Execute workflow synchronously
  const result = await client.execute('graphQueryWorkflow', {
    args: [
      {
        ticker,
        cik,
        from,
        to,
        hops,
        runKind: 'query',
      } satisfies GraphQueryInput,
    ],
    taskQueue: temporalConfig.taskQueue ?? process.env.TEMPORAL_TASK_QUEUE ?? 'rotation-detector',
    workflowId: `graph-paths-${ticker ?? cik}-${from}-${to}-${Date.now()}`,
  });

  return Response.json({
    issuer: result.issuer,
    nodes: result.neighborhood.nodes,
    edges: result.neighborhood.edges,
    topPaths: result.neighborhood.paths,
  });
}

/**
 * Web Standard Request handler
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const params: GraphPathsParams = {
    ticker: url.searchParams.get('ticker') ?? undefined,
    cik: url.searchParams.get('cik') ?? undefined,
    from: url.searchParams.get('from') ?? '',
    to: url.searchParams.get('to') ?? '',
    hops: Number(url.searchParams.get('hops') ?? '2'),
  };

  return handleGetGraphPaths(params);
}
