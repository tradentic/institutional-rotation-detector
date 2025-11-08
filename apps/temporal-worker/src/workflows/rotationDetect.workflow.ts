import { proxyActivities, startChild } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils.js';
import type { EventStudyInput } from './eventStudy.workflow.js';
import type { IndexPenaltyResult } from '../activities/index.activities.js';
import { isQuarterEndEOWString } from '../lib/tradingCalendar.js';

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

export async function rotationDetectWorkflow(input: RotationDetectInput) {
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

  for (const anchor of anchors) {
    // Use proper trading calendar to detect end-of-window dumps
    const eow = isQuarterEndEOWString(anchor.anchorDate, 5);

    // Compute index penalty based on anchor filing date
    const penaltyResult = await activities.indexPenalty({
      filingDate: anchor.anchorDate,
      cik: input.cik,
    });

    await activities.scoreV4_1(input.cik, anchor, {
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

    // Persist index penalty with provenance
    await activities.persistIndexPenalty(
      anchor.clusterId,
      penaltyResult.penalty,
      penaltyResult.matchedWindows
    );

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

    const child = await startChild<EventStudyInput>('eventStudyWorkflow', {
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
}

// Note: isQuarterEndEOWString is now used instead of this function.
// Kept for reference but can be removed in future cleanup.
