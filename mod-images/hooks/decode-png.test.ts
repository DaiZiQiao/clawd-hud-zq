import { describe, expect, test } from 'claude-code/testing'

import { digestOf, fixtureBytesOf, fullSinkOf, lcgBytesOf, storedPngOf } from './decode-drive.fixtures'
import { createPngDecoder, pngHeaderOf } from './decode-png'
import type { PngHeader } from './decode-png'
import {
  PNGSUITE,
  PNGSUITE_CORRUPT,
  PNGSUITE_DIGESTS,
  SHOT_ADAM7_PNG,
  SHOT_ADAM7_PNG_DIGEST,
  SHOT_PNG,
  SHOT_PNG_DIGEST,
} from './decode-png.fixtures'

// PNG decoding: every PngSuite file (each sound one to the digest of its
// checked RGBA, a chunk of image data per step; each corrupt one failing
// cleanly), image data past one inflate chunk both plain and Adam7, a large
// PNG built here from stored blocks across many slices, and pictures cut
// short or corrupt after some rows.

type Decoded = { header: PngHeader; data: Uint8Array; steps: number; rows: number; truncated: string | undefined }

/** The whole picture; each step's deadline long past, so each decodes one chunk of image data. */
const decodedOf = (bytes: Uint8Array): Decoded => {
  const header = pngHeaderOf(bytes)
  if (typeof header === 'string') throw new Error(header)
  const sink = fullSinkOf(header.width, header.height)
  const decoder = createPngDecoder(bytes, sink)
  let steps = 1
  while (!decoder.step(0)) steps += 1

  return { header, data: sink.data, steps, rows: sink.rows, truncated: decoder.truncated() }
}

// A 1200 by 900 RGB picture of seeded noise, every row filter 0.
const WIDE = 1200
const TALL = 900

const largeRawOf = (): Uint8Array => {
  const noise = lcgBytesOf(9, WIDE * 3 * 7)
  const raw = new Uint8Array(TALL * (1 + WIDE * 3))
  for (let y = 0; y < TALL; y += 1) raw.set(noise.subarray((y % 7) * WIDE * 3, (y % 7 + 1) * WIDE * 3), y * (1 + WIDE * 3) + 1)

  return raw
}

const rgbaOfRaw = (raw: Uint8Array, rows: number): Uint8Array => {
  const rgba = new Uint8Array(WIDE * TALL * 4)
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < WIDE; x += 1) {
      const s = y * (1 + WIDE * 3) + 1 + x * 3
      rgba.set([raw[s]!, raw[s + 1]!, raw[s + 2]!, 255], (y * WIDE + x) * 4)
    }
  }

  return rgba
}

describe('PngSuite', () => {
  test('every sound file decodes to the digest of its checked RGBA, a chunk of image data a step', { timeoutMs: 30_000 }, async () => {
    const names = Object.keys(PNGSUITE_DIGESTS)
    expect(names.length).toBe(160)
    for (const name of names) {
      const { data } = decodedOf(fixtureBytesOf(PNGSUITE[name]!))
      expect(await digestOf(data), name).toBe(PNGSUITE_DIGESTS[name])
    }
  })

  test('the corrupt files fail cleanly: a bad signature or IHDR refused, no IDAT an error, a bad CRC not looked at', () => {
    const names = Object.keys(PNGSUITE_CORRUPT)
    expect(names.length).toBe(14)
    for (const name of names) {
      const bytes = fixtureBytesOf(PNGSUITE[name]!)
      const outcome = typeof pngHeaderOf(bytes) === 'string' ? 'header' : (() => {
        try {
          decodedOf(bytes)

          return 'decodes'
        } catch (error) {
          expect(error, name).toBeInstanceOf(Error)
          expect((error as Error).message, name).toMatch(/^PNG: /)

          return 'error'
        }
      })()
      expect(outcome, name).toBe(PNGSUITE_CORRUPT[name])
    }
  })

  test('a grey colour key is matched against the raw sample: tbbn0g04 has 464 see-through pixels', () => {
    const { data } = decodedOf(fixtureBytesOf(PNGSUITE.tbbn0g04!))
    let clear = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] === 0) clear += 1
    expect(clear).toBe(464)
  })

  test('the header reads every colour type and depth, and refuses what the specification does not allow', () => {
    expect(pngHeaderOf(fixtureBytesOf(PNGSUITE.basi6a16!))).toEqual({ width: 32, height: 32, bitDepth: 16, colourType: 6, interlaced: true })
    expect(pngHeaderOf(fixtureBytesOf(PNGSUITE.s01n3p01!))).toEqual({ width: 1, height: 1, bitDepth: 1, colourType: 3, interlaced: false })
    expect(pngHeaderOf(fixtureBytesOf(PNGSUITE.xd3n2c08!))).toBe('PNG: bad colour type 2 at depth 3')
    expect(pngHeaderOf(fixtureBytesOf(PNGSUITE.xs1n0g01!))).toBe('PNG: no signature')
    expect(pngHeaderOf(fixtureBytesOf(PNGSUITE.basn0g01!).subarray(0, 30))).toBe('PNG: bad IHDR')
  })
})

describe('image data past one chunk', () => {
  test('a screenshot inflating to six chunks decodes as PIL decodes it, plain and Adam7 with every filter', async () => {
    const plain = decodedOf(fixtureBytesOf(SHOT_PNG))
    expect(plain.header).toEqual({ width: 400, height: 300, bitDepth: 8, colourType: 2, interlaced: false })
    expect(plain.steps).toBe(6)
    expect(await digestOf(plain.data)).toBe(SHOT_PNG_DIGEST)
    const adam7 = decodedOf(fixtureBytesOf(SHOT_ADAM7_PNG))
    expect(adam7.header.interlaced).toBe(true)
    // Each pass's rows: from y0, every dy (Adam7's seven), here 38 + 38 + 37 + 75 + 75 + 150 + 150.
    const passRows = [[0, 8], [0, 8], [4, 8], [0, 4], [2, 4], [0, 2], [1, 2]].map(([y0, dy]) => Math.ceil((300 - y0!) / dy!))
    expect(adam7.rows).toBe(passRows.reduce((sum, rows) => sum + rows, 0))
    expect(adam7.rows).toBe(563)
    expect(await digestOf(adam7.data)).toBe(SHOT_ADAM7_PNG_DIGEST)
  })

  test('a large PNG of stored blocks over several IDAT chunks decodes row for row, a chunk a step', { timeoutMs: 30_000 }, async () => {
    const raw = largeRawOf()
    const decoded = decodedOf(storedPngOf(WIDE, TALL, raw, 400_000))
    expect(decoded.truncated).toBeUndefined()
    expect(decoded.rows).toBe(TALL)
    expect(decoded.steps).toBe(Math.ceil(raw.length / 65_536))
    expect(await digestOf(decoded.data)).toBe(await digestOf(rgbaOfRaw(raw, TALL)))
  })
})

describe('data cut short or corrupt', () => {
  test('a picture cut short keeps its whole rows, the rest untouched, and says why', async () => {
    const whole = decodedOf(fixtureBytesOf(SHOT_PNG))
    const bytes = fixtureBytesOf(SHOT_PNG)
    const cut = decodedOf(bytes.subarray(0, Math.floor(bytes.length * 0.6)))
    expect(cut.truncated).toMatch(/^image data: /)
    expect(cut.rows).toBeGreaterThan(50)
    expect(cut.rows).toBeLessThan(300)
    const rowBytes = 400 * 4
    expect(await digestOf(cut.data.subarray(0, cut.rows * rowBytes))).toBe(await digestOf(whole.data.subarray(0, cut.rows * rowBytes)))
    expect(cut.data.subarray(cut.rows * rowBytes).every(byte => byte === 0)).toBe(true)
  })

  test('image data that ends before the first row is an error', () => {
    const bytes = fixtureBytesOf(SHOT_PNG)
    expect(() => decodedOf(bytes.subarray(0, 33 + 8 + 30))).toThrow(/^PNG: image data: /)
  })

  test('a bad filter type after some rows ends the picture there; before any row it is an error', () => {
    const raw = largeRawOf()
    raw[100 * (1 + WIDE * 3)] = 7
    const decoded = decodedOf(storedPngOf(WIDE, TALL, raw, 1 << 20))
    expect(decoded.rows).toBe(100)
    expect(decoded.truncated).toBe('bad filter type 7')
    raw[0] = 9
    expect(() => decodedOf(storedPngOf(WIDE, TALL, raw, 1 << 20))).toThrow('PNG: bad filter type 9')
  })

  test('a palette picture with no PLTE is an error before anything decodes', () => {
    const bytes = fixtureBytesOf(PNGSUITE.basn3p08!).slice()
    const at = bytes.findIndex((_, i) => bytes[i] === 0x50 && bytes[i + 1] === 0x4c && bytes[i + 2] === 0x54 && bytes[i + 3] === 0x45)
    bytes[at] = 0x70
    expect(() => createPngDecoder(bytes, fullSinkOf(32, 32))).toThrow('PNG: palette image with no PLTE')
  })
})
