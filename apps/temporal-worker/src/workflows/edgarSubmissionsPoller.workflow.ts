import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils.ts';
import { incrementIteration, DEFAULT_MAX_ITERATIONS } from './continueAsNewHelper.ts';
import type {
  EdgarSubmissionWindowInput,
  EdgarSubmissionWindowResult,
} from '../activities/edgar.activities.ts';

const DEFAULT_FORMS = ['13F-HR', '13F-HR/A', 'SC 13G', 'SC 13D'];
const DEFAULT_CADENCE_MS = 5 * 60 * 1000;
const DEFAULT_LOOKBACK_MS = 15 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 500;

const { recordEdgarSubmissionWindow } = proxyActivities<{
  recordEdgarSubmissionWindow: (input: EdgarSubmissionWindowInput) => Promise<EdgarSubmissionWindowResult>;
}>({
  startToCloseTimeout: '5 minutes',
});

export interface EdgarSubmissionsPollerInput {
  forms?: string[];
  cadenceMs?: number;
  lookbackMs?: number;
  since?: string | null;
  batchSize?: number;
  iterationCount?: number;
  maxIterations?: number;
}

function computeWindowStart(now: Date, lookbackMs: number, since?: string | null): string {
  if (since) {
    return since;
  }
  const start = new Date(now.getTime() - lookbackMs);
  return start.toISOString();
}

export async function edgarSubmissionsPollerWorkflow(input: EdgarSubmissionsPollerInput = {}) {
  const forms = input.forms && input.forms.length > 0 ? input.forms : DEFAULT_FORMS;
  const cadenceMs = input.cadenceMs ?? DEFAULT_CADENCE_MS;
  const lookbackMs = input.lookbackMs ?? DEFAULT_LOOKBACK_MS;
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const iterationCount = incrementIteration(input.iterationCount, maxIterations);

  const now = new Date();
  const windowEnd = now.toISOString();
  const windowStart = computeWindowStart(now, lookbackMs, input.since ?? null);

  const result = await recordEdgarSubmissionWindow({
    windowStart,
    windowEnd,
    forms,
    batchSize,
  });

  await upsertWorkflowSearchAttributes({
    runKind: 'daily',
    windowKey: `edgar:${windowStart}`,
    periodEnd: windowEnd,
    batchId: `edgar-submissions:${iterationCount}`,
  });

  await sleep(cadenceMs);

  // Continue-As-New to prevent unbounded history growth
  await continueAsNew<typeof edgarSubmissionsPollerWorkflow>({
    ...input,
    since: result.nextCursor ?? windowEnd,
    forms,
    cadenceMs,
    lookbackMs,
    batchSize,
    iterationCount,
    maxIterations,
  });
}
