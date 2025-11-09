import { z } from 'zod';
import { createSupabaseClient } from '../lib/supabase.js';
import { createUnusualWhalesClient } from '../lib/unusualWhalesClient.js';

// ============================================================================
// Response Schemas
// ============================================================================

const optionContractSchema = z.object({
  ticker: z.string(),
  expiration_date: z.string(),
  strike: z.number(),
  option_type: z.enum(['call', 'put']),
  bid: z.number().optional(),
  ask: z.number().optional(),
  last: z.number().optional(),
  mark: z.number().optional(),
  volume: z.number().optional(),
  open_interest: z.number().optional(),
  implied_volatility: z.number().optional(),
  delta: z.number().optional(),
  gamma: z.number().optional(),
  theta: z.number().optional(),
  vega: z.number().optional(),
  rho: z.number().optional(),
  underlying_price: z.number().optional(),
});

const optionsChainResponseSchema = z.object({
  data: z.array(optionContractSchema).optional(),
});

const optionsFlowSchema = z.object({
  ticker: z.string(),
  date: z.string(),
  time: z.string().optional(),
  expiration_date: z.string(),
  strike: z.number(),
  option_type: z.enum(['call', 'put']),
  contract_count: z.number(),
  premium: z.number().optional(),
  fill_price: z.number().optional(),
  underlying_price: z.number().optional(),
  sentiment: z.enum(['bullish', 'bearish', 'neutral']).optional(),
  side: z.enum(['buy', 'sell', 'unknown']).optional(),
  is_sweep: z.boolean().optional(),
  is_block: z.boolean().optional(),
  is_aggressive: z.boolean().optional(),
  delta: z.number().optional(),
  iv: z.number().optional(),
});

const optionsFlowResponseSchema = z.object({
  data: z.array(optionsFlowSchema).optional(),
});

const unusualActivitySchema = z.object({
  ticker: z.string(),
  date: z.string(),
  activity_type: z.string().optional(),
  contract_count: z.number().optional(),
  total_premium: z.number().optional(),
  avg_iv: z.number().optional(),
  sentiment: z.enum(['bullish', 'bearish', 'neutral']).optional(),
  underlying_price: z.number().optional(),
  expiration_date: z.string().optional(),
  strikes: z.array(z.number()).optional(),
  signal_strength: z.number().optional(),
  description: z.string().optional(),
});

const unusualActivityResponseSchema = z.object({
  data: z.array(unusualActivitySchema).optional(),
});

// ============================================================================
// Helper Functions
// ============================================================================

function parseDateTime(date: string, time?: string): string {
  if (time) {
    return `${date}T${time}`;
  }
  return `${date}T00:00:00Z`;
}

function calculateVolumeOIRatio(volume: number | undefined, oi: number | undefined): number | null {
  if (!volume || !oi || oi === 0) return null;
  return volume / oi;
}

function calculateIVSkew(putIV: number | undefined, callIV: number | undefined): number | null {
  if (!putIV || !callIV) return null;
  return putIV - callIV;
}

// ============================================================================
// Activities
// ============================================================================

/**
 * Fetch options chain for a ticker on a specific date
 */
export async function fetchOptionsChain(params: {
  ticker: string;
  date: string;
}): Promise<{ ticker: string; date: string; contracts: number }> {
  const supabase = createSupabaseClient();
  const client = createUnusualWhalesClient();

  const { ticker, date } = params;

  try {
    // UnusualWhales API endpoint for options chain
    // Adjust the endpoint path based on actual API documentation
    const response = await client.get<any>(`/api/stock/${ticker}/option-chain`, {
      date,
    });

    // Parse response
    const parsed = optionsChainResponseSchema.parse(response);
    const contracts = parsed.data || [];

    if (contracts.length === 0) {
      return { ticker, date, contracts: 0 };
    }

    // Transform and insert into database
    const records = contracts.map(contract => {
      const volumeOIRatio = calculateVolumeOIRatio(contract.volume, contract.open_interest);
      const daysToExpiry = Math.floor(
        (new Date(contract.expiration_date).getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24)
      );

      return {
        ticker: contract.ticker,
        trade_date: date,
        expiration_date: contract.expiration_date,
        strike: contract.strike,
        option_type: contract.option_type,
        bid: contract.bid,
        ask: contract.ask,
        last_price: contract.last,
        mark: contract.mark,
        volume: contract.volume,
        open_interest: contract.open_interest,
        volume_oi_ratio: volumeOIRatio,
        delta: contract.delta,
        gamma: contract.gamma,
        theta: contract.theta,
        vega: contract.vega,
        rho: contract.rho,
        implied_volatility: contract.implied_volatility,
        underlying_price: contract.underlying_price,
        days_to_expiration: daysToExpiry,
        is_weekly: daysToExpiry <= 7,
        is_monthly: daysToExpiry > 7,
        data_source: 'UNUSUALWHALES',
      };
    });

    // Insert into options_chain_daily
    const { error } = await supabase
      .from('options_chain_daily')
      .upsert(records, {
        onConflict: 'ticker,trade_date,expiration_date,strike,option_type',
        ignoreDuplicates: false,
      });

    if (error) {
      throw error;
    }

    return { ticker, date, contracts: records.length };

  } catch (error) {
    console.error(`Error fetching options chain for ${ticker} on ${date}:`, error);
    throw error;
  }
}

/**
 * Fetch options flow (real-time transactions) for a ticker on a specific date
 */
export async function fetchOptionsFlow(params: {
  ticker: string;
  date: string;
}): Promise<{ ticker: string; date: string; flows: number }> {
  const supabase = createSupabaseClient();
  const client = createUnusualWhalesClient();

  const { ticker, date } = params;

  try {
    // UnusualWhales API endpoint for options flow
    const response = await client.get<any>(`/api/stock/${ticker}/options-flow`, {
      date,
    });

    const parsed = optionsFlowResponseSchema.parse(response);
    const flows = parsed.data || [];

    if (flows.length === 0) {
      return { ticker, date, flows: 0 };
    }

    // Transform and insert
    const records = flows.map(flow => {
      const tradeDateTime = parseDateTime(flow.date, flow.time);
      const volumeOIRatio = flow.contract_count && flow.contract_count > 0
        ? flow.contract_count / (flow.contract_count + 100) // Approximation
        : null;

      return {
        ticker: flow.ticker,
        trade_datetime: tradeDateTime,
        trade_date: flow.date,
        expiration_date: flow.expiration_date,
        strike: flow.strike,
        option_type: flow.option_type,
        contract_count: flow.contract_count,
        premium_paid: flow.premium,
        fill_price: flow.fill_price,
        underlying_price: flow.underlying_price,
        sentiment: flow.sentiment,
        trade_side: flow.side,
        is_sweep: flow.is_sweep || false,
        is_block: flow.is_block || false,
        is_aggressive: flow.is_aggressive || false,
        delta: flow.delta,
        implied_volatility: flow.iv,
        is_unusual: flow.is_sweep || flow.is_block || false,
        volume_oi_ratio: volumeOIRatio,
        data_source: 'UNUSUALWHALES',
      };
    });

    const { error } = await supabase
      .from('options_flow')
      .upsert(records, {
        onConflict: 'ticker,trade_datetime,expiration_date,strike,option_type,contract_count',
        ignoreDuplicates: true,
      });

    if (error) {
      throw error;
    }

    return { ticker, date, flows: records.length };

  } catch (error) {
    console.error(`Error fetching options flow for ${ticker} on ${date}:`, error);
    throw error;
  }
}

/**
 * Fetch unusual options activity for a date
 */
export async function fetchUnusualOptionsActivity(params: {
  date: string;
  minPremium?: number;
}): Promise<{ date: string; activities: number }> {
  const supabase = createSupabaseClient();
  const client = createUnusualWhalesClient();

  const { date, minPremium } = params;

  try {
    // UnusualWhales unusual activity endpoint
    const queryParams: Record<string, string> = { date };
    if (minPremium) {
      queryParams.min_premium = minPremium.toString();
    }

    const response = await client.get<any>('/api/unusual-activity', queryParams);

    const parsed = unusualActivityResponseSchema.parse(response);
    const activities = parsed.data || [];

    if (activities.length === 0) {
      return { date, activities: 0 };
    }

    // Transform and insert
    const records = activities.map(activity => {
      const daysToExpiry = activity.expiration_date
        ? Math.floor((new Date(activity.expiration_date).getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        ticker: activity.ticker,
        trade_date: date,
        detected_at: new Date().toISOString(),
        activity_type: activity.activity_type || 'UNKNOWN',
        contract_count: activity.contract_count,
        total_premium: activity.total_premium,
        avg_implied_volatility: activity.avg_iv,
        sentiment: activity.sentiment,
        underlying_price: activity.underlying_price,
        expiration_date: activity.expiration_date,
        strikes_involved: activity.strikes?.map(s => s.toString()),
        days_to_expiration: daysToExpiry,
        signal_strength: activity.signal_strength,
        description: activity.description,
        source: 'UNUSUALWHALES',
      };
    });

    const { error } = await supabase
      .from('unusual_options_activity')
      .insert(records);

    if (error) {
      throw error;
    }

    return { date, activities: records.length };

  } catch (error) {
    console.error(`Error fetching unusual options activity for ${date}:`, error);
    throw error;
  }
}

/**
 * Compute daily options summary from chain and flow data
 */
export async function computeOptionsSummary(params: {
  ticker: string;
  date: string;
}): Promise<{ ticker: string; date: string; processed: boolean }> {
  const supabase = createSupabaseClient();
  const { ticker, date } = params;

  // Fetch chain data for this ticker/date
  const { data: chainData, error: chainError } = await supabase
    .from('options_chain_daily')
    .select('*')
    .eq('ticker', ticker)
    .eq('trade_date', date);

  if (chainError) {
    throw chainError;
  }

  // Fetch flow data
  const { data: flowData, error: flowError } = await supabase
    .from('options_flow')
    .select('*')
    .eq('ticker', ticker)
    .eq('trade_date', date);

  if (flowError) {
    throw flowError;
  }

  if (!chainData || chainData.length === 0) {
    return { ticker, date, processed: false };
  }

  // Aggregate metrics
  let totalCallVolume = 0;
  let totalPutVolume = 0;
  let totalCallOI = 0;
  let totalPutOI = 0;
  let totalCallPremium = 0;
  let totalPutPremium = 0;
  let atmCallIV: number | null = null;
  let atmPutIV: number | null = null;
  let underlyingClose: number | null = null;

  // Process chain data
  for (const contract of chainData) {
    const volume = contract.volume || 0;
    const oi = contract.open_interest || 0;

    if (contract.option_type === 'call') {
      totalCallVolume += volume;
      totalCallOI += oi;
    } else {
      totalPutVolume += volume;
      totalPutOI += oi;
    }

    // Find ATM IV (contracts closest to underlying price)
    if (contract.underlying_price) {
      underlyingClose = contract.underlying_price;
      const strikeDistance = Math.abs(contract.strike - contract.underlying_price);
      if (strikeDistance < 5) { // Within $5 of ATM
        if (contract.option_type === 'call' && contract.implied_volatility) {
          atmCallIV = contract.implied_volatility;
        } else if (contract.option_type === 'put' && contract.implied_volatility) {
          atmPutIV = contract.implied_volatility;
        }
      }
    }
  }

  // Process flow data
  let unusualCallCount = 0;
  let unusualPutCount = 0;
  let sweepCallCount = 0;
  let sweepPutCount = 0;
  let blockCallCount = 0;
  let blockPutCount = 0;
  let netCallDelta = 0;
  let netPutDelta = 0;
  let totalPremiumBullish = 0;
  let totalPremiumBearish = 0;

  for (const flow of flowData || []) {
    const premium = flow.premium_paid || 0;
    const delta = flow.delta || 0;

    if (flow.option_type === 'call') {
      if (flow.is_unusual) unusualCallCount++;
      if (flow.is_sweep) sweepCallCount++;
      if (flow.is_block) blockCallCount++;
      netCallDelta += delta;
      totalCallPremium += premium;
    } else {
      if (flow.is_unusual) unusualPutCount++;
      if (flow.is_sweep) sweepPutCount++;
      if (flow.is_block) blockPutCount++;
      netPutDelta += delta;
      totalPutPremium += premium;
    }

    if (flow.sentiment === 'bullish') {
      totalPremiumBullish += premium;
    } else if (flow.sentiment === 'bearish') {
      totalPremiumBearish += premium;
    }
  }

  // Calculate ratios
  const putCallRatioVolume = totalCallVolume > 0 ? totalPutVolume / totalCallVolume : null;
  const putCallRatioOI = totalCallOI > 0 ? totalPutOI / totalCallOI : null;
  const ivSkew = calculateIVSkew(atmPutIV, atmCallIV);
  const netPremium = totalCallPremium - totalPutPremium;

  // Insert summary
  const summary = {
    ticker,
    trade_date: date,
    total_call_volume: totalCallVolume,
    total_put_volume: totalPutVolume,
    total_call_oi: totalCallOI,
    total_put_oi: totalPutOI,
    put_call_ratio_volume: putCallRatioVolume,
    put_call_ratio_oi: putCallRatioOI,
    total_call_premium: totalCallPremium,
    total_put_premium: totalPutPremium,
    net_premium: netPremium,
    atm_call_iv: atmCallIV,
    atm_put_iv: atmPutIV,
    iv_skew: ivSkew,
    unusual_call_count: unusualCallCount,
    unusual_put_count: unusualPutCount,
    sweep_call_count: sweepCallCount,
    sweep_put_count: sweepPutCount,
    block_call_count: blockCallCount,
    block_put_count: blockPutCount,
    net_call_delta: netCallDelta,
    net_put_delta: netPutDelta,
    total_premium_bullish: totalPremiumBullish,
    total_premium_bearish: totalPremiumBearish,
    underlying_close: underlyingClose,
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

  // Calculate date range (30 days back from asOfDate)
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
  const totalVolumes = summaries.map(s => (s.total_call_volume || 0) + (s.total_put_volume || 0));
  const callOIs = summaries.map(s => s.total_call_oi || 0);
  const putOIs = summaries.map(s => s.total_put_oi || 0);
  const ivs = summaries.map(s => s.atm_call_iv || s.atm_put_iv || 0).filter(v => v > 0);
  const ivSkews = summaries.map(s => s.iv_skew || 0).filter(v => v !== 0);
  const pcRatiosVolume = summaries.map(s => s.put_call_ratio_volume || 0).filter(v => v > 0);
  const pcRatiosOI = summaries.map(s => s.put_call_ratio_oi || 0).filter(v => v > 0);

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const percentile = (arr: number[], p: number) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * p);
    return sorted[index];
  };

  const baseline = {
    ticker,
    as_of_date: asOfDate,
    avg_daily_call_volume_30d: Math.round(avg(callVolumes)),
    avg_daily_put_volume_30d: Math.round(avg(putVolumes)),
    avg_daily_total_volume_30d: Math.round(avg(totalVolumes)),
    avg_call_oi_30d: Math.round(avg(callOIs)),
    avg_put_oi_30d: Math.round(avg(putOIs)),
    avg_iv_30d: avg(ivs),
    avg_iv_skew_30d: avg(ivSkews),
    avg_pc_ratio_volume_30d: avg(pcRatiosVolume),
    avg_pc_ratio_oi_30d: avg(pcRatiosOI),
    p50_call_volume: Math.round(percentile(callVolumes, 0.5)),
    p75_call_volume: Math.round(percentile(callVolumes, 0.75)),
    p90_call_volume: Math.round(percentile(callVolumes, 0.9)),
    p50_put_volume: Math.round(percentile(putVolumes, 0.5)),
    p75_put_volume: Math.round(percentile(putVolumes, 0.75)),
    p90_put_volume: Math.round(percentile(putVolumes, 0.9)),
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
