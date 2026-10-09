import type { RowSink } from './image-types'
import { bytesOf } from './images-bytes'

// What the decoder tests share: base64 fixtures to bytes, a sink that keeps
// every pixel, SHA-256 digests, a seeded byte generator (the same one
// scratch tooling made the zlib fixtures with), PNGs of stored blocks built
// here at any size, and VP8L streams written bit by bit, for WebP headers and
// refusals no encoder writes.

/** The bytes of a base64 fixture written over several lines. */
export const fixtureBytesOf = (text: string): Uint8Array => bytesOf(text.replace(/\s+/g, ''))

/** A sink that keeps the whole picture: `data` is RGBA, `width` by `height`. */
type FullSink = RowSink & { data: Uint8Array; rows: number }

export const fullSinkOf = (width: number, height: number): FullSink => {
  const data = new Uint8Array(width * height * 4)
  const sink: FullSink = {
    data,
    rows: 0,
    row: (y, x0, dx, rgba, n) => {
      sink.rows += 1
      for (let i = 0, s = 0, d = (y * width + x0) * 4; i < n; i += 1, s += 4, d += dx * 4) {
        data[d] = rgba[s]!
        data[d + 1] = rgba[s + 1]!
        data[d + 2] = rgba[s + 2]!
        data[d + 3] = rgba[s + 3]!
      }
    },
  }

  return sink
}

/** SHA-256 of the bytes, in hex. */
export const digestOf = async (bytes: Uint8Array): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')

/** `n` bytes of a linear congruential generator: seed = seed * 1103515245 + 12345 (mod 2^32), each byte bits 16 to 23. */
export const lcgBytesOf = (seed: number, n: number): Uint8Array => {
  const bytes = new Uint8Array(n)
  let state = seed >>> 0
  for (let i = 0; i < n; i += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    bytes[i] = (state >>> 16) & 255
  }

  return bytes
}

/** A seeded generator of whole numbers below `n`, for the fuzz. */
export const randomOf = (seed: number): ((n: number) => number) => {
  let state = seed >>> 0

  return n => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0

    return (state >>> 8) % n
  }
}

const chunkOf = (type: string, data: Uint8Array): Uint8Array => {
  // The CRC is left zero: the decoder never reads it.
  const chunk = new Uint8Array(12 + data.length)
  new DataView(chunk.buffer).setUint32(0, data.length)
  chunk.set(new TextEncoder().encode(type), 4)
  chunk.set(data, 8)

  return chunk
}

const joined = (parts: readonly Uint8Array[]): Uint8Array => {
  const all = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let at = 0
  for (const part of parts) {
    all.set(part, at)
    at += part.length
  }

  return all
}

/** `raw` in a zlib stream of stored blocks (65,535 bytes at most each), its Adler-32 after them. */
const storedZlibOf = (raw: Uint8Array): Uint8Array => {
  const blocks = Math.max(1, Math.ceil(raw.length / 65_535))
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4)
  out.set([0x78, 0x01])
  let at = 2
  for (let i = 0; i < blocks; i += 1) {
    const piece = raw.subarray(i * 65_535, (i + 1) * 65_535)
    out.set([i === blocks - 1 ? 1 : 0, piece.length & 255, piece.length >>> 8, ~piece.length & 255, (~piece.length >>> 8) & 255], at)
    out.set(piece, at + 5)
    at += 5 + piece.length
  }
  let a = 1
  let b = 0
  for (const byte of raw) {
    a = (a + byte) % 65_521
    b = (b + a) % 65_521
  }
  new DataView(out.buffer).setUint32(at, ((b << 16) | a) >>> 0)

  return out
}

/** An 8-bit RGB PNG of `raw` (each row a filter byte and its pixels) in stored blocks, its image data split over IDAT chunks of `idatBytes`. */
export const storedPngOf = (width: number, height: number, raw: Uint8Array, idatBytes: number): Uint8Array => {
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const zlib = storedZlibOf(raw)
  const idats: Uint8Array[] = []
  for (let at = 0; at < zlib.length; at += idatBytes) idats.push(chunkOf('IDAT', zlib.subarray(at, at + idatBytes)))

  return joined([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunkOf('IHDR', ihdr), ...idats, chunkOf('IEND', new Uint8Array(0))])
}

/** Bits written least significant first, as VP8L reads them. */
const bitWriterOf = (): { put: (value: number, bits: number) => void; bytes: () => Uint8Array } => {
  const out: number[] = []
  let at = 0

  return {
    put: (value, bits) => {
      for (let i = 0; i < bits; i += 1, at += 1) {
        if (at % 8 === 0) out.push(0)
        out[out.length - 1] = out.at(-1)! | (((value >>> i) & 1) << (at % 8))
      }
    },
    bytes: () => Uint8Array.from(out),
  }
}

/** A RIFF WebP holding one VP8L chunk with `payload`. */
export const webpOf = (payload: Uint8Array): Uint8Array => {
  const padded = payload.length + (payload.length & 1)
  const file = new Uint8Array(20 + padded)
  const view = new DataView(file.buffer)
  file.set([0x52, 0x49, 0x46, 0x46], 0)
  view.setUint32(4, 12 + padded, true)
  file.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c], 8)
  view.setUint32(16, payload.length, true)
  file.set(payload, 20)

  return file
}

/** VP8L's five one-symbol codes (green, red, blue, alpha, distance): no bits per pixel. */
const putFlatCodes = (bits: ReturnType<typeof bitWriterOf>, [a, r, g, b]: readonly [number, number, number, number]): void => {
  for (const symbol of [g, r, b, a, 0]) {
    bits.put(1, 1)
    bits.put(0, 1)
    bits.put(1, 1)
    bits.put(symbol, 8)
  }
}

/** What `flatWebpOf` writes beside its colour. */
type FlatWebpOptions = {
  /** Transforms by type, each with no data of its own (subtract green is 2). */
  transforms?: readonly number[]
  /** A colour cache of this many bits; 0 or none for no cache. */
  cacheBits?: number
  /** A group map of blocks `1 << bits` pixels square, each naming group `(red << 8) | green` of its colour. */
  groups?: { bits: number; argb: readonly [number, number, number, number] }
  argb?: readonly [number, number, number, number]
}

/**
 * A lossless WebP of one colour, `width` by `height`, written bit by bit:
 * the transforms, colour cache and group map asked for, and one-symbol codes
 * (for group 0 only, whatever the map names).
 */
export const flatWebpOf = (width: number, height: number, options: FlatWebpOptions = {}): Uint8Array => {
  const bits = bitWriterOf()
  const argb = options.argb ?? [255, 200, 100, 50]
  bits.put(0x2f, 8)
  bits.put(width - 1, 14)
  bits.put(height - 1, 14)
  bits.put(argb[0] === 255 ? 0 : 1, 1)
  bits.put(0, 3)
  for (const type of options.transforms ?? []) {
    bits.put(1, 1)
    bits.put(type, 2)
  }
  bits.put(0, 1)
  const cacheBits = options.cacheBits ?? 0
  bits.put(cacheBits === 0 ? 0 : 1, 1)
  if (cacheBits !== 0) bits.put(cacheBits, 4)
  if (options.groups === undefined) bits.put(0, 1)
  else {
    // The map is a sub-image of its own: no cache, then its codes.
    bits.put(1, 1)
    bits.put(options.groups.bits - 2, 3)
    bits.put(0, 1)
    putFlatCodes(bits, options.groups.argb)
  }
  putFlatCodes(bits, argb)

  return webpOf(bits.bytes())
}
