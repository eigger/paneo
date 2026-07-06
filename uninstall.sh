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
# Belt-and-suspenders: `systemctl stop` should already have killed the agent
# process by the time it returns, but if it's somehow still around (unit
# already removed/masked in a weird state, a manually-started copy outside
# systemd's tracking, etc.) don't leave it running just because the service
# management step didn't catch it.
pkill -f '/opt/paneo-agent/agent.js' 2>/dev/null || true
sleep 1
pkill -9 -f '/opt/paneo-agent/agent.js' 2>/dev/null || true

# 2. Remove systemd service files and update configs
log "Removing systemd service files and update configs..."
rm -f /etc/systemd/system/paneo.service
rm -f /etc/systemd/system/paneo-agent.service
rm -f /etc/sudoers.d/paneo-agent-update
systemctl daemon-reload

# 3. Clean up Docker container and volume
if command -v docker >/dev/null 2>&1; then
  log "Removing Paneo Docker container and volume..."
  docker rm -f paneo 2>/dev/null || true
  docker volume rm paneo-data 2>/dev/null || true
fi

# 4. Remove kiosk launcher script and stop running kiosk processes
log "Stopping running kiosk processes and removing launcher..."
pkill -f 'chromium.*--kiosk' 2>/dev/null || true
pkill -f 'paneo-kiosk'       2>/dev/null || true
pkill -f 'paneo-kiosk-restart.sh' 2>/dev/null || true
sleep 2
# The two pkill patterns above only match the main browser process (the one
# that actually has --kiosk in its argv) — Chromium's renderer/GPU/utility
# child processes don't carry that flag in their own command line, so a
# SIGTERM to just the parent can leave them orphaned and still on screen.
# Sweep by binary name too, and escalate to SIGKILL for anything that
# ignored the graceful signal above.
pkill -f 'chromium' 2>/dev/null || true
sleep 1
pkill -9 -f 'chromium' 2>/dev/null || true
pkill -9 -f 'paneo-kiosk' 2>/dev/null || true
rm -f /usr/local/bin/paneo-kiosk
rm -f /usr/local/bin/paneo-kiosk-restart.sh

# 5. Clean up autostart entries for all users (only relevant to installs from
# before the companion agent took over launching the kiosk itself -- current
# installs never write any of these).
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

  # Revert legacy LXDE autostart -- per-user file install-pi.sh actually wrote
  # to ($home/.config/..., not the system-wide /etc/xdg/... template), and it
  # appended the xset blanking lines alongside the paneo-kiosk line itself.
  lxde_as="$home/.config/lxsession/LXDE-pi/autostart"
  if [ -f "$lxde_as" ]; then
    sed -i '/paneo-kiosk/d; /xset s off/d; /xset -dpms/d; /xset s noblank/d' "$lxde_as"
  fi
done

# 6. Remove installation directories
log "Removing installation directories..."
rm -rf /opt/paneo-agent /opt/paneo

log "Paneo has been successfully uninstalled!"
