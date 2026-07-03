import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PANEO_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'paneo-test-'));

const store = await import('../src/store.js');
await store.load();

test('load seeds at least one device in an empty database', () => {
  const devices = store.listDevices();
  assert.ok(devices.length >= 1);
  assert.ok(devices[0].token);
  assert.ok(devices[0].draft);
  assert.ok(devices[0].published);
});

test('createDevice persists a new display', async () => {
  const device = await store.createDevice('Test Display');
  assert.equal(device.name, 'Test Display');
  assert.ok(device.token);
  assert.equal(store.getDevice(device.id)?.name, 'Test Display');
});

test('publish copies draft layout to published', async () => {
  const device = await store.createDevice('Publish Test');
  const layout = {
    ...device.draft,
    widgets: [{
      id: 'w1',
      type: 'paneo.text',
      x: 0,
      y: 0,
      w: 2,
      h: 2,
      config: { text: 'hello' },
    }],
  };
  await store.saveDraft(device.id, layout);
  const published = await store.publish(device.id);
  assert.equal(published.published.widgets.length, 1);
  assert.equal(published.published.widgets[0].config.text, 'hello');
  assert.ok(published.publishedAt);
});

test('group layout apply copies published layout to siblings', async () => {
  const group = await store.createGroup('Living');
  const source = await store.createDevice('Source');
  const sibling = await store.createDevice('Sibling');
  await store.updateDevice(source.id, { groupId: group.id });
  await store.updateDevice(sibling.id, { groupId: group.id });

  const layout = {
    ...source.draft,
    widgets: [{ id: 'w2', type: 'paneo.date', x: 1, y: 1, w: 3, h: 2, config: {} }],
  };
  await store.saveDraft(source.id, layout);
  await store.publish(source.id);

  const applied = await store.applyLayoutToGroup(source.id);
  assert.deepEqual(applied, [sibling.id]);
  assert.equal(store.getDevice(sibling.id).published.widgets.length, 1);
});

test('settings helpers round-trip values', () => {
  store.setSetting('ha_url', 'http://192.168.0.10:8123');
  assert.equal(store.getSetting('ha_url'), 'http://192.168.0.10:8123');
});
