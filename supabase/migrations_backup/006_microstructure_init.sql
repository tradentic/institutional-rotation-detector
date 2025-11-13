-- Migration 006: Microstructure Ingest (FINRA OTC + IEX HIST + Short Interest)
-- Adds tables for off-exchange volume tracking, IEX matched volume, and enhanced short interest

-- ============================================================================
-- FINRA OTC Transparency: Venue-level weekly data (ATS & non-ATS)
-- ============================================================================
create table if not exists micro_offex_venue_weekly (
  id bigserial primary key,
  symbol text not null,
  week_end date not null,              -- FINRA report week end
  product text,                        -- NMS Tier1/Tier2/OTCE as published
  source text check (source in ('ATS','NON_ATS')) not null,
  venue_id text,                       -- ATS MPID or reporting member (may be masked for de minimis)
  total_shares numeric,
  total_trades numeric,
  finra_file_id text,                  -- filename or URL token for provenance
  finra_sha256 text,                   -- file hash for provenance
  created_at timestamptz default now()
);

create unique index if not exists micro_offex_venue_weekly_unique_idx
  on micro_offex_venue_weekly(symbol, week_end, source, coalesce(venue_id, '-'));
create index if not exists micro_offex_venue_weekly_sym_wk_idx
  on micro_offex_venue_weekly(symbol, week_end);
create index if not exists micro_offex_venue_weekly_week_idx
  on micro_offex_venue_weekly(week_end);

comment on table micro_offex_venue_weekly is
  'FINRA OTC Transparency weekly venue-level data (ATS and non-ATS volumes)';
comment on column micro_offex_venue_weekly.source is
  'ATS (Alternative Trading System) or NON_ATS (off-exchange dealer volume)';
comment on column micro_offex_venue_weekly.product is
  'NMS Tier1, NMS Tier2, or OTCE (over-the-counter equity)';

-- ============================================================================
-- FINRA OTC: Symbol-level weekly aggregate
-- ============================================================================
create table if not exists micro_offex_symbol_weekly (
  symbol text not null,
  week_end date not null,
  product text,
  ats_shares numeric default 0,
  nonats_shares numeric default 0,
  offex_shares numeric generated always as (coalesce(ats_shares,0) + coalesce(nonats_shares,0)) stored,
  finra_file_id text,                  -- provenance: primary file id
  finra_sha256 text,                   -- provenance: primary file hash
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (symbol, week_end)
);

create index if not exists micro_offex_symbol_weekly_sym_idx
  on micro_offex_symbol_weekly(symbol);
create index if not exists micro_offex_symbol_weekly_week_idx
  on micro_offex_symbol_weekly(week_end);

comment on table micro_offex_symbol_weekly is
  'FINRA OTC weekly symbol-level aggregates (sum of all ATS + non-ATS venues)';

-- ============================================================================
-- IEX HIST: Daily matched volume (on-exchange proxy, T+1)
-- ============================================================================
create table if not exists micro_iex_volume_daily (
  symbol text not null,
  trade_date date not null,
  matched_shares numeric not null,
  iex_file_id text,                    -- provenance: filename or URL token
  iex_sha256 text,                     -- provenance: file hash
  created_at timestamptz default now(),
  primary key (symbol, trade_date)
);

create index if not exists micro_iex_volume_daily_sym_idx
  on micro_iex_volume_daily(symbol);
create index if not exists micro_iex_volume_daily_date_idx
  on micro_iex_volume_daily(trade_date);

comment on table micro_iex_volume_daily is
  'IEX HIST daily matched volume (on-exchange only, T+1 available)';

-- ============================================================================
-- Consolidated volume: placeholder for SIP or exchange-aggregated totals
-- ============================================================================
create table if not exists micro_consolidated_volume_daily (
  symbol text not null,
  trade_date date not null,
  total_shares numeric,
  source text,                         -- 'SIP'|'EXCHANGE_SUM'|'VENDOR' etc.
  quality_flag text,                   -- 'official'|'vendor'|'n/a'
  created_at timestamptz default now(),
  primary key (symbol, trade_date)
);

create index if not exists micro_consolidated_volume_daily_sym_idx
  on micro_consolidated_volume_daily(symbol);
create index if not exists micro_consolidated_volume_daily_date_idx
  on micro_consolidated_volume_daily(trade_date);

comment on table micro_consolidated_volume_daily is
  'Consolidated tape or exchange-sum daily volume (optional; fill if licensed)';
comment on column micro_consolidated_volume_daily.source is
  'Data provider: SIP, EXCHANGE_SUM, or third-party VENDOR';

-- ============================================================================
-- Off-exchange percentage series (weekly official + daily approximations)
-- ============================================================================
create table if not exists micro_offex_ratio (
  symbol text not null,
  as_of date not null,
  granularity text check (granularity in ('weekly','daily')) not null,
  offex_shares numeric,                -- from FINRA OTC
  on_ex_shares numeric,                -- from consolidated or IEX proxy
  offex_pct numeric,                   -- 0..1 ratio
  quality_flag text,                   -- 'official'|'official_partial'|'approx'|'iex_proxy'
  basis_window daterange,              -- for daily approx, store week span used
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (symbol, as_of, granularity)
);

create index if not exists micro_offex_ratio_sym_idx
  on micro_offex_ratio(symbol);
create index if not exists micro_offex_ratio_date_idx
  on micro_offex_ratio(as_of);
create index if not exists micro_offex_ratio_quality_idx
  on micro_offex_ratio(quality_flag);

comment on table micro_offex_ratio is
  'Off-exchange percentage time series (weekly official from FINRA + daily approximations)';
comment on column micro_offex_ratio.quality_flag is
  'official: FINRA week + full consolidated; official_partial: FINRA week only; approx: daily estimate; iex_proxy: using IEX as on-exchange proxy';

-- ============================================================================
-- Short interest points (semi-monthly; enhanced from existing short_interest)
-- ============================================================================
create table if not exists micro_short_interest_points (
  symbol text not null,
  settlement_date date not null,
  publication_date date,               -- when FINRA published the data
  short_interest bigint,
  avg_daily_volume bigint,             -- optional: for days-to-cover calculation
  days_to_cover numeric,               -- optional: short_interest / avg_daily_volume
  source text default 'FINRA',
  finra_file_id text,                  -- provenance
  finra_sha256 text,                   -- provenance
  created_at timestamptz default now(),
  primary key (symbol, settlement_date)
);

create index if not exists micro_short_interest_points_sym_idx
  on micro_short_interest_points(symbol);
create index if not exists micro_short_interest_points_settle_idx
  on micro_short_interest_points(settlement_date);
create index if not exists micro_short_interest_points_pub_idx
  on micro_short_interest_points(publication_date);

comment on table micro_short_interest_points is
  'FINRA semi-monthly short interest with publication dates and provenance';

-- ============================================================================
-- Flip50 events: first cross below 50% after sustained period above 50%
-- ============================================================================
create table if not exists micro_flip50_events (
  id bigserial primary key,
  symbol text not null,
  flip_date date not null,             -- first day offex_pct < 0.50
  pre_period_start date,               -- start of >=50% run (N days back)
  pre_period_days int,                 -- number of consecutive days >=50%
  pre_avg_offex_pct numeric,           -- average offex_pct during pre-period
  flip_offex_pct numeric,              -- offex_pct on flip_date
  quality_flag text,                   -- inherited from micro_offex_ratio
  created_at timestamptz default now(),
  unique (symbol, flip_date)
);

create index if not exists micro_flip50_events_sym_idx
  on micro_flip50_events(symbol);
create index if not exists micro_flip50_events_flip_date_idx
  on micro_flip50_events(flip_date);

comment on table micro_flip50_events is
  'Flip50 detector: first cross below 50% off-exchange after >=N consecutive days above 50%';

-- ============================================================================
-- Link table: Flip50 events to rotation_events (event-study integration)
-- ============================================================================
create table if not exists micro_flip50_event_studies (
  flip50_id bigint not null references micro_flip50_events(id) on delete cascade,
  rotation_event_id bigint,            -- links to rotation_events.id if exists
  study_status text default 'pending', -- 'pending'|'running'|'completed'|'failed'
  car_m5_p20 numeric,                  -- cumulative abnormal return [-5,+20]
  max_ret_w13 numeric,                 -- max 13-week return
  t_to_plus20_days int,                -- time to +20% threshold
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (flip50_id)
);

create index if not exists micro_flip50_event_studies_status_idx
  on micro_flip50_event_studies(study_status);

comment on table micro_flip50_event_studies is
  'Event-study results for Flip50 events (links to rotation_events or standalone)';

-- ============================================================================
-- RLS: Enable row-level security (match existing pattern if needed)
-- ============================================================================
-- Note: If the existing schema uses RLS, enable it here and add policies.
-- For now, leaving tables open for service role access.

-- ============================================================================
-- Grants: Ensure service role has access
-- ============================================================================
grant all on micro_offex_venue_weekly to service_role;
grant all on micro_offex_symbol_weekly to service_role;
grant all on micro_iex_volume_daily to service_role;
grant all on micro_consolidated_volume_daily to service_role;
grant all on micro_offex_ratio to service_role;
grant all on micro_short_interest_points to service_role;
grant all on micro_flip50_events to service_role;
grant all on micro_flip50_event_studies to service_role;

grant usage, select on sequence micro_offex_venue_weekly_id_seq to service_role;
grant usage, select on sequence micro_flip50_events_id_seq to service_role;
