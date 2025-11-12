#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "⏰ Starting Temporal Development Server with Persistent Storage"
echo ""

# Check if temporal CLI is available
if ! command -v temporal >/dev/null 2>&1; then
  echo "❌ Temporal CLI not found."
  echo ""
  echo "Install with:"
  echo "  macOS:  brew install temporal"
  echo "  Linux:  curl -sSf https://temporal.download/cli.sh | sh"
  echo ""
  exit 1
fi

# Create data directory
DATA_DIR="${REPO_ROOT}/.temporal/data"
mkdir -p "$DATA_DIR"

DB_FILE="${DATA_DIR}/temporal.db"

echo "📁 Database location: $DB_FILE"
echo "🌐 Temporal UI:       http://localhost:8233"
echo "🔌 Temporal Server:   localhost:7233"
echo ""
echo "💡 Tip: Your namespaces, workflows, and history will persist across restarts"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Start Temporal with persistent SQLite database
exec temporal server start-dev --db-filename "$DB_FILE"
