#!/usr/bin/env bash
# Paneo field diagnostics — read-only. Bundles the ad-hoc checks used during
# kiosk field debugging (undervoltage, sandbox failures, service status,
# kiosk process/render health) into one command so a support session has a
# starting point instead of re-deriving it from scratch every time.
#
#   curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/scripts/diagnose-pi.sh | bash
#
# Never restarts services or modifies anything — safe to run at any time,
# including while a real user is watching the display.
set -uo pipefail

SERVICE_USER="${PANEO_USER:-${SUDO_USER:-pi}}"
CDP_PORT="${PANEO_CDP_PORT:-9222}"

section() { printf '\n=== %s ===\n' "$1"; }

section "System"
uname -a
[ -r /etc/os-release ] && grep -E '^(PRETTY_NAME|VERSION)=' /etc/os-release
uptime

section "Power / temperature (vcgencmd)"
if command -v vcgencmd >/dev/null 2>&1; then
  vcgencmd get_throttled
  # bit 0/16/18/19 set = undervoltage now/since-boot — the single most common
  # root cause found during this project's real-device debugging sessions.
  vcgencmd measure_temp
  vcgencmd measure_volts core 2>/dev/null || true
else
  echo "vcgencmd not found (not running on Raspberry Pi OS, or vcgencmd not installed)"
fi

section "Disk / memory"
df -h / /tmp 2>/dev/null
free -h 2>/dev/null

section "paneo.service (Docker server, if installed on this host)"
if systemctl list-unit-files 2>/dev/null | grep -q '^paneo\.service'; then
  systemctl is-active paneo 2>/dev/null
  systemctl status paneo --no-pager -l 2>/dev/null | head -15
  echo "--- last 30 log lines ---"
  journalctl -u paneo -n 30 --no-pager 2>/dev/null
else
  echo "not installed on this host"
fi

section "paneo-agent.service (companion agent)"
if systemctl list-unit-files 2>/dev/null | grep -q '^paneo-agent\.service'; then
  systemctl is-active paneo-agent 2>/dev/null
  systemctl status paneo-agent --no-pager -l 2>/dev/null | head -15
  echo "--- last 50 log lines ---"
  journalctl -u paneo-agent -n 50 --no-pager 2>/dev/null
else
  echo "not installed on this host"
fi

section "Kiosk (Chromium) process"
pgrep -af chromium 2>/dev/null || echo "no chromium process running"

section "Kiosk render health (CDP on 127.0.0.1:${CDP_PORT})"
if command -v curl >/dev/null 2>&1; then
  curl -fsS --max-time 2 "http://127.0.0.1:${CDP_PORT}/json/version" 2>/dev/null \
    || echo "CDP endpoint not responding (kiosk down, still starting, or launched without --remote-debugging-port)"
else
  echo "curl not available"
fi

section "fs.protected_regular (kernel hardening)"
# =2 broke root's own repeated writes to a chown'd file mid-update in a past
# incident (D? update-pi.sh write_status fix) — surfaced here for fast recheck.
sysctl fs.protected_regular 2>/dev/null || echo "not set / not applicable"

section "Kiosk launcher"
if [ -f /usr/local/bin/paneo-kiosk ]; then
  echo "--- /usr/local/bin/paneo-kiosk ---"
  cat /usr/local/bin/paneo-kiosk
else
  echo "/usr/local/bin/paneo-kiosk not found"
fi

section "Last update log (/tmp/paneo-update.log)"
if [ -f /tmp/paneo-update.log ]; then
  tail -n 40 /tmp/paneo-update.log
else
  echo "no /tmp/paneo-update.log on this host"
fi

section "Companion agent home directory"
home_dir="$(getent passwd "$SERVICE_USER" 2>/dev/null | cut -d: -f6)"
if [ -n "$home_dir" ]; then
  ls -la "$home_dir/.config/paneo-chromium" 2>/dev/null | head -5 || echo "no chromium profile dir yet"
fi

printf '\nDone. Paste this output when reporting a kiosk/agent issue.\n'
