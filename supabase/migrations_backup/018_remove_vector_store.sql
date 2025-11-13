-- Migration: Remove vector store infrastructure (Phase 3 - Breaking Changes)
-- Date: 2025-11-09
-- Purpose: Drop embedding column, vector indexes, and related functions
--
-- Background:
-- Phase 1 (016) marked infrastructure as deprecated.
-- Phase 2 removed application code that used embeddings.
-- This Phase 3 removes the database infrastructure entirely.
--
-- BREAKING CHANGE: This will delete all embeddings data.
-- Ensure Phase 2 code changes are deployed before running this migration.

-- Drop vector search function (no longer used)
DROP FUNCTION IF EXISTS match_filing_chunks(vector(1536), float, int, text[]);

-- Drop vector search function for cluster summaries (no longer used)
DROP FUNCTION IF EXISTS search_clusters_by_similarity(vector(1536), float, int);

-- Drop vector indexes (improves write performance, saves storage)
DROP INDEX IF EXISTS filing_chunks_embedding_idx;
DROP INDEX IF EXISTS idx_cluster_summaries_embedding;

-- Drop embedding column from filing_chunks (saves significant storage)
-- Note: This preserves the text content, only removes embeddings
ALTER TABLE filing_chunks DROP COLUMN IF EXISTS embedding;

-- Drop embedding column from cluster_summaries but KEEP the table
-- (summaries are still useful for GraphRAG, just without embeddings)
ALTER TABLE cluster_summaries DROP COLUMN IF EXISTS embedding;

-- Update table comments to reflect new architecture
COMMENT ON TABLE filing_chunks IS
  'Stores filing text chunks for long context synthesis. Uses graph structure + 128K context windows instead of vector embeddings.';

COMMENT ON TABLE cluster_summaries IS
  'LLM-generated narrative summaries of rotation clusters. Uses GraphRAG (graph structure + long context) instead of vector search.';
