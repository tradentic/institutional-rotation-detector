create index if not exists filings_cik_filed_date_idx on filings (cik, filed_date);
create index if not exists idx_filings_cadence on filings (cadence);
create index if not exists idx_filings_expected_publish_pending on filings (expected_publish_at)
  where published_at is null;
create index if not exists idx_filings_published_at on filings (published_at);
create index if not exists idx_filings_amendment_of_accession on filings (amendment_of_accession);
create index if not exists positions_13f_entity_asof_idx on positions_13f (entity_id, asof);
create index if not exists cusip_issuer_map_issuer_idx on cusip_issuer_map (issuer_cik);
create index if not exists rotation_edges_period_idx on rotation_edges (period_start, period_end);
create index if not exists rotation_edges_period_root_idx on rotation_edges (period_start, root_issuer_cik);
create index if not exists idx_provenance_cluster on rotation_event_provenance(cluster_id);
create index if not exists idx_provenance_accession on rotation_event_provenance(accession);
create index if not exists idx_provenance_entity on rotation_event_provenance(entity_id);
create index if not exists filing_chunks_embedding_idx on filing_chunks using ivfflat (embedding vector_cosine_ops);
