import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient } from '../lib/supabase';
import { createSecClient } from '../lib/secClient';
import { upsertEntity, resolveSeriesId } from './entity-utils';
import { z } from 'zod';

const ISHARES_COMPONENT_ID = '1467271812596';

// Known iShares ETF configurations for self-healing
// Format: { ticker: { productId, slug } }
//
// Note: Only iShares ETFs are supported for daily holdings fetching via their public API.
// Other ETF families (Vanguard, SPDR, etc.) don't provide similar public APIs with productId/slug structure.
// For non-iShares ETFs, holdings data can still be obtained via N-PORT monthly filings.
const KNOWN_ISHARES_ETFS: Record<string, IsharesConfig> = {
  // Russell Index ETFs
  'IWM': { productId: '239710', slug: 'iwm-ishares-russell-2000-etf' },
  'IWB': { productId: '239707', slug: 'iwb-ishares-russell-1000-etf' },
  'IWN': { productId: '239714', slug: 'iwn-ishares-russell-2000-value-etf' },
  'IWC': { productId: '239722', slug: 'iwc-ishares-microcap-etf' },
  'IWD': { productId: '239706', slug: 'iwd-ishares-russell-1000-value-etf' },
  'IWF': { productId: '239705', slug: 'iwf-ishares-russell-1000-growth-etf' },
  'IWO': { productId: '239713', slug: 'iwo-ishares-russell-2000-growth-etf' },
  'IWP': { productId: '239717', slug: 'ishares-russell-midcap-growth-etf' },

  // S&P Index ETFs
  'IVV': { productId: '239726', slug: 'ivv-ishares-core-sp-500-etf' },
  'IVW': { productId: '239725', slug: 'ishares-sp-500-growth-etf' },
  'IJH': { productId: '239763', slug: 'ijh-ishares-core-sp-mid-cap-etf' },
  'IJK': { productId: '239762', slug: 'ishares-sp-midcap-400-growth-etf' },
  'IJJ': { productId: '239764', slug: 'ishares-sp-midcap-400-value-etf' },
  'IJR': { productId: '239774', slug: 'ijr-ishares-core-sp-small-cap-etf' },
  'IJS': { productId: '239775', slug: 'ishares-sp-smallcap-600-value-etf' },

  // International Equity ETFs
  'EFA': { productId: '239623', slug: 'ishares-msci-eafe-etf' },
  'EEM': { productId: '239637', slug: 'ishares-msci-emerging-markets-etf' },

  // Fixed Income ETFs
  'AGG': { productId: '239458', slug: 'ishares-core-total-us-bond-market-etf' },
  'LQD': { productId: '239566', slug: 'ishares-iboxx-investment-grade-corporate-bond-etf' },
};

const tickerSearchSchema = z.record(
  z.string(),
  z.object({
    cik_str: z.number(),
    ticker: z.string(),
    title: z.string(),
  })
);

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
 * Resolve CIK for a given ticker from SEC
 */
async function resolveCikFromTicker(ticker: string): Promise<{ cik: string; name: string } | null> {
  try {
    const secClient = createSecClient();
    const tickerEndpoint = process.env.SEC_TICKER_ENDPOINT ?? '/files/company_tickers.json';
    const searchResponse = await secClient.get(tickerEndpoint);
    const searchJson = await searchResponse.json();
    const tickerData = tickerSearchSchema.parse(searchJson);

    const match = Object.values(tickerData).find((entry) => entry.ticker.toUpperCase() === ticker.toUpperCase());
    if (!match) {
      return null;
    }

    const cik = match.cik_str.toString().padStart(10, '0');
    return { cik, name: match.title };
  } catch (error) {
    console.warn(`[resolveCikFromTicker] Failed to resolve CIK for ${ticker}:`, error);
    return null;
  }
}

/**
 * Auto-create ETF entity with known configuration
 */
async function autoCreateEtfEntity(
  supabase: SupabaseClient,
  ticker: string
): Promise<EtfEntity | null> {
  const normalizedTicker = ticker.toUpperCase();

  // Resolve CIK from SEC
  const resolved = await resolveCikFromTicker(normalizedTicker);
  if (!resolved) {
    console.warn(`[autoCreateEtfEntity] Could not resolve CIK for ${normalizedTicker}`);
    return null;
  }

  // Check if we have known iShares configuration
  const datasourceConfig = KNOWN_ISHARES_ETFS[normalizedTicker];
  if (!datasourceConfig) {
    console.warn(`[autoCreateEtfEntity] No known datasource config for ${normalizedTicker}`);
    return null;
  }

  // Attempt to resolve real series_id from N-PORT filings
  console.log(`[autoCreateEtfEntity] Attempting to resolve series_id for ${normalizedTicker} from N-PORT filings...`);
  let seriesId = await resolveSeriesId(resolved.cik, normalizedTicker);

  // Fallback: use placeholder series_id if N-PORT parsing fails
  if (!seriesId) {
    console.warn(`[autoCreateEtfEntity] Could not resolve series_id from N-PORT, using placeholder`);
    seriesId = `S${resolved.cik.substring(0, 9)}`;
  } else {
    console.log(`[autoCreateEtfEntity] Successfully resolved series_id: ${seriesId}`);
  }

  console.log(`[autoCreateEtfEntity] Creating ETF entity for ${normalizedTicker} (CIK: ${resolved.cik}, series_id: ${seriesId})`);

  // Create entity using upsertEntity
  const { entity_id } = await upsertEntity(resolved.cik, 'etf', seriesId);

  // Update with datasource configuration
  const { error: updateError } = await supabase
    .from('entities')
    .update({
      ticker: normalizedTicker,
      datasource_type: 'ishares',
      datasource_config: datasourceConfig,
      name: resolved.name,
    })
    .eq('entity_id', entity_id);

  if (updateError) {
    console.error(`[autoCreateEtfEntity] Failed to update datasource config:`, updateError);
    throw updateError;
  }

  // Return the created entity
  return {
    entity_id,
    cik: resolved.cik,
    series_id: seriesId,
    ticker: normalizedTicker,
    datasource_type: 'ishares',
    datasource_config: datasourceConfig,
  };
}

/**
 * Resolve ETF entity by ticker, including datasource configuration
 * Self-healing: auto-creates entity if not found and configuration is known
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

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to query ETF entity for ticker ${normalizedTicker}: ${error.message}`);
  }

  // Self-healing: auto-create if not found
  if (!data) {
    console.log(`[resolveEtfEntity] ETF entity not found for ${normalizedTicker}, attempting auto-creation`);
    const autoCreated = await autoCreateEtfEntity(supabase, normalizedTicker);
    if (autoCreated) {
      etfEntityCache.set(normalizedTicker, autoCreated);
      return autoCreated;
    }
    throw new Error(`ETF entity not found for ticker ${normalizedTicker} and could not be auto-created`);
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
  const errors: Array<{ fund: string; error: string }> = [];
  const warnings: Array<{ fund: string; message: string }> = [];

  for (const fund of funds) {
    // Resolve ETF entity with datasource configuration
    let etfEntity: EtfEntity;
    try {
      etfEntity = await resolveEtfEntity(supabase, fund);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[fetchDailyHoldings] Unable to resolve ETF entity for ${fund}:`, error);
      errors.push({ fund, error: `Entity resolution failed: ${errorMsg}` });
      continue;
    }

    // Download holdings using entity's datasource config
    let download;
    try {
      download = await downloadIsharesHoldings(etfEntity);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[fetchDailyHoldings] Failed to fetch holdings for ${fund}:`, error);
      errors.push({ fund, error: `Holdings download failed: ${errorMsg}` });
      continue;
    }

    const { asof, holdings } = download;
    const matching = holdings.filter((holding) => targets.has(holding.cusip));
    if (matching.length === 0) {
      console.info(`[fetchDailyHoldings] No holdings matched target CUSIPs for ${fund} on ${asof}`);
      warnings.push({
        fund,
        message: `No matching holdings found for ${targetCusips.length} target CUSIPs on ${asof}`,
      });
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
      console.info(`[fetchDailyHoldings] Skipping ${fund} on ${asof}; holdings already cached.`);
      continue;
    }

    const rows = matching.map((holding) => {
      const shares = normalizeShares(holding.shares);
      console.info(
        `[fetchDailyHoldings] ETF holding ${fund} ${asof}: ${holding.ticker} (${holding.cusip}) shares=${shares} weight=${holding.weight.toFixed(4)}`
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
    console.log(`[fetchDailyHoldings] ✓ Upserted ${rows.length} holdings for ${fund} on ${asof}`);
  }

  // Log summary
  if (errors.length > 0) {
    console.warn(`\n${'='.repeat(80)}`);
    console.warn(`⚠️  ETF INGESTION ERRORS (${errors.length} funds failed)`);
    console.warn(`${'='.repeat(80)}`);
    for (const { fund, error } of errors) {
      console.warn(`  - ${fund}: ${error}`);
    }
    console.warn(`${'='.repeat(80)}\n`);
  }

  if (warnings.length > 0) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`ℹ️  ETF INGESTION WARNINGS (${warnings.length} funds)`);
    console.log(`${'='.repeat(80)}`);
    for (const { fund, message } of warnings) {
      console.log(`  - ${fund}: ${message}`);
    }
    console.log(`${'='.repeat(80)}\n`);
  }

  console.log(
    `[fetchDailyHoldings] Summary: ${totalUpserted} holdings upserted, ` +
    `${errors.length} errors, ${warnings.length} warnings`
  );

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
