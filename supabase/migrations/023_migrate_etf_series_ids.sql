-- Migrate ETF entities to use proper CIK and series_id structure
-- Currently: cik contains series IDs (wrong)
-- After: cik contains trust CIK, series_id contains series ID

-- All iShares ETFs are part of iShares Trust (CIK 0001100663)

-- IWB: iShares Russell 1000 ETF
update entities
set series_id = cik, cik = '0001100663'
where ticker = 'IWB' and kind = 'etf';

-- IWM: iShares Russell 2000 ETF
update entities
set series_id = cik, cik = '0001100663'
where ticker = 'IWM' and kind = 'etf';

-- IWN: iShares Russell 2000 Value ETF
update entities
set series_id = cik, cik = '0001100663'
where ticker = 'IWN' and kind = 'etf';

-- IWC: iShares Micro-Cap ETF
update entities
set series_id = cik, cik = '0001100663'
where ticker = 'IWC' and kind = 'etf';
