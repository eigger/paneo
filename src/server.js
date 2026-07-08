import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';
import path from 'node:path';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { BRAND } from './brand.js';
import { COMPONENTS, getVersionManifest, checkForUpdate } from './version.js';
import { parseNotifyBody, buildNotifyMessage } from './notify.js';
import * as store from './store.js';
import { registerDataProxy } from './dataproxy.js';
import { setAgentPresent } from './store.js';
import * as plugins from './plugins.js';
import * as auth from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const AGENT_DIR = path.join(__dirname, '..', 'agent');
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 4321);
// Same PANEO_DATA_DIR convention as store.js/plugins.js — must resolve to the
// mounted /data volume in the Docker image (see Dockerfile), not a path under
// __dirname, or every container recreation (every restart/update, since the
// systemd unit runs `docker run --rm`) silently wipes anything stored there.
const DATA_DIR = process.env.PANEO_DATA_DIR || path.join(process.cwd(), 'data');

const app = Fastify({ logger: { level: 'info', transport: undefined } });

await app.register(fastifyWebsocket);
await app.register(fastifyStatic, { root: PUBLIC, prefix: '/' });
// Local photo/video uploads (§ media widget) — capped well above any realistic
// single file (video included) but still bounded so a bad upload can't fill the disk.
await app.register(fastifyMultipart, { limits: { fileSize: 500 * 1024 * 1024, files: 20 } });
// §7/D17: third-party "module" plugins are filesystem-installed (admin trust,
// same level as the server's own code) — served as plain static files so the
// client can `import()` them directly. decorateReply:false because the first
// registration above already added reply.sendFile.
await app.register(fastifyStatic, { root: plugins.pluginsDir(), prefix: '/plugins/', decorateReply: false });
await registerDataProxy(app);
await store.load();
plugins.scan();

// PANEO_ADMIN_PASSWORD lets a docker-compose/systemd deployment declare the
// editor password up front (re-applied on every boot); without it, the editor
// shows a one-time "set admin password" form on first load (see /api/auth/setup).
if (process.env.PANEO_ADMIN_PASSWORD) {
  auth.setPassword(process.env.PANEO_ADMIN_PASSWORD);
}

// §12 보안: gate every /api/* route behind the editor's admin session, except
// the routes the *kiosk display itself* (unauthenticated by design — it only
// carries a per-device pairing token) and install scripts must keep calling
// directly. `/editor/*` static assets are intentionally NOT gated here — the
// SPA shell has no secrets in it; public/editor/editor.js blocks its own UI
// behind /api/auth/status until login succeeds, so gating only the API is
// sufficient and avoids fighting fastify-static's routing for the login page.
//
// D69/D70/D72: no separate API token — a device's own pairing token, already
// used to identify *which* display in /api/devices/:idOrToken/command and
// /update-status, also *authorizes* that call when it's the token (not the
// internal id) in the URL. One value does both jobs, so a Home Assistant
// rest_command needs nothing beyond the pairing token already shown in
// editor Settings (same one baked into that display's "Open display" URL).
// It only ever unlocks that one device's control/status endpoints — every
// other /api/* route (device list, layout, backup/restore, HA settings,
// ...) still needs the admin session.
const PUBLIC_API_ROUTES = ['/api/auth/status', '/api/auth/setup', '/api/auth/login', '/api/auth/logout'];
const PUBLIC_API_PREFIXES = ['/api/proxy/', '/api/display/', '/api/brand', '/api/version', '/api/update-check', '/api/plugins'];
const TOKEN_SCOPED_ROUTE = /^\/api\/devices\/([^/]+)\/(?:command|update-status|notify|notify-group)$/;
app.addHook('onRequest', async (req, reply) => {
  if (!req.url.startsWith('/api/')) return;
  const path = req.url.split('?')[0];
  if (PUBLIC_API_ROUTES.includes(path)) return;
  if (PUBLIC_API_PREFIXES.some((p) => path === p || path.startsWith(p))) return;
  const tokenMatch = path.match(TOKEN_SCOPED_ROUTE);
  if (tokenMatch && store.getDeviceByToken(tokenMatch[1])) return;
  const cookies = auth.parseCookies(req.headers.cookie);
  if (!auth.isValidSession(cookies[auth.SESSION_COOKIE_NAME])) {
    reply.code(401).send({ error: 'unauthorized' });
  }
});

app.get('/api/auth/status', async (req) => {
  const cookies = auth.parseCookies(req.headers.cookie);
  return { configured: auth.isConfigured(), authenticated: auth.isValidSession(cookies[auth.SESSION_COOKIE_NAME]) };
});

app.post('/api/auth/setup', async (req, reply) => {
  if (auth.isConfigured()) return reply.code(409).send({ error: 'already configured' });
  const password = String(req.body?.password || '');
  if (password.length < 8) return reply.code(400).send({ error: 'password too short' });
  auth.setPassword(password);
  reply.header('set-cookie', auth.sessionCookieHeader(auth.createSession()));
  return { ok: true };
});

app.post('/api/auth/login', async (req, reply) => {
  if (auth.isRateLimited(req.ip)) return reply.code(429).send({ error: 'too many attempts' });
  const password = String(req.body?.password || '');
  if (!auth.isConfigured() || !auth.checkPassword(password)) {
    return reply.code(401).send({ error: 'invalid password' });
  }
  reply.header('set-cookie', auth.sessionCookieHeader(auth.createSession()));
  return { ok: true };
});

app.post('/api/auth/logout', async (req, reply) => {
  auth.destroySession(auth.parseCookies(req.headers.cookie)[auth.SESSION_COOKIE_NAME]);
  reply.header('set-cookie', auth.clearCookieHeader());
  return { ok: true };
});

// --- live display connections: Map<deviceId, Set<socket>> ---
const displays = new Map();
const addDisplay = (id, s) => (displays.get(id) ?? displays.set(id, new Set()).get(id)).add(s);
const removeDisplay = (id, s) => displays.get(id)?.delete(s);
function broadcast(id, msg) {
  const data = JSON.stringify(msg);
  for (const s of displays.get(id) ?? []) {
    try { s.send(data); } catch { /* dropped */ }
  }
}

const publicDevice = (d) => ({
  id: d.id,
  name: d.name,
  token: d.token,
  performanceProfile: d.performanceProfile,
  locale: d.locale,
  timezone: d.timezone,
  resolutionW: d.resolutionW,
  resolutionH: d.resolutionH,
  groupId: d.groupId,
  powerSchedule: d.powerSchedule ?? null,
  // Runtime-only: live agent WS map is the source of truth (DB agentPresent is
  // reset on server start and can lag).
  agentPresent: agents.has(d.id),
  agentVersion: agentVersions.get(d.id) ?? null,
});
const fullDevice = (d) => ({ ...publicDevice(d), draft: d.draft, published: d.published, publishedAt: d.publishedAt });
const layoutMessage = (d) => ({ type: 'layout.set', layout: d.published, locale: d.locale, timezone: d.timezone, performanceProfile: d.performanceProfile });

// --- WebSocket: display clients connect here (docs/design.md §6) ---
app.get('/ws', { websocket: true }, (socket, req) => {
  const token = req.query?.token;
  const device = token ? store.getDeviceByToken(token) : null;
  if (!device) { socket.close(1008, 'unknown token'); return; }
  addDisplay(device.id, socket);
  socket.send(JSON.stringify(layoutMessage(device)));
  socket.on('close', () => removeDisplay(device.id, socket));
  socket.on('error', () => removeDisplay(device.id, socket));
});

// paneo.todo runtime edits (docs/design.md D27/D28) — token-authed like /ws (the
// display only ever knows its own pairing token, never the internal device id).
app.post('/api/display/:token/toggle-todo', async (req, reply) => {
  const { widgetId, index } = req.body || {};
  if (!widgetId || typeof index !== 'number') return reply.code(400).send({ error: 'widgetId and index required' });
  const device = store.toggleTodoItem(req.params.token, widgetId, index);
  if (!device) return reply.code(404).send({ error: 'not found' });
  broadcast(device.id, layoutMessage(device)); // sync every connected physical display for this device
  return { ok: true };
});

app.post('/api/display/:token/add-todo', async (req, reply) => {
  const { widgetId, text } = req.body || {};
  if (!widgetId || !text) return reply.code(400).send({ error: 'widgetId and text required' });
  const device = store.addTodoItem(req.params.token, widgetId, text);
  if (!device) return reply.code(404).send({ error: 'not found' });
  broadcast(device.id, layoutMessage(device));
  return { ok: true };
});

app.post('/api/display/:token/delete-todo', async (req, reply) => {
  const { widgetId, index } = req.body || {};
  if (!widgetId || typeof index !== 'number') return reply.code(400).send({ error: 'widgetId and index required' });
  const device = store.deleteTodoItem(req.params.token, widgetId, index);
  if (!device) return reply.code(404).send({ error: 'not found' });
  broadcast(device.id, layoutMessage(device));
  return { ok: true };
});

// --- WebSocket: companion-agent clients (docs/design.md §4.1 D, §M4) ---
const agents = new Map(); // Map<deviceId, WebSocket>
const agentVersions = new Map(); // Map<deviceId, string>
function sendToAgent(id, msg) {
  const s = agents.get(id);
  if (s) try { s.send(JSON.stringify(msg)); } catch { /* dropped */ }
}

// Remote-update progress (docs/design.md D#): in-memory only, like agents/
// agentVersions above — a lost server restart mid-update just means the
// editor falls back to "idle" and the user can check /tmp/paneo-update.log
// on the device directly. Set optimistically the moment a command is sent
// (before the agent's own 'running' ack can arrive — it may be racing its
// own restart) and updated again from the agent's agent.status messages,
// including after a reconnect once the update has actually finished.
const updateStatus = new Map(); // Map<deviceId, { status, mode, ts }>
const UPDATE_STATUS_STALE_MS = 20 * 60_000;
function setUpdateStatus(id, status, mode, progress = null, step = null, step_msg = null, error = null) {
  updateStatus.set(id, { status, mode, progress, step, step_msg, error, ts: Date.now() });
  broadcast(id, { type: 'update.status', status, mode, progress, step, step_msg, error });
}
function getUpdateStatus(id) {
  const entry = updateStatus.get(id);
  if (!entry || Date.now() - entry.ts > UPDATE_STATUS_STALE_MS) return { status: 'idle' };
  return entry;
}

app.get('/ws/agent', { websocket: true }, (socket, req) => {
  const token = req.query?.token;
  const device = token ? store.getDeviceByToken(token) : null;
  if (!device) { socket.close(1008, 'unknown token'); return; }

  agents.set(device.id, socket);
  setAgentPresent(device.id, true);
  app.log.info(`agent connected: ${device.name} (${device.id})`);

  // Send current power schedule so agent can self-manage if needed
  const ps = store.getDevice(device.id)?.powerSchedule;
  if (ps) socket.send(JSON.stringify({ type: 'agent.schedule', schedule: ps }));

  // Send current performance profile so the agent can decide whether to
  // launch the kiosk with --disable-gpu (editor "저성능" setting -- see
  // agent/agent.js's launchKiosk()).
  socket.send(JSON.stringify({ type: 'agent.config', performanceProfile: device.performanceProfile || 'high' }));

  socket.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'agent.hello' || msg.type === 'agent.heartbeat') {
        if (msg.version) agentVersions.set(device.id, String(msg.version));
        if (msg.type === 'agent.heartbeat') {
          app.log.debug(`heartbeat from ${device.name}${msg.version ? ` v${msg.version}` : ''}`);
        } else {
          app.log.info(`agent hello from ${device.name} v${msg.version || '?'}`);
        }
      } else if (msg.type === 'agent.status') {
        app.log.info(`agent status from ${device.name}: ${JSON.stringify(msg)}`);
        if (msg.status) setUpdateStatus(device.id, msg.status, msg.mode, msg.progress, msg.step, msg.step_msg, msg.error);
      }
    } catch { /* ignore malformed */ }
  });

  const cleanup = () => {
    agents.delete(device.id);
    agentVersions.delete(device.id);
    setAgentPresent(device.id, false);
    app.log.info(`agent disconnected: ${device.name} (${device.id})`);
  };
  socket.on('close', cleanup);
  socket.on('error', cleanup);
});

// --- REST API ---
app.get('/api/brand', async () => BRAND);
app.get('/api/version', async () => getVersionManifest());

app.get('/api/update-check', async (req, reply) => {
  try {
    return await checkForUpdate({ force: req.query?.force === '1' || req.query?.force === 'true' });
  } catch (err) {
    return reply.code(502).send({ error: String(err.message || err) });
  }
});
app.get('/api/plugins', async () => plugins.listPlugins());
app.get('/api/devices', async () => store.listDevices().map(publicDevice));

app.post('/api/devices', async (req) => publicDevice(await store.createDevice(req.body?.name)));

app.patch('/api/devices/:id', async (req, reply) => {
  const d = await store.updateDevice(req.params.id, req.body || {});
  if (!d) return reply.code(404).send({ error: 'not found' });
  broadcast(d.id, layoutMessage(d)); // push locale change to live displays
  if ('performanceProfile' in (req.body || {})) {
    // Keep an already-connected agent's cached value current without
    // requiring it to reconnect (it only otherwise learns this on connect).
    sendToAgent(d.id, { type: 'agent.config', performanceProfile: d.performanceProfile || 'high' });
  }
  return publicDevice(d);
});

app.get('/api/devices/:id', async (req, reply) => {
  const d = store.getDevice(req.params.id);
  return d ? fullDevice(d) : reply.code(404).send({ error: 'not found' });
});

app.put('/api/devices/:id/draft', async (req, reply) => {
  const d = await store.saveDraft(req.params.id, req.body?.layout);
  return d ? { ok: true } : reply.code(404).send({ error: 'not found' });
});

app.post('/api/devices/:id/publish', async (req, reply) => {
  const d = await store.publish(req.params.id);
  if (!d) return reply.code(404).send({ error: 'not found' });
  broadcast(d.id, layoutMessage(d));
  return { ok: true, publishedAt: d.publishedAt };
});

app.delete('/api/devices/:id', async (req, reply) => {
  const id = req.params.id;
  for (const s of displays.get(id) ?? []) {
    try { s.close(1000, 'device deleted'); } catch { /* already closed */ }
  }
  displays.delete(id);
  const ok = await store.deleteDevice(id);
  return ok ? { ok: true } : reply.code(404).send({ error: 'not found' });
});

// --- Home Assistant Config & Proxy (§M5) ---
app.get('/api/settings/ha', async (req, reply) => {
  const url = store.getSetting('ha_url') || '';
  const token = store.getSetting('ha_token') || '';
  const maskedToken = token ? (token.slice(0, 6) + '...' + token.slice(-4)) : '';
  return { url, token: maskedToken, hasToken: !!token };
});

app.post('/api/settings/ha', async (req, reply) => {
  const { url, token } = req.body || {};
  if (url !== undefined) store.setSetting('ha_url', url.trim());
  if (token !== undefined && !token.includes('...')) {
    store.setSetting('ha_token', token.trim());
  } else if (token === '') {
    store.setSetting('ha_token', '');
  }
  return { ok: true };
});

app.get('/api/proxy/ha/states/:entityId', async (req, reply) => {
  const url = store.getSetting('ha_url');
  const token = store.getSetting('ha_token');
  if (!url || !token) {
    return reply.code(400).send({ error: 'Home Assistant is not configured' });
  }
  const cleanUrl = url.replace(/\/$/, '');
  const { entityId } = req.params;
  try {
    const res = await fetch(`${cleanUrl}/api/states/${entityId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) throw new Error(`HA returned ${res.status}`);
    const data = await res.json();
    return data;
  } catch (err) {
    return reply.code(502).send({ error: `Failed to fetch from HA: ${err.message}` });
  }
});

app.post('/api/proxy/ha/services/:domain/:service', async (req, reply) => {
  const url = store.getSetting('ha_url');
  const token = store.getSetting('ha_token');
  if (!url || !token) {
    return reply.code(400).send({ error: 'Home Assistant is not configured' });
  }
  const cleanUrl = url.replace(/\/$/, '');
  const { domain, service } = req.params;
  // Forwarded as-is — e.g. paneo.homeassistant's weather forecast card needs
  // `?return_response` on weather/get_forecasts (HA's response-returning
  // services convention); nothing else currently uses query params here, but
  // there's no reason to hardcode just that one case into a generic proxy.
  const qs = new URLSearchParams(req.query || {}).toString();
  try {
    const res = await fetch(`${cleanUrl}/api/services/${domain}/${service}${qs ? `?${qs}` : ''}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body || {})
    });
    if (!res.ok) throw new Error(`HA returned ${res.status}`);
    const data = await res.json();
    return data;
  } catch (err) {
    return reply.code(502).send({ error: `Failed to call HA service: ${err.message}` });
  }
});

// --- Photo/video Frame Proxy & Local storage (§M5, extended for video) ---
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
if (!fs.existsSync(PHOTOS_DIR)) {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}
const MEDIA_EXT_RE = /\.(jpe?g|png|webp|gif|mp4|webm|mov|m4v|ogv)$/i;

app.get('/api/proxy/photos/local', async (req, reply) => {
  try {
    const files = fs.readdirSync(PHOTOS_DIR)
      .filter(f => MEDIA_EXT_RE.test(f));
    return files.map(f => `/api/proxy/photos/local/file/${encodeURIComponent(f)}`);
  } catch (err) {
    return [];
  }
});

app.get('/api/proxy/photos/local/file/:filename', async (req, reply) => {
  const { filename } = req.params;
  const safeName = path.basename(filename);
  const filePath = path.join(PHOTOS_DIR, safeName);
  if (!fs.existsSync(filePath)) {
    return reply.code(404).send({ error: 'File not found' });
  }
  return reply.sendFile(`photos/${safeName}`, DATA_DIR);
});

// Editor-side upload for the photo/media widget's "local" source — multiple files
// under the `files` field. path.basename() on every filename (both here and in the
// GET/DELETE routes above/below) keeps a crafted "../../etc/passwd"-style name from
// ever escaping PHOTOS_DIR.
app.post('/api/proxy/photos/local/upload', async (req, reply) => {
  const saved = [];
  const skipped = [];
  for await (const part of req.files()) {
    const safeName = path.basename(part.filename || '');
    if (!safeName || !MEDIA_EXT_RE.test(safeName)) {
      skipped.push(part.filename);
      part.file.resume(); // drain the stream so req.files() can move to the next part
      continue;
    }
    let targetName = safeName;
    let n = 1;
    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext);
    while (fs.existsSync(path.join(PHOTOS_DIR, targetName))) {
      targetName = `${base}-${n++}${ext}`;
    }
    await pipeline(part.file, fs.createWriteStream(path.join(PHOTOS_DIR, targetName)));
    saved.push(targetName);
  }
  if (!saved.length) {
    return reply.code(400).send({ error: 'No valid image/video files uploaded', skipped });
  }
  return { ok: true, saved, skipped };
});

app.delete('/api/proxy/photos/local/file/:filename', async (req, reply) => {
  const safeName = path.basename(req.params.filename);
  // Same MEDIA_EXT_RE gate as GET (list) and POST (upload), so this route can't
  // be used to remove an arbitrary non-media file that happens to sit in PHOTOS_DIR.
  if (!MEDIA_EXT_RE.test(safeName)) {
    return reply.code(400).send({ error: 'Not a managed media file' });
  }
  const filePath = path.join(PHOTOS_DIR, safeName);
  if (!fs.existsSync(filePath)) {
    return reply.code(404).send({ error: 'File not found' });
  }
  fs.unlinkSync(filePath);
  return { ok: true };
});

app.get('/api/proxy/photos/unsplash', async (req, reply) => {
  const { keyword } = req.query || {};
  const kw = keyword ? encodeURIComponent(keyword) : 'nature';
  const target = `https://loremflickr.com/1920/1080/${kw}`;
  return reply.redirect(target);
});

app.get('/api/proxy/photos/immich', async (req, reply) => {
  const { url, apiKey, albumId } = req.query || {};
  if (!url || !apiKey) {
    return reply.code(400).send({ error: 'Immich url and apiKey are required' });
  }
  const cleanUrl = url.replace(/\/$/, '');
  try {
    const targetUrl = albumId 
      ? `${cleanUrl}/api/albums/${albumId}`
      : `${cleanUrl}/api/assets`;
    const headers = { 'x-api-key': apiKey };
    const res = await fetch(targetUrl, { headers });
    if (!res.ok) throw new Error(`Immich returned ${res.status}`);
    const data = await res.json();
    const assets = albumId ? (data.assets || []) : (Array.isArray(data) ? data : []);
    const list = assets
      .filter(a => a.type === 'IMAGE')
      .map(a => `/api/proxy/photos/immich/file?url=${encodeURIComponent(cleanUrl)}&apiKey=${encodeURIComponent(apiKey)}&id=${a.id}`);
    return list;
  } catch (err) {
    return reply.code(502).send({ error: `Immich fetch failed: ${err.message}` });
  }
});

app.get('/api/proxy/photos/immich/file', async (req, reply) => {
  const { url, apiKey, id } = req.query || {};
  if (!url || !apiKey || !id) {
    return reply.code(400).send({ error: 'Missing parameters' });
  }
  try {
    const res = await fetch(`${url}/api/assets/${id}/thumbnail?size=large`, {
      headers: { 'x-api-key': apiKey }
    });
    if (!res.ok) throw new Error(`Immich file fetch returned ${res.status}`);
    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    reply.type(contentType);
    return Buffer.from(buffer);
  } catch (err) {
    return reply.code(502).send({ error: `Immich file fetch failed: ${err.message}` });
  }
});



// --- groups (§M2 D7: bulk-copy layout apply, not a live shared reference) ---
app.get('/api/groups', async () => store.listGroups());
app.post('/api/groups', async (req) => store.createGroup(req.body?.name));

app.post('/api/devices/:id/apply-to-group', async (req, reply) => {
  const appliedIds = await store.applyLayoutToGroup(req.params.id);
  for (const id of appliedIds) {
    const d = store.getDevice(id);
    if (d) broadcast(id, layoutMessage(d));
  }
  return { ok: true, applied: appliedIds.length };
});

// --- remote commands (§M2): reload / identify | §M4: power ---
app.post('/api/devices/:id/command', async (req, reply) => {
  const { action, on, mode } = req.body || {};
  if (!['reload', 'identify', 'power', 'update', 'restart-kiosk'].includes(action)) return reply.code(400).send({ error: 'invalid action' });
  // Accepts either the internal device id (browser/editor, session-gated
  // above) or the pairing token (§D69/§D70 — self-authorizing, see the
  // onRequest hook above).
  const d = store.getDevice(req.params.id) || store.getDeviceByToken(req.params.id);
  if (!d) return reply.code(404).send({ error: 'not found' });
  if (action === 'power') {
    // Power commands are routed to the companion agent, not the display browser
    const hasAgent = agents.has(d.id);
    sendToAgent(d.id, { type: 'command', action: 'power', on: Boolean(on) });
    return { ok: true, agentPresent: hasAgent };
  }
  if (action === 'restart-kiosk') {
    // Also agent-routed: killing/relaunching the Chromium process is OS-level,
    // the display browser page itself can't do it (unlike 'reload').
    const hasAgent = agents.has(d.id);
    sendToAgent(d.id, { type: 'command', action: 'restart-kiosk' });
    return { ok: true, agentPresent: hasAgent };
  }
  if (action === 'update') {
    // Also agent-routed (docs/design.md D#) — runs scripts/update-pi.sh on the
    // Pi via a narrowly sudo-whitelisted script, not the display browser.
    const hasAgent = agents.has(d.id);
    const updateMode = mode === 'server' ? 'server' : 'all';
    if (hasAgent) {
      // Optimistic — set before the agent's own ack arrives, which may be
      // racing its own restart partway through the update and never arrive
      // for this specific command at all.
      setUpdateStatus(d.id, 'running', updateMode, 0, 'starting', 'Starting update');
      sendToAgent(d.id, { type: 'command', action: 'update', mode: updateMode });
    }
    return { ok: true, agentPresent: hasAgent };
  }
  broadcast(d.id, { type: 'command', action, deviceName: d.name });
  return { ok: true };
});

function resolveDevice(idOrToken) {
  return store.getDevice(idOrToken) || store.getDeviceByToken(idOrToken);
}

// --- display notifications: ephemeral toasts pushed over WebSocket ---
app.post('/api/devices/:id/notify', async (req, reply) => {
  const d = resolveDevice(req.params.id);
  if (!d) return reply.code(404).send({ error: 'not found' });
  const parsed = parseNotifyBody(req.body);
  if (parsed.error) return reply.code(400).send({ error: parsed.error });
  broadcast(d.id, buildNotifyMessage(parsed));
  return { ok: true };
});

app.post('/api/devices/:id/notify-group', async (req, reply) => {
  const d = resolveDevice(req.params.id);
  if (!d) return reply.code(404).send({ error: 'not found' });
  if (!d.groupId) return reply.code(400).send({ error: 'device has no group' });
  const parsed = parseNotifyBody(req.body);
  if (parsed.error) return reply.code(400).send({ error: parsed.error });
  const targets = store.listDevicesByGroupId(d.groupId);
  const msg = buildNotifyMessage(parsed);
  for (const dev of targets) broadcast(dev.id, msg);
  return { ok: true, notified: targets.length };
});

app.get('/api/devices/:id/update-status', async (req, reply) => {
  // Accepts either the internal id (browser/editor) or the pairing token
  // (§D69/§D70/§D72 — self-authorizing, see the onRequest hook above), same
  // as /command, so automation can poll whether a command it sent actually
  // finished without needing a session either.
  const d = store.getDevice(req.params.id) || store.getDeviceByToken(req.params.id);
  if (!d) return reply.code(404).send({ error: 'not found' });
  return getUpdateStatus(d.id);
});

// --- pages ---
app.get('/', async (_req, reply) => reply.redirect('/editor/'));
app.get('/d/:token', async (_req, reply) => reply.sendFile('display/index.html'));
app.get('/agent/install.sh', async (_req, reply) => {
  reply.type('text/x-shellscript; charset=utf-8');
  return reply.sendFile('install.sh', AGENT_DIR);
});
app.get('/agent/agent.js', async (_req, reply) => {
  reply.type('application/javascript; charset=utf-8');
  return reply.sendFile('agent.js', AGENT_DIR);
});
app.get('/agent/version.json', async (_req, reply) => {
  reply.type('application/json; charset=utf-8');
  return reply.sendFile('version.json', AGENT_DIR);
});
app.get('/install.sh', async (_req, reply) => {
  reply.type('text/x-shellscript; charset=utf-8');
  return reply.sendFile('install.sh', ROOT);
});
app.get('/install/pi.sh', async (_req, reply) => {
  reply.type('text/x-shellscript; charset=utf-8');
  return reply.sendFile('install-pi.sh', SCRIPTS_DIR);
});
app.get('/update.sh', async (_req, reply) => {
  reply.type('text/x-shellscript; charset=utf-8');
  return reply.sendFile('update-pi.sh', SCRIPTS_DIR);
});
app.get('/diagnose.sh', async (_req, reply) => {
  reply.type('text/x-shellscript; charset=utf-8');
  return reply.sendFile('diagnose-pi.sh', SCRIPTS_DIR);
});

app.listen({ port: PORT, host: '0.0.0.0' })
  .then(() => {
    app.log.info(
      `${BRAND.name} ${COMPONENTS.server.id} v${COMPONENTS.server.version} → editor http://localhost:${PORT}/  ·  display http://localhost:${PORT}/d/<token>`,
    );
    // §M4 Power-schedule cron: check every minute, fire commands to connected agents.
    // Pure setInterval + Date parsing — zero extra dependencies.
    startScheduler();
  })
  .catch((err) => { app.log.error(err); process.exit(1); });

// §M4: server-side power schedule runner (docs/design.md §9, D11).
// Runs every 60 s. For each device with a powerSchedule and a connected agent,
// checks if the current local HH:MM matches an on or off time and sends the command.
function startScheduler() {
  setInterval(() => {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    for (const d of store.listDevices()) {
      if (!d.powerSchedule || !agents.has(d.id)) continue;
      const schedules = Array.isArray(d.powerSchedule) ? d.powerSchedule : [d.powerSchedule];
      for (const s of schedules) {
        if (s.on && s.on === hhmm) {
          app.log.info(`schedule: power ON → ${d.name}`);
          sendToAgent(d.id, { type: 'command', action: 'power', on: true });
        }
        if (s.off && s.off === hhmm) {
          app.log.info(`schedule: power OFF → ${d.name}`);
          sendToAgent(d.id, { type: 'command', action: 'power', on: false });
        }
      }
    }
  }, 60_000);
}
