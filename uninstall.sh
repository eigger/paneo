#!/usr/bin/env bash
# Paneo Raspberry Pi uninstallation script — stop services, remove files/volume/launcher, and clean up autostart.

set -euo pipefail

log() { printf '[paneo-uninstall] %s\n' "$*"; }
fail() { printf '[paneo-uninstall] ERROR: %s\n' "$*" >&2; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
  fail "run with sudo, for example: curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/uninstall.sh | sudo bash"
fi

# 1. Stop and disable systemd services
log "Stopping and disabling Paneo systemd services..."
if systemctl list-units --full --all | grep -q "paneo.service"; then
  systemctl stop paneo || true
  systemctl disable paneo || true
fi

if systemctl list-units --full --all | grep -q "paneo-agent.service"; then
  systemctl stop paneo-agent || true
  systemctl disable paneo-agent || true
fi

# 2. Remove systemd service files
log "Removing systemd service files..."
rm -f /etc/systemd/system/paneo.service
rm -f /etc/systemd/system/paneo-agent.service
systemctl daemon-reload

# 3. Clean up Docker container and volume
if command -v docker >/dev/null 2>&1; then
  log "Removing Paneo Docker container and volume..."
  docker rm -f paneo 2>/dev/null || true
  docker volume rm paneo-data 2>/dev/null || true
fi

# 4. Remove kiosk launcher script
log "Removing kiosk launcher..."
rm -f /usr/local/bin/paneo-kiosk

# 5. Clean up autostart entries for all users
log "Cleaning up user autostart configurations..."
for home in /home/*; do
  [ -d "$home" ] || continue
  
  # Remove autostart desktop file
  rm -f "$home/.config/autostart/paneo-kiosk.desktop"
  
  # Revert Wayfire changes
  wayfire_ini="$home/.config/wayfire.ini"
  if [ -f "$wayfire_ini" ]; then
    sed -i '/paneo-kiosk/d' "$wayfire_ini"
  fi
  
  # Revert labwc changes
  labwc_as="$home/.config/labwc/autostart"
  if [ -f "$labwc_as" ]; then
    sed -i '/paneo-kiosk/d' "$labwc_as"
  fi
done

# Revert legacy LXDE autostart
lxde_as="/etc/xdg/lxsession/LXDE-pi/autostart"
if [ -f "$lxde_as" ]; then
  sed -i '/paneo-kiosk/d' "$lxde_as"
fi

# 6. Remove installation directories
log "Removing installation directories..."
rm -rf /opt/paneo-agent /opt/paneo

log "Paneo has been successfully uninstalled!"
