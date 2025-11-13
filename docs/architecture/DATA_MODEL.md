# Data Model

Comprehensive database schema reference for the Institutional Rotation Detector.

## Table of Contents

- [Overview](#overview)
- [Schema Diagrams](#schema-diagrams)
- [Core Tables](#core-tables)
- [Position Tables](#position-tables)
- [Rotation Tables](#rotation-tables)
- [Graph Tables](#graph-tables)
- [Reference Tables](#reference-tables)
- [Vector/RAG Tables](#vectorrag-tables)
- [Relationships](#relationships)
- [Constraints & Validation](#constraints--validation)
- [Performance Considerations](#performance-considerations)

## Overview

The database uses PostgreSQL 15+ with the pgvector extension. The schema is organized into logical groups:

- **Core** - Entities and filings
- **Position** - Institutional holdings data
- **Rotation** - Detected rotation events and graph edges
- **Graph** - Knowledge graph (GraphRAG)
- **Reference** - Supporting data (index calendars, CUSIP mappings)
- **Vector** - Embeddings for semantic search

### Design Principles

1. **Temporal Modeling** - Point-in-time snapshots with `asof` dates
2. **Normalization** - Entities stored once, referenced by UUID
3. **Immutability** - Append-only for filings and positions
4. **Denormalization** - Computed metrics stored for performance
5. **Referential Integrity** - Foreign keys with cascading deletes where appropriate

---

## Schema Diagrams

### Entity-Relationship Overview

```
┌────────────┐
│  entities  │────┐
└────────────┘    │
      │           │
      │ (1:N)     │ (1:N)
      │           │
      ▼           ▼
┌────────────┐  ┌──────────────┐
│  filings   │  │ positions_13f│
└────────────┘  └──────────────┘
      │
      │ (1:N)
      ▼
┌──────────────┐
│filing_chunks │ (with vector embeddings)
└──────────────┘

┌─────────────────┐
│ rotation_events │───┐
└─────────────────┘   │
                      │ (1:N)
                      ▼
              ┌─────────────────┐
              │ rotation_edges  │
              └─────────────────┘
                      │
                      │ references
                      ▼
              ┌─────────────────┐
              │   entities      │
              └─────────────────┘

┌─────────────┐         ┌─────────────┐
│ graph_nodes │◄────────│ graph_edges │
└─────────────┘         └─────────────┘
      ▲                       │
      │                       │
      │ references            │ references
      │                       │
      ▼                       ▼
┌────────────────┐    ┌──────────────────┐
│ node_bindings  │    │graph_communities │
└────────────────┘    └──────────────────┘
```

---

## Core Tables

### `entities`

Central registry of all institutional entities.

**Schema:**
```sql
CREATE TABLE entities (
  entity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cik text,
  name text NOT NULL,
  kind text CHECK (kind IN ('issuer','manager','fund','etf')) NOT NULL,
  ticker text,
  series_id text,
  datasource_type text,
  datasource_config jsonb
);

-- Unique constraint: allows multiple ETFs/funds with same CIK but different series_id
CREATE UNIQUE INDEX entities_unique_identifier_kind
  ON entities (cik, coalesce(series_id, ''), kind);
```

**Fields:**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `entity_id` | uuid | PK, auto-generated | Unique entity identifier |
| `cik` | text | Unique w/ series_id + kind | SEC Central Index Key (10 digits) |
| `name` | text | NOT NULL | Entity legal name |
| `kind` | text | NOT NULL, CHECK | Entity type |
| `ticker` | text | NULL | Stock ticker (for issuers and ETFs) |
| `series_id` | text | NULL | SEC series ID (format: S000012345) |
| `datasource_type` | text | NULL | ETF data source (ishares, vanguard, etc.) |
| `datasource_config` | jsonb | NULL | Vendor-specific scraping config |

**Entity Types (`kind`):**
- `issuer` - Public companies (Apple, Microsoft, etc.)
- `manager` - Investment managers (Vanguard, BlackRock, etc.)
- `fund` - Mutual funds
- `etf` - Exchange-traded funds

**🔥 CRITICAL: series_id for Multi-Series ETF Trusts**

Many ETF trusts contain multiple ETF series under one CIK. **You MUST use series_id to distinguish them:**

**Example - Invesco QQQ Trust (CIK 0001067839):**
- QQQ (original): `series_id = 'S000006218'`, CUSIP `46090E103`
- QQQM (mini): `series_id = 'S000069622'`, CUSIP `46138J784`

**Entity Identification Rules:**
- **Regular stocks/managers:** Identified by CIK only (`series_id` is NULL)
- **ETFs/funds:** Identified by CIK + series_id (composite key)

**Unique Constraint:**
```sql
-- Uses coalesce to handle NULL series_id for stocks/managers
entities_unique_identifier_kind ON (cik, coalesce(series_id, ''), kind)
```

This allows:
- Apple: `(0000320193, '', 'issuer')` ✅
- QQQ: `(0001067839, 'S000006218', 'etf')` ✅
- QQQM: `(0001067839, 'S000069622', 'etf')` ✅ Same CIK, different series!

**When Creating ETF Entities:**
```typescript
// ✅ CORRECT - Include series_id for ETFs
await upsertEntity('0001067839', 'etf', 'S000006218');

// ❌ WRONG - Missing series_id will conflict if trust has multiple series
await upsertEntity('0001067839', 'etf');
```

**Indexes:**
```sql
CREATE UNIQUE INDEX entities_unique_identifier_kind
  ON entities (cik, coalesce(series_id, ''), kind);
CREATE INDEX idx_entities_ticker ON entities(ticker) WHERE ticker IS NOT NULL;
```

**Example Data:**
```sql
INSERT INTO entities (cik, name, kind, ticker, series_id) VALUES
  -- Regular stock (no series_id)
  ('0000320193', 'Apple Inc.', 'issuer', 'AAPL', NULL),

  -- Investment manager (no series_id)
  ('0001000097', 'Vanguard Group Inc', 'manager', NULL, NULL),

  -- Multi-series ETF trust (requires series_id for each)
  ('0001067839', 'Invesco QQQ Trust - QQQ', 'etf', 'QQQ', 'S000006218'),
  ('0001067839', 'Invesco QQQ Trust - QQQM', 'etf', 'QQQM', 'S000069622');
```

**Usage:**
- Deduplication: Ensures each (CIK, series_id, kind) combination exists once
- Central reference: All other tables reference `entity_id`
- Multi-role entities: Same CIK can be both issuer and manager
- Multi-series trusts: Same CIK can have multiple ETF/fund entities with different series_ids

---

### `filings`

SEC filing metadata.

**Schema:**
```sql
CREATE TABLE filings (
  accession text PRIMARY KEY,
  cik text NOT NULL,
  form text NOT NULL,
  filed_date date NOT NULL,
  period_end date,
  event_date date,
  url text NOT NULL
);
```

**Fields:**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `accession` | text | PK | SEC accession number (unique identifier) |
| `cik` | text | NOT NULL | Filer's CIK |
| `form` | text | NOT NULL | Form type (13F-HR, NPORT-P, etc.) |
| `filed_date` | date | NOT NULL | Date filed with SEC |
| `period_end` | date | NULL | Reporting period end (for periodic reports) |
| `event_date` | date | NULL | Event date (for 13G/13D) |
| `url` | text | NOT NULL | SEC EDGAR URL |

**Form Types:**
- `13F-HR` - Institutional investment manager holdings (quarterly)
- `NPORT-P` - Monthly portfolio holdings (mutual funds/ETFs)
- `13G` / `13G-A` - Beneficial ownership (>5% passive)
- `13D` / `13D-A` - Beneficial ownership (>5% active)
- `10-K` / `10-Q` - Annual/quarterly reports
- `8-K` - Current reports (material events)

**Indexes:**
```sql
CREATE INDEX idx_filings_cik_filed ON filings(cik, filed_date);
CREATE INDEX idx_filings_form ON filings(form);
```

**Example Data:**
```sql
INSERT INTO filings VALUES (
  '0001193125-24-123456',
  '0001000097',
  '13F-HR',
  '2024-05-15',
  '2024-03-31',
  NULL,
  'https://www.sec.gov/Archives/edgar/data/1000097/0001193125-24-123456.txt'
);
```

**Usage:**
- Deduplication: Prevents re-downloading same filing
- Audit trail: Track data provenance
- URL reference: Link back to source documents

---

### `cusip_issuer_map`

Maps CUSIP identifiers to issuer CIKs and series_ids (for ETFs/funds).

**Schema:**
```sql
CREATE TABLE cusip_issuer_map (
  cusip text PRIMARY KEY,
  issuer_cik text NOT NULL,
  series_id text
);
```

**Fields:**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `cusip` | text | PK | 9-character CUSIP identifier |
| `issuer_cik` | text | NOT NULL | Issuer's SEC CIK |
| `series_id` | text | NULL | SEC series ID (S000012345) for ETFs/funds |

**🔥 CRITICAL: series_id Required for ETF/Fund CUSIPs**

When mapping CUSIPs for ETFs or mutual funds, **MUST include series_id** to enable proper entity resolution.

**Why this matters:**
- FINRA data (short interest, ATS/dark pool) reports by CUSIP
- Multiple ETFs in same trust have same CIK but different series_ids
- Without series_id, cannot determine which specific ETF a CUSIP belongs to

**Example Data:**
```sql
INSERT INTO cusip_issuer_map (cusip, issuer_cik, series_id) VALUES
  -- Regular stocks (series_id = NULL)
  ('037833100', '0000320193', NULL),  -- AAPL → Apple Inc.
  ('594918104', '0000789019', NULL),  -- MSFT → Microsoft

  -- Multi-series ETF trust (series_id REQUIRED)
  ('46090E103', '0001067839', 'S000006218'),  -- QQQ → Invesco QQQ Trust
  ('46138J784', '0001067839', 'S000069622');  -- QQQM → Invesco QQQ Trust (same CIK!)
```

**Downstream Impact:**
- `short_interest` table: Stores data by CUSIP (can distinguish QQQ vs QQQM)
- `ats_weekly` table: Stores data by CUSIP (separate dark pool activity per ETF)
- Entity lookup: `cusip_issuer_map.series_id` → `entities.series_id` → correct `entity_id`

**Usage:**
- Position resolution: Link holdings to specific ETF entities
- FINRA data ingestion: Map CUSIP-level data to correct entity
- Entity lookup: Resolve CUSIP → (CIK, series_id) → entity_id
- Historical tracking: Handle CUSIP changes over time

---

## Position Tables

### `positions_13f`

Institutional holdings from 13F filings.

**Schema:**
```sql
CREATE TABLE positions_13f (
  entity_id uuid REFERENCES entities,
  cusip text NOT NULL,
  asof date NOT NULL,
  shares bigint DEFAULT 0,
  opt_put_shares bigint DEFAULT 0,
  opt_call_shares bigint DEFAULT 0,
  accession text REFERENCES filings(accession),
  PRIMARY KEY (entity_id, cusip, asof, accession)
);
```

**Fields:**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `entity_id` | uuid | FK to entities | Institutional holder |
| `cusip` | text | NOT NULL | Security identifier |
| `asof` | date | NOT NULL | Position snapshot date |
| `shares` | bigint | DEFAULT 0 | Equity shares held |
| `opt_put_shares` | bigint | DEFAULT 0 | Put option shares (underlying) |
| `opt_call_shares` | bigint | DEFAULT 0 | Call option shares (underlying) |
| `accession` | text | FK to filings | Source filing |

**Composite Key:** `(entity_id, cusip, asof, accession)`
- Allows multiple filings on same date (amendments)
- Point-in-time query capability

**Indexes:**
```sql
CREATE INDEX idx_positions_cusip_asof ON positions_13f(cusip, asof);
CREATE INDEX idx_positions_entity_asof ON positions_13f(entity_id, asof);
```

**Example Data:**
```sql
INSERT INTO positions_13f VALUES (
  '550e8400-e29b-41d4-a716-446655440000',  -- Vanguard entity_id
  '037833100',                              -- AAPL CUSIP
  '2024-03-31',
  28500000,                                 -- 28.5M shares
  0,                                        -- No puts
  500000,                                   -- 500K calls
  '0001193125-24-123456'
);
```

**Usage:**
- Position tracking: Historical holdings over time
- Delta calculation: Compare positions quarter-over-quarter
- Options analysis: Identify hedging and speculation

**Common Queries:**
```sql
-- Latest position for a holder
SELECT * FROM positions_13f
WHERE entity_id = $1 AND cusip = $2
ORDER BY asof DESC
LIMIT 1;

-- Position changes over time
SELECT asof, shares,
  shares - LAG(shares) OVER (ORDER BY asof) as delta
FROM positions_13f
WHERE entity_id = $1 AND cusip = $2
ORDER BY asof;
```

---

### `bo_snapshots`

Beneficial ownership snapshots from 13G/13D filings.

**Schema:**
```sql
CREATE TABLE bo_snapshots (
  issuer_cik text NOT NULL,
  holder_cik text NOT NULL,
  event_date date NOT NULL,
  filed_date date NOT NULL,
  pct_of_class numeric,
  shares_est bigint,
  accession text REFERENCES filings(accession),
  PRIMARY KEY (issuer_cik, holder_cik, event_date, accession)
);
```

**Fields:**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `issuer_cik` | text | NOT NULL | Company being held |
| `holder_cik` | text | NOT NULL | Beneficial owner |
| `event_date` | date | NOT NULL | Date ownership crossed threshold |
| `filed_date` | date | NOT NULL | Date filed with SEC |
| `pct_of_class` | numeric | NULL | Percentage of outstanding shares |
| `shares_est` | bigint | NULL | Estimated share count |
| `accession` | text | FK to filings | Source filing |

**Usage:**
- Large holder tracking: Monitor >5% positions
- Activist detection: Identify 13D filers (active investors)
- Ownership changes: Track accumulation/disposition

---

### `uhf_positions`

Ultra-high-frequency positions from N-PORT and ETF holdings.

**Schema:**
```sql
CREATE TABLE uhf_positions (
  holder_id uuid REFERENCES entities,
  cusip text NOT NULL,
  asof date NOT NULL,
  shares bigint NOT NULL,
  source text CHECK (source IN ('NPORT','ETF')) NOT NULL,
  PRIMARY KEY (holder_id, cusip, asof, source)
);
```

**Fields:**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `holder_id` | uuid | FK to entities | Fund or ETF |
| `cusip` | text | NOT NULL | Security identifier |
| `asof` | date | NOT NULL | Position date |
| `shares` | bigint | NOT NULL | Shares held |
| `source` | text | CHECK | Data source |

**Sources:**
- `NPORT` - Monthly mutual fund holdings (N-PORT filings)
- `ETF` - Daily ETF holdings (from ETF providers)

**Usage:**
- Higher frequency: Monthly/daily vs. quarterly 13F
- Uptake detection: Identify faster institutional buying
- ETF flows: Track index fund rebalancing

---

### `short_interest`

Short interest data from FINRA.

**Schema:**
```sql
CREATE TABLE short_interest (
  settle_date date NOT NULL,
  cik text NOT NULL,
  short_shares bigint NOT NULL,
  PRIMARY KEY (settle_date, cik)
);
```

**Fields:**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `settle_date` | date | NOT NULL | Settlement date (bi-weekly) |
| `cik` | text | NOT NULL | Issuer CIK |
| `short_shares` | bigint | NOT NULL | Total shares sold short |

**Usage:**
- Short relief metric: Decline in short interest after rotation
- Sentiment indicator: High short interest suggests bearishness
- Squeeze detection: Rapid short covering

---

### `ats_weekly`

Alternative Trading System (ATS) weekly volume data.

**Schema:**
```sql
CREATE TABLE ats_weekly (
  week_end date NOT NULL,
  cik text NOT NULL,
  venue text NOT NULL,
  shares bigint NOT NULL,
  trades bigint,
  PRIMARY KEY (week_end, cik, venue)
);
```

**Fields:**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `week_end` | date | NOT NULL | Week ending date |
| `cik` | text | NOT NULL | Issuer CIK |
| `venue` | text | NOT NULL | ATS venue name |
| `shares` | bigint | NOT NULL | Total shares traded |
| `trades` | bigint | NULL | Number of trades |

**Usage:**
- Dark pool activity: Off-exchange institutional trading
- Liquidity analysis: Assess trading depth
- Venue analysis: Identify preferred execution venues

---

## Rotation Tables

### `rotation_events`

Detected rotation events with all scoring signals.

**Schema:**
```sql
CREATE TABLE rotation_events (
  cluster_id uuid PRIMARY KEY,
  issuer_cik text NOT NULL,
  anchor_filing text REFERENCES filings(accession),
  dumpz numeric,
  u_same numeric,
  u_next numeric,
  uhf_same numeric,
  uhf_next numeric,
  opt_same numeric,
  opt_next numeric,
  shortrelief_v2 numeric,
  index_penalty numeric,
  eow boolean,
  r_score numeric,
  car_m5_p20 numeric,
  t_to_plus20_days int,
  max_ret_w13 numeric
);
```

**Fields:**

| Column | Type | Description |
|--------|------|-------------|
| `cluster_id` | uuid | Unique event identifier |
| `issuer_cik` | text | Company with rotation |
| `anchor_filing` | text | Reference filing (seller's 13F) |
| `dumpz` | numeric | Dump magnitude (z-score normalized) |
| `u_same` | numeric | Uptake same quarter (0-1 scale) |
| `u_next` | numeric | Uptake next quarter (0-1 scale) |
| `uhf_same` | numeric | UHF uptake same quarter |
| `uhf_next` | numeric | UHF uptake next quarter |
| `opt_same` | numeric | Options overlay same quarter |
| `opt_next` | numeric | Options overlay next quarter |
| `shortrelief_v2` | numeric | Short interest relief (0-1 scale) |
| `index_penalty` | numeric | Penalty for index rebalancing |
| `eow` | boolean | End-of-window (last 5 days of quarter) |
| `r_score` | numeric | Overall rotation score |
| `car_m5_p20` | numeric | Cumulative abnormal return (-5 to +20 days) |
| `t_to_plus20_days` | int | Days to reach +20 days |
| `max_ret_w13` | numeric | Maximum return in week 13 |

**Scoring Formula:**
```
r_score = 2.0 * dumpz +
          1.0 * u_same +
          0.85 * u_next * eow_multiplier +
          0.7 * uhf_same +
          0.6 * uhf_next * eow_multiplier +
          0.5 * opt_same +
          0.4 * opt_next * eow_multiplier +
          0.4 * shortrelief_v2 -
          index_penalty

where eow_multiplier = 1.2 if eow else 1.0
```

**Gating:** Event only scored if `dumpz >= 1.5` AND at least one uptake/UHF signal > 0

**Indexes:**
```sql
CREATE INDEX idx_rotation_events_issuer ON rotation_events(issuer_cik);
CREATE INDEX idx_rotation_events_score ON rotation_events(r_score DESC);
```

**Example Data:**
```sql
INSERT INTO rotation_events VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  '0000320193',  -- AAPL
  '0001193125-24-123456',
  7.5,     -- Large dump
  0.45,    -- 45% uptake same quarter
  0.32,    -- 32% uptake next
  0.38,    -- UHF same
  0.25,    -- UHF next
  0.12,    -- Options same
  0.08,    -- Options next
  0.22,    -- Short relief
  0.1,     -- Index penalty
  false,   -- Not end-of-window
  18.75,   -- R-score
  0.0432,  -- 4.32% CAR
  18,      -- Days to +20
  0.0567   -- 5.67% max return
);
```

**Usage:**
- Event ranking: Sort by `r_score` to find strongest rotations
- Signal analysis: Decompose score into components
- Performance tracking: Analyze CAR metrics

---

### `rotation_edges`

Graph edges representing institutional flows.

**Schema:**
```sql
CREATE TABLE rotation_edges (
  cluster_id uuid DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  seller_id uuid REFERENCES entities,
  buyer_id uuid REFERENCES entities,
  cusip text NOT NULL,
  equity_shares bigint DEFAULT 0,
  options_shares bigint DEFAULT 0,
  confidence numeric CHECK (confidence BETWEEN 0 AND 1) DEFAULT 0.8,
  notes text,
  PRIMARY KEY (cluster_id, seller_id, buyer_id, cusip)
);
```

**Fields:**

| Column | Type | Description |
|--------|------|-------------|
| `cluster_id` | uuid | Associated rotation event |
| `period_start` | date | Period start |
| `period_end` | date | Period end |
| `seller_id` | uuid | Selling entity (NULL = unknown) |
| `buyer_id` | uuid | Buying entity (NULL = unknown) |
| `cusip` | text | Security |
| `equity_shares` | bigint | Equity shares transferred |
| `options_shares` | bigint | Options shares (underlying) |
| `confidence` | numeric | Edge confidence (0-1) |
| `notes` | text | Additional metadata |

**Indexes:**
```sql
CREATE INDEX idx_rotation_edges_period ON rotation_edges(period_start, period_end);
CREATE INDEX idx_rotation_edges_seller ON rotation_edges(seller_id);
CREATE INDEX idx_rotation_edges_buyer ON rotation_edges(buyer_id);
```

**Usage:**
- Flow visualization: Build Sankey diagrams
- Network analysis: Identify central players
- Attribution: Who's buying what sellers are selling

---

## Graph Tables

### `graph_nodes`

Knowledge graph nodes (GraphRAG).

**Schema:**
```sql
CREATE TABLE graph_nodes (
  node_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text CHECK (kind IN ('issuer','manager','fund','etf','security','filing','index_event')) NOT NULL,
  key_txt text NOT NULL,
  name text,
  meta jsonb DEFAULT '{}'::jsonb,
  UNIQUE(kind, key_txt)
);
```

**Fields:**

| Column | Type | Description |
|--------|------|-------------|
| `node_id` | uuid | Unique node identifier |
| `kind` | text | Node type |
| `key_txt` | text | Unique key within type |
| `name` | text | Display name |
| `meta` | jsonb | Additional attributes |

**Node Types:**
- `issuer` - Public companies
- `manager` - Investment managers
- `fund` - Mutual funds
- `etf` - Exchange-traded funds
- `security` - Securities (stocks, bonds)
- `filing` - SEC filings
- `index_event` - Index rebalance events

**Indexes:**
```sql
CREATE INDEX idx_graph_nodes_kind_key ON graph_nodes(kind, key_txt);
CREATE INDEX idx_graph_nodes_meta ON graph_nodes USING GIN (meta);
```

**Example Data:**
```sql
INSERT INTO graph_nodes (kind, key_txt, name, meta) VALUES
  ('issuer', '0000320193', 'Apple Inc.', '{"sector":"Technology","industry":"Consumer Electronics"}'),
  ('manager', '0001000097', 'Vanguard Group', '{"aum":8500000000000}'),
  ('security', '037833100', 'AAPL', '{"exchange":"NASDAQ"}');
```

---

### `graph_edges`

Knowledge graph edges.

**Schema:**
```sql
CREATE TABLE graph_edges (
  edge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  src uuid NOT NULL REFERENCES graph_nodes(node_id) ON DELETE CASCADE,
  dst uuid NOT NULL REFERENCES graph_nodes(node_id) ON DELETE CASCADE,
  relation text NOT NULL,
  asof date NOT NULL,
  weight numeric DEFAULT 0,
  attrs jsonb DEFAULT '{}'::jsonb,
  UNIQUE (src, dst, relation, asof)
);
```

**Fields:**

| Column | Type | Description |
|--------|------|-------------|
| `edge_id` | uuid | Unique edge identifier |
| `src` | uuid | Source node |
| `dst` | uuid | Destination node |
| `relation` | text | Edge type |
| `asof` | date | Temporal marker |
| `weight` | numeric | Edge weight |
| `attrs` | jsonb | Additional attributes |

**Relation Types:**
- `holds` - Entity holds security
- `sold` - Entity sold security
- `bought` - Entity bought security
- `filed` - Entity filed report
- `mentions` - Filing mentions entity
- `rebalanced` - Index event affected security

**Indexes:**
```sql
CREATE INDEX idx_graph_edges_src ON graph_edges(src);
CREATE INDEX idx_graph_edges_dst ON graph_edges(dst);
CREATE INDEX idx_graph_edges_relation ON graph_edges(relation);
CREATE INDEX idx_graph_edges_asof ON graph_edges(asof);
CREATE INDEX idx_graph_edges_attrs ON graph_edges USING GIN (attrs);
```

---

### `graph_communities`

Detected graph communities with AI summaries.

**Schema:**
```sql
CREATE TABLE graph_communities (
  community_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  method text NOT NULL,
  summary text NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb
);
```

**Fields:**

| Column | Type | Description |
|--------|------|-------------|
| `community_id` | uuid | Unique community identifier |
| `period_start` | date | Analysis period start |
| `period_end` | date | Analysis period end |
| `method` | text | Detection algorithm |
| `summary` | text | AI-generated explanation |
| `meta` | jsonb | Node IDs, scores, etc. |

**Methods:**
- `louvain` - Louvain community detection
- `pagerank` - PageRank-based clustering

**Indexes:**
```sql
CREATE INDEX idx_graph_communities_period ON graph_communities(period_start, period_end);
CREATE INDEX idx_graph_communities_meta ON graph_communities USING GIN (meta);
```

---

### `node_bindings`

Lookup table for resolving keys to node IDs.

**Schema:**
```sql
CREATE TABLE node_bindings (
  kind text NOT NULL,
  key_txt text NOT NULL,
  node_id uuid NOT NULL REFERENCES graph_nodes(node_id) ON DELETE CASCADE,
  PRIMARY KEY (kind, key_txt)
);
```

**Usage:**
- Fast lookups: Resolve CIK → node_id
- Denormalized cache: Avoid joins in hot paths

---

### `graph_explanations`

Stored AI-generated explanations.

**Schema:**
```sql
CREATE TABLE graph_explanations (
  explanation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  question text,
  edge_ids uuid[] NOT NULL DEFAULT '{}',
  accessions text[] NOT NULL DEFAULT '{}',
  content text NOT NULL
);
```

**Fields:**

| Column | Type | Description |
|--------|------|-------------|
| `explanation_id` | uuid | Unique explanation identifier |
| `created_at` | timestamptz | Creation timestamp |
| `question` | text | User's question (optional) |
| `edge_ids` | uuid[] | Relevant edge IDs |
| `accessions` | text[] | Referenced SEC filings |
| `content` | text | AI-generated explanation |

**Usage:**
- Audit trail: Track AI-generated content
- Caching: Avoid regenerating same explanation
- Compliance: Document AI reasoning

---

## Reference Tables

### `index_windows`

Index rebalance windows.

**Schema:**
```sql
CREATE TABLE index_windows (
  index_name text NOT NULL,
  phase text NOT NULL,
  window_start date NOT NULL,
  window_end date NOT NULL
);
```

**Fields:**

| Column | Type | Description |
|--------|------|-------------|
| `index_name` | text | Index name (Russell, S&P) |
| `phase` | text | Rebalance phase |
| `window_start` | date | Window start |
| `window_end` | date | Window end |

**Phases:**
- Russell: `annual`, `effective`, `semi-annual`
- S&P: `quarterly`

**Usage:**
- Index penalty: Reduce rotation scores during rebalances
- Event filtering: Exclude index-driven flows
- Temporal analysis: Correlate rotations with rebalances

---

## Vector/RAG Tables

### `filing_chunks`

Filing text chunks with embeddings for semantic search.

**Schema:**
```sql
CREATE TABLE filing_chunks (
  accession text REFERENCES filings(accession),
  chunk_no int,
  content text,
  embedding vector(1536),
  PRIMARY KEY (accession, chunk_no)
);
```

**Fields:**

| Column | Type | Description |
|--------|------|-------------|
| `accession` | text | Parent filing |
| `chunk_no` | int | Chunk sequence number |
| `content` | text | Text content |
| `embedding` | vector(1536) | OpenAI embedding (text-embedding-3-small) |

**Indexes:**
```sql
CREATE INDEX idx_filing_chunks_embedding ON filing_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

**Usage:**
- Semantic search: Find relevant filing sections
- RAG: Retrieve context for AI explanations
- Similarity: Compare filings across time

**Vector Search Example:**
```sql
SELECT accession, chunk_no, content,
  1 - (embedding <=> $1::vector) AS similarity
FROM filing_chunks
ORDER BY embedding <=> $1::vector
LIMIT 5;
```

---

## Relationships

### Foreign Key Constraints

```sql
-- Positions reference entities and filings
positions_13f.entity_id → entities.entity_id
positions_13f.accession → filings.accession

-- Rotation edges reference entities
rotation_edges.seller_id → entities.entity_id
rotation_edges.buyer_id → entities.entity_id

-- Rotation events reference filings
rotation_events.anchor_filing → filings.accession

-- Graph edges reference graph nodes
graph_edges.src → graph_nodes.node_id
graph_edges.dst → graph_nodes.node_id

-- Node bindings reference graph nodes
node_bindings.node_id → graph_nodes.node_id

-- Filing chunks reference filings
filing_chunks.accession → filings.accession
```

### Cascade Behaviors

- **graph_edges**: `ON DELETE CASCADE` when graph_nodes deleted
- **node_bindings**: `ON DELETE CASCADE` when graph_nodes deleted
- Most others: No cascade (preserve data integrity)

---

## Constraints & Validation

### Check Constraints

```sql
-- Entity kinds
entities.kind IN ('issuer','manager','fund','etf')

-- UHF sources
uhf_positions.source IN ('NPORT','ETF')

-- Edge confidence
rotation_edges.confidence BETWEEN 0 AND 1

-- Graph node kinds
graph_nodes.kind IN ('issuer','manager','fund','etf','security','filing','index_event')
```

### Unique Constraints

```sql
-- One entity per CIK + kind
UNIQUE(entities.cik, entities.kind)

-- One graph node per kind + key
UNIQUE(graph_nodes.kind, graph_nodes.key_txt)

-- One graph edge per src + dst + relation + asof
UNIQUE(graph_edges.src, graph_edges.dst, graph_edges.relation, graph_edges.asof)
```

---

## Performance Considerations

### Query Optimization

**Index Usage:**
- All foreign keys indexed
- Temporal columns (`asof`, `filed_date`) indexed
- Frequently filtered columns indexed

**Partitioning (Future):**
```sql
-- Partition large tables by date
CREATE TABLE positions_13f_2024 PARTITION OF positions_13f
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
```

**Materialized Views:**
```sql
-- Pre-aggregate latest positions
CREATE MATERIALIZED VIEW latest_positions AS
SELECT DISTINCT ON (entity_id, cusip)
  entity_id, cusip, asof, shares
FROM positions_13f
ORDER BY entity_id, cusip, asof DESC;

-- Refresh periodically
REFRESH MATERIALIZED VIEW latest_positions;
```

### Storage Optimization

**TOAST:**
- Large text fields (content, summary) stored out-of-line
- JSONB fields compressed automatically

**Vacuum:**
```sql
-- Regular maintenance
VACUUM ANALYZE entities;
VACUUM ANALYZE positions_13f;
```

---

## Related Documentation

- [Setup Guide](SETUP.md) - Database installation
- [Architecture](ARCHITECTURE.md) - System design
- [API Reference](API.md) - Query endpoints
- [Workflows](WORKFLOWS.md) - Data ingestion workflows

---

For questions or issues, see [main README](../README.md#support).
