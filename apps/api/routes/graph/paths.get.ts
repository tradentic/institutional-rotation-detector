import { createTemporalConnection } from '../../temporal-worker/temporal.config.js';
import type { GraphQueryInput } from '../../temporal-worker/src/workflows/graphQuery.workflow.js';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker') ?? undefined;
  const cik = url.searchParams.get('cik') ?? undefined;
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const hops = Number(url.searchParams.get('hops') ?? '2');
  if ((!ticker && !cik) || !from || !to) {
    return new Response('Missing parameters', { status: 400 });
  }
  const temporalConfig = await createTemporalConnection({
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'rotation-detector',
  });
  const client = temporalConfig.connection.workflowClient();
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
    taskQueue: temporalConfig.taskQueue,
    workflowId: `graph-paths-${(ticker ?? cik) ?? 'unknown'}-${from}-${to}-${Date.now()}`,
  });
  return Response.json({
    issuer: result.issuer,
    nodes: result.neighborhood.nodes,
    edges: result.neighborhood.edges,
    topPaths: result.neighborhood.paths,
  });
}
