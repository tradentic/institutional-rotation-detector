create index if not exists filings_cik_filed_date_idx on filings (cik, filed_date);
create index if not exists positions_13f_entity_asof_idx on positions_13f (entity_id, asof);
create index if not exists rotation_edges_period_idx on rotation_edges (period_start, period_end);
create index if not exists filing_chunks_embedding_idx on filing_chunks using ivfflat (embedding vector_cosine_ops);
