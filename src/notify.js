import { randomUUID } from 'node:crypto';

export const NOTIFY_DURATION_DEFAULT_MS = 5000;
export const NOTIFY_DURATION_MIN_MS = 1000;
// Cap inline base64 payloads so a single notify can't blow up the WS frame.
export const NOTIFY_IMAGE_MAX_BYTES = 512 * 1024;

const DATA_IMAGE_RE = /^data:image\/(jpeg|jpg|png|gif|webp);base64,/i;
const HTTP_URL_RE = /^https?:\/\//i;

// Default 5s; missing/invalid → 5s; ≤0 → 1s; otherwise at least 1s.
export function normalizeNotifyDuration(raw) {
  if (raw === undefined || raw === null || raw === '') return NOTIFY_DURATION_DEFAULT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return NOTIFY_DURATION_DEFAULT_MS;
  if (n <= 0) return NOTIFY_DURATION_MIN_MS;
  return Math.max(NOTIFY_DURATION_MIN_MS, Math.floor(n));
}

export function parseNotifyImage(raw) {
  if (raw === undefined || raw === null || raw === '') return '';
  const image = String(raw).trim();
  if (!image) return '';
  if (HTTP_URL_RE.test(image)) return image;
  if (DATA_IMAGE_RE.test(image)) {
    const b64 = image.split(',')[1] || '';
    const approxBytes = Math.floor((b64.length * 3) / 4);
    if (approxBytes > NOTIFY_IMAGE_MAX_BYTES) return { error: 'image too large' };
    return image;
  }
  return { error: 'image must be an http(s) URL or data:image/...;base64,...' };
}

export function parseNotifyBody(body = {}) {
  const message = String(body.message ?? body.text ?? '').trim();
  const imageResult = parseNotifyImage(body.image ?? body.imageUrl);
  if (imageResult && typeof imageResult === 'object' && imageResult.error) return imageResult;
  const image = typeof imageResult === 'string' ? imageResult : '';
  if (!message && !image) return { error: 'message or image required' };

  const level = ['info', 'warn', 'error'].includes(body.level) ? body.level : 'info';
  const title = body.title ? String(body.title).trim() : '';
  const duration = normalizeNotifyDuration(body.duration);
  return {
    message,
    title,
    level,
    duration,
    ...(image ? { image } : {}),
  };
}

export function buildNotifyMessage({ message, title, level, duration, image, id }) {
  return {
    type: 'notify',
    id: id || randomUUID(),
    ...(message ? { message } : {}),
    ...(title ? { title } : {}),
    ...(image ? { image } : {}),
    level,
    duration,
  };
}
