import { describe, expect, test } from 'claude-code/testing'

import { displayWidth, padEnd, padStart, truncate, truncateStart } from './text-width'

// Text in terminal cells, cluster by cluster: an emoji, a mark, a joiner or a
// flag takes what the terminal draws it in, and no cut falls inside one.

const ZWJ = '\u200d'
const VS16 = '\ufe0f'
const FAMILY = `👨${ZWJ}👩${ZWJ}👧`
const FLAG = '🇯🇵'

describe('cells', () => {
  test('emoji drawn as emoji take two cells: ✅ ⚡ ❌ ☕ ⏳ ⭐ 🈚, and the U+1FA70 block', () => {
    for (const emoji of ['✅', '⚡', '❌', '☕', '⏳', '⭐', '🈚', '🫠', '🪐']) expect(displayWidth(emoji), emoji).toBe(2)
    expect(displayWidth('done ✅')).toBe(7)
  })

  test('a pictograph drawn as text takes one cell, two once U+FE0F asks for its emoji', () => {
    expect(displayWidth('❤')).toBe(1)
    expect(displayWidth(`❤${VS16}`)).toBe(2)
    expect(displayWidth(`a❤${VS16}b`)).toBe(4)
  })

  test('a ZWJ sequence, a skin tone and a flag are one emoji each, two cells', () => {
    expect(displayWidth(FAMILY)).toBe(2)
    expect(displayWidth('👍🏽')).toBe(2)
    expect(displayWidth(FLAG)).toBe(2)
    expect(displayWidth(`${FAMILY}${FLAG}👍🏽`)).toBe(6)
  })

  test('a mark takes no cell of its own, in Latin, Thai and Arabic; a spacing vowel takes one', () => {
    expect(displayWidth('é')).toBe(1)
    expect(displayWidth('e\u0301')).toBe(1)
    expect(displayWidth('ก\u0e34')).toBe(1)
    expect(displayWidth('กำ')).toBe(2)
    expect(displayWidth('\u0645\u064e')).toBe(1)
  })

  test('the soft hyphen, the word joiner and the BOM take none', () => {
    for (const char of ['\u00ad', '\u2060', '\ufeff']) {
      expect(displayWidth(char), char.codePointAt(0)?.toString(16)).toBe(0)
      expect(displayWidth(`a${char}b`), char.codePointAt(0)?.toString(16)).toBe(2)
    }
  })

  test('CJK takes two cells a character, plain ASCII one', () => {
    expect(displayWidth('漢字')).toBe(4)
    expect(displayWidth('plain text, 42!')).toBe(15)
    expect(displayWidth('')).toBe(0)
  })

  test('as Unicode has it: every mark and format character draws on the character before, every presentation emoji takes two cells', () => {
    const joining = /[\p{Mn}\p{Me}\p{Cf}]/u
    const presented = /\p{Emoji_Presentation}/u
    for (let cp = 0; cp <= 0x1ffff; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue
      const char = String.fromCodePoint(cp)
      if (joining.test(char)) expect(displayWidth(`a${char}`), cp.toString(16)).toBe(1)
      else if (presented.test(char) && !(cp >= 0x1f1e6 && cp <= 0x1f1ff)) expect(displayWidth(char), cp.toString(16)).toBe(2)
    }
  })
})

describe('cuts', () => {
  test('a cut fits its cells and ends in …, an emoji with no room left out whole', () => {
    expect(truncate('abc✅defghij', 5)).toBe('abc…')
    expect(displayWidth(truncate('abc✅defghij', 5))).toBeLessThanOrEqual(5)
    expect(truncateStart('abcdefg✅hij', 5)).toBe('…hij')
    expect(truncate('ab✅defghij', 5)).toBe('ab✅…')
  })

  test('no cut falls inside a ZWJ sequence or a flag', () => {
    const clusters = ['a', 'b', FAMILY, FLAG, 'c', 'd']
    const text = clusters.join('')
    const heads = clusters.map((_, index) => clusters.slice(0, index).join(''))
    const tails = clusters.map((_, index) => clusters.slice(index + 1).join(''))
    expect(displayWidth(text)).toBe(8)
    for (let width = 1; width < 8; width += 1) {
      expect(heads, `${width}: ${truncate(text, width)}`).toContain(truncate(text, width).slice(0, -1))
      expect(tails, `${width}: ${truncateStart(text, width)}`).toContain(truncateStart(text, width).slice(1))
      expect(displayWidth(truncate(text, width)), `${width}`).toBeLessThanOrEqual(width)
      expect(displayWidth(truncateStart(text, width)), `${width}`).toBeLessThanOrEqual(width)
    }
    expect(truncate(text, 5)).toBe(`ab${FAMILY}…`)
    expect(truncate(text, 4)).toBe('ab…')
    expect(truncateStart(text, 5)).toBe(`…${FLAG}cd`)
    expect(truncateStart(text, 4)).toBe('…cd')
    expect(truncate(`e\u0301e\u0301e\u0301`, 2)).toBe(`e\u0301…`)
  })

  test('plain ASCII cuts as it did: blanks at the cut dropped, nothing cut that fits', () => {
    expect(truncate('feature/long-branch', 10)).toBe('feature/l…')
    expect(truncate('hello  world', 8)).toBe('hello…')
    expect(truncateStart('hello  world', 8)).toBe('…world')
    expect(truncateStart('src/hooks/text-width.ts', 12)).toBe('…xt-width.ts')
    expect(truncate('short', 10)).toBe('short')
    expect(truncate('short', 0)).toBe('')
    expect(truncate('short', 1)).toBe('…')
  })

  test('padding counts cells', () => {
    expect(padEnd('✅', 4)).toBe('✅  ')
    expect(padStart(FLAG, 3)).toBe(` ${FLAG}`)
    expect(padEnd('abc', 2)).toBe('abc')
  })
})
