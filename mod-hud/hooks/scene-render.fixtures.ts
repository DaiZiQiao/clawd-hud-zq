import { textRuns } from './text-svg.fixtures'

// A drawn tree as the scene and pane tests read it.

export type Described = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

/** Every Text beneath a found element, outermost first; a row drawn in pixels (the desktop's) as its runs read back, each a Text. */
export const textsIn = (node: unknown): Described[] => {
  if (typeof node !== 'object' || node === null) return []
  const described = node as Described
  if (described.type === 'Svg') return textRuns(String(described.props?.source ?? '')).map(run => ({ type: 'Text', props: run.props, children: [run.text] }))

  return [...(described.type === 'Text' ? [described] : []), ...(described.children ?? []).flatMap(textsIn)]
}
