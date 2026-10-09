import { blankGrid, layBeside } from './mascot-glyphs'
import type { Put } from './mascot-glyphs'
import { at } from './mascot-poses'
import type { Look, MiniLook } from './mascot-poses'
import { BODY_WIDTH, BODY_X, BOX, BOX_ROWS, CROWN, ENERGY_MARKS, ENERGY_X, FLYING_CAP, GRID_ROWS, MINI, MINI_OVERLAYS, OVERLAYS, SKY, SLOT, THOUGHT_FRAMES } from './mascot-sprites'
import type { Overlay } from './mascot-sprites'
import type { Cell, Energy, Grid, MascotAgent, MascotMain } from './scene-types'
import {
  ARMS,
  BASE,
  BODY_PALETTE,
  CAP,
  CHEEKS,
  CROSS as USAGI_CROSS,
  DAZED,
  DROOP_TOP,
  EARS,
  EYES,
  FACE,
  FEET,
  FIGURE_H,
  FIGURE_W,
  FLAT,
  HATS,
  MINI_BODY,
  MINI_EARS,
  MINI_EYES,
  MINI_FEET,
  MINI_HEAD,
  MINI_SAT,
  MINI_W,
  MOUTHS,
  QUILT,
  QUILT_PALETTE,
  ROLE_HATS,
  SEAT,
  SHOUTS,
  SIDE_CROWN,
  STARTLED,
  TOP,
  USAGI,
  USAGI_THOUGHT_FRAMES,
  cellsOf,
  laid,
  marked,
} from './usagi-sprites'
import type { Ears, HatName, Palette } from './usagi-sprites'

// Usagi drawn into cells from a look (hooks/mascot-poses.ts), as
// hooks/mascot-glyphs.ts draws Clawd: its figure's quarters from its parts
// (hooks/usagi-sprites.ts), its hat or crown over them, turned into cells;
// then what is beside it and its laptop as Clawd's, its thoughts its shouts.
// Its head never goes lower: sitting, it squats, ears short, a wide seat.

/** What Usagi wears: an agent its role's hat, the session's own the crown; its energy. */
export type Dress = { hat?: HatName; crown?: true; energy: Energy }

export const dressOfAgent = (agent: MascotAgent): Dress => ({ ...(agent.role === undefined ? {} : { hat: ROLE_HATS[agent.role] }), energy: agent.energy ?? 0 })

export const dressOfMain = (main: MascotMain): Dress => ({ crown: true, energy: main.energy ?? 0 })

/** Clawd's overlays drawn Usagi's way: its thought frames with its shouts in the bubble, the cross over its head. */
const SWAPS: ReadonlyMap<Overlay, Overlay> = new Map([
  ...THOUGHT_FRAMES.flatMap((frames, phrase) => frames.map((frame, step): [Overlay, Overlay] => [frame, USAGI_THOUGHT_FRAMES[phrase]?.[step] ?? frame])),
  ...OVERLAYS.cross.map((one): [Overlay, Overlay] => [one, USAGI_CROSS]),
  ...OVERLAYS.startle.map((one): [Overlay, Overlay] => [one, STARTLED]),
])
const CIGARETTE: ReadonlySet<Overlay> = new Set(OVERLAYS.cigarette)
const SMOKE: ReadonlySet<Overlay> = new Set(OVERLAYS.smoke)
const CROSS: ReadonlySet<Overlay> = new Set(OVERLAYS.cross)

const blankRow = (width: number): string => '.'.repeat(width)

/** Its overlays as Usagi's: its shouts for Clawd's thoughts, its cross; no cigarette, a shout on each puff; dazed, getting up after a fall. */
const besideOf = (look: Look, shout: Overlay | undefined): Overlay[] => [
  ...look.overlays.filter(one => !CIGARETTE.has(one) && !SMOKE.has(one)).map(one => SWAPS.get(one) ?? one),
  ...(shout === undefined ? [] : [shout]),
  ...(look.pose === 'crouch' ? [DAZED] : []),
]

/** On a puff of the cigarette's idle bit, that puff's shout (`Ura!`, `HUHHH?`, `UNA!`): Usagi throws its hands up instead of smoking. */
const shoutOf = (look: Look): Overlay | undefined => {
  if (!look.overlays.some(one => CIGARETTE.has(one))) return undefined
  const puff = look.overlays.find(one => SMOKE.has(one) && one.art.some(row => row.trim() !== ''))

  return puff === undefined ? undefined : SHOUTS[Math.floor(OVERLAYS.smoke.indexOf(puff) / 2)]
}

/** Usagi's strides as a cartoon's run: four feet in a flurry, shifted each frame, where Clawd takes a step. */
const RUN_FEET: Partial<Record<Look['legs'], readonly number[]>> = { step: [4, 7, 10, 13], pass: [5, 7, 10, 12], back: [4, 8, 9, 13] }

/** Its ears for a look: through its hat's brim they stand; else lowered squatting or asleep, trailing a walk, drooping slumped (bare). */
const earsOf = (look: Look, hatted: boolean, crowned: boolean): Ears => {
  if (hatted) return 'up'
  const squat = look.pose === 'sit' || look.pose === 'crouch' || look.pose === 'squash'
  if (squat) return !crowned && look.pose === 'sit' && look.overlays.some(one => CROSS.has(one)) ? 'droop' : 'short'
  if (look.pose === 'blanket') return 'short'
  if (look.lean !== undefined) return look.lean === 1 ? 'trailLeft' : 'trailRight'

  return 'up'
}

/** Its mouth's columns: none asleep or looking down, wide open shouting or arms up, else turned with its eyes. */
const mouthOf = (look: Look, shouting: boolean): readonly number[] => {
  if (look.pose === 'blanket' || look.head === 'down') return []
  const wide = shouting || (look.armsUp === true && look.pose === 'stand')
  // Eyes wide or crossed: a small round mouth, between them.
  if (look.head === 'wide' || look.head === 'spiral') return MOUTHS.open
  if (look.head === 'left') return wide ? MOUTHS.wideLeft : MOUTHS.left
  if (look.head === 'right') return wide ? MOUTHS.wideRight : MOUTHS.right
  if (wide) return MOUTHS.wide

  return MOUTHS.open
}

/** Its face's two rows: the eyes (row 4, or 5 looking down), the cheeks and the mouth (row 5). */
const faceOf = (look: Look, shouting: boolean): [string, string] => {
  // Half lidded (bored, drowsy, unimpressed): its eyes low, as looking down.
  const head = look.lids !== undefined ? 'down' : look.head
  const eyes = EYES[head]
  const low = head === 'down'
  const cheeks = marked(marked(FACE, CHEEKS, 'P'), mouthOf(look, shouting), 'M')

  return [low ? FACE : marked(FACE, eyes, 'K'), low ? marked(cheeks, eyes, 'K') : cheeks]
}

/** The figure's quarters for a look, its hat or crown on, with the palette they are drawn in. */
export const usagiFigure = (look: Look, dress: Dress): { bitmap: string[]; palette: Palette } => {
  const shouting = shoutOf(look) !== undefined
  const capped = look.cap !== undefined
  const hat = look.hatOff === true || capped ? undefined : dress.hat === undefined ? undefined : HATS[dress.hat]
  const ears = EARS[earsOf(look, hat !== undefined, dress.crown === true)]
  const [eyes, cheeks] = faceOf(look, shouting)
  let rows: string[]
  switch (look.pose) {
    case 'flat':
      // Knocked flat: ears out either side, eyes up from the floor.
      rows = [...Array.from({ length: 5 }, () => blankRow(FIGURE_W)), FLAT[0], marked(FLAT[1], EYES[look.head], 'K'), marked(marked(FLAT[2], CHEEKS, 'P'), MOUTHS.open, 'M')]
      break
    case 'blanket':
      rows = laid([...ears, TOP, eyes, cheeks, blankRow(FIGURE_W), blankRow(FIGURE_W)], QUILT[look.breath ?? 0] ?? QUILT[0], 0, 6)
      break
    case 'sit':
    case 'crouch':
    case 'squash': {
      // Squatting: the seat wide; crouched, hands on the floor; squashed, wider still.
      const seat = look.pose === 'sit' ? SEAT : look.pose === 'crouch' ? ['#.##############.#', '##################'] : ['.################.', '##################']
      rows = [...ears, ears === EARS.droop ? DROOP_TOP : TOP, eyes, cheeks, ...seat]
      break
    }
    case 'stand':
      rows = [...ears, TOP, eyes, cheeks, BASE, marked(blankRow(FIGURE_W), RUN_FEET[look.legs] ?? FEET[look.legs], '#')]
      break
  }
  const arms = look.pose === 'stand' || look.pose === 'blanket'
    ? [...(look.armsUp === true || shouting ? ARMS.up : []), ...(look.arms === 'point' ? ARMS.point : []), ...(look.arms === 'raised' ? ARMS.raised : [])]
    : []
  for (const [y, x] of arms) rows[y] = marked(rows[y] ?? blankRow(FIGURE_W), [x], '#')
  let palette: Palette = { ...BODY_PALETTE, ...QUILT_PALETTE }
  if (hat !== undefined) {
    rows = laid(rows, hat.art)
    palette = { ...palette, ...hat.palette }
  }
  if (dress.crown === true && look.hatOff !== true && look.pose !== 'flat') {
    rows = laid(rows, SIDE_CROWN.art, 2, 2)
    palette = { ...palette, ...SIDE_CROWN.palette }
  }
  if (capped) {
    rows = laid(rows, CAP.art, 0, 1)
    palette = { ...palette, C: capTone(dress) }
  }

  return { bitmap: rows.slice(0, FIGURE_H), palette }
}

/** The propeller cap's colour: its hat's, the crown's gold, or its own on a bare head. */
const capTone = (dress: Dress): string => (dress.hat !== undefined ? HATS[dress.hat].colour : dress.crown === true ? CROWN.colour : CAP.colour)

/**
 * Usagi's grid for a look: the sky row and its box, a slot wide, as
 * `drawLook`'s. Its figure in cells (`nudge` moving it a cell aside), never
 * covered; its energy at the air row's right end; its hat on the floor beside
 * it while it is down, the propeller's blade over its cap in flight; then
 * what is beside it and its laptop, riding with its head as Clawd's do
 * standing.
 */
export const drawUsagi = (look: Look, dress: Dress, above = 0): Grid => {
  const grid = blankGrid(SLOT, GRID_ROWS)
  const figure = new Set<string>()
  const put: Put = (row, column, cell, own = false) => {
    const line = grid[row + SKY]
    const key = `${row}:${column}`
    if (line === undefined || column < 0 || column >= SLOT || figure.has(key)) return
    line[column] = cell
    if (own) figure.add(key)
  }
  const nudge = look.nudge ?? 0
  const { bitmap, palette } = usagiFigure(look, dress)
  const box = bitmap.map(row => `${blankRow((BODY_X + nudge) * 2)}${row}`.padEnd(BOX * 2, '.'))
  cellsOf(box, palette).forEach((cells, row) => cells.forEach((cell, column) => {
    if (cell !== undefined && row < BOX_ROWS) put(row, column, cell, true)
  }))
  const hatAt = (y: number, column: number, text: string, tone: string, ink: Cell['ink'] = 'k'): void => {
    ;[...text].forEach((glyph, index) => {
      if (glyph !== ' ') put(y, column + index, { ch: glyph, ink, colour: tone, hat: true })
    })
  }
  if (look.hatOff === true) {
    // Down: its hat (or crown) on the floor beside its head; its energy waits.
    const floor = dress.hat !== undefined ? { art: HATS[dress.hat].floor, colour: HATS[dress.hat].colour } : dress.crown === true ? { art: SIDE_CROWN.floor, colour: CROWN.colour } : undefined
    if (floor !== undefined) hatAt(3, BODY_X + BODY_WIDTH + 1, floor.art, floor.colour)
  } else {
    if (look.cap !== undefined) hatAt(-1, BODY_X + 4 + nudge, at(FLYING_CAP.blades, look.cap), capTone(dress))
    hatAt(0, ENERGY_X.right + nudge, ENERGY_MARKS.right[dress.energy] ?? '', '', 'y')
  }
  layBeside(look, put, USAGI.body, above, 0, besideOf(look, shoutOf(look)))

  return grid
}

/** A mini's hat as quarters over the cell between its ears. */
const miniHat = (glyph: string): string[] => (glyph === '█' ? ['HH', 'HH'] : glyph === '▀' ? ['HH', '..'] : ['..', 'HH'])

/**
 * A mini Usagi's grid for a look: the sky row (empty) and its 5 by 4, as
 * `drawMini`'s: thin ears on row 1, its role's hat between them as one cell
 * in the hat's colour; at its laptop, its body behind the laptop.
 */
export const drawUsagiMini = (look: MiniLook, agent: Pick<MascotAgent, 'role'>): Grid => {
  const grid = blankGrid(MINI, GRID_ROWS)
  const figure = new Set<string>()
  const put: Put = (row, column, cell, own = false) => {
    const line = grid[row + SKY]
    const key = `${row}:${column}`
    if (line === undefined || column < 0 || column >= MINI || figure.has(key)) return
    line[column] = cell
    if (own) figure.add(key)
  }
  const laptop = MINI_OVERLAYS.laptop as readonly Overlay[]
  const atDesk = look.overlays.some(overlay => laptop.includes(overlay))
  const blank = blankRow(MINI_W)
  let rows: string[] = look.sit
    ? [blank, blank, ...MINI_SAT]
    : [blank, blank, MINI_EARS, MINI_EARS, MINI_HEAD, marked(MINI_HEAD, MINI_EYES[look.head], 'K'), ...(atDesk ? [blank, blank] : [MINI_BODY, marked(blank, MINI_FEET[look.legs], '#')])]
  let palette: Palette = BODY_PALETTE
  if (agent.role !== undefined) {
    const hat = HATS[ROLE_HATS[agent.role]]
    rows = laid(rows, miniHat(hat.mini), 4, look.sit ? 3 : 2)
    palette = { ...palette, H: hat.colour }
  }
  cellsOf(rows, palette).forEach((cells, row) => cells.forEach((cell, column) => {
    if (cell !== undefined) put(row, column, cell, true)
  }))
  const dy = look.sit ? 1 : 0
  for (const overlay of look.overlays) {
    // The laptop stands on the floor in front of it; the rest rides with its head.
    const shift = laptop.includes(overlay) ? 0 : dy
    overlay.art.forEach((text, y) => [...text].forEach((glyph, x) => {
      if (glyph !== ' ') put(y + shift, x, { ch: glyph, ink: overlay.by?.[glyph] ?? overlay.ink, colour: overlay.colour ?? USAGI.body })
    }))
  }

  return grid
}
