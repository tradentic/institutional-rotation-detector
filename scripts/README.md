# Scripts Directory

Utility scripts for database maintenance, diagnostics, and data fixes.

## CUSIP Resolution Scripts

### `fix-aapl-cusip.sql`

Manually fixes AAPL's CUSIP mapping when SEC API returns empty securities array.

**Problem:** SEC submissions API often returns empty `securities` arrays for single-class stocks, causing the system to fall back to using ticker symbols as CUSIPs. This breaks ETF holdings and FINRA short interest queries.

**Usage:**
```bash
# Via psql
psql $DATABASE_URL -f scripts/fix-aapl-cusip.sql

# Via Supabase SQL Editor
# Copy and paste the contents into the SQL editor
```

**What it does:**
- Updates `cusip_issuer_map` record for CIK 0000320193
- Changes CUSIP from "AAPL" (ticker fallback) to "037833100" (real CUSIP)
- Shows before/after state for verification

**After running:** Re-run ingestion workflows to collect data with the correct CUSIP.

### `test-sec-cusip-response.sh`

Tests SEC API responses to diagnose CUSIP extraction issues.

**Usage:**
```bash
chmod +x scripts/test-sec-cusip-response.sh
./scripts/test-sec-cusip-response.sh
```

**What it checks:**
- Whether SEC submissions endpoint has `securities` array
- Count of securities entries
- First few securities to see structure
- Helps diagnose why CUSIPs aren't being extracted

## Common CUSIP Fixes

For other tickers with similar issues, use this SQL pattern:

```sql
-- Generic CUSIP fix template
UPDATE cusip_issuer_map
SET cusip = '<real-9-char-cusip>'
WHERE issuer_cik = '<10-digit-cik>'
  AND cusip = '<ticker-symbol>';
```

**Finding real CUSIPs:**
1. SEC EDGAR filings (search for ticker, look at 10-K/10-Q)
2. OpenFIGI API: https://www.openfigi.com/api
3. Bloomberg Terminal (if available)
4. Company investor relations page

## Known SEC API Limitations

The SEC submissions API (`/submissions/CIK*.json`) often has empty `securities` arrays for:
- Single-class common stocks (e.g., AAPL, MSFT, GOOGL)
- Recently restructured companies
- Special corporate structures

**Workaround options:**
1. Manual SQL updates (use scripts in this directory)
2. External CUSIP lookup services
3. Accept ticker fallback for data sources that support it

See `docs/QA_DIAGNOSTIC_TOOL.md` for more details on diagnosing CUSIP issues.
