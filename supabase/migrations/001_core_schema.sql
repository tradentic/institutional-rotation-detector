-- ========================================
-- Core Schema: Entities, Filings, Positions
-- ========================================
-- This migration creates the foundational tables for tracking institutional investors,
-- their filings, and position data.

-- Enable required extensions
create extension if not exists vector;
create extension if not exists pg_trgm; -- For text search

-- ========================================
-- ENTITIES
-- ========================================
-- Tracks institutional investors, issuers, funds, and ETFs

create table entities (
  entity_id uuid primary key default gen_random_uuid(),
  cik text,
  name text not null,
  kind text check (kind in ('issuer','manager','fund','etf')) not null,
  ticker text, -- For issuers and ETFs
  series_id text, -- SEC series ID for ETFs/funds (format: S000012345)
  datasource_type text, -- ETF data source (e.g., 'ishares', 'vanguard')
  datasource_config jsonb -- Vendor-specific config for ETF scraping
);

-- Unique constraint: allows multiple ETFs/funds with same CIK but different series_id
create unique index entities_unique_identifier_kind
  on entities (cik, coalesce(series_id, ''), kind);

-- Check constraint: only ETFs can have datasource config
alter table entities add constraint etf_datasource_check
  check (
    (kind = 'etf' and datasource_type is not null) or
    (kind != 'etf' and datasource_type is null and datasource_config is null)
  );

-- Check constraint: validate series_id format (S000000000)
alter table entities add constraint check_series_id_format
  check (
    series_id is null or
    series_id ~ '^S[0-9]{9}$'
  );

comment on table entities is 'Entities table supporting issuers, managers, ETFs, and mutual funds. For ETFs/funds, cik identifies the parent trust and series_id identifies the specific fund series.';
comment on column entities.ticker is 'Stock ticker for issuers and ETFs';
comment on column entities.series_id is 'SEC series identifier for ETFs and mutual funds (format: S000012345). NULL for issuers and managers. Required for fund-specific SEC EDGAR queries.';
comment on column entities.datasource_type is 'ETF data source provider (e.g., ishares, vanguard)';
comment on column entities.datasource_config is 'Vendor-specific configuration for fetching ETF holdings';

-- ========================================
-- FILINGS
-- ========================================
-- SEC filings (13F, N-PORT, Form 4, 13D/13G, etc.)

create table filings (
  accession text primary key,
  cik text not null,
  form text not null,
  filed_date date not null,
  period_end date,
  event_date date,
  url text not null,
  cadence text check (
    cadence is null
    or cadence in ('annual', 'semiannual', 'quarterly', 'monthly', 'event', 'adhoc')
  ),
  expected_publish_at timestamptz,
  published_at timestamptz,
  is_amendment boolean not null default false,
  amendment_of_accession text references filings(accession)
);

comment on table filings is 'SEC filings from EDGAR (13F, N-PORT, Form 4, 13D/13G, etc.)';
comment on column filings.cadence is 'Filing frequency: quarterly (13F), monthly (N-PORT), event (13D/G), etc.';
comment on column filings.expected_publish_at is 'Expected publication date based on form rules';

-- ========================================
-- CUSIP MAPPINGS
-- ========================================
-- Maps CUSIPs to issuer CIKs

create table cusip_issuer_map (
  cusip text primary key,
  issuer_cik text not null
);

comment on table cusip_issuer_map is 'Maps CUSIPs to issuer CIKs for security identification';

-- ========================================
-- POSITIONS (13F)
-- ========================================
-- Quarterly institutional holdings from 13F-HR filings

create table positions_13f (
  entity_id uuid references entities,
  cusip text not null,
  asof date not null,
  shares bigint default 0,
  opt_put_shares bigint default 0,
  opt_call_shares bigint default 0,
  accession text references filings(accession),
  primary key (entity_id, cusip, asof, accession)
);

comment on table positions_13f is 'Quarterly institutional holdings from 13F-HR filings (includes options)';
comment on column positions_13f.opt_put_shares is 'Put option shares (share-equivalent)';
comment on column positions_13f.opt_call_shares is 'Call option shares (share-equivalent)';

-- ========================================
-- BENEFICIAL OWNERSHIP SNAPSHOTS
-- ========================================
-- 13D/13G beneficial ownership filings (>5% stakes)

create table bo_snapshots (
  issuer_cik text not null,
  holder_cik text not null,
  event_date date not null,
  filed_date date not null,
  pct_of_class numeric,
  shares_est bigint,
  accession text references filings(accession),
  primary key (issuer_cik, holder_cik, event_date, accession)
);

comment on table bo_snapshots is 'Beneficial ownership snapshots from 13D/13G filings (>5% stakes)';

-- ========================================
-- ULTRA-HIGH-FREQUENCY POSITIONS
-- ========================================
-- Monthly N-PORT and daily ETF holdings (faster than 13F)

create table uhf_positions (
  holder_id uuid references entities,
  cusip text not null,
  asof date not null,
  shares bigint not null,
  source text check (source in ('NPORT','ETF')) not null,
  primary key (holder_id, cusip, asof, source)
);

comment on table uhf_positions is 'Ultra-high-frequency positions from N-PORT (monthly) and ETF holdings (daily)';

-- ========================================
-- SHORT INTEREST
-- ========================================
-- FINRA short interest data (semi-monthly)

create table short_interest (
  settle_date date not null,
  cik text not null,
  short_shares bigint not null,
  primary key (settle_date, cik)
);

comment on table short_interest is 'FINRA short interest data (semi-monthly settlement dates)';

-- ========================================
-- BENEFICIAL OWNERSHIP SNAPSHOTS
-- ========================================
-- Schedule 13D/13G filings (5%+ ownership)

create table bo_snapshots (
  issuer_cik text not null,
  holder_cik text not null,
  event_date date not null,
  filed_date date not null,
  pct_of_class numeric,
  shares_est bigint,
  accession text references filings(accession),
  primary key (issuer_cik, holder_cik, event_date, accession)
);

comment on table bo_snapshots is 'Beneficial ownership snapshots from Schedule 13D/13G filings (5%+ ownership threshold)';
comment on column bo_snapshots.pct_of_class is 'Percentage of outstanding shares held';

-- ========================================
-- ATS WEEKLY
-- ========================================
-- FINRA ATS (Alternative Trading System) weekly data

create table ats_weekly (
  week_end date not null,
  cik text not null,
  venue text not null,
  shares bigint not null,
  trades bigint,
  primary key (week_end, cik, venue)
);

comment on table ats_weekly is 'FINRA ATS (Alternative Trading System) weekly trading volume by venue';
comment on column ats_weekly.venue is 'ATS venue code (e.g., SIGMA, UBSA, MLIX for dark pools)';

-- ========================================
-- INDEX REBALANCING WINDOWS
-- ========================================
-- S&P and Russell index rebalancing windows for penalty calculation

create table index_windows (
  index_name text not null,
  phase text not null,
  window_start date not null,
  window_end date not null,
  primary key (index_name, phase, window_start)
);

comment on table index_windows is 'Index rebalancing windows (S&P quarterly, Russell annual/semi-annual)';

-- ========================================
-- FILING CHUNKS
-- ========================================
-- Text chunks from filings for long context synthesis (no embeddings)

create table filing_chunks (
  accession text references filings(accession),
  chunk_no int,
  content text not null,
  primary key (accession, chunk_no)
);

comment on table filing_chunks is 'Filing text chunks for long context synthesis (uses GraphRAG + 128K context, no vector search)';
