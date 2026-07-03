#!/usr/bin/env node
// Capture README screenshots (dashboard + per-widget).
// One-time setup: npm install --no-save playwright && npx playwright install chromium
//
// Modes (PANEO_SCREENSHOT_MODE):
//   all       — editor.png, display.png, and docs/images/widgets/*.png (default)
//   dashboard — editor + full display only
//   widgets   — per-widget PNGs only
import { mkdtempSync, mkdirSync } from 'node:fs';
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
    config: { icsUrls: [HOLIDAY_ICS] },
  },
];

/** Per-widget capture specs — one widget fills the display grid. */
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
    slug: 'weather',
    label: 'Weather',
    w: 3,
    h: 2,
    type: 'paneo.weather',
    config: { location: 'London', units: 'metric' },
    ready: '.w-weather .weather-temp',
    waitMs: 2000,
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
    slug: 'calendar-month',
    label: 'Monthly calendar',
    w: 6,
    h: 5,
    type: 'paneo.calendar.month',
    config: { icsUrls: [], showWeekNumber: false },
    ready: '.w-cal-month .cal-m-grid',
    waitMs: 500,
  },
  {
    slug: 'calendar',
    label: 'Event list',
    w: 4,
    h: 4,
    type: 'paneo.calendar',
    config: { icsUrls: [HOLIDAY_ICS] },
    ready: '.w-calendar li',
    waitMs: 3000,
  },
  {
    slug: 'rss',
    label: 'RSS / News',
    w: 4,
    h: 4,
    type: 'paneo.rss',
    config: { feedUrls: ['https://feeds.bbci.co.uk/news/world/rss.xml'] },
    ready: '.w-rss li',
    waitMs: 3000,
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
  const patch = await fetch(`${base}/api/devices/${deviceId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Living Room',
      locale: 'en-US',
      timezone: 'America/New_York',
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

function soloLayout(spec) {
  return {
    grid: { cols: spec.w, rows: spec.h, gap: 8 },
    background: '#0b0f19',
    widgets: [{
      id: 'solo',
      type: spec.type,
      x: 0,
      y: 0,
      w: spec.w,
      h: spec.h,
      config: spec.config,
    }],
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

  for (const spec of widgetShots) {
    await publishLayout(base, deviceId, soloLayout(spec));

    const cellW = 130;
    const cellH = 96;
    const pad = 24;
    const width = spec.w * cellW + pad * 2;
    const height = spec.h * cellH + pad * 2;
    await page.setViewportSize({ width, height });

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

  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PANEO_DATA_DIR: dataDir, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

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
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
