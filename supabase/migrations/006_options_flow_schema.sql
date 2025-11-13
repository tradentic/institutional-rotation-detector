-- ========================================
-- Options Flow Schema
-- ========================================
-- Real-time options activity for predictive rotation signals.
-- Data source: UnusualWhales API

-- ========================================
-- OPTIONS CHAIN DAILY
-- ========================================
-- Daily snapshot of full options chain with greeks and volume

create table options_chain_daily (
  id bigserial primary key,

  -- Security identification
  ticker text not null,
  trade_date date not null,

  -- Option details
  expiration_date date not null,
  strike numeric not null,
  option_type text check (option_type in ('call', 'put')) not null,

  -- Market data
  bid numeric,
  ask numeric,
  last_price numeric,
  mark numeric,

  -- Volume and open interest
  volume bigint,
  open_interest bigint,
  volume_oi_ratio numeric,

  -- Greeks
  delta numeric,
  gamma numeric,
  theta numeric,
  vega numeric,
  rho numeric,

  -- Implied volatility
  implied_volatility numeric,
  iv_rank numeric,
  iv_percentile numeric,

  -- Metadata
  underlying_price numeric,
  days_to_expiration integer,
  is_weekly boolean default false,
  is_monthly boolean default true,

  -- Source tracking
  data_source text default 'UNUSUALWHALES',
  ingested_at timestamptz default now(),

  unique (ticker, trade_date, expiration_date, strike, option_type)
);

create index options_chain_daily_ticker_date_idx
  on options_chain_daily(ticker, trade_date desc);
create index options_chain_daily_expiry_idx
  on options_chain_daily(expiration_date);
create index options_chain_daily_volume_oi_idx
  on options_chain_daily(volume_oi_ratio desc)
  where volume_oi_ratio > 3.0;
create index options_chain_daily_volume_idx
  on options_chain_daily(volume desc)
  where volume > 1000;

comment on table options_chain_daily is
  'Daily snapshot of full options chain with greeks, volume, OI, and IV';
comment on column options_chain_daily.volume_oi_ratio is
  'Ratio of daily volume to open interest. >3.0 indicates new positioning (unusual activity)';

-- ========================================
-- OPTIONS FLOW
-- ========================================
-- Real-time options flow: individual large transactions

create table options_flow (
  id bigserial primary key,

  -- Timing
  ticker text not null,
  trade_datetime timestamptz not null,
  trade_date date not null,

  -- Option details
  expiration_date date not null,
  strike numeric not null,
  option_type text check (option_type in ('call', 'put')) not null,

  -- Transaction details
  contract_count integer not null,
  premium_paid numeric,
  fill_price numeric,
  underlying_price numeric,

  -- Trade classification
  sentiment text check (sentiment in ('bullish', 'bearish', 'neutral')),
  trade_side text check (trade_side in ('buy', 'sell', 'unknown')),
  is_sweep boolean default false,
  is_block boolean default false,
  is_aggressive boolean default false,

  -- Greeks at time of trade
  delta numeric,
  implied_volatility numeric,

  -- Unusual activity flags
  is_unusual boolean default false,
  volume_oi_ratio numeric,
  premium_percentile numeric,

  -- Source metadata
  data_source text default 'UNUSUALWHALES',
  source_transaction_id text,
  ingested_at timestamptz default now(),

  unique (ticker, trade_datetime, expiration_date, strike, option_type, contract_count)
);

create index options_flow_ticker_date_idx
  on options_flow(ticker, trade_date desc);
create index options_flow_datetime_idx
  on options_flow(trade_datetime desc);
create index options_flow_unusual_idx
  on options_flow(ticker, trade_date desc)
  where is_unusual = true;
create index options_flow_block_idx
  on options_flow(ticker, trade_date desc)
  where is_block = true;
create index options_flow_sweep_idx
  on options_flow(ticker, trade_date desc)
  where is_sweep = true;

comment on table options_flow is
  'Real-time options flow transactions. Captures large/unusual trades for rotation prediction.';
comment on column options_flow.is_sweep is
  'Multi-exchange sweep order (typically institutional, very bullish/bearish)';
comment on column options_flow.is_aggressive is
  'Whether order took liquidity (crossed spread) vs provided liquidity';

-- ========================================
-- OPTIONS SUMMARY DAILY
-- ========================================
-- Aggregated daily options activity for efficient querying

create table options_summary_daily (
  ticker text not null,
  trade_date date not null,

  -- Aggregate volume
  total_call_volume bigint default 0,
  total_put_volume bigint default 0,
  total_call_oi bigint default 0,
  total_put_oi bigint default 0,

  -- Ratios
  put_call_ratio_volume numeric,
  put_call_ratio_oi numeric,

  -- Premium metrics
  total_call_premium numeric,
  total_put_premium numeric,
  net_premium numeric,

  -- Implied volatility
  atm_call_iv numeric,
  atm_put_iv numeric,
  iv_skew numeric,
  iv_30day numeric,

  -- Unusual activity counts
  unusual_call_count integer default 0,
  unusual_put_count integer default 0,
  sweep_call_count integer default 0,
  sweep_put_count integer default 0,
  block_call_count integer default 0,
  block_put_count integer default 0,

  -- Flow direction
  net_call_delta numeric,
  net_put_delta numeric,
  total_premium_bullish numeric,
  total_premium_bearish numeric,

  -- Market context
  underlying_close numeric,
  underlying_volume bigint,

  -- Metadata
  computed_at timestamptz default now(),
  primary key (ticker, trade_date)
);

create index options_summary_daily_date_idx
  on options_summary_daily(trade_date desc);
create index options_summary_daily_pc_ratio_idx
  on options_summary_daily(put_call_ratio_volume desc)
  where put_call_ratio_volume > 1.5;
create index options_summary_daily_iv_skew_idx
  on options_summary_daily(iv_skew desc)
  where iv_skew is not null;
create index options_summary_daily_unusual_idx
  on options_summary_daily(trade_date desc)
  where unusual_call_count + unusual_put_count > 0;

comment on table options_summary_daily is
  'Daily aggregated options activity metrics for rotation detection';
comment on column options_summary_daily.put_call_ratio_volume is
  'Put/Call ratio by volume. >2.0 = extreme bearish sentiment, <0.5 = extreme bullish';
comment on column options_summary_daily.iv_skew is
  'IV skew (put IV - call IV). Positive skew = fear (demand for downside protection)';

-- ========================================
-- UNUSUAL OPTIONS ACTIVITY
-- ========================================
-- Pre-aggregated unusual activity events for alerts

create table unusual_options_activity (
  id bigserial primary key,

  -- Identification
  ticker text not null,
  trade_date date not null,
  detected_at timestamptz not null,

  -- Unusual pattern details
  activity_type text check (
    activity_type in (
      'LARGE_PUT_BUYING',
      'LARGE_CALL_BUYING',
      'PUT_SPREAD_SURGE',
      'CALL_SPREAD_SURGE',
      'STRADDLE_STRANGLE',
      'SWEEP_CLUSTER',
      'DARK_POOL_HEDGE',
      'IV_SPIKE',
      'OI_BUILDUP'
    )
  ) not null,

  -- Metrics
  contract_count integer,
  total_premium numeric,
  avg_implied_volatility numeric,
  sentiment text check (sentiment in ('bullish', 'bearish', 'neutral')),

  -- Context
  underlying_price numeric,
  expiration_date date,
  strikes_involved text[],
  days_to_expiration integer,

  -- Significance
  signal_strength numeric check (signal_strength between 0 and 1),
  vs_avg_volume_ratio numeric,
  percentile_rank numeric,

  -- Metadata
  description text,
  source text default 'UNUSUALWHALES',
  ingested_at timestamptz default now()
);

create index unusual_options_activity_ticker_date_idx
  on unusual_options_activity(ticker, trade_date desc);
create index unusual_options_activity_detected_idx
  on unusual_options_activity(detected_at desc);
create index unusual_options_activity_type_idx
  on unusual_options_activity(activity_type, trade_date desc);
create index unusual_options_activity_signal_idx
  on unusual_options_activity(signal_strength desc)
  where signal_strength > 0.7;

comment on table unusual_options_activity is
  'Pre-detected unusual options activity patterns for rotation prediction';
comment on column unusual_options_activity.signal_strength is
  'Composite signal strength (0-1) based on volume, premium, IV, and timing';

-- ========================================
-- OPTIONS HISTORICAL BASELINES
-- ========================================
-- Store historical IV, volume baselines for comparison

create table options_historical_baselines (
  ticker text not null,
  as_of_date date not null,

  -- Volume baselines
  avg_daily_call_volume_30d bigint,
  avg_daily_put_volume_30d bigint,
  avg_daily_total_volume_30d bigint,

  -- OI baselines
  avg_call_oi_30d bigint,
  avg_put_oi_30d bigint,

  -- IV baselines
  avg_iv_30d numeric,
  avg_iv_skew_30d numeric,

  -- Put/Call baselines
  avg_pc_ratio_volume_30d numeric,
  avg_pc_ratio_oi_30d numeric,

  -- Percentiles (for z-score calculations)
  p50_call_volume bigint,
  p75_call_volume bigint,
  p90_call_volume bigint,
  p50_put_volume bigint,
  p75_put_volume bigint,
  p90_put_volume bigint,

  -- Metadata
  computed_at timestamptz default now(),
  primary key (ticker, as_of_date)
);

create index options_historical_baselines_ticker_idx
  on options_historical_baselines(ticker, as_of_date desc);

comment on table options_historical_baselines is
  'Historical rolling averages and baselines for options activity comparison';

-- ========================================
-- GRANTS
-- ========================================

grant all on options_chain_daily to service_role;
grant all on options_flow to service_role;
grant all on options_summary_daily to service_role;
grant all on unusual_options_activity to service_role;
grant all on options_historical_baselines to service_role;

grant usage, select on sequence options_chain_daily_id_seq to service_role;
grant usage, select on sequence options_flow_id_seq to service_role;
grant usage, select on sequence unusual_options_activity_id_seq to service_role;
