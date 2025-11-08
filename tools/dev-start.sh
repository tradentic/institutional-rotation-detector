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
echo "⏰ Starting Temporal..."
echo "   (This will run in the foreground. Press Ctrl+C to stop)"
echo "   Open a new terminal to start the worker."
echo ""
echo "   Next steps in a new terminal:"
echo "   1. cd apps/temporal-worker"
echo "   2. npm install && npm run build"
echo "   3. node dist/worker.js"
echo ""
echo "📊 Access points:"
echo "  Supabase Studio: http://localhost:54323"
echo "  Temporal UI:     http://localhost:8233"
echo "  PostgreSQL:      postgresql://postgres:postgres@localhost:54322/postgres"
echo ""

# Start Temporal (foreground)
temporal server start-dev
