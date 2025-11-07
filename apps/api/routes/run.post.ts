import { createTemporalConnection } from '../temporal-worker/temporal.config.js';
import type { IngestIssuerInput } from '../temporal-worker/src/workflows/ingestIssuer.workflow.js';

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker');
  const minPct = Number(url.searchParams.get('min_pct') ?? '5');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const runKind = (url.searchParams.get('runKind') ?? 'daily') as IngestIssuerInput['runKind'];
  if (!ticker || !from || !to) {
    return new Response('Missing parameters', { status: 400 });
  }
  const temporalConfig = await createTemporalConnection({
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'rotation-detector',
  });
  const client = temporalConfig.connection.workflowClient();
  const handle = await client.start('ingestIssuerWorkflow', {
    args: [
      {
        ticker,
        minPct,
        from,
        to,
        runKind,
        quarterBatch: Number(process.env.QUARTER_BATCH ?? '8'),
      } satisfies IngestIssuerInput,
    ],
    taskQueue: temporalConfig.taskQueue,
  });
  return Response.json({ workflowId: handle.id, runId: handle.firstExecutionRunId });
}
