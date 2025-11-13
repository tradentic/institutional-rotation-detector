-- Migration 013: Insider Transaction Tracking (Form 4)
-- Tracks insider buying/selling to validate institutional rotation signals

-- ============================================================================
-- Insider Transactions (Form 4)
-- ============================================================================
-- SEC Form 4 must be filed within 2 business days of insider transactions
-- This provides early-warning signals for rotation validation
create table if not exists insider_transactions (
  id bigserial primary key,

  -- Filing metadata
  accession_number text not null unique,  -- SEC accession number (e.g., 0001234567-24-000123)
  filing_date date not null,              -- When Form 4 was filed

  -- Security identification
  cusip text,
  ticker text,
  issuer_cik text,
  issuer_name text,

  -- Transaction details
  transaction_date date not null,         -- Actual transaction date
  transaction_code text not null,         -- P=Purchase, S=Sale, A=Award, D=Disposition, etc.
  transaction_shares bigint,              -- Number of shares transacted
  transaction_price_per_share numeric,    -- Price per share (null if non-market transaction)
  transaction_acquired_disposed text check (transaction_acquired_disposed in ('A', 'D')),

  -- Insider information
  reporting_owner_cik text,
  reporting_owner_name text,
  is_director boolean default false,
  is_officer boolean default false,
  is_ten_percent_owner boolean default false,
  is_other boolean default false,
  officer_title text,                     -- CEO, CFO, etc.

  -- Ownership after transaction
  shares_owned_following_transaction bigint,
  direct_or_indirect_ownership text,      -- 'D' (direct) or 'I' (indirect)

  -- Derivative information (options, warrants, etc.)
  is_derivative boolean default false,
  underlying_security_title text,
  conversion_or_exercise_price numeric,
  exercise_date date,
  expiration_date date,

  -- Classification flags
  is_rule_10b5_1 boolean default false,   -- Planned trade under 10b5-1
  is_gift boolean default false,          -- Transaction was a gift
  transaction_type_category text,         -- 'OPEN_MARKET'|'PRIVATE'|'OPTION_EXERCISE'|'GRANT'|'OTHER'

  -- Metadata
  sec_url text,                           -- URL to filing
  xml_source text,                        -- Raw XML content (compressed)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists insider_transactions_cusip_idx
  on insider_transactions(cusip, transaction_date desc);
create index if not exists insider_transactions_ticker_idx
  on insider_transactions(ticker, transaction_date desc);
create index if not exists insider_transactions_filing_date_idx
  on insider_transactions(filing_date desc);
create index if not exists insider_transactions_transaction_date_idx
  on insider_transactions(transaction_date desc);
create index if not exists insider_transactions_issuer_cik_idx
  on insider_transactions(issuer_cik, transaction_date desc);
create index if not exists insider_transactions_owner_cik_idx
  on insider_transactions(reporting_owner_cik, transaction_date desc);
create index if not exists insider_transactions_code_idx
  on insider_transactions(transaction_code)
  where transaction_code in ('P', 'S'); -- Focus on purchases and sales

comment on table insider_transactions is
  'SEC Form 4 insider transactions (2-day reporting lag). Used for rotation validation.';
comment on column insider_transactions.transaction_code is
  'P=Purchase, S=Sale, A=Award, D=Disposition (exercise to cover), G=Gift, M=Exercise/Conversion';
comment on column insider_transactions.is_rule_10b5_1 is
  'Whether transaction was made under pre-arranged 10b5-1 trading plan (less informative signal)';

-- ============================================================================
-- Insider Summary by Period
-- ============================================================================
-- Aggregated insider buying/selling for efficient querying
create table if not exists insider_summary_daily (
  cusip text not null,
  ticker text,
  transaction_date date not null,

  -- Aggregate metrics
  total_insider_purchases bigint default 0,
  total_insider_sales bigint default 0,
  net_insider_flow bigint,                -- purchases - sales

  -- Transaction counts
  purchase_count integer default 0,
  sale_count integer default 0,

  -- Value metrics (if price available)
  total_purchase_value numeric,
  total_sale_value numeric,

  -- Insider type breakdown
  director_net_flow bigint,
  officer_net_flow bigint,
  ten_percent_owner_net_flow bigint,

  -- Flags
  has_ceo_activity boolean default false,
  has_cfo_activity boolean default false,
  has_large_purchase boolean default false, -- Single purchase > threshold
  has_cluster_activity boolean default false, -- Multiple insiders same day

  -- Metadata
  computed_at timestamptz default now(),
  primary key (cusip, transaction_date)
);

create index if not exists insider_summary_daily_ticker_idx
  on insider_summary_daily(ticker, transaction_date desc);
create index if not exists insider_summary_daily_net_flow_idx
  on insider_summary_daily(net_insider_flow desc)
  where abs(net_insider_flow) > 0;
create index if not exists insider_summary_daily_large_purchase_idx
  on insider_summary_daily(transaction_date desc)
  where has_large_purchase = true;

comment on table insider_summary_daily is
  'Daily aggregated insider transaction activity for efficient rotation scoring';
comment on column insider_summary_daily.net_insider_flow is
  'Net shares: purchases minus sales. Positive = insider buying, Negative = insider selling';

-- ============================================================================
-- Rotation Events Enhancement: Insider Signals
-- ============================================================================
-- Add insider signal columns to rotation_events table
alter table rotation_events add column if not exists insider_net_flow_same_quarter bigint;
alter table rotation_events add column if not exists insider_net_flow_next_quarter bigint;
alter table rotation_events add column if not exists insider_post_dump_buying boolean;
alter table rotation_events add column if not exists insider_pre_dump_selling boolean;
alter table rotation_events add column if not exists insider_signal_strength numeric;
alter table rotation_events add column if not exists insider_confidence numeric check (insider_confidence between 0 and 1);

comment on column rotation_events.insider_net_flow_same_quarter is
  'Net insider buying (+) or selling (-) in shares during same quarter as dump';
comment on column rotation_events.insider_net_flow_next_quarter is
  'Net insider buying/selling in quarter following dump';
comment on column rotation_events.insider_post_dump_buying is
  'Whether insiders bought shares in 30 days after dump (contrarian signal)';
comment on column rotation_events.insider_pre_dump_selling is
  'Whether insiders sold shares in 30 days before dump (validation signal)';
comment on column rotation_events.insider_signal_strength is
  'Composite insider signal strength for scoring algorithm';

-- ============================================================================
-- Form 4 Filing Tracking
-- ============================================================================
-- Tracks which Form 4 filings have been processed
create table if not exists form4_filings (
  accession_number text primary key,
  issuer_cik text not null,
  filing_date date not null,
  period_of_report date,                  -- Date of earliest transaction in filing

  -- Processing status
  status text check (status in ('PENDING', 'PROCESSED', 'FAILED', 'SKIPPED')) default 'PENDING',
  error_message text,

  -- Filing metadata
  document_count integer,                 -- Number of transactions in filing
  is_amendment boolean default false,
  amends_accession text,                  -- If amendment, which filing it amends

  -- SEC metadata
  sec_url text,
  file_number text,
  film_number text,

  -- Provenance
  ingested_at timestamptz default now(),
  processed_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists form4_filings_issuer_cik_idx
  on form4_filings(issuer_cik, filing_date desc);
create index if not exists form4_filings_filing_date_idx
  on form4_filings(filing_date desc);
create index if not exists form4_filings_status_idx
  on form4_filings(status)
  where status in ('PENDING', 'FAILED');

comment on table form4_filings is
  'Tracks Form 4 filing ingestion status for idempotency and error handling';

-- ============================================================================
-- Grants
-- ============================================================================
grant all on insider_transactions to service_role;
grant all on insider_summary_daily to service_role;
grant all on form4_filings to service_role;

grant usage, select on sequence insider_transactions_id_seq to service_role;
