# Paneo

[![CI](https://github.com/eigger/paneo/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/eigger/paneo/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.5-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![GitHub Release](https://img.shields.io/github/release/eigger/paneo.svg)](https://github.com/eigger/paneo/releases)
[![License](https://img.shields.io/github/license/eigger/paneo)](https://github.com/eigger/paneo/blob/master/LICENSE)
[![Raspberry Pi](https://img.shields.io/badge/Raspberry%20Pi-supported-C51A4A?logo=raspberrypi&logoColor=white)](docs/install-device.md)
[![Self-hosted](https://img.shields.io/badge/hosting-self--hosted-2563EB)](docs/design.md)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-widget-41BDF5?logo=home-assistant&logoColor=white)](docs/install-device.md#83-home-assistant)

[English](README.md) · [한국어](README.ko.md)

Web-editable dashboards for Raspberry Pi and ambient displays.
Edit in the browser, hit **Apply**, and connected displays update live — no reload.

> Design doc: [docs/design.md](docs/design.md) (decision log in §0) · Milestone: **M6 non-RTSP complete**, RTSP deferred

## What works today

- **Editor** (`/`): drag/resize a widget grid, per-widget settings (text/number/checkbox/dynamic URL lists), a
  categorized **Add widget** popover, per-device resolution (presets + custom + rotate), editor UI language
  (ko/en) and per-device display locale — all in a ⚙ settings panel separate from the editing toolbar.
- **Display** (`/d/<token>`): kiosk page, WebSocket-pushed layout updates, offline cache (last layout persists
  through a network drop), real CSS Grid layout so the same data renders proportionally correct at any
  resolution/aspect ratio.
- **Draft/Publish model**: editing never touches the live display until you hit **Apply** — publish broadcasts
  to every connected display for that device.
- **11 widgets**: clock, date, text, weather (Open-Meteo, no API key), event list, monthly calendar,
  RSS/news, sandboxed external page, photo slideshow/photo frame, alarm timer, and Home Assistant entity.
- **Data proxy** (`src/dataproxy.js`): widgets never call third-party APIs directly — the server fetches,
  per-source-caches, and merges, so one broken calendar/feed doesn't take down the widget.
- **Device management**: per-device resolution/locale/performance profile, groups, live reload/identify,
  and optional companion-agent power scheduling.
- **M6 third-party guardrails**: external pages render through a sandboxed iframe, and the editor surfaces
  widget version/required capabilities/permissions before publish. RTSP/camera streaming is intentionally deferred.
- **SQLite persistence** via Node's built-in `node:sqlite` — no native compile step.

## Run

```sh
npm install
npm start          # http://localhost:4321
```

- **Editor**: http://localhost:4321/ (a default device is seeded on first run)
- **Display**: click **Open display** in the editor, or open `http://localhost:4321/d/<token>`

Open the display in a second tab/window, arrange widgets in the editor, press **Apply**, and watch it update live.

## Tests

```sh
npm test
```

CI runs the same test suite on Node.js 22 and 24 via GitHub Actions (`.github/workflows/ci.yml`).

## Install on real devices

See [`docs/install-device.md`](docs/install-device.md) ([한국어](docs/install-device.ko.md)) for the full Raspberry Pi / kiosk setup:

- server installation and `systemd` service
- Chromium kiosk autostart on display devices
- optional companion-agent installation for screen power control
- first dashboard setup, Home Assistant, photo frame, and troubleshooting

Raspberry Pi install — run **only the block for your role**.

**Server Pi** (`paneo` service only):

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh | sudo env PANEO_MODE=server bash
```

**Display Pi** (kiosk + agent; requires a running server and token):

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh \
  | sudo env PANEO_MODE=display \
      PANEO_SERVER=http://<server-ip>:4321 \
      PANEO_TOKEN=<token> \
      bash
```

**All-in-one Pi** (server + display + agent in one step — do not also run the sections above):

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh | sudo env PANEO_MODE=all bash
```

Full guide: [`docs/install-device.md`](docs/install-device.md)

## Layout / stack

- `src/server.js` — Fastify + `@fastify/websocket` REST + WS hub
- `src/store.js` — SQLite (`node:sqlite`) persistence; auto-migrates the old M0 JSON file if present
- `src/dataproxy.js` — server-side weather/iCal/RSS fetch + cache + multi-source merge
- `src/brand.js` — central name/`pluginPrefix` (rename the product from here)
- `public/shared/widgets.js` — widget registry shared by editor preview and display
- `public/shared/gridlayout.js` — shared CSS Grid sizing so editor preview and display stay proportionally in sync
- `public/editor/` — grid editor (drag/resize, settings modal, add-widget popover)
- `public/display/` — kiosk display page
- `agent/` — optional companion agent for display power control
- `install.sh` — GitHub bootstrap installer for Raspberry Pi
- `scripts/install-pi.sh` — Raspberry Pi one-click installer for server/display/all-in-one modes
- `test/` — Node.js built-in test runner suite

## Widgets

`paneo.clock` · `paneo.date` · `paneo.text` · `paneo.weather` · `paneo.calendar` · `paneo.calendar.month` ·
`paneo.rss` · `paneo.iframe` · `paneo.photo` · `paneo.timer` · `paneo.homeassistant`

## Repository

https://github.com/eigger/paneo
