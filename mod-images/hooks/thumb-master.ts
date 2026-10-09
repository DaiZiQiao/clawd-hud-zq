import type { Master, RowSink } from './image-types'

// The master: a decoded picture reduced to at most `maxSide` pixels on its
// long side (hooks/decode-drive.ts `MASTER_SIDE`), made from the rows as a
// decoder hands them over, so the whole picture is never held. An
// area-average (box) filter: each source pixel counts once, in the bin its
// centre falls in, exact for whole-number ratios and within a pixel of the
// true area weights otherwise. sRGB values are averaged as they stand, which
// matches a box resize to within a level or so (averaging in linear light
// lightens text by several levels); colour is weighed by alpha, so a
// see-through pixel adds no colour and edges do not darken. A bin no pixel
// reached is transparent.

const { floor, max, min, round } = Math

/** A `RowSink` whose rows build a master, and the master so far. */
export type MasterBinner = RowSink & {
  /** The master so far: each bin the average of the pixels that reached it, the rest transparent. */
  master: () => Master
}

/** The master's size for a picture: the long side at most `maxSide`, never larger than the picture, at least 1 by 1. */
export const masterSizeOf = (width: number, height: number, maxSide: number): { width: number; height: number } => {
  const scale = min(1, maxSide / max(width, height))

  return { width: max(1, round(width * scale)), height: max(1, round(height * scale)) }
}

/**
 * Bins a `sourceWidth` by `sourceHeight` picture into a `width` by `height`
 * master. `weighAlpha` false is for a source that is opaque wherever it has
 * rows (a faster path: colour summed plainly, every bin reached opaque).
 */
export const createMasterBinner = (sourceWidth: number, sourceHeight: number, width: number, height: number, weighAlpha: boolean): MasterBinner => {
  // Per bin: red, green and blue (times alpha when weighed), alpha, pixels.
  const acc = new Float64Array(width * height * 5)
  const xmap = new Int32Array(sourceWidth)
  const ymap = new Int32Array(sourceHeight)
  // For a whole row: master column j takes source columns spans[j]..spans[j + 1].
  const spans = new Int32Array(width + 1)
  for (let x = 0; x < sourceWidth; x += 1) xmap[x] = min(width - 1, floor(((x + 0.5) * width) / sourceWidth))
  for (let y = 0; y < sourceHeight; y += 1) ymap[y] = min(height - 1, floor(((y + 0.5) * height) / sourceHeight))
  for (let x = sourceWidth - 1; x >= 0; x -= 1) spans[xmap[x]!] = x
  spans[width] = sourceWidth

  const row = (y: number, x0: number, dx: number, rgba: Uint8Array, n: number): void => {
    if (y < 0 || y >= sourceHeight) return
    const base = ymap[y]! * width
    if (dx === 1 && x0 === 0 && n === sourceWidth) {
      // A whole row: each bin's run summed on locals, the bin written once.
      for (let j = 0, o = base * 5; j < width; j += 1, o += 5) {
        let r = 0
        let g = 0
        let b = 0
        let a = 0
        const end = spans[j + 1]! * 4
        if (weighAlpha) {
          for (let s = spans[j]! * 4; s < end; s += 4) {
            const alpha = rgba[s + 3]!
            r += rgba[s]! * alpha
            g += rgba[s + 1]! * alpha
            b += rgba[s + 2]! * alpha
            a += alpha
          }
        } else {
          for (let s = spans[j]! * 4; s < end; s += 4) {
            r += rgba[s]!
            g += rgba[s + 1]!
            b += rgba[s + 2]!
          }
        }
        acc[o] = acc[o]! + r
        acc[o + 1] = acc[o + 1]! + g
        acc[o + 2] = acc[o + 2]! + b
        acc[o + 3] = acc[o + 3]! + a
        acc[o + 4] = acc[o + 4]! + (spans[j + 1]! - spans[j]!)
      }

      return
    }
    // Part of a row, or every dx-th pixel of one (an Adam7 pass): pixel by pixel.
    for (let i = 0, x = x0, s = 0; i < n && x < sourceWidth; i += 1, x += dx, s += 4) {
      const o = (base + xmap[x]!) * 5
      const alpha = weighAlpha ? rgba[s + 3]! : 1
      acc[o] = acc[o]! + rgba[s]! * alpha
      acc[o + 1] = acc[o + 1]! + rgba[s + 1]! * alpha
      acc[o + 2] = acc[o + 2]! + rgba[s + 2]! * alpha
      acc[o + 3] = acc[o + 3]! + alpha
      acc[o + 4] = acc[o + 4]! + 1
    }
  }

  const master = (): Master => {
    const rgba = new Uint8Array(width * height * 4)
    for (let i = 0, o = 0, d = 0; i < width * height; i += 1, o += 5, d += 4) {
      const count = acc[o + 4]!
      if (count === 0) continue
      // Unweighed: the plain average, opaque. Weighed: alpha the average,
      // colour unpremultiplied by the alpha summed.
      const sum = weighAlpha ? acc[o + 3]! : count
      const alpha = weighAlpha ? round(sum / count) : 255
      rgba[d + 3] = alpha
      if (sum === 0) continue
      rgba[d] = round(acc[o]! / sum)
      rgba[d + 1] = round(acc[o + 1]! / sum)
      rgba[d + 2] = round(acc[o + 2]! / sum)
    }

    return { width, height, rgba }
  }

  return { row, master }
}
