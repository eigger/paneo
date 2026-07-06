import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCalendarSource, gradeIndex, fetchQrCode } from '../src/dataproxy.js';

// Timestamps relative to "now" so the test doesn't depend on when it's run.
const HOUR = 3600 * 1000;
const now = Date.now();
const offsets = {
  past48h: now - 48 * HOUR,  // older than the 24h grace window used by "upcoming" mode
  past12h: now - 12 * HOUR,  // inside the 24h grace window
  future1h: now + 1 * HOUR,
  future50h: now + 50 * HOUR,
};

function icsTimestamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function vevent(uid, startMs) {
  const start = icsTimestamp(startMs);
  const end = icsTimestamp(startMs + HOUR);
  return `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:${start}\r\nDTSTART:${start}\r\nDTEND:${end}\r\nSUMMARY:${uid}\r\nEND:VEVENT\r\n`;
}

const ICS_BODY = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Paneo//Test//EN\r\n` +
  vevent('past48h', offsets.past48h) +
  vevent('past12h', offsets.past12h) +
  vevent('future1h', offsets.future1h) +
  vevent('future50h', offsets.future50h) +
  `END:VCALENDAR\r\n`;

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/calendar' });
  res.end(ICS_BODY);
});
await new Promise((resolve) => server.listen(0, resolve));
const url = `http://localhost:${server.address().port}/cal.ics`;

test('fetchCalendarSource without a range keeps the "upcoming" behavior (24h grace, no far-past events)', async () => {
  const events = await fetchCalendarSource(url);
  const uids = events.map((e) => e.summary).sort();
  assert.deepEqual(uids, ['future1h', 'future50h', 'past12h']);
});

test('fetchCalendarSource with a range returns every overlapping event, including far-past ones the "upcoming" mode drops', async () => {
  const events = await fetchCalendarSource(url, { from: now - 72 * HOUR, to: now + 72 * HOUR });
  const uids = events.map((e) => e.summary).sort();
  assert.deepEqual(uids, ['future1h', 'future50h', 'past12h', 'past48h']);
});

test('fetchCalendarSource with a range excludes events outside [from, to)', async () => {
  const events = await fetchCalendarSource(url, { from: now - 1 * HOUR, to: now + 2 * HOUR });
  const uids = events.map((e) => e.summary).sort();
  assert.deepEqual(uids, ['future1h']);
});

test.after(() => server.close());

// Recurring events (RRULE) — e.g. Apple's holiday calendars, which store one
// VEVENT with FREQ=YEARLY per holiday instead of a separate VEVENT per year.
// node-ical only reports the *first* occurrence as `e.start`; without expanding
// the rule, every later recurrence is invisible once "now" has passed it.
const DAY = 24 * HOUR;
// Rounded to the second, matching icsTimestamp()'s truncation — otherwise these
// expected values would carry sub-second precision the ICS round-trip can't.
const roundToSec = (ms) => Math.floor(ms / 1000) * 1000;
const rruleOffsets = {
  past40d: roundToSec(now - 40 * DAY),   // first-ever occurrence — long past
  future5d: roundToSec(now + 5 * DAY),   // next occurrence — should surface in "upcoming" mode
  future50d: roundToSec(now + 50 * DAY), // still within the 90-day lookahead
  future95d: roundToSec(now + 95 * DAY), // beyond the 90-day lookahead — should NOT surface
};
const RRULE_ICS_BODY = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Paneo//Test//EN\r\n` +
  `BEGIN:VEVENT\r\nUID:holiday\r\nDTSTAMP:${icsTimestamp(rruleOffsets.past40d)}\r\n` +
  `DTSTART:${icsTimestamp(rruleOffsets.past40d)}\r\nDTEND:${icsTimestamp(rruleOffsets.past40d + HOUR)}\r\n` +
  `RRULE:FREQ=DAILY;INTERVAL=45;COUNT=4\r\nSUMMARY:holiday\r\nEND:VEVENT\r\n` +
  `END:VCALENDAR\r\n`;

const rruleServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/calendar' });
  res.end(RRULE_ICS_BODY);
});
await new Promise((resolve) => rruleServer.listen(0, resolve));
const rruleUrl = `http://localhost:${rruleServer.address().port}/holiday.ics`;

test('fetchCalendarSource expands a recurring (RRULE) event\'s future occurrences in "upcoming" mode', async () => {
  const events = await fetchCalendarSource(rruleUrl);
  const starts = events.map((e) => new Date(e.start).getTime()).sort((a, b) => a - b);
  // past40d (already passed) and future95d (beyond the 90-day lookahead) must
  // NOT appear — only the two occurrences actually "upcoming" within the window.
  assert.deepEqual(starts, [rruleOffsets.future5d, rruleOffsets.future50d]);
});

test('fetchCalendarSource expands a recurring (RRULE) event\'s occurrence inside an arbitrary range', async () => {
  // A range far from the original DTSTART (past40d) that only overlaps the
  // future50d recurrence — proves the rule is expanded, not just the first date checked.
  const events = await fetchCalendarSource(rruleUrl, {
    from: rruleOffsets.future50d - DAY,
    to: rruleOffsets.future50d + DAY,
  });
  assert.equal(events.length, 1);
  assert.equal(new Date(events[0].start).getTime(), rruleOffsets.future50d);
});

test.after(() => rruleServer.close());

// Apple's calendars attach a LANGUAGE parameter to SUMMARY (e.g. the iCloud
// holiday calendars); node-ical then returns `{ params, val }` instead of a
// plain string, which would otherwise stringify to "[object Object]".
const PARAM_SUMMARY_ICS_BODY = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Paneo//Test//EN\r\n` +
  `BEGIN:VEVENT\r\nUID:paramtest\r\nDTSTAMP:${icsTimestamp(offsets.future1h)}\r\n` +
  `DTSTART:${icsTimestamp(offsets.future1h)}\r\nDTEND:${icsTimestamp(offsets.future1h + HOUR)}\r\n` +
  `SUMMARY;LANGUAGE=ko:새해\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

const paramSummaryServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/calendar' });
  res.end(PARAM_SUMMARY_ICS_BODY);
});
await new Promise((resolve) => paramSummaryServer.listen(0, resolve));
const paramSummaryUrl = `http://localhost:${paramSummaryServer.address().port}/param.ics`;

test('fetchCalendarSource unwraps a parameterized SUMMARY (e.g. SUMMARY;LANGUAGE=ko:...) to a plain string', async () => {
  const events = await fetchCalendarSource(paramSummaryUrl);
  assert.equal(events.length, 1);
  assert.equal(events[0].summary, '새해');
});

test.after(() => paramSummaryServer.close());

// paneo.calendar.month's grid view only shows a time-of-day prefix for events
// that actually have one — an all-day VEVENT (DTSTART;VALUE=DATE, no time
// component) must be flagged so the widget doesn't invent a misleading
// midnight timestamp for it.
const ALLDAY_ICS_BODY = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Paneo//Test//EN\r\n` +
  `BEGIN:VEVENT\r\nUID:allday\r\nDTSTAMP:${icsTimestamp(offsets.future1h)}\r\n` +
  `DTSTART;VALUE=DATE:20260710\r\nDTEND;VALUE=DATE:20260711\r\nSUMMARY:allday\r\nEND:VEVENT\r\n` +
  vevent('timed', offsets.future1h) +
  `END:VCALENDAR\r\n`;

const alldayServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/calendar' });
  res.end(ALLDAY_ICS_BODY);
});
await new Promise((resolve) => alldayServer.listen(0, resolve));
const alldayUrl = `http://localhost:${alldayServer.address().port}/allday.ics`;

test('fetchCalendarSource flags an all-day (VALUE=DATE) event as allDay, leaves a timed event as not', async () => {
  const events = await fetchCalendarSource(alldayUrl, { from: now - DAY, to: now + 30 * DAY });
  const byName = Object.fromEntries(events.map((e) => [e.summary, e]));
  assert.equal(byName.allday.allDay, true);
  assert.equal(byName.timed.allDay, false);
});

test.after(() => alldayServer.close());

test('gradeIndex maps values to tier index, boundaries inclusive on the lower tier', () => {
  const thresholds = [30, 80, 150]; // PM10-style
  assert.equal(gradeIndex(0, thresholds), 0);
  assert.equal(gradeIndex(30, thresholds), 0); // boundary belongs to the lower ("좋음") tier
  assert.equal(gradeIndex(31, thresholds), 1);
  assert.equal(gradeIndex(80, thresholds), 1);
  assert.equal(gradeIndex(81, thresholds), 2);
  assert.equal(gradeIndex(150, thresholds), 2);
  assert.equal(gradeIndex(151, thresholds), 3);
  assert.equal(gradeIndex(1000, thresholds), 3);
});

test('fetchQrCode generates a local PNG data URL (no network call)', async () => {
  const { dataUrl } = await fetchQrCode('https://example.com', 300);
  assert.match(dataUrl, /^data:image\/png;base64,/);
});

test('fetchQrCode clamps size to the [64, 1000] range', async () => {
  const tooSmall = await fetchQrCode('x', 10);
  const tooBig = await fetchQrCode('x', 5000);
  assert.match(tooSmall.dataUrl, /^data:image\/png;base64,/);
  assert.match(tooBig.dataUrl, /^data:image\/png;base64,/);
});
