# Paneo Companion Agent

The companion agent runs on a Raspberry Pi as a `systemd` service and handles
OS-level tasks that a browser page cannot do (docs/design.md §4.1 D, §9):

| Feature | How |
|---|---|
| Screen power ON/OFF | `vcgencmd display_power` / `wlr-randr` / `xset dpms` |
| Power schedule | Server cron fires `command.power`; agent executes |
| Browser watchdog | `PANEO_WATCHDOG=1` — restarts Chromium if it crashes |
| Health heartbeat | Sends `agent.heartbeat` every 60 s so editor shows "connected" badge |

> **Optional**: the agent is not required for widget display. The display page
> works without it. Installing the agent unlocks screen power control.

---

## Quick Install (Pi)

```bash
curl -sSL http://<your-server>:4321/agent/install.sh \
  | sudo env PANEO_SERVER=http://<your-server>:4321 \
    PANEO_TOKEN=<device-token> \
    bash
```

The token is shown in the editor Settings modal under the device name.

---

## Development (local simulator)

```bash
# From project root:
PANEO_SERVER=http://localhost:4321 PANEO_TOKEN=<token> node agent/agent.js
```

Power commands are printed to the console instead of running real OS commands.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PANEO_SERVER` | `http://localhost:4321` | URL of your Paneo server |
| `PANEO_TOKEN` | *(required)* | Device pairing token |
| `PANEO_WATCHDOG` | `0` | Set to `1` to enable Chromium watchdog |
| `PANEO_DISPLAY_URL` | auto | URL to relaunch (watchdog only) |
| `PANEO_DISPLAY_OUTPUT` | `HDMI-A-1` | wlr-randr output name (Wayland only) |

The agent reports its version from `agent/version.json` on connect (`agent.hello`) and in periodic heartbeats. The editor shows the connected agent version when available.

---

## Power Control Methods

Detected automatically at startup in this order:

1. **`vcgencmd display_power 0/1`** — Pi GPU firmware (recommended for Pi OS)
2. **`wlr-randr --output ... --on/--off`** — Wayland compositors (labwc, sway)
3. **`xset dpms force on/off`** — X11 sessions
4. **Simulator** — logs only (development PC / unsupported platform)

---

## Systemd Commands

```bash
# Check status
systemctl status paneo-agent

# View logs
journalctl -u paneo-agent -f

# Restart
systemctl restart paneo-agent

# Uninstall
systemctl disable --now paneo-agent
rm /etc/systemd/system/paneo-agent.service
```
