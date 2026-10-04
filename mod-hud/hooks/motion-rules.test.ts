import { describe, expect, test } from 'claude-code/testing'

import { frameAt } from './motion-rules'

// The motion rules that stand alone: frames keyed by elapsed time.

describe('frames', () => {
  test('sprite frames are keyed by elapsed time', () => {
    expect(frameAt(999)).toBe(3)
    expect(frameAt(1000)).toBe(4)
  })
})
