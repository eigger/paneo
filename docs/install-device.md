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

**Installs:** Node.js and the Paneo server (`paneo` systemd service). This device hosts the editor, API, and SQLite data.

**Run only on the server device:**

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh | sudo env PANEO_MODE=server bash
```

If you already have the source tree:

```sh
sudo env PANEO_MODE=server PANEO_DIR=$PWD bash scripts/install-pi.sh
```

After install: editor at `http://<server-ip>:4321/` · check status with `systemctl status paneo`

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

If you already have the source tree:

```sh
sudo env PANEO_MODE=all PANEO_DIR=$PWD PANEO_DEVICE_NAME="Living Room" bash scripts/install-pi.sh
```

Options: `PANEO_PORT=8080`, `PANEO_TOKEN=<token>`, `PANEO_ENABLE_AGENT=0`, `PANEO_ENABLE_KIOSK=0`

---

The manual steps below are for fine-tuning or when you do not use the one-click script.

## 3. Server install

### 3.1 Prerequisites

Node.js is required. Paneo uses `node:sqlite`, so Node.js **22.5+** or **24+** is recommended.

```sh
node --version
```

On Raspberry Pi OS or Debian, install a current Node release via NodeSource if the system package is too old.

### 3.2 Get the source

```sh
git clone https://github.com/eigger/paneo.git
cd paneo
npm install
```

If you already have the repo, run `npm install` from the project root.

### 3.3 Run the server

```sh
npm start
```

Default port: `4321`.

- Editor: `http://<server-ip>:4321/`
- Display: `http://<server-ip>:4321/d/<token>`

Custom port:

```sh
PORT=8080 npm start
```

### 3.4 Register a systemd service

On the server device, create `/etc/systemd/system/paneo.service`:

```sh
sudo nano /etc/systemd/system/paneo.service
```

Example:

```ini
[Unit]
Description=Paneo Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/paneo
Environment=PORT=4321
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Adjust paths and user for your environment.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now paneo
sudo systemctl status paneo
```

Logs:

```sh
journalctl -u paneo -f
```

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

On the server device:

```sh
cd /home/pi/paneo
git pull
npm install
sudo systemctl restart paneo
```

If the agent changed, reinstall or update `/opt/paneo-agent/agent.js` and `version.json`, then:

```sh
sudo systemctl restart paneo-agent
```

## 13. Deferred features

RTSP/camera streaming is not part of the current device install scope. Camera gateway integration (`go2rtc`, `MediaMTX`) and low-tier snapshot fallback are planned for a later milestone.
