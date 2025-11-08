#!/bin/bash
set -e

echo "🗄️  Resetting database..."
echo ""
echo "⚠️  WARNING: This will delete all data!"
read -p "Are you sure? (y/N) " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 1
fi

# Copy migrations to Supabase directory
echo "Copying migrations..."
mkdir -p supabase/migrations

cp db/migrations/001_init.sql supabase/migrations/20240101000001_init.sql
cp db/migrations/002_indexes.sql supabase/migrations/20240101000002_indexes.sql
cp db/migrations/010_graphrag_init.sql supabase/migrations/20240101000010_graphrag_init.sql
cp db/migrations/011_graphrag_indexes.sql supabase/migrations/20240101000011_graphrag_indexes.sql

# Reset database
echo "Resetting database..."
supabase db reset

echo ""
echo "✅ Database reset complete"
echo ""
echo "Verify with:"
echo "  psql postgresql://postgres:postgres@localhost:54322/postgres -c '\dt'"
