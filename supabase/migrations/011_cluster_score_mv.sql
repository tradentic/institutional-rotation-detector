-- Materialized view for fast cluster score ranking
-- Denormalizes all scoring components and related data for efficient queries

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_cluster_score AS
SELECT
  e.cluster_id,
  e.issuer_cik,
  e.anchor_filing,

  -- Scoring components
  e.dumpz,
  e.u_same,
  e.u_next,
  e.uhf_same,
  e.uhf_next,
  e.opt_same,
  e.opt_next,
  e.shortrelief_v2,
  e.index_penalty,
  e.eow,

  -- Final score and outcomes
  e.r_score,
  e.car_m5_p20,
  e.t_to_plus20_days,
  e.max_ret_w13,

  -- Issuer metadata (joined from entities)
  i.name as issuer_name,
  i.kind as issuer_kind,

  -- Anchor filing metadata (joined from filings)
  f.form as anchor_form,
  f.filed_date as anchor_filed_date,
  f.period_end as anchor_period_end,

  -- Edge summary (aggregated from rotation_edges)
  (SELECT COUNT(DISTINCT seller_id) FROM rotation_edges re WHERE re.cluster_id = e.cluster_id) as seller_count,
  (SELECT COUNT(DISTINCT buyer_id) FROM rotation_edges re WHERE re.cluster_id = e.cluster_id) as buyer_count,
  (SELECT SUM(equity_shares) FROM rotation_edges re WHERE re.cluster_id = e.cluster_id) as total_equity_shares,
  (SELECT SUM(options_shares) FROM rotation_edges re WHERE re.cluster_id = e.cluster_id) as total_options_shares,

  -- Derived ranking metrics
  CASE
    WHEN e.r_score IS NULL THEN NULL
    WHEN e.index_penalty >= 1.0 THEN NULL -- Exclude full penalty cases
    ELSE e.r_score * (1.0 - COALESCE(e.index_penalty, 0)) -- Adjust score by index penalty
  END as adjusted_score,

  -- Quality flags
  (e.car_m5_p20 IS NOT NULL AND e.r_score IS NOT NULL) as has_full_data,
  (e.eow = true) as is_eow_dump,
  (e.index_penalty >= 0.5) as has_index_noise,
  (e.shortrelief_v2 >= 0.3) as has_short_relief,
  (e.car_m5_p20 >= 0.2) as has_positive_car,

  -- Timestamp for refresh tracking
  NOW() as refreshed_at

FROM rotation_events e
LEFT JOIN entities i ON i.cik = e.issuer_cik AND i.kind = 'issuer'
LEFT JOIN filings f ON f.accession = e.anchor_filing;

-- Create indexes on the materialized view for fast queries
CREATE UNIQUE INDEX idx_mv_cluster_score_cluster_id ON mv_cluster_score(cluster_id);
CREATE INDEX idx_mv_cluster_score_issuer ON mv_cluster_score(issuer_cik);
CREATE INDEX idx_mv_cluster_score_r_score_desc ON mv_cluster_score(r_score DESC NULLS LAST) WHERE r_score IS NOT NULL;
CREATE INDEX idx_mv_cluster_score_adjusted_desc ON mv_cluster_score(adjusted_score DESC NULLS LAST) WHERE adjusted_score IS NOT NULL;
CREATE INDEX idx_mv_cluster_score_car ON mv_cluster_score(car_m5_p20 DESC NULLS LAST) WHERE car_m5_p20 IS NOT NULL;
CREATE INDEX idx_mv_cluster_score_period ON mv_cluster_score(anchor_period_end DESC) WHERE anchor_period_end IS NOT NULL;

-- Create a filtered index for high-quality signals only
CREATE INDEX idx_mv_cluster_score_quality ON mv_cluster_score(adjusted_score DESC NULLS LAST)
WHERE
  has_full_data = true
  AND has_index_noise = false
  AND r_score >= 0.5;

-- Add comments
COMMENT ON MATERIALIZED VIEW mv_cluster_score IS
  'Denormalized cluster scores for fast ranking. Refresh periodically with REFRESH MATERIALIZED VIEW CONCURRENTLY mv_cluster_score';

COMMENT ON COLUMN mv_cluster_score.adjusted_score IS
  'R-score adjusted by index penalty: r_score * (1 - index_penalty)';

COMMENT ON COLUMN mv_cluster_score.has_full_data IS
  'True if both CAR and R-score are computed (complete analysis)';

-- Create a function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_cluster_scores()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_cluster_score;
END;
$$;

COMMENT ON FUNCTION refresh_cluster_scores IS
  'Refreshes the mv_cluster_score materialized view concurrently (non-blocking)';

-- Example queries enabled by this view:
--
-- Top 20 rotation events by adjusted score:
--   SELECT * FROM mv_cluster_score
--   WHERE has_full_data = true
--   ORDER BY adjusted_score DESC NULLS LAST
--   LIMIT 20;
--
-- High-quality EOW dumps with positive outcomes:
--   SELECT * FROM mv_cluster_score
--   WHERE is_eow_dump = true
--     AND has_positive_car = true
--     AND has_index_noise = false
--   ORDER BY adjusted_score DESC;
--
-- Recent signals (last quarter):
--   SELECT * FROM mv_cluster_score
--   WHERE anchor_period_end >= CURRENT_DATE - INTERVAL '90 days'
--     AND has_full_data = true
--   ORDER BY adjusted_score DESC;
