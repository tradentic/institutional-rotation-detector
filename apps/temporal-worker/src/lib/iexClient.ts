import crypto from 'crypto';
import { HttpClient, HttpError, TimeoutError, type HttpRequestOptions } from '@tradentic/resilient-http-core';

export interface IexClientConfig {
  baseUrl?: string;
  maxRetries?: number;
  userAgent?: string;
  histDownloadTimeoutMs?: number;
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
const DEFAULT_USER_AGENT = 'InstitutionalRotationDetector/1.0';
const DEFAULT_HIST_TIMEOUT_MS = 120_000;

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
  private readonly userAgent: string;
  private readonly histDownloadTimeoutMs: number;
  private readonly httpClient: HttpClient;

  constructor(config: IexClientConfig = {}, httpClient?: HttpClient) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
    this.histDownloadTimeoutMs = config.histDownloadTimeoutMs ?? DEFAULT_HIST_TIMEOUT_MS;
    this.httpClient =
      httpClient ??
      new HttpClient({
        clientName: 'iex',
        baseUrl: this.baseUrl,
        maxRetries: this.maxRetries,
        beforeRequest: (opts: HttpRequestOptions) => ({
          ...opts,
          headers: {
            ...opts.headers,
            'User-Agent': this.userAgent,
            Accept: 'text/csv, application/octet-stream',
          },
        }),
        operationDefaults: {
          'hist.downloadDaily': {
            timeoutMs: this.histDownloadTimeoutMs,
            idempotent: true,
          },
        },
      });
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
    const path = `/hist/IEXTP1_TOPS_${dateStr}.pcap.gz`;

    try {
      const arrayBuffer = await this.httpClient.requestArrayBuffer({
        method: 'GET',
        path,
        operation: 'hist.downloadDaily',
      });
      const buffer = Buffer.from(arrayBuffer);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

      return { buffer, fileId, sha256 };
    } catch (error: unknown) {
      this.handleHttpError(error);
    }
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

  private handleHttpError(error: unknown): never {
    if (error instanceof HttpError) {
      const body = typeof error.body === 'string' ? error.body : undefined;
      throw new IexRequestError(`IEX request failed with status ${error.status}`, error.status, body);
    }
    if (error instanceof TimeoutError) {
      throw new IexRequestError('IEX request timed out', 408);
    }
    throw error;
  }
}

export interface IexDailyVolumeRecord {
  symbol: string;
  trade_date: string;
  matched_shares: number;
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
  const userAgent = process.env.EDGAR_USER_AGENT ?? DEFAULT_USER_AGENT;
  const histDownloadTimeoutMs = process.env.IEX_HIST_TIMEOUT_MS
    ? Number(process.env.IEX_HIST_TIMEOUT_MS)
    : DEFAULT_HIST_TIMEOUT_MS;

  return new IexClient({ baseUrl, maxRetries, userAgent, histDownloadTimeoutMs });
}
