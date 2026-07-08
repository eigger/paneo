// Shared widget registry — rendered identically by the editor preview and the display.
// pluginId namespace is `paneo.*` (see src/brand.js).
// Labels are localized ({ ko, en }); render() receives ctx = { locale, timezone, performanceProfile }
// (docs/design.md §4.4). Widgets calling third-party data go through the server proxy
// (docs/design.md §4.2, src/dataproxy.js) — never fetch third-party APIs directly from here.
//
// §M3: Manifest fields formalised (§7.1):
//   version   — semver string
//   minSize   — { w, h } minimum resize floor (editor warning only, not enforced on display)
//   requires  — capability tags e.g. ['video'] checked against performanceProfile
//   permissions — external capabilities/domains surfaced in the editor for review
//   config[].type === 'enum' — rendered as <select> in the inspector

function loadingBox(el, text) {
  el.innerHTML = `<div class="w-loading">${text}</div>`;
}
function errorBox(el, text) {
  el.innerHTML = `<div class="w-error">${text}</div>`;
}

// Shrinks an element's font size (in px) until its content actually fits its
// own box — for text whose length isn't knowable ahead of time (e.g. a Home
// Assistant entity's friendly_name/state can be arbitrarily long). CSS
// clamp() alone scales with container/viewport size, not content length, so
// a long value can still overflow. Starts from whatever clamp() already
// computed for the current size and only shrinks further as needed.
function fitTextToBox(el, minRatio = 0.4) {
  if (!el) return;
  const parent = el.parentElement;
  if (!parent) return;
  const startSize = parseFloat(getComputedStyle(el).fontSize) || 16;
  const minSize = Math.max(9, startSize * minRatio);
  let size = startSize;
  el.style.fontSize = size + 'px';

  // Compute available space in the parent container by subtracting padding
  const parentStyle = getComputedStyle(parent);
  const padX = (parseFloat(parentStyle.paddingLeft) || 0) + (parseFloat(parentStyle.paddingRight) || 0);
  const padY = (parseFloat(parentStyle.paddingTop) || 0) + (parseFloat(parentStyle.paddingBottom) || 0);
  const maxW = parent.clientWidth - padX;
  const maxH = parent.clientHeight - padY;

  // Compare content bounds against parent available space
  while (size > minSize && (el.scrollWidth > maxW || el.scrollHeight > maxH)) {
    size -= 1;
    el.style.fontSize = size + 'px';
  }
}

// Measures text width without touching the DOM (no reflow) -- used where a
// layout decision (e.g. "is there room for this text?") has to be made
// *before* actually rendering it, so fitTextToBox's after-the-fact DOM
// measurement doesn't apply.
let _measureCtx = null;
function measureTextWidth(text, fontPx, weight = 400) {
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
  _measureCtx.font = `${weight} ${fontPx}px 'Pretendard Variable', Pretendard, sans-serif`;
  return _measureCtx.measureText(text).width;
}

// Runs `fn` once per `intervalMs`, aligned to the real wall-clock boundary
// (see delayUntilNextBoundary() below) -- not a plain `setInterval(fn,
// intervalMs)`, whose first tick lands `intervalMs` after whatever arbitrary
// moment the widget happened to mount. Two widgets that each independently
// do that (clock, timer, world clock, ...) end up ticking at two different
// offsets into each second, so their displayed seconds visibly change at
// slightly different instants -- which reads as "out of sync" even though
// each one individually looks fine. Recomputing the delay every tick
// (instead of one setInterval) also self-corrects for setTimeout/setInterval
// drift over time, so they stay aligned with each other indefinitely, not
// just at startup. Returns a cancel function.
//
// This is the "make it visually synchronized" primitive, meant for widgets
// a user actually watches tick in real time (clock/timer/worldclock's
// seconds, date/dday's day rollover). It should NOT be used for background
// data-refresh widgets -- synchronizing *those* to each other is actively
// undesirable, since it'd make multiple instances (or widget types sharing
// an upstream API) all fire their fetch at the same instant every cycle
// instead of spreading the load out. See pollJson()'s jitter for that case.
function scheduleBoundaryTick(intervalMs, fn) {
  let cancelled = false;
  let timer = null;
  function armNext() {
    timer = setTimeout(tick, delayUntilNextBoundary(intervalMs));
  }
  function tick() {
    if (cancelled) return;
    fn();
    armNext();
  }
  armNext();
  return () => { cancelled = true; clearTimeout(timer); };
}
function scheduleSecondTick(fn) {
  return scheduleBoundaryTick(1000, fn);
}

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// For text interpolated into innerHTML (event summaries, RSS titles, ...) —
// these come from third-party calendars/feeds a user subscribes to, so a
// hostile source could otherwise inject markup/scripts into the kiosk/editor.
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeStyleUrl(s) {
  return String(s ?? '').replace(/'/g, '%27').replace(/\)/g, '%29');
}

function safeHttpUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function sandboxTokens(mode) {
  if (mode === 'trusted') return 'allow-scripts allow-same-origin allow-forms allow-popups';
  if (mode === 'strict') return '';
  return 'allow-scripts allow-forms allow-popups';
}

// Config values for 'list' fields (multi-URL sources) may be an array, or (rarely,
// e.g. right after a widget is first added) undefined — normalize to a clean list.
function cleanUrlList(v) {
  return (Array.isArray(v) ? v : []).map((s) => String(s || '').trim()).filter(Boolean);
}
function multiUrlQuery(urls) {
  return urls.map((u) => `url=${encodeURIComponent(u)}`).join('&');
}

// paneo.photo: distinguish video files from images by extension (query strings ignored).
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|ogv)(\?.*)?$/i;
function isVideoUrl(url) {
  return VIDEO_EXT_RE.test(String(url || ''));
}

// Anchors a repeating timer to absolute wall-clock boundaries (multiples of
// intervalMs since the epoch) instead of "now + intervalMs" — so multiple
// paneo.photo widgets sharing the same interval always advance at the same
// instant regardless of when each one happened to start, and a single slow
// tick (GC pause, background tab throttling) can't accumulate drift, since
// every reschedule re-syncs to the grid from the current clock time.
function delayUntilNextBoundary(intervalMs) {
  return intervalMs - (Date.now() % intervalMs);
}

// §4.3 performance profile: on 'low' tier, poll data widgets half as often —
// a real (if modest, given today's widget set has no video/RTSP yet) CPU/network
// saving rather than an invented one. docs/design.md §M2 D8.
function pollInterval(baseMs, ctx) {
  return ctx?.performanceProfile === 'low' ? baseMs * 2 : baseMs;
}

// Fetch `url` immediately, re-render via `onData`, then repeat every `intervalMs`.
// Cleans itself up (interval + in-flight abort) when the widget is removed/re-rendered.
function pollJson(el, url, intervalMs, onData, onError) {
  let timer = null;
  let ctrl = null;
  const tick = async () => {
    ctrl = new AbortController();
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onData(data);
    } catch (err) {
      if (err.name !== 'AbortError') onError(err);
    }
  };
  tick(); // immediate first load -- don't make the user wait to see data
  // Deliberate per-instance jitter on the *interval*, not just relying on
  // "widgets mount at slightly different times" -- in practice a page's
  // widgets all mount within the same render pass, so several instances of
  // the same widget type (e.g. 3 weather widgets for 3 cities) sharing the
  // same intervalMs would otherwise stay locked in step and all hit the
  // upstream API at the same instant every cycle. This is the opposite of
  // scheduleBoundaryTick() above on purpose: those widgets are meant to look
  // synchronized to a human watching them tick; these are background
  // refreshes nobody watches fire, where synchronizing instances only
  // creates avoidable simultaneous load.
  const jitteredMs = intervalMs + (Math.random() - 0.5) * intervalMs * 0.4; // ±20%
  timer = setInterval(tick, jitteredMs);
  el._cleanup = () => { clearInterval(timer); ctrl?.abort(); };
}

// ---- calendar.month helpers ----
// Build a grid of Date objects for the month containing `date`, padded so
// each row starts on Monday (ISO week) or Sunday depending on startOnSunday option.
// Returns an array of 5 or 6 rows × 7 cols.
export function buildMonthGrid(date, startOnSunday = false) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(year, month, 1);
  // Monday = 0 offset (ISO) or Sunday = 0 offset.
  // JS getDay(): 0=Sun,1=Mon..6=Sat
  const startOffset = startOnSunday ? first.getDay() : (first.getDay() + 6) % 7;
  const cells = [];
  for (let i = -startOffset; i < 42 - startOffset; i++) {
    cells.push(new Date(year, month, 1 + i));
  }
  // Trim trailing row if entirely next month
  while (cells.length > 35) {
    const last7 = cells.slice(-7);
    if (last7.every((d) => d.getMonth() !== month)) cells.splice(-7);
    else break;
  }
  return cells;
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Local calendar date for an iCal event (respects device timezone when set).
function eventLocalDateStr(e, tz) {
  const d = new Date(e.start);
  return tz
    ? new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(d)
    : isoDate(d);
}

// True once the event is over — all-day events go past at the next local midnight.
function isCalendarEventPast(e, now, todayStr, tz) {
  if (e.allDay) return eventLocalDateStr(e, tz) < todayStr;
  const endMs = e.end ? new Date(e.end).getTime() : new Date(e.start).getTime();
  return endMs <= now.getTime();
}

// N full Monday/Sunday-start weeks centered on `date`'s own week — weeksBefore=0,
// weeksAfter=0 gives exactly this week (7 cells); 1/1 gives prev+this+next
// (21 cells). Used by paneo.calendar.month's week/3-week auto views; the
// month view keeps using buildMonthGrid() since a month doesn't align to
// week boundaries the same way (it pads to the *calendar* month, not N weeks).
export function buildWeekRows(date, weeksBefore, weeksAfter, startOnSunday = false) {
  const offset = startOnSunday ? date.getDay() : (date.getDay() + 6) % 7; // days since this week's start (Sunday or Monday)
  const firstDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset - weeksBefore * 7);
  const totalDays = (weeksBefore + 1 + weeksAfter) * 7;
  const cells = [];
  for (let i = 0; i < totalDays; i++) {
    cells.push(new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + i));
  }
  return cells;
}

// ---- timer helpers ----
// Accepts "HH:MM" or "HH:MM:SS" — seconds default to 0 when omitted.
function parseTargetTime(hhmmss) {
  const [hh, mm, ss = 0] = (hhmmss || '').split(':').map(Number);
  if (isNaN(hh) || isNaN(mm) || isNaN(ss)) return null;
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, ss, 0);
}

// A timer entry with a showAt/hideAt window is only rendered while "now" falls
// inside it — lets a timer row appear/disappear at fixed times instead of always
// showing. No window (both blank) means always visible, matching prior behavior.
function isEntryVisible(showAt, hideAt, now) {
  if (!showAt && !hideAt) return true;
  const toSeconds = (hhmmss) => {
    const [h, m, s = 0] = hhmmss.split(':').map(Number);
    return h * 3600 + m * 60 + s;
  };
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const show = showAt ? toSeconds(showAt) : 0;
  const hide = hideAt ? toSeconds(hideAt) : 24 * 3600;
  if (show <= hide) return nowSec >= show && nowSec < hide;
  return nowSec >= show || nowSec < hide; // window wraps past midnight
}

function formatDuration(totalSeconds, signed) {
  const abs = Math.abs(totalSeconds);
  const sign = totalSeconds < 0 ? '-' : '+';
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const hh = h > 0 ? `${String(h).padStart(2, '0')}:` : '';
  return `${sign}${hh}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Home Assistant's documented weather.* condition strings (state), mapped to
// an icon + localized label for paneo.homeassistant's dedicated weather card.
const HA_WEATHER_ICONS = {
  'clear-night': '🌙', cloudy: '☁️', fog: '🌫️', hail: '🌨️',
  lightning: '⚡', 'lightning-rainy': '⛈️', partlycloudy: '⛅',
  pouring: '🌧️', rainy: '🌦️', snowy: '🌨️', 'snowy-rainy': '🌨️',
  sunny: '☀️', windy: '💨', 'windy-variant': '💨', exceptional: '⚠️',
};
const HA_WEATHER_TEXT_KO = {
  'clear-night': '맑은 밤', cloudy: '흐림', fog: '안개', hail: '우박',
  lightning: '번개', 'lightning-rainy': '뇌우', partlycloudy: '구름 조금',
  pouring: '폭우', rainy: '비', snowy: '눈', 'snowy-rainy': '진눈깨비',
  sunny: '맑음', windy: '바람', 'windy-variant': '바람', exceptional: '특이 기상',
};
const HA_WEATHER_TEXT_EN = {
  'clear-night': 'Clear night', cloudy: 'Cloudy', fog: 'Fog', hail: 'Hail',
  lightning: 'Lightning', 'lightning-rainy': 'Thunderstorm', partlycloudy: 'Partly cloudy',
  pouring: 'Pouring', rainy: 'Rainy', snowy: 'Snowy', 'snowy-rainy': 'Snowy/rainy',
  sunny: 'Sunny', windy: 'Windy', 'windy-variant': 'Windy', exceptional: 'Exceptional',
};

// Open-Meteo's WMO weather-code table, mapped to an icon for paneo.weather's
// forecast strip (its data source uses numeric codes, unlike HA's condition
// strings above).
const WEATHER_CODE_ICON = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌧️',
  61: '🌧️', 63: '🌧️', 65: '🌧️',
  71: '🌨️', 73: '🌨️', 75: '❄️', 77: '🌨️',
  80: '🌦️', 81: '🌧️', 82: '⛈️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
};
function weatherCodeIcon(code) {
  return WEATHER_CODE_ICON[code] ?? '🌡️';
}

export const widgets = {
  'paneo.clock': {
    version: '1.1.0',
    label: 'paneo.clock.label',
    icon: '🕐',
    category: 'basic',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 1 },
    requires: [],
    permissions: [],
    config: [
      { key: 'hour12', label: 'paneo.clock.hour12', type: 'checkbox', default: false },
      { key: 'showSeconds', label: 'paneo.clock.showSeconds', type: 'checkbox', default: true },
    ],
    render(el, config, ctx = {}) {
      const locale = ctx.locale || 'ko-KR';
      const tz = ctx.timezone || undefined;
      const showSeconds = config.showSeconds !== false;
      const fmt = new Intl.DateTimeFormat(locale, {
        hour: '2-digit', minute: '2-digit',
        ...(showSeconds ? { second: '2-digit' } : {}),
        hour12: !!config.hour12, timeZone: tz,
      });

      function fit() {
        const hmEl = el.querySelector('.clock-hm');
        if (!hmEl) return;
        // Reset to the CSS clamp() value before measuring — content length
        // (hour12 adds " AM"/"PM", showSeconds adds ":SS") varies per config,
        // and the clamp()'s cqmin-based max doesn't know about that, so
        // without this the text can wrap/overflow its box at some sizes.
        hmEl.style.fontSize = '';
        fitTextToBox(hmEl, 0.3);
      }

      const update = () => {
        const now = new Date();
        // Split formatToParts into three buckets so the seconds portion can
        // be wrapped in its own (smaller) span *between* minutes and any
        // hour12 AM/PM suffix — e.g. "12:58" + small ":33" + " AM" — instead
        // of just appending it after the whole string.
        let before = '', secPart = '', after = '';
        const parts = fmt.formatToParts(now);
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          let val = p.value;
          if ((p.type === 'hour' || p.type === 'minute' || p.type === 'second') && /^\d+$/.test(val)) {
            val = val.padStart(2, '0');
          }
          if (p.type === 'second') secPart += val;
          else if (parts[i + 1]?.type === 'second') secPart += val; // the ':' right before seconds
          else if (secPart) after += val;
          else before += val;
        }
        el.innerHTML = `<div class="w-clock"><span class="clock-hm">${before}${secPart ? `<span class="clock-sec">${secPart}</span>` : ''}${after}</span></div>`;
        // update() replaces .clock-hm's innerHTML wholesale every tick, which
        // would otherwise throw away the previous fit() shrink along with
        // the old node — content length is stable tick-to-tick (always the
        // same digit count), but re-fitting after every tick is cheap and
        // keeps this correct without tracking whether a resize happened.
        fit();
      };
      update();
      const cancelTick = scheduleSecondTick(update);

      const ro = new ResizeObserver(fit);
      ro.observe(el);
      el._cleanup = () => { cancelTick(); ro.disconnect(); };
    },
  },

  'paneo.date': {
    version: '1.0.0',
    label: 'paneo.date.label',
    icon: '📅',
    category: 'basic',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 1 },
    requires: [],
    permissions: [],
    config: [],
    render(el, _config, ctx = {}) {
      const locale = ctx.locale || 'ko-KR';
      const tz = ctx.timezone || undefined;
      const dateFmt = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: tz });
      const wdFmt = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: tz });

      function fit() {
        const mainEl = el.querySelector('.date-main');
        const wdEl = el.querySelector('.date-weekday');
        // Reset to the CSS clamp() value before measuring -- locale month/
        // weekday names vary a lot in rendered width (e.g. "September" vs
        // "9월"), which clamp()'s cqmin-based max doesn't know about, so
        // without this the text can wrap/overflow its box in some locales
        // or at some container aspect ratios (clamp() alone can compute a
        // font-size that fits the editor's preview box but not the real
        // kiosk's, or vice versa, since it only sees the box, not the text).
        if (mainEl) { mainEl.style.fontSize = ''; fitTextToBox(mainEl, 0.3); }
        if (wdEl) { wdEl.style.fontSize = ''; fitTextToBox(wdEl, 0.3); }
      }

      const update = () => {
        const now = new Date();
        el.innerHTML = `<div class="w-date"><div class="date-main">${dateFmt.format(now)}</div><div class="date-weekday">${wdFmt.format(now)}</div></div>`;
        fit();
      };
      update();
      // Minute-boundary aligned (scheduleBoundaryTick), not a plain
      // setInterval(update, 60000) -- that ticks 60s after whatever
      // arbitrary moment the widget mounted, so an actual midnight rollover
      // could take up to 59s to actually show on screen.
      const cancelTick = scheduleBoundaryTick(60000, update);
      const ro = new ResizeObserver(fit);
      ro.observe(el);
      el._cleanup = () => { cancelTick(); ro.disconnect(); };
    },
  },

  'paneo.text': {
    version: '1.0.0',
    label: 'paneo.text.label',
    icon: '📝',
    category: 'basic',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 1, h: 1 },
    requires: [],
    permissions: [],
    config: [{ key: 'text', label: 'paneo.text.text', type: 'text', default: '' }],
    render(el, config) {
      el.innerHTML = `<div class="w-text"></div>`;
      el.querySelector('.w-text').textContent = config.text ?? '';
    },
  },

  'paneo.photo': {
    version: '1.2.0',
    label: 'paneo.photo.label',
    icon: '🖼️',
    category: 'media',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 2, h: 2 },
    requires: [],
    permissions: [],
    // Generic opt-in for "use as a full-bleed background" (editor.js's isFree/
    // resolveCollisions skip it, editor.css/display.css render it behind other
    // widgets) — a widget-def flag rather than hardcoding this widget's type
    // string in the collision/z-index logic, so any other widget (built-in or
    // third-party plugin) can opt into the same behavior later.
    backgroundLayer: true,
    config: [
      { key: 'source', label: 'paneo.photo.source', type: 'enum', options: ['urls', 'local', 'unsplash', 'immich'], default: 'urls' },
      { key: 'urls', label: 'paneo.photo.urls', type: 'list', default: [], showIf: { key: 'source', equals: 'urls' } },
      // selectionKey: the shared upload pool (data/photos/) is server-global — every
      // "local" source widget browses/uploads/deletes the same files — but which of
      // those files THIS widget instance actually slideshows is per-widget, stored
      // under config[selectionKey]. Empty/unset means "show everything" (the original,
      // still-backward-compatible behavior) so existing configs don't change.
      { key: 'localManage', label: 'paneo.photo.localManage', type: 'fileManager', default: '', showIf: { key: 'source', equals: 'local' }, selectionKey: 'localSelectedFiles' },
      { key: 'unsplashKeyword', label: 'paneo.photo.unsplashKeyword', type: 'text', default: 'nature', showIf: { key: 'source', equals: 'unsplash' } },
      { key: 'immichUrl', label: 'paneo.photo.immichUrl', type: 'text', default: '', showIf: { key: 'source', equals: 'immich' } },
      { key: 'immichApiKey', label: 'paneo.photo.immichApiKey', type: 'text', default: '', showIf: { key: 'source', equals: 'immich' } },
      { key: 'immichAlbumId', label: 'paneo.photo.immichAlbumId', type: 'text', default: '', showIf: { key: 'source', equals: 'immich' } },
      { key: 'fit', label: 'paneo.photo.fit', type: 'enum', options: ['cover', 'contain'], default: 'cover' },
      { key: 'effects', label: 'paneo.photo.effects', type: 'checkbox', default: false },
      { key: 'transition', label: 'paneo.photo.transition', type: 'enum', options: ['none', 'fade', 'slide'], default: 'none' },
      { key: 'shuffleOrder', label: 'paneo.photo.shuffleOrder', type: 'checkbox', default: false },
      { key: 'intervalSec', label: 'paneo.photo.intervalSec', type: 'number', default: 8 },
    ],
    render(el, config, ctx = {}) {
      const source = config.source || 'urls';
      const fit = config.fit || 'cover';
      const fitClass = fit === 'contain' ? ' fit-contain' : ' fit-cover';
      const useEffects = config.effects && ctx.performanceProfile === 'high';
      const intervalSec = Math.max(2, Number(config.intervalSec) || 8);
      const shuffle = !!config.shuffleOrder;
      // Cross-fade/slide adds a second composited layer + CSS transition — real
      // GPU/CPU cost on a Pi Zero/3, so (like Ken Burns) it's 'high' tier only.
      const transition = ctx.performanceProfile === 'high' ? (config.transition || 'none') : 'none';
      const TRANSITION_MS = 700;

      let timer = null;
      let transitionCleanupTimer = null;
      let items = [];
      let currentIndex = 0;
      let pendingNextIndex = 0;
      let activeVideoEl = null;
      let activeVideoHandlers = null;
      let hasPainted = false;
      let paintGeneration = 0; // guards against a stale preload finishing after a newer paint() started

      const releaseVideoEl = (video) => {
        if (!video) return;
        video.pause();
        video.removeAttribute('src');
        try { video.load(); } catch { /* ignore */ }
      };

      const teardownActiveVideo = () => {
        if (!activeVideoEl) return;
        if (activeVideoHandlers) {
          activeVideoEl.removeEventListener('ended', activeVideoHandlers.ended);
          activeVideoEl.removeEventListener('error', activeVideoHandlers.error);
          activeVideoHandlers = null;
        }
        releaseVideoEl(activeVideoEl);
        activeVideoEl = null;
      };

      const removeTransitionLayers = (layers) => {
        for (const layer of layers) {
          layer.querySelectorAll('video').forEach(releaseVideoEl);
          layer.remove();
        }
      };

      // Random-without-immediate-repeat when shuffle is on, otherwise plain sequential.
      const pickNextIndex = () => {
        if (items.length <= 1) return 0;
        if (!shuffle) return (currentIndex + 1) % items.length;
        let next;
        do { next = Math.floor(Math.random() * items.length); } while (next === currentIndex);
        return next;
      };

      const advance = () => {
        if (source === 'unsplash') {
          const kw = config.unsplashKeyword ? encodeURIComponent(config.unsplashKeyword) : 'nature';
          items = [`/api/proxy/photos/unsplash?keyword=${kw}&t=${Date.now()}`];
          currentIndex = 0;
        } else {
          currentIndex = pendingNextIndex;
        }
        paint();
      };

      const paint = () => {
        clearTimeout(timer);
        timer = null;
        teardownActiveVideo();
        const myGeneration = ++paintGeneration;

        if (!items.length) {
          el.innerHTML = `<div class="w-image w-placeholder"></div>`;
          return;
        }

        const currentUrl = items[currentIndex];
        const isVideo = isVideoUrl(currentUrl);
        const loopSingle = isVideo && items.length <= 1 && source !== 'unsplash';

        // Computed unconditionally (not just in the image branch below) — advance()
        // reads pendingNextIndex, and if a video never set it, ending/erroring that
        // video would fall back to whatever stale value a *previous* image paint
        // left behind, which is effectively random and often just replays the same
        // video forever instead of moving to the next item.
        pendingNextIndex = pickNextIndex();

        const commitPaint = () => {
          if (myGeneration !== paintGeneration) return; // a newer paint() started meanwhile — abandon this one

          let innerHtml;
          if (isVideo) {
            innerHtml = `<video class="w-video${fitClass}" src="${escapeAttr(currentUrl)}" autoplay muted playsinline ${loopSingle ? 'loop' : ''}></video>`;
          } else {
            const nextUrl = items[pendingNextIndex] ?? currentUrl;
            innerHtml = useEffects
              ? `<div class="w-image-container">
                  <div class="w-image-bg kenburns${fitClass}" style="background-image:url('${escapeStyleUrl(currentUrl)}')"></div>
                  <div class="w-image-bg-preload" style="background-image:url('${escapeStyleUrl(nextUrl)}')"></div>
                </div>`
              : `<div class="w-image${fitClass}" style="background-image:url('${escapeStyleUrl(currentUrl)}')"></div>`;
          }

          // First paint (or transition:none) swaps content instantly, same as before
          // this option existed. Otherwise the new layer fades/slides in on top of
          // the old one, which is removed once the CSS transition finishes.
          let newLayer;
          if (!hasPainted || transition === 'none') {
            el.innerHTML = `<div class="ms-stage"><div class="ms-layer ms-active">${innerHtml}</div></div>`;
            newLayer = el.querySelector('.ms-layer');
          } else {
            const stage = el.querySelector('.ms-stage');
            // Rapid advance can outrun the 700ms cleanup — drop buried layers only,
            // keep the topmost (current) slide. Do NOT touch layers at paint() start
            // (v0.0.20/21 regressions: wrong keeper + cancelled cleanup → flicker).
            if (stage.children.length > 1) {
              removeTransitionLayers([...stage.children].slice(0, -1));
            }
            clearTimeout(transitionCleanupTimer);
            transitionCleanupTimer = null;
            newLayer = document.createElement('div');
            newLayer.className = `ms-layer ms-${transition}-enter`;
            newLayer.innerHTML = innerHtml;
            stage.appendChild(newLayer);
            void newLayer.offsetWidth; // force a reflow so the enter->active transition actually runs
            newLayer.classList.add('ms-active');
            const oldLayers = [...stage.children].filter((c) => c !== newLayer);
            transitionCleanupTimer = setTimeout(() => {
              transitionCleanupTimer = null;
              removeTransitionLayers(oldLayers);
            }, TRANSITION_MS);
          }
          hasPainted = true;

          // Videos drive their own advance via 'ended' (so playback isn't cut short
          // by the photo interval) instead of the setTimeout used for images below.
          // 'error' also advances — a video that fails to decode (e.g. an unsupported
          // codec) would otherwise freeze the slideshow on that item forever, since
          // 'ended' never fires for a video that never started playing.
          if (isVideo) {
            activeVideoEl = newLayer.querySelector('video');
            if (!loopSingle) {
              const onEnded = () => advance();
              const onError = () => advance();
              activeVideoHandlers = { ended: onEnded, error: onError };
              activeVideoEl.addEventListener('ended', onEnded);
              activeVideoEl.addEventListener('error', onError);
            }
            return;
          }

          if (items.length > 1 || source === 'unsplash') {
            timer = setTimeout(advance, delayUntilNextBoundary(intervalSec * 1000));
          }
        };

        // Cross-fade/slide only ever animates fully-loaded content — without this,
        // a cold-cache image starts its fade-in as a blank layer and "pops in" once
        // the download finishes mid-transition, seen as an intermittent flicker
        // (worse the slower the network / the less likely the image is cached).
        if (!isVideo && hasPainted && transition !== 'none') {
          let settled = false;
          const proceed = () => { if (!settled) { settled = true; commitPaint(); } };
          const preloadImg = new Image();
          preloadImg.onload = proceed;
          preloadImg.onerror = proceed; // don't block forever on a broken URL
          preloadImg.src = currentUrl;
          if (preloadImg.complete) proceed();
        } else {
          commitPaint();
        }
      };

      loadingBox(el, '...');

      if (source === 'urls') {
        items = cleanUrlList(config.urls);
        paint();
      } else if (source === 'local') {
        // config.localSelectedFiles (set via the inspector's per-file checkboxes):
        // filenames this specific widget instance should show. Empty/unset -> show
        // every file in the shared pool, same as before this option existed.
        const selected = Array.isArray(config.localSelectedFiles) ? config.localSelectedFiles : [];
        fetch('/api/proxy/photos/local')
          .then(res => res.json())
          .then(list => {
            items = selected.length
              ? list.filter((url) => selected.includes(decodeURIComponent(url.split('/').pop())))
              : list;
            paint();
          })
          .catch(() => {
            errorBox(el, 'Local photos load failed');
          });
      } else if (source === 'unsplash') {
        const kw = config.unsplashKeyword ? encodeURIComponent(config.unsplashKeyword) : 'nature';
        items = [`/api/proxy/photos/unsplash?keyword=${kw}&t=${Date.now()}`];
        paint();
      } else if (source === 'immich') {
        const url = encodeURIComponent(config.immichUrl || '');
        const apiKey = encodeURIComponent(config.immichApiKey || '');
        const albumId = encodeURIComponent(config.immichAlbumId || '');
        if (!config.immichUrl || !config.immichApiKey) {
          errorBox(el, ctx.locale?.startsWith('ko') ? 'Immich 설정을 완료하세요' : 'Configure Immich setting');
          return;
        }
        fetch(`/api/proxy/photos/immich?url=${url}&apiKey=${apiKey}&albumId=${albumId}`)
          .then(res => res.json())
          .then(list => {
            items = list;
            paint();
          })
          .catch(() => {
            errorBox(el, 'Immich load failed');
          });
      }

      el._cleanup = () => {
        paintGeneration += 1;
        clearTimeout(timer);
        clearTimeout(transitionCleanupTimer);
        timer = null;
        transitionCleanupTimer = null;
        teardownActiveVideo();
        const stage = el.querySelector('.ms-stage');
        if (stage) removeTransitionLayers([...stage.children]);
      };
    },
  },

  'paneo.weather': {
    version: '1.1.0',
    label: { ko: '날씨', en: 'Weather', ja: '天気', de: 'Wetter', fr: 'Météo', es: 'Tiempo' },
    icon: '☀️',
    category: 'data',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    requires: [],
    permissions: ['open-meteo.com', 'nominatim.openstreetmap.org'],
    config: [
      { key: 'location', label: { ko: '지역(도시명)', en: 'Location (city)', ja: '地域 (都市名)', de: 'Standort (Stadt)', fr: 'Lieu (ville)', es: 'Ubicación (ciudad)' }, type: 'text', default: 'Seoul' },
      { key: 'units', label: { ko: '단위', en: 'Units', ja: '単位', de: 'Einheit', fr: 'Unité', es: 'Unidad' }, type: 'enum', options: ['metric', 'imperial'], default: 'metric' },
    ],
    render(el, config, ctx = {}) {
      const loc = String(config.location || '').trim();
      if (!loc) { errorBox(el, ctx.locale?.startsWith('ko') !== false ? '지역을 입력하세요' : 'Set a location'); return; }
      const units = config.units === 'imperial' ? 'imperial' : 'metric';
      const unitSymbol = units === 'imperial' ? '°F' : '°C';
      loadingBox(el, '...');
      const locale = ctx.locale || 'ko-KR';
      const tz = ctx.timezone || undefined;

      // Same size-adaptive pattern as the HA weather.* card: the forecast
      // strip only appears once the widget is resized tall enough for it —
      // below that, unchanged current-conditions-only card.
      const WEATHER_FORECAST_MIN_HEIGHT = 200;
      let latestData = null;

      function renderCard(data, showForecast) {
        const forecast = data.forecast || [];
        const forecastHtml = (showForecast && forecast.length)
          ? `<div class="weather-forecast">${forecast.slice(0, 5).map((f) => {
              const wd = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: tz }).format(new Date(f.date));
              const icon = weatherCodeIcon(f.weatherCode);
              const hi = f.tempMax != null ? `${Math.round(f.tempMax)}°` : '-';
              const lo = f.tempMin != null ? `/${Math.round(f.tempMin)}°` : '';
              return `<div class="weather-fc-day">
                <div class="weather-fc-wd">${wd}</div>
                <div class="weather-fc-icon">${icon}</div>
                <div class="weather-fc-temp">${hi}${lo}</div>
              </div>`;
            }).join('')}</div>`
          : '';

        el.innerHTML = `<div class="w-weather">
          <div class="weather-body">
            <div class="weather-temp">${Math.round(data.temperature)}${unitSymbol}</div>
            <div class="weather-text">${data.weatherText}</div>
            <div class="weather-loc">${data.location}</div>
          </div>
          ${forecastHtml}
        </div>`;
      }

      const ro = new ResizeObserver((entries) => {
        if (!latestData) return;
        const showForecast = entries[0].contentRect.height >= WEATHER_FORECAST_MIN_HEIGHT;
        const alreadyShown = !!el.querySelector('.weather-forecast');
        if (showForecast === alreadyShown) return;
        renderCard(latestData, showForecast);
      });
      ro.observe(el);

      pollJson(
        el, `/api/proxy/weather?location=${encodeURIComponent(loc)}&units=${units}&locale=${encodeURIComponent(locale)}`, pollInterval(10 * 60_000, ctx),
        (data) => {
          latestData = data;
          const rect = el.getBoundingClientRect();
          renderCard(data, rect.height >= WEATHER_FORECAST_MIN_HEIGHT);
        },
        (err) => errorBox(el, err.message),
      );
      // pollJson just overwrote el._cleanup with its own poll-interval cleanup
      // — wrap it so the ResizeObserver still gets disconnected.
      const pollCleanup = el._cleanup;
      el._cleanup = () => { pollCleanup?.(); ro.disconnect(); };
    },
  },

  'paneo.airquality': {
    version: '1.1.0',
    label: { ko: '대기질', en: 'Air Quality', ja: '空気質', de: 'Luftqualität', fr: 'Qualité de l’air', es: 'Calidad del aire' },
    icon: '🌫️',
    category: 'data',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    requires: [],
    permissions: ['air-quality-api.open-meteo.com', 'nominatim.openstreetmap.org'],
    config: [
      { key: 'location', label: { ko: '지역(도시명)', en: 'Location (city)', ja: '地域 (都市名)', de: 'Standort (Stadt)', fr: 'Lieu (ville)', es: 'Ubicación (ciudad)' }, type: 'text', default: 'Seoul' },
    ],
    render(el, config, ctx = {}) {
      const loc = String(config.location || '').trim();
      if (!loc) { errorBox(el, ctx.locale?.startsWith('ko') !== false ? '지역을 입력하세요' : 'Set a location'); return; }
      const isKo = ctx.locale?.startsWith('ko') !== false;
      loadingBox(el, '...');

      // PM10/PM2.5 (with KR grade badges) always show — CO/NO2/O3/SO2 have no
      // grade table and are only useful once the widget is resized tall
      // enough to hold them, same pattern as the HA/paneo.weather forecast rows.
      const AQ_EXTRA_MIN_HEIGHT = 220;
      let latestData = null;

      function renderCard(data, showExtra) {
        const row = (label, value, grade, idx, unit = '') => `<div class="aq-row">
          <span class="aq-label">${label}</span>
          <span class="aq-value aq-grade-${idx ?? 'na'}">${value != null ? Math.round(value) : '-'}${unit}${grade ? ` · ${grade}` : ''}</span>
        </div>`;
        const extraHtml = showExtra
          ? `<div class="aq-extra">
              ${row('CO', data.co, null, null, ' µg/m³')}
              ${row('NO2', data.no2, null, null, ' µg/m³')}
              ${row('O3', data.o3, null, null, ' µg/m³')}
              ${row('SO2', data.so2, null, null, ' µg/m³')}
            </div>`
          : '';
        el.innerHTML = `<div class="w-airquality">
          <div class="aq-loc">${data.location}</div>
          ${row(translate('paneo.airquality.pm10', locale), data.pm10, data.pm10Grade, data.pm10GradeIndex)}
          ${row(translate('paneo.airquality.pm25', locale), data.pm25, data.pm25Grade, data.pm25GradeIndex)}
          ${extraHtml}
        </div>`;
      }

      const ro = new ResizeObserver((entries) => {
        if (!latestData) return;
        const showExtra = entries[0].contentRect.height >= AQ_EXTRA_MIN_HEIGHT;
        const alreadyShown = !!el.querySelector('.aq-extra');
        if (showExtra === alreadyShown) return;
        renderCard(latestData, showExtra);
      });
      ro.observe(el);

      pollJson(
        el, `/api/proxy/airquality?location=${encodeURIComponent(loc)}&locale=${encodeURIComponent(ctx.locale || 'ko-KR')}`, pollInterval(10 * 60_000, ctx),
        (data) => {
          latestData = data;
          const rect = el.getBoundingClientRect();
          renderCard(data, rect.height >= AQ_EXTRA_MIN_HEIGHT);
        },
        (err) => errorBox(el, err.message),
      );
      const pollCleanup = el._cleanup;
      el._cleanup = () => { pollCleanup?.(); ro.disconnect(); };
    },
  },

  'paneo.calendar': {
    version: '1.1.0',
    label: { ko: '일정 목록', en: 'Event list', ja: '予定リスト', de: 'Terminliste', fr: 'Liste d’événements', es: 'Lista de eventos' },
    icon: '🗓️',
    category: 'data',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 2, h: 2 },
    requires: [],
    permissions: [],
    config: [{ key: 'icsUrls', label: { ko: 'iCal(.ics) URL', en: 'iCal (.ics) URLs', ja: 'iCal (.ics) URL', de: 'iCal (.ics) URL', fr: 'URL iCal (.ics)', es: 'URL de iCal (.ics)' }, type: 'list', default: [], placeholder: { ko: 'https://example.com/calendar.ics', en: 'https://example.com/calendar.ics' } }],
    render(el, config, ctx = {}) {
      const parsedUrls = [];
      const urlColors = {};
      for (const entry of cleanUrlList(config.icsUrls)) {
        const [u, color = ''] = entry.split('|');
        if (u) {
          parsedUrls.push(u);
          urlColors[u] = color;
        }
      }
      if (!parsedUrls.length) { errorBox(el, ctx.locale?.startsWith('ko') !== false ? 'iCal URL을 입력하세요' : 'Set an iCal URL'); return; }
      loadingBox(el, '...');
      const locale = ctx.locale || 'ko-KR';
      const tz = ctx.timezone || undefined;
      const dateFmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', weekday: 'short', timeZone: tz });
      const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: tz });
      const hasColors = Object.values(urlColors).some(Boolean);

      // Below the threshold: unchanged compact "date + summary" rows. Above
      // it: also show each event's time-of-day, plus (when sources have
      // assigned colors) a legend mapping color → source, so a multi-source
      // list stays readable once there's room for it — same pattern as the
      // other adaptive widgets in this batch.
      const CAL_DETAIL_MIN_HEIGHT = 220;
      let latestEvents = null;

      function renderList(events, expanded) {
        const now = new Date();
        const todayStr = isoDate(now);
        const items = events.map((e) => {
          const past = isCalendarEventPast(e, now, todayStr, tz);
          const color = urlColors[e.source] || '';
          const style = color ? `style="border-left:3px solid ${color}; padding-left:6px; margin-left:0"` : '';
          const timeHtml = (expanded && !e.allDay) ? `<span class="cal-time">${timeFmt.format(new Date(e.start))}</span>` : '';
          return `<li class="${past ? 'cal-past' : ''}" ${style}><span class="cal-date">${dateFmt.format(new Date(e.start))}</span>${timeHtml}<span class="cal-summary">${escapeHtml(e.summary)}</span></li>`;
        }).join('');
        const legendHtml = (expanded && hasColors)
          ? `<div class="cal-legend">${parsedUrls.filter((u) => urlColors[u]).map((u) => {
              let label = u;
              try { label = new URL(u).hostname; } catch { /* keep raw url as fallback label */ }
              return `<span class="cal-legend-item"><span class="cal-legend-dot" style="background:${urlColors[u]}"></span>${label}</span>`;
            }).join('')}</div>`
          : '';
        el.innerHTML = `<div class="w-cal-list">
          <ul class="w-calendar">${items || '<li class="cal-empty">-</li>'}</ul>
          ${legendHtml}
        </div>`;
      }

      const ro = new ResizeObserver((entries) => {
        if (!latestEvents) return;
        const expanded = entries[0].contentRect.height >= CAL_DETAIL_MIN_HEIGHT;
        const alreadyExpanded = !!el.querySelector('.cal-time, .cal-legend');
        if (expanded === alreadyExpanded) return;
        renderList(latestEvents, expanded);
      });
      ro.observe(el);

      pollJson(
        el, `/api/proxy/ical?${multiUrlQuery(parsedUrls)}`, pollInterval(15 * 60_000, ctx),
        (data) => {
          latestEvents = data.events || [];
          const rect = el.getBoundingClientRect();
          renderList(latestEvents, rect.height >= CAL_DETAIL_MIN_HEIGHT);
        },
        (err) => errorBox(el, err.message),
      );
      const pollCleanup = el._cleanup;
      el._cleanup = () => { pollCleanup?.(); ro.disconnect(); };
    },
  },

  // §M3 D8, extended D#: adaptive calendar grid — separate widget from
  // paneo.calendar (event list). Reuses /api/proxy/ical; the view (day / week
  // / 3-week / month) is picked automatically from the widget's own rendered
  // box size via ResizeObserver, not a manual setting — a 2×2 placement reads
  // naturally as "today's agenda" while a 6×5 one reads as a full month.
  'paneo.calendar.month': {
    version: '2.0.0',
    label: { ko: '캘린더', en: 'Calendar', ja: 'カレンダー', de: 'Kalender', fr: 'Calendrier', es: 'Calendario' },
    icon: '📆',
    category: 'data',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 2, h: 2 },
    requires: [],
    permissions: [],
    config: [
      { key: 'icsUrls', label: { ko: 'iCal(.ics) URL', en: 'iCal (.ics) URLs', ja: 'iCal (.ics) URL', de: 'iCal (.ics) URL', fr: 'URL iCal (.ics)', es: 'URL de iCal (.ics)' }, type: 'list', default: [], placeholder: { ko: 'https://example.com/calendar.ics', en: 'https://example.com/calendar.ics' } },
      { key: 'showWeekNumber', label: { ko: '주 번호 표시', en: 'Show week numbers', ja: '週番号を表示', de: 'Wochennummern anzeigen', fr: 'Afficher les numéros de semaine', es: 'Mostrar números de semana' }, type: 'checkbox', default: false },
      { key: 'startOnSunday', label: { ko: '일요일부터 시작', en: 'Start week on Sunday', ja: '日曜から開始', de: 'Woche am Sonntag beginnen', fr: 'Commencer la semaine le dimanche', es: 'Comenzar la semana el domingo' }, type: 'checkbox', default: false },
    ],
    render(el, config, ctx = {}) {
      const locale = ctx.locale || 'ko-KR';
      const tz = ctx.timezone || undefined;
      const isKo = locale.startsWith('ko');

      // Generate day names dynamically for the given locale
      const dayNames = [];
      const baseDate = new Date(2026, 6, config.startOnSunday ? 5 : 6); // 2026-07-05 is Sunday, 2026-07-06 is Monday
      const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: tz });
      for (let i = 0; i < 7; i++) {
        const d = new Date(baseDate);
        d.setDate(baseDate.getDate() + i);
        dayNames.push(weekdayFmt.format(d));
      }

      const parsedUrls = [];
      const urlColors = {};
      for (const entry of cleanUrlList(config.icsUrls)) {
        const [u, color = ''] = entry.split('|');
        if (u) {
          parsedUrls.push(u);
          urlColors[u] = color;
        }
      }

      // Thresholds are the widget's own rendered pixel box (via ResizeObserver
      // below), not grid units — grid-cell pixel size varies by display
      // resolution/grid config, but a rendered box size is directly measurable
      // and comparable regardless of that. Width decides whether a 7-column
      // week row fits legibly at all; height then decides how many such rows.
      // Picked by eye against common Pi display resolutions — tune freely.
      const CAL_MIN_WEEK_WIDTH = 260;
      const CAL_MIN_3WEEK_HEIGHT = 220;
      const CAL_MIN_MONTH_HEIGHT = 380;

      function pickView(width, height) {
        if (width < CAL_MIN_WEEK_WIDTH) return 'day';
        if (height < CAL_MIN_3WEEK_HEIGHT) return 'week';
        if (height < CAL_MIN_MONTH_HEIGHT) return '3week';
        return 'month';
      }

      function cellsForView(view, now) {
        // Midnight-normalized, not the live `now` instant — cells[0]/[cells.length-1]
        // feed paintAndFetch()'s fetch range below, and using the current time-of-day
        // as the day view's range start meant any event earlier today than "right
        // now" (e.g. a 9am meeting checked at 2pm) silently never appeared, while
        // the week/3week/month views (whose cells are already built from
        // year/month/date only) never had this problem.
        if (view === 'day') return [new Date(now.getFullYear(), now.getMonth(), now.getDate())];
        if (view === 'week') return buildWeekRows(now, 0, 0, !!config.startOnSunday);
        if (view === '3week') return buildWeekRows(now, 1, 1, !!config.startOnSunday);
        return buildMonthGrid(now, !!config.startOnSunday);
      }

      // Grid views (week/3week/month) only show each event's title by default —
      // there's rarely room for more once a month is packed into 5-6 rows of 7
      // narrow day cells. But a large enough box (few rows, or just a lot of
      // pixels to work with) has room per cell for a time prefix too, so this
      // is re-derived from the *measured* per-cell size on every resize, same
      // idea as CAL_MIN_*_HEIGHT above — not a fixed per-view on/off switch,
      // since a "month" view can still be spacious on a big display and a
      // "week" view can still be tight on a small one.
      const CAL_GRID_TIME_MIN_CELL_W = 68;
      const CAL_GRID_TIME_MIN_CELL_H = 52;
      const CAL_GRID_HEADER_H = 46; // approx month-title + weekday-header rows
      // Minimum event-title characters that must still fit *after* the time
      // prefix eats into the cell — the cell-size check above only asks "is
      // this cell generically big enough", which a long event title can
      // still blow through once "HH:MM " is prepended, crushing the actual
      // title to 1-2 characters before CSS ellipsis kicks in (showing a time
      // next to an unreadable sliver of a title isn't actually useful).
      // Raised from an earlier 4 -- reserving room for only ~4 characters
      // still let a real event title get ellipsised down to a couple of
      // syllables on typical Korean titles once "HH:MM " ate into the cell,
      // which still read as "cut off" even though it wasn't the 1-2
      // -character extreme this check was originally added to prevent.
      // 10 pushes the practical bar up to a genuinely spacious cell (roughly
      // 150-160px wide at this widget's default height range) so the time
      // prefix only appears once there's real room for a short title to
      // still read normally next to it.
      const CAL_GRID_TIME_MIN_SUMMARY_CH = 10;
      const CAL_GRID_EVENT_CELL_PADDING = 10; // .cal-m-day (2px 3px) + .cal-m-event (0 2px) padding, approx
      function gridRowsForView(view) {
        if (view === 'week') return 1;
        if (view === '3week') return 3;
        return 6; // month: worst-case (5 real weeks most months, 6 some) — conservative
      }
      function shouldShowGridEventTime(view, width, height) {
        if (view === 'day') return false; // day view has its own always-on time display
        const cols = config.showWeekNumber ? 8 : 7;
        const cellW = width / cols;
        const cellH = (height - CAL_GRID_HEADER_H) / gridRowsForView(view);
        if (cellW < CAL_GRID_TIME_MIN_CELL_W || cellH < CAL_GRID_TIME_MIN_CELL_H) return false;
        // Combined-width check: mirrors .cal-m-event's font-size clamp(8px,
        // 3cqh, 13px) (cqh here is the *widget's* own height, same basis the
        // CSS clamp uses) so the estimate tracks the actual rendered size,
        // then measures a sample "HH:MM " against a conservative per-char
        // width (CJK glyphs, which run close to 1em/char and are wider than
        // Latin text — event titles can be in any language, so sizing the
        // reserved space for the *widest* common case avoids happily showing
        // a time next to a crushed Korean/Japanese/Chinese title while still
        // being generous enough for narrower scripts).
        const fontPx = Math.min(13, Math.max(8, height * 0.03));
        const timeW = measureTextWidth(`${timeFmt.format(new Date())} `, fontPx);
        const avgCjkCharW = measureTextWidth('가나다라마', fontPx) / 5;
        const availableForSummary = cellW - CAL_GRID_EVENT_CELL_PADDING - timeW;
        return availableForSummary >= avgCjkCharW * CAL_GRID_TIME_MIN_SUMMARY_CH;
      }

      const rangeFmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: tz });
      const monthFmt = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: tz });
      const dayFmt = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'short', timeZone: tz });
      const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: tz });

      function headerFor(view, cells, now) {
        if (view === 'month') return monthFmt.format(now);
        if (view === 'day') return dayFmt.format(now);
        return `${rangeFmt.format(cells[0])} – ${rangeFmt.format(cells[cells.length - 1])}`;
      }

      function renderDayView(now, eventsByDate) {
        const ds = isoDate(now);
        const events = (eventsByDate[ds] || []).slice().sort((a, b) => new Date(a.start) - new Date(b.start));
        const rows = events.length
          ? events.map((e) => {
              const past = isCalendarEventPast(e, now, ds, tz);
              const color = urlColors[e.source] || '';
              const style = color ? `style="border-left:3px solid ${color}"` : '';
              const timeHtml = e.allDay ? '' : `<span class="cal-d-time">${timeFmt.format(new Date(e.start))}</span>`;
              return `<div class="cal-d-item${past ? ' cal-d-past' : ''}" ${style}>
                ${timeHtml}
                <span class="cal-d-summary">${escapeHtml(e.summary)}</span>
              </div>`;
            }).join('')
          : `<div class="cal-d-empty">${translate('paneo.calendar.noEvents', locale)}</div>`;
        el.innerHTML = `<div class="w-cal-day">
          <div class="cal-d-header">${headerFor('day', null, now)}</div>
          <div class="cal-d-list">${rows}</div>
        </div>`;
      }

      function renderGridView(view, now, cells, eventsByDate, showEventTime) {
        const todayStr = isoDate(now);
        const curYear = now.getFullYear();
        const curMonth = now.getMonth();
        const showWN = !!config.showWeekNumber;
        const cols = showWN ? 8 : 7;
        const weekRows = Math.ceil(cells.length / 7);

        let headerRow = '';
        if (showWN) headerRow += `<div class="cal-m-cell cal-m-wn-hdr"></div>`;
        headerRow += dayNames.map((d, i) => {
          const isSun = config.startOnSunday ? i === 0 : i === 6;
          const isSat = config.startOnSunday ? i === 6 : i === 5;
          const cls = isSat ? ' cal-m-sat' : isSun ? ' cal-m-sun' : '';
          return `<div class="cal-m-cell cal-m-day-hdr${cls}">${d}</div>`;
        }).join('');

        let bodyRows = '';
        for (let row = 0; row * 7 < cells.length; row++) {
          if (showWN) {
            // ISO week number of the first day of this row (adapted to Sunday start if set)
            const d = cells[row * 7];
            const jan4 = new Date(d.getFullYear(), 0, 4);
            const startOfWeek1 = new Date(jan4);
            const offsetToStart = config.startOnSunday ? jan4.getDay() : ((jan4.getDay() + 6) % 7);
            startOfWeek1.setDate(jan4.getDate() - offsetToStart);
            const wn = Math.round((d - startOfWeek1) / (7 * 86400000)) + 1;
            bodyRows += `<div class="cal-m-cell cal-m-wn">${wn}</div>`;
          }
          for (let col = 0; col < 7; col++) {
            const d = cells[row * 7 + col];
            if (!d) { bodyRows += `<div class="cal-m-cell"></div>`; continue; }
            const ds = isoDate(d);
            const isToday = ds === todayStr;
            const isOtherMonth = d.getFullYear() !== curYear || d.getMonth() !== curMonth;
            const isSat = config.startOnSunday ? col === 6 : col === 5;
            const isSun = config.startOnSunday ? col === 0 : col === 6;
            let cls = 'cal-m-cell cal-m-day';
            if (isToday) cls += ' cal-m-today';
            if (isOtherMonth) cls += ' cal-m-other';
            if (isSat) cls += ' cal-m-sat';
            if (isSun) cls += ' cal-m-sun';

            const events = (eventsByDate[ds] || []);
            const eventHtml = events.slice(0, 3).map((e) => {
              const showTime = showEventTime && !e.allDay;
              const past = isCalendarEventPast(e, now, todayStr, tz);
              // A little more title budget when there's no time prefix eating
              // into the same line's width.
              const title = String(e.summary || '').slice(0, showTime ? 12 : 14);
              const color = urlColors[e.source] || '';
              const style = color ? `style="background:${color}33; border-left:2px solid ${color}; padding-left:2px"` : '';
              const timeHtml = showTime ? `<span class="cal-m-event-time">${timeFmt.format(new Date(e.start))}</span>` : '';
              return `<div class="cal-m-event${past ? ' cal-m-event-past' : ''}" ${style} title="${escapeAttr(e.summary)}">${timeHtml}${escapeHtml(title)}</div>`;
            }).join('');
            const moreCount = events.length > 3 ? `<div class="cal-m-more">+${events.length - 3}</div>` : '';

            bodyRows += `<div class="${cls}">
              <div class="cal-m-dnum">${d.getDate()}</div>
              ${eventHtml}${moreCount}
            </div>`;
          }
        }

        el.innerHTML = `<div class="w-cal-month">
          <div class="cal-m-header">${headerFor(view, cells, now)}</div>
          <div class="cal-m-grid" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:auto repeat(${weekRows},1fr)">
            ${headerRow}${bodyRows}
          </div>
        </div>`;
      }

      let currentView = null;
      let showEventTime = false;
      let ro = null;

      function paintAndFetch() {
        const now = new Date();
        const cells = cellsForView(currentView, now);

        function renderAll(eventsByDate = {}) {
          if (currentView === 'day') renderDayView(now, eventsByDate);
          else renderGridView(currentView, now, cells, eventsByDate, showEventTime);
        }

        // Paint immediately (empty or last-known events), then fetch.
        renderAll();

        if (!parsedUrls.length) return;

        // Bound the fetch to exactly the span this view shows, so every event
        // in view comes back — not just the next ~15 upcoming ones (that
        // "upcoming" cap is correct for paneo.calendar's list view, but would
        // silently drop events on later days of a busy week/month here).
        const rangeFrom = cells[0];
        const rangeTo = new Date(cells[cells.length - 1].getTime() + 24 * 3600 * 1000);
        const rangeQuery = `&from=${encodeURIComponent(rangeFrom.toISOString())}&to=${encodeURIComponent(rangeTo.toISOString())}`;

        pollJson(
          el, `/api/proxy/ical?${multiUrlQuery(parsedUrls)}${rangeQuery}`, pollInterval(30 * 60_000, ctx),
          (data) => {
            // Index events by their local date string
            const byDate = {};
            for (const ev of data.events || []) {
              // Use device timezone if set, otherwise local
              const d = new Date(ev.start);
              const ds = tz
                ? new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(d)
                : isoDate(d);
              if (!byDate[ds]) byDate[ds] = [];
              byDate[ds].push(ev);
            }
            renderAll(byDate);
          },
          (err) => {
            // Keep the grid, just show a small error indicator
            const errEl = document.createElement('div');
            errEl.className = 'cal-m-fetch-err';
            errEl.textContent = err.message;
            el.querySelector('.w-cal-month, .w-cal-day')?.appendChild(errEl);
          },
        );
        // pollJson just overwrote el._cleanup with its own poll-interval
        // cleanup — wrap it so the ResizeObserver still gets disconnected
        // when the widget is torn down or re-rendered.
        const pollCleanup = el._cleanup;
        el._cleanup = () => { pollCleanup?.(); ro?.disconnect(); };
      }

      ro = new ResizeObserver((entries) => {
        const { width, height } = entries[0].contentRect;
        const nextView = pickView(width, height);
        const nextShowEventTime = shouldShowGridEventTime(nextView, width, height);
        if (nextView !== currentView || nextShowEventTime !== showEventTime) {
          currentView = nextView;
          showEventTime = nextShowEventTime;
          paintAndFetch();
        }
      });
      ro.observe(el);
      el._cleanup = () => ro.disconnect(); // covers the no-ICS-configured case, where paintAndFetch() never reaches pollJson

      // Initial paint uses the current box size synchronously — ResizeObserver's
      // first callback fires on the next frame, and waiting for it would flash
      // the wrong view for one frame on every fresh render.
      const rect = el.getBoundingClientRect();
      currentView = pickView(rect.width, rect.height);
      showEventTime = shouldShowGridEventTime(currentView, rect.width, rect.height);
      paintAndFetch();
    },
  },

  'paneo.rss': {
    version: '1.1.0',
    label: { ko: 'RSS/뉴스', en: 'RSS / News', ja: 'RSS / ニュース', de: 'RSS / News', fr: 'Flux RSS / Infos', es: 'RSS / Noticias' },
    icon: '📰',
    category: 'data',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 2, h: 2 },
    requires: [],
    permissions: [],
    config: [
      { key: 'feedUrls', label: { ko: 'RSS 피드 URL', en: 'RSS feed URLs', ja: 'RSSフィードURL', de: 'RSS-Feed-URLs', fr: 'URL du flux RSS', es: 'URLs del canal RSS' }, type: 'list', default: [] },
      { key: 'scrollSpeed', label: { ko: '스크롤 속도', en: 'Scroll speed', ja: 'スクロール速度', de: 'Scrollgeschwindigkeit', fr: 'Vitesse de défilement', es: 'Velocidad de desplazamiento' }, type: 'enum', options: ['off', 'slow', 'normal', 'fast'], default: 'normal' },
    ],
    render(el, config, ctx = {}) {
      const urls = cleanUrlList(config.feedUrls);
      if (!urls.length) { errorBox(el, ctx.locale?.startsWith('ko') !== false ? 'RSS URL을 입력하세요' : 'Set an RSS URL'); return; }
      loadingBox(el, '...');
      const locale = ctx.locale || 'ko-KR';
      const tz = ctx.timezone || undefined;
      const dateFmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz });

      // Per-item publish date only shows once the widget is tall enough to
      // afford the extra line — same size-adaptive pattern used elsewhere
      // (calendar/HA weather/paneo.weather); title-only list below that.
      const RSS_DATE_MIN_HEIGHT = 200;
      let latestItems = null; // most recent full batch from the feed (also the "loop the same feed" fallback when nothing new has polled in)
      let pendingItems = null; // a newer batch that arrived while the ticker was mid-cycle — applied at the next wrap, not immediately

      // Step-and-hold ticker: scroll exactly one headline to the top (native
      // `scroll-behavior:smooth`, not a hand-rolled per-frame animation —
      // manually assigning fractional scrollTop every frame caused visible
      // flicker), hold it for a dwell period, then advance to the next. After
      // the last real item, the *next* batch's first item is appended right
      // after it and scrolled to next — so a poll that lands mid-cycle only
      // ever becomes visible right as it would naturally scroll up from
      // below, never as a mid-cycle jump — then the old batch is pruned.
      const DWELL_MS = { off: 0, slow: 6000, normal: 4000, fast: 2000 };
      // Generous upper bound for the native smooth-scroll of one item to
      // finish before pruning — must stay well below every active DWELL_MS
      // value above, since the prune is expected to complete *within* the
      // normal dwell window (see wrapToNextBatch), not add to it.
      const WRAP_SETTLE_MS = 700;
      let ticker = null; // { ulEl, current, pos, showDate, dwellMs, timer, pruneTimer }

      function stopTicker() {
        if (ticker?.timer) clearTimeout(ticker.timer);
        if (ticker?.pruneTimer) clearTimeout(ticker.pruneTimer);
        ticker = null;
      }

      function itemTop(ulEl, liEl) {
        // offsetTop is relative to offsetParent, which may not be the scroll
        // container itself (e.g. it can bubble up to a positioned ancestor) —
        // this measures the item's position within ulEl's own scrollable
        // content regardless of where offsetParent resolves to.
        return liEl.getBoundingClientRect().top - ulEl.getBoundingClientRect().top + ulEl.scrollTop;
      }

      function itemHtml(it, showDate) {
        const dateHtml = (showDate && it.isoDate) ? `<span class="rss-date">${dateFmt.format(new Date(it.isoDate))}</span>` : '';
        const href = safeHttpUrl(it.link);
        return `<li><a href="${escapeAttr(href)}" target="_blank" rel="noopener">${escapeHtml(it.title)}</a>${dateHtml}</li>`;
      }

      function scheduleStep() {
        if (!ticker || ticker.dwellMs <= 0) return;
        ticker.timer = setTimeout(step, ticker.dwellMs);
      }

      function wrapToNextBatch() {
        const { ulEl, current } = ticker;
        // Reached the last item of the current batch — bring in whatever the
        // "next" batch is (a fresher poll if one is waiting, otherwise the
        // same batch again so a feed with no update still loops forever).
        const nextBatch = pendingItems || latestItems;
        pendingItems = null;
        const oldCount = current.length;
        ulEl.insertAdjacentHTML('beforeend', nextBatch.map((it) => itemHtml(it, ticker.showDate)).join(''));
        ticker.pos = oldCount;
        ulEl.scrollTop = itemTop(ulEl, ulEl.children[ticker.pos]);
        // Prune the old batch invisibly in the background, well inside the
        // upcoming dwell window (scheduled below) rather than after it —
        // otherwise this position would hold for WRAP_SETTLE_MS longer than
        // every other item, making the loop (a1->a2->a3->a1->a2->a3->...)
        // feel like it pauses/restarts instead of cycling continuously.
        ticker.pruneTimer = setTimeout(() => {
          // The old batch has fully scrolled out of view — drop it so the
          // DOM/scroll position don't grow without bound over a long uptime.
          for (let i = 0; i < oldCount; i++) ulEl.removeChild(ulEl.firstElementChild);
          // Rebasing scrollTop must be instant — with CSS scroll-behavior:smooth
          // in effect, a plain assignment here would visibly animate the
          // "scroll back down" glitch instead of silently re-basing bookkeeping.
          ulEl.style.scrollBehavior = 'auto';
          ulEl.scrollTop = itemTop(ulEl, ulEl.children[0]);
          ulEl.style.scrollBehavior = '';
          ticker.current = nextBatch;
          ticker.pos = 0;
        }, WRAP_SETTLE_MS);
        scheduleStep();
      }

      function step() {
        if (!ticker) return;
        const { ulEl, current } = ticker;
        if (ticker.pos < current.length - 1) {
          const maxScroll = ulEl.scrollHeight - ulEl.clientHeight;
          const target = Math.min(itemTop(ulEl, ulEl.children[ticker.pos + 1]), maxScroll);
          // A short list can run out of room to scroll before running out of
          // items — bringing the very last item flush to the top would mean
          // scrolling past the end of the content, which the browser clamps.
          // Once advancing wouldn't move anything further, there's nothing
          // left to reveal from this batch, so go straight to the next one
          // instead of dwelling through several identical-looking steps.
          if (target <= ulEl.scrollTop + 1) {
            wrapToNextBatch();
            return;
          }
          ticker.pos++;
          ulEl.scrollTop = target;
          scheduleStep();
          return;
        }
        wrapToNextBatch();
      }

      function renderList(items, showDate) {
        stopTicker();
        pendingItems = null;
        const html = items.map((it) => itemHtml(it, showDate)).join('');
        el.innerHTML = `<ul class="w-rss">${html || '<li>-</li>'}</ul>`;
        if (!html) return;
        const ulEl = el.querySelector('.w-rss');
        const dwellMs = DWELL_MS[config.scrollSpeed] ?? DWELL_MS.normal;
        if (dwellMs <= 0) return; // 'off' — static list, no ticking
        if (ulEl.scrollHeight <= ulEl.clientHeight + 4) return; // fits — nothing to tick through
        ticker = { ulEl, current: items, pos: 0, showDate, dwellMs, timer: null };
        scheduleStep();
      }

      // ResizeObserver is spec'd to always fire at least once when observation
      // starts, and can legitimately fire its callback several more times in
      // a row while a layout pass settles — even with no real size change.
      // Every other size-adaptive widget in this file guards against that by
      // only re-rendering when a boolean threshold flips; a resize here needs
      // to rebuild at any size change (not just a threshold), so the guard
      // has to compare the actual observed size instead of a derived flag —
      // without it, each redundant callback tears down and restarts the
      // ticker, which looks like the whole thing stalling/skipping items.
      let lastSize = null;
      const ro = new ResizeObserver((entries) => {
        if (!latestItems) return;
        const { width, height } = entries[0].contentRect;
        if (lastSize && lastSize.width === width && lastSize.height === height) return;
        lastSize = { width, height };
        renderList(latestItems, height >= RSS_DATE_MIN_HEIGHT);
      });
      ro.observe(el);

      pollJson(
        el, `/api/proxy/rss?${multiUrlQuery(urls)}`, pollInterval(15 * 60_000, ctx),
        (data) => {
          const items = data.items || [];
          latestItems = items;
          if (ticker) {
            // Ticker is actively cycling — defer showing this until the
            // natural wrap point instead of yanking the content mid-cycle.
            pendingItems = items;
          } else {
            const rect = el.getBoundingClientRect();
            renderList(items, rect.height >= RSS_DATE_MIN_HEIGHT);
          }
        },
        (err) => errorBox(el, err.message),
      );
      const pollCleanup = el._cleanup;
      el._cleanup = () => { pollCleanup?.(); ro.disconnect(); stopTicker(); };
    },
  },

  'paneo.iframe': {
    version: '1.1.0',
    label: { ko: '외부 페이지', en: 'External page', ja: '外部ページ', de: 'Externe Seite', fr: 'Page externe', es: 'Página externa' },
    icon: '🌐',
    category: 'media',
    defaultSize: { w: 5, h: 4 },
    minSize: { w: 2, h: 2 },
    requires: [],
    permissions: ['embed:external-page'],
    sandbox: 'iframe',
    config: [
      { key: 'url', label: { ko: '웹페이지 URL', en: 'Page URL', ja: 'ウェブページURL', de: 'Webseiten-URL', fr: 'URL de la page', es: 'URL de la página' }, type: 'text', default: '' },
      { key: 'sandboxMode', label: { ko: '샌드박스 모드', en: 'Sandbox mode', ja: 'サンドボックスモード', de: 'Sandbox-Modus', fr: 'Mode bac à sable', es: 'Modo sandbox' }, type: 'enum', options: ['scripts', 'strict', 'trusted'], default: 'scripts' },
    ],
    render(el, config, ctx = {}) {
      const url = safeHttpUrl(config.url);
      if (!String(config.url || '').trim()) {
        el.innerHTML = `<div class="w-image w-placeholder"></div>`;
        return;
      }
      if (!url) {
        errorBox(el, ctx.locale?.startsWith('ko') !== false ? 'http/https URL만 사용할 수 있습니다' : 'Only http/https URLs are allowed');
        return;
      }
      const sandbox = sandboxTokens(config.sandboxMode || 'scripts');
      el.innerHTML = url
        ? `<iframe class="w-iframe" src="${escapeAttr(url)}" sandbox="${escapeAttr(sandbox)}" referrerpolicy="no-referrer" loading="lazy"></iframe>`
        : `<div class="w-image w-placeholder"></div>`;
    },
  },

  // §M3 D9: Multi-target timer widget — countdown to / elapsed since a daily recurring time.
  // Multiple timers in a single widget instance (list config).
  // Pure client-side, no server calls. design decision B (multiple timers per widget).
  'paneo.timer': {
    version: '1.0.0',
    label: { ko: '알람 타이머', en: 'Alarm timer', ja: 'アラームタイマー', de: 'Alarm-Timer', fr: 'Minuteur d’alarme', es: 'Temporizador de alarma' },
    icon: '⏱️',
    category: 'basic',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 1 },
    requires: [],
    permissions: [],
    config: [
      {
        // §"타이머 입력 쉽게" — one structured row per timer (label/time/mode/showAt/hideAt
        // inputs, incl. native <input type=time> pickers) instead of a single
        // hand-typed "label|HH:MM|mode|showAt|hideAt" string. render() below still
        // accepts the old pipe-string shape too, for any layout saved before this.
        key: 'timers',
        label: { ko: '타이머 목록', en: 'Timers', ja: 'タイマー一覧', de: 'Timer-Liste', fr: 'Liste des minuteurs', es: 'Lista de temporizadores' },
        type: 'timerList',
        default: [],
      },
    ],
    render(el, config, ctx = {}) {
      // Each timer entry is normally an object: { label, time, mode, showAt, hideAt }
      // (built by the inspector's per-field timerList rows). The old hand-typed
      // "label|HH:MM[:SS]|mode|showAt|hideAt" pipe-string is still accepted here for
      // any layout saved before the structured-row inspector existed.
      // mode: countdown | countup | both  (default: both)
      // showAt/hideAt (both optional, HH:MM): the row only renders while "now" is
      // inside [showAt, hideAt) — omit both for the old always-visible behavior.
      const rawList = Array.isArray(config.timers) ? config.timers : [];
      const showSec = true;

      function normalizeEntry(raw) {
        if (raw && typeof raw === 'object') {
          return {
            label: raw.label || '',
            hhmm: raw.time || '',
            showAt: raw.showAt || '',
            hideAt: raw.hideAt || '',
          };
        }
        const parts = String(raw || '').split('|');
        const label = parts[0]?.trim() || '';
        const hhmm = parts[1]?.trim() || '';
        const showAt = parts[3]?.trim() || '';
        const hideAt = parts[4]?.trim() || '';
        return { label, hhmm, showAt, hideAt };
      }

      function tick() {
        if (!rawList.length) {
          el.innerHTML = `<div class="w-timer w-timer-empty">
            <div class="timer-hint">${ctx.locale?.startsWith('ko') !== false
              ? '속성 패널에서 타이머를 추가하세요'
              : 'Add a timer in the properties panel'}</div>
          </div>`;
          return;
        }

        const now = new Date();
        const entries = rawList.map(normalizeEntry).filter((entry) => isEntryVisible(entry.showAt, entry.hideAt, now));

        if (!entries.length) {
          // Every configured timer is outside its show/hide window right now —
          // the widget itself goes empty rather than showing stale/irrelevant rows.
          el.innerHTML = '';
          return;
        }

        const rows = entries.map(({ label, hhmm }) => {
          const target = parseTargetTime(hhmm);
          if (!target) return `<div class="timer-row timer-invalid">${label || '?'} — invalid time</div>`;

          const diffSec = Math.round((now - target) / 1000);
          const cls = diffSec < 0 ? 'timer-future' : 'timer-past';
          const formatted = showSec ? formatDuration(diffSec, true) : formatDuration(Math.round(diffSec / 60) * 60, true);

          return `<div class="timer-row">
            <div class="timer-label">${label}</div>
            <div class="timer-val ${cls}">${formatted}</div>
          </div>`;
        }).join('');

        el.innerHTML = `<div class="w-timer">${rows}</div>`;
      }

      tick();
      // Aligned to the real second boundary (scheduleSecondTick) when
      // showing seconds, so the countdown's last digit changes at the same
      // instant as the clock widget's -- a plain setInterval(tick, 1000)
      // here ticked 1000ms after whenever *this* widget happened to mount,
      // which visibly disagreed with any other per-second widget's own
      // arbitrary offset.
      const cancelTick = showSec
        ? scheduleSecondTick(tick)
        : (() => { const t = setInterval(tick, 10000); return () => clearInterval(t); })();
      el._cleanup = () => cancelTick();
    },
  },

  'paneo.homeassistant': {
    version: '1.0.0',
    label: { ko: '홈어시스턴트', en: 'Home Assistant', ja: 'Home Assistant', de: 'Home Assistant', fr: 'Home Assistant', es: 'Home Assistant' },
    icon: '🏠',
    category: 'data',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 1 },
    requires: [],
    permissions: [],
    config: [
      { key: 'entityId', label: { ko: '엔티티 ID', en: 'Entity ID', ja: 'エンティティID', de: 'Entitäts-ID', fr: 'ID de l’entité', es: 'ID de la entidad' }, type: 'text', default: '' },
      { key: 'title', label: { ko: '제목 (선택)', en: 'Title (optional)', ja: 'タイトル (オプション)', de: 'Titel (optional)', fr: 'Titre (optionnel)', es: 'Título (opcional)' }, type: 'text', default: '' },
      { key: 'icon', label: { ko: '아이콘 (단일 이모지)', en: 'Icon (emoji)', ja: 'アイコン (絵文字1文字)', de: 'Symbol (Emoji)', fr: 'Icône (émoji)', es: 'Icono (emoji)' }, type: 'text', default: '' },
      { key: 'showToggle', label: { ko: '스위치 토글 허용', en: 'Allow toggle switch', ja: 'スイッチのトグルを許可', de: 'Umschalten erlauben', fr: 'Autoriser le commutateur', es: 'Permitir interruptor' }, type: 'checkbox', default: false }
    ],
    render(el, config, ctx = {}) {
      const entityId = String(config.entityId || '').trim();
      if (!entityId) {
        errorBox(el, ctx.locale?.startsWith('ko') !== false ? '엔티티 ID를 입력하세요' : 'Set an Entity ID');
        return;
      }
      loadingBox(el, '...');

      const isKo = ctx.locale?.startsWith('ko') !== false;
      const locale = ctx.locale || 'ko-KR';
      const tz = ctx.timezone || undefined;
      const isWeather = entityId.startsWith('weather.');

      // Forecast only makes sense (and is only fetched) for weather.* entities,
      // and only shown once the widget is tall enough to hold a forecast row —
      // otherwise it's the same compact current-conditions card as before.
      // Fetched at most once per widget instance (memoized promise): forecast
      // doesn't change on the state poll's 30s cadence the way current
      // conditions do, and re-requesting it every tick would be pointless load
      // on the HA server for data that's still the same.
      // Three tiers instead of one on/off threshold — a 5-day forecast row
      // squeezed into a barely-tall-enough widget renders every column too
      // small to read comfortably, so a shorter widget gets a 3-day forecast
      // instead (fewer, wider columns — see the `.fc-3` CSS variant) and only
      // a genuinely tall widget gets the full 5 days.
      const HA_FC_3DAY_MIN_HEIGHT = 200;
      const HA_FC_5DAY_MIN_HEIGHT = 320;
      function pickForecastDays(height) {
        if (height >= HA_FC_5DAY_MIN_HEIGHT) return 5;
        if (height >= HA_FC_3DAY_MIN_HEIGHT) return 3;
        return 0;
      }
      let forecastPromise = null;
      let latestState = null;
      let lastFcDays = -1;
      let ro = null;

      // Best-effort: forecast moved from a state attribute (older HA) to the
      // weather.get_forecasts service (HA 2023.9+), which only returns data
      // over the REST API via the `return_response` convention (src/server.js
      // forwards it as a query param). Both shapes — and every failure mode
      // (older HA without the service, network error, unexpected response
      // shape) — degrade silently to the current-conditions-only card, since
      // this is the one part of the widget genuinely dependent on the user's
      // specific HA version.
      async function fetchForecast() {
        try {
          const res = await fetch(`/api/proxy/ha/services/weather/get_forecasts?return_response`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity_id: entityId, type: 'daily' }),
          });
          if (!res.ok) return null;
          const json = await res.json();
          return json?.service_response?.[entityId]?.forecast || null;
        } catch {
          return null;
        }
      }
      function getForecast() {
        if (!forecastPromise) forecastPromise = fetchForecast();
        return forecastPromise;
      }

      function renderWeatherCard(data, forecast, fcDays) {
        lastFcDays = fcDays;
        const state = data.state;
        const attrs = data.attributes || {};
        const friendlyName = config.title || attrs.friendly_name || entityId;
        const conditionIcon = HA_WEATHER_ICONS[state] || '🌡️';
        const conditionText = translate('paneo.ha.weather.' + state, locale, state);
        const temp = attrs.temperature;
        const tempUnit = attrs.temperature_unit || '°C';
        const humidity = attrs.humidity;
        const windSpeed = attrs.wind_speed;
        const windUnit = attrs.wind_speed_unit || '';

        const forecastHtml = (fcDays > 0 && forecast?.length)
          ? `<div class="ha-weather-forecast${fcDays === 3 ? ' fc-3' : ''}">${forecast.slice(0, fcDays).map((f) => {
              const wd = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: tz }).format(new Date(f.datetime));
              const icon = HA_WEATHER_ICONS[f.condition] || '🌡️';
              const hi = f.temperature != null ? `${Math.round(f.temperature)}°` : '-';
              const lo = f.templow != null ? `/${Math.round(f.templow)}°` : '';
              return `<div class="ha-fc-day">
                <div class="ha-fc-wd">${wd}</div>
                <div class="ha-fc-icon">${icon}</div>
                <div class="ha-fc-temp">${hi}${lo}</div>
              </div>`;
            }).join('')}</div>`
          : '';

        el.innerHTML = `
          <div class="w-ha w-ha-weather">
            <div class="ha-header">
              <span class="ha-icon">${conditionIcon}</span>
              <span class="ha-title">${friendlyName}</span>
            </div>
            <div class="ha-weather-body">
              ${temp != null ? `<div class="ha-weather-temp">${Math.round(temp)}${tempUnit}</div>` : ''}
              <div class="ha-weather-cond">${conditionText}</div>
              <div class="ha-weather-meta">
                ${humidity != null ? `<span>💧 ${humidity}%</span>` : ''}
                ${windSpeed != null ? `<span>💨 ${windSpeed}${windUnit}</span>` : ''}
              </div>
            </div>
            ${forecastHtml}
          </div>
        `;
        fitTextToBox(el.querySelector('.ha-title'));
        fitTextToBox(el.querySelector('.ha-weather-temp'));
      }

      const renderData = async (data) => {
        const attrs = data.attributes || {};
        const state = data.state;

        // weather.* entities get a dedicated card (icon/temp/condition/humidity,
        // optionally + forecast) instead of the generic state display — the raw
        // state is just a condition keyword ("sunny"/"rainy"/...), not something
        // worth showing as-is next to a bare number the way a sensor's state is.
        if (isWeather) {
          latestState = data;
          const rect = el.getBoundingClientRect();
          const fcDays = pickForecastDays(rect.height);
          const forecast = fcDays > 0 ? (attrs.forecast || await getForecast()) : null;
          renderWeatherCard(data, forecast, fcDays);
          return;
        }

        const friendlyName = config.title || attrs.friendly_name || entityId;
        const emojiIcon = config.icon || (entityId.startsWith('light') ? '💡' : entityId.startsWith('switch') ? '🔌' : entityId.startsWith('sensor') ? '🌡️' : '⚙️');
        const unit = attrs.unit_of_measurement || '';

        let displayState = state;
        if (state === 'on') displayState = translate('paneo.homeassistant.on', locale, 'ON');
        else if (state === 'off') displayState = translate('paneo.homeassistant.off', locale, 'OFF');
        else if (state === 'unavailable') displayState = translate('paneo.homeassistant.unavailable', locale, 'Unavailable');

        const isControl = config.showToggle && (entityId.startsWith('switch') || entityId.startsWith('light') || entityId.startsWith('input_boolean'));
        const controlBtnHtml = isControl
          ? `<button class="ha-toggle-btn" data-entity-id="${entityId}">${displayState}</button>`
          : `<div class="ha-state-val">${displayState}${unit}</div>`;

        el.innerHTML = `
          <div class="w-ha">
            <div class="ha-header">
              <span class="ha-icon">${emojiIcon}</span>
              <span class="ha-title">${friendlyName}</span>
            </div>
            <div class="ha-body">
              ${controlBtnHtml}
            </div>
          </div>
        `;
        // The friendly_name/state come from Home Assistant and can be
        // arbitrarily long (unlike our own built-in widgets' text) — shrink
        // to fit rather than silently overflow the widget box.
        fitTextToBox(el.querySelector('.ha-title'));
        if (!isControl) fitTextToBox(el.querySelector('.ha-state-val'));

        if (isControl) {
          const btn = el.querySelector('.ha-toggle-btn');
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            btn.disabled = true;
            btn.textContent = '...';
            try {
              const res = await fetch(`/api/proxy/ha/services/homeassistant/toggle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity_id: entityId })
              });
              if (!res.ok) throw new Error();

              // 제어 후 즉시 상태 재조회
              const stateRes = await fetch(`/api/proxy/ha/states/${entityId}`);
              const newState = await stateRes.json();
              renderData(newState);
            } catch {
              btn.disabled = false;
              btn.textContent = displayState;
            }
          });
        }
      };

      // Re-render (no re-fetch — the poll above already keeps latestState/the
      // forecast promise current) whenever crossing a forecast-tier height
      // threshold, so resizing the widget in the editor toggles between
      // none/3-day/5-day live, the same way paneo.calendar.month's view
      // switches. Compares against the last *applied* tier (not the current
      // DOM's day count) — a feed that returns fewer days than requested
      // would otherwise never match the requested tier and re-render forever.
      if (isWeather) {
        ro = new ResizeObserver((entries) => {
          if (!latestState) return;
          const fcDays = pickForecastDays(entries[0].contentRect.height);
          if (fcDays === lastFcDays) return;
          if (fcDays > 0) {
            getForecast().then((forecast) => renderWeatherCard(latestState, forecast, fcDays));
          } else {
            renderWeatherCard(latestState, null, 0);
          }
        });
        ro.observe(el);
      }

      pollJson(
        el, `/api/proxy/ha/states/${entityId}`, pollInterval(30_000, ctx),
        renderData,
        (err) => errorBox(el, err.message)
      );
      if (ro) {
        // pollJson just overwrote el._cleanup with its own poll-interval
        // cleanup — wrap it so the ResizeObserver still gets disconnected.
        const pollCleanup = el._cleanup;
        el._cleanup = () => { pollCleanup?.(); ro.disconnect(); };
      }
    }
  },

  'paneo.worldclock': {
    version: '1.0.0',
    label: { ko: '세계시계', en: 'World clock', ja: '世界時計', de: 'Weltzeituhr', fr: 'Horloge mondiale', es: 'Reloj mundial' },
    icon: '🌐',
    category: 'basic',
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 1 },
    requires: [],
    permissions: [],
    config: [
      {
        key: 'cities', label: { ko: '도시 목록', en: 'Cities', ja: '都市一覧', de: 'Städteliste', fr: 'Liste des villes', es: 'Lista de ciudades' }, type: 'structList', default: [],
        fields: [
          { key: 'label', label: { ko: '라벨', en: 'Label', ja: 'ラベル', de: 'Label', fr: 'Libellé', es: 'Etiqueta' }, type: 'text', placeholder: { ko: '도쿄', en: 'Tokyo', ja: '東京', de: 'Tokio', fr: 'Tokyo', es: 'Tokio' } },
          { key: 'tz', label: { ko: '타임존(IANA)', en: 'Timezone (IANA)', ja: 'タイムゾーン (IANA)', de: 'Zeitzone (IANA)', fr: 'Fuseau horaire (IANA)', es: 'Zona horaria (IANA)' }, type: 'text', placeholder: { ko: 'Asia/Tokyo', en: 'Asia/Tokyo', ja: 'Asia/Tokyo', de: 'Asia/Tokyo', fr: 'Asia/Tokyo', es: 'Asia/Tokyo' } },
        ],
      },
      { key: 'hour12', label: { ko: '12시간제', en: '12-hour', ja: '12時間制', de: '12-Stunden-Format', fr: 'Format 12 heures', es: 'Formato de 12 horas' }, type: 'checkbox', default: false },
    ],
    render(el, config, ctx = {}) {
      const locale = ctx.locale || 'ko-KR';
      const entries = (Array.isArray(config.cities) ? config.cities : [])
        .filter((e) => e && typeof e === 'object' && String(e.tz || '').trim())
        .map((e) => ({ label: String(e.label || '').trim() || e.tz, tz: String(e.tz).trim() }));

      if (!entries.length) {
        errorBox(el, locale.startsWith('ko') ? '도시를 추가하세요 (예: 도쿄|Asia/Tokyo)' : 'Add a city (e.g. Tokyo|Asia/Tokyo)');
        return;
      }

      const update = () => {
        const now = new Date();
        const rows = entries.map(({ label, tz }) => {
          let time = '-';
          try {
            time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: !!config.hour12, timeZone: tz }).format(now);
          } catch { /* invalid IANA tz name — show '-' */ }
          return `<div class="wc-row"><span class="wc-label">${label}</span><span class="wc-time">${time}</span></div>`;
        }).join('');
        el.innerHTML = `<div class="w-worldclock">${rows}</div>`;
      };
      update();
      const cancelTick = scheduleSecondTick(update);
      el._cleanup = () => cancelTick();
    },
  },

  'paneo.dday': {
    version: '1.0.0',
    label: { ko: 'D-Day 카운트다운', en: 'D-Day countdown', ja: 'D-Dayカウントダウン', de: 'D-Day-Countdown', fr: 'Compte à rebours D-Day', es: 'Cuenta regresiva D-Day' },
    icon: '📆',
    category: 'basic',
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 1 },
    requires: [],
    permissions: [],
    config: [
      {
        key: 'events', label: { ko: '이벤트 목록', en: 'Events', ja: 'イベント一覧', de: 'Ereignisliste', fr: 'Liste des événements', es: 'Lista de eventos' }, type: 'structList', default: [],
        fields: [
          { key: 'label', label: { ko: '라벨', en: 'Label', ja: 'ラベル', de: 'Label', fr: 'Libellé', es: 'Etiqueta' }, type: 'text', placeholder: { ko: '생일', en: 'Birthday', ja: '誕生日', de: 'Geburtstag', fr: 'Anniversaire', es: 'Cumpleaños' } },
          { key: 'date', label: { ko: '날짜', en: 'Date', ja: '日付', de: 'Datum', fr: 'Date', es: 'Fecha' }, type: 'date' },
        ],
      },
    ],
    render(el, config, ctx = {}) {
      const locale = ctx.locale || 'ko-KR';
      const entries = (Array.isArray(config.events) ? config.events : [])
        .map((e) => {
          if (!e || typeof e !== 'object' || !e.date) return null;
          const target = new Date(`${e.date}T00:00:00`);
          return isNaN(target) ? null : { label: String(e.label || '').trim() || e.date, target };
        })
        .filter(Boolean);

      if (!entries.length) {
        errorBox(el, locale.startsWith('ko') ? '이벤트를 추가하세요 (예: 생일|2026-12-25)' : 'Add an event (e.g. Birthday|2026-12-25)');
        return;
      }

      const DAY_MS = 24 * 3600 * 1000;
      const update = () => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const rows = entries.map(({ label, target }) => {
          const diffDays = Math.round((target - today) / DAY_MS);
          const ddayText = diffDays === 0 ? 'D-DAY' : diffDays > 0 ? `D-${diffDays}` : `D+${-diffDays}`;
          return `<div class="dday-row"><span class="dday-label">${label}</span><span class="dday-val">${ddayText}</span></div>`;
        }).join('');
        el.innerHTML = `<div class="w-dday">${rows}</div>`;
      };
      update();
      // Minute-boundary aligned -- see paneo.date's identical comment on why
      // a plain setInterval(update, 60000) can leave a real day-rollover
      // reflected up to 59s late.
      const cancelTick = scheduleBoundaryTick(60000, update);
      el._cleanup = () => cancelTick();
    },
  },

  'paneo.todo': {
    version: '1.0.0',
    label: { ko: '할 일 목록', en: 'To-do list', ja: 'ToDoリスト', de: 'Aufgabenliste', fr: 'Liste des tâches', es: 'Lista de tareas' },
    icon: '✅',
    category: 'basic',
    defaultSize: { w: 3, h: 4 },
    minSize: { w: 2, h: 2 },
    requires: [],
    permissions: [],
    config: [
      {
        key: 'todoItems', label: { ko: '할 일', en: 'Items', ja: '項目', de: 'Elemente', fr: 'Éléments', es: 'Elementos' }, type: 'structList', default: [],
        fields: [
          { key: 'done', label: { ko: '완료', en: 'Done', ja: '完了', de: 'Erledigt', fr: 'Fait', es: 'Hecho' }, type: 'checkbox' },
          { key: 'text', label: { ko: '내용', en: 'Text', ja: '内容', de: 'Text', fr: 'Texte', es: 'Texto' }, type: 'text', placeholder: { ko: '할 일 내용', en: 'Item text', ja: 'ToDoの内容', de: 'Aufgabentext', fr: 'Texte de la tâche', es: 'Texto de la tarea' } },
        ],
      },
    ],
    render(el, config, ctx = {}) {
      const locale = ctx.locale || 'ko-KR';
      const isKo = locale.startsWith('ko');
      const rawItems = Array.isArray(config.todoItems) ? config.todoItems : [];
      // `index` is the position in the *unfiltered* config.todoItems array — the
      // one the server's toggle/add/delete-todo routes address — so it must be
      // captured before filtering out empty rows, not renumbered after.
      const entries = rawItems
        .map((e, index) => (e && typeof e === 'object' && String(e.text || '').trim())
          ? { done: !!e.done, text: String(e.text).trim(), index }
          : null)
        .filter(Boolean);

      // Tap-to-toggle/add/delete only make sense on a real display (a real
      // pairing token + widget id to address) — the editor canvas preview
      // (ctx.preview) renders the same read-only markup the inspector shows.
      const interactive = !ctx.preview && ctx.deviceToken && ctx.widgetId;

      if (!entries.length && !interactive) {
        errorBox(el, translate('paneo.todo.errorAdd', locale));
        return;
      }

      const rows = entries.map(({ done, text, index }) =>
        `<div class="todo-row ${done ? 'todo-done' : ''}" data-todo-index="${index}">
          <span class="todo-check">${done ? '✔' : '○'}</span>
          <span class="todo-text">${text}</span>
          ${interactive ? '<button type="button" class="todo-delete" aria-label="delete">×</button>' : ''}
        </div>`
      ).join('');
      const emptyHint = (interactive && !entries.length)
        ? `<div class="todo-empty-hint">${translate('paneo.todo.emptyHint', locale)}</div>`
        : '';
      const addRow = interactive
        ? `<div class="todo-add-row">
            <input type="text" class="todo-add-input" placeholder="${translate('paneo.todo.addPlaceholder', locale)}">
            <button type="button" class="todo-add-btn" aria-label="add">+</button>
          </div>`
        : '';
      el.innerHTML = `<div class="w-todo${interactive ? ' todo-interactive' : ''}">${emptyHint}${rows}${addRow}</div>`;

      if (!interactive) return;

      el.querySelectorAll('.todo-row').forEach((row) => {
        row.addEventListener('click', () => {
          const isDone = row.classList.toggle('todo-done');
          row.querySelector('.todo-check').textContent = isDone ? '✔' : '○';
          fetch(`/api/display/${encodeURIComponent(ctx.deviceToken)}/toggle-todo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ widgetId: ctx.widgetId, index: Number(row.dataset.todoIndex) }),
          }).catch(() => {
            // request failed — revert the optimistic toggle
            const stillDone = row.classList.toggle('todo-done');
            row.querySelector('.todo-check').textContent = stillDone ? '✔' : '○';
          });
        });
        row.querySelector('.todo-delete').addEventListener('click', (e) => {
          e.stopPropagation(); // don't also fire the row's own toggle handler
          row.style.display = 'none';
          fetch(`/api/display/${encodeURIComponent(ctx.deviceToken)}/delete-todo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ widgetId: ctx.widgetId, index: Number(row.dataset.todoIndex) }),
          }).catch(() => { row.style.display = ''; }); // request failed — undo the optimistic hide
        });
      });

      const addInput = el.querySelector('.todo-add-input');
      const submitAdd = () => {
        const text = addInput.value.trim();
        if (!text) return;
        addInput.disabled = true;
        fetch(`/api/display/${encodeURIComponent(ctx.deviceToken)}/add-todo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ widgetId: ctx.widgetId, text }),
        })
          .then(() => { addInput.value = ''; }) // the incoming layout.set broadcast repaints with the new row
          .catch(() => {})
          .finally(() => { addInput.disabled = false; });
      };
      el.querySelector('.todo-add-btn').addEventListener('click', submitAdd);
      addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAdd(); });
    },
  },

  'paneo.exchangerate': {
    version: '1.0.0',
    label: { ko: '환율', en: 'Exchange rate', ja: '為替レート', de: 'Wechselkurs', fr: 'Taux de change', es: 'Tipo de cambio' },
    icon: '💱',
    category: 'data',
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
    requires: [],
    permissions: ['api.frankfurter.dev'],
    config: [
      { key: 'base', label: { ko: '기준 통화', en: 'Base currency', ja: '基準通貨', de: 'Basiswährung', fr: 'Devise de référence', es: 'Moneda de referencia' }, type: 'text', default: 'USD' },
      { key: 'target', label: { ko: '대상 통화', en: 'Target currency', ja: '対象通貨', de: 'Zielwährung', fr: 'Devise cible', es: 'Moneda de destino' }, type: 'text', default: 'KRW' },
    ],
    render(el, config, ctx = {}) {
      const base = String(config.base || 'USD').trim().toUpperCase();
      const target = String(config.target || 'KRW').trim().toUpperCase();
      loadingBox(el, '...');
      pollJson(
        el, `/api/proxy/exchangerate?base=${encodeURIComponent(base)}&target=${encodeURIComponent(target)}`, pollInterval(60 * 60_000, ctx),
        (data) => {
          el.innerHTML = `<div class="w-exchangerate">
            <div class="fx-pair">1 ${data.base} =</div>
            <div class="fx-rate">${Number(data.rate).toLocaleString(ctx.locale || 'ko-KR', { maximumFractionDigits: 2 })} ${data.target}</div>
            <div class="fx-date">${data.date}</div>
          </div>`;
        },
        (err) => errorBox(el, err.message),
      );
    },
  },

  'paneo.qrcode': {
    version: '1.0.0',
    label: { ko: 'QR 코드', en: 'QR code', ja: 'QRコード', de: 'QR-Code', fr: 'Code QR', es: 'Código QR' },
    icon: '🔳',
    category: 'data',
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 1, h: 1 },
    requires: [],
    permissions: [],
    config: [
      { key: 'data', label: { ko: '내용(URL/텍스트)', en: 'Content (URL/text)', ja: '内容 (URL/テキスト)', de: 'Inhalt (URL/Text)', fr: 'Contenu (URL/texte)', es: 'Contenido (URL/texto)' }, type: 'text', default: '' },
      { key: 'label', label: { ko: '캡션(선택)', en: 'Caption (optional)', ja: 'キャプション (オプション)', de: 'Beschriftung (optional)', fr: 'Légende (optionnel)', es: 'Leyenda (opcional)' }, type: 'text', default: '' },
    ],
    render(el, config, ctx = {}) {
      const data = String(config.data || '').trim();
      if (!data) { errorBox(el, ctx.locale?.startsWith('ko') !== false ? '내용을 입력하세요' : 'Set content to encode'); return; }
      loadingBox(el, '...');
      pollJson(
        el, `/api/proxy/qrcode?data=${encodeURIComponent(data)}&size=300`, pollInterval(60 * 60_000, ctx),
        (result) => {
          el.innerHTML = `<div class="w-qrcode">
            <img class="qr-img" src="${result.dataUrl}" alt="QR code">
            ${config.label ? `<div class="qr-caption">${escapeAttr(config.label)}</div>` : ''}
          </div>`;
        },
        (err) => errorBox(el, err.message),
      );
    },
  },
};

// Third-party plugin loading (docs/design.md §7, D17). Fetches /api/plugins
// (server-discovered manifests, src/plugins.js) and merges each one straight
// into the `widgets` registry above — every other function in this file
// (renderWidget/widgetLabel/fieldLabel/buildPalette in editor.js) then works
// on plugin widgets exactly like built-ins, with zero extra call sites.
//
// Two plugin types, matching the trust boundary already established by
// paneo.iframe's sandboxing (§7.3):
//   "module" — filesystem-installed ES module (server admin's trust act,
//              same level as in-tree code) — dynamically imported and run
//              directly, contract identical to every widget def's render().
//   "iframe" — remote URL, no filesystem access — rendered through the same
//              sandboxed <iframe> as paneo.iframe; config is passed as a
//              query string since there's no in-tree postMessage channel yet.
// Both types are always bucketed into the 'plugin' category (not spoofable
// via manifest) so the palette visibly separates built-in from third-party.
export async function loadPlugins() {
  let manifests = [];
  try {
    manifests = await (await fetch('/api/plugins')).json();
  } catch {
    return; // offline first paint — built-ins still work, plugins just won't show
  }
  for (const m of manifests) {
    const key = `plugin.${m.id}`;
    if (widgets[key]) continue;
    try {
      if (m.type === 'module') {
        const mod = await import(`/plugins/${m.id}/${m.entry}`);
        if (typeof mod.render !== 'function') throw new Error(`${m.entry} does not export render()`);
        widgets[key] = pluginWidgetDef(m, mod.render);
      } else if (m.type === 'iframe') {
        widgets[key] = pluginWidgetDef(m, iframePluginRender(m));
      } else {
        throw new Error(`unknown plugin type "${m.type}"`);
      }
    } catch (err) {
      console.error(`[plugins] failed to load "${m.id}":`, err);
    }
  }
}

function pluginWidgetDef(m, render) {
  return {
    version: m.version,
    label: m.label || { ko: m.id, en: m.id },
    icon: m.icon || '🔌',
    category: 'plugin',
    defaultSize: m.defaultSize,
    minSize: m.minSize || m.defaultSize,
    requires: m.requires || [],
    permissions: m.permissions || [],
    sandbox: m.type === 'iframe' ? 'iframe' : undefined,
    config: m.config || [],
    render,
  };
}

function iframePluginRender(m) {
  return (el, config, ctx = {}) => {
    const qs = new URLSearchParams({ ...(config || {}), locale: ctx.locale || '', timezone: ctx.timezone || '' }).toString();
    const url = safeHttpUrl(`${m.url}${m.url.includes('?') ? '&' : '?'}${qs}`);
    if (!url) { errorBox(el, 'invalid plugin url'); return; }
    const sandbox = sandboxTokens(m.sandboxMode || 'scripts');
    el.innerHTML = `<iframe class="w-iframe" src="${escapeAttr(url)}" sandbox="${escapeAttr(sandbox)}" referrerpolicy="no-referrer" loading="lazy"></iframe>`;
  };
}

// Display order for the add-widget popover's category groups (editor.js).
export const CATEGORY_ORDER = ['basic', 'data', 'media', 'plugin'];

import { WIDGET_TRANSLATIONS } from './i18n.js';
export { WIDGET_TRANSLATIONS };

// Resolve a general translation key for the given UI language.
export function translate(key, lang = 'ko', fallback = undefined) {
  const code = String(lang || 'ko').split('-')[0].toLowerCase();
  const val = WIDGET_TRANSLATIONS[code]?.[key] || WIDGET_TRANSLATIONS.ko?.[key];
  if (val !== undefined) return val;
  return fallback !== undefined ? fallback : key;
}

// Resolve a localized widget label for the given UI language.
export function widgetLabel(type, lang = 'ko') {
  const l = widgets[type]?.label;
  if (!l) return type;
  if (typeof l === 'string') {
    return WIDGET_TRANSLATIONS[lang]?.[l] || WIDGET_TRANSLATIONS.ko?.[l] || l;
  }
  return l[lang] || l.ko || type;
}

// Resolve a config field label ({ ko, en } or plain string / translation key).
export function fieldLabel(field, lang = 'ko') {
  const l = field?.label;
  if (!l) return field?.key || '';
  if (typeof l === 'string') {
    return WIDGET_TRANSLATIONS[lang]?.[l] || WIDGET_TRANSLATIONS.ko?.[l] || l;
  }
  return l[lang] || l.ko || field.key;
}

// Resolve a config field placeholder ({ ko, en } or plain string / translation key).
export function fieldPlaceholder(field, lang = 'ko') {
  const p = field?.placeholder;
  if (!p) return '';
  if (typeof p === 'string') {
    return WIDGET_TRANSLATIONS[lang]?.[p] || WIDGET_TRANSLATIONS.ko?.[p] || p;
  }
  return p[lang] || p.ko || '';
}

// Render a widget into `el`, cleaning up any previous interval/timer first.
export function renderWidget(el, type, config, ctx) {
  el._cleanup?.();
  el._cleanup = null;
  const def = widgets[type];
  if (!def) { el.textContent = `? ${type}`; return; }
  def.render(el, config || {}, ctx || {});
}
