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
  --name Ticker --type Keyword || echo "  Ticker already exists"

temporal operator search-attribute create \
  --namespace default \
  --name CIK --type Keyword || echo "  CIK already exists"

temporal operator search-attribute create \
  --namespace default \
  --name FilerCIK --type Keyword || echo "  FilerCIK already exists"

temporal operator search-attribute create \
  --namespace default \
  --name Form --type Keyword || echo "  Form already exists"

temporal operator search-attribute create \
  --namespace default \
  --name Accession --type Keyword || echo "  Accession already exists"

temporal operator search-attribute create \
  --namespace default \
  --name PeriodEnd --type Datetime || echo "  PeriodEnd already exists"

temporal operator search-attribute create \
  --namespace default \
  --name WindowKey --type Keyword || echo "  WindowKey already exists"

temporal operator search-attribute create \
  --namespace default \
  --name BatchId --type Keyword || echo "  BatchId already exists"

temporal operator search-attribute create \
  --namespace default \
  --name RunKind --type Keyword || echo "  RunKind already exists"

echo ""
echo "✅ Search attributes configured"
echo ""
echo "Verify with:"
echo "  temporal operator search-attribute list --namespace default"
