import { proxyActivities } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils.js';

const activities = proxyActivities<{
  buildBrokerMapping: (symbol?: string, lookbackDays?: number) => Promise<{ mappingsCreated: number; mappingsUpdated: number }>;
  attributeInstitutionalFlows: (symbol: string, fromDate: string, toDate: string, minConfidence?: number) => Promise<{ flowsAttributed: number }>;
  classifyTrades: (symbol: string, tradeDate: string) => Promise<{ classification: any }>;
  computeMicrostructureMetrics: (symbol: string, tradeDate: string) => Promise<{ metrics: any }>;
  getMicrostructureSignals: (symbol: string, fromDate: string, toDate: string) => Promise<{
    vpinAvg: number;
    vpinSpike: boolean;
    lambdaAvg: number;
    orderImbalanceAvg: number;
    blockRatioAvg: number;
    flowAttributionScore: number;
    microConfidence: number;
  }>;
}>({
  startToCloseTimeout: '5 minutes',
  scheduleToCloseTimeout: '10 minutes',
});

export interface MicrostructureAnalysisInput {
  symbol: string;
  fromDate: string;
  toDate: string;
  buildMapping?: boolean;        // Whether to build/update broker mappings
  minConfidence?: number;        // Minimum confidence for flow attribution (default 0.7)
}

export interface MicrostructureAnalysisResult {
  symbol: string;
  period: { from: string; to: string };
  mappingsCreated?: number;
  flowsAttributed: number;
  daysAnalyzed: number;
  signals: {
    vpinAvg: number;
    vpinSpike: boolean;
    lambdaAvg: number;
    orderImbalanceAvg: number;
    blockRatioAvg: number;
    flowAttributionScore: number;
    microConfidence: number;
  };
}

/**
 * Microstructure Analysis Workflow
 *
 * Orchestrates the computation of microstructure metrics for institutional rotation detection:
 * 1. Build broker-dealer to institution mappings (optional)
 * 2. Attribute ATS flows to institutions
 * 3. Classify trades (Lee-Ready)
 * 4. Compute VPIN, Kyle's lambda, and other metrics
 * 5. Return aggregated signals for rotation scoring
 *
 * This workflow provides the "real-time" layer that detects institutional flows
 * 30-45 days earlier than 13F filings.
 */
export async function microstructureAnalysisWorkflow(
  input: MicrostructureAnalysisInput
): Promise<MicrostructureAnalysisResult> {
  const {
    symbol,
    fromDate,
    toDate,
    buildMapping = false,
    minConfidence = 0.7,
  } = input;

  await upsertWorkflowSearchAttributes({
    symbol: symbol,
    dataset: 'MICROSTRUCTURE',
    runKind: 'analysis',
  });

  let mappingsCreated: number | undefined;

  // Step 1: Build/update broker mappings if requested
  if (buildMapping) {
    const mappingResult = await activities.buildBrokerMapping(symbol, 365);
    mappingsCreated = mappingResult.mappingsCreated;
  }

  // Step 2: Attribute institutional flows from ATS data
  const flowResult = await activities.attributeInstitutionalFlows(
    symbol,
    fromDate,
    toDate,
    minConfidence
  );

  // Step 3: Classify trades and compute metrics for each day
  const days = getDaysBetween(fromDate, toDate);
  let daysAnalyzed = 0;

  for (const day of days) {
    try {
      // Classify trades for this day
      await activities.classifyTrades(symbol, day);

      // Compute microstructure metrics
      await activities.computeMicrostructureMetrics(symbol, day);

      daysAnalyzed++;
    } catch (error) {
      // Log error but continue with other days
      console.error(`Failed to analyze ${symbol} on ${day}:`, error);
    }
  }

  // Step 4: Get aggregated signals for the period
  const signals = await activities.getMicrostructureSignals(symbol, fromDate, toDate);

  return {
    symbol,
    period: { from: fromDate, to: toDate },
    mappingsCreated,
    flowsAttributed: flowResult.flowsAttributed,
    daysAnalyzed,
    signals,
  };
}

/**
 * Helper: Get all trading days between two dates
 */
function getDaysBetween(fromDate: string, toDate: string): string[] {
  const days: string[] = [];
  const start = new Date(fromDate);
  const end = new Date(toDate);
  const current = new Date(start);

  while (current <= end) {
    // Skip weekends (basic approximation - doesn't handle holidays)
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      days.push(current.toISOString().slice(0, 10));
    }
    current.setDate(current.getDate() + 1);
  }

  return days;
}
