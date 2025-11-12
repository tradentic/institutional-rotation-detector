-- Add series_id column for ETF series identification
-- ETFs are part of fund families (trusts) where multiple series share one CIK
-- Series IDs (like S000004347) uniquely identify each ETF series within a trust

alter table entities add column series_id text;

-- Drop old unique constraint on (cik, kind)
alter table entities drop constraint entities_cik_kind_key;

-- Create new unique constraint on (cik, series_id, kind)
-- This allows multiple ETFs with same cik but different series_id
-- For non-ETFs where series_id is NULL, cik alone provides uniqueness
create unique index entities_unique_identifier_kind
  on entities (cik, series_id, kind);

comment on column entities.series_id is 'SEC Series ID for ETF series within a fund family (e.g., S000004347 for IWB). NULL for non-ETF entities.';
