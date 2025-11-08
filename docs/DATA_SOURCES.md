# Data Sources

Comprehensive guide to external data sources, APIs, and integration patterns.

## Table of Contents

- [Overview](#overview)
- [SEC EDGAR](#sec-edgar)
- [FINRA](#finra)
- [IEX Exchange](#iex-exchange)
- [ETF Holdings](#etf-holdings)
- [OpenAI](#openai)
- [Rate Limiting](#rate-limiting)
- [Data Quality](#data-quality)
- [Compliance](#compliance)

## Overview

The Institutional Rotation Detector integrates data from multiple external sources:

| Source | Data Type | Frequency | Latency | Cost |
|--------|-----------|-----------|---------|------|
| SEC EDGAR | 13F, N-PORT, 13G/D | Quarterly/Monthly | 45 days (13F) | Free |
| FINRA OTC Transparency | Off-exchange volumes (ATS & non-ATS) | Weekly | ~2 weeks | Free |
| IEX Exchange | Matched on-exchange volume (HIST) | Daily (T+1) | 1 day | Free |
| FINRA | Short interest | Semi-monthly | ~8 business days | Free |
| ETF Providers | Daily holdings | Daily | 1 day | Free |
| OpenAI | Text generation | On-demand | Real-time | Paid |

---

## SEC EDGAR

### Overview

**EDGAR** (Electronic Data Gathering, Analysis, and Retrieval) is the SEC's public filing system.

**Base URL:** `https://www.sec.gov/`

**Documentation:** https://www.sec.gov/edgar/searchedgar/accessing-edgar-data.htm

### Rate Limits

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

### Filing Types

#### 13F-HR (Institutional Holdings)

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

**XML Structure:**
```xml
<informationTable>
  <infoTable>
    <nameOfIssuer>Apple Inc</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip>037833100</cusip>
    <value>28500000</value>
    <shrsOrPrnAmt>
      <sshPrnamt>30000000</sshPrnamt>
      <sshPrnamtType>SH</sshPrnamtType>
    </shrsOrPrnAmt>
    <putCall/>
    <investmentDiscretion>SOLE</investmentDiscretion>
    <votingAuthority>
      <Sole>30000000</Sole>
      <Shared>0</Shared>
      <None>0</None>
    </votingAuthority>
  </infoTable>
</informationTable>
```

**Parsing:**
```typescript
import { XMLParser } from 'fast-xml-parser';

export async function parse13F(xml: string): Promise<Position13F[]> {
  const parser = new XMLParser();
  const parsed = parser.parse(xml);

  const tables = parsed.edgarSubmission.formData.informationTable.infoTable;

  return tables.map((table: any) => ({
    cusip: table.cusip,
    shares: parseInt(table.shrsOrPrnAmt.sshPrnamt),
    putCallShares: table.putCall === 'Put' ? parseInt(table.shrsOrPrnAmt.sshPrnamt) : 0,
    // ...
  }));
}
```

---

#### N-PORT-P (Monthly Fund Holdings)

**Purpose:** Monthly portfolio holdings for registered investment companies (mutual funds, ETFs).

**Filing Deadline:** 30 days after month end.

**Format:** XML (structured) or JSON (newer).

**Data Extracted:**
- Security identifier (CUSIP, ISIN)
- Shares or principal amount
- Market value
- Percentage of portfolio

**Example URL:**
```
https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001364742&type=NPORT-P&dateb=&owner=exclude&count=100
```

**Parsing:**
```typescript
export async function parseNPORT(xml: string): Promise<NPORTPosition[]> {
  const parser = new XMLParser();
  const parsed = parser.parse(xml);

  const holdings = parsed.edgarSubmission.formData.invstOrSecs;

  return holdings.map((holding: any) => ({
    cusip: holding.identifiers.cusip,
    shares: holding.balance,
    value: holding.valUSD,
    pctPortfolio: holding.pctVal,
  }));
}
```

---

#### 13G / 13D (Beneficial Ownership)

**Purpose:** Disclosure of >5% ownership in public companies.

**Types:**
- **13G:** Passive investors (within 45 days of crossing 5%)
- **13D:** Active investors (within 10 days)

**Format:** Text with structured sections.

**Data Extracted:**
- Holder CIK and name
- Issuer CIK and name
- Shares owned
- Percentage of class
- Event date

**Example URL:**
```
https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=SC%2013G&dateb=&owner=exclude&count=100
```

**Parsing:**
```typescript
export async function parse13G(text: string): Promise<BeneficialOwnership> {
  // Regex patterns for structured sections
  const sharesMatch = text.match(/Aggregate Amount Beneficially Owned.*?(\d{1,3}(,\d{3})*)/i);
  const pctMatch = text.match(/Percent of Class.*?([\d.]+)%/i);

  return {
    shares: sharesMatch ? parseInt(sharesMatch[1].replace(/,/g, '')) : null,
    pctOfClass: pctMatch ? parseFloat(pctMatch[1]) : null,
  };
}
```

---

### Search and Discovery

**Company Search:**
```
https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type={form}&dateb={before_date}&owner=exclude&count={limit}
```

**Full-Text Search:**
```
https://efts.sec.gov/LATEST/search-index
```

**RSS Feeds:**
```
https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&CIK=&type=13F&company=&dateb=&owner=exclude&start=0&count=100&output=atom
```

### Implementation

**SEC Client:**

```typescript
import { RateLimiter } from '../lib/rateLimit.js';

export class SECClient {
  private limiter = new RateLimiter(10); // 10 req/sec

  async fetchFiling(accession: string): Promise<string> {
    await this.limiter.acquire();

    const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession}.txt`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': process.env.SEC_USER_AGENT!,
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        await this.backoff();
        return this.fetchFiling(accession);
      }
      throw new Error(`SEC API error: ${response.status}`);
    }

    return response.text();
  }

  private async backoff() {
    const delay = 60000; // 1 minute
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}
```

---

## FINRA

### Overview

**FINRA** (Financial Industry Regulatory Authority) publishes multiple microstructure datasets that power off-exchange analytics and short-interest overlays. We integrate both the **OTC Transparency** program (ATS + non-ATS) and **Rule 4560 short-interest** reports.

### OTC Transparency (ATS & Non-ATS)

- **Program page:** https://otctransparency.finra.org/
- **Cadence:** Weekly (reports publish roughly two weeks after the trade week ends).
- **Deliverables:** Venue-level share/trade totals for ATS and non-ATS activity plus symbol aggregates.
- **Transport:** CSV files (often zipped). Filenames encode report type and week end (e.g., `ATS_20240503.csv`).
- **Implementation:** `finraOtcWeeklyIngestWorkflow` orchestrates `listWeeklyFiles → downloadWeeklyFile → parseVenueCsv → aggregateSymbolWeek`. All network access happens in `finra.otc.activities.ts`, which respects `MAX_RPS_EXTERNAL` via a `RateLimiter` and stamps provenance (`micro_source_files` keeps URL + SHA-256).
- **Storage:**
  - `micro_offex_venue_weekly` stores venue rows with `finra_file_id`/`finra_sha256`.
  - `micro_offex_symbol_weekly` materializes per-symbol totals.
  - `micro_offex_ratio` contains official weekly percentages (`quality_flag='official'` when consolidated totals exist, `'official_partial'` otherwise) and daily approximations (`'approx'` for consolidated distributions, `'iex_proxy'` when using IEX matched volume).

### Short Interest (Rule 4560)

- **Program page:** https://www.finra.org/rules-guidance/rulebooks/finra-rules/4560
- **Cadence:** Semi-monthly. Settlement dates fall on the 15th and the last business day of each month; publication occurs ~8 business days later.
- **Transport:** FINRA Data API (`group=shortSale`, `name=shortInterest`) via `FinraClient`.
- **Implementation:** `shortInterestIngestWorkflow` loads the FINRA calendar (`shortinterest.activities.ts#loadCalendar`) and fetches symbol-level shares with `fetchShortInterest`, writing to `micro_short_interest_points` with provenance metadata.
- **Usage:** Event-study covariates use the latest and next publication surrounding an anchor to compute `short_interest_change`.

### Provenance & Compliance

- Every downloaded artifact is hashed (`sha256`) and recorded in `micro_source_files` for auditability.
- Activities set the `EDGAR_USER_AGENT` header (configure via environment) and throttle against `MAX_RPS_EXTERNAL` to respect FINRA's robots guidance.

---

## IEX Exchange

### Overview

The Investors Exchange (IEX) publishes **HIST** matched-volume files that capture on-exchange executions for all listed symbols.

- **Program page:** https://www.iexexchange.io/products/market-data
- **Cadence:** Daily (T+1, business days).
- **Transport:** CSV files (`hist/stocks/YYYYMMDD.csv`) occasionally bundled in ZIP archives.
- **Implementation:** `iexDailyIngestWorkflow` drives `downloadDaily → parseDailyVolume`. Activities live in `iex.hist.activities.ts` and reuse the shared rate limiter + provenance store (`micro_source_files`).
- **Storage:** `micro_iex_volume_daily` persists per-symbol matched shares with file identifiers and hashes.
- **Usage:** Acts as the default on-exchange proxy when consolidated totals are unavailable (`micro_offex_ratio.quality_flag='iex_proxy'`).

---

## ETF Holdings

### Overview

ETF providers publish daily holdings for transparency.

**Common Providers:**
- BlackRock (iShares)
- Vanguard
- State Street (SPDR)
- Invesco

**Update Frequency:** Daily (T+1)

**Format:** CSV or JSON

### BlackRock (iShares)

**Example URL:**
```
https://www.ishares.com/us/products/{fund_id}/ishares-core-s-p-500-etf/1467271812596.ajax?fileType=csv&fileName=IVV_holdings&dataType=fund
```

**CSV Format:**
```csv
Ticker,Name,Sector,Asset Class,Weight,Notional Value,Shares,CUSIP,ISIN,Sedol,Price,Location,Exchange,Currency,Market Value
AAPL,Apple Inc,Information Technology,Equity,7.23,28500000000,155000000,037833100,US0378331005,2046251,184.00,United States,NASDAQ,USD,28520000000
```

**Parsing:**
```typescript
export async function fetchETFHoldings(
  etfTicker: string,
  asof: string
): Promise<ETFHolding[]> {
  const csv = await downloadETFHoldings(etfTicker);
  const rows = parseCSV(csv);

  return rows.map(row => ({
    cusip: row.CUSIP,
    ticker: row.Ticker,
    shares: parseInt(row.Shares),
    weight: parseFloat(row.Weight),
    asof,
  }));
}
```

### Vanguard

**Example URL:**
```
https://advisors.vanguard.com/investments/products/{fund_id}/vanguard-500-index-fund-investor-shares/vfinx/portfolio-holdings
```

**Format:** Excel or PDF (requires parsing)

### State Street (SPDR)

**Example URL:**
```
https://www.ssga.com/us/en/intermediary/etfs/funds/{fund_id}
```

**Format:** Excel download

### Implementation

```typescript
export async function fetchDailyHoldings(
  cusips: string[],
  etfUniverse: string[]
): Promise<number> {
  let totalHoldings = 0;

  for (const etf of etfUniverse) {
    const holdings = await fetchETFHoldings(etf, new Date().toISOString());

    for (const holding of holdings) {
      if (cusips.includes(holding.cusip)) {
        totalHoldings += holding.shares;
      }
    }
  }

  return totalHoldings;
}
```

---

## OpenAI

### Overview

**OpenAI API** is used for:
- Text embeddings (vector search)
- Text generation (explanations, summaries)
- Long-context synthesis

**Base URL:** `https://api.openai.com/v1/`

**Documentation:** https://platform.openai.com/docs/api-reference

### Models Used

| Model | Purpose | Context Window | Cost (per 1M tokens) |
|-------|---------|----------------|----------------------|
| `text-embedding-3-small` | Embeddings (1536 dim) | 8K | $0.02 |
| `gpt-4-turbo-preview` | Analysis, synthesis | 128K | $10 (input) + $30 (output) |
| `gpt-4o-mini` | Simple tasks | 128K | $0.15 (input) + $0.60 (output) |

### Embeddings

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

**Example:**
```typescript
const text = "Apple Inc. reported strong Q1 earnings...";
const embedding = await generateEmbedding(text);
// embedding: [0.023, -0.145, 0.678, ..., 0.234] (1536 dimensions)

// Store in database
await supabase
  .from('filing_chunks')
  .insert({
    accession: '0001193125-24-123456',
    chunk_no: 1,
    content: text,
    embedding: embedding,
  });
```

### Text Generation

**Purpose:** Generate explanations, summaries, and answers.

**Usage:**
```typescript
export async function generateExplanation(
  context: string,
  question: string
): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [
      {
        role: 'system',
        content: 'You are a financial analyst...',
      },
      {
        role: 'user',
        content: `Context: ${context}\n\nQuestion: ${question}`,
      },
    ],
    temperature: 0.7,
    max_tokens: 2000,
  });

  return completion.choices[0].message.content ?? '';
}
```

### Rate Limits

**Tier 1 (Free/New):**
- 3 requests per minute (RPM)
- 200,000 tokens per day (TPD)

**Tier 2-5 (Paid):**
- 500-10,000 RPM
- 2M-100M TPD

**Handling:**
```typescript
import pRetry from 'p-retry';

export async function callOpenAIWithRetry<T>(
  fn: () => Promise<T>
): Promise<T> {
  return pRetry(fn, {
    retries: 3,
    onFailedAttempt: async (error) => {
      if (error.message.includes('Rate limit')) {
        const delay = Math.pow(2, error.attemptNumber) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    },
  });
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

### Circuit Breaker

**Pattern:** Stop calling failing services.

```typescript
export class CircuitBreaker {
  private failures = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private nextAttempt = 0;

  constructor(
    private threshold: number = 5,
    private timeout: number = 60000
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'half-open';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure() {
    this.failures++;
    if (this.failures >= this.threshold) {
      this.state = 'open';
      this.nextAttempt = Date.now() + this.timeout;
    }
  }
}
```

---

## Data Quality

### Validation

**Filing Completeness:**
```typescript
function validateFiling(filing: Filing): boolean {
  return Boolean(
    filing.accession &&
    filing.cik &&
    filing.form &&
    filing.filed_date &&
    filing.url
  );
}
```

**Position Sanity Checks:**
```typescript
function validatePosition(position: Position13F): boolean {
  // Shares should be positive
  if (position.shares < 0) return false;

  // Options can't exceed reasonable multiples
  if (position.opt_call_shares > position.shares * 10) return false;

  // Value should be reasonable
  const impliedPrice = position.value / position.shares;
  if (impliedPrice < 0.01 || impliedPrice > 100000) return false;

  return true;
}
```

### Deduplication

**Filings:**
```sql
INSERT INTO filings (accession, cik, form, filed_date, url)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (accession) DO NOTHING;
```

**Positions:**
```sql
INSERT INTO positions_13f (entity_id, cusip, asof, shares, accession)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (entity_id, cusip, asof, accession)
DO UPDATE SET shares = EXCLUDED.shares;
```

### Error Handling

**Malformed Data:**
```typescript
try {
  const positions = parse13F(xml);
} catch (error) {
  if (error instanceof XMLParseError) {
    // Log and skip malformed filing
    console.error(`Failed to parse filing ${accession}:`, error);
    return [];
  }
  throw error; // Rethrow unexpected errors
}
```

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
- No automated scraping

**Alternative:** Use licensed data providers.

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

## Related Documentation

- [Architecture](ARCHITECTURE.md) - System design
- [Workflows](WORKFLOWS.md) - Data ingestion workflows
- [Setup Guide](SETUP.md) - Configuration
- [Rotation Detection](ROTATION_DETECTION.md) - Algorithm

---

For questions or issues, see [main README](../README.md#support).
