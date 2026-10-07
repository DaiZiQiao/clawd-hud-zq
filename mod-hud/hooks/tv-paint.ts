import { CELL_HEIGHT, CELL_WIDTH, escapeText, num } from './svg-style'
import { textRowSvg } from './text-svg'
import type { TextSpan } from './text-svg'
import { displayWidth, truncate } from './text-width'
import { figureCells, giantOf, scaled } from './tv-figure'
import type { Box, Figure, Shape } from './tv-figure'
import { cellText, channelPanelOf, isPress, scrollPanelOf, shownRows, thumbOf } from './tv-model'
import type { Glass, PanelPart, TvInputs, TvLayout, TvLook, TvRow } from './tv-model'

// A frame of the TV drawn: on the terminal as cells over the region (the
// mascot's quadrant glyphs, the glass's text, the panels' controls; every
// cell the TV does not draw left to show the pane through), on the desktop
// as one document the region's size (a dim over the pane, the mascot's
// quarters in pixels, the glass, the panels, the ✕). The glass keeps its own
// colours whatever the theme: light text on dark glass, as a screen is.

/** The TV's own colours: the glass, its text (theme keys as a lit screen shows them), the panels, the ✕. */
export const TV_COLOURS = {
  glass: '#0F2224',
  bezel: '#0A1617',
  text: '#E6F4EF',
  line: '#F4FFFB',
  panel: '#F3E6CC',
  button: '#E2CFA6',
  knob: '#6B4A3A',
  grille: '#B9A27A',
  close: '#E5484D',
  osd: '#7CFC9A',
  static: '#8FA8A3',
} as const

const PHOSPHOR: Readonly<Record<string, string>> = { claude: '#FFB38A', success: '#7EE0A0', warning: '#FFD479', error: '#FF8A9A', inactive: '#9FB5B0', text: TV_COLOURS.text, permission: '#C3C9FF', suggestion: '#C3C9FF' }

/** A colour on the glass: a theme key as the lit screen shows it, a raw colour as it is. */
export const glassColour = (color: string | undefined): string => (color === undefined ? TV_COLOURS.text : color.startsWith('#') ? color : PHOSPHOR[color] ?? TV_COLOURS.text)

/** One cell the TV draws on the terminal; `tail` the second cell of a wide glyph. */
export type TvOut = { ch: string; color?: string; bg?: string; bold?: true; dim?: true; italic?: true; strike?: true } | { tail: true }

/** The giant's frame from the layout. */
export const shapeOf = (layout: TvLayout): Shape => ({ width: layout.width, height: layout.height, body: layout.body, tv: layout.tv })

/** A deterministic flicker of static for a seed and a cell. */
const noise = (seed: number, x: number, y: number): number => {
  let h = (seed * 374761393 + x * 668265263 + y * 2147483647) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0

  return (h ^ (h >>> 16)) / 4294967296
}

/** The sprite at a frame: its quarters `scale` of the way to the giant's box, and its top-left in cells, `travel` of the way from where it stood to the centre. */
export const spriteFrame = (sprite: Figure, inputs: Pick<TvInputs, 'layout' | 'from'>, travel: number, scale: number): { figure: Figure; x: number; y: number; w: number; h: number } => {
  const { layout } = inputs
  const ownW = Math.max(0, ...sprite.bitmap.map(row => row.length))
  const ownH = sprite.bitmap.length
  const w = Math.max(1, Math.round(ownW + (layout.width * 2 - ownW) * scale))
  const h = Math.max(1, Math.round(ownH + (layout.height * 2 - ownH) * scale))
  const centre = { x: layout.left + layout.width / 2, y: layout.top + layout.height / 2 }
  const start = inputs.from === undefined ? centre : { x: inputs.from.x + ownW / 4, y: inputs.from.y + ownH / 4 }
  const at = { x: start.x + (centre.x - start.x) * travel, y: start.y + (centre.y - start.y) * travel }

  return { figure: scaled(sprite, w, h), x: at.x - w / 4, y: at.y - h / 4, w, h }
}

// --- the terminal ---------------------------------------------------------------------

type Grid = (TvOut | undefined)[][]

const put = (grid: Grid, x: number, y: number, cell: TvOut): void => {
  const row = grid[y]
  if (row === undefined || x < 0 || x >= row.length) return
  // A wide glyph's half overwritten: its other half goes blank with it.
  const was = row[x]
  if (was !== undefined && 'tail' in was && x > 0) row[x - 1] = { ch: ' ', ...(isCell(row[x - 1]) ? { bg: (row[x - 1] as { bg?: string }).bg } : {}) }
  if (was !== undefined && !('tail' in was) && displayWidth(was.ch) === 2 && row[x + 1] !== undefined) row[x + 1] = { ch: ' ', ...(was.bg === undefined ? {} : { bg: was.bg }) }
  row[x] = cell
}

const isCell = (cell: TvOut | undefined): cell is Exclude<TvOut, { tail: true }> => cell !== undefined && !('tail' in cell)

/** A string laid from (x, y) in one look, a wide glyph taking two cells. */
const write = (grid: Grid, x: number, y: number, text: string, look: Omit<Exclude<TvOut, { tail: true }>, 'ch'>): void => {
  let at = x
  for (const glyph of [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].map(one => one.segment)) {
    const cells = displayWidth(glyph)
    if (cells === 0) continue
    put(grid, at, y, { ch: glyph, ...look })
    if (cells === 2) put(grid, at + 1, y, { tail: true })
    at += cells
  }
}

/** A box's top or bottom row, its corners round: `▗▄…▄▖` or `▝▀…▀▘` in `colour` (over the body's colour, laid after). */
const roundRow = (grid: Grid, box: Box, y: number, top: boolean, colour: string): void => {
  for (let x = box.x; x < box.x + box.w; x += 1) {
    const ch = top ? (x === box.x ? '▗' : x === box.x + box.w - 1 ? '▖' : '▄') : x === box.x ? '▝' : x === box.x + box.w - 1 ? '▘' : '▀'
    put(grid, x, y, { ch, color: colour })
  }
}

/** A row of the glass as cells: its spans and presses in the glass's colours, cut to the glass's text width. */
const rowCells = (row: TvRow, width: number): { text: string; look: Omit<Exclude<TvOut, { tail: true }>, 'ch'> }[] => {
  const out: { text: string; look: Omit<Exclude<TvOut, { tail: true }>, 'ch'> }[] = []
  let used = 0
  for (const cell of row.cells) {
    const full = cellText(cell)
    const room = width - used
    if (room <= 0) break
    const text = displayWidth(full) <= room ? full : truncate(full, room)
    const look = isPress(cell)
      ? { color: cell.primary === true ? PHOSPHOR.claude : glassColour(undefined), ...(cell.primary === true ? { bold: true as const } : {}), ...(cell.dim === true ? { dim: true as const } : {}) }
      : { color: glassColour(cell.color), ...(cell.bold === true ? { bold: true as const } : {}), ...(cell.dim === true ? { dim: true as const } : {}), ...(cell.italic === true ? { italic: true as const } : {}), ...(cell.strike === true ? { strike: true as const } : {}) }
    out.push({ text, look })
    used += displayWidth(text)
  }

  return out
}

/** The parts of a panel as glyphs, centred in its width. */
const PANEL_GLYPHS: Readonly<Record<Exclude<PanelPart, 'blank' | 'label' | 'arrows'>, string>> = { 'knob-top': '▟█▙', 'knob-bottom': '▜█▛', up: '▲', down: '▼', grille: '═══' }

const panelCells = (grid: Grid, box: Box, parts: readonly PanelPart[], label: string): void => {
  roundRow(grid, box, box.y, true, TV_COLOURS.panel)
  roundRow(grid, box, box.y + box.h - 1, false, TV_COLOURS.panel)
  parts.forEach((part, row) => {
    const y = box.y + 1 + row
    for (let x = box.x; x < box.x + box.w; x += 1) put(grid, x, y, { ch: ' ', bg: TV_COLOURS.panel })
    const centred = (text: string, look: Omit<Exclude<TvOut, { tail: true }>, 'ch'>): void => write(grid, box.x + Math.floor((box.w - displayWidth(text)) / 2), y, text, look)
    switch (part) {
      case 'blank':
        return
      case 'label':
        return centred(label, { color: TV_COLOURS.knob, bg: TV_COLOURS.panel, dim: true })
      case 'arrows':
        return centred(box.w >= 5 ? '◀ ▶' : '◀▶', { color: TV_COLOURS.knob, bg: TV_COLOURS.panel, bold: true })
      case 'up':
      case 'down':
        for (let x = box.x + 1; x < box.x + box.w - 1; x += 1) put(grid, x, y, { ch: ' ', bg: TV_COLOURS.button })

        return centred(PANEL_GLYPHS[part], { color: TV_COLOURS.knob, bg: TV_COLOURS.button, bold: true })
      case 'grille':
        return centred(PANEL_GLYPHS.grille.slice(0, Math.max(1, box.w - 2)), { color: TV_COLOURS.grille, bg: TV_COLOURS.panel })
      default:
        return centred(PANEL_GLYPHS[part], { color: TV_COLOURS.knob, bg: TV_COLOURS.panel })
    }
  })
}

/** The glass's text rows for what it shows this frame. */
const glassCells = (grid: Grid, inputs: TvInputs, glass: Glass, scroll: number, osd: string | undefined): void => {
  const { layout } = inputs
  const box = layout.glass
  roundRow(grid, box, box.y, true, TV_COLOURS.glass)
  roundRow(grid, box, box.y + box.h - 1, false, TV_COLOURS.glass)
  const textX = box.x + 1
  const width = layout.content
  const middle = Math.floor((layout.screen - 1) / 2)
  const shown = shownRows(inputs, scroll)
  const thumb = thumbOf(inputs, scroll)
  for (let row = 0; row < layout.screen; row += 1) {
    const y = box.y + 1 + row
    for (let x = box.x; x < box.x + box.w; x += 1) put(grid, x, y, { ch: ' ', bg: TV_COLOURS.glass })
    const lit = glass.kind === 'on' || (glass.kind === 'open' && Math.abs(row - middle) <= Math.round(((layout.screen - 1) / 2) * glass.height))
    if (lit) {
      let x = textX
      for (const run of rowCells(shown[row] ?? { key: '', cells: [] }, width)) {
        write(grid, x, y, run.text, { ...run.look, bg: TV_COLOURS.glass })
        x += displayWidth(run.text)
      }
      // The scrollbar: its track by the tab's rows, its thumb where they are.
      const at = row - Math.min(inputs.head.length, layout.screen)
      if (glass.kind === 'on' && thumb !== undefined && at >= 0) {
        const on = at >= thumb.from && at < thumb.from + thumb.length
        put(grid, box.x + box.w - 1, y, { ch: on ? '┃' : '│', color: on ? TV_COLOURS.text : TV_COLOURS.static, bg: TV_COLOURS.glass, ...(on ? {} : { dim: true as const }) })
      }
    } else if (glass.kind === 'line' && row === middle) {
      const length = Math.max(1, Math.round(width * glass.width))
      write(grid, textX + Math.floor((width - length) / 2), y, '━'.repeat(length), { color: TV_COLOURS.line, bg: TV_COLOURS.glass, bold: true })
    } else if (glass.kind === 'dot' && row === middle) {
      write(grid, textX + Math.floor(width / 2), y, glass.fade >= 0.5 ? '●' : '·', { color: TV_COLOURS.line, bg: TV_COLOURS.glass, ...(glass.fade >= 0.5 ? { bold: true as const } : { dim: true as const }) })
    } else if (glass.kind === 'static') {
      for (let x = 0; x < width; x += 1) {
        const n = noise(glass.seed, x, row)
        const ch = n < 0.35 ? ' ' : n < 0.6 ? '░' : n < 0.8 ? '▒' : n < 0.92 ? '·' : '▓'
        put(grid, textX + x, y, { ch, color: TV_COLOURS.static, bg: TV_COLOURS.glass })
      }
    }
  }
  // The channel on the glass's top right, a moment after it changes.
  if (osd !== undefined && glass.kind === 'on') write(grid, textX + width - displayWidth(osd), box.y + 1, osd, { color: TV_COLOURS.osd, bg: TV_COLOURS.glass, bold: true })
}

/**
 * A frame on the terminal: the region's cells the TV draws (undefined where
 * the pane shows through). The giant at the figure's place with its TV, or
 * the sprite on its way; `scroll` the glass's, `osd` the channel shown on it.
 */
export const paintCells = (inputs: TvInputs, look: TvLook | undefined, scroll: number, sprite: Figure, osd?: string): Grid => {
  const grid: Grid = Array.from({ length: Math.max(0, inputs.rows) }, () => Array.from({ length: Math.max(0, inputs.columns) }, () => undefined))
  if (look === undefined) return grid
  const lay = (figure: Figure, x: number, y: number): void => {
    figureCells(figure).forEach((row, dy) => row.forEach((cell, dx) => {
      if (cell === undefined) return
      put(grid, x + dx, y + dy, { ch: cell.ch, color: cell.colour, ...(cell.bg === undefined ? {} : { bg: cell.bg }) })
    }))
  }
  if (look.form === 'sprite') {
    const at = spriteFrame(sprite, inputs, look.travel, look.scale)
    lay(at.figure, Math.round(at.x), Math.round(at.y))

    return grid
  }
  const { layout } = inputs
  const shifted = (box: Box): Box => ({ ...box, x: box.x + layout.left, y: box.y + layout.top })
  lay(giantOf(inputs.who, shapeOf(layout), look.eyes), layout.left, layout.top)
  const placed: TvInputs = { ...inputs, layout: { ...layout, glass: shifted(layout.glass) } }
  // The panels' round rows and the glass's sit on the body's colour.
  const bodyColour = inputs.who.colour
  glassCells(grid, placed, look.glass, scroll, osd)
  panelCells(grid, shifted(layout.channel), channelPanelOf(layout.screen), 'CH')
  panelCells(grid, shifted(layout.scroll), scrollPanelOf(layout.screen), '')
  for (const box of [layout.glass, layout.channel, layout.scroll]) {
    for (const y of [box.y, box.y + box.h - 1]) {
      for (let x = box.x; x < box.x + box.w; x += 1) {
        const cell = grid[layout.top + y]?.[layout.left + x]
        if (isCell(cell)) (grid[layout.top + y] as (TvOut | undefined)[])[layout.left + x] = { ...cell, bg: bodyColour }
      }
    }
  }
  write(grid, layout.left + layout.close.x, layout.top + layout.close.y, ' ✕ ', { color: '#FFFFFF', bg: TV_COLOURS.close, bold: true })

  return grid
}

// --- the desktop -----------------------------------------------------------------------

/** A figure's quarters as rects, a run of one key a rect, from (x, y) in pixels, each quarter `qw` by `qh`. */
const figureRects = (figure: Figure, x: number, y: number, qw: number, qh: number): string => {
  const rects: string[] = []
  figure.bitmap.forEach((row, at) => {
    let from = 0
    while (from < row.length) {
      const key = row[from] as string
      let to = from
      while (to < row.length && row[to] === key) to += 1
      const fill = figure.palette[key]
      if (key !== '.' && fill !== undefined) rects.push(`<rect x='${num(x + from * qw)}' y='${num(y + at * qh)}' width='${num((to - from) * qw)}' height='${num(qh)}' fill='${fill}'/>`)
      from = to
    }
  })

  return rects.join('')
}

/** A row of the glass as a document in it: its spans in the glass's colours (a press as its text), at (x, y) in pixels. */
const rowDocument = (row: TvRow, width: number, x: number, y: number): string => {
  const spans: TextSpan[] = rowCells(row, width).map(run => ({
    text: run.text,
    ...(run.look.color === undefined ? {} : { color: run.look.color }),
    ...(run.look.bold === true ? { bold: true } : {}),
    ...(run.look.dim === true ? { dimColor: true } : {}),
    ...(run.look.italic === true ? { italic: true } : {}),
    ...(run.look.strike === true ? { strikethrough: true } : {}),
  }))
  const { svg } = textRowSvg({ key: row.key, cells: spans })

  return svg === undefined ? '' : svg.source.replace(/^<svg /, `<svg x='${num(x)}' y='${num(y)}' `)
}

const CW = CELL_WIDTH
const CH = CELL_HEIGHT

/** A panel in pixels: cream, round, its controls. */
const panelSvg = (box: Box, parts: readonly PanelPart[], label: string): string => {
  const x = box.x * CW
  const y = box.y * CH + CH / 2
  const w = box.w * CW
  const h = (box.h - 1) * CH
  const cx = x + w / 2
  const items: string[] = [`<rect x='${num(x + 1)}' y='${num(y)}' width='${num(w - 2)}' height='${num(h)}' rx='8' fill='${TV_COLOURS.panel}' stroke='${TV_COLOURS.bezel}' stroke-opacity='.35' stroke-width='2'/>`]
  parts.forEach((part, row) => {
    const top = (box.y + 1 + row) * CH
    const mid = top + CH / 2
    switch (part) {
      case 'knob-top':
        items.push(`<circle cx='${num(cx)}' cy='${num(top + CH)}' r='${num(Math.min(w / 2 - 4, 13))}' fill='${TV_COLOURS.knob}'/><circle cx='${num(cx - 3)}' cy='${num(top + CH - 3)}' r='${num(Math.min(w / 2 - 4, 13) / 3)}' fill='#FFFFFF' opacity='.18'/><line x1='${num(cx)}' y1='${num(top + CH)}' x2='${num(cx + 6)}' y2='${num(top + CH - 7)}' stroke='${TV_COLOURS.panel}' stroke-width='2.5' stroke-linecap='round'/>`)
        break
      case 'label':
        items.push(`<text x='${num(cx)}' y='${num(mid + 4)}' text-anchor='middle' font-family='ui-sans-serif,system-ui,sans-serif' font-size='10' font-weight='bold' fill='${TV_COLOURS.knob}' opacity='.7'>${escapeText(label)}</text>`)
        break
      case 'arrows':
        items.push(`<path d='M${num(cx - 12)} ${num(mid)} l7 -5 v10 z M${num(cx + 12)} ${num(mid)} l-7 -5 v10 z' fill='${TV_COLOURS.knob}'/>`)
        break
      case 'up':
      case 'down':
        items.push(`<rect x='${num(x + 6)}' y='${num(top + 1)}' width='${num(w - 12)}' height='${num(CH - 2)}' rx='4' fill='${TV_COLOURS.button}'/><path d='${part === 'up' ? `M${num(cx - 5)} ${num(mid + 3)} h10 l-5 -7 z` : `M${num(cx - 5)} ${num(mid - 3)} h10 l-5 7 z`}' fill='${TV_COLOURS.knob}'/>`)
        break
      case 'grille':
        items.push(`<rect x='${num(x + 7)}' y='${num(mid - 2)}' width='${num(w - 14)}' height='4' rx='2' fill='${TV_COLOURS.grille}'/>`)
        break
      default:
        break
    }
  })

  return items.join('')
}

/** The glass in pixels for what it shows this frame. */
const glassSvg = (inputs: TvInputs, box: Box, glass: Glass, scroll: number, osd: string | undefined): string => {
  const { layout } = inputs
  const x = box.x * CW
  const y = box.y * CH + CH / 2
  const w = box.w * CW
  const h = (box.h - 1) * CH
  const textX = (box.x + 1) * CW
  const textY = (box.y + 1) * CH
  const midY = textY + (layout.screen * CH) / 2
  const parts: string[] = [
    `<rect x='${num(x - 2)}' y='${num(y - 2)}' width='${num(w + 4)}' height='${num(h + 4)}' rx='12' fill='${TV_COLOURS.bezel}'/>`,
    `<rect x='${num(x)}' y='${num(y)}' width='${num(w)}' height='${num(h)}' rx='10' fill='${TV_COLOURS.glass}'/>`,
  ]
  const rows = (): string => {
    const shown = shownRows(inputs, scroll)
    const thumb = thumbOf(inputs, scroll)
    const out = shown.map((row, index) => rowDocument(row, layout.content, textX, textY + index * CH))
    if (thumb !== undefined) {
      const head = Math.min(inputs.head.length, layout.screen)
      const barX = (box.x + box.w - 1) * CW + CW / 2
      out.push(`<line x1='${num(barX)}' y1='${num(textY + head * CH + 2)}' x2='${num(barX)}' y2='${num(textY + layout.screen * CH - 2)}' stroke='${TV_COLOURS.static}' stroke-opacity='.35' stroke-width='2' stroke-linecap='round'/>`)
      out.push(`<line x1='${num(barX)}' y1='${num(textY + (head + thumb.from) * CH + 3)}' x2='${num(barX)}' y2='${num(textY + (head + thumb.from + thumb.length) * CH - 3)}' stroke='${TV_COLOURS.text}' stroke-width='3' stroke-linecap='round'/>`)
    }

    return out.join('')
  }
  switch (glass.kind) {
    case 'on':
      parts.push(rows())
      if (osd !== undefined) parts.push(`<text x='${num(textX + layout.content * CW)}' y='${num(textY + 12)}' text-anchor='end' font-family='ui-monospace,Menlo,Consolas,monospace' font-size='13' font-weight='bold' fill='${TV_COLOURS.osd}'>${escapeText(osd)}</text>`)
      break
    case 'open': {
      const half = ((layout.screen * CH) / 2) * glass.height
      const clip = `tvclip${Math.round(glass.height * 100)}`
      parts.push(`<clipPath id='${clip}'><rect x='${num(x)}' y='${num(midY - half)}' width='${num(w)}' height='${num(half * 2)}'/></clipPath><g clip-path='url(#${clip})'><rect x='${num(x)}' y='${num(midY - half)}' width='${num(w)}' height='${num(half * 2)}' fill='#FFFFFF' opacity='${num(0.25 * (1 - glass.height))}'/>${rows()}</g>`)
      break
    }
    case 'line': {
      const length = (layout.content * CW) * glass.width
      parts.push(`<rect x='${num(textX + (layout.content * CW - length) / 2)}' y='${num(midY - 2)}' width='${num(length)}' height='4' rx='2' fill='${TV_COLOURS.line}'/><rect x='${num(textX + (layout.content * CW - length) / 2)}' y='${num(midY - 6)}' width='${num(length)}' height='12' rx='6' fill='${TV_COLOURS.line}' opacity='.18'/>`)
      break
    }
    case 'dot':
      parts.push(`<circle cx='${num(textX + (layout.content * CW) / 2)}' cy='${num(midY)}' r='9' fill='${TV_COLOURS.line}' opacity='${num(0.2 * glass.fade)}'/><circle cx='${num(textX + (layout.content * CW) / 2)}' cy='${num(midY)}' r='3.5' fill='${TV_COLOURS.line}' opacity='${num(glass.fade)}'/>`)
      break
    case 'static': {
      const specks: string[] = []
      for (let row = 0; row < layout.screen * 2; row += 1) {
        for (let column = 0; column < layout.content; column += 1) {
          const n = noise(glass.seed, column, row)
          if (n < 0.45) continue
          specks.push(`<rect x='${num(textX + column * CW + (n * 5) % 4)}' y='${num(textY + row * (CH / 2))}' width='3' height='3' fill='${TV_COLOURS.static}' opacity='${num(0.25 + 0.6 * n)}'/>`)
        }
      }
      parts.push(specks.join(''))
      break
    }
    case 'off':
      break
  }
  // A screen's sheen: fine scanlines and a glare in its top-left.
  parts.push(`<rect x='${num(x)}' y='${num(y)}' width='${num(w)}' height='${num(h)}' rx='10' fill='url(#tvscan)'/>`)
  parts.push(`<ellipse cx='${num(x + w * 0.22)}' cy='${num(y + h * 0.14)}' rx='${num(w * 0.18)}' ry='${num(Math.max(4, h * 0.06))}' fill='#FFFFFF' opacity='.06' transform='rotate(-10 ${num(x + w * 0.22)} ${num(y + h * 0.14)})'/>`)

  return parts.join('')
}

/**
 * A frame on the desktop: one document the region's size, the pane dimmed
 * under it; the sprite on its way (blown up smoothly), or the giant with its
 * TV and ✕. Its `alt` names what it shows.
 */
export const paintSvg = (inputs: TvInputs, look: TvLook | undefined, scroll: number, sprite: Figure, osd?: string): { source: string; width: number; height: number } => {
  const width = Math.max(1, inputs.columns) * CW
  const height = Math.max(1, inputs.rows) * CH
  const body: string[] = []
  if (look !== undefined) {
    body.push(`<rect width='${width}' height='${height}' fill='#000000' opacity='${num(look.scrim)}'/>`)
    if (look.form === 'sprite') {
      const at = spriteFrame(sprite, inputs, look.travel, look.scale)
      body.push(figureRects(at.figure, at.x * CW, at.y * CH, CW / 2, CH / 2))
    } else {
      const { layout } = inputs
      const placed = (box: Box): Box => ({ ...box, x: box.x + layout.left, y: box.y + layout.top })
      body.push(figureRects(giantOf(inputs.who, shapeOf(layout), look.eyes), layout.left * CW, layout.top * CH, CW / 2, CH / 2))
      body.push(glassSvg(inputs, placed(layout.glass), look.glass, scroll, osd))
      body.push(panelSvg(placed(layout.channel), channelPanelOf(layout.screen), 'CH'))
      body.push(panelSvg(placed(layout.scroll), scrollPanelOf(layout.screen), ''))
      const cx = (layout.left + layout.close.x + 1.5) * CW
      const cy = (layout.top + layout.close.y + 0.5) * CH
      body.push(`<circle cx='${num(cx)}' cy='${num(cy)}' r='10' fill='${TV_COLOURS.close}' stroke='#FFFFFF' stroke-opacity='.85' stroke-width='2'/><path d='M${num(cx - 4)} ${num(cy - 4)} L${num(cx + 4)} ${num(cy + 4)} M${num(cx + 4)} ${num(cy - 4)} L${num(cx - 4)} ${num(cy + 4)}' stroke='#FFFFFF' stroke-width='2.6' stroke-linecap='round'/>`)
    }
  }
  const defs = `<defs><pattern id='tvscan' width='4' height='3' patternUnits='userSpaceOnUse'><rect width='4' height='1' fill='#FFFFFF' opacity='.05'/></pattern></defs>`
  const source = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}' pointer-events='none' shape-rendering='crispEdges'>${defs}${body.join('')}</svg>`

  return { source, width, height }
}

/** What a frame shows, in words: for the desktop's `alt`. */
export const tvAlt = (inputs: Pick<TvInputs, 'head' | 'tab'>, look: TvLook | undefined): string => {
  if (look === undefined) return '—'
  const title = inputs.head[0]?.cells.map(cellText).join('').trim() ?? ''

  return look.form === 'giant' && look.glass.kind === 'on' ? `TV: ${title} · ${inputs.tab}` : 'TV'
}

