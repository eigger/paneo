import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrustedProxies } from '../src/proxy-config.js';

test('trusted proxy configuration is opt-in and accepts explicit IPs/CIDRs', () => {
  assert.equal(parseTrustedProxies(undefined), undefined);
  assert.equal(parseTrustedProxies('  '), undefined);
  assert.deepEqual(parseTrustedProxies('127.0.0.1, 10.0.0.0/8, ::1'), ['127.0.0.1', '10.0.0.0/8', '::1']);
});

test('trusted proxy configuration rejects wildcards, invalid addresses, and invalid prefixes', () => {
  for (const value of ['*', '0.0.0.0/0', 'proxy.local', '10.0.0.1/33', '127.0.0.1,']) {
    assert.throws(() => parseTrustedProxies(value), /PANEO_TRUST_PROXY/);
  }
});
