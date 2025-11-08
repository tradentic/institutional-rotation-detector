export interface ScoreInputs {
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

export interface ScoreResult {
  rScore: number;
  gated: boolean;
}

export const SCORE_WEIGHTS = {
  dump: 2.0,
  uSame: 1.0,
  uNext: 0.85,
  uhfSame: 0.7,
  uhfNext: 0.6,
  optSame: 0.5,
  optNext: 0.4,
  shortRelief: 0.4,
};

const DUMP_GATE_Z = 1.5;

const EOW_MULTIPLIERS = {
  uNext: 0.95,
  uhfNext: 0.9,
  optNext: 0.5,
};

export function computeRotationScore(inputs: ScoreInputs): ScoreResult {
  const gate =
    inputs.dumpZ >= DUMP_GATE_Z &&
    (inputs.uSame > 0 ||
      inputs.uNext > 0 ||
      inputs.uhfSame > 0 ||
      inputs.uhfNext > 0);

  if (!gate) {
    return { rScore: 0, gated: false };
  }

  const uNextMultiplier = inputs.eow ? EOW_MULTIPLIERS.uNext : 1;
  const uhfNextMultiplier = inputs.eow ? EOW_MULTIPLIERS.uhfNext : 1;
  const optNextMultiplier = inputs.eow ? EOW_MULTIPLIERS.optNext : 1;

  const score =
    SCORE_WEIGHTS.dump * inputs.dumpZ +
    SCORE_WEIGHTS.uSame * inputs.uSame +
    SCORE_WEIGHTS.uNext * inputs.uNext * uNextMultiplier +
    SCORE_WEIGHTS.uhfSame * inputs.uhfSame +
    SCORE_WEIGHTS.uhfNext * inputs.uhfNext * uhfNextMultiplier +
    SCORE_WEIGHTS.optSame * inputs.optSame +
    SCORE_WEIGHTS.optNext * inputs.optNext * optNextMultiplier +
    SCORE_WEIGHTS.shortRelief * inputs.shortReliefV2 -
    inputs.indexPenalty;

  return { rScore: score, gated: true };
}
