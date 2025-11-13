-- ========================================
-- Rotation Detection Schema
-- ========================================
-- This migration creates tables for storing institutional rotation events,
-- their provenance, and relationship edges between buyers/sellers.

-- ========================================
-- ROTATION EVENTS
-- ========================================
-- Detected institutional rotation events with scoring and analysis

create table rotation_events (
  cluster_id uuid primary key default gen_random_uuid(),
  issuer_cik text not null,
  anchor_filing text references filings(accession),

  -- Core scoring components (v4.1)
  dumpz numeric,                  -- Dump magnitude (z-score)
  u_same numeric,                 -- Uptake same quarter
  u_next numeric,                 -- Uptake next quarter
  uhf_same numeric,               -- Ultra-high-frequency same
  uhf_next numeric,               -- Ultra-high-frequency next
  opt_same numeric,               -- Options overlay same
  opt_next numeric,               -- Options overlay next
  shortrelief_v2 numeric,         -- Short interest relief
  index_penalty numeric,          -- Index rebalancing penalty
  eow boolean,                    -- End-of-window flag
  r_score numeric,                -- Final rotation score

  -- Event study outcomes
  car_m5_p20 numeric,             -- Cumulative abnormal return [-5, +20] days
  t_to_plus20_days int,           -- Days to reach +20% threshold
  max_ret_w13 numeric,            -- Maximum return in week 13

  -- AI-powered analysis (v5.1)
  anomaly_score numeric,          -- AI anomaly score (0-10)
  suspicion_flags jsonb,          -- Array of suspicion flags
  ai_narrative text,              -- GPT-5 generated narrative
  trading_implications text,      -- Actionable trading guidance
  ai_confidence numeric,          -- AI confidence level (0-1)

  -- Microstructure integration
  microstructure_vpin numeric,                    -- VPIN toxicity (0-1)
  microstructure_kyle_lambda numeric,             -- Kyle's lambda (price impact)
  microstructure_order_imbalance numeric,         -- Order flow imbalance (-1 to +1)
  microstructure_confidence numeric,              -- Micro signal confidence (0-1)
  microstructure_attribution_entity_id uuid references entities(entity_id),
  microstructure_detected_at timestamptz,         -- Early detection timestamp

  -- Insider signals (Form 4)
  insider_net_flow_same_quarter bigint,           -- Net insider buying/selling same quarter
  insider_net_flow_next_quarter bigint,           -- Net insider flow next quarter
  insider_post_dump_buying boolean,               -- Insider buying post-dump (contrarian)
  insider_pre_dump_selling boolean,               -- Insider selling pre-dump (validation)
  insider_signal_strength numeric,                -- Composite insider signal
  insider_confidence numeric check (insider_confidence between 0 and 1),

  -- Options signals (UnusualWhales)
  options_pre_dump_put_surge boolean,             -- Unusual put buying pre-dump
  options_pre_dump_put_volume bigint,             -- Put volume in pre-dump window
  options_pre_dump_pc_ratio numeric,              -- Put/Call ratio pre-dump
  options_post_dump_call_buildup boolean,         -- Call volume/OI building post-dump
  options_post_dump_call_volume bigint,           -- Call volume post-dump
  options_post_dump_iv_decline boolean,           -- IV declined post-dump
  options_unusual_activity_count integer,         -- Count of unusual activity events
  options_signal_strength numeric,                -- Composite options signal
  options_confidence numeric check (options_confidence between 0 and 1),

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table rotation_events is 'Institutional rotation events combining quarterly 13F data with AI analysis and microstructure signals';

-- Core components
comment on column rotation_events.dumpz is 'Dump magnitude z-score (median/MAD). Threshold: 1.5σ';
comment on column rotation_events.u_same is 'Institutional uptake same quarter (% of float)';
comment on column rotation_events.u_next is 'Institutional uptake next quarter (% of float)';
comment on column rotation_events.eow is 'End-of-window flag (dump in last 5 days of quarter)';
comment on column rotation_events.r_score is 'Final rotation score (weighted combination of all signals)';

-- AI analysis
comment on column rotation_events.anomaly_score is 'AI anomaly score (0-10). 0-3: normal, 4-6: unusual, 7-8: suspicious, 9-10: false positive';
comment on column rotation_events.suspicion_flags is 'Flags: HIGH_ANOMALY, EXTREME_DUMP, INDEX_REBALANCE, LOW_CONFIDENCE, SPARSE_EDGES';
comment on column rotation_events.ai_narrative is 'GPT-5 generated narrative with filing citations';
comment on column rotation_events.trading_implications is 'Actionable trading recommendations';
comment on column rotation_events.ai_confidence is 'AI confidence (0-1) that this is genuine rotation';

-- Microstructure
comment on column rotation_events.microstructure_vpin is 'VPIN toxicity (0-1). >0.3 indicates informed trading';
comment on column rotation_events.microstructure_kyle_lambda is 'Price impact coefficient. Higher = larger institutional footprint';
comment on column rotation_events.microstructure_order_imbalance is 'Order imbalance (-1 to +1). Negative = sell pressure';
comment on column rotation_events.microstructure_confidence is 'Micro signal confidence (0-1). >0.7 boosts r_score';
comment on column rotation_events.microstructure_detected_at is 'Early detection timestamp (1-3 day lag vs 45-day 13F)';

-- Insider signals
comment on column rotation_events.insider_net_flow_same_quarter is 'Net insider buying (+) or selling (-) in shares during same quarter as dump';
comment on column rotation_events.insider_net_flow_next_quarter is 'Net insider buying/selling in quarter following dump';
comment on column rotation_events.insider_post_dump_buying is 'Whether insiders bought shares in 30 days after dump (contrarian signal)';
comment on column rotation_events.insider_pre_dump_selling is 'Whether insiders sold shares in 30 days before dump (validation signal)';
comment on column rotation_events.insider_signal_strength is 'Composite insider signal strength for scoring algorithm';

-- Options signals
comment on column rotation_events.options_pre_dump_put_surge is 'Whether unusual put buying occurred in 10 days before dump (leading indicator)';
comment on column rotation_events.options_pre_dump_pc_ratio is 'Put/Call ratio in pre-dump window. >2.0 = strong bearish signal';
comment on column rotation_events.options_post_dump_call_buildup is 'Whether call volume/OI building after dump (uptake confirmation)';
comment on column rotation_events.options_post_dump_iv_decline is 'Whether IV declined post-dump (reduced fear = confidence in uptake)';
comment on column rotation_events.options_signal_strength is 'Composite options signal strength for scoring algorithm';

-- ========================================
-- ROTATION EDGES
-- ========================================
-- Directed edges showing flows from sellers to buyers

create table rotation_edges (
  cluster_id uuid default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  seller_id uuid references entities(entity_id),
  buyer_id uuid references entities(entity_id),
  cusip text not null,
  equity_shares bigint default 0,
  options_shares bigint default 0,
  confidence numeric check (confidence between 0 and 1) default 0.8,
  notes text,
  root_issuer_cik text,
  created_at timestamptz default now(),
  primary key (cluster_id, seller_id, buyer_id, cusip)
);

comment on table rotation_edges is 'Directed edges showing institutional flows (seller → buyer) for rotation events';
comment on column rotation_edges.equity_shares is 'Equity shares transferred';
comment on column rotation_edges.options_shares is 'Options shares (share-equivalent) transferred';
comment on column rotation_edges.confidence is 'Confidence level (0-1) that this edge represents actual transfer';

-- ========================================
-- ROTATION EVENT PROVENANCE
-- ========================================
-- Tracks which SEC filings contributed to each rotation event

create table rotation_event_provenance (
  cluster_id uuid references rotation_events(cluster_id) on delete cascade,
  accession text references filings(accession),
  role text check (role in ('anchor', 'seller', 'buyer', 'uhf', 'context')) not null,
  entity_id uuid references entities(entity_id),
  contribution_weight numeric default 0,
  primary key (cluster_id, accession, role)
);

comment on table rotation_event_provenance is 'Audit trail linking rotation events to source SEC filings';
comment on column rotation_event_provenance.role is 'Filing role: anchor (dump), seller, buyer, uhf (N-PORT/ETF), context';
comment on column rotation_event_provenance.contribution_weight is 'Relative contribution (0-1) of this filing to the event';
