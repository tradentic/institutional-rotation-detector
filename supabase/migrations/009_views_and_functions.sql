-- ========================================
-- Views and Functions
-- ========================================
-- Amendment handling views, materialized views for performance,
-- and utility functions.

-- ========================================
-- AMENDMENT VIEWS
-- ========================================
-- Views for handling filing amendments (13F/A, N-PORT/A, etc.)

-- View: current_filings
-- Returns only the most recent version of each filing
create or replace view current_filings as
with amendment_chains as (
  -- Build chains of amendments: original -> amendment1 -> amendment2 -> ...
  -- Find the "head" (most recent) filing in each chain
  select distinct on (coalesce(amendment_of_accession, accession))
    accession,
    cik,
    form,
    filed_date,
    period_end,
    event_date,
    url,
    cadence,
    expected_publish_at,
    published_at,
    is_amendment,
    amendment_of_accession,
    coalesce(amendment_of_accession, accession) as chain_root
  from filings
  order by coalesce(amendment_of_accession, accession), filed_date desc, accession desc
)
select
  accession,
  cik,
  form,
  filed_date,
  period_end,
  event_date,
  url,
  cadence,
  expected_publish_at,
  published_at,
  is_amendment,
  amendment_of_accession
from amendment_chains;

comment on view current_filings is 'Shows only the latest version of each filing, filtering out superseded amendments';

-- View: current_positions_13f
-- Returns positions from current_filings only (excludes superseded filings)
create or replace view current_positions_13f as
select p.*
from positions_13f p
where p.accession in (select accession from current_filings);

comment on view current_positions_13f is 'Shows positions from current filings only (excludes positions from superseded filings)';

-- View: superseded_filings
-- Returns filings that have been superseded by amendments
create or replace view superseded_filings as
select f.*
from filings f
where exists (
  select 1 from filings amendments
  where amendments.amendment_of_accession = f.accession
);

comment on view superseded_filings is 'Shows filings that have been superseded by amendments';

-- View: filing_history
-- Shows the full amendment history for each filing chain
create or replace view filing_history as
with recursive amendment_chain as (
  -- Start with original filings (not amendments)
  select
    accession,
    cik,
    form,
    filed_date,
    period_end,
    is_amendment,
    amendment_of_accession,
    accession as root_accession,
    0 as amendment_depth,
    array[accession] as chain
  from filings
  where is_amendment = false

  union all

  -- Recursively find amendments
  select
    f.accession,
    f.cik,
    f.form,
    f.filed_date,
    f.period_end,
    f.is_amendment,
    f.amendment_of_accession,
    ac.root_accession,
    ac.amendment_depth + 1,
    ac.chain || f.accession
  from filings f
  inner join amendment_chain ac on f.amendment_of_accession = ac.accession
)
select * from amendment_chain
order by root_accession, amendment_depth;

comment on view filing_history is 'Shows the full amendment chain history for each filing';

-- ========================================
-- CLUSTER SCORE MATERIALIZED VIEW
-- ========================================
-- Denormalized view for fast cluster score ranking

create materialized view mv_cluster_score as
select
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

  -- AI analysis
  e.anomaly_score,
  e.ai_confidence,

  -- Microstructure
  e.microstructure_vpin,
  e.microstructure_confidence,

  -- Insider & options
  e.insider_signal_strength,
  e.options_signal_strength,

  -- Issuer metadata (joined from entities)
  i.name as issuer_name,
  i.kind as issuer_kind,

  -- Anchor filing metadata (joined from filings)
  f.form as anchor_form,
  f.filed_date as anchor_filed_date,
  f.period_end as anchor_period_end,

  -- Edge summary (aggregated from rotation_edges)
  (select count(distinct seller_id) from rotation_edges re where re.cluster_id = e.cluster_id) as seller_count,
  (select count(distinct buyer_id) from rotation_edges re where re.cluster_id = e.cluster_id) as buyer_count,
  (select sum(equity_shares) from rotation_edges re where re.cluster_id = e.cluster_id) as total_equity_shares,
  (select sum(options_shares) from rotation_edges re where re.cluster_id = e.cluster_id) as total_options_shares,

  -- Derived ranking metrics
  case
    when e.r_score is null then null
    when e.index_penalty >= 1.0 then null -- Exclude full penalty cases
    else e.r_score * (1.0 - coalesce(e.index_penalty, 0)) -- Adjust score by index penalty
  end as adjusted_score,

  -- Quality flags
  (e.car_m5_p20 is not null and e.r_score is not null) as has_full_data,
  (e.eow = true) as is_eow_dump,
  (e.index_penalty >= 0.5) as has_index_noise,
  (e.shortrelief_v2 >= 0.3) as has_short_relief,
  (e.car_m5_p20 >= 0.2) as has_positive_car,

  -- Timestamp for refresh tracking
  now() as refreshed_at

from rotation_events e
left join entities i on i.cik = e.issuer_cik and i.kind = 'issuer'
left join filings f on f.accession = e.anchor_filing;

-- Create indexes on the materialized view for fast queries
create unique index idx_mv_cluster_score_cluster_id on mv_cluster_score(cluster_id);
create index idx_mv_cluster_score_issuer on mv_cluster_score(issuer_cik);
create index idx_mv_cluster_score_r_score_desc on mv_cluster_score(r_score desc nulls last) where r_score is not null;
create index idx_mv_cluster_score_adjusted_desc on mv_cluster_score(adjusted_score desc nulls last) where adjusted_score is not null;
create index idx_mv_cluster_score_car on mv_cluster_score(car_m5_p20 desc nulls last) where car_m5_p20 is not null;
create index idx_mv_cluster_score_period on mv_cluster_score(anchor_period_end desc) where anchor_period_end is not null;

-- Create a filtered index for high-quality signals only
create index idx_mv_cluster_score_quality on mv_cluster_score(adjusted_score desc nulls last)
where
  has_full_data = true
  and has_index_noise = false
  and r_score >= 0.5;

comment on materialized view mv_cluster_score is
  'Denormalized cluster scores for fast ranking. Refresh periodically with REFRESH MATERIALIZED VIEW CONCURRENTLY mv_cluster_score';

comment on column mv_cluster_score.adjusted_score is
  'R-score adjusted by index penalty: r_score * (1 - index_penalty)';

comment on column mv_cluster_score.has_full_data is
  'True if both CAR and R-score are computed (complete analysis)';

-- ========================================
-- UTILITY FUNCTIONS
-- ========================================

-- Function to refresh the cluster score materialized view
create or replace function refresh_cluster_scores()
returns void
language plpgsql
as $$
begin
  refresh materialized view concurrently mv_cluster_score;
end;
$$;

comment on function refresh_cluster_scores is
  'Refreshes the mv_cluster_score materialized view concurrently (non-blocking)';
