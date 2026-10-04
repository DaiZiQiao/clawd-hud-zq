import { QUADRANTS } from './scene-svg'
import { CELL_HEIGHT, CELL_WIDTH } from './svg-style'

// The scene's SVG read back into cells, for the tests: what the desktop draws,
// laid on the grid the text rows use, so one assertion reads both surfaces.

/** One decoded cell: its glyph and its fill (and its class, for a theme key). */
export type SvgCell = { ch: string; fill: string; theme?: string }

const GLYPHS: ReadonlyMap<number, string> = new Map(Object.entries(QUADRANTS).map(([glyph, mask]) => [mask, glyph]))
const BITS = [[1, 2], [4, 8]] as const

const attributesOf = (text: string): Record<string, string> =>
  Object.fromEntries([...text.matchAll(/([\w-]+)='([^']*)'/g)].map(match => [match[1] ?? '', match[2] ?? '']))

const unescape = (text: string): string => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

type Local = { mask: number; ch?: string; fill: string; theme?: string }

/**
 * The document's cells: every layer (a group under the root) at its place
 * rounded to the cell as the text rows round it (a column half up, a row half
 * down: a lift half up), its rects back to quarters and so to block glyphs (a
 * half-strength rect a shade, a thin one a bar), its texts to glyphs; a later
 * layer's cell over an earlier one's, as the canvas paints.
 */
export const svgCells = (source: string): { columns: number; rows: number; cells: (SvgCell | undefined)[][] } => {
  const root = attributesOf(/<svg([^>]*)>/.exec(source)?.[1] ?? '')
  const columns = Math.round(Number(root.width) / CELL_WIDTH)
  const rows = Math.round(Number(root.height) / CELL_HEIGHT)
  const cells: (SvgCell | undefined)[][] = Array.from({ length: rows }, () => Array.from({ length: columns }, () => undefined))
  const body = source.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/<style>.*?<\/style>/, '')
  let depth = 0
  let layer = new Map<string, Local>()
  let place = { x: 0, y: 0 }
  let paint: { fill: string; theme?: string; half: boolean } = { fill: '', half: false }
  let glyphAt: { x: number; y: number } | undefined
  const local = (x: number, y: number): Local => {
    const key = `${x},${y}`
    const known = layer.get(key) ?? { mask: 0, fill: paint.fill, ...(paint.theme === undefined ? {} : { theme: paint.theme }) }
    layer.set(key, known)

    return known
  }
  const flush = (): void => {
    for (const [key, one] of layer) {
      const [x, y] = key.split(',').map(Number) as [number, number]
      const row = cells[place.y + y]
      const column = place.x + x
      if (row === undefined || column < 0 || column >= columns) continue
      const ch = one.ch ?? GLYPHS.get(one.mask) ?? '?'
      row[column] = { ch, fill: one.fill, ...(one.theme === undefined ? {} : { theme: one.theme }) }
    }
    layer = new Map()
  }
  for (const match of body.matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>|([^<]+)/g)) {
    const [, closing, tag, rest, selfClosing, text] = match
    if (text !== undefined) {
      if (glyphAt !== undefined) local(Math.floor(glyphAt.x / CELL_WIDTH), Math.floor(glyphAt.y / CELL_HEIGHT)).ch = unescape(text)
      continue
    }
    const attributes = attributesOf(rest ?? '')
    if (tag === 'g' && closing === '') {
      depth += 1
      if (depth === 1) {
        const moved = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(attributes.transform ?? '')
        const x = Number(moved?.[1] ?? 0) / CELL_WIDTH
        const y = Number(moved?.[2] ?? 0) / CELL_HEIGHT
        place = { x: Math.round(x), y: Math.ceil(y - 0.5) }
      } else {
        paint = { fill: attributes.fill ?? '', ...(attributes.class === undefined ? {} : { theme: attributes.class }), half: attributes['fill-opacity'] !== undefined }
      }
    } else if (tag === 'g' && closing === '/') {
      if (depth === 1) flush()
      depth -= 1
    } else if (tag === 'rect') {
      const x = Number(attributes.x)
      const y = Number(attributes.y)
      const width = Number(attributes.width)
      const height = Number(attributes.height)
      if (height < CELL_HEIGHT / 2) {
        local(Math.floor(x / CELL_WIDTH), Math.floor(y / CELL_HEIGHT)).ch = '▬'
        continue
      }
      for (let qy = y / (CELL_HEIGHT / 2); qy < (y + height) / (CELL_HEIGHT / 2); qy += 1) {
        for (let qx = x / (CELL_WIDTH / 2); qx < (x + width) / (CELL_WIDTH / 2); qx += 1) {
          const one = local(Math.floor(qx / 2), Math.floor(qy / 2))
          one.mask |= BITS[qy % 2]![qx % 2]!
          if (paint.half) one.ch = '▒'
        }
      }
    } else if (tag === 'text') {
      glyphAt = selfClosing === '/' || closing === '/' ? undefined : { x: Number(attributes.x), y: Number(attributes.y) }
    }
  }

  return { columns, rows, cells }
}

/** The document's cells as text rows, a row per region row, trailing blanks dropped: what the terminal's rows read. */
export const svgRows = (source: string): string[] => svgCells(source).cells.map(row => row.map(cell => cell?.ch ?? ' ').join('').trimEnd())

/** Every `<rect>` of the document, as numbers. */
export const svgRects = (source: string): { x: number; y: number; width: number; height: number }[] =>
  [...source.matchAll(/<rect([^>]*)\/>/g)].map(match => {
    const attributes = attributesOf(match[1] ?? '')

    return { x: Number(attributes.x), y: Number(attributes.y), width: Number(attributes.width), height: Number(attributes.height) }
  })
