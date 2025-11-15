import { setTimeout as sleep } from 'timers/promises';
import type {
  CircuitBreaker as CoreCircuitBreaker,
  HttpCache,
  HttpRateLimiter,
  HttpTransport as CoreHttpTransport,
  Logger as CoreLogger,
  MetricsSink as CoreMetricsSink,
} from '@libs/http-client-core';
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
const DEFAULT_BASE_RETRY_DELAY_MS = 500;
const DEFAULT_TIMEOUT_MS = 30_000;

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

export interface RateLimiter extends HttpRateLimiter {}

export class NoopRateLimiter implements RateLimiter {
  async throttle(): Promise<void> {}
  onSuccess?(): void {}
  onError?(_key?: string, _error?: unknown): void {}
}

export interface Cache extends HttpCache {}

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

  async set<T = unknown>(key: string, value: T, ttlMs: number): Promise<void> {
    const expiresAt = ttlMs ? Date.now() + ttlMs : undefined;
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

export interface CircuitBreaker extends CoreCircuitBreaker {}

export interface Logger extends CoreLogger {}

export interface MetricsSink extends CoreMetricsSink {}

export type HttpTransport = CoreHttpTransport;

export type QueryParamValue = string | number | boolean | string[] | number[] | undefined;
export type QueryParams = Record<string, QueryParamValue>;

export interface RequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  method?: string;
  body?: BodyInit | null;
  params?: QueryParams;
  cacheTtlMs?: number;
  cacheKey?: string;
  timeoutMs?: number;
  operation?: string;
}

export interface CacheableHelperOptions {
  cacheTtlMs?: number;
}

export interface UnusualWhalesCacheTtls {
  seasonalityMs?: number;
  exposureMs?: number;
  ohlcHistoricalMs?: number;
}

export interface UnusualWhalesClientConfig {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  timeoutMs?: number;
  rateLimiter?: RateLimiter;
  baseRetryDelayMs?: number;
  cache?: Cache;
  circuitBreaker?: CircuitBreaker;
  logger?: Logger;
  metrics?: MetricsSink;
  transport?: HttpTransport;
  defaultCacheTtls?: UnusualWhalesCacheTtls;
}

export class UnusualWhalesRequestError extends ApiRequestError {
  constructor(message: string, status: number, responseBody?: string, retryAfterMs?: number) {
    super(message, status, responseBody, retryAfterMs);
    this.name = 'UnusualWhalesRequestError';
  }
}

type InternalApiError = ApiRequestError & { __handled?: boolean };

export class UnusualWhalesClient {
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly baseRetryDelayMs: number;
  private readonly timeoutMs: number;
  private readonly rateLimiter: RateLimiter;
  private readonly cache?: Cache;
  private readonly circuitBreaker?: CircuitBreaker;
  private readonly logger?: Logger;
  private readonly metrics?: MetricsSink;
  private readonly transport: HttpTransport;
  private readonly defaultCacheTtls?: UnusualWhalesCacheTtls;

  constructor(private readonly config: UnusualWhalesClientConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseRetryDelayMs = config.baseRetryDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.rateLimiter = config.rateLimiter ?? new NoopRateLimiter();
    this.cache = config.cache;
    this.circuitBreaker = config.circuitBreaker;
    this.logger = config.logger;
    this.metrics = config.metrics;
    this.transport = config.transport ?? ((url, init) => fetch(url, init));
    this.defaultCacheTtls = config.defaultCacheTtls;
  }

  // ---------------------------------------------------------------------------
  // Public HTTP helpers
  // ---------------------------------------------------------------------------

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: HeadersInit = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      ...options.headers,
    };

    const requestOptions: RequestOptions = {
      ...options,
      headers,
      operation: options.operation ?? path,
    };

    return this.requestWithRetries(path, requestOptions, (response) =>
      parseJson<T>(response)
    );
  }

  async get<T>(
    path: string,
    params?: QueryParams,
    requestOptions?: Pick<RequestOptions, 'cacheTtlMs' | 'cacheKey'>,
  ): Promise<T> {
    return this.request<T>(path, {
      method: 'GET',
      params,
      cacheTtlMs: requestOptions?.cacheTtlMs,
      cacheKey: requestOptions?.cacheKey,
    });
  }

  private resolveCacheOptions(
    options: CacheableHelperOptions | undefined,
    defaultTtl?: number,
  ): CacheableHelperOptions | undefined {
    if (options?.cacheTtlMs !== undefined) {
      return options;
    }
    if (defaultTtl === undefined) {
      return options;
    }
    return { ...(options ?? {}), cacheTtlMs: defaultTtl };
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

  getSpotExposures(
    ticker: string,
    params?: SpotExposuresParams,
    options?: CacheableHelperOptions,
  ): Promise<UwSpotExposuresResponse> {
    const cacheOptions = this.resolveCacheOptions(
      options,
      this.defaultCacheTtls?.exposureMs,
    );
    return this.get(
      `/api/stock/${encodeURIComponent(ticker)}/spot-exposures`,
      params?.date ? { date: params.date } : undefined,
      cacheOptions,
    );
  }

  getSpotExposuresByStrike(
    ticker: string,
    params?: SpotExposuresByStrikeParams,
    options?: CacheableHelperOptions,
  ): Promise<UwSpotExposuresByStrikeResponse> {
    const cacheOptions = this.resolveCacheOptions(
      options,
      this.defaultCacheTtls?.exposureMs,
    );
    return this.get(
      `/api/stock/${encodeURIComponent(ticker)}/spot-exposures/strike`,
      this.buildSpotStrikeParams(params),
      cacheOptions,
    );
  }

  getSpotExposuresByExpiryStrike(
    ticker: string,
    params: SpotExposuresByExpiryStrikeParams,
    options?: CacheableHelperOptions,
  ): Promise<UwSpotExposuresByStrikeResponse> {
    const cacheOptions = this.resolveCacheOptions(
      options,
      this.defaultCacheTtls?.exposureMs,
    );
    return this.get(
      `/api/stock/${encodeURIComponent(ticker)}/spot-exposures/expiry-strike`,
      this.buildSpotExpiryStrikeParams(params),
      cacheOptions,
    );
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

  getOhlc(
    ticker: string,
    candleSize: CandleSize,
    params?: OhlcParams,
    options?: CacheableHelperOptions,
  ): Promise<UwOhlcResponse> {
    const cacheOptions = this.resolveCacheOptions(
      options,
      this.defaultCacheTtls?.ohlcHistoricalMs,
    );
    return this.get(
      `/api/stock/${encodeURIComponent(ticker)}/ohlc/${candleSize}`,
      this.buildOhlcParams(params),
      cacheOptions,
    );
  }

  getFlowAlerts(params?: FlowAlertsParams): Promise<UwFlowAlertsResponse> {
    return this.get('/api/option-trades/flow-alerts', this.buildFlowAlertsQuery(params));
  }

  // ---------------------------------------------------------------------------
  // Short interest
  // ---------------------------------------------------------------------------

  getShortData(ticker: string, options?: CacheableHelperOptions): Promise<UwShortDataResponse> {
    return this.get(`/api/shorts/${encodeURIComponent(ticker)}/data`, undefined, options);
  }

  getShortInterestAndFloat(
    ticker: string,
    options?: CacheableHelperOptions,
  ): Promise<UwShortInterestAndFloatResponse> {
    return this.get(`/api/shorts/${encodeURIComponent(ticker)}/interest-float`, undefined, options);
  }

  getShortVolumeAndRatio(
    ticker: string,
    options?: CacheableHelperOptions,
  ): Promise<UwShortVolumeResponse> {
    return this.get(`/api/shorts/${encodeURIComponent(ticker)}/volume-and-ratio`, undefined, options);
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
    const cacheOptions = this.resolveCacheOptions(
      undefined,
      this.defaultCacheTtls?.seasonalityMs,
    );
    return this.get('/api/seasonality/market', undefined, cacheOptions);
  }

  getSeasonalityMonthPerformers(
    month: number | string,
    params?: SeasonalityMonthPerformersParams,
    options?: CacheableHelperOptions,
  ): Promise<UwSeasonalityPerformersResponse> {
    const cacheOptions = this.resolveCacheOptions(
      options,
      this.defaultCacheTtls?.seasonalityMs,
    );
    return this.get(
      `/api/seasonality/${encodeURIComponent(String(month))}/performers`,
      this.buildSeasonalityPerformersParams(params),
      cacheOptions,
    );
  }

  getSeasonalityMonthlyForTicker(
    ticker: string,
    options?: CacheableHelperOptions,
  ): Promise<UwSeasonalityMonthlyResponse> {
    const cacheOptions = this.resolveCacheOptions(
      options,
      this.defaultCacheTtls?.seasonalityMs,
    );
    return this.get(`/api/seasonality/${encodeURIComponent(ticker)}/monthly`, undefined, cacheOptions);
  }

  getSeasonalityYearMonthForTicker(
    ticker: string,
    options?: CacheableHelperOptions,
  ): Promise<UwSeasonalityYearMonthResponse> {
    const cacheOptions = this.resolveCacheOptions(
      options,
      this.defaultCacheTtls?.seasonalityMs,
    );
    return this.get(`/api/seasonality/${encodeURIComponent(ticker)}/year-month`, undefined, cacheOptions);
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

  private async requestWithRetries<T>(
    path: string,
    options: RequestOptions,
    parser: (response: Response) => Promise<T>,
  ): Promise<T> {
    const method = (options.method ?? 'GET').toUpperCase();
    const url = this.buildUrl(path, options.params);
    const endpoint = path;
    const operation = options.operation ?? endpoint;
    const timeout = options.timeoutMs ?? this.timeoutMs;
    const effectiveTimeout = timeout && timeout > 0 ? timeout : undefined;

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
        await this.metrics?.recordRequest?.({
          client: 'unusualwhales',
          operation,
          durationMs: 0,
          status: 200,
          cacheHit: true,
          attempt: 0,
        });
        return cached;
      }
    }

    const {
      params: _p,
      cacheTtlMs,
      timeoutMs,
      body,
      cacheKey: _cacheKey,
      operation: _operation,
      ...rest
    } = options;
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
          const bodyText = await safeReadBody(response);
          const error = new UnusualWhalesRequestError(
            `UnusualWhales request failed with status ${response.status}`,
            response.status,
            bodyText,
            retryAfterMs,
          );
          await this.handleFailure(key, error, endpoint, operation, start, attempt);

          if (!this.isRetryable(error.status) || attempt === this.maxRetries) {
            (error as InternalApiError).__handled = true;
            throw error;
          }

          await this.waitForRetry(error, attempt, method, endpoint);
          continue;
        }

        const data = await parser(response);
        await this.rateLimiter.onSuccess?.(key);
        await this.circuitBreaker?.onSuccess?.(key);

        await this.metrics?.recordRequest?.({
          client: 'unusualwhales',
          operation,
          durationMs: Date.now() - start,
          status: response.status,
          cacheHit: false,
          attempt,
        });

        if (cacheEligible && cacheKey && cacheTtlMs) {
          await this.cache!.set(cacheKey, data, cacheTtlMs);
        }

        return data;
      } catch (err) {
        const error: InternalApiError = err instanceof ApiRequestError
          ? (err as InternalApiError)
          : new UnusualWhalesRequestError(
              err instanceof Error ? err.message : 'UnusualWhales request failed',
              0,
            );
        if (!error.__handled) {
          await this.handleFailure(key, error, endpoint, operation, start, attempt);
          error.__handled = true;
        }

        if (!this.isRetryable(error.status) || attempt === this.maxRetries) {
          throw error;
        }

        await this.waitForRetry(error, attempt, method, endpoint);
      }
    }

    throw new UnusualWhalesRequestError('UnusualWhales request exceeded retries', 0);
  }

  private buildRequestKey(method: string, endpoint: string): string {
    return `${method}:${endpoint}`;
  }

  private computeCacheKey(url: string): string {
    return `unusualwhales:${url}`;
  }

  private isRetryable(status: number): boolean {
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
    operation: string,
    start: number,
    attempt: number,
  ): Promise<void> {
    await this.rateLimiter.onError?.(key, error);
    await this.circuitBreaker?.onFailure?.(key, error);
    await this.metrics?.recordRequest?.({
      client: 'unusualwhales',
      operation,
      durationMs: Date.now() - start,
      status: error.status,
      cacheHit: false,
      attempt,
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
      `[UnusualWhalesClient] Retrying ${method} ${endpoint} after ${delayMs}ms due to status ${error.status}`,
    );

    await sleep(delayMs);
  }

  private async executeHttp(url: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
    if (!timeoutMs) {
      try {
        return await this.transport(url, init);
      } catch (error) {
        throw new UnusualWhalesRequestError(
          `UnusualWhales request failed: ${(error as Error)?.message ?? 'network error'}`,
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
      throw new UnusualWhalesRequestError(
        `UnusualWhales request failed: ${(error as Error)?.message ?? 'network error'}`,
        0,
      );
    } finally {
      clearTimeout(timeoutId);
      if (originalSignal) {
        originalSignal.removeEventListener('abort', abortHandler);
      }
    }
  }

  private buildUrl(path: string, params?: QueryParams): string {
    const url = new URL(path, this.baseUrl);
    if (params) {
      const entries = Object.entries(params).filter(([, value]) => value !== undefined);
      entries.sort(([a], [b]) => a.localeCompare(b));
      for (const [key, value] of entries) {
        if (value === undefined) {
          continue;
        }
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

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return undefined as T;
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
    maxRetries:
      overrides.maxRetries ??
      parseOptionalNumber(process.env.UNUSUALWHALES_MAX_RETRIES) ??
      DEFAULT_MAX_RETRIES,
    baseRetryDelayMs:
      overrides.baseRetryDelayMs ??
      parseOptionalNumber(process.env.UNUSUALWHALES_BASE_RETRY_DELAY_MS) ??
      DEFAULT_BASE_RETRY_DELAY_MS,
    timeoutMs:
      overrides.timeoutMs ??
      parseOptionalNumber(process.env.UNUSUALWHALES_TIMEOUT_MS) ??
      DEFAULT_TIMEOUT_MS,
    rateLimiter: overrides.rateLimiter,
    cache: overrides.cache,
    circuitBreaker: overrides.circuitBreaker,
    logger: overrides.logger,
    metrics: overrides.metrics,
    transport: overrides.transport,
    defaultCacheTtls: overrides.defaultCacheTtls,
  };

  return new UnusualWhalesClient(config);
}
