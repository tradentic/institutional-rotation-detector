-- Add microstructure integration columns to rotation_events table
-- This enables incorporating high-frequency trading signals into rotation detection
-- Reduces detection lag from 45 days (quarterly 13F) to 1-3 days (microstructure signals)

-- Add microstructure signal columns
ALTER TABLE rotation_events
ADD COLUMN IF NOT EXISTS microstructure_vpin NUMERIC,
ADD COLUMN IF NOT EXISTS microstructure_kyle_lambda NUMERIC,
ADD COLUMN IF NOT EXISTS microstructure_order_imbalance NUMERIC,
ADD COLUMN IF NOT EXISTS microstructure_confidence NUMERIC,
ADD COLUMN IF NOT EXISTS microstructure_attribution_entity_id UUID REFERENCES entities(id),
ADD COLUMN IF NOT EXISTS microstructure_detected_at TIMESTAMPTZ;

-- Add comments for documentation
COMMENT ON COLUMN rotation_events.microstructure_vpin IS 'Volume-Synchronized Probability of Informed Trading (0-1). Values >0.3 indicate informed trading activity';
COMMENT ON COLUMN rotation_events.microstructure_kyle_lambda IS 'Kyle''s lambda price impact coefficient. Higher values indicate larger institutional footprint';
COMMENT ON COLUMN rotation_events.microstructure_order_imbalance IS 'Signed order flow imbalance (-1 to +1). Negative = selling pressure, positive = buying pressure';
COMMENT ON COLUMN rotation_events.microstructure_confidence IS 'Confidence level (0-1) that microstructure signals indicate institutional rotation. Values >0.7 boost r_score';
COMMENT ON COLUMN rotation_events.microstructure_attribution_entity_id IS 'Entity ID of institution attributed via broker-level flow analysis. NULL if attribution confidence <0.6';
COMMENT ON COLUMN rotation_events.microstructure_detected_at IS 'Timestamp when microstructure signal first exceeded threshold, enabling early detection';

-- Create indexes for querying microstructure-enhanced rotation events
CREATE INDEX IF NOT EXISTS idx_rotation_events_microstructure_confidence
ON rotation_events(microstructure_confidence)
WHERE microstructure_confidence > 0.7;

CREATE INDEX IF NOT EXISTS idx_rotation_events_early_detection
ON rotation_events(microstructure_detected_at, microstructure_confidence)
WHERE microstructure_confidence > 0.7;

-- Create index for high-confidence microstructure signals (early rotation indicators)
CREATE INDEX IF NOT EXISTS idx_rotation_events_micro_signals
ON rotation_events(microstructure_confidence, microstructure_vpin, r_score)
WHERE microstructure_confidence > 0.7 AND microstructure_vpin > 0.3;

-- Add documentation for integration
COMMENT ON TABLE rotation_events IS 'Rotation event detections combining quarterly 13F filings (45-day lag) with optional microstructure signals (1-3 day lag). Microstructure signals boost r_score by up to 0.5 when confidence > 0.7';
