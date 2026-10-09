import { describe, expect, test } from 'claude-code/testing'

import type { Look } from './mascot-poses'
import { OVERLAYS } from './mascot-sprites'
import { sceneFromInputs } from './scene-model'
import { SCENE_FRAME_MS } from './scene-phases'
import { placedSprites } from './scene-placement'
import { mascotPlan } from './scene-plan'
import { T0, room, run, wanderers } from './scene-plan.fixtures'
import { smoothFrame } from './scene-smooth'
import type { MascotScene } from './scene-types'
import { inputs } from './scene-world.fixtures'
import { figureShapes } from './smooth-art'
import { NEUTRAL, createSmoother, targetOf } from './smooth-pose'
import { earTwitch, quirkPose } from './usagi-moves'
import { QUIRK_MS, QUIRK_SAYS, QUIRK_WINDOW_MS, quirkAt, quirkLook, quirkPlaceOf } from './usagi-quirks'
import type { QuirkKind } from './usagi-quirks'
import { QUIRK_SHOUTS, USAGI } from './usagi-sprites'

// Usagi's chaos: its quirks out of nowhere (which, when, how long, where it
// may), as the cells draw them and as the shapes do; its toddle and its far
// bounds; its ears' twitches.

const STAND: Look = { head: 'open', arms: 'rest', legs: 'stand', pose: 'stand', overlays: [], lift: 0 }
const INFO = { character: 'usagi' as const, colour: USAGI.body, energy: 0 as const }

/** The quirks Usagi `id` goes through over `ms`, sampled every 50 ms: each kind and how long it was seen. */
const quirksOver = (id: string, ms: number, place: 'free' | 'desk'): Map<QuirkKind, number> => {
  const seen = new Map<QuirkKind, number>()
  for (let t = 0; t < ms; t += 50) {
    const quirk = quirkAt(id, 1_000_000 + t, place)
    if (quirk !== undefined) seen.set(quirk.kind, (seen.get(quirk.kind) ?? 0) + 50)
  }

  return seen
}

describe('its quirks', () => {
  test('out of nowhere: most five-second windows bring one, each its own length; every kind turns up; at its laptop only what it can do there', () => {
    const windows = 120
    const free = quirksOver('u1', windows * QUIRK_WINDOW_MS, 'free')
    expect([...free.keys()].sort()).toEqual(['flip', 'fuun', 'huh', 'shake', 'twirl', 'ura', 'yaha'])
    const busy = [...free.values()].reduce((sum, ms) => sum + ms, 0)
    // Three windows in four, each a second or two: between a tenth and two fifths of the time.
    expect(busy).toBeGreaterThan(windows * QUIRK_WINDOW_MS * 0.1)
    expect(busy).toBeLessThan(windows * QUIRK_WINDOW_MS * 0.4)
    const desk = quirksOver('u1', windows * QUIRK_WINDOW_MS, 'desk')
    expect([...desk.keys()].every(kind => ['bash', 'huh', 'shake', 'yaha'].includes(kind))).toBe(true)
    expect(desk.has('bash')).toBe(true)
  })

  test('the same id and time, the same quirk, `at` counting up through it; two Usagis keep times of their own', () => {
    let first: number | undefined
    for (let t = 0; t < 3 * QUIRK_WINDOW_MS && first === undefined; t += 10) if (quirkAt('u1', t, 'free') !== undefined) first = t
    expect(first).toBeDefined()
    const one = quirkAt('u1', first!, 'free')!
    expect(quirkAt('u1', first!, 'free')).toEqual(one)
    expect(quirkAt('u1', first! + 100, 'free')).toEqual({ kind: one.kind, at: one.at + 100 })
    expect(quirkAt('u1', first! + QUIRK_MS[one.kind] + 10, 'free')).toBe(undefined)
    const together = Array.from({ length: 600 }, (_, index) => 1_000_000 + index * 50).filter(t => quirkAt('u1', t, 'free') !== undefined && quirkAt('u2', t, 'free') !== undefined)
    expect(together.length).toBeLessThan(600 / 4)
  })

  test('only standing on its floor with nothing beside it but sweat: free, or at its laptop; never thinking, asking, sitting, down, asleep or arms up', () => {
    expect(quirkPlaceOf(STAND)).toBe('free')
    expect(quirkPlaceOf({ ...STAND, overlays: [OVERLAYS.sweat[0]!] })).toBe('free')
    expect(quirkPlaceOf({ ...STAND, desk: true, reach: true })).toBe('desk')
    expect(quirkPlaceOf({ ...STAND, overlays: [OVERLAYS.ask[0]!], arms: 'raised' })).toBe(undefined)
    expect(quirkPlaceOf({ ...STAND, overlays: [OVERLAYS.zzz[0]!] })).toBe(undefined)
    for (const pose of ['sit', 'crouch', 'squash', 'flat', 'blanket'] as const) expect(quirkPlaceOf({ ...STAND, pose })).toBe(undefined)
    expect(quirkPlaceOf({ ...STAND, armsUp: true, arms: 'up' })).toBe(undefined)
    expect(quirkPlaceOf({ ...STAND, lift: 2 })).toBe(undefined)
  })

  test('in cells: each its line over its head and its own frames; the dance and the shake sway a cell either way; at the laptop its laptop stays', () => {
    for (const kind of Object.keys(QUIRK_MS) as QuirkKind[]) {
      const look = quirkLook(kind === 'bash' ? { ...STAND, desk: true, reach: true } : STAND, { kind, at: 300 })
      expect(look.overlays).toContain(QUIRK_SHOUTS[QUIRK_SAYS[kind]]!)
    }
    const dance = [0, 250, 500].map(at => quirkLook(STAND, { kind: 'yaha', at }))
    expect(dance.map(one => one.nudge)).toEqual([-1, 1, -1])
    expect(dance.every(one => one.armsUp === true)).toBe(true)
    expect(quirkLook({ ...STAND, desk: true }, { kind: 'bash', at: 0 }).desk).toBe(true)
    expect(quirkLook(STAND, { kind: 'ura', at: 0 }).pose).toBe('squash')
    expect(quirkLook(STAND, { kind: 'ura', at: 500 }).bob).toBe(true)
  })

  test('with little sky over its box (the band above the prompt has a row), only what stays in the room: no leap, backflip, lean-in, dance or twirl', () => {
    const kinds = (sky: number): Set<string> => {
      const seen = new Set<string>()
      for (let t = 0; t < 400 * QUIRK_WINDOW_MS; t += 250) {
        const quirk = quirkAt('u1', t, 'free', sky)
        if (quirk !== undefined) seen.add(quirk.kind)
      }

      return seen
    }
    expect([...kinds(1)].sort()).toEqual(['fuun', 'shake'])
    expect([...kinds(2)].sort()).toEqual(['fuun', 'huh', 'shake', 'twirl', 'yaha'])
    expect(kinds(4).has('ura') && kinds(4).has('flip')).toBe(true)
    // At its laptop, a cramped one bashes the keys or shakes.
    const desk = new Set(Array.from({ length: 4000 }, (_, step) => quirkAt('u1', step * 250, 'desk', 1)?.kind).filter(Boolean))
    expect([...desk].sort()).toEqual(['bash', 'shake'])
  })

  test('in the scene: an idle Usagi bursts out in its cells and its shapes alike; Clawd never', () => {
    // A moment, on a frame of the scene's, a third of a second or more into a quirk of the session's Usagi.
    const from = Math.ceil(inputs([]).now / SCENE_FRAME_MS) * SCENE_FRAME_MS
    let at: number | undefined
    for (let t = from; t < from + 4 * QUIRK_WINDOW_MS && at === undefined; t += SCENE_FRAME_MS) if ((quirkAt('main', t, 'free')?.at ?? 0) >= 300) at = t
    expect(at).toBeDefined()
    const said = QUIRK_SAYS[quirkAt('main', at!, 'free')!.kind]
    // Idle five seconds: looking about, its first idle bit.
    const props = inputs([], { now: at!, columns: 60, rows: 10, art: 'vector', character: 'usagi', main: { idleSince: at! - 5000 } })
    const scene = sceneFromInputs(props, at!)
    const layout = room(60, 10, at! / SCENE_FRAME_MS, { motion: 'smooth', wander: false })
    const plan = mascotPlan(scene, layout)!
    const sprite = placedSprites(scene, layout, plan)?.sprites.find(one => one.id === 'main')
    expect(sprite?.figure?.quirk?.place).toBe('free')
    expect(sprite?.cells.map(row => row.map(cell => cell?.ch ?? ' ').join('')).join('\n')).toContain(said)
    const frame = smoothFrame(scene, layout, plan, undefined, createSmoother(), at!)!
    expect(frame.still).toBe(false)
    expect(frame.shapes.some(shape => shape.kind === 'text' && shape.text === said)).toBe(true)
    // The burst's cream balloon round it.
    expect(frame.shapes.some(shape => shape.fill === '#FFF8E7')).toBe(true)
    const clawd: MascotScene = { main: scene.main, agents: scene.agents }
    const clawdPlan = mascotPlan(clawd, layout)!
    expect(placedSprites(clawd, layout, clawdPlan)?.sprites.find(one => one.id === 'main')?.figure?.quirk).toBe(undefined)
  })

  test('as shapes: each eases in from the pose under it and back out; the dance squeezes its eyes shut and opens its mouth wide; Haa? looms', () => {
    for (const kind of Object.keys(QUIRK_MS) as QuirkKind[]) {
      const start = quirkPose(NEUTRAL, { kind, at: 0 }, 'right')
      expect(Math.abs(start.dx)).toBeLessThan(0.01)
      expect(Math.abs(start.drop) + Math.abs(start.tilt)).toBeLessThan(kind === 'ura' || kind === 'flip' ? 0.01 : 0.2)
    }
    const dance = quirkPose(NEUTRAL, { kind: 'yaha', at: 800 }, 'right')
    expect([dance.eyes, dance.mouthShape]).toEqual(['squeeze', 'scream'])
    expect(dance.beside.some(one => one.kind === 'shout')).toBe(true)
    const loom = quirkPose(NEUTRAL, { kind: 'huh', at: 600 }, 'right')
    expect(loom.sx).toBeGreaterThan(1.1)
    expect(loom.eyes).toBe('wide')
    const leap = quirkPose(NEUTRAL, { kind: 'ura', at: 630 }, 'right')
    expect(leap.drop).toBeLessThan(-5)
    const flip = quirkPose(NEUTRAL, { kind: 'flip', at: 625 }, 'right')
    expect(Math.abs(flip.spin)).toBeGreaterThan(1)
  })
})

describe('its stroll and its bounds', () => {
  test('on foot Usagi strolls at Clawd\'s pace, a cell a frame, and bounds further than Clawd hops', () => {
    const moves = (character?: 'usagi'): { steps: number[]; hops: number[] } => {
      const scene = (): MascotScene => ({ ...wanderers, ...(character === undefined ? {} : { character }) })
      const { plans } = run(scene, tick => room(120, 8, T0 + tick, { wander: true }), 300)
      const steps = plans.slice(1).flatMap((plan, index) => plan.placements.filter(one => one.motion?.kind === 'walk').map(one => Math.abs(one.drawnX - (plans[index]!.placements.find(before => before.id === one.id)?.drawnX ?? one.drawnX))))
      // Each hop once, by its id and first frame: how far it went.
      const hops = new Map(plans.flatMap(plan => [...plan.memo.entries()].flatMap(([id, memo]) => (memo.hop === undefined ? [] : [[`${id}:${memo.hop.from}`, Math.abs(memo.hop.x1 - memo.hop.x0)] as const]))))

      return { steps, hops: [...hops.values()].filter(reach => reach > 0) }
    }
    const clawd = moves()
    const usagi = moves('usagi')
    expect(Math.max(...clawd.steps, ...usagi.steps)).toBeLessThanOrEqual(1)
    // It bounds more often than Clawd hops, and its bounds go past a hop's reach (10 cells).
    expect(usagi.hops.length).toBeGreaterThan(clawd.hops.length)
    expect(usagi.hops.filter(reach => reach > 10).length).toBeGreaterThan(clawd.hops.filter(reach => reach > 10).length)
  })

  test('drawn as a toddle: short quick steps, a waddle, hands swinging, ears a touch behind; no wheel, no speed lines', () => {
    const walk = (t: number) => targetOf({ head: 'right', arms: 'rest', legs: 'step', pose: 'stand', overlays: [], lift: 0 }, { character: 'usagi', now: t, seed: 0.3, motion: { kind: 'walk' }, facing: 'right' }, false)
    const steps = Array.from({ length: 20 }, (_, index) => walk(index * 40))
    expect(steps.some(pose => (pose.legs[0] ?? 0) > 0.3)).toBe(true)
    expect(steps.some(pose => (pose.legs[1] ?? 0) > 0.3)).toBe(true)
    expect(Math.max(...steps.map(pose => Math.abs(pose.tilt)))).toBeLessThan(0.15)
    expect(steps.every(pose => pose.trail < 0 && pose.trail > -1)).toBe(true)
    expect(steps.flatMap(pose => pose.beside.map(one => one.kind))).not.toContain('dust')
  })

  test('bounding: crouched to spring, then up with legs tucked and hands flung up crying Yaha!, one bound in three turned over, down in a puff of dust', () => {
    const bound = (u: number, from = 1, air = 6) => targetOf(STAND, { character: 'usagi', now: 1000, seed: 0.3, motion: { kind: 'hop', step: 0, lift: 0, pose: 'apex', from, air, u }, facing: 'right' }, false)
    expect(bound(-0.05).sy).toBeLessThan(1)
    const up = bound(0.4)
    expect(up.tuck).toBe(1)
    expect(up.armL).toBeGreaterThan(1)
    expect(up.mouthShape).toBe('scream')
    expect(up.beside.find(one => one.kind === 'shout')).toMatchObject({ text: expect.stringMatching(/^(Yaha!|Iyaha!|Ura!)$/) })
    expect(bound(1.04).beside.map(one => one.kind)).toContain('dust')
    const spins = Array.from({ length: 9 }, (_, from) => Math.abs(bound(0.5, from).spin))
    expect(spins.filter(spin => spin > 1).length).toBeGreaterThan(0)
    expect(spins.filter(spin => spin === 0).length).toBeGreaterThan(0)
    // A spring in place: up and down, no cry, no flip.
    const spring = Array.from({ length: 9 }, (_, from) => bound(0.5, from, 1))
    expect(spring.every(one => one.spin === 0 && !one.beside.some(beside => beside.kind === 'shout'))).toBe(true)
    // Clawd hops as it did.
    expect(targetOf(STAND, { character: 'clawd', now: 1000, seed: 0.3, motion: { kind: 'hop', step: 0, lift: 0, pose: 'apex', from: 1, air: 6, u: 0.4 }, facing: 'right' }, false).beside).toEqual([])
  })

  test('its ears twitch now and then, one at a time', () => {
    const twitches = Array.from({ length: 400 }, (_, index) => earTwitch(index * 25, 0.4))
    expect(twitches.some(([left]) => left > 0.2)).toBe(true)
    expect(twitches.some(([, right]) => right > 0.2)).toBe(true)
    expect(twitches.filter(([left, right]) => left === 0 && right === 0).length).toBeGreaterThan(300)
  })

  test('asleep, a bubble swells and shrinks from its nose', () => {
    const asleep = { ...NEUTRAL, blanket: 1, hideLegs: 1, eyeOpen: 0.08 }
    const bubble = (t: number) => figureShapes(asleep, INFO, [1, 0, 0, 1, 0, 0], t).find(shape => shape.fill === '#CDEBFF')?.w ?? 0
    expect(bubble(1300)).toBeGreaterThan(bubble(0) * 2)
  })
})

