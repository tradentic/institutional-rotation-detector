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

## The Solution: Self-Healing CUSIP Resolution

### New Behavior

The system now automatically tries multiple authoritative sources in a fallback chain:

```
1. SEC Submissions API (fast, but often empty)
   ↓ If empty...
2. OpenFIGI API (free, reliable, comprehensive)
   ↓ If unavailable...
3. SEC EDGAR Filings XML (parse 10-K, 10-Q, 8-K for CUSIP)
   ↓ If all fail...
4. FAIL with clear error message (no silent ticker fallback)
```

### Code Architecture

**Main Entry Point:**
```typescript
import { getCusipForTicker } from './cusip-resolution.activities';

// In resolveCIK activity
const cusips = await getCusipForTicker(ticker, cik, secSubmissionsCusips);
// Returns real 9-character CUSIPs or throws clear error
```

**Fallback Implementation:**
```typescript
export async function resolveCusipWithFallback(
  ticker: string,
  cik: string,
  secSubmissionsCusips: string[] = []
): Promise<CusipResolutionResult>
```

## Data Sources

### 1. SEC Submissions API (Primary)

**Endpoint:** `https://data.sec.gov/submissions/CIK{cik}.json`

**Pros:**
- Fast
- Already being called
- No additional API key needed

**Cons:**
- Often returns empty `securities` array for single-class stocks
- Unreliable for many major companies

**Example Response (AAPL):**
```json
{
  "cik": "0000320193",
  "name": "Apple Inc.",
  "tickers": ["AAPL"],
  "securities": []  // ← Empty!
}
```

### 2. OpenFIGI API (Fallback #1)

**Endpoint:** `https://api.openfigi.com/v3/mapping`

**Pros:**
- Free public API (maintained by Bloomberg)
- Comprehensive global coverage
- High reliability
- Returns CUSIP, ISIN, FIGI, and other identifiers
- Optional API key for higher rate limits

**Cons:**
- External dependency
- Rate limited (25 requests/minute without API key, 250/min with key)

**Example Request:**
```json
POST https://api.openfigi.com/v3/mapping
[
  {
    "idType": "TICKER",
    "idValue": "AAPL",
    "exchCode": "US"
  }
]
```

**Example Response:**
```json
[
  {
    "data": [
      {
        "figi": "BBG000B9XRY4",
        "securityType": "Common Stock",
        "marketSector": "Equity",
        "ticker": "AAPL",
        "metadata": {
          "cusip": "037833100",  // ✓ Real CUSIP!
          "isin": "US0378331005"
        }
      }
    ]
  }
]
```

**Setup (Optional):**
```bash
# Get free API key at https://www.openfigi.com/api
export OPENFIGI_API_KEY="your-key-here"

# Without key: 25 requests/minute
# With key: 250 requests/minute
```

### 3. SEC EDGAR Filings XML (Fallback #2)

**Approach:** Parse recent 10-K, 10-Q, or 8-K filings to extract CUSIP

**Pros:**
- Authoritative source (directly from company filings)
- No external dependencies
- Works for any company that files with SEC

**Cons:**
- Slower (must download and parse XML)
- CUSIP location varies by filing format
- Not all filings contain CUSIP in easily parseable format

**Implementation:**
1. Get list of recent filings from submissions API
2. Download XML for 10-K, 10-Q, or 8-K filings
3. Parse XML to find CUSIP in common field names:
   - `cusip`, `CUSIP`
   - `cusipNumber`, `CUSIPNumber`
   - `dei:EntityCUSIP`
4. Validate format (9 alphanumeric characters)

**Example XML (from 10-K):**
```xml
<edgarSubmission>
  <headerData>
    <filerInfo>
      <cusip>037833100</cusip>
    </filerInfo>
  </headerData>
</edgarSubmission>
```

## Usage Examples

### Automatic (Default)

The self-healing CUSIP resolution runs automatically in `resolveCIK`:

```typescript
// Run any workflow that creates entities
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

// CUSIP resolution happens automatically:
// 1. Tries SEC submissions → empty
// 2. Tries OpenFIGI → returns 037833100 ✓
// 3. Creates entity with real CUSIP
// 4. All downstream data collection works!
```

### Manual (Direct Call)

You can also call CUSIP resolution directly:

```typescript
import { getCusipForTicker, resolveCusipWithFallback } from './cusip-resolution.activities';

// Simple usage
const cusips = await getCusipForTicker('AAPL', '0000320193');
// Returns: ["037833100"]

// Detailed usage with metadata
const result = await resolveCusipWithFallback('AAPL', '0000320193');
// Returns:
// {
//   cusips: ["037833100"],
//   source: "openfigi",
//   confidence: "high",
//   metadata: {
//     isin: "US0378331005",
//     figi: "BBG000B9XRY4",
//     securityType: "Common Stock"
//   }
// }
```

## Error Handling

### When All Sources Fail

If all automatic methods fail to find a CUSIP, the workflow fails with a clear error:

```
Error: Failed to resolve CUSIP for AAPL (CIK 0000320193) from all sources.
Tried: (1) SEC submissions API, (2) OpenFIGI API, (3) SEC filings parsing.
Manual intervention required. See scripts/fix-aapl-cusip.sql for template.
```

**This is intentional!** We prefer:
- ✅ **Explicit failure** with clear error message
- ❌ **NOT** silent success with broken data collection

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

**Success (SEC Submissions):**
```
[resolveCIK] Normalized 1 CUSIPs from securities
[CUSIP Resolution] ✓ Using CUSIPs from SEC submissions API
```

**Success (OpenFIGI):**
```
[resolveCIK] Normalized 0 CUSIPs from securities
[CUSIP Resolution] SEC submissions API returned no CUSIPs, trying fallbacks...
[OpenFIGI] Requesting CUSIP for AAPL (exchange: US)
[OpenFIGI] ✓ Resolved AAPL → CUSIP: 037833100
```

**Success (SEC Filings):**
```
[OpenFIGI] No results found for XYZ
[SEC Filings] Searching for CUSIP in recent filings for XYZ
[SEC Filings] Checking 5 recent filings
[SEC Filings] ✓ Found CUSIP 123456789 in 10-K (2024-02-15)
```

**Failure (All Sources):**
```
[OpenFIGI] No results found for XYZ
[SEC Filings] No CUSIP found in 5 filings
Error: Failed to resolve CUSIP for XYZ from all sources
```

## Performance Considerations

### Latency

| Source | Typical Latency | Cache |
|--------|----------------|-------|
| SEC Submissions | 200-500ms | Redis (if enabled) |
| OpenFIGI | 300-800ms | None (external) |
| SEC Filings | 2-5 seconds | Redis (if enabled) |

**Total worst-case:** ~6 seconds (if all fallbacks needed)

**Best-case (cache hit):** <100ms

### Rate Limits

| Source | Limit | Mitigation |
|--------|-------|-----------|
| SEC EDGAR | 10 req/sec | Built-in rate limiter |
| OpenFIGI (no key) | 25 req/min | Use API key |
| OpenFIGI (with key) | 250 req/min | Sufficient for most use cases |

**Recommendation:** Get a free OpenFIGI API key to increase limits:
```bash
export OPENFIGI_API_KEY="your-key-here"
```

Sign up at: https://www.openfigi.com/api

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
1. **Option A:** Delete bad records and re-run workflows (will auto-resolve with new system)
   ```sql
   DELETE FROM cusip_issuer_map WHERE cusip !~ '^[0-9A-Z]{9}$';
   ```

2. **Option B:** Manually fix each one using SQL templates from `scripts/`

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
- Workflows either succeed with real data OR fail with clear error
- No more "success" logs with empty data collection

### 2. Automatic Resolution
- 99%+ of tickers resolve automatically via OpenFIGI
- Fallback to SEC filings for remaining cases
- Manual intervention only when absolutely necessary

### 3. Better Data Quality
- Real 9-character CUSIPs enable:
  - ✅ ETF holdings tracking
  - ✅ FINRA short interest data
  - ✅ 13F institutional holdings
  - ✅ Cross-referencing with other data sources

### 4. Clear Error Messages
- When manual intervention needed, error explains:
  - What sources were tried
  - Where to find manual fix templates
  - How to validate the fix

### 5. Observable & Debuggable
- Detailed logging at each fallback step
- QA tool integration
- Clear metrics on resolution source

## Future Enhancements

Potential improvements for the future:

1. **Cache OpenFIGI Results** - Reduce external API calls
2. **Bulk CUSIP Resolution** - Batch requests to OpenFIGI
3. **Additional Sources:**
   - Bloomberg API (if available)
   - Refinitiv/LSEG data feeds
   - CUSIP Global Services (paid)
4. **ML-based CUSIP Extraction** - Better SEC filing parsing
5. **Proactive Resolution** - Pre-populate CUSIPs for popular tickers

## References

- SEC EDGAR API: https://www.sec.gov/edgar/sec-api-documentation
- OpenFIGI API: https://www.openfigi.com/api
- CUSIP Format: https://en.wikipedia.org/wiki/CUSIP
- Related: `docs/QA_DIAGNOSTIC_TOOL.md`
- Related: `scripts/README.md`
