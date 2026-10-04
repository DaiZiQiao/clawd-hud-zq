import { describe, expect, test } from 'claude-code/testing'

import type { AgentBoardEntry } from '../types'
import { boxed, cellOf, drawnAlone, placementOf } from './mascot-glyphs.fixtures'
import { HEADS, LEGS, OVERLAYS, SLOT, TORSOS } from './mascot-sprites'
import { sceneOf } from './scene-model'
import { DONE_HOLD, FAIL_HOLD, NOW, entry, idleHud, oneAgent, trio, working } from './scene-model.fixtures'
import {
  ARRIVE_TICKS,
  BLANKET_AFTER_MS,
  CHEER_TICKS,
  EXIT_TICKS,
  FAIL_PACK_TICKS,
  FAREWELL_TICKS,
  PACK_TICKS,
  SCENE_FRAME_MS,
  SETUP_TICKS,
  SIT_TICKS,
  phaseOf,
} from './scene-phases'
import { PIPE_DROP_MS, PIPE_SLIDE_MS } from './scene-pipe'
import { placedSprites } from './scene-placement'
import { mascotPlan } from './scene-plan'
import { mascotLines } from './scene-render'
import type { MascotLayout, MascotPlan, MascotScene } from './scene-types'
import { displayWidth } from './text-width'

// A mascot's life by the scene's frames: arriving by the red pipe, at work,
// done or failed, leaving by the pipe; several sharing one pipe.

const layout = (columns: number, rows = 8, tick = 0): MascotLayout => ({ columns, rows, tick })

describe('lifecycle', () => {
  const room = (tick: number) => layout(72, 8, tick)
  /** The full pipe's lip: nine cells of red. */
  const LIP = '█████████'
  /** Each frame of one agent's scene: its placement's phase and place, the frame, and its box as drawn. */
  const framesOf = (agents: readonly AgentBoardEntry[], id: string, count: number, columns = 72, rows = 8) => Array.from({ length: count }, (_, tick) => {
    const scene = sceneOf(agents, idleHud, NOW + tick * SCENE_FRAME_MS)
    const room = layout(columns, rows, tick)
    const plan = mascotPlan(scene, room)!
    const one = plan.placements.find(placement => placement.id === id)
    const lines = mascotLines(scene, room, plan) ?? []

    return { kind: one?.phase?.kind, x: one?.x, drawnX: one?.drawnX, d: one?.d, lines, cell: one === undefined ? [] : cellOf(lines, one, columns, plan.depth) }
  })
  /** Nine cells of a row from `x`, blanks kept. */
  const nine = (row: string | undefined, x: number): string => [...(row ?? '')].slice(x, x + 9).join('').padEnd(9)
  /** The row of a full pipe's lip over a slot at `x`, or -1. */
  const lipOver = (lines: readonly string[], x: number): number => lines.findIndex(row => nine(row, x + 2) === LIP)

  test('a spawn comes by the red pipe: inside while it comes down, out of its mouth falling to its floor, then it turns to its desk and works at its laptop', () => {
    const born = entry('new', { startedAt: NOW, lastActivityAt: NOW, currentTool: 'Edit' })
    // Forty by twelve: a shallow field under seven rows of sky, three rows to fall.
    const frames = framesOf([born], 'new', ARRIVE_TICKS + SETUP_TICKS + 3, 40, 12)
    expect(frames.map(one => one.kind)).toEqual([...Array(ARRIVE_TICKS).fill('arrive'), 'setup', 'setup', 'setup', 'work', 'work', 'work'])
    // The pipe comes to it: it stands at its slot from the first frame.
    expect(new Set(frames.map(one => `${one.drawnX},${one.d}`)).size).toBe(1)
    const x = frames[0]!.x!
    // Out of sight at first; down over its slot for the next five frames (half a second down, a second there, half going up); then gone.
    expect(frames.map(one => lipOver(one.lines, x) >= 0)).toEqual([false, true, true, true, true, true, false, false, false, false])
    // Inside while it comes down: nothing of it drawn.
    for (const tick of [0, 1]) expect(frames[tick]!.cell.join('').trim(), `${tick}`).toBe('')
    // Out of the mouth: eyes wide, arms up, legs tucked, a row lower each frame.
    const head = (tick: number): number => frames[tick]!.lines.findIndex(row => row.includes(HEADS.wide.trim()))
    expect(head(2)).toBeGreaterThan(lipOver(frames[2]!.lines, x))
    expect(head(3)).toBeGreaterThan(head(2))
    expect(nine(frames[2]!.lines[head(2) + 2], x + 2)).toBe(LEGS.tuck)
    // On its floor: it turns to its desk; then its laptop is there, and it works at it.
    expect(frames[ARRIVE_TICKS]?.cell[1]).toBe(boxed(HEADS.right))
    expect(frames[ARRIVE_TICKS]?.cell[3]).toBe(boxed(LEGS.stand))
    for (const tick of [5, 6, 7, 8, 9]) expect(frames[tick]?.cell[3]).toBe(boxed(LEGS.stand, '▀▀▀▀▀▀'))
  })

  test('done: at its laptop, then the laptop gone, it dances under ✓ for two seconds; the pipe comes down over it, sucks it up, faster and faster, and goes; then it is gone', () => {
    const done = entry('done', { status: 'done', endedAt: NOW })
    const frames = framesOf([done], 'done', DONE_HOLD + FAREWELL_TICKS + 1)
    expect(frames.slice(0, PACK_TICKS).map(one => one.kind)).toEqual(Array(PACK_TICKS).fill('pack'))
    expect(frames.slice(PACK_TICKS, DONE_HOLD).map(one => one.kind)).toEqual(Array(CHEER_TICKS).fill('cheer'))
    expect(frames.slice(DONE_HOLD, DONE_HOLD + FAREWELL_TICKS).map(one => one.kind)).toEqual(Array(FAREWELL_TICKS).fill('leave'))
    expect(frames[DONE_HOLD + FAREWELL_TICKS]?.kind).toBe(undefined)
    // It leaves where it stands.
    expect(new Set(frames.slice(0, DONE_HOLD + FAREWELL_TICKS).map(one => `${one.drawnX},${one.d}`)).size).toBe(1)
    expect(frames[0]?.cell[3]).toBe(boxed(LEGS.stand, '▀▀▀▀▀▀'))
    expect(frames[2]?.cell[3]?.trimEnd()).toBe(boxed(LEGS.stand).trimEnd())
    for (let tick = PACK_TICKS; tick < DONE_HOLD; tick += 1) expect(frames[tick]?.lines.join('').includes('✓'), `frame ${tick}`).toBe(true)
    // The pipe: out of sight as the farewell starts, then down over it until it goes back up.
    const x = frames[0]!.x!
    expect(frames.slice(DONE_HOLD).map(one => lipOver(one.lines, x) >= 0)).toEqual([false, true, true, true, true, true, true, true, false])
    // Eyes up at it, under its ✓, as it comes down.
    expect(frames[DONE_HOLD]?.cell[1]).toBe(boxed(HEADS.up, '✓'))
    // Sucked up: stretched (legs long), its legs higher each frame (faster and faster), drawn only below the lip; then inside.
    const legs = frames.slice(DONE_HOLD + 2, DONE_HOLD + 6).map(one => one.lines.findIndex(row => nine(row, x + 2) === LEGS.stretch))
    expect(legs.every(row => row >= 0)).toBe(true)
    legs.forEach((row, index) => index > 0 && expect(row).toBeLessThanOrEqual(legs[index - 1]!))
    expect(legs[0]! - legs[1]!).toBeLessThan(legs[2]! - legs[3]!)
    frames.slice(DONE_HOLD + 2, DONE_HOLD + 6).forEach(one => {
      const lip = lipOver(one.lines, x)
      for (let row = 0; row <= lip; row += 1) expect(nine(one.lines[row], x + 2)).not.toMatch(/[▐▌▚▞]/)
    })
    expect(frames[DONE_HOLD + 6]?.lines.join('\n')).not.toContain(LEGS.stretch)
    // Gone: only the session's mascot is left.
    expect(frames[DONE_HOLD + FAREWELL_TICKS]?.lines.every(line => displayWidth(line) <= SLOT)).toBe(true)
  })

  test('failed: at its laptop, then it slumps under ✗ for a few seconds, still slumped as the pipe comes down; then it is sucked up too', () => {
    const failed = entry('failed', { status: 'failed', endedAt: NOW })
    const kinds = Array.from({ length: FAIL_HOLD + FAREWELL_TICKS + 1 }, (_, tick) =>
      placementOf(sceneOf([failed], idleHud, NOW + tick * SCENE_FRAME_MS), room(tick), 'failed')?.phase?.kind)
    expect(kinds).toEqual([...Array(FAIL_PACK_TICKS).fill('pack'), ...Array(SIT_TICKS).fill('sit'), ...Array(FAREWELL_TICKS).fill('leave'), undefined])
    const frames = framesOf([failed], 'failed', FAIL_HOLD + FAREWELL_TICKS)
    // ✗ over its slumped head, its hat a row lower with it, still so as the pipe comes down.
    for (const tick of [FAIL_PACK_TICKS, FAIL_HOLD, FAIL_HOLD + 1]) {
      expect(frames[tick]?.cell[0]?.trimEnd()).toBe('      ✗')
      expect(frames[tick]?.cell[2]?.trimEnd()).toBe(`  ${HEADS.shut}`.trimEnd())
      expect(frames[tick]?.cell[3]?.trimEnd()).toBe(`  ${TORSOS.low}`)
    }
    // Then up the pipe, stretched, eyes shut.
    expect(frames[FAIL_HOLD + 2]?.cell[1]?.slice(2, 11)).toBe(`▐${HEADS.shut.slice(1, 8)}▌`)
    expect(frames[FAIL_HOLD + 2]?.cell[3]?.slice(2, 11)).toBe(LEGS.stretch)
  })

  test('full and mini come and go by a pipe of their size, over their figure, inside the room', () => {
    for (const columns of [52, 72, 100]) {
      for (const parentId of [undefined, 'parent']) {
        const sceneAt = (ageMs?: number, endedMs?: number): MascotScene => ({
          main: { mood: 'watching', sweating: false },
          agents: [...(parentId ? [working(parentId, 'thinking')] : []), working('a', 'thinking', { parentId, ageMs, endedMs, status: endedMs === undefined ? 'running' : 'done' })],
        })
        // Dropping out (600 ms in), and being sucked up (a second into its farewell).
        for (const scene of [sceneAt(600), sceneAt(undefined, DONE_HOLD * SCENE_FRAME_MS + 1000)]) {
          const room = layout(columns, 8)
          const plan = mascotPlan(scene, room)!
          const one = plan.placements.find(placement => placement.id === 'a')!
          expect(one.kind).toBe(parentId === undefined ? 'full' : 'mini')
          const lines = mascotLines(scene, room, plan)!
          const [x, width] = one.kind === 'mini' ? [one.drawnX, 5] : [one.drawnX + 2, 9]
          const lip = lines.findIndex(row => [...row].slice(x, x + width).join('') === '█'.repeat(width))
          expect(lip, `${columns} ${parentId}`).toBeGreaterThanOrEqual(0)
          // Exactly its width: nothing of the pipe either side of its lip.
          expect([...lines[lip]!][x - 1] ?? ' ').not.toBe('█')
          expect([...lines[lip]!][x + width] ?? ' ').not.toBe('█')
          for (const row of lines) expect(displayWidth(row)).toBeLessThanOrEqual(columns)
        }
      }
    }
  })

  test('a farewell is over in eight frames, at every width, done or failed: the plan drops it then, sceneOf at the twelve-frame cap', () => {
    expect(FAREWELL_TICKS).toBe(8)
    expect(FAREWELL_TICKS).toBeLessThan(EXIT_TICKS)
    for (const status of ['done', 'failed'] as const) {
      const held = status === 'done' ? DONE_HOLD : FAIL_HOLD
      const agents = [entry('a', { status, endedAt: NOW })]
      const sceneAt = (ms: number) => sceneOf(agents, idleHud, NOW + ms)
      // The phase and how long sceneOf keeps it do not depend on the width.
      expect(phaseOf(sceneAt(held * SCENE_FRAME_MS - 1).agents[0]!).kind).toBe(status === 'done' ? 'cheer' : 'sit')
      expect(phaseOf(sceneAt(held * SCENE_FRAME_MS).agents[0]!)).toEqual({ kind: 'leave', step: 0 })
      expect(sceneAt((held + 12) * SCENE_FRAME_MS - 1).agents).toHaveLength(1)
      expect(sceneAt((held + 12) * SCENE_FRAME_MS).agents).toHaveLength(0)
      for (const columns of [40, 72, 130]) {
        const placed = (frame: number) => mascotPlan(sceneAt(frame * SCENE_FRAME_MS), layout(columns, 8, frame))?.placements.some(one => one.id === 'a')
        expect(placed(held + FAREWELL_TICKS - 1), `${columns} ${status}`).toBe(true)
        expect(placed(held + FAREWELL_TICKS), `${columns} ${status}`).toBe(false)
      }
    }
  })

  test('survivors keep their places while another leaves by the pipe, and after', () => {
    for (const prefix of [0, 2]) {
      const agents = [
        ...Array.from({ length: prefix }, (_, index) => entry(`before-${index}`, { startedAt: NOW - 20_000 + index })),
        entry('done', { status: 'done', endedAt: NOW, startedAt: NOW - 10_000 }),
        entry('stay', { startedAt: NOW - 5000 }),
      ]
      const exitFrame = DONE_HOLD + FAREWELL_TICKS
      let previous: MascotPlan | undefined
      let home: string | undefined
      for (let tick = 0; tick <= exitFrame + 20; tick += 1) {
        const scene = sceneOf(agents, idleHud, NOW + tick * SCENE_FRAME_MS)
        const plan = mascotPlan(scene, layout(130, 4, tick), previous)!
        const stay = plan.placements.find(one => one.id === 'stay')!
        home ??= `${stay.drawnX},${stay.d}`
        expect(`${stay.drawnX},${stay.d}`, `frame ${tick}`).toBe(home)
        expect([stay.drawnX, stay.d]).toEqual([stay.x, stay.slotD])
        expect(plan.placements.some(one => one.id === 'done')).toBe(tick < exitFrame)
        // Repeated renders of the same frame change nothing.
        expect(mascotPlan(scene, layout(130, 4, tick), plan)?.placements).toEqual(plan.placements)
        previous = plan
      }
    }
  })

  test('simultaneous departures each go up a pipe of their own where they stand; the survivor stays put', () => {
    const agents = [
      entry('a', { status: 'done', endedAt: NOW, startedAt: NOW - 10_000 }),
      entry('b', { status: 'done', endedAt: NOW, startedAt: NOW - 9000 }),
      entry('stay', { startedAt: NOW - 5000 }),
    ]
    let previous: MascotPlan | undefined
    const at = new Map<string, string>()
    for (let tick = 0; tick < 64; tick += 1) {
      const scene = sceneOf(agents, idleHud, NOW + tick * SCENE_FRAME_MS)
      const plan = mascotPlan(scene, room(tick), previous)!
      for (const one of plan.placements) {
        if (one.kind === 'main') continue
        at.set(one.id, at.get(one.id) ?? `${one.drawnX},${one.d}`)
        expect(`${one.drawnX},${one.d}`, `${one.id} @${tick}`).toBe(at.get(one.id))
      }
      if (tick >= DONE_HOLD + 1 && tick < DONE_HOLD + FAREWELL_TICKS) {
        const lines = mascotLines(scene, room(tick), plan)!
        for (const id of ['a', 'b']) expect(lipOver(lines, plan.placements.find(one => one.id === id)!.drawnX), `${id} @${tick}`).toBeGreaterThanOrEqual(0)
      }
      expect(plan.placements.some(one => one.id === 'a')).toBe(tick < DONE_HOLD + FAREWELL_TICKS)
      previous = plan
    }
  })

  test('several spawned within two seconds share one pipe: down once, over the first one\'s slot, they pop out one after another to their own slots; one spawned later has its own', () => {
    const agents = [
      entry('one', { startedAt: NOW, lastActivityAt: NOW }),
      entry('two', { startedAt: NOW + 300, lastActivityAt: NOW + 300 }),
      entry('three', { startedAt: NOW + 1200, lastActivityAt: NOW + 1200 }),
      entry('late', { startedAt: NOW + 2600, lastActivityAt: NOW + 2600 }),
    ]
    const shares = (ms: number) => new Map(sceneOf(agents.filter(one => one.startedAt <= NOW + ms), idleHud, NOW + ms).agents.map(one => [one.id, one.pipe]))
    const at = shares(1500)
    expect(at.get('one')).toEqual({ anchor: 'one', after: 0, drop: PIPE_SLIDE_MS, up: expect.any(Number) })
    expect(at.get('two')).toMatchObject({ anchor: 'one', after: 300, drop: PIPE_SLIDE_MS + PIPE_DROP_MS })
    expect(at.get('three')).toMatchObject({ anchor: 'one', after: 1200, drop: 1500 })
    expect(at.get('one')?.up).toBe(2000)
    // One spawned more than two seconds after the batch's first: its own pipe.
    expect(shares(2700).get('late')).toBe(undefined)
    // Each drops at its turn: arriving until it is on its floor.
    const arriving = (ms: number) => sceneOf(agents.filter(one => one.startedAt <= NOW + ms), idleHud, NOW + ms).agents.filter(one => phaseOf(one).kind === 'arrive').map(one => one.id)
    expect(arriving(900)).toEqual(['one', 'two'])
    expect(arriving(1200)).toEqual(['two', 'three'])
    expect(arriving(1800)).toEqual(['three'])
    expect(arriving(2300)).toEqual([])
    // One pipe in sight, over the first one's slot, while the batch comes out.
    for (const ms of [250, 1000, 1500, 2250]) {
      const tick = Math.floor((NOW + ms) / SCENE_FRAME_MS)
      const scene = sceneOf(agents.filter(one => one.startedAt <= NOW + ms), idleHud, NOW + ms)
      const plan = mascotPlan(scene, { columns: 100, rows: 12, tick })!
      const first = plan.placements.find(one => one.id === 'one')!
      const pipes = placedSprites(scene, { columns: 100, rows: 12, tick }, plan)!.pipes
      expect(pipes, `${ms} ms`).toHaveLength(1)
      expect(pipes[0]?.x).toBe(first.x + 2)
    }
  })

  test('cycles: thought and sleep build up 1 1 2 2 3 3 3 3; the blanket breathes every four frames; at work the hand taps every other frame', () => {
    const steps = (table: readonly { art: readonly string[] }[]) => table.map(frame => frame.art.join('').replace(/ /g, '').length)
    expect(steps(OVERLAYS.thought).map(count => (count >= 5 ? 3 : count))).toEqual([1, 1, 2, 2, 3, 3, 3, 3])
    expect(steps(OVERLAYS.zzz)).toEqual([1, 1, 2, 2, 3, 3, 3, 3])
    expect(OVERLAYS.zzz[4]?.art[0]?.[13]).toBe('Z')
    const sleep: MascotScene = { main: { mood: 'idle', sweating: false, idleMs: BLANKET_AFTER_MS }, agents: [] }
    expect(mascotLines(sleep, layout(20, 4, 0))).toEqual(mascotLines(sleep, layout(20, 4, 8)))
    expect(mascotLines(sleep, layout(20, 4, 0))).not.toEqual(mascotLines(sleep, layout(20, 4, 4)))
    const thinking = oneAgent(working('a', 'thinking'))
    expect(drawnAlone(thinking, 'a', 0)).toEqual(drawnAlone(thinking, 'a', 8))
    expect(new Set(Array.from({ length: 8 }, (_, tick) => drawnAlone(thinking, 'a', tick).join('\n'))).size).toBe(3)
    const typing = oneAgent(working('a', 'typing'))
    expect(new Set(Array.from({ length: 8 }, (_, tick) => drawnAlone(typing, 'a', tick).join('\n'))).size).toBe(2)
  })

  test('frames advance once per tick and only with it', () => {
    const scene = sceneOf(trio, idleHud, NOW)
    expect(mascotLines(scene, room(7))).toEqual(mascotLines(scene, room(7)))
    expect(mascotLines(scene, room(7))).not.toEqual(mascotLines(scene, room(8)))
  })
})
