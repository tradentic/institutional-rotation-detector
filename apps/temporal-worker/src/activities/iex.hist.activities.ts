import { createHash } from 'crypto';
import { unzipSync } from 'fflate';
import { createSupabaseClient } from '../lib/supabase.js';
import { parseCsv } from '../lib/csv.js';
import { RateLimiter } from '../lib/rateLimit.js';

const SOURCE_KEY = 'IEX_HIST';
const MAX_RPS = Number.parseInt(process.env.MAX_RPS_EXTERNAL ?? '6', 10);
const USER_AGENT = process.env.EDGAR_USER_AGENT ?? 'InstitutionalRotationDetector/1.0 (+https://github.com/openai)';

const limiter = new RateLimiter(Math.max(1, MAX_RPS));

export interface IexDailyDescriptor {
  tradeDate: string;
  url: string;
  fileId: string;
}

export interface DownloadedIexFile extends IexDailyDescriptor {
  sha256: string;
  csv: string;
}

function baseUrl(): string {
  const base = process.env.IEX_HIST_BASE_URL ?? 'https://www.iexexchange.io';
  return base.replace(/\/$/, '');
}

function buildDailyUrl(tradeDate: string): IexDailyDescriptor {
  const date = tradeDate.replace(/-/g, '');
  const fileId = `hist-${date}.csv`;
  const url = `${baseUrl()}/hist/stocks/${date}.csv`; // default HIST pattern
  return { tradeDate, url, fileId };
}

function decodeCsv(buffer: Buffer): string {
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const files = unzipSync(new Uint8Array(buffer));
    const first = Object.values(files)[0];
    if (!first) {
      throw new Error('IEX HIST archive was empty');
    }
    return Buffer.from(first).toString('utf-8');
  }
  return buffer.toString('utf-8');
}

export async function downloadDaily(tradeDate: string): Promise<DownloadedIexFile> {
  const descriptor = buildDailyUrl(tradeDate);
  await limiter.throttle();
  const response = await fetch(descriptor.url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/octet-stream,text/csv,application/zip',
    },
  });
  if (!response.ok) {
    throw new Error(`IEX HIST download failed (${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const csv = decodeCsv(buffer);
  const supabase = createSupabaseClient();
  const { error } = await supabase
    .from('micro_source_files')
    .upsert(
      [
        {
          source: SOURCE_KEY,
          file_id: descriptor.fileId,
          url: descriptor.url,
          sha256,
          content: buffer.toString('base64'),
        },
      ],
      { onConflict: 'source,file_id' }
    );
  if (error) {
    throw error;
  }
  return { ...descriptor, sha256, csv };
}

export interface ParseDailyOptions {
  symbols?: string[];
}

export async function parseDailyVolume(
  file: DownloadedIexFile,
  options: ParseDailyOptions = {}
): Promise<number> {
  const { rows } = parseCsv(file.csv);
  if (rows.length === 0) {
    return 0;
  }
  const supabase = createSupabaseClient();
  const upperSymbols = options.symbols?.map((symbol) => symbol.toUpperCase());
  const upserts = rows
    .map((row) => {
      const symbol = (row['symbol'] ?? row['ticker'] ?? row['securitysymbol'])?.toUpperCase();
      if (!symbol) return null;
      if (upperSymbols && !upperSymbols.includes(symbol)) {
        return null;
      }
      const matchedRaw = row['volume'] ?? row['matched_shares'] ?? row['shares'];
      const cleaned = typeof matchedRaw === 'string' ? matchedRaw.replace(/[,\s]/g, '') : matchedRaw;
      const matchedShares = Number(cleaned ?? 0);
      if (!Number.isFinite(matchedShares)) {
        return null;
      }
      return {
        symbol,
        trade_date: file.tradeDate,
        matched_shares: matchedShares,
        iex_file_id: file.fileId,
        iex_sha256: file.sha256,
      };
    })
    .filter((row): row is Record<string, unknown> => row !== null);
  if (upserts.length === 0) {
    return 0;
  }
  const { error } = await supabase
    .from('micro_iex_volume_daily')
    .upsert(upserts, { onConflict: 'symbol,trade_date' });
  if (error) {
    throw error;
  }
  return upserts.length;
}
