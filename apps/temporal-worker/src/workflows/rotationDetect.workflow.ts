import { proxyActivities, startChild } from '@temporalio/workflow';
import { quarterBounds } from './utils.js';
import type { EventStudyInput } from './eventStudy.workflow.js';

const activities = proxyActivities<{
  detectDumpEvents: (cik: string, quarter: { start: string; end: string }) => Promise<any[]>;
  uptakeFromFilings: (cik: string, quarter: { start: string; end: string }) => Promise<{ uSame: number; uNext: number }>;
  uhf: (cik: string, quarter: { start: string; end: string }) => Promise<{ uhfSame: number; uhfNext: number }>;
  optionsOverlay: (cik: string, quarter: { start: string; end: string }) => Promise<{ optSame: number; optNext: number }>;
  shortReliefV2: (cik: string, quarter: { start: string; end: string }) => Promise<number>;
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
  buildEdges: (seller: any[], buyer: any[], period: { start: string; end: string }) => Promise<any>;
}>(
  {
    startToCloseTimeout: '5 minutes',
  }
);

export interface RotationDetectInput {
  cik: string;
  cusips: string[];
  quarter: string;
}

export async function rotationDetectWorkflow(input: RotationDetectInput) {
  const bounds = quarterBounds(input.quarter);
  const anchors = await activities.detectDumpEvents(input.cik, bounds);
  const uptake = await activities.uptakeFromFilings(input.cik, bounds);
  const uhf = await activities.uhf(input.cik, bounds);
  const options = await activities.optionsOverlay(input.cik, bounds);
  const shortRelief = await activities.shortReliefV2(input.cik, bounds);

  for (const anchor of anchors) {
    const eow = isWithinLastFiveDays(anchor.anchorDate, bounds.end);
    await activities.scoreV4_1(input.cik, anchor, {
      dumpZ: Math.abs(anchor.delta) * 5,
      uSame: uptake.uSame,
      uNext: uptake.uNext,
      uhfSame: uhf.uhfSame,
      uhfNext: uhf.uhfNext,
      optSame: options.optSame,
      optNext: options.optNext,
      shortReliefV2: shortRelief,
      indexPenalty: 0.1,
      eow,
    });

    await activities.buildEdges(
      [
        { entityId: anchor.seller, cusip: input.cusips[0], equityDelta: anchor.delta, optionsDelta: 0 },
      ],
      [
        { entityId: 'buyer', cusip: input.cusips[0], equityDelta: Math.abs(anchor.delta), optionsDelta: 0 },
      ],
      bounds
    );

    const child = await startChild<EventStudyInput>('eventStudyWorkflow', {
      args: [
        {
          anchorDate: anchor.anchorDate,
          cik: input.cik,
        } satisfies EventStudyInput,
      ],
    });
    await child.result();
  }
}

function isWithinLastFiveDays(anchor: string, quarterEnd: string) {
  const anchorDate = new Date(anchor);
  const end = new Date(quarterEnd);
  const diff = (end.getTime() - anchorDate.getTime()) / (1000 * 60 * 60 * 24);
  return diff <= 5;
}
