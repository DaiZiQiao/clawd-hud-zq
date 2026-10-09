import { describe, expect, test } from 'claude-code/testing'

import { demoMastersOf } from './images-demo'
import { bytesOf } from './images-bytes'
import { halfBlockCellsOf, kittyRgbaOf } from './thumb-cells'

// The sample pictures `/mod-images test` draws: three masters of the shapes
// people paste, the same bytes every time, each one what it says it is (a
// ramp of every hue, a checker with transparent squares, a dark editor with
// a light dialog), and each drawable as cells and as kitty pixels.

const pixelOf = (rgba: Uint8Array, width: number, x: number, y: number): number[] => [...rgba.slice((y * width + x) * 4, (y * width + x) * 4 + 4)]

// Mean luminance (0..255) of a rectangle.
const lightOf = (rgba: Uint8Array, width: number, left: number, top: number, wide: number, tall: number): number => {
  let sum = 0
  for (let y = top; y < top + tall; y += 1) {
    for (let x = left; x < left + wide; x += 1) {
      const [red = 0, green = 0, blue = 0] = pixelOf(rgba, width, x, y)
      sum += 0.2126 * red + 0.7152 * green + 0.0722 * blue
    }
  }

  return sum / (wide * tall)
}

describe('the sample pictures', () => {
  test('three masters, 16:9, square and 16:10, within 256 pixels a side, their RGBA whole', () => {
    const masters = demoMastersOf()
    expect(masters.map(master => [master.width, master.height])).toEqual([[256, 144], [192, 192], [256, 160]])
    for (const master of masters) expect(master.rgba).toHaveLength(master.width * master.height * 4)
  })

  test('the same bytes every call, in new arrays', () => {
    const [first, second] = [demoMastersOf(), demoMastersOf()]
    for (const [at, master] of first.entries()) {
      const again = second[at]
      expect(again?.rgba === master.rgba).toBe(false)
      expect([...(again?.rgba ?? [])]).toEqual([...master.rgba])
    }
  })

  test('the ramp: red, green and blue across, light at the top and dark at the bottom, opaque', () => {
    const ramp = demoMastersOf()[0]
    if (ramp === undefined) throw new Error('no ramp')
    const [red = 0, green = 0, blue = 0] = pixelOf(ramp.rgba, ramp.width, 0, 72)
    expect(red > green && red > blue).toBe(true)
    const [, middleGreen = 0, middleBlue = 0] = pixelOf(ramp.rgba, ramp.width, 85, 72)
    expect(middleGreen).toBeGreaterThan(middleBlue)
    const [lateRed = 0, , lateBlue = 0] = pixelOf(ramp.rgba, ramp.width, 170, 72)
    expect(lateBlue).toBeGreaterThan(lateRed)
    expect(lightOf(ramp.rgba, ramp.width, 0, 0, 256, 4)).toBeGreaterThan(lightOf(ramp.rgba, ramp.width, 0, 140, 256, 4) + 80)
    expect(ramp.rgba.filter((_, at) => at % 4 === 3).every(alpha => alpha === 255)).toBe(true)
  })

  test('the checker: opaque and fully transparent squares, alternating', () => {
    const checker = demoMastersOf()[1]
    if (checker === undefined) throw new Error('no checker')
    const alphas = new Set(checker.rgba.filter((_, at) => at % 4 === 3))
    expect([...alphas].sort((a, b) => a - b)).toEqual([0, 255])
    expect([pixelOf(checker.rgba, 192, 10, 10)[3], pixelOf(checker.rgba, 192, 34, 10)[3], pixelOf(checker.rgba, 192, 34, 34)[3]]).toEqual([255, 0, 255])
  })

  test('the editor: dark code round a light dialog, a blue status bar at the foot', () => {
    const editor = demoMastersOf()[2]
    if (editor === undefined) throw new Error('no editor')
    expect(lightOf(editor.rgba, 256, 72, 60, 116, 44)).toBeGreaterThan(180)
    expect(lightOf(editor.rgba, 256, 64, 110, 184, 40)).toBeLessThan(60)
    expect(pixelOf(editor.rgba, 256, 200, 156)).toEqual([0x00, 0x7a, 0xcc, 255])
  })

  test('each draws as half-block cells and as kitty pixels at a tile\'s size', () => {
    for (const master of demoMastersOf()) {
      const columns = Math.round((12 * master.width) / master.height)
      expect(bytesOf(halfBlockCellsOf(master, columns, 6))).toHaveLength(columns * 6 * 12)
      const image = kittyRgbaOf(master, columns, 6, 300_000)
      expect(bytesOf(image.rgba)).toHaveLength(image.width * image.height * 4)
    }
  })
})
