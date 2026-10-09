import type { RowSink } from './image-types'

// A JPEG decoded for thumbnails: only each 8x8 block's DC coefficient is
// reconstructed, which is the block's mean, so the picture comes out at 1/8
// scale, box-filtered exactly, with no IDCT. Baseline, extended and
// progressive Huffman JPEGs (SOF0, SOF1, SOF2), any sampling factors, restart
// intervals, greyscale, YCbCr and RGB, and EXIF orientation 1 to 8 applied to
// the small picture; progressive AC scans are skipped unread. Arithmetic
// coding, lossless, hierarchical, 12-bit and four-component (CMYK, YCCK)
// files are refused (the engine refuses CMYK too). Against libjpeg's own 1/8
// decode: greyscale is exact, 4:4:4, 4:2:2 and RGB within a level or two;
// 4:2:0 chroma, which libjpeg draws two by two per block from its first AC
// terms, is the block's mean here, so colours differ at coloured edges.
//
// Resumable like the PNG decoder (hooks/decode-png.ts): `step(deadline)`
// reads markers and decodes MCUs until the deadline, then turns the block
// means into rows for the sink. Data cut short or corrupt costs the blocks it
// should have held, which stay transparent (with restart intervals, only the
// rest of that interval); a file with no block at all is an error.

const { ceil, floor, max, min } = Math

/** A JPEG's frame header, as far as the decoder needs it. */
type JpegHeader = {
  /** The stored size, before EXIF orientation. */
  width: number
  height: number
  /** EXIF orientation, 1 to 8 (1 without one); 5 to 8 swap width and height. */
  orientation: number
  progressive: boolean
  /** Why the DC-only decoder cannot draw it (arithmetic coding, 12-bit samples, CMYK, ...), or undefined when it can. */
  unsupported?: string
}

/**
 * A JPEG decoded at 1/8 scale in slices: `step(deadline)` works until
 * `performance.now()` passes `deadline` or the picture is done, true then,
 * every row of `width` by `height` handed to the sink by then.
 */
export type JpegDecoder = {
  /** The size of the picture the sink receives: ceil(width / 8) by ceil(height / 8), oriented. */
  width: number
  height: number
  step: (deadline: number) => boolean
}

type Huffman = {
  /** A 9-bit lookahead: (length << 8) | symbol, 0 when the code is longer. */
  fast: Uint16Array
  /** maxcode[l]: the largest code of length l (MSB first), -1 if none; [17] a sentinel. */
  maxcode: Int32Array
  /** valptr[l]: where in `values` the codes of length l start, less their first code. */
  valptr: Int32Array
  values: Uint8Array
}

type Component = {
  id: number
  h: number
  v: number
  tq: number
  /** Blocks across and down, padded to whole MCUs. */
  bw: number
  bh: number
  /** The blocks that hold picture (a non-interleaved scan covers only these). */
  bwData: number
  bhData: number
  /** The quantised DC coefficient of each block (refinement bits or-ed in). */
  dc: Int32Array
  /** 1 where a block's DC came from real data. */
  seen: Uint8Array
  pred: number
  dcTable: number
  acTable: number
}

type Phase = 'markers' | 'scan' | 'convert' | 'emit' | 'done'

const FAST_BITS = 9
/** Blocks decoded between looks at the clock: an MCU is one block, or up to 4 x 4 of each component. */
const BLOCKS_PER_CHECK = 512
/** Marker segments read between looks at the clock. */
const SEGMENTS_PER_CHECK = 32
/** Rows converted or handed out between looks at the clock. */
const ROWS_PER_CHECK = 16

const buildHuffman = (counts: Uint8Array, values: Uint8Array): Huffman => {
  const fast = new Uint16Array(1 << FAST_BITS)
  const maxcode = new Int32Array(18).fill(-1)
  const valptr = new Int32Array(17)
  let code = 0
  let k = 0
  for (let l = 1; l <= 16; l += 1) {
    const n = counts[l - 1]!
    valptr[l] = k - code
    if (n > 0) {
      for (let i = 0; i < n; i += 1, k += 1, code += 1) {
        if (l > FAST_BITS) continue
        const shift = FAST_BITS - l
        const entry = (l << 8) | values[k]!
        for (let j = code << shift, end = (code + 1) << shift; j < end; j += 1) fast[j] = entry
      }
      maxcode[l] = code - 1
    }
    code <<= 1
  }
  maxcode[17] = 0x7fffffff

  return { fast, maxcode, valptr, values }
}

// A table no code is valid in: what a scan naming a missing table reads.
const NO_HUFFMAN: Huffman = { fast: new Uint16Array(1 << FAST_BITS), maxcode: new Int32Array(18).fill(-1), valptr: new Int32Array(17), values: new Uint8Array(0) }

/**
 * A scan's bit reader: MSB first, 0xFF00 unstuffed, zero bits past a marker
 * or the end of the data, `padBits` of them (a block that uses one is not
 * decoded). One object of a fixed shape, read by the module's own small
 * functions below, so the engine inlines the bit reading into the per-block
 * function as it would into a method.
 */
type BitReader = {
  bytes: Uint8Array
  pos: number
  bitBuf: number
  bitCnt: number
  markerHit: boolean
  padBits: number
  /** A block's bits ran past the data, or were no code: the rest of the restart interval (or of the scan, with none) is skipped. */
  starved: boolean
}

/** Tops the buffer up past 24 bits. */
const fill = (r: BitReader): void => {
  const b = r.bytes
  let { pos, bitBuf, bitCnt, padBits } = r
  while (bitCnt <= 24) {
    let byte = 0
    if (!r.markerHit && pos < b.length) {
      byte = b[pos]!
      if (byte === 0xff) {
        if (b[pos + 1] === 0) pos += 2
        else {
          r.markerHit = true
          byte = 0
          padBits += 8
        }
      } else pos += 1
    } else padBits += 8
    bitBuf = (bitBuf << 8) | byte
    bitCnt += 8
  }
  r.pos = pos
  r.bitBuf = bitBuf
  r.bitCnt = bitCnt
  r.padBits = padBits
}

/** The next Huffman symbol, or -1 for a code the table does not hold. */
const symbolOf = (r: BitReader, table: Huffman): number => {
  if (r.bitCnt < 16) fill(r)
  const bitBuf = r.bitBuf
  const bitCnt = r.bitCnt
  const entry = table.fast[(bitBuf >>> (bitCnt - FAST_BITS)) & ((1 << FAST_BITS) - 1)]!
  if (entry !== 0) {
    r.bitCnt = bitCnt - (entry >> 8)

    return entry & 255
  }
  let l = FAST_BITS + 1
  let code = (bitBuf >>> (bitCnt - l)) & ((1 << l) - 1)
  while (l <= 16 && code > table.maxcode[l]!) {
    l += 1
    code = (bitBuf >>> (bitCnt - l)) & ((1 << l) - 1)
  }
  if (l > 16) return -1
  r.bitCnt = bitCnt - l

  return table.values[table.valptr[l]! + code] ?? -1
}

/** The next `s` bits as a signed coefficient difference (JPEG's EXTEND). */
const extendedOf = (r: BitReader, s: number): number => {
  if (s === 0) return 0
  if (r.bitCnt < s) fill(r)
  const v = (r.bitBuf >>> (r.bitCnt - s)) & ((1 << s) - 1)
  r.bitCnt -= s

  return v < 1 << (s - 1) ? v - (1 << s) + 1 : v
}

/** A DC difference that is none: the block's bits were not there (cut short) or were no code. */
const NO_DC = 0x40000000

/** A block's DC difference: its category's code, then that many bits; `NO_DC` when either is not there. */
const dcDiffOf = (r: BitReader, table: Huffman): number => {
  const s = symbolOf(r, table)
  if (s < 0 || s > 16) return NO_DC
  const diff = extendedOf(r, s)

  return r.bitCnt < r.padBits ? NO_DC : diff
}

/**
 * A sequential block: its DC difference (`NO_DC` when its bits are not
 * there), then its AC codes read past, their values unread; when those run
 * past the data or are no codes, the reader is starved and the DC stands.
 */
const sequentialBlockOf = (r: BitReader, dc: Huffman, ac: Huffman): number => {
  const diff = dcDiffOf(r, dc)
  if (diff === NO_DC) return NO_DC
  for (let k = 1; k < 64; ) {
    const rs = symbolOf(r, ac)
    if (rs < 0) {
      r.starved = true

      return diff
    }
    const s = rs & 15
    const run = rs >> 4
    if (s === 0) {
      if (run !== 15) break
      k += 16
      continue
    }
    if (r.bitCnt < s) fill(r)
    r.bitCnt -= s
    k += run + 1
  }
  if (r.bitCnt < r.padBits) r.starved = true

  return diff
}

/** The frame markers: SOF0 to SOF15, less DHT (C4), JPG (C8) and DAC (CC). */
const isFrameMarker = (marker: number): boolean => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

/** Why a frame cannot be drawn from its DC terms alone, or undefined when it can. */
const unsupportedOf = (marker: number, precision: number, components: number, hierarchical: boolean): string | undefined => {
  if (marker === 0xc3 || marker === 0xc7 || marker === 0xcb || marker === 0xcf) return 'lossless JPEG'
  if (hierarchical || marker === 0xc5 || marker === 0xc6 || marker === 0xcd || marker === 0xce) return 'hierarchical JPEG'
  if (marker >= 0xc9) return 'arithmetic coding'
  if (precision !== 8) return `${precision}-bit samples`
  if (components === 4) return 'four components (CMYK or YCCK)'
  if (components !== 1 && components !== 3) return `${components} components`

  return undefined
}

/** EXIF orientation (1 to 8) from an APP1 segment `bytes[start..end)`, or 1. */
const exifOrientationOf = (bytes: Uint8Array, start: number, end: number): number => {
  // "Exif\0\0", then a TIFF header: the byte order, 42, the first IFD's offset.
  if (end - start < 14 || bytes[start] !== 0x45 || bytes[start + 1] !== 0x78 || bytes[start + 2] !== 0x69 || bytes[start + 3] !== 0x66) return 1
  const tiff = start + 6
  const little = bytes[tiff] === 0x49
  if (!little && bytes[tiff] !== 0x4d) return 1
  const u16 = (at: number): number => (little ? bytes[at]! | (bytes[at + 1]! << 8) : (bytes[at]! << 8) | bytes[at + 1]!)
  const u32 = (at: number): number => (little ? u16(at) + u16(at + 2) * 65536 : u16(at) * 65536 + u16(at + 2))
  const ifd = tiff + u32(tiff + 4)
  if (ifd + 2 > end) return 1
  const count = u16(ifd)
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > end) break
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8)

      return value >= 1 && value <= 8 ? value : 1
    }
  }

  return 1
}

/**
 * The frame header and EXIF orientation, read by walking the marker segments
 * to the first frame (nothing decoded, nothing allocated), or why there is
 * none to read.
 */
export const jpegHeaderOf = (bytes: Uint8Array): JpegHeader | string => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 'JPEG: no SOI marker'
  let at = 2
  let orientation = 1
  let hierarchical = false
  for (;;) {
    while (at < bytes.length && bytes[at] !== 0xff) at += 1
    while (at < bytes.length && bytes[at] === 0xff) at += 1
    if (at + 2 >= bytes.length) return 'JPEG: no frame header'
    const marker = bytes[at]!
    at += 1
    if (marker === 0xd9) return 'JPEG: no frame header'
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue
    const length = (bytes[at]! << 8) | bytes[at + 1]!
    const start = at + 2
    const end = min(at + length, bytes.length)
    at += max(2, length)
    if (marker === 0xe1 && orientation === 1) orientation = exifOrientationOf(bytes, start, end)
    else if (marker === 0xde) hierarchical = true
    else if (marker === 0xda) return 'JPEG: scan before the frame header'
    else if (isFrameMarker(marker)) {
      if (end - start < 6) return 'JPEG: short frame header'
      const precision = bytes[start]!
      const height = (bytes[start + 1]! << 8) | bytes[start + 2]!
      const width = (bytes[start + 3]! << 8) | bytes[start + 4]!
      const components = bytes[start + 5]!
      if (width === 0) return 'JPEG: no width'
      if (height === 0) return 'JPEG: no height (a DNL marker)'
      if (components === 0 || start + 6 + components * 3 > end) return 'JPEG: short frame header'
      for (let i = 0; i < components; i += 1) {
        const hv = bytes[start + 7 + i * 3]!
        if (hv >> 4 < 1 || hv >> 4 > 4 || (hv & 15) < 1 || (hv & 15) > 4) return 'JPEG: bad sampling factor'
      }
      const unsupported = unsupportedOf(marker, precision, components, hierarchical)
      const progressive = marker === 0xc2 || marker === 0xc6 || marker === 0xca || marker === 0xce

      return { width, height, orientation, progressive, ...(unsupported === undefined ? {} : { unsupported }) }
    }
  }
}

/** Where output row `oy` of an oriented picture reads the stored one (`w8` by `h8`): index `base + x * step`. */
const orientedRowOf = (orientation: number, oy: number, w8: number, h8: number): { base: number; step: number } => {
  switch (orientation) {
    case 2: return { base: oy * w8 + w8 - 1, step: -1 }
    case 3: return { base: (h8 - 1 - oy) * w8 + w8 - 1, step: -1 }
    case 4: return { base: (h8 - 1 - oy) * w8, step: 1 }
    case 5: return { base: oy, step: w8 }
    case 6: return { base: (h8 - 1) * w8 + oy, step: -w8 }
    case 7: return { base: (h8 - 1) * w8 + (w8 - 1 - oy), step: -w8 }
    case 8: return { base: w8 - 1 - oy, step: w8 }
    default: return { base: oy * w8, step: 1 }
  }
}

/**
 * The decoder of a JPEG whose header `jpegHeaderOf` read and the caller
 * checked against its caps; throws a `JPEG: …` Error for a header it cannot
 * read or a process it does not decode.
 */
export const createJpegDecoder = (bytes: Uint8Array, sink: RowSink): JpegDecoder => {
  const header = jpegHeaderOf(bytes)
  if (typeof header === 'string') throw new Error(header)
  if (header.unsupported !== undefined) throw new Error(`JPEG: ${header.unsupported}`)
  const b = bytes
  const w8 = ceil(header.width / 8)
  const h8 = ceil(header.height / 8)
  const orientation = header.orientation
  const outWidth = orientation >= 5 ? h8 : w8
  const outHeight = orientation >= 5 ? w8 : h8

  const progressive = header.progressive
  const reader: BitReader = { bytes: b, pos: 2, bitBuf: 0, bitCnt: 0, markerHit: false, padBits: 0, starved: false }
  const dcQuant: (number | undefined)[] = []
  const dcTables: (Huffman | undefined)[] = []
  const acTables: (Huffman | undefined)[] = []
  let comps: Component[] = []
  let hmax = 1
  let vmax = 1
  let mcusX = 0
  let mcusY = 0
  let restart = 0
  let adobeTransform = -1
  let sawJfif = false
  let frameSeen = false
  let blocksSeen = 0
  let phase: Phase = 'markers'
  // The scan in progress.
  let scan: Component[] = []
  let ah = 0
  let al = 0
  let mcu = 0
  let mcuTotal = 0
  // No more data for this scan: a marker other than RSTn stands where it is due.
  let scanOver = false
  // The rows on their way out.
  let row = 0
  let picture: Uint8Array | undefined

  // Read through a call, since each phase moves it on.
  const isDone = (): boolean => phase === 'done'

  // One block: its DC, or in a progressive DC refinement one more bit of it.
  const block = (c: Component, index: number): void => {
    if (reader.starved) return
    if (progressive && ah !== 0) {
      if (reader.bitCnt < 1) fill(reader)
      const bit = (reader.bitBuf >>> (reader.bitCnt - 1)) & 1
      reader.bitCnt -= 1
      if (reader.bitCnt < reader.padBits) reader.starved = true
      else if (bit !== 0) c.dc[index] = c.dc[index]! | (1 << al)

      return
    }
    const dc = dcTables[c.dcTable] ?? NO_HUFFMAN
    const diff = progressive ? dcDiffOf(reader, dc) : sequentialBlockOf(reader, dc, acTables[c.acTable] ?? NO_HUFFMAN)
    if (diff === NO_DC) {
      reader.starved = true

      return
    }
    c.pred += diff
    c.dc[index] = progressive ? c.pred * (1 << al) : c.pred
    if (c.seen[index] === 0) {
      c.seen[index] = 1
      blocksSeen += 1
    }
  }

  // At a restart interval's end: drop the bits held, find RSTn, start the predictions over.
  const restartMarker = (): void => {
    reader.bitBuf = 0
    reader.bitCnt = 0
    reader.padBits = 0
    reader.markerHit = false
    reader.starved = false
    for (let p = reader.pos; p + 1 < b.length; p += 1) {
      if (b[p] !== 0xff) continue
      const next = b[p + 1]!
      if (next >= 0xd0 && next <= 0xd7) {
        reader.pos = p + 2
        for (const c of scan) c.pred = 0

        return
      }
      if (next !== 0 && next !== 0xff) {
        reader.pos = p
        scanOver = true

        return
      }
    }
    reader.pos = b.length
    scanOver = true
  }

  // Moves past entropy-coded data to the next marker that is not RSTn.
  const skipEntropyData = (): void => {
    let p = reader.pos
    for (;;) {
      while (p < b.length && b[p] !== 0xff) p += 1
      if (p + 1 >= b.length) {
        p = b.length
        break
      }
      const next = b[p + 1]!
      if (next === 0 || (next >= 0xd0 && next <= 0xd7)) p += 2
      else if (next === 0xff) p += 1
      else break
    }
    reader.pos = p
  }

  const frame = (start: number, end: number): void => {
    if (frameSeen) throw new Error('JPEG: a second frame')
    const n = b[start + 5]!
    if (start + 6 + n * 3 > end) throw new Error('JPEG: short frame header')
    comps = []
    for (let i = 0; i < n; i += 1) {
      const at = start + 6 + i * 3
      const hv = b[at + 1]!
      comps.push({ id: b[at]!, h: hv >> 4, v: hv & 15, tq: b[at + 2]! & 3, bw: 0, bh: 0, bwData: 0, bhData: 0, dc: new Int32Array(0), seen: new Uint8Array(0), pred: 0, dcTable: 0, acTable: 0 })
    }
    hmax = max(...comps.map(c => c.h))
    vmax = max(...comps.map(c => c.v))
    mcusX = ceil(header.width / (8 * hmax))
    mcusY = ceil(header.height / (8 * vmax))
    for (const c of comps) {
      c.bw = mcusX * c.h
      c.bh = mcusY * c.v
      c.bwData = ceil(ceil((header.width * c.h) / hmax) / 8)
      c.bhData = ceil(ceil((header.height * c.v) / vmax) / 8)
      c.dc = new Int32Array(c.bw * c.bh)
      c.seen = new Uint8Array(c.bw * c.bh)
    }
    frameSeen = true
  }

  const huffmanTables = (start: number, end: number): void => {
    let p = start
    while (p + 17 <= end) {
      const tc = b[p]! >> 4
      const th = b[p]! & 3
      const counts = b.subarray(p + 1, p + 17)
      let total = 0
      for (let i = 0; i < 16; i += 1) total += counts[i]!
      if (p + 17 + total > end) throw new Error('JPEG: short Huffman table')
      const table = buildHuffman(counts, b.slice(p + 17, p + 17 + total))
      if (tc === 0) dcTables[th] = table
      else acTables[th] = table
      p += 17 + total
    }
  }

  // Only each table's DC quantiser matters here.
  const quantTables = (start: number, end: number): void => {
    let p = start
    while (p < end) {
      const wide = b[p]! >> 4 !== 0
      const tq = b[p]! & 3
      if (p + (wide ? 129 : 65) > end) throw new Error('JPEG: short quantisation table')
      dcQuant[tq] = wide ? (b[p + 1]! << 8) | b[p + 2]! : b[p + 1]!
      p += wide ? 129 : 65
    }
  }

  const startScan = (start: number, end: number): void => {
    if (!frameSeen) throw new Error('JPEG: scan before the frame header')
    const ns = b[start]!
    if (ns === 0 || start + 1 + ns * 2 + 3 > end) throw new Error('JPEG: short scan header')
    scan = []
    for (let i = 0; i < ns; i += 1) {
      const id = b[start + 1 + i * 2]!
      const tables = b[start + 2 + i * 2]!
      const c = comps.find(one => one.id === id)
      if (c === undefined) throw new Error('JPEG: a scan names an unknown component')
      c.dcTable = tables >> 4
      c.acTable = tables & 15
      c.pred = 0
      scan.push(c)
    }
    const at = start + 1 + ns * 2
    const ss = b[at]!
    ah = b[at + 2]! >> 4
    al = b[at + 2]! & 15
    mcu = 0
    mcuTotal = ns === 1 ? scan[0]!.bwData * scan[0]!.bhData : mcusX * mcusY
    reader.bitBuf = 0
    reader.bitCnt = 0
    reader.markerHit = false
    reader.padBits = 0
    reader.starved = false
    scanOver = false
    // A progressive AC scan changes no block's mean: skipped unread.
    if (progressive && ss > 0) skipEntropyData()
    else phase = 'scan'
  }

  // Reads marker segments until a scan to decode starts, the data ends or the deadline passes.
  const readMarkers = (deadline: number): void => {
    for (let segments = 1; phase === 'markers'; segments += 1) {
      if (segments % SEGMENTS_PER_CHECK === 0 && performance.now() >= deadline) return
      let at = reader.pos
      while (at < b.length && b[at] !== 0xff) at += 1
      while (at < b.length && b[at] === 0xff) at += 1
      reader.pos = at + 1
      if (at + 2 >= b.length) {
        phase = 'convert'

        return
      }
      const marker = b[at]!
      if (marker === 0xd9) {
        phase = 'convert'

        return
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue
      const length = (b[at + 1]! << 8) | b[at + 2]!
      const start = at + 3
      const end = min(at + 1 + length, b.length)
      reader.pos = at + 1 + max(2, length)
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) frame(start, end)
      else if (isFrameMarker(marker)) throw new Error('JPEG: a second frame')
      else if (marker === 0xc4) huffmanTables(start, end)
      else if (marker === 0xdb) quantTables(start, end)
      else if (marker === 0xdd) restart = end - start >= 2 ? (b[start]! << 8) | b[start + 1]! : 0
      else if (marker === 0xe0 && end - start >= 5 && b[start] === 0x4a && b[start + 1] === 0x46 && b[start + 2] === 0x49 && b[start + 3] === 0x46 && b[start + 4] === 0) sawJfif = true
      else if (marker === 0xee && end - start >= 12 && b[start] === 0x41 && b[start + 1] === 0x64 && b[start + 2] === 0x6f && b[start + 3] === 0x62 && b[start + 4] === 0x65) adobeTransform = b[start + 11]!
      else if (marker === 0xda) startScan(start, end)
    }
  }

  const decodeScan = (deadline: number): void => {
    const single = scan.length === 1
    const blocksPerMcu = single ? 1 : scan.reduce((sum, c) => sum + c.h * c.v, 0)
    const mcusPerCheck = max(1, floor(BLOCKS_PER_CHECK / blocksPerMcu))
    let sinceCheck = 0
    while (mcu < mcuTotal) {
      if (restart > 0 && mcu > 0 && mcu % restart === 0) {
        restartMarker()
        if (scanOver) break
      }
      if (single) {
        const c = scan[0]!
        const by = floor(mcu / c.bwData)
        block(c, by * c.bw + (mcu - by * c.bwData))
      } else {
        const my = floor(mcu / mcusX)
        const mx = mcu - my * mcusX
        for (const c of scan) {
          for (let v = 0; v < c.v; v += 1) {
            const base = (my * c.v + v) * c.bw + mx * c.h
            for (let h = 0; h < c.h; h += 1) block(c, base + h)
          }
        }
      }
      mcu += 1
      if (reader.starved) {
        // Data ran short or went bad: with no restart interval (or no data
        // left at all) the scan is over, else on to the next interval.
        if (restart === 0 || reader.pos >= b.length) break
        mcu = min(mcuTotal, ceil(mcu / restart) * restart)
      }
      sinceCheck += 1
      if (sinceCheck >= mcusPerCheck) {
        sinceCheck = 0
        if (performance.now() >= deadline) return
      }
    }
    phase = 'markers'
    skipEntropyData()
  }

  // The source row `y` of the 1/8-scale picture as RGBA into `dst` at `at`
  // (chroma replicated); a pixel some component's block never reached is
  // transparent, so a cut inside an MCU leaves no pixel of the wrong colour.
  let rgbRow: ((y: number, dst: Uint8Array, at: number) => void) | undefined

  const rowConverterOf = (): ((y: number, dst: Uint8Array, at: number) => void) => {
    if (!frameSeen) throw new Error('JPEG: no frame header')
    if (blocksSeen === 0) throw new Error('JPEG: no image data')
    const scales = comps.map(c => {
      const q = dcQuant[c.tq]
      if (q === undefined) throw new Error('JPEG: missing quantisation table')

      return q / 8
    })
    // Each component's block column for each output column.
    const columns = comps.map(c => {
      const map = new Int32Array(w8)
      for (let x = 0; x < w8; x += 1) map[x] = min(c.bw - 1, floor((x * c.h) / hmax))

      return map
    })
    const rowStart = (c: Component, y: number): number => min(c.bh - 1, floor((y * c.v) / vmax)) * c.bw
    const c0 = comps[0]!
    const m0 = columns[0]!
    const k0 = scales[0]!
    if (comps.length === 1) {
      return (y, dst, at) => {
        const r0 = rowStart(c0, y)
        for (let x = 0, d = at; x < w8; x += 1, d += 4) {
          const v = c0.dc[r0 + m0[x]!]! * k0 + 128.5
          const g = v < 0 ? 0 : v > 255 ? 255 : v
          dst[d] = g
          dst[d + 1] = g
          dst[d + 2] = g
          dst[d + 3] = c0.seen[r0 + m0[x]!] === 0 ? 0 : 255
        }
      }
    }
    // As libjpeg reads three components: a JFIF marker means YCbCr, an Adobe
    // marker says, else the ids 'R', 'G', 'B' mean RGB.
    const isRgb = !sawJfif && (adobeTransform >= 0 ? adobeTransform === 0 : comps[0]!.id === 0x52 && comps[1]!.id === 0x47 && comps[2]!.id === 0x42)
    const c1 = comps[1]!
    const c2 = comps[2]!
    const m1 = columns[1]!
    const m2 = columns[2]!
    const k1 = scales[1]!
    const k2 = scales[2]!

    return (y, dst, at) => {
      const r0 = rowStart(c0, y)
      const r1 = rowStart(c1, y)
      const r2 = rowStart(c2, y)
      for (let x = 0, d = at; x < w8; x += 1, d += 4) {
        const luma = c0.dc[r0 + m0[x]!]! * k0 + 128
        const cb = c1.dc[r1 + m1[x]!]! * k1
        const cr = c2.dc[r2 + m2[x]!]! * k2
        const r = isRgb ? luma : luma + 1.402 * cr
        const g = isRgb ? cb + 128 : luma - 0.344136 * cb - 0.714136 * cr
        const bl = isRgb ? cr + 128 : luma + 1.772 * cb
        dst[d] = r < 0 ? 0 : r > 255 ? 255 : r + 0.5
        dst[d + 1] = g < 0 ? 0 : g > 255 ? 255 : g + 0.5
        dst[d + 2] = bl < 0 ? 0 : bl > 255 ? 255 : bl + 0.5
        dst[d + 3] = c0.seen[r0 + m0[x]!] === 0 || c1.seen[r1 + m1[x]!] === 0 || c2.seen[r2 + m2[x]!] === 0 ? 0 : 255
      }
    }
  }

  // Block means to RGBA rows: straight to the sink when the picture stands
  // as stored, else into the whole small picture first.
  const convertRows = (deadline: number): void => {
    rgbRow ??= rowConverterOf()
    if (orientation === 1) {
      const line = new Uint8Array(w8 * 4)
      while (row < h8) {
        rgbRow(row, line, 0)
        sink.row(row, 0, 1, line, w8)
        row += 1
        if (row % ROWS_PER_CHECK === 0 && row < h8 && performance.now() >= deadline) return
      }
      phase = 'done'

      return
    }
    picture ??= new Uint8Array(w8 * h8 * 4)
    while (row < h8) {
      rgbRow(row, picture, row * w8 * 4)
      row += 1
      if (row % ROWS_PER_CHECK === 0 && row < h8 && performance.now() >= deadline) return
    }
    row = 0
    phase = 'emit'
  }

  // The small picture turned to its EXIF orientation, a row at a time.
  const emitRows = (deadline: number): void => {
    const source = new Uint32Array(picture!.buffer)
    const line = new Uint8Array(outWidth * 4)
    const line32 = new Uint32Array(line.buffer)
    while (row < outHeight) {
      const { base, step } = orientedRowOf(orientation, row, w8, h8)
      for (let x = 0, i = base; x < outWidth; x += 1, i += step) line32[x] = source[i]!
      sink.row(row, 0, 1, line, outWidth)
      row += 1
      if (row % ROWS_PER_CHECK === 0 && row < outHeight && performance.now() >= deadline) return
    }
    phase = 'done'
  }

  return {
    width: outWidth,
    height: outHeight,
    step: deadline => {
      while (!isDone()) {
        if (phase === 'markers') readMarkers(deadline)
        else if (phase === 'scan') decodeScan(deadline)
        else if (phase === 'convert') convertRows(deadline)
        else emitRows(deadline)
        if (!isDone() && performance.now() >= deadline) break
      }

      return isDone()
    },
  }
}
