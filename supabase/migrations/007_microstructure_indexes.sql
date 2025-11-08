-- Migration 007: Microstructure Indexes
-- Additional performance indexes for microstructure queries

-- Composite indexes for common query patterns
create index if not exists micro_offex_venue_weekly_sym_src_wk_idx
  on micro_offex_venue_weekly(symbol, source, week_end desc);

create index if not exists micro_offex_symbol_weekly_sym_wk_desc_idx
  on micro_offex_symbol_weekly(symbol, week_end desc);

create index if not exists micro_iex_volume_daily_sym_date_desc_idx
  on micro_iex_volume_daily(symbol, trade_date desc);

create index if not exists micro_consolidated_volume_daily_sym_date_desc_idx
  on micro_consolidated_volume_daily(symbol, trade_date desc);

create index if not exists micro_offex_ratio_sym_gran_date_desc_idx
  on micro_offex_ratio(symbol, granularity, as_of desc);

create index if not exists micro_short_interest_points_sym_date_desc_idx
  on micro_short_interest_points(symbol, settlement_date desc);

-- Range query indexes for event studies
create index if not exists micro_flip50_events_sym_flip_desc_idx
  on micro_flip50_events(symbol, flip_date desc);

-- Partial indexes for specific quality flags (faster filtering)
create index if not exists micro_offex_ratio_official_idx
  on micro_offex_ratio(symbol, as_of)
  where quality_flag in ('official', 'official_partial');

create index if not exists micro_offex_ratio_daily_approx_idx
  on micro_offex_ratio(symbol, as_of)
  where granularity = 'daily' and quality_flag in ('approx', 'iex_proxy');

-- Study status index for batch processing
create index if not exists micro_flip50_event_studies_pending_idx
  on micro_flip50_event_studies(flip50_id)
  where study_status = 'pending';
