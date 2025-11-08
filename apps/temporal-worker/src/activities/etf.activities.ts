import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient } from '../lib/supabase.js';

const ISHARES_COMPONENT_ID = '1467271812596';

interface IsharesFundConfig {
  productId: string;
  slug: string;
  cik: string;
}

interface IsharesHolding {
  ticker: string;
  cusip: string;
  shares: number;
  weight: number;
}

const ISHARES_FUNDS: Record<string, IsharesFundConfig> = {
  IWB: { productId: '239707', slug: 'ishares-russell-1000-etf', cik: 'IWB' },
  IWM: { productId: '239710', slug: 'ishares-russell-2000-etf', cik: 'IWM' },
  IWN: { productId: '239714', slug: 'ishares-russell-2000-value-etf', cik: 'IWN' },
  IWC: { productId: '239716', slug: 'ishares-micro-cap-etf', cik: 'IWC' },
};

const etfEntityCache = new Map<string, string>();

function normalizeCikCandidate(value: string): string {
  const trimmed = value.trim();
  const numeric = trimmed.replace(/\D/g, '');
  if (numeric.length > 0) {
    return numeric.padStart(10, '0');
  }
  return trimmed.toUpperCase();
}

async function resolveEtfEntityId(
  supabase: SupabaseClient,
  fund: string
): Promise<string> {
  const identifier = fund.trim().toUpperCase();
  if (!identifier) {
    throw new Error('ETF identifier is required');
  }

  const cached = etfEntityCache.get(identifier);
  if (cached) {
    return cached;
  }

  const config = ISHARES_FUNDS[identifier];
  const candidates = new Set<string>();
  if (config?.cik) {
    candidates.add(normalizeCikCandidate(config.cik));
  }
  if (/^\d{1,10}$/.test(identifier)) {
    candidates.add(normalizeCikCandidate(identifier));
  }
  candidates.add(identifier);

  for (const candidate of candidates) {
    const cacheKey = candidate.toUpperCase();
    const cachedCandidate = etfEntityCache.get(cacheKey);
    if (cachedCandidate) {
      etfEntityCache.set(identifier, cachedCandidate);
      return cachedCandidate;
    }

    const { data, error } = await supabase
      .from('entities')
      .select('entity_id')
      .eq('kind', 'etf')
      .eq('cik', candidate)
      .maybeSingle();

    if (error) {
      if (error.code && error.code !== 'PGRST116') {
        throw error;
      }
    } else if (data?.entity_id) {
      etfEntityCache.set(identifier, data.entity_id);
      etfEntityCache.set(cacheKey, data.entity_id);
      return data.entity_id;
    }
  }

  throw new Error(`ETF entity not found for ${fund}`);
}

function buildIsharesBaseUrl(fund: string): string {
  const config = ISHARES_FUNDS[fund.toUpperCase()];
  if (!config) {
    throw new Error(`Unsupported iShares fund: ${fund}`);
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

async function downloadIsharesHoldings(fund: string): Promise<{ asof: string; holdings: IsharesHolding[] }> {
  const baseUrl = buildIsharesBaseUrl(fund);
  const headers: Record<string, string> = {
    'User-Agent': 'institutional-rotation-detector/1.0 (+https://github.com/institutional-rotation-detector)',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const [jsonResponse, csvResponse] = await Promise.all([
    fetch(`${baseUrl}?tab=all&fileType=json`, { headers }),
    fetch(`${baseUrl}?fileType=csv&fileName=${encodeURIComponent(fund.toUpperCase())}_holdings&dataType=fund`, { headers }),
  ]);

  if (!jsonResponse.ok) {
    const text = await jsonResponse.text();
    throw new Error(`Failed to download holdings JSON for ${fund}: ${jsonResponse.status} ${text}`);
  }
  if (!csvResponse.ok) {
    const text = await csvResponse.text();
    throw new Error(`Failed to download holdings CSV for ${fund}: ${csvResponse.status} ${text}`);
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
  funds: string[]
): Promise<number> {
  const supabase = createSupabaseClient();
  const targets = new Set(cusips.map((cusip) => cusip.toUpperCase()));
  let totalUpserted = 0;

  for (const fund of funds) {
    let holderId: string;
    try {
      holderId = await resolveEtfEntityId(supabase, fund);
    } catch (error) {
      console.error(`Unable to resolve ETF entity for ${fund}:`, error);
      continue;
    }

    let download;
    try {
      download = await downloadIsharesHoldings(fund);
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
      .eq('holder_id', holderId)
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
        holder_id: holderId,
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
