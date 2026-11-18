/**
 * Package validation for the weather-matrix widget bundle.
 *
 * Checks the manifest, the bundle patch, the locale metadata, the icon and the
 * assembled browser artifact without needing a browser. Run:
 *   node test/validate-manifest.mjs
 */
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let failures = 0

function check(name, ok, detail) {
  if (ok) {
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''))
  } else {
    failures += 1
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''))
  }
}

function readJson(rel) {
  return JSON.parse(readFileSync(join(root, rel), 'utf8'))
}

const pkg = readJson('package.json')
check('package name is the public bundle name', pkg.name === 'dsh-weather-matrix-widget', pkg.name)
check('type is module', pkg.type === 'module')
check('bundle patch declared', pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch === './cordis.patch.yml')
check('client section declares web platform', pkg.dsh.client && pkg.dsh.client.platform === 'web')
check('client loads immediately', pkg.dsh.client && pkg.dsh.client.immediately === true)
check('client orders after the client runtime', Array.isArray(pkg.dsh.client.inject) && pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'))
check('exports the client artifact', pkg.exports['./client'] === './client.js')
check('exports locale JSON', typeof pkg.exports['./locale/*.json'] === 'string')
check('exports the icon', pkg.exports['./icon'] === './icon.svg')
for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'locale/*.json', 'icon.svg']) {
  check('exists on disk: ' + file, statSync(join(root, file.replace('*', 'en'))).size > 0)
}
check('files covers the locale directory glob', Array.isArray(pkg.files) && pkg.files.includes('locale/*.json'))
check('files covers the browser artifact', Array.isArray(pkg.files) && pkg.files.includes('client.js') && pkg.files.includes('index.js'))
check('files covers the bundle patch', Array.isArray(pkg.files) && pkg.files.includes('cordis.patch.yml'))
check('files covers the icon', Array.isArray(pkg.files) && pkg.files.includes('icon.svg'))

const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
check('patch inserts one row with our id', /id:\s*weather-matrix-widget/.test(patch))
check('patch names the package', /name:\s*'dsh-weather-matrix-widget'/.test(patch))

for (const locale of ['en', 'zh']) {
  const dict = readJson('locale/' + locale + '.json')
  check(locale + ' meta.title present', !!(dict.meta && typeof dict.meta.title === 'string' && dict.meta.title.length > 2), dict.meta && dict.meta.title)
  check(locale + ' meta.description present', !!(dict.meta && typeof dict.meta.description === 'string' && dict.meta.description.length > 10))
}

const svg = readFileSync(join(root, 'icon.svg'), 'utf8')
check('icon is an SVG document', /^\s*<svg[\s>]/.test(svg))
check('icon is under the 256 KiB limit', Buffer.byteLength(svg, 'utf8') < 256 * 1024, Buffer.byteLength(svg, 'utf8') + ' bytes')
check('icon uses a viewBox', /viewBox="0 0 64 64"/.test(svg))

const client = readFileSync(join(root, 'client.js'), 'utf8')
check('artifact registers the package id', client.includes("id: 'dsh-weather-matrix-widget'"))
check('artifact returns the plugin shape', /return \{ inject: \['slots'\], apply: wxApply \};/.test(client))
check('artifact does not import ESM', !/^\s*(import|export)\s/m.test(client))
check('artifact never writes document.body', !client.includes('document.body'))
check('artifact registers into shell.overlay', client.includes("'shell.overlay'"))
check('artifact contains the canvas engine', client.includes('createMatrixScene'))
check('artifact contains the weather data layer', client.includes('wxFetchWeather'))
check('artifact contains city search', client.includes('wxSearchPlaces') && client.includes('wxWritePlace'))
check('artifact renders with React.createElement (no JSX)', !/<[A-Z][A-Za-z]*[ />]/.test(client.replace(/<style[\s\S]*?<\/style>/g, '')))

const host = readFileSync(join(root, 'index.js'), 'utf8')
check('host declares the webServer dependency', /export const inject = \['webServer'\]/.test(host))
check('host registers the weather route', host.includes("'/dsh-weather/api'"))
check('host registers the city search route', host.includes("'/dsh-weather/search'"))
check('host answers as a resource route', host.includes('kind: \'exact\''))
check('host exports apply', /export function apply\(/.test(host))

// ---- integration checks across the concatenated parts ----
const PART_FILES = ['parts/05-font.js', 'parts/00-data.js', 'parts/10-matrix.js', 'parts/20-icons.js', 'parts/30-view.js', 'parts/90-register.js']
const sources = PART_FILES.map((file) => readFileSync(join(root, file), 'utf8'))
const combined = sources.join('\n')
const sourceOf = (file) => sources[PART_FILES.indexOf(file)]

const view = sourceOf('parts/30-view.js')
const cssStart = view.indexOf('const WX_CSS = ')
const cssEnd = view.indexOf('function WeatherWidget(')
const hasCss = cssStart >= 0 && cssEnd > cssStart
const cssChunk = hasCss ? view.slice(cssStart, cssEnd) : ''
const jsxChunk = hasCss ? view.slice(0, cssStart) + view.slice(cssEnd) : view
const definedClasses = new Set([...cssChunk.matchAll(/\.(wx-[a-z0-9-]+)/g)].map((match) => match[1]))
const usedClasses = new Set()
for (const match of jsxChunk.matchAll(/'([^']*)'/g)) {
  for (const token of match[1].split(/\s+/)) {
    if (/^wx-[a-z0-9-]+$/.test(token)) usedClasses.add(token)
  }
}
const nonClassTokens = new Set(['wx-style'])
const missingClasses = [...usedClasses].filter((name) => !definedClasses.has(name) && !nonClassTokens.has(name))
const unusedClasses = [...definedClasses].filter((name) => !usedClasses.has(name))
check('every className used by the view has a CSS rule', missingClasses.length === 0, missingClasses.join(','))
check('every CSS rule is referenced by the view', unusedClasses.length === 0, unusedClasses.join(','))

const definedFns = new Set()
for (const match of combined.matchAll(/(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) definedFns.add(match[1])
const referencedWx = new Set([...combined.matchAll(/\bwx[A-Z][\w]*\b/g)].map((match) => match[0]))
const undefinedHelpers = [...referencedWx].filter((name) => !definedFns.has(name))
check('no undefined wx* helper is referenced', undefinedHelpers.length === 0, undefinedHelpers.join(','))

const iconKeys = new Set([...sourceOf('parts/20-icons.js').matchAll(/^  '?([a-z-]+)'?: \[/gm)].map((match) => match[1]))
for (const kind of ['clear', 'clear-night', 'partly', 'partly-night', 'cloudy', 'overcast', 'fog', 'drizzle', 'rain', 'heavy-rain', 'snow', 'sleet', 'thunder']) {
  check('icon bitmap exists: ' + kind, iconKeys.has(kind))
}
const sceneKinds = [...sourceOf('parts/10-matrix.js').matchAll(/MX_KINDS\s*=\s*\[([^\]]*)\]/g)]
check('engine declares its scene kinds', sceneKinds.length === 1, sceneKinds.length ? sceneKinds[0][1].trim() : 'missing')
check('bundled UI font is embedded', /const WX_FONT_CSS = "@font-face\{font-family:/.test(sourceOf('parts/05-font.js')))
check('bundled UI font is used by the stylesheet', sourceOf('parts/30-view.js').includes('WX_FONT_CSS') && sourceOf('parts/30-view.js').includes("'WXNunito'"))
check('font license is shipped', statSync(join(root, 'LICENSE-Nunito.txt')).size > 1000)

console.log(failures === 0 ? '\nALL PASS' : '\n' + failures + ' FAILURE(S)')
process.exit(failures === 0 ? 0 : 1)