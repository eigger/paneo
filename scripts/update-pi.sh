#!/usr/bin/env bash
# Paneo Raspberry Pi updater.
#
# Updates the Paneo server Docker image and the companion agent in place,
# preserving all data (SQLite DB, photos, plugins in the paneo-data volume).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/scripts/update-pi.sh | sudo bash
#
# Or, if the server is already running on this Pi:
#   curl -fsSL http://localhost:4321/update.sh | sudo bash

set -euo pipefail

IMAGE="${PANEO_IMAGE:-ghcr.io/eigger/paneo:latest}"
AGENT_DIR="${PANEO_AGENT_DIR:-/opt/paneo-agent}"

log()  { printf '[paneo-update] %s\n' "$*"; }
fail() { printf '[paneo-update] ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "run with sudo"

# ---------------------------------------------------------------------------
# Read existing config from systemd service files (set during install)
# ---------------------------------------------------------------------------
read_service_env() {
  local service="$1" key="$2"
  grep -m1 "Environment=${key}=" "/etc/systemd/system/${service}.service" 2>/dev/null \
    | sed -E "s/.*Environment=${key}=(.*)/\1/" | tr -d "'\""
}

SERVER="$(read_service_env paneo-agent PANEO_SERVER || true)"
TOKEN="$(read_service_env  paneo-agent PANEO_TOKEN  || true)"
SERVER="${SERVER:-http://localhost:4321}"

log "Server : $SERVER"
[ -n "$TOKEN" ] && log "Token  : ${TOKEN}"

# ---------------------------------------------------------------------------
# 1. Pull the latest server image
# ---------------------------------------------------------------------------
log "Pulling latest image: $IMAGE"
docker pull "$IMAGE"

# ---------------------------------------------------------------------------
# 2. Restart the server (uses new image on next start thanks to --rm + no -d)
# ---------------------------------------------------------------------------
if systemctl is-active --quiet paneo 2>/dev/null; then
  log "Restarting paneo server..."
  systemctl restart paneo
else
  log "paneo service is not running — starting it now"
  systemctl start paneo
fi

# ---------------------------------------------------------------------------
# 3. Wait for server to become ready
# ---------------------------------------------------------------------------
log "Waiting for server: $SERVER"
for _ in $(seq 1 30); do
  if curl -fsS "$SERVER/api/brand" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS "$SERVER/api/brand" >/dev/null 2>&1 \
  || fail "server did not become ready at $SERVER"

# ---------------------------------------------------------------------------
# 4. Update the companion agent
# ---------------------------------------------------------------------------
if [ -d "$AGENT_DIR" ] && [ -n "$TOKEN" ]; then
  log "Updating companion agent in $AGENT_DIR"
  curl -fsSL "$SERVER/agent/agent.js"      -o "$AGENT_DIR/agent.js"
  curl -fsSL "$SERVER/agent/version.json"  -o "$AGENT_DIR/version.json"

  if systemctl is-active --quiet paneo-agent 2>/dev/null; then
    log "Restarting companion agent..."
    systemctl restart paneo-agent
  fi

  log "Agent updated"
else
  log "Skipping agent update (AGENT_DIR or TOKEN not found)"
fi

# ---------------------------------------------------------------------------
# 5. Update the kiosk launcher script from GitHub
# ---------------------------------------------------------------------------
KIOSK_BIN="/usr/local/bin/paneo-kiosk"
if [ -f "$KIOSK_BIN" ]; then
  # Read the display URL embedded in the existing launcher (last non-empty line)
  DISPLAY_URL="$(grep -o 'http[^ "]*' "$KIOSK_BIN" | tail -1 || true)"
  if [ -n "$DISPLAY_URL" ]; then
    CHROME="$(grep -o '^exec [^ ]*' "$KIOSK_BIN" | awk '{print $2}' || true)"
    CHROME="${CHROME:-$(command -v chromium-browser 2>/dev/null || command -v chromium 2>/dev/null)}"
    log "Updating kiosk launcher for $DISPLAY_URL"
    cat > "$KIOSK_BIN" <<'KIOSK_EOF'
#!/usr/bin/env bash
set -e
if [ -n "${WAYLAND_DISPLAY:-}" ] || [ "${XDG_SESSION_TYPE:-}" = "wayland" ]; then
  OZONE="--ozone-platform=wayland --enable-features=UseOzonePlatform"
  wlr-randr >/dev/null 2>&1 || true
else
  export DISPLAY="${DISPLAY:-:0}"
  OZONE=""
  xset s off     >/dev/null 2>&1 || true
  xset -dpms     >/dev/null 2>&1 || true
  xset s noblank >/dev/null 2>&1 || true
fi
KIOSK_EOF
    cat >> "$KIOSK_BIN" <<EOF
exec "$CHROME" \$OZONE \\
  --kiosk --noerrdialogs --disable-infobars \\
  --disable-session-crashed-bubble \\
  --no-first-run \\
  --disable-translate \\
  --disable-features=Translate \\
  "$DISPLAY_URL"
EOF
    chmod +x "$KIOSK_BIN"
    log "Kiosk launcher updated (restart desktop session to apply)"
  fi
else
  log "Skipping kiosk launcher update (not installed)"
fi

# ---------------------------------------------------------------------------
# 6. Restart the kiosk browser
# ---------------------------------------------------------------------------
restart_kiosk() {
  [ -f "$KIOSK_BIN" ] || { log "Kiosk not installed — skipping restart"; return; }

  # Find the desktop user who owns the running chromium/kiosk process
  local kiosk_user uid runtime_dir
  kiosk_user="$(ps aux \
    | grep -E '[c]hromium.*(--kiosk|paneo-kiosk)|[p]aneo-kiosk' \
    | awk '{print $1}' | grep -v root | head -1 || true)"

  # Fall back to the SUDO_USER (who invoked sudo) or SERVICE_USER from agent service
  if [ -z "$kiosk_user" ]; then
    kiosk_user="${SUDO_USER:-$(read_service_env paneo-agent User 2>/dev/null || true)}"
  fi

  if [ -z "$kiosk_user" ]; then
    log "Could not determine kiosk user — kiosk NOT restarted"
    log "Run manually: sudo -u pi /usr/local/bin/paneo-kiosk &"
    return
  fi

  uid="$(id -u "$kiosk_user" 2>/dev/null || true)"
  runtime_dir="/run/user/$uid"

  # Kill the running kiosk/chromium (ignore if not running)
  log "Stopping kiosk (user: $kiosk_user)..."
  pkill -u "$kiosk_user" -f 'chromium.*--kiosk' 2>/dev/null || true
  pkill -u "$kiosk_user" -f 'paneo-kiosk'        2>/dev/null || true
  sleep 2

  # Detect display server: Wayland socket lives under XDG_RUNTIME_DIR
  local wayland_sock=""
  if [ -d "$runtime_dir" ]; then
    wayland_sock="$(ls "$runtime_dir"/wayland-* 2>/dev/null | head -1 | xargs -I{} basename {} 2>/dev/null || true)"
  fi

  log "Restarting kiosk as $kiosk_user..."
  if [ -n "$wayland_sock" ]; then
    # Wayland (Bookworm / Wayfire / Labwc)
    sudo -u "$kiosk_user" env \
      WAYLAND_DISPLAY="$wayland_sock" \
      XDG_RUNTIME_DIR="$runtime_dir" \
      XDG_SESSION_TYPE="wayland" \
      /usr/local/bin/paneo-kiosk &
  else
    # X11 (Bullseye / LXDE)
    local xauth="/home/$kiosk_user/.Xauthority"
    sudo -u "$kiosk_user" env \
      DISPLAY=":0" \
      XAUTHORITY="$xauth" \
      /usr/local/bin/paneo-kiosk &
  fi

  log "Kiosk restarted (display: ${wayland_sock:-:0})"
}

restart_kiosk

# ---------------------------------------------------------------------------
# 7. Summary
# ---------------------------------------------------------------------------
log "Done"
if curl -fsS "$SERVER/api/version" >/dev/null 2>&1; then
  log "Versions: $(curl -fsS "$SERVER/api/version")"
fi
log "Server logs : docker logs -f paneo"
log "Agent logs  : journalctl -u paneo-agent -f"
