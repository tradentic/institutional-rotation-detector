# Microstructure Layer - Technical Specification

Detailed algorithms, formulas, and implementation notes for the Order Flow Microstructure Layer.

## Table of Contents

1. [Broker-Dealer Mapping Algorithm](#broker-dealer-mapping-algorithm)
2. [Flow Attribution Engine](#flow-attribution-engine)
3. [Lee-Ready Trade Classification](#lee-ready-trade-classification)
4. [VPIN (Volume-Synchronized PIN)](#vpin-volume-synchronized-pin)
5. [Kyle's Lambda (Price Impact)](#kyles-lambda-price-impact)
6. [Microstructure Score Computation](#microstructure-score-computation)
7. [Data Quality Metrics](#data-quality-metrics)
8. [Academic References](#academic-references)

---

## Broker-Dealer Mapping Algorithm

### Purpose

Map anonymous ATS venue MPIDs to institutional investors for flow attribution.

### Algorithm

**Input:** ATS venue data from `micro_offex_venue_weekly`

**Output:** Probability-scored relationships in `micro_broker_institution_map`

**Process:**

1. **Extract venue statistics** (lookback period: 365 days):
   ```typescript
   for each venue_id in ATS data:
     stats = {
       totalShares: sum(total_shares),
       totalTrades: sum(total_trades),
       weekCount: count(weeks),
       avgBlockSize: totalShares / totalTrades,
       symbols: unique(symbol)
     }
   ```

2. **Match venues to broker master:**
   ```typescript
   broker = brokerMaster[venue_id]
   if !broker: skip  // Unknown MPID
   ```

3. **Find matching institutions** (fuzzy name matching):
   ```sql
   SELECT entity_id, cik, name
   FROM entities
   WHERE name ILIKE '%{cleanBrokerName}%'
     AND kind IN ('manager', 'fund')
   ```

4. **Calculate relationship strength:**
   ```typescript
   strength = min(weekCount / 52, 0.7)  // Frequency component (max 0.7)

   // Block size boost (institutional characteristic)
   if (avgBlockSize > 50000) strength += 0.15
   else if (avgBlockSize > 20000) strength += 0.10

   // Broker type boost
   if (brokerType in ['PRIME_BROKER', 'WIREHOUSE']) strength += 0.10

   strength = min(strength, 1.0)
   ```

5. **Assign relationship type:**
   ```typescript
   type = brokerType == 'DARK_POOL' ? 'affiliate' :
          brokerType == 'WIREHOUSE' ? 'internal' :
          'prime_broker'
   ```

### Quality Metrics

- **High confidence:** `strength >= 0.8`, observations >= 26 weeks
- **Medium confidence:** `strength >= 0.6`, observations >= 12 weeks
- **Low confidence:** `strength < 0.6` or observations < 12 weeks

---

## Flow Attribution Engine

### Purpose

Attribute daily ATS flows to specific institutional investors.

### Algorithm

**Input:**
- Venue-level flows from `micro_offex_venue_weekly`
- Broker mappings from `micro_broker_institution_map`

**Output:** Attributed flows in `micro_institutional_flow`

**Process:**

1. **Filter high-confidence mappings:**
   ```sql
   SELECT * FROM micro_broker_institution_map
   WHERE relationship_strength >= minConfidence
   ```

2. **For each venue flow:**
   ```typescript
   mapping = brokerMap[venue.venue_id]
   if (!mapping) continue  // No known institution

   // Convert weekly flow to daily (5 trading days)
   dailyShares = floor(venue.total_shares / 5)

   // Create attributed flow record
   flow = {
     symbol: venue.symbol,
     trade_date: venue.week_end,
     institution_id: mapping.institution_id,
     broker_mpid: venue.venue_id,
     shares: dailyShares,
     attribution_confidence: mapping.relationship_strength
   }
   ```

3. **Infer direction** (simplified, production requires cross-referencing):
   ```typescript
   // Cross-reference with:
   // - 13F position changes
   // - Short interest changes
   // - Options activity
   // - Price movements (Lee-Ready)
   direction = inferFlowDirection(venue, mapping)
   ```

### Attribution Confidence

**Factors:**
- Broker mapping strength (primary factor)
- Position change consistency (13F verification)
- Trading pattern correlation
- Block size similarity

**Formula:**
```
confidence = mapping.relationship_strength ×
             position_consistency_factor ×
             pattern_correlation_factor
```

---

## Lee-Ready Trade Classification

### Purpose

Classify trades as buyer-initiated or seller-initiated using price tick analysis.

### Algorithm (Lee & Ready, 1991)

**Rule 1: Quote Rule**
```
if trade_price > midpoint:
  classification = 'buy'
else if trade_price < midpoint:
  classification = 'sell'
else:
  apply Rule 2 (Tick Test)
```

**Rule 2: Tick Test** (when at midpoint)
```
if trade_price > previous_trade_price:
  classification = 'buy'   // Uptick
else if trade_price < previous_trade_price:
  classification = 'sell'  // Downtick
else:
  classification = 'neutral'  // Zero tick
```

### Order Imbalance

```
OI = (V_buy - V_sell) / (V_buy + V_sell)

Range: [-1, 1]
  -1 = all sells
   0 = balanced
  +1 = all buys
```

### Implementation Notes

**Current implementation:**
- Uses aggregate flow data (simplified)
- Production requires:
  - Tick-by-tick trade data
  - NBBO (National Best Bid and Offer)
  - Microsecond timestamps

**Data sources for production:**
- TAQ (Trade and Quote) database
- NBBO feeds from SIP (Securities Information Processor)
- Exchange direct feeds

---

## VPIN (Volume-Synchronized PIN)

### Purpose

Measure the probability of informed trading (toxicity) in order flow.

### Formula (Easley, López de Prado, O'Hara, 2012)

```
VPIN = (1/n) × Σ|V_buy_i - V_sell_i| / V̄

Where:
  n = number of volume buckets
  V_buy_i = buy volume in bucket i
  V_sell_i = sell volume in bucket i
  V̄ = average volume per bucket
```

### Volume Buckets

Trades are grouped into volume buckets (not time buckets):
```
bucket_size = total_volume / num_bars
```

Each bucket contains approximately equal volume (not equal trades).

### Implementation

**Simplified (current):**
```typescript
sumAbsImbalance = 0
totalVolume = 0

for each day in lookback_period:
  buyVol = total_buy_volume
  sellVol = total_sell_volume

  sumAbsImbalance += abs(buyVol - sellVol)
  totalVolume += (buyVol + sellVol)

vpin = sumAbsImbalance / totalVolume
```

**Production (recommended):**
- Use intraday volume bars (not daily)
- Bucket size: ~50 bars of equal volume
- Rolling window: 20-50 buckets

### Interpretation

| VPIN Range | Interpretation | Action |
|------------|----------------|--------|
| 0.0 - 0.3 | Normal flow | No signal |
| 0.3 - 0.5 | Elevated informed trading | Watch |
| 0.5 - 0.7 | High toxicity | Moderate signal |
| 0.7 - 1.0 | **Extreme toxicity** | **Strong signal** |

**VPIN > 0.7:** High probability of informed institutional trading (rotation signal)

### Quality Flags

```typescript
quality = days >= 15 ? 'HIGH' :
          days >= 8  ? 'MEDIUM' :
          'LOW'
```

---

## Kyle's Lambda (Price Impact)

### Purpose

Measure price impact per unit of volume (market depth).

### Formula (Kyle, 1985)

```
λ = ΔP / ΔV

Where:
  λ (lambda) = price impact coefficient
  ΔP = price change (basis points)
  ΔV = signed volume (buy - sell)
```

### OLS Regression

```
ΔP_t = α + λ × V_signed_t + ε_t

Estimate via ordinary least squares:
  λ̂ = Cov(ΔP, V_signed) / Var(V_signed)
```

### Implementation

**Current (daily data):**
```typescript
// Collect daily observations
data = []
for each day in lookback_period:
  price_change = close_t - close_t-1
  signed_volume = total_buy_volume - total_sell_volume
  data.push({ price_change, signed_volume })

// OLS regression (simplified placeholder)
lambda = estimateOLS(data)
```

**Production (recommended):**
```typescript
// Use intraday data (5-minute bars)
for each 5min_bar:
  ΔP = midpoint_t - midpoint_t-1  // Basis points
  ΔV = signed_volume_t             // Buy - sell

// Run rolling OLS with 50-100 observations
lambda = rollingOLS(ΔP, ΔV, window=100)
standardError = sqrt(residual_variance / Σ(V_signed - V̄)²)
rSquared = 1 - (SSE / SST)
```

### Units

Lambda is expressed in **basis points per $1M volume**:
```
λ_normalized = (λ_raw × 1,000,000) / 10,000
```

### Interpretation

| Lambda | Interpretation | Implication |
|--------|----------------|-------------|
| < 5 | Very liquid | Small institutional footprint |
| 5 - 10 | Normal liquidity | Moderate impact |
| 10 - 20 | Reduced liquidity | Noticeable institutional trading |
| > 20 | **Low liquidity** | **Large institutional blocks** |

**Lambda > 20:** Strong evidence of institutional-sized trades moving the market

---

## Microstructure Score Computation

### Score Components

The microstructure score augments the base rotation score:

```typescript
r_score = base_score + (microConfidence × microScore)

where microConfidence > 0.5 for activation
```

### Microstructure Score Formula

```typescript
microScore =
  w_vpin × vpinAvg +
  w_spike × vpinSpike +
  w_lambda × normalized(lambdaAvg) +
  w_imbalance × enhanced(orderImbalanceAvg) +
  w_block × blockRatioAvg +
  w_attribution × flowAttributionScore
```

### Weights

```typescript
const WEIGHTS = {
  w_vpin: 0.6,          // Toxicity level
  w_spike: 0.8,         // Extreme event bonus
  w_lambda: 0.3,        // Price impact
  w_imbalance: 0.4,     // Sell pressure
  w_block: 0.5,         // Institutional participation
  w_attribution: 0.7    // Flow confidence
}
```

### Component Transformations

**Lambda normalization:**
```typescript
normalized(lambda) = min(lambda / 50, 1.0)

Cap at 50 bps/$1M → maps to [0, 1]
```

**Order imbalance enhancement:**
```typescript
enhanced(imbalance) = imbalance < 0 ?
  abs(imbalance) × 1.2 :  // Boost sells (rotation signal)
  abs(imbalance)          // Normal buys

capped at 1.0
```

**VPIN spike bonus:**
```typescript
vpinSpike = vpinAvg > 0.7 ? 1 : 0

Adds flat 0.8 bonus to score
```

### Confidence Gating

```typescript
if (microConfidence <= 0.5) {
  // Don't use microstructure signals
  return base_score
}

// Use microstructure with confidence weighting
return base_score + (microScore × microConfidence)
```

### Example Calculation

**Scenario:** High-toxicity institutional dump

**Inputs:**
```typescript
vpinAvg = 0.74
vpinSpike = true
lambdaAvg = 22.1
orderImbalanceAvg = -0.38  // Sell pressure
blockRatioAvg = 0.21
flowAttributionScore = 0.79
microConfidence = 0.87
```

**Calculation:**
```typescript
microScore =
  0.6 × 0.74 +                    // 0.444
  0.8 × 1 +                       // 0.800
  0.3 × min(22.1/50, 1.0) +      // 0.133
  0.4 × min(0.38 × 1.2, 1.0) +   // 0.182
  0.5 × 0.21 +                    // 0.105
  0.7 × 0.79                      // 0.553
  = 2.217

r_score_boost = 2.217 × 0.87 = 1.93

Total score increase: +1.93 points
```

---

## Data Quality Metrics

### Flow Attribution Quality

```typescript
dataCompleteness =
  (has_classification ? 0.5 : 0) +
  (flows.length > 0 ? 0.3 : 0) +
  (flows.length >= 5 ? 0.2 : 0)
```

### VPIN Quality

```typescript
vpinQuality =
  days >= 15 ? 'HIGH' :
  days >= 8  ? 'MEDIUM' :
  'LOW'
```

### Kyle's Lambda Quality

```typescript
lambdaQuality =
  (days >= 20 && rSquared > 0.3) ? 'HIGH' :
  (days >= 10 && rSquared > 0.2) ? 'MEDIUM' :
  'LOW'
```

### Overall Microstructure Confidence

```typescript
microConfidence =
  min(
    dataCompleteness × flowAttributionScore,
    1.0
  )
```

---

## Academic References

### Primary Sources

**1. VPIN - Volume-Synchronized Probability of Informed Trading**
```
Easley, D., López de Prado, M. M., & O'Hara, M. (2012).
"Flow Toxicity and Liquidity in a High-frequency World."
Review of Financial Studies, 25(5), 1457-1493.
DOI: 10.1093/rfs/hhs053
```

**Key findings:**
- VPIN predicts flash crashes with 83% accuracy
- High VPIN (>0.7) precedes abnormal returns
- Volume-synchronized buckets outperform time-based metrics

**2. Kyle's Lambda - Price Impact Model**
```
Kyle, A. S. (1985).
"Continuous Auctions and Insider Trading."
Econometrica, 53(6), 1315-1335.
DOI: 10.2307/1913210
```

**Key findings:**
- Price impact proportional to information asymmetry
- Lambda measures market depth and liquidity
- High lambda indicates informed trading

**3. Lee-Ready Trade Classification**
```
Lee, C., & Ready, M. J. (1991).
"Inferring Trade Direction from Intraday Data."
Journal of Finance, 46(2), 733-746.
DOI: 10.1111/j.1540-6261.1991.tb02683.x
```

**Key findings:**
- Quote rule + tick test achieves ~85% accuracy
- 5-second delay improves accuracy (quote staleness)
- Effective for both NYSE and Nasdaq data

### Supporting Literature

**Market Microstructure Theory:**
```
O'Hara, M. (1995).
"Market Microstructure Theory."
Blackwell Publishers, Cambridge, MA.
```

**High-Frequency Trading:**
```
Hasbrouck, J. (2007).
"Empirical Market Microstructure."
Oxford University Press.
```

**Institutional Trading:**
```
Keim, D. B., & Madhavan, A. (1997).
"Transactions Costs and Investment Style: An Inter-exchange Analysis of Institutional Equity Trades."
Journal of Financial Economics, 46(3), 265-292.
```

---

## Implementation Notes

### Production Enhancements

**1. TAQ/NBBO Integration**
```typescript
// Tick-by-tick classification
for each trade:
  midpoint = (nbbo.bid + nbbo.ask) / 2
  classification = leeReady(trade.price, midpoint, prevPrice)
```

**2. Intraday Lambda Estimation**
```typescript
// 5-minute bars
for each bar:
  ΔP = midpoint_t - midpoint_t-1
  ΔV = signed_volume_t

rollingLambda = ols(ΔP, ΔV, window=100)
```

**3. Real-Time VPIN**
```typescript
// Streaming VPIN calculation
volumeBucket = new VolumeBucket(targetSize)
vpinCalculator = new StreamingVPIN(numBuckets=50)

for each trade:
  volumeBucket.add(trade)
  if volumeBucket.isFull():
    vpinCalculator.addBucket(volumeBucket)
    vpin = vpinCalculator.compute()
```

### Calibration Parameters

**VPIN:**
- Number of buckets: 50 (standard)
- Bucket size: Total volume / num_buckets
- Lookback: 20-50 buckets (~1 week)

**Kyle's Lambda:**
- Regression window: 50-100 intraday bars
- Minimum R²: 0.20 for inclusion
- Outlier filtering: Winsorize at 1st/99th percentile

**Flow Attribution:**
- Minimum confidence threshold: 0.70
- Relationship strength decay: 10% per quarter without observations
- Re-calibration frequency: Monthly

### Error Handling

**Missing Data:**
```typescript
if (data.length < MIN_OBSERVATIONS) {
  return {
    metric: null,
    quality_flag: 'LOW',
    error: 'INSUFFICIENT_DATA'
  }
}
```

**Outliers:**
```typescript
// Winsorize extreme values
value = value > p99 ? p99 :
        value < p1  ? p1  :
        value
```

**Quality Thresholds:**
```typescript
const MIN_OBSERVATIONS = {
  vpin: 5,      // 5 days minimum
  lambda: 10,   // 10 days minimum
  flows: 3      // 3 flow observations minimum
}
```

---

## Validation Methodology

### Backtesting Framework

**1. Historical Validation (5+ years):**
```sql
SELECT
  cluster_id,
  r_score,
  micro_confidence,
  car_m5_p20
FROM rotation_events
WHERE micro_confidence > 0.7
ORDER BY r_score DESC;
```

**2. Accuracy Metrics:**
- Precision: TP / (TP + FP)
- Recall: TP / (TP + FN)
- F1 Score: 2 × (Precision × Recall) / (Precision + Recall)
- Sharpe Ratio of returns

**3. Signal Quality:**
```typescript
// Correlation analysis
correlation(micro_vpin_avg, car_m5_p20)
correlation(micro_lambda_avg, car_m5_p20)
correlation(micro_confidence, abs(car_m5_p20))
```

### A/B Testing Protocol

**Control Group:** Base scoreV4_1 (no microstructure)
**Treatment Group:** Enhanced score with microstructure

**Metrics:**
- Win rate (% profitable rotations)
- Average CAR
- Sharpe ratio
- Maximum drawdown

**Statistical Significance:**
- Minimum sample: 100 rotations per group
- Test: Two-sample t-test
- Significance level: α = 0.05

---

## Future Research Directions

### Machine Learning Integration

**1. Weight Optimization:**
```python
# Train on historical CAR outcomes
from sklearn.ensemble import GradientBoostingRegressor

X = microstructure_signals
y = car_m5_p20

model = GradientBoostingRegressor(
  n_estimators=100,
  learning_rate=0.1,
  max_depth=3
)

model.fit(X, y)
optimized_weights = model.feature_importances_
```

**2. Non-Linear Interactions:**
```python
# Feature engineering
X['vpin_x_lambda'] = X['vpin'] * X['lambda']
X['block_x_imbalance'] = X['block_ratio'] * abs(X['imbalance'])
```

**3. Confidence Intervals:**
```python
# Quantile regression for uncertainty estimation
from sklearn.ensemble import GradientBoostingRegressor

models = {
  'lower': GradientBoostingRegressor(loss='quantile', alpha=0.05),
  'median': GradientBoostingRegressor(loss='quantile', alpha=0.50),
  'upper': GradientBoostingRegressor(loss='quantile', alpha=0.95)
}
```

### Alternative Metrics

**1. Amihud Illiquidity:**
```
ILLIQ = |R_t| / V_t

Where:
  R_t = return on day t
  V_t = dollar volume on day t
```

**2. Roll Spread Estimate:**
```
spread = 2 × sqrt(-Cov(ΔP_t, ΔP_t-1))
```

**3. Corwin-Schultz High-Low Spread:**
```
spread = (2 × (e^α - 1)) / (1 + e^α)

Where α is derived from high-low price ranges
```

---

For usage guide and examples, see [Microstructure Layer Documentation](../MICROSTRUCTURE.md).
