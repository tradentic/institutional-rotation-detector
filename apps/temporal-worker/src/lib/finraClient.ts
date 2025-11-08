import { setTimeout as delay } from 'timers/promises';

export interface FinraClientConfig {
  apiKey: string;
  baseUrl?: string;
  pageSize?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class FinraRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = 'FinraRequestError';
  }
}

const DEFAULT_BASE_URL = 'https://api.finra.org';
const DEFAULT_PAGE_SIZE = 5000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

export class FinraClient {
  private readonly baseUrl: string;
  private readonly pageSize: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(private readonly config: FinraClientConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.pageSize = config.pageSize ?? DEFAULT_PAGE_SIZE;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  async fetchShortInterest(settlementDate: string): Promise<Record<string, unknown>[]> {
    const filters = ['settlementDate', 'settlementdate'];
    return this.fetchWithFieldFallback('shortSale', 'shortInterest', settlementDate, filters);
  }

  async fetchATSWeekly(weekEndDate: string): Promise<Record<string, unknown>[]> {
    const filters = ['weekEndDate', 'weekof', 'weekOf', 'weekending'];
    return this.fetchWithFieldFallback('otcMarket', 'atsSummary', weekEndDate, filters);
  }

  private async fetchWithFieldFallback(
    group: string,
    name: string,
    value: string,
    filterFields: string[]
  ): Promise<Record<string, unknown>[]> {
    const errors: Error[] = [];
    for (const field of filterFields) {
      try {
        return await this.fetchDataset(group, name, { filter: `${field}:${value}` });
      } catch (err) {
        if (err instanceof FinraRequestError && err.status === 400) {
          errors.push(err);
          continue;
        }
        throw err;
      }
    }
    const rows = await this.fetchDataset(group, name, {});
    const lowerValue = value.toLowerCase();
    return rows.filter((row) => {
      const normalized = normalizeRow(row);
      return filterFields.some((field) => {
        const fieldValue = normalized.get(field.toLowerCase());
        if (!fieldValue) return false;
        if (typeof fieldValue === 'string') {
          return fieldValue.toLowerCase() === lowerValue;
        }
        if (fieldValue instanceof Date) {
          return fieldValue.toISOString().slice(0, 10) === value;
        }
        if (typeof fieldValue === 'number') {
          return String(fieldValue) === value;
        }
        return false;
      });
    });
  }

  private async fetchDataset(
    group: string,
    name: string,
    params: Record<string, string>
  ): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    let offset = 0;
    while (true) {
      const searchParams = new URLSearchParams({
        limit: String(this.pageSize),
        offset: String(offset),
        ...params,
      });
      const url = `${this.baseUrl}/data/group/${encodeURIComponent(group)}/name/${encodeURIComponent(
        name
      )}?${searchParams.toString()}`;
      const response = await this.request(url, {
        headers: {
          'x-api-key': this.config.apiKey,
          accept: 'application/json, text/csv',
        },
      });
      const rows = await parseResponseRows(response);
      if (rows.length === 0) {
        break;
      }
      results.push(...rows);
      if (rows.length < this.pageSize) {
        break;
      }
      offset += this.pageSize;
    }
    return results;
  }

  private async request(url: string, init: RequestInit, attempt = 0): Promise<Response> {
    try {
      const response = await fetch(url, init);
      if (!response.ok) {
        const body = await safeReadBody(response);
        if (shouldRetry(response.status) && attempt < this.maxRetries) {
          await this.backoff(attempt);
          return this.request(url, init, attempt + 1);
        }
        throw new FinraRequestError(
          `FINRA request failed with status ${response.status}`,
          response.status,
          body
        );
      }
      return response;
    } catch (err) {
      if (attempt < this.maxRetries) {
        await this.backoff(attempt);
        return this.request(url, init, attempt + 1);
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

function normalizeRow(row: Record<string, unknown>): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    map.set(key.toLowerCase(), value);
  }
  return map;
}

async function parseResponseRows(response: Response): Promise<Record<string, unknown>[]> {
  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();
  if (!body.trim()) {
    return [];
  }
  if (contentType.includes('application/json') || isLikelyJson(body)) {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) {
      return parsed as Record<string, unknown>[];
    }
    if (Array.isArray(parsed?.data)) {
      return parsed.data as Record<string, unknown>[];
    }
    throw new Error('Unexpected FINRA JSON response shape');
  }
  if (contentType.includes('text/csv') || contentType.includes('application/csv') || body.includes(',')) {
    return parseCsv(body);
  }
  throw new Error('Unsupported FINRA response content type');
}

function isLikelyJson(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [];
  }
  const headers = parseCsvLine(lines[0]!);
  const records: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]!);
    const record: Record<string, string> = {};
    headers.forEach((header, idx) => {
      record[header] = values[idx] ?? '';
    });
    records.push(record);
  }
  return records;
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

export function createFinraClient(): FinraClient {
  const apiKey = process.env.FINRA_API_KEY;
  if (!apiKey) {
    throw new Error('FINRA_API_KEY missing');
  }
  const baseUrl = process.env.FINRA_API_BASE ?? DEFAULT_BASE_URL;
  const pageSize = process.env.FINRA_PAGE_SIZE ? Number(process.env.FINRA_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  const maxRetries = process.env.FINRA_MAX_RETRIES ? Number(process.env.FINRA_MAX_RETRIES) : DEFAULT_MAX_RETRIES;
  const retryDelayMs = process.env.FINRA_RETRY_DELAY_MS
    ? Number(process.env.FINRA_RETRY_DELAY_MS)
    : DEFAULT_RETRY_DELAY_MS;
  return new FinraClient({ apiKey, baseUrl, pageSize, maxRetries, retryDelayMs });
}

export type NormalizedRow = ReturnType<typeof normalizeRow>;

export function createNormalizedRow(row: Record<string, unknown>): NormalizedRow {
  return normalizeRow(row);
}

