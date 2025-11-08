import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { WorkflowNotFoundError } from '@temporalio/client';
import { isGrpcServiceError } from '@temporalio/common';
import { status as grpcStatus } from '@grpc/grpc-js';
import { temporal } from '@temporalio/proto';

let env: TestWorkflowEnvironment;

async function ensureSearchAttributesRegistered() {
  const { IndexedValueType } = temporal.api.enums.v1;
  const searchAttributes = {
    Ticker: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
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

describe('Watcher workflows', () => {
  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
    await ensureSearchAttributesRegistered();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  test('edgar submissions poller advances cursor on cadence', async () => {
    const recordEdgarSubmissionWindow = vi
      .fn()
      .mockResolvedValueOnce({ nextCursor: '2024-02-01T00:00:00.000Z', processed: 3, accessions: ['A'] })
      .mockResolvedValueOnce({ nextCursor: '2024-03-01T00:00:00.000Z', processed: 2, accessions: ['B'] })
      .mockResolvedValue({ nextCursor: '2024-04-01T00:00:00.000Z', processed: 0, accessions: [] });

    const worker = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.client.namespace,
      taskQueue: 'watcher-tests',
      workflowsPath: new URL('../workflows/index.ts', import.meta.url).pathname,
      activities: {
        recordEdgarSubmissionWindow,
      },
    });

    const workerRun = worker.run();
    const cadenceMs = 1000;
    const handle = await env.client.workflow.start('edgarSubmissionsPollerWorkflow', {
      taskQueue: 'watcher-tests',
      workflowId: 'watcher-edgar',
      args: [
        {
          forms: ['13F-HR'],
          cadenceMs,
          lookbackMs: 0,
          batchSize: 250,
          since: '2024-01-15T00:00:00.000Z',
        },
      ],
    });

    try {
      await env.sleep('1s');
      expect(recordEdgarSubmissionWindow).toHaveBeenCalledTimes(1);
      const firstCall = recordEdgarSubmissionWindow.mock.calls[0]?.[0];
      expect(firstCall).toMatchObject({
        forms: ['13F-HR'],
        batchSize: 250,
        windowStart: '2024-01-15T00:00:00.000Z',
      });

      await env.sleep('2s');
      expect(recordEdgarSubmissionWindow.mock.calls.length).toBeGreaterThanOrEqual(2);
      const secondCall = recordEdgarSubmissionWindow.mock.calls[1]?.[0];
      expect(secondCall?.windowStart).toBe('2024-02-01T00:00:00.000Z');

      const info = await handle.describe();
      expect(info.execution?.runId).not.toBe(handle.firstExecutionRunId);
    } finally {
      try {
        await handle.terminate('test complete');
      } catch (err) {
        if (!(err instanceof WorkflowNotFoundError)) {
          throw err;
        }
      }
      await worker.shutdown();
      await workerRun;
    }
  });

  test('nport monthly timer fans out by cik', async () => {
    const planNportMonthlySnapshots = vi
      .fn()
      .mockResolvedValueOnce({
        months: [{ month: '2024-03' }],
        ciks: ['0000123456'],
        nextCursor: '2024-03',
      })
      .mockResolvedValueOnce({
        months: [{ month: '2024-04' }],
        ciks: ['0000123456'],
        nextCursor: '2024-04',
      })
      .mockResolvedValue({ months: [], ciks: [], nextCursor: '2024-04' });
    const fetchMonthly = vi.fn().mockResolvedValue(5);

    const worker = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.client.namespace,
      taskQueue: 'watcher-tests',
      workflowsPath: new URL('../workflows/index.ts', import.meta.url).pathname,
      activities: {
        planNportMonthlySnapshots,
        fetchMonthly,
      },
    });

    const workerRun = worker.run();
    const handle = await env.client.workflow.start('nportMonthlyTimerWorkflow', {
      taskQueue: 'watcher-tests',
      workflowId: 'watcher-nport',
      args: [
        {
          cadenceMs: 1000,
          lastMonth: '2024-02',
          maxMonths: 1,
        },
      ],
    });

    try {
      await env.sleep('1s');
      expect(planNportMonthlySnapshots).toHaveBeenCalledTimes(1);
      const firstCall = planNportMonthlySnapshots.mock.calls[0]?.[0];
      expect(firstCall).toMatchObject({ lastMonth: '2024-02', maxMonths: 1 });
      expect(fetchMonthly).toHaveBeenCalledWith('0000123456', [{ month: '2024-03' }]);

      await env.sleep('2s');
      expect(planNportMonthlySnapshots.mock.calls.length).toBeGreaterThanOrEqual(2);
      const secondCall = planNportMonthlySnapshots.mock.calls[1]?.[0];
      expect(secondCall?.lastMonth).toBe('2024-03');
    } finally {
      try {
        await handle.terminate('test complete');
      } catch (err) {
        if (!(err instanceof WorkflowNotFoundError)) {
          throw err;
        }
      }
      await worker.shutdown();
      await workerRun;
    }
  });

  test('etf daily cron only fetches missing funds', async () => {
    const planEtfDailySnapshots = vi
      .fn()
      .mockResolvedValueOnce({
        asOf: '2024-05-01',
        funds: ['IWB'],
        cusips: ['123456789'],
        nextAsOf: '2024-05-02',
      })
      .mockResolvedValueOnce({
        asOf: '2024-05-02',
        funds: [],
        cusips: ['123456789'],
        nextAsOf: '2024-05-03',
      })
      .mockResolvedValue({ asOf: '2024-05-03', funds: [], cusips: ['123456789'], nextAsOf: '2024-05-04' });
    const fetchDailyHoldings = vi.fn().mockResolvedValue(2);

    const worker = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.client.namespace,
      taskQueue: 'watcher-tests',
      workflowsPath: new URL('../workflows/index.ts', import.meta.url).pathname,
      activities: {
        planEtfDailySnapshots,
        fetchDailyHoldings,
      },
    });

    const workerRun = worker.run();
    const handle = await env.client.workflow.start('etfDailyCronWorkflow', {
      taskQueue: 'watcher-tests',
      workflowId: 'watcher-etf',
      args: [
        {
          cadenceMs: 1000,
          lastAsOf: '2024-04-30',
          funds: ['IWB', 'IWM'],
        },
      ],
    });

    try {
      await env.sleep('1s');
      expect(planEtfDailySnapshots).toHaveBeenCalledTimes(1);
      const firstCall = planEtfDailySnapshots.mock.calls[0]?.[0];
      expect(firstCall).toMatchObject({ asOf: '2024-04-30', funds: ['IWB', 'IWM'] });
      expect(fetchDailyHoldings).toHaveBeenCalledWith(['123456789'], ['IWB']);

      await env.sleep('2s');
      expect(planEtfDailySnapshots.mock.calls.length).toBeGreaterThanOrEqual(2);
      const secondCall = planEtfDailySnapshots.mock.calls[1]?.[0];
      expect(secondCall?.asOf).toBe('2024-05-02');
    } finally {
      try {
        await handle.terminate('test complete');
      } catch (err) {
        if (!(err instanceof WorkflowNotFoundError)) {
          throw err;
        }
      }
      await worker.shutdown();
      await workerRun;
    }
  });

  test('finra short publish iterates settle windows', async () => {
    const planFinraShortInterest = vi
      .fn()
      .mockResolvedValueOnce({
        settleDates: ['2024-04-15', '2024-04-30'],
        ciks: ['0000000001', '0000000002'],
        nextCursor: '2024-04-30',
      })
      .mockResolvedValueOnce({
        settleDates: ['2024-05-15'],
        ciks: ['0000000001'],
        nextCursor: '2024-05-15',
      })
      .mockResolvedValue({ settleDates: [], ciks: [], nextCursor: '2024-05-15' });
    const fetchShortInterest = vi.fn().mockResolvedValue(1);

    const worker = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.client.namespace,
      taskQueue: 'watcher-tests',
      workflowsPath: new URL('../workflows/index.ts', import.meta.url).pathname,
      activities: {
        planFinraShortInterest,
        fetchShortInterest,
      },
    });

    const workerRun = worker.run();
    const handle = await env.client.workflow.start('finraShortPublishWorkflow', {
      taskQueue: 'watcher-tests',
      workflowId: 'watcher-finra',
      args: [
        {
          cadenceMs: 1000,
          lastSettle: '2024-03-31',
          windowSize: 2,
        },
      ],
    });

    try {
      await env.sleep('1s');
      expect(planFinraShortInterest).toHaveBeenCalledTimes(1);
      const firstCall = planFinraShortInterest.mock.calls[0]?.[0];
      expect(firstCall).toMatchObject({ lastSettle: '2024-03-31', windowSize: 2 });
      expect(fetchShortInterest).toHaveBeenCalledWith('0000000001', ['2024-04-15', '2024-04-30']);
      expect(fetchShortInterest).toHaveBeenCalledWith('0000000002', ['2024-04-15', '2024-04-30']);

      await env.sleep('2s');
      expect(planFinraShortInterest.mock.calls.length).toBeGreaterThanOrEqual(2);
      const secondCall = planFinraShortInterest.mock.calls[1]?.[0];
      expect(secondCall?.lastSettle).toBe('2024-04-30');
    } finally {
      try {
        await handle.terminate('test complete');
      } catch (err) {
        if (!(err instanceof WorkflowNotFoundError)) {
          throw err;
        }
      }
      await worker.shutdown();
      await workerRun;
    }
  });
});
