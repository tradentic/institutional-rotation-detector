#!/usr/bin/env bash
set -euo pipefail
[[ "${DEBUG:-false}" == "true" ]] && set -x

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel 2>/dev/null || cd "$HERE/.." && pwd)"

log() { echo "[post-create] $*"; }

determine_pnpm_version() {
  if [[ -n "${PNPM_VERSION:-}" ]]; then
    echo "$PNPM_VERSION"
    return 0
  fi

  if [[ -f "$ROOT/package.json" && -x "$(command -v node || true)" ]]; then
    local from_package
    from_package="$(node -p "(() => { try { const pkg = require('$ROOT/package.json'); return pkg.packageManager || ''; } catch { return ''; } })()" 2>/dev/null || true)"
    if [[ "$from_package" == pnpm@* ]]; then
      echo "${from_package#pnpm@}"
      return 0
    fi
  fi

  echo "10.17.1"
}

ensure_pnpm() {
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  export PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"
  mkdir -p "$PNPM_HOME"
  case ":$PATH:" in
    *":$PNPM_HOME:"*) ;;
    *) export PATH="$PNPM_HOME:$PATH" ;;
  esac

  if ! command -v pnpm >/dev/null 2>&1; then
    if ! command -v corepack >/dev/null 2>&1; then
      log "ERROR: corepack not found. Install Node with Corepack enabled."
      exit 1
    fi

    corepack enable || true
    local want_pnpm
    want_pnpm="$(determine_pnpm_version)"
    log "Preparing pnpm@${want_pnpm} via corepack (non-interactive)..."
    corepack prepare "pnpm@${want_pnpm}" --activate
  fi

  pnpm config set global-bin-dir "$PNPM_HOME" >/dev/null 2>&1 || true
}

log "Ensuring pnpm is available and configured..."
ensure_pnpm

if [[ -f "$ROOT/package.json" ]]; then
  log "Installing workspace dependencies with pnpm..."
  (cd "$ROOT" && pnpm install)
else
  log "No package.json found; skipping pnpm install."
fi

log "Installing Supabase CLI..."
"$HERE/install-supabase-cli.sh"

log "post-create complete."
