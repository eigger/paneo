// §12 보안 D?: minimal single-admin password gate for the editor (docs/design.md
// explicitly flagged this as "의도적으로 미구현·보류" until real deployment).
// Sessions are an in-memory bearer-token map, not JWT/signed cookies — the
// token itself IS the secret, so no signing key/cookie library is needed, and
// losing it on a server restart (forcing re-login) is an acceptable trade-off
// for a single-admin self-hosted tool.
import crypto from 'node:crypto';
import * as store from './store.js';

export const SESSION_COOKIE_NAME = 'paneo_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SETTING_KEY = 'adminPasswordHash';

const sessions = new Map(); // sessionId -> expiresAt (ms epoch)

function scrypt(password, saltHex) {
  return crypto.scryptSync(password, saltHex, 64).toString('hex');
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${scrypt(password, salt)}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  let candidate;
  try {
    candidate = scrypt(password, salt);
  } catch {
    return false;
  }
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function isConfigured() {
  return !!store.getSetting(SETTING_KEY);
}

export function setPassword(password) {
  store.setSetting(SETTING_KEY, hashPassword(password));
}

export function checkPassword(password) {
  return verifyPassword(password, store.getSetting(SETTING_KEY));
}

export function createSession() {
  const id = crypto.randomBytes(32).toString('hex');
  sessions.set(id, Date.now() + SESSION_TTL_MS);
  return id;
}

export function isValidSession(id) {
  if (!id) return false;
  const exp = sessions.get(id);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(id);
    return false;
  }
  return true;
}

export function destroySession(id) {
  if (id) sessions.delete(id);
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

export function sessionCookieHeader(id) {
  return `${SESSION_COOKIE_NAME}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function clearCookieHeader() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// Very small brute-force deterrent — not a substitute for network-level rate
// limiting, but enough to stop a naive password-guessing loop against a
// single-admin login form.
const attempts = new Map(); // ip -> { count, resetAt }
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 5 * 60 * 1000;

export function isRateLimited(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  rec.count++;
  return rec.count > MAX_ATTEMPTS;
}
