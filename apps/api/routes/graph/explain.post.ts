import { createTemporalConnection } from '../../temporal-worker/temporal.config.ts';
import type { GraphQueryInput } from '../../temporal-worker/src/workflows/graphQuery.workflow.ts';

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.edgeIds) || body.edgeIds.length === 0) {
    return new Response('edgeIds[] required', { status: 400 });
  }
  const question = typeof body.question === 'string' ? body.question : undefined;
  const temporalConfig = await createTemporalConnection({
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'rotation-detector',
  });
  const client = temporalConfig.connection.workflowClient();
  const result = await client.execute('graphQueryWorkflow', {
    args: [
      {
        from: '1900-01-01',
        to: '2100-01-01',
        hops: 0,
        runKind: 'query',
        edgeIds: body.edgeIds,
        question,
      } satisfies GraphQueryInput,
    ],
    taskQueue: temporalConfig.taskQueue,
    workflowId: `graph-explain-${Date.now()}`,
  });
  if (!result.explanation) {
    return Response.json({ message: 'No explanation available', accessions: [] });
  }
  return Response.json({
    explanationId: result.explanation.explanationId,
    content: result.explanation.content,
    accessions: result.explanation.accessions,
  });
}
