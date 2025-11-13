-- Fix AAPL CUSIP mapping
--
-- Problem: SEC submissions API returned empty 'securities' array for AAPL,
-- causing the system to fall back to using ticker symbol "AAPL" as the CUSIP.
-- This breaks ETF holdings and FINRA short interest queries which require
-- real 9-character CUSIPs.
--
-- Solution: Manually update the CUSIP to the correct value.
--
-- AAPL's official CUSIP: 037833100
-- Source: https://www.sec.gov/ (can be verified via EDGAR filings)

BEGIN;

-- Show current state
SELECT
    'Before update' as status,
    cusip,
    issuer_cik,
    series_id
FROM cusip_issuer_map
WHERE issuer_cik = '0000320193';

-- Update AAPL ticker to real CUSIP
-- If the ticker "AAPL" exists as a CUSIP, update it
UPDATE cusip_issuer_map
SET cusip = '037833100'
WHERE issuer_cik = '0000320193'
  AND cusip = 'AAPL';

-- Show updated state
SELECT
    'After update' as status,
    cusip,
    issuer_cik,
    series_id
FROM cusip_issuer_map
WHERE issuer_cik = '0000320193';

-- Verify the change
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM cusip_issuer_map
        WHERE issuer_cik = '0000320193'
          AND cusip = '037833100'
    ) THEN
        RAISE NOTICE 'SUCCESS: AAPL CUSIP updated to 037833100';
    ELSE
        RAISE EXCEPTION 'FAILED: CUSIP not updated. Check if record exists with issuer_cik = 0000320193';
    END IF;
END $$;

COMMIT;

-- After running this script, re-run your ingestion workflows:
--
-- 1. Validate the fix:
--    temporal workflow start \
--      --namespace ird \
--      --task-queue rotation-detector \
--      --type qaReportWorkflow \
--      --input '{"ticker": "AAPL", "from": "2024-01-01", "to": "2024-03-31"}'
--
-- 2. Re-run ETF holdings ingestion:
--    temporal workflow start \
--      --namespace ird \
--      --task-queue rotation-detector \
--      --type ingestIssuerWorkflow \
--      --input '{"ticker": "AAPL", "from": "2024-01-01", "to": "2024-03-31", "runKind": "daily", "minPct": 5}'
--
-- Expected QA report after fix:
--   - cusips.fromDatabase: ["037833100"] ✓
--   - cusips.usingTickerFallback: false ✓
--   - etfHoldings.totalPositions: > 0 ✓
