import type { ImagesFormat } from '../types'
import type { StoreFile } from './store-path'

// Types, names and a helper the decoders, the thumbnail builders, the strip
// and the hooks share. Pure: no `$`.

/**
 * A decoded picture reduced to at most `MASTER_SIDE` pixels on its long side
 * (hooks/decode-drive.ts): straight (not premultiplied) sRGB RGBA, row-major,
 * in display orientation. Every thumbnail size is derived from it.
 */
export type Master = {
  width: number
  height: number
  rgba: Uint8Array
}

/**
 * Where a decoder hands its pixels: `n` RGBA pixels of row `y`, the first at
 * column `x0` and each next one `dx` columns on (Adam7 passes step by more
 * than one), straight alpha, in the source picture's coordinates.
 */
export type RowSink = {
  row: (y: number, x0: number, dx: number, rgba: Uint8Array, n: number) => void
}

/** Each format by the name people know it by. */
export const FORMAT_NAMES: Readonly<Record<ImagesFormat, string>> = { png: 'PNG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP' }

/** A stored file's format, by its extension. */
export const FORMAT_OF_EXT: Readonly<Record<StoreFile['ext'], ImagesFormat>> = { png: 'png', jpg: 'jpeg', gif: 'gif', webp: 'webp' }

export const clamp = (value: number, least: number, most: number): number => Math.min(Math.max(value, least), most)
