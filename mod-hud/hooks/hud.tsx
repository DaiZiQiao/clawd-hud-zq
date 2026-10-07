import type { BoxProps, ButtonProps, ElementConstructor, RenderElement, SvgProps, TextProps } from 'claude-code'

import type { HudData, HudGit, HudLayout, HudRateLimit, HudTodo, HudUsage } from '../types'
import { contextGrowth, limitEta, turnsUntil } from './facts'
import { renderTextRow } from './text-svg'
import type { TextCell, TextSpan } from './text-svg'
import { displayWidth, padEnd, padStart, truncate, truncateStart } from './text-width'

// The HUD drawn at the top of the mod-hud pane: pure functions from one
// `HudData` to a tree, plus the plain-text status line. Layout and rationale:
// docs/pane-sketch.md.

/**
 * The two elements the HUD draws with; every surface's table has both. With
 * `Svg` each row is drawn in pixels instead (hooks/text-svg.ts): pass it
 * where the pane's text is no grid (the desktop sets it in a proportional
 * font), never the whole table elsewhere, since every table carries one.
 */
export type HudElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Svg?: ElementConstructor<SvgProps>
}

// Theme keys, so the HUD follows the person's theme on dark and light alike.
const ACCENT = 'claude'
const GOOD = 'success'
const WARN = 'warning'
const HOT = 'error'

/** The card's widest: right-hand cells stay beside what they describe. */
const CARD_MAX = 72
/**
 * The engine draws the pane's close button (`×`) over the last cell of the
 * first body row: that row stops this many cells short of `columns`.
 */
export const CLOSE_RESERVE = 2
const INDENT = '  '
const LABEL_WIDTH = 6
/** Every wide bar is this many cells, context and rate limits alike. */
export const BAR_WIDTH = 20
/** Narrow bars: this many cells below 60 columns... */
export const NARROW_BAR_WIDTH = 10
/** ...this many below SMALL_BELOW columns... */
export const SMALL_BAR_WIDTH = 8
const SMALL_BELOW = 44
/** ...and none at this many columns and under: `ctx    41%`. */
export const BARLESS_AT = 36
const FILL = '━'
const TRACK = '─'
const PERCENT_WIDTH = 4
const CLOCK_WIDTH = 7
const COST_WIDTH = 6
const TOKENS_WIDTH = 4
/** The identity row's working/idle cell: `● working 1h 12m` at its widest. */
const ACTIVITY_WIDTH = 16
/** The `now` row's elapsed time: `00:04` to `1h 12m`, right-aligned. */
const ELAPSED_WIDTH = 6
const TOOL_NAME_MAX = 12
/** The auto-compact threshold's cell on the ctx bar. */
const MARK = '┃'
const PATH_KEEP = 12
const BRANCH_KEEP = 8
const MIN_ROWS = 4
const STATUS_MAX = 100
const DAY_MS = 86_400_000

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const LIMITS: readonly { kind: HudRateLimit['kind']; label: string; rank: number }[] = [
  { kind: 'five_hour', label: '5h', rank: 85 },
  { kind: 'seven_day', label: '7d', rank: 80 },
  { kind: 'spend_limit', label: 'spend', rank: 72 },
]

// Text from the world (a branch, a todo, a motto) is one line of printable text.
const clean = (text: unknown): string =>
  typeof text === 'string'
    ? text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim()
    : ''

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const countOf = (value: unknown): number => (isNumber(value) && value > 0 ? Math.floor(value) : 0)

const pad2 = (n: number): string => String(n).padStart(2, '0')

// --- formats -----------------------------------------------------------------

/** `950`, `4.5k`, `412k`, `1.0M`, `12M`: four cells at most below 1000M. */
export const formatTokens = (n: number): string => {
  if (!isNumber(n) || n <= 0) return '0'
  if (Math.round(n) < 1000) return String(Math.round(n))
  const thousands = n / 1000
  if (thousands < 9.95) return `${thousands.toFixed(1)}k`
  if (thousands < 999.5) return `${Math.round(thousands)}k`
  const millions = n / 1_000_000

  return millions < 9.95 ? `${millions.toFixed(1)}M` : `${Math.round(millions)}M`
}

/** `04:02` below an hour, `1h 12m` from there; a negative span reads `00:00`. */
export const formatDuration = (ms: number): string => {
  const total = isNumber(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)

  return hours > 0 ? `${hours}h ${pad2(minutes)}m` : `${pad2(minutes)}:${pad2(total % 60)}`
}

/**
 * A moment ahead, in local time: `14:20` within a day, `Tue` within a week,
 * `Nov 1` past that, `now` once due.
 */
export const whenOf = (at: number, now: number): string => {
  const ahead = at - now
  if (ahead <= 0) return 'now'
  const date = new Date(at)
  if (ahead < DAY_MS) return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  if (ahead < 7 * DAY_MS) return DAYS[date.getDay()] ?? ''

  return `${MONTHS[date.getMonth()]} ${date.getDate()}`
}

/**
 * When a limit resets, in local time: `↻ 14:20` within a day, `↻ Tue` within
 * a week, `↻ Nov 1` past that, `↻ now` once due; `''` for an unreadable time.
 */
export const formatReset = (iso: string, now: number): string => {
  const at = typeof iso === 'string' ? Date.parse(iso) : Number.NaN
  if (!Number.isFinite(at)) return ''

  return `↻ ${whenOf(at, now)}`
}

/** How long the main loop has been idle: `45s`, `3m`, `1h 05m`. */
export const formatIdle = (ms: number): string => {
  const total = isNumber(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  if (total < 60) return `${total}s`
  if (total < 3600) return `${Math.floor(total / 60)}m`

  return `${Math.floor(total / 3600)}h ${pad2(Math.floor((total % 3600) / 60))}m`
}

/** Always two decimals: `$0.07`, `$4.21`, `$52.60`, `$123.45`; six cells below $100. */
export const formatCost = (usd: number): string => {
  if (!isNumber(usd) || usd <= 0) return '$0.00'

  return `$${usd.toFixed(2)}`
}

const filledOf = (percent: number, cells: number): number => {
  if (!isNumber(percent) || percent <= 0 || cells === 0) return 0
  if (percent >= 100) return cells

  return Math.min(cells - 1, Math.max(1, Math.round((percent / 100) * cells)))
}

/**
 * A bar of exactly `width` cells: `━` filled, `─` the empty track (a line,
 * not a shade, so stacked bars never merge into one block). Any value above
 * zero fills at least one cell, and only 100 % fills them all.
 */
export const bar = (percent: number, width: number): string => {
  const cells = Math.max(0, Math.floor(isNumber(width) ? width : 0))
  const filled = filledOf(percent, cells)

  return FILL.repeat(filled) + TRACK.repeat(cells - filled)
}

/** A gauge's bar cells: 20 wide; narrow, 10, then 8 below 44 columns, and none at 36 and under. */
export const barWidthFor = (columns: number, isNarrow: boolean): number => {
  if (!isNarrow) return BAR_WIDTH
  if (columns <= BARLESS_AT) return 0

  return columns < SMALL_BELOW ? SMALL_BAR_WIDTH : NARROW_BAR_WIDTH
}

/** `claude-opus-5-5[1m]` reads `opus 5.5`; anything else passes through. */
export const modelLabel = (model: string): string => {
  const base = clean(model)
    .replace(/\[[^\]]*\]$/, '')
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
  const named = /^([a-z]+)-(\d+)(?:-(\d+))?$/.exec(base)
  if (named === null) return base

  return `${named[1]} ${named[2]}${named[3] === undefined ? '' : `.${named[3]}`}`
}

// `mcp__github__create_issue` reads `github:create_issue`; cut to `width`, an
// MCP tool keeps its own name and drops the server's (`create_issue`).
const toolLabel = (name: string, width: number): string => {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name)
  const label = clean(mcp === null ? name : `${mcp[1]}:${mcp[2]}`)
  const colon = label.indexOf(':')
  if (displayWidth(label) <= width || colon <= 0 || colon === label.length - 1) return truncate(label, width)

  return truncate(label.slice(colon + 1), width)
}

const tildify = (path: string): string =>
  path
    .replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~')
    .replace(/^\/root(?=\/|$)/, '~')
    .replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/, '~')
    .replace(/(.)[/\\]+$/, '$1')

// A path loses its leading directories first: `…/mods-staging/mod-hud`.
const fitPath = (path: string, width: number): string => {
  if (displayWidth(path) <= width) return path
  const parts = path.split('/')
  for (let index = 1; index < parts.length; index += 1) {
    const tail = `…/${parts.slice(index).join('/')}`
    if (displayWidth(tail) <= width) return tail
  }

  return truncateStart(parts.at(-1) ?? path, width)
}

// --- the facts, read ---------------------------------------------------------

const contextPercentOf = (usage: HudUsage | undefined): number | undefined => {
  if (usage === undefined) return undefined
  if (isNumber(usage.contextPercent)) return usage.contextPercent
  if (isNumber(usage.contextTokens) && isNumber(usage.window) && usage.window > 0) {
    return (usage.contextTokens / usage.window) * 100
  }

  return undefined
}

/** The percent as drawn; its colour and its bar follow this, not the raw value. */
const shownPercent = (percent: number): number => Math.min(999, Math.max(0, Math.round(percent)))

/** Below 60 % `success`, below 85 % `warning`, from there `error`. */
export const levelColor = (percent: number): string => {
  const shown = shownPercent(percent)

  return shown >= 85 ? HOT : shown >= 60 ? WARN : GOOD
}

const limitOf = (usage: HudUsage | undefined, kind: HudRateLimit['kind']): HudRateLimit | undefined =>
  (Array.isArray(usage?.rateLimits) ? usage.rateLimits : []).find(one => one?.kind === kind && isNumber(one.percentUsed))

const isDirtyOf = (git: HudGit | undefined): boolean => git?.dirty === true || (isNumber(git?.dirty) && git.dirty > 0)

// `+3 ~1 −1 ↑2 ↓1`: paths added, modified and deleted, commits ahead and behind.
const gitMarksOf = (git: HudGit | undefined): string => {
  const added = countOf(git?.added)
  const deleted = countOf(git?.deleted)
  const modified = isNumber(git?.dirty) ? Math.max(0, countOf(git?.dirty) - added - deleted) : 0
  const marks: [string, number][] = [['+', added], ['~', modified], ['−', deleted], ['↑', countOf(git?.ahead)], ['↓', countOf(git?.behind)]]

  return marks.filter(([, n]) => n > 0).map(([mark, n]) => `${mark}${n}`).join(' ')
}

const todoItemsOf = (data: HudData): HudTodo[] =>
  (Array.isArray(data.todos?.items) ? data.todos.items : []).filter(item => clean(item?.content) !== '')

// --- spans and rows ----------------------------------------------------------

type Style = { color?: string; bold?: boolean; dimColor?: boolean; italic?: boolean }
type Span = { text: string; style?: Style }
type Row = { id: string; rank: number; spans: Span[] }

/** Where a row draws: free text runs to `card`, right-hand cells end at `edge`. */
type Room = { card: number; edge: number }

/** How rows draw at this width. */
type Look = {
  isNarrow: boolean
  /** A gauge's bar cells; 0 draws the percent alone. */
  bar: number
}

const plain = (text: string): Span => ({ text })
const dim = (text: string): Span => ({ text, style: { dimColor: true } })
const strong = (text: string): Span => ({ text, style: { bold: true } })
const tint = (text: string, color: string): Span => ({ text, style: { color } })
const SEPARATOR = (): Span => dim(' · ')

const widthOf = (spans: readonly Span[]): number => spans.reduce((sum, span) => sum + displayWidth(span.text), 0)

const textOf = (spans: readonly Span[]): string => spans.map(span => span.text).join('')

/** The spans cut to `limit` cells, the cut span ending in `…`. */
const clip = (spans: readonly Span[], limit: number): Span[] => {
  const kept: Span[] = []
  let used = 0
  for (const span of spans) {
    const width = displayWidth(span.text)
    if (used + width <= limit) {
      kept.push(span)
      used += width
      continue
    }
    const room = limit - used
    if (room > 0) kept.push({ ...span, text: truncate(span.text, room) })
    break
  }

  return kept
}

/** `right` flush with the card's right edge, or left off when it cannot fit. */
const anchor = (left: readonly Span[], right: readonly Span[], width: number, gap = 2): Span[] => {
  const leftWidth = widthOf(left)
  const rightWidth = widthOf(right)
  if (rightWidth === 0 || leftWidth + gap + rightWidth > width) return [...left]

  return [...left, plain(' '.repeat(width - leftWidth - rightWidth)), ...right]
}

const labelled = (label: string): Span[] => [plain(INDENT), dim(padEnd(label, LABEL_WIDTH))]

// `● working 00:42` (the accent) while the main loop works, `○ idle 3m`
// (dim) once it stopped; nothing before either is known. Its cell is a fixed
// ACTIVITY_WIDTH, so the clock and the cost after it never move on the tick.
const activitySpans = (data: HudData): Span[] => {
  const main = data.main
  if (isNumber(main?.busySince)) return [tint('● working', ACCENT), dim(` ${formatDuration(data.now - main.busySince)}`)]
  if (isNumber(main?.idleSince)) return [dim(`○ idle ${formatIdle(data.now - main.idleSince)}`)]

  return []
}

// `◆ opus 5.5 · xhigh · gateway   ● working 00:42   1h 12m   $4.21`: the
// provider, then the working/idle cell, then the effort give way when the row
// runs short.
const identityRow = (data: HudData, { card, edge }: Room): Span[] | undefined => {
  const session = data.session
  const model = modelLabel(clean(session?.model))
  const effort = clean(session?.effort)
  const provider = clean(session?.provider)
  const startedAt = session?.startedAt
  const clock = isNumber(startedAt) ? formatDuration(data.now - startedAt) : undefined
  const costUsd = data.usage?.costUsd
  const cost = isNumber(costUsd) ? formatCost(costUsd) : undefined
  if (model === '' && effort === '' && provider === '' && clock === undefined && cost === undefined) return undefined

  const base: Span[] = []
  if (clock !== undefined) base.push(dim(padStart(clock, CLOCK_WIDTH)))
  if (cost !== undefined) base.push(...(base.length > 0 ? [plain('  ')] : []), strong(padStart(cost, COST_WIDTH)))
  const activity = activitySpans(data)
  const withActivity: Span[] = activity.length === 0
    ? base
    : [plain(' '.repeat(Math.max(0, ACTIVITY_WIDTH - widthOf(activity)))), ...activity, ...(base.length > 0 ? [plain('  ')] : []), ...base]
  const head: Span[] = [tint('◆', ACCENT), plain(' ')]
  const roomBeside = (right: readonly Span[]): number => edge - widthOf(head) - (right.length > 0 ? widthOf(right) + 2 : 0)

  const build = (withEffort: boolean, withProvider: boolean): Span[] => {
    const spans: Span[] = []
    const add = (span: Span): void => {
      if (spans.length > 0) spans.push(SEPARATOR())
      spans.push(span)
    }
    if (model !== '') add({ text: model, style: { color: ACCENT, bold: true } })
    if (effort !== '' && withEffort) add(strong(effort))
    if (provider !== '' && withProvider) add(dim(provider))

    return spans
  }

  // The working/idle cell holds only while the model and its effort still fit beside it.
  let right = withActivity
  let room = roomBeside(right)
  if (activity.length > 0 && room < widthOf(build(true, false))) {
    right = base
    room = roomBeside(right)
  }
  if (room < Math.min(8, Math.max(1, displayWidth(model)))) {
    right = []
    room = card - widthOf(head)
  }

  let body = build(true, true)
  if (widthOf(body) > room) body = build(true, false)
  if (widthOf(body) > room) body = build(false, false)

  return anchor([...head, ...clip(body, Math.max(0, room))], right, edge)
}

// --- the alert strip -----------------------------------------------------------
// One row under the identity, only while something needs attention: agents
// waiting on a permission ask, a limit that runs out before it resets, agents
// stalled, a compaction a few turns off, calls denied or failed, the branch
// behind its upstream. Most severe first; no row at all otherwise.

/** One thing that needs attention, as the alert strip draws it. */
export type HudAlert = { id: string; text: string; color: string; dim?: true }

/** The turns left before the context compacts (at the auto-compact threshold, else the window), at its growth per turn. */
export const compactRunway = (data: HudData): number | undefined => {
  const usage = data.usage
  const tokens = usage?.contextTokens
  const window = usage?.window
  const compactAt = data.inventory?.compactAt
  const cap = isNumber(compactAt) && compactAt > 0 ? compactAt : isNumber(window) && window > 0 ? window : undefined

  return turnsUntil(isNumber(tokens) ? tokens : undefined, cap, contextGrowth(usage?.contextSamples))
}

/** Within this many turns of compacting, the strip says so. */
export const COMPACT_SOON_TURNS = 3

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** What needs attention now, most severe first; empty when nothing does. */
export const alertsOf = (data: HudData): HudAlert[] => {
  const alerts: HudAlert[] = []
  const asks = countOf(data.alerts?.asks)
  if (asks > 0) alerts.push({ id: 'asks', text: `${plural(asks, 'agent')} waiting for permission`, color: HOT })

  // A window whose burn of the last 30 minutes reaches 100 % before it resets.
  for (const { kind, label } of LIMITS) {
    const limit = limitOf(data.usage, kind)
    if (limit === undefined) continue
    const eta = limitEta(data.usage?.limitSamples?.[kind], limit.percentUsed, data.now)
    if (eta === undefined) continue
    const out = data.now + eta
    const resets = limit.resetsAt === undefined ? Number.NaN : Date.parse(limit.resetsAt)
    if (Number.isFinite(resets) && resets <= out) continue
    const before = Number.isFinite(resets) ? `, before ↻${whenOf(resets, data.now)}` : ''
    alerts.push({ id: `limit:${kind}`, text: `${label} out ~${whenOf(out, data.now)}${before}`, color: HOT })
  }

  const stalled = countOf(data.alerts?.stalled)
  if (stalled > 0) alerts.push({ id: 'stalled', text: `${plural(stalled, 'agent')} stalled`, color: WARN })

  const runway = compactRunway(data)
  if (runway !== undefined && runway <= COMPACT_SOON_TURNS) alerts.push({ id: 'compact', text: `compact in ~${plural(runway, 'turn')}`, color: WARN })

  const failures = countOf(data.alerts?.failures)
  if (failures > 0) alerts.push({ id: 'failures', text: `${plural(failures, 'call')} denied or failed`, color: WARN, dim: true })

  const behind = countOf(data.git?.behind)
  if (behind > 0 && clean(data.git?.branch) !== '') alerts.push({ id: 'behind', text: `↓${behind} behind`, color: WARN, dim: true })

  return alerts
}

// `⚠ 2 agents waiting for permission · 5h out ~15:40, before ↻16:20`: the
// glyph in the most severe alert's colour, each alert in its own, cut to the card.
const alertsRow = (data: HudData, { card }: Room): Span[] | undefined => {
  const alerts = alertsOf(data)
  const first = alerts[0]
  if (first === undefined) return undefined
  const spans: Span[] = [plain(INDENT), tint('⚠', first.color), plain(' ')]
  alerts.forEach((alert, index) => {
    if (index > 0) spans.push(SEPARATOR())
    spans.push({ text: alert.text, style: alert.dim === true ? { color: alert.color, dimColor: true } : { color: alert.color } })
  })

  return clip(spans, card)
}

// `~/.claude/mods · main* +3 −1 ↑2`
const locationRow = (data: HudData, { card }: Room): Span[] | undefined => {
  const where = clean(data.session?.cwd) || clean(data.session?.repoRoot)
  const path = where === '' ? '' : tildify(where)
  const branch = clean(data.git?.branch)
  const isDirty = isDirtyOf(data.git)
  const changes = branch === '' ? '' : gitMarksOf(data.git)
  if (path === '' && branch === '') return undefined

  const gitTail = branch === '' ? 0 : (isDirty ? 1 : 0) + (changes === '' ? 0 : 1 + displayWidth(changes))
  const between = path !== '' && branch !== '' ? 3 : 0
  const natural = displayWidth(path) + between + displayWidth(branch) + gitTail
  const budget = card - INDENT.length

  let shownPath = path
  let shownBranch = branch
  if (natural > budget) {
    // The path gives way first, down to its last directories; the branch keeps
    // at least BRANCH_KEEP cells, and past that the path goes altogether.
    const room = budget - gitTail - between
    const branchWidth = displayWidth(branch)
    const pathRoom = Math.min(
      Math.max(Math.min(displayWidth(path), PATH_KEEP), room - branchWidth),
      room - Math.min(branchWidth, BRANCH_KEEP),
    )
    shownPath = path === '' || pathRoom < 4 ? '' : fitPath(path, pathRoom)
    const branchRoom = shownPath === '' ? budget - gitTail : room - displayWidth(shownPath)
    shownBranch = truncate(branch, branchRoom)
  }

  const left: Span[] = [plain(INDENT)]
  if (shownPath !== '') left.push(dim(shownPath))
  if (shownBranch !== '') {
    if (shownPath !== '') left.push(SEPARATOR())
    left.push(plain(shownBranch))
    if (isDirty) left.push(tint('*', WARN))
    if (changes !== '') left.push(dim(` ${changes}`))
  }
  if (left.length === 1) return undefined

  return clip(left, card)
}

/**
 * A gauge's bar as spans: the fill coloured, the track dim, and with `mark`
 * (a cell index) that one cell a dim `┃` in place of whatever it held.
 */
const barSpans = (shown: number, cells: number, mark?: number): Span[] => {
  const filled = filledOf(shown, cells)
  const color = levelColor(shown)
  if (mark === undefined || mark < 0 || mark >= cells) return [tint(FILL.repeat(filled), color), dim(TRACK.repeat(cells - filled))]
  if (mark < filled) {
    return [tint(FILL.repeat(mark), color), dim(MARK), tint(FILL.repeat(filled - mark - 1), color), dim(TRACK.repeat(cells - filled))]
  }

  return [tint(FILL.repeat(filled), color), dim(TRACK.repeat(mark - filled)), dim(MARK), dim(TRACK.repeat(cells - mark - 1))]
}

// `ctx   ━━━━━━━━────────┃───  41%  412k / 1.0M       compact in ~6 turns`;
// narrow the bar is shorter, and at 36 columns and under the percent stands alone.
const gaugeRow = (label: string, percent: number | undefined, detail: Span[], trailing: Span[], { card, edge }: Room, look: Look, mark?: number): Span[] => {
  if (percent === undefined) {
    return clip([...labelled(label), dim('—'), ...(detail.length > 0 ? [plain('  '), ...detail] : [])], card)
  }
  const shown = shownPercent(percent)
  const spans: Span[] = [
    ...labelled(label),
    // The fill and the track are separate spans: the fill coloured, the track dim.
    ...barSpans(shown, look.bar, mark),
    plain(`${look.bar > 0 ? ' ' : ''}${padStart(`${shown}%`, PERCENT_WIDTH)}`),
    ...(detail.length > 0 ? [plain('  '), ...detail] : []),
  ].filter(span => span.text !== '')

  return anchor(clip(spans, card), trailing, edge)
}

/** The bar cell the auto-compact threshold falls in, when it is known and below the window. */
const compactMarkOf = (data: HudData, cells: number): number | undefined => {
  const compactAt = data.inventory?.compactAt
  const window = data.usage?.window
  if (cells === 0 || !isNumber(compactAt) || !isNumber(window) || compactAt <= 0 || compactAt >= window) return undefined

  return Math.min(cells - 1, Math.max(0, Math.round((compactAt / window) * cells)))
}

const contextRow = (data: HudData, room: Room, look: Look): Span[] | undefined => {
  const usage = data.usage
  const percent = contextPercentOf(usage)
  const tokens = usage?.contextTokens
  const window = usage?.window
  if (percent === undefined && !isNumber(tokens) && clean(data.session?.model) === '') return undefined
  // `412k / 1.0M` wide, `412k/1.0M` narrow.
  const over = look.isNarrow ? '/' : ' / '
  const detail = isNumber(tokens)
    ? [dim(`${padStart(formatTokens(tokens), TOKENS_WIDTH)}${isNumber(window) && window > 0 ? `${over}${formatTokens(window)}` : ''}`)]
    : []
  // The runway to the next compaction when its growth is known, else how many there were.
  const runway = compactRunway(data)
  const compactions = countOf(usage?.compactions)
  const trailing = runway !== undefined
    ? [dim(`compact in ~${plural(runway, 'turn')}`)]
    : compactions > 0 ? [dim(plural(compactions, 'compaction'))] : []

  return gaugeRow('ctx', percent, detail, trailing, room, look, compactMarkOf(data, look.bar))
}

const limitRow = (data: HudData, kind: HudRateLimit['kind'], label: string, room: Room, look: Look): Span[] | undefined => {
  const limit = limitOf(data.usage, kind)
  if (limit === undefined) return undefined
  const reset = limit.resetsAt === undefined ? '' : formatReset(limit.resetsAt, data.now)

  return gaugeRow(label, limit.percentUsed, reset === '' ? [] : [dim(reset)], [], room, look)
}

/** Where the 7d half of the shared limits row starts: past the 5h half's widest reset (`↻Nov 12`). */
const SECOND_LIMIT_AT = 32

// `5h    ━━━━━━──  31% ↻14:20  7d  ━───────  12% ↻Tue`: the two windows on
// one row, wide only, 8-cell bars each, the resets tight against their percent.
const sharedLimitsRow = (data: HudData, { card }: Room): Span[] | undefined => {
  const five = limitOf(data.usage, 'five_hour')
  const seven = limitOf(data.usage, 'seven_day')
  if (five === undefined || seven === undefined) return undefined
  const half = (label: string, labelWidth: number, limit: HudRateLimit): Span[] => {
    const shown = shownPercent(limit.percentUsed)
    const reset = limit.resetsAt === undefined ? '' : formatReset(limit.resetsAt, data.now).replace('↻ ', '↻')

    return [
      dim(padEnd(label, labelWidth)),
      ...barSpans(shown, SMALL_BAR_WIDTH),
      plain(` ${padStart(`${shown}%`, PERCENT_WIDTH)}`),
      ...(reset === '' ? [] : [dim(` ${reset}`)]),
    ].filter(span => span.text !== '')
  }
  const first = [plain(INDENT), ...half('5h', LABEL_WIDTH, five)]
  const second = half('7d', 4, seven)

  return clip([...first, plain(' '.repeat(Math.max(2, SECOND_LIMIT_AT - widthOf(first)))), ...second], card)
}

/** A main argument that is a path reads from the home `~` and loses its leading directories first; any other is cut at its end. */
const fitArg = (arg: string, width: number): string => {
  if (width <= 0) return ''
  if (/^(?:\/|~|[A-Za-z]:\\)/.test(arg) && !/\s/.test(arg)) return fitPath(tildify(arg), width)

  return truncate(arg, width)
}

// `now   Bash  npm test -- hud                  00:04 · 7 files edited`: the
// main loop's tool running now and its main argument, how long it has run,
// and how many files the conversation edited. The elapsed time keeps a fixed
// cell and the count ends at the identity's edge, so neither moves on the tick.
const nowRow = (data: HudData, { card, edge }: Room): Span[] | undefined => {
  const current = data.tools?.current
  const name = typeof current?.name === 'string' ? toolLabel(current.name, TOOL_NAME_MAX) : ''
  const edited = countOf(data.tools?.edited)
  if (name === '' && edited === 0) return undefined

  const head = labelled('now')
  let right: Span[] = []
  if (name !== '') right.push(dim(padStart(formatDuration(data.now - (isNumber(current?.since) ? current.since : data.now)), ELAPSED_WIDTH)))
  if (edited > 0) right.push(...(right.length > 0 ? [SEPARATOR()] : []), dim(`${plural(edited, 'file')} edited`))
  // The right-hand cells hold while the tool's name still fits beside them.
  let room = edge - widthOf(right) - 2
  if (right.length > 0 && room < widthOf(head) + Math.max(1, displayWidth(name))) {
    right = []
    room = card
  }
  if (name === '') return anchor(clip([...head, dim('—')], room), right, edge)

  const arg = clean(current?.arg)
  const argRoom = room - widthOf(head) - displayWidth(name) - 2
  const shownArg = arg === '' || argRoom < 4 ? '' : fitArg(arg, argRoom)
  const left: Span[] = [...head, plain(name), ...(shownArg === '' ? [] : [plain('  '), dim(shownArg)])]

  return anchor(clip(left, room), right, edge)
}

const mottoRow = (data: HudData, { card }: Room): Span[] | undefined => {
  const motto = clean(data.motto)
  if (motto === '') return undefined

  return clip([plain(INDENT), { text: motto, style: { dimColor: true, italic: true } }], card)
}

/** A row the HUD may draw: its rank decides what a short pane keeps. */
type Line = { id: string; rank: number; draw: (room: Room) => Span[] | undefined }

const rowsOf = (data: HudData, layout: HudLayout): Row[] => {
  const columns = isNumber(layout.columns) ? Math.max(0, Math.floor(layout.columns)) : 0
  const card = Math.min(columns, CARD_MAX)
  const edge = Math.min(card, Math.max(0, columns - CLOSE_RESERVE))
  const isNarrow = layout.isNarrow
  const look: Look = { isNarrow, bar: barWidthFor(columns, isNarrow) }

  // Wide, the 5h and 7d windows share a row; narrow, each takes its own.
  const sharesLimits = !isNarrow && limitOf(data.usage, 'five_hour') !== undefined && limitOf(data.usage, 'seven_day') !== undefined
  const limits: Line[] = sharesLimits
    ? [
        { id: 'limits', rank: 85, draw: room => sharedLimitsRow(data, room) },
        { id: 'spend_limit', rank: 72, draw: room => limitRow(data, 'spend_limit', 'spend', room, look) },
      ]
    : LIMITS.map(({ kind, label, rank }): Line => ({ id: kind, rank, draw: room => limitRow(data, kind, label, room, look) }))

  // Wide and narrow draw the same sections in the same order. A short pane
  // drops the motto, now, the place, then the limits; never identity, the
  // alerts or ctx. The todo list is a section of its own under the HUD
  // (renderTodos).
  const lines: Line[] = [
    { id: 'identity', rank: 100, draw: room => identityRow(data, room) },
    { id: 'alerts', rank: 95, draw: room => alertsRow(data, room) },
    { id: 'location', rank: 70, draw: room => locationRow(data, room) },
    { id: 'ctx', rank: 90, draw: room => contextRow(data, room, look) },
    ...limits,
    { id: 'now', rank: 50, draw: room => nowRow(data, room) },
    { id: 'motto', rank: 10, draw: room => mottoRow(data, room) },
  ]

  // All right-hand cells share the first row's edge, clear of the close button.
  const room: Room = { card, edge }
  const drawn = lines.flatMap(line => {
    const spans = line.draw(room)

    return spans !== undefined && widthOf(spans) > 0 ? [{ line, spans }] : []
  })
  // The motto is the HUD's last row, never a HUD of its own: with nothing else known, nothing is drawn.
  if (drawn.every(one => one.line.id === 'motto')) return []
  const budget = isNumber(layout.rows) ? Math.max(MIN_ROWS, Math.floor(layout.rows / 2)) : Number.POSITIVE_INFINITY
  const keptIds = new Set([...drawn].sort((a, b) => b.line.rank - a.line.rank).slice(0, budget).map(one => one.line.id))
  const kept = drawn.filter(one => keptIds.has(one.line.id))

  // The first row (the identity, whenever it draws) stops short of the close
  // button the engine draws over the pane's last cell.
  return kept.flatMap(({ line, spans }, index) => {
    const shown = index === 0 ? line.draw({ card: edge, edge }) : spans

    return shown !== undefined && widthOf(shown) > 0 ? [{ id: line.id, rank: line.rank, spans: shown }] : []
  })
}

// Neighbouring spans of one style draw as one.
const merged = (spans: readonly Span[]): Span[] =>
  spans.reduce<Span[]>((out, span) => {
    const last = out.at(-1)
    if (last !== undefined && JSON.stringify(last.style ?? {}) === JSON.stringify(span.style ?? {})) {
      out[out.length - 1] = { ...last, text: last.text + span.text }
    } else if (span.text !== '') {
      out.push(span)
    }

    return out
  }, [])

/** Each HUD row as plain text, top to bottom: what `renderHud` draws, uncoloured. */
export const hudLines = (data: HudData, layout: HudLayout): string[] => rowsOf(data, layout).map(row => textOf(row.spans))

/**
 * The HUD block, drawn above the agent list: one keyed Box per row
 * (`hud:identity`, `hud:location`, `hud:ctx`, `hud:five_hour`, ...), each
 * holding one Text cut to `layout.columns`, or with `ui.Svg` the row in
 * pixels. Its root never shrinks.
 */
export const renderHud = (ui: HudElements, data: HudData, layout: HudLayout): RenderElement | undefined =>
  renderHudBlock(ui, data, layout).element

/** The drawing and its row count from a single layout pass. */
export const renderHudBlock = (ui: HudElements, data: HudData, layout: HudLayout): { element?: RenderElement; rowCount: number } => {
  const rows = rowsOf(data, layout)
  if (rows.length === 0) return { rowCount: 0 }
  const { Box, Text, Svg } = ui
  if (Svg !== undefined) {
    const element = (
      <Box key="hud" flexDirection="column" flexShrink={0}>
        {rows.map(row => renderTextRow({ Box, Svg }, { key: `hud:${row.id}`, cells: merged(row.spans).map(span => ({ text: span.text, ...span.style })) }))}
      </Box>
    )

    return { element, rowCount: rows.length }
  }

  const element = (
    <Box key="hud" flexDirection="column" flexShrink={0}>
      {rows.map(row => (
        <Box key={`hud:${row.id}`} flexShrink={0}>
          <Text wrap="truncate-end">
            {merged(row.spans).map(span => (span.style === undefined ? span.text : <Text {...span.style}>{span.text}</Text>))}
          </Text>
        </Box>
      ))}
    </Box>
  )

  return { element, rowCount: rows.length }
}

/**
 * The HUD as one plain line: segments joined by ` │ `, absent facts dropped,
 * at most 100 characters (the last segments give way first). `⚠ n` counts
 * the alert strip's alerts, when there are any. The caller appends the
 * agents summary.
 */
export const statusLineText = (data: HudData): string => {
  const segments: string[] = []
  const who = [modelLabel(clean(data.session?.model)), clean(data.session?.effort)].filter(one => one !== '').join(' · ')
  if (who !== '') segments.push(truncate(who, 32))
  // What needs attention, counted, right after who: the last to give way but who.
  const alerts = alertsOf(data).length
  if (alerts > 0) segments.push(`⚠ ${alerts}`)

  const percent = contextPercentOf(data.usage)
  const tokens = data.usage?.contextTokens
  if (percent !== undefined) segments.push(`ctx ${shownPercent(percent)}%`)
  else if (isNumber(tokens)) segments.push(`ctx ${formatTokens(tokens)}`)

  const limits = LIMITS.flatMap(({ kind, label }) => {
    const limit = limitOf(data.usage, kind)

    return limit === undefined ? [] : [`${label} ${shownPercent(limit.percentUsed)}%`]
  })
  if (limits.length > 0) segments.push(limits.join(' · '))

  const costUsd = data.usage?.costUsd
  if (isNumber(costUsd)) segments.push(formatCost(costUsd))

  const branch = clean(data.git?.branch)
  if (branch !== '') {
    const marks = gitMarksOf(data.git)
    segments.push(`${truncate(branch, 24)}${isDirtyOf(data.git) ? '*' : ''}${marks === '' ? '' : ` ${marks}`}`)
  }

  const items = todoItemsOf(data)
  if (items.length > 0) segments.push(`todo ${items.filter(item => item.status === 'completed').length}/${items.length}`)

  while (segments.length > 1 && displayWidth(segments.join(' │ ')) > STATUS_MAX) segments.pop()

  return truncate(segments.join(' │ '), STATUS_MAX)
}

// --- the todo list -------------------------------------------------------------
// The main conversation's todo list, a section of its own between the HUD and
// the agents. Folded (the default) it is one progress line: `▸ TODO`, a bar of
// the items done, `done/total` and the item in progress (else the next one
// pending). The `▸` is a Button: pressed, `▾` lists every item under the line,
// one per row, two cells in. Layout: docs/pane-sketch.md ("TODO").

/** How many todo items the section lists by default when open; the rest are counted. */
export const TODO_ROWS = 6

/** The progress line's Button: `▸` folded to the line, `▾` listing the items. */
export const TODO_OPEN = '▸'
export const TODO_FOLD = '▾'

const TODO_GLYPH: Record<HudTodo['status'], string> = { in_progress: '◐', pending: '☐', completed: '☑' }
const TODO_ORDER: Record<HudTodo['status'], number> = { in_progress: 0, pending: 1, completed: 2 }

/**
 * One row of the TODO section: its text (cut to the pane) and its state. The
 * progress line (`todo:header`) carries its runs and its toggle glyph.
 */
export type TodoRow = { key: string; text: string; status?: HudTodo['status']; more?: number; spans?: TextSpan[]; toggle?: string }

/** The progress bar's cells: 10, 8 below 44 columns, none at 36 and under. */
const todoBarWidth = (columns: number): number => (columns <= BARLESS_AT ? 0 : columns < SMALL_BELOW ? SMALL_BAR_WIDTH : NARROW_BAR_WIDTH)

/** Spans cut to `width` cells, the cut one ending in `…`. */
const cutSpans = (spans: readonly TextSpan[], width: number): TextSpan[] => {
  const kept: TextSpan[] = []
  let used = 0
  for (const span of spans) {
    const cells = displayWidth(span.text)
    if (used + cells <= width) {
      kept.push(span)
      used += cells
      continue
    }
    const cut = truncate(span.text, width - used)
    if (cut !== '') kept.push({ ...span, text: cut })
    break
  }

  return kept.filter(span => span.text !== '')
}

const itemText = (item: HudTodo): string =>
  item.status === 'in_progress' ? clean(item.activeForm) || clean(item.content) : clean(item.content)

/**
 * `▸ TODO  ━━━━━━────  3/7  ◐ Wiring the detail view`: the toggle (dim), `TODO`
 * bold, the share done as a bar (fill `success`, track dim), the count, and
 * folded, the item in progress (`◐` in the accent) or else the next pending.
 */
const todoLineRow = (items: readonly HudTodo[], width: number, expanded: boolean): TodoRow => {
  const total = items.length
  const done = items.filter(item => item.status === 'completed').length
  const cells = todoBarWidth(width)
  const filled = filledOf((done / Math.max(1, total)) * 100, cells)
  const toggle = expanded ? TODO_FOLD : TODO_OPEN
  const next = items.find(item => item.status === 'in_progress') ?? items.find(item => item.status === 'pending')
  const spans: TextSpan[] = [
    { text: toggle, dimColor: true },
    { text: ' ' },
    { text: 'TODO', bold: true },
    { text: '  ' },
    ...(cells > 0 ? [{ text: FILL.repeat(filled), color: GOOD }, { text: TRACK.repeat(cells - filled), dimColor: true }, { text: ' ' }] : []),
    { text: `${done}/${total}` },
    ...(!expanded && next !== undefined
      ? [{ text: '  ' }, { text: TODO_GLYPH[next.status], ...(next.status === 'in_progress' ? { color: ACCENT } : {}) }, { text: ` ${itemText(next)}` }]
      : []),
  ].filter(span => span.text !== '')
  const shown = cutSpans(spans, width)

  return { key: 'todo:header', text: shown.map(span => span.text).join(''), spans: shown, toggle }
}

/**
 * The section's rows: the progress line, and with `expanded` under it the
 * items in progress (their active form), then pending, then completed, at most
 * `max`, then `+n more` for the rest. Empty when there are no items.
 */
export const todoRows = (todos: HudData['todos'], columns: number, max = TODO_ROWS, expanded = false): TodoRow[] => {
  const items = todoItemsOf({ todos, now: 0 })
    .map((item, index) => ({ item, index }))
    .sort((a, b) => TODO_ORDER[a.item.status] - TODO_ORDER[b.item.status] || a.index - b.index)
  if (items.length === 0) return []
  const width = Math.max(1, Math.floor(columns))
  const line = todoLineRow(items.map(one => one.item), width, expanded)
  if (!expanded) return [line]
  const cap = Math.max(1, Math.floor(max))
  const shown = items.slice(0, cap)
  const rows: TodoRow[] = shown.map(({ item, index }) =>
    ({ key: `todo:${index}`, status: item.status, text: truncate(`  ${TODO_GLYPH[item.status]} ${itemText(item)}`, width) }))
  const rest = items.length - shown.length

  return [
    line,
    ...rows,
    ...(rest > 0 ? [{ key: 'todo:more', text: truncate(`  +${rest} more`, width), more: rest }] : []),
  ]
}

/** The section as plain text, the progress line first: what `renderTodos` draws, uncoloured. */
export const todoLines = (todos: HudData['todos'], columns: number, max = TODO_ROWS, expanded = false): string[] =>
  todoRows(todos, columns, max, expanded).map(row => row.text)

/** A TODO row's runs: the progress line its own, `+n more` dim, a completed item dim and struck, one in progress its glyph in the accent. */
const todoSpans = (row: TodoRow): TextSpan[] => {
  if (row.spans !== undefined) return row.spans
  if (row.more !== undefined) return [{ text: row.text, dimColor: true }]
  if (row.status === 'completed') return [{ text: row.text, dimColor: true, strikethrough: true }]
  if (row.status === 'in_progress') return [{ text: row.text.slice(0, 4), color: ACCENT }, { text: row.text.slice(4) }]

  return [{ text: row.text }]
}

/** How the TODO section is drawn: the pane's width, the items' cap when open, whether open, and the toggle's handler. */
export type TodoLayout = { columns: number; max?: number; expanded?: boolean; onToggle?: () => void }

/**
 * The TODO section: a keyed column (`todos`) of one-row Boxes (`todo:header`,
 * then open `todo:0`, ... and `todo:more`), each one Text cut to the pane, or
 * with `ui.Svg` the row in pixels. Given a `Button` and `onToggle`, the
 * progress line's `▸`/`▾` is a plain dim Button (`todos:toggle`); without
 * them it is dim text. A completed item is struck through and dim, its `☑`
 * included; one in progress has its `◐` in the accent; `+n more` is dim.
 * Undefined when there is nothing to list.
 */
export const renderTodos = (
  ui: HudElements & { Button?: ElementConstructor<ButtonProps> },
  todos: HudData['todos'],
  layout: TodoLayout,
): { element?: RenderElement; rowCount: number } => {
  const rows = todoRows(todos, layout.columns, layout.max, layout.expanded === true)
  if (rows.length === 0) return { rowCount: 0 }
  const { Box, Text, Svg } = ui
  const onToggle = layout.onToggle
  const Button = onToggle === undefined ? undefined : ui.Button
  if (Svg !== undefined) {
    const cellsOf = (row: TodoRow): TextCell[] => {
      const spans = todoSpans(row)
      if (row.toggle === undefined || Button === undefined || onToggle === undefined) return spans

      return [{ button: { key: 'todos:toggle', label: row.toggle, dimColor: true, onPress: onToggle } }, ...spans.slice(1)]
    }
    const element = (
      <Box key="todos" flexDirection="column" flexShrink={0}>
        {rows.map(row => renderTextRow({ Box, Svg, Button }, { key: row.key, cells: cellsOf(row) }))}
      </Box>
    )

    return { element, rowCount: rows.length }
  }
  const runs = (spans: readonly TextSpan[]) =>
    spans.map(({ text, ...style }) => (Object.keys(style).length === 0 ? text : <Text {...style}>{text}</Text>))
  const element = (
    <Box key="todos" flexDirection="column" flexShrink={0}>
      {rows.map(row => {
        if (row.spans !== undefined) {
          const withButton = Button !== undefined && onToggle !== undefined && row.toggle !== undefined

          return (
            <Box key={row.key} height={1} flexShrink={0}>
              {withButton && (
                <Box width={displayWidth(row.toggle ?? '')} flexShrink={0}>
                  <Button key="todos:toggle" label={row.toggle ?? ''} plain dimColor onPress={() => onToggle?.()} />
                </Box>
              )}
              <Text wrap="truncate-end">{runs(withButton ? row.spans.slice(1) : row.spans)}</Text>
            </Box>
          )
        }
        const body = row.status === undefined ? row.text : row.text.slice(4)
        const lead = row.status === undefined ? '' : row.text.slice(0, 4)

        return (
          <Box key={row.key} height={1} flexShrink={0}>
            {row.more !== undefined
              ? <Text dimColor wrap="truncate-end">{row.text}</Text>
              : row.status === 'completed'
                ? <Text dimColor strikethrough wrap="truncate-end">{row.text}</Text>
                : (
                    <Text wrap="truncate-end">
                      {row.status === 'in_progress' ? <Text color={ACCENT}>{lead}</Text> : lead}
                      {body}
                    </Text>
                  )}
          </Box>
        )
      })}
    </Box>
  )

  return { element, rowCount: rows.length }
}
