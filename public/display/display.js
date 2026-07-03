import { renderWidget } from '/shared/widgets.js';
import { applyGridContainer, applyGridItem } from '/shared/gridlayout.js';

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

function applyLayout(layout, ctx) {
  if (!layout) return;
  lastLayout = layout;
  if (ctx) lastCtx = { ...ctx, performanceProfile: resolvePerformanceProfile(ctx.performanceProfile) };
  document.documentElement.lang = (lastCtx.locale || 'ko-KR').split('-')[0];
  document.body.style.background = layout.background || '#0b0f19';
  applyGridContainer(stage, layout);

  // clean up any running widget timers before wiping the DOM
  stage.querySelectorAll('.widget-content').forEach((c) => c._cleanup?.());
  stage.innerHTML = '';

  for (const w of layout.widgets || []) {
    const node = document.createElement('div');
    node.className = 'widget';
    applyGridItem(node, w);
    const content = document.createElement('div');
    content.className = 'widget-content';
    node.appendChild(content);
    stage.appendChild(node);
    renderWidget(content, w.type, w.config, lastCtx);
  }

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ layout, ctx: lastCtx }));
  } catch { /* quota */ }
}

// offline resilience: paint the last known layout immediately (docs/design.md §6)
try {
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) { const c = JSON.parse(cached); applyLayout(c.layout, c.ctx); }
} catch { /* ignore */ }

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

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?role=display&token=${encodeURIComponent(token)}`);
  ws.onopen = () => setStatus('● 연결됨', 'online', true);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'layout.set') {
      applyLayout(msg.layout, { locale: msg.locale, timezone: msg.timezone, performanceProfile: msg.performanceProfile });
    } else if (msg.type === 'command' && msg.action === 'reload') {
      location.reload();
    } else if (msg.type === 'command' && msg.action === 'identify') {
      showIdentify(msg.deviceName);
    }
  };
  ws.onclose = () => { setStatus('○ 재연결 중…', 'offline', false); setTimeout(connect, 2000); };
  ws.onerror = () => ws.close();
}
connect();

window.addEventListener('resize', () => applyLayout(lastLayout));
