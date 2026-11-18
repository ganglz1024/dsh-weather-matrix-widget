/* 10-matrix.js - tile-mosaic weather scene for the floating weather card.
 * Plain browser JS. Concatenated inside the client module factory; no imports,
 * no exports, no external assets, no top-level side effects.
 * Public API: createMatrixScene(canvas) -> { setScene, start, stop, dispose, setReducedMotion }
 *
 * v4: the left panel is a lattice of small square tiles. Empty tiles are barely
 * visible; weather lights up discrete tiles. Clouds are drifting tile fields,
 * rain/snow/hail are discrete falling tiles. Drawn with integer fillRect calls
 * (no antialiasing, no pixel-art sprites, no text).
 */
function createMatrixScene(canvas, options) {
  'use strict';

  /* Optional mini-lattice mode for the minimized pill: { cols, rows, mini }.
   * Defaults preserve the 25x27 behaviour exactly. */
  var mxOptions = options || {};
  var mxMini = !!mxOptions.mini;
  var mxOptCols = (typeof mxOptions.cols === 'number' && isFinite(mxOptions.cols)) ? mxOptions.cols : 25;
  var mxOptRows = (typeof mxOptions.rows === 'number' && isFinite(mxOptions.rows)) ? mxOptions.rows : 27;

  var TAU = Math.PI * 2;
  var PITCH_CSS = 9.3;
  var MAX_COLS = 34;
  var MAX_ROWS = 36;
  var MAX_CLOUDS = 8;
  var MAX_LOBES_PER_CLOUD = 5;
  var MAX_LOBES = MAX_CLOUDS * MAX_LOBES_PER_CLOUD;
  var MAX_PARTS = 90;
  var MAX_STARS = 8;
  var MAX_FOG = 4;

  /* --------------------------------------------------------------- palette */

  var RGB_BG = [11, 11, 16];
  var RGB_EMPTY = [25, 25, 29];
  var RGB_CLOUD_DIM = [109, 109, 114];
  var RGB_CLOUD_MID = [141, 141, 146];
  var RGB_CLOUD_LIGHT = [166, 166, 171];
  var RGB_STORM_DIM = [92, 92, 98];
  var RGB_STORM_MID = [117, 117, 121];
  var RGB_STORM_LIGHT = [139, 139, 144];
  var RGB_CLOUD_TOP = [185, 190, 200];
  var RGB_STORM_TOP = [148, 153, 163];
  var RGB_OVERCAST_LIGHT = [154, 159, 169];
  var RGB_OVERCAST_TOP = [173, 178, 188];
  var RGB_OVERCAST_MID = [126, 130, 139];
  var RGB_OVERCAST_DARK_LIGHT = [139, 144, 154];
  var RGB_OVERCAST_DARK_TOP = [154, 160, 170];
  var RGB_OVERCAST_DARK_MID = [113, 117, 126];
  var RGB_RAIN = [0, 174, 236];
  var RGB_RAIN_HEAD = [79, 210, 255];
  var RGB_SNOW = [234, 243, 255];
  var RGB_SUN = [255, 211, 122];
  var RGB_SUN_RIM = [255, 178, 102];
  var RGB_MOON = [242, 240, 226];
  var RGB_MOON_DIM = [206, 204, 189];
  var RGB_STAR = [207, 220, 255];
  var RGB_STAR_DIM = [148, 160, 196];
  var RGB_FOG = [74, 74, 82];
  var RGB_HORIZON = [63, 63, 70];
  var RGB_GROUND_DARK = [47, 47, 54];
  var RGB_BOLT_AMBER = [255, 211, 122];
  var RGB_BOLT_WHITE = [255, 246, 223];

  function mxHex2(v) {
    var s = (v & 255).toString(16);
    return s.length < 2 ? '0' + s : s;
  }

  function mxHex(r, g, b) { return '#' + mxHex2(r) + mxHex2(g) + mxHex2(b); }

  var PX_BG = mxHex(RGB_BG[0], RGB_BG[1], RGB_BG[2]);
  var PX_CLOUD_DIM = mxHex(RGB_CLOUD_DIM[0], RGB_CLOUD_DIM[1], RGB_CLOUD_DIM[2]);
  var PX_CLOUD_MID = mxHex(RGB_CLOUD_MID[0], RGB_CLOUD_MID[1], RGB_CLOUD_MID[2]);
  var PX_CLOUD_LIGHT = mxHex(RGB_CLOUD_LIGHT[0], RGB_CLOUD_LIGHT[1], RGB_CLOUD_LIGHT[2]);
  var PX_STORM_DIM = mxHex(RGB_STORM_DIM[0], RGB_STORM_DIM[1], RGB_STORM_DIM[2]);
  var PX_STORM_MID = mxHex(RGB_STORM_MID[0], RGB_STORM_MID[1], RGB_STORM_MID[2]);
  var PX_STORM_LIGHT = mxHex(RGB_STORM_LIGHT[0], RGB_STORM_LIGHT[1], RGB_STORM_LIGHT[2]);
  var PX_CLOUD_TOP = mxHex(RGB_CLOUD_TOP[0], RGB_CLOUD_TOP[1], RGB_CLOUD_TOP[2]);
  var PX_STORM_TOP = mxHex(RGB_STORM_TOP[0], RGB_STORM_TOP[1], RGB_STORM_TOP[2]);
  var PX_OVERCAST_LIGHT = mxHex(RGB_OVERCAST_LIGHT[0], RGB_OVERCAST_LIGHT[1], RGB_OVERCAST_LIGHT[2]);
  var PX_OVERCAST_TOP = mxHex(RGB_OVERCAST_TOP[0], RGB_OVERCAST_TOP[1], RGB_OVERCAST_TOP[2]);
  var PX_OVERCAST_MID = mxHex(RGB_OVERCAST_MID[0], RGB_OVERCAST_MID[1], RGB_OVERCAST_MID[2]);
  var PX_OVERCAST_DARK_LIGHT = mxHex(RGB_OVERCAST_DARK_LIGHT[0], RGB_OVERCAST_DARK_LIGHT[1], RGB_OVERCAST_DARK_LIGHT[2]);
  var PX_OVERCAST_DARK_TOP = mxHex(RGB_OVERCAST_DARK_TOP[0], RGB_OVERCAST_DARK_TOP[1], RGB_OVERCAST_DARK_TOP[2]);
  var PX_OVERCAST_DARK_MID = mxHex(RGB_OVERCAST_DARK_MID[0], RGB_OVERCAST_DARK_MID[1], RGB_OVERCAST_DARK_MID[2]);
  var PX_RAIN = mxHex(RGB_RAIN[0], RGB_RAIN[1], RGB_RAIN[2]);
  var PX_RAIN_HEAD = mxHex(RGB_RAIN_HEAD[0], RGB_RAIN_HEAD[1], RGB_RAIN_HEAD[2]);
  var PX_SNOW = mxHex(RGB_SNOW[0], RGB_SNOW[1], RGB_SNOW[2]);
  var PX_SUN = mxHex(RGB_SUN[0], RGB_SUN[1], RGB_SUN[2]);
  var PX_SUN_RIM = mxHex(RGB_SUN_RIM[0], RGB_SUN_RIM[1], RGB_SUN_RIM[2]);
  var PX_MOON = mxHex(RGB_MOON[0], RGB_MOON[1], RGB_MOON[2]);
  var PX_MOON_DIM = mxHex(RGB_MOON_DIM[0], RGB_MOON_DIM[1], RGB_MOON_DIM[2]);
  var PX_STAR = mxHex(RGB_STAR[0], RGB_STAR[1], RGB_STAR[2]);
  var PX_STAR_DIM = mxHex(RGB_STAR_DIM[0], RGB_STAR_DIM[1], RGB_STAR_DIM[2]);
  var PX_FOG = mxHex(RGB_FOG[0], RGB_FOG[1], RGB_FOG[2]);
  var PX_HORIZON = mxHex(RGB_HORIZON[0], RGB_HORIZON[1], RGB_HORIZON[2]);
  var PX_GROUND_DARK = mxHex(RGB_GROUND_DARK[0], RGB_GROUND_DARK[1], RGB_GROUND_DARK[2]);
  var PX_BOLT_AMBER = mxHex(RGB_BOLT_AMBER[0], RGB_BOLT_AMBER[1], RGB_BOLT_AMBER[2]);
  var PX_BOLT_WHITE = mxHex(RGB_BOLT_WHITE[0], RGB_BOLT_WHITE[1], RGB_BOLT_WHITE[2]);

  var MX_KINDS = ['clear', 'partly', 'cloudy', 'overcast', 'fog', 'drizzle',
    'rain', 'heavy-rain', 'snow', 'thunder', 'sleet'];

  var MX_BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  /* ---------------------------------------------------------------- utils */

  function mxClamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function mxNum(v, d) {
    return (typeof v === 'number' && isFinite(v)) ? v : d;
  }

  /* --------------------------------------------------------------- state */

  var mxCanvas = canvas || null;
  var mxCtx = null;
  var mxDisposed = false;
  var mxRunning = false;
  var mxUserStarted = false;
  var mxReduced = false;
  var mxRaf = 0;
  var mxLast = 0;
  var mxTime = 0;
  var mxMq = null;
  var mxMqListener = null;
  var mxObserver = null;
  var mxResizeHandler = null;

  var mxCssW = 0;
  var mxCssH = 0;
  var mxBw = 0;
  var mxBh = 0;
  var mxCols = 0;
  var mxRows = 0;
  var mxPitchX = 1;
  var mxPitchY = 1;
  var mxTile = 4;
  var mxCellX = null;
  var mxCellY = null;
  var mxEmptyStyle = null;
  var mxNoise = null;
  var mxHorizonRow = 0;

  var mxState = { kind: 'clear', isDay: true, intensity: 0.5, wind: 8 };

  var mxCloudCount = 0;
  var mxCloudActive = false;
  var mxCloudDark = false;
  var mxCloudTone = 0; /* 0 = normal, 1 = thunder, 2 = overcast */
  var mxCloudClipFrac = 0.58;
  var mxCloudClipRow = 16;
  var mxCloudMask = null;
  var mxCloudTmp = null;
  var mxCloudField = null;
  var mxCloudTop = null;
  var mxCloudBot = null;
  var mxCloudBottomRow = -1;
  var mxRainTopRow = 0;
  var mxGroundTop = null;
  var mxCloudMaskDirty = true;
  var mxCloudUnder = null;
  var mxCloudBottomAt = null;
  var mxCloudReady = false;

  var MX_TONE_INTERIOR = 1;
  var MX_TONE_TOP = 2;
  var MX_TONE_BOTTOM = 3;
  var MX_TONE_EDGE = 4;

  var mxClouds = [];
  for (var mxc = 0; mxc < MAX_CLOUDS; mxc++) {
    mxClouds.push({
      active: false, used: false, cxFrac: 0, cyFrac: 0, drift: 0, speedMul: 1,
      bitmap: null, bmW: 0, bmH: 0, colFrac: 0, rowFrac: 0,
      maskW: 0, maskH: 0, anchorCol: 0, anchorRow: 0,
      tone: new Uint8Array(MAX_COLS * MAX_ROWS),
      dxOff: new Int16Array(MAX_COLS),
      dyOff: new Int16Array(MAX_ROWS)
    });
  }
  var mxLobeCount = 0;
  var mxLobes = [];
  for (var mxl = 0; mxl < MAX_LOBES; mxl++) {
    mxLobes.push({
      cloud: 0,
      dxFrac: 0, dyFrac: 0, rxFrac: 0.1, ryFrac: 0.1, amp: 1,
      hx: new Float32Array(MAX_COLS),
      hy: new Float32Array(MAX_ROWS)
    });
  }

  var mxPartCount = 0;
  var mxRainCount = 0;
  var mxSnowCount = 0;
  var mxParts = [];
  for (var mxp = 0; mxp < MAX_PARTS; mxp++) {
    mxParts.push({
      kind: 0, colFrac: 0, yFrac: 0, spd: 8, tall: 0, head: 0, phase: 0, waiting: 0
    });
  }

  var mxStarCount = 0;
  var mxStarDim = false;
  var mxStarCol = new Int16Array(MAX_STARS);
  var mxStarRow = new Int16Array(MAX_STARS);
  var mxStarPhase = new Float32Array(MAX_STARS);

  var mxFogCount = 0;
  var mxFogBands = [];
  for (var mxf = 0; mxf < MAX_FOG; mxf++) {
    mxFogBands.push({ cyFrac: 0, halfFrac: 0.05, amp: 1, phase: 0 });
  }

  var mxFlashStart = -1;
  var mxFlashDur = 0.2;
  var mxFlashNext = 4;
  var mxFlashTwo = false;
  var mxLf = 0;
  var mxBoltCol = 8;

  /* -------------------------------------------------------------- geometry */

  function mxBuildGrid() {
    if (mxMini) {
      mxCols = mxClamp(Math.round(mxOptCols), 4, Math.min(40, MAX_COLS));
      mxRows = mxClamp(Math.round(mxOptRows), 4, Math.min(40, MAX_ROWS));
    } else {
      mxCols = mxClamp(Math.round(mxCssW / PITCH_CSS), 18, MAX_COLS);
      mxRows = mxClamp(Math.round(mxCssH / PITCH_CSS), 18, MAX_ROWS);
    }
    mxPitchX = mxBw / mxCols;
    mxPitchY = mxBh / mxRows;
    mxTile = Math.round(Math.min(mxPitchX, mxPitchY) * 0.8);
    if (mxMini) {
      if (mxTile < 4) mxTile = 4;
    } else if (mxTile < 3) {
      mxTile = 3;
    }
    if (mxTile > Math.min(mxPitchX, mxPitchY)) {
      mxTile = Math.max(mxMini ? 4 : 3, Math.round(Math.min(mxPitchX, mxPitchY)));
    }

    mxCellX = new Int32Array(mxCols);
    mxCellY = new Int32Array(mxRows);
    var c;
    for (c = 0; c < mxCols; c++) {
      mxCellX[c] = Math.round((c + 0.5) * mxPitchX - mxTile / 2);
    }
    for (var r = 0; r < mxRows; r++) {
      mxCellY[r] = Math.round((r + 0.5) * mxPitchY - mxTile / 2);
    }

    var n = mxCols * mxRows;
    mxEmptyStyle = new Array(n);
    mxNoise = new Float32Array(n);
    mxCloudMask = new Uint8Array(n);
    mxCloudTmp = new Uint8Array(n);
    mxCloudField = new Float32Array(n);
    mxCloudTop = new Int16Array(mxCols);
    mxCloudBot = new Int16Array(mxCols);
    mxGroundTop = new Int16Array(mxCols);
    mxCloudUnder = new Uint8Array(mxCols);
    mxCloudBottomAt = new Int16Array(mxCols);
    mxCloudReady = false;
    for (var i = 0; i < n; i++) {
      var jitter = Math.round((Math.random() * 2 - 1) * 2);
      mxNoise[i] = Math.random() * 2 - 1;
      mxEmptyStyle[i] = mxHex(RGB_EMPTY[0] + jitter, RGB_EMPTY[1] + jitter,
        RGB_EMPTY[2] + jitter);
    }
    mxHorizonRow = Math.round(mxRows * (mxMini ? 0.74 : 0.76));
    mxBuildGroundTop();
    mxCloudBottomRow = -1;
    mxRainTopRow = 0;
    mxCloudMaskDirty = true;
    mxUpdateClipRows();
  }

  function mxUpdateClipRows() {
    if (!mxRows) return;
    mxCloudClipRow = Math.round(mxRows * mxCloudClipFrac);
    if (mxCloudClipRow < 4) mxCloudClipRow = 4;
    if (mxCloudClipRow > mxRows - 2) mxCloudClipRow = mxRows - 2;
  }

  /* Ground surface row per column: the horizon row, raised by the right-hill. */
  function mxBuildGroundTop() {
    var cols = mxCols;
    var horizon = mxHorizonRow;
    if (mxMini) {
      /* mini: one flat ground band, no hill */
      var flat = mxClamp(horizon, 1, mxRows - 2);
      for (var mc = 0; mc < cols; mc++) mxGroundTop[mc] = flat;
      return;
    }
    var c0 = Math.round(cols * 0.62);
    var c1 = Math.round(cols * 0.95);
    if (c1 >= cols) c1 = cols - 1;
    var span = c1 - c0;
    for (var c = 0; c < cols; c++) {
      var h = 0;
      if (c >= c0 && c <= c1) {
        var t = span > 0 ? (c - c0) / span : 0;
        h = Math.round(3 * Math.sin(Math.PI * t));
      }
      var top = horizon - h;
      if (top < 1) top = 1;
      mxGroundTop[c] = top;
    }
  }

  /* -------------------------------------------------------------- drawing */

  function mxFillTile(col, row, style) {
    mxCtx.fillStyle = style;
    mxCtx.fillRect(mxCellX[col], mxCellY[row], mxTile, mxTile);
  }

  function mxDrawEmptyTiles() {
    var cols = mxCols;
    var rows = mxRows;
    for (var r = 0; r < rows; r++) {
      var base = r * cols;
      for (var c = 0; c < cols; c++) {
        mxCtx.fillStyle = mxEmptyStyle[base + c];
        mxCtx.fillRect(mxCellX[c], mxCellY[r], mxTile, mxTile);
      }
    }
  }

  function mxDrawHorizon() {
    var cols = mxCols;
    var rows = mxRows;
    var bottom = mxHorizonRow + 1;
    if (bottom >= rows) bottom = rows - 1;
    for (var c = 0; c < cols; c++) {
      var top = mxGroundTop[c];
      if (top < 0) top = 0;
      if (top >= rows) top = rows - 1;
      for (var r = top; r <= bottom; r++) {
        mxCtx.fillStyle = (r === top) ? PX_HORIZON : PX_GROUND_DARK;
        mxCtx.fillRect(mxCellX[c], mxCellY[r], mxTile, mxTile);
      }
    }
  }

  /* -------------------------------------------------------------- celestial */

  function mxCellCenterX(frac) { return frac * mxCols; }
  function mxCellCenterY(frac) { return frac * mxRows; }

  function mxDrawSun() {
    var cx = mxCellCenterX(mxMini ? 0.62 : 0.80);
    var cy = mxCellCenterY(mxMini ? 0.45 : 0.18);
    var R = mxMini ? 1.5 : 2.2;
    var c0 = Math.max(0, Math.floor(cx - R - 1));
    var c1 = Math.min(mxCols - 1, Math.ceil(cx + R + 1));
    var r0 = Math.max(0, Math.floor(cy - R - 1));
    var r1 = Math.min(mxRows - 1, Math.ceil(cy + R + 1));
    var c, r;
    for (r = r0; r <= r1; r++) {
      for (c = c0; c <= c1; c++) {
        var dx = (c + 0.5) - cx;
        var dy = (r + 0.5) - cy;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > R) continue;
        mxFillTile(c, r, d <= R * 0.62 ? PX_SUN : PX_SUN_RIM);
      }
    }
    var RAY_DX = [0, 0, -1, 1, -0.71, 0.71, 0.71, -0.71];
    var RAY_DY = [-1, 1, 0, 0, -0.71, -0.71, 0.71, 0.71];
    for (var q = 0; q < 8; q++) {
      var tc = Math.round(cx + RAY_DX[q] * (R + (mxMini ? 0.7 : 1)) - 0.5);
      var tr = Math.round(cy + RAY_DY[q] * (R + (mxMini ? 0.7 : 1)) - 0.5);
      if (tc < 0 || tc >= mxCols || tr < 0 || tr >= mxRows) continue;
      if (tc + 0.5 === cx && tr + 0.5 === cy) continue;
      mxFillTile(tc, tr, PX_SUN_RIM);
    }
  }

  function mxDrawMoon() {
    /* A round moon with a couple of darker craters reads as "moon" at tile
       size; a one-cell crescent just looks like a stray hook. */
    var cx = mxCellCenterX(mxMini ? 0.62 : 0.80);
    var cy = mxCellCenterY(mxMini ? 0.45 : 0.18);
    var R = mxMini ? 1.5 : 2.2;
    var c0 = Math.max(0, Math.floor(cx - R - 1));
    var c1 = Math.min(mxCols - 1, Math.ceil(cx + R + 1));
    var r0 = Math.max(0, Math.floor(cy - R - 1));
    var r1 = Math.min(mxRows - 1, Math.ceil(cy + R + 1));
    var craters = [[-0.55, -0.45], [0.5, 0.65]];
    for (var r = r0; r <= r1; r++) {
      for (var c = c0; c <= c1; c++) {
        var dx = (c + 0.5) - cx;
        var dy = (r + 0.5) - cy;
        if (dx * dx + dy * dy > R * R) continue;
        var crater = false;
        for (var k = 0; k < craters.length; k++) {
          var ex = dx - craters[k][0];
          var ey = dy - craters[k][1];
          if (ex * ex + ey * ey < 0.5) { crater = true; break; }
        }
        mxFillTile(c, r, crater ? PX_MOON_DIM : PX_MOON);
      }
    }
  }

  function mxDrawStars() {
    var starStyle = mxStarDim ? PX_STAR_DIM : PX_STAR;
    for (var k = 0; k < mxStarCount; k++) {
      var tw = Math.sin(mxTime * 1.7 + mxStarPhase[k]);
      if (tw < -0.85) continue;
      mxFillTile(mxStarCol[k], mxStarRow[k], starStyle);
    }
  }

  function mxConfigureStars() {
    var cols = mxCols > 0 ? mxCols : 25;
    var rows = mxRows > 0 ? mxRows : 27;
    if (mxMini) {
      mxStarCount = mxClamp(Math.floor((cols * rows) / 14), 2, MAX_STARS);
      var miniTop = Math.max(1, Math.round(rows * 0.35));
      for (var mk = 0; mk < mxStarCount; mk++) {
        mxStarCol[mk] = 1 + Math.floor(Math.random() * Math.max(1, cols - 2));
        mxStarRow[mk] = 1 + Math.floor(Math.random() * miniTop);
        mxStarPhase[mk] = Math.random() * TAU;
      }
      return;
    }
    var topLimit = mxCloudClipRow > 3 ? mxCloudClipRow - 2 : Math.round(rows * 0.4);
    mxStarCount = MAX_STARS;
    for (var k = 0; k < mxStarCount; k++) {
      mxStarCol[k] = 1 + Math.floor(Math.random() * (cols - 2));
      mxStarRow[k] = 1 + Math.floor(Math.random() * Math.max(1, topLimit));
      mxStarPhase[k] = Math.random() * TAU;
    }
  }

  /* ------------------------------------------------------------------ clouds */

  /* Hand-authored cloud silhouettes: explicit tile bitmaps -> exact shape. */
  var MX_BITMAP_BIG = [
    '..##..###...',
    '.####.####..',
    '.###########',
    '############',
    '############'
  ];
  var MX_BITMAP_SMALL = [
    '..##.##.',
    '.######.',
    '########',
    '########'
  ];
  /* mini-lattice bitmaps for the minimized pill: compact 3-row clouds so the
   * tiny scene keeps visible sky and room for precipitation below the cloud. */
  var MX_BITMAP_MINI_SMALL = [
    '.##.##',
    '######',
    '######'
  ];
  var MX_BITMAP_MINI_BIG = [
    '..##.##',
    '.######',
    '#######'
  ];
  function mxBitmapSpec(bitmap, colFrac, rowFrac, speed, sync, borderless, shade) {
    return {
      bitmap: bitmap, w: bitmap[0].length, h: bitmap.length,
      colFrac: colFrac, rowFrac: rowFrac, speed: speed, sync: !!sync,
      borderless: !!borderless, shade: shade || 0
    };
  }

  function mxConfigureClouds(kind) {
    mxCloudCount = 0;
    mxCloudActive = false;
    mxCloudDark = (kind === 'thunder');
    mxCloudTone = (kind === 'thunder') ? 1 : (kind === 'overcast' ? 2 : 0);
    mxCloudClipFrac = mxMini ? 0.60 : 0.58;
    mxCloudMaskDirty = true;
    mxCloudReady = false;
    mxCloudBottomRow = -1;
    mxRainTopRow = 0;
    if (mxMini) {
      mxConfigureMiniClouds(kind);
      return;
    }
    var specs = null;
    switch (kind) {
      case 'partly':
        specs = [mxBitmapSpec(MX_BITMAP_BIG, 0.36, 0.10, 1, false)];
        break;
      case 'cloudy':
      case 'drizzle':
      case 'rain':
      case 'snow':
      case 'sleet':
      case 'thunder':
        specs = [
          mxBitmapSpec(MX_BITMAP_SMALL, 0.08, 0.15, 1.0, false),
          mxBitmapSpec(MX_BITMAP_BIG, 0.48, 0.10, 1.15, false)
        ];
        break;
      case 'heavy-rain':
        /* heavier weather = larger cloud mass (two big clouds, small gap) */
        specs = [
          mxBitmapSpec(MX_BITMAP_BIG, 0.00, 0.08, 1.1, false),
          mxBitmapSpec(MX_BITMAP_BIG, 0.54, 0.12, 1.25, false)
        ];
        break;
      case 'overcast':
        /* clean two-tier deck: darker under-lobes behind, lighter lobes on top */
        specs = [
          mxBitmapSpec(MX_BITMAP_BIG, 0.04, 0.15, 0.9, true, false, 1),
          mxBitmapSpec(MX_BITMAP_SMALL, 0.36, 0.15, 0.9, true, false, 1),
          mxBitmapSpec(MX_BITMAP_BIG, 0.00, 0.00, 0.9, true),
          mxBitmapSpec(MX_BITMAP_BIG, 0.16, 0.04, 0.9, true),
          mxBitmapSpec(MX_BITMAP_SMALL, 0.32, 0.00, 0.9, true)
        ];
        break;
      default:
        specs = null;
        break;
    }
    if (!specs) return;
    for (var i = 0; i < specs.length && i < MAX_CLOUDS; i++) {
      mxAddCloud(specs[i]);
    }
    mxCloudActive = mxCloudCount > 0;
    mxUpdateClipRows();
  }

  function mxConfigureMiniClouds(kind) {
    /* One compact cloud per weather, fully inside the 9x7 lattice, so the tiny
       scene keeps visible sky and a free band under the cloud for drops. */
    var specs = null;
    switch (kind) {
      case 'partly':
        /* small cloud on the left, the sun peeks out on the right */
        specs = [mxBitmapSpec(MX_BITMAP_MINI_SMALL, 0.00, 0.06, 0, false)];
        break;
      case 'cloudy':
        specs = [mxBitmapSpec(MX_BITMAP_MINI_SMALL, 0.16, 0.06, 0, false)];
        break;
      case 'drizzle':
        specs = [mxBitmapSpec(MX_BITMAP_MINI_SMALL, 0.06, 0.04, 0, false)];
        break;
      case 'rain':
      case 'snow':
      case 'sleet':
      case 'heavy-rain':
      case 'thunder':
        specs = [mxBitmapSpec(MX_BITMAP_MINI_BIG, 0.08, 0.02, 0, false)];
        break;
      case 'overcast':
        specs = [
          mxBitmapSpec(MX_BITMAP_MINI_BIG, 0.00, 0.00, 0, true),
          mxBitmapSpec(MX_BITMAP_MINI_BIG, 0.14, 0.14, 0, true)
        ];
        break;
      default:
        specs = null;
        break;
    }
    if (!specs) return;
    for (var i = 0; i < specs.length && i < MAX_CLOUDS; i++) {
      mxAddCloud(specs[i]);
    }
    mxCloudActive = mxCloudCount > 0;
    mxUpdateClipRows();
  }

  function mxAddCloud(spec) {
    var ci = mxCloudCount;
    if (ci >= MAX_CLOUDS) return;
    var cloud = mxClouds[ci];
    cloud.active = true;
    cloud.bitmap = spec.bitmap;
    cloud.bmW = spec.w;
    cloud.bmH = spec.h;
    cloud.colFrac = spec.colFrac;
    cloud.rowFrac = spec.rowFrac;
    cloud.speedMul = spec.speed;
    cloud.borderless = !!spec.borderless;
    cloud.shade = spec.shade || 0;
    if (!cloud.used) {
      cloud.used = true;
      cloud.drift = 0;
    }
    if (spec.sync && ci > 0) cloud.drift = mxClouds[0].drift;
    mxCloudCount = ci + 1;
  }

  /* Build the fixed silhouette once per scene from the bitmap, with the shade
   * per tile: hump tops lighter, flat body, solid underside, dithered edge. */
  function mxBuildCloudMasks() {
    mxCloudMaskDirty = false;
    if (!mxCols || !mxRows) return;
    var cols = mxCols;
    var rows = mxRows;
    var ci, c, r;
    mxCloudBottomRow = -1;
    for (ci = 0; ci < mxCloudCount; ci++) {
      var cloud = mxClouds[ci];
      cloud.maskW = 0;
      cloud.maskH = 0;
      if (!cloud.active || !cloud.bitmap) continue;
      var bitmap = cloud.bitmap;
      var w = cloud.bmW;
      var hgt = cloud.bmH;
      var anchorCol = Math.round(cloud.colFrac * cols);
      var anchorRow = Math.round(cloud.rowFrac * rows);
      cloud.anchorCol = anchorCol;
      cloud.anchorRow = anchorRow;
      cloud.maskW = w;
      cloud.maskH = hgt;
      var tone = cloud.tone;
      for (var i = 0; i < w * hgt; i++) tone[i] = 0;
      for (c = 0; c < w; c++) {
        var topRow = -1;
        var botRow = -1;
        for (r = 0; r < hgt; r++) {
          if (bitmap[r].charAt(c) === '#') {
            if (topRow < 0) topRow = r;
            botRow = r;
          }
        }
        for (r = 0; r < hgt; r++) {
          if (bitmap[r].charAt(c) !== '#') continue;
          var t;
          if (r === botRow) {
            t = MX_TONE_BOTTOM;
          } else if (r === 0 && topRow === 0) {
            /* only the hump tops get the lighter shade, not a body stripe */
            t = MX_TONE_TOP;
          } else {
            var edge = false;
            var leftCh = (c > 0) ? bitmap[r].charAt(c - 1) : (cloud.borderless ? '#' : '');
            var rightCh = (c < w - 1) ? bitmap[r].charAt(c + 1) : (cloud.borderless ? '#' : '');
            if (!cloud.borderless && (c === 0 || c === w - 1 || r === 0 || r === hgt - 1)) edge = true;
            else if (leftCh !== '#' || rightCh !== '#' ||
              bitmap[r - 1].charAt(c) !== '#' || bitmap[r + 1].charAt(c) !== '#') edge = true;
            t = (edge && ((c + r) & 1) === 0) ? MX_TONE_EDGE : MX_TONE_INTERIOR;
          }
          tone[r * w + c] = t;
        }
      }
      for (c = 0; c < w; c++) cloud.dxOff[c] = Math.round(c * mxPitchX);
      for (r = 0; r < hgt; r++) {
        cloud.dyOff[r] = Math.round((anchorRow + r + 0.5) * mxPitchY - mxTile / 2);
      }
      var bottom = anchorRow + hgt - 1;
      if (bottom > mxCloudBottomRow) mxCloudBottomRow = bottom;
    }
    if (mxCloudBottomRow >= 0) mxRainTopRow = mxCloudBottomRow + 1;
    mxCloudReady = true;
  }

  function mxDrawClouds() {
    if (!mxCloudActive) return;
    if (mxCloudMaskDirty) mxBuildCloudMasks();
    var cols = mxCols;
    var bw = mxBw;
    var c;
    for (c = 0; c < cols; c++) {
      mxCloudUnder[c] = 0;
      mxCloudBottomAt[c] = -1;
    }
    var interiorPx;
    var edgePx;
    var topPx;
    if (mxCloudTone === 1) {
      interiorPx = PX_STORM_LIGHT;
      edgePx = PX_STORM_MID;
      topPx = PX_STORM_TOP;
    } else if (mxCloudTone === 2) {
      interiorPx = PX_OVERCAST_LIGHT;
      edgePx = PX_OVERCAST_MID;
      topPx = PX_OVERCAST_TOP;
    } else {
      interiorPx = PX_CLOUD_LIGHT;
      edgePx = PX_CLOUD_MID;
      topPx = PX_CLOUD_TOP;
    }
    for (var ci = 0; ci < mxCloudCount; ci++) {
      var cloud = mxClouds[ci];
      if (!cloud.active || !cloud.maskW) continue;
      if (mxCloudTone === 2) {
        var darkCloud = cloud.shade === 1;
        interiorPx = darkCloud ? PX_OVERCAST_DARK_LIGHT : PX_OVERCAST_LIGHT;
        edgePx = darkCloud ? PX_OVERCAST_DARK_MID : PX_OVERCAST_MID;
        topPx = darkCloud ? PX_OVERCAST_DARK_TOP : PX_OVERCAST_TOP;
      }
      var w = cloud.maskW;
      var hgt = cloud.maskH;
      var tone = cloud.tone;
      /* Cloud motion without a visible wrap: the cloud slides right until it is
       * fully past the right edge, then re-enters from the left. The wrap
       * happens while the cloud is off-screen, so it never looks split in two. */
      var span = cols + cloud.bmW;
      var phase = (cloud.anchorCol + cloud.bmW) / span;
      var travel = cloud.drift + phase;
      travel = travel - Math.floor(travel);
      var baseCol = -cloud.bmW + travel * span;
      var baseX = Math.round((baseCol + 0.5) * mxPitchX - mxTile / 2);
      for (var ly = 0; ly < hgt; ly++) {
        var y = cloud.dyOff[ly];
        if (y < 0 || y >= mxBh) continue;
        var rowBase = ly * w;
        for (var lx = 0; lx < w; lx++) {
          var t = tone[rowBase + lx];
          if (!t) continue;
          var style;
          if (t === MX_TONE_BOTTOM) style = edgePx;
          else if (t === MX_TONE_TOP) style = topPx;
          else if (t === MX_TONE_EDGE) style = edgePx;
          else style = interiorPx;
          var x = baseX + cloud.dxOff[lx];
          if (x + mxTile <= 0 || x >= bw) continue;
          mxCtx.fillStyle = style;
          mxCtx.fillRect(x, y, mxTile, mxTile);
          if (ly === hgt - 1) {
            var col = Math.round(((x + mxTile / 2) / mxPitchX) - 0.5);
            if (col >= 0 && col < cols) {
              mxCloudUnder[col] = 1;
              mxCloudBottomAt[col] = cloud.anchorRow + ly;
            }
          }
        }
      }
    }
  }
  /* ------------------------------------------------------------------ fog */

  function mxConfigureFog(kind) {
    mxFogCount = 0;
    if (kind !== 'fog') return;
    var defs = mxMini
      ? [[0.24, 0.05, 1.0], [0.52, 0.05, 1.05], [0.76, 0.05, 0.9]]
      : [
        [0.14, 0.045, 1.0],
        [0.36, 0.055, 1.05],
        [0.58, 0.050, 1.0],
        [0.80, 0.045, 0.9]
      ];
    for (var i = 0; i < defs.length && i < MAX_FOG; i++) {
      mxFogBands[i].cyFrac = defs[i][0];
      mxFogBands[i].halfFrac = defs[i][1];
      mxFogBands[i].amp = defs[i][2];
      mxFogBands[i].phase = Math.random() * TAU;
      mxFogCount = i + 1;
    }
  }

  function mxDrawFog() {
    var cols = mxCols;
    var rows = mxRows;
    var time = mxTime;
    var shift = ((time * 2.0) | 0) & 3;
    mxCtx.fillStyle = PX_FOG;
    for (var r = 0; r < rows; r++) {
      var rf = (r + 0.5) / rows;
      var bayerRow = (r & 3) << 2;
      for (var c = 0; c < cols; c++) {
        var inten = 0;
        for (var j = 0; j < mxFogCount; j++) {
          var band = mxFogBands[j];
          var d = (rf - band.cyFrac) / band.halfFrac;
          inten += band.amp * Math.exp(-1.2 * d * d);
        }
        if (inten < 0.10) continue;
        var wave = 0.72 + 0.28 * Math.sin(c * 0.22 - time * 0.9 + r * 0.12);
        var v = inten * wave;
        var bayer = (MX_BAYER[bayerRow | ((c + shift) & 3)] + 0.5) / 16;
        if (v < bayer) continue;
        mxCtx.fillRect(mxCellX[c], mxCellY[r], mxTile, mxTile);
      }
    }
  }

  /* --------------------------------------------------------- precipitation */

  function mxPickCloudColumn() {
    if (!mxCols) return 0;
    if (mxCloudReady && mxCloudUnder) {
      for (var t = 0; t < 10; t++) {
        var c = Math.floor(Math.random() * mxCols);
        if (mxCloudUnder[c]) return c;
      }
    }
    return Math.floor(mxCols * 0.5);
  }

  function mxColumnBusy(col, selfIndex) {
    for (var i = 0; i < mxPartCount; i++) {
      if (i === selfIndex) continue;
      var p = mxParts[i];
      if (p.waiting > 0) continue;
      var c = Math.floor(p.colFrac * mxCols);
      if (c < 0) c = 0;
      else if (c >= mxCols) c = mxCols - 1;
      if (c === col) return true;
    }
    return false;
  }

  /* Spawn one drop right under the cloud underside (cloudBottom+1) in a free
   * under-cloud column. randomY staggers the very first frame instead. */
  function mxSpawnDrop(index, randomY) {
    var p = mxParts[index];
    var cols = mxCols > 0 ? mxCols : 25;
    var rows = mxRows > 0 ? mxRows : 27;
    var topRow = mxRainTopRow > 0 ? mxRainTopRow : Math.round(rows * 0.30);
    var col = -1;
    var attempts = mxCloudReady ? 26 : 8;
    for (var t = 0; t < attempts; t++) {
      var c = mxPickCloudColumn();
      if (c < 0) c = 0;
      else if (c >= cols) c = cols - 1;
      if (!mxColumnBusy(c, index)) { col = c; break; }
    }
    if (col < 0) {
      /* every eligible column already has a drop: respect the cooldown */
      p.waiting = mxMini ? (0.02 + Math.random() * 0.04) : (0.18 + Math.random() * 0.22);
      return;
    }
    p.colFrac = (col + 0.5) / cols;
    if (randomY) {
      var g = (mxGroundTop && mxGroundTop[col] > 0) ? mxGroundTop[col] : Math.round(rows * 0.76);
      var lo = mxMini ? topRow : topRow + 1;
      var hi = mxMini ? (g - 1) : (g - 2);
      if (hi < lo) hi = lo;
      p.yFrac = (lo + Math.random() * (hi - lo)) / rows;
      if (p.yFrac * rows < lo) p.yFrac = lo / rows;
    } else {
      p.yFrac = topRow / rows;
    }
    p.waiting = 0;
  }

  function mxConfigureParticles(kind) {
    var inten = mxState.intensity;
    var scale = 0.72 + 0.48 * inten;
    var rainN = 0;
    var snowN = 0;
    var spdMin = 8;
    var spdMax = 14;

    if (mxMini) {
      /* mini caps: tiny pill stays readable */
      var mScale = 0.8 + 0.4 * inten;
      switch (kind) {
        case 'drizzle':
          rainN = mxClamp(Math.round(2 * mScale), 1, 2);
          spdMin = 8; spdMax = 10;
          break;
        case 'rain':
          rainN = mxClamp(Math.round(4 * mScale), 3, 5);
          spdMin = 10; spdMax = 13;
          break;
        case 'heavy-rain':
          rainN = mxClamp(Math.round(7 * mScale), 5, 8);
          spdMin = 11; spdMax = 14;
          break;
        case 'thunder':
          rainN = mxClamp(Math.round(5 * mScale), 3, 6);
          spdMin = 9; spdMax = 13;
          break;
        case 'sleet':
          rainN = 3;
          snowN = 2;
          spdMin = 9; spdMax = 12;
          break;
        case 'snow':
          snowN = mxClamp(Math.round(3 * mScale), 2, 4);
          break;
        default:
          break;
      }
    } else {
    switch (kind) {
      case 'drizzle':
        rainN = mxClamp(Math.round(4 * scale), 3, 5);
        spdMin = 8; spdMax = 10;
        break;
      case 'rain':
        rainN = mxClamp(Math.round(11 * scale), 10, 13);
        spdMin = 10; spdMax = 13;
        break;
      case 'heavy-rain':
        rainN = mxClamp(Math.round(28 * scale), 26, 30);
        spdMin = 11; spdMax = 14;
        break;
      case 'thunder':
        rainN = mxClamp(Math.round(17 * scale), 15, 18);
        spdMin = 9; spdMax = 13;
        break;
      case 'sleet':
        rainN = 8;
        snowN = 8;
        spdMin = 9; spdMax = 12;
        break;
      case 'snow':
        snowN = mxClamp(Math.round(11 * scale), 9, 13);
        break;
      default:
        break;
    }
    }
    if (rainN + snowN > MAX_PARTS) snowN = Math.max(0, MAX_PARTS - rainN);
    mxRainCount = rainN;
    mxSnowCount = snowN;
    mxPartCount = rainN + snowN;

    var i;
    for (i = 0; i < mxPartCount; i++) {
      var p = mxParts[i];
      var isRain = i < rainN;
      p.kind = isRain ? 0 : 1;
      p.colFrac = Math.random();
      p.spd = isRain
        ? (spdMin + Math.random() * (spdMax - spdMin)) * (0.8 + 0.4 * inten)
        : 3 + Math.random() * 3;
      p.tall = (isRain && (i % 2 === 0) && kind !== 'drizzle' && !mxMini) ? 1 : 0;
      p.head = (isRain && (i % 4 === 0)) ? 1 : 0;
      p.phase = Math.random() * TAU;
      p.waiting = 0;
      /* staggered start: already spread between the cloud bottom and the ground */
      p.yFrac = mxMini ? 0.57 : (0.33 + Math.random() * 0.30);
    }
  }

  function mxUpdateParticles(dt) {
    var rows = mxRows > 0 ? mxRows : 27;
    var cols = mxCols > 0 ? mxCols : 25;
    var topRow = mxRainTopRow > 0 ? mxRainTopRow : Math.round(rows * 0.30);
    var i;
    for (i = 0; i < mxPartCount; i++) {
      var p = mxParts[i];
      if (p.waiting > 0) {
        p.waiting -= dt;
        if (p.waiting <= 0) mxSpawnDrop(i, false);
        continue;
      }
      p.yFrac += (p.spd * dt) / rows;
      var col = Math.floor(p.colFrac * cols);
      if (col < 0) col = 0;
      else if (col >= cols) col = cols - 1;
      var ground = mxGroundTop ? mxGroundTop[col] : rows;
      /* one drop per column: move duplicates to a free under-cloud column */
      var dup = false;
      for (var j = 0; j < i; j++) {
        var q = mxParts[j];
        if (q.waiting > 0) continue;
        var qc = Math.floor(q.colFrac * cols);
        if (qc < 0) qc = 0;
        else if (qc >= cols) qc = cols - 1;
        if (qc === col) { dup = true; break; }
      }
      if (dup) {
        mxSpawnDrop(i, true);
        continue;
      }
      var row = Math.floor(p.yFrac * rows);
      if (row >= ground) {
        /* died on the ground: per-column cooldown before the next drop */
        p.waiting = mxMini ? (0.02 + Math.random() * 0.05) : (0.15 + Math.random() * 0.45);
        continue;
      }
      if (row < topRow) {
        mxSpawnDrop(i, true);
        continue;
      }
      if (mxCloudReady && mxCloudUnder && !mxCloudUnder[col]) {
        mxSpawnDrop(i, true);
      }
    }
  }

  function mxDrawRain() {
    var cols = mxCols;
    var rows = mxRows;
    var top = mxRainTopRow > 0 ? mxRainTopRow : Math.round(rows * 0.30);
    for (var i = 0; i < mxRainCount; i++) {
      var p = mxParts[i];
      if (p.waiting > 0) continue;
      var col = Math.floor(p.colFrac * cols);
      if (col < 0) col = 0;
      else if (col >= cols) col = cols - 1;
      if (mxCloudReady && mxCloudUnder && !mxCloudUnder[col]) continue;
      var ground = mxGroundTop ? mxGroundTop[col] : rows;
      var row = Math.floor(p.yFrac * rows);
      if (row < top || row >= ground) continue;
      if (p.tall && row - 1 > top) mxFillTile(col, row - 1, PX_RAIN);
      mxFillTile(col, row, p.head ? PX_RAIN_HEAD : PX_RAIN);
    }
  }

  function mxDrawSnow() {
    var cols = mxCols;
    var rows = mxRows;
    var top = mxRainTopRow > 0 ? mxRainTopRow : Math.round(rows * 0.30);
    for (var i = 0; i < mxSnowCount; i++) {
      var p = mxParts[mxRainCount + i];
      if (p.waiting > 0) continue;
      var row = Math.floor(p.yFrac * rows);
      if (row < top || row >= rows) continue;
      var baseCol = Math.floor(p.colFrac * cols);
      if (baseCol < 0) baseCol = 0;
      else if (baseCol >= cols) baseCol = cols - 1;
      if (mxCloudReady && mxCloudUnder && !mxCloudUnder[baseCol]) continue;
      var sway = Math.sin(mxTime * 1.5 + p.phase) >= 0 ? 1 : -1;
      var col = baseCol + sway;
      if (col < 0) col = 0;
      else if (col >= cols) col = cols - 1;
      if (mxCloudReady && mxCloudUnder && !mxCloudUnder[col]) col = baseCol;
      if (row >= (mxGroundTop ? mxGroundTop[col] : rows)) continue;
      mxFillTile(col, row, PX_SNOW);
    }
  }
  /* ----------------------------------------------------------- thunder bolt */

  var MX_BOLT_DX = [0, 1, 0, -1, 0, 1];

  function mxDrawBolt() {
    if (mxLf < 0.15) return;
    var top = mxRainTopRow > 0 ? mxRainTopRow : Math.round(mxRows * 0.30);
    var rows = mxRows;
    var height = mxMini ? 2 : 6;
    if (top + height > rows) height = rows - top;
    for (var k = 0; k < height; k++) {
      var col = mxBoltCol + MX_BOLT_DX[k];
      if (col < 0) col = 0;
      else if (col >= mxCols) col = mxCols - 1;
      var row = top + k;
      var ground = mxGroundTop ? mxGroundTop[col] : rows;
      if (row >= ground) break;
      var style = (k % 2 === 0) ? PX_BOLT_AMBER : PX_BOLT_WHITE;
      mxFillTile(col, row, style);
    }
  }
  /* ------------------------------------------------------------------ flash */

  function mxNowSec() {
    if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
      return performance.now() / 1000;
    }
    return Date.now() / 1000;
  }

  function mxUpdateLightning() {
    if (mxState.kind !== 'thunder') {
      mxLf = 0;
      mxFlashStart = -1;
      return;
    }
    var now = mxTime;
    if (now >= mxFlashNext) {
      mxFlashStart = now;
      mxFlashDur = 0.12 + Math.random() * 0.14;
      mxFlashNext = now + 6 + Math.random() * 8;
      mxFlashTwo = Math.random() < 0.6;
      mxBoltCol = mxPickCloudColumn();
    }
    var lf = 0;
    if (mxFlashStart >= 0) {
      var e = now - mxFlashStart;
      if (e <= mxFlashDur) {
        var t = e / mxFlashDur;
        var s1 = Math.exp(-t * 5.5);
        var s2 = (mxFlashTwo && t > 0.36) ? Math.exp(-(t - 0.36) * 8.0) * 0.8 : 0;
        lf = s1 > s2 ? s1 : s2;
        if (t > 0.9) lf *= (1 - t) / 0.1;
      } else {
        mxFlashStart = -1;
      }
    }
    mxLf = mxClamp(lf, 0, 1);
  }

  /* --------------------------------------------------------------- update */

  function mxUpdate(dt) {
    mxUpdateLightning();
    mxUpdateParticles(dt);
    var wind = mxState.wind;
    var speedPx = 2.5 + Math.abs(wind) * 0.02;
    var cssW = mxCssW > 0 ? mxCssW : 236;
    /* clouds always drift left -> right; the shape itself never changes */
    var driftPerSec = speedPx / cssW;
    for (var i = 0; i < mxCloudCount; i++) {
      var cloud = mxClouds[i];
      if (!cloud.active) continue;
      cloud.drift += driftPerSec * cloud.speedMul * dt;
      if (cloud.drift < 0) cloud.drift += 1;
      else if (cloud.drift >= 1) cloud.drift -= 1;
    }
  }

  /* --------------------------------------------------------------- render */

  function mxGetDpr() {
    var dpr = 1;
    try {
      if (typeof window !== 'undefined' && window && typeof window.devicePixelRatio === 'number') {
        dpr = window.devicePixelRatio;
      }
    } catch (e) { dpr = 1; }
    if (!(dpr > 0) || !isFinite(dpr)) dpr = 1;
    return Math.min(3, dpr);
  }

  function mxRender() {
    if (mxDisposed || !mxCanvas) return;

    var cssW = 0;
    var cssH = 0;
    try {
      cssW = +mxCanvas.clientWidth || 0;
      cssH = +mxCanvas.clientHeight || 0;
    } catch (e) { return; }
    if (cssW <= 0 || cssH <= 0) return;

    var dpr = mxGetDpr();
    var bw = Math.max(1, Math.round(cssW * dpr));
    var bh = Math.max(1, Math.round(cssH * dpr));
    var resized = false;
    try {
      if (mxCanvas.width !== bw) { mxCanvas.width = bw; resized = true; }
      if (mxCanvas.height !== bh) { mxCanvas.height = bh; resized = true; }
    } catch (e) { return; }

    if (!mxCtx) {
      try {
        mxCtx = mxCanvas.getContext ? mxCanvas.getContext('2d') : null;
      } catch (e) { mxCtx = null; }
      if (!mxCtx) return;
      try { mxCtx.imageSmoothingEnabled = false; } catch (e) { /* ignore */ }
      resized = true;
    }
    if (mxCanvas.style) {
      try { mxCanvas.style.imageRendering = 'pixelated'; } catch (e) { /* ignore */ }
    }

    if (resized || cssW !== mxCssW || cssH !== mxCssH) {
      mxCssW = cssW;
      mxCssH = cssH;
      mxBw = bw;
      mxBh = bh;
      mxBuildGrid();
    }
    if (!mxCols || !mxRows) return;

    mxCtx.fillStyle = PX_BG;
    mxCtx.fillRect(0, 0, mxBw, mxBh);
    mxDrawScene();
  }

  function mxDrawScene() {
    var kind = mxState.kind;

    mxDrawEmptyTiles();

    if (kind === 'clear' || kind === 'partly') {
      if (mxState.isDay) {
        mxDrawSun();
      } else {
        mxDrawStars();
        mxDrawMoon();
      }
    }

    if (kind === 'fog') mxDrawFog();

    mxDrawHorizon();

    if (kind === 'fog') return;

    if (mxCloudActive) mxDrawClouds();
    if (mxRainCount > 0) mxDrawRain();
    if (mxSnowCount > 0) mxDrawSnow();
    if (kind === 'thunder') mxDrawBolt();
  }

  /* ------------------------------------------------------------ lifecycle */

  function mxRequestFrame(cb) {
    try {
      if (typeof window !== 'undefined' && window && typeof window.requestAnimationFrame === 'function') {
        return window.requestAnimationFrame(cb);
      }
      if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
    } catch (e) { /* fall through */ }
    if (typeof setTimeout === 'function') {
      return setTimeout(function () { cb(mxNowSec() * 1000); }, 16);
    }
    return 0;
  }

  function mxCancelFrame(id) {
    if (!id) return;
    try {
      if (typeof window !== 'undefined' && window && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(id);
        return;
      }
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(id);
        return;
      }
    } catch (e) { /* ignore */ }
    if (typeof clearTimeout === 'function') clearTimeout(id);
  }

  function mxTick(ts) {
    if (!mxRunning || mxDisposed) return;
    var now = (typeof ts === 'number' && isFinite(ts)) ? ts / 1000 : mxNowSec();
    var dt = mxLast > 0 ? (now - mxLast) : 0.016;
    if (!(dt >= 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    mxLast = now;
    mxTime += dt;
    mxUpdate(dt);
    mxRender();
    if (mxRunning && !mxDisposed) mxRaf = mxRequestFrame(mxTick);
  }

  function mxStaticFrame() {
    if (mxDisposed) return;
    if (mxTime < 1) mxTime = 1.4;
    mxUpdate(0);
    mxRender();
  }

  function mxStart() {
    if (mxDisposed || mxUserStarted) return;
    mxUserStarted = true;
    if (mxReduced) {
      mxStaticFrame();
      return;
    }
    if (mxRunning) return;
    mxLast = 0;
    mxRunning = true;
    mxRaf = mxRequestFrame(mxTick);
  }

  function mxStop() {
    if (mxDisposed) return;
    mxUserStarted = false;
    mxRunning = false;
    if (mxRaf) {
      mxCancelFrame(mxRaf);
      mxRaf = 0;
    }
  }

  function mxSetReducedMotion(flag) {
    if (mxDisposed) return;
    var v = !!flag;
    if (v === mxReduced) return;
    mxReduced = v;
    if (!mxUserStarted) return;
    if (v) {
      mxRunning = false;
      if (mxRaf) {
        mxCancelFrame(mxRaf);
        mxRaf = 0;
      }
      mxStaticFrame();
    } else if (!mxRunning) {
      mxLast = 0;
      mxRunning = true;
      mxRaf = mxRequestFrame(mxTick);
    }
  }

  function mxDispose() {
    if (mxDisposed) return;
    mxDisposed = true;
    mxRunning = false;
    mxUserStarted = false;
    if (mxRaf) {
      mxCancelFrame(mxRaf);
      mxRaf = 0;
    }
    if (mxObserver) {
      try { mxObserver.disconnect(); } catch (e) { /* ignore */ }
      mxObserver = null;
    }
    if (mxMq && mxMqListener) {
      try {
        if (typeof mxMq.removeEventListener === 'function') mxMq.removeEventListener('change', mxMqListener);
        else if (typeof mxMq.removeListener === 'function') mxMq.removeListener(mxMqListener);
      } catch (e) { /* ignore */ }
    }
    mxMqListener = null;
    mxMq = null;
    if (mxResizeHandler && typeof window !== 'undefined' && window &&
        typeof window.removeEventListener === 'function') {
      try { window.removeEventListener('resize', mxResizeHandler); } catch (e) { /* ignore */ }
    }
    mxResizeHandler = null;
    if (mxCtx) {
      try { mxCtx.clearRect(0, 0, mxBw, mxBh); } catch (e) { /* ignore */ }
    }
    mxCtx = null;
    mxCanvas = null;
  }

  /* -------------------------------------------------------------- startup */

  function mxSetup() {
    try {
      if (typeof window !== 'undefined' && window && typeof window.matchMedia === 'function') {
        mxMq = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (mxMq) {
          mxReduced = !!mxMq.matches;
          mxMqListener = function (ev) { mxSetReducedMotion(!!(ev && ev.matches)); };
          if (typeof mxMq.addEventListener === 'function') mxMq.addEventListener('change', mxMqListener);
          else if (typeof mxMq.addListener === 'function') mxMq.addListener(mxMqListener);
        }
      }
    } catch (e) {
      mxMq = null;
    }

    mxResizeHandler = function () {
      if (mxDisposed) return;
      if (mxUserStarted && mxReduced) mxStaticFrame();
    };
    try {
      if (typeof ResizeObserver === 'function') {
        mxObserver = new ResizeObserver(mxResizeHandler);
        if (mxObserver && mxCanvas && typeof mxObserver.observe === 'function') {
          mxObserver.observe(mxCanvas);
        }
      }
    } catch (e) {
      mxObserver = null;
    }
    try {
      if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
        window.addEventListener('resize', mxResizeHandler);
      }
    } catch (e) { /* ignore */ }
  }

  function mxSetScene(scene) {
    if (mxDisposed) return;
    var s = (scene && typeof scene === 'object') ? scene : {};
    var kind = typeof s.kind === 'string' ? s.kind : 'cloudy';
    if (MX_KINDS.indexOf(kind) < 0) kind = 'cloudy';
    mxState.kind = kind;
    mxState.isDay = (s.isDay === false) ? false : true;
    mxState.intensity = mxClamp(mxNum(s.intensity, 0.5), 0, 1);
    mxState.wind = mxClamp(mxNum(s.wind, 8), -120, 120);

    mxConfigureClouds(kind);
    mxConfigureFog(kind);
    mxConfigureParticles(kind);
    mxConfigureStars();
    /* A partly-cloudy night keeps only a few dim stars: the cloud is the story,
       and a full star field would read as stray bright pixels. */
    mxStarDim = (kind === 'partly');
    if (mxStarDim && mxStarCount > 3) mxStarCount = 3;

    mxFlashStart = -1;
    mxLf = 0;
    if (kind === 'thunder') {
      mxFlashNext = mxTime + 3 + Math.random() * 4;
    }

    if (mxUserStarted && mxReduced) mxStaticFrame();
  }

  mxConfigureClouds('clear');
  mxConfigureFog('clear');
  mxConfigureStars();
  mxConfigureParticles('clear');
  mxSetup();

  return {
    setScene: mxSetScene,
    start: mxStart,
    stop: mxStop,
    dispose: mxDispose,
    setReducedMotion: mxSetReducedMotion
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createMatrixScene };