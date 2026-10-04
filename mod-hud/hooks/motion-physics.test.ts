import { describe, expect, test } from 'claude-code/testing'

import {
  CLICK_MS,
  GRAVITY,
  KNOCKOUT_SPEED,
  MAX_SPEED,
  RESTITUTION,
  SOFT_SPEED,
  airContact,
  cooled,
  descentContact,
  hitsAlong,
  isClick,
  landingOf,
  meets,
  released,
  step,
  swept,
  velocityOf,
} from './motion-physics'
import type { Body, Landing, Stepped } from './motion-physics'

// The scene's physics: pure functions of a body, the room and a fixed step.

const DT = 0.05
const ROOM = { minX: 0, maxX: 60, maxLift: 14 }

/** A body stepped until it settles (or `limit` steps): every step, and how it landed. */
const flight = (body: Body, limit = 400): { steps: Stepped[]; landings: Landing[] } => {
  const steps: Stepped[] = []
  const landings: Landing[] = []
  let current = body
  for (let index = 0; index < limit; index += 1) {
    const one = step(current, DT)
    steps.push(one)
    if (one.landed !== undefined) landings.push(one.landed)
    current = one.body
    if (one.resting) break
  }

  return { steps, landings }
}

describe('a thrown body', () => {
  test('follows an arc: up, a peak, down, a little drag; across at nearly its speed; every step a small one', () => {
    const { steps } = flight(released(10, 0.5, 8, 12, ROOM))
    const lifts = steps.map(one => one.body.lift)
    const peak = lifts.indexOf(Math.max(...lifts))
    // Rising to one peak, then falling: never back up before the floor.
    expect(peak).toBeGreaterThan(0)
    for (let index = 1; index <= peak; index += 1) expect(lifts[index]!).toBeGreaterThanOrEqual(lifts[index - 1]!)
    const floor = steps.findIndex(one => one.impacts.some(impact => impact.kind === 'floor'))
    for (let index = peak + 1; index <= floor; index += 1) expect(lifts[index]!).toBeLessThanOrEqual(lifts[index - 1]!)
    // The peak of v²/2g, a little under it for the drag.
    expect(Math.max(...lifts)).toBeLessThan(0.5 + (12 * 12) / (2 * GRAVITY))
    expect(Math.max(...lifts)).toBeGreaterThan(0.5 + (12 * 12) / (2 * GRAVITY) - 0.8)
    // Across: never faster than thrown, each step a fraction of a cell.
    steps.forEach((one, index) => {
      const before = index === 0 ? 10 : steps[index - 1]!.body.x
      expect(Math.abs(one.body.x - before)).toBeLessThanOrEqual(8 * DT + 1e-9)
    })
  })

  test('the same throw, the same flight, step for step', () => {
    const once = flight(released(3, 6, -21, 4, ROOM)).steps.map(one => one.body)
    const twice = flight(released(3, 6, -21, 4, ROOM)).steps.map(one => one.body)
    expect(twice).toEqual(once)
  })

  test('a throw is never faster than MAX_SPEED and never leaves the room', () => {
    const body = released(-5, 40, 500, -500, ROOM)
    expect([body.x, body.lift, body.vx, body.vy]).toEqual([0, 14, MAX_SPEED, -MAX_SPEED])
    for (const one of flight(body).steps) {
      expect(one.body.x).toBeGreaterThanOrEqual(0)
      expect(one.body.x).toBeLessThanOrEqual(60)
      expect(one.body.lift).toBeGreaterThanOrEqual(0)
      expect(one.body.lift).toBeLessThanOrEqual(14)
    }
  })
})

describe('landings', () => {
  test('thresholds: under 8 soft, from 8 a bounce, from 16 knocked out; a drop under 3 rows is set down', () => {
    expect(SOFT_SPEED).toBe(8)
    expect(KNOCKOUT_SPEED).toBe(16)
    expect(landingOf(7.99, 10)).toBe('soft')
    expect(landingOf(8, 3)).toBe('bounce')
    expect(landingOf(12, 2.99)).toBe('soft')
    expect(landingOf(15.99, 12)).toBe('bounce')
    expect(landingOf(16, 0)).toBe('knockout')
  })

  test('a gentle drop (under three rows) is set down: no bounce, no wobble', () => {
    const { landings, steps } = flight(released(20, 2.5, 0, 0, ROOM))
    expect(landings).toEqual(['soft'])
    expect(steps.at(-1)?.body.bounced).toBe(undefined)
    expect(steps.at(-1)?.body.lift).toBe(0)
  })

  test('from three rows or more it bounces at 0.4 of its speed, then settles with a wobble to come', () => {
    const { landings, steps } = flight(released(20, 3.6, 0, 0, ROOM))
    const floor = steps.filter(one => one.impacts.some(impact => impact.kind === 'floor'))
    expect(floor.length).toBeGreaterThanOrEqual(2)
    const first = floor[0]!
    const into = first.impacts.find(impact => impact.kind === 'floor')!.speed
    expect(into).toBeGreaterThanOrEqual(SOFT_SPEED)
    expect(into).toBeLessThan(KNOCKOUT_SPEED)
    expect(Math.abs(first.body.vy - into * RESTITUTION)).toBeLessThan(1e-9)
    expect(landings.at(-1)).toBe('soft')
    expect(steps.at(-1)?.body.bounced).toBe(true)
  })

  test('dropped from high, or thrown down hard, it is knocked out where it lands', () => {
    expect(flight(released(20, 6, 0, 0, ROOM)).landings).toEqual(['knockout'])
    expect(flight(released(20, 1, 0, -17, ROOM)).landings).toEqual(['knockout'])
    const out = flight(released(20, 6, 0, 0, ROOM)).steps.at(-1)!.body
    expect([out.lift, out.vx, out.vy]).toEqual([0, 0, 0])
  })

  test('into a wall under 16 it bounces back at 0.4; at 16 or more it is knocked out and drops', () => {
    const soft = flight(released(55, 4, 12, 0, ROOM)).steps
    const hit = soft.find(one => one.impacts.some(impact => impact.kind === 'wall'))!
    expect(hit.body.x).toBe(60)
    expect(hit.body.vx).toBeLessThan(0)
    expect(hit.body.out).toBe(undefined)
    const hard = flight(released(55, 4, 30, 0, ROOM))
    const wall = hard.steps.find(one => one.impacts.some(impact => impact.kind === 'wall'))!
    expect(wall.body.out).toBe(true)
    expect(wall.body.vx).toBe(0)
    expect(hard.landings).toEqual(['knockout'])
  })

  test('sliding along the floor, friction stops it', () => {
    const { steps } = flight(released(10, 0, 9, 0, ROOM))
    expect(steps.at(-1)?.resting).toBe(true)
    expect(steps.at(-1)?.body.x).toBeGreaterThan(10)
    expect(steps.at(-1)?.body.x).toBeLessThan(13)
  })
})

describe('the pointer', () => {
  test('a release takes the velocity of the last ~100 ms, cells and rows a second', () => {
    const samples = [{ ms: 0, x: 0, y: 10 }, { ms: 50, x: 1, y: 10 }, { ms: 100, x: 3, y: 9 }, { ms: 150, x: 5, y: 8 }, { ms: 200, x: 7, y: 7 }]
    // The last 100 ms: from (3, 9) at 100 to (7, 7) at 200.
    expect(velocityOf(samples, 200, 50)).toEqual({ vx: 40, vy: -20 })
    // A flick faster than MAX_SPEED is capped.
    expect(velocityOf([{ ms: 0, x: 0, y: 0 }, { ms: 50, x: 9, y: 0 }], 50, 50)).toEqual({ vx: MAX_SPEED, vy: 0 })
    // Held still a while: no throw.
    expect(velocityOf([{ ms: 0, x: 4, y: 4 }, { ms: 400, x: 4, y: 4 }], 400, 50)).toEqual({ vx: 0, vy: 0 })
    // All in one frame: the span is a frame at least.
    expect(velocityOf([{ ms: 50, x: 0, y: 0 }, { ms: 50, x: 2, y: 0 }], 50, 50)).toEqual({ vx: 40, vy: 0 })
  })

  test('a click is up within 300 ms, less than a cell from where it went down', () => {
    expect(CLICK_MS).toBe(300)
    expect(isClick(0, 299, 0.5, 0.5)).toBe(true)
    expect(isClick(0, 300, 0, 0)).toBe(false)
    expect(isClick(0, 100, 1, 0)).toBe(false)
    expect(isClick(0, 100, 0.6, 0.8)).toBe(false)
  })
})

describe('bodies meeting', () => {
  test('bowling: every target the sweep passes through within a row is hit, in order, the rest not', () => {
    const from = { x: 50, width: 9, top: 5, height: 3 }
    const to = { x: 10, width: 9, top: 6, height: 3 }
    const targets = [
      { id: 'near', rect: { x: 40, width: 9, top: 6, height: 3 } },
      { id: 'far', rect: { x: 20, width: 9, top: 6, height: 3 } },
      { id: 'a-row-below', rect: { x: 30, width: 9, top: 9, height: 3 } },
      { id: 'two-rows-below', rect: { x: 30, width: 9, top: 10, height: 3 } },
      { id: 'behind', rect: { x: 62, width: 9, top: 6, height: 3 } },
    ]
    expect(hitsAlong(from, to, targets)).toEqual(['near', 'far', 'a-row-below'])
    expect(swept(from, to)).toEqual({ x: 10, width: 49, top: 5, height: 4 })
    expect(meets({ x: 0, width: 5, top: 0, height: 3 }, { x: 5, width: 5, top: 0, height: 3 })).toBe(false)
  })

  test('a hop rising into a flier from below bonks; coming down onto one rides it; apart, nothing', () => {
    const flier = { x: 20, width: 9, lift: 6, vy: 0 }
    expect(airContact({ x: 22, width: 9, lift: 3, vy: 5 }, flier)).toBe('bonk')
    expect(airContact({ x: 22, width: 9, lift: 9, vy: -5 }, flier)).toBe('ride')
    expect(airContact({ x: 22, width: 9, lift: 1, vy: 5 }, flier)).toBe(undefined)
    expect(airContact({ x: 40, width: 9, lift: 3, vy: 5 }, flier)).toBe(undefined)
    expect(airContact({ x: 22, width: 9, lift: 3, vy: -5 }, flier)).toBe(undefined)
  })

  test('a flier coming down onto one standing: at two rows or under, overlapping across', () => {
    expect(descentContact({ x: 10, width: 9, lift: 2, vy: -1 }, { x: 15, width: 9 })).toBe(true)
    expect(descentContact({ x: 10, width: 9, lift: 3, vy: -1 }, { x: 15, width: 9 })).toBe(false)
    expect(descentContact({ x: 10, width: 9, lift: 2, vy: 1 }, { x: 15, width: 9 })).toBe(false)
    expect(descentContact({ x: 10, width: 9, lift: 2, vy: -1 }, { x: 19, width: 9 })).toBe(false)
  })

  test('a pair meets again only past its cooldown', () => {
    expect(cooled(undefined, 1000, 30_000)).toBe(true)
    expect(cooled(1000, 30_999, 30_000)).toBe(false)
    expect(cooled(1000, 31_000, 30_000)).toBe(true)
  })
})
