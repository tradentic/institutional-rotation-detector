#!/bin/bash
set -e

echo "🔍 Setting up Temporal search attributes..."
echo ""

# Configuration
TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-localhost:7233}"
TEMPORAL_NAMESPACE="${TEMPORAL_NAMESPACE:-default}"
MAX_RETRIES=30
RETRY_DELAY=2

# Wait for Temporal to be ready
echo "⏳ Waiting for Temporal server at ${TEMPORAL_ADDRESS}..."
RETRIES=0
until temporal server health --address "${TEMPORAL_ADDRESS}" 2>/dev/null; do
  if [ $RETRIES -ge $MAX_RETRIES ]; then
    echo "❌ Temporal server did not become ready after ${MAX_RETRIES} attempts"
    echo "   Make sure Temporal is running: temporal server start-dev"
    exit 1
  fi
  echo "   Temporal not ready, waiting... (attempt $((RETRIES+1))/${MAX_RETRIES})"
  sleep $RETRY_DELAY
  RETRIES=$((RETRIES+1))
done

echo "✅ Temporal server is ready"
echo ""

# Create search attributes
echo "📋 Creating search attributes in namespace '${TEMPORAL_NAMESPACE}'..."
echo ""

# Core rotation detection attributes
temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name Ticker --type Keyword 2>/dev/null || echo "  ✓ Ticker (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name CIK --type Keyword 2>/dev/null || echo "  ✓ CIK (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name FilerCIK --type Keyword 2>/dev/null || echo "  ✓ FilerCIK (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name Form --type Keyword 2>/dev/null || echo "  ✓ Form (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name Accession --type Keyword 2>/dev/null || echo "  ✓ Accession (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name PeriodEnd --type Datetime 2>/dev/null || echo "  ✓ PeriodEnd (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name WindowKey --type Keyword 2>/dev/null || echo "  ✓ WindowKey (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name BatchId --type Keyword 2>/dev/null || echo "  ✓ BatchId (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name RunKind --type Keyword 2>/dev/null || echo "  ✓ RunKind (already exists)"

echo ""
echo "🔬 Microstructure search attributes..."

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name Symbol --type Keyword 2>/dev/null || echo "  ✓ Symbol (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name Dataset --type Keyword 2>/dev/null || echo "  ✓ Dataset (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name Granularity --type Keyword 2>/dev/null || echo "  ✓ Granularity (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name WeekEnd --type Datetime 2>/dev/null || echo "  ✓ WeekEnd (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name TradeDate --type Datetime 2>/dev/null || echo "  ✓ TradeDate (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name SettlementDate --type Datetime 2>/dev/null || echo "  ✓ SettlementDate (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name Provenance --type Keyword 2>/dev/null || echo "  ✓ Provenance (already exists)"

echo ""
echo "✅ All search attributes configured successfully!"
echo ""
echo "📊 Verify with:"
echo "   temporal operator search-attribute list --namespace ${TEMPORAL_NAMESPACE}"
echo ""
