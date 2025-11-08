import { createSupabaseClient } from '../lib/supabase.js';

export interface IndexPenaltyInput {
  filingDate: string;
  cik: string;
}

export interface IndexPenaltyResult {
  penalty: number; // 0.0 = no penalty, 1.0 = full penalty (inside rebalance window)
  matchedWindows: Array<{
    indexName: string;
    phase: string;
    windowStart: string;
    windowEnd: string;
  }>;
}

/**
 * Compute index penalty for a filing based on whether it falls within
 * known index rebalance windows (Russell, S&P, etc.).
 *
 * Passive index funds rebalance during these windows, which creates
 * mechanical buying/selling that is NOT an institutional rotation signal.
 *
 * Returns:
 * - penalty: 0.0 if outside all windows (no penalty)
 * - penalty: 0.5 if overlaps with one rebalance window
 * - penalty: 1.0 if overlaps with multiple windows (likely pure index noise)
 */
export async function indexPenalty(input: IndexPenaltyInput): Promise<IndexPenaltyResult> {
  const supabase = createSupabaseClient();

  // Query all index windows that overlap with the filing date
  const { data, error } = await supabase
    .from('index_windows')
    .select('index_name, phase, window_start, window_end')
    .lte('window_start', input.filingDate)
    .gte('window_end', input.filingDate);

  if (error) {
    throw error;
  }

  const matchedWindows = data || [];

  // Compute penalty based on number of overlapping windows
  let penalty = 0;
  if (matchedWindows.length === 1) {
    penalty = 0.5; // Moderate penalty for single window overlap
  } else if (matchedWindows.length >= 2) {
    penalty = 1.0; // Full penalty for multiple window overlaps
  }

  return {
    penalty,
    matchedWindows: matchedWindows.map((w) => ({
      indexName: w.index_name,
      phase: w.phase,
      windowStart: w.window_start,
      windowEnd: w.window_end,
    })),
  };
}

/**
 * Batch compute index penalties for multiple filings.
 * More efficient than calling indexPenalty repeatedly.
 */
export async function batchIndexPenalty(
  filings: Array<{ filingDate: string; cik: string }>
): Promise<Map<string, IndexPenaltyResult>> {
  const results = new Map<string, IndexPenaltyResult>();

  // For now, just call indexPenalty for each filing
  // In production, optimize with a single query joining filings and windows
  for (const filing of filings) {
    const result = await indexPenalty(filing);
    const key = `${filing.cik}:${filing.filingDate}`;
    results.set(key, result);
  }

  return results;
}

/**
 * Update rotation_events table with index penalty for a cluster.
 */
export async function persistIndexPenalty(
  clusterId: string,
  penalty: number,
  matchedWindows: IndexPenaltyResult['matchedWindows']
): Promise<void> {
  const supabase = createSupabaseClient();

  // Update rotation_events with the penalty
  const { error: updateError } = await supabase
    .from('rotation_events')
    .update({ index_penalty: penalty })
    .eq('cluster_id', clusterId);

  if (updateError) {
    throw updateError;
  }

  // Add provenance entries for each matched window as 'context' role
  if (matchedWindows.length > 0) {
    const provenanceEntries = matchedWindows.map((window) => ({
      cluster_id: clusterId,
      accession: `INDEX:${window.indexName}:${window.phase}`, // Pseudo-accession for index windows
      role: 'context' as const,
      entity_id: null, // No specific entity for index windows
      contribution_weight: -penalty / matchedWindows.length, // Negative weight = penalty
    }));

    const { error: provenanceError } = await supabase
      .from('rotation_event_provenance')
      .upsert(provenanceEntries, {
        onConflict: 'cluster_id,accession,role',
      });

    if (provenanceError) {
      throw provenanceError;
    }
  }
}
