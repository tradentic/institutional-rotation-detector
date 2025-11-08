create index if not exists idx_edges_time on graph_edges (asof);
create index if not exists idx_edges_src on graph_edges (src);
create index if not exists idx_edges_dst on graph_edges (dst);
create index if not exists idx_edges_rel on graph_edges (relation);
create index if not exists idx_nodes_kind_key on graph_nodes (kind, key_txt);
create index if not exists idx_communities_period on graph_communities (period_start, period_end);
create index if not exists idx_explanations_created_at on graph_explanations (created_at desc);
