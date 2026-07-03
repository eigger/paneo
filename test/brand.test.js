import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRAND } from '../src/brand.js';

test('BRAND exposes stable product metadata', () => {
  assert.equal(BRAND.name, 'Paneo');
  assert.equal(BRAND.slug, 'paneo');
  assert.equal(BRAND.pluginPrefix, 'paneo');
  assert.match(BRAND.tagline, /dashboard/i);
});
