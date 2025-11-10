#!/usr/bin/env bash
set -euo pipefail
[[ "${DEBUG:-false}" == "true" ]] && set -x

# Sync API environment variables from temporal-worker
# The API app uses the same configuration as temporal-worker
# Usage: ./tools/sync-api-env.sh [--symlink]
#        Default: copies .env.local from temporal-worker to api
#        --symlink: creates a symlink instead (requires both dirs to stay in sync)

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel 2>/dev/null || cd "$HERE/.." && pwd)"

log() { echo "[sync-api-env] $*"; }
error() { echo "[sync-api-env] ERROR: $*" >&2; }

# Parse arguments
USE_SYMLINK=false
if [[ $# -gt 0 ]] && [[ "$1" == "--symlink" ]]; then
  USE_SYMLINK=true
fi

SOURCE_ENV="$ROOT/apps/temporal-worker/.env.local"
TARGET_ENV="$ROOT/apps/api/.env.local"

# Check if source exists
if [[ ! -f "$SOURCE_ENV" ]]; then
  error "Source .env.local not found: $SOURCE_ENV"
  error "Run sync-supabase-env.sh and sync-temporal-env.sh first"
  exit 1
fi

# Check if target directory exists
if [[ ! -d "$(dirname "$TARGET_ENV")" ]]; then
  error "Target directory does not exist: $(dirname "$TARGET_ENV")"
  exit 1
fi

if [[ "$USE_SYMLINK" == "true" ]]; then
  # Create symlink
  log "Creating symlink from API to temporal-worker .env.local..."

  # Remove existing file/symlink
  if [[ -e "$TARGET_ENV" ]] || [[ -L "$TARGET_ENV" ]]; then
    rm "$TARGET_ENV"
    log "  Removed existing $TARGET_ENV"
  fi

  # Create relative symlink
  ln -s "../temporal-worker/.env.local" "$TARGET_ENV"
  log "  ✓ Created symlink: $TARGET_ENV -> ../temporal-worker/.env.local"

else
  # Copy file
  log "Copying .env.local from temporal-worker to api..."

  cp "$SOURCE_ENV" "$TARGET_ENV"
  log "  ✓ Copied $SOURCE_ENV to $TARGET_ENV"

  log ""
  log "Note: Using copy mode. If you update temporal-worker/.env.local,"
  log "      run this script again to sync changes to api/.env.local"
  log "      Or use --symlink flag for automatic sync"
fi

log "✓ API environment sync complete"
log ""
log "The API app now has the same configuration as temporal-worker:"
log "  - Supabase credentials"
log "  - Temporal configuration"
log "  - OpenAI API key"
log "  - SEC user agent"
