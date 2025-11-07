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

export function computeIndexPenalty({
  anchorDate,
  uptakeBreakdown,
  indexWindows,
}: IndexPenaltyInputs): number {
  const anchor = new Date(anchorDate).getTime();
  const penaltyWindows = indexWindows.filter((w) => {
    const start = new Date(w.window_start).getTime();
    const end = new Date(w.window_end).getTime();
    return anchor >= start && anchor <= end;
  });

  if (penaltyWindows.length === 0) {
    return 0;
  }

  const passiveShare = uptakeBreakdown.passive;
  const factor = Math.min(1, passiveShare);
  return factor * penaltyWindows.length * 0.5;
}
