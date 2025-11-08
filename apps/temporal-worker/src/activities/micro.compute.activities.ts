import { createSupabaseClient } from '../lib/supabase.js';

interface RangeBounds {
  start: string;
  end: string;
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function getWeekBounds(weekEnd: string): RangeBounds {
  const endDate = new Date(`${weekEnd}T00:00:00Z`);
  if (Number.isNaN(endDate.getTime())) {
    throw new Error(`Invalid week end date ${weekEnd}`);
  }
  const startDate = new Date(endDate.getTime() - 6 * 24 * 60 * 60 * 1000);
  const format = (date: Date) => date.toISOString().slice(0, 10);
  return { start: format(startDate), end: format(endDate) };
}

function sum(rows: { value: number }[]): number {
  return rows.reduce((acc, row) => acc + (Number.isFinite(row.value) ? row.value : 0), 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function asNumber(input: unknown): number {
  if (typeof input === 'number') return input;
  if (typeof input === 'string') {
    const cleaned = input.replace(/[,\s]/g, '');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

interface DailySeriesRow {
  as_of: string;
  offex_pct: number | null;
  offex_shares: number | null;
  on_ex_shares: number | null;
  quality_flag: string | null;
}

export async function computeWeeklyOfficial(symbolInput: string, weekEnd: string): Promise<void> {
  const supabase = createSupabaseClient();
  const symbol = normalizeSymbol(symbolInput);
  const { data: weekRow, error: weekError } = await supabase
    .from('micro_offex_symbol_weekly')
    .select('ats_shares,nonats_shares,product')
    .eq('symbol', symbol)
    .eq('week_end', weekEnd)
    .maybeSingle();
  if (weekError) {
    throw weekError;
  }
  if (!weekRow) {
    return;
  }
  const offexShares = asNumber(weekRow.ats_shares ?? 0) + asNumber(weekRow.nonats_shares ?? 0);
  const bounds = getWeekBounds(weekEnd);
  const { data: consolidatedRows, error: consolidatedError } = await supabase
    .from('micro_consolidated_volume_daily')
    .select('trade_date,total_shares')
    .eq('symbol', symbol)
    .gte('trade_date', bounds.start)
    .lte('trade_date', bounds.end);
  if (consolidatedError) {
    throw consolidatedError;
  }
  const consolidated = consolidatedRows?.map((row: any) => ({
    date: row.trade_date as string,
    value: asNumber(row.total_shares ?? 0),
  })) ?? [];
  const consolidatedWeek = sum(consolidated);
  let quality = 'official_partial';
  let offexPct: number | null = null;
  let onExShares: number | null = null;
  if (consolidatedWeek > 0) {
    offexPct = clamp(offexShares / consolidatedWeek, 0, 1);
    onExShares = consolidatedWeek - offexShares;
    quality = 'official';
  }
  const { error: upsertError } = await supabase
    .from('micro_offex_ratio')
    .upsert(
      [
        {
          symbol,
          as_of: weekEnd,
          granularity: 'weekly',
          offex_shares: offexShares,
          on_ex_shares: onExShares,
          offex_pct: offexPct,
          quality_flag: quality,
          basis_window: `[${bounds.start},${bounds.end}]`,
          provenance: { dataset: 'FINRA_OTC', aggregated: true },
        },
      ],
      { onConflict: 'symbol,as_of,granularity' }
    );
  if (upsertError) {
    throw upsertError;
  }
}

export async function computeDailyApprox(symbolInput: string, weekEnd: string): Promise<void> {
  const supabase = createSupabaseClient();
  const symbol = normalizeSymbol(symbolInput);
  const bounds = getWeekBounds(weekEnd);
  const { data: weekRow, error: weekError } = await supabase
    .from('micro_offex_symbol_weekly')
    .select('ats_shares,nonats_shares')
    .eq('symbol', symbol)
    .eq('week_end', weekEnd)
    .maybeSingle();
  if (weekError) {
    throw weekError;
  }
  if (!weekRow) {
    return;
  }
  const weeklyOffex = asNumber(weekRow.ats_shares ?? 0) + asNumber(weekRow.nonats_shares ?? 0);
  if (weeklyOffex <= 0) {
    return;
  }
  const [consolidated, iex] = await Promise.all([
    supabase
      .from('micro_consolidated_volume_daily')
      .select('trade_date,total_shares,quality_flag')
      .eq('symbol', symbol)
      .gte('trade_date', bounds.start)
      .lte('trade_date', bounds.end),
    supabase
      .from('micro_iex_volume_daily')
      .select('trade_date,matched_shares')
      .eq('symbol', symbol)
      .gte('trade_date', bounds.start)
      .lte('trade_date', bounds.end),
  ]);
  if (consolidated.error) throw consolidated.error;
  if (iex.error) throw iex.error;

  const consolidatedRows = (consolidated.data ?? []).map((row: any) => ({
    date: row.trade_date as string,
    value: asNumber(row.total_shares ?? 0),
    quality: row.quality_flag as string | null,
  }));
  const iexRows = (iex.data ?? []).map((row: any) => ({
    date: row.trade_date as string,
    value: asNumber(row.matched_shares ?? 0),
  }));

  const upserts: any[] = [];
  const basisWindow = `[${bounds.start},${bounds.end}]`;

  const consolidatedTotal = sum(consolidatedRows.map((row) => ({ value: row.value })));
  if (consolidatedTotal > 0) {
    for (const row of consolidatedRows) {
      const share = row.value / consolidatedTotal;
      const offexShares = weeklyOffex * share;
      const total = row.value;
      const onExShares = Math.max(total - offexShares, 0);
      const pct = total > 0 ? clamp(offexShares / total, 0, 1) : null;
      upserts.push({
        symbol,
        as_of: row.date,
        granularity: 'daily',
        offex_shares: offexShares,
        on_ex_shares: onExShares,
        offex_pct: pct,
        quality_flag: 'approx',
        basis_window: basisWindow,
        provenance: { dataset: 'FINRA_OTC', method: 'consolidated', quality: row.quality ?? 'official' },
      });
    }
  } else {
    const iexTotal = sum(iexRows.map((row) => ({ value: row.value })));
    if (iexTotal > 0) {
      for (const row of iexRows) {
        const share = row.value / iexTotal;
        const offexShares = weeklyOffex * share;
        const onExShares = row.value;
        const denominator = offexShares + onExShares;
        const pct = denominator > 0 ? clamp(offexShares / denominator, 0, 1) : null;
        upserts.push({
          symbol,
          as_of: row.date,
          granularity: 'daily',
          offex_shares: offexShares,
          on_ex_shares: onExShares,
          offex_pct: pct,
          quality_flag: 'iex_proxy',
          basis_window: basisWindow,
          provenance: { dataset: 'FINRA_OTC', method: 'iex_proxy' },
        });
      }
    }
  }
  if (upserts.length === 0) {
    return;
  }
  const { error: upsertError } = await supabase
    .from('micro_offex_ratio')
    .upsert(upserts, { onConflict: 'symbol,as_of,granularity' });
  if (upsertError) {
    throw upsertError;
  }
}

export async function loadDailySeries(
  symbolInput: string,
  lookbackDays: number
): Promise<DailySeriesRow[]> {
  const supabase = createSupabaseClient();
  const symbol = normalizeSymbol(symbolInput);
  const { data, error } = await supabase
    .from('micro_offex_ratio')
    .select('as_of,offex_pct,offex_shares,on_ex_shares,quality_flag')
    .eq('symbol', symbol)
    .eq('granularity', 'daily')
    .order('as_of', { ascending: true })
    .gte('as_of', offsetDate(new Date(), -lookbackDays - 5));
  if (error) {
    throw error;
  }
  return (data ?? []) as DailySeriesRow[];
}

function offsetDate(anchor: Date, days: number): string {
  const shifted = new Date(anchor.getTime() + days * 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export async function recordFlip50Event(params: {
  symbol: string;
  eventDate: string;
  lookbackDays: number;
  precedingStreak: number;
  offexPct: number | null;
  qualityFlag: string | null;
}): Promise<void> {
  const supabase = createSupabaseClient();
  const { error } = await supabase
    .from('micro_flip50_events')
    .upsert(
      [
        {
          symbol: normalizeSymbol(params.symbol),
          event_date: params.eventDate,
          lookback_days: params.lookbackDays,
          preceding_streak: params.precedingStreak,
          offex_pct: params.offexPct,
          quality_flag: params.qualityFlag,
        },
      ],
      { onConflict: 'symbol,event_date' }
    );
  if (error) {
    throw error;
  }
}

export async function loadOffexSeriesAround(
  symbolInput: string,
  start: string,
  end: string
): Promise<DailySeriesRow[]> {
  const supabase = createSupabaseClient();
  const symbol = normalizeSymbol(symbolInput);
  const { data, error } = await supabase
    .from('micro_offex_ratio')
    .select('as_of,offex_pct,offex_shares,on_ex_shares,quality_flag')
    .eq('symbol', symbol)
    .eq('granularity', 'daily')
    .gte('as_of', start)
    .lte('as_of', end)
    .order('as_of', { ascending: true });
  if (error) throw error;
  return (data ?? []) as DailySeriesRow[];
}

export async function upsertEventStudyResult(result: {
  symbol: string;
  eventType: string;
  anchorDate: string;
  cik?: string | null;
  car_m5_p20: number;
  tt_plus20_days: number;
  max_ret_w13: number;
  plus_1w: number;
  plus_2w: number;
  plus_4w: number;
  plus_8w: number;
  plus_13w: number;
  offexCovariates: Record<string, number | null>;
  shortInterestChange: number | null;
  iexShare: number | null;
}): Promise<void> {
  const supabase = createSupabaseClient();
  const { error } = await supabase
    .from('micro_event_study_results')
    .upsert(
      [
        {
          symbol: normalizeSymbol(result.symbol),
          event_type: result.eventType,
          anchor_date: result.anchorDate,
          cik: result.cik ?? null,
          car_m5_p20: result.car_m5_p20,
          tt_plus20_days: result.tt_plus20_days,
          max_ret_w13: result.max_ret_w13,
          plus_1w: result.plus_1w,
          plus_2w: result.plus_2w,
          plus_4w: result.plus_4w,
          plus_8w: result.plus_8w,
          plus_13w: result.plus_13w,
          offex_covariates: result.offexCovariates,
          short_interest_covariate: result.shortInterestChange,
          iex_share: result.iexShare,
        },
      ],
      { onConflict: 'symbol,event_type,anchor_date,cik' }
    );
  if (error) {
    throw error;
  }
}
