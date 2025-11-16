import type { HttpClient } from '@airnub/resilient-http-core';

/**
 * FINRA API Client Types
 *
 * Type definitions for FINRA Query API datasets and request/response structures.
 */

// ============================================================================
// Core Client Configuration
// ============================================================================

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export interface RateLimiter {
  throttle(key?: string): Promise<void>;
  onSuccess?(key?: string): void | Promise<void>;
  onError?(key: string | undefined, error: ApiRequestError): void | Promise<void>;
}

export class NoopRateLimiter implements RateLimiter {
  async throttle(): Promise<void> {
    // no-op
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onSuccess?(): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onError?(): void {}
}

export interface Cache {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete?(key: string): Promise<void>;
}

export class InMemoryCache implements Cache {
  private store = new Map<string, { value: unknown; expiresAt?: number }>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    const expiresAt = ttlMs ? Date.now() + ttlMs : undefined;
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

export interface CircuitBreaker {
  beforeRequest(key?: string): Promise<void>;
  onSuccess(key?: string): void | Promise<void>;
  onFailure(key: string | undefined, err: ApiRequestError): void | Promise<void>;
}

export interface Logger {
  debug?(msg: string, meta?: unknown): void;
  info?(msg: string, meta?: unknown): void;
  warn?(msg: string, meta?: unknown): void;
  error?(msg: string, meta?: unknown): void;
}

export interface MetricsSink {
  recordRequest(options: {
    endpoint: string;
    method: string;
    durationMs: number;
    status: number;
    retries: number;
    cacheHit: boolean;
  }): void | Promise<void>;
}

export interface HttpTransport {
  (url: string, init: RequestInit): Promise<Response>;
}

export type QueryParams = Record<string, string | number | boolean | string[] | number[]>;

export interface RequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  method?: string;
  body?: BodyInit | null;
  params?: QueryParams;
  cacheTtlMs?: number;
  cacheKey?: string;
  timeoutMs?: number;
}

export interface CacheableHelperOptions {
  cacheTtlMs?: number;
}

export interface FinraClientConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  tokenUrl?: string;
  pageSize?: number;
  maxRetries?: number;
  baseRetryDelayMs?: number;
  timeoutMs?: number;
  rateLimiter?: RateLimiter;
  cache?: Cache;
  circuitBreaker?: CircuitBreaker;
  logger?: Logger;
  metrics?: MetricsSink;
  transport?: HttpTransport;
  /** Optional resilient-http-core client to reuse instead of raw fetch. */
  httpClient?: HttpClient;
}

// ============================================================================
// OAuth2 Token Types
// ============================================================================

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class FinraRequestError extends ApiRequestError {
  constructor(message: string, status: number, responseBody?: string, retryAfterMs?: number) {
    super(message, status, responseBody, retryAfterMs);
    this.name = 'FinraRequestError';
  }
}

// ============================================================================
// Query API Request Types
// ============================================================================

/**
 * Compare types as documented in FINRA Query API.
 *
 * Accepts both lowercase and uppercase for backwards compatibility,
 * but will be normalized to UPPERCASE in request payloads.
 * FINRA's historical datasets require uppercase compareType values.
 */
export type CompareType =
  | 'equal' | 'greater' | 'lesser'
  | 'EQUAL' | 'GREATER' | 'LESSER';

export interface CompareFilter {
  compareType: CompareType;
  fieldName: string;
  fieldValue: string | number;
  description?: string;
}

export interface DateRangeFilter {
  fieldName: string;
  startDate: string;
  endDate: string;
}

export interface DomainFilter {
  fieldName: string;
  values: string[];
}

export interface FinraPostRequest {
  limit?: number;
  offset?: number;
  fields?: string[];
  compareFilters?: CompareFilter[];
  dateRangeFilters?: DateRangeFilter[];
  domainFilters?: DomainFilter[];
  sortFields?: string[];
  format?: 'application/json' | 'text/plain';
  delimiter?: string;
  quoteValues?: boolean;
}

// ============================================================================
// Generic Dataset Base Type
// ============================================================================

export interface DatasetRecord {
  [key: string]: unknown;
}

// ============================================================================
// Weekly Summary Dataset Types
// ============================================================================

/**
 * Weekly Summary Record - matches FINRA otcMarket/weeklySummary dataset schema
 *
 * This dataset provides OTC Transparency Weekly Summary data. Applies to both
 * current (weeklySummary) and historical (weeklySummaryHistoric) datasets.
 */
export interface WeeklySummaryRecord extends DatasetRecord {
  /** Symbol identifier assigned by NASDAQ or FINRA */
  issueSymbolIdentifier: string;
  /** Company name associated with the symbol */
  issueName: string;
  /** Firm CRD Number */
  firmCRDNumber: number | null;
  /** ATS/OTC identifier */
  MPID: string | null;
  /** Company name of the ATS/OTC or De Minimis Firm */
  marketParticipantName: string | null;
  /** T1, T2, or OTC */
  tierIdentifier: string;
  /** NMS Tier 1, NMS Tier 2, or OTCE description */
  tierDescription: string;
  /** Report Start Date (Monday) - yyyy-MM-dd */
  summaryStartDate: string;
  /** Aggregate weekly total number of trades */
  totalWeeklyTradeCount: number;
  /** Aggregate weekly total number of shares */
  totalWeeklyShareQuantity: number;
  /** Product Type */
  productTypeCode: string;
  /** Report Type Identifier (e.g., ATS_W_SMBL, OTC_W_SMBL, OTC_W_SMBL_FIRM) */
  summaryTypeCode: string;
  /** Partition Key - the first business day of the week (Monday) - yyyy-MM-dd */
  weekStartDate: string;
  /** Most recent date data was updated - yyyy-MM-dd */
  lastUpdateDate: string;
  /** The initial publish date - yyyy-MM-dd */
  initialPublishedDate: string;
  /** Last time a firm sent an update - yyyy-MM-dd */
  lastReportedDate: string;
}

export interface WeeklySummaryParams {
  symbol?: string;
  weekStartDate?: string; // 'YYYY-MM-DD'
  /** NMS Tier 1 (T1), NMS Tier 2 (T2), or OTC equity securities (OTC/OTCE) */
  tierIdentifier?: 'T1' | 'T2' | 'OTC';
  summaryTypeCode?: string; // e.g., 'ATS_W_SMBL', 'OTC_W_SMBL'
  limit?: number;
}

export interface SymbolWeeklyAtsOtc {
  ats?: WeeklySummaryRecord;
  otc?: WeeklySummaryRecord;
}

// ============================================================================
// Consolidated Short Interest Dataset Types
// ============================================================================

/**
 * Consolidated Short Interest Record - matches FINRA otcMarket/consolidatedShortInterest dataset schema
 *
 * FINRA Rule 4560 requires member firms to report short positions in all OTC equity securities.
 * This dataset provides a consolidated view of short interest positions across all exchanges.
 */
export interface ConsolidatedShortInterestRecord extends DatasetRecord {
  /** Settlement Date for Shorts Cycle in YYYYMMDD format */
  accountingYearMonthNumber: number;
  /** Securities Information Processor Symbol Identifier */
  symbolCode: string;
  /** Name of the Issue */
  issueName: string;
  /** The issuer's service group exchange code */
  issuerServicesGroupExchangeCode: string | null;
  /** The market class code */
  marketClassCode: string;
  /** Short Position in the current cycle */
  currentShortPositionQuantity: number;
  /** Short Position in the previous cycle */
  previousShortPositionQuantity: number;
  /** 'S' if stock split occurred in current cycle, null otherwise */
  stockSplitFlag: string | null;
  /** Average Daily Volume Quantity (default 0, excludes non-media trades) */
  averageDailyVolumeQuantity: number;
  /** Days to Cover Quantity (default 0) */
  daysToCoverQuantity: number;
  /** 'R' if prior cycle short position was revised, null otherwise */
  revisionFlag: string | null;
  /** Percent Change in Short Position (rounded to 2 decimal places, 100 if no previous) */
  changePercent: number;
  /** Difference between Current and Previous Unadjusted Short Position */
  changePreviousNumber: number;
  /** Settlement Date - yyyy-MM-dd */
  settlementDate: string;
}

export interface ShortInterestIdentifier {
  /** Symbol code (FINRA field name: symbolCode) */
  symbolCode?: string;
}

export interface ShortInterestParams {
  identifiers?: ShortInterestIdentifier;
  settlementDate?: string; // 'YYYY-MM-DD'
  limit?: number;
}

export interface ShortInterestRangeParams {
  identifiers?: ShortInterestIdentifier;
  startDate: string; // 'YYYY-MM-DD'
  endDate: string; // 'YYYY-MM-DD'
  limitPerCall?: number;
}

// ============================================================================
// Reg SHO Daily Short Sale Volume Dataset Types
// ============================================================================

/**
 * Reg SHO Daily Short Sale Volume Record - matches FINRA otcMarket/regShoDaily dataset schema
 *
 * Provides aggregate daily short sale and short sale exempt volume for OTC equity securities.
 */
export interface RegShoDailyRecord extends DatasetRecord {
  /** Trade Date - yyyy-MM-dd */
  tradeReportDate: string;
  /** Security symbol */
  securitiesInformationProcessorSymbolIdentifier: string;
  /** Aggregate reported share volume of executed short sale and short sale exempt trades during regular trading hours */
  shortParQuantity: number;
  /** Aggregate reported share volume of executed short sale exempt trades during regular trading hours */
  shortExemptParQuantity: number;
  /** Aggregate reported share volume of all executed trades during regular trading hours */
  totalParQuantity: number;
  /** Market Code */
  marketCode: string;
  /** Reporting Facility identifier (N = NYSE TRF, Q = NASDAQ TRF Carteret, B = NASDAQ TRF Chicago, D = ADF) */
  reportingFacilityCode: string;
}

export interface RegShoDailyParams {
  symbol?: string; // SIP symbol
  tradeReportDate?: string; // 'YYYY-MM-DD'
  marketCode?: string;
  limit?: number;
}

// ============================================================================
// Threshold List Dataset Types
// ============================================================================

export interface ThresholdListRecord extends DatasetRecord {
  tradeDate: string; // ISO date
  issueSymbolIdentifier: string;
  issueName?: string;
  marketCategoryCode?: string;
  regShoThresholdFlag: string; // 'Y' or 'N'
  ruleListed?: string;
}

export interface ThresholdListParams {
  symbol?: string;
  tradeDate?: string; // 'YYYY-MM-DD'
  onlyOnThreshold?: boolean; // Default true -> regShoThresholdFlag = 'Y'
  limit?: number;
}

// ============================================================================
// Generic Dataset Types
// ============================================================================

export type DatasetRecordUnion =
  | WeeklySummaryRecord
  | ConsolidatedShortInterestRecord
  | RegShoDailyRecord
  | ThresholdListRecord;

