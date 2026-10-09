import { describe, expect, test } from 'claude-code/testing'

import { digestOf, fixtureBytesOf, flatWebpOf, webpOf } from './decode-drive.fixtures'
import { decodeWebp, webpHeaderOf } from './decode-webp'
import { ANIMATED_WEBP, LOSSLESS_WEBPS, LOSSY_ALPHA_WEBP, LOSSY_WEBP } from './decode-webp.fixtures'

// WebP: the container's header for every kind (lossless alone or in VP8X,
// lossy with and without alpha, animated), lossless pictures against
// libwebp's own decode, VP8L streams written bit by bit for what the vendored
// library is never run on, and its own errors carrying the WebP prefix.

describe('headers', () => {
  test('each kind is named, with the canvas size', () => {
    for (const [name, fixture] of Object.entries(LOSSLESS_WEBPS)) expect(webpHeaderOf(fixtureBytesOf(fixture.file)), name).toEqual({ width: 64, height: 48, kind: 'lossless' })
    expect(webpHeaderOf(fixtureBytesOf(LOSSY_WEBP))).toEqual({ width: 64, height: 48, kind: 'lossy' })
    expect(webpHeaderOf(fixtureBytesOf(LOSSY_ALPHA_WEBP))).toEqual({ width: 64, height: 48, kind: 'lossy' })
    expect(webpHeaderOf(fixtureBytesOf(ANIMATED_WEBP))).toEqual({ width: 64, height: 48, kind: 'animated' })
    expect(webpHeaderOf(flatWebpOf(2048, 1))).toEqual({ width: 2048, height: 1, kind: 'lossless' })
  })

  test('the containers really are the kinds named: VP8L alone, VP8X around VP8L, ALPH beside VP8', () => {
    const fourccs = (bytes: Uint8Array): string[] => {
      const found: string[] = []
      for (let at = 12; at + 8 <= bytes.length; ) {
        found.push(String.fromCharCode(...bytes.subarray(at, at + 4)))
        const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(at + 4, true)
        at += 8 + length + (length & 1)
      }

      return found
    }
    expect(fourccs(fixtureBytesOf(LOSSLESS_WEBPS.plain.file))).toEqual(['VP8L'])
    expect(fourccs(fixtureBytesOf(LOSSLESS_WEBPS.vp8x.file))).toContain('VP8X')
    expect(fourccs(fixtureBytesOf(LOSSLESS_WEBPS.vp8x.file))).toContain('VP8L')
    expect(fourccs(fixtureBytesOf(LOSSY_ALPHA_WEBP))).toEqual(['VP8X', 'ALPH', 'VP8 '])
  })

  test('a header that cannot be read says why', () => {
    const plain = fixtureBytesOf(LOSSLESS_WEBPS.plain.file)
    expect(webpHeaderOf(plain.subarray(0, 16))).toBe('WebP: no RIFF header')
    const unknown = plain.slice()
    unknown.set([0x56, 0x50, 0x38, 0x5a], 12)
    expect(webpHeaderOf(unknown)).toBe('WebP: unknown first chunk "VP8Z"')
    const signature = plain.slice()
    signature[20] = 0
    expect(webpHeaderOf(signature)).toBe('WebP: bad VP8L header')
    const vp8x = fixtureBytesOf(LOSSLESS_WEBPS.vp8x.file).slice()
    vp8x[24] = 99
    expect(webpHeaderOf(vp8x)).toBe('WebP: the picture is not the canvas size')
    expect(webpHeaderOf(vp8x.subarray(0, 30))).toBe('WebP: no picture chunk')
  })
})

describe('decoding', () => {
  test('lossless pictures decode as libwebp decodes them, alpha and all', async () => {
    for (const [name, fixture] of Object.entries(LOSSLESS_WEBPS)) {
      const picture = decodeWebp(fixtureBytesOf(fixture.file))
      expect([picture.width, picture.height], name).toEqual([64, 48])
      expect(await digestOf(picture.rgba), name).toBe(fixture.digest)
    }
    const alpha = decodeWebp(fixtureBytesOf(LOSSLESS_WEBPS.alpha.file)).rgba
    expect(alpha.some((byte, at) => at % 4 === 3 && byte < 255)).toBe(true)
  })

  test('a VP8L stream written bit by bit decodes to its colour, with a colour cache and a group map too', () => {
    for (const options of [{}, { cacheBits: 11 }, { groups: { bits: 2, argb: [255, 0, 0, 0] as const } }, { transforms: [2] }]) {
      const picture = decodeWebp(flatWebpOf(20, 10, options))
      expect([picture.width, picture.height], JSON.stringify(options)).toEqual([20, 10])
      expect([...picture.rgba.subarray(picture.rgba.length - 4)], JSON.stringify(options)).toEqual('transforms' in options ? [44, 100, 150, 255] : [200, 100, 50, 255])
    }
    expect([...decodeWebp(flatWebpOf(1, 1, { argb: [128, 10, 20, 30] })).rgba]).toEqual([10, 20, 30, 128])
  })

  test('the library is never run on what libwebp refuses or never writes', () => {
    expect(() => decodeWebp(flatWebpOf(2048, 2048, { transforms: [2, 2] }))).toThrow('WebP: a transform used twice')
    expect(() => decodeWebp(flatWebpOf(4, 4, { cacheBits: 12 }))).toThrow('WebP: a 12-bit colour cache')
    expect(() => decodeWebp(flatWebpOf(20, 20, { groups: { bits: 2, argb: [255, 16, 0, 0] } }))).toThrow('WebP: 4097 Huffman groups')
    expect(() => decodeWebp(flatWebpOf(20, 20, { groups: { bits: 2, argb: [255, 0, 29, 0] } }))).toThrow('WebP: 30 Huffman groups')
    // Codes the library builds before its first pixel, all in its one call: their groups times their symbols are capped.
    expect(() => decodeWebp(flatWebpOf(64, 64, { cacheBits: 11, groups: { bits: 2, argb: [255, 0, 199, 0] } }))).toThrow('WebP: 200 Huffman groups of 3136 symbols')
    expect(() => decodeWebp(flatWebpOf(64, 64, { groups: { bits: 2, argb: [255, 0, 199, 0] } }))).not.toThrow(/Huffman groups/)
  })

  test('the library\'s own errors, and every other, carry the WebP prefix', () => {
    const plain = fixtureBytesOf(LOSSLESS_WEBPS.plain.file)
    expect(() => decodeWebp(plain.subarray(0, 200))).toThrow(/^WebP: /)
    expect(() => decodeWebp(fixtureBytesOf(LOSSY_WEBP))).toThrow('WebP: no VP8L chunk')
    expect(() => decodeWebp(webpOf(Uint8Array.of(0x2f, 0, 0, 0, 0xe0)))).toThrow('WebP: unknown VP8L version')
    for (let cut = 30; cut < plain.length; cut += 97) {
      try {
        decodeWebp(plain.subarray(0, cut))
      } catch (error) {
        expect(error, `${cut}`).toBeInstanceOf(Error)
        expect((error as Error).message, `${cut}`).toMatch(/^WebP: /)
      }
    }
  })
})
