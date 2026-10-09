// A PNG as hooks/png.ts writes it, read back for the tests: base64 to bytes,
// its chunks, the zlib stream inflated (stored and fixed-Huffman blocks, what
// the writer makes), its rows unfiltered; each chunk's CRC and the stream's
// Adler-32 checked on the way.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const bytesOf = (base64: string): Uint8Array => {
  const clean = base64.replace(/=+$/, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let count = 0
  let at = 0
  for (const ch of clean) {
    bits = (bits << 6) | ALPHABET.indexOf(ch)
    count += 6
    if (count >= 8) {
      count -= 8
      out[at] = (bits >> count) & 255
      at += 1
    }
  }

  return out
}

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff
  for (const byte of bytes) {
    c ^= byte
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }

  return (c ^ 0xffffffff) >>> 0
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]

/** A raw deflate stream inflated: its stored and fixed-Huffman blocks (a dynamic one throws). */
export const inflate = (data: Uint8Array): Uint8Array => {
  const out: number[] = []
  let at = 0
  let bit = 0
  const read = (n: number): number => {
    let value = 0
    for (let index = 0; index < n; index += 1) {
      const byte = data[at]
      if (byte === undefined) throw new Error('the stream ends early')
      value |= ((byte >> bit) & 1) << index
      bit += 1
      if (bit === 8) {
        bit = 0
        at += 1
      }
    }

    return value
  }
  // A Huffman code's bits come most significant first.
  const code = (n: number, start: number): number => {
    let value = start
    for (let index = 0; index < n; index += 1) value = (value << 1) | read(1)

    return value
  }
  const symbol = (): number => {
    const seven = code(7, 0)
    if (seven <= 23) return 256 + seven
    const eight = code(1, seven)
    if (eight >= 48 && eight <= 191) return eight - 48
    if (eight >= 192 && eight <= 199) return 280 + eight - 192

    return 144 + code(1, eight) - 400
  }
  for (let last = 0; last === 0; ) {
    last = read(1)
    const type = read(2)
    if (type === 0) {
      if (bit > 0) {
        bit = 0
        at += 1
      }
      const length = (data[at] ?? 0) | ((data[at + 1] ?? 0) << 8)
      at += 4
      for (let index = 0; index < length; index += 1) out.push(data[at + index] ?? 0)
      at += length
      continue
    }
    if (type !== 1) throw new Error(`a block of type ${type}`)
    for (;;) {
      const next = symbol()
      if (next < 256) out.push(next)
      else if (next === 256) break
      else {
        const index = next - 257
        const length = (LENGTH_BASE[index] ?? 0) + read(LENGTH_EXTRA[index] ?? 0)
        const place = code(5, 0)
        const distance = (DISTANCE_BASE[place] ?? 0) + read(DISTANCE_EXTRA[place] ?? 0)
        for (let index2 = 0; index2 < length; index2 += 1) out.push(out[out.length - distance] ?? 0)
      }
    }
  }

  return new Uint8Array(out)
}

/** A whole PNG (bytes or base64) read back: its size and its RGBA pixels; throws on a bad CRC, check or filter. */
export const pngPixels = (png: Uint8Array | string): { width: number; height: number; pixels: Uint8Array } => {
  const bytes = typeof png === 'string' ? bytesOf(png) : png
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (!signature.every((byte, index) => bytes[index] === byte)) throw new Error('not a PNG')
  const word = (at: number): number => (((bytes[at] ?? 0) << 24) | ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)) >>> 0
  let at = 8
  let width = 0
  let height = 0
  const idat: number[] = []
  while (at < bytes.length) {
    const length = word(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (crc32(bytes.subarray(at + 4, at + 8 + length)) !== word(at + 8 + length)) throw new Error(`${type}: bad CRC`)
    if (type === 'IHDR') {
      width = word(at + 8)
      height = word(at + 12)
      if (body[8] !== 8 || body[9] !== 6) throw new Error('not 8-bit RGBA')
    }
    if (type === 'IDAT') idat.push(...body)
    at += 12 + length
  }
  const stream = new Uint8Array(idat)
  const raw = inflate(stream.subarray(2, stream.length - 4))
  let a = 1
  let b = 0
  for (const byte of raw) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  const check = (((stream[stream.length - 4] ?? 0) << 24) | ((stream[stream.length - 3] ?? 0) << 16) | ((stream[stream.length - 2] ?? 0) << 8) | (stream[stream.length - 1] ?? 0)) >>> 0
  if ((((b << 16) | a) >>> 0) !== check) throw new Error('bad Adler-32')
  const stride = width * 4
  const pixels = new Uint8Array(stride * height)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    if (filter !== 1) throw new Error(`row ${y}: filter ${filter}`)
    for (let x = 0; x < stride; x += 1) pixels[y * stride + x] = ((raw[y * (stride + 1) + 1 + x] ?? 0) + (x >= 4 ? (pixels[y * stride + x - 4] ?? 0) : 0)) & 255
  }

  return { width, height, pixels }
}

/** How many of the pixels are about `hex` (each channel within `slack`) and mostly opaque. */
export const countColour = (picture: { pixels: Uint8Array }, hex: string, slack = 6): number => {
  const n = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  let count = 0
  for (let at = 0; at < picture.pixels.length; at += 4) {
    if ((picture.pixels[at + 3] ?? 0) < 200) continue
    if (Math.abs((picture.pixels[at] ?? 0) - r) <= slack && Math.abs((picture.pixels[at + 1] ?? 0) - g) <= slack && Math.abs((picture.pixels[at + 2] ?? 0) - b) <= slack) count += 1
  }

  return count
}
