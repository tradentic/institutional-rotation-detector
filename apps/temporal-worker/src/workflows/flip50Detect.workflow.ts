import { proxyActivities, startChild } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils';

const activities = proxyActivities<{
  detectFlip50: (symbol: string, lookbackDays?: number, consecutiveDaysThreshold?: number) => Promise<{ eventsDetected: number }>;
}>({
  startToCloseTimeout: '3 minutes',
  scheduleToCloseTimeout: '5 minutes',
});

export interface Flip50DetectInput {
  symbol: string;
  lookbackDays?: number;         // default 90
  consecutiveDaysThreshold?: number; // default 20
  triggerEventStudy?: boolean;   // default true
}

/**
 * Flip50 Detect Workflow
 *
 * Detects "Flip50" events where off-exchange percentage crosses below 50%
 * after being above 50% for N consecutive trading days.
 *
 * Event definition:
 * - First day: offex_pct < 0.50
 * - Preceded by: ≥N consecutive trading days with offex_pct ≥ 0.50
 *
 * When events are detected:
 * - Store event record with pre-period statistics
 * - Optionally trigger event-study workflow for CAR analysis
 *
 * Search Attributes:
 * - Symbol: stock symbol
 * - Dataset: 'FLIP50'
 * - RunKind: 'detect'
 */
export async function flip50DetectWorkflow(
  input: Flip50DetectInput
): Promise<{ eventsDetected: number }> {
  const { symbol, lookbackDays = 90, consecutiveDaysThreshold = 20, triggerEventStudy = true } = input;

  // Detect Flip50 events
  const result = await activities.detectFlip50(symbol, lookbackDays, consecutiveDaysThreshold);

  await upsertWorkflowSearchAttributes({
    symbol: symbol,
    dataset: 'FLIP50',
    runKind: 'detect',
  });

  // TODO: Trigger event-study workflow for each detected event if triggerEventStudy is true
  // This would require loading the detected events and spawning child workflows
  // For now, we'll leave this as a manual step or scheduled follow-up

  return {
    eventsDetected: result.eventsDetected,
  };
}
