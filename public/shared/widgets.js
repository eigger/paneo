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
function parseTargetTime(hhmm) {
  const [hh, mm] = (hhmm || '').split(':').map(Number);
  if (isNaN(hh) || isNaN(mm)) return null;
  const now = new Date();
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
  return t;
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
        el.innerHTML = `<div class="w-clock"><span class="clock-hm">${hm.format(now)}</span><span class="clock-sec">${sec.format(now)}</span></div>`;
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
    version: '1.1.0',
    label: { ko: '사진 슬라이드쇼', en: 'Photo slideshow' },
    icon: '🖼️',
    category: 'media',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 2, h: 2 },
    requires: [],
    permissions: [],
    config: [
      { key: 'source', label: { ko: '사진 소스', en: 'Photo Source' }, type: 'enum', options: ['urls', 'local', 'unsplash', 'immich'], default: 'urls' },
      { key: 'urls', label: { ko: '이미지 URL 목록 (source=urls)', en: 'Image URLs (source=urls)' }, type: 'list', default: [] },
      { key: 'unsplashKeyword', label: { ko: 'Unsplash 검색어 (source=unsplash)', en: 'Unsplash Keyword (source=unsplash)' }, type: 'text', default: 'nature' },
      { key: 'immichUrl', label: { ko: 'Immich 서버 URL (source=immich)', en: 'Immich URL (source=immich)' }, type: 'text', default: '' },
      { key: 'immichApiKey', label: { ko: 'Immich API Key (source=immich)', en: 'Immich API Key (source=immich)' }, type: 'text', default: '' },
      { key: 'immichAlbumId', label: { ko: 'Immich 앨범 ID (선택)', en: 'Immich Album ID (optional)' }, type: 'text', default: '' },
      { key: 'fit', label: { ko: '맞춤 방식', en: 'Fit Mode' }, type: 'enum', options: ['cover', 'contain'], default: 'cover' },
      { key: 'effects', label: { ko: 'Ken Burns 애니메이션', en: 'Ken Burns Effect' }, type: 'checkbox', default: false },
      { key: 'intervalSec', label: { ko: '전환 간격(초)', en: 'Interval (sec)' }, type: 'number', default: 8 },
    ],
    render(el, config, ctx = {}) {
      const source = config.source || 'urls';
      const fit = config.fit || 'cover';
      const useEffects = config.effects && ctx.performanceProfile === 'high';
      const intervalSec = Math.max(2, Number(config.intervalSec) || 8);
      
      let timer = null;
      let imgUrls = [];
      let currentIndex = 0;

      const paint = () => {
        if (!imgUrls.length) {
          el.innerHTML = `<div class="w-image w-placeholder"></div>`;
          return;
        }
        
        const currentUrl = imgUrls[currentIndex];
        const nextIndex = (currentIndex + 1) % imgUrls.length;
        const nextUrl = imgUrls[nextIndex] || currentUrl;
        
        const fitClass = fit === 'contain' ? ' fit-contain' : ' fit-cover';
        
        if (useEffects) {
          el.innerHTML = `
            <div class="w-image-container">
              <div class="w-image-bg kenburns${fitClass}" style="background-image:url('${escapeStyleUrl(currentUrl)}')"></div>
              <div class="w-image-bg-preload" style="background-image:url('${escapeStyleUrl(nextUrl)}')"></div>
            </div>
          `;
        } else {
          el.innerHTML = `<div class="w-image${fitClass}" style="background-image:url('${escapeStyleUrl(currentUrl)}')"></div>`;
        }
      };

      const startSlide = () => {
        paint();
        if (imgUrls.length > 1 || source === 'unsplash') {
          timer = setInterval(() => {
            if (source === 'unsplash') {
              const kw = config.unsplashKeyword ? encodeURIComponent(config.unsplashKeyword) : 'nature';
              imgUrls = [`/api/proxy/photos/unsplash?keyword=${kw}&t=${Date.now()}`];
              currentIndex = 0;
              paint();
            } else {
              currentIndex = (currentIndex + 1) % imgUrls.length;
              paint();
            }
          }, intervalSec * 1000);
        }
      };

      loadingBox(el, '...');

      if (source === 'urls') {
        imgUrls = cleanUrlList(config.urls);
        startSlide();
      } else if (source === 'local') {
        fetch('/api/proxy/photos/local')
          .then(res => res.json())
          .then(list => {
            imgUrls = list;
            startSlide();
          })
          .catch(() => {
            errorBox(el, 'Local photos load failed');
          });
      } else if (source === 'unsplash') {
        const kw = config.unsplashKeyword ? encodeURIComponent(config.unsplashKeyword) : 'nature';
        imgUrls = [`/api/proxy/photos/unsplash?keyword=${kw}&t=${Date.now()}`];
        startSlide();
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
            imgUrls = list;
            startSlide();
          })
          .catch(() => {
            errorBox(el, 'Immich load failed');
          });
      }

      el._cleanup = () => {
        if (timer) clearInterval(timer);
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
      const urls = cleanUrlList(config.icsUrls);
      if (!urls.length) { errorBox(el, ctx.locale?.startsWith('ko') !== false ? 'iCal URL을 입력하세요' : 'Set an iCal URL'); return; }
      loadingBox(el, '...');
      const locale = ctx.locale || 'ko-KR';
      const tz = ctx.timezone || undefined;
      const dateFmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', weekday: 'short', timeZone: tz });
      pollJson(
        el, `/api/proxy/ical?${multiUrlQuery(urls)}`, pollInterval(15 * 60_000, ctx),
        (data) => {
          const items = (data.events || []).map((e) =>
            `<li><span class="cal-date">${dateFmt.format(new Date(e.start))}</span><span class="cal-summary">${e.summary}</span></li>`
          ).join('');
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

      const urls = cleanUrlList(config.icsUrls);
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
              return `<div class="cal-m-event" title="${String(e.summary || '').replace(/"/g, '&quot;')}">${title}</div>`;
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

      if (!urls.length) return;

      // Bound the fetch to exactly the span this grid shows (first cell's start of
      // day .. day after the last cell) so every event in the visible month comes
      // back, not just the next ~15 upcoming ones (that "upcoming" cap is correct
      // for paneo.calendar's list view, but silently dropped events on later days
      // of a busy month here).
      const rangeFrom = gridCells[0];
      const rangeTo = new Date(gridCells[gridCells.length - 1].getTime() + 24 * 3600 * 1000);
      const rangeQuery = `&from=${encodeURIComponent(rangeFrom.toISOString())}&to=${encodeURIComponent(rangeTo.toISOString())}`;

      pollJson(
        el, `/api/proxy/ical?${multiUrlQuery(urls)}${rangeQuery}`, pollInterval(30 * 60_000, ctx),
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
        key: 'timers',
        label: { ko: '타이머 목록 (label|HH:MM|mode)', en: 'Timers (label|HH:MM|mode)' },
        type: 'list',
        default: [],
        placeholder: { ko: '점심 시간|12:00|both', en: 'Lunch|12:00|both' }
      },
      {
        key: 'showSeconds',
        label: { ko: '초 표시', en: 'Show seconds' },
        type: 'checkbox',
        default: true,
      },
    ],
    render(el, config, ctx = {}) {
      // Each timer entry is a string: "label|HH:MM|mode"
      // mode: countdown | countup | both  (default: both)
      const rawList = Array.isArray(config.timers) ? config.timers : [];
      const showSec = config.showSeconds !== false;

      function parseEntry(raw) {
        const parts = String(raw || '').split('|');
        const label = parts[0]?.trim() || '';
        const hhmm = parts[1]?.trim() || '';
        const mode = parts[2]?.trim() || 'both';
        return { label, hhmm, mode };
      }

      function tick() {
        if (!rawList.length) {
          el.innerHTML = `<div class="w-timer w-timer-empty">
            <div class="timer-hint">${ctx.locale?.startsWith('ko') !== false
              ? '타이머를 추가하세요\n예) 점심 시간|12:00|both'
              : 'Add a timer\ne.g. Lunch|12:00|both'}</div>
          </div>`;
          return;
        }

        const now = new Date();
        const rows = rawList.map((raw) => {
          const { label, hhmm, mode } = parseEntry(raw);
          const target = parseTargetTime(hhmm);
          if (!target) return `<div class="timer-row timer-invalid">${label || '?'} — invalid time</div>`;

          const diffSec = Math.round((target - now) / 1000);
          // diffSec > 0: countdown remaining; < 0: elapsed since target

          let countdownHtml = '';
          let countupHtml = '';

          if (mode === 'countdown' || mode === 'both') {
            const cls = diffSec < 0 ? 'timer-past' : 'timer-future';
            countdownHtml = `<div class="timer-val ${cls}">${showSec ? formatDuration(diffSec, true) : formatDuration(Math.round(diffSec / 60) * 60, true)}</div>`;
          }
          if (mode === 'countup' || mode === 'both') {
            const cls = diffSec > 0 ? 'timer-future' : 'timer-past';
            countupHtml = `<div class="timer-val ${cls}">${showSec ? formatDuration(-diffSec, true) : formatDuration(Math.round(-diffSec / 60) * 60, true)}</div>`;
          }

          return `<div class="timer-row">
            <div class="timer-label">${label}</div>
            ${countdownHtml}${countupHtml}
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
