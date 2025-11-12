/**
 * Graph Explain Handler
 *
 * Generates AI explanations for multiple edges with an optional question.
 * This handler can be used in any server framework.
 */

import { Connection, WorkflowClient } from '@temporalio/client';
import type { GraphQueryInput } from '../../../temporal-worker/src/workflows/graphQuery.workflow.js';

export interface GraphExplainParams {
  edgeIds: string[];
  question?: string;
}

export interface TemporalConfig {
  namespace?: string;
  taskQueue?: string;
  address?: string;
}

/**
 * Core handler logic
 */
export async function handlePostGraphExplain(
  params: GraphExplainParams,
  temporalConfig: TemporalConfig = {}
): Promise<Response> {
  const { edgeIds, question } = params;

  if (!Array.isArray(edgeIds) || edgeIds.length === 0) {
    return new Response('edgeIds[] required', { status: 400 });
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
        from: '1900-01-01',
        to: '2100-01-01',
        hops: 0,
        runKind: 'query',
        edgeIds,
        question,
      } satisfies GraphQueryInput,
    ],
    taskQueue: temporalConfig.taskQueue ?? process.env.TEMPORAL_TASK_QUEUE ?? 'rotation-detector',
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

/**
 * Web Standard Request handler
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { edgeIds?: string[]; question?: string };

    const params: GraphExplainParams = {
      edgeIds: body.edgeIds ?? [],
      question: body.question,
    };

    return handlePostGraphExplain(params);
  } catch (error) {
    return new Response('Invalid JSON body', { status: 400 });
  }
}
