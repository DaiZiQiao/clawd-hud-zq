import type { ClientPointerEvent, JsonValue } from 'claude-code'

import { base64Of, pngOf } from './png'
import { sceneCanvas } from './scene-canvas'
import { smoothFrame, smoothPixels } from './scene-smooth'
import type { SmoothFrame } from './scene-smooth'
import type { SceneInputs } from './scene-types'
import { layoutAt, sceneAt, viewOf } from './scene-view'
import { clockMs, createWorld, pointer, receive, tick } from './scene-world'
import type { World } from './scene-world'
import { prefetchScenery, sceneryPicture, workScenery } from './scenery-pixels'
import type { SceneryPicture } from './scenery-pixels'
import { createSmoother } from './smooth-pose'
import type { Smoother } from './smooth-pose'

// The vector scene in a terminal that shows pictures (Ghostty, kitty): the
// hooks run the scene's world themselves, as the `Client` runs it on its
// surface (hooks/scene-world.ts), and draw each frame as tiles, each a keyed
// `Image`: a tile whose pixels changed is a PNG (hooks/png.ts) swapped in by
// `$.ui.blit`, the rest left as they are, so a frame costs what moved in it
// (a mascot walking over the scenery, not the whole world behind it). Kept
// light for the terminal, which decodes and draws every tile it is sent: a
// few frames a second, the scenery a still picture between its steps, and
// no more bytes a second than BYTES_A_SECOND. Over the tiles a `Client` with
// nothing to draw (hooks/scene-hit.tsx) hands them the person's pointer,
// each event numbered so none is taken twice. Pure: the hooks
// (hooks/register.tsx) keep the stages, the timer and the blits.

/** A frame every 125 ms while anything moves (eight a second); every fourth while all stand still (a hand on the keys: two a second do), and as a blink begins and ends. */
export const IMAGE_FRAME_MS = 125
export const STILL_EVERY = 4

/** The picture's pixels per cell: the desktop's 8 by 16; twice that for a small region (the band), which costs as little. */
export const cellPixels = (columns: number, rows: number): { width: number; height: number } =>
  columns * rows <= 200 ? { width: 16, height: 32 } : { width: 8, height: 16 }

/** A picture's tile: `columns` by `rows` cells from cell `x`, `y` of the region, its last frame (base64 PNG), and whether that is swapped in yet. */
export type Tile = { x: number; y: number; columns: number; rows: number; png: string; sent: boolean }

/** How big a tile is, in cells: small, so a mascot moving sends little more than the cells it is in. */
export const TILE_COLUMNS = 10
export const TILE_ROWS = 3

/** A region of `columns` by `rows` cells as tiles, row by row, those at its right and bottom edges smaller. */
export const tilesOf = (columns: number, rows: number): Omit<Tile, 'png' | 'sent'>[] =>
  Array.from({ length: Math.ceil(rows / TILE_ROWS) }, (_, row) =>
    Array.from({ length: Math.ceil(columns / TILE_COLUMNS) }, (_, column) => ({ x: column * TILE_COLUMNS, y: row * TILE_ROWS, columns: Math.min(TILE_COLUMNS, columns - column * TILE_COLUMNS), rows: Math.min(TILE_ROWS, rows - row * TILE_ROWS) })),
  ).flat()

/**
 * A picture's scenery is a still picture that moves on (its sky and light,
 * its boats, its weather) every PICTURE_SCENERY_MS, and goes on to the next
 * stop at once, never panning (a frame of a pan would send it all): between,
 * a frame is its mascots, and the stop's name as it arrives, over the pixels
 * kept.
 */
export const PICTURE_SCENERY_MS = 15_000
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
/** What a timer's frame gives to drawing the scenery ahead (the next leg's land, the next hour's light), ms. */
const AHEAD_MS = 4

/**
 * One scene drawn as a picture: its world, its eased poses, its tiles as last
 * drawn and the frame they were cut from; its scenery's pixels, and when its
 * scenery last moved on (the scene's time); the timer's frames it waits to
 * draw, and the bytes it may still send.
 */
export type Stage = {
  world: World
  smoother: Smoother
  scenery: SceneryPicture
  cell: { width: number; height: number }
  tiles?: Tile[]
  pixels?: Uint8Array
  held?: number
  /** The land whose next leg's is drawn ahead already. */
  ahead?: string
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
  scenery: sceneryPicture(),
  cell: cellPixels(inputs.columns, inputs.rows),
  wait: 0,
  allowance: BYTES_AT_ONCE,
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
    // Calm: no breath (a body that swells and settles would send its every tile again each frame it stands still), a blink shut whole.
    frame = smoothFrame(scene, layout, plan, view.sprites, stage.smoother, world.sceneNow, daylight === undefined ? false : { daylight, held: stage.held ?? world.sceneNow, pans: false }, true)
  }
  stage.still = (frame === undefined || frame.still) && world.carried.size === 0
  stage.blinks = frame?.blinks
  const { pixels, width } = smoothPixels(frame ?? { shapes: [], wholes: [], width: 0, height: 0, still: true }, columns, rows, stage.cell, scheme, stage.scenery)
  // Once a leg (or in another scheme), the next leg's land queued to be drawn ahead.
  const scenery = frame?.scenery
  if (scenery !== undefined && stage.ahead !== `${scenery.land.key}:${scheme}`) {
    stage.ahead = `${scenery.land.key}:${scheme}`
    prefetchScenery(stage.scenery, scenery.upcoming(), columns, rows, stage.cell, scheme)
  }

  return { pixels, width }
}

/**
 * A frame's tiles that differ from those last drawn, each drawn again (and
 * so to be swapped in); all of them the first time, or after a resize.
 */
const changedTiles = (stage: Stage, pixels: Uint8Array, width: number): void => {
  const { cell } = stage
  const last = stage.pixels
  const now32 = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length / 4)
  const last32 = last === undefined || last.length !== pixels.length ? undefined : new Uint32Array(last.buffer, last.byteOffset, last.length / 4)
  const tiles = stage.tiles ?? tilesOf(Math.max(1, stage.world.props.columns), Math.max(1, stage.world.props.rows)).map(tile => ({ ...tile, png: '', sent: false }))
  for (const tile of tiles) {
    const [x0, y0, w, h] = [tile.x * cell.width, tile.y * cell.height, tile.columns * cell.width, tile.rows * cell.height]
    let same = last32 !== undefined && tile.png !== ''
    for (let y = y0; same && y < y0 + h; y += 1) for (let at = y * width + x0, end = at + w; same && at < end; at += 1) same = now32[at] === last32?.[at]
    if (same) continue
    const cut = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y += 1) cut.set(pixels.subarray(((y0 + y) * width + x0) * 4, ((y0 + y) * width + x0 + w) * 4), y * w * 4)
    tile.png = base64Of(pngOf(cut, w, h))
    tile.sent = false
  }
  stage.tiles = tiles
  stage.pixels = pixels
}

/** The stage's tiles to draw it with, its first frame drawn if it has none yet: the drawing carries each tile's last frame, so none waits to be swapped in. */
export const stageTiles = (stage: Stage, scheme: 'dark' | 'light'): Tile[] => {
  if (stage.tiles === undefined) {
    const { pixels, width } = stageFrame(stage, scheme)
    changedTiles(stage, pixels, width)
  }
  for (const tile of stage.tiles ?? []) tile.sent = true

  return stage.tiles ?? []
}

/** Tiles whose swap was refused, and may show an old frame: swapped in again at the next frame. */
export const refusedTiles = (tiles: readonly Tile[]): void => {
  for (const tile of tiles) tile.sent = false
}

/** The stages' scenery's work ahead (the next leg's land, a new hour's light) on for AHEAD_MS: once a timer's frame, after its pictures are drawn. */
export const workAhead = (stages: readonly Stage[]): void => {
  const at = clockMs()
  if (at !== undefined) workScenery(stages.map(stage => stage.scenery), at + AHEAD_MS)
}

/**
 * One frame of the timer: the world on by `step` (the time gone since the
 * last, so a late frame is never slow motion), then, when its picture is due
 * (its wait done and bytes to send; every frame while anything moves, every
 * STILL_EVERY while all stand still), the tiles that changed; with them, any
 * refused before: the tiles to swap in now.
 */
export const stageTick = (stage: Stage, step: number, scheme: 'dark' | 'light'): Tile[] => {
  if (stage.world.props.paused === true) return []
  tick(stage.world, step)
  stage.skipped += 1
  stage.wait -= 1
  stage.allowance = Math.min(BYTES_AT_ONCE, stage.allowance + (BYTES_A_SECOND * step) / 1000)
  // All standing still: every STILL_EVERY frames, and as an eye shuts or opens.
  const resting = stage.still && stage.world.carried.size === 0 && stage.skipped < STILL_EVERY && !(stage.blinks !== undefined && stage.world.sceneNow >= stage.blinks)
  if (stage.wait < 0 && stage.allowance > 0 && !resting) drawTick(stage, scheme)
  const unsent = (stage.tiles ?? []).filter(tile => !tile.sent)
  for (const tile of unsent) {
    tile.sent = true
    stage.allowance -= tile.png.length
  }

  return unsent
}

/** A frame drawn: its scenery moved on when it has held long enough, and what drawing it took says how long till the next. */
const drawTick = (stage: Stage, scheme: 'dark' | 'light'): void => {
  stage.skipped = 0
  const now = stage.world.sceneNow
  if (stage.held === undefined || now - stage.held >= PICTURE_SCENERY_MS || now < stage.held) stage.held = now
  const at = clockMs()
  const { pixels, width } = stageFrame(stage, scheme)
  changedTiles(stage, pixels, width)
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
