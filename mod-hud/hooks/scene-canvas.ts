import { blankGrid } from './mascot-glyphs'
import { BOX_ROWS } from './mascot-sprites'
import { pipeCells } from './scene-pipe'
import { placedSprites, rowOf } from './scene-placement'
import { mascotPlan } from './scene-plan'
import type { Cell, Grid, MascotLayout, MascotPlan, MascotScene, SceneLayer, SceneView } from './scene-types'

// The scene painted cell by cell at a frame: one painter for every
// renderer, giving the grid (the text rows), each sprite's layer at its
// unrounded place (the pixels), whose sprite shows in each cell (the
// pointer) and each agent's pick.

type Painted = { grid: Grid; sky: number; picks: { id: string; x: number; row: number }[]; owners: (string | undefined)[][]; layers: SceneLayer[] }

/**
 * The scene painted cell by cell at this tick: what `renderMascots` draws, row
 * by row, the sky rows first when used. Sprites back to front, a nearer one
 * over a farther one; then the pipes over them; then the marks, which never
 * cover a cell. With `full` (the smooth scene) every row of the room is kept,
 * the sky's empty ones too, so a row is the region's row; `owners` says whose
 * sprite shows in each cell.
 */
export const paint = (scene: MascotScene, layout: MascotLayout, plan = mascotPlan(scene, layout), view?: SceneView, full = false): Painted | undefined => {
  const placed = placedSprites(scene, layout, plan, view)
  if (placed === undefined || plan === undefined) return undefined
  const columns = plan.columns
  const room = placed.headroom
  const height = room + BOX_ROWS + placed.depth - 1
  const canvas = blankGrid(columns, height)
  const owners: (string | undefined)[][] = canvas.map(row => row.map(() => undefined))
  // Which sprite shows in each cell (its index), −1 none, −2 a pipe: a layer keeps only the cells it shows.
  const shown: number[][] = canvas.map(row => row.map(() => -1))
  const drawn: [number, number, number, number][][] = placed.sprites.map(() => [])
  placed.sprites.forEach((one, index) => {
    one.cells.forEach((row, y) => {
      const at = one.top + y
      // Inside the pipe: not drawn.
      if (one.clip !== undefined && at <= one.clip) return
      const target = canvas[room + at]
      const whose = owners[room + at]
      const by = shown[room + at]
      if (target === undefined || whose === undefined || by === undefined) return
      row.forEach((cell, dx) => {
        const column = one.x + dx
        if (cell === undefined || column < 0 || column >= columns) return
        target[column] = cell
        by[column] = index
        whose[column] = one.kind === 'strip' ? undefined : one.id
        drawn[index]?.push([y, dx, room + at, column])
      })
    })
  })
  // The pipes over the sprites, from a row above the top down to their lips; nobody's cells.
  const pipeLayers: SceneLayer[] = []
  for (const pipe of placed.pipes) {
    const lip = room + rowOf(pipe.lip)
    if (lip < 0) continue
    const cells = pipeCells(pipe.kind, lip + 2).map(row => row.map((cell, dx) => (pipe.x + dx < 0 || pipe.x + dx >= columns ? undefined : cell)))
    cells.forEach((row, y) => {
      const at = y - 1
      const target = canvas[at]
      if (target === undefined) return
      row.forEach((cell, dx) => {
        if (cell === undefined) return
        target[pipe.x + dx] = cell
        ;(owners[at] as (string | undefined)[])[pipe.x + dx] = undefined
        ;(shown[at] as number[])[pipe.x + dx] = -2
      })
    })
    pipeLayers.push({ x: pipe.x, y: room + pipe.lip - (lip + 1), cells, pipe: true })
  }
  // Each sprite's cells as the canvas shows them, at its place from the canvas's top (the sky's first row).
  const layers: SceneLayer[] = placed.sprites.map((one, index) => {
    const kept: (Cell | undefined)[][] = one.cells.map(() => [])
    for (const [y, dx, row, column] of drawn[index] ?? []) {
      if (shown[row]?.[column] === index) (kept[y] as (Cell | undefined)[])[dx] = one.cells[y]?.[dx]
    }

    return { x: one.exact?.x ?? one.x, y: room + (one.exact?.top ?? one.top), cells: kept, ...(one.kind === 'strip' ? {} : { id: one.id }), kind: one.kind, ...(one.pose === undefined ? {} : { pose: one.pose }) }
  })
  layers.push(...pipeLayers)
  // A mark never covers a sprite's or a pipe's cell: it goes a row up into the sky, or waits.
  for (const mark of placed.marks) {
    if (mark.x < 0 || mark.x >= columns) continue
    const cell = canvas[room + mark.row]?.[mark.x]
    const row = cell !== undefined ? mark.row - 1 : mark.row
    if (row < -room || canvas[room + row]?.[mark.x] !== undefined) continue
    const target = canvas[room + row]
    if (target === undefined) continue
    const ink: Cell = { ch: mark.ch, ink: mark.ink, colour: mark.colour }
    target[mark.x] = ink
    layers.push({ x: mark.x, y: room + row, cells: [[ink]] })
  }
  const firstDrawn = canvas.findIndex(row => row.some(cell => cell !== undefined))
  const sky = full ? room : firstDrawn < 0 ? 0 : Math.max(0, room - firstDrawn)
  const grid = canvas.slice(room - sky)
  // From the canvas's top to the drawn grid's.
  for (const layer of layers) layer.y -= room - sky
  // One pick per cell, where its agent shows: none where a nearer one or a pipe covers it (the cell between its feet may be blank).
  const taken = new Set<string>()
  const picks: Painted['picks'] = []
  for (const [index, one] of placed.sprites.entries()) {
    if (one.pick === undefined || one.kind === 'main' || one.kind === 'strip') continue
    const key = `${one.pick.row}:${one.pick.x}`
    const over = shown[room + one.pick.row]?.[one.pick.x]
    if (taken.has(key) || over === undefined || (over !== -1 && over !== index)) continue
    taken.add(key)
    picks.push({ id: one.id, x: one.pick.x, row: sky + one.pick.row })
  }

  return { grid, sky, picks, owners: owners.slice(room - sky), layers }
}

/**
 * The smooth scene's frame: every row of the room (the region's rows, the sky's
 * empty ones too) as cells, and whose sprite drew each cell for the pointer;
 * `layers`, the same sprites and marks at their unrounded places, for a
 * surface drawing pixels. Undefined when nothing fits.
 */
export const sceneCanvas = (scene: MascotScene, layout: MascotLayout, plan: MascotPlan | undefined, view?: SceneView): { grid: (Cell | undefined)[][]; owners: (string | undefined)[][]; layers: SceneLayer[] } | undefined => {
  const painted = paint(scene, layout, plan, view, true)

  return painted === undefined ? undefined : { grid: painted.grid, owners: painted.owners, layers: painted.layers }
}
