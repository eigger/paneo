import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveRows, applyGridContainer, applyGridItem } from '../public/shared/gridlayout.js';

test('effectiveRows uses configured minimum when widgets fit inside', () => {
  const layout = { grid: { cols: 12, rows: 7 }, widgets: [{ x: 0, y: 0, w: 3, h: 2 }] };
  assert.equal(effectiveRows(layout), 7);
});

test('effectiveRows grows when a widget extends past configured rows', () => {
  const layout = { grid: { cols: 12, rows: 7 }, widgets: [{ x: 0, y: 5, w: 4, h: 4 }] };
  assert.equal(effectiveRows(layout), 9);
});

test('applyGridContainer sets CSS grid tracks from layout', () => {
  const el = { style: {} };
  applyGridContainer(el, { grid: { cols: 8, rows: 5, gap: 12 }, widgets: [] });
  assert.equal(el.style.display, 'grid');
  assert.equal(el.style.gridTemplateColumns, 'repeat(8, 1fr)');
  assert.equal(el.style.gridTemplateRows, 'repeat(5, 1fr)');
  assert.equal(el.style.gap, '12px');
});

test('applyGridItem maps widget coordinates to grid placement', () => {
  const el = { style: {} };
  applyGridItem(el, { x: 2, y: 3, w: 4, h: 2 });
  assert.equal(el.style.gridColumn, '3 / span 4');
  assert.equal(el.style.gridRow, '4 / span 2');
});
