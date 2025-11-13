-- Add datasource configuration for ETF entities
-- This stores vendor-specific config (like iShares product IDs) needed for scraping

alter table entities add column datasource_type text;
alter table entities add column datasource_config jsonb;

-- Set default datasource_type for existing ETFs
update entities set datasource_type = 'ishares' where kind = 'etf' and datasource_type is null;

-- Add check constraint to ensure only ETFs have datasource config
alter table entities add constraint etf_datasource_check
  check (
    (kind = 'etf' and datasource_type is not null) or
    (kind != 'etf' and datasource_type is null and datasource_config is null)
  );

-- Create index for querying ETFs by datasource type
create index idx_entities_datasource on entities(datasource_type) where datasource_type is not null;

comment on column entities.datasource_type is 'ETF data source provider (e.g., ishares, vanguard)';
comment on column entities.datasource_config is 'Vendor-specific configuration for fetching ETF holdings (e.g., productId, slug for iShares)';
