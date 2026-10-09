import { describe, expect, test } from 'claude-code/testing'

import { base64Of, bytesOf } from './images-bytes'

// Bytes to base64 and back through the environment's own Uint8Array methods:
// standard padded base64, every byte value, nothing at all.

describe('base64', () => {
  test('a Raster cell\'s first word, padded', () => {
    expect(base64Of(Uint8Array.of(0x80, 0x25, 0, 0))).toBe('gCUAAA==')
    expect([...bytesOf('gCUAAA==')]).toEqual([0x80, 0x25, 0, 0])
  })

  test('every byte value goes there and back', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, at) => at)
    expect([...bytesOf(base64Of(bytes))]).toEqual([...bytes])
  })

  test('nothing is the empty string', () => {
    expect(base64Of(new Uint8Array(0))).toBe('')
    expect(bytesOf('')).toHaveLength(0)
  })
})
