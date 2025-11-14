import { setTimeout as delay } from 'timers/promises';
import type {
  FinraClientConfig,
  TokenResponse,
  FinraPostRequest,
  CompareFilter,
  WeeklySummaryRecord,
  WeeklySummaryParams,
  SymbolWeeklyAtsOtc,
  ConsolidatedShortInterestRecord,
  ShortInterestParams,
  ShortInterestRangeParams,
  RegShoDailyRecord,
  RegShoDailyParams,
  ThresholdListRecord,
  ThresholdListParams,
  DatasetRecord,
} from './types';
import { FinraRequestError } from './types';

const DEFAULT_BASE_URL = 'https://api.finra.org';
const DEFAULT_TOKEN_URL =
  'https://ews.fip.finra.org/fip/rest/ews/oauth2/access_token?grant_type=client_credentials';
const DEFAULT_PAGE_SIZE = 5000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

/**
 * FINRA API Client
 *
 * Provides access to FINRA Query API datasets including:
 * - Weekly ATS and OTC summary data
 * - Consolidated short interest
 * - Reg SHO daily short sale volume
 * - Threshold list
 *
 * Supports both GET (simple queries) and POST (complex filtering) endpoints.
 */
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

  // ==========================================================================
  // OAuth2 Token Management
  // ==========================================================================

  private async getAccessToken(): Promise<string> {
    // Check if we have a valid token
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    // Request new token using OAuth2 client credentials flow
    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString('base64');

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
      },
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
    // Set expiry to 5 minutes before actual expiry
    this.tokenExpiry = Date.now() + (tokenData.expires_in - 300) * 1000;

    return this.accessToken;
  }

  // ==========================================================================
  // Core HTTP Methods (GET and POST)
  // ==========================================================================

  /**
   * Fetch dataset using GET with query parameters
   *
   * @param group - Dataset group (e.g., 'otcMarket')
   * @param dataset - Dataset name (e.g., 'weeklySummary')
   * @param params - Query parameters (limit, offset, fields)
   * @returns Array of records
   */
  protected async getDataset(
    group: string,
    dataset: string,
    params?: {
      limit?: number;
      offset?: number;
      fields?: string[];
      [key: string]: unknown;
    }
  ): Promise<DatasetRecord[]> {
    const searchParams = new URLSearchParams();

    if (params?.limit !== undefined) {
      searchParams.set('limit', String(params.limit));
    }
    if (params?.offset !== undefined) {
      searchParams.set('offset', String(params.offset));
    }
    if (params?.fields && params.fields.length > 0) {
      searchParams.set('fields', params.fields.join(','));
    }

    // Add any additional params
    for (const [key, value] of Object.entries(params ?? {})) {
      if (key !== 'limit' && key !== 'offset' && key !== 'fields' && value !== undefined) {
        searchParams.set(key, String(value));
      }
    }

    const url = `${this.baseUrl}/data/group/${encodeURIComponent(
      group
    )}/name/${encodeURIComponent(dataset)}?${searchParams.toString()}`;

    const accessToken = await this.getAccessToken();
    const response = await this.request(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    return parseResponseRows(response);
  }

  /**
   * Fetch dataset using POST with request body (supports complex filtering)
   *
   * @param group - Dataset group (e.g., 'otcMarket')
   * @param dataset - Dataset name (e.g., 'consolidatedShortInterest')
   * @param body - POST request body with filters, fields, etc.
   * @returns Array of records
   */
  protected async postDataset(
    group: string,
    dataset: string,
    body: FinraPostRequest
  ): Promise<DatasetRecord[]> {
    const url = `${this.baseUrl}/data/group/${encodeURIComponent(
      group
    )}/name/${encodeURIComponent(dataset)}`;

    const accessToken = await this.getAccessToken();
    const response = await this.request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    return parseResponseRows(response);
  }

  /**
   * Fetch dataset with automatic pagination
   *
   * @param group - Dataset group
   * @param dataset - Dataset name
   * @param body - POST request body
   * @param usePost - Use POST instead of GET (default: true for complex queries)
   * @returns Array of all records across pages
   */
  protected async fetchDatasetPaginated(
    group: string,
    dataset: string,
    body: FinraPostRequest,
    usePost = true
  ): Promise<DatasetRecord[]> {
    const results: DatasetRecord[] = [];
    let offset = 0;
    const limit = body.limit ?? this.pageSize;

    while (true) {
      const requestBody = { ...body, limit, offset };

      const rows = usePost
        ? await this.postDataset(group, dataset, requestBody)
        : await this.getDataset(group, dataset, requestBody as any);

      if (rows.length === 0) {
        break;
      }

      results.push(...rows);

      if (rows.length < limit) {
        break;
      }

      offset += limit;
    }

    return results;
  }

  /**
   * Core HTTP request with retry logic and token refresh
   *
   * Handles:
   * - 200 OK: success with content
   * - 204 No Content: success but no results (treated as empty array by parseResponseRows)
   * - 401 Unauthorized: token refresh and retry
   * - 429/5xx: retry with exponential backoff
   */
  private async request(
    url: string,
    init: RequestInit,
    attempt = 0,
    isRetryAfter401 = false
  ): Promise<Response> {
    try {
      const response = await fetch(url, init);

      // 204 No Content is a successful response (means no results found)
      if (response.status === 204) {
        return response;
      }

      if (!response.ok) {
        const body = await safeReadBody(response);

        // If 401 Unauthorized, token might be expired - clear it and retry once
        if (response.status === 401 && !isRetryAfter401) {
          this.accessToken = null;
          this.tokenExpiry = 0;
          const newToken = await this.getAccessToken();
          const newHeaders = {
            ...init.headers,
            Authorization: `Bearer ${newToken}`,
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

  // ==========================================================================
  // Weekly Summary Dataset Helpers
  // ==========================================================================

  /**
   * Query weekly summary dataset (current data, last ~12 months)
   *
   * @param request - POST request with filters
   * @returns Weekly summary records
   */
  async queryWeeklySummary(
    request: FinraPostRequest
  ): Promise<WeeklySummaryRecord[]> {
    return this.fetchDatasetPaginated(
      'otcMarket',
      'weeklySummary',
      request
    ) as Promise<WeeklySummaryRecord[]>;
  }

  /**
   * Query weekly summary historic dataset (data > 12 months old)
   *
   * **IMPORTANT FILTER RESTRICTIONS for weeklySummaryHistoric:**
   *
   * Per FINRA Query API documentation, this dataset only supports filtering on:
   * - `weekStartDate` (required - must specify exactly one of weekStartDate, historicalWeek, or historicalMonth)
   * - `historicalWeek` (alternative to weekStartDate)
   * - `historicalMonth` (alternative to weekStartDate)
   * - `tierIdentifier` (optional - T1, T2, or OTC)
   *
   * **NO other fields may be used in compareFilters for this dataset.**
   *
   * To filter by symbol or summaryTypeCode, you must:
   * 1. Use the allowed filters above in your POST request
   * 2. Filter the returned results client-side for additional constraints
   *
   * @param request - POST request with ONLY allowed filters (see above)
   * @returns Weekly summary records
   */
  async queryWeeklySummaryHistoric(
    request: FinraPostRequest
  ): Promise<WeeklySummaryRecord[]> {
    // Validate that only allowed fields are used in filters
    if (request.compareFilters) {
      const allowedFields = ['weekStartDate', 'historicalWeek', 'historicalMonth', 'tierIdentifier'];
      const invalidFilters = request.compareFilters.filter(
        f => !allowedFields.includes(f.fieldName)
      );
      if (invalidFilters.length > 0) {
        console.warn(
          `[FinraClient] weeklySummaryHistoric only supports filters on: ${allowedFields.join(', ')}. ` +
          `Invalid filters: ${invalidFilters.map(f => f.fieldName).join(', ')}. ` +
          `These will be sent but may cause API errors. Consider filtering results client-side instead.`
        );
      }
    }

    return this.fetchDatasetPaginated(
      'otcMarket',
      'weeklySummaryHistoric',
      request
    ) as Promise<WeeklySummaryRecord[]>;
  }

  /**
   * Get ATS and OTC weekly data for a specific symbol
   *
   * Fetches both ATS_W_SMBL and OTC_W_SMBL summary types for comparison.
   *
   * @param params - Symbol, date, tier filters
   * @returns Object with separate ATS and OTC records
   */
  async getSymbolWeeklyAtsAndOtc(
    params: WeeklySummaryParams
  ): Promise<SymbolWeeklyAtsOtc> {
    const { symbol, weekStartDate, tierIdentifier, limit = 100 } = params;

    if (!symbol) {
      throw new Error('symbol is required for getSymbolWeeklyAtsAndOtc');
    }

    const compareFilters: CompareFilter[] = [
      {
        compareType: 'EQUAL',
        fieldName: 'issueSymbolIdentifier',
        fieldValue: symbol,
      },
    ];

    if (weekStartDate) {
      compareFilters.push({
        compareType: 'EQUAL',
        fieldName: 'weekStartDate',
        fieldValue: weekStartDate,
      });
    }

    if (tierIdentifier) {
      compareFilters.push({
        compareType: 'EQUAL',
        fieldName: 'tierIdentifier',
        fieldValue: tierIdentifier,
      });
    }

    // Fetch all matching records
    const allRecords = await this.queryWeeklySummary({
      compareFilters,
      limit,
    });

    // Separate ATS and OTC records
    const atsRecord = allRecords.find(
      (r) => r.summaryTypeCode === 'ATS_W_SMBL'
    );
    const otcRecord = allRecords.find(
      (r) => r.summaryTypeCode === 'OTC_W_SMBL'
    );

    return {
      ats: atsRecord,
      otc: otcRecord,
    };
  }

  // ==========================================================================
  // Consolidated Short Interest Dataset Helpers
  // ==========================================================================

  /**
   * Get consolidated short interest for specific identifiers and optional date
   *
   * @param params - Identifiers (symbol/CUSIP) and settlement date
   * @returns Short interest records
   */
  async getConsolidatedShortInterest(
    params: ShortInterestParams
  ): Promise<ConsolidatedShortInterestRecord[]> {
    const { identifiers, settlementDate, limit } = params;

    const compareFilters: CompareFilter[] = [];

    // Note: symbolCode is the correct field name per FINRA metadata
    if (identifiers?.symbolCode) {
      compareFilters.push({
        compareType: 'EQUAL',
        fieldName: 'symbolCode',
        fieldValue: identifiers.symbolCode,
      });
    }

    if (settlementDate) {
      compareFilters.push({
        compareType: 'EQUAL',
        fieldName: 'settlementDate',
        fieldValue: settlementDate,
      });
    }

    return this.fetchDatasetPaginated('otcMarket', 'consolidatedShortInterest', {
      compareFilters,
      limit,
    }) as Promise<ConsolidatedShortInterestRecord[]>;
  }

  /**
   * Get consolidated short interest for a date range
   *
   * @param params - Identifiers and date range
   * @returns Short interest records
   */
  async getConsolidatedShortInterestRange(
    params: ShortInterestRangeParams
  ): Promise<ConsolidatedShortInterestRecord[]> {
    const { identifiers, startDate, endDate, limitPerCall } = params;

    const compareFilters: CompareFilter[] = [];

    // Note: symbolCode is the correct field name per FINRA metadata
    if (identifiers?.symbolCode) {
      compareFilters.push({
        compareType: 'EQUAL',
        fieldName: 'symbolCode',
        fieldValue: identifiers.symbolCode,
      });
    }

    // Add date range filters
    compareFilters.push({
      compareType: 'GREATER',
      fieldName: 'settlementDate',
      fieldValue: startDate,
    });
    compareFilters.push({
      compareType: 'LESSER',
      fieldName: 'settlementDate',
      fieldValue: endDate,
    });

    return this.fetchDatasetPaginated('otcMarket', 'consolidatedShortInterest', {
      compareFilters,
      limit: limitPerCall,
    }) as Promise<ConsolidatedShortInterestRecord[]>;
  }

  // ==========================================================================
  // Reg SHO Daily Short Sale Volume Dataset Helpers
  // ==========================================================================

  /**
   * Get Reg SHO daily short sale volume data
   *
   * @param params - Symbol, trade date, market code filters
   * @returns Reg SHO daily records
   */
  async getRegShoDaily(params: RegShoDailyParams): Promise<RegShoDailyRecord[]> {
    const { symbol, tradeReportDate, marketCode, limit } = params;

    const compareFilters: CompareFilter[] = [];

    if (symbol) {
      compareFilters.push({
        compareType: 'EQUAL',
        fieldName: 'securitiesInformationProcessorSymbolIdentifier',
        fieldValue: symbol,
      });
    }

    if (tradeReportDate) {
      compareFilters.push({
        compareType: 'EQUAL',
        fieldName: 'tradeReportDate',
        fieldValue: tradeReportDate,
      });
    }

    if (marketCode) {
      compareFilters.push({
        compareType: 'EQUAL',
        fieldName: 'marketCode',
        fieldValue: marketCode,
      });
    }

    return this.fetchDatasetPaginated('otcMarket', 'regShoDaily', {
      compareFilters,
      limit,
    }) as Promise<RegShoDailyRecord[]>;
  }

  // ==========================================================================
  // Threshold List Dataset Helpers
  // ==========================================================================

  /**
   * Get Reg SHO threshold list data
   *
   * @param params - Symbol, trade date, threshold flag filters
   * @returns Threshold list records
   */
  async getThresholdList(params: ThresholdListParams): Promise<ThresholdListRecord[]> {
    const { symbol, tradeDate, onlyOnThreshold = true, limit } = params;

    const compareFilters: CompareFilter[] = [];

    if (symbol) {
      compareFilters.push({
        compareType: 'EQUAL',
        fieldName: 'issueSymbolIdentifier',
        fieldValue: symbol,
      });
    }

    if (tradeDate) {
      compareFilters.push({
        compareType: 'EQUAL',
        fieldName: 'tradeDate',
        fieldValue: tradeDate,
      });
    }

    if (onlyOnThreshold) {
      compareFilters.push({
        compareType: 'EQUAL',
        fieldName: 'regShoThresholdFlag',
        fieldValue: 'Y',
      });
    }

    return this.fetchDatasetPaginated('otcMarket', 'thresholdList', {
      compareFilters,
      limit,
    }) as Promise<ThresholdListRecord[]>;
  }

  // ==========================================================================
  // Legacy Compatibility Methods (Deprecated)
  // ==========================================================================

  /**
   * @deprecated Use getConsolidatedShortInterest instead
   *
   * Fetch short interest for a specific settlement date
   */
  async fetchShortInterest(settlementDate: string): Promise<Record<string, unknown>[]> {
    return this.getConsolidatedShortInterest({
      settlementDate,
    });
  }

  /**
   * @deprecated Use getConsolidatedShortInterestRange instead
   *
   * Fetch short interest for a date range with optional identifiers
   */
  async fetchShortInterestRange(
    startDate: string,
    endDate: string,
    identifiers?: { cusips?: string[]; symbols?: string[] }
  ): Promise<Record<string, unknown>[]> {
    const cusips = identifiers?.cusips || [];
    const symbols = identifiers?.symbols || [];

    if (cusips.length === 0 && symbols.length === 0) {
      console.warn(
        '[FinraClient] fetchShortInterestRange without identifiers may be slow'
      );
      return this.getConsolidatedShortInterestRange({
        startDate,
        endDate,
      });
    }

    // Fetch for all identifiers and combine
    const allRows: Record<string, unknown>[] = [];

    for (const cusip of cusips) {
      const rows = await this.getConsolidatedShortInterestRange({
        identifiers: { cusip },
        startDate,
        endDate,
      });
      allRows.push(...rows);
    }

    for (const symbol of symbols) {
      const rows = await this.getConsolidatedShortInterestRange({
        identifiers: { issueSymbolIdentifier: symbol },
        startDate,
        endDate,
      });
      allRows.push(...rows);
    }

    return allRows;
  }

  /**
   * @deprecated Use getSymbolWeeklyAtsAndOtc or queryWeeklySummary instead
   *
   * Fetch ATS weekly data for a specific week end date
   */
  async fetchATSWeekly(weekEndDate: string): Promise<Record<string, unknown>[]> {
    // Note: Old API used weekEndDate, new API uses weekStartDate
    // This is a best-effort conversion - caller should migrate to new methods
    return this.queryWeeklySummary({
      compareFilters: [
        {
          compareType: 'equal',
          fieldName: 'weekStartDate',
          fieldValue: weekEndDate,
        },
      ],
    });
  }

  /**
   * @deprecated Use queryWeeklySummary with proper filters instead
   *
   * Fetch ATS weekly data for a date range with optional identifiers
   */
  async fetchATSWeeklyRange(
    startDate: string,
    endDate: string,
    identifiers?: { cusips?: string[]; symbols?: string[] }
  ): Promise<Record<string, unknown>[]> {
    const cusips = identifiers?.cusips || [];
    const symbols = identifiers?.symbols || [];

    if (cusips.length === 0 && symbols.length === 0) {
      console.warn(
        '[FinraClient] fetchATSWeeklyRange without identifiers may be slow'
      );
      return this.queryWeeklySummary({
        compareFilters: [
          {
            compareType: 'GREATER',
            fieldName: 'weekStartDate',
            fieldValue: startDate,
          },
          {
            compareType: 'LESSER',
            fieldName: 'weekStartDate',
            fieldValue: endDate,
          },
        ],
      });
    }

    // Fetch for all identifiers and combine
    const allRows: Record<string, unknown>[] = [];

    for (const cusip of cusips) {
      const rows = await this.queryWeeklySummary({
        compareFilters: [
          {
            compareType: 'EQUAL',
            fieldName: 'cusip',
            fieldValue: cusip,
          },
          {
            compareType: 'GREATER',
            fieldName: 'weekStartDate',
            fieldValue: startDate,
          },
          {
            compareType: 'LESSER',
            fieldName: 'weekStartDate',
            fieldValue: endDate,
          },
        ],
      });
      allRows.push(...rows);
    }

    for (const symbol of symbols) {
      const rows = await this.queryWeeklySummary({
        compareFilters: [
          {
            compareType: 'EQUAL',
            fieldName: 'issueSymbolIdentifier',
            fieldValue: symbol,
          },
          {
            compareType: 'GREATER',
            fieldName: 'weekStartDate',
            fieldValue: startDate,
          },
          {
            compareType: 'LESSER',
            fieldName: 'weekStartDate',
            fieldValue: endDate,
          },
        ],
      });
      allRows.push(...rows);
    }

    return allRows;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

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

/**
 * Parse FINRA API response into dataset records
 *
 * Handles:
 * - 204 No Content: returns empty array (per FINRA Query API docs)
 * - JSON arrays: direct array of records
 * - JSON objects: with `data` property containing array
 * - CSV: parsed into array of record objects
 * - Empty body: returns empty array
 */
async function parseResponseRows(response: Response): Promise<DatasetRecord[]> {
  // Handle 204 No Content - FINRA returns this when no results found
  if (response.status === 204) {
    return [];
  }

  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();

  if (!body.trim()) {
    return [];
  }

  if (contentType.includes('application/json') || isLikelyJson(body)) {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) {
      return parsed as DatasetRecord[];
    }
    if (Array.isArray(parsed?.data)) {
      return parsed.data as DatasetRecord[];
    }
    throw new Error('Unexpected FINRA JSON response shape');
  }

  if (
    contentType.includes('text/csv') ||
    contentType.includes('application/csv') ||
    body.includes(',')
  ) {
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

/**
 * Create a normalized row map for case-insensitive field lookups
 *
 * @param row - Raw row data
 * @returns Map with lowercase keys
 */
export function createNormalizedRow(
  row: Record<string, unknown>
): Map<string, unknown> {
  return normalizeRow(row);
}

/**
 * Factory function to create a FINRA client from environment variables
 *
 * @param configOverrides - Optional config overrides
 * @returns Configured FinraClient instance
 */
export function createFinraClient(
  configOverrides?: Partial<FinraClientConfig>
): FinraClient {
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
  const pageSize = process.env.FINRA_PAGE_SIZE
    ? Number(process.env.FINRA_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  const maxRetries = process.env.FINRA_MAX_RETRIES
    ? Number(process.env.FINRA_MAX_RETRIES)
    : DEFAULT_MAX_RETRIES;
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
    ...configOverrides,
  });
}

// Re-export FinraRequestError for convenience
export { FinraRequestError };
