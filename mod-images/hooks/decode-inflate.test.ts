import { describe, expect, test } from 'claude-code/testing'

import { digestOf, fixtureBytesOf } from './decode-drive.fixtures'
import { createInflater, createZlibInflater, INFLATE_PAD } from './decode-inflate'
import type { Inflater } from './decode-inflate'
import {
  TEXT_DYNAMIC_ZLIB,
  TEXT_FIXED_ZLIB,
  TEXT_SHA256,
  TEXT_STORED_ZLIB,
  textOf,
  WINDOW_SHA256,
  WINDOW_ZLIB,
  windowDataOf,
} from './decode-inflate.fixtures'

// The resumable inflater on zlib streams of every block type, against the
// data they hold: a chunk at a time, matches reaching back across chunks, a
// stream cut anywhere (a prefix of its data, then the reason), bad headers
// and corrupt blocks, and a run of empty blocks that still returns between
// headers.

const paddedOf = (bytes: Uint8Array): Uint8Array => {
  const src = new Uint8Array(bytes.length + INFLATE_PAD)
  src.set(bytes)

  return src
}

const drained = (inflater: Inflater): { out: Uint8Array; chunks: number[]; failure: string | undefined } => {
  const parts: Uint8Array[] = []
  for (let chunk = inflater.next(); chunk !== undefined; chunk = inflater.next()) parts.push(chunk.slice())
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }

  return { out, chunks: parts.map(part => part.length), failure: inflater.failure() }
}

const inflatedOf = (zlib: Uint8Array): ReturnType<typeof drained> => drained(createZlibInflater(paddedOf(zlib), zlib.length))

const isPrefix = (part: Uint8Array, whole: Uint8Array): boolean => part.length <= whole.length && part.every((byte, at) => byte === whole[at])

describe('streams', () => {
  test('dynamic, fixed and stored blocks inflate to the text they hold, 64 KiB at a time', async () => {
    const text = textOf()
    expect(await digestOf(text)).toBe(TEXT_SHA256)
    for (const [label, zlib, expected] of [
      ['dynamic', TEXT_DYNAMIC_ZLIB, text],
      ['fixed', TEXT_FIXED_ZLIB, text],
      ['stored', TEXT_STORED_ZLIB, text.subarray(0, 70_000)],
    ] as const) {
      const { out, chunks, failure } = inflatedOf(fixtureBytesOf(zlib))
      expect(failure, label).toBeUndefined()
      expect(out.length, label).toBe(expected.length)
      expect(isPrefix(out, expected), label).toBe(true)
      expect(chunks.length, label).toBeGreaterThan(1)
      expect(Math.max(...chunks), label).toBeLessThanOrEqual(65_536 + 257)
    }
  })

  test('matches reach 30,000 bytes back across chunk boundaries', async () => {
    const data = windowDataOf()
    expect(await digestOf(data)).toBe(WINDOW_SHA256)
    const { out, chunks, failure } = inflatedOf(fixtureBytesOf(WINDOW_ZLIB))
    expect(failure).toBeUndefined()
    expect(chunks.length).toBe(3)
    expect(out.length).toBe(data.length)
    expect(await digestOf(out)).toBe(WINDOW_SHA256)
  })
})

describe('streams cut short or corrupt', () => {
  test('a stream cut anywhere hands out a prefix of its data, then says why it stopped', () => {
    for (const [zlib, data] of [[fixtureBytesOf(TEXT_DYNAMIC_ZLIB), textOf()], [fixtureBytesOf(WINDOW_ZLIB), windowDataOf()], [fixtureBytesOf(TEXT_FIXED_ZLIB), textOf()]] as const) {
      for (let cut = 3; cut < zlib.length - 4; cut += Math.ceil(zlib.length / 13)) {
        const { out, failure } = inflatedOf(zlib.subarray(0, cut))
        expect(isPrefix(out, data), `${cut} of ${zlib.length}`).toBe(true)
        expect(out.length, `${cut} of ${zlib.length}`).toBeLessThan(data.length)
        expect(failure, `${cut} of ${zlib.length}`).toBeDefined()
      }
    }
  })

  test('a bad zlib header fails before any output', () => {
    for (const [header, why] of [
      [[0x78], 'zlib stream too short'],
      [[0x79, 0x9c, 0, 0], 'not a DEFLATE zlib stream'],
      [[0x78, 0x9d, 0, 0], 'zlib header check failed'],
      [[0x78, 0xbb, 0, 0], 'zlib preset dictionary'],
    ] as const) {
      const bytes = Uint8Array.from(header)
      const inflater = createZlibInflater(paddedOf(bytes), bytes.length)
      expect(inflater.next(), why).toBeUndefined()
      expect(inflater.failure()).toBe(why)
    }
  })

  test('a corrupt block fails with the reason, and keeps failing', () => {
    for (const [body, why] of [
      [[0x07], 'invalid block type'],
      [[0x01, 0x05, 0x00, 0x05, 0x00], 'stored block length check failed'],
      [[0x01, 0x05, 0x00, 0xfa, 0xff, 0x41], 'unexpected end of data'],
    ] as const) {
      const bytes = Uint8Array.from(body)
      const inflater = createInflater(paddedOf(bytes), 0, bytes.length)
      expect(drained(inflater).failure, why).toBe(why)
      expect(inflater.next()).toBeUndefined()
    }
  })

  test('a run of empty blocks returns every sixteen headers with nothing new, then the data', () => {
    const empty = [0x00, 0x00, 0x00, 0xff, 0xff]
    const bytes = Uint8Array.from([...Array.from({ length: 2000 }, () => empty).flat(), 0x01, 0x05, 0x00, 0xfa, 0xff, 1, 2, 3, 4, 5])
    const { out, chunks, failure } = drained(createInflater(paddedOf(bytes), 0, bytes.length))
    expect(failure).toBeUndefined()
    expect([...out]).toEqual([1, 2, 3, 4, 5])
    expect(chunks.length).toBe(126)
    expect(chunks.slice(0, -1).every(n => n === 0)).toBe(true)
  })
})
