-- Add series_id column to entities table for proper fund/ETF identification
-- (Problem 3 & 9: Fix ETF schema and extend series_id usage to mutual funds)
--
-- Background:
-- - SEC assigns series IDs to both ETFs and mutual funds within fund families
-- - Series ID format: S000012345 (unique fund identifier)
-- - CIK identifies the parent trust/family, series_id identifies the specific fund
-- - Example: Vanguard Total Stock Market Index Fund
--   - Trust CIK: 0000862084
--   - Series ID: S000002839
-- - N-PORT filings reference series IDs in headers
-- - EDGAR API requires series_id for fund-specific queries
--
-- Migration 005 temporarily stored series IDs in the cik column to satisfy
-- the unique(cik, kind) constraint. This migration moves them to the proper
-- series_id column and sets the correct trust CIK.

-- Step 1: Add series_id column
ALTER TABLE entities
ADD COLUMN IF NOT EXISTS series_id TEXT;

-- Step 2: Migrate existing ETF data (Problem 3: Fix ETF schema)
-- Move series IDs from cik column to series_id column and set proper trust CIK
UPDATE entities
SET
  series_id = cik,  -- Move current cik (which contains series ID) to series_id
  cik = '0001100663'  -- Set proper iShares Trust CIK
WHERE kind = 'etf'
  AND cik LIKE 'S%'  -- Only update if cik contains a series ID (starts with 'S')
  AND series_id IS NULL;  -- Only if not already migrated

-- Step 3: Drop old unique constraint on (cik, kind)
ALTER TABLE entities
DROP CONSTRAINT IF NOT EXISTS entities_cik_kind_key;

-- Step 4: Create new unique constraint on (cik, series_id, kind)
-- This allows multiple ETFs/funds with same cik but different series_id
-- For non-ETFs/funds where series_id is NULL, cik+kind provides uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS entities_unique_identifier_kind
ON entities (cik, COALESCE(series_id, ''), kind);

-- Step 5: Add documentation
COMMENT ON COLUMN entities.series_id IS 'SEC series identifier for ETFs and mutual funds (format: S000012345). NULL for issuers and managers. Required for fund-specific SEC EDGAR queries.';
COMMENT ON TABLE entities IS 'Entities table supporting issuers, managers, ETFs, and mutual funds. For ETFs/funds, cik identifies the parent trust and series_id identifies the specific fund series.';

-- Step 6: Create index for series_id lookups
CREATE INDEX IF NOT EXISTS idx_entities_series_id
ON entities(series_id)
WHERE series_id IS NOT NULL;

-- Step 7: Add check constraint to ensure series_id format is valid
ALTER TABLE entities
ADD CONSTRAINT IF NOT EXISTS check_series_id_format
CHECK (
  series_id IS NULL OR
  series_id ~ '^S[0-9]{9}$'
);
