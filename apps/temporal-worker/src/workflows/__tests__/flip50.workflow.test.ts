import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { temporal } from '@temporalio/proto';
const { IndexedValueType } = temporal.api.enums.v1;

describe('flip50DetectWorkflow', () => {
  let env: TestWorkflowEnvironment;
  const events: any[] = [];

  async function ensureSearchAttributesRegistered() {
    const searchAttributes = {
      Symbol: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
      Dataset: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
      Granularity: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
      WeekEnd: IndexedValueType.INDEXED_VALUE_TYPE_DATETIME,
      TradeDate: IndexedValueType.INDEXED_VALUE_TYPE_DATETIME,
      Provenance: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
      RunKind: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
      BatchId: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
    } as const;
    await env.client.connection.operatorService
      .addSearchAttributes({ namespace: env.client.namespace, searchAttributes })
      .catch(() => undefined);
  }

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
    await ensureSearchAttributesRegistered();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  test('triggers exactly once when streak breaks below 50%', async () => {
    events.length = 0;
    const dailySeries = Array.from({ length: 25 }).map((_, idx) => ({
      as_of: `2024-04-${String(5 + idx).padStart(2, '0')}`,
      offex_pct: idx < 22 ? 0.52 : 0.48,
      offex_shares: 500000,
      on_ex_shares: 480000,
      quality_flag: 'approx',
    }));

    const activities = {
      loadDailySeries: async () => dailySeries,
      recordFlip50Event: async (payload: any) => {
        events.push(payload);
      },
    };

    const worker = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.client.namespace,
      taskQueue: 'flip50-test',
      workflowsPath: new URL('../index.ts', import.meta.url).pathname,
      activities,
    });

    const workerRun = worker.run();
    try {
      const handle = await env.client.workflow.start('flip50DetectWorkflow', {
        taskQueue: 'flip50-test',
        workflowId: 'flip50-once',
        args: [{ symbol: 'TEST', lookbackDays: 20, runKind: 'daily' }],
      });
      await handle.result();
      expect(events.length).toBe(1);
      expect(events[0].eventDate).toBe('2024-04-27');
    } finally {
      await worker.shutdown();
      await workerRun;
    }
  }, 15000);
});
