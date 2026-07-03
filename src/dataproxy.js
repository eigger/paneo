// Server-side data proxy (docs/design.md §4.2 / §8.3): widgets never call third-party
// APIs directly from the browser — the server fetches, caches, and returns simplified JSON.
// This keeps API keys (future providers) server-only and avoids CORS/rate-limit issues.
import Parser from 'rss-parser';
import ical from 'node-ical'; // CJS module: async/sync live under the default export

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

async function fetchCalendarSource(url) {
  const events = await ical.async.fromURL(url);
  const now = Date.now();
  return Object.values(events)
    .filter((e) => e.type === 'VEVENT' && e.start)
    .map((e) => ({ summary: e.summary || '(제목 없음)', start: e.start.toISOString(), end: e.end?.toISOString() }))
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

  app.get('/api/proxy/ical', async (req, reply) => {
    const raw = req.query?.url;
    const urls = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (!urls.length) return reply.code(400).send({ error: 'at least one url required' });
    try {
      const events = await fetchMerged(urls, 'ical', 15 * 60_000, fetchCalendarSource, (all) =>
        all.sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, 15)
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
