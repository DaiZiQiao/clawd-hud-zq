// Types the decoders, the thumbnail builders and the strip share. Pure: no
// `$`, nothing that runs.

export type { ImagesFormat as ImageFormat } from '../types'

/**
 * A decoded picture reduced to at most `MASTER_SIDE` pixels on its long side
 * (hooks/decode-drive.ts): straight (not premultiplied) sRGB RGBA, row-major,
 * in display orientation. Every thumbnail size is derived from it.
 */
export type Master = {
  width: number
  height: number
  rgba: Uint8Array
  /** Some pixel is not fully opaque. */
  hasAlpha: boolean
}

/**
 * Where a decoder hands its pixels: `n` RGBA pixels of row `y`, the first at
 * column `x0` and each next one `dx` columns on (Adam7 passes step by more
 * than one), straight alpha, in the source picture's coordinates.
 */
export type RowSink = {
  row: (y: number, x0: number, dx: number, rgba: Uint8Array, n: number) => void
}
