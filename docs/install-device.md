# Paneo Device Installation & Usage Guide

[English](install-device.md) · [한국어](install-device.ko.md)

This guide covers installing and using Paneo on Raspberry Pi and other always-on display devices.

The recommended layout is **one server + multiple display Pis**. For small setups, you can co-locate the server and display on a single Pi 4 or newer.

## 1. Architecture overview

Server device:

- Runs the Paneo server process.
- Serves the editor (`/`) and display pages (`/d/<token>`).
- Stores SQLite data, widget proxy settings, and Home Assistant credentials.

Display device:

- Opens `http://<server-ip>:4321/d/<token>` in Chromium kiosk mode.
- Optionally runs the companion agent for screen power control and browser watchdog.

Editing device:

- Any PC, tablet, or laptop on the same LAN opens `http://<server-ip>:4321/`.
- Press **Apply** after editing to push the layout to connected displays instantly.

## 2. One-click install

These are **role-based** instructions. Run **only the section that matches your device** — not every section in order.

| Setup | Sections to run |
|-------|-----------------|
| One server + multiple display Pis (recommended) | Server Pi → each Display Pi |
| Everything on one Pi | All-in-one Pi |
| Edit from a PC only | No install (open the editor in a browser) |

Common: when installing from GitHub, `install.sh` clones to `/opt/paneo` and runs `scripts/install-pi.sh`.

```sh
# Example GitHub bootstrap (pick role via PANEO_MODE)
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh | sudo env PANEO_MODE=<server|display|all> ... bash
```

Shared options: `PANEO_REF=master`, `PANEO_INSTALL_DIR=/opt/paneo`, `PANEO_USER=pi`

---

### Server Pi

**Installs:** Docker (if missing) and the Paneo server as a container, managed by a `paneo` systemd unit. This device hosts the editor, API, and SQLite data.

**Run only on the server device:**

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh | sudo env PANEO_MODE=server bash
```

Pin a specific released version instead of `latest`:

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh \
  | sudo env PANEO_MODE=server PANEO_IMAGE=ghcr.io/eigger/paneo:0.1.0 bash
```

After install: editor at `http://<server-ip>:4321/` · check status with `systemctl status paneo` (or `docker logs -f paneo`)

---

### Display Pi

**Installs:** Chromium kiosk autostart and the companion agent (`paneo-agent` systemd). Opens your `/d/<token>` page fullscreen after boot.

**Prerequisites:** the server must already be running. Create a display in the editor and copy the token from **Open display**.

**Run only on each display device:**

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh \
  | sudo env PANEO_MODE=display \
      PANEO_SERVER=http://<server-ip>:4321 \
      PANEO_TOKEN=<token> \
      bash
```

If the server is already up, you can fetch the installer from it:

```sh
curl -sSL http://<server-ip>:4321/install/pi.sh \
  | sudo env PANEO_MODE=display \
      PANEO_SERVER=http://<server-ip>:4321 \
      PANEO_TOKEN=<token> \
      bash
```

Add `PANEO_ENABLE_AGENT=0` for kiosk only without screen power control. Reboot to start kiosk: `sudo reboot`

---

### Companion agent only (optional)

**Installs:** the `paneo-agent` service only — screen power on/off and browser watchdog.

Already included in the Display Pi install (`PANEO_MODE=display`). **No separate step** if you used that section.

Install agent alone when kiosk is set up manually:

```sh
curl -sSL http://<server-ip>:4321/agent/install.sh \
  | sudo env PANEO_SERVER=http://<server-ip>:4321 PANEO_TOKEN=<token> bash
```

---

### All-in-one Pi (server + display + agent)

**Installs:** everything from the Server Pi, Display Pi, and agent sections in **one command**. Good for Pi 4+ demos and small single-device setups.

**You do not need to run the server and display sections separately.**

**Run only on that one device:**

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh | sudo env PANEO_MODE=all bash
```

Custom display name (auto-creates a token if omitted):

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh \
  | sudo env PANEO_MODE=all PANEO_DEVICE_NAME="Living Room" bash
```

If you already have `scripts/install-pi.sh` locally (the server role doesn't need the rest of the source tree — it runs the prebuilt image):

```sh
sudo env PANEO_MODE=all PANEO_DEVICE_NAME="Living Room" bash scripts/install-pi.sh
```

Options: `PANEO_PORT=8080`, `PANEO_TOKEN=<token>`, `PANEO_IMAGE=ghcr.io/eigger/paneo:0.1.0`, `PANEO_ENABLE_AGENT=0`, `PANEO_ENABLE_KIOSK=0`

---

The manual steps below are for fine-tuning or when you do not use the one-click script.

## 3. Server install

The one-click `PANEO_MODE=server` install (§2) does exactly this for you — this section is for
setting it up by hand or understanding what it does.

### 3.1 Prerequisites

Docker. Install it if missing:

```sh
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
```

### 3.2 Run with Docker Compose

```sh
git clone https://github.com/eigger/paneo.git
cd paneo
docker compose pull   # fetch the released image (ghcr.io/eigger/paneo)
docker compose up -d
```

- Editor: `http://<server-ip>:4321/`
- Display: `http://<server-ip>:4321/d/<token>`

`docker-compose.yml` persists SQLite/photos/plugins in a named volume (`paneo-data:/data`) and
restarts the container automatically (`restart: unless-stopped`) — no separate systemd unit
needed when you manage it this way.

### 3.3 Or: register a systemd service around `docker run`

This is what the one-click installer writes to `/etc/systemd/system/paneo.service` — useful if you
want `systemctl`/`journalctl` instead of Compose:

```ini
[Unit]
Description=Paneo Server (Docker)
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
ExecStartPre=-/usr/bin/docker rm -f paneo
ExecStart=/usr/bin/docker run --rm --name paneo -p 4321:4321 -v paneo-data:/data ghcr.io/eigger/paneo:latest
ExecStop=/usr/bin/docker stop -t 10 paneo
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now paneo
sudo systemctl status paneo
```

Logs: `journalctl -u paneo -f` or `docker logs -f paneo`.

### 3.4 Alternative: run directly with Node.js (no Docker)

Not the recommended path, but the server has no hard Docker dependency — useful on hardware Docker
doesn't support well, or if you'd rather manage Node yourself. Requires Node.js **22.5+** or
**24+** (Paneo uses the built-in `node:sqlite`):

```sh
git clone https://github.com/eigger/paneo.git
cd paneo
npm install
PORT=4321 npm start
```

For a systemd unit, swap `ExecStart` above for `ExecStart=/usr/bin/npm start` with
`WorkingDirectory=` set to the cloned repo and `User=` set to a non-root account.

## 4. Register your first display

1. Open `http://<server-ip>:4321/` in a browser.
2. Click `+` next to the **Display** selector to create a new screen.
3. In ⚙ settings, set resolution, orientation, locale, and performance profile.
4. Click **Open display** to see the URL.
5. The `<token>` in `/d/<token>` is this display's pairing token.

Example:

```text
http://192.168.0.10:4321/d/abc123
```

Here the token is `abc123`.

## 5. Display Pi setup

### 5.1 Install Chromium

Raspberry Pi OS Desktop often includes Chromium. If not:

```sh
sudo apt update
sudo apt install -y chromium-browser
```

On some distros the package is named `chromium`:

```sh
sudo apt install -y chromium
```

### 5.2 Manual test

On the display Pi, verify the page loads:

```sh
chromium-browser --kiosk --noerrdialogs --disable-infobars http://<server-ip>:4321/d/<token>
```

Use `chromium` if `chromium-browser` is not available.

### 5.3 Kiosk autostart on boot

On Raspberry Pi OS Desktop with LXDE:

```sh
mkdir -p ~/.config/lxsession/LXDE-pi
nano ~/.config/lxsession/LXDE-pi/autostart
```

Example:

```text
@xset s off
@xset -dpms
@xset s noblank
@chromium-browser --kiosk --noerrdialogs --disable-infobars http://<server-ip>:4321/d/<token>
```

Reboot:

```sh
sudo reboot
```

On Wayland/labwc images, autostart paths differ — register the same Chromium command in your compositor's startup settings.

## 6. Companion agent install

The agent is optional. It enables remote reload, identify, screen on/off, and power schedules from the editor.

Run on the display Pi:

```sh
curl -sSL http://<server-ip>:4321/agent/install.sh \
  | sudo env PANEO_SERVER=http://<server-ip>:4321 \
    PANEO_TOKEN=<token> \
    bash
```

Check status:

```sh
systemctl status paneo-agent
journalctl -u paneo-agent -f
```

When **Agent connected** appears in the editor settings, installation succeeded.

Power control is chosen automatically:

- Raspberry Pi firmware: `vcgencmd display_power`
- Wayland: `wlr-randr`
- X11: `xset dpms`
- Unsupported environments: simulator log only

On Wayland, set `PANEO_DISPLAY_OUTPUT` if your output name is not `HDMI-A-1`.

## 7. Basic workflow

1. Open the editor at `http://<server-ip>:4321/`.
2. Select or create a display.
3. Add widgets — clock, date, weather, photos, RSS, monthly calendar, Home Assistant, etc.
4. Configure each widget in the properties panel.
5. Drag and resize to arrange the layout.
6. Press **Apply** when the preview looks right.
7. Connected displays update over WebSocket immediately.

Drafts auto-save while editing, but live displays only change after **Apply**.

## 8. Feature configuration

### 8.1 Resolution and orientation

Match the display resolution in settings:

- Landscape TV/monitor: `1920 × 1080`, `1280 × 720`
- Portrait: `1080 × 1920`, `480 × 800`
- Custom panels: enter W/H manually

The editor canvas uses this aspect ratio, so matching the real device matters.

### 8.2 Performance profile

- **High**: Pi 4/5, mini PC. Enables Ken Burns and similar effects.
- **Low**: Pi 3, Zero 2, etc. Longer poll intervals, lighter rendering.
- **Auto**: display browser estimates tier from memory and CPU cores.

### 8.3 Home Assistant

Save the HA server URL and long-lived access token in settings.

Example:

```text
http://192.168.0.20:8123
```

Add a **Home Assistant** widget and set the entity ID:

```text
sensor.living_room_temperature
light.living_room
switch.air_purifier
```

Tokens stay on the server and are never exposed in display URLs.

### 8.4 Photo frame

The photo slideshow widget supports:

- `urls` — image URL list
- `local` — `data/photos` on the server
- `unsplash` — keyword-based external images
- `immich` — Immich server + API key

For local photos on the server:

```sh
mkdir -p data/photos
cp *.jpg data/photos/
```

No server restart needed — the list updates on the next poll.

### 8.5 External page

The external page widget accepts `http/https` URLs only. Sandbox modes:

- `scripts` — default; allows scripts but not same-origin privileges
- `strict` — most restrictive; good for static pages
- `trusted` — for sites you trust; includes `allow-same-origin`

Some sites block iframe embedding via `X-Frame-Options` or CSP — that is the site's policy, not a Paneo bug.

### 8.6 Remote control REST API (automation)

The editor's own toolbar buttons (Reload, Identify, Screen on/off, Restart kiosk, Update) are just thin wrappers around two REST endpoints. External automation — Home Assistant, a cron job, a script — can call the same endpoints directly.

Since §12 the editor requires an admin login and `/api/*` is gated accordingly — but both endpoints below are an exception: the display's own **pairing token**, used in the URL in place of the internal device id, doubles as the credential (no separate API token, no `Authorization` header). Find it in the editor → ⚙ Settings → **This display's device token**. It only ever authorizes requests for *that one display* — it can't list other devices, edit layouts, or reach anything else under `/api/*`.

**Control** — `POST /api/devices/<device-token>/command`, JSON body `{"action": ...}`:

| `action` | Extra fields | Effect | Needs companion agent |
|---|---|---|---|
| `reload` | — | Reloads the display's browser page | No (sent to the display directly) |
| `identify` | — | Briefly flashes an on-screen indicator so you can spot the physical device | No |
| `power` | `"on": true \| false` | Turns the physical screen on/off (§9) | Yes |
| `restart-kiosk` | — | Force-quits and relaunches the Chromium kiosk process | Yes |
| `update` | `"mode": "all" \| "server"` (default `"all"`) | Triggers a remote update — `all` = server+agent+kiosk, `server` = Docker image only | Yes |

Every response is `{ "ok": true, "agentPresent": boolean }` (or just `{ "ok": true }` for `reload`/`identify`, which don't need the agent). `agentPresent: false` means the command was queued but nothing is connected to act on it — for `power`/`restart-kiosk`/`update`, install and connect the companion agent (§6) first.

**Status** — `GET /api/devices/<device-token>/update-status` — poll this after an `update` (or any long-running) command to see whether it's still running:

```json
{ "status": "running", "mode": "all", "progress": 40, "step": "install_codecs", "step_msg": "Installing chromium video codecs", "error": null }
```

`status` is `idle` (nothing in progress or no recent activity), `running`, `done`, or `failed`.

**Example** — Home Assistant `rest_command` in `configuration.yaml`:

```yaml
rest_command:
  paneo_screen_on:
    url: "http://<server-ip>:4321/api/devices/<device-token>/command"
    method: POST
    content_type: "application/json"
    payload: '{"action": "power", "on": true}'
  paneo_screen_off:
    url: "http://<server-ip>:4321/api/devices/<device-token>/command"
    method: POST
    content_type: "application/json"
    payload: '{"action": "power", "on": false}'
  paneo_kiosk_restart:
    url: "http://<server-ip>:4321/api/devices/<device-token>/command"
    method: POST
    content_type: "application/json"
    payload: '{"action": "restart-kiosk"}'
```

Call `rest_command.paneo_screen_on` / `paneo_screen_off` / `paneo_kiosk_restart` from any HA automation, script, or dashboard button — e.g. chain `paneo_screen_on` followed by a delay and `paneo_kiosk_restart` if a particular display's Wayland compositor occasionally comes back with the wrong layout after a power cycle.

## 9. Version information

Each component has its own version. Query from the server:

```sh
curl http://<server-ip>:4321/api/version
```

The editor **Settings** panel also lists server, editor, display, and agent versions. The agent reports its version when it connects.

## 10. Network and security

- Keep server and displays on the same LAN when possible.
- Do not expose the editor directly to the public internet.
- Use HTTPS reverse proxy and authentication for remote access.
- Only trusted admins should enter HA or Immich credentials.
- Display URL tokens grant screen access — do not share them publicly.

## 11. Troubleshooting

Server won't start:

```sh
systemctl status paneo
journalctl -u paneo -f
docker logs -f paneo       # if running under Docker
docker ps -a --filter name=paneo   # confirm the container itself started
```

Check the port:

```sh
ss -ltnp | grep 4321
```

Display not updating:

- Verify the Pi can reach `http://<server-ip>:4321/d/<token>`.
- Confirm you pressed **Apply** in the editor.
- Check server logs for WebSocket errors.

Agent not connecting:

```sh
systemctl status paneo-agent
journalctl -u paneo-agent -f
```

Verify `PANEO_SERVER` and `PANEO_TOKEN`.

Screen power control not working:

- Try `vcgencmd display_power 0` directly.
- On Wayland, check `wlr-randr` and output name.
- On X11, verify `xset q` works.

External page widget empty:

- Confirm the URL uses `http://` or `https://`.
- Check whether the site allows iframe embedding.
- Try sandbox mode `scripts` or `trusted`.

## 12. Updates

### 12.1 One-click (devices installed via §2)

Run on the Pi itself — updates the server image, the companion agent, and (in `all` mode) codecs
and the kiosk browser restart, keeping all data (SQLite DB, photos, plugins) intact:

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/scripts/update-pi.sh | sudo bash
```

Server-only device (skips every kiosk-touching step — codec install, kiosk launcher, browser restart):

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/scripts/update-pi.sh | sudo bash -s server
```

If the server is already running on this Pi, you can fetch the script from it instead of GitHub:

```sh
curl -fsSL http://localhost:4321/update.sh | sudo bash
```

### 12.2 From the editor (no SSH needed)

If a display's companion agent is connected, the editor's ⚙ **Settings** panel shows **Update all**
and **Update server only** buttons that trigger the same `update-pi.sh` remotely over the existing
WebSocket connection — useful once a device is already set up and you don't want to SSH in. The
editor also shows whether a newer release is available before you click either button.

### 12.3 Manual (no install script / Docker Compose)

Pull the latest released image and restart:

```sh
docker pull ghcr.io/eigger/paneo:latest
sudo systemctl restart paneo
```

If you're running it with Docker Compose instead of the systemd unit:

```sh
cd /path/to/paneo   # wherever docker-compose.yml is
docker compose pull
docker compose up -d
```

(If you set up the server without Docker per §3.4: `cd` into the repo, `git pull`, `npm install`,
`sudo systemctl restart paneo`.)

If the agent changed, reinstall or update `/opt/paneo-agent/agent.js` and `version.json`, then:

```sh
sudo systemctl restart paneo-agent
```

## 13. Uninstallation

To completely remove Paneo, the companion agent, and the kiosk configuration from the device, run the following command:

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/uninstall.sh | sudo bash
```

This script stops and disables the systemd units (`paneo`, `paneo-agent`), removes all configurations, deletes the named Docker volume (`paneo-data`), and cleans up the Chromium kiosk autostart entries.

## 14. Deferred features

RTSP/camera streaming is not part of the current device install scope. Camera gateway integration (`go2rtc`, `MediaMTX`) and low-tier snapshot fallback are planned for a later milestone.
