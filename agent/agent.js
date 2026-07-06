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
const DISPLAY_URL = process.env.PANEO_DISPLAY_URL || `${SERVER}/d/${TOKEN}`;

if (!TOKEN) {
  console.error('[agent] PANEO_TOKEN is required. Set it to your device\'s pairing token.');
  process.exit(1);
}

console.log(`[agent] ${AGENT_COMPONENT} v${AGENT_VERSION}`);
console.log(`[agent] power method (best guess at startup): ${describePowerMethod()}`);
console.log(`[agent] connecting to ${WS_URL}`);

let ws = null;
let reconnectDelay = 2000; // start at 2s, doubles up to 60s
// Editor "성능 프로파일" setting (agent.config over the WS, see connect()) --
// 'low' launches the kiosk with --disable-gpu (see launchKiosk()).
let performanceProfile = 'high';
// True once the server's first agent.config message has actually arrived --
// ensureKioskStarted() waits on this (bounded) before its first launch so
// that launch doesn't race the config and boot with the wrong GPU flag.
let configReceived = false;

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
    } else if (msg.type === 'agent.config') {
      performanceProfile = msg.performanceProfile || 'high';
      configReceived = true;
      console.log(`[agent] performance profile: ${performanceProfile}`);
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
    // Pass TOKEN/SERVER/our own user explicitly rather than making
    // update-pi.sh re-derive the display URL by grepping the *existing*
    // kiosk launcher -- if that file was ever left corrupt/incomplete (e.g.
    // a reboot mid-write), grep-based extraction fails forever and every
    // future update silently skips regenerating it. Also passes our OS user
    // so update-pi.sh can chown the status file to it (see write_status()
    // in update-pi.sh) -- otherwise it stays root-owned in the sticky /tmp
    // dir and this agent's own unlinkSync() on it silently fails, leaving a
    // stale "done" status that gets reprocessed (and re-restarts the kiosk)
    // on the very next reconnect.
    const child = spawn('sudo', [scriptPath, mode, TOKEN, SERVER, os.userInfo().username], {
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
  const env = {
    ...process.env,
    ...(waylandEnv ? { ...waylandEnv, XDG_SESSION_TYPE: 'wayland' } : {}),
    PANEO_DISABLE_GPU: performanceProfile === 'low' ? '1' : '0',
  };
  if (existsSync(KIOSK_LAUNCHER)) {
    execFile(KIOSK_LAUNCHER, [], { detached: true, env });
  } else {
    // Standalone/older install without the launcher script — fall back
    // to a raw launch, at least with the right display env if we found one.
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

const CONFIG_WAIT_MAX_MS = 5000;

function ensureKioskStarted() {
  if (startupKioskCheckStarted) return;
  startupKioskCheckStarted = true;
  const configWaitStart = Date.now();
  const poll = () => {
    // Wait for the server's agent.config (performance profile) to actually
    // arrive before ever launching -- assuming a fixed delay is "enough
    // time" raced in the field under boot-time system load, launching once
    // with the default GPU setting instead of the device's real profile
    // (self-corrected later by the health check, but this closes the race
    // instead of just tolerating it). Bounded so a missing/slow config
    // doesn't block the kiosk from starting at all.
    if (!configReceived && Date.now() - configWaitStart < CONFIG_WAIT_MAX_MS) {
      setTimeout(poll, 200);
      return;
    }
    if (isKioskSessionRunning()) {
      verifyKioskHealthAfterBoot();
      return;
    }
    if (!resolveWaylandEnv() && !process.env.DISPLAY) {
      // Desktop session isn't up yet -- keep waiting rather than launching
      // into a dead environment (see launchKiosk()'s comment on this).
      setTimeout(poll, 5000);
      return;
    }
    console.log('[agent] startup: kiosk not running, launching...');
    launchKiosk();
    verifyKioskHealthAfterBoot();
  };
  // Start checking almost immediately -- the config-wait above (up to
  // CONFIG_WAIT_MAX_MS from configWaitStart, not from this call) already
  // provides the "let things settle" margin the old fixed 5s delay was for,
  // and the Wayland-readiness check further down retries on its own if the
  // desktop session isn't up yet either.
  setTimeout(poll, 200);
}

// Manual restart (editor "restart kiosk" button -> here): unlike the watchdog
// below, this must actively kill an already-running (but possibly just
// stuck/blank, e.g. a GPU driver fault) browser first -- the watchdog only
// ever launches when the process is already gone.
function restartKiosk() {
  try {
    // Only matches the main process (the one with --kiosk in its argv) --
    // Chromium's GPU/renderer/zygote helpers don't carry that flag in their
    // own command line and can survive as orphans after this (see
    // uninstall.sh's own note on the same issue). Left running, they hold
    // the profile's SingletonLock and can make the *next* launch fail
    // outright -- exactly what repeated health-check-triggered restarts hit
    // in the field (kiosk eventually stopped starting at all).
    execSync("pkill -f 'chromium.*--kiosk' 2>/dev/null; pkill -f paneo-kiosk 2>/dev/null", { shell: '/bin/sh' });
  } catch { /* no matching process -- fine */ }
  setTimeout(() => {
    try {
      // Escalate: sweep every remaining chromium process by binary name and
      // force-kill anything that ignored the signal above.
      execSync('pkill -9 -f chromium 2>/dev/null', { shell: '/bin/sh' });
    } catch { /* already gone -- fine */ }
    try {
      const profileDir = path.join(os.homedir(), '.config', 'paneo-chromium');
      for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
        try { unlinkSync(path.join(profileDir, f)); } catch { /* not present -- fine */ }
      }
    } catch { /* best-effort */ }
    launchKiosk();
  }, 1500); // give the old process a moment to fully exit before the sweep
}

// ---------------------------------------------------------------------------
// Post-boot render health check (CDP) -- isKioskSessionRunning() only proves
// the process exists, not that it actually painted anything. A GPU driver
// fault (under-voltage, EGL context failure, etc.) can leave chromium alive
// but showing a blank/white frame forever, which pgrep can't tell apart from
// a normal, working kiosk. Scoped to *boot only* (called once from
// ensureKioskStarted(), not from the watchdog or the manual restart button)
// so a device that's genuinely unable to render doesn't get restarted in a
// tight loop forever -- it gives up after a few tries and leaves recovery to
// the editor's manual "restart kiosk" button or the next reboot.
//
// paneo-kiosk launches chromium with --remote-debugging-port (see
// install-pi.sh/update-pi.sh), bound to loopback only, so this talks to it
// with nothing but Node's built-in fetch/WebSocket -- no new dependency.
// ---------------------------------------------------------------------------

const KIOSK_DEBUG_PORT = Number(process.env.PANEO_KIOSK_DEBUG_PORT) || 9222;
// Chromium retries its own GPU process several times before giving up and
// falling back to software rendering -- observed in the field taking ~30s
// (7 consecutive GPU-init failures) on a device with marginal power. Too
// short a delay here judges a kiosk "broken" while it's still mid-recovery,
// and restarting it resets that retry sequence back to zero, actively
// delaying the recovery it would otherwise have reached on its own.
const KIOSK_HEALTH_CHECK_DELAY_MS = Number(process.env.PANEO_KIOSK_HEALTH_DELAY_MS) || 45_000;
const KIOSK_HEALTH_MAX_ATTEMPTS = Number(process.env.PANEO_KIOSK_HEALTH_MAX_ATTEMPTS) || 3;
// A blank/solid-color PNG screenshot compresses far smaller than an actual
// dashboard (widgets, text, photos) -- catches compositor-level failures a
// DOM check alone can't (the DOM can be fully populated by JS while the GPU
// still fails to actually paint it to the screen).
const KIOSK_HEALTH_MIN_SCREENSHOT_LEN = Number(process.env.PANEO_KIOSK_HEALTH_MIN_SCREENSHOT_LEN) || 8000;

// One request/response round trip over a target's CDP WebSocket. Opens a
// fresh connection per call (simpler and more robust than multiplexing
// several calls over one socket) -- this only ever runs a handful of times
// right after boot, so the extra connection overhead doesn't matter.
function cdpRequest(wsUrl, method, params, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false;
    let ws;
    const timer = setTimeout(() => finish(null), timeoutMs);
    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws?.close(); } catch { /* already closed/never opened */ }
      resolve(result);
    }
    try {
      ws = new WebSocketImpl(wsUrl);
    } catch {
      finish(null);
      return;
    }
    onSocket(ws, 'open', () => {
      try {
        ws.send(JSON.stringify({ id: 1, method, params }));
      } catch {
        finish(null);
      }
    });
    onSocket(ws, 'message', (event) => {
      let msg;
      try { msg = JSON.parse(event?.data ?? event); } catch { return; }
      if (msg.id === 1) finish(msg.result ?? null);
    });
    onSocket(ws, 'error', () => finish(null));
  });
}

async function getKioskPageTarget() {
  try {
    const res = await fetch(`http://127.0.0.1:${KIOSK_DEBUG_PORT}/json/list`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const targets = await res.json();
    return targets.find((t) => t.type === 'page' && typeof t.url === 'string' && t.url.includes('/d/')) || null;
  } catch {
    return null; // debug port not up yet, or nothing listening there
  }
}

async function checkKioskRendering() {
  const target = await getKioskPageTarget();
  if (!target) return false;

  const domResult = await cdpRequest(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: "!!document.getElementById('stage') && document.getElementById('stage').childElementCount > 0",
    returnByValue: true,
  });
  if (!domResult?.result?.value) return false;

  const shotResult = await cdpRequest(target.webSocketDebuggerUrl, 'Page.captureScreenshot', { format: 'png' }, 8000);
  const dataLen = shotResult?.data?.length || 0;
  return dataLen >= KIOSK_HEALTH_MIN_SCREENSHOT_LEN;
}

function verifyKioskHealthAfterBoot(attempt = 1) {
  setTimeout(async () => {
    let healthy = false;
    try { healthy = await checkKioskRendering(); } catch { healthy = false; }
    if (healthy) {
      console.log('[agent] startup health check: kiosk is rendering OK');
      return;
    }
    if (attempt >= KIOSK_HEALTH_MAX_ATTEMPTS) {
      console.log(`[agent] startup health check: kiosk still not rendering after ${attempt} attempts -- giving up (use the editor's "restart kiosk" button, or it may recover on the next reboot)`);
      return;
    }
    console.log(`[agent] startup health check: kiosk not rendering (attempt ${attempt}/${KIOSK_HEALTH_MAX_ATTEMPTS}), restarting...`);
    restartKiosk();
    verifyKioskHealthAfterBoot(attempt + 1);
  }, KIOSK_HEALTH_CHECK_DELAY_MS);
}

if (process.env.PANEO_WATCHDOG === '1') {
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
