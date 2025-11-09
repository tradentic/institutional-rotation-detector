import { z } from 'zod';
import { createSupabaseClient } from '../lib/supabase.js';
import { createUnusualWhalesClient } from '../lib/unusualWhalesClient.js';

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
// Helper Functions
// ============================================================================

function parseNumeric(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return isNaN(num) ? null : num;
}

function calculateVolumeOIRatio(volume: number | undefined, oi: number | undefined): number | null {
  if (!volume || !oi || oi === 0) return null;
  return volume / oi;
}

function calculateIVSkew(putIV: string | undefined, callIV: string | undefined): number | null {
  const putVal = parseNumeric(putIV);
  const callVal = parseNumeric(callIV);
  if (!putVal || !callVal) return null;
  return putVal - callVal;
}

// Parse option symbol using regex from API docs
const OPTION_SYMBOL_REGEX = /^(?<symbol>[\w]*)(?<expiry>(\d{2})(\d{2})(\d{2}))(?<type>[PC])(?<strike>\d{8})$/;

function parseOptionSymbol(symbol: string): {
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

function extractUniqueExpirations(symbols: string[]): string[] {
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
// Activities
// ============================================================================

/**
 * Fetch daily options flow aggregated by expiration
 */
export async function fetchOptionsFlowByExpiry(params: {
  ticker: string;
}): Promise<{ ticker: string; expirations: number; totalVolume: number }> {
  const supabase = createSupabaseClient();
  const client = createUnusualWhalesClient();

  const { ticker } = params;

  try {
    // UW API: /api/stock/{ticker}/flow-per-expiry
    // Returns last trading day by default
    const response = await client.get<any>(`/api/stock/${ticker}/flow-per-expiry`);

    const parsed = flowPerExpirySchema.parse(response);
    const flows = parsed.data || [];

    if (flows.length === 0) {
      return { ticker, expirations: 0, totalVolume: 0 };
    }

    let totalVolume = 0;

    // Transform and insert
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

    // Store in a staging table or custom table (not options_chain_daily)
    // For now, we'll just aggregate into options_summary_daily directly

    return { ticker, expirations: records.length, totalVolume };

  } catch (error) {
    console.error(`Error fetching flow by expiry for ${ticker}:`, error);
    throw error;
  }
}

/**
 * Fetch daily options flow aggregated by strike
 */
export async function fetchOptionsFlowByStrike(params: {
  ticker: string;
  date: string;
}): Promise<{ ticker: string; date: string; strikes: number }> {
  const supabase = createSupabaseClient();
  const client = createUnusualWhalesClient();

  const { ticker, date } = params;

  try {
    // UW API: /api/stock/{ticker}/flow-per-strike?date=YYYY-MM-DD
    const response = await client.get<any>(`/api/stock/${ticker}/flow-per-strike`, { date });

    const parsed = flowPerStrikeSchema.parse(response);

    if (parsed.length === 0) {
      return { ticker, date, strikes: 0 };
    }

    // This data is aggregated by strike, useful for identifying strike concentrations
    // We can store this in options_flow table with aggregated=true flag
    // Or create a separate flow_by_strike table

    return { ticker, date, strikes: parsed.length };

  } catch (error) {
    console.error(`Error fetching flow by strike for ${ticker} on ${date}:`, error);
    throw error;
  }
}

/**
 * Fetch Greeks for a specific expiration
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

  try {
    // UW API: /api/stock/{ticker}/greeks?expiry=YYYY-MM-DD&date=YYYY-MM-DD
    const response = await client.get<any>(`/api/stock/${ticker}/greeks`, { expiry, date });

    const parsed = greeksSchema.parse(response);
    const greeks = parsed.data || [];

    if (greeks.length === 0) {
      return { ticker, expiry, date, contracts: 0 };
    }

    // Transform and insert into options_chain_daily
    const records = greeks.map(g => {
      const strike = parseNumeric(g.strike);

      return {
        ticker,
        trade_date: date,
        expiration_date: expiry,
        strike: strike!,
        option_type: 'call', // We'll need to store both call and put separately
        // Call data
        delta: parseNumeric(g.call_delta),
        gamma: parseNumeric(g.call_gamma),
        theta: parseNumeric(g.call_theta),
        vega: parseNumeric(g.call_vega),
        rho: parseNumeric(g.call_rho),
        implied_volatility: parseNumeric(g.call_volatility),
        data_source: 'UNUSUALWHALES',
      };
    });

    // Also insert put data
    const putRecords = greeks.map(g => {
      const strike = parseNumeric(g.strike);

      return {
        ticker,
        trade_date: date,
        expiration_date: expiry,
        strike: strike!,
        option_type: 'put',
        delta: parseNumeric(g.put_delta),
        gamma: parseNumeric(g.put_gamma),
        theta: parseNumeric(g.put_theta),
        vega: parseNumeric(g.put_vega),
        rho: parseNumeric(g.put_rho),
        implied_volatility: parseNumeric(g.put_volatility),
        data_source: 'UNUSUALWHALES',
      };
    });

    const allRecords = [...records, ...putRecords];

    const { error } = await supabase
      .from('options_chain_daily')
      .upsert(allRecords, {
        onConflict: 'ticker,trade_date,expiration_date,strike,option_type',
        ignoreDuplicates: false,
      });

    if (error) {
      throw error;
    }

    return { ticker, expiry, date, contracts: greeks.length };

  } catch (error) {
    console.error(`Error fetching greeks for ${ticker} expiry ${expiry}:`, error);
    throw error;
  }
}

/**
 * Fetch all option chains (symbols) for a ticker on a date
 * Then extract unique expirations for greeks queries
 */
export async function fetchOptionChains(params: {
  ticker: string;
  date: string;
}): Promise<{ ticker: string; date: string; symbols: number; expirations: string[] }> {
  const client = createUnusualWhalesClient();

  const { ticker, date } = params;

  try {
    // UW API: /api/stock/{ticker}/option-chains?date=YYYY-MM-DD
    const response = await client.get<any>(`/api/stock/${ticker}/option-chains`, { date });

    const parsed = optionChainsSchema.parse(response);
    const symbols = parsed.data || [];

    // Extract unique expirations
    const expirations = extractUniqueExpirations(symbols);

    return { ticker, date, symbols: symbols.length, expirations };

  } catch (error) {
    console.error(`Error fetching option chains for ${ticker} on ${date}:`, error);
    throw error;
  }
}

/**
 * Fetch option contracts with VOLUME and OPEN INTEREST
 * This is the KEY endpoint for getting OI data!
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

  try {
    // UW API: /api/stock/{ticker}/option-contracts
    const queryParams: Record<string, string> = {
      limit: limit.toString(),
    };

    if (expiry) {
      queryParams.expiry = expiry;
    }
    if (optionType) {
      queryParams.option_type = optionType;
    }
    if (excludeZeroVol) {
      queryParams.exclude_zero_vol_chains = 'true';
    }
    if (excludeZeroOI) {
      queryParams.exclude_zero_oi_chains = 'true';
    }

    const response = await client.get<any>(`/api/stock/${ticker}/option-contracts`, queryParams);

    const parsed = optionContractsSchema.parse(response);
    const contracts = parsed.data || [];

    if (contracts.length === 0) {
      return { ticker, contracts: 0, totalVolume: 0, totalOI: 0 };
    }

    let totalVolume = 0;
    let totalOI = 0;

    // Transform and insert into options_chain_daily
    const records = contracts.map(contract => {
      const parsed = parseOptionSymbol(contract.option_symbol);
      if (!parsed) return null;

      const volume = contract.volume || 0;
      const oi = contract.open_interest || 0;
      totalVolume += volume;
      totalOI += oi;

      const volumeOIRatio = calculateVolumeOIRatio(volume, oi);

      return {
        ticker,
        trade_date: new Date().toISOString().substring(0, 10), // Current date
        expiration_date: parsed.expiry,
        strike: parsed.strike,
        option_type: parsed.type,
        // Volume data
        volume,
        open_interest: oi,
        volume_oi_ratio: volumeOIRatio,
        // Price data
        bid: parseNumeric(contract.nbbo_bid),
        ask: parseNumeric(contract.nbbo_ask),
        last_price: parseNumeric(contract.last_price),
        mark: parseNumeric(contract.avg_price),
        // Volume breakdown
        ask_volume: contract.ask_volume,
        bid_volume: contract.bid_volume,
        floor_volume: contract.floor_volume,
        sweep_volume: contract.sweep_volume,
        // Greeks/IV
        implied_volatility: parseNumeric(contract.implied_volatility),
        // Metadata
        data_source: 'UNUSUALWHALES',
      };
    }).filter(Boolean);

    // Insert into options_chain_daily
    if (records.length > 0) {
      const { error } = await supabase
        .from('options_chain_daily')
        .upsert(records, {
          onConflict: 'ticker,trade_date,expiration_date,strike,option_type',
          ignoreDuplicates: false,
        });

      if (error) {
        throw error;
      }
    }

    return { ticker, contracts: records.length, totalVolume, totalOI };

  } catch (error) {
    console.error(`Error fetching option contracts for ${ticker}:`, error);
    throw error;
  }
}

/**
 * Fetch Greek Exposure (GEX) historical data
 */
export async function fetchGreekExposure(params: {
  ticker: string;
  date?: string;
  timeframe?: '1d' | '5d' | '1m' | '3m' | '6m' | '1y' | '5y';
}): Promise<{ ticker: string; days: number }> {
  const supabase = createSupabaseClient();
  const client = createUnusualWhalesClient();

  const { ticker, date, timeframe = '1m' } = params;

  try {
    // UW API: /api/stock/{ticker}/greek-exposure?date=YYYY-MM-DD&timeframe=1m
    const queryParams: Record<string, string> = { timeframe };
    if (date) {
      queryParams.date = date;
    }

    const response = await client.get<any>(`/api/stock/${ticker}/greek-exposure`, queryParams);

    const parsed = greekExposureSchema.parse(response);
    const exposure = parsed.data || [];

    if (exposure.length === 0) {
      return { ticker, days: 0 };
    }

    // Store greek exposure in a dedicated table
    // For now, we can use this for computing summary metrics

    return { ticker, days: exposure.length };

  } catch (error) {
    console.error(`Error fetching greek exposure for ${ticker}:`, error);
    throw error;
  }
}

/**
 * Fetch unusual options activity (flow alerts)
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

  try {
    // UW API: /api/option-trades/flow-alerts
    const queryParams: Record<string, string> = {
      limit: limit.toString(),
    };

    if (ticker) {
      queryParams.ticker_symbol = ticker;
    }
    if (minPremium) {
      queryParams.min_premium = minPremium.toString();
    }
    if (alertRule) {
      queryParams.alert_rule = alertRule;
    }

    const response = await client.get<any>('/api/option-trades/flow-alerts', queryParams);

    const parsed = flowAlertsSchema.parse(response);
    const alerts = parsed.data || [];

    if (alerts.length === 0) {
      return { activities: 0 };
    }

    // Transform and insert into unusual_options_activity
    const records = alerts.map(alert => {
      const daysToExpiry = Math.floor(
        (new Date(alert.expiry).getTime() - new Date(alert.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );

      // Map alert_rule to activity_type
      let activityType = 'UNKNOWN';
      if (alert.alert_rule.includes('Floor')) activityType = 'FLOOR_TRADE';
      else if (alert.alert_rule.includes('RepeatedHits')) activityType = alert.type === 'call' ? 'LARGE_CALL_BUYING' : 'LARGE_PUT_BUYING';
      else if (alert.alert_rule.includes('Sweep')) activityType = 'SWEEP_CLUSTER';

      const sentiment = alert.type === 'call' ? 'bullish' : 'bearish';

      return {
        ticker: alert.ticker,
        trade_date: alert.created_at.substring(0, 10), // Extract date from timestamp
        detected_at: alert.created_at,
        activity_type: activityType,
        contract_count: alert.total_size,
        total_premium: parseNumeric(alert.total_premium),
        avg_implied_volatility: null, // Not provided in alert
        sentiment,
        underlying_price: parseNumeric(alert.underlying_price),
        expiration_date: alert.expiry,
        strikes_involved: [alert.strike],
        days_to_expiration: daysToExpiry,
        signal_strength: parseNumeric(alert.volume_oi_ratio), // Use vol/OI ratio as signal strength
        description: `${alert.alert_rule}: ${alert.total_size} contracts, $${alert.total_premium} premium`,
        source: 'UNUSUALWHALES',
        // Additional metadata
        has_sweep: alert.has_sweep,
        has_floor: alert.has_floor,
        trade_count: alert.trade_count,
      };
    });

    const { error } = await supabase
      .from('unusual_options_activity')
      .insert(records);

    if (error) {
      throw error;
    }

    return { activities: records.length };

  } catch (error) {
    console.error(`Error fetching flow alerts:`, error);
    throw error;
  }
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

  const { error } = await supabase
    .from('options_summary_daily')
    .upsert(summary, {
      onConflict: 'ticker,trade_date',
    });

  if (error) {
    throw error;
  }

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

  const { error: upsertError } = await supabase
    .from('options_historical_baselines')
    .upsert(baseline, {
      onConflict: 'ticker,as_of_date',
    });

  if (upsertError) {
    throw upsertError;
  }

  return { ticker, asOfDate, processed: true };
}
