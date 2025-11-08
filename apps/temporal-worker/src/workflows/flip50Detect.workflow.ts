import { proxyActivities, startChild } from '@temporalio/workflow';
import { upsertWorkflowSearchAttributes } from './utils.js';
import type { EventStudyInput } from './eventStudy.workflow.js';

const activities = proxyActivities<{
  loadDailySeries: (symbol: string, lookbackDays: number) => Promise<
    { as_of: string; offex_pct: number | null; offex_shares: number | null; on_ex_shares: number | null; quality_flag: string | null }[]
  >;
  recordFlip50Event: (params: {
    symbol: string;
    eventDate: string;
    lookbackDays: number;
    precedingStreak: number;
    offexPct: number | null;
    qualityFlag: string | null;
  }) => Promise<void>;
}>(
  {
    startToCloseTimeout: '2 minutes',
  }
);

export interface Flip50DetectInput {
  symbol: string;
  ticker?: string;
  cik?: string;
  lookbackDays?: number;
  runKind?: 'backfill' | 'daily';
}

export async function flip50DetectWorkflow(input: Flip50DetectInput) {
  const lookbackDays = input.lookbackDays ?? 20;
  const symbol = input.symbol.toUpperCase();
  await upsertWorkflowSearchAttributes({
    dataset: 'FINRA_OTC_RATIO',
    granularity: 'daily',
    symbol,
    runKind: input.runKind ?? 'daily',
    batchId: `flip50:${symbol}`,
  });
  const series = await activities.loadDailySeries(symbol, Math.max(lookbackDays + 5, 30));
  let streak = 0;
  for (const row of series) {
    const pct = row.offex_pct;
    if (pct === null || pct === undefined) {
      streak = 0;
      continue;
    }
    if (pct >= 0.5) {
      streak += 1;
      continue;
    }
    if (pct < 0.5 && streak >= lookbackDays) {
      await activities.recordFlip50Event({
        symbol,
        eventDate: row.as_of,
        lookbackDays,
        precedingStreak: streak,
        offexPct: pct,
        qualityFlag: row.quality_flag,
      });
      if (input.cik && input.ticker) {
        const child = await startChild<EventStudyInput>('eventStudyWorkflow', {
          args: [
            {
              anchorDate: row.as_of,
              cik: input.cik,
              ticker: input.ticker,
              runKind: input.runKind ?? 'daily',
              quarterStart: row.as_of,
              quarterEnd: row.as_of,
            } satisfies EventStudyInput,
          ],
        });
        await child.result();
      }
      break;
    }
    streak = 0;
  }
}
