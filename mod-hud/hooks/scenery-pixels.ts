import { chain, gradeTable, overlay, paintRects, rasterOf, rowsOf, scale, translate } from './clawd-vector'
import type { GradeTable, Matrix, Shape } from './clawd-vector'
import { glyphShapes } from './raster-font'
import { clockMs } from './scene-world'
import type { Land, Scenery } from './scenery'

// The world tour behind a terminal's picture, in pixels (hooks/scene-smooth.ts
// lays the mascots over it). A leg's still land is a strip drawn once in
// daylight colours, its lights beside it, then lit for the hour column by
// column with its lights laid over: again as its light changes, the last lit
// standing in meanwhile. That work is done a band of rows at a time, a few ms
// a frame (`workScenery`), the next leg's land drawn ahead while this one is
// shown (`prefetchScenery`); at once only when a frame cannot do without it.
// What is behind the mascots is kept between the scenery's steps.

type Cell = { width: number; height: number }

/** Rows drawn or lit at a time: a band costs well under a millisecond. */
const BAND = 16

/**
 * A leg's land in pixels for one picture: the land as last asked for (the
 * light to light it for), its strip's size, the still land in daylight and its
 * lights (`drawn` rows of both so far), the land lit for an hour, the
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
  lit?: { litKey: string; pixels: Uint8Array }
  lighting?: { litKey: string; pixels: Uint8Array; row: number; grades: GradeTable; glows?: GradeTable }
  spare?: Uint8Array
}

/**
 * A picture's scenery in pixels, by its size and scheme: the leg's land shown
 * and the next one's drawn ahead (no other), and the sky and still land, and
 * all that is behind the mascots, as last composed, each by its key.
 */
type Picture = { current?: Strip; next?: Strip; still?: { key: string; pixels: Uint8Array }; behind?: { key: string; pixels: Uint8Array } }

/** The pictures drawn lately: the band's and a pane's, and a size or two a pane has just been. */
const pictures = new Map<string, Picture>()
const MOST_PICTURES = 4

const pictureOf = (width: number, height: number, scheme: 'dark' | 'light'): Picture => {
  const key = `${width}x${height}:${scheme}`
  const picture = pictures.get(key) ?? {}
  pictures.delete(key)
  pictures.set(key, picture)
  for (const old of pictures.keys()) if (pictures.size > MOST_PICTURES) pictures.delete(old)

  return picture
}

/** A strip for `land` in a picture `width` by `height` pixels, nothing yet drawn in it. */
const stripOf = (land: Land, width: number, height: number, cell: Cell, scheme: 'dark' | 'light'): Strip => ({
  land,
  across: Math.max(width, Math.round((land.span * cell.width) / 2)),
  height,
  view: scale(cell.width / 2, cell.height / 4),
  scheme,
  drawn: 0,
})

/** `land`'s strip in `picture`: the one shown, the one drawn ahead (now shown, the last let go), or a new one. */
const shownStrip = (picture: Picture, land: Land, width: number, height: number, cell: Cell, scheme: 'dark' | 'light'): Strip => {
  if (picture.current?.land.key !== land.key) {
    picture.current = picture.next?.land.key === land.key ? picture.next : stripOf(land, width, height, cell, scheme)
    if (picture.next === picture.current) picture.next = undefined
  }
  picture.current.land = land

  return picture.current
}

/**
 * The next piece of a strip's work, done: a band of the still land and its
 * lights drawn, else a band lit for the light last asked for (once lit for
 * another, or never). False when there is none left.
 */
const workOn = (strip: Strip): boolean => {
  const { across, height, view, scheme } = strip
  const size = across * height * 4
  if (strip.drawn < height) {
    strip.still ??= new Uint8Array(size)
    strip.lights ??= new Uint8Array(size)
    strip.rows ??= { still: strip.land.still.map(shape => rowsOf(shape, view)), lights: strip.land.lights.map(shape => rowsOf(shape, view)) }
    const [from, to] = [strip.drawn, Math.min(height, strip.drawn + BAND)]
    const band = (shapes: readonly Shape[], rows: readonly [number, number][], pixels: Uint8Array): void => {
      const reaching = shapes.filter((_, i) => (rows[i]?.[1] ?? Infinity) >= from && (rows[i]?.[0] ?? -Infinity) < to)
      if (reaching.length > 0) rasterOf(reaching, across, to - from, chain(translate(0, -from), view), glyphShapes, scheme, pixels.subarray(from * across * 4, to * across * 4))
    }
    band(strip.land.still, strip.rows.still, strip.still)
    band(strip.land.lights, strip.rows.lights, strip.lights)
    strip.drawn = to

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

/** The strips' work on, the pictures drawn last first, each's shown land before the next, until the clock says `until` (ms, `clockMs`). */
export const workScenery = (until: number): void => {
  for (const picture of [...pictures.values()].reverse()) {
    for (const strip of [picture.current, picture.next]) {
      while (strip !== undefined && (clockMs() ?? Infinity) < until) if (!workOn(strip)) break
    }
  }
}

/** The leg after this one's land drawn ahead, a band at a time, and lit for the light as that leg begins: to stand in till it is lit for its own. */
export const prefetchScenery = (next: Scenery, columns: number, rows: number, cell: Cell, scheme: 'dark' | 'light'): void => {
  const width = Math.max(1, Math.floor(columns)) * cell.width
  const height = Math.max(1, Math.floor(rows)) * cell.height
  const picture = pictureOf(width, height, scheme)
  if (picture.current?.land.key === next.land.key || picture.next?.land.key === next.land.key) return
  picture.next = stripOf(next.land, width, height, cell, scheme)
}

/**
 * What is behind the mascots in a picture `width` by `height` pixels: the
 * sky painted a row at a time, its sun, moon, stars and clouds, the still
 * land lit for the hour (or, while that is lit, as last lit) from where the
 * pan has got to, then what moves on it, the stop's name and the weather. Each layer kept by
 * its key and the light the land was lit for: drawn again only as either
 * changes.
 */
export const behindPixels = (scenery: Scenery, width: number, height: number, cell: Cell, scheme: 'dark' | 'light'): Uint8Array => {
  const picture = pictureOf(width, height, scheme)
  const strip = shownStrip(picture, scenery.land, width, height, cell, scheme)
  // Never yet lit: its work all done now.
  if (strip.lit === undefined) while (workOn(strip));
  const lit = strip.lit
  const behindKey = `${scenery.behind}:${lit?.litKey}`
  if (picture.behind?.key === behindKey) return picture.behind.pixels
  const stillKey = `${scenery.still}:${lit?.litKey}`
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
  const pixels = rasterOf([...scenery.land.moving, ...scenery.land.caption, ...scenery.weather], width, height, view, glyphShapes, scheme, picture.still.pixels.slice())
  picture.behind = { key: behindKey, pixels }

  return pixels
}
