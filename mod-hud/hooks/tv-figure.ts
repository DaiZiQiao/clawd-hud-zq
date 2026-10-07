import { blankGrid, drawLook, wearOfAgent, wearOfMain } from './mascot-glyphs'
import type { Look } from './mascot-poses'
import { ACCESSORIES, CROWN } from './mascot-sprites'
import type { Accessory } from './mascot-sprites'
import { ACCENT } from './scene-model'
import type { Grid, MascotAgent } from './scene-types'
import { dressOfAgent, usagiFigure } from './usagi-glyphs'
import type { Dress } from './usagi-glyphs'
import { HATS, SIDE_CROWN, USAGI, cellsOf } from './usagi-sprites'
import type { HatName, Palette } from './usagi-sprites'

// The pressed mascot as the TV (hooks/tv-model.ts): the scene's own sprite,
// which flies to the pane's centre; the sprite blown up as it grows; and the
// giant, whose body is the TV's casing, the glass and the panel set in it,
// its eyes over the glass and its arms, legs and what it wears around it.
// Every one is a bitmap of quarters (two a cell across, two down), as
// Usagi's figure is (hooks/usagi-sprites.ts): the terminal draws it as
// quadrant glyphs (`cellsOf`), the desktop as the same quarters in pixels.

/** Who is in the TV: its character, its colour, and what it wears (Clawd an accessory or the crown; Usagi its role's hat or the crown). */
export type Who = {
  character: 'clawd' | 'usagi'
  colour: string
  accessory?: Accessory
  side?: 'left' | 'right'
  hat?: HatName
  crown?: true
}

/** A bitmap of quarters (`.` none) and the colour each key is drawn in; `#` is the body. */
export type Figure = { bitmap: string[]; palette: Palette }

/** A rectangle in cells: its left column, top row, width and height. */
export type Box = { x: number; y: number; w: number; h: number }

/** How the giant looks this frame: eyes open, wide (scared) or shut (a blink). */
export type Eyes = 'open' | 'wide' | 'shut'

/** The giant's frame: its box in cells, where its body stands in it, and the TV on its forehead (its glass and both panels). */
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

/**
 * The mascot as the scene draws it standing, eyes wide (it knows where it is
 * going): its figure and what it wears, cut to the quarters drawn. What flies
 * to the centre and grows.
 */
export const spriteOf = (who: Who, eyes: Eyes = 'wide'): Figure => {
  const look: Look = { ...STANDING, head: eyes === 'shut' ? 'shut' : eyes === 'wide' ? 'wide' : 'open' }
  let figure: Figure
  if (who.character === 'usagi') {
    const dress: Dress = { ...(who.hat === undefined ? {} : { hat: who.hat }), ...(who.crown === true ? { crown: true as const } : {}), energy: 0 }
    figure = usagiFigure(look, dress)
  } else {
    const wear = who.crown === true
      ? wearOfMain({ mood: 'watching', sweating: false })
      : wearOfAgent({ id: '', colour: who.colour, activity: 'thinking', status: 'running', ...(who.accessory === undefined ? {} : { accessory: who.accessory }), ...(who.side === undefined ? {} : { side: who.side }) })
    // The box's four rows (the sky row is the first of the grid's five).
    figure = quartersOf(drawLook(look, { ...wear, energy: 0 }, who.colour, 0).slice(1), who.colour)
  }
  const extent = extentOf(figure)

  return holesFilled(extent === undefined ? figure : cropped(figure, extent.x, extent.y, extent.w, extent.h))
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

/**
 * Clawd's accessories and crown at the giant's size, as quarters: what the
 * scene's three cells (or one glyph) stand for, drawn big enough to read over
 * a head of sixty cells. Each sits on the head (its last row on the body's
 * top), Clawd's crown centred, an accessory over the corner it is worn at.
 */
export const GIANT_WEAR: Readonly<Record<Accessory | 'crown', { art: readonly string[]; palette: Palette }>> = {
  crown: {
    art: ['##........RR........##', '###......####......###', '####....######....####', '######################', '######################'],
    palette: { '#': CROWN.colour, R: '#D05454' },
  },
  beanie: {
    art: ['......####......', '.....######.....', '...##########...', '.##############.', '################', 'DDDDDDDDDDDDDDDD'],
    palette: { '#': ACCESSORIES.beanie.colour, D: '#A33E3E' },
  },
  cap: {
    art: ['....########........', '..############......', '.##############.....', '####################'],
    palette: { '#': ACCESSORIES.cap.colour },
  },
  tophat: {
    art: ['...##########...', '...##########...', '...##########...', '...RRRRRRRRRR...', '################'],
    palette: { '#': ACCESSORIES.tophat.colour, R: '#D05454' },
  },
  flower: {
    art: ['.....####.....', '.##..####..##.', '.####.YY.####.', '..###YYYY###..', '.####.YY.####.', '.##..####..##.'],
    palette: { '#': ACCESSORIES.flower.colour, Y: '#FFE27A' },
  },
  bow: {
    art: ['##..........##', '####......####', '######NN######', '######NN######', '####......####', '##..........##'],
    palette: { '#': ACCESSORIES.bow.colour, N: '#8A3A2E' },
  },
  halo: {
    art: ['....########....', '.###........###.', '.###........###.', '....########....'],
    palette: { '#': ACCESSORIES.halo.colour },
  },
  note: {
    art: ['....##########', '....##......##', '....##......##', '....##......##', '..####....####', '..####....####'],
    palette: { '#': ACCESSORIES.note.colour },
  },
  propeller: {
    art: ['######..######', '......##......', '.....####.....', '...########...', '.############.', '##############'],
    palette: { '#': ACCESSORIES.propeller.colour },
  },
}

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
 * accessory on its head.
 */
const giantClawd = (who: Who, shape: Shape, eyes: Eyes): Figure => {
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
  // What it wears, its last row on the body's top.
  const worn = who.crown === true ? GIANT_WEAR.crown : who.accessory === undefined ? undefined : GIANT_WEAR[who.accessory]
  if (worn !== undefined) {
    const artW = Math.max(0, ...worn.art.map(line => line.length))
    const centre = who.crown === true ? x0 + bw / 2 : who.side === 'right' ? x0 + bw * 0.8 : x0 + bw * 0.2
    const flip = who.accessory === 'cap' && who.side !== 'right'
    const art = flip ? worn.art.map(line => [...line].reverse().join('')) : worn.art
    lay(canvas, art, worn.palette, even(centre - artW / 2), y0 - worn.art.length)
  }

  return figureOf(canvas)
}

/**
 * Usagi as the TV: its round body (the casing), the TV on its forehead
 * (`shape.tv`), its ears up out of its head through its role's hat (the
 * scene's hat, its quarters blown up over the ears and the head's top); under
 * the TV its face, its small dark eyes, its cheeks out from them and its
 * mouth between, as the scene's face has them; its arms out at its sides by
 * its face, and its feet; the session's wears its crown over its left ear.
 */
const giantUsagi = (who: Who, shape: Shape, eyes: Eyes): Figure => {
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
  // The ears, from the box's top into the head, their tips round.
  const earW = Math.max(4, Math.min(12, even(bw / 9)))
  const ears = [x0 + bw / 6, x0 + (bw * 5) / 6].map(centre => even(centre - earW / 2))
  for (const x of ears) {
    fill(canvas, x, 0, earW, y0 + 2, '#')
    ;(canvas.rows[0] as string[])[x] = '.'
    ;(canvas.rows[0] as string[])[x + earW - 1] = '.'
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
  // Its hat, blown up from the scene's: the head's top (the art's last row) on its top, the rest over its ears.
  if (who.hat !== undefined) {
    const hat = HATS[who.hat]
    for (let y = 0; y < y0 + 2; y += 1) {
      const artY = y >= y0 ? 3 : Math.floor((y * 3) / y0)
      const line = hat.art[artY] ?? ''
      for (let x = 0; x < width; x += 1) {
        const artX = Math.floor(3 + ((x - x0 + 0.5) * 12) / bw)
        const key = line[artX]
        if (key === undefined || key === '.' || hat.palette[key as keyof typeof hat.palette] === undefined) continue
        lay(canvas, [key], hat.palette, x, y)
      }
    }
  }
  if (who.crown === true) {
    const art = SIDE_CROWN.art.flatMap(line => [line, line]).map(line => [...line].flatMap(key => [key, key, key]).join(''))
    const artW = art[0]?.length ?? 0
    lay(canvas, art, SIDE_CROWN.palette, even((ears[0] ?? x0) + earW / 2 - artW / 2), y0 + 2 - art.length)
  }

  return figureOf(canvas)
}

/** The giant for a frame: Clawd's or Usagi's, eyes as asked. */
export const giantOf = (who: Who, shape: Shape, eyes: Eyes = 'open'): Figure =>
  who.character === 'usagi' ? giantUsagi(who, shape, eyes) : giantClawd(who, shape, eyes)
