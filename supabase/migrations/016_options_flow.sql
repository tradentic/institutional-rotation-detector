-- Migration 014: Options Flow Tracking
-- Real-time options activity for predictive rotation signals
-- Data source: UnusualWhales API

-- ============================================================================
-- Options Chain Daily Snapshot
-- ============================================================================
-- Daily snapshot of full options chain with greeks and volume
create table if not exists options_chain_daily (
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
  mark numeric,                           -- Mid-point (bid+ask)/2

  -- Volume and open interest
  volume bigint,
  open_interest bigint,
  volume_oi_ratio numeric,                -- volume / open_interest (>3 = unusual activity)

  -- Greeks
  delta numeric,
  gamma numeric,
  theta numeric,
  vega numeric,
  rho numeric,

  -- Implied volatility
  implied_volatility numeric,             -- IV for this strike
  iv_rank numeric,                        -- IV rank (0-100)
  iv_percentile numeric,                  -- IV percentile (0-100)

  -- Metadata
  underlying_price numeric,               -- Stock price at time of capture
  days_to_expiration integer,
  is_weekly boolean default false,
  is_monthly boolean default true,

  -- Source tracking
  data_source text default 'UNUSUALWHALES',
  ingested_at timestamptz default now(),

  unique (ticker, trade_date, expiration_date, strike, option_type)
);

create index if not exists options_chain_daily_ticker_date_idx
  on options_chain_daily(ticker, trade_date desc);
create index if not exists options_chain_daily_expiry_idx
  on options_chain_daily(expiration_date);
create index if not exists options_chain_daily_volume_oi_idx
  on options_chain_daily(volume_oi_ratio desc)
  where volume_oi_ratio > 3.0;
create index if not exists options_chain_daily_volume_idx
  on options_chain_daily(volume desc)
  where volume > 1000;

comment on table options_chain_daily is
  'Daily snapshot of full options chain with greeks, volume, OI, and IV';
comment on column options_chain_daily.volume_oi_ratio is
  'Ratio of daily volume to open interest. >3.0 indicates new positioning (unusual activity)';

-- ============================================================================
-- Options Flow (Intraday Transactions)
-- ============================================================================
-- Real-time options flow: individual large transactions
create table if not exists options_flow (
  id bigserial primary key,

  -- Timing
  ticker text not null,
  trade_datetime timestamptz not null,    -- Exact transaction time
  trade_date date not null,

  -- Option details
  expiration_date date not null,
  strike numeric not null,
  option_type text check (option_type in ('call', 'put')) not null,

  -- Transaction details
  contract_count integer not null,        -- Number of contracts
  premium_paid numeric,                   -- Total premium ($)
  fill_price numeric,                     -- Price per contract
  underlying_price numeric,               -- Stock price at time of trade

  -- Trade classification
  sentiment text check (sentiment in ('bullish', 'bearish', 'neutral')),
  trade_side text check (trade_side in ('buy', 'sell', 'unknown')),
  is_sweep boolean default false,         -- Multi-leg sweep order
  is_block boolean default false,         -- Block trade (large size)
  is_aggressive boolean default false,    -- Took liquidity (marketable order)

  -- Greeks at time of trade
  delta numeric,
  implied_volatility numeric,

  -- Unusual activity flags
  is_unusual boolean default false,       -- Flagged as unusual by source
  volume_oi_ratio numeric,
  premium_percentile numeric,             -- Percentile vs recent activity

  -- Source metadata
  data_source text default 'UNUSUALWHALES',
  source_transaction_id text,             -- External ID for deduplication
  ingested_at timestamptz default now(),

  unique (ticker, trade_datetime, expiration_date, strike, option_type, contract_count)
);

create index if not exists options_flow_ticker_date_idx
  on options_flow(ticker, trade_date desc);
create index if not exists options_flow_datetime_idx
  on options_flow(trade_datetime desc);
create index if not exists options_flow_unusual_idx
  on options_flow(ticker, trade_date desc)
  where is_unusual = true;
create index if not exists options_flow_block_idx
  on options_flow(ticker, trade_date desc)
  where is_block = true;
create index if not exists options_flow_sweep_idx
  on options_flow(ticker, trade_date desc)
  where is_sweep = true;

comment on table options_flow is
  'Real-time options flow transactions. Captures large/unusual trades for rotation prediction.';
comment on column options_flow.is_sweep is
  'Multi-exchange sweep order (typically institutional, very bullish/bearish)';
comment on column options_flow.is_aggressive is
  'Whether order took liquidity (crossed spread) vs provided liquidity';

-- ============================================================================
-- Options Summary Daily
-- ============================================================================
-- Aggregated daily options activity for efficient querying
create table if not exists options_summary_daily (
  ticker text not null,
  trade_date date not null,

  -- Aggregate volume
  total_call_volume bigint default 0,
  total_put_volume bigint default 0,
  total_call_oi bigint default 0,
  total_put_oi bigint default 0,

  -- Ratios
  put_call_ratio_volume numeric,          -- put_volume / call_volume
  put_call_ratio_oi numeric,              -- put_oi / call_oi

  -- Premium metrics
  total_call_premium numeric,
  total_put_premium numeric,
  net_premium numeric,                    -- call_premium - put_premium

  -- Implied volatility
  atm_call_iv numeric,                    -- At-the-money call IV
  atm_put_iv numeric,                     -- At-the-money put IV
  iv_skew numeric,                        -- put_iv - call_iv (fear gauge)
  iv_30day numeric,                       -- 30-day average IV

  -- Unusual activity counts
  unusual_call_count integer default 0,
  unusual_put_count integer default 0,
  sweep_call_count integer default 0,
  sweep_put_count integer default 0,
  block_call_count integer default 0,
  block_put_count integer default 0,

  -- Flow direction
  net_call_delta numeric,                 -- Aggregate delta of call trades
  net_put_delta numeric,                  -- Aggregate delta of put trades
  total_premium_bullish numeric,          -- Premium from bullish trades
  total_premium_bearish numeric,          -- Premium from bearish trades

  -- Market context
  underlying_close numeric,
  underlying_volume bigint,

  -- Metadata
  computed_at timestamptz default now(),
  primary key (ticker, trade_date)
);

create index if not exists options_summary_daily_date_idx
  on options_summary_daily(trade_date desc);
create index if not exists options_summary_daily_pc_ratio_idx
  on options_summary_daily(put_call_ratio_volume desc)
  where put_call_ratio_volume > 1.5;
create index if not exists options_summary_daily_iv_skew_idx
  on options_summary_daily(iv_skew desc)
  where iv_skew is not null;
create index if not exists options_summary_daily_unusual_idx
  on options_summary_daily(trade_date desc)
  where unusual_call_count + unusual_put_count > 0;

comment on table options_summary_daily is
  'Daily aggregated options activity metrics for rotation detection';
comment on column options_summary_daily.put_call_ratio_volume is
  'Put/Call ratio by volume. >2.0 = extreme bearish sentiment, <0.5 = extreme bullish';
comment on column options_summary_daily.iv_skew is
  'IV skew (put IV - call IV). Positive skew = fear (demand for downside protection)';

-- ============================================================================
-- Unusual Options Activity Scanner
-- ============================================================================
-- Pre-aggregated unusual activity events for alerts
create table if not exists unusual_options_activity (
  id bigserial primary key,

  -- Identification
  ticker text not null,
  trade_date date not null,
  detected_at timestamptz not null,

  -- Unusual pattern details
  activity_type text check (
    activity_type in (
      'LARGE_PUT_BUYING',       -- Unusual put buying (bearish)
      'LARGE_CALL_BUYING',      -- Unusual call buying (bullish)
      'PUT_SPREAD_SURGE',       -- Put spread activity
      'CALL_SPREAD_SURGE',      -- Call spread activity
      'STRADDLE_STRANGLE',      -- Volatility play
      'SWEEP_CLUSTER',          -- Multiple sweeps in short time
      'DARK_POOL_HEDGE',        -- Options activity aligned with dark pool
      'IV_SPIKE',               -- Implied volatility surge
      'OI_BUILDUP'              -- Open interest building
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
  strikes_involved text[],                -- Array of strike prices
  days_to_expiration integer,

  -- Significance
  signal_strength numeric check (signal_strength between 0 and 1),
  vs_avg_volume_ratio numeric,           -- Current volume / 30-day avg
  percentile_rank numeric,                -- Percentile vs historical activity

  -- Metadata
  description text,
  source text default 'UNUSUALWHALES',
  ingested_at timestamptz default now()
);

create index if not exists unusual_options_activity_ticker_date_idx
  on unusual_options_activity(ticker, trade_date desc);
create index if not exists unusual_options_activity_detected_idx
  on unusual_options_activity(detected_at desc);
create index if not exists unusual_options_activity_type_idx
  on unusual_options_activity(activity_type, trade_date desc);
create index if not exists unusual_options_activity_signal_idx
  on unusual_options_activity(signal_strength desc)
  where signal_strength > 0.7;

comment on table unusual_options_activity is
  'Pre-detected unusual options activity patterns for rotation prediction';
comment on column unusual_options_activity.signal_strength is
  'Composite signal strength (0-1) based on volume, premium, IV, and timing';

-- ============================================================================
-- Rotation Events Enhancement: Options Signals
-- ============================================================================
-- Add options signal columns to rotation_events table
alter table rotation_events add column if not exists options_pre_dump_put_surge boolean;
alter table rotation_events add column if not exists options_pre_dump_put_volume bigint;
alter table rotation_events add column if not exists options_pre_dump_pc_ratio numeric;
alter table rotation_events add column if not exists options_post_dump_call_buildup boolean;
alter table rotation_events add column if not exists options_post_dump_call_volume bigint;
alter table rotation_events add column if not exists options_post_dump_iv_decline boolean;
alter table rotation_events add column if not exists options_unusual_activity_count integer;
alter table rotation_events add column if not exists options_signal_strength numeric;
alter table rotation_events add column if not exists options_confidence numeric check (options_confidence between 0 and 1);

comment on column rotation_events.options_pre_dump_put_surge is
  'Whether unusual put buying occurred in 10 days before dump (leading indicator)';
comment on column rotation_events.options_pre_dump_pc_ratio is
  'Put/Call ratio in pre-dump window. >2.0 = strong bearish signal';
comment on column rotation_events.options_post_dump_call_buildup is
  'Whether call volume/OI building after dump (uptake confirmation)';
comment on column rotation_events.options_post_dump_iv_decline is
  'Whether IV declined post-dump (reduced fear = confidence in uptake)';
comment on column rotation_events.options_signal_strength is
  'Composite options signal strength for scoring algorithm';

-- ============================================================================
-- Historical Options Metrics (for backtesting)
-- ============================================================================
-- Store historical IV, volume baselines for comparison
create table if not exists options_historical_baselines (
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

create index if not exists options_historical_baselines_ticker_idx
  on options_historical_baselines(ticker, as_of_date desc);

comment on table options_historical_baselines is
  'Historical rolling averages and baselines for options activity comparison';

-- ============================================================================
-- Grants
-- ============================================================================
grant all on options_chain_daily to service_role;
grant all on options_flow to service_role;
grant all on options_summary_daily to service_role;
grant all on unusual_options_activity to service_role;
grant all on options_historical_baselines to service_role;

grant usage, select on sequence options_chain_daily_id_seq to service_role;
grant usage, select on sequence options_flow_id_seq to service_role;
grant usage, select on sequence unusual_options_activity_id_seq to service_role;
