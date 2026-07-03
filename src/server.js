import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BRAND } from './brand.js';
import { COMPONENTS, getVersionManifest } from './version.js';
import * as store from './store.js';
import { registerDataProxy } from './dataproxy.js';
import { setAgentPresent } from './store.js';
import * as plugins from './plugins.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const AGENT_DIR = path.join(__dirname, '..', 'agent');
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 4321);

const app = Fastify({ logger: { level: 'info', transport: undefined } });

await app.register(fastifyWebsocket);
await app.register(fastifyStatic, { root: PUBLIC, prefix: '/' });
// §7/D17: third-party "module" plugins are filesystem-installed (admin trust,
// same level as the server's own code) — served as plain static files so the
// client can `import()` them directly. decorateReply:false because the first
// registration above already added reply.sendFile.
await app.register(fastifyStatic, { root: plugins.pluginsDir(), prefix: '/plugins/', decorateReply: false });
await registerDataProxy(app);
await store.load();
plugins.scan();

// --- live display connections: Map<deviceId, Set<socket>> ---
const displays = new Map();
const addDisplay = (id, s) => (displays.get(id) ?? displays.set(id, new Set()).get(id)).add(s);
const removeDisplay = (id, s) => displays.get(id)?.delete(s);
const displayCount = (id) => displays.get(id)?.size ?? 0;
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
  agentPresent: d.agentPresent ?? false,
  agentVersion: agentVersions.get(d.id) ?? null,
  displays: displayCount(d.id),
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

// --- WebSocket: companion-agent clients (docs/design.md §4.1 D, §M4) ---
const agents = new Map(); // Map<deviceId, WebSocket>
const agentVersions = new Map(); // Map<deviceId, string>
function sendToAgent(id, msg) {
  const s = agents.get(id);
  if (s) try { s.send(JSON.stringify(msg)); } catch { /* dropped */ }
}
function broadcastEditors(msg) {
  // re-use the displays map to find editor WS connections is not feasible
  // (editors connect via REST+polling); instead we push device.status via
  // the display WS channel so both display and editor can receive it.
  // Editors that have an editor-WS (future feature) will piggyback here.
  // For now, the editor re-fetches on tab focus. The agent heartbeat sets
  // agentPresent in the DB so the next poll reflects it.
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
app.get('/api/plugins', async () => plugins.listPlugins());
app.get('/api/devices', async () => store.listDevices().map(publicDevice));

app.post('/api/devices', async (req) => publicDevice(await store.createDevice(req.body?.name)));

app.patch('/api/devices/:id', async (req, reply) => {
  const d = await store.updateDevice(req.params.id, req.body || {});
  if (!d) return reply.code(404).send({ error: 'not found' });
  broadcast(d.id, layoutMessage(d)); // push locale change to live displays
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
  return { ok: true, publishedAt: d.publishedAt, displays: displayCount(d.id) };
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
  try {
    const res = await fetch(`${cleanUrl}/api/services/${domain}/${service}`, {
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

// --- Photo Frame Proxy & Local storage (§M5) ---
const PHOTOS_DIR = path.join(__dirname, '..', 'data', 'photos');
if (!fs.existsSync(PHOTOS_DIR)) {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

app.get('/api/proxy/photos/local', async (req, reply) => {
  try {
    const files = fs.readdirSync(PHOTOS_DIR)
      .filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f));
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
  return reply.sendFile(`photos/${safeName}`, path.join(__dirname, '..', 'data'));
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
  const { action, on } = req.body || {};
  if (!['reload', 'identify', 'power'].includes(action)) return reply.code(400).send({ error: 'invalid action' });
  const d = store.getDevice(req.params.id);
  if (!d) return reply.code(404).send({ error: 'not found' });
  if (action === 'power') {
    // Power commands are routed to the companion agent, not the display browser
    const hasAgent = agents.has(d.id);
    sendToAgent(d.id, { type: 'command', action: 'power', on: Boolean(on) });
    return { ok: true, agentPresent: hasAgent };
  }
  broadcast(d.id, { type: 'command', action, deviceName: d.name });
  return { ok: true, displays: displayCount(d.id) };
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
