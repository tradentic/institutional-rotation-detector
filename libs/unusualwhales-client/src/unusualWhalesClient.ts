import { setTimeout as delay } from 'timers/promises';
import type {
  CandleSize,
  DarkPoolRecentParams,
  DarkPoolTickerParams,
  FlowAlertsParams,
  FlowPerStrikeParams,
  GreekExposureByExpiryParams,
  GreekExposureByStrikeAndExpiryParams,
  GreekExposureByStrikeParams,
  GreekExposureParams,
  GreekFlowParams,
  GreeksParams,
  GroupGreekFlowParams,
  MaxPainParams,
  NopeParams,
  OhlcParams,
  OffLitPriceLevelsParams,
  OiChangeParams,
  OiPerExpiryParams,
  OptionChainsParams,
  OptionContractsParams,
  SeasonalityMonthPerformersParams,
  SpotExposuresByExpiryStrikeParams,
  SpotExposuresByStrikeParams,
  SpotExposuresParams,
  TopNetImpactParams,
  UwDarkPoolTradesResponse,
  UwFailuresToDeliverResponse,
  UwFlowAlertsResponse,
  UwFlowPerExpiryResponse,
  UwFlowPerStrikeResponse,
  UwGreekExposureByExpiryResponse,
  UwGreekExposureByStrikeAndExpiryResponse,
  UwGreekExposureByStrikeResponse,
  UwGreekExposureResponse,
  UwGreekFlowResponse,
  UwGreeksResponse,
  UwGroupFlowResponse,
  UwInstitutionHoldingsResponse,
  UwMarketSeasonalityResponse,
  UwMaxPainResponse,
  UwNopeResponse,
  UwOffLitPriceLevelsResponse,
  UwOhlcResponse,
  UwOiChangeResponse,
  UwOpenInterestPerExpiryResponse,
  UwOpenInterestPerStrikeResponse,
  UwOptionChainsResponse,
  UwOptionContractsResponse,
  UwSeasonalityMonthlyResponse,
  UwSeasonalityPerformersResponse,
  UwSeasonalityYearMonthResponse,
  UwShortDataResponse,
  UwShortInterestAndFloatResponse,
  UwShortVolumeByExchangeResponse,
  UwShortVolumeResponse,
  UwSpotExposuresByStrikeResponse,
  UwSpotExposuresResponse,
  UwTopNetImpactResponse,
} from './types';

const DEFAULT_BASE_URL = 'https://api.unusualwhales.com';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

export interface RateLimiter {
  throttle(): Promise<void>;
}

export type QueryParamValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean>;
export type QueryParams = Record<string, QueryParamValue>;

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  method?: string;
  body?: BodyInit | null;
  params?: QueryParams;
  timeoutMs?: number;
}

export interface UnusualWhalesClientConfig {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  rateLimiter?: RateLimiter;
}

export class UnusualWhalesRequestError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`UnusualWhales API request failed ${status}: ${body}`);
    this.name = 'UnusualWhalesRequestError';
  }
}

export class UnusualWhalesClient {
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(private readonly config: UnusualWhalesClientConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  // ---------------------------------------------------------------------------
  // Public HTTP helpers
  // ---------------------------------------------------------------------------

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.params);
    const method = options.method ?? 'GET';
    const headers: HeadersInit = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      ...options.headers,
    };

    const timeout = options.timeoutMs ?? this.config.timeoutMs;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.config.rateLimiter?.throttle();

      let controller: AbortController | undefined;
      let timeoutId: NodeJS.Timeout | undefined;
      let signal = options.signal;

      if (timeout) {
        controller = new AbortController();
        if (signal) {
          if (signal.aborted) {
            controller.abort();
          } else {
            signal.addEventListener('abort', () => controller?.abort(), { once: true });
          }
        }
        signal = controller.signal;
        timeoutId = setTimeout(() => controller?.abort(), timeout);
      }

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: options.body ?? null,
          signal,
        });

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          const bodyText = await safeReadBody(response);
          if (this.shouldRetry(response.status) && attempt < this.maxRetries) {
            await this.waitForRetry(attempt);
            continue;
          }

          throw new UnusualWhalesRequestError(response.status, bodyText);
        }

        return (await parseJson<T>(response)) as T;
      } catch (error) {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        if (attempt < this.maxRetries) {
          await this.waitForRetry(attempt);
          continue;
        }

        throw error;
      }
    }

    throw new Error('Failed to execute request after retries');
  }

  async get<T>(path: string, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  // ---------------------------------------------------------------------------
  // Options flow & contracts
  // ---------------------------------------------------------------------------

  getFlowPerExpiry(ticker: string): Promise<UwFlowPerExpiryResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/flow-per-expiry`);
  }

  getFlowPerStrike(ticker: string, params?: FlowPerStrikeParams): Promise<UwFlowPerStrikeResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/flow-per-strike`, params?.date ? { date: params.date } : undefined);
  }

  getGreeks(ticker: string, params: GreeksParams): Promise<UwGreeksResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/greeks`, {
      expiry: params.expiry,
      ...(params.date ? { date: params.date } : undefined),
    });
  }

  getOptionChains(ticker: string, params?: OptionChainsParams): Promise<UwOptionChainsResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/option-chains`, params?.date ? { date: params.date } : undefined);
  }

  getOptionContracts(ticker: string, params?: OptionContractsParams): Promise<UwOptionContractsResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/option-contracts`, this.buildOptionContractsQuery(params));
  }

  getGreekFlow(ticker: string, params?: GreekFlowParams): Promise<UwGreekFlowResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/greek-flow`, params?.date ? { date: params.date } : undefined);
  }

  getGreekFlowByExpiry(ticker: string, expiry: string, params?: GreekFlowParams): Promise<UwGreekFlowResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/greek-flow/${encodeURIComponent(expiry)}`, params?.date ? { date: params.date } : undefined);
  }

  getGroupGreekFlow(flowGroup: string, params?: GroupGreekFlowParams): Promise<UwGroupFlowResponse> {
    return this.get(`/api/group-flow/${encodeURIComponent(flowGroup)}/greek-flow`, params?.date ? { date: params.date } : undefined);
  }

  getGroupGreekFlowByExpiry(flowGroup: string, expiry: string, params?: GroupGreekFlowParams): Promise<UwGroupFlowResponse> {
    return this.get(
      `/api/group-flow/${encodeURIComponent(flowGroup)}/greek-flow/${encodeURIComponent(expiry)}`,
      params?.date ? { date: params.date } : undefined
    );
  }

  getGreekExposure(ticker: string, params?: GreekExposureParams): Promise<UwGreekExposureResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/greek-exposure`, this.buildDateTimeframeParams(params));
  }

  getGreekExposureByExpiry(ticker: string, params?: GreekExposureByExpiryParams): Promise<UwGreekExposureByExpiryResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/greek-exposure/expiry`, params?.date ? { date: params.date } : undefined);
  }

  getGreekExposureByStrike(ticker: string, params?: GreekExposureByStrikeParams): Promise<UwGreekExposureByStrikeResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/greek-exposure/strike`, params?.date ? { date: params.date } : undefined);
  }

  getGreekExposureByStrikeAndExpiry(
    ticker: string,
    params: GreekExposureByStrikeAndExpiryParams
  ): Promise<UwGreekExposureByStrikeAndExpiryResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/greek-exposure/strike-expiry`, {
      expiry: params.expiry,
      ...(params.date ? { date: params.date } : undefined),
    });
  }

  getSpotExposures(ticker: string, params?: SpotExposuresParams): Promise<UwSpotExposuresResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/spot-exposures`, params?.date ? { date: params.date } : undefined);
  }

  getSpotExposuresByStrike(ticker: string, params?: SpotExposuresByStrikeParams): Promise<UwSpotExposuresByStrikeResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/spot-exposures/strike`, this.buildSpotStrikeParams(params));
  }

  getSpotExposuresByExpiryStrike(
    ticker: string,
    params: SpotExposuresByExpiryStrikeParams
  ): Promise<UwSpotExposuresByStrikeResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/spot-exposures/expiry-strike`, this.buildSpotExpiryStrikeParams(params));
  }

  getOiPerStrike(ticker: string, params?: OiPerExpiryParams): Promise<UwOpenInterestPerStrikeResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/oi-per-strike`, params?.date ? { date: params.date } : undefined);
  }

  getOiPerExpiry(ticker: string, params?: OiPerExpiryParams): Promise<UwOpenInterestPerExpiryResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/oi-per-expiry`, params?.date ? { date: params.date } : undefined);
  }

  getOiChange(ticker: string, params?: OiChangeParams): Promise<UwOiChangeResponse> {
    const query: QueryParams = {
      ...(params?.date ? { date: params.date } : undefined),
      ...(params?.limit !== undefined ? { limit: params.limit } : undefined),
      ...(params?.page !== undefined ? { page: params.page } : undefined),
      ...(params?.order ? { order: params.order } : undefined),
    };
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/oi-change`, Object.keys(query).length ? query : undefined);
  }

  getMaxPain(ticker: string, params?: MaxPainParams): Promise<UwMaxPainResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/max-pain`, params?.date ? { date: params.date } : undefined);
  }

  getNope(ticker: string, params?: NopeParams): Promise<UwNopeResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/nope`, params?.date ? { date: params.date } : undefined);
  }

  getOhlc(ticker: string, candleSize: CandleSize, params?: OhlcParams): Promise<UwOhlcResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/ohlc/${candleSize}`, this.buildOhlcParams(params));
  }

  getFlowAlerts(params?: FlowAlertsParams): Promise<UwFlowAlertsResponse> {
    return this.get('/api/option-trades/flow-alerts', this.buildFlowAlertsQuery(params));
  }

  // ---------------------------------------------------------------------------
  // Short interest
  // ---------------------------------------------------------------------------

  getShortData(ticker: string): Promise<UwShortDataResponse> {
    return this.get(`/api/shorts/${encodeURIComponent(ticker)}/data`);
  }

  getShortInterestAndFloat(ticker: string): Promise<UwShortInterestAndFloatResponse> {
    return this.get(`/api/shorts/${encodeURIComponent(ticker)}/interest-float`);
  }

  getShortVolumeAndRatio(ticker: string): Promise<UwShortVolumeResponse> {
    return this.get(`/api/shorts/${encodeURIComponent(ticker)}/volume-and-ratio`);
  }

  getShortVolumeByExchange(ticker: string): Promise<UwShortVolumeByExchangeResponse> {
    return this.get(`/api/shorts/${encodeURIComponent(ticker)}/volumes-by-exchange`);
  }

  getFailuresToDeliver(ticker: string): Promise<UwFailuresToDeliverResponse> {
    return this.get(`/api/shorts/${encodeURIComponent(ticker)}/ftds`);
  }

  // ---------------------------------------------------------------------------
  // Dark pool & off-lit
  // ---------------------------------------------------------------------------

  getDarkPoolRecentTrades(params?: DarkPoolRecentParams): Promise<UwDarkPoolTradesResponse> {
    return this.get('/api/darkpool/recent', this.buildDarkPoolParams(params));
  }

  getDarkPoolTradesForTicker(ticker: string, params?: DarkPoolTickerParams): Promise<UwDarkPoolTradesResponse> {
    return this.get(`/api/darkpool/${encodeURIComponent(ticker)}`, this.buildDarkPoolParams(params));
  }

  getOffLitPriceLevels(ticker: string, params?: OffLitPriceLevelsParams): Promise<UwOffLitPriceLevelsResponse> {
    return this.get(`/api/stock/${encodeURIComponent(ticker)}/stock-volume-price-levels`, params?.date ? { date: params.date } : undefined);
  }

  // ---------------------------------------------------------------------------
  // Market, seasonality & institutions
  // ---------------------------------------------------------------------------

  getMarketSeasonality(): Promise<UwMarketSeasonalityResponse> {
    return this.get('/api/seasonality/market');
  }

  getSeasonalityMonthPerformers(month: number | string, params?: SeasonalityMonthPerformersParams): Promise<UwSeasonalityPerformersResponse> {
    return this.get(`/api/seasonality/${encodeURIComponent(String(month))}/performers`, this.buildSeasonalityPerformersParams(params));
  }

  getSeasonalityMonthlyForTicker(ticker: string): Promise<UwSeasonalityMonthlyResponse> {
    return this.get(`/api/seasonality/${encodeURIComponent(ticker)}/monthly`);
  }

  getSeasonalityYearMonthForTicker(ticker: string): Promise<UwSeasonalityYearMonthResponse> {
    return this.get(`/api/seasonality/${encodeURIComponent(ticker)}/year-month`);
  }

  getInstitutionHoldings(name: string): Promise<UwInstitutionHoldingsResponse> {
    return this.get(`/api/institution/${encodeURIComponent(name)}/holdings`);
  }

  getTopNetImpact(params?: TopNetImpactParams): Promise<UwTopNetImpactResponse> {
    return this.get('/api/market/top-net-impact', this.buildTopNetImpactParams(params));
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private buildOptionContractsQuery(params?: OptionContractsParams): QueryParams | undefined {
    if (!params) {
      return undefined;
    }

    const query: QueryParams = {
      ...(params.expiry ? { expiry: params.expiry } : undefined),
      ...(params.optionType ? { option_type: params.optionType } : undefined),
      ...(params.volGreaterThanOpenInterest !== undefined ? { vol_greater_oi: params.volGreaterThanOpenInterest } : undefined),
      ...(params.excludeZeroVolChains !== undefined ? { exclude_zero_vol_chains: params.excludeZeroVolChains } : undefined),
      ...(params.excludeZeroDte !== undefined ? { exclude_zero_dte: params.excludeZeroDte } : undefined),
      ...(params.excludeZeroOiChains !== undefined ? { exclude_zero_oi_chains: params.excludeZeroOiChains } : undefined),
      ...(params.otmOnly !== undefined ? { otm_only: params.otmOnly } : undefined),
      ...(params.optionSymbols && params.optionSymbols.length ? { option_symbol: params.optionSymbols } : undefined),
      ...(params.limit !== undefined ? { limit: params.limit } : undefined),
      ...(params.page !== undefined ? { page: params.page } : undefined),
    };

    return Object.keys(query).length ? query : undefined;
  }

  private buildFlowAlertsQuery(params?: FlowAlertsParams): QueryParams | undefined {
    if (!params) {
      return undefined;
    }

    const query: QueryParams = {
      ...(params.tickerSymbol ? { ticker_symbol: params.tickerSymbol } : undefined),
      ...(params.minPremium !== undefined ? { min_premium: params.minPremium } : undefined),
      ...(params.maxPremium !== undefined ? { max_premium: params.maxPremium } : undefined),
      ...(params.minSize !== undefined ? { min_size: params.minSize } : undefined),
      ...(params.maxSize !== undefined ? { max_size: params.maxSize } : undefined),
      ...(params.minVolume !== undefined ? { min_volume: params.minVolume } : undefined),
      ...(params.maxVolume !== undefined ? { max_volume: params.maxVolume } : undefined),
      ...(params.minOpenInterest !== undefined ? { min_open_interest: params.minOpenInterest } : undefined),
      ...(params.maxOpenInterest !== undefined ? { max_open_interest: params.maxOpenInterest } : undefined),
      ...(params.allOpening !== undefined ? { all_opening: params.allOpening } : undefined),
      ...(params.isFloor !== undefined ? { is_floor: params.isFloor } : undefined),
      ...(params.isSweep !== undefined ? { is_sweep: params.isSweep } : undefined),
      ...(params.isCall !== undefined ? { is_call: params.isCall } : undefined),
      ...(params.isPut !== undefined ? { is_put: params.isPut } : undefined),
      ...(params.isAskSide !== undefined ? { is_ask_side: params.isAskSide } : undefined),
      ...(params.isBidSide !== undefined ? { is_bid_side: params.isBidSide } : undefined),
      ...(params.ruleNames?.length ? { 'rule_name[]': params.ruleNames } : undefined),
      ...(params.minDiff !== undefined ? { min_diff: params.minDiff } : undefined),
      ...(params.maxDiff !== undefined ? { max_diff: params.maxDiff } : undefined),
      ...(params.minVolumeOiRatio !== undefined ? { min_volume_oi_ratio: params.minVolumeOiRatio } : undefined),
      ...(params.maxVolumeOiRatio !== undefined ? { max_volume_oi_ratio: params.maxVolumeOiRatio } : undefined),
      ...(params.isOtm !== undefined ? { is_otm: params.isOtm } : undefined),
      ...(params.issueTypes?.length ? { 'issue_types[]': params.issueTypes } : undefined),
      ...(params.minDte !== undefined ? { min_dte: params.minDte } : undefined),
      ...(params.maxDte !== undefined ? { max_dte: params.maxDte } : undefined),
      ...(params.minAskPercentage !== undefined ? { min_ask_perc: params.minAskPercentage } : undefined),
      ...(params.maxAskPercentage !== undefined ? { max_ask_perc: params.maxAskPercentage } : undefined),
      ...(params.minBidPercentage !== undefined ? { min_bid_perc: params.minBidPercentage } : undefined),
      ...(params.maxBidPercentage !== undefined ? { max_bid_perc: params.maxBidPercentage } : undefined),
      ...(params.minBullPercentage !== undefined ? { min_bull_perc: params.minBullPercentage } : undefined),
      ...(params.maxBullPercentage !== undefined ? { max_bull_perc: params.maxBullPercentage } : undefined),
      ...(params.minBearPercentage !== undefined ? { min_bear_perc: params.minBearPercentage } : undefined),
      ...(params.maxBearPercentage !== undefined ? { max_bear_perc: params.maxBearPercentage } : undefined),
      ...(params.minSkew !== undefined ? { min_skew: params.minSkew } : undefined),
      ...(params.maxSkew !== undefined ? { max_skew: params.maxSkew } : undefined),
      ...(params.minPrice !== undefined ? { min_price: params.minPrice } : undefined),
      ...(params.maxPrice !== undefined ? { max_price: params.maxPrice } : undefined),
      ...(params.minIvChange !== undefined ? { min_iv_change: params.minIvChange } : undefined),
      ...(params.maxIvChange !== undefined ? { max_iv_change: params.maxIvChange } : undefined),
      ...(params.minSizeVolumeRatio !== undefined ? { min_size_vol_ratio: params.minSizeVolumeRatio } : undefined),
      ...(params.maxSizeVolumeRatio !== undefined ? { max_size_vol_ratio: params.maxSizeVolumeRatio } : undefined),
      ...(params.minSpread !== undefined ? { min_spread: params.minSpread } : undefined),
      ...(params.maxSpread !== undefined ? { max_spread: params.maxSpread } : undefined),
      ...(params.minMarketcap !== undefined ? { min_marketcap: params.minMarketcap } : undefined),
      ...(params.maxMarketcap !== undefined ? { max_marketcap: params.maxMarketcap } : undefined),
      ...(params.isMultiLeg !== undefined ? { is_multi_leg: params.isMultiLeg } : undefined),
      ...(params.sizeGreaterThanOi !== undefined ? { size_greater_oi: params.sizeGreaterThanOi } : undefined),
      ...(params.volumeGreaterThanOi !== undefined ? { vol_greater_oi: params.volumeGreaterThanOi } : undefined),
      ...(params.newerThan !== undefined ? { newer_than: params.newerThan } : undefined),
      ...(params.olderThan !== undefined ? { older_than: params.olderThan } : undefined),
      ...(params.limit !== undefined ? { limit: params.limit } : undefined),
    };

    return Object.keys(query).length ? query : undefined;
  }

  private buildDarkPoolParams(params?: DarkPoolRecentParams | DarkPoolTickerParams): QueryParams | undefined {
    if (!params) {
      return undefined;
    }

    const query: QueryParams = {
      ...(params.limit !== undefined ? { limit: params.limit } : undefined),
      ...(params.date ? { date: params.date } : undefined),
      ...(params.minPremium !== undefined ? { min_premium: params.minPremium } : undefined),
      ...(params.maxPremium !== undefined ? { max_premium: params.maxPremium } : undefined),
      ...(params.minSize !== undefined ? { min_size: params.minSize } : undefined),
      ...(params.maxSize !== undefined ? { max_size: params.maxSize } : undefined),
      ...(params.minVolume !== undefined ? { min_volume: params.minVolume } : undefined),
      ...(params.maxVolume !== undefined ? { max_volume: params.maxVolume } : undefined),
      ...('newerThan' in params && params.newerThan !== undefined ? { newer_than: params.newerThan } : undefined),
      ...('olderThan' in params && params.olderThan !== undefined ? { older_than: params.olderThan } : undefined),
    };

    return Object.keys(query).length ? query : undefined;
  }

  private buildDateTimeframeParams(params?: GreekExposureParams): QueryParams | undefined {
    if (!params) {
      return undefined;
    }

    const query: QueryParams = {
      ...(params.date ? { date: params.date } : undefined),
      ...(params.timeframe ? { timeframe: params.timeframe } : undefined),
    };

    return Object.keys(query).length ? query : undefined;
  }

  private buildSpotStrikeParams(params?: SpotExposuresByStrikeParams): QueryParams | undefined {
    if (!params) {
      return undefined;
    }

    const query: QueryParams = {
      ...(params.date ? { date: params.date } : undefined),
      ...(params.minStrike !== undefined ? { min_strike: params.minStrike } : undefined),
      ...(params.maxStrike !== undefined ? { max_strike: params.maxStrike } : undefined),
      ...(params.limit !== undefined ? { limit: params.limit } : undefined),
      ...(params.page !== undefined ? { page: params.page } : undefined),
    };

    return Object.keys(query).length ? query : undefined;
  }

  private buildSpotExpiryStrikeParams(params: SpotExposuresByExpiryStrikeParams): QueryParams {
    const query: QueryParams = {
      'expirations[]': params.expirations,
      ...(params.date ? { date: params.date } : undefined),
      ...(params.limit !== undefined ? { limit: params.limit } : undefined),
      ...(params.page !== undefined ? { page: params.page } : undefined),
      ...(params.minStrike !== undefined ? { min_strike: params.minStrike } : undefined),
      ...(params.maxStrike !== undefined ? { max_strike: params.maxStrike } : undefined),
      ...(params.minDte !== undefined ? { min_dte: params.minDte } : undefined),
      ...(params.maxDte !== undefined ? { max_dte: params.maxDte } : undefined),
    };
    return query;
  }

  private buildOhlcParams(params?: OhlcParams): QueryParams | undefined {
    if (!params) {
      return undefined;
    }

    const query: QueryParams = {
      ...(params.timeframe ? { timeframe: params.timeframe } : undefined),
      ...(params.endDate ? { end_date: params.endDate } : undefined),
      ...(params.date ? { date: params.date } : undefined),
      ...(params.limit !== undefined ? { limit: params.limit } : undefined),
    };

    return Object.keys(query).length ? query : undefined;
  }

  private buildSeasonalityPerformersParams(params?: SeasonalityMonthPerformersParams): QueryParams | undefined {
    if (!params) {
      return undefined;
    }

    const query: QueryParams = {
      ...(params.minYears !== undefined ? { min_years: params.minYears } : undefined),
      ...(params.tickerForSector ? { ticker_for_sector: params.tickerForSector } : undefined),
      ...(params.sp500NasdaqOnly !== undefined ? { s_p_500_nasdaq_only: params.sp500NasdaqOnly } : undefined),
      ...(params.minOpenInterest !== undefined ? { min_oi: params.minOpenInterest } : undefined),
      ...(params.limit !== undefined ? { limit: params.limit } : undefined),
      ...(params.order ? { order: params.order } : undefined),
      ...(params.orderDirection ? { order_direction: params.orderDirection } : undefined),
    };

    return Object.keys(query).length ? query : undefined;
  }

  private buildTopNetImpactParams(params?: TopNetImpactParams): QueryParams | undefined {
    if (!params) {
      return undefined;
    }

    const query: QueryParams = {
      ...(params.date ? { date: params.date } : undefined),
      ...(params.issueTypes?.length ? { 'issue_types[]': params.issueTypes } : undefined),
      ...(params.limit !== undefined ? { limit: params.limit } : undefined),
    };

    return Object.keys(query).length ? query : undefined;
  }

  private buildUrl(path: string, params?: QueryParams): string {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(key, String(item));
          }
          continue;
        }
        url.searchParams.append(key, String(value));
      }
    }
    return url.toString();
  }

  private shouldRetry(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private async waitForRetry(attempt: number): Promise<void> {
    const delayMs = this.retryDelayMs * 2 ** attempt;
    const jitter = Math.random() * this.retryDelayMs;
    await delay(delayMs + jitter);
  }
}

async function parseJson<T>(response: Response): Promise<T | undefined> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Failed to parse JSON response: ${error}`);
  }
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    return `Failed to read response body: ${error}`;
  }
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function createUnusualWhalesClientFromEnv(
  overrides: Partial<Omit<UnusualWhalesClientConfig, 'apiKey'>> = {}
): UnusualWhalesClient {
  const apiKey = process.env.UNUSUALWHALES_API_KEY;
  if (!apiKey) {
    throw new Error('UNUSUALWHALES_API_KEY environment variable is required');
  }

  const config: UnusualWhalesClientConfig = {
    apiKey,
    baseUrl: overrides.baseUrl ?? process.env.UNUSUALWHALES_BASE_URL ?? DEFAULT_BASE_URL,
    maxRetries: overrides.maxRetries ?? parseOptionalNumber(process.env.UNUSUALWHALES_MAX_RETRIES),
    retryDelayMs: overrides.retryDelayMs ?? parseOptionalNumber(process.env.UNUSUALWHALES_RETRY_DELAY_MS),
    timeoutMs: overrides.timeoutMs ?? parseOptionalNumber(process.env.UNUSUALWHALES_TIMEOUT_MS),
    rateLimiter: overrides.rateLimiter,
  };

  return new UnusualWhalesClient(config);
}
