export interface IndexWindow {
  index_name: string;
  phase: string;
  window_start: string;
  window_end: string;
}

export interface IndexPenaltyInputs {
  quarterStart: string;
  quarterEnd: string;
  anchorDate: string;
  uptakeBreakdown: { passive: number; active: number };
  indexWindows: IndexWindow[];
}

const BASE_PENALTY = 0.2;
const PENALTY_CAP = 0.5;

export function computeIndexPenalty({
  quarterStart,
  quarterEnd,
  anchorDate,
  uptakeBreakdown,
  indexWindows,
}: IndexPenaltyInputs): number {
  const anchorTime = new Date(anchorDate).getTime();
  const quarterStartTime = new Date(quarterStart).getTime();
  const quarterEndTime = new Date(quarterEnd).getTime();
  const quarterDays = Math.max(1, (quarterEndTime - quarterStartTime) / (24 * 60 * 60 * 1000));

  let totalPenalty = 0;

  for (const window of indexWindows) {
    const windowStart = new Date(window.window_start).getTime();
    const windowEnd = new Date(window.window_end).getTime();

    const overlapStart = Math.max(quarterStartTime, windowStart);
    const overlapEnd = Math.min(quarterEndTime, windowEnd);

    if (overlapStart <= overlapEnd && anchorTime >= windowStart && anchorTime <= windowEnd) {
      const overlapDays = (overlapEnd - overlapStart) / (24 * 60 * 60 * 1000);
      const overlapRatio = overlapDays / quarterDays;
      const passiveShare = Math.min(1, Math.max(0, uptakeBreakdown.passive));
      totalPenalty += overlapRatio * passiveShare * BASE_PENALTY;
    }
  }

  return Math.min(PENALTY_CAP, totalPenalty);
}
