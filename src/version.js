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
