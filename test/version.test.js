import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { COMPONENTS, getVersionManifest, formatComponentVersion } from '../src/version.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

test('getVersionManifest exposes all runtime components', () => {
  const manifest = getVersionManifest();
  assert.equal(manifest.product, 'paneo');
  assert.equal(manifest.release, pkg.version);
  assert.equal(manifest.components.server, pkg.version);
  assert.equal(manifest.components.editor, pkg.version);
  assert.equal(manifest.components.display, pkg.version);
  assert.match(manifest.components.agent, /^\d+\.\d+\.\d+$/);
});

test('formatComponentVersion returns id and semver', () => {
  assert.equal(formatComponentVersion('server'), `paneo-server v${COMPONENTS.server.version}`);
  assert.equal(formatComponentVersion('agent'), `paneo-agent v${COMPONENTS.agent.version}`);
});
