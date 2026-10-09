import type { Master } from './image-types'
import { bytesOf } from './images-bytes'

// The thumbnail builders' test fixtures: masters built by hand, pixel by
// pixel, and Raster cells read back from their base64 into `[codePoint, fg,
// bg]` triplets.

type Pixel = readonly [number, number, number, number]

/** A master from its pixels, row-major; `hasAlpha` when any is not fully opaque. */
export const masterOf = (width: number, height: number, pixels: readonly Pixel[]): Master => {
  if (pixels.length !== width * height) throw new Error(`${pixels.length} pixels for ${width} x ${height}`)

  return { width, height, rgba: Uint8Array.from(pixels.flat()), hasAlpha: pixels.some(pixel => pixel[3] !== 255) }
}

/** A master of one colour. */
export const solidOf = (width: number, height: number, pixel: Pixel): Master =>
  masterOf(width, height, Array.from({ length: width * height }, () => pixel))

/** Raster cells read back: each cell's code point, foreground and background, from little-endian words. */
export const cellsBack = (cells: string): [number, number, number][] => {
  const bytes = bytesOf(cells)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const triplets: [number, number, number][] = []
  for (let at = 0; at + 12 <= bytes.length; at += 12) triplets.push([view.getUint32(at, true), view.getUint32(at + 4, true), view.getUint32(at + 8, true)])

  return triplets
}

/** `0xRRGGBB` of a pixel. */
export const colourOf = (pixel: Pixel): number => (pixel[0] << 16) | (pixel[1] << 8) | pixel[2]

export const RED: Pixel = [230, 40, 30, 255]
export const GREEN: Pixel = [20, 200, 60, 255]
export const BLUE: Pixel = [10, 60, 240, 255]
export const WHITE: Pixel = [255, 255, 255, 255]
export const CLEAR: Pixel = [0, 0, 0, 0]
