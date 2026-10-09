import { describe, expect, test } from 'claude-code/testing'

import { fixtureBytesOf, fullSinkOf } from './decode-drive.fixtures'
import { createGifDecoder, gifHeaderOf } from './decode-gif'
import type { GifDecoder } from './decode-gif'
import { GIFS, OFFSET_GIF } from './decode-gif.fixtures'

// A GIF's first frame: against PIL's for a plain, an interlaced, a
// see-through and an animated file; a frame at an offset on its transparent
// canvas; the same picture whatever the slices; data cut short; and headers
// that cannot be read.

type Decoded = { decoder: GifDecoder; data: Uint8Array; steps: number; rows: number }

const decodedOf = (bytes: Uint8Array, deadline = 0): Decoded => {
  const header = gifHeaderOf(bytes)
  if (typeof header === 'string') throw new Error(header)
  const sink = fullSinkOf(header.width, header.height)
  const decoder = createGifDecoder(bytes, sink)
  let steps = 1
  while (!decoder.step(deadline)) steps += 1

  return { decoder, data: sink.data, steps, rows: sink.rows }
}

/** Where the first image descriptor of a 64 by 48 frame at (0, 0) starts. */
const descriptorOf = (bytes: Uint8Array): number =>
  bytes.findIndex((byte, i) => byte === 0x2c && [0, 0, 0, 0, 64, 0, 48, 0].every((value, k) => bytes[i + 1 + k] === value))

/** PIL keeps a see-through pixel's palette colour, this decoder zero: alpha compared everywhere, colour where opaque. */
const differencesOf = (reference: Uint8Array, data: Uint8Array): number => {
  let differing = 0
  for (let i = 0; i < reference.length; i += 4) {
    const opaque = reference[i + 3] !== 0
    if (reference[i + 3] !== data[i + 3] || (opaque && (reference[i] !== data[i] || reference[i + 1] !== data[i + 1] || reference[i + 2] !== data[i + 2]))) differing += 1
  }

  return differing
}

describe('first frames', () => {
  test('plain, interlaced, see-through and the first of three frames match PIL', () => {
    for (const [name, fixture] of Object.entries(GIFS)) {
      const { decoder, data, rows } = decodedOf(fixtureBytesOf(fixture.file))
      expect(differencesOf(fixtureBytesOf(fixture.reference), data), name).toBe(0)
      expect(rows, name).toBe(48)
      expect(decoder.header.interlaced, name).toBe(name === 'interlaced' || name === 'transparent')
    }
    const { decoder, data } = decodedOf(fixtureBytesOf(GIFS.transparent.file))
    expect(decoder.header.transparent).toBeGreaterThanOrEqual(0)
    expect([...data.subarray(0, 4)]).toEqual([0, 0, 0, 0])
  })

  test('a frame at an offset sits on a transparent canvas the size of the logical screen', () => {
    const { decoder, data, rows } = decodedOf(fixtureBytesOf(OFFSET_GIF.file))
    expect(decoder.header).toEqual({ width: 64, height: 48, frameX: 10, frameY: 8, frameWidth: 40, frameHeight: 30, interlaced: false, transparent: -1 })
    expect(rows).toBe(48)
    const frame = fixtureBytesOf(OFFSET_GIF.reference)
    for (let y = 0; y < 48; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const at = (y * 64 + x) * 4
        const inside = x >= 10 && x < 50 && y >= 8 && y < 38
        const expected = inside ? [...frame.subarray(((y - 8) * 40 + x - 10) * 4, ((y - 8) * 40 + x - 10) * 4 + 4)] : [0, 0, 0, 0]
        expect([...data.subarray(at, at + 4)], `${x},${y}`).toEqual(expected)
      }
    }
  })

  test('the picture is the same in one slice or in many', () => {
    for (const [name, fixture] of Object.entries(GIFS)) {
      const sliced = decodedOf(fixtureBytesOf(fixture.file), 0)
      const whole = decodedOf(fixtureBytesOf(fixture.file), Infinity)
      expect(whole.steps, name).toBe(1)
      expect(sliced.steps, name).toBeGreaterThan(2)
      expect([...sliced.data], name).toEqual([...whole.data])
    }
  })
})

describe('data cut short and bad headers', () => {
  test('a GIF cut short keeps the rows decoded before the cut', () => {
    const bytes = fixtureBytesOf(GIFS.plain.file)
    const whole = decodedOf(bytes).data
    const cut = decodedOf(bytes.subarray(0, Math.floor(bytes.length * 0.6)))
    expect(cut.rows).toBeGreaterThan(5)
    expect(cut.rows).toBeLessThan(48)
    const rowBytes = 64 * 4
    expect([...cut.data.subarray(0, cut.rows * rowBytes)]).toEqual([...whole.subarray(0, cut.rows * rowBytes)])
    expect(cut.data.subarray(cut.rows * rowBytes).every(byte => byte === 0)).toBe(true)
  })

  test('a frame whose data never comes is an error', () => {
    const bytes = fixtureBytesOf(GIFS.plain.file)
    const layout = gifHeaderOf(bytes)
    expect(typeof layout).toBe('object')
    const descriptor = descriptorOf(bytes)
    // The descriptor, its LZW code size, and nothing more.
    expect(() => decodedOf(bytes.subarray(0, descriptor + 11))).toThrow('GIF: no image data')
  })

  test('a header that cannot be read says why', () => {
    const bytes = fixtureBytesOf(GIFS.plain.file)
    expect(gifHeaderOf(bytes.subarray(1))).toBe('GIF: no signature')
    const flat = bytes.slice()
    flat.set([0, 0], 6)
    expect(gifHeaderOf(flat)).toBe('GIF: no logical screen size')
    expect(gifHeaderOf(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0x3b]))).toBe('GIF: no image')
    const descriptor = descriptorOf(bytes)
    const wide = bytes.slice()
    wide[descriptor + 10] = 12
    expect(gifHeaderOf(wide)).toBe('GIF: bad LZW code size')
    expect(() => createGifDecoder(wide, fullSinkOf(64, 48))).toThrow('GIF: bad LZW code size')
  })
})
