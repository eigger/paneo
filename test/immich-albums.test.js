import { test } from 'node:test';
import assert from 'node:assert/strict';
import { albumContainsAsset, rememberAlbumAssets } from '../src/immich-albums.js';

test('album membership cache checks exact instance, key, album, and asset', () => {
  rememberAlbumAssets('http://immich:2283/', 'secret', 'album-1', [{ id: 'asset-a' }], 1000);
  assert.equal(albumContainsAsset('http://immich:2283', 'secret', 'album-1', 'asset-a', 1001), true);
  assert.equal(albumContainsAsset('http://immich:2283', 'secret', 'album-1', 'asset-b', 1001), false);
  assert.equal(albumContainsAsset('http://immich:2283', 'other', 'album-1', 'asset-a', 1001), null);
  assert.equal(albumContainsAsset('http://immich:2283', 'secret', 'album-1', 'asset-a', 301001), null);
});
