import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { COMPONENTS, getVersionManifest, formatComponentVersion, compareVersions, checkForUpdate } from '../src/version.js';

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

test('compareVersions compares numeric x.y.z parts, ignoring differing lengths', () => {
  assert.ok(compareVersions('0.0.6', '0.0.5') > 0);
  assert.ok(compareVersions('0.0.5', '0.0.6') < 0);
  assert.equal(compareVersions('0.0.6', '0.0.6'), 0);
  assert.ok(compareVersions('0.1.0', '0.0.9') > 0);
  assert.ok(compareVersions('1.0', '0.9.9') > 0);
});

test('checkForUpdate flags updateAvailable when the latest GitHub release is newer', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ tag_name: 'v99.0.0' }), { status: 200 });
  try {
    const result = await checkForUpdate();
    assert.equal(result.latest, '99.0.0');
    assert.equal(result.updateAvailable, true);
  } finally {
    globalThis.fetch = origFetch;
  }
});
