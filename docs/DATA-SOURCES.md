# Data Sources

This document describes all data sources used by the Institutional Rotation Detector, including the new microstructure data sources.

## Core Data Sources

### SEC EDGAR

**Provider:** U.S. Securities and Exchange Commission
**Cadence:** Real-time filings, polled every 5 minutes
**Forms:** 13F-HR, SC 13G, SC 13D, N-PORT
**URL:** https://www.sec.gov/edgar

SEC EDGAR provides institutional holdings data through mandatory regulatory filings. The system ingests:

- **13F-HR:** Quarterly institutional investment manager holdings (>$100M AUM)
- **SC 13G:** Beneficial ownership disclosures (>5% ownership, passive)
- **SC 13D:** Beneficial ownership disclosures (>5% ownership, active)
- **N-PORT:** Monthly mutual fund holdings

**Rate Limit:** 10 requests/second (SEC policy)
**User Agent Required:** Yes (configured in `SEC_USER_AGENT`)

---

## Microstructure Data Sources

### FINRA OTC Transparency

**Provider:** Financial Industry Regulatory Authority
**Cadence:** Weekly (published ~5 business days after week end)
**Data Type:** Off-exchange volume (ATS + non-ATS dealer trades)
**URL:** https://otctransparency.finra.org/otctransparency/

FINRA OTC Transparency provides weekly venue-level off-exchange trading data for all NMS and OTC equity securities. This is the official source for determining off-exchange trading percentages.

**Datasets:**
- **ATS Weekly:** Alternative Trading System volumes by venue (MPID)
- **Non-ATS Weekly:** Off-exchange dealer volumes (may have masked venues for de minimis)

**Product Tiers:**
- NMS Tier 1: Most liquid NMS stocks
- NMS Tier 2: Less liquid NMS stocks
- OTCE: Over-the-counter equity securities

**Key Fields:**
- `symbol`: Stock ticker
- `week_end`: Week ending date (typically Friday)
- `venue_id`: ATS MPID or reporting member
- `total_shares`: Total shares traded
- `total_trades`: Total number of trades
- `product`: NMS Tier1/Tier2/OTCE

**References:**
- Program Overview: https://www.finra.org/filing-reporting/otc-transparency
- ATS Data: https://www.finra.org/filing-reporting/otc-transparency/ats
- Non-ATS Data: https://www.finra.org/filing-reporting/otc-transparency/non-ats

**Provenance:** All records include `finra_file_id` and `finra_sha256` for audit trail.

---

### IEX Exchange HIST

**Provider:** IEX Exchange
**Cadence:** Daily (T+1 availability)
**Data Type:** Matched volume (on-exchange only)
**URL:** https://www.iexexchange.io/market-data/connectivity/historical-data

IEX HIST provides free daily matched volume data for all securities traded on IEX. This is used as an on-exchange volume proxy for computing daily off-exchange approximations.

**Availability:** T+1 (data for trading day T is available on day T+1)
**Coverage:** All symbols traded on IEX
**Format:** PCAP or CSV (depending on distribution method)

**Limitations:**
- IEX matched volume is only a portion of total on-exchange volume
- Not consolidated tape data
- Used as a proxy for daily apportionment of weekly FINRA off-exchange totals

**Quality Flags:**
When IEX data is used to compute off-exchange ratios, records are marked with `quality_flag='iex_proxy'` to indicate this is NOT consolidated volume.

**References:**
- Historical Data: https://www.iexexchange.io/market-data/connectivity/historical-data
- Market Data Policies: https://www.iexexchange.io/market-data/policies

**Provenance:** All records include `iex_file_id` and `iex_sha256` for audit trail.

---

### FINRA Short Interest

**Provider:** Financial Industry Regulatory Authority
**Cadence:** Semi-monthly (settlement dates: 15th and month-end)
**Data Type:** Short interest positions
**URL:** https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data

FINRA requires members to report short interest positions twice per month. Settlement dates are the 15th of each month and the last day of each month. Publication typically occurs ~2 business days after settlement.

**Settlement Schedule:**
- **Mid-month:** 15th of each month
- **Month-end:** Last day of each month

**Publication Timing:** T+2 business days after settlement

**Key Fields:**
- `symbol`: Stock ticker
- `settlement_date`: Official FINRA settlement date
- `publication_date`: When FINRA published the data
- `short_interest`: Number of shares short
- `avg_daily_volume`: Average daily volume (optional)
- `days_to_cover`: short_interest / avg_daily_volume (optional)

**References:**
- Short Interest Calendar: https://www.finra.org/filing-reporting/regulatory-filing-systems/short-interest
- Data Specifications: https://www.finra.org/filing-reporting/short-interest-reporting-compliance

**Provenance:** All records include `finra_file_id` and `finra_sha256` for audit trail.

---

## Consolidated Volume (Optional)

**Provider:** Licensed SIP feed or third-party vendor
**Cadence:** Daily
**Data Type:** Consolidated tape total volume
**Status:** Optional (not required for off-exchange tracking)

If you have access to licensed consolidated tape data (SIP) or exchange-aggregated daily volumes, you can populate the `micro_consolidated_volume_daily` table to compute official daily off-exchange percentages.

Without consolidated data:
- Weekly off-exchange % can be computed as `offex_shares / (offex_shares + on_ex_proxy)` but requires caution
- Daily off-exchange % is approximated by apportioning weekly FINRA totals across IEX proxy volumes

**Quality Flags:**
- `quality_flag='official'`: FINRA weekly + consolidated weekly totals
- `quality_flag='official_partial'`: FINRA weekly only, missing consolidated
- `quality_flag='approx'`: Daily apportion using consolidated daily
- `quality_flag='iex_proxy'`: Daily apportion using IEX matched shares

---

## Data Quality and Provenance

All microstructure data ingestion includes:

1. **File Provenance:**
   - `*_file_id`: Unique identifier for the source file/dataset
   - `*_sha256`: SHA-256 hash of the downloaded file for verification

2. **Quality Flags:**
   - Clear indication of data completeness and computation method
   - Allows downstream consumers to filter by quality requirements

3. **Idempotent Upserts:**
   - Re-running ingestion for the same date/week will update existing records
   - No duplicate records (enforced by unique constraints)

4. **Temporal Search Attributes:**
   - All workflow runs tagged with dataset, date range, and provenance
   - Full audit trail in Temporal UI

---

## Rate Limits and Compliance

| Source | Rate Limit | Compliance Notes |
|--------|------------|------------------|
| SEC EDGAR | 10 req/sec | Must include User-Agent with contact info |
| FINRA API | Varies by endpoint | API key required |
| IEX HIST | No published limit | Free tier, check terms of service |

**Configuration:** Set `MAX_RPS_EXTERNAL=6` in `.env` to stay well under limits across all sources.

---

## References

- [FINRA OTC Transparency Program](https://www.finra.org/filing-reporting/otc-transparency)
- [FINRA Short Interest Reporting](https://www.finra.org/filing-reporting/short-interest-reporting-compliance)
- [IEX Historical Data](https://www.iexexchange.io/market-data/connectivity/historical-data)
- [SEC EDGAR](https://www.sec.gov/edgar)
