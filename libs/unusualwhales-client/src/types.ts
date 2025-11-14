export type CandleSize = '1m' | '5m' | '10m' | '15m' | '30m' | '1h' | '4h' | '1d';

export interface UwListResponse<T> {
  data: T[];
}

export interface UwValueResponse<T> {
  data: T;
}

export interface UwDatedListResponse<T> extends UwListResponse<T> {
  date?: string;
}

// -----------------------------------------------------------------------------
// Flow & option summaries
// -----------------------------------------------------------------------------

export interface UwFlowPerExpiryEntry {
  ticker: string;
  date: string;
  expiry: string;
  call_volume: number;
  call_trades: number;
  call_premium: string;
  call_volume_ask_side: number;
  call_volume_bid_side: number;
  call_premium_ask_side: string;
  call_premium_bid_side: string;
  call_otm_volume: number;
  call_otm_trades: number;
  call_otm_premium: string;
  put_volume: number;
  put_trades: number;
  put_premium: string;
  put_volume_ask_side: number;
  put_volume_bid_side: number;
  put_premium_ask_side: string;
  put_premium_bid_side: string;
  put_otm_volume: number;
  put_otm_trades: number;
  put_otm_premium: string;
}

export type UwFlowPerExpiryResponse = UwDatedListResponse<UwFlowPerExpiryEntry>;

export interface UwFlowPerStrikeEntry {
  ticker: string;
  date: string;
  strike: string;
  timestamp: string;
  call_volume: number;
  call_trades: number;
  call_premium: string;
  call_volume_ask_side: number;
  call_volume_bid_side: number;
  call_premium_ask_side: string;
  call_premium_bid_side: string;
  put_volume: number;
  put_trades: number;
  put_premium: string;
  put_volume_ask_side: number;
  put_volume_bid_side: number;
  put_premium_ask_side: string;
  put_premium_bid_side: string;
}

export type UwFlowPerStrikeResponse = UwFlowPerStrikeEntry[];

export interface UwGreeksRow {
  strike: string;
  date: string;
  expiry: string;
  call_delta?: string;
  call_gamma?: string;
  call_theta?: string;
  call_vega?: string;
  call_rho?: string;
  call_charm?: string;
  call_vanna?: string;
  call_volatility?: string;
  call_option_symbol?: string;
  put_delta?: string;
  put_gamma?: string;
  put_theta?: string;
  put_vega?: string;
  put_rho?: string;
  put_charm?: string;
  put_vanna?: string;
  put_volatility?: string;
  put_option_symbol?: string;
}

export type UwGreeksResponse = UwListResponse<UwGreeksRow>;

export interface UwOptionContract {
  option_symbol: string;
  volume: number;
  open_interest: number;
  prev_oi?: number;
  implied_volatility: string;
  total_premium: string;
  avg_price: string;
  last_price: string;
  high_price: string;
  low_price: string;
  ask_volume: number;
  bid_volume: number;
  mid_volume?: number;
  floor_volume?: number;
  sweep_volume?: number;
  multi_leg_volume?: number;
  stock_multi_leg_volume?: number;
  no_side_volume?: number;
  nbbo_ask?: string;
  nbbo_bid?: string;
}

export type UwOptionContractsResponse = UwListResponse<UwOptionContract>;

export type UwOptionChainsResponse = UwListResponse<string>;

export interface UwFlowAlert {
  ticker: string;
  option_chain: string;
  strike: string;
  expiry: string;
  type: 'call' | 'put';
  alert_rule: string;
  created_at: string;
  underlying_price: string;
  price: string;
  total_size: number;
  total_premium: string;
  total_ask_side_prem: string;
  total_bid_side_prem: string;
  trade_count: number;
  volume: number;
  open_interest: number;
  volume_oi_ratio: string;
  has_sweep: boolean;
  has_floor: boolean;
  has_multileg: boolean;
  has_singleleg: boolean;
  all_opening_trades: boolean;
  expiry_count: number;
}

export type UwFlowAlertsResponse = UwListResponse<UwFlowAlert>;

// -----------------------------------------------------------------------------
// Greek exposure & flow
// -----------------------------------------------------------------------------

export interface UwGreekExposurePoint {
  date: string;
  call_charm: string;
  call_delta: string;
  call_gamma: string;
  call_vanna: string;
  put_charm: string;
  put_delta: string;
  put_gamma: string;
  put_vanna: string;
}

export type UwGreekExposureResponse = UwListResponse<UwGreekExposurePoint>;

export interface UwGreekExposureByExpiryPoint extends UwGreekExposurePoint {
  expiry: string;
  dte?: number;
}

export type UwGreekExposureByExpiryResponse = UwListResponse<UwGreekExposureByExpiryPoint>;

export interface UwGreekExposureByStrikePoint extends UwGreekExposurePoint {
  strike: string;
}

export type UwGreekExposureByStrikeResponse = UwListResponse<UwGreekExposureByStrikePoint>;

export interface UwGreekExposureByStrikeAndExpiryPoint extends UwGreekExposureByStrikePoint {
  expiry: string;
}

export type UwGreekExposureByStrikeAndExpiryResponse = UwListResponse<UwGreekExposureByStrikeAndExpiryPoint>;

export interface UwGreekFlowPoint {
  ticker: string;
  timestamp: string;
  dir_delta_flow: string;
  dir_vega_flow: string;
  otm_dir_delta_flow: string;
  otm_dir_vega_flow: string;
  otm_total_delta_flow: string;
  otm_total_vega_flow: string;
  total_delta_flow: string;
  total_vega_flow: string;
  transactions: number;
  volume: number;
}

export type UwGreekFlowResponse = UwListResponse<UwGreekFlowPoint>;

export interface UwGroupFlowPoint extends UwGreekFlowPoint {
  flow_group: string;
  net_call_premium: string;
  net_call_volume: number;
  net_put_premium: string;
  net_put_volume: number;
}

export type UwGroupFlowResponse = UwListResponse<UwGroupFlowPoint>;

// -----------------------------------------------------------------------------
// Short interest & dark pool
// -----------------------------------------------------------------------------

export interface UwShortDataPoint {
  currency: string;
  fee_rate: string;
  name: string;
  rebate_rate: string;
  short_shares_available: number;
  symbol: string;
  timestamp: string;
}

export type UwShortDataResponse = UwListResponse<UwShortDataPoint>;

export interface UwShortInterestAndFloat {
  created_at: string;
  days_to_cover_returned: string;
  market_date: string;
  percent_returned: string;
  si_float_returned: number;
  symbol: string;
  total_float_returned: number;
}

export type UwShortInterestAndFloatResponse = UwValueResponse<UwShortInterestAndFloat>;

export interface UwShortVolumeEntry {
  market_date: string;
  short_volume: string;
  short_volume_ratio: string;
  total_volume: string;
  close_price: string;
}

export type UwShortVolumeResponse = UwListResponse<UwShortVolumeEntry>;

export interface UwShortVolumeByExchangeEntry {
  date: string;
  exchange_name: string;
  market_center: string;
  short_volume: number;
  total_volume: number;
}

export type UwShortVolumeByExchangeResponse = UwListResponse<UwShortVolumeByExchangeEntry>;

export interface UwFailureToDeliverEntry {
  date: string;
  price: string;
  quantity: string;
}

export type UwFailuresToDeliverResponse = UwListResponse<UwFailureToDeliverEntry>;

export interface UwDarkPoolTrade {
  ticker: string;
  executed_at: string;
  premium: string;
  price: string;
  size: number;
  volume: number;
  canceled: boolean;
  ext_hour_sold_codes?: string;
  market_center?: string;
  nbbo_ask?: string;
  nbbo_ask_quantity?: number;
  nbbo_bid?: string;
  nbbo_bid_quantity?: number;
  sale_cond_codes?: string;
  trade_code?: string;
  trade_settlement?: string;
  tracking_id?: number;
}

export type UwDarkPoolTradesResponse = UwListResponse<UwDarkPoolTrade>;

export interface UwOffLitPriceLevel {
  price: string;
  lit_vol: number;
  off_vol: number;
}

export type UwOffLitPriceLevelsResponse = UwListResponse<UwOffLitPriceLevel>;

// -----------------------------------------------------------------------------
// Open interest & NOPE metrics
// -----------------------------------------------------------------------------

export interface UwOpenInterestPerExpiryEntry {
  date: string;
  expiry: string;
  call_oi: number;
  put_oi: number;
}

export type UwOpenInterestPerExpiryResponse = UwListResponse<UwOpenInterestPerExpiryEntry>;

export interface UwOpenInterestPerStrikeEntry {
  date: string;
  strike: string;
  call_oi: number;
  put_oi: number;
}

export type UwOpenInterestPerStrikeResponse = UwListResponse<UwOpenInterestPerStrikeEntry>;

export interface UwOiChangeEntry {
  option_symbol: string;
  underlying_symbol: string;
  curr_date: string;
  last_date: string;
  curr_oi: number;
  last_oi: number;
  oi_diff_plain: number;
  oi_change: string;
  volume: number;
  trades: number;
  avg_price: string;
  last_ask: string;
  last_bid: string;
  last_fill: string;
  prev_total_premium: string;
  prev_ask_volume?: number;
  prev_bid_volume?: number;
  prev_mid_volume?: number;
  prev_multi_leg_volume?: number;
  prev_neutral_volume?: number;
  prev_stock_multi_leg_volume?: number;
  rnk?: number;
  percentage_of_total?: string;
}

export type UwOiChangeResponse = UwListResponse<UwOiChangeEntry>;

export interface UwMaxPainPoint {
  expiry: string;
  max_pain: string;
}

export type UwMaxPainResponse = UwDatedListResponse<UwMaxPainPoint>;

export interface UwNopePoint {
  timestamp: string;
  call_delta: string;
  call_fill_delta: string;
  call_vol: number;
  put_delta: string;
  put_fill_delta: string;
  put_vol: number;
  stock_vol: number;
  nope: string;
  nope_fill: string;
}

export type UwNopeResponse = UwListResponse<UwNopePoint>;

export interface UwCandle {
  open: string;
  high: string;
  low: string;
  close: string;
  start_time?: string;
  end_time?: string;
  market_time?: string;
  volume?: number;
  total_volume?: number;
}

export type UwOhlcResponse = UwListResponse<UwCandle>;

// -----------------------------------------------------------------------------
// Spot exposures
// -----------------------------------------------------------------------------

export interface UwSpotGexExposurePoint {
  time: string;
  price: string;
  charm_per_one_percent_move_dir: string;
  charm_per_one_percent_move_oi: string;
  charm_per_one_percent_move_vol: string;
  gamma_per_one_percent_move_dir: string;
  gamma_per_one_percent_move_oi: string;
  gamma_per_one_percent_move_vol: string;
  vanna_per_one_percent_move_dir: string;
  vanna_per_one_percent_move_oi: string;
  vanna_per_one_percent_move_vol: string;
}

export type UwSpotExposuresResponse = UwListResponse<UwSpotGexExposurePoint>;

export interface UwSpotGreekExposureByStrikeEntry {
  time?: string;
  strike?: string;
  price?: string;
  call_charm_ask: string;
  call_charm_bid: string;
  call_charm_oi: string;
  call_charm_vol: string;
  call_delta_ask: string;
  call_delta_bid: string;
  call_delta_oi: string;
  call_delta_vol: string;
  call_gamma_ask: string;
  call_gamma_bid: string;
  call_gamma_oi: string;
  call_gamma_vol: string;
  call_vanna_ask: string;
  call_vanna_bid: string;
  call_vanna_oi: string;
  call_vanna_vol: string;
  put_charm_ask: string;
  put_charm_bid: string;
  put_charm_oi: string;
  put_charm_vol: string;
  put_delta_ask: string;
  put_delta_bid: string;
  put_delta_oi: string;
  put_delta_vol: string;
  put_gamma_ask: string;
  put_gamma_bid: string;
  put_gamma_oi: string;
  put_gamma_vol: string;
  put_vanna_ask: string;
  put_vanna_bid: string;
  put_vanna_oi: string;
  put_vanna_vol: string;
}

export type UwSpotExposuresByStrikeResponse = UwListResponse<UwSpotGreekExposureByStrikeEntry>;

// -----------------------------------------------------------------------------
// Seasonality & institutions
// -----------------------------------------------------------------------------

export interface UwMarketSeasonalityRow {
  ticker: string;
  month: number;
  years: number;
  avg_change: string;
  max_change: string;
  median_change: string;
  min_change: string;
  positive_closes: number;
  positive_months_perc: string;
}

export type UwMarketSeasonalityResponse = UwListResponse<UwMarketSeasonalityRow>;

export interface UwSeasonalityPerformer {
  ticker: string;
  sector: string;
  month: number;
  years: number;
  avg_change: string;
  median_change: string;
  max_change: string;
  min_change: string;
  positive_closes: number;
  positive_months_perc: string;
  marketcap: string;
}

export type UwSeasonalityPerformersResponse = UwListResponse<UwSeasonalityPerformer>;

export interface UwSeasonalityMonthlyRow {
  month: number;
  years: number;
  avg_change: number;
  median_change: number;
  max_change: number;
  min_change: number;
  positive_closes: number;
  positive_months_perc: number;
}

export type UwSeasonalityMonthlyResponse = UwListResponse<UwSeasonalityMonthlyRow>;

export interface UwSeasonalityYearMonthRow {
  year: number;
  month: number;
  open: number;
  close: number;
  change: string;
}

export type UwSeasonalityYearMonthResponse = UwListResponse<UwSeasonalityYearMonthRow>;

export interface UwInstitutionHolding {
  ticker: string;
  full_name: string;
  sector: string;
  security_type: string;
  date: string;
  first_buy: string;
  avg_price: string;
  price_first_buy: string;
  close: string;
  historical_units: number[];
  perc_of_share_value: number;
  perc_of_total: number;
  shares_outstanding: string;
  units: number;
  units_change: number;
  value: number;
  put_call?: string;
}

export type UwInstitutionHoldingsResponse = UwListResponse<UwInstitutionHolding>;

export interface UwTopNetImpactRow {
  ticker: string;
  net_premium: number;
}

export type UwTopNetImpactResponse = UwListResponse<UwTopNetImpactRow>;

// -----------------------------------------------------------------------------
// Request parameter interfaces
// -----------------------------------------------------------------------------

export interface FlowPerStrikeParams {
  date?: string;
}

export interface GreeksParams {
  expiry: string;
  date?: string;
}

export interface OptionChainsParams {
  date?: string;
}

export interface OptionContractsParams {
  expiry?: string;
  optionType?: 'call' | 'Call' | 'put' | 'Put';
  volGreaterThanOpenInterest?: boolean;
  excludeZeroVolChains?: boolean;
  excludeZeroDte?: boolean;
  excludeZeroOiChains?: boolean;
  otmOnly?: boolean;
  optionSymbols?: string[];
  limit?: number;
  page?: number;
}

export interface GreekExposureParams {
  date?: string;
  timeframe?: string;
}

export interface GreekExposureByExpiryParams {
  date?: string;
}

export interface GreekExposureByStrikeParams {
  date?: string;
}

export interface GreekExposureByStrikeAndExpiryParams extends GreekExposureByStrikeParams {
  expiry: string;
}

export interface GreekFlowParams {
  date?: string;
}

export interface GroupGreekFlowParams {
  date?: string;
}

export interface FlowAlertsParams {
  tickerSymbol?: string;
  minPremium?: number;
  maxPremium?: number;
  minSize?: number;
  maxSize?: number;
  minVolume?: number;
  maxVolume?: number;
  minOpenInterest?: number;
  maxOpenInterest?: number;
  allOpening?: boolean;
  isFloor?: boolean;
  isSweep?: boolean;
  isCall?: boolean;
  isPut?: boolean;
  isAskSide?: boolean;
  isBidSide?: boolean;
  ruleNames?: string[];
  minDiff?: number;
  maxDiff?: number;
  minVolumeOiRatio?: number;
  maxVolumeOiRatio?: number;
  isOtm?: boolean;
  issueTypes?: string[];
  minDte?: number;
  maxDte?: number;
  minAskPercentage?: number;
  maxAskPercentage?: number;
  minBidPercentage?: number;
  maxBidPercentage?: number;
  minBullPercentage?: number;
  maxBullPercentage?: number;
  minBearPercentage?: number;
  maxBearPercentage?: number;
  minSkew?: number;
  maxSkew?: number;
  minPrice?: number;
  maxPrice?: number;
  minIvChange?: number;
  maxIvChange?: number;
  minSizeVolumeRatio?: number;
  maxSizeVolumeRatio?: number;
  minSpread?: number;
  maxSpread?: number;
  minMarketcap?: number;
  maxMarketcap?: number;
  isMultiLeg?: boolean;
  sizeGreaterThanOi?: boolean;
  volumeGreaterThanOi?: boolean;
  newerThan?: string | number;
  olderThan?: string | number;
  limit?: number;
}

export interface DarkPoolRecentParams {
  limit?: number;
  date?: string;
  minPremium?: number;
  maxPremium?: number;
  minSize?: number;
  maxSize?: number;
  minVolume?: number;
  maxVolume?: number;
}

export interface DarkPoolTickerParams extends DarkPoolRecentParams {
  newerThan?: string | number;
  olderThan?: string | number;
}

export interface OffLitPriceLevelsParams {
  date?: string;
}

export interface OiPerExpiryParams {
  date?: string;
}

export interface OiChangeParams {
  date?: string;
  limit?: number;
  page?: number;
  order?: 'asc' | 'desc';
}

export interface MaxPainParams {
  date?: string;
}

export interface NopeParams {
  date?: string;
}

export interface OhlcParams {
  timeframe?: string;
  endDate?: string;
  date?: string;
  limit?: number;
}

export interface TopNetImpactParams {
  date?: string;
  issueTypes?: string[];
  limit?: number;
}

export interface SeasonalityMonthPerformersParams {
  minYears?: number;
  tickerForSector?: string;
  sp500NasdaqOnly?: boolean;
  minOpenInterest?: number;
  limit?: number;
  order?: SeasonalityPerformanceOrderBy;
  orderDirection?: 'asc' | 'desc';
}

export type SeasonalityPerformanceOrderBy =
  | 'month'
  | 'positive_closes'
  | 'years'
  | 'positive_months_perc'
  | 'median_change'
  | 'avg_change'
  | 'max_change'
  | 'min_change';

export interface SpotExposuresParams {
  date?: string;
}

export interface SpotExposuresByStrikeParams extends SpotExposuresParams {
  minStrike?: number;
  maxStrike?: number;
  limit?: number;
  page?: number;
}

export interface SpotExposuresByExpiryStrikeParams extends SpotExposuresByStrikeParams {
  expirations: string[];
  minDte?: number;
  maxDte?: number;
}

