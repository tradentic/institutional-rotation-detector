# RotationScore v5.0 — Target Specification (Roadmap)

> **⚠️ STATUS: 🔮 TARGET SPECIFICATION (NOT FULLY IMPLEMENTED)**
> **Current Implementation:** v4.1+ (Transitional) — See `/docs/specs/CURRENT_VERSION.md`
> **Target Version:** v5.0 Full Compliance
> **Implementation Plan:** `/docs/specs/V5_IMPLEMENTATION_PLAN.md`
> **Last Updated:** 2025-11-13

> **Purpose**
> Detect and score **institutional rotation clusters** where a large holder **dumps** and other whales **absorb** in the **same filing window** (primary) or the **next window** (down‑weighted), with an **End‑of‑Window (EOW) override** when the dump lands in the final 5 business days before a 13F period end. Outputs are reproducible, auditable, and provenance‑linked to accession IDs.

> **What's Implemented vs. Target:**
> - ✅ **Implemented:** 30% dump threshold, DumpZ (median/MAD), EOW multipliers, AI analysis, microstructure, options, insider transactions
> - ⏳ **Partial:** Provenance tracking, passive share calculation
> - ❌ **Not Implemented:** Float-based dump detection, buyer sufficiency gates, complete v5 test suite

---

## 0) Design principles
- **Deterministic + auditable:** All facts trace to **EDGAR accessions** (13F/13D/13G/N‑PORT) or official sources (ETF daily holdings, FINRA short interest).  
- **Cadence‑aware:** Scheduling is driven by **form rules** (13F quarterly; N‑PORT monthly/public @ M+60; 13D/13G event‑driven; ETF daily; FINRA semi‑monthly).  
- **Idempotent + de‑duplicated:** Unique keys for `filing.accession_no`, `position(filing_id, holder_id, security_id, position_type)`, and `graph_edge(src,dst,relation,asof)`.  
- **Index noise scrub:** Apply **IndexPenalty** around S&P quarterly and **Russell** (June; **June & November from 2026**).  
- **No placeholders:** If a fact can’t be verified, record **N/A** and continue.

---

## 1) Terminology & windows
**Issuer**: public company (CIK).  
**Manager**: 13F filer (CIK).  
**Security**: class under issuer (CUSIP/ticker/class_title).  
**Dump (anchor)**: a seller’s large negative Δ in holdings.  
**Same window** (13F): the **quarter** of the anchor.  
**Next window** (13F): the quarter **immediately after** the anchor.  
**13D/13G cluster**: filings with **event/file dates within ±5 business days**.  
**EOW override**: if anchor’s **date_of_event** (for 13D/13G) or **period_of_report** proximity indicates the dump lands in the **final 5 business days** before a 13F period end, treat **next‑window** weights **nearly equal** to same‑window (see §6.3).

---

## 2) Authoritative data (inputs)
- **13F‑HR / 13F‑HR/A** (quarterly): manager holdings incl. **listed options** (PUT/CALL flags); capture `period_of_report`, `filed_at`, accession.  
- **13D / 13G (+/A)** (event‑driven): capture `date_of_event`, `filed_at`, % of class if present.  
- **N‑PORT** (monthly; public ~M+60): fund positions by month end.  
- **ETF daily holdings (iShares)**: per‑fund CSV; EOD previous business day.  
- **Short interest (FINRA)**: semi‑monthly settlement; publish ~8 business days later.  
- **SEC Rule 13f‑2 aggregate (2026+)**: security‑level, **no manager names** (optional overlay).  
- **Index calendars**: **S&P U.S. indices** quarterly; **Russell** annual June (≤2025) → **June & November** (≥2026).  
- **Prices**: daily OHLCV for security + SPY (or sector ETF) for event study.

> **Cadence stamps**  
> Each filing row stores `cadence` ∈ {`quarterly`,`monthly`,`event`,`daily`}, and `expected_publish_at` per source rules. Watchers schedule on these values.

---

## 3) Event detection
### 3.1 Dump (anchor) rules
A **seller** qualifies as an anchor in a quarter **Q** if either holds:
- **Cut‑threshold**: `Δshares ≤ −30%` of the seller’s **prior stake** (same security/class), **or**  
- **Float‑threshold**: `(−Δshares) / free_float ≥ 1.0%` in Q.  

If multiple sellers meet criteria, create one anchor **per seller** (they may co‑exist in the quarter). If an anchor is linked to 13D/13G, use the **earliest public filing in the cluster** to time the event.

### 3.2 Uptake (buyers)
For a given anchor, compute buyer **uptake** over:
- **Same window**: Σ of **positive** `Δshares (% of float)` among tracked whales **in Q**.  
- **Next window**: Σ of **positive** `Δshares (% of float)` **in Q+1**.  
- Count a **new 5%+ 13D/13G** in the matching window as buyer uptake (convert to % float when reported).  

### 3.3 High‑frequency uptake (Uhf)
- From **N‑PORT** monthly points and **ETF daily holdings** (fund‑level → underlying security aggregation), compute interim demand within **Q** (same) and **Q+1** (next). Normalize to **% of float**.

### 3.4 Options overlay (Opt)
- From 13F InfoTable **listed options** deltas:  
  `Opt_same` = scaled signal of `(+Δ calls − Δ puts)` in **Q**;  
  `Opt_next`  in **Q+1**.  
- Scale to 0..1 (see §4.4) using per‑security historical distribution.

### 3.5 Short‑pressure relief (ShortRelief)
- From **FINRA** series (and **13f‑2 aggregate** when live): compute **drop** in short interest over `[anchor−5bd, anchor+10bd]`, rescale to 0..1 per security (see §4.5).  

### 3.6 Index penalty (IndexPenalty)
- For any overlap between `[anchor_Q_start, anchor_Q_end]` and **index windows** (S&P, Russell), assign penalty 0..0.5 proportional to **overlap days** and **passive weight** of buyers.

---

## 4) Feature engineering & normalization
### 4.1 Deltas & float‑normalization
Let `Δshares_iQ = shares_iQ − shares_i(Q−1)` per holder `i`.  
Let `%float_iQ = Δshares_iQ / free_float_Q` (float at Q end).  
Winsorize `%float` at **[1st, 99th]** per security to reduce outliers.

### 4.2 DumpZ (seller intensity)
Compute the seller’s **DumpZ** as the max of:  
- z‑score of `%float_iQ` (negative side), and  
- z‑score of **% cut of prior stake**.  
Z‑scores are computed per security over a rolling history (≥12 quarters), robust‑scaled (median/MAD).

### 4.3 Uptake aggregation
`U_same = Σ (%float_jQ)_{j∈buyers, %float>0}`  
`U_next = Σ (%float_j(Q+1))_{j∈buyers, %float>0}`  
Buyers must be **distinct CIKs**; group consolidated managers under the parent 13F CIK.

### 4.4 Options overlay scaling
From 13F **CALL**/**PUT** deltas (share‑equivalents when reported):  
`opt_raw_Q = max(0, ΔCALL_Q) + max(0, −ΔPUT_Q)`  
Scale `Opt_same = min(1, opt_raw_Q / P95(opt_raw_history))` (per security). Similarly for `Opt_next`.

### 4.5 ShortRelief scaling
Let `SI_t` be short interest; estimate **drop** `ΔSI = SI_pre − SI_post` around `[−5,+10]bd`.  
Scale per security: `ShortRelief = clip_0_1(ΔSI / P95(ΔSI_history))`.

### 4.6 IndexPenalty computation
For each index window `W` overlapping the anchor quarter:  
`overlap_days = |Q ∩ W|`  
`IndexPenalty = min(0.5, base_penalty * overlap_days / Q_days * passive_share)`,  
where `base_penalty` default **0.2**, and `passive_share` is the fraction of buyer uptake attributed to known **passive** vehicles (ETF/index funds). If buyer identities are mostly passive, `passive_share → 1`.

---

## 5) Signal gates
Fire a RotationScore only if **all** hold:
1) `DumpZ ≥ 1.5σ`.  
2) (`U_same > 0` **or** `U_next > 0` **or** `Uhf_* > 0` under EOW).  
3) Buyer sufficiency: **(≥2 distinct buyers)** **or** **one buyer ≥ 0.75% float**.

---

## 6) Scoring
### 6.1 Base (non‑EOW)
```
R = 2.0·DumpZ
  + 1.0·U_same + 0.85·U_next
  + 0.7·Uhf_same + 0.6·Uhf_next
  + 0.5·Opt_same + 0.4·Opt_next
  + 0.4·ShortRelief
  − IndexPenalty
```

### 6.2 Calibration notes
- Coefficients are defaults; keep them configurable.  
- Refit per universe with **cross‑validation on years**, optimizing for **Sharpe** of CAR and **hit‑rate** of time‑to‑+20%.  
- Keep **IndexPenalty** cap at **0.5**.

### 6.3 EOW override
If the dump’s **date_of_event** (13D/13G) lies within the **final 5 business days** prior to a 13F period end **or** manager’s 13F Δ implies a quarter‑end dump near EOW, then amplify **next‑window** components:
- `U_next ×= 0.95`  
- `Uhf_next ×= 0.9`  
- `Opt_next ×= 0.5`  
(Other terms unchanged.)

---

## 7) Event study (outcomes)
- **Anchor date**: earliest public filing in the cluster (prefer 13D/13G; else 13F period end).  
- **Market‑adjusted AR/CAR**: regress security vs SPY (or sector ETF) over a pre‑window to estimate `(α,β)`; compute `AR_t = r_t − (α+β·r_m,t)`; **CAR** over `[−5,+20]` trading days.  
- Report: `CAR[-5,+20]`, weekly returns `(+1,+2,+4,+8,+13w)`, **time‑to‑+20%**, **max return by week 13**, **max drawdown**.

---

## 8) AI-powered rotation analysis (v5.1 enhancement)

After computing the algorithmic R-score, the system performs **AI-powered analysis** using GPT-5 with Chain of Thought reasoning to transform raw scores into actionable trading intelligence.

### 8.1 Purpose & innovation

**The "10x Value" Feature:**
- Transforms formula-based scores into narrative explanations
- Detects anomalies beyond algorithmic thresholds
- Provides trading implications with confidence levels
- Cites specific filing accessions as evidence
- Uses Chain of Thought (CoT) for 60-80% token savings

**Why this matters:**
- Algorithmic scores tell you "what" (R-score magnitude)
- AI analysis tells you "why" and "what to do"
- Bridges the gap from signals to trading decisions

### 8.2 Analysis process (4-turn CoT)

The analysis uses a **multi-turn Chain of Thought session** where each turn builds on previous reasoning without re-processing context:

**Turn 1: Signal Quality Assessment**
- Inputs: All rotation signals (dumpZ, uptake, UHF, options, short relief, index penalty, R-score)
- Outputs: Signal strength assessment, confidence level (0-1 scale)
- Key question: "Is this genuine rotation or noise?"

**Turn 2: Anomaly Detection**
- Inputs: Provenance data (filing accessions), rotation edges, signal assessment from Turn 1
- Outputs: Anomaly score (0-10 scale), red flags
- Checks for:
  - **Timing anomalies**: Coordinated filings, end-of-window dumps
  - **Magnitude anomalies**: Unrealistic position changes, extreme Z-scores (>5)
  - **Participant anomalies**: Unusual institutional behavior
  - **Data quality issues**: Missing filings, sparse edges (<3)

**Turn 3: Narrative Generation**
- Inputs: All previous analysis + issuer information
- Outputs: 2-3 paragraph narrative with filing citations
- Format:
  - Paragraph 1: What happened (who sold, who bought, when, magnitude)
  - Paragraph 2: Why this is a rotation signal (evidence, confidence)
  - Cites filing accessions: `[0001234567-24-000123]`

**Turn 4: Trading Implications**
- Inputs: Complete analysis from all previous turns
- Outputs: Actionable guidance (3-4 bullet points)
- Provides:
  - Expected price movement direction
  - Timeline for impact (days/weeks)
  - Risk level (Low/Medium/High)
  - Recommended action: Monitor, Consider trade, Ignore

### 8.3 Anomaly scoring

**Scale:** 0-10

| Score | Interpretation | Action |
|-------|----------------|--------|
| 0-3 | Normal rotation pattern | Proceed with confidence |
| 4-6 | Mildly unusual but likely valid | Review manually |
| 7-8 | Suspicious, needs investigation | Flag for review |
| 9-10 | Likely false positive or data error | Reject or investigate data quality |

### 8.4 Suspicion flags

Automatically generated based on analysis:

| Flag | Trigger Condition | Meaning |
|------|------------------|---------|
| `HIGH_ANOMALY` | Anomaly score ≥ 7 | Unusual pattern detected |
| `EXTREME_DUMP` | dumpZ > 5 | Unrealistically large sell-off |
| `INDEX_REBALANCE` | indexPenalty > 0.5 | Likely index-driven flow |
| `LOW_CONFIDENCE` | AI confidence < 0.5 | Weak evidence for rotation |
| `SPARSE_EDGES` | Edge count < 3 | Insufficient provenance data |

### 8.5 Confidence calibration

**AI Confidence** (0-1 scale) represents the model's assessment of rotation genuineness:

- **0.8-1.0**: High confidence - strong evidence across multiple signals
- **0.6-0.8**: Moderate confidence - some supporting signals, minor concerns
- **0.4-0.6**: Low confidence - mixed signals, significant uncertainties
- **0.0-0.4**: Very low confidence - likely noise or false positive

**Calibration factors:**
- Signal consistency (all pointing same direction = higher confidence)
- Provenance completeness (more filings = higher confidence)
- Magnitude reasonableness (extreme values = lower confidence)
- Timing coherence (coordinated moves = context-dependent)

### 8.6 Model configuration

**GPT-5 Responses API:**
- Model: `gpt-5` (full reasoning capability)
- Reasoning effort: `medium` (balance quality vs. cost)
- Verbosity: `low` (concise outputs)
- Session type: `createAnalysisSession()` with CoT preservation

**Token efficiency:**
- Traditional approach: ~8,000 tokens (4 independent calls)
- CoT approach: ~2,000-3,000 tokens (context preserved)
- **Savings: 60-80%** without quality loss

### 8.7 Persistence

Analysis results are persisted to `rotation_events` table with these additional fields:

```sql
-- AI analysis fields (added in v5.1)
anomaly_score NUMERIC,           -- 0-10 scale
suspicion_flags TEXT[],           -- Array of flag strings
ai_narrative TEXT,                -- Full narrative with trading implications
trading_implications TEXT,        -- Extracted actionable guidance
ai_confidence NUMERIC             -- 0-1 scale
```

### 8.8 Example output

**Algorithmic Inputs:**
```
DumpZ: 3.2
U_same: 0.45, U_next: 0.32
R-score: 8.5
```

**AI Analysis Output:**
```
Anomaly Score: 2.5/10
Confidence: 0.82
Suspicion Flags: []

Narrative:
"Between Q1 and Q2 2024, Vanguard reduced its AAPL position by 15M shares
(1.2% of float), documented in filing [0001548474-24-003567]. This was
absorbed by BlackRock (+8M shares) and Fidelity (+5M shares) per filings
[0001086364-24-002341] and [0000315066-24-001892].

The 3.2σ dump Z-score indicates this was an unusually large position
reduction for Vanguard. Combined with strong same-quarter uptake (0.45)
and no index rebalancing concerns (penalty: 0.05), this appears to be
genuine institutional rotation with 82% confidence."

Trading Implications:
• Expected direction: Bullish (uptake absorbed dump)
• Timeline: 2-4 weeks for price stabilization
• Risk: Low (high confidence, multiple buyers)
• Action: Consider long position with tight stops
```

---

## 9) Overlaps & deconfliction
- **Multiple anchors** in a quarter: score each seller separately; buyers may contribute to multiple anchors if temporally consistent.  
- **Overlapping clusters** (13D/13G): merge filings within **±5bd** into one cluster; choose earliest public as anchor.  
- **Amendments** (13F‑HR/A, 13D/13G‑A): update positions/event dates; maintain link `amendment_of_accession`.

---

## 10) Data quality & NA handling
- Missing float → compute from latest available; if still missing, suppress `%float` features and mark **N/A**.  
- Incoherent CUSIP/ticker mapping → skip affected rows, log for remediation.  
- ETF daily gaps → forward‑fill up to **2 business days**; beyond that, exclude from `Uhf_*` for those days.

---

## 11) Outputs & storage
Write one row per scored anchor to `rotation_event`:
- Keys: `security_id`, `anchor_filing_id`, `window_same_d1/d2`, `window_next_d1/d2`, `eow_override`.
- Components: `dumpz`, `u_same`, `u_next`, `uhf_same`, `uhf_next`, `opt_same`, `opt_next`, `short_relief`, `index_penalty`, `r_score`.
- Outcomes: `car_m5_p20`, `t_to_plus20_days`, `max_ret_w13`.
- **AI Analysis (v5.1)**: `anomaly_score`, `suspicion_flags`, `ai_narrative`, `trading_implications`, `ai_confidence`.
- Provenance: list of accession IDs (seller & buyers) persisted in a side table `rotation_event_provenance(event_id, accession_no, role)`.

**GraphRAG**: emit nodes/edges per fact with `(relation, asof, weight)`; edges unique on `(src,dst,relation,asof)`.

**Sankey JSON** (for UI/API): balanced seller→buyers per cluster with **Other Absorption / Unobserved Seller** to reconcile totals.

---

## 12) Scheduling & freshness
- **Watchers**:
  - `edgarSubmissionsPoller` (per CIK) → near‑real‑time 13F/13D/13G arrivals.
  - `nportMonthlyTimer` → fetch at **M+60**.
  - `etfDailyCron` → business‑day EOD.
  - `finraShortPublish` → on FINRA publish dates.
  - `form4DailyCron` → daily at market close (Form 4 insider transactions).
  - `unusualOptionsActivityCron` → daily EOD (unusual options activity detection).
- Stamp `filing.cadence`, `expected_publish_at`; expose `/api/due?date=` for "what should publish today".

---

## 13) Pseudocode
```pseudo
for each security S in quarter Q:
  sellers = holders with Δshares% triggering dump rules
  for each seller h in sellers:
    anchor = earliest_public_filing_in_cluster(S, h, Q)
    U_same = sum_pos_float_deltas(S, buyers, Q)
    U_next = sum_pos_float_deltas(S, buyers, Q+1)
    Uhf_same, Uhf_next = hf_uptake_from_nport_etf(S, Q, Q+1)
    Opt_same, Opt_next = options_overlay_from_13F(S, Q, Q+1)
    ShortRelief = scaled_short_drop(S, anchor)
    IndexPenalty = penalty_from_index_windows(S, Q)
    DumpZ = compute_dumpz(S, h, Q)
    if eow_condition(anchor): apply_next_window_boost()
    if gates_pass(DumpZ, U_same, U_next, Uhf_*):
      R = weighted_sum(DumpZ, U_*, Uhf_*, Opt_*, ShortRelief, IndexPenalty)
      outcome = event_study(S, anchor)

      # v5.1: AI-powered analysis
      ai_analysis = analyze_rotation_event_with_gpt5(
        cluster_id, issuer_cik,
        signals={DumpZ, U_same, U_next, Uhf_*, Opt_*, ShortRelief, IndexPenalty, R}
      )

      persist_rotation_event(S, anchor, components, R, outcome, ai_analysis, accessions)
```

---

## 14) Acceptance tests
1) **EOW override** raises next‑window influence without changing same‑window terms.
2) **IndexPenalty** increases with overlap days and passive buyer share; capped at 0.5.
3) **Idempotence**: reprocessing Q yields no duplicate filings/positions/edges/events.
4) **Reuse**: manager‑first ingest enables issuer‑first analysis with zero refetch (accessions reused).
5) **Gates**: no score emitted when buyer sufficiency fails.
6) **Event study**: CAR matches fixture series within tolerance; regression uses pre‑window only (no look‑ahead).
7) **Provenance**: every event row lists all contributing accessions.
8) **AI Analysis (v5.1)**: anomaly score (0-10), confidence (0-1), and narrative are populated for all rotation events; suspicion flags match trigger conditions; analysis cites filing accessions from provenance data.

---

## 15) Tunables (config)
- Thresholds: dump %cut (**30%**), %float (**1.0%**), buyer single‑name ≥ **0.75% float**.  
- Weights: `[2.0, 1.0, 0.85, 0.7, 0.6, 0.5, 0.4, 0.4]` as defaults (DumpZ, U_same, U_next, Uhf_same, Uhf_next, Opt_same, Opt_next, ShortRelief).  
- IndexPenalty cap **0.5**; base_penalty **0.2**.  
- Z‑score window: ≥ **12 quarters**; robust (median/MAD).  
- Winsorization: `%float` deltas at **1st/99th** percentiles per security.

---

## 15) Extensions (optional)
- **Liquidity/ADV scaling**: dampen small‑cap extremes by ADV‑based normalization.  
- **Borrow fee / FTD overlay**: if public series available, add to ShortRelief.  
- **Sector‑neutral CAR**: use sector ETF instead of SPY when appropriate.  
- **Community amplification**: boost R slightly if anchor seller is a high‑centrality node in graph communities.

---

## 16) Compliance & fairness
- Respect SEC fair‑access (≤10 rps, real User‑Agent).  
- Do not infer identities from **13f‑2** aggregates (no manager names).  
- Keep an audit log of fetches, parse steps, and any suppressed facts with reasons.

---

## 17) Versioning
- **v4.1** (prior): baseline weights; same components.  
- **v5.0** (this spec): formalized cadence stamps, robust scaling guidance, clearer index penalty, explicit provenance schema, and acceptance test suite.

