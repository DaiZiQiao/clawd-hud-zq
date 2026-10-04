import { expect } from 'claude-code/testing'

import type { AgentBoardEntry } from '../types'
import { sceneCanvas } from './scene-canvas'
import { sceneInputsOf } from './scene-model'
import { NOW, entry } from './scene-model.fixtures'
import { canvasLines } from './scene-render'
import type { SceneInputs } from './scene-types'
import { layoutAt, sceneAt, viewOf } from './scene-view'
import { tick } from './scene-world'
import type { World } from './scene-world'

// The smooth scene's world (hooks/scene-world.ts) as the tests read it.

/** The frame as plain text, a row per region row (what `draw` draws, uncoloured), whose sprite owns each cell kept for the pointer. */
export const frameLines = (world: World): string[] => {
  if (world.props.paused === true) return []
  const plan = world.cur
  if (plan === undefined) return Array.from({ length: world.props.rows }, () => '')
  const canvas = sceneCanvas(sceneAt(world, world.sceneNow), layoutAt(world, plan.tick), plan, viewOf(world).sprites)
  world.owners = canvas?.owners

  return canvas === undefined ? [] : canvasLines(canvas.grid)
}

/** The smooth scene's props in a room 100 by 20. */
export const tallInputs = (agents: readonly AgentBoardEntry[] = [], extra: Partial<SceneInputs> = {}): SceneInputs => sceneInputsOf(agents, [], undefined, {
  now: NOW, columns: 100, rows: 20, main: {}, events: [], stalledMs: 240_000, wander: false, scenes: false, collisions: 'rare', inspect: true, ...extra,
})

export const LAPTOP = '▗▄▄▄▖'

export const TYPIST = entry('a', { currentTool: 'Edit', startedAt: NOW - 60_000 })

export const inputs = (agents: readonly AgentBoardEntry[], extra: Partial<SceneInputs> = {}): SceneInputs => sceneInputsOf(agents, [], undefined, {
  now: NOW, columns: 100, rows: 16, main: {}, events: [], stalledMs: 240_000, wander: false, scenes: false, collisions: 'rare', inspect: true, ...extra,
})

export const ticks = (world: World, count: number): void => {
  for (let index = 0; index < count; index += 1) tick(world)
}

/** Where the pointer presses a mascot: the middle of its head, as drawn now. */
export const press = (world: World, id: string): { x: number; y: number } => {
  frameLines(world)
  const seen = viewOf(world).seen.get(id)
  if (seen === undefined || world.cur === undefined) throw new Error(`no ${id} drawn`)
  const at = { x: Math.round(seen.x) + 6, y: world.cur.headroom + Math.round(seen.d) + 1 - Math.round(seen.lift) }
  expect(world.owners?.[at.y]?.[at.x]).toBe(id)

  return at
}

export const memoOf = (world: World, id: string) => world.cur?.memo.get(id)
