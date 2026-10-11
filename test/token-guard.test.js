import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTokenAttemptBlocked, recordInvalidTokenAttempt, resetTokenAttemptLimits } from '../src/token-guard.js';

test('invalid pairing-token guesses are rate-limited per IP and window', () => {
  resetTokenAttemptLimits();
  for (let i = 0; i < 10; i++) {
    recordInvalidTokenAttempt('192.0.2.1', 1_000);
    assert.equal(isTokenAttemptBlocked('192.0.2.1', 1_000), i === 9);
  }
  assert.equal(isTokenAttemptBlocked('192.0.2.1', 1_001), true);
  assert.equal(isTokenAttemptBlocked('192.0.2.2', 1_001), false);
  assert.equal(isTokenAttemptBlocked('192.0.2.1', 61_000), false);
});
