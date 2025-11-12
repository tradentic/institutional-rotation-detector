import { setTimeout as delay } from 'timers/promises';

export interface FinraClientConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  tokenUrl?: string;
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
const DEFAULT_TOKEN_URL = 'https://ews.fip.finra.org/fip/rest/ews/oauth2/access_token';
const DEFAULT_PAGE_SIZE = 5000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class FinraClient {
  private readonly baseUrl: string;
  private readonly tokenUrl: string;
  private readonly pageSize: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(private readonly config: FinraClientConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.tokenUrl = config.tokenUrl ?? DEFAULT_TOKEN_URL;
    this.pageSize = config.pageSize ?? DEFAULT_PAGE_SIZE;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  private async getAccessToken(): Promise<string> {
    // Check if we have a valid token
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    // Request new token using OAuth2 client credentials flow
    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      const body = await safeReadBody(response);
      throw new FinraRequestError(
        `FINRA token request failed with status ${response.status}`,
        response.status,
        body
      );
    }

    const tokenData: TokenResponse = await response.json();
    this.accessToken = tokenData.access_token;
    // Set expiry to 5 minutes before actual expiry to ensure we refresh before it expires
    this.tokenExpiry = Date.now() + (tokenData.expires_in - 300) * 1000;

    return this.accessToken;
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

      // Get fresh access token (will reuse if still valid)
      const accessToken = await this.getAccessToken();

      const response = await this.request(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json, text/csv',
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

  private async request(url: string, init: RequestInit, attempt = 0, isRetryAfter401 = false): Promise<Response> {
    try {
      const response = await fetch(url, init);
      if (!response.ok) {
        const body = await safeReadBody(response);

        // If 401 Unauthorized, token might be expired - clear it and retry once
        if (response.status === 401 && !isRetryAfter401) {
          this.accessToken = null;
          this.tokenExpiry = 0;
          // Get new token and update the Authorization header
          const newToken = await this.getAccessToken();
          const newHeaders = {
            ...init.headers,
            'Authorization': `Bearer ${newToken}`,
          };
          return this.request(url, { ...init, headers: newHeaders }, attempt, true);
        }

        if (shouldRetry(response.status) && attempt < this.maxRetries) {
          await this.backoff(attempt);
          return this.request(url, init, attempt + 1, isRetryAfter401);
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
        return this.request(url, init, attempt + 1, isRetryAfter401);
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
  const clientId = process.env.FINRA_API_CLIENT;
  const clientSecret = process.env.FINRA_API_SECRET;

  if (!clientId) {
    throw new Error('FINRA_API_CLIENT environment variable is required');
  }
  if (!clientSecret) {
    throw new Error('FINRA_API_SECRET environment variable is required');
  }

  const baseUrl = process.env.FINRA_API_BASE ?? DEFAULT_BASE_URL;
  const tokenUrl = process.env.FINRA_TOKEN_URL ?? DEFAULT_TOKEN_URL;
  const pageSize = process.env.FINRA_PAGE_SIZE ? Number(process.env.FINRA_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  const maxRetries = process.env.FINRA_MAX_RETRIES ? Number(process.env.FINRA_MAX_RETRIES) : DEFAULT_MAX_RETRIES;
  const retryDelayMs = process.env.FINRA_RETRY_DELAY_MS
    ? Number(process.env.FINRA_RETRY_DELAY_MS)
    : DEFAULT_RETRY_DELAY_MS;

  return new FinraClient({
    clientId,
    clientSecret,
    baseUrl,
    tokenUrl,
    pageSize,
    maxRetries,
    retryDelayMs,
  });
}

export type NormalizedRow = ReturnType<typeof normalizeRow>;

export function createNormalizedRow(row: Record<string, unknown>): NormalizedRow {
  return normalizeRow(row);
}

