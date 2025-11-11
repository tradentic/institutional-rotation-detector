# Repo ↔ RotationScore v5.0 Audit
_Date: 2025‑11‑08_

This audit compares the **latest `main`** of `tradentic/institutional-rotation-detector` to **RotationScore v5.0 — Full Specification (2025‑11‑08)**. It flags **gaps/divergences**, and proposes **fixes** and **acceptance tests** aligned to v5.

---

## Executive summary

**Green:** core ingest/analysis workflows, GraphRAG concepts, REST endpoints mentioned, Temporal & Supabase scaffolding.  
**Amber:** Search Attributes usage across every workflow; provenance storage; index‑window rules; event‑study details; tests & CI.  
**Red (key divergences vs v5):** Dump threshold in README (5% cut) ≠ v5 (≥30% cut or ≥1.0% float); watcher workflows not documented as first‑class; EOW override multipliers not confirmed; IndexPenalty definition/cap not locked; `rotation_event` + `rotation_event_provenance` DDL not verified.

---

## High‑impact divergences (spec → repo)

1) **Dump rule mismatch (critical):**
   - **Spec v5:** Anchor seller qualifies if **Δ ≤ −30% of prior stake** or **(−Δ)/float ≥ 1.0%** in quarter.  
   - **Repo README:** “Dump Detection: Identifies large institutional sell‑offs (**>5% position reduction**).”  
   - **Effect:** A 5% cut would trigger many false/weak anchors; scoring/calibration will drift.  
   - **Action:** Update detection code & docs to v5 thresholds; add fixtures for edge cases.

2) **Watcher workflows missing/underdocumented:**
   - **Spec v5:** `edgarSubmissionsPoller`, `nportMonthlyTimer`, `etfDailyCron`, `finraShortPublish` drive **cadence** & `expected_publish_at`.  
   - **Repo:** Only core analysis workflows are listed publicly; watchers are not.
   - **Action:** Implement/document watchers; ensure each sets Search Attributes (Ticker, CIK, Form, Cadence, ExpectedPublish, PeriodEnd, WindowKey, BatchId, RunKind).

3) **EOW override multipliers not confirmed:**
   - **Spec v5:** If anchor lands in last **5 business days** pre‑13F period end, apply **next‑window boosts**: `U_next×0.95`, `Uhf_next×0.9`, `Opt_next×0.5`.  
   - **Repo:** No explicit confirmation.  
   - **Action:** Add `eow_condition()` + multiplier application + tests (see §Acceptance).

4) **IndexPenalty formalization:**
   - **Spec v5:** Proportional to **overlap_days/Q_days×passive_share**, `base_penalty=0.2`, **cap=0.5**; **Russell**: **annual June ≤2025, June+Nov ≥2026**.  
   - **Repo:** Index windows & Russell rule‑change are not verified.  
   - **Action:** Seed calendars; compute passive_share; enforce cap; add tests for 2026+.

5) **Provenance & outputs:**
   - **Spec v5:** Persist **`rotation_event`** with components/outcomes and **`rotation_event_provenance`** with accession roles.  
   - **Repo:** DDL presence unverified; REST `/api/graph/explain` must enforce ≤25‑word quote rule.  
   - **Action:** Ensure migrations for both tables; wire explain limits & provenance.

---

## Compliance matrix (v5 → repo)

**Legend:** ✅ aligned · ⚠️ partial/unverified · ❌ missing/divergent

### Detection & features
- **DumpZ:** robust z‑score (median/MAD); threshold **≥1.5σ** → **⚠️** (thresholds referenced in spec; not confirmed in code).
- **U, Uhf, Opt, ShortRelief:** defined in spec; ETF/N‑PORT integration implied → **⚠️** (need code proof & scaling per P95 histories).
- **IndexPenalty (cap 0.5):** rule defined; Russell 2026+ semi‑annual → **⚠️** (seed & compute passive_share).
- **EOW override multipliers:** **❌** not confirmed.

### Gates (must all hold)
- **DumpZ ≥ 1.5σ**; **buyers ≥2** or one **≥0.75% float**; **some uptake** in same/next/Uhf (EOW) → **⚠️** (gate logic not surfaced).

### Event study
- **Anchor selection**: earliest 13D/13G in cluster else 13F period end → **⚠️** (confirm).  
- **Market‑adjusted AR/CAR**: pre‑window regression, CAR[−5,+20], t→+20d, weekly returns, max drawdown → **⚠️** (confirm stored fields).

### Storage & API
- **Tables:** `rotation_event`, `rotation_event_provenance`, `graph_*`, `index_window`, `short_interest`, optional `doc_chunk` → **⚠️** (DDL unverified).  
- **API:** `/api/run`, `/api/events`, `/api/graph`, `/api/graph/paths`, `/api/graph/communities`, `/api/graph/explain`, `/api/due` → **⚠️** (routes unverified; enforce explain quote limit).

### Scheduling
- **Watchers + cadence stamps:** `filing.cadence`, `expected_publish_at`, `/api/due?date=` → **❌/⚠️** (watchers missing in docs; stamps unverified).

### GraphRAG
- **Communities persisted** + summaries; **Sankey JSON** reconciliation (Other Absorption/Unobserved Seller) → **⚠️** (verify persistence, JSON shape).

### Quality gates
- **Idempotence & determinism tests**; **Search Attributes** registration & assertion in CI; **no HTTP in workflows** → **❌/⚠️** (test/CI presence unclear).

---

## Concrete fixes (PR‑ready checklist)

**Detection & scoring**
- [ ] Replace 5% cut rule with v5: **cut ≥30%** _or_ **floatΔ ≥1.0%**.  
- [ ] Implement `compute_dumpz()` (median/MAD z over ≥12 quarters).  
- [ ] Add gates: `DumpZ≥1.5σ` AND (`buyers≥2` OR `topBuyer≥0.75% float`) AND (`U_same>0` OR `U_next>0` OR `Uhf_*>0` under EOW).  
- [ ] Implement EOW multipliers; persist `eow_override` flag.

**High‑frequency & overlays**
- [ ] N‑PORT (M+60) loader; ETF iShares EOD aggregator → `%float` normalization; P95 scaling for Opt & ShortRelief.

**Index & calendars**
- [ ] Seed S&P quarterly windows; **Russell** (June only ≤2025; **June+Nov ≥2026**).  
- [ ] Compute `passive_share` from buyer identities; enforce `IndexPenalty≤0.5`.

**Schema & provenance**
- [ ] Migrations for: `rotation_event`, `rotation_event_provenance`, `index_window`, `short_interest`, optional `doc_chunk` (pgvector).  
- [ ] `/api/graph/explain` to enforce ≤25‑word quotes; persist accession list.

**Watchers & SAs**
- [ ] Implement: `edgarSubmissionsPoller`, `nportMonthlyTimer`, `etfDailyCron`, `finraShortPublish`.  
- [ ] Every workflow sets SAs: `Ticker, CIK, Form, Accession, Cadence, ExpectedPublish, PeriodEnd, WindowKey, BatchId, RunKind`.

**Testing & CI**
- [ ] Add fixtures covering: EOW override, IndexPenalty behavior, idempotence (re‑run quarter), reuse (manager→issuer), gates, event‑study correctness, provenance completeness.  
- [ ] CI: lint, type, migrations dry‑run, tests, SA registration assert.

---

## Acceptance tests (from v5, restated)
1) **EOW override:** Next‑window components boosted (0.95, 0.9, 0.5) without altering same‑window; `eow_override=true` stored.  
2) **IndexPenalty:** Increases with overlap_days and passive_share; capped at 0.5; Russell semi‑annual from 2026+.  
3) **Idempotence:** Reprocessing same quarter yields no duplicates.  
4) **Reuse:** Manager‑first ingest supplies issuer‑first analysis with zero refetch.  
5) **Gates:** No score emitted when buyer sufficiency fails.  
6) **Event study:** CAR[−5,+20] matches fixture; regression pre‑window only.  
7) **Provenance:** Event includes all contributing accessions with roles.

---

## What I need to flip remaining items to ✅
- A `db/migrations` tree listing (or paste).  
- `apps/temporal-worker/src/workflows` + `src/activities` tree.  
- Any existing `tests` or CI workflow files.  

Once available, I’ll turn this into concrete PR diffs (scoring module, watchers, DDL, tests).

