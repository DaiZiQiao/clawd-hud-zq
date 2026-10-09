import { describe, expect, test } from 'claude-code/testing'

import { NEUTRAL, createSmoother } from './smooth-pose'

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
