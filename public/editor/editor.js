import { widgets, renderWidget, widgetLabel, fieldLabel, CATEGORY_ORDER, loadPlugins } from '/shared/widgets.js';
import { t, getLang, setLang, LANGS, LOCALES, RESOLUTIONS } from '/editor/i18n.js';
import { effectiveRows, applyGridContainer, applyGridItem, applyCustomCss } from '/shared/gridlayout.js';

let device = null;
let layout = null;
let selectedId = null;
let saveTimer = null;

const canvas = document.getElementById('canvas');
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
const powerOnInput = document.getElementById('power-on-time');
const powerOffInput = document.getElementById('power-off-time');
const powerSaveBtn = document.getElementById('power-save-btn');
const powerClearBtn = document.getElementById('power-clear-btn');
const palette = document.getElementById('palette');
const paletteBtn = document.getElementById('palette-btn');
const inspectorBody = document.getElementById('inspector-body');
const saveState = document.getElementById('save-state');
const openDisplay = document.getElementById('open-display');

let groups = [];
let versionManifest = null;

const uid = () => Math.random().toString(36).slice(2, 9);
const ctx = () => ({
  locale: device?.locale || 'ko-KR',
  timezone: device?.timezone || undefined,
  performanceProfile: device?.performanceProfile || 'high',
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

  // §M4: power schedule save / clear
  if (powerSaveBtn) powerSaveBtn.addEventListener('click', async () => {
    if (!device) return;
    const on = powerOnInput.value.trim();
    const off = powerOffInput.value.trim();
    const schedule = (on || off) ? [{ on: on || null, off: off || null }] : null;
    device.powerSchedule = schedule;
    await api(`/api/devices/${device.id}`, { method: 'PATCH', body: JSON.stringify({ powerSchedule: schedule }) });
    toast(t('powerSaved'));
  });
  if (powerClearBtn) powerClearBtn.addEventListener('click', async () => {
    if (!device) return;
    device.powerSchedule = null;
    powerOnInput.value = '';
    powerOffInput.value = '';
    await api(`/api/devices/${device.id}`, { method: 'PATCH', body: JSON.stringify({ powerSchedule: null }) });
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
  // §M4: power buttons
  const hasAgent = device.agentPresent ?? false;
  if (cmdPowerOnBtn) { cmdPowerOnBtn.disabled = !hasAgent; cmdPowerOnBtn.title = hasAgent ? '' : t('agentMissingTip'); }
  if (cmdPowerOffBtn) { cmdPowerOffBtn.disabled = !hasAgent; cmdPowerOffBtn.title = hasAgent ? '' : t('agentMissingTip'); }
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
  layout = device.draft;
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
  const cols = layout.grid?.cols || 12;
  const rows = effectiveRows(layout);
  const gap = layout.grid?.gap ?? 8;
  return {
    cols, rows,
    cellW: (canvas.clientWidth - gap * (cols - 1)) / cols,
    cellH: (canvas.clientHeight - gap * (rows - 1)) / rows,
  };
}

// Does (x,y,w,h) overlap any other widget? (excludeId lets a widget ignore itself)
function isFree(x, y, w, h, excludeId) {
  const cols = layout.grid?.cols || 12;
  if (x < 0 || y < 0 || x + w > cols) return false;
  return !layout.widgets.some((o) => {
    if (o.id === excludeId) return false;
    return x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y;
  });
}

// First free top-left-first cell that fits a new widget of size (w,h) — avoids
// every new widget stacking at (0,0) on top of whatever's already there.
function findFreeCell(w, h) {
  const cols = layout.grid?.cols || 12;
  for (let y = 0; y < 500; y++) {
    for (let x = 0; x <= cols - w; x++) {
      if (isFree(x, y, w, h)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

function render() {
  if (!layout) { canvas.innerHTML = ''; return; } // no devices left (e.g. after deleting the last one)
  canvas.querySelectorAll('.widget-content').forEach((c) => c._cleanup?.());
  canvas.style.background = layout.background || '#0b0f19';
  canvas.innerHTML = '';
  applyGridContainer(canvas, layout);
  const { cols, rows } = cellSize();
  canvas.style.backgroundSize = `${100 / cols}% ${100 / rows}%`;
  for (const w of layout.widgets) {
    const node = document.createElement('div');
    node.className = 'ed-widget' + (w.id === selectedId ? ' selected' : '');
    node.dataset.id = w.id;
    applyGridItem(node, w);
    const content = document.createElement('div');
    content.className = 'widget-content';
    node.appendChild(content);
    renderWidget(content, w.type, w.config, ctx());
    applyCustomCss(content, w.customCss);
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    node.appendChild(handle);
    canvas.appendChild(node);
    attachDrag(node, w, handle);
  }
}

// ---- drag to move / resize (grid-snapped, with an overlap warning) ----
function attachDrag(node, w, handle) {
  node.addEventListener('pointerdown', (e) => {
    if (e.target === handle) return;
    e.preventDefault();
    selectWidget(w.id);
    const { cellW, cellH, cols } = cellSize();
    const sx = e.clientX, sy = e.clientY, ox = w.x, oy = w.y;
    node.setPointerCapture(e.pointerId);
    const move = (ev) => {
      w.x = clamp(ox + Math.round((ev.clientX - sx) / cellW), 0, cols - w.w);
      w.y = Math.max(0, oy + Math.round((ev.clientY - sy) / cellH));
      applyGridItem(node, w);
      node.classList.toggle('overlap-warning', !isFree(w.x, w.y, w.w, w.h, w.id));
    };
    const up = () => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.classList.remove('overlap-warning');
      render(); // re-run applyGridContainer in case rows grew
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
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      w.w = clamp(ow + Math.round((ev.clientX - sx) / cellW), 1, cols - w.x);
      w.h = Math.max(1, oh + Math.round((ev.clientY - sy) / cellH));
      applyGridItem(node, w);
      node.classList.toggle('overlap-warning', !isFree(w.x, w.y, w.w, w.h, w.id));
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      node.classList.remove('overlap-warning');
      render(); // re-run applyGridContainer in case rows grew
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
  const w = layout?.widgets.find((x) => x.id === selectedId);
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
    if (c.type === 'checkbox') {
      html += `<div class="field check"><label><input type="checkbox" data-config="${c.key}" ${w.config?.[c.key] ? 'checked' : ''}> ${fieldLabel(c, lang)}</label></div>`;
    } else if (c.type === 'number') {
      html += `<div class="field"><label>${fieldLabel(c, lang)}</label><input type="number" data-config="${c.key}" data-config-type="number" value="${esc(w.config?.[c.key])}"></div>`;
    } else if (c.type === 'textarea') {
      html += `<div class="field"><label>${fieldLabel(c, lang)}</label><textarea data-config="${c.key}" rows="4">${esc(w.config?.[c.key])}</textarea></div>`;
    } else if (c.type === 'list') {
      const configArr = w.config?.[c.key];
      const arr = (Array.isArray(configArr) && configArr.length > 0) ? configArr : [''];
      const ph = c.placeholder ? (c.placeholder[lang] || c.placeholder.ko || c.placeholder) : '';
      const rows = arr.map((val, i) => `
        <div class="list-row">
          <input type="text" data-list-key="${c.key}" data-list-index="${i}" value="${esc(val)}" placeholder="${esc(ph)}">
          <button type="button" class="list-remove" data-list-key="${c.key}" data-list-index="${i}">×</button>
        </div>`).join('');
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
    } else {
      html += `<div class="field"><label>${fieldLabel(c, lang)}</label><input type="text" data-config="${c.key}" value="${esc(w.config?.[c.key])}"></div>`;
    }
  }
  // Generic per-instance style override (docs/design.md D16) — not part of the
  // widget's own config schema, so it lives outside the `def.config` loop above,
  // next to the x/y/w/h fields that are likewise generic to every widget type.
  html += `<div class="field"><label>${t('customCssLabel')}</label>
    <textarea id="custom-css-input" rows="4" placeholder="border-radius:12px; opacity:.9;">${escHtml(w.customCss || '')}</textarea>
    <p class="field-hint">${t('customCssHint')}</p>
  </div>`;

  html += `<button id="del-widget" class="danger">${t('delete')}</button>`;
  inspectorBody.innerHTML = html;

  inspectorBody.querySelectorAll('[data-prop]').forEach((inp) =>
    inp.addEventListener('input', () => {
      w[inp.dataset.prop] = Math.max(inp.min ? Number(inp.min) : 0, parseInt(inp.value) || 0);
      render();
      scheduleSave();
    })
  );
  inspectorBody.querySelectorAll('[data-config]').forEach((inp) =>
    inp.addEventListener('input', () => {
      w.config = w.config || {};
      const v = inp.type === 'checkbox' ? inp.checked
        : inp.dataset.configType === 'number' ? Number(inp.value) || 0
        : inp.value;
      w.config[inp.dataset.config] = v;
      const node = canvas.querySelector(`.ed-widget[data-id="${w.id}"] .widget-content`);
      if (node) renderWidget(node, w.type, w.config, ctx());
      scheduleSave();
    })
  );
  inspectorBody.querySelectorAll('[data-list-index]').forEach((inp) => {
    if (inp.tagName !== 'INPUT') return;
    inp.addEventListener('input', () => {
      const arr = w.config[inp.dataset.listKey];
      arr[Number(inp.dataset.listIndex)] = inp.value;
      const node = canvas.querySelector(`.ed-widget[data-id="${w.id}"] .widget-content`);
      if (node) renderWidget(node, w.type, w.config, ctx());
      scheduleSave();
    });
  });
  inspectorBody.querySelectorAll('.list-remove').forEach((btn) =>
    btn.addEventListener('click', () => {
      w.config[btn.dataset.listKey].splice(Number(btn.dataset.listIndex), 1);
      renderInspector(); // row removed -> structural change, rebuild this field's rows
      const node = canvas.querySelector(`.ed-widget[data-id="${w.id}"] .widget-content`);
      if (node) renderWidget(node, w.type, w.config, ctx());
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
  inspectorBody.querySelector('#custom-css-input').addEventListener('input', (e) => {
    w.customCss = e.target.value;
    const node = canvas.querySelector(`.ed-widget[data-id="${w.id}"] .widget-content`);
    if (node) applyCustomCss(node, w.customCss);
    scheduleSave();
  });

  inspectorBody.querySelector('#del-widget').addEventListener('click', () => {
    layout.widgets = layout.widgets.filter((x) => x.id !== selectedId);
    selectedId = null;
    render();
    renderInspector();
    scheduleSave();
  });
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
  layout.widgets.push(w);
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
loadDevices().catch((err) => toast(t('loadFail', err.message)));
