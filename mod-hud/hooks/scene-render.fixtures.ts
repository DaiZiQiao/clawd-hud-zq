import { paint } from './scene-canvas'
import { styleOf } from './scene-render'
import type { Cell, MascotLayout, MascotPlan, MascotScene } from './scene-types'
import { textRuns } from './text-svg.fixtures'

// A drawn tree as the scene and pane tests read it; the painted scene as
// plain text, and the colours it is drawn in.

export type Described = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

/** Every Text beneath a found element, outermost first; a row drawn in pixels (the desktop's) as its runs read back, each a Text. */
export const textsIn = (node: unknown): Described[] => {
  if (typeof node !== 'object' || node === null) return []
  const described = node as Described
  if (described.type === 'Svg') return textRuns(String(described.props?.source ?? '')).map(run => ({ type: 'Text', props: run.props, children: [run.text] }))

  return [...(described.type === 'Text' ? [described] : []), ...(described.children ?? []).flatMap(textsIn)]
}

/** A canvas as plain text, a row per row, trailing blanks dropped. */
export const canvasLines = (grid: readonly (readonly (Cell | undefined)[])[]): string[] =>
  grid.map(row => row.slice(0, row.findLastIndex(cell => cell !== undefined) + 1).map(cell => cell?.ch ?? ' ').join(''))

/** The scene as plain text, top row first, each row's trailing blanks dropped; undefined when it does not fit. */
export const mascotLines = (scene: MascotScene, layout: MascotLayout, plan?: MascotPlan): string[] | undefined => {
  const painted = paint(scene, layout, plan)

  return painted === undefined ? undefined : canvasLines(painted.grid)
}

/** Every colour the drawing uses at this tick (contract keys and raw colours, a two-colour cell's background too). */
export const mascotColours = (scene: MascotScene, layout: MascotLayout, plan?: MascotPlan): Set<string> => {
  const colours = new Set<string>()
  for (const row of paint(scene, layout, plan)?.grid ?? []) {
    for (const cell of row) {
      const style = cell === undefined ? {} : styleOf(cell)
      for (const colour of [style.color, style.backgroundColor]) if (colour !== undefined) colours.add(colour)
    }
  }

  return colours
}
