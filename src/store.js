// Persistence via Node's built-in node:sqlite — no native compile step, ships with Node itself
// (fits the self-host/single-container principle, docs/design.md §10). Swapped in for the M0
// JSON file; exported function signatures are unchanged so server.js didn't need edits.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.PANEO_DATA_DIR || path.join(process.cwd(), 'data');
mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'paneo.sqlite');
const LEGACY_JSON = path.join(DATA_DIR, 'store.json');

const db = new DatabaseSync(DB_FILE);
db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    performanceProfile TEXT NOT NULL DEFAULT 'high',
    locale TEXT NOT NULL DEFAULT 'ko-KR',
    timezone TEXT,
    draft TEXT NOT NULL,
    published TEXT NOT NULL,
    publishedAt TEXT
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

// CREATE TABLE IF NOT EXISTS doesn't add columns to an already-created table —
// migrate existing DBs (from before these fields existed) by adding them if
// missing. Resolution is manually set for now (§ "A"); a future auto-detect
// ("B") would report the display's real viewport over WS and overwrite these
// same two columns — no schema change needed for that later.
const existingColumns = new Set(db.prepare('PRAGMA table_info(devices)').all().map((c) => c.name));
if (!existingColumns.has('resolutionW')) db.exec('ALTER TABLE devices ADD COLUMN resolutionW INTEGER NOT NULL DEFAULT 1920');
if (!existingColumns.has('resolutionH')) db.exec('ALTER TABLE devices ADD COLUMN resolutionH INTEGER NOT NULL DEFAULT 1080');
if (!existingColumns.has('groupId')) db.exec('ALTER TABLE devices ADD COLUMN groupId TEXT');
// M4: companion-agent fields (docs/design.md §4.1 D, §9)
if (!existingColumns.has('powerSchedule')) db.exec('ALTER TABLE devices ADD COLUMN powerSchedule TEXT');
if (!existingColumns.has('agentPresent')) db.exec('ALTER TABLE devices ADD COLUMN agentPresent INTEGER NOT NULL DEFAULT 0');

function defaultLayout() {
  // Multi-page shape (editor.js's `layout.pages[]`) — each page carries its own
  // grid/background/widgets. New devices are seeded directly in this shape so the
  // editor never has to migrate a fresh device's layout; only pre-existing devices
  // saved before multi-page support ever hit editor.js's migrateToPages() fallback.
  return {
    pages: [{
      id: 'page-0',
      widgets: [],
      // rows is a *minimum* — grows automatically to fit content (public/shared/gridlayout.js)
      grid: { cols: 12, rows: 7, gap: 8 },
      background: '#0b0f19',
    }],
    currentPageIndex: 0,
  };
}

function rowToDevice(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    token: row.token,
    performanceProfile: row.performanceProfile,
    locale: row.locale,
    timezone: row.timezone,
    resolutionW: row.resolutionW,
    resolutionH: row.resolutionH,
    groupId: row.groupId,
    powerSchedule: row.powerSchedule ? JSON.parse(row.powerSchedule) : null, // §M4 §9
    agentPresent: Boolean(row.agentPresent),                                  // §M4 companion-agent
    draft: JSON.parse(row.draft),
    published: JSON.parse(row.published),
    publishedAt: row.publishedAt,
  };
}

function rowToGroup(row) {
  return row ? { id: row.id, name: row.name } : null;
}

const stmt = {
  all: db.prepare('SELECT * FROM devices'),
  byId: db.prepare('SELECT * FROM devices WHERE id = ?'),
  byToken: db.prepare('SELECT * FROM devices WHERE token = ?'),
  byGroup: db.prepare('SELECT * FROM devices WHERE groupId = ?'),
  count: db.prepare('SELECT COUNT(*) AS c FROM devices'),
  insert: db.prepare(`INSERT INTO devices (id, name, token, performanceProfile, locale, timezone, resolutionW, resolutionH, groupId, powerSchedule, agentPresent, draft, published, publishedAt)
    VALUES (@id, @name, @token, @performanceProfile, @locale, @timezone, @resolutionW, @resolutionH, @groupId, @powerSchedule, @agentPresent, @draft, @published, @publishedAt)`),
  deleteDevice: db.prepare('DELETE FROM devices WHERE id = ?'),
  groupsAll: db.prepare('SELECT * FROM groups'),
  groupInsert: db.prepare('INSERT INTO groups (id, name) VALUES (@id, @name)'),
  updateDraft: db.prepare('UPDATE devices SET draft = ? WHERE id = ?'),
  updatePublish: db.prepare('UPDATE devices SET published = ?, publishedAt = ? WHERE id = ?'),
  updateFields: db.prepare(`UPDATE devices SET name = @name, performanceProfile = @performanceProfile,
    locale = @locale, timezone = @timezone, resolutionW = @resolutionW, resolutionH = @resolutionH,
    groupId = @groupId, powerSchedule = @powerSchedule WHERE id = @id`),
  updateAgentPresent: db.prepare('UPDATE devices SET agentPresent = ? WHERE id = ?'),
  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
};

function newDeviceRow(name) {
  const layout = JSON.stringify(defaultLayout());
  return {
    id: randomUUID(),
    name,
    token: randomUUID().slice(0, 8),
    performanceProfile: 'high', // §4.3 — high | low | auto
    locale: 'ko-KR', // §4.4 — display locale (date/time/number formatting)
    timezone: null, // null → display uses its own local timezone
    resolutionW: 1920, // manual for now ("A") — a future auto-detect ("B") would
    resolutionH: 1080, // overwrite these from the display's real reported viewport
    groupId: null, // §M2 — group-based bulk layout apply, not a live-shared layout reference
    powerSchedule: null, // §M4 §9 — daily on/off schedule: [{on:"07:00",off:"23:00"}]
    agentPresent: 0,     // §M4 — 0=absent 1=connected (runtime only, reset on server start)
    draft: layout,
    published: layout,
    publishedAt: null,
  };
}

// One-time migration from the M0 JSON file, if present, so the seeded device carries over.
function migrateLegacyJson() {
  if (!existsSync(LEGACY_JSON)) return;
  try {
    const legacy = JSON.parse(readFileSync(LEGACY_JSON, 'utf8'));
    for (const d of legacy.devices || []) {
      stmt.insert.run({
        id: d.id,
        name: d.name,
        token: d.token,
        performanceProfile: d.performanceProfile || 'high',
        locale: d.locale || 'ko-KR',
        timezone: d.timezone ?? null,
        resolutionW: d.resolutionW || 1920,
        resolutionH: d.resolutionH || 1080,
        groupId: d.groupId ?? null,
        draft: JSON.stringify(d.draft || defaultLayout()),
        published: JSON.stringify(d.published || defaultLayout()),
        publishedAt: d.publishedAt ?? null,
      });
    }
  } finally {
    renameSync(LEGACY_JSON, `${LEGACY_JSON}.migrated`);
  }
}

export async function load() {
  if (stmt.count.get().c === 0) {
    migrateLegacyJson();
  }
  // No longer auto-seeds a placeholder device on an empty DB (previously a
  // hardcoded "거실"/"Raspberry Pi" row) — a device row is meant to represent
  // an actual registered display, created either by the editor's own "+"
  // button or by scripts/install-pi.sh's create_token_if_needed() when a
  // real Pi installs itself, not invented by the server ahead of either of
  // those. A brand-new server with zero devices is the correct, unsurprising
  // starting state.
  // agentPresent reflects a live WS connection (§M4) — a prior process's agents
  // aren't connected to *this* process yet, so a value left over from before a
  // crash/restart would lie until the agent's own reconnect loop catches up.
  db.exec('UPDATE devices SET agentPresent = 0');
}

export function listDevices() {
  return stmt.all.all().map(rowToDevice);
}

export function listDevicesByGroupId(groupId) {
  if (!groupId) return [];
  return stmt.byGroup.all(groupId).map(rowToDevice);
}

export function getDevice(id) {
  return rowToDevice(stmt.byId.get(id));
}

export function getDeviceByToken(token) {
  return rowToDevice(stmt.byToken.get(token));
}

export async function createDevice(name) {
  const row = newDeviceRow(name || '새 화면');
  stmt.insert.run(row);
  return getDevice(row.id);
}

export async function updateDevice(id, patch) {
  const d = getDevice(id);
  if (!d) return null;
  // powerSchedule: accept null (disable), or an object/array from the patch
  let ps = d.powerSchedule;
  if ('powerSchedule' in patch) ps = patch.powerSchedule ?? null;
  stmt.updateFields.run({
    id,
    name: patch.name ?? d.name,
    performanceProfile: patch.performanceProfile ?? d.performanceProfile,
    locale: patch.locale ?? d.locale,
    timezone: patch.timezone !== undefined ? patch.timezone : d.timezone,
    resolutionW: patch.resolutionW ?? d.resolutionW,
    resolutionH: patch.resolutionH ?? d.resolutionH,
    groupId: patch.groupId !== undefined ? patch.groupId : d.groupId,
    powerSchedule: ps !== null ? JSON.stringify(ps) : null,
  });
  return getDevice(id);
}

// §M4: called by the /ws/agent handler when an agent connects/disconnects.
// agentPresent is runtime-only: reset to 0 on server start (it's in the DB
// so publicDevice() can include it, but it's always false until the agent
// re-connects after a server restart).
export function setAgentPresent(id, present) {
  stmt.updateAgentPresent.run(present ? 1 : 0, id);
}

export async function deleteDevice(id) {
  const info = stmt.deleteDevice.run(id);
  return info.changes > 0;
}

export function listGroups() {
  return stmt.groupsAll.all().map(rowToGroup);
}

export async function createGroup(name) {
  const row = { id: randomUUID(), name: name || '새 그룹' };
  stmt.groupInsert.run(row);
  return rowToGroup(row);
}

// Bulk-copy (not a live shared reference, docs/design.md D7): the source device's
// published layout is copied into every *other* device sharing its groupId.
export async function applyLayoutToGroup(sourceId) {
  const source = getDevice(sourceId);
  if (!source?.groupId) return [];
  const siblings = stmt.byGroup.all(source.groupId).map(rowToDevice).filter((d) => d.id !== sourceId);
  const layoutJson = JSON.stringify(source.published);
  const publishedAt = new Date().toISOString();
  for (const d of siblings) {
    stmt.updateDraft.run(layoutJson, d.id);
    stmt.updatePublish.run(layoutJson, publishedAt, d.id);
  }
  return siblings.map((d) => d.id);
}

export async function saveDraft(id, layout) {
  const info = stmt.updateDraft.run(JSON.stringify(layout), id);
  return info.changes ? getDevice(id) : null;
}

// Draft/Publish model (docs/design.md §6): copy draft -> published on "적용".
export async function publish(id) {
  const d = getDevice(id);
  if (!d) return null;
  const publishedAt = new Date().toISOString();
  stmt.updatePublish.run(JSON.stringify(d.draft), publishedAt, id);
  return getDevice(id);
}

function findWidgetInLayout(layout, widgetId) {
  if (!layout) return null;
  const all = layout.pages?.length ? layout.pages.flatMap((p) => p.widgets || []) : (layout.widgets || []);
  return all.find((w) => w.id === widgetId) || null;
}

// paneo.todo runtime edits from the display (docs/design.md D27/D28): these are
// runtime interactions, not design-time edits, so they write straight to
// `published` (what displays render) and never touch `draft` — they can't
// collide with someone mid-edit in the inspector, and a later "적용" naturally
// overwrites them like any other unpublished draft change would.
function mutateTodoItems(token, widgetId, mutate) {
  const device = getDeviceByToken(token);
  if (!device) return null;
  const w = findWidgetInLayout(device.published, widgetId);
  if (!w || w.type !== 'paneo.todo') return null;
  if (!Array.isArray(w.config?.todoItems)) w.config = { ...w.config, todoItems: [] };
  if (!mutate(w.config.todoItems)) return null;
  stmt.updatePublish.run(JSON.stringify(device.published), device.publishedAt, device.id);
  return device;
}

export function toggleTodoItem(token, widgetId, index) {
  return mutateTodoItems(token, widgetId, (items) => {
    const item = items[index];
    if (!item) return false;
    item.done = !item.done;
    return true;
  });
}

export function addTodoItem(token, widgetId, text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  return mutateTodoItems(token, widgetId, (items) => {
    items.push({ done: false, text: trimmed });
    return true;
  });
}

export function deleteTodoItem(token, widgetId, index) {
  return mutateTodoItems(token, widgetId, (items) => {
    if (index < 0 || index >= items.length) return false;
    items.splice(index, 1);
    return true;
  });
}

// §M5 settings store helpers
export function getSetting(key) {
  const row = stmt.getSetting.get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  stmt.setSetting.run(key, value === null || value === undefined ? null : String(value));
}

