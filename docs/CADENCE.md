# Data Cadence Overview

| Dataset | Workflow | Cadence | Notes |
|---------|----------|---------|-------|
| FINRA OTC Transparency (ATS & non-ATS) | `finraOtcWeeklyIngestWorkflow` | Weekly (report week end) | Pulls ATS + non-ATS venue files, aggregates into `micro_offex_symbol_weekly`, and recomputes ratios via `offexRatioComputeWorkflow`. |
| Off-exchange ratio computation | `offexRatioComputeWorkflow` | Weekly (official), Daily (derived) | Weekly official percentages require consolidated totals; daily approximations are flagged `approx` or `iex_proxy`. |
| IEX HIST matched volume | `iexDailyIngestWorkflow` | Daily (T+1 business days) | Provides on-exchange proxy for daily ratios. |
| FINRA Short Interest | `shortInterestIngestWorkflow` | Semi-monthly (15th + month-end settlement) | Publication is ~8 business days after settlement; calendar generated in `shortinterest.activities.ts`. |
| Flip50 detector | `flip50DetectWorkflow` | Daily (trigger-based) | Evaluates daily off-exchange ratios to emit first cross below 50% after ≥20-day streak. |

All workflows stamp Temporal Search Attributes (`Dataset`, `Granularity`, `WeekEnd`/`TradeDate`, `RunKind`, `Symbol`) for observability and use activity-level rate limiting for external calls.
