-- Migration 011: Advanced Microstructure Layer
-- Broker-dealer mapping, flow attribution, VPIN, Kyle's lambda, trade classification

-- ============================================================================
-- Broker-Dealer to Institution Mapping
-- ============================================================================
-- Maps ATS/broker MPIDs to institutional entities for flow attribution
create table if not exists micro_broker_institution_map (
  id bigserial primary key,
  broker_mpid text not null,              -- Market Participant ID (e.g., 'MSCO', 'GSCO', 'VANG')
  broker_name text,                        -- Human-readable name (e.g., 'Morgan Stanley')
  institution_cik text,                    -- CIK from entities table
  institution_id uuid references entities(entity_id),
  relationship_type text check (
    relationship_type in ('prime_broker', 'clearing', 'internal', 'affiliate', 'inferred')
  ) not null,
  relationship_strength numeric check (relationship_strength between 0 and 1) default 0.5,
  confidence_score numeric check (confidence_score between 0 and 1) default 0.5,
  first_observed_date date,
  last_observed_date date,
  observation_count integer default 0,     -- How many times this relationship was observed
  avg_block_size bigint,                   -- Typical trade size for this relationship
  source text default 'INFERRED',          -- 'FORM_13F'|'FORM_ADV'|'PUBLIC_DISCLOSURE'|'INFERRED'
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (broker_mpid, institution_cik)
);

create index if not exists micro_broker_institution_map_broker_idx
  on micro_broker_institution_map(broker_mpid);
create index if not exists micro_broker_institution_map_institution_idx
  on micro_broker_institution_map(institution_id);
create index if not exists micro_broker_institution_map_strength_idx
  on micro_broker_institution_map(relationship_strength desc);

comment on table micro_broker_institution_map is
  'Maps broker-dealer MPIDs to institutional investors for flow attribution';
comment on column micro_broker_institution_map.relationship_type is
  'Type of broker-institution relationship: prime_broker (primary), clearing, internal (self-clearing), affiliate, or inferred (statistical)';
comment on column micro_broker_institution_map.relationship_strength is
  '0-1 probability that flow from this broker is from this institution (based on historical patterns)';

-- ============================================================================
-- Institutional Flow Attribution
-- ============================================================================
-- Daily attributed flows from ATS/dark pool data to specific institutions
create table if not exists micro_institutional_flow (
  id bigserial primary key,
  symbol text not null,
  trade_date date not null,
  institution_id uuid references entities(entity_id),
  institution_cik text,
  broker_mpid text,                        -- Which broker executed the flow
  flow_direction text check (flow_direction in ('buy', 'sell', 'unknown')) not null,
  shares bigint not null,
  trades integer,
  attribution_confidence numeric check (attribution_confidence between 0 and 1),
  source text default 'ATS',               -- 'ATS'|'NON_ATS'|'BLOCK_TRADE'
  venue_id text,                           -- Specific ATS venue
  created_at timestamptz default now(),
  unique (symbol, trade_date, institution_id, broker_mpid, flow_direction)
);

create index if not exists micro_institutional_flow_sym_date_idx
  on micro_institutional_flow(symbol, trade_date desc);
create index if not exists micro_institutional_flow_institution_idx
  on micro_institutional_flow(institution_id, trade_date desc);
create index if not exists micro_institutional_flow_confidence_idx
  on micro_institutional_flow(attribution_confidence desc)
  where attribution_confidence >= 0.7;

comment on table micro_institutional_flow is
  'Daily institutional buy/sell flow attributed from ATS data via broker-dealer mapping';
comment on column micro_institutional_flow.attribution_confidence is
  'Confidence score (0-1) that this flow is correctly attributed to this institution';

-- ============================================================================
-- Trade Classification (Lee-Ready)
-- ============================================================================
-- Stores buy/sell classification of trades using Lee-Ready algorithm
create table if not exists micro_trade_classification (
  symbol text not null,
  trade_date date not null,
  trade_direction text check (trade_direction in ('buy', 'sell', 'neutral')) not null,
  total_buy_volume bigint default 0,
  total_sell_volume bigint default 0,
  total_neutral_volume bigint default 0,
  order_imbalance numeric,                 -- (buy - sell) / (buy + sell)
  buy_trades integer default 0,
  sell_trades integer default 0,
  neutral_trades integer default 0,
  avg_trade_size bigint,
  classification_method text default 'LEE_READY', -- 'LEE_READY'|'TICK_TEST'|'QUOTE_RULE'
  quality_flag text,                       -- 'HIGH'|'MEDIUM'|'LOW' based on data quality
  created_at timestamptz default now(),
  primary key (symbol, trade_date)
);

create index if not exists micro_trade_classification_sym_date_idx
  on micro_trade_classification(symbol, trade_date desc);
create index if not exists micro_trade_classification_imbalance_idx
  on micro_trade_classification(order_imbalance desc)
  where abs(order_imbalance) > 0.2;

comment on table micro_trade_classification is
  'Daily trade classification (buy/sell) using Lee-Ready algorithm';
comment on column micro_trade_classification.order_imbalance is
  'Order imbalance ratio: (buy_volume - sell_volume) / total_volume, range [-1, 1]';

-- ============================================================================
-- Microstructure Metrics (VPIN, Kyle's Lambda, etc.)
-- ============================================================================
-- Daily microstructure quality metrics for rotation detection
create table if not exists micro_metrics_daily (
  symbol text not null,
  trade_date date not null,

  -- VPIN (Volume-Synchronized Probability of Informed Trading)
  vpin numeric check (vpin between 0 and 1),
  vpin_window_bars integer,                -- Number of volume bars used
  vpin_quality_flag text,                  -- 'HIGH'|'MEDIUM'|'LOW'

  -- Kyle's Lambda (price impact per unit volume)
  kyles_lambda numeric,                    -- ΔPrice / Volume (in bps per $1M)
  kyles_lambda_se numeric,                 -- Standard error
  kyles_lambda_r2 numeric,                 -- R² of regression

  -- Order imbalance metrics
  daily_order_imbalance numeric,           -- From trade_classification
  imbalance_persistence numeric,           -- Autocorrelation of imbalance

  -- Spread dynamics
  quoted_spread_bps numeric,               -- Quoted bid-ask spread (basis points)
  effective_spread_bps numeric,            -- Effective spread (basis points)
  realized_spread_bps numeric,             -- Realized spread (basis points)
  price_impact_bps numeric,                -- Price impact (basis points)

  -- Toxicity indicators
  adverse_selection_component numeric,     -- Adverse selection cost
  informed_trading_probability numeric,    -- Probability of informed trading

  -- Volume characteristics
  total_volume bigint,
  block_trade_volume bigint,               -- Volume from blocks > threshold
  block_trade_ratio numeric,               -- block_volume / total_volume

  -- Data quality
  computation_timestamp timestamptz default now(),
  data_completeness numeric,               -- 0-1 score for data quality

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (symbol, trade_date)
);

create index if not exists micro_metrics_daily_sym_date_idx
  on micro_metrics_daily(symbol, trade_date desc);
create index if not exists micro_metrics_daily_vpin_idx
  on micro_metrics_daily(vpin desc)
  where vpin is not null and vpin > 0.5;
create index if not exists micro_metrics_daily_lambda_idx
  on micro_metrics_daily(kyles_lambda desc)
  where kyles_lambda is not null;
create index if not exists micro_metrics_daily_block_ratio_idx
  on micro_metrics_daily(block_trade_ratio desc)
  where block_trade_ratio > 0.1;

comment on table micro_metrics_daily is
  'Daily microstructure quality metrics: VPIN, Kyles lambda, spreads, toxicity indicators';
comment on column micro_metrics_daily.vpin is
  'Volume-Synchronized Probability of Informed Trading (0-1), measures order flow toxicity';
comment on column micro_metrics_daily.kyles_lambda is
  'Price impact per unit volume (bps per $1M), measures market depth and liquidity';
comment on column micro_metrics_daily.adverse_selection_component is
  'Component of spread due to informed trading (adverse selection cost)';

-- ============================================================================
-- Rotation Events Enhancement: Microstructure Signals
-- ============================================================================
-- Add microstructure signal columns to rotation_events table
alter table rotation_events add column if not exists micro_vpin_avg numeric;
alter table rotation_events add column if not exists micro_vpin_spike boolean;
alter table rotation_events add column if not exists micro_lambda_avg numeric;
alter table rotation_events add column if not exists micro_flow_attribution_score numeric;
alter table rotation_events add column if not exists micro_order_imbalance_avg numeric;
alter table rotation_events add column if not exists micro_block_ratio_avg numeric;
alter table rotation_events add column if not exists micro_confidence numeric check (micro_confidence between 0 and 1);

comment on column rotation_events.micro_vpin_avg is
  'Average VPIN during dump period (higher = more informed selling)';
comment on column rotation_events.micro_vpin_spike is
  'Whether VPIN spiked above threshold during dump (strong signal)';
comment on column rotation_events.micro_lambda_avg is
  'Average Kyles lambda during dump period (price impact)';
comment on column rotation_events.micro_flow_attribution_score is
  'Confidence score for attributed institutional flows (0-1)';
comment on column rotation_events.micro_confidence is
  'Overall microstructure signal confidence (0-1)';

-- ============================================================================
-- Broker Master List (for reference)
-- ============================================================================
-- Reference table of known broker-dealers
create table if not exists micro_broker_master (
  broker_mpid text primary key,
  broker_name text not null,
  broker_cik text,                         -- If broker is a public entity
  broker_type text check (
    broker_type in ('WIREHOUSE', 'PRIME_BROKER', 'RETAIL', 'HFT', 'MARKET_MAKER', 'DARK_POOL', 'OTHER')
  ),
  parent_company text,
  is_active boolean default true,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists micro_broker_master_name_idx
  on micro_broker_master(broker_name);
create index if not exists micro_broker_master_type_idx
  on micro_broker_master(broker_type);

comment on table micro_broker_master is
  'Master reference table of broker-dealer MPIDs and metadata';

-- Seed with common broker MPIDs
insert into micro_broker_master (broker_mpid, broker_name, broker_type) values
  ('MSCO', 'Morgan Stanley & Co.', 'PRIME_BROKER'),
  ('GSCO', 'Goldman Sachs & Co.', 'PRIME_BROKER'),
  ('JPMS', 'J.P. Morgan Securities', 'PRIME_BROKER'),
  ('UBSS', 'UBS Securities', 'PRIME_BROKER'),
  ('DBAB', 'Deutsche Bank Securities', 'PRIME_BROKER'),
  ('CSFB', 'Credit Suisse Securities', 'PRIME_BROKER'),
  ('BAML', 'Bank of America Merrill Lynch', 'PRIME_BROKER'),
  ('BTIG', 'BTIG LLC', 'PRIME_BROKER'),
  ('FBCO', 'Credit Suisse Securities (USA)', 'PRIME_BROKER'),
  ('VANG', 'Vanguard Brokerage Services', 'WIREHOUSE'),
  ('ETRD', 'E*TRADE Securities', 'RETAIL'),
  ('SCHW', 'Charles Schwab & Co.', 'RETAIL'),
  ('IBKR', 'Interactive Brokers', 'RETAIL'),
  ('CITD', 'Citadel Securities', 'MARKET_MAKER'),
  ('VIRT', 'Virtu Americas', 'MARKET_MAKER'),
  ('JNEY', 'Jane Street Capital', 'MARKET_MAKER'),
  ('TWOS', 'Two Sigma Securities', 'MARKET_MAKER'),
  ('SIGMA', 'Goldman Sachs SIGMA X (Dark Pool)', 'DARK_POOL'),
  ('UBSA', 'UBS ATS', 'DARK_POOL'),
  ('MLIX', 'Morgan Stanley MSPOOL', 'DARK_POOL'),
  ('JPMX', 'J.P. Morgan JPM-X', 'DARK_POOL'),
  ('BARX', 'Barclays LX', 'DARK_POOL'),
  ('CROS', 'CrossFinder (Credit Suisse)', 'DARK_POOL'),
  ('LATS', 'Liquidnet ATS', 'DARK_POOL'),
  ('ITGP', 'ITG POSIT', 'DARK_POOL')
on conflict (broker_mpid) do nothing;

-- ============================================================================
-- Grants
-- ============================================================================
grant all on micro_broker_institution_map to service_role;
grant all on micro_institutional_flow to service_role;
grant all on micro_trade_classification to service_role;
grant all on micro_metrics_daily to service_role;
grant all on micro_broker_master to service_role;

grant usage, select on sequence micro_broker_institution_map_id_seq to service_role;
grant usage, select on sequence micro_institutional_flow_id_seq to service_role;
