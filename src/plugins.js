// Third-party widget plugin registry (docs/design.md §7, D17).
//
// A plugin is a directory under PANEO_DATA_DIR/plugins/<id>/ containing a
// manifest.json. Two plugin types, matching the staged-opening principle
// already established for paneo.iframe (§7.3/D14 — never allow arbitrary
// remote code without either admin-filesystem trust or a sandbox):
//
//   "module" — local, filesystem-installed. manifest.json + <entry>.js (an ES
//              module exporting `render(el, config, ctx)`, same contract as
//              every in-tree widget in public/shared/widgets.js). Getting a
//              file onto the server's disk is itself an admin trust action
//              (same trust level as the server's own code), so this runs
//              un-sandboxed in the editor/display page — same as in-tree.
//   "iframe" — remote. manifest.json only, points at an external `url`.
//              Rendered inside the same sandboxed <iframe> machinery as
//              paneo.iframe. No filesystem access needed, so this is the
//              path for "install by pasting a URL" without touching the host.
//
// This module only does filesystem discovery + validation; public/shared/widgets.js
// does the actual dynamic import / iframe rendering on the client.
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.PANEO_DATA_DIR || path.join(process.cwd(), 'data');
const PLUGINS_DIR = path.join(DATA_DIR, 'plugins');
mkdirSync(PLUGINS_DIR, { recursive: true });

const REQUIRED_FIELDS = ['id', 'version', 'type', 'defaultSize'];

let registry = [];

function validate(manifest, dir) {
  for (const f of REQUIRED_FIELDS) {
    if (!manifest[f]) throw new Error(`plugin "${dir}": manifest missing required field "${f}"`);
  }
  if (!['module', 'iframe'].includes(manifest.type)) {
    throw new Error(`plugin "${dir}": type must be "module" or "iframe", got "${manifest.type}"`);
  }
  if (manifest.type === 'module' && !manifest.entry) {
    throw new Error(`plugin "${dir}": type "module" requires an "entry" field (e.g. "widget.js")`);
  }
  if (manifest.type === 'iframe' && !manifest.url) {
    throw new Error(`plugin "${dir}": type "iframe" requires a "url" field`);
  }
  if (manifest.id !== dir) {
    throw new Error(`plugin "${dir}": manifest id "${manifest.id}" must match its directory name`);
  }
}

// Re-scans PLUGINS_DIR from disk. Called once at server startup — plugins are
// filesystem-installed (like the companion agent), not hot-reloaded at runtime.
export function scan() {
  const found = [];
  let dirs = [];
  try {
    dirs = readdirSync(PLUGINS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    registry = [];
    return registry;
  }
  for (const d of dirs) {
    const manifestPath = path.join(PLUGINS_DIR, d.name, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      validate(manifest, d.name);
      found.push(manifest);
    } catch (err) {
      console.error(`[plugins] skipping "${d.name}": ${err.message}`);
    }
  }
  registry = found;
  return registry;
}

// Manifests as served to the client — filesystem paths are never exposed,
// only the plugin id (client derives /plugins/<id>/<entry> itself).
export function listPlugins() {
  return registry;
}

export function pluginsDir() {
  return PLUGINS_DIR;
}
