// RGBA pixels to a PNG file's bytes, and bytes to base64, with nothing but
// arrays: the hooks' environment has no zlib, no canvas and no Node. Each row
// filtered by its left neighbour (`Sub`: a run of one colour becomes zeros),
// then deflated with the fixed Huffman codes and matches found through a
// hash of the next three bytes: fast, and small for pictures of a few flat
// colours on a clear ground, as the mascots' frames are (hooks/scene-image.ts).

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }

  return table
})()

const crc32 = (bytes: Uint8Array, start: number, end: number): number => {
  let c = 0xffffffff
  for (let index = start; index < end; index += 1) c = (CRC_TABLE[(c ^ (bytes[index] ?? 0)) & 255] ?? 0) ^ (c >>> 8)

  return (c ^ 0xffffffff) >>> 0
}

/** A growing byte buffer, written a byte or a few bits at a time (deflate's order: least significant first). */
class Bytes {
  data: Uint8Array
  length = 0
  private bits = 0
  private count = 0

  constructor(size: number) {
    this.data = new Uint8Array(Math.max(64, size))
  }

  private room(more: number): void {
    if (this.length + more <= this.data.length) return
    const grown = new Uint8Array(Math.max(this.data.length * 2, this.length + more))
    grown.set(this.data.subarray(0, this.length))
    this.data = grown
  }

  byte(value: number): void {
    this.room(1)
    this.data[this.length] = value & 255
    this.length += 1
  }

  u32(value: number): void {
    this.byte(value >>> 24)
    this.byte(value >>> 16)
    this.byte(value >>> 8)
    this.byte(value)
  }

  put(bytes: Uint8Array): void {
    this.room(bytes.length)
    this.data.set(bytes, this.length)
    this.length += bytes.length
  }

  /** `n` bits of `value`, its lowest first. */
  write(value: number, n: number): void {
    this.bits |= value << this.count
    this.count += n
    while (this.count >= 8) {
      this.byte(this.bits)
      this.bits >>>= 8
      this.count -= 8
    }
  }

  /** The last bits padded out to a byte. */
  flush(): void {
    if (this.count > 0) this.byte(this.bits)
    this.bits = 0
    this.count = 0
  }

  view(): Uint8Array {
    return this.data.subarray(0, this.length)
  }
}

const reversed = (code: number, length: number): number => {
  let out = 0
  for (let bit = 0; bit < length; bit += 1) out |= ((code >>> bit) & 1) << (length - 1 - bit)

  return out
}

// The fixed Huffman codes (RFC 1951 3.2.6), bit-reversed for an LSB-first stream.
const LITERAL_CODE = new Uint16Array(288)
const LITERAL_BITS = new Uint8Array(288)
for (let symbol = 0; symbol < 288; symbol += 1) {
  const [base, from, bits] = symbol < 144 ? [0x30, 0, 8] : symbol < 256 ? [0x190, 144, 9] : symbol < 280 ? [0, 256, 7] : [0xc0, 280, 8]
  LITERAL_CODE[symbol] = reversed(base + symbol - from, bits)
  LITERAL_BITS[symbol] = bits
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258] as const
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0] as const
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577] as const
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13] as const

// Each match length's and distance's symbol, looked up rather than searched.
const LENGTH_SYMBOL = new Uint8Array(259)
for (let index = 0; index < LENGTH_BASE.length; index += 1) {
  const end = index + 1 < LENGTH_BASE.length ? (LENGTH_BASE[index + 1] ?? 259) : 259
  for (let length = LENGTH_BASE[index] ?? 3; length < end; length += 1) LENGTH_SYMBOL[length] = index
}
LENGTH_SYMBOL[258] = 28
const DISTANCE_CODE = new Uint8Array(30).map((_, symbol) => reversed(symbol, 5))

const distanceSymbol = (distance: number): number => {
  let low = 0
  let high = DISTANCE_BASE.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if ((DISTANCE_BASE[middle] ?? 0) <= distance) low = middle
    else high = middle - 1
  }

  return low
}

const WINDOW = 32768
const HASH_BITS = 15
const MAX_MATCH = 258

/** How long `data` matches itself from `at` against from `from` on, up to `limit`. */
const matchLength = (data: Uint8Array, from: number, at: number, limit: number): number => {
  let n = 0
  while (n < limit && data[from + n] === data[at + n]) n += 1

  return n
}

/**
 * `data` deflated in one fixed-Huffman block: at each position the longer of
 * the run a byte back (a run of one byte matches itself so) and the match at
 * the last position seen with the same next three bytes, else a literal.
 */
export const deflate = (data: Uint8Array): Uint8Array => {
  const out = new Bytes(data.length / 4 + 64)
  out.write(1, 1)
  out.write(1, 2)
  const last = new Int32Array(1 << HASH_BITS).fill(-1)
  const mask = (1 << HASH_BITS) - 1
  const hashAt = (at: number): number => (((data[at] ?? 0) << 10) ^ ((data[at + 1] ?? 0) << 5) ^ (data[at + 2] ?? 0)) & mask
  let at = 0
  while (at < data.length) {
    let length = 0
    let distance = 0
    if (at + 2 < data.length) {
      const limit = Math.min(MAX_MATCH, data.length - at)
      if (at > 0) {
        length = matchLength(data, at - 1, at, limit)
        distance = 1
      }
      const hash = hashAt(at)
      const before = last[hash] ?? -1
      last[hash] = at
      if (before >= 0 && before < at - 1 && at - before <= WINDOW && length < limit) {
        const n = matchLength(data, before, at, limit)
        if (n > length) {
          length = n
          distance = at - before
        }
      }
    }
    if (length < 3) {
      out.write(LITERAL_CODE[data[at] ?? 0] ?? 0, LITERAL_BITS[data[at] ?? 0] ?? 8)
      at += 1
      continue
    }
    const lengthIndex = LENGTH_SYMBOL[length] ?? 0
    out.write(LITERAL_CODE[257 + lengthIndex] ?? 0, LITERAL_BITS[257 + lengthIndex] ?? 7)
    out.write(length - (LENGTH_BASE[lengthIndex] ?? 3), LENGTH_EXTRA[lengthIndex] ?? 0)
    const distanceIndex = distanceSymbol(distance)
    out.write(DISTANCE_CODE[distanceIndex] ?? 0, 5)
    out.write(distance - (DISTANCE_BASE[distanceIndex] ?? 1), DISTANCE_EXTRA[distanceIndex] ?? 0)
    // A short match's positions go into the hash, so a later row finds them; a long run's need not.
    const end = at + length
    if (length < 32) for (let step = at + 1; step < end && step + 2 < data.length; step += 1) last[hashAt(step)] = step
    at = end
  }
  out.write(LITERAL_CODE[256] ?? 0, LITERAL_BITS[256] ?? 7)
  out.flush()

  return out.view()
}

const chunk = (out: Bytes, type: string, body: Uint8Array): void => {
  out.u32(body.length)
  const start = out.length
  for (let index = 0; index < 4; index += 1) out.byte(type.charCodeAt(index))
  out.put(body)
  out.u32(crc32(out.data, start, out.length))
}

/**
 * The pixels' rows filtered by `Sub` (each byte less the one a pixel to its
 * left), each after its filter byte, with the Adler-32 of all of it: a clear
 * row (the commonest here) is all zeros, its sum worked out without a pass.
 */
const filteredOf = (pixels: Uint8Array, width: number, height: number): { data: Uint8Array; adler: number } => {
  const stride = width * 4
  const data = new Uint8Array((stride + 1) * height)
  const words = pixels.byteOffset % 4 === 0 ? new Uint32Array(pixels.buffer, pixels.byteOffset, width * height) : undefined
  let a = 1
  let b = 0
  for (let y = 0; y < height; y += 1) {
    const row = y * stride
    const to = y * (stride + 1)
    data[to] = 1
    a += 1
    b += a
    let clear = words !== undefined
    if (words !== undefined) {
      for (let x = y * width, end = x + width; x < end; x += 1) {
        if (words[x] !== 0) {
          clear = false
          break
        }
      }
    }
    if (clear) {
      // Zeros leave the first sum as it is and add it to the second once a byte.
      b += a * stride
    } else {
      for (let x = 0; x < stride; x += 1) {
        const value = ((pixels[row + x] ?? 0) - (x >= 4 ? (pixels[row + x - 4] ?? 0) : 0)) & 255
        data[to + 1 + x] = value
        a += value
        b += a
      }
    }
    a %= 65521
    b %= 65521
  }

  return { data, adler: ((b << 16) | a) >>> 0 }
}

/** `width` by `height` RGBA pixels (straight alpha, 4 bytes each) as a whole PNG file. */
export const pngOf = (pixels: Uint8Array, width: number, height: number): Uint8Array => {
  const filtered = filteredOf(pixels, width, height)
  const packed = deflate(filtered.data)
  const out = new Bytes(packed.length + 128)
  for (const value of [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) out.byte(value)
  const header = new Bytes(13)
  header.u32(width)
  header.u32(height)
  for (const value of [8, 6, 0, 0, 0]) header.byte(value)
  chunk(out, 'IHDR', header.view())
  // The zlib stream: its header (deflate, a 32 KiB window), the data, the filtered bytes' Adler-32.
  const stream = new Bytes(packed.length + 6)
  stream.byte(0x78)
  stream.byte(0x01)
  stream.put(packed)
  stream.u32(filtered.adler)
  chunk(out, 'IDAT', stream.view())
  chunk(out, 'IEND', new Uint8Array(0))

  return out.view().slice()
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Bytes as base64, padded. */
export const base64Of = (bytes: Uint8Array): string => {
  const parts: string[] = []
  let line = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0
    const b = bytes[index + 1] ?? 0
    const c = bytes[index + 2] ?? 0
    const left = bytes.length - index
    line += ALPHABET[a >> 2]! + ALPHABET[((a & 3) << 4) | (b >> 4)]! + (left > 1 ? ALPHABET[((b & 15) << 2) | (c >> 6)]! : '=') + (left > 2 ? ALPHABET[c & 63]! : '=')
    if (line.length >= 4096) {
      parts.push(line)
      line = ''
    }
  }
  parts.push(line)

  return parts.join('')
}
