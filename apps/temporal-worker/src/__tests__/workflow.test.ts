import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { isGrpcServiceError } from '@temporalio/common';
import { WorkflowNotFoundError } from '@temporalio/client';
import { status as grpcStatus } from '@grpc/grpc-js';
import { temporal } from '@temporalio/proto';
import { IngestIssuerInput } from '../workflows/ingestIssuer.workflow.js';
import type { TestProbeInput } from '../workflows/testProbe.workflow.js';

let env: TestWorkflowEnvironment;

async function ensureSearchAttributesRegistered() {
  const { IndexedValueType } = temporal.api.enums.v1;
  const searchAttributes = {
    Ticker: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
    Symbol: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
    Dataset: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
    Granularity: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
    WeekEnd: IndexedValueType.INDEXED_VALUE_TYPE_DATETIME,
    TradeDate: IndexedValueType.INDEXED_VALUE_TYPE_DATETIME,
    Provenance: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
    CIK: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
    FilerCIK: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
    Form: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
    Accession: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
    PeriodEnd: IndexedValueType.INDEXED_VALUE_TYPE_DATETIME,
    WindowKey: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
    BatchId: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
    RunKind: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
  } as const;
  try {
    await env.client.connection.operatorService.addSearchAttributes({
      namespace: env.client.namespace,
      searchAttributes,
    });
  } catch (err) {
    if (!isGrpcServiceError(err) || err.code !== grpcStatus.ALREADY_EXISTS) {
      throw err;
    }
  }
}

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
  buildEdges: async (_seller: any[], _buyer: any[], _period: any, _root: string) => ({}),
  eventStudy: async () => ({}),
};

describe('Temporal workflows', () => {
  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
    await ensureSearchAttributesRegistered();
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
              to: '2021-12-31',
              runKind: 'backfill',
              quarterBatch: 2,
            } satisfies IngestIssuerInput,
          ],
        });
        await env.sleep('5s');
        const info = await handle.describe();
        expect(info.execution?.runId).not.toBe(handle.firstExecutionRunId);
        expect(fetchCalls.length).toBe(0);
        try {
          await handle.terminate('test complete');
        } catch (err) {
          if (!(err instanceof WorkflowNotFoundError)) {
            throw err;
          }
        }
      } finally {
        (global as any).fetch = originalFetch;
        await worker.shutdown();
        await workerRun;
      }
    },
    60000
  );

  test(
    'search attribute helper exposes applied values',
    async () => {
      const worker = await Worker.create({
        connection: env.nativeConnection,
        namespace: env.client.namespace,
        taskQueue: 'test-queue',
        workflowsPath: new URL('../workflows/index.ts', import.meta.url).pathname,
        activities,
      });
      const workerRun = worker.run();
      try {
        const handle = await env.client.workflow.start('testSearchAttributesWorkflow', {
          taskQueue: 'test-queue',
          workflowId: 'test-search-attrs',
          args: [
            {
              ticker: 'IRBT',
              cik: '0001084869',
              runKind: 'backfill',
              windowKey: '2024Q1',
              periodEnd: '2024-03-31',
              batchId: 'test-batch',
              filerCik: '0000123456',
              form: '13F-HR',
              accession: '0000123456-24-000001',
            } satisfies TestProbeInput,
          ],
        });

        const viaQuery = await handle.query<Record<string, string[]>>('__workflow_search_attributes');
        expect(viaQuery).toEqual({
          Ticker: ['IRBT'],
          CIK: ['0001084869'],
          RunKind: ['backfill'],
          WindowKey: ['2024Q1'],
          PeriodEnd: ['2024-03-31T00:00:00.000Z'],
          BatchId: ['test-batch'],
          FilerCIK: ['0000123456'],
          Form: ['13F-HR'],
          Accession: ['0000123456-24-000001'],
        });

        const result = await handle.result();
        expect(result).toEqual(viaQuery);
      } finally {
        await worker.shutdown();
        await workerRun;
      }
    },
    30000
  );
});
