# Data Sources

Comprehensive guide to all external data sources, APIs, and integration patterns used by the Institutional Rotation Detector.

## Table of Contents

- [Overview](#overview)
- [Core Data Sources](#core-data-sources)
  - [SEC EDGAR](#sec-edgar)
  - [UnusualWhales API](#unusualwhales-api)
- [Microstructure Data Sources](#microstructure-data-sources)
  - [FINRA OTC Transparency](#finra-otc-transparency)
  - [IEX Exchange HIST](#iex-exchange-hist)
  - [FINRA Short Interest](#finra-short-interest)
- [Supporting Data Sources](#supporting-data-sources)
  - [ETF Holdings](#etf-holdings)
  - [OpenAI](#openai)
- [Rate Limiting](#rate-limiting)
- [Data Quality](#data-quality)
- [Compliance](#compliance)

## Overview

The Institutional Rotation Detector integrates data from multiple external sources:

| Source | Data Type | Frequency | Latency | Cost |
|--------|-----------|-----------|---------|------|
| SEC EDGAR | 13F, N-PORT, 13G/D, Form 4 | Quarterly/Monthly/Event | 45 days (13F), 2 days (Form 4) | Free |
| UnusualWhales | Options flow, unusual activity | Daily | T+1 | Paid (subscription) |
| FINRA OTC | Off-exchange volume | Weekly | 5 business days | Free |
| IEX HIST | On-exchange volume proxy | Daily | T+1 | Free |
| FINRA Short Interest | Short positions | Bi-weekly | 2 business days | Free |
| ETF Providers | Daily holdings | Daily | T+1 | Free |
| OpenAI | Text generation, embeddings | On-demand | Real-time | Paid (usage) |

---

## Core Data Sources

### SEC EDGAR

#### Overview

**EDGAR** (Electronic Data Gathering, Analysis, and Retrieval) is the SEC's public filing system.

**Base URL:** `https://www.sec.gov/`

**Documentation:** https://www.sec.gov/edgar/searchedgar/accessing-edgar-data.htm

#### Rate Limits

**Official Limits:**
- 10 requests per second per IP
- Must include User-Agent header with contact info

**Enforcement:**
- 429 (Too Many Requests) if exceeded
- Temporary IP blocking for repeat violations

**Compliance:**
```typescript
const SEC_USER_AGENT = 'YourCompany contact@yourcompany.com';

const response = await fetch(url, {
  headers: {
    'User-Agent': SEC_USER_AGENT,
  },
});

if (response.status === 429) {
  // Back off and retry
  await sleep(60000);  // Wait 1 minute
  return fetchWithRetry(url);
}
```

#### Filing Types

##### 13F-HR (Institutional Holdings)

**Purpose:** Quarterly holdings report for investment managers with >$100M AUM.

**Filing Deadline:** 45 days after quarter end.

**Format:** XML with custom schema.

**Data Extracted:**
- Issuer name and CUSIP
- Shares held (equity)
- Put/call option shares (underlying)
- Investment discretion
- Voting authority

**Example URL:**
```
https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001000097&type=13F-HR&dateb=&owner=exclude&count=100
```

##### Form 4 (Insider Transactions) 🆕

**Purpose:** Insider transaction reporting (officers, directors, 10% owners).

**Filing Deadline:** 2 business days after transaction.

**Format:** XML with OwnershipDocument schema.

**Data Extracted:**
- Transaction date and type (P=Purchase, S=Sale)
- Number of shares and price
- Insider name, CIK, and title
- Direct/indirect ownership
- Derivative securities (options, warrants)
- Rule 10b5-1 plan indicator

**Use Cases:**
- Validate institutional rotation signals
- Detect insider buying during/after dumps
- Identify potential accumulation signals
- Track executive confidence

**Reporting Timeline:**
- Transaction occurs: Day 0
- Form 4 filed: Day 0-2 (within 2 business days)
- Ingestion lag: Much faster than 13F (45 days)

**Implementation:** See `apps/temporal-worker/src/activities/form4.activities.ts`

**Database Schema:** `supabase/migrations/013_insider_transactions.sql`

**References:**
- Form 4 Overview: https://www.sec.gov/files/forms-3-4-5.pdf
- XML Schema: https://www.sec.gov/info/edgar/forms/edgarxml.html

---

##### N-PORT-P (Monthly Fund Holdings)

**Purpose:** Monthly portfolio holdings for registered investment companies (mutual funds, ETFs).

**Filing Deadline:** 30 days after month end.

**Format:** XML (structured) or JSON (newer).

##### 13G / 13D (Beneficial Ownership)

**Purpose:** Disclosure of >5% ownership in public companies.

**Types:**
- **13G:** Passive investors (within 45 days of crossing 5%)
- **13D:** Active investors (within 10 days)

---

### UnusualWhales API

#### Overview

**UnusualWhales** provides real-time options flow data, unusual activity detection, and options analytics.

**Base URL:** `https://api.unusualwhales.com`

**Documentation:** https://api.unusualwhales.com/docs

**Cadence:** Daily (EOD) for most endpoints, real-time for flow alerts

#### Rate Limits

**Default:** 10 requests per second

**Configuration:** Set `MAX_RPS_UNUSUALWHALES=10` in `.env`

**Handling:** Automatic rate limiting via `RateLimiter` class

#### Key Endpoints

##### Tier 1: Core Daily Data (Must-Have)

**1. `/api/stock/{ticker}/option-contracts`** ⭐ **PRIMARY ENDPOINT**

Returns: Volume + Open Interest + Implied Volatility for all contracts

**Use Cases:**
- Calculate Put/Call ratios (volume and OI)
- Detect unusual activity (volume/OI > 3x)
- Measure IV skew (put IV - call IV)
- Track strike-level positioning

**2. `/api/stock/{ticker}/flow-per-expiry`**

Returns: Aggregated options flow by expiration date

**Use Cases:**
- Daily flow summary by expiration
- Ask/bid side breakdown (directional flow)
- OTM volume (speculative activity)

**3. `/api/option-trades/flow-alerts`** ⭐ **PRE-FILTERED**

Returns: Unusual options activity alerts

**Alert Rules:**
- `RepeatedHits` - Persistent positioning
- `FloorTradeLargeCap` - Large institutional trades
- `SweepsFollowedByFloor` - Aggressive buying patterns

**Use Cases:**
- Detect institutional positioning changes
- Identify sweep orders (aggressive buying)
- Flag floor trades (large block trades)

##### Tier 2: Enhanced Data (Important)

**4. `/api/stock/{ticker}/greeks`**

Returns: Delta, gamma, theta, vega, IV for all strikes in ONE expiration

**Note:** Must query per expiration (expensive)

**5. `/api/stock/{ticker}/greek-exposure`**

Returns: Historical Greek exposure (GEX) trends

**Use Cases:**
- Track GEX over time (30+ days)
- Detect gamma flips (positive to negative)
- Measure net delta exposure

##### Tier 3: Supporting Data (Optional)

**6. `/api/stock/{ticker}/option-chains`**

Returns: List of all valid option symbols for contract discovery

**7. `/api/stock/{ticker}/greek-exposure/expiry`**

Returns: GEX broken down by expiration

#### Calculated Metrics

From raw API data, the system derives institutional rotation signals:

**Volume Metrics:**
```python
put_call_ratio_volume = put_volume / call_volume
put_call_ratio_premium = put_premium / call_premium
volume_oi_ratio = volume / open_interest  # >3.0 = unusual
otm_ratio = otm_volume / total_volume      # Speculative activity
```

**Flow Direction:**
```python
net_call_flow = call_volume_ask_side - call_volume_bid_side
net_put_flow = put_volume_ask_side - put_volume_bid_side
directional_bias = (net_call_flow - net_put_flow) / total_volume
```

**Greeks:**
```python
iv_skew = put_volatility - call_volatility  # Positive = fear
net_delta = call_delta + put_delta
net_gamma = call_gamma + put_gamma
gamma_flip = (net_gamma > 0)  # True = volatility suppression
```

#### Implementation

**Client:** `apps/temporal-worker/src/lib/unusualWhalesClient.ts`

**Activities:** `apps/temporal-worker/src/activities/options.activities.ts`

**Workflows:** `apps/temporal-worker/src/workflows/optionsIngest.workflow.ts`

**Database Schema:** `supabase/migrations/014_options_flow.sql`

#### Documentation

- **[UnusualWhales API Analysis](unusualwhales-api-analysis.md)** - Comprehensive endpoint analysis
- **[Endpoint Groups & Scoring](unusualwhales-endpoint-groups-scoring.md)** - Prioritization framework

#### Minimal Daily Workflow

**Meets all 4 requirements with just 3 API calls:**

```typescript
// 1. Get volume + OI + IV for all contracts (1 call)
await fetchOptionContracts({ ticker: 'AAPL' });

// 2. Get aggregated flow by expiration (1 call)
await fetchOptionsFlowByExpiry({ ticker: 'AAPL' });

// 3. Get unusual activity alerts (1 call)
await fetchFlowAlerts({ ticker: 'AAPL', minPremium: 50000 });

// Total: 3 API calls
```

**Result:** Complete daily options profile with:
- ✅ Volume by strike/expiry
- ✅ Open Interest by strike/expiry
- ✅ Put/Call ratios (volume and OI)
- ✅ Unusual activity detection
- ✅ IV skew calculation

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

## Supporting Data Sources

### ETF Holdings

#### Overview

ETF providers publish daily holdings for transparency.

**Common Providers:**
- BlackRock (iShares)
- Vanguard
- State Street (SPDR)
- Invesco

**Update Frequency:** Daily (T+1)

**Format:** CSV or JSON

#### BlackRock (iShares)

**Example URL:**
```
https://www.ishares.com/us/products/{fund_id}/ishares-core-s-p-500-etf/1467271812596.ajax?fileType=csv&fileName=IVV_holdings&dataType=fund
```

**CSV Format:**
```csv
Ticker,Name,Sector,Asset Class,Weight,Notional Value,Shares,CUSIP,ISIN,Sedol,Price,Location,Exchange,Currency,Market Value
AAPL,Apple Inc,Information Technology,Equity,7.23,28500000000,155000000,037833100,US0378331005,2046251,184.00,United States,NASDAQ,USD,28520000000
```

---

### OpenAI

#### Overview

**OpenAI API** is used for:
- Text embeddings (vector search)
- Text generation (explanations, summaries)
- Long-context synthesis

**Base URL:** `https://api.openai.com/v1/`

**Documentation:** https://platform.openai.com/docs/api-reference

#### Models Used

| Model | Purpose | Context Window | Cost (per 1M tokens) |
|-------|---------|----------------|----------------------|
| `text-embedding-3-small` | Embeddings (1536 dim) | 8K | $0.02 |
| `gpt-4-turbo-preview` | Analysis, synthesis | 128K | $10 (input) + $30 (output) |
| `gpt-4o-mini` | Simple tasks | 128K | $0.15 (input) + $0.60 (output) |

#### Embeddings

**Purpose:** Convert text to vectors for semantic search.

**Usage:**
```typescript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });

  return response.data[0].embedding;
}
```

---

## Rate Limiting

### Implementation

**Generic Rate Limiter:**

```typescript
export class RateLimiter {
  private queue: number[] = [];

  constructor(private maxPerSecond: number) {}

  async acquire(): Promise<void> {
    const now = Date.now();
    const oneSecondAgo = now - 1000;

    // Remove old timestamps
    this.queue = this.queue.filter(ts => ts > oneSecondAgo);

    if (this.queue.length >= this.maxPerSecond) {
      // Wait until oldest timestamp is >1s old
      const oldestTimestamp = this.queue[0];
      const delay = 1000 - (now - oldestTimestamp);
      await new Promise(resolve => setTimeout(resolve, delay));
      return this.acquire(); // Retry
    }

    this.queue.push(now);
  }
}
```

**Usage:**
```typescript
const secLimiter = new RateLimiter(10); // 10 req/sec

for (const filing of filings) {
  await secLimiter.acquire();
  await fetchFiling(filing.accession);
}
```

---

## Data Quality and Provenance

All microstructure and options data ingestion includes:

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
| UnusualWhales | 10 req/sec | API key required (subscription) |
| FINRA API | Varies by endpoint | API key required (if available) |
| IEX HIST | No published limit | Free tier, check terms of service |
| OpenAI | Tier-dependent | 3-10,000 RPM depending on subscription |

**Configuration:** Set `MAX_RPS_EXTERNAL=6` in `.env` to stay well under limits across all sources.

---

## Compliance

### SEC Fair Access

**Requirements:**
- Proper User-Agent header
- Respect rate limits (10 req/sec)
- No automated mass downloads
- Use bulk data sets for large downloads

**Bulk Data:**
```
https://www.sec.gov/dera/data/financial-statement-and-notes-data-sets.html
```

### FINRA Terms

**Restrictions:**
- Personal use only (non-commercial)
- No redistribution
- No automated scraping (for public portal)

**Alternative:** Use licensed data providers or official APIs where available.

### UnusualWhales Terms

**Usage:**
- Subscription required
- Commercial use permitted per license tier
- API key authentication
- Respect rate limits

### OpenAI Terms

**Usage Policies:**
- https://openai.com/policies/usage-policies
- No illegal or harmful use
- Respect rate limits
- Attribute AI-generated content

### Data Privacy

**No PII Collection:**
- All data is public (SEC filings)
- No personal information stored
- Institutional data only

**GDPR Compliance:**
- Data is public and exempt
- No right to erasure for public records

---

## References

- [SEC EDGAR](https://www.sec.gov/edgar)
- [UnusualWhales API Documentation](https://api.unusualwhales.com/docs)
- [FINRA OTC Transparency Program](https://www.finra.org/filing-reporting/otc-transparency)
- [FINRA Short Interest Reporting](https://www.finra.org/filing-reporting/short-interest-reporting-compliance)
- [IEX Historical Data](https://www.iexexchange.io/market-data/connectivity/historical-data)
- [OpenAI API Documentation](https://platform.openai.com/docs/api-reference)

---

## Related Documentation

- [Architecture](ARCHITECTURE.md) - System design
- [Workflows](WORKFLOWS.md) - Data ingestion workflows
- [Setup Guide](SETUP.md) - Configuration
- [Rotation Detection](ROTATION_DETECTION.md) - Algorithm
- [Microstructure Layer](MICROSTRUCTURE.md) - Real-time flow detection
- [UnusualWhales API Analysis](unusualwhales-api-analysis.md) - Detailed endpoint analysis

---

For questions or issues, see [main README](../README.md#support).
