-- Seed iShares ETF entities with proper SEC Series IDs and tickers
-- All are part of iShares Trust (CIK 0001100663)
-- Series IDs are official SEC identifiers for each fund series

insert into entities (cik, ticker, name, kind)
values
  ('S000004347', 'IWB', 'iShares Russell 1000 ETF', 'etf'),
  ('S000004344', 'IWM', 'iShares Russell 2000 ETF', 'etf'),
  ('S000004348', 'IWN', 'iShares Russell 2000 Value ETF', 'etf'),  -- TODO: Verify series ID
  ('S000004349', 'IWC', 'iShares Micro-Cap ETF', 'etf')            -- TODO: Verify series ID
on conflict (cik, kind) do update set
  name = excluded.name,
  ticker = excluded.ticker;
