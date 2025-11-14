/**
 * @libs/finra-client
 *
 * FINRA API Client Library
 *
 * Provides typed access to FINRA Query API datasets including:
 * - Weekly ATS and OTC summary data
 * - Consolidated short interest
 * - Reg SHO daily short sale volume
 * - Threshold list
 *
 * ## Architecture
 *
 * - **Core Client**: OAuth2 authentication, GET/POST dataset access
 * - **Dataset Helpers**: High-level typed methods for common queries
 * - **Types**: Complete TypeScript definitions for all datasets
 *
 * ## Usage
 *
 * ```typescript
 * import { createFinraClient } from '@libs/finra-client';
 *
 * // Create client (reads from env vars)
 * const client = createFinraClient();
 *
 * // Query weekly ATS vs OTC for a symbol
 * const weeklyData = await client.getSymbolWeeklyAtsAndOtc({
 *   symbol: 'IRBT',
 *   weekStartDate: '2024-01-08'
 * });
 *
 * // Get consolidated short interest
 * const shortInterest = await client.getConsolidatedShortInterest({
 *   identifiers: { issueSymbolIdentifier: 'IRBT' },
 *   settlementDate: '2024-01-15'
 * });
 *
 * // Get Reg SHO daily short sale volume
 * const regSho = await client.getRegShoDaily({
 *   symbol: 'IRBT',
 *   tradeReportDate: '2024-01-15'
 * });
 *
 * // Get threshold list
 * const threshold = await client.getThresholdList({
 *   symbol: 'IRBT',
 *   tradeDate: '2024-01-15',
 *   onlyOnThreshold: true
 * });
 * ```
 *
 * ## Environment Variables
 *
 * Required:
 * - `FINRA_API_CLIENT` - FINRA API client ID
 * - `FINRA_API_SECRET` - FINRA API client secret
 *
 * Optional:
 * - `FINRA_API_BASE` - Base URL (default: https://api.finra.org)
 * - `FINRA_TOKEN_URL` - Token endpoint URL
 * - `FINRA_PAGE_SIZE` - Page size for pagination (default: 5000)
 * - `FINRA_MAX_RETRIES` - Max retry attempts (default: 3)
 * - `FINRA_RETRY_DELAY_MS` - Retry delay in ms (default: 500)
 */

// ============================================================================
// Primary API - Client and Factory
// ============================================================================

export { FinraClient, createFinraClient, createNormalizedRow } from './finraClient';

// ============================================================================
// Type Exports
// ============================================================================

export type {
  // Core config
  FinraClientConfig,
  TokenResponse,
  // Query API types
  CompareType,
  CompareFilter,
  DateRangeFilter,
  FinraPostRequest,
  // Weekly summary types
  WeeklySummaryRecord,
  WeeklySummaryParams,
  SymbolWeeklyAtsOtc,
  // Short interest types
  ConsolidatedShortInterestRecord,
  ShortInterestIdentifier,
  ShortInterestParams,
  ShortInterestRangeParams,
  // Reg SHO types
  RegShoDailyRecord,
  RegShoDailyParams,
  // Threshold list types
  ThresholdListRecord,
  ThresholdListParams,
  // Generic types
  DatasetRecord,
} from './types';

// ============================================================================
// Error Exports
// ============================================================================

export { FinraRequestError } from './types';
