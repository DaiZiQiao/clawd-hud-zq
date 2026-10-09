import { describe, expect, test } from 'claude-code/testing'

import { PIPE_BATCH_MS, PIPE_COLOUR, PIPE_DROP_MAX, PIPE_DROP_MS, PIPE_FAREWELL_MS, PIPE_SHINE, PIPE_SLIDE_MS, PIPE_WIDTH, batchPipeAt, droppedAt, farewellAt, pipeBatch, pipeCells, pipeHang } from './scene-pipe'

// The warp pipe: its art and its timeline, before the scene places them.

const luminance = (hex: string): number => {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
  const linear = channels.map(value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))

  return linear.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0)
}
const contrast = (a: string, b: string): number => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)

const text = (rows: ReturnType<typeof pipeCells>): string[] => rows.map(row => Array.from({ length: row.length }, (_, x) => row[x]?.ch ?? ' ').join(''))

describe('the pipe', () => {
  test('a red shaft down from the ceiling, its lip a cell wider each side and a row and a half deep, a lighter stripe down its left', () => {
    expect(text(pipeCells('full', 4))).toEqual([' ███████ ', ' ███████ ', '▄███████▄', '█████████'])
    expect(text(pipeCells('mini', 3))).toEqual([' ███ ', '▄███▄', '█████'])
    expect(text(pipeCells('full', 1))).toEqual(['█████████'])
    expect(pipeCells('full', 0)).toEqual([])
    for (const kind of ['full', 'mini'] as const) {
      const cells = pipeCells(kind, 5).flat().filter(cell => cell !== undefined)
      expect(cells.every(cell => cell?.ink === 'k')).toBe(true)
      expect(new Set(cells.map(cell => cell?.colour))).toEqual(new Set([PIPE_COLOUR, PIPE_SHINE]))
      // The stripe is one column, the same on the shaft and the lip.
      const stripe = new Set(pipeCells(kind, 5).flatMap(row => row.flatMap((cell, x) => (cell?.colour === PIPE_SHINE ? [x] : []))))
      expect(stripe.size).toBe(1)
      expect(pipeCells(kind, 5).every(row => row.length === PIPE_WIDTH[kind])).toBe(true)
    }
    for (const colour of [PIPE_COLOUR, PIPE_SHINE]) {
      for (const background of ['#282a36', '#eff1f5']) expect(contrast(colour, background), `${colour} on ${background}`).toBeGreaterThanOrEqual(3)
    }
  })

  test('it hangs a row over the box with up to three rows to fall, a row of shaft over it where the sky allows; with no sky, on the air row', () => {
    expect([0, 1, 2, 3, 4, 5, 12].map(sky => pipeHang(sky))).toEqual([
      { mouth: 0, drop: 0 },
      { mouth: 1, drop: 0 },
      { mouth: 1, drop: 0 },
      { mouth: 2, drop: 1 },
      { mouth: 3, drop: 2 },
      { mouth: 4, drop: PIPE_DROP_MAX },
      { mouth: 4, drop: PIPE_DROP_MAX },
    ])
  })

  test('a batch shares one pipe: each drops at its turn, never before it spawned or the pipe is down; the pipe goes up once the last is on its floor', () => {
    expect(PIPE_BATCH_MS).toBe(2000)
    // One alone: it drops once the pipe is down, and the pipe goes up once it is on its floor.
    expect(pipeBatch([0])).toEqual({ drops: [PIPE_SLIDE_MS], up: PIPE_SLIDE_MS + PIPE_DROP_MS })
    // Three at once: a drop's length apart.
    expect(pipeBatch([0, 0, 0])).toEqual({ drops: [500, 1000, 1500], up: 2000 })
    // One spawned late: it drops when it is there.
    expect(pipeBatch([0, 300, 1800])).toEqual({ drops: [500, 1000, 1800], up: 2300 })
    for (const sky of [0, 3, 8]) {
      const { mouth } = pipeHang(sky)
      // The shared pipe: down, held while the batch comes out, up.
      expect(batchPipeAt(-1, sky, 1500)).toBe(undefined)
      expect(batchPipeAt(PIPE_SLIDE_MS, sky, 1500)).toBe(mouth)
      expect(batchPipeAt(1499, sky, 1500)).toBe(mouth)
      expect(batchPipeAt(1500 + PIPE_SLIDE_MS, sky, 1500)).toBe(undefined)
      // Alone, frame by frame: out of sight at first and at last, never below where it hangs nor over the sky, higher every frame going back up.
      const solo = Array.from({ length: 32 }, (_, index) => batchPipeAt(index * 50, sky, PIPE_SLIDE_MS + PIPE_DROP_MS))
      expect([solo[0], solo.at(-1)]).toEqual([undefined, undefined])
      for (const at of solo) if (at !== undefined) expect(at, `${sky}`).toBeGreaterThanOrEqual(mouth - 1e-9)
      for (const at of solo) if (at !== undefined) expect(at, `${sky}`).toBeLessThanOrEqual(sky + 0.5)
      const leaving = solo.slice((PIPE_SLIDE_MS + PIPE_DROP_MS) / 50).map(at => at ?? Number.POSITIVE_INFINITY)
      leaving.forEach((at, index) => index > 0 && expect(at).toBeGreaterThanOrEqual(leaving[index - 1]!))
      // A member's fall: inside before its drop, then from the hang's drop down to the floor, ever faster.
      expect(droppedAt(-1, sky)).toMatchObject({ inside: true, u: 0 })
      const falls = [0, 100, 200, 300, 400, 500].map(ms => droppedAt(ms, sky))
      expect(falls.every(one => !one.inside)).toBe(true)
      expect(falls[0]?.lift).toBe(pipeHang(sky).drop)
      expect(falls.at(-1)).toMatchObject({ lift: 0, u: 1 })
      falls.forEach((one, index) => index > 1 && expect(falls[index - 1]!.lift - one.lift).toBeGreaterThanOrEqual(falls[index - 2]!.lift - falls[index - 1]!.lift - 1e-9))
    }
  })

  test('leaving, done: the pipe comes down over it, sucks it up feet last, and goes back up with it', () => {
    for (const sky of [0, 2, 6, 12]) {
      const { mouth } = pipeHang(sky)
      const frames = Array.from({ length: PIPE_FAREWELL_MS / 50 + 2 }, (_, index) => farewellAt(index * 50, sky))
      expect(frames[0]).toEqual({ lift: 0, inside: false })
      expect(farewellAt(PIPE_SLIDE_MS, sky)).toEqual({ mouth, lift: 0, inside: false })
      const rising = frames.slice(PIPE_SLIDE_MS / 50, (PIPE_FAREWELL_MS - PIPE_SLIDE_MS) / 50).map(frame => frame.lift)
      rising.forEach((lift, index) => index > 0 && expect(lift).toBeGreaterThan(rising[index - 1]!))
      // Its feet past the lip once sucked in; hidden from then on.
      expect(farewellAt(PIPE_FAREWELL_MS - PIPE_SLIDE_MS, sky)).toMatchObject({ lift: mouth + 4, inside: true })
      expect(frames.at(-1)).toEqual({ lift: mouth + 4, inside: true })
      expect(frames.at(-1)?.mouth).toBe(undefined)
    }
  })
})
