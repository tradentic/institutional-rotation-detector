import { proxyActivities, startChild } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils';
import type { EventStudyInput } from './eventStudy.workflow';
import type { IndexPenaltyResult } from '../activities/index.activities';
import type {
  AnalyzeRotationEventInput,
  AnalyzeRotationEventResult,
} from '../activities/rotation-analysis.activities';
import { isQuarterEndEOWString } from '../lib/tradingCalendar';
import type { RotationDetectResult } from './types';

const activities = proxyActivities<{
  detectDumpEvents: (cik: string, quarter: { start: string; end: string }) => Promise<any[]>;
  uptakeFromFilings: (cik: string, quarter: { start: string; end: string }) => Promise<{ uSame: number; uNext: number }>;
  uhf: (cik: string, quarter: { start: string; end: string }) => Promise<{ uhfSame: number; uhfNext: number }>;
  optionsOverlay: (cik: string, quarter: { start: string; end: string }) => Promise<{ optSame: number; optNext: number }>;
  shortReliefV2: (cik: string, quarter: { start: string; end: string }) => Promise<number>;
  indexPenalty: (input: { filingDate: string; cik: string }) => Promise<IndexPenaltyResult>;
  persistIndexPenalty: (clusterId: string, penalty: number, matchedWindows: IndexPenaltyResult['matchedWindows']) => Promise<void>;
  scoreV4_1: (
    cik: string,
    anchor: any,
    inputs: {
      dumpZ: number;
      uSame: number;
      uNext: number;
      uhfSame: number;
      uhfNext: number;
      optSame: number;
      optNext: number;
      shortReliefV2: number;
      indexPenalty: number;
      eow: boolean;
    }
  ) => Promise<any>;
  buildEdges: (
    seller: any[],
    buyer: any[],
    period: { start: string; end: string },
    rootIssuerCik: string
  ) => Promise<any>;
  analyzeRotationEvent: (input: AnalyzeRotationEventInput) => Promise<AnalyzeRotationEventResult>;
}>(
  {
    startToCloseTimeout: '5 minutes',
  }
);

export interface RotationDetectInput {
  cik: string;
  cusips: string[];
  quarter: string;
  ticker: string;
  runKind: 'backfill' | 'daily';
  quarterStart: string;
  quarterEnd: string;
}

export type { RotationDetectResult };

export async function rotationDetectWorkflow(input: RotationDetectInput): Promise<RotationDetectResult> {
  const startTime = Date.now();
  const bounds = {
    start: input.quarterStart,
    end: input.quarterEnd,
  };
  await upsertWorkflowSearchAttributes({
    ticker: input.ticker,
    cik: input.cik,
    runKind: input.runKind,
    windowKey: input.quarter,
    periodEnd: bounds.end,
    batchId: `rotation:${input.runKind}:${input.quarter}`,
  });
  const anchors = await activities.detectDumpEvents(input.cik, bounds);
  const uptake = await activities.uptakeFromFilings(input.cik, bounds);
  const uhf = await activities.uhf(input.cik, bounds);
  const options = await activities.optionsOverlay(input.cik, bounds);
  const shortRelief = await activities.shortReliefV2(input.cik, bounds);

  const clusterIds: string[] = [];
  const analyses: AnalyzeRotationEventResult[] = [];
  let highConfidenceCount = 0;
  const warnings: string[] = [];

  for (const anchor of anchors) {
    // Use proper trading calendar to detect end-of-window dumps
    const eow = isQuarterEndEOWString(anchor.anchorDate, 5);

    // Compute index penalty based on anchor filing date
    const penaltyResult = await activities.indexPenalty({
      filingDate: anchor.anchorDate,
      cik: input.cik,
    });

    const scoreResult = await activities.scoreV4_1(input.cik, anchor, {
      dumpZ: anchor.dumpZ,
      uSame: uptake.uSame,
      uNext: uptake.uNext,
      uhfSame: uhf.uhfSame,
      uhfNext: uhf.uhfNext,
      optSame: options.optSame,
      optNext: options.optNext,
      shortReliefV2: shortRelief,
      indexPenalty: penaltyResult.penalty,
      eow,
    });

    // Track high confidence rotations (R-score > 0.7 is typical threshold)
    if (scoreResult?.rScore && scoreResult.rScore > 0.7) {
      highConfidenceCount++;
    }

    // Persist index penalty with provenance
    await activities.persistIndexPenalty(
      anchor.clusterId,
      penaltyResult.penalty,
      penaltyResult.matchedWindows
    );

    // NEW: AI-powered analysis of rotation event (THE 10x CHANGE)
    // This transforms algorithmic scores into actionable trading intelligence
    const analysis = await activities.analyzeRotationEvent({
      clusterId: anchor.clusterId,
      issuerCik: input.cik,
      signals: {
        dumpZ: anchor.dumpZ,
        uSame: uptake.uSame,
        uNext: uptake.uNext,
        uhfSame: uhf.uhfSame,
        uhfNext: uhf.uhfNext,
        optSame: options.optSame,
        optNext: options.optNext,
        shortReliefV2: shortRelief,
        indexPenalty: penaltyResult.penalty,
        rScore: scoreResult?.rScore ?? 0, // Get R-score from scoreV4_1 result
      },
    });

    clusterIds.push(anchor.clusterId);
    analyses.push(analysis);

    await activities.buildEdges(
      [
        { entityId: anchor.seller, cusip: input.cusips[0], equityDelta: anchor.delta, optionsDelta: 0 },
      ],
      [
        { entityId: 'buyer', cusip: input.cusips[0], equityDelta: Math.abs(anchor.delta), optionsDelta: 0 },
      ],
      bounds,
      input.cik
    );

    const child = await startChild('eventStudyWorkflow', {
      args: [
        {
          anchorDate: anchor.anchorDate,
          cik: input.cik,
          ticker: input.ticker,
          runKind: input.runKind,
          quarterStart: bounds.start,
          quarterEnd: bounds.end,
        } satisfies EventStudyInput,
      ],
    });
    await child.result();
  }

  // Add warnings if no rotation detected
  if (anchors.length === 0) {
    warnings.push('No dump events detected - this may indicate:');
    warnings.push('  1. No significant institutional rotation occurred');
    warnings.push('  2. Missing 13F data (check if entity files 13F)');
    warnings.push('  3. CUSIP resolution failed (check cusip_issuer_map)');
  }

  const endTime = Date.now();
  const avgConfidence = analyses.length > 0
    ? analyses.reduce((sum, a) => sum + a.confidence, 0) / analyses.length
    : 0;
  const highAnomalyCount = analyses.filter(a => a.anomalyScore >= 7).length;

  return {
    status: anchors.length > 0 ? 'success' : 'partial_success',
    message: anchors.length > 0
      ? `Detected ${anchors.length} rotation events for ${input.ticker} in ${input.quarter}${highConfidenceCount > 0 ? ` (${highConfidenceCount} high-confidence)` : ''}`
      : `No rotation events detected for ${input.ticker} in ${input.quarter}`,
    metrics: {
      processed: 1,
      succeeded: anchors.length,
      failed: 0,
      skipped: 0,
    },
    timing: {
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date(endTime).toISOString(),
      durationMs: endTime - startTime,
    },
    entity: {
      ticker: input.ticker,
      cik: input.cik,
      cusips: input.cusips,
    },
    dateRange: {
      start: bounds.start,
      end: bounds.end,
    },
    quarter: input.quarter,
    rotationEvents: {
      dumpEventsDetected: anchors.length,
      highConfidenceCount,
      clusterIds,
    },
    signals: {
      uptake,
      uhf,
      options,
      shortRelief,
    },
    aiAnalysis: analyses.length > 0 ? {
      eventsAnalyzed: analyses.length,
      avgConfidence,
      highAnomalyCount,
    } : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    links: anchors.length > 0 ? {
      rotationEvents: clusterIds,
      queries: [
        `-- View rotation events for ${input.ticker} in ${input.quarter}`,
        `SELECT cluster_id, anchor_filing, r_score, dumpz, u_same, u_next`,
        `FROM rotation_events`,
        `WHERE issuer_cik = '${input.cik}' AND cluster_id IN (${clusterIds.map(id => `'${id}'`).join(',')})`,
        `ORDER BY r_score DESC;`,
      ],
    } : undefined,
  };
}

// Note: isQuarterEndEOWString is now used instead of this function.
// Kept for reference but can be removed in future cleanup.
