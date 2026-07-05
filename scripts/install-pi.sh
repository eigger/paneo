#!/usr/bin/env bash
# Paneo Raspberry Pi one-click installer.
#
# Modes (pick ONE per device — do not run all examples):
#   PANEO_MODE=server   Paneo server, as a Docker container managed by systemd (docs/design.md D18/D19).
#   PANEO_MODE=display  Chromium kiosk + companion agent (needs PANEO_SERVER, PANEO_TOKEN).
#                        These run directly on the host (not containerized) — they need
#                        OS-level access (vcgencmd/wlr-randr/xset, the display server itself)
#                        that a container can't reach.
#   PANEO_MODE=all      Server + kiosk + agent on one Pi (replaces server + display steps).
#
# Examples:
#   curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh | sudo env PANEO_MODE=server bash
#   curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh | sudo env PANEO_MODE=all bash
#
# Server mode installs Docker (via get.docker.com) if it isn't already present.

set -euo pipefail

# See install.sh's own `trap '' HUP` for why — this is normally already
# inherited from install.sh (an ignored signal disposition survives `exec`,
# unlike a handler-based trap), but this script can also be run directly
# (e.g. from an already-cloned checkout), so it sets its own too.
trap '' HUP

MODE="${PANEO_MODE:-${1:-all}}"
PORT="${PANEO_PORT:-4321}"
SERVER="${PANEO_SERVER:-http://localhost:${PORT}}"
TOKEN="${PANEO_TOKEN:-}"
DEVICE_NAME="${PANEO_DEVICE_NAME:-Raspberry Pi}"
IMAGE="${PANEO_IMAGE:-ghcr.io/eigger/paneo:latest}"
AGENT_DIR="${PANEO_AGENT_DIR:-/opt/paneo-agent}"
SERVICE_USER="${PANEO_USER:-${SUDO_USER:-pi}}"
ENABLE_AGENT="${PANEO_ENABLE_AGENT:-1}"
ENABLE_KIOSK="${PANEO_ENABLE_KIOSK:-1}"
# Every curl call against $SERVER below uses this — without an explicit
# timeout, a curl that can't connect (vs. one that's cleanly refused) can
# hang far longer than any retry loop expects, which looks identical to the
# whole script having silently died (no error, no more log output, nothing).
CURL_OPTS=(--connect-timeout 3 --max-time 8)

log() { printf '[paneo-install] %s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }
fail() { printf '[paneo-install] %s ERROR: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >&2; exit 1; }

# Everything below is also written to a log file that survives even if the
# terminal/SSH session itself has a problem (this install has died silently
# mid-way twice already with no visible error at all — a durable log is the
# only way to know what was actually happening at the moment it stopped).
LOG_FILE="/var/log/paneo-install.log"
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
exec > >(tee -a "$LOG_FILE") 2>&1
log "install starting, pid=$$, ppid=$PPID, mode=${PANEO_MODE:-${1:-all}}"

# On ANY exit (normal, `set -e` abort, or most signals — not SIGKILL, which
# nothing can trap), report the exact exit code and the command that was
# running at the time. This is the single most useful thing to have if the
# script disappears again with no other explanation.
trap 'ec=$?; log "EXITING code=$ec last_command=[$BASH_COMMAND] line=$LINENO"' EXIT
trap 'log "received SIGTERM"; exit 143' TERM
trap 'log "received SIGINT"; exit 130' INT

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    fail "run with sudo, for example: sudo env PANEO_MODE=${MODE} bash scripts/install-pi.sh"
  fi
}

user_home() {
  getent passwd "$SERVICE_USER" | cut -d: -f6
}

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  node -e "const [maj,min]=process.versions.node.split('.').map(Number); process.exit(maj > 22 || (maj === 22 && min >= 5) ? 0 : 1)"
}

# Only the companion agent needs Node on the host (§4.1 D) — it needs
# vcgencmd/wlr-randr/xset, which a container can't reach. The server itself
# no longer needs Node here at all; it runs as the prebuilt Docker image.
install_node() {
  if node_ok; then
    log "Node.js OK: $(node --version)"
    return
  fi

  log "Installing Node.js 24.x from NodeSource"
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
  node_ok || fail "Node.js 22.5+ is required"
}

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    log "Docker OK: $(docker --version)"
  else
    log "Installing Docker"
    curl -fsSL https://get.docker.com | sh
  fi
  systemctl enable --now docker
}

install_server() {
  need_root
  install_docker

  log "Pulling $IMAGE"
  docker pull "$IMAGE"

  # Runs as root (not $SERVICE_USER) — controlling the Docker daemon needs
  # root or docker-group membership either way, and this keeps the unit
  # simple. `--rm` + foreground `docker run` (no -d) so the docker CLI
  # process IS the service's main PID — systemd tracks/restarts it directly,
  # and the ExecStartPre cleans up a same-named container left behind by an
  # unclean stop. Data (SQLite/photos/plugins) lives in the `paneo-data`
  # named volume, not the container, so `docker rm` between restarts is safe.
  log "Writing systemd service: paneo (Docker)"
  cat > /etc/systemd/system/paneo.service <<EOF
[Unit]
Description=Paneo Server (Docker)
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
ExecStartPre=-/usr/bin/docker rm -f paneo
ExecStart=/usr/bin/docker run --rm --name paneo -p ${PORT}:4321 -v paneo-data:/data ${IMAGE}
ExecStop=/usr/bin/docker stop -t 10 paneo
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now paneo
  wait_for_server
  log "Paneo server is running at $SERVER (image: $IMAGE)"
}

wait_for_server() {
  log "Waiting for server: $SERVER (call from: ${FUNCNAME[1]:-main}, pid=$$)"
  for i in $(seq 1 30); do
    log "...attempt $i/30 starting"
    if curl -fsS "${CURL_OPTS[@]}" "$SERVER/api/brand" >/dev/null 2>&1; then
      log "...server responded on attempt $i/30"
      return
    fi
    log "...attempt $i/30 failed (curl exit=$?)"
    sleep 1
  done
  systemctl status paneo --no-pager || true
  fail "server did not become ready at $SERVER"
}

create_token_if_needed() {
  log "create_token_if_needed: start (TOKEN=${TOKEN:-<empty>})"
  if [ -n "$TOKEN" ]; then
    return
  fi

  wait_for_server
  log "create_token_if_needed: server ready, querying existing devices"

  # If the database already has devices (e.g. paneo-data volume reused from a
  # previous install), reuse an existing token instead of creating a duplicate.
  #   1. Try to find a device whose name matches $DEVICE_NAME.
  #   2. If none matches, use the first device in the list.
  #   3. Only create a NEW device when the list is completely empty.
  local devices_json
  devices_json="$(curl -fsS "${CURL_OPTS[@]}" "$SERVER/api/devices" 2>/dev/null || echo '[]')"

  # Extract token for a device whose name matches DEVICE_NAME (case-insensitive)
  TOKEN="$(printf '%s' "$devices_json" \
    | grep -o "{[^}]*\"name\":\"$DEVICE_NAME\"[^}]*}" \
    | grep -o '"token":"[^"]*"' | head -1 \
    | sed -E 's/.*:"([^"]*)"/\1/')"

  # If no name-match, fall back to the first device
  if [ -z "$TOKEN" ]; then
    TOKEN="$(printf '%s' "$devices_json" \
      | grep -o '"token":"[^"]*"' | head -1 \
      | sed -E 's/.*:"([^"]*)"/\1/')"
  fi

  if [ -n "$TOKEN" ]; then
    local existing_name
    existing_name="$(printf '%s' "$devices_json" \
      | grep -o "{[^}]*\"token\":\"$TOKEN\"[^}]*}" \
      | grep -o '"name":"[^"]*"' | head -1 \
      | sed -E 's/.*:"([^"]*)"/\1/')"
    log "Reusing existing display device: ${existing_name} (token: ${TOKEN})"
    return
  fi

  # No devices at all — create one
  log "Creating display device: $DEVICE_NAME"
  # grep/sed, not `node -e` — this runs before we know whether install_agent
  # will need Node at all (ENABLE_AGENT could be 0), and the server itself is
  # Docker-only now, so nothing else here guarantees Node is on the host.
  TOKEN="$(curl -fsS "${CURL_OPTS[@]}" -X POST "$SERVER/api/devices" \
    -H 'content-type: application/json' \
    --data "{\"name\":\"$DEVICE_NAME\"}" \
    | grep -o '"token":"[^"]*"' | head -1 | sed -E 's/.*:"([^"]*)"/\1/')"

  if [ -z "$TOKEN" ]; then
    fail "failed to create or read display token"
  fi

  log "Created display token: ${TOKEN}"
}

install_display_fonts() {
  local need_cache_rebuild=0
  local need_apt_update=0
  fc-list :lang=ko 2>/dev/null | grep -qi nanum || need_apt_update=1
  fc-list 2>/dev/null | grep -qi "noto color emoji" || need_apt_update=1
  [ "$need_apt_update" -eq 1 ] && apt-get update -qq

  # Korean text (Nanum) — the app's own Pretendard webfont (self-hosted,
  # served from public/shared/fonts/) covers Korean glyphs fine in Chromium,
  # but Nanum is kept as a system-level fallback for anything that renders
  # outside the app's own CSS (Chromium UI chrome, other kiosk-adjacent uses).
  if fc-list :lang=ko 2>/dev/null | grep -qi nanum; then
    log "Korean fonts already installed"
  else
    log "Installing Korean fonts (Nanum)"
    # fonts-nanum      : NanumGothic, NanumMyeongjo, NanumBarunGothic
    # fonts-nanum-extra: NanumSquare, NanumBarunpen, etc.
    apt-get install -y fonts-nanum fonts-nanum-extra 2>/dev/null \
      || apt-get install -y fonts-nanum 2>/dev/null \
      || log "Warning: could not install Nanum fonts — Korean text may not render correctly"
    need_cache_rebuild=1
  fi

  # Color emoji — the app's webfont (Pretendard) is text-only, like every
  # other text font; emoji glyphs (weather icons, widget icons, etc.) always
  # come from a separate OS-level color font, and a fresh Raspberry Pi OS
  # install doesn't ship one. Without it, those glyphs render as invisible/
  # blank boxes on the kiosk display even though they show up fine on
  # whatever desktop OS someone used to build the layout in the editor.
  if fc-list 2>/dev/null | grep -qi "noto color emoji"; then
    log "Emoji font already installed"
  else
    log "Installing color emoji font (Noto Color Emoji)"
    apt-get install -y fonts-noto-color-emoji 2>/dev/null \
      || log "Warning: could not install an emoji font — emoji icons (e.g. weather) will not render"
    need_cache_rebuild=1
  fi

  # Rebuild font cache so Chromium picks up the new fonts immediately
  [ "$need_cache_rebuild" -eq 1 ] && { fc-cache -fv >/dev/null 2>&1 || true; }
}

install_chromium() {
  if ! command -v chromium-browser >/dev/null 2>&1 && ! command -v chromium >/dev/null 2>&1; then
    log "Installing Chromium"
    apt-get update
    apt-get install -y chromium-browser || apt-get install -y chromium
  fi

  # Debian/Raspberry Pi OS's chromium package ships WITHOUT proprietary H.264/AAC
  # decode support (patent licensing) — an .mp4 video in paneo.photo simply won't
  # play at all without this (silently: no error dialog, just a black/frozen
  # frame). Not present in every repo/arch, so best-effort — .webm (VP8/VP9)
  # videos work regardless, since those codecs aren't patent-encumbered.
  apt-get install -y chromium-codecs-ffmpeg-extra 2>/dev/null || true
}

chromium_cmd() {
  if command -v chromium-browser >/dev/null 2>&1; then
    command -v chromium-browser
  else
    command -v chromium
  fi
}

install_kiosk() {
  [ "$ENABLE_KIOSK" = "1" ] || { log "Skipping kiosk autostart"; return; }
  [ -n "$TOKEN" ] || fail "PANEO_TOKEN is required for display/kiosk mode"

  install_chromium

  local home chrome display_url
  home="$(user_home)"
  [ -n "$home" ] || fail "cannot find home directory for $SERVICE_USER"
  chrome="$(chromium_cmd)"
  display_url="${SERVER}/d/${TOKEN}"

  log "Writing kiosk launcher for $display_url"
  # Runtime Wayland detection: $WAYLAND_DISPLAY is set by the desktop session
  # manager when Wayland is active (Wayfire/Labwc on Bookworm), empty on X11.
  # We evaluate it at launch time, not at install time.
  cat > /usr/local/bin/paneo-kiosk <<'KIOSK_EOF'
#!/usr/bin/env bash
set -e
# Wait for the Paneo server to be ready before launching Chromium.
# On reboot, Docker may take 10-30 s to start — without this wait the
# browser opens before the server is up and shows a blank white page.
SERVER_URL="$(grep -o 'http[^ "]*' "$0" | head -1 | sed 's|/d/.*||')"
SERVER_URL="${SERVER_URL:-http://localhost:4321}"
for _i in $(seq 1 60); do
  if curl -fsS --connect-timeout 3 --max-time 8 "${SERVER_URL}/api/brand" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if [ -n "${WAYLAND_DISPLAY:-}" ] || [ "${XDG_SESSION_TYPE:-}" = "wayland" ]; then
  # Wayland (Wayfire / Labwc — Raspberry Pi OS Bookworm default)
  OZONE="--ozone-platform=wayland --enable-features=UseOzonePlatform"
  wlr-randr >/dev/null 2>&1 || true   # wake display if possible; ignore errors
else
  # X11 (Bullseye / LXDE)
  export DISPLAY="${DISPLAY:-:0}"
  OZONE=""
  xset s off    >/dev/null 2>&1 || true
  xset -dpms    >/dev/null 2>&1 || true
  xset s noblank >/dev/null 2>&1 || true
fi
KIOSK_EOF
  # Append the chrome command with runtime-expanded variables
  cat >> /usr/local/bin/paneo-kiosk <<EOF
exec "$chrome" \$OZONE \\
  --kiosk --noerrdialogs --disable-infobars \\
  --disable-session-crashed-bubble \\
  --no-first-run \\
  --disable-translate \\
  --disable-features=Translate \\
  --password-store=basic \\
  --autoplay-policy=no-user-gesture-required \\
  "$display_url"
EOF
  chmod +x /usr/local/bin/paneo-kiosk

  log "Registering desktop autostart"

  # ---- LXDE / Bullseye ----
  mkdir -p "$home/.config/autostart" "$home/.config/lxsession/LXDE-pi"
  cat > "$home/.config/autostart/paneo-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Paneo Kiosk
Exec=/usr/local/bin/paneo-kiosk
X-GNOME-Autostart-enabled=true
EOF
  if [ -d "$home/.config/lxsession/LXDE-pi" ]; then
    cat >> "$home/.config/lxsession/LXDE-pi/autostart" <<EOF
@xset s off
@xset -dpms
@xset s noblank
@/usr/local/bin/paneo-kiosk
EOF
  fi

  # ---- Wayfire (Bookworm default on Pi 4/5) ----
  local wayfire_ini="$home/.config/wayfire.ini"
  mkdir -p "$home/.config"
  if [ ! -f "$wayfire_ini" ]; then
    cat > "$wayfire_ini" <<EOF
[autostart]
paneo-kiosk = /usr/local/bin/paneo-kiosk
EOF
  elif ! grep -q "paneo-kiosk" "$wayfire_ini"; then
    if grep -q "^\[autostart\]" "$wayfire_ini"; then
      sed -i "/^\[autostart\]/a paneo-kiosk = /usr/local/bin/paneo-kiosk" "$wayfire_ini"
    else
      printf '\n[autostart]\npaneo-kiosk = /usr/local/bin/paneo-kiosk\n' >> "$wayfire_ini"
    fi
  fi

  # ---- Labwc (alternative Wayland compositor on some Pi builds) ----
  mkdir -p "$home/.config/labwc"
  local labwc_as="$home/.config/labwc/autostart"
  if ! grep -q "paneo-kiosk" "$labwc_as" 2>/dev/null; then
    echo "/usr/local/bin/paneo-kiosk &" >> "$labwc_as"
  fi

  chown -R "$SERVICE_USER:$SERVICE_USER" \
    "$home/.config/autostart" \
    "$home/.config/lxsession" \
    "$home/.config/wayfire.ini" \
    "$home/.config/labwc" 2>/dev/null || true

  log "Kiosk autostart registered. It will launch after the desktop session starts."
}

# Lets the (non-root) companion agent trigger `sudo <this exact script>` when
# told to by the editor's update button — fetches this server's own copy of
# update-pi.sh (same route it's normally curled from) so the installed copy
# can never drift from what's actually deployed, and scopes sudo to exactly
# that one script path rather than granting the agent's user broader access.
install_update_trigger() {
  local update_script="/usr/local/bin/paneo-update-pi.sh"
  curl -fsSL "${CURL_OPTS[@]}" "$SERVER/update.sh" -o "$update_script"
  chmod +x "$update_script"

  cat > /etc/sudoers.d/paneo-agent-update <<EOF
$SERVICE_USER ALL=(root) NOPASSWD: $update_script *
EOF
  chmod 440 /etc/sudoers.d/paneo-agent-update
  visudo -cf /etc/sudoers.d/paneo-agent-update >/dev/null \
    || fail "generated sudoers file for paneo-agent-update is invalid"
  log "Update trigger installed ($update_script, sudoers scoped to $SERVICE_USER)"
}

install_agent() {
  [ "$ENABLE_AGENT" = "1" ] || { log "Skipping companion agent"; return; }
  [ -n "$TOKEN" ] || fail "PANEO_TOKEN is required for companion agent"

  install_node
  log "Installing companion agent"
  mkdir -p "$AGENT_DIR"
  curl -fsSL "${CURL_OPTS[@]}" "$SERVER/agent/agent.js" -o "$AGENT_DIR/agent.js"
  curl -fsSL "${CURL_OPTS[@]}" "$SERVER/agent/version.json" -o "$AGENT_DIR/version.json"
  install_update_trigger

  local node_bin
  node_bin="$(command -v node)"

  cat > /etc/systemd/system/paneo-agent.service <<EOF
[Unit]
Description=Paneo Companion Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$AGENT_DIR
Environment=PANEO_SERVER=$SERVER
Environment=PANEO_TOKEN=$TOKEN
Environment=PANEO_WATCHDOG=1
ExecStart=$node_bin $AGENT_DIR/agent.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now paneo-agent
  log "Companion agent installed"
}

print_summary() {
  log "Done"
  log "Editor:  $SERVER/"
  if [ -n "$TOKEN" ]; then
    log "Display: $SERVER/d/$TOKEN"
  fi
  if curl -fsS "${CURL_OPTS[@]}" "$SERVER/api/version" >/dev/null 2>&1; then
    log "Versions: $(curl -fsS "${CURL_OPTS[@]}" "$SERVER/api/version")"
  fi
  log "Server logs: systemctl status paneo (or: docker logs -f paneo)"
  log "Agent logs:  systemctl status paneo-agent && journalctl -u paneo-agent -f"
}

main() {
  need_root

  case "$MODE" in
    server)
      install_server
      ;;
    display)
      install_display_fonts
      create_token_if_needed
      install_kiosk
      install_agent
      ;;
    all)
      install_server
      install_display_fonts
      create_token_if_needed
      install_kiosk
      install_agent
      ;;
    *)
      fail "unknown PANEO_MODE: $MODE (use server, display, or all)"
      ;;
  esac

  print_summary
}

main "$@"
