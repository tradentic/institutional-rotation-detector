-- Migration: Deprecate vector store infrastructure
-- Date: 2025-11-09
-- Purpose: Mark embedding column as deprecated (Phase 1 - no breaking changes)
--
-- Background:
-- System pivoted from vector store RAG to GraphRAG + Long Context approach.
-- Modern LLMs (GPT-4 128K, GPT-5 200K+) can handle full document context without
-- semantic pre-filtering via embeddings.
--
-- This migration marks the infrastructure as deprecated without removing it,
-- allowing for safe rollback if needed.

-- Mark embedding column as deprecated
COMMENT ON COLUMN filing_chunks.embedding IS
  'DEPRECATED (2025-11-09): No longer used. System uses GraphRAG + long context instead of vector similarity search. Will be removed in future release.';

-- Mark vector index as deprecated
COMMENT ON INDEX filing_chunks_embedding_idx IS
  'DEPRECATED (2025-11-09): No longer used. Will be dropped when embedding column is removed.';

-- Note: match_filing_chunks function was never created in migrations
-- (It may have been created manually or in earlier setup)
-- It will be safely dropped in migration 018 using DROP IF EXISTS

-- Add note to filing_chunks table
COMMENT ON TABLE filing_chunks IS
  'Stores filing text chunks for long context synthesis. Note: embedding column is deprecated and no longer used.';
