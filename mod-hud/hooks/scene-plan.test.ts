import { describe, expect, test } from 'claude-code/testing'

import type { AgentBoardEntry } from '../types'
import { HEADS, SLOT } from './mascot-sprites'
import { sceneOf } from './scene-model'
import { NOW, entry, idleHud, working } from './scene-model.fixtures'
import { ARRIVE_TICKS, DELIVER_TICKS, HANDOFF_TICKS, PACK_TICKS, SCENE_FRAME_MS, SETUP_TICKS } from './scene-phases'
import { mascotPlan } from './scene-plan'
import { T0, lineRows, room, run, slotted } from './scene-plan.fixtures'
import { mascotLines } from './scene-render'
import type { MascotLayout, MascotPlan, MascotScene } from './scene-types'

// The orchestration scenes `mascotPlan` plays: handing a task over and a
// report back, messages, review and fix visits, a parent pointing at its
// child, a workflow squad's baton.

/** Like `run`, with some mascots first standing elsewhere (as if they had wandered there). */
const runFrom = (sceneAt: (tick: number) => MascotScene, layoutAt: (tick: number) => MascotLayout, frames: number, at: Record<string, number>): { plans: MascotPlan[]; lines: string[][] } => {
  const first = mascotPlan(sceneAt(0), layoutAt(0))!
  const memo = new Map(first.memo)
  for (const [id, x] of Object.entries(at)) memo.set(id, { x, d: 0, pauseUntil: layoutAt(0).tick })
  const plans: MascotPlan[] = []
  const lines: string[][] = []
  let previous: MascotPlan = { ...first, memo }
  for (let frame = 1; frame <= frames; frame += 1) {
    const plan = mascotPlan(sceneAt(frame), layoutAt(frame), previous)!
    plans.push(plan)
    lines.push(mascotLines(sceneAt(frame), layoutAt(frame), plan) ?? [])
    previous = plan
  }

  return { plans, lines }
}

describe('orchestration scenes', () => {
  const S = SCENE_FRAME_MS
  const at = (tick: number) => NOW + tick * S

  /** Plans and lines for a board at each of `frames` ticks from NOW. */
  const play = (board: (now: number) => AgentBoardEntry[], frames: number, scenes = true, columns = 100) => {
    const sceneAt = (tick: number) => sceneOf(board(at(tick)), idleHud, at(tick), { scenes })
    const out = run(sceneAt, tick => room(columns, 8, T0 + tick, { scenes, collisions: 'off' }), frames)

    return { ...out, scenes: Array.from({ length: frames }, (_, tick) => sceneAt(tick)) }
  }
  const find = (plan: MascotPlan | undefined, id: string) => plan?.placements.find(one => one.id === id)

  test('delegate: the session walks to a new agent and holds out its hand with the task (nothing drawn in it); it takes it, then turns to its desk', () => {
    const { plans, lines } = play(() => [entry('new', { startedAt: NOW, lastActivityAt: NOW })], 22)
    // It goes to meet the newcomer as it comes out of the pipe, a cell a frame.
    const mainX = plans.map(plan => find(plan, 'main')?.drawnX ?? -1)
    expect(Math.max(...mainX)).toBeGreaterThan(0)
    expect(mainX.every((x, index, all) => index === 0 || Math.abs(x - all[index - 1]!) <= 1)).toBe(true)
    expect(find(plans[0], 'new')?.phase).toEqual({ kind: 'arrive', step: 0 })
    const give = ARRIVE_TICKS
    expect(find(plans[give], 'main')?.cues).toContain('give-scroll')
    expect(find(plans[give], 'new')?.phase).toEqual({ kind: 'take', step: 0 })
    const mx = find(plans[give], 'main')!.drawnX
    // Its right arm out on its torso row: its box's column 10.
    expect(lineRows(lines[give]!, plans[give]!)[2]?.[mx + 10]).toBe('▀')
    expect(lines.every(frame => !/[≣▯]/.test(frame.join('')))).toBe(true)
    expect(find(plans[give + HANDOFF_TICKS], 'new')?.phase).toEqual({ kind: 'setup', step: 0 })
  })

  test('a spawner agent hands its own child its task; without the scenes, no hand-off and nobody walks', () => {
    const board = () => [entry('boss', { startedAt: NOW - 60_000 }), entry('kid', { parentId: 'boss', startedAt: NOW, lastActivityAt: NOW })]
    const { plans } = play(board, 16)
    expect(find(plans[ARRIVE_TICKS], 'boss')?.cues).toContain('give-scroll')
    expect(find(plans[ARRIVE_TICKS], 'main')?.cues).toBe(undefined)
    const off = play(board, 20, false)
    expect(off.plans.every(plan => plan.placements.every(one => one.cues === undefined))).toBe(true)
    expect(off.lines.every(frame => !frame.join('').includes('≣'))).toBe(true)
    expect(new Set(off.plans.map(plan => find(plan, 'main')?.drawnX)).size).toBe(1)
  })

  test('hand back: done, it packs up, walks to its spawner, holds out its hand; the spawner nods, then the cheer', () => {
    const board = () => [entry('done', { startedAt: NOW - 60_000, status: 'done', endedAt: NOW })]
    // It had wandered off to column 40.
    const ran = runFrom(tick => sceneOf(board(), idleHud, at(tick), { scenes: true }), tick => room(100, 8, T0 + tick, { scenes: true, collisions: 'off' }), 30, { done: 40 })
    const plans = [mascotPlan(sceneOf(board(), idleHud, at(0), { scenes: true }), room(100, 8, T0, { scenes: true, collisions: 'off' }))!, ...ran.plans]
    const lines = [[], ...ran.lines]
    const kinds = plans.map(plan => find(plan, 'done')?.phase?.kind)
    expect(kinds.slice(0, PACK_TICKS)).toEqual(Array(PACK_TICKS).fill('pack'))
    expect(kinds.slice(PACK_TICKS, PACK_TICKS + DELIVER_TICKS)).toEqual(Array(DELIVER_TICKS).fill('deliver'))
    const xs = plans.slice(PACK_TICKS, PACK_TICKS + DELIVER_TICKS).map(plan => find(plan, 'done')!.drawnX)
    expect(xs.every((x, index) => index === 0 || x === xs[index - 1]! - 1)).toBe(true)
    expect(xs.at(-1)! < 40).toBe(true)
    const hand = PACK_TICKS + DELIVER_TICKS
    const dx = find(plans[hand], 'done')!.drawnX
    // Its arm out at the end of its torso (a row up and leaning on a step's bounce, still walking up).
    expect([1, 2].flatMap(row => [9, 10].map(column => lineRows(lines[hand]!, plans[hand]!)[row]?.[dx + column]))).toContain('▀')
    expect(find(plans[hand + 1], 'main')?.cues).toEqual(['take-report', 'nod'])
    const mx = find(plans[hand + 1], 'main')!.drawnX
    // The nod: eyes shut a frame.
    expect(lineRows(lines[hand + 1]!, plans[hand + 1]!)[1]?.slice(mx + 2, mx + 11)).toBe(HEADS.shut)
    expect(lines.every(frame => !/[▯≣]/.test(frame.join('')))).toBe(true)
    expect(kinds[hand + 2]).toBe('cheer')
  })

  test('messages: a bubble travels a cell a frame along the air row to the receiver, who glances up; no message, no bubble', () => {
    const board = [entry('from', { startedAt: NOW - 60_000 }), entry('to', { startedAt: NOW - 59_000 })]
    const events = [{ kind: 'message' as const, from: 'from', to: 'to', tick: T0 }]
    const sceneAt = (tick: number) => sceneOf(board, idleHud, at(tick), { scenes: true, events })
    const { plans, lines } = run(sceneAt, tick => room(72, 8, T0 + tick, { scenes: true }), 40)
    const bubbles = plans.map(plan => plan.marks.find(mark => mark.ch === '○'))
    expect(bubbles[0]?.x).toBe(find(plans[0], 'from')!.drawnX + 6)
    const way = Math.sign(find(plans[0], 'to')!.drawnX - find(plans[0], 'from')!.drawnX)
    expect(bubbles[1]?.x).toBe(bubbles[0]!.x + way)
    // Along the receiver's head row, or a row above it where a hat is in the way.
    expect(lines[1]?.slice(0, 2).some(row => row[bubbles[1]!.x] === '○')).toBe(true)
    const arrival = bubbles.findIndex(mark => mark === undefined)
    expect(find(plans[arrival], 'to')?.cues).toEqual(['glance'])
    const tx = find(plans[arrival], 'to')!.drawnX
    expect((lineRows(lines[arrival]!, plans[arrival]!)[1] ?? '').padEnd(72).slice(tx + 2, tx + 10)).toBe(HEADS.up.slice(0, 8))
    const quiet = run(tick => sceneOf(board, idleHud, at(tick), { scenes: true }), tick => room(72, 8, T0 + tick, { scenes: true }), 20)
    expect(quiet.plans.every(plan => plan.marks.every(mark => mark.ch !== '○'))).toBe(true)
  })

  test('review: a reviewer spawned soon after a worker finished walks to its desk; done, it stamps ✓ over the laptop', () => {
    const worker = entry('maker', { type: 'worker', startedAt: NOW - 120_000, status: 'done', endedAt: NOW - 30_000 })
    const reviewer = entry('critic', { type: 'reviewer', startedAt: NOW - 25_000 })
    const scene = sceneOf([worker, reviewer], idleHud, NOW, { scenes: true })
    // The worker left long ago: no link. Within the window and still present: linked.
    expect(scene.agents.find(one => one.id === 'critic')?.link).toBe(undefined)
    const present = { ...worker, endedAt: NOW - 1000 }
    const fresh = { ...reviewer, startedAt: NOW - 500 }
    expect(sceneOf([present, fresh], idleHud, NOW, { scenes: true }).agents.find(one => one.id === 'critic')?.link).toEqual({ kind: 'review', target: 'maker' })
    expect(sceneOf([present, fresh], idleHud, NOW).agents.find(one => one.id === 'critic')?.link).toBe(undefined)
    expect(sceneOf([{ ...present, endedAt: NOW - 61_000 }, fresh], idleHud, NOW, { scenes: true }).agents.find(one => one.id === 'critic')?.link).toBe(undefined)

    // Direct: a desk at work at column 18, a reviewer that had wandered to column 46: it walks over and stands a cell right of the desk's slot.
    const desk: MascotScene = {
      main: { mood: 'watching', sweating: false },
      agents: [working('maker', 'typing'), working('critic', 'thinking', { role: 'reviewer', link: { kind: 'review', target: 'maker' }, ageMs: (ARRIVE_TICKS + SETUP_TICKS) * S })],
    }
    const sceneAt = (tick: number): MascotScene => ({ ...desk, agents: desk.agents.map(one => (one.id === 'critic' ? { ...one, ageMs: (ARRIVE_TICKS + SETUP_TICKS + tick) * S } : one)) })
    const layoutAt = (tick: number) => room(100, 8, T0 + tick, { scenes: true, wander: true, collisions: 'off' })
    const plans: MascotPlan[] = []
    const lines: string[][] = []
    let previous = slotted(sceneAt(0), layoutAt(0), { maker: 18, critic: 46 })
    for (let tick = 1; tick <= 18; tick += 1) {
      previous = mascotPlan(sceneAt(tick), layoutAt(tick), previous)!
      plans.push(previous)
      lines.push(mascotLines(sceneAt(tick), layoutAt(tick), previous) ?? [])
    }
    const maker = find(plans[0], 'maker')!
    const xs = plans.map(plan => find(plan, 'critic')!.drawnX)
    expect(xs.slice(0, 10)).toEqual([45, 44, 43, 42, 41, 40, 39, 38, 37, 36])
    expect(xs.slice(10, 17)).toEqual(Array(7).fill(maker.drawnX + SLOT + 1))
    // Its letter above its head as it stands there.
    expect(lineRows(lines[10]!, plans[10]!)[0]?.[36 + 6]).toBe('r')
    // Its stamp over the desk as it packs up, done.
    const stamped: MascotScene = { ...desk, agents: [working('maker', 'typing'), working('critic', 'thinking', { role: 'reviewer', link: { kind: 'review', target: 'maker' }, status: 'done', endedMs: 0 })] }
    const plan = mascotPlan(stamped, room(100, 8, T0, { scenes: true }))!
    const desked = find(plan, 'maker')!
    // Over the desk: above the laptop's lid.
    expect(plan.marks).toContainEqual(expect.objectContaining({ ch: '✓', x: desked.drawnX + 14, row: 0 }))
    expect(lineRows(mascotLines(stamped, room(100, 8, T0, { scenes: true }), plan) ?? [], plan)[0]?.[desked.drawnX + 14]).toBe('✓')
  })

  test('fix: a debugger spawned soon after a reviewer finished goes to the latest worker\'s desk; sparks two frames in eight', () => {
    const board = [
      entry('maker', { type: 'worker', startedAt: NOW - 120_000 }),
      entry('critic', { type: 'reviewer', startedAt: NOW - 100_000, status: 'done', endedAt: NOW - 20_000 }),
      entry('fixer', { type: 'debugger', startedAt: NOW - 10_000 }),
    ]
    const scene = sceneOf(board, idleHud, NOW, { scenes: true })
    expect(scene.agents.find(one => one.id === 'fixer')?.link).toEqual({ kind: 'fix', target: 'maker' })
    const { plans } = run(() => scene, tick => room(100, 8, T0 + tick, { scenes: true, collisions: 'off' }), 24)
    const sparks = plans.map(plan => plan.marks.some(mark => mark.ch === '✦'))
    expect(sparks.filter(Boolean).length).toBe(6)
    plans.forEach((plan, frame) => expect(sparks[frame], `frame ${frame}`).toBe(plan.tick % 8 < 2))
    expect(sceneOf(board, idleHud, NOW).agents.find(one => one.id === 'fixer')?.link).toBe(undefined)
  })

  test('parent and child: the parent points ⇢ for the two frames its child lands', () => {
    const board = (now: number) => [entry('boss', { startedAt: NOW - 60_000 }), entry('kid', { parentId: 'boss', startedAt: NOW, lastActivityAt: now })]
    const { plans, lines } = play(board, 8)
    const pointed = plans.map(plan => find(plan, 'boss')?.cues?.includes('point') === true)
    expect(pointed).toEqual([false, false, true, true, false, false, false, false])
    const bx = find(plans[2], 'boss')!.drawnX
    // Its arm out, the pointer beside it.
    expect(lineRows(lines[2]!, plans[2]!)[2]?.slice(bx + 10, bx + 12)).toBe('▀⇢')
  })

  test('workflow squad: arrive in a row; one finishing while another runs holds out its hand to it before its cheer', () => {
    const shadow = (id: string, extra: Record<string, unknown> = {}) => ({ id, firstSeen: NOW - 60_000, lastSeen: NOW, steps: 2, toolCalls: 2, status: 'running' as const, ...extra })
    const shadows = [shadow('wf-a', { firstSeen: NOW - 61_000, status: 'done', endedAt: NOW, reason: 'answer' }), shadow('wf-b')]
    const sceneAt = (tick: number) => sceneOf([], idleHud, at(tick), { scenes: true, shadows })
    const { plans, lines } = run(sceneAt, tick => room(72, 8, T0 + tick, { scenes: true }), 8)
    expect(sceneAt(0).agents.find(one => one.id === 'wf-a')?.squadNext).toBe('wf-b')
    expect(find(plans[0], 'wf-a')!.x).toBeLessThan(find(plans[0], 'wf-b')!.x)
    expect(find(plans[PACK_TICKS], 'wf-a')?.phase).toEqual({ kind: 'baton', step: 0 })
    const ax = find(plans[PACK_TICKS], 'wf-a')!.drawnX
    expect(lineRows(lines[PACK_TICKS]!, plans[PACK_TICKS]!)[2]?.[ax + 10]).toBe('▀')
    expect(find(plans[PACK_TICKS + 1], 'wf-b')?.cues).toEqual(['take-baton'])
    expect(lines.every(frame => !/[≣▯]/.test(frame.join('')))).toBe(true)
    expect(find(plans[PACK_TICKS + 2], 'wf-a')?.phase?.kind).toBe('cheer')
    // Without the scenes: no baton.
    expect(sceneOf([], idleHud, NOW, { shadows }).agents.find(one => one.id === 'wf-a') && run(tick => sceneOf([], idleHud, at(tick), { shadows }), tick => room(72, 8, T0 + tick), 8).plans.every(plan => find(plan, 'wf-a')?.phase?.kind !== 'baton')).toBe(true)
  })
})
