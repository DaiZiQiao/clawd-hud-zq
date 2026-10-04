import type { RenderElement, SvgProps } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import type { HudSelection } from '../types'
import { CROWN, HAT_X, HEADS } from './mascot-sprites'
import { draw } from './scene-client'
import type { SceneElements } from './scene-client'
import { arrange, headAt, mount, rowsOf } from './scene-client.fixtures'
import { PALETTE, colourFor, sceneFromInputs, sideOf } from './scene-model'
import { NOW, entry } from './scene-model.fixtures'
import { SVG_MAX, layerSvg, sceneAlt, sceneSvg } from './scene-svg'
import { svgCells, svgRects, svgRows } from './scene-svg.fixtures'
import type { Cell, SceneInputs, SceneLayer } from './scene-types'
import { viewOf } from './scene-view'
import { FRAME_MS, createWorld, pointer, tick } from './scene-world'
import type { World } from './scene-world'
import { LAPTOP, TYPIST, frameLines, inputs, press, ticks } from './scene-world.fixtures'
import { CELL_HEIGHT, CELL_WIDTH, SCENE_THEMES } from './svg-style'

// The scene in pixels on the desktop: one Svg as big as the region, read
// back into the text rows' cells, under the cap, in both themes.


/** A table with `Svg`, as the desktop's: the module's frame through it, as plain data. */
const PIXELS: SceneElements = {
  Box: props => ({ type: 'Box', props }) as unknown as RenderElement,
  Text: props => ({ type: 'Text', props }) as unknown as RenderElement,
  Svg: props => ({ type: 'Svg', props }) as unknown as RenderElement,
}
type Drawn = { type: string; props: Record<string, unknown> & { children?: unknown } }
/** The drawn tree's elements, depth first. */
const elementsOf = (node: unknown): Drawn[] => {
  if (typeof node !== 'object' || node === null) return []
  if (Array.isArray(node)) return node.flatMap(elementsOf)
  const one = node as Drawn

  return [one, ...elementsOf(one.props?.children)]
}
const svgOf = (world: World): SvgProps => elementsOf(draw(world, PIXELS)).find(one => one.type === 'Svg')?.props as unknown as SvgProps

/** The document's tags open and close in order under one `<svg>`. */
const wellFormed = (source: string): boolean => {
  const stack: string[] = []
  for (const match of source.matchAll(/<(\/?)([a-z]+)[^>]*?(\/?)>/g)) {
    const [, closing, tag, self] = match
    if (self === '/') continue
    if (closing === '/') {
      if (stack.pop() !== tag) return false
    } else {
      if (stack.length === 0 && tag !== 'svg') return false
      stack.push(tag ?? '')
    }
  }

  return stack.length === 0 && source.startsWith('<svg ') && source.endsWith('</svg>')
}

const REVIEWER = entry('r', { type: 'reviewer', currentTool: 'Read', startedAt: NOW - 50_000 })
const cell = (ch: string, ink: Cell['ink'] = 'b', colour: string = PALETTE[0]): Cell => ({ ch, ink, colour })
const alone = (...cells: Cell[]): SceneLayer => ({ x: 0, y: 0, cells: [cells] })
const rectsOf = (layer: SceneLayer) => svgRects(layerSvg(layer))

describe('the desktop draws it in pixels', () => {
  test('one Svg as big as the region, its alt the scene in words, no Text rows; asked for by the hooks on the desktop only', async ($, on) => {
    arrange(on, [TYPIST, REVIEWER])
    for (const [columns, rows] of [[72, 24], [100, 30]] as const) {
      const ui = await mount($, 'desktop', columns, rows)
      const props = (await ui.find({ type: 'Client' }))?.props.props as SceneInputs
      expect(props.svg).toBe(true)
      const svg = await ui.find({ type: 'Svg', in: 'mascots' })
      expect(svg?.props.width).toBe(columns * CELL_WIDTH)
      expect(svg?.props.height).toBe(props.rows * CELL_HEIGHT)
      expect(svg?.props.alt).toBe('3 mascots: session watching, general-purpose typing, reviewer reading')
      expect(await ui.findAll({ type: 'Text', in: 'mascots' })).toEqual([])
      // The Svg in a box the region's size, and over it a box as big holding nothing: the hit layer a press lands on.
      const boxes = await ui.findAll({ type: 'Box', in: 'mascots' })
      expect(boxes).toHaveLength(2)
      expect(boxes[0]?.props).toMatchObject({ width: columns, height: props.rows })
      expect(boxes[1]?.props).toMatchObject({ position: 'absolute', top: 0, left: 0, width: columns, height: props.rows })
      expect(boxes[1]?.text ?? '').toBe('')
      const source = String(svg?.props.source)
      expect(wellFormed(source)).toBe(true)
      expect(source.startsWith(`<svg xmlns='http://www.w3.org/2000/svg' width='${columns * CELL_WIDTH}' height='${props.rows * CELL_HEIGHT}' viewBox='0 0 ${columns * CELL_WIDTH} ${props.rows * CELL_HEIGHT}'`)).toBe(true)
      expect(source).not.toMatch(/<script|\son[a-z]+=|href/i)
      expect(svgCells(source)).toMatchObject({ columns, rows: props.rows })
      await ui.unmount()
    }
    const terminal = await mount($, 'terminal')
    expect(((await terminal.find({ type: 'Client' }))?.props.props as SceneInputs).svg).toBe(undefined)
    await terminal.unmount()
  })

  test('read back into cells it is the text rows, every frame of flights, arrivals, farewells and a throw', { timeoutMs: 60_000 }, () => {
    const board = [
      entry('t', { currentTool: 'Edit', startedAt: NOW - 90_000 }),
      entry('e', { type: 'Explore', currentTool: 'Read', startedAt: NOW - 80_000 }),
      entry('f', { currentTool: 'WebFetch', startedAt: NOW - 70_000, effort: 'xhigh' }),
      entry('r', { type: 'reviewer', currentTool: 'Read', readingSince: NOW - 9000, startedAt: NOW - 60_000 }),
      entry('k', { parentId: 't', startedAt: NOW - 50_000 }),
      entry('n', { startedAt: NOW - 1000 }),
      entry('d', { status: 'done', startedAt: NOW - 60_000, endedAt: NOW - 4000 }),
      entry('x', { status: 'failed', startedAt: NOW - 60_000, endedAt: NOW - 1000 }),
      entry('s', { startedAt: NOW - 400_000, lastActivityAt: NOW - 300_000 }),
    ]
    for (const [columns, rows] of [[110, 16], [72, 13], [40, 9]] as const) {
      const world = createWorld(inputs(board, { columns, rows, wander: true, scenes: true, collisions: 'normal' }))
      for (let frame = 0; frame < 160; frame += 1) {
        tick(world)
        if (frame === 30) {
          const at = press(world, 'main')
          pointer(world, { type: 'down', x: at.x, y: at.y, button: 'left' }, () => {})
          pointer(world, { type: 'move', x: at.x + 3, y: Math.max(0, at.y - 3), button: 'left' }, () => {})
        }
        if (frame === 36) pointer(world, { type: 'move', x: 6, y: 0, button: 'left' }, () => {})
        if (frame === 37) pointer(world, { type: 'up', x: 2, y: 0, button: 'left' }, () => {})
        const svg = svgOf(world)
        expect(svgRows(svg.source), `${columns}x${rows} @${frame}`).toEqual(frameLines(world).map(row => row.trimEnd()))
        expect([svg.width, svg.height]).toEqual([columns * CELL_WIDTH, rows * CELL_HEIGHT])
      }
    }
  })

  test('a fixture frame: a rect under every filled quarter of every block glyph, in its sprite\'s colour; the rest text in its own', () => {
    const world = createWorld(inputs([TYPIST], { columns: 72, rows: 8 }))
    ticks(world, 2)
    const lines = frameLines(world)
    const { source } = svgOf(world)
    const cells = svgCells(source).cells
    // Every glyph of the frame where the text rows have it.
    lines.forEach((line, y) => [...line].forEach((ch, x) => expect(cells[y]?.[x]?.ch ?? ' ', `${x},${y}`).toBe(ch)))
    // The filled quarters, counted from the glyphs, are the rects' area exactly: no quarter twice, none missed.
    const quarters = lines.join('').split('').reduce((sum, ch) => sum + ({ '█': 4, '▒': 4, '▛': 3, '▜': 3, '▙': 3, '▟': 3, '▀': 2, '▄': 2, '▌': 2, '▐': 2, '▚': 2, '▞': 2, '▘': 1, '▝': 1, '▖': 1, '▗': 1, '▬': 1 }[ch] ?? 0), 0)
    expect(svgRects(source).reduce((sum, rect) => sum + rect.width * rect.height, 0)).toBe(quarters * (CELL_WIDTH / 2) * (CELL_HEIGHT / 2))
    // The session in the theme's accent, the agent in its own colour, its laptop slate, the crown gold.
    // A field a row deep: both heads on one row.
    const row = lines.findIndex(line => line.includes(HEADS.right.trim()))
    const agent = world.cur!.placements.find(one => one.id === 'a')!
    expect(cells[row]?.[4]).toEqual({ ch: '█', fill: SCENE_THEMES.dark.claude, theme: 'a' })
    expect(cells[row]?.[agent.drawnX + 4]).toEqual({ ch: '█', fill: colourFor('a') })
    // The crown is block glyphs too: its quarters as rects, in its gold.
    expect([5, 6, 7].map(x => cells[row - 1]?.[x])).toEqual([...CROWN.art].map(ch => ({ ch, fill: CROWN.colour })))
    // Any other glyph (the agent's halo) is text in the sprite's own cells (its sky row, then its air row), centred: half a cell in, its baseline 12 pixels down.
    const halo = HAT_X[sideOf('a')] + 1
    expect(source).toContain(`<text x='${halo * CELL_WIDTH + CELL_WIDTH / 2}' y='28'>◠</text>`)
  })

  test('each block glyph is the quarters of its cell; a shade at half strength, a bar across the middle, any other glyph text centred in its cell', () => {
    const table: [string, [number, number, number, number][]][] = [
      ['█', [[0, 0, 8, 16]]],
      ['▀', [[0, 0, 8, 8]]],
      ['▄', [[0, 8, 8, 8]]],
      ['▌', [[0, 0, 4, 16]]],
      ['▐', [[4, 0, 4, 16]]],
      ['▘', [[0, 0, 4, 8]]],
      ['▝', [[4, 0, 4, 8]]],
      ['▖', [[0, 8, 4, 8]]],
      ['▗', [[4, 8, 4, 8]]],
      ['▛', [[0, 0, 8, 8], [0, 8, 4, 8]]],
      ['▜', [[0, 0, 8, 8], [4, 8, 4, 8]]],
      ['▙', [[0, 0, 4, 16], [4, 8, 4, 8]]],
      ['▟', [[4, 0, 4, 16], [0, 8, 4, 8]]],
      ['▚', [[0, 0, 4, 8], [4, 8, 4, 8]]],
      ['▞', [[4, 0, 4, 8], [0, 8, 4, 8]]],
      ['▬', [[0, 6, 8, 4]]],
      ['▒', [[0, 0, 8, 16]]],
    ]
    for (const [glyph, rects] of table) {
      const drawn = rectsOf(alone(cell(glyph)))
      const area = (list: { width: number; height: number }[]): number => list.reduce((sum, one) => sum + one.width * one.height, 0)
      expect(area(drawn), glyph).toBe(area(rects.map(([, , width, height]) => ({ width, height }))))
      expect(svgRows(sceneSvg([alone(cell(glyph))], { columns: 1, rows: 1 }, '').source), glyph).toEqual([glyph])
      if (rects.length === 1) expect(drawn, glyph).toEqual(rects.map(([x, y, width, height]) => ({ x, y, width, height })))
    }
    expect(layerSvg(alone(cell('▒', 'd')))).toBe(`<g><g class='d' fill='${SCENE_THEMES.dark.inactive}' fill-opacity='.5'><rect x='0' y='0' width='8' height='16'/></g></g>`)
    expect(layerSvg(alone(cell('w', 'f')))).toBe(`<g><g class='f' fill='${SCENE_THEMES.dark.text}'><text x='4' y='12'>w</text></g></g>`)
    expect(layerSvg({ x: 2.5, y: 1, cells: [[undefined, cell('✦', 'y')]] })).toBe(`<g transform='translate(20 16)'><g class='y' fill='${SCENE_THEMES.dark.warning}'><text x='12' y='12'>✦</text></g></g>`)
    expect(layerSvg(alone(cell('&', 'k', '#123456'), cell('<', 'k', '#123456')))).toBe(`<g><g fill='#123456'><text x='4' y='12'>&amp;</text><text x='12' y='12'>&lt;</text></g></g>`)
    expect(layerSvg({ x: 3, y: 3, cells: [[undefined], []] })).toBe('')
  })

  test('neighbours of one colour are one rect, along a row and down a column; another colour, or a gap, starts its own', () => {
    const blue = PALETTE[0]
    const rose = PALETTE[1]
    expect(rectsOf(alone(...[...'▐███▌'].map(ch => cell(ch))))).toEqual([{ x: 4, y: 0, width: 32, height: 16 }])
    expect(rectsOf({ x: 0, y: 0, cells: [[cell('█'), cell('█')], [cell('█'), cell('█')]] })).toEqual([{ x: 0, y: 0, width: 16, height: 32 }])
    // The head row of the open look: its top a run across, its bottom three runs round the eyes.
    expect(rectsOf(alone(...[...HEADS.open.trim()].map(ch => cell(ch))))).toEqual([
      { x: 4, y: 0, width: 48, height: 8 },
      { x: 4, y: 8, width: 8, height: 8 },
      { x: 16, y: 8, width: 24, height: 8 },
      { x: 44, y: 8, width: 8, height: 8 },
    ])
    expect(rectsOf(alone(cell('█'), cell(' '), cell('█')))).toEqual([{ x: 0, y: 0, width: 8, height: 16 }, { x: 16, y: 0, width: 8, height: 16 }])
    const two = layerSvg(alone(cell('█', 'b', blue), cell('█', 'b', rose), cell('█', 'b', blue)))
    expect(two).toBe(`<g><g fill='${blue}'><rect x='0' y='0' width='8' height='16'/><rect x='16' y='0' width='8' height='16'/></g><g fill='${rose}'><rect x='8' y='0' width='8' height='16'/></g></g>`)
  })

  test('in pixels a move is drawn where it is, unrounded: a walk glides a fifth of a cell a frame', () => {
    const world = createWorld(inputs([entry('w', { startedAt: NOW - 60_000 })], { wander: true }))
    let seen = 0
    for (let frame = 0; frame < 400 && seen < 4; frame += 1) {
      tick(world)
      const x = viewOf(world).sprites.get('w')?.x
      if (x === undefined || Number.isInteger(x)) continue
      seen += 1
      const px = Math.round(x * CELL_WIDTH * 100) / 100
      expect(svgOf(world).source).toContain(`translate(${px} `)
      expect(frameLines(world).join('\n')).toEqual(svgRows(svgOf(world).source).join('\n'))
    }
    expect(seen).toBe(4)
  })

  test('fifty agents in a big pane: every frame under the cap, everyone drawn', { timeoutMs: 60_000 }, () => {
    const types = ['worker', 'reviewer', 'Explore', 'general-purpose', 'debugger', 'Plan']
    const tools = ['Edit', 'Read', 'Grep', undefined, 'Bash', 'WebFetch']
    const board = Array.from({ length: 50 }, (_, index) => entry(`agent-${index}`, { type: types[index % 6]!, currentTool: tools[index % 6], startedAt: NOW - 60_000 - index * 1000, effort: index % 3 === 0 ? 'xhigh' : undefined }))
    const sizes: number[] = []
    for (const [columns, rows] of [[160, 40], [200, 60]] as const) {
      const world = createWorld(inputs(board, { columns, rows, wander: true, scenes: true }))
      let longest = 0
      for (let frame = 0; frame < 60; frame += 1) {
        tick(world)
        const svg = svgOf(world)
        longest = Math.max(longest, svg.source.length)
        expect(JSON.stringify(svg).length).toBeLessThan(100_000)
      }
      sizes.push(longest)
      expect(svgOf(world).alt).toMatch(/^51 mascots: session watching, /)
    }
    expect(Math.max(...sizes)).toBeLessThan(SVG_MAX)
    expect(SVG_MAX).toBeLessThan(131_072)
  })

  test('past the cap a layer is left out, never one drawn before it', () => {
    const body = [HEADS.open, '▝▜█████▛▘', '  ▘▘ ▝▝  '].map(row => [...row].map(ch => (ch === ' ' ? undefined : cell(ch))))
    const layers: SceneLayer[] = Array.from({ length: 400 }, (_, index) => ({ x: 1 + (index % 50), y: Math.floor(index / 50), cells: body }))
    const svg = sceneSvg(layers, { columns: 60, rows: 12 }, 'crowd')
    expect(svg.source.length).toBeLessThanOrEqual(SVG_MAX)
    expect(wellFormed(svg.source)).toBe(true)
    const kept = svg.source.split("<g transform='translate(").length - 1
    expect(kept).toBeGreaterThan(50)
    expect(kept).toBeLessThan(400)
    expect(svg.source.startsWith(sceneSvg(layers.slice(0, kept), { columns: 60, rows: 12 }, 'crowd').source.slice(0, -'</svg>'.length))).toBe(true)
  })

  test('theme keys carry the dark theme\'s colours, and the light theme\'s for a light page; raw colours as they are', () => {
    const world = createWorld(inputs([entry('f', { type: 'Explore', currentTool: 'Read', startedAt: NOW - 60_000, effort: 'xhigh' })], { columns: 72, rows: 8 }))
    ticks(world, 4)
    const { source } = svgOf(world)
    expect(source).toContain(`class='a' fill='${SCENE_THEMES.dark.claude}'`)
    expect(source).toContain(`class='f' fill='${SCENE_THEMES.dark.text}'`)
    expect(source).toContain(`class='y' fill='${SCENE_THEMES.dark.warning}'`)
    expect(source).toContain(`fill='${colourFor('f')}'`)
    const rule = /<style>@media \(prefers-color-scheme:light\)\{(.*)\}<\/style>/.exec(source)?.[1]
    expect(rule).toContain(`.a{fill:${SCENE_THEMES.light.claude}}`)
    expect(rule).toContain(`.f{fill:${SCENE_THEMES.light.text}}`)
    expect(rule).toContain(`.y{fill:${SCENE_THEMES.light.warning}}`)
    // No theme key drawn, no rule.
    expect(sceneSvg([alone(cell('█'))], { columns: 1, rows: 1 }, '').source).not.toContain('<style>')
  })

  test('the alt says who is held or falling, and how many more stand in the row of dots', () => {
    const world = createWorld(inputs([TYPIST], { columns: 72, rows: 12 }))
    tick(world)
    expect(svgOf(world).alt).toBe('2 mascots: session watching, general-purpose typing')
    const at = press(world, 'a')
    pointer(world, { type: 'down', x: at.x, y: at.y, button: 'left' }, () => {})
    pointer(world, { type: 'move', x: at.x + 2, y: at.y - 3, button: 'left' }, () => {})
    expect(svgOf(world).alt).toBe('2 mascots: session watching, general-purpose held')
    pointer(world, { type: 'up', x: at.x + 2, y: at.y - 3, button: 'left' }, () => {})
    tick(world)
    expect(svgOf(world).alt).toBe('2 mascots: session watching, general-purpose falling')
    const crowd = createWorld(inputs(Array.from({ length: 9 }, (_, index) => entry(`c${index}`, { currentTool: 'Edit', startedAt: NOW - 60_000 + index })), { columns: 60, rows: 4 }))
    tick(crowd)
    const collapsed = crowd.cur!.collapsed.length
    expect(collapsed).toBeGreaterThan(0)
    expect(svgOf(crowd).alt).toMatch(new RegExp(`^\\d+ mascots: session watching, .*; ${collapsed} more as dots$`))
    expect(sceneAlt(sceneFromInputs(crowd.props, crowd.sceneNow), [])).toBe('No mascots')
  })

  test('the pointer hits on the desktop as on the terminal: the cell it presses is the sprite drawn there', async ($, on) => {
    const { held } = arrange(on, [TYPIST])
    const ui = await mount($, 'desktop')
    await ui.advance(2000)
    const rows = await rowsOf(ui)
    const at = headAt(rows, `${HEADS.right.trim()}  ${LAPTOP}`)!
    // A press on the empty sky above it: nothing.
    await ui.pointer({ type: 'down', x: at.x, y: 0, button: 'left' })
    await ui.pointer({ type: 'up', x: at.x, y: 0, button: 'left' })
    expect(held.get('selected')?.value ?? null).toBe(null)
    await ui.pointer({ type: 'down', x: at.x, y: at.y, button: 'left' })
    await ui.advance(FRAME_MS)
    await ui.pointer({ type: 'up', x: at.x, y: at.y, button: 'left' })
    expect(held.get('selected')?.value as HudSelection).toEqual({ id: 'a', kind: 'agent' })
    await ui.unmount()
  })

  // Wandering off: recorded with the session standing still through the 2.2 s it covers.
  test('the terminal\'s rows are as they were: the same tree, frame for frame', { options: { wander: false } }, async ($, on) => {
    arrange(on, [TYPIST, entry('r', { type: 'reviewer', currentTool: 'Read', effort: 'xhigh', startedAt: NOW - 50_000 })])
    const ui = await mount($, 'terminal')
    const hex = async (text: string): Promise<string> =>
      [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('')
    // Recorded from the field: the agents at depths of their own, the session front-left; the near hand off the keys at 350 ms.
    // Re-recorded for Clawd's redrawn kit: the crown in blocks, each hat on its head's corner.
    const expected = [
      [0, '67c75fa2b6c74a0cf3f120f28c8eb65c132589eb9da71c7b0fc06edee78e52cc'],
      [350, 'd4f0174f5e5b51eb4cbc835bf11a261bb42d94d36a6087d3205172ad7d85fcb4'],
      [1850, '67c75fa2b6c74a0cf3f120f28c8eb65c132589eb9da71c7b0fc06edee78e52cc'],
    ] as const
    for (const [ms, hash] of expected) {
      if (ms > 0) await ui.advance(ms)
      expect(await hex(JSON.stringify(await ui.drawn({ in: 'mascots' }))), `${ms} ms`).toBe(hash)
    }
    expect((await rowsOf(ui)).slice(-14)).toEqual([
      '                       ◜◠◝',
      '                   ▐█▜██▛▌  ▗▄▄▄▖',
      '                  ▝▜█████▛▀▖▐▒▒▒▌',
      '                    ▘▘ ▝▝  ▀▀▀▀▀▀',
      '                             ♫ r  ✦✦',
      '                            ▐█▜██▛▌  ▗▄▄▄▖',
      '                           ▝▜█████▛▀▖▐▒▒▒▌',
      '                             ▘▘ ▝▝  ▀▀▀▀▀▀',
      ' ',
      ' ',
      '     ▙█▟',
      '   ▐█▜██▛▌',
      '  ▝▜█████▛▘',
      '    ▘▘ ▝▝',
    ])
    await ui.unmount()
  })
})
