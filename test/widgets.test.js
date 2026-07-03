import { test } from 'node:test';
import assert from 'node:assert/strict';
import { widgets, widgetLabel, fieldLabel, CATEGORY_ORDER } from '../public/shared/widgets.js';

const EXPECTED_WIDGETS = [
  'paneo.clock',
  'paneo.date',
  'paneo.text',
  'paneo.photo',
  'paneo.weather',
  'paneo.calendar',
  'paneo.calendar.month',
  'paneo.rss',
  'paneo.iframe',
  'paneo.timer',
  'paneo.homeassistant',
];

test('widget registry contains all built-in widgets', () => {
  for (const id of EXPECTED_WIDGETS) {
    assert.ok(widgets[id], `missing widget: ${id}`);
    assert.equal(typeof widgets[id].render, 'function');
    assert.ok(widgets[id].version);
    assert.ok(widgets[id].category);
  }
  assert.equal(Object.keys(widgets).length, EXPECTED_WIDGETS.length);
});

test('widgetLabel resolves localized labels', () => {
  assert.equal(widgetLabel('paneo.clock', 'ko'), '시계');
  assert.equal(widgetLabel('paneo.clock', 'en'), 'Clock');
});

test('fieldLabel resolves localized config labels', () => {
  const field = widgets['paneo.text'].config[0];
  assert.equal(fieldLabel(field, 'ko'), '내용');
  assert.equal(fieldLabel(field, 'en'), 'Content');
});

test('category order matches palette groups', () => {
  assert.deepEqual(CATEGORY_ORDER, ['basic', 'data', 'media', 'plugin']);
  for (const id of EXPECTED_WIDGETS) {
    assert.ok(CATEGORY_ORDER.includes(widgets[id].category));
  }
});

test('iframe widget declares sandbox metadata', () => {
  const def = widgets['paneo.iframe'];
  assert.equal(def.sandbox, 'iframe');
  assert.ok(def.permissions.includes('embed:external-page'));
});
