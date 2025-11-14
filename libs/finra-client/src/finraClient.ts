import { setTimeout as sleep } from 'timers/promises';
import type {
  FinraClientConfig,
  TokenResponse,
  FinraPostRequest,
  CompareFilter,
  CompareType,
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
  RateLimiter,
  Cache,
  CircuitBreaker,
  Logger,
  MetricsSink,
  HttpTransport,
  QueryParams,
  RequestOptions,
  CacheableHelperOptions,
} from './types';
import { ApiRequestError, FinraRequestError, NoopRateLimiter } from './types';

type InternalApiError = ApiRequestError & { __handled?: boolean };

const DEFAULT_BASE_URL = 'https://api.finra.org';
const DEFAULT_TOKEN_URL =
  'https://ews.fip.finra.org/fip/rest/ews/oauth2/access_token?grant_type=client_credentials';
const DEFAULT_PAGE_SIZE = 5000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_RETRY_DELAY_MS = 500;
const DEFAULT_TIMEOUT_MS = 30_000;

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
  private readonly baseRetryDelayMs: number;
  private readonly timeoutMs: number;
  private readonly rateLimiter: RateLimiter;
  private readonly cache?: Cache;
  private readonly circuitBreaker?: CircuitBreaker;
  private readonly logger?: Logger;
  private readonly metrics?: MetricsSink;
  private readonly transport: HttpTransport;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(private readonly config: FinraClientConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.tokenUrl = config.tokenUrl ?? DEFAULT_TOKEN_URL;
    this.pageSize = config.pageSize ?? DEFAULT_PAGE_SIZE;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseRetryDelayMs = config.baseRetryDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.rateLimiter = config.rateLimiter ?? new NoopRateLimiter();
    this.cache = config.cache;
    this.circuitBreaker = config.circuitBreaker;
    this.logger = config.logger;
    this.metrics = config.metrics;
    this.transport = config.transport ?? ((url, init) => fetch(url, init));
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

    let response: Response;
    try {
      response = await this.transport(this.tokenUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      });
    } catch (error) {
      throw new FinraRequestError(
        `FINRA token request failed: ${(error as Error)?.message ?? 'unknown error'}`,
        0,
      );
    }

    if (!response.ok) {
      const body = await safeReadBody(response);
      throw new FinraRequestError(
        `FINRA token request failed with status ${response.status}`,
        response.status,
        body,
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
  protected async getDataset<T extends DatasetRecord = DatasetRecord>(
    group: string,
    dataset: string,
    params?: {
      limit?: number;
      offset?: number;
      fields?: string[];
      [key: string]: unknown;
    },
    requestOptions?: Pick<RequestOptions, 'cacheTtlMs' | 'cacheKey'>,
  ): Promise<T[]> {
    const query: QueryParams = {};
    if (params?.limit !== undefined) {
      query.limit = params.limit;
    }
    if (params?.offset !== undefined) {
      query.offset = params.offset;
    }
    if (params?.fields && params.fields.length > 0) {
      query.fields = params.fields.join(',');
    }

    for (const [key, value] of Object.entries(params ?? {})) {
      if (['limit', 'offset', 'fields'].includes(key)) {
        continue;
      }
      if (value !== undefined) {
        query[key] = value as string | number | boolean | string[] | number[];
      }
    }

    return this.requestDatasetWithAuth<T[]>(
      this.buildDatasetPath(group, dataset),
      { method: 'GET', params: query, cacheTtlMs: requestOptions?.cacheTtlMs },
      parseResponseRows,
    );
  }

  /**
   * Fetch dataset using POST with request body (supports complex filtering)
   *
   * @param group - Dataset group (e.g., 'otcMarket')
   * @param dataset - Dataset name (e.g., 'consolidatedShortInterest')
   * @param body - POST request body with filters, fields, etc.
   * @returns Array of records
   */
  protected async postDataset<T extends DatasetRecord = DatasetRecord>(
    group: string,
    dataset: string,
    body: FinraPostRequest,
    requestOptions?: Pick<RequestOptions, 'cacheTtlMs' | 'cacheKey'>,
  ): Promise<T[]> {
    // Normalize compareFilters to uppercase for FINRA API
    const normalizedBody = {
      ...body,
      compareFilters: normalizeCompareFilters(body.compareFilters),
    };
    return this.requestDatasetWithAuth<T[]>(
      this.buildDatasetPath(group, dataset),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(normalizedBody),
        cacheTtlMs: requestOptions?.cacheTtlMs,
        cacheKey: requestOptions?.cacheKey,
      },
      parseResponseRows,
    );
  }

  private async requestDatasetWithAuth<T>(
    path: string,
    options: RequestOptions,
    parser: (response: Response) => Promise<T>,
    retriedAfter401 = false,
  ): Promise<T> {
    const accessToken = await this.getAccessToken();
    const headers: HeadersInit = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...options.headers,
    };

    try {
      return await this.requestWithRetries(path, { ...options, headers }, parser);
    } catch (error) {
      if (error instanceof FinraRequestError && error.status === 401 && !retriedAfter401) {
        this.accessToken = null;
        this.tokenExpiry = 0;
        return this.requestDatasetWithAuth(path, options, parser, true);
      }
      throw error;
    }
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
  protected async fetchDatasetPaginated<T extends DatasetRecord = DatasetRecord>(
    group: string,
    dataset: string,
    body: FinraPostRequest,
    usePost = true,
    requestOptions?: CacheableHelperOptions,
  ): Promise<T[]> {
    const results: T[] = [];
    let offset = 0;
    const limit = body.limit ?? this.pageSize;

    while (true) {
      const requestBody = { ...body, limit, offset };

      const datasetPath = this.buildDatasetPath(group, dataset);
      const cacheKey = requestOptions?.cacheTtlMs
        ? this.computeRequestBodyCacheKey(datasetPath, requestBody)
        : undefined;

      const rows = usePost
        ? await this.postDataset<T>(group, dataset, requestBody, {
            cacheTtlMs: requestOptions?.cacheTtlMs,
            cacheKey,
          })
        : await this.getDataset<T>(group, dataset, requestBody as any, {
            cacheTtlMs: requestOptions?.cacheTtlMs,
          });

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

  private async requestWithRetries<T>(
    path: string,
    options: RequestOptions,
    parser: (response: Response) => Promise<T>,
  ): Promise<T> {
    const method = (options.method ?? 'GET').toUpperCase();
    const url = this.buildUrl(path, options.params);
    const endpoint = path;
    const timeout = options.timeoutMs ?? this.timeoutMs;
    const effectiveTimeout = timeout > 0 ? timeout : undefined;

    const explicitCacheKey = options.cacheKey;
    const cacheEligible = Boolean(
      options.cacheTtlMs &&
        options.cacheTtlMs > 0 &&
        this.cache &&
        (method === 'GET' || explicitCacheKey)
    );
    const cacheKey = cacheEligible
      ? explicitCacheKey ?? this.computeCacheKey(url)
      : undefined;

    if (cacheEligible && cacheKey) {
      const cached = await this.cache!.get<T>(cacheKey);
      if (cached !== undefined) {
        await this.metrics?.recordRequest({
          endpoint,
          method,
          durationMs: 0,
          status: 200,
          retries: 0,
          cacheHit: true,
        });
        return cached;
      }
    }

    const { params: _p, cacheTtlMs, timeoutMs, body, cacheKey: _cacheKey, ...rest } = options;
    const init: RequestInit = {
      ...rest,
      method,
      body: body ?? null,
    };

    const key = this.buildRequestKey(method, endpoint);

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const start = Date.now();
      try {
        await this.circuitBreaker?.beforeRequest(key);
        await this.rateLimiter.throttle(key);

        const response = await this.executeHttp(url, init, effectiveTimeout);
        if (!response.ok) {
          const retryAfterMs = parseRetryAfter(response);
          const body = await safeReadBody(response);
          const error = new FinraRequestError(
            `FINRA request failed with status ${response.status}`,
            response.status,
            body,
            retryAfterMs,
          );
          await this.handleFailure(key, error, endpoint, method, start, attempt);

          if (!this.shouldRetry(error.status) || attempt === this.maxRetries) {
            (error as InternalApiError).__handled = true;
            throw error;
          }

          await this.waitForRetry(error, attempt, method, endpoint);
          continue;
        }

        const data = await parser(response);
        await this.rateLimiter.onSuccess?.(key);
        await this.circuitBreaker?.onSuccess?.(key);

        await this.metrics?.recordRequest({
          endpoint,
          method,
          durationMs: Date.now() - start,
          status: response.status,
          retries: attempt,
          cacheHit: false,
        });

        if (cacheEligible && cacheKey) {
          await this.cache!.set(cacheKey, data, cacheTtlMs);
        }

        return data;
      } catch (err) {
        const error: InternalApiError = err instanceof ApiRequestError
          ? (err as InternalApiError)
          : new FinraRequestError(
              err instanceof Error ? err.message : 'FINRA request failed',
              0,
            );

        if (!error.__handled) {
          await this.handleFailure(key, error, endpoint, method, start, attempt);
          error.__handled = true;
        }

        if (!this.shouldRetry(error.status) || attempt === this.maxRetries) {
          throw error;
        }

        await this.waitForRetry(error, attempt, method, endpoint);
      }
    }

    throw new FinraRequestError('FINRA request exceeded retries', 0);
  }

  private async executeHttp(url: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
    if (!timeoutMs) {
      try {
        return await this.transport(url, init);
      } catch (error) {
        throw new FinraRequestError(
          `FINRA request failed: ${(error as Error)?.message ?? 'network error'}`,
          0,
        );
      }
    }

    const controller = new AbortController();
    const originalSignal = init.signal ?? undefined;
    const abortHandler = () => controller.abort();

    if (originalSignal) {
      if (originalSignal.aborted) {
        controller.abort(originalSignal.reason);
      } else {
        originalSignal.addEventListener('abort', abortHandler);
      }
    }

    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await this.transport(url, { ...init, signal: controller.signal });
    } catch (error) {
      throw new FinraRequestError(
        `FINRA request failed: ${(error as Error)?.message ?? 'network error'}`,
        0,
      );
    } finally {
      clearTimeout(timeoutId);
      if (originalSignal) {
        originalSignal.removeEventListener('abort', abortHandler);
      }
    }
  }

  private buildDatasetPath(group: string, dataset: string): string {
    return `/data/group/${encodeURIComponent(group)}/name/${encodeURIComponent(dataset)}`;
  }

  private buildUrl(path: string, params?: QueryParams): string {
    const url = new URL(path, this.baseUrl);
    if (params) {
      const entries = Object.entries(params).filter(([, value]) => value !== undefined);
      entries.sort(([a], [b]) => a.localeCompare(b));
      for (const [key, value] of entries) {
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private computeCacheKey(url: string): string {
    return `finra:${url}`;
  }

  private computeRequestBodyCacheKey(path: string, payload: unknown): string {
    return `finra:${path}:${this.stableStringify(payload)}`;
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }

    const entries = Object.entries(value as Record<string, unknown>).sort((a, b) =>
      a[0].localeCompare(b[0])
    );

    return `{${entries
      .map(([key, val]) => `${JSON.stringify(key)}:${this.stableStringify(val)}`)
      .join(',')}}`;
  }

  private buildRequestKey(method: string, endpoint: string): string {
    return `${method.toUpperCase()}:${endpoint}`;
  }

  private shouldRetry(status: number): boolean {
    if (status === 0 || status === 429) {
      return true;
    }
    if (status === 500 || status === 502 || status === 503 || status === 504) {
      return true;
    }
    return false;
  }

  private async handleFailure(
    key: string,
    error: ApiRequestError,
    endpoint: string,
    method: string,
    start: number,
    attempt: number,
  ): Promise<void> {
    await this.rateLimiter.onError?.(key, error);
    await this.circuitBreaker?.onFailure?.(key, error);
    await this.metrics?.recordRequest({
      endpoint,
      method,
      durationMs: Date.now() - start,
      status: error.status,
      retries: attempt,
      cacheHit: false,
    });
  }

  private async waitForRetry(
    error: ApiRequestError,
    attempt: number,
    method: string,
    endpoint: string,
  ): Promise<void> {
    const delayMs = error.retryAfterMs && error.retryAfterMs > 0
      ? error.retryAfterMs
      : computeBackoffWithJitter(this.baseRetryDelayMs, attempt);

    this.logger?.warn?.(
      `[FinraClient] Retrying ${method} ${endpoint} after ${delayMs}ms due to status ${error.status}`,
    );

    await sleep(delayMs);
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
    request: FinraPostRequest,
    options?: CacheableHelperOptions,
  ): Promise<WeeklySummaryRecord[]> {
    return this.fetchDatasetPaginated<WeeklySummaryRecord>(
      'otcMarket',
      'weeklySummary',
      request,
      true,
      options,
    );
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
    request: FinraPostRequest,
    options?: CacheableHelperOptions,
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

    return this.fetchDatasetPaginated<WeeklySummaryRecord>(
      'otcMarket',
      'weeklySummaryHistoric',
      request,
      true,
      options,
    );
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
    params: WeeklySummaryParams,
    options?: CacheableHelperOptions,
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
    const allRecords = await this.queryWeeklySummary(
      {
        compareFilters,
        limit,
      },
      options,
    );

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
    params: ShortInterestParams,
    options?: CacheableHelperOptions,
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

    return this.fetchDatasetPaginated<ConsolidatedShortInterestRecord>(
      'otcMarket',
      'consolidatedShortInterest',
      {
        compareFilters,
        limit,
      },
      true,
      options,
    );
  }

  /**
   * Get consolidated short interest for a date range
   *
   * @param params - Identifiers and date range
   * @returns Short interest records
   */
  async getConsolidatedShortInterestRange(
    params: ShortInterestRangeParams,
    options?: CacheableHelperOptions,
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

    return this.fetchDatasetPaginated<ConsolidatedShortInterestRecord>(
      'otcMarket',
      'consolidatedShortInterest',
      {
        compareFilters,
        limit: limitPerCall,
      },
      true,
      options,
    );
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
  async getRegShoDaily(
    params: RegShoDailyParams,
    options?: CacheableHelperOptions,
  ): Promise<RegShoDailyRecord[]> {
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

    return this.fetchDatasetPaginated<RegShoDailyRecord>(
      'otcMarket',
      'regShoDaily',
      {
        compareFilters,
        limit,
      },
      true,
      options,
    );
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
  async getThresholdList(
    params: ThresholdListParams,
    options?: CacheableHelperOptions,
  ): Promise<ThresholdListRecord[]> {
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

    return this.fetchDatasetPaginated<ThresholdListRecord>(
      'otcMarket',
      'thresholdList',
      {
        compareFilters,
        limit,
      },
      true,
      options,
    );
  }

  // ==========================================================================
  // Legacy Compatibility Methods (Deprecated)
  // ==========================================================================

  /**
   * @deprecated Use getConsolidatedShortInterest instead
   *
   * Fetch short interest for a specific settlement date
   */
  async fetchShortInterest(
    settlementDate: string
  ): Promise<ConsolidatedShortInterestRecord[]> {
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
  ): Promise<ConsolidatedShortInterestRecord[]> {
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
    if (cusips.length > 0) {
      console.warn(
        '[FinraClient] consolidatedShortInterest does not support CUSIP filtering; provided cusips will be ignored.'
      );
    }

    const allRows: ConsolidatedShortInterestRecord[] = [];

    for (const symbol of symbols) {
      const rows = await this.getConsolidatedShortInterestRange({
        identifiers: { symbolCode: symbol },
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
  async fetchATSWeekly(weekEndDate: string): Promise<WeeklySummaryRecord[]> {
    // Note: Old API used weekEndDate, new API uses weekStartDate
    // This is a best-effort conversion - caller should migrate to new methods
    return this.queryWeeklySummary({
      compareFilters: [
        {
          compareType: 'EQUAL',
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
  ): Promise<WeeklySummaryRecord[]> {
    const cusips = identifiers?.cusips || [];
    const symbols = identifiers?.symbols || [];

    if (cusips.length > 0) {
      console.warn(
        '[FinraClient] weeklySummary dataset does not expose CUSIP filters; provided cusips will be ignored.'
      );
    }

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
    const allRows: WeeklySummaryRecord[] = [];

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

/**
 * Normalize compareFilters to use uppercase compareType values
 *
 * FINRA's historical datasets require uppercase compareType (EQUAL, GREATER, LESSER).
 * This function ensures backwards compatibility by accepting both lowercase and uppercase,
 * but always sends uppercase to the API.
 *
 * @param filters - CompareFilter array (may be undefined)
 * @returns Normalized filters with uppercase compareType, or undefined if input was undefined
 */
function normalizeCompareFilters(filters?: CompareFilter[]): CompareFilter[] | undefined {
  if (!filters) return undefined;
  return filters.map((f) => ({
    ...f,
    compareType: f.compareType.toUpperCase() as CompareType,
  }));
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
async function parseResponseRows<T extends DatasetRecord = DatasetRecord>(
  response: Response
): Promise<T[]> {
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
      return parsed as T[];
    }
    if (Array.isArray(parsed?.data)) {
      return parsed.data as T[];
    }
    throw new Error('Unexpected FINRA JSON response shape');
  }

  if (
    contentType.includes('text/csv') ||
    contentType.includes('application/csv') ||
    body.includes(',')
  ) {
    return parseCsv(body) as T[];
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

function computeBackoffWithJitter(baseMs: number, attempt: number): number {
  const exp = baseMs * 2 ** attempt;
  const jitter = Math.random() * baseMs;
  return exp + jitter;
}

function parseRetryAfter(res: Response): number | undefined {
  const header = res.headers.get('retry-after');
  if (!header) {
    return undefined;
  }

  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return seconds * 1000;
  }

  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    const diff = date - Date.now();
    return diff > 0 ? diff : 0;
  }

  return undefined;
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
  const pageSize = parseNumberOrDefault(process.env.FINRA_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const maxRetries = parseNumberOrDefault(process.env.FINRA_MAX_RETRIES, DEFAULT_MAX_RETRIES);
  const baseRetryDelayMs = parseNumberOrDefault(
    process.env.FINRA_BASE_RETRY_DELAY_MS ?? process.env.FINRA_RETRY_DELAY_MS,
    DEFAULT_BASE_RETRY_DELAY_MS,
  );
  const timeoutMs = parseNumberOrDefault(process.env.FINRA_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  return new FinraClient({
    clientId,
    clientSecret,
    baseUrl,
    tokenUrl,
    pageSize,
    maxRetries,
    baseRetryDelayMs,
    timeoutMs,
    ...configOverrides,
  });
}

// Re-export FinraRequestError for convenience
export { FinraRequestError };

function parseNumberOrDefault(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
