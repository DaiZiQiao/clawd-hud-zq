import { describe, expect, test } from 'claude-code/testing'

import { HEIGHT_DEFAULT, HEIGHT_MAX, HEIGHT_MIN, settingsOf } from './images-options'

// The options as the hooks read them: the defaults when unset, a height
// rounded and kept within 3..20, anything Claude Code would not store read as
// the default.

describe('options', () => {
  test('unset: 8 rows, pictures auto', () => {
    expect(settingsOf({})).toEqual({ height: HEIGHT_DEFAULT, pictures: 'auto' })
    expect([HEIGHT_DEFAULT, HEIGHT_MIN, HEIGHT_MAX]).toEqual([8, 3, 20])
  })

  test('the height is rounded and kept within 3..20', () => {
    const heights: [number, number][] = [[6, 6], [6.4, 6], [6.5, 7], [3, 3], [2.4, 3], [0, 3], [-5, 3], [20, 20], [20.4, 20], [21, 20], [1e9, 20]]
    for (const [given, used] of heights) expect(settingsOf({ height: given }).height, String(given)).toBe(used)
  })

  test('a height that is no number reads as the default', () => {
    const odd: readonly (string | number | boolean | readonly string[])[] = [Number.NaN, Number.POSITIVE_INFINITY, '6', true, ['6']]
    for (const given of odd) expect(settingsOf({ height: given }).height, String(given)).toBe(HEIGHT_DEFAULT)
  })

  test('pictures: blocks and text as given, anything else auto', () => {
    expect(settingsOf({ pictures: 'blocks' }).pictures).toBe('blocks')
    expect(settingsOf({ pictures: 'text' }).pictures).toBe('text')
    for (const given of ['auto', 'pixels', 'BLOCKS', '', 3]) expect(settingsOf({ pictures: given }).pictures, String(given)).toBe('auto')
  })
})
