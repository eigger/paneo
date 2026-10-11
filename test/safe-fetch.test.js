import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSameOrigin } from '../src/safe-fetch.js';

test('same-origin redirects keep private LAN feed URLs usable', async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1
      ? new Response('', { status: 302, headers: { location: '/calendar.ics' } })
      : new Response('BEGIN:VCALENDAR');
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const response = await fetchSameOrigin('http://192.168.1.20/calendar');
  assert.equal(await response.text(), 'BEGIN:VCALENDAR');
  assert.equal(calls, 2);
});

test('feed redirects cannot pivot to another host', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/admin' } });
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(fetchSameOrigin('https://feeds.example/feed'), /Cross-origin redirects/);
});
