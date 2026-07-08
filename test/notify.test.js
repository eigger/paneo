import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeNotifyDuration,
  parseNotifyBody,
  buildNotifyMessage,
  NOTIFY_DURATION_DEFAULT_MS,
  NOTIFY_DURATION_MIN_MS,
} from '../src/notify.js';

test('normalizeNotifyDuration defaults to 5s when missing', () => {
  assert.equal(normalizeNotifyDuration(undefined), NOTIFY_DURATION_DEFAULT_MS);
  assert.equal(normalizeNotifyDuration(null), NOTIFY_DURATION_DEFAULT_MS);
  assert.equal(normalizeNotifyDuration(''), NOTIFY_DURATION_DEFAULT_MS);
});

test('normalizeNotifyDuration clamps non-positive values to 1s', () => {
  assert.equal(normalizeNotifyDuration(0), NOTIFY_DURATION_MIN_MS);
  assert.equal(normalizeNotifyDuration(-100), NOTIFY_DURATION_MIN_MS);
});

test('normalizeNotifyDuration enforces a 1s minimum for positive values', () => {
  assert.equal(normalizeNotifyDuration(500), NOTIFY_DURATION_MIN_MS);
  assert.equal(normalizeNotifyDuration(3000), 3000);
});

test('parseNotifyBody requires a message or image and normalizes duration', () => {
  assert.deepEqual(parseNotifyBody({ text: ' hello ' }), {
    message: 'hello',
    title: '',
    level: 'info',
    duration: NOTIFY_DURATION_DEFAULT_MS,
  });
  assert.equal(parseNotifyBody({}).error, 'message or image required');
  assert.equal(parseNotifyBody({ message: '   ' }).error, 'message or image required');
  const parsed = parseNotifyBody({ message: 'x', level: 'warn', title: 'T', duration: 0 });
  assert.equal(parsed.level, 'warn');
  assert.equal(parsed.title, 'T');
  assert.equal(parsed.duration, NOTIFY_DURATION_MIN_MS);
});

test('parseNotifyBody accepts http(s) image URLs and data URLs', () => {
  assert.deepEqual(parseNotifyBody({
    image: 'https://example.com/snap.jpg',
  }), {
    message: '',
    title: '',
    level: 'info',
    duration: NOTIFY_DURATION_DEFAULT_MS,
    image: 'https://example.com/snap.jpg',
  });
  const tinyPng = 'data:image/png;base64,iVBORw0KGgo=';
  const withData = parseNotifyBody({ message: 'cam', image: tinyPng });
  assert.equal(withData.image, tinyPng);
  assert.equal(parseNotifyBody({ image: 'ftp://bad' }).error, 'image must be an http(s) URL or data:image/...;base64,...');
});

test('buildNotifyMessage omits empty title and assigns an id', () => {
  const msg = buildNotifyMessage({
    message: 'hi',
    image: 'https://example.com/a.jpg',
    level: 'error',
    duration: 2000,
    id: 'n1',
  });
  assert.equal(msg.type, 'notify');
  assert.equal(msg.id, 'n1');
  assert.equal(msg.message, 'hi');
  assert.equal(msg.image, 'https://example.com/a.jpg');
  assert.equal(msg.level, 'error');
  assert.equal(msg.duration, 2000);
  assert.equal(msg.title, undefined);
});
