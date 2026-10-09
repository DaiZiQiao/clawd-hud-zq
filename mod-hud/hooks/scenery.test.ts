import { describe, expect, test } from 'claude-code/testing'

import type { Shape } from './clawd-vector'
import { smoothSvg } from './scene-smooth'
import { STAY_MS, sceneryOf } from './scenery'

// The world tour behind the smooth scene (hooks/scenery.ts): where it is at
// any moment, the stop's name as it arrives, the pan to the next, its
// weather, and its room in the desktop's drawing.

/** The start of a leg: the tour has just come to a stop. */
const LEG = Math.ceil(1_700_000_000_000 / (STAY_MS + 7000)) * (STAY_MS + 7000)

const captionOf = (now: number, width = 240): string | undefined => sceneryOf(width, 24, 20, now).land.moving.find(shape => shape.kind === 'text')?.text

describe('the tour', () => {
  test('a function of the time alone: the band and a pane of another size are at the same stop', () => {
    expect(JSON.stringify(sceneryOf(240, 24, 20, LEG + 3000))).toBe(JSON.stringify(sceneryOf(240, 24, 20, LEG + 3000)))
    expect(captionOf(LEG + 3000)).toBe(captionOf(LEG + 3000, 150))
    expect(captionOf(LEG + 3000)).toMatch(/^[A-Z ]+ · [A-Z ]+$/)
  })

  test('the stop\'s name fades in after it arrives and out ten seconds on; each stop its own', () => {
    expect(captionOf(LEG + 100)).toBeUndefined()
    expect(captionOf(LEG + 5000)).toBeDefined()
    expect(captionOf(LEG + 20_000)).toBeUndefined()
    const names = new Set(Array.from({ length: 17 }, (_, leg) => captionOf(LEG + leg * (STAY_MS + 7000) + 5000)))
    expect(names.size).toBe(17)
  })

  test('it stays, then pans on to the next stop: the leg\'s strip kept, seen from further along each frame', () => {
    const stay = sceneryOf(240, 24, 20, LEG + 10_000).land
    expect([stay.shift, stay.span]).toEqual([0, 240])
    // Through the pan's seven seconds, to the last millisecond before the next stay.
    const shifts = Array.from({ length: 8 }, (_, step) => sceneryOf(240, 24, 20, LEG + STAY_MS + 1 + step * 999.8).land)
    expect(new Set(shifts.map(one => one.key)).size).toBe(1)
    for (let step = 1; step < shifts.length; step += 1) expect(shifts[step]!.shift).toBeGreaterThan(shifts[step - 1]!.shift)
    expect(Math.abs(shifts[shifts.length - 1]!.shift - (shifts[0]!.span - 240))).toBeLessThan(0.1)
    // No name while it pans.
    expect(shifts.every(one => !one.moving.some(shape => shape.kind === 'text'))).toBe(true)
  })

  test('its weather: somewhere snow falls, somewhere petals, leaves or rain; motes in front of the mascots too', () => {
    const fills = new Set<string>()
    let front = 0
    for (let leg = 0; leg < 17; leg += 1) {
      const scenery = sceneryOf(240, 24, 20, LEG + leg * (STAY_MS + 7000) + 20_000)
      for (const shape of [...scenery.land.moving, ...scenery.front]) fills.add(shape.fill)
      front += scenery.front.length
    }
    for (const fill of ['#ffffff', '#f8bcd4', '#b8c8dc']) expect(fills).toContain(fill)
    expect(front).toBeGreaterThan(0)
  })
})

describe('on the desktop', () => {
  test('the scenery takes what room the mascots leave: never a mascot for it; short of room, the ground\'s texture goes first, then all of it', () => {
    const scenery = sceneryOf(240, 24, 20, LEG + 20_000)
    const mascot = (size: number): Shape[] => Array.from({ length: size }, (_, index) => ({ kind: 'ellipse', x: index % 200, y: 10, w: 1.3, h: 1.1, fill: '#D77757' }))
    const svg = (shapes: Shape[]) => smoothSvg({ shapes, wholes: [[0, shapes.length]], width: 240, height: 24, still: false, scenery }, 120, 6, 90_000).source
    const roomy = svg(mascot(10))
    expect(roomy).toContain('linearGradient')
    // A crowd that leaves little room: every mascot drawn, the scenery thinner or gone.
    const crowd = svg(mascot(900))
    expect((crowd.match(/fill='#D77757'/g) ?? []).length).toBe(900)
    expect(crowd.length).toBeLessThan(90_000)
    expect(crowd.length).toBeLessThan(roomy.length + 900 * 90)
  })
})
