import { describe, expect, test } from 'claude-code/testing'

import { CROUCHED, FLAT, HEADS, TORSOS } from './mascot-sprites'
import { stepField } from './motion-arbitrate'
import { AIRBORNE, CONTACT_COOLDOWN_MS, DEPTH_FRAMES, FLY_SKY, GAP, HOP_AIR, HOP_HEIGHT, KNOCKED_TICKS, PROPELLER_ROWS, hopLift, pairKey } from './motion-rules'
import type { Memo, Motion, Mover } from './motion-types'
import { oneAgent, working } from './scene-model.fixtures'
import { SCENE_FRAME_MS } from './scene-phases'
import { mascotPlan } from './scene-plan'
import { T0, lineRows, room, run, wanderers } from './scene-plan.fixtures'
import { mascotLines } from './scene-render'
import type { MascotLayout, MascotPlan, MascotScene, Placement } from './scene-types'

// The field stepped frame by frame (`stepField`, through `mascotPlan`):
// wandering in bounds and a gap apart, the same moves on every run, and the
// bump and the collision rules.

const settledOf = (plan: MascotPlan): Placement[] => plan.placements.filter(one => one.kind !== 'strip' && (one.phase === undefined || !['fall', 'land', 'hop', 'walk-in', 'leave'].includes(one.phase.kind)))

describe('wandering', () => {
  const gapOf = (a: Placement, b: Placement, width = (one: Placement) => one.width): number =>
    a.drawnX <= b.drawnX ? b.drawnX - (a.drawnX + width(a)) : a.drawnX - (b.drawnX + width(b))

  test('on the field mascots stay in bounds and a cell apart within a row of depth, walk a cell a frame across and a row every other frame in depth; in the air, fliers within a row never overlap; and they do move, in both axes', () => {
    for (const collisions of ['off', 'rare', 'normal'] as const) {
      for (const [columns, rows] of [[84, 8], [84, 9], [92, 4], [112, 5], [112, 14], [72, 20]] as const) {
        const { plans } = run(() => wanderers, tick => room(columns, rows, T0 + tick, { wander: true, collisions }), 240)
        const seen = new Set<string>()
        const depths = new Set<string>()
        plans.forEach((plan, frame) => {
          const placed = settledOf(plan)
          for (const one of placed) {
            expect(one.drawnX, `${collisions} ${columns}x${rows} @${frame}`).toBeGreaterThanOrEqual(0)
            expect(one.drawnX + one.width).toBeLessThanOrEqual(columns)
            expect(one.d).toBeGreaterThanOrEqual(0)
            expect(one.d).toBeLessThan(plan.depth)
            // Its lift above its own floor, never past the sky over it.
            expect(one.lift ?? 0, `${one.id} @${frame}`).toBeLessThanOrEqual(plan.headroom + one.d)
            seen.add(`${one.id}:${one.drawnX}:${one.d}`)
            depths.add(`${one.id}:${one.d}`)
          }
          // On the ground, within a row of depth: a cell apart. Further apart in depth they may pass, the nearer over the farther.
          const ground = placed.filter(one => (one.lift ?? 0) < AIRBORNE)
          for (const one of ground) {
            for (const other of ground) {
              if (one.id >= other.id || Math.abs(one.d - other.d) > 1) continue
              expect(gapOf(one, other), `${collisions} ${columns}x${rows} ${one.id}/${other.id} @${frame}`).toBeGreaterThanOrEqual(GAP)
            }
          }
          // In the air only bodies count; a flier never overlaps anyone in the air within a row of its lift and depth.
          const air = placed.filter(one => (one.lift ?? 0) >= AIRBORNE)
          for (const one of air.filter(flier => flier.motion?.kind === 'fly')) {
            for (const other of air) {
              if (one === other || Math.abs((one.lift ?? 0) - (other.lift ?? 0)) > 1 || Math.abs(one.d - other.d) > 1) continue
              expect(gapOf(one, other, mascot => mascot.body), `${one.id}/${other.id} in the air @${frame}`).toBeGreaterThanOrEqual(GAP)
            }
          }
          const before = plans[frame - 1]
          if (before === undefined) return
          for (const one of placed) {
            const old = before.placements.find(other => other.id === one.id)
            if (old === undefined || (one.motion !== undefined && one.motion.kind !== 'walk')) continue
            // A walk is a cell a frame across, a row of depth every other frame; a hop or a flight covers more.
            expect(Math.abs(one.drawnX - old.drawnX), `${one.id} @${frame}`).toBeLessThanOrEqual(1)
            expect(Math.abs(one.d - old.d), `${one.id} @${frame}`).toBeLessThanOrEqual(1)
            if (one.d !== old.d && one.motion?.kind === 'walk') expect(plan.tick % DEPTH_FRAMES, `${one.id} @${frame}`).toBe(0)
          }
        })
        // Every mascot visited more than one place; in a field deeper than a row, more than one depth too.
        for (const id of ['main', 'w1', 'w2', 'w3']) expect([...seen].filter(key => key.startsWith(`${id}:`)).length, id).toBeGreaterThan(1)
        if (plans[0]!.depth > 1) expect([...depths].length, `${columns}x${rows}`).toBeGreaterThan(4)
      }
    }
  })

  test('a pause between walks lasts 4 to 12 frames; a mover at work stays put', () => {
    for (let tick = 100; tick < 160; tick += 1) {
      const arrived: Mover = { id: `m${tick}`, width: 9, x: 5, lo: 0, hi: 60, free: true, sky: 0, memo: { x: 5, target: 5, pauseUntil: 0 } }
      const memo = stepField([arrived], tick).get(arrived.id)!.memo
      expect(memo.pauseUntil - tick).toBeGreaterThanOrEqual(4)
      expect(memo.pauseUntil - tick).toBeLessThanOrEqual(12)
    }
    const busy: Mover = { id: 'typist', width: 9, x: 7, lo: 0, hi: 60, free: false, sky: 8 }
    for (let tick = 0; tick < 50; tick += 1) expect(stepField([busy], tick).get('typist')?.x).toBe(7)
  })

  test('only mascots between tools wander: typing, reading, stalled, asking and idle ones stay put; idle, the session stays put', () => {
    const scene: MascotScene = {
      main: { mood: 'idle', sweating: false },
      agents: [working('t', 'typing'), working('r', 'reading'), working('s', 'thinking', { status: 'stalled' }), working('q', 'asking'), working('i', 'thinking', { idleMs: 30_000 })],
    }
    for (const rows of [8, 16]) {
      const { plans } = run(() => scene, tick => room(120, rows, T0 + tick, { wander: true }), 120)
      for (const id of ['main', 't', 'r', 's', 'q', 'i']) {
        expect(new Set(plans.map(plan => plan.placements.find(one => one.id === id)).map(one => `${one?.drawnX},${one?.d}`)).size, id).toBe(1)
      }
    }
  })

  test('flights: with three rows of sky or more, each flier climbs two rows a second to an altitude of its own, cruises with a bob, comes down and lands with a bounce', () => {
    const fly = (rows: number, frames = 800) => {
      const { plans, lines } = run(() => wanderers, tick => room(112, rows, T0 + tick, { wander: true, collisions: 'off' }), frames)
      const byId = new Map<string, (Placement | undefined)[]>()
      for (const plan of plans) for (const id of ['main', 'w1', 'w2', 'w3']) byId.set(id, [...(byId.get(id) ?? []), plan.placements.find(one => one.id === id)])
      for (const frame of lines) expect(frame.length).toBeLessThanOrEqual(rows)

      return { byId, lines, plans }
    }
    const high = fly(14)
    // Fourteen rows: a field seven rows deep, four rows of sky over its back row, eleven over its front.
    expect([high.plans[0]?.depth, high.plans[0]?.headroom]).toEqual([7, 4])
    // Each flight's highest row: its cruising altitude, give or take its bob (or a dodge).
    const peaks: number[] = []
    for (const list of high.byId.values()) {
      let peak = 0
      list.forEach((one, index) => {
        if (one?.motion?.kind !== 'fly') return
        // Its propeller turns a row over its cap: never past the top of the sky over its own floor.
        expect(one.lift ?? 0).toBeLessThanOrEqual(4 + one.d - PROPELLER_ROWS)
        peak = Math.max(peak, one.lift ?? 0)
        const next = list[index + 1]
        if (next !== undefined && next.motion?.kind !== 'fly') {
          expect(next.motion?.kind, 'a flight ends in a landing').toBe('land')
          peaks.push(peak)
          peak = 0
        }
      })
    }
    expect(peaks.length).toBeGreaterThan(1)
    // Different fliers, different heights, up into the free rows of the scene.
    expect(new Set(peaks).size).toBeGreaterThan(1)
    expect(Math.max(...peaks)).toBeGreaterThan(2)
    expect(PROPELLER_ROWS).toBe(1)
    // While flying, the propeller cap: a cap over the head, its blade above it turning + then x; no wings.
    expect(high.lines.some(frame => frame.some(row => row.includes('▄▄▄')))).toBe(true)
    expect(high.lines.some(frame => frame.some(row => /(^| )\+( |$)/.test(row)))).toBe(true)
    expect(high.lines.some(frame => frame.some(row => /(^| )x( |$)/.test(row)))).toBe(true)
    expect(high.lines.every(frame => frame.every(row => !/[˂˃⌃]/.test(row)))).toBe(true)
    // With fewer than three rows of sky, never.
    for (const rows of [4, 5, 6]) expect([...fly(rows, 300).byId.values()].flat().some(one => one?.motion?.kind === 'fly'), `${rows} rows`).toBe(false)
  })

  test('one flight, frame by frame: up a row every other frame to its altitude, a cruise bobbing a row, down a row a frame where the ground is clear, then the bounce', () => {
    const fly = { from: 1000, altitude: 5, cruise: 8, stage: 'climb' as const, since: 1000 }
    let mover: Mover = { id: 'flier', width: 9, x: 0, lo: 0, hi: 91, free: true, sky: 8, memo: { x: 0, lift: 1, target: 90, pauseUntil: 1000, fly } }
    const lifts: number[] = []
    const kinds: string[] = []
    for (let tick = 1001; tick < 1040; tick += 1) {
      const moved = stepField([mover], tick).get('flier')!
      lifts.push(moved.lift)
      kinds.push(moved.motion?.kind ?? 'none')
      mover = { ...mover, x: moved.x, memo: moved.memo }
      if (moved.motion?.kind === 'land') break
    }
    expect(lifts.slice(0, 8)).toEqual([1, 2, 2, 3, 3, 4, 4, 5])
    // Cruising: at its altitude, bobbing a row either way.
    const cruise = lifts.slice(8, 16)
    expect(cruise.every(lift => Math.abs(lift - 5) <= 1)).toBe(true)
    expect(new Set(cruise).size).toBeGreaterThan(1)
    // Then down a row a frame, and the bounce.
    const down = lifts.slice(lifts.lastIndexOf(Math.max(...lifts.slice(16))))
    expect(down.slice(0, -1).every((lift, index) => index === 0 || lift === down[index - 1]! - 1)).toBe(true)
    expect(kinds.at(-1)).toBe('land')
    expect(lifts.at(-1)).toBe(0)
  })

  test('hops: squashed on take-off and landing, legs tucked at the apex; four rows high, over a mascot in the way, where there is the sky for it', () => {
    expect(HOP_AIR).toBe(4)
    expect(Array.from({ length: 6 }, (_, step) => hopLift({ air: HOP_AIR, height: HOP_HEIGHT }, step))).toEqual([0, 2, 4, 4, 2, 0])
    expect([0, 1, 2, 3, 4].map(step => hopLift({ air: 3, height: HOP_HEIGHT }, step))).toEqual([0, 2, 4, 2, 0])
    // A spring in place: up a row and down.
    expect([0, 1, 2].map(step => hopLift({ air: 1, height: 1 }, step))).toEqual([0, 1, 0])
    // A walker with a mascot in its way and the sky to clear it hops over and lands clear beyond.
    const walker: Mover = { id: 'hopper', width: 9, x: 10, lo: 0, hi: 91, free: true, sky: HOP_HEIGHT, memo: { x: 10, target: 60, pauseUntil: 0 } }
    const typist: Mover = { id: 'typist', width: 15, x: 20, lo: 0, hi: 85, free: false, sky: HOP_HEIGHT }
    let movers = [walker, typist]
    const path: { x: number; lift: number; pose?: string }[] = []
    for (let tick = 1000; tick < 1012; tick += 1) {
      const moved = stepField(movers, tick, { collisions: 'rare' })
      const one = moved.get('hopper')!
      path.push({ x: one.x, lift: one.lift, pose: one.motion?.kind === 'hop' ? one.motion.pose : one.motion?.kind })
      expect(moved.get('typist')?.x).toBe(20)
      movers = movers.map(mover => ({ ...mover, x: moved.get(mover.id)!.x, memo: moved.get(mover.id)!.memo }))
    }
    const hop = path.findIndex(step => step.pose === 'squash')
    expect(hop).toBeGreaterThanOrEqual(0)
    const landing = path.findIndex((step, index) => index > hop && step.pose === 'squash')
    expect(path[landing]!.x).toBe(20 + 15 + 2)
    expect(Math.max(...path.slice(hop, landing).map(step => step.lift))).toBe(HOP_HEIGHT)
    expect(path.slice(hop + 1, landing).every(step => step.lift >= AIRBORNE)).toBe(true)
    expect(path.slice(hop, landing + 1).map(step => step.pose)).toEqual(['squash', 'stretch', 'apex', 'apex', 'air', 'squash'])
    expect(path.slice(hop, landing + 1).map(step => step.lift)).toEqual([0, 2, 4, 4, 2, 0])
    // Without the sky, it stops short of the one in its way and turns for somewhere else.
    const grounded = stepField([{ ...walker, sky: 3 }, typist], 1000, { collisions: 'rare' })
    expect(grounded.get('hopper')!.lift).toBe(0)
    expect(grounded.get('hopper')!.x).toBeLessThanOrEqual(10)
    // In a plan: hops rise into the sky with no more rows than given, and without sky they spring in place.
    const { plans } = run(() => wanderers, tick => room(112, 9, T0 + tick, { wander: true, collisions: 'off' }), 600)
    const hops = plans.flatMap(plan => plan.placements.filter(one => one.motion?.kind === 'hop'))
    expect(hops.length).toBeGreaterThan(0)
    expect(hops.some(one => (one.lift ?? 0) === HOP_HEIGHT)).toBe(true)
    const flat = run(() => wanderers, tick => room(90, 4, T0 + tick, { wander: true, collisions: 'off' }), 600)
    const springs = flat.plans.flatMap(plan => plan.placements.filter(one => one.motion?.kind === 'hop'))
    expect(springs.length).toBeGreaterThan(0)
    expect(springs.every(one => (one.lift ?? 0) === 0)).toBe(true)
    expect(flat.lines.every(frame => frame.length === 4)).toBe(true)
    expect(FLY_SKY).toBe(3)
  })

  test('walking between tools, no laptop: it is only out while a tool runs', () => {
    const { plans, lines } = run(() => oneAgent(working('w', 'thinking')), tick => room(72, 4, T0 + tick, { wander: true }), 200)
    const index = plans.findIndex(plan => plan.placements.find(one => one.id === 'w')?.motion?.kind === 'walk')
    expect(index).toBeGreaterThanOrEqual(0)
    const one = plans[index]!.placements.find(other => other.id === 'w')!
    const cell = lineRows(lines[index] ?? [], plans[index]!).map(row => row.padEnd(72).slice(one.drawnX, one.drawnX + one.width))
    expect(cell[1]?.slice(2, 10)).toBe(HEADS[one.facing ?? 'right'].slice(0, 8))
    // Its torso upright or leaning a cell the way it goes, a thought beside; no laptop.
    expect(cell[2]?.replace('·', '').trim()).toBe(TORSOS.rest)
    expect(cell.join('')).not.toMatch(/▗▄▄▄▖|▐▒▒▒▌/)
    expect(cell[3]?.trim()).toMatch(/^[▘▝]{2} [▘▝]{2}$/)
  })
})

describe('choreography determinism', () => {
  test('the same scene and frames move the same way: the frames drawn repeat, and so do the places over a deep field, across and in depth', () => {
    const line = (tick: number) => room(72, 9, T0 + tick, { wander: true })
    expect(run(() => wanderers, line, 120).lines).toEqual(run(() => wanderers, line, 120).lines)
    // Four wandering over a deep field: the same places on every run, at more than three depths.
    const four: MascotScene = { main: { mood: 'watching', sweating: false }, agents: ['w1', 'w2', 'w3', 'w4'].map(id => working(id, 'thinking')) }
    const deep = (tick: number): MascotLayout => ({ columns: 96, rows: 24, tick: T0 + tick, wander: true, collisions: 'rare' })
    const places = () => run(() => four, deep, 160).plans.map(plan => plan.placements.map(one => `${one.id}@${one.drawnX},${one.d},${one.lift ?? 0}`))
    const once = places()
    expect(places()).toEqual(once)
    expect(new Set(once.flat().map(one => one.split(',')[1])).size).toBeGreaterThan(3)
  })

  test('a redraw of the same frame moves nothing', () => {
    const { plans } = run(() => wanderers, tick => room(72, 9, T0 + tick, { wander: true }), 30)
    const last = plans.at(-1)!
    expect(mascotPlan(wanderers, room(72, 9, last.tick, { wander: true }), last)?.placements).toEqual(last.placements)
  })
})

describe('collisions', () => {
  // Two wanderers a cell apart, walking into each other.
  const pair = (leftTarget = 40, rightTarget = 0): Mover[] => [
    { id: 'a', width: 9, x: 10, lo: 0, hi: 91, free: true, sky: 0, memo: { x: 10, target: leftTarget, pauseUntil: 0 } },
    { id: 'b', width: 9, x: 20, lo: 0, hi: 91, free: true, sky: 0, memo: { x: 20, target: rightTarget, pauseUntil: 0 } },
  ]

  test('two moving into each other both fall over where they stand, in rare and normal; off, they step back', () => {
    // Pick a frame where neither starts a leap, so both walk.
    for (const collisions of ['rare', 'normal'] as const) {
      const contacts: string[] = []
      const moved = stepField(pair(), 1000, { collisions }, contacts)
      expect(contacts).toEqual([pairKey('a', 'b')])
      for (const id of ['a', 'b']) {
        expect(moved.get(id)?.collided).toBe(true)
        expect(moved.get(id)?.motion).toEqual({ kind: 'fallen', step: 0 })
      }
      expect(moved.get('a')?.x).toBe(10)
      expect(moved.get('b')?.x).toBe(20)
    }
    const off = stepField(pair(), 1000, { collisions: 'off' })
    expect(off.get('a')?.x).toBe(9)
    expect(off.get('b')?.x).toBe(21)
    expect(off.get('a')?.bumped).toBe(true)
  })

  test('down two frames, dizzy eight, up two, then back to what it was doing', () => {
    const memo: Memo = { x: 10, pauseUntil: 0, fallFrom: 500 }
    const steps: (Motion | undefined)[] = []
    for (let tick = 500; tick < 500 + KNOCKED_TICKS + 1; tick += 1) {
      steps.push(stepField([{ id: 'a', width: 9, x: 10, lo: 0, hi: 60, free: true, sky: 0, memo }], tick).get('a')?.motion)
    }
    expect(steps.slice(0, KNOCKED_TICKS)).toEqual(Array.from({ length: KNOCKED_TICKS }, (_, step) => ({ kind: 'fallen', step })))
    expect(steps.at(-1)?.kind).not.toBe('fallen')
    expect(KNOCKED_TICKS).toBe(12)
  })

  test('a pair cannot collide again within its cooldown: 10 s normal, 30 s rare', () => {
    expect(CONTACT_COOLDOWN_MS).toEqual({ off: 0, rare: 30_000, normal: 10_000 })
    for (const [collisions, ms] of [['normal', 10_000], ['rare', 30_000]] as const) {
      const recent = new Map([[pairKey('a', 'b'), 1000 - ms / SCENE_FRAME_MS + 1]])
      expect(stepField(pair(), 1000, { collisions, lastContact: recent }).get('a')?.collided).toBe(undefined)
      const old = new Map([[pairKey('a', 'b'), 1000 - ms / SCENE_FRAME_MS]])
      expect(stepField(pair(), 1000, { collisions, lastContact: old }).get('a')?.collided).toBe(true)
    }
  })

  test('a standing mascot walked into falls too in normal; in rare it is walked around (the walker stops)', () => {
    const movers = (): Mover[] => [
      { id: 'walker', width: 9, x: 10, lo: 0, hi: 91, free: true, sky: 0, memo: { x: 10, target: 40, pauseUntil: 0 } },
      { id: 'typist', width: 9, x: 20, lo: 0, hi: 91, free: false, sky: 0 },
    ]
    const normal = stepField(movers(), 1000, { collisions: 'normal' })
    expect(normal.get('walker')?.collided).toBe(true)
    expect(normal.get('typist')?.collided).toBe(true)
    const rare = stepField(movers(), 1000, { collisions: 'rare' })
    expect(rare.get('typist')?.collided).toBe(undefined)
    expect(rare.get('walker')?.collided).toBe(undefined)
    expect(rare.get('walker')?.x).toBeLessThanOrEqual(10)
    expect(rare.get('typist')?.x).toBe(20)
  })

  test('in a plan: both knocked flat on their backs, legs in the air, then dizzy with spiral eyes under three blinking stars; a crouch, then up, a working one setting its laptop down again', () => {
    const scene: MascotScene = { main: { mood: 'idle', sweating: false }, agents: [working('a', 'typing'), working('b', 'thinking')] }
    const layout = (tick: number) => room(72, 8, tick, { wander: true, collisions: 'normal' })
    const base = mascotPlan(scene, layout(T0))!
    const knocked = new Map(base.memo)
    for (const one of base.placements.filter(p => p.id !== 'main')) knocked.set(one.id, { x: one.drawnX, d: 0, pauseUntil: T0 + KNOCKED_TICKS, fallFrom: T0 })
    let previous: MascotPlan = { ...base, memo: knocked }
    const frames: string[][] = []
    for (let step = 1; step <= KNOCKED_TICKS + 1; step += 1) {
      const plan = mascotPlan(scene, layout(T0 + step), previous)!
      frames.push([...lineRows(mascotLines(scene, layout(T0 + step), plan) ?? [], plan)])
      previous = plan
    }
    const a = base.placements.find(one => one.id === 'a')!
    // Frame k is step k + 1 of its fall.
    const cellAt = (frame: number) => (frames[frame] ?? []).map(row => row.padEnd(72).slice(a.drawnX, a.drawnX + a.width))
    // Flat on its back, legs in the air, its head on the floor, eyes shut.
    expect(cellAt(0).slice(1).map(row => row.slice(2, 11))).toEqual([FLAT.legs, FLAT.body, HEADS.shut])
    expect(cellAt(0)[0]?.trim()).toBe('')
    // Dizzy: spiral eyes spinning a frame at a time; three stars over it, one hidden in turn.
    expect(cellAt(1).slice(1).map(row => row.slice(2, 11))).toEqual([FLAT.legs, FLAT.body, HEADS.spiral])
    expect(cellAt(2)[3]?.slice(2, 11)).toBe(HEADS.spin)
    expect([1, 2, 3].map(frame => [3, 6, 9].map(x => cellAt(frame)[0]?.[x]).join(''))).toEqual([' ✦✦', '✧ ✦', '✧✧ '])
    // Crouched, hands on the floor, its eyes back, then up at its laptop again.
    expect(cellAt(KNOCKED_TICKS - 3)[3]?.startsWith(`  ${CROUCHED}`)).toBe(true)
    expect(cellAt(KNOCKED_TICKS - 3)[2]?.startsWith(`  ${HEADS.open}`)).toBe(true)
    expect(cellAt(KNOCKED_TICKS - 2)[3]?.endsWith('▀▀▀▀▀▀')).toBe(true)
    expect(cellAt(KNOCKED_TICKS - 1)[2]).toMatch(/▐▒▒▒▌$/)
  })
})
