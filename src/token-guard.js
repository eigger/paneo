const WINDOW_MS = 60_000;
const MAX_FAILURES = 10;
const failures = new Map();

function pruneExpired(now) {
  for (const [knownIp, entry] of failures) {
    if (now - entry.startedAt >= WINDOW_MS) failures.delete(knownIp);
  }
}

// Must be checked before looking up a supplied token, so blocked requests do
// not reveal whether a particular token is valid.
export function isTokenAttemptBlocked(ip, now = Date.now()) {
  pruneExpired(now);
  const entry = failures.get(String(ip || 'unknown'));
  return !!entry && entry.count >= MAX_FAILURES;
}

// Count invalid pairing-token guesses by client IP.
export function recordInvalidTokenAttempt(ip, now = Date.now()) {
  pruneExpired(now);
  const key = String(ip || 'unknown');
  const prior = failures.get(key);
  const entry = !prior || now - prior.startedAt >= WINDOW_MS
    ? { startedAt: now, count: 0 }
    : prior;
  entry.count += 1;
  failures.set(key, entry);
  return entry.count;
}

export function resetTokenAttemptLimits() {
  failures.clear();
}
