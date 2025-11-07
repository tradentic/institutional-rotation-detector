export interface FilingRecord {
  accession: string;
  cik: string;
  form: string;
  filed_date: string;
  period_end?: string | null;
  event_date?: string | null;
  url: string;
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
