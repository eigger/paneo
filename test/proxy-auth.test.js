import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceAllowsFeedUrls, deviceAllowsImmich, deviceAllowsLocalPhoto, filterLocalPhotoFiles } from '../src/proxy-auth.js';

test('paired devices can proxy only feed URLs in their published widgets', () => {
  const device = { published: { pages: [{ widgets: [
    { type: 'paneo.rss', config: { feedUrls: ['https://news.example/feed.xml'] } },
    { type: 'paneo.calendar', config: { icsUrls: ['http://192.168.1.20/calendar.ics|#22aaff'] } },
  ] }] } };
  assert.equal(deviceAllowsFeedUrls(device, 'rss', ['https://news.example/feed.xml']), true);
  assert.equal(deviceAllowsFeedUrls(device, 'ical', ['http://192.168.1.20/calendar.ics']), true);
  assert.equal(deviceAllowsFeedUrls(device, 'rss', ['http://127.0.0.1/admin']), false);
  const slashScoped = { published: { widgets: [{ type: 'paneo.rss', config: { feedUrls: ['https://news.example/feed'] } }] } };
  assert.equal(deviceAllowsFeedUrls(slashScoped, 'rss', ['https://news.example/feed']), true);
  assert.equal(deviceAllowsFeedUrls(slashScoped, 'rss', ['https://news.example/feed/']), false);
  assert.equal(deviceAllowsFeedUrls(device, 'rss', ['https://news.example/feed.xml', 'https://evil.example/feed']), false);
});

test('paired devices can proxy only the configured Immich instance and key', () => {
  const device = { published: { widgets: [{ type: 'paneo.photo', config: {
    source: 'immich', immichUrl: 'http://192.168.1.30:2283/', immichApiKey: 'configured-key',
  } }] } };
  assert.equal(deviceAllowsImmich(device, 'http://192.168.1.30:2283', 'configured-key'), true);
  assert.equal(deviceAllowsImmich(device, 'http://192.168.1.30:2283/', 'configured-key'), true);
  assert.equal(deviceAllowsImmich(device, 'http://127.0.0.1:2283', 'configured-key'), false);
  assert.equal(deviceAllowsImmich(device, 'http://192.168.1.30:2283', 'other-key'), false);
});

test('paired devices can read only local photos exposed by their published photo widgets', () => {
  const device = { published: { pages: [{ widgets: [{ type: 'paneo.photo', config: {
    source: 'local', localSelectedFiles: ['kitchen.jpg'],
  } }] }] } };
  assert.equal(deviceAllowsLocalPhoto(device), true);
  assert.equal(deviceAllowsLocalPhoto(device, 'kitchen.jpg'), true);
  assert.equal(deviceAllowsLocalPhoto(device, 'private.jpg'), false);
  assert.deepEqual(filterLocalPhotoFiles(device, ['kitchen.jpg', 'private.jpg']), ['kitchen.jpg']);
  assert.equal(deviceAllowsLocalPhoto({ published: { widgets: [] } }), false);
  const legacyAll = { published: { widgets: [{ type: 'paneo.photo', config: { source: 'local' } }] } };
  assert.equal(deviceAllowsLocalPhoto(legacyAll, 'any-upload.jpg'), true);
});

test('Immich authorization binds requests to the published album', () => {
  const device = { published: { widgets: [{ type: 'paneo.photo', config: {
    source: 'immich', immichUrl: 'http://immich:2283', immichApiKey: 'key', immichAlbumId: 'album-1',
  } }] } };
  assert.equal(deviceAllowsImmich(device, 'http://immich:2283', 'key', 'album-1'), true);
  assert.equal(deviceAllowsImmich(device, 'http://immich:2283', 'key', 'album-2'), false);
});
