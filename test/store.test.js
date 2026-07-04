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

test('toggleTodoItem flips done on the published (not draft) layout, addressed by token', async () => {
  const device = await store.createDevice('Todo Test');
  // Pages-shaped, matching what defaultLayout()/the real editor always produces
  // (a flat top-level `widgets` array only exists as a legacy pre-migration shape).
  const layout = {
    pages: [{
      id: 'page-0',
      widgets: [{
        id: 'todo1',
        type: 'paneo.todo',
        x: 0, y: 0, w: 3, h: 3,
        config: { todoItems: [{ done: false, text: '우유 사기' }, { done: false, text: '보고서 제출' }] },
      }],
      grid: { cols: 12, rows: 7, gap: 8 },
      background: '#0b0f19',
    }],
    currentPageIndex: 0,
  };
  await store.saveDraft(device.id, layout);
  await store.publish(device.id);

  const updated = store.toggleTodoItem(device.token, 'todo1', 1);
  assert.equal(updated.published.pages[0].widgets[0].config.todoItems[1].done, true);
  assert.equal(updated.published.pages[0].widgets[0].config.todoItems[0].done, false);
  // draft is untouched — toggling is a runtime interaction, not a design edit
  assert.equal(store.getDevice(device.id).draft.pages[0].widgets[0].config.todoItems[1].done, false);

  const toggledBack = store.toggleTodoItem(device.token, 'todo1', 1);
  assert.equal(toggledBack.published.pages[0].widgets[0].config.todoItems[1].done, false);
});

test('toggleTodoItem returns null for an unknown token or widget id', async () => {
  const device = await store.createDevice('Todo Test 2');
  assert.equal(store.toggleTodoItem('not-a-real-token', 'todo1', 0), null);
  assert.equal(store.toggleTodoItem(device.token, 'no-such-widget', 0), null);
});

function makeTodoLayout(items) {
  return {
    pages: [{
      id: 'page-0',
      widgets: [{ id: 'todo1', type: 'paneo.todo', x: 0, y: 0, w: 3, h: 3, config: { todoItems: items } }],
      grid: { cols: 12, rows: 7, gap: 8 },
      background: '#0b0f19',
    }],
    currentPageIndex: 0,
  };
}

test('addTodoItem appends to published only, ignores blank text', async () => {
  const device = await store.createDevice('Todo Add Test');
  await store.saveDraft(device.id, makeTodoLayout([{ done: false, text: '우유 사기' }]));
  await store.publish(device.id);

  const updated = store.addTodoItem(device.token, 'todo1', '보고서 제출');
  const items = updated.published.pages[0].widgets[0].config.todoItems;
  assert.deepEqual(items, [{ done: false, text: '우유 사기' }, { done: false, text: '보고서 제출' }]);
  assert.equal(store.getDevice(device.id).draft.pages[0].widgets[0].config.todoItems.length, 1);

  assert.equal(store.addTodoItem(device.token, 'todo1', '   '), null);
});

test('deleteTodoItem removes by index from published only', async () => {
  const device = await store.createDevice('Todo Delete Test');
  await store.saveDraft(device.id, makeTodoLayout([
    { done: false, text: '우유 사기' },
    { done: true, text: '보고서 제출' },
  ]));
  await store.publish(device.id);

  const updated = store.deleteTodoItem(device.token, 'todo1', 0);
  const items = updated.published.pages[0].widgets[0].config.todoItems;
  assert.deepEqual(items, [{ done: true, text: '보고서 제출' }]);
  assert.equal(store.getDevice(device.id).draft.pages[0].widgets[0].config.todoItems.length, 2);

  assert.equal(store.deleteTodoItem(device.token, 'todo1', 99), null);
});
