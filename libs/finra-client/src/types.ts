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

export type CompareType = 'equal' | 'greater' | 'lesser';

export interface CompareFilter {
  compareType: CompareType;
  fieldName: string;
  fieldValue: string | number;
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

export interface WeeklySummaryRecord {
  issueSymbolIdentifier: string;
  issueName?: string;
  tierIdentifier?: string; // T1, T2, T3
  summaryStartDate: string; // ISO date
  weekStartDate: string; // ISO date
  totalWeeklyShareQuantity: number;
  totalTradeCountSum: number;
  productTypeCode?: string;
  summaryTypeCode: string; // ATS_W_SMBL, OTC_W_SMBL, etc.
  marketParticipantQuantity?: number;
  lastUpdateDate?: string;
  [key: string]: unknown; // Allow additional fields
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

export interface ConsolidatedShortInterestRecord {
  settlementDate: string; // ISO date
  issueSymbolIdentifier?: string;
  symbolCode?: string; // Alternative symbol field
  cusip?: string;
  shortInterestQuantity: number;
  averageDailyVolumeQuantity?: number;
  daysToCoverQuantity?: number;
  revisionFlag?: string;
  marketClassCode?: string;
  currentShortPositionQuantity?: number;
  previousShortPositionQuantity?: number;
  changePercent?: number;
  [key: string]: unknown;
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

export interface RegShoDailyRecord {
  tradeReportDate: string; // ISO date
  securitiesInformationProcessorSymbolIdentifier: string; // SIP symbol
  shortParQuantity: number;
  shortExemptParQuantity: number;
  totalParQuantity: number;
  marketCode?: string; // e.g., 'Q' for NASDAQ
  shortVolumePercent?: number;
  [key: string]: unknown;
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
