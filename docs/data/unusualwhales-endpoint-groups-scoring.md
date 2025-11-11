# UnusualWhales API - Endpoint Groups & Scoring Framework

## Endpoint Group Classification

All endpoints have been analyzed and grouped by their functional relationship and data dependencies.

---

## ⭐ Group 1: CONTRACT DISCOVERY & METADATA
**Purpose:** Discover valid contracts for a ticker before querying detailed data

### Endpoints

#### 1.1 `/api/stock/{ticker}/option-chains`
**Returns:** Array of option symbols (e.g., `["AAPL240105C00175000"]`)
**Parameters:**
- `ticker` (required)
- `date` (optional) - defaults to last trading day

**Dependencies:** NONE (entry point)
**Use Case:** Get list of all valid option symbols for a ticker on a date
**Output:** Option symbols that need regex parsing

**Score: 🔵 Foundation (Priority 1)**
- ✅ No dependencies
- ✅ Required for contract iteration
- ✅ Lightweight response

---

### Endpoint Group Usage Pattern

```typescript
// Step 1: Discover valid contracts
const chains = await fetchOptionChains({ ticker: 'AAPL', date: '2024-12-10' });

// Step 2: Parse symbols to extract expirations
const expirations = extractUniqueExpirations(chains.symbols);

// Step 3: Use expirations for other grouped endpoints
for (const expiry of expirations) {
  // Query Greeks, Contracts, etc.
}
```

---

## ⭐ Group 2: CONTRACT-LEVEL DETAILED DATA
**Purpose:** Get volume, OI, Greeks, IV for individual contracts

### Endpoints

#### 2.1 `/api/stock/{ticker}/option-contracts` ⭐ **KEY FOR OI**
**Returns:** Full contract data with VOLUME **and** OPEN INTEREST
**Parameters:**
- `ticker` (required)
- `expiry` (optional) - filter by expiration
- `option_type` (optional) - 'call' or 'put'
- `vol_greater_oi` (optional) - filter unusual activity
- `exclude_zero_vol_chains` (optional)
- `exclude_zero_oi_chains` (optional)
- `limit` (optional, default 500, max 500)
- `page` (optional) - pagination

**Dependencies:** Optionally uses expirations from Group 1
**Use Case:** Get volume AND open interest for all contracts
**Output:**
```json
{
  "option_symbol": "AAPL240202P00185000",
  "volume": 132276,
  "open_interest": 22868,
  "prev_oi": 20217,
  "implied_volatility": "0.542805337797143",
  "total_premium": "10307980.00",
  "avg_price": "0.77927817593516586531",
  "ask_volume": 56916,
  "bid_volume": 68967,
  "floor_volume": 1815,
  "sweep_volume": 12893
}
```

**Score: 🟢 Critical (Priority 1)**
- ✅ Provides VOLUME and OI (key requirement)
- ✅ Provides IV for skew calculation
- ✅ Single endpoint for comprehensive contract data
- ✅ Has filters for unusual activity (vol > OI)

---

#### 2.2 `/api/stock/{ticker}/greeks`
**Returns:** Greeks (delta, gamma, theta, vega, rho, charm, vanna) + IV
**Parameters:**
- `ticker` (required)
- `expiry` (required) ⚠️ **MUST query per expiration**
- `date` (optional)

**Dependencies:** REQUIRES expirations from Group 1
**Use Case:** Get Greeks and IV for all strikes in ONE expiration
**Output:**
```json
{
  "strike": "480.0",
  "date": "2024-01-01",
  "expiry": "2024-01-05",
  "call_delta": "0.5",
  "call_gamma": "0.0051",
  "call_volatility": "0.3",
  "put_delta": "-0.51",
  "put_gamma": "0.005",
  "put_volatility": "0.29"
}
```

**Score: 🟡 Important (Priority 2)**
- ✅ Provides IV for skew calculation
- ⚠️ Must call PER expiration (expensive)
- ⚠️ Greeks may not be needed for all use cases
- ℹ️ Alternative: Use option-contracts for IV

---

### Group 2 Scoring

| Metric | option-contracts | greeks |
|--------|------------------|--------|
| **Provides Volume** | ✅ Yes | ❌ No |
| **Provides OI** | ✅ Yes | ❌ No |
| **Provides IV** | ✅ Yes | ✅ Yes |
| **Provides Greeks** | ❌ No | ✅ Yes |
| **Single Call** | ✅ All expirations | ❌ Per expiration |
| **API Cost** | Low (1 call) | High (N calls per N expirations) |
| **Priority** | 🟢 **MUST HAVE** | 🟡 Optional (if Greeks needed) |

**Recommendation:** Use `option-contracts` as primary source for volume, OI, and IV. Only use `greeks` if you need delta/gamma/theta/vega/rho for positioning analysis.

---

## ⭐ Group 3: AGGREGATED FLOW DATA
**Purpose:** Daily aggregated options flow (already pre-computed)

### Endpoints

#### 3.1 `/api/stock/{ticker}/flow-per-expiry`
**Returns:** Aggregated call/put flow by expiration
**Parameters:**
- `ticker` (required)
- No date parameter (returns last trading day)

**Dependencies:** NONE
**Use Case:** Get daily flow summary aggregated by expiration
**Output:**
```json
{
  "ticker": "AAPL",
  "date": "2024-01-22",
  "expiry": "2024-02-16",
  "call_volume": 89177,
  "call_premium": "5839180",
  "call_volume_ask_side": 43669,
  "call_volume_bid_side": 40164,
  "call_otm_volume": 81598,
  "put_volume": 20101,
  "put_premium": "4802145",
  "put_volume_ask_side": 7396,
  "put_volume_bid_side": 8113
}
```

**Score: 🟢 Critical (Priority 1)**
- ✅ Pre-aggregated (no computation needed)
- ✅ Provides ask/bid breakdown (directional flow)
- ✅ OTM data (speculative activity)
- ✅ Single call for all expirations

---

#### 3.2 `/api/stock/{ticker}/flow-per-strike`
**Returns:** Aggregated call/put flow by strike price
**Parameters:**
- `ticker` (required)
- `date` (optional)

**Dependencies:** NONE
**Use Case:** Identify strike price concentrations
**Output:**
```json
{
  "strike": "180.0",
  "date": "2024-01-22",
  "call_premium": "9908777.0",
  "call_volume": 89177,
  "put_premium": "4802145.0",
  "put_volume": 20101
}
```

**Score: 🟡 Important (Priority 2)**
- ✅ Useful for strike concentration analysis
- ⚠️ Overlaps with flow-per-expiry (different aggregation)
- ℹ️ Use if you need strike-level granularity

---

### Group 3 Scoring

| Use Case | flow-per-expiry | flow-per-strike |
|----------|-----------------|-----------------|
| **Put/Call Ratio** | ✅ Best (by expiry) | ✅ (by strike) |
| **Expiration Analysis** | ✅ Primary | ❌ |
| **Strike Analysis** | ❌ | ✅ Primary |
| **API Cost** | Low | Low |
| **Priority** | 🟢 **MUST HAVE** | 🟡 Optional |

---

## ⭐ Group 4: UNUSUAL ACTIVITY DETECTION
**Purpose:** Pre-filtered alerts for institutional positioning

### Endpoints

#### 4.1 `/api/option-trades/flow-alerts` ⭐ **PRE-FILTERED**
**Returns:** Unusual options activity alerts
**Parameters:**
- `ticker_symbol` (optional)
- `min_premium` (optional)
- `max_premium` (optional)
- `min_size` (optional)
- `is_sweep` (optional, boolean)
- `is_floor` (optional, boolean)
- `all_opening` (optional, boolean)
- `alert_rule` (optional) - Filter by rule:
  - `RepeatedHits`
  - `FloorTradeLargeCap` / `FloorTradeMidCap` / `FloorTradeSmallCap`
  - `RepeatedHitsAscendingFill` / `RepeatedHitsDescendingFill`
  - `OtmEarningsFloor`
  - `LowHistoricVolumeFloor`
  - `SweepsFollowedByFloor`

**Dependencies:** NONE (alerts are pre-computed)
**Use Case:** Detect unusual institutional positioning
**Output:**
```json
{
  "ticker": "MSFT",
  "option_chain": "MSFT231222C00375000",
  "strike": "375",
  "expiry": "2023-12-22",
  "type": "call",
  "alert_rule": "RepeatedHits",
  "total_size": 461,
  "total_premium": "186705",
  "volume": 2442,
  "open_interest": 7913,
  "volume_oi_ratio": "0.30860609124226",
  "has_sweep": true,
  "has_floor": false,
  "has_multileg": false
}
```

**Score: 🟢 Critical (Priority 1)**
- ✅ Pre-filtered by UnusualWhales algorithms
- ✅ Volume/OI ratio included
- ✅ Sweep, floor, multileg flags
- ✅ Alert rules classify institutional activity
- ✅ Single call returns all unusual activity

---

### Group 4 Scoring

**Unusual Activity Detection Value:**
- ✅ **Volume/OI > 3x:** Automatically flagged
- ✅ **Sweep orders:** Aggressive institutional buying
- ✅ **Floor trades:** Large cap institutional activity
- ✅ **Repeated hits:** Persistent positioning

**Priority: 🟢 MUST HAVE**

---

## ⭐ Group 5: GREEK EXPOSURE (GEX) TRENDS
**Purpose:** Historical Greek exposure for trend analysis

### Endpoints

#### 5.1 `/api/stock/{ticker}/greek-exposure`
**Returns:** Historical daily aggregated GEX
**Parameters:**
- `ticker` (required)
- `date` (optional)
- `timeframe` (optional) - '1d', '5d', '1m', '3m', '6m', '1y', '5y'

**Dependencies:** NONE
**Use Case:** Track GEX trends, detect gamma flips
**Output:**
```json
{
  "date": "2023-09-08",
  "call_delta": "227549667.4651",
  "call_gamma": "9356683.4241",
  "call_vanna": "152099632406.9564",
  "put_delta": "-191893077.7193",
  "put_gamma": "-12337386.0524"
}
```

**Score: 🟡 Important (Priority 2)**
- ✅ Historical trends (30+ days)
- ✅ Useful for gamma flip detection
- ⚠️ Advanced use case (not baseline requirement)

---

#### 5.2 `/api/stock/{ticker}/greek-exposure/expiry`
**Returns:** GEX broken down by expiration
**Parameters:**
- `ticker` (required)
- `date` (optional)

**Dependencies:** NONE
**Use Case:** Identify which expirations have highest GEX
**Output:**
```json
{
  "date": "2022-05-20",
  "expiry": "2022-05-25",
  "dte": 5,
  "call_delta": "227549667.4651",
  "call_gamma": "9356683.4241"
}
```

**Score: 🔵 Optional (Priority 3)**
- ℹ️ Niche use case (expiration-specific GEX)

---

## 📊 FINAL ENDPOINT PRIORITY SCORING

### 🟢 **TIER 1: MUST HAVE** (Meets all 4 requirements)

| Endpoint | Volume | OI | IV/Skew | Unusual Activity | API Cost |
|----------|--------|----|---------| ----------------|----------|
| `/api/stock/{ticker}/option-contracts` | ✅ | ✅ | ✅ | ✅ (vol>OI filter) | Low |
| `/api/stock/{ticker}/flow-per-expiry` | ✅ | ❌ | ❌ | ⚠️ (OTM data) | Low |
| `/api/option-trades/flow-alerts` | ✅ | ✅ | ❌ | ✅ | Low |

---

### 🟡 **TIER 2: IMPORTANT** (Enhances analysis)

| Endpoint | Purpose | When to Use |
|----------|---------|-------------|
| `/api/stock/{ticker}/flow-per-strike` | Strike concentrations | Strike-level analysis |
| `/api/stock/{ticker}/greeks` | Full Greeks | Need delta/gamma/vega |
| `/api/stock/{ticker}/greek-exposure` | GEX trends | Gamma flip detection |

---

### 🔵 **TIER 3: OPTIONAL** (Advanced use cases)

| Endpoint | Purpose | When to Use |
|----------|---------|-------------|
| `/api/stock/{ticker}/option-chains` | Contract discovery | Before iterating expirations |
| `/api/stock/{ticker}/greek-exposure/expiry` | Expiry-specific GEX | Targeted GEX analysis |

---

## ✅ REQUIREMENTS VERIFICATION

### Requirement 1: Daily Options Volume (by strike/expiry)
**✅ SATISFIED**
- **Endpoint:** `/api/stock/{ticker}/option-contracts`
- **Data:** Volume per contract (includes strike and expiry)
- **Alternative:** `/api/stock/{ticker}/flow-per-expiry` (aggregated by expiry)

### Requirement 2: Open Interest (by strike/expiry)
**✅ SATISFIED**
- **Endpoint:** `/api/stock/{ticker}/option-contracts`
- **Data:** `open_interest` and `prev_oi` per contract

### Requirement 3: Put/Call Ratio (volume AND OI)
**✅ SATISFIED**
- **Volume P/C:** From `flow-per-expiry` or `option-contracts`
- **OI P/C:** From `option-contracts` (aggregate call OI vs put OI)
- **Calculation:** `put_volume / call_volume`, `put_oi / call_oi`

### Requirement 4: Unusual Activity (Volume/OI ratio >3x)
**✅ SATISFIED**
- **Endpoint:** `/api/option-trades/flow-alerts` (pre-filtered)
- **Data:** `volume_oi_ratio` field
- **Alternative:** `/api/stock/{ticker}/option-contracts` (calculate manually)
- **Filter:** `vol_greater_oi=true` parameter

### Bonus: IV Skew (Put IV vs Call IV)
**✅ SATISFIED**
- **Endpoint:** `/api/stock/{ticker}/option-contracts`
- **Data:** `implied_volatility` per contract
- **Calculation:** `put_iv - call_iv` for ATM strikes
- **Alternative:** `/api/stock/{ticker}/greeks` (per expiration)

---

## 🎯 RECOMMENDED DAILY WORKFLOW

### Minimal Workflow (Tier 1 Only)
```typescript
// 1. Get all contracts (volume + OI + IV)
const contracts = await fetchOptionContracts({ ticker: 'AAPL' });

// 2. Get aggregated flow by expiration
const flow = await fetchOptionsFlowByExpiry({ ticker: 'AAPL' });

// 3. Get unusual activity alerts
const alerts = await fetchFlowAlerts({ ticker: 'AAPL', minPremium: 50000 });

// Compute:
// - Put/Call ratio (volume and OI)
// - IV skew (from contracts)
// - Unusual activity count
// - Volume/OI ratios
```

**API Calls:** 3
**Meets All Requirements:** ✅

---

### Enhanced Workflow (Tier 1 + Tier 2)
```typescript
// Tier 1
const contracts = await fetchOptionContracts({ ticker: 'AAPL' });
const flow = await fetchOptionsFlowByExpiry({ ticker: 'AAPL' });
const alerts = await fetchFlowAlerts({ ticker: 'AAPL', minPremium: 50000 });

// Tier 2 (optional enhancements)
const gex = await fetchGreekExposure({ ticker: 'AAPL', timeframe: '1m' });

// If Greeks needed for specific expirations
const chains = await fetchOptionChains({ ticker: 'AAPL', date: '2024-12-10' });
for (const expiry of chains.expirations.slice(0, 3)) {  // Limit to 3 nearest
  await fetchGreeksForExpiration({ ticker: 'AAPL', expiry, date: '2024-12-10' });
}
```

**API Calls:** 4-7
**Provides:** GEX trends + full Greeks

---

## 📈 SCORING FRAMEWORK SUMMARY

### Group Scores

| Group | Priority | Endpoints | API Calls | Meets Requirements |
|-------|----------|-----------|-----------|-------------------|
| **Group 2 (Contracts)** | 🟢 Critical | 1 (option-contracts) | 1 | ✅ Volume, OI, IV |
| **Group 3 (Flow)** | 🟢 Critical | 1 (flow-per-expiry) | 1 | ✅ Volume aggregation |
| **Group 4 (Alerts)** | 🟢 Critical | 1 (flow-alerts) | 1 | ✅ Unusual activity |
| **Group 1 (Discovery)** | 🔵 Foundation | 1 (option-chains) | 1 | Helper for iteration |
| **Group 5 (GEX)** | 🟡 Important | 1 (greek-exposure) | 1 | Trend analysis |

### Endpoint Efficiency Ranking

1. **`/api/stock/{ticker}/option-contracts`** - 🏆 **BEST** (volume + OI + IV in one call)
2. **`/api/option-trades/flow-alerts`** - 🥈 **GREAT** (pre-filtered unusual activity)
3. **`/api/stock/{ticker}/flow-per-expiry`** - 🥉 **GOOD** (aggregated flow)
4. `/api/stock/{ticker}/greek-exposure` - 🟡 Good (historical trends)
5. `/api/stock/{ticker}/greeks` - 🟡 Okay (expensive, per-expiry)

---

## 🔑 KEY INSIGHTS

1. **`option-contracts` is the SINGLE MOST IMPORTANT endpoint** - Gets volume, OI, and IV in one call
2. **Greeks endpoint is EXPENSIVE** - Must call N times for N expirations (use sparingly)
3. **Flow alerts are PRE-FILTERED** - UnusualWhales already does the heavy lifting
4. **Volume/OI ratio >3x** - Can be filtered directly via API or computed from contracts
5. **All 4 requirements can be met with just 3 API calls** (option-contracts + flow-per-expiry + flow-alerts)

---

## 🎓 IMPLEMENTATION NOTES

- **Pagination:** Most endpoints support `limit` and `page` parameters
- **Rate Limiting:** Default 10 req/sec (check your subscription tier)
- **Date Formats:** All dates are YYYY-MM-DD
- **Numeric Values:** Most are string decimals (need `parseFloat()`)
- **Option Symbols:** Need regex parsing: `^(?<symbol>[\w]*)(?<expiry>(\d{2})(\d{2})(\d{2}))(?<type>[PC])(?<strike>\d{8})$`
- **Strike Division:** Strike in symbol is multiplied by 1000 (divide to get actual strike)
