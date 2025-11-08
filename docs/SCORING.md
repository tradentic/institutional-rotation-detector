# Scoring & Microstructure Overlays

## RotationScore Recap

RotationScore remains anchored on dump events detected from 13F flow (`rotationDetectWorkflow`) with event-study overlays produced by `eventStudyWorkflow`. Outcomes continue to include:

- `car_m5_p20`
- `tt_plus20_days`
- `max_ret_w13`

## Flip50 (Experimental Microstructure Trigger)

Flip50 flags the **first** daily off-exchange percentage (`micro_offex_ratio` with `granularity='daily'`) that drops **below 50%** after at least `N` consecutive trading days at or above 50%. Default `N = 20`.

Workflow: `flip50DetectWorkflow`

- Pulls daily ratios via `micro.compute.activities.loadDailySeries`.
- Requires provenance-aware ratios (`quality_flag` retained in events).
- Emits `micro_flip50_events` and immediately launches an `eventStudyWorkflow` (if CIK/ticker context is provided) to compute CAR and augmented covariates.

## Event Study Covariates

The event-study activity (`compute.activities.eventStudy`) now enriches each run with microstructure covariates before persisting to `micro_event_study_results` via `micro.compute.activities.upsertEventStudyResult`:

- **Off-exchange series (`offex_pct`)** for offsets `t-1 ... t+20` (stored in `offex_covariates`).
- **Short-interest change** around publication (`short_interest_covariate`).
- **IEX share of total volume** when consolidated totals are present (`iex_share`).

These covariates feed downstream analytics (regressions, overlays) without altering the public RotationScore API.
