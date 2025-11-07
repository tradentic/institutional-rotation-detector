import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { IngestIssuerInput } from '../workflows/ingestIssuer.workflow.js';

let env: TestWorkflowEnvironment;

const activities = {
  resolveCIK: async () => ({ cik: '0000000000', cusips: ['000000000'] }),
  fetchFilings: async () => [],
  parse13FInfoTables: async () => 0,
  parse13G13D: async () => 0,
  fetchMonthly: async () => 0,
  fetchDailyHoldings: async () => 0,
  fetchShortInterest: async () => 0,
  fetchATSWeekly: async () => 0,
  detectDumpEvents: async () => [{ clusterId: 'c1', anchorDate: '2020-06-30', seller: 'seller', delta: -0.4 }],
  uptakeFromFilings: async () => ({ uSame: 0.2, uNext: 0.1 }),
  uhf: async () => ({ uhfSame: 0.2, uhfNext: 0.1 }),
  optionsOverlay: async () => ({ optSame: 0.1, optNext: 0.05 }),
  shortReliefV2: async () => 0.2,
  scoreV4_1: async () => ({}),
  buildEdges: async () => ({}),
  eventStudy: async () => ({}),
};

describe('Temporal workflows', () => {
  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  test(
    'ingestIssuer workflow fans out deterministically and continues as new',
    async () => {
      const originalFetch = global.fetch;
      const fetchCalls: any[] = [];
      (global as any).fetch = (...args: any[]) => {
        fetchCalls.push(args);
        throw new Error('network not allowed in workflow');
      };
      const worker = await Worker.create({
        connection: env.nativeConnection,
        namespace: env.client.namespace,
        taskQueue: 'test-queue',
        workflowsPath: new URL('../workflows/index.ts', import.meta.url).pathname,
        activities,
      });

      const workerRun = worker.run();
      try {
        const handle = await env.client.workflow.start('ingestIssuerWorkflow', {
          taskQueue: 'test-queue',
          workflowId: 'test-ingest-issuer',
          args: [
            {
              ticker: 'IRBT',
              minPct: 5,
              from: '2020-01-01',
              to: '2020-12-31',
              runKind: 'backfill',
              quarterBatch: 2,
            } satisfies IngestIssuerInput,
          ],
        });
        await env.sleep('5s');
        const info = await handle.describe();
        expect(info.execution?.runId).not.toBe(handle.firstExecutionRunId);
        expect(fetchCalls.length).toBe(0);
        await handle.terminate('test complete');
      } finally {
        (global as any).fetch = originalFetch;
        await worker.shutdown();
        await workerRun;
      }
    },
    60000
  );
});
