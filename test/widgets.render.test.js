// Client-side rendering coverage: widgets.test.js only exercised pure helpers
// (buildMonthGrid, translate, ...). These tests drive the *actual* render(el,
// config, ctx) code path — the same one the editor preview and the real
// kiosk display both call — using jsdom for a real DOM (innerHTML/
// querySelector/ResizeObserver all need genuine DOM behavior, not a plain
// object stub like gridlayout.test.js gets away with).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.Intl = Intl; // Node's Intl is used directly, not jsdom's
// jsdom has no layout engine, so ResizeObserver doesn't exist and ResizeObserver
// callbacks would never fire anyway — a no-op stub is enough since every widget
// below also renders synchronously once up front, which is what's asserted on.
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};

const { renderWidget } = await import('../public/shared/widgets.js');

// Several widgets (clock/date/worldclock/dday/timer) schedule a recursive
// setTimeout to keep ticking (scheduleSecondTick/scheduleBoundaryTick) and
// stash the canceller on el._cleanup — without calling it, the timer keeps
// firing forever and `node --test` never exits. t.after() runs even if the
// test body throws (e.g. the assertions below fail), so cleanup can't be skipped.
function mount(t) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  t.after(() => el._cleanup?.());
  return el;
}

test('paneo.clock renders a HH:MM(:SS) time string', (t) => {
  const el = mount(t);
  renderWidget(el, 'paneo.clock', { showSeconds: true }, { locale: 'en-US', timezone: 'UTC' });
  const hm = el.querySelector('.w-clock .clock-hm');
  assert.ok(hm, 'expected .clock-hm to be rendered');
  assert.match(hm.textContent, /^\d{2}:\d{2}:\d{2}$/);
});

test('paneo.date renders both the date and weekday lines', (t) => {
  const el = mount(t);
  renderWidget(el, 'paneo.date', {}, { locale: 'en-US', timezone: 'UTC' });
  const main = el.querySelector('.w-date .date-main');
  const weekday = el.querySelector('.w-date .date-weekday');
  assert.ok(main?.textContent.length);
  assert.ok(weekday?.textContent.length);
});

test('paneo.worldclock renders one row per configured city', (t) => {
  const el = mount(t);
  renderWidget(el, 'paneo.worldclock', {
    cities: [{ label: 'Tokyo', tz: 'Asia/Tokyo' }, { label: 'London', tz: 'Europe/London' }],
  }, { locale: 'en-US' });
  const rows = el.querySelectorAll('.w-worldclock .wc-row');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('.wc-label').textContent, 'Tokyo');
  assert.match(rows[0].querySelector('.wc-time').textContent, /\d{1,2}:\d{2}/);
});

test('paneo.worldclock shows a hint instead of crashing when no cities are configured', (t) => {
  const el = mount(t);
  renderWidget(el, 'paneo.worldclock', { cities: [] }, { locale: 'en-US' });
  assert.equal(el.querySelectorAll('.wc-row').length, 0);
});

test('paneo.dday renders a countdown row for a future date', (t) => {
  const el = mount(t);
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  const iso = future.toISOString().slice(0, 10);
  renderWidget(el, 'paneo.dday', { events: [{ label: 'Anniversary', date: iso }] }, { locale: 'en-US' });
  assert.match(el.innerHTML, /Anniversary/);
});

test('paneo.timer renders label and value for a configured timer', (t) => {
  const el = mount(t);
  renderWidget(el, 'paneo.timer', {
    timers: [{ label: 'Lunch', time: '12:00', mode: 'both' }],
  }, { locale: 'en-US' });
  const row = el.querySelector('.w-timer .timer-row');
  assert.ok(row, 'expected a rendered timer row');
  assert.equal(el.querySelector('.timer-label').textContent, 'Lunch');
  assert.ok(el.querySelector('.timer-val').textContent.length > 0);
});

test('paneo.text renders plain configured text', (t) => {
  const el = mount(t);
  renderWidget(el, 'paneo.text', { text: 'Hello Paneo' }, {});
  assert.equal(el.querySelector('.w-text').textContent, 'Hello Paneo');
});

test('paneo.calendar.month dims past calendar days in 3-week view', (t) => {
  // Early March — the 3-week strip includes late-February days (already past).
  t.mock.timers.enable({ now: new Date('2026-03-03T12:00:00') });
  const el = mount(t);
  // 400×300px → 3-week view (height < CAL_MIN_MONTH_HEIGHT 380).
  el.getBoundingClientRect = () => ({
    width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300,
  });
  renderWidget(el, 'paneo.calendar.month', { icsUrls: [] }, { locale: 'ko-KR' });
  assert.ok(
    el.querySelector('.cal-m-past-day'),
    'expected past day cells to carry cal-m-past-day in 3-week view',
  );
  t.mock.timers.reset();
});
