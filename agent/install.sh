#!/usr/bin/env bash
# Paneo Companion Agent — Pi systemd install script (docs/design.md §M4)
# Usage: curl -sSL http://<server>/agent/install.sh | PANEO_SERVER=http://... PANEO_TOKEN=... bash
set -e

PANEO_SERVER="${PANEO_SERVER:-http://localhost:4321}"
PANEO_TOKEN="${PANEO_TOKEN:?PANEO_TOKEN is required (your device pairing token)}"
NODE="${NODE:-$(which node 2>/dev/null || echo node)}"
AGENT_DIR="${AGENT_DIR:-/opt/paneo-agent}"
SERVICE_USER="${PANEO_USER:-${SUDO_USER:-$(whoami)}}"
SERVICE="paneo-agent"

echo "[install] Paneo companion agent installer"
echo "[install] server: $PANEO_SERVER"
echo "[install] token:  ${PANEO_TOKEN:0:4}****"
echo "[install] user:   $SERVICE_USER"

# 1. Create agent directory and download agent.js
mkdir -p "$AGENT_DIR"
curl -fsSL "${PANEO_SERVER}/agent/agent.js" -o "$AGENT_DIR/agent.js"
curl -fsSL "${PANEO_SERVER}/agent/version.json" -o "$AGENT_DIR/version.json"

# 2. Write systemd unit
cat > /etc/systemd/system/${SERVICE}.service << EOF
[Unit]
Description=Paneo Companion Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$AGENT_DIR
Environment=PANEO_SERVER=$PANEO_SERVER
Environment=PANEO_TOKEN=$PANEO_TOKEN
Environment=PANEO_WATCHDOG=1
ExecStart=$NODE $AGENT_DIR/agent.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# 3. Enable and start
systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"

echo "[install] done! Service status:"
systemctl status "$SERVICE" --no-pager
if [ -f "$AGENT_DIR/version.json" ]; then
  echo "[install] agent version: $(cat "$AGENT_DIR/version.json")"
fi
