# Paneo

Web-editable dashboards for Raspberry Pi / ambient displays.
Edit in the browser, hit **적용(Apply)**, and the display updates — no reload.

> Design doc: [docs/design.md](docs/design.md) (decision log in §0) · Milestone: **M1 complete**, M2 next

## What works today

- **Editor** (`/`): drag/resize a widget grid, per-widget settings (text/number/checkbox/dynamic URL lists), a
  categorized "+ 위젯 추가" popover, per-device resolution (presets + custom + rotate), editor UI language
  (ko/en) and per-device display locale — all in a ⚙ settings panel separate from the editing toolbar.
- **Display** (`/d/<token>`): kiosk page, WebSocket-pushed layout updates, offline cache (last layout persists
  through a network drop), real CSS Grid layout so the same data renders proportionally correct at any
  resolution/aspect ratio.
- **Draft/Publish model**: editing never touches the live display until you hit **적용** — publish broadcasts
  to every connected display for that device.
- **8 widgets**: clock, date, text, weather (Open-Meteo, no API key), calendar (multiple iCal URLs, merged +
  sorted), RSS/news (multiple feeds, merged + sorted), iframe, photo slideshow (multiple images, rotating).
- **Data proxy** (`src/dataproxy.js`): widgets never call third-party APIs directly — the server fetches,
  per-source-caches, and merges, so one broken calendar/feed doesn't take down the widget.
- **SQLite persistence** via Node's built-in `node:sqlite` — no native compile step.

## Run

```sh
npm install
npm start          # http://localhost:4321
```

- **Editor**: http://localhost:4321/ (a default device "거실" is seeded on first run)
- **Display**: click "디스플레이 열기" in the editor, or open `http://localhost:4321/d/<token>`

Open the display in a second tab/window, arrange widgets in the editor, press **적용**, and watch it update live.

## Layout / stack

- `src/server.js` — Fastify + `@fastify/websocket` REST + WS hub
- `src/store.js` — SQLite (`node:sqlite`) persistence; auto-migrates the old M0 JSON file if present
- `src/dataproxy.js` — server-side weather/iCal/RSS fetch + cache + multi-source merge
- `src/brand.js` — central name/`pluginPrefix` (rename the product from here)
- `public/shared/widgets.js` — widget registry shared by editor preview and display
- `public/shared/gridlayout.js` — shared CSS Grid sizing so editor preview and display stay proportionally in sync
- `public/editor/` — grid editor (drag/resize, settings modal, add-widget popover)
- `public/display/` — kiosk display page

## Widgets

`paneo.clock` · `paneo.date` · `paneo.text` · `paneo.weather` · `paneo.calendar` · `paneo.rss` · `paneo.iframe` · `paneo.photo`
