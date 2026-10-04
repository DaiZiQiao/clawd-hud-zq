import { BLANKET, CROUCHED, FLAT, HEADS, LEGS, SLOT, SQUASHED, TORSOS } from './mascot-sprites'
import { placedSprites } from './scene-placement'
import { mascotPlan } from './scene-plan'
import { mascotLines } from './scene-render'
import type { MascotLayout, MascotScene, PlacedSprite, Placement } from './scene-types'

// Mascots drawn for the tests: one alone, its cells, and the figure found in a frame.

const layout = (columns: number, rows = 8, tick = 0): MascotLayout => ({ columns, rows, tick })

/** The 4 rows of one placement's box as drawn (its air row first), as wide as its slot, from where it is drawn: the frame stands on the field's front floor, `depth` rows deep. */
export const cellOf = (lines: readonly string[], one: Placement, columns: number, depth = 1): string[] => {
  const top = lines.length - 4 - (depth - 1 - one.d)

  return [0, 1, 2, 3].map(row => (lines[top + row] ?? '').padEnd(columns).slice(one.drawnX, one.drawnX + one.width))
}

/** A 9-cell row of the figure in its box, two cells in, padded to a slot. */
export const boxed = (row: string, rest = ''): string => `  ${row}${rest}`.padEnd(SLOT)

export const placementOf = (scene: MascotScene, room: MascotLayout, id: string): Placement | undefined =>
  mascotPlan(scene, room)?.placements.find(one => one.id === id)

/** What one agent's cell shows at this tick on a 4-row line (no sky), alone with the session's mascot. */
export const drawnAlone = (scene: MascotScene, id: string, tick = 0): string[] => {
  const room = layout(40, 4, tick)
  const one = placementOf(scene, room, id)
  if (one === undefined) throw new Error(`${id} is not placed`)

  return cellOf(mascotLines(scene, room) ?? [], one, 40)
}

/** One sprite as placed at this tick: its grid is the sky row and its box. */
export const spriteOf = (scene: MascotScene, id: string, tick = 0, rows = 4, columns = 40): PlacedSprite => {
  const sprite = placedSprites(scene, layout(columns, rows, tick))?.sprites.find(one => one.id === id)
  if (sprite === undefined) throw new Error(`${id} is not drawn`)

  return sprite
}
export const rowsOf = (sprite: PlacedSprite): string[] => sprite.cells.map(row => row.map(cell => cell?.ch ?? ' ').join('').trimEnd())

export const HEAD_INNERS = new Set<string>([...Object.values(HEADS), SQUASHED[0]].map(row => row.slice(1, 8)))
export const TORSO_ROWS = new Set<string>([...Object.values(TORSOS), FLAT.body, CROUCHED, SQUASHED[1], ...BLANKET.quilt])
export const LEG_ROWS = new Set<string>([...Object.values(LEGS), FLAT.legs, BLANKET.hem])

export type Figure = { head: number; x: number; rows: { row: number; x: number }[]; flat: boolean }

/** Nine cells of a frame's row from `x`. */
export const windowOf = (frame: readonly string[], row: number, x: number): string => [...(frame[row] ?? '')].slice(x, x + 9).join('').padEnd(9)

/** Where the figure stands in a frame: its head row and left column, and its torso's and legs' rows (flat on its back, above it). */
export const figureIn = (frame: readonly string[]): Figure | undefined => {
  for (let row = 0; row < frame.length; row += 1) {
    const cells = [...(frame[row] ?? '')]
    for (let x = 0; x + 8 <= cells.length; x += 1) {
      if (!HEAD_INNERS.has(cells.slice(x + 1, x + 8).join(''))) continue
      if (windowOf(frame, row - 1, x) === FLAT.body && windowOf(frame, row - 2, x) === FLAT.legs) return { head: row, x, rows: [{ row: row - 1, x }, { row: row - 2, x }], flat: true }
      const torso = [x, x - 1, x + 1].find(at => TORSO_ROWS.has(windowOf(frame, row + 1, at)))
      if (torso === undefined) continue
      const rows = [{ row: row + 1, x: torso }]
      if (LEG_ROWS.has(windowOf(frame, row + 2, x))) rows.push({ row: row + 2, x })

      return { head: row, x, rows, flat: false }
    }
  }

  return undefined
}
