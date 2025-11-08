insert into entities (cik, name, kind)
values
  ('IWB', 'iShares Russell 1000 ETF', 'etf'),
  ('IWM', 'iShares Russell 2000 ETF', 'etf'),
  ('IWN', 'iShares Russell 2000 Value ETF', 'etf'),
  ('IWC', 'iShares Micro-Cap ETF', 'etf')
on conflict (cik, kind) do update set
  name = excluded.name;
