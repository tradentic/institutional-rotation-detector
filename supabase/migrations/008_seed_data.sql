-- ========================================
-- Seed Data
-- ========================================
-- Initial data for ETF entities and index rebalance windows

-- ========================================
-- iShares ETF Entities
-- ========================================
-- All four ETFs are part of iShares Trust (CIK 0001100663)

insert into entities (cik, name, kind, ticker, series_id, datasource_type, datasource_config)
values
  (
    '0001100663',
    'iShares Russell 1000 ETF',
    'etf',
    'IWB',
    'S000004347',
    'ishares',
    jsonb_build_object(
      'productId', '239707',
      'slug', 'ishares-russell-1000-etf'
    )
  ),
  (
    '0001100663',
    'iShares Russell 2000 ETF',
    'etf',
    'IWM',
    'S000004344',
    'ishares',
    jsonb_build_object(
      'productId', '239710',
      'slug', 'ishares-russell-2000-etf'
    )
  ),
  (
    '0001100663',
    'iShares Russell 2000 Value ETF',
    'etf',
    'IWN',
    'S000004348',
    'ishares',
    jsonb_build_object(
      'productId', '239714',
      'slug', 'ishares-russell-2000-value-etf'
    )
  ),
  (
    '0001100663',
    'iShares Micro-Cap ETF',
    'etf',
    'IWC',
    'S000004349',
    'ishares',
    jsonb_build_object(
      'productId', '239716',
      'slug', 'ishares-micro-cap-etf'
    )
  )
on conflict (cik, kind) do update set
  name = excluded.name,
  ticker = excluded.ticker,
  series_id = excluded.series_id,
  datasource_type = excluded.datasource_type,
  datasource_config = excluded.datasource_config;

-- ========================================
-- Index Rebalance Windows
-- ========================================
-- Russell reconstitution happens annually in June
-- S&P rebalances can happen any time but concentrate around quarter-ends

-- Russell 2000 reconstitution windows (2023-2025)
insert into index_windows (index_name, phase, window_start, window_end) values
('Russell 2000', 'announcement', '2023-05-01', '2023-05-31'),
('Russell 2000', 'effective', '2023-06-23', '2023-06-30'),
('Russell 2000', 'announcement', '2024-05-01', '2024-05-31'),
('Russell 2000', 'effective', '2024-06-21', '2024-06-30'),
('Russell 2000', 'announcement', '2025-05-01', '2025-05-31'),
('Russell 2000', 'effective', '2025-06-20', '2025-06-30')
on conflict (index_name, phase, window_start, window_end) do nothing;

-- S&P 500 quarterly rebalance windows (2023-2025)
insert into index_windows (index_name, phase, window_start, window_end) values
('S&P 500', 'q1_rebal', '2023-03-20', '2023-03-31'),
('S&P 500', 'q2_rebal', '2023-06-23', '2023-06-30'),
('S&P 500', 'q3_rebal', '2023-09-22', '2023-09-30'),
('S&P 500', 'q4_rebal', '2023-12-22', '2023-12-31'),
('S&P 500', 'q1_rebal', '2024-03-20', '2024-03-31'),
('S&P 500', 'q2_rebal', '2024-06-21', '2024-06-30'),
('S&P 500', 'q3_rebal', '2024-09-20', '2024-09-30'),
('S&P 500', 'q4_rebal', '2024-12-20', '2024-12-31'),
('S&P 500', 'q1_rebal', '2025-03-21', '2025-03-31'),
('S&P 500', 'q2_rebal', '2025-06-23', '2025-06-30'),
('S&P 500', 'q3_rebal', '2025-09-22', '2025-09-30'),
('S&P 500', 'q4_rebal', '2025-12-22', '2025-12-31')
on conflict (index_name, phase, window_start, window_end) do nothing;

-- S&P 400 MidCap quarterly rebalance windows (2024-2025)
insert into index_windows (index_name, phase, window_start, window_end) values
('S&P 400', 'q1_rebal', '2024-03-20', '2024-03-31'),
('S&P 400', 'q2_rebal', '2024-06-21', '2024-06-30'),
('S&P 400', 'q3_rebal', '2024-09-20', '2024-09-30'),
('S&P 400', 'q4_rebal', '2024-12-20', '2024-12-31'),
('S&P 400', 'q1_rebal', '2025-03-21', '2025-03-31'),
('S&P 400', 'q2_rebal', '2025-06-23', '2025-06-30'),
('S&P 400', 'q3_rebal', '2025-09-22', '2025-09-30'),
('S&P 400', 'q4_rebal', '2025-12-22', '2025-12-31')
on conflict (index_name, phase, window_start, window_end) do nothing;
