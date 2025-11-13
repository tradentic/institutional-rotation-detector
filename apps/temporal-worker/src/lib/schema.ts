export type FilingCadence = 'annual' | 'semiannual' | 'quarterly' | 'monthly' | 'event' | 'adhoc';

export interface FilingRecord {
  accession: string;
  cik: string;
  form: string;
  filed_date: string;
  period_end?: string | null;
  event_date?: string | null;
  url: string;
  cadence?: FilingCadence | null;
  expected_publish_at?: string | null;
  published_at?: string | null;
  is_amendment?: boolean;
  amendment_of_accession?: string | null;
}

export interface Position13FRecord {
  entity_id: string;
  cusip: string;
  asof: string;
  shares: number;
  opt_put_shares: number;
  opt_call_shares: number;
  accession: string;
}

export interface RotationEdgeRecord {
  cluster_id: string;
  period_start: string;
  period_end: string;
  seller_id: string | null;
  buyer_id: string | null;
  cusip: string;
  equity_shares: number;
  options_shares: number;
  confidence: number;
  notes?: string | null;
}

export interface RotationEventRecord {
  cluster_id: string;
  issuer_cik: string;
  anchor_filing: string | null;
  dumpz: number;
  u_same: number;
  u_next: number;
  uhf_same: number;
  uhf_next: number;
  opt_same: number;
  opt_next: number;
  shortrelief_v2: number;
  index_penalty: number;
  eow: boolean;
  r_score: number;
  car_m5_p20: number;
  t_to_plus20_days: number;
  max_ret_w13: number;
  // Microstructure integration (Problem 8)
  microstructure_vpin?: number | null;
  microstructure_kyle_lambda?: number | null;
  microstructure_order_imbalance?: number | null;
  microstructure_confidence?: number | null;
  microstructure_attribution_entity_id?: string | null;
  microstructure_detected_at?: string | null;
}

// ============================================================================
// Microstructure Ingest Schema (FINRA OTC + IEX HIST + Short Interest)
// ============================================================================

export type OffExSource = 'ATS' | 'NON_ATS';
export type OffExGranularity = 'weekly' | 'daily';
export type OffExQualityFlag = 'official' | 'official_partial' | 'approx' | 'iex_proxy';
export type ConsolidatedVolumeSource = 'SIP' | 'EXCHANGE_SUM' | 'VENDOR';
export type EventStudyStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface MicroOffExVenueWeeklyRecord {
  id?: number;
  symbol: string;
  week_end: string;
  product?: string | null;
  source: OffExSource;
  venue_id?: string | null;
  total_shares?: number | null;
  total_trades?: number | null;
  finra_file_id?: string | null;
  finra_sha256?: string | null;
  created_at?: string;
}

export interface MicroOffExSymbolWeeklyRecord {
  symbol: string;
  week_end: string;
  product?: string | null;
  ats_shares?: number;
  nonats_shares?: number;
  offex_shares?: number; // generated column
  finra_file_id?: string | null;
  finra_sha256?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface MicroIexVolumeDailyRecord {
  symbol: string;
  trade_date: string;
  matched_shares: number;
  iex_file_id?: string | null;
  iex_sha256?: string | null;
  created_at?: string;
}

export interface MicroConsolidatedVolumeDailyRecord {
  symbol: string;
  trade_date: string;
  total_shares?: number | null;
  source?: ConsolidatedVolumeSource | null;
  quality_flag?: string | null;
  created_at?: string;
}

export interface MicroOffExRatioRecord {
  symbol: string;
  as_of: string;
  granularity: OffExGranularity;
  offex_shares?: number | null;
  on_ex_shares?: number | null;
  offex_pct?: number | null;
  quality_flag?: OffExQualityFlag | null;
  basis_window?: string | null; // PostgreSQL daterange as string
  created_at?: string;
  updated_at?: string;
}

export interface MicroShortInterestPointRecord {
  symbol: string;
  settlement_date: string;
  publication_date?: string | null;
  short_interest?: number | null;
  avg_daily_volume?: number | null;
  days_to_cover?: number | null;
  source?: string;
  finra_file_id?: string | null;
  finra_sha256?: string | null;
  created_at?: string;
}

export interface MicroFlip50EventRecord {
  id?: number;
  symbol: string;
  flip_date: string;
  pre_period_start?: string | null;
  pre_period_days?: number | null;
  pre_avg_offex_pct?: number | null;
  flip_offex_pct?: number | null;
  quality_flag?: OffExQualityFlag | null;
  created_at?: string;
}

export interface MicroFlip50EventStudyRecord {
  flip50_id: number;
  rotation_event_id?: number | null;
  study_status?: EventStudyStatus;
  car_m5_p20?: number | null;
  max_ret_w13?: number | null;
  t_to_plus20_days?: number | null;
  created_at?: string;
  updated_at?: string;
}

// ============================================================================
// Advanced Microstructure Schema (Broker Mapping, Flow Attribution, Metrics)
// ============================================================================

export type BrokerRelationshipType = 'prime_broker' | 'clearing' | 'internal' | 'affiliate' | 'inferred';
export type BrokerType = 'WIREHOUSE' | 'PRIME_BROKER' | 'RETAIL' | 'HFT' | 'MARKET_MAKER' | 'DARK_POOL' | 'OTHER';
export type FlowDirection = 'buy' | 'sell' | 'unknown';
export type TradeDirection = 'buy' | 'sell' | 'neutral';
export type ClassificationMethod = 'LEE_READY' | 'TICK_TEST' | 'QUOTE_RULE';
export type MicroQualityFlag = 'HIGH' | 'MEDIUM' | 'LOW';

export interface MicroBrokerInstitutionMapRecord {
  id?: number;
  broker_mpid: string;
  broker_name?: string | null;
  institution_cik?: string | null;
  institution_id?: string | null;
  relationship_type: BrokerRelationshipType;
  relationship_strength?: number;
  confidence_score?: number;
  first_observed_date?: string | null;
  last_observed_date?: string | null;
  observation_count?: number;
  avg_block_size?: number | null;
  source?: string;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface MicroInstitutionalFlowRecord {
  id?: number;
  symbol: string;
  trade_date: string;
  institution_id?: string | null;
  institution_cik?: string | null;
  broker_mpid?: string | null;
  flow_direction: FlowDirection;
  shares: number;
  trades?: number | null;
  attribution_confidence?: number | null;
  source?: string;
  venue_id?: string | null;
  created_at?: string;
}

export interface MicroTradeClassificationRecord {
  symbol: string;
  trade_date: string;
  trade_direction: TradeDirection;
  total_buy_volume?: number;
  total_sell_volume?: number;
  total_neutral_volume?: number;
  order_imbalance?: number | null;
  buy_trades?: number;
  sell_trades?: number;
  neutral_trades?: number;
  avg_trade_size?: number | null;
  classification_method?: ClassificationMethod;
  quality_flag?: MicroQualityFlag | null;
  created_at?: string;
}

export interface MicroMetricsDailyRecord {
  symbol: string;
  trade_date: string;

  // VPIN
  vpin?: number | null;
  vpin_window_bars?: number | null;
  vpin_quality_flag?: MicroQualityFlag | null;

  // Kyle's Lambda
  kyles_lambda?: number | null;
  kyles_lambda_se?: number | null;
  kyles_lambda_r2?: number | null;

  // Order imbalance
  daily_order_imbalance?: number | null;
  imbalance_persistence?: number | null;

  // Spreads
  quoted_spread_bps?: number | null;
  effective_spread_bps?: number | null;
  realized_spread_bps?: number | null;
  price_impact_bps?: number | null;

  // Toxicity
  adverse_selection_component?: number | null;
  informed_trading_probability?: number | null;

  // Volume
  total_volume?: number | null;
  block_trade_volume?: number | null;
  block_trade_ratio?: number | null;

  // Quality
  computation_timestamp?: string | null;
  data_completeness?: number | null;

  created_at?: string;
  updated_at?: string;
}

export interface MicroBrokerMasterRecord {
  broker_mpid: string;
  broker_name: string;
  broker_cik?: string | null;
  broker_type?: BrokerType | null;
  parent_company?: string | null;
  is_active?: boolean;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}
