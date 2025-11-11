#!/usr/bin/env bash
set -euo pipefail
[[ "${DEBUG:-false}" == "true" ]] && set -x

# Sync Temporal environment variables to .env.local files
# Usage: ./tools/sync-temporal-env.sh [target_dir]
#        If target_dir is provided, syncs only that directory
#        If not provided, syncs all known apps (temporal-worker, api)

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel 2>/dev/null || (cd "$HERE/.." && pwd))"

log() { echo "[sync-temporal-env] $*"; }
error() { echo "[sync-temporal-env] ERROR: $*" >&2; }

# Default Temporal configuration for local development
TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-localhost:7233}"
TEMPORAL_NAMESPACE="${TEMPORAL_NAMESPACE:-ird}"
TEMPORAL_TASK_QUEUE="${TEMPORAL_TASK_QUEUE:-rotation-detector}"

log "Using Temporal configuration:"
log "  TEMPORAL_ADDRESS=$TEMPORAL_ADDRESS"
log "  TEMPORAL_NAMESPACE=$TEMPORAL_NAMESPACE"
log "  TEMPORAL_TASK_QUEUE=$TEMPORAL_TASK_QUEUE"

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

  # Update Temporal variables
  update_var "TEMPORAL_ADDRESS" "$TEMPORAL_ADDRESS" "$env_file"
  update_var "TEMPORAL_NAMESPACE" "$TEMPORAL_NAMESPACE" "$env_file"
  update_var "TEMPORAL_TASK_QUEUE" "$TEMPORAL_TASK_QUEUE" "$env_file"

  log "  ✓ Updated Temporal configuration in $env_file"
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

log "✓ Temporal environment sync complete"
log ""
log "Note: Ensure Temporal server is running with: temporal server start-dev"
log "      Access Temporal UI at: http://localhost:8233"
