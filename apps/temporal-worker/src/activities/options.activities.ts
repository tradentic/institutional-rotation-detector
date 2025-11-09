import { z } from 'zod';
import { createSupabaseClient } from '../lib/supabase.js';
import { createUnusualWhalesClient } from '../lib/unusualWhalesClient.js';
import {
  // Generic helpers
  fetchAndParse,
  buildQueryParams,
  upsertRecords,
  insertRecords,
  // Parsing helpers
  parseNumeric,
  parseOptionSymbol,
  extractUniqueExpirations,
  // Group 2: Contract-level transformers
  transformGreeksToRecords,
  transformContractsToRecords,
  // Group 3: Aggregated flow transformers
  transformFlowByExpiryToRecords,
  // Group 4: Unusual activity transformers
  transformFlowAlertsToRecords,
} from './options.helpers.js';

// ============================================================================
// Response Schemas (Based on Actual UW API)
// ============================================================================

// Flow per expiry response
const flowPerExpirySchema = z.object({
  data: z.array(z.object({
    ticker: z.string(),
    date: z.string(), // YYYY-MM-DD
    expiry: z.string(), // YYYY-MM-DD
    call_volume: z.number(),
    call_trades: z.number(),
    call_premium: z.string(), // String decimal
    call_volume_ask_side: z.number(),
    call_volume_bid_side: z.number(),
    call_otm_volume: z.number(),
    call_otm_premium: z.string(),
    call_otm_trades: z.number(),
    call_premium_ask_side: z.string(),
    call_premium_bid_side: z.string(),
    put_volume: z.number(),
    put_trades: z.number(),
    put_premium: z.string(),
    put_volume_ask_side: z.number(),
    put_volume_bid_side: z.number(),
    put_otm_volume: z.number(),
    put_otm_premium: z.string(),
    put_otm_trades: z.number(),
    put_premium_ask_side: z.string(),
    put_premium_bid_side: z.string(),
  })),
  date: z.string().optional(),
});

// Flow per strike response
const flowPerStrikeSchema = z.array(z.object({
  strike: z.string(), // String decimal
  date: z.string(),
  call_premium: z.string().optional(),
  call_premium_ask_side: z.string().optional(),
  call_premium_bid_side: z.string().optional(),
  call_trades: z.number().optional(),
  call_volume: z.number().optional(),
  put_premium: z.string().optional(),
  put_premium_ask_side: z.string().optional(),
  put_premium_bid_side: z.string().optional(),
  put_trades: z.number().optional(),
  put_volume: z.number().optional(),
}));

// Greeks response
const greeksSchema = z.object({
  data: z.array(z.object({
    strike: z.string(),
    date: z.string(),
    expiry: z.string(),
    call_delta: z.string().optional(),
    call_gamma: z.string().optional(),
    call_theta: z.string().optional(),
    call_vega: z.string().optional(),
    call_rho: z.string().optional(),
    call_charm: z.string().optional(),
    call_vanna: z.string().optional(),
    call_volatility: z.string().optional(), // IV
    call_option_symbol: z.string().optional(),
    put_delta: z.string().optional(),
    put_gamma: z.string().optional(),
    put_theta: z.string().optional(),
    put_vega: z.string().optional(),
    put_rho: z.string().optional(),
    put_charm: z.string().optional(),
    put_vanna: z.string().optional(),
    put_volatility: z.string().optional(), // IV
    put_option_symbol: z.string().optional(),
  })),
});

// Greek exposure response
const greekExposureSchema = z.object({
  data: z.array(z.object({
    date: z.string(),
    call_delta: z.string(),
    call_gamma: z.string(),
    call_vanna: z.string(),
    call_charm: z.string(),
    put_delta: z.string(),
    put_gamma: z.string(),
    put_vanna: z.string(),
    put_charm: z.string(),
  })),
});

// Flow alerts response
const flowAlertsSchema = z.object({
  data: z.array(z.object({
    ticker: z.string(),
    option_chain: z.string(),
    strike: z.string(),
    expiry: z.string(),
    type: z.enum(['call', 'put']),
    alert_rule: z.string(),
    created_at: z.string(),
    underlying_price: z.string(),
    price: z.string(),
    total_size: z.number(),
    total_premium: z.string(),
    total_ask_side_prem: z.string(),
    total_bid_side_prem: z.string(),
    trade_count: z.number(),
    volume: z.number(),
    open_interest: z.number(),
    volume_oi_ratio: z.string(),
    has_sweep: z.boolean(),
    has_floor: z.boolean(),
    has_multileg: z.boolean(),
    has_singleleg: z.boolean(),
    all_opening_trades: z.boolean(),
    expiry_count: z.number(),
  })),
});

// Option chains response
const optionChainsSchema = z.object({
  data: z.array(z.string()), // Array of option symbols
});

// Option contracts response (full contract data with volume AND OI)
const optionContractsSchema = z.object({
  data: z.array(z.object({
    option_symbol: z.string(),
    volume: z.number(),
    open_interest: z.number(),
    prev_oi: z.number().optional(),
    implied_volatility: z.string(),
    total_premium: z.string(),
    avg_price: z.string(),
    last_price: z.string(),
    high_price: z.string(),
    low_price: z.string(),
    ask_volume: z.number(),
    bid_volume: z.number(),
    mid_volume: z.number().optional(),
    floor_volume: z.number().optional(),
    sweep_volume: z.number().optional(),
    multi_leg_volume: z.number().optional(),
    nbbo_ask: z.string().optional(),
    nbbo_bid: z.string().optional(),
  })),
});

// ============================================================================
// Activities (Refactored using endpoint group patterns)
// ============================================================================

/**
 * GROUP 3: Aggregated Flow - Fetch daily options flow aggregated by expiration
 */
export async function fetchOptionsFlowByExpiry(params: {
  ticker: string;
}): Promise<{ ticker: string; expirations: number; totalVolume: number }> {
  const client = createUnusualWhalesClient();
  const { ticker } = params;

  // Use fetchAndParse helper to reduce duplication
  const parsed = await fetchAndParse(
    client,
    `/api/stock/${ticker}/flow-per-expiry`,
    undefined,
    flowPerExpirySchema,
    `fetching flow by expiry for ${ticker}`
  );

  const flows = parsed.data || [];

  if (flows.length === 0) {
    return { ticker, expirations: 0, totalVolume: 0 };
  }

  // Use Group 3 transformer
  const { records, totalVolume } = transformFlowByExpiryToRecords(flows);

  // Store in a staging table or custom table (not options_chain_daily)
  // For now, we'll just aggregate into options_summary_daily directly

  return { ticker, expirations: records.length, totalVolume };
}

/**
 * GROUP 3: Aggregated Flow - Fetch daily options flow aggregated by strike
 */
export async function fetchOptionsFlowByStrike(params: {
  ticker: string;
  date: string;
}): Promise<{ ticker: string; date: string; strikes: number }> {
  const client = createUnusualWhalesClient();
  const { ticker, date } = params;

  const parsed = await fetchAndParse(
    client,
    `/api/stock/${ticker}/flow-per-strike`,
    { date },
    flowPerStrikeSchema,
    `fetching flow by strike for ${ticker} on ${date}`
  );

  if (parsed.length === 0) {
    return { ticker, date, strikes: 0 };
  }

  // This data is aggregated by strike, useful for identifying strike concentrations
  // We can store this in options_flow table with aggregated=true flag
  // Or create a separate flow_by_strike table

  return { ticker, date, strikes: parsed.length };
}

/**
 * GROUP 2: Contract-Level Data - Fetch Greeks for a specific expiration
 * NOTE: Must be called per expiration!
 */
export async function fetchGreeksForExpiration(params: {
  ticker: string;
  expiry: string;
  date: string;
}): Promise<{ ticker: string; expiry: string; date: string; contracts: number }> {
  const supabase = createSupabaseClient();
  const client = createUnusualWhalesClient();
  const { ticker, expiry, date } = params;

  const parsed = await fetchAndParse(
    client,
    `/api/stock/${ticker}/greeks`,
    { expiry, date },
    greeksSchema,
    `fetching greeks for ${ticker} expiry ${expiry}`
  );

  const greeks = parsed.data || [];

  if (greeks.length === 0) {
    return { ticker, expiry, date, contracts: 0 };
  }

  // Use Group 2 transformer - automatically creates both call AND put records
  const allRecords = transformGreeksToRecords(greeks, ticker);

  // Use upsertRecords helper
  await upsertRecords(
    supabase,
    'options_chain_daily',
    allRecords,
    'ticker,trade_date,expiration_date,strike,option_type'
  );

  return { ticker, expiry, date, contracts: greeks.length };
}

/**
 * GROUP 1: Contract Discovery - Fetch all option chains (symbols) for a ticker on a date
 * Then extract unique expirations for greeks queries
 */
export async function fetchOptionChains(params: {
  ticker: string;
  date: string;
}): Promise<{ ticker: string; date: string; symbols: number; expirations: string[] }> {
  const client = createUnusualWhalesClient();
  const { ticker, date } = params;

  const parsed = await fetchAndParse(
    client,
    `/api/stock/${ticker}/option-chains`,
    { date },
    optionChainsSchema,
    `fetching option chains for ${ticker} on ${date}`
  );

  const symbols = parsed.data || [];

  // Extract unique expirations using helper
  const expirations = extractUniqueExpirations(symbols);

  return { ticker, date, symbols: symbols.length, expirations };
}

/**
 * GROUP 2: Contract-Level Data - Fetch option contracts with VOLUME and OPEN INTEREST
 * ⭐ This is the KEY endpoint for getting OI data!
 */
export async function fetchOptionContracts(params: {
  ticker: string;
  expiry?: string;
  optionType?: 'call' | 'put';
  excludeZeroVol?: boolean;
  excludeZeroOI?: boolean;
  limit?: number;
}): Promise<{ ticker: string; contracts: number; totalVolume: number; totalOI: number }> {
  const supabase = createSupabaseClient();
  const client = createUnusualWhalesClient();

  const { ticker, expiry, optionType, excludeZeroVol = true, excludeZeroOI = true, limit = 500 } = params;

  // Use buildQueryParams helper to reduce duplication
  const queryParams = buildQueryParams({
    limit,
    expiry,
    option_type: optionType,
    exclude_zero_vol_chains: excludeZeroVol,
    exclude_zero_oi_chains: excludeZeroOI,
  });

  const parsed = await fetchAndParse(
    client,
    `/api/stock/${ticker}/option-contracts`,
    queryParams,
    optionContractsSchema,
    `fetching option contracts for ${ticker}`
  );

  const contracts = parsed.data || [];

  if (contracts.length === 0) {
    return { ticker, contracts: 0, totalVolume: 0, totalOI: 0 };
  }

  // Use Group 2 transformer - handles all parsing and aggregation
  const tradeDate = new Date().toISOString().substring(0, 10);
  const { records, totalVolume, totalOI } = transformContractsToRecords(contracts, ticker, tradeDate);

  // Use upsertRecords helper
  await upsertRecords(
    supabase,
    'options_chain_daily',
    records,
    'ticker,trade_date,expiration_date,strike,option_type'
  );

  return { ticker, contracts: records.length, totalVolume, totalOI };
}

/**
 * GROUP 5: Greek Exposure - Fetch Greek Exposure (GEX) historical data
 */
export async function fetchGreekExposure(params: {
  ticker: string;
  date?: string;
  timeframe?: '1d' | '5d' | '1m' | '3m' | '6m' | '1y' | '5y';
}): Promise<{ ticker: string; days: number }> {
  const client = createUnusualWhalesClient();
  const { ticker, date, timeframe = '1m' } = params;

  const queryParams = buildQueryParams({ timeframe, date });

  const parsed = await fetchAndParse(
    client,
    `/api/stock/${ticker}/greek-exposure`,
    queryParams,
    greekExposureSchema,
    `fetching greek exposure for ${ticker}`
  );

  const exposure = parsed.data || [];

  if (exposure.length === 0) {
    return { ticker, days: 0 };
  }

  // Store greek exposure in a dedicated table
  // For now, we can use this for computing summary metrics

  return { ticker, days: exposure.length };
}

/**
 * GROUP 4: Unusual Activity - Fetch unusual options activity (flow alerts)
 */
export async function fetchFlowAlerts(params: {
  ticker?: string;
  minPremium?: number;
  alertRule?: string;
  limit?: number;
}): Promise<{ activities: number }> {
  const supabase = createSupabaseClient();
  const client = createUnusualWhalesClient();

  const { ticker, minPremium, alertRule, limit = 100 } = params;

  // Use buildQueryParams helper
  const queryParams = buildQueryParams({
    limit,
    ticker_symbol: ticker,
    min_premium: minPremium,
    alert_rule: alertRule,
  });

  const parsed = await fetchAndParse(
    client,
    '/api/option-trades/flow-alerts',
    queryParams,
    flowAlertsSchema,
    'fetching flow alerts'
  );

  const alerts = parsed.data || [];

  if (alerts.length === 0) {
    return { activities: 0 };
  }

  // Use Group 4 transformer
  const records = transformFlowAlertsToRecords(alerts);

  // Use insertRecords helper
  await insertRecords(supabase, 'unusual_options_activity', records);

  return { activities: records.length };
}

/**
 * Compute daily options summary from flow data
 */
export async function computeOptionsSummary(params: {
  ticker: string;
  date: string;
}): Promise<{ ticker: string; date: string; processed: boolean }> {
  const supabase = createSupabaseClient();
  const { ticker, date } = params;

  // Fetch flow-per-expiry data
  const flowResult = await fetchOptionsFlowByExpiry({ ticker });

  // Fetch greeks for ATM strikes to get IV
  // This requires fetching option chains first to get expirations
  const chainsResult = await fetchOptionChains({ ticker, date });

  if (chainsResult.expirations.length === 0) {
    return { ticker, date, processed: false };
  }

  // For simplicity, use the nearest expiration for ATM IV
  const nearestExpiry = chainsResult.expirations[0];
  const greeksResult = await fetchGreeksForExpiration({ ticker, expiry: nearestExpiry, date });

  // Now compute summary from stored data
  // This is a placeholder - actual implementation would aggregate from DB

  const summary = {
    ticker,
    trade_date: date,
    total_call_volume: 0,
    total_put_volume: 0,
    // ... other fields
    computed_at: new Date().toISOString(),
  };

  // Use upsertRecords helper
  await upsertRecords(supabase, 'options_summary_daily', [summary], 'ticker,trade_date');

  return { ticker, date, processed: true };
}

/**
 * Compute historical baselines for options activity
 */
export async function computeOptionsBaselines(params: {
  ticker: string;
  asOfDate: string;
  windowDays?: number;
}): Promise<{ ticker: string; asOfDate: string; processed: boolean }> {
  const supabase = createSupabaseClient();
  const { ticker, asOfDate, windowDays = 30 } = params;

  // Calculate date range
  const endDate = new Date(asOfDate);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - windowDays);

  const startDateStr = startDate.toISOString().substring(0, 10);
  const endDateStr = endDate.toISOString().substring(0, 10);

  // Fetch summary data for the window
  const { data: summaries, error } = await supabase
    .from('options_summary_daily')
    .select('*')
    .eq('ticker', ticker)
    .gte('trade_date', startDateStr)
    .lte('trade_date', endDateStr)
    .order('trade_date', { ascending: true });

  if (error) {
    throw error;
  }

  if (!summaries || summaries.length === 0) {
    return { ticker, asOfDate, processed: false };
  }

  // Calculate averages
  const callVolumes = summaries.map(s => s.total_call_volume || 0);
  const putVolumes = summaries.map(s => s.total_put_volume || 0);

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const baseline = {
    ticker,
    as_of_date: asOfDate,
    avg_daily_call_volume_30d: Math.round(avg(callVolumes)),
    avg_daily_put_volume_30d: Math.round(avg(putVolumes)),
    // ... other fields
  };

  // Use upsertRecords helper
  await upsertRecords(supabase, 'options_historical_baselines', [baseline], 'ticker,as_of_date');

  return { ticker, asOfDate, processed: true };
}
