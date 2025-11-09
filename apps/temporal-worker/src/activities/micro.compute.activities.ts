import { createSupabaseClient } from '../lib/supabase.js';
import type {
  MicroOffExSymbolWeeklyRecord,
  MicroIexVolumeDailyRecord,
  MicroConsolidatedVolumeDailyRecord,
  MicroOffExRatioRecord,
  MicroFlip50EventRecord,
  OffExQualityFlag,
} from '../lib/schema.js';

/**
 * Compute weekly official off-exchange ratio
 *
 * Uses FINRA OTC weekly totals and consolidated weekly volume (if available)
 * Quality flags:
 * - 'official': FINRA week + full consolidated week
 * - 'official_partial': FINRA week only, missing consolidated data
 */
export async function computeWeeklyOfficial(
  symbol: string,
  weekEnd: string
): Promise<{ upserted: boolean; qualityFlag: OffExQualityFlag }> {
  const supabase = createSupabaseClient();

  // Get FINRA OTC weekly totals
  const { data: finraData, error: finraError } = await supabase
    .from('micro_offex_symbol_weekly')
    .select('*')
    .eq('symbol', symbol)
    .eq('week_end', weekEnd)
    .maybeSingle();

  if (finraError) {
    throw new Error(`Failed to query FINRA OTC weekly: ${finraError.message}`);
  }

  if (!finraData) {
    // No FINRA data for this week
    return { upserted: false, qualityFlag: 'official_partial' };
  }

  const offexShares = finraData.offex_shares ?? 0;

  // Try to get consolidated weekly volume (sum of daily consolidated)
  const weekStart = getWeekStart(weekEnd);
  const { data: consolidatedData, error: consolidatedError } = await supabase
    .from('micro_consolidated_volume_daily')
    .select('total_shares')
    .eq('symbol', symbol)
    .gte('trade_date', weekStart)
    .lte('trade_date', weekEnd);

  if (consolidatedError) {
    throw new Error(`Failed to query consolidated volume: ${consolidatedError.message}`);
  }

  let onExShares: number | null = null;
  let offexPct: number | null = null;
  let qualityFlag: OffExQualityFlag = 'official_partial';

  if (consolidatedData && consolidatedData.length > 0) {
    // Sum consolidated volume for the week
    const weeklyConsolidated = consolidatedData.reduce(
      (sum, row) => sum + (row.total_shares ?? 0),
      0
    );

    if (weeklyConsolidated > 0) {
      onExShares = weeklyConsolidated - offexShares;
      offexPct = offexShares / weeklyConsolidated;
      qualityFlag = 'official';
    }
  }

  // Upsert the ratio
  const record: MicroOffExRatioRecord = {
    symbol,
    as_of: weekEnd,
    granularity: 'weekly',
    offex_shares: offexShares,
    on_ex_shares: onExShares,
    offex_pct: offexPct,
    quality_flag: qualityFlag,
    basis_window: null,
  };

  const { error: upsertError } = await supabase
    .from('micro_offex_ratio')
    .upsert([record], { onConflict: 'symbol,as_of,granularity' });

  if (upsertError) {
    throw new Error(`Failed to upsert off-exchange ratio: ${upsertError.message}`);
  }

  return { upserted: true, qualityFlag };
}

/**
 * Compute daily approximation of off-exchange ratio
 *
 * Distributes weekly FINRA off-exchange totals across daily volumes
 * Quality flags:
 * - 'approx': Using consolidated daily totals to apportion weekly offex
 * - 'iex_proxy': Using IEX matched shares as on-exchange proxy
 */
export async function computeDailyApprox(
  symbol: string,
  weekEnd: string
): Promise<{ upsertCount: number; qualityFlag: OffExQualityFlag }> {
  const supabase = createSupabaseClient();

  // Get FINRA OTC weekly totals
  const { data: finraData, error: finraError } = await supabase
    .from('micro_offex_symbol_weekly')
    .select('*')
    .eq('symbol', symbol)
    .eq('week_end', weekEnd)
    .maybeSingle();

  if (finraError) {
    throw new Error(`Failed to query FINRA OTC weekly: ${finraError.message}`);
  }

  if (!finraData || !finraData.offex_shares) {
    return { upsertCount: 0, qualityFlag: 'approx' };
  }

  const weeklyOffexShares = finraData.offex_shares;
  const weekStart = getWeekStart(weekEnd);

  // Try consolidated daily volumes first
  const { data: consolidatedData, error: consolidatedError } = await supabase
    .from('micro_consolidated_volume_daily')
    .select('*')
    .eq('symbol', symbol)
    .gte('trade_date', weekStart)
    .lte('trade_date', weekEnd)
    .order('trade_date');

  if (consolidatedError) {
    throw new Error(`Failed to query consolidated volume: ${consolidatedError.message}`);
  }

  if (consolidatedData && consolidatedData.length > 0) {
    // Use consolidated daily volumes to apportion weekly offex
    return await apportionWithConsolidated(
      supabase,
      symbol,
      weekEnd,
      weekStart,
      weeklyOffexShares,
      consolidatedData as MicroConsolidatedVolumeDailyRecord[]
    );
  }

  // Fall back to IEX proxy
  const { data: iexData, error: iexError } = await supabase
    .from('micro_iex_volume_daily')
    .select('*')
    .eq('symbol', symbol)
    .gte('trade_date', weekStart)
    .lte('trade_date', weekEnd)
    .order('trade_date');

  if (iexError) {
    throw new Error(`Failed to query IEX volume: ${iexError.message}`);
  }

  if (!iexData || iexData.length === 0) {
    return { upsertCount: 0, qualityFlag: 'iex_proxy' };
  }

  return await apportionWithIex(
    supabase,
    symbol,
    weekEnd,
    weekStart,
    weeklyOffexShares,
    iexData as MicroIexVolumeDailyRecord[]
  );
}

async function apportionWithConsolidated(
  supabase: ReturnType<typeof createSupabaseClient>,
  symbol: string,
  weekEnd: string,
  weekStart: string,
  weeklyOffexShares: number,
  consolidatedData: MicroConsolidatedVolumeDailyRecord[]
): Promise<{ upsertCount: number; qualityFlag: OffExQualityFlag }> {
  const totalConsolidated = consolidatedData.reduce(
    (sum, row) => sum + (row.total_shares ?? 0),
    0
  );

  if (totalConsolidated === 0) {
    return { upsertCount: 0, qualityFlag: 'approx' };
  }

  const records: MicroOffExRatioRecord[] = [];

  for (const row of consolidatedData) {
    const dailyTotal = row.total_shares ?? 0;
    if (dailyTotal === 0) continue;

    const proportion = dailyTotal / totalConsolidated;
    const dailyOffex = weeklyOffexShares * proportion;
    const dailyOnEx = dailyTotal - dailyOffex;
    const offexPct = dailyOffex / dailyTotal;

    records.push({
      symbol,
      as_of: row.trade_date,
      granularity: 'daily',
      offex_shares: dailyOffex,
      on_ex_shares: dailyOnEx,
      offex_pct: offexPct,
      quality_flag: 'approx',
      basis_window: `[${weekStart},${weekEnd}]`,
    });
  }

  if (records.length === 0) {
    return { upsertCount: 0, qualityFlag: 'approx' };
  }

  const { error, count } = await supabase
    .from('micro_offex_ratio')
    .upsert(records, { onConflict: 'symbol,as_of,granularity' })
    .select('symbol', { count: 'exact', head: true });

  if (error) {
    throw new Error(`Failed to upsert daily approx ratios: ${error.message}`);
  }

  return { upsertCount: count ?? records.length, qualityFlag: 'approx' };
}

async function apportionWithIex(
  supabase: ReturnType<typeof createSupabaseClient>,
  symbol: string,
  weekEnd: string,
  weekStart: string,
  weeklyOffexShares: number,
  iexData: MicroIexVolumeDailyRecord[]
): Promise<{ upsertCount: number; qualityFlag: OffExQualityFlag }> {
  const totalIex = iexData.reduce((sum, row) => sum + row.matched_shares, 0);

  if (totalIex === 0) {
    return { upsertCount: 0, qualityFlag: 'iex_proxy' };
  }

  const records: MicroOffExRatioRecord[] = [];

  for (const row of iexData) {
    const dailyIex = row.matched_shares;
    if (dailyIex === 0) continue;

    // Approximate: assume IEX is proportional to total on-exchange
    const proportion = dailyIex / totalIex;
    const dailyOffexApprox = weeklyOffexShares * proportion;

    // Note: We don't know the true consolidated total, so we store IEX as on_ex_shares
    // and mark quality as 'iex_proxy' to indicate this is NOT consolidated
    const offexPct = dailyOffexApprox / (dailyOffexApprox + dailyIex);

    records.push({
      symbol,
      as_of: row.trade_date,
      granularity: 'daily',
      offex_shares: dailyOffexApprox,
      on_ex_shares: dailyIex, // IEX matched shares, NOT consolidated
      offex_pct: offexPct,
      quality_flag: 'iex_proxy',
      basis_window: `[${weekStart},${weekEnd}]`,
    });
  }

  if (records.length === 0) {
    return { upsertCount: 0, qualityFlag: 'iex_proxy' };
  }

  const { error, count } = await supabase
    .from('micro_offex_ratio')
    .upsert(records, { onConflict: 'symbol,as_of,granularity' })
    .select('symbol', { count: 'exact', head: true });

  if (error) {
    throw new Error(`Failed to upsert IEX proxy ratios: ${error.message}`);
  }

  return { upsertCount: count ?? records.length, qualityFlag: 'iex_proxy' };
}

/**
 * Detect Flip50 events for a symbol
 *
 * A Flip50 event occurs when:
 * - Off-exchange % crosses below 50%
 * - After ≥N consecutive trading days above 50%
 *
 * @param symbol - Stock symbol
 * @param lookbackDays - Number of days to look back (default 90)
 * @param consecutiveDaysThreshold - Minimum consecutive days ≥50% (default 20)
 */
export async function detectFlip50(
  symbol: string,
  lookbackDays = 90,
  consecutiveDaysThreshold = 20
): Promise<{ eventsDetected: number }> {
  const supabase = createSupabaseClient();

  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Get daily off-exchange ratios
  const { data, error } = await supabase
    .from('micro_offex_ratio')
    .select('*')
    .eq('symbol', symbol)
    .eq('granularity', 'daily')
    .gte('as_of', startDate)
    .lte('as_of', endDate)
    .order('as_of');

  if (error) {
    throw new Error(`Failed to query off-exchange ratios: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return { eventsDetected: 0 };
  }

  const ratios = data as MicroOffExRatioRecord[];
  const events: MicroFlip50EventRecord[] = [];

  let consecutiveAbove50 = 0;
  let periodStart: string | null = null;
  let periodSum = 0;

  for (let i = 0; i < ratios.length; i++) {
    const current = ratios[i]!;
    const offexPct = current.offex_pct ?? 0;

    if (offexPct >= 0.5) {
      // Above or at 50%
      if (consecutiveAbove50 === 0) {
        periodStart = current.as_of;
      }
      consecutiveAbove50++;
      periodSum += offexPct;
    } else {
      // Below 50%
      if (consecutiveAbove50 >= consecutiveDaysThreshold) {
        // Flip50 event detected!
        events.push({
          symbol,
          flip_date: current.as_of,
          pre_period_start: periodStart,
          pre_period_days: consecutiveAbove50,
          pre_avg_offex_pct: periodSum / consecutiveAbove50,
          flip_offex_pct: offexPct,
          quality_flag: current.quality_flag ?? 'approx',
        });
      }
      // Reset counter
      consecutiveAbove50 = 0;
      periodStart = null;
      periodSum = 0;
    }
  }

  if (events.length === 0) {
    return { eventsDetected: 0 };
  }

  // Upsert events
  const { error: upsertError, count } = await supabase
    .from('micro_flip50_events')
    .upsert(events, { onConflict: 'symbol,flip_date' })
    .select('id', { count: 'exact', head: true });

  if (upsertError) {
    throw new Error(`Failed to upsert Flip50 events: ${upsertError.message}`);
  }

  return { eventsDetected: count ?? events.length };
}

/**
 * Get off-exchange ratio time series
 */
export async function getOffExRatioRange(
  symbol: string,
  fromDate: string,
  toDate: string,
  granularity: 'weekly' | 'daily' | null = null
): Promise<MicroOffExRatioRecord[]> {
  const supabase = createSupabaseClient();

  let query = supabase
    .from('micro_offex_ratio')
    .select('*')
    .eq('symbol', symbol)
    .gte('as_of', fromDate)
    .lte('as_of', toDate);

  if (granularity) {
    query = query.eq('granularity', granularity);
  }

  const { data, error } = await query.order('as_of');

  if (error) {
    throw new Error(`Failed to query off-exchange ratios: ${error.message}`);
  }

  return (data ?? []) as MicroOffExRatioRecord[];
}

/**
 * Helper: Get week start date (Monday) from week end date
 */
function getWeekStart(weekEnd: string): string {
  const end = new Date(weekEnd);
  const dayOfWeek = end.getDay();
  // Assuming week ends on Friday (5)
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek + 2; // Adjust for week ending Friday
  const start = new Date(end);
  start.setDate(end.getDate() - 4); // 5 trading days back (Mon-Fri)
  return start.toISOString().slice(0, 10);
}
