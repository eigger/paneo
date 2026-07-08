// §M3 — Offline shell cache (docs/design.md §13 M3 "오프라인 캐시").
// Caches the static display shell so Chromium kiosk can still render
// the last-known layout even if the server is temporarily unreachable.
//
// Cache naming: bump CACHE_VER when any cached file changes shape —
// the activate handler deletes all older caches automatically.

// Bump when any cached shell file changes shape.
const CACHE_VER = 'paneo-display-v8';

const SHELL_FILES = [
  '/display/index.html',
  '/display/display.js',
  '/display/display.css',
  '/shared/widgets.js',
  '/shared/gridlayout.js',
];

// --- Install: pre-cache all shell files ---
self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(CACHE_VER).then((cache) => cache.addAll(SHELL_FILES))
  );
  // Skip waiting so the new SW activates immediately on first install.
  self.skipWaiting();
});

// --- Activate: delete stale caches ---
self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VER).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// --- Fetch: network-first for API/WS, cache-first for shell ---
self.addEventListener('fetch', (ev) => {
  const url = new URL(ev.request.url);

  // Pass through WebSocket upgrades and API calls — they must always be live.
  if (ev.request.headers.get('upgrade') === 'websocket') return;
  if (url.pathname.startsWith('/api/')) return;

  // Shell files: try network first, fall back to cache.
  // This keeps the shell fresh when online while surviving offline starts.
  ev.respondWith(
    fetch(ev.request)
      .then((res) => {
        // Update cache with fresh response for shell files.
        if (SHELL_FILES.includes(url.pathname)) {
          const clone = res.clone();
          caches.open(CACHE_VER).then((cache) => cache.put(ev.request, clone));
        }
        return res;
      })
      .catch(() => {
        // Page navigations (e.g. /d/<token>) aren't cached under their own
        // URL — fall back to the cached shell HTML so the kiosk still shows
        // the last-known layout instead of a blank/error page.
        if (ev.request.mode === 'navigate') {
          return caches.match('/display/index.html');
        }
        return caches.match(ev.request);
      })
  );
});
