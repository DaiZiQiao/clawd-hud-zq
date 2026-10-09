import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine, FoundElement } from 'claude-code/testing'

import type { HudData } from '../types'
import type { HudElements } from './hud'
import {
  BARLESS_AT,
  BAR_WIDTH,
  CLOSE_RESERVE,
  COMPACT_SOON_TURNS,
  GUTTER,
  NARROW_BAR_WIDTH,
  NARROW_GUTTER,
  NARROW_SUB_WIDTH,
  RANKS,
  SECTIONS,
  SMALL_BAR_WIDTH,
  SUB_WIDTH,
  TODO_ROWS,
  alertsOf,
  bar,
  barWidthFor,
  cacheCoolAt,
  cacheStateOf,
  compactRunway,
  formatAgo,
  formatCost,
  formatDuration,
  formatIdle,
  formatLeft,
  formatReset,
  formatSpan,
  formatTokens,
  levelColor,
  modelLabel,
  renderTodos,
  statusLineText,
  todoRows,
  whenOf,
} from './hud'
import { displayWidth, truncate } from './text-width'
import {
  AT_5H,
  AT_7D,
  AT_OUT_5H,
  AT_SPEND,
  FIXTURES,
  NOW,
  RESET_5H,
  RESET_7D,
  RESET_SPEND,
  TIGHT_5H,
  alarmed,
  allDone,
  calm,
  coldCache,
  coolingCache,
  empty,
  full,
  fullContext,
  hudLines,
  hudRowIds,
  longBranch,
  manyTools,
  renderHud,
  sevenTodos,
  sparse,
  todoLines,
} from './hud.fixtures'
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
/** A bar's cells: the fill, the empty track, and the auto-compact threshold's mark. */
const BAR_CELLS = /[━─┃]/g
/** The 5h alert as the full sketch draws it, on this zone's clock. */
const OUT_ALERT = `5h out ~${AT_OUT_5H}, before ${TIGHT_5H}`
const MINUTE = 60_000
/** Where a section row's value starts: after the gutter and the sub-label. */
const VALUE_AT = GUTTER + SUB_WIDTH
const NARROW_VALUE_AT = NARROW_GUTTER + NARROW_SUB_WIDTH
/** The gauges: the context used and the three limits. */
const GAUGES = ['context.used', 'limits.5h', 'limits.7d', 'limits.spend']

/** The rows as plain text keyed by id. */
const rowsById = (data: HudData, columns = 72, rows?: number): Record<string, string> => {
  const layout = { columns, rows, isNarrow: columns < NARROW_BELOW }
  const ids = hudRowIds(data, layout)
  const lines = hudLines(data, layout)

  return Object.fromEntries(ids.map((id, index) => [id, lines[index] ?? '']))
}

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
    // The labels as this zone's clock reads the resets: `↻ 14:20`, `↻ Tue` and `↻ Nov 1` in UTC.
    expect(AT_5H).toMatch(/^↻ \d\d:\d\d$/)
    expect(formatReset(RESET_5H, NOW)).toBe(AT_5H)
    expect(formatReset(RESET_7D, NOW)).toBe(AT_7D)
    expect(formatReset(RESET_SPEND, NOW)).toBe(AT_SPEND)
    expect(formatReset(new Date(NOW - 60 * 60_000).toISOString(), NOW)).toBe('↻ now')
    expect(formatReset('not a date', NOW)).toBe('')
    // The same moments, bare: the alert strip's `~13:43` and `↻14:20`.
    expect(`↻ ${whenOf(Date.parse(RESET_5H), NOW)}`).toBe(AT_5H)
    expect(whenOf(NOW - 1, NOW)).toBe('now')
  })

  test('formatIdle: seconds, then minutes, then hours and minutes', () => {
    expect(formatIdle(45_000)).toBe('45s')
    expect(formatIdle(3 * 60_000)).toBe('3m')
    expect(formatIdle(59 * 60_000 + 59_000)).toBe('59m')
    expect(formatIdle(65 * 60_000)).toBe('1h 05m')
    expect(formatIdle(-1)).toBe('0s')
    expect(formatIdle(Number.NaN)).toBe('0s')
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

  test('formatSpan, formatAgo and formatLeft: a turn\'s length, a commit\'s age, a countdown', () => {
    expect(formatSpan(42_000)).toBe('42s')
    expect(formatSpan(72_000)).toBe('1m 12s')
    expect(formatSpan(65 * MINUTE)).toBe('1h 05m')
    expect(formatSpan(-1)).toBe('0s')
    expect(formatAgo(30_000)).toBe('just now')
    expect(formatAgo(48 * MINUTE)).toBe('48m ago')
    expect(formatAgo(3 * 60 * MINUTE + 5)).toBe('3h ago')
    expect(formatAgo(50 * 60 * MINUTE)).toBe('2d ago')
    expect(formatAgo(Number.NaN)).toBe('just now')
    expect(formatLeft(45_000)).toBe('45s')
    expect(formatLeft(90_000)).toBe('2m')
    expect(formatLeft(42 * MINUTE)).toBe('42m')
    expect(formatLeft(60 * MINUTE)).toBe('1h')
    expect(formatLeft(0)).toBe('0s')
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
  test('segments joined by │, absent facts dropped, no colour, at most 100 characters; the cache last, when it fits', () => {
    expect(statusLineText(full)).toBe('opus 5.5 · xhigh │ ⚠ 2 │ ctx 41% │ 5h 31% · 7d 12% │ $4.21 │ main* +3 −1 ↑2 │ todo 3/5 │ cache 42m')
    // `⚠ n` counts the alert strip's alerts, right after who; none, no segment.
    expect(statusLineText(alarmed)).toStartWith('opus 5.5 · xhigh │ ⚠ 6 │ ctx 70%')
    expect(statusLineText(calm)).toBe('opus 5.5 · xhigh │ ctx 41% │ 5h 31% · 7d 12% │ $4.21 │ main* +3 −1 ↑2 │ todo 3/5 │ cache 42m')
    expect(statusLineText(coldCache)).toEndWith(' │ todo 3/5 │ cache cold')
    expect(statusLineText(coolingCache)).toStartWith('opus 5.5 · xhigh │ ⚠ 1 │')
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
    // The cache is the first to give way.
    expect(statusLineText(crowded)).not.toContain('cache')
  })
})

/** The 72-column sketch: docs/pane-sketch.md, the README and the PR draw it. */
const SKETCH_72 = [
  '◆ opus 5.5 · xhigh · gateway                           ● working 00:42',
  `  ⚠ 2 agents waiting for permission · ${OUT_ALERT}`,
  '',
  ' session  repo    ~/.claude/mods',
  '          branch  main* ↑2   +142 −37 lines · last commit 48m ago',
  '          now     Bash · npm test -- hud                         00:04',
  ' context  used    ━━━━━━━━────────┃───  41%   412k / 1.0M',
  '          growth  +65k / turn        compact in ~6 turns',
  '          cache   ━━━━━━━━━━━━━━──────  warm · 42m left (1h)',
  ` limits   5h      ━━━━━━──────────────  31%   ${AT_5H}   out ~${AT_OUT_5H}`,
  `          7d      ━━──────────────────  12%   ${AT_7D}`,
  ' usage    cost    $4.21              $3.51 / h · 1h 12m',
  '          last    $0.38              1m 12s · 24k tokens',
  '          cache   87% hit            agents 38% of spend',
]

/** The ids of the sketch's rows, top to bottom. */
const SKETCH_IDS = [
  'header', 'alerts', 'gap',
  'session.repo', 'session.branch', 'session.now',
  'context.used', 'context.growth', 'context.cache',
  'limits.5h', 'limits.7d',
  'usage.cost', 'usage.last', 'usage.cache',
]

describe('the HUD', () => {
  test('mounts every fixture on terminal and desktop at 100, 56 and 48 columns', { timeoutMs: 20_000 }, async ($, on) => {
    const scene = stage(on)
    await eachDrawing($, scene, WIDTHS, (rows, { name, surface, columns }) => {
      const lines = linesFor(surface, hudLines(scene.data, { columns, isNarrow: columns < NARROW_BELOW }))
      expect(rows.map(row => row.text), `${name} @${columns}`).toEqual(lines)
      expect(rows.map(row => row.id), `${name} @${columns}`).toEqual(hudRowIds(scene.data, { columns, isNarrow: columns < NARROW_BELOW }))
      if (name === 'empty') expect(rows).toHaveLength(0)
      else expect(rows.length, `${name} @${columns}`).toBeGreaterThan(0)
    })
  })

  test('the 72-column sketch: every row, as docs/pane-sketch.md draws it', () => {
    const sketch = { ...full, motto: undefined }
    expect(hudLines(sketch, { columns: 72, isNarrow: false })).toEqual(SKETCH_72)
    expect(hudRowIds(sketch, { columns: 72, isNarrow: false })).toEqual(SKETCH_IDS)
    // From 74 columns the card is whole: the header's right cell at 72.
    expect(displayWidth(hudLines(sketch, { columns: 74, isNarrow: false })[0] ?? '')).toBe(72)
  })

  test('the cold-cache sketch at 72: an empty track and what the next turn rewrites, calm, no alert', () => {
    expect(hudLines({ ...coldCache, motto: undefined }, { columns: 72, isNarrow: false })).toEqual([
      '◆ opus 5.5 · xhigh · gateway                           ● working 00:42',
      '',
      ...SKETCH_72.slice(3, 8),
      `          cache   ${'─'.repeat(20)}  cold · next turn rewrites 412k`,
      ` limits   5h      ━━━━━━──────────────  31%   ${AT_5H}`,
      ...SKETCH_72.slice(10),
    ])
  })

  test('narrow at 48 columns: the same rows, the short labels, 10-cell bars', () => {
    expect(hudLines(full, { columns: 48, isNarrow: true })).toEqual([
      '◆ opus 5.5 · xhigh · gateway   ● working 00:42',
      '  ⚠ 2 agents waiting for permission · 5h out ~1…',
      '',
      ' sess repo   ~/.claude/mods',
      '      branch main* ↑2  +142 −37 lines',
      '      now    Bash · npm test -- hud      00:04',
      ' ctx  used   ━━━━────┃─  41%  412k/1.0M',
      '      growth +65k/turn  compact in ~6 turns',
      '      cache  ━━━━━━━───  warm · 42m left (1h)',
      ` lim  5h     ━━━───────  31%  ${AT_5H}`,
      `      7d     ━─────────  12%  ${AT_7D}`,
      ' use  cost   $4.21  $3.51 / h · 1h 12m',
      '      last   $0.38  1m 12s · 24k tokens',
      '      cache  87% hit  agents 38% of spend',
      '  ship small, ship often',
    ])
  })

  test('narrow at 56, 40 and 36 columns: pieces that do not fit are left out whole, the bars shrink, then go', () => {
    const at56 = rowsById(full, 56)
    expect(at56['limits.5h']).toBe(` lim  5h     ━━━───────  31%  ${AT_5H}  out ~${AT_OUT_5H}`)
    expect(at56['usage.cache']).toBe('      cache  87% hit  agents 38% of spend')
    expect(hudLines(full, { columns: 40, isNarrow: true })).toEqual([
      '◆ opus 5.5 · xhigh     ● working 00:42',
      '  ⚠ 2 agents waiting for permission · 5…',
      '',
      ' sess repo   ~/.claude/mods',
      '      branch main* ↑2  +142 −37 lines',
      '      now    Bash · npm test…    00:04',
      ' ctx  used   ━━━───┃─  41%  412k/1.0M',
      '      growth +65k/turn',
      '      cache  ━━━━━━──  warm · 42m left',
      ` lim  5h     ━━──────  31%  ${AT_5H}`,
      `      7d     ━───────  12%  ${AT_7D}`,
      ' use  cost   $4.21  $3.51 / h · 1h 12m',
      '      last   $0.38  1m 12s · 24k tokens',
      '      cache  87% hit',
      '  ship small, ship often',
    ])
    const at36 = hudLines(full, { columns: 36, isNarrow: true })
    // The working cell and the provider gave way; the effort stays.
    expect(at36[0]).toBe('◆ opus 5.5 · xhigh')
    expect(at36).toContain(' ctx  used    41%  412k/1.0M')
    expect(at36).toContain(` lim  5h      31%  ${AT_5H}`)
    expect(at36).toContain('      cache  warm · 42m left (1h)')
    expect(at36).toContain('      branch main* ↑2')
    expect(hudLines(fullContext, { columns: 36, isNarrow: true })).toContain(' ctx  used   100%  1.0M/1.0M')
  })

  test('every section row puts its label in the gutter, its sub-label after, its value in one column', () => {
    for (const [columns, isNarrow, gutter, sub] of [[72, false, GUTTER, SUB_WIDTH], [100, false, GUTTER, SUB_WIDTH], [56, true, NARROW_GUTTER, NARROW_SUB_WIDTH], [40, true, NARROW_GUTTER, NARROW_SUB_WIDTH]] as const) {
      for (const data of [full, fullContext, alarmed, coldCache, sparse]) {
        const layout = { columns, isNarrow }
        const ids = hudRowIds(data, layout)
        const lines = hudLines(data, layout)
        const seen = new Set<string>()
        ids.forEach((id, index) => {
          const [section, label] = id.split('.')
          if (label === undefined || section === undefined) return
          const line = lines[index] ?? ''
          const where = `${id} @${columns}: ${line}`
          const names = SECTIONS[section as keyof typeof SECTIONS]
          // The section's label on its first row, blank on the rest.
          expect(line.slice(0, gutter), where).toBe(seen.has(section) ? ' '.repeat(gutter) : ` ${isNarrow ? names.short : names.label}`.padEnd(gutter))
          seen.add(section)
          expect(line.slice(gutter, gutter + sub), where).toBe(label.padEnd(sub))
          // The value starts right there (a barless percent is right-aligned in its cell).
          expect(line.slice(gutter + sub, gutter + sub + 1), where).not.toBe(' ')
        })
      }
    }
    expect(VALUE_AT).toBe(18)
    expect(NARROW_VALUE_AT).toBe(13)
  })

  test('a section\'s label moves to its first row shown when the rows above it go', () => {
    const noPlace: HudData = { ...full, session: { ...full.session, cwd: undefined, repoRoot: undefined }, git: {} }
    expect(rowsById(noPlace)['session.now']).toBe(' session  now     Bash · npm test -- hud                         00:04')
    // A short pane drops the repo and the branch: the label goes with the now row.
    expect(rowsById(full, 72, 14)['session.now']).toStartWith(' session  now ')
    // A section with no rows has no label at all.
    expect(hudLines({ ...full, usage: { rateLimits: [], compactions: 0 } }, { columns: 72, isNarrow: false }).some(line => line.startsWith(' limits'))).toBe(false)
  })

  test('(1) the header is bold, the model name in the theme accent; the clock and the cost are the usage section\'s', async ($, on) => {
    stage(on)
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        const ui = await mount($, surface, columns)
        const rows = await rowsOf(ui)
        const header = rowOf(rows, 'header')
        expect(rows[0]?.id).toBe('header')
        expect(header?.text).toStartWith(`◆ ${MODEL} · xhigh`)
        expect(header?.text).not.toMatch(/\$|1h 12m/)
        expect(piece(header, '◆')?.props).toEqual({ color: 'claude' })
        expect(piece(header, MODEL)?.props).toEqual({ color: 'claude', bold: true })
        expect(piece(header, 'xhigh')?.props).toEqual({ bold: true })
        expect(piece(rowOf(rows, 'usage.cost'), '$4.21')?.props).toEqual({ bold: true })
        await ui.unmount()
      }
    }
  })

  test('(2) bars are 20 cells wide, 10 or 8 narrow, the fill coloured by level and the track dim', { timeoutMs: 20_000 }, async ($, on) => {
    const scene = stage(on)
    const levels: [number, string][] = [[0, 'success'], [12, 'success'], [59, 'success'], [60, 'warning'], [84, 'warning'], [85, 'error'], [100, 'error']]
    for (const surface of SURFACES) {
      for (const [percent, color] of levels) {
        scene.data = {
          ...full,
          // No compaction mark: the bars are fill and track alone.
          inventory: { mcpServers: [] },
          usage: {
            ...(full.usage ?? { rateLimits: [], compactions: 0 }),
            contextPercent: percent,
            limitSamples: undefined,
            rateLimits: [
              { kind: 'five_hour', percentUsed: percent },
              { kind: 'seven_day', percentUsed: percent },
              { kind: 'spend_limit', percentUsed: percent },
            ],
          },
        }
        for (const [columns, cells] of [[100, BAR_WIDTH], [60, BAR_WIDTH], [56, NARROW_BAR_WIDTH], [44, NARROW_BAR_WIDTH], [43, SMALL_BAR_WIDTH], [40, SMALL_BAR_WIDTH]] as const) {
          const ui = await mount($, surface, columns)
          const rows = await rowsOf(ui)
          for (const id of GAUGES) {
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
        for (const row of (await rowsOf(barless)).filter(one => GAUGES.includes(one.id) || one.id === 'context.cache')) {
          expect(row.text.match(BAR_CELLS), `${row.id} at ${percent}`).toBeNull()
          if (row.id !== 'context.cache') expect(row.text.slice(NARROW_VALUE_AT).trimStart(), `${row.id} at ${percent}`).toStartWith(`${percent}%`)
          if (row.id !== 'context.cache') expect(row.pieces.some(one => one.props.color !== undefined), `${row.id} at ${percent}`).toBe(false)
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
          for (const id of ['header', 'session.now']) {
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
    // The working cell crossing the hour stays in its cell: the model and the row's width stay put.
    const working = (ms: number) => hudLines({ ...full, main: { busySince: NOW - ms } }, { columns: 72, isNarrow: false })[0] ?? ''
    expect(working(3_599_000)).toEndWith('● working 59:59')
    expect(working(3_601_000)).toEndWith('● working 1h 00m')
    expect(displayWidth(working(3_599_000))).toBe(displayWidth(working(3_601_000)))
    // A tool's elapsed time crossing the hour stays at the edge.
    const elapsed = (ms: number) => rowsById({ ...full, tools: { ...full.tools!, current: { name: 'Bash', since: NOW - ms, arg: 'npm test -- hud' } } })['session.now'] ?? ''
    expect(displayWidth(elapsed(3_599_000))).toBe(displayWidth(elapsed(3_601_000)))
    expect(elapsed(3_601_000)).toEndWith('1h 00m')
  })

  test('(4) narrow keeps every wide row, in the same order, with short labels and 10/8-cell bars', async ($, on) => {
    const scene = stage(on)
    for (const surface of SURFACES) {
      scene.data = fullContext
      const wide = await mount($, surface, 100)
      const wideIds = (await rowsOf(wide)).map(row => row.id)
      await wide.unmount()
      expect(wideIds).toEqual(['header', 'alerts', 'gap', 'session.repo', 'session.branch', 'session.now', 'context.used', 'context.cache', 'limits.5h', 'limits.7d', 'limits.spend', 'usage.cost', 'usage.last', 'usage.cache', 'motto'])

      for (const columns of [59, 56, 48, 44, 43, 40, 37]) {
        const ui = await mount($, surface, columns)
        const rows = await rowsOf(ui)
        expect(rows.map(row => row.id), `@${columns}`).toEqual(wideIds)
        const cells = columns < 44 ? SMALL_BAR_WIDTH : NARROW_BAR_WIDTH
        for (const id of GAUGES) expect(rowOf(rows, id)?.text.match(BAR_CELLS), `${id} @${columns}`).toHaveLength(cells)
        for (const [id, label] of [['session.repo', ' sess '], ['context.used', ' ctx  '], ['limits.5h', ' lim  '], ['usage.cost', ' use  ']] as const) {
          expect(rowOf(rows, id)?.text, `${id} @${columns}`).toStartWith(label)
        }
        // The facts the wide rows carry are all there.
        const text = rows.map(row => row.text).join('\n')
        for (const fact of ['opus 5.5', columns < 40 ? '$3.51 / h' : '1h 12m', '$4.21', '⚠ 2 agents', 'main*', '100%', '1.0M/1.0M', '92%', AT_5H, '64%', AT_7D, '85%', AT_SPEND, 'Bash', 'ship small']) {
          expect(text, `${fact} @${columns}`).toContain(fact)
        }
        await ui.unmount()
      }
    }
    // The provider stays while the row has room for it, and gives way first.
    expect(hudLines(full, { columns: 48, isNarrow: true })[0]).toContain('· gateway')
    expect(hudLines(full, { columns: 44, isNarrow: true })[0]).not.toContain('gateway')
    expect(hudLines(full, { columns: 44, isNarrow: true })[0]).toContain('opus 5.5 · xhigh')
  })

  test('the header stops two cells short of the close button at every width', () => {
    // With no header to draw, whichever row comes first keeps the reserve.
    const placeOnly: HudData = { session: { cwd: '/Users/someone/a/path/long/enough/to/fill/any/pane/it/is/drawn/into' }, git: { branch: 'main', dirty: true }, now: NOW }
    for (const data of [...Object.values(FIXTURES), placeOnly]) {
      for (const columns of EVERY_WIDTH) {
        const lines = hudLines(data, { columns, isNarrow: columns < NARROW_BELOW })
        if (lines.length === 0) continue
        const first = lines[0] ?? ''
        if (data !== placeOnly) expect(first, `@${columns}`).toStartWith('◆')
        expect(displayWidth(first), `@${columns}: ${first}`).toBeLessThanOrEqual(columns - CLOSE_RESERVE)
      }
    }
    expect(hudLines(placeOnly, { columns: 40, isNarrow: true })).toEqual([' sess repo   …/pane/it/is/drawn/into', '      branch main*'])
    // The working cell is never under the close button.
    for (const columns of [40, 48, 56, 60, 72]) {
      const first = hudLines(full, { columns, isNarrow: columns < NARROW_BELOW })[0] ?? ''
      expect(first, `@${columns}`).toEndWith('● working 00:42')
      expect(displayWidth(first), `@${columns}`).toBe(Math.min(columns, 72 + CLOSE_RESERVE) - CLOSE_RESERVE)
    }
  })

  test('right-aligned cells share the header\'s edge at 60 through 73 columns', () => {
    for (let columns = 60; columns <= 73; columns += 1) {
      const lines = rowsById(full, columns)
      const edge = displayWidth(lines.header ?? '')
      expect(displayWidth(lines['session.now'] ?? ''), `@${columns}`).toBe(edge)
      expect(lines['session.now'], `@${columns}`).toEndWith(' 00:04')
    }
  })

  test('(5) a missing fact hides its row instead of printing zeros; a section with no rows hides its label', { timeoutMs: 20_000 }, async ($, on) => {
    const scene = stage(on, sparse)
    for (const surface of SURFACES) {
      for (const columns of [100, 48]) {
        const ui = await mount($, surface, columns)
        const rows = await rowsOf(ui)
        expect(rows.map(row => row.id)).toEqual(['header', 'gap', 'context.used', 'usage.cost'])
        expect(rowOf(rows, 'context.used')?.text).toBe(columns < NARROW_BELOW ? ' ctx  used   —' : ' context  used    —')
        expect(rowOf(rows, 'usage.cost')?.text).toBe(columns < NARROW_BELOW ? ' use  cost   $0.00  00:12' : ' usage    cost    $0.00              00:12')
        await ui.unmount()
      }

      scene.data = empty
      const none = await mount($, surface, 100)
      expect(await rowsOf(none)).toHaveLength(0)
      await none.unmount()

      // No limits, no git, no inventory, no tools, no cache, no last turn, nothing alarming: those rows go, the rest stay.
      scene.data = {
        ...full,
        usage: { ...full.usage!, rateLimits: [], lastTurn: undefined, tokens: undefined, agentShare: undefined },
        git: {},
        inventory: { mcpServers: [] },
        tools: { counts: {} },
        cache: undefined,
        alerts: undefined,
      }
      const bare = await mount($, surface, 100)
      const left = await rowsOf(bare)
      expect(left.map(row => row.id)).toEqual(['header', 'gap', 'session.repo', 'context.used', 'context.growth', 'usage.cost', 'motto'])
      // Without the threshold the runway runs to the window.
      expect(rowOf(left, 'context.growth')?.text).toEndWith('compact in ~10 turns')
      expect(rowOf(left, 'session.repo')?.text).toBe(' session  repo    ~/.claude/mods')
      await bare.unmount()
      scene.data = sparse
    }
    await eachDrawing($, scene, WIDTHS, rows => {
      for (const row of rows) expect(row.text).not.toMatch(/mcp|skills|[+~−↑↓×]0\b|0 compactions|0 files|⚠ 0|~0 turns|0 tokens|agents 0%/)
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

  test('(8) dim for the secondary, bold for the headlines, colour only on bars, glyphs, the model, working, the ETA, the cooling cache, the lines changed and the alerts', { timeoutMs: 20_000 }, async ($, on) => {
    const scene = stage(on)
    await eachDrawing($, scene, WIDTHS, async (rows, { name, columns }) => {
      for (const row of rows) {
        for (const one of row.pieces) {
          const where = `${name} @${columns} ${row.id}: ${JSON.stringify(one.text)}`
          expect(one.props.backgroundColor, where).toBeUndefined()
          expect(one.props.inverse, where).toBeUndefined()
          if (one.props.color !== undefined) {
            expect(THEME_KEYS, where).toContain(one.props.color)
            // The alert strip is coloured throughout: each alert in its severity's key.
            if (row.id !== 'alerts') expect(/^[━◆●◐*]+$/.test(one.text) || /^out ~/.test(one.text.trim()) || ['cooling', MODEL, '● working'].includes(one.text) || (row.id === 'session.branch' && /^[+−]\d+$/.test(one.text.trim())), where).toBe(true)
          }
          if (one.props.bold === true) expect(['header', 'usage.cost'], where).toContain(row.id)
          if (one.props.dimColor === true) expect(one.props.bold, where).toBeUndefined()
        }
      }
    })
    scene.data = full
    for (const surface of SURFACES) {
      const ui = await mount($, surface, 100)
      const rows = await rowsOf(ui)
      for (const [id, text] of [
        ['header', 'gateway'], ['header', '00:42'], ['session.repo', 'repo'], ['session.repo', '~/.claude/mods'],
        ['session.branch', '↑2'], ['session.branch', 'lines'], ['session.branch', 'last commit 48m ago'],
        ['session.now', 'npm test -- hud'], ['session.now', '00:04'],
        ['context.used', 'used'], ['context.used', '─'], ['context.used', '┃'], ['context.used', '412k / 1.0M'],
        ['context.growth', 'compact in ~6 turns'], ['context.cache', '42m left'], ['context.cache', '(1h)'],
        ['limits.5h', AT_5H], ['usage.cost', '1h 12m'], ['usage.last', '1m 12s'], ['usage.cache', 'agents 38% of spend'],
      ] as const) {
        expect(piece(rowOf(rows, id), text)?.props.dimColor, `${id}: ${text}`).toBe(true)
      }
      expect(piece(rowOf(rows, 'session.repo'), 'session')?.props).toEqual({})
      expect(piece(rowOf(rows, 'session.branch'), '*')?.props).toEqual({ color: 'warning' })
      // The lines changed: added green, deleted red.
      expect(piece(rowOf(rows, 'session.branch'), '+142')?.props).toEqual({ color: 'success' })
      expect(piece(rowOf(rows, 'session.branch'), '−37')?.props).toEqual({ color: 'error' })
      expect(piece(rowOf(rows, 'header'), '● working')?.props).toEqual({ color: 'claude' })
      expect(piece(rowOf(rows, 'session.now'), 'Bash')?.props).toEqual({})
      expect(piece(rowOf(rows, 'limits.5h'), `out ~${AT_OUT_5H}`)?.props).toEqual({ color: 'error' })
      expect(piece(rowOf(rows, 'context.cache'), '━')?.props).toEqual({ color: 'success' })
      expect(piece(rowOf(rows, 'context.cache'), 'warm')?.props).toEqual({})
      expect(piece(rowOf(rows, 'alerts'), '⚠')?.props).toEqual({ color: 'error' })
      expect(piece(rowOf(rows, 'alerts'), '2 agents waiting for permission')?.props).toEqual({ color: 'error' })
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
        expect(rowOf(rows, 'session.branch')?.text ?? '', `@${columns}`).toMatch(/feature\/very-long-[^ ]*…\* ↑2$/)
        expect(rowOf(rows, 'motto')?.text, `@${columns}`).toEndWith('…')
        expect(todoLines(longBranch.todos, columns, TODO_ROWS, true).find(line => line.includes('Rewriting')), `@${columns}`).toMatch(/Rewriting the reconcil.*…$/)
        expect(todoLines(longBranch.todos, columns)[1], `@${columns}`).toMatch(/◐ Rewriting the rec.*…$/)
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

  test('a short pane gives the HUD half its rows, dropping by rank: alerts, header, used, limits, now, cache, cost, then the rest', () => {
    // Most needed first; the blank row goes before anything with words in it.
    const order = ['alerts', 'header', 'context.used', 'limits.5h', 'limits.7d', 'session.now', 'context.cache', 'usage.cost', 'session.branch', 'session.repo', 'context.growth', 'usage.last', 'usage.cache', 'motto', 'gap']
    expect([...order].sort((a, b) => (RANKS[b as keyof typeof RANKS] ?? 0) - (RANKS[a as keyof typeof RANKS] ?? 0)).filter(id => id in RANKS)).toEqual(order.filter(id => id in RANKS))
    for (const [columns, isNarrow] of [[100, false], [72, false], [48, true], [40, true]] as const) {
      expect(hudLines(full, { columns, isNarrow })).toHaveLength(order.length)
      for (let rows = 4; rows <= 34; rows += 2) {
        const budget = Math.max(4, rows / 2)
        const kept = order.slice(0, budget)
        const ids = hudRowIds(full, { columns, rows, isNarrow })
        expect(ids, `@${columns} rows ${rows}`).toEqual(SKETCH_IDS.concat('motto').filter(id => kept.includes(id)))
      }
    }
  })

  test('a full context window reads 100 % on a full red bar, the threshold marked; no growth known, no growth row', () => {
    const rows = rowsById(fullContext)
    expect(rows['context.used']).toBe(` context  used    ${'━'.repeat(16)}┃${'━'.repeat(3)} 100%   1.0M / 1.0M`)
    expect(rows['context.growth']).toBeUndefined()
    expect(rowsById(fullContext, 48)['context.used']).toBe(` ctx  used   ${'━'.repeat(8)}┃━ 100%  1.0M/1.0M`)
    expect(rowsById(fullContext, 40)['context.used']).toBe(` ctx  used   ${'━'.repeat(6)}┃━ 100%  1.0M/1.0M`)
    const unmarked = { ...fullContext, inventory: { mcpServers: [] } }
    expect(rowsById(unmarked)['context.used']).toContain(`${'━'.repeat(20)} 100%`)
  })
})

describe('the alert strip', () => {
  test('one row under the header, only while something needs attention, most severe first', () => {
    const layout = { columns: 72, isNarrow: false }
    expect(alertsOf(calm)).toEqual([])
    expect(hudLines(calm, layout).some(line => line.includes('⚠'))).toBe(false)
    expect(alertsOf(alarmed).map(alert => alert.id)).toEqual(['asks', 'limit:five_hour', 'stalled', 'compact', 'failures', 'behind'])
    expect(alertsOf(alarmed).map(alert => alert.text)).toEqual([
      '2 agents waiting for permission',
      OUT_ALERT,
      '1 agent stalled',
      'compact in ~2 turns',
      '3 calls denied or failed',
      '↓3 behind',
    ])
    const lines = hudLines(alarmed, layout)
    // Cut to the card with …: what does not fit is the least severe.
    expect(lines[1]).toStartWith(`  ⚠ 2 agents waiting for permission · ${OUT_ALERT} · 1`)
    expect(lines[1]).toEndWith('…')
    expect(displayWidth(lines[1] ?? '')).toBeLessThanOrEqual(72)
    // Narrow, the same row cut to the pane.
    expect(hudLines(alarmed, { columns: 48, isNarrow: true })[1]).toBe('  ⚠ 2 agents waiting for permission · 5h out ~1…')
    // The cache cooling sits after the compaction, before the failures.
    expect(alertsOf({ ...alarmed, cache: coolingCache.cache }).map(alert => alert.id)).toEqual(['asks', 'limit:five_hour', 'stalled', 'compact', 'cache', 'failures', 'behind'])
  })

  test('each alert alone: its words, its colour; a limit that resets first, a compaction far off and zero counts say nothing', () => {
    const layout = { columns: 100, isNarrow: false }
    const quiet: HudData = { ...calm, git: { ...calm.git, behind: undefined } }
    const strip = (data: HudData): string | undefined => hudLines(data, layout).find(line => line.startsWith('  ⚠'))
    expect(strip(quiet)).toBeUndefined()
    expect(strip({ ...quiet, alerts: { asks: 1 } })).toBe('  ⚠ 1 agent waiting for permission')
    expect(strip({ ...quiet, alerts: { stalled: 2 } })).toBe('  ⚠ 2 agents stalled')
    expect(strip({ ...quiet, alerts: { failures: 1 } })).toBe('  ⚠ 1 call denied or failed')
    expect(strip({ ...quiet, alerts: { asks: 0, stalled: 0, failures: 0 } })).toBeUndefined()
    expect(strip({ ...quiet, git: { ...quiet.git, behind: 3 } })).toBe('  ⚠ ↓3 behind')
    expect(strip({ ...quiet, usage: full.usage })).toBe(`  ⚠ ${OUT_ALERT}`)
    // The 5h window resetting before it runs out is no alert.
    const early = new Date(NOW + 60 * 60_000).toISOString()
    const resetsFirst: HudData = { ...quiet, usage: { ...full.usage!, rateLimits: [{ kind: 'five_hour', percentUsed: 31, resetsAt: early }] } }
    expect(strip(resetsFirst)).toBeUndefined()
    // A compaction COMPACT_SOON_TURNS turns off, or nearer, is one; further off, none.
    const turnsAt = (tokens: number): HudData => ({ ...quiet, usage: { ...quiet.usage!, contextTokens: tokens, contextPercent: tokens / 10_000 } })
    expect(COMPACT_SOON_TURNS).toBe(3)
    expect(compactRunway(turnsAt(605_000))).toBe(3)
    expect(strip(turnsAt(605_000))).toBe('  ⚠ compact in ~3 turns')
    expect(compactRunway(turnsAt(604_000))).toBe(4)
    expect(strip(turnsAt(604_000))).toBeUndefined()
    expect(strip(turnsAt(790_000))).toBe('  ⚠ compact in ~1 turn')
    // Colours: asks and a limit `error`, stalled, compaction and the cache `warning`, failures and behind dim `warning`.
    const looks = Object.fromEntries(alertsOf({ ...alarmed, cache: coolingCache.cache }).map(alert => [alert.id, { color: alert.color, dim: alert.dim }]))
    expect(looks).toEqual({
      asks: { color: 'error', dim: undefined },
      'limit:five_hour': { color: 'error', dim: undefined },
      stalled: { color: 'warning', dim: undefined },
      compact: { color: 'warning', dim: undefined },
      cache: { color: 'warning', dim: undefined },
      failures: { color: 'warning', dim: true },
      behind: { color: 'warning', dim: true },
    })
  })

  test('the cache cooling: within two minutes of a 1h TTL, one of a 5m TTL; cold is the cache row\'s, never an alert', () => {
    const strip = (data: HudData): string | undefined => hudLines(data, { columns: 100, isNarrow: false }).find(line => line.startsWith('  ⚠'))
    const left = (ms: number, ttl: '5m' | '1h' = '1h'): HudData => ({ ...calm, cache: { ttl, lastAt: NOW - ((ttl === '1h' ? 60 : 5) * MINUTE - ms) } })
    expect(cacheCoolAt(60 * MINUTE)).toBe(2 * MINUTE)
    expect(cacheCoolAt(5 * MINUTE)).toBe(MINUTE)
    expect(strip(left(2 * MINUTE + 1000))).toBeUndefined()
    expect(strip(left(2 * MINUTE))).toBe('  ⚠ cache cools in 2m · next turn rewrites 412k')
    expect(strip(left(90_000))).toBe('  ⚠ cache cools in 2m · next turn rewrites 412k')
    expect(strip(left(40_000))).toBe('  ⚠ cache cools in 40s · next turn rewrites 412k')
    expect(strip(left(0))).toBeUndefined()
    expect(strip(coldCache)).toBeUndefined()
    // A 5-minute cache cools in its last minute.
    expect(strip(left(61_000, '5m'))).toBeUndefined()
    expect(strip(left(60_000, '5m'))).toBe('  ⚠ cache cools in 1m · next turn rewrites 412k')
    // With the context's size unknown, the cooling alone.
    expect(strip({ ...left(60_000), usage: { ...calm.usage!, contextTokens: undefined, contextPercent: undefined } })).toBe('  ⚠ cache cools in 1m')
    expect(cacheStateOf(left(60_000))).toEqual({ ttl: '1h', ttlMs: 60 * MINUTE, leftMs: 60_000, cooling: true })
    expect(cacheStateOf({ ...calm, cache: undefined })).toBeUndefined()
  })

  test('mounted: the ⚠ in the most severe colour, each alert in its own, separators dim', async ($, on) => {
    stage(on, { ...calm, alerts: { stalled: 1, failures: 3 } })
    for (const surface of SURFACES) {
      const ui = await mount($, surface, 100)
      const row = rowOf(await rowsOf(ui), 'alerts')
      expect(row?.text).toBe('  ⚠ 1 agent stalled · 3 calls denied or failed')
      expect(piece(row, '⚠')?.props).toEqual({ color: 'warning' })
      expect(piece(row, '1 agent stalled')?.props).toEqual({ color: 'warning' })
      expect(piece(row, '3 calls denied or failed')?.props).toEqual({ color: 'warning', dimColor: true })
      await ui.unmount()
    }
  })
})

describe('the header\'s working cell', () => {
  test('● working mm:ss in the accent while the main loop works, ○ idle dim once it stopped, nothing before either', () => {
    const at = (main: HudData['main']) => hudLines({ ...full, main }, { columns: 72, isNarrow: false })[0] ?? ''
    expect(at({ busySince: NOW - 42_000 })).toBe('◆ opus 5.5 · xhigh · gateway                           ● working 00:42')
    expect(at({ idleSince: NOW - 180_000 })).toBe('◆ opus 5.5 · xhigh · gateway                                 ○ idle 3m')
    expect(at(undefined)).toBe('◆ opus 5.5 · xhigh · gateway')
    // Busy wins over a stale idle time.
    expect(at({ busySince: NOW - 5000, idleSince: NOW - 60_000 })).toContain('● working 00:05')
  })

  test('the provider gives way first, then the working cell, then the effort', () => {
    for (let columns = 24; columns <= 74; columns += 1) {
      const line = hudLines(full, { columns, isNarrow: columns < NARROW_BELOW })[0] ?? ''
      // Whenever the working cell shows, so does the effort; without it, no provider either.
      if (line.includes('working')) expect(line, `@${columns}`).toContain('xhigh')
      else expect(line, `@${columns}`).not.toContain('gateway')
      expect(displayWidth(line), `@${columns}`).toBeLessThanOrEqual(columns - CLOSE_RESERVE)
    }
    expect(hudLines(full, { columns: 44, isNarrow: true })[0]).toBe('◆ opus 5.5 · xhigh         ● working 00:42')
    expect(hudLines(full, { columns: 36, isNarrow: true })[0]).toBe('◆ opus 5.5 · xhigh')
    expect(hudLines(full, { columns: 18, isNarrow: true })[0]).toBe('◆ opus 5.5')
  })
})

describe('the session section', () => {
  test('repo: the working directory from the home `~`, its leading directories the first to go', () => {
    expect(rowsById(full)['session.repo']).toBe(' session  repo    ~/.claude/mods')
    const deep: HudData = { ...full, session: { ...full.session, cwd: '/home/dai/src/work/clients/acme/monorepo/packages/frontend/app' } }
    expect(rowsById(deep, 48)['session.repo']).toBe(' sess repo   …/monorepo/packages/frontend/app')
    expect(rowsById({ ...full, session: { ...full.session, cwd: undefined } })['session.repo']).toBe(' session  repo    ~/.claude')
  })

  test('branch: the branch, dirty and ahead/behind, then the lines changed and the last commit\'s age', () => {
    const branch = (git: HudData['git'], columns = 72) => rowsById({ ...full, git }, columns)['session.branch']
    expect(branch(full.git)).toBe('          branch  main* ↑2   +142 −37 lines · last commit 48m ago')
    // Without the line counts, the paths stand in: added, modified, deleted.
    expect(branch({ ...full.git, linesAdded: undefined, linesDeleted: undefined })).toBe('          branch  main* ↑2   +3 −1 · last commit 48m ago')
    // Clean: the branch and its last commit.
    expect(branch({ branch: 'main', dirty: 0, linesAdded: 0, linesDeleted: 0, lastCommitAt: NOW - 3 * 60 * MINUTE })).toBe('          branch  main   last commit 3h ago')
    // No commit yet: no age.
    expect(branch({ branch: 'main', dirty: 2, added: 2 })).toBe('          branch  main*   +2')
    expect(branch({ branch: 'dev', ahead: 1, behind: 4 })).toBe('          branch  dev ↑1 ↓4')
    // Narrow: what fits whole.
    expect(branch(full.git, 48)).toBe('      branch main* ↑2  +142 −37 lines')
    expect(branch(full.git, 36)).toBe('      branch main* ↑2')
    expect(rowsById({ ...full, git: {} })['session.branch']).toBeUndefined()
  })

  test('now: the tool running now and its main argument, its elapsed time at the edge; between tools a dim —', () => {
    const now = (data: HudData, columns = 72) => rowsById(data, columns)['session.now']
    expect(now(full)).toBe('          now     Bash · npm test -- hud                         00:04')
    // An MCP tool keeps its own name; a long argument is cut with …; a path keeps its end.
    expect(now(manyTools)).toMatch(/^ {10}now {5}browser_tak… · https:\/\/example\.com\/[^ ]*… +01:05$/)
    expect(displayWidth(now(manyTools) ?? '')).toBe(70)
    const path: HudData = { ...full, tools: { ...full.tools!, current: { name: 'Edit', since: NOW - 2000, arg: '/Users/daiziqiao/.claude/mods/mod-hud/hooks/a-rather-long-module-name.tsx' } } }
    expect(now(path)).toMatch(/^ {10}now {5}Edit · …\/hooks\/a-rather-long-module-name\.tsx +00:02$/)
    // No argument; between tools; nothing called yet (or the option off): no row.
    expect(now({ ...full, tools: { counts: {}, current: { name: 'Read', since: NOW - 1000 } } })).toMatch(/^ {10}now {5}Read +00:01$/)
    expect(now({ ...full, tools: { counts: { Read: 4 } } })).toBe('          now     —')
    expect(now({ ...full, tools: { counts: {} } })).toBeUndefined()
    expect(now({ ...full, tools: undefined })).toBeUndefined()
    expect(now(full, 48)).toBe('      now    Bash · npm test -- hud      00:04')
  })

  test('the per-tool counts, the session\'s tokens by kind, cache writes, compactions, files edited and the MCP/skill inventory are not drawn', () => {
    for (const columns of [100, 72, 56, 48, 40]) {
      const text = hudLines(manyTools, { columns, isNarrow: columns < NARROW_BELOW }).join('\n')
      expect(text, `@${columns}`).not.toMatch(/×41|tools|tok |cache write|mcp|skills|\d[kM]? in\b|\d[kM]? out\b|compactions|files edited/)
    }
  })
})

describe('the context section', () => {
  test('used: the auto-compact threshold marked ┃ on the bar, the tokens of the window', () => {
    // 800k of 1M: the 17th of 20 cells.
    expect(rowsById(full)['context.used']).toBe(' context  used    ━━━━━━━━────────┃───  41%   412k / 1.0M')
    expect(rowsById(full, 56)['context.used']).toBe(' ctx  used   ━━━━────┃─  41%  412k/1.0M')
    // No threshold known (or none below the window): no mark.
    expect(rowsById({ ...full, inventory: { mcpServers: [] } })['context.used']).toBe(' context  used    ━━━━━━━━────────────  41%   412k / 1.0M')
    expect(rowsById({ ...full, inventory: { mcpServers: [], compactAt: 1_000_000 } })['context.used']).not.toContain('┃')
  })

  test('growth: the context\'s growth per turn and the runway to compaction; no growth seen, no row', () => {
    expect(rowsById(full)['context.growth']).toBe('          growth  +65k / turn        compact in ~6 turns')
    expect(rowsById(full, 48)['context.growth']).toBe('      growth +65k/turn  compact in ~6 turns')
    // No threshold: the runway runs to the window.
    expect(rowsById({ ...full, inventory: { mcpServers: [] } })['context.growth']).toEndWith('compact in ~10 turns')
    expect(rowsById({ ...full, usage: { ...full.usage!, contextSamples: [412_000, 412_000] } })['context.growth']).toBeUndefined()
    expect(rowsById({ ...full, usage: { ...full.usage!, contextTokens: undefined, contextPercent: undefined } })['context.growth']).toBe('          growth  +65k / turn')
    // A compaction's drop is left out of the growth.
    expect(compactRunway({ ...full, usage: { ...full.usage!, contextSamples: [300_000, 40_000, 105_000, 170_000] } })).toBe(Math.ceil((800_000 - 412_000) / 65_000))
  })

  test('cache: the TTL left since the main loop\'s last request, draining; cooling in warning; cold, an empty track; the TTL in parens', () => {
    const cache = (data: HudData, columns = 72) => rowsById(data, columns)['context.cache']
    const at = (ms: number, ttl: '5m' | '1h' = '1h'): HudData => ({ ...full, cache: { ttl, lastAt: NOW - ms } })
    expect(cache(full)).toBe('          cache   ━━━━━━━━━━━━━━──────  warm · 42m left (1h)')
    expect(cache(at(0))).toBe(`          cache   ${'━'.repeat(20)}  warm · 1h left (1h)`)
    expect(cache(at(59 * MINUTE))).toBe(`          cache   ━${'─'.repeat(19)}  cooling · 1m left (1h)`)
    expect(cache(coldCache)).toBe(`          cache   ${'─'.repeat(20)}  cold · next turn rewrites 412k`)
    expect(cache(at(2 * MINUTE, '5m'))).toBe('          cache   ━━━━━━━━━━━━────────  warm · 3m left (5m)')
    expect(cache(at(5 * MINUTE, '5m'))).toContain('cold · next turn rewrites 412k')
    // Cold with no context size known: just cold.
    expect(cache({ ...coldCache, usage: { ...full.usage!, contextTokens: undefined, contextPercent: undefined } })).toBe(`          cache   ${'─'.repeat(20)}  cold (1h)`)
    // Narrow, then barless.
    expect(cache(full, 48)).toBe('      cache  ━━━━━━━───  warm · 42m left (1h)')
    expect(cache(full, 36)).toBe('      cache  warm · 42m left (1h)')
    // No main request yet (or no TTL): no row.
    expect(cache({ ...full, cache: undefined })).toBeUndefined()
    // A TTL inferred where what decides it cannot be read: marked as a guess, here and on the status line.
    const guessed: HudData = { ...full, cache: { ...full.cache!, assumed: true } }
    expect(cache(guessed)).toBe('          cache   ━━━━━━━━━━━━━━──────  warm · 42m left (1h?)')
    expect(statusLineText(guessed)).toEndWith(' │ cache 42m?')
    expect(statusLineText({ ...coldCache, cache: { ...coldCache.cache!, assumed: true } })).toEndWith(' │ cache cold')
  })

  test('auto-compaction off: no ┃ on the bar, no runway on the growth row, no compaction alert', () => {
    const near: HudData = { ...full, usage: { ...full.usage!, contextTokens: 700_000, contextPercent: 70, contextSamples: [570_000, 635_000, 700_000] } }
    expect(rowsById(near)['context.growth']).toContain('compact in ~2 turns')
    expect(alertsOf(near).map(one => one.id)).toContain('compact')
    const off: HudData = { ...near, inventory: { mcpServers: [], autoCompact: false } }
    expect(rowsById(off)['context.used']).not.toContain('┃')
    expect(rowsById(off)['context.growth']).toBe('          growth  +65k / turn')
    expect(alertsOf(off).map(one => one.id)).not.toContain('compact')
    expect(compactRunway(off)).toBe(undefined)
  })
})

describe('the limits section', () => {
  test('5h and 7d each on their own row, the bar as wide as the context\'s; the ETA only while it comes before the reset; spend its own row', () => {
    const rows = rowsById(fullContext)
    expect(rows['limits.5h']).toBe(` limits   5h      ━━━━━━━━━━━━━━━━━━──  92%   ${AT_5H}`)
    expect(rows['limits.7d']).toBe(`          7d      ━━━━━━━━━━━━━───────  64%   ${AT_7D}`)
    expect(rows['limits.spend']).toBe(`          spend   ━━━━━━━━━━━━━━━━━───  85%   ${AT_SPEND}`)
    // The sketch's 5h window runs out before it resets: `out ~` after the reset, in error.
    expect(rowsById(full)['limits.5h']).toBe(` limits   5h      ━━━━━━──────────────  31%   ${AT_5H}   out ~${AT_OUT_5H}`)
    const early = new Date(NOW + 60 * 60_000).toISOString()
    expect(rowsById({ ...full, usage: { ...full.usage!, rateLimits: [{ kind: 'five_hour', percentUsed: 31, resetsAt: early }] } })['limits.5h']).not.toContain('out ~')
    // No reset known: the ETA follows the percent.
    expect(rowsById({ ...full, usage: { ...full.usage!, rateLimits: [{ kind: 'five_hour', percentUsed: 31 }] } })['limits.5h']).toBe(` limits   5h      ━━━━━━──────────────  31%   out ~${AT_OUT_5H}`)
    // Only one window known: that row alone, the label on it.
    const one: HudData = { ...full, usage: { ...full.usage!, rateLimits: [{ kind: 'seven_day', percentUsed: 12, resetsAt: RESET_7D }] } }
    expect(rowsById(one)['limits.7d']).toBe(` limits   7d      ━━──────────────────  12%   ${AT_7D}`)
    expect(rowsById(one)['limits.5h']).toBeUndefined()
    // Narrow: each its own row, the ETA while it fits.
    expect(rowsById(fullContext, 56)['limits.5h']).toBe(` lim  5h     ━━━━━━━━━─  92%  ${AT_5H}`)
    expect(rowsById(full, 48)['limits.5h']).toBe(` lim  5h     ━━━───────  31%  ${AT_5H}`)
  })
})

describe('the usage section', () => {
  test('cost: the session\'s cost, its rate an hour after five minutes, the session\'s clock', () => {
    expect(rowsById(full)['usage.cost']).toBe(' usage    cost    $4.21              $3.51 / h · 1h 12m')
    const young: HudData = { ...full, session: { ...full.session, startedAt: NOW - 4 * MINUTE } }
    expect(rowsById(young)['usage.cost']).toBe(' usage    cost    $4.21              04:00')
    expect(rowsById({ ...full, usage: { ...full.usage!, costUsd: undefined } })['usage.cost']).toBe(' usage    cost    —                  1h 12m')
    expect(rowsById({ ...full, session: { ...full.session, startedAt: undefined } })['usage.cost']).toBe(' usage    cost    $4.21')
    expect(rowsById({ ...full, session: { model: 'x' }, usage: { rateLimits: [], compactions: 0 } })['usage.cost']).toBeUndefined()
    expect(rowsById(full, 48)['usage.cost']).toBe(' use  cost   $4.21  $3.51 / h · 1h 12m')
  })

  test('last: the last main turn\'s cost, how long it ran, its own tokens; pieces it lacks left out', () => {
    expect(rowsById(full)['usage.last']).toBe('          last    $0.38              1m 12s · 24k tokens')
    const last = (lastTurn: NonNullable<HudData['usage']>['lastTurn']) => rowsById({ ...full, usage: { ...full.usage!, lastTurn } })['usage.last']
    expect(last({ durationMs: 4000 })).toBe('          last    —                  4s')
    expect(last({ costUsd: 0.02, tokens: 950 })).toBe('          last    $0.02              950 tokens')
    expect(last({ costUsd: 0, durationMs: 0, tokens: 0 })).toBe('          last    $0.00')
    expect(last({})).toBeUndefined()
    expect(last(undefined)).toBeUndefined()
  })

  test('cache: the share of input the prompt cache served, and the agents\' share of the spend', () => {
    expect(rowsById(full)['usage.cache']).toBe('          cache   87% hit            agents 38% of spend')
    const usage = (more: Partial<NonNullable<HudData['usage']>>) => rowsById({ ...full, usage: { ...full.usage!, ...more } })['usage.cache']
    expect(usage({ agentShare: undefined })).toBe('          cache   87% hit')
    expect(usage({ agentShare: 0 })).toBe('          cache   87% hit')
    expect(usage({ tokens: undefined })).toBe('          cache   agents 38% of spend')
    expect(usage({ tokens: { input: 0, output: 10, cacheRead: 0, cacheWrite: 0 }, agentShare: undefined })).toBeUndefined()
    expect(usage({ tokens: undefined, agentShare: undefined })).toBeUndefined()
    expect(rowsById(full, 40)['usage.cache']).toBe('      cache  87% hit')
  })
})

describe('the TODO section', () => {
  test('folded (the default): the label row (toggle, bar, count) and the item in progress (else the next pending) under it', () => {
    expect(todoLines(sevenTodos, 72)).toEqual([' todo ▸   ━━━━──────  3/7', '          ◐ Wiring the detail view'])
    expect(todoLines(full.todos, 72)).toEqual([' todo ▸   ━━━━━━────  3/5', '          ◐ Wiring the status line'])
    // No item in progress: the next pending; every item done: the label row alone, the bar full.
    expect(todoLines({ items: [{ content: 'Plan', status: 'completed' }, { content: 'Ship', status: 'pending' }] }, 72)).toEqual([' todo ▸   ━━━━━─────  1/2', '          ☐ Ship'])
    expect(todoLines(allDone, 72)).toEqual([' todo ▸   ━━━━━━━━━━  7/7'])
    // Narrow: two cells past the toggle; 8 cells below 44 columns, none at 36 and under.
    expect(todoLines(sevenTodos, 48)).toEqual([' todo ▸ ━━━━──────  3/7', '        ◐ Wiring the detail view'])
    expect(todoLines({ items: [{ content: 'Plain', status: 'in_progress' }] }, 40)).toEqual([' todo ▸ ────────  0/1', '        ◐ Plain'])
    expect(todoLines(sevenTodos, 36)).toEqual([' todo ▸ 3/7', '        ◐ Wiring the detail view'])
    expect(todoRows(sevenTodos, 72)).toHaveLength(2)
    expect(todoLines({ items: [] }, 72)).toEqual([])
    expect(todoLines(undefined, 72)).toEqual([])
  })

  test('open: the label row (▾), then in progress, pending, completed; ☑ ◐ ☐; in the value gutter; capped at todoRows (6 by default)', () => {
    expect(todoLines(sevenTodos, 72, 10, true)).toEqual([
      ' todo ▾   ━━━━──────  3/7',
      '          ◐ Wiring the detail view',
      '          ☐ Test the scenes',
      '          ☐ Update the sprite sheet',
      '          ☐ Sketch the pane at 72 and 48 columns',
      '          ☑ Read the brief',
      '          ☑ Split the sprites out',
      '          ☑ Write the choreography',
    ])
    expect(TODO_ROWS).toBe(6)
    const capped = todoLines(sevenTodos, 72, TODO_ROWS, true)
    expect(capped).toHaveLength(1 + 6 + 1)
    expect(capped.at(-1)).toBe('          +1 more')
    expect(todoLines(sevenTodos, 72, 3, true).at(-1)).toBe('          +4 more')
    expect(todoRows(allDone, 72, TODO_ROWS, true).filter(row => row.status === 'completed')).toHaveLength(6)
    expect(todoLines(allDone, 72, 10, true).slice(1).every(line => line.startsWith('          ☑ '))).toBe(true)
  })

  test('no row is wider than the pane from 20 to 130 columns; a long item ends in …', () => {
    for (const columns of EVERY_WIDTH) {
      for (const todos of [sevenTodos, allDone, longBranch.todos, full.todos]) {
        for (const expanded of [false, true]) {
          for (const line of todoLines(todos, columns, TODO_ROWS, expanded)) expect(displayWidth(line), `@${columns}: ${line}`).toBeLessThanOrEqual(columns)
        }
      }
      const long = todoLines(sevenTodos, columns, TODO_ROWS, true).find(line => line.includes('Sketch the pane'))
      if (long !== undefined && columns < 40) expect(long).toEndWith('…')
    }
  })

  test('mounted folded: the toggle a dim Button (with one) or dim text, the fill success, ◐ in the accent', async ($, on) => {
    const layouts: Record<string, { expanded: boolean; button: boolean }> = {
      folded: { expanded: false, button: true },
      open: { expanded: true, button: true },
      plain: { expanded: false, button: false },
    }
    for (const [name, look] of Object.entries(layouts)) {
      on('ui.render', { component: 'Pane', requestId: `todos:${name}` }, ($$, e) => {
        const table = $$.ui.resolve(e)
        // The desktop's table carries a Button too: without one, it is left out on purpose.
        const ui = { ...elementsFor(e.surface, table), Button: look.button ? table.Button : undefined }

        return renderTodos(ui, sevenTodos, { columns: e.props.bodyColumns, expanded: look.expanded, onToggle: () => undefined }).element ?? table.Box({})
      })
    }
    const mountTodos = (surface: Surface, name: string, columns: number) =>
      $.ui.mount({ plugin: 'mod-hud', surface, component: 'Pane', requestId: `todos:${name}`, props: { ...PANE_PROPS, bodyColumns: columns }, viewport: VIEWPORT })
    for (const surface of SURFACES) {
      for (const [columns, label] of [[72, ' todo ▸   ━━━━──────  3/7'], [48, ' todo ▸ ━━━━──────  3/7']] as const) {
        const ui = await mountTodos(surface, 'folded', columns)
        const button = await ui.find({ key: 'todos:toggle' })
        expect(button?.props.label).toBe('▸')
        expect(button?.props.dimColor).toBe(true)
        // Its press is the caller's: the hooks write `listView.todosExpanded` (register-hud.test.ts presses it in the pane).
        if (surface === 'desktop') {
          const source = rowSource(await ui.find({ key: 'todo:header' })) ?? ''
          // The Button's cell is left blank in the document; the rest reads as the terminal's.
          expect(textLine(source)).toBe(label.replace('▸', ' '))
          const doing = textPieces(rowSource(await ui.find({ key: 'todo:3' })) ?? '')
          expect(doing.find(one => one.text === '◐')?.props).toEqual({ color: 'claude' })
          expect(source).toContain(`<g class='g' fill='${SCENE_THEMES.dark.success}'><rect x='${(label.indexOf('━')) * CELL_WIDTH}' y='7' width='32' height='3'/></g>`)
          expect(await ui.findAll({ type: 'Text' })).toEqual([])
        } else {
          const header = await ui.find({ key: 'todo:header' })
          expect(header?.text).toBe(label)
          const texts = await ui.findAll({ type: 'Text' })
          expect(texts.find(one => one.text === '━━━━')?.props.color).toBe('success')
          expect(texts.find(one => one.text === '◐')?.props.color).toBe('claude')
          expect((await ui.find({ key: 'todo:3' }))?.text).toBe(`${' '.repeat(columns < 60 ? 8 : 10)}◐ Wiring the detail view`)
          expect(await ui.findAll({ type: 'Svg' })).toEqual([])
        }
        await ui.unmount()

        // Without a Button the toggle is dim text, and the row reads the same.
        const plainUi = await mountTodos(surface, 'plain', columns)
        expect(await plainUi.find({ key: 'todos:toggle' })).toBe(undefined)
        if (surface === 'terminal') expect((await plainUi.find({ key: 'todo:header' }))?.text).toBe(label)
        else expect(textLine(rowSource(await plainUi.find({ key: 'todo:header' })) ?? '')).toBe(label)
        await plainUi.unmount()
      }
    }
  })

  test('mounted open: ▾ on the label row, completed struck through and dim, ◐ in the accent, +n more dim', async ($, on) => {
    on('ui.render', { component: 'Pane', requestId: 'todos-under-test' }, ($$, e) => {
      const table = $$.ui.resolve(e)

      return renderTodos({ ...elementsFor(e.surface, table), Button: table.Button }, sevenTodos, { columns: e.props.bodyColumns, expanded: true, onToggle: () => undefined }).element ?? table.Box({})
    })
    for (const surface of SURFACES) {
      for (const columns of [72, 48]) {
        const indent = ' '.repeat(columns < 60 ? 8 : 10)
        const ui = await $.ui.mount({ plugin: 'mod-hud', surface, component: 'Pane', requestId: 'todos-under-test', props: { ...PANE_PROPS, bodyColumns: columns }, viewport: VIEWPORT })
        expect((await ui.find({ key: 'todos:toggle' }))?.props.label).toBe('▾')
        if (surface === 'desktop') {
          // In pixels: each row its own Svg, read back to the same text and looks.
          const row = async (key: string) => {
            const source = rowSource(await ui.find({ key })) ?? ''

            return { text: textLine(source), pieces: textPieces(source) }
          }
          expect((await row('todo:header')).text).toBe(columns < 60 ? ' todo   ━━━━──────  3/7' : ' todo     ━━━━──────  3/7')
          expect((await row('todo:0')).pieces).toEqual([{ text: indent, props: {} }, { text: '☑ Read the brief', props: { dimColor: true, strikethrough: true } }])
          expect((await row('todo:1')).text).toBe(`${indent}☑ Split the sprites out`)
          expect((await row('todo:1')).pieces.at(-1)?.props).toEqual({ dimColor: true, strikethrough: true })
          const doing = await row('todo:3')
          expect(doing.text).toBe(`${indent}◐ Wiring the detail view`)
          expect(doing.pieces.find(one => one.text === '◐')?.props).toEqual({ color: 'claude' })
          expect(doing.pieces.find(one => one.text.includes('Wiring'))?.props).toEqual({})
          expect((await row('todo:more')).pieces.at(-1)).toEqual({ text: '+1 more', props: { dimColor: true } })
          expect(await ui.findAll({ type: 'Text' })).toEqual([])
          await ui.unmount()
          continue
        }
        expect((await ui.find({ key: 'todo:header' }))?.text).toBe(columns < 60 ? ' todo ▾ ━━━━──────  3/7' : ' todo ▾   ━━━━──────  3/7')
        const done = await ui.find({ key: 'todo:0' })
        const struck = (await ui.findAll({ type: 'Text' })).filter(one => one.props.strikethrough === true)
        expect(struck.map(one => one.text)).toEqual(['☑ Read the brief', '☑ Split the sprites out'])
        expect(struck.every(one => one.props.dimColor === true)).toBe(true)
        expect(done?.text).toBe(`${indent}☑ Read the brief`)
        const doing = await ui.find({ key: 'todo:3' })
        expect(doing?.text).toBe(`${indent}◐ Wiring the detail view`)
        expect((await ui.findAll({ type: 'Text' })).find(one => one.text === '◐')?.props.color).toBe('claude')
        expect((await ui.find({ key: 'todo:more' }))?.text).toBe(`${indent}+1 more`)
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
  test('each HUD row is one Svg on the scene\'s 8×16 grid, as wide as it draws and a row high; the blank row an empty Box; no Text; the terminal keeps its Texts', async ($, on) => {
    const scene = stage(on, fullContext)
    for (const columns of WIDTHS) {
      const ui = await mount($, 'desktop', columns)
      const boxes = (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('hud:') === true)
      expect(boxes.length, `@${columns}`).toBe(hudLines(scene.data, { columns, isNarrow: columns < NARROW_BELOW }).length)
      expect(await ui.findAll({ type: 'Text' })).toEqual([])
      for (const box of boxes) {
        const where = `${box.key} @${columns}`
        const svgs = svgsOf(box)
        expect(box.props.height, where).toBe(1)
        expect(box.props.flexShrink, where).toBe(0)
        if (box.key === 'hud:gap') {
          expect(svgs, where).toHaveLength(0)
          continue
        }
        expect(svgs, where).toHaveLength(1)
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
    expect((await terminal.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('hud:') === true && box.key !== 'hud:gap').every(box => (box.children[0] as { type?: string })?.type === 'Text')).toBe(true)
    await terminal.unmount()
  })

  test('colours are the theme\'s, by class (the light scheme recolours them), dim is opacity, bold and italic are the font\'s; bars are rects', async ($, on) => {
    stage(on, full)
    const ui = await mount($, 'desktop', 100)
    const source = async (id: string): Promise<string> => rowSource(await ui.find({ key: `hud:${id}` })) ?? ''
    const header = await source('header')
    expect(header).toContain(`<g class='a' fill='${SCENE_THEMES.dark.claude}' font-weight='bold'><text x='16' y='12' textLength='64'>opus 5.5</text>`)
    expect(header).toContain(`.a{fill:${SCENE_THEMES.light.claude}}`)
    expect(header).toMatch(/<style>@media \(prefers-color-scheme:light\)\{[^<]*\}<\/style>/)
    // used at 41 %: eight cells of fill from cell 18, a thick rect in the success colour; twelve
    // of track, thin dim ones either side of the compaction threshold's ┃, a dim glyph in its own cell.
    const used = await source('context.used')
    expect(used).toContain(`<g class='g' fill='${SCENE_THEMES.dark.success}'><rect x='144' y='7' width='64' height='3'/></g>`)
    expect(used).toMatch(new RegExp(`<g class='f' fill='${SCENE_THEMES.dark.text}' opacity='\\.55'>[^]*<rect x='208' y='8' width='64' height='1'/><text x='272' y='12'>┃</text><rect x='280' y='8' width='24' height='1'/>`))
    expect(used).not.toContain('━')
    expect(used).not.toContain('─')
    // The motto is dim and italic.
    expect(await source('motto')).toContain(`opacity='.55' font-style='italic'`)
    expect(textRuns(await source('motto'))).toEqual([{ x: 2, text: 'ship small, ship often', props: { dimColor: true, italic: true } }])
    // The alt is the row in words, its bars left out.
    const usedSvg = svgsOf(await ui.find({ key: 'hud:context.used' }))[0]
    expect(usedSvg?.props?.alt).toBe('context used ┃ 41% 412k / 1.0M')
    await ui.unmount()
  })
})
