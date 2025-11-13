# QA Diagnostic Tool - Usage Guide

## Overview

The QA Diagnostic Tool provides comprehensive validation of data ingestion for any ticker. It generates a detailed report showing what data was actually ingested versus what should have been ingested, identifying gaps and providing actionable recommendations.

## Quick Start

After running an ingestion workflow (like `ingestIssuerWorkflow`), validate the results:

```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type qaReportWorkflow \
  --input '{
    "ticker": "AAPL",
    "from": "2024-01-01",
    "to": "2024-03-31"
  }'
```

## Use Cases

### 1. Validate Ingestion After Running a Workflow

**Original Command:**
```bash
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

**QA Validation:**
```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type qaReportWorkflow \
  --input '{
    "ticker": "AAPL",
    "from": "2024-01-01",
    "to": "2024-03-31",
    "minPct": 5
  }'
```

### 2. Export Report as JSON

For detailed analysis or sharing:

```bash
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type qaReportExportWorkflow \
  --input '{
    "ticker": "AAPL",
    "from": "2024-01-01",
    "to": "2024-03-31"
  }' \
  > qa-report-aapl-2024q1.json
```

## Report Structure

The QA report includes the following sections:

### 1. Entity & Reference Data
```json
{
  "entity": {
    "exists": true,
    "entityId": "uuid",
    "cik": "0000320193",
    "name": "Apple Inc.",
    "kind": "issuer",
    "createdAt": "2024-11-13T..."
  }
}
```

### 2. CUSIP Validation
```json
{
  "cusips": {
    "fromDatabase": ["037833100"],
    "fromSecApi": ["037833100"],
    "missing": [],
    "usingTickerFallback": false
  }
}
```

**Issue Detection:**
- If `usingTickerFallback: true` → Real CUSIP not found, using ticker symbol as fallback
- If `missing` array has items → CUSIPs from SEC API not synced to database

### 3. 13F Holdings Data
```json
{
  "holdings13F": {
    "totalFilings": 234,
    "totalPositions": 456,
    "dateRange": {
      "earliest": "2024-01-15",
      "latest": "2024-03-29"
    },
    "topHolders": [
      {
        "holder": "Vanguard Group Inc",
        "shares": 123456789,
        "date": "2024-03-29"
      }
    ]
  }
}
```

### 4. ETF Holdings Data
```json
{
  "etfHoldings": {
    "totalPositions": 42,
    "dateRange": {
      "earliest": "2024-01-02",
      "latest": "2024-03-30"
    },
    "byFund": [
      {
        "fund": "IWB",
        "positions": 12,
        "latestDate": "2024-03-30"
      }
    ]
  }
}
```

### 5. Short Interest Data
```json
{
  "shortInterest": {
    "totalRecords": 12,
    "dateRange": {
      "earliest": "2024-01-15",
      "latest": "2024-03-15"
    },
    "latestData": [
      {
        "date": "2024-03-15",
        "shortVolume": 1234567,
        "totalVolume": 12345678
      }
    ]
  }
}
```

### 6. SEC Filings
```json
{
  "filings": {
    "total": 45,
    "byForm": {
      "10-Q": 1,
      "10-K": 1,
      "8-K": 12,
      "SC 13G": 31
    },
    "dateRange": {
      "earliest": "2024-01-05",
      "latest": "2024-03-28"
    }
  }
}
```

### 7. Issues & Recommendations
```json
{
  "issues": [
    "No real CUSIP found - using ticker symbol as fallback",
    "No ETF holdings found (no CUSIPs to search)"
  ],
  "recommendations": [
    "Verify SEC submissions API response contains 'tickers' field with CUSIP data",
    "Fix CUSIP resolution first, then run fetchDailyHoldings"
  ]
}
```

## Common Issues & Solutions

### Issue: "Found 0 securities for AAPL"

**Symptom:** No CUSIPs found, using ticker fallback

**Diagnosis:**
```bash
# Run QA report
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type qaReportWorkflow \
  --input '{"ticker": "AAPL", "from": "2024-01-01", "to": "2024-03-31"}'

# Check report output:
# "usingTickerFallback": true
# "fromSecApi": [] or has CUSIPs
# "fromDatabase": ["AAPL"] (ticker symbol instead of CUSIP)
```

**Root Cause:** SEC submissions API response structure changed or doesn't contain `tickers` field with CUSIP data

**Solution:**
1. Check SEC API response manually:
   ```bash
   curl "https://data.sec.gov/submissions/CIK0000320193.json" \
     -H "User-Agent: institutional-rotation-detector/1.0"
   ```
2. Look for `tickers` array with `cusip` field
3. If missing, update `resolveCIK` activity to extract CUSIPs from alternate sources

### Issue: "No ETF holdings matched target CUSIPs"

**Symptom:** ETF queries return no results despite having CUSIPs

**Diagnosis:**
```bash
# Run QA report and check:
# etfHoldings.totalPositions === 0
# cusips.fromDatabase.length > 0
```

**Root Cause:** CUSIPs in database don't match ETF holdings data, or ETFs don't hold this ticker

**Solution:**
1. Verify CUSIP format (9 characters, alphanumeric)
2. Check if ETFs actually hold this ticker
3. Run `fetchDailyHoldings` activity manually to refresh ETF data

### Issue: "No FINRA short interest data found"

**Symptom:** No short interest records for date range

**Diagnosis:**
```bash
# Check QA report:
# shortInterest.totalRecords === 0
```

**Possible Causes:**
1. FINRA data not available for this ticker/date range
2. CUSIP mismatch (FINRA uses CUSIP for lookups)
3. Short interest ingestion not run for this period

**Solution:**
1. Verify ticker has short interest reporting (not all do)
2. Check CUSIP is correct
3. Run `fetchShortInterest` activity for this date range

## Integration with CI/CD

You can use the QA tool in automated testing:

```bash
#!/bin/bash

# Run ingestion
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type ingestIssuerWorkflow \
  --input '{"ticker": "AAPL", "from": "2024-01-01", "to": "2024-03-31", "runKind": "daily", "minPct": 5}'

# Wait for completion (add proper wait logic)
sleep 60

# Run QA validation
REPORT=$(temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type qaReportExportWorkflow \
  --input '{"ticker": "AAPL", "from": "2024-01-01", "to": "2024-03-31"}')

# Check for issues
ISSUE_COUNT=$(echo "$REPORT" | jq '.issues | length')

if [ "$ISSUE_COUNT" -gt 0 ]; then
  echo "QA validation found $ISSUE_COUNT issues:"
  echo "$REPORT" | jq '.issues'
  echo ""
  echo "Recommendations:"
  echo "$REPORT" | jq '.recommendations'
  exit 1
fi

echo "QA validation passed!"
```

## Direct Database Query Alternative

If you prefer SQL queries over workflows:

```sql
-- Check entity and CUSIP for ticker
SELECT
  e.entity_id,
  e.cik,
  e.ticker,
  e.name,
  array_agg(DISTINCT cim.cusip) as cusips
FROM entities e
LEFT JOIN cusip_issuer_map cim ON cim.issuer_cik = e.cik
WHERE e.ticker = 'AAPL'
GROUP BY e.entity_id, e.cik, e.ticker, e.name;

-- Check 13F holdings count
SELECT
  COUNT(*) as total_positions,
  COUNT(DISTINCT holder_id) as unique_holders,
  MIN(asof) as earliest_date,
  MAX(asof) as latest_date
FROM uhf_positions
WHERE cusip IN (
  SELECT cusip
  FROM cusip_issuer_map
  WHERE issuer_cik = '0000320193'
)
AND source = '13F'
AND asof BETWEEN '2024-01-01' AND '2024-03-31';

-- Check ETF holdings count
SELECT
  e.ticker as etf_ticker,
  COUNT(*) as positions,
  MAX(uhf.asof) as latest_date
FROM uhf_positions uhf
JOIN entities e ON e.entity_id = uhf.holder_id
WHERE uhf.cusip IN (
  SELECT cusip
  FROM cusip_issuer_map
  WHERE issuer_cik = '0000320193'
)
AND uhf.source = 'ETF'
AND uhf.asof BETWEEN '2024-01-01' AND '2024-03-31'
GROUP BY e.ticker
ORDER BY positions DESC;

-- Check short interest
SELECT
  date,
  short_volume,
  total_volume,
  ROUND(short_volume::numeric / NULLIF(total_volume, 0) * 100, 2) as short_pct
FROM finra_short_interest
WHERE cusip IN (
  SELECT cusip
  FROM cusip_issuer_map
  WHERE issuer_cik = '0000320193'
)
AND date BETWEEN '2024-01-01' AND '2024-03-31'
ORDER BY date DESC
LIMIT 10;

-- Check filings
SELECT
  form,
  COUNT(*) as count
FROM filings
WHERE cik = '0000320193'
AND filed_date BETWEEN '2024-01-01' AND '2024-03-31'
GROUP BY form
ORDER BY count DESC;
```

## Analyzing the AAPL Example

Based on your original logs, here's what the QA report would show:

**Expected Issues:**
1. ✅ Entity created: "Apple Inc." (CIK 0000320193)
2. ⚠️ "Found 0 securities" → Real CUSIP not extracted
3. ⚠️ "No CUSIPs found, falling back to ticker symbols" → Using "AAPL" as CUSIP
4. ⚠️ ETF holdings queries failed → Because CUSIP is "AAPL" not "037833100"
5. ⚠️ Short interest query failed → Same CUSIP mismatch

**QA Report Output:**
```json
{
  "ticker": "AAPL",
  "cik": "0000320193",
  "entity": {
    "exists": true,
    "name": "Apple Inc."
  },
  "cusips": {
    "fromDatabase": ["AAPL"],
    "fromSecApi": ["037833100"],
    "missing": ["037833100"],
    "usingTickerFallback": true
  },
  "holdings13F": { "totalPositions": 0 },
  "etfHoldings": { "totalPositions": 0 },
  "shortInterest": { "totalRecords": 0 },
  "issues": [
    "No real CUSIP found - using ticker symbol as fallback",
    "1 CUSIPs from SEC API not in database: 037833100",
    "No 13F holdings found for date range 2024-01-01 to 2024-03-31",
    "No ETF holdings found (no CUSIPs to search)",
    "No FINRA short interest data found for date range"
  ],
  "recommendations": [
    "Verify SEC submissions API response contains 'tickers' field with CUSIP data",
    "Run upsertCusipMapping to sync missing CUSIPs",
    "Verify 13F filings were ingested for this period",
    "Fix CUSIP resolution first, then run fetchDailyHoldings",
    "Verify FINRA data availability for this ticker and date range"
  ]
}
```

## Next Steps

After identifying issues with the QA tool:

1. **Fix CUSIP Resolution** - Update `resolveCIK` activity
2. **Sync Missing Data** - Run `upsertCusipMapping` manually
3. **Re-run Ingestion** - Execute workflows again
4. **Validate Again** - Run QA report to confirm fixes

## Support

For questions or issues with the QA diagnostic tool, check:
- Source: `apps/temporal-worker/src/activities/qa.activities.ts`
- Workflows: `apps/temporal-worker/src/workflows/qaReport.workflow.ts`
- Documentation: This file
