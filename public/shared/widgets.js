// Shared widget registry — rendered identically by the editor preview and the display.
// pluginId namespace is `paneo.*` (see src/brand.js).
// Labels are localized ({ ko, en }); render() receives ctx = { locale, timezone } (docs/design.md §4.4).
// Widgets calling third-party data go through the server proxy (docs/design.md §4.2, src/dataproxy.js) —
// never fetch third-party APIs directly from here.

function loadingBox(el, text) {
  el.innerHTML = `<div class="w-loading">${text}</div>`;
}
function errorBox(el, text) {
  el.innerHTML = `<div class="w-error">${text}</div>`;
}

// Config values for 'list' fields (multi-URL sources) may be an array, or (rarely,
// e.g. right after a widget is first added) undefined — normalize to a clean list.
function cleanUrlList(v) {
  return (Array.isArray(v) ? v : []).map((s) => String(s || '').trim()).filter(Boolean);
}
function multiUrlQuery(urls) {
  return urls.map((u) => `url=${encodeURIComponent(u)}`).join('&');
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

export const widgets = {
  'paneo.clock': {
    label: { ko: '시계', en: 'Clock' },
    icon: '🕐',
    category: 'basic',
    defaultSize: { w: 3, h: 2 },
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
    label: { ko: '날짜', en: 'Date' },
    icon: '📅',
    category: 'basic',
    defaultSize: { w: 3, h: 2 },
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
    label: { ko: '텍스트', en: 'Text' },
    icon: '📝',
    category: 'basic',
    defaultSize: { w: 3, h: 2 },
    config: [{ key: 'text', label: { ko: '내용', en: 'Content' }, type: 'text', default: '' }],
    render(el, config) {
      el.innerHTML = `<div class="w-text"></div>`;
      el.querySelector('.w-text').textContent = config.text ?? '';
    },
  },
  'paneo.photo': {
    label: { ko: '사진 슬라이드쇼', en: 'Photo slideshow' },
    icon: '🖼️',
    category: 'media',
    defaultSize: { w: 4, h: 3 },
    config: [
      { key: 'urls', label: { ko: '이미지 URL', en: 'Image URLs' }, type: 'list', default: [] },
      { key: 'intervalSec', label: { ko: '전환 간격(초)', en: 'Interval (sec)' }, type: 'number', default: 8 },
    ],
    render(el, config) {
      const urls = cleanUrlList(config.urls);
      if (!urls.length) { el.innerHTML = `<div class="w-image w-placeholder"></div>`; return; }
      let i = 0;
      const paint = () => {
        el.innerHTML = `<div class="w-image" style="background-image:url('${urls[i].replace(/'/g, '%27')}')"></div>`;
      };
      paint();
      if (urls.length > 1) {
        const secs = Math.max(2, Number(config.intervalSec) || 8);
        const t = setInterval(() => { i = (i + 1) % urls.length; paint(); }, secs * 1000);
        el._cleanup = () => clearInterval(t);
      }
    },
  },
  'paneo.weather': {
    label: { ko: '날씨', en: 'Weather' },
    icon: '☀️',
    category: 'data',
    defaultSize: { w: 3, h: 2 },
    config: [{ key: 'location', label: { ko: '지역(도시명)', en: 'Location (city)' }, type: 'text', default: 'Seoul' }],
    render(el, config, ctx = {}) {
      const loc = String(config.location || '').trim();
      if (!loc) { errorBox(el, ctx.locale?.startsWith('ko') !== false ? '지역을 입력하세요' : 'Set a location'); return; }
      loadingBox(el, '...');
      pollJson(
        el, `/api/proxy/weather?location=${encodeURIComponent(loc)}`, 10 * 60_000,
        (data) => {
          el.innerHTML = `<div class="w-weather">
            <div class="weather-temp">${Math.round(data.temperature)}°</div>
            <div class="weather-text">${data.weatherText}</div>
            <div class="weather-loc">${data.location}</div>
          </div>`;
        },
        (err) => errorBox(el, err.message),
      );
    },
  },
  'paneo.calendar': {
    label: { ko: '캘린더', en: 'Calendar' },
    icon: '🗓️',
    category: 'data',
    defaultSize: { w: 4, h: 4 },
    config: [{ key: 'icsUrls', label: { ko: 'iCal(.ics) URL', en: 'iCal (.ics) URLs' }, type: 'list', default: [] }],
    render(el, config, ctx = {}) {
      const urls = cleanUrlList(config.icsUrls);
      if (!urls.length) { errorBox(el, ctx.locale?.startsWith('ko') !== false ? 'iCal URL을 입력하세요' : 'Set an iCal URL'); return; }
      loadingBox(el, '...');
      const locale = ctx.locale || 'ko-KR';
      const tz = ctx.timezone || undefined;
      const dateFmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', weekday: 'short', timeZone: tz });
      pollJson(
        el, `/api/proxy/ical?${multiUrlQuery(urls)}`, 15 * 60_000,
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
  'paneo.rss': {
    label: { ko: 'RSS/뉴스', en: 'RSS / News' },
    icon: '📰',
    category: 'data',
    defaultSize: { w: 4, h: 4 },
    config: [{ key: 'feedUrls', label: { ko: 'RSS 피드 URL', en: 'RSS feed URLs' }, type: 'list', default: [] }],
    render(el, config, ctx = {}) {
      const urls = cleanUrlList(config.feedUrls);
      if (!urls.length) { errorBox(el, ctx.locale?.startsWith('ko') !== false ? 'RSS URL을 입력하세요' : 'Set an RSS URL'); return; }
      loadingBox(el, '...');
      pollJson(
        el, `/api/proxy/rss?${multiUrlQuery(urls)}`, 15 * 60_000,
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
    label: { ko: '웹페이지(iframe)', en: 'Web page (iframe)' },
    icon: '🌐',
    category: 'media',
    defaultSize: { w: 5, h: 4 },
    config: [{ key: 'url', label: { ko: '웹페이지 URL', en: 'Page URL' }, type: 'text', default: '' }],
    render(el, config) {
      const url = String(config.url || '').trim();
      el.innerHTML = url
        ? `<iframe class="w-iframe" src="${url}" sandbox="allow-scripts allow-same-origin" loading="lazy"></iframe>`
        : `<div class="w-image w-placeholder"></div>`;
    },
  },
};

// Display order for the add-widget popover's category groups (editor.js).
export const CATEGORY_ORDER = ['basic', 'data', 'media'];

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
