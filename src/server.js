import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND } from './brand.js';
import * as store from './store.js';
import { registerDataProxy } from './dataproxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 4321);

const app = Fastify({ logger: { level: 'info', transport: undefined } });

await app.register(fastifyWebsocket);
await app.register(fastifyStatic, { root: PUBLIC, prefix: '/' });
await registerDataProxy(app);
await store.load();

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

const publicDevice = (d) => ({ id: d.id, name: d.name, token: d.token, performanceProfile: d.performanceProfile, locale: d.locale, timezone: d.timezone, resolutionW: d.resolutionW, resolutionH: d.resolutionH, displays: displayCount(d.id) });
const fullDevice = (d) => ({ ...publicDevice(d), draft: d.draft, published: d.published, publishedAt: d.publishedAt });
const layoutMessage = (d) => ({ type: 'layout.set', layout: d.published, locale: d.locale, timezone: d.timezone });

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

// --- REST API ---
app.get('/api/brand', async () => BRAND);
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

// --- pages ---
app.get('/', async (_req, reply) => reply.redirect('/editor/'));
app.get('/d/:token', async (_req, reply) => reply.sendFile('display/index.html'));

app.listen({ port: PORT, host: '0.0.0.0' })
  .then(() => app.log.info(`${BRAND.name} → editor http://localhost:${PORT}/  ·  display http://localhost:${PORT}/d/<token>`))
  .catch((err) => { app.log.error(err); process.exit(1); });
