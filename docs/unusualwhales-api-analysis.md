# UnusualWhales API - Endpoint Analysis for Institutional Rotation Detection

## Overview
This document analyzes the UnusualWhales API endpoints optimal for detecting institutional rotation via options positioning (DAILY data only, no intraday).

---

## 🎯 Recommended Endpoint Strategy

### **Tier 1: Core Daily Data** (Must-have)

#### 1. `/api/stock/{ticker}/flow-per-expiry`
**Purpose:** Daily aggregated options flow by expiration
**Parameters:**
- `ticker` (required, path)
- No date parameter (returns last trading day)

**Returns:**
```json
{
  "data": [
    {
      "ticker": "AAPL",
      "date": "2024-01-22",
      "expiry": "2024-02-16",
      "call_volume": 89177,
      "call_trades": 11383,
      "call_premium": "5839180",
      "call_volume_ask_side": 43669,
      "call_volume_bid_side": 40164,
      "call_otm_volume": 81598,
      "call_otm_premium": "3885339",
      "put_volume": 20101,
      "put_trades": 2744,
      "put_premium": "4802145",
      "put_volume_ask_side": 7396,
      "put_volume_bid_side": 8113,
      "put_otm_volume": 12164,
      "put_otm_premium": "632247"
    }
  ]
}
```

**Use Cases:**
- Calculate Put/Call ratios (volume and premium)
- Detect unusual premium flow
- Track OTM activity (speculative positioning)
- Identify directional bias (ask vs bid side)

---

#### 2. `/api/stock/{ticker}/flow-per-strike`
**Purpose:** Daily aggregated options flow by strike price
**Parameters:**
- `ticker` (required, path)
- `date` (optional, query) - Format: YYYY-MM-DD

**Returns:**
```json
[
  {
    "call_premium": "9908777.0",
    "call_premium_ask_side": "5037703.0",
    "call_premium_bid_side": "4055973.0",
    "call_trades": 12345,
    "call_volume": 89177,
    "put_premium": "4802145.0",
    "put_premium_ask_side": "3593584.0",
    "put_premium_bid_side": "690572.0",
    "put_trades": 2744,
    "put_volume": 20101,
    "strike": "180.0",
    "date": "2024-01-22"
  }
]
```

**Use Cases:**
- Identify strike concentrations
- Detect unusual activity at specific strikes
- Build volume profile by strike

---

#### 3. `/api/stock/{ticker}/greeks`
**Purpose:** Greeks (delta, gamma, theta, vega, IV) for all strikes in ONE expiration
**Parameters:**
- `ticker` (required, path)
- `expiry` (required, query) - Format: YYYY-MM-DD
- `date` (optional, query) - Format: YYYY-MM-DD

**Returns:**
```json
{
  "data": [
    {
      "strike": "480.0",
      "date": "2024-01-01",
      "expiry": "2024-01-05",
      "call_delta": "0.5",
      "call_gamma": "0.0051",
      "call_theta": "-0.62",
      "call_vega": "0.15",
      "call_rho": "0.0321",
      "call_charm": "9.32",
      "call_vanna": "-0.91",
      "call_volatility": "0.3",
      "call_option_symbol": "SPY240105C00480000",
      "put_delta": "-0.51",
      "put_gamma": "0.005",
      "put_theta": "-0.62",
      "put_vega": "0.15",
      "put_rho": "-0.022",
      "put_charm": "9.32",
      "put_vanna": "-0.91",
      "put_volatility": "0.29",
      "put_option_symbol": "SPY240105P00480000"
    }
  ]
}
```

**⚠️ Important:** Must query each expiration separately!

**Use Cases:**
- Calculate IV skew (put IV vs call IV)
- Detect IV rank changes
- Compute delta exposure by strike
- Build volatility surface

---

#### 4. `/api/stock/{ticker}/greek-exposure`
**Purpose:** Historical daily aggregated Greek exposure (GEX)
**Parameters:**
- `ticker` (required, path)
- `date` (optional, query) - Format: YYYY-MM-DD
- `timeframe` (optional, query) - one of: `1d`, `5d`, `1m`, `3m`, `6m`, `1y`, `5y`

**Returns:**
```json
{
  "data": [
    {
      "date": "2023-09-08",
      "call_delta": "227549667.4651",
      "call_gamma": "9356683.4241",
      "call_vanna": "152099632406.9564",
      "call_charm": "102382359.5786",
      "put_delta": "-191893077.7193",
      "put_gamma": "-12337386.0524",
      "put_vanna": "488921784213.1121",
      "put_charm": "-943028472.4815"
    }
  ]
}
```

**Use Cases:**
- Track GEX trends over time
- Identify gamma flips (positive to negative)
- Detect institutional positioning changes
- Compute net delta exposure

---

### **Tier 2: Unusual Activity Detection** (Highly Recommended)

#### 5. `/api/option-trades/flow-alerts`
**Purpose:** Pre-filtered unusual options activity alerts
**Parameters:**
- `ticker_symbol` (optional, query)
- `min_premium` (optional, query)
- `max_premium` (optional, query)
- `min_size` (optional, query)
- `is_sweep` (optional, query, boolean)
- `is_floor` (optional, query, boolean)
- `all_opening` (optional, query, boolean)
- `alert_rule` (optional, query) - one of:
  - `RepeatedHits`
  - `RepeatedHitsAscendingFill`
  - `RepeatedHitsDescendingFill`
  - `FloorTradeLargeCap`
  - `FloorTradeMidCap`
  - `FloorTradeSmallCap`
  - `OtmEarningsFloor`
  - `LowHistoricVolumeFloor`
  - `SweepsFollowedByFloor`

**Returns:**
```json
{
  "data": [
    {
      "ticker": "MSFT",
      "option_chain": "MSFT231222C00375000",
      "strike": "375",
      "expiry": "2023-12-22",
      "type": "call",
      "alert_rule": "RepeatedHits",
      "created_at": "2023-12-12T16:35:52.168490Z",
      "underlying_price": "372.99",
      "price": "4.05",
      "total_size": 461,
      "total_premium": "186705",
      "total_ask_side_prem": "151875",
      "total_bid_side_prem": "405",
      "trade_count": 32,
      "volume": 2442,
      "open_interest": 7913,
      "volume_oi_ratio": "0.30860609124226",
      "has_sweep": true,
      "has_floor": false,
      "has_multileg": false,
      "all_opening_trades": false
    }
  ]
}
```

**Use Cases:**
- Detect unusual institutional positioning
- Identify sweep orders (aggressive institutional buying)
- Flag floor trades (large cap institutional activity)
- Track repeated hits (persistent positioning)

---

### **Tier 3: Supporting Data** (Optional but Useful)

#### 6. `/api/stock/{ticker}/option-chains`
**Purpose:** List all valid option symbols for a ticker on a given date
**Parameters:**
- `ticker` (required, path)
- `date` (optional, query) - Format: YYYY-MM-DD

**Returns:**
```json
{
  "data": [
    "AAPL230908C00175000",
    "AAPL230908C00180000",
    "AAPL230908P00175000"
  ]
}
```

**Regex to parse symbols:**
```regex
^(?<symbol>[\w]*)(?<expiry>(\d{2})(\d{2})(\d{2}))(?<type>[PC])(?<strike>\d{8})$
```
*Note: Strike needs to be divided by 1,000*

**Use Cases:**
- Discover all valid expirations for a ticker
- Enumerate strikes to query greeks endpoint
- Filter contracts for specific analysis

---

#### 7. `/api/stock/{ticker}/greek-exposure/expiry`
**Purpose:** Greek exposure broken down by expiration date
**Parameters:**
- `ticker` (required, path)
- `date` (optional, query)

**Returns:**
```json
{
  "data": [
    {
      "date": "2022-05-20",
      "expiry": "2022-05-25",
      "dte": 5,
      "call_delta": "227549667.4651",
      "call_gamma": "9356683.4241",
      "put_delta": "-191893077.7193",
      "put_gamma": "-12337386.0524"
    }
  ]
}
```

**Use Cases:**
- Identify which expirations have highest GEX
- Detect term structure changes
- Track expiration-specific positioning

---

## 🔄 Multi-Endpoint Workflows

### Workflow 1: Daily Full Options Snapshot

**Goal:** Complete daily snapshot of options activity for a ticker

**Steps:**
1. Call `/api/stock/{ticker}/flow-per-expiry` → Get flow by expiration
2. Call `/api/stock/{ticker}/flow-per-strike` (with date) → Get flow by strike
3. Call `/api/stock/{ticker}/option-chains` (with date) → Get all valid contracts
4. Parse option chains to extract unique expirations
5. For each expiration:
   - Call `/api/stock/{ticker}/greeks?expiry={exp}&date={date}` → Get greeks
6. Call `/api/stock/{ticker}/greek-exposure?date={date}` → Get aggregated GEX

**Result:** Complete daily options profile with flow, greeks, and exposure

---

### Workflow 2: Unusual Activity Detection

**Goal:** Detect unusual institutional positioning

**Steps:**
1. Call `/api/option-trades/flow-alerts?ticker_symbol={ticker}&min_premium=50000`
   - Filter for large premium trades (>$50k)
2. For each alert:
   - Check `alert_rule` type
   - Analyze `has_sweep`, `has_floor`, `all_opening_trades`
   - Calculate `volume_oi_ratio` (>3.0 = unusual)
3. Cross-reference with `/api/stock/{ticker}/flow-per-expiry` to see overall flow context

**Result:** Filtered list of high-confidence unusual activity events

---

### Workflow 3: Historical Options Analysis

**Goal:** Track options positioning trends over 30 days

**Steps:**
1. Call `/api/stock/{ticker}/greek-exposure?timeframe=1m`
   - Get 30 days of daily GEX data
2. For each day, call `/api/stock/{ticker}/flow-per-strike?date={date}`
   - Get historical flow by strike
3. Compute rolling averages:
   - 30-day avg call volume, put volume
   - 30-day avg P/C ratio
   - 30-day avg IV (from greeks)

**Result:** Historical baselines for statistical significance testing

---

## 📊 Calculated Metrics

From the raw endpoint data, derive these institutional rotation signals:

### Volume Metrics
```python
put_call_ratio_volume = put_volume / call_volume
put_call_ratio_premium = put_premium / call_premium
volume_oi_ratio = volume / open_interest  # >3.0 = unusual
otm_ratio = otm_volume / total_volume      # Speculative activity
```

### Flow Direction
```python
net_call_flow = call_volume_ask_side - call_volume_bid_side
net_put_flow = put_volume_ask_side - put_volume_bid_side
directional_bias = (net_call_flow - net_put_flow) / (total_volume)
```

### Greeks
```python
iv_skew = put_volatility - call_volatility  # Positive = fear
net_delta = call_delta + put_delta
net_gamma = call_gamma + put_gamma
gamma_flip = (net_gamma > 0)  # True = volatility suppression
```

### Unusual Activity Flags
```python
pre_dump_put_surge = (
    put_volume_30d_avg > 0 and
    put_volume > 3 * put_volume_30d_avg and
    put_call_ratio > 2.0
)

post_dump_call_buildup = (
    call_volume > 2 * call_volume_30d_avg and
    volume_oi_ratio > 3.0 and
    has_sweep = true
)

iv_decline = (
    atm_iv_today < atm_iv_7d_ago and
    iv_rank < 30  # Low IV rank = reduced fear
)
```

---

## ⚙️ Implementation Recommendations

### Caching Strategy
- Cache `/api/stock/{ticker}/option-chains` results (changes rarely intraday)
- Cache historical greek-exposure data (immutable once market closes)
- Fresh fetch flow-per-expiry/strike daily

### Rate Limiting
- Default: 10 req/sec
- Batch requests: Query multiple expirations in parallel (up to 10 concurrent)
- Use exponential backoff for retries

### Data Freshness
- Options chain: EOD (closes at 4pm ET)
- Flow data: T+1 (available next trading day)
- Greeks: EOD calculations
- Flow alerts: Real-time during market hours, but batch query EOD for daily summary

### Pagination
- Most endpoints support `limit` and `page` parameters
- Default limit: 50-100
- Max limit: 200-500 (varies by endpoint)

---

## 🎯 Optimal Implementation for Rotation Detector

**For detecting institutional rotation with daily options positioning:**

1. **Daily Ingestion (EOD after market close):**
   ```
   For each tracked ticker:
     1. GET /api/stock/{ticker}/flow-per-expiry
     2. GET /api/stock/{ticker}/flow-per-strike?date={today}
     3. GET /api/stock/{ticker}/greek-exposure?date={today}
     4. Store in: options_summary_daily table
   ```

2. **Weekly Greek Detail Refresh:**
   ```
   For each ticker (weekly or on-demand):
     1. GET /api/stock/{ticker}/option-chains?date={today}
     2. Parse expirations from symbols
     3. For each expiration:
        GET /api/stock/{ticker}/greeks?expiry={exp}&date={today}
     4. Store in: options_chain_daily table
   ```

3. **Continuous Unusual Activity Monitoring:**
   ```
   Every hour during market hours:
     1. GET /api/option-trades/flow-alerts?min_premium=50000
     2. Filter for tracked tickers
     3. Store in: unusual_options_activity table
   ```

4. **Historical Baseline Computation (Daily):**
   ```
   For each ticker:
     1. Query last 30 days from options_summary_daily
     2. Compute rolling averages and percentiles
     3. Store in: options_historical_baselines table
   ```

---

## 📝 Notes

- **No intraday data needed:** All endpoints return EOD or daily aggregated data
- **Expiration iteration required:** Greeks endpoint must be called per expiration
- **Symbol parsing needed:** Option chains return symbols that need regex parsing
- **Historical data:** Use `timeframe` parameter for batched historical queries
- **Alert rules:** Pre-filtered by UnusualWhales for institutional activity patterns

---

## 🔗 Reference

- API Documentation: https://api.unusualwhales.com/docs
- OpenAPI Spec: https://api.unusualwhales.com/api/openapi
- Rate Limits: Check your subscription tier
- Support: support@unusualwhales.com
