import { Connection, WorkflowClient } from '@temporalio/client';

let cachedClient: WorkflowClient | null = null;

export async function getTemporalClient(): Promise<WorkflowClient> {
  if (cachedClient) return cachedClient;

  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });

  cachedClient = new WorkflowClient({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
  });

  return cachedClient;
}

export type { WorkflowClient } from '@temporalio/client';
