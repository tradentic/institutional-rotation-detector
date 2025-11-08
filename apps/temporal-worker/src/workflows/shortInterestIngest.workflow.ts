import { proxyActivities } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils.js';

const activities = proxyActivities<{
  fetchShortInterestWithPublicationDate: (
    symbols: string[],
    settlementDate: string,
    publicationDate: string
  ) => Promise<number>;
}>({
  startToCloseTimeout: '5 minutes',
  scheduleToCloseTimeout: '10 minutes',
});

export interface ShortInterestIngestInput {
  symbols?: string[];
  fromSettlement?: string; // YYYY-MM-DD
  toSettlement?: string;   // YYYY-MM-DD
  runKind?: 'backfill' | 'scheduled';
}

/**
 * Short Interest Ingest Workflow
 *
 * Ingests FINRA short interest data on semi-monthly settlement dates.
 * FINRA publishes short interest data twice per month:
 * - Mid-month: Settlement date 15th of month
 * - Month-end: Last day of month
 *
 * Publication occurs ~2 business days after settlement.
 *
 * This workflow loads short interest with both settlement and publication dates
 * for event-study timeline accuracy.
 *
 * Search Attributes:
 * - Dataset: 'SHORT_INT'
 * - SettlementDate: settlement date
 * - RunKind: 'backfill' | 'scheduled'
 */
export async function shortInterestIngestWorkflow(
  input: ShortInterestIngestInput
): Promise<{ settlementsProcessed: number; totalRecords: number }> {
  const runKind = input.runKind ?? 'scheduled';
  const symbols = input.symbols ?? [];

  // Generate settlement dates in the range
  const settlements = input.fromSettlement && input.toSettlement
    ? generateSettlementDates(input.fromSettlement, input.toSettlement)
    : input.fromSettlement
    ? [{ settlement: input.fromSettlement, publication: getPublicationDate(input.fromSettlement) }]
    : [getNextSettlement()];

  let totalRecords = 0;

  for (const { settlement, publication } of settlements) {
    // Fetch short interest for this settlement date
    // Note: This is a placeholder - the actual activity needs to be implemented
    // to call FINRA short interest API with publication date tracking
    const count = await activities.fetchShortInterestWithPublicationDate(
      symbols,
      settlement,
      publication
    );

    totalRecords += count;

    await upsertWorkflowSearchAttributes({
      Dataset: 'SHORT_INT',
      SettlementDate: settlement,
      RunKind: runKind,
    });
  }

  return {
    settlementsProcessed: settlements.length,
    totalRecords,
  };
}

interface SettlementDate {
  settlement: string;
  publication: string;
}

/**
 * Generate settlement dates (15th and month-end) between from and to dates
 */
function generateSettlementDates(from: string, to: string): SettlementDate[] {
  const start = new Date(from);
  const end = new Date(to);
  const settlements: SettlementDate[] = [];

  let current = new Date(start.getFullYear(), start.getMonth(), 1);

  while (current <= end) {
    // Mid-month (15th)
    const midMonth = new Date(current.getFullYear(), current.getMonth(), 15);
    if (midMonth >= start && midMonth <= end) {
      settlements.push({
        settlement: midMonth.toISOString().slice(0, 10),
        publication: getPublicationDate(midMonth.toISOString().slice(0, 10)),
      });
    }

    // Month-end
    const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
    if (monthEnd >= start && monthEnd <= end) {
      settlements.push({
        settlement: monthEnd.toISOString().slice(0, 10),
        publication: getPublicationDate(monthEnd.toISOString().slice(0, 10)),
      });
    }

    // Move to next month
    current.setMonth(current.getMonth() + 1);
  }

  return settlements;
}

/**
 * Get next settlement date from today
 */
function getNextSettlement(): SettlementDate {
  const now = new Date();
  const day = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();

  let settlement: Date;

  if (day < 15) {
    // Next settlement is 15th of this month
    settlement = new Date(year, month, 15);
  } else {
    // Next settlement is month-end
    settlement = new Date(year, month + 1, 0);
  }

  return {
    settlement: settlement.toISOString().slice(0, 10),
    publication: getPublicationDate(settlement.toISOString().slice(0, 10)),
  };
}

/**
 * Calculate publication date (approximately 2 business days after settlement)
 */
function getPublicationDate(settlementDate: string): string {
  const settlement = new Date(settlementDate);
  let businessDays = 0;
  let current = new Date(settlement);

  // Add 2 business days
  while (businessDays < 2) {
    current.setDate(current.getDate() + 1);
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      businessDays++;
    }
  }

  return current.toISOString().slice(0, 10);
}
