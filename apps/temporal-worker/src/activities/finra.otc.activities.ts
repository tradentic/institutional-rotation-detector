import { createHash } from 'crypto';
import { gunzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { createSupabaseClient } from '../lib/supabase.js';
import { parseCsv } from '../lib/csv.js';
import { RateLimiter } from '../lib/rateLimit.js';

const SOURCE_KEY = 'FINRA_OTC';
const MAX_RPS = Number.parseInt(process.env.MAX_RPS_EXTERNAL ?? '6', 10);
const USER_AGENT = process.env.EDGAR_USER_AGENT ?? 'InstitutionalRotationDetector/1.0 (+https://github.com/openai)';

const limiter = new RateLimiter(Math.max(1, MAX_RPS));

interface ManifestFile {
  url: string;
  file: string;
  weekEnd: string;
  product?: string;
}

export interface FinraWeeklyFileDescriptor {
  url: string;
  fileId: string;
  reportType: 'ATS' | 'NON_ATS';
  weekEnd: string;
  product?: string;
}

export interface DownloadedFinraFile extends FinraWeeklyFileDescriptor {
  sha256: string;
  csv: string;
}

function requireBaseUrl(): string {
  const base = process.env.FINRA_OTC_BASE_URL;
  if (!base) {
    throw new Error('FINRA_OTC_BASE_URL is not configured');
  }
  return base.replace(/\/$/, '');
}

async function fetchJson(url: URL): Promise<ManifestFile[]> {
  await limiter.throttle();
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/json,text/csv,text/plain',
    },
  });
  if (!response.ok) {
    throw new Error(`FINRA manifest request failed (${response.status})`);
  }
  const text = await response.text();
  if (!text.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed as ManifestFile[];
    }
    if (Array.isArray(parsed?.files)) {
      return parsed.files as ManifestFile[];
    }
  } catch (error) {
    // fall through to HTML parsing
  }
  return parseManifestFromHtml(text);
}

function parseManifestFromHtml(html: string): ManifestFile[] {
  const matches = Array.from(html.matchAll(/href="([^"]+\.csv(?:\.zip|\.gz)?)"[^>]*>([^<]+)/gi));
  const files: ManifestFile[] = [];
  for (const match of matches) {
    const href = match[1];
    if (!href) continue;
    const file = decodeURIComponent(href.split('/').pop() ?? href);
    const normalized = normalizeWeekFromName(file);
    files.push({
      url: href,
      file,
      weekEnd: normalized,
    });
  }
  return files;
}

function normalizeWeekFromName(file: string): string {
  const match = file.match(/(20\d{2})(\d{2})(\d{2})/);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${month}-${day}`;
  }
  const alt = file.match(/(\d{4}-\d{2}-\d{2})/);
  if (alt) {
    return alt[1]!;
  }
  throw new Error(`Unable to infer week from filename ${file}`);
}

function resolveUrl(base: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const url = new URL(path, `${base}/`);
  return url.toString();
}

function decodeCsv(buffer: Buffer, fileName: string): string {
  if (fileName.endsWith('.gz')) {
    return gunzipSync(buffer).toString('utf-8');
  }
  if (fileName.endsWith('.zip')) {
    const unzipped = unzipSync(new Uint8Array(buffer));
    const first = Object.values(unzipped)[0];
    if (!first) {
      throw new Error(`ZIP archive ${fileName} did not contain any files`);
    }
    return Buffer.from(first).toString('utf-8');
  }
  return buffer.toString('utf-8');
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[,\s]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function pick(row: Record<string, string>, ...candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const value = row[candidate.toLowerCase()];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

export async function listWeeklyFiles(
  reportType: 'ATS' | 'NON_ATS',
  weekEnd: string
): Promise<FinraWeeklyFileDescriptor[]> {
  const base = requireBaseUrl();
  const manifestUrl = new URL('manifest.json', `${base}/`);
  manifestUrl.searchParams.set('reportType', reportType);
  if (weekEnd) {
    manifestUrl.searchParams.set('weekEnd', weekEnd);
  }
  const entries = await fetchJson(manifestUrl);
  return entries
    .filter((entry) => !weekEnd || entry.weekEnd === weekEnd)
    .map((entry) => ({
      url: resolveUrl(base, entry.url ?? entry.file),
      fileId: entry.file,
      reportType,
      weekEnd: entry.weekEnd,
      product: entry.product,
    }));
}

export async function downloadWeeklyFile(
  file: FinraWeeklyFileDescriptor
): Promise<DownloadedFinraFile> {
  await limiter.throttle();
  const response = await fetch(file.url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/octet-stream,text/csv,application/zip,application/gzip',
    },
  });
  if (!response.ok) {
    throw new Error(`FINRA download failed (${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const supabase = createSupabaseClient();
  const base64 = buffer.toString('base64');
  const { error } = await supabase
    .from('micro_source_files')
    .upsert(
      [
        {
          source: SOURCE_KEY,
          file_id: file.fileId,
          url: file.url,
          sha256,
          content: base64,
        },
      ],
      { onConflict: 'source,file_id' }
    );
  if (error) {
    throw error;
  }
  const csv = decodeCsv(buffer, file.fileId);
  return { ...file, sha256, csv };
}

export interface ParseOptions {
  symbols?: string[];
}

export async function parseVenueCsv(
  file: DownloadedFinraFile,
  options: ParseOptions = {}
): Promise<number> {
  const { rows } = parseCsv(file.csv);
  if (rows.length === 0) {
    return 0;
  }
  const supabase = createSupabaseClient();
  const upperSymbols = options.symbols?.map((symbol) => symbol.toUpperCase());
  const upserts = rows
    .map((row) => {
      const symbol = pick(row, 'symbol', 'issueSymbolIdentifier', 'ticker');
      if (!symbol) return null;
      if (upperSymbols && !upperSymbols.includes(symbol.toUpperCase())) {
        return null;
      }
      const venue = pick(row, 'atsParticipantIdentifier', 'venue', 'marketCenter', 'ats');
      const shares = parseNumber(pick(row, 'totalWeeklyShareQuantity', 'shareQuantity', 'totalShares'));
      const trades = parseNumber(pick(row, 'totalWeeklyTradeCount', 'tradeCount', 'totalTrades'));
      const product = pick(row, 'product', 'tier', 'issueClassification');
      return {
        symbol: symbol.toUpperCase(),
        week_end: file.weekEnd,
        product: product ?? null,
        source: file.reportType,
        venue_id: venue ? venue.toUpperCase() : 'UNKNOWN',
        total_shares: shares,
        total_trades: trades,
        finra_file_id: file.fileId,
        finra_sha256: file.sha256,
      };
    })
    .filter((row): row is Record<string, unknown> => row !== null);
  if (upserts.length === 0) {
    return 0;
  }
  const { error } = await supabase
    .from('micro_offex_venue_weekly')
    .upsert(upserts, { onConflict: 'symbol,week_end,source,venue_id' });
  if (error) {
    throw error;
  }
  return upserts.length;
}

export async function aggregateSymbolWeek(
  weekEnd: string,
  symbols?: string[]
): Promise<number> {
  const supabase = createSupabaseClient();
  const query = supabase
    .from('micro_offex_venue_weekly')
    .select('symbol,product,source,total_shares')
    .eq('week_end', weekEnd);
  if (symbols && symbols.length > 0) {
    query.in('symbol', symbols.map((symbol) => symbol.toUpperCase()));
  }
  const { data, error } = await query;
  if (error) {
    throw error;
  }
  const aggregates = new Map<string, { ats: number; nonAts: number; product: string | null }>();
  for (const row of data ?? []) {
    const symbol = (row as any).symbol as string;
    if (!symbol) continue;
    const product = (row as any).product ?? null;
    const source = (row as any).source as string;
    const shares = Number((row as any).total_shares ?? 0) || 0;
    const entry = aggregates.get(symbol) ?? { ats: 0, nonAts: 0, product };
    if (product && !entry.product) {
      entry.product = product;
    }
    if (source === 'ATS') {
      entry.ats += shares;
    } else if (source === 'NON_ATS') {
      entry.nonAts += shares;
    }
    aggregates.set(symbol, entry);
  }
  if (aggregates.size === 0) {
    return 0;
  }
  const upserts = Array.from(aggregates.entries()).map(([symbol, entry]) => ({
    symbol,
    week_end: weekEnd,
    product: entry.product,
    ats_shares: entry.ats,
    nonats_shares: entry.nonAts,
  }));
  const { error: upsertError } = await supabase
    .from('micro_offex_symbol_weekly')
    .upsert(upserts, { onConflict: 'symbol,week_end' });
  if (upsertError) {
    throw upsertError;
  }
  return upserts.length;
}
