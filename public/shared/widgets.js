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

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
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
  tick();
  timer = setInterval(tick, intervalMs);
  el._cleanup = () => { clearInterval(timer); ctrl?.abort(); };
}

// ---- calendar.month helpers ----
// Build a grid of Date objects for the month containing `date`, padded so
// each row starts on Monday (ISO week). Returns an array of 6 rows × 7 cols.
function buildMonthGrid(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(year, month, 1);
  // Monday = 0 offset (ISO). JS getDay(): 0=Sun,1=Mon..6=Sat → remap
  const startOffset = (first.getDay() + 6) % 7;
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

export const widgets = {
  'paneo.clock': {
    version: '1.0.0',
    label: { ko: '시계', en: 'Clock' },
    icon: '🕐',
    category: 'basic',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 1 },
    requires: [],
    permissions: [],
    config: [{ key: 'hour12', label: { ko: '12시간제', en: '12-hour' }, type: 'checkbox', default: false }],
    render(el, config, ctx = {}) {
      const locale = ctx.locale || 'ko-KR';
      const tz = ctx.timezone || undefined;
      const hm = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: !!config.hour12, timeZone: tz });
      const sec = new Intl.DateTimeFormat(locale, { second: '2-digit', hour12: false, timeZone: tz });
      const update = () => {
        const now = new Date();
        const hmStr = hm.formatToParts(now).map((p) => {
          if ((p.type === 'hour' || p.type === 'minute') && /^\d+$/.test(p.value)) {
            return p.value.padStart(2, '0');
          }
          return p.value;
        }).join('');
        const secStr = sec.formatToParts(now).map((p) => {
          if (p.type === 'second' && /^\d+$/.test(p.value)) {
            return p.value.padStart(2, '0');
          }
          return p.value;
        }).join('');
        el.innerHTML = `<div class="w-clock"><span class="clock-hm">${hmStr}</span><span class="clock-sec">${secStr}</span></div>`;
      };
      update();
      const t = setInterval(update, 1000);
      el._cleanup = () => clearInterval(t);
    },
  },

  'paneo.date': {
    version: '1.0.0',
    label: { ko: '날짜', en: 'Date' },
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
      const update = () => {
        const now = new Date();
        el.innerHTML = `<div class="w-date"><div class="date-main">${dateFmt.format(now)}</div><div class="date-weekday">${wdFmt.format(now)}</div></div>`;
      };
      update();
      const t = setInterval(update, 60000);
      el._cleanup = () => clearInterval(t);
    },
  },

  'paneo.text': {
    version: '1.0.0',
    label: { ko: '텍스트', en: 'Text' },
    icon: '📝',
    category: 'basic',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 1, h: 1 },
    requires: [],
    permissions: [],
    config: [{ key: 'text', label: { ko: '내용', en: 'Content' }, type: 'text', default: '' }],
    render(el, config) {
      el.innerHTML = `<div class="w-text"></div>`;
      el.querySelector('.w-text').textContent = config.text ?? '';
    },
  },

  'paneo.photo': {
    version: '1.2.0',
    label: { ko: '미디어 슬라이드쇼', en: 'Media slideshow' },
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
      { key: 'source', label: { ko: '미디어 소스', en: 'Media Source' }, type: 'enum', options: ['urls', 'local', 'unsplash', 'immich'], default: 'urls' },
      { key: 'urls', label: { ko: '이미지/동영상 URL 목록', en: 'Image/video URLs' }, type: 'list', default: [], showIf: { key: 'source', equals: 'urls' } },
      // selectionKey: the shared upload pool (data/photos/) is server-global — every
      // "local" source widget browses/uploads/deletes the same files — but which of
      // those files THIS widget instance actually slideshows is per-widget, stored
      // under config[selectionKey]. Empty/unset means "show everything" (the original,
      // still-backward-compatible behavior) so existing configs don't change.
      { key: 'localManage', label: { ko: '로컬 사진/동영상 관리', en: 'Manage local photos/videos' }, type: 'fileManager', default: '', showIf: { key: 'source', equals: 'local' }, selectionKey: 'localSelectedFiles' },
      { key: 'unsplashKeyword', label: { ko: 'Unsplash 검색어', en: 'Unsplash Keyword' }, type: 'text', default: 'nature', showIf: { key: 'source', equals: 'unsplash' } },
      { key: 'immichUrl', label: { ko: 'Immich 서버 URL', en: 'Immich URL' }, type: 'text', default: '', showIf: { key: 'source', equals: 'immich' } },
      { key: 'immichApiKey', label: { ko: 'Immich API Key', en: 'Immich API Key' }, type: 'text', default: '', showIf: { key: 'source', equals: 'immich' } },
      { key: 'immichAlbumId', label: { ko: 'Immich 앨범 ID (선택)', en: 'Immich Album ID (optional)' }, type: 'text', default: '', showIf: { key: 'source', equals: 'immich' } },
      { key: 'fit', label: { ko: '맞춤 방식', en: 'Fit Mode' }, type: 'enum', options: ['cover', 'contain'], default: 'cover' },
      { key: 'effects', label: { ko: 'Ken Burns 애니메이션 (사진 전용)', en: 'Ken Burns Effect (photos only)' }, type: 'checkbox', default: false },
      { key: 'shuffleOrder', label: { ko: '랜덤 순서로 재생', en: 'Shuffle order' }, type: 'checkbox', default: false },
      { key: 'intervalSec', label: { ko: '사진 전환 간격(초) — 동영상은 재생이 끝나면 자동 전환', en: 'Photo interval (sec) — videos advance when playback ends' }, type: 'number', default: 8 },
    ],
    render(el, config, ctx = {}) {
      const source = config.source || 'urls';
      const fit = config.fit || 'cover';
      const fitClass = fit === 'contain' ? ' fit-contain' : ' fit-cover';
      const useEffects = config.effects && ctx.performanceProfile === 'high';
      const intervalSec = Math.max(2, Number(config.intervalSec) || 8);
      const shuffle = !!config.shuffleOrder;

      let timer = null;
      let items = [];
      let currentIndex = 0;
      let pendingNextIndex = 0;
      let activeVideoEl = null;

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
        if (activeVideoEl) { activeVideoEl.pause(); activeVideoEl = null; }

        if (!items.length) {
          el.innerHTML = `<div class="w-image w-placeholder"></div>`;
          return;
        }

        const currentUrl = items[currentIndex];

        // Videos drive their own advance via the 'ended' event (so playback isn't cut
        // short by the photo interval) instead of the setTimeout used for images below.
        if (isVideoUrl(currentUrl)) {
          const loopSingle = items.length <= 1 && source !== 'unsplash';
          el.innerHTML = `<video class="w-video${fitClass}" src="${escapeAttr(currentUrl)}" autoplay muted playsinline ${loopSingle ? 'loop' : ''}></video>`;
          activeVideoEl = el.querySelector('video');
          if (!loopSingle) activeVideoEl.addEventListener('ended', advance);
          return;
        }

        pendingNextIndex = pickNextIndex();
        const nextUrl = items[pendingNextIndex] ?? currentUrl;

        if (useEffects && !isVideoUrl(nextUrl)) {
          el.innerHTML = `
            <div class="w-image-container">
              <div class="w-image-bg kenburns${fitClass}" style="background-image:url('${escapeStyleUrl(currentUrl)}')"></div>
              <div class="w-image-bg-preload" style="background-image:url('${escapeStyleUrl(nextUrl)}')"></div>
            </div>
          `;
        } else {
          el.innerHTML = `<div class="w-image${fitClass}" style="background-image:url('${escapeStyleUrl(currentUrl)}')"></div>`;
        }

        if (items.length > 1 || source === 'unsplash') {
          timer = setTimeout(advance, intervalSec * 1000);
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
        clearTimeout(timer);
        if (activeVideoEl) activeVideoEl.pause();
      };
    },
  },

  'paneo.weather': {
    version: '1.0.0',
    label: { ko: '날씨', en: 'Weather' },
    icon: '☀️',
    category: 'data',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    requires: [],
    permissions: ['open-meteo.com', 'nominatim.openstreetmap.org'],
    config: [
      { key: 'location', label: { ko: '지역(도시명)', en: 'Location (city)' }, type: 'text', default: 'Seoul' },
      { key: 'units', label: { ko: '단위', en: 'Units' }, type: 'enum', options: ['metric', 'imperial'], default: 'metric' },
    ],
    render(el, config, ctx = {}) {
      const loc = String(config.location || '').trim();
      if (!loc) { errorBox(el, ctx.locale?.startsWith('ko') !== false ? '지역을 입력하세요' : 'Set a location'); return; }
      const units = config.units === 'imperial' ? 'imperial' : 'metric';
      const unitSymbol = units === 'imperial' ? '°F' : '°C';
      loadingBox(el, '...');
      pollJson(
        el, `/api/proxy/weather?location=${encodeURIComponent(loc)}&units=${units}&locale=${encodeURIComponent(ctx.locale || 'ko-KR')}`, pollInterval(10 * 60_000, ctx),
        (data) => {
          el.innerHTML = `<div class="w-weather">
            <div class="weather-temp">${Math.round(data.temperature)}${unitSymbol}</div>
            <div class="weather-text">${data.weatherText}</div>
            <div class="weather-loc">${data.location}</div>
          </div>`;
        },
        (err) => errorBox(el, err.message),
      );
    },
  },

  'paneo.airquality': {
    version: '1.0.0',
    label: { ko: '대기질', en: 'Air Quality' },
    icon: '🌫️',
    category: 'data',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    requires: [],
    permissions: ['air-quality-api.open-meteo.com', 'nominatim.openstreetmap.org'],
    config: [
      { key: 'location', label: { ko: '지역(도시명)', en: 'Location (city)' }, type: 'text', default: 'Seoul' },
    ],
    render(el, config, ctx = {}) {
      const loc = String(config.location || '').trim();
      if (!loc) { errorBox(el, ctx.locale?.startsWith('ko') !== false ? '지역을 입력하세요' : 'Set a location'); return; }
      const isKo = ctx.locale?.startsWith('ko') !== false;
      loadingBox(el, '...');
      pollJson(
        el, `/api/proxy/airquality?location=${encodeURIComponent(loc)}&locale=${encodeURIComponent(ctx.locale || 'ko-KR')}`, pollInterval(10 * 60_000, ctx),
        (data) => {
          const row = (label, value, grade, idx) => `<div class="aq-row">
            <span class="aq-label">${label}</span>
            <span class="aq-value aq-grade-${idx ?? 'na'}">${value != null ? Math.round(value) : '-'}${grade ? ` · ${grade}` : ''}</span>
          </div>`;
          el.innerHTML = `<div class="w-airquality">
            <div class="aq-loc">${data.location}</div>
            ${row(isKo ? '미세먼지' : 'PM10', data.pm10, data.pm10Grade, data.pm10GradeIndex)}
            ${row(isKo ? '초미세먼지' : 'PM2.5', data.pm25, data.pm25Grade, data.pm25GradeIndex)}
          </div>`;
        },
        (err) => errorBox(el, err.message),
      );
    },
  },

  'paneo.calendar': {
    version: '1.0.0',
    label: { ko: '일정 목록', en: 'Event list' },
    icon: '🗓️',
    category: 'data',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 2, h: 2 },
    requires: [],
    permissions: [],
    config: [{ key: 'icsUrls', label: { ko: 'iCal(.ics) URL', en: 'iCal (.ics) URLs' }, type: 'list', default: [], placeholder: { ko: 'https://example.com/calendar.ics', en: 'https://example.com/calendar.ics' } }],
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
      pollJson(
        el, `/api/proxy/ical?${multiUrlQuery(parsedUrls)}`, pollInterval(15 * 60_000, ctx),
        (data) => {
          const items = (data.events || []).map((e) => {
            const color = urlColors[e.source] || '';
            const style = color ? `style="border-left:3px solid ${color}; padding-left:6px; margin-left:0"` : '';
            return `<li ${style}><span class="cal-date">${dateFmt.format(new Date(e.start))}</span><span class="cal-summary">${e.summary}</span></li>`;
          }).join('');
          el.innerHTML = `<ul class="w-calendar">${items || '<li class="cal-empty">-</li>'}</ul>`;
        },
        (err) => errorBox(el, err.message),
      );
    },
  },

  // §M3 D8: Full monthly calendar grid — separate widget from paneo.calendar (event list).
  // Reuses /api/proxy/ical, renders a 7-column grid with today highlighted and event
  // titles clipped inside the day cell (design decision B from implementation_plan.md).
  'paneo.calendar.month': {
    version: '1.0.0',
    label: { ko: '월간 달력', en: 'Monthly calendar' },
    icon: '📆',
    category: 'data',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 5, h: 4 },
    requires: [],
    permissions: [],
    config: [
      { key: 'icsUrls', label: { ko: 'iCal(.ics) URL', en: 'iCal (.ics) URLs' }, type: 'list', default: [], placeholder: { ko: 'https://example.com/calendar.ics', en: 'https://example.com/calendar.ics' } },
      { key: 'showWeekNumber', label: { ko: '주 번호 표시', en: 'Show week numbers' }, type: 'checkbox', default: false },
    ],
    render(el, config, ctx = {}) {
      const locale = ctx.locale || 'ko-KR';
      const tz = ctx.timezone || undefined;
      const isKo = locale.startsWith('ko');

      const DAY_NAMES_KO = ['월', '화', '수', '목', '금', '토', '일'];
      const DAY_NAMES_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const dayNames = isKo ? DAY_NAMES_KO : DAY_NAMES_EN;

      const parsedUrls = [];
      const urlColors = {};
      for (const entry of cleanUrlList(config.icsUrls)) {
        const [u, color = ''] = entry.split('|');
        if (u) {
          parsedUrls.push(u);
          urlColors[u] = color;
        }
      }
      const now = new Date();
      const todayStr = isoDate(now);
      // Hoisted so the ICS fetch below can bound its request to exactly the
      // dates this grid shows (including the leading/trailing adjacent-month
      // padding cells) — see the `range` fix in src/dataproxy.js.
      const gridCells = buildMonthGrid(now);

      // Month header
      const monthFmt = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: tz });

      function renderGrid(eventsByDate = {}) {
        const cells = gridCells;
        const curMonth = now.getMonth();
        const showWN = !!config.showWeekNumber;
        const cols = showWN ? 8 : 7;

        let headerRow = '';
        if (showWN) headerRow += `<div class="cal-m-cell cal-m-wn-hdr"></div>`;
        headerRow += dayNames.map((d, i) => {
          const cls = i === 5 ? ' cal-m-sat' : i === 6 ? ' cal-m-sun' : '';
          return `<div class="cal-m-cell cal-m-day-hdr${cls}">${d}</div>`;
        }).join('');

        let bodyRows = '';
        for (let row = 0; row * 7 < cells.length; row++) {
          if (showWN) {
            // ISO week number of the first day of this row
            const d = cells[row * 7];
            const jan4 = new Date(d.getFullYear(), 0, 4);
            const startOfWeek1 = new Date(jan4);
            startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
            const wn = Math.round((d - startOfWeek1) / (7 * 86400000)) + 1;
            bodyRows += `<div class="cal-m-cell cal-m-wn">${wn}</div>`;
          }
          for (let col = 0; col < 7; col++) {
            const d = cells[row * 7 + col];
            if (!d) { bodyRows += `<div class="cal-m-cell"></div>`; continue; }
            const ds = isoDate(d);
            const isToday = ds === todayStr;
            const isOtherMonth = d.getMonth() !== curMonth;
            const isSat = col === 5;
            const isSun = col === 6;
            let cls = 'cal-m-cell cal-m-day';
            if (isToday) cls += ' cal-m-today';
            if (isOtherMonth) cls += ' cal-m-other';
            if (isSat) cls += ' cal-m-sat';
            if (isSun) cls += ' cal-m-sun';

            const events = (eventsByDate[ds] || []);
            const eventHtml = events.slice(0, 3).map((e) => {
              const title = String(e.summary || '').slice(0, 14);
              const color = urlColors[e.source] || '';
              const style = color ? `style="background:${color}33; border-left:2px solid ${color}; padding-left:2px"` : '';
              return `<div class="cal-m-event" ${style} title="${String(e.summary || '').replace(/"/g, '&quot;')}">${title}</div>`;
            }).join('');
            const moreCount = events.length > 3 ? `<div class="cal-m-more">+${events.length - 3}</div>` : '';

            bodyRows += `<div class="${cls}">
              <div class="cal-m-dnum">${d.getDate()}</div>
              ${eventHtml}${moreCount}
            </div>`;
          }
        }

        el.innerHTML = `<div class="w-cal-month">
          <div class="cal-m-header">${monthFmt.format(now)}</div>
          <div class="cal-m-grid" style="grid-template-columns:repeat(${cols},1fr)">
            ${headerRow}${bodyRows}
          </div>
        </div>`;
      }

      // Render empty grid immediately, then fetch events
      renderGrid();

      if (!parsedUrls.length) return;

      // Bound the fetch to exactly the span this grid shows (first cell's start of
      // day .. day after the last cell) so every event in the visible month comes
      // back, not just the next ~15 upcoming ones (that "upcoming" cap is correct
      // for paneo.calendar's list view, but silently dropped events on later days
      // of a busy month here).
      const rangeFrom = gridCells[0];
      const rangeTo = new Date(gridCells[gridCells.length - 1].getTime() + 24 * 3600 * 1000);
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
          renderGrid(byDate);
        },
        (err) => {
          // Keep the empty grid, just show a small error indicator
          const errEl = document.createElement('div');
          errEl.className = 'cal-m-fetch-err';
          errEl.textContent = err.message;
          el.querySelector('.w-cal-month')?.appendChild(errEl);
        },
      );
    },
  },

  'paneo.rss': {
    version: '1.0.0',
    label: { ko: 'RSS/뉴스', en: 'RSS / News' },
    icon: '📰',
    category: 'data',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 2, h: 2 },
    requires: [],
    permissions: [],
    config: [{ key: 'feedUrls', label: { ko: 'RSS 피드 URL', en: 'RSS feed URLs' }, type: 'list', default: [] }],
    render(el, config, ctx = {}) {
      const urls = cleanUrlList(config.feedUrls);
      if (!urls.length) { errorBox(el, ctx.locale?.startsWith('ko') !== false ? 'RSS URL을 입력하세요' : 'Set an RSS URL'); return; }
      loadingBox(el, '...');
      pollJson(
        el, `/api/proxy/rss?${multiUrlQuery(urls)}`, pollInterval(15 * 60_000, ctx),
        (data) => {
          const items = (data.items || []).map((it) =>
            `<li><a href="${it.link}" target="_blank" rel="noopener">${it.title}</a></li>`
          ).join('');
          el.innerHTML = `<ul class="w-rss">${items || '<li>-</li>'}</ul>`;
        },
        (err) => errorBox(el, err.message),
      );
    },
  },

  'paneo.iframe': {
    version: '1.1.0',
    label: { ko: '외부 페이지', en: 'External page' },
    icon: '🌐',
    category: 'media',
    defaultSize: { w: 5, h: 4 },
    minSize: { w: 2, h: 2 },
    requires: [],
    permissions: ['embed:external-page'],
    sandbox: 'iframe',
    config: [
      { key: 'url', label: { ko: '웹페이지 URL', en: 'Page URL' }, type: 'text', default: '' },
      { key: 'sandboxMode', label: { ko: '샌드박스 모드', en: 'Sandbox mode' }, type: 'enum', options: ['scripts', 'strict', 'trusted'], default: 'scripts' },
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
    label: { ko: '알람 타이머', en: 'Alarm timer' },
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
        label: { ko: '타이머 목록', en: 'Timers' },
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
      const t = setInterval(tick, showSec ? 1000 : 10000);
      el._cleanup = () => clearInterval(t);
    },
  },

  'paneo.homeassistant': {
    version: '1.0.0',
    label: { ko: '홈어시스턴트', en: 'Home Assistant' },
    icon: '🏠',
    category: 'data',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 1 },
    requires: [],
    permissions: [],
    config: [
      { key: 'entityId', label: { ko: '엔티티 ID', en: 'Entity ID' }, type: 'text', default: '' },
      { key: 'title', label: { ko: '제목 (선택)', en: 'Title (optional)' }, type: 'text', default: '' },
      { key: 'icon', label: { ko: '아이콘 (단일 이모지)', en: 'Icon (emoji)' }, type: 'text', default: '' },
      { key: 'showToggle', label: { ko: '스위치 토글 허용', en: 'Allow toggle switch' }, type: 'checkbox', default: false }
    ],
    render(el, config, ctx = {}) {
      const entityId = String(config.entityId || '').trim();
      if (!entityId) {
        errorBox(el, ctx.locale?.startsWith('ko') !== false ? '엔티티 ID를 입력하세요' : 'Set an Entity ID');
        return;
      }
      loadingBox(el, '...');

      const renderData = (data) => {
        const state = data.state;
        const attrs = data.attributes || {};
        const friendlyName = config.title || attrs.friendly_name || entityId;
        const emojiIcon = config.icon || (entityId.startsWith('light') ? '💡' : entityId.startsWith('switch') ? '🔌' : entityId.startsWith('sensor') ? '🌡️' : '⚙️');
        const unit = attrs.unit_of_measurement || '';
        
        let displayState = state;
        if (state === 'on') displayState = ctx.locale?.startsWith('ko') ? '켜짐' : 'ON';
        else if (state === 'off') displayState = ctx.locale?.startsWith('ko') ? '꺼짐' : 'OFF';
        else if (state === 'unavailable') displayState = ctx.locale?.startsWith('ko') ? '사용불가' : 'Unavailable';
        
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

      pollJson(
        el, `/api/proxy/ha/states/${entityId}`, pollInterval(30_000, ctx),
        renderData,
        (err) => errorBox(el, err.message)
      );
    }
  },

  'paneo.worldclock': {
    version: '1.0.0',
    label: { ko: '세계시계', en: 'World clock' },
    icon: '🌐',
    category: 'basic',
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 1 },
    requires: [],
    permissions: [],
    config: [
      {
        key: 'cities', label: { ko: '도시 목록', en: 'Cities' }, type: 'structList', default: [],
        fields: [
          { key: 'label', label: { ko: '라벨', en: 'Label' }, type: 'text', placeholder: { ko: '도쿄', en: 'Tokyo' } },
          { key: 'tz', label: { ko: '타임존(IANA)', en: 'Timezone (IANA)' }, type: 'text', placeholder: { ko: 'Asia/Tokyo', en: 'Asia/Tokyo' } },
        ],
      },
      { key: 'hour12', label: { ko: '12시간제', en: '12-hour' }, type: 'checkbox', default: false },
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
      const t = setInterval(update, 1000);
      el._cleanup = () => clearInterval(t);
    },
  },

  'paneo.dday': {
    version: '1.0.0',
    label: { ko: 'D-Day 카운트다운', en: 'D-Day countdown' },
    icon: '📆',
    category: 'basic',
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 1 },
    requires: [],
    permissions: [],
    config: [
      {
        key: 'events', label: { ko: '이벤트 목록', en: 'Events' }, type: 'structList', default: [],
        fields: [
          { key: 'label', label: { ko: '라벨', en: 'Label' }, type: 'text', placeholder: { ko: '생일', en: 'Birthday' } },
          { key: 'date', label: { ko: '날짜', en: 'Date' }, type: 'date' },
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
      const t = setInterval(update, 60_000);
      el._cleanup = () => clearInterval(t);
    },
  },

  'paneo.todo': {
    version: '1.0.0',
    label: { ko: '할 일 목록', en: 'To-do list' },
    icon: '✅',
    category: 'basic',
    defaultSize: { w: 3, h: 4 },
    minSize: { w: 2, h: 2 },
    requires: [],
    permissions: [],
    config: [
      {
        key: 'todoItems', label: { ko: '할 일', en: 'Items' }, type: 'structList', default: [],
        fields: [
          { key: 'done', label: { ko: '완료', en: 'Done' }, type: 'checkbox' },
          { key: 'text', label: { ko: '내용', en: 'Text' }, type: 'text', placeholder: { ko: '할 일 내용', en: 'Item text' } },
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
        errorBox(el, isKo ? '할 일을 추가하세요' : 'Add a to-do item');
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
        ? `<div class="todo-empty-hint">${isKo ? '할 일이 없습니다. 아래에서 추가하세요.' : 'No items yet — add one below.'}</div>`
        : '';
      const addRow = interactive
        ? `<div class="todo-add-row">
            <input type="text" class="todo-add-input" placeholder="${isKo ? '새 할 일 추가...' : 'Add an item...'}">
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
    label: { ko: '환율', en: 'Exchange rate' },
    icon: '💱',
    category: 'data',
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
    requires: [],
    permissions: ['api.frankfurter.dev'],
    config: [
      { key: 'base', label: { ko: '기준 통화', en: 'Base currency' }, type: 'text', default: 'USD' },
      { key: 'target', label: { ko: '대상 통화', en: 'Target currency' }, type: 'text', default: 'KRW' },
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
    label: { ko: 'QR 코드', en: 'QR code' },
    icon: '🔳',
    category: 'data',
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 1, h: 1 },
    requires: [],
    permissions: [],
    config: [
      { key: 'data', label: { ko: '내용(URL/텍스트)', en: 'Content (URL/text)' }, type: 'text', default: '' },
      { key: 'label', label: { ko: '캡션(선택)', en: 'Caption (optional)' }, type: 'text', default: '' },
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

// Resolve a localized widget label for the given UI language.
export function widgetLabel(type, lang = 'ko') {
  const l = widgets[type]?.label;
  return (l && (l[lang] || l.ko)) || type;
}

// Resolve a config field label ({ ko, en } or plain string).
export function fieldLabel(field, lang = 'ko') {
  if (!field?.label) return field?.key || '';
  return typeof field.label === 'string' ? field.label : field.label[lang] || field.label.ko || field.key;
}

// Render a widget into `el`, cleaning up any previous interval/timer first.
export function renderWidget(el, type, config, ctx) {
  el._cleanup?.();
  el._cleanup = null;
  const def = widgets[type];
  if (!def) { el.textContent = `? ${type}`; return; }
  def.render(el, config || {}, ctx || {});
}
