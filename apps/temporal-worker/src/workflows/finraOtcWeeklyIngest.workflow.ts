import { proxyActivities } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils';
import type {
  FinraOtcWeeklyInput,
  FinraOtcWeeklyResult,
} from '../activities/finra.activities';
import { adjustToPreviousTradingDayString } from '../lib/tradingCalendar';

const activities = proxyActivities<{
  fetchOtcWeeklyVenue: (input: FinraOtcWeeklyInput) => Promise<FinraOtcWeeklyResult>;
  aggregateOtcSymbolWeek: (weekEnd: string, symbols?: string[]) => Promise<number>;
}>({
  startToCloseTimeout: '5 minutes',
  scheduleToCloseTimeout: '10 minutes',
});

export interface FinraOtcWeeklyIngestInput {
  symbols?: string[];
  fromWeek?: string; // YYYY-MM-DD (week end date)
  toWeek?: string;   // YYYY-MM-DD (week end date)
  runKind?: 'backfill' | 'daily';
}

/**
 * FINRA OTC Weekly Ingest Workflow
 *
 * Ingests FINRA OTC Transparency weekly data (ATS + non-ATS) for a date range.
 * For each week:
 * 1. Fetch ATS venue-level data
 * 2. Fetch non-ATS venue-level data
 * 3. Aggregate to symbol-level weekly totals
 *
 * Search Attributes:
 * - Dataset: 'FINRA_OTC'
 * - Granularity: 'weekly'
 * - RunKind: 'backfill' | 'daily'
 * - Provenance: file IDs
 *
 * NOTE: WeekEnd is passed to activities but NOT set as a search attribute
 * (at Temporal dev server Datetime limit). Use date range queries instead.
 */
export async function finraOtcWeeklyIngestWorkflow(
  input: FinraOtcWeeklyIngestInput
): Promise<{ weeksProcessed: number; totalVenueRecords: number; totalSymbolRecords: number }> {
  const runKind = input.runKind ?? 'daily';
  const symbols = input.symbols ?? undefined;

  // Generate week end dates in the range
  const weeks = input.fromWeek && input.toWeek
    ? generateWeekEnds(input.fromWeek, input.toWeek)
    : input.fromWeek
    ? [input.fromWeek]
    : [getPreviousWeekEnd()];

  let totalVenueRecords = 0;
  let totalSymbolRecords = 0;

  for (const weekEnd of weeks) {
    // Adjust week end to previous trading day if it falls on a holiday
    // Week ends are typically Fridays, but if Friday is a holiday, use Thursday
    const adjustedWeekEnd = adjustToPreviousTradingDayString(weekEnd);

    // Fetch ATS data
    const atsResult = await activities.fetchOtcWeeklyVenue({
      symbols,
      weekEnd: adjustedWeekEnd,
      source: 'ATS',
    });

    // Fetch non-ATS data
    const nonAtsResult = await activities.fetchOtcWeeklyVenue({
      symbols,
      weekEnd: adjustedWeekEnd,
      source: 'NON_ATS',
    });

    // Aggregate to symbol level (idempotent operation)
    const symbolCount = await activities.aggregateOtcSymbolWeek(adjustedWeekEnd, symbols);

    totalVenueRecords += atsResult.venueUpsertCount + nonAtsResult.venueUpsertCount;
    totalSymbolRecords += symbolCount;

    // Set search attributes for this week
    await upsertWorkflowSearchAttributes({
      dataset: 'FINRA_OTC',
      granularity: 'weekly',
      weekEnd: adjustedWeekEnd,
      runKind: runKind,
      provenance: `${atsResult.fileId},${nonAtsResult.fileId}`,
    });
  }

  return {
    weeksProcessed: weeks.length,
    totalVenueRecords,
    totalSymbolRecords,
  };
}

/**
 * Generate list of week end dates between fromWeek and toWeek (inclusive)
 * Assumes weeks end on Friday
 */
function generateWeekEnds(fromWeek: string, toWeek: string): string[] {
  const start = new Date(fromWeek);
  const end = new Date(toWeek);
  const weeks: string[] = [];

  let current = new Date(start);
  while (current <= end) {
    weeks.push(current.toISOString().slice(0, 10));
    // Move to next week (7 days)
    current.setDate(current.getDate() + 7);
  }

  return weeks;
}

/**
 * Get the previous week end date (Friday)
 */
function getPreviousWeekEnd(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  // Calculate days to subtract to get to previous Friday (5)
  const daysToFriday = dayOfWeek === 0 ? 2 : dayOfWeek === 6 ? 1 : dayOfWeek + 2;
  const friday = new Date(now);
  friday.setDate(now.getDate() - daysToFriday);
  return friday.toISOString().slice(0, 10);
}
