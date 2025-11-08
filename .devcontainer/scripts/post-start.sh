#!/usr/bin/env bash
set -euo pipefail
[[ "${DEBUG:-false}" == "true" ]] && set -x

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

log() { echo "[post-start] $*"; }

wait_for_docker_daemon() {
  local max_attempts="${1:-30}"
  local sleep_seconds="${2:-2}"

  for attempt in $(seq 1 "$max_attempts"); do
    if docker info >/dev/null 2>&1; then
      return 0
    fi

    if [[ "$attempt" -eq 1 ]]; then
      log "Waiting for Docker daemon to become ready..."
    fi

    sleep "$sleep_seconds"
  done

  return 1
}

docker_cli_present=false
docker_ready=false
supabase_cli_present=false

if command -v docker >/dev/null 2>&1; then
  docker_cli_present=true
  if wait_for_docker_daemon 40 2; then
    docker_ready=true
  else
    log "Docker daemon did not become ready; Docker-dependent services will be skipped."
  fi
else
  log "Docker CLI not available; Docker-dependent services will be skipped."
fi

if command -v supabase >/dev/null 2>&1; then
  supabase_cli_present=true
else
  log "Supabase CLI not found on PATH; Supabase startup will be skipped."
fi

supabase_status_ready() {
  local status_file
  status_file="$(mktemp)"

  if supabase status >"$status_file" 2>&1; then
    if grep -qi 'api url' "$status_file"; then
      rm -f "$status_file"
      return 0
    fi
  fi

  rm -f "$status_file"
  return 1
}

wait_for_supabase_ready() {
  local max_attempts="${1:-40}"
  local sleep_seconds="${2:-3}"

  for attempt in $(seq 1 "$max_attempts"); do
    if supabase_status_ready; then
      return 0
    fi

    if [[ "$attempt" -eq 1 ]]; then
      log "Waiting for Supabase containers to become ready..."
    fi

    sleep "$sleep_seconds"
  done

  return 1
}

start_supabase_services() {
  local output
  local exit_code

  if output="$(supabase start 2>&1)"; then
    log "Supabase services started."
    return 0
  fi

  exit_code=$?

  if grep -qi 'already running' <<<"$output"; then
    log "Supabase services are already starting or running."
    return 0
  fi

  log "'supabase start' failed (exit code $exit_code). Output:"
  echo "$output" >&2
  return "$exit_code"
}

supabase_stack_ready=false

if [[ "$docker_ready" == "true" && "$supabase_cli_present" == "true" ]]; then
  log "Checking Supabase local stack status..."
  if supabase_status_ready; then
    log "Supabase services already running."
    supabase_stack_ready=true
  else
    log "Supabase services not running; starting now..."
    if ! start_supabase_services; then
      log "Supabase start command reported an error; continuing to wait for readiness."
    fi

    if wait_for_supabase_ready 40 3; then
      log "Supabase services are ready."
      supabase_stack_ready=true
    else
      log "Supabase services did not become ready in time."
    fi
  fi
elif [[ "$supabase_cli_present" != "true" ]]; then
  log "Skipping Supabase startup because the Supabase CLI is unavailable."
elif [[ "$docker_ready" != "true" ]]; then
  log "Skipping Supabase startup because Docker is unavailable."
fi

if [[ "$docker_ready" == "true" ]]; then
  log "Redis sidecar is managed by the devcontainer Docker Compose configuration."
else
  log "Docker unavailable; unable to verify Redis sidecar status."
fi

if [[ "$supabase_stack_ready" != "true" && "$supabase_cli_present" == "true" ]]; then
  log "Supabase stack was not confirmed ready during post-start."
fi

supabase_ready="$supabase_stack_ready"

if command -v pnpm >/dev/null 2>&1; then
  if [[ "${supabase_ready}" == "true" ]]; then
    echo "[post-start] Syncing local environment files from Supabase status..."
    pnpm db:env:local
  elif [[ "$supabase_cli_present" == "true" ]]; then
    echo "[post-start] Skipping environment sync because Supabase services are not ready." >&2
  else
    echo "[post-start] Skipping environment sync because Supabase CLI is unavailable." >&2
  fi
else
  echo "[post-start] pnpm not found; cannot run db:env:local." >&2
fi
