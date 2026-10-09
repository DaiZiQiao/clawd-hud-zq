import { chain, documentOf, partMarkup, rasterOf, scale, translate, viewed } from './clawd-vector'
import type { Markup, Shape } from './clawd-vector'
import { BODY_WIDTH, BODY_X, BOX_ROWS, MINI, MINI_SCALE, SKY } from './mascot-sprites'
import { ACCENT } from './scene-model'
import { PIPE_COLOUR, PIPE_SHINE, PIPE_WIDTH } from './scene-pipe'
import { placedSprites } from './scene-placement'
import type { Cell, MascotLayout, MascotPlan, MascotScene, PlacedSprite, SceneView } from './scene-types'
import { glyphShapes } from './raster-font'
import { keptIn, litLights, litStill, sceneryOf } from './scenery'
import type { Daylight, Scenery } from './scenery'
import { behindPixels, sceneryPicture } from './scenery-pixels'
import type { SceneryPicture } from './scenery-pixels'
import { crossShapes, figureShapes, markShapes, pipeShapes, tickShapes } from './smooth-art'
import { blinkTurn, livelyOf, targetOf } from './smooth-pose'
import { TODDLE_MS, quirkPose } from './usagi-moves'
import { quirkAt } from './usagi-quirks'
import type { PoseContext, Smoother } from './smooth-pose'
import { CELL_HEIGHT, CELL_WIDTH, num } from './svg-style'

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
 * drawn calm, when a mascot's eyes next shut or open (`blinks`), and the
 * scenery it stands in, when it has one (hooks/scenery.ts).
 */
export type SmoothFrame = { shapes: Shape[]; wholes: (readonly [number, number])[]; width: number; height: number; still: boolean; blinks?: number; scenery?: Scenery }

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
 * How a frame stands in the world on tour (hooks/scenery.ts): its days going
 * by as `daylight` says; what moves there held as it was at `held` (by
 * default a SCENERY_STEP_MS step at a time); panning on to the next stop, or
 * not (`pans`).
 */
export type SceneryOptions = { daylight: Daylight; held?: number; pans?: boolean }

/**
 * The scene's frame at `now` (the scene's time, ms): each mascot's pose eased
 * by `smoother` (kept by the caller from frame to frame), `calm` for a
 * picture of few frames (`PoseContext.calm`), and with `scenery` the land it
 * stands in, each mascot's shadow on the ground under it; undefined when
 * nothing fits.
 */
export const smoothFrame = (scene: MascotScene, layout: MascotLayout, plan: MascotPlan | undefined, view: SceneView | undefined, smoother: Smoother, now: number, scenery: SceneryOptions | false = false, calm = false): SmoothFrame | undefined => {
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
    if (scenery !== false) {
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
  // The field begins a little behind the back row's feet; what moves there held a step at a time.
  const land = scenery === false ? undefined : sceneryOf(width, height, (room + BOX_ROWS - 0.5) * 4 - 2, now, scenery.daylight, scenery.held ?? Math.floor(now / SCENERY_STEP_MS) * SCENERY_STEP_MS, scenery.pans)

  // Panning on to the next stop, every frame drawn, as while a mascot moves.
  return { shapes, wholes, width, height, still: still && land?.panning !== true, ...(blinks < Infinity ? { blinks } : {}), ...(land === undefined ? {} : { scenery: land }) }
}

/** How often what moves in the scenery (boats, sails, the weather) moves on by default, ms: ten times a second, the mascots every frame. */
export const SCENERY_STEP_MS = 100

/** The still land's markup as last made, by what it shows and in what light: made once, not every frame. */
const stillMarkups = new Map<string, Markup>()

/** Still shapes as markup, kept by `key`, seen from `shift` units into them: moved back by it. */
const stillMarkup = (key: string, shapes: () => readonly Shape[], shift: number, prefix: string): Markup => {
  const kept = keptIn(stillMarkups, key, () => partMarkup(shapes(), Infinity, () => true, prefix))

  return shift === 0 ? kept : { markup: `<g transform='translate(${num(-shift)} 0)'>${kept.markup}</g>`, used: kept.used }
}

/** The units a desktop CSS pixel is: a cell is 8 by 16 pixels, 2 by 4 units. */
const PIXELS_PER_UNIT = CELL_WIDTH / 2

/** The scenery's choices of layers as last made (`sceneryChoices`), by what they show and the size. */
const choiceMarkups = new Map<string, readonly (readonly (readonly Markup[])[])[]>()

/** The scenery's documents as last made, by what they show, the size and the choice: the same strings while nothing behind the mascots moves on. */
const sceneryDocuments = new Map<string, readonly string[]>()

/**
 * The room the scenery is given: a fuller choice of its layers than the last
 * (`SceneryHeld`) is taken only with this many characters to spare, so the
 * mascots' markup growing and shrinking a little does not flip the ground's
 * texture on and off.
 */
const ROOM_STEP = 4096

/** A drawing's last choice of the scenery's layers, kept by the drawing from frame to frame. */
export type SceneryHeld = { choice?: number }

/**
 * The frame as the desktop's `Svg` sources, `columns` by `rows` cells of
 * CELL_WIDTH by CELL_HEIGHT pixels, under `limit` characters together: the
 * mascots (`source`) and, laid under them, the scenery's layers (`scenery`,
 * back to front: the fullest of `sceneryChoices` with room, a fuller one
 * than `held`'s last only with ROOM_STEP to spare).
 */
export const smoothSvg = (frame: SmoothFrame, columns: number, rows: number, limit: number, held: SceneryHeld = {}): { source: string; scenery?: readonly string[]; width: number; height: number } => {
  const width = Math.max(1, Math.floor(columns)) * CELL_WIDTH
  const height = Math.max(1, Math.floor(rows)) * CELL_HEIGHT
  const view = scale(PIXELS_PER_UNIT)
  const extra = ` font-family='ui-monospace,Menlo,Consolas,monospace' text-anchor='middle'`
  const scenery = frame.scenery
  // Each document's own markup round its shapes, three of them with the scenery.
  const budget = limit - (scenery === undefined ? 400 : 1200)
  let mascots = partMarkup(frame.shapes)
  // Past the limit, whole mascots are left out, the last drawn first: never one drawn in part.
  if (mascots.markup.length > budget) {
    const sizes = frame.wholes.map(([from, to]) => partMarkup(frame.shapes.slice(from, to)).markup.length)
    let over = mascots.markup.length - budget
    const dropped = new Set<number>()
    for (let index = frame.wholes.length - 1; index >= 0 && over > 0; index -= 1) {
      dropped.add(index)
      over -= sizes[index] ?? 0
    }
    const gone = new Set(frame.wholes.flatMap(([from, to], index) => (dropped.has(index) ? Array.from({ length: to - from }, (_, at) => from + at) : [])))
    mascots = partMarkup(frame.shapes.filter((_, index) => !gone.has(index)), budget)
  }
  const document = (parts: readonly Markup[]): string => documentOf({ markup: viewed(parts.map(part => part.markup).join(''), view), used: new Set(parts.flatMap(part => [...part.used])) }, width, height, extra)
  if (scenery === undefined) return { source: document([mascots]), width, height }
  // The weather nearest the eye over the mascots, when it fits; the scenery in the room left.
  const front = partMarkup(scenery.front, Infinity, () => true, 'f')
  const near = mascots.markup.length + front.markup.length <= budget - ROOM_STEP ? [mascots, front] : [mascots]
  const room = budget - near.reduce((sum, part) => sum + part.markup.length, 0)
  const size = `${columns}x${rows}`
  const choices = keptIn(choiceMarkups, `${scenery.behind}:${size}`, () => sceneryChoices(scenery, frame.width, frame.height), 4)
  const last = held.choice ?? choices.length
  const fits = choices.findIndex((layers, index) => layers.flat().reduce((sum, part) => sum + part.markup.length, 0) <= room - (index < last ? ROOM_STEP : 0))
  const choice = fits < 0 ? choices.length : fits
  held.choice = choice
  const behind = keptIn(sceneryDocuments, `${scenery.behind}:${size}:${choice}`, () => (choices[choice] ?? []).filter(parts => parts.some(part => part.markup !== '')).map(document), 4)

  return { source: document(near), ...(behind.length === 0 ? {} : { scenery: behind }), width, height }
}

/**
 * The scenery behind the mascots as layers, alike shapes merged into paths:
 * the sky and the still land of the stops in view lit for the hour, with its
 * lights, made again only as the sky or the light moves on (or a pan does);
 * over them what moves on the land, the stop's name and the weather, at each
 * of the scenery's steps. Fullest first: all of it, then without (one by
 * one) the ground's texture, the weather, the sky's sun, moon, stars and
 * clouds, what moves on the land, then the lights.
 */
const sceneryChoices = (scenery: Scenery, width: number, height: number): readonly (readonly (readonly Markup[])[])[] => {
  const { land } = scenery
  const moving = (shapes: readonly Shape[], prefix: string): Markup => partMarkup(shapes, Infinity, () => true, prefix)
  // The sky's colours, fading in from the page at the top: masked by a ramp down, from 0.3 to whole.
  const top = num(scenery.sky.top)
  const fill = moving(scenery.sky.fill, 's')
  const sky = { markup: `<linearGradient id='sky-top' gradientUnits='userSpaceOnUse' x1='0' y1='0' x2='0' y2='${top}'><stop offset='0' stop-color='#ffffff' stop-opacity='0.3'/><stop offset='1' stop-color='#ffffff'/></linearGradient><mask id='sky'><rect width='${num(width)}' height='${num(height)}' fill='url(#sky-top)'/></mask><g mask='url(#sky)'>${fill.markup}</g>`, used: fill.used }
  const skyMoving = moving(scenery.sky.moving, 'm')
  // The stops whose art is in view: the rest of the leg's strip (the stop the tour will pan on to) left out.
  const view = [land.shift, land.shift + width] as const
  const seen = land.parts.flatMap((part, index) => (part.to > view[0] && part.from < view[1] ? [index] : []))
  const which = `${seen[0]}-${seen[seen.length - 1]}`
  const still = (texture: boolean): Markup => stillMarkup(`${land.key}:${land.litKey}:${texture}:${which}`, () => litStill(land, texture, view), land.shift, 'l')
  const lights = stillMarkup(`${land.key}:${land.litKey}:lights:${which}`, () => litLights(land, view), land.shift, 'o')
  const landMoving = moving(land.moving, 'n')
  const caption = moving(land.caption, 'c')
  const weather = moving(scenery.weather, 'w')

  return [
    [[sky, skyMoving, still(true), lights], [landMoving, caption, weather]],
    [[sky, skyMoving, still(false), lights], [landMoving, caption, weather]],
    [[sky, skyMoving, still(false), lights], [landMoving, caption]],
    [[sky, still(false), lights], [landMoving, caption]],
    [[sky, still(false), lights], [caption]],
    [[sky, still(false)], [caption]],
  ]
}

/**
 * The frame as RGBA pixels over `columns` by `rows` cells of `cell` pixels
 * each, laid as `smoothSvg` lays it, its text in the raster font
 * (hooks/raster-font.ts) and its theme keys in `scheme`'s colours: a terminal
 * Image's picture. With scenery, what is behind the mascots is drawn again
 * only when it moves on (`Scenery.behind`), the sky and the still land only
 * when they do (`Scenery.still`), each kept in `kept` (the picture's own; by
 * default one for this frame alone): a frame between is those pixels kept,
 * and the mascots over them.
 */
export const smoothPixels = (
  frame: SmoothFrame,
  columns: number,
  rows: number,
  cell: { width: number; height: number },
  scheme: 'dark' | 'light' = 'dark',
  kept: SceneryPicture = sceneryPicture(),
): { pixels: Uint8Array; width: number; height: number } => {
  const width = Math.max(1, Math.floor(columns)) * cell.width
  const height = Math.max(1, Math.floor(rows)) * cell.height
  const view = scale(cell.width / 2, cell.height / 4)
  const scenery = frame.scenery
  if (scenery === undefined) return { pixels: rasterOf(frame.shapes, width, height, view, glyphShapes, scheme), width, height }
  const behind = behindPixels(kept, scenery, width, height, cell, scheme)

  // The stop's name over it as it is now, fading in and out while the rest holds, under the mascots.
  return { pixels: rasterOf([...scenery.land.caption, ...frame.shapes, ...scenery.front], width, height, view, glyphShapes, scheme, behind.slice()), width, height }
}
