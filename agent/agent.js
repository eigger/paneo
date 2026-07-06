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

import { execSync, execFile, spawn } from 'node:child_process';
import { readFileSync, readdirSync, openSync, existsSync, unlinkSync } from 'node:fs';
import os from 'node:os';
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

console.log(`[agent] ${AGENT_COMPONENT} v${AGENT_VERSION}`);
console.log(`[agent] power method (best guess at startup): ${describePowerMethod()}`);
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
    stopUpdateStatusPolling(); // Stop any legacy poll just in case
    ws.send(JSON.stringify({ type: 'agent.hello', version: AGENT_VERSION, component: AGENT_COMPONENT }));
    // The update script restarts this very process partway through (both
    // 'all' and 'server' mode always refresh the agent) -- so the instance
    // that received the update command dies before it can ever report
    // completion. The new instance that comes up after the restart is the
    // one that has to notice and report it, via the status file
    // update-pi.sh itself writes (see reportPendingUpdateStatus below).
    reportPendingUpdateStatus(ws);
    startHeartbeat();
    ensureKioskStarted();
  });

  onSocket(ws, 'message', (event) => {
    const raw = event?.data ?? event;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'command') {
      if (msg.action === 'power') {
        console.log(`[agent] power command: ${msg.on ? 'ON' : 'OFF'}`);
        setPower(msg.on);
      } else if (msg.action === 'update') {
        const mode = msg.mode === 'server' ? 'server' : 'all';
        console.log(`[agent] update command: mode=${mode}`);
        runUpdate(mode);
      } else if (msg.action === 'restart-kiosk') {
        console.log('[agent] restart-kiosk command received');
        restartKiosk();
      }
    } else if (msg.type === 'agent.schedule') {
      console.log(`[agent] schedule received: ${JSON.stringify(msg.schedule)}`);
    }
  });

  onSocket(ws, 'close', () => {
    console.log(`[agent] disconnected. reconnecting in ${reconnectDelay / 1000}s...`);
    stopUpdateStatusPolling();
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
  });

  onSocket(ws, 'error', (err) => {
    console.error(`[agent] WS error: ${err.message || 'connection failed'}`);
    stopUpdateStatusPolling();
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
//
// The method is resolved fresh on every setPower() call, not cached once at
// startup: this agent normally starts (systemd, multi-user.target) before the
// desktop/Wayland session exists, so a one-time check at boot can permanently
// miss wlr-randr even though it'll work fine once the compositor is up.
// ---------------------------------------------------------------------------

function hasCommand(cmd) {
  try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return true; } catch { return false; }
}

// The agent's systemd service (see scripts/install-pi.sh) doesn't inherit the
// desktop session's WAYLAND_DISPLAY/XDG_RUNTIME_DIR -- wlr-randr needs both to
// reach the compositor's socket. It runs as the same OS user as the kiosk
// (systemd `User=`), so os.userInfo().uid gives the right runtime dir directly,
// mirroring how scripts/update-pi.sh's kiosk-restart step finds the socket.
function resolveWaylandEnv() {
  try {
    const runtimeDir = `/run/user/${os.userInfo().uid}`;
    const socket = readdirSync(runtimeDir).find((f) => /^wayland-\d+$/.test(f));
    return socket ? { XDG_RUNTIME_DIR: runtimeDir, WAYLAND_DISPLAY: socket } : null;
  } catch {
    return null; // compositor not up yet, or not a Wayland session
  }
}

function describePowerMethod() {
  if (hasCommand('wlr-randr') && resolveWaylandEnv()) return 'wlr-randr';
  if (hasCommand('xset') && process.env.DISPLAY) return 'xset';
  if (hasCommand('vcgencmd')) return 'vcgencmd (fallback -- often a no-op on Bookworm/full-KMS)';
  return 'simulator';
}

function setPower(on) {
  // Prefer wlr-randr whenever a live Wayland compositor socket can actually be
  // found -- on modern (Bookworm/full-KMS) Raspberry Pi OS, `vcgencmd
  // display_power` frequently exists but silently does nothing (the legacy
  // firmware call doesn't control the panel under the KMS driver), while
  // wlr-randr talks to the real compositor and is what actually worked in the
  // previous MagicMirror-based setup this replaces.
  const waylandEnv = resolveWaylandEnv();
  if (hasCommand('wlr-randr') && waylandEnv) {
    const output = process.env.PANEO_DISPLAY_OUTPUT || 'HDMI-A-1';
    run('wlr-randr', ['--output', output, on ? '--on' : '--off'], waylandEnv);
    return;
  }
  if (hasCommand('xset') && process.env.DISPLAY) {
    run('xset', ['dpms', 'force', on ? 'on' : 'off']);
    return;
  }
  if (hasCommand('vcgencmd')) {
    run('vcgencmd', ['display_power', on ? '1' : '0']);
    return;
  }
  // Simulator mode -- just log
  console.log(`[agent] [SIMULATED] screen power ${on ? 'ON' : 'OFF'}`);
}

function run(cmd, args, extraEnv) {
  const opts = extraEnv ? { env: { ...process.env, ...extraEnv } } : undefined;
  execFile(cmd, args, opts, (err) => {
    if (err) console.error(`[agent] ${cmd} failed: ${err.message}`);
    else console.log(`[agent] ${cmd} ${args.join(' ')} -> ok`);
  });
}

// ---------------------------------------------------------------------------
// Remote update trigger (editor "update" button -> here) — runs the update
// script installed + sudo-whitelisted by scripts/install-pi.sh's
// install_update_trigger(), scoped to exactly that one script path.
//
// mode 'all': server + agent + kiosk (codecs, launcher flags, browser
// restart). mode 'server': server + agent only, kiosk left untouched.
//
// The update script restarts this very agent process (systemctl restart
// paneo-agent) partway through in both modes, so the child is spawned fully
// detached (own process group, stdio redirected to a log file) — it must
// keep running after this process is killed out from under it, and a fresh
// agent instance reconnects once the restart completes.
// ---------------------------------------------------------------------------

function runUpdate(mode) {
  const scriptPath = '/usr/local/bin/paneo-update-pi.sh';
  const logFile = '/tmp/paneo-update.log';
  try {
    const out = openSync(logFile, 'a');
    const err = openSync(logFile, 'a');
    const child = spawn('sudo', [scriptPath, mode], {
      detached: true,
      stdio: ['ignore', out, err],
    });
    child.unref();
    console.log(`[agent] update started (mode=${mode}, pid=${child.pid}) — log: ${logFile}`);
    // Best-effort — this process (and this very connection) may well be
    // killed by the update script's own agent-restart step within seconds,
    // so there's no guarantee this actually reaches the server. That's fine:
    // the server also sets 'running' itself the moment it sent the command,
    // and reportPendingUpdateStatus() covers reporting how it actually ended.
    if (ws?.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify({ type: 'agent.status', status: 'running', mode }));
      startUpdateStatusPolling(ws);
    }
  } catch (e) {
    console.error(`[agent] failed to start update: ${e.message}`);
  }
}

// update-pi.sh writes its progress here (state: running|done|failed) so that
// whichever agent process is alive when the update actually finishes -- not
// necessarily the one that started it, since the update restarts this agent
// partway through -- can report the outcome on its next connection. Reported
// (and then removed) at most once: a stale "running" entry from a run that
// never got to write a terminal state (e.g. the Pi lost power mid-update) is
// discarded rather than left to read as perpetually in-progress.
const UPDATE_STATUS_FILE = '/tmp/paneo-update-status.json';
const UPDATE_STATUS_MAX_AGE_MS = 20 * 60_000;

let updateStatusInterval = null;
let updateStatusMissingCount = 0;

function startUpdateStatusPolling(socket) {
  if (updateStatusInterval) return;
  updateStatusMissingCount = 0;

  updateStatusInterval = setInterval(() => {
    let entry;
    try {
      if (!existsSync(UPDATE_STATUS_FILE)) {
        updateStatusMissingCount++;
        if (updateStatusMissingCount > 5) { // 10 seconds of missing file
          stopUpdateStatusPolling();
        }
        return;
      }
      updateStatusMissingCount = 0;
      entry = JSON.parse(readFileSync(UPDATE_STATUS_FILE, 'utf8'));
    } catch {
      // File might be in the middle of being written, ignore single read error
      return;
    }

    const ageMs = Date.now() - (Number(entry?.ts) || 0) * 1000;
    if (ageMs > UPDATE_STATUS_MAX_AGE_MS) {
      console.log('[agent] update status file is stale, cleaning up');
      try { unlinkSync(UPDATE_STATUS_FILE); } catch {}
      socket.send(JSON.stringify({ type: 'agent.status', status: 'failed', error: 'Update timed out' }));
      stopUpdateStatusPolling();
      return;
    }

    if (entry.state === 'running') {
      console.log(`[agent] update progress: ${entry.progress}% - ${entry.step_msg || entry.step}`);
      socket.send(JSON.stringify({
        type: 'agent.status',
        status: 'running',
        mode: entry.mode,
        progress: entry.progress,
        step: entry.step,
        step_msg: entry.step_msg
      }));
    } else if (['done', 'failed'].includes(entry.state)) {
      finishUpdateStatus(socket, entry);
      stopUpdateStatusPolling();
    }
  }, 2000);
}

// Reports the terminal state of a finished update-pi.sh run and, for a
// successful mode='all' run (server+agent+kiosk), restarts the kiosk so it
// picks up the freshly rewritten /usr/local/bin/paneo-kiosk launcher script
// (new flags/URL) -- update-pi.sh no longer restarts the browser itself
// (see scripts/update-pi.sh step 7), the agent is the only thing that does.
function finishUpdateStatus(socket, entry) {
  console.log(`[agent] update finished: ${entry.state}`);
  socket.send(JSON.stringify({
    type: 'agent.status',
    status: entry.state,
    mode: entry.mode,
    error: entry.error
  }));
  try { unlinkSync(UPDATE_STATUS_FILE); } catch { /* already reported; avoid re-sending on next reconnect */ }
  if (entry.state === 'done' && entry.mode === 'all') {
    console.log('[agent] update touched the kiosk — restarting it to pick up the new launcher script');
    restartKiosk();
  }
}

function stopUpdateStatusPolling() {
  if (updateStatusInterval) {
    clearInterval(updateStatusInterval);
    updateStatusInterval = null;
  }
}

function reportPendingUpdateStatus(socket) {
  let entry;
  try {
    if (!existsSync(UPDATE_STATUS_FILE)) return;
    entry = JSON.parse(readFileSync(UPDATE_STATUS_FILE, 'utf8'));
  } catch {
    return;
  }
  const ageMs = Date.now() - (Number(entry?.ts) || 0) * 1000;
  if (ageMs > UPDATE_STATUS_MAX_AGE_MS) {
    try { unlinkSync(UPDATE_STATUS_FILE); } catch { /* best-effort */ }
    return;
  }

  if (entry.state === 'running') {
    // Start polling to send updates
    startUpdateStatusPolling(socket);
  } else if (['done', 'failed'].includes(entry.state)) {
    finishUpdateStatus(socket, entry);
  }
}

// ---------------------------------------------------------------------------
// (Optional) Browser watchdog -- restarts chromium if it crashes
// Disabled by default; enable with PANEO_WATCHDOG=1
// ---------------------------------------------------------------------------

const KIOSK_LAUNCHER = '/usr/local/bin/paneo-kiosk';

function isKioskSessionRunning() {
  // paneo-kiosk waits up to ~2 min for the server before exec'ing chromium.
  // pgrep -x chromium alone false-positives during that window and the
  // watchdog used to spawn duplicate launchers every 30 s (reconnect/flicker).
  try {
    execSync(
      "pgrep -x paneo-kiosk >/dev/null 2>&1 || pgrep -f 'chromium.*--kiosk' >/dev/null 2>&1",
      { shell: '/bin/sh', stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

// Launch the kiosk browser. A systemd service doesn't inherit the desktop
// session's env — a raw `chromium-browser` spawn here has no
// WAYLAND_DISPLAY/XDG_RUNTIME_DIR to connect to the compositor (same problem
// setPower() above already works around via resolveWaylandEnv()), so it would
// fail to actually show anything even though the process technically starts.
// Launch the real kiosk launcher script instead of raw chromium — it already
// has the right flags/URL baked in and does its own Wayland/X11 detection at
// runtime, same as scripts/update-pi.sh's kiosk-restart.
function launchKiosk() {
  const waylandEnv = resolveWaylandEnv();
  const env = waylandEnv ? { ...process.env, ...waylandEnv, XDG_SESSION_TYPE: 'wayland' } : process.env;
  if (existsSync(KIOSK_LAUNCHER)) {
    execFile(KIOSK_LAUNCHER, [], { detached: true, env });
  } else {
    // Standalone/older install without the launcher script — fall back
    // to a raw launch, at least with the right display env if we found one.
    const DISPLAY_URL = process.env.PANEO_DISPLAY_URL || `${SERVER}/d/${TOKEN}`;
    execFile('chromium-browser', ['--kiosk', DISPLAY_URL], { detached: true, env });
  }
}

// Launch the kiosk once we know the server is reachable (first successful WS
// connect). There is no desktop-session autostart entry anymore (see
// install-pi.sh's install_kiosk()) -- the agent is the *only* thing that ever
// launches paneo-kiosk, so this keeps polling indefinitely rather than giving
// up: the agent's systemd unit commonly starts before the desktop session
// does, and on some devices (e.g. under-voltage/throttling) that session can
// take well over a minute to come up.
let startupKioskCheckStarted = false;

function ensureKioskStarted() {
  if (startupKioskCheckStarted) return;
  startupKioskCheckStarted = true;
  const poll = () => {
    if (isKioskSessionRunning()) return;
    if (!resolveWaylandEnv() && !process.env.DISPLAY) {
      // Desktop session isn't up yet -- keep waiting rather than launching
      // into a dead environment (see launchKiosk()'s comment on this).
      setTimeout(poll, 5000);
      return;
    }
    console.log('[agent] startup: kiosk not running, launching...');
    launchKiosk();
  };
  setTimeout(poll, 5000); // small initial delay so a fresh boot settles first
}

// Manual restart (editor "restart kiosk" button -> here): unlike the watchdog
// below, this must actively kill an already-running (but possibly just
// stuck/blank, e.g. a GPU driver fault) browser first -- the watchdog only
// ever launches when the process is already gone.
function restartKiosk() {
  try {
    execSync("pkill -f 'chromium.*--kiosk' 2>/dev/null; pkill -f paneo-kiosk 2>/dev/null", { shell: '/bin/sh' });
  } catch { /* no matching process -- fine */ }
  setTimeout(launchKiosk, 1500); // give the old process a moment to fully exit
}

if (process.env.PANEO_WATCHDOG === '1') {
  const DISPLAY_URL = process.env.PANEO_DISPLAY_URL || `${SERVER}/d/${TOKEN}`;
  const graceMs = Number(process.env.PANEO_WATCHDOG_GRACE_MS) || 180_000;
  const startedAt = Date.now();
  console.log(`[agent] watchdog enabled for: ${DISPLAY_URL}`);
  setInterval(() => {
    if (isKioskSessionRunning()) return;
    if (Date.now() - startedAt < graceMs) return;
    console.log('[agent] watchdog: kiosk not running, relaunching...');
    launchKiosk();
  }, 30_000);
}

// Start
connect();
