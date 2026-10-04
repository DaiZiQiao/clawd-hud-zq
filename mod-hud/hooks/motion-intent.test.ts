import { describe, expect, test } from 'claude-code/testing'

import { stepField } from './motion-arbitrate'
import { AIRBORNE, FLIGHT_MIN_TICKS, GAP, LANDING_GIVE_UP, LANDING_PATIENCE, LOOP_TICKS, PROPELLER_ROWS, READING_STREAK_MS, SMOOTH_LANDING_PATIENCE } from './motion-rules'
import type { Mover } from './motion-types'
import { working } from './scene-model.fixtures'
import { BLANKET_AFTER_MS, IDLE_SLOT_MS, SCENE_FRAME_MS, idleBitOf } from './scene-phases'
import { mascotPlan } from './scene-plan'
import { T0, room, run, slotted, wanderers } from './scene-plan.fixtures'
import { mascotLines } from './scene-render'
import type { MascotLayout, MascotPlan, MascotScene, Placement } from './scene-types'

// Flights: what asks one of a mover in the smooth scene, how long it stays
// up, how it lands, and the classic scene's flights as they were.

const smooth = (columns: number, rows: number, tick: number, extra: Partial<MascotLayout> = {}): MascotLayout => room(columns, rows, tick, { motion: 'smooth', scenes: true, ...extra })
const one = (plan: MascotPlan, id: string): Placement => plan.placements.find(placement => placement.id === id)!
/** Each flight of `id` in a run of plans: the frames it took off and landed (or the run ended). */
const flightsOf = (plans: readonly MascotPlan[], id: string): { from: number; to: number; reasons: Set<string>; landedAt?: number }[] => {
  const out: { from: number; to: number; reasons: Set<string>; landedAt?: number }[] = []
  plans.forEach((plan, frame) => {
    const placed = one(plan, id)
    const flying = placed.motion?.kind === 'fly'
    const last = out.at(-1)
    if (flying && (last === undefined || last.to < frame - 1)) out.push({ from: frame, to: frame, reasons: new Set() })
    if (flying) {
      out.at(-1)!.to = frame
      if (placed.flight !== undefined) out.at(-1)!.reasons.add(placed.flight)
    }
    if (placed.motion?.kind === 'land' && out.at(-1) !== undefined && out.at(-1)!.landedAt === undefined) out.at(-1)!.landedAt = placed.drawnX
  })

  return out
}

describe('smooth flights', () => {
  test('a WebFetch running takes the agent up; it cruises until the call ends, at least four seconds, and lands at its laptop', () => {
    // Fetching for the first two seconds, then typing.
    const scene = (frame: number): MascotScene => ({
      main: { mood: 'watching', sweating: false },
      agents: [working('f', frame < 8 ? 'fetching' : 'typing')],
    })
    const { plans } = run(scene, tick => smooth(72, 12, T0 + tick, { wander: false }), 120)
    const flights = flightsOf(plans, 'f')
    expect(flights).toHaveLength(1)
    const [flight] = flights
    expect(flight!.from).toBeLessThanOrEqual(1)
    expect([...flight!.reasons]).toEqual(['fetch'])
    // Up at least FLIGHT_MIN_TICKS (four seconds), though the call took two.
    expect(flight!.to - flight!.from + 1).toBeGreaterThanOrEqual(FLIGHT_MIN_TICKS)
    // Back down at its slot, at its laptop again.
    const slot = one(plans[0]!, 'f').x
    expect(flight!.landedAt).toBe(slot)
    const after = plans.at(-1)!
    expect(one(after, 'f').drawnX).toBe(slot)
    expect(one(after, 'f').motion).toBe(undefined)
    expect(mascotLines(scene(119), smooth(72, 12, T0 + 119, { wander: false }), after)?.join('\n')).toContain('▗▄▄▄▖')
  })

  test('a fetch that ends at once still flies four seconds: no flicker', () => {
    const scene = (frame: number): MascotScene => ({ main: { mood: 'watching', sweating: false }, agents: [working('f', frame < 2 ? 'fetching' : 'typing')] })
    const { plans } = run(scene, tick => smooth(72, 12, T0 + tick, { wander: false }), 80)
    const [flight] = flightsOf(plans, 'f')
    expect(flight!.to - flight!.from + 1).toBeGreaterThanOrEqual(FLIGHT_MIN_TICKS)
    expect(flightsOf(plans, 'f')).toHaveLength(1)
  })

  test('an Explore or researcher agent flies the whole time it works, scanning; idle, it comes down', () => {
    const scene = (frame: number): MascotScene => ({
      main: { mood: 'watching', sweating: false },
      agents: [working('e', 'reading', { role: 'explorer', ...(frame >= 120 ? { activity: 'thinking' as const, idleMs: 30_000 } : {}) })],
    })
    const { plans } = run(scene, tick => smooth(72, 14, T0 + tick, { wander: false }), 200)
    const flights = flightsOf(plans, 'e')
    expect(flights).toHaveLength(1)
    expect([...flights[0]!.reasons]).toEqual(['scan'])
    // Up from its first frames until it goes idle, then down at its slot.
    expect(flights[0]!.from).toBeLessThanOrEqual(1)
    expect(flights[0]!.to).toBeGreaterThanOrEqual(119)
    expect(flights[0]!.landedAt).toBe(one(plans[0]!, 'e').x)
    // A worker reading as long does not scan: it reads at its laptop until its streak is five seconds old.
    const worker = run(() => ({ main: { mood: 'watching', sweating: false }, agents: [working('w', 'reading', { role: 'worker' })] }), tick => smooth(72, 14, T0 + tick, { wander: false }), 40).plans
    expect(flightsOf(worker, 'w')).toHaveLength(0)
  })

  test('a reading streak of five seconds lifts an agent off; its next Edit brings it down at its laptop', () => {
    // Reading: the streak four seconds old at frame 0, five at frame 4; an Edit at frame 40.
    const scene = (frame: number): MascotScene => ({
      main: { mood: 'watching', sweating: false },
      agents: [working('r', frame < 40 ? 'reading' : 'typing', frame < 40 ? { readingMs: 4000 + frame * 250 } : {})],
    })
    const { plans } = run(scene, tick => smooth(72, 12, T0 + tick, { wander: false }), 120)
    const flights = flightsOf(plans, 'r')
    expect(flights).toHaveLength(1)
    expect([...flights[0]!.reasons]).toEqual(['read'])
    // Not before the streak is five seconds old (frame 4).
    expect(flights[0]!.from).toBeGreaterThanOrEqual((READING_STREAK_MS - 4000) / SCENE_FRAME_MS)
    expect(flights[0]!.to).toBeGreaterThanOrEqual(40)
    expect(flights[0]!.landedAt).toBe(one(plans[0]!, 'r').x)
  })

  test('idle flights are rare and long: ten to thirty seconds, far fewer than the classic scene\'s', () => {
    const minutes = 10
    const frames = (minutes * 60_000) / SCENE_FRAME_MS
    const smoothRun = run(() => wanderers, tick => smooth(112, 14, T0 + tick, { wander: true, collisions: 'off' }), frames).plans
    const classicRun = run(() => wanderers, tick => room(112, 14, T0 + tick, { wander: true, collisions: 'off' }), frames).plans
    let smoothFlights = 0
    let classicFlights = 0
    for (const id of ['main', 'w1', 'w2', 'w3']) {
      const flights = flightsOf(smoothRun, id).filter(one => one.to < frames - 1)
      smoothFlights += flights.length
      classicFlights += flightsOf(classicRun, id).length
      for (const flight of flights) {
        expect([...flight.reasons], id).toEqual(['idle'])
        // Its cruise ten to thirty seconds; up and down, and a few seconds' wait for clear ground, around it.
        const cruise = smoothRun[flight.from]!.memo.get(id)?.fly?.cruise ?? 0
        expect(cruise * SCENE_FRAME_MS).toBeGreaterThanOrEqual(10_000)
        expect(cruise * SCENE_FRAME_MS).toBeLessThanOrEqual(30_000)
        const seconds = ((flight.to - flight.from + 1) * SCENE_FRAME_MS) / 1000
        expect(seconds, `${id} @${flight.from}`).toBeGreaterThanOrEqual(10)
        expect(seconds, `${id} @${flight.from}`).toBeLessThanOrEqual(45)
      }
    }
    // Far rarer than an idle mascot's sits and puffs (a bit a six-second slot, until the blanket at 90 s), a minute for a minute.
    let sitsAndPuffs = 0
    const awake = BLANKET_AFTER_MS / IDLE_SLOT_MS
    for (const id of ['main', 'w1', 'w2', 'w3']) {
      for (let slot = 1; slot < awake; slot += 1) {
        const bit = idleBitOf(id, slot * IDLE_SLOT_MS + 1)
        if (bit === 'sit' || bit === 'puff') sitsAndPuffs += 1
      }
    }
    const flightsAMinute = smoothFlights / (4 * minutes)
    const bitsAMinute = sitsAndPuffs / (4 * (BLANKET_AFTER_MS / 60_000))
    expect(smoothFlights).toBeGreaterThan(0)
    expect(flightsAMinute * 4).toBeLessThan(bitsAMinute)
    expect(flightsAMinute).toBeLessThan(0.5)
    expect(classicFlights).toBeGreaterThan(0)
  })

  test('cruising, a flight changes altitude every few seconds and now and then loops', () => {
    const fly = { from: 1000, altitude: 4, cruise: 120, stage: 'cruise' as const, since: 1000, reason: 'idle' as const, minUntil: 1016, turnAt: 1000 }
    let mover: Mover = { id: 'looper', width: 17, body: 13, x: 30, lo: 0, hi: 95, free: true, sky: 12, memo: { x: 30, lift: 4, target: 30, pauseUntil: 1000, fly } }
    const altitudes = new Set<number>()
    const loops = new Set<number>()
    for (let tick = 1000; tick < 1120; tick += 1) {
      const moved = stepField([mover], tick, { smooth: true }).get('looper')!
      altitudes.add(moved.memo.fly?.altitude ?? 0)
      if (moved.memo.fly?.loop !== undefined) loops.add(moved.memo.fly.loop)
      // Never down into the ground's rows while it cruises, never a row past its propeller's room.
      if (moved.memo.fly?.stage === 'cruise') expect(moved.lift).toBeGreaterThanOrEqual(AIRBORNE)
      expect(moved.lift).toBeLessThanOrEqual(12 - PROPELLER_ROWS)
      mover = { ...mover, x: moved.x, memo: moved.memo }
    }
    expect(altitudes.size).toBeGreaterThan(2)
    expect(loops.size).toBeGreaterThan(0)
    expect(LOOP_TICKS).toBe(6)
  })

  test('an errand over a crowded floor flies; the session flies to a newcomer far down the line and after a compaction', () => {
    // The session meets a newcomer at column 110 past three agents at their laptops at 20, 40 and 60, in a field a row deep under a tall sky.
    const crowd: MascotScene = {
      main: { mood: 'watching', sweating: false },
      agents: [working('a', 'typing'), working('b', 'typing'), working('c', 'typing'), working('n', 'thinking', { ageMs: 0, spawner: 'main' })],
    }
    const sceneAt = (tick: number): MascotScene => ({ ...crowd, agents: crowd.agents.map(agent => (agent.id === 'n' ? { ...agent, ageMs: tick * SCENE_FRAME_MS } : agent)) })
    const errand = (columns: number, at: Record<string, number>, held: string[] = []): MascotPlan[] => {
      const layoutAt = (tick: number) => smooth(columns, 8, T0 + tick, { wander: false, held, scenes: true })
      const out: MascotPlan[] = []
      let previous = slotted(sceneAt(0), layoutAt(0), at)
      for (let tick = 1; tick <= 10; tick += 1) {
        previous = mascotPlan(sceneAt(tick), layoutAt(tick), previous)!
        out.push(previous)
      }

      return out
    }
    const crowded = errand(130, { a: 20, b: 40, c: 60, n: 110 })
    expect(crowded.some(plan => one(plan, 'main').motion?.kind === 'fly' && one(plan, 'main').flight === 'errand')).toBe(true)
    // Without the crowd (the three in the person's hand) and far across the field: it flies too.
    const far = errand(130, { a: 20, b: 40, c: 60, n: 110 }, ['a', 'b', 'c'])
    expect(far.some(plan => one(plan, 'main').flight === 'errand')).toBe(true)
    // Near (at column 30), with nobody in the way, it walks.
    const walked = errand(72, { n: 30 }, ['a', 'b', 'c'])
    expect(walked.some(plan => one(plan, 'main').motion?.kind === 'fly')).toBe(false)
    expect(walked.some(plan => one(plan, 'main').motion?.kind === 'walk')).toBe(true)
    // A compaction: the session flies up briefly, four seconds at least, and comes down.
    const compacted = run(tick => ({ main: { mood: 'watching', sweating: false, ...(tick < 12 ? { stretchMs: tick * SCENE_FRAME_MS } : {}) }, agents: [] }), tick => smooth(72, 12, T0 + tick, { wander: false }), 60).plans
    const [flight] = flightsOf(compacted, 'main')
    expect([...flight!.reasons]).toEqual(['compaction'])
    expect(flight!.to - flight!.from + 1).toBeGreaterThanOrEqual(FLIGHT_MIN_TICKS)
    expect(flight!.to).toBeLessThan(59)
  })

  test('no sky, no flight: the signals leave an agent at its laptop on a line under another or with under three rows', () => {
    const scene: MascotScene = { main: { mood: 'watching', sweating: false }, agents: [working('f', 'fetching'), working('e', 'reading', { role: 'explorer' })] }
    for (const rows of [4, 5, 6]) {
      const { plans } = run(() => scene, tick => smooth(72, rows, T0 + tick, { wander: false }), 30)
      expect(plans.some(plan => plan.placements.some(placed => placed.motion?.kind === 'fly')), `${rows} rows`).toBe(false)
    }
  })

  test('the classic scene keeps its flights as they were: a fetch stays at its laptop', () => {
    const { plans } = run(() => ({ main: { mood: 'watching', sweating: false }, agents: [working('f', 'fetching')] }), tick => room(72, 12, T0 + tick, { wander: false }), 30)
    expect(plans.every(plan => one(plan, 'f').motion === undefined)).toBe(true)
  })
})

describe('landing patience', () => {
  test('a flier that cannot land waits; out of patience its neighbours walk aside a cell a frame to open the nearest gap, and it lands there', () => {
    for (const smoothRules of [false, true]) {
      // A packed line: four standing a cell apart, one flier over them with nowhere clear.
      const standing = (id: string, x: number): Mover => ({ id, width: 17, body: 13, x, lo: 0, hi: 83, free: false, goal: x, sky: 8, memo: { x, lift: 0, pauseUntil: 0 } })
      const fly = { from: 900, altitude: 3, cruise: 0, stage: 'descend' as const, since: 990, waited: LANDING_PATIENCE - 3 }
      let movers: Mover[] = [
        standing('a', 0), standing('b', 20), standing('c', 44), standing('d', 70),
        { id: 'flier', width: 17, body: 13, x: 30, lo: 0, hi: 83, free: false, sky: 8, memo: { x: 30, lift: 2, target: 30, pauseUntil: 1000, fly } },
      ]
      const placed = new Map(movers.map(mover => [mover.id, mover.x]))
      let landed = -1
      for (let tick = 1000; tick < 1060; tick += 1) {
        const moved = stepField(movers, tick, { collisions: 'off', ...(smoothRules ? { smooth: true } : {}) })
        for (const mover of movers) {
          const result = moved.get(mover.id)!
          // Nobody on the ground jumps: a cell a frame at most.
          if (mover.id !== 'flier') expect(Math.abs(result.x - (placed.get(mover.id) ?? 0)), `${mover.id} @${tick}`).toBeLessThanOrEqual(1)
          placed.set(mover.id, result.x)
        }
        const flier = moved.get('flier')!
        if (landed < 0 && flier.lift === 0) landed = tick
        if (flier.lift === 0) {
          // It lands only on clear ground: everyone a cell or more apart.
          const ground = [...movers].map(mover => ({ x: moved.get(mover.id)!.x, width: mover.width })).sort((p, q) => p.x - q.x)
          for (let index = 1; index < ground.length; index += 1) expect(ground[index]!.x - (ground[index - 1]!.x + ground[index - 1]!.width), `@${tick}`).toBeGreaterThanOrEqual(GAP)
        }
        movers = movers.map(mover => ({ ...mover, x: moved.get(mover.id)!.x, memo: moved.get(mover.id)!.memo }))
        if (landed >= 0) break
      }
      expect(landed, smoothRules ? 'smooth' : 'classic').toBeGreaterThan(1000)
    }
  })
})

const flier = (id: string, x: number, target: number, extra: Partial<Mover> = {}): Mover => ({
  id, width: 17, body: 13, x, lo: 0, hi: 83, free: true, sky: 12,
  memo: { x, lift: 4, target, pauseUntil: 1000, fly: { from: 900, altitude: 4, cruise: 400, stage: 'cruise', since: 990, reason: 'idle', turnAt: 2000 } }, ...extra,
})
const standing = (id: string, x: number): Mover => ({ id, width: 17, body: 13, x, lo: 0, hi: 83, free: false, sky: 12, memo: { x, lift: 0, pauseUntil: 2000 } })
const nextMovers = (movers: Mover[], at: number): Mover[] => {
  const moved = stepField(movers, at, { smooth: true, collisions: 'rare' })
  return movers.map(one => ({ ...one, x: moved.get(one.id)!.x, memo: moved.get(one.id)!.memo }))
}

describe('flight regressions', () => {
  test('a rare wanderer lands in the one-cell gap opened after smooth patience', () => {
    let movers = [standing('a', 0), standing('b', 20), standing('c', 44), standing('d', 70), flier('f', 30, 30)]
    movers[4]!.memo = { x: 30, lift: 2, target: 30, pauseUntil: 1000, fly: { from: 900, altitude: 3, cruise: 0, stage: 'descend', since: 990, reason: 'idle', waited: SMOOTH_LANDING_PATIENCE - 1 } }
    for (let k = 1000; k < 1080 && movers[4]!.memo!.fly !== undefined; k += 1) movers = nextMovers(movers, k)
    expect(movers[4]!.memo!.fly).toBe(undefined)
    const ground = movers.sort((a, b) => a.x - b.x)
    for (let i = 1; i < ground.length; i += 1) expect(ground[i]!.x - ground[i - 1]!.x - ground[i - 1]!.width).toBeGreaterThanOrEqual(GAP)
  })

  test('an impossible landing gives up at the bounded patience', () => {
    const mover = flier('f', 0, 0, { hi: 0 })
    mover.memo = { x: 0, lift: 2, target: 0, pauseUntil: 1000, fly: { from: 900, altitude: 3, cruise: 0, stage: 'descend', since: 990, reason: 'idle', waited: LANDING_GIVE_UP } }
    const result = stepField([standing('a', 0), mover], 1000, { smooth: true }).get('f')!
    expect(result.lift).toBeLessThan(AIRBORNE)
  })

  test('a blocked hop remains a hop instead of inventing a flight', () => {
    const hopper: Mover = { ...standing('h', 20), memo: { x: 20, lift: 4, pauseUntil: 1000, hop: { from: 995, x0: 20, x1: 20, height: 4, air: 4 } } }
    const moved = stepField([standing('a', 20), hopper], 1000, { smooth: true }).get('h')!
    expect(moved.motion?.kind).toBe('hop')
    expect(moved.memo.fly).toBe(undefined)
  })

  test('a tall climb ends with the expired signal after its minimum flight', () => {
    let mover = flier('f', 10, 10, { free: false, sky: 80 })
    mover.memo = { x: 10, lift: 1, target: 10, pauseUntil: 1000, fly: { from: 1000, altitude: 70, cruise: 16, stage: 'climb', since: 1000, reason: 'fetch', minUntil: 1000 + FLIGHT_MIN_TICKS, home: 10 } }
    for (let k = 1001; k < 1040 && mover.memo!.fly !== undefined; k += 1) mover = nextMovers([mover], k)[0]!
    expect(mover.memo!.fly).toBe(undefined)
  })

  test('a new signal while descending re-climbs without landing first', () => {
    const mover = flier('f', 30, 30, { ask: { reason: 'scan', home: 18 } })
    mover.memo!.fly = { ...mover.memo!.fly!, reason: 'fetch', stage: 'descend', minUntil: 990 }
    const result = stepField([mover], 1000, { smooth: true }).get('f')!
    expect(result.memo.fly?.reason).toBe('scan')
    expect(result.memo.fly?.stage).not.toBe('descend')
    expect(result.lift).toBeGreaterThanOrEqual(4)
  })

  test('crossing flyers yield vertically and pass instead of deadlocking', () => {
    let movers = [flier('a', 10, 80), flier('b', 24, 0)]
    for (let k = 1000; k < 1040; k += 1) {
      movers = nextMovers(movers, k)
      const [a, b] = movers
      if (Math.abs(a!.memo!.lift! - b!.memo!.lift!) <= 1) expect(Math.abs(a!.x - b!.x) - 13).toBeGreaterThanOrEqual(GAP)
    }
    expect(movers[0]!.x).toBeGreaterThan(movers[1]!.x)
  })
})
