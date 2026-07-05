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
# "all" (default): server + agent + kiosk (codecs, launcher flags, browser
# restart). "server": server + agent only — skips every kiosk-touching step,
# for a server-only install or when you don't want the kiosk browser
# interrupted right now. Positional arg takes priority so a fixed sudoers
# rule (see scripts/install-pi.sh's install_agent) can match on it directly;
# the env var still works for the plain `curl | sudo bash` usage.
MODE="${1:-${PANEO_UPDATE_MODE:-all}}"

log()  { printf '[paneo-update] %s\n' "$*"; }
fail() { printf '[paneo-update] ERROR: %s\n' "$*" >&2; exit 1; }

case "$MODE" in
  all|server) ;;
  *) fail "unknown mode: $MODE (use 'all' or 'server')" ;;
esac

[ "$(id -u)" -eq 0 ] || fail "run with sudo"

# ---------------------------------------------------------------------------
# Progress status file — the companion agent reads this on its *next*
# connection (not necessarily this run's agent process, since step 4 below
# restarts it partway through every mode) to report how the update actually
# ended back to the editor. An EXIT trap catches any failure under `set -e`
# regardless of which step it happens in; the success path overwrites it
# with "done" as the very last thing this script does.
# ---------------------------------------------------------------------------
STATUS_FILE="/tmp/paneo-update-status.json"
write_status() {
  local state="$1"
  local progress="${2:-}"
  local step="${3:-}"
  local step_msg="${4:-}"
  local error="${5:-}"

  local escaped_step
  escaped_step=$(printf '%s' "$step" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g')
  local escaped_step_msg
  escaped_step_msg=$(printf '%s' "$step_msg" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g')
  local escaped_error
  escaped_error=$(printf '%s' "$error" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g')

  local json='{'
  json="${json}\"state\":\"${state}\""
  json="${json},\"mode\":\"${MODE}\""
  json="${json},\"ts\":$(date +%s)"
  if [ -n "$progress" ]; then
    json="${json},\"progress\":${progress}"
  fi
  if [ -n "$step" ]; then
    json="${json},\"step\":\"${escaped_step}\""
  fi
  if [ -n "$step_msg" ]; then
    json="${json},\"step_msg\":\"${escaped_step_msg}\""
  fi
  if [ -n "$error" ]; then
    json="${json},\"error\":\"${escaped_error}\""
  fi
  json="${json}}"

  printf '%s\n' "$json" > "$STATUS_FILE" 2>/dev/null || true
}
trap_error() {
  local exit_code="$?"
  if [ "$exit_code" -ne 0 ]; then
    local err_msg="Update failed at command: $BASH_COMMAND (exit code: $exit_code)"
    write_status failed "" "" "" "$err_msg"
  fi
}
write_status running 0 "starting" "Starting update"
trap trap_error EXIT

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
log "Mode   : $MODE"

# ---------------------------------------------------------------------------
# 1. Pull the latest server image
# ---------------------------------------------------------------------------
log "Pulling latest image: $IMAGE"
write_status running 10 "pull_image" "Pulling latest Docker image"
docker pull "$IMAGE"

# ---------------------------------------------------------------------------
# 2. Restart the server (uses new image on next start thanks to --rm + no -d)
# ---------------------------------------------------------------------------
write_status running 30 "restart_server" "Restarting Paneo server"
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
write_status running 40 "wait_server" "Waiting for server to become ready"
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
  write_status running 50 "update_agent" "Updating companion agent files"
  curl -fsSL "$SERVER/agent/agent.js"      -o "$AGENT_DIR/agent.js"
  curl -fsSL "$SERVER/agent/version.json"  -o "$AGENT_DIR/version.json"

  # Refresh this script's own installed copy (what the agent re-invokes via
  # sudo next time) so it never drifts behind what's actually deployed.
  # download-to-temp + mv (atomic rename), NOT an in-place overwrite — this
  # script may currently be running *as* /usr/local/bin/paneo-update-pi.sh,
  # and truncating that file out from under the still-executing interpreter
  # would corrupt this very run.
  update_trigger="/usr/local/bin/paneo-update-pi.sh"
  write_status running 55 "refresh_trigger" "Refreshing update trigger script"
  if curl -fsSL "$SERVER/update.sh" -o "${update_trigger}.new"; then
    chmod +x "${update_trigger}.new"
    mv "${update_trigger}.new" "$update_trigger"
    log "Update trigger script refreshed"
  else
    rm -f "${update_trigger}.new"
    log "Could not refresh update trigger script"
  fi

  # Ensure sudoers rule for the update trigger exists
  sudoers_file="/etc/sudoers.d/paneo-agent-update"
  if [ ! -f "$sudoers_file" ]; then
    log "Sudoers rule missing. Recreating it..."
    agent_user=$(grep -E "^User=" /etc/systemd/system/paneo-agent.service 2>/dev/null | cut -d= -f2 | xargs || echo "pi")
    cat > "$sudoers_file" <<EOF
$agent_user ALL=(root) NOPASSWD: $update_trigger *
EOF
    chmod 440 "$sudoers_file"
    visudo -cf "$sudoers_file" >/dev/null || { rm -f "$sudoers_file"; log "Failed to validate generated sudoers rule"; }
  fi

  if systemctl is-active --quiet paneo-agent 2>/dev/null; then
    write_status running 60 "restart_agent" "Restarting companion agent"
    systemctl restart paneo-agent
  fi

  log "Agent updated"
else
  log "Skipping agent update (AGENT_DIR or TOKEN not found)"
fi

# ---------------------------------------------------------------------------
# 5-7. Kiosk-touching steps (codecs, launcher flags, browser restart) — only
# in "all" mode. "server" mode stops here, having updated the Docker image
# and companion agent without disturbing whatever's currently on the screen.
# ---------------------------------------------------------------------------
if [ "$MODE" != "all" ]; then
  log "Mode is '$MODE' — skipping codec install / kiosk launcher update / kiosk restart"
  write_status done 100 "done" "Update complete"
else

# ---------------------------------------------------------------------------
# 5. Best-effort: proprietary video codecs for Chromium (H.264/AAC — an .mp4
#    in paneo.photo otherwise silently fails to decode; Debian's chromium
#    package ships without them for licensing reasons). Not present in every
#    repo/arch, so failure here is not fatal — .webm videos work regardless.
# ---------------------------------------------------------------------------
if command -v apt-get >/dev/null 2>&1; then
  write_status running 70 "install_codecs" "Installing chromium video codecs"
  apt-get install -y chromium-codecs-ffmpeg-extra 2>/dev/null \
    && log "Installed chromium-codecs-ffmpeg-extra" \
    || log "chromium-codecs-ffmpeg-extra not available — skipping (unrelated to this update)"
fi

# ---------------------------------------------------------------------------
# 5b. Best-effort: display fonts (Korean Nanum + color emoji). install-pi.sh
#    installs these fresh, but a device set up before this step existed
#    (or a Pi OS image that dropped a font package) won't have them until an
#    update pulls them in too — without the emoji font in particular, weather/
#    icon glyphs render as invisible blanks on the kiosk even though they show
#    up fine in the editor on a desktop OS that already has one.
# ---------------------------------------------------------------------------
if command -v apt-get >/dev/null 2>&1; then
  write_status running 80 "install_fonts" "Installing fonts (Korean & Emoji)"
  if ! fc-list :lang=ko 2>/dev/null | grep -qi nanum; then
    apt-get install -y fonts-nanum fonts-nanum-extra 2>/dev/null \
      || apt-get install -y fonts-nanum 2>/dev/null \
      || log "Korean fonts not available — skipping"
  fi
  if ! fc-list 2>/dev/null | grep -qi "noto color emoji"; then
    apt-get install -y fonts-noto-color-emoji 2>/dev/null \
      || log "Emoji font not available — skipping"
  fi
  fc-cache -f >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------------------
# 6. Update the kiosk launcher script
# ---------------------------------------------------------------------------
KIOSK_BIN="/usr/local/bin/paneo-kiosk"
if [ -f "$KIOSK_BIN" ]; then
  DISPLAY_URL="$(grep -o 'http[^ "]*' "$KIOSK_BIN" 2>/dev/null | tail -1 || true)"
  CHROME="$(grep 'exec ' "$KIOSK_BIN" 2>/dev/null | grep -v '#' | head -1 | awk '{print $2}' || true)"
  CHROME="${CHROME:-$(command -v chromium-browser 2>/dev/null || command -v chromium 2>/dev/null || true)}"

  if [ -n "$DISPLAY_URL" ] && [ -n "$CHROME" ]; then
    log "Updating kiosk launcher for $DISPLAY_URL"
    write_status running 90 "update_kiosk" "Updating kiosk launcher"
    # Use printf instead of heredoc to avoid stdin conflict when piped via curl|bash
    printf '%s\n' \
      '#!/usr/bin/env bash' \
      'set -e' \
      '# Wait for the Paneo server before launching Chromium (reboot race condition fix)' \
      'SERVER_URL="$(grep -o '"'"'http[^ "]*'"'"' "$0" | head -1 | sed '"'"'s|/d/.*||'"'"')"' \
      'SERVER_URL="${SERVER_URL:-http://localhost:4321}"' \
      'for _i in $(seq 1 60); do' \
      '  if curl -fsS "${SERVER_URL}/api/brand" >/dev/null 2>&1; then break; fi' \
      '  sleep 2' \
      'done' \
      '' \
      'if [ -n "${WAYLAND_DISPLAY:-}" ] || [ "${XDG_SESSION_TYPE:-}" = "wayland" ]; then' \
      '  OZONE="--ozone-platform=wayland --enable-features=UseOzonePlatform"' \
      '  wlr-randr >/dev/null 2>&1 || true' \
      'else' \
      '  export DISPLAY="${DISPLAY:-:0}"' \
      '  OZONE=""' \
      '  xset s off     >/dev/null 2>&1 || true' \
      '  xset -dpms     >/dev/null 2>&1 || true' \
      '  xset s noblank >/dev/null 2>&1 || true' \
      'fi' \
      > "$KIOSK_BIN"
    printf 'exec "%s" $OZONE \\\n  --kiosk --noerrdialogs --disable-infobars \\\n  --disable-session-crashed-bubble \\\n  --no-first-run \\\n  --disable-translate \\\n  --disable-features=Translate \\\n  --password-store=basic \\\n  --autoplay-policy=no-user-gesture-required \\\n  "%s"\n' \
      "$CHROME" "$DISPLAY_URL" >> "$KIOSK_BIN"
    chmod +x "$KIOSK_BIN"
    log "Kiosk launcher updated"
  else
    log "Could not detect chrome/URL from existing launcher — skipping launcher update"
  fi
else
  log "Skipping kiosk launcher update (not installed)"
fi

# ---------------------------------------------------------------------------
# 7. Restart the kiosk browser
# ---------------------------------------------------------------------------
write_status running 95 "restart_kiosk" "Restarting kiosk browser"
log "Restarting kiosk..."

# Determine the desktop user: prefer the user who invoked sudo
KIOSK_USER="${SUDO_USER:-}"
if [ -z "$KIOSK_USER" ]; then
  # Try to read from agent service file
  KIOSK_USER="$(grep -m1 'User=' /etc/systemd/system/paneo-agent.service 2>/dev/null \
    | sed 's/User=//' | tr -d '[:space:]' || true)"
fi
KIOSK_USER="${KIOSK_USER:-pi}"

KIOSK_UID="$(id -u "$KIOSK_USER" 2>/dev/null || echo 1000)"
RUNTIME_DIR="/run/user/$KIOSK_UID"

# Kill existing kiosk/chromium processes
pkill -f 'chromium.*--kiosk' 2>/dev/null || true
pkill -f 'paneo-kiosk'       2>/dev/null || true
sleep 2

if [ -f "$KIOSK_BIN" ]; then
  # Find wayland socket (Bookworm default)
  WAYLAND_SOCK="$(ls "$RUNTIME_DIR"/wayland-* 2>/dev/null | head -1 | xargs -I{} basename {} 2>/dev/null || true)"
  DBUS_ADDR="unix:path=${RUNTIME_DIR}/bus"

  # Write a helper script so we can launch it completely detached from
  # the curl|bash pipe (background jobs in non-interactive piped bash are
  # unreliable — the helper approach is always safe).
  # Lives in /usr/local/bin/ (not /tmp) — some Pi OS images mount /tmp with
  # noexec, which intermittently blocks execution with "Permission denied".
  HELPER="/usr/local/bin/paneo-kiosk-restart.sh"
  HELPER_TMP="${HELPER}.tmp.$$"
  if [ -n "$WAYLAND_SOCK" ]; then
    cat > "$HELPER_TMP" <<HELPER_EOF
#!/usr/bin/env bash
export WAYLAND_DISPLAY="$WAYLAND_SOCK"
export XDG_RUNTIME_DIR="$RUNTIME_DIR"
export XDG_SESSION_TYPE="wayland"
export DBUS_SESSION_BUS_ADDRESS="$DBUS_ADDR"
exec /usr/local/bin/paneo-kiosk
HELPER_EOF
    log "Launching kiosk via Wayland ($WAYLAND_SOCK) as $KIOSK_USER"
  else
    cat > "$HELPER_TMP" <<HELPER_EOF
#!/usr/bin/env bash
export DISPLAY=":0"
export XAUTHORITY="/home/$KIOSK_USER/.Xauthority"
exec /usr/local/bin/paneo-kiosk
HELPER_EOF
    log "Launching kiosk via X11 as $KIOSK_USER"
  fi
  chmod +x "$HELPER_TMP"
  chown "$KIOSK_USER" "$HELPER_TMP"
  mv "$HELPER_TMP" "$HELPER"

  # Run the helper as the desktop user, fully detached.
  # Redirect to a log file so errors are visible: /tmp/paneo-kiosk.log
  if command -v at >/dev/null 2>&1; then
    # `at now` runs in a clean environment, fully detached from this session
    echo "sudo -u $KIOSK_USER $HELPER" | at now 2>/dev/null
    log "Kiosk scheduled via 'at' — check /tmp/paneo-kiosk.log if it doesn't appear"
  else
    # Fallback: nohup + double-fork via a subshell
    (
      sleep 1
      sudo -u "$KIOSK_USER" nohup "$HELPER" > /tmp/paneo-kiosk.log 2>&1 &
    ) &
    log "Kiosk launched (log: /tmp/paneo-kiosk.log)"
  fi
else
  log "Kiosk binary not found — skipping restart"
fi

fi # MODE = all

# ---------------------------------------------------------------------------
# 8. Summary
# ---------------------------------------------------------------------------
log "Done"
if curl -fsS "$SERVER/api/version" >/dev/null 2>&1; then
  log "Versions: $(curl -fsS "$SERVER/api/version")"
fi
log "Server logs : docker logs -f paneo"
log "Agent logs  : journalctl -u paneo-agent -f"

write_status done 100 "done" "Update complete"

