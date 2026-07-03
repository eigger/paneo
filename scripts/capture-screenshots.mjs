#!/usr/bin/env node
// Capture editor + display screenshots for README.
// One-time setup: npm install --no-save playwright && npx playwright install chromium
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.SCREENSHOT_PORT || 4323);
const OUT = path.join(ROOT, 'docs', 'images');

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
    config: {
      icsUrls: [
        'https://www.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics',
      ],
    },
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

async function seedDemoLayout(base) {
  const devices = await fetch(`${base}/api/devices`).then((r) => r.json());
  const device = devices[0];
  if (!device) throw new Error('no seeded device');

  const patch = await fetch(`${base}/api/devices/${device.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Living Room',
      locale: 'en-US',
      timezone: 'America/New_York',
    }),
  });
  if (!patch.ok) throw new Error(`device patch failed: ${patch.status}`);

  const draft = {
    grid: { cols: 12, rows: 9, gap: 8 },
    background: '#0b0f19',
    widgets: demoWidgets,
  };

  const put = await fetch(`${base}/api/devices/${device.id}/draft`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ layout: draft }),
  });
  if (!put.ok) throw new Error(`draft save failed: ${put.status}`);

  const pub = await fetch(`${base}/api/devices/${device.id}/publish`, { method: 'POST' });
  if (!pub.ok) throw new Error(`publish failed: ${pub.status}`);

  return device.token;
}

async function waitForWidgets(page, scope) {
  const prefix = scope ? `${scope} ` : '';
  await page.waitForSelector(`${prefix}.w-weather`, { timeout: 30_000 });
  await page.waitForSelector(`${prefix}.w-rss li`, { timeout: 30_000 });
  await page.waitForSelector(`${prefix}.w-cal-month`, { timeout: 15_000 });
  await page.waitForSelector(`${prefix}.w-timer .timer-row`, { timeout: 15_000 });
  await page.waitForSelector(`${prefix}.w-image[style*="background-image"]`, { timeout: 30_000 });
  await sleep(4000);
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
    const token = await seedDemoLayout(base);

    const { chromium } = await import('playwright');
    mkdirSync(OUT, { recursive: true });

    const browser = await chromium.launch();
    try {
      const editor = await browser.newPage({ viewport: { width: 1440, height: 960 } });
      await editor.addInitScript(() => {
        localStorage.setItem('paneo:lang', 'en');
      });
      await editor.goto(`${base}/editor/`, { waitUntil: 'networkidle' });
      await editor.waitForSelector('#canvas .ed-widget', { timeout: 30_000 });
      await waitForWidgets(editor, '#canvas');
      await editor.screenshot({ path: path.join(OUT, 'editor.png') });
      await editor.close();

      const display = await browser.newPage({
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      });
      await display.goto(`${base}/d/${token}`, { waitUntil: 'networkidle' });
      await waitForWidgets(display);
      await display.screenshot({ path: path.join(OUT, 'display.png') });
      await display.close();
    } finally {
      await browser.close();
    }

    console.log(`Saved ${path.join(OUT, 'editor.png')}`);
    console.log(`Saved ${path.join(OUT, 'display.png')}`);
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
