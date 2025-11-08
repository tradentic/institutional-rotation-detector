import { createSupabaseClient } from '../lib/supabase.js';

const ISHARES_COMPONENT_ID = '1467271812596';

interface IsharesFundConfig {
  productId: string;
  slug: string;
}

interface IsharesHolding {
  ticker: string;
  cusip: string;
  shares: number;
  weight: number;
}

const ISHARES_FUNDS: Record<string, IsharesFundConfig> = {
  IWB: { productId: '239707', slug: 'ishares-russell-1000-etf' },
  IWM: { productId: '239710', slug: 'ishares-russell-2000-etf' },
  IWN: { productId: '239714', slug: 'ishares-russell-2000-value-etf' },
  IWC: { productId: '239716', slug: 'ishares-micro-cap-etf' },
};

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
      .eq('holder_id', fund)
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
        holder_id: fund,
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
