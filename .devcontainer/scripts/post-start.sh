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

temporal_cli_present=false
temporal_server_ready=false

if command -v temporal >/dev/null 2>&1; then
  temporal_cli_present=true
else
  log "Temporal CLI not found on PATH; Temporal startup will be skipped."
fi

temporal_server_running() {
  if pgrep -f "temporal server start-dev" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

start_temporal_server() {
  if temporal_server_running; then
    log "Temporal server is already running."
    return 0
  fi

  log "Starting Temporal development server in the background..."
  nohup temporal server start-dev >/tmp/temporal-server.log 2>&1 &
  local temporal_pid=$!

  log "Temporal server started with PID $temporal_pid. Logs available at /tmp/temporal-server.log"
  return 0
}

wait_for_temporal_ready() {
  local max_attempts="${1:-30}"
  local sleep_seconds="${2:-2}"

  for attempt in $(seq 1 "$max_attempts"); do
    if temporal_server_running; then
      return 0
    fi

    if [[ "$attempt" -eq 1 ]]; then
      log "Waiting for Temporal server to become ready..."
    fi

    sleep "$sleep_seconds"
  done

  return 1
}

if [[ "$temporal_cli_present" == "true" ]]; then
  log "Checking Temporal server status..."
  if temporal_server_running; then
    log "Temporal server already running."
    temporal_server_ready=true
  else
    log "Temporal server not running; starting now..."
    if start_temporal_server; then
      if wait_for_temporal_ready 30 2; then
        log "Temporal server is ready."
        temporal_server_ready=true
      else
        log "Temporal server did not become ready in time."
      fi
    else
      log "Failed to start Temporal server."
    fi
  fi
else
  log "Skipping Temporal startup because the Temporal CLI is unavailable."
fi

if command -v pnpm >/dev/null 2>&1; then
  if [[ "${supabase_ready}" == "true" ]]; then
    echo "[post-start] Supabase is ready. Environment variables can be copied from: supabase status"
    echo "[post-start] Note: Copy SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY to apps/temporal-worker/.env"
  elif [[ "$supabase_cli_present" == "true" ]]; then
    echo "[post-start] Skipping environment sync because Supabase services are not ready." >&2
  else
    echo "[post-start] Skipping environment sync because Supabase CLI is unavailable." >&2
  fi
else
  echo "[post-start] pnpm not found." >&2
fi
