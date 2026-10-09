import { describe, expect, test } from 'claude-code/testing'

import {
  imageHeaderOf,
  MASTER_SIDE,
  PIXEL_CAP,
  READ_CAP,
  runSliced,
  SIDE_CAP,
  sniffFormatOf,
  startMaster,
  WEBP_SIDE_CAP,
} from './decode-drive'
import type { MasterFailure, MasterJob } from './decode-drive'
import { digestOf, fixtureBytesOf, flatWebpOf, fullSinkOf, lcgBytesOf, randomOf, storedPngOf } from './decode-drive.fixtures'
import { GIFS } from './decode-gif.fixtures'
import { CMYK_JPEG, JPEGS, ORIENTED } from './decode-jpeg.fixtures'
import { createPngDecoder } from './decode-png'
import { PNGSUITE, SHOT_ADAM7_PNG, SHOT_PNG } from './decode-png.fixtures'
import { ANIMATED_WEBP, LOSSLESS_WEBPS, LOSSY_ALPHA_WEBP, LOSSY_WEBP } from './decode-webp.fixtures'
import type { Master } from './image-types'

// The decoders' front: formats sniffed, headers read without decoding (EXIF
// turned), refusals (no preview, too big from the header alone, can't read),
// masters (never larger than the picture, in display orientation, straight
// alpha, `hasAlpha` only when some pixel is not opaque, partial when the data
// is cut short), `runSliced` on a fake clock, steps honouring their deadline,
// and a fixed-seed fuzz of mutated and cut files that may only fail cleanly.

const isJob = (started: MasterJob | MasterFailure): started is MasterJob => !('failure' in started)

const jobOf = (bytes: Uint8Array, maxSide?: number): MasterJob => {
  const started = startMaster(bytes, maxSide)
  if (!isJob(started)) throw new Error(`no job: ${started.failure} (${started.detail})`)

  return started
}

/** The master once every step is done, each step's deadline long past. */
const masterOf = (bytes: Uint8Array, maxSide?: number): Master & { steps: number } => {
  const job = jobOf(bytes, maxSide)
  let steps = 1
  while (!job.step(0)) steps += 1

  return { ...job.master(), steps }
}

/** A 32 by 32 PNG's own pixels, decoded whole. */
const pngPixelsOf = (bytes: Uint8Array): Uint8Array => {
  const sink = fullSinkOf(32, 32)
  const decoder = createPngDecoder(bytes, sink)
  while (!decoder.step(Infinity)) continue

  return sink.data
}

/** The PNG with a tRNS chunk of `data` put after its IHDR (its CRC zero: never read). */
const withTrnsOf = (png: Uint8Array, data: readonly number[]): Uint8Array => {
  const chunk = new Uint8Array(12 + data.length)
  new DataView(chunk.buffer).setUint32(0, data.length)
  chunk.set([0x74, 0x52, 0x4e, 0x53, ...data], 4)
  const out = new Uint8Array(png.length + chunk.length)
  out.set(png.subarray(0, 33))
  out.set(chunk, 33)
  out.set(png.subarray(33), 33 + chunk.length)

  return out
}

const alphasOf = (master: Master): number[] => Array.from({ length: master.width * master.height }, (_, i) => master.rgba[i * 4 + 3]!)

/** The JPEG with the bytes after its first SOF0 marker from `offset` replaced (0 is the marker's second byte). */
const patchedSof = (bytes: Uint8Array, offset: number, values: readonly number[]): Uint8Array => {
  const copy = bytes.slice()
  const at = copy.findIndex((byte, i) => byte === 0xff && copy[i + 1] === 0xc0)
  copy.set(values, at + 1 + offset)

  return copy
}

describe('formats and headers', () => {
  test('the format comes from the first bytes', () => {
    expect(sniffFormatOf(fixtureBytesOf(SHOT_PNG))).toBe('png')
    expect(sniffFormatOf(fixtureBytesOf(JPEGS.baseline!.file))).toBe('jpeg')
    expect(sniffFormatOf(fixtureBytesOf(GIFS.plain.file))).toBe('gif')
    expect(sniffFormatOf(fixtureBytesOf(LOSSY_WEBP))).toBe('webp')
    for (const junk of ['', 'GIF8x', 'RIFF....AVI ', 'not a picture at all'].map(text => new TextEncoder().encode(text))) expect(sniffFormatOf(junk)).toBeUndefined()
  })

  test('the header is the size as displayed, read without decoding, and says what no decoder here draws', () => {
    expect(imageHeaderOf(fixtureBytesOf(SHOT_PNG))).toEqual({ format: 'png', width: 400, height: 300, decodable: true })
    expect(imageHeaderOf(fixtureBytesOf(ORIENTED[5]!.file))).toEqual({ format: 'jpeg', width: 80, height: 128, decodable: true })
    expect(imageHeaderOf(fixtureBytesOf(ORIENTED[1]!.file))).toEqual({ format: 'jpeg', width: 128, height: 80, decodable: true })
    expect(imageHeaderOf(fixtureBytesOf(CMYK_JPEG))).toEqual({ format: 'jpeg', width: 256, height: 192, decodable: false })
    expect(imageHeaderOf(fixtureBytesOf(GIFS.animated.file))).toEqual({ format: 'gif', width: 64, height: 48, decodable: true })
    expect(imageHeaderOf(fixtureBytesOf(LOSSLESS_WEBPS.vp8x.file))).toEqual({ format: 'webp', width: 64, height: 48, decodable: true })
    for (const lossy of [LOSSY_WEBP, LOSSY_ALPHA_WEBP, ANIMATED_WEBP]) expect(imageHeaderOf(fixtureBytesOf(lossy))?.decodable).toBe(false)
    expect(imageHeaderOf(fixtureBytesOf(PNGSUITE.xd9n2c08!))).toBeUndefined()
    expect(imageHeaderOf(new TextEncoder().encode('hello'))).toBeUndefined()
  })

  test('the caps are as the design sets them', () => {
    expect([MASTER_SIDE, READ_CAP, PIXEL_CAP, WEBP_SIDE_CAP, SIDE_CAP]).toEqual([256, 4_194_304, 36_000_000, 2048, 65_535])
  })
})

describe('refusals', () => {
  test('no preview: lossy and animated WebP, CMYK and the JPEG processes not decoded', () => {
    expect(startMaster(fixtureBytesOf(LOSSY_WEBP))).toEqual({ failure: 'no preview', detail: 'WebP: lossy (VP8) has no decoder here' })
    expect(startMaster(fixtureBytesOf(LOSSY_ALPHA_WEBP))).toEqual({ failure: 'no preview', detail: 'WebP: lossy (VP8) has no decoder here' })
    expect(startMaster(fixtureBytesOf(ANIMATED_WEBP))).toEqual({ failure: 'no preview', detail: 'WebP: an animation has no decoder here' })
    expect(startMaster(fixtureBytesOf(CMYK_JPEG))).toEqual({ failure: 'no preview', detail: 'JPEG: four components (CMYK or YCCK)' })
    expect(startMaster(patchedSof(fixtureBytesOf(JPEGS.baseline!.file), 0, [0xc9]))).toEqual({ failure: 'no preview', detail: 'JPEG: arithmetic coding' })
    expect(startMaster(patchedSof(fixtureBytesOf(JPEGS.baseline!.file), 3, [12]))).toEqual({ failure: 'no preview', detail: 'JPEG: 12-bit samples' })
  })

  test('too big, from the header alone: a PNG with no image data over the cap is too big, at the cap it is read', () => {
    const empty = new Uint8Array(0)
    expect(startMaster(storedPngOf(6001, 6000, empty, 64))).toEqual({ failure: 'too big', detail: 'PNG: 6001x6000 is over 36000000 pixels' })
    expect(startMaster(storedPngOf(70_000, 1, empty, 64))).toEqual({ failure: 'too big', detail: 'PNG: 70000x1 is over 65535 pixels a side' })
    const atCap = jobOf(storedPngOf(6000, 6000, empty, 64))
    expect(() => atCap.step(0)).toThrow('PNG: image data: ended early')
    expect(startMaster(patchedSof(fixtureBytesOf(JPEGS.baseline!.file), 4, [0x17, 0x70, 0x1f, 0x40]))).toEqual({ failure: 'too big', detail: 'JPEG: 8000x6000 is over 36000000 pixels' })
    const gif = fixtureBytesOf(GIFS.plain.file).slice()
    gif.set([0xff, 0xff, 0xff, 0xff], 6)
    expect(startMaster(gif)).toEqual({ failure: 'too big', detail: 'GIF: 65535x65535 is over 36000000 pixels' })
    expect(startMaster(flatWebpOf(2049, 1))).toEqual({ failure: 'too big', detail: 'WebP: 2049x1 is over 2048 pixels a side' })
    expect(isJob(startMaster(flatWebpOf(2048, 2048)))).toBe(true)
  })

  test('can\'t read: not a picture, a bad header, or nothing to decode, with the reason', () => {
    expect(startMaster(new TextEncoder().encode('hello'))).toEqual({ failure: "can't read", detail: 'not a PNG, JPEG, GIF or WebP file' })
    expect(startMaster(fixtureBytesOf(PNGSUITE.xd0n2c08!))).toEqual({ failure: "can't read", detail: 'PNG: bad colour type 2 at depth 0' })
    expect(startMaster(fixtureBytesOf(PNGSUITE.xdtn0g01!))).toEqual({ failure: "can't read", detail: 'PNG: no image data' })
    expect(startMaster(fixtureBytesOf(JPEGS.baseline!.file).subarray(0, 100))).toEqual({ failure: "can't read", detail: 'JPEG: no frame header' })
    expect(startMaster(fixtureBytesOf(GIFS.plain.file).subarray(0, 13))).toEqual({ failure: "can't read", detail: 'GIF: no image' })
    const badVp8l = fixtureBytesOf(LOSSLESS_WEBPS.plain.file).slice()
    badVp8l[20] = 0
    expect(startMaster(badVp8l)).toEqual({ failure: "can't read", detail: 'WebP: bad VP8L header' })
  })
})

describe('masters', () => {
  test('at most MASTER_SIDE on the long side and never larger than the picture (for JPEG, its eighth)', () => {
    const shot = masterOf(fixtureBytesOf(SHOT_PNG))
    expect([shot.width, shot.height]).toEqual([256, 192])
    const small = masterOf(fixtureBytesOf(PNGSUITE.basn2c08!))
    expect([small.width, small.height]).toEqual([32, 32])
    const asked = masterOf(fixtureBytesOf(SHOT_PNG), 40)
    expect([asked.width, asked.height]).toEqual([40, 30])
    const jpeg = masterOf(fixtureBytesOf(JPEGS.baseline!.file))
    expect([jpeg.width, jpeg.height]).toEqual([32, 24])
    const webp = masterOf(fixtureBytesOf(LOSSLESS_WEBPS.plain.file))
    expect([webp.width, webp.height]).toEqual([64, 48])
    const gif = masterOf(fixtureBytesOf(GIFS.plain.file), 16)
    expect([gif.width, gif.height]).toEqual([16, 12])
  })

  test('in display orientation: EXIF orientation 6 stands the picture up', () => {
    const turned = masterOf(fixtureBytesOf(ORIENTED[5]!.file))
    expect([turned.width, turned.height]).toEqual([10, 16])
  })

  test('straight alpha, colour kept under it, and hasAlpha only when some pixel is not opaque', async () => {
    const bytes = fixtureBytesOf(PNGSUITE.basn6a08!)
    const pixels = pngPixelsOf(bytes)
    const master = masterOf(bytes)
    expect(master.hasAlpha).toBe(true)
    for (let i = 0; i < 32 * 32 * 4; i += 4) {
      const expected = pixels[i + 3] === 0 ? [0, 0, 0, 0] : [...pixels.subarray(i, i + 4)]
      expect([...master.rgba.subarray(i, i + 4)], `${i / 4}`).toEqual(expected)
    }
    for (const [name, bytesOfIt, hasAlpha] of [
      ['opaque PNG', fixtureBytesOf(PNGSUITE.basn2c08!), false],
      ['PNG with a colour key no pixel has', withTrnsOf(fixtureBytesOf(PNGSUITE.basn2c08!), [0, 1, 0, 2, 0, 3]), false],
      ['PNG with a colour key that matches', fixtureBytesOf(PNGSUITE.tbrn2c08!), true],
      ['16-bit grey', fixtureBytesOf(PNGSUITE.basn0g16!), false],
      ['JPEG', fixtureBytesOf(JPEGS.progressive!.file), false],
      ['GIF', fixtureBytesOf(GIFS.plain.file), false],
      ['GIF with a transparent index', fixtureBytesOf(GIFS.transparent.file), true],
      ['lossless WebP', fixtureBytesOf(LOSSLESS_WEBPS.plain.file), false],
      ['lossless WebP with alpha', fixtureBytesOf(LOSSLESS_WEBPS.alpha.file), true],
    ] as const) {
      const one = masterOf(bytesOfIt)
      expect(one.hasAlpha, name).toBe(hasAlpha)
      expect(alphasOf(one).some(alpha => alpha < 255), name).toBe(hasAlpha)
    }
    // At one to one, an opaque picture's master is the picture.
    expect(await digestOf(masterOf(fixtureBytesOf(PNGSUITE.basn2c08!)).rgba)).toBe(await digestOf(pngPixelsOf(fixtureBytesOf(PNGSUITE.basn2c08!))))
  })

  test('a picture cut short finishes with what decoded, the rest transparent', () => {
    for (const [name, bytes] of [['PNG', fixtureBytesOf(SHOT_PNG)], ['JPEG', fixtureBytesOf(JPEGS.baseline!.file)]] as const) {
      const master = masterOf(bytes.subarray(0, Math.floor(bytes.length * 0.6)))
      const alphas = alphasOf(master)
      expect(master.hasAlpha, name).toBe(true)
      expect(alphas[0], name).toBe(255)
      expect(alphas.at(-1), name).toBe(0)
    }
  })

  test('the master so far: nothing before the first step, the coarse Adam7 picture after one chunk', () => {
    const job = jobOf(fixtureBytesOf(SHOT_ADAM7_PNG))
    expect(alphasOf(job.master()).every(alpha => alpha === 0)).toBe(true)
    expect(job.step(0)).toBe(false)
    const early = alphasOf(job.master())
    expect(early.some(alpha => alpha > 0)).toBe(true)
    expect(early.some(alpha => alpha === 0)).toBe(true)
    while (!job.step(0)) continue
    expect(job.step(0)).toBe(true)
  })

  test('a step that throws throws again, and its error names the format', () => {
    const bytes = fixtureBytesOf(JPEGS.baseline!.file)
    const scan = bytes.findIndex((byte, i) => byte === 0xff && bytes[i + 1] === 0xda)
    const job = jobOf(bytes.subarray(0, scan))
    expect(() => job.step(Infinity)).toThrow('JPEG: no image data')
    expect(() => job.step(Infinity)).toThrow('JPEG: no image data')
  })

  test('lossless WebP decodes whole in its first step, then bins its rows to the deadline', () => {
    const job = jobOf(fixtureBytesOf(LOSSLESS_WEBPS.alpha.file))
    expect(job.step(0)).toBe(false)
    let steps = 1
    while (!job.step(0)) steps += 1
    expect(steps).toBe(2)
    expect(masterOf(fixtureBytesOf(LOSSLESS_WEBPS.alpha.file)).steps).toBe(3)
  })
})

describe('slicing', () => {
  test('runSliced: each step\'s deadline a slice ahead of the clock, a pause between slices, done when a step says so', async () => {
    let now = 1000
    const deadlines: number[] = []
    let pauses = 0
    const outcome = await runSliced(
      deadline => {
        deadlines.push(deadline)
        now += 3

        return deadlines.length === 5
      },
      async () => {
        pauses += 1
      },
      { now: () => now },
    )
    expect(outcome).toBe('done')
    expect(deadlines).toEqual([1008, 1011, 1014, 1017, 1020])
    expect(pauses).toBe(4)
  })

  test('runSliced: aborted when isAborted says so before a slice', async () => {
    let steps = 0
    expect(await runSliced(() => (steps += 1) > 99, async () => {}, { isAborted: () => steps >= 2 })).toBe('aborted')
    expect(steps).toBe(2)
    expect(await runSliced(() => true, async () => {}, { isAborted: () => true })).toBe('aborted')
  })

  test('runSliced: too slow past the CPU summed over slices, or past the slice cap', async () => {
    let now = 0
    let steps = 0
    const tenMs = (): boolean => {
      steps += 1
      now += 10

      return false
    }
    expect(await runSliced(tenMs, async () => {}, { now: () => now })).toBe('too slow')
    expect(steps).toBe(300)
    steps = 0
    expect(await runSliced(tenMs, async () => {}, { now: () => now, cpuCapMs: 50 })).toBe('too slow')
    expect(steps).toBe(5)
    steps = 0
    expect(await runSliced(() => (steps += 1) > 999, async () => {}, { now: () => now })).toBe('too slow')
    expect(steps).toBe(400)
    steps = 0
    expect(await runSliced(() => (steps += 1) === 400, async () => {}, { now: () => now })).toBe('done')
  })

  test('runSliced: a step that throws rejects with its error', async () => {
    await expect(runSliced(() => {
      throw new Error('PNG: bad filter type 9')
    }, async () => {})).rejects.toThrow('PNG: bad filter type 9')
  })

  test('each step honours its deadline: a large PNG in 2 ms slices', { timeoutMs: 30_000 }, async () => {
    const width = 2000
    const height = 1200
    const noise = lcgBytesOf(3, width * 3)
    const raw = new Uint8Array(height * (1 + width * 3))
    for (let y = 0; y < height; y += 1) raw.set(noise, y * (1 + width * 3) + 1)
    const job = jobOf(storedPngOf(width, height, raw, 1 << 20))
    const durations: number[] = []
    const outcome = await runSliced(
      deadline => {
        const start = performance.now()
        const done = job.step(deadline)
        durations.push(performance.now() - start)

        return done
      },
      async () => {},
      { sliceMs: 2 },
    )
    expect(outcome).toBe('done')
    durations.sort((a, b) => a - b)
    expect(durations.length).toBeGreaterThan(10)
    expect(durations[Math.floor(durations.length / 2)]!).toBeLessThan(8)
    expect(durations.at(-1)!).toBeLessThan(100)
  })
})

describe('fuzz', () => {
  test('two hundred mutated or cut files only fail cleanly, each within the CPU cap', { timeoutMs: 60_000 }, async () => {
    const random = randomOf(20_261_009)
    const sources = [
      PNGSUITE.basn6a08!, PNGSUITE.basi3p04!, PNGSUITE.basn0g16!, PNGSUITE.tbrn2c08!, PNGSUITE.basi6a16!,
      JPEGS.baseline!.file, JPEGS.progressive!.file, JPEGS.restart!.file, ORIENTED[5]!.file,
      GIFS.plain.file, GIFS.interlaced.file, GIFS.transparent.file,
      LOSSLESS_WEBPS.plain.file, LOSSLESS_WEBPS.alpha.file,
    ].map(fixtureBytesOf)
    const outcomes = new Map<string, number>()
    for (let i = 0; i < 200; i += 1) {
      const source = sources[i % sources.length]!
      const bytes = source.slice(0, i % 4 === 0 ? random(source.length + 1) : source.length)
      const flips = i % 4 === 0 ? random(3) : 1 + random(8)
      for (let k = 0; k < flips && bytes.length > 0; k += 1) bytes[random(bytes.length)] = random(256)
      const started = startMaster(bytes)
      let outcome: string
      if (!isJob(started)) {
        expect(['no preview', 'too big', "can't read"], `${i}`).toContain(started.failure)
        outcome = started.failure
      } else {
        let spent = 0
        try {
          const result = await runSliced(deadline => {
            const start = performance.now()
            const done = started.step(deadline)
            spent += performance.now() - start

            return done
          }, async () => {})
          expect(result, `${i}`).toBe('done')
          const master = started.master()
          expect(master.rgba.length, `${i}`).toBe(master.width * master.height * 4)
          outcome = 'done'
        } catch (error) {
          expect(error, `${i}`).toBeInstanceOf(Error)
          expect((error as Error).constructor, `${i}: ${String(error)}`).toBe(Error)
          expect((error as Error).message, `${i}`).toMatch(/^(PNG|JPEG|GIF|WebP): /)
          outcome = 'error'
        }
        expect(spent, `${i}`).toBeLessThan(3000)
      }
      outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1)
    }
    expect([...outcomes.values()].reduce((a, b) => a + b, 0)).toBe(200)
    expect(outcomes.get('done')).toBeGreaterThan(50)
  })
})
