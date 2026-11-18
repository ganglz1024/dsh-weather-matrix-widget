// Weather Matrix widget — host pipeline self-test (no browser required).
//
// Run:  node test/host-selftest.mjs
// Once weather-matrix-widget/package.json with "type": "module" exists this
// imports ../index.js directly. Before the Lead assembles the package it
// falls back to importing the exact same source through a data: URL, so it
// still exercises the real pipeline in this checkout.
//
// Exit code 0 = all checks passed, 1 = at least one FAIL.

const failures = [];
const warnings = [];
let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('PASS ' + name);
  } catch (err) {
    failures.push(name + ' -> ' + (err && err.message ? err.message : String(err)));
    console.log('FAIL ' + name + ' -> ' + (err && err.message ? err.message : String(err)));
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('PASS ' + name);
  } catch (err) {
    failures.push(name + ' -> ' + (err && err.message ? err.message : String(err)));
    console.log('FAIL ' + name + ' -> ' + (err && err.message ? err.message : String(err)));
  }
}

function failEarly(message) {
  failures.push(message);
  console.log('FAIL ' + message);
}

// --- load the host module -------------------------------------------------
const indexUrl = new URL('../index.js', import.meta.url);
let host = null;
let loadMode = 'import ../index.js (ESM package)';
try {
  host = await import(indexUrl.href);
} catch (firstError) {
  // Package.json has not been assembled yet: same source, data: URL module.
  try {
    const getBuiltin = typeof process.getBuiltinModule === 'function' ? process.getBuiltinModule : null;
    if (!getBuiltin) throw new Error('process.getBuiltinModule is unavailable');
    const fs = getBuiltin('node:fs');
    const source = fs.readFileSync(indexUrl, 'utf8');
    const encoded = Buffer.from(source, 'utf8').toString('base64');
    host = await import('data:text/javascript;base64,' + encoded);
    loadMode = 'data: URL fallback (package.json not assembled yet)';
  } catch (secondError) {
    failEarly('cannot load ../index.js: ' + (firstError && firstError.message) + ' / ' + (secondError && secondError.message));
  }
}

if (!host) {
  console.log('\nALL FAIL — host module not importable');
  process.exit(1);
}
console.log('# module load: ' + loadMode);

const I = host._internal;
if (!I) {
  failEarly('index.js does not export _internal');
  console.log('\nALL FAIL');
  process.exit(1);
}

const REQUIRED_HELPERS = ['resolvePlace', 'fetchForecast', 'fetchWeather', 'resetCaches', 'searchPlaces', 'handleSearchRequest', 'parseOverridePlace'];
for (const name of REQUIRED_HELPERS) {
  check('_internal.' + name + ' is a function', function () {
    assert(typeof I[name] === 'function', name + ' missing');
  });
}
check('inject lists webServer', function () {
  assert(Array.isArray(host.inject) && host.inject.indexOf('webServer') >= 0, 'inject != [webServer]');
});
check('apply is a function and is a no-op without ctx', function () {
  assert(typeof host.apply === 'function', 'apply missing');
  host.apply(undefined, {});
  host.apply({}, {});
  host.apply({ webServer: {} }, {});
});
check('apply registers both exact routes through ctx.effect', function () {
  const registered = [];
  const ctx = {
    webServer: {
      register: function (route) {
        registered.push(route);
        return function () { /* disposer */ };
      },
    },
    effect: function (fn) {
      const disposer = fn();
      assert(typeof disposer === 'function', 'effect callback should return a disposer');
    },
  };
  host.apply(ctx, {});
  assert(registered.length === 2, 'expected 2 routes, got ' + registered.length);
  assert(registered[0].kind === 'exact' && registered[0].path === '/dsh-weather/api', 'api route wrong');
  assert(registered[1].kind === 'exact' && registered[1].path === '/dsh-weather/search', 'search route wrong');
  assert(typeof registered[1].resource === 'function', 'search route resource missing');
});

// --- real pipeline: geo + forecast ---------------------------------------
let place = null;
let payload = null;

await checkAsync('resolvePlace() resolves a realistic place', async function () {
  I.resetCaches();
  place = await I.resolvePlace();
  assert(place && typeof place === 'object', 'resolvePlace returned null');
  assert(typeof place.name === 'string' && place.name.length > 0, 'place.name empty');
  assert(Number.isFinite(place.latitude) && place.latitude >= -90 && place.latitude <= 90, 'bad latitude');
  assert(Number.isFinite(place.longitude) && place.longitude >= -180 && place.longitude <= 180, 'bad longitude');
  assert(typeof place.timezone === 'string' && place.timezone.length > 0, 'bad timezone');
  console.log('# place: ' + place.name + ' @ ' + place.latitude + ',' + place.longitude + ' (' + place.timezone + ')');
  if (place.latitude < 20 || place.latitude > 45 || place.longitude < 100 || place.longitude > 130) {
    warnings.push('place outside mainland-China bounds: ' + JSON.stringify(place));
  }
});

await checkAsync('fetchForecast(place) returns a contract-shaped payload', async function () {
  assert(place, 'no place');
  payload = await I.fetchForecast(place);
  assert(payload && typeof payload === 'object', 'no payload');
  assert(payload.ok === true, 'ok !== true: ' + JSON.stringify(payload.error || null));
  assert(payload.stale === false, 'stale !== false');
  assert(Number.isFinite(payload.fetchedAt) && payload.fetchedAt > 0, 'bad fetchedAt');
  assert(payload.place && payload.place.name === place.name, 'place.name mismatch');
  assert(payload.place.timezone === place.timezone, 'place.timezone mismatch');

  const now = payload.now;
  assert(now && typeof now === 'object', 'no now');
  assert(typeof now.time === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(now.time), 'bad now.time');
  ['temp', 'feels', 'precip', 'pop', 'wind'].forEach(function (key) {
    assert(Number.isFinite(now[key]), 'now.' + key + ' not finite: ' + now[key]);
  });
  assert(Number.isInteger(now.code), 'now.code not integer');
  assert(typeof now.isDay === 'boolean', 'now.isDay not boolean');

  assert(Array.isArray(payload.hourly), 'hourly not array');
  assert(payload.hourly.length === 6, 'hourly length ' + payload.hourly.length + ' (want 6)');
  assert(payload.hourly[0].time.slice(0, 13) === now.time.slice(0, 13), 'first hourly slot not current hour');
  for (let i = 0; i < payload.hourly.length; i++) {
    const slot = payload.hourly[i];
    assert(typeof slot.time === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(slot.time), 'hourly[' + i + '].time bad');
    assert(Number.isFinite(slot.temp), 'hourly[' + i + '].temp not finite');
    assert(Number.isInteger(slot.code), 'hourly[' + i + '].code not integer');
    assert(Number.isFinite(slot.pop), 'hourly[' + i + '].pop not finite');
    assert(typeof slot.isDay === 'boolean', 'hourly[' + i + '].isDay not boolean');
    assert(slot.temp > -80 && slot.temp < 60, 'hourly[' + i + '].temp unrealistic: ' + slot.temp);
    if (i > 0) {
      const step = new Date(slot.time).getTime() - new Date(payload.hourly[i - 1].time).getTime();
      assert(step === 3 * 60 * 60 * 1000, 'hourly step ' + step + 'ms (want 3h)');
    }
  }

  assert(Array.isArray(payload.daily), 'daily not array');
  assert(payload.daily.length === 3, 'daily length ' + payload.daily.length + ' (want 3)');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: place.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  assert(payload.daily[0].date === today, 'daily[0] ' + payload.daily[0].date + ' != today ' + today);
  for (let i = 0; i < payload.daily.length; i++) {
    const day = payload.daily[i];
    assert(/^\d{4}-\d{2}-\d{2}$/.test(day.date), 'daily[' + i + '].date bad');
    assert(Number.isInteger(day.code), 'daily[' + i + '].code not integer');
    assert(Number.isFinite(day.min) && Number.isFinite(day.max), 'daily[' + i + '] min/max not finite');
    assert(day.min <= day.max, 'daily[' + i + '] min > max');
  }
});

if (payload && payload.ok === true) {
  console.log('\n--- live payload ---');
  console.log(JSON.stringify(payload, null, 2));
  console.log('--- end payload ---\n');

  await checkAsync('10-minute cache: second call is served from memory', async function () {
    const second = await I.fetchForecast(place);
    assert(second.fetchedAt === payload.fetchedAt, 'cache miss (fetchedAt changed)');
  });

  await checkAsync('?force=1 path bypasses the weather cache', async function () {
    const forced = await I.fetchForecast(place, { force: true });
    assert(forced.ok === true, 'forced refresh not ok: ' + JSON.stringify(forced.error || null));
    assert(forced.fetchedAt >= payload.fetchedAt, 'forced fetchedAt went backwards');
    if (forced.stale === true) warnings.push('forced refresh came back stale (upstream hiccup)');
    else assert(forced.stale === false, 'unexpected stale flag');
  });

  await checkAsync('route handler answers HTTP 200 JSON (cached path)', async function () {
    const response = await I.handleRequest({ url: '/dsh-weather/api?force=0' });
    assert(response && typeof response === 'object', 'no Response');
    assert(response.status === 200, 'status ' + response.status);
    assert(String(response.headers.get('content-type')).indexOf('application/json') === 0, 'bad content-type');
    assert(response.headers.get('cache-control') === 'no-store', 'bad cache-control');
    const body = await response.json();
    assert(body.ok === true, 'route body not ok');
    assert(Array.isArray(body.hourly) && body.hourly.length === 6, 'route hourly wrong');
  });

  await checkAsync('route handler never throws on a junk request', async function () {
    const response = await I.handleRequest({});
    assert(response && response.status === 200, 'junk request not answered 200');
    const body = await response.json();
    assert(body && typeof body === 'object', 'junk request body not json');
  });
}

await checkAsync('fetchForecast(null) yields ok:false / GEO with Chinese message', async function () {
  const bad = await I.fetchForecast(null);
  assert(bad.ok === false, 'expected ok:false');
  assert(bad.error && bad.error.code === 'GEO', 'expected code GEO, got ' + JSON.stringify(bad.error));
  assert(bad.error.message === '无法定位当前城市', 'unexpected message: ' + bad.error.message);
  assert(bad.stale === false && bad.fetchedAt === 0, 'bad error payload metadata');
});

check('buildPayload rejects malformed upstream data', function () {
  let threw = false;
  try { I.buildPayload(null, place || { timezone: 'UTC' }); } catch (err) { threw = true; }
  assert(threw, 'buildPayload(null) did not throw');
});

// --- failure paths (simulated offline; global fetch is overridden) -------
await checkAsync('offline: last good payload is served with stale + notice', async function () {
  // The forced refresh above may already have replaced the cache entry, so
  // snapshot the current cache payload and compare against that timestamp.
  const latest = await I.fetchForecast(place);
  const realFetch = globalThis.fetch;
  globalThis.fetch = function () { return Promise.reject(new Error('simulated offline')); };
  try {
    const stale = await I.fetchForecast(place, { force: true });
    assert(stale.ok === true, 'stale fallback not ok: ' + JSON.stringify(stale.error || null));
    assert(stale.stale === true, 'stale flag missing');
    assert(stale.notice === '网络不稳定，显示上一次的数据', 'notice missing: ' + stale.notice);
    assert(stale.fetchedAt === latest.fetchedAt, 'stale fetchedAt should keep the last good timestamp');
    assert(stale.now && Array.isArray(stale.hourly), 'stale payload lost its data blocks');
  } finally {
    globalThis.fetch = realFetch;
  }
});

await checkAsync('offline cold start: ok:false with NETWORK code', async function () {
  const realFetch = globalThis.fetch;
  globalThis.fetch = function () { return Promise.reject(new Error('simulated offline')); };
  try {
    I.resetCaches();
    const bad = await I.fetchForecast(place, { force: true });
    assert(bad.ok === false, 'expected ok:false');
    assert(bad.error && bad.error.code === 'NETWORK', 'expected NETWORK, got ' + JSON.stringify(bad.error));
    assert(typeof bad.error.message === 'string' && bad.error.message.length > 0, 'missing message');
  } finally {
    globalThis.fetch = realFetch;
    I.resetCaches();
  }
});

await checkAsync('route: geo failure answers HTTP 200 with ok:false/GEO', async function () {
  const realFetch = globalThis.fetch;
  globalThis.fetch = function () { return Promise.reject(new Error('simulated offline')); };
  try {
    I.resetCaches();
    const response = await I.handleRequest({ url: '/dsh-weather/api?force=1' });
    assert(response && response.status === 200, 'status ' + (response && response.status));
    const body = await response.json();
    assert(body.ok === false, 'expected ok:false');
    assert(body.error && body.error.code === 'GEO', 'expected GEO, got ' + JSON.stringify(body));
    assert(body.error.message === '无法定位当前城市', 'unexpected message: ' + body.error.message);
  } finally {
    globalThis.fetch = realFetch;
    I.resetCaches();
  }
});

// --- live city search + pinned-location override -------------------------
await checkAsync('searchPlaces("镇江","zh") returns live geocoding results', async function () {
  I.resetSearchCache();
  const body = await I.searchPlaces('镇江', 'zh');
  assert(body && body.ok === true, 'search not ok: ' + JSON.stringify((body && body.error) || null));
  assert(Array.isArray(body.results) && body.results.length >= 1, 'no search results');
  assert(body.results.length <= 6, 'too many results: ' + body.results.length);
  const first = body.results[0];
  assert(typeof first.name === 'string' && first.name.length > 0, 'result.name empty');
  assert(Number.isFinite(first.latitude) && first.latitude >= -90 && first.latitude <= 90, 'bad result latitude');
  assert(Number.isFinite(first.longitude) && first.longitude >= -180 && first.longitude <= 180, 'bad result longitude');
  assert(typeof first.timezone === 'string' && first.timezone.length > 0, 'missing result timezone');
  assert(typeof first.admin1 === 'string' && typeof first.country === 'string', 'result admin1/country not strings');
  console.log('# search result: ' + first.name + ' / ' + first.admin1 + ' / ' + first.country + ' @ '
    + first.latitude + ',' + first.longitude + ' (' + first.timezone + ')');
});

await checkAsync('search route answers HTTP 200 JSON for an empty q', async function () {
  const response = await I.handleSearchRequest({ url: '/dsh-weather/search?q=' });
  assert(response && response.status === 200, 'status ' + (response && response.status));
  assert(String(response.headers.get('content-type')).indexOf('application/json') === 0, 'bad content-type');
  const body = await response.json();
  assert(body && body.ok === true, 'empty q not ok:true');
  assert(Array.isArray(body.results) && body.results.length === 0, 'empty q should give []');
});

await checkAsync('route: pinned override returns 镇江 + hourly isDay booleans', async function () {
  const response = await I.handleRequest({
    url: '/dsh-weather/api?lat=32.21&lon=119.46&name=' + encodeURIComponent('镇江') + '&force=1',
  });
  assert(response && response.status === 200, 'status ' + (response && response.status));
  const body = await response.json();
  assert(body.ok === true, 'override not ok: ' + JSON.stringify(body.error || null));
  assert(body.place && body.place.name === '镇江', 'place.name ' + (body.place && body.place.name));
  assert(Number.isFinite(body.place.latitude) && Number.isFinite(body.place.longitude), 'place lat/lon not numeric');
  assert(body.place.latitude > 31 && body.place.latitude < 33, 'place.latitude not near Zhenjiang: ' + body.place.latitude);
  assert(body.place.longitude > 118 && body.place.longitude < 121, 'place.longitude not near Zhenjiang: ' + body.place.longitude);
  assert(typeof body.place.timezone === 'string' && body.place.timezone.length > 0, 'place.timezone missing');
  console.log('# override place: ' + JSON.stringify(body.place));
  assert(Array.isArray(body.hourly) && body.hourly.length === 6, 'hourly wrong: ' + (body.hourly && body.hourly.length));
  for (let i = 0; i < body.hourly.length; i++) {
    assert(typeof body.hourly[i].isDay === 'boolean', 'hourly[' + i + '].isDay not boolean');
  }
});

// --- client data layer smoke test (no browser) ---------------------------
let clientApi = null;
await checkAsync('parts/00-data.js parses as a factory body and exposes helpers', async function () {
  const getBuiltin = typeof process.getBuiltinModule === 'function' ? process.getBuiltinModule : null;
  assert(getBuiltin, 'process.getBuiltinModule unavailable');
  const fs = getBuiltin('node:fs');
  const source = fs.readFileSync(new URL('../parts/00-data.js', import.meta.url), 'utf8');
  assert(!/^\s*(import|export)\b/m.test(source), 'client data layer contains import/export');
  const factory = new Function('"use strict";\n' + source + '\nreturn { WX_NS: WX_NS, WX_API: WX_API, WX_SEARCH: WX_SEARCH, WX_REFRESH_MS: WX_REFRESH_MS, WX_CACHE_KEY: WX_CACHE_KEY, WX_PLACE_KEY: WX_PLACE_KEY, wxReadCache: wxReadCache, wxWriteCache: wxWriteCache, wxReadPlace: wxReadPlace, wxWritePlace: wxWritePlace, wxClearPlace: wxClearPlace, wxFetchWeather: wxFetchWeather, wxSearchPlaces: wxSearchPlaces, wxIconFor: wxIconFor, wxDescribeCode: wxDescribeCode, wxSceneOf: wxSceneOf, wxHourLabel: wxHourLabel, wxDayLabel: wxDayLabel, wxClockText: wxClockText, wxResolveLang: wxResolveLang, wxLocaleDicts: wxLocaleDicts };');
  const api = factory();
  clientApi = api;
  assert(api.WX_NS === 'weather-matrix-widget', 'WX_NS wrong');
  assert(api.WX_API === '/dsh-weather/api', 'WX_API wrong');
  assert(api.WX_SEARCH === '/dsh-weather/search', 'WX_SEARCH wrong');
  assert(api.WX_REFRESH_MS === 60 * 1000, 'WX_REFRESH_MS wrong');
  assert(api.WX_CACHE_KEY === 'dsh-weather-matrix:payload:v1', 'WX_CACHE_KEY wrong');
  assert(api.WX_PLACE_KEY === 'dsh-weather-matrix:place:v1', 'WX_PLACE_KEY wrong');
  const rain = api.wxDescribeCode(61);
  assert(rain.icon === 'rain' && rain.zh === '小雨' && rain.en === 'Light rain', 'wxDescribeCode(61) wrong');
  const unknown = api.wxDescribeCode(12345);
  assert(unknown.icon === 'cloudy' && unknown.zh === '多云' && unknown.en === 'Cloudy', 'unknown code fallback wrong');
  const scene = api.wxSceneOf({ now: { code: 61, precip: 0.5, wind: 20.2, isDay: false } });
  assert(scene.kind === 'rain' && scene.isDay === false && scene.intensity >= 0.55 && scene.intensity <= 1, 'wxSceneOf wrong');
  const liveScene = api.wxSceneOf(payload);
  assert(['clear', 'partly', 'cloudy', 'overcast', 'fog', 'drizzle', 'rain', 'heavy-rain', 'snow', 'thunder', 'sleet'].indexOf(liveScene.kind) >= 0, 'live scene kind invalid');
  assert(liveScene.intensity >= 0 && liveScene.intensity <= 1 && typeof liveScene.isDay === 'boolean', 'live scene intensity/isDay invalid');
  assert(api.wxHourLabel('2026-11-07T02:00', 0, 'zh') === '现在', 'hour label index 0 wrong');
  assert(api.wxHourLabel('2026-11-07T02:00', 3, 'zh') === '02', 'hour label wrong');
  assert(api.wxDayLabel('2026-11-07', 0, 'zh') === '今天', 'day label today wrong');
  assert(api.wxDayLabel('2026-11-08', 1, 'zh') === '明天', 'day label tomorrow wrong');
  assert(/^周[一二三四五六日]$/.test(api.wxDayLabel('2026-11-09', 2, 'zh')), 'weekday label wrong');
  assert(api.wxClockText('2026-11-07T23:15') === '23:15', 'wxClockText(iso) wrong');
  assert(api.wxClockText(payload) === payload.now.time.slice(11, 16), 'wxClockText(payload) wrong');
  assert(/^\d{2}:\d{2}$/.test(api.wxClockText(undefined, Date.now())), 'wxClockText fallback wrong');
  assert(api.wxResolveLang('zh-CN') === 'zh' && api.wxResolveLang('en-US') === 'en' && api.wxResolveLang(undefined) === 'en', 'wxResolveLang wrong');
  const dicts = api.wxLocaleDicts();
  const keys = ['app.title', 'now', 'today', 'tomorrow', 'feels', 'precip', 'wind', 'live', 'loading', 'offline', 'retry', 'updated', 'stale', 'unit.kmh', 'unit.percent', 'drag', 'refresh',
    'city.search', 'city.auto', 'city.loading', 'city.empty', 'city.error', 'city.cancel', 'city.pinned'];
  keys.forEach(function (key) {
    assert(typeof dicts.zh[key] === 'string' && typeof dicts.en[key] === 'string', 'dict key missing: ' + key);
  });
  assert(Object.keys(dicts.zh).length === keys.length && Object.keys(dicts.en).length === keys.length, 'dict has extra keys');
  const zhKeys = Object.keys(dicts.zh).sort();
  const enKeys = Object.keys(dicts.en).sort();
  assert(zhKeys.length === enKeys.length && zhKeys.every(function (key, i) { return key === enKeys[i]; }), 'zh/en dict key sets differ');
  const cityDict = {
    'city.search': ['输入城市名', 'Search a city'],
    'city.auto': ['使用自动定位', 'Use automatic location'],
    'city.loading': ['搜索中…', 'Searching…'],
    'city.empty': ['没有找到匹配的城市', 'No matching city'],
    'city.error': ['搜索失败，请重试', 'Search failed, try again'],
    'city.cancel': ['取消', 'Cancel'],
    'city.pinned': ['已固定', 'Pinned'],
  };
  Object.keys(cityDict).forEach(function (key) {
    assert(dicts.zh[key] === cityDict[key][0], 'zh city dict wrong: ' + key);
    assert(dicts.en[key] === cityDict[key][1], 'en city dict wrong: ' + key);
  });
  assert(api.wxReadCache() === null, 'wxReadCache should be null without localStorage');
  assert(api.wxWriteCache(payload || {}) === false, 'wxWriteCache should no-op without localStorage');
  assert(api.wxReadPlace() === null, 'wxReadPlace should be null without localStorage');
  assert(api.wxWritePlace({ name: '镇江', latitude: 32.21, longitude: 119.46, timezone: 'Asia/Shanghai' }) === false, 'wxWritePlace should no-op without localStorage');
  assert(api.wxClearPlace() === undefined, 'wxClearPlace should return undefined without localStorage');
});

// --- client: icons, search transport, pinned-place wiring ------------------
check('client wxIconFor splits clear/partly into day/night icons', function () {
  assert(clientApi, 'client api missing');
  assert(clientApi.wxIconFor(0, true) === 'clear', 'day clear wrong');
  assert(clientApi.wxIconFor(0, false) === 'clear-night', 'night clear wrong');
  assert(clientApi.wxIconFor(1, false) === 'clear-night', 'night mostly-clear wrong');
  assert(clientApi.wxIconFor(2, true) === 'partly', 'day partly wrong');
  assert(clientApi.wxIconFor(2, false) === 'partly-night', 'night partly wrong');
  const nightCodes = { rain: 61, 'heavy-rain': 65, drizzle: 51, snow: 71, sleet: 56, thunder: 95, fog: 45, cloudy: 12345, overcast: 3 };
  Object.keys(nightCodes).forEach(function (kind) {
    assert(clientApi.wxIconFor(nightCodes[kind], false) === kind, kind + ' changed at night');
  });
  assert(clientApi.wxIconFor(61) === 'rain', 'undefined isDay should keep the day icon');
});

await checkAsync('client wxSearchPlaces normalizes results and never throws', async function () {
  assert(clientApi, 'client api missing');
  const realFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = function () { return Promise.reject(new Error('simulated offline')); };
    const offline = await clientApi.wxSearchPlaces('镇江', { lang: 'zh' });
    assert(offline && offline.ok === false, 'offline search should be ok:false');
    assert(offline.error && typeof offline.error.code === 'string' && typeof offline.error.message === 'string', 'offline search error shape wrong');
    assert(Array.isArray(offline.results) && offline.results.length === 0, 'offline search results should be empty');

    globalThis.fetch = function (url, init) {
      calls.push({ url: String(url), init: init || {} });
      const body = {
        ok: true,
        results: [
          { name: '镇江', admin1: 'Jiangsu', country: 'China', latitude: 32.2094, longitude: 119.4551, timezone: 'Asia/Shanghai' },
          { name: 'bad', latitude: 'nope', longitude: 1 },
          null,
        ],
      };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    };
    const found = await clientApi.wxSearchPlaces('  镇江  ', { lang: 'zh' });
    assert(found && found.ok === true, 'search should be ok');
    assert(found.results.length === 1, 'invalid results not dropped: ' + found.results.length);
    const first = found.results[0];
    assert(first.name === '镇江' && first.admin1 === 'Jiangsu' && first.timezone === 'Asia/Shanghai', 'normalized result wrong');
    assert(typeof first.latitude === 'number' && typeof first.longitude === 'number', 'normalized coords not numbers');
    assert(calls.length === 1, 'expected one search fetch');
    assert(calls[0].url.indexOf('/dsh-weather/search?q=' + encodeURIComponent('镇江') + '&lang=zh') === 0, 'search url wrong: ' + calls[0].url);
    assert(calls[0].init.cache === 'no-store', 'search fetch cache option wrong');
    const empty = await clientApi.wxSearchPlaces('   ', { lang: 'zh' });
    assert(empty.ok === true && empty.results.length === 0, 'blank query should be ok,[]');
    assert(calls.length === 1, 'blank query should not hit the network');
  } finally {
    globalThis.fetch = realFetch;
  }
});

await checkAsync('client pinned place is sent as encoded lat/lon/name/tz', async function () {
  assert(clientApi, 'client api missing');
  const realFetch = globalThis.fetch;
  const hadLocalStorage = typeof globalThis.localStorage !== 'undefined';
  const originalLocalStorage = hadLocalStorage ? globalThis.localStorage : null;
  let mocked = false;
  const store = new Map();
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: function (key) { return store.has(String(key)) ? store.get(String(key)) : null; },
        setItem: function (key, value) { store.set(String(key), String(value)); },
        removeItem: function (key) { store.delete(String(key)); },
      },
    });
    mocked = true;
  } catch (err) {
    warnings.push('localStorage mock unavailable: ' + (err && err.message));
  }
  try {
    if (!mocked) return;
    assert(clientApi.wxWritePlace({ name: '镇江', latitude: 32.21, longitude: 119.46, timezone: 'Asia/Shanghai' }) === true, 'wxWritePlace should persist');
    const round = clientApi.wxReadPlace();
    assert(round && round.name === '镇江' && round.latitude === 32.21 && round.longitude === 119.46 && round.timezone === 'Asia/Shanghai', 'wxReadPlace round-trip wrong');
    assert(clientApi.wxWritePlace({ name: 'bad', latitude: 'nope', longitude: 0 }) === false, 'wxWritePlace must reject bad coordinates');
    const samplePayload = payload || {
      ok: true,
      place: { name: '镇江', latitude: 32.21, longitude: 119.46, timezone: 'Asia/Shanghai' },
      now: { time: '2026-11-08T00:00', temp: 10, feels: 10, code: 0, precip: 0, pop: 0, wind: 0, isDay: false },
      hourly: [{ time: '2026-11-08T00:00', temp: 10, code: 0, pop: 0, isDay: false }],
      daily: [{ date: '2026-11-08', code: 0, min: 1, max: 2 }],
      fetchedAt: Date.now(),
      stale: false,
    };
    let captured = null;
    globalThis.fetch = function (url, init) {
      captured = { url: String(url), init: init || {} };
      return Promise.resolve(new Response(JSON.stringify(samplePayload), { status: 200, headers: { 'content-type': 'application/json' } }));
    };
    const result = await clientApi.wxFetchWeather({ force: true });
    assert(result.status === 'ok' && result.data && result.data.ok === true, 'wxFetchWeather not ok');
    assert(captured, 'no fetch call');
    const expected = '/dsh-weather/api?lat=32.21&lon=119.46&name=' + encodeURIComponent('镇江')
      + '&tz=' + encodeURIComponent('Asia/Shanghai') + '&force=1';
    assert(captured.url === expected, 'weather url wrong: ' + captured.url);
    clientApi.wxClearPlace();
    assert(clientApi.wxReadPlace() === null, 'wxClearPlace did not clear');
    captured = null;
    await clientApi.wxFetchWeather();
    assert(captured && captured.url === '/dsh-weather/api', 'automatic weather url wrong: ' + (captured && captured.url));
  } finally {
    globalThis.fetch = realFetch;
    if (mocked) {
      if (hadLocalStorage) {
        try { globalThis.localStorage = originalLocalStorage; } catch (err) { /* ignore */ }
      } else {
        try { delete globalThis.localStorage; } catch (err) { /* ignore */ }
      }
    }
  }
});

// --- summary --------------------------------------------------------------
console.log('');
if (warnings.length > 0) {
  console.log('WARN ' + warnings.join(' | '));
}
if (failures.length > 0) {
  console.log('FAILURES:');
  failures.forEach(function (line) { console.log('  - ' + line); });
  console.log('\nALL FAIL (' + passed + ' passed, ' + failures.length + ' failed)');
  process.exit(1);
}
console.log('ALL PASS (' + passed + ' checks)');
process.exit(0);