import { describe, expect, test } from 'claude-code/testing'

import { createMasterBinner, masterSizeOf } from './thumb-master'

// The master and its size: never larger than the picture; whole-number
// ratios averaged exactly and others pixel by pixel into the bin each centre
// falls in; colour weighed by alpha so see-through pixels do not darken
// edges; Adam7-style rows and parts of rows; bins no row reached left
// transparent.

/** RGBA from [r, g, b, a] quads. */
const rgbaOf = (pixels: readonly (readonly [number, number, number, number])[]): Uint8Array => Uint8Array.from(pixels.flat())

const quadsOf = (rgba: Uint8Array): number[][] => Array.from({ length: rgba.length / 4 }, (_, i) => [...rgba.subarray(i * 4, i * 4 + 4)])

describe('size', () => {
  test('the long side at most the cap, the picture\'s shape kept, never larger than the picture, at least one pixel', () => {
    expect(masterSizeOf(3000, 2000, 256)).toEqual({ width: 256, height: 171 })
    expect(masterSizeOf(2000, 3000, 256)).toEqual({ width: 171, height: 256 })
    expect(masterSizeOf(1920, 1080, 256)).toEqual({ width: 256, height: 144 })
    expect(masterSizeOf(100, 50, 256)).toEqual({ width: 100, height: 50 })
    expect(masterSizeOf(256, 256, 256)).toEqual({ width: 256, height: 256 })
    expect(masterSizeOf(10_000, 1, 256)).toEqual({ width: 256, height: 1 })
    expect(masterSizeOf(1, 10_000, 256)).toEqual({ width: 1, height: 256 })
    expect(masterSizeOf(640, 480, 1)).toEqual({ width: 1, height: 1 })
  })
})

describe('binning', () => {
  test('a whole-number ratio averages each block exactly, rounded', () => {
    const binner = createMasterBinner(4, 2, 2, 1, false)
    binner.row(0, 0, 1, rgbaOf([[0, 0, 0, 255], [10, 20, 30, 255], [100, 100, 100, 255], [101, 101, 101, 255]]), 4)
    binner.row(1, 0, 1, rgbaOf([[1, 2, 3, 255], [11, 22, 33, 255], [200, 0, 50, 255], [0, 1, 2, 255]]), 4)
    const master = binner.master()
    expect([master.width, master.height]).toEqual([2, 1])
    expect(quadsOf(master.rgba)).toEqual([[6, 11, 17, 255], [100, 51, 63, 255]])
  })

  test('other ratios put each pixel in the bin its centre falls in: three columns into two', () => {
    const binner = createMasterBinner(3, 1, 2, 1, false)
    binner.row(0, 0, 1, rgbaOf([[90, 90, 90, 255], [10, 10, 10, 255], [30, 30, 30, 255]]), 3)
    expect(quadsOf(binner.master().rgba)).toEqual([[90, 90, 90, 255], [20, 20, 20, 255]])
  })

  test('colour is weighed by alpha: a see-through pixel adds none, so an edge keeps its colour', () => {
    const weighed = createMasterBinner(2, 1, 1, 1, true)
    weighed.row(0, 0, 1, rgbaOf([[255, 0, 0, 255], [0, 0, 0, 0]]), 2)
    expect(quadsOf(weighed.master().rgba)).toEqual([[255, 0, 0, 128]])
    const half = createMasterBinner(2, 1, 1, 1, true)
    half.row(0, 0, 1, rgbaOf([[200, 100, 0, 255], [0, 100, 200, 85]]), 2)
    expect(quadsOf(half.master().rgba)).toEqual([[150, 100, 50, 170]])
  })

  test('rows of every dx-th pixel and parts of rows land where whole rows would', () => {
    const pixels = Array.from({ length: 8 * 4 }, (_, i) => [i * 7 % 256, i * 3 % 256, 255 - i, i % 2 === 0 ? 255 : 128] as const)
    const whole = createMasterBinner(8, 4, 3, 2, true)
    for (let y = 0; y < 4; y += 1) whole.row(y, 0, 1, rgbaOf(pixels.slice(y * 8, y * 8 + 8)), 8)
    const pieces = createMasterBinner(8, 4, 3, 2, true)
    for (let y = 0; y < 4; y += 1) {
      const row = pixels.slice(y * 8, y * 8 + 8)
      pieces.row(y, 0, 2, rgbaOf(row.filter((_, x) => x % 2 === 0)), 4)
      pieces.row(y, 1, 4, rgbaOf(row.filter((_, x) => x % 4 === 1)), 2)
      pieces.row(y, 3, 4, rgbaOf(row.filter((_, x) => x % 4 === 3)), 2)
    }
    expect(quadsOf(pieces.master().rgba)).toEqual(quadsOf(whole.master().rgba))
  })

  test('bins no row reached are transparent', () => {
    const binner = createMasterBinner(2, 4, 2, 2, false)
    binner.row(0, 0, 1, rgbaOf([[10, 20, 30, 255], [40, 50, 60, 255]]), 2)
    expect(quadsOf(binner.master().rgba)).toEqual([[10, 20, 30, 255], [40, 50, 60, 255], [0, 0, 0, 0], [0, 0, 0, 0]])
  })

  test('a bin over several rows averages their alpha and weighs their colour by it', () => {
    const clear = createMasterBinner(2, 2, 1, 1, true)
    clear.row(0, 0, 1, rgbaOf([[1, 2, 3, 255], [4, 5, 6, 0]]), 2)
    clear.row(1, 0, 1, rgbaOf([[7, 8, 9, 255], [10, 11, 12, 255]]), 2)
    expect(quadsOf(clear.master().rgba)).toEqual([[6, 7, 8, 191]])
  })

  test('the master so far can be read at any time, and rows outside the picture change nothing', () => {
    const binner = createMasterBinner(1, 2, 1, 2, false)
    expect(quadsOf(binner.master().rgba)).toEqual([[0, 0, 0, 0], [0, 0, 0, 0]])
    binner.row(-1, 0, 1, rgbaOf([[9, 9, 9, 255]]), 1)
    binner.row(2, 0, 1, rgbaOf([[9, 9, 9, 255]]), 1)
    binner.row(1, 0, 1, rgbaOf([[5, 6, 7, 255]]), 1)
    expect(quadsOf(binner.master().rgba)).toEqual([[0, 0, 0, 0], [5, 6, 7, 255]])
  })
})
