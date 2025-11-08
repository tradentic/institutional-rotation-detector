-- Covering indexes for query optimization
-- These indexes include commonly queried columns to avoid table lookups

-- positions_13f: Most common query pattern is by CUSIP and holder for a time range
CREATE INDEX IF NOT EXISTS idx_positions_13f_cusip_holder_period
  ON positions_13f(cusip, entity_id, asof)
  INCLUDE (shares, opt_put_shares, opt_call_shares, accession);

-- positions_13f: Query by holder and period for portfolio analysis
CREATE INDEX IF NOT EXISTS idx_positions_13f_holder_period
  ON positions_13f(entity_id, asof)
  INCLUDE (cusip, shares, opt_put_shares, opt_call_shares);

-- positions_13f: Query by period for market-wide analysis
CREATE INDEX IF NOT EXISTS idx_positions_13f_period
  ON positions_13f(asof)
  INCLUDE (entity_id, cusip, shares, opt_put_shares, opt_call_shares);

-- filings: Query by CIK and period for issuer analysis
CREATE INDEX IF NOT EXISTS idx_filings_cik_period
  ON filings(cik, period_end)
  INCLUDE (accession, form, filed_date, is_amendment);

-- filings: Query by form type and period
CREATE INDEX IF NOT EXISTS idx_filings_form_period
  ON filings(form, period_end)
  WHERE period_end IS NOT NULL;

-- rotation_edges: Query by cluster for provenance
CREATE INDEX IF NOT EXISTS idx_rotation_edges_cluster
  ON rotation_edges(cluster_id)
  INCLUDE (seller_id, buyer_id, cusip, equity_shares, options_shares);

-- rotation_edges: Query by root issuer for aggregation
CREATE INDEX IF NOT EXISTS idx_rotation_edges_root_issuer
  ON rotation_edges(root_issuer_cik, period_end)
  INCLUDE (cluster_id, seller_id, buyer_id, equity_shares, options_shares);

-- rotation_events: Query by issuer for history
CREATE INDEX IF NOT EXISTS idx_rotation_events_issuer
  ON rotation_events(issuer_cik)
  INCLUDE (cluster_id, r_score, car_m5_p20, eow);

-- rotation_events: Query by score for ranking (descending)
CREATE INDEX IF NOT EXISTS idx_rotation_events_score_desc
  ON rotation_events(r_score DESC NULLS LAST)
  INCLUDE (cluster_id, issuer_cik, car_m5_p20, eow)
  WHERE r_score IS NOT NULL;

-- short_interest: Query by CIK and date range
CREATE INDEX IF NOT EXISTS idx_short_interest_cik_date
  ON short_interest(cik, settle_date)
  INCLUDE (short_shares);

-- uhf_positions: Query by holder and date
CREATE INDEX IF NOT EXISTS idx_uhf_positions_holder_date
  ON uhf_positions(holder_id, asof)
  INCLUDE (cusip, shares, source);

-- uhf_positions: Query by CUSIP for uptake analysis
CREATE INDEX IF NOT EXISTS idx_uhf_positions_cusip_date
  ON uhf_positions(cusip, asof)
  INCLUDE (holder_id, shares, source);

-- cusip_issuer_map: Already has primary key on cusip, add reverse lookup
CREATE INDEX IF NOT EXISTS idx_cusip_issuer_map_issuer
  ON cusip_issuer_map(issuer_cik);

-- entities: Query by CIK and kind
CREATE INDEX IF NOT EXISTS idx_entities_cik_kind
  ON entities(cik, kind)
  WHERE cik IS NOT NULL;

-- Add statistics targets for better query planning on high-cardinality columns
ALTER TABLE positions_13f ALTER COLUMN cusip SET STATISTICS 1000;
ALTER TABLE positions_13f ALTER COLUMN entity_id SET STATISTICS 1000;
ALTER TABLE filings ALTER COLUMN cik SET STATISTICS 1000;
ALTER TABLE rotation_events ALTER COLUMN r_score SET STATISTICS 1000;

-- Analyze tables to update statistics
ANALYZE positions_13f;
ANALYZE filings;
ANALYZE rotation_events;
ANALYZE rotation_edges;
ANALYZE short_interest;
ANALYZE uhf_positions;
