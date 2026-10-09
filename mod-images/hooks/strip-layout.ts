import type { ImagesTile } from '../types'
import { clamp, FORMAT_NAMES } from './image-types'

// Where the strip goes in the band above the prompt (`AbovePrompt`): how many
// rows the thumbnails take, how wide each tile is, what the label row under
// them says, and what does not fit. The band offers `maxRows` rows (in
// fullscreen what half the screen leaves above the prompt; on the main screen
// the whole height, which the strip caps the same way) and `bodyColumns`
// columns beside the engine's `[-]`. Numbers and words only: hooks/strip.tsx
// draws them, each Raster and Image at exactly its tile's size.
//
// What the drawing keeps to, and the tests check:
// - strip: `rows` rows of tiles, one blank column between two tiles, then a
//   label row: each tile's `label`, then a blank and its `detail` when it has
//   one, within the tile's columns; after the last tile, a blank and
//   `overflow`. The strip is `rows + 1` rows tall.
// - compact: one row of items, each a swatch (two cells, then a blank) when
//   `swatch`, its `label`, then a blank and its `detail` when it has one;
//   items and `overflow` apart by ` · `.
// - text: the one line.
// Labels, details and notes are ASCII (ids, formats, sizes, the reason
// words): a character to a cell, `…` included.

/** How the pictures draw: real pixels (Image), half-block cells (Raster), or one line of text. */
export type LayoutMode = 'pixels' | 'blocks' | 'text'

export type LayoutInput = {
  /** The draft's tiles, ascending id, in any state. */
  tiles: readonly ImagesTile[]
  /** The band's `bodyColumns`. */
  bodyColumns: number
  /** The band's `maxRows`. */
  maxRows: number
  /** The screen's rows (`e.viewport?.rows`), when known. */
  viewportRows?: number
  /** The `height` option, already within 3..20. */
  height: number
  mode: LayoutMode
  /** Another plugin draws in the band too, or a survey shows: one row only. */
  shared: boolean
  /** The last strip's thumbnail rows and tile count, which the hooks keep for the process: the strip grows only when the count changes. */
  previous?: { rows: number; count: number }
}

/** A tile placed in the strip: its box in cells, and its label row. */
export type PlacedTile = { id: number; columns: number; rows: number; label: string; detail?: string }

/** An item of the compact row; `swatch` draws the picture as two cells before the label. */
export type CompactItem = { id: number; label: string; detail?: string; swatch: boolean }

/**
 * What the band draws: nothing; one line of text; one compact row; or the
 * strip, whose `rows` is the thumbnails' height (the label row is one more),
 * whose `hidden` are the ids `overflow` names, and whose `kittyBytes` is each
 * picture's allowance of inline Image bytes (0 for blocks).
 */
export type Layout =
  | { kind: 'none' }
  | { kind: 'text'; line: string }
  | { kind: 'compact'; items: CompactItem[]; overflow?: string }
  | { kind: 'strip'; rows: number; tiles: PlacedTile[]; hidden: number[]; overflow?: string; kittyBytes: number }

/** Thumbnails are never shorter than this: below it, one compact row. */
export const ROWS_MIN = 3
/** Bytes of inline Image source per tree, under the engine's 2 MiB refusal. */
export const KITTY_BUDGET = 1_900_000
/** Cells per Raster thumbnail: its palette holds 1024 colour pairs, so it never paints a pair as its nearest. */
export const BLOCK_CELLS_CAP = 1024
/** Columns between two tiles, and before the overflow note. */
export const TILE_GAP = 1
/** Between two items of the compact row, and before its overflow note. */
export const COMPACT_SEPARATOR = ' · '
/** A compact item's swatch: two cells, then a blank. */
export const SWATCH_COLUMNS = 2

/** The rows the prompt's area takes below the band in fullscreen: the effort row, two rules, the input and the footer. */
const PROMPT_ROWS = 5
/** A picture tile is never narrower than this (nor than it is tall): room for `#N`. */
const PICTURE_COLUMNS_MIN = 6
/** A tile with no picture to size it (no size yet, failed, not attached) is never narrower than this: its frame holds `no preview`. */
const PLAIN_COLUMNS_MIN = 12

const READING = 'reading'
const NOT_ATTACHED = 'not attached'

/**
 * The rows the strip may take: the band's `maxRows`, and never more than half
 * the screen less the prompt's five, which is what fullscreen gives (7 at
 * 80x24, 10 at 120x30, 15 at 120x40) and what the main screen, whose band is
 * the whole height, keeps to as well.
 */
export const rowsCapOf = (maxRows: number, viewportRows: number | undefined): number => {
  const band = Number.isFinite(maxRows) ? Math.floor(maxRows) : 0
  if (viewportRows === undefined || !Number.isFinite(viewportRows)) return band

  return Math.min(band, Math.floor(viewportRows / 2) - PROMPT_ROWS)
}

// --- words -----------------------------------------------------------------

// ASCII cut to `width` cells, ending in `…` when cut.
const cut = (text: string, width: number): string =>
  text.length <= width ? text : width <= 0 ? '' : `${text.slice(0, width - 1)}…`

const sizeOf = (tile: ImagesTile): { width: number; height: number } | undefined =>
  tile.width !== undefined && tile.height !== undefined && tile.width > 0 && tile.height > 0
    && Number.isFinite(tile.width) && Number.isFinite(tile.height)
    ? { width: tile.width, height: tile.height }
    : undefined

/** A tile that is, or soon will be, a picture: its size known and nothing wrong with it. */
const pictureSizeOf = (tile: ImagesTile): { width: number; height: number } | undefined =>
  tile.state === 'failed' || tile.state === 'not-attached' ? undefined : sizeOf(tile)

/** What the label row says beside `#N`: the size of a picture, else the tile's state in a word. */
const detailOf = (tile: ImagesTile): string | undefined => {
  if (tile.state === 'ready') {
    const size = sizeOf(tile)

    return size === undefined ? undefined : `${size.width}x${size.height}`
  }
  if (tile.state === 'failed') return tile.reason

  return tile.state === 'not-attached' ? NOT_ATTACHED : READING
}

const noteOf = (hidden: readonly number[]): string => `+${hidden.length}: ${hidden.map(id => `#${id}`).join(' ')}`

// The note cut to `room`: as many hidden ids as fit, then `…`; `+K` alone;
// undefined when not even that fits.
const cutNoteOf = (hidden: readonly number[], room: number): string | undefined => {
  for (let named = hidden.length - 1; named >= 1; named -= 1) {
    const note = `+${hidden.length}: ${hidden.slice(0, named).map(id => `#${id}`).join(' ')} …`
    if (note.length <= room) return note
  }
  const bare = `+${hidden.length}`

  return bare.length <= room ? bare : undefined
}

/**
 * How many of the leading items fit in `room` columns, `gap` apart, with a
 * note after them naming the rest: every hidden id when that leaves one item
 * or more, else as many ids as fit. Undefined when not one item fits with a
 * note.
 */
const packedOf = (widths: readonly number[], gap: number, room: number, ids: readonly number[]): { count: number; overflow?: string } | undefined => {
  // used[k]: the first k items with their gaps.
  const used = [0]
  for (const width of widths) used.push((used.length > 1 ? (used.at(-1) ?? 0) + gap : 0) + width)
  if ((used.at(-1) ?? 0) <= room) return { count: widths.length }
  for (let count = widths.length - 1; count >= 1; count -= 1) {
    const note = noteOf(ids.slice(count))
    if ((used[count] ?? 0) + gap + note.length <= room) return { count, overflow: note }
  }
  for (let count = widths.length - 1; count >= 1; count -= 1) {
    const note = cutNoteOf(ids.slice(count), room - (used[count] ?? 0) - gap)
    if (note !== undefined) return { count, overflow: note }
  }

  return undefined
}

// --- one line of text ------------------------------------------------------

// A tile in the sentence: `#1 PNG 1920 by 1080` in full, `#1 PNG` shorter,
// `#1` shortest.
const spokenOf = (tile: ImagesTile, brevity: number): string => {
  const format = tile.format === undefined || brevity > 1 ? '' : ` ${FORMAT_NAMES[tile.format]}`
  const size = brevity > 0 ? undefined : sizeOf(tile)

  return `#${tile.id}${format}${size === undefined ? '' : ` ${size.width} by ${size.height}`}`
}

/**
 * `Images attached: #1 PNG 1920 by 1080, #2 JPEG 2000 by 1500, #3 WebP.`,
 * then `Not attached: #4.` for chips Claude Code sends no picture for; the
 * sizes, then the formats, dropped when the line would be wider than the
 * band, and then the line cut.
 */
const textLineOf = (tiles: readonly ImagesTile[], columns: number): string => {
  const attached = tiles.filter(tile => tile.state !== 'not-attached')
  const loose = tiles.filter(tile => tile.state === 'not-attached')
  const lineOf = (brevity: number): string => [
    attached.length === 0 ? '' : `Images attached: ${attached.map(tile => spokenOf(tile, brevity)).join(', ')}.`,
    loose.length === 0 ? '' : `Not attached: ${loose.map(tile => `#${tile.id}`).join(', ')}.`,
  ].filter(part => part !== '').join(' ')
  for (const brevity of [0, 1, 2]) {
    const line = lineOf(brevity)
    if (line.length <= columns) return line
  }

  return cut(lineOf(2), columns)
}

// --- one compact row -------------------------------------------------------

const compactOf = (tiles: readonly ImagesTile[], columns: number): Layout => {
  const itemOf = (tile: ImagesTile): CompactItem => ({ id: tile.id, label: `#${tile.id}`, swatch: tile.state === 'ready' })
  const baseOf = (item: CompactItem): number => (item.swatch ? SWATCH_COLUMNS + 1 : 0) + item.label.length
  const gap = COMPACT_SEPARATOR.length
  const packed = packedOf(tiles.map(tile => baseOf(itemOf(tile))), gap, columns, tiles.map(tile => tile.id))
  if (packed === undefined) {
    // Not one item with a note: the first alone, cut to the room.
    const first = tiles[0]
    if (first === undefined) return { kind: 'none' }
    const item = itemOf(first)

    return { kind: 'compact', items: [{ ...item, label: cut(item.label, columns), swatch: item.swatch && baseOf(item) <= columns }] }
  }
  const shown = tiles.slice(0, packed.count)
  let used = shown.reduce((sum, tile) => sum + baseOf(itemOf(tile)), 0) + gap * (shown.length - 1)
    + (packed.overflow === undefined ? 0 : gap + packed.overflow.length)
  // Each item's word where it fits, left to right.
  const items = shown.map(tile => {
    const item = itemOf(tile)
    const detail = detailOf(tile)
    if (detail === undefined || used + 1 + detail.length > columns) return item
    used += 1 + detail.length

    return { ...item, detail }
  })

  return { kind: 'compact', items, ...(packed.overflow === undefined ? {} : { overflow: packed.overflow }) }
}

// --- the strip -------------------------------------------------------------

/**
 * A tile's width at `rows` rows: a picture as wide as its aspect asks (cells
 * are about twice as tall as wide), within max(rows, 6) and 4 x rows, a
 * Raster within BLOCK_CELLS_CAP cells; a tile with no picture to size it 2 x
 * rows, within 12 and 4 x rows.
 */
const tileColumnsOf = (tile: ImagesTile, rows: number, mode: LayoutMode): number => {
  const size = pictureSizeOf(tile)
  if (size === undefined) return clamp(2 * rows, PLAIN_COLUMNS_MIN, 4 * rows)
  const most = mode === 'blocks' ? Math.min(4 * rows, Math.floor(BLOCK_CELLS_CAP / rows)) : 4 * rows
  const least = Math.min(Math.max(rows, PICTURE_COLUMNS_MIN), most)

  return clamp(Math.round((2 * rows * size.width) / size.height), least, most)
}

const rowWidthOf = (widths: readonly number[]): number =>
  widths.reduce((sum, width) => sum + width, 0) + TILE_GAP * Math.max(0, widths.length - 1)

const placedTileOf = (tile: ImagesTile, columns: number, rows: number): PlacedTile => {
  const label = cut(`#${tile.id}`, columns)
  const detail = detailOf(tile)
  const isShown = detail !== undefined && label.length + 1 + detail.length <= columns

  return { id: tile.id, columns, rows, label, ...(isShown ? { detail } : {}) }
}

const stripOf = (input: LayoutInput, rowsCap: number, columns: number): Layout => {
  const { tiles, mode, previous } = input
  const height = Number.isFinite(input.height) ? Math.floor(input.height) : ROWS_MIN
  const most = Math.min(Math.max(ROWS_MIN, height), rowsCap - 1)
  // The same count as last time: never grow, only shrink when it no longer fits.
  const isSameCount = previous !== undefined && previous.count === tiles.length && Number.isFinite(previous.rows) && previous.rows >= ROWS_MIN
  const start = isSameCount ? Math.min(Math.floor(previous.rows), most) : most
  const placedOf = (rows: number, widths: readonly number[], count: number, overflow: string | undefined): Layout => {
    const shown = tiles.slice(0, count)
    // Every tile that is or may soon be a picture shares the budget, so one finishing its decode never pushes the tree past it.
    const pictures = shown.filter(tile => tile.state === 'ready' || tile.state === 'reading' || tile.state === 'pending').length

    return {
      kind: 'strip',
      rows,
      tiles: shown.map((tile, at) => placedTileOf(tile, widths[at] ?? 0, rows)),
      hidden: tiles.slice(count).map(tile => tile.id),
      ...(overflow === undefined ? {} : { overflow }),
      kittyBytes: mode === 'pixels' ? Math.floor(KITTY_BUDGET / Math.max(1, pictures)) : 0,
    }
  }
  for (let rows = start; rows >= ROWS_MIN; rows -= 1) {
    const widths = tiles.map(tile => tileColumnsOf(tile, rows, mode))
    if (rowWidthOf(widths) <= columns) return placedOf(rows, widths, tiles.length, undefined)
  }
  const widths = tiles.map(tile => tileColumnsOf(tile, ROWS_MIN, mode))
  const packed = packedOf(widths, TILE_GAP, columns, tiles.map(tile => tile.id))

  return packed === undefined
    ? compactOf(tiles, columns)
    : placedOf(ROWS_MIN, widths, packed.count, packed.overflow)
}

/**
 * The strip for the room the band gives:
 * - none: no tiles, or no room (rowsCapOf under 1, no columns);
 * - text: one sentence naming the images (mode `text`);
 * - compact: one row of `#N` items, when the band is shared or under four
 *   rows, or not one tile fits;
 * - strip: thumbnails `rows` high (the `height` option or the room less the
 *   label row, whichever is less), shrunk a row at a time down to ROWS_MIN
 *   until every tile fits the columns; past that, as many tiles as fit, and
 *   the rest named on the label row (`+2: #6 #7`). With `previous` of the
 *   same count it keeps that height while it fits and never grows.
 * Never more rows than rowsCapOf, never a line wider than `bodyColumns`.
 */
export const layoutOf = (input: LayoutInput): Layout => {
  const { tiles, mode } = input
  const columns = Number.isFinite(input.bodyColumns) ? Math.floor(input.bodyColumns) : 0
  const rowsCap = rowsCapOf(input.maxRows, input.viewportRows)
  if (tiles.length === 0 || rowsCap < 1 || columns < 1) return { kind: 'none' }
  if (mode === 'text') return { kind: 'text', line: textLineOf(tiles, columns) }
  if (input.shared || rowsCap < ROWS_MIN + 1) return compactOf(tiles, columns)

  return stripOf(input, rowsCap, columns)
}
