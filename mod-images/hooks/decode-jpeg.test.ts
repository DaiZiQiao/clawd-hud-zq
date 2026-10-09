import { describe, expect, test } from 'claude-code/testing'

import { digestOf, fixtureBytesOf, fullSinkOf } from './decode-drive.fixtures'
import { createJpegDecoder, jpegHeaderOf } from './decode-jpeg'
import type { JpegDecoder } from './decode-jpeg'
import { CMYK_JPEG, JPEGS, ORIENTED } from './decode-jpeg.fixtures'

// The DC-only JPEG decoder: each variant (baseline, progressive, 4:2:0,
// 4:2:2, 4:4:4, greyscale, RGB, restart intervals, partial MCUs) against
// libjpeg's own 1/8 decode within the tolerance measured for it, and to the
// digest of its checked output; EXIF orientations 1 to 8; the processes it
// names and refuses; and data cut short or corrupt.

type Decoded = { decoder: JpegDecoder; data: Uint8Array; steps: number }

/** The whole 1/8-scale picture; each step's deadline long past. */
const decodedOf = (bytes: Uint8Array): Decoded => {
  const size = createJpegDecoder(bytes, { row: () => {} })
  const sink = fullSinkOf(size.width, size.height)
  const decoder = createJpegDecoder(bytes, sink)
  let steps = 1
  while (!decoder.step(0)) steps += 1

  return { decoder, data: sink.data, steps }
}

/** Mean and largest channel difference, and the largest difference of luma computed from RGB. */
const closenessOf = (reference: Uint8Array, data: Uint8Array): { mean: number; max: number; luma: number } => {
  let sum = 0
  let max = 0
  let luma = 0
  for (let i = 0; i < reference.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const d = Math.abs(reference[i + c]! - data[i + c]!)
      sum += d
      max = Math.max(max, d)
    }
    const yr = 0.299 * reference[i]! + 0.587 * reference[i + 1]! + 0.114 * reference[i + 2]!
    const yd = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
    luma = Math.max(luma, Math.abs(yr - yd))
  }

  return { mean: sum / (reference.length * 0.75), max, luma }
}

const isOpaque = (data: Uint8Array): boolean => data.every((byte, at) => at % 4 !== 3 || byte === 255)

/** The JPEG with the byte after its first `marker` (0xFFxx) replaced: `offset` 0 is the marker's own second byte. */
const patched = (bytes: Uint8Array, marker: number, offset: number, value: number): Uint8Array => {
  const copy = bytes.slice()
  const at = copy.findIndex((byte, i) => byte === 0xff && copy[i + 1] === marker)
  copy[at + 1 + offset] = value

  return copy
}

/** Where the stored picture's pixel shown at (x, y) is, for EXIF orientation `o` of a `w` by `h` picture. */
const storedPixelOf = (o: number, x: number, y: number, w: number, h: number): [number, number] => {
  switch (o) {
    case 2: return [w - 1 - x, y]
    case 3: return [w - 1 - x, h - 1 - y]
    case 4: return [x, h - 1 - y]
    case 5: return [y, x]
    case 6: return [y, h - 1 - x]
    case 7: return [w - 1 - y, h - 1 - x]
    case 8: return [w - 1 - y, x]
    default: return [x, y]
  }
}

describe('variants', () => {
  test('each comes within its measured tolerance of libjpeg\'s 1/8 decode, opaque, and to its digest', async () => {
    for (const [name, fixture] of Object.entries(JPEGS)) {
      const { data } = decodedOf(fixtureBytesOf(fixture.file))
      const reference = fixtureBytesOf(fixture.reference)
      expect(data.length, name).toBe(reference.length)
      const closeness = closenessOf(reference, data)
      expect(closeness.mean, name).toBeLessThanOrEqual(fixture.tolerance.mean)
      expect(closeness.max, name).toBeLessThanOrEqual(fixture.tolerance.max)
      expect(closeness.luma, name).toBeLessThanOrEqual(fixture.tolerance.luma)
      expect(isOpaque(data), name).toBe(true)
      expect(await digestOf(data), name).toBe(fixture.digest)
    }
  })

  test('greyscale and RGB match libjpeg exactly, 4:4:4 and 4:2:2 within two levels', () => {
    for (const name of ['grey', 'greyProgressive', 'rgb', 's444', 's422']) {
      const fixture = JPEGS[name]!
      const closeness = closenessOf(fixtureBytesOf(fixture.reference), decodedOf(fixtureBytesOf(fixture.file)).data)
      expect(closeness.max, name).toBeLessThanOrEqual(name === 's444' || name === 's422' ? 2 : 0)
    }
  })

  test('progressive files and restart intervals give the baseline picture exactly', () => {
    const digests = ['baseline', 'progressive', 'restart', 'restartProgressive'].map(name => JPEGS[name]!.digest)
    expect(new Set(digests).size).toBe(1)
    expect(JPEGS.grey!.digest).toBe(JPEGS.greyProgressive!.digest)
    expect(jpegHeaderOf(fixtureBytesOf(JPEGS.restartProgressive!.file))).toEqual({ width: 256, height: 192, orientation: 1, components: 3, progressive: true })
  })

  test('partial MCUs on the right and at the bottom: 203 by 141 is 26 by 18 at 1/8', () => {
    const { decoder } = decodedOf(fixtureBytesOf(JPEGS.odd!.file))
    expect([decoder.width, decoder.height]).toEqual([26, 18])
  })
})

describe('EXIF orientation', () => {
  test('orientations 1 to 8 turn the picture as exif_transpose does, each exactly the stored picture turned', async () => {
    const upright = decodedOf(fixtureBytesOf(ORIENTED[0]!.file))
    const [w, h] = [upright.decoder.width, upright.decoder.height]
    expect([w, h]).toEqual([16, 10])
    for (const [index, fixture] of ORIENTED.entries()) {
      const o = index + 1
      const { decoder, data } = decodedOf(fixtureBytesOf(fixture.file))
      expect(decoder.header.orientation, `${o}`).toBe(o)
      expect([decoder.width, decoder.height], `${o}`).toEqual(o >= 5 ? [h, w] : [w, h])
      expect(closenessOf(fixtureBytesOf(fixture.reference), data).luma, `${o}`).toBeLessThanOrEqual(fixture.tolerance.luma)
      for (let y = 0; y < decoder.height; y += 1) {
        for (let x = 0; x < decoder.width; x += 1) {
          const [sx, sy] = storedPixelOf(o, x, y, w, h)
          const shown = (y * decoder.width + x) * 4
          const stored = (sy * w + sx) * 4
          expect([...data.subarray(shown, shown + 4)], `${o} at ${x},${y}`).toEqual([...upright.data.subarray(stored, stored + 4)])
        }
      }
      expect(await digestOf(data), `${o}`).toBe(fixture.digest)
    }
  })
})

describe('what it does not decode', () => {
  test('arithmetic coding, lossless, hierarchical, 12-bit and CMYK are named, and refused', () => {
    const baseline = fixtureBytesOf(JPEGS.baseline!.file)
    for (const [bytes, why] of [
      [patched(baseline, 0xc0, 0, 0xc9), 'arithmetic coding'],
      [patched(baseline, 0xc0, 0, 0xc3), 'lossless JPEG'],
      [patched(baseline, 0xc0, 0, 0xc5), 'hierarchical JPEG'],
      [patched(baseline, 0xc0, 3, 12), '12-bit samples'],
      [fixtureBytesOf(CMYK_JPEG), 'four components (CMYK or YCCK)'],
    ] as const) {
      const header = jpegHeaderOf(bytes)
      expect(typeof header === 'string' ? header : header.unsupported, why).toBe(why)
      expect(() => createJpegDecoder(bytes, { row: () => {} }), why).toThrow(`JPEG: ${why}`)
    }
  })

  test('a header that cannot be read says why', () => {
    const baseline = fixtureBytesOf(JPEGS.baseline!.file)
    expect(jpegHeaderOf(baseline.subarray(2))).toBe('JPEG: no SOI marker')
    expect(jpegHeaderOf(baseline.subarray(0, 100))).toBe('JPEG: no frame header')
    expect(jpegHeaderOf(patched(patched(baseline, 0xc0, 4, 0), 0xc0, 5, 0))).toBe('JPEG: no height (a DNL marker)')
    expect(jpegHeaderOf(patched(baseline, 0xc0, 10, 0x50))).toBe('JPEG: bad sampling factor')
  })
})

describe('data cut short or corrupt', () => {
  test('a baseline JPEG cut short keeps the blocks before the cut, the rest transparent', () => {
    const bytes = fixtureBytesOf(JPEGS.baseline!.file)
    const whole = decodedOf(bytes).data
    const cut = decodedOf(bytes.subarray(0, Math.floor(bytes.length * 0.55))).data
    let opaque = 0
    for (let i = 0; i < cut.length; i += 4) {
      if (cut[i + 3] === 0) continue
      opaque += 1
      expect([...cut.subarray(i, i + 4)], `${i / 4}`).toEqual([...whole.subarray(i, i + 4)])
    }
    expect(opaque).toBeGreaterThan(100)
    expect(opaque).toBeLessThan(32 * 24 - 100)
    expect(cut.subarray(cut.length - 4)[3]).toBe(0)
  })

  test('a progressive JPEG cut after its first DC scan still shows the whole picture, a bit coarser', () => {
    const bytes = fixtureBytesOf(JPEGS.progressive!.file)
    const whole = decodedOf(bytes).data
    // The second scan's SOS: the first ends there.
    const scans = [...bytes.keys()].filter(i => bytes[i] === 0xff && bytes[i + 1] === 0xda)
    const cut = decodedOf(bytes.subarray(0, scans[1]!)).data
    expect(isOpaque(cut)).toBe(true)
    expect(closenessOf(whole, cut).max).toBeLessThanOrEqual(8)
  })

  test('a restart interval whose data is destroyed costs only its own blocks', () => {
    const bytes = fixtureBytesOf(JPEGS.restart!.file)
    const whole = decodedOf(bytes).data
    const dri = bytes.findIndex((byte, i) => byte === 0xff && bytes[i + 1] === 0xdd)
    const interval = (bytes[dri + 4]! << 8) | bytes[dri + 5]!
    expect(interval).toBe(7)
    const restarts = [...bytes.keys()].filter(i => bytes[i] === 0xff && bytes[i + 1]! >= 0xd0 && bytes[i + 1]! <= 0xd7)
    const k = Math.floor(restarts.length / 2)
    const corrupt = bytes.slice()
    corrupt.fill(0, restarts[k - 1]! + 2, restarts[k]!)
    const data = decodedOf(corrupt).data
    let differing = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] !== whole[i] || data[i + 1] !== whole[i + 1] || data[i + 2] !== whole[i + 2] || data[i + 3] !== whole[i + 3]) differing += 1
    // An interval's MCUs of 4:2:0 are two by two pixels each at 1/8: the next interval starts clean.
    expect(differing).toBeGreaterThan(0)
    expect(differing).toBeLessThanOrEqual(interval * 4)
  })

  test('a JPEG whose scan data never comes is an error', () => {
    const bytes = fixtureBytesOf(JPEGS.baseline!.file)
    const scan = bytes.findIndex((byte, i) => byte === 0xff && bytes[i + 1] === 0xda)
    expect(() => decodedOf(bytes.subarray(0, scan))).toThrow('JPEG: no image data')
  })
})
