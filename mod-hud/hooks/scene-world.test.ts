import type { ClientElements } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { shadowCallStarted, shadowStepped } from './agent-shadows'
import { SLOT } from './mascot-sprites'
import { released } from './motion-physics'
import { AIRBORNE, CONTACT_COOLDOWN_MS, KNOCKED_TICKS, LANDING_GIVE_UP, PAUSE_MIN, isKnocked, pairKey } from './motion-rules'
import SceneClient from './scene-client'
import { sceneFromInputs, sceneInputsOf } from './scene-model'
import { NOW, entry, working } from './scene-model.fixtures'
import { EXIT_TICKS, FAREWELL_TICKS, SCENE_FRAME_MS, holdTicks } from './scene-phases'
import { mascotPlan } from './scene-plan'
import type { MascotPlan, MascotScene, SceneInputs } from './scene-types'
import { viewOf } from './scene-view'
import { FRAME_MS, WOBBLE_MS, createWorld, inject, pointer, receive, tick } from './scene-world'
import type { World } from './scene-world'
import { LAPTOP, TYPIST, frameLines, inputs, memoOf, press, tallInputs, ticks } from './scene-world.fixtures'
import { displayWidth } from './text-width'

// The smooth scene's world: bodies picked up and thrown, meetings in the
// air, the room's bounds, and its clock across reflows, inspection and Back.

const grab = (world: World, id: string): void => {
  frameLines(world)
  const one = viewOf(world).seen.get(id)!
  const x = Math.round(one.x) + 6
  const y = world.cur!.headroom + Math.round(one.d) + 1 - Math.round(one.lift)
  expect(world.owners?.[y]?.[x]).toBe(id)
  pointer(world, { type: 'down', x, y }, () => {})
  pointer(world, { type: 'move', x: x + 2, y: y - 2 }, () => {})
  expect(world.carried.get(id)?.mode).toBe('held')
}

describe('scene continuity regressions', () => {
  test('a spare row changes the sky without resetting walks, flights or a grip', () => {
    const board = [entry('f', { currentTool: 'WebFetch', startedAt: NOW - 60_000 }), entry('t', { currentTool: 'Edit', startedAt: NOW - 60_000 })]
    const world = createWorld(tallInputs(board))
    ticks(world, 20)
    const k = world.cur!.tick
    inject(world, 'main', { x: 9, target: 12, pauseUntil: k, d: 0 }, { drawnX: 9 })
    grab(world, 't')
    const before = viewOf(world).sprites.get('f')!.lift!
    const body = world.carried.get('t')!
    receive(world, tallInputs(board, { rows: 19 }))
    expect(world.cur!.memo.get('main')?.x).toBe(9)
    expect(viewOf(world).sprites.get('f')!.lift!).toBeGreaterThanOrEqual(before - 1)
    expect(world.carried.get('t')).toBe(body)
    expect(world.grip?.id).toBe('t')
    // A row less: the field a row shallower, the sky over its back row as it was.
    expect([world.cur!.depth, world.cur!.headroom]).toEqual([12, 4])
  })

  test('held and thrown bodies keep their depth, their floor and bounds following the field, its height and columns', () => {
    for (const mode of ['held', 'thrown'] as const) {
      const board = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => entry(id, { currentTool: 'Edit', startedAt: NOW - 600_000 + i * 1000 }))
      const world = createWorld(tallInputs(board, { rows: 16 }))
      grab(world, 'e')
      const carried = world.carried.get('e')!
      const taken = world.cur!.placements.find(one => one.id === 'e')!.d
      expect(carried.d).toBe(taken)
      expect(carried.body.maxLift).toBe(world.cur!.headroom + taken)
      carried.mode = mode
      // Preserve a thrown body long enough to observe the reflow: a field two rows deep, narrower.
      const done = board.map(one => one.id === 'a' ? { ...one, status: 'done' as const, endedAt: NOW - 60_000 } : one)
      receive(world, tallInputs(done, { rows: 9, columns: 96 }))
      tick(world)
      const placed = world.cur!.placements.find(one => one.id === 'e')!
      expect(world.cur!.depth).toBe(2)
      expect(carried.d).toBe(Math.min(taken, 1))
      expect(carried.body.maxLift).toBe(world.cur!.headroom + carried.d)
      expect(carried.body.maxX).toBe(96 - placed.width)
      if (mode === 'held') {
        pointer(world, { type: 'move', x: 40, y: 6, fine: { x: 40.5, y: 6.5 } }, () => {})
        const seen = viewOf(world).seen.get('e')!
        expect(Math.abs(world.cur!.headroom + seen.d - seen.lift - (6.5 - world.grip!.offset.y))).toBeLessThan(1e-6)
      }
    }
  })

  test('a farewell by the pipe is over before its lifecycle expires, in any pane', () => {
    for (const rows of [8, 20, 40, 80]) {
      const agent = entry('d', { status: 'done', startedAt: NOW - 60_000, endedAt: NOW })
      const world = createWorld(tallInputs([agent], { rows }))
      const hold = holdTicks({ status: 'done' }) * SCENE_FRAME_MS
      let piped = false
      let gone = -1
      for (let ms = 0; ms < (holdTicks({ status: 'done' }) + EXIT_TICKS) * SCENE_FRAME_MS; ms += FRAME_MS) {
        tick(world)
        // The pipe's lip, nine cells of red across.
        if (frameLines(world).some(row => row.includes('█████████'))) piped = true
        if (world.cur!.placements.every(one => one.id !== 'd')) {
          gone = world.sceneNow - NOW
          break
        }
      }
      expect(piped, `${rows} rows`).toBe(true)
      expect(gone, `${rows} rows`).toBeGreaterThanOrEqual(hold)
      expect(gone, `${rows} rows`).toBeLessThanOrEqual(hold + FAREWELL_TICKS * SCENE_FRAME_MS)
    }
  })

  test('rare-mode waiting landers do not knock down a standing mascot', () => {
    const world = createWorld(tallInputs([entry('f', { currentTool: 'Edit', startedAt: NOW - 60_000 }), entry('h', { currentTool: 'Edit', startedAt: NOW - 60_000 })]))
    const k = world.cur!.tick
    inject(world, 'h', { x: 30, lift: 0, pauseUntil: k + 400, d: 0 }, { drawnX: 30 })
    inject(world, 'f', { x: 30, lift: 2, target: 30, pauseUntil: k, d: 0, fly: { from: k - 40, altitude: 3, cruise: 16, stage: 'descend', since: k, reason: 'fetch', minUntil: k - 1 } }, { drawnX: 30, lift: 2, motion: { kind: 'fly', step: 40, lift: 2 } })
    ticks(world, 10)
    expect(world.cur!.memo.get('h')?.fallFrom).toBe(undefined)
    expect(world.carried.has('f')).toBe(false)
  })

  test('throws cannot take over arriving or leaving lifecycle motion', () => {
    for (const agent of [entry('n', { startedAt: NOW, currentTool: 'Edit' }), entry('n', { status: 'done', startedAt: NOW - 60_000, endedAt: NOW - 3500 })]) {
      const world = createWorld(tallInputs([agent], { rows: 16 }))
      ticks(world, 16)
      grab(world, 'main')
      const target = viewOf(world).seen.get('n')!
      const body = world.carried.get('main')!
      world.grip = undefined
      body.mode = 'thrown'
      body.body = released(target.x + 4, target.lift, -30, 0, body.body)
      for (let i = 0; i < 10; i += 1) {
        tick(world)
        expect(world.carried.has('n')).toBe(false)
        expect(world.cur!.memo.get('n')?.fallFrom).toBe(undefined)
      }
    }
  })

  test('hops do not collide with a mascot in the pipe, arriving or leaving', () => {
    for (const agent of [entry('n', { startedAt: NOW - 600, currentTool: 'Edit' }), entry('n', { status: 'done', startedAt: NOW - 60_000, endedAt: NOW - 3100 })]) {
      const world = createWorld(tallInputs([agent], { rows: 16 }))
      const target = viewOf(world).seen.get('n')!
      expect(['arrive', 'leave']).toContain(world.cur!.placements.find(one => one.id === 'n')?.phase?.kind)
      const k = world.cur!.tick
      inject(world, 'main', { x: target.x, lift: 0, pauseUntil: k, d: Math.round(target.d), hop: { from: k, x0: target.x, x1: target.x, air: 4, height: 4 } }, { drawnX: target.x, d: Math.round(target.d), lift: 0 })
      ticks(world, 10)
      expect(world.carried.has('n')).toBe(false)
      expect(world.carried.has('main')).toBe(false)
      expect(world.cur!.memo.get('n')?.fallFrom).toBe(undefined)
    }
  })

  test('a fresh down and ten seconds without movement both release a lost pointer-up', () => {
    for (const release of ['down', 'timeout']) {
      const world = createWorld(tallInputs([entry('t', { currentTool: 'Edit', startedAt: NOW - 60_000 })]))
      grab(world, 't')
      if (release === 'down') pointer(world, { type: 'down', x: 0, y: 0 }, () => {})
      else ticks(world, 10_000 / FRAME_MS)
      expect(world.grip).toBe(undefined)
      expect(world.carried.get('t')?.mode).not.toBe('held')
    }
  })

  test('ground and surface contacts share pair cooldowns in both directions', () => {
    const world = createWorld(tallInputs([entry('a', { currentTool: 'Edit', startedAt: NOW - 60_000 }), entry('b', { currentTool: 'Edit', startedAt: NOW - 60_000 })]))
    const key = pairKey('a', 'b')
    world.cur = { ...world.cur!, contacts: new Map([[key, world.cur!.tick]]) }
    grab(world, 'b')
    const carried = world.carried.get('b')!
    const a = viewOf(world).seen.get('a')!
    world.grip = undefined
    carried.mode = 'thrown'
    carried.body = released(a.x + 4, 0, -30, 0, carried.body)
    tick(world)
    expect(world.cur!.memo.get('a')?.fallFrom).toBe(undefined)
    // Surface contact history must feed the next choreography plan too.
    world.contacts.set(key, world.sceneNow)
    inject(world, 'main', { x: 0, d: 0, pauseUntil: world.cur!.tick })
    expect(world.next!.contacts.get(key)).toBe(world.sceneNow / SCENE_FRAME_MS)
  })

  test('inspect pauses local time and preserves bodies until Back', () => {
    const world = createWorld(tallInputs([entry('t', { currentTool: 'Edit', startedAt: NOW - 60_000 })]))
    grab(world, 't')
    const cur = world.cur
    const body = world.carried.get('t')
    const at = world.sceneNow
    const contact = pairKey('main', 't')
    world.contacts.set(contact, at)
    receive(world, { ...world.props, paused: true, now: NOW + 5000 } as SceneInputs)
    ticks(world, 100)
    expect(world.sceneNow).toBe(at)
    expect(world.cur).toBe(cur)
    expect(world.carried.get('t')).toBe(body)
    expect(frameLines(world)).toEqual([])
    receive(world, { ...world.props, paused: false, now: NOW + 10_000 } as SceneInputs)
    tick(world)
    expect(world.sceneNow).toBe(NOW + 10_000 + FRAME_MS)
    expect(world.contacts.get(contact)).toBe(at)
    expect(world.carried.get('t')).toBe(body)
    receive(world, { ...world.props, now: NOW + 10_000 + FRAME_MS })
    tick(world)
    expect(world.sceneNow).toBe(NOW + 10_000 + 2 * FRAME_MS)
    expect(world.carried.get('t')).toBe(body)
  })

  test('identical still drawings do not call the local setState each frame', () => {
    let state: Parameters<typeof SceneClient>[1]['state']
    let every: (() => void) | undefined
    let writes = 0
    const elements = { Box: (props: unknown) => ({ type: 'Box', props }), Text: (props: unknown) => ({ type: 'Text', props }) } as unknown as ClientElements
    const surface = { elements, get state() { return state }, setState: (next: typeof state) => { state = next; writes += 1 }, every: (_ms: number, fn: () => void) => { every = fn; return () => { every = undefined } }, onPointer: () => {}, post: () => {} } as unknown as Parameters<typeof SceneClient>[1]
    const props = tallInputs([entry('t', { currentTool: 'Edit', startedAt: NOW - 60_000 })], { rows: 4 })
    SceneClient(props as never, surface)
    const before = writes
    // The watching mascot blinks at the next quarter-second, not every 50 ms.
    every!()
    every!()
    expect(writes).toBe(before)
    for (let i = 0; i < 40; i += 1) every!()
    expect(writes - before).toBeLessThan(15)
    expect(writes - before).toBeGreaterThan(0)
  })
})

describe('review clock and layout regressions', () => {
  test('a spawn after Back takes the pipe within 1.5 seconds, and a completion cheers and leaves', () => {
    const world = createWorld(tallInputs())
    receive(world, { ...world.props, paused: true, now: NOW + 1000 })
    receive(world, { ...world.props, paused: false, now: NOW + 60_000 })
    const spawned = entry('new', { startedAt: NOW + 60_000, lastActivityAt: NOW + 60_000 })
    receive(world, tallInputs([spawned], { now: NOW + 60_000 }))
    let arrived = false
    let arrivalPipe = false
    for (let i = 0; i <= 1500 / FRAME_MS; i += 1) {
      const phase = world.cur?.placements.find(one => one.id === 'new')?.phase
      arrived ||= phase?.kind === 'arrive'
      arrivalPipe ||= frameLines(world).some(row => row.includes('█████████'))
      tick(world)
    }
    expect(arrived).toBe(true)
    expect(arrivalPipe).toBe(true)
    const endedAt = world.sceneNow
    receive(world, tallInputs([{ ...spawned, status: 'done', endedAt }], { now: endedAt }))
    let cheered = false
    let pipe = false
    for (let i = 0; i < 12_000 / FRAME_MS; i += 1) {
      const phase = world.cur?.placements.find(one => one.id === 'new')?.phase
      cheered ||= phase?.kind === 'cheer'
      pipe ||= phase?.kind === 'leave' && frameLines(world).some(row => row.includes('█████████'))
      tick(world)
    }
    expect(cheered).toBe(true)
    expect(pipe).toBe(true)
    expect(world.cur?.placements.some(one => one.id === 'new')).toBe(false)
  })

  test('workflow arrival starts when a delayed loop becomes visible, once, in the visibility write', () => {
    let shadows = shadowStepped({}, 'wf', {}, NOW - 10_000)
    expect(shadows.wf?.visibleAt).toBe(undefined)
    shadows = shadowStepped(shadows, 'wf', {}, NOW)
    expect(shadows.wf?.visibleAt).toBe(NOW)
    const props = sceneInputsOf([], Object.values(shadows), undefined, tallInputs())
    expect(sceneFromInputs(props, NOW).agents[0]?.ageMs).toBe(0)
    expect(mascotPlan(sceneFromInputs(props, NOW), { columns: 100, rows: 20, tick: NOW / SCENE_FRAME_MS })?.placements.find(one => one.id === 'wf')?.phase?.kind).toBe('arrive')
    shadows = shadowCallStarted(shadows, 'wf', 'Edit', NOW + 1000)
    expect(shadows.wf?.visibleAt).toBe(NOW)
    const firstCall = shadowCallStarted({}, 'call', 'Edit', NOW)
    expect(firstCall.call?.visibleAt).toBe(NOW)
  })

  test('pause cancels the Client interval and Back starts exactly one replacement', () => {
    let state: Parameters<typeof SceneClient>[1]['state']
    const active = new Set<() => void>()
    let starts = 0
    let stops = 0
    const elements = { Box: (props: unknown) => ({ type: 'Box', props }), Text: (props: unknown) => ({ type: 'Text', props }) } as unknown as ClientElements
    const surface = { elements, get state() { return state }, setState: (next: typeof state) => { state = next }, every: (_ms: number, fn: () => void) => { starts += 1; active.add(fn); return () => { stops += 1; active.delete(fn) } }, onPointer: () => {}, post: () => {} } as unknown as Parameters<typeof SceneClient>[1]
    const props = tallInputs()
    SceneClient(props as never, surface)
    expect(active.size).toBe(1)
    SceneClient({ ...props, paused: true } as never, surface)
    SceneClient({ ...props, paused: true } as never, surface)
    expect(active.size).toBe(0)
    expect(stops).toBe(1)
    SceneClient({ ...props, now: NOW + 5000 } as never, surface)
    SceneClient({ ...props, now: NOW + 5000 } as never, surface)
    expect(active.size).toBe(1)
    expect(starts).toBe(2)
  })

  test('still bodies do not overlap during thirty seconds of reflows across 20–130 columns, 4–40 rows and 3–24 agents', { timeoutMs: 120_000 }, () => {
    for (let columns = 20; columns <= 130; columns += 1) {
      for (let count = 3; count <= 24; count += 1) {
        let plan: MascotPlan | undefined
        for (let frame = 0; frame <= 120; frame += 1) {
          const scene: MascotScene = { main: { mood: 'idle', sweating: false }, agents: Array.from({ length: count }, (_, i) => {
            const end = 8 + i % 16
            return working(`a${i}`, 'typing', frame < end ? {} : { status: 'done', endedMs: (frame - end) * SCENE_FRAME_MS })
          }) }
          plan = mascotPlan(scene, { columns, rows: 4 + (frame + columns) % 37, tick: 1000 + frame, motion: 'smooth', wander: false, scenes: false, collisions: 'off' }, plan)
          const still = (plan?.placements ?? []).filter(one => one.kind !== 'strip' && one.motion === undefined && (one.lift ?? 0) === 0 && one.phase?.kind !== 'arrive' && one.phase?.kind !== 'leave')
          for (let i = 0; i < still.length; i += 1) for (let j = i + 1; j < still.length; j += 1) {
            const a = still[i]!, b = still[j]!
            if (Math.abs(a.d - b.d) >= 1) continue
            const gap = a.drawnX <= b.drawnX ? b.drawnX - a.drawnX - a.width : a.drawnX - b.drawnX - b.width
            expect(gap, `${columns} cols, frame ${frame}, ${a.id}/${b.id}`).toBeGreaterThanOrEqual(0)
          }
        }
      }
    }
  })
})

describe('throws', () => {
  /** Agents at their laptops in a field a row deep (eight rows): all within reach of a throw along its floor. */
  const lineUp = (): World => createWorld(inputs(['a', 'b', 'c', 'd'].map(id => entry(id, { currentTool: 'Edit', startedAt: NOW - 60_000 })), { columns: 110, rows: 8 }))

  /** `id` thrown left along the line a row off the floor: picked up, carried right, held still, flicked. Where it went, low to high. */
  const throwLeft = (world: World, id: string): { from: number; to: number } => {
    const at = press(world, id)
    const posts: unknown[] = []
    pointer(world, { type: 'down', x: at.x, y: at.y, button: 'left' }, data => posts.push(data))
    pointer(world, { type: 'move', x: at.x + 14, y: at.y - 1, button: 'left' }, () => {})
    ticks(world, 4)
    // Three cells a frame (60 a second), let go mid-flick.
    for (const dx of [-3, -6]) {
      pointer(world, { type: 'move', x: at.x + 14 + dx, y: at.y - 1, button: 'left' }, () => {})
      tick(world)
    }
    pointer(world, { type: 'move', x: at.x + 5, y: at.y - 1, button: 'left' }, () => {})
    pointer(world, { type: 'up', x: at.x + 5, y: at.y - 1, button: 'left' }, () => {})
    expect(world.carried.get(id)?.body.vx).toBeLessThan(-16)
    const from = world.carried.get(id)!.body.x
    let to = from
    for (let frame = 0; frame < 120 && world.carried.size > 0; frame += 1) {
      tick(world)
      to = Math.min(to, world.carried.get(id)?.body.x ?? to)
    }
    expect(posts).toEqual([])

    return { from, to }
  }

  test('thrown along the floor it knocks over every mascot it passes through, bowling-pin style, and goes down too', () => {
    const world = lineUp()
    ticks(world, 4)
    const slots = new Map(world.cur!.placements.map(one => [one.id, one.x]))
    const path = throwLeft(world, 'd')
    const now = world.cur!.tick
    // Its body (columns 2 to 10 of its slot) swept from where it was let go to where it stopped.
    const swept = (id: string): boolean => (slots.get(id) ?? 0) + 2 < path.from + 11 && path.to + 2 < (slots.get(id) ?? 0) + 11
    const hit = ['main', 'a', 'b', 'c'].filter(swept)
    expect(hit.length).toBeGreaterThanOrEqual(2)
    for (const id of ['main', 'a', 'b', 'c']) expect(isKnocked(memoOf(world, id), now), id).toBe(hit.includes(id))
    expect(isKnocked(memoOf(world, 'd'), now)).toBe(true)
    // Up again, and thrown through them once more inside the cooldown: nobody goes down twice.
    ticks(world, ((KNOCKED_TICKS + PAUSE_MIN) * SCENE_FRAME_MS) / FRAME_MS)
    const before = new Map(hit.map(id => [id, memoOf(world, id)?.fallFrom]))
    throwLeft(world, 'd')
    for (const id of hit) expect(memoOf(world, id)?.fallFrom, id).toBe(before.get(id))
    expect(CONTACT_COOLDOWN_MS.rare).toBe(30_000)
  })

  test('hitting a flier drops both, dizzy', () => {
    // A field two rows deep: the two always within a row of depth of each other.
    const world = createWorld(inputs([entry('f', { currentTool: 'WebFetch', startedAt: NOW - 60_000 }), entry('t', { currentTool: 'Edit', startedAt: NOW - 60_000 })], { columns: 110, rows: 9 }))
    ticks(world, 30)
    const flier = viewOf(world).seen.get('f')!
    expect(flier.lift).toBeGreaterThanOrEqual(AIRBORNE)
    const at = press(world, 't')
    const own = viewOf(world).seen.get('t')!
    pointer(world, { type: 'down', x: at.x, y: at.y, button: 'left' }, () => {})
    // Carried to the flier's height, a few cells right of it, held still, then flicked into it.
    const aim = (): { x: number; y: number } => {
      const now = viewOf(world).seen.get('f')!
      return { x: Math.round(now.x + 14 - own.x + at.x), y: at.y - Math.round(now.lift) }
    }
    pointer(world, { type: 'move', ...aim(), button: 'left' }, () => {})
    ticks(world, 4)
    pointer(world, { type: 'move', ...aim(), button: 'left' }, () => {})
    tick(world)
    const close = aim()
    pointer(world, { type: 'move', x: close.x - 4, y: close.y, button: 'left' }, () => {})
    pointer(world, { type: 'up', x: close.x - 4, y: close.y, button: 'left' }, () => {})
    let fell = false
    for (let frame = 0; frame < 120 && (world.carried.size > 0 || !fell); frame += 1) {
      tick(world)
      if (world.carried.get('f')?.mode === 'tumble') fell = true
    }
    expect(fell).toBe(true)
    expect(memoOf(world, 'f')?.fallFrom).toBeDefined()
    expect(memoOf(world, 't')?.fallFrom).toBeDefined()
    expect(memoOf(world, 'f')?.fly).toBe(undefined)
  })

  test('dropped from under three rows it is set down with a squash; from higher it bounces and wobbles; from high it is knocked out', () => {
    const drop = (rows: number): { knocked: boolean; wobbled: boolean } => {
      // A shallow field under a tall sky: seven rows or more over the agent's box wherever its slot.
      const world = createWorld(inputs([TYPIST], { columns: 40, rows: 12 }))
      tick(world)
      const at = press(world, 'a')
      pointer(world, { type: 'down', x: at.x, y: at.y, button: 'left' }, () => {})
      pointer(world, { type: 'move', x: at.x + 1, y: at.y - rows, button: 'left' }, () => {})
      ticks(world, 4)
      pointer(world, { type: 'up', x: at.x + 1, y: at.y - rows, button: 'left' }, () => {})
      let wobbled = false
      for (let frame = 0; frame < 80 && world.carried.size > 0; frame += 1) tick(world)
      for (let frame = 0; frame < 4; frame += 1) {
        if (viewOf(world).sprites.get('a')?.nudge !== undefined) wobbled = true
        tick(world)
      }
      return { knocked: memoOf(world, 'a')?.fallFrom !== undefined, wobbled }
    }
    expect(drop(1)).toEqual({ knocked: false, wobbled: false })
    expect(drop(2)).toEqual({ knocked: false, wobbled: false })
    expect(drop(4)).toEqual({ knocked: false, wobbled: true })
    expect(drop(7)).toEqual({ knocked: true, wobbled: false })
    expect(WOBBLE_MS).toBe(700)
  })

  test('with sub-cell positions (fine) the held mascot follows the pointer to the fraction of a cell; without, by the cell\'s centre', () => {
    const world = createWorld(inputs([TYPIST], { columns: 72, rows: 12 }))
    tick(world)
    const at = press(world, 'a')
    pointer(world, { type: 'down', x: at.x, y: at.y, fine: { x: at.x + 0.25, y: at.y + 0.5 }, button: 'left' }, () => {})
    pointer(world, { type: 'move', x: at.x + 3, y: at.y - 2, fine: { x: at.x + 3.875, y: at.y - 1.5 }, button: 'left' }, () => {})
    const held = world.carried.get('a')!.body
    const slot = world.cur!.placements.find(one => one.id === 'a')!.x
    expect(held.x - slot).toBe(3.625)
    expect(held.lift).toBe(2)
    pointer(world, { type: 'move', x: at.x + 5, y: at.y - 2, button: 'left' }, () => {})
    // No fine: the cell's centre (x + 0.5) against the press's fine 0.25.
    expect(world.carried.get('a')!.body.x - slot).toBe(5.25)
  })

  test('set down away from its place, one that does not wander walks home a cell every 250 ms, its laptop out again once there', () => {
    const world = createWorld(inputs([TYPIST], { columns: 72, rows: 12 }))
    tick(world)
    const slot = world.cur!.placements.find(one => one.id === 'a')!.x
    const at = press(world, 'a')
    pointer(world, { type: 'down', x: at.x, y: at.y, button: 'left' }, () => {})
    pointer(world, { type: 'move', x: at.x + 12, y: at.y, button: 'left' }, () => {})
    ticks(world, 4)
    pointer(world, { type: 'up', x: at.x + 12, y: at.y, button: 'left' }, () => {})
    for (let frame = 0; frame < 20 && world.carried.size > 0; frame += 1) tick(world)
    expect(memoOf(world, 'a')?.fallFrom).toBe(undefined)
    expect(world.cur!.homing?.has('a')).toBe(true)
    const xs: number[] = []
    for (let frame = 0; frame < 400 && (xs.at(-1) ?? -1) !== slot; frame += 1) {
      tick(world)
      xs.push(viewOf(world).sprites.get('a')!.x!)
    }
    expect(xs[0]).toBeGreaterThan(slot + 10)
    xs.forEach((x, index) => index > 0 && expect(Math.abs(x - xs[index - 1]!)).toBeLessThanOrEqual(0.2 + 1e-6))
    expect(xs.at(-1)).toBe(slot)
    ticks(world, 10)
    expect(world.cur!.homing?.has('a')).toBe(false)
    expect(frameLines(world).join('\n')).toContain(LAPTOP)
  })

  test('one in the person\'s hand is no scene\'s target and gives no cue; the rest go on without it', () => {
    const world = createWorld(inputs([entry('n', { startedAt: NOW - 3000, currentTool: 'Edit' })], { scenes: true }))
    tick(world)
    const at = press(world, 'main')
    pointer(world, { type: 'down', x: at.x, y: at.y, button: 'left' }, () => {})
    pointer(world, { type: 'move', x: at.x + 2, y: at.y - 2, button: 'left' }, () => {})
    for (let frame = 0; frame < 40; frame += 1) {
      tick(world)
      const main = world.cur!.placements.find(one => one.id === 'main')!
      expect(main.cues ?? []).toEqual([])
      expect(main.motion).toBe(undefined)
      expect(world.cur!.memo.has('main')).toBe(false)
    }
    // A plan with the session held: nobody walks to it, and the newcomer still takes its place.
    const scene = sceneFromInputs(world.props, world.sceneNow)
    const plan = mascotPlan(scene, { columns: 100, rows: 16, tick: world.cur!.tick + 1, scenes: true, motion: 'smooth', held: ['main'] }, world.cur)!
    expect(plan.placements.find(one => one.id === 'main')?.cues).toBe(undefined)
  })
})

describe('in the air', () => {
  /** A world with a flier cruising at `lift` over x 30 and a wanderer standing under it at `x`, both at the front of the field (the most sky). */
  const front = (world: World): number => world.cur!.depth - 1
  const sky = (lift: number, x: number): World => {
    const world = createWorld(inputs([entry('f', { currentTool: 'WebFetch', startedAt: NOW - 60_000 }), entry('h', { startedAt: NOW - 60_000 })], { columns: 110, rows: 16, wander: true }))
    tick(world)
    const k = world.cur!.tick
    const d = front(world)
    // Heading slowly left across its row of depth: it roams no other way meanwhile.
    inject(world, 'f', { x: 30, d, lift, target: 0, targetD: d, pauseUntil: k, fly: { from: k - 40, altitude: lift, cruise: 16, stage: 'cruise', since: k - 20, reason: 'fetch', minUntil: k + 400, turnAt: k + 400, home: 30, homeD: d } }, { drawnX: 30, d, lift, motion: { kind: 'fly', step: 40, lift } })
    inject(world, 'h', { x, d, lift: 0, pauseUntil: k + 400 }, { drawnX: x, d })

    return world
  }

  test('a hop rising into a flier from below bonks: the hopper drops, dizzy; the flier is knocked up a row, wobbles, and flies on', () => {
    const world = sky(6, 32)
    const k = world.cur!.tick
    inject(world, 'h', { x: 32, d: front(world), lift: 0, pauseUntil: k, hop: { from: k + 1, x0: 32, x1: 34, air: 4, height: 4 } }, { drawnX: 32 })
    let bonked = false
    for (let frame = 0; frame < 60 && !bonked; frame += 1) {
      tick(world)
      bonked = world.carried.get('h')?.mode === 'tumble'
    }
    expect(bonked).toBe(true)
    expect(world.carried.get('h')?.knock).toBe(true)
    expect(memoOf(world, 'f')?.fly?.altitude).toBe(7)
    expect(world.carried.has('f')).toBe(false)
    expect(viewOf(world).sprites.get('f')?.nudge).toBeDefined()
    for (let frame = 0; frame < 60 && world.carried.size > 0; frame += 1) tick(world)
    expect(memoOf(world, 'h')?.fallFrom).toBeDefined()
    expect(memoOf(world, 'f')?.fly).toBeDefined()
  })

  test('a hop coming down onto a flier rides it a second as it sinks a row, then both tumble down, dizzy', () => {
    const world = sky(2, 50)
    const k = world.cur!.tick
    // A high hop from the right: up beside the flier, down onto its cap.
    inject(world, 'h', { x: 50, d: front(world), lift: 0, pauseUntil: k, hop: { from: k + 1, x0: 50, x1: 20, air: 4, height: 7 } }, { drawnX: 50 })
    let rode = false
    for (let frame = 0; frame < 60 && !rode; frame += 1) {
      tick(world)
      rode = world.carried.get('h')?.mode === 'ride'
    }
    expect(rode).toBe(true)
    expect(memoOf(world, 'f')?.fly?.altitude).toBe(AIRBORNE)
    // Riding: on the flier's cap, the flier still up.
    tick(world)
    const rider = world.carried.get('h')!
    expect(rider.body.lift).toBeGreaterThanOrEqual(viewOf(world).seen.get('f')!.lift + 3)
    for (let frame = 0; frame < 120 && (world.carried.size > 0 || memoOf(world, 'f')?.fallFrom === undefined); frame += 1) tick(world)
    expect(memoOf(world, 'h')?.fallFrom).toBeDefined()
    expect(memoOf(world, 'f')?.fallFrom).toBeDefined()
  })

  test('in normal mode a flier coming down onto one standing knocks both down, dizzy', () => {
    const world = sky(3, 30)
    receive(world, inputs([entry('f', { currentTool: 'Edit', startedAt: NOW - 60_000 }), entry('h', { startedAt: NOW - 60_000 })], { columns: 110, rows: 16, wander: true, collisions: 'normal' }))
    const k = world.cur!.tick
    const d = front(world)
    inject(world, 'h', { x: 30, d, lift: 0, pauseUntil: k + 400 }, { drawnX: 30, d, lift: 0 })
    // Begin a real descending segment; a waiting lander has zero velocity.
    inject(world, 'f', { x: 30, d, lift: 2, target: 30, targetD: d, pauseUntil: k, fly: { from: k - 40, altitude: 3, cruise: 16, stage: 'descend', since: k, reason: 'fetch', minUntil: k - 1, waited: LANDING_GIVE_UP } }, { drawnX: 30, d, lift: 2, motion: { kind: 'fly', step: 40, lift: 2 } })
    expect(viewOf(world).seen.get('f')!.vy).toBeLessThan(0)
    for (let frame = 0; frame < 60 && memoOf(world, 'h')?.fallFrom === undefined; frame += 1) tick(world)
    expect(memoOf(world, 'h')?.fallFrom).toBeDefined()
    for (let frame = 0; frame < 60 && world.carried.size > 0; frame += 1) tick(world)
    expect(memoOf(world, 'f')?.fallFrom).toBeDefined()
  })

  test('with collisions off nobody meets in the air, and a throw knocks nobody over', () => {
    const world = createWorld(inputs(['a', 'b'].map(id => entry(id, { currentTool: 'Edit', startedAt: NOW - 60_000 })), { columns: 110, rows: 12, collisions: 'off' }))
    tick(world)
    const at = press(world, 'b')
    pointer(world, { type: 'down', x: at.x, y: at.y, button: 'left' }, () => {})
    pointer(world, { type: 'move', x: at.x + 10, y: at.y, button: 'left' }, () => {})
    ticks(world, 4)
    pointer(world, { type: 'move', x: at.x + 4, y: at.y, button: 'left' }, () => {})
    tick(world)
    pointer(world, { type: 'up', x: at.x - 2, y: at.y, button: 'left' }, () => {})
    for (let frame = 0; frame < 80 && world.carried.size > 0; frame += 1) tick(world)
    expect(memoOf(world, 'a')?.fallFrom).toBe(undefined)
    expect(memoOf(world, 'main')?.fallFrom).toBe(undefined)
  })
})

describe('the room', () => {
  for (const [low, high] of [[20, 47], [48, 75], [76, 103], [104, 130]] as const) test(`every frame, from ${low} to ${high} columns: as many rows as the region, none wider than the pane, flights, arrivals and throws included`, { timeoutMs: 60_000 }, () => {
    const board = [
      entry('t', { currentTool: 'Edit', startedAt: NOW - 90_000 }),
      entry('e', { type: 'Explore', currentTool: 'Read', startedAt: NOW - 80_000 }),
      entry('f', { currentTool: 'WebFetch', startedAt: NOW - 70_000 }),
      entry('r', { type: 'reviewer', currentTool: 'Read', readingSince: NOW - 9000, startedAt: NOW - 60_000 }),
      entry('k', { parentId: 't', startedAt: NOW - 50_000 }),
      entry('n', { startedAt: NOW - 1000 }),
      entry('d', { status: 'done', startedAt: NOW - 60_000, endedAt: NOW - 4000 }),
      entry('x', { status: 'failed', startedAt: NOW - 60_000, endedAt: NOW - 1000 }),
      entry('s', { startedAt: NOW - 400_000, lastActivityAt: NOW - 300_000 }),
    ]
    for (let columns = low; columns <= high; columns += 1) {
      for (const rows of [4, 6, 9, 13]) {
        const world = createWorld(inputs(board, { columns, rows, wander: true, scenes: true, collisions: 'normal' }))
        for (let frame = 0; frame < 24; frame += 1) {
          tick(world)
          if (frame === 6 && columns >= SLOT) {
            const at = (() => {
              try {
                return press(world, 'main')
              } catch {
                return undefined
              }
            })()
            if (at !== undefined) {
              pointer(world, { type: 'down', x: at.x, y: at.y, button: 'left' }, () => {})
              pointer(world, { type: 'move', x: at.x + 3, y: Math.max(0, at.y - 2), button: 'left' }, () => {})
            }
          }
          if (frame === 9) pointer(world, { type: 'up', x: 0, y: 0, button: 'left' }, () => {})
          const lines = frameLines(world)
          if (columns < SLOT) continue
          expect(lines.length, `${columns}x${rows}`).toBe(rows)
          for (const line of lines) expect(displayWidth(line), `${columns}x${rows} @${frame}: ${line}`).toBeLessThanOrEqual(columns)
        }
      }
    }
  })
})
