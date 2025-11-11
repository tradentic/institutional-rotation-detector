#!/usr/bin/env bash
set -euo pipefail
[[ "${DEBUG:-false}" == "true" ]] && set -x

# Sync Supabase environment variables from 'supabase status' to .env.local files
# Usage: ./tools/sync-supabase-env.sh [target_dir]
#        If target_dir is provided, syncs only that directory
#        If not provided, syncs all known apps (temporal-worker, api)

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel 2>/dev/null || (cd "$HERE/.." && pwd))"

log() { echo "[sync-supabase-env] $*"; }
error() { echo "[sync-supabase-env] ERROR: $*" >&2; }

# Check if supabase CLI is available
if ! command -v supabase >/dev/null 2>&1; then
  error "Supabase CLI not found. Install with: brew install supabase/tap/supabase"
  exit 1
fi

# Check if Supabase is running
if ! supabase status >/dev/null 2>&1; then
  error "Supabase is not running. Start with: supabase start"
  exit 1
fi

# Extract Supabase credentials from status using env format
log "Extracting Supabase credentials from 'supabase status -o env'..."
SUPABASE_ENV=$(supabase status -o env 2>&1)

if [[ "${DEBUG:-false}" == "true" ]]; then
  log "Raw supabase status output:"
  echo "$SUPABASE_ENV"
  log "---"
fi

# Extract values from env format (KEY="value")
# Using sed to extract the value between quotes
SUPABASE_URL=$(echo "$SUPABASE_ENV" | grep "^API_URL=" | sed 's/^API_URL="\(.*\)"$/\1/')
DATABASE_URL=$(echo "$SUPABASE_ENV" | grep "^DB_URL=" | sed 's/^DB_URL="\(.*\)"$/\1/')

# Try new key names first (PUBLISHABLE_KEY, SECRET_KEY), fall back to old names (ANON_KEY, SERVICE_ROLE_KEY)
SUPABASE_ANON_KEY=$(echo "$SUPABASE_ENV" | grep "^PUBLISHABLE_KEY=" | sed 's/^PUBLISHABLE_KEY="\(.*\)"$/\1/')
if [[ -z "$SUPABASE_ANON_KEY" ]]; then
  SUPABASE_ANON_KEY=$(echo "$SUPABASE_ENV" | grep "^ANON_KEY=" | sed 's/^ANON_KEY="\(.*\)"$/\1/')
fi

SUPABASE_SERVICE_ROLE_KEY=$(echo "$SUPABASE_ENV" | grep "^SECRET_KEY=" | sed 's/^SECRET_KEY="\(.*\)"$/\1/')
if [[ -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
  SUPABASE_SERVICE_ROLE_KEY=$(echo "$SUPABASE_ENV" | grep "^SERVICE_ROLE_KEY=" | sed 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/')
fi

# Validate extracted values
if [[ -z "$SUPABASE_URL" ]] || [[ -z "$SUPABASE_ANON_KEY" ]] || [[ -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
  error "Failed to extract Supabase credentials from 'supabase status -o env'"
  error ""
  error "Expected output format (new or old):"
  error '  API_URL="http://..."'
  error '  PUBLISHABLE_KEY="sb_publishable_..." (or ANON_KEY="eyJ...")'
  error '  SECRET_KEY="sb_secret_..." (or SERVICE_ROLE_KEY="eyJ...")'
  error '  DB_URL="postgresql://..."'
  error ""
  error "Actual output:"
  echo "$SUPABASE_ENV" | head -20
  error ""
  error "Tip: Run 'supabase status -o env' manually to see the full output"
  error "     Run with DEBUG=true for verbose output"
  exit 1
fi

log "Extracted credentials:"
log "  SUPABASE_URL=$SUPABASE_URL"
log "  SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:0:20}..."
log "  SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY:0:20}..."
log "  DATABASE_URL=$DATABASE_URL"

# Function to update or create .env.local file
update_env_file() {
  local target_dir="$1"
  local env_file="$target_dir/.env.local"

  log "Updating $env_file..."

  # Create .env.local from .env.example if it doesn't exist
  if [[ ! -f "$env_file" ]]; then
    if [[ -f "$target_dir/.env.example" ]]; then
      log "  Creating $env_file from .env.example"
      cp "$target_dir/.env.example" "$env_file"
    else
      log "  Creating new $env_file"
      touch "$env_file"
    fi
  fi

  # Helper function to update or add a variable
  update_var() {
    local var_name="$1"
    local var_value="$2"
    local file="$3"

    if grep -q "^${var_name}=" "$file"; then
      # Variable exists, update it
      if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|^${var_name}=.*|${var_name}=${var_value}|" "$file"
      else
        sed -i "s|^${var_name}=.*|${var_name}=${var_value}|" "$file"
      fi
    else
      # Variable doesn't exist, add it
      echo "${var_name}=${var_value}" >> "$file"
    fi
  }

  # Update Supabase variables
  update_var "SUPABASE_URL" "$SUPABASE_URL" "$env_file"
  update_var "SUPABASE_ANON_KEY" "$SUPABASE_ANON_KEY" "$env_file"
  update_var "SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_SERVICE_ROLE_KEY" "$env_file"
  update_var "DATABASE_URL" "$DATABASE_URL" "$env_file"

  log "  ✓ Updated Supabase credentials in $env_file"
}

# Determine target directories
if [[ $# -gt 0 ]]; then
  # Single target provided
  TARGET_DIR="$1"
  if [[ ! -d "$TARGET_DIR" ]]; then
    error "Target directory does not exist: $TARGET_DIR"
    exit 1
  fi
  update_env_file "$TARGET_DIR"
else
  # Update all known app directories
  log "Root directory: $ROOT"
  APPS=(
    "$ROOT/apps/temporal-worker"
    "$ROOT/apps/api"
    "$ROOT/apps/admin"
  )

  for app_dir in "${APPS[@]}"; do
    if [[ -d "$app_dir" ]]; then
      update_env_file "$app_dir"
    else
      log "Skipping $app_dir (directory not found)"
    fi
  done
fi

log "✓ Supabase environment sync complete"
log ""
log "Next steps:"
log "  1. Verify credentials: cat apps/temporal-worker/.env.local"
log "  2. Add your OPENAI_API_KEY and SEC_USER_AGENT if not already set"
log "  3. Run sync-temporal-env.sh to configure Temporal settings"
