import { chain, gradeTable, overlay, paintRects, rasterOf, rowsOf, scale, translate } from './clawd-vector'
import type { GradeTable, Matrix, Shape } from './clawd-vector'
import { glyphShapes } from './raster-font'
import { clockMs } from './scene-world'
import type { Land, Scenery } from './scenery'

// The world tour behind a terminal's picture, in pixels (hooks/scene-smooth.ts
// lays the mascots over it). A leg's still land is a strip drawn once in
// daylight colours, its lights beside it, then lit for the hour column by
// column with its lights laid over: again in the frame its light changes in
// (a picture's scenery moves on only every few seconds). The next leg's land
// is drawn and lit ahead while this one is shown (`prefetchScenery`), a few
// shapes or a band of rows at a time, a few ms a frame (`workScenery`); at
// once only when a frame cannot do without it. What is behind the mascots is kept between the
// scenery's steps. Each picture keeps its own (`SceneryPicture`), so two
// pictures never undo each other's.

type Cell = { width: number; height: number }

/** Rows lit at a time, and drawn: a band of them a few shapes at a time (`SHAPES`), the land's being crowded into a few. */
const BAND = 16
const SHAPES = 8

/**
 * A leg's land in pixels for one picture: the land as last asked for (the
 * light to light it for), its strip's size and scheme, the still land in
 * daylight and its lights (`drawn` rows of both so far, and the band being
 * drawn: its shapes and how many are), the land lit for an hour, the
 * lighting under way, and the buffer lit before that, to light into next.
 */
type Strip = {
  land: Land
  across: number
  height: number
  view: Matrix
  scheme: 'dark' | 'light'
  still?: Uint8Array
  lights?: Uint8Array
  drawn: number
  /** Each shape's rows of pixels, still land and lights, so a band draws only those reaching it. */
  rows?: { still: [number, number][]; lights: [number, number][] }
  band?: { to: number; shapes: (readonly [Shape, Uint8Array])[]; done: number }
  lit?: { litKey: string; pixels: Uint8Array }
  lighting?: { litKey: string; pixels: Uint8Array; row: number; grades: GradeTable; glows?: GradeTable }
  spare?: Uint8Array
}

/**
 * A picture's scenery in pixels: the leg's land shown and the next one's
 * drawn ahead (no other), and the sky and still land, and all that is behind
 * the mascots, as last composed, each by its key.
 */
export type SceneryPicture = { current?: Strip; next?: Strip; still?: { key: string; pixels: Uint8Array }; behind?: { key: string; pixels: Uint8Array } }

export const sceneryPicture = (): SceneryPicture => ({})

/** A strip for `land` in a picture `width` by `height` pixels, nothing yet drawn in it. */
const stripOf = (land: Land, width: number, height: number, cell: Cell, scheme: 'dark' | 'light'): Strip => ({
  land,
  across: Math.max(width, Math.round((land.span * cell.width) / 2)),
  height,
  view: scale(cell.width / 2, cell.height / 4),
  scheme,
  drawn: 0,
})

/** Whether `strip` is `land`'s for a picture `width` by `height` pixels in `scheme`. */
const isFor = (strip: Strip | undefined, land: Land, width: number, height: number, cell: Cell, scheme: 'dark' | 'light'): strip is Strip =>
  strip !== undefined && strip.land.key === land.key && strip.height === height && strip.scheme === scheme && strip.across === Math.max(width, Math.round((land.span * cell.width) / 2))

/** `land`'s strip in `picture`: the one shown, the one drawn ahead (now shown, the last let go), or a new one. */
const shownStrip = (picture: SceneryPicture, land: Land, width: number, height: number, cell: Cell, scheme: 'dark' | 'light'): Strip => {
  if (!isFor(picture.current, land, width, height, cell, scheme)) {
    picture.current = isFor(picture.next, land, width, height, cell, scheme) ? picture.next : stripOf(land, width, height, cell, scheme)
    if (picture.next === picture.current) picture.next = undefined
  }
  picture.current.land = land

  return picture.current
}

/**
 * The next piece of a strip's work, done: a few shapes of a band of the still
 * land and its lights drawn, else a band lit for the light last asked for
 * (once lit for another, or never). False when there is none left.
 */
const workOn = (strip: Strip): boolean => {
  const { across, height, view, scheme } = strip
  const size = across * height * 4
  if (strip.drawn < height) {
    const still = (strip.still ??= new Uint8Array(size))
    const lights = (strip.lights ??= new Uint8Array(size))
    const rows = (strip.rows ??= { still: strip.land.still.map(shape => rowsOf(shape, view)), lights: strip.land.lights.map(shape => rowsOf(shape, view)) })
    const from = strip.drawn
    const to = Math.min(height, from + BAND)
    // The band's shapes, the still land's then its lights', each with the pixels it is drawn into.
    const reaching = (shapes: readonly Shape[], reach: readonly [number, number][], pixels: Uint8Array): (readonly [Shape, Uint8Array])[] =>
      shapes.flatMap((shape, i) => ((reach[i]?.[1] ?? Infinity) >= from && (reach[i]?.[0] ?? -Infinity) < to ? [[shape, pixels] as const] : []))
    const band = (strip.band ??= { to, shapes: [...reaching(strip.land.still, rows.still, still), ...reaching(strip.land.lights, rows.lights, lights)], done: 0 })
    const banded = chain(translate(0, -from), view)
    for (const [shape, pixels] of band.shapes.slice(band.done, band.done + SHAPES)) rasterOf([shape], across, to - from, banded, glyphShapes, scheme, pixels.subarray(from * across * 4, to * across * 4))
    band.done += SHAPES
    if (band.done >= band.shapes.length) {
      strip.drawn = to
      strip.band = undefined
    }

    return true
  }
  const { land, still, lights } = strip
  if (still === undefined || lights === undefined) return false
  if (strip.lighting === undefined) {
    if (strip.lit?.litKey === land.litKey) return false
    // Each column's light, and its lights' glow when any shows; into the buffer lit before the last, when there is one.
    const columns = Array.from({ length: across }, (_, x) => land.litAt((x + 0.5) / view[0]))
    const glowing = land.lights.length > 0 && columns.some(one => one.glow > 0.01)
    strip.lighting = {
      litKey: land.litKey,
      pixels: strip.spare ?? new Uint8Array(size),
      row: 0,
      grades: gradeTable(columns.map(one => one.grade)),
      ...(glowing ? { glows: gradeTable(columns.map(one => ({ m: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], add: [0, 0, 0], alpha: one.glow }))) } : {}),
    }
  }
  const lighting = strip.lighting
  const [from, to] = [lighting.row * across * 4, Math.min(height, lighting.row + BAND) * across * 4]
  const band = lighting.pixels.subarray(from, to).fill(0)
  overlay(band, still.subarray(from, to), across, across, 0, lighting.grades)
  if (lighting.glows !== undefined) overlay(band, lights.subarray(from, to), across, across, 0, lighting.glows)
  lighting.row += BAND
  if (lighting.row >= height) {
    strip.spare = strip.lit?.pixels
    strip.lit = { litKey: lighting.litKey, pixels: lighting.pixels }
    strip.lighting = undefined
  }

  return true
}

/** The pictures' strips' work on until the clock says `until` (ms, `clockMs`): each's next leg first, then what is left of its shown land's. */
export const workScenery = (pictures: Iterable<SceneryPicture>, until: number): void => {
  for (const picture of pictures) {
    for (const strip of [picture.next, picture.current]) {
      while (strip !== undefined && (clockMs() ?? Infinity) < until) if (!workOn(strip)) break
    }
  }
}

/** The leg after this one's land drawn ahead in `picture`, and lit for the light as that leg begins (lit again as it is shown, if the picture's light is another then). */
export const prefetchScenery = (picture: SceneryPicture, next: Scenery, columns: number, rows: number, cell: Cell, scheme: 'dark' | 'light'): void => {
  const width = Math.max(1, Math.floor(columns)) * cell.width
  const height = Math.max(1, Math.floor(rows)) * cell.height
  if (isFor(picture.current, next.land, width, height, cell, scheme) || isFor(picture.next, next.land, width, height, cell, scheme)) return
  picture.next = stripOf(next.land, width, height, cell, scheme)
}

/**
 * What is behind the mascots in a picture `width` by `height` pixels: the
 * sky painted a row at a time, its sun, moon, stars and clouds, the still
 * land lit for the hour from where the pan has got to, then what moves on it
 * and the weather. Each layer kept in
 * `picture` by its key, the picture's size and the light the land was lit
 * for: drawn again only as any of those changes.
 */
export const behindPixels = (picture: SceneryPicture, scenery: Scenery, width: number, height: number, cell: Cell, scheme: 'dark' | 'light'): Uint8Array => {
  const strip = shownStrip(picture, scenery.land, width, height, cell, scheme)
  // Lit for another light (the scenery stepped on, or cut to the next stop), or never: its work all done now, so the picture is sent once.
  if (strip.lit?.litKey !== scenery.land.litKey) while (workOn(strip));
  const lit = strip.lit
  const behindKey = `${scenery.behind}:${width}x${height}:${scheme}:${lit?.litKey}`
  if (picture.behind?.key === behindKey) return picture.behind.pixels
  const stillKey = `${scenery.still}:${width}x${height}:${scheme}:${lit?.litKey}`
  const view = scale(cell.width / 2, cell.height / 4)
  if (picture.still?.key !== stillKey) {
    const pixels = new Uint8Array(width * height * 4)
    paintRects(pixels, width, height, view, scenery.sky.fill, scheme)
    // The sky fading in from the terminal's background at the top, from 0.3 to whole.
    for (let row = 0, rows = Math.min(height, Math.round(scenery.sky.top * view[3])); row < rows; row += 1) for (let at = row * width * 4 + 3; at < (row + 1) * width * 4; at += 4) pixels[at] = Math.round((pixels[at] ?? 0) * (0.3 + (0.7 * (row + 0.5)) / rows))
    rasterOf(scenery.sky.moving, width, height, view, glyphShapes, scheme, pixels)
    if (lit !== undefined) overlay(pixels, lit.pixels, width, strip.across, Math.min(strip.across - width, Math.max(0, Math.round((scenery.land.shift * cell.width) / 2))))
    picture.still = { key: stillKey, pixels }
  }
  const pixels = rasterOf([...scenery.land.moving, ...scenery.weather], width, height, view, glyphShapes, scheme, picture.still.pixels.slice())
  picture.behind = { key: behindKey, pixels }

  return pixels
}
