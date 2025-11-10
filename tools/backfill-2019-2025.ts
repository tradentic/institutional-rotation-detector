import { createTemporalConnection } from '../apps/temporal-worker/temporal.config.ts';

async function main() {
  const ticker = process.argv[2];
  if (!ticker) {
    console.error('Usage: ts-node backfill-2019-2025.ts <ticker>');
    process.exit(1);
  }
  const temporal = await createTemporalConnection({
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'rotation-detector',
  });
  const handle = await temporal.connection
    .workflowClient()
    .start('ingestIssuerWorkflow', {
      args: [
        {
          ticker,
          minPct: 5,
          from: '2019-01-01',
          to: '2025-12-31',
          runKind: 'backfill',
          quarterBatch: Number(process.env.QUARTER_BATCH ?? '8'),
        },
      ],
      taskQueue: temporal.taskQueue,
    });
  console.log(`Started workflow ${handle.id} run ${handle.firstExecutionRunId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
