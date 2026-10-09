import { createGifDecoder, gifHeaderOf } from './decode-gif'
import { createJpegDecoder, jpegHeaderOf } from './decode-jpeg'
import { createPngDecoder, isPngOf, pngHeaderOf } from './decode-png'
import { decodeWebp, isWebpOf, webpHeaderOf } from './decode-webp'
import type { ImageFormat, Master, RowSink } from './image-types'
import { createMasterBinner, masterSizeOf } from './thumb-master'
import type { MasterBinner } from './thumb-master'

// The decoders' front: what a file is (from its first bytes), its size before
// anything is decoded, the caps checked against that header before anything
// is allocated, and a job that decodes the file into a master
// (hooks/thumb-master.ts) a slice at a time; and the driver that runs such a
// job in slices. Pure: the hooks module reads the file (at most `READ_CAP`
// bytes), hands in the bytes and a pause closure that spells one `$` call,
// and keeps the masters.
//
// One hooks worker serves every plugin and is replaced when it misses a
// heartbeat for 5 s, and a timer callback has no hook budget of its own: so
// every decoder works to a deadline, `runSliced` yields between slices and
// gives up past its own CPU cap, and the caps keep memory flat (PNG, JPEG and
// GIF to `PIXEL_CAP`). Lossless WebP is the exception: the vendored library
// decodes it in one call that cannot yield, so `WEBP_PIXEL_CAP` keeps that
// call short.

/** The master's long side, in pixels. */
export const MASTER_SIDE = 256
/** The most `$.fs.read` hands back: a larger file is never read (the caller's cap). */
export const READ_CAP = 4 * 1024 * 1024
/** PNG, JPEG and GIF: the most pixels (width times height) decoded. */
export const PIXEL_CAP = 36_000_000
/** Lossless WebP, decoded whole in one call: the longest side decoded. */
export const WEBP_SIDE_CAP = 2048
/**
 * Lossless WebP: the most pixels decoded. The library's one call blocks the
 * worker every plugin shares, for about 75 to 130 ms a megapixel measured in
 * the hooks environment (0.2 to 0.5 s for 2000x1333, up to 1.5 s for
 * 2048x2048): this keeps it to a few tenths of a second (1280x854 fits).
 */
export const WEBP_PIXEL_CAP = 1_100_000
/** Every format: the longest side decoded, JPEG's and GIF's own limit (a PNG row's buffers grow with its width). */
export const SIDE_CAP = 65_535

/** `runSliced`'s defaults: a slice, the CPU summed over slices, and the slices. */
const SLICE_MS = 8
const CPU_CAP_MS = 3000
const SLICES_MAX = 400

/** A picture's header: what it is and its size, before anything is decoded. */
export type ImageHeader = {
  format: ImageFormat
  /** The size as displayed: EXIF orientation applied for JPEG. */
  width: number
  height: number
  /** False for what no decoder here draws: lossy and animated WebP, and JPEG beyond baseline, extended and progressive Huffman 8-bit grey, YCbCr or RGB. */
  decodable: boolean
}

/** Why a file has no master: `no preview` (a kind no decoder here draws), `too big` (over a cap), `can't read` (not a picture, or its header is bad). */
export type DecodeFailure = 'no preview' | 'too big' | "can't read"

/** No job, and why: `detail` names the format and the reason (`PNG: bad IHDR`), for /mod-images. */
export type MasterFailure = { failure: DecodeFailure; detail: string }

/**
 * A master being decoded: `step` decodes until `deadline` (a
 * `performance.now()` time) and is true once the whole picture is in; it
 * throws a plain `Error` (`PNG: …`, `JPEG: …`, `GIF: …`, `WebP: …`) on data it
 * cannot use at all, and again on every later call. Data cut short is not an
 * error: the job finishes with what decoded.
 */
export type MasterJob = {
  header: ImageHeader
  /** Decodes until `deadline` (performance.now() ms); true once the whole picture is in. Throws on corrupt data. */
  step: (deadline: number) => boolean
  /** The master so far: what decoded, the rest transparent. */
  master: () => Master
}

/** How `runSliced` slices: each slice's length, the caps on the CPU summed and on the slices, the clock, and an abort. */
export type SliceOptions = {
  /** A slice's length: `step` gets a deadline this far ahead. Default 8. */
  sliceMs?: number
  /** The step time summed over slices after which the job is `too slow`. Default 3000. */
  cpuCapMs?: number
  /** The slices after which the job is `too slow`. Default 400. */
  maxSlices?: number
  /** The clock the deadlines are read from: the one `step` compares them with. Default `performance.now`. */
  now?: () => number
  /** Asked before each slice: true stops the job, `aborted`. */
  isAborted?: () => boolean
}

/** A header read, and why it has no decoder here when it has none. */
type Probe = { header: ImageHeader; refusal?: string }

/** The format, from the file's first bytes: the PNG signature, SOI then a marker, GIF87a or GIF89a, a RIFF WebP. */
export const sniffFormatOf = (bytes: Uint8Array): ImageFormat | undefined => {
  if (isPngOf(bytes)) return 'png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  const gif = bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
  if (gif && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'gif'
  if (isWebpOf(bytes)) return 'webp'

  return undefined
}

/** The header, and a refusal when no decoder here draws the picture; or why there is no header to read. */
const probeOf = (bytes: Uint8Array): Probe | string => {
  const format = sniffFormatOf(bytes)
  if (format === undefined) return 'not a PNG, JPEG, GIF or WebP file'
  if (format === 'png') {
    const png = pngHeaderOf(bytes)

    return typeof png === 'string' ? png : { header: { format, width: png.width, height: png.height, decodable: true } }
  }
  if (format === 'jpeg') {
    const jpeg = jpegHeaderOf(bytes)
    if (typeof jpeg === 'string') return jpeg
    const swap = jpeg.orientation >= 5
    const header = { format, width: swap ? jpeg.height : jpeg.width, height: swap ? jpeg.width : jpeg.height, decodable: jpeg.unsupported === undefined }

    return jpeg.unsupported === undefined ? { header } : { header, refusal: `JPEG: ${jpeg.unsupported}` }
  }
  if (format === 'gif') {
    const gif = gifHeaderOf(bytes)

    return typeof gif === 'string' ? gif : { header: { format, width: gif.width, height: gif.height, decodable: true } }
  }
  const webp = webpHeaderOf(bytes)
  if (typeof webp === 'string') return webp
  const header = { format, width: webp.width, height: webp.height, decodable: webp.kind === 'lossless' }
  if (webp.kind === 'lossy') return { header, refusal: 'WebP: lossy (VP8) has no decoder here' }
  if (webp.kind === 'animated') return { header, refusal: 'WebP: an animation has no decoder here' }

  return { header }
}

/** The header read without decoding (EXIF orientation applied), or undefined when the file is not a picture or its header is bad. */
export const imageHeaderOf = (bytes: Uint8Array): ImageHeader | undefined => {
  const probe = probeOf(bytes)

  return typeof probe === 'string' ? undefined : probe.header
}

const FORMAT_NAMES: Readonly<Record<ImageFormat, string>> = { png: 'PNG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP' }

/** Why a picture of this header is over a cap, or undefined. */
const capFaultOf = (header: ImageHeader): string | undefined => {
  const { format, width, height } = header
  const name = FORMAT_NAMES[format]
  if (format === 'webp') {
    if (width > WEBP_SIDE_CAP || height > WEBP_SIDE_CAP) return `${name}: ${width}x${height} is over ${WEBP_SIDE_CAP} pixels a side`

    return width * height > WEBP_PIXEL_CAP ? `${name}: ${width}x${height} is over ${WEBP_PIXEL_CAP} pixels` : undefined
  }
  if (width > SIDE_CAP || height > SIDE_CAP) return `${name}: ${width}x${height} is over ${SIDE_CAP} pixels a side`
  if (width * height > PIXEL_CAP) return `${name}: ${width}x${height} is over ${PIXEL_CAP} pixels`

  return undefined
}

/** A job over a decoder's `step` and the binner its rows go to; an error thrown once is thrown again. */
const jobOf = (header: ImageHeader, step: (deadline: number) => boolean, binner: MasterBinner): MasterJob => {
  let done = false
  let thrown: unknown
  let failed = false

  return {
    header,
    step: deadline => {
      if (failed) throw thrown
      if (done) return true
      try {
        done = step(deadline)
      } catch (error) {
        failed = true
        thrown = error
        throw error
      }

      return done
    },
    master: () => binner.master(),
  }
}

/**
 * A sink whose rows go wherever `forward` points by the time they come: a
 * decoder takes its sink when made, and the binner is made from what the
 * decoder read.
 */
const relayOf = (): { sink: RowSink; forward: (to: RowSink) => void } => {
  let target: RowSink | undefined

  return {
    sink: { row: (y, x0, dx, rgba, n) => target?.row(y, x0, dx, rgba, n) },
    forward: to => {
      target = to
    },
  }
}

// The lossless WebP job: the library's one call in the first step, then the
// rows binned to the deadline.
const webpJobOf = (bytes: Uint8Array, header: ImageHeader, maxSide: number): MasterJob => {
  const size = masterSizeOf(header.width, header.height, maxSide)
  const binner = createMasterBinner(header.width, header.height, size.width, size.height, true)
  let picture: Uint8Array | undefined
  let y = 0

  return jobOf(header, deadline => {
    if (picture === undefined) {
      const decoded = decodeWebp(bytes)
      if (decoded.width !== header.width || decoded.height !== header.height) throw new Error('WebP: the picture is not the size its header says')
      picture = decoded.rgba
    }
    const rowBytes = header.width * 4
    while (y < header.height) {
      binner.row(y, 0, 1, picture.subarray(y * rowBytes, (y + 1) * rowBytes), header.width)
      y += 1
      if (y % 16 === 0 && y < header.height && performance.now() >= deadline) return false
    }
    picture = new Uint8Array(0)

    return true
  }, binner)
}

const startedJobOf = (bytes: Uint8Array, header: ImageHeader, maxSide: number): MasterJob => {
  if (header.format === 'webp') return webpJobOf(bytes, header, maxSide)
  const relay = relayOf()
  if (header.format === 'png') {
    const png = createPngDecoder(bytes, relay.sink)
    const size = masterSizeOf(header.width, header.height, maxSide)
    const binner = createMasterBinner(header.width, header.height, size.width, size.height, png.mayHaveAlpha)
    relay.forward(binner)

    return jobOf(header, png.step, binner)
  }
  if (header.format === 'jpeg') {
    // The DC-only decoder gives an eighth of each side: the master is never larger than that.
    const jpeg = createJpegDecoder(bytes, relay.sink)
    const size = masterSizeOf(jpeg.width, jpeg.height, maxSide)
    const binner = createMasterBinner(jpeg.width, jpeg.height, size.width, size.height, true)
    relay.forward(binner)

    return jobOf(header, jpeg.step, binner)
  }
  const gif = createGifDecoder(bytes, relay.sink)
  const size = masterSizeOf(header.width, header.height, maxSide)
  const binner = createMasterBinner(header.width, header.height, size.width, size.height, true)
  relay.forward(binner)

  return jobOf(header, gif.step, binner)
}

/**
 * A job decoding the file into a master of at most `maxSide` pixels a side
 * (never larger than the picture, nor, for JPEG, than an eighth of it), in
 * display orientation, straight alpha: or why there is none. The header is
 * checked against the caps and the decoders' support before anything is
 * allocated.
 */
export const startMaster = (bytes: Uint8Array, maxSide?: number): MasterJob | MasterFailure => {
  const probe = probeOf(bytes)
  if (typeof probe === 'string') return { failure: "can't read", detail: probe }
  if (probe.refusal !== undefined) return { failure: 'no preview', detail: probe.refusal }
  const cap = capFaultOf(probe.header)
  if (cap !== undefined) return { failure: 'too big', detail: cap }
  const side = maxSide !== undefined && Number.isFinite(maxSide) ? Math.max(1, Math.floor(maxSide)) : MASTER_SIDE
  try {
    return startedJobOf(bytes, probe.header, side)
  } catch (error) {
    return { failure: "can't read", detail: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Runs `step` in slices, awaiting `pause()` between them (the hooks module
 * passes `() => $.clock.now()`): `done` once a step says so, `aborted` when
 * `isAborted` says so before a slice, `too slow` past the CPU cap or the
 * slice cap. A step that throws rejects it with that error.
 */
export const runSliced = async (step: (deadline: number) => boolean, pause: () => Promise<unknown>, options: SliceOptions = {}): Promise<'done' | 'aborted' | 'too slow'> => {
  const sliceMs = options.sliceMs ?? SLICE_MS
  const cpuCapMs = options.cpuCapMs ?? CPU_CAP_MS
  const maxSlices = options.maxSlices ?? SLICES_MAX
  const now = options.now ?? (() => performance.now())
  let spentMs = 0
  let slices = 0
  for (;;) {
    if (options.isAborted?.() === true) return 'aborted'
    const start = now()
    const done = step(start + sliceMs)
    spentMs += now() - start
    slices += 1
    if (done) return 'done'
    if (spentMs >= cpuCapMs || slices >= maxSlices) return 'too slow'
    await pause()
  }
}
