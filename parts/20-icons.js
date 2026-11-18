/**
 * Pixel weather glyphs for the right-hand panel.
 *
 * Every glyph is a 10x9 bitmap rendered as small rounded squares with a visible
 * gap, so the icons match the tile-mosaic language of the left scene instead of
 * reading as blurry blobs. `wxIconFor()` in the data layer picks the night
 * variants for clear / partly.
 *
 * Cells: g/G/L = cloud dim/body/light, c/C = precipitation cyan, w = snow white,
 * Y = bright sun disc, y = amber sun ray / rim, m = moon, s = star, '.' = empty.
 */
const WX_ICON_BITMAPS = {
  clear: [
    '....yy....',
    '..y....y..',
    '...YYYY...',
    '..YYYYYY..',
    'y.YYYYYY.y',
    '..YYYYYY..',
    '...YYYY...',
    '..y....y..',
    '....yy....',
  ],
  'clear-night': [
    '...MMMM...',
    '..MMMMMM.s',
    '.MMmMMMMM.',
    '.MMMMMMMM.',
    '.MMMMMMMm.',
    '.MMmMMMMM.',
    's.MMMMMM..',
    '...MMMM...',
    '..........',
  ],
  partly: [
    '.....yy...',
    '....YYYY..',
    '.....YY...',
    '..LLGGG...',
    '.GGGGGGG..',
    'GGGGGGGGG.',
    'GGGGGGGGGG',
    '.gggggggg.',
    '..........',
  ],
  'partly-night': [
    '....MM....',
    '...MMMM...',
    '...MMmM...',
    '....MM....',
    '..LLGGG...',
    '.GGGGGGG..',
    'GGGGGGGGG.',
    'GGGGGGGGGG',
    '.gggggggg.',
  ],
  cloudy: [
    '..........',
    '...LLLL...',
    '..GGGGGG..',
    '.GGGGGGGG.',
    'GGGGGGGGGG',
    'GGGGGGGGGG',
    '.gggggggg.',
    '..........',
    '..........',
  ],
  overcast: [
    '..........',
    '..LLLLLL..',
    '.GGGGGGGG.',
    'GGGGGGGGGG',
    'GGGGGGGGGG',
    'GGGGGGGGGG',
    '.gggggggg.',
    '..........',
    '..........',
  ],
  fog: [
    '..........',
    '..GGGGGG..',
    '.gggggggg.',
    '..........',
    'GGGGGGGGGG',
    '..........',
    '.gggggggg.',
    '..GGGGGG..',
    '..........',
  ],
  drizzle: [
    '..........',
    '..LLLLLL..',
    '.GGGGGGGG.',
    'GGGGGGGGGG',
    '.gggggggg.',
    '...c..c...',
    '..........',
    '..........',
    '..........',
  ],
  rain: [
    '..........',
    '..LLLLLL..',
    '.GGGGGGGG.',
    'GGGGGGGGGG',
    '.gggggggg.',
    '..c..c..c.',
    '..C..C..C.',
    '..........',
    '..........',
  ],
  'heavy-rain': [
    '..........',
    '..LLLLLL..',
    '.GGGGGGGG.',
    'GGGGGGGGGG',
    '.gggggggg.',
    '.c.c.c.c..',
    '.C.C.C.C..',
    '..c.c.c...',
    '..........',
  ],
  snow: [
    '..........',
    '..LLLLLL..',
    '.GGGGGGGG.',
    'GGGGGGGGGG',
    '.gggggggg.',
    '..w...w...',
    '....w...w.',
    '..w...w...',
    '..........',
  ],
  sleet: [
    '..........',
    '..LLLLLL..',
    '.GGGGGGGG.',
    'GGGGGGGGGG',
    '.gggggggg.',
    '..c...w...',
    '..w...c...',
    '..........',
    '..........',
  ],
  thunder: [
    '..........',
    '..gggggg..',
    '.gGGGGGgg.',
    'ggGGGGGggg',
    '.gggggggg.',
    '....yy....',
    '...yy.....',
    '..yy......',
    '..........',
  ],
}

const WX_ICON_COLORS = {
  g: '#6a6e78',
  G: '#8f939d',
  L: '#b3b8c2',
  c: '#2fbdf0',
  C: '#6fdcff',
  w: '#eaf3ff',
  Y: '#ffd37a',
  y: '#ffb266',
  M: '#f4f1e2',
  m: '#cfcbbb',
  s: '#cfdcff',
}

/** One 10x9 pixel glyph, sized by `size` (width in px), as a grid of rounded squares. */
function WeatherIcon(props) {
  const kind = (props && props.kind) || 'cloudy'
  const size = (props && props.size) || 24
  const rows = WX_ICON_BITMAPS[kind] || WX_ICON_BITMAPS.cloudy
  const dots = []
  const cell = 1
  const dotSize = 0.78
  const half = dotSize / 2
  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y]
    for (let x = 0; x < row.length; x += 1) {
      const code = row.charAt(x)
      if (code === '.') continue
      dots.push(h('rect', {
        key: x + ':' + y,
        x: x + 0.5 * cell - half,
        y: y + 0.5 * cell - half,
        width: dotSize,
        height: dotSize,
        rx: 0.14,
        fill: WX_ICON_COLORS[code] || WX_ICON_COLORS.G,
      }))
    }
  }
  return h('svg', {
    width: size,
    height: Math.round((size * 9) / 10),
    viewBox: '0 0 10 9',
    'aria-hidden': 'true',
    focusable: 'false',
    style: { display: 'block', flex: '0 0 auto', overflow: 'visible' },
  }, dots)
}