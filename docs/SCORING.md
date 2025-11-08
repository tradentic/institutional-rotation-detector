# Rotation Scoring & Microstructure Signals

This document describes the scoring methodology for rotation detection and microstructure-based trading signals, including the new Flip50 detector.

## Overview

The Institutional Rotation Detector uses multi-factor scoring to identify and rank institutional rotation events. The system now includes microstructure signals (off-exchange percentage, short interest) as additional event-study covariates and standalone trading triggers.

---

## Core Rotation Score (v4.1)

**Workflow:** `rotationDetectWorkflow`
**Output:** `r_score` in `rotation_events` table

The rotation score combines multiple signals to identify meaningful institutional "dump" events:

### Components

| Factor | Weight | Description |
|--------|--------|-------------|
| **dumpZ** | High | Magnitude of selling (Z-score of position reduction) |
| **u_same** | Medium | Uptake in same quarter (institutional buying) |
| **u_next** | Medium | Uptake in next quarter (delayed institutional buying) |
| **uhf_same** | Low | Ultra-high-frequency trader activity (same quarter) |
| **uhf_next** | Low | Ultra-high-frequency trader activity (next quarter) |
| **opt_same** | Low | Options overlay activity (same quarter) |
| **opt_next** | Low | Options overlay activity (next quarter) |
| **shortrelief_v2** | Medium | Short interest relief signal |
| **index_penalty** | Negative | Penalty for index-driven rotation (Russell reconstitution) |
| **eow** | Boolean | End-of-week (Friday) dump flag |

### Formula

```
r_score = (
  α₁ · dumpZ +
  α₂ · u_same +
  α₃ · u_next +
  α₄ · uhf_same +
  α₅ · uhf_next +
  α₆ · opt_same +
  α₇ · opt_next +
  α₈ · shortrelief_v2
) - index_penalty
```

**Thresholds:**
- High-confidence rotation: `r_score > 10`
- Medium-confidence rotation: `5 < r_score ≤ 10`
- Low-confidence rotation: `r_score ≤ 5`

### Event Study Metrics

**Workflow:** `eventStudyWorkflow`
**Anchor Date:** Filing date or period end date of rotation event

For each rotation event, the system computes:

| Metric | Description |
|--------|-------------|
| **car_m5_p20** | Cumulative abnormal return from -5 to +20 days |
| **max_ret_w13** | Maximum return in 13-week window |
| **t_to_plus20_days** | Days to reach +20% threshold (if achieved) |

**Event Window:**
- Pre-event: [-5, 0] days
- Post-event: [0, +20] days for daily CAR
- Extended: +1/+2/+4/+8/+13 weeks for longer-term outcomes

---

## Microstructure Signals

### Off-Exchange Percentage (Official & Approximated)

**Data Source:** FINRA OTC Transparency (weekly official) + IEX HIST (daily proxy)
**Table:** `micro_offex_ratio`
**Quality Flags:**
- `official`: FINRA week + full consolidated week
- `official_partial`: FINRA week only
- `approx`: Daily apportion with consolidated daily
- `iex_proxy`: Daily apportion with IEX matched shares

**Interpretation:**

| Off-Exchange % | Market Interpretation |
|----------------|----------------------|
| > 60% | Extremely high off-exchange activity; potential dark pool accumulation or retail flow internalization |
| 50-60% | High off-exchange activity; often seen in "meme stocks" or high retail interest |
| 40-50% | Above-average off-exchange; normal for many large-cap stocks |
| 30-40% | Average off-exchange percentage for most equities |
| < 30% | Low off-exchange; primarily on-exchange trading |

**Event-Study Integration:**
Off-exchange percentage is now available as a covariate in event studies. For each rotation event, the system can compute:
- Average `offex_pct` in [-5, 0] days before the event
- Change in `offex_pct` from pre-event to post-event window
- Correlation between `offex_pct` and returns

**Usage:**
```sql
-- Get off-exchange % for GME around a rotation event (anchor = 2024-10-15)
SELECT as_of, offex_pct, quality_flag
FROM micro_offex_ratio
WHERE symbol = 'GME'
  AND granularity = 'daily'
  AND as_of BETWEEN '2024-10-10' AND '2024-11-05'
ORDER BY as_of;
```

---

## Flip50 Detector

**Workflow:** `flip50DetectWorkflow`
**Table:** `micro_flip50_events`
**Status:** Experimental microstructure trigger

### Definition

A **Flip50 event** occurs when off-exchange percentage crosses **below 50%** after being **above 50%** for **≥N consecutive trading days** (default N=20).

### Hypothesis

Sustained high off-exchange percentage (≥50%) may indicate:
- Heavy retail flow internalization
- Dark pool accumulation by institutional buyers
- Payment-for-order-flow routing patterns

A "flip" below 50% may signal:
- Shift from off-exchange to on-exchange trading (increased transparency)
- Potential exhaustion of retail buying pressure
- Transition from accumulation to distribution phase
- Regulatory or market structure changes

### Detection Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `lookbackDays` | 90 | Number of days to scan for events |
| `consecutiveDaysThreshold` | 20 | Minimum consecutive days ≥50% before flip |

### Output Fields

| Field | Description |
|-------|-------------|
| `flip_date` | Date when `offex_pct` first dropped below 50% |
| `pre_period_start` | Start date of the ≥50% run |
| `pre_period_days` | Number of consecutive days ≥50% before flip |
| `pre_avg_offex_pct` | Average `offex_pct` during the pre-period |
| `flip_offex_pct` | `offex_pct` on the flip date |
| `quality_flag` | Inherited from `micro_offex_ratio` (approx/iex_proxy) |

### Event-Study Integration

Flip50 events can trigger event-study workflows automatically (optional). The system:

1. Detects Flip50 event (e.g., GME on 2024-10-20)
2. Creates event record in `micro_flip50_events`
3. Optionally spawns `eventStudyWorkflow` with anchor date = flip_date
4. Computes CAR[-5,+20] around the flip date
5. Stores results in `micro_flip50_event_studies`

**Linked Table:** `micro_flip50_event_studies`

| Field | Description |
|-------|-------------|
| `flip50_id` | Foreign key to `micro_flip50_events` |
| `rotation_event_id` | Optional link to `rotation_events` if overlaps |
| `study_status` | `pending`, `running`, `completed`, `failed` |
| `car_m5_p20` | Cumulative abnormal return [-5, +20] |
| `max_ret_w13` | Maximum 13-week return post-flip |
| `t_to_plus20_days` | Days to +20% threshold (if achieved) |

### Example: GME Flip50 Event

**Scenario:**
- GME trades with 52-58% off-exchange from Sep 1 - Oct 15 (30+ consecutive days)
- On Oct 16, off-exchange drops to 48%
- Flip50 event detected!

**Event Record:**
```json
{
  "symbol": "GME",
  "flip_date": "2024-10-16",
  "pre_period_start": "2024-09-01",
  "pre_period_days": 32,
  "pre_avg_offex_pct": 0.548,
  "flip_offex_pct": 0.480,
  "quality_flag": "iex_proxy"
}
```

**Event Study (if triggered):**
```json
{
  "flip50_id": 123,
  "study_status": "completed",
  "car_m5_p20": -0.08,
  "max_ret_w13": -0.12,
  "t_to_plus20_days": null
}
```

**Interpretation:** In this example, the flip below 50% preceded a -8% CAR over the next 20 days, supporting the hypothesis that sustained high off-exchange % was a contrarian indicator.

### Usage

**Detect Flip50 Events:**
```bash
temporal workflow start \
  --task-queue rotation-detector \
  --type flip50DetectWorkflow \
  --input '{
    "symbol": "GME",
    "lookbackDays": 90,
    "consecutiveDaysThreshold": 20,
    "triggerEventStudy": true
  }'
```

**Query Flip50 Events via API:**
```bash
curl "http://localhost:3000/api/micro/flip50?ticker=GME&from=2024-01-01&to=2024-12-31"
```

**Response:**
```json
[
  {
    "id": 123,
    "symbol": "GME",
    "flip_date": "2024-10-16",
    "pre_period_start": "2024-09-01",
    "pre_period_days": 32,
    "pre_avg_offex_pct": 0.548,
    "flip_offex_pct": 0.480,
    "quality_flag": "iex_proxy",
    "study": {
      "study_status": "completed",
      "car_m5_p20": -0.08,
      "max_ret_w13": -0.12,
      "t_to_plus20_days": null
    }
  }
]
```

---

## Short Interest as Event-Study Covariate

**Data Source:** FINRA Short Interest (semi-monthly)
**Table:** `micro_short_interest_points`
**Cadence:** 15th and month-end settlement dates

Short interest data is now available as a covariate in event studies. For each rotation event, the system can compute:

- **Short interest level** at nearest publication before the event
- **Short interest change** from previous publication
- **Days to cover** (short_interest / avg_daily_volume)

**Usage in Scoring:**

The existing `shortrelief_v2` factor in the rotation score already incorporates short interest relief signals. The new microstructure tables provide:

1. **Explicit publication dates** (for timeline accuracy)
2. **Days-to-cover metric** (for liquidity context)
3. **Symbol-level granularity** (vs. CIK-level in legacy table)

**API Query:**
```bash
curl "http://localhost:3000/api/micro/short-interest?ticker=GME&from=2024-01-01&to=2024-12-31"
```

**Response:**
```json
[
  {
    "symbol": "GME",
    "settlement_date": "2024-10-31",
    "publication_date": "2024-11-02",
    "short_interest": 45000000,
    "avg_daily_volume": 5000000,
    "days_to_cover": 9.0
  }
]
```

---

## Combining Rotation Score with Microstructure Signals

### Enhanced Event Filter

You can now filter rotation events by microstructure conditions:

**Example: High rotation score + Flip50 event**
```sql
SELECT re.*, flip.*
FROM rotation_events re
JOIN micro_flip50_events flip
  ON re.issuer_cik = (SELECT cik FROM entities WHERE ticker = flip.symbol)
  AND ABS(DATE_PART('day', re.anchor_filing::date - flip.flip_date)) < 30
WHERE re.r_score > 10
  AND flip.pre_period_days >= 20
ORDER BY re.r_score DESC;
```

### Multi-Signal Dashboard

A comprehensive rotation + microstructure view:

| Symbol | Rotation Score | CAR[-5,+20] | Flip50 Date | Pre-Period Days | Avg Off-Ex % | Short Interest (M shares) |
|--------|----------------|-------------|-------------|-----------------|--------------|---------------------------|
| GME | 15.2 | -0.08 | 2024-10-16 | 32 | 54.8% | 45.0 |
| AMC | 12.1 | +0.03 | 2024-09-22 | 25 | 58.3% | 120.5 |

---

## Scoring Improvements and Roadmap

### Current Limitations

1. **Flip50 is experimental:** The 50% threshold and 20-day window are heuristic, not statistically validated across a large sample.
2. **IEX proxy quality:** Daily off-exchange approximations using IEX matched shares are lower quality than consolidated tape data.
3. **No intraday signals:** All microstructure signals are daily or weekly aggregates.

### Future Enhancements

1. **Statistical validation:** Backtest Flip50 across 500+ symbols and 5+ years to validate predictive power.
2. **Dynamic thresholds:** Machine learning to learn optimal `offex_pct` thresholds per symbol (vs. hard 50%).
3. **Regime detection:** Identify structural breaks in off-exchange patterns (e.g., due to regulatory changes).
4. **Intraday microstructure:** If consolidated tape access is obtained, add intraday off-exchange spikes.
5. **Combined scoring:** Train a unified model with rotation factors + microstructure features.

---

## References

- Rotation Detection: `ROTATION_DETECTION.md`
- Data Sources: `DATA_SOURCES.md`
- Event-Study Methodology: `WORKFLOWS.md#eventStudyWorkflow`
- FINRA OTC Transparency: https://www.finra.org/filing-reporting/otc-transparency
