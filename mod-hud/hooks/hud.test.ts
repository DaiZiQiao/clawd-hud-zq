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
  NARROW_BAR_WIDTH,
  SMALL_BAR_WIDTH,
  TODO_ROWS,
  alertsOf,
  bar,
  barWidthFor,
  compactRunway,
  formatCost,
  formatDuration,
  formatIdle,
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
  TIGHT_7D,
  alarmed,
  allDone,
  calm,
  empty,
  full,
  fullContext,
  longBranch,
  manyTools,
  sevenTodos,
  sparse,
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
    expect(statusLineText(full)).toBe('opus 5.5 · xhigh │ ⚠ 2 │ ctx 41% │ 5h 31% · 7d 12% │ $4.21 │ main* +3 −1 ↑2 │ todo 3/5')
    // `⚠ n` counts the alert strip's alerts, right after who; none, no segment.
    expect(statusLineText(alarmed)).toStartWith('opus 5.5 · xhigh │ ⚠ 6 │ ctx 70%')
    expect(statusLineText(calm)).toBe('opus 5.5 · xhigh │ ctx 41% │ 5h 31% · 7d 12% │ $4.21 │ main* +3 −1 ↑2 │ todo 3/5')
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
        for (const [columns, cells] of [[100, BAR_WIDTH], [56, NARROW_BAR_WIDTH], [44, NARROW_BAR_WIDTH], [43, SMALL_BAR_WIDTH], [40, SMALL_BAR_WIDTH]] as const) {
          const ui = await mount($, surface, columns)
          const rows = await rowsOf(ui)
          // Wide, the 5h and 7d windows share a row of two 8-cell bars.
          const gauges: [string, number, number][] = columns >= NARROW_BELOW
            ? [['ctx', cells, 1], ['limits', SMALL_BAR_WIDTH, 2], ['spend_limit', cells, 1]]
            : [['ctx', cells, 1], ['five_hour', cells, 1], ['seven_day', cells, 1], ['spend_limit', cells, 1]]
          for (const [id, width, count] of gauges) {
            const row = rowOf(rows, id)
            const where = `${id} at ${percent} @${columns}`
            expect(row?.text.match(BAR_CELLS) ?? [], where).toHaveLength(width * count)
            expect(row?.text.split(`${bar(percent, width)} ${`${percent}%`.padStart(4)}`).length, where).toBe(count + 1)
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

  /** The identity row with the main loop idle three minutes. */
  const idleLine = (): string => hudLines({ ...full, main: { idleSince: NOW - 180_000 } }, { columns: 72, isNarrow: false })[0] ?? ''

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
          for (const id of ['identity', 'now']) {
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
    // The working cell crossing the hour stays in its cell: the clock and the cost stay put.
    const working = (ms: number) => hudLines({ ...full, main: { busySince: NOW - ms } }, { columns: 72, isNarrow: false })[0] ?? ''
    expect(working(3_599_000)).toContain('● working 59:59')
    expect(working(3_601_000)).toContain('● working 1h 00m')
    expect(working(3_599_000).indexOf('1h 12m')).toBe(working(3_601_000).indexOf('1h 12m'))
    expect(working(3_599_000).indexOf('$4.21')).toBe(idleLine().indexOf('$4.21'))
    // A tool starting or stopping never moves the files-edited count at the edge.
    const running = hudLines(full, { columns: 72, isNarrow: false }).find(line => line.startsWith('  now')) ?? ''
    const between = hudLines({ ...full, tools: { ...full.tools, counts: {}, current: undefined } }, { columns: 72, isNarrow: false }).find(line => line.startsWith('  now')) ?? ''
    expect(running).toEndWith(' 00:04 · 7 files edited')
    expect(between).toMatch(/^ {2}now {3}— +7 files edited$/)
    expect(displayWidth(running)).toBe(displayWidth(between))
  })

  test('(4) narrow shows the same sections stacked, with 10/8-cell bars', async ($, on) => {
    const scene = stage(on)
    for (const surface of SURFACES) {
      scene.data = fullContext
      const wide = await mount($, surface, 100)
      const wideIds = (await rowsOf(wide)).map(row => row.id)
      await wide.unmount()
      // Wide, the 5h and 7d windows share one row.
      expect(wideIds).toEqual(['identity', 'alerts', 'location', 'ctx', 'limits', 'spend_limit', 'now', 'motto'])

      for (const columns of [59, 56, 48, 44, 43, 40, 37]) {
        const ui = await mount($, surface, columns)
        const rows = await rowsOf(ui)
        // Every wide section, in the same order, one per row; the limits each their own.
        expect(rows.map(row => row.id), `@${columns}`).toEqual(['identity', 'alerts', 'location', 'ctx', 'five_hour', 'seven_day', 'spend_limit', 'now', 'motto'])
        const cells = columns < 44 ? SMALL_BAR_WIDTH : NARROW_BAR_WIDTH
        for (const id of ['ctx', 'five_hour', 'seven_day', 'spend_limit']) {
          expect(rowOf(rows, id)?.text.match(BAR_CELLS), `${id} @${columns}`).toHaveLength(cells)
        }
        // The facts the wide rows carry are all there.
        const text = rows.map(row => row.text).join('\n')
        for (const fact of ['opus 5.5', '1h 12m', '$4.21', '⚠ 2 agents', 'main* +3 −1 ↑2', '100%', '1.0M/1.0M', '92%', AT_5H, '64%', AT_7D, '85%', AT_SPEND, 'now   Bash', 'ship small']) {
          expect(text, `${fact} @${columns}`).toContain(fact)
        }
        expect(rowOf(rows, 'location')?.text).toBe('  ~/.claude/mods · main* +3 −1 ↑2')
        await ui.unmount()
      }
    }

    // The provider stays while the row has room for it, and gives way first.
    expect(hudLines(full, { columns: 56, isNarrow: true })[0]).not.toContain('gateway')
    expect(hudLines({ ...full, main: undefined }, { columns: 56, isNarrow: true })[0]).toContain('· gateway')
    expect(hudLines(full, { columns: 44, isNarrow: true })[0]).not.toContain('gateway')
    expect(hudLines(full, { columns: 44, isNarrow: true })[0]).toContain('opus 5.5 · xhigh')
    // The now row's right-hand cells end in line with the identity row's, clear of the close button.
    const now = hudLines(full, { columns: 56, isNarrow: true }).find(line => line.startsWith('  now')) ?? ''
    expect(now).toBe('  now   Bash  npm test -- hud   00:04 · 7 files edited')
    expect(displayWidth(now)).toBe(56 - CLOSE_RESERVE)
  })

  test('the 72-column sketch: every row, as docs/pane-sketch.md draws it', () => {
    expect(hudLines({ ...full, motto: undefined }, { columns: 72, isNarrow: false })).toEqual([
      '◆ opus 5.5 · xhigh · gateway          ● working 00:42   1h 12m   $4.21',
      `  ⚠ 2 agents waiting for permission · ${OUT_ALERT}`,
      '  ~/.claude/mods · main* +3 −1 ↑2',
      '  ctx   ━━━━━━━━────────┃───  41%  412k / 1.0M     compact in ~6 turns',
      `  5h    ━━──────  31% ${TIGHT_5H}    7d  ━───────  12% ${TIGHT_7D}`,
      '  now   Bash  npm test -- hud                   00:04 · 7 files edited',
    ])
  })

  test('narrow at 40 columns: the full sketch, every section stacked', () => {
    expect(hudLines(full, { columns: 40, isNarrow: true })).toEqual([
      '◆ opus 5.5 · xhigh      1h 12m   $4.21',
      '  ⚠ 2 agents waiting for permission · 5…',
      '  ~/.claude/mods · main* +3 −1 ↑2',
      '  ctx   ━━━───┃─  41%  412k/1.0M',
      `  5h    ━━──────  31%  ${AT_5H}`,
      `  7d    ━───────  12%  ${AT_7D}`,
      '  now   Bash    00:04 · 7 files edited',
      '  ship small, ship often',
    ])
  })

  test('narrow at 36 columns: no bars, the percent stands alone; the now row keeps its argument', () => {
    expect(hudLines(full, { columns: 36, isNarrow: true })).toEqual([
      '◆ opus 5.5          1h 12m   $4.21',
      '  ⚠ 2 agents waiting for permission…',
      '  ~/.claude/mods · main* +3 −1 ↑2',
      '  ctx    41%  412k/1.0M',
      `  5h     31%  ${AT_5H}`,
      `  7d     12%  ${AT_7D}`,
      '  now   Bash  npm test -- hud',
      '  ship small, ship often',
    ])
    expect(hudLines(fullContext, { columns: 36, isNarrow: true })[3]).toBe('  ctx   100%  1.0M/1.0M')
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
    expect(displayWidth(hudLines(full, { columns: 72, isNarrow: false }).find(line => line.startsWith('  ctx')) ?? '')).toBe(70)
    expect(displayWidth(hudLines(full, { columns: 74, isNarrow: false })[0] ?? '')).toBe(72)
    expect(hudLines(full, { columns: 40, isNarrow: true })[0]).toBe('◆ opus 5.5 · xhigh      1h 12m   $4.21')
  })

  test('right-aligned cells share the identity edge at 60 through 73 columns', () => {
    for (let columns = 60; columns <= 73; columns += 1) {
      const data = { ...full, usage: { ...full.usage!, contextTokens: undefined } }
      const lines = hudLines(data, { columns, isNarrow: false })
      const edge = displayWidth(lines[0] ?? '')
      for (const suffix of ['compactions', '00:04 · 7 files edited']) {
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

      // No limits, no git, no inventory, no tools, nothing alarming: those rows go, the rest stay.
      scene.data = { ...full, usage: { ...(full.usage ?? { compactions: 0, rateLimits: [] }), rateLimits: [] }, git: {}, inventory: { mcpServers: [] }, tools: { counts: {} }, alerts: undefined }
      const bare = await mount($, surface, 100)
      const left = await rowsOf(bare)
      expect(left.map(row => row.id)).toEqual(['identity', 'location', 'ctx', 'motto'])
      // Without the threshold the runway runs to the window.
      expect(rowOf(left, 'ctx')?.text).toEndWith('compact in ~10 turns')
      expect(rowOf(left, 'location')?.text).toBe('  ~/.claude/mods')
      await bare.unmount()
      scene.data = sparse
    }
    await eachDrawing($, scene, WIDTHS, rows => {
      for (const row of rows) expect(row.text).not.toMatch(/mcp|skills|[+~−↑↓×]0\b|0 compactions|0 files|⚠ 0|~0 turns/)
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

  test('(8) dim for the secondary, bold for the headline, colour only on bars, glyphs, the model, working and the alerts', async ($, on) => {
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
            if (row.id !== 'alerts') expect(/^[━◆●◐*]+$/.test(one.text) || one.text === MODEL || one.text === '● working', where).toBe(true)
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
        ['identity', 'gateway'], ['identity', '1h 12m'], ['identity', '00:42'], ['location', '~/.claude/mods'],
        ['ctx', 'ctx'], ['ctx', '─'], ['ctx', '┃'], ['ctx', '412k / 1.0M'], ['ctx', 'compact in ~6 turns'], ['limits', TIGHT_5H],
        ['now', 'now'], ['now', 'npm test -- hud'], ['now', '00:04'], ['now', '7 files edited'],
      ] as const) {
        expect(piece(rowOf(rows, id), text)?.props.dimColor, `${id}: ${text}`).toBe(true)
      }
      expect(piece(rowOf(rows, 'location'), '*')?.props).toEqual({ color: 'warning' })
      expect(piece(rowOf(rows, 'identity'), '● working')?.props).toEqual({ color: 'claude' })
      expect(piece(rowOf(rows, 'now'), 'Bash')?.props).toEqual({})
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
        const location = rowOf(rows, 'location')?.text ?? ''
        expect(location, `@${columns}`).toMatch(/feature\/very-long-[^ ]*…\* \+3 −1 ↑2$/)
        expect(rowOf(rows, 'motto')?.text, `@${columns}`).toEndWith('…')
        expect(todoLines(longBranch.todos, columns, TODO_ROWS, true).find(line => line.includes('Rewriting')), `@${columns}`).toMatch(/Rewriting the reconcil.*…$/)
        expect(todoLines(longBranch.todos, columns)[0], `@${columns}`).toMatch(/◐ Rewriting the rec.*…$/)
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
    const has = (lines: string[], text: string): boolean => lines.some(line => line.includes(text))
    // Wide drops the motto, now, the place, then the spend gauge; never identity, the alerts or ctx.
    const wide = (rows?: number) => hudLines(fullContext, { columns: 100, rows, isNarrow: false })
    expect(wide()).toHaveLength(8)
    expect(wide(40)).toHaveLength(8)
    const twelve = wide(12)
    expect(twelve).toHaveLength(6)
    expect(has(twelve, 'ship small')).toBe(false)
    expect(has(twelve, '  now')).toBe(false)
    expect(has(twelve, '~/.claude/mods')).toBe(true)
    expect(has(twelve, 'ctx')).toBe(true)
    expect(wide(4)).toHaveLength(4)
    expect(wide(4)[0]).toStartWith('◆')
    expect(wide(4)[1]).toStartWith('  ⚠')
    expect(has(wide(4), 'ctx')).toBe(true)
    expect(hudLines(full, { columns: 48, rows: 4, isNarrow: true })).toHaveLength(4)

    // Narrow drops the motto, now, the place, then the spend gauge, then the 7d; never identity, the alerts or ctx.
    // (The todo list is a section of its own under the HUD.)
    const narrow = (rows?: number) => hudLines(fullContext, { columns: 40, rows, isNarrow: true })
    expect(narrow()).toHaveLength(9)
    expect(narrow(18)).toHaveLength(9)
    expect(has(narrow(16), 'ship small')).toBe(false)
    expect(has(narrow(16), '  now')).toBe(true)
    expect(has(narrow(14), '  now')).toBe(false)
    expect(has(narrow(14), '~/.claude/mods')).toBe(true)
    expect(has(narrow(12), '~/.claude/mods')).toBe(false)
    expect(has(narrow(12), 'spend')).toBe(true)
    expect(has(narrow(10), 'spend')).toBe(false)
    for (const rows of [4, 6, 8, 10, 12, 14, 16, 18, 20]) {
      const lines = narrow(rows)
      expect(lines, `rows ${rows}`).toHaveLength(Math.min(9, Math.max(4, rows / 2)))
      expect(lines[0], `rows ${rows}`).toStartWith('◆')
      expect(lines[1], `rows ${rows}`).toStartWith('  ⚠')
      expect(has(lines, 'ctx'), `rows ${rows}`).toBe(true)
    }
  })

  test('a full context window reads 100 % on a full red bar, the threshold marked', () => {
    const ctx = hudLines(fullContext, { columns: 72, isNarrow: false }).find(line => line.startsWith('  ctx')) ?? ''
    expect(ctx).toContain(`${'━'.repeat(16)}┃${'━'.repeat(3)} 100%  1.0M / 1.0M`)
    // Without growth samples the runway is unknown: the compaction count stands in.
    expect(ctx).toEndWith('3 compactions')
    expect(hudLines(fullContext, { columns: 48, isNarrow: true })[3]).toBe(`  ctx   ${'━'.repeat(8)}┃━ 100%  1.0M/1.0M`)
    expect(hudLines(fullContext, { columns: 40, isNarrow: true })[3]).toBe(`  ctx   ${'━'.repeat(6)}┃━ 100%  1.0M/1.0M`)
    const unmarked = { ...fullContext, inventory: { mcpServers: [] } }
    expect(hudLines(unmarked, { columns: 72, isNarrow: false }).find(line => line.startsWith('  ctx'))).toContain(`${'━'.repeat(20)} 100%`)
  })
})

// ---------------------------------------------------------------------------
// The TODO section: its own rows between the HUD and the agents.
// ---------------------------------------------------------------------------

describe('the alert strip', () => {
  test('one row under the identity, only while something needs attention, most severe first', () => {
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
    // Colours: asks and a limit `error`, stalled and compaction `warning`, failures and behind dim `warning`.
    const looks = Object.fromEntries(alertsOf(alarmed).map(alert => [alert.id, { color: alert.color, dim: alert.dim }]))
    expect(looks).toEqual({
      asks: { color: 'error', dim: undefined },
      'limit:five_hour': { color: 'error', dim: undefined },
      stalled: { color: 'warning', dim: undefined },
      compact: { color: 'warning', dim: undefined },
      failures: { color: 'warning', dim: true },
      behind: { color: 'warning', dim: true },
    })
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

describe('the identity row\'s working cell', () => {
  test('● working mm:ss in the accent while the main loop works, ○ idle dim once it stopped, nothing before either', () => {
    const at = (main: HudData['main']) => hudLines({ ...full, main }, { columns: 72, isNarrow: false })[0] ?? ''
    expect(at({ busySince: NOW - 42_000 })).toBe('◆ opus 5.5 · xhigh · gateway          ● working 00:42   1h 12m   $4.21')
    expect(at({ idleSince: NOW - 180_000 })).toBe('◆ opus 5.5 · xhigh · gateway                ○ idle 3m   1h 12m   $4.21')
    expect(at(undefined)).toBe('◆ opus 5.5 · xhigh · gateway                            1h 12m   $4.21')
    // Busy wins over a stale idle time.
    expect(at({ busySince: NOW - 5000, idleSince: NOW - 60_000 })).toContain('● working 00:05')
  })

  test('the first to give way after the provider, before the effort', () => {
    for (let columns = 30; columns <= 74; columns += 1) {
      const line = hudLines(full, { columns, isNarrow: columns < NARROW_BELOW })[0] ?? ''
      // Whenever the working cell shows, so does the effort.
      if (line.includes('working')) expect(line, `@${columns}`).toContain('xhigh')
      expect(displayWidth(line), `@${columns}`).toBeLessThanOrEqual(columns - CLOSE_RESERVE)
    }
    expect(hudLines(full, { columns: 56, isNarrow: true })[0]).toBe('◆ opus 5.5 · xhigh    ● working 00:42   1h 12m   $4.21')
    expect(hudLines(full, { columns: 48, isNarrow: true })[0]).toBe('◆ opus 5.5 · xhigh · gateway    1h 12m   $4.21')
  })
})

describe('the ctx row', () => {
  test('the auto-compact threshold marked ┃ on the bar, and the runway at the context\'s growth per turn', () => {
    const ctx = (data: HudData, columns = 72) => hudLines(data, { columns, isNarrow: columns < NARROW_BELOW }).find(line => line.startsWith('  ctx')) ?? ''
    // 800k of 1M: the 17th of 20 cells; 412k growing 65k a turn reaches it in ~6 turns.
    expect(ctx(full)).toBe('  ctx   ━━━━━━━━────────┃───  41%  412k / 1.0M     compact in ~6 turns')
    expect(ctx(full, 56)).toBe('  ctx   ━━━━────┃─  41%  412k/1.0M')
    // No threshold known (or none below the window): no mark, and the runway runs to the window.
    const noMark = { ...full, inventory: { mcpServers: [] } }
    expect(ctx(noMark)).toBe('  ctx   ━━━━━━━━────────────  41%  412k / 1.0M    compact in ~10 turns')
    expect(ctx({ ...full, inventory: { mcpServers: [], compactAt: 1_000_000 } })).not.toContain('┃')
    // No growth known: the compaction count, as before; none either, nothing.
    const flat = { ...full, usage: { ...full.usage!, contextSamples: [412_000, 412_000] } }
    expect(ctx(flat)).toEndWith('┃───  41%  412k / 1.0M           3 compactions')
    expect(ctx({ ...flat, usage: { ...flat.usage, compactions: 0 } })).toBe('  ctx   ━━━━━━━━────────┃───  41%  412k / 1.0M')
    // A compaction's drop is left out of the growth.
    expect(compactRunway({ ...full, usage: { ...full.usage!, contextSamples: [300_000, 40_000, 105_000, 170_000] } })).toBe(Math.ceil((800_000 - 412_000) / 65_000))
  })
})

describe('the limits row', () => {
  test('wide, 5h and 7d share one row of 8-cell bars, the resets tight; narrow, each its own; spend always its own', () => {
    const wide = hudLines(fullContext, { columns: 72, isNarrow: false })
    expect(wide).toContain(`  5h    ━━━━━━━─  92% ${TIGHT_5H}    7d  ━━━━━───  64% ${TIGHT_7D}`)
    expect(wide.some(line => line.startsWith('  spend ━━━━━━━━━━━━━━━━━───  85%'))).toBe(true)
    const narrow = hudLines(fullContext, { columns: 56, isNarrow: true })
    expect(narrow).toContain(`  5h    ━━━━━━━━━─  92%  ${AT_5H}`)
    expect(narrow).toContain(`  7d    ━━━━━━────  64%  ${AT_7D}`)
    // Only one of them known: its own 20-cell gauge, wide too.
    const one: HudData = { ...full, usage: { ...full.usage!, rateLimits: [{ kind: 'seven_day', percentUsed: 12, resetsAt: RESET_7D }] } }
    expect(hudLines(one, { columns: 72, isNarrow: false })).toContain(`  7d    ━━──────────────────  12%  ${AT_7D}`)
    // The 7d half starts in one column whatever the 5h reset reads.
    for (const columns of [60, 66, 72, 100]) {
      for (const data of [full, fullContext, { ...full, usage: { ...full.usage!, rateLimits: [{ kind: 'five_hour' as const, percentUsed: 5, resetsAt: RESET_SPEND }, { kind: 'seven_day' as const, percentUsed: 7 }] } }]) {
        const row = hudLines(data, { columns, isNarrow: false }).find(line => line.startsWith('  5h')) ?? ''
        expect(row.indexOf('7d'), `@${columns}: ${row}`).toBe(32)
        expect(displayWidth(row), `@${columns}`).toBeLessThanOrEqual(columns - CLOSE_RESERVE)
      }
    }
  })
})

describe('the now row', () => {
  test('the tool running now and its main argument, its elapsed time, and the files edited at the edge', () => {
    const now = (data: HudData, columns = 72) => hudLines(data, { columns, isNarrow: columns < NARROW_BELOW }).find(line => line.startsWith('  now'))
    expect(now(full)).toBe('  now   Bash  npm test -- hud                   00:04 · 7 files edited')
    // An MCP tool keeps its own name; a long argument is cut with …; a path keeps its end.
    expect(now(manyTools)).toMatch(/^ {2}now {3}browser_tak… {2}https:\/\/example\.com\/[^ ]*… +01:05$/)
    expect(displayWidth(now(manyTools) ?? '')).toBe(70)
    const path: HudData = { ...full, tools: { ...full.tools!, current: { name: 'Edit', since: NOW - 2000, arg: '/Users/daiziqiao/.claude/mods/mod-hud/hooks/a-rather-long-module-name.tsx' } } }
    expect(now(path)).toMatch(/^ {2}now {3}Edit {2}…\/a-rather-long-module-name\.tsx +00:02 · 7 files edited$/)
    // No argument, no edits, one edit.
    const bare = now({ ...full, tools: { counts: {}, current: { name: 'Read', since: NOW - 1000 } } }) ?? ''
    expect(bare).toMatch(/^ {2}now {3}Read +00:01$/)
    const editedOnly = now({ ...full, tools: { counts: {}, edited: 1 } }) ?? ''
    expect(editedOnly).toMatch(/^ {2}now {3}— +1 file edited$/)
    expect([displayWidth(bare), displayWidth(editedOnly)]).toEqual([70, 70])
    // Nothing running and nothing edited: no row (nor with the option off).
    expect(now({ ...full, tools: { counts: { Read: 4 } } })).toBeUndefined()
    expect(now({ ...full, tools: undefined })).toBeUndefined()
  })

  test('the per-tool counts, the tokens, the cache and the MCP/skill inventory are no longer drawn', () => {
    const counted: HudData = { ...full, usage: { ...full.usage!, tokens: { input: 1_234_000, output: 84_000, cacheRead: 9_800_000, cacheWrite: 640_000 } } }
    for (const columns of [100, 72, 56, 48, 40]) {
      const text = hudLines(counted, { columns, isNarrow: columns < NARROW_BELOW }).join('\n')
      expect(text, `@${columns}`).not.toMatch(/×41|tools|tok |cache|mcp|skills|1\.2M in/)
    }
  })
})

describe('the TODO section', () => {
  test('folded (the default): one progress line, the item in progress (else the next pending) after it', () => {
    expect(todoLines(sevenTodos, 72)).toEqual(['▸ TODO  ━━━━────── 3/7  ◐ Wiring the detail view'])
    expect(todoLines(full.todos, 72)).toEqual(['▸ TODO  ━━━━━━──── 3/5  ◐ Wiring the status line'])
    // No item in progress: the next pending; every item done: the count alone, the bar full.
    expect(todoLines({ items: [{ content: 'Plan', status: 'completed' }, { content: 'Ship', status: 'pending' }] }, 72)).toEqual(['▸ TODO  ━━━━━───── 1/2  ☐ Ship'])
    expect(todoLines(allDone, 72)).toEqual(['▸ TODO  ━━━━━━━━━━ 7/7'])
    expect(todoLines({ items: [{ content: 'Plain', status: 'in_progress' }] }, 40)).toEqual(['▸ TODO  ──────── 0/1  ◐ Plain'])
    // 8 cells below 44 columns; none at 36 and under.
    expect(todoLines(sevenTodos, 36)).toEqual(['▸ TODO  3/7  ◐ Wiring the detail vi…'])
    expect(todoRows(sevenTodos, 72)).toHaveLength(1)
    expect(todoLines({ items: [] }, 72)).toEqual([])
    expect(todoLines(undefined, 72)).toEqual([])
  })

  test('open: the line (▾), then in progress, pending, completed; ☑ ◐ ☐; two cells in; capped at todoRows (6 by default)', () => {
    expect(todoLines(sevenTodos, 72, 10, true)).toEqual([
      '▾ TODO  ━━━━────── 3/7',
      '  ◐ Wiring the detail view',
      '  ☐ Test the scenes',
      '  ☐ Update the sprite sheet',
      '  ☐ Sketch the pane at 72 and 48 columns',
      '  ☑ Read the brief',
      '  ☑ Split the sprites out',
      '  ☑ Write the choreography',
    ])
    expect(TODO_ROWS).toBe(6)
    const capped = todoLines(sevenTodos, 72, TODO_ROWS, true)
    expect(capped).toHaveLength(1 + 6 + 1)
    expect(capped.at(-1)).toBe('  +1 more')
    expect(todoLines(sevenTodos, 72, 3, true).at(-1)).toBe('  +4 more')
    expect(todoRows(allDone, 72, TODO_ROWS, true).filter(row => row.status === 'completed')).toHaveLength(6)
    expect(todoLines(allDone, 72, 10, true).slice(1).every(line => line.startsWith('  ☑ '))).toBe(true)
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

  test('mounted folded: the toggle a dim Button (with one) or dim text, TODO bold, the fill success, ◐ in the accent', async ($, on) => {
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
      for (const columns of [72, 48]) {
        const ui = await mountTodos(surface, 'folded', columns)
        const button = await ui.find({ key: 'todos:toggle' })
        expect(button?.props.label).toBe('▸')
        expect(button?.props.dimColor).toBe(true)
        // Its press is the caller's: the hooks write `listView.todosExpanded` (register-hud.test.ts presses it in the pane).
        if (surface === 'desktop') {
          const source = rowSource(await ui.find({ key: 'todo:header' })) ?? ''
          // The Button's cell is left blank in the document; the rest reads as the terminal's.
          expect(textLine(source)).toBe('  TODO  ━━━━────── 3/7  ◐ Wiring the detail view')
          const pieces = textPieces(source)
          expect(pieces.find(one => one.text === 'TODO')?.props).toEqual({ bold: true })
          expect(pieces.find(one => one.text === '◐')?.props).toEqual({ color: 'claude' })
          expect(source).toContain(`<g class='g' fill='${SCENE_THEMES.dark.success}'><rect x='64' y='7' width='32' height='3'/></g>`)
          expect(await ui.findAll({ type: 'Text' })).toEqual([])
        } else {
          const header = await ui.find({ key: 'todo:header' })
          expect(header?.text).toBe('▸ TODO  ━━━━────── 3/7  ◐ Wiring the detail view')
          const texts = await ui.findAll({ type: 'Text' })
          expect(texts.find(one => one.text === 'TODO')?.props.bold).toBe(true)
          expect(texts.find(one => one.text === '━━━━')?.props.color).toBe('success')
          expect(texts.find(one => one.text === '◐')?.props.color).toBe('claude')
          expect(await ui.findAll({ type: 'Svg' })).toEqual([])
        }
        await ui.unmount()

        // Without a Button the toggle is dim text, and the line reads the same.
        const plainUi = await mountTodos(surface, 'plain', columns)
        expect(await plainUi.find({ key: 'todos:toggle' })).toBe(undefined)
        if (surface === 'terminal') expect((await plainUi.find({ key: 'todo:header' }))?.text).toBe('▸ TODO  ━━━━────── 3/7  ◐ Wiring the detail view')
        else expect(textLine(rowSource(await plainUi.find({ key: 'todo:header' })) ?? '')).toBe('▸ TODO  ━━━━────── 3/7  ◐ Wiring the detail view')
        await plainUi.unmount()
      }
    }
  })

  test('mounted open: ▾ on the line, completed struck through and dim, ◐ in the accent, +n more dim', async ($, on) => {
    on('ui.render', { component: 'Pane', requestId: 'todos-under-test' }, ($$, e) => {
      const table = $$.ui.resolve(e)

      return renderTodos({ ...elementsFor(e.surface, table), Button: table.Button }, sevenTodos, { columns: e.props.bodyColumns, expanded: true, onToggle: () => undefined }).element ?? table.Box({})
    })
    for (const surface of SURFACES) {
      for (const columns of [72, 48]) {
        const ui = await $.ui.mount({ plugin: 'mod-hud', surface, component: 'Pane', requestId: 'todos-under-test', props: { ...PANE_PROPS, bodyColumns: columns }, viewport: VIEWPORT })
        expect((await ui.find({ key: 'todos:toggle' }))?.props.label).toBe('▾')
        if (surface === 'desktop') {
          // In pixels: each row its own Svg, read back to the same text and looks.
          const row = async (key: string) => {
            const source = rowSource(await ui.find({ key })) ?? ''

            return { text: textLine(source), pieces: textPieces(source) }
          }
          expect((await row('todo:header')).text).toBe('  TODO  ━━━━────── 3/7')
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
        expect((await ui.find({ key: 'todo:header' }))?.text).toBe('▾ TODO  ━━━━────── 3/7')
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
    // ctx at 41 %: eight cells of fill, a thick rect in the success colour; twelve of track, thin dim
    // ones either side of the compaction threshold's ┃, a dim glyph in its own cell.
    const ctx = await source('ctx')
    expect(ctx).toContain(`<g class='g' fill='${SCENE_THEMES.dark.success}'><rect x='64' y='7' width='64' height='3'/></g>`)
    expect(ctx).toMatch(new RegExp(`<g class='f' fill='${SCENE_THEMES.dark.text}' opacity='\\.55'>[^]*<rect x='128' y='8' width='64' height='1'/><text x='192' y='12'>┃</text><rect x='200' y='8' width='24' height='1'/>`))
    expect(ctx).not.toContain('━')
    expect(ctx).not.toContain('─')
    // The motto is dim and italic.
    expect(await source('motto')).toContain(`opacity='.55' font-style='italic'`)
    expect(textRuns(await source('motto'))).toEqual([{ x: 2, text: 'ship small, ship often', props: { dimColor: true, italic: true } }])
    // The alt is the row in words, its bars left out.
    const ctxSvg = svgsOf(await ui.find({ key: 'hud:ctx' }))[0]
    expect(ctxSvg?.props?.alt).toBe('ctx ┃ 41% 412k / 1.0M compact in ~6 turns')
    await ui.unmount()
  })
})
