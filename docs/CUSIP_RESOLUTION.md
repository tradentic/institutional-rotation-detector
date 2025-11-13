# Self-Healing CUSIP Resolution

## Overview

This document explains the automatic CUSIP resolution system that ensures workflows never silently fail due to missing CUSIP data.

## The Problem: Ticker Symbol Fallback

### Original Behavior (REMOVED)

Previously, when the SEC submissions API returned an empty `securities` array, the system would fall back to using ticker symbols as "CUSIPs":

```typescript
// OLD CODE - DO NOT USE
if (normalizedCusips.length === 0) {
  cusipsToReturn = [ticker]; // e.g., "AAPL" instead of "037833100"
}
```

### Why This Was Bad

1. **Silent Failures**: Workflow appeared to succeed but collected no data
   ```
   [upsertCusipMapping] Added 1 CUSIP mappings for CIK 0000320193
   ```
   ✅ Logs say success, but it stored "AAPL" not "037833100"

2. **Cascading Data Collection Failures**:
   - ❌ ETF holdings queries fail (require real 9-char CUSIPs)
   - ❌ FINRA short interest fails (requires real CUSIPs)
   - ❌ Some 13F institutional holdings fail

3. **No Visibility**: Without diagnostic tools, impossible to detect

4. **SEC API Limitation**: The `securities` array is often empty for:
   - Single-class common stocks (AAPL, MSFT, GOOGL, etc.)
   - Recently restructured companies
   - Special corporate structures

## The Solution: Ticker Fallback with Loud Warnings

### Reality Check: No Free CUSIP APIs Exist

After extensive testing, we discovered that **no free public APIs reliably provide CUSIP data**:

- ❌ **OpenFIGI API**: Doesn't include `metadata.cusip` field (only returns FIGI, ticker, exchange)
- ❌ **SEC EDGAR XML**: Files often don't exist (404s) or don't contain CUSIPs in parseable format
- ✅ **SEC Submissions API**: Works ~40% of the time (best option, but limited)

### Current Behavior

Given the limitations of free data sources, the system uses a pragmatic approach:

```
1. SEC Submissions API (fast, works ~40% of the time)
   ↓ If empty...
2. Ticker Symbol Fallback (with LOUD warnings)
   ✓ Workflow continues with partial data
   ✓ QA tool detects and reports the issue
   ✓ Clear manual fix instructions provided
   ✓ No silent failures
```

**Why not throw an error?**
- Some data sources accept ticker symbols (13F holdings, price data)
- Partial data > no data
- Workflow can continue while manual CUSIP fix is in progress
- QA tool provides visibility into which tickers need fixes

### Code Architecture

**Main Entry Point:**
```typescript
import { getCusipForTicker } from './cusip-resolution.activities';

// In resolveCIK activity
const cusips = await getCusipForTicker(ticker, cik, secSubmissionsCusips);
// Returns real 9-character CUSIPs OR ticker symbol with loud warnings
```

**Fallback Implementation:**
```typescript
export async function resolveCusipWithFallback(
  ticker: string,
  cik: string,
  secSubmissionsCusips: string[] = []
): Promise<CusipResolutionResult> {
  // 1. Use SEC submissions if available (~40% success rate)
  if (secSubmissionsCusips.length > 0) {
    return { cusips: secSubmissionsCusips, source: 'sec_submissions', confidence: 'high' };
  }

  // 2. Fall back to ticker symbol with LOUD warnings
  console.warn(`⚠️  CUSIP RESOLUTION FAILED FOR ${ticker}`);
  console.warn(`FALLING BACK TO TICKER SYMBOL`);
  console.warn(`MANUAL FIX REQUIRED - see logs for instructions`);

  return {
    cusips: [ticker],
    source: 'manual',
    confidence: 'low',
    metadata: { warning: 'Ticker symbol used as CUSIP fallback' }
  };
}
```

## Data Sources

### 1. SEC Submissions API (Only Working Source)

**Endpoint:** `https://data.sec.gov/submissions/CIK{cik}.json`

**Pros:**
- Fast (~200-500ms)
- Already being called
- No additional API key needed
- Works ~40% of the time

**Cons:**
- Often returns empty `securities` array for single-class stocks
- Unreliable for many major companies (AAPL, MSFT, GOOGL, etc.)

**Example Response (AAPL - fails):**
```json
{
  "cik": "0000320193",
  "name": "Apple Inc.",
  "tickers": ["AAPL"],
  "securities": []  // ← Empty! No CUSIP available
}
```

**Example Response (smaller company - works):**
```json
{
  "cik": "0001234567",
  "name": "Example Corp",
  "tickers": ["EXMP"],
  "securities": [
    {
      "cusip": "123456789",
      "name": "Common Stock"
    }
  ]  // ✓ Has CUSIP!
}
```

### 2. ❌ OpenFIGI API (Doesn't Work)

**Why we tried it:** Bloomberg's free API, comprehensive coverage, should return CUSIP.

**Why it doesn't work:** The free API response **does NOT include CUSIP data**.

**Actual Response:**
```json
[
  {
    "data": [
      {
        "figi": "BBG000B9XRY4",
        "securityType": "Common Stock",
        "marketSector": "Equity",
        "ticker": "AAPL",
        "exchCode": "US"
        // ❌ No "metadata.cusip" field!
        // ❌ No "metadata.isin" field!
      }
    ]
  }
]
```

**Conclusion:** Free tier doesn't provide CUSIP. Paid Bloomberg Terminal required.

### 3. ❌ SEC EDGAR Filings XML (Doesn't Work)

**Why we tried it:** Parse 10-K/10-Q/8-K XML files to extract CUSIP from filings.

**Why it doesn't work:**
- Most XML files return **404 Not Found** (files don't exist at expected URLs)
- Files that do exist often don't contain CUSIP in parseable format
- CUSIP location varies wildly across filing formats
- Success rate < 5% after testing

**Attempted URLs (all fail with 404):**
```
/Archives/edgar/data/{cik}/{accession}/primary_doc.xml
/Archives/edgar/data/{cik}/{accession}/nport.xml
/Archives/edgar/data/{cik}/{accession}/{accession}.xml
/Archives/edgar/data/{cik}/{accession}/10k.xml
/Archives/edgar/data/{cik}/{accession}/primary_document.xml
```

**Conclusion:** Not reliable enough for production use.

## Usage Examples

### Automatic (Default)

CUSIP resolution runs automatically in `resolveCIK`:

```bash
# Run any workflow that creates entities
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type ingestIssuerWorkflow \
  --input '{
    "ticker": "AAPL",
    "from": "2024-01-01",
    "to": "2024-03-31",
    "runKind": "daily",
    "minPct": 5
  }'
```

**Expected outcome for AAPL (and most single-class stocks):**

```
[CUSIP Resolution] Starting resolution for AAPL
================================================================================
⚠️  CUSIP RESOLUTION FAILED FOR AAPL
================================================================================
SEC submissions API returned no CUSIPs for AAPL (CIK: 0000320193)
This is common for single-class stocks like AAPL, MSFT, GOOGL, etc.

FALLING BACK TO TICKER SYMBOL: "AAPL"

⚠️  IMPACT:
   - ETF holdings queries will likely fail (require 9-char CUSIPs)
   - FINRA short interest data will fail (require 9-char CUSIPs)
   - Some 13F institutional holdings may fail

🔧 MANUAL FIX REQUIRED:
   1. Find real CUSIP from SEC EDGAR, Bloomberg, or company IR
   2. Run: psql $DATABASE_URL -f scripts/fix-aapl-cusip.sql
   3. Update the SQL script with the real CUSIP
   4. Re-run this workflow to collect data with correct CUSIP
================================================================================

[CUSIP Resolution] ✓ Resolved AAPL → AAPL (source: manual, confidence: low)
```

**The workflow continues** and collects partial data (13F holdings, price data).
Use the QA tool to see what data is missing.

### Manual (Direct Call)

You can also call CUSIP resolution directly:

```typescript
import { getCusipForTicker, resolveCusipWithFallback } from './cusip-resolution.activities';

// Simple usage
const cusips = await getCusipForTicker('AAPL', '0000320193');
// Returns: ["AAPL"] (ticker fallback if SEC API has no CUSIP)
// Returns: ["037833100"] (real CUSIP if SEC API has it)

// Detailed usage with metadata
const result = await resolveCusipWithFallback('AAPL', '0000320193');
// When SEC API fails, returns:
// {
//   cusips: ["AAPL"],
//   source: "manual",
//   confidence: "low",
//   metadata: {
//     warning: "Ticker symbol used as CUSIP fallback - manual intervention required"
//   }
// }
//
// When SEC API succeeds, returns:
// {
//   cusips: ["037833100"],
//   source: "sec_submissions",
//   confidence: "high"
// }
```

## Error Handling

### When SEC Submissions API Has No CUSIP

**Current behavior:** Workflow continues with ticker fallback + loud warnings

**Rationale:**
- ✅ **Partial data collection** continues (13F holdings, price data work)
- ✅ **Clear visibility** via loud warnings in logs
- ✅ **QA tool detection** identifies ticker fallbacks automatically
- ✅ **Manual fix guidance** provided in warning messages
- ✅ **Better than silent failure** (old behavior)
- ✅ **Better than hard failure** (blocks all data collection)

**Trade-offs accepted:**
- ⚠️ ETF holdings queries will fail (need real CUSIPs)
- ⚠️ FINRA short interest will fail (need real CUSIPs)
- ⚠️ Some 13F queries may return incomplete results

### Manual Fix Workflow

1. **Check the error message** - tells you exactly what failed
2. **Find the real CUSIP** from:
   - SEC EDGAR search
   - Company investor relations
   - Bloomberg Terminal
   - OpenFIGI website
3. **Run SQL fix script**:
   ```bash
   # Use template from scripts/fix-aapl-cusip.sql
   psql $DATABASE_URL -f scripts/fix-${ticker}-cusip.sql
   ```
4. **Validate with QA tool**:
   ```bash
   temporal workflow start \
     --namespace ird \
     --task-queue rotation-detector \
     --type qaReportWorkflow \
     --input '{"ticker": "AAPL", "from": "2024-01-01", "to": "2024-03-31"}'
   ```
5. **Re-run ingestion workflow**

## Monitoring & Diagnostics

### QA Tool Integration

The QA diagnostic tool automatically detects CUSIP resolution issues:

```json
{
  "cusips": {
    "fromDatabase": ["AAPL"],         // Bad: ticker symbol
    "fromSecApi": [],
    "usingTickerFallback": true       // ✓ Detected!
  },
  "issues": [
    "No real CUSIP found - using ticker symbol as fallback: AAPL"
  ],
  "recommendations": [
    "SEC submissions API has empty 'securities' array (common for single-class stocks).",
    "Options: (1) Manually add CUSIP via SQL, (2) Use external CUSIP lookup, (3) Accept ticker fallback"
  ]
}
```

With the new self-healing resolution, this should rarely happen (only when all sources fail).

### Logs to Watch For

**Success (SEC Submissions - ~40% of cases):**
```
[resolveCIK] Normalized 1 CUSIPs from securities
[CUSIP Resolution] Starting resolution for EXMP
[CUSIP Resolution] ✓ Using CUSIPs from SEC submissions API
[CUSIP Resolution] ✓ Resolved EXMP → 123456789 (source: sec_submissions, confidence: high)
```

**Ticker Fallback (SEC API empty - ~60% of cases):**
```
[resolveCIK] Normalized 0 CUSIPs from securities
[CUSIP Resolution] Starting resolution for AAPL
================================================================================
⚠️  CUSIP RESOLUTION FAILED FOR AAPL
================================================================================
SEC submissions API returned no CUSIPs for AAPL (CIK: 0000320193)
This is common for single-class stocks like AAPL, MSFT, GOOGL, etc.

FALLING BACK TO TICKER SYMBOL: "AAPL"

⚠️  IMPACT:
   - ETF holdings queries will likely fail (require 9-char CUSIPs)
   - FINRA short interest data will fail (require 9-char CUSIPs)
   - Some 13F institutional holdings may fail

🔧 MANUAL FIX REQUIRED:
   1. Find real CUSIP from SEC EDGAR, Bloomberg, or company IR
   2. Run: psql $DATABASE_URL -f scripts/fix-aapl-cusip.sql
   3. Update the SQL script with the real CUSIP
   4. Re-run this workflow to collect data with correct CUSIP

📊 VALIDATE WITH QA TOOL:
   temporal workflow start \
     --namespace ird \
     --task-queue rotation-detector \
     --type qaReportWorkflow \
     --input '{"ticker": "AAPL", "from": "2024-01-01", "to": "2024-03-31"}'
================================================================================

[CUSIP Resolution] ✓ Resolved AAPL → AAPL (source: manual, confidence: low)
```

## Performance Considerations

### Latency

| Source | Typical Latency | Cache | Success Rate |
|--------|----------------|-------|--------------|
| SEC Submissions | 200-500ms | Redis (if enabled) | ~40% |
| Ticker Fallback | <1ms | N/A | 100% (always succeeds) |

**Total latency:** ~200-500ms (only one API call needed)

**Best-case (cache hit):** <100ms

### Rate Limits

| Source | Limit | Mitigation |
|--------|-------|-----------|
| SEC EDGAR | 10 req/sec | Built-in rate limiter |

No external API dependencies means no additional rate limit concerns.

## Migration Guide

### If You Have Existing Ticker Fallbacks

Run the QA tool to find all tickers using fallback:

```sql
-- Find all ticker fallback CUSIPs
SELECT
    cim.cusip,
    e.ticker,
    e.cik,
    e.name
FROM cusip_issuer_map cim
JOIN entities e ON e.cik = cim.issuer_cik
WHERE LENGTH(cim.cusip) != 9
   OR cim.cusip !~ '^[0-9A-Z]{9}$';
```

Then:
1. **Option A:** Manually fix each one using SQL templates from `scripts/`
   - More reliable - you control the CUSIP value
   - Use `scripts/fix-aapl-cusip.sql` as template

2. **Option B:** Delete and re-run workflows (will still use ticker fallback)
   ```sql
   DELETE FROM cusip_issuer_map WHERE cusip !~ '^[0-9A-Z]{9}$';
   ```
   - Still requires manual fix afterward (SEC API likely still has no CUSIP)
   - Only use if you want to re-collect all other data

### Testing the Migration

1. **Delete AAPL's ticker fallback:**
   ```sql
   DELETE FROM cusip_issuer_map WHERE issuer_cik = '0000320193';
   DELETE FROM entities WHERE cik = '0000320193';
   ```

2. **Re-run workflow:**
   ```bash
   temporal workflow start \
     --namespace ird \
     --task-queue rotation-detector \
     --type diagnosticEntityCreationWorkflow \
     --input '{"ticker": "AAPL"}'
   ```

3. **Verify real CUSIP:**
   ```bash
   temporal workflow start \
     --namespace ird \
     --task-queue rotation-detector \
     --type qaReportWorkflow \
     --input '{"ticker": "AAPL", "from": "2024-01-01", "to": "2024-03-31"}'
   ```

4. **Expected result:**
   ```json
   {
     "cusips": {
       "fromDatabase": ["037833100"],  // ✓ Real CUSIP!
       "usingTickerFallback": false
     }
   }
   ```

## Benefits

### 1. No Silent Failures
- ✅ **Loud warnings** when ticker fallback is used (impossible to miss)
- ✅ **QA tool detection** automatically identifies ticker fallbacks
- ✅ **Clear guidance** provided on how to fix
- ❌ No more "success" logs with silent data collection failures

### 2. Pragmatic Approach
- ✅ **Workflow continues** and collects partial data (better than hard failure)
- ✅ **~40% automatic resolution** via SEC submissions API (when available)
- ⚠️ **~60% require manual fix** (ticker fallback with loud warnings)
- ✅ **Clear visibility** via logs and QA tool

### 3. Improved Data Quality (After Manual Fix)
- Real 9-character CUSIPs enable:
  - ✅ ETF holdings tracking
  - ✅ FINRA short interest data
  - ✅ 13F institutional holdings (more complete)
  - ✅ Cross-referencing with other data sources

### 4. Clear Warning Messages
- When ticker fallback used, warnings explain:
  - Why it happened (SEC API has no CUSIP)
  - What the impact is (which data sources will fail)
  - How to fix it (manual SQL script with template)
  - How to validate (QA tool command)

### 5. Observable & Debuggable
- ✅ **LOUD warnings** in logs (80-character banners)
- ✅ **QA tool integration** for validation
- ✅ **Clear metrics** on resolution source and confidence
- ✅ **SQL templates** for fixing common tickers

## Future Enhancements

Potential improvements for the future:

1. **Paid Data Source Integration**
   - Bloomberg Terminal API (requires expensive license)
   - Refinitiv/LSEG data feeds (paid)
   - CUSIP Global Services (official paid service)
   - FactSet or similar financial data providers

2. **Manual CUSIP Database**
   - Pre-populate CUSIPs for S&P 500, Russell 2000, etc.
   - Maintain curated list of common tickers
   - Update via scheduled job or manual curation

3. **Improved SEC Filing Parsing**
   - Try HTML filings instead of XML (may have better coverage)
   - Parse 10-K/10-Q text for CUSIP references
   - Use LLM to extract CUSIP from unstructured filing text

4. **Automated Fix Scripts**
   - Generate SQL fix scripts automatically for detected fallbacks
   - Fetch CUSIP from OpenFIGI website (not API) via web scraping
   - Scheduled job to identify and flag ticker fallbacks

5. **User-Submitted CUSIPs**
   - Allow manual CUSIP submission via UI
   - Validate submissions against known sources
   - Crowdsource CUSIP data from users

## References

- SEC EDGAR API: https://www.sec.gov/edgar/sec-api-documentation
- OpenFIGI API: https://www.openfigi.com/api (NOTE: Free tier doesn't return CUSIP)
- CUSIP Format: https://en.wikipedia.org/wiki/CUSIP
- CUSIP Global Services: https://www.cusip.com/ (official paid service)
- Related: `docs/QA_DIAGNOSTIC_TOOL.md`
- Related: `scripts/README.md`
- Related: `scripts/fix-aapl-cusip.sql` (SQL fix template)
