import { randomUUID } from 'crypto';
import { createSupabaseClient } from '../lib/supabase.js';
import { computeRotationScore, ScoreInputs } from '../lib/scoring.js';
import type { RotationEventRecord } from '../lib/schema.js';

export interface QuarterBounds {
  start: string;
  end: string;
}

export interface DumpEvent {
  clusterId: string;
  anchorDate: string;
  seller: string;
  delta: number;
}

export async function detectDumpEvents(
  cik: string,
  quarter: QuarterBounds
): Promise<DumpEvent[]> {
  return [
    {
      clusterId: randomUUID(),
      anchorDate: quarter.end,
      seller: cik,
      delta: -0.35,
    },
  ];
}

export async function uptakeFromFilings() {
  return { uSame: 0.5, uNext: 0.3 };
}

export async function uhf() {
  return { uhfSame: 0.4, uhfNext: 0.2 };
}

export async function optionsOverlay() {
  return { optSame: 0.1, optNext: 0.05 };
}

export async function shortReliefV2() {
  return 0.25;
}

export async function scoreV4_1(
  cik: string,
  anchor: DumpEvent,
  inputs: Omit<ScoreInputs, 'eow'> & { eow: boolean }
): Promise<RotationEventRecord> {
  const supabase = createSupabaseClient();
  const result = computeRotationScore(inputs);
  const event: RotationEventRecord = {
    cluster_id: anchor.clusterId,
    issuer_cik: cik,
    anchor_filing: null,
    dumpz: inputs.dumpZ,
    u_same: inputs.uSame,
    u_next: inputs.uNext,
    uhf_same: inputs.uhfSame,
    uhf_next: inputs.uhfNext,
    opt_same: inputs.optSame,
    opt_next: inputs.optNext,
    shortrelief_v2: inputs.shortReliefV2,
    index_penalty: inputs.indexPenalty,
    eow: inputs.eow,
    r_score: result.rScore,
    car_m5_p20: 0,
    t_to_plus20_days: 20,
    max_ret_w13: 0,
  };
  await supabase.from('rotation_events').upsert(event, {
    onConflict: 'cluster_id',
  });
  return event;
}

export async function eventStudy(anchorDate: string) {
  return {
    anchorDate,
    car: 0,
    ttPlus20: 20,
    maxRet: 0,
  };
}
