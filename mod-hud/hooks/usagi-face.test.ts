import { describe, expect, test } from 'claude-code/testing'

import { applyTo, translate } from './clawd-vector'
import type { Shape } from './clawd-vector'
import { BORED_MS, DROWSY_MS, agentLook, mainLook } from './mascot-poses'
import type { Look } from './mascot-poses'
import { BLANKET_AFTER_MS, idleBitOf } from './scene-phases'
import { working } from './scene-model.fixtures'
import { HAT_SEAT, figureShapes, usagiHatShapes, usagiMouthShapes } from './smooth-art'
import { NEUTRAL, fullTarget } from './smooth-pose'
import { usagiFigure } from './usagi-glyphs'
import { quirkPose } from './usagi-moves'
import { EARS, HATS, ROLE_HATS, USAGI } from './usagi-sprites'
import type { MascotRole } from './scene-types'

// Usagi's face as Chiikawa draws it: never squeezed shut `> <` (spirals in a
// burst, turning; crosses knocked flat), a wide open shout, and its lids half
// down bored, drowsy before its nap, unimpressed when it fails; and what it
// wears on its head, worn as a hat is.

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
    const spirals = (t: number): string => JSON.stringify(at(t).filter(shape => shape.kind === 'line' && shape.fill === USAGI.line && (shape.points?.length ?? 0) > 30))
    expect(spirals(0)).not.toBe('[]')
    expect(spirals(0)).not.toBe(spirals(150))
    const flat = figureShapes(fullTarget({ ...STAND, pose: 'flat', head: 'shut' }, CONTEXT), INFO, IDENTITY, 0)
    expect(dotsOf(flat)).toHaveLength(0)
    expect(flat.filter(shape => shape.kind === 'line' && shape.fill === USAGI.line && shape.points?.length === 2).length).toBeGreaterThanOrEqual(4)
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

  test('failed: unimpressed, hmph, under its cross, its ears lowered, not drooping (the cells\' as the shapes\'), a smug smile', () => {
    const failed = working('a', 'thinking', { status: 'failed' })
    const look = agentLook(failed, { kind: 'sit', step: 0 } as never, 0)
    expect(look.lids).toBe('hmph')
    const pose = fullTarget(look, CONTEXT)
    expect(pose.eyes).toBe('half')
    expect(pose.mouthShape).toBe('smirk')
    expect(pose.droop).toBe(0)
    expect(pose.earsDown).toBeGreaterThan(0.5)
    expect(usagiFigure(look, { energy: 0 }).bitmap.slice(0, 3)).toEqual([...EARS.short])
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

/** How far shapes reach, each through its own placement, a line's or an outline's width and all. */
const extentOf = (shapes: readonly Shape[]): { left: number; top: number; right: number; bottom: number } => {
  const extent = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  for (const shape of shapes) {
    const pad = shape.kind === 'line' ? (shape.stroke ?? 0) / 2 : (shape.grow ?? 0) + (shape.outline?.width ?? 0)
    const corners = shape.kind === 'poly' || shape.kind === 'line' ? [...(shape.points ?? [])] : [[shape.x, shape.y], [shape.x + shape.w, shape.y + shape.h], [shape.x, shape.y + shape.h], [shape.x + shape.w, shape.y]]
    for (const [x = 0, y = 0] of corners) {
      const [px, py] = applyTo(shape.m ?? IDENTITY, x, y)
      extent.left = Math.min(extent.left, px - pad)
      extent.top = Math.min(extent.top, py - pad)
      extent.right = Math.max(extent.right, px + pad)
      extent.bottom = Math.max(extent.bottom, py + pad)
    }
  }

  return extent
}

describe('what it wears', () => {
  const ROLES = Object.keys(ROLE_HATS) as MascotRole[]
  // Its brows: long lines in its line, from over its eyes out to its sides.
  const browsOf = (shapes: readonly Shape[]): Shape[] => shapes.filter(shape => shape.kind === 'line' && shape.fill === USAGI.line && (shape.points?.length ?? 0) === 15 && extentOf([shape]).right - extentOf([shape]).left > 2)

  test('each role\'s hat worn as a hat is: outlined in its line, over its head\'s top and wider than it there, down to just over its brows (a little lower under it)', () => {
    const bare = figureShapes(NEUTRAL, INFO, IDENTITY, 0)
    for (const role of ROLES) {
      const name = ROLE_HATS[role]
      const hat = usagiHatShapes(translate(0, HAT_SEAT), name)
      expect(hat.some(shape => shape.fill === HATS[name].colour && shape.outline?.fill === USAGI.line), name).toBe(true)
      const worn = extentOf(hat)
      // Its head's top (and its line over it) inside the hat; the hat as wide as its head is where it sits.
      expect(worn.top, name).toBeLessThan(-12.7 - 0.45)
      expect(worn.right - worn.left, name).toBeGreaterThan(8.5)
      const shapes = figureShapes(NEUTRAL, { ...INFO, role }, IDENTITY, 0)
      const brows = extentOf(browsOf(shapes))
      expect(browsOf(shapes), name).toHaveLength(2)
      // Over its face (not the mortarboard's tassel hanging by its side), all over its brows.
      const overFace = extentOf(hat.filter(shape => extentOf([shape]).left < 4.5))
      expect(overFace.bottom, name).toBeLessThan(brows.top)
      expect(brows.top, name).toBeGreaterThan(extentOf(browsOf(bare)).top)
      // A soft shade on its forehead under it.
      expect(shapes.some(shape => shape.kind === 'poly' && shape.fill === USAGI.line && (shape.alpha ?? 1) < 0.2), name).toBe(true)
    }
  })

  test('its ears up through holes in it: drawn over the hat, from its top to their tips, standing; leaning as it walks, from where they come through', () => {
    for (const role of ROLES) {
      const shapes = figureShapes(NEUTRAL, { ...INFO, role }, IDENTITY, 0)
      const last = shapes.reduce((at, shape, index) => (shape.fill === HATS[ROLE_HATS[role]].colour ? index : at), -1)
      const ears = shapes.filter((shape, index) => index > last && shape.kind === 'poly' && shape.fill === USAGI.cream)
      expect(ears, role).toHaveLength(2)
      for (const ear of ears) {
        const reach = extentOf([ear])
        expect(reach.top, role).toBeLessThan(-18.9)
        expect(reach.bottom, role).toBeLessThan(-12.7)
      }
      // No ear of its own under the hat: the head's silhouette has none.
      expect(shapes.filter(shape => shape.kind === 'rect' && shape.fill === USAGI.ear).length, role).toBe(2)
    }
    const walking = figureShapes({ ...NEUTRAL, trail: 1.4 }, { ...INFO, role: 'worker' }, IDENTITY, 0).filter(shape => shape.kind === 'poly' && shape.fill === USAGI.cream)
    const standing = figureShapes(NEUTRAL, { ...INFO, role: 'worker' }, IDENTITY, 0).filter(shape => shape.kind === 'poly' && shape.fill === USAGI.cream)
    // Leaning, the tips go aside; their feet stay in the holes.
    expect(extentOf(walking).right).toBeGreaterThan(extentOf(standing).right + 1.5)
    expect(Math.abs(extentOf(walking).bottom - extentOf(standing).bottom)).toBeLessThan(0.6)
  })

  test('the session\'s crown outlined on the left of its head; knocked flat, the hat on the floor beside it, its ear holes empty', () => {
    const crowned = figureShapes(NEUTRAL, { ...INFO, crown: true }, IDENTITY, 0)
    const gold = crowned.filter(shape => shape.fill === '#A6801F')
    expect(gold.some(shape => shape.outline?.fill === USAGI.line)).toBe(true)
    const crown = extentOf(gold)
    expect((crown.left + crown.right) / 2).toBeLessThan(-1.5)
    expect(crown.bottom).toBeGreaterThan(-12.7)
    const down = figureShapes({ ...NEUTRAL, flat: 1, hatOff: true }, { ...INFO, role: 'explorer' }, IDENTITY, 0)
    const lying = extentOf(down.filter(shape => shape.fill === HATS.fedora.colour))
    expect(lying.left).toBeGreaterThan(4)
    expect(lying.bottom).toBeGreaterThan(-1)
    expect(down.filter(shape => shape.kind === 'ellipse' && shape.fill === USAGI.line && (shape.alpha ?? 1) > 0.5 && shape.h < 1)).toHaveLength(2)
  })
})
