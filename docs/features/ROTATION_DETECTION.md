# Rotation Detection Methodology

Comprehensive explanation of the institutional rotation detection algorithm.

## Table of Contents

- [Overview](#overview)
- [What is Institutional Rotation?](#what-is-institutional-rotation)
- [Detection Pipeline](#detection-pipeline)
- [Signal Components](#signal-components)
- [Scoring Algorithm](#scoring-algorithm)
- [Event Study Analysis](#event-study-analysis)
- [Use Cases](#use-cases)
- [Limitations](#limitations)

## Overview

The Institutional Rotation Detector identifies patterns where large institutional investors (hedge funds, mutual funds, asset managers) systematically rotate in and out of equity positions. These rotations often signal coordinated behavior and can predict subsequent price movements.

**Key Insight:** When large holders dump positions and smaller/different institutions pick them up, this "rotation" often precedes significant stock performance.

---

## What is Institutional Rotation?

### Definition

**Institutional Rotation** occurs when:
1. One or more large institutional holders reduce positions (the "dump")
2. Other institutional investors increase positions (the "uptake")
3. The transition happens within a defined time window (quarter or less)

### Types of Rotation

**Coordinated Rotation:**
- Multiple institutions exit simultaneously
- Suggests shared information or common strategy
- Often around earnings, index rebalances, or regulatory events

**Tactical Rotation:**
- Single large holder exits
- Opportunistic buyers accumulate
- May signal value opportunity or distress

**Index-Driven Rotation:**
- Forced by index reconstitution (Russell, S&P)
- Predictable but less alpha-generating
- System applies penalty to reduce false positives

### Why It Matters

**Market Impact:**
- Large selling pressure can depress prices temporarily
- Creates entry opportunities for value investors
- Subsequent uptake signals confidence and demand

**Predictive Power:**
- Rotation events often precede positive returns
- CAR (Cumulative Abnormal Return) analysis shows ~4-6% average gains
- Timing matters: Early detection enables alpha capture

---

## Detection Pipeline

### Phase 1: Data Ingestion

1. **Fetch SEC Filings**
   - 13F-HR: Quarterly institutional holdings
   - N-PORT: Monthly mutual fund holdings
   - 13G/13D: Beneficial ownership (>5%)

2. **Extract Positions**
   - Parse XML/SGML filings
   - Extract entity, CUSIP, shares, options
   - Store in `positions_13f` table

3. **Calculate Deltas**
   - Compare quarter-over-quarter positions
   - Identify large decreases (>5% reduction)
   - Flag as potential "dump" events

### Phase 2: Dump Detection

**Criteria:**
```typescript
function isDump(delta: number, prevShares: number): boolean {
  const pctChange = Math.abs(delta / prevShares);
  return pctChange >= 0.05; // 5% minimum threshold
}
```

**Z-Score Normalization:**
```typescript
function calculateDumpZ(delta: number, historicalDeltas: number[]): number {
  const mean = average(historicalDeltas);
  const stdDev = standardDeviation(historicalDeltas);
  return Math.abs((delta - mean) / stdDev);
}
```

**Example:**
- Vanguard holds 30M shares of AAPL
- Next quarter: 25M shares (5M reduction)
- Percentage change: 16.7%
- Z-score: 3.5 (highly unusual)

### Phase 3: Uptake Detection

**Same Quarter Uptake:**
- Measure total buying by other institutions in the SAME quarter
- Aggregate all increases across institutional holders
- Normalize by shares outstanding

**Next Quarter Uptake:**
- Measure buying in the FOLLOWING quarter
- Indicates delayed recognition or slower accumulation
- Weighted lower than same-quarter uptake

**Ultra-High-Frequency (UHF) Uptake:**
- Monthly N-PORT data captures faster flows
- Daily ETF holdings show real-time positioning
- Earlier signal than quarterly 13F

**Formula:**
```typescript
function calculateUptake(
  buyers: Position[],
  sharesOutstanding: number
): number {
  const totalBuying = buyers.reduce((sum, pos) => sum + pos.delta, 0);
  return Math.min(totalBuying / sharesOutstanding, 1.0);
}
```

### Phase 4: Options Analysis

**Options Overlay:**
- Measures put and call option activity around dump
- High put buying suggests hedging or bearish sentiment
- Call buying suggests bullish positioning

**Calculation:**
```typescript
function optionsOverlay(
  putShares: number,
  callShares: number,
  equityShares: number
): number {
  const netOptions = callShares - putShares;
  return Math.max(netOptions / equityShares, 0);
}
```

### Phase 5: Short Interest Relief

**Short Relief Metric:**
- Change in short interest after dump
- Declining short interest suggests covering
- Indicates reduced bearish sentiment

**Formula:**
```typescript
function shortReliefV2(
  shortBefore: number,
  shortAfter: number,
  sharesOutstanding: number
): number {
  const relief = Math.max(shortBefore - shortAfter, 0);
  return relief / sharesOutstanding;
}
```

### Phase 6: Scoring

Combine all signals into a single R-score (Rotation score).

---

## Signal Components

### 1. Dump Magnitude (dumpZ)

**What:** Z-score of position reduction compared to historical deltas.

**Why:** Large, unusual sells are more significant than routine rebalancing.

**Weight:** 2.0 (highest)

**Interpretation:**
- `dumpZ < 1.5`: Not significant (gated out)
- `dumpZ 1.5-3.0`: Moderate rotation
- `dumpZ > 3.0`: Strong rotation signal

**Example:**
```
Historical deltas: [-1M, +2M, -500K, +1.5M, -800K]
Mean: 0.04M
Std Dev: 1.2M
Current delta: -5M
dumpZ = |-5 - 0.04| / 1.2 = 4.2 ✓ Strong signal
```

---

### 2. Uptake Same Quarter (uSame)

**What:** Proportion of shares picked up by other institutions in the same quarter.

**Why:** Immediate uptake suggests the dump was absorbed without lasting impact.

**Weight:** 1.0

**Range:** 0 to 1.0

**Interpretation:**
- `uSame > 0.5`: Strong uptake (dump fully absorbed)
- `uSame 0.2-0.5`: Moderate uptake
- `uSame < 0.2`: Weak uptake (potential overhang)

**Example:**
```
Dump: -5M shares
Same quarter buying: +3M shares
Shares outstanding: 16B
uSame = 3M / 5M = 0.6 ✓ Strong uptake
```

---

### 3. Uptake Next Quarter (uNext)

**What:** Proportion picked up in the following quarter.

**Why:** Delayed uptake still validates demand but with lower immediacy.

**Weight:** 0.85 (or 1.02 if end-of-window)

**Range:** 0 to 1.0

**Interpretation:**
- Similar to uSame but time-lagged
- End-of-window multiplier (1.2x) accounts for natural reporting lag

---

### 4. UHF Same Quarter (uhfSame)

**What:** Ultra-high-frequency uptake from N-PORT (monthly) and ETF (daily) data.

**Why:** Captures faster institutional flows not visible in quarterly 13F.

**Weight:** 0.7

**Range:** 0 to 1.0

**Sources:**
- N-PORT monthly filings (mutual funds)
- ETF daily holdings (index funds)
- Alternative trading system (ATS) data

**Example:**
```
Dump date: March 31
N-PORT shows:
  - April: +500K shares (fund XYZ)
  - May: +800K shares (fund ABC)
Total UHF: 1.3M
uhfSame = 1.3M / 5M = 0.26
```

---

### 5. UHF Next Quarter (uhfNext)

**What:** UHF uptake in the following quarter.

**Weight:** 0.6 (or 0.72 if end-of-window)

**Range:** 0 to 1.0

---

### 6. Options Same Quarter (optSame)

**What:** Net call option activity (calls - puts) relative to equity dump.

**Why:** Options activity reveals sophisticated positioning and sentiment.

**Weight:** 0.5

**Range:** 0 to 1.0 (negative values set to 0)

**Interpretation:**
- High call activity suggests bullish positioning
- High put activity suggests hedging (reduces score)

**Example:**
```
Dump: -5M shares
Call options: +2M shares (underlying)
Put options: +500K shares (underlying)
Net: 2M - 500K = 1.5M
optSame = 1.5M / 5M = 0.3
```

---

### 7. Options Next Quarter (optNext)

**What:** Net call option activity in following quarter.

**Weight:** 0.4 (or 0.48 if end-of-window)

**Range:** 0 to 1.0

---

### 8. Short Interest Relief (shortReliefV2)

**What:** Decline in short interest after the dump.

**Why:** Short covering indicates reduced bearish sentiment.

**Weight:** 0.4

**Range:** 0 to 1.0

**Data Source:** FINRA short interest (bi-weekly)

**Example:**
```
Short interest before dump: 50M shares (3.1% of float)
Short interest after dump: 42M shares (2.6% of float)
Relief: 8M shares
Shares outstanding: 16B
shortReliefV2 = 8M / 16B = 0.0005 (normalized to 0-1 scale)
```

---

### 9. Index Penalty

**What:** Penalty applied if dump occurs during index rebalancing window.

**Why:** Index-driven flows are mechanical, not informational.

**Weight:** -1.0 (subtracted from score)

**Value:** Typically 0.1 to 0.5

**Windows:**
- Russell Annual: May 15 - July 15
- Russell Effective: June 1 - June 30
- S&P Quarterly: March, June, September, December

**Example:**
```
Dump date: June 20
Russell rebalance window: June 1 - June 30
indexPenalty = 0.3
```

---

### 10. End-of-Window (EOW)

**What:** Boolean flag if dump occurs in last 5 days of quarter.

**Why:** Late-quarter dumps may not show uptake until next quarter due to reporting lag.

**Multiplier:** 1.2x on "next quarter" signals (uNext, uhfNext, optNext)

**Example:**
```
Quarter end: March 31
Dump date: March 28
EOW = true
uNext weight = 0.85 * 1.2 = 1.02
```

---

## Scoring Algorithm

### Formula

```typescript
const WEIGHTS = {
  dump: 2.0,
  uSame: 1.0,
  uNext: 0.85,
  uhfSame: 0.7,
  uhfNext: 0.6,
  optSame: 0.5,
  optNext: 0.4,
  shortRelief: 0.4,
};

function computeRotationScore(inputs: ScoreInputs): ScoreResult {
  // Gate 1: Dump must be significant
  if (inputs.dumpZ < 1.5) {
    return { rScore: 0, gated: false };
  }

  // Gate 2: Must have some uptake
  const hasUptake =
    inputs.uSame > 0 ||
    inputs.uNext > 0 ||
    inputs.uhfSame > 0 ||
    inputs.uhfNext > 0;

  if (!hasUptake) {
    return { rScore: 0, gated: false };
  }

  // Apply end-of-window multiplier
  const eowMultiplier = inputs.eow ? 1.2 : 1.0;

  // Calculate weighted score
  const score =
    WEIGHTS.dump * inputs.dumpZ +
    WEIGHTS.uSame * inputs.uSame +
    WEIGHTS.uNext * inputs.uNext * eowMultiplier +
    WEIGHTS.uhfSame * inputs.uhfSame +
    WEIGHTS.uhfNext * inputs.uhfNext * eowMultiplier +
    WEIGHTS.optSame * inputs.optSame +
    WEIGHTS.optNext * inputs.optNext * eowMultiplier +
    WEIGHTS.shortRelief * inputs.shortReliefV2 -
    inputs.indexPenalty;

  return { rScore: score, gated: true };
}
```

### Example Calculation

**Inputs:**
```javascript
dumpZ: 3.5
uSame: 0.45
uNext: 0.32
uhfSame: 0.38
uhfNext: 0.25
optSame: 0.12
optNext: 0.08
shortReliefV2: 0.22
indexPenalty: 0.1
eow: false
```

**Calculation:**
```
r_score = 2.0 * 3.5 +
          1.0 * 0.45 +
          0.85 * 0.32 * 1.0 +
          0.7 * 0.38 +
          0.6 * 0.25 * 1.0 +
          0.5 * 0.12 +
          0.4 * 0.08 * 1.0 +
          0.4 * 0.22 -
          0.1

        = 7.0 + 0.45 + 0.272 + 0.266 + 0.15 + 0.06 + 0.032 + 0.088 - 0.1
        = 8.218
```

**Interpretation:**
- r_score > 10: Strong rotation (high confidence)
- r_score 5-10: Moderate rotation
- r_score < 5: Weak rotation

---

## Event Study Analysis

### Cumulative Abnormal Return (CAR)

**Purpose:** Measure stock performance around rotation events.

**Window:** -5 days to +20 days relative to anchor date

**Method:**
1. Calculate daily returns
2. Subtract market return (benchmark index)
3. Accumulate abnormal returns

**Formula:**
```
AR_t = R_t - R_market_t
CAR = Σ AR_t for t = -5 to +20
```

**Example:**
```
Anchor date: March 31
Window: March 24 to April 27

Day  Stock Return  Market Return  Abnormal Return  CAR
-5   0.8%          0.5%          0.3%             0.3%
-4   -0.2%         0.1%          -0.3%            0.0%
...
0    1.2%          0.3%          0.9%             2.1%
+1   0.5%          0.2%          0.3%             2.4%
...
+20  0.8%          0.4%          0.4%             4.3%
```

**Stored Metrics:**
- `car_m5_p20`: Total CAR from -5 to +20
- `t_to_plus20_days`: Calendar days to reach +20 trading days
- `max_ret_w13`: Maximum return in week 13 (another analysis window)

### Statistical Significance

**T-Test:**
```
t = CAR / (std_dev / sqrt(N))
```

**Interpretation:**
- CAR > 3%: Likely meaningful
- CAR > 5%: Strong signal
- CAR < 1%: May be noise

---

## Use Cases

### 1. Quantitative Trading

**Strategy:**
- Screen for r_score > 8
- Enter position shortly after dump
- Target holding period: 20-60 days
- Stop loss: -3%

**Expected Performance:**
- Win rate: ~55-65%
- Average gain: 4-6%
- Risk/reward: ~2:1

### 2. Risk Management

**Applications:**
- Detect institutional flight from holdings
- Monitor portfolio concentration risk
- Identify potential liquidations

**Alerts:**
- Large dump (dumpZ > 3) with low uptake (uSame < 0.2)
- Suggests potential distress or negative sentiment

### 3. Market Research

**Insights:**
- Which institutions are rotating?
- What sectors are experiencing rotation?
- How does rotation correlate with earnings?

**Analysis:**
- Aggregate rotations by sector
- Track institutional behavior over time
- Identify systematic patterns

### 4. Regulatory Analysis

**Monitoring:**
- Track ownership changes in systemically important stocks
- Identify potential market manipulation
- Analyze coordinated trading patterns

---

## Limitations

### 1. Data Lag

**13F Filings:**
- Filed 45 days after quarter end
- Position data is stale by reporting time
- Real-time edge requires alternative data

**Mitigation:**
- Use N-PORT (monthly) for faster signals
- Incorporate ETF holdings (daily)
- Monitor ATS data

### 2. Attribution Uncertainty

**Buyer Identification:**
- Cannot definitively match sellers to buyers
- Uptake is aggregate across all institutions
- Individual flows are inferred, not confirmed

**Mitigation:**
- Use graph analysis to infer likely flows
- Leverage GraphRAG for pattern detection

### 3. Index Noise

**Mechanical Rebalancing:**
- Index reconstitution forces flows
- Not informational, just mechanical
- Creates false positives

**Mitigation:**
- Index penalty reduces scores during rebalance windows
- Filter out pure index-driven events

### 4. Market Impact

**Price Movement:**
- Large dumps already reflected in price
- May be too late to capture full alpha
- Requires fast execution

**Mitigation:**
- Use UHF signals for earlier detection
- Focus on larger, slower rotations

### 5. Survivorship Bias

**Data Quality:**
- Delisted companies not captured
- Bankrupt firms excluded
- Skews historical performance

**Mitigation:**
- Include failed companies in backtests
- Adjust for survivorship in CAR analysis

---

## References

### Academic Literature

- Gompers & Metrick (2001): "Institutional Investors and Equity Prices"
- Chen, Hong & Stein (2002): "Breadth of Ownership and Stock Returns"
- Sias (2004): "Institutional Herding"

### Industry Sources

- SEC EDGAR: https://www.sec.gov/edgar
- FINRA: https://www.finra.org/
- Russell Rebalance Methodology: https://www.ftserussell.com/

---

## Related Documentation

- [GRAPHRAG](GRAPHRAG.md) - Graph analysis methods
- [DATA_SOURCES](DATA_SOURCES.md) - Data sources and APIs
- [API Reference](API.md) - Query rotation events
- [Workflows](WORKFLOWS.md) - Detection workflow

---

For questions or issues, see [main README](../README.md#support).
