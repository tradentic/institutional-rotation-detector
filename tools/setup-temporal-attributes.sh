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
until temporal operator cluster health --address "${TEMPORAL_ADDRESS}" 2>/dev/null; do
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

# Core rotation detection attributes (namespaced with ird_ prefix)
temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name ird_Ticker --type Keyword 2>/dev/null || echo "  ✓ ird_Ticker (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name ird_CIK --type Keyword 2>/dev/null || echo "  ✓ ird_CIK (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name ird_FilerCIK --type Keyword 2>/dev/null || echo "  ✓ ird_FilerCIK (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name ird_Form --type Keyword 2>/dev/null || echo "  ✓ ird_Form (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name ird_Accession --type Keyword 2>/dev/null || echo "  ✓ ird_Accession (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name ird_PeriodEnd --type Datetime 2>/dev/null || echo "  ✓ ird_PeriodEnd (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name ird_WindowKey --type Keyword 2>/dev/null || echo "  ✓ ird_WindowKey (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name ird_BatchId --type Keyword 2>/dev/null || echo "  ✓ ird_BatchId (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name ird_RunKind --type Keyword 2>/dev/null || echo "  ✓ ird_RunKind (already exists)"

echo ""
echo "🔬 Microstructure search attributes (namespaced with ird_ prefix)..."

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name ird_Symbol --type Keyword 2>/dev/null || echo "  ✓ ird_Symbol (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name ird_Dataset --type Keyword 2>/dev/null || echo "  ✓ ird_Dataset (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name ird_Granularity --type Keyword 2>/dev/null || echo "  ✓ ird_Granularity (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name ird_WeekEnd --type Datetime 2>/dev/null || echo "  ✓ ird_WeekEnd (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name ird_TradeDate --type Datetime 2>/dev/null || echo "  ✓ ird_TradeDate (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name ird_SettlementDate --type Datetime 2>/dev/null || echo "  ✓ ird_SettlementDate (already exists)"

temporal operator search-attribute create \
  --namespace "${TEMPORAL_NAMESPACE}" \
  --name ird_Provenance --type Keyword 2>/dev/null || echo "  ✓ ird_Provenance (already exists)"

echo ""
echo "✅ All search attributes configured successfully!"
echo ""
echo "📊 Verify with:"
echo "   temporal operator search-attribute list --namespace ${TEMPORAL_NAMESPACE}"
echo ""
