import type { BoxProps, ButtonProps, ElementConstructor, RenderElement, SvgProps } from 'claude-code'

import { displayWidth, truncate } from './text-width'
import { BASELINE, CELL_HEIGHT, CELL_WIDTH, CLASSES, FONT_SIZE, SCENE_THEMES, escapeText, isThemeKey, lightRule, num } from './svg-style'
import type { ThemeKey } from './svg-style'

// The pane's text in pixels, for a surface whose text is not a grid of equal
// cells (the desktop sets the pane in a proportional font, so space-padded
// columns drift and squash). One row of coloured spans is one SVG document on
// the scene's grid (hooks/scene-svg.ts: 8 by 16 pixels a cell, the same
// theme colours): a `<text>` per run, set in a monospace stack and stretched
// to exactly its cells, a bar's `━`/`─` run a rect. A row's Buttons are not
// drawn in it: each is laid over its own cells in an absolutely placed Box,
// so a press reaches the same handler as on the terminal. One document per
// row, so a row's Buttons sit on that row whatever height the surface gives a
// cell. The HUD, the TODO section, the lists and the inspect view draw with it.

/** How a run of text looks: the `Text` styles the pane uses. */
export type TextStyle = { color?: string; bold?: boolean; dimColor?: boolean; italic?: boolean; strikethrough?: boolean }

/** A run of text in one look. */
export type TextSpan = TextStyle & { text: string }

/** A Button in a row: `primary` takes `[ label ]`'s cells (the terminal's), a plain one its label's. */
export type TextButton = { button: { key: string; label: string; primary?: true; dimColor?: boolean; onPress: () => void } }

export type TextCell = TextSpan | TextButton

/** One row of text: its key (the row's Box), its cells left to right. */
export type TextRow = { key: string; cells: readonly TextCell[] }

/** A row's Button with where it sits: its first cell and how many it covers. */
export type TextHit = TextButton['button'] & { x: number; width: number }

/** A row as an `Svg`'s props: its document, what it says in words, its size in CSS pixels. */
export type RowSvg = { source: string; alt: string; width: number; height: number }

/** What the rows draw with: a Box, the surface's `Svg`, and its `Button` for rows that have one. */
export type TextSvgElements = { Box: ElementConstructor<BoxProps>; Svg: ElementConstructor<SvgProps>; Button?: ElementConstructor<ButtonProps> }

/** How strong dim text is drawn. */
export const DIM_OPACITY = '.55'

/** A bar's cells as rects: the fill (`━`) thick, the track (`─`) a line, both on the cell's middle. */
export const BAR_RECTS: Readonly<Record<'━' | '─', { y: number; height: number }>> = { '━': { y: 7, height: 3 }, '─': { y: 8, height: 1 } }

export const isTextButton = (cell: TextCell): cell is TextButton => 'button' in cell

/** A Button's cells as the terminal draws it: `[ label ]` primary, the label alone plain. */
export const buttonText = (button: TextButton['button']): string => (button.primary === true ? `[ ${button.label} ]` : button.label)

/**
 * The spans cut to `width` cells (the cut one ending in `…`, as a `Text`
 * cut at its Box's edge) and padded with blanks to exactly `width`.
 */
export const fitted = (spans: readonly TextSpan[], width: number): TextSpan[] => {
  const room = Math.max(0, Math.floor(width))
  const kept: TextSpan[] = []
  let used = 0
  for (const span of spans) {
    const cells = displayWidth(span.text)
    if (used + cells <= room) {
      kept.push(span)
      used += cells
      continue
    }
    const cut = truncate(span.text, room - used)
    if (cut !== '') kept.push({ ...span, text: cut })
    used += displayWidth(cut)
    break
  }

  return used < room ? [...kept, { text: ' '.repeat(room - used) }] : kept
}

/**
 * The cells cut to `width`: spans as `fitted` cuts them, unpadded; a Button
 * that does not fit whole is left out, with everything after it.
 */
export const clipped = (cells: readonly TextCell[], width: number): TextCell[] => {
  const room = Math.max(0, Math.floor(width))
  const kept: TextCell[] = []
  let used = 0
  for (const cell of cells) {
    if (isTextButton(cell)) {
      const cells = displayWidth(buttonText(cell.button))
      if (used + cells > room) break
      kept.push(cell)
      used += cells
      continue
    }
    const cells = displayWidth(cell.text)
    if (used + cells <= room) {
      kept.push(cell)
      used += cells
      continue
    }
    const cut = truncate(cell.text, room - used)
    if (cut !== '') kept.push({ ...cell, text: cut })
    break
  }

  return kept
}

/** A colour as a fill: a raw `#rrggbb` as it is, a theme key as the dark theme's colour and its class, anything else the foreground. */
const paintOf = (color: string | undefined): { fill: string; theme?: ThemeKey } => {
  if (color !== undefined && color.startsWith('#')) return { fill: color }
  const key: ThemeKey = color !== undefined && isThemeKey(color) ? color : 'text'

  return { fill: SCENE_THEMES.dark[key], theme: key }
}

/** One run of a span: words joined by single blanks, or a bar's run of one glyph, at its offset in cells. */
type Piece = { at: number; text: string; bar?: '━' | '─' }

/**
 * A span's runs: its bars apart, its words split at every run of two blanks
 * or more, blanks at either end dropped. A control character (which no XML
 * document may hold) is a blank, in the one cell it is counted.
 */
const piecesOf = (text: string): Piece[] => {
  const out: Piece[] = []
  let at = 0
  for (const part of text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').split(/(━+|─+)/)) {
    if (part === '') continue
    const first = part[0]
    if (first === '━' || first === '─') out.push({ at, text: part, bar: first })
    else for (const match of part.matchAll(/\S+(?: \S+)*/g)) out.push({ at: at + displayWidth(part.slice(0, match.index)), text: match[0] })
    at += displayWidth(part)
  }

  return out
}

/** A look's attributes on its group: the fill (and the class the light scheme recolours), dim as opacity, bold, italic. */
const attributesOf = (style: TextStyle, paint: { fill: string; theme?: ThemeKey }): string =>
  `${paint.theme === undefined ? '' : ` class='${CLASSES[paint.theme]}'`} fill='${paint.fill}'${style.dimColor === true ? ` opacity='${DIM_OPACITY}'` : ''}${style.bold === true ? ` font-weight='bold'` : ''}${style.italic === true ? ` font-style='italic'` : ''}`

/**
 * One row as an SVG document and its Buttons: every span's runs on the grid,
 * a group per look; the Buttons' cells left blank and returned with their
 * places, for the caller to lay a Button over. No document when the row draws
 * nothing but Buttons and blanks. The document is as wide as what it draws.
 */
export const textRowSvg = (row: TextRow): { svg?: RowSvg; hits: TextHit[] } => {
  const groups = new Map<string, string[]>()
  const used = new Set<ThemeKey>()
  const hits: TextHit[] = []
  const words: string[] = []
  let bars = false
  let x = 0
  let end = 0
  for (const cell of row.cells) {
    if (isTextButton(cell)) {
      const width = displayWidth(buttonText(cell.button))
      hits.push({ ...cell.button, x, width })
      x += width
      continue
    }
    const paint = paintOf(cell.color)
    const attributes = attributesOf(cell, paint)
    for (const piece of piecesOf(cell.text)) {
      const left = (x + piece.at) * CELL_WIDTH
      const cells = displayWidth(piece.text)
      const shape = piece.bar === undefined
        ? `<text x='${num(left)}' y='${BASELINE}'${[...piece.text].length > 1 ? ` textLength='${num(cells * CELL_WIDTH)}'` : ''}${cell.strikethrough === true ? ` text-decoration='line-through'` : ''}>${escapeText(piece.text)}</text>`
        : `<rect x='${num(left)}' y='${BAR_RECTS[piece.bar].y}' width='${num(cells * CELL_WIDTH)}' height='${BAR_RECTS[piece.bar].height}'/>`
      const shapes = groups.get(attributes) ?? []
      shapes.push(shape)
      groups.set(attributes, shapes)
      if (paint.theme !== undefined) used.add(paint.theme)
      if (piece.bar === undefined) words.push(piece.text)
      else bars = true
      end = Math.max(end, x + piece.at + cells)
    }
    x += displayWidth(cell.text)
  }
  if (groups.size === 0) return { hits }
  const width = end * CELL_WIDTH
  const body = [...groups].map(([attributes, shapes]) => `<g${attributes}>${shapes.join('')}</g>`).join('')
  // `pointer-events='none'`: where a surface sets the document in its page rather than as an image, a press goes through it to the Buttons.
  const source = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${CELL_HEIGHT}' viewBox='0 0 ${width} ${CELL_HEIGHT}' pointer-events='none'${bars ? ` shape-rendering='crispEdges'` : ''} font-family='ui-monospace,Menlo,Consolas,monospace' font-size='${FONT_SIZE}'>${lightRule(used)}${body}</svg>`

  return { svg: { source, alt: words.length === 0 ? '—' : words.join(' '), width, height: CELL_HEIGHT }, hits }
}

/**
 * A row drawn: a one-row Box keyed as the row, its document, and each Button
 * in an absolute one-row Box over its own cells, keyed as on the terminal so
 * a press reaches the same handler. `box` adds to the row's Box props.
 */
export const renderTextRow = (ui: TextSvgElements, row: TextRow, box: Omit<BoxProps, 'key'> = {}): RenderElement => {
  const { Box, Svg, Button } = ui
  const { svg, hits } = textRowSvg(row)

  return Box({
    key: row.key,
    height: 1,
    flexShrink: 0,
    ...box,
    children: [
      ...(svg === undefined ? [] : [Svg({ source: svg.source, alt: svg.alt, width: svg.width, height: svg.height })]),
      ...(Button === undefined
        ? []
        : hits.map(hit => Box({
            position: 'absolute',
            top: 0,
            left: hit.x,
            width: hit.width,
            height: 1,
            children: Button({
              key: hit.key,
              label: hit.label,
              ...(hit.primary === true ? { variant: 'primary' as const } : { plain: true as const }),
              ...(hit.dimColor === undefined ? {} : { dimColor: hit.dimColor }),
              onPress: () => hit.onPress(),
            }),
          }))),
    ],
  })
}
