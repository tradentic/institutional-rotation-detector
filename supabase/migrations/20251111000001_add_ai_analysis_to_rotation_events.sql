-- Add AI analysis columns to rotation_events table
-- This enables storing GPT-5 powered analysis results alongside algorithmic scores

-- Add columns for AI analysis results
ALTER TABLE rotation_events
ADD COLUMN IF NOT EXISTS anomaly_score NUMERIC,
ADD COLUMN IF NOT EXISTS suspicion_flags JSONB,
ADD COLUMN IF NOT EXISTS ai_narrative TEXT,
ADD COLUMN IF NOT EXISTS trading_implications TEXT,
ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC;

-- Add comments for documentation
COMMENT ON COLUMN rotation_events.anomaly_score IS 'AI-generated anomaly score (0-10 scale). 0-3: normal, 4-6: unusual, 7-8: suspicious, 9-10: likely false positive';
COMMENT ON COLUMN rotation_events.suspicion_flags IS 'Array of flags: HIGH_ANOMALY, EXTREME_DUMP, INDEX_REBALANCE, LOW_CONFIDENCE, SPARSE_EDGES';
COMMENT ON COLUMN rotation_events.ai_narrative IS 'GPT-5 generated narrative explanation with filing citations';
COMMENT ON COLUMN rotation_events.trading_implications IS 'Actionable trading implications and recommendations';
COMMENT ON COLUMN rotation_events.ai_confidence IS 'AI confidence level (0-1 scale) that this is a genuine rotation';

-- Create indexes for querying
CREATE INDEX IF NOT EXISTS idx_rotation_events_anomaly_score ON rotation_events(anomaly_score);
CREATE INDEX IF NOT EXISTS idx_rotation_events_suspicion_flags ON rotation_events USING GIN(suspicion_flags);
CREATE INDEX IF NOT EXISTS idx_rotation_events_ai_confidence ON rotation_events(ai_confidence);

-- Create index for high-quality signals (high confidence, low anomaly)
CREATE INDEX IF NOT EXISTS idx_rotation_events_quality_signals
ON rotation_events(ai_confidence, anomaly_score)
WHERE ai_confidence > 0.7 AND anomaly_score < 5;
