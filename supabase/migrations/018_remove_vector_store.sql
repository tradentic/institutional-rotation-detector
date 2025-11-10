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

-- Drop vector index (improves write performance, saves storage)
DROP INDEX IF EXISTS filing_chunks_embedding_idx;

-- Drop embedding column (saves significant storage)
-- Note: This preserves the text content, only removes embeddings
ALTER TABLE filing_chunks DROP COLUMN IF EXISTS embedding;

-- Drop cluster_summaries table if it exists (was for embedding-based search)
DROP TABLE IF EXISTS cluster_summaries;

-- Update table comment to reflect new architecture
COMMENT ON TABLE filing_chunks IS
  'Stores filing text chunks for long context synthesis. Uses graph structure + 128K context windows instead of vector embeddings.';
