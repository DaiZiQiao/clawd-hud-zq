import type { ClientPointerEvent, JsonValue } from 'claude-code'

import { base64Of, pngOf } from './png'
import { sceneCanvas } from './scene-canvas'
import { smoothFrame, smoothPixels } from './scene-smooth'
import type { SmoothFrame } from './scene-smooth'
import type { SceneInputs } from './scene-types'
import { layoutAt, sceneAt, viewOf } from './scene-view'
import { clockMs, createWorld, pointer, receive, tick } from './scene-world'
import type { World } from './scene-world'
import { createSmoother } from './smooth-pose'
import type { Smoother } from './smooth-pose'

// The vector scene in a terminal that shows pictures (Ghostty, kitty): the
// hooks run the scene's world themselves, as the `Client` runs it on its
// surface (hooks/scene-world.ts), and draw each frame that changed as a PNG
// (hooks/png.ts) swapped into a keyed `Image` by `$.ui.blit`: one picture
// for the region, as the terminal fits a picture to its cells keeping its
// shape, so pieces of one would show the terminal between them where its
// cells are not 8 by 16. Kept light for the terminal, which decodes and draws
// every picture it is sent: a few frames a second, none that did not change,
// and no more bytes a second than BYTES_A_SECOND. Over the picture a
// `Client` with nothing to draw (hooks/scene-hit.tsx) hands it the person's
// pointer, each event numbered so none is taken twice. Pure: the hooks
// (hooks/register.tsx) keep the stages, the timer and the blits.

/** A frame every 125 ms while anything moves (eight a second); every fourth while all stand still (a hand on the keys: two a second do), and as a blink begins and ends. */
export const IMAGE_FRAME_MS = 125
export const STILL_EVERY = 4

/** The picture's pixels per cell: the desktop's 8 by 16; twice that for a small region (the band), which costs as little. */
export const cellPixels = (columns: number, rows: number): { width: number; height: number } =>
  columns * rows <= 200 ? { width: 16, height: 32 } : { width: 8, height: 16 }

/**
 * A picture's share of the time, its inverse: after a frame that took t ms
 * its next waits PICTURE_SHARE × t (in the timer's frames, MOST_WAIT at
 * most), so it takes a third or so of the hooks' time at most, and a costly
 * frame comes less often instead of late.
 */
const PICTURE_SHARE = 3
const MOST_WAIT = 4
/** What a picture may send the terminal, base64 bytes a second, and at most at once: past it its frames wait, whatever moves. */
export const BYTES_A_SECOND = 128 * 1024
const BYTES_AT_ONCE = 2 * BYTES_A_SECOND

/**
 * One scene drawn as a picture: its world, its eased poses, its last frame
 * (base64 PNG, and its pixels) and whether that is swapped in yet; the
 * timer's frames it waits to draw, and the bytes it may still send.
 */
export type Stage = {
  world: World
  smoother: Smoother
  cell: { width: number; height: number }
  png?: string
  pixels?: Uint8Array
  sent: boolean
  wait: number
  allowance: number
  /** Whether anything in the last frame moved, and frames since; when a mascot's eyes next shut or open (the scene's time). */
  still: boolean
  skipped: number
  blinks?: number
  /** The hit layer whose events it takes, and the last one taken, by its number. */
  layer?: string
  seq: number
}

export const createStage = (inputs: SceneInputs): Stage => ({
  world: createWorld(inputs),
  smoother: createSmoother(),
  cell: cellPixels(inputs.columns, inputs.rows),
  sent: false,
  wait: 0,
  allowance: BYTES_AT_ONCE,
  still: false,
  skipped: 0,
  seq: 0,
})

/** New props from a redraw: the world takes them; a region of another size, its picture drawn afresh. */
export const restage = (stage: Stage, inputs: SceneInputs): void => {
  const resized = inputs.columns !== stage.world.props.columns || inputs.rows !== stage.world.props.rows
  receive(stage.world, inputs)
  stage.cell = cellPixels(inputs.columns, inputs.rows)
  if (resized) {
    stage.png = undefined
    stage.pixels = undefined
  }
}

/**
 * The stage's frame now: the vector art over the region in pixels, theme
 * keys in `scheme`'s colours; whose mascot owns each cell kept for the
 * pointer. Blank (clear) while there is no plan or it is paused.
 */
const stageFrame = (stage: Stage, scheme: 'dark' | 'light'): { pixels: Uint8Array; width: number } => {
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
    // Calm: no breath (a body that swells and settles would send its picture again each frame it stands still), a blink shut whole.
    frame = smoothFrame(scene, layout, plan, view.sprites, stage.smoother, world.sceneNow, true)
  }
  stage.still = (frame === undefined || frame.still) && world.carried.size === 0
  stage.blinks = frame?.blinks

  return smoothPixels(frame ?? { shapes: [], wholes: [], width: 0, height: 0, still: true }, columns, rows, stage.cell, scheme)
}

/** A frame's picture, drawn again (and so to be swapped in) when its pixels differ from the last's, or there is none. */
const changedPicture = (stage: Stage, pixels: Uint8Array, width: number): void => {
  const last = stage.pixels
  if (stage.png !== undefined && last !== undefined && last.length === pixels.length) {
    const now32 = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length / 4)
    const last32 = new Uint32Array(last.buffer, last.byteOffset, last.length / 4)
    let same = true
    for (let at = 0; same && at < now32.length; at += 1) same = now32[at] === last32[at]
    if (same) return
  }
  stage.png = base64Of(pngOf(pixels, width, pixels.length / 4 / width))
  stage.pixels = pixels
  stage.sent = false
}

/** The stage's picture to draw it with, its first frame drawn if it has none yet: the drawing carries it, so it waits for no swap. */
export const stagePicture = (stage: Stage, scheme: 'dark' | 'light'): string => {
  if (stage.png === undefined) {
    const { pixels, width } = stageFrame(stage, scheme)
    changedPicture(stage, pixels, width)
  }
  stage.sent = true

  return stage.png ?? ''
}

/** A picture whose swap was refused, and may show an old frame: swapped in again at the next frame. */
export const refusedPicture = (stage: Stage): void => {
  stage.sent = false
}

/**
 * One frame of the timer: the world on by `step` (the time gone since the
 * last, so a late frame is never slow motion), then, when its picture is due
 * (its wait done and bytes to send; every frame while anything moves, every
 * STILL_EVERY while all stand still), the picture if it changed, or if it
 * was refused before: the picture to swap in now, if any.
 */
export const stageTick = (stage: Stage, step: number, scheme: 'dark' | 'light'): string | undefined => {
  if (stage.world.props.paused === true) return undefined
  tick(stage.world, step)
  stage.skipped += 1
  stage.wait -= 1
  stage.allowance = Math.min(BYTES_AT_ONCE, stage.allowance + (BYTES_A_SECOND * step) / 1000)
  // All standing still: every STILL_EVERY frames, and as an eye shuts or opens.
  const resting = stage.still && stage.world.carried.size === 0 && stage.skipped < STILL_EVERY && !(stage.blinks !== undefined && stage.world.sceneNow >= stage.blinks)
  if (stage.wait < 0 && stage.allowance > 0 && !resting) drawTick(stage, scheme)
  if (stage.sent || stage.png === undefined) return undefined
  stage.sent = true
  stage.allowance -= stage.png.length

  return stage.png
}

/** A frame drawn, and what drawing it took says how long till the next. */
const drawTick = (stage: Stage, scheme: 'dark' | 'light'): void => {
  stage.skipped = 0
  const at = clockMs()
  const { pixels, width } = stageFrame(stage, scheme)
  changedPicture(stage, pixels, width)
  if (at !== undefined) stage.wait = Math.min(MOST_WAIT, Math.ceil((((clockMs() ?? at) - at) * PICTURE_SHARE) / IMAGE_FRAME_MS) - 1)
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
  let changed = false
  for (const hit of post.hits) {
    if (hit.seq <= stage.seq) continue
    stage.seq = hit.seq
    const { seq: _, ...event } = hit
    if (pointer(stage.world, event as ClientPointerEvent, send) || hit.type === 'down' || hit.type === 'up') changed = true
    took = true
  }
  // A press, a release or a drag drawn at the next frame, whatever it waited for; the pointer passing over, as it comes.
  if (changed) {
    stage.still = false
    stage.skipped = STILL_EVERY
    stage.wait = 0
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
