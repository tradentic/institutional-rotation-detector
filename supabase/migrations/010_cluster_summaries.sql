-- Cluster summaries table for GraphRAG explainability
-- Stores LLM-generated narrative summaries of rotation clusters with embeddings

CREATE TABLE IF NOT EXISTS cluster_summaries (
  cluster_id uuid PRIMARY KEY REFERENCES rotation_events(cluster_id) ON DELETE CASCADE,
  summary text NOT NULL,
  embedding vector(1536),
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

-- Index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_cluster_summaries_embedding
  ON cluster_summaries
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Function to search clusters by semantic similarity
CREATE OR REPLACE FUNCTION search_clusters_by_similarity(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  cluster_id uuid,
  summary text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cs.cluster_id,
    cs.summary,
    1 - (cs.embedding <=> query_embedding) as similarity
  FROM cluster_summaries cs
  WHERE 1 - (cs.embedding <=> query_embedding) > match_threshold
  ORDER BY cs.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

COMMENT ON TABLE cluster_summaries IS
  'LLM-generated narrative summaries of rotation clusters with embeddings for semantic search';

COMMENT ON FUNCTION search_clusters_by_similarity IS
  'Search for similar rotation clusters using vector similarity on summary embeddings';
