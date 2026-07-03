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

const demoWidgets = [
  { id: 'shot-clock', type: 'paneo.clock', x: 0, y: 0, w: 4, h: 2, config: { hour12: false } },
  { id: 'shot-date', type: 'paneo.date', x: 4, y: 0, w: 4, h: 2, config: {} },
  { id: 'shot-weather', type: 'paneo.weather', x: 8, y: 0, w: 4, h: 2, config: { location: 'Seoul', units: 'metric' } },
  { id: 'shot-cal', type: 'paneo.calendar.month', x: 0, y: 2, w: 7, h: 5, config: { icsUrls: [], showWeekNumber: false } },
  { id: 'shot-text', type: 'paneo.text', x: 7, y: 2, w: 5, h: 2, config: { text: 'Paneo' } },
  {
    id: 'shot-photo',
    type: 'paneo.photo',
    x: 7,
    y: 4,
    w: 5,
    h: 3,
    config: { source: 'unsplash', unsplashKeyword: 'landscape', fit: 'cover', effects: true, intervalSec: 30 },
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

  const draft = {
    grid: { cols: 12, rows: 7, gap: 8 },
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
      const editor = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await editor.goto(`${base}/editor/`, { waitUntil: 'networkidle' });
      await editor.waitForSelector('#canvas .ed-widget', { timeout: 20_000 });
      await editor.waitForSelector('#canvas .w-weather', { timeout: 20_000 });
      await sleep(1500);
      await editor.screenshot({ path: path.join(OUT, 'editor.png') });
      await editor.close();

      const display = await browser.newPage({
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      });
      await display.goto(`${base}/d/${token}`, { waitUntil: 'networkidle' });
      await display.waitForSelector('.w-weather', { timeout: 20_000 });
      await sleep(2000);
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
