# Macro Wealth/Money Bubble Indicator Spec (USA)

Version: **v0.1**  
Status: Draft  
Owner: Institutional Rotation Detector (IRD) – Macro Layer  
Last updated: 2025-11-20

---

## 1. Purpose and Overview

This spec defines the **Macro Wealth/Money Bubble Indicator** for the Institutional Rotation Detector (IRD) platform.

The goal is to:

1. Quantify when **US equity market wealth** is extremely high relative to the **stock of money** in the system (a "wealth/money bubble").  
2. Provide a **slow-moving macro regime signal** that historically correlates with poor long‑horizon equity returns and heightened crash risk.
3. Combine this with **wealth/inequality metrics** and basic **funding‑stress signals** to produce a composite **Bubble Fragility Score** that conditions rotation analysis and crash‑probability models.

The design is inspired by Ray Dalio’s "Equity Wealth / Total Money" framework and associated charts (1900–present) that plot:

- Equity wealth relative to money.
- Z‑scores of that ratio vs subsequent 10‑year nominal and real equity returns.
- Top‑10% income relative to bottom‑90% income.

This spec does **not** attempt to exactly reproduce Dalio’s proprietary series. Instead, it defines a public, reproducible approximation suitable for IRD.

---

## 2. Scope

### 2.1 In scope

- USA macro indicators only (initially).  
- Monthly time series from at least 1950 onward (target 1900+ if data allow).  
- Postgres schema, indicator formulas, and ETL logic to:
  - Compute **Wealth/Money Ratio** and derived Z‑scores.  
  - Ingest a **Top‑10% vs Bottom‑90% income/wealth ratio** and Z‑score it.  
  - Define a composite **Bubble Fragility Score**.  
- Integration points with IRD’s macro_state and modeling pipeline.

### 2.2 Out of scope (for v0.1)

- Non‑US markets (EU, UK, Japan, EM).  
- Direct estimation of 10‑year forward returns (we will use these indicators as features, not as stand‑alone forecasts).  
- High‑frequency recalculation (daily or intraday); v0.1 is **monthly**, optionally forward‑filled for daily use.

---

## 3. Definitions & Terminology

- **Equity Wealth (EW)**: Aggregate market value of US listed equities (public companies), in USD.
- **Money Stock (M)**: Broad stock of US money, in USD. For v0.1, this will use **M2** (seasonally adjusted) as the default.
- **Wealth/Money Ratio (WMR)**: The ratio of total US equity wealth to the money stock: `WMR_t = EW_t / M_t`.
- **Z‑Score**: Standardized value `(x - μ) / σ` relative to a chosen historical window.
- **Inverted Z‑Score**: `-Z` such that high valuation (expensive) corresponds to more negative values (mirroring Dalio’s charting convention).
- **Top‑10% Income Ratio (T10R)**: Income or wealth of the top 10% of households divided by that of the bottom 90%, at time `t`.
- **Bubble Fragility Score (BFS)**: Composite scalar in `[-∞, +∞)` that combines wealth/money bubble, inequality, and funding‑stress metrics to express macro vulnerability.

---

## 4. High‑Level Requirements

1. The system MUST compute a **monthly Wealth/Money Ratio** (`WMR_t`) back to at least 1950.
2. The system MUST compute **Z‑scores** of `WMR_t` over a fixed rolling historical window (see section 6).
3. The system MUST provide both **raw** and **inverted** Z‑scores (for convenience in modeling and charting).
4. The system SHOULD compute **percentiles** of the ratio relative to its full history to support regime thresholds (e.g., top 5%).
5. The system MUST ingest a **Top‑10% vs Bottom‑90% income/wealth ratio** and compute its Z‑score.
6. The system SHOULD define a simple initial **Bubble Fragility Score** and expose it as a feature.
7. The system MUST store indicators in Postgres tables with clear schemas and provide at least one **view** optimised for modeling consumption.
8. The system MUST be **reproducible**: given the same input series, it must re‑compute identical outputs.

---

## 5. Data Sources

### 5.1 Equity Wealth (EW_t)

Primary requirement: a time series that approximates **total market value of US equities**.

Suggested options (final choice should be documented in the implementation notes):

- **Wilshire 5000 Total Market Full Cap Index** (or a similar "total US market" index) multiplied by a scaling factor to approximate total market cap.  
- **CRSP US Total Market Cap** (if licensed data are available).  
- **Aggregate of S&P Total Market / Russell Universe** if a single "total market" series is not available.

Implementation requirement:

- Choose one canonical series `EW_raw_t` and document:
  - Provider name.  
  - Index ID/ticker.  
  - Frequency and any known revisions.  
- Normalize `EW_raw_t` into **USD**, adjusting only for splitting / index divisor logic as appropriate.

### 5.2 Money Stock (M_t)

Primary requirement: broad money for the US.

- v0.1 default: **M2** (seasonally adjusted) published by the Federal Reserve.  
- Consideration for later versions: include **M1**, **Base Money**, or **credit aggregates** to build alternative definitions.

Implementation requirement:

- Define a canonical series `M_raw_t` (monthly M2).  
- Ensure units are **billions of USD**.

### 5.3 Inequality / Top‑10% Ratio (T10R_t)

Primary requirement: a time series of income or wealth distribution for the US.

Suggested sources:

- World Inequality Database (WID) or similar series for:
  - Top 10% income share.  
  - Bottom 90% income share.

Definition:

- `T10R_t = Top10_income_t / Bottom90_income_t`

Implementation requirement:

- Choose a canonical source and document it.  
- Align frequency to **annual** or **multi‑year averages**, then map to a monthly index by forward‑filling (see section 6.4).

### 5.4 Funding‑Stress / Need‑for‑Money Metrics (optional in v0.1)

For v0.1, these are **placeholders**. Implementers may add:

- Corporate credit spreads (e.g., HY OAS).  
- Government interest expense as % of tax revenue.  
- Indicators of large new wealth‑tax proposals or similar (encoded manually or via an events table).

The Bubble Fragility Score in v0.1 MAY omit these or include a simple proxy.

---

## 6. Indicator Computation

### 6.1 Frequency and Alignment

- Base frequency for `EW_t` and `M_t` MUST be **monthly**.  
- All series MUST be aligned to **month‑end dates** (`YYYY‑MM‑01` with implicit end of month or explicit `YYYY‑MM‑DD`).  
- If a series is daily (e.g., total market cap), take the **last trading day of each month**.  
- If a series is quarterly or annual, it MUST be interpolated or forward‑filled in a deterministic way (documented in ETL).

### 6.2 Wealth/Money Ratio (WMR_t)

For each month `t`:

- Compute:

```text
WMR_t = EW_t / M_t
```

- Units: dimensionless ratio.

### 6.3 Z‑Score and Inverted Z‑Score

Define a historical window `[T0, T_end]` over which to compute statistics:

- v0.1 default: use the full available history (e.g., 1950‑present).  
- Optionally, enforce a minimum window (e.g., 30 years).

Compute:

```text
μ_W = mean(WMR_t over t in [T0, T_end])
σ_W = stddev(WMR_t over t in [T0, T_end])

Z_WMR_t = (WMR_t - μ_W) / σ_W
Z_WMR_inv_t = -Z_WMR_t
```

Properties:

- **High ratio / bubble** → `Z_WMR_t` large positive → `Z_WMR_inv_t` large negative.  
- **Low ratio / cheap** → `Z_WMR_t` large negative → `Z_WMR_inv_t` large positive.

### 6.4 Percentile Score

For each `t`, compute the empirical percentile of `WMR_t` within `[T0, T_end]`:

```text
P_WMR_t = percentile_rank(WMR_t)
```

- Range: `[0, 1]`.  
- Example: `P_WMR_t = 0.95` means that `WMR_t` is higher than 95% of historical observations.

### 6.5 Inequality Z‑Score (Z_T10R_t)

Given `T10R_t` from section 5.3:

1. Map annual values to monthly by forward‑filling within a year (e.g., 1920 annual value is applied to all months in 1920).  
2. Compute:

```text
μ_T = mean(T10R_t over t in [T0, T_end])
σ_T = stddev(T10R_t over t in [T0, T_end])

Z_T10R_t = (T10R_t - μ_T) / σ_T
```

Interpretation:

- Positive `Z_T10R_t` → inequality above long‑run average.  
- Large positive (`> +2`) → extremes similar to 1920s or 2010s+.

### 6.6 Bubble Fragility Score (BFS_t)

For v0.1, define a simple linear composite:

```text
BFS_t = w1 * Z_WMR_inv_t + w2 * Z_T10R_t
```

Where:

- `Z_WMR_inv_t` captures the **bubble** aspect (high equity wealth vs money → negative values).  
- `Z_T10R_t` captures the **wealth gap** aspect (high inequality → positive values).  
- `w1` and `w2` are scalar weights.

Initial defaults:

- `w1 = 0.7`  
- `w2 = 0.3`

Rationale:

- Emphasise the core bubble metric while still allowing inequality to tilt the score.

Future versions MAY:

- Add a `NeedForMoneyScore_t` factor and adjust to:  

```text
BFS_t = w1 * Z_WMR_inv_t + w2 * Z_T10R_t + w3 * NeedForMoneyScore_t
```

- Calibrate `(w1, w2, w3)` via backtests vs historical drawdowns.

### 6.7 Regime Buckets

For downstream use, define discrete regimes from `Z_WMR_inv_t` and `BFS_t`:

- **Wealth/Money Bubble Regimes** (from `Z_WMR_inv_t`):
  - `<= -2.0`: Extreme bubble.  
  - `(-2.0, -1.0]`: Elevated bubble.  
  - `(-1.0, +1.0]`: Neutral.  
  - `( +1.0, +2.0]`: Cheap.  
  - `> +2.0`: Crisis / extreme cheap.

- **Bubble Fragility Regime** (from `BFS_t`):
  - `>= +2.0`: Highly fragile (extreme bubble + extreme inequality).  
  - `[+1.0, +2.0)`: Fragile.  
  - `(-1.0, +1.0)`: Normal.  
  - `(-2.0, -1.0)`: Resilient.  
  - `< -2.0`: Very resilient (cheap with low inequality).

These regime labels SHOULD be materialised as categorical columns for easier use in dashboards and rules‑based logic.

---

## 7. Database Schema

### 7.1 Base Table: macro_wealth_money_indicator_monthly

Table name: `macro_wealth_money_indicator_monthly`

Columns:

- `id` – `bigserial` primary key.  
- `as_of_month` – `date` (month‑end).  
- `equity_wealth_usd` – `numeric` (or `double precision`): total US equity wealth.  
- `money_stock_usd` – `numeric`: M2 or chosen money stock.  
- `wealth_money_ratio` – `numeric`: `WMR_t`.  
- `wealth_money_z` – `numeric`: `Z_WMR_t`.  
- `wealth_money_z_inv` – `numeric`: `Z_WMR_inv_t`.  
- `wealth_money_percentile` – `numeric`: `P_WMR_t` in `[0, 1]`.  
- `top10_to_bottom90_ratio` – `numeric` (nullable): `T10R_t`.  
- `inequality_z` – `numeric` (nullable): `Z_T10R_t`.  
- `bubble_fragility_score` – `numeric` (nullable): `BFS_t`.  
- `data_version` – `text`: version tag of underlying raw data snapshot.  
- `meta` – `jsonb`: optional metadata (source IDs, quality flags, etc.).  
- `created_at` – `timestamptz` default `now()`.  
- `updated_at` – `timestamptz` default `now()`.

Indexes:

- Unique index on `(as_of_month)`.  
- B‑tree index on `(as_of_month, wealth_money_z_inv)` for range queries.

### 7.2 Daily View: macro_wealth_money_indicator_daily

Implement as a **view** or materialized view that forward‑fills monthly data:

- `as_of_date` – `date`.  
- All indicator columns forward‑filled from the most recent `as_of_month <= as_of_date`.

Use cases:

- Daily crash‑prob scoring.  
- Alignment with daily rotation metrics.

### 7.3 Integration with macro_state

Either:

- Join `macro_state_daily` / `macro_state_monthly` with `macro_wealth_money_indicator_*` views on date, or  
- Add selected columns directly into `macro_state_*` if that is the primary macro features table.

This choice is left to implementation but MUST be documented.

---

## 8. ETL Pipeline

### 8.1 Overview

A scheduled job (e.g., monthly) MUST:

1. Fetch or update raw series for `EW_t`, `M_t`, and `T10R_t`.  
2. Align frequencies and dates.  
3. Compute indicators as per section 6.  
4. Upsert into `macro_wealth_money_indicator_monthly`.

### 8.2 Steps

1. **Raw data ingestion**:
   - Download latest market cap and money series.  
   - Store in staging tables: `stg_equity_wealth_monthly`, `stg_money_stock_monthly`, `stg_inequality_annual`.

2. **Alignment**:
   - Join on month‑end dates.  
   - Forward‑fill missing months where necessary, with quality flags.

3. **Computation**:
   - Compute `WMR_t`, Z‑scores, percentiles, inequality ratio, inequality Z, and BFS.

4. **Upsert**:
   - For each `as_of_month`, upsert into `macro_wealth_money_indicator_monthly` by unique key.

5. **Post‑processing**:
   - Refresh `macro_wealth_money_indicator_daily` materialized view (if used).  
   - Log run metadata (duration, error count, data_version).

### 8.3 Error Handling

- If either `EW_t` or `M_t` is missing for a month, do **not** compute the ratio for that month; store nulls and set a quality flag in `meta`.
- If inequality data is missing, still compute wealth/money indicators but set inequality fields to null.
- The pipeline MUST fail fast if schema changes or unexpected data formats are detected.

---

## 9. Consumption & Modeling

### 9.1 Feature Naming

Model‑facing feature names SHOULD follow this convention:

- `macro_mwm_ratio` – `WMR_t`.  
- `macro_mwm_z` – `Z_WMR_t`.  
- `macro_mwm_z_inv` – `Z_WMR_inv_t`.  
- `macro_mwm_pct` – `P_WMR_t`.  
- `macro_ineq_t10r` – `T10R_t`.  
- `macro_ineq_z` – `Z_T10R_t`.  
- `macro_bubble_fragility` – `BFS_t`.  
- `macro_bubble_regime` – discrete label from `Z_WMR_inv_t`.  
- `macro_fragility_regime` – discrete label from `BFS_t`.

These should be documented in the modeling codebase so that all downstream components use consistent names.

### 9.2 Integration with RotationScore / Crash‑Prob Models

- Use `macro_mwm_z_inv` and `macro_bubble_fragility` as **conditioning variables** in:
  - Squeeze / crash probability models.  
  - Position‑sizing logic in strategy simulators.  
- Example rule of thumb:
  - When `macro_bubble_fragility >= +2.0`, limit net long exposure in crowded large‑cap names and increase weight on signals indicating institutional distribution.

### 9.3 Dashboards & Research

- Provide a timeseries chart replicating:
  - `macro_mwm_ratio` vs historical extremes.  
  - `macro_mwm_z_inv` over time with shading for regimes.  
  - `macro_bubble_fragility` overlayed with major historical drawdowns (e.g., 2000, 2008, 2020).

These visuals will help validate whether the indicator behaves as expected.

---

## 10. Testing & Validation

### 10.1 Unit Tests

- Validate numeric computations on small synthetic datasets.  
- Confirm that Z‑scores and percentiles match reference implementations.

### 10.2 Historical Sanity Checks

- Confirm that `macro_mwm_z_inv` is:
  - Highly negative in known bubble peaks (e.g., 1999‑2000, 2021).  
  - Highly positive in crisis lows (e.g., 1974, 1982, 2009).

- Confirm that `macro_ineq_z` is:
  - Elevated in the 1920s and post‑1980s era.  
  - Lower in the 1950‑1980 period.

### 10.3 Backtests

- Optional but recommended:
  - Build a simple regression of 10‑year forward real SPX returns on `macro_mwm_z_inv` and `macro_ineq_z`.  
  - Confirm that high bubble readings correlate with low subsequent returns.

### 10.4 Performance & Reliability

- The monthly pipeline should complete in seconds to minutes; there are no heavy compute requirements.

---

## 11. Security, Governance, and Documentation

- Data sources and licenses MUST be reviewed to ensure compliance (especially if using commercial index data).  
- All transformations MUST be documented in a `docs/macro_wealth_money_indicator_etl.md` file.  
- Changes to formulas or weights MUST bump the spec version (`v0.2`, etc.) and be captured in a changelog.

---

## 12. Roadmap

- **v0.1** (this spec):
  - USA‑only Wealth/Money Ratio, Z‑scores, inequality, and Bubble Fragility Score.  
  - Monthly frequency, daily forward‑fill view.

- **v0.2**:
  - Add `NeedForMoneyScore` (credit spreads, interest‑expense metrics, tax‑proposal events).  
  - Calibrate BFS weights via backtests vs drawdowns.

- **v0.3+**:
  - Extend to other major regions (EU, UK, Japan, China).  
  - Add sector‑level wealth/money metrics (e.g., Tech vs overall money).  
  - Integrate explicit 10‑year forward‑return estimators using valuation models.

This concludes `macro_wealth_money_bubble_indicator_spec_v_0_1`.