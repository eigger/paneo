#!/usr/bin/env bash
# Paneo Raspberry Pi bootstrap — clone latest from GitHub, then run install-pi.sh.
#
# Pick ONE role (do not run every example):
#
# Server Pi:
#   curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh | sudo env PANEO_MODE=server bash
#
# Display Pi (kiosk + agent; needs PANEO_SERVER and PANEO_TOKEN):
#   curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh \
#     | sudo env PANEO_MODE=display PANEO_SERVER=http://<server-ip>:4321 PANEO_TOKEN=<token> bash
#
# All-in-one Pi (server + display + agent — replaces server + display steps):
#   curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh | sudo env PANEO_MODE=all bash
#
# Environment (optional):
#   PANEO_REPO      Git URL (default: https://github.com/eigger/paneo.git)
#   PANEO_REF       Branch or tag to install (default: master)
#   PANEO_INSTALL_DIR Clone target (default: /opt/paneo) — used only to fetch
#                   scripts/install-pi.sh itself; the server role no longer
#                   needs the cloned source (it runs as a Docker image, D18/D19)
#   PANEO_MODE      server | display | all (default: all)
#   PANEO_IMAGE     Docker image for server mode (default: ghcr.io/eigger/paneo:latest)
#   PANEO_*         Other variables are forwarded to scripts/install-pi.sh
#
# Server mode requires Docker (auto-installed via get.docker.com if missing).

set -euo pipefail

REPO="${PANEO_REPO:-https://github.com/eigger/paneo.git}"
REF="${PANEO_REF:-master}"
INSTALL_DIR="${PANEO_INSTALL_DIR:-/opt/paneo}"
MODE="${PANEO_MODE:-all}"
SERVICE_USER="${PANEO_USER:-${SUDO_USER:-pi}}"

log() { printf '[paneo-bootstrap] %s\n' "$*"; }
fail() { printf '[paneo-bootstrap] ERROR: %s\n' "$*" >&2; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
  fail "run with sudo, for example: curl -fsSL .../install.sh | sudo env PANEO_MODE=all bash"
fi

ensure_git() {
  if command -v git >/dev/null 2>&1; then
    return
  fi
  log "Installing git"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y git ca-certificates curl
}

clone_or_update() {
  ensure_git

  if [ -d "$INSTALL_DIR/.git" ]; then
    log "Updating $INSTALL_DIR ($REF)"
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$REF"
    git -C "$INSTALL_DIR" checkout -B "$REF" "origin/$REF" 2>/dev/null \
      || git -C "$INSTALL_DIR" reset --hard "FETCH_HEAD"
    return
  fi

  if [ -f "$INSTALL_DIR/package.json" ] && [ -f "$INSTALL_DIR/src/server.js" ]; then
    log "Using existing source at $INSTALL_DIR"
    return
  fi

  log "Cloning $REPO ($REF) to $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  rm -rf "$INSTALL_DIR"
  git clone --depth 1 --branch "$REF" "$REPO" "$INSTALL_DIR"
}

clone_or_update

if [ ! -f "$INSTALL_DIR/scripts/install-pi.sh" ]; then
  fail "installer missing at $INSTALL_DIR/scripts/install-pi.sh"
fi

if id "$SERVICE_USER" >/dev/null 2>&1; then
  chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
fi

export PANEO_DIR="$INSTALL_DIR"
export PANEO_REPO="$REPO"
export PANEO_MODE="$MODE"

log "Running scripts/install-pi.sh (PANEO_MODE=$MODE)"
exec bash "$INSTALL_DIR/scripts/install-pi.sh"
