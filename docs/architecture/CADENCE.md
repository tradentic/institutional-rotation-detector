# Data Cadence & Ingestion Schedule

This document describes the ingestion cadence for all data sources in the Institutional Rotation Detector, including microstructure data.

## Overview

The system ingests data at multiple cadences to capture both long-term institutional behavior and short-term microstructure dynamics:

| Data Source | Cadence | Workflow | Availability |
|-------------|---------|----------|--------------|
| SEC 13F-HR | Quarterly | `ingestQuarterWorkflow` | 45 days after quarter end |
| SEC SC 13G/13D | Event-driven | `edgarSubmissionsPollerWorkflow` | Real-time (5min polling) |
| SEC N-PORT | Monthly | `nportMonthlyTimerWorkflow` | ~60 days after month end |
| ETF Holdings | Daily | `etfDailyCronWorkflow` | T+1 |
| **FINRA OTC** | **Weekly** | **`finraOtcWeeklyIngestWorkflow`** | **T+5 business days** |
| **IEX HIST** | **Daily** | **`iexDailyIngestWorkflow`** | **T+1** |
| **FINRA Short Interest** | **Semi-monthly** | **`shortInterestIngestWorkflow`** | **T+2 business days** |

---

## Core Data Cadences

### Quarterly: 13F-HR Institutional Holdings

**Workflow:** `ingestQuarterWorkflow`
**Schedule:** Quarters end on Mar 31, Jun 30, Sep 30, Dec 31
**Filing Deadline:** 45 days after quarter end
**Polling:** Continuous via `edgarSubmissionsPollerWorkflow`

13F-HR filings provide the foundation for rotation detection. Institutional investment managers with >$100M AUM must disclose their equity holdings quarterly.

**Typical Timeline:**
- Q1 (Mar 31): Filings due by May 15
- Q2 (Jun 30): Filings due by Aug 14
- Q3 (Sep 30): Filings due by Nov 14
- Q4 (Dec 31): Filings due by Feb 14

### Event-Driven: 13G/13D Beneficial Ownership

**Workflow:** `edgarSubmissionsPollerWorkflow`
**Schedule:** Continuous polling (5-minute intervals)
**Filing Triggers:**
- SC 13G: Passive >5% ownership (annual update, or within 45 days of crossing 5%)
- SC 13D: Active >5% ownership (within 10 days of crossing 5%)

### Monthly: N-PORT Mutual Fund Holdings

**Workflow:** `nportMonthlyTimerWorkflow`
**Schedule:** Monthly (12-hour polling intervals)
**Filing Deadline:** 60 days after month end

### Daily: ETF Holdings

**Workflow:** `etfDailyCronWorkflow`
**Schedule:** Daily (24-hour intervals)
**Coverage:** IWB, IWM, IWN, IWC (configurable)
**Availability:** T+1

---

## Microstructure Data Cadences

### Weekly: FINRA OTC Transparency

**Workflow:** `finraOtcWeeklyIngestWorkflow`
**Schedule:** Weekly (weeks end on Friday)
**Publication:** ~5 business days after week end
**Data Types:** ATS volumes + non-ATS dealer volumes

**Example Timeline:**
- Week ending Friday, Nov 3
- Data published ~Wednesday, Nov 8
- Ingestion run on Nov 9 (or backfill later)

**Datasets Ingested:**
1. **ATS Weekly:** Alternative Trading System volumes by venue
2. **Non-ATS Weekly:** Off-exchange dealer volumes

**Processing Steps:**
1. Fetch ATS venue-level data
2. Fetch non-ATS venue-level data
3. Aggregate to symbol-level weekly totals
4. Compute weekly official off-exchange %

**Backfill Mode:**
```bash
# Backfill 4 weeks of FINRA OTC data for GME
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type finraOtcWeeklyIngestWorkflow \
  --workflow-id finra-otc-backfill-GME \
  --input '{"symbols":["GME"],"fromWeek":"2024-10-06","toWeek":"2024-11-03","runKind":"backfill"}'
```

**Daily Mode (incremental):**
```bash
# Ingest most recent week for all symbols
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type finraOtcWeeklyIngestWorkflow \
  --workflow-id finra-otc-daily-$(date +%Y%m%d) \
  --input '{"runKind":"daily"}'
```

---

### Daily: IEX HIST Matched Volume

**Workflow:** `iexDailyIngestWorkflow`
**Schedule:** Daily (business days)
**Availability:** T+1
**Data Type:** On-exchange matched volume (IEX only)

**Example Timeline:**
- Trading day: Monday, Nov 6
- IEX HIST file available: Tuesday, Nov 7 morning
- Ingestion run: Tuesday, Nov 7

**Purpose:**
IEX matched volume is used as an on-exchange proxy to compute daily approximations of off-exchange percentage. Weekly FINRA off-exchange totals are distributed across the week proportionally to daily IEX volumes.

**Backfill Mode:**
```bash
# Backfill 30 days of IEX data for GME
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type iexDailyIngestWorkflow \
  --workflow-id iex-backfill-GME \
  --input '{"symbols":["GME"],"from":"2024-10-01","to":"2024-10-31","runKind":"backfill"}'
```

**Daily Mode (T+1):**
```bash
# Ingest yesterday's IEX data
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type iexDailyIngestWorkflow \
  --workflow-id iex-daily-$(date +%Y%m%d) \
  --input '{"runKind":"daily"}'
```

---

### Semi-Monthly: FINRA Short Interest

**Workflow:** `shortInterestIngestWorkflow`
**Schedule:** Twice per month (15th and month-end)
**Publication:** T+2 business days after settlement
**Data Type:** Short interest positions

**Settlement Dates:**
- **Mid-month:** 15th of each month
- **Month-end:** Last day of each month

**Example Timeline:**
- Settlement: October 31 (month-end)
- Publication: ~November 2 (T+2 business days)
- Ingestion: November 3

**Backfill Mode:**
```bash
# Backfill 6 months of short interest for GME
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type shortInterestIngestWorkflow \
  --workflow-id short-int-backfill-GME \
  --input '{"symbols":["GME"],"fromSettlement":"2024-05-15","toSettlement":"2024-10-31","runKind":"backfill"}'
```

**Scheduled Mode:**
```bash
# Ingest most recent settlement
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type shortInterestIngestWorkflow \
  --workflow-id short-int-scheduled-$(date +%Y%m%d) \
  --input '{"runKind":"scheduled"}'
```

---

## Off-Exchange Ratio Computation

**Workflow:** `offexRatioComputeWorkflow`
**Trigger:** After FINRA OTC and IEX ingestion complete
**Frequency:** Weekly + daily approximations

**Computation Steps:**

1. **Weekly Official:**
   - Requires: FINRA OTC weekly totals + consolidated weekly volume (optional)
   - Quality: `official` (with consolidated) or `official_partial` (FINRA only)

2. **Daily Approximation:**
   - Requires: FINRA OTC weekly + IEX daily OR consolidated daily
   - Quality: `approx` (with consolidated daily) or `iex_proxy` (with IEX)

**Recommended Schedule:**
```bash
# Run after both FINRA OTC and IEX ingestion for the week
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type offexRatioComputeWorkflow \
  --workflow-id offex-ratio-compute-$(date +%Y%m%d) \
  --input '{"symbols":["GME","AMC"],"from":"2024-10-06","to":"2024-11-03"}'
```

---

## Flip50 Event Detection

**Workflow:** `flip50DetectWorkflow`
**Trigger:** After off-exchange ratio computation
**Frequency:** Ad-hoc or scheduled (e.g., daily)

**Detection Logic:**
- First day: `offex_pct < 0.50`
- Preceded by: ≥20 consecutive trading days with `offex_pct ≥ 0.50`

**Example:**
```bash
# Detect Flip50 events for GME (last 90 days)
temporal workflow start \
  --namespace ird \
  --task-queue rotation-detector \
  --type flip50DetectWorkflow \
  --workflow-id flip50-detect-GME \
  --input '{"symbol":"GME","lookbackDays":90,"consecutiveDaysThreshold":20}'
```

---

## Recommended Cron Schedule

For a production deployment, consider this cron schedule:

```cron
# FINRA OTC weekly (run Wednesdays to catch last week's data)
0 10 * * 3 /usr/bin/temporal workflow start --namespace ird --type finraOtcWeeklyIngestWorkflow --input '{"runKind":"daily"}'

# IEX HIST daily (run every business day morning for T+1 data)
0 9 * * 1-5 /usr/bin/temporal workflow start --namespace ird --type iexDailyIngestWorkflow --input '{"runKind":"daily"}'

# Off-exchange ratio compute (run after IEX ingestion)
0 12 * * 1-5 /usr/bin/temporal workflow start --namespace ird --type offexRatioComputeWorkflow --input '{"symbols":[],"from":"","to":""}'

# FINRA short interest (run on 3rd and 18th of each month, after publication)
0 10 3,18 * * /usr/bin/temporal workflow start --namespace ird --type shortInterestIngestWorkflow --input '{"runKind":"scheduled"}'

# Flip50 detection (run daily after ratio compute)
0 14 * * 1-5 /usr/bin/temporal workflow start --namespace ird --type flip50DetectWorkflow --input '{"symbol":"GME"}'
```

---

## Data Freshness SLA

| Data Type | Ingestion SLA | Data Freshness |
|-----------|---------------|----------------|
| 13F-HR | Within 1 hour of SEC publication | T+45 days (regulatory) |
| 13G/13D | Within 5 minutes of SEC publication | Real-time |
| FINRA OTC | Within 24 hours of FINRA publication | T+5 business days |
| IEX HIST | Within 1 hour of availability | T+1 |
| Short Interest | Within 24 hours of FINRA publication | T+2 business days |

---

## Backfill Strategy

When adding new symbols or performing historical analysis:

1. **Start with quarterly 13F data** (foundation)
2. **Add FINRA OTC weekly** (microstructure context)
3. **Add IEX HIST daily** (for daily approximations)
4. **Add short interest** (event-study covariate)
5. **Compute off-exchange ratios**
6. **Run Flip50 detection**

**Example Full Backfill:**
```bash
# 1. 13F quarterly data (existing workflows)
# 2. FINRA OTC weekly (last 12 weeks)
temporal workflow start --namespace ird --type finraOtcWeeklyIngestWorkflow \
  --input '{"symbols":["GME"],"fromWeek":"2024-08-01","toWeek":"2024-11-01","runKind":"backfill"}'

# 3. IEX daily (last 90 days)
temporal workflow start --namespace ird --type iexDailyIngestWorkflow \
  --input '{"symbols":["GME"],"from":"2024-08-01","to":"2024-11-01","runKind":"backfill"}'

# 4. Short interest (last 6 months)
temporal workflow start --namespace ird --type shortInterestIngestWorkflow \
  --input '{"symbols":["GME"],"fromSettlement":"2024-05-15","toSettlement":"2024-10-31","runKind":"backfill"}'

# 5. Compute off-exchange ratios
temporal workflow start --namespace ird --type offexRatioComputeWorkflow \
  --input '{"symbols":["GME"],"from":"2024-08-01","to":"2024-11-01"}'

# 6. Detect Flip50 events
temporal workflow start --namespace ird --type flip50DetectWorkflow \
  --input '{"symbol":"GME","lookbackDays":90}'
```

---

## Monitoring and Alerts

**Temporal Search Attributes:**
All microstructure workflows set search attributes for monitoring:
- `Dataset`: FINRA_OTC, IEX_HIST, SHORT_INT, OFFEX_RATIO, FLIP50
- `WeekEnd`, `TradeDate`, `SettlementDate`: Time dimensions
- `RunKind`: backfill, daily, scheduled
- `Provenance`: File IDs for audit trail

**Query Examples:**
```sql
-- Find all FINRA OTC ingestion runs for a specific week
Dataset='FINRA_OTC' AND WeekEnd='2024-11-03'

-- Find failed IEX ingestion runs
Dataset='IEX_HIST' AND ExecutionStatus='Failed'

-- Find all backfill runs
RunKind='backfill'
```

**Note:** All queries must specify `--namespace ird` when using the Temporal CLI.

---

## Rate Limiting Considerations

With multiple daily workflows hitting external APIs, respect rate limits:

- **SEC EDGAR:** 10 req/sec (hard limit)
- **FINRA API:** Varies by endpoint (check API key tier)
- **IEX HIST:** No published limit (but be reasonable)

**Configuration:** `MAX_RPS_EXTERNAL=6` in `.env` provides headroom across all sources.
