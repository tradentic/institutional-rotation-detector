-- ========================================
-- Microstructure Schema
-- ========================================
-- High-frequency market microstructure signals for early rotation detection (1-3 day lag vs 45-day 13F).
-- Includes FINRA OTC (off-exchange), IEX HIST (on-exchange), broker attribution, VPIN, Kyle's Lambda.

-- FINRA OTC venue-level weekly data
create table micro_offex_venue_weekly (
  id bigserial primary key,
  symbol text not null,
  week_end date not null,
  product text,
  source text check (source in ('ATS','NON_ATS')) not null,
  venue_id text,
  total_shares numeric,
  total_trades numeric,
  finra_file_id text,
  finra_sha256 text,
  created_at timestamptz default now(),
  unique (symbol, week_end, source, coalesce(venue_id, '-'))
);

-- FINRA OTC symbol-level weekly aggregate
create table micro_offex_symbol_weekly (
  symbol text not null,
  week_end date not null,
  product text,
  ats_shares numeric default 0,
  nonats_shares numeric default 0,
  offex_shares numeric generated always as (coalesce(ats_shares,0) + coalesce(nonats_shares,0)) stored,
  finra_file_id text,
  finra_sha256 text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (symbol, week_end)
);

-- IEX HIST daily matched volume (on-exchange proxy)
create table micro_iex_volume_daily (
  symbol text not null,
  trade_date date not null,
  matched_shares numeric not null,
  iex_file_id text,
  iex_sha256 text,
  created_at timestamptz default now(),
  primary key (symbol, trade_date)
);

-- Consolidated volume (optional SIP/exchange data)
create table micro_consolidated_volume_daily (
  symbol text not null,
  trade_date date not null,
  total_shares numeric,
  source text,
  quality_flag text,
  created_at timestamptz default now(),
  primary key (symbol, trade_date)
);

-- Off-exchange percentage time series
create table micro_offex_ratio (
  symbol text not null,
  as_of date not null,
  granularity text check (granularity in ('weekly','daily')) not null,
  offex_shares numeric,
  on_ex_shares numeric,
  offex_pct numeric,
  quality_flag text,
  basis_window daterange,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (symbol, as_of, granularity)
);

comment on table micro_offex_ratio is 'Off-exchange percentage: weekly official (FINRA) + daily approximations';

-- Flip50 events (off-exchange % crossing below 50% threshold)
create table micro_flip50_events (
  id bigserial primary key,
  symbol text not null,
  flip_date date not null,
  pre_period_start date not null,
  pre_period_days integer not null,
  pre_avg_offex_pct numeric not null,
  flip_offex_pct numeric not null,
  quality_flag text,
  created_at timestamptz default now(),
  unique (symbol, flip_date)
);

comment on table micro_flip50_events is 'Detects when off-exchange % drops below 50% after sustained high period';

-- Short interest points (semi-monthly FINRA)
create table micro_short_interest_points (
  symbol text not null,
  settlement_date date not null,
  publication_date date,
  short_interest bigint,
  avg_daily_volume bigint,
  days_to_cover numeric,
  source text default 'FINRA',
  finra_file_id text,
  finra_sha256 text,
  created_at timestamptz default now(),
  primary key (symbol, settlement_date)
);

-- Broker-dealer to institution mapping
create table micro_broker_institution_map (
  id bigserial primary key,
  broker_mpid text not null,
  broker_name text,
  institution_cik text,
  institution_id uuid references entities(entity_id),
  relationship_type text check (
    relationship_type in ('prime_broker', 'clearing', 'internal', 'affiliate', 'inferred')
  ) not null,
  relationship_strength numeric check (relationship_strength between 0 and 1) default 0.5,
  confidence_score numeric check (confidence_score between 0 and 1) default 0.5,
  first_observed_date date,
  last_observed_date date,
  observation_count integer default 0,
  avg_block_size bigint,
  source text default 'INFERRED',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (broker_mpid, institution_cik)
);

comment on table micro_broker_institution_map is 'Maps broker MPIDs to institutions for flow attribution';

-- Institutional flow attribution
create table micro_institutional_flow (
  id bigserial primary key,
  symbol text not null,
  trade_date date not null,
  institution_id uuid references entities(entity_id),
  institution_cik text,
  broker_mpid text,
  flow_direction text check (flow_direction in ('buy', 'sell', 'unknown')) not null,
  shares bigint not null,
  trades integer,
  attribution_confidence numeric check (attribution_confidence between 0 and 1),
  source text default 'ATS',
  venue_id text,
  created_at timestamptz default now(),
  unique (symbol, trade_date, institution_id, broker_mpid, flow_direction)
);

comment on table micro_institutional_flow is 'Daily institutional flows attributed from ATS data via broker mapping';

-- Trade classification (Lee-Ready algorithm)
create table micro_trade_classification (
  symbol text not null,
  trade_date date not null,
  trade_direction text check (trade_direction in ('buy', 'sell', 'neutral')) not null,
  total_buy_volume bigint default 0,
  total_sell_volume bigint default 0,
  total_neutral_volume bigint default 0,
  order_imbalance numeric,
  buy_trades integer default 0,
  sell_trades integer default 0,
  neutral_trades integer default 0,
  avg_trade_size bigint,
  classification_method text default 'LEE_READY',
  quality_flag text,
  created_at timestamptz default now(),
  primary key (symbol, trade_date)
);

comment on table micro_trade_classification is 'Daily trade classification (buy/sell) using Lee-Ready algorithm';

-- Microstructure metrics (VPIN, Kyle's Lambda, spreads)
create table micro_metrics_daily (
  symbol text not null,
  trade_date date not null,
  vpin numeric check (vpin between 0 and 1),
  vpin_window_bars integer,
  vpin_quality_flag text,
  kyles_lambda numeric,
  kyles_lambda_se numeric,
  kyles_lambda_r2 numeric,
  daily_order_imbalance numeric,
  imbalance_persistence numeric,
  quoted_spread_bps numeric,
  effective_spread_bps numeric,
  realized_spread_bps numeric,
  price_impact_bps numeric,
  adverse_selection_component numeric,
  informed_trading_probability numeric,
  total_volume bigint,
  block_trade_volume bigint,
  block_trade_ratio numeric,
  computation_timestamp timestamptz default now(),
  data_completeness numeric,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (symbol, trade_date)
);

comment on table micro_metrics_daily is 'Daily microstructure metrics: VPIN, Kyles lambda, spreads, toxicity';
comment on column micro_metrics_daily.vpin is 'VPIN (0-1): Volume-Synchronized Probability of Informed Trading';
comment on column micro_metrics_daily.kyles_lambda is 'Price impact per unit volume (bps per $1M)';
