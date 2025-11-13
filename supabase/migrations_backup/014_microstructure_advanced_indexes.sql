-- Migration 012: Advanced Microstructure Indexes
-- Performance indexes for broker mapping and flow attribution queries

-- ============================================================================
-- Broker-Institution Mapping Indexes
-- ============================================================================
-- Composite index for high-confidence relationships
create index if not exists micro_broker_inst_broker_conf_idx
  on micro_broker_institution_map(broker_mpid, relationship_strength desc)
  where relationship_strength >= 0.7;

-- Index for finding institutions by broker with date range
create index if not exists micro_broker_inst_broker_dates_idx
  on micro_broker_institution_map(broker_mpid, last_observed_date desc);

-- Index for active relationships (observed recently)
-- Note: Removed WHERE clause because current_date is not immutable
create index if not exists micro_broker_inst_active_idx
  on micro_broker_institution_map(last_observed_date desc);

-- ============================================================================
-- Institutional Flow Indexes
-- ============================================================================
-- Composite index for symbol + date + direction queries
create index if not exists micro_inst_flow_sym_date_dir_idx
  on micro_institutional_flow(symbol, trade_date desc, flow_direction);

-- Index for high-volume flows (blocks)
create index if not exists micro_inst_flow_large_blocks_idx
  on micro_institutional_flow(symbol, trade_date desc, shares desc)
  where shares >= 100000;

-- Index for aggregating flows by institution
create index if not exists micro_inst_flow_inst_sym_date_idx
  on micro_institutional_flow(institution_id, symbol, trade_date desc);

-- Index for broker attribution analysis
create index if not exists micro_inst_flow_broker_sym_idx
  on micro_institutional_flow(broker_mpid, symbol, trade_date desc);

-- Partial index for high-confidence attributions
create index if not exists micro_inst_flow_high_conf_idx
  on micro_institutional_flow(symbol, trade_date desc, institution_id)
  where attribution_confidence >= 0.8;

-- ============================================================================
-- Trade Classification Indexes
-- ============================================================================
-- Index for high absolute imbalance
create index if not exists micro_trade_class_high_imbal_idx
  on micro_trade_classification(symbol, trade_date desc)
  where abs(order_imbalance) > 0.3;

-- Index for heavy buy imbalance
create index if not exists micro_trade_class_buy_imbal_idx
  on micro_trade_classification(order_imbalance desc, trade_date desc)
  where order_imbalance > 0.2;

-- Index for heavy sell imbalance
create index if not exists micro_trade_class_sell_imbal_idx
  on micro_trade_classification(order_imbalance asc, trade_date desc)
  where order_imbalance < -0.2;

-- ============================================================================
-- Microstructure Metrics Indexes
-- ============================================================================
-- Composite index for finding high VPIN + high lambda stocks
create index if not exists micro_metrics_vpin_lambda_idx
  on micro_metrics_daily(vpin desc, kyles_lambda desc, trade_date desc)
  where vpin > 0.6 and kyles_lambda is not null;

-- Index for VPIN time series analysis
create index if not exists micro_metrics_sym_date_vpin_idx
  on micro_metrics_daily(symbol, trade_date desc, vpin);

-- Index for high block trade ratio
create index if not exists micro_metrics_high_block_idx
  on micro_metrics_daily(symbol, trade_date desc)
  where block_trade_ratio > 0.15;

-- Index for adverse selection screening
create index if not exists micro_metrics_adverse_sel_idx
  on micro_metrics_daily(adverse_selection_component desc, trade_date desc)
  where adverse_selection_component is not null;

-- Covering index for common rotation detection queries
create index if not exists micro_metrics_rotation_signals_idx
  on micro_metrics_daily(symbol, trade_date desc)
  include (vpin, kyles_lambda, daily_order_imbalance, block_trade_ratio)
  where vpin > 0.5 or block_trade_ratio > 0.1;

-- ============================================================================
-- Cross-table Indexes for Flow Attribution
-- ============================================================================
-- Index on micro_offex_venue_weekly for broker mapping joins
create index if not exists micro_offex_venue_weekly_venue_sym_idx
  on micro_offex_venue_weekly(venue_id, symbol, week_end desc)
  where venue_id is not null;

-- Index for large ATS volumes (potential institutional blocks)
create index if not exists micro_offex_venue_weekly_large_vol_idx
  on micro_offex_venue_weekly(symbol, week_end desc, total_shares desc)
  where total_shares >= 500000;

-- ============================================================================
-- Partial Indexes for Data Quality
-- ============================================================================
-- High-quality VPIN calculations only
create index if not exists micro_metrics_high_quality_vpin_idx
  on micro_metrics_daily(symbol, trade_date desc, vpin)
  where vpin_quality_flag = 'HIGH' and vpin is not null;

-- High-quality trade classifications only
create index if not exists micro_trade_class_high_quality_idx
  on micro_trade_classification(symbol, trade_date desc)
  where quality_flag = 'HIGH';
