import { blankGrid, drawLook } from './mascot-glyphs'
import type { Look } from './mascot-poses'
import { ACCESSORIES, CROWN, FLYING_CAP, HAT_X } from './mascot-sprites'
import type { Accessory } from './mascot-sprites'
import { ACCENT } from './scene-model'
import type { Grid, MascotAgent } from './scene-types'
import { dressOfAgent, usagiFigure } from './usagi-glyphs'
import type { Dress } from './usagi-glyphs'
import { CAP, FIGURE_W, HATS, SIDE_CROWN, USAGI, cellsOf } from './usagi-sprites'
import type { HatName, Palette } from './usagi-sprites'

// The pressed mascot as the TV (hooks/tv-model.ts): the scene's own sprite,
// which flies to the pane's centre; the sprite blown up as it grows; and the
// giant, whose body is the TV's casing, the glass and the panel set in it,
// its eyes over the glass and its arms, legs and what it wears around it.
// Every one is a bitmap of quarters (two a cell across, two down), as
// Usagi's figure is (hooks/usagi-sprites.ts): the terminal draws it as
// quadrant glyphs (`cellsOf`), the desktop as the same quarters in pixels.

/** Who is in the TV: its character, its colour, and what it wears (Clawd an accessory or the crown; Usagi its role's hat or the crown); pressed in flight, its propeller cap in its hat's place. */
export type Who = {
  character: 'clawd' | 'usagi'
  colour: string
  accessory?: Accessory
  side?: 'left' | 'right'
  hat?: HatName
  crown?: true
  cap?: true
}

/** A bitmap of quarters (`.` none) and the colour each key is drawn in; `#` is the body. */
export type Figure = { bitmap: string[]; palette: Palette }

/** A rectangle in cells: its left column, top row, width and height. */
export type Box = { x: number; y: number; w: number; h: number }

/** How the giant looks this frame: eyes open, wide (scared) or shut (a blink). */
export type Eyes = 'open' | 'wide' | 'shut'

/** The giant's frame: its box in cells, where its body stands in it, and the TV on its forehead (its glass and its panel). */
export type Shape = { width: number; height: number; body: Box; tv: Box }

/** The eyes' ink, the cheeks' and the mouth's: dark on any body colour. */
const EYE = '#1E1E1E'

/** The session's own: its crown, Clawd in the accent colour. */
export const whoOfMain = (character: 'clawd' | 'usagi'): Who =>
  character === 'usagi' ? { character, colour: USAGI.body, crown: true } : { character, colour: ACCENT, crown: true }

/** An agent: its colour and accessory (Clawd), or its role's hat (Usagi). */
export const whoOfAgent = (agent: MascotAgent, character: 'clawd' | 'usagi'): Who => {
  if (character === 'usagi') {
    const dress = dressOfAgent(agent)

    return { character, colour: USAGI.body, ...(dress.hat === undefined ? {} : { hat: dress.hat }) }
  }

  return { character, colour: agent.colour, ...(agent.accessory === undefined ? {} : { accessory: agent.accessory }), ...(agent.side === undefined ? {} : { side: agent.side }) }
}

// --- quarters ------------------------------------------------------------------

/** A quadrant glyph's quarters: top-left 1, top-right 2, bottom-left 4, bottom-right 8. */
const MASKS: Readonly<Record<string, number>> = { '▘': 1, '▝': 2, '▀': 3, '▖': 4, '▌': 5, '▞': 6, '▛': 7, '▗': 8, '▚': 9, '▐': 10, '▜': 11, '▄': 12, '▙': 13, '▟': 14, '█': 15 }

const blank = (width: number, height: number): string[][] => Array.from({ length: height }, () => Array.from({ length: width }, () => '.'))

/** Keys for raw colours past the body's: one letter each, in the order met. */
const KEYS = 'abcdefghijlnoqrstuvwxyz'

/**
 * A grid of cells as quarters: each quadrant glyph's quarters in its colour
 * (its background in the rest, for a cell of two colours); anything else (a
 * letter, a star, a flower) is left out: the giant wears its own.
 */
export const quartersOf = (grid: Grid, body: string): Figure => {
  const rows = blank(Math.max(0, ...grid.map(row => row.length)) * 2, grid.length * 2)
  const palette: Record<string, string> = { '#': body }
  const keyOf = (colour: string): string => {
    if (colour === body) return '#'
    const found = Object.entries(palette).find(([, one]) => one === colour)?.[0]
    if (found !== undefined) return found
    const key = KEYS[Object.keys(palette).length - 1] ?? 'z'
    palette[key] = colour

    return key
  }
  grid.forEach((row, y) => row.forEach((cell, x) => {
    const mask = cell === undefined ? undefined : MASKS[cell.ch]
    if (cell === undefined || mask === undefined) return
    const ink = keyOf(cell.colour)
    const ground = cell.bg === undefined ? undefined : keyOf(cell.bg)
    for (let bit = 0; bit < 4; bit += 1) {
      const key = (mask & (1 << bit)) !== 0 ? ink : ground
      const line = rows[y * 2 + (bit >> 1)]
      if (key !== undefined && line !== undefined) line[x * 2 + (bit & 1)] = key
    }
  }))

  return { bitmap: rows.map(row => row.join('')), palette }
}

/** A figure's quarters from (x, y), `width` by `height`. */
export const cropped = (figure: Figure, x: number, y: number, width: number, height: number): Figure => ({
  bitmap: Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, column) => figure.bitmap[y + row]?.[x + column] ?? '.').join('')),
  palette: figure.palette,
})

/** The quarters drawn, as the smallest box around them (in quarters). */
export const extentOf = (figure: Figure): { x: number; y: number; w: number; h: number } | undefined => {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -1
  let y1 = -1
  figure.bitmap.forEach((row, y) => [...row].forEach((key, x) => {
    if (key === '.') return
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }))

  return x1 < 0 ? undefined : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** A figure blown up (or down) to `width` by `height` quarters, nearest quarter. */
export const scaled = (figure: Figure, width: number, height: number): Figure => {
  const from = figure.bitmap
  const fromH = from.length
  const fromW = Math.max(0, ...from.map(row => row.length))
  if (fromW === 0 || fromH === 0 || width <= 0 || height <= 0) return { bitmap: [], palette: figure.palette }

  return {
    bitmap: Array.from({ length: height }, (_, y) => {
      const line = from[Math.min(fromH - 1, Math.floor(((y + 0.5) * fromH) / height))] ?? ''

      return Array.from({ length: width }, (_, x) => line[Math.min(fromW - 1, Math.floor(((x + 0.5) * fromW) / width))] ?? '.').join('')
    }),
    palette: figure.palette,
  }
}

/** A figure as the terminal's cells: quadrant glyphs, each cell in one colour or a glyph on another. */
export const figureCells = (figure: Figure): Grid => (figure.bitmap.length === 0 ? blankGrid(0, 0) : cellsOf(figure.bitmap, figure.palette))

// --- the sprite ------------------------------------------------------------------

const STANDING: Look = { head: 'open', arms: 'rest', legs: 'stand', pose: 'stand', overlays: [], lift: 0 }

/** The sprite's quarters to the scene's one: fine enough for what Clawd wears to grow with it, a flower as a flower. */
export const SPRITE_RES = 8

/** A figure blown up `times`, each quarter `times` by `times`. */
const blownUp = (figure: Figure, times: number): Figure => ({
  bitmap: figure.bitmap.flatMap(row => {
    const line = [...row].map(key => key.repeat(times)).join('')

    return Array.from({ length: times }, () => line)
  }),
  palette: figure.palette,
})

/**
 * The mascot as the scene draws it standing, eyes wide (it knows where it is
 * going), at SPRITE_RES: its figure (its holes filled), and what it wears
 * blown up with it from the scene's three cells over its head (Clawd's, laid
 * after, so a flower's or a bow's middle stays clear as the scene's glyph's
 * does; Usagi's hat or crown is in its figure), cut to the cells drawn. What
 * flies to the centre and grows.
 */
export const spriteOf = (who: Who, eyes: Eyes = 'wide'): Figure => {
  const look: Look = { ...STANDING, head: eyes === 'shut' ? 'shut' : eyes === 'wide' ? 'wide' : 'open' }
  let figure: Figure
  if (who.character === 'usagi') {
    const dress: Dress = { ...(who.hat === undefined ? {} : { hat: who.hat }), ...(who.crown === true ? { crown: true as const } : {}), energy: 0 }
    // In flight its figure wears the cap (its hat off); the blade turns in the sky row over its middle. Its eyes are its own quarters, no holes to fill (the gap under a cap is the sky's).
    const sky = who.cap === true ? ['.'.repeat(FIGURE_W), '.'.repeat(FIGURE_W)] : []
    const own = usagiFigure(who.cap === true ? { ...look, cap: 0 } : look, dress)
    figure = blownUp({ ...own, bitmap: [...sky, ...own.bitmap] }, SPRITE_RES)
    if (who.cap === true) {
      const canvas: Canvas = { rows: figure.bitmap.map(row => [...row]), palette: { ...figure.palette } }
      lay(canvas, sampled(BLADES[0] as Stencil, { x: 8, y: 0, w: 8, h: 16 }, 2 * SPRITE_RES, 2 * SPRITE_RES), { W: capOf(who) }, 8 * SPRITE_RES, 0)
      figure = figureOf(canvas)
    }
  } else {
    // The box's four rows, with the sky row over them for a propeller's blade (the first of the grid's five); its wear laid after, as the giant's is.
    const worn = wornBy(who)
    figure = holesFilled(blownUp(quartersOf(drawLook(look, { energy: 0 }, who.colour, 0).slice(worn?.rows === 2 ? 0 : 1), who.colour), SPRITE_RES))
    if (worn !== undefined) {
      const canvas: Canvas = { rows: figure.bitmap.map(row => [...row]), palette: { ...figure.palette } }
      lay(canvas, wornAt(worn.stencil, SPRITE_RES, worn.rows), { W: worn.colour }, HAT_X[worn.side] * 2 * SPRITE_RES, 0)
      figure = figureOf(canvas)
    }
  }
  const extent = extentOf(figure)
  if (extent === undefined) return figure
  // Cut on the scene's quarters, so it is drawn at its own size as the scene draws it.
  const x = Math.floor(extent.x / SPRITE_RES) * SPRITE_RES
  const y = Math.floor(extent.y / SPRITE_RES) * SPRITE_RES

  return cropped(figure, x, y, Math.ceil((extent.x + extent.w) / SPRITE_RES) * SPRITE_RES - x, Math.ceil((extent.y + extent.h) / SPRITE_RES) * SPRITE_RES - y)
}

/**
 * A figure's holes (quarters no way out from, as Clawd's eyes are notches in
 * its head) filled dark: blown up over the pane, a hole would show the pane's
 * text through it.
 */
export const holesFilled = (figure: Figure): Figure => {
  const rows = figure.bitmap.map(row => [...row])
  const height = rows.length
  const width = Math.max(0, ...rows.map(row => row.length))
  const outside = new Set<number>()
  const queue: [number, number][] = []
  const visit = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height || outside.has(y * width + x) || (rows[y]?.[x] ?? '.') !== '.') return
    outside.add(y * width + x)
    queue.push([x, y])
  }
  for (let x = 0; x < width; x += 1) {
    visit(x, 0)
    visit(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    visit(0, y)
    visit(width - 1, y)
  }
  while (queue.length > 0) {
    const [x, y] = queue.pop() as [number, number]
    visit(x + 1, y)
    visit(x - 1, y)
    visit(x, y + 1)
    visit(x, y - 1)
  }
  let filled = false
  rows.forEach((row, y) => row.forEach((key, x) => {
    if (key === '.' && x < width && !outside.has(y * width + x)) {
      row[x] = 'K'
      filled = true
    }
  }))

  return filled ? { bitmap: rows.map(row => row.join('')), palette: { ...figure.palette, K: figure.palette.K ?? EYE } } : figure
}

// --- the giant ---------------------------------------------------------------------

/** Quarters rounded to a cell's edge, so each part fills whole cells where it can. */
const even = (value: number): number => 2 * Math.round(value / 2)

type Canvas = { rows: string[][]; palette: Record<string, string> }

const fill = (canvas: Canvas, x: number, y: number, w: number, h: number, key: string): void => {
  for (let row = Math.max(0, y); row < y + h; row += 1) {
    const line = canvas.rows[row]
    if (line === undefined) continue
    for (let column = Math.max(0, x); column < x + w && column < line.length; column += 1) line[column] = key
  }
}

/** Art laid with its top-left at (x, y): its `.` let what is under show, its keys mapped into the canvas's palette. */
const lay = (canvas: Canvas, art: readonly string[], palette: Palette, x: number, y: number): void => {
  art.forEach((line, row) => [...line].forEach((key, column) => {
    if (key === '.' || palette[key] === undefined) return
    const target = canvas.rows[y + row]
    if (target === undefined || x + column < 0 || x + column >= target.length) return
    const mine = `${key}${key}`
    // A key of the art's own, kept apart from the canvas's (`#`, K, P, M).
    const local = Object.entries(canvas.palette).find(([, colour]) => colour === palette[key])?.[0] ?? mine
    if (canvas.palette[local] === undefined) canvas.palette[local] = palette[key] as string
    target[x + column] = local
  }))
}

/** A canvas's rows as a figure; keys longer than one quarter are given one letter each. */
const figureOf = (canvas: Canvas): Figure => {
  const rename = new Map<string, string>()
  const palette: Record<string, string> = {}
  const free = [...'abcdefghijlnoqrstuvwxyz']
  for (const key of Object.keys(canvas.palette)) {
    const one = key.length === 1 ? key : free.find(letter => canvas.palette[letter] === undefined && !rename.has(letter) && ![...rename.values()].includes(letter)) ?? 'z'
    rename.set(key, one)
    palette[one] = canvas.palette[key] as string
  }

  return { bitmap: canvas.rows.map(row => row.map(key => (key === '.' ? '.' : rename.get(key) ?? key)).join('')), palette }
}

// --- what Clawd wears, blown up ------------------------------------------------------

/** A shape over the scene's three cells above a head, in its pixels (a cell 8 across and 16 down): whether a point is in it. */
type Stencil = (x: number, y: number) => boolean

const disc = (cx: number, cy: number, r: number): Stencil => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r
const oval = (cx: number, cy: number, rx: number, ry: number): Stencil => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
const stroke = (x1: number, y1: number, x2: number, y2: number, width: number): Stencil => (x, y) => {
  const dx = x2 - x1
  const dy = y2 - y1
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))

  return Math.hypot(x - x1 - t * dx, y - y1 - t * dy) <= width / 2
}
/** An arc of a circle from one angle to another (screen angles: −π/2 straight up). */
const bend = (cx: number, cy: number, r: number, from: number, to: number, width: number): Stencil => (x, y) => {
  const angle = Math.atan2(y - cy, x - cx)

  return Math.abs(Math.hypot(x - cx, y - cy) - r) <= width / 2 && angle >= from && angle <= to
}
const any = (...parts: Stencil[]): Stencil => (x, y) => parts.some(part => part(x, y))
const but = (part: Stencil, hole: Stencil): Stencil => (x, y) => part(x, y) && !hole(x, y)
const lowered = (part: Stencil, by: number): Stencil => (x, y) => part(x, y - by)

/** Quadrant glyphs as a stencil: each glyph's quarters, 4 pixels across and 8 down. */
const blocks = (glyphs: string): Stencil => {
  const cells = [...glyphs]

  return (x, y) => {
    if (x < 0 || y < 0 || y >= 16) return false
    const mask = MASKS[cells[Math.floor(x / 8)] ?? ''] ?? 0

    return (mask & (1 << ((y >= 8 ? 2 : 0) + (x % 8 >= 4 ? 1 : 0)))) !== 0
  }
}

/** Five petals round a hole, the first straight up. */
const PETALS = [0, 1, 2, 3, 4].map(at => -Math.PI / 2 + (at * 2 * Math.PI) / 5)

/**
 * What Clawd wears over its head as the scene's three cells show it (the
 * crown and the hats' block glyphs quarter for quarter; the symbols as the
 * font draws them in the middle cell: a florette of five petals round a hole,
 * a bowtie's two bars crossed, the halo's three arcs, two notes on a beam,
 * four balloons on a cross), each in the one colour the scene draws it in.
 */
export const WEAR: Readonly<Record<Accessory | 'crown', Stencil>> = {
  crown: blocks(CROWN.art),
  beanie: blocks(ACCESSORIES.beanie.art),
  cap: blocks(ACCESSORIES.cap.art),
  tophat: blocks(ACCESSORIES.tophat.art),
  flower: but(any(...PETALS.map(angle => disc(12 + 3 * Math.cos(angle), 8.8 + 3 * Math.sin(angle), 1.5))), disc(12, 8.8, 1.1)),
  bow: any(stroke(7.2, 4.6, 7.2, 12.4, 1.3), stroke(16.8, 4.6, 16.8, 12.4, 1.3), stroke(7.2, 4.6, 16.8, 12.4, 1.3), stroke(7.2, 12.4, 16.8, 4.6, 1.3)),
  halo: any(bend(6, 9, 4, -Math.PI, -Math.PI / 2, 1.3), bend(12, 9, 3.8, -Math.PI, 0, 1.3), bend(18, 9, 4, -Math.PI / 2, 0, 1.3)),
  note: any(oval(10.2, 11.2, 1.7, 1.15), oval(13.8, 12.9, 1.7, 1.15), stroke(11.5, 3.5, 11.5, 11, 0.9), stroke(15.1, 4.9, 15.1, 12.7, 0.9), stroke(11.5, 3.7, 15.1, 5, 1.7)),
  propeller: any(disc(12, 6, 1.25), disc(9.2, 9, 1.25), disc(14.8, 9, 1.25), disc(12, 12, 1.25), stroke(12, 6, 12, 12, 0.8), stroke(9.2, 9, 14.8, 9, 0.8)),
}

/** The propeller's blade, turning a frame at a time: `+` then `x`, as the font draws them in a cell's middle (its pixels 8 to 16 across). */
export const BLADES: readonly Stencil[] = [
  any(stroke(12, 5.2, 12, 12.2, 1.3), stroke(8.6, 8.7, 15.4, 8.7, 1.3)),
  any(stroke(9.3, 5.7, 14.7, 12.3, 1.3), stroke(14.7, 5.7, 9.3, 12.3, 1.3)),
]

/** The propeller cap Clawd flies under: the scene's `▄▄▄` on the air row, its blade a row above it in the sky row (two rows: the sky's pixels 0 to 16, the air's 16 to 32). */
const CAP_WEAR: readonly Stencil[] = BLADES.map(blade => any(blade, lowered(blocks(FLYING_CAP.art), 16)))

/** The propeller cap's colour, as the scene's: its hat's, the crown's gold, or (Usagi bare-headed) its own. */
export const capOf = (who: Who): string =>
  who.character === 'usagi'
    ? who.hat !== undefined ? HATS[who.hat].colour : who.crown === true ? CROWN.colour : CAP.colour
    : who.crown === true ? CROWN.colour : who.accessory !== undefined ? ACCESSORIES[who.accessory].colour : CROWN.colour

/**
 * What Clawd wears and where: the crown centred, an accessory at the head's
 * corner it is worn at; in flight, the propeller cap in its place and colour
 * (a bare head's on the left, in the crown's gold), its blade turned `spin`
 * frames, over the sky row too. Its stencil, colour, side and rows.
 */
export const wornBy = (who: Who, spin = 0): { stencil: Stencil; colour: string; side: 'left' | 'centre' | 'right'; rows: 1 | 2 } | undefined => {
  if (who.character !== 'clawd') return undefined
  const side = who.crown === true ? 'centre' : who.accessory === undefined ? 'left' : who.side ?? 'left'
  if (who.cap === true) return { stencil: CAP_WEAR[spin % CAP_WEAR.length] as Stencil, colour: capOf(who), side, rows: 2 }
  if (who.crown === true) return { stencil: WEAR.crown, colour: CROWN.colour, side, rows: 1 }

  return who.accessory === undefined ? undefined : { stencil: WEAR[who.accessory], colour: ACCESSORIES[who.accessory].colour, side, rows: 1 }
}

/**
 * A stencil's pixels in `from` drawn as `w` by `h` quarters (`W`), each drawn
 * where a third or more of a 3 by 3 sampling of it is in the stencil, so a
 * stroke thinner than a quarter still shows.
 */
const sampled = (stencil: Stencil, from: Box, w: number, h: number): string[] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
    let inside = 0
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) if (stencil(from.x + ((x + (i + 0.5) / 3) * from.w) / w, from.y + ((y + (j + 0.5) / 3) * from.h) / h)) inside += 1

    return inside >= 3 ? 'W' : '.'
  }).join(''))

/** A stencil over the scene's three cells (and `rows` of them) drawn `k` quarters to the scene's one: 6k by 2k quarters a row. */
export const wornAt = (stencil: Stencil, k: number, rows: 1 | 2 = 1): string[] => sampled(stencil, { x: 0, y: 0, w: 24, h: 16 * rows }, 6 * k, 2 * k * rows)

/**
 * Clawd's eyes on the giant, in quarters across and down: the scene's
 * one-quarter notch is as tall as it is wide in quarters (twice as tall as
 * wide on the screen); three cells each way on a body of forty cells or more,
 * two below; scared, a quarter more all round.
 */
export const clawdEyesOf = (bodyCells: number, eyes: Eyes): { w: number; h: number } => {
  const side = bodyCells >= 40 ? 6 : 4

  return eyes === 'wide' ? { w: side + 2, h: side + 2 } : { w: side, h: side }
}

/** Usagi's eyes on the giant: round dots, two cells across and one down; scared, three across and two down. */
export const usagiEyesOf = (eyes: Eyes): { w: number; h: number } => (eyes === 'wide' ? { w: 6, h: 4 } : { w: 4, h: 2 })

/** Where each part of a face stands across its body, as a fraction of its width: Clawd's eyes, Usagi's eyes and cheeks. */
const CLAWD_EYES = [0.27, 0.73] as const
const USAGI_EYES = [0.34, 0.66] as const
const USAGI_CHEEKS = [0.2, 0.8] as const

/**
 * Clawd as the TV: its body (the casing), the TV on its forehead (`shape.tv`,
 * drawn over it), its eyes under the TV notched dark as the scene's head has
 * them, its torso (the last two rows) with its arms out of its top (their
 * tips a quarter high, as the torso's `▝` and `▘`), its four legs under it where the
 * scene's stand (at 1, 3, 8 and 10 twelfths of its width), and its crown or
 * accessory on its head: the scene's, blown up as the head is (its three
 * cells half the head's width) where the rows over the head allow, centred
 * where the scene wears it (the crown in the middle, an accessory over the
 * corner it is worn at).
 */
const giantClawd = (who: Who, shape: Shape, eyes: Eyes, spin: number): Figure => {
  const width = shape.width * 2
  const height = shape.height * 2
  const canvas: Canvas = { rows: blank(width, height), palette: { '#': who.colour, K: EYE } }
  const x0 = shape.body.x * 2
  const y0 = shape.body.y * 2
  const bw = shape.body.w * 2
  const bh = shape.body.h * 2
  fill(canvas, x0, y0, bw, bh, '#')
  // Its arms out of its torso's top, under its eyes (the body's last two rows its torso): a row thick, the tips a quarter high.
  const armY = y0 + bh - 4
  fill(canvas, 0, armY, x0, 2, '#')
  fill(canvas, x0 + bw, armY, width - x0 - bw, 2, '#')
  fill(canvas, 0, armY + 1, 1, 1, '.')
  fill(canvas, width - 1, armY + 1, 1, 1, '.')
  // Its legs, from under the body to the box's floor.
  const legW = shape.body.w >= 40 ? 4 : 2
  for (const at of [1 / 12, 3 / 12, 8 / 12, 10 / 12]) fill(canvas, x0 + even(bw * at), y0 + bh, legW, height - y0 - bh, '#')
  // Its eyes, a row under the TV (scared, wider, from that row's middle).
  if (eyes !== 'shut') {
    const eye = clawdEyesOf(shape.body.w, eyes)
    const top = (shape.tv.y + shape.tv.h + 1) * 2 - (eyes === 'wide' ? 1 : 0)
    for (const at of CLAWD_EYES) fill(canvas, even(x0 + bw * at - eye.w / 2), top, eye.w, eye.h, 'K')
  }
  // What it wears, its last row on the body's top: the scene's head is 12 quarters across, so `k` is the body's twelfth at most (and its rows, the propeller's two, fit over the head).
  const worn = wornBy(who, spin)
  if (worn !== undefined) {
    const k = Math.max(1, Math.min(Math.floor(shape.body.y / worn.rows), Math.floor(bw / 12)))
    // Centred where the scene's three cells are over its head (quarters 6, 10 or 14 of the head's 7 to 19).
    const centre = x0 + ((worn.side === 'centre' ? 13 : worn.side === 'right' ? 17 : 9) - 7) * (bw / 12)
    lay(canvas, wornAt(worn.stencil, k, worn.rows), { W: worn.colour }, Math.max(0, Math.min(width - 6 * k, Math.round(centre - 3 * k))), y0 - 2 * k * worn.rows)
  }

  return figureOf(canvas)
}

/**
 * Usagi as the TV: its round body (the casing), the TV on its forehead
 * (`shape.tv`), its ears up out of its head through its role's hat, blown up
 * from the scene's figure as its face is (the face's 14 quarters the body's
 * width; the ears and the hat's crown over the rows above the head, the
 * brim on the head's top); under the TV its face, its small dark eyes, its
 * cheeks out from them and its mouth between, as the scene's face has them;
 * its arms out at its sides by its face, and its feet; the session's wears
 * its crown in front of its left ear, as the scene's does.
 */
const giantUsagi = (who: Who, shape: Shape, eyes: Eyes, spin: number): Figure => {
  const width = shape.width * 2
  const height = shape.height * 2
  const canvas: Canvas = { rows: blank(width, height), palette: { '#': USAGI.body, K: USAGI.eye, P: USAGI.blush, M: USAGI.mouth } }
  const x0 = shape.body.x * 2
  const y0 = shape.body.y * 2
  const bw = shape.body.w * 2
  const bh = shape.body.h * 2
  // The body, its corners round.
  const radius = 4
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      const dx = x < radius ? radius - x - 0.5 : x >= bw - radius ? x - (bw - radius) + 0.5 : 0
      const dy = y < radius ? radius - y - 0.5 : y >= bh - radius ? y - (bh - radius) + 0.5 : 0
      if (dx * dx + dy * dy <= radius * radius) (canvas.rows[y0 + y] as string[])[x0 + x] = '#'
    }
  }
  // The scene's face is 14 quarters across (its columns 2 to 15): the body's width, a quarter of it `kx` across.
  const kx = bw / 14
  const across = (column: number): number => x0 + (column - 2) * kx
  // The ears (the scene's columns 4 and 5, 12 and 13), from the box's top into the head, their tips round.
  const earW = Math.max(4, even(2 * kx))
  const leftEar = even(across(4))
  const ears = [leftEar, x0 + bw - (leftEar - x0) - earW]
  for (const x of ears) {
    fill(canvas, x, 0, earW, y0 + 2, '#')
    ;[earW / 4, earW / 8, earW / 16].forEach((inset, y) => {
      fill(canvas, x, y, Math.round(inset), 1, '.')
      fill(canvas, x + earW - Math.round(inset), y, Math.round(inset), 1, '.')
    })
  }
  // The face, under the TV: the eyes a row under it, the cheeks and the mouth a row under them.
  const eyesRow = (shape.tv.y + shape.tv.h + 1) * 2
  // Its arms, out at its sides by its face, round at the ends.
  const armY = eyesRow - 2
  fill(canvas, 0, armY, x0 + 2, 4, '#')
  fill(canvas, x0 + bw - 2, armY, width - x0 - bw + 2, 4, '#')
  for (const x of [0, width - 1]) for (const y of [armY, armY + 3]) (canvas.rows[y] as string[])[x] = '.'
  if (x0 >= 4) {
    for (const y of [armY, armY + 3]) (canvas.rows[y] as string[])[1] = '.'
    for (const y of [armY, armY + 3]) (canvas.rows[y] as string[])[width - 2] = '.'
  }
  // Its feet, under the body.
  const footW = Math.max(4, even(bw / 8))
  for (const centre of [x0 + bw * 0.22, x0 + bw * 0.78]) fill(canvas, even(centre - footW / 2), y0 + bh, footW, height - y0 - bh, '#')
  if (eyes !== 'shut') {
    const eye = usagiEyesOf(eyes)
    for (const at of USAGI_EYES) fill(canvas, even(x0 + bw * at - eye.w / 2), eyesRow - (eyes === 'wide' ? 2 : 0), eye.w, eye.h, 'K')
  }
  for (const at of USAGI_CHEEKS) fill(canvas, even(x0 + bw * at - 2), eyesRow + 2, 4, 2, 'P')
  fill(canvas, even(x0 + bw / 2 - 2), eyesRow + 2, 4, 2, 'M')
  // What it wears, blown up from the scene's figure as the ears are: the art's four rows (the ears' three and the head's top) over the ears from their tips to the head's top, so the brim is as thick as the rest and the ears come up through it.
  const wear = (art: readonly string[], palette: Palette, from: number, shift = 0): void => {
    for (let y = 0; y < y0 + 2; y += 1) {
      const line = art[Math.floor((y * 4) / (y0 + 2)) - from] ?? ''
      for (let x = 0; x < width; x += 1) {
        const key = line[Math.floor(2 + (x - shift + 0.5 - x0) / kx)]
        if (key !== undefined && key !== '.' && palette[key] !== undefined) lay(canvas, [key], palette, x, y)
      }
    }
  }
  if (who.cap === true) {
    // In flight: its hat off, the propeller cap between its ears (the scene's row 1), its blade turning over it in the row above.
    wear(CAP.art, { C: capOf(who) }, 1)
    const band = Math.max(1, Math.floor((y0 + 2) / 4))
    const left = Math.round(across(8))
    lay(canvas, sampled(BLADES[spin % BLADES.length] as Stencil, { x: 8, y: 4, w: 8, h: 9 }, Math.max(1, Math.round(across(10)) - left), band), { W: capOf(who) }, left, 0)
  } else if (who.hat !== undefined) wear(HATS[who.hat].art, HATS[who.hat].palette, 0)
  // The session's crown (the scene's columns 0 to 4 on rows 2 and 3, its band on the head's top), in front of its left ear, moved in to stay within the figure.
  if (who.crown === true) wear(SIDE_CROWN.art, SIDE_CROWN.palette, 2, Math.max(0, -Math.round(across(0))))

  return figureOf(canvas)
}

/** The giant for a frame: Clawd's or Usagi's, eyes as asked, a propeller's blade turned `spin` frames. */
export const giantOf = (who: Who, shape: Shape, eyes: Eyes = 'open', spin = 0): Figure =>
  who.character === 'usagi' ? giantUsagi(who, shape, eyes, spin) : giantClawd(who, shape, eyes, spin)
