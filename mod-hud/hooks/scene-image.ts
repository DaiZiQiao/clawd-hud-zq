import type { ClientPointerEvent, JsonValue } from 'claude-code'

import { base64Of, pngOf } from './png'
import { sceneCanvas } from './scene-canvas'
import { SCENERY_STEP_MS, prefetchScenery, smoothFrame, smoothPixels, workScenery } from './scene-smooth'
import type { SmoothFrame } from './scene-smooth'
import type { SceneInputs } from './scene-types'
import { layoutAt, sceneAt, viewOf } from './scene-view'
import { clockMs, createWorld, pointer, receive, tick } from './scene-world'
import type { World } from './scene-world'
import { createSmoother } from './smooth-pose'
import type { Smoother } from './smooth-pose'

// The vector scene in a terminal that shows pictures (Ghostty, kitty): the
// hooks run the scene's world themselves, as the `Client` runs it on its
// surface (hooks/scene-world.ts), and draw each frame as tiles, each a keyed
// `Image`: a tile whose pixels changed is a PNG (hooks/png.ts) swapped in by
// `$.ui.blit`, the rest left as they are, so a frame costs what moved in it
// (a mascot walking over the scenery, not the whole world behind it). Over
// the tiles a `Client` with nothing to draw (hooks/scene-hit.tsx) hands them
// the person's pointer, each event numbered so none is taken twice. Pure:
// the hooks (hooks/register.tsx) keep the stages, the timer and the blits.

/** A frame every 33 ms while anything moves; every third while all stand still (a breath, a blink: ten a second do). */
export const IMAGE_FRAME_MS = 33
export const STILL_EVERY = 3

/** The picture's pixels per cell: the desktop's 8 by 16; twice that for a small region (the band), which costs as little. */
export const cellPixels = (columns: number, rows: number): { width: number; height: number } =>
  columns * rows <= 200 ? { width: 16, height: 32 } : { width: 8, height: 16 }

/** A picture's tile: `columns` by `rows` cells from cell `x`, `y` of the region, and its last frame (base64 PNG). */
export type Tile = { x: number; y: number; columns: number; rows: number; png: string }

/** How big a tile is, in cells: a mascot walking changes one or two a frame, and a tile costs a millisecond or so to draw again. */
export const TILE_COLUMNS = 20
export const TILE_ROWS = 10

/** A region of `columns` by `rows` cells as tiles, row by row, those at its right and bottom edges smaller. */
export const tilesOf = (columns: number, rows: number): Omit<Tile, 'png'>[] =>
  Array.from({ length: Math.ceil(rows / TILE_ROWS) }, (_, row) =>
    Array.from({ length: Math.ceil(columns / TILE_COLUMNS) }, (_, column) => ({ x: column * TILE_COLUMNS, y: row * TILE_ROWS, columns: Math.min(TILE_COLUMNS, columns - column * TILE_COLUMNS), rows: Math.min(TILE_ROWS, rows - row * TILE_ROWS) })),
  ).flat()

/**
 * A picture's scenery moves on (its boats, its weather, its sky) no sooner
 * than SCENERY_SHARE times what drawing it all again took, and no later than
 * SCENERY_MOST_MS: between, a frame is its mascots over the pixels kept. A
 * picture that takes more than PANS_MOST_MS to draw it all goes on to the
 * next stop at once, not panning (a frame of a pan draws it all): as its
 * PANS_AFTER-th such frame says, once for its size.
 */
const SCENERY_SHARE = 4
const SCENERY_MOST_MS = 1000
const PANS_MOST_MS = 30
const PANS_AFTER = 8
/** What a timer's frame gives to drawing the scenery ahead (the next leg's land, the next hour's light), ms. */
const AHEAD_MS = 4

/**
 * One scene drawn as a picture: its world, its eased poses, its tiles as last
 * swapped in and the frame they were cut from; when its scenery last moved on
 * (the scene's time), how long it waits to again, what drawing it all takes
 * (an average, ms), and whether it pans.
 */
export type Stage = {
  world: World
  smoother: Smoother
  cell: { width: number; height: number }
  tiles?: Tile[]
  pixels?: Uint8Array
  held?: number
  sceneryEvery: number
  cost?: number
  /** Whether it pans, and the frames that drew it all, which say so at PANS_AFTER. */
  pans: boolean
  measured: number
  /** The land whose next leg's is drawn ahead already. */
  ahead?: string
  /** Whether anything in the last frame moved, and frames since. */
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
  sceneryEvery: SCENERY_STEP_MS,
  pans: true,
  measured: 0,
  still: false,
  skipped: 0,
  seq: 0,
})

/** New props from a redraw: the world takes them; a region of another size, its picture's pixels and tiles drawn afresh. */
export const restage = (stage: Stage, inputs: SceneInputs): void => {
  const resized = inputs.columns !== stage.world.props.columns || inputs.rows !== stage.world.props.rows
  receive(stage.world, inputs)
  stage.cell = cellPixels(inputs.columns, inputs.rows)
  if (resized) {
    stage.tiles = undefined
    stage.pixels = undefined
    stage.pans = true
    stage.measured = 0
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
    const daylight = world.props.scenery
    frame = smoothFrame(scene, layout, plan, view.sprites, stage.smoother, world.sceneNow, daylight === undefined ? false : { daylight, held: stage.held ?? world.sceneNow, pans: stage.pans })
  }
  stage.still = (frame === undefined || frame.still) && world.carried.size === 0
  const { pixels, width } = smoothPixels(frame ?? { shapes: [], wholes: [], width: 0, height: 0, still: true }, columns, rows, stage.cell, scheme)
  // Once a leg, the next leg's land queued to be drawn ahead.
  const scenery = frame?.scenery
  if (scenery !== undefined && stage.ahead !== scenery.land.key) {
    stage.ahead = scenery.land.key
    prefetchScenery(scenery.upcoming(), columns, rows, stage.cell, scheme)
  }

  return { pixels, width }
}

/**
 * A frame's tiles that differ from those last swapped in, each drawn again;
 * all of them the first time, or after a resize or a refusal.
 */
const changedTiles = (stage: Stage, pixels: Uint8Array, width: number): Tile[] => {
  const { cell } = stage
  const last = stage.pixels
  const now32 = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length / 4)
  const last32 = last === undefined || last.length !== pixels.length ? undefined : new Uint32Array(last.buffer, last.byteOffset, last.length / 4)
  const tiles = stage.tiles ?? tilesOf(Math.max(1, stage.world.props.columns), Math.max(1, stage.world.props.rows)).map(tile => ({ ...tile, png: '' }))
  const changed: Tile[] = []
  for (const tile of tiles) {
    const [x0, y0, w, h] = [tile.x * cell.width, tile.y * cell.height, tile.columns * cell.width, tile.rows * cell.height]
    let same = last32 !== undefined && tile.png !== ''
    for (let y = y0; same && y < y0 + h; y += 1) for (let at = y * width + x0, end = at + w; same && at < end; at += 1) same = now32[at] === last32?.[at]
    if (same) continue
    const cut = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y += 1) cut.set(pixels.subarray(((y0 + y) * width + x0) * 4, ((y0 + y) * width + x0 + w) * 4), y * w * 4)
    tile.png = base64Of(pngOf(cut, w, h))
    changed.push(tile)
  }
  stage.tiles = tiles
  stage.pixels = pixels

  return changed
}

/** The stage's tiles to draw it with, its first frame drawn if it has none yet. */
export const stageTiles = (stage: Stage, scheme: 'dark' | 'light'): Tile[] => {
  if (stage.tiles === undefined) {
    const { pixels, width } = stageFrame(stage, scheme)
    changedTiles(stage, pixels, width)
  }

  return stage.tiles ?? []
}

/** Its tiles all drawn and swapped in again at its next frame: one was refused, and may show an old one. */
export const redrawTiles = (stage: Stage): void => {
  stage.pixels = undefined
}

/**
 * One frame of the timer: the world on by `step` (the time gone since the
 * last, so a late frame is never slow motion), then, when `draw` says and
 * its picture is due (every frame while anything moves, every STILL_EVERY
 * while all stand still), the tiles that changed; else none.
 */
export const stageTick = (stage: Stage, step: number, scheme: 'dark' | 'light', draw = true): Tile[] => {
  if (stage.world.props.paused === true) return []
  tick(stage.world, step)
  stage.skipped += 1
  const ahead = clockMs()
  if (ahead !== undefined) workScenery(ahead + AHEAD_MS)
  if (!draw || (stage.still && stage.world.carried.size === 0 && stage.skipped < STILL_EVERY)) return []
  stage.skipped = 0
  // The scenery on a step when it has waited long enough; what that frame took says how long till the next.
  const now = stage.world.sceneNow
  const stepping = stage.held === undefined || now - stage.held >= stage.sceneryEvery || now < stage.held
  if (stepping) stage.held = now
  const at = clockMs()
  const { pixels, width } = stageFrame(stage, scheme)
  const changed = changedTiles(stage, pixels, width)
  const took = (clockMs() ?? 0) - (at ?? 0)
  if (stepping && at !== undefined && changed.length > 0) {
    stage.cost = stage.cost === undefined ? took : 0.7 * stage.cost + 0.3 * took
    stage.sceneryEvery = Math.max(SCENERY_STEP_MS, Math.min(SCENERY_MOST_MS, stage.cost * SCENERY_SHARE))
    stage.measured += 1
    if (stage.measured === PANS_AFTER) stage.pans = stage.cost <= PANS_MOST_MS
  }

  return changed
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
