#!/bin/bash
set -e

echo "🔍 Creating Temporal search attributes..."

# Wait for Temporal to be ready
echo "Waiting for Temporal server..."
until temporal server health 2>/dev/null; do
  echo "  Temporal not ready, waiting..."
  sleep 2
done

echo "✅ Temporal server is ready"
echo ""

# Create search attributes
echo "Creating search attributes..."

temporal operator search-attribute create \
  --namespace default \
  --name ticker --type Keyword || echo "  ticker already exists"

temporal operator search-attribute create \
  --namespace default \
  --name cik --type Keyword || echo "  cik already exists"

temporal operator search-attribute create \
  --namespace default \
  --name quarter_start --type Datetime || echo "  quarter_start already exists"

temporal operator search-attribute create \
  --namespace default \
  --name quarter_end --type Datetime || echo "  quarter_end already exists"

temporal operator search-attribute create \
  --namespace default \
  --name run_kind --type Keyword || echo "  run_kind already exists"

echo ""
echo "✅ Search attributes configured"
echo ""
echo "Verify with:"
echo "  temporal operator search-attribute list --namespace default"
