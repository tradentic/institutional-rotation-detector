-- Seed iShares ETF entities (Problem 3: Entity Creation Consistency)
--
-- Strategy:
-- This migration uses a phased approach because the full schema doesn't exist yet:
-- 1. Migration 005 (this): Seed base entities with series IDs as temporary CIK
-- 2. Migration 019: Adds ticker column
-- 3. Migration 020: Adds datasource_type and datasource_config columns
-- 4. Migration 021: Updates with ticker and datasource configuration
-- 5. Migration 022: Migrates series IDs to proper column and sets trust CIK
--
-- At this stage (005), only these columns exist: entity_id, cik, name, kind
-- We temporarily use series IDs in the cik column to satisfy unique(cik, kind)
-- constraint, since we need to insert 4 ETFs that will share the same trust CIK.
--
-- All four ETFs are part of iShares Trust (CIK 0001100663) tracking Russell indices.

insert into entities (cik, name, kind)
values
  ('S000004347', 'iShares Russell 1000 ETF', 'etf'),
  ('S000004344', 'iShares Russell 2000 ETF', 'etf'),
  ('S000004348', 'iShares Russell 2000 Value ETF', 'etf'),
  ('S000004349', 'iShares Micro-Cap ETF', 'etf')
on conflict (cik, kind) do update set
  name = excluded.name;
