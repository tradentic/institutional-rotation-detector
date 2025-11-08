# Database

Database schema, migrations, and data management for the Institutional Rotation Detector.

## Overview

The database uses **PostgreSQL 15+** with the **pgvector** extension for storing:
- SEC filings metadata and positions
- Institutional rotation events and graph edges
- Knowledge graph nodes, edges, and communities
- Vector embeddings for semantic search
- Reference data (index calendars, CUSIP mappings)

## Directory Structure

```
db/
├── migrations/               # Database schema migrations (applied in order)
│   ├── 001_init.sql         # Core schema (entities, filings, positions)
│   ├── 002_indexes.sql      # Performance indexes
│   ├── 010_graphrag_init.sql # GraphRAG tables
│   └── 011_graphrag_indexes.sql # GraphRAG indexes
└── seed/                    # Optional seed data (applied after migrations)
    └── .gitkeep
```

**Note:** For local development with Supabase:
- `supabase/migrations` is symlinked to `db/migrations/` (Supabase CLI requires migrations in this location)
- Seed data is configured via `sql_paths` in `supabase/config.toml` pointing to `db/seed/`

## Migrations

Migrations are numbered and must be applied in order.

### Migration Files

| File | Purpose | Tables Created |
|------|---------|----------------|
| `001_init.sql` | Core schema | entities, filings, cusip_issuer_map, positions_13f, bo_snapshots, uhf_positions, rotation_events, rotation_edges, index_calendar |
| `002_indexes.sql` | Performance indexes | N/A (indexes only) |
| `010_graphrag_init.sql` | GraphRAG schema | graph_nodes, graph_edges, graph_communities, node_bindings, graph_explanations |
| `011_graphrag_indexes.sql` | GraphRAG indexes | N/A (indexes only) |

### Applying Migrations

**Local Development (Supabase CLI):**
```bash
# Reset database with all migrations and seed data
supabase db reset

# Note: supabase/migrations is symlinked to db/migrations/
# Migrations are applied in order, followed by any files in db/seed/
```

**Production or Direct PostgreSQL:**
```bash
# Apply all migrations in order
psql -d rotation_detector -f db/migrations/001_init.sql
psql -d rotation_detector -f db/migrations/002_indexes.sql
psql -d rotation_detector -f db/migrations/010_graphrag_init.sql
psql -d rotation_detector -f db/migrations/011_graphrag_indexes.sql
```

**Production Supabase:**
```bash
# Connect to Supabase database
psql "postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres"

# Run migrations
\i db/migrations/001_init.sql
\i db/migrations/002_indexes.sql
\i db/migrations/010_graphrag_init.sql
\i db/migrations/011_graphrag_indexes.sql
```

**Verification:**
```sql
-- Check tables were created
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Verify pgvector extension
SELECT * FROM pg_extension WHERE extname = 'vector';
```

## Seed Data

The `db/seed/` directory contains optional SQL files for populating the database with initial or test data.

### Creating Seed Files

Seed files are executed in alphabetical order after migrations:

```bash
# Example: Create a seed file with test data
cat > db/seed/01_test_entities.sql << 'EOF'
-- Insert test entities
INSERT INTO entities (cik, name, kind) VALUES
  ('0000320193', 'Apple Inc.', 'issuer'),
  ('0001067983', 'Berkshire Hathaway', 'manager')
ON CONFLICT (cik, kind) DO NOTHING;

-- Insert CUSIP mapping
INSERT INTO cusip_issuer_map (cusip, issuer_cik) VALUES
  ('037833100', '0000320193')
ON CONFLICT (cusip) DO NOTHING;
EOF
```

### Applying Seed Data

**Local Development:**
```bash
# Seed data is automatically applied with migrations
supabase db reset
```

**Production:**
```bash
# Apply seed files manually if needed
psql -d rotation_detector -f db/seed/01_test_entities.sql
```

**Best Practices:**
- Use `ON CONFLICT ... DO NOTHING` for idempotent inserts
- Prefix files with numbers for ordering (01_, 02_, etc.)
- Keep seed data separate from migrations
- Use seed data for reference data, test data, or initial configuration

## Schema Overview

### Core Tables (001_init.sql)

#### `entities`
Institutional entities (managers, funds, issuers, ETFs).

```sql
CREATE TABLE entities (
  entity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cik text,                    -- SEC Central Index Key
  name text NOT NULL,          -- Entity name
  kind text NOT NULL,          -- 'issuer', 'manager', 'fund', 'etf'
  UNIQUE(cik, kind)
);
```

**Usage:** Central registry of all institutional entities.

#### `filings`
SEC filing metadata (13F, N-PORT, beneficial ownership).

```sql
CREATE TABLE filings (
  accession text PRIMARY KEY,  -- SEC accession number
  cik text NOT NULL,           -- Filer's CIK
  form text NOT NULL,          -- Form type (13F-HR, NPORT-P, etc.)
  filed_date date NOT NULL,    -- Filing date
  period_end date,             -- Reporting period end
  event_date date,             -- Event date (for BO filings)
  url text NOT NULL            -- SEC URL
);
```

**Usage:** Tracks all downloaded filings for deduplication and reference.

#### `positions_13f`
13F position holdings.

```sql
CREATE TABLE positions_13f (
  entity_id uuid REFERENCES entities,
  cusip text NOT NULL,              -- Security identifier
  asof date NOT NULL,               -- Position date
  shares bigint DEFAULT 0,          -- Equity shares
  opt_put_shares bigint DEFAULT 0,  -- Put option shares
  opt_call_shares bigint DEFAULT 0, -- Call option shares
  accession text REFERENCES filings(accession),
  PRIMARY KEY (entity_id, cusip, asof, accession)
);
```

**Usage:** Point-in-time snapshots of institutional holdings.

#### `rotation_events`
Detected institutional rotation events.

```sql
CREATE TABLE rotation_events (
  cluster_id text PRIMARY KEY,
  issuer_cik text NOT NULL,
  anchor_filing text,          -- Reference filing
  dumpz numeric,               -- Dump magnitude (z-score)
  u_same numeric,              -- Uptake same quarter
  u_next numeric,              -- Uptake next quarter
  uhf_same numeric,            -- UHF same quarter
  uhf_next numeric,            -- UHF next quarter
  opt_same numeric,            -- Options same quarter
  opt_next numeric,            -- Options next quarter
  shortrelief_v2 numeric,      -- Short interest relief
  index_penalty numeric,       -- Index rebalance penalty
  eow boolean,                 -- End-of-window flag
  r_score numeric,             -- Overall rotation score
  car_m5_p20 numeric,          -- Cumulative abnormal return
  t_to_plus20_days integer,    -- Time to +20 days
  max_ret_w13 numeric          -- Max return week 13
);
```

**Usage:** Stores scored rotation events with all signal components.

#### `rotation_edges`
Graph edges representing institutional flows.

```sql
CREATE TABLE rotation_edges (
  cluster_id text,
  period_start date,
  period_end date,
  seller_id text,              -- Selling entity
  buyer_id text,               -- Buying entity
  cusip text,                  -- Security
  equity_shares numeric,       -- Equity flow
  options_shares numeric,      -- Options flow
  confidence numeric,          -- Edge confidence score
  notes text
);
```

**Usage:** Represents flows between institutional entities for graph analysis.

### GraphRAG Tables (010_graphrag_init.sql)

#### `graph_nodes`
Knowledge graph nodes.

```sql
CREATE TABLE graph_nodes (
  node_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,          -- Node type
  key_txt text NOT NULL,       -- Unique key
  name text,                   -- Display name
  meta jsonb DEFAULT '{}'::jsonb,
  UNIQUE(kind, key_txt)
);
```

**Node Types:**
- `issuer` - Public companies
- `manager` - Investment managers
- `fund` - Mutual funds
- `etf` - Exchange-traded funds
- `security` - Securities (stocks, bonds)
- `filing` - SEC filings
- `index_event` - Index rebalance events

#### `graph_edges`
Knowledge graph edges.

```sql
CREATE TABLE graph_edges (
  edge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  src uuid REFERENCES graph_nodes(node_id) ON DELETE CASCADE,
  dst uuid REFERENCES graph_nodes(node_id) ON DELETE CASCADE,
  relation text NOT NULL,      -- Edge type
  asof date NOT NULL,          -- Temporal marker
  weight numeric DEFAULT 0,    -- Edge weight
  attrs jsonb DEFAULT '{}'::jsonb,
  UNIQUE (src, dst, relation, asof)
);
```

**Relation Types:**
- `holds` - Entity holds security
- `sold` - Entity sold security
- `bought` - Entity bought security
- `filed` - Entity filed report
- `mentions` - Filing mentions entity

#### `graph_communities`
Detected communities from graph clustering.

```sql
CREATE TABLE graph_communities (
  community_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  method text NOT NULL,        -- 'louvain', 'pagerank', etc.
  summary text NOT NULL,       -- AI-generated summary
  meta jsonb DEFAULT '{}'::jsonb
);
```

**Usage:** Stores results of community detection algorithms with AI summaries.

### Reference Tables

#### `cusip_issuer_map`
Maps CUSIP identifiers to issuer CIKs.

```sql
CREATE TABLE cusip_issuer_map (
  cusip text PRIMARY KEY,
  issuer_cik text NOT NULL
);
```

#### `index_calendar`
Russell index rebalance dates.

```sql
CREATE TABLE index_calendar (
  event_date date PRIMARY KEY,
  index_name text,
  event_type text
);
```

**Usage:** Helps identify rotation events during index rebalancing.

## Indexes

### Performance Indexes (002_indexes.sql)

Critical indexes for query performance:

```sql
-- Filing lookups
CREATE INDEX idx_filings_cik_filed ON filings(cik, filed_date);

-- Position queries
CREATE INDEX idx_positions_cusip_asof ON positions_13f(cusip, asof);
CREATE INDEX idx_positions_entity_asof ON positions_13f(entity_id, asof);

-- Rotation event queries
CREATE INDEX idx_rotation_events_issuer ON rotation_events(issuer_cik);

-- Graph queries
CREATE INDEX idx_rotation_edges_period_issuer ON rotation_edges(period_start, root_issuer_cik);
```

### GraphRAG Indexes (011_graphrag_indexes.sql)

Indexes for graph traversal and queries:

```sql
-- Node lookups
CREATE INDEX idx_graph_nodes_kind_key ON graph_nodes(kind, key_txt);

-- Edge traversal
CREATE INDEX idx_graph_edges_src ON graph_edges(src);
CREATE INDEX idx_graph_edges_dst ON graph_edges(dst);
CREATE INDEX idx_graph_edges_relation ON graph_edges(relation);

-- Community queries
CREATE INDEX idx_graph_communities_period ON graph_communities(period_start, period_end);
```

## Data Types

### Temporal Types

All dates use `DATE` type (YYYY-MM-DD):
- `filed_date` - When filing was submitted
- `period_end` - Reporting period end
- `asof` - Point-in-time snapshot date

### Numeric Types

- `bigint` - Large integers (share counts)
- `numeric` - Precise decimals (scores, percentages)
- `real` - Approximate decimals (less critical metrics)

### JSON Types

- `jsonb` - Binary JSON for metadata and attributes
  - Faster queries than `json`
  - Supports indexing with GIN

## Common Queries

### Get Rotation Events for Ticker

```sql
SELECT re.*
FROM rotation_events re
JOIN entities e ON e.cik = re.issuer_cik
WHERE e.kind = 'issuer'
  AND e.name ILIKE '%APPLE%'
ORDER BY re.r_score DESC;
```

### Get Position History

```sql
SELECT p.asof, p.shares, e.name as holder
FROM positions_13f p
JOIN entities e ON e.entity_id = p.entity_id
WHERE p.cusip = '037833100'  -- AAPL CUSIP
  AND p.asof >= '2024-01-01'
ORDER BY p.asof, p.shares DESC;
```

### Find Graph Communities

```sql
SELECT
  c.community_id,
  c.period_start,
  c.summary,
  COUNT(DISTINCT n.node_id) as node_count
FROM graph_communities c
JOIN graph_edges e ON e.asof BETWEEN c.period_start AND c.period_end
JOIN graph_nodes n ON n.node_id IN (e.src, e.dst)
WHERE c.period_start = '2024-01-01'
GROUP BY c.community_id, c.period_start, c.summary;
```

### Calculate Institutional Ownership

```sql
SELECT
  e.name,
  SUM(p.shares) as total_shares
FROM positions_13f p
JOIN entities e ON e.entity_id = p.entity_id
WHERE p.cusip = '037833100'
  AND p.asof = '2024-03-31'
GROUP BY e.name
ORDER BY total_shares DESC
LIMIT 20;
```

## Maintenance

### Vacuum and Analyze

```sql
-- After large data loads
VACUUM ANALYZE entities;
VACUUM ANALYZE filings;
VACUUM ANALYZE positions_13f;
VACUUM ANALYZE rotation_events;
VACUUM ANALYZE graph_nodes;
VACUUM ANALYZE graph_edges;
```

### Monitor Table Sizes

```sql
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Check Index Usage

```sql
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;
```

## Backup and Restore

### Backup

```bash
# Full database backup
pg_dump -Fc rotation_detector > backup.dump

# Schema only
pg_dump -s rotation_detector > schema.sql

# Specific tables
pg_dump -t rotation_events -t rotation_edges rotation_detector > events.sql
```

### Restore

```bash
# Restore from custom format
pg_restore -d rotation_detector backup.dump

# Restore from SQL
psql rotation_detector < schema.sql
```

## Troubleshooting

### pgvector Extension Not Available

```sql
-- Check if extension is installed
SELECT * FROM pg_available_extensions WHERE name = 'vector';

-- Install if missing
CREATE EXTENSION vector;
```

### Slow Queries

```sql
-- Enable slow query logging
ALTER DATABASE rotation_detector SET log_min_duration_statement = 1000;

-- Check running queries
SELECT pid, query, now() - query_start as duration
FROM pg_stat_activity
WHERE state = 'active'
ORDER BY duration DESC;
```

### Disk Space Issues

```sql
-- Find largest tables
SELECT
  tablename,
  pg_size_pretty(pg_total_relation_size(tablename::text)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(tablename::text) DESC;

-- Drop old data (example: old positions)
DELETE FROM positions_13f WHERE asof < '2020-01-01';
VACUUM FULL positions_13f;
```

## Related Documentation

- [Setup Guide](../docs/SETUP.md) - Database installation and configuration
- [Architecture](../docs/ARCHITECTURE.md) - Database design principles
- [Data Model](../docs/DATA_MODEL.md) - Detailed schema reference (Phase 2)

---

For questions or issues, see [main README](../README.md#support).
