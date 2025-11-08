-- Microstructure ingestion tables and covariates
create table if not exists micro_source_files (
  source text not null,
  file_id text not null,
  url text,
  fetched_at timestamptz default now(),
  sha256 text not null,
  content text not null,
  primary key (source, file_id)
);

create table if not exists micro_offex_venue_weekly (
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
  unique (symbol, week_end, source, coalesce(venue_id,'-'))
);
create index if not exists micro_offex_venue_weekly_sym_wk_ix on micro_offex_venue_weekly(symbol, week_end);

create table if not exists micro_offex_symbol_weekly (
  symbol text not null,
  week_end date not null,
  product text,
  ats_shares numeric default 0,
  nonats_shares numeric default 0,
  offex_shares numeric generated always as (coalesce(ats_shares,0)+coalesce(nonats_shares,0)) stored,
  primary key (symbol, week_end)
);

create table if not exists micro_iex_volume_daily (
  symbol text not null,
  trade_date date not null,
  matched_shares numeric not null,
  iex_file_id text,
  iex_sha256 text,
  created_at timestamptz default now(),
  primary key (symbol, trade_date)
);

create table if not exists micro_consolidated_volume_daily (
  symbol text not null,
  trade_date date not null,
  total_shares numeric,
  source text,
  quality_flag text,
  created_at timestamptz default now(),
  primary key (symbol, trade_date)
);

create table if not exists micro_offex_ratio (
  symbol text not null,
  as_of date not null,
  granularity text check (granularity in ('weekly','daily')) not null,
  offex_shares numeric,
  on_ex_shares numeric,
  offex_pct numeric,
  quality_flag text,
  basis_window daterange,
  created_at timestamptz default now(),
  provenance jsonb,
  primary key (symbol, as_of, granularity)
);
create index if not exists micro_offex_ratio_symbol_ix on micro_offex_ratio(symbol, granularity, as_of);

create table if not exists micro_short_interest_points (
  symbol text not null,
  settlement_date date not null,
  publication_date date,
  short_interest bigint,
  source text default 'FINRA',
  created_at timestamptz default now(),
  provenance jsonb,
  primary key (symbol, settlement_date)
);

create table if not exists micro_flip50_events (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  event_date date not null,
  lookback_days int not null default 20,
  preceding_streak int not null,
  offex_pct numeric,
  quality_flag text,
  created_at timestamptz default now(),
  unique(symbol, event_date)
);
create index if not exists micro_flip50_events_symbol_ix on micro_flip50_events(symbol, event_date);

create table if not exists micro_event_study_results (
  id bigserial primary key,
  symbol text not null,
  event_type text not null,
  anchor_date date not null,
  cik text,
  car_m5_p20 numeric,
  tt_plus20_days int,
  max_ret_w13 numeric,
  plus_1w numeric,
  plus_2w numeric,
  plus_4w numeric,
  plus_8w numeric,
  plus_13w numeric,
  offex_covariates jsonb,
  short_interest_covariate numeric,
  iex_share numeric,
  created_at timestamptz default now(),
  unique(symbol, event_type, anchor_date, coalesce(cik,''))
);
create index if not exists micro_event_study_results_symbol_ix on micro_event_study_results(symbol, anchor_date);
