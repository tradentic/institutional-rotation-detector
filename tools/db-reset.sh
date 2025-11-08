#!/bin/bash
set -e

echo "🗄️  Resetting database..."
echo ""
echo "⚠️  WARNING: This will delete all data and re-apply migrations!"
read -p "Are you sure? (y/N) " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 1
fi

# Reset database with migrations and seed data
# Note: Migrations via symlink (supabase/migrations -> db/migrations)
#       Seed data via sql_paths config in supabase/config.toml
echo "Resetting database with migrations from db/migrations/..."
if [ -d "db/seed" ] && [ "$(ls -A db/seed)" ]; then
  echo "Seed data from db/seed/ will also be applied..."
fi

supabase db reset

echo ""
echo "✅ Database reset complete"
echo ""
echo "Migrations applied from: db/migrations/"
if [ -d "db/seed" ] && [ "$(ls -A db/seed)" ]; then
  echo "Seed data applied from: db/seed/"
fi
echo ""
echo "Verify with:"
echo "  psql postgresql://postgres:postgres@localhost:54322/postgres -c '\dt'"
