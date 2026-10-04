import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine, FoundElement } from 'claude-code/testing'

import type { HudData } from '../types'
import type { HudElements } from './hud'
import {
  BARLESS_AT,
  BAR_WIDTH,
  CLOSE_RESERVE,
  NARROW_BAR_WIDTH,
  SMALL_BAR_WIDTH,
  TODO_ROWS,
  bar,
  barWidthFor,
  formatCost,
  formatDuration,
  formatReset,
  formatTokens,
  hudLines,
  levelColor,
  modelLabel,
  renderHud,
  renderTodos,
  statusLineText,
  todoLines,
  todoRows,
} from './hud'
import { displayWidth, truncate } from './text-width'
import { FIXTURES, NOW, allDone, empty, full, fullContext, localIso, longBranch, manyTools, sevenTodos, sparse } from './hud.fixtures'
import { SVG_MAX } from './scene-svg'
import { CELL_HEIGHT, CELL_WIDTH, SCENE_THEMES } from './svg-style'
import { rowSource, svgsOf, textLine, textPieces, textRuns, textSvgSize } from './text-svg.fixtures'

// The HUD is drawn by the test's own render hook, beneath the plugin, on a
// pane instance of its own: what the wiring will do inside the agent board.
const HUD = 'hud-under-test'
const NARROW_BELOW = 60
const PANE_PROPS = {
  title: 'Agents',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const
const VIEWPORT = { columns: 160, rows: 40, isFullscreen: true }
const SURFACES = ['terminal', 'desktop'] as const
const WIDTHS = [100, 56, 48] as const
/** Every width from 20 to 130 columns. */
const EVERY_WIDTH = Array.from({ length: 111 }, (_, index) => 20 + index)
const THEME_KEYS = ['claude', 'success', 'warning', 'error']
const MODEL = 'opus 5.5'
/** A bar's cells: the fill and the empty track. */
const BAR_CELLS = /[━─]/g

type Surface = (typeof SURFACES)[number]

/** What the hook draws: the HUD alone, or over an agent list of `agents` rows. */
type Scene = { data: HudData; rows?: number; agents?: number }

/** The elements the HUD draws with on a surface: with the desktop's `Svg`, its rows in pixels. */
const elementsFor = (surface: string, table: HudElements): HudElements =>
  surface === 'desktop' ? table : { Box: table.Box, Text: table.Text }

const stage = (on: On, data: HudData = full): Scene => {
  const scene: Scene = { data }
  on('ui.render', { component: 'Pane', requestId: HUD }, ($, e) => {
    const table = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    // As the pane does: `Svg` on the desktop alone (every table has one; the terminal's draws nothing).
    const hud = renderHud(elementsFor(e.surface, table), scene.data, { columns, rows: scene.rows, isNarrow: columns < NARROW_BELOW })
    if (scene.agents === undefined) return hud ?? table.Box({})
    const { Box, Text } = table
    const agents = Array.from({ length: scene.agents }, (_, index) =>
      Box({ key: `agent:${index}`, children: Text({ wrap: 'truncate-end', children: `● Explore  sonnet 5.5  0:0${index % 10}  ${index} call${index === 1 ? '' : 's'}` }) }))

    return Box({
      flexDirection: 'column',
      height: e.props.scroll.bodyRows,
      children: [
        hud,
        Text({ bold: true, wrap: 'truncate-end', children: scene.agents === 0 ? 'Agents' : `Agents · ${scene.agents} running` }),
        ...(scene.agents === 0 ? [Text({ dimColor: true, wrap: 'truncate-end', children: 'No agents yet.' })] : agents),
      ],
    })
  })

  return scene
}

const mount = ($: Engine, surface: Surface, columns: number, bodyRows = 40) =>
  $.ui.mount({
    plugin: 'mod-hud',
    surface,
    component: 'Pane',
    props: { ...PANE_PROPS, bodyColumns: columns, scroll: { offset: 0, bodyRows } },
    requestId: HUD,
    viewport: VIEWPORT,
  })

type Drawing = Awaited<ReturnType<typeof mount>>

type Described = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
type Piece = { text: string; props: Record<string, unknown> }
type HudRow = { id: string; text: string; pieces: Piece[] }

const textOf = (node: unknown): string => {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (typeof node !== 'object' || node === null) return ''

  return ((node as Described).children ?? []).map(textOf).join('')
}

// A row's Text, split into what it draws: plain strings and styled spans.
const piecesOf = (box: FoundElement): Piece[] => {
  const outer = box.children[0] as Described | undefined

  return (outer?.children ?? []).map(child =>
    typeof child === 'string' ? { text: child, props: {} } : { text: textOf(child), props: (child as Described).props ?? {} })
}

// A row's text and pieces: its Text's on the terminal; on the desktop its Svg read back.
const rowsOf = async (ui: Drawing): Promise<HudRow[]> => {
  await ui.redraw()
  const boxes = await ui.findAll({ type: 'Box' })

  return boxes
    .filter(box => box.key !== undefined && box.key.startsWith('hud:'))
    .map(box => {
      const id = (box.key ?? '').slice('hud:'.length)
      const source = rowSource(box)

      return source === undefined ? { id, text: box.text, pieces: piecesOf(box) } : { id, text: textLine(source), pieces: textPieces(source) }
    })
}

/** The lines as a surface's rows read them: the desktop's documents end at their last drawn cell. */
const linesFor = (surface: Surface, lines: readonly string[]): string[] => lines.map(line => (surface === 'desktop' ? line.trimEnd() : line))

const rowOf = (rows: readonly HudRow[], id: string): HudRow | undefined => rows.find(row => row.id === id)

// A piece by its text; read back from pixels a run's blanks at either end are the plain piece beside it.
const piece = (row: HudRow | undefined, text: string): Piece | undefined =>
  row?.pieces.find(one => one.text.includes(text)) ?? row?.pieces.find(one => one.text.trim() !== '' && one.text.includes(text.trim()))

// Every fixture on every surface at every width, mounted.
const eachDrawing = async (
  $: Engine,
  scene: Scene,
  widths: readonly number[],
  visit: (rows: HudRow[], where: { name: string; surface: Surface; columns: number }) => void | Promise<void>,
): Promise<void> => {
  for (const [name, data] of Object.entries(FIXTURES)) {
    scene.data = data
    for (const surface of SURFACES) {
      for (const columns of widths) {
        const ui = await mount($, surface, columns)
        await visit(await rowsOf(ui), { name, surface, columns })
        await ui.unmount()
      }
    }
  }
}

describe('formats', () => {
  test('formatTokens: 412k and 1.0M, never more than four cells', () => {
    expect(formatTokens(412_000)).toBe('412k')
    expect(formatTokens(1_000_000)).toBe('1.0M')
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(4_500)).toBe('4.5k')
    expect(formatTokens(9_960)).toBe('10k')
    expect(formatTokens(999_499)).toBe('999k')
    expect(formatTokens(999_500)).toBe('1.0M')
    expect(formatTokens(12_345_678)).toBe('12M')
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(Number.NaN)).toBe('0')
    for (let n = 1; n < 999_000_000; n = Math.ceil(n * 1.37)) expect(formatTokens(n).length, `${n}`).toBeLessThanOrEqual(4)
  })

  test('formatDuration: 04:02 below an hour, 1h 12m from there', () => {
    expect(formatDuration(242_000)).toBe('04:02')
    expect(formatDuration(72 * 60_000)).toBe('1h 12m')
    expect(formatDuration(65 * 60_000)).toBe('1h 05m')
    expect(formatDuration(3_599_999)).toBe('59:59')
    expect(formatDuration(3_600_000)).toBe('1h 00m')
    expect(formatDuration(-5000)).toBe('00:00')
    expect(formatDuration(Number.NaN)).toBe('00:00')
  })

  test('formatReset: the clock within a day, the weekday within a week, the date past that', () => {
    expect(formatReset(localIso(14, 20), NOW)).toBe('↻ 14:20')
    expect(formatReset(localIso(9, 0, 3), NOW)).toBe('↻ Tue')
    expect(formatReset(localIso(0, 0, 29), NOW)).toBe('↻ Nov 1')
    expect(formatReset(localIso(11, 0), NOW)).toBe('↻ now')
    expect(formatReset('not a date', NOW)).toBe('')
  })

  test('formatCost (always two decimals) and modelLabel', () => {
    expect(formatCost(4.21)).toBe('$4.21')
    expect(formatCost(0.07)).toBe('$0.07')
    expect(formatCost(42.1)).toBe('$42.10')
    expect(formatCost(52.6)).toBe('$52.60')
    expect(formatCost(123.45)).toBe('$123.45')
    expect(formatCost(421.4)).toBe('$421.40')
    expect(formatCost(4210)).toBe('$4210.00')
    expect(formatCost(0)).toBe('$0.00')
    expect(formatCost(Number.NaN)).toBe('$0.00')
    for (let usd = 0.01; usd < 100_000; usd *= 1.9) expect(formatCost(usd), `${usd}`).toMatch(/^\$\d+\.\d\d$/)
    expect(modelLabel('claude-opus-5-5[1m]')).toBe('opus 5.5')
    expect(modelLabel('claude-sonnet-5-5-20260101')).toBe('sonnet 5.5')
    expect(modelLabel('fable')).toBe('fable')
    expect(modelLabel('gpt-6-astra')).toBe('gpt-6-astra')
  })

  test('bar: exactly `width` cells of ━ fill and ─ track, full only at 100 %', () => {
    expect(bar(41, 20)).toBe('━━━━━━━━────────────')
    expect(bar(0, 20)).toBe('─'.repeat(20))
    expect(bar(100, 20)).toBe('━'.repeat(20))
    expect(bar(250, 20)).toBe('━'.repeat(20))
    expect(bar(0.4, 20)).toBe(`━${'─'.repeat(19)}`)
    expect(bar(99.9, 20)).toBe(`${'━'.repeat(19)}─`)
    expect(bar(Number.NaN, 20)).toBe('─'.repeat(20))
    expect(bar(41, 10)).toBe('━━━━──────')
    expect(bar(41, 8)).toBe('━━━─────')
    expect(bar(41, 0)).toBe('')
    for (const width of [BAR_WIDTH, NARROW_BAR_WIDTH, SMALL_BAR_WIDTH]) {
      for (let percent = -10; percent <= 120; percent += 0.7) {
        expect([...bar(percent, width)], `${percent} @${width}`).toHaveLength(width)
        expect(displayWidth(bar(percent, width)), `${percent} @${width}`).toBe(width)
        expect(bar(percent, width), `${percent} @${width}`).toMatch(/^━*─*$/)
      }
    }
  })

  test('barWidthFor: 20 wide, 10 narrow, 8 below 44 columns, none at 36 and under', () => {
    expect(barWidthFor(100, false)).toBe(BAR_WIDTH)
    expect(barWidthFor(60, false)).toBe(BAR_WIDTH)
    expect(barWidthFor(59, true)).toBe(NARROW_BAR_WIDTH)
    expect(barWidthFor(44, true)).toBe(NARROW_BAR_WIDTH)
    expect(barWidthFor(43, true)).toBe(SMALL_BAR_WIDTH)
    expect(barWidthFor(37, true)).toBe(SMALL_BAR_WIDTH)
    expect(barWidthFor(BARLESS_AT, true)).toBe(0)
    expect(barWidthFor(20, true)).toBe(0)
  })

  test('levelColor: green below 60, yellow to 84, red from 85, as displayed', () => {
    expect(levelColor(0)).toBe('success')
    expect(levelColor(59.4)).toBe('success')
    expect(levelColor(59.5)).toBe('warning')
    expect(levelColor(84)).toBe('warning')
    expect(levelColor(84.5)).toBe('error')
    expect(levelColor(100)).toBe('error')
  })

  test('displayWidth and truncate count terminal cells', () => {
    expect(displayWidth('main')).toBe(4)
    expect(displayWidth('分支')).toBe(4)
    expect(displayWidth('████░░')).toBe(6)
    expect(truncate('feature/long-branch', 10)).toBe('feature/l…')
    expect(displayWidth(truncate('功能/很长的分支名称', 9))).toBeLessThanOrEqual(9)
    expect(truncate('short', 10)).toBe('short')
  })
})

describe('status line', () => {
  test('segments joined by │, absent facts dropped, no colour, at most 100 characters', () => {
    expect(statusLineText(full)).toBe('opus 5.5 · xhigh │ ctx 41% │ 5h 31% · 7d 12% │ $4.21 │ main* +3 −1 ↑2 │ todo 3/5')
    expect(statusLineText(sparse)).toBe('opus 5.5 · xhigh │ $0.00')
    expect(statusLineText(empty)).toBe('')
    expect(statusLineText(fullContext)).toContain('5h 92% · 7d 64% · spend 85%')
    for (const data of Object.values(FIXTURES)) {
      const line = statusLineText(data)
      expect(line.length).toBeLessThanOrEqual(100)
      expect(line).not.toMatch(/[\u0000-\u001f]/)
    }
    const crowded: HudData = {
      ...longBranch,
      session: { ...longBranch.session, model: 'a-model-whose-name-goes-on-and-on-and-on', effort: 'maximum-effort' },
    }
    expect(statusLineText(crowded).length).toBeLessThanOrEqual(100)
  })
})

describe('the HUD', () => {
  test('mounts every fixture on terminal and desktop at 100, 56 and 48 columns', async ($, on) => {
    const scene = stage(on)
    await eachDrawing($, scene, WIDTHS, (rows, { name, surface, columns }) => {
      const lines = linesFor(surface, hudLines(scene.data, { columns, isNarrow: columns < NARROW_BELOW }))
      expect(rows.map(row => row.text), `${name} @${columns}`).toEqual(lines)
      if (name === 'empty') expect(rows).toHaveLength(0)
      else expect(rows.length, `${name} @${columns}`).toBeGreaterThan(0)
    })
  })

  test('(1) the identity row is bold, the model name in the theme accent', async ($, on) => {
    stage(on)
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        const ui = await mount($, surface, columns)
        const rows = await rowsOf(ui)
        const identity = rowOf(rows, 'identity')
        expect(rows[0]?.id).toBe('identity')
        expect(identity?.text).toStartWith(`◆ ${MODEL} · xhigh`)
        expect(piece(identity, '◆')?.props).toEqual({ color: 'claude' })
        expect(piece(identity, MODEL)?.props).toEqual({ color: 'claude', bold: true })
        expect(piece(identity, 'xhigh')?.props).toEqual({ bold: true })
        expect(piece(identity, '$4.21')?.props).toEqual({ bold: true })
        await ui.unmount()
      }
    }
  })

  test('(2) bars are 20 cells wide, 10 or 8 narrow, the fill coloured by level and the track dim', async ($, on) => {
    const scene = stage(on)
    const levels: [number, string][] = [[0, 'success'], [12, 'success'], [59, 'success'], [60, 'warning'], [84, 'warning'], [85, 'error'], [100, 'error']]
    for (const surface of SURFACES) {
      for (const [percent, color] of levels) {
        scene.data = {
          ...full,
          usage: {
            ...(full.usage ?? { rateLimits: [], compactions: 0 }),
            contextPercent: percent,
            rateLimits: [
              { kind: 'five_hour', percentUsed: percent },
              { kind: 'seven_day', percentUsed: percent },
              { kind: 'spend_limit', percentUsed: percent },
            ],
          },
        }
        for (const [columns, cells] of [[100, BAR_WIDTH], [56, NARROW_BAR_WIDTH], [44, NARROW_BAR_WIDTH], [43, SMALL_BAR_WIDTH], [40, SMALL_BAR_WIDTH]] as const) {
          const ui = await mount($, surface, columns)
          const rows = await rowsOf(ui)
          for (const id of ['ctx', 'five_hour', 'seven_day', 'spend_limit']) {
            const row = rowOf(rows, id)
            const where = `${id} at ${percent} @${columns}`
            expect(row?.text.match(BAR_CELLS) ?? [], where).toHaveLength(cells)
            expect(row?.text, where).toContain(`${bar(percent, cells)} ${`${percent}%`.padStart(4)}`)
            // The fill and the track are separate spans: the fill coloured, the track dim.
            const fill = row?.pieces.find(one => one.text.includes('━'))
            if (percent > 0) expect(fill?.props, where).toEqual({ color })
            if (percent > 0) expect(fill?.text, where).toMatch(/^━+$/)
            const track = row?.pieces.find(one => one.text.includes('─'))
            if (percent < 100) expect(track?.props, where).toEqual({ dimColor: true })
            if (percent < 100) expect(track?.text, where).toMatch(/─+$/)
          }
          await ui.unmount()
        }

        // At 36 columns and under the bar goes and the percent stands alone, uncoloured.
        const barless = await mount($, surface, BARLESS_AT)
        for (const row of (await rowsOf(barless)).filter(one => ['ctx', 'five_hour', 'seven_day', 'spend_limit'].includes(one.id))) {
          expect(row.text.match(BAR_CELLS), `${row.id} at ${percent}`).toBeNull()
          expect(row.text, `${row.id} at ${percent}`).toMatch(new RegExp(`^ {2}\\S+ +${percent}%`))
          expect(row.pieces.some(one => one.props.color !== undefined), `${row.id} at ${percent}`).toBe(false)
        }
        await barless.unmount()
      }
    }
  })

  test('(3) ticking clocks change digits in fixed cells, never move a neighbour', async ($, on) => {
    const scene = stage(on)
    const skeleton = (text: string | undefined): string => (text ?? '').replace(/\d/g, '0')
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        const seen = new Map<string, string>()
        for (const later of [0, 1000, 5000, 37_000, 59_000, 600_000]) {
          scene.data = { ...full, now: NOW + later }
          const ui = await mount($, surface, columns)
          const rows = await rowsOf(ui)
          for (const id of ['identity', 'tools']) {
            const text = rowOf(rows, id)?.text
            if (text === undefined) continue
            const held = seen.get(id)
            if (held === undefined) seen.set(id, skeleton(text))
            else expect(skeleton(text), `${id} @${columns} +${later}ms`).toBe(held)
          }
          await ui.unmount()
        }
      }
    }
    // Crossing the hour widens the clock inside its cell: the cost stays put.
    const before = hudLines({ ...full, session: { ...full.session, startedAt: NOW - 3_599_000 } }, { columns: 72, isNarrow: false })[0] ?? ''
    const after = hudLines({ ...full, session: { ...full.session, startedAt: NOW - 3_601_000 } }, { columns: 72, isNarrow: false })[0] ?? ''
    expect(before.indexOf('$4.21')).toBe(after.indexOf('$4.21'))
    expect(displayWidth(before)).toBe(displayWidth(after))
    // A tool starting or stopping never reflows the counts beside it.
    const running = hudLines(full, { columns: 72, isNarrow: false }).find(line => line.includes('tools')) ?? ''
    const idle = hudLines({ ...full, tools: { counts: full.tools?.counts ?? {} } }, { columns: 72, isNarrow: false }).find(line => line.includes('tools')) ?? ''
    expect(running.startsWith(idle)).toBe(true)
  })

  test('(4) narrow shows the same sections stacked, with 10/8-cell bars', async ($, on) => {
    const scene = stage(on)
    const sections = ['identity', 'location', 'ctx', 'five_hour', 'seven_day', 'spend_limit', 'tools']
    for (const surface of SURFACES) {
      scene.data = fullContext
      const wide = await mount($, surface, 100)
      const wideIds = (await rowsOf(wide)).map(row => row.id)
      await wide.unmount()
      expect(wideIds).toEqual([...sections, 'motto'])

      for (const columns of [59, 56, 48, 44, 43, 40, 37]) {
        const ui = await mount($, surface, columns)
        const rows = await rowsOf(ui)
        // Every wide section, in the same order, one per row; the inventory
        // takes a row of its own above the motto.
        expect(rows.map(row => row.id), `@${columns}`).toEqual([...sections, 'inventory', 'motto'])
        const cells = columns < 44 ? SMALL_BAR_WIDTH : NARROW_BAR_WIDTH
        for (const id of ['ctx', 'five_hour', 'seven_day', 'spend_limit']) {
          expect(rowOf(rows, id)?.text.match(BAR_CELLS), `${id} @${columns}`).toHaveLength(cells)
        }
        // The facts the wide rows carry are all there.
        const text = rows.map(row => row.text).join('\n')
        for (const fact of ['opus 5.5', '1h 12m', '$4.21', 'main* +3 −1 ↑2', '100%', '1.0M/1.0M', '92%', '↻ 14:20', '64%', '↻ Tue', '85%', '↻ Nov 1', 'Read ×41', 'Bash ×12', 'mcp 4 · skills 12', 'ship small']) {
          expect(text, `${fact} @${columns}`).toContain(fact)
        }
        expect(rowOf(rows, 'inventory')?.text).toBe('  mcp 4 · skills 12')
        expect(rowOf(rows, 'location')?.text).toBe('  ~/.claude/mods · main* +3 −1 ↑2')
        await ui.unmount()
      }
    }

    // The provider stays while the row has room for it, and gives way first.
    expect(hudLines(full, { columns: 56, isNarrow: true })[0]).toContain('· gateway')
    expect(hudLines(full, { columns: 44, isNarrow: true })[0]).not.toContain('gateway')
    expect(hudLines(full, { columns: 44, isNarrow: true })[0]).toContain('opus 5.5 · xhigh')
    // The running tool keeps its own cell while the counts still have room, its
    // right edge in line with the identity row's, clear of the close button.
    const tools = hudLines(full, { columns: 56, isNarrow: true }).find(line => line.startsWith('  tools')) ?? ''
    expect(tools).toMatch(/^ {2}tools Read ×41 Bash ×12 \+3 +● Bash 00:04$/)
    expect(displayWidth(tools)).toBe(56 - CLOSE_RESERVE)
  })

  test('narrow at 40 columns: the full sketch, every section stacked', () => {
    expect(hudLines(full, { columns: 40, isNarrow: true })).toEqual([
      '◆ opus 5.5 · xhigh      1h 12m   $4.21',
      '  ~/.claude/mods · main* +3 −1 ↑2',
      '  ctx   ━━━─────  41%  412k/1.0M',
      '  5h    ━━──────  31%  ↻ 14:20',
      '  7d    ━───────  12%  ↻ Tue',
      '  tools Read ×41 Bash ×12 Edit ×9 +2',
      '  mcp 4 · skills 12',
      '  ship small, ship often',
    ])
  })

  test('narrow at 36 columns: no bars or pips, the percent and the tally stand alone', () => {
    expect(hudLines(full, { columns: 36, isNarrow: true })).toEqual([
      '◆ opus 5.5          1h 12m   $4.21',
      '  ~/.claude/mods · main* +3 −1 ↑2',
      '  ctx    41%  412k/1.0M',
      '  5h     31%  ↻ 14:20',
      '  7d     12%  ↻ Tue',
      '  tools Read ×41 Bash ×12 Edit ×9 +2',
      '  mcp 4 · skills 12',
      '  ship small, ship often',
    ])
    expect(hudLines(fullContext, { columns: 36, isNarrow: true })[2]).toBe('  ctx   100%  1.0M/1.0M')
  })

  test('the identity row stops two cells short of the close button at every width', () => {
    const cost = { ...full, usage: { ...(full.usage ?? { rateLimits: [], compactions: 0 }), costUsd: 123.45 } }
    // With no identity to draw, whichever row comes first keeps the reserve.
    const placeOnly: HudData = { session: { cwd: '/Users/someone/a/path/long/enough/to/fill/any/pane/it/is/drawn/into' }, git: { branch: 'main', dirty: true }, now: NOW }
    for (const data of [...Object.values(FIXTURES), cost, placeOnly]) {
      for (const columns of EVERY_WIDTH) {
        const lines = hudLines(data, { columns, isNarrow: columns < NARROW_BELOW })
        if (lines.length === 0) continue
        const first = lines[0] ?? ''
        if (data !== placeOnly) expect(first, `@${columns}`).toStartWith('◆')
        expect(displayWidth(first), `@${columns}: ${first}`).toBeLessThanOrEqual(columns - CLOSE_RESERVE)
      }
    }
    expect(hudLines(placeOnly, { columns: 40, isNarrow: true })).toEqual(['  …/any/pane/it/is/drawn/into · main*'])
    // The cost is never under the close button, however long it grows.
    for (const columns of [40, 48, 56, 60, 72]) {
      const first = hudLines(cost, { columns, isNarrow: columns < NARROW_BELOW })[0] ?? ''
      expect(first, `@${columns}`).toEndWith('$123.45')
      expect(displayWidth(first), `@${columns}`).toBe(Math.min(columns, 72 + CLOSE_RESERVE) - CLOSE_RESERVE)
    }
    // Right-aligned cells share the reserve; from 74 columns the card is whole.
    expect(displayWidth(hudLines(full, { columns: 72, isNarrow: false })[1] ?? '')).toBe(70)
    expect(displayWidth(hudLines(full, { columns: 74, isNarrow: false })[0] ?? '')).toBe(72)
    expect(hudLines(full, { columns: 40, isNarrow: true })[0]).toBe('◆ opus 5.5 · xhigh      1h 12m   $4.21')
  })

  test('right-aligned cells share the identity edge at 60 through 73 columns', () => {
    for (let columns = 60; columns <= 73; columns += 1) {
      const data = { ...full, usage: { ...full.usage!, contextTokens: undefined } }
      const lines = hudLines(data, { columns, isNarrow: false })
      const edge = displayWidth(lines[0] ?? '')
      for (const suffix of ['skills 12', 'compactions', '● Bash 00:04']) {
        const row = lines.find(line => line.endsWith(suffix))
        expect(row, `${suffix} @${columns}`).toBeDefined()
        expect(displayWidth(row ?? ''), `${suffix} @${columns}`).toBe(edge)
      }
    }
  })

  test('(5) a missing fact hides its row instead of printing zeros', async ($, on) => {
    const scene = stage(on, sparse)
    for (const surface of SURFACES) {
      const ui = await mount($, surface, 100)
      const rows = await rowsOf(ui)
      expect(rows.map(row => row.id)).toEqual(['identity', 'ctx'])
      expect(rowOf(rows, 'ctx')?.text).toBe('  ctx   —')
      await ui.unmount()

      const narrow = await mount($, surface, 48)
      const narrowRows = await rowsOf(narrow)
      expect(narrowRows.map(row => row.id)).toEqual(['identity', 'ctx'])
      expect(rowOf(narrowRows, 'ctx')?.text).toBe('  ctx   —')
      await narrow.unmount()

      scene.data = empty
      const none = await mount($, surface, 100)
      expect(await rowsOf(none)).toHaveLength(0)
      await none.unmount()

      // No limits, no git, no inventory, no tools: those rows go, the rest stay.
      scene.data = { ...full, usage: { ...(full.usage ?? { compactions: 0, rateLimits: [] }), rateLimits: [] }, git: {}, inventory: { mcpServers: [] }, tools: { counts: {} } }
      const bare = await mount($, surface, 100)
      const left = await rowsOf(bare)
      expect(left.map(row => row.id)).toEqual(['identity', 'location', 'ctx', 'motto'])
      expect(rowOf(left, 'location')?.text).toBe('  ~/.claude/mods')
      await bare.unmount()
      scene.data = sparse
    }
    await eachDrawing($, scene, WIDTHS, rows => {
      for (const row of rows) expect(row.text).not.toMatch(/mcp 0|skills 0|[+~−↑↓×]0\b|0 compactions/)
    })
  })

  test('(6) the HUD draws with no agents at all', async ($, on) => {
    const scene = stage(on)
    scene.agents = 0
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        const ui = await mount($, surface, columns, 20)
        const rows = await rowsOf(ui)
        expect(rows.map(row => row.text)).toEqual(linesFor(surface, hudLines(full, { columns, isNarrow: columns < NARROW_BELOW })))
        expect((await ui.find({ type: 'Text', text: 'No agents yet.' }))?.text).toBe('No agents yet.')
        await ui.unmount()
      }
    }
  })

  test('(7) the HUD never shrinks while many agents run', async ($, on) => {
    const scene = stage(on)
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        scene.agents = 0
        const quiet = await mount($, surface, columns, 12)
        const alone = (await rowsOf(quiet)).map(row => row.text)
        await quiet.unmount()

        scene.agents = 60
        const busy = await mount($, surface, columns, 12)
        expect((await rowsOf(busy)).map(row => row.text)).toEqual(alone)
        const root = await busy.find({ type: 'Box', key: 'hud' })
        expect(root?.props.flexShrink).toBe(0)
        for (const row of await busy.findAll({ type: 'Box' })) {
          if (row.key?.startsWith('hud:') === true) expect(row.props.flexShrink).toBe(0)
        }
        await busy.unmount()
      }
    }
  })

  test('(8) dim for the secondary, bold for the headline, colour only on bars, glyphs and the model', async ($, on) => {
    const scene = stage(on)
    await eachDrawing($, scene, WIDTHS, async (rows, { name, columns }) => {
      for (const row of rows) {
        for (const one of row.pieces) {
          const where = `${name} @${columns} ${row.id}: ${JSON.stringify(one.text)}`
          expect(one.props.backgroundColor, where).toBeUndefined()
          expect(one.props.inverse, where).toBeUndefined()
          if (one.props.color !== undefined) {
            expect(THEME_KEYS, where).toContain(one.props.color)
            expect(/^[━◆●◐*]+$/.test(one.text) || one.text === MODEL, where).toBe(true)
          }
          if (one.props.bold === true) expect(row.id, where).toBe('identity')
          if (one.props.dimColor === true) expect(one.props.bold, where).toBeUndefined()
        }
      }
    })
    scene.data = full
    for (const surface of SURFACES) {
      const ui = await mount($, surface, 100)
      const rows = await rowsOf(ui)
      for (const [id, text] of [
        ['identity', 'gateway'], ['identity', '1h 12m'], ['location', '~/.claude/mods'], ['location', 'mcp 4'],
        ['ctx', 'ctx'], ['ctx', '─'], ['ctx', '412k / 1.0M'], ['ctx', '3 compactions'], ['five_hour', '↻ 14:20'],
        ['tools', 'tools'], ['tools', '×41'], ['tools', '00:04'],
      ] as const) {
        expect(piece(rowOf(rows, id), text)?.props.dimColor, `${id}: ${text}`).toBe(true)
      }
      expect(piece(rowOf(rows, 'location'), '*')?.props).toEqual({ color: 'warning' })
      expect(piece(rowOf(rows, 'tools'), '●')?.props).toEqual({ color: 'claude' })
      await ui.unmount()
    }
  })

  test('(9) no row is wider than the pane at any width from 20 to 130; long text ends in …', { timeoutMs: 60_000 }, async ($, on) => {
    const scene = stage(on)
    await eachDrawing($, scene, EVERY_WIDTH, (rows, { name, surface, columns }) => {
      for (const row of rows) {
        expect(displayWidth(row.text), `${name} ${surface} @${columns} ${row.id}: ${row.text}`).toBeLessThanOrEqual(columns)
        expect(displayWidth(row.text), `${name} @${columns} ${row.id}`).toBeLessThanOrEqual(72)
        expect(row.text).not.toMatch(/[\u0000-\u001f]/)
      }
    })

    scene.data = longBranch
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        const ui = await mount($, surface, columns)
        const rows = await rowsOf(ui)
        const location = rowOf(rows, 'location')?.text ?? ''
        expect(location, `@${columns}`).toMatch(/feature\/very-long-[^ ]*…\* \+3 −1 ↑2$/)
        expect(rowOf(rows, 'motto')?.text, `@${columns}`).toEndWith('…')
        expect(todoLines(longBranch.todos, columns).find(line => line.includes('Rewriting')), `@${columns}`).toMatch(/Rewriting the reconcil.*…$/)
        await ui.unmount()
      }
    }

    // Wide characters count two cells.
    scene.data = { ...longBranch, git: { branch: '功能/很长的分支名称-一直写下去-直到超出窗格的宽度', dirty: true } }
    for (const columns of [56, 48]) {
      const ui = await mount($, 'terminal', columns)
      for (const row of await rowsOf(ui)) expect(displayWidth(row.text), row.text).toBeLessThanOrEqual(columns)
      await ui.unmount()
    }
  })

  test('(10) the motto is the last row, dim and italic, and only when given', async ($, on) => {
    const scene = stage(on)
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        scene.data = full
        const ui = await mount($, surface, columns)
        const rows = await rowsOf(ui)
        expect(rows.at(-1)?.id).toBe('motto')
        expect(rows.at(-1)?.text).toBe('  ship small, ship often')
        expect(piece(rows.at(-1), 'ship')?.props).toEqual({ dimColor: true, italic: true })
        await ui.unmount()

        scene.data = { ...full, motto: undefined }
        const plainUi = await mount($, surface, columns)
        expect(rowOf(await rowsOf(plainUi), 'motto')).toBeUndefined()
        await plainUi.unmount()
      }
    }
  })

  test('a short pane gives the HUD half its rows, dropping the least needed first', () => {
    const wide = (rows?: number) => hudLines(fullContext, { columns: 100, rows, isNarrow: false })
    expect(wide()).toHaveLength(8)
    expect(wide(40)).toHaveLength(8)
    const twelve = wide(12)
    expect(twelve).toHaveLength(6)
    expect(twelve.some(line => line.includes('ship small'))).toBe(false)
    expect(twelve.some(line => line.includes('tools'))).toBe(false)
    expect(twelve.some(line => line.includes('ctx'))).toBe(true)
    expect(wide(4)).toHaveLength(4)
    expect(wide(4)[0]).toStartWith('◆')
    expect(hudLines(full, { columns: 48, rows: 4, isNarrow: true })).toHaveLength(4)

    // Narrow drops the motto, the inventory, tools, then the place; never identity or ctx.
    // (The todo list is a section of its own under the HUD.)
    const narrow = (rows?: number) => hudLines(fullContext, { columns: 40, rows, isNarrow: true })
    const has = (lines: string[], text: string): boolean => lines.some(line => line.includes(text))
    expect(narrow()).toHaveLength(9)
    expect(narrow(18)).toHaveLength(9)
    expect(has(narrow(16), 'ship small')).toBe(false)
    expect(has(narrow(16), 'mcp 4')).toBe(true)
    expect(has(narrow(14), 'mcp 4')).toBe(false)
    expect(has(narrow(14), 'tools')).toBe(true)
    expect(has(narrow(12), 'tools')).toBe(false)
    expect(has(narrow(12), '~/.claude/mods')).toBe(true)
    expect(has(narrow(10), '~/.claude/mods')).toBe(false)
    expect(has(narrow(10), 'spend')).toBe(true)
    for (const rows of [4, 6, 8, 10, 12, 14, 16, 18, 20]) {
      const lines = narrow(rows)
      expect(lines, `rows ${rows}`).toHaveLength(Math.min(9, Math.max(4, rows / 2)))
      expect(lines[0], `rows ${rows}`).toStartWith('◆')
      expect(has(lines, 'ctx'), `rows ${rows}`).toBe(true)
    }
  })

  test('many tools: the busiest first, the rest counted, MCP names kept readable', () => {
    const lines = hudLines(manyTools, { columns: 72, isNarrow: false })
    const tools = lines.find(line => line.startsWith('  tools')) ?? ''
    expect(tools).toMatch(/^ {2}tools Read ×141 {2}Bash ×96 {2}Edit ×52 {2}\+12 +● browser_tak… 01:05$/)
    expect(displayWidth(tools)).toBe(70)
  })

  test('a full context window reads 100 % on a full red bar', () => {
    const ctx = hudLines(fullContext, { columns: 72, isNarrow: false }).find(line => line.startsWith('  ctx')) ?? ''
    expect(ctx).toContain(`${'━'.repeat(20)} 100%  1.0M / 1.0M`)
    expect(hudLines(fullContext, { columns: 48, isNarrow: true })[2]).toBe(`  ctx   ${'━'.repeat(10)} 100%  1.0M/1.0M`)
    expect(hudLines(fullContext, { columns: 40, isNarrow: true })[2]).toBe(`  ctx   ${'━'.repeat(8)} 100%  1.0M/1.0M`)
  })
})

// ---------------------------------------------------------------------------
// The TODO section: its own rows between the HUD and the agents.
// ---------------------------------------------------------------------------

describe('the tokens', () => {
  const tokens = { input: 1_234_000, output: 84_000, cacheRead: 9_800_000, cacheWrite: 640_000 }
  const counted: HudData = { ...full, usage: { ...(full.usage ?? { rateLimits: [], compactions: 0 }), tokens } }

  test('two rows under the limits: in and out with the total, the cache read and written with its hit rate, the counts in columns', () => {
    const lines = hudLines(counted, { columns: 72, isNarrow: false })
    const tok = lines.findIndex(line => line.startsWith('  tok '))
    const cache = lines.findIndex(line => line.startsWith('  cache '))
    expect(tok).toBe(lines.findIndex(line => line.startsWith('  7d ')) + 1)
    expect(cache).toBe(tok + 1)
    expect(lines[tok]).toMatch(/^  tok   1\.2M in     84k out {2,}12M total$/)
    expect(lines[cache]).toMatch(/^  cache 9\.8M read  640k write {2,}84% hit$/)
    // The second counts share a column; the right-hand cells end at the identity's edge.
    expect(lines[tok]!.indexOf('84k out')).toBe(lines[cache]!.indexOf('640k write') + 1)
    expect(displayWidth(lines[tok]!)).toBe(72 - CLOSE_RESERVE)
    expect(displayWidth(lines[cache]!)).toBe(72 - CLOSE_RESERVE)
    // Narrow, the same two rows; at any width none wider than the pane.
    const narrow = hudLines(counted, { columns: 48, isNarrow: true })
    expect(narrow.some(line => line.startsWith('  tok   1.2M in     84k out'))).toBe(true)
    expect(narrow.some(line => line.startsWith('  cache 9.8M read  640k write'))).toBe(true)
    for (const columns of EVERY_WIDTH) {
      for (const line of hudLines(counted, { columns, isNarrow: columns < NARROW_BELOW })) expect(displayWidth(line), `${columns}: ${line}`).toBeLessThanOrEqual(columns)
    }
  })

  test('no tokens yet, no rows; no cache used, no cache row; a short pane drops them before tools', () => {
    expect(hudLines(full, { columns: 72, isNarrow: false }).some(line => /^ {2}(tok|cache) /.test(line))).toBe(false)
    const zero = { ...counted, usage: { ...counted.usage!, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } }
    expect(hudLines(zero, { columns: 72, isNarrow: false }).some(line => /^ {2}(tok|cache) /.test(line))).toBe(false)
    const uncached = { ...counted, usage: { ...counted.usage!, tokens: { ...tokens, cacheRead: 0, cacheWrite: 0 } } }
    const lines = hudLines(uncached, { columns: 72, isNarrow: false })
    expect(lines.some(line => line.startsWith('  tok   1.2M in     84k out'))).toBe(true)
    expect(lines.some(line => line.startsWith('  cache '))).toBe(false)
    // Half of 14 rows: identity, ctx, the limits, the place, then tools; the tokens give way first.
    const short = hudLines(counted, { columns: 100, rows: 14, isNarrow: false })
    expect(short.some(line => line.startsWith('  tools'))).toBe(true)
    expect(short.some(line => line.startsWith('  cache '))).toBe(false)
  })

  test('mounted: each a row of its own, the kinds and the right-hand words dim, the counts plain', async ($, on) => {
    stage(on, counted)
    for (const surface of SURFACES) {
      const ui = await mount($, surface, 100)
      const rows = await rowsOf(ui)
      for (const [id, text] of [['tokens', 'tok'], ['tokens', ' in'], ['tokens', ' out'], ['tokens', ' total'], ['cache', 'cache'], ['cache', ' read'], ['cache', ' write'], ['cache', ' hit']] as const) {
        expect(piece(rowOf(rows, id), text)?.props.dimColor, `${id}: ${text}`).toBe(true)
      }
      expect(piece(rowOf(rows, 'tokens'), '1.2M')?.props).toEqual({})
      expect(piece(rowOf(rows, 'cache'), '84%')?.props).toEqual({})
      await ui.unmount()
    }
  })
})

describe('the TODO section', () => {
  test('in progress first (its active form), then pending, then completed; ☑ ◐ ☐; two cells in', () => {
    expect(todoLines(sevenTodos, 72, 10)).toEqual([
      'TODO:',
      '  ◐ Wiring the detail view',
      '  ☐ Test the scenes',
      '  ☐ Update the sprite sheet',
      '  ☐ Sketch the pane at 72 and 48 columns',
      '  ☑ Read the brief',
      '  ☑ Split the sprites out',
      '  ☑ Write the choreography',
    ])
    // An in-progress item without an active form shows its content.
    expect(todoLines({ items: [{ content: 'Plain', status: 'in_progress' }] }, 40)).toEqual(['TODO:', '  ◐ Plain'])
  })

  test('capped at todoRows (6 by default) with a dim +n more; all done shows them all struck, up to the cap', () => {
    expect(TODO_ROWS).toBe(6)
    const capped = todoLines(sevenTodos, 72)
    expect(capped).toHaveLength(1 + 6 + 1)
    expect(capped.at(-1)).toBe('  +1 more')
    expect(todoLines(sevenTodos, 72, 3).at(-1)).toBe('  +4 more')
    expect(todoRows(allDone, 72).filter(row => row.status === 'completed')).toHaveLength(6)
    expect(todoLines(allDone, 72, 10).slice(1).every(line => line.startsWith('  ☑ '))).toBe(true)
    expect(todoLines({ items: [] }, 72)).toEqual([])
    expect(todoLines(undefined, 72)).toEqual([])
  })

  test('no row is wider than the pane from 20 to 130 columns; a long item ends in …', () => {
    for (const columns of EVERY_WIDTH) {
      for (const todos of [sevenTodos, allDone, longBranch.todos, full.todos]) {
        for (const line of todoLines(todos, columns)) expect(displayWidth(line), `@${columns}: ${line}`).toBeLessThanOrEqual(columns)
      }
      const long = todoLines(sevenTodos, columns).find(line => line.includes('Sketch the pane'))
      if (long !== undefined && columns < 40) expect(long).toEndWith('…')
    }
  })

  test('mounted: a bold TODO: header, completed struck through and dim, ◐ in the accent, +n more dim', async ($, on) => {
    on('ui.render', { component: 'Pane', requestId: 'todos-under-test' }, ($$, e) => {
      const table = $$.ui.resolve(e)

      return renderTodos(elementsFor(e.surface, table), sevenTodos, { columns: e.props.bodyColumns }).element ?? table.Box({})
    })
    for (const surface of SURFACES) {
      for (const columns of [72, 48]) {
        const ui = await $.ui.mount({ plugin: 'mod-hud', surface, component: 'Pane', requestId: 'todos-under-test', props: { ...PANE_PROPS, bodyColumns: columns }, viewport: VIEWPORT })
        if (surface === 'desktop') {
          // In pixels: each row its own Svg, read back to the same text and looks.
          const row = async (key: string) => {
            const source = rowSource(await ui.find({ key })) ?? ''

            return { text: textLine(source), pieces: textPieces(source) }
          }
          const header = await row('todo:header')
          expect(header).toEqual({ text: 'TODO:', pieces: [{ text: 'TODO:', props: { bold: true } }] })
          expect((await row('todo:0')).pieces).toEqual([{ text: '  ', props: {} }, { text: '☑ Read the brief', props: { dimColor: true, strikethrough: true } }])
          expect((await row('todo:1')).text).toBe('  ☑ Split the sprites out')
          expect((await row('todo:1')).pieces.at(-1)?.props).toEqual({ dimColor: true, strikethrough: true })
          const doing = await row('todo:3')
          expect(doing.text).toBe('  ◐ Wiring the detail view')
          expect(doing.pieces.find(one => one.text === '◐')?.props).toEqual({ color: 'claude' })
          expect(doing.pieces.find(one => one.text.includes('Wiring'))?.props).toEqual({})
          expect((await row('todo:more')).pieces.at(-1)).toEqual({ text: '+1 more', props: { dimColor: true } })
          expect(await ui.findAll({ type: 'Text' })).toEqual([])
          await ui.unmount()
          continue
        }
        const header = await ui.find({ key: 'todo:header' })
        expect(header?.text).toBe('TODO:')
        expect((header?.children[0] as { props?: Record<string, unknown> })?.props?.bold).toBe(true)
        const done = await ui.find({ key: 'todo:0' })
        const struck = (await ui.findAll({ type: 'Text' })).filter(one => one.props.strikethrough === true)
        expect(struck.map(one => one.text)).toEqual(['  ☑ Read the brief', '  ☑ Split the sprites out'])
        expect(struck.every(one => one.props.dimColor === true)).toBe(true)
        expect(done?.text).toBe('  ☑ Read the brief')
        const doing = await ui.find({ key: 'todo:3' })
        expect(doing?.text).toBe('  ◐ Wiring the detail view')
        expect((await ui.findAll({ type: 'Text' })).find(one => one.text === '  ◐ ')?.props.color).toBe('claude')
        expect((await ui.find({ key: 'todo:more' }))?.text).toBe('  +1 more')
        expect(await ui.findAll({ type: 'Svg' })).toEqual([])
        await ui.unmount()
      }
    }
  })
})

test('the motto is the HUD\'s last row and never a HUD of its own', () => {
  const layout = { columns: 72, isNarrow: false }
  expect(hudLines({ ...empty, motto: 'keep going' }, layout)).toEqual([])
  expect(hudLines({ ...sparse, motto: 'keep going' }, layout).at(-1)).toBe('  keep going')
  expect(hudLines({ ...sparse, motto: 'keep going' }, layout)).toHaveLength(hudLines(sparse, layout).length + 1)
})

// ---------------------------------------------------------------------------
// The desktop: its pane sets text in a proportional font, so the HUD and the
// TODO section are drawn in pixels, a row an Svg (hooks/text-svg.ts).
// ---------------------------------------------------------------------------

describe('in pixels on the desktop', () => {
  test('each HUD row is one Svg on the scene\'s 8×16 grid, as wide as it draws and a row high; no Text; the terminal keeps its Texts', async ($, on) => {
    const scene = stage(on, fullContext)
    for (const columns of WIDTHS) {
      const ui = await mount($, 'desktop', columns)
      const boxes = (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('hud:') === true)
      expect(boxes.length, `@${columns}`).toBe(hudLines(scene.data, { columns, isNarrow: columns < NARROW_BELOW }).length)
      expect(await ui.findAll({ type: 'Text' })).toEqual([])
      for (const box of boxes) {
        const where = `${box.key} @${columns}`
        const svgs = svgsOf(box)
        expect(svgs, where).toHaveLength(1)
        expect(box.props.height, where).toBe(1)
        expect(box.props.flexShrink, where).toBe(0)
        const source = String(svgs[0]?.props?.source ?? '')
        const size = textSvgSize(source)
        expect(svgs[0]?.props?.width, where).toBe(size.width)
        expect(svgs[0]?.props?.height, where).toBe(CELL_HEIGHT)
        expect(size.rows, where).toBe(1)
        // As wide as the row's last drawn cell, never wider than the pane.
        const runs = textRuns(source)
        const end = Math.max(...runs.map(run => run.x + displayWidth(run.text)))
        expect(size.width, where).toBe(end * CELL_WIDTH)
        expect(size.columns, where).toBeLessThanOrEqual(columns)
        expect(source.length, where).toBeLessThan(SVG_MAX)
        expect(source, where).toContain(`font-family='ui-monospace,Menlo,Consolas,monospace' font-size='13'`)
        expect(source, where).toContain(`pointer-events='none'`)
        // Every run of more than one character is stretched to exactly its cells.
        for (const match of source.matchAll(/<text x='([\d.]+)' y='12'(?: textLength='([\d.]+)')?[^>]*>([^<]*)<\/text>/g)) {
          const text = (match[3] ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
          if ([...text].length > 1) expect(Number(match[2]), `${where}: ${text}`).toBe(displayWidth(text) * CELL_WIDTH)
          expect(Number(match[1]) % CELL_WIDTH, `${where}: ${text}`).toBe(0)
        }
        expect(String(svgs[0]?.props?.alt ?? ''), where).not.toBe('')
      }
      await ui.unmount()
    }
    const terminal = await mount($, 'terminal', 100)
    expect(await terminal.findAll({ type: 'Svg' })).toEqual([])
    expect((await terminal.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('hud:') === true).every(box => (box.children[0] as { type?: string })?.type === 'Text')).toBe(true)
    await terminal.unmount()
  })

  test('colours are the theme\'s, by class (the light scheme recolours them), dim is opacity, bold and italic are the font\'s; bars are rects', async ($, on) => {
    stage(on, full)
    const ui = await mount($, 'desktop', 100)
    const source = async (id: string): Promise<string> => rowSource(await ui.find({ key: `hud:${id}` })) ?? ''
    const identity = await source('identity')
    expect(identity).toContain(`<g class='a' fill='${SCENE_THEMES.dark.claude}' font-weight='bold'><text x='16' y='12' textLength='64'>opus 5.5</text>`)
    expect(identity).toContain(`.a{fill:${SCENE_THEMES.light.claude}}`)
    expect(identity).toMatch(/<style>@media \(prefers-color-scheme:light\)\{[^<]*\}<\/style>/)
    // ctx at 41 %: eight cells of fill, a thick rect in the success colour; twelve of track, a thin dim one.
    const ctx = await source('ctx')
    expect(ctx).toContain(`<g class='g' fill='${SCENE_THEMES.dark.success}'><rect x='64' y='7' width='64' height='3'/></g>`)
    expect(ctx).toMatch(new RegExp(`<g class='f' fill='${SCENE_THEMES.dark.text}' opacity='\\.55'>[^]*<rect x='128' y='8' width='96' height='1'/>`))
    expect(ctx).not.toContain('━')
    expect(ctx).not.toContain('─')
    // The motto is dim and italic.
    expect(await source('motto')).toContain(`opacity='.55' font-style='italic'`)
    expect(textRuns(await source('motto'))).toEqual([{ x: 2, text: 'ship small, ship often', props: { dimColor: true, italic: true } }])
    // The alt is the row in words, its bars left out.
    const ctxSvg = svgsOf(await ui.find({ key: 'hud:ctx' }))[0]
    expect(ctxSvg?.props?.alt).toBe('ctx 41% 412k / 1.0M 3 compactions')
    await ui.unmount()
  })
})
