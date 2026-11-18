// Weather Matrix widget — host half.
// Node ESM, zero imports (Node >= 22 provides fetch / AbortController / URL / Response).
//
// Registers exactly two exact HTTP routes:
//   GET /dsh-weather/api    - geo/override -> Open-Meteo forecast (10min cache)
//   GET /dsh-weather/search - city search via Open-Meteo geocoding (30min cache)
// Pipeline: ipwho.is (geo, 24h memory cache) -> ipapi.co fallback -> Open-Meteo.
// Nothing is persisted to disk; only in-memory caches are used.
// The routes NEVER throw and always answer HTTP 200 with a JSON body.

const GEO_TTL_MS = 24 * 60 * 60 * 1000;
const FORECAST_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8000;
const SEARCH_TTL_MS = 30 * 60 * 1000;
const SEARCH_TIMEOUT_MS = 8000;
const SEARCH_CACHE_MAX = 50;

const GEO_URL = 'https://ipwho.is/?lang=zh-CN';
const GEO_FALLBACK_URL = 'https://ipapi.co/json/';
const SEARCH_URL = 'https://geocoding-api.open-meteo.com/v1/search';

const geoCache = { at: 0, place: null };
const forecastCache = new Map(); // rounded "lat,lon|name|tz" -> { at, payload }
const searchCache = new Map(); // "q|lang" -> { at, results }
let lastGoodPayload = null;
let lastGoodKey = '';

export const inject = ['webServer'];

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round1(value) {
  const n = toNum(value);
  return n === null ? null : Math.round(n * 10) / 10;
}

function cleanNumber(value, fallback) {
  const n = toNum(value);
  return n === null ? fallback : n;
}

function badShape(reason) {
  const err = new Error(reason || 'bad upstream payload');
  err.code = 'UPSTREAM';
  return err;
}

function errorPayload(code, message, fetchedAt, stale) {
  return {
    ok: false,
    error: { code: code, message: message },
    fetchedAt: typeof fetchedAt === 'number' ? fetchedAt : 0,
    stale: stale === true,
  };
}

// Query-string coordinate: '' and whitespace are invalid (Number('') === 0).
function parseCoordinate(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

// Trim a query-string text value and clamp it to a maximum length.
function clampText(value, maxLength) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text) return '';
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

// Pinned-location override from ?lat=&lon=&name=&tz=. Returns null when the
// coordinate pair is absent or out of range.
function parseOverridePlace(searchParams) {
  if (!searchParams || typeof searchParams.get !== 'function') return null;
  const latitude = parseCoordinate(searchParams.get('lat'));
  const longitude = parseCoordinate(searchParams.get('lon'));
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return {
    name: clampText(searchParams.get('name'), 80) || '自定义位置',
    latitude: latitude,
    longitude: longitude,
    timezone: clampText(searchParams.get('tz'), 64) || 'auto',
  };
}

// After a successful fetch, Open-Meteo's own grid coordinates and timezone win;
// the request/override values are the fallback.
function applyUpstreamPlace(place, raw) {
  const source = place && typeof place === 'object' ? place : {};
  const merged = {
    name: typeof source.name === 'string' && source.name ? source.name : '自定义位置',
    latitude: toNum(source.latitude),
    longitude: toNum(source.longitude),
    timezone: typeof source.timezone === 'string' && source.timezone ? source.timezone : 'auto',
  };
  if (raw && typeof raw === 'object') {
    const rawLatitude = toNum(raw.latitude);
    const rawLongitude = toNum(raw.longitude);
    if (rawLatitude !== null) merged.latitude = rawLatitude;
    if (rawLongitude !== null) merged.longitude = rawLongitude;
    const rawTimezone = typeof raw.timezone === 'string' ? raw.timezone.trim() : '';
    if (rawTimezone) merged.timezone = rawTimezone;
  }
  return merged;
}

async function fetchJson(url, timeoutMs) {
  const limit = Number(timeoutMs) > 0 ? Number(timeoutMs) : TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(function () {
    try { controller.abort(); } catch (err) { /* ignore */ }
  }, limit);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json, text/plain, */*' },
    });
    if (!response || !response.ok) {
      throw Object.assign(new Error('HTTP ' + String(response && response.status)), { code: 'UPSTREAM' });
    }
    const text = await response.text();
    if (!text) throw Object.assign(new Error('empty body'), { code: 'UPSTREAM' });
    try {
      return JSON.parse(text);
    } catch (parseErr) {
      throw Object.assign(new Error('invalid json'), { code: 'UPSTREAM' });
    }
  } catch (err) {
    if (err && err.code === 'UPSTREAM') throw err;
    const timeout = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
    throw Object.assign(new Error(timeout ? '请求超时' : '网络请求失败'), {
      code: 'NETWORK',
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }
}

function jsonResponse(body) {
  let text;
  try {
    text = JSON.stringify(body);
  } catch (err) {
    text = JSON.stringify(errorPayload('UPSTREAM', '天气服务暂时不可用', 0, false));
  }
  return new Response(text, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

// ---------------------------------------------------------------------------
// geo: ipwho.is first, ipapi.co fallback, 24h memory cache
// ---------------------------------------------------------------------------

function normalizePlace(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.success === false || raw.error) return null;
  const latitude = toNum(raw.latitude);
  const longitude = toNum(raw.longitude);
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  const name = String(raw.city || raw.region || raw.country || '').trim();
  if (!name) return null;
  let timezone = raw.timezone;
  if (timezone && typeof timezone === 'object') timezone = timezone.id;
  const tz = typeof timezone === 'string' && timezone.trim() ? timezone.trim() : 'UTC';
  return {
    name: name,
    latitude: Math.round(latitude * 1000) / 1000,
    longitude: Math.round(longitude * 1000) / 1000,
    timezone: tz,
  };
}

async function resolvePlace(options) {
  const force = !!(options && options.force);
  const now = Date.now();
  if (!force && geoCache.place && now - geoCache.at < GEO_TTL_MS) {
    return geoCache.place;
  }
  const loaders = [
    async function () { return normalizePlace(await fetchJson(GEO_URL, TIMEOUT_MS)); },
    async function () { return normalizePlace(await fetchJson(GEO_FALLBACK_URL, TIMEOUT_MS)); },
  ];
  for (let i = 0; i < loaders.length; i++) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const place = await loaders[i]();
        if (place) {
          geoCache.place = place;
          geoCache.at = Date.now();
          return place;
        }
        break; // provider answered but the payload was unusable -> next provider
      } catch (err) {
        if (attempt === 0) continue; // one transport-error retry, then next provider
        break;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// forecast: Open-Meteo, 10min memory cache keyed by rounded lat/lon
// ---------------------------------------------------------------------------

function buildForecastUrl(latitude, longitude) {
  const parts = [
    'latitude=' + encodeURIComponent(String(latitude)),
    'longitude=' + encodeURIComponent(String(longitude)),
    'current=' + 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day',
    'hourly=' + 'temperature_2m,weather_code,precipitation_probability,is_day',
    'daily=' + 'weather_code,temperature_2m_max,temperature_2m_min',
    'timezone=auto',
    'forecast_days=4',
  ];
  return 'https://api.open-meteo.com/v1/forecast?' + parts.join('&');
}

function placeLocalDate(timeZone) {
  try {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) return formatted;
  } catch (err) {
    // fall through to UTC
  }
  return new Date().toISOString().slice(0, 10);
}

function placeLocalIso(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const pick = {};
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].type !== 'literal') pick[parts[i].type] = parts[i].value;
    }
    if (pick.year && pick.month && pick.day) {
      return pick.year + '-' + pick.month + '-' + pick.day + 'T' + (pick.hour || '00') + ':' + (pick.minute || '00');
    }
  } catch (err) {
    // fall through to UTC
  }
  return new Date().toISOString().slice(0, 16);
}

function findCurrentHourIndex(times, nowTime) {
  if (!Array.isArray(times) || times.length === 0) return -1;
  const target = String(nowTime || '');
  const prefix = target.slice(0, 13); // 'YYYY-MM-DDTHH'
  if (prefix.length === 13) {
    for (let i = 0; i < times.length; i++) {
      if (String(times[i]).slice(0, 13) === prefix) return i;
    }
  }
  let best = -1;
  for (let i = 0; i < times.length; i++) {
    if (String(times[i]) <= target) best = i;
    else break;
  }
  return best >= 0 ? best : 0;
}

function buildPayload(raw, place) {
  if (!raw || typeof raw !== 'object') throw badShape('empty forecast');
  const current = raw.current;
  const hourly = raw.hourly;
  const daily = raw.daily;
  if (!current || typeof current !== 'object') throw badShape('missing current');
  if (!hourly || !Array.isArray(hourly.time) || hourly.time.length === 0) throw badShape('missing hourly');
  if (!Array.isArray(hourly.temperature_2m) || hourly.temperature_2m.length === 0) throw badShape('missing hourly temperature');
  if (!Array.isArray(hourly.weather_code) || hourly.weather_code.length === 0) throw badShape('missing hourly code');
  if (!daily || !Array.isArray(daily.time) || daily.time.length === 0) throw badShape('missing daily');
  if (!Array.isArray(daily.weather_code) || daily.weather_code.length === 0) throw badShape('missing daily code');
  if (!Array.isArray(daily.temperature_2m_max) || !Array.isArray(daily.temperature_2m_min)) {
    throw badShape('missing daily temperatures');
  }

  const nowTime = typeof current.time === 'string' && current.time ? current.time : placeLocalIso(place.timezone);
  const currentIndex = findCurrentHourIndex(hourly.time, nowTime);

  const currentTemp = toNum(current.temperature_2m);
  const currentFeels = toNum(current.apparent_temperature);
  const currentCode = toNum(current.weather_code);
  const hourlyPop = Array.isArray(hourly.precipitation_probability) ? hourly.precipitation_probability : [];
  const hourlyIsDay = Array.isArray(hourly.is_day) ? hourly.is_day : [];
  const popAtCurrent = currentIndex >= 0 ? toNum(hourlyPop[currentIndex]) : null;

  const now = {
    time: nowTime,
    temp: currentTemp === null ? 0 : currentTemp,
    feels: currentFeels === null ? (currentTemp === null ? 0 : currentTemp) : currentFeels,
    code: currentCode === null ? 0 : Math.round(currentCode),
    precip: cleanNumber(current.precipitation, 0),
    pop: popAtCurrent === null ? 0 : popAtCurrent,
    wind: cleanNumber(current.wind_speed_10m, 0),
    isDay: Number(current.is_day) === 1,
  };

  // 6 hourly slots, 3h apart, starting at the current local hour.
  const picked = [];
  if (currentIndex >= 0) {
    for (let k = 0; k < 6; k++) {
      const index = currentIndex + 3 * k;
      if (index >= hourly.time.length) break;
      const time = hourly.time[index];
      if (typeof time !== 'string' || !time) continue;
      const temp = toNum(hourly.temperature_2m[index]);
      if (temp === null) continue;
      const code = toNum(hourly.weather_code[index]);
      const pop = toNum(hourlyPop[index]);
      picked.push({
        time: time,
        temp: temp,
        code: code === null ? 0 : Math.round(code),
        pop: pop === null ? 0 : pop,
        isDay: Number(hourlyIsDay[index]) === 1,
      });
    }
  }
  if (picked.length === 0) throw badShape('no usable hourly entries');

  // 3 daily slots starting today in the place timezone.
  const today = placeLocalDate(place.timezone);
  let dayStart = 0;
  for (let i = 0; i < daily.time.length; i++) {
    if (String(daily.time[i]) >= today) { dayStart = i; break; }
  }
  const days = [];
  for (let k = 0; k < 3; k++) {
    const index = dayStart + k;
    if (index >= daily.time.length) break;
    const date = daily.time[index];
    if (typeof date !== 'string' || !date) continue;
    const code = toNum(daily.weather_code[index]);
    const min = round1(daily.temperature_2m_min[index]);
    const max = round1(daily.temperature_2m_max[index]);
    if (min === null || max === null) continue;
    days.push({
      date: date,
      code: code === null ? 0 : Math.round(code),
      min: min,
      max: max,
    });
  }
  if (days.length === 0) throw badShape('no usable daily entries');

  return {
    ok: true,
    place: {
      name: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: place.timezone,
    },
    now: now,
    hourly: picked,
    daily: days,
    fetchedAt: Date.now(),
    stale: false,
  };
}

async function fetchForecast(place, options) {
  const force = !!(options && options.force);
  if (!place || typeof place !== 'object') {
    return errorPayload('GEO', '无法定位当前城市', 0, false);
  }
  const latitude = toNum(place.latitude);
  const longitude = toNum(place.longitude);
  if (latitude === null || longitude === null) {
    return errorPayload('GEO', '无法定位当前城市', 0, false);
  }
  const name = typeof place.name === 'string' ? place.name : '';
  const tz = typeof place.timezone === 'string' ? place.timezone : '';
  const key = latitude.toFixed(2) + ',' + longitude.toFixed(2) + '|' + name + '|' + tz;
  const now = Date.now();
  const cached = forecastCache.get(key);
  if (!force && cached && now - cached.at < FORECAST_TTL_MS) {
    return cached.payload;
  }
  try {
    const raw = await fetchJson(buildForecastUrl(latitude, longitude), TIMEOUT_MS);
    const effectivePlace = applyUpstreamPlace(place, raw);
    const payload = buildPayload(raw, effectivePlace);
    forecastCache.set(key, { at: Date.now(), payload: payload });
    lastGoodPayload = payload;
    lastGoodKey = key;
    return payload;
  } catch (err) {
    const fallback = (cached && cached.payload) || (lastGoodKey === key ? lastGoodPayload : null);
    if (fallback) {
      const stale = Object.assign({}, fallback, {
        stale: true,
        notice: '网络不稳定，显示上一次的数据',
      });
      return stale;
    }
    const network = !!(err && err.code === 'NETWORK');
    return errorPayload(
      network ? 'NETWORK' : 'UPSTREAM',
      network ? '网络请求失败，无法获取天气' : '天气服务暂时不可用',
      0,
      false
    );
  }
}

// ---------------------------------------------------------------------------
// city search: Open-Meteo geocoding, 30min memory cache (max 50 entries)
// ---------------------------------------------------------------------------

function normalizeSearchResults(raw) {
  const list = raw && Array.isArray(raw.results) ? raw.results : [];
  const results = [];
  for (let i = 0; i < list.length && results.length < 6; i++) {
    const item = list[i];
    if (!item || typeof item !== 'object') continue;
    const latitude = toNum(item.latitude);
    const longitude = toNum(item.longitude);
    if (latitude === null || longitude === null) continue;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) continue;
    results.push({
      name: typeof item.name === 'string' ? item.name.trim() : '',
      admin1: typeof item.admin1 === 'string' ? item.admin1.trim() : '',
      country: typeof item.country === 'string' ? item.country.trim() : '',
      latitude: latitude,
      longitude: longitude,
      timezone: typeof item.timezone === 'string' ? item.timezone.trim() : '',
    });
  }
  return results;
}

// Resolve city-search candidates. Returns the public search body and never throws.
async function searchPlaces(query, lang) {
  const q = clampText(typeof query === 'string' ? query : '', 60);
  const language = lang === 'zh' ? 'zh' : 'en';
  if (!q) return { ok: true, results: [] };
  const key = q + '|' + language;
  const now = Date.now();
  const cached = searchCache.get(key);
  if (cached && now - cached.at < SEARCH_TTL_MS) {
    return { ok: true, results: cached.results };
  }
  try {
    const url = SEARCH_URL
      + '?name=' + encodeURIComponent(q)
      + '&count=6&language=' + language + '&format=json';
    const raw = await fetchJson(url, SEARCH_TIMEOUT_MS);
    const results = normalizeSearchResults(raw);
    if (searchCache.size >= SEARCH_CACHE_MAX) {
      const oldestKey = searchCache.keys().next();
      if (!oldestKey.done) searchCache.delete(oldestKey.value);
    }
    searchCache.set(key, { at: Date.now(), results: results });
    return { ok: true, results: results };
  } catch (err) {
    const network = !!(err && err.code === 'NETWORK');
    return {
      ok: false,
      error: {
        code: network ? 'NETWORK' : 'UPSTREAM',
        message: network ? '网络请求失败，无法搜索城市' : '搜索服务暂时不可用',
      },
    };
  }
}

async function handleSearchRequest(request) {
  let query = '';
  let lang = 'en';
  try {
    const rawUrl = request && typeof request.url === 'string' ? request.url : '';
    const url = new URL(rawUrl || '/dsh-weather/search', 'http://localhost');
    query = url.searchParams.get('q') || '';
    lang = url.searchParams.get('lang') === 'zh' ? 'zh' : 'en';
  } catch (err) {
    query = '';
    lang = 'en';
  }
  try {
    return jsonResponse(await searchPlaces(query, lang));
  } catch (err) {
    return jsonResponse({ ok: false, error: { code: 'UPSTREAM', message: '搜索服务暂时不可用' } });
  }
}

// ---------------------------------------------------------------------------
// route
// ---------------------------------------------------------------------------

async function handleRequest(request) {
  let force = false;
  let overridePlace = null;
  try {
    const rawUrl = request && typeof request.url === 'string' ? request.url : '';
    const url = new URL(rawUrl || '/dsh-weather/api', 'http://localhost');
    force = url.searchParams.get('force') === '1';
    overridePlace = parseOverridePlace(url.searchParams);
  } catch (err) {
    force = false;
    overridePlace = null;
  }
  try {
    // Pinned location wins and skips IP geolocation entirely.
    const place = overridePlace || (await resolvePlace({ force: false }));
    if (!place) {
      return jsonResponse(errorPayload('GEO', '无法定位当前城市', 0, false));
    }
    const payload = await fetchForecast(place, { force: force });
    return jsonResponse(payload);
  } catch (err) {
    return jsonResponse(errorPayload('UPSTREAM', '天气服务暂时不可用', 0, false));
  }
}

function resetCaches() {
  geoCache.at = 0;
  geoCache.place = null;
  forecastCache.clear();
  lastGoodPayload = null;
  lastGoodKey = '';
}

function resetSearchCache() {
  searchCache.clear();
}

export function apply(ctx, config) {
  if (!ctx || !ctx.webServer || typeof ctx.webServer.register !== 'function') return;
  const routes = [
    {
      kind: 'exact',
      path: '/dsh-weather/api',
      resource: function (request) {
        return handleRequest(request);
      },
    },
    {
      kind: 'exact',
      path: '/dsh-weather/search',
      resource: function (request) {
        return handleSearchRequest(request);
      },
    },
  ];
  const register = function (route) {
    try {
      return ctx.webServer.register(route);
    } catch (err) {
      return undefined;
    }
  };
  try {
    if (typeof ctx.effect === 'function') {
      routes.forEach(function (route) {
        ctx.effect(function () {
          return register(route);
        });
      });
    } else {
      for (let i = 0; i < routes.length; i++) register(routes[i]);
    }
  } catch (err) {
    // never throw from apply
  }
}

// Self-test / QA surface (not used by the widget in production).
export const _internal = {
  resolvePlace: resolvePlace,
  fetchWeather: fetchForecast,
  fetchForecast: fetchForecast,
  buildForecastUrl: buildForecastUrl,
  buildPayload: buildPayload,
  handleRequest: handleRequest,
  searchPlaces: searchPlaces,
  handleSearchRequest: handleSearchRequest,
  parseOverridePlace: parseOverridePlace,
  resetCaches: resetCaches,
  resetSearchCache: resetSearchCache,
};