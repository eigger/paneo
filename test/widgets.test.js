import { test } from 'node:test';
import assert from 'node:assert/strict';
import { widgets, widgetLabel, fieldLabel, fieldPlaceholder, translate, CATEGORY_ORDER, buildMonthGrid, buildWeekRows } from '../public/shared/widgets.js';

const EXPECTED_WIDGETS = [
  'paneo.clock',
  'paneo.date',
  'paneo.text',
  'paneo.photo',
  'paneo.weather',
  'paneo.airquality',
  'paneo.calendar',
  'paneo.calendar.month',
  'paneo.rss',
  'paneo.iframe',
  'paneo.timer',
  'paneo.homeassistant',
  'paneo.worldclock',
  'paneo.dday',
  'paneo.todo',
  'paneo.exchangerate',
  'paneo.qrcode',
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
  assert.equal(widgetLabel('paneo.clock', 'ja'), '時計');
  assert.equal(widgetLabel('paneo.clock', 'de'), 'Uhr');
  assert.equal(widgetLabel('paneo.clock', 'fr'), 'Horloge');
  assert.equal(widgetLabel('paneo.clock', 'es'), 'Reloj');
});

test('fieldLabel resolves localized config labels', () => {
  const field = widgets['paneo.text'].config[0];
  assert.equal(fieldLabel(field, 'ko'), '내용');
  assert.equal(fieldLabel(field, 'en'), 'Content');
  assert.equal(fieldLabel(field, 'ja'), '内容');
  assert.equal(fieldLabel(field, 'de'), 'Inhalt');
  assert.equal(fieldLabel(field, 'fr'), 'Contenu');
  assert.equal(fieldLabel(field, 'es'), 'Contenido');
});

test('fieldPlaceholder resolves localized config placeholders', () => {
  const field = widgets['paneo.todo'].config[0].fields[1];
  assert.equal(fieldPlaceholder(field, 'ko'), '할 일 내용');
  assert.equal(fieldPlaceholder(field, 'en'), 'Item text');
  assert.equal(fieldPlaceholder(field, 'ja'), 'ToDoの内容');
  assert.equal(fieldPlaceholder(field, 'de'), 'Aufgabentext');
  assert.equal(fieldPlaceholder(field, 'fr'), 'Texte de la tâche');
  assert.equal(fieldPlaceholder(field, 'es'), 'Texto de la tarea');
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

test('buildMonthGrid returns correct first cell based on startOnSunday', () => {
  // July 5, 2026 is Sunday. Let's construct a date in July 2026.
  // July 1, 2026 is Wednesday.
  const date = new Date(2026, 6, 5); 

  // Monday start (startOnSunday = false):
  // Wednesday is the first day of the month. Monday is June 29.
  const gridMon = buildMonthGrid(date, false);
  assert.equal(gridMon[0].getFullYear(), 2026);
  assert.equal(gridMon[0].getMonth(), 5); // June
  assert.equal(gridMon[0].getDate(), 29); // June 29 (Monday)

  // Sunday start (startOnSunday = true):
  // Sunday is June 28.
  const gridSun = buildMonthGrid(date, true);
  assert.equal(gridSun[0].getFullYear(), 2026);
  assert.equal(gridSun[0].getMonth(), 5); // June
  assert.equal(gridSun[0].getDate(), 28); // June 28 (Sunday)
});

test('buildWeekRows returns correct range based on startOnSunday', () => {
  const date = new Date(2026, 6, 9); // July 9, 2026 is Thursday.

  // Monday start:
  // Thursday offset is 3 days from Monday (July 6).
  const rowsMon = buildWeekRows(date, 0, 0, false);
  assert.equal(rowsMon[0].getDate(), 6); // July 6 (Monday)
  assert.equal(rowsMon[6].getDate(), 12); // July 12 (Sunday)

  // Sunday start:
  // Thursday offset is 4 days from Sunday (July 5).
  const rowsSun = buildWeekRows(date, 0, 0, true);
  assert.equal(rowsSun[0].getDate(), 5); // July 5 (Sunday)
  assert.equal(rowsSun[6].getDate(), 11); // July 11 (Saturday)
});

test('translate resolves general key translation with fallback', () => {
  assert.equal(translate('paneo.calendar.noEvents', 'ko'), '일정 없음');
  assert.equal(translate('paneo.calendar.noEvents', 'en'), 'No events');
  assert.equal(translate('paneo.calendar.noEvents', 'fr-FR'), 'Aucun événement');
  assert.equal(translate('paneo.homeassistant.on', 'de-DE'), 'AN');
  assert.equal(translate('non.existent.key', 'fr', 'Fallback Value'), 'Fallback Value');
  assert.equal(translate('non.existent.key', 'fr'), 'non.existent.key');
});
