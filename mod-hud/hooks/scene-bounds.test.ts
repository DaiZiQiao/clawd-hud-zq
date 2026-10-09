import { describe, expect, test } from 'claude-code/testing'

import { sceneCanvas } from './scene-canvas'
import { sceneOf } from './scene-model'
import { NOW, busy, crowd, entry, everyState, everything, family, hotHud, idleHud, trio } from './scene-model.fixtures'
import { SCENE_FRAME_MS } from './scene-phases'
import { mascotPlan } from './scene-plan'
import { T0, room, run } from './scene-plan.fixtures'
import { mascotLines } from './scene-render.fixtures'
import { displayWidth } from './text-width'

// The scene stays in its room: from 20 to 130 columns, no row wider than the
// pane and never more rows than given, whatever is drawn. One harness, run
// over every scene the classic renderer is checked with: still fixtures, every
// state frame by frame, a board moving over time, and the pipes.

/** Every pane width the scene is checked at. */
const EVERY_WIDTH = Array.from({ length: 111 }, (_, index) => 20 + index)

/** A board over time: a parent and its child, a finished agent, a reviewer a message is sent to. */
const board = (now: number) => [
  entry('boss', { startedAt: NOW - 60_000 }),
  entry('kid', { parentId: 'boss', startedAt: NOW, lastActivityAt: now }),
  entry('done', { status: 'done', endedAt: NOW, startedAt: NOW - 30_000 }),
  entry('rev', { type: 'reviewer', startedAt: NOW - 20_000 }),
]

/** One harness: the scenes it draws, the row heights it draws them at, and each frame's rows at a width and a height. */
type Harness = { name: string; rows: readonly number[]; frames: (columns: number, rows: number) => (readonly string[] | undefined)[] }

const still = [everything, sceneOf(trio, hotHud, NOW), sceneOf(family, idleHud, NOW), sceneOf(crowd(30), idleHud, NOW)]

const HARNESSES: readonly Harness[] = [
  {
    name: 'still scenes, two frames each',
    rows: [4, 7, 12, 17],
    frames: (columns, rows) => still.flatMap(scene => [0, 1].map(tick => mascotLines(scene, { columns, rows, tick }))),
  },
  {
    name: 'every state, every frame of its cycles, wandering and acting',
    rows: [4, 5, 9, 16],
    frames: (columns, rows) => Array.from({ length: 16 }, (_, frame) => mascotLines(everyState(frame), { columns, rows, tick: frame, wander: true, scenes: true })),
  },
  {
    name: 'a board over time, wandering, acting, colliding and messaging',
    rows: [4, 5, 9, 13],
    frames: (columns, rows) => run(
      tick => sceneOf(board(NOW + tick * SCENE_FRAME_MS), idleHud, NOW + tick * SCENE_FRAME_MS, { scenes: true, events: [{ kind: 'message', from: 'main', to: 'rev', tick: T0 }] }),
      tick => room(columns, rows, T0 + tick, { wander: true, scenes: true, collisions: 'normal' }),
      6,
    ).lines,
  },
  {
    name: 'pipes and all: newcomers, a shared pipe, farewells',
    rows: [4, 5, 6, 9, 13, 20, 28, 40],
    frames: (columns, rows) => [0, 3, 6].map(tick => mascotLines(busy(tick), { columns, rows, tick: T0 + tick, wander: true, scenes: true })),
  },
]

describe('scene bounds', () => {
  for (const harness of HARNESSES) {
    test(`no row wider than the pane from 20 to 130 columns, never more rows than given: ${harness.name}`, { timeoutMs: 60_000 }, () => {
      for (const columns of EVERY_WIDTH) {
        for (const rows of harness.rows) {
          harness.frames(columns, rows).forEach((lines, frame) => {
            const at = `${columns}x${rows} @${frame}`
            expect(lines, at).toBeDefined()
            expect(lines?.length ?? 0, at).toBeLessThanOrEqual(rows)
            for (const line of lines ?? []) expect(displayWidth(line), `${at}: ${line}`).toBeLessThanOrEqual(columns)
          })
        }
      }
    })
  }

  test('the smooth canvas is the region, row for row, pipes and all, from 20 to 130 columns and 4 to 40 rows', { timeoutMs: 60_000 }, () => {
    for (const columns of EVERY_WIDTH) {
      for (const rows of [4, 5, 6, 9, 13, 20, 28, 40]) {
        for (const tick of [0, 3, 6]) {
          const smooth = { columns, rows, tick: T0 + tick, wander: true, scenes: true, motion: 'smooth' as const }
          const canvas = sceneCanvas(busy(tick), smooth, mascotPlan(busy(tick), smooth))!
          expect(canvas.grid.length, `${columns}x${rows}`).toBe(rows)
          expect(canvas.grid.every(row => row.length === columns)).toBe(true)
        }
      }
    }
  })
})
