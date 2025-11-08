#!/usr/bin/env bash
set -euo pipefail

if [[ "${DEBUG:-false}" == "true" ]]; then
  set -x
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "[install-supabase-cli] curl is required" >&2
  exit 1
fi

install_packages() {
  local packages=(ca-certificates jq tar)
  local missing=()
  for pkg in "${packages[@]}"; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
      missing+=("$pkg")
    fi
  done

  if ((${#missing[@]} > 0)); then
    sudo apt-get update
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
    sudo rm -rf /var/lib/apt/lists/*
  fi
}

fetch_latest_version() {
  curl -fsSL https://api.github.com/repos/supabase/cli/releases/latest | jq -r '.tag_name'
}

download_and_install() {
  local version="$1"
  local arch

  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64)
      arch="amd64"
      ;;
    aarch64|arm64)
      arch="arm64"
      ;;
    *)
      echo "[install-supabase-cli] Unsupported architecture: $arch" >&2
      exit 1
      ;;
  esac

  local tmp_dir
  tmp_dir="$(mktemp -d)"

  local archive_url
  archive_url="https://github.com/supabase/cli/releases/download/${version}/supabase_linux_${arch}.tar.gz"

  curl -fsSL "$archive_url" -o "$tmp_dir/supabase.tar.gz"
  tar -xzf "$tmp_dir/supabase.tar.gz" -C "$tmp_dir"

  sudo install -m 755 "$tmp_dir/supabase" /usr/local/bin/supabase

  rm -rf "$tmp_dir"
}

main() {
  install_packages

  local requested_version
  requested_version="${SUPABASE_VERSION:-latest}"

  local version
  if [[ "$requested_version" == "latest" ]]; then
    version="$(fetch_latest_version)"
  else
    if [[ "$requested_version" != v* ]]; then
      version="v${requested_version}"
    else
      version="$requested_version"
    fi
  fi

  download_and_install "$version"

  echo -n "[install-supabase-cli] Installed Supabase CLI version: "
  supabase --version
}

main "$@"
