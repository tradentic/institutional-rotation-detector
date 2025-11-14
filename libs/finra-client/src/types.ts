/**
 * FINRA API Client Types
 *
 * Type definitions for FINRA Query API datasets and request/response structures.
 */

// ============================================================================
// Core Client Configuration
// ============================================================================

export interface FinraClientConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  tokenUrl?: string;
  pageSize?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

// ============================================================================
// OAuth2 Token Types
// ============================================================================

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// ============================================================================
// Query API Request Types
// ============================================================================

/**
 * Compare types as documented in FINRA Query API.
 * Must be serialized as UPPERCASE in request payloads.
 */
export type CompareType = 'EQUAL' | 'GREATER' | 'LESSER';

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

export interface FinraPostRequest {
  limit?: number;
  offset?: number;
  fields?: string[];
  compareFilters?: CompareFilter[];
  dateRangeFilters?: DateRangeFilter[];
  domainFilters?: Array<{
    fieldName: string;
    values: string[];
  }>;
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
export interface WeeklySummaryRecord {
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
  tierIdentifier?: 'T1' | 'T2' | 'T3';
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
export interface ConsolidatedShortInterestRecord {
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
  issueSymbolIdentifier?: string;
  cusip?: string;
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
export interface RegShoDailyRecord {
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

export interface ThresholdListRecord {
  tradeDate: string; // ISO date
  issueSymbolIdentifier: string;
  issueName?: string;
  marketCategoryCode?: string;
  regShoThresholdFlag: string; // 'Y' or 'N'
  ruleListed?: string;
  [key: string]: unknown;
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

export type DatasetRecord =
  | WeeklySummaryRecord
  | ConsolidatedShortInterestRecord
  | RegShoDailyRecord
  | ThresholdListRecord
  | Record<string, unknown>;

// ============================================================================
// Error Types
// ============================================================================

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
