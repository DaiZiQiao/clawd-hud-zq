import type { ImagesTile } from '../types'
import { COMPACT_SEPARATOR, TILE_GAP } from './strip-layout'
import type { Layout, LayoutInput } from './strip-layout'

// The strip layout's test fixtures: the rooms the band was measured to give
// (fullscreen 80x24, 120x30 and 120x40, and the main screen at 80x24, each
// with a one-line draft), tiles of the shapes people paste, and the strip
// drawn as plain lines (`▀` for a picture's cells), to measure its rows and
// columns and to set beside the mockups.

/** Fullscreen 80x24: 75 columns beside the `[-]`, 7 rows. */
export const ROOM_80X24 = { bodyColumns: 75, maxRows: 7, viewportRows: 24 } as const
/** Windows Terminal's default, 120x30, fullscreen. */
export const ROOM_120X30 = { bodyColumns: 115, maxRows: 10, viewportRows: 30 } as const
export const ROOM_120X40 = { bodyColumns: 115, maxRows: 15, viewportRows: 40 } as const
/** The main screen at 80x24: the band is offered the whole height. */
export const ROOM_MAIN_80X24 = { bodyColumns: 75, maxRows: 24, viewportRows: 24 } as const

/** A 16:9 screenshot, decoded. */
export const shot = (id: number, more: Partial<ImagesTile> = {}): ImagesTile =>
  ({ id, state: 'ready', format: 'png', width: 1920, height: 1080, seenAt: 0, ...more })

/** A 4:3 photo, decoded. */
export const photo = (id: number, more: Partial<ImagesTile> = {}): ImagesTile =>
  ({ id, state: 'ready', format: 'jpeg', width: 2000, height: 1500, seenAt: 0, ...more })

/** A phone screenshot, portrait, decoded. */
export const phone = (id: number, more: Partial<ImagesTile> = {}): ImagesTile =>
  ({ id, state: 'ready', format: 'png', width: 1170, height: 2532, seenAt: 0, ...more })

/** A square picture, decoded. */
export const square = (id: number, more: Partial<ImagesTile> = {}): ImagesTile =>
  ({ id, state: 'ready', format: 'png', width: 500, height: 500, seenAt: 0, ...more })

/** A tile in a state with no size: pending, failed or not attached. */
export const bare = (id: number, state: ImagesTile['state'], reason?: string): ImagesTile =>
  ({ id, state, seenAt: 0, ...(reason === undefined ? {} : { reason }) })

/** A layout input in blocks mode at the default height, in the 80x24 room. */
export const inputOf = (tiles: readonly ImagesTile[], more: Partial<LayoutInput> = {}): LayoutInput =>
  ({ tiles, ...ROOM_80X24, height: 8, mode: 'blocks', shared: false, ...more })

/**
 * The layout as the band draws it, one string per row: each picture's cells
 * as `▀`, a blank between tiles, the label row's words in each tile's columns
 * and the overflow note after them; the compact row's swatches as `▀▀`.
 */
export const linesOf = (layout: Layout): string[] => {
  if (layout.kind === 'none') return []
  if (layout.kind === 'text') return [layout.line]
  if (layout.kind === 'compact') {
    const items = layout.items.map(item => `${item.swatch ? '▀▀ ' : ''}${item.label}${item.detail === undefined ? '' : ` ${item.detail}`}`)

    return [[...items, ...(layout.overflow === undefined ? [] : [layout.overflow])].join(COMPACT_SEPARATOR)]
  }
  const gap = ' '.repeat(TILE_GAP)
  const cells = layout.tiles.map(tile => '▀'.repeat(tile.columns)).join(gap)
  const labels = layout.tiles.map(tile => `${tile.label}${tile.detail === undefined ? '' : ` ${tile.detail}`}`.padEnd(tile.columns)).join(gap)
  const labelRow = layout.overflow === undefined ? labels : `${labels}${gap}${layout.overflow}`

  return [...Array.from({ length: layout.rows }, () => cells), labelRow.trimEnd()]
}

/** A deterministic stream of whole numbers below `below`: a fixed-seed linear congruential generator. */
export const randomOf = (seed: number): ((below: number) => number) => {
  let state = seed >>> 0

  return below => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0

    return state % below
  }
}
