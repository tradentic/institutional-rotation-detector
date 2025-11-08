alter table rotation_edges
  add column if not exists root_issuer_cik text;

create index if not exists rotation_edges_period_root_idx
  on rotation_edges (period_start, root_issuer_cik);
