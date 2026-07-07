import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PANEO_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'paneo-test-'));

const store = await import('../src/store.js');
await store.load();
const auth = await import('../src/auth.js');

test('not configured until a password is set', () => {
  assert.equal(auth.isConfigured(), false);
});

test('setPassword + checkPassword round-trips correctly', () => {
  auth.setPassword('correct-horse-battery-staple');
  assert.equal(auth.isConfigured(), true);
  assert.equal(auth.checkPassword('correct-horse-battery-staple'), true);
  assert.equal(auth.checkPassword('wrong-password'), false);
});

test('hashPassword never stores the plaintext password', () => {
  const hash = auth.hashPassword('super-secret');
  assert.doesNotMatch(hash, /super-secret/);
  assert.match(hash, /^[0-9a-f]+:[0-9a-f]+$/);
});

test('createSession issues a token that isValidSession accepts, and destroySession revokes it', () => {
  const id = auth.createSession();
  assert.equal(auth.isValidSession(id), true);
  auth.destroySession(id);
  assert.equal(auth.isValidSession(id), false);
});

test('isValidSession rejects unknown or missing tokens', () => {
  assert.equal(auth.isValidSession('not-a-real-session'), false);
  assert.equal(auth.isValidSession(undefined), false);
  assert.equal(auth.isValidSession(''), false);
});

test('parseCookies reads the session cookie out of a Cookie header', () => {
  const cookies = auth.parseCookies(`foo=bar; ${auth.SESSION_COOKIE_NAME}=abc123; baz=qux`);
  assert.equal(cookies[auth.SESSION_COOKIE_NAME], 'abc123');
});

test('sessionCookieHeader sets HttpOnly + SameSite, clearCookieHeader expires it', () => {
  const setHeader = auth.sessionCookieHeader('sometoken');
  assert.match(setHeader, /HttpOnly/);
  assert.match(setHeader, /SameSite=Lax/);
  const clearHeader = auth.clearCookieHeader();
  assert.match(clearHeader, /Max-Age=0/);
});

test('isRateLimited allows a normal login attempt rate and blocks a rapid-fire loop', () => {
  const ip = '203.0.113.5';
  for (let i = 0; i < 10; i++) {
    assert.equal(auth.isRateLimited(ip), false, `attempt ${i + 1} should not be limited yet`);
  }
  assert.equal(auth.isRateLimited(ip), true, '11th attempt within the window should be blocked');
});
