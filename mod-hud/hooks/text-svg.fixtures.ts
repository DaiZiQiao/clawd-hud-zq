import { displayWidth } from './text-width'
import { CELL_HEIGHT, CELL_WIDTH, CLASSES } from './svg-style'
import { BAR_RECTS } from './text-svg'

// The pane's text rows in pixels read back, for the tests: each `<text>` run
// and bar rect back to the cells and the `Text` styles it was drawn from, and
// a row's Buttons laid where their Boxes put them, so one assertion reads the
// terminal's rows and the desktop's.

/** A run as drawn: its first cell, its text, and the `Text` styles it carries. */
export type TextRun = { x: number; text: string; props: Record<string, unknown> }

/** A described element, as `find` and `drawn` hand it. */
type Described = { type?: string; key?: string; props?: Record<string, unknown>; children?: unknown[] }

const THEME_OF: ReadonlyMap<string, string> = new Map(Object.entries(CLASSES).map(([key, name]) => [name, key]))

const attributesOf = (text: string): Record<string, string> =>
  Object.fromEntries([...text.matchAll(/([\w-]+)='([^']*)'/g)].map(match => [match[1] ?? '', match[2] ?? '']))

const unescape = (text: string): string => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** A group's look as `Text` props: its class a theme key (the foreground none), a raw fill a colour; opacity dim; bold; italic. */
const lookOf = (attributes: Record<string, string>): Record<string, unknown> => {
  const theme = attributes.class === undefined ? undefined : THEME_OF.get(attributes.class)
  const color = attributes.class === undefined ? attributes.fill : theme === 'text' ? undefined : theme

  return {
    ...(color === undefined ? {} : { color }),
    ...(attributes['font-weight'] === 'bold' ? { bold: true } : {}),
    ...(attributes.opacity === undefined ? {} : { dimColor: true }),
    ...(attributes['font-style'] === 'italic' ? { italic: true } : {}),
  }
}

/** The document's root size, in cells. */
export const textSvgSize = (source: string): { columns: number; rows: number; width: number; height: number } => {
  const root = attributesOf(/<svg([^>]*)>/.exec(source)?.[1] ?? '')

  return { columns: Number(root.width) / CELL_WIDTH, rows: Number(root.height) / CELL_HEIGHT, width: Number(root.width), height: Number(root.height) }
}

/** Every run of a row's document, left to right: texts as they are, a bar's rect back to its `━` or `─` cells. */
export const textRuns = (source: string): TextRun[] => {
  const runs: TextRun[] = []
  const body = source.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/<style>.*?<\/style>/, '')
  let look: Record<string, unknown> = {}
  let open: { x: number; strike: boolean } | undefined
  for (const match of body.matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>|([^<]+)/g)) {
    const [, closing, tag, rest, , text] = match
    if (text !== undefined) {
      if (open !== undefined) runs.push({ x: open.x, text: unescape(text), props: { ...look, ...(open.strike ? { strikethrough: true } : {}) } })
      continue
    }
    const attributes = attributesOf(rest ?? '')
    if (tag === 'g') look = closing === '/' ? {} : lookOf(attributes)
    else if (tag === 'text') open = closing === '/' ? undefined : { x: Number(attributes.x) / CELL_WIDTH, strike: attributes['text-decoration'] === 'line-through' }
    else if (tag === 'rect') {
      const height = Number(attributes.height)
      const glyph = height === BAR_RECTS['━'].height ? '━' : height === BAR_RECTS['─'].height ? '─' : '?'
      runs.push({ x: Number(attributes.x) / CELL_WIDTH, text: glyph.repeat(Math.round(Number(attributes.width) / CELL_WIDTH)), props: look })
    }
  }

  return runs.sort((a, b) => a.x - b.x)
}

const sameLook = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())

/**
 * The row's pieces as a `Text`'s children read: neighbouring runs of one look
 * as one piece, the blanks between runs a plain piece, from the first cell.
 */
export const textPieces = (source: string): { text: string; props: Record<string, unknown> }[] => {
  const pieces: { text: string; props: Record<string, unknown> }[] = []
  let at = 0
  const push = (text: string, props: Record<string, unknown>): void => {
    const last = pieces.at(-1)
    if (last !== undefined && sameLook(last.props, props)) last.text += text
    else pieces.push({ text, props })
  }
  for (const run of textRuns(source)) {
    if (run.x > at) push(' '.repeat(run.x - at), {})
    push(run.text, run.props)
    at = run.x + displayWidth(run.text)
  }

  return pieces
}

/** The row's document as text: every run at its cell, blanks between, trailing blanks dropped. */
export const textLine = (source: string): string => textPieces(source).map(piece => piece.text).join('').trimEnd()

const isSvgRow = (node: Described): boolean => (node.children ?? []).some(child => (child as Described)?.type === 'Svg' || (child as Described)?.props?.position === 'absolute')

/** A Button as the terminal shows it: `[ label ]`, or a plain one's label alone. */
const buttonShown = (node: Described): string => (node.props?.plain === true ? String(node.props?.label ?? '') : `[ ${String(node.props?.label ?? '')} ]`)

/**
 * A row drawn in pixels as a person reads it: its document's runs, then each
 * Button its Box lays over the row at that Box's `left`. Undefined for any
 * other element.
 */
export const textRowOf = (node: unknown): string | undefined => {
  if (typeof node !== 'object' || node === null) return undefined
  const row = node as Described
  if (row.type !== 'Box' || !isSvgRow(row)) return undefined
  const children = (row.children ?? []) as Described[]
  const svg = children.find(child => child.type === 'Svg')
  const cells = [...(svg === undefined ? '' : textLine(String(svg.props?.source ?? '')))]
  for (const box of children.filter(child => child.props?.position === 'absolute')) {
    const button = ((box.children ?? []) as Described[]).find(child => child.type === 'Button')
    if (button === undefined) continue
    const left = Number(box.props?.left ?? 0)
    const shown = [...buttonShown(button)]
    while (cells.length < left + shown.length) cells.push(' ')
    shown.forEach((char, index) => {
      cells[left + index] = char
    })
  }

  return cells.join('').trimEnd()
}

/** The rows in pixels under a node, top to bottom, as `textRowOf` reads each. */
export const textRowsOf = (node: unknown): string[] => {
  if (typeof node !== 'object' || node === null) return []
  const one = textRowOf(node)
  if (one !== undefined) return [one]

  return ((node as Described).children ?? []).flatMap(textRowsOf)
}

/** Every `Svg` under a node, as described. */
export const svgsOf = (node: unknown): Described[] => {
  if (typeof node !== 'object' || node === null) return []
  const one = node as Described

  return [...(one.type === 'Svg' ? [one] : []), ...(one.children ?? []).flatMap(svgsOf)]
}

/** The document of a row Box, when it has one. */
export const rowSource = (node: unknown): string | undefined => {
  const svg = ((node as Described | undefined)?.children ?? []).find(child => (child as Described)?.type === 'Svg') as Described | undefined

  return svg === undefined ? undefined : String(svg.props?.source ?? '')
}
