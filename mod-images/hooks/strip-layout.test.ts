import { describe, expect, test } from 'claude-code/testing'

import type { ImagesTile } from '../types'
import { BLOCK_CELLS_CAP, KITTY_BUDGET, ROWS_MIN, layoutOf, rowsCapOf } from './strip-layout'
import type { Layout, LayoutInput, LayoutMode } from './strip-layout'
import {
  ROOM_120X30,
  ROOM_120X40,
  ROOM_80X24,
  ROOM_MAIN_80X24,
  bare,
  inputOf,
  linesOf,
  phone,
  photo,
  randomOf,
  shot,
  square,
} from './strip-layout.fixtures'

// The strip's layout in the room the band was measured to give: the rows it
// may take (half the screen less the prompt), thumbnails shrunk to fit every
// tile before any is hidden, the hidden ones named, the compact row and the
// one line of text, hysteresis while typing, the kitty byte budget and the
// Raster's palette cap; and, over a sweep of rooms and tiles, never a row too
// many nor a line too wide.

const stripOf = (layout: Layout): Extract<Layout, { kind: 'strip' }> => {
  if (layout.kind !== 'strip') throw new Error(`a ${layout.kind} layout, not a strip`)

  return layout
}

const PIXEL = '▀'

describe('the room', () => {
  test('rowsCapOf: 7 at 80x24, 10 at 120x30, 15 at 120x40 in fullscreen, and 7 on the 80x24 main screen', () => {
    expect(rowsCapOf(ROOM_80X24.maxRows, ROOM_80X24.viewportRows)).toBe(7)
    expect(rowsCapOf(ROOM_120X30.maxRows, ROOM_120X30.viewportRows)).toBe(10)
    expect(rowsCapOf(ROOM_120X40.maxRows, ROOM_120X40.viewportRows)).toBe(15)
    expect(rowsCapOf(ROOM_MAIN_80X24.maxRows, ROOM_MAIN_80X24.viewportRows)).toBe(7)
  })

  test('rowsCapOf: the band alone when the screen is not known, the band when a wrapped draft takes a row, nothing on a tiny screen', () => {
    expect(rowsCapOf(24, undefined)).toBe(24)
    expect(rowsCapOf(6, 24)).toBe(6)
    expect(rowsCapOf(3, 10)).toBe(0)
    expect(rowsCapOf(Number.NaN, 24)).toBe(0)
    expect(rowsCapOf(7.9, Number.NaN)).toBe(7)
  })

  test('nothing is drawn with no tiles, no rows or no columns', () => {
    expect(layoutOf(inputOf([]))).toEqual({ kind: 'none' })
    expect(layoutOf(inputOf([shot(1)], { maxRows: 0 }))).toEqual({ kind: 'none' })
    expect(layoutOf(inputOf([shot(1)], { maxRows: 9, viewportRows: 10 }))).toEqual({ kind: 'none' })
    expect(layoutOf(inputOf([shot(1)], { bodyColumns: 0 }))).toEqual({ kind: 'none' })
    expect(layoutOf(inputOf([shot(1)], { mode: 'text', bodyColumns: 0 }))).toEqual({ kind: 'none' })
  })
})

describe('the strip at the measured sizes', () => {
  test('80x24: one screenshot is 6 rows of 21 columns under 7, with its size beside its number', () => {
    const layout = stripOf(layoutOf(inputOf([shot(1)])))
    expect(layout).toEqual({ kind: 'strip', rows: 6, tiles: [{ id: 1, columns: 21, rows: 6, label: '#1', detail: '1920x1080' }], hidden: [], kittyBytes: 0 })
    expect(linesOf(layout)).toEqual([...Array.from({ length: 6 }, () => PIXEL.repeat(21)), '#1 1920x1080'])
  })

  test('80x24: a screenshot, a photo and a phone are 21, 16 and 6 columns, as in the mockup', () => {
    const layout = stripOf(layoutOf(inputOf([shot(1), photo(2), phone(3)])))
    expect(layout.rows).toBe(6)
    expect(layout.tiles.map(tile => tile.columns)).toEqual([21, 16, 6])
    expect(linesOf(layout)).toEqual([
      ...Array.from({ length: 6 }, () => `${PIXEL.repeat(21)} ${PIXEL.repeat(16)} ${PIXEL.repeat(6)}`),
      '#1 1920x1080          #2 2000x1500     #3',
    ])
  })

  test('80x24 main screen: the same strip as fullscreen, though the band offers 24 rows', () => {
    expect(layoutOf(inputOf([shot(1), photo(2), phone(3)], ROOM_MAIN_80X24))).toEqual(layoutOf(inputOf([shot(1), photo(2), phone(3)])))
    expect(stripOf(layoutOf(inputOf([shot(1)], ROOM_MAIN_80X24))).rows).toBe(6)
  })

  test('120x30: height 8 fits, a screenshot 28 columns; four side by side, five at 6 rows', () => {
    const one = stripOf(layoutOf(inputOf([shot(1)], ROOM_120X30)))
    expect([one.rows, one.tiles[0]?.columns]).toEqual([8, 28])
    const three = stripOf(layoutOf(inputOf([shot(1), photo(2), phone(3)], ROOM_120X30)))
    expect([three.rows, ...three.tiles.map(tile => tile.columns)]).toEqual([8, 28, 21, 8])
    const four = stripOf(layoutOf(inputOf([1, 2, 3, 4].map(id => shot(id)), ROOM_120X30)))
    expect([four.rows, four.tiles.length, four.hidden]).toEqual([8, 4, []])
    const five = stripOf(layoutOf(inputOf([1, 2, 3, 4, 5].map(id => shot(id)), ROOM_120X30)))
    expect([five.rows, five.tiles.length, five.tiles[0]?.columns]).toEqual([6, 5, 21])
  })

  test('120x40: height 8 as asked; height 20 gives 14 rows, a screenshot 50 columns, three of them 10 rows', () => {
    expect(stripOf(layoutOf(inputOf([shot(1)], ROOM_120X40))).rows).toBe(8)
    const tall = stripOf(layoutOf(inputOf([shot(1)], { ...ROOM_120X40, height: 20 })))
    expect([tall.rows, tall.tiles[0]?.columns]).toEqual([14, 50])
    expect(linesOf(tall)).toHaveLength(15)
    const three = stripOf(layoutOf(inputOf([1, 2, 3].map(id => shot(id)), { ...ROOM_120X40, height: 20 })))
    expect([three.rows, three.tiles[0]?.columns]).toEqual([10, 36])
  })

  test('the option is a ceiling: height 3 stays 3 rows where 6 would fit', () => {
    expect(stripOf(layoutOf(inputOf([shot(1)], { height: 3 }))).rows).toBe(3)
  })

  test('without the screen size the band alone bounds it: 8 rows from a 24-row band', () => {
    expect(stripOf(layoutOf(inputOf([shot(1)], { maxRows: 24, viewportRows: undefined }))).rows).toBe(8)
  })
})

describe('shrinking and overflow', () => {
  test('80 columns: three screenshots at 6 rows, four at 5, five at 4, six at 3', () => {
    for (const [count, rows] of [[3, 6], [4, 5], [5, 4], [6, 3]] as const) {
      const layout = stripOf(layoutOf(inputOf(Array.from({ length: count }, (_, at) => shot(at + 1)))))
      expect([layout.rows, layout.tiles.length, layout.hidden], `${count} screenshots`).toEqual([rows, count, []])
    }
  })

  test('seven screenshots at 80 columns: 3 rows, five shown, #6 and #7 named on the label row as in the mockup', () => {
    const layout = stripOf(layoutOf(inputOf([1, 2, 3, 4, 5, 6, 7].map(id => shot(id)))))
    expect(layout.rows).toBe(ROWS_MIN)
    expect(layout.tiles.map(tile => [tile.id, tile.columns])).toEqual([[1, 11], [2, 11], [3, 11], [4, 11], [5, 11]])
    expect(layout.hidden).toEqual([6, 7])
    expect(layout.overflow).toBe('+2: #6 #7')
    expect(linesOf(layout)).toEqual([
      ...Array.from({ length: 3 }, () => Array.from({ length: 5 }, () => PIXEL.repeat(11)).join(' ')),
      '#1          #2          #3          #4          #5          +2: #6 #7',
    ])
  })

  test('the note names every hidden id while one tile still fits beside it, else as many as fit', () => {
    const twenty = stripOf(layoutOf(inputOf(Array.from({ length: 20 }, (_, at) => shot(at + 1)))))
    expect(twenty.tiles.length + twenty.hidden.length).toBe(20)
    expect(twenty.overflow).toBe(`+${twenty.hidden.length}`)
    const wide = stripOf(layoutOf(inputOf(Array.from({ length: 12 }, (_, at) => shot(at + 1)), { bodyColumns: 60 })))
    expect(wide.overflow).toBe(`+${wide.hidden.length}: ${wide.hidden.map(id => `#${id}`).join(' ')}`)
    for (const layout of [twenty, wide]) for (const line of linesOf(layout)) expect(line.length).toBeLessThanOrEqual(layout === wide ? 60 : 75)
  })

  test('a note that cannot name everyone names what fits, then …; with no room for a name, the count alone', () => {
    const named = stripOf(layoutOf(inputOf(Array.from({ length: 30 }, (_, at) => bare(at + 1, 'pending')), { bodyColumns: 36 })))
    expect([named.tiles.length, named.overflow]).toEqual([2, '+28: #3 …'])
    const counted = stripOf(layoutOf(inputOf(Array.from({ length: 9 }, (_, at) => bare(at + 101, 'not-attached')), { bodyColumns: 41 })))
    expect([counted.tiles.length, counted.overflow]).toEqual([3, '+6'])
    for (const line of linesOf(named)) expect(line.length).toBeLessThanOrEqual(36)
    for (const line of linesOf(counted)) expect(line.length).toBeLessThanOrEqual(41)
  })

  test('not one tile fits beside its note: the compact row instead', () => {
    expect(layoutOf(inputOf([bare(1, 'pending'), bare(2, 'pending')], { bodyColumns: 12 })).kind).toBe('compact')
    expect(layoutOf(inputOf([bare(1, 'pending')], { bodyColumns: 9 })).kind).toBe('compact')
  })
})

describe('hysteresis', () => {
  test('the same count keeps its height where a taller one would fit: typing never resizes', () => {
    expect(stripOf(layoutOf(inputOf([shot(1), shot(2)], { previous: { rows: 4, count: 2 } }))).rows).toBe(4)
  })

  test('a paste or a removal sizes it afresh', () => {
    expect(stripOf(layoutOf(inputOf([shot(1), shot(2)], { previous: { rows: 4, count: 3 } }))).rows).toBe(6)
    expect(stripOf(layoutOf(inputOf([shot(1), shot(2)], { previous: { rows: 4, count: 1 } }))).rows).toBe(6)
  })

  test('a wrapped draft takes a row of the room: it shrinks to fit, never past the room', () => {
    const layout = stripOf(layoutOf(inputOf([shot(1), shot(2), shot(3)], { maxRows: 6, previous: { rows: 6, count: 3 } })))
    expect(layout.rows).toBe(5)
    expect(linesOf(layout)).toHaveLength(6)
  })

  test('a tile that grows wider at the same count shrinks the strip until it fits', () => {
    const before = stripOf(layoutOf(inputOf([shot(1), bare(2, 'pending')], { bodyColumns: 40 })))
    expect([before.rows, ...before.tiles.map(tile => tile.columns)]).toEqual([6, 21, 12])
    const wide = { id: 2, state: 'ready', format: 'png', width: 4000, height: 500, seenAt: 0 } as const
    const after = stripOf(layoutOf(inputOf([shot(1), wide], { bodyColumns: 40, previous: { rows: before.rows, count: 2 } })))
    expect([after.rows, ...after.tiles.map(tile => tile.columns)]).toEqual([5, 18, 20])
  })

  test('a memory of no strip (a compact row) is no memory at all', () => {
    expect(stripOf(layoutOf(inputOf([shot(1)], { previous: { rows: 0, count: 1 } }))).rows).toBe(6)
  })
})

describe('tiles and labels', () => {
  test('a tile with no picture is 2 x rows wide, within 12 and 4 x rows: 12 at 3 rows, 12 at 6, 16 at 8', () => {
    const at = (rows: number, more: Partial<LayoutInput>): number | undefined =>
      stripOf(layoutOf(inputOf([bare(1, 'pending')], { height: rows, ...more }))).tiles[0]?.columns
    expect(at(3, {})).toBe(12)
    expect(at(6, {})).toBe(12)
    expect(at(8, ROOM_120X30)).toBe(16)
  })

  test('failed and not-attached tiles keep the plain width though their size is known', () => {
    const layout = stripOf(layoutOf(inputOf([shot(1, { state: 'failed', reason: 'no preview' }), shot(2, { state: 'not-attached' })])))
    expect(layout.tiles.map(tile => tile.columns)).toEqual([12, 12])
  })

  test('a picture being read keeps its final shape: its size from the header', () => {
    expect(stripOf(layoutOf(inputOf([shot(1, { state: 'reading' })]))).tiles[0]).toEqual({ id: 1, columns: 21, rows: 6, label: '#1', detail: 'reading' })
  })

  test('each state says its word beside #N when it fits the tile', () => {
    const tiles: ImagesTile[] = [bare(1, 'pending'), bare(2, 'failed', 'not found'), bare(3, 'failed', 'no preview'), bare(4, 'not-attached'), shot(5, { width: undefined, height: undefined })]
    const words = stripOf(layoutOf(inputOf(tiles, { bodyColumns: 200 }))).tiles.map(tile => tile.detail)
    expect(words).toEqual(['reading', 'not found', undefined, undefined, undefined])
    const roomy = stripOf(layoutOf(inputOf(tiles, { ...ROOM_120X30, bodyColumns: 200 }))).tiles.map(tile => tile.detail)
    expect(roomy).toEqual(['reading', 'not found', 'no preview', 'not attached', undefined])
  })

  test('a number too long for its tile is cut to it', () => {
    const layout = stripOf(layoutOf(inputOf([phone(1234567)], { height: 3 })))
    expect(layout.tiles[0]).toEqual({ id: 1234567, columns: 6, rows: 3, label: '#1234…' })
  })

  test('in blocks a picture stays within the Raster palette: at 20 rows a screenshot is 51 columns, 71 in pixels', () => {
    const room = { bodyColumns: 200, maxRows: 40, viewportRows: undefined, height: 20 }
    const blocks = stripOf(layoutOf(inputOf([shot(1)], room)))
    expect([blocks.rows, blocks.tiles[0]?.columns]).toEqual([20, 51])
    expect((blocks.tiles[0]?.columns ?? 0) * blocks.rows).toBeLessThanOrEqual(BLOCK_CELLS_CAP)
    expect(stripOf(layoutOf(inputOf([shot(1)], { ...room, mode: 'pixels' }))).tiles[0]?.columns).toBe(71)
  })
})

describe('the kitty budget', () => {
  test('20 square pictures at height 3 in 300 columns: all shown, 95,000 bytes each, under the 2 MiB a tree may hold', () => {
    const layout = stripOf(layoutOf(inputOf(Array.from({ length: 20 }, (_, at) => square(at + 1)), { bodyColumns: 300, maxRows: 40, viewportRows: undefined, height: 3, mode: 'pixels' })))
    expect([layout.rows, layout.tiles.length, layout.hidden]).toEqual([3, 20, []])
    expect(layout.tiles.every(tile => tile.columns === 6)).toBe(true)
    expect(layout.kittyBytes).toBe(95_000)
    expect(layout.kittyBytes * layout.tiles.length).toBeLessThanOrEqual(KITTY_BUDGET)
    expect(KITTY_BUDGET).toBeLessThan(2_097_152)
  })

  test('a tile that may still become a picture takes its share; a failed or not-attached one does not; blocks take none', () => {
    const tiles = [square(1), bare(2, 'pending'), bare(3, 'failed', 'too big'), bare(4, 'not-attached'), square(5, { state: 'reading' })]
    expect(stripOf(layoutOf(inputOf(tiles, { bodyColumns: 200, mode: 'pixels' }))).kittyBytes).toBe(Math.floor(KITTY_BUDGET / 3))
    expect(stripOf(layoutOf(inputOf([square(1), bare(3, 'failed', 'too big')], { mode: 'pixels' }))).kittyBytes).toBe(KITTY_BUDGET)
    expect(stripOf(layoutOf(inputOf(tiles, { bodyColumns: 200 }))).kittyBytes).toBe(0)
  })

  test('hidden tiles take no share', () => {
    const layout = stripOf(layoutOf(inputOf([1, 2, 3, 4, 5, 6, 7].map(id => shot(id)), { mode: 'pixels' })))
    expect(layout.kittyBytes).toBe(Math.floor(KITTY_BUDGET / 5))
  })
})

describe('the compact row', () => {
  test('sharing the band: one row, a swatch for a ready picture, a word for each', () => {
    const layout = layoutOf(inputOf([shot(1), bare(2, 'reading'), bare(3, 'failed', 'no preview')], { shared: true }))
    expect(layout).toEqual({
      kind: 'compact',
      items: [
        { id: 1, label: '#1', detail: '1920x1080', swatch: true },
        { id: 2, label: '#2', detail: 'reading', swatch: false },
        { id: 3, label: '#3', detail: 'no preview', swatch: false },
      ],
    })
    expect(linesOf(layout)).toEqual(['▀▀ #1 1920x1080 · #2 reading · #3 no preview'])
  })

  test('under four rows of room: compact, in blocks and in pixels alike', () => {
    for (const mode of ['blocks', 'pixels'] as const) {
      const layout = layoutOf(inputOf([shot(1), bare(2, 'not-attached')], { maxRows: 3, mode }))
      expect(linesOf(layout), mode).toEqual(['▀▀ #1 1920x1080 · #2 not attached'])
    }
  })

  test('a full row drops words, then names what does not fit', () => {
    const layout = layoutOf(inputOf(Array.from({ length: 10 }, (_, at) => shot(at + 1)), { shared: true, bodyColumns: 40 }))
    expect(linesOf(layout)).toEqual(['▀▀ #1 · +9: #2 #3 #4 #5 #6 #7 #8 #9 #10'])
    if (layout.kind !== 'compact') throw new Error('not compact')
    expect(layout.overflow).toBe('+9: #2 #3 #4 #5 #6 #7 #8 #9 #10')
  })

  test('words go where they fit, left to right', () => {
    expect(linesOf(layoutOf(inputOf([shot(1), shot(2)], { shared: true, bodyColumns: 24 })))).toEqual(['▀▀ #1 1920x1080 · ▀▀ #2'])
  })

  test('a band too narrow for one item and a note: the first item alone, cut', () => {
    expect(layoutOf(inputOf([shot(1), shot(2)], { shared: true, bodyColumns: 4 }))).toEqual({ kind: 'compact', items: [{ id: 1, label: '#1', swatch: false }] })
    expect(layoutOf(inputOf([shot(123456)], { shared: true, bodyColumns: 4 }))).toEqual({ kind: 'compact', items: [{ id: 123456, label: '#12…', swatch: false }] })
  })
})

describe('the line of text', () => {
  test('pictures text: one sentence, as in the mockup', () => {
    const lossy: ImagesTile = { id: 3, state: 'failed', format: 'webp', reason: 'no preview', seenAt: 0 }
    const layout = layoutOf(inputOf([shot(1), photo(2), lossy], { mode: 'text' }))
    expect(layout).toEqual({ kind: 'text', line: 'Images attached: #1 PNG 1920 by 1080, #2 JPEG 2000 by 1500, #3 WebP.' })
  })

  test('a chip with no picture to send is named apart', () => {
    expect(layoutOf(inputOf([shot(1), bare(2, 'not-attached')], { mode: 'text' }))).toEqual({ kind: 'text', line: 'Images attached: #1 PNG 1920 by 1080. Not attached: #2.' })
    expect(layoutOf(inputOf([bare(2, 'not-attached')], { mode: 'text' }))).toEqual({ kind: 'text', line: 'Not attached: #2.' })
    expect(layoutOf(inputOf([bare(4, 'pending'), shot(5, { state: 'reading', format: 'gif', width: undefined, height: undefined })], { mode: 'text' })))
      .toEqual({ kind: 'text', line: 'Images attached: #4, #5 GIF.' })
  })

  test('a narrow band drops the sizes, then the formats, then cuts the line', () => {
    const tiles = [shot(1), photo(2), shot(3, { format: 'webp' })]
    expect(layoutOf(inputOf(tiles, { mode: 'text', bodyColumns: 50 }))).toEqual({ kind: 'text', line: 'Images attached: #1 PNG, #2 JPEG, #3 WebP.' })
    expect(layoutOf(inputOf(tiles, { mode: 'text', bodyColumns: 40 }))).toEqual({ kind: 'text', line: 'Images attached: #1, #2, #3.' })
    expect(layoutOf(inputOf(tiles, { mode: 'text', bodyColumns: 20 }))).toEqual({ kind: 'text', line: 'Images attached: #1…' })
  })

  test('text is one row whatever the room, shared or not', () => {
    expect(linesOf(layoutOf(inputOf([shot(1)], { mode: 'text', maxRows: 1, shared: true })))).toHaveLength(1)
  })
})

describe('never too tall, never too wide', () => {
  // The SPEC's width rule, written out again: what each strip tile must be.
  const columnsOf = (tile: ImagesTile, rows: number, mode: LayoutMode): number => {
    const known = tile.width !== undefined && tile.height !== undefined && tile.width > 0 && tile.height > 0
    const isPicture = known && tile.state !== 'failed' && tile.state !== 'not-attached'
    if (!isPicture) return Math.min(Math.max(2 * rows, 12), 4 * rows)
    const most = mode === 'blocks' ? Math.min(4 * rows, Math.floor(BLOCK_CELLS_CAP / rows)) : 4 * rows

    return Math.min(Math.max(Math.round((2 * rows * (tile.width ?? 1)) / (tile.height ?? 1)), Math.max(rows, 6)), most)
  }
  const widthAt = (tiles: readonly ImagesTile[], rows: number, mode: LayoutMode): number =>
    tiles.reduce((sum, tile) => sum + columnsOf(tile, rows, mode), 0) + tiles.length - 1

  test('a sweep of rooms, heights, modes and tiles keeps every rule', { timeoutMs: 60_000 }, () => {
    const random = randomOf(20261009)
    const states = ['pending', 'reading', 'ready', 'failed', 'not-attached'] as const
    const reasons = ['no preview', 'too big', 'not found', "can't read", 'too slow']
    let strips = 0
    for (let round = 0; round < 3000; round += 1) {
      const count = random(26)
      let id = 1 + random(3)
      const tiles: ImagesTile[] = []
      for (let at = 0; at < count; at += 1) {
        const state = states[random(states.length)] ?? 'ready'
        const sized = state !== 'pending' && random(5) > 0
        tiles.push({
          id,
          state,
          ...(sized ? { format: 'png', width: 1 + random(4000), height: 1 + random(4000) } : {}),
          ...(state === 'failed' ? { reason: reasons[random(reasons.length)] ?? 'too big' } : {}),
          seenAt: 0,
        })
        id += 1 + (random(4) === 0 ? random(100_000) : 0)
      }
      const mode = (['blocks', 'pixels', 'text'] as const)[random(3)] ?? 'blocks'
      const viewportRows = random(4) === 0 ? undefined : random(80)
      const previous = random(2) === 0 ? undefined : { rows: random(22), count: Math.max(0, count - 1 + random(3)) }
      const input: LayoutInput = {
        tiles,
        bodyColumns: random(260),
        maxRows: random(50),
        ...(viewportRows === undefined ? {} : { viewportRows }),
        height: 3 + random(18),
        mode,
        shared: random(6) === 0,
        ...(previous === undefined ? {} : { previous }),
      }
      const layout = layoutOf(input)
      const label = JSON.stringify({ ...input, tiles: tiles.length })
      const cap = rowsCapOf(input.maxRows, input.viewportRows)
      const lines = linesOf(layout)
      expect(lines.length, label).toBeLessThanOrEqual(Math.max(0, cap))
      for (const line of lines) expect(line.length, label).toBeLessThanOrEqual(input.bodyColumns)
      if (tiles.length === 0 || cap < 1 || input.bodyColumns < 1) expect(layout.kind, label).toBe('none')
      if (layout.kind === 'none') continue
      if (mode === 'text') expect(layout.kind, label).toBe('text')
      if (input.shared || cap < 4) expect(layout.kind === 'strip', label).toBe(false)
      if (layout.kind !== 'strip') continue
      strips += 1
      const most = Math.min(input.height, cap - 1)
      const heldRows = previous !== undefined && previous.count === tiles.length && previous.rows >= ROWS_MIN ? previous.rows : undefined
      expect(layout.rows, label).toBeGreaterThanOrEqual(ROWS_MIN)
      expect(layout.rows, label).toBeLessThanOrEqual(most)
      expect([...layout.tiles.map(tile => tile.id), ...layout.hidden], label).toEqual(tiles.map(tile => tile.id))
      expect(layout.tiles.length, label).toBeGreaterThan(0)
      for (const [at, placed] of layout.tiles.entries()) {
        const tile = tiles[at]
        if (tile === undefined) throw new Error(`no tile ${at}: ${label}`)
        expect(placed.columns, label).toBe(columnsOf(tile, layout.rows, mode))
        expect(placed.rows, label).toBe(layout.rows)
        expect(placed.columns, label).toBeLessThanOrEqual(mode === 'pixels' ? 255 : 512)
        expect(placed.label.length + (placed.detail === undefined ? 0 : placed.detail.length + 1), label).toBeLessThanOrEqual(placed.columns)
        if (mode === 'blocks' && tile.state === 'ready') expect(placed.columns * placed.rows, label).toBeLessThanOrEqual(BLOCK_CELLS_CAP)
      }
      if (layout.hidden.length > 0) {
        expect(layout.rows, label).toBe(ROWS_MIN)
        expect(widthAt(tiles, ROWS_MIN, mode), label).toBeGreaterThan(input.bodyColumns)
        expect(layout.overflow, label).toMatch(new RegExp(`^\\+${layout.hidden.length}`))
      } else {
        expect(layout.overflow, label).toBeUndefined()
        // The tallest that fits, or no taller than the remembered height.
        if (layout.rows < most && layout.rows !== heldRows) expect(widthAt(tiles, layout.rows + 1, mode), label).toBeGreaterThan(input.bodyColumns)
      }
      if (heldRows !== undefined) expect(layout.rows, label).toBeLessThanOrEqual(heldRows)
      const pictures = layout.tiles.filter(tile => {
        const state = tiles.find(one => one.id === tile.id)?.state

        return state === 'ready' || state === 'reading' || state === 'pending'
      }).length
      if (mode === 'pixels') expect(layout.kittyBytes * pictures, label).toBeLessThanOrEqual(KITTY_BUDGET)
      else expect(layout.kittyBytes, label).toBe(0)
    }
    expect(strips).toBeGreaterThan(300)
  })
})
