import type { Master } from './image-types'
import { base64Of } from './images-bytes'

// What a decoded picture (its master, at most 256 pixels a side) becomes in
// a tile, at draw time: half-block cells for a Raster, each cell two stacked
// pixels (U+2580, the top pixel its foreground, the bottom one its
// background), or RGBA for an Image in a terminal that draws pixels. Both are
// area averages of the master, alpha-weighted so a transparent pixel adds no
// colour, in plain sRGB: no gamma, no dithering (at this size both read
// worse). A half that is mostly transparent shows the terminal's own
// background. Pure, and quick enough to make while drawing (a tile's cells in
// under a millisecond in the hooks environment, its kitty RGBA in two or
// three), so the hooks memoise them rather than store them.

// The hooks environment looks a global such as `Math` up afresh at every use,
// several times slower than a module constant: the loops below run a hundred
// thousand times a tile, so they use these.
const { floor, max, min, round, sqrt } = Math

/** A Raster cell's colour for the terminal's own: bit 24 alone. */
export const DEFAULT_COLOR = 0x01000000
/** The pixels an Image's RGBA gives each cell it covers: about what a terminal cell measures. */
export const CELL_PIXELS = { width: 10, height: 20 } as const

/** A Raster cell: three little-endian u32, code point, foreground, background. */
const CELL_BYTES = 12
const BLANK = 0x20
const UPPER_HALF = 0x2580
const LOWER_HALF = 0x2584
/** A pixel at least this opaque draws its colour; below it, the terminal's background. */
const OPAQUE_FROM = 128
/** An Image's RGBA is 1 to 2048 pixels a side. */
const IMAGE_SIDE_MAX = 2048

const clamp = (value: number, least: number, most: number): number => min(max(value, least), most)

/**
 * Along one axis, the source pixels each of `target` pixels covers and how
 * much of each, in whole units of 1 / `target` of a source pixel: target
 * pixel `j` covers `[j * source, (j + 1) * source)`, source pixel `i`
 * `[i * target, (i + 1) * target)`. Exact, and every target pixel's shares
 * sum to `source`.
 */
const spansOf = (source: number, target: number): { offsets: Int32Array; sources: Int32Array; shares: Float64Array } => {
  const offsets = new Int32Array(target + 1)
  const sources = new Int32Array(source + target)
  const shares = new Float64Array(source + target)
  let count = 0
  for (let j = 0; j < target; j += 1) {
    const from = j * source
    const to = from + source
    for (let i = floor(from / target); i * target < to; i += 1) {
      sources[count] = i
      shares[count] = min((i + 1) * target, to) - max(i * target, from)
      count += 1
    }
    offsets[j + 1] = count
  }

  return { offsets, sources, shares }
}

/**
 * The master resampled to `width` x `height` by area: each pixel the average
 * of the master pixels it covers, weighted by how much of each and by their
 * alpha (straight alpha in and out). Fully transparent pixels come out black.
 */
export const resampleOf = (master: Master, width: number, height: number): Uint8Array => {
  const out = new Uint8Array(max(0, width * height * 4))
  const { width: sourceWidth, height: sourceHeight, rgba } = master
  if (width < 1 || height < 1 || sourceWidth < 1 || sourceHeight < 1) return out
  if (width === sourceWidth && height === sourceHeight) {
    out.set(rgba.subarray(0, out.length))

    return out
  }
  const across = spansOf(sourceWidth, width)
  const down = spansOf(sourceHeight, height)
  // First across: each source row's premultiplied sums under every target column.
  const rows = new Float64Array(sourceHeight * width * 4)
  for (let y = 0, to = 0; y < sourceHeight; y += 1) {
    const line = y * sourceWidth
    for (let x = 0; x < width; x += 1, to += 4) {
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      for (let k = across.offsets[x]!, end = across.offsets[x + 1]!; k < end; k += 1) {
        const at = (line + across.sources[k]!) * 4
        const weight = across.shares[k]! * rgba[at + 3]!
        red += weight * rgba[at]!
        green += weight * rgba[at + 1]!
        blue += weight * rgba[at + 2]!
        alpha += weight
      }
      rows[to] = red
      rows[to + 1] = green
      rows[to + 2] = blue
      rows[to + 3] = alpha
    }
  }
  // Then down: every target row's sums over the source rows it covers.
  const whole = sourceWidth * sourceHeight
  for (let y = 0, to = 0; y < height; y += 1) {
    const first = down.offsets[y]!
    const end = down.offsets[y + 1]!
    for (let x = 0; x < width; x += 1, to += 4) {
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      for (let k = first; k < end; k += 1) {
        const share = down.shares[k]!
        const from = (down.sources[k]! * width + x) * 4
        red += share * rows[from]!
        green += share * rows[from + 1]!
        blue += share * rows[from + 2]!
        alpha += share * rows[from + 3]!
      }
      out[to + 3] = round(alpha / whole)
      if (alpha === 0) continue
      out[to] = round(red / alpha)
      out[to + 1] = round(green / alpha)
      out[to + 2] = round(blue / alpha)
    }
  }

  return out
}

// A pixel's colour for a cell, `0x00RRGGBB`; undefined when it is mostly transparent.
const colourAt = (rgba: Uint8Array, at: number): number | undefined =>
  rgba[at + 3]! < OPAQUE_FROM ? undefined : (rgba[at]! << 16) | (rgba[at + 1]! << 8) | rgba[at + 2]!

/**
 * `columns` x `rows` Raster cells from a colour per half-cell pixel (`y` from
 * 0 to 2 x rows - 1), as a Raster's `cells` take them: both halves
 * transparent, a blank in the terminal's colours; the top one, U+2584 in the
 * bottom's colour; else U+2580, the top's colour over the bottom's (or the
 * terminal's background).
 */
const cellsOf = (columns: number, rows: number, colourOf: (x: number, y: number) => number | undefined): string => {
  const bytes = new Uint8Array(columns * rows * CELL_BYTES)
  const view = new DataView(bytes.buffer)
  for (let row = 0, at = 0; row < rows; row += 1) {
    for (let x = 0; x < columns; x += 1, at += CELL_BYTES) {
      const top = colourOf(x, row * 2)
      const bottom = colourOf(x, row * 2 + 1)
      const glyph = top !== undefined ? UPPER_HALF : bottom !== undefined ? LOWER_HALF : BLANK
      view.setUint32(at, glyph, true)
      view.setUint32(at + 4, top ?? bottom ?? DEFAULT_COLOR, true)
      view.setUint32(at + 8, top === undefined ? DEFAULT_COLOR : bottom ?? DEFAULT_COLOR, true)
    }
  }

  return base64Of(bytes)
}

/**
 * Raster cells for the picture contained in `columns` x `rows` (its aspect
 * kept, a cell two square pixels tall, centred): base64 of little-endian u32
 * `[codePoint, fg, bg]` triplets, row-major, `columns * rows * 12` bytes.
 * Per cell: both halves transparent (alpha under 128) `[0x20, DEFAULT,
 * DEFAULT]`; the top transparent `[0x2584, bottom, DEFAULT]`; else `[0x2580,
 * top, bottom or DEFAULT]`. The padding round the picture is transparent: a
 * cell of nothing but padding is `[0x20, DEFAULT, DEFAULT]`.
 */
export const halfBlockCellsOf = (master: Master, columns: number, rows: number): string => {
  const across = floor(columns)
  const down = floor(rows)
  if (!(across >= 1 && down >= 1 && master.width >= 1 && master.height >= 1)) return ''
  const tall = down * 2
  const scale = min(across / master.width, tall / master.height)
  const width = clamp(round(master.width * scale), 1, across)
  const height = clamp(round(master.height * scale), 1, tall)
  const left = floor((across - width) / 2)
  const top = floor((tall - height) / 2)
  const pixels = resampleOf(master, width, height)

  return cellsOf(across, down, (x, y) => {
    const column = x - left
    const line = y - top

    return column < 0 || line < 0 || column >= width || line >= height ? undefined : colourAt(pixels, (line * width + column) * 4)
  })
}

/**
 * RGBA for an Image of `columns` x `rows` cells: the picture in its own
 * aspect, about CELL_PIXELS a cell (the terminal fits it to the box, keeping
 * that aspect), never larger than the master, 1 to 2048 pixels a side, and no
 * more than `maxBytes` (the tile's share of the tree's budget; 1 x 1 at
 * least).
 */
export const kittyRgbaOf = (master: Master, columns: number, rows: number, maxBytes: number): { rgba: string; width: number; height: number } => {
  const sourceWidth = max(1, master.width)
  const sourceHeight = max(1, master.height)
  const boxScale = min((columns * CELL_PIXELS.width) / sourceWidth, (rows * CELL_PIXELS.height) / sourceHeight, 1)
  const boxWidth = clamp(round(sourceWidth * boxScale), 1, IMAGE_SIDE_MAX)
  const boxHeight = clamp(round(sourceHeight * boxScale), 1, IMAGE_SIDE_MAX)
  const isWithin = boxWidth * boxHeight * 4 <= maxBytes
  // Over the allowance: the largest of the same shape under it.
  const byteScale = sqrt(max(0, maxBytes) / (4 * sourceWidth * sourceHeight))
  const width = isWithin ? boxWidth : clamp(floor(sourceWidth * byteScale), 1, boxWidth)
  const height = isWithin ? boxHeight : clamp(floor(sourceHeight * byteScale), 1, boxHeight)

  return { rgba: base64Of(resampleOf(master, width, height)), width, height }
}

/** A 2 x 1 cell swatch for the compact row: the whole picture reduced to 2 x 2 pixels, as Raster cells (base64). */
export const swatchCellsOf = (master: Master): string => {
  const pixels = resampleOf(master, 2, 2)

  return cellsOf(2, 1, (x, y) => colourAt(pixels, (y * 2 + x) * 4))
}
