# Master Coding Agent Prompt — Institutional Rotation Detector (from‑scratch build, v1.0)

## Role & Mindset
You are a senior engineer tasked with building, from scratch, a **production‑grade Institutional Rotation Detector** that ingests authoritative regulatory data, constructs a **time‑aware knowledge graph**, computes **rotation signals**, and exposes **query + explain** capabilities. The system must be **deterministic, auditable, and idempotent**. All network I/O happens in **Temporal Activities**; **Workflows** remain deterministic and scalable (Search Attributes, Child Workflows, Continue‑As‑New). Use **Supabase Postgres** (with optional **pgvector**) as the canonical store. **No placeholders**. If data cannot be verified, mark it **N/A**.

---

## Vision & Goals
- **Vision:** Detect and explain **rotation clusters** where a large holder **dumps** and other whales **absorb** in the **same filing window** (primary) or **next window** (slightly down‑weighted), with an **End‑Of‑Window (EOW) override** when the dump lands in the final 5 business days of a quarter.
- **Goal:** Provide a durable pipeline that supports **Issuer‑first** (ticker/name/CIK) and **Manager‑first** (name/CIK) ingests, re‑using filings across runs without re‑fetch. Build a **GraphRAG** index to answer cross‑ticker/manager questions and a **long‑context explainer** to synthesize findings with provenance.

**North‑star outcomes**
1) High‑confidence rotation detections with **RotationScore v4.1** and event‑study metrics.
2) A **local, growing graph** of filings → positions → rotations (no manual stitching).
3) Fast reuse across queries: ingest **BlackRock** once; later **IRBT** uses those filings without refetch.

---

## Non‑Functional Principles
- **Deterministic orchestration** (Temporal): workflows pure, activities do I/O.
- **Provenance‑first**: every conclusion ties back to **accession IDs** and specific rows.
- **Idempotence & de‑duplication**: key uniqueness constraints across filings, positions, and graph edges.
- **Cadence awareness**: schedule watchers by **form rules**, not by field names.
- **Security & fairness**: SEC fair‑access limits, clear UA; no scraping beyond permitted endpoints.

---

## Tech Stack
- **Runtime:** Node.js (TypeScript)
- **Orchestration:** Temporal (TypeScript SDK) — Search Attributes, Child Workflows, Continue‑As‑New
- **DB:** Supabase Postgres (+ **pgvector** for snippet retrieval; optional Timescale partitioning)
- **API:** Fastify/Express (TypeScript) under `apps/api`
- **LLM (optional):** OpenAI **Responses API** for long‑context synthesis (explanations only)
- **Testing:** Vitest/Jest + TS
- **CI:** Lint, type‑check, migrations dry‑run, unit tests, Temporal SA assert

---

## Repository Layout (generate)
```
apps/
  temporal-worker/
    src/
      workflows/
        edgarSubmissionsPoller.workflow.ts
        nportMonthlyTimer.workflow.ts
        etfDailyCron.workflow.ts
        finraShortPublish.workflow.ts
        ingestIssuer.workflow.ts
        ingestManager.workflow.ts
        ingestQuarter.workflow.ts
        rotationDetect.workflow.ts
        eventStudy.workflow.ts
        graphBuild.workflow.ts
        graphSummarize.workflow.ts
        graphQuery.workflow.ts
      activities/
        edgar.activities.ts
        nport.activities.ts
        etf.activities.ts
        finra.activities.ts
        compute.activities.ts
        sankey.activities.ts
        graph.activities.ts
        graphrag.activities.ts
        longcontext.activities.ts
      lib/
        secClient.ts
        rateLimit.ts
        schema.ts
        entityResolve.ts
        cusipMap.ts
        scoring.ts
        indexCalendar.ts
        openai.ts
        graph.ts
      __tests__/
        idempotence.test.ts
        reuse-manager-issuer.test.ts
        eow-index-penalty.test.ts
        event-study.test.ts
        longcontext-bundle.test.ts
    package.json
    tsconfig.json
    temporal.config.ts
    .env.example

apps/
  api/
    routes/
      run.post.ts
      events.get.ts
      graph.get.ts
      graph/paths.get.ts
      graph/communities.get.ts
      graph/explain.post.ts
      due.get.ts
    package.json

supabase/
  .gitignore

db/
  migrations/
    001_core_entities.sql
    002_securities_filings.sql
    003_positions_unique.sql
    010_graph_init.sql
    011_graph_indexes.sql
    012_rotation_events.sql
    013_short_interest.sql
    014_vectors.sql
    015_index_windows.sql
    016_file_cadence.sql
    017_unique_hardening.sql

docs/
  ARCHITECTURE.md
  DATA-SOURCES.md
  API.md
  SCORING.md
  WORKFLOWS.md
  GRAPH.md
  CADENCE.md

tools/
  seed-index-calendar.ts
  backfill-2019-2025.ts
  setup-temporal-attributes.sh
  db-reset.sh
```

---

## Authoritative Data & Rules (implement connectors)
- **SEC 13F‑HR / 13F‑HR/A**: quarterly manager holdings; due within 45 days after quarter‑end. Use InfoTable XML to capture equity and **listed options** (PUT/CALL flags).
- **Schedule 13D/13G (+/A)**: event‑driven beneficial ownership; 2023 deadline accelerations apply (13D initial ~5bd; 13D amendments ~2bd; 13G windows vary by filer type). Record **Date of Event**, **Filed date**.
- **Form N‑PORT (monthly)**: public availability ~60 days after month end. Normalize to fund‑level positions.
- **Daily ETF holdings (iShares)**: per‑fund web “Data Download” CSV; treat as previous business‑day EOD.
- **Short interest**: FINRA semi‑monthly settlement dates (publish ~8 bd later). From **2026+**, also ingest **SEC Rule 13f‑2** **aggregated security‑level totals** (no manager names).
- **Index calendars**:
  - **S&P U.S. indices** quarterly rebalances (Mar/Jun/Sep/Dec) — create ±5bd windows.
  - **FTSE Russell** reconstitution: **annual June through 2025; semi‑annual (June & November) from 2026 onward**.
- **Price data** (for event‑study): daily OHLCV for security and SPY/sector ETF.

---

## Cadence & Scheduling (critical)
**Never infer cadence from a field name.** Derive from **form type** and apply watchers:
- **13F (quarterly)**: `cadence='quarterly'`, `expected_publish_at = period_end + 45d`.
- **13D/G (event)**: `cadence='event'` — daily watch for filings.
- **N‑PORT (monthly)**: `cadence='monthly'`, `expected_publish_at = month_end + 60d`.
- **ETF holdings (daily)**: `cadence='daily'`, `as_of = prev_business_day`.
- **FINRA short (semi‑monthly)**: schedule on publish days from pre‑built calendar.

### Watcher Workflows
- `edgarSubmissionsPoller.workflow.ts`: poll SEC Company Submissions JSON per CIK; enqueue new accessions.
- `nportMonthlyTimer.workflow.ts`: timer for each fund month → fetch at M+60.
- `etfDailyCron.workflow.ts`: business‑day cron to fetch daily CSV.
- `finraShortPublish.workflow.ts`: cron loaded from calendar seed.

Each watcher sets **Search Attributes** (`Cadence`, `ExpectedPublish`) for visibility.

---

## Functional Requirements
### Ingest by **Issuer** OR **Manager**
- **Issuer input**: ticker, company name, or CIK → resolve to CIK (persist mapping).
- **Manager input**: name or CIK.
- Enumerate quarters/months/days per cadence;
- Fetch only **missing** accessions (short‑circuit if `filing.accession_no` exists).
- Normalize to **entity** (issuer/manager), **security** (CUSIP, class), **filing**, **position** rows.

### Idempotence & Reuse
- Unique keys enforce once‑only inserts:
  - `filing.accession_no` unique.
  - `position (filing_id, holder_id, security_id, position_type)` unique.
  - `graph_edge (src,dst,relation,asof)` unique.
- Manager‑first data is automatically available to issuer queries via joins; **no re‑fetch**.

### Parsing & Mapping
- Parse 13F InfoTable; include `putCall` flags and compute option share‑equivalents if reported.
- Parse 13D/13G: capture **Date of Event** (anchor for clusters) and % of class if present.
- Map CUSIP→security; resolve issuer by CIK; normalize name drift.

### High‑Frequency Overlays
- **N‑PORT monthly** → fund‑level positions (as of month end).
- **ETF daily holdings** → aggregate fund exposures into underlying securities per day; cache per `as_of`.

### Short‑Pressure Overlay
- **FINRA semi‑monthly** short interest; compute **ShortRelief** = scaled drop around the cluster window.
- **13f‑2 aggregates (2026+)**: optional second channel for overlay (security‑level only).

### Index/Passive Noise Scrub
- Apply `IndexPenalty` (0..0.5) when cluster overlaps index windows (S&P, Russell).
- Windows seeded from calendar with ±5bd buffers.

### Event Detection (anchor & uptake)
- **Dump event (anchor):** seller cut where
  - `Δshares ≥ 30%` of seller’s prior stake **or**
  - `Δshares as % of float ≥ 1.0%`.
- **Uptake:** Σ positive `Δshares (% float)` across tracked whales in **same** and **next** windows + any new **5%+ 13G/13D**.
- **High‑freq uptake:** `Uhf_same`/`Uhf_next` from N‑PORT & ETF holdings.
- **Options overlay:** from 13F **listed options** (PUT/CALL deltas).

### Scoring (RotationScore v4.1)
Let:
- `DumpZ` = z‑score of seller’s `Δ% float` (or `% cut`; take max).
- `U_same`, `U_next` (13F/13D/13G).
- `Uhf_same`, `Uhf_next` (N‑PORT/ETF).
- `Opt_same`, `Opt_next` (options relief signals 0..1).
- `ShortRelief` (0..1), `IndexPenalty` (0..0.5).

**Base (non‑EOW):**
```
R = 2.0*DumpZ
  + 1.0*U_same + 0.85*U_next
  + 0.7*Uhf_same + 0.6*Uhf_next
  + 0.5*Opt_same + 0.4*Opt_next
  + 0.4*ShortRelief
  - IndexPenalty
```
**EOW override:** if dump in last 5bd of quarter → boost next‑window components:
`U_next×0.95, Uhf_next×0.9, Opt_next×0.5` (others unchanged).

**Signal gates**
- Fire only if `DumpZ ≥ 1.5σ` **and** (`U_same>0` **or** `U_next>0` or `Uhf_* > 0` under EOW).
- Require **≥2 distinct buyers** in the qualifying window **or** one buyer ≥ **0.75% float**.

### Event Study
- Anchor at **earliest public filing** in the cluster (prefer 13G/13D; else 13F period‑end).
- Compute market‑adjusted returns vs SPY (or sector ETF) over `[−5,+20]` trading days; store **AR** and **CAR**.
- Persist: `CAR[-5,+20]`, `+1/+2/+4/+8/+13w` returns, `time‑to‑+20%`, `max drawdown`.

### Outputs
1) **Summary table** (CSV + JSON): ticker, dates, seller→buyers, all components, EOW?, `R`, AR/CAR, time‑to‑+20%, max‑ret@13w, DD.
2) **Per‑ticker timeline** with bipartite flow graph (Sankey‑ready JSON) and price overlay.
3) **Top signals** ranked by fastest time‑to‑+20%, then max return and CAR.
4) **JSON** mirror for scheduling.

---

## Data Model & Migrations (DDL)
> If objects exist, add only missing columns/constraints. Use `if not exists` everywhere.

**Entities**
```sql
create table if not exists entity (
  id bigserial primary key,
  cik text unique,
  legal_name text not null,
  entity_type text check (entity_type in ('ISSUER','MANAGER','FUND','ETF')) not null,
  lei text,
  ein text,
  created_at timestamptz default now()
);
```

**Securities**
```sql
create table if not exists security (
  id bigserial primary key,
  issuer_id bigint not null references entity(id),
  ticker text,
  cusip text,
  isin text,
  class_title text,
  unique (issuer_id, class_title)
);
create index if not exists security_cusip_idx on security(cusip);
```

**Filings**
```sql
create table if not exists filing (
  id bigserial primary key,
  accession_no text not null unique,
  form_type text not null,
  filer_id bigint references entity(id),
  issuer_id bigint references entity(id),
  period_of_report date,
  date_of_event date,
  filed_at date not null,
  cadence text check (cadence in ('daily','monthly','quarterly','event')),
  expected_publish_at timestamptz,
  published_at timestamptz,
  is_amendment boolean default false,
  amendment_of_accession text,
  source_url text
);
create index if not exists filing_form_period_idx on filing(form_type, period_of_report);
create index if not exists filing_expected_publish_at_ix on filing(expected_publish_at);
```

**Positions**
```sql
create table if not exists position (
  id bigserial primary key,
  filing_id bigint references filing(id) on delete cascade,
  holder_id bigint references entity(id),
  security_id bigint references security(id),
  position_type text check (position_type in ('COMMON','CALL','PUT','SWAP','OTHER')),
  shares numeric,
  market_value_usd numeric,
  pct_float numeric,
  as_of date,
  unique (filing_id, holder_id, security_id, position_type)
);
create index if not exists position_security_asof_idx on position(security_id, as_of);
create index if not exists position_holder_idx on position(holder_id);
```

**Short Interest**
```sql
create table if not exists short_interest (
  id bigserial primary key,
  security_id bigint references security(id),
  settlement_date date not null,
  short_interest bigint,
  days_to_cover numeric,
  source text check (source in ('FINRA','EXCHANGE','FORM_13F_2_AGG')),
  unique (security_id, settlement_date, source)
);
create index if not exists short_interest_sec_date_ix on short_interest(security_id, settlement_date);
```

**Rotation Events**
```sql
create table if not exists rotation_event (
  id bigserial primary key,
  security_id bigint not null references security(id),
  anchor_filing_id bigint references filing(id),
  eow_override boolean default false,
  window_same_d1 date, window_same_d2 date,
  window_next_d1 date, window_next_d2 date,
  dumpz numeric,
  u_same numeric, u_next numeric,
  uhf_same numeric, uhf_next numeric,
  opt_same numeric, opt_next numeric,
  short_relief numeric,
  index_penalty numeric,
  r_score numeric,
  car_m5_p20 numeric,
  t_to_plus20_days int,
  max_ret_w13 numeric,
  created_at timestamptz default now()
);
```

**Index Windows**
```sql
create table if not exists index_window (
  id bigserial primary key,
  name text not null,
  phase text,
  window_tz text default 'America/New_York',
  window_start date not null,
  window_end date not null,
  penalty numeric check (penalty between 0 and 0.5) default 0.2
);
create index if not exists index_window_start_end_ix on index_window(window_start, window_end);
```

**GraphRAG**
```sql
create table if not exists graph_node (
  node_id uuid primary key default gen_random_uuid(),
  kind text check (kind in ('issuer','manager','fund','etf','security','filing','index_event')),
  key_txt text not null,
  name text,
  meta jsonb default '{}'::jsonb,
  unique(kind, key_txt)
);

create table if not exists graph_edge (
  edge_id uuid primary key default gen_random_uuid(),
  src uuid not null references graph_node(node_id) on delete cascade,
  dst uuid not null references graph_node(node_id) on delete cascade,
  relation text not null,
  asof date not null,
  weight numeric default 0,
  attrs jsonb default '{}'::jsonb
);
create unique index if not exists uq_graph_edge on graph_edge (src, dst, relation, asof);
create index if not exists graph_edge_time_ix on graph_edge (asof);
create index if not exists graph_edge_src_ix on graph_edge (src);
create index if not exists graph_edge_dst_ix on graph_edge (dst);

create table if not exists graph_community (
  community_id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  method text not null,
  summary text not null,
  meta jsonb default '{}'::jsonb
);
```

**Vector store (optional but recommended)**
```sql
create extension if not exists vector;
create table if not exists doc_chunk (
  id bigserial primary key,
  filing_id bigint references filing(id),
  entity_id bigint references entity(id),
  chunk text not null,
  embedding vector(1536),
  meta jsonb
);
create index if not exists doc_chunk_vec_ix on doc_chunk using ivfflat (embedding vector_cosine_ops) with (lists=100);
```

---

## Temporal — Search Attributes
Register and use on every workflow:
- `Ticker` (keyword), `CIK` (keyword), `FilerCIK` (keyword), `Form` (keyword), `Accession` (keyword)
- `Cadence` (keyword), `ExpectedPublish` (datetime)
- `PeriodEnd` (datetime), `WindowKey` (keyword), `BatchId` (keyword), `RunKind` (keyword)

---

## Temporal Workflows & Activities (Contracts)
### Watchers (cadence)
- **edgarSubmissionsPoller.workflow.ts**
  - Input: `{ cik: string, pollEverySeconds?: number }`
  - Loop: fetch submissions JSON → diff new accessions → Activity to parse & upsert → set SA (`Form`, `Accession`, `Cadence`, `ExpectedPublish`).

- **nportMonthlyTimer.workflow.ts**
  - Input: `{ fundCiks: string[], startMonth?: string }`
  - For each month: sleep until `month_end + 60d` → fetch & upsert positions.

- **etfDailyCron.workflow.ts**
  - Input: `{ funds: string[] }` (fund tickers)
  - Cron: business‑days 20:00 ET → fetch CSV → stage → normalize → upsert.

- **finraShortPublish.workflow.ts**
  - Input: none (calendar‑driven) → fetch semi‑monthly publications → upsert `short_interest`.

### Ingest
- **ingestIssuer.workflow.ts**
  - Input: `{ ticker?: string; name?: string; cik?: string; from?: string; to?: string; runKind?: 'backfill'|'daily' }`
  - Resolve issuer CIK; enumerate quarters; **Child** `ingestQuarter.workflow` (mode: ISSUER) for 8–12 quarters per run (Continue‑As‑New for more); then `graphBuild` → `rotationDetect` → `eventStudy` for new events.

- **ingestManager.workflow.ts**
  - Input: `{ name?: string; cik?: string; from?: string; to?: string; runKind?: 'backfill'|'daily' }`
  - Resolve manager CIK; enumerate quarters; **Child** `ingestQuarter.workflow` (mode: MANAGER). Reuse filings by accession.

- **ingestQuarter.workflow.ts**
  - Inputs: `{ cik: string; quarter: string; mode: 'ISSUER'|'MANAGER' }`
  - Activities: `edgar.fetchFilings` (forms), `edgar.parse13FInfoTables`, `edgar.parse13D13G`, `nport.fetchForWindow`, `etf.ingestForWindow`, `finra.ingestForWindow`.
  - **Continue‑As‑New** after 8–12 quarters.

### Analysis
- **rotationDetect.workflow.ts**
  - For each security in window: compute deltas, anchors, U_*, Uhf_*, Opt_*, ShortRelief, IndexPenalty, EOW override; compute R; gate; persist `rotation_event`.

- **eventStudy.workflow.ts**
  - Inputs: `{ security_id, anchor_date }`
  - Activity: fetch prices, regress vs SPY/sector to estimate α,β; compute AR/CAR & metrics; update `rotation_event`.

### GraphRAG
- **graphBuild.workflow.ts**
  - Ensure nodes for issuers/managers/securities/filings/index_events; ensure edges (idempotent).

- **graphSummarize.workflow.ts**
  - Compute communities per period (Louvain/PageRank); store `graph_community.summary` and key members.

- **graphQuery.workflow.ts**
  - Input: `{ ticker|cik, hops, from, to, question? }`
  - `kHopNeighborhood` to collect paths; if question → bundle for long‑context → synthesize.

### Long‑context Explainer (optional)
- **longcontext.activities.ts**
  - `bundleForSynthesis(edgeIds[], question?)` → accession IDs, graph facts, ≤25‑word quotes.
  - `synthesizeWithOpenAI(bundle)` → Responses API; persist text + provenance; never fabricate.

---

## Connectors & Rate‑Limit Guards
- Centralize HTTP in `secClient.ts` with **≤10 rps**, real `User‑Agent`, jittered backoff on 429/5xx.
- Before any fetch, check for existing **accession** and short‑circuit.
- Optionally use helper libs for EDGAR as long as **dedupe and UA/rate‑limit** are still enforced.

---

## Scoring & Index Penalty Impl
- Compute `IndexPenalty` as a function of overlap days between cluster window and any `index_window` ranges, capped at 0.5.
- Maintain configurable penalties per index family (S&P, Russell).

---

## APIs
- `POST /api/run` → start issuer/manager ingest: `{ type: 'issuer'|'manager', ticker|name|cik, from?, to?, runKind? }`
- `GET /api/events?ticker|cik` → list `rotation_event` for issuer’s securities.
- `GET /api/graph?ticker|cik&period|from,to` → **Sankey JSON** `{ nodes:[], links:[], accessions:[] }`.
- `GET /api/graph/paths?ticker|cik&hops&from,to` → top k paths with scores.
- `GET /api/graph/communities?ticker|cik&period` → community summaries.
- `POST /api/graph/explain` → `{ edgeIds:[], question? }` → long‑context narrative + accession list.
- `GET /api/due?date=YYYY-MM-DD` → filings expected to publish that day (from `expected_publish_at`).

---

## Tests (must implement)
1) **Search Attributes registered**; fail if missing.
2) **Determinism**: no HTTP in Workflows (Activities mocked).
3) **Idempotence**: re‑run same quarter → no duplicate filings/positions/edges.
4) **Manager→Issuer reuse**: ingest BlackRock 2019→present; later run IRBT → zero refetch for IRBT‑relevant accessions.
5) **Index windows**: Russell **June & November from 2026+**; none before.
6) **Rotation gates**: EOW override, buyer count/size gates, IndexPenalty applied.
7) **Event Study**: reproducible CAR on fixture series.
8) **Explain**: quotes ≤25 words; accession list present; no placeholders.

---

## CI & Ops
- **CI**: lint, type‑check, DB migrate (dry‑run), unit tests, SA assert (`temporal operator search-attribute list`).
- **Observability**: structured logs per Activity; metrics for request counts, dedupe hit ratio, ingest latency; alerts on ingest failures.
- **Security**: RLS disabled for service role; explicit policies for any client‑facing tables.

---

## Performance & Scale
- Start with Postgres; add **native partitioning** or Timescale for `position`/`graph_edge` if tens of millions of rows.
- Add **read replicas** if API/analysis load grows.
- Consider **Citus** or a separate graph analytics cache only if interactive multi‑hop algorithms become a bottleneck.

---

## Future Extensions
- Add **Apache AGE** (Cypher) or external graph DB as analytics layer while keeping Postgres the source‑of‑truth.
- Integrate **Form SHO** once publically stable; add more ATS/volume overlays.
- UI: add interactive Sankey + timeline with hoverable accessions.

---

## Environment
```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
EDGAR_USER_AGENT="InstitutionalRotationDetector your-email@example.com"
MAX_RPS_EDGAR=8
OPENAI_API_KEY=
TEMPORAL_NAMESPACE=
TEMPORAL_TASK_QUEUE=rotation-detector
ISHARES_FUNDS=IWB,IWM,IJR,IVV   # example; configure
DEFAULT_FROM=2019-01-01
```

---

## Acceptance Criteria (hard)
- With only **BlackRock CIK** and `from=2019-01-01`, system ingests all 13F accessions (deduped), parses equity + options, builds graph nodes/edges/communities, and exposes events.
- With only **IRBT ticker/CIK**, system ingests issuer filings and **reuses** BlackRock 13F positions relevant to IRBT **without refetch**; graph and events reflect both manager‑origin and issuer‑origin data.
- **Watchers** list expected‑today filings via `/api/due`, and ingests them when they arrive.
- **RotationScore v4.1** computed with EOW override, IndexPenalty, ShortRelief, Option overlays; event‑study stored.
- **GraphRAG** returns Sankey and k‑hop paths; **Explain** returns long‑context narrative with accession citations and ≤25‑word quotes; no fabricated facts.
- System remains deterministic, idempotent, and within fair‑access limits.

> Build exactly to this spec. Where code exists, extend; where missing, implement. All inserts/updates must be idempotent. Prefer **CIK** for entities and **CUSIP** for securities to avoid name drift. No placeholders. If something cannot be verified, record **N/A** and proceed.

