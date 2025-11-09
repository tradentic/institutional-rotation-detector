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
  // Insider transaction signals (optional)
  insiderPostDumpBuying?: boolean;
  insiderPreDumpSelling?: boolean;
  insiderNetFlowSameQuarter?: number;
  insiderNetFlowNextQuarter?: number;
  insiderConfidence?: number;
  // Options flow signals (optional)
  optionsPreDumpPutSurge?: boolean;
  optionsPreDumpPCRatio?: number;
  optionsPostDumpCallBuildup?: boolean;
  optionsPostDumpIVDecline?: boolean;
  optionsUnusualActivityCount?: number;
  optionsConfidence?: number;
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
  // Insider transaction weights
  insiderPostDumpBuying: 0.8,   // Contrarian signal (insiders disagree with dump)
  insiderPreDumpSelling: -0.5,  // Validation signal (negative = reduces score if insiders sold before)
  insiderNetFlowNormalized: 0.6, // Net insider buying/selling normalized
  // Options flow weights
  optionsPreDumpPutSurge: 1.2,  // Leading indicator (puts before dump)
  optionsPreDumpPCRatio: 0.8,   // Put/call ratio signal
  optionsPostDumpCallBuildup: 0.7, // Uptake confirmation
  optionsPostDumpIVDecline: 0.5,   // Confidence signal (fear declining)
  optionsUnusualActivity: 0.3,     // Per unusual activity event
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

  // Insider transaction enhancement (if available)
  if (inputs.insiderConfidence && inputs.insiderConfidence > 0.5) {
    const insiderScore = computeInsiderScore(inputs);
    score += insiderScore * inputs.insiderConfidence;
  }

  // Options flow enhancement (if available)
  if (inputs.optionsConfidence && inputs.optionsConfidence > 0.5) {
    const optionsScore = computeOptionsScore(inputs);
    score += optionsScore * inputs.optionsConfidence;
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

/**
 * Compute insider transaction component of rotation score
 */
export function computeInsiderScore(inputs: ScoreInputs): number {
  let insiderScore = 0;

  // Post-dump insider buying (contrarian signal)
  // When insiders buy after institutional dump, it suggests dump was mechanical not fundamental
  if (inputs.insiderPostDumpBuying) {
    insiderScore += SCORE_WEIGHTS.insiderPostDumpBuying;
  }

  // Pre-dump insider selling (validation signal)
  // When insiders sell before institutional dump, it validates the dump was informed
  // This is a NEGATIVE signal - reduces confidence in rotation
  if (inputs.insiderPreDumpSelling) {
    insiderScore += SCORE_WEIGHTS.insiderPreDumpSelling; // Note: weight is negative
  }

  // Net insider flow normalized by dump size
  // Positive = insiders buying, Negative = insiders selling
  if (inputs.insiderNetFlowSameQuarter !== undefined) {
    // Normalize to 0-1 range (assuming max 20% of dump size)
    const normalizedFlow = Math.min(Math.abs(inputs.insiderNetFlowSameQuarter) / 0.2, 1.0);
    // Only add if positive (buying)
    if (inputs.insiderNetFlowSameQuarter > 0) {
      insiderScore += SCORE_WEIGHTS.insiderNetFlowNormalized * normalizedFlow;
    }
  }

  // Next quarter insider buying (lower weight)
  if (inputs.insiderNetFlowNextQuarter !== undefined && inputs.insiderNetFlowNextQuarter > 0) {
    const normalizedFlow = Math.min(Math.abs(inputs.insiderNetFlowNextQuarter) / 0.2, 1.0);
    insiderScore += SCORE_WEIGHTS.insiderNetFlowNormalized * normalizedFlow * 0.7; // 70% weight for next quarter
  }

  return insiderScore;
}

/**
 * Compute options flow component of rotation score
 */
export function computeOptionsScore(inputs: ScoreInputs): number {
  let optionsScore = 0;

  // Pre-dump put surge (leading indicator)
  // Large put buying before dump = informed positioning
  if (inputs.optionsPreDumpPutSurge) {
    optionsScore += SCORE_WEIGHTS.optionsPreDumpPutSurge;
  }

  // Pre-dump Put/Call ratio
  // High P/C ratio before dump = bearish sentiment preceded the dump
  if (inputs.optionsPreDumpPCRatio !== undefined) {
    // P/C ratio > 2.0 is strong signal
    // Normalize: 0-1 where 2.0 = 1.0
    const normalizedPCR = Math.min((inputs.optionsPreDumpPCRatio - 1.0) / 1.0, 1.0);
    if (normalizedPCR > 0) {
      optionsScore += SCORE_WEIGHTS.optionsPreDumpPCRatio * normalizedPCR;
    }
  }

  // Post-dump call buildup (uptake confirmation)
  // Call buying/OI building after dump = confidence in recovery
  if (inputs.optionsPostDumpCallBuildup) {
    optionsScore += SCORE_WEIGHTS.optionsPostDumpCallBuildup;
  }

  // Post-dump IV decline (confidence signal)
  // Declining IV after dump = reduced fear, market confidence
  if (inputs.optionsPostDumpIVDecline) {
    optionsScore += SCORE_WEIGHTS.optionsPostDumpIVDecline;
  }

  // Unusual options activity count
  // More unusual activity = more informed positioning
  if (inputs.optionsUnusualActivityCount !== undefined) {
    // Cap at 5 events
    const cappedCount = Math.min(inputs.optionsUnusualActivityCount, 5);
    optionsScore += SCORE_WEIGHTS.optionsUnusualActivity * cappedCount;
  }

  return optionsScore;
}
