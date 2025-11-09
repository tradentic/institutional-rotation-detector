-- Seed index rebalance windows for Russell and S&P reconstitution
-- These are the dates when index-tracking funds rebalance, which can create
-- passive selling/buying noise that should be penalized in rotation detection

-- Russell reconstitution happens annually in June
-- The reconstitution is announced in May and effective in late June
-- Window: announcement (early May) through effective date (end of June)

-- S&P rebalances are announced and typically effective within a few days
-- We model quarterly announcement windows (last week of Mar/Jun/Sep/Dec)

-- Primary key for index_windows is implicit based on all columns
ALTER TABLE index_windows ADD PRIMARY KEY (index_name, phase, window_start, window_end);

-- Russell 2023 reconstitution (example year, should be updated yearly)
INSERT INTO index_windows (index_name, phase, window_start, window_end) VALUES
('Russell 2000', 'announcement', '2023-05-01', '2023-05-31'),
('Russell 2000', 'effective', '2023-06-23', '2023-06-30'),
('Russell 2000', 'announcement', '2024-05-01', '2024-05-31'),
('Russell 2000', 'effective', '2024-06-21', '2024-06-30'),
('Russell 2000', 'announcement', '2025-05-01', '2025-05-31'),
('Russell 2000', 'effective', '2025-06-20', '2025-06-30');

-- S&P quarterly rebalance windows (announcement periods)
-- S&P changes can happen any time but concentrate around quarter-ends
INSERT INTO index_windows (index_name, phase, window_start, window_end) VALUES
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
('S&P 500', 'q4_rebal', '2025-12-22', '2025-12-31');

-- S&P MidCap 400
INSERT INTO index_windows (index_name, phase, window_start, window_end) VALUES
('S&P 400', 'q1_rebal', '2024-03-20', '2024-03-31'),
('S&P 400', 'q2_rebal', '2024-06-21', '2024-06-30'),
('S&P 400', 'q3_rebal', '2024-09-20', '2024-09-30'),
('S&P 400', 'q4_rebal', '2024-12-20', '2024-12-31'),
('S&P 400', 'q1_rebal', '2025-03-21', '2025-03-31'),
('S&P 400', 'q2_rebal', '2025-06-23', '2025-06-30'),
('S&P 400', 'q3_rebal', '2025-09-22', '2025-09-30'),
('S&P 400', 'q4_rebal', '2025-12-22', '2025-12-31');

-- Create an index for fast lookups
CREATE INDEX idx_index_windows_dates ON index_windows(window_start, window_end);
