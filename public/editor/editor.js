import { widgets, renderWidget, widgetLabel, fieldLabel, CATEGORY_ORDER, loadPlugins } from '/shared/widgets.js';
import { t, getLang, setLang, LANGS, LOCALES, RESOLUTIONS } from '/editor/i18n.js';
import { effectiveRows, applyGridContainer, applyGridItem, applyCustomCss } from '/shared/gridlayout.js';
import { attachSwipeNavigation } from '/shared/swipe.js';

let device = null;
let layout = null;
// Multi-page layout structure
// layout = { pages: [{ id: string, widgets: [], grid?, background? }], currentPageIndex: number }

// Wraps a legacy flat draft ({grid,background,widgets}, saved before multi-page
// support existed) into the current pages shape, *preserving* its widgets/grid/
// background as page-0 — the one place this migration has to be correct. Every
// device created via src/store.js's defaultLayout() is already pages-shaped, so
// this only actually rewrites something for devices saved before that changed;
// for anything already pages-shaped it's a no-op passthrough.
function migrateToPages(draft) {
  if (draft && Array.isArray(draft.pages) && draft.pages.length) return draft;
  const legacy = draft || {};
  return {
    pages: [{
      id: 'page-0',
      widgets: Array.isArray(legacy.widgets) ? legacy.widgets : [],
      grid: legacy.grid || { cols: 12, rows: 7, gap: 8 },
      background: legacy.background || '#0b0f19',
    }],
    currentPageIndex: 0,
  };
}

function getCurrentPageLayout() {
  if (!layout) return null;
  layout = migrateToPages(layout);
  return layout.pages[layout.currentPageIndex];
}
function addPage() {
  const MAX_PAGES = 5;
  if (layout.pages.length >= MAX_PAGES) return;
  const newId = `page-${layout.pages.length}`;
  layout.pages.push({ id: newId, widgets: [] });
  layout.currentPageIndex = layout.pages.length - 1;
  renderPageSelector();
  render();
  renderInspector();
  scheduleSave();
}
function removeCurrentPage() {
  if (layout.pages.length <= 1) return; // cannot delete last page
  const idx = layout.currentPageIndex;
  layout.pages.splice(idx, 1);
  // adjust current index
  layout.currentPageIndex = Math.max(0, idx - 1);
  renderPageSelector();
  render();
  renderInspector();
  scheduleSave();
}
function switchPage(delta) {
  if (!layout || !layout.pages) return;
  const count = layout.pages.length;
  layout.currentPageIndex = (layout.currentPageIndex + delta + count) % count;
  renderPageSelector();
  render();
  renderInspector();
  scheduleSave();
}
function renderPageSelector() {
  const selector = document.getElementById('page-selector');
  if (!selector) return;
  selector.innerHTML = '';
  // indicator dots
  const dots = document.createElement('div');
  dots.className = 'page-dots';
  layout.pages.forEach((p, i) => {
    const dot = document.createElement('span');
    dot.className = 'page-dot' + (i === layout.currentPageIndex ? ' active' : '');
    dot.title = `Page ${i + 1}`;
    dot.addEventListener('click', () => { layout.currentPageIndex = i; render(); renderInspector(); renderPageSelector(); scheduleSave(); });
    dots.appendChild(dot);
  });
  selector.appendChild(dots);
  // + button
  const addBtn = document.createElement('button');
  addBtn.className = 'page-add';
  addBtn.textContent = '+';
  addBtn.title = 'Add page';
  addBtn.disabled = layout.pages.length >= 5;
  addBtn.addEventListener('click', addPage);
  selector.appendChild(addBtn);
  // – button
  const delBtn = document.createElement('button');
  delBtn.className = 'page-del-btn';
  delBtn.textContent = '−';
  delBtn.title = 'Delete current page';
  delBtn.disabled = layout.pages.length <= 1;
  delBtn.addEventListener('click', removeCurrentPage);
  selector.appendChild(delBtn);
}

let selectedId = null;
let saveTimer = null;

const canvas = document.getElementById('canvas');

// ResizeObserver: sync grid background whenever canvas size changes (e.g., inspector opens/closes)
new ResizeObserver(() => {
  if (getCurrentPageLayout()) repositionNodes();
}).observe(canvas);

const deviceSelect = document.getElementById('device-select');
const deviceAddBtn = document.getElementById('device-add-btn');
const deviceDeleteBtn = document.getElementById('device-delete-btn');
const langSelect = document.getElementById('lang-select');
const localeSelect = document.getElementById('locale-select');
const resolutionSelect = document.getElementById('resolution-select');
const resolutionCustom = document.getElementById('resolution-custom');
const resolutionWInput = document.getElementById('resolution-w');
const resolutionHInput = document.getElementById('resolution-h');
const resolutionRotateBtn = document.getElementById('resolution-rotate');
const perfSelect = document.getElementById('perf-select');
const groupSelect = document.getElementById('group-select');
const groupNewName = document.getElementById('group-new-name');
const groupNewBtn = document.getElementById('group-new-btn');
const groupApplyBtn = document.getElementById('group-apply-btn');
const deviceConnected = document.getElementById('device-connected');
const cmdReloadBtn = document.getElementById('cmd-reload-btn');
const cmdIdentifyBtn = document.getElementById('cmd-identify-btn');
// §M4: companion-agent & power schedule
const agentStatus = document.getElementById('agent-status');
const cmdPowerOnBtn = document.getElementById('cmd-power-on-btn');
const cmdPowerOffBtn = document.getElementById('cmd-power-off-btn');
const cmdUpdateAllBtn = document.getElementById('cmd-update-all-btn');
const cmdUpdateServerBtn = document.getElementById('cmd-update-server-btn');
const powerOnInput = document.getElementById('power-on-time');
const powerOffInput = document.getElementById('power-off-time');
const powerSaveBtn = document.getElementById('power-save-btn');
const powerClearBtn = document.getElementById('power-clear-btn');
const powerScheduleStatus = document.getElementById('power-schedule-status');
const palette = document.getElementById('palette');
const paletteBtn = document.getElementById('palette-btn');
const inspectorBody = document.getElementById('inspector-body');
const saveState = document.getElementById('save-state');
const openDisplay = document.getElementById('open-display');

let groups = [];
let versionManifest = null;

const uid = () => Math.random().toString(36).slice(2, 9);
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // 24-hour HH:MM

function renderPowerScheduleStatus() {
  if (!powerScheduleStatus || !device) return;
  const ps = device.powerSchedule;
  const s = Array.isArray(ps) ? ps[0] : ps;
  const isSet = !!(s?.on || s?.off);
  powerScheduleStatus.textContent = isSet ? t('powerScheduleSet', s.on, s.off) : t('powerScheduleNotSet');
  powerScheduleStatus.className = 'power-schedule-status' + (isSet ? ' set' : '');
}
// `w` is optional context about the widget being rendered — `widgetId` lets a
// widget address itself in a server call (e.g. paneo.todo's tap-to-toggle),
// and `preview: true` tells widgets they're in the editor canvas, not a live
// display, so they should skip any runtime-write behavior tied to a real token.
const ctx = (w) => ({
  locale: device?.locale || 'ko-KR',
  timezone: device?.timezone || undefined,
  performanceProfile: device?.performanceProfile || 'high',
  preview: true,
  widgetId: w?.id,
});

async function api(path, opts = {}) {
  // Only send a JSON content-type when there's actually a body — Fastify's
  // default body parser 400s on an empty body declared as application/json
  // (bit us on the body-less POST /publish call).
  const headers = opts.body ? { 'content-type': 'application/json' } : {};
  const res = await fetch(path, { ...opts, headers: { ...headers, ...opts.headers } });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

// ---- i18n application ----
function applyI18n() {
  document.documentElement.lang = getLang();
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
  saveState.textContent = t('saved');
  applyVersionUI();
  applyUpdateCheckUI();
  buildPalette();
  renderInspector();
}

function applyVersionUI() {
  const tag = document.getElementById('editor-version-tag');
  if (tag && versionManifest?.components?.editor) {
    tag.textContent = `${t('tag')} v${versionManifest.components.editor}`;
  }

  const box = document.getElementById('component-versions');
  if (!box || !versionManifest?.components) return;
  const c = versionManifest.components;
  const agentVer = device?.agentPresent && device.agentVersion ? device.agentVersion : c.agent;
  box.innerHTML = [
    t('versionServer', c.server),
    t('versionEditor', c.editor),
    t('versionDisplay', c.display),
    t('versionAgent', agentVer),
  ].map((line) => `<div>${line}</div>`).join('');
}

async function loadVersions() {
  versionManifest = await api('/api/version');
  applyVersionUI();
}

// Whether a newer release exists on GitHub than what this server is running
// (docs/design.md D#) — informational only, shown next to the update buttons
// so "업데이트 가능한 상태인지" doesn't require blindly running an update to find out.
let updateCheckResult = null;

function applyUpdateCheckUI() {
  const box = document.getElementById('update-check-status');
  if (!box || !updateCheckResult) return;
  if (updateCheckResult.error) {
    box.textContent = t('updateCheckFailed');
    box.className = 'update-check-status';
  } else if (updateCheckResult.updateAvailable) {
    box.textContent = t('updateCheckAvailable', updateCheckResult.latest);
    box.className = 'update-check-status available';
  } else {
    box.textContent = t('updateCheckLatest');
    box.className = 'update-check-status';
  }
}

async function loadUpdateCheck() {
  try {
    updateCheckResult = await api('/api/update-check');
  } catch {
    updateCheckResult = { error: true };
  }
  applyUpdateCheckUI();
}

const CATEGORY_KEY = { basic: 'categoryBasic', data: 'categoryData', media: 'categoryMedia', plugin: 'categoryPlugin' };

function buildPalette() {
  const lang = getLang();
  palette.innerHTML = '';
  const byCategory = new Map();
  for (const [type, def] of Object.entries(widgets)) {
    const cat = def.category || 'basic';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(type);
  }
  for (const cat of CATEGORY_ORDER) {
    const types = byCategory.get(cat);
    if (!types) continue;
    const group = document.createElement('div');
    group.className = 'palette-group';
    const heading = document.createElement('div');
    heading.className = 'palette-heading';
    heading.textContent = t(CATEGORY_KEY[cat] || 'categoryBasic');
    group.appendChild(heading);
    for (const type of types) {
      const b = document.createElement('button');
      b.dataset.add = type;
      b.setAttribute('role', 'menuitem');
      b.innerHTML = `<span class="pw-icon">${widgets[type].icon || ''}</span><span>${widgetLabel(type, lang)}</span>`;
      b.addEventListener('click', () => { addWidget(type); closePalette(); });
      group.appendChild(b);
    }
    palette.appendChild(group);
  }
}

function openPalette() {
  palette.classList.remove('hidden');
  paletteBtn.setAttribute('aria-expanded', 'true');
}
function closePalette() {
  palette.classList.add('hidden');
  paletteBtn.setAttribute('aria-expanded', 'false');
}
function togglePalette() {
  palette.classList.contains('hidden') ? openPalette() : closePalette();
}

function initSelectors() {
  for (const l of LANGS) {
    const o = document.createElement('option');
    o.value = l.code; o.textContent = l.label;
    langSelect.appendChild(o);
  }
  langSelect.value = getLang();
  langSelect.addEventListener('change', () => { setLang(langSelect.value); applyI18n(); });

  for (const l of LOCALES) {
    const o = document.createElement('option');
    o.value = l.code; o.textContent = l.label;
    localeSelect.appendChild(o);
  }
  localeSelect.addEventListener('change', async () => {
    if (!device) return;
    device.locale = localeSelect.value;
    render(); // preview re-formats with new locale immediately
    await api(`/api/devices/${device.id}`, { method: 'PATCH', body: JSON.stringify({ locale: device.locale }) });
  });

  for (const r of RESOLUTIONS) {
    const o = document.createElement('option');
    o.value = `${r.w}x${r.h}`;
    o.textContent = r.label;
    resolutionSelect.appendChild(o);
  }
  const customOpt = document.createElement('option');
  customOpt.value = 'custom';
  customOpt.textContent = t('resolutionCustom');
  resolutionSelect.appendChild(customOpt);

  resolutionSelect.addEventListener('change', () => {
    if (!device) return;
    if (resolutionSelect.value === 'custom') {
      resolutionCustom.classList.remove('hidden');
      resolutionWInput.value = device.resolutionW;
      resolutionHInput.value = device.resolutionH;
      return;
    }
    resolutionCustom.classList.add('hidden');
    const [w, h] = resolutionSelect.value.split('x').map(Number);
    device.resolutionW = w;
    device.resolutionH = h;
    applyCanvasAspectRatio();
    saveResolution();
  });

  let resolutionSaveTimer = null;
  const onCustomResolutionInput = () => {
    if (!device) return;
    device.resolutionW = Math.max(100, Number(resolutionWInput.value) || device.resolutionW);
    device.resolutionH = Math.max(100, Number(resolutionHInput.value) || device.resolutionH);
    applyCanvasAspectRatio();
    clearTimeout(resolutionSaveTimer);
    resolutionSaveTimer = setTimeout(saveResolution, 400);
  };
  resolutionWInput.addEventListener('input', onCustomResolutionInput);
  resolutionHInput.addEventListener('input', onCustomResolutionInput);

  resolutionRotateBtn.addEventListener('click', () => {
    if (!device) return;
    [device.resolutionW, device.resolutionH] = [device.resolutionH, device.resolutionW];
    syncResolutionUI();
    applyCanvasAspectRatio();
    saveResolution();
  });

  for (const [value, key] of [['high', 'perfHigh'], ['low', 'perfLow'], ['auto', 'perfAuto']]) {
    const o = document.createElement('option');
    o.value = value; o.textContent = t(key);
    perfSelect.appendChild(o);
  }
  perfSelect.addEventListener('change', async () => {
    if (!device) return;
    device.performanceProfile = perfSelect.value;
    render(); // widgets re-render with the new ctx().performanceProfile immediately
    await api(`/api/devices/${device.id}`, { method: 'PATCH', body: JSON.stringify({ performanceProfile: device.performanceProfile }) });
  });

  groupSelect.addEventListener('change', async () => {
    if (!device) return;
    device.groupId = groupSelect.value || null;
    await api(`/api/devices/${device.id}`, { method: 'PATCH', body: JSON.stringify({ groupId: device.groupId }) });
  });
  groupNewBtn.addEventListener('click', async () => {
    const name = groupNewName.value.trim();
    if (!name || !device) return;
    const g = await api('/api/groups', { method: 'POST', body: JSON.stringify({ name }) });
    groups.push(g);
    groupNewName.value = '';
    populateGroupSelect();
    groupSelect.value = g.id;
    device.groupId = g.id;
    await api(`/api/devices/${device.id}`, { method: 'PATCH', body: JSON.stringify({ groupId: g.id }) });
  });
  groupApplyBtn.addEventListener('click', async () => {
    if (!device) return;
    if (!device.groupId) { toast(t('groupNoneToApply')); return; }
    const res = await api(`/api/devices/${device.id}/apply-to-group`, { method: 'POST' });
    toast(t('groupApplied', res.applied));
  });

  cmdReloadBtn.addEventListener('click', () => sendCommand('reload'));
  cmdIdentifyBtn.addEventListener('click', () => sendCommand('identify'));

  // §M4: remote power commands
  if (cmdPowerOnBtn) cmdPowerOnBtn.addEventListener('click', () => sendPower(true));
  if (cmdPowerOffBtn) cmdPowerOffBtn.addEventListener('click', () => sendPower(false));

  // Remote update trigger (agent-relayed — docs/design.md D#)
  if (cmdUpdateAllBtn) cmdUpdateAllBtn.addEventListener('click', () => {
    if (!confirm(t('updateHint'))) return;
    sendUpdate('all');
  });
  if (cmdUpdateServerBtn) cmdUpdateServerBtn.addEventListener('click', () => {
    if (!confirm(t('updateHint'))) return;
    sendUpdate('server');
  });

  // §M4: power schedule save / clear
  if (powerSaveBtn) powerSaveBtn.addEventListener('click', async () => {
    if (!device) return;
    const on = powerOnInput.value.trim();
    const off = powerOffInput.value.trim();
    // Plain text HH:MM inputs (not <input type=time>) so the displayed format
    // is always 24-hour regardless of the browser/OS locale, matching how
    // paneo.timer's inspector fields already avoid the native time picker's
    // locale-dependent (12h/AM-PM in some locales) rendering.
    if ((on && !HHMM_RE.test(on)) || (off && !HHMM_RE.test(off))) {
      toast(t('powerTimeInvalid'));
      return;
    }
    const schedule = (on || off) ? [{ on: on || null, off: off || null }] : null;
    device.powerSchedule = schedule;
    await api(`/api/devices/${device.id}`, { method: 'PATCH', body: JSON.stringify({ powerSchedule: schedule }) });
    renderPowerScheduleStatus();
    toast(t('powerSaved'));
  });
  if (powerClearBtn) powerClearBtn.addEventListener('click', async () => {
    if (!device) return;
    device.powerSchedule = null;
    powerOnInput.value = '';
    powerOffInput.value = '';
    await api(`/api/devices/${device.id}`, { method: 'PATCH', body: JSON.stringify({ powerSchedule: null }) });
    renderPowerScheduleStatus();
    toast(t('powerSaved'));
  });

  deviceAddBtn.addEventListener('click', async () => {
    const name = prompt(t('devicePrompt'));
    if (!name) return;
    const d = await api('/api/devices', { method: 'POST', body: JSON.stringify({ name }) });
    await loadDevices(d.id);
  });
  deviceDeleteBtn.addEventListener('click', async () => {
    if (!device) return;
    if (!confirm(t('deleteConfirm', device.name))) return;
    await api(`/api/devices/${device.id}`, { method: 'DELETE' });
    device = null;
    await loadDevices();
  });
}

async function sendCommand(action) {
  if (!device) return;
  const res = await api(`/api/devices/${device.id}/command`, { method: 'POST', body: JSON.stringify({ action }) });
  toast(res.displays > 0 ? t('cmdSent') : t('cmdNoDisplay'));
}

// §M4: send power on/off to the companion agent via the server
async function sendPower(on) {
  if (!device) return;
  const res = await api(`/api/devices/${device.id}/command`, { method: 'POST', body: JSON.stringify({ action: 'power', on }) });
  if (res.agentPresent) {
    toast(on ? t('powerOnSent') : t('powerOffSent'));
  } else {
    toast(t('powerNoAgent'));
  }
}

// Remote update trigger — agent-relayed, like sendPower() (docs/design.md D#).
// mode: 'all' (server+agent+kiosk) or 'server' (Docker image + agent only).
async function sendUpdate(mode) {
  if (!device) return;
  const res = await api(`/api/devices/${device.id}/command`, { method: 'POST', body: JSON.stringify({ action: 'update', mode }) });
  toast(res.agentPresent ? t('updateSent') : t('updateNoAgent'));
}

function populateGroupSelect() {
  groupSelect.innerHTML = '';
  const none = document.createElement('option');
  none.value = ''; none.textContent = t('groupNone');
  groupSelect.appendChild(none);
  for (const g of groups) {
    const o = document.createElement('option');
    o.value = g.id; o.textContent = g.name;
    groupSelect.appendChild(o);
  }
}

async function loadGroups() {
  groups = await api('/api/groups');
  populateGroupSelect();
}

// Sync the settings-modal fields that reflect device-level (not layout-level) state.
function syncDeviceMetaUI() {
  perfSelect.value = device.performanceProfile || 'high';
  groupSelect.value = device.groupId || '';
  deviceConnected.textContent = t('connectedCount', device.displays ?? 0);
  // §M4: agent badge
  if (agentStatus) {
    agentStatus.textContent = device.agentPresent
      ? t('agentConnected', device.agentVersion || '')
      : t('agentMissing');
    agentStatus.className = 'agent-badge' + (device.agentPresent ? ' connected' : '');
    agentStatus.title = device.agentPresent ? '' : t('agentMissingTip');
  }
  // §M4: power schedule
  if (powerOnInput && powerOffInput) {
    const ps = device.powerSchedule;
    const s = Array.isArray(ps) ? ps[0] : ps;
    powerOnInput.value = s?.on ?? '';
    powerOffInput.value = s?.off ?? '';
  }
  renderPowerScheduleStatus();
  // §M4: power buttons
  const hasAgent = device.agentPresent ?? false;
  if (cmdPowerOnBtn) { cmdPowerOnBtn.disabled = !hasAgent; cmdPowerOnBtn.title = hasAgent ? '' : t('agentMissingTip'); }
  if (cmdPowerOffBtn) { cmdPowerOffBtn.disabled = !hasAgent; cmdPowerOffBtn.title = hasAgent ? '' : t('agentMissingTip'); }
  if (cmdUpdateAllBtn) { cmdUpdateAllBtn.disabled = !hasAgent; cmdUpdateAllBtn.title = hasAgent ? '' : t('agentMissingTip'); }
  if (cmdUpdateServerBtn) { cmdUpdateServerBtn.disabled = !hasAgent; cmdUpdateServerBtn.title = hasAgent ? '' : t('agentMissingTip'); }
}

function saveResolution() {
  if (!device) return;
  api(`/api/devices/${device.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ resolutionW: device.resolutionW, resolutionH: device.resolutionH }),
  });
}

// Reflect device.resolutionW/H onto the preset dropdown (or "custom" + W/H inputs).
function syncResolutionUI() {
  const match = RESOLUTIONS.find((r) => r.w === device.resolutionW && r.h === device.resolutionH);
  if (match) {
    resolutionSelect.value = `${match.w}x${match.h}`;
    resolutionCustom.classList.add('hidden');
  } else {
    resolutionSelect.value = 'custom';
    resolutionCustom.classList.remove('hidden');
    resolutionWInput.value = device.resolutionW;
    resolutionHInput.value = device.resolutionH;
  }
}

// The editor canvas represents the real device screen — its aspect ratio must
// match the target device's resolution or the WYSIWYG preview lies (docs/design.md
// §14 risk #7 was about proportional scaling; this is the companion concern:
// getting the *shape* right in the first place, not just scaling within it).
function applyCanvasAspectRatio() {
  if (!device) return;
  canvas.style.aspectRatio = `${device.resolutionW} / ${device.resolutionH}`;
}

// ---- device loading ----
async function loadDevices(preferredId) {
  await loadGroups();
  const devices = await api('/api/devices');
  deviceSelect.innerHTML = '';
  for (const d of devices) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    deviceSelect.appendChild(opt);
  }
  if (!devices.length) {
    device = null;
    layout = null;
    render();
    renderInspector();
    return;
  }
  const target = preferredId && devices.some((d) => d.id === preferredId) ? preferredId : devices[0].id;
  await selectDevice(target);
}

async function selectDevice(id) {
  device = await api(`/api/devices/${id}`);
  layout = migrateToPages(device.draft);
  selectedId = null;
  deviceSelect.value = id;
  localeSelect.value = device.locale || 'ko-KR';
  syncResolutionUI();
  applyCanvasAspectRatio();
  syncDeviceMetaUI();
  openDisplay.href = `/d/${device.token}`;
  applyVersionUI();
  render();
  renderInspector();
}

// ---- canvas render ----
// Cell size in px, purely for converting pointer-drag deltas to grid units —
// actual layout/scaling is done by real CSS Grid (applyGridContainer/Item),
// which is what keeps the editor preview and the display in proportional sync.
function cellSize() {
  const pg = getCurrentPageLayout();
  const cols = pg?.grid?.cols || 12;
  const rows = effectiveRows(pg);
  const gap = pg?.grid?.gap ?? 8;
  // clientWidth/Height include the container's own outer padding (applyGridContainer
  // sets padding = gap), so that has to come off before dividing into cell tracks or
  // dragged widgets would drift from the cursor as the canvas gets padding-heavy.
  const cellW = (canvas.clientWidth - gap * 2 - gap * (cols - 1)) / cols;
  const cellH = (canvas.clientHeight - gap * 2 - gap * (rows - 1)) / rows;
  return { cols, rows, gap, cellW, cellH };
}

// Does (x,y,w,h) overlap any other widget? (excludeId lets a widget ignore itself)
function isFree(x, y, w, h, excludeId) {
  const pg = getCurrentPageLayout();
  const cols = pg?.grid?.cols || 12;
  if (x < 0 || y < 0 || x + w > cols) return false;
  const source = pg.widgets.find(o => o.id === excludeId);
  if (source && widgets[source.type]?.backgroundLayer) return true;
  return !pg.widgets.some((o) => {
    if (o.id === excludeId) return false;
    if (widgets[o.type]?.backgroundLayer) return false;
    return x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y;
  });
}

// Straight rect-overlap test shared by the drag collision resolver below.
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Push whatever `sourceId` (the widget under the cursor) now overlaps straight down,
// out of the way — cascading to anything *that* lands on next. Only ever pushes down,
// never sideways or up: keeps the algorithm simple and guaranteed to terminate, since
// every push strictly increases a widget's y and there are finitely many widgets.
// `effectiveRows` (gridlayout.js) already treats configured rows as a minimum that
// grows to fit content, so a cascade running past the bottom just grows the grid.
function resolveCollisions(layoutWidgets, sourceId) {
  const source = layoutWidgets.find(x => x.id === sourceId);
  if (source && widgets[source.type]?.backgroundLayer) return;
  const queue = [sourceId];
  const queued = new Set(queue);
  let guard = 0;
  while (queue.length && guard++ < 2000) {
    const curId = queue.shift();
    queued.delete(curId);
    const cur = layoutWidgets.find((x) => x.id === curId);
    if (!cur) continue;
    for (const other of layoutWidgets) {
      if (other.id === curId || !rectsOverlap(cur, other)) continue;
      if (widgets[other.type]?.backgroundLayer || widgets[cur.type]?.backgroundLayer) continue;
      const pushedY = cur.y + cur.h;
      if (other.y < pushedY) {
        other.y = pushedY;
        if (!queued.has(other.id)) {
          queue.push(other.id);
          queued.add(other.id);
        }
      }
    }
  }
}

// First free top-left-first cell that fits a new widget of size (w,h) — avoids
// every new widget stacking at (0,0) on top of whatever's already there.
function findFreeCell(w, h) {
  const cols = getCurrentPageLayout()?.grid?.cols || 12;
  for (let y = 0; y < 500; y++) {
    for (let x = 0; x <= cols - w; x++) {
      if (isFree(x, y, w, h)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

function render() {
  const pg = getCurrentPageLayout();
  if (!pg) { canvas.innerHTML = ''; return; }
  // Clean up previous widget content
  canvas.querySelectorAll('.widget-content').forEach((c) => c._cleanup?.());
  canvas.style.backgroundColor = pg.background || '#0b0f19';
  canvas.innerHTML = '';
  applyGridContainer(canvas, pg);
  const { cols, rows, gap, cellW, cellH } = cellSize();
  // Set backgroundSize in pixels so grid lines match CSS Grid cell boundaries exactly,
  // regardless of gap size. Each tile = one cell track + one gap.
  canvas.style.backgroundSize = `${cellW + gap}px ${cellH + gap}px`;
  for (const w of pg.widgets) {
    const node = document.createElement('div');
    node.className = 'ed-widget' + (w.id === selectedId ? ' selected' : '');
    node.dataset.id = w.id;
    node.dataset.type = w.type;
    if (widgets[w.type]?.backgroundLayer) node.dataset.backgroundLayer = 'true';
    applyGridItem(node, w);
    const content = document.createElement('div');
    content.className = 'widget-content' + (w.transparentBg ? ' transparent-bg' : '');
    node.appendChild(content);
    // Attach to the document *before* renderWidget() — some widgets (e.g.
    // paneo.calendar.month) synchronously measure their own box on first
    // render to pick a size-appropriate view without waiting a frame for
    // ResizeObserver. Measuring a still-detached node returns 0x0, which
    // picked the smallest view every time the canvas re-rendered (e.g. on
    // every widget click, since attachDrag's plain-click path calls render()).
    canvas.appendChild(node);
    renderWidget(content, w.type, w.config, ctx(w));
    applyCustomCss(content, w.customCss);
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    node.appendChild(handle);
    attachDrag(node, w, handle);
  }
  renderPageSelector();
}

// Cheap per-pointermove update: reposition existing DOM nodes only — never re-run
// renderWidget() mid-drag, which would restart every widget's timers and re-fire
// data-widget network polls (weather/calendar/etc.) on every mouse pixel moved.
// Full render() still runs once on drop (see attachDrag below).
function repositionNodes() {
  const pg = getCurrentPageLayout();
  if (!pg) return;
  applyGridContainer(canvas, pg); // rows may have grown from a push-down cascade
  const { cols, rows, gap, cellW, cellH } = cellSize();
  canvas.style.backgroundSize = `${cellW + gap}px ${cellH + gap}px`;
  // One bulk query + Map lookups, not one attribute-selector query per widget —
  // this runs on every pointermove tick during drag/resize, so avoiding N
  // separate DOM walks per frame matters once a page has more than a couple
  // of widgets on it.
  const nodesById = new Map();
  canvas.querySelectorAll('.ed-widget').forEach((n) => nodesById.set(n.dataset.id, n));
  for (const o of pg.widgets) {
    const node = nodesById.get(o.id);
    if (node) applyGridItem(node, o);
  }
}

// Page navigation via keyboard arrows
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') {
    switchPage(-1);
  } else if (e.key === 'ArrowRight') {
    switchPage(1);
  }
});

// Swipe-to-switch-page on the canvas (touch only — a mouse drag on empty canvas
// is otherwise unclaimed today, but touch-gating keeps this from ever competing
// with the mouse-based widget move/resize handlers below). Same threshold/ratio
// as the real display (shared/swipe.js) so the editor preview's swipe feel
// actually matches the kiosk.
attachSwipeNavigation(canvas, (dir) => switchPage(dir), { touchOnly: true });

// ---- drag to move / resize (grid-snapped; colliding widgets are pushed down, never overlapped) ----
function attachDrag(node, w, handle) {
  node.addEventListener('pointerdown', (e) => {
    if (e.target === handle) return;
    e.preventDefault();
    selectWidget(w.id);
    const { cellW, cellH, cols } = cellSize();
    const sx = e.clientX, sy = e.clientY, ox = w.x, oy = w.y;
    const snapshot = new Map(getCurrentPageLayout().widgets.filter((o) => o.id !== w.id).map((o) => [o.id, { x: o.x, y: o.y }]));
    node.setPointerCapture(e.pointerId);
    const move = (ev) => {
      w.x = clamp(ox + Math.round((ev.clientX - sx) / cellW), 0, cols - w.w);
      w.y = Math.max(0, oy + Math.round((ev.clientY - sy) / cellH));
      const pgWidgets = getCurrentPageLayout().widgets;
      for (const o of pgWidgets) {
        const s = snapshot.get(o.id);
        if (s) { o.x = s.x; o.y = s.y; }
      }
      resolveCollisions(pgWidgets, w.id);
      repositionNodes();
    };
    const up = () => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      render();
      renderInspector();
      scheduleSave();
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
  });

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectWidget(w.id);
    const { cellW, cellH, cols } = cellSize();
    const sx = e.clientX, sy = e.clientY, ow = w.w, oh = w.h;
    const snapshot = new Map(getCurrentPageLayout().widgets.filter((o) => o.id !== w.id).map((o) => [o.id, { x: o.x, y: o.y }]));
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      w.w = clamp(ow + Math.round((ev.clientX - sx) / cellW), 1, cols - w.x);
      w.h = Math.max(1, oh + Math.round((ev.clientY - sy) / cellH));
      const pgWidgets = getCurrentPageLayout().widgets;
      for (const o of pgWidgets) {
        const s = snapshot.get(o.id);
        if (s) { o.x = s.x; o.y = s.y; }
      }
      resolveCollisions(pgWidgets, w.id);
      repositionNodes();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      render();
      renderInspector();
      scheduleSave();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- selection + inspector ----
function selectWidget(id) {
  selectedId = id;
  canvas.querySelectorAll('.ed-widget').forEach((n) => n.classList.toggle('selected', n.dataset.id === id));
  renderInspector();
}

function renderInspector() {
  const lang = getLang();
  const w = getCurrentPageLayout()?.widgets?.find((x) => x.id === selectedId);
  if (!w) { inspectorBody.innerHTML = `<p class="muted">${t('selectHint')}</p>`; return; }
  const def = widgets[w.type];
  const esc = (s) => String(s ?? '').replace(/"/g, '&quot;');
  const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = `<div class="field"><label>${t('type')}</label><div class="val">${widgetLabel(w.type, lang)}</div></div>`;

  // §M3: minSize warning — shown if widget is smaller than its declared minimum
  const minW = def?.minSize?.w ?? 1;
  const minH = def?.minSize?.h ?? 1;
  if (w.w < minW || w.h < minH) {
    html += `<p class="min-size-warn">${t('minSizeWarn', `${minW}×${minH}`)}</p>`;
  }

  const meta = [
    def?.version ? `${t('version')}: ${def.version}` : '',
    ...(def?.requires || []).map((x) => `${t('requires')}: ${x}`),
    ...(def?.permissions || []).map((x) => `${t('permission')}: ${x}`),
    def?.sandbox ? `${t('sandbox')}: ${def.sandbox}` : '',
  ].filter(Boolean);
  if (meta.length) {
    html += `<div class="widget-meta">${meta.map((x) => `<span>${escHtml(x)}</span>`).join('')}</div>`;
  }
  if (def?.sandbox === 'iframe') {
    html += `<p class="plugin-sandbox-note">${t('sandboxNote')}</p>`;
  }

  html += `<div class="grid2">
    <label>X<input type="number" data-prop="x" value="${w.x}" min="0"></label>
    <label>Y<input type="number" data-prop="y" value="${w.y}" min="0"></label>
    <label>W<input type="number" data-prop="w" value="${w.w}" min="1"></label>
    <label>H<input type="number" data-prop="h" value="${w.h}" min="1"></label>
  </div>`;
  for (const c of def?.config || []) {
    // Conditional fields (e.g. paneo.photo's per-source options): skip entirely
    // when the controlling field's current value doesn't match. Re-rendered
    // reactively below whenever that controlling field changes.
    if (c.showIf && (w.config?.[c.showIf.key] ?? '') !== c.showIf.equals) continue;
    if (c.type === 'checkbox') {
      // Fall back to the field's own default when the key is absent from a
      // widget's saved config (e.g. a widget saved before a new checkbox
      // field with default:true was added) — reading only w.config?.[c.key]
      // would show unchecked even though the widget itself treats a missing
      // key as its default (true), misrepresenting the actually-applied state.
      const checked = w.config?.[c.key] ?? c.default;
      html += `<div class="field check"><label><input type="checkbox" data-config="${c.key}" ${checked ? 'checked' : ''}> ${fieldLabel(c, lang)}</label></div>`;
    } else if (c.type === 'number') {
      html += `<div class="field"><label>${fieldLabel(c, lang)}</label><input type="number" data-config="${c.key}" data-config-type="number" value="${esc(w.config?.[c.key])}"></div>`;
    } else if (c.type === 'textarea') {
      html += `<div class="field"><label>${fieldLabel(c, lang)}</label><textarea data-config="${c.key}" rows="4">${esc(w.config?.[c.key])}</textarea></div>`;
    } else if (c.type === 'list') {
      const configArr = w.config?.[c.key];
      const arr = (Array.isArray(configArr) && configArr.length > 0) ? configArr : [''];
      const ph = c.placeholder ? (c.placeholder[lang] || c.placeholder.ko || c.placeholder) : '';
      let rows;
      if (c.key === 'icsUrls') {
        const colorOptions = [
          ['', t('colorDefault')],
          ['#ef4444', t('colorRed')],
          ['#f97316', t('colorOrange')],
          ['#eab308', t('colorYellow')],
          ['#22c55e', t('colorGreen')],
          ['#3b82f6', t('colorBlue')],
          ['#a855f7', t('colorPurple')],
        ];
        rows = arr.map((val, i) => {
          const [urlVal, colorVal = ''] = String(val || '').split('|');
          const colorOpts = colorOptions.map(([cVal, cLabel]) =>
            `<option value="${cVal}" ${colorVal === cVal ? 'selected' : ''}>${cLabel}</option>`
          ).join('');
          return `
            <div class="list-row ics-list-row" data-list-key="${c.key}" data-list-index="${i}">
              <input type="text" class="ics-url-input" value="${esc(urlVal)}" placeholder="${esc(ph)}">
              <select class="ics-color-select" style="width: 80px; flex: 0 0 auto; margin-left: 4px; padding: 4px; border: 1px solid #232a38; border-radius: 6px; background: #161b26; color: inherit; font-size: 12px;">${colorOpts}</select>
              <button type="button" class="list-remove" data-list-key="${c.key}" data-list-index="${i}">×</button>
            </div>`;
        }).join('');
      } else {
        rows = arr.map((val, i) => `
          <div class="list-row">
            <input type="text" data-list-key="${c.key}" data-list-index="${i}" value="${esc(val)}" placeholder="${esc(ph)}">
            <button type="button" class="list-remove" data-list-key="${c.key}" data-list-index="${i}">×</button>
          </div>`).join('');
      }
      html += `<div class="field"><label>${fieldLabel(c, lang)}</label>
        <div class="list-field">${rows}
          <button type="button" class="list-add" data-list-key="${c.key}">${t('addItem')}</button>
        </div></div>`;
    } else if (c.type === 'enum') {
      // §M3: enum type — rendered as <select> in the inspector
      const cur = w.config?.[c.key] ?? c.default ?? '';
      const opts = (c.options || []).map((opt) =>
        `<option value="${esc(opt)}" ${cur === opt ? 'selected' : ''}>${opt}</option>`
      ).join('');
      html += `<div class="field"><label>${fieldLabel(c, lang)}</label><select data-config="${c.key}">${opts}</select></div>`;
    } else if (c.type === 'timerList') {
      // One structured row per entry (paneo.timer) — native <input type=time> pickers
      // instead of a hand-typed "label|HH:MM|showAt|hideAt" string in one box.
      const configArr = w.config?.[c.key];
      const arr = (Array.isArray(configArr) && configArr.length > 0) ? configArr : [{}];
      const rows = arr.map((entry, i) => {
        const e = entry && typeof entry === 'object' ? entry : {};
        return `<div class="timer-entry-row" data-timer-key="${c.key}" data-timer-index="${i}">
          <input type="text" data-timer-field="label" placeholder="${t('timerFieldLabel')}" value="${esc(e.label)}">
          <div class="timer-entry-grid">
            <label>${t('timerFieldTime')}<input type="text" placeholder="HH:MM:SS" data-timer-field="time" value="${esc(e.time)}"></label>
            <label>${t('timerFieldShowAt')}<input type="text" placeholder="HH:MM:SS" data-timer-field="showAt" value="${esc(e.showAt)}"></label>
            <label>${t('timerFieldHideAt')}<input type="text" placeholder="HH:MM:SS" data-timer-field="hideAt" value="${esc(e.hideAt)}"></label>
          </div>
          <button type="button" class="timer-entry-remove" data-timer-key="${c.key}" data-timer-index="${i}">${t('delete')}</button>
        </div>`;
      }).join('');
      html += `<div class="field"><label>${fieldLabel(c, lang)}</label>
        <div class="timer-entry-list">${rows}
          <button type="button" class="timer-entry-add" data-timer-key="${c.key}">${t('addItem')}</button>
        </div></div>`;
    } else if (c.type === 'structList') {
      // Generic structured-row list: each sub-field (declared in c.fields) gets its
      // own input, instead of cramming multiple values into one pipe-delimited string
      // (e.g. paneo.worldclock's label+timezone, paneo.dday's label+date, paneo.todo's
      // done+text). Mirrors paneo.timer's timerList UX without duplicating its code —
      // timerList stays untouched since paneo.timer's shape is the user's own design.
      const configArr = w.config?.[c.key];
      const emptyEntry = {};
      (c.fields || []).forEach((f) => { emptyEntry[f.key] = f.type === 'checkbox' ? false : ''; });
      const arr = (Array.isArray(configArr) && configArr.length > 0) ? configArr : [emptyEntry];
      const rows = arr.map((entry, i) => {
        const e = entry && typeof entry === 'object' ? entry : {};
        const fieldsHtml = (c.fields || []).map((f) => {
          const val = e[f.key];
          const ph = f.placeholder ? (f.placeholder[lang] || f.placeholder.ko || f.placeholder) : '';
          if (f.type === 'checkbox') {
            return `<label class="struct-check"><input type="checkbox" data-struct-field="${f.key}" ${val ? 'checked' : ''}> ${fieldLabel(f, lang)}</label>`;
          }
          const inputType = f.type === 'date' ? 'date' : 'text';
          return `<label class="struct-field">${fieldLabel(f, lang)}<input type="${inputType}" data-struct-field="${f.key}" placeholder="${esc(ph)}" value="${esc(val)}"></label>`;
        }).join('');
        return `<div class="struct-list-row" data-struct-key="${c.key}" data-struct-index="${i}">
          <div class="struct-list-fields">${fieldsHtml}</div>
          <button type="button" class="struct-list-remove" data-struct-key="${c.key}" data-struct-index="${i}">${t('delete')}</button>
        </div>`;
      }).join('');
      html += `<div class="field"><label>${fieldLabel(c, lang)}</label>
        <div class="struct-list">${rows}
          <button type="button" class="struct-list-add" data-struct-key="${c.key}">${t('addItem')}</button>
        </div></div>`;
    } else if (c.type === 'fileManager') {
      // paneo.photo "local" source: browse/upload/delete files under data/photos on
      // the server. The file list itself is server-global (not tied to w.config[c.key]),
      // populated asynchronously by setupFileManager() below since renderInspector()
      // builds this HTML synchronously — but *which* files this widget instance shows
      // is per-widget, via the checkbox selection stored at w.config[c.selectionKey].
      html += `<div class="field"><label>${fieldLabel(c, lang)}</label>
        <div class="file-manager" data-file-key="${c.key}" data-selection-key="${c.selectionKey || ''}">
          <input type="file" class="file-manager-input" multiple accept="image/*,video/*" hidden>
          <button type="button" class="file-manager-upload-btn">${t('fileUploadBtn')}</button>
          <div class="file-manager-list">${t('loading')}</div>
          ${c.selectionKey ? `<p class="field-hint">${t('fileManagerSelectionHint')}</p>` : ''}
        </div>
      </div>`;
    } else {
      html += `<div class="field"><label>${fieldLabel(c, lang)}</label><input type="text" data-config="${c.key}" value="${esc(w.config?.[c.key])}"></div>`;
    }
  }
  // Generic per-instance style override (docs/design.md D16) — not part of the
  // widget's own config schema, so it lives outside the `def.config` loop above,
  // next to the x/y/w/h fields that are likewise generic to every widget type.
  html += `<div class="field check"><label><input type="checkbox" id="widget-transparent-bg" ${w.transparentBg ? 'checked' : ''}> ${t('transparentBgLabel')}</label></div>`;
  html += `<div class="field"><label>${t('customCssLabel')}</label>
    <textarea id="custom-css-input" rows="4" placeholder="border-radius:12px; opacity:.9;">${escHtml(w.customCss || '')}</textarea>
    <p class="field-hint">${t('customCssHint')}</p>
  </div>`;

  html += `<button id="del-widget" class="danger">${t('delete')}</button>`;
  inspectorBody.innerHTML = html;

  const transparentBgCheckbox = inspectorBody.querySelector('#widget-transparent-bg');
  if (transparentBgCheckbox) {
    transparentBgCheckbox.addEventListener('change', (e) => {
      w.transparentBg = e.target.checked;
      const node = canvas.querySelector(`.ed-widget[data-id="${w.id}"] .widget-content`);
      if (node) {
        if (w.transparentBg) {
          node.classList.add('transparent-bg');
        } else {
          node.classList.remove('transparent-bg');
        }
      }
      scheduleSave();
    });
  }

  inspectorBody.querySelectorAll('[data-prop]').forEach((inp) =>
    inp.addEventListener('input', () => {
      w[inp.dataset.prop] = Math.max(inp.min ? Number(inp.min) : 0, parseInt(inp.value) || 0);
      render();
      scheduleSave();
    })
  );
  // Fields whose value some other field's `showIf` depends on — changing one of
  // these needs a full renderInspector() rebuild, not just a live widget re-render,
  // or newly-(ir)relevant conditional fields wouldn't appear/disappear.
  const controllingKeys = new Set((def?.config || []).filter((f) => f.showIf).map((f) => f.showIf.key));
  inspectorBody.querySelectorAll('[data-config]').forEach((inp) =>
    inp.addEventListener('input', () => {
      w.config = w.config || {};
      const v = inp.type === 'checkbox' ? inp.checked
        : inp.dataset.configType === 'number' ? Number(inp.value) || 0
        : inp.value;
      w.config[inp.dataset.config] = v;
      const node = canvas.querySelector(`.ed-widget[data-id="${w.id}"] .widget-content`);
      if (node) renderWidget(node, w.type, w.config, ctx(w));
      scheduleSave();
      if (controllingKeys.has(inp.dataset.config)) renderInspector();
    })
  );
  inspectorBody.querySelectorAll('[data-list-index]').forEach((inp) => {
    if (inp.tagName !== 'INPUT') return;
    inp.addEventListener('input', () => {
      const arr = w.config[inp.dataset.listKey];
      arr[Number(inp.dataset.listIndex)] = inp.value;
      const node = canvas.querySelector(`.ed-widget[data-id="${w.id}"] .widget-content`);
      if (node) renderWidget(node, w.type, w.config, ctx(w));
      scheduleSave();
    });
  });
  inspectorBody.querySelectorAll('.ics-list-row').forEach((row) => {
    const key = row.dataset.listKey;
    const index = Number(row.dataset.listIndex);
    const urlInput = row.querySelector('.ics-url-input');
    const colorSelect = row.querySelector('.ics-color-select');
    const updateVal = () => {
      const u = urlInput.value.trim();
      const c = colorSelect.value;
      w.config[key][index] = c ? `${u}|${c}` : u;
      const node = canvas.querySelector(`.ed-widget[data-id="${w.id}"] .widget-content`);
      if (node) renderWidget(node, w.type, w.config, ctx(w));
      scheduleSave();
    };
    urlInput.addEventListener('input', updateVal);
    colorSelect.addEventListener('change', updateVal);
  });
  inspectorBody.querySelectorAll('[data-struct-field]').forEach((inp) => {
    const row = inp.closest('[data-struct-index]');
    const eventName = inp.type === 'checkbox' ? 'change' : 'input';
    inp.addEventListener(eventName, () => {
      const arr = w.config[row.dataset.structKey];
      const i = Number(row.dataset.structIndex);
      if (typeof arr[i] !== 'object' || arr[i] === null) arr[i] = {};
      arr[i][inp.dataset.structField] = inp.type === 'checkbox' ? inp.checked : inp.value;
      const node = canvas.querySelector(`.ed-widget[data-id="${w.id}"] .widget-content`);
      if (node) renderWidget(node, w.type, w.config, ctx(w));
      scheduleSave();
    });
  });
  inspectorBody.querySelectorAll('.struct-list-remove').forEach((btn) =>
    btn.addEventListener('click', () => {
      w.config[btn.dataset.structKey].splice(Number(btn.dataset.structIndex), 1);
      renderInspector(); // row removed -> structural change, rebuild this field's rows
      const node = canvas.querySelector(`.ed-widget[data-id="${w.id}"] .widget-content`);
      if (node) renderWidget(node, w.type, w.config, ctx(w));
      scheduleSave();
    })
  );
  inspectorBody.querySelectorAll('.struct-list-add').forEach((btn) =>
    btn.addEventListener('click', () => {
      const key = btn.dataset.structKey;
      const fieldDef = (def?.config || []).find((f) => f.key === key);
      const emptyEntry = {};
      (fieldDef?.fields || []).forEach((f) => { emptyEntry[f.key] = f.type === 'checkbox' ? false : ''; });
      if (!Array.isArray(w.config[key])) w.config[key] = [];
      w.config[key].push(emptyEntry);
      renderInspector(); // new empty row -> structural change, rebuild
      scheduleSave();
    })
  );
  inspectorBody.querySelectorAll('.list-remove').forEach((btn) =>
    btn.addEventListener('click', () => {
      w.config[btn.dataset.listKey].splice(Number(btn.dataset.listIndex), 1);
      renderInspector(); // row removed -> structural change, rebuild this field's rows
      const node = canvas.querySelector(`.ed-widget[data-id="${w.id}"] .widget-content`);
      if (node) renderWidget(node, w.type, w.config, ctx(w));
      scheduleSave();
    })
  );
  inspectorBody.querySelectorAll('.list-add').forEach((btn) =>
    btn.addEventListener('click', () => {
      const key = btn.dataset.listKey;
      // `|| []` only catches falsy — a leftover non-array value from an older config
      // shape (e.g. the pre-M1 newline-string photo urls field) is truthy and has no
      // .push, so it must be checked explicitly rather than just falsy-coalesced.
      if (!Array.isArray(w.config[key])) w.config[key] = [];
      w.config[key].push('');
      renderInspector(); // new empty row -> structural change, rebuild
      scheduleSave();
    })
  );
  inspectorBody.querySelectorAll('[data-timer-field]').forEach((inp) => {
    const row = inp.closest('[data-timer-index]');
    const eventName = inp.tagName === 'SELECT' ? 'change' : 'input';
    inp.addEventListener(eventName, () => {
      const arr = w.config[row.dataset.timerKey];
      const i = Number(row.dataset.timerIndex);
      if (typeof arr[i] !== 'object' || arr[i] === null) arr[i] = {};
      arr[i][inp.dataset.timerField] = inp.value;
      const node = canvas.querySelector(`.ed-widget[data-id="${w.id}"] .widget-content`);
      if (node) renderWidget(node, w.type, w.config, ctx(w));
      scheduleSave();
    });
  });
  inspectorBody.querySelectorAll('.timer-entry-remove').forEach((btn) =>
    btn.addEventListener('click', () => {
      w.config[btn.dataset.timerKey].splice(Number(btn.dataset.timerIndex), 1);
      renderInspector(); // row removed -> structural change, rebuild this field's rows
      const node = canvas.querySelector(`.ed-widget[data-id="${w.id}"] .widget-content`);
      if (node) renderWidget(node, w.type, w.config, ctx(w));
      scheduleSave();
    })
  );
  inspectorBody.querySelectorAll('.timer-entry-add').forEach((btn) =>
    btn.addEventListener('click', () => {
      const key = btn.dataset.timerKey;
      if (!Array.isArray(w.config[key])) w.config[key] = [];
      w.config[key].push({ label: '', time: '', showAt: '', hideAt: '' });
      renderInspector(); // new empty row -> structural change, rebuild
      scheduleSave();
    })
  );
  inspectorBody.querySelectorAll('.file-manager').forEach((box) => setupFileManager(box, w));
  inspectorBody.querySelector('#custom-css-input').addEventListener('input', (e) => {
    w.customCss = e.target.value;
    const node = canvas.querySelector(`.ed-widget[data-id="${w.id}"] .widget-content`);
    if (node) applyCustomCss(node, w.customCss);
    scheduleSave();
  });

  inspectorBody.querySelector('#del-widget').addEventListener('click', () => {
    const pg = getCurrentPageLayout();
    if (pg) {
      pg.widgets = pg.widgets.filter((x) => x.id !== selectedId);
    }
    selectedId = null;
    render();
    renderInspector();
    scheduleSave();
  });
}

// paneo.photo "local" source manager: lists files already on the server, lets the
// user upload/delete them (server-global, data/photos — shared by every "local"
// widget), and — when the field declares a selectionKey — lets *this* widget
// instance pick which of those shared files it actually shows, via
// w.config[selectionKey] (an array of filenames; empty means "show everything").
function setupFileManager(box, w) {
  const listEl = box.querySelector('.file-manager-list');
  const input = box.querySelector('.file-manager-input');
  const uploadBtn = box.querySelector('.file-manager-upload-btn');
  const selectionKey = box.dataset.selectionKey || '';

  async function refresh() {
    listEl.textContent = t('loading');
    try {
      const files = await api('/api/proxy/photos/local');
      if (!files.length) {
        listEl.innerHTML = `<p class="muted">${t('fileManagerEmpty')}</p>`;
        return;
      }
      const selected = selectionKey && Array.isArray(w.config?.[selectionKey]) ? w.config[selectionKey] : [];
      listEl.innerHTML = files.map((url) => {
        const name = decodeURIComponent(url.split('/').pop());
        const thumb = /\.(mp4|webm|mov|m4v|ogv)$/i.test(name)
          ? `<video src="${url}" muted></video>`
          : `<img src="${url}" alt="">`;
        const checkbox = selectionKey
          ? `<label class="file-manager-select"><input type="checkbox" data-filename="${escHtmlStandalone(name)}" ${selected.includes(name) ? 'checked' : ''}></label>`
          : '';
        return `<div class="file-manager-item">
          ${thumb}
          ${checkbox}
          <span class="file-manager-name">${escHtmlStandalone(name)}</span>
          <button type="button" class="file-manager-delete" data-filename="${encodeURIComponent(name)}">×</button>
        </div>`;
      }).join('');
      listEl.querySelectorAll('.file-manager-delete').forEach((btn) =>
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await api(`/api/proxy/photos/local/file/${btn.dataset.filename}`, { method: 'DELETE' });
          } catch { /* file already gone or request failed — refresh() below shows current state either way */ }
          refresh();
        })
      );
      if (selectionKey) {
        listEl.querySelectorAll('.file-manager-select input').forEach((cb) =>
          cb.addEventListener('change', () => {
            w.config = w.config || {};
            if (!Array.isArray(w.config[selectionKey])) w.config[selectionKey] = [];
            const arr = w.config[selectionKey];
            const name = cb.dataset.filename;
            const i = arr.indexOf(name);
            if (cb.checked && i === -1) arr.push(name);
            else if (!cb.checked && i !== -1) arr.splice(i, 1);
            const node = canvas.querySelector(`.ed-widget[data-id="${w.id}"] .widget-content`);
            if (node) renderWidget(node, w.type, w.config, ctx(w));
            scheduleSave();
          })
        );
      }
    } catch {
      listEl.innerHTML = `<p class="muted">${t('loadFail', '')}</p>`;
    }
  }

  uploadBtn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    if (!input.files.length) return;
    const fd = new FormData();
    for (const f of input.files) fd.append('files', f);
    uploadBtn.disabled = true;
    uploadBtn.textContent = t('uploading');
    try {
      // Not api() — that helper forces a JSON content-type whenever a body is present,
      // which would break the multipart boundary the browser sets for FormData.
      const res = await fetch('/api/proxy/photos/local/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
      toast(t('uploadSuccess'));
    } catch {
      toast(t('uploadFailed'));
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = t('fileUploadBtn');
      input.value = '';
      refresh();
    }
  });

  refresh();
}

// Standalone HTML-escape for the file manager's file names (renderInspector's `escHtml`
// is a local closure variable, out of scope here).
function escHtmlStandalone(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- add widget ----
function addWidget(type) {
  const def = widgets[type];
  const size = def?.defaultSize || { w: 3, h: 2 };
  const config = {};
  // clone array defaults — widget def objects are shared across all instances, so
  // pushing straight into c.default would leak values between every widget of that type
  for (const c of def?.config || []) config[c.key] = Array.isArray(c.default) ? [...c.default] : (c.default ?? '');
  const { x, y } = findFreeCell(size.w, size.h);
  const w = { id: uid(), type, x, y, w: size.w, h: size.h, config };
  const pg = getCurrentPageLayout();
  if (pg) pg.widgets.push(w);
  render();
  selectWidget(w.id);
  scheduleSave();
}

// ---- persistence ----
function scheduleSave() {
  saveState.textContent = t('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 400);
}
async function saveDraft() {
  if (!device) return;
  await api(`/api/devices/${device.id}/draft`, { method: 'PUT', body: JSON.stringify({ layout }) });
  saveState.textContent = t('saved');
}

async function apply() {
  await saveDraft();
  const res = await api(`/api/devices/${device.id}/publish`, { method: 'POST' });
  toast(t('applied', res.displays));
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---- settings modal (separate from the edit toolbar: device/palette/apply) ----
const settingsBtn = document.getElementById('settings-btn');
const settingsOverlay = document.getElementById('settings-overlay');

async function loadHASettings() {
  try {
    const data = await api('/api/settings/ha');
    const haUrl = document.getElementById('ha-url');
    const haToken = document.getElementById('ha-token');
    if (haUrl) haUrl.value = data.url || '';
    if (haToken) haToken.value = data.token || '';
  } catch (err) {
    console.error('Failed to load HA settings', err);
  }
}

async function saveHASettings() {
  const url = document.getElementById('ha-url').value.trim();
  const token = document.getElementById('ha-token').value.trim();
  try {
    await api('/api/settings/ha', {
      method: 'POST',
      body: JSON.stringify({ url, token })
    });
    toast(t('haSaved'));
    // Reload settings to refresh token masking
    await loadHASettings();
  } catch (err) {
    toast(t('haSavedFailed'));
  }
}

settingsBtn.addEventListener('click', async () => {
  settingsOverlay.classList.remove('hidden');
  await loadHASettings();
});

const haSaveBtn = document.getElementById('ha-save-btn');
if (haSaveBtn) haSaveBtn.addEventListener('click', saveHASettings);

document.getElementById('settings-close').addEventListener('click', () => settingsOverlay.classList.add('hidden'));
settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) settingsOverlay.classList.add('hidden'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') settingsOverlay.classList.add('hidden'); });

// ---- add-widget popover ----
paletteBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePalette(); });
document.addEventListener('click', (e) => {
  if (!palette.classList.contains('hidden') && !palette.contains(e.target) && e.target !== paletteBtn) closePalette();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePalette(); });

// ---- wire up ----
// Plugins must be merged into the widgets registry before the palette/inspector
// (built by applyI18n -> buildPalette) render, or third-party widgets would be
// missing until the next language toggle happened to rebuild it.
await loadPlugins().catch((err) => console.error('[plugins] load failed', err));
initSelectors();
applyI18n();
deviceSelect.addEventListener('change', () => selectDevice(deviceSelect.value));
document.getElementById('apply').addEventListener('click', apply);
canvas.addEventListener('pointerdown', (e) => {
  if (e.target === canvas) { selectedId = null; render(); renderInspector(); }
});
window.addEventListener('resize', render);

loadVersions().catch(() => {});
loadUpdateCheck().catch(() => {});
loadDevices().catch((err) => toast(t('loadFail', err.message)));
