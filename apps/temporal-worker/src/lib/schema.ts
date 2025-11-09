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
