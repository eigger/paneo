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

test('feed redirects can move to a public host', async (t) => {
  const originalFetch = globalThis.fetch;
  const visited = [];
  globalThis.fetch = async (url) => {
    visited.push(String(url));
    return visited.length === 1
      ? new Response('', { status: 302, headers: { location: 'https://8.8.8.8/feed.xml' } })
      : new Response('feed');
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const response = await fetchSameOrigin('https://feeds.example/feed');
  assert.equal(await response.text(), 'feed');
  assert.deepEqual(visited, ['https://feeds.example/feed', 'https://8.8.8.8/feed.xml']);
});

test('feed redirects cannot pivot to a private host', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/admin' } });
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(fetchSameOrigin('https://feeds.example/feed'), /private network/);
});

test('feed redirects cannot pivot to an IPv4-mapped IPv6 private address', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 302, headers: { location: 'http://[::ffff:127.0.0.1]/admin' } });
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(fetchSameOrigin('https://feeds.example/feed'), /private network/);
});

test('cross-origin redirects do not forward authentication headers', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), headers: new Headers(options.headers) });
    return calls.length === 1
      ? new Response('', { status: 302, headers: { location: 'https://8.8.8.8/feed' } })
      : new Response('feed');
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  await fetchSameOrigin('https://feeds.example/feed', { headers: { 'x-api-key': 'secret', accept: 'application/rss+xml' } });
  assert.equal(calls[0].headers.get('x-api-key'), 'secret');
  assert.equal(calls[1].headers.get('x-api-key'), null);
  assert.equal(calls[1].headers.get('accept'), 'application/rss+xml');
});

test('redirect response bodies are canceled before following the next hop', async (t) => {
  const originalFetch = globalThis.fetch;
  let canceled = false;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1
      ? new Response(new ReadableStream({ cancel() { canceled = true; } }), { status: 302, headers: { location: '/next' } })
      : new Response('feed');
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const response = await fetchSameOrigin('https://feeds.example/feed');
  assert.equal(await response.text(), 'feed');
  assert.equal(canceled, true);
});
