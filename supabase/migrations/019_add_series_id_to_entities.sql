-- Add series_id column to entities table for proper fund/ETF identification
-- (Problem 9: Extend series_id usage to both ETFs and mutual funds)
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

-- Add series_id column (if not exists)
ALTER TABLE entities
ADD COLUMN IF NOT EXISTS series_id TEXT;

-- Update unique constraint to handle series_id
-- For ETFs and funds: (cik, series_id, kind) must be unique
-- For issuers/managers: (cik, kind) must be unique (series_id will be NULL)

-- Drop old constraint if exists
ALTER TABLE entities
DROP CONSTRAINT IF EXISTS entities_cik_kind_key;

-- Create new unique index that handles both cases
CREATE UNIQUE INDEX IF NOT EXISTS entities_unique_identifier
ON entities (cik, COALESCE(series_id, ''), kind);

-- Add comments for documentation
COMMENT ON COLUMN entities.series_id IS 'SEC series identifier for ETFs and mutual funds (format: S000012345). NULL for issuers and managers. Required for fund-specific SEC EDGAR queries.';
COMMENT ON TABLE entities IS 'Entities table supporting issuers, managers, ETFs, and mutual funds. For ETFs/funds, cik identifies the parent trust and series_id identifies the specific fund series.';

-- Create index for series_id lookups
CREATE INDEX IF NOT EXISTS idx_entities_series_id
ON entities(series_id)
WHERE series_id IS NOT NULL;

-- Add check constraint to ensure series_id format is valid
ALTER TABLE entities
ADD CONSTRAINT check_series_id_format
CHECK (
  series_id IS NULL OR
  series_id ~ '^S[0-9]{9}$'
);
