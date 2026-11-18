/**
 * The floating weather card (v3).
 *
 * Layout follows the reference sample: one dark glass card, and inside it a
 * left column whose upper part is the dot-matrix scene (dots sit directly on
 * the card, no inner panel) with the big current temperature underneath, and a
 * right column carrying place/live clock, the condition line, six 3-hourly
 * slots and three range-bar days.
 *
 * The card is deliberately dark glass regardless of app theme: the widget is a
 * piece of artwork floating over the user's wallpaper, so its palette is the
 * scene's own rather than the host theme tokens.
 */
const WX_CARD_W = 620
const WX_CARD_H = 280
const WX_CARD_MARGIN = 22
const WX_POS_KEY = 'dsh-weather-matrix:pos:v1'
const WX_UI_KEY = 'dsh-weather-matrix:ui:v1'
const WX_MIN_K = 0.8
const WX_MAX_K = 1.6
const WX_PILL_W = 292
const WX_PILL_H = 62
const WX_SIZE_PRESETS = [
  { key: 'compact', k: 0.84 },
  { key: 'normal', k: 1 },
  { key: 'large', k: 1.24 },
  { key: 'huge', k: 1.48 },
]
const WX_SIZE_LABELS = {
  zh: { compact: '紧凑', normal: '标准', large: '大', huge: '超大' },
  en: { compact: 'Compact', normal: 'Default', large: 'Large', huge: 'Extra large' },
}
const WX_UI_TEXT = {
  zh: { size: '自定义大小', minimize: '最小化', expand: '点击展开', fine: '也可拖动右下角微调' },
  en: { size: 'Resize', minimize: 'Minimize', expand: 'Click to expand', fine: 'or drag the bottom-right corner' },
}

/** Locale service handle, assigned by wxApply before the slot registers. */
let wxLocaleService = null
/** Memoized widget dictionaries (allocation-free per render). */
let wxDictCache = null

/** One design pixel, scaled by the card's current size factor. */
function wxS(px) {
  return 'calc(' + px + 'px * var(--wx-k))'
}

/** Largest size factor that still fits the viewport. */
function wxFitK() {
  const size = wxWindowSize()
  const byWidth = (size.w - WX_CARD_MARGIN * 2) / WX_CARD_W
  const byHeight = (size.h - WX_CARD_MARGIN * 2) / WX_CARD_H
  return Math.min(byWidth, byHeight)
}

/** Clamp a user-chosen size factor into the allowed range. */
function wxClampK(k) {
  const raw = Number(k)
  if (!Number.isFinite(raw)) return 1
  return Math.round(Math.min(WX_MAX_K, Math.max(WX_MIN_K, raw)) * 100) / 100
}

/** Effective factor: the user's choice capped so the card always fits the window. */
function wxEffK(userK) {
  const raw = Number(userK)
  const wanted = Number.isFinite(raw) ? Math.min(WX_MAX_K, Math.max(WX_MIN_K, raw)) : 1
  return Math.max(0.5, Math.min(wanted, wxFitK()))
}

function wxPad2(value) {
  const n = Math.round(Number(value) || 0)
  return n < 10 ? '0' + n : String(n)
}

/** Keep a box of w x h inside the viewport (margin included). */
function wxClampBox(x, y, w, h) {
  const size = wxWindowSize()
  const maxX = Math.max(WX_CARD_MARGIN, size.w - w - WX_CARD_MARGIN)
  const maxY = Math.max(WX_CARD_MARGIN, size.h - h - WX_CARD_MARGIN)
  return {
    x: Math.round(Math.min(Math.max(WX_CARD_MARGIN, Number(x) || 0), maxX)),
    y: Math.round(Math.min(Math.max(WX_CARD_MARGIN, Number(y) || 0), maxY)),
  }
}

/** First-run position: top-right corner, below any native/host title bar. */
function wxDefaultPos(w, h) {
  const size = wxWindowSize()
  return wxClampBox(size.w - w - WX_CARD_MARGIN, WX_CARD_MARGIN + 40, w, h)
}

/** Persisted size factor + minimized flag. */
function wxLoadUi() {
  const fallback = { k: 1, mini: false }
  try {
    if (typeof localStorage === 'undefined') return fallback
    const raw = localStorage.getItem(WX_UI_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return fallback
    return { k: wxClampK(parsed.k), mini: parsed.mini === true }
  } catch (error) {
    return fallback
  }
}

function wxStoreUi(ui) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(WX_UI_KEY, JSON.stringify({ k: wxClampK(ui.k), mini: ui.mini === true }))
  } catch (error) { /* remember-failure is harmless */ }
}

/** Current wall clock in the weather place's timezone, as 'HH:MM'. */
function wxPlaceClock(timeZone) {
  const current = new Date()
  try {
    const text = new Intl.DateTimeFormat('en-GB', {
      timeZone: typeof timeZone === 'string' && timeZone ? timeZone : undefined,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(current)
    const match = /^(\d{2}):(\d{2})/.exec(text)
    if (match) return match[1] + ':' + match[2]
  } catch (error) { /* fall through to browser local time */ }
  return wxPad2(current.getHours()) + ':' + wxPad2(current.getMinutes())
}

function wxDicts() {
  if (!wxDictCache) {
    try {
      wxDictCache = wxLocaleDicts()
    } catch (error) {
      wxDictCache = { en: {}, zh: {} }
    }
  }
  return wxDictCache
}

function wxT(lang, key) {
  const dicts = wxDicts()
  const dict = dicts[lang] || dicts.en || {}
  const value = dict[key]
  if (typeof value === 'string' && value.length > 0) return value
  return WX_TEXT_FALLBACK[key] || key
}

function wxCodeLabel(code, lang) {
  try {
    const info = wxDescribeCode(code)
    return (lang === 'zh' ? info.zh : info.en) || info.zh || ''
  } catch (error) {
    return ''
  }
}

/** Icon id for a weather code, with the night variants when the data layer provides them. */
function wxIconForSafe(code, isDay) {
  try {
    if (typeof wxIconFor === 'function') return wxIconFor(code, isDay)
  } catch (error) { /* fall through */ }
  try {
    return wxDescribeCode(code).icon
  } catch (error) {
    return 'cloudy'
  }
}

function wxActiveLang() {
  try {
    const service = wxLocaleService
    if (service && typeof service.getLocale === 'function') {
      const snapshot = service.getLocale()
      return wxResolveLang(snapshot && snapshot.active)
    }
  } catch (error) { /* locale service unavailable: fall through to the browser */ }
  try {
    if (typeof navigator !== 'undefined' && navigator) return wxResolveLang(navigator.language)
  } catch (error) { /* ignore */ }
  return 'zh'
}

/** Re-render when the app locale changes, so every label follows the user's language. */
function wxUseLang() {
  const [lang, setLang] = React.useState(wxActiveLang)
  React.useEffect(() => {
    const service = wxLocaleService
    if (!service || typeof service.subscribe !== 'function') return undefined
    const off = service.subscribe(() => setLang(wxActiveLang()))
    return () => { if (typeof off === 'function') off() }
  }, [])
  return lang
}

/** Re-render every 30s so the live clock stays honest. */
function wxUseClockTick() {
  const [, tick] = React.useState(0)
  React.useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30000)
    return () => clearInterval(id)
  }, [])
}

function wxWindowSize() {
  const fallback = { w: 1440, h: 900 }
  try {
    if (typeof window === 'undefined' || !window) return fallback
    return { w: Math.max(360, window.innerWidth || 0), h: Math.max(300, window.innerHeight || 0) }
  } catch (error) {
    return fallback
  }
}

function wxLoadPos() {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(WX_POS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null
    return { x: parsed.x, y: parsed.y }
  } catch (error) {
    return null
  }
}

function wxStorePos(pos) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(WX_POS_KEY, JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) }))
  } catch (error) { /* remember-failure is harmless */ }
}

/** Scene description for the matrix engine, tolerant of missing/partial payloads. */
function wxSceneFor(state) {
  const data = state && state.data && state.data.ok !== false ? state.data : null
  if (data) {
    try {
      const scene = wxSceneOf(data)
      if (scene && scene.kind) {
        return {
          kind: scene.kind || 'cloudy',
          isDay: scene.isDay !== false,
          intensity: typeof scene.intensity === 'number' ? scene.intensity : 0.25,
          wind: typeof scene.wind === 'number' ? scene.wind : 0,
        }
      }
    } catch (error) { /* fall through to the placeholder scene */ }
  }
  if (state && state.status === 'error') {
    return { kind: 'overcast', isDay: true, intensity: 0.15, wind: 0 }
  }
  return { kind: 'cloudy', isDay: true, intensity: 0.12, wind: 0 }
}

function wxLocalClock(ms) {
  const stamp = Number(ms)
  if (!Number.isFinite(stamp) || stamp <= 0) return ''
  try {
    const date = new Date(stamp)
    return wxPad2(date.getHours()) + ':' + wxPad2(date.getMinutes())
  } catch (error) {
    return ''
  }
}

const WX_TEXT_FALLBACK = {
  'app.title': '天气矩阵',
  now: '现在',
  today: '今天',
  tomorrow: '明天',
  feels: '体感',
  precip: '降水',
  wind: '风力',
  live: 'Live',
  loading: '正在获取天气…',
  offline: '天气数据暂不可用',
  retry: '点击重试',
  updated: '更新于',
  stale: '网络不稳定，显示上次数据',
  'unit.kmh': 'km/h',
  'unit.percent': '%',
  drag: '拖动移动',
  refresh: '点击刷新',
  'city.search': '输入城市名',
  'city.auto': '使用自动定位',
  'city.loading': '搜索中…',
  'city.empty': '没有找到匹配的城市',
  'city.error': '搜索失败，请重试',
  'city.cancel': '取消',
  'city.pinned': '已固定',
}

const WX_CSS = WX_FONT_CSS + `
.wx-root{position:fixed;z-index:45;pointer-events:auto;user-select:none;-webkit-user-select:none;touch-action:none;font-family:'WXNunito','YouYuan','幼圆','Microsoft YaHei','PingFang SC',sans-serif;color:#f5f6f8;line-height:1.2;--wx-k:1;}
.wx-card{position:relative;display:flex;gap:${wxS(16)};width:${wxS(620)};height:${wxS(280)};box-sizing:border-box;padding:${wxS(16)};border-radius:${wxS(22)};border:1px solid rgba(255,255,255,.085);background:linear-gradient(155deg,rgba(24,24,29,.93) 0%,rgba(13,13,16,.90) 55%,rgba(9,9,11,.92) 100%);box-shadow:0 26px 70px -22px rgba(0,0,0,.8),0 2px 6px rgba(0,0,0,.25),inset 0 1px 0 rgba(255,255,255,.06);-webkit-backdrop-filter:blur(22px) saturate(1.25);backdrop-filter:blur(22px) saturate(1.25);transition:border-color .22s ease,box-shadow .22s ease;cursor:grab;}
.wx-root:hover .wx-card{border-color:rgba(255,255,255,.14);}
.wx-root.wx-dragging .wx-card{cursor:grabbing;}
.wx-left{position:relative;flex:0 0 ${wxS(236)};height:100%;border-radius:${wxS(14)};overflow:hidden;background:#0b0b10;}
.wx-canvas-wrap{position:absolute;inset:0;}
.wx-canvas{display:block;width:100%;height:100%;image-rendering:pixelated;image-rendering:crisp-edges;}
.wx-tempblock{position:absolute;left:${wxS(12)};bottom:${wxS(8)};display:flex;align-items:flex-end;pointer-events:none;}
.wx-temp{font-family:'WXNunito','YouYuan','幼圆',sans-serif;font-size:${wxS(26)};line-height:.9;font-weight:800;letter-spacing:-.3px;color:#f2f3f5;font-variant-numeric:tabular-nums;text-shadow:0 2px 10px rgba(0,0,0,.6);}
.wx-deg{font-size:${wxS(13)};font-weight:700;letter-spacing:0;vertical-align:top;}
.wx-cond{position:absolute;right:${wxS(12)};bottom:${wxS(10)};font-size:${wxS(12.5)};font-weight:600;color:#e7e8ec;letter-spacing:.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:${wxS(132)};text-shadow:0 2px 10px rgba(0,0,0,.55);pointer-events:none;}
.wx-badge{position:absolute;top:${wxS(10)};left:${wxS(10)};font-size:${wxS(10.5)};color:rgba(245,246,248,.78);padding:${wxS(2)} ${wxS(8)};background:rgba(10,10,12,.62);border:1px solid rgba(255,255,255,.08);border-radius:99px;}
.wx-info{position:relative;flex:1 1 auto;min-width:0;display:flex;flex-direction:column;height:100%;}
.wx-head{display:flex;align-items:center;justify-content:space-between;gap:${wxS(10)};}
.wx-place-btn{display:flex;align-items:center;gap:${wxS(5)};max-width:${wxS(200)};margin:0;padding:${wxS(1)} ${wxS(4)};background:transparent;border:0;border-radius:${wxS(6)};color:#f5f6f8;font:inherit;font-size:${wxS(17)};font-weight:700;letter-spacing:.2px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.wx-place-btn:hover{background:rgba(255,255,255,.07);}
.wx-place-btn:focus-visible{outline:1px solid rgba(95,208,255,.6);outline-offset:1px;}
.wx-place-caret{font-size:${wxS(9)};line-height:1;color:rgba(245,246,248,.45);flex:0 0 auto;}
.wx-live{display:flex;align-items:center;gap:${wxS(6)};font-size:${wxS(11)};color:rgba(245,246,248,.5);white-space:nowrap;}
.wx-dot{width:${wxS(7)};height:${wxS(7)};border-radius:50%;background:#3ad07d;box-shadow:0 0 8px rgba(58,208,125,.85);flex:0 0 auto;}
.wx-dot-stale{background:#e8b04b;box-shadow:0 0 8px rgba(232,176,75,.75);}
.wx-dot-idle{background:rgba(255,255,255,.32);box-shadow:none;}
.wx-clock{font-variant-numeric:tabular-nums;color:rgba(245,246,248,.72);}
.wx-meta{margin-top:${wxS(5)};font-size:${wxS(12)};color:rgba(245,246,248,.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.wx-hours{display:flex;margin-top:${wxS(14)};}
.wx-hour{flex:1 1 0;display:flex;flex-direction:column;align-items:center;gap:${wxS(6)};}
.wx-hour-label{font-size:${wxS(11)};color:rgba(245,246,248,.46);font-variant-numeric:tabular-nums;}
.wx-hour-now .wx-hour-label{color:rgba(245,246,248,.82);}
.wx-hour-temp{font-size:${wxS(13)};color:rgba(245,247,250,.9);font-variant-numeric:tabular-nums;}
.wx-days{margin-top:auto;padding-top:${wxS(8)};border-top:1px solid rgba(255,255,255,.07);}
.wx-day{display:flex;align-items:center;gap:${wxS(8)};height:${wxS(29)};}
.wx-day-label{min-width:${wxS(40)};font-size:${wxS(12)};color:rgba(245,246,248,.82);white-space:nowrap;flex:0 0 auto;}
.wx-day-low{width:${wxS(27)};text-align:right;font-size:${wxS(12)};color:rgba(245,246,248,.5);font-variant-numeric:tabular-nums;}
.wx-day-high{width:${wxS(27)};text-align:right;font-size:${wxS(12)};color:rgba(245,247,250,.92);font-variant-numeric:tabular-nums;}
.wx-track{flex:1 1 auto;display:flex;align-items:center;gap:${wxS(2)};height:${wxS(8)};}
.wx-seg{flex:1 1 0;height:${wxS(6)};border-radius:${wxS(1.5)};background:rgba(255,255,255,.09);}
.wx-seg-on{background:linear-gradient(180deg,#7fe3ff,#1fa6df);box-shadow:0 0 6px rgba(53,201,255,.35);}
.wx-seg-end{background:#eef6ff;}
.wx-empty{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${wxS(7)};text-align:center;padding-bottom:${wxS(8)};}
.wx-empty-title{font-size:${wxS(13)};color:rgba(245,246,248,.82);}
.wx-empty-sub{font-size:${wxS(11)};color:rgba(245,246,248,.45);}
.wx-pulse{animation:wx-pulse 1.9s ease-in-out infinite;}
@keyframes wx-pulse{0%,100%{opacity:.5}50%{opacity:1}}
.wx-hint{position:absolute;left:50%;transform:translateX(-50%);font-size:${wxS(11)};color:rgba(245,246,248,.6);background:rgba(12,12,15,.8);border:1px solid rgba(255,255,255,.07);border-radius:99px;padding:${wxS(4)} ${wxS(10)};white-space:nowrap;pointer-events:none;}
.wx-hint-below{top:calc(100% + ${wxS(8)});}
.wx-hint-above{bottom:calc(100% + ${wxS(8)});}
.wx-city-pop{position:absolute;top:${wxS(28)};left:0;width:${wxS(300)};box-sizing:border-box;padding:${wxS(8)};border-radius:${wxS(12)};background:rgba(15,15,19,.975);border:1px solid rgba(255,255,255,.1);box-shadow:0 20px 44px -12px rgba(0,0,0,.85);z-index:6;}
.wx-city-head{display:flex;gap:${wxS(6)};}
.wx-city-input{flex:1 1 auto;min-width:0;height:${wxS(30)};box-sizing:border-box;border-radius:${wxS(8)};border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#f5f6f8;font:inherit;font-size:${wxS(12.5)};padding:0 ${wxS(9)};outline:none;}
.wx-city-input:focus{border-color:rgba(95,208,255,.55);}
.wx-city-input::placeholder{color:rgba(245,246,248,.35);}
.wx-city-cancel{height:${wxS(30)};padding:0 ${wxS(8)};border-radius:${wxS(8)};border:1px solid rgba(255,255,255,.1);background:transparent;color:rgba(245,246,248,.6);font:inherit;font-size:${wxS(11.5)};cursor:pointer;}
.wx-city-cancel:hover{color:#f5f6f8;}
.wx-city-list{margin-top:${wxS(6)};max-height:${wxS(148)};overflow:auto;}
.wx-city-row{display:block;width:100%;text-align:left;border:0;background:transparent;border-radius:${wxS(8)};padding:${wxS(6)} ${wxS(8)};cursor:pointer;font:inherit;color:#f5f6f8;}
.wx-city-row:hover{background:rgba(255,255,255,.07);}
.wx-city-name{font-size:${wxS(12.5)};}
.wx-city-region{margin-left:${wxS(6)};font-size:${wxS(10.5)};color:rgba(245,246,248,.45);}
.wx-city-hint{padding:${wxS(6)} ${wxS(8)};font-size:${wxS(11)};color:rgba(245,246,248,.45);}
.wx-city-foot{margin-top:${wxS(6)};padding-top:${wxS(6)};border-top:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:space-between;gap:${wxS(8)};}
.wx-city-auto{padding:0;border:0;background:transparent;color:#5fd0ff;font:inherit;font-size:${wxS(11.5)};cursor:pointer;}
.wx-city-auto:hover{color:#9be3ff;}
.wx-city-pinned{font-size:${wxS(10.5)};color:rgba(245,246,248,.4);}
.wx-root.wx-root-mini{--wx-k:1;}
.wx-tools{position:absolute;top:${wxS(-13)};right:${wxS(10)};display:flex;align-items:center;gap:${wxS(5)};z-index:9;opacity:0;pointer-events:none;transition:opacity .16s ease;}
.wx-root:hover .wx-tools{opacity:1;pointer-events:auto;}
.wx-tool{width:${wxS(22)};height:${wxS(22)};padding:0;border-radius:${wxS(7)};border:1px solid rgba(255,255,255,.13);background:rgba(14,14,18,.82);color:rgba(245,246,248,.72);font:inherit;font-size:${wxS(12)};line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);}
.wx-tool:hover{color:#fff;border-color:rgba(255,255,255,.26);background:rgba(30,30,38,.92);}
.wx-sizes{position:absolute;top:calc(100% + ${wxS(6)});right:0;width:${wxS(172)};box-sizing:border-box;padding:${wxS(6)};border-radius:${wxS(10)};background:rgba(15,15,19,.975);border:1px solid rgba(255,255,255,.1);box-shadow:0 18px 40px -12px rgba(0,0,0,.85);z-index:10;}
.wx-size-item{display:flex;align-items:center;justify-content:space-between;width:100%;padding:${wxS(5)} ${wxS(7)};border:0;border-radius:${wxS(7)};background:transparent;color:#f5f6f8;font:inherit;font-size:${wxS(12)};cursor:pointer;text-align:left;}
.wx-size-item:hover{background:rgba(255,255,255,.07);}
.wx-size-item-on{color:#7fe3ff;}
.wx-size-hint{margin-top:${wxS(4)};padding:${wxS(5)} ${wxS(7)} 0;border-top:1px solid rgba(255,255,255,.07);font-size:${wxS(10)};color:rgba(245,246,248,.42);line-height:1.4;}
.wx-grip{position:absolute;right:${wxS(2)};bottom:${wxS(2)};width:${wxS(18)};height:${wxS(18)};cursor:nwse-resize;opacity:0;transition:opacity .16s ease;z-index:8;touch-action:none;}
.wx-root:hover .wx-grip{opacity:.85;}
.wx-grip:after{content:'';position:absolute;right:${wxS(4)};bottom:${wxS(4)};width:${wxS(8)};height:${wxS(8)};border-right:2px solid rgba(245,246,248,.42);border-bottom:2px solid rgba(245,246,248,.42);}
.wx-pill{position:relative;display:flex;align-items:center;gap:${wxS(10)};box-sizing:border-box;width:100%;height:100%;padding:${wxS(8)} ${wxS(14)} ${wxS(8)} ${wxS(8)};border-radius:${wxS(999)};border:1px solid rgba(255,255,255,.09);background:linear-gradient(155deg,rgba(24,24,29,.94) 0%,rgba(13,13,16,.92) 60%,rgba(9,9,11,.94) 100%);box-shadow:0 18px 44px -16px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,255,255,.06);-webkit-backdrop-filter:blur(20px) saturate(1.2);backdrop-filter:blur(20px) saturate(1.2);cursor:grab;}
.wx-pill:hover{border-color:rgba(255,255,255,.16);}
.wx-root.wx-dragging .wx-pill{cursor:grabbing;}
.wx-pill-canvaswrap{position:relative;width:${wxS(58)};height:${wxS(46)};flex:0 0 auto;border-radius:${wxS(13)};overflow:hidden;background:#0b0b10;box-shadow:inset 0 0 0 1px rgba(255,255,255,.05),inset 0 0 18px rgba(0,0,0,.35);}
.wx-pill-canvas{display:block;width:100%;height:100%;image-rendering:pixelated;image-rendering:crisp-edges;}
.wx-pill-icon{display:flex;align-items:center;justify-content:center;width:100%;height:100%;}
.wx-pill-main{display:flex;flex-direction:column;gap:${wxS(2)};min-width:0;flex:1 1 auto;}
.wx-pill-temp{font-family:'WXNunito','YouYuan','幼圆',sans-serif;font-size:${wxS(24)};font-weight:800;line-height:1;font-variant-numeric:tabular-nums;}
.wx-pill-temp .wx-deg{font-size:${wxS(13)};}
.wx-pill-sub{display:flex;align-items:center;gap:${wxS(4)};font-size:${wxS(10.5)};color:rgba(245,246,248,.58);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.wx-pill-live{display:flex;align-items:center;gap:${wxS(4)};font-size:${wxS(10)};color:rgba(245,246,248,.5);flex:0 0 auto;}
.wx-pill-live .wx-dot{width:${wxS(6)};height:${wxS(6)};}
.wx-pill-clock{font-variant-numeric:tabular-nums;color:rgba(245,246,248,.55);}
.wx-pill-chevron{font-size:${wxS(15)};line-height:1;color:rgba(245,246,248,.4);opacity:0;transform:translateX(-2px);transition:opacity .16s ease,transform .16s ease;flex:0 0 auto;}
.wx-pill:hover .wx-pill-chevron{opacity:.9;transform:translateX(0);}
`

function WeatherWidget() {
  const lang = wxUseLang()
  wxUseClockTick()

  const [state, setState] = React.useState({ status: 'loading', data: null, error: null, fetchedAt: 0 })
  const [ui, setUi] = React.useState(wxLoadUi)
  const [sizeOpen, setSizeOpen] = React.useState(false)
  const [, setViewportTick] = React.useState(0)
  const effK = wxEffK(ui.k)
  const cardW = Math.round(WX_CARD_W * effK)
  const cardH = Math.round(WX_CARD_H * effK)
  const boxW = ui.mini ? WX_PILL_W : cardW
  const boxH = ui.mini ? WX_PILL_H : cardH
  const [pos, setPos] = React.useState(() => {
    const loaded = wxLoadPos()
    return loaded ? wxClampBox(loaded.x, loaded.y, boxW, boxH) : wxDefaultPos(boxW, boxH)
  })
  const [dragging, setDragging] = React.useState(false)
  const [hovering, setHovering] = React.useState(false)
  const [cityOpen, setCityOpen] = React.useState(false)
  const [cityQuery, setCityQuery] = React.useState('')
  const [cityResults, setCityResults] = React.useState([])
  const [cityBusy, setCityBusy] = React.useState(false)
  const [cityError, setCityError] = React.useState('')

  const uiText = WX_UI_TEXT[lang] || WX_UI_TEXT.zh
  const sizeLabels = WX_SIZE_LABELS[lang] || WX_SIZE_LABELS.zh

  const posRef = React.useRef(pos)
  posRef.current = pos
  const uiRef = React.useRef(ui)
  uiRef.current = ui
  const sizeOpenRef = React.useRef(sizeOpen)
  sizeOpenRef.current = sizeOpen
  const boxRef = React.useRef({ w: boxW, h: boxH })
  boxRef.current = { w: boxW, h: boxH }
  const busyRef = React.useRef(false)
  const reloadRef = React.useRef(null)
  const canvasRef = React.useRef(null)
  const sceneRef = React.useRef(null)
  const pillCanvasRef = React.useRef(null)
  const pillSceneRef = React.useRef(null)
  const dragDetachRef = React.useRef(null)
  const citySeqRef = React.useRef(0)

  const updateUi = (patch) => {
    setUi((current) => {
      const next = { k: current.k, mini: current.mini }
      if (patch && typeof patch === 'object') {
        if (typeof patch.k === 'number') next.k = wxClampK(patch.k)
        if (typeof patch.mini === 'boolean') next.mini = patch.mini
      }
      wxStoreUi(next)
      return next
    })
  }

  const scene = wxSceneFor(state)
  const sceneRefObj = React.useRef(scene)
  sceneRefObj.current = scene

  // Load weather on mount, then refresh quietly in the background.
  React.useEffect(() => {
    let alive = true
    const load = async (force) => {
      if (busyRef.current) return
      busyRef.current = true
      try {
        const result = await wxFetchWeather({ force: force === true })
        if (!alive) return
        setState({
          status: result && result.status ? result.status : 'error',
          data: result && result.data ? result.data : null,
          error: result && result.error ? result.error : null,
          fetchedAt: (result && result.fetchedAt) || Date.now(),
        })
      } catch (error) {
        if (alive) setState({ status: 'error', data: null, error: { code: 'CLIENT', message: String(error && error.message ? error.message : error) }, fetchedAt: Date.now() })
      } finally {
        busyRef.current = false
      }
    }
    reloadRef.current = load
    load(false)
    // Force past the server-side 10-minute cache so a scheduled refresh really
    // pulls a new upstream forecast instead of re-reading the same cache entry.
    const timer = setInterval(() => load(true), WX_REFRESH_MS)
    const onVisibility = () => {
      try {
        if (typeof document !== 'undefined' && !document.hidden) load(false)
      } catch (error) { /* ignore */ }
    }
    try {
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
    } catch (error) { /* ignore */ }
    return () => {
      alive = false
      clearInterval(timer)
      reloadRef.current = null
      try {
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
      } catch (error) { /* ignore */ }
    }
  }, [])

  // Debounced city search while the picker is open.
  React.useEffect(() => {
    if (!cityOpen) return undefined
    const query = cityQuery.trim()
    const seq = citySeqRef.current + 1
    citySeqRef.current = seq
    if (query.length < 1) {
      setCityResults([])
      setCityBusy(false)
      setCityError('')
      return undefined
    }
    setCityBusy(true)
    setCityError('')
    const timer = setTimeout(async () => {
      let response = null
      try {
        response = await wxSearchPlaces(query, { lang })
      } catch (error) {
        response = { ok: false, results: [], error: { code: 'CLIENT', message: String(error && error.message ? error.message : error) } }
      }
      if (seq !== citySeqRef.current) return
      setCityBusy(false)
      if (response && response.ok) {
        setCityResults(Array.isArray(response.results) ? response.results : [])
        setCityError('')
      } else {
        setCityResults([])
        setCityError(wxT(lang, 'city.error'))
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [cityOpen, cityQuery, lang])

  // Own the canvas scene for as long as the card is mounted.
  React.useEffect(() => {
    if (ui.mini) return undefined
    const canvas = canvasRef.current
    if (!canvas || typeof createMatrixScene !== 'function') return undefined
    let instance = null
    try {
      instance = createMatrixScene(canvas)
      sceneRef.current = instance
      instance.setScene(sceneRefObj.current)
      instance.start()
    } catch (error) {
      instance = null
    }
    return () => {
      sceneRef.current = null
      if (instance && typeof instance.dispose === 'function') {
        try { instance.dispose() } catch (error) { /* ignore */ }
      }
    }
  }, [ui.mini])

  // The minimized pill gets its own tiny scene (9x7 lattice) while it is shown.
  React.useEffect(() => {
    if (!ui.mini) return undefined
    const canvas = pillCanvasRef.current
    if (!canvas || typeof createMatrixScene !== 'function') return undefined
    let instance = null
    try {
      instance = createMatrixScene(canvas, { mini: true, cols: 9, rows: 7 })
      pillSceneRef.current = instance
      instance.setScene(sceneRefObj.current)
      instance.start()
    } catch (error) {
      instance = null
    }
    return () => {
      pillSceneRef.current = null
      if (instance && typeof instance.dispose === 'function') {
        try { instance.dispose() } catch (error) { /* ignore */ }
      }
    }
  }, [ui.mini])

  // Push scene changes (weather kind / day / intensity / wind) into the engines.
  React.useEffect(() => {
    const targets = [sceneRef.current, pillSceneRef.current]
    for (let i = 0; i < targets.length; i += 1) {
      const instance = targets[i]
      if (!instance || typeof instance.setScene !== 'function') continue
      try { instance.setScene(scene) } catch (error) { /* ignore */ }
    }
  }, [scene.kind, scene.isDay, scene.intensity, scene.wind, ui.mini])

  // Keep the card inside the viewport when the window resizes, and re-clamp
  // when the card changes size (custom size or minimize/expand).
  React.useEffect(() => {
    const onResize = () => {
      setViewportTick((tick) => tick + 1)
      setPos((current) => wxClampBox(current.x, current.y, boxRef.current.w, boxRef.current.h))
    }
    try {
      window.addEventListener('resize', onResize)
    } catch (error) { /* ignore */ }
    return () => {
      try { window.removeEventListener('resize', onResize) } catch (error) { /* ignore */ }
    }
  }, [])

  React.useEffect(() => {
    setPos((current) => wxClampBox(current.x, current.y, boxRef.current.w, boxRef.current.h))
  }, [effK, ui.mini])

  // A drag that is still armed when the card unmounts must not leave window
  // listeners (or a post-unmount setState) behind.
  React.useEffect(() => () => {
    const detach = dragDetachRef.current
    dragDetachRef.current = null
    if (typeof detach === 'function') {
      try { detach() } catch (error) { /* ignore */ }
    }
  }, [])

  const handlePointerDown = (event) => {
    if (!event || event.button !== 0) return
    const startX = event.clientX
    const startY = event.clientY
    const origin = posRef.current
    let moved = false
    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      if (!moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        moved = true
        setDragging(true)
      }
      if (moved) {
        setPos(wxClampBox(
          origin.x + dx,
          origin.y + dy,
          boxRef.current.w,
          boxRef.current.h,
        ))
      }
    }
    const detach = () => {
      try {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
      } catch (error) { /* ignore */ }
      if (dragDetachRef.current === detach) dragDetachRef.current = null
    }
    const finish = () => {
      detach()
      if (moved) {
        setDragging(false)
        setPos((current) => { wxStorePos(current); return current })
      } else if (uiRef.current.mini) {
        // A plain click on the pill expands the card again.
        updateUi({ mini: false })
      } else if (sizeOpenRef.current) {
        // A click outside the size menu closes it instead of refreshing.
        setSizeOpen(false)
      } else if (cityOpen) {
        // A click outside the picker closes it instead of refreshing.
        closeCity()
      } else if (reloadRef.current) {
        reloadRef.current(true)
      }
    }
    dragDetachRef.current = detach
    try {
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
    } catch (error) { /* ignore */ }
  }

  /** Corner grip: drag to change the size factor (uniform scale). */
  const handleGripDown = (event) => {
    if (!event || event.button !== 0) return
    stopEvent(event)
    if (event.preventDefault) event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const startK = uiRef.current.k
    let active = false
    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      const dw = Math.max(dx, dy * (WX_CARD_W / WX_CARD_H))
      if (!active && Math.abs(dw) < 2) return
      active = true
      updateUi({ k: wxClampK(startK + dw / WX_CARD_W) })
    }
    const detach = () => {
      try {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
      } catch (error) { /* ignore */ }
      if (dragDetachRef.current === detach) dragDetachRef.current = null
    }
    const finish = () => {
      detach()
      setPos((current) => wxClampBox(current.x, current.y, boxRef.current.w, boxRef.current.h))
    }
    dragDetachRef.current = detach
    try {
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
    } catch (error) { /* ignore */ }
  }

  const stopEvent = (event) => {
    if (!event) return
    if (event.stopPropagation) event.stopPropagation()
  }

  const minimizeCard = () => {
    setSizeOpen(false)
    setCityOpen(false)
    updateUi({ mini: true })
  }

  const applyPreset = (k) => {
    updateUi({ k: wxClampK(k) })
    setSizeOpen(false)
  }

  const closeCity = () => {
    setCityOpen(false)
    setCityQuery('')
    setCityResults([])
    setCityBusy(false)
    setCityError('')
  }

  const selectCity = (item) => {
    if (!item) return
    try {
      if (typeof wxWritePlace === 'function') {
        wxWritePlace({
          name: item.name,
          latitude: item.latitude,
          longitude: item.longitude,
          timezone: item.timezone,
        })
      }
    } catch (error) { /* ignore */ }
    closeCity()
    if (reloadRef.current) reloadRef.current(true)
  }

  const useAutoPlace = () => {
    try {
      if (typeof wxClearPlace === 'function') wxClearPlace()
    } catch (error) { /* ignore */ }
    closeCity()
    if (reloadRef.current) reloadRef.current(true)
  }

  const data = state.data && state.data.ok !== false ? state.data : null
  const now = data && data.now ? data.now : null
  const placeName = data && data.place && data.place.name ? data.place.name : '—'
  const liveClock = wxPlaceClock(data && data.place ? data.place.timezone : undefined)
  const liveDotClass = 'wx-dot' + (state.status === 'ok'
    ? ''
    : (state.status === 'stale' ? ' wx-dot-stale' : ' wx-dot-idle'))
  const tempText = now ? String(Math.round(Number(now.temp))) : '--'
  // The scene caption and the meta line only exist once there is data; the
  // loading/offline message is owned by the empty block so it appears once.
  const condition = now ? wxCodeLabel(now.code, lang) : ''
  const meta = now
    ? [
      wxT(lang, 'feels') + ' ' + Math.round(Number(now.feels)) + '°',
      wxT(lang, 'precip') + ' ' + Math.round(Number(now.pop || 0)) + wxT(lang, 'unit.percent'),
      wxT(lang, 'wind') + ' ' + Math.round(Number(now.wind || 0)) + ' ' + wxT(lang, 'unit.kmh'),
    ].join(' · ')
    : ''

  // Small cards drop two hourly slots instead of squeezing all six.
  const hourCount = cardW < 520 ? 4 : 6
  const hours = data && Array.isArray(data.hourly) ? data.hourly.slice(0, hourCount) : []
  const days = data && Array.isArray(data.daily) ? data.daily.slice(0, 3) : []
  const weekMin = days.length ? Math.min.apply(null, days.map((day) => Number(day.min))) : 0
  const weekMax = days.length ? Math.max.apply(null, days.map((day) => Number(day.max))) : 1
  const weekSpan = Math.max(1, weekMax - weekMin)

  const hourlyRow = hours.length
    ? h('div', { className: 'wx-hours' }, hours.map((hour, index) => {
      const temperature = index === 0 && now ? now.temp : hour.temp
      return h('div', { className: 'wx-hour' + (index === 0 ? ' wx-hour-now' : ''), key: 'hour' + index },
        h('div', { className: 'wx-hour-label' }, wxHourLabel(hour.time, index, lang)),
        h(WeatherIcon, {
          // The "now" slot follows the CURRENT observation, not the forecast
          // hour boundary, so its icon always matches the condition label.
          kind: index === 0 && now
            ? wxIconForSafe(now.code, now.isDay !== false)
            : wxIconForSafe(hour.code, hour.isDay !== false),
          size: Math.max(14, Math.round(26 * effK)),
        }),
        h('div', { className: 'wx-hour-temp' }, Math.round(Number(temperature)) + '°'),
      )
    }))
    : null

  const WX_BAR_SEGMENTS = 14

  const dailyBlock = days.length
    ? h('div', { className: 'wx-days' }, days.map((day, index) => {
      const low = Number(day.min)
      const high = Number(day.max)
      const segments = []
      let lastActive = -1
      for (let si = 0; si < WX_BAR_SEGMENTS; si += 1) {
        const value = weekMin + ((si + 0.5) / WX_BAR_SEGMENTS) * weekSpan
        if (value >= low - 0.001 && value <= high + 0.001) lastActive = si
      }
      for (let si = 0; si < WX_BAR_SEGMENTS; si += 1) {
        const value = weekMin + ((si + 0.5) / WX_BAR_SEGMENTS) * weekSpan
        const active = value >= low - 0.001 && value <= high + 0.001
        segments.push(h('span', {
          key: 'seg' + si,
          className: 'wx-seg' + (active ? ' wx-seg-on' : '') + (si === lastActive ? ' wx-seg-end' : ''),
        }))
      }
      return h('div', { className: 'wx-day', key: 'day' + index },
        h('div', { className: 'wx-day-label' }, wxDayLabel(day.date, index, lang)),
        h(WeatherIcon, { kind: wxIconForSafe(day.code, true), size: Math.max(12, Math.round(22 * effK)) }),
        h('div', { className: 'wx-day-low' }, Math.round(low) + '°'),
        h('div', { className: 'wx-track' }, segments),
        h('div', { className: 'wx-day-high' }, Math.round(high) + '°'),
      )
    }))
    : null

  const emptyMessage = state.status === 'error' && state.error && state.error.message
    ? String(state.error.message)
    : ''
  const emptyBlock = !data
    ? h('div', { className: 'wx-empty' },
      h('div', { className: 'wx-empty-title wx-pulse' }, state.status === 'error' ? wxT(lang, 'offline') : wxT(lang, 'loading')),
      h('div', { className: 'wx-empty-sub' }, state.status === 'error'
        ? (lang === 'zh' && emptyMessage ? emptyMessage + ' · ' + wxT(lang, 'retry') : wxT(lang, 'retry'))
        : ''),
    )
    : null

  const pinned = (() => {
    try {
      return typeof wxReadPlace === 'function' ? !!wxReadPlace() : false
    } catch (error) {
      return false
    }
  })()

  const cityRows = cityResults.length
    ? cityResults.map((item, index) => {
      const region = [item.admin1, item.country].filter(Boolean).join(' · ')
      return h('button', {
        className: 'wx-city-row',
        key: 'city' + index,
        type: 'button',
        onClick: () => selectCity(item),
      },
        h('span', { className: 'wx-city-name' }, item.name || '—'),
        region ? h('span', { className: 'wx-city-region' }, region) : null,
      )
    })
    : null

  const cityHint = cityBusy
    ? wxT(lang, 'city.loading')
    : (cityQuery.trim().length >= 1 && !cityResults.length ? (cityError || wxT(lang, 'city.empty')) : '')

  const cityPopover = cityOpen
    ? h('div', {
      className: 'wx-city-pop',
      onPointerDown: (event) => { if (event && event.stopPropagation) event.stopPropagation() },
      onClick: (event) => { if (event && event.stopPropagation) event.stopPropagation() },
    },
      h('div', { className: 'wx-city-head' },
        h('input', {
          className: 'wx-city-input',
          type: 'text',
          value: cityQuery,
          placeholder: wxT(lang, 'city.search'),
          autoFocus: true,
          spellCheck: false,
          onChange: (event) => setCityQuery(event && event.target ? event.target.value : ''),
          onKeyDown: (event) => {
            if (!event) return
            if (event.key === 'Escape') {
              if (event.stopPropagation) event.stopPropagation()
              closeCity()
            } else if (event.key === 'Enter') {
              if (event.preventDefault) event.preventDefault()
              if (cityResults[0]) selectCity(cityResults[0])
            }
          },
        }),
        h('button', { className: 'wx-city-cancel', type: 'button', onClick: closeCity }, wxT(lang, 'city.cancel')),
      ),
      cityRows ? h('div', { className: 'wx-city-list' }, cityRows) : null,
      cityHint ? h('div', { className: 'wx-city-hint' }, cityHint) : null,
      h('div', { className: 'wx-city-foot' },
        h('button', { className: 'wx-city-auto', type: 'button', onClick: useAutoPlace }, wxT(lang, 'city.auto')),
        pinned ? h('span', { className: 'wx-city-pinned' }, wxT(lang, 'city.pinned')) : null,
      ),
    )
    : null

const compact = cardW < 560
  const hintAbove = pos.y + boxH + 36 > wxWindowSize().h
  const rootStyle = {
    left: pos.x + 'px',
    top: pos.y + 'px',
    width: boxW + 'px',
    height: boxH + 'px',
    '--wx-k': ui.mini ? 1 : effK,
  }
  const rootClass = 'wx-root' + (ui.mini ? ' wx-root-mini' : '') + (dragging ? ' wx-dragging' : '')

  if (ui.mini) {
    const miniEngineReady = typeof createMatrixScene === 'function' && createMatrixScene.length >= 2
    return h('div', {
      className: rootClass,
      style: rootStyle,
      role: 'region',
      'aria-label': wxT(lang, 'app.title'),
      onPointerDown: handlePointerDown,
      onPointerEnter: () => setHovering(true),
      onPointerLeave: () => setHovering(false),
    },
      h('style', { key: 'wx-style' }, WX_CSS),
      h('div', { className: 'wx-pill', title: uiText.expand },
        h('div', { className: 'wx-pill-canvaswrap' },
          miniEngineReady
            ? h('canvas', { className: 'wx-pill-canvas', ref: pillCanvasRef })
            : h('div', { className: 'wx-pill-icon' },
              h(WeatherIcon, {
                kind: wxIconForSafe(now ? now.code : 3, now ? now.isDay !== false : true),
                size: 26,
              })),
        ),
        h('div', { className: 'wx-pill-main' },
          h('div', { className: 'wx-pill-temp' }, tempText, h('span', { className: 'wx-deg' }, '°')),
          h('div', { className: 'wx-pill-sub' }, placeName + (condition ? ' · ' + condition : '')),
        ),
        h('span', { className: 'wx-pill-live' },
          h('span', { className: liveDotClass }),
          h('span', { className: 'wx-pill-clock' }, liveClock),
        ),
        h('span', { className: 'wx-pill-chevron' }, '›'),
      ),
    )
  }

  const toolsBlock = h('div', {
    className: 'wx-tools',
    onPointerDown: stopEvent,
    onClick: stopEvent,
  },
    h('button', {
      className: 'wx-tool',
      type: 'button',
      title: uiText.size,
      'aria-label': uiText.size,
      onClick: () => setSizeOpen((open) => !open),
    }, '⤢'),
    h('button', {
      className: 'wx-tool',
      type: 'button',
      title: uiText.minimize,
      'aria-label': uiText.minimize,
      onClick: minimizeCard,
    }, '—'),
    sizeOpen ? h('div', {
      className: 'wx-sizes',
      onPointerDown: stopEvent,
      onClick: stopEvent,
    },
      WX_SIZE_PRESETS.map((preset) => h('button', {
        key: preset.key,
        className: 'wx-size-item' + (Math.abs(ui.k - preset.k) < 0.005 ? ' wx-size-item-on' : ''),
        type: 'button',
        onClick: () => applyPreset(preset.k),
      }, sizeLabels[preset.key] || preset.key)),
      h('div', { className: 'wx-size-hint' }, uiText.fine),
    ) : null,
  )

  const gripBlock = h('div', {
    className: 'wx-grip',
    title: uiText.size,
    onPointerDown: handleGripDown,
    onDoubleClick: () => updateUi({ k: 1 }),
  })

  return h('div', {
    className: rootClass,
    style: rootStyle,
    role: 'region',
    'aria-label': wxT(lang, 'app.title'),
    onPointerDown: handlePointerDown,
    onPointerEnter: () => setHovering(true),
    onPointerLeave: () => setHovering(false),
  },
    h('style', { key: 'wx-style' }, WX_CSS),
    h('div', { className: 'wx-card' },
      h('div', { className: 'wx-left' },
        h('div', { className: 'wx-canvas-wrap' },
          h('canvas', { className: 'wx-canvas', ref: canvasRef }),
        ),
        state.status === 'stale' ? h('div', { className: 'wx-badge' }, wxT(lang, 'stale')) : null,
        h('div', { className: 'wx-tempblock' },
          h('div', { className: 'wx-temp' }, tempText, h('span', { className: 'wx-deg' }, '°')),
        ),
        h('div', { className: 'wx-cond' }, condition),
      ),
      h('div', { className: 'wx-info' },
        h('div', { className: 'wx-head' },
          h('button', {
            className: 'wx-place-btn',
            type: 'button',
            title: wxT(lang, 'city.search'),
            'aria-haspopup': 'dialog',
            'aria-expanded': cityOpen ? 'true' : 'false',
            onPointerDown: stopEvent,
            onClick: (event) => {
              stopEvent(event)
              if (cityOpen) closeCity()
              else setCityOpen(true)
            },
          },
            h('span', null, placeName),
            h('span', { className: 'wx-place-caret' }, '▾'),
          ),
          h('div', { className: 'wx-live' },
            h('span', { className: liveDotClass }),
            h('span', null, wxT(lang, 'live')),
            h('span', { className: 'wx-clock' }, liveClock),
          ),
        ),
        compact ? null : h('div', { className: 'wx-meta' }, meta),
        emptyBlock,
        hourlyRow,
        dailyBlock,
        cityPopover,
      ),
      toolsBlock,
      gripBlock,
    ),
    hovering ? h('div', { className: 'wx-hint ' + (hintAbove ? 'wx-hint-above' : 'wx-hint-below') },
      wxT(lang, 'drag') + ' · ' + wxT(lang, 'refresh') +
      (state.fetchedAt ? ' · ' + wxT(lang, 'updated') + ' ' + wxLocalClock(state.fetchedAt) : '')) : null,
  )
}
