import { describe, expect, test } from 'claude-code/testing'

import type { Shape } from './clawd-vector'
import { BORED_MS, DROWSY_MS, agentLook, mainLook } from './mascot-poses'
import type { Look } from './mascot-poses'
import { BLANKET_AFTER_MS, idleBitOf } from './scene-phases'
import { working } from './scene-model.fixtures'
import { figureShapes, usagiMouthShapes } from './smooth-art'
import { NEUTRAL, fullTarget } from './smooth-pose'
import { usagiFigure } from './usagi-glyphs'
import { quirkPose } from './usagi-moves'
import { USAGI } from './usagi-sprites'

// Usagi's face as Chiikawa draws it: never squeezed shut `> <` (spirals in a
// burst, turning; crosses knocked flat), a wide open shout, and its lids half
// down bored, drowsy before its nap, unimpressed when it fails.

const INFO = { character: 'usagi' as const, colour: USAGI.body, energy: 0 as const }
const STAND: Look = { head: 'open', arms: 'rest', legs: 'stand', pose: 'stand', overlays: [], lift: 0 }
const CONTEXT = { character: 'usagi' as const, now: 0, seed: 0.3, mini: false }
const IDENTITY = [1, 0, 0, 1, 0, 0] as const

/** Shapes in its eyes' colour: its dots (and lids). */
const dotsOf = (shapes: readonly Shape[]): Shape[] => shapes.filter(shape => shape.fill === USAGI.eye)

describe('its eyes in a burst', () => {
  test('never squeezed shut: spirals in its line, turning; knocked flat, crosses; at rest its dots', () => {
    const burst = quirkPose(NEUTRAL, { kind: 'yaha', at: 640 }, 'right')
    expect(burst.eyes).toBe('squeeze')
    const at = (t: number): Shape[] => figureShapes({ ...burst, beside: [] }, INFO, IDENTITY, t)
    expect(dotsOf(at(0))).toHaveLength(0)
    const spirals = (t: number): string => JSON.stringify(at(t).filter(shape => shape.kind === 'poly' && shape.fill === USAGI.line && (shape.points?.length ?? 0) > 60))
    expect(spirals(0)).not.toBe('[]')
    expect(spirals(0)).not.toBe(spirals(150))
    const flat = figureShapes(fullTarget({ ...STAND, pose: 'flat', head: 'shut' }, CONTEXT), INFO, IDENTITY, 0)
    expect(dotsOf(flat)).toHaveLength(0)
    expect(flat.filter(shape => shape.kind === 'poly' && shape.fill === USAGI.line && shape.points?.length === 4).length).toBeGreaterThanOrEqual(4)
    expect(dotsOf(figureShapes(NEUTRAL, INFO, IDENTITY, 0))).toHaveLength(2)
  })

  test('its shout: a D on its back, wider than tall, outlined, its tongue in it', () => {
    const shout = usagiMouthShapes(IDENTITY, 'scream', 1)
    const mouth = shout.find(shape => shape.kind === 'poly' && shape.fill === USAGI.mouth)
    const xs = (mouth?.points ?? []).map(([x]) => x)
    const ys = (mouth?.points ?? []).map(([, y]) => y)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(Math.max(...ys) - Math.min(...ys))
    expect(shout.some(shape => shape.kind === 'poly' && shape.fill === USAGI.line)).toBe(true)
    expect(shout.some(shape => shape.kind === 'ellipse' && shape.fill === USAGI.blush)).toBe(true)
  })
})

describe('its lids', () => {
  test('idle: up at first, down bored a while on, drowsy the last seconds before its nap, as it looks about or sits', () => {
    const lids = new Map<string, Look['lids']>()
    let drowsy = 0
    for (let idleMs = 0; idleMs < BLANKET_AFTER_MS; idleMs += 500) {
      const bit = idleBitOf('main', idleMs)
      if (bit !== 'look' && bit !== 'sit') continue
      const look = mainLook({ mood: 'idle', idleMs, sweating: false }, 0)
      lids.set(String(idleMs), look.lids)
      if (idleMs < BORED_MS) expect(look.lids, `${idleMs}`).toBe(undefined)
      else if (idleMs < BLANKET_AFTER_MS - DROWSY_MS) expect(look.lids, `${idleMs}`).toBe('bored')
      else {
        expect(look.lids, `${idleMs}`).toBe('drowsy')
        drowsy += 1
      }
    }
    expect([...lids.values()]).toContain('bored')
    expect(drowsy).toBeGreaterThan(0)
  })

  test('failed: unimpressed, hmph, under its cross, its ears up, a smug smile', () => {
    const failed = working('a', 'thinking', { status: 'failed' })
    const look = agentLook(failed, { kind: 'sit', step: 0 } as never, 0)
    expect(look.lids).toBe('hmph')
    const pose = fullTarget(look, CONTEXT)
    expect(pose.eyes).toBe('half')
    expect(pose.mouthShape).toBe('smirk')
    expect(pose.droop).toBe(0)
  })

  test('drawn half lidded smooth (Usagi alone; Clawd keeps its own eyes), and in its cells its eyes low', () => {
    for (const lids of ['bored', 'drowsy', 'hmph'] as const) {
      expect(fullTarget({ ...STAND, lids }, CONTEXT).eyes).toBe('half')
      expect(fullTarget({ ...STAND, lids }, { ...CONTEXT, character: 'clawd' }).eyes).toBe('normal')
      const rows = usagiFigure({ ...STAND, lids }, { energy: 0 }).bitmap
      expect(rows[4]?.includes('K'), lids).toBe(false)
      expect(rows[5]?.includes('K'), lids).toBe(true)
    }
  })
})
