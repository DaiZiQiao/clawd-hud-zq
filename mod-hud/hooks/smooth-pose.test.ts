import { describe, expect, test } from 'claude-code/testing'

import { KEY_MS, NEUTRAL, createSmoother, livelyOf, strokeAt } from './smooth-pose'

// The smooth scene's poses eased from frame to frame (hooks/smooth-pose.ts).

describe('easing between frames', () => {
  test('the same moment drawn again keeps the pose it has (a surface redrawing the frame its clock drew); a frame on it eases on; back in time, the target', () => {
    const smoother = createSmoother()
    const squashed = { ...NEUTRAL, sx: 1.2, sy: 0.7 }
    smoother.ease('a', NEUTRAL, 1000)
    const first = smoother.ease('a', squashed, 1033)
    // On its way, not there yet.
    expect(first.sy).toBeLessThan(1)
    expect(first.sy).toBeGreaterThan(0.7)
    expect(smoother.ease('a', squashed, 1033)).toEqual(first)
    expect(smoother.ease('a', squashed, 1066).sy).toBeLessThan(first.sy)
    expect(smoother.ease('a', NEUTRAL, 900)).toEqual(NEUTRAL)
  })
})

describe('typing', () => {
  test('a typing hand strikes a key every other stroke\'s time, now and then two running, and rests a burst in five or so; its own rhythm, the same at any frame rate', () => {
    const strokes = (seed: number) => Array.from({ length: 400 }, (_, slot) => strokeAt(slot * KEY_MS, seed))
    const one = strokes(1.3)
    const down = one.filter(key => key === 1).length / one.length
    expect(down).toBeGreaterThan(0.35)
    expect(down).toBeLessThan(0.65)
    // A rest: eight strokes' time with the hand up.
    expect(one.join('')).toMatch(/0{8}/)
    // Two running, now and then.
    expect(one.join('')).toMatch(/11/)
    expect(strokes(4.2)).not.toEqual(one)
    // Within a stroke's time, the same at any moment.
    for (const t of [0, 40, 80, 124]) expect(strokeAt(1000 * KEY_MS + t, 1.3)).toBe(strokeAt(1000 * KEY_MS, 1.3))
  })

  test('at its laptop typing, the near hand reaches the keys and comes down on each stroke; without the laptop, or not typing, its arms are its own', () => {
    const at = (key: number, seed = 1.3): number => {
      for (let slot = 0; ; slot += 1) if (strokeAt(slot * KEY_MS, seed) === key) return slot * KEY_MS
    }
    const typing = { ...NEUTRAL, laptop: 1, typing: 1.3 }
    const context = { character: 'clawd' as const, seed: 1.3, calm: true }
    const pressed = livelyOf(typing, { ...context, now: at(1) }, false)
    const lifted = livelyOf(typing, { ...context, now: at(0) }, false)
    expect([pressed.reach, lifted.reach]).toEqual([0.6, 0.6])
    expect(pressed.armR).toBeLessThan(lifted.armR)
    expect(lifted.armL).toBeGreaterThan(pressed.armL)
    for (const pose of [{ ...NEUTRAL, typing: 1.3 }, { ...NEUTRAL, laptop: 1 }]) {
      const still = livelyOf(pose, { ...context, now: at(1) }, false)
      expect([still.reach, still.armR, still.armL]).toEqual([0, 0, 0])
    }
  })
})
