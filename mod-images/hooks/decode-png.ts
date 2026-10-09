import { createZlibInflater, INFLATE_PAD } from './decode-inflate'
import type { RowSink } from './image-types'

// A PNG decoded row by row into a `RowSink` (hooks/image-types.ts), so a
// master is made without the whole picture ever held as pixels: every colour
// type and bit depth (1, 2, 4, 8 and 16), a palette with tRNS, grey and RGB
// colour keys, and Adam7 interlacing. Ancillary chunks (gAMA, iCCP, sRGB,
// bKGD, text, APNG frames) are skipped: the default image is drawn. Neither
// the CRCs nor the Adler-32 are checked, and image data cut short or corrupt
// keeps the rows decoded before it. What it holds is the compressed data, the
// inflater's window and chunk (hooks/decode-inflate.ts) and two rows.

const { ceil, floor, max, min } = Math

/** A PNG's IHDR. */
export type PngHeader = {
  width: number
  height: number
  bitDepth: number
  /** 0 grey, 2 RGB, 3 palette, 4 grey and alpha, 6 RGBA. */
  colourType: number
  interlaced: boolean
}

/**
 * A PNG decoded in slices: `step(deadline)` decodes until `performance.now()`
 * passes `deadline` (checked after each chunk of image data) or the picture is
 * done, true then, handing each finished row to the sink.
 */
type PngDecoder = {
  /** A colour type with alpha, or a tRNS chunk: some pixel may be see-through. */
  mayHaveAlpha: boolean
  step: (deadline: number) => boolean
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const
const IHDR = 0x49484452
const PLTE = 0x504c5445
const TRNS = 0x74524e53
const IDAT = 0x49444154
const IEND = 0x49454e44

/** Samples per pixel, by colour type. */
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
/** The bit depths each colour type allows. */
const DEPTHS: Readonly<Record<number, readonly number[]>> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }

/** Samples below 8 bits share a byte: log2 of how many, by depth (a pixel's byte is its index shifted right so far). */
const SHIFTS: Readonly<Record<number, number>> = { 1: 3, 2: 2, 4: 1, 8: 0 }

/** Adam7's seven passes: [x0, y0, dx, dy]. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const

type Pass = { x0: number; y0: number; dx: number; dy: number; width: number; height: number; rowBytes: number }

/** One row's pixels, `n` of them at `src[left..]`, as RGBA8 into the converter's own row. */
type Convert = (n: number, src: Uint8Array) => void

const u32 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0

/** A 16-bit sample in 8 bits, rounded: round(v * 255 / 65535). */
const to8 = (v: number): number => (v * 255 + 32895) >>> 16

/** The file starts with the PNG signature. */
export const isPngOf = (bytes: Uint8Array): boolean => bytes.length >= 8 && SIGNATURE.every((value, at) => bytes[at] === value)

/** The IHDR, or why it is not one this decoder reads: what is checked before anything is allocated. */
export const pngHeaderOf = (bytes: Uint8Array): PngHeader | string => {
  if (!isPngOf(bytes)) return 'PNG: no signature'
  if (bytes.length < 33 || u32(bytes, 8) !== 13 || u32(bytes, 12) !== IHDR) return 'PNG: bad IHDR'
  const width = u32(bytes, 16)
  const height = u32(bytes, 20)
  const bitDepth = bytes[24]!
  const colourType = bytes[25]!
  if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff) return `PNG: bad size ${width}x${height}`
  if (!(DEPTHS[colourType] ?? []).includes(bitDepth)) return `PNG: bad colour type ${colourType} at depth ${bitDepth}`
  if (bytes[26] !== 0 || bytes[27] !== 0 || bytes[28]! > 1) return 'PNG: unknown compression, filter or interlace method'

  return { width, height, bitDepth, colourType, interlaced: bytes[28] === 1 }
}

/**
 * The chunks walked at most: they are read before the first slice, so a file
 * of hundreds of thousands of empty ones would hold the worker up (65,536 took
 * 50 ms; a 4 MiB file in libpng's 8 KiB chunks has 512).
 */
const MAX_CHUNKS = 16_384

/**
 * Hands `visit` each chunk before IEND, its data `bytes[start..end)`; a chunk
 * running past the end of the file is cut there and is the last (a file cut
 * short still shows its top).
 */
const eachChunk = (bytes: Uint8Array, visit: (type: number, start: number, end: number) => void): void => {
  let at = 8
  for (let count = 0; at + 8 <= bytes.length; count += 1) {
    if (count === MAX_CHUNKS) throw new Error(`PNG: more than ${MAX_CHUNKS} chunks`)
    const length = u32(bytes, at)
    const type = u32(bytes, at + 4)
    const start = at + 8
    if (type === IEND) return
    visit(type, start, min(start + length, bytes.length))
    if (start + length + 4 > bytes.length) return
    at = start + length + 4
  }
}

const unfilter = (filter: number, cur: Uint8Array, prev: Uint8Array, bpp: number, rowBytes: number): void => {
  const end = bpp + rowBytes
  switch (filter) {
    case 1:
      for (let i = bpp; i < end; i += 1) cur[i] = cur[i]! + cur[i - bpp]!
      return
    case 2:
      for (let i = bpp; i < end; i += 1) cur[i] = cur[i]! + prev[i]!
      return
    case 3:
      for (let i = bpp; i < end; i += 1) cur[i] = cur[i]! + ((cur[i - bpp]! + prev[i]!) >>> 1)
      return
    case 4:
      for (let i = bpp; i < end; i += 1) {
        const a = cur[i - bpp]!
        const b = prev[i]!
        const c = prev[i - bpp]!
        let pa = b - c
        let pb = a - c
        let pc = pa + pb
        if (pa < 0) pa = -pa
        if (pb < 0) pb = -pb
        if (pc < 0) pc = -pc
        cur[i] = cur[i]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      return
  }
}

/**
 * The row converter for one colour type and depth: pixels at `src[left..]`
 * (`left` is `bpp`, the zero padding the filters read) into RGBA8 in `dst`.
 */
const converterOf = (
  colourType: number,
  depth: number,
  left: number,
  dst: Uint8Array,
  dst32: Uint32Array,
  palette32: Uint32Array,
  key: readonly number[] | undefined,
): Convert => {
  if (colourType === 6 && depth === 8) return (n, src) => dst.set(src.subarray(left, left + n * 4))
  if (colourType === 6) {
    return (n, src) => {
      for (let i = 0, s = left; i < n * 4; i += 1, s += 2) dst[i] = to8((src[s]! << 8) | src[s + 1]!)
    }
  }
  if (colourType === 2) {
    const kr = key?.[0] ?? -1
    const kg = key?.[1] ?? -1
    const kb = key?.[2] ?? -1
    if (depth === 8) {
      return (n, src) => {
        for (let i = 0, s = left, d = 0; i < n; i += 1, s += 3, d += 4) {
          const r = src[s]!
          const g = src[s + 1]!
          const b = src[s + 2]!
          dst[d] = r
          dst[d + 1] = g
          dst[d + 2] = b
          dst[d + 3] = r === kr && g === kg && b === kb ? 0 : 255
        }
      }
    }
    return (n, src) => {
      for (let i = 0, s = left, d = 0; i < n; i += 1, s += 6, d += 4) {
        const r = (src[s]! << 8) | src[s + 1]!
        const g = (src[s + 2]! << 8) | src[s + 3]!
        const b = (src[s + 4]! << 8) | src[s + 5]!
        dst[d] = to8(r)
        dst[d + 1] = to8(g)
        dst[d + 2] = to8(b)
        dst[d + 3] = r === kr && g === kg && b === kb ? 0 : 255
      }
    }
  }
  if (colourType === 4) {
    if (depth === 8) {
      return (n, src) => {
        for (let i = 0, s = left, d = 0; i < n; i += 1, s += 2, d += 4) {
          const v = src[s]!
          dst[d] = v
          dst[d + 1] = v
          dst[d + 2] = v
          dst[d + 3] = src[s + 1]!
        }
      }
    }
    return (n, src) => {
      for (let i = 0, s = left, d = 0; i < n; i += 1, s += 4, d += 4) {
        const v = to8((src[s]! << 8) | src[s + 1]!)
        dst[d] = v
        dst[d + 1] = v
        dst[d + 2] = v
        dst[d + 3] = to8((src[s + 2]! << 8) | src[s + 3]!)
      }
    }
  }
  if (colourType === 0) {
    const k = key?.[0] ?? -1
    if (depth === 16) {
      return (n, src) => {
        for (let i = 0, s = left, d = 0; i < n; i += 1, s += 2, d += 4) {
          const raw = (src[s]! << 8) | src[s + 1]!
          const v = to8(raw)
          dst[d] = v
          dst[d + 1] = v
          dst[d + 2] = v
          dst[d + 3] = raw === k ? 0 : 255
        }
      }
    }
    // 1, 2, 4 or 8 bits: unpacked MSB first and scaled to 0..255; the key is a raw sample.
    const mask = (1 << depth) - 1
    const scale = 255 / mask
    const shift = SHIFTS[depth] ?? 0
    const within = (1 << shift) - 1
    return (n, src) => {
      for (let i = 0, d = 0; i < n; i += 1, d += 4) {
        const byte = src[left + (i >>> shift)]!
        const raw = (byte >>> (8 - depth * ((i & within) + 1))) & mask
        const v = raw * scale
        dst[d] = v
        dst[d + 1] = v
        dst[d + 2] = v
        dst[d + 3] = raw === k ? 0 : 255
      }
    }
  }
  // A palette: indices of 1, 2, 4 or 8 bits through the RGBA table.
  if (depth === 8) {
    return (n, src) => {
      for (let i = 0; i < n; i += 1) dst32[i] = palette32[src[left + i]!]!
    }
  }
  const mask = (1 << depth) - 1
  const shift = SHIFTS[depth] ?? 0
  const within = (1 << shift) - 1
  return (n, src) => {
    for (let i = 0; i < n; i += 1) {
      const byte = src[left + (i >>> shift)]!
      dst32[i] = palette32[(byte >>> (8 - depth * ((i & within) + 1))) & mask]!
    }
  }
}

/**
 * The decoder of a PNG whose header `pngHeaderOf` read and the caller checked
 * against its caps; throws a `PNG: …` Error when there is nothing to decode
 * (no image data, a palette image with no palette).
 */
export const createPngDecoder = (bytes: Uint8Array, sink: RowSink): PngDecoder => {
  const header = pngHeaderOf(bytes)
  if (typeof header === 'string') throw new Error(header)
  const { width, height, bitDepth, colourType, interlaced } = header

  // The chunks: the palette, the transparency and the size of the image data.
  let paletteSize = 0
  const palette = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i += 1) palette[i * 4 + 3] = 255
  let key: number[] | undefined
  let hasTrns = false
  let dataBytes = 0
  // Where each piece of the image data is, as start and end pairs.
  const pieces: number[] = []
  eachChunk(bytes, (type, start, end) => {
    if (type === IDAT) {
      dataBytes += end - start
      pieces.push(start, end)
    } else if (type === PLTE) {
      paletteSize = min(256, floor((end - start) / 3))
      for (let i = 0; i < paletteSize; i += 1) {
        palette[i * 4] = bytes[start + i * 3]!
        palette[i * 4 + 1] = bytes[start + i * 3 + 1]!
        palette[i * 4 + 2] = bytes[start + i * 3 + 2]!
      }
    } else if (type === TRNS) {
      if (colourType === 3) {
        for (let i = 0; i < min(end - start, 256); i += 1) palette[i * 4 + 3] = bytes[start + i]!
        hasTrns = true
      } else if (colourType === 0 && end - start >= 2) {
        key = [(bytes[start]! << 8) | bytes[start + 1]!]
        hasTrns = true
      } else if (colourType === 2 && end - start >= 6) {
        key = [0, 2, 4].map(at => (bytes[start + at]! << 8) | bytes[start + at + 1]!)
        hasTrns = true
      }
    }
  })
  if (dataBytes === 0) throw new Error('PNG: no image data')
  if (colourType === 3 && paletteSize === 0) throw new Error('PNG: palette image with no PLTE')
  // The image data's pieces joined, with the inflater's padding after them.
  const compressed = new Uint8Array(dataBytes + INFLATE_PAD)
  for (let i = 0, joined = 0; i < pieces.length; i += 2) {
    const start = pieces[i]!
    const end = pieces[i + 1]!
    compressed.set(bytes.subarray(start, end), joined)
    joined += end - start
  }
  const inflater = createZlibInflater(compressed, dataBytes)

  // The geometry: Adam7's seven sub-images, or the one.
  const bitsPerPixel = (CHANNELS[colourType] ?? 1) * bitDepth
  const bpp = max(1, bitsPerPixel >>> 3)
  const rowBytesOf = (pixels: number): number => ceil((pixels * bitsPerPixel) / 8)
  const passes: Pass[] = (interlaced ? ADAM7 : ([[0, 0, 1, 1]] as const))
    .map(([x0, y0, dx, dy]) => {
      const passWidth = max(0, ceil((width - x0) / dx))
      const passHeight = max(0, ceil((height - y0) / dy))

      return { x0, y0, dx, dy, width: passWidth, height: passHeight, rowBytes: rowBytesOf(passWidth) }
    })
    .filter(pass => pass.width > 0 && pass.height > 0)

  // Row buffers with `bpp` zero bytes on the left, so the filters need no
  // edge case; the RGBA row has a 32-bit view for palette lookups.
  const widest = rowBytesOf(width)
  let prev = new Uint8Array(bpp + widest)
  let cur = new Uint8Array(bpp + widest)
  const rgbaBuffer = new ArrayBuffer(width * 4)
  const rgba = new Uint8Array(rgbaBuffer)
  const convert = converterOf(colourType, bitDepth, bpp, rgba, new Uint32Array(rgbaBuffer), new Uint32Array(palette.buffer), key)

  let passIndex = 0
  let rowInPass = 0
  // Bytes of the row in hand, or -1 while its filter byte is due.
  let filled = -1
  let filter = 0
  let rowsDone = 0
  let finished = false

  // The data stops here: the rows decoded stand, and with none there is no picture.
  const stop = (why: string): void => {
    finished = true
    if (passIndex < passes.length && rowsDone === 0) throw new Error(`PNG: ${why}`)
  }

  const finishRow = (pass: Pass): void => {
    unfilter(filter, cur, prev, bpp, pass.rowBytes)
    convert(pass.width, cur)
    sink.row(pass.y0 + rowInPass * pass.dy, pass.x0, pass.dx, rgba, pass.width)
    rowsDone += 1
    const swap = prev
    prev = cur
    cur = swap
    rowInPass += 1
    if (rowInPass === pass.height) {
      passIndex += 1
      rowInPass = 0
      prev.fill(0)
    }
  }

  // Inflated bytes split into rows as they come.
  const feed = (chunk: Uint8Array): void => {
    let i = 0
    while (i < chunk.length && passIndex < passes.length) {
      if (filled < 0) {
        filter = chunk[i]!
        i += 1
        if (filter > 4) {
          stop(`bad filter type ${filter}`)
          return
        }
        filled = 0
        continue
      }
      const pass = passes[passIndex]!
      const n = min(pass.rowBytes - filled, chunk.length - i)
      cur.set(chunk.subarray(i, i + n), bpp + filled)
      filled += n
      i += n
      if (filled === pass.rowBytes) {
        filled = -1
        finishRow(pass)
      }
    }
  }

  return {
    mayHaveAlpha: colourType === 4 || colourType === 6 || hasTrns,
    step: deadline => {
      while (!finished) {
        const chunk = inflater.next()
        if (chunk === undefined) {
          stop(`image data: ${inflater.failure() ?? 'ended early'}`)
          break
        }
        feed(chunk)
        if (passIndex >= passes.length) finished = true
        if (finished || performance.now() >= deadline) break
      }

      return finished
    },
  }
}
