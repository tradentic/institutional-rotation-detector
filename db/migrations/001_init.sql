create extension if not exists vector;

create table entities (
  entity_id uuid primary key default gen_random_uuid(),
  cik text,
  name text not null,
  kind text check (kind in ('issuer','manager','fund','etf')) not null,
  unique(cik, kind)
);

create table filings (
  accession text primary key,
  cik text not null,
  form text not null,
  filed_date date not null,
  period_end date,
  event_date date,
  url text not null
);

create table positions_13f (
  entity_id uuid references entities,
  cusip text not null,
  asof date not null,
  shares bigint default 0,
  opt_put_shares bigint default 0,
  opt_call_shares bigint default 0,
  accession text references filings(accession),
  primary key (entity_id, cusip, asof, accession)
);

create table bo_snapshots (
  issuer_cik text not null,
  holder_cik text not null,
  event_date date not null,
  filed_date date not null,
  pct_of_class numeric,
  shares_est bigint,
  accession text references filings(accession),
  primary key (issuer_cik, holder_cik, event_date, accession)
);

create table uhf_positions (
  holder_id uuid references entities,
  cusip text not null,
  asof date not null,
  shares bigint not null,
  source text check (source in ('NPORT','ETF')) not null,
  primary key (holder_id, cusip, asof, source)
);

create table short_interest (
  settle_date date not null,
  cik text not null,
  short_shares bigint not null,
  primary key (settle_date, cik)
);

create table ats_weekly (
  week_end date not null,
  cik text not null,
  venue text not null,
  shares bigint not null,
  trades bigint,
  primary key (week_end, cik, venue)
);

create table index_windows (
  index_name text not null,
  phase text not null,
  window_start date not null,
  window_end date not null
);

create table rotation_edges (
  cluster_id uuid default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  seller_id uuid references entities,
  buyer_id uuid references entities,
  cusip text not null,
  equity_shares bigint default 0,
  options_shares bigint default 0,
  confidence numeric check (confidence between 0 and 1) default 0.8,
  notes text,
  primary key (cluster_id, seller_id, buyer_id, cusip)
);

create table rotation_events (
  cluster_id uuid primary key,
  issuer_cik text not null,
  anchor_filing text references filings(accession),
  dumpz numeric,
  u_same numeric,
  u_next numeric,
  uhf_same numeric,
  uhf_next numeric,
  opt_same numeric,
  opt_next numeric,
  shortrelief_v2 numeric,
  index_penalty numeric,
  eow boolean,
  r_score numeric,
  car_m5_p20 numeric,
  t_to_plus20_days int,
  max_ret_w13 numeric
);

create table filing_chunks (
  accession text references filings(accession),
  chunk_no int,
  content text,
  embedding vector(1536),
  primary key (accession, chunk_no)
);
