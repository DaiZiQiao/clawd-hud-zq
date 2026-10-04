import type { Cell, MascotAgent, MascotScene, SceneLayer } from './scene-types'
import { BASELINE, CELL_HEIGHT, CELL_WIDTH, CLASSES, FONT_SIZE, SCENE_THEMES, escapeText, isThemeKey, lightRule, num } from './svg-style'
import type { ThemeKey } from './svg-style'

// The mascot scene in pixels, for a surface whose text is not a grid of equal
// cells (the desktop's pane sets text in a proportional font, and the block
// glyphs fall back to another font with other advances, so a sprite's rows
// no longer line up). The same sprites and marks the text rows draw
// (hooks/scene-types.ts `SceneLayer`), each at its unrounded place, as one SVG
// document: a block glyph as the coloured quarters of its cell, any other
// glyph as text centred in its cell; the red pipe's blocks as rects too. What
// `Svg` draws as an image.

/** A quarter of a cell: what a quadrant glyph is drawn in. */
const HALF_X = CELL_WIDTH / 2
const HALF_Y = CELL_HEIGHT / 2

/**
 * The longest document drawn: under `Svg`'s 131,072 characters and a
 * `Client` tree's 100,000 serialized, with room left for the rest of the tree.
 */
export const SVG_MAX = 90_000

/**
 * The block glyphs as the quarters of a cell they fill: 1 the upper left, 2
 * the upper right, 4 the lower left, 8 the lower right.
 */
export const QUADRANTS: Readonly<Record<string, number>> = {
  '▘': 1,
  '▝': 2,
  '▀': 3,
  '▖': 4,
  '▌': 5,
  '▞': 6,
  '▛': 7,
  '▗': 8,
  '▚': 9,
  '▐': 10,
  '▜': 11,
  '▄': 12,
  '▙': 13,
  '▟': 14,
  '█': 15,
}

/** The medium shade (the laptop's screen): its whole cell at half strength. */
const SHADE = '▒'
/** The black rectangle: a bar across the middle of its cell. */
const BAR = '▬'
const BAR_TOP = 6
const BAR_HEIGHT = 4

/** What a cell is filled with: a raw colour, or a theme key's (dark) colour and its class; at half strength for a shade. */
type Paint = { fill: string; theme?: ThemeKey; half?: true }

const themed = (key: ThemeKey): Paint => ({ fill: SCENE_THEMES.dark[key], theme: key })

/** A raw colour as it is; a theme key as its colour; anything else as the foreground. */
const colourPaint = (colour: string): Paint => (colour.startsWith('#') ? { fill: colour } : themed(isThemeKey(colour) ? colour : 'text'))

/** A cell's paint, by its ink, as the text rows colour it (`styleOf`). */
export const paintOf = (cell: Cell): Paint => {
  const paint = ((): Paint => {
    switch (cell.ink) {
      case 'b':
      case 'k':
        return colourPaint(cell.colour)
      case 'f':
        return themed('text')
      case 'd':
        return themed('inactive')
      case 'a':
      case 'p':
        return themed('claude')
      case 'g':
        return themed('success')
      case 'y':
      case 'i':
        return themed('warning')
      case 'r':
        return themed('error')
    }
  })()

  return cell.ch === SHADE ? { ...paint, half: true } : paint
}

const paintKey = (paint: Paint): string => `${paint.fill}|${paint.theme ?? ''}|${paint.half === true ? 'h' : ''}`

/** One rect in a layer's own pixels. */
type Rect = { x: number; y: number; width: number; height: number }

/** What one paint of one layer draws: its quarters by half-row, its bars, its glyphs. */
type Ink = { paint: Paint; quarters: Map<number, Set<number>>; bars: Rect[]; glyphs: { x: number; y: number; ch: string }[] }

/**
 * A paint's quarters as rects: each half-row's runs of filled quarters, a run
 * carried on down while the half-row under it has the very same run.
 */
const rectsOf = (quarters: ReadonlyMap<number, ReadonlySet<number>>): Rect[] => {
  const done: { x0: number; x1: number; y0: number; y1: number }[] = []
  let open = new Map<string, { x0: number; x1: number; y0: number; y1: number }>()
  for (const half of [...quarters.keys()].sort((a, b) => a - b)) {
    const columns = [...(quarters.get(half) ?? [])].sort((a, b) => a - b)
    const next = new Map<string, { x0: number; x1: number; y0: number; y1: number }>()
    let index = 0
    while (index < columns.length) {
      const x0 = columns[index] ?? 0
      let x1 = x0 + 1
      index += 1
      while (index < columns.length && columns[index] === x1) {
        x1 += 1
        index += 1
      }
      const key = `${x0}:${x1}`
      const above = open.get(key)
      if (above !== undefined && above.y1 === half) {
        above.y1 = half + 1
        next.set(key, above)
      } else {
        const run = { x0, x1, y0: half, y1: half + 1 }
        done.push(run)
        next.set(key, run)
      }
    }
    open = next
  }

  return done.map(run => ({ x: run.x0 * HALF_X, y: run.y0 * HALF_Y, width: (run.x1 - run.x0) * HALF_X, height: (run.y1 - run.y0) * HALF_Y }))
}

const rectTag = (rect: Rect): string => `<rect x='${num(rect.x)}' y='${num(rect.y)}' width='${num(rect.width)}' height='${num(rect.height)}'/>`

/** One layer as a group at its place: a group per paint of its rects and its glyphs; empty when it draws nothing. */
export const layerSvg = (layer: SceneLayer): string => {
  const inks = new Map<string, Ink>()
  const inkOf = (paint: Paint): Ink => {
    const key = paintKey(paint)
    const known = inks.get(key)
    if (known !== undefined) return known
    const made: Ink = { paint, quarters: new Map(), bars: [], glyphs: [] }
    inks.set(key, made)

    return made
  }
  layer.cells.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell === undefined || cell.ch.trim() === '') return
      const ink = inkOf(paintOf(cell))
      const mask = cell.ch === SHADE ? 15 : QUADRANTS[cell.ch]
      if (mask !== undefined) {
        for (const [bit, dx, dy] of [[1, 0, 0], [2, 1, 0], [4, 0, 1], [8, 1, 1]] as const) {
          if ((mask & bit) === 0) continue
          const half = y * 2 + dy
          const set = ink.quarters.get(half) ?? new Set<number>()
          set.add(x * 2 + dx)
          ink.quarters.set(half, set)
        }
      } else if (cell.ch === BAR) {
        ink.bars.push({ x: x * CELL_WIDTH, y: y * CELL_HEIGHT + BAR_TOP, width: CELL_WIDTH, height: BAR_HEIGHT })
      } else {
        ink.glyphs.push({ x: x * CELL_WIDTH + HALF_X, y: y * CELL_HEIGHT + BASELINE, ch: cell.ch })
      }
    })
  })
  if (inks.size === 0) return ''
  const groups = [...inks.values()].map(ink => {
    const { paint } = ink
    const attributes = `${paint.theme === undefined ? '' : ` class='${CLASSES[paint.theme]}'`} fill='${paint.fill}'${paint.half === true ? ` fill-opacity='.5'` : ''}`
    const shapes = [...rectsOf(ink.quarters), ...ink.bars].map(rectTag).join('')
    const glyphs = ink.glyphs.map(glyph => `<text x='${num(glyph.x)}' y='${num(glyph.y)}'>${escapeText(glyph.ch)}</text>`).join('')

    return `<g${attributes}>${shapes}${glyphs}</g>`
  })
  const dx = layer.x * CELL_WIDTH
  const dy = layer.y * CELL_HEIGHT
  const place = dx === 0 && dy === 0 ? '' : ` transform='translate(${num(dx)} ${num(dy)})'`

  return `<g${place}>${groups.join('')}</g>`
}

/** The scene as an `Svg`'s props: its document, what it shows in words, and its size in CSS pixels. */
export type SceneSvg = { source: string; alt: string; width: number; height: number }

/**
 * The layers drawn in order (later over earlier) into a room of `columns` by
 * `rows` cells, each cell CELL_WIDTH by CELL_HEIGHT pixels; a layer that would
 * take the document past SVG_MAX is left out (never one already drawn).
 */
export const sceneSvg = (layers: readonly SceneLayer[], room: { columns: number; rows: number }, alt: string): SceneSvg => {
  const width = Math.max(1, Math.floor(room.columns)) * CELL_WIDTH
  const height = Math.max(1, Math.floor(room.rows)) * CELL_HEIGHT
  const used = new Set<ThemeKey>()
  for (const layer of layers) {
    for (const row of layer.cells) {
      for (const cell of row) {
        const theme = cell === undefined || cell.ch.trim() === '' ? undefined : paintOf(cell).theme
        if (theme !== undefined) used.add(theme)
      }
    }
  }
  // `pointer-events='none'`: where a surface sets the document in its page rather than as an image, a press goes through it to the region.
  const open = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}' pointer-events='none' shape-rendering='crispEdges' font-family='ui-monospace,Menlo,Consolas,monospace' font-size='${FONT_SIZE}' text-anchor='middle'>${lightRule(used)}`
  const close = '</svg>'
  let length = open.length + close.length
  const body: string[] = []
  for (const layer of layers) {
    const drawn = layerSvg(layer)
    if (drawn === '' || length + drawn.length > SVG_MAX) continue
    body.push(drawn)
    length += drawn.length
  }

  return { source: `${open}${body.join('')}${close}`, alt, width, height }
}

/** What one agent's mascot is doing, in a word or two. */
const doingOf = (agent: MascotAgent): string => {
  switch (agent.status) {
    case 'done':
      return 'done'
    case 'failed':
      return 'failed'
    case 'stalled':
      return 'stalled'
    case 'running':
      return agent.idleMs !== undefined ? 'idle' : agent.activity
  }
}

/** Who one agent's mascot is: its role, else its type, else a workflow agent or an agent. */
const whoOf = (agent: MascotAgent): string => agent.role ?? (agent.workflow === true ? 'workflow agent' : agent.type ?? 'agent')

/**
 * The scene in words, for `Svg`'s `alt`: how many mascots are drawn, then
 * each, the session's first and the agents in spawn order (`3 mascots: session
 * watching, worker typing, reviewer reading`), held or falling ones said so,
 * and how many more stand in the row of dots.
 */
export const sceneAlt = (scene: MascotScene, layers: readonly SceneLayer[], collapsed = 0): string => {
  const drawn = new Map(layers.filter(layer => layer.id !== undefined && layer.kind !== 'strip').map(layer => [layer.id ?? '', layer]))
  const posed = (layer: SceneLayer | undefined, doing: string): string => (layer?.pose === 'dangle' ? 'held' : layer?.pose === 'tumble' ? 'falling' : doing)
  const parts: string[] = []
  if (drawn.has('main')) parts.push(`session ${posed(drawn.get('main'), scene.main.mood)}`)
  for (const agent of scene.agents) {
    if (drawn.has(agent.id)) parts.push(`${whoOf(agent)} ${posed(drawn.get(agent.id), doingOf(agent))}`)
  }
  const more = collapsed > 0 ? `; ${collapsed} more as dots` : ''
  if (parts.length === 0) return `No mascots${more}`

  return `${parts.length} mascot${parts.length === 1 ? '' : 's'}: ${parts.join(', ')}${more}`
}
