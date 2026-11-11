// Client-side rendering coverage: widgets.test.js only exercised pure helpers
// (buildMonthGrid, translate, ...). These tests drive the *actual* render(el,
// config, ctx) code path — the same one the editor preview and the real
// kiosk display both call — using jsdom for a real DOM (innerHTML/
// querySelector/ResizeObserver all need genuine DOM behavior, not a plain
// object stub like gridlayout.test.js gets away with).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
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

test('paneo.todo treats configured item text as text, not markup', (t) => {
  const el = mount(t);
  renderWidget(el, 'paneo.todo', { todoItems: [{ text: '<img src=x onerror=alert(1)>', done: false }] }, {});
  assert.equal(el.querySelector('.todo-text')?.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(el.querySelector('.todo-text img'), null);
});

test('paneo.photo matches selected local filenames when returned URLs include device_token', async (t) => {
  const el = mount(t);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ['/api/proxy/photos/local/file/selected.jpg?device_token=paired-token'],
  });
  t.after(() => { globalThis.fetch = previousFetch; });

  renderWidget(el, 'paneo.photo', {
    source: 'local', localSelectedFiles: ['selected.jpg'],
    interval: 60, transition: 'none', useEffects: false,
  }, { deviceToken: 'paired-token' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(el.querySelector('.w-image'), 'selected local image should be painted');
  assert.match(el.innerHTML, /selected\.jpg/);
});

test('paneo.homeassistant escapes hostile config and normal-state values', async (t) => {
  const el = mount(t);
  const previousFetch = globalThis.fetch;
  const attack = '<img src=x onerror=alert(1)>';
  const entityId = `input_boolean.demo"><img src=x onerror=alert(2)>`;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ state: attack, attributes: { friendly_name: attack, unit_of_measurement: attack } }) });
  t.after(() => { globalThis.fetch = previousFetch; });

  renderWidget(el, 'paneo.homeassistant', { entityId, title: attack, icon: attack, showToggle: true }, { preview: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(el.querySelector('img'), null);
  assert.equal(el.querySelector('.ha-title')?.textContent, attack);
  assert.equal(el.querySelector('.ha-icon')?.textContent, attack);
  assert.equal(el.querySelector('.ha-toggle-btn')?.dataset.entityId, entityId);
  assert.equal(el.querySelector('.ha-toggle-btn')?.disabled, true);
  assert.equal(el.querySelector('.ha-toggle-btn')?.textContent, attack);

  const stateEl = mount(t);
  renderWidget(stateEl, 'paneo.homeassistant', { entityId: 'sensor.demo', title: attack, icon: attack }, {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stateEl.querySelector('img'), null);
  assert.equal(stateEl.querySelector('.ha-state-val')?.textContent, `${attack}${attack}`);
  assert.equal(stateEl.querySelector('.ha-title')?.textContent, attack);
});

test('paneo.homeassistant.weather escapes hostile names, state, and units', async (t) => {
  const el = mount(t);
  const previousFetch = globalThis.fetch;
  const attack = '<svg onload=alert(1)>';
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    state: attack,
    attributes: { friendly_name: attack, temperature: 18, temperature_unit: attack, humidity: attack, wind_speed: attack, wind_speed_unit: attack },
  }) });
  t.after(() => { globalThis.fetch = previousFetch; });

  renderWidget(el, 'paneo.homeassistant', { entityId: 'weather.home', title: attack }, {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(el.querySelector('svg'), null);
  assert.equal(el.querySelector('.ha-title')?.textContent, attack);
  assert.equal(el.querySelector('.ha-weather-cond')?.textContent, attack);
  assert.equal(el.querySelector('.ha-weather-temp')?.textContent, `18${attack}`);
});

test('paneo.calendar.month dims other-month date numbers in 3-week view', (t) => {
  // Early March — the 3-week strip includes late-February days.
  t.mock.timers.enable({ now: new Date('2026-03-03T12:00:00') });
  const el = mount(t);
  el.getBoundingClientRect = () => ({
    width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300,
  });
  renderWidget(el, 'paneo.calendar.month', { icsUrls: [] }, { locale: 'ko-KR' });
  assert.ok(
    el.querySelector('.cal-m-other .cal-m-dnum'),
    'expected other-month day numbers to be marked in 3-week view',
  );
  assert.equal(el.querySelector('.cal-m-past-day'), null, 'whole-day past dimming should not be used');
  t.mock.timers.reset();
});

test('paneo.calendar.month includes its device token exactly once in the proxy URL', async (t) => {
  const el = mount(t);
  const previousFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return { ok: true, json: async () => ({ events: [] }) };
  };
  t.after(() => { globalThis.fetch = previousFetch; });

  renderWidget(el, 'paneo.calendar.month', { icsUrls: ['https://calendar.example/events.ics'] }, {
    locale: 'en-US', deviceToken: 'device-token-123',
  });
  await new Promise((resolve) => setImmediate(resolve));
  const parsed = new URL(requestedUrl, 'http://localhost');
  assert.equal(parsed.searchParams.getAll('device_token').length, 1);
  assert.equal(parsed.searchParams.get('device_token'), 'device-token-123');
});

test('paneo.calendar.month moves the today highlight (and grid) across local midnight without a re-render', (t) => {
  // 30s before a month boundary, so the rollover has to move both the
  // "today" cell and the surrounding week strip — not just the highlight.
  // (3-week view, same box as the test above: the month view's event-time
  // heuristic measures canvas text, which jsdom doesn't have.)
  t.mock.timers.enable({ now: new Date('2026-03-31T23:59:30') });
  const el = mount(t);
  el.getBoundingClientRect = () => ({
    width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300,
  });
  renderWidget(el, 'paneo.calendar.month', { icsUrls: [] }, { locale: 'en-US' });
  const today = () => el.querySelector('.cal-m-today');
  assert.equal(today()?.querySelector('.cal-m-dnum').textContent, '31');
  assert.ok(!today().classList.contains('cal-m-other'), 'Mar 31 is in the current month');

  // One minute later it's 00:00:30 on April 1st — the minute-boundary tick
  // at 00:00:00 must have repainted from the new date. Previously nothing
  // ever re-read the clock, so the kiosk kept yesterday highlighted until
  // the widget happened to be re-rendered (editor refresh / resize).
  t.mock.timers.tick(60_000);
  assert.equal(today()?.querySelector('.cal-m-dnum').textContent, '1');
  assert.ok(!today().classList.contains('cal-m-other'), 'grid re-based on April, so Apr 1 is no longer other-month');

  // Same day → stays put.
  t.mock.timers.tick(60_000);
  assert.equal(today()?.querySelector('.cal-m-dnum').textContent, '1');
  t.mock.timers.reset();
});

// ---- RSS article overlay ----------------------------------------------------
async function mountRss(t, items) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ items }), { headers: { 'content-type': 'application/json' } });
  const el = mount(t);
  renderWidget(el, 'paneo.rss', { feedUrls: ['https://feed.test/rss'], scrollSpeed: 'off' }, { locale: 'en-US' });
  for (let i = 0; i < 50 && !el.querySelector('.w-rss'); i++) await new Promise((r) => setTimeout(r, 10));
  globalThis.fetch = realFetch;
  t.after(() => document.querySelector('.article-back')?.click());
  return el;
}

test('paneo.rss: non-http links render as plain text without an anchor', async (t) => {
  const el = await mountRss(t, [{ title: 'bad', link: 'javascript:alert(1)' }]);
  assert.ok(el.querySelector('.w-rss li'), 'item rendered');
  assert.equal(el.querySelector('.w-rss a'), null);
  assert.match(el.querySelector('.w-rss li').textContent, /bad/);
});

test('paneo.rss: clicking a headline opens a sandboxed overlay; back closes it', async (t) => {
  const el = await mountRss(t, [{ title: 'one', link: 'https://example.com/a' }]);
  const a = el.querySelector('.w-rss a');
  const ev = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
  a.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  const frame = document.querySelector('.article-overlay iframe');
  assert.ok(frame);
  assert.equal(frame.getAttribute('src'), 'https://example.com/a');
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts allow-forms'); // never allow-same-origin
  // A second open replaces the first rather than stacking.
  a.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(document.querySelectorAll('.article-overlay').length, 1);
  document.querySelector('.article-back').click();
  assert.equal(document.querySelector('.article-overlay'), null);
});

test('paneo.rss: Escape closes the overlay', async (t) => {
  const el = await mountRss(t, [{ title: 'one', link: 'https://example.com/a' }]);
  el.querySelector('.w-rss a').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.ok(document.querySelector('.article-overlay'));
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(document.querySelector('.article-overlay'), null);
});

// ---- Calendar day-detail popup ------------------------------------------------
test('paneo.calendar.month: tapping a day opens a detail popup; tapping it again closes it', async (t) => {
  const el = mount(t);
  el.getBoundingClientRect = () => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 });
  const previousFetch = globalThis.fetch;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0).toISOString();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0).toISOString();
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ events: [
    { summary: 'Standup <b>x</b>', start, end, allDay: false, source: 's', location: 'Room 1', description: 'Agenda' },
  ] }) });
  t.after(() => { globalThis.fetch = previousFetch; document.querySelector('.cal-popup')?.click(); });
  renderWidget(el, 'paneo.calendar.month', { icsUrls: ['https://calendar.example/e.ics'] }, { locale: 'en-US' });
  for (let i = 0; i < 50 && !el.querySelector('.cal-m-event'); i++) await new Promise((r) => setTimeout(r, 10));

  const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  el.querySelector(`.cal-m-day[data-date="${ds}"]`).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const popup = document.querySelector('.cal-popup');
  assert.ok(popup, 'popup opened');
  assert.match(popup.textContent, /Room 1/);
  assert.match(popup.textContent, /Agenda/);
  assert.equal(popup.querySelector('b'), null, 'summary is escaped');

  popup.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(document.querySelector('.cal-popup'), null, 'tap closes it');
});

test('paneo.calendar.month: day popup auto-closes after its idle timeout', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'], now: new Date('2026-03-03T12:00:00') });
  const el = mount(t);
  el.getBoundingClientRect = () => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 });
  renderWidget(el, 'paneo.calendar.month', { icsUrls: [] }, { locale: 'en-US' });
  el.querySelector('.cal-m-day[data-date]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.ok(document.querySelector('.cal-popup'));
  assert.match(document.querySelector('.cal-popup').textContent, /No events/);
  t.mock.timers.tick(20_000);
  assert.equal(document.querySelector('.cal-popup'), null);
  t.mock.timers.reset();
});

function fakeCalendarFetch(t, events) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ events }) });
  t.after(() => { globalThis.fetch = previousFetch; document.querySelector('.cal-popup')?.click(); });
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const click = (node, init = {}) => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, ...init }));

test('paneo.calendar.month: popup closes on Escape and when the widget is torn down', async (t) => {
  const el = mount(t);
  el.getBoundingClientRect = () => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 });
  renderWidget(el, 'paneo.calendar.month', { icsUrls: [] }, { locale: 'en-US' });
  click(el.querySelector('.cal-m-day[data-date]'));
  assert.ok(document.querySelector('.cal-popup'));
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(document.querySelector('.cal-popup'), null);

  click(el.querySelector('.cal-m-day[data-date]'));
  assert.ok(document.querySelector('.cal-popup'));
  el._cleanup();
  assert.equal(document.querySelector('.cal-popup'), null, 'teardown closes the popup');
});

test('paneo.calendar.month: a swipe inside a cell does not open the popup; editor preview never does', async (t) => {
  const el = mount(t);
  el.getBoundingClientRect = () => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 });
  renderWidget(el, 'paneo.calendar.month', { icsUrls: [] }, { locale: 'en-US' });
  const cell = el.querySelector('.cal-m-day[data-date]');
  cell.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
  click(cell, { clientX: 120, clientY: 12 });
  assert.equal(document.querySelector('.cal-popup'), null, 'moved >10px = swipe, not a tap');
  cell.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
  click(cell, { clientX: 12, clientY: 11 });
  assert.ok(document.querySelector('.cal-popup'), 'stationary press is a tap');
  document.querySelector('.cal-popup').click();

  const ed = mount(t);
  ed.getBoundingClientRect = el.getBoundingClientRect;
  renderWidget(ed, 'paneo.calendar.month', { icsUrls: [] }, { locale: 'en-US', preview: true });
  click(ed.querySelector('.cal-m-day[data-date]'));
  assert.equal(document.querySelector('.cal-popup'), null);
});

test('paneo.calendar.month: popup shows All day, and the end date when an event crosses midnight', async (t) => {
  const el = mount(t);
  el.getBoundingClientRect = () => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 });
  const today = new Date();
  const at = (dd, h) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + dd, h, 0).toISOString();
  fakeCalendarFetch(t, [
    { summary: 'Holiday', start: at(0, 0), allDay: true, source: 's' },
    { summary: 'Night', start: at(0, 22), end: at(1, 2), allDay: false, source: 's' },
  ]);
  renderWidget(el, 'paneo.calendar.month', { icsUrls: ['https://c.example/e.ics'] }, { locale: 'en-US' });
  for (let i = 0; i < 50 && !el.querySelector('.cal-m-event'); i++) await new Promise((r) => setTimeout(r, 10));
  click(el.querySelector(`.cal-m-day[data-date="${ymd(today)}"]`));
  const text = document.querySelector('.cal-popup').textContent;
  assert.match(text, /All day/);
  const times = [...document.querySelectorAll('.cal-pop-time')].map((n) => n.textContent);
  assert.ok(times.some((x) => /–\s*\S+\s+\d/.test(x) && x.split('–')[1].trim().split(/\s+/).length > 2), `end carries a date: ${times}`);
});
