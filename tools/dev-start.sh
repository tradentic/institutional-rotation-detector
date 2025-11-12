#!/bin/bash
set -e

echo "🚀 Starting Institutional Rotation Detector Development Environment"
echo ""

# Check if required commands exist
command -v supabase >/dev/null 2>&1 || { echo "❌ Supabase CLI not found. Install: brew install supabase/tap/supabase"; exit 1; }
command -v temporal >/dev/null 2>&1 || { echo "❌ Temporal CLI not found. Install: brew install temporal"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "❌ Docker not found. Install Docker Desktop"; exit 1; }

# Start Supabase
echo "📦 Starting Supabase..."
supabase start

echo ""
echo "⏰ Starting Temporal with persistent storage..."
echo "   (This will run in the foreground. Press Ctrl+C to stop)"
echo "   Data persisted to: .temporal/data/temporal.db"
echo "   Open a new terminal to start the worker."
echo ""
echo "   Next steps in a new terminal:"
echo "   1. pnpm run build:worker"
echo "   2. pnpm run start:worker"
echo ""
echo "📊 Access points:"
echo "  Supabase Studio: http://localhost:54323"
echo "  Temporal UI:     http://localhost:8233"
echo "  PostgreSQL:      postgresql://postgres:postgres@localhost:54322/postgres"
echo ""

# Create .temporal/data directory if it doesn't exist
mkdir -p .temporal/data

# Start Temporal with persistent SQLite database
temporal server start-dev --db-filename .temporal/data/temporal.db
