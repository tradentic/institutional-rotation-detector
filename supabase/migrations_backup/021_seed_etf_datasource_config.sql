-- Update iShares ETF entities with ticker and datasource configuration
-- (Problem 3: Complete ETF entity seeding with all required fields)
--
-- This migration adds:
-- 1. Ticker symbols for each ETF
-- 2. Datasource type and configuration for iShares API integration
--
-- Note: At this point, ETFs were seeded in migration 005 with:
-- - cik: Series IDs (S000004347, etc.) - will be migrated to series_id column in 022
-- - name: ETF names
-- - kind: 'etf'

-- IWB: iShares Russell 1000 ETF (Large-cap)
update entities
set
  ticker = 'IWB',
  datasource_type = 'ishares',
  datasource_config = jsonb_build_object(
    'productId', '239707',
    'slug', 'ishares-russell-1000-etf'
  )
where cik = 'S000004347' and kind = 'etf';

-- IWM: iShares Russell 2000 ETF (Small-cap)
update entities
set
  ticker = 'IWM',
  datasource_type = 'ishares',
  datasource_config = jsonb_build_object(
    'productId', '239710',
    'slug', 'ishares-russell-2000-etf'
  )
where cik = 'S000004344' and kind = 'etf';

-- IWN: iShares Russell 2000 Value ETF (Small-cap value)
update entities
set
  ticker = 'IWN',
  datasource_type = 'ishares',
  datasource_config = jsonb_build_object(
    'productId', '239714',
    'slug', 'ishares-russell-2000-value-etf'
  )
where cik = 'S000004348' and kind = 'etf';

-- IWC: iShares Micro-Cap ETF (Micro-cap)
update entities
set
  ticker = 'IWC',
  datasource_type = 'ishares',
  datasource_config = jsonb_build_object(
    'productId', '239716',
    'slug', 'ishares-micro-cap-etf'
  )
where cik = 'S000004349' and kind = 'etf';
