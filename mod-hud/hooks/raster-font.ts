import type { Shape } from './clawd-vector'

// The text a terminal's picture of the scene carries (a role's letter, a
// thought, a shout, the strip's count), drawn as shapes: the pixels of a
// small bitmap font, each row's runs as rectangles, for
// hooks/clawd-vector.ts `rasterOf`, which draws no text of its own. Five
// columns by seven rows over the baseline and two under it; a glyph advances
// six. Scaled so a line of `size` is as tall and as wide as the desktop's
// monospace text of that size.

/** Each glyph's rows, top down: `#` drawn. Seven over the baseline, then any under it. */
const GLYPHS: Readonly<Record<string, string>> = {
  ' ': '',
  '!': '..#../..#../..#../..#../..#../...../..#..',
  '?': '.###./#...#/....#/...#./..#../...../..#..',
  '.': '...../...../...../...../...../...../..#..',
  ',': '...../...../...../...../...../..#../..#../.#...',
  "'": '..#../..#../.#.../...../...../...../.....',
  '-': '...../...../...../.###./...../...../.....',
  '+': '...../..#../..#../#####/..#../..#../.....',
  ':': '...../..#../...../...../...../..#../.....',
  '(': '...#./..#../.#.../.#.../.#.../..#../...#.',
  ')': '.#.../..#../...#./...#./...#./..#../.#...',
  '/': '....#/...#./...#./..#../.#.../.#.../#....',
  '…': '...../...../...../...../...../...../#.#.#',
  '·': '...../...../...../..#../...../...../.....',
  '×': '...../#...#/.#.#./..#../.#.#./#...#/.....',
  '0': '.###./#...#/#..##/#.#.#/##..#/#...#/.###.',
  '1': '..#../.##../..#../..#../..#../..#../.###.',
  '2': '.###./#...#/....#/...#./..#../.#.../#####',
  '3': '####./....#/....#/.###./....#/....#/####.',
  '4': '...#./..##./.#.#./#..#./#####/...#./...#.',
  '5': '#####/#..../####./....#/....#/#...#/.###.',
  '6': '..##./.#.../#..../####./#...#/#...#/.###.',
  '7': '#####/....#/...#./..#../.#.../.#.../.#...',
  '8': '.###./#...#/#...#/.###./#...#/#...#/.###.',
  '9': '.###./#...#/#...#/.####/....#/...#./.##..',
  A: '.###./#...#/#...#/#####/#...#/#...#/#...#',
  B: '####./#...#/#...#/####./#...#/#...#/####.',
  C: '.###./#...#/#..../#..../#..../#...#/.###.',
  D: '###../#..#./#...#/#...#/#...#/#..#./###..',
  E: '#####/#..../#..../####./#..../#..../#####',
  F: '#####/#..../#..../####./#..../#..../#....',
  G: '.###./#...#/#..../#.###/#...#/#...#/.####',
  H: '#...#/#...#/#...#/#####/#...#/#...#/#...#',
  I: '.###./..#../..#../..#../..#../..#../.###.',
  J: '..###/...#./...#./...#./...#./#..#./.##..',
  K: '#...#/#..#./#.#../##.../#.#../#..#./#...#',
  L: '#..../#..../#..../#..../#..../#..../#####',
  M: '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#',
  N: '#...#/#...#/##..#/#.#.#/#..##/#...#/#...#',
  O: '.###./#...#/#...#/#...#/#...#/#...#/.###.',
  P: '####./#...#/#...#/####./#..../#..../#....',
  Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#',
  R: '####./#...#/#...#/####./#.#../#..#./#...#',
  S: '.####/#..../#..../.###./....#/....#/####.',
  T: '#####/..#../..#../..#../..#../..#../..#..',
  U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
  V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
  W: '#...#/#...#/#...#/#.#.#/#.#.#/#.#.#/.#.#.',
  X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
  Y: '#...#/#...#/.#.#./..#../..#../..#../..#..',
  Z: '#####/....#/...#./..#../.#.../#..../#####',
  a: '...../...../.###./....#/.####/#...#/.####',
  b: '#..../#..../#.##./##..#/#...#/#...#/####.',
  c: '...../...../.###./#..../#..../#...#/.###.',
  d: '....#/....#/.##.#/#..##/#...#/#...#/.####',
  e: '...../...../.###./#...#/#####/#..../.###.',
  f: '..##./.#..#/.#.../###../.#.../.#.../.#...',
  g: '...../...../.####/#...#/#...#/#...#/.####/....#/.###.',
  h: '#..../#..../#.##./##..#/#...#/#...#/#...#',
  i: '..#../...../.##../..#../..#../..#../.###.',
  j: '...#./...../..##./...#./...#./...#./...#./#..#./.##..',
  k: '#..../#..../#..#./#.#../##.../#.#../#..#.',
  l: '.##../..#../..#../..#../..#../..#../.###.',
  m: '...../...../##.#./#.#.#/#.#.#/#.#.#/#.#.#',
  n: '...../...../#.##./##..#/#...#/#...#/#...#',
  o: '...../...../.###./#...#/#...#/#...#/.###.',
  p: '...../...../####./#...#/#...#/#...#/####./#..../#....',
  q: '...../...../.####/#...#/#...#/#...#/.####/....#/....#',
  r: '...../...../#.##./##..#/#..../#..../#....',
  s: '...../...../.####/#..../.###./....#/####.',
  t: '.#.../.#.../###../.#.../.#.../.#..#/..##.',
  u: '...../...../#...#/#...#/#...#/#..##/.##.#',
  v: '...../...../#...#/#...#/#...#/.#.#./..#..',
  w: '...../...../#...#/#...#/#.#.#/#.#.#/.#.#.',
  x: '...../...../#...#/.#.#./..#../.#.#./#...#',
  y: '...../...../#...#/#...#/#...#/#...#/.####/....#/.###.',
  z: '...../...../#####/...#./..#../.#.../#####',
}

/** A glyph not in the font: an empty box. */
const MISSING = '#####/#...#/#...#/#...#/#...#/#...#/#####'

/** A font pixel at text of `size`: seven rows make its capitals 0.7 of the size, as a monospace face's are. */
const PIXEL = 0.1
const ADVANCE = 6
const ABOVE = 7

/** One glyph's rectangles: each run of a row, a run that repeats down the rows one taller rectangle. */
const runsOf = (rows: readonly string[]): { x: number; y: number; w: number; h: number }[] => {
  const open = new Map<string, { x: number; y: number; w: number; h: number }>()
  const done: { x: number; y: number; w: number; h: number }[] = []
  rows.forEach((row, y) => {
    const here = new Set<string>()
    for (let x = 0; x < row.length; ) {
      if (row[x] !== '#') {
        x += 1
        continue
      }
      let end = x
      while (row[end] === '#') end += 1
      const key = `${x}:${end}`
      const before = open.get(key)
      if (before !== undefined && before.y + before.h === y) before.h += 1
      else {
        if (before !== undefined) done.push(before)
        open.set(key, { x, y, w: end - x, h: 1 })
      }
      here.add(key)
      x = end
    }
    for (const [key, run] of open) {
      if (here.has(key)) continue
      done.push(run)
      open.delete(key)
    }
  })

  return [...done, ...open.values()]
}

const RUNS = new Map<string, { x: number; y: number; w: number; h: number }[]>()

const glyphRuns = (ch: string): { x: number; y: number; w: number; h: number }[] => {
  const known = RUNS.get(ch)
  if (known !== undefined) return known
  const art = GLYPHS[ch] ?? MISSING
  const runs = runsOf(art === '' ? [] : art.split('/'))
  RUNS.set(ch, runs)

  return runs
}

/** How wide a line of text is at `size`: six font pixels a glyph, less the last one's gap. */
export const textWidth = (text: string, size: number): number => Math.max(0, [...text].length * ADVANCE - 1) * PIXEL * size

/**
 * A text shape as the font's rectangles, in its own frame (`rasterOf` places
 * them by the shape's `m`): its baseline at its `y`, anchored at `x` by its
 * `anchor` (the middle when unsaid), its fill and alpha; bold, each run a
 * little wider. Each rectangle overlaps its neighbours by a hair, so no seam
 * shows where they meet.
 */
export const glyphShapes = (shape: Shape): Shape[] => {
  const text = [...(shape.text ?? '')]
  const size = shape.size ?? 3
  const k = PIXEL * size
  const width = textWidth(shape.text ?? '', size)
  const left = shape.anchor === 'start' ? shape.x : shape.anchor === 'end' ? shape.x - width : shape.x - width / 2
  const top = shape.y - ABOVE * k
  const bold = shape.bold === true ? 0.35 : 0
  const hair = 0.12

  return text.flatMap((ch, index) =>
    glyphRuns(ch).map((run): Shape => ({
      kind: 'rect',
      x: left + (index * ADVANCE + run.x - hair / 2) * k,
      y: top + (run.y - hair / 2) * k,
      w: (run.w + bold + hair) * k,
      h: (run.h + hair) * k,
      fill: shape.fill,
      ...(shape.alpha === undefined ? {} : { alpha: shape.alpha }),
    })),
  )
}
