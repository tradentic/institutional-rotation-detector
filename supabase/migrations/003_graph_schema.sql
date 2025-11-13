-- ========================================
-- Knowledge Graph Schema (GraphRAG)
-- ========================================
-- This migration creates the knowledge graph infrastructure for relationship
-- analysis using graph algorithms (Louvain, PageRank) and long context synthesis.
-- No vector embeddings - uses graph structure + 128K-200K token context windows.

-- ========================================
-- GRAPH NODES
-- ========================================
-- Nodes represent entities, securities, filings, or events

create table graph_nodes (
  node_id uuid primary key default gen_random_uuid(),
  kind text check (kind in ('issuer','manager','fund','etf','security','filing','index_event')) not null,
  key_txt text not null,
  name text,
  meta jsonb default '{}'::jsonb,
  unique(kind, key_txt)
);

comment on table graph_nodes is 'Graph nodes representing entities, securities, filings, or events';
comment on column graph_nodes.kind is 'Node type: issuer, manager, fund, etf, security, filing, index_event';
comment on column graph_nodes.key_txt is 'Unique identifier within kind (e.g., CIK, CUSIP, accession)';
comment on column graph_nodes.meta is 'Additional metadata as JSON';

-- ========================================
-- NODE BINDINGS
-- ========================================
-- Lookup table for fast node resolution by (kind, key)

create table node_bindings (
  kind text not null,
  key_txt text not null,
  node_id uuid not null references graph_nodes(node_id) on delete cascade,
  primary key (kind, key_txt)
);

comment on table node_bindings is 'Fast lookup for graph nodes by (kind, key)';

-- ========================================
-- GRAPH EDGES
-- ========================================
-- Directed edges representing relationships between nodes

create table graph_edges (
  edge_id uuid primary key default gen_random_uuid(),
  src uuid not null references graph_nodes(node_id) on delete cascade,
  dst uuid not null references graph_nodes(node_id) on delete cascade,
  relation text not null,
  asof date not null,
  weight numeric default 0,
  attrs jsonb default '{}'::jsonb,
  unique (src, dst, relation, asof)
);

comment on table graph_edges is 'Directed edges showing relationships (holds, bought, sold, etc.)';
comment on column graph_edges.relation is 'Relationship type: holds, bought, sold, filed, participated_in';
comment on column graph_edges.weight is 'Edge weight (e.g., number of shares, confidence level)';
comment on column graph_edges.asof is 'Date when relationship was valid';

-- ========================================
-- GRAPH COMMUNITIES
-- ========================================
-- Detected communities using Louvain or other graph algorithms

create table graph_communities (
  community_id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  method text not null,
  summary text not null,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

comment on table graph_communities is 'Detected graph communities using Louvain algorithm';
comment on column graph_communities.method is 'Detection method: louvain, girvan_newman, etc.';
comment on column graph_communities.summary is 'AI-generated summary of community behavior';

-- ========================================
-- CLUSTER SUMMARIES
-- ========================================
-- AI-generated narrative summaries of rotation clusters

create table cluster_summaries (
  cluster_id uuid primary key references rotation_events(cluster_id) on delete cascade,
  summary text not null,
  key_entities text[],
  patterns_identified text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table cluster_summaries is 'LLM-generated narrative summaries of rotation clusters (uses GraphRAG + long context, no vector search)';
comment on column cluster_summaries.key_entities is 'Top entities involved in the rotation';
comment on column cluster_summaries.patterns_identified is 'Detected patterns (e.g., "coordinated_selling", "sector_rotation")';

-- ========================================
-- GRAPH EXPLANATIONS
-- ========================================
-- Cached AI-generated explanations for graph queries

create table graph_explanations (
  explanation_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  question text,
  edge_ids uuid[] not null default '{}',
  accessions text[] not null default '{}',
  content text not null
);

comment on table graph_explanations is 'Cached AI-generated explanations for graph traversal queries';
comment on column graph_explanations.edge_ids is 'Graph edge IDs included in the explanation';
comment on column graph_explanations.accessions is 'Filing accessions cited in the explanation';
