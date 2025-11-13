-- Add ticker column to entities table for cleaner entity lookups
-- This allows ETFs and issuers to be looked up by their trading symbols
-- while keeping CIK as the proper SEC identifier (CIK or Series ID)

alter table entities add column ticker text;

-- Create index for efficient ticker lookups
create index idx_entities_ticker on entities(ticker) where ticker is not null;

-- Add unique constraint to prevent duplicate tickers for same kind
create unique index idx_entities_ticker_kind on entities(ticker, kind) where ticker is not null;
