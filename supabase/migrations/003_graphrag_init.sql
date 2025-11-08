create table if not exists graph_nodes (
  node_id uuid primary key default gen_random_uuid(),
  kind text check (kind in ('issuer','manager','fund','etf','security','filing','index_event')) not null,
  key_txt text not null,
  name text,
  meta jsonb default '{}'::jsonb,
  unique(kind, key_txt)
);

create table if not exists graph_edges (
  edge_id uuid primary key default gen_random_uuid(),
  src uuid not null references graph_nodes(node_id) on delete cascade,
  dst uuid not null references graph_nodes(node_id) on delete cascade,
  relation text not null,
  asof date not null,
  weight numeric default 0,
  attrs jsonb default '{}'::jsonb,
  unique (src, dst, relation, asof)
);

create table if not exists graph_communities (
  community_id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  method text not null,
  summary text not null,
  meta jsonb default '{}'::jsonb
);

create table if not exists node_bindings (
  kind text not null,
  key_txt text not null,
  node_id uuid not null references graph_nodes(node_id) on delete cascade,
  primary key (kind, key_txt)
);

create table if not exists graph_explanations (
  explanation_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  question text,
  edge_ids uuid[] not null default '{}',
  accessions text[] not null default '{}',
  content text not null
);
