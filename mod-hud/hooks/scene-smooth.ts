import { chain, rasterOf, scale, shapesMarkup, svgOf, translate } from './clawd-vector'
import type { Shape } from './clawd-vector'
import { BODY_WIDTH, BODY_X, BOX_ROWS, MINI, MINI_SCALE, SKY } from './mascot-sprites'
import { ACCENT } from './scene-model'
import { PIPE_COLOUR, PIPE_SHINE, PIPE_WIDTH } from './scene-pipe'
import { placedSprites } from './scene-placement'
import type { Cell, MascotLayout, MascotPlan, MascotScene, PlacedSprite, SceneView } from './scene-types'
import { glyphShapes } from './raster-font'
import { crossShapes, figureShapes, markShapes, pipeShapes, tickShapes } from './smooth-art'
import { blinkTurn, livelyOf, targetOf } from './smooth-pose'
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
 * and drawn calm, when a mascot's eyes next shut or open (`blinks`).
 */
export type SmoothFrame = { shapes: Shape[]; wholes: (readonly [number, number])[]; width: number; height: number; still: boolean; blinks?: number }

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
 * by `smoother` (kept by the caller from frame to frame), `calm` for a
 * picture of few frames (`PoseContext.calm`); undefined when nothing fits.
 */
export const smoothFrame = (scene: MascotScene, layout: MascotLayout, plan: MascotPlan | undefined, view: SceneView | undefined, smoother: Smoother, now: number, calm = false): SmoothFrame | undefined => {
  const placed = placedSprites(scene, layout, plan, view)
  if (placed === undefined || plan === undefined) return undefined
  const room = placed.headroom
  const rows = room + BOX_ROWS + placed.depth - 1
  const shapes: Shape[] = []
  const wholes: (readonly [number, number])[] = []
  const kept = new Set<string>()
  let still = placed.pipes.length === 0 && placed.marks.length === 0
  let blinks = Infinity
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
      ...(calm ? { calm } : {}),
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
    if (calm) blinks = Math.min(blinks, blinkTurn(now, context.seed))
    const info = mini ? { ...figure.info, energy: 0 as const, letter: undefined } : figure.info
    // The room's top is the canvas's: its feet's height over it, in the figure's units.
    const from = shapes.length
    shapes.push(...figureShapes(pose, info, chain(translate(middle * 2, feet * 4), scale(mini ? MINI_SCALE : 1)), now, (feet * 4) / (mini ? MINI_SCALE : 1)))
    wholes.push([from, shapes.length])
  }
  smoother.keep(kept)
  for (const pipe of placed.pipes) {
    shapes.push(...pipeShapes(pipe.x * 2, PIPE_WIDTH[pipe.kind] * 2, -4, (room + pipe.lip + 1) * 4, PIPE_COLOUR, PIPE_SHINE))
  }
  for (const mark of placed.marks) shapes.push(...markShapes(mark.ch, (mark.x + 0.5) * 2, (room + mark.row + 0.5) * 4, mark.colour, now))

  return { shapes, wholes, width: plan.columns * 2, height: rows * 4, still, ...(blinks < Infinity ? { blinks } : {}) }
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
  let shapes: readonly Shape[] = frame.shapes
  // Past the limit, whole mascots are left out, the last drawn first: never one drawn in part.
  if (shapesMarkup(shapes, view).markup.length > budget) {
    const sizes = frame.wholes.map(([from, to]) => shapesMarkup(frame.shapes.slice(from, to), view).markup.length)
    let over = shapesMarkup(shapes, view).markup.length - budget
    const dropped = new Set<number>()
    for (let index = frame.wholes.length - 1; index >= 0 && over > 0; index -= 1) {
      dropped.add(index)
      over -= sizes[index] ?? 0
    }
    const gone = new Set(frame.wholes.flatMap(([from, to], index) => (dropped.has(index) ? Array.from({ length: to - from }, (_, at) => from + at) : [])))
    shapes = frame.shapes.filter((_, index) => !gone.has(index))
  }

  return { source: svgOf(shapes, width, height, view, budget, extra), width, height }
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

  return { pixels: rasterOf(frame.shapes, width, height, scale(cell.width / 2, cell.height / 4), glyphShapes, scheme), width, height }
}
