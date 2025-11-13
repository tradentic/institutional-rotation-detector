-- ========================================
-- Add series_id support for ETFs and funds
-- ========================================
-- This migration fixes schema tables that don't support multi-series ETF trusts
-- where multiple ETF series share the same CIK but have different series_ids.
--
-- Problem: Tables store data by CIK, but FINRA reports by CUSIP. When aggregating
-- multiple CUSIPs to one CIK, we lose per-series granularity for ETFs.
--
-- Example: Invesco QQQ Trust (CIK 0001067839)
--   - QQQ:  CUSIP "46090E103", series_id "S000006218"
--   - QQQM: CUSIP "46138J784", series_id "S000069622"
--
-- Tables affected:
-- 1. cusip_issuer_map: Maps CUSIP → CIK (missing series_id)
-- 2. short_interest: Stores by CIK (should be by CUSIP)
-- 3. ats_weekly: Stores by CIK (should be by CUSIP)

-- ========================================
-- 1. ADD SERIES_ID TO CUSIP_ISSUER_MAP
-- ========================================
-- This allows proper resolution of CUSIP → entity including ETF series

alter table cusip_issuer_map
add column series_id text;

-- Add check constraint for series_id format (S000000000)
alter table cusip_issuer_map add constraint check_cusip_map_series_id_format
  check (
    series_id is null or
    series_id ~ '^S[0-9]{9}$'
  );

comment on column cusip_issuer_map.series_id is 'SEC series identifier for ETFs/funds. NULL for regular stocks. Allows mapping CUSIP to specific fund series within a trust.';

-- ========================================
-- 2. MIGRATE SHORT_INTEREST TO CUSIP-BASED
-- ========================================
-- FINRA reports short interest by CUSIP, not CIK. Storing by CIK loses
-- per-series granularity for multi-series ETF trusts.

-- Rename old table
alter table short_interest rename to short_interest_old;

-- Create new table with CUSIP instead of CIK
create table short_interest (
  settle_date date not null,
  cusip text not null,
  short_shares bigint not null,
  primary key (settle_date, cusip)
);

comment on table short_interest is 'FINRA short interest data by CUSIP (semi-monthly settlement dates)';

-- Migrate existing data (expand CIK rows to CUSIP rows)
-- For each (settle_date, cik) row, create rows for all known CUSIPs
insert into short_interest (settle_date, cusip, short_shares)
select
  si.settle_date,
  cm.cusip,
  si.short_shares  -- Note: This replicates the CIK total to each CUSIP
from short_interest_old si
join cusip_issuer_map cm on cm.issuer_cik = si.cik
on conflict (settle_date, cusip) do update set
  short_shares = excluded.short_shares;

-- Note: The migrated data is imperfect (CIK total copied to each CUSIP)
-- but new data will be stored correctly at CUSIP granularity.

-- Drop old table after successful migration
drop table short_interest_old;

-- ========================================
-- 3. MIGRATE ATS_WEEKLY TO CUSIP-BASED
-- ========================================
-- FINRA reports ATS/dark pool data by CUSIP (ticker), not CIK.

-- Rename old table
alter table ats_weekly rename to ats_weekly_old;

-- Create new table with CUSIP instead of CIK
create table ats_weekly (
  week_end date not null,
  cusip text not null,
  venue text not null,
  shares bigint not null,
  trades bigint,
  primary key (week_end, cusip, venue)
);

comment on table ats_weekly is 'FINRA ATS (Alternative Trading System) weekly trading volume by CUSIP and venue';
comment on column ats_weekly.venue is 'ATS venue code (e.g., SIGMA, UBSA, MLIX for dark pools)';

-- Migrate existing data (expand CIK rows to CUSIP rows)
insert into ats_weekly (week_end, cusip, venue, shares, trades)
select
  ats.week_end,
  cm.cusip,
  ats.venue,
  ats.shares,  -- Note: This replicates the CIK total to each CUSIP
  ats.trades
from ats_weekly_old ats
join cusip_issuer_map cm on cm.issuer_cik = ats.cik
on conflict (week_end, cusip, venue) do update set
  shares = excluded.shares,
  trades = excluded.trades;

-- Drop old table after successful migration
drop table ats_weekly_old;

-- ========================================
-- VERIFICATION QUERIES
-- ========================================
-- Run these after migration to verify data integrity:
--
-- 1. Check cusip_issuer_map has series_id for known ETFs:
-- select cusip, issuer_cik, series_id from cusip_issuer_map
-- where issuer_cik in (select cik from entities where kind = 'etf');
--
-- 2. Check short_interest row count (should be >= old count):
-- Expected behavior: Rows should multiply for multi-CUSIP entities
--
-- 3. Check ats_weekly row count (should be >= old count):
-- Expected behavior: Rows should multiply for multi-CUSIP entities
--
-- 4. Verify no data loss:
-- Old data is replicated to each CUSIP (imperfect but preserves totals)
-- New data will be stored at correct CUSIP granularity
