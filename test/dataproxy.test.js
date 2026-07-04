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
