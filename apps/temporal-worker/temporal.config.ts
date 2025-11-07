import { Connection } from '@temporalio/client';

export interface TemporalConfig {
  namespace: string;
  taskQueue: string;
}

export async function createTemporalConnection(config: TemporalConfig) {
  const connection = await Connection.connect({});
  return {
    connection,
    namespace: config.namespace,
    taskQueue: config.taskQueue,
  };
}
