-- ========================================
-- Performance Indexes
-- ========================================
-- Consolidated indexes for query performance optimization

-- ========================================
-- Core Schema Indexes
-- ========================================

-- Filings
create index if not exists filings_cik_filed_date_idx on filings (cik, filed_date);
create index if not exists idx_filings_cadence on filings (cadence);
create index if not exists idx_filings_expected_publish_pending on filings (expected_publish_at)
  where published_at is null;
create index if not exists idx_filings_published_at on filings (published_at);
create index if not exists idx_filings_amendment_of_accession on filings (amendment_of_accession);
create index if not exists idx_filings_amendment_of on filings(amendment_of_accession)
  where amendment_of_accession is not null;
create index if not exists idx_filings_is_amendment on filings(is_amendment)
  where is_amendment = true;
create index if not exists idx_filings_cik_period
  on filings(cik, period_end)
  include (accession, form, filed_date, is_amendment);
create index if not exists idx_filings_form_period
  on filings(form, period_end)
  where period_end is not null;

-- Positions 13F
create index if not exists positions_13f_entity_asof_idx on positions_13f (entity_id, asof);
create index if not exists idx_positions_13f_cusip_holder_period
  on positions_13f(cusip, entity_id, asof)
  include (shares, opt_put_shares, opt_call_shares, accession);
create index if not exists idx_positions_13f_holder_period
  on positions_13f(entity_id, asof)
  include (cusip, shares, opt_put_shares, opt_call_shares);
create index if not exists idx_positions_13f_period
  on positions_13f(asof)
  include (entity_id, cusip, shares, opt_put_shares, opt_call_shares);

-- CUSIP Issuer Map
create index if not exists cusip_issuer_map_issuer_idx on cusip_issuer_map (issuer_cik);
create index if not exists idx_cusip_issuer_map_issuer
  on cusip_issuer_map(issuer_cik);

-- Entities
create index if not exists idx_entities_cik_kind
  on entities(cik, kind)
  where cik is not null;
create index if not exists idx_entities_ticker
  on entities(ticker)
  where ticker is not null;
create unique index if not exists idx_entities_ticker_kind
  on entities(ticker, kind)
  where ticker is not null;
create index if not exists idx_entities_series_id
  on entities(series_id)
  where series_id is not null;

-- Short Interest
create index if not exists idx_short_interest_cik_date
  on short_interest(cik, settle_date)
  include (short_shares);

-- UHF Positions
create index if not exists idx_uhf_positions_holder_date
  on uhf_positions(holder_id, asof)
  include (cusip, shares, source);
create index if not exists idx_uhf_positions_cusip_date
  on uhf_positions(cusip, asof)
  include (holder_id, shares, source);

-- ========================================
-- Rotation Schema Indexes
-- ========================================

-- Rotation Edges
create index if not exists rotation_edges_period_idx on rotation_edges (period_start, period_end);
create index if not exists rotation_edges_period_root_idx on rotation_edges (period_start, root_issuer_cik);
create index if not exists idx_rotation_edges_cluster
  on rotation_edges(cluster_id)
  include (seller_id, buyer_id, cusip, equity_shares, options_shares);
create index if not exists idx_rotation_edges_root_issuer
  on rotation_edges(root_issuer_cik, period_end)
  include (cluster_id, seller_id, buyer_id, equity_shares, options_shares);

-- Rotation Events
create index if not exists idx_rotation_events_issuer
  on rotation_events(issuer_cik)
  include (cluster_id, r_score, car_m5_p20, eow);
create index if not exists idx_rotation_events_score_desc
  on rotation_events(r_score desc nulls last)
  include (cluster_id, issuer_cik, car_m5_p20, eow)
  where r_score is not null;

-- Rotation Event Provenance
create index if not exists idx_provenance_cluster on rotation_event_provenance(cluster_id);
create index if not exists idx_provenance_accession on rotation_event_provenance(accession);
create index if not exists idx_provenance_entity on rotation_event_provenance(entity_id);

-- ========================================
-- Graph Schema Indexes
-- ========================================

-- Graph Edges
create index if not exists idx_edges_time on graph_edges (asof);
create index if not exists idx_edges_src on graph_edges (src);
create index if not exists idx_edges_dst on graph_edges (dst);
create index if not exists idx_edges_rel on graph_edges (relation);

-- Graph Nodes
create index if not exists idx_nodes_kind_key on graph_nodes (kind, key_txt);

-- Graph Communities
create index if not exists idx_communities_period on graph_communities (period_start, period_end);

-- Graph Explanations
create index if not exists idx_explanations_created_at on graph_explanations (created_at desc);

-- ========================================
-- Microstructure Schema Indexes
-- ========================================

-- Off-Exchange Venue Weekly
create index if not exists micro_offex_venue_weekly_sym_src_wk_idx
  on micro_offex_venue_weekly(symbol, source, week_end desc);
create index if not exists micro_offex_venue_weekly_venue_sym_idx
  on micro_offex_venue_weekly(venue_id, symbol, week_end desc)
  where venue_id is not null;
create index if not exists micro_offex_venue_weekly_large_vol_idx
  on micro_offex_venue_weekly(symbol, week_end desc, total_shares desc)
  where total_shares >= 500000;

-- Off-Exchange Symbol Weekly
create index if not exists micro_offex_symbol_weekly_sym_wk_desc_idx
  on micro_offex_symbol_weekly(symbol, week_end desc);

-- IEX Volume Daily
create index if not exists micro_iex_volume_daily_sym_date_desc_idx
  on micro_iex_volume_daily(symbol, trade_date desc);

-- Consolidated Volume Daily
create index if not exists micro_consolidated_volume_daily_sym_date_desc_idx
  on micro_consolidated_volume_daily(symbol, trade_date desc);

-- Off-Exchange Ratio
create index if not exists micro_offex_ratio_sym_gran_date_desc_idx
  on micro_offex_ratio(symbol, granularity, as_of desc);
create index if not exists micro_offex_ratio_official_idx
  on micro_offex_ratio(symbol, as_of)
  where quality_flag in ('official', 'official_partial');
create index if not exists micro_offex_ratio_daily_approx_idx
  on micro_offex_ratio(symbol, as_of)
  where granularity = 'daily' and quality_flag in ('approx', 'iex_proxy');

-- Flip50 Events
create index if not exists micro_flip50_events_sym_flip_desc_idx
  on micro_flip50_events(symbol, flip_date desc);

-- Short Interest Points
create index if not exists micro_short_interest_points_sym_date_desc_idx
  on micro_short_interest_points(symbol, settlement_date desc);

-- Broker-Institution Map
create index if not exists micro_broker_inst_broker_conf_idx
  on micro_broker_institution_map(broker_mpid, relationship_strength desc)
  where relationship_strength >= 0.7;
create index if not exists micro_broker_inst_broker_dates_idx
  on micro_broker_institution_map(broker_mpid, last_observed_date desc);
create index if not exists micro_broker_inst_active_idx
  on micro_broker_institution_map(last_observed_date desc);

-- Institutional Flow
create index if not exists micro_inst_flow_sym_date_dir_idx
  on micro_institutional_flow(symbol, trade_date desc, flow_direction);
create index if not exists micro_inst_flow_large_blocks_idx
  on micro_institutional_flow(symbol, trade_date desc, shares desc)
  where shares >= 100000;
create index if not exists micro_inst_flow_inst_sym_date_idx
  on micro_institutional_flow(institution_id, symbol, trade_date desc);
create index if not exists micro_inst_flow_broker_sym_idx
  on micro_institutional_flow(broker_mpid, symbol, trade_date desc);
create index if not exists micro_inst_flow_high_conf_idx
  on micro_institutional_flow(symbol, trade_date desc, institution_id)
  where attribution_confidence >= 0.8;

-- Trade Classification
create index if not exists micro_trade_class_high_imbal_idx
  on micro_trade_classification(symbol, trade_date desc)
  where abs(order_imbalance) > 0.3;
create index if not exists micro_trade_class_buy_imbal_idx
  on micro_trade_classification(order_imbalance desc, trade_date desc)
  where order_imbalance > 0.2;
create index if not exists micro_trade_class_sell_imbal_idx
  on micro_trade_classification(order_imbalance asc, trade_date desc)
  where order_imbalance < -0.2;
create index if not exists micro_trade_class_high_quality_idx
  on micro_trade_classification(symbol, trade_date desc)
  where quality_flag = 'HIGH';

-- Microstructure Metrics Daily
create index if not exists micro_metrics_vpin_lambda_idx
  on micro_metrics_daily(vpin desc, kyles_lambda desc, trade_date desc)
  where vpin > 0.6 and kyles_lambda is not null;
create index if not exists micro_metrics_sym_date_vpin_idx
  on micro_metrics_daily(symbol, trade_date desc, vpin);
create index if not exists micro_metrics_high_block_idx
  on micro_metrics_daily(symbol, trade_date desc)
  where block_trade_ratio > 0.15;
create index if not exists micro_metrics_adverse_sel_idx
  on micro_metrics_daily(adverse_selection_component desc, trade_date desc)
  where adverse_selection_component is not null;
create index if not exists micro_metrics_rotation_signals_idx
  on micro_metrics_daily(symbol, trade_date desc)
  include (vpin, kyles_lambda, daily_order_imbalance, block_trade_ratio)
  where vpin > 0.5 or block_trade_ratio > 0.1;
create index if not exists micro_metrics_high_quality_vpin_idx
  on micro_metrics_daily(symbol, trade_date desc, vpin)
  where vpin_quality_flag = 'HIGH' and vpin is not null;

-- ========================================
-- Statistics Targets
-- ========================================
-- Set statistics targets for better query planning on high-cardinality columns

alter table positions_13f alter column cusip set statistics 1000;
alter table positions_13f alter column entity_id set statistics 1000;
alter table filings alter column cik set statistics 1000;
alter table rotation_events alter column r_score set statistics 1000;

-- ========================================
-- Analyze Tables
-- ========================================
-- Update statistics for query planner

analyze positions_13f;
analyze filings;
analyze rotation_events;
analyze rotation_edges;
analyze short_interest;
analyze uhf_positions;
