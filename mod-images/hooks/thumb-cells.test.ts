import { describe, expect, test } from 'claude-code/testing'

import { bytesOf } from './images-bytes'
import { layoutOf } from './strip-layout'
import { CELL_PIXELS, DEFAULT_COLOR, halfBlockCellsOf, kittyRgbaOf, resampleOf, swatchCellsOf } from './thumb-cells'
import { BLUE, CLEAR, GREEN, RED, WHITE, cellsBack, colourOf, masterOf, solidOf } from './thumb-cells.fixtures'

// What a master becomes in a tile: the area-average resample (exact shares,
// alpha-weighted colour), half-block cells (which glyph and colours for each
// pair of pixels, the picture centred and its padding blank, the exact byte
// length for every size the layout makes), kitty RGBA (its size per cell, its
// aspect, its byte allowance) and the compact row's swatch.

const BLANK = 0x20
const UPPER = 0x2580
const LOWER = 0x2584
const GREY = (level: number): readonly [number, number, number, number] => [level, level, level, 255]

describe('resampling', () => {
  test('the same size is a copy of the master', () => {
    const master = masterOf(2, 1, [RED, CLEAR])
    const copy = resampleOf(master, 2, 1)
    expect([...copy]).toEqual([...master.rgba])
    copy[0] = 1
    expect(master.rgba[0]).toBe(RED[0])
  })

  test('halving averages each 2 x 2 block', () => {
    const master = masterOf(4, 2, [GREY(0), GREY(100), GREY(10), GREY(20), GREY(200), GREY(100), GREY(30), GREY(40)])
    expect([...resampleOf(master, 2, 1)]).toEqual([100, 100, 100, 255, 25, 25, 25, 255])
  })

  test('a pixel half covered counts half: 3 to 2 across', () => {
    expect([...resampleOf(masterOf(3, 1, [GREY(0), GREY(90), GREY(180)]), 2, 1)]).toEqual([30, 30, 30, 255, 150, 150, 150, 255])
  })

  test('a transparent pixel adds no colour, only its share of the alpha', () => {
    expect([...resampleOf(masterOf(2, 1, [[255, 0, 0, 0], [0, 0, 255, 255]]), 1, 1)]).toEqual([0, 0, 255, 128])
    expect([...resampleOf(masterOf(2, 1, [[255, 255, 255, 255], [255, 255, 255, 0]]), 1, 1)]).toEqual([255, 255, 255, 128])
    expect([...resampleOf(masterOf(2, 1, [CLEAR, CLEAR]), 1, 1)]).toEqual([0, 0, 0, 0])
  })

  test('growing spreads each pixel over the area it covers', () => {
    expect([...resampleOf(masterOf(2, 1, [GREY(0), GREY(255)]), 4, 1)]).toEqual([0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255])
    expect([...resampleOf(masterOf(2, 1, [GREY(0), GREY(255)]), 3, 1)].slice(4, 8)).toEqual([128, 128, 128, 255])
    expect([...resampleOf(solidOf(1, 1, GREEN), 3, 2)]).toEqual(Array.from({ length: 6 }, () => [...GREEN]).flat())
  })

  test('no room, no pixels', () => {
    expect(resampleOf(solidOf(2, 2, RED), 0, 3)).toHaveLength(0)
  })
})

describe('half-block cells', () => {
  test('an opaque 2 x 2 picture in 2 x 1 cells: upper half blocks, the top pixel over the bottom one', () => {
    const cells = halfBlockCellsOf(masterOf(2, 2, [RED, GREEN, BLUE, WHITE]), 2, 1)
    expect(cellsBack(cells)).toEqual([[UPPER, colourOf(RED), colourOf(BLUE)], [UPPER, colourOf(GREEN), colourOf(WHITE)]])
  })

  test('transparent halves: a lower half block in the bottom colour, an upper one over the default, a blank', () => {
    const master = masterOf(3, 2, [CLEAR, RED, CLEAR, GREEN, CLEAR, CLEAR])
    expect(cellsBack(halfBlockCellsOf(master, 3, 1))).toEqual([
      [LOWER, colourOf(GREEN), DEFAULT_COLOR],
      [UPPER, colourOf(RED), DEFAULT_COLOR],
      [BLANK, DEFAULT_COLOR, DEFAULT_COLOR],
    ])
  })

  test('alpha 128 draws its colour, 127 shows the terminal background', () => {
    const master = masterOf(2, 2, [[200, 10, 10, 128], [200, 10, 10, 127], [10, 10, 200, 128], [10, 10, 200, 127]])
    expect(cellsBack(halfBlockCellsOf(master, 2, 1))).toEqual([[UPPER, 0xc80a0a, 0x0a0ac8], [BLANK, DEFAULT_COLOR, DEFAULT_COLOR]])
  })

  test('a wide picture in a tall box: centred down the box, the padding blank', () => {
    const cells = cellsBack(halfBlockCellsOf(masterOf(4, 1, [RED, GREEN, BLUE, WHITE]), 4, 4))
    expect(cells).toHaveLength(16)
    expect(cells.slice(4, 8)).toEqual([RED, GREEN, BLUE, WHITE].map(pixel => [LOWER, colourOf(pixel), DEFAULT_COLOR]))
    for (const at of [0, 1, 2, 3, 8, 9, 10, 11, 12, 13, 14, 15]) expect(cells[at], String(at)).toEqual([BLANK, DEFAULT_COLOR, DEFAULT_COLOR])
  })

  test('a tall picture in a wide box: centred across it', () => {
    expect(cellsBack(halfBlockCellsOf(masterOf(1, 2, [RED, BLUE]), 3, 1))).toEqual([
      [BLANK, DEFAULT_COLOR, DEFAULT_COLOR],
      [UPPER, colourOf(RED), colourOf(BLUE)],
      [BLANK, DEFAULT_COLOR, DEFAULT_COLOR],
    ])
  })

  test('a picture smaller than its box grows to fill it', () => {
    expect(cellsBack(halfBlockCellsOf(solidOf(1, 1, GREEN), 2, 1))).toEqual([[UPPER, colourOf(GREEN), colourOf(GREEN)], [UPPER, colourOf(GREEN), colourOf(GREEN)]])
  })

  test('each half is the area average of what it covers, in plain sRGB', () => {
    const left = [RED, RED, BLUE, BLUE] as const
    const master = masterOf(4, 4, [...left, ...left, ...left, ...left])
    expect(cellsBack(halfBlockCellsOf(master, 2, 1))).toEqual([[UPPER, colourOf(RED), colourOf(RED)], [UPPER, colourOf(BLUE), colourOf(BLUE)]])
    // A square in one cell (a pixel wide, two tall) is one pixel, at the top: the four greys' mean.
    const greys = masterOf(2, 2, [GREY(0), GREY(255), GREY(255), GREY(0)])
    expect(cellsBack(halfBlockCellsOf(greys, 1, 1))).toEqual([[UPPER, 0x808080, DEFAULT_COLOR]])
  })

  test('the words are little-endian: code point, foreground, background', () => {
    const bytes = bytesOf(halfBlockCellsOf(masterOf(1, 2, [[0x12, 0x34, 0x56, 255], [0xab, 0xcd, 0xef, 255]]), 1, 1))
    expect([...bytes]).toEqual([0x80, 0x25, 0, 0, 0x56, 0x34, 0x12, 0, 0xef, 0xcd, 0xab, 0])
  })

  test('exactly columns x rows x 12 bytes for every tile the layout makes, of blanks and half blocks only', { timeoutMs: 60_000 }, () => {
    const masters = [solidOf(256, 144, RED), masterOf(3, 7, Array.from({ length: 21 }, (_, at) => (at % 3 === 0 ? CLEAR : BLUE))), solidOf(1, 1, WHITE)]
    for (const height of [3, 6, 8, 12, 20]) {
      for (const [width, tall] of [[1920, 1080], [1170, 2532], [500, 500], [4000, 300], [1, 4000]] as const) {
        const layout = layoutOf({ tiles: [{ id: 1, state: 'ready', width, height: tall, seenAt: 0 }], bodyColumns: 300, maxRows: 60, height, mode: 'blocks', shared: false })
        if (layout.kind !== 'strip') throw new Error(`no strip at height ${height}`)
        for (const tile of layout.tiles) {
          for (const master of masters) {
            const cells = halfBlockCellsOf(master, tile.columns, tile.rows)
            const label = `${master.width}x${master.height} in ${tile.columns}x${tile.rows}`
            expect(bytesOf(cells), label).toHaveLength(tile.columns * tile.rows * 12)
            expect(cells, label).toHaveLength(Math.ceil((tile.columns * tile.rows * 12) / 3) * 4)
            for (const [glyph, fg, bg] of cellsBack(cells)) {
              expect([BLANK, UPPER, LOWER], label).toContain(glyph)
              for (const colour of [fg, bg]) expect(colour <= 0xffffff || colour === DEFAULT_COLOR, label).toBe(true)
            }
          }
        }
      }
    }
  })

  test('no columns or rows, no cells', () => {
    expect(halfBlockCellsOf(solidOf(2, 2, RED), 0, 4)).toBe('')
  })
})

describe('kitty pixels', () => {
  test('about 10 x 20 pixels a cell, in the picture\'s own aspect: a 16:9 master at 21 x 6 cells is 210 x 118', () => {
    const master = solidOf(256, 144, RED)
    const image = kittyRgbaOf(master, 21, 6, 1_000_000)
    expect([image.width, image.height]).toEqual([210, 118])
    expect(bytesOf(image.rgba)).toHaveLength(210 * 118 * 4)
    expect([...bytesOf(image.rgba).slice(0, 4)]).toEqual([...RED])
    expect(CELL_PIXELS).toEqual({ width: 10, height: 20 })
  })

  test('never larger than the master', () => {
    const image = kittyRgbaOf(solidOf(64, 36, BLUE), 40, 20, 2_000_000)
    expect([image.width, image.height]).toEqual([64, 36])
  })

  test('a portrait in a wide box keeps its shape, its height the box\'s', () => {
    const image = kittyRgbaOf(solidOf(118, 256, GREEN), 20, 6, 2_000_000)
    expect([image.width, image.height]).toEqual([55, 120])
  })

  test('within its byte allowance, the shape kept: 198 x 198 of a 256-pixel square for 158,333 bytes', () => {
    const image = kittyRgbaOf(solidOf(256, 256, WHITE), 40, 20, 158_333)
    expect([image.width, image.height]).toEqual([198, 198])
    expect(image.width * image.height * 4).toBeLessThanOrEqual(158_333)
  })

  test('20 squares at height 3 take 14,400 bytes each, far within their 95,000 and the tree\'s 2 MiB', () => {
    const images = Array.from({ length: 20 }, () => kittyRgbaOf(solidOf(256, 256, RED), 6, 3, 95_000))
    expect(images.map(image => [image.width, image.height])).toEqual(Array.from({ length: 20 }, () => [60, 60]))
    expect(images.reduce((sum, image) => sum + bytesOf(image.rgba).length, 0)).toBe(288_000)
  })

  test('one pixel at least, whatever the allowance', () => {
    const image = kittyRgbaOf(solidOf(256, 256, WHITE), 40, 20, 1)
    expect([image.width, image.height, bytesOf(image.rgba).length]).toEqual([1, 1, 4])
  })

  test('the pixels are the master resampled', () => {
    const master = masterOf(4, 2, [RED, RED, BLUE, BLUE, RED, RED, BLUE, BLUE])
    const image = kittyRgbaOf(master, 1, 1, 1_000_000)
    expect([image.width, image.height]).toEqual([4, 2])
    expect([...bytesOf(image.rgba)]).toEqual([...master.rgba])
    const small = kittyRgbaOf(master, 1, 1, 8)
    expect([small.width, small.height, [...bytesOf(small.rgba)]]).toEqual([2, 1, [...resampleOf(master, 2, 1)]])
  })
})

describe('the swatch', () => {
  test('two cells: the picture reduced to 2 x 2 pixels, top over bottom', () => {
    const swatch = swatchCellsOf(masterOf(2, 2, [RED, GREEN, BLUE, WHITE]))
    expect(swatch).toHaveLength(32)
    expect(cellsBack(swatch)).toEqual([[UPPER, colourOf(RED), colourOf(BLUE)], [UPPER, colourOf(GREEN), colourOf(WHITE)]])
  })

  test('a larger picture by its quarters, whatever its shape', () => {
    const quarters = masterOf(4, 2, [RED, RED, GREEN, GREEN, BLUE, BLUE, WHITE, WHITE])
    expect(cellsBack(swatchCellsOf(quarters))).toEqual([[UPPER, colourOf(RED), colourOf(BLUE)], [UPPER, colourOf(GREEN), colourOf(WHITE)]])
  })

  test('a transparent picture is two blanks', () => {
    expect(cellsBack(swatchCellsOf(solidOf(8, 8, CLEAR)))).toEqual([[BLANK, DEFAULT_COLOR, DEFAULT_COLOR], [BLANK, DEFAULT_COLOR, DEFAULT_COLOR]])
  })
})
