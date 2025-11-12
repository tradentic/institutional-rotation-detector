-- Update iShares ETF entities with datasource configuration
-- This adds vendor-specific config needed for scraping holdings

update entities
set
  datasource_type = 'ishares',
  datasource_config = jsonb_build_object(
    'productId', '239707',
    'slug', 'ishares-russell-1000-etf'
  )
where ticker = 'IWB' and kind = 'etf';

update entities
set
  datasource_type = 'ishares',
  datasource_config = jsonb_build_object(
    'productId', '239710',
    'slug', 'ishares-russell-2000-etf'
  )
where ticker = 'IWM' and kind = 'etf';

update entities
set
  datasource_type = 'ishares',
  datasource_config = jsonb_build_object(
    'productId', '239714',
    'slug', 'ishares-russell-2000-value-etf'
  )
where ticker = 'IWN' and kind = 'etf';

update entities
set
  datasource_type = 'ishares',
  datasource_config = jsonb_build_object(
    'productId', '239716',
    'slug', 'ishares-micro-cap-etf'
  )
where ticker = 'IWC' and kind = 'etf';
