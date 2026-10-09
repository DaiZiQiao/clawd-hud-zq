import { describe, expect, test } from 'claude-code/testing'

import { chipIdsOf, chipKeyOf, sentIdsOf } from './draft-chips'

// The draft's `[Image #N]` chips as Claude Code writes them (the spacing a
// sibling probe saw), what is not a chip, the key that compares two chip
// lists, and the chips a transcript row sent pictures for.

describe('chips in a draft', () => {
  test('as Claude Code inserts them: one after another, after typing, after a text paste', () => {
    expect(chipIdsOf('[Image #1] x[Image #2] hello paste[Image #3] [Image #4]')).toEqual([1, 2, 3, 4])
    expect(chipIdsOf('[Image #1][Image #2]')).toEqual([1, 2])
    expect(chipIdsOf('abc[Image #2]def')).toEqual([2])
    expect(chipIdsOf('')).toEqual([])
  })

  test('ascending and each once, wherever they stand in the text', () => {
    expect(chipIdsOf('[Image #3] vs [Image #1], and [Image #3] again')).toEqual([1, 3])
    expect(chipIdsOf('[Image #10] [Image #9]')).toEqual([9, 10])
  })

  test('not chips: id 0, no id, the wrong case or shape, a text paste, an id too large to be one', () => {
    expect(chipIdsOf('[Image #0] [Image #] [image #2] [Image 2] [Pasted text #5] [Image #2 +3 lines] [Image #-1] [Image #1.5] [ Image #6]')).toEqual([])
    expect(chipIdsOf('[Image #99999999999999999999]')).toEqual([])
  })

  test('a leading zero names the id Claude Code reads in it', () => {
    expect(chipIdsOf('[Image #007]')).toEqual([7])
  })
})

describe('chip keys', () => {
  test('chipKeyOf: one string per set of ids, whatever their order', () => {
    expect(chipKeyOf([1, 2, 7])).toBe('1,2,7')
    expect(chipKeyOf([7, 1, 7])).toBe('1,7')
    expect(chipKeyOf([])).toBe('')
    expect(chipKeyOf(chipIdsOf('[Image #2] [Image #10]'))).not.toBe(chipKeyOf(chipIdsOf('[Image #21] [Image #0]')))
  })
})

describe('chips a sent row carried', () => {
  test('the prompt row: its text names the chips, its image blocks follow', () => {
    const row = [
      { type: 'text', text: 'see [Image #3] and [Image #4]' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
    ]
    expect(sentIdsOf(row)).toEqual([3, 4])
  })

  test('a row of text alone sent no picture, whatever chips it names: a recalled draft', () => {
    expect(sentIdsOf([{ type: 'text', text: 'look at [Image #1] and [Image #2]' }])).toEqual([])
    expect(sentIdsOf([{ type: 'text', text: '[Image: source: /tmp/imgs/grad.png]' }])).toEqual([])
  })

  test('chips from every text block, each on its own, text that is not a string skipped', () => {
    expect(sentIdsOf([{ type: 'text', text: '[Image #5]' }, { type: 'image' }, { type: 'text', text: 'and [Image #2] [Image #5]' }])).toEqual([2, 5])
    expect(sentIdsOf([{ type: 'text', text: '[Image #' }, { type: 'text', text: '5]' }, { type: 'image' }])).toEqual([])
    expect(sentIdsOf([{ type: 'text', text: 42 }, { type: 'image' }])).toEqual([])
    expect(sentIdsOf([{ type: 'image' }])).toEqual([])
  })
})
