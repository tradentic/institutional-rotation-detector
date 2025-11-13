import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient } from '../lib/supabase';

const ISHARES_COMPONENT_ID = '1467271812596';

interface IsharesConfig {
  productId: string;
  slug: string;
}

interface EtfEntity {
  entity_id: string;
  cik: string;
  series_id: string;
  ticker: string;
  datasource_type: string;
  datasource_config: IsharesConfig;
}

interface IsharesHolding {
  ticker: string;
  cusip: string;
  shares: number;
  weight: number;
}

// Cache: ticker -> full ETF entity with config
const etfEntityCache = new Map<string, EtfEntity>();

/**
 * Resolve ETF entity by ticker, including datasource configuration
 */
async function resolveEtfEntity(
  supabase: SupabaseClient,
  ticker: string
): Promise<EtfEntity> {
  const normalizedTicker = ticker.trim().toUpperCase();
  if (!normalizedTicker) {
    throw new Error('ETF ticker is required');
  }

  // Check cache first
  const cached = etfEntityCache.get(normalizedTicker);
  if (cached) {
    return cached;
  }

  // Look up by ticker in entities table, including datasource config
  const { data, error } = await supabase
    .from('entities')
    .select('entity_id,cik,series_id,ticker,datasource_type,datasource_config')
    .eq('kind', 'etf')
    .eq('ticker', normalizedTicker)
    .maybeSingle();

  if (error) {
    if (error.code && error.code !== 'PGRST116') {
      throw error;
    }
    throw new Error(`Failed to query ETF entity for ticker ${normalizedTicker}: ${error.message}`);
  }

  if (!data) {
    throw new Error(`ETF entity not found for ticker ${normalizedTicker}`);
  }

  if (!data.datasource_type || !data.datasource_config) {
    throw new Error(`ETF ${normalizedTicker} missing datasource configuration`);
  }

  if (!data.series_id) {
    throw new Error(`ETF ${normalizedTicker} missing series_id`);
  }

  const entity: EtfEntity = {
    entity_id: data.entity_id,
    cik: data.cik,
    series_id: data.series_id,
    ticker: data.ticker,
    datasource_type: data.datasource_type,
    datasource_config: data.datasource_config as IsharesConfig,
  };

  // Cache and return
  etfEntityCache.set(normalizedTicker, entity);
  return entity;
}

/**
 * Build iShares API URL from datasource configuration
 */
function buildIsharesBaseUrl(config: IsharesConfig, ticker: string): string {
  if (!config.productId || !config.slug) {
    throw new Error(`Invalid iShares config for ${ticker}: missing productId or slug`);
  }
  return `https://www.ishares.com/us/products/${config.productId}/${config.slug}/${ISHARES_COMPONENT_ID}.ajax`;
}

function normalizeCusip(value: string): string | null {
  const trimmed = value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return trimmed.length === 9 ? trimmed : null;
}

export function parseIsharesAsOf(csv: string): string | null {
  const lines = csv.split(/\r?\n/);
  const asofLine = lines.find((line) => line.toLowerCase().startsWith('fund holdings as of'));
  if (!asofLine) return null;
  const match = asofLine.match(/Fund Holdings as of,"([^"]+)"/i);
  if (!match) return null;
  const parsed = new Date(`${match[1]} UTC`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function parseIsharesHoldings(rows: unknown[]): IsharesHolding[] {
  if (!Array.isArray(rows)) return [];
  const holdings: IsharesHolding[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 11) continue;
    const ticker = typeof row[0] === 'string' ? row[0] : null;
    const cusipRaw = typeof row[8] === 'string' ? row[8] : '';
    const sharesCell = row[7] as { raw?: number } | undefined;
    const weightCell = row[5] as { raw?: number } | undefined;
    const cusip = ticker ? normalizeCusip(cusipRaw) : null;
    if (!ticker || !cusip) continue;
    const shares = sharesCell && typeof sharesCell.raw === 'number' ? sharesCell.raw : Number.NaN;
    const weight = weightCell && typeof weightCell.raw === 'number' ? weightCell.raw : Number.NaN;
    if (!Number.isFinite(shares) || !Number.isFinite(weight)) continue;
    holdings.push({ ticker, cusip, shares, weight });
  }
  return holdings;
}

/**
 * Download holdings from iShares using entity's datasource configuration
 */
async function downloadIsharesHoldings(entity: EtfEntity): Promise<{ asof: string; holdings: IsharesHolding[] }> {
  if (entity.datasource_type !== 'ishares') {
    throw new Error(`Unsupported datasource type: ${entity.datasource_type}`);
  }

  const baseUrl = buildIsharesBaseUrl(entity.datasource_config, entity.ticker);
  const headers: Record<string, string> = {
    'User-Agent': 'institutional-rotation-detector/1.0 (+https://github.com/institutional-rotation-detector)',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const [jsonResponse, csvResponse] = await Promise.all([
    fetch(`${baseUrl}?tab=all&fileType=json`, { headers }),
    fetch(`${baseUrl}?fileType=csv&fileName=${encodeURIComponent(entity.ticker)}_holdings&dataType=fund`, { headers }),
  ]);

  if (!jsonResponse.ok) {
    const text = await jsonResponse.text();
    throw new Error(`Failed to download holdings JSON for ${entity.ticker}: ${jsonResponse.status} ${text}`);
  }
  if (!csvResponse.ok) {
    const text = await csvResponse.text();
    throw new Error(`Failed to download holdings CSV for ${entity.ticker}: ${csvResponse.status} ${text}`);
  }

  const jsonText = await jsonResponse.text();
  const parsedJson = JSON.parse(jsonText.replace(/^\uFEFF/, ''));
  const rows = Array.isArray(parsedJson.aaData) ? parsedJson.aaData : [];
  const holdings = parseIsharesHoldings(rows);
  const csvText = await csvResponse.text();
  const asof = parseIsharesAsOf(csvText) ?? new Date().toISOString().slice(0, 10);
  return { asof, holdings };
}

function normalizeShares(value: number): number {
  return Math.round(value);
}

export async function fetchDailyHoldings(
  cusips: string[],
  funds: string[],
  cik?: string
): Promise<number> {
  const supabase = createSupabaseClient();

  // If cusips not provided but CIK is, fetch from database
  let targetCusips = cusips;
  if (cusips.length === 0 && cik) {
    const { data: cusipRows } = await supabase
      .from('cusip_issuer_map')
      .select('cusip')
      .eq('issuer_cik', cik);
    targetCusips = (cusipRows || []).map(row => row.cusip).filter(Boolean);
    console.log(`[fetchDailyHoldings] Fetched ${targetCusips.length} CUSIPs from database for CIK ${cik}`);
  }

  const targets = new Set(targetCusips.map((cusip) => cusip.toUpperCase()));
  let totalUpserted = 0;

  for (const fund of funds) {
    // Resolve ETF entity with datasource configuration
    let etfEntity: EtfEntity;
    try {
      etfEntity = await resolveEtfEntity(supabase, fund);
    } catch (error) {
      console.error(`Unable to resolve ETF entity for ${fund}:`, error);
      continue;
    }

    // Download holdings using entity's datasource config
    let download;
    try {
      download = await downloadIsharesHoldings(etfEntity);
    } catch (error) {
      console.error(`Failed to fetch holdings for ${fund}:`, error);
      continue;
    }

    const { asof, holdings } = download;
    const matching = holdings.filter((holding) => targets.has(holding.cusip));
    if (matching.length === 0) {
      console.info(`No holdings matched target CUSIPs for ${fund} on ${asof}`);
      continue;
    }

    const existing = await supabase
      .from('uhf_positions')
      .select('holder_id')
      .eq('holder_id', etfEntity.entity_id)
      .eq('source', 'ETF')
      .eq('asof', asof)
      .limit(1)
      .maybeSingle();

    if (existing.error) {
      if (existing.error.code !== 'PGRST116') {
        throw existing.error;
      }
    } else if (existing.data) {
      console.info(`Skipping ${fund} on ${asof}; holdings already cached.`);
      continue;
    }

    const rows = matching.map((holding) => {
      const shares = normalizeShares(holding.shares);
      console.info(
        `ETF holding ${fund} ${asof}: ${holding.ticker} (${holding.cusip}) shares=${shares} weight=${holding.weight.toFixed(4)}`
      );
      return {
        holder_id: etfEntity.entity_id,
        cusip: holding.cusip,
        asof,
        shares,
        source: 'ETF' as const,
      };
    });

    const { error } = await supabase.from('uhf_positions').upsert(rows, {
      onConflict: 'holder_id,cusip,asof,source',
    });
    if (error) {
      throw error;
    }
    totalUpserted += rows.length;
  }

  return totalUpserted;
}

function normalizeDateInput(asOf: string): string {
  const parsed = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid as-of date: ${asOf}`);
  }
  return parsed.toISOString().slice(0, 10);
}

function addOneDay(asOf: string): string {
  const parsed = new Date(`${asOf}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

export interface EtfDailyPlanInput {
  asOf: string;
  funds: string[];
}

export interface EtfDailyPlanResult {
  asOf: string;
  funds: string[];
  cusips: string[];
  nextAsOf: string;
}

export async function planEtfDailySnapshots(
  input: EtfDailyPlanInput
): Promise<EtfDailyPlanResult> {
  const supabase = createSupabaseClient();
  const asOf = normalizeDateInput(input.asOf);
  const funds = input.funds.map((fund) => fund.toUpperCase());

  const { data: cusipRows, error: cusipError } = await supabase.from('cusip_issuer_map').select('cusip');
  if (cusipError) {
    throw cusipError;
  }

  const cusips = Array.from(
    new Set(
      ((cusipRows ?? []) as { cusip: string | null }[])
        .map((row) => (row.cusip ? normalizeCusip(row.cusip) : null))
        .filter((value): value is string => Boolean(value))
    )
  );

  if (cusips.length === 0) {
    return { asOf, funds: [], cusips: [], nextAsOf: addOneDay(asOf) };
  }

  if (funds.length === 0) {
    return { asOf, funds: [], cusips, nextAsOf: addOneDay(asOf) };
  }

  const { data: existing, error: existingError } = await supabase
    .from('uhf_positions')
    .select('holder_id')
    .eq('source', 'ETF')
    .eq('asof', asOf)
    .in('holder_id', funds);
  if (existingError) {
    throw existingError;
  }

  const completed = new Set(((existing ?? []) as { holder_id: string }[]).map((row) => row.holder_id));
  const pendingFunds = funds.filter((fund) => !completed.has(fund));

  return { asOf, funds: pendingFunds, cusips, nextAsOf: addOneDay(asOf) };
}
