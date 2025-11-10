import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UnusualWhalesClient } from '../lib/unusualWhalesClient.ts';

// ============================================================================
// GENERIC API HELPERS
// ============================================================================

/**
 * Generic API fetch + parse + empty check pattern
 * Used by all endpoint groups to reduce duplication
 */
export async function fetchAndParse<T extends z.ZodTypeAny>(
  client: UnusualWhalesClient,
  endpoint: string,
  params: Record<string, string> | undefined,
  schema: T,
  context: string
): Promise<z.infer<T>> {
  try {
    const response = await client.get<any>(endpoint, params);
    return schema.parse(response);
  } catch (error) {
    console.error(`Error ${context}:`, error);
    throw error;
  }
}

/**
 * Build query parameters object from optional values
 */
export function buildQueryParams(params: Record<string, any>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      result[key] = typeof value === 'string' ? value : value.toString();
    }
  }

  return result;
}

// ============================================================================
// DATABASE HELPERS
// ============================================================================

/**
 * Generic upsert with error handling
 */
export async function upsertRecords<T extends Record<string, any>>(
  supabase: SupabaseClient,
  table: string,
  records: T[],
  onConflict: string
): Promise<void> {
  if (records.length === 0) return;

  const { error } = await supabase
    .from(table)
    .upsert(records, {
      onConflict,
      ignoreDuplicates: false,
    });

  if (error) {
    throw error;
  }
}

/**
 * Generic insert with error handling
 */
export async function insertRecords<T extends Record<string, any>>(
  supabase: SupabaseClient,
  table: string,
  records: T[]
): Promise<void> {
  if (records.length === 0) return;

  const { error } = await supabase
    .from(table)
    .insert(records);

  if (error) {
    throw error;
  }
}

// ============================================================================
// NUMERIC & PARSING HELPERS
// ============================================================================

export function parseNumeric(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return isNaN(num) ? null : num;
}

export function calculateVolumeOIRatio(volume: number | undefined, oi: number | undefined): number | null {
  if (!volume || !oi || oi === 0) return null;
  return volume / oi;
}

export function calculateIVSkew(putIV: string | undefined, callIV: string | undefined): number | null {
  const putVal = parseNumeric(putIV);
  const callVal = parseNumeric(callIV);
  if (!putVal || !callVal) return null;
  return putVal - callVal;
}

// Parse option symbol using regex from API docs
const OPTION_SYMBOL_REGEX = /^(?<symbol>[\w]*)(?<expiry>(\d{2})(\d{2})(\d{2}))(?<type>[PC])(?<strike>\d{8})$/;

export function parseOptionSymbol(symbol: string): {
  underlying: string;
  expiry: string;
  type: 'call' | 'put';
  strike: number;
} | null {
  const match = symbol.match(OPTION_SYMBOL_REGEX);
  if (!match || !match.groups) return null;

  const { symbol: underlying, expiry, type } = match.groups;
  const strikeStr = match.groups.strike;

  // Parse expiry YYMMDD -> YYYY-MM-DD
  const yy = expiry.substring(0, 2);
  const mm = expiry.substring(2, 4);
  const dd = expiry.substring(4, 6);
  const year = parseInt(yy) < 50 ? `20${yy}` : `19${yy}`;
  const expiryDate = `${year}-${mm}-${dd}`;

  // Strike is 8 digits, divide by 1000
  const strike = parseInt(strikeStr) / 1000;

  return {
    underlying,
    expiry: expiryDate,
    type: type === 'C' ? 'call' : 'put',
    strike,
  };
}

export function extractUniqueExpirations(symbols: string[]): string[] {
  const expirations = new Set<string>();
  for (const symbol of symbols) {
    const parsed = parseOptionSymbol(symbol);
    if (parsed) {
      expirations.add(parsed.expiry);
    }
  }
  return Array.from(expirations).sort();
}

// ============================================================================
// GROUP 2: CONTRACT-LEVEL DATA TRANSFORMERS
// ============================================================================

/**
 * Transform Greeks response into call AND put records
 * Group 2 specific pattern - greeks endpoint returns both call/put in single row
 */
export function transformGreeksToRecords(
  greeks: Array<{
    strike: string;
    date: string;
    expiry: string;
    call_delta?: string;
    call_gamma?: string;
    call_theta?: string;
    call_vega?: string;
    call_rho?: string;
    call_volatility?: string;
    put_delta?: string;
    put_gamma?: string;
    put_theta?: string;
    put_vega?: string;
    put_rho?: string;
    put_volatility?: string;
  }>,
  ticker: string
): Array<{
  ticker: string;
  trade_date: string;
  expiration_date: string;
  strike: number;
  option_type: 'call' | 'put';
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  implied_volatility: number | null;
  data_source: string;
}> {
  const callRecords = greeks.map(g => ({
    ticker,
    trade_date: g.date,
    expiration_date: g.expiry,
    strike: parseNumeric(g.strike)!,
    option_type: 'call' as const,
    delta: parseNumeric(g.call_delta),
    gamma: parseNumeric(g.call_gamma),
    theta: parseNumeric(g.call_theta),
    vega: parseNumeric(g.call_vega),
    rho: parseNumeric(g.call_rho),
    implied_volatility: parseNumeric(g.call_volatility),
    data_source: 'UNUSUALWHALES',
  }));

  const putRecords = greeks.map(g => ({
    ticker,
    trade_date: g.date,
    expiration_date: g.expiry,
    strike: parseNumeric(g.strike)!,
    option_type: 'put' as const,
    delta: parseNumeric(g.put_delta),
    gamma: parseNumeric(g.put_gamma),
    theta: parseNumeric(g.put_theta),
    vega: parseNumeric(g.put_vega),
    rho: parseNumeric(g.put_rho),
    implied_volatility: parseNumeric(g.put_volatility),
    data_source: 'UNUSUALWHALES',
  }));

  return [...callRecords, ...putRecords];
}

/**
 * Transform option contracts response
 * Group 2 - primary endpoint for volume + OI
 */
export function transformContractsToRecords(
  contracts: Array<{
    option_symbol: string;
    volume: number;
    open_interest: number;
    implied_volatility: string;
    total_premium: string;
    avg_price: string;
    last_price: string;
    nbbo_ask?: string;
    nbbo_bid?: string;
    ask_volume: number;
    bid_volume: number;
    floor_volume?: number;
    sweep_volume?: number;
  }>,
  ticker: string,
  tradeDate: string
): {
  records: Array<any>;
  totalVolume: number;
  totalOI: number;
} {
  let totalVolume = 0;
  let totalOI = 0;

  const records = contracts
    .map(contract => {
      const parsed = parseOptionSymbol(contract.option_symbol);
      if (!parsed) return null;

      const volume = contract.volume || 0;
      const oi = contract.open_interest || 0;
      totalVolume += volume;
      totalOI += oi;

      const volumeOIRatio = calculateVolumeOIRatio(volume, oi);

      return {
        ticker,
        trade_date: tradeDate,
        expiration_date: parsed.expiry,
        strike: parsed.strike,
        option_type: parsed.type,
        volume,
        open_interest: oi,
        volume_oi_ratio: volumeOIRatio,
        bid: parseNumeric(contract.nbbo_bid),
        ask: parseNumeric(contract.nbbo_ask),
        last_price: parseNumeric(contract.last_price),
        mark: parseNumeric(contract.avg_price),
        ask_volume: contract.ask_volume,
        bid_volume: contract.bid_volume,
        floor_volume: contract.floor_volume,
        sweep_volume: contract.sweep_volume,
        implied_volatility: parseNumeric(contract.implied_volatility),
        data_source: 'UNUSUALWHALES',
      };
    })
    .filter(Boolean);

  return { records, totalVolume, totalOI };
}

// ============================================================================
// GROUP 3: AGGREGATED FLOW TRANSFORMERS
// ============================================================================

/**
 * Transform flow-per-expiry response
 * Group 3 - aggregated flow data
 */
export function transformFlowByExpiryToRecords(
  flows: Array<{
    ticker: string;
    date: string;
    expiry: string;
    call_volume: number;
    call_trades: number;
    call_premium: string;
    call_volume_ask_side: number;
    call_volume_bid_side: number;
    call_otm_volume: number;
    call_otm_premium: string;
    put_volume: number;
    put_trades: number;
    put_premium: string;
    put_volume_ask_side: number;
    put_volume_bid_side: number;
    put_otm_volume: number;
    put_otm_premium: string;
  }>
): {
  records: Array<any>;
  totalVolume: number;
} {
  let totalVolume = 0;

  const records = flows.map(flow => {
    const callVol = flow.call_volume || 0;
    const putVol = flow.put_volume || 0;
    totalVolume += callVol + putVol;

    return {
      ticker: flow.ticker,
      trade_date: flow.date,
      expiration_date: flow.expiry,
      call_volume: callVol,
      call_trades: flow.call_trades,
      call_premium: parseNumeric(flow.call_premium),
      call_volume_ask_side: flow.call_volume_ask_side,
      call_volume_bid_side: flow.call_volume_bid_side,
      call_otm_volume: flow.call_otm_volume,
      call_otm_premium: parseNumeric(flow.call_otm_premium),
      put_volume: putVol,
      put_trades: flow.put_trades,
      put_premium: parseNumeric(flow.put_premium),
      put_volume_ask_side: flow.put_volume_ask_side,
      put_volume_bid_side: flow.put_volume_bid_side,
      put_otm_volume: flow.put_otm_volume,
      put_otm_premium: parseNumeric(flow.put_otm_premium),
      data_source: 'UNUSUALWHALES',
    };
  });

  return { records, totalVolume };
}

// ============================================================================
// GROUP 4: UNUSUAL ACTIVITY TRANSFORMERS
// ============================================================================

/**
 * Transform flow alerts response
 * Group 4 - unusual activity detection
 */
export function transformFlowAlertsToRecords(
  alerts: Array<{
    ticker: string;
    option_chain: string;
    strike: string;
    expiry: string;
    type: 'call' | 'put';
    alert_rule: string;
    created_at: string;
    underlying_price: string;
    price: string;
    total_size: number;
    total_premium: string;
    total_ask_side_prem: string;
    total_bid_side_prem: string;
    trade_count: number;
    volume: number;
    open_interest: number;
    volume_oi_ratio: string;
    has_sweep: boolean;
    has_floor: boolean;
    has_multileg: boolean;
    has_singleleg: boolean;
    all_opening_trades: boolean;
    expiry_count: number;
  }>
): Array<any> {
  return alerts.map(alert => {
    const daysToExpiry = Math.floor(
      (new Date(alert.expiry).getTime() - new Date(alert.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );

    // Map alert_rule to activity_type
    let activityType = 'UNKNOWN';
    if (alert.alert_rule.includes('Floor')) activityType = 'FLOOR_TRADE';
    else if (alert.alert_rule.includes('RepeatedHits')) {
      activityType = alert.type === 'call' ? 'LARGE_CALL_BUYING' : 'LARGE_PUT_BUYING';
    } else if (alert.alert_rule.includes('Sweep')) activityType = 'SWEEP_CLUSTER';

    const sentiment = alert.type === 'call' ? 'bullish' : 'bearish';

    return {
      ticker: alert.ticker,
      trade_date: alert.created_at.substring(0, 10),
      detected_at: alert.created_at,
      activity_type: activityType,
      contract_count: alert.total_size,
      total_premium: parseNumeric(alert.total_premium),
      avg_implied_volatility: null,
      sentiment,
      underlying_price: parseNumeric(alert.underlying_price),
      expiration_date: alert.expiry,
      strikes_involved: [alert.strike],
      days_to_expiration: daysToExpiry,
      signal_strength: parseNumeric(alert.volume_oi_ratio),
      description: `${alert.alert_rule}: ${alert.total_size} contracts, $${alert.total_premium} premium`,
      source: 'UNUSUALWHALES',
      has_sweep: alert.has_sweep,
      has_floor: alert.has_floor,
      trade_count: alert.trade_count,
    };
  });
}
