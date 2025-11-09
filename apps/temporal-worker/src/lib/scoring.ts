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
  // Microstructure signals (optional)
  microVpinAvg?: number;
  microVpinSpike?: boolean;
  microLambdaAvg?: number;
  microOrderImbalanceAvg?: number;
  microBlockRatioAvg?: number;
  microFlowAttributionScore?: number;
  microConfidence?: number;
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
  // Microstructure weights
  microVpin: 0.6,          // VPIN toxicity signal
  microVpinSpike: 0.8,     // Spike bonus (adds on top of avg)
  microLambda: 0.3,        // Price impact
  microOrderImbalance: 0.4, // Sell pressure
  microBlockRatio: 0.5,    // Institutional block trades
  microFlowAttribution: 0.7, // Flow confidence
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

  // Base score (original signals)
  let score =
    SCORE_WEIGHTS.dump * inputs.dumpZ +
    SCORE_WEIGHTS.uSame * inputs.uSame +
    SCORE_WEIGHTS.uNext * inputs.uNext * uNextMultiplier +
    SCORE_WEIGHTS.uhfSame * inputs.uhfSame +
    SCORE_WEIGHTS.uhfNext * inputs.uhfNext * uhfNextMultiplier +
    SCORE_WEIGHTS.optSame * inputs.optSame +
    SCORE_WEIGHTS.optNext * inputs.optNext * optNextMultiplier +
    SCORE_WEIGHTS.shortRelief * inputs.shortReliefV2 -
    inputs.indexPenalty;

  // Microstructure enhancement (if available)
  if (inputs.microConfidence && inputs.microConfidence > 0.5) {
    const microScore = computeMicrostructureScore(inputs);
    // Weight microstructure score by its confidence
    score += microScore * inputs.microConfidence;
  }

  return { rScore: score, gated: true };
}

/**
 * Compute microstructure component of rotation score
 */
export function computeMicrostructureScore(inputs: ScoreInputs): number {
  let microScore = 0;

  // VPIN toxicity: Higher VPIN during dump = informed selling
  if (inputs.microVpinAvg !== undefined) {
    microScore += SCORE_WEIGHTS.microVpin * inputs.microVpinAvg;
  }

  // VPIN spike: Strong signal of informed trading
  if (inputs.microVpinSpike) {
    microScore += SCORE_WEIGHTS.microVpinSpike;
  }

  // Kyle's Lambda: Higher price impact = less liquid, more informative
  if (inputs.microLambdaAvg !== undefined) {
    // Normalize lambda to 0-1 range (assuming lambda in bps/$1M, cap at 50)
    const normalizedLambda = Math.min(inputs.microLambdaAvg / 50, 1.0);
    microScore += SCORE_WEIGHTS.microLambda * normalizedLambda;
  }

  // Order imbalance: Negative imbalance (sell pressure) is a signal
  if (inputs.microOrderImbalanceAvg !== undefined) {
    // Use absolute value, but boost if negative (selling)
    const imbalanceSignal = inputs.microOrderImbalanceAvg < 0
      ? Math.abs(inputs.microOrderImbalanceAvg) * 1.2
      : Math.abs(inputs.microOrderImbalanceAvg);
    microScore += SCORE_WEIGHTS.microOrderImbalance * Math.min(imbalanceSignal, 1.0);
  }

  // Block trade ratio: Higher ratio = more institutional activity
  if (inputs.microBlockRatioAvg !== undefined) {
    microScore += SCORE_WEIGHTS.microBlockRatio * inputs.microBlockRatioAvg;
  }

  // Flow attribution score: Confidence in institutional attribution
  if (inputs.microFlowAttributionScore !== undefined) {
    microScore += SCORE_WEIGHTS.microFlowAttribution * inputs.microFlowAttributionScore;
  }

  return microScore;
}
