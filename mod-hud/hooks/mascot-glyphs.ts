import { at } from './mascot-poses'
import type { Look, MiniLook } from './mascot-poses'
import {
  ACCESSORIES,
  ARMS_UP,
  B5,
  BLANKET,
  BODY_WIDTH,
  BODY_X,
  CROUCHED,
  CROWN,
  ENERGY_MARKS,
  ENERGY_X,
  FLAT,
  FLYING_CAP,
  GRID_ROWS,
  HAT_X,
  HEADS,
  LAPTOP,
  LEANING,
  LEGS,
  LETTER_X,
  MINI,
  MINI_HEADS,
  MINI_LEGS,
  MINI_OVERLAYS,
  MINI_SAT,
  OVERLAYS,
  REACH,
  ROLE_LETTERS,
  SKY,
  SLOT,
  SQUASHED,
  THOUGHT_FRAMES,
  TORSOS,
  flipped,
} from './mascot-sprites'
import type { HatSide, Ink, Overlay } from './mascot-sprites'
import { sideOf } from './scene-model'
import type { Cell, Energy, Grid, MascotAgent, MascotMain } from './scene-types'
import { CROSS as USAGI_CROSS, SHOUT, USAGI_THOUGHT_FRAMES } from './usagi-sprites'

// One mascot drawn into cells from its look (hooks/mascot-poses.ts): the
// figure from the body tables (hooks/mascot-sprites.ts) in its colour, its air
// row (letter, hat, energy), what is beside it and its laptop; a mini's 5 by
// 4 and its accessory's two cells.

export const blankGrid = (width: number, height: number): Grid => Array.from({ length: height }, () => Array.from({ length: width }, () => undefined))

/** What a mascot wears on its air row: its role letter, centred; its hat (an accessory at one end, or the crown centred); its energy. */
export type Wear = { letter?: string; hat?: { art: string; colour: string; side: HatSide }; energy: Energy }

export const wearOfAgent = (agent: MascotAgent): Wear => ({
  ...(agent.role === undefined ? {} : { letter: ROLE_LETTERS[agent.role] }),
  ...(agent.accessory === undefined ? {} : { hat: { art: ACCESSORIES[agent.accessory].art, colour: ACCESSORIES[agent.accessory].colour, side: agent.side ?? sideOf(agent.id) } }),
  energy: agent.energy ?? 0,
})

export const wearOfMain = (main: MascotMain): Wear => ({ hat: { ...CROWN, side: 'centre' }, energy: main.energy ?? 0 })

/** One row up on its bouncing frames, where a row is free above it. */
export const bobOf = (look: Look, sky: number): number => (look.bob === true && sky - look.lift >= 1 ? 1 : 0)

/** A thought or sleep rising beside the head (Usagi's shouts and its cross too): a row lower without a sky row. */
const RISING: ReadonlySet<Overlay> = new Set<Overlay>([...THOUGHT_FRAMES.flat(), ...USAGI_THOUGHT_FRAMES.flat(), ...OVERLAYS.zzz, SHOUT, USAGI_CROSS])

/** Lays a cell of a mascot's grid at (row, column) of its box (row −1 the sky row); `own` for the figure's, which nothing laid later covers. */
export type Put = (row: number, column: number, cell: Cell, own?: boolean) => void

/**
 * What is beside a figure, riding `dy` rows below its standing place (a
 * thought or sleep a row lower with no sky row free), then its laptop and its
 * near hand on the keys: Clawd's and Usagi's alike.
 */
export const layBeside = (look: Look, put: Put, colour: string, above: number, dy: number, overlays: readonly Overlay[] = look.overlays): void => {
  for (const overlay of overlays) {
    const lower = RISING.has(overlay) && above < 1 ? 1 : 0
    const art = lower === 1 ? overlay.lowArt ?? overlay.art : overlay.art
    art.forEach((text, y) => {
      ;[...text].forEach((glyph, column) => {
        if (glyph === ' ') return
        put(y - SKY + dy + lower, column + (look.nudge ?? 0), { ch: glyph, ink: overlay.by?.[glyph] ?? overlay.ink, colour: overlay.colour ?? colour })
      })
    })
  }
  if (look.desk === true) {
    for (const part of LAPTOP) {
      part.art.forEach((text, y) => {
        ;[...text].forEach((glyph, column) => {
          if (glyph !== ' ') put(y - SKY, column, { ch: glyph, ink: part.ink, colour: part.colour ?? colour })
        })
      })
    }
    if (look.reach === true) {
      REACH.forEach((text, y) => {
        ;[...text].forEach((glyph, column) => {
          if (glyph !== ' ') put(y - SKY, column, { ch: glyph, ink: 'b', colour }, true)
        })
      })
    }
  }
}

/**
 * A full mascot's grid for a look: the sky row and its box, a slot wide.
 * The figure first, only from the body tables, in its colour; then its air
 * row, riding with its head: the letter centred, its hat at one end (the
 * crown centred; the propeller cap in its place in flight; on the floor
 * beside it while it is down), its energy at the other; then what is beside
 * it, which never covers a cell of the figure; then its laptop. `above` is
 * the rows free over its box this frame: with none, a thought or sleep is
 * drawn a row lower.
 */
export const drawLook = (look: Look, wear: Wear, colour: string, above = 0): Grid => {
  const grid = blankGrid(SLOT, GRID_ROWS)
  const figure = new Set<string>()
  const put = (row: number, column: number, cell: Cell, own = false): void => {
    const line = grid[row + SKY]
    const key = `${row}:${column}`
    if (line === undefined || column < 0 || column >= SLOT || figure.has(key)) return
    line[column] = cell
    if (own) figure.add(key)
  }
  const x = BODY_X + (look.nudge ?? 0)
  const lowered = look.pose === 'sit' || look.pose === 'crouch' || look.pose === 'squash'
  const headRow = look.pose === 'flat' ? 3 : lowered ? 2 : 1
  /** A row of the figure, in its colour; the blanket's in its own. */
  const row = (y: number, text: string, dx = 0, tone?: string): void => {
    ;[...text].forEach((glyph, index) => {
      if (glyph !== ' ') put(y, x + dx + index, tone === undefined ? { ch: glyph, ink: 'b', colour } : { ch: glyph, ink: 'k', colour: tone }, true)
    })
  }
  const head = HEADS[look.head]
  switch (look.pose) {
    case 'stand':
      row(1, head)
      // A lean takes the torso half a cell the way it goes, arms at rest.
      row(2, look.lean !== undefined && look.arms === 'rest' ? LEANING[look.lean === -1 ? 'left' : 'right'] : TORSOS[look.arms])
      row(3, LEGS[look.legs])
      break
    case 'sit':
      row(2, head)
      row(3, TORSOS[look.arms])
      break
    case 'crouch':
      row(2, head)
      row(3, CROUCHED)
      break
    case 'squash':
      row(2, SQUASHED[0])
      row(3, SQUASHED[1])
      break
    case 'flat':
      // On its back: the head upside down too, its eyes against the body.
      row(1, FLAT.legs)
      row(2, FLAT.body)
      row(3, flipped(head))
      break
    case 'blanket':
      row(1, head)
      row(2, BLANKET.quilt[look.breath ?? 0] ?? BLANKET.quilt[0], 0, BLANKET.colour)
      row(3, BLANKET.hem, 0, BLANKET.colour)
      break
  }
  if (look.armsUp === true) for (const [y, column, glyph] of ARMS_UP) put(y + headRow - 1, column + (look.nudge ?? 0), { ch: glyph, ink: 'b', colour }, true)

  // The air row over the head: the letter, the hat (or the flying cap and its blade), the energy at the other end.
  const hatRow = headRow - 1
  const nudge = look.nudge ?? 0
  const hatAt = (y: number, column: number, text: string, tone: string, ink: Ink = 'k'): void => {
    ;[...text].forEach((glyph, index) => {
      if (glyph !== ' ') put(y, column + index, { ch: glyph, ink, colour: tone, hat: true })
    })
  }
  const side: HatSide = wear.hat?.side ?? 'left'
  const hatX = HAT_X[side] + nudge
  if (look.hatOff === true) {
    // Down on its back: its hat on the floor beside its head; the letter and the energy wait.
    if (wear.hat !== undefined) hatAt(3, BODY_X + BODY_WIDTH + 1, wear.hat.art, wear.hat.colour)
  } else {
    if (wear.letter !== undefined) hatAt(hatRow, LETTER_X + nudge, wear.letter, colour, 'f')
    if (look.cap !== undefined) {
      const tone = wear.hat?.colour ?? CROWN.colour
      hatAt(hatRow, hatX, FLYING_CAP.art, tone)
      hatAt(hatRow - 1, hatX + 1, at(FLYING_CAP.blades, look.cap), tone)
    } else if (wear.hat !== undefined) {
      hatAt(hatRow, hatX, wear.hat.art, wear.hat.colour)
    }
    const end = side === 'right' ? 'left' : 'right'
    hatAt(hatRow, ENERGY_X[end] + nudge, ENERGY_MARKS[end][wear.energy] ?? '', '', 'y')
  }

  // Beside it, riding with its head; a thought or sleep a row lower with no sky row free.
  layBeside(look, put, colour, above, look.pose === 'flat' ? 0 : headRow - 1)

  return grid
}

/** A mini's grid for a look: the sky row (empty) and its 5 by 4, its accessory's two cells over its head. */
export const drawMini = (look: MiniLook, agent: Pick<MascotAgent, 'accessory'>, colour: string): Grid => {
  const grid = blankGrid(MINI, GRID_ROWS)
  const figure = new Set<string>()
  const put = (row: number, column: number, cell: Cell, own = false): void => {
    const line = grid[row + SKY]
    const key = `${row}:${column}`
    if (line === undefined || column < 0 || column >= MINI || figure.has(key)) return
    line[column] = cell
    if (own) figure.add(key)
  }
  // At its laptop the body row is behind it: only the head shows over the lid.
  const atDesk = look.overlays.some(overlay => MINI_OVERLAYS.laptop.includes(overlay as (typeof MINI_OVERLAYS.laptop)[number]))
  const body = look.sit ? [B5, B5, B5, MINI_SAT] : [B5, B5, MINI_HEADS[look.head], atDesk ? B5 : MINI_LEGS[look.legs]]
  body.forEach((text, y) => [...text].forEach((glyph, x) => {
    if (glyph !== ' ') put(y, x, { ch: glyph, ink: 'b', colour }, true)
  }))
  const dy = look.sit ? 1 : 0
  if (agent.accessory !== undefined) {
    const kit = ACCESSORIES[agent.accessory]
    ;[...kit.mini].forEach((glyph, index) => {
      if (glyph !== ' ') put(1 + dy, 2 + index, { ch: glyph, ink: 'k', colour: kit.colour, hat: true })
    })
  }
  for (const overlay of look.overlays) {
    // The laptop stands on the floor in front of it; the rest rides with its head.
    const shift = MINI_OVERLAYS.laptop.includes(overlay as (typeof MINI_OVERLAYS.laptop)[number]) ? 0 : dy
    overlay.art.forEach((text, y) => [...text].forEach((glyph, x) => {
      if (glyph !== ' ') put(y + shift, x, { ch: glyph, ink: overlay.by?.[glyph] ?? overlay.ink, colour: overlay.colour ?? colour })
    }))
  }

  return grid
}
