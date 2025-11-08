import { randomUUID } from 'crypto';
import { createSupabaseClient } from '../lib/supabase.js';
import { computeRotationScore, ScoreInputs } from '../lib/scoring.js';
import type { RotationEventRecord } from '../lib/schema.js';

type SupabaseFactory = typeof createSupabaseClient;

let supabaseFactory: SupabaseFactory = createSupabaseClient;
const dumpContextCache = new Map<string, DumpComputationResult>();

export function __setSupabaseClientFactory(factory: SupabaseFactory) {
  supabaseFactory = factory;
  dumpContextCache.clear();
}

export function __clearDumpContextCache() {
  dumpContextCache.clear();
}

function getSupabaseClient() {
  return supabaseFactory();
}

const DEFAULT_MIN_DUMP_PCT = 0.30;
const DEFAULT_MIN_DUMP_FLOAT_PCT = 0.01;

function parseDate(input: string) {
  return new Date(`${input}T00:00:00Z`);
}

function formatDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftQuarterEnd(date: string, quarters: number) {
  const anchor = parseDate(date);
  const firstOfNextMonth = Date.UTC(
    anchor.getUTCFullYear(),
    anchor.getUTCMonth() + 1 + quarters * 3,
    1
  );
  const result = new Date(firstOfNextMonth - 24 * 60 * 60 * 1000);
  return formatDate(result);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function medianAbsoluteDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const med = median(values);
  const deviations = values.map((v) => Math.abs(v - med));
  return median(deviations);
}

function robustZScore(value: number, values: number[]): number {
  if (values.length < 2) return 0;
  const med = median(values);
  const mad = medianAbsoluteDeviation(values);
  if (mad === 0) return 0;
  return (value - med) / (mad * 1.4826);
}

interface PositionAggregate {
  shares: number;
  optCall: number;
  optPut: number;
}

interface EntityDelta {
  date: string;
  deltaShares: number;
  pctDelta: number;
  optDelta: number;
  prevShares: number;
}

interface DumpComputationResult {
  cusips: string[];
  deltasByEntity: Map<string, EntityDelta[]>;
  totalDumpShares: number;
  totalPositiveSame: number;
  totalPositiveNext: number;
  optionsSame: number;
  optionsNext: number;
  prevQuarterEnd: string;
  nextQuarterEnd: string;
}

async function computeDumpContext(cik: string, quarter: QuarterBounds): Promise<DumpComputationResult> {
  const cacheKey = `${cik}:${quarter.start}:${quarter.end}`;
  const cached = dumpContextCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const supabase = getSupabaseClient();
  const { data: cusipRows, error: cusipError } = await supabase
    .from('cusip_issuer_map')
    .select('cusip')
    .eq('issuer_cik', cik);
  if (cusipError) throw cusipError;
  const cusips = (cusipRows ?? []).map((row: any) => row.cusip).filter(Boolean);
  if (cusips.length === 0) {
    return {
      cusips: [],
      deltasByEntity: new Map(),
      totalDumpShares: 0,
      totalPositiveSame: 0,
      totalPositiveNext: 0,
      optionsSame: 0,
      optionsNext: 0,
      prevQuarterEnd: shiftQuarterEnd(quarter.end, -1),
      nextQuarterEnd: shiftQuarterEnd(quarter.end, 1),
    };
  }

  const prevQuarterEnd = shiftQuarterEnd(quarter.end, -1);
  const nextQuarterEnd = shiftQuarterEnd(quarter.end, 1);

  const { data: positionRows, error: positionError } = await supabase
    .from('positions_13f')
    .select('entity_id,cusip,asof,shares,opt_put_shares,opt_call_shares')
    .in('cusip', cusips)
    .gte('asof', prevQuarterEnd)
    .lte('asof', nextQuarterEnd);
  if (positionError) throw positionError;
  const aggregates = new Map<string, Map<string, PositionAggregate>>();
  for (const row of positionRows ?? []) {
    const entityId = row.entity_id;
    if (!entityId) continue;
    const asof = row.asof;
    if (!asof) continue;
    let entityMap = aggregates.get(entityId);
    if (!entityMap) {
      entityMap = new Map();
      aggregates.set(entityId, entityMap);
    }
    const existing = entityMap.get(asof) ?? { shares: 0, optCall: 0, optPut: 0 };
    existing.shares += toNumber(row.shares);
    existing.optCall += toNumber(row.opt_call_shares);
    existing.optPut += toNumber(row.opt_put_shares);
    entityMap.set(asof, existing);
  }

  const deltasByEntity = new Map<string, EntityDelta[]>();
  let totalDumpShares = 0;
  let totalPositiveSame = 0;
  let totalPositiveNext = 0;
  let optionsSame = 0;
  let optionsNext = 0;
  const quarterStart = quarter.start;
  const quarterEnd = quarter.end;

  for (const [entityId, snapshots] of aggregates.entries()) {
    const entries = Array.from(snapshots.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const deltas: EntityDelta[] = [];
    for (let i = 1; i < entries.length; i++) {
      const [date, current] = entries[i];
      const [, previous] = entries[i - 1];
      const prevShares = previous.shares;
      if (prevShares === 0) {
        deltas.push({
          date,
          deltaShares: current.shares - previous.shares,
          pctDelta: 0,
          optDelta:
            current.optCall - current.optPut - (previous.optCall - previous.optPut),
          prevShares,
        });
        continue;
      }
      const deltaShares = current.shares - previous.shares;
      const pctDelta = deltaShares / prevShares;
      const optDelta =
        current.optCall - current.optPut - (previous.optCall - previous.optPut);
      const delta: EntityDelta = {
        date,
        deltaShares,
        pctDelta,
        optDelta,
        prevShares,
      };
      deltas.push(delta);
      if (date >= quarterStart && date <= quarterEnd) {
        if (deltaShares < 0) {
          totalDumpShares += Math.abs(deltaShares);
        } else if (deltaShares > 0) {
          totalPositiveSame += deltaShares;
        }
        if (optDelta > 0) {
          optionsSame += optDelta;
        }
      } else if (date > quarterEnd && date <= nextQuarterEnd) {
        if (deltaShares > 0) {
          totalPositiveNext += deltaShares;
        }
        if (optDelta > 0) {
          optionsNext += optDelta;
        }
      }
    }
    deltasByEntity.set(entityId, deltas);
  }

  const result: DumpComputationResult = {
    cusips,
    deltasByEntity,
    totalDumpShares,
    totalPositiveSame,
    totalPositiveNext,
    optionsSame,
    optionsNext,
    prevQuarterEnd,
    nextQuarterEnd,
  };
  dumpContextCache.set(cacheKey, result);
  return result;
}

export interface QuarterBounds {
  start: string;
  end: string;
}

export interface DumpEvent {
  clusterId: string;
  anchorDate: string;
  seller: string;
  delta: number;
  dumpZ: number;
  absShares: number;
}

async function computeDumpZ(
  entityId: string,
  cusips: string[],
  currentDelta: number,
  currentDate: string
): Promise<number> {
  if (cusips.length === 0) return 0;
  const supabase = getSupabaseClient();
  const lookbackDate = formatDate(
    new Date(parseDate(currentDate).getTime() - 1095 * 24 * 60 * 60 * 1000)
  );
  const { data: historicalPositions, error } = await supabase
    .from('positions_13f')
    .select('entity_id,cusip,asof,shares')
    .in('cusip', cusips)
    .eq('entity_id', entityId)
    .gte('asof', lookbackDate)
    .lte('asof', currentDate);
  if (error) throw error;
  const byQuarter = new Map<string, Map<string, number>>();
  for (const row of historicalPositions ?? []) {
    const asof = row.asof;
    if (!byQuarter.has(asof)) {
      byQuarter.set(asof, new Map());
    }
    const quarterMap = byQuarter.get(asof)!;
    const existing = quarterMap.get(row.cusip) ?? 0;
    quarterMap.set(row.cusip, existing + toNumber(row.shares));
  }
  const quarters = Array.from(byQuarter.keys()).sort();
  const deltas: number[] = [];
  for (let i = 1; i < quarters.length; i++) {
    const curr = byQuarter.get(quarters[i])!;
    const prev = byQuarter.get(quarters[i - 1])!;
    let totalDelta = 0;
    for (const cusip of cusips) {
      const currShares = curr.get(cusip) ?? 0;
      const prevShares = prev.get(cusip) ?? 0;
      const delta = currShares - prevShares;
      if (delta < 0) {
        totalDelta += Math.abs(delta);
      }
    }
    if (totalDelta > 0) {
      deltas.push(totalDelta);
    }
  }
  if (deltas.length < 12) {
    return Math.abs(currentDelta) >= DEFAULT_MIN_DUMP_PCT ? 2.0 : 0;
  }
  return Math.abs(robustZScore(Math.abs(currentDelta), deltas));
}

export async function detectDumpEvents(
  cik: string,
  quarter: QuarterBounds
): Promise<DumpEvent[]> {
  const minDumpPct = Number(process.env.MIN_DUMP_PCT ?? '30') / 100 || DEFAULT_MIN_DUMP_PCT;
  const context = await computeDumpContext(cik, quarter);
  const events: DumpEvent[] = [];
  for (const [entityId, deltas] of context.deltasByEntity.entries()) {
    for (const delta of deltas) {
      if (delta.prevShares <= 0) continue;
      if (delta.date < quarter.start || delta.date > quarter.end) continue;
      if (delta.pctDelta >= -minDumpPct) continue;
      const absShares = Math.abs(delta.deltaShares);
      const dumpZ = await computeDumpZ(entityId, context.cusips, delta.pctDelta, delta.date);
      events.push({
        clusterId: randomUUID(),
        anchorDate: delta.date,
        seller: entityId,
        delta: delta.pctDelta,
        dumpZ,
        absShares,
      });
    }
  }

  const supabase = getSupabaseClient();
  const boWindowStart = formatDate(
    new Date(parseDate(quarter.start).getTime() - 190 * 24 * 60 * 60 * 1000)
  );
  const { data: boRows, error: boError } = await supabase
    .from('bo_snapshots')
    .select('holder_cik,event_date,shares_est,pct_of_class')
    .eq('issuer_cik', cik)
    .gte('event_date', boWindowStart)
    .lte('event_date', quarter.end);
  if (boError) throw boError;

  const boByHolder = new Map<string, any[]>();
  for (const row of boRows ?? []) {
    const holder = row.holder_cik;
    if (!holder) continue;
    if (!boByHolder.has(holder)) {
      boByHolder.set(holder, []);
    }
    boByHolder.get(holder)!.push(row);
  }

  for (const [holder, rows] of boByHolder.entries()) {
    rows.sort((a, b) => a.event_date.localeCompare(b.event_date));
    let previous: any | null = null;
    for (const row of rows) {
      if (!previous) {
        previous = row;
        continue;
      }
      const prevValue = toNumber(previous.shares_est ?? previous.pct_of_class);
      const currValue = toNumber(row.shares_est ?? row.pct_of_class);
      if (prevValue <= 0) {
        previous = row;
        continue;
      }
      const pctDelta = (currValue - prevValue) / prevValue;
      if (row.event_date >= quarter.start && row.event_date <= quarter.end && pctDelta <= -minDumpPct) {
        const absShares = Math.abs(currValue - prevValue);
        const dumpZ = await computeDumpZ(holder, context.cusips, pctDelta, row.event_date);
        events.push({
          clusterId: randomUUID(),
          anchorDate: row.event_date,
          seller: holder,
          delta: pctDelta,
          dumpZ,
          absShares,
        });
      }
      previous = row;
    }
  }

  return events;
}

export async function uptakeFromFilings(cik: string, quarter: QuarterBounds) {
  const context = await computeDumpContext(cik, quarter);
  if (context.totalDumpShares === 0) {
    return { uSame: 0, uNext: 0 };
  }
  const uSame = clamp(context.totalPositiveSame / context.totalDumpShares, 0, 1);
  const uNext = clamp(context.totalPositiveNext / context.totalDumpShares, 0, 1);
  return { uSame, uNext };
}

export async function uhf(cik: string, quarter: QuarterBounds) {
  const context = await computeDumpContext(cik, quarter);
  if (context.totalDumpShares === 0 || context.cusips.length === 0) {
    return { uhfSame: 0, uhfNext: 0 };
  }
  const supabase = getSupabaseClient();
  const baselineStart = formatDate(
    new Date(parseDate(quarter.start).getTime() - 31 * 24 * 60 * 60 * 1000)
  );
  const { data: uhfRows, error: uhfError } = await supabase
    .from('uhf_positions')
    .select('holder_id,cusip,asof,shares')
    .in('cusip', context.cusips)
    .gte('asof', baselineStart)
    .lte('asof', context.nextQuarterEnd);
  if (uhfError) throw uhfError;
  const series = new Map<string, any[]>();
  for (const row of uhfRows ?? []) {
    const holder = row.holder_id;
    if (!holder) continue;
    if (!series.has(holder)) {
      series.set(holder, []);
    }
    series.get(holder)!.push(row);
  }
  let same = 0;
  let next = 0;
  for (const rows of series.values()) {
    rows.sort((a, b) => a.asof.localeCompare(b.asof));
    for (let i = 1; i < rows.length; i++) {
      const current = rows[i];
      const previous = rows[i - 1];
      const delta = toNumber(current.shares) - toNumber(previous.shares);
      const date = current.asof;
      if (delta <= 0) continue;
      if (date >= quarter.start && date <= quarter.end) {
        same += delta;
      } else if (date > quarter.end && date <= context.nextQuarterEnd) {
        next += delta;
      }
    }
  }
  return {
    uhfSame: clamp(same / context.totalDumpShares, 0, 1),
    uhfNext: clamp(next / context.totalDumpShares, 0, 1),
  };
}

export async function optionsOverlay(cik: string, quarter: QuarterBounds) {
  const context = await computeDumpContext(cik, quarter);
  if (context.totalDumpShares === 0) {
    return { optSame: 0, optNext: 0 };
  }
  return {
    optSame: clamp(context.optionsSame / context.totalDumpShares, 0, 1),
    optNext: clamp(context.optionsNext / context.totalDumpShares, 0, 1),
  };
}

export async function shortReliefV2(cik: string, quarter: QuarterBounds) {
  const context = await computeDumpContext(cik, quarter);
  const supabase = getSupabaseClient();
  const { data: rows, error } = await supabase
    .from('short_interest')
    .select('settle_date,short_shares')
    .eq('cik', cik)
    .gte('settle_date', context.prevQuarterEnd)
    .lte('settle_date', context.nextQuarterEnd);
  if (error) throw error;
  const sorted = [...(rows ?? [])].sort((a, b) => a.settle_date.localeCompare(b.settle_date));
  const anchorDate = quarter.end;
  let before: any | null = null;
  let after: any | null = null;
  for (const row of sorted) {
    if (row.settle_date <= anchorDate) {
      if (!before || row.settle_date > before.settle_date) {
        before = row;
      }
    }
    if (row.settle_date >= anchorDate) {
      if (!after || row.settle_date < after.settle_date) {
        after = row;
      }
    }
  }
  if (!before || !after) {
    return 0;
  }
  const beforeShort = Math.max(toNumber(before.short_shares), 0);
  const afterShort = Math.max(toNumber(after.short_shares), 0);
  if (beforeShort <= 0) {
    return 0;
  }
  const relief = Math.max(beforeShort - afterShort, 0);
  return clamp(relief / beforeShort, 0, 1);
}

export async function scoreV4_1(
  cik: string,
  anchor: DumpEvent,
  inputs: Omit<ScoreInputs, 'eow'> & { eow: boolean }
): Promise<RotationEventRecord> {
  const supabase = getSupabaseClient();
  const result = computeRotationScore(inputs);
  const event: RotationEventRecord = {
    cluster_id: anchor.clusterId,
    issuer_cik: cik,
    anchor_filing: null,
    dumpz: inputs.dumpZ,
    u_same: inputs.uSame,
    u_next: inputs.uNext,
    uhf_same: inputs.uhfSame,
    uhf_next: inputs.uhfNext,
    opt_same: inputs.optSame,
    opt_next: inputs.optNext,
    shortrelief_v2: inputs.shortReliefV2,
    index_penalty: inputs.indexPenalty,
    eow: inputs.eow,
    r_score: result.rScore,
    car_m5_p20: 0,
    t_to_plus20_days: 20,
    max_ret_w13: 0,
  };
  await supabase.from('rotation_events').upsert(event, {
    onConflict: 'cluster_id',
  });
  return event;
}

function addDays(date: string, offset: number) {
  const base = parseDate(date);
  const shifted = new Date(base.getTime() + offset * 24 * 60 * 60 * 1000);
  return formatDate(shifted);
}

function cumulative(values: { date: string; value: number }[], startIndex: number, endIndex: number) {
  let total = 0;
  for (let i = startIndex; i <= endIndex; i++) {
    total += values[i]!.value;
  }
  return total;
}

export async function eventStudy(anchorDate: string, cik: string, ticker?: string) {
  const supabase = getSupabaseClient();
  const windowStart = formatDate(
    new Date(parseDate(anchorDate).getTime() - 10 * 24 * 60 * 60 * 1000)
  );
  const windowEnd = formatDate(
    new Date(parseDate(anchorDate).getTime() + 120 * 24 * 60 * 60 * 1000)
  );
  const { data, error } = await supabase
    .from('daily_returns')
    .select('trade_date,return,benchmark_return,cik')
    .eq('cik', cik)
    .gte('trade_date', windowStart)
    .lte('trade_date', windowEnd);
  if (error) throw error;
  const rows = (data ?? []).filter((row: any) => row.cik).sort((a: any, b: any) => a.trade_date.localeCompare(b.trade_date));
  const abnormal = rows.map((row: any) => ({
    date: row.trade_date,
    value: toNumber(row.return) - toNumber(row.benchmark_return),
  }));
  const anchorIndex = abnormal.findIndex((row) => row.date >= anchorDate);
  if (anchorIndex === -1) {
    return { anchorDate, car: 0, ttPlus20: 0, maxRet: 0 };
  }
  const startIndex = Math.max(0, anchorIndex - 5);
  const endIndex = Math.min(abnormal.length - 1, anchorIndex + 20);
  const car = cumulative(abnormal, startIndex, endIndex);
  let ttPlus20 = 0;
  if (anchorIndex + 20 < abnormal.length) {
    const plus20Date = abnormal[anchorIndex + 20].date;
    ttPlus20 = Math.max(
      0,
      Math.round(
        (parseDate(plus20Date).getTime() - parseDate(anchorDate).getTime()) /
          (24 * 60 * 60 * 1000)
      )
    );
  }
  let running = 0;
  let maxRet = 0;
  let maxDrawdown = 0;
  const maxIndex = Math.min(abnormal.length, anchorIndex + 65);
  for (let i = anchorIndex; i < maxIndex; i++) {
    running += abnormal[i].value;
    if (running > maxRet) {
      maxRet = running;
    }
    if (running < maxDrawdown) {
      maxDrawdown = running;
    }
  }

  const horizons = [5, 10, 20, 40, 65];
  const horizonTotals = horizons.map((offset) => {
    const end = Math.min(abnormal.length - 1, anchorIndex + offset);
    return end >= anchorIndex ? cumulative(abnormal, anchorIndex, end) : 0;
  });

  let offexCovariates: Record<string, number | null> = {};
  let shortInterestChange: number | null = null;
  let iexShare: number | null = null;

  if (ticker) {
    const symbol = ticker.toUpperCase();
    const ratioQuery = await supabase
      .from('micro_offex_ratio')
      .select('as_of,offex_pct,offex_shares,on_ex_shares,quality_flag')
      .eq('symbol', symbol)
      .eq('granularity', 'daily')
      .gte('as_of', addDays(anchorDate, -1))
      .lte('as_of', addDays(anchorDate, 20))
      .order('as_of', { ascending: true });
    if (ratioQuery.error) throw ratioQuery.error;
    offexCovariates = {};
    for (const row of ratioQuery.data ?? []) {
      const diff = Math.round(
        (parseDate(row.as_of as string).getTime() - parseDate(anchorDate).getTime()) /
          (24 * 60 * 60 * 1000)
      );
      const key = diff >= 0 ? `d+${diff}` : `d${diff}`;
      offexCovariates[key] = row.offex_pct as number | null;
      if (row.as_of === anchorDate && row.offex_shares !== null && row.on_ex_shares !== null) {
        const total = toNumber(row.offex_shares) + toNumber(row.on_ex_shares);
        if (total > 0) {
          iexShare = toNumber(row.on_ex_shares) / total;
        }
      }
    }
    const shortQuery = await supabase
      .from('micro_short_interest_points')
      .select('settlement_date,short_interest')
      .eq('symbol', symbol)
      .lte('settlement_date', addDays(anchorDate, 90))
      .order('settlement_date', { ascending: true });
    if (shortQuery.error) throw shortQuery.error;
    const shortRows = shortQuery.data ?? [];
    let before: any = null;
    let after: any = null;
    for (const row of shortRows) {
      if (row.settlement_date < anchorDate) {
        before = row;
      }
      if (!after && row.settlement_date >= anchorDate) {
        after = row;
      }
    }
    if (before && after) {
      shortInterestChange = toNumber(after.short_interest) - toNumber(before.short_interest);
    }
  }

  if (ticker) {
    const upsertResult = await supabase
      .from('micro_event_study_results')
      .upsert(
        [
          {
            symbol: ticker.toUpperCase(),
            event_type: 'Rotation',
            anchor_date: anchorDate,
            cik: cik ?? '',
            car_m5_p20: car,
            tt_plus20_days: ttPlus20,
            max_ret_w13: maxRet,
            plus_1w: horizonTotals[0] ?? 0,
            plus_2w: horizonTotals[1] ?? 0,
            plus_4w: horizonTotals[2] ?? 0,
            plus_8w: horizonTotals[3] ?? 0,
            plus_13w: horizonTotals[4] ?? 0,
            offex_covariates: offexCovariates,
            short_interest_covariate: shortInterestChange,
            iex_share: iexShare,
          },
        ],
        { onConflict: 'symbol,event_type,anchor_date,cik' }
      );
    if (upsertResult.error) {
      throw upsertResult.error;
    }
  }

  return {
    anchorDate,
    car,
    ttPlus20,
    maxRet,
    maxDrawdown,
    plus1w: horizonTotals[0] ?? 0,
    plus2w: horizonTotals[1] ?? 0,
    plus4w: horizonTotals[2] ?? 0,
    plus8w: horizonTotals[3] ?? 0,
    plus13w: horizonTotals[4] ?? 0,
    offexCovariates,
    shortInterestChange,
    iexShare,
  };
}
