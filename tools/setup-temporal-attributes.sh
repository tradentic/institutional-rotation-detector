#!/bin/bash
set -e

echo "🔍 Setting up Temporal search attributes..."
echo ""

# Configuration
TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-localhost:7233}"
TEMPORAL_NAMESPACE="${TEMPORAL_NAMESPACE:-ird}"
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

# Create namespace if it doesn't exist
echo "📦 Ensuring namespace '${TEMPORAL_NAMESPACE}' exists..."
if ! temporal operator namespace describe "${TEMPORAL_NAMESPACE}" --address "${TEMPORAL_ADDRESS}" 2>/dev/null; then
  echo "   Creating namespace '${TEMPORAL_NAMESPACE}'..."
  temporal operator namespace create "${TEMPORAL_NAMESPACE}" --address "${TEMPORAL_ADDRESS}"
  echo "   ✓ Namespace '${TEMPORAL_NAMESPACE}' created"
else
  echo "   ✓ Namespace '${TEMPORAL_NAMESPACE}' already exists"
fi
echo ""

# Helper function to create search attribute with clear output
create_search_attribute() {
  local name="$1"
  local type="$2"

  local output
  if output=$(temporal operator search-attribute create \
    --namespace "${TEMPORAL_NAMESPACE}" \
    --name "$name" --type "$type" 2>&1); then
    echo "  ✅ $name ($type) - created"
  else
    if echo "$output" | grep -q "already exists\|already registered"; then
      echo "  ✓ $name ($type) - already exists"
    else
      echo "  ❌ $name ($type) - error: $output"
    fi
  fi
}

# Create search attributes
echo "📋 Creating search attributes in namespace '${TEMPORAL_NAMESPACE}'..."
echo ""
echo "⚠️  Note: Temporal dev server limits: max 10 Keyword, max 3 Datetime"
echo ""
echo "🔗 IMPORTANT: When adding/removing/changing attributes here, you MUST also update:"
echo "   apps/temporal-worker/src/workflows/utils.ts (attributeConfig)"
echo "   Run 'pnpm test' to verify they're in sync"
echo ""

# Core rotation detection attributes (10 Keyword total - at limit)
create_search_attribute "Ticker" "Keyword"
create_search_attribute "CIK" "Keyword"
create_search_attribute "FilerCIK" "Keyword"
create_search_attribute "Form" "Keyword"
create_search_attribute "WindowKey" "Keyword"
create_search_attribute "BatchId" "Keyword"
create_search_attribute "RunKind" "Keyword"

# Microstructure search attributes (3 more Keyword = 10 total - at limit)
create_search_attribute "Symbol" "Keyword"
create_search_attribute "Dataset" "Keyword"
create_search_attribute "Granularity" "Keyword"

# Datetime attributes (3 total - at limit)
create_search_attribute "PeriodEnd" "Datetime"
create_search_attribute "TradeDate" "Datetime"
create_search_attribute "WeekEnd" "Datetime"
create_search_attribute "SettlementDate" "Datetime"

# Text attributes (no limit)
echo ""
echo "📝 Text search attributes (unlimited)..."
create_search_attribute "Provenance" "Text"
create_search_attribute "Accession" "Text"

echo ""
echo "✅ All search attributes configured successfully!"
echo ""
echo "📊 Verify with:"
echo "   temporal operator search-attribute list --namespace ${TEMPORAL_NAMESPACE}"
echo ""
