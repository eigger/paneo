// Persistence via Node's built-in node:sqlite — no native compile step, ships with Node itself
// (fits the self-host/single-container principle, docs/design.md §10). Swapped in for the M0
// JSON file; exported function signatures are unchanged so server.js didn't need edits.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
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

// CREATE TABLE IF NOT EXISTS doesn't add columns to an already-created table —
// migrate existing DBs (from before the resolution field existed) by adding
// them if missing. Resolution is manually set for now (§ "A"); a future
// auto-detect ("B") would report the display's real viewport over WS and
// overwrite these same two columns — no schema change needed for that later.
const existingColumns = new Set(db.prepare('PRAGMA table_info(devices)').all().map((c) => c.name));
if (!existingColumns.has('resolutionW')) db.exec('ALTER TABLE devices ADD COLUMN resolutionW INTEGER NOT NULL DEFAULT 1920');
if (!existingColumns.has('resolutionH')) db.exec('ALTER TABLE devices ADD COLUMN resolutionH INTEGER NOT NULL DEFAULT 1080');

function defaultLayout() {
  // rows is a *minimum* — grows automatically to fit content (public/shared/gridlayout.js)
  return { grid: { cols: 12, rows: 7, gap: 8 }, background: '#0b0f19', widgets: [] };
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
    draft: JSON.parse(row.draft),
    published: JSON.parse(row.published),
    publishedAt: row.publishedAt,
  };
}

const stmt = {
  all: db.prepare('SELECT * FROM devices'),
  byId: db.prepare('SELECT * FROM devices WHERE id = ?'),
  byToken: db.prepare('SELECT * FROM devices WHERE token = ?'),
  count: db.prepare('SELECT COUNT(*) AS c FROM devices'),
  insert: db.prepare(`INSERT INTO devices (id, name, token, performanceProfile, locale, timezone, resolutionW, resolutionH, draft, published, publishedAt)
    VALUES (@id, @name, @token, @performanceProfile, @locale, @timezone, @resolutionW, @resolutionH, @draft, @published, @publishedAt)`),
  updateDraft: db.prepare('UPDATE devices SET draft = ? WHERE id = ?'),
  updatePublish: db.prepare('UPDATE devices SET published = ?, publishedAt = ? WHERE id = ?'),
  updateFields: db.prepare(`UPDATE devices SET name = @name, performanceProfile = @performanceProfile,
    locale = @locale, timezone = @timezone, resolutionW = @resolutionW, resolutionH = @resolutionH WHERE id = @id`),
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
  if (stmt.count.get().c === 0) {
    stmt.insert.run(newDeviceRow('거실'));
  }
}

export function listDevices() {
  return stmt.all.all().map(rowToDevice);
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
  stmt.updateFields.run({
    id,
    name: patch.name ?? d.name,
    performanceProfile: patch.performanceProfile ?? d.performanceProfile,
    locale: patch.locale ?? d.locale,
    timezone: patch.timezone !== undefined ? patch.timezone : d.timezone,
    resolutionW: patch.resolutionW ?? d.resolutionW,
    resolutionH: patch.resolutionH ?? d.resolutionH,
  });
  return getDevice(id);
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
