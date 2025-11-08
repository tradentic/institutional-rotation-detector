import { createTemporalConnection } from '../../temporal-worker/temporal.config.js';
import type { GraphSummarizeInput } from '../../temporal-worker/src/workflows/graphSummarize.workflow.js';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker') ?? undefined;
  const cik = url.searchParams.get('cik') ?? undefined;
  const period = url.searchParams.get('period');
  if ((!ticker && !cik) || !period) {
    return new Response('Missing parameters', { status: 400 });
  }
  const temporalConfig = await createTemporalConnection({
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'rotation-detector',
  });
  const client = temporalConfig.connection.workflowClient();
  const result = await client.execute('graphSummarizeWorkflow', {
    args: [
      {
        ticker,
        cik: cik ?? '',
        quarter: period,
        runKind: 'daily',
      } satisfies GraphSummarizeInput,
    ],
    taskQueue: temporalConfig.taskQueue,
    workflowId: `graph-communities-${(ticker ?? cik) ?? 'unknown'}-${period}-${Date.now()}`,
  });
  return Response.json({
    communityIds: result.communityIds,
    summaries: result.summaries,
  });
}
