// Raw DEFLATE (RFC 1951) in its zlib wrapper (RFC 1950), for the image data
// of a PNG (hooks/decode-png.ts): typed arrays and arithmetic only, since the
// hooks environment has no `DecompressionStream`. Resumable: each `next()`
// decodes until a chunk of output is ready (64 KiB) or sixteen block headers
// have gone by, then returns and keeps its place, so the caller works in
// slices of a few milliseconds whatever the stream holds. The window (32 KiB)
// and one chunk are all it keeps, whatever the size of the output.
//
// A Huffman code is read through one flat table indexed by the next
// `maxBits` bits of a little-endian bit buffer, each entry `symbol << 4 |
// length`. The Adler-32 at the end is not checked: a picture with a bad
// checksum still shows, as it does in a browser. A stream cut short hands out
// every byte decoded from real data and stops at the first bit past its end.

const { min } = Math

const LEN_BASE = Uint16Array.of(3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0)
const LEN_EXTRA = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 0, 0)
const DIST_BASE = Uint16Array.of(1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577, 0, 0)
const DIST_EXTRA = Uint8Array.of(0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 0, 0)
// The order the code length code's own lengths come in.
const CL_ORDER = Uint8Array.of(16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15)

/** Bytes a match reaches back: the window kept from one chunk to the next. */
const WINDOW_BYTES = 32_768
/** The most one length and distance pair writes. */
const MAX_MATCH = 258
/** Output one `next()` hands out: this much, and at most one match more. */
const CHUNK_BYTES = 65_536
/** Block headers one `next()` reads, at most: a stream of empty blocks still returns now and then. */
const HEADERS_PER_CALL = 16

/** Bytes of `src` after the stream the bit reader may run ahead into (it never uses them). */
export const INFLATE_PAD = 8

/**
 * A DEFLATE stream decoded a chunk at a time. `next()` hands out the new
 * output, a view of the inflater's own buffer that the next call overwrites
 * (empty when only block headers went by), and undefined once the stream has
 * ended or failed; `failure()` then says why it stopped short, if it did.
 */
export type Inflater = {
  next: () => Uint8Array | undefined
  /** Why the stream stopped short (cut off or corrupt), every byte before it handed out; undefined while it is sound. */
  failure: () => string | undefined
}

type Mode = 'header' | 'stored' | 'codes' | 'done'

/**
 * Fills `table` for the canonical code of lengths `lens[0..count)` and gives
 * its index width; undefined for an over-subscribed code, which no sound
 * stream holds. An incomplete code is allowed (a lone distance code): its
 * holes stay 0, a code that cannot occur.
 */
const tableOf = (lens: Uint8Array, count: number, table: Uint16Array, counts: Uint16Array, next: Uint16Array): number | undefined => {
  counts.fill(0)
  let maxBits = 0
  for (let s = 0; s < count; s += 1) {
    const l = lens[s]!
    counts[l] = counts[l]! + 1
    if (l > maxBits) maxBits = l
  }
  counts[0] = 0
  let left = 1
  for (let l = 1; l <= 15; l += 1) {
    left = (left << 1) - counts[l]!
    if (left < 0) return undefined
  }
  next[1] = 0
  for (let l = 1; l < 15; l += 1) next[l + 1] = (next[l]! + counts[l]!) << 1
  const size = 1 << maxBits
  table.fill(0, 0, size)
  for (let s = 0; s < count; s += 1) {
    const l = lens[s]!
    if (l === 0) continue
    // The code is read MSB first: reversed for the LSB-first bit buffer.
    let code = next[l]!
    next[l] = code + 1
    let reversed = 0
    for (let i = 0; i < l; i += 1) {
      reversed = (reversed << 1) | (code & 1)
      code >>>= 1
    }
    const entry = (s << 4) | l
    for (let i = reversed; i < size; i += 1 << l) table[i] = entry
  }

  return maxBits
}

// The fixed codes (block type 1), built the first time a stream uses them.
let fixedTables: { lit: Uint16Array; dist: Uint16Array } | undefined

const fixedTablesOf = (): { lit: Uint16Array; dist: Uint16Array } => {
  if (fixedTables !== undefined) return fixedTables
  const lens = new Uint8Array(288)
  lens.fill(8, 0, 144)
  lens.fill(9, 144, 256)
  lens.fill(7, 256, 280)
  lens.fill(8, 280, 288)
  const counts = new Uint16Array(16)
  const next = new Uint16Array(16)
  const lit = new Uint16Array(1 << 9)
  tableOf(lens, 288, lit, counts, next)
  lens.fill(5, 0, 30)
  const dist = new Uint16Array(1 << 5)
  tableOf(lens, 30, dist, counts, next)
  fixedTables = { lit, dist }

  return fixedTables
}

/**
 * The DEFLATE stream `src[start..end)`; `src` holds `INFLATE_PAD` bytes more
 * after `end`, whatever they are, so the bit reader never reads out of bounds.
 */
export const createInflater = (src: Uint8Array, start: number, end: number): Inflater => {
  const out = new Uint8Array(WINDOW_BYTES + CHUNK_BYTES + MAX_MATCH)
  const lens = new Uint8Array(320)
  const counts = new Uint16Array(16)
  const nextCode = new Uint16Array(16)
  const clTable = new Uint16Array(1 << 7)
  const dynamicLit = new Uint16Array(1 << 15)
  const dynamicDist = new Uint16Array(1 << 15)
  let op = 0
  let pos = start
  let bitBuf = 0
  let bitCnt = 0
  let final = false
  let mode: Mode = 'header'
  let storedLeft = 0
  let lit: Uint16Array = dynamicLit
  let dist: Uint16Array = dynamicDist
  let litMask = 0
  let distMask = 0
  // The failure thrown, told apart from any other throw by identity.
  let failed: Error | undefined

  // Ended or failed: nothing more to hand out.
  const isStopped = (): boolean => failed !== undefined || mode === 'done'

  const fail: (why: string) => never = why => {
    failed = new Error(why)
    throw failed
  }

  const readHeader = (): void => {
    while (bitCnt < 3) {
      bitBuf |= src[pos]! << bitCnt
      pos += 1
      bitCnt += 8
    }
    final = (bitBuf & 1) === 1
    const type = (bitBuf >>> 1) & 3
    bitBuf >>>= 3
    bitCnt -= 3
    if (type === 0) {
      // Stored: on to the byte boundary, the whole bytes the buffer holds given back.
      pos -= bitCnt >>> 3
      bitBuf = 0
      bitCnt = 0
      if (pos + 4 > end) fail('unexpected end of data')
      const length = src[pos]! | (src[pos + 1]! << 8)
      const check = src[pos + 2]! | (src[pos + 3]! << 8)
      if ((length ^ 0xffff) !== check) fail('stored block length check failed')
      pos += 4
      if (pos + length > end) fail('unexpected end of data')
      storedLeft = length
      mode = 'stored'

      return
    }
    if (type === 1) {
      const fixed = fixedTablesOf()
      lit = fixed.lit
      dist = fixed.dist
      litMask = (1 << 9) - 1
      distMask = (1 << 5) - 1
      mode = 'codes'

      return
    }
    if (type === 3) fail('invalid block type')
    while (bitCnt < 14) {
      bitBuf |= src[pos]! << bitCnt
      pos += 1
      bitCnt += 8
    }
    const hlit = (bitBuf & 31) + 257
    const hdist = ((bitBuf >>> 5) & 31) + 1
    const hclen = ((bitBuf >>> 10) & 15) + 4
    bitBuf >>>= 14
    bitCnt -= 14
    if (hlit > 286 || hdist > 30) fail('bad code counts')
    lens.fill(0, 0, 19)
    for (let i = 0; i < hclen; i += 1) {
      if (bitCnt < 3) {
        bitBuf |= src[pos]! << bitCnt
        pos += 1
        bitCnt += 8
      }
      lens[CL_ORDER[i]!] = bitBuf & 7
      bitBuf >>>= 3
      bitCnt -= 3
    }
    const clBits = tableOf(lens, 19, clTable, counts, nextCode)
    if (clBits === undefined || clBits === 0) fail('bad code length code')
    const clMask = (1 << clBits) - 1
    const total = hlit + hdist
    lens.fill(0, 0, 320)
    for (let i = 0; i < total; ) {
      if (pos > end + 4) fail('unexpected end of data')
      while (bitCnt < 16) {
        bitBuf |= src[pos]! << bitCnt
        pos += 1
        bitCnt += 8
      }
      const entry = clTable[bitBuf & clMask]!
      if (entry === 0) fail('bad code length code')
      const length = entry & 15
      const sym = entry >>> 4
      bitBuf >>>= length
      bitCnt -= length
      if (sym < 16) {
        lens[i] = sym
        i += 1
        continue
      }
      let repeat: number
      let value = 0
      if (sym === 16) {
        if (i === 0) fail('repeat with no length before it')
        value = lens[i - 1]!
        repeat = 3 + (bitBuf & 3)
        bitBuf >>>= 2
        bitCnt -= 2
      } else if (sym === 17) {
        repeat = 3 + (bitBuf & 7)
        bitBuf >>>= 3
        bitCnt -= 3
      } else {
        repeat = 11 + (bitBuf & 127)
        bitBuf >>>= 7
        bitCnt -= 7
      }
      if (i + repeat > total) fail('code lengths overrun')
      lens.fill(value, i, i + repeat)
      i += repeat
    }
    if (lens[256] === 0) fail('no end-of-block code')
    const litBits = tableOf(lens, hlit, dynamicLit, counts, nextCode)
    const distBits = tableOf(lens.subarray(hlit, total), hdist, dynamicDist, counts, nextCode)
    if (litBits === undefined || distBits === undefined) fail('over-subscribed Huffman code')
    lit = dynamicLit
    dist = dynamicDist
    litMask = (1 << litBits) - 1
    distMask = (1 << distBits) - 1
    mode = 'codes'
  }

  // Decodes until a chunk's worth is out (`limit`), the stream ends or the header budget is spent.
  const run = (limit: number): void => {
    let headers = 0
    while (mode !== 'done') {
      if (mode === 'header') {
        if (headers === HEADERS_PER_CALL) return
        headers += 1
        readHeader()
      }
      if (mode === 'stored') {
        const n = min(storedLeft, limit - op)
        out.set(src.subarray(pos, pos + n), op)
        op += n
        pos += n
        storedLeft -= n
        if (storedLeft > 0) return
        mode = final ? 'done' : 'header'
        continue
      }
      // A coded block: the hot loop, on locals. A symbol whose bits run past
      // `end` is never used: the stream was cut there.
      const litTable = lit
      const distTable = dist
      const litBits = litMask
      const distBits = distMask
      let o = op
      let p = pos
      let buf = bitBuf
      let cnt = bitCnt
      let ended = false
      while (o < limit) {
        if (cnt < 25) {
          do {
            buf |= src[p]! << cnt
            p += 1
            cnt += 8
          } while (cnt < 25)
        }
        const e = litTable[buf & litBits]!
        const l = e & 15
        buf >>>= l
        cnt -= l
        if (l === 0 || (p > end && (p - end) << 3 > cnt)) {
          op = o
          fail(l === 0 ? 'invalid literal/length code' : 'unexpected end of data')
        }
        const sym = e >>> 4
        if (sym < 256) {
          out[o] = sym
          o += 1
          continue
        }
        if (sym === 256) {
          ended = true
          break
        }
        const li = sym - 257
        if (li > 28) {
          op = o
          fail('invalid length symbol')
        }
        const le = LEN_EXTRA[li]!
        const length = LEN_BASE[li]! + (buf & ((1 << le) - 1))
        buf >>>= le
        cnt -= le
        if (cnt < 15) {
          buf |= src[p]! << cnt
          cnt += 8
          buf |= src[p + 1]! << cnt
          cnt += 8
          p += 2
        }
        const d = distTable[buf & distBits]!
        const dl = d & 15
        const dsym = d >>> 4
        if (dl === 0 || dsym > 29) {
          op = o
          fail('invalid distance code')
        }
        buf >>>= dl
        cnt -= dl
        const de = DIST_EXTRA[dsym]!
        while (cnt < de) {
          buf |= src[p]! << cnt
          p += 1
          cnt += 8
        }
        const back = DIST_BASE[dsym]! + (buf & ((1 << de) - 1))
        buf >>>= de
        cnt -= de
        if (p > end && (p - end) << 3 > cnt) {
          op = o
          fail('unexpected end of data')
        }
        if (back > o) {
          op = o
          fail('distance too far back')
        }
        let from = o - back
        const stop = o + length
        while (o < stop) {
          out[o] = out[from]!
          o += 1
          from += 1
        }
      }
      op = o
      pos = p
      bitBuf = buf
      bitCnt = cnt
      if (!ended) return
      mode = final ? 'done' : 'header'
    }
  }

  return {
    next: () => {
      if (isStopped()) return undefined
      // Keep the window, drop what was handed out before it.
      if (op > WINDOW_BYTES) {
        out.copyWithin(0, op - WINDOW_BYTES, op)
        op = WINDOW_BYTES
      }
      const from = op
      try {
        run(from + CHUNK_BYTES)
      } catch (thrown) {
        if (thrown !== failed) throw thrown
      }
      if (op === from && isStopped()) return undefined

      return out.subarray(from, op)
    },
    failure: () => failed?.message,
  }
}

/** Why a zlib stream's two-byte header is not one DEFLATE stream holds, or undefined when it is. */
const zlibHeaderFaultOf = (src: Uint8Array, end: number): string | undefined => {
  if (end < 2) return 'zlib stream too short'
  const cmf = src[0]!
  const flg = src[1]!
  if ((cmf & 15) !== 8 || cmf >>> 4 > 7) return 'not a DEFLATE zlib stream'
  if (((cmf << 8) | flg) % 31 !== 0) return 'zlib header check failed'
  if ((flg & 32) !== 0) return 'zlib preset dictionary'

  return undefined
}

/**
 * The DEFLATE stream inside the zlib stream `src[0..end)` (padded as for
 * `createInflater`), its two-byte header checked: a bad header gives an
 * inflater that has already failed.
 */
export const createZlibInflater = (src: Uint8Array, end: number): Inflater => {
  const fault = zlibHeaderFaultOf(src, end)
  if (fault === undefined) return createInflater(src, 2, end)

  return { next: () => undefined, failure: () => fault }
}
