import { describe, expect, test } from 'claude-code/testing'

import { spriteSheet } from './mascot-sheet.fixtures'
import { BOX, HEADS, LEGS, MINI_HEADS, MINI_LEGS, MINI_OVERLAYS, OVERLAYS, SLOT, THOUGHTS, THOUGHT_FRAMES, TORSOS, flipped, thoughtBubble } from './mascot-sprites'
import { FRAME_TABLES } from './mascot-sprites.fixtures'
import { displayWidth } from './text-width'

// The frame tables, as text: every frame of a table one size, every glyph one cell, every overlay's ink known.

const INKS = new Set(['b', 'f', 'd', 'a', 'g', 'y', 'r', 'p', 'i', 'k'])

describe('frame tables', () => {
  test('every frame of a table has the same size, and every glyph is one cell', () => {
    expect(FRAME_TABLES.length).toBeGreaterThan(20)
    for (const table of FRAME_TABLES) {
      expect(table.frames.length, table.name).toBeGreaterThan(0)
      expect(table.width, table.name).toBeLessThanOrEqual(SLOT)
      for (const frame of table.frames) {
        expect(frame.length, table.name).toBe(table.height)
        for (const row of frame) {
          expect([...row].length, `${table.name}: "${row}"`).toBe(table.width)
          expect(displayWidth(row), `${table.name}: "${row}"`).toBe(table.width)
          for (const glyph of row) expect(displayWidth(glyph), `${table.name}: ${glyph}`).toBe(1)
        }
      }
    }
  })

  test('every overlay inks its glyphs with a known ink, and one of its own colour carries that colour', () => {
    for (const overlays of [OVERLAYS, MINI_OVERLAYS]) {
      for (const [name, frames] of Object.entries(overlays)) {
        for (const frame of frames) {
          expect(INKS.has(frame.ink), name).toBe(true)
          for (const ink of Object.values(frame.by ?? {})) expect(INKS.has(ink as string), name).toBe(true)
          if (frame.ink === 'k') expect(frame.colour, name).toMatch(/^#[0-9A-F]{6}$/)
        }
      }
    }
  })

  test('the figure is the welcome-screen figure, eyes open; every look keeps the head whole, the eyes only notches in its lower half', () => {
    expect([HEADS.open, TORSOS.rest, LEGS.stand].map(row => row.trimEnd())).toEqual([' ▐▛███▜▌', '▝▜█████▛▘', '  ▘▘ ▝▝'])
    for (const [name, head] of Object.entries(HEADS)) {
      expect([head[0], head[1], head[7], head[8]], name).toEqual([' ', '▐', '▌', ' '])
      // The top half of every cell between the sides filled: the outline whole, whatever the eyes do.
      for (const glyph of head.slice(2, 7)) expect('█▛▜▀', `${name}: ${glyph}`).toContain(glyph)
    }
    // Shut eyes are none; dizzy ones cross, then roll apart; flat on its back the head turns over, eyes against the body.
    expect(HEADS.shut).toBe(' ▐█████▌ ')
    expect([HEADS.spiral, HEADS.spin]).toEqual([' ▐█▜█▛█▌ ', ' ▐▜███▛▌ '])
    expect(flipped(HEADS.open)).toBe(' ▐▙███▟▌ ')
    // The mini is Clawd at half size: a head with its eyes over a body with arms and two legs.
    expect([MINI_HEADS.open, MINI_LEGS.stand]).toEqual([' ▛█▜ ', '▝▜▀▛▘'])
  })

  test('the sprite sheet: frames of a look all one size, 13 cells across (17 with a laptop or a big thought, 5 a mini), 4 to 8 rows', () => {
    const sheet = spriteSheet()
    expect(sheet.length).toBeGreaterThan(25)
    for (const { name, frames, cells } of sheet) {
      const [first] = frames
      expect(cells.length, name).toBe(frames.length)
      for (const frame of frames) {
        expect(frame.length, name).toBe(first?.length)
        expect(frame.length, name).toBeGreaterThanOrEqual(4)
        expect(frame.length, name).toBeLessThanOrEqual(8)
        for (const row of frame) {
          expect(displayWidth(row), name).toBe(displayWidth(first?.[0] ?? ''))
          expect([5, BOX, SLOT], name).toContain(displayWidth(row))
        }
      }
    }
    // The ground states 13 by 4; at the laptop 17 by 4; a hop and a flight 13 by 8.
    const size = (prefix: string) => {
      const one = sheet.find(entry => entry.name.startsWith(prefix))!

      return [displayWidth(one.frames[0]![0]!), one.frames[0]!.length]
    }
    expect(size('idle · look around')).toEqual([BOX, 4])
    expect(size('idle · sit')).toEqual([BOX, 4])
    expect(size('agent · at its laptop')).toEqual([SLOT, 4])
    expect(size('agent · hop')).toEqual([BOX, 8])
    expect(size('agent · flying')).toEqual([BOX, 8])
    expect(size('agent · thinking (')).toEqual([SLOT, 5])
  })
})

test('the editable thought pool uses single-width text and its bubbles fit the sky and the low-sky strip', () => {
  expect(THOUGHTS).toEqual(['hmm', 'hmmm…', 'lemme think', 'pondering', 'wait…', 'noodling', 'mulling it', 'brain go brr', 'cogitating', 'deep in it', 'ooh?', 'thinky thinky', 'one sec', 'plotting', 'hm hm hm'])
  expect(thoughtBubble('a thought longer than fourteen cells')).toBe('(a thought l…)')
  for (const [index, phrase] of THOUGHTS.entries()) {
    expect(phrase).toMatch(/^[\x20-\x7e…]+$/)
    expect(displayWidth(thoughtBubble(phrase))).toBeLessThanOrEqual(14)
    const frames = THOUGHT_FRAMES[index]!
    expect(frames).toHaveLength(8)
    expect(frames.map(one => one.art.filter(row => row.trim() !== '').length)).toEqual([1, 1, 2, 2, 3, 3, 3, 3])
    for (const frame of frames) for (const art of [frame.art, frame.lowArt!]) for (const row of art) expect(displayWidth(row)).toBe(SLOT)
  }
})
