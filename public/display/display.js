import { widgets, renderWidget, loadPlugins } from '/shared/widgets.js';
import { applyGridContainer, applyGridItem, applyCustomCss } from '/shared/gridlayout.js';
import { attachSwipeNavigation } from '/shared/swipe.js';

const stage = document.getElementById('stage');
const statusEl = document.getElementById('status');
const token = location.pathname.split('/').filter(Boolean).pop();
const CACHE_KEY = `paneo:layout:${token}`;

let lastLayout = null;
let lastCtx = { locale: 'ko-KR', timezone: undefined, performanceProfile: 'high' };
let displayVersion = '';

fetch('/api/version')
  .then((res) => res.json())
  .then((manifest) => {
    displayVersion = manifest?.components?.display || '';
    if (displayVersion) statusEl.title = `Paneo display v${displayVersion}`;
  })
  .catch(() => {});

// 'auto' is resolved locally on the display, not the server (docs/design.md §4.3/§14
// "B") — simple heuristic; a future auto-resolution-detect could feed a similar signal.
function resolvePerformanceProfile(profile) {
  if (profile !== 'auto') return profile || 'high';
  const mem = navigator.deviceMemory; // not supported in every browser; undefined is fine
  const cores = navigator.hardwareConcurrency || 4;
  return (mem && mem <= 1) || cores <= 2 ? 'low' : 'high';
}

let currentPageIndex = 0;

function getPageWidgets(layout) {
  if (layout.pages && layout.pages.length > 0) {
    const idx = Math.min(currentPageIndex, layout.pages.length - 1);
    return { widgets: layout.pages[idx].widgets || [], pageCount: layout.pages.length };
  }
  return { widgets: layout.widgets || [], pageCount: 1 };
}

function renderPageIndicator(layout) {
  let indicator = document.getElementById('page-indicator');
  const hasPages = layout.pages && layout.pages.length > 1;
  if (!hasPages) {
    if (indicator) indicator.style.display = 'none';
    return;
  }
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'page-indicator';
    indicator.style.cssText = 'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);display:flex;gap:7px;z-index:100;pointer-events:none;';
    document.body.appendChild(indicator);
  }
  indicator.style.display = 'flex';
  indicator.innerHTML = '';
  const count = layout.pages.length;
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('span');
    dot.style.cssText = `width:7px;height:7px;border-radius:50%;background:${i === currentPageIndex ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.25)'};transition:background 0.3s,transform 0.3s;${i === currentPageIndex ? 'transform:scale(1.3);' : ''}`;
    indicator.appendChild(dot);
  }
}

function applyLayout(layout, ctx) {
  if (!layout) return;
  lastLayout = layout;
  if (ctx) lastCtx = { ...ctx, performanceProfile: resolvePerformanceProfile(ctx.performanceProfile) };
  document.documentElement.lang = (lastCtx.locale || 'ko-KR').split('-')[0];

  const { widgets: pageWidgets, pageCount } = getPageWidgets(layout);
  const page = (layout.pages && layout.pages[Math.min(currentPageIndex, layout.pages.length - 1)]) || layout;
  document.body.style.background = page.background || layout.background || '#0b0f19';
  applyGridContainer(stage, page);

  // clean up any running widget timers before wiping the DOM
  stage.querySelectorAll('.widget-content').forEach((c) => c._cleanup?.());
  stage.innerHTML = '';

  for (const w of pageWidgets) {
    const node = document.createElement('div');
    node.className = 'widget';
    node.dataset.type = w.type;
    if (widgets[w.type]?.backgroundLayer) node.dataset.backgroundLayer = 'true';
    applyGridItem(node, w);
    const content = document.createElement('div');
    content.className = 'widget-content' + (w.transparentBg ? ' transparent-bg' : '');
    node.appendChild(content);
    stage.appendChild(node);
    // widgetId + deviceToken let a widget address itself in a runtime write-back
    // call (e.g. paneo.todo's tap-to-toggle) — the display only ever knows its
    // own pairing token, never the internal device id.
    renderWidget(content, w.type, w.config, { ...lastCtx, widgetId: w.id, deviceToken: token });
    applyCustomCss(content, w.customCss);
  }

  renderPageIndicator(layout);

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ layout, ctx: lastCtx }));
  } catch { /* quota */ }
}

// offline resilience: paint the last known layout immediately (docs/design.md §6)
try {
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) { const c = JSON.parse(cached); applyLayout(c.layout, c.ctx); }
} catch { /* ignore */ }

// §7/D17: fetch + register third-party plugins in the background — deliberately
// NOT awaited before the cached-layout paint above, or an unreachable server
// (the exact "offline" case §6 exists to survive) would stall the first paint.
// If the cache held a plugin widget, it shows "? type" for a moment, then this
// repaint (once plugins are registered) fills it in.
loadPlugins()
  .catch((err) => console.error('[plugins] load failed', err))
  .finally(() => { if (lastLayout) applyLayout(lastLayout, lastCtx); });

function setStatus(text, cls, fade) {
  statusEl.textContent = text;
  statusEl.className = cls;
  statusEl.style.opacity = '1';
  if (fade) setTimeout(() => (statusEl.style.opacity = '0'), 2000);
}

// remote "화면 확인" command (§M2) — briefly overlay the device name so an admin
// can tell which physical screen this is when several are running at once.
let identifyTimer = null;
function showIdentify(name) {
  const el = document.getElementById('identify-overlay');
  el.textContent = name || '?';
  el.classList.remove('hidden');
  clearTimeout(identifyTimer);
  identifyTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

// Remote-update progress (docs/design.md D#), broadcast by the server
// whenever it changes (src/server.js setUpdateStatus) — best-effort, since
// the kiosk browser itself gets killed and relaunched partway through an
// "all"-mode update anyway (this banner just covers the window before that
// happens: agent/codec update, before the kiosk restart step). Always
// bilingual, same reasoning as the connection-status pill.
let updateBannerTimer = null;
function showUpdateStatus(status, mode) {
  const el = document.getElementById('update-status-banner');
  if (!el) return;
  clearTimeout(updateBannerTimer);
  const modeLabel = mode === 'server' ? 'server · 서버' : 'all · 전체';
  if (status === 'running') {
    el.textContent = `⏳ Updating… · 업데이트 중… (${modeLabel})`;
    el.className = 'visible running';
  } else if (status === 'done') {
    el.textContent = '✓ Update complete · 업데이트 완료';
    el.className = 'visible done';
    updateBannerTimer = setTimeout(() => el.classList.remove('visible'), 6000);
  } else if (status === 'failed') {
    el.textContent = '✗ Update failed · 업데이트 실패';
    el.className = 'visible failed';
    updateBannerTimer = setTimeout(() => el.classList.remove('visible'), 8000);
  } else {
    el.className = '';
  }
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?role=display&token=${encodeURIComponent(token)}`);
  // Always bilingual — unlike widget content (which follows the device's
  // configured locale), this status pill is the one piece of UI an installer
  // sees before any layout/locale has ever loaded, so it can't rely on that
  // locale to be readable.
  ws.onopen = () => setStatus('● Connected · 연결됨', 'online', true);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'layout.set') {
      applyLayout(msg.layout, { locale: msg.locale, timezone: msg.timezone, performanceProfile: msg.performanceProfile });
    } else if (msg.type === 'command' && msg.action === 'reload') {
      location.reload();
    } else if (msg.type === 'command' && msg.action === 'identify') {
      showIdentify(msg.deviceName);
    } else if (msg.type === 'update.status') {
      showUpdateStatus(msg.status, msg.mode);
    }
  };
  ws.onclose = () => { setStatus('○ Reconnecting… · 재연결 중…', 'offline', false); setTimeout(connect, 2000); };
  ws.onerror = () => ws.close();
}
connect();

window.addEventListener('resize', () => applyLayout(lastLayout));

// ---- Page navigation (swipe/drag + keyboard) ----
function switchDisplayPage(delta) {
  if (!lastLayout || !lastLayout.pages || lastLayout.pages.length <= 1) return;
  const count = lastLayout.pages.length;
  currentPageIndex = (currentPageIndex + delta + count) % count;
  applyLayout(lastLayout);
}

// Swipe-to-switch-page — works for mouse and touch alike (see shared/swipe.js;
// there is no separate touch-only fallback here, since Pointer Events already
// fire for touch input and a second listener set would double-advance pages
// on every real swipe).
attachSwipeNavigation(document, (dir) => switchDisplayPage(dir));

// Keyboard navigation
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') switchDisplayPage(-1);
  else if (e.key === 'ArrowRight') switchDisplayPage(1);
});
