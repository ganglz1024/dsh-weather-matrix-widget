// Weather Matrix widget — client data layer snippet.
//
// CONTRACT: this file is concatenated VERBATIM inside the browser module factory
// function (before the view code). It must stay plain ES2020 JavaScript:
//   * no import / export, no JSX, no top-level side effects
//   * every top-level identifier starts with `wx` or `WX_`
//   * safe to `node --check` standalone
// Later parts (view code) may call these functions in any order.

const WX_NS = 'weather-matrix-widget';
const WX_API = '/dsh-weather/api';
const WX_SEARCH = '/dsh-weather/search';
const WX_REFRESH_MS = 60 * 1000; // every minute (the view forces past the host cache)
const WX_CACHE_KEY = 'dsh-weather-matrix:payload:v1';
const WX_PLACE_KEY = 'dsh-weather-matrix:place:v1';

// Payload shape guard: we only accept a host payload that has ok:true plus the
// now/hourly/daily blocks the view code renders.
function wxIsPayload(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.ok !== true) return false;
  if (!data.now || typeof data.now !== 'object') return false;
  if (!Array.isArray(data.hourly) || data.hourly.length === 0) return false;
  if (!Array.isArray(data.daily) || data.daily.length === 0) return false;
  return true;
}

// Read last good payload from localStorage. Returns { data, savedAt } or null.
function wxReadCache() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    const raw = localStorage.getItem(WX_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!wxIsPayload(parsed.data)) return null;
    const savedAt = Number(parsed.savedAt);
    return { data: parsed.data, savedAt: Number.isFinite(savedAt) ? savedAt : 0 };
  } catch (err) {
    return null;
  }
}

// Persist a payload for offline fallback. Never throws.
function wxWriteCache(data) {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return false;
    if (!wxIsPayload(data)) return false;
    localStorage.setItem(WX_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data: data }));
    return true;
  } catch (err) {
    return false;
  }
}

// Validate + normalize a pinned place. Returns null when lat/lon are unusable.
function wxValidPlace(place) {
  if (!place || typeof place !== 'object') return null;
  const latitude = Number(place.latitude);
  const longitude = Number(place.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  const name = typeof place.name === 'string' ? place.name.trim() : '';
  const timezone = typeof place.timezone === 'string' ? place.timezone.trim() : '';
  return {
    name: name || '自定义位置',
    latitude: latitude,
    longitude: longitude,
    timezone: timezone || 'auto',
  };
}

// Read the pinned place from localStorage. Returns { name, latitude, longitude, timezone } or null.
function wxReadPlace() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    const raw = localStorage.getItem(WX_PLACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return wxValidPlace(parsed);
  } catch (err) {
    return null;
  }
}

// Persist the pinned place. Never throws; returns true only when something was stored.
function wxWritePlace(place) {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return false;
    const valid = wxValidPlace(place);
    if (!valid) return false;
    localStorage.setItem(WX_PLACE_KEY, JSON.stringify(valid));
    return true;
  } catch (err) {
    return false;
  }
}

// Forget the pinned place (back to automatic IP location). Never throws.
function wxClearPlace() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return;
    localStorage.removeItem(WX_PLACE_KEY);
  } catch (err) {
    // ignore
  }
}

// Fetch /dsh-weather/api with a timeout and localStorage fallback.
// Resolves { status: 'ok'|'stale'|'error', data, error, fetchedAt, fromCache } and never throws.
async function wxFetchWeather(opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const force = options.force === true || options.force === 1;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15000;
  const cached = wxReadCache();
  const cachedResult = function (error) {
    return {
      status: 'stale',
      data: cached ? cached.data : null,
      error: {
        code: String((error && error.code) || 'NETWORK'),
        message: String((error && error.message) || '网络请求失败'),
      },
      fetchedAt: cached ? cached.savedAt : 0,
      fromCache: true,
    };
  };
  try {
    if (typeof fetch !== 'function') throw new Error('fetch is unavailable');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timerId = 0;
    if (controller) {
      timerId = setTimeout(function () {
        try { controller.abort(); } catch (err) { /* ignore */ }
      }, timeoutMs);
    }
    // A pinned place overrides IP geolocation on the host.
    const place = wxReadPlace();
    const params = [];
    if (place) {
      params.push('lat=' + encodeURIComponent(String(place.latitude)));
      params.push('lon=' + encodeURIComponent(String(place.longitude)));
      params.push('name=' + encodeURIComponent(place.name));
      params.push('tz=' + encodeURIComponent(place.timezone));
    }
    if (force) params.push('force=1');
    const url = params.length > 0 ? WX_API + '?' + params.join('&') : WX_API;
    let response;
    try {
      response = await fetch(url, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: controller ? controller.signal : undefined,
      });
    } finally {
      if (timerId) clearTimeout(timerId);
    }
    if (!response || !response.ok) {
      throw Object.assign(new Error('HTTP ' + String(response && response.status)), { code: 'UPSTREAM' });
    }
    const body = await response.json();
    if (wxIsPayload(body)) {
      wxWriteCache(body);
      return {
        status: body.stale === true ? 'stale' : 'ok',
        data: body,
        error: null,
        fetchedAt: Number(body.fetchedAt) || Date.now(),
        fromCache: false,
      };
    }
    const upstream = (body && body.error && typeof body.error === 'object') ? body.error : {};
    const failure = {
      code: String(upstream.code || 'UPSTREAM'),
      message: String(upstream.message || '天气数据格式异常'),
    };
    if (cached) return cachedResult(failure);
    return { status: 'error', data: null, error: failure, fetchedAt: 0, fromCache: false };
  } catch (err) {
    const failure = {
      code: err && err.code === 'UPSTREAM' ? 'UPSTREAM' : 'NETWORK',
      message: err && err.code === 'UPSTREAM' ? '天气服务暂时不可用' : '网络请求失败',
    };
    if (cached) return cachedResult(failure);
    return { status: 'error', data: null, error: failure, fetchedAt: 0, fromCache: false };
  }
}

// Search cities through the host geocoding route. Never throws.
// Resolves { ok, results, error }; error is { code, message } | null.
async function wxSearchPlaces(query, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const text = typeof query === 'string' ? query.trim() : '';
  const lang = options.lang === 'zh' || options.lang === 'en' ? options.lang : wxDefaultSearchLang();
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 12000;
  const generic = lang === 'zh' ? '搜索失败，请重试' : 'Search failed, try again';
  const fail = function (code) {
    return { ok: false, results: [], error: { code: code, message: generic } };
  };
  if (!text) return { ok: true, results: [], error: null };
  try {
    if (typeof fetch !== 'function') return fail('NETWORK');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timerId = 0;
    if (controller) {
      timerId = setTimeout(function () {
        try { controller.abort(); } catch (err) { /* ignore */ }
      }, timeoutMs);
    }
    let response;
    try {
      response = await fetch(WX_SEARCH + '?q=' + encodeURIComponent(text) + '&lang=' + lang, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: controller ? controller.signal : undefined,
      });
    } finally {
      if (timerId) clearTimeout(timerId);
    }
    if (!response || !response.ok) {
      throw Object.assign(new Error('HTTP ' + String(response && response.status)), { code: 'UPSTREAM' });
    }
    const body = await response.json();
    if (!body || typeof body !== 'object' || body.ok !== true) {
      const upstream = body && body.error && typeof body.error === 'object' ? body.error : {};
      return fail(String(upstream.code || 'UPSTREAM'));
    }
    const list = Array.isArray(body.results) ? body.results : [];
    const results = [];
    for (let i = 0; i < list.length && results.length < 6; i++) {
      const item = list[i];
      if (!item || typeof item !== 'object') continue;
      const latitude = Number(item.latitude);
      const longitude = Number(item.longitude);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) continue;
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) continue;
      results.push({
        name: typeof item.name === 'string' ? item.name.trim() : '',
        admin1: typeof item.admin1 === 'string' ? item.admin1.trim() : '',
        country: typeof item.country === 'string' ? item.country.trim() : '',
        latitude: latitude,
        longitude: longitude,
        timezone: typeof item.timezone === 'string' ? item.timezone.trim() : '',
      });
    }
    return { ok: true, results: results, error: null };
  } catch (err) {
    return fail(err && err.code === 'UPSTREAM' ? 'UPSTREAM' : 'NETWORK');
  }
}

// Default search language from the browser UI locale.
function wxDefaultSearchLang() {
  try {
    if (typeof navigator !== 'undefined' && navigator && typeof navigator.language === 'string') {
      return wxResolveLang(navigator.language);
    }
  } catch (err) {
    // ignore
  }
  return 'en';
}

// WMO weather code -> { icon, zh, en }. icon is one of the scene kinds below.
const WX_CODE_TABLE = {
  0: ['clear', '晴', 'Clear'],
  1: ['clear', '少云', 'Mostly clear'],
  2: ['partly', '多云', 'Partly cloudy'],
  3: ['overcast', '阴', 'Overcast'],
  45: ['fog', '雾', 'Fog'],
  48: ['fog', '雾', 'Fog'],
  51: ['drizzle', '毛毛雨', 'Drizzle'],
  53: ['drizzle', '毛毛雨', 'Drizzle'],
  55: ['drizzle', '毛毛雨', 'Drizzle'],
  56: ['sleet', '冻雨', 'Freezing drizzle'],
  57: ['sleet', '冻雨', 'Freezing drizzle'],
  61: ['rain', '小雨', 'Light rain'],
  63: ['rain', '中雨', 'Moderate rain'],
  65: ['heavy-rain', '大雨', 'Heavy rain'],
  66: ['sleet', '冻雨', 'Freezing rain'],
  67: ['sleet', '冻雨', 'Freezing rain'],
  71: ['snow', '小雪', 'Light snow'],
  73: ['snow', '中雪', 'Moderate snow'],
  75: ['snow', '大雪', 'Heavy snow'],
  77: ['snow', '雪粒', 'Snow grains'],
  80: ['rain', '阵雨', 'Rain showers'],
  81: ['rain', '阵雨', 'Rain showers'],
  82: ['heavy-rain', '阵雨', 'Rain showers'],
  85: ['snow', '阵雪', 'Snow showers'],
  86: ['snow', '阵雪', 'Snow showers'],
  95: ['thunder', '雷阵雨', 'Thunderstorm'],
  96: ['thunder', '雷暴冰雹', 'Thunderstorm with hail'],
  99: ['thunder', '雷暴冰雹', 'Thunderstorm with hail'],
};

// Describe a WMO code; unknown codes degrade to the cloudy scene.
function wxDescribeCode(code) {
  const key = String(Math.round(Number(code)));
  const row = WX_CODE_TABLE[key];
  if (!row) return { icon: 'cloudy', zh: '多云', en: 'Cloudy' };
  return { icon: row[0], zh: row[1], en: row[2] };
}

// Icon id for a WMO code, honoring the day/night split for clear and partly.
function wxIconFor(code, isDay) {
  const desc = wxDescribeCode(code);
  if (isDay === false) {
    if (desc.icon === 'clear') return 'clear-night';
    if (desc.icon === 'partly') return 'partly-night';
  }
  return desc.icon;
}

// Base visual intensity per scene kind (0 calm .. 1 violent).
const WX_INTENSITY = {
  clear: 0,
  partly: 0.05,
  cloudy: 0.1,
  overcast: 0.1,
  fog: 0.25,
  drizzle: 0.35,
  rain: 0.55,
  'heavy-rain': 0.85,
  snow: 0.6,
  thunder: 0.9,
  sleet: 0.5,
};

// Derive the visual scene from a host payload: { kind, isDay, intensity, wind }.
function wxSceneOf(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const now = payload.now && typeof payload.now === 'object' ? payload.now : {};
  const desc = wxDescribeCode(now.code);
  let intensity = WX_INTENSITY[desc.icon];
  if (typeof intensity !== 'number') intensity = 0.1;
  const precip = Number(now.precip);
  if (Number.isFinite(precip) && precip > 0) {
    intensity += Math.min(0.35, precip * 0.08);
  }
  if (intensity < 0) intensity = 0;
  if (intensity > 1) intensity = 1;
  const wind = Number(now.wind);
  return {
    kind: desc.icon,
    isDay: now.isDay !== false,
    intensity: intensity,
    wind: Number.isFinite(wind) ? wind : 0,
  };
}

// '现在'/'Now' for the first slot, otherwise a zero padded 24h hour label.
function wxHourLabel(isoTime, index, lang) {
  const zh = lang === 'zh';
  if (index === 0) return zh ? '现在' : 'Now';
  const text = typeof isoTime === 'string' ? isoTime : '';
  const match = /T(\d{2})/.exec(text);
  if (match) return match[1];
  const hours = new Date(text);
  if (!isNaN(hours.getTime())) {
    const hh = String(hours.getHours());
    return hh.length < 2 ? '0' + hh : hh;
  }
  return '--';
}

// '今天'/'Today', '明天'/'Tomorrow', else short weekday from the local date.
function wxDayLabel(dateStr, index, lang) {
  const zh = lang === 'zh';
  if (index === 0) return zh ? '今天' : 'Today';
  if (index === 1) return zh ? '明天' : 'Tomorrow';
  const parsed = new Date(String(dateStr) + 'T00:00:00');
  if (isNaN(parsed.getTime())) return String(dateStr || '');
  const day = parsed.getDay();
  const zhDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const enDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return zh ? zhDays[day] : enDays[day];
}

// 'HH:MM' clock text from a payload (payload.now.time) or an ISO string.
function wxClockText(isoTimeOrPayload, nowMs) {
  let iso = '';
  if (isoTimeOrPayload && typeof isoTimeOrPayload === 'object') {
    iso = isoTimeOrPayload.now && typeof isoTimeOrPayload.now.time === 'string'
      ? isoTimeOrPayload.now.time
      : '';
  } else if (typeof isoTimeOrPayload === 'string') {
    iso = isoTimeOrPayload;
  }
  const match = /T(\d{2}):(\d{2})/.exec(iso);
  if (match) return match[1] + ':' + match[2];
  const stamp = Number.isFinite(Number(nowMs)) && Number(nowMs) > 0 ? Number(nowMs) : Date.now();
  const date = new Date(stamp);
  const hh = String(date.getHours());
  const mm = String(date.getMinutes());
  return (hh.length < 2 ? '0' + hh : hh) + ':' + (mm.length < 2 ? '0' + mm : mm);
}

// Active UI locale id -> supported dictionary key.
function wxResolveLang(activeLocaleId) {
  const id = typeof activeLocaleId === 'string' ? activeLocaleId : '';
  return id.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
}

// Flat UI dictionaries; both share exactly the same key set.
function wxLocaleDicts() {
  return {
    zh: {
      'app.title': '天气矩阵',
      'now': '现在',
      'today': '今天',
      'tomorrow': '明天',
      'feels': '体感',
      'precip': '降水',
      'wind': '风力',
      'live': 'Live',
      'loading': '正在获取天气…',
      'offline': '天气数据暂不可用',
      'retry': '点击重试',
      'updated': '更新于',
      'stale': '网络不稳定，显示上次数据',
      'unit.kmh': 'km/h',
      'unit.percent': '%',
      'drag': '拖动移动',
      'refresh': '点击刷新',
      'city.search': '输入城市名',
      'city.auto': '使用自动定位',
      'city.loading': '搜索中…',
      'city.empty': '没有找到匹配的城市',
      'city.error': '搜索失败，请重试',
      'city.cancel': '取消',
      'city.pinned': '已固定',
    },
    en: {
      'app.title': 'Weather matrix',
      'now': 'Now',
      'today': 'Today',
      'tomorrow': 'Tomorrow',
      'feels': 'Feels like',
      'precip': 'Precip',
      'wind': 'Wind',
      'live': 'Live',
      'loading': 'Loading…',
      'offline': 'Weather unavailable',
      'retry': 'Click to retry',
      'updated': 'Updated',
      'stale': 'Offline, showing cached data',
      'unit.kmh': 'km/h',
      'unit.percent': '%',
      'drag': 'Drag to move',
      'refresh': 'Click to refresh',
      'city.search': 'Search a city',
      'city.auto': 'Use automatic location',
      'city.loading': 'Searching…',
      'city.empty': 'No matching city',
      'city.error': 'Search failed, try again',
      'city.cancel': 'Cancel',
      'city.pinned': 'Pinned',
    },
  };
}