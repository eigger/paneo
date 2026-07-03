#!/usr/bin/env bash
# Paneo Raspberry Pi one-click installer.
#
# Modes:
#   PANEO_MODE=server   Install Paneo server + systemd service.
#   PANEO_MODE=display  Install Chromium kiosk autostart + companion agent.
#   PANEO_MODE=all      Install server, create a display token if needed, then install kiosk + agent.
#
# Examples:
#   sudo env PANEO_MODE=server PANEO_DIR=$PWD bash scripts/install-pi.sh
#   curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh | sudo env PANEO_MODE=all bash
#   curl -sSL http://<server-ip>:4321/install/pi.sh | sudo env PANEO_MODE=display PANEO_SERVER=http://<server-ip>:4321 PANEO_TOKEN=<token> bash
#   sudo env PANEO_MODE=all PANEO_DIR=$PWD PANEO_DEVICE_NAME="Living Room" bash scripts/install-pi.sh

set -euo pipefail

MODE="${PANEO_MODE:-${1:-all}}"
PORT="${PANEO_PORT:-4321}"
SERVER="${PANEO_SERVER:-http://localhost:${PORT}}"
TOKEN="${PANEO_TOKEN:-}"
DEVICE_NAME="${PANEO_DEVICE_NAME:-Raspberry Pi}"
APP_DIR="${PANEO_DIR:-}"
REPO="${PANEO_REPO:-https://github.com/eigger/paneo.git}"
INSTALL_DIR="${PANEO_INSTALL_DIR:-/opt/paneo}"
AGENT_DIR="${PANEO_AGENT_DIR:-/opt/paneo-agent}"
SERVICE_USER="${PANEO_USER:-${SUDO_USER:-pi}}"
ENABLE_AGENT="${PANEO_ENABLE_AGENT:-1}"
ENABLE_KIOSK="${PANEO_ENABLE_KIOSK:-1}"

log() { printf '[paneo-install] %s\n' "$*"; }
fail() { printf '[paneo-install] ERROR: %s\n' "$*" >&2; exit 1; }

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    fail "run with sudo, for example: sudo env PANEO_MODE=${MODE} bash scripts/install-pi.sh"
  fi
}

user_home() {
  getent passwd "$SERVICE_USER" | cut -d: -f6
}

run_as_user() {
  sudo -u "$SERVICE_USER" -H bash -lc "$*"
}

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  node -e "const [maj,min]=process.versions.node.split('.').map(Number); process.exit(maj > 22 || (maj === 22 && min >= 5) ? 0 : 1)"
}

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

resolve_app_dir() {
  if [ -n "$APP_DIR" ]; then
    return
  fi

  if [ -f "./package.json" ] && [ -f "./src/server.js" ]; then
    APP_DIR="$(pwd)"
    return
  fi

  APP_DIR="$INSTALL_DIR"
}

ensure_source() {
  resolve_app_dir

  if [ -f "$APP_DIR/package.json" ] && [ -f "$APP_DIR/src/server.js" ]; then
    log "Using Paneo source at $APP_DIR"
    return
  fi

  if [ -z "$REPO" ]; then
    fail "Paneo source not found at $APP_DIR. Run inside the repo, set PANEO_DIR, or set PANEO_REPO."
  fi

  log "Cloning $REPO to $APP_DIR"
  apt-get update
  apt-get install -y git
  mkdir -p "$(dirname "$APP_DIR")"
  git clone "$REPO" "$APP_DIR"
  chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
}

install_server() {
  need_root
  install_node
  ensure_source

  log "Installing server dependencies"
  chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
  run_as_user "cd '$APP_DIR' && npm install"

  local node_bin
  node_bin="$(command -v node)"

  log "Writing systemd service: paneo"
  cat > /etc/systemd/system/paneo.service <<EOF
[Unit]
Description=Paneo Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$APP_DIR
Environment=PORT=$PORT
ExecStart=$node_bin $APP_DIR/src/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now paneo
  wait_for_server
  log "Paneo server is running at $SERVER"
}

wait_for_server() {
  log "Waiting for server: $SERVER"
  for _ in $(seq 1 30); do
    if curl -fsS "$SERVER/api/brand" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  systemctl status paneo --no-pager || true
  fail "server did not become ready at $SERVER"
}

create_token_if_needed() {
  if [ -n "$TOKEN" ]; then
    return
  fi

  wait_for_server
  log "Creating display device: $DEVICE_NAME"
  TOKEN="$(curl -fsS -X POST "$SERVER/api/devices" \
    -H 'content-type: application/json' \
    --data "{\"name\":\"$DEVICE_NAME\"}" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).token || ''))")"

  if [ -z "$TOKEN" ]; then
    fail "failed to create or read display token"
  fi

  log "Created display token: ${TOKEN}"
}

install_chromium() {
  if command -v chromium-browser >/dev/null 2>&1 || command -v chromium >/dev/null 2>&1; then
    return
  fi

  log "Installing Chromium"
  apt-get update
  apt-get install -y chromium-browser || apt-get install -y chromium
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
  cat > /usr/local/bin/paneo-kiosk <<EOF
#!/usr/bin/env bash
set -e
export DISPLAY="\${DISPLAY:-:0}"
xset s off >/dev/null 2>&1 || true
xset -dpms >/dev/null 2>&1 || true
xset s noblank >/dev/null 2>&1 || true
exec "$chrome" --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble "$display_url"
EOF
  chmod +x /usr/local/bin/paneo-kiosk

  log "Registering desktop autostart"
  mkdir -p "$home/.config/autostart" "$home/.config/lxsession/LXDE-pi"
  cat > "$home/.config/autostart/paneo-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Paneo Kiosk
Exec=/usr/local/bin/paneo-kiosk
X-GNOME-Autostart-enabled=true
EOF
  cat > "$home/.config/lxsession/LXDE-pi/autostart" <<EOF
@xset s off
@xset -dpms
@xset s noblank
@/usr/local/bin/paneo-kiosk
EOF
  chown -R "$SERVICE_USER:$SERVICE_USER" "$home/.config/autostart" "$home/.config/lxsession"

  log "Kiosk autostart registered. It will launch after the desktop session starts."
}

install_agent() {
  [ "$ENABLE_AGENT" = "1" ] || { log "Skipping companion agent"; return; }
  [ -n "$TOKEN" ] || fail "PANEO_TOKEN is required for companion agent"

  install_node
  log "Installing companion agent"
  mkdir -p "$AGENT_DIR"
  curl -fsSL "$SERVER/agent/agent.js" -o "$AGENT_DIR/agent.js"
  curl -fsSL "$SERVER/agent/version.json" -o "$AGENT_DIR/version.json"

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
  if curl -fsS "$SERVER/api/version" >/dev/null 2>&1; then
    log "Versions: $(curl -fsS "$SERVER/api/version")"
  fi
  log "Server logs: systemctl status paneo && journalctl -u paneo -f"
  log "Agent logs:  systemctl status paneo-agent && journalctl -u paneo-agent -f"
}

main() {
  need_root

  case "$MODE" in
    server)
      install_server
      ;;
    display)
      install_node
      create_token_if_needed
      install_kiosk
      install_agent
      ;;
    all)
      install_server
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
