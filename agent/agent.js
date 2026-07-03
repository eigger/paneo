/**
 * Paneo Companion Agent (docs/design.md §4.1 D, §9, §M4)
 *
 * Connects to the Paneo server via WebSocket and handles OS-level tasks
 * that a browser page cannot do: screen power on/off, brightness, watchdog.
 *
 * Usage:
 *   PANEO_SERVER=http://localhost:4321 PANEO_TOKEN=<device-token> node agent/agent.js
 *
 * On a real Raspberry Pi, set the environment variables in the systemd service
 * (see agent/install.sh). In development, it runs in simulator mode and just
 * prints what it would do instead of running real OS commands.
 *
 * Power control methods tried in order (first one that exists wins):
 *   1. vcgencmd display_power 0/1           (Pi firmware — preferred)
 *   2. wlr-randr --output <OUTPUT> --off/--on  (Wayland compositors)
 *   3. xset dpms force off/on               (X11)
 *   4. [simulator mode] console log only
 */

import { execSync, execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT_DIR = path.dirname(fileURLToPath(import.meta.url));
let AGENT_VERSION = '0.0.1';
try {
  AGENT_VERSION = JSON.parse(readFileSync(path.join(AGENT_DIR, 'version.json'), 'utf8')).version;
} catch { /* standalone copy without version.json */ }
const AGENT_COMPONENT = 'paneo-agent';

// Prefer Node 22+'s built-in WebSocket so the installed agent can run from
// /opt/paneo-agent without a local node_modules directory. Fall back to `ws`
// for local development on older Node versions.
let WebSocketImpl = globalThis.WebSocket;
if (!WebSocketImpl) {
  try {
    const { createRequire } = await import('node:module');
    WebSocketImpl = createRequire(import.meta.url)('ws');
  } catch {
    console.error('[agent] ERROR: WebSocket is unavailable. Use Node.js 22+ or run `npm install` in the project root.');
    process.exit(1);
  }
}

const SERVER = (process.env.PANEO_SERVER || 'http://localhost:4321').replace(/\/$/, '');
const TOKEN  = process.env.PANEO_TOKEN;
const WS_URL = SERVER.replace(/^http/, 'ws') + `/ws/agent?token=${TOKEN}`;

if (!TOKEN) {
  console.error('[agent] PANEO_TOKEN is required. Set it to your device\'s pairing token.');
  process.exit(1);
}

// Detect available power control method once at startup
const POWER_METHOD = detectPowerMethod();
console.log(`[agent] ${AGENT_COMPONENT} v${AGENT_VERSION}`);
console.log(`[agent] power method: ${POWER_METHOD}`);
console.log(`[agent] connecting to ${WS_URL}`);

let ws = null;
let reconnectDelay = 2000; // start at 2s, doubles up to 60s

function onSocket(socket, event, handler) {
  if (typeof socket.on === 'function') {
    socket.on(event, handler);
  } else {
    socket.addEventListener(event, handler);
  }
}

function connect() {
  ws = new WebSocketImpl(WS_URL);

  onSocket(ws, 'open', () => {
    console.log('[agent] connected');
    reconnectDelay = 2000; // reset on successful connect
    ws.send(JSON.stringify({ type: 'agent.hello', version: AGENT_VERSION, component: AGENT_COMPONENT }));
    startHeartbeat();
  });

  onSocket(ws, 'message', (event) => {
    const raw = event?.data ?? event;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'command') {
      if (msg.action === 'power') {
        console.log(`[agent] power command: ${msg.on ? 'ON' : 'OFF'}`);
        setPower(msg.on);
      }
    } else if (msg.type === 'agent.schedule') {
      console.log(`[agent] schedule received: ${JSON.stringify(msg.schedule)}`);
    }
  });

  onSocket(ws, 'close', () => {
    console.log(`[agent] disconnected. reconnecting in ${reconnectDelay / 1000}s...`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
  });

  onSocket(ws, 'error', (err) => {
    console.error(`[agent] WS error: ${err.message || 'connection failed'}`);
    // 'close' will fire after 'error', triggering reconnect
  });
}

function startHeartbeat() {
  const iv = setInterval(() => {
    if (ws?.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify({
        type: 'agent.heartbeat',
        ts: Date.now(),
        version: AGENT_VERSION,
        component: AGENT_COMPONENT,
      }));
    } else {
      clearInterval(iv);
    }
  }, 60_000);
}

// ---------------------------------------------------------------------------
// Power control -- platform-specific
// ---------------------------------------------------------------------------

function detectPowerMethod() {
  try {
    execSync('which vcgencmd', { stdio: 'ignore' });
    return 'vcgencmd';
  } catch { /* not found */ }
  try {
    execSync('which wlr-randr', { stdio: 'ignore' });
    return 'wlr-randr';
  } catch { /* not found */ }
  try {
    execSync('which xset', { stdio: 'ignore' });
    return 'xset';
  } catch { /* not found */ }
  return 'simulator';
}

function setPower(on) {
  switch (POWER_METHOD) {
    case 'vcgencmd':
      // Pi firmware: 0 = off, 1 = on
      run('vcgencmd', ['display_power', on ? '1' : '0']);
      break;
    case 'wlr-randr': {
      // Wayland: find active outputs and toggle
      const output = process.env.PANEO_DISPLAY_OUTPUT || 'HDMI-A-1';
      run('wlr-randr', ['--output', output, on ? '--on' : '--off']);
      break;
    }
    case 'xset':
      run('xset', ['dpms', 'force', on ? 'on' : 'off']);
      break;
    default:
      // Simulator mode -- just log
      console.log(`[agent] [SIMULATED] screen power ${on ? 'ON' : 'OFF'}`);
  }
}

function run(cmd, args) {
  execFile(cmd, args, (err, stdout, stderr) => {
    if (err) console.error(`[agent] ${cmd} failed: ${err.message}`);
    else console.log(`[agent] ${cmd} ${args.join(' ')} -> ok`);
  });
}

// ---------------------------------------------------------------------------
// (Optional) Browser watchdog -- restarts chromium if it crashes
// Disabled by default; enable with PANEO_WATCHDOG=1
// ---------------------------------------------------------------------------

if (process.env.PANEO_WATCHDOG === '1') {
  const DISPLAY_URL = process.env.PANEO_DISPLAY_URL || `${SERVER}/d/${TOKEN}`;
  console.log(`[agent] watchdog enabled for: ${DISPLAY_URL}`);
  setInterval(() => {
    try {
      execSync('pgrep -x chromium-browser || pgrep -x chromium', { stdio: 'ignore' });
    } catch {
      console.log('[agent] watchdog: chromium not found, relaunching...');
      execFile('chromium-browser', ['--kiosk', DISPLAY_URL], { detached: true });
    }
  }, 30_000);
}

// Start
connect();
