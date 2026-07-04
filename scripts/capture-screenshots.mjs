#!/usr/bin/env node
// Capture README screenshots (dashboard + per-widget).
// One-time setup: npm install --no-save playwright && npx playwright install chromium
//
// Modes (PANEO_SCREENSHOT_MODE):
//   all       — editor.png, display.png, and docs/images/widgets/*.png (default)
//   dashboard — editor + full display only
//   widgets   — per-widget PNGs only
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.SCREENSHOT_PORT || 4323);
const OUT = path.join(ROOT, 'docs', 'images');
const OUT_WIDGETS = path.join(OUT, 'widgets');
const MODE = process.env.PANEO_SCREENSHOT_MODE || 'all';

const HOLIDAY_ICS =
  'https://www.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics';

// Generated locally (not fetched from a third party) so the calendar-view
// screenshots always have an event on "today" regardless of what day this
// script happens to run — a public holiday feed can't guarantee that, and
// the day-view shot in particular would otherwise show an empty "No events".
const DEMO_ICS_FILENAME = '_demo-calendar.ics';
function icsDate(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
function buildDemoIcs() {
  const now = new Date();
  const at = (dayOffset, hour) => {
    // Local setters, not UTC ones — "today" (offset 0) must match whatever
    // day the browser's own `new Date()` considers local "today" when the
    // widget renders, or a host timezone west of UTC can shift an event
    // dated "today" into what the widget sees as tomorrow (or vice versa).
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const events = [
    { summary: 'Team standup', start: at(0, 9), end: at(0, 9.5) },
    { summary: 'Design review', start: at(0, 14), end: at(0, 15) },
    { summary: 'Dentist appointment', start: at(1, 10), end: at(1, 11) },
    { summary: 'Grocery run', start: at(3, 18), end: at(3, 19) },
    { summary: 'Quarterly planning', start: at(9, 11), end: at(9, 12) },
    { summary: "Friend's birthday", start: at(16, 0), end: at(17, 0) },
    { summary: 'Conference talk', start: at(23, 13), end: at(23, 14) },
  ];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Paneo//Demo//EN'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.summary.replace(/\W+/g, '-')}@paneo-demo`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(e.end)}`,
      `SUMMARY:${e.summary}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// Demo layout: all built-in widgets except paneo.text and paneo.homeassistant (needs HA server).
const demoWidgets = [
  { id: 'w-clock', type: 'paneo.clock', x: 0, y: 0, w: 3, h: 2, config: { hour12: true } },
  { id: 'w-date', type: 'paneo.date', x: 3, y: 0, w: 3, h: 2, config: {} },
  { id: 'w-weather', type: 'paneo.weather', x: 6, y: 0, w: 3, h: 2, config: { location: 'London', units: 'metric' } },
  {
    id: 'w-timer',
    type: 'paneo.timer',
    x: 9,
    y: 0,
    w: 3,
    h: 2,
    config: { timers: ['Lunch|12:00|both', 'End of day|18:00|countdown'], showSeconds: true },
  },
  {
    id: 'w-calm',
    type: 'paneo.calendar.month',
    x: 0,
    y: 2,
    w: 5,
    h: 4,
    config: { icsUrls: [], showWeekNumber: false },
  },
  {
    id: 'w-photo',
    type: 'paneo.photo',
    x: 5,
    y: 2,
    w: 4,
    h: 4,
    config: {
      source: 'urls',
      urls: ['https://picsum.photos/seed/paneo-readme/960/720'],
      fit: 'cover',
      effects: false,
      intervalSec: 60,
    },
  },
  {
    id: 'w-rss',
    type: 'paneo.rss',
    x: 9,
    y: 2,
    w: 3,
    h: 4,
    config: { feedUrls: ['https://feeds.bbci.co.uk/news/world/rss.xml'] },
  },
  {
    id: 'w-iframe',
    type: 'paneo.iframe',
    x: 0,
    y: 6,
    w: 5,
    h: 3,
    config: { url: 'https://example.com', sandboxMode: 'scripts' },
  },
  {
    id: 'w-cal',
    type: 'paneo.calendar',
    x: 5,
    y: 6,
    w: 7,
    h: 3,
    config: { icsUrls: [`${HOLIDAY_ICS}|#60a5fa`] },
  },
];

/**
 * Per-widget capture specs — one widget fills the display grid.
 * `boxW`/`boxH` (CSS px) override the nominal `w`/`h` (grid cells) for sizing
 * the actual rendered widget box — used for the size-adaptive widgets below,
 * where the *exact* pixel box (not grid-cell count, which varies by display
 * resolution) is what decides which internal view/density they render.
 */
const widgetShots = [
  {
    slug: 'clock',
    label: 'Clock',
    w: 3,
    h: 2,
    type: 'paneo.clock',
    config: { hour12: true },
    ready: '.w-clock .clock-hm',
    waitMs: 500,
  },
  {
    slug: 'date',
    label: 'Date',
    w: 3,
    h: 2,
    type: 'paneo.date',
    config: {},
    ready: '.w-date .date-main',
    waitMs: 500,
  },
  {
    slug: 'timer',
    label: 'Alarm timer',
    w: 3,
    h: 2,
    type: 'paneo.timer',
    config: { timers: ['Lunch|12:00|both'], showSeconds: true },
    ready: '.w-timer .timer-row',
    waitMs: 500,
  },
  {
    slug: 'photo',
    label: 'Photo slideshow',
    w: 4,
    h: 3,
    type: 'paneo.photo',
    config: {
      source: 'urls',
      urls: ['https://picsum.photos/seed/paneo-widget-photo/800/600'],
      fit: 'cover',
      effects: false,
      intervalSec: 60,
    },
    ready: '.w-image[style*="background-image"]',
    waitMs: 2500,
  },
  {
    slug: 'iframe',
    label: 'External page',
    w: 5,
    h: 4,
    type: 'paneo.iframe',
    config: { url: 'https://example.com', sandboxMode: 'scripts' },
    ready: '.w-iframe',
    waitMs: 2000,
  },

  // ---- Size-adaptive widgets — same pluginId + config, only the rendered
  // box size differs, to prove the view genuinely switches on its own. ----

  {
    slug: 'calendar-day',
    label: 'Calendar — day view (small)',
    boxW: 200,
    boxH: 260,
    type: 'paneo.calendar.month',
    icsFromDemo: true,
    config: { showWeekNumber: false },
    ready: '.w-cal-day',
    waitMs: 3000,
  },
  {
    slug: 'calendar-week',
    label: 'Calendar — week view',
    boxW: 340,
    boxH: 180,
    type: 'paneo.calendar.month',
    icsFromDemo: true,
    config: { showWeekNumber: false },
    ready: '.cal-m-grid',
    waitMs: 3000,
  },
  {
    slug: 'calendar-3week',
    label: 'Calendar — 3-week view',
    boxW: 420,
    boxH: 300,
    type: 'paneo.calendar.month',
    icsFromDemo: true,
    config: { showWeekNumber: false },
    ready: '.cal-m-grid',
    waitMs: 3000,
  },
  {
    slug: 'calendar-month',
    label: 'Calendar — month view (large)',
    boxW: 640,
    boxH: 460,
    type: 'paneo.calendar.month',
    icsFromDemo: true,
    config: { showWeekNumber: false },
    ready: '.cal-m-grid',
    waitMs: 3000,
  },
  {
    slug: 'weather-compact',
    label: 'Weather — compact (small)',
    boxW: 260,
    boxH: 160,
    type: 'paneo.weather',
    config: { location: 'London', units: 'metric' },
    ready: '.w-weather .weather-temp',
    waitMs: 2000,
  },
  {
    slug: 'weather-forecast',
    label: 'Weather — with forecast (large)',
    boxW: 320,
    boxH: 260,
    type: 'paneo.weather',
    config: { location: 'London', units: 'metric' },
    ready: '.weather-forecast',
    waitMs: 2000,
  },
  {
    slug: 'airquality',
    label: 'Air quality — expanded (large)',
    boxW: 300,
    boxH: 260,
    type: 'paneo.airquality',
    config: { location: 'Seoul' },
    ready: '.aq-extra',
    waitMs: 2000,
  },
  {
    slug: 'rss',
    label: 'RSS / News — expanded (large)',
    boxW: 340,
    boxH: 300,
    type: 'paneo.rss',
    config: { feedUrls: ['https://feeds.bbci.co.uk/news/world/rss.xml'] },
    ready: '.rss-date',
    waitMs: 3000,
  },
  {
    slug: 'calendar',
    label: 'Event list — expanded (large)',
    boxW: 380,
    boxH: 280,
    type: 'paneo.calendar',
    config: { icsUrls: [`${HOLIDAY_ICS}|#60a5fa`] },
    ready: '.cal-legend',
    waitMs: 3000,
  },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(base) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${base}/api/brand`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await sleep(250);
  }
  throw new Error(`server did not start on ${base}`);
}

async function patchDeviceEn(base, deviceId) {
  // Match this host's own timezone rather than hardcoding one — the demo
  // calendar's events (buildDemoIcs) are generated in the host's local time,
  // and paneo.calendar.month buckets fetched events by *this* device
  // timezone, so a mismatch here would shift "today"'s events onto the
  // wrong day in the day/week/3-week/month screenshots.
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const patch = await fetch(`${base}/api/devices/${deviceId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Living Room',
      locale: 'en-US',
      timezone,
    }),
  });
  if (!patch.ok) throw new Error(`device patch failed: ${patch.status}`);
}

async function publishLayout(base, deviceId, layout) {
  const put = await fetch(`${base}/api/devices/${deviceId}/draft`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ layout }),
  });
  if (!put.ok) throw new Error(`draft save failed: ${put.status}`);

  const pub = await fetch(`${base}/api/devices/${deviceId}/publish`, { method: 'POST' });
  if (!pub.ok) throw new Error(`publish failed: ${pub.status}`);
}

// Reference grid for legacy (non-boxW/boxH) specs — matches the main
// dashboard capture (12x9 @ 1280x720) so vw/vh-sized text (clock/date/timer
// use vw, same as a real kiosk display) renders at realistic sizes instead
// of hitting its CSS clamp() *floor* just because the capture viewport
// happens to be small. The widget only spans its own w/h in the corner of
// that full-size grid — the screenshot still crops to just the widget.
const REFERENCE_VIEWPORT = { width: 1280, height: 720 };

function soloLayout(spec) {
  if (spec.boxW || spec.boxH) {
    // Exact-pixel-box specs (size-adaptive widgets): a 1x1 grid with the
    // single widget spanning it renders at exactly the viewport size (minus
    // the outer pad computed in captureWidgetShots below) — these widgets
    // size off container-query units, not vw/vh, so there's no reference
    // grid needed for them.
    return {
      grid: { cols: 1, rows: 1, gap: 8 },
      background: '#0b0f19',
      widgets: [{ id: 'solo', type: spec.type, x: 0, y: 0, w: 1, h: 1, config: spec.config }],
    };
  }
  return {
    grid: { cols: 12, rows: 9, gap: 8 },
    background: '#0b0f19',
    widgets: [{ id: 'solo', type: spec.type, x: 0, y: 0, w: spec.w, h: spec.h, config: spec.config }],
  };
}

async function waitForDashboard(page, scope) {
  const prefix = scope ? `${scope} ` : '';
  await page.waitForSelector(`${prefix}.w-weather`, { timeout: 30_000 });
  await page.waitForSelector(`${prefix}.w-rss li`, { timeout: 30_000 });
  await page.waitForSelector(`${prefix}.w-cal-month`, { timeout: 15_000 });
  await page.waitForSelector(`${prefix}.w-timer .timer-row`, { timeout: 15_000 });
  await page.waitForSelector(`${prefix}.w-image[style*="background-image"]`, { timeout: 30_000 });
  await sleep(4000);
}

// The connection-status pill (bottom-right) fades out 2s after connecting,
// but per-widget shots screenshot sooner than that for the quick-rendering
// widgets — rather than race that timing, hide it deterministically so it
// never leaks into a crop.
async function hideStatusPill(page) {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '#status { display: none !important; }';
      document.head.appendChild(style);
    });
  });
}

async function captureDashboard(browser, base, deviceId, token) {
  const editor = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await editor.addInitScript(() => {
    localStorage.setItem('paneo:lang', 'en');
  });
  await publishLayout(base, deviceId, {
    grid: { cols: 12, rows: 9, gap: 8 },
    background: '#0b0f19',
    widgets: demoWidgets,
  });
  await editor.goto(`${base}/editor/`, { waitUntil: 'networkidle' });
  await editor.waitForSelector('#canvas .ed-widget', { timeout: 30_000 });
  await waitForDashboard(editor, '#canvas');
  await editor.screenshot({ path: path.join(OUT, 'editor.png') });
  await editor.close();

  const display = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  await hideStatusPill(display);
  await display.goto(`${base}/d/${token}`, { waitUntil: 'networkidle' });
  await waitForDashboard(display);
  await display.screenshot({ path: path.join(OUT, 'display.png') });
  await display.close();

  console.log(`Saved ${path.join(OUT, 'editor.png')}`);
  console.log(`Saved ${path.join(OUT, 'display.png')}`);
}

async function captureWidgetShots(browser, base, deviceId, token) {
  mkdirSync(OUT_WIDGETS, { recursive: true });

  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await hideStatusPill(page);

  for (const rawSpec of widgetShots) {
    const spec = rawSpec.icsFromDemo
      ? { ...rawSpec, config: { ...rawSpec.config, icsUrls: [`${base}/${DEMO_ICS_FILENAME}`] } }
      : rawSpec;
    await publishLayout(base, deviceId, soloLayout(spec));

    // applyGridContainer() sets the canvas's own outer padding equal to the
    // grid `gap` (see gridlayout.js) — for a boxW/boxH spec the 1x1 grid's
    // single cell *is* the whole widget, so its actual rendered size is
    // exactly `viewport - 2*gap`. Legacy specs use the fixed REFERENCE_VIEWPORT
    // instead (see soloLayout) so their vw/vh-sized text renders realistically.
    const GRID_GAP = 8;
    if (spec.boxW || spec.boxH) {
      await page.setViewportSize({ width: spec.boxW + GRID_GAP * 2, height: spec.boxH + GRID_GAP * 2 });
    } else {
      await page.setViewportSize(REFERENCE_VIEWPORT);
    }

    await page.goto(`${base}/d/${token}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(spec.ready, { timeout: 30_000 });
    await sleep(spec.waitMs);

    const outPath = path.join(OUT_WIDGETS, `${spec.slug}.png`);
    const widget = page.locator('.widget').first();
    await widget.screenshot({ path: outPath });
    console.log(`Saved ${outPath} (${spec.label})`);
  }

  await page.close();
}

async function main() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paneo-screenshot-'));
  const base = `http://127.0.0.1:${PORT}`;

  // Served statically by the server itself (public/ → '/') so the calendar
  // widget's own server-side ICS fetch (src/dataproxy.js) can reach it.
  const demoIcsPath = path.join(ROOT, 'public', DEMO_ICS_FILENAME);
  writeFileSync(demoIcsPath, buildDemoIcs());

  // Some sandboxed/CI networks advertise a dead IPv6 route — Node's fetch
  // (undici) can hang retrying it instead of falling back to IPv4 fast
  // enough, which stalls the weather/air-quality proxy calls below. These
  // flags force IPv4 first and disable the dual-stack race entirely.
  const server = spawn(
    process.execPath,
    ['--no-network-family-autoselection', '--dns-result-order=ipv4first', 'src/server.js'],
    {
      cwd: ROOT,
      env: { ...process.env, PANEO_DATA_DIR: dataDir, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let serverLog = '';
  server.stdout?.on('data', (d) => { serverLog += d; });
  server.stderr?.on('data', (d) => { serverLog += d; });

  const stopServer = () => {
    if (!server.killed) server.kill();
  };
  process.on('exit', stopServer);
  process.on('SIGINT', () => { stopServer(); process.exit(1); });

  try {
    await waitForServer(base);
    mkdirSync(OUT, { recursive: true });

    const devices = await fetch(`${base}/api/devices`).then((r) => r.json());
    const device = devices[0];
    if (!device) throw new Error('no seeded device');
    await patchDeviceEn(base, device.id);

    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    try {
      if (MODE === 'dashboard' || MODE === 'all') {
        await captureDashboard(browser, base, device.id, device.token);
      }
      if (MODE === 'widgets' || MODE === 'all') {
        await captureWidgetShots(browser, base, device.id, device.token);
      }
    } finally {
      await browser.close();
    }
  } catch (err) {
    if (serverLog) console.error(serverLog);
    throw err;
  } finally {
    stopServer();
    rmSync(demoIcsPath, { force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
