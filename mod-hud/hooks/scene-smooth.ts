import { chain, overlay, rasterOf, scale, shapesMarkup, svgOf, translate } from './clawd-vector'
import type { Shape } from './clawd-vector'
import { BODY_WIDTH, BODY_X, BOX_ROWS, MINI, MINI_SCALE, SKY } from './mascot-sprites'
import { ACCENT } from './scene-model'
import { PIPE_COLOUR, PIPE_SHINE, PIPE_WIDTH } from './scene-pipe'
import { placedSprites } from './scene-placement'
import type { Cell, MascotLayout, MascotPlan, MascotScene, PlacedSprite, SceneView } from './scene-types'
import { glyphShapes } from './raster-font'
import { sceneryOf } from './scenery'
import type { Layer, Scenery } from './scenery'
import { crossShapes, figureShapes, markShapes, pipeShapes, tickShapes } from './smooth-art'
import { livelyOf, targetOf } from './smooth-pose'
import { TODDLE_MS, quirkPose } from './usagi-moves'
import { quirkAt } from './usagi-quirks'
import type { PoseContext, Smoother } from './smooth-pose'
import { CELL_HEIGHT, CELL_WIDTH } from './svg-style'

// The mascot scene drawn smooth: the same plan, view and looks as the cells
// (hooks/scene-placement.ts), each mascot as Clawd's or Usagi's shapes
// (hooks/smooth-art.ts) in a pose eased from frame to frame
// (hooks/smooth-pose.ts), the pipes, the marks and the strip; as an SVG for
// the desktop, as pixels for a terminal's Image. World units: a cell is 2
// across and 4 down, the canvas's top-left (the sky's first row) the origin.

/**
 * A frame of the smooth scene: its shapes, back to front, each mascot's run
 * of them (`wholes`, from and to), its size in units, whether all its mascots
 * stand still (none moving, held or thrown, in a scene's step, tidying up; no
 * pipe, no mark: only a breath or a blink between this frame and the next),
 * and the scenery it stands in, when it has one (hooks/scenery.ts).
 */
export type SmoothFrame = { shapes: Shape[]; wholes: (readonly [number, number])[]; width: number; height: number; still: boolean; scenery?: Scenery }

/** The phases a mascot keeps still in: at work, stalled, slumped. */
const RESTING: ReadonlySet<string> = new Set(['work', 'stalled', 'sit'])

const seedOf = (id: string): number => {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0

  return (hash % 997) / 97
}

/**
 * The strip's dots and count, as the cells have them: each status a shape in
 * its agent's colour (`●` running, `◌` stalled, `✓` done, `✗` failed), the
 * count's glyphs dim, each at its cell's middle.
 */
const stripShapes = (sprite: PlacedSprite, room: number): Shape[] => {
  const row = sprite.cells[2] ?? []
  const middle = (room + sprite.top + 2 + 0.5) * 4

  return row.flatMap((cell: Cell | undefined, index: number): Shape[] => {
    if (cell === undefined || cell.ch.trim() === '') return []
    const fill = cell.ink === 'd' ? 'inactive' : cell.colour.startsWith('#') ? cell.colour : ACCENT
    const x = (sprite.x + index + 0.5) * 2
    switch (cell.ch) {
      case '●':
        return [{ kind: 'ellipse', x: x - 0.8, y: middle - 0.8, w: 1.6, h: 1.6, fill }]
      case '◌':
        return [{ kind: 'ellipse', x: x - 0.75, y: middle - 0.75, w: 1.5, h: 1.5, ring: 0.35, fill }]
      case '✓':
        return tickShapes(translate(x, middle + 0.4), fill, 2)
      case '✗':
        return crossShapes(translate(x, middle), fill, 1.8)
      default:
        return [{ kind: 'text', x, y: middle + 1.12, w: 0, h: 0, text: cell.ch, size: 3.2, fill }]
    }
  })
}

/**
 * The scene's frame at `now` (the scene's time, ms): each mascot's pose eased
 * by `smoother` (kept by the caller from frame to frame), and with `scenery`
 * the land it stands in, each mascot's shadow on the ground under it;
 * undefined when nothing fits.
 */
export const smoothFrame = (scene: MascotScene, layout: MascotLayout, plan: MascotPlan | undefined, view: SceneView | undefined, smoother: Smoother, now: number, scenery = false): SmoothFrame | undefined => {
  const placed = placedSprites(scene, layout, plan, view)
  if (placed === undefined || plan === undefined) return undefined
  const room = placed.headroom
  const rows = room + BOX_ROWS + placed.depth - 1
  const shapes: Shape[] = []
  const wholes: (readonly [number, number])[] = []
  const kept = new Set<string>()
  let still = placed.pipes.length === 0 && placed.marks.length === 0
  for (const sprite of placed.sprites) {
    if (sprite.kind === 'strip') {
      shapes.push(...stripShapes(sprite, room))
      continue
    }
    const figure = sprite.figure
    if (figure === undefined) continue
    kept.add(sprite.id)
    const mini = figure.mini !== undefined
    const usagi = figure.info.character === 'usagi'
    const left = sprite.exact?.x ?? sprite.x
    // The grid's sky row, less the cells' bounce (the pose bounces its own way).
    const top = room + (sprite.exact?.top ?? sprite.top) + (figure.bob ?? 0)
    const feet = top + SKY + (usagi ? BOX_ROWS : BOX_ROWS - 0.5)
    const middle = left + (mini ? MINI / 2 : BODY_X + BODY_WIDTH / 2)
    const context: PoseContext = {
      character: figure.info.character,
      now,
      seed: seedOf(sprite.id),
      mini,
      ...(figure.context.motion === undefined ? {} : { motion: figure.context.motion }),
      ...(figure.context.facing === undefined ? {} : { facing: figure.context.facing }),
      ...(figure.context.pose === undefined ? {} : { pose: figure.context.pose }),
      ...(figure.context.cues === undefined ? {} : { cues: figure.context.cues }),
      ...(figure.phase === undefined ? {} : { phase: figure.phase }),
      ...(figure.tidyMs === undefined ? {} : { tidyMs: figure.tidyMs }),
      ...(figure.stretchMs === undefined ? {} : { stretchMs: figure.stretchMs }),
    }
    const look = figure.look ?? figure.mini
    if (look === undefined) continue
    if (sprite.moving || context.motion !== undefined || context.pose !== undefined || context.tidyMs !== undefined || context.stretchMs !== undefined || (figure.phase !== undefined && !RESTING.has(figure.phase.kind))) still = false
    let pose = smoother.ease(sprite.id, targetOf(look, context, mini), now)
    // A walk's bounce and the cheer's dance as arcs, rather than a row's jump every other frame; Usagi's toddle a bob a step.
    const bounce = context.motion?.kind === 'walk' ? (usagi ? 0.4 : 0.5) : figure.phase?.kind === 'cheer' ? 1.4 : 0
    if (bounce > 0) pose = { ...pose, drop: pose.drop - bounce * Math.abs(Math.sin((2 * Math.PI * now) / (usagi ? TODDLE_MS : 520) + context.seed)) }
    // Usagi's quirk, if one has come over it (hooks/usagi-quirks.ts): over the eased pose, by time.
    const quirk = figure.quirk === undefined ? undefined : quirkAt(sprite.id, now, figure.quirk.place, figure.quirk.sky)
    if (quirk !== undefined) {
      pose = quirkPose(pose, quirk, context.facing)
      still = false
    }
    pose = livelyOf(pose, context, !sprite.moving && quirk === undefined)
    const info = mini ? { ...figure.info, energy: 0 as const, letter: undefined } : figure.info
    // The room's top is the canvas's: its feet's height over it, in the figure's units.
    const from = shapes.length
    if (scenery) {
      // Its shadow on its floor, smaller and fainter the higher it is.
      const lift = Math.max(0, sprite.d - SKY - (sprite.exact?.top ?? sprite.top))
      const floor = (room + sprite.d + (usagi ? BOX_ROWS : BOX_ROWS - 0.5)) * 4
      const size = (mini ? MINI_SCALE : 1) * Math.max(0.45, 1 - lift * 0.1)
      shapes.push({ kind: 'ellipse', x: middle * 2 - 5.5 * size, y: floor - 0.8 * size, w: 11 * size, h: 1.6 * size, fill: '#000000', alpha: 0.3 * Math.max(0.3, 1 - lift * 0.15) })
    }
    shapes.push(...figureShapes(pose, info, chain(translate(middle * 2, feet * 4), scale(mini ? MINI_SCALE : 1)), now, (feet * 4) / (mini ? MINI_SCALE : 1)))
    wholes.push([from, shapes.length])
  }
  smoother.keep(kept)
  for (const pipe of placed.pipes) {
    shapes.push(...pipeShapes(pipe.x * 2, PIPE_WIDTH[pipe.kind] * 2, -4, (room + pipe.lip + 1) * 4, PIPE_COLOUR, PIPE_SHINE))
  }
  for (const mark of placed.marks) shapes.push(...markShapes(mark.ch, (mark.x + 0.5) * 2, (room + mark.row + 0.5) * 4, mark.colour, now))
  const width = plan.columns * 2
  const height = rows * 4
  // The field begins a little behind the back row's feet.
  const land = scenery ? { scenery: sceneryOf(width, height, (room + BOX_ROWS - 0.5) * 4 - 2, now) } : {}

  return { shapes, wholes, width, height, still, ...land }
}

/** A layer's still shapes where the view sees them: moved back by its shift. */
const stillShapes = (layer: Layer): readonly Shape[] => {
  if (layer.shift === 0) return layer.still
  const back = translate(-layer.shift, 0)

  return layer.still.map(shape => ({ ...shape, m: shape.m === undefined ? back : chain(back, shape.m) }))
}

/** The units a desktop CSS pixel is: a cell is 8 by 16 pixels, 2 by 4 units. */
const PIXELS_PER_UNIT = CELL_WIDTH / 2

/**
 * The frame as the desktop's `Svg` source, `columns` by `rows` cells of
 * CELL_WIDTH by CELL_HEIGHT pixels, under `limit` characters.
 */
export const smoothSvg = (frame: SmoothFrame, columns: number, rows: number, limit: number): { source: string; width: number; height: number } => {
  const width = Math.max(1, Math.floor(columns)) * CELL_WIDTH
  const height = Math.max(1, Math.floor(rows)) * CELL_HEIGHT
  const view = scale(PIXELS_PER_UNIT)
  const extra = ` font-family='ui-monospace,Menlo,Consolas,monospace' text-anchor='middle'`
  const budget = limit - 400
  // The scenery's alike shapes merged into paths: its many small ones (windows, tufts, tulips) cost little.
  const scenic = new Set<Shape>()
  const merged = (shape: Shape): boolean => scenic.has(shape)
  const size = (all: readonly Shape[]): number => shapesMarkup(all, view, Infinity, merged).markup.length
  let shapes: readonly Shape[] = frame.shapes
  // Past the limit, whole mascots are left out, the last drawn first: never one drawn in part.
  if (size(shapes) > budget) {
    const sizes = frame.wholes.map(([from, to]) => size(frame.shapes.slice(from, to)))
    let over = size(shapes) - budget
    const dropped = new Set<number>()
    for (let index = frame.wholes.length - 1; index >= 0 && over > 0; index -= 1) {
      dropped.add(index)
      over -= sizes[index] ?? 0
    }
    const gone = new Set(frame.wholes.flatMap(([from, to], index) => (dropped.has(index) ? Array.from({ length: to - from }, (_, at) => from + at) : [])))
    shapes = frame.shapes.filter((_, index) => !gone.has(index))
  }
  // The scenery in what the mascots leave: all of it, else without the ground's texture, else its still layers alone, else none.
  const land = frame.scenery
  if (land !== undefined) {
    const sky = stillShapes(land.sky)
    const ground = stillShapes(land.land)
    const bare = ground.slice(0, ground.length - land.land.detail)
    for (const shape of [...sky, ...land.sky.moving, ...ground, ...land.land.moving, ...land.front]) scenic.add(shape)
    const choices = [[...sky, ...land.sky.moving, ...ground, ...land.land.moving, ...shapes, ...land.front], [...sky, ...land.sky.moving, ...bare, ...land.land.moving, ...shapes, ...land.front], [...sky, ...bare, ...shapes]]
    shapes = choices.find(all => size(all) <= budget) ?? shapes
  }
  const source = svgOf(shapes, width, height, view, budget, extra, merged)

  return { source, width, height }
}

/**
 * The frame as RGBA pixels over `columns` by `rows` cells of `cell` pixels
 * each, laid as `smoothSvg` lays it, its text in the raster font
 * (hooks/raster-font.ts) and its theme keys in `scheme`'s colours: a terminal
 * Image's picture.
 */
export const smoothPixels = (
  frame: SmoothFrame,
  columns: number,
  rows: number,
  cell: { width: number; height: number },
  scheme: 'dark' | 'light' = 'dark',
): { pixels: Uint8Array; width: number; height: number } => {
  const width = Math.max(1, Math.floor(columns)) * cell.width
  const height = Math.max(1, Math.floor(rows)) * cell.height
  const view = scale(cell.width / 2, cell.height / 4)
  const land = frame.scenery
  if (land === undefined) return { pixels: rasterOf(frame.shapes, width, height, view, glyphShapes, scheme), width, height }
  // The still layers from the cache, each seen from its shift; what moves laid over them.
  const still = (layer: Layer): Uint8Array => {
    const across = Math.max(width, Math.round((layer.span * cell.width) / 2))
    const key = `${layer.key}:${across}x${height}:${scheme}`
    const kept = stills.get(key) ?? rasterOf(layer.still, across, height, view, glyphShapes, scheme)
    stills.delete(key)
    stills.set(key, kept)
    for (const old of stills.keys()) if (stills.size > STILLS) stills.delete(old)
    const from = Math.min(across - width, Math.max(0, Math.round((layer.shift * cell.width) / 2)))
    if (across === width) return kept.slice()
    const seen = new Uint8Array(width * height * 4)
    for (let row = 0; row < height; row += 1) seen.set(kept.subarray((row * across + from) * 4, (row * across + from + width) * 4), row * width * 4)

    return seen
  }
  const pixels = rasterOf(land.sky.moving, width, height, view, glyphShapes, scheme, still(land.sky))
  overlay(pixels, still(land.land))

  return { pixels: rasterOf([...land.land.moving, ...frame.shapes, ...land.front], width, height, view, glyphShapes, scheme, pixels), width, height }
}

/** The scenery's still layers as last drawn, by what they show, their size and scheme: the band's and a pane's two each, and their next. */
const stills = new Map<string, Uint8Array>()
const STILLS = 8
