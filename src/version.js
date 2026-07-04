// Component versions for independently deployed/runtime parts of Paneo.
// Server/editor/display share the npm package version; agent has its own
// release cadence and is installed separately on display devices.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

function readAgentVersion() {
  const file = path.join(__dirname, '../agent/version.json');
  return JSON.parse(readFileSync(file, 'utf8')).version;
}

const release = pkg.version;
const agentVersion = readAgentVersion();

export const COMPONENTS = {
  server: { id: 'paneo-server', version: release },
  editor: { id: 'paneo-editor', version: release },
  display: { id: 'paneo-display', version: release },
  agent: { id: 'paneo-agent', version: agentVersion },
};

export function getVersionManifest() {
  return {
    product: pkg.name,
    release,
    components: Object.fromEntries(
      Object.entries(COMPONENTS).map(([key, meta]) => [key, meta.version]),
    ),
  };
}

export function formatComponentVersion(key) {
  const meta = COMPONENTS[key];
  return meta ? `${meta.id} v${meta.version}` : key;
}

// Simple numeric x.y.z compare — no pre-release/build-metadata handling,
// which is all this project's own tags ever use (see git log: "Release
// vX.Y.Z"). Positive when `a` is newer than `b`.
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

// Cached in-memory (not persisted) — this is a single global value, not
// per-request/per-widget data, so a plain module-level variable is simpler
// than dataproxy.js's keyed cache map. 1 hour keeps GitHub's unauthenticated
// rate limit (60/hr per IP) safe even with the editor open on several
// devices/tabs, since they all share this one server-side cache.
let updateCheckCache = null; // { value, expires }
const UPDATE_CHECK_TTL_MS = 60 * 60_000;

export async function checkForUpdate() {
  if (updateCheckCache && updateCheckCache.expires > Date.now()) return updateCheckCache.value;

  const res = await fetch('https://api.github.com/repos/eigger/paneo/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub releases check failed: ${res.status}`);
  const data = await res.json();
  const latest = String(data.tag_name || '').replace(/^v/, '');
  const value = {
    current: release,
    latest: latest || null,
    updateAvailable: latest ? compareVersions(latest, release) > 0 : false,
  };
  updateCheckCache = { value, expires: Date.now() + UPDATE_CHECK_TTL_MS };
  return value;
}
