import { decode } from './vendor-webp/mod.js'
import { BitReader } from './vendor-webp/src/bit_reader.js'
import { decodeImage } from './vendor-webp/src/vp8l/entropy.js'

// WebP: the RIFF container read for every kind (the canvas size; lossless,
// lossy or animated), and a lossless (VP8L) picture decoded by the vendored
// @nktkas/webp 1.0.0 (hooks/vendor-webp/: MIT, its LICENSE beside it, its
// published build kept byte for byte). Lossy VP8 has no decoder here (none
// in pure JavaScript is both right and fast), nor has an animation: the
// header says so and the strip draws no picture for them.
//
// The library decodes in one synchronous call, never in slices: the caller
// caps the size first (hooks/decode-drive.ts `WEBP_SIDE_CAP`), and before it
// runs the stream is read as far as its Huffman groups with the library's own
// parts, refusing what libwebp refuses or never writes (a transform used
// twice, a colour cache over 11 bits, more Huffman groups than its encoder
// makes) and groups whose codes would take long to build, since each of
// those could keep the call busy for a second or more.

const { ceil, max, min } = Math

/** What a WebP holds: a lossless picture this decoder draws, a lossy one, or an animation. */
export type WebpKind = 'lossless' | 'lossy' | 'animated'

/** A WebP's canvas and kind, from its RIFF header. */
export type WebpHeader = {
  width: number
  height: number
  kind: WebpKind
}

/** A decoded picture: straight RGBA, row-major. */
export type WebpPicture = { width: number; height: number; rgba: Uint8Array }

/** Huffman groups libwebp's encoder writes at most (its histogram image's limit). */
const MAX_GROUPS = 2600
/**
 * The groups times the symbols of each group's five codes: the library builds
 * every code before the first pixel, in its one call. 2600 groups with an
 * 11-bit cache (8 million) took a second and over 100 MB; this keeps it to
 * about 50 ms (95 groups with that cache, 275 with none).
 */
const MAX_GROUP_SYMBOLS = 300_000
/** Colour cache bits VP8L allows. */
const MAX_CACHE_BITS = 11

const fourccOf = (bytes: Uint8Array, at: number): string =>
  String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0)

const u32le = (bytes: Uint8Array, at: number): number =>
  (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0

/** A VP8L bitstream's own size, from its five header bytes at `at`, or undefined. */
const vp8lSizeOf = (bytes: Uint8Array, at: number): { width: number; height: number } | undefined => {
  if (at + 5 > bytes.length || bytes[at] !== 0x2f) return undefined
  const bits = u32le(bytes, at + 1)

  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
}

/** A VP8 key frame's size, from its frame header at `at`, or undefined. */
const vp8SizeOf = (bytes: Uint8Array, at: number): { width: number; height: number } | undefined => {
  if (at + 10 > bytes.length || (bytes[at]! & 1) !== 0) return undefined
  if (bytes[at + 3] !== 0x9d || bytes[at + 4] !== 0x01 || bytes[at + 5] !== 0x2a) return undefined
  const width = (bytes[at + 6]! | (bytes[at + 7]! << 8)) & 0x3fff
  const height = (bytes[at + 8]! | (bytes[at + 9]! << 8)) & 0x3fff

  return width === 0 || height === 0 ? undefined : { width, height }
}

/** The file is a RIFF WebP container. */
export const isWebpOf = (bytes: Uint8Array): boolean => bytes.length >= 12 && fourccOf(bytes, 0) === 'RIFF' && fourccOf(bytes, 8) === 'WEBP'

/**
 * The canvas size and kind, read from the container without decoding, or why
 * it cannot be read. A VP8X file is lossless only when its picture is one
 * VP8L chunk the canvas's size.
 */
export const webpHeaderOf = (bytes: Uint8Array): WebpHeader | string => {
  if (!isWebpOf(bytes) || bytes.length < 20) return 'WebP: no RIFF header'
  const first = fourccOf(bytes, 12)
  if (first === 'VP8L') {
    const size = vp8lSizeOf(bytes, 20)

    return size === undefined ? 'WebP: bad VP8L header' : { ...size, kind: 'lossless' }
  }
  if (first === 'VP8 ') {
    const size = vp8SizeOf(bytes, 20)

    return size === undefined ? 'WebP: bad VP8 header' : { ...size, kind: 'lossy' }
  }
  if (first !== 'VP8X') return `WebP: unknown first chunk ${JSON.stringify(first)}`
  if (bytes.length < 30) return 'WebP: short VP8X chunk'
  const flags = bytes[20]!
  const width = (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) + 1
  const height = (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) + 1
  if ((flags & 0x02) !== 0) return { width, height, kind: 'animated' }
  // The chunks after VP8X: the picture is the first VP8L or VP8 among them.
  let at = 20 + u32le(bytes, 16)
  at += at & 1
  while (at + 8 <= bytes.length) {
    const fourcc = fourccOf(bytes, at)
    const length = u32le(bytes, at + 4)
    if (fourcc === 'VP8 ') return { width, height, kind: 'lossy' }
    if (fourcc === 'VP8L') {
      const size = vp8lSizeOf(bytes, at + 8)
      if (size === undefined) return 'WebP: bad VP8L header'
      if (size.width !== width || size.height !== height) return 'WebP: the picture is not the canvas size'

      return { width, height, kind: 'lossless' }
    }
    if (fourcc === 'ANMF') return { width, height, kind: 'animated' }
    at += 8 + length + (length & 1)
  }

  return 'WebP: no picture chunk'
}

/** The VP8L chunk's payload: the first top-level one, as the library finds it. */
const vp8lPayloadOf = (bytes: Uint8Array): Uint8Array | undefined => {
  let at = 12
  while (at + 8 <= bytes.length) {
    const length = u32le(bytes, at + 4)
    if (fourccOf(bytes, at) === 'VP8L') return bytes.subarray(at + 8, min(at + 8 + length, bytes.length))
    at += 8 + length + (length & 1)
  }

  return undefined
}

/**
 * Why the library is not to be run on this VP8L stream, or undefined: the
 * header, the transforms and the main image's group map read with its own
 * bit reader and sub-image decoder, exactly as it will read them.
 */
const vp8lFaultOf = (payload: Uint8Array): string | undefined => {
  const reader = new BitReader(payload)
  if (reader.read(8) !== 0x2f) return 'bad VP8L signature'
  let width = reader.read(14) + 1
  const height = reader.read(14) + 1
  reader.read(1)
  if (reader.read(3) !== 0) return 'unknown VP8L version'
  const seen = new Set<number>()
  while (reader.read(1) === 1) {
    const type = reader.read(2)
    if (seen.has(type)) return 'a transform used twice'
    seen.add(type)
    if (type === 0 || type === 1) {
      const bits = reader.read(3) + 2
      decodeImage(reader, ceil(width / (1 << bits)), ceil(height / (1 << bits)), false)
    } else if (type === 3) {
      const colours = reader.read(8) + 1
      decodeImage(reader, colours, 1, false)
      const packing = colours <= 2 ? 3 : colours <= 4 ? 2 : colours <= 16 ? 1 : 0
      width = ceil(width / (1 << packing))
    }
  }
  let cacheBits = 0
  if (reader.read(1) === 1) {
    cacheBits = reader.read(4)
    if (cacheBits < 1 || cacheBits > MAX_CACHE_BITS) return `a ${cacheBits}-bit colour cache`
  }
  if (reader.read(1) === 0) return undefined
  const bits = reader.read(3) + 2
  const blocks = decodeImage(reader, ceil(width / (1 << bits)), ceil(height / (1 << bits)), false)
  let groups = 0
  for (const pixel of blocks) groups = max(groups, ((pixel >>> 8) & 0xffff) + 1)
  if (groups > MAX_GROUPS || groups > blocks.length) return `${groups} Huffman groups`
  // Green, red, blue, alpha and distance: green has the length codes and the cache's entries too.
  const symbols = 256 + 24 + (cacheBits === 0 ? 0 : 1 << cacheBits) + 3 * 256 + 40

  return groups * symbols > MAX_GROUP_SYMBOLS ? `${groups} Huffman groups of ${symbols} symbols` : undefined
}

/**
 * A lossless WebP decoded whole, in one synchronous call, after the caller's
 * caps: straight RGBA, or a `WebP: …` Error for anything the stream holds
 * wrong (the library's own errors carried in its message).
 */
export const decodeWebp = (bytes: Uint8Array): WebpPicture => {
  const payload = vp8lPayloadOf(bytes)
  if (payload === undefined) throw new Error('WebP: no VP8L chunk')
  try {
    const fault = vp8lFaultOf(payload)
    if (fault !== undefined) throw new Error(fault)
    const { width, height, data } = decode(bytes)

    return { width, height, rgba: data }
  } catch (error) {
    throw new Error(`WebP: ${error instanceof Error ? error.message : String(error)}`)
  }
}
