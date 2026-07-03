import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const dataDir = mkdtempSync(path.join(tmpdir(), 'paneo-plugins-test-'));
process.env.PANEO_DATA_DIR = dataDir;
const pluginsRoot = path.join(dataDir, 'plugins');

function writePlugin(dirName, manifest, files = {}) {
  const dir = path.join(pluginsRoot, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content);
}

writePlugin('hello-module', {
  id: 'hello-module', version: '1.0.0', type: 'module', entry: 'widget.js',
  defaultSize: { w: 3, h: 2 },
}, { 'widget.js': 'export function render(el) { el.textContent = "hi"; }' });

writePlugin('hello-iframe', {
  id: 'hello-iframe', version: '1.0.0', type: 'iframe', url: 'https://example.com/widget',
  defaultSize: { w: 3, h: 2 },
});

// invalid: missing required "defaultSize" — should be skipped, not throw
writePlugin('broken', { id: 'broken', version: '1.0.0', type: 'module', entry: 'w.js' });

// invalid: manifest id doesn't match its own directory name — should be skipped
writePlugin('mismatched-dir', {
  id: 'someone-else', version: '1.0.0', type: 'module', entry: 'w.js', defaultSize: { w: 1, h: 1 },
});

// invalid: unknown type — should be skipped
writePlugin('bad-type', { id: 'bad-type', version: '1.0.0', type: 'remote', defaultSize: { w: 1, h: 1 } });

const plugins = await import('../src/plugins.js');

test('scan discovers valid plugins and skips invalid ones', () => {
  const found = plugins.scan();
  const ids = found.map((m) => m.id).sort();
  assert.deepEqual(ids, ['hello-iframe', 'hello-module']);
});

test('listPlugins reflects the manifest fields verbatim', () => {
  const list = plugins.listPlugins();
  const mod = list.find((m) => m.id === 'hello-module');
  assert.equal(mod.type, 'module');
  assert.equal(mod.entry, 'widget.js');
  const iframe = list.find((m) => m.id === 'hello-iframe');
  assert.equal(iframe.type, 'iframe');
  assert.equal(iframe.url, 'https://example.com/widget');
});

test('scan silently ignores a directory with no manifest.json', () => {
  mkdirSync(path.join(pluginsRoot, 'no-manifest'), { recursive: true });
  const found = plugins.scan();
  assert.ok(!found.some((m) => m.id === 'no-manifest'));
  assert.deepEqual(found.map((m) => m.id).sort(), ['hello-iframe', 'hello-module']);
});
