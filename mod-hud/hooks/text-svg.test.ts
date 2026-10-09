import { describe, expect, test } from 'claude-code/testing'

import { CELL_HEIGHT, CELL_WIDTH, SCENE_THEMES } from './svg-style'
import { buttonText, clipped, fitted, textRowSvg } from './text-svg'
import type { TextRow } from './text-svg'
import { rowWidth, textLine, textPieces, textRuns, textSvgSize } from './text-svg.fixtures'

// One row of coloured spans as one SVG document on the scene's grid, its
// Buttons' cells left blank and handed back with their places.

const press = (): void => undefined

describe('a row in pixels', () => {
  test('runs sit on the 8×16 grid, split at runs of blanks, each stretched to its cells; read back to the same text and looks', () => {
    const row: TextRow = { key: 'r', cells: [{ text: '  ctx   ', dimColor: true }, { text: '━━━', color: 'success' }, { text: '─────', dimColor: true }, { text: '  41%' }, { text: '  opus 5.5', color: 'claude', bold: true }] }
    const { svg, hits } = textRowSvg(row)
    expect(hits).toEqual([])
    const source = svg?.source ?? ''
    expect(textLine(source)).toBe('  ctx   ━━━─────  41%  opus 5.5')
    expect(textRuns(source)).toEqual([
      { x: 2, text: 'ctx', props: { dimColor: true } },
      { x: 8, text: '━━━', props: { color: 'success' } },
      { x: 11, text: '─────', props: { dimColor: true } },
      { x: 18, text: '41%', props: {} },
      { x: 23, text: 'opus 5.5', props: { color: 'claude', bold: true } },
    ])
    expect(source).toContain(`<text x='184' y='12' textLength='64'>opus 5.5</text>`)
    expect(source).toContain(`<rect x='64' y='7' width='24' height='3'/>`)
    expect(source).toContain(`<rect x='88' y='8' width='40' height='1'/>`)
    expect(source).toContain(`shape-rendering='crispEdges'`)
    expect(svg).toMatchObject({ width: 31 * CELL_WIDTH, height: CELL_HEIGHT, alt: 'ctx 41% opus 5.5' })
    expect(textSvgSize(source)).toMatchObject({ columns: 31, rows: 1 })
  })

  test('a raw colour is a fill of its own; a theme key its dark colour and the class the light scheme recolours; struck runs are line-through', () => {
    const source = textRowSvg({ key: 'r', cells: [{ text: 'wf-4a65', color: '#3681D1' }, { text: ' done', color: 'error', dimColor: true, strikethrough: true }] }).svg?.source ?? ''
    expect(source).toContain(`<g fill='#3681D1'><text x='0' y='12' textLength='56'>wf-4a65</text></g>`)
    expect(source).toContain(`<g class='r' fill='${SCENE_THEMES.dark.error}' opacity='.55'><text x='64' y='12' textLength='32' text-decoration='line-through'>done</text></g>`)
    expect(source).toContain(`@media (prefers-color-scheme:light){.r{fill:${SCENE_THEMES.light.error}}}`)
    expect(source).not.toContain('crispEdges')
    expect(textPieces(source)).toEqual([{ text: 'wf-4a65', props: { color: '#3681D1' } }, { text: ' ', props: {} }, { text: 'done', props: { color: 'error', dimColor: true, strikethrough: true } }])
  })

  test('markup and control characters never reach the document as such: escaped, or a blank in their cell', () => {
    const source = textRowSvg({ key: 'r', cells: [{ text: 'a<b>&c\u0000d\ne' }] }).svg?.source ?? ''
    expect(source).toContain('a&lt;b&gt;&amp;c')
    expect(source).not.toMatch(/[\u0000-\u001f]/)
    expect(textLine(source)).toBe('a<b>&c d e')
  })

  test('Buttons take their cells as the terminal draws them, left blank in the document; a row of Buttons alone has no document', () => {
    const row: TextRow = { key: 'tabs', cells: [{ button: { key: 'tab:task', label: 'Task', primary: true, onPress: press } }, { text: '  ' }, { button: { key: 'tab:trail', label: 'Trail', dimColor: true, onPress: press } }] }
    const { svg, hits } = textRowSvg(row)
    expect(svg).toBe(undefined)
    expect(hits.map(({ key, x, width }) => ({ key, x, width }))).toEqual([{ key: 'tab:task', x: 0, width: 8 }, { key: 'tab:trail', x: 10, width: 5 }])
    expect(rowWidth(row.cells)).toBe(15)
    expect(buttonText({ key: 'k', label: 'Task', primary: true, onPress: press })).toBe('[ Task ]')
    const mixed = textRowSvg({ key: 'agent', cells: [{ button: { key: 'inspect:a', label: '▸', onPress: press } }, { text: '● ', color: 'claude' }, { text: 'Explore' }] })
    expect(mixed.hits[0]).toMatchObject({ x: 0, width: 1 })
    expect(textLine(mixed.svg?.source ?? '')).toBe(' ● Explore')
  })

  test('fitted pads or cuts to exactly its cells, the cut ending in …; clipped cuts a row and leaves out a Button that does not fit', () => {
    expect(fitted([{ text: 'Explore' }], 10)).toEqual([{ text: 'Explore' }, { text: '   ' }])
    expect(fitted([{ text: 'general-purpose', color: 'claude' }, { text: ' more' }], 8)).toEqual([{ text: 'general…', color: 'claude' }])
    expect(fitted([{ text: '●', color: 'claude' }], 2)).toEqual([{ text: '●', color: 'claude' }, { text: ' ' }])
    const cut = clipped([{ text: 'abc' }, { button: { key: 'k', label: 'press me', onPress: press } }], 6)
    expect(cut).toEqual([{ text: 'abc' }])
    expect(clipped([{ text: 'Agents · 1 running · 0 done · workflow 3 running' }], 20)).toEqual([{ text: 'Agents · 1 running…' }])
  })
})
