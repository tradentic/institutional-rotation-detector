-- Amendment supersedence views
-- These views show only the latest version of filings, filtering out superseded amendments

-- View: current_filings
-- Returns only the most recent version of each filing
-- If a filing has been amended, show only the amendment, not the original
CREATE OR REPLACE VIEW current_filings AS
WITH amendment_chains AS (
  -- Build chains of amendments: original -> amendment1 -> amendment2 -> ...
  -- Find the "head" (most recent) filing in each chain
  SELECT DISTINCT ON (COALESCE(amendment_of_accession, accession))
    accession,
    cik,
    form,
    filed_date,
    period_end,
    event_date,
    url,
    cadence,
    expected_publish_at,
    published_at,
    is_amendment,
    amendment_of_accession,
    COALESCE(amendment_of_accession, accession) as chain_root
  FROM filings
  ORDER BY COALESCE(amendment_of_accession, accession), filed_date DESC, accession DESC
)
SELECT
  accession,
  cik,
  form,
  filed_date,
  period_end,
  event_date,
  url,
  cadence,
  expected_publish_at,
  published_at,
  is_amendment,
  amendment_of_accession
FROM amendment_chains;

-- View: current_positions_13f
-- Returns positions from current_filings only (excludes superseded filings)
CREATE OR REPLACE VIEW current_positions_13f AS
SELECT p.*
FROM positions_13f p
WHERE p.accession IN (SELECT accession FROM current_filings);

-- View: superseded_filings
-- Returns filings that have been superseded by amendments
CREATE OR REPLACE VIEW superseded_filings AS
SELECT f.*
FROM filings f
WHERE EXISTS (
  SELECT 1 FROM filings amendments
  WHERE amendments.amendment_of_accession = f.accession
);

-- View: filing_history
-- Shows the full amendment history for each filing chain
CREATE OR REPLACE VIEW filing_history AS
WITH RECURSIVE amendment_chain AS (
  -- Start with original filings (not amendments)
  SELECT
    accession,
    cik,
    form,
    filed_date,
    period_end,
    is_amendment,
    amendment_of_accession,
    accession as root_accession,
    0 as amendment_depth,
    ARRAY[accession] as chain
  FROM filings
  WHERE is_amendment = false

  UNION ALL

  -- Recursively find amendments
  SELECT
    f.accession,
    f.cik,
    f.form,
    f.filed_date,
    f.period_end,
    f.is_amendment,
    f.amendment_of_accession,
    ac.root_accession,
    ac.amendment_depth + 1,
    ac.chain || f.accession
  FROM filings f
  INNER JOIN amendment_chain ac ON f.amendment_of_accession = ac.accession
)
SELECT * FROM amendment_chain
ORDER BY root_accession, amendment_depth;

-- Index for faster amendment lookups
CREATE INDEX IF NOT EXISTS idx_filings_amendment_of ON filings(amendment_of_accession) WHERE amendment_of_accession IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_filings_is_amendment ON filings(is_amendment) WHERE is_amendment = true;

-- Comment documentation
COMMENT ON VIEW current_filings IS 'Shows only the latest version of each filing, filtering out superseded amendments';
COMMENT ON VIEW current_positions_13f IS 'Shows positions from current filings only (excludes positions from superseded filings)';
COMMENT ON VIEW superseded_filings IS 'Shows filings that have been superseded by amendments';
COMMENT ON VIEW filing_history IS 'Shows the full amendment chain history for each filing';
