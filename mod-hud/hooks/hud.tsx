import type { BoxProps, ButtonProps, ElementConstructor, RenderElement, SvgProps, TextProps } from 'claude-code'

import type { HudData, HudGit, HudLayout, HudRateLimit, HudTodo, HudUsage } from '../types'
import { CACHE_TTL_MS, contextGrowth, limitEta, turnsUntil } from './facts'
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
/**
 * The section gutter: ` session  ` wide (one cell in, the label, room to
 * ten cells), ` ctx  ` narrow (six). The sub-label column after it: `growth  `
 * wide (eight cells), `growth ` narrow (seven). Values start after both: at
 * cell 18 wide, 13 narrow.
 */
export const GUTTER = 10
export const NARROW_GUTTER = 6
export const SUB_WIDTH = 8
export const NARROW_SUB_WIDTH = 7
/** Wide, a text row's second value starts this many cells into the value column (cell 37 of the card). */
export const SECOND_VALUE_AT = 19
/** Every wide bar is this many cells: context, cache and rate limits alike. */
export const BAR_WIDTH = 20
/** Narrow bars: this many cells below 60 columns... */
export const NARROW_BAR_WIDTH = 10
/** ...this many below SMALL_BELOW columns... */
export const SMALL_BAR_WIDTH = 8
const SMALL_BELOW = 44
/** ...and none at this many columns and under: `used   41%`. */
export const BARLESS_AT = 36
/** The todo section's bar: 10 cells wide, as narrow. */
export const TODO_BAR_WIDTH = 10
const FILL = '━'
const TRACK = '─'
const PERCENT_WIDTH = 4
const TOKENS_WIDTH = 4
/** The header's working/idle cell: `● working 1h 12m` at its widest. */
const ACTIVITY_WIDTH = 16
/** The `now` row's elapsed time: `00:04` to `1h 12m`, right-aligned. */
const ELAPSED_WIDTH = 6
const TOOL_NAME_MAX = 12
/** The auto-compact threshold's cell on the context bar. */
const MARK = '┃'
const BRANCH_KEEP = 8
const MIN_ROWS = 4
const STATUS_MAX = 100
const DAY_MS = 86_400_000
/** The usage section's `$ / h` waits for this much of a session: earlier, the rate is noise. */
const RATE_AFTER_MS = 5 * 60_000
/** The cache cools (the alert strip says so, the row turns `warning`) inside this much of its TTL... */
export const CACHE_COOL_MS = 2 * 60_000
/** ...or this share of it, whichever is less: two minutes of an hour, one of five minutes. */
export const CACHE_COOL_SHARE = 0.2

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const LIMITS: readonly { kind: HudRateLimit['kind']; label: string; rank: number }[] = [
  { kind: 'five_hour', label: '5h', rank: 85 },
  { kind: 'seven_day', label: '7d', rank: 84 },
  { kind: 'spend_limit', label: 'spend', rank: 83 },
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

/** A span of time as a turn reads: `42s`, `1m 12s`, `1h 05m`. */
export const formatSpan = (ms: number): string => {
  const total = isNumber(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  if (total < 60) return `${total}s`
  if (total < 3600) return `${Math.floor(total / 60)}m ${pad2(total % 60)}s`

  return `${Math.floor(total / 3600)}h ${pad2(Math.floor((total % 3600) / 60))}m`
}

/** How long ago: `just now`, `48m ago`, `3h ago`, `2d ago`. */
export const formatAgo = (ms: number): string => {
  const minutes = isNumber(ms) && ms > 0 ? Math.floor(ms / 60_000) : 0
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`

  return `${Math.floor(minutes / (24 * 60))}d ago`
}

/** Time left on a countdown, rounded up: `45s` under a minute, then `2m`, `42m`, `1h`. */
export const formatLeft = (ms: number): string => {
  const seconds = isNumber(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.ceil(seconds / 60)

  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`
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

// `+3 ~1 −1`: paths added, modified and deleted.
const pathMarksOf = (git: HudGit | undefined): string => {
  const added = countOf(git?.added)
  const deleted = countOf(git?.deleted)
  const modified = isNumber(git?.dirty) ? Math.max(0, countOf(git?.dirty) - added - deleted) : 0
  const marks: [string, number][] = [['+', added], ['~', modified], ['−', deleted]]

  return marks.filter(([, n]) => n > 0).map(([mark, n]) => `${mark}${n}`).join(' ')
}

// `↑2 ↓1`: commits ahead and behind the upstream.
const aheadBehindOf = (git: HudGit | undefined): string =>
  ([['↑', countOf(git?.ahead)], ['↓', countOf(git?.behind)]] as [string, number][])
    .filter(([, n]) => n > 0).map(([mark, n]) => `${mark}${n}`).join(' ')

// `+3 −1 ↑2 ↓1`: the status line's marks, paths and commits.
const gitMarksOf = (git: HudGit | undefined): string => [pathMarksOf(git), aheadBehindOf(git)].filter(one => one !== '').join(' ')

/** `+142 −37 lines` from the lines changed against HEAD; `''` when neither is known or both are 0. */
const linesOf = (git: HudGit | undefined): string => {
  const added = countOf(git?.linesAdded)
  const deleted = countOf(git?.linesDeleted)
  if (added === 0 && deleted === 0) return ''

  return `+${added} −${deleted} lines`
}

const todoItemsOf = (data: HudData): HudTodo[] =>
  (Array.isArray(data.todos?.items) ? data.todos.items : []).filter(item => clean(item?.content) !== '')

/** The prompt cache as the context section draws it: its TTL, and the time left on it (0 once cold). */
export type CacheState = { ttl: '5m' | '1h'; ttlMs: number; leftMs: number; cooling: boolean; assumed?: true }

/** How close to cold the cache counts as cooling: CACHE_COOL_MS, or CACHE_COOL_SHARE of a shorter TTL. */
export const cacheCoolAt = (ttlMs: number): number => Math.min(CACHE_COOL_MS, ttlMs * CACHE_COOL_SHARE)

/** The cache's state now; undefined before a main request answered, or with no TTL. */
export const cacheStateOf = (data: HudData): CacheState | undefined => {
  const cache = data.cache
  if (cache === undefined || !isNumber(cache.lastAt)) return undefined
  const ttlMs = CACHE_TTL_MS[cache.ttl]
  if (ttlMs === undefined) return undefined
  const leftMs = Math.max(0, Math.min(ttlMs, ttlMs - (data.now - cache.lastAt)))

  return { ttl: cache.ttl, ttlMs, leftMs, cooling: leftMs > 0 && leftMs <= cacheCoolAt(ttlMs), ...(cache.assumed === true ? { assumed: true as const } : {}) }
}

// --- spans and rows ----------------------------------------------------------

type Style = { color?: string; bold?: boolean; dimColor?: boolean; italic?: boolean }
type Span = { text: string; style?: Style }
type Row = { id: string; rank: number; spans: Span[] }

/** Where a row's value draws: free text runs to `card`, right-hand cells end at `edge`. */
type Room = { card: number; edge: number }

/** How rows draw at this width. */
type Look = {
  isNarrow: boolean
  /** A gauge's bar cells; 0 draws the percent alone. */
  bar: number
  /** The section gutter's and the sub-label's cells. */
  gutter: number
  sub: number
  /** The gap between a value's pieces: three cells wide, two narrow. */
  gap: string
}

const plain = (text: string): Span => ({ text })
const dim = (text: string): Span => ({ text, style: { dimColor: true } })
const strong = (text: string): Span => ({ text, style: { bold: true } })
const tint = (text: string, color: string): Span => ({ text, style: { color } })
const SEPARATOR = (): Span => dim(' · ')

const widthOf = (spans: readonly Span[]): number => spans.reduce((sum, span) => sum + displayWidth(span.text), 0)

const textOf = (spans: readonly Span[]): string => spans.map(span => span.text).join('')

/** The spans cut to `limit` cells, the cut span ending in `…`: the HUD's rows and the TODO section's alike. */
const clip = <T extends { text: string }>(spans: readonly T[], limit: number): T[] => {
  const kept: T[] = []
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

/**
 * A value of pieces: `head` (cut to the room), then each of `tail` that still
 * fits whole, the first at the second value column wide (else after the
 * look's gap), the rest after ` · ` (or, with `join` `gap`, the gap). A piece that does not fit is left out,
 * the ones after it still tried.
 */
const pieces = (head: readonly Span[], tail: readonly (readonly Span[])[], width: number, look: Look, column = true, join: 'dot' | 'gap' = 'dot'): Span[] => {
  const out = clip(head, width)
  let added = 0
  for (const piece of tail) {
    if (piece.length === 0 || widthOf(piece) === 0) continue
    const used = widthOf(out)
    const lead: Span[] = added > 0
      ? [join === 'dot' ? SEPARATOR() : plain(look.gap)]
      : [plain(!look.isNarrow && column && used + 2 <= SECOND_VALUE_AT ? ' '.repeat(SECOND_VALUE_AT - used) : look.gap)]
    if (used + widthOf(lead) + widthOf(piece) > width) continue
    out.push(...lead, ...piece)
    added += 1
  }

  return out
}

// `● working 00:42` (the accent) while the main loop works, `○ idle 3m`
// (dim) once it stopped; nothing before either is known. Its cell is a fixed
// ACTIVITY_WIDTH, so the model beside it never moves on the tick.
const activitySpans = (data: HudData): Span[] => {
  const main = data.main
  if (isNumber(main?.busySince)) return [tint('● working', ACCENT), dim(` ${formatDuration(data.now - main.busySince)}`)]
  if (isNumber(main?.idleSince)) return [dim(`○ idle ${formatIdle(data.now - main.idleSince)}`)]

  return []
}

// `◆ opus 5.5 · xhigh · gateway                     ● working 00:42`: the
// provider, then the working/idle cell, then the effort give way when the row
// runs short. The session's clock and cost are the usage section's.
const headerRow = (data: HudData, { card, edge }: Room): Span[] | undefined => {
  const session = data.session
  const model = modelLabel(clean(session?.model))
  const effort = clean(session?.effort)
  const provider = clean(session?.provider)
  if (model === '' && effort === '' && provider === '') return undefined

  const activity = activitySpans(data)
  const withActivity: Span[] = activity.length === 0 ? [] : [plain(' '.repeat(Math.max(0, ACTIVITY_WIDTH - widthOf(activity)))), ...activity]
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

  // The working/idle cell holds only while the model and its effort still fit
  // beside it; the provider, the first to give way, goes with it.
  let right = withActivity
  let room = roomBeside(right)
  let withProvider = true
  if (activity.length > 0 && room < widthOf(build(true, false))) {
    right = []
    room = card - widthOf(head)
    withProvider = false
  }

  let body = build(true, withProvider)
  if (widthOf(body) > room) body = build(true, false)
  if (widthOf(body) > room) body = build(false, false)

  return anchor([...head, ...clip(body, Math.max(0, room))], right, edge)
}

// --- the alert strip -----------------------------------------------------------
// One row under the header, only while something needs attention: agents
// waiting on a permission ask, a limit that runs out before it resets, agents
// stalled, a compaction a few turns off, the prompt cache about to go cold,
// calls denied or failed, the branch behind its upstream. Most severe first;
// no row at all otherwise.

/** One thing that needs attention, as the alert strip draws it. */
export type HudAlert = { id: string; text: string; color: string; dim?: true }

/** The turns left before the context compacts (at the auto-compact threshold, else the window), at its growth per turn. */
export const compactRunway = (data: HudData): number | undefined => {
  // Auto-compaction off: the context never compacts on its own, so no runway.
  if (data.inventory?.autoCompact === false) return undefined
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

/** When a window runs out at its burn of the last 30 minutes, when that comes before it resets (or no reset is known). */
const limitOutOf = (data: HudData, limit: HudRateLimit): { out: number; resets?: number } | undefined => {
  const eta = limitEta(data.usage?.limitSamples?.[limit.kind], limit.percentUsed, data.now)
  if (eta === undefined) return undefined
  const out = data.now + eta
  const resets = limit.resetsAt === undefined ? Number.NaN : Date.parse(limit.resetsAt)
  if (Number.isFinite(resets) && resets <= out) return undefined

  return Number.isFinite(resets) ? { out, resets } : { out }
}

/** `next turn rewrites 412k`: what a cold cache costs the next turn, when the context's size is known. */
const rewritesOf = (data: HudData): string => {
  const tokens = data.usage?.contextTokens

  return isNumber(tokens) && tokens > 0 ? `next turn rewrites ${formatTokens(tokens)}` : ''
}

/** What needs attention now, most severe first; empty when nothing does. */
export const alertsOf = (data: HudData): HudAlert[] => {
  const alerts: HudAlert[] = []
  const asks = countOf(data.alerts?.asks)
  if (asks > 0) alerts.push({ id: 'asks', text: `${plural(asks, 'agent')} waiting for permission`, color: HOT })

  // A window whose burn of the last 30 minutes reaches 100 % before it resets.
  for (const { kind, label } of LIMITS) {
    const limit = limitOf(data.usage, kind)
    const out = limit === undefined ? undefined : limitOutOf(data, limit)
    if (out === undefined) continue
    const before = out.resets === undefined ? '' : `, before ↻${whenOf(out.resets, data.now)}`
    alerts.push({ id: `limit:${kind}`, text: `${label} out ~${whenOf(out.out, data.now)}${before}`, color: HOT })
  }

  const stalled = countOf(data.alerts?.stalled)
  if (stalled > 0) alerts.push({ id: 'stalled', text: `${plural(stalled, 'agent')} stalled`, color: WARN })

  const runway = compactRunway(data)
  if (runway !== undefined && runway <= COMPACT_SOON_TURNS) alerts.push({ id: 'compact', text: `compact in ~${plural(runway, 'turn')}`, color: WARN })

  // The cache about to go cold; once cold it is the cache row's calm news, no alert.
  const cache = cacheStateOf(data)
  if (cache?.cooling === true) {
    const rewrites = rewritesOf(data)
    alerts.push({ id: 'cache', text: `cache cools in ${formatLeft(cache.leftMs)}${rewrites === '' ? '' : ` · ${rewrites}`}`, color: WARN })
  }

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

// --- the sections ----------------------------------------------------------------
// Each row below draws its value alone: the section's label (on its first
// row shown) and the row's sub-label are put before it by `rowsOf`.

/**
 * A gauge's bar as spans: the fill coloured (by level, or `color`), the track
 * dim, and with `mark` (a cell index) that one cell a dim `┃` in place of
 * whatever it held.
 */
const barSpans = (shown: number, cells: number, mark?: number, color = levelColor(shown)): Span[] => {
  const filled = filledOf(shown, cells)
  if (mark === undefined || mark < 0 || mark >= cells) return [tint(FILL.repeat(filled), color), dim(TRACK.repeat(cells - filled))]
  if (mark < filled) {
    return [tint(FILL.repeat(mark), color), dim(MARK), tint(FILL.repeat(filled - mark - 1), color), dim(TRACK.repeat(cells - filled))]
  }

  return [tint(FILL.repeat(filled), color), dim(TRACK.repeat(mark - filled)), dim(MARK), dim(TRACK.repeat(cells - mark - 1))]
}

// `━━━━━━━━────────┃───  41%`; narrow the bar is shorter, and at 36 columns
// and under the percent stands alone. An unknown percent reads a dim `—`.
const gaugeSpans = (percent: number | undefined, look: Look, mark?: number): Span[] => {
  if (percent === undefined) return [dim('—')]
  const shown = shownPercent(percent)

  return [
    // The fill and the track are separate spans: the fill coloured, the track dim.
    ...barSpans(shown, look.bar, mark),
    plain(`${look.bar > 0 ? ' ' : ''}${padStart(`${shown}%`, PERCENT_WIDTH)}`),
  ].filter(span => span.text !== '')
}

/** The bar cell the auto-compact threshold falls in, when it is known and below the window. */
const compactMarkOf = (data: HudData, cells: number): number | undefined => {
  const compactAt = data.inventory?.compactAt
  const window = data.usage?.window
  if (cells === 0 || !isNumber(compactAt) || !isNumber(window) || compactAt <= 0 || compactAt >= window) return undefined

  return Math.min(cells - 1, Math.max(0, Math.round((compactAt / window) * cells)))
}

// session · repo: `~/.claude/mods`, its leading directories the first to go.
const repoRow = (data: HudData, { card }: Room): Span[] | undefined => {
  const where = clean(data.session?.cwd) || clean(data.session?.repoRoot)
  if (where === '' || card < 4) return undefined

  return [dim(fitPath(tildify(where), card))]
}

// session · branch: `main* ↑2   +142 −37 lines · last commit 48m ago`. The
// branch keeps at least BRANCH_KEEP cells; the lines changed (else the paths)
// and the last commit's age follow while they fit.
const branchRow = (data: HudData, { card }: Room, look: Look): Span[] | undefined => {
  const branch = clean(data.git?.branch)
  if (branch === '') return undefined
  const isDirty = isDirtyOf(data.git)
  const commits = aheadBehindOf(data.git)
  const tailWidth = (isDirty ? 1 : 0) + (commits === '' ? 0 : 1 + displayWidth(commits))
  const shownBranch = truncate(branch, Math.max(Math.min(displayWidth(branch), BRANCH_KEEP), card - tailWidth))
  const head: Span[] = [plain(shownBranch), ...(isDirty ? [tint('*', WARN)] : []), ...(commits === '' ? [] : [dim(` ${commits}`)])]
  const lines = linesOf(data.git)
  const changes = lines !== '' ? lines : isDirty ? pathMarksOf(data.git) : ''
  const lastCommitAt = data.git?.lastCommitAt
  const committed = isNumber(lastCommitAt) ? `last commit ${formatAgo(data.now - lastCommitAt)}` : ''

  return pieces(head, [changes === '' ? [] : [dim(changes)], committed === '' ? [] : [dim(committed)]], card, look, false)
}

/** A main argument that is a path reads from the home `~` and loses its leading directories first; any other is cut at its end. */
const fitArg = (arg: string, width: number): string => {
  if (width <= 0) return ''
  if (/^(?:\/|~|[A-Za-z]:\\)/.test(arg) && !/\s/.test(arg)) return fitPath(tildify(arg), width)

  return truncate(arg, width)
}

// session · now: `Bash · npm test -- hud                00:04`: the main
// loop's tool running now, its main argument, and how long it has run, at
// the edge in a fixed cell so it never moves on the tick. Between tools a dim
// `—`; no row before the main loop called any tool.
const nowRow = (data: HudData, { card, edge }: Room): Span[] | undefined => {
  const tools = data.tools
  const current = tools?.current
  const name = typeof current?.name === 'string' ? toolLabel(current.name, TOOL_NAME_MAX) : ''
  const used = Object.values(tools?.counts ?? {}).some(count => countOf(count) > 0) || countOf(tools?.edited) > 0
  if (name === '' && !used) return undefined
  if (name === '') return [dim('—')]

  let right: Span[] = [dim(padStart(formatDuration(data.now - (isNumber(current?.since) ? current.since : data.now)), ELAPSED_WIDTH))]
  // The elapsed time holds while the tool's name still fits beside it.
  let room = edge - widthOf(right) - 2
  if (room < Math.max(1, displayWidth(name))) {
    right = []
    room = card
  }
  const arg = clean(current?.arg)
  const argRoom = room - displayWidth(name) - 3
  const shownArg = arg === '' || argRoom < 4 ? '' : fitArg(arg, argRoom)
  const left: Span[] = [plain(name), ...(shownArg === '' ? [] : [SEPARATOR(), dim(shownArg)])]

  return anchor(clip(left, room), right, edge)
}

// context · used: `━━━━━━━━────────┃───  41%   412k / 1.0M` (`412k/1.0M` narrow).
const usedRow = (data: HudData, { card }: Room, look: Look): Span[] | undefined => {
  const usage = data.usage
  const percent = contextPercentOf(usage)
  const tokens = usage?.contextTokens
  const window = usage?.window
  if (percent === undefined && !isNumber(tokens) && clean(data.session?.model) === '') return undefined
  const over = look.isNarrow ? '/' : ' / '
  const detail = isNumber(tokens)
    ? [dim(`${padStart(formatTokens(tokens), TOKENS_WIDTH)}${isNumber(window) && window > 0 ? `${over}${formatTokens(window)}` : ''}`)]
    : []

  return pieces(gaugeSpans(percent, look, compactMarkOf(data, look.bar)), [detail], card, look, false)
}

// context · growth: `+65k / turn        compact in ~6 turns`; no row before growth is seen.
const growthRow = (data: HudData, { card }: Room, look: Look): Span[] | undefined => {
  const growth = contextGrowth(data.usage?.contextSamples)
  if (growth === undefined) return undefined
  const runway = compactRunway(data)
  const over = look.isNarrow ? '/' : ' / '

  return pieces([plain(`+${formatTokens(growth)}${over}turn`)], [runway === undefined ? [] : [dim(`compact in ~${plural(runway, 'turn')}`)]], card, look)
}

// context · cache: `━━━━━━━━━━━━━━──────  warm · 42m left (1h)`: the bar the
// TTL left since the main loop's last request, draining; inside the cooling
// window it turns `warning`; cold, an empty track and `cold · next turn
// rewrites 412k`, all dim: calm news, no alert.
const cacheRow = (data: HudData, { card }: Room, look: Look): Span[] | undefined => {
  const cache = cacheStateOf(data)
  if (cache === undefined) return undefined
  const ttl = dim(`(${cache.ttl}${cache.assumed ? '?' : ''})`)
  if (cache.leftMs === 0) {
    const rewrites = rewritesOf(data)
    const bar = look.bar > 0 ? [dim(TRACK.repeat(look.bar)), plain('  ')] : []

    return pieces([...bar, dim(rewrites === '' ? 'cold' : `cold · ${rewrites}`)], [[ttl]], card, { ...look, gap: ' ' }, false)
  }
  const color = cache.cooling ? WARN : GOOD
  const percent = (cache.leftMs / cache.ttlMs) * 100
  const bar = look.bar > 0 ? [...barSpans(Math.max(1, percent), look.bar, undefined, color), plain('  ')] : []
  const state = cache.cooling ? tint('cooling', WARN) : plain('warm')

  return pieces([...bar, state], [[dim(`· ${formatLeft(cache.leftMs)} left`)], [ttl]], card, { ...look, gap: ' ' }, false, 'gap')
}

// limits · 5h: `━━━━━━──────────────  31%   ↻ 14:20   out ~13:43`: the
// reset, and when the window runs out at its burn if that comes first.
const limitRow = (data: HudData, kind: HudRateLimit['kind'], { card }: Room, look: Look): Span[] | undefined => {
  const limit = limitOf(data.usage, kind)
  if (limit === undefined) return undefined
  const reset = limit.resetsAt === undefined ? '' : formatReset(limit.resetsAt, data.now)
  const out = limitOutOf(data, limit)

  return pieces(gaugeSpans(limit.percentUsed, look), [
    reset === '' ? [] : [dim(reset)],
    out === undefined ? [] : [tint(`out ~${whenOf(out.out, data.now)}`, HOT)],
  ], card, look, false, 'gap')
}

// usage · cost: `$4.21              $3.50 / h · 1h 12m`: the session's cost,
// its rate an hour (after five minutes), and the session's clock.
const costRow = (data: HudData, { card }: Room, look: Look): Span[] | undefined => {
  const costUsd = data.usage?.costUsd
  const startedAt = data.session?.startedAt
  const duration = isNumber(startedAt) ? Math.max(0, data.now - startedAt) : undefined
  if (!isNumber(costUsd) && duration === undefined) return undefined
  const rate = isNumber(costUsd) && costUsd > 0 && duration !== undefined && duration >= RATE_AFTER_MS
    ? `${formatCost(costUsd / (duration / 3_600_000))} / h`
    : ''

  return pieces(
    [isNumber(costUsd) ? strong(formatCost(costUsd)) : dim('—')],
    [rate === '' ? [] : [dim(rate)], duration === undefined ? [] : [dim(formatDuration(duration))]],
    card,
    look,
  )
}

// usage · last: `$0.38              1m 12s · 24k tokens`: the last main turn's
// cost, how long it ran and its own tokens.
const lastRow = (data: HudData, { card }: Room, look: Look): Span[] | undefined => {
  const last = data.usage?.lastTurn
  if (last === undefined) return undefined
  const cost = isNumber(last.costUsd) ? formatCost(last.costUsd) : ''
  const took = isNumber(last.durationMs) && last.durationMs > 0 ? formatSpan(last.durationMs) : ''
  const tokens = isNumber(last.tokens) && last.tokens > 0 ? `${formatTokens(last.tokens)} tokens` : ''
  if (cost === '' && took === '' && tokens === '') return undefined

  return pieces([cost === '' ? dim('—') : plain(cost)], [took === '' ? [] : [dim(took)], tokens === '' ? [] : [dim(tokens)]], card, look)
}

// usage · cache: `87% hit            agents 38% of spend`: the share of input
// the prompt cache served, and the agents' share of the estimated spend.
const cacheUseRow = (data: HudData, { card }: Room, look: Look): Span[] | undefined => {
  const tokens = data.usage?.tokens
  const input = tokens === undefined ? 0 : countOf(tokens.input) + countOf(tokens.cacheRead) + countOf(tokens.cacheWrite)
  const hit = tokens !== undefined && input > 0 ? `${Math.round((countOf(tokens.cacheRead) / input) * 100)}% hit` : ''
  const share = data.usage?.agentShare
  const agents = isNumber(share) && share > 0 ? `agents ${Math.round(Math.min(1, share) * 100)}% of spend` : ''
  if (hit === '' && agents === '') return undefined
  if (hit === '') return pieces([dim(agents)], [], card, look)

  return pieces([plain(hit)], [agents === '' ? [] : [dim(agents)]], card, look)
}

const mottoRow = (data: HudData, { card }: Room): Span[] | undefined => {
  const motto = clean(data.motto)
  if (motto === '') return undefined

  return clip([plain(INDENT), { text: motto, style: { dimColor: true, italic: true } }], card)
}

/** The HUD's sections, top to bottom, each with its label wide and narrow. */
export const SECTIONS = {
  session: { label: 'session', short: 'sess' },
  context: { label: 'context', short: 'ctx' },
  limits: { label: 'limits', short: 'lim' },
  usage: { label: 'usage', short: 'use' },
} as const

type Section = keyof typeof SECTIONS

/**
 * A row the HUD may draw: its rank decides what a short pane keeps. A row in
 * a section draws its value alone, after the gutter and its sub-label.
 */
type Line = { id: string; rank: number; section?: Section; sub?: string; draw: (room: Room) => Span[] | undefined }

/**
 * The row ranks a short pane keeps by: the alerts, the header, the context
 * used, the limits, the tool running now, the cache, the cost, then the rest.
 * (The todo list is its own section under the HUD, after the cost.)
 */
export const RANKS = {
  alerts: 100,
  header: 98,
  'context.used': 90,
  'session.now': 70,
  'context.cache': 65,
  'usage.cost': 60,
  'session.branch': 45,
  'session.repo': 44,
  'context.growth': 40,
  'usage.last': 35,
  'usage.cache': 30,
  motto: 10,
  gap: 5,
} as const

const rowsOf = (data: HudData, layout: HudLayout): Row[] => {
  const columns = isNumber(layout.columns) ? Math.max(0, Math.floor(layout.columns)) : 0
  const card = Math.min(columns, CARD_MAX)
  const edge = Math.min(card, Math.max(0, columns - CLOSE_RESERVE))
  const isNarrow = layout.isNarrow
  const look: Look = isNarrow
    ? { isNarrow, bar: barWidthFor(columns, true), gutter: NARROW_GUTTER, sub: NARROW_SUB_WIDTH, gap: '  ' }
    : { isNarrow, bar: BAR_WIDTH, gutter: GUTTER, sub: SUB_WIDTH, gap: '   ' }
  const start = look.gutter + look.sub

  const lines: Line[] = [
    { id: 'header', rank: RANKS.header, draw: room => headerRow(data, room) },
    { id: 'alerts', rank: RANKS.alerts, draw: room => alertsRow(data, room) },
    { id: 'session.repo', rank: RANKS['session.repo'], section: 'session', sub: 'repo', draw: room => repoRow(data, room) },
    { id: 'session.branch', rank: RANKS['session.branch'], section: 'session', sub: 'branch', draw: room => branchRow(data, room, look) },
    { id: 'session.now', rank: RANKS['session.now'], section: 'session', sub: 'now', draw: room => nowRow(data, room) },
    { id: 'context.used', rank: RANKS['context.used'], section: 'context', sub: 'used', draw: room => usedRow(data, room, look) },
    { id: 'context.growth', rank: RANKS['context.growth'], section: 'context', sub: 'growth', draw: room => growthRow(data, room, look) },
    { id: 'context.cache', rank: RANKS['context.cache'], section: 'context', sub: 'cache', draw: room => cacheRow(data, room, look) },
    ...LIMITS.map(({ kind, label, rank }): Line => ({ id: `limits.${label}`, rank, section: 'limits', sub: label, draw: room => limitRow(data, kind, room, look) })),
    { id: 'usage.cost', rank: RANKS['usage.cost'], section: 'usage', sub: 'cost', draw: room => costRow(data, room, look) },
    { id: 'usage.last', rank: RANKS['usage.last'], section: 'usage', sub: 'last', draw: room => lastRow(data, room, look) },
    { id: 'usage.cache', rank: RANKS['usage.cache'], section: 'usage', sub: 'cache', draw: room => cacheUseRow(data, room, look) },
    { id: 'motto', rank: RANKS.motto, draw: room => mottoRow(data, room) },
  ]

  // A section row's value draws in what the gutter and its sub-label leave;
  // all right-hand cells share the first row's edge, clear of the close button.
  const roomFor = (line: Line, whole: Room): Room =>
    line.section === undefined ? whole : { card: Math.max(0, whole.card - start), edge: Math.max(0, whole.edge - start) }
  const room: Room = { card, edge }
  const drawn = lines.flatMap(line => {
    const spans = line.draw(roomFor(line, room))

    return spans !== undefined && widthOf(spans) > 0 ? [{ line, spans }] : []
  })
  // The motto is the HUD's last row, never a HUD of its own: with nothing else known, nothing is drawn.
  if (drawn.every(one => one.line.id === 'motto')) return []

  // One blank row between the header and alerts and the sections, when both draw.
  const hasTop = drawn.some(one => one.line.section === undefined && one.line.id !== 'motto')
  const firstSection = drawn.findIndex(one => one.line.section !== undefined)
  const withGap = hasTop && firstSection > 0
    ? [...drawn.slice(0, firstSection), { line: { id: 'gap', rank: RANKS.gap, draw: () => [] } as Line, spans: [] as Span[] }, ...drawn.slice(firstSection)]
    : drawn

  const budget = isNumber(layout.rows) ? Math.max(MIN_ROWS, Math.floor(layout.rows / 2)) : Number.POSITIVE_INFINITY
  const keptIds = new Set([...withGap].sort((a, b) => b.line.rank - a.line.rank).slice(0, budget).map(one => one.line.id))
  const kept = withGap.filter(one => keptIds.has(one.line.id))
  // A blank row with nothing under it (or over it) goes too.
  const shown = kept.filter((one, index) => one.line.id !== 'gap' || (index > 0 && kept.slice(index + 1).some(other => other.line.section !== undefined)))

  // Each section's label stands on its first row shown; the first row of all
  // (the header, whenever it draws) stops short of the close button the
  // engine draws over the pane's last cell.
  const labelled = new Set<Section>()

  return shown.flatMap(({ line, spans }, index) => {
    if (line.id === 'gap') return [{ id: line.id, rank: line.rank, spans: [] }]
    const value = index === 0 ? line.draw(roomFor(line, { card: edge, edge })) : spans
    if (value === undefined || widthOf(value) === 0) return []
    if (line.section === undefined) return [{ id: line.id, rank: line.rank, spans: value }]
    const section = SECTIONS[line.section]
    const label = labelled.has(line.section) ? '' : isNarrow ? section.short : section.label
    labelled.add(line.section)
    const prefix: Span[] = [plain(padEnd(` ${label}`, look.gutter)), dim(padEnd(line.sub ?? '', look.sub))]

    return [{ id: line.id, rank: line.rank, spans: [...prefix, ...value] }]
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

/** Each HUD row as plain text, top to bottom: what `renderHud` draws, uncoloured (the blank row between header and sections `''`). */
export const hudLines = (data: HudData, layout: HudLayout): string[] => rowsOf(data, layout).map(row => textOf(row.spans))

/** The ids of the HUD's rows, top to bottom (`header`, `alerts`, `gap`, `session.repo`, ..., `motto`). */
export const hudRowIds = (data: HudData, layout: HudLayout): string[] => rowsOf(data, layout).map(row => row.id)

/**
 * The HUD block, drawn above the agent list: one keyed Box per row
 * (`hud:header`, `hud:alerts`, `hud:gap`, `hud:session.repo`,
 * `hud:context.used`, `hud:limits.5h`, ...), each holding one Text cut to
 * `layout.columns`, or with `ui.Svg` the row in pixels; the blank `hud:gap`
 * an empty Box a row high. Its root never shrinks.
 */
export const renderHud = (ui: HudElements, data: HudData, layout: HudLayout): RenderElement | undefined =>
  renderHudBlock(ui, data, layout).element

/** The drawing and its row count from a single layout pass. */
export const renderHudBlock = (ui: HudElements, data: HudData, layout: HudLayout): { element?: RenderElement; rowCount: number } => {
  const rows = rowsOf(data, layout)
  if (rows.length === 0) return { rowCount: 0 }
  const { Box, Text, Svg } = ui
  const blank = (row: Row) => <Box key={`hud:${row.id}`} height={1} flexShrink={0} />
  if (Svg !== undefined) {
    const element = (
      <Box key="hud" flexDirection="column" flexShrink={0}>
        {rows.map(row => (row.spans.length === 0
          ? blank(row)
          : renderTextRow({ Box, Svg }, { key: `hud:${row.id}`, cells: merged(row.spans).map(span => ({ text: span.text, ...span.style })) })))}
      </Box>
    )

    return { element, rowCount: rows.length }
  }

  const element = (
    <Box key="hud" flexDirection="column" flexShrink={0}>
      {rows.map(row => (row.spans.length === 0
        ? blank(row)
        : (
            <Box key={`hud:${row.id}`} flexShrink={0}>
              <Text wrap="truncate-end">
                {merged(row.spans).map(span => (span.style === undefined ? span.text : <Text {...span.style}>{span.text}</Text>))}
              </Text>
            </Box>
          )))}
    </Box>
  )

  return { element, rowCount: rows.length }
}

/**
 * The HUD as one plain line: segments joined by ` │ `, absent facts dropped,
 * at most 100 characters (the last segments give way first). `⚠ n` counts
 * the alert strip's alerts, when there are any, but those in `skip` (the
 * caller leaves out `stalled` when the agents summary it appends already
 * counts the stalled agents); the prompt cache's time left (`cache 42m`,
 * `cache 42m?` on an assumed TTL, `cache cold`) comes last, when it fits.
 * The caller appends the agents summary.
 */
export const statusLineText = (data: HudData, skip: readonly string[] = []): string => {
  const segments: string[] = []
  const who = [modelLabel(clean(data.session?.model)), clean(data.session?.effort)].filter(one => one !== '').join(' · ')
  if (who !== '') segments.push(truncate(who, 32))
  // What needs attention, counted, right after who: the last to give way but who.
  const alerts = alertsOf(data).filter(alert => !skip.includes(alert.id)).length
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

  const cache = cacheStateOf(data)
  if (cache !== undefined) segments.push(cache.leftMs === 0 ? 'cache cold' : `cache ${formatLeft(cache.leftMs)}${cache.assumed ? '?' : ''}`)

  while (segments.length > 1 && displayWidth(segments.join(' │ ')) > STATUS_MAX) segments.pop()

  return truncate(segments.join(' │ '), STATUS_MAX)
}

// --- the todo list -------------------------------------------------------------
// The main conversation's todo list, a section of its own between the HUD and
// the agents, in the HUD's gutter. Folded (the default) it is two rows: the
// label row (` todo ▸`, a bar of the items done, `done/total`) and the item in
// progress (else the next one pending). The `▸` is a Button: pressed, `▾`
// lists every item under the label row instead. Layout: docs/pane-sketch.md.

/** How many todo items the section lists by default when open; the rest are counted. */
export const TODO_ROWS = 6

/** The label row's Button: `▸` folded, `▾` listing the items. */
export const TODO_OPEN = '▸'
export const TODO_FOLD = '▾'

const TODO_GLYPH: Record<HudTodo['status'], string> = { in_progress: '◐', pending: '☐', completed: '☑' }
const TODO_ORDER: Record<HudTodo['status'], number> = { in_progress: 0, pending: 1, completed: 2 }

/** Below this many columns the section takes the narrow gutter, as the HUD does. */
const TODO_NARROW_BELOW = 60

/**
 * One row of the TODO section: its text (cut to the pane) and its state. The
 * label row (`todo:header`) carries its runs and its toggle glyph, and the
 * index of the run that is the toggle.
 */
export type TodoRow = { key: string; text: string; status?: HudTodo['status']; more?: number; spans?: TextSpan[]; toggle?: string; toggleAt?: number }

/** The progress bar's cells: 10, 8 below 44 columns, none at 36 and under. */
const todoBarWidth = (columns: number): number => (columns <= BARLESS_AT ? 0 : columns < SMALL_BELOW ? SMALL_BAR_WIDTH : TODO_BAR_WIDTH)

/** Where the section's bar and items start: the HUD's gutter wide (10 cells), two past the toggle narrow (8). */
export const todoIndent = (columns: number): number => (columns < TODO_NARROW_BELOW ? NARROW_GUTTER + 2 : GUTTER)

const itemText = (item: HudTodo): string =>
  item.status === 'in_progress' ? clean(item.activeForm) || clean(item.content) : clean(item.content)

/**
 * ` todo ▸   ━━━━━━────  3/7`: the label, the toggle (dim), the share done as
 * a bar (fill `success`, track dim) from the HUD's value gutter, the count.
 */
const todoLabelRow = (items: readonly HudTodo[], width: number, expanded: boolean): TodoRow => {
  const total = items.length
  const done = items.filter(item => item.status === 'completed').length
  const cells = todoBarWidth(width)
  const filled = filledOf((done / Math.max(1, total)) * 100, cells)
  const toggle = expanded ? TODO_FOLD : TODO_OPEN
  const lead = ' todo '
  const spans: TextSpan[] = [
    { text: lead },
    { text: toggle, dimColor: true },
    { text: ' '.repeat(Math.max(1, todoIndent(width) - displayWidth(lead) - displayWidth(toggle))) },
    ...(cells > 0 ? [{ text: FILL.repeat(filled), color: GOOD }, { text: TRACK.repeat(cells - filled), dimColor: true }, { text: '  ' }] : []),
    { text: `${done}/${total}` },
  ].filter(span => span.text !== '')
  const shown = clip(spans, width).filter(span => span.text !== '')

  return { key: 'todo:header', text: shown.map(span => span.text).join(''), spans: shown, toggle, toggleAt: shown.findIndex(span => span.text === toggle) }
}

/**
 * The section's rows: the label row, then folded the item in progress (its
 * active form; else the next pending), or with `expanded` the items in
 * progress, then pending, then completed, at most `max`, then `+n more`.
 * Empty when there are no items.
 */
export const todoRows = (todos: HudData['todos'], columns: number, max = TODO_ROWS, expanded = false): TodoRow[] => {
  const items = todoItemsOf({ todos, now: 0 })
    .map((item, index) => ({ item, index }))
    .sort((a, b) => TODO_ORDER[a.item.status] - TODO_ORDER[b.item.status] || a.index - b.index)
  if (items.length === 0) return []
  const width = Math.max(1, Math.floor(columns))
  const indent = ' '.repeat(todoIndent(width))
  const line = todoLabelRow(items.map(one => one.item), width, expanded)
  const itemRow = ({ item, index }: { item: HudTodo; index: number }): TodoRow =>
    ({ key: `todo:${index}`, status: item.status, text: truncate(`${indent}${TODO_GLYPH[item.status]} ${itemText(item)}`, width) })
  if (!expanded) {
    const next = items.find(one => one.item.status !== 'completed')

    return next === undefined ? [line] : [line, itemRow(next)]
  }
  const cap = Math.max(1, Math.floor(max))
  const shown = items.slice(0, cap)
  const rest = items.length - shown.length

  return [
    line,
    ...shown.map(itemRow),
    ...(rest > 0 ? [{ key: 'todo:more', text: truncate(`${indent}+${rest} more`, width), more: rest }] : []),
  ]
}

/** The section as plain text, the label row first: what `renderTodos` draws, uncoloured. */
export const todoLines = (todos: HudData['todos'], columns: number, max = TODO_ROWS, expanded = false): string[] =>
  todoRows(todos, columns, max, expanded).map(row => row.text)

/** Where an item row's glyph starts: after its indent. */
const glyphAt = (row: TodoRow): number => row.text.length - row.text.trimStart().length

/** A TODO row's runs: the label row its own, `+n more` dim, a completed item dim and struck, one in progress its glyph in the accent. */
const todoSpans = (row: TodoRow): TextSpan[] => {
  if (row.spans !== undefined) return row.spans
  const at = glyphAt(row)
  const lead = row.text.slice(0, at)
  const body = row.text.slice(at)
  if (row.more !== undefined) return [{ text: lead }, { text: body, dimColor: true }]
  if (row.status === 'completed') return [{ text: lead }, { text: body, dimColor: true, strikethrough: true }]
  if (row.status === 'in_progress') return [{ text: lead }, { text: body.slice(0, 1), color: ACCENT }, { text: body.slice(1) }]

  return [{ text: row.text }]
}

/** How the TODO section is drawn: the pane's width, the items' cap when open, whether open, and the toggle's handler. */
export type TodoLayout = { columns: number; max?: number; expanded?: boolean; onToggle?: () => void }

/**
 * The TODO section: a keyed column (`todos`) of one-row Boxes (`todo:header`,
 * then `todo:<index>` per item shown and `todo:more`), each one Text cut to
 * the pane, or with `ui.Svg` the row in pixels. Given a `Button` and
 * `onToggle`, the label row's `▸`/`▾` is a plain dim Button
 * (`todos:toggle`); without them it is dim text. A completed item is struck
 * through and dim, its `☑` included; one in progress has its `◐` in the
 * accent; `+n more` is dim. Undefined when there is nothing to list.
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
  const toggleOf = (row: TodoRow): number => (row.toggle !== undefined && Button !== undefined && onToggle !== undefined ? row.toggleAt ?? -1 : -1)
  if (Svg !== undefined) {
    const cellsOf = (row: TodoRow): TextCell[] => {
      const spans = todoSpans(row)
      const at = toggleOf(row)
      if (at < 0 || onToggle === undefined) return spans

      return spans.map((span, index): TextCell => (index === at ? { button: { key: 'todos:toggle', label: row.toggle ?? '', dimColor: true, onPress: onToggle } } : span))
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
        const spans = todoSpans(row)
        const at = toggleOf(row)
        if (at >= 0 && Button !== undefined) {
          return (
            <Box key={row.key} height={1} flexShrink={0}>
              {at > 0 && <Box flexShrink={0}><Text>{runs(spans.slice(0, at))}</Text></Box>}
              <Box width={displayWidth(row.toggle ?? '')} flexShrink={0}>
                <Button key="todos:toggle" label={row.toggle ?? ''} plain dimColor onPress={() => onToggle?.()} />
              </Box>
              <Text wrap="truncate-end">{runs(spans.slice(at + 1))}</Text>
            </Box>
          )
        }

        return (
          <Box key={row.key} height={1} flexShrink={0}>
            <Text wrap="truncate-end">{runs(spans)}</Text>
          </Box>
        )
      })}
    </Box>
  )

  return { element, rowCount: rows.length }
}
