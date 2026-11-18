/* matrix-selftest.mjs — headless smoke test for parts/10-matrix.js.
 * The engine is now a tile-mosaic renderer: it fills the canvas with tiles of
 * a lattice pitch and draws every weather mark as one small square tile using
 * integer fillRect calls. This test stubs a 2D context that records fillRect +
 * fillStyle, rebuilds the per-cell tile map and prints ALPHABET ASCII maps.
 * Run with:
 *   & "<node>" weather-matrix-widget/test/matrix-selftest.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const partPath = path.join(__dirname, '..', 'parts', '10-matrix.js');

const W = 236;
const H = 248;
const DPR = 2;
const COLS = Math.min(34, Math.max(18, Math.round(W / 9.3)));
const ROWS = Math.min(36, Math.max(18, Math.round(H / 9.3)));
const BW = W * DPR;
const BH = H * DPR;
const PITCH_X = BW / COLS;
const PITCH_Y = BH / ROWS;
const TILE = Math.round(Math.min(PITCH_X, PITCH_Y) * 0.8);

/* mini-lattice mode (minimized pill): 54x42 CSS, 9x7 tiles */
const MINI_W = 54;
const MINI_H = 42;
const MINI_COLS = 9;
const MINI_ROWS = 7;
const MINI_BW = MINI_W * DPR;
const MINI_BH = MINI_H * DPR;
const MINI_PITCH_X = MINI_BW / MINI_COLS;
const MINI_PITCH_Y = MINI_BH / MINI_ROWS;
const MINI_TILE = Math.max(4, Math.round(Math.min(MINI_PITCH_X, MINI_PITCH_Y) * 0.8));
const MINI_GROUND_ROW = Math.round(MINI_ROWS * 0.74);

const failures = [];
let checks = 0;

function assert(cond, message) {
  checks += 1;
  if (!cond) {
    failures.push(message);
    console.error('FAIL ' + message);
  }
}

function loadFactory() {
  try {
    const req = createRequire(import.meta.url);
    const mod = req(partPath);
    if (mod && typeof mod.createMatrixScene === 'function') return mod.createMatrixScene;
  } catch (e) {
    // fall through to raw evaluation
  }
  const code = readFileSync(partPath, 'utf8');
  const factory = new Function('module', 'exports', code);
  const fakeModule = { exports: {} };
  factory(fakeModule, fakeModule.exports);
  return fakeModule.exports.createMatrixScene;
}

/* ------------------------------ mock canvas ------------------------------ */

function makeMock2d() {
  const fills = [];
  const calls = { count: 0, ops: Object.create(null) };
  const ctx = {
    fillStyle: '',
    imageSmoothingEnabled: true,
    canvas: null,
    fillRect(x, y, w, h) {
      calls.count += 1;
      calls.ops.fillRect = (calls.ops.fillRect || 0) + 1;
      fills.push({ x, y, w, h, style: this.fillStyle });
    },
    clearRect() { calls.count += 1; }
  };
  return {
    ctx,
    fills,
    calls,
    reset() { fills.length = 0; }
  };
}

function makeWindow(matchesReduced) {
  let frameCb = null;
  let rafId = 0;
  return {
    devicePixelRatio: DPR,
    requestAnimationFrame(cb) { frameCb = cb; rafId += 1; return rafId; },
    cancelAnimationFrame() { frameCb = null; },
    matchMedia() {
      return {
        media: '(prefers-reduced-motion: reduce)',
        matches: !!matchesReduced,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {}
      };
    },
    addEventListener() {},
    removeEventListener() {},
    takeFrame() {
      const cb = frameCb;
      frameCb = null;
      return cb;
    },
    hasFrame() { return frameCb !== null; }
  };
}

function makeCanvas(mock, w, h) {
  const canvas = { clientWidth: w, clientHeight: h, width: 0, height: 0, style: {} };
  canvas.getContext = () => mock.ctx;
  return canvas;
}

/* --------------------------- frame driving helpers ----------------------- */

let clockMs = 0;

function driveFrame(mock) {
  const active = globalThis.window;
  const cb = active && typeof active.takeFrame === 'function' ? active.takeFrame() : null;
  if (!cb) return false;
  clockMs += 16.7;
  mock.reset();
  cb(clockMs);
  return true;
}

function driveFrames(n, mock) {
  let drove = 0;
  for (let i = 0; i < n; i++) {
    if (!driveFrame(mock)) break;
    drove += 1;
  }
  return drove;
}

/* Fresh scene (drift 0) -> exact lattice mapping, for deterministic shape checks. */
function freshSceneScan(kind, isDay) {
  const prevWin = globalThis.window;
  const tmpWin = makeWindow(false);
  globalThis.window = tmpWin;
  const tmpMock = makeMock2d();
  const tmpScene = createMatrixScene(makeCanvas(tmpMock, W, H));
  tmpScene.setScene({ kind, isDay: isDay !== false, intensity: 0.6, wind: 10 });
  tmpScene.start();
  driveFrames(2, tmpMock);
  const info = scanFrame(tmpMock, kind);
  tmpScene.stop();
  tmpScene.dispose();
  globalThis.window = prevWin;
  return info;
}

/* ---------------------------- tile classification ----------------------- */

const EMPTY_STYLES = new Set();
const SUN_SET = new Set(['#ffd37a', '#ffb266']);
const RAIN_SET = new Set(['#00aeec', '#4fd2ff']);
const WHITE_SET = new Set(['#eaf3ff']);
const MOON_SET = new Set(['#f2f0e2', '#ceccbd']);
const STAR_SET = new Set(['#cfdcff', '#94a0c4']);
const CLOUD_NORMAL = new Set(['#a6a6ab', '#8d8d92', '#b9bec8']);
const CLOUD_STORM = new Set(['#8b8b90', '#757579', '#9499a3']);
const CLOUD_OVERCAST = new Set(['#9a9fa9', '#adb2bc', '#7e828b', '#8b909a', '#9aa0aa', '#71757e']);
const FOG_SET = new Set(['#4a4a52']);
const HORIZON_SET = new Set(['#3f3f46', '#2f2f36']);
const BOLT_AMBER = '#ffd37a';
const BOLT_WHITE = '#fff6df';

function parseHex(style) {
  if (typeof style !== 'string') return null;
  const m = /^#([0-9a-f]{6})$/i.exec(style);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

function isEmptyStyle(style) {
  if (EMPTY_STYLES.has(style)) return true;
  const c = parseHex(style);
  if (!c) return false;
  return c.g === c.r && c.b === c.r + 4 && c.r >= 22 && c.r <= 28;
}

/* ALPHABET: space=empty tile, '#' cloud, '~' rain, '*' snow, 'o' sun/moon,
 * '!' bolt, ':' fog, '_' horizon; '.' marks single star tiles. */
function classify(style, kind) {
  const c = parseHex(style);
  if (!c) return '?';
  if (style === '#0b0b10') return 'B';
  if (isEmptyStyle(style)) return ' ';
  if (style === BOLT_WHITE) return '!';
  if (style === BOLT_AMBER) return kind === 'thunder' ? '!' : 'o';
  if (SUN_SET.has(style)) return kind === 'thunder' ? '!' : 'o';
  if (RAIN_SET.has(style)) return '~';
  if (WHITE_SET.has(style)) return '*';
  if (MOON_SET.has(style)) return 'o';
  if (STAR_SET.has(style)) return '.';
  if (CLOUD_NORMAL.has(style) || CLOUD_STORM.has(style) || CLOUD_OVERCAST.has(style)) return '#';
  if (FOG_SET.has(style)) return ':';
  if (HORIZON_SET.has(style)) return '_';
  return '?';
}

function scanFrame(mock, kind) {
  const cells = new Map();
  const info = {
    cells: Object.create(null),
    counts: Object.create(null),
    minRow: Object.create(null),
    maxRow: Object.create(null),
    minCol: Object.create(null),
    maxCol: Object.create(null),
    rainCols: new Set(),
    styleCounts: Object.create(null),
    tileRects: 0,
    bgRects: 0,
    badRects: 0,
    emptyRects: 0,
    unknown: 0,
    backgroundLeft: 0
  };
  for (const f of mock.fills) {
    if (f.w === TILE && f.h === TILE) {
      info.tileRects += 1;
      const c = Math.round(((f.x + f.w / 2) / PITCH_X) - 0.5);
      const r = Math.round(((f.y + f.h / 2) / PITCH_Y) - 0.5);
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) {
        info.badRects += 1;
        continue;
      }
      if (isEmptyStyle(f.style)) info.emptyRects += 1;
      cells.set(r * COLS + c, f.style);
    } else if (f.w === BW && f.h === BH) {
      info.bgRects += 1;
    } else {
      info.badRects += 1;
    }
  }
  info.cells = cells;
  info.coverage = cells.size;
  for (const [key, style] of cells) {
    const r = Math.floor(key / COLS);
    const c = key % COLS;
    const ch = classify(style, kind);
    if (ch === '?') info.unknown += 1;
    if (ch === 'B') info.backgroundLeft += 1;
    if (ch === ' ') continue;
    info.styleCounts[style] = (info.styleCounts[style] || 0) + 1;
    info.counts[ch] = (info.counts[ch] || 0) + 1;
    if (info.minRow[ch] === undefined || r < info.minRow[ch]) info.minRow[ch] = r;
    if (info.maxRow[ch] === undefined || r > info.maxRow[ch]) info.maxRow[ch] = r;
    if (info.minCol[ch] === undefined || c < info.minCol[ch]) info.minCol[ch] = c;
    if (info.maxCol[ch] === undefined || c > info.maxCol[ch]) info.maxCol[ch] = c;
    if (ch === '~') info.rainCols.add(c);
  }
  return info;
}

function c(info, ch) { return info.counts[ch] || 0; }

/* scan one frame of the mini lattice (9x7) */
function miniScan(mock, kind) {
  const cells = new Map();
  let tileRects = 0;
  let badTiles = 0;
  for (const f of mock.fills) {
    if (f.w !== MINI_TILE || f.h !== MINI_TILE) continue;
    tileRects += 1;
    const c0 = Math.round(((f.x + f.w / 2) / MINI_PITCH_X) - 0.5);
    const r0 = Math.round(((f.y + f.h / 2) / MINI_PITCH_Y) - 0.5);
    if (r0 < 0 || r0 >= MINI_ROWS) { badTiles += 1; continue; }
    const col = ((c0 % MINI_COLS) + MINI_COLS) % MINI_COLS;
    cells.set(r0 * MINI_COLS + col, f.style);
  }
  const info = { cells, counts: Object.create(null), tileRects, badTiles };
  for (const [key, style] of cells) {
    const ch = classify(style, kind);
    if (ch === ' ' || ch === '?') continue;
    info.counts[ch] = (info.counts[ch] || 0) + 1;
  }
  return info;
}

function buildAscii(info) {
  const lines = [];
  for (let r = 0; r < ROWS; r++) {
    let line = '';
    for (let c2 = 0; c2 < COLS; c2++) {
      const style = info.cells.get(r * COLS + c2);
      const ch = classify(style, info.kind);
      line += (ch === '?' || ch === 'B') ? '?' : ch;
    }
    lines.push(line);
  }
  return lines;
}

function printAscii(label, info) {
  console.log('\n--- ' + label + ' (one char per tile, ' + COLS + 'x' + ROWS + ') ---');
  for (const line of buildAscii(info)) console.log(line);
}

function cloudCellSet(info) {
  const set = new Set();
  for (const [key] of info.cells) {
    const style = info.cells.get(key);
    if (CLOUD_NORMAL.has(style) || CLOUD_STORM.has(style)) set.add(key);
  }
  return set;
}

/* Cloud shape invariance: split the cloud tiles into left/right clusters and
 * return each cluster's translation-independent pattern (offsets + tone). */
function cloudShapePatterns(mock) {
  const tiles = [];
  for (const f of mock.fills) {
    if (f.w !== TILE || f.h !== TILE) continue;
    if (!CLOUD_NORMAL.has(f.style) && !CLOUD_STORM.has(f.style)) continue;
    tiles.push(f);
  }
  if (!tiles.length) return [];
  tiles.sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const clusters = [];
  let cur = [];
  let prevX = null;
  for (const t of tiles) {
    if (prevX !== null && t.x - prevX > PITCH_X * 1.6 && cur.length) {
      clusters.push(cur);
      cur = [];
    }
    cur.push(t);
    prevX = t.x;
  }
  if (cur.length) clusters.push(cur);
  const out = [];
  for (const cl of clusters) {
    let minX = Infinity;
    let minY = Infinity;
    for (const t of cl) {
      if (t.x < minX) minX = t.x;
      if (t.y < minY) minY = t.y;
    }
    const parts = cl.map((t) => (t.x - minX) + ':' + (t.y - minY) + ':' + t.style).sort();
    out.push(parts.join('|'));
  }
  out.sort();
  return out;
}

/* Ground surface row per column (from the horizon/hill tiles). */
function groundTopByColumn(mock) {
  const top = new Array(COLS).fill(ROWS);
  for (const f of mock.fills) {
    if (f.w !== TILE || f.h !== TILE) continue;
    if (!HORIZON_SET.has(f.style)) continue;
    const col = Math.round(((f.x + f.w / 2) / PITCH_X) - 0.5);
    const row = Math.round(((f.y + f.h / 2) / PITCH_Y) - 0.5);
    if (col < 0 || col >= COLS) continue;
    if (row < top[col]) top[col] = row;
  }
  return top;
}

function groundViolations(mock, kind) {
  const top = groundTopByColumn(mock);
  let below = 0;
  let above = 0;
  let belowBolt = 0;
  let aboveBolt = 0;
  for (const f of mock.fills) {
    if (f.w !== TILE || f.h !== TILE) continue;
    const ch = classify(f.style, kind);
    if (ch !== '~' && ch !== '*' && ch !== '!') continue;
    const col = Math.round(((f.x + f.w / 2) / PITCH_X) - 0.5);
    const row = Math.round(((f.y + f.h / 2) / PITCH_Y) - 0.5);
    if (col < 0 || col >= COLS || row < 0) continue;
    if (row >= top[col]) {
      below += 1;
      if (ch === '!') belowBolt += 1;
    } else {
      above += 1;
      if (ch === '!') aboveBolt += 1;
    }
  }
  return { below, above, belowBolt, aboveBolt, top };
}

/* Cloud coverage per lattice column, taken from the current frame. */
function cloudColumnInfo(mock) {
  const has = new Array(COLS).fill(false);
  const maxRow = new Array(COLS).fill(-1);
  for (const f of mock.fills) {
    if (f.w !== TILE || f.h !== TILE) continue;
    if (!CLOUD_NORMAL.has(f.style) && !CLOUD_STORM.has(f.style)) continue;
    const col = Math.round(((f.x + f.w / 2) / PITCH_X) - 0.5);
    const row = Math.round(((f.y + f.h / 2) / PITCH_Y) - 0.5);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) continue;
    has[col] = true;
    if (row > maxRow[col]) maxRow[col] = row;
  }
  return { has, maxRow };
}

/* Precipitation tiles per column: {col -> min row} and total count. */
function precipByColumn(mock, kind, onlyRain) {
  const minRow = new Map();
  let total = 0;
  for (const f of mock.fills) {
    if (f.w !== TILE || f.h !== TILE) continue;
    const ch = classify(f.style, kind);
    if (ch !== '~' && ch !== '*') continue;
    if (onlyRain && ch !== '~') continue;
    const col = Math.round(((f.x + f.w / 2) / PITCH_X) - 0.5);
    const row = Math.round(((f.y + f.h / 2) / PITCH_Y) - 0.5);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) continue;
    total += 1;
    if (!minRow.has(col) || row < minRow.get(col)) minRow.set(col, row);
  }
  return { minRow, total };
}

/* --------------------------------- setup --------------------------------- */

const createMatrixScene = loadFactory();
assert(typeof createMatrixScene === 'function', 'part exports createMatrixScene');

const win = makeWindow(false);
globalThis.window = win;

const mock = makeMock2d();
const canvas = makeCanvas(mock, W, H);
const scene = createMatrixScene(canvas);
assert(scene && typeof scene.setScene === 'function', 'API exposes setScene');
assert(typeof scene.start === 'function', 'API exposes start');
assert(typeof scene.stop === 'function', 'API exposes stop');
assert(typeof scene.dispose === 'function', 'API exposes dispose');
assert(typeof scene.setReducedMotion === 'function', 'API exposes setReducedMotion');

scene.setScene({ kind: 'clear', isDay: true, intensity: 0.4, wind: 10 });
scene.setScene({ kind: 'rain', intensity: 0.5, wind: 12 });

clockMs = 0;
scene.start();
assert(driveFrames(1, mock) === 1, 'rAF loop schedules frames after start');
assert(canvas.width === BW, 'canvas backing width = css * dpr (' + BW + '), got ' + canvas.width);
assert(canvas.height === BH, 'canvas backing height = css * dpr (' + BH + '), got ' + canvas.height);
assert(canvas.style.imageRendering === 'pixelated', 'canvas.style.imageRendering = pixelated');
const MIN_PITCH = Math.min(PITCH_X, PITCH_Y);
assert(TILE === Math.round(MIN_PITCH * 0.8), 'tile size = 80% of the lattice pitch, tile=' + TILE);
assert(TILE <= MIN_PITCH - 2, 'lattice keeps a visible gap between tiles, gap=' + (MIN_PITCH - TILE).toFixed(1));

const first = scanFrame(mock, 'rain');
assert(first.bgRects === 1, 'region background painted once per frame, got ' + first.bgRects);
assert(first.badRects === 0, 'only full-canvas bg + lattice tiles are painted, bad=' + first.badRects);
assert(first.tileRects >= COLS * ROWS, 'every lattice cell gets a tile, rects=' + first.tileRects);
assert(first.coverage === COLS * ROWS,
  'every lattice cell painted with an empty or weather tile (' + COLS * ROWS + '), got ' + first.coverage);
assert(first.unknown === 0, 'all tile colours are known palette entries, unknown=' + first.unknown);
assert(first.backgroundLeft === 0, 'no bare region background left inside the lattice');
assert(first.emptyRects === COLS * ROWS, 'exactly one empty tile per cell, got ' + first.emptyRects);

let nonInteger = 0;
for (const f of mock.fills) {
  if (!Number.isInteger(f.x) || !Number.isInteger(f.y) ||
      !Number.isInteger(f.w) || !Number.isInteger(f.h)) nonInteger += 1;
}
assert(nonInteger === 0, 'all fillRect coordinates are integers (no antialiasing), bad=' + nonInteger);

/* ------------------------- every scene kind paints ----------------------- */

const cases = [
  { kind: 'clear', isDay: true },
  { kind: 'clear', isDay: false },
  { kind: 'partly', isDay: true },
  { kind: 'partly', isDay: false },
  { kind: 'cloudy', isDay: true },
  { kind: 'overcast', isDay: true },
  { kind: 'fog', isDay: true },
  { kind: 'drizzle', isDay: true, intensity: 0.3, wind: 5 },
  { kind: 'rain', isDay: true, intensity: 0.6, wind: 18 },
  { kind: 'heavy-rain', isDay: true, intensity: 0.9, wind: 35 },
  { kind: 'snow', isDay: true, intensity: 0.7, wind: -6 },
  { kind: 'thunder', isDay: true, intensity: 0.8, wind: 22 },
  { kind: 'sleet', isDay: true, intensity: 0.5, wind: 14 }
];

for (const cse of cases) {
  const label = cse.kind + (cse.kind === 'clear' || cse.kind === 'partly' ? (cse.isDay ? '-day' : '-night') : '');
  scene.setScene({
    kind: cse.kind,
    isDay: cse.isDay,
    intensity: cse.intensity === undefined ? 0.6 : cse.intensity,
    wind: cse.wind === undefined ? 10 : cse.wind
  });
  const drove = driveFrames(8, mock);
  const info = scanFrame(mock, cse.kind);
  info.kind = cse.kind;
  assert(drove === 8, label + ': 8 frames driven, got ' + drove);
  assert(info.coverage === COLS * ROWS, label + ': full lattice coverage, got ' + info.coverage);
  assert(info.unknown === 0, label + ': no unknown tile colours');
  assert(info.emptyRects === COLS * ROWS, label + ': empty lattice pass is complete');
  assert(c(info, '_') > 0, label + ': horizon tiles are part of every landscape, _=' + c(info, '_'));
  console.log('PASS ' + label + ': ' + COLS + 'x' + ROWS + ' tiles, empty=' + info.emptyRects);
}

/* --------------------- composition assertions per kind ------------------- */

const shots = [
  ['partly', 'partly', true, 0.6, 10],
  ['cloudy', 'cloudy', true, 0.6, 10],
  ['overcast', 'overcast', true, 0.6, 10],
  ['fog', 'fog', true, 0.6, 10],
  ['drizzle', 'drizzle', true, 0.3, 5],
  ['rain', 'rain', true, 0.6, 18],
  ['heavy-rain', 'heavy-rain', true, 0.9, 35],
  ['snow', 'snow', true, 0.7, -6],
  ['sleet', 'sleet', true, 0.5, 14],
  ['thunder', 'thunder', true, 0.8, 22],
  ['clear-day', 'clear', true, 0.6, 10],
  ['clear-night', 'clear', false, 0.6, 10]
];

const results = Object.create(null);
let boltSeen = false;
let boltInfo = null;
let thunderFrames = 0;
let boltBelowGround = 0;

for (const [label, kind, isDay, intensity, wind] of shots) {
  scene.setScene({ kind, isDay, intensity, wind });
  driveFrames(6, mock);
  let info;
  if (kind === 'thunder') {
    for (let i = 0; i < 3000 && !boltSeen; i++) {
      driveFrame(mock);
      thunderFrames += 1;
      const trial = scanFrame(mock, 'thunder');
      if (c(trial, '!') >= 4) {
        boltSeen = true;
        boltInfo = trial;
        boltBelowGround += groundViolations(mock, 'thunder').belowBolt;
      }
    }
    info = boltSeen ? boltInfo : scanFrame(mock, 'thunder');
    info.kind = 'thunder';
  } else {
    info = scanFrame(mock, kind);
    info.kind = kind;
  }
  results[label] = info;
}

const cloudMaxRow = Math.round(ROWS * 0.62);
const rainStartRow = Math.round(ROWS * 0.30);

const cloudy = results.cloudy;
assert(c(cloudy, '#') > 20, 'cloudy: gray cloud tiles, #=' + c(cloudy, '#'));
assert(c(cloudy, '#') < COLS * ROWS * 0.7, 'cloudy: cloud does not cover the whole lattice');
assert(cloudy.maxRow['#'] < cloudMaxRow, 'cloudy: cloud tiles stay in the upper area, maxRow=' + cloudy.maxRow['#']);
assert(cloudy.minRow['#'] <= Math.round(ROWS * 0.30), 'cloudy: cloud reaches high, minRow=' + cloudy.minRow['#']);
assert((cloudy.styleCounts['#a6a6ab'] || 0) > 10, 'cloudy: flat light-gray interior tiles, got ' + (cloudy.styleCounts['#a6a6ab'] || 0));
assert((cloudy.styleCounts['#8d8d92'] || 0) > 0, 'cloudy: dithered mid-tone silhouette edge');
assert((cloudy.styleCounts['#b9bec8'] || 0) > 0, 'cloudy: lighter hump-top row tiles');
assert(!cloudy.styleCounts['#6d6d72'], 'cloudy: no noisy dim shade inside the cloud');

const overcast = freshSceneScan('overcast');
assert(c(overcast, '#') > 100, 'overcast: heavy cloud deck, #=' + c(overcast, '#'));
assert(overcast.maxRow['#'] < Math.round(ROWS * 0.70), 'overcast: bank ends above the lower third');
/* overcast must be a clean, shaped, layered deck - never a rectangular wall */
const overcastCells = new Set();
for (const [key, style] of overcast.cells) {
  if (CLOUD_OVERCAST.has(style)) overcastCells.add(key);
}
const overcastRowCount = new Array(ROWS).fill(0);
const overcastTopCol = new Array(COLS).fill(-1);
let overcastMinC = COLS;
let overcastMaxC = -1;
let overcastMinR = ROWS;
let overcastMaxR = -1;
for (const key of overcastCells) {
  const r = Math.floor(key / COLS);
  const col = key % COLS;
  overcastRowCount[r] += 1;
  if (overcastTopCol[col] < 0 || r < overcastTopCol[col]) overcastTopCol[col] = r;
  if (col < overcastMinC) overcastMinC = col;
  if (col > overcastMaxC) overcastMaxC = col;
  if (r < overcastMinR) overcastMinR = r;
  if (r > overcastMaxR) overcastMaxR = r;
}
let overcastFullRows = 0;
for (let r = 0; r < ROWS; r++) {
  if (overcastRowCount[r] >= COLS) overcastFullRows += 1;
}
assert(overcastFullRows === 0, 'overcast: no lattice row is fully covered by cloud, fullRows=' + overcastFullRows);
assert(overcastRowCount[0] < COLS * 0.8, 'overcast: humped top edge, row0 cloud tiles=' + overcastRowCount[0] + '/' + COLS);
const overcastTops = new Set(overcastTopCol.filter((v) => v >= 0));
assert(overcastTops.size >= 3, 'overcast: at least 3 layered hump groups, distinct cloud tops=' + overcastTops.size);
const overcastMaxRowCover = Math.max(...overcastRowCount) / COLS;
assert(overcastMaxRowCover >= 0.40 && overcastMaxRowCover <= 0.72, 'overcast: heavy deck bands 40-72% of width, maxRowCover=' + overcastMaxRowCover.toFixed(2));
const overcastBBoxW = overcastMaxC - overcastMinC + 1;
const overcastBBoxH = overcastMaxR - overcastMinR + 1;
assert(overcastBBoxW >= Math.round(COLS * 0.45) && overcastBBoxW <= Math.round(COLS * 0.80), 'overcast: deck spans 45-80% width, bbox=' + overcastBBoxW);
assert(overcastBBoxH >= Math.round(ROWS * 0.25) && overcastBBoxH <= Math.round(ROWS * 0.45), 'overcast: deck spans 25-45% height, bbox=' + overcastBBoxH);
/* no enclosed holes inside the deck silhouette */
let overcastHoles = 0;
for (let r = 1; r < ROWS - 1; r++) {
  for (let col = 1; col < COLS - 1; col++) {
    const key = r * COLS + col;
    if (overcastCells.has(key)) continue;
    if (overcastCells.has(key - 1) && overcastCells.has(key + 1) &&
      overcastCells.has(key - COLS) && overcastCells.has(key + COLS)) overcastHoles += 1;
  }
}
assert(overcastHoles === 0, 'overcast: no enclosed empty cells inside the cloud deck, holes=' + overcastHoles);
/* and no detached single cloud tiles anywhere in the deck */
let overcastDetached = 0;
for (const key of overcastCells) {
  const r = Math.floor(key / COLS);
  const col = key % COLS;
  let n = 0;
  if (col > 0 && overcastCells.has(key - 1)) n += 1;
  if (col < COLS - 1 && overcastCells.has(key + 1)) n += 1;
  if (r > 0 && overcastCells.has(key - COLS)) n += 1;
  if (r < ROWS - 1 && overcastCells.has(key + COLS)) n += 1;
  if (n === 0) overcastDetached += 1;
}
assert(overcastDetached === 0, 'overcast: no detached cloud chunks, isolated=' + overcastDetached);

const partly = results.partly;
assert(c(partly, '#') > 10, 'partly: single cloud tiles, #=' + c(partly, '#'));
assert(c(partly, 'o') > 4, 'partly: sun/moon tiles visible, o=' + c(partly, 'o'));

const fog = results.fog;
assert(c(fog, ':') > 20, 'fog: dithered fog-band tiles, :=' + c(fog, ':'));
assert(c(fog, '#') === 0, 'fog: no cloud mass');

const drizzle = results.drizzle;
assert(c(drizzle, '~') > 0, 'drizzle: sparse cyan tiles, ~=' + c(drizzle, '~'));
assert(c(drizzle, '#') > 10, 'drizzle: cloud present, #=' + c(drizzle, '#'));

const rain = results.rain;
assert(c(rain, '~') > 4, 'rain: cyan rain tiles, ~=' + c(rain, '~'));
assert(c(rain, '#') > 10, 'rain: cloud present, #=' + c(rain, '#'));
assert(rain.minRow['~'] >= rainStartRow, 'rain: cyan tiles only below the cloud band, minRow=' + rain.minRow['~']);
assert(rain.maxRow['#'] < rain.minRow['~'], 'rain: cloud bottom is above the first rain tile');
assert(rain.maxRow['~'] <= ROWS - 1, 'rain: tiles stay inside the panel');
assert(rain.rainCols.size >= 5, 'rain: drops are spread across columns, cols=' + rain.rainCols.size);

const heavy = results['heavy-rain'];
assert(c(heavy, '~') > c(rain, '~'), 'heavy-rain: denser than rain, ~=' + c(heavy, '~') + ' vs ' + c(rain, '~'));

const snow = results.snow;
assert(c(snow, '*') >= 6, 'snow: white flake tiles, *=' + c(snow, '*'));
assert(snow.minRow['*'] >= rainStartRow, 'snow: flakes fall below the cloud, minRow=' + snow.minRow['*']);
assert(c(snow, '#') > 10, 'snow: cloud present, #=' + c(snow, '#'));

const sleet = results.sleet;
assert(c(sleet, '*') > 0, 'sleet: white flakes, *=' + c(sleet, '*'));
assert(c(sleet, '~') > 0, 'sleet: cyan streaks, ~=' + c(sleet, '~'));

const thunder = results.thunder;
assert(c(thunder, '#') > 10, 'thunder: dark cloud tiles, #=' + c(thunder, '#'));
assert(boltSeen && c(boltInfo, '!') >= 4, 'thunder: bolt tiles appear during a flash, frames=' + thunderFrames);
assert(boltSeen && boltInfo.maxRow['!'] <= Math.round(ROWS * 0.80), 'thunder: bolt reaches down toward the horizon');
assert(boltSeen && boltBelowGround === 0, 'thunder: bolt never crosses the ground surface, bad=' + boltBelowGround);
assert((thunder.styleCounts['#8b8b90'] || 0) + (thunder.styleCounts['#757579'] || 0) +
  (thunder.styleCounts['#9499a3'] || 0) > 0, 'thunder: uses the darker storm cloud palette');

const clearDay = results['clear-day'];
assert(c(clearDay, 'o') >= 6, 'clear-day: amber sun tiles, o=' + c(clearDay, 'o'));
assert(clearDay.minCol['o'] > COLS * 0.6, 'clear-day: sun in the top-right, minCol=' + clearDay.minCol['o']);
assert(clearDay.maxRow['o'] < ROWS * 0.40, 'clear-day: sun high in the sky, maxRow=' + clearDay.maxRow['o']);
assert(c(clearDay, '#') === 0, 'clear-day: no cloud mass');

const clearNight = results['clear-night'];
assert(c(clearNight, 'o') >= 4, 'clear-night: pale crescent moon tiles, o=' + c(clearNight, 'o'));
assert(clearNight.minCol['o'] > COLS * 0.6, 'clear-night: moon in the top-right');
assert(c(clearNight, '.') >= 3, 'clear-night: twinkling star tiles, .=' + c(clearNight, '.'));

/* clouds must flow: the cloud tile set changes over time */
scene.setScene({ kind: 'cloudy', isDay: true, intensity: 0.6, wind: 10 });
driveFrames(6, mock);
const flowA = cloudCellSet(scanFrame(mock, 'cloudy'));
driveFrames(400, mock);
const flowB = cloudCellSet(scanFrame(mock, 'cloudy'));
assert(flowA.size > 10 && flowB.size > 10, 'cloudy: cloud tiles present while flowing');
let flowChanged = flowA.size !== flowB.size;
if (!flowChanged) {
  for (const key of flowA) { if (!flowB.has(key)) { flowChanged = true; break; } }
}
assert(flowChanged, 'cloudy: cloud tiles drift across the lattice over time');

/* (a) the cloud SHAPE is fixed: only its translation changes */
const winCloud = makeWindow(false);
globalThis.window = winCloud;
const mockCloud = makeMock2d();
const cloudScene = createMatrixScene(makeCanvas(mockCloud, W, H));
cloudScene.setScene({ kind: 'cloudy', isDay: true, intensity: 0.6, wind: 10 });
cloudScene.start();
driveFrames(2, mockCloud);
const shapeFrames = [];
for (let i = 0; i < 10; i++) {
  driveFrame(mockCloud);
  shapeFrames.push(JSON.stringify(cloudShapePatterns(mockCloud)));
}
assert(shapeFrames[0] !== '[]', 'cloud shape: cloud tiles present while drifting');
for (let i = 1; i < shapeFrames.length; i++) {
  assert(shapeFrames[i] === shapeFrames[0], 'cloud shape invariant across drift, frame ' + i);
}
cloudScene.stop();
cloudScene.dispose();
globalThis.window = win;

/* (b)/(c) precipitation and the bolt die on the ground surface */
const groundKinds = ['rain', 'snow', 'sleet', 'heavy-rain', 'thunder'];
for (const gk of groundKinds) {
  scene.setScene({ kind: gk, isDay: true, intensity: 0.85, wind: 20 });
  driveFrames(6, mock);
  let below = 0;
  let above = 0;
  for (let i = 0; i < 12; i++) {
    driveFrame(mock);
    const gv = groundViolations(mock, gk);
    below += gv.below;
    above += gv.above;
  }
  assert(below === 0, gk + ': no precipitation tile at/below the ground surface, bad=' + below);
  assert(above > 0, gk + ': precipitation is visible above the ground, tiles=' + above);
}

/* (d)/(e) staggered precipitation: drops only spawn under the cloud, are sparse
 * in the row directly beneath the cloud (no cyan curtain), and die on the ground. */
const topRowLimit = { drizzle: 0.15, rain: 0.30, 'heavy-rain': 0.60, sleet: 0.30, thunder: 0.30 };
const densityTarget = { drizzle: [2, 7], rain: [8, 20], 'heavy-rain': [18, 36], sleet: [5, 22], thunder: [10, 28] };
const densitySeen = Object.create(null);
for (const sk of ['drizzle', 'rain', 'heavy-rain', 'sleet', 'thunder']) {
  scene.setScene({ kind: sk, isDay: true, intensity: 0.85, wind: 20 });
  driveFrames(8, mock);
  let outOfCloud = 0;
  let maxTopFrac = 0;
  let rainTiles = 0;
  const samples = 14;
  for (let i = 0; i < samples; i++) {
    driveFrame(mock);
    const cloud = cloudColumnInfo(mock);
    const rain = precipByColumn(mock, sk, true);
    rainTiles += rain.total;
    for (const [col, row] of rain.minRow) {
      if (!cloud.has[col] || row <= cloud.maxRow[col]) outOfCloud += 1;
    }
    const cloudCols = [];
    for (let c = 0; c < COLS; c++) {
      if (cloud.has[c]) cloudCols.push(c);
    }
    let topBusy = 0;
    for (const c of cloudCols) {
      const expected = cloud.maxRow[c] + 1;
      const row = rain.minRow.get(c);
      if (row !== undefined && row === expected) topBusy += 1;
    }
    const frac = cloudCols.length ? topBusy / cloudCols.length : 0;
    if (frac > maxTopFrac) maxTopFrac = frac;
  }
  assert(rainTiles > 0, sk + ': staggered rain drops exist');
  assert(outOfCloud === 0, sk + ': no rain tile inside/above the cloud bottom, bad=' + outOfCloud);
  assert(maxTopFrac <= topRowLimit[sk], sk + ': no cyan curtain under the cloud, top-row fraction=' + maxTopFrac.toFixed(2) + ' <= ' + topRowLimit[sk]);
  const avg = rainTiles / samples;
  densitySeen[sk] = avg;
  const dr = densityTarget[sk];
  assert(avg >= dr[0] && avg <= dr[1], sk + ': staggered rain density ' + avg.toFixed(1) + ' tiles/frame within [' + dr[0] + ',' + dr[1] + ']');
}
/* precipitation amount must clearly scale with severity */
assert(densitySeen.drizzle < densitySeen.rain, 'severity: drizzle lighter than rain (' + densitySeen.drizzle.toFixed(1) + ' < ' + densitySeen.rain.toFixed(1) + ')');
assert(densitySeen.rain < densitySeen['heavy-rain'], 'severity: rain lighter than heavy-rain (' + densitySeen.rain.toFixed(1) + ' < ' + densitySeen['heavy-rain'].toFixed(1) + ')');
assert(densitySeen.thunder >= 10 && densitySeen.thunder <= 28, 'severity: thunder rain band, ' + densitySeen.thunder.toFixed(1));
/* dry skies stay dry */
assert(c(results.cloudy, '~') === 0 && c(results.cloudy, '*') === 0, 'cloudy: no precipitation');
assert(c(results.overcast, '~') === 0 && c(results.overcast, '*') === 0, 'overcast: no precipitation');
assert(c(results['clear-day'], '~') === 0 && c(results['clear-night'], '~') === 0, 'clear: no precipitation');
/* no detached cloud chunks or enclosed holes on any cloudy outlook */
for (const label of ['cloudy', 'overcast', 'rain', 'heavy-rain', 'thunder']) {
  const info = freshSceneScan(label);
  const cells = new Set();
  for (const [key2, style2] of info.cells) {
    if (CLOUD_NORMAL.has(style2) || CLOUD_STORM.has(style2) || CLOUD_OVERCAST.has(style2)) cells.add(key2);
  }
  let isolated = 0;
  for (const key2 of cells) {
    const r2 = Math.floor(key2 / COLS);
    const c2 = key2 % COLS;
    let n2 = 0;
    if (c2 > 0 && cells.has(key2 - 1)) n2 += 1;
    if (c2 < COLS - 1 && cells.has(key2 + 1)) n2 += 1;
    if (r2 > 0 && cells.has(key2 - COLS)) n2 += 1;
    if (r2 < ROWS - 1 && cells.has(key2 + COLS)) n2 += 1;
    if (n2 === 0) isolated += 1;
  }
  let holes = 0;
  for (let r2 = 1; r2 < ROWS - 1; r2++) {
    for (let c2 = 1; c2 < COLS - 1; c2++) {
      const key2 = r2 * COLS + c2;
      if (cells.has(key2)) continue;
      if (cells.has(key2 - 1) && cells.has(key2 + 1) &&
        cells.has(key2 - COLS) && cells.has(key2 + COLS)) holes += 1;
    }
  }
  assert(isolated === 0, label + ': no detached cloud chunks, isolated=' + isolated);
  assert(holes === 0, label + ': no enclosed cloud holes, holes=' + holes);
}

/* snow flakes use the same staggered spawn rule */
scene.setScene({ kind: 'snow', isDay: true, intensity: 0.9, wind: 10 });
driveFrames(8, mock);
let snowBad = 0;
let snowTiles = 0;
let snowTopFrac = 0;
for (let i = 0; i < 12; i++) {
  driveFrame(mock);
  const cloud = cloudColumnInfo(mock);
  const snow = precipByColumn(mock, 'snow', false);
  snowTiles += snow.total;
  for (const [col, row] of snow.minRow) {
    if (!cloud.has[col] || row <= cloud.maxRow[col]) snowBad += 1;
  }
  let busy = 0;
  let colsWithCloud = 0;
  for (let c = 0; c < COLS; c++) {
    if (!cloud.has[c]) continue;
    colsWithCloud += 1;
    if (snow.minRow.has(c) && snow.minRow.get(c) === cloud.maxRow[c] + 1) busy += 1;
  }
  const frac = colsWithCloud ? busy / colsWithCloud : 0;
  if (frac > snowTopFrac) snowTopFrac = frac;
}
assert(snowTiles > 0 && snowBad === 0, 'snow: flakes stay under the cloud, bad=' + snowBad);
assert(snowTopFrac <= 0.30, 'snow: flakes are staggered, top-row fraction=' + snowTopFrac.toFixed(2));

/* ------------------------------ mini mode -------------------------------- */
const winMini = makeWindow(false);
globalThis.window = winMini;
const miniMock = makeMock2d();
const miniCanvas = makeCanvas(miniMock, MINI_W, MINI_H);
const miniScene = createMatrixScene(miniCanvas, { cols: MINI_COLS, rows: MINI_ROWS, mini: true });
assert(miniScene && typeof miniScene.setScene === 'function', 'mini: API created with options');
miniScene.setScene({ kind: 'clear', isDay: true, intensity: 0.8, wind: 10 });
miniScene.start();
assert(driveFrames(3, miniMock) === 3, 'mini: frames driven');
const miniClear = miniScan(miniMock, 'clear');
assert(miniClear.cells.size === MINI_COLS * MINI_ROWS, 'mini: 9x7 lattice honoured, cells=' + miniClear.cells.size);
assert(miniClear.tileRects >= MINI_COLS * MINI_ROWS, 'mini: full empty-grid pass, tiles=' + miniClear.tileRects);
let miniTileOk = true;
for (const f of miniMock.fills) {
  if (f.w === f.h && f.w < 20 && (f.w !== MINI_TILE || f.w < 4)) miniTileOk = false;
}
assert(miniTileOk, 'mini: tile size clamped to >= 4px, tile=' + MINI_TILE);
assert(c(miniClear, 'o') > 0, 'mini clear: sun/moon visible');

/* mini cloud stays inside the lattice */
miniScene.setScene({ kind: 'cloudy', isDay: true, intensity: 0.6, wind: 10 });
driveFrames(6, miniMock);
const miniCloud = miniScan(miniMock, 'cloudy');
assert(c(miniCloud, '#') > 0, 'mini cloudy: cloud tiles present');
assert(miniCloud.badTiles === 0, 'mini: cloud tiles stay inside the lattice bounds, bad=' + miniCloud.badTiles);

/* mini rain: under the cloud, above the flat ground band */
miniScene.setScene({ kind: 'rain', isDay: true, intensity: 0.8, wind: 10 });
driveFrames(8, miniMock);
let miniRainTiles = 0;
let miniRainBadGround = 0;
let miniRainBadSky = 0;
for (let i = 0; i < 10; i++) {
  driveFrame(miniMock);
  const scan = miniScan(miniMock, 'rain');
  const cloudCells = new Set();
  for (const [key, style] of scan.cells) {
    if (CLOUD_NORMAL.has(style) || CLOUD_STORM.has(style) || CLOUD_OVERCAST.has(style)) cloudCells.add(key);
  }
  for (const [key, style] of scan.cells) {
    if (!RAIN_SET.has(style)) continue;
    miniRainTiles += 1;
    const r0 = Math.floor(key / MINI_COLS);
    const c0 = key % MINI_COLS;
    if (r0 >= MINI_GROUND_ROW) miniRainBadGround += 1;
    let hasCloudAbove = false;
    for (let rr = 0; rr < r0; rr++) {
      if (cloudCells.has(rr * MINI_COLS + c0)) { hasCloudAbove = true; break; }
    }
    if (!hasCloudAbove) miniRainBadSky += 1;
  }
}
assert(miniRainTiles > 0, 'mini rain: drops are drawn');
assert(miniRainBadGround === 0, 'mini rain: never below the ground band, bad=' + miniRainBadGround);
assert(miniRainBadSky === 0, 'mini rain: only under the mini cloud, bad=' + miniRainBadSky);
assert(MINI_GROUND_ROW > 0 && MINI_GROUND_ROW < MINI_ROWS, 'mini: flat ground band row=' + MINI_GROUND_ROW);

/* mini zero-size canvas / missing context never throw */
let miniThrew = false;
try {
  const zeroMock = makeMock2d();
  const zeroScene = createMatrixScene(makeCanvas(zeroMock, 0, 0), { cols: 9, rows: 7, mini: true });
  zeroScene.setScene({ kind: 'rain', isDay: true, intensity: 0.7, wind: 5 });
  zeroScene.start();
  driveFrame(zeroMock);
  driveFrame(zeroMock);
  zeroScene.stop();
  zeroScene.dispose();
} catch (e) { miniThrew = true; }
assert(!miniThrew, 'mini: zero-size canvas never throws');
miniThrew = false;
try {
  const noCtxCanvas = { clientWidth: MINI_W, clientHeight: MINI_H, width: 0, height: 0, style: {}, getContext: () => null };
  const noCtxScene = createMatrixScene(noCtxCanvas, { cols: MINI_COLS, rows: MINI_ROWS, mini: true });
  noCtxScene.setScene({ kind: 'rain', isDay: true, intensity: 0.7, wind: 5 });
  noCtxScene.start();
  driveFrame(miniMock);
  noCtxScene.stop();
  noCtxScene.dispose();
} catch (e) { miniThrew = true; }
assert(!miniThrew, 'mini: missing 2D context never throws');

/* dispose cleanly, then no more frames are produced */
miniScene.dispose();
assert(driveFrame(miniMock) === false, 'mini: no frames after dispose');

/* reduced motion: exactly one static frame, no animation loop */
const winMiniReduced = makeWindow(true);
globalThis.window = winMiniReduced;
const mockMiniReduced = makeMock2d();
const miniReducedScene = createMatrixScene(makeCanvas(mockMiniReduced, MINI_W, MINI_H), { cols: MINI_COLS, rows: MINI_ROWS, mini: true });
miniReducedScene.setScene({ kind: 'cloudy', isDay: true, intensity: 0.6, wind: 10 });
miniReducedScene.start();
assert(mockMiniReduced.fills.length > 0, 'mini reduced-motion: static frame renders');
const miniReducedScan = miniScan(mockMiniReduced, 'cloudy');
assert(miniReducedScan.cells.size === MINI_COLS * MINI_ROWS, 'mini reduced-motion: 9x7 frame');
assert(!winMiniReduced.hasFrame(), 'mini reduced-motion: no animation loop');
miniReducedScene.dispose();
globalThis.window = win;

for (const label of ['partly', 'cloudy', 'overcast', 'rain', 'drizzle', 'snow', 'thunder', 'clear-night']) {
  printAscii(label, results[label]);
}
console.log('\nPASS tile-mosaic composition + alphabet ASCII maps');

/* ------------------------- invalid/repeated scenes ----------------------- */

scene.setScene();
scene.setScene({ kind: 'nonsense' });
scene.setScene({ kind: 'cloudy', isDay: false });
driveFrames(3, mock);
console.log('PASS setScene safe with missing/unknown kinds');

/* ------------------- reduced-motion toggle while running ----------------- */

scene.setReducedMotion(true);
assert(mock.fills.length > 0, 'setReducedMotion(true) renders a static frame immediately');
driveFrames(2, mock);
assert(!win.hasFrame(), 'reduced motion stops the animation loop');
scene.setReducedMotion(false);
assert(win.hasFrame(), 'setReducedMotion(false) resumes the animation loop');
assert(driveFrames(2, mock) === 2, 'loop runs again after reduced motion is cleared');
console.log('PASS reduced-motion toggle');

/* --------------------- start()/stop() idempotence ------------------------ */

scene.start();
scene.start();
assert(win.hasFrame(), 'repeated start() is idempotent (one loop queued)');
scene.stop();
driveFrames(2, mock);
assert(!win.hasFrame(), 'stop() cancels the loop');
scene.start();
assert(driveFrames(2, mock) === 2, 'restart after stop() works');
console.log('PASS start/stop idempotence');

scene.dispose();
assert(!win.hasFrame(), 'dispose() cancels the pending frame');
assert(!driveFrame(mock), 'no frame callback remains after dispose()');
scene.setScene({ kind: 'rain' });
scene.start();
assert(!win.hasFrame(), 'API no-ops after dispose()');
console.log('PASS dispose cleanup');

/* --------------------- reduced motion from the start --------------------- */

const winReduced = makeWindow(true);
globalThis.window = winReduced;
const mockReduced = makeMock2d();
const reducedScene = createMatrixScene(makeCanvas(mockReduced, W, H));
reducedScene.setScene({ kind: 'snow', isDay: true, intensity: 0.7, wind: 8 });
mockReduced.reset();
reducedScene.start();
assert(mockReduced.fills.length > COLS * ROWS, 'prefers-reduced-motion start() paints one static frame');
assert(!winReduced.hasFrame(), 'prefers-reduced-motion never schedules rAF');
reducedScene.stop();
reducedScene.dispose();
console.log('PASS prefers-reduced-motion static frame');

/* -------------------- zero size / missing 2D context --------------------- */

globalThis.window = makeWindow(false);
const zeroMock = makeMock2d();
const zeroScene = createMatrixScene(makeCanvas(zeroMock, 0, 0));
zeroScene.setScene({ kind: 'heavy-rain', intensity: 1, wind: 40 });
zeroScene.start();
driveFrames(4, zeroMock);
assert(zeroMock.fills.length === 0, 'zero-size canvas renders nothing');
zeroScene.stop();
zeroScene.dispose();
console.log('PASS zero-size canvas does not throw');

const noCtxScene = createMatrixScene({ clientWidth: W, clientHeight: H, width: 0, height: 0, style: {}, getContext: () => null });
noCtxScene.setScene({ kind: 'thunder', isDay: false, intensity: 1, wind: 30 });
noCtxScene.start();
driveFrames(4, makeMock2d());
noCtxScene.setReducedMotion(true);
noCtxScene.dispose();
console.log('PASS missing 2D context does not throw');

/* ------------------------------ app-level checks ------------------------ */

const partSrc = readFileSync(partPath, 'utf8');
assert(!/\bexport\s/.test(partSrc), 'part has no export statements');
assert(!/\bimport\s/.test(partSrc), 'part has no import statements');
assert(!/\brequire\s*\(/.test(partSrc), 'part has no require() calls');
assert(/module\.exports\s*=\s*\{\s*createMatrixScene\s*\}/.test(partSrc), 'part keeps the CJS guard');
assert(partSrc.indexOf('function createMatrixScene(') >= 0, 'part declares createMatrixScene');
assert(partSrc.indexOf('fillRect') >= 0, 'part draws the lattice with fillRect');
assert(partSrc.indexOf('putImageData') < 0, 'part no longer uses ImageData sprites');
for (const bad of ['createWeatherData', 'WX_', 'WeatherWidget', 'WeatherIcon', 'wxApply', 'React', 'JSX']) {
  assert(partSrc.indexOf(bad) < 0, 'part does not reference reserved name ' + bad);
}
console.log('PASS source hygiene (tile renderer, no ESM/require/reserved names)');

if (failures.length) {
  console.error('\nFAILED ' + failures.length + ' of ' + checks + ' checks');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('\nALL PASS (' + checks + ' assertions)');
process.exit(0);