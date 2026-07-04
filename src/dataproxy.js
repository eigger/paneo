// Server-side data proxy (docs/design.md §4.2 / §8.3): widgets never call third-party
// APIs directly from the browser — the server fetches, caches, and returns simplified JSON.
// This keeps API keys (future providers) server-only and avoids CORS/rate-limit issues.
import Parser from 'rss-parser';
import ical from 'node-ical'; // CJS module: async/sync live under the default export
import QRCode from 'qrcode';

const rssParser = new Parser();

// tiny TTL cache shared by all proxy routes; keyed by route+query
const cache = new Map();
async function cached(key, ttlMs, fetcher) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await fetcher();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

const WEATHER_CODE_TEXT_KO = {
  0: '맑음', 1: '대체로 맑음', 2: '구름 조금', 3: '흐림',
  45: '안개', 48: '서리 안개',
  51: '이슬비', 53: '이슬비', 55: '이슬비',
  61: '비', 63: '비', 65: '강한 비',
  71: '눈', 73: '눈', 75: '강한 눈', 77: '진눈깨비',
  80: '소나기', 81: '소나기', 82: '강한 소나기',
  95: '뇌우', 96: '뇌우(우박)', 99: '뇌우(강한 우박)',
};

const WEATHER_CODE_TEXT_EN = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Showers', 81: 'Showers', 82: 'Heavy showers',
  95: 'Thunderstorm', 96: 'Thunderstorm (hail)', 99: 'Thunderstorm (heavy hail)',
};

function weatherCodeText(code, locale) {
  const en = String(locale || '').toLowerCase().startsWith('en');
  const map = en ? WEATHER_CODE_TEXT_EN : WEATHER_CODE_TEXT_KO;
  return map[code] ?? '-';
}

async function geocode(location) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`geocoding failed: ${res.status}`);
  const data = await res.json();
  const hit = data.results?.[0];
  if (!hit) throw new Error(`location not found: ${location}`);
  return { lat: hit.latitude, lon: hit.longitude, name: hit.name };
}

async function fetchWeather(location, locale) {
  const { lat, lon, name } = await geocode(location);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`forecast failed: ${res.status}`);
  const data = await res.json();
  const cw = data.current_weather;
  return {
    location: name,
    temperature: cw?.temperature,
    weatherCode: cw?.weathercode,
    weatherText: weatherCodeText(cw?.weathercode, locale),
    isDay: !!cw?.is_day,
    fetchedAt: new Date().toISOString(),
  };
}

// KR-style 4-tier grading (좋음/보통/나쁨/매우나쁨) on raw PM concentration (µg/m³),
// the way Korean weather apps present "미세먼지" — rather than US/European AQI,
// which would need a second, less-recognizable scale for the same audience.
const PM10_THRESHOLDS = [30, 80, 150];
const PM25_THRESHOLDS = [15, 35, 75];
const GRADE_TEXT_KO = ['좋음', '보통', '나쁨', '매우나쁨'];
const GRADE_TEXT_EN = ['Good', 'Moderate', 'Bad', 'Very Bad'];

export function gradeIndex(value, thresholds) {
  for (let i = 0; i < thresholds.length; i++) if (value <= thresholds[i]) return i;
  return thresholds.length;
}

// Frankfurter (ECB-sourced, no API key) — daily rates, so a long TTL cache is fine.
async function fetchExchangeRate(base, target) {
  const url = `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(target)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`exchange rate failed: ${res.status}`);
  const data = await res.json();
  const rate = data.rates?.[target];
  if (rate == null) throw new Error(`no rate for ${base}->${target}`);
  return { base: data.base, target, rate, date: data.date };
}

// QR generated locally (the `qrcode` package) — never leaves the server, so widget
// content (URLs, wifi credentials, etc.) isn't sent to a third-party QR image API.
export async function fetchQrCode(data, size) {
  const width = Math.min(Math.max(Number(size) || 300, 64), 1000);
  const dataUrl = await QRCode.toDataURL(data, { width, margin: 1 });
  return { dataUrl };
}

async function fetchAirQuality(location, locale) {
  const { lat, lon, name } = await geocode(location);
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm10,pm2_5`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`air quality failed: ${res.status}`);
  const data = await res.json();
  const cur = data.current || {};
  const gradeText = String(locale || '').toLowerCase().startsWith('en') ? GRADE_TEXT_EN : GRADE_TEXT_KO;
  const pm10 = cur.pm10;
  const pm25 = cur.pm2_5;
  const pm10Idx = pm10 != null ? gradeIndex(pm10, PM10_THRESHOLDS) : null;
  const pm25Idx = pm25 != null ? gradeIndex(pm25, PM25_THRESHOLDS) : null;
  return {
    location: name,
    pm10, pm10Grade: pm10Idx != null ? gradeText[pm10Idx] : null, pm10GradeIndex: pm10Idx,
    pm25, pm25Grade: pm25Idx != null ? gradeText[pm25Idx] : null, pm25GradeIndex: pm25Idx,
    fetchedAt: new Date().toISOString(),
  };
}

// `range` (optional): { from, to } epoch ms, used by paneo.calendar.month to fetch
// every event overlapping the visible grid instead of just "upcoming" ones. Without
// it, this keeps the original "next N events from now" behavior for paneo.calendar
// (an event *list* widget, where an unbounded fetch would be pointless — nothing
// past the top ~10 could ever be shown anyway).
export async function fetchCalendarSource(url, range) {
  const events = await ical.async.fromURL(url);
  const all = Object.values(events)
    .filter((e) => e.type === 'VEVENT' && e.start)
    .map((e) => ({
      summary: e.summary || '(제목 없음)',
      start: e.start.toISOString(),
      end: e.end?.toISOString(),
      source: url,
    }));

  if (range) {
    return all
      .filter((e) => {
        const start = new Date(e.start).getTime();
        const end = e.end ? new Date(e.end).getTime() : start;
        return end >= range.from && start < range.to; // overlaps [from, to)
      })
      .sort((a, b) => new Date(a.start) - new Date(b.start));
      // no cap here — already bounded to a single month's worth of events by the range
  }

  const now = Date.now();
  return all
    .filter((e) => new Date(e.start).getTime() >= now - 24 * 3600 * 1000)
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, 10); // per-source cap; the merged multi-source result is capped separately below
}

async function fetchRssSource(url) {
  const feed = await rssParser.parseURL(url);
  return (feed.items || []).slice(0, 10).map((it) => ({
    title: it.title || '(제목 없음)',
    link: it.link,
    isoDate: it.isoDate || it.pubDate || null,
  }));
}

// Fetch several sources in parallel (each individually cached+resilient — one bad
// source doesn't take down the others), merge, and let `combine` sort/cap the result.
async function fetchMerged(urls, cacheKeyPrefix, ttlMs, fetchOne, combine) {
  const settled = await Promise.allSettled(
    urls.map((u) => cached(`${cacheKeyPrefix}:${u}`, ttlMs, () => fetchOne(u)))
  );
  const ok = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) {
    const firstError = settled.find((r) => r.status === 'rejected');
    throw new Error(firstError?.reason?.message || firstError?.reason || 'all sources failed');
  }
  return combine(ok.flat());
}

export async function registerDataProxy(app) {
  app.get('/api/proxy/weather', async (req, reply) => {
    const location = req.query?.location;
    const locale = req.query?.locale || 'ko-KR';
    if (!location) return reply.code(400).send({ error: 'location required' });
    try {
      return await cached(`weather:${location}:${locale}`, 10 * 60_000, () => fetchWeather(location, locale));
    } catch (err) {
      return reply.code(502).send({ error: String(err.message || err) });
    }
  });

  app.get('/api/proxy/airquality', async (req, reply) => {
    const location = req.query?.location;
    const locale = req.query?.locale || 'ko-KR';
    if (!location) return reply.code(400).send({ error: 'location required' });
    try {
      return await cached(`airquality:${location}:${locale}`, 10 * 60_000, () => fetchAirQuality(location, locale));
    } catch (err) {
      return reply.code(502).send({ error: String(err.message || err) });
    }
  });

  app.get('/api/proxy/exchangerate', async (req, reply) => {
    const base = String(req.query?.base || '').toUpperCase();
    const target = String(req.query?.target || '').toUpperCase();
    if (!base || !target) return reply.code(400).send({ error: 'base and target required' });
    try {
      return await cached(`exchangerate:${base}:${target}`, 60 * 60_000, () => fetchExchangeRate(base, target));
    } catch (err) {
      return reply.code(502).send({ error: String(err.message || err) });
    }
  });

  app.get('/api/proxy/qrcode', async (req, reply) => {
    const data = req.query?.data;
    if (!data) return reply.code(400).send({ error: 'data required' });
    try {
      return await cached(`qrcode:${data}:${req.query?.size}`, 24 * 60 * 60_000, () => fetchQrCode(data, req.query?.size));
    } catch (err) {
      return reply.code(502).send({ error: String(err.message || err) });
    }
  });

  app.get('/api/proxy/ical', async (req, reply) => {
    const raw = req.query?.url;
    const urls = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (!urls.length) return reply.code(400).send({ error: 'at least one url required' });

    // §D8 fix: paneo.calendar.month passes from/to (the visible grid's date span) so
    // it gets every event in that range, not just the next ~15 upcoming ones.
    const { from, to } = req.query || {};
    let range = null;
    if (from || to) {
      const fromMs = Date.parse(from);
      const toMs = Date.parse(to);
      if (isNaN(fromMs) || isNaN(toMs)) return reply.code(400).send({ error: 'invalid from/to' });
      range = { from: fromMs, to: toMs };
    }

    try {
      const cacheKeyPrefix = range ? `ical:range:${from}:${to}` : 'ical';
      const events = await fetchMerged(
        urls, cacheKeyPrefix, 15 * 60_000,
        (u) => fetchCalendarSource(u, range),
        (all) => range
          ? all.sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, 300) // generous safety cap, not a "top N" cap
          : all.sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, 15),
      );
      return { events };
    } catch (err) {
      return reply.code(502).send({ error: String(err.message || err) });
    }
  });

  app.get('/api/proxy/rss', async (req, reply) => {
    const raw = req.query?.url;
    const urls = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (!urls.length) return reply.code(400).send({ error: 'at least one url required' });
    try {
      const items = await fetchMerged(urls, 'rss', 15 * 60_000, fetchRssSource, (all) =>
        all.sort((a, b) => new Date(b.isoDate || 0) - new Date(a.isoDate || 0)).slice(0, 15)
      );
      return { items };
    } catch (err) {
      return reply.code(502).send({ error: String(err.message || err) });
    }
  });
}
