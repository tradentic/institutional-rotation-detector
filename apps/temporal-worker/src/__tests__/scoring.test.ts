import { describe, expect, test } from 'vitest';
import { computeRotationScore } from '../lib/scoring.js';

describe('Rotation score', () => {
  test('gates when dumpZ insufficient', () => {
    const result = computeRotationScore({
      dumpZ: 1,
      uSame: 0,
      uNext: 0,
      uhfSame: 0,
      uhfNext: 0,
      optSame: 0,
      optNext: 0,
      shortReliefV2: 0,
      indexPenalty: 0,
      eow: false,
    });
    expect(result.gated).toBe(false);
    expect(result.rScore).toBe(0);
  });

  test('applies EOW boost', () => {
    const normal = computeRotationScore({
      dumpZ: 2,
      uSame: 1,
      uNext: 1,
      uhfSame: 1,
      uhfNext: 1,
      optSame: 1,
      optNext: 1,
      shortReliefV2: 1,
      indexPenalty: 0,
      eow: false,
    });
    const boosted = computeRotationScore({
      dumpZ: 2,
      uSame: 1,
      uNext: 1,
      uhfSame: 1,
      uhfNext: 1,
      optSame: 1,
      optNext: 1,
      shortReliefV2: 1,
      indexPenalty: 0,
      eow: true,
    });
    expect(boosted.rScore).toBeGreaterThan(normal.rScore);
  });
});
