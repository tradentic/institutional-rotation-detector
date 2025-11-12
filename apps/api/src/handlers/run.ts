/**
 * Run Handler
 *
 * Triggers rotation analysis workflows via Temporal.
 * This handler can be used in any server framework.
 */

import { Connection, WorkflowClient } from '@temporalio/client';
import type { IngestIssuerInput } from '../../../temporal-worker/src/workflows/ingestIssuer.workflow';

export interface RunParams {
  ticker: string;
  from: string;
  to: string;
  minPct?: number;
  runKind?: IngestIssuerInput['runKind'];
  quarterBatch?: number;
}

export interface TemporalConfig {
  namespace?: string;
  taskQueue?: string;
  address?: string;
}

/**
 * Core handler logic
 */
export async function handlePostRun(
  params: RunParams,
  temporalConfig: TemporalConfig = {}
): Promise<Response> {
  const {
    ticker,
    from,
    to,
    minPct = 5,
    runKind = 'daily',
    quarterBatch = 8,
  } = params;

  if (!ticker || !from || !to) {
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

  // Start workflow
  const handle = await client.start('ingestIssuerWorkflow', {
    args: [
      {
        ticker,
        minPct,
        from,
        to,
        runKind,
        quarterBatch,
      } satisfies IngestIssuerInput,
    ],
    taskQueue: temporalConfig.taskQueue ?? process.env.TEMPORAL_TASK_QUEUE ?? 'rotation-detector',
    workflowId: `ingestion-${ticker}-${Date.now()}`,
  });

  return Response.json({
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  });
}

/**
 * Web Standard Request handler
 */
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const params: RunParams = {
    ticker: url.searchParams.get('ticker') ?? '',
    from: url.searchParams.get('from') ?? '',
    to: url.searchParams.get('to') ?? '',
    minPct: Number(url.searchParams.get('min_pct') ?? '5'),
    runKind: (url.searchParams.get('runKind') ?? 'daily') as IngestIssuerInput['runKind'],
    quarterBatch: Number(url.searchParams.get('quarterBatch') ?? process.env.QUARTER_BATCH ?? '8'),
  };

  return handlePostRun(params);
}
