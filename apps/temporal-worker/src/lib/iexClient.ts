import { setTimeout as delay } from 'timers/promises';
import crypto from 'crypto';

export interface IexClientConfig {
  baseUrl?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  userAgent?: string;
}

export class IexRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = 'IexRequestError';
  }
}

const DEFAULT_BASE_URL = 'https://www.iexexchange.io';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;
const DEFAULT_USER_AGENT = 'InstitutionalRotationDetector/1.0';

/**
 * IEX HIST Client
 *
 * Fetches historical matched volume data from IEX Exchange.
 * IEX HIST provides T+1 daily matched volume (on-exchange only) for free.
 *
 * Reference: https://www.iexexchange.io/market-data/connectivity/historical-data
 */
export class IexClient {
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly userAgent: string;

  constructor(config: IexClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
  }

  /**
   * Download IEX HIST daily matched volume file for a specific date
   *
   * @param date - Trade date in YYYY-MM-DD format
   * @returns Buffer of the downloaded file
   */
  async downloadDailyHIST(date: string): Promise<{ buffer: Buffer; fileId: string; sha256: string }> {
    // IEX HIST files are typically available at:
    // https://iextrading.com/trading/market-data/hist/
    // Format: IEXTP1_TOPS_YYYYMMDD.pcap.gz or similar
    // For simplicity, we'll construct the URL based on date

    const dateStr = date.replace(/-/g, ''); // YYYYMMDD
    const fileId = `IEXHIST_${dateStr}`;

    // Note: IEX HIST file format and URL structure may need adjustment
    // based on actual IEX historical data distribution method
    // This is a placeholder that should be updated with actual IEX HIST URL pattern
    const url = `${this.baseUrl}/hist/IEXTP1_TOPS_${dateStr}.pcap.gz`;

    const response = await this.request(url);
    const buffer = Buffer.from(await response.arrayBuffer());
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    return { buffer, fileId, sha256 };
  }

  /**
   * Parse IEX HIST daily volume data from CSV
   *
   * @param csvContent - CSV content as string
   * @returns Array of volume records
   */
  parseDailyVolume(csvContent: string): IexDailyVolumeRecord[] {
    const lines = csvContent.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      return [];
    }

    const headers = parseCsvLine(lines[0]!);
    const records: IexDailyVolumeRecord[] = [];

    for (let i = 1; i < lines.length; i += 1) {
      const values = parseCsvLine(lines[i]!);
      const record: Record<string, string> = {};
      headers.forEach((header, idx) => {
        record[header] = values[idx] ?? '';
      });

      // Map IEX fields to our schema
      // Adjust field names based on actual IEX HIST CSV format
      const normalized = normalizeRow(record);
      records.push({
        symbol: (normalized.get('symbol') ?? normalized.get('ticker') ?? '') as string,
        matched_shares: parseFloat((normalized.get('volume') ?? normalized.get('matchedshares') ?? '0') as string),
        trade_date: normalized.get('date') as string,
      });
    }

    return records.filter((r) => r.symbol && r.matched_shares > 0);
  }

  private async request(url: string, attempt = 0): Promise<Response> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/csv, application/octet-stream',
        },
      });

      if (!response.ok) {
        const body = await safeReadBody(response);
        if (shouldRetry(response.status) && attempt < this.maxRetries) {
          await this.backoff(attempt);
          return this.request(url, attempt + 1);
        }
        throw new IexRequestError(
          `IEX request failed with status ${response.status}`,
          response.status,
          body
        );
      }

      return response;
    } catch (err) {
      if (err instanceof IexRequestError) {
        throw err;
      }
      if (attempt < this.maxRetries) {
        await this.backoff(attempt);
        return this.request(url, attempt + 1);
      }
      throw err;
    }
  }

  private async backoff(attempt: number): Promise<void> {
    const jitter = Math.random() * this.retryDelayMs;
    const waitMs = this.retryDelayMs * 2 ** attempt + jitter;
    await delay(waitMs);
  }
}

export interface IexDailyVolumeRecord {
  symbol: string;
  trade_date: string;
  matched_shares: number;
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

async function safeReadBody(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch (err) {
    return undefined;
  }
}

function normalizeRow(row: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(row)) {
    map.set(key.toLowerCase().replace(/[_\s]/g, ''), value);
  }
  return map;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

export function createIexClient(): IexClient {
  const baseUrl = process.env.IEX_HIST_BASE_URL ?? DEFAULT_BASE_URL;
  const maxRetries = process.env.IEX_MAX_RETRIES ? Number(process.env.IEX_MAX_RETRIES) : DEFAULT_MAX_RETRIES;
  const retryDelayMs = process.env.IEX_RETRY_DELAY_MS
    ? Number(process.env.IEX_RETRY_DELAY_MS)
    : DEFAULT_RETRY_DELAY_MS;
  const userAgent = process.env.EDGAR_USER_AGENT ?? DEFAULT_USER_AGENT;

  return new IexClient({ baseUrl, maxRetries, retryDelayMs, userAgent });
}
