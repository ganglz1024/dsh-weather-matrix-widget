/**
 * Client Plugin entry.
 *
 * Registers the widget into `shell.overlay` — the frame-wide floating layer the
 * shell renders above every column and outside their scroll containers — so the
 * card behaves like a desktop widget instead of an in-flow decoration.
 *
 * The `locale` registration option hands the component the app's translate
 * function; the dictionaries below are the widget's own namespace.
 */
const WX_SLOT_ID = 'weather-matrix-widget'
const WX_LOCALE_IDS = ['en', 'zh', 'zh-CN']

function wxRegisterLocale(ctx) {
  let locale = null
  try {
    locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
  } catch (error) {
    locale = null
  }
  if (!locale || typeof locale.register !== 'function') return
  wxLocaleService = locale
  const dicts = wxDicts()
  try {
    ctx.effect(() => {
      const disposers = []
      for (let i = 0; i < WX_LOCALE_IDS.length; i += 1) {
        const id = WX_LOCALE_IDS[i]
        const dict = dicts[id] || dicts[String(id).split('-')[0]]
        if (!dict) continue
        try {
          const off = locale.register(WX_NS, id, dict)
          if (typeof off === 'function') disposers.push(off)
        } catch (error) {
          // Duplicate (namespace, locale) registration or an unsupported tag:
          // the widget keeps its built-in bilingual labels.
        }
      }
      return () => {
        for (let i = 0; i < disposers.length; i += 1) {
          try { disposers[i]() } catch (error) { /* ignore */ }
        }
      }
    }, 'weather-matrix:locale')
  } catch (error) {
    // Localization is optional; visible text still follows the active locale.
  }
}

function wxApply(ctx) {
  wxRegisterLocale(ctx)
  const register = () => {
    try {
      return ctx.slots.register({
        name: 'shell.overlay',
        id: WX_SLOT_ID,
        order: 40,
        locale: WX_NS,
      }, WeatherWidget)
    } catch (error) {
      // Older slot registries may not know the `locale` option; the component
      // still renders with its built-in dictionaries.
      return ctx.slots.register({
        name: 'shell.overlay',
        id: WX_SLOT_ID,
        order: 40,
      }, WeatherWidget)
    }
  }
  try {
    ctx.slots.inject('shell.overlay', register)
  } catch (error) {
    try {
      if (typeof console !== 'undefined' && console && typeof console.error === 'function') {
        console.error('[weather-matrix] slot registration failed', error)
      }
    } catch (ignored) { /* ignore */ }
  }
}