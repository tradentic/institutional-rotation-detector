import { createSupabaseClient } from '../lib/supabase';

/**
 * Price source abstraction for market data.
 * Implementations can use Yahoo Finance, Alpha Vantage, Polygon, or other providers.
 */
export interface PriceSource {
  fetchDailyPrices(
    ticker: string,
    startDate: string,
    endDate: string
  ): Promise<DailyPrice[]>;
}

export interface DailyPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
}

export interface EventStudyResult {
  anchorDate: string;
  cik: string;
  ticker: string;
  car_m5_p20: number; // Cumulative abnormal return from -5 to +20 days
  max_ret_w13: number; // Maximum return within 13 weeks
  t_to_plus20_days: number; // Days to reach +20% return (or -1 if not reached)
  max_dd: number; // Maximum drawdown
  abnormal_returns: Array<{ date: string; car: number; raw_return: number }>;
}

/**
 * Simple market-adjusted returns using SPY as benchmark.
 * In production, use sector-specific ETFs for better adjustment.
 */
class SimplePriceSource implements PriceSource {
  async fetchDailyPrices(
    ticker: string,
    startDate: string,
    endDate: string
  ): Promise<DailyPrice[]> {
    // TODO: Replace with actual API call (Yahoo Finance, Polygon, etc.)
    // For now, this is a placeholder that should be implemented based on your data provider
    throw new Error(
      `Price fetching not yet implemented. Need to fetch ${ticker} from ${startDate} to ${endDate}`
    );
  }
}

let priceSource: PriceSource = new SimplePriceSource();

export function setPriceSource(source: PriceSource) {
  priceSource = source;
}

function parseDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  const direction = days > 0 ? 1 : -1;
  const target = Math.abs(days);

  while (added < target) {
    result.setUTCDate(result.getUTCDate() + direction);
    const dayOfWeek = result.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      added++;
    }
  }
  return result;
}

/**
 * Compute event study metrics: CAR, max return, time to +20%, and max drawdown.
 * Uses market-adjusted returns (stock return - benchmark return).
 */
export async function eventStudy(
  anchorDate: string,
  cik: string
): Promise<EventStudyResult> {
  const supabase = createSupabaseClient();

  // Self-healing: ensure entity exists before querying
  try {
    const { upsertEntity } = await import('./entity-utils');
    await upsertEntity(cik, 'issuer');
  } catch (error) {
    console.warn(`[eventStudy] Failed to ensure entity exists for CIK ${cik}:`, error);
  }

  // Resolve ticker from CIK
  const entityQuery = await supabase
    .from('entities')
    .select('name')
    .eq('cik', cik)
    .eq('kind', 'issuer')
    .maybeSingle();

  if (entityQuery.error) {
    throw entityQuery.error;
  }

  if (!entityQuery.data) {
    throw new Error(`No issuer entity found for CIK ${cik}`);
  }

  // For now, use entity name as ticker (in production, maintain a CIK->ticker mapping)
  const ticker = entityQuery.data.name;

  const anchor = parseDate(anchorDate);
  const startDate = formatDate(addBusinessDays(anchor, -5)); // -5 days
  const endDate = formatDate(addBusinessDays(anchor, 100)); // +100 days (~13 weeks)

  // Fetch stock prices
  const stockPrices = await priceSource.fetchDailyPrices(ticker, startDate, endDate);

  // Fetch benchmark (SPY) prices
  const benchmarkPrices = await priceSource.fetchDailyPrices('SPY', startDate, endDate);

  // Create price maps
  const stockMap = new Map(stockPrices.map((p) => [p.date, p]));
  const benchmarkMap = new Map(benchmarkPrices.map((p) => [p.date, p]));

  // Compute daily returns and abnormal returns
  const abnormalReturns: Array<{ date: string; car: number; raw_return: number }> = [];
  let cumulativeAbnormal = 0;
  let maxReturn = 0;
  let maxDrawdown = 0;
  let peakReturn = 0;
  let daysToPlus20 = -1;

  const sortedDates = Array.from(stockMap.keys()).sort();

  for (let i = 1; i < sortedDates.length; i++) {
    const date = sortedDates[i];
    const prevDate = sortedDates[i - 1];

    const stockPrice = stockMap.get(date);
    const prevStockPrice = stockMap.get(prevDate);
    const benchmarkPrice = benchmarkMap.get(date);
    const prevBenchmarkPrice = benchmarkMap.get(prevDate);

    if (!stockPrice || !prevStockPrice || !benchmarkPrice || !prevBenchmarkPrice) {
      continue;
    }

    // Calculate returns
    const stockReturn =
      (stockPrice.adjClose - prevStockPrice.adjClose) / prevStockPrice.adjClose;
    const benchmarkReturn =
      (benchmarkPrice.adjClose - prevBenchmarkPrice.adjClose) / prevBenchmarkPrice.adjClose;

    // Abnormal return = stock return - market return
    const abnormalReturn = stockReturn - benchmarkReturn;
    cumulativeAbnormal += abnormalReturn;

    abnormalReturns.push({
      date,
      car: cumulativeAbnormal,
      raw_return: stockReturn,
    });

    // Track maximum return
    if (cumulativeAbnormal > maxReturn) {
      maxReturn = cumulativeAbnormal;
    }

    // Track peak for drawdown calculation
    if (cumulativeAbnormal > peakReturn) {
      peakReturn = cumulativeAbnormal;
    }

    // Calculate drawdown from peak
    const drawdown = peakReturn - cumulativeAbnormal;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }

    // Check if we reached +20% (0.20)
    if (daysToPlus20 === -1 && cumulativeAbnormal >= 0.2) {
      daysToPlus20 = i;
    }
  }

  // Compute CAR from -5 to +20 days
  const carWindow = abnormalReturns.filter((_, idx) => idx <= 25); // -5 to +20 = 25 trading days
  const car_m5_p20 = carWindow.length > 0 ? carWindow[carWindow.length - 1].car : 0;

  const result: EventStudyResult = {
    anchorDate,
    cik,
    ticker,
    car_m5_p20,
    max_ret_w13: maxReturn,
    t_to_plus20_days: daysToPlus20,
    max_dd: maxDrawdown,
    abnormal_returns: abnormalReturns.slice(0, 65), // Keep first ~13 weeks for storage
  };

  // Persist to rotation_events
  await supabase
    .from('rotation_events')
    .update({
      car_m5_p20: result.car_m5_p20,
      max_ret_w13: result.max_ret_w13,
      t_to_plus20_days: result.t_to_plus20_days,
    })
    .eq('issuer_cik', cik)
    .eq('anchor_filing', anchorDate);

  return result;
}

/**
 * Fetch historical prices for a ticker within a date range.
 * This is a convenience wrapper around the price source.
 */
export async function fetchPrices(
  ticker: string,
  startDate: string,
  endDate: string
): Promise<DailyPrice[]> {
  return priceSource.fetchDailyPrices(ticker, startDate, endDate);
}
