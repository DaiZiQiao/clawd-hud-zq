import type { ClientPointerEvent, JsonValue } from 'claude-code'

import { base64Of, pngOf } from './png'
import { sceneCanvas } from './scene-canvas'
import { smoothFrame, smoothPixels } from './scene-smooth'
import type { SmoothFrame } from './scene-smooth'
import type { SceneInputs } from './scene-types'
import { layoutAt, sceneAt, viewOf } from './scene-view'
import { createWorld, pointer, receive, tick } from './scene-world'
import type { World } from './scene-world'
import { createSmoother } from './smooth-pose'
import type { Smoother } from './smooth-pose'

// The vector scene in a terminal that shows pictures (Ghostty, kitty): the
// hooks run the scene's world themselves, as the `Client` runs it on its
// surface (hooks/scene-world.ts), and draw each frame as a PNG
// (hooks/png.ts) swapped into a keyed `Image` by `$.ui.blit`; over the
// picture a `Client` with nothing to draw (hooks/scene-hit.tsx) hands them the
// person's pointer, each event numbered so none is taken twice. Pure: the
// hooks (hooks/register.tsx) keep the stages, the timer and the blits.

/** A frame every 33 ms while anything moves; every third while all stand still (a breath, a blink: ten a second do). */
export const IMAGE_FRAME_MS = 33
export const STILL_EVERY = 3

/** The picture's pixels per cell: the desktop's 8 by 16; twice that for a small region (the band), which costs as little. */
export const cellPixels = (columns: number, rows: number): { width: number; height: number } =>
  columns * rows <= 200 ? { width: 16, height: 32 } : { width: 8, height: 16 }

/** One scene drawn as a picture: its world, its eased poses, the last frame swapped in. */
export type Stage = {
  world: World
  smoother: Smoother
  cell: { width: number; height: number }
  /** The last frame drawn (base64 PNG), whether anything in it moved, and frames since. */
  png?: string
  still: boolean
  skipped: number
  /** The hit layer whose events it takes, and the last one taken, by its number. */
  layer?: string
  seq: number
}

export const createStage = (inputs: SceneInputs): Stage => ({
  world: createWorld(inputs),
  smoother: createSmoother(),
  cell: cellPixels(inputs.columns, inputs.rows),
  still: false,
  skipped: 0,
  seq: 0,
})

/** New props from a redraw: the world takes them; a region of another size, its picture's pixels and a frame drawn afresh. */
export const restage = (stage: Stage, inputs: SceneInputs): void => {
  const resized = inputs.columns !== stage.world.props.columns || inputs.rows !== stage.world.props.rows
  receive(stage.world, inputs)
  stage.cell = cellPixels(inputs.columns, inputs.rows)
  if (resized) stage.png = undefined
}

/**
 * The stage's frame now as a whole PNG, base64: the vector art over the
 * region, theme keys in `scheme`'s colours; whose mascot owns each cell kept
 * for the pointer. Blank (clear) while there is no plan or it is paused.
 */
export const stageFrame = (stage: Stage, scheme: 'dark' | 'light'): string => {
  const world = stage.world
  const columns = Math.max(1, world.props.columns)
  const rows = Math.max(1, world.props.rows)
  const plan = world.cur
  let frame: SmoothFrame | undefined
  if (plan !== undefined && world.props.paused !== true) {
    const view = viewOf(world)
    const scene = sceneAt(world, world.sceneNow)
    const layout = layoutAt(world, plan.tick)
    world.owners = sceneCanvas(scene, layout, plan, view.sprites)?.owners
    frame = smoothFrame(scene, layout, plan, view.sprites, stage.smoother, world.sceneNow)
  }
  stage.still = (frame === undefined || frame.still) && world.carried.size === 0
  const { pixels, width, height } = smoothPixels(frame ?? { shapes: [], width: 0, height: 0, still: true }, columns, rows, stage.cell, scheme)

  return base64Of(pngOf(pixels, width, height))
}

/**
 * One frame of the timer: the world on by `step`, then its picture when it is
 * due (every frame while anything moves, every STILL_EVERY while all stand
 * still); the PNG when it differs from the last, else undefined.
 */
export const stageTick = (stage: Stage, step: number, scheme: 'dark' | 'light'): string | undefined => {
  if (stage.world.props.paused === true) return undefined
  tick(stage.world, step)
  stage.skipped += 1
  if (stage.still && stage.world.carried.size === 0 && stage.skipped < STILL_EVERY) return undefined
  stage.skipped = 0
  const png = stageFrame(stage, scheme)
  if (png === stage.png) return undefined
  stage.png = png

  return png
}

/** A pointer event the hit layer passes on, numbered. */
export type HitEvent = ClientPointerEvent & { seq: number }

/** What the hit layer posts: who it is (a layer mounted afresh counts from 1 again) and its last events. */
export type HitPost = { layer: string; hits: HitEvent[] }

const TYPES = new Set(['down', 'move', 'up', 'enter', 'leave'])

const isHit = (value: unknown): value is HitEvent => {
  if (typeof value !== 'object' || value === null) return false
  const one = value as Record<string, unknown>

  return typeof one.seq === 'number' && TYPES.has(String(one.type)) && typeof one.x === 'number' && typeof one.y === 'number' && Number.isFinite(one.x) && Number.isFinite(one.y)
}

/** The hit layer's post read back, its events oldest first; undefined for anything else. */
export const hitsOf = (data: unknown): HitPost | undefined => {
  if (typeof data !== 'object' || data === null) return undefined
  const post = data as { layer?: unknown; hits?: unknown }
  if (typeof post.layer !== 'string' || !Array.isArray(post.hits)) return undefined

  return { layer: post.layer, hits: post.hits.filter(isHit).sort((a, b) => a.seq - b.seq) }
}

/**
 * The hit layer's events not yet taken, played on the stage's world as the
 * Client plays its own; what the world posts (a click asking to inspect) goes
 * to `post`. `taken`, the last event taken from each layer, outlives the
 * stages: a stage made afresh under a layer that lived on (a session ended
 * and the next began) takes only its new events, never its old ones again.
 * True when one was taken.
 */
export const stageHits = (stage: Stage, post: HitPost, send: (data: JsonValue) => void, taken?: Map<string, number>): boolean => {
  if (post.layer !== stage.layer) {
    stage.layer = post.layer
    stage.seq = taken?.get(post.layer) ?? 0
  }
  let took = false
  for (const hit of post.hits) {
    if (hit.seq <= stage.seq) continue
    stage.seq = hit.seq
    const { seq: _, ...event } = hit
    pointer(stage.world, event as ClientPointerEvent, send)
    took = true
  }
  if (took) {
    stage.still = false
    stage.skipped = STILL_EVERY
  }
  if (taken !== undefined) {
    taken.delete(post.layer)
    taken.set(post.layer, stage.seq)
    // The few layers mounted lately are all a session sees.
    for (const old of taken.keys()) {
      if (taken.size <= 64) break
      taken.delete(old)
    }
  }

  return took
}
