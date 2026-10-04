import type { BoxProps, ElementConstructor, RenderElement, SvgProps, TextProps } from 'claude-code'

import type { HudData, HudGit, HudLayout, HudRateLimit, HudTodo, HudTokens, HudUsage } from '../types'
import { renderTextRow } from './text-svg'
import type { TextSpan } from './text-svg'
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
/** A token count's kind after it (` in`, ` read`), padded so the second counts line up. */
const TOKEN_KIND_WIDTH = 7
const TOOL_NAME_MAX = 12
const TOOL_COUNT_NAME_MAX = 16
/** `● ` + name + ` ` + elapsed: reserved whether or not a tool runs. */
const NOW_WIDTH = 2 + TOOL_NAME_MAX + 1 + 7
/** The running tool's cell is reserved only while this much is left for the counts. */
const COUNTS_MIN = 20
const PIPS_MAX = 10
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
 * When a limit resets, in local time: `↻ 14:20` within a day, `↻ Tue` within
 * a week, `↻ Nov 1` past that, `↻ now` once due; `''` for an unreadable time.
 */
export const formatReset = (iso: string, now: number): string => {
  const at = typeof iso === 'string' ? Date.parse(iso) : Number.NaN
  if (!Number.isFinite(at)) return ''
  const ahead = at - now
  if (ahead <= 0) return '↻ now'
  const date = new Date(at)
  if (ahead < DAY_MS) return `↻ ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  if (ahead < 7 * DAY_MS) return `↻ ${DAYS[date.getDay()]}`

  return `↻ ${MONTHS[date.getMonth()]} ${date.getDate()}`
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
  /** The most todo pips: ten wide, as many as the bar has cells narrow. */
  pips: number
  /** Between tool counts and between the todo's parts: two cells wide, one narrow. */
  gap: string
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

// `◆ opus 5.5 · xhigh · gateway          1h 12m   $4.21`: the provider, then
// the effort, give way when the row runs short.
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

  let right: Span[] = []
  if (clock !== undefined) right.push(dim(padStart(clock, CLOCK_WIDTH)))
  if (cost !== undefined) right.push(...(right.length > 0 ? [plain('  ')] : []), strong(padStart(cost, COST_WIDTH)))
  const head: Span[] = [tint('◆', ACCENT), plain(' ')]
  let room = edge - widthOf(head) - (right.length > 0 ? widthOf(right) + 2 : 0)
  if (room < Math.min(8, Math.max(1, displayWidth(model)))) {
    right = []
    room = card - widthOf(head)
  }

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
  let body = build(true, true)
  if (widthOf(body) > room) body = build(true, false)
  if (widthOf(body) > room) body = build(false, false)

  return anchor([...head, ...clip(body, Math.max(0, room))], right, edge)
}

// `mcp 4 · skills 12`: beside the place wide, a row of its own narrow.
const inventorySpans = (data: HudData): Span[] => {
  const servers = Array.isArray(data.inventory?.mcpServers) ? data.inventory.mcpServers.length : 0
  const skills = countOf(data.inventory?.skills)

  return [servers > 0 ? `mcp ${servers}` : '', skills > 0 ? `skills ${skills}` : '']
    .filter(one => one !== '')
    .flatMap((one, index) => (index === 0 ? [dim(one)] : [SEPARATOR(), dim(one)]))
}

const inventoryRow = (data: HudData, { card }: Room): Span[] | undefined => {
  const inventory = inventorySpans(data)

  return inventory.length === 0 ? undefined : clip([plain(INDENT), ...inventory], card)
}

// `~/.claude/mods · main* +3 −1 ↑2          mcp 4 · skills 12`
const locationRow = (data: HudData, { card, edge }: Room, look: Look): Span[] | undefined => {
  const where = clean(data.session?.cwd) || clean(data.session?.repoRoot)
  const path = where === '' ? '' : tildify(where)
  const branch = clean(data.git?.branch)
  const isDirty = isDirtyOf(data.git)
  const changes = branch === '' ? '' : gitMarksOf(data.git)
  const inventory = look.isNarrow ? [] : inventorySpans(data)
  if (path === '' && branch === '' && inventory.length === 0) return undefined

  const gitTail = branch === '' ? 0 : (isDirty ? 1 : 0) + (changes === '' ? 0 : 1 + displayWidth(changes))
  const between = path !== '' && branch !== '' ? 3 : 0
  const natural = displayWidth(path) + between + displayWidth(branch) + gitTail
  // The inventory is the first thing to give way.
  const withInventory = inventory.length > 0 && INDENT.length + natural + 2 + widthOf(inventory) <= edge
  const budget = withInventory ? edge - INDENT.length - widthOf(inventory) - 2 : card - INDENT.length

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
  if (left.length === 1) return inventory.length === 0 ? undefined : clip([plain(INDENT), ...inventory], card)

  return anchor(clip(left, card), withInventory ? inventory : [], edge)
}

// `ctx   ━━━━━━━━────────────  41%  412k / 1.0M      3 compactions`; narrow
// the bar is shorter, and at 36 columns and under the percent stands alone.
const gaugeRow = (label: string, percent: number | undefined, detail: Span[], trailing: Span[], { card, edge }: Room, look: Look): Span[] => {
  if (percent === undefined) {
    return clip([...labelled(label), dim('—'), ...(detail.length > 0 ? [plain('  '), ...detail] : [])], card)
  }
  const shown = shownPercent(percent)
  const filled = filledOf(shown, look.bar)
  const spans: Span[] = [
    ...labelled(label),
    // The fill and the track are separate spans: the fill coloured, the track dim.
    tint(FILL.repeat(filled), levelColor(shown)),
    dim(TRACK.repeat(look.bar - filled)),
    plain(`${look.bar > 0 ? ' ' : ''}${padStart(`${shown}%`, PERCENT_WIDTH)}`),
    ...(detail.length > 0 ? [plain('  '), ...detail] : []),
  ].filter(span => span.text !== '')

  return anchor(clip(spans, card), trailing, edge)
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
  const compactions = countOf(usage?.compactions)
  const trailing = compactions > 0 ? [dim(`${compactions} compaction${compactions === 1 ? '' : 's'}`)] : []

  return gaugeRow('ctx', percent, detail, trailing, room, look)
}

const limitRow = (data: HudData, kind: HudRateLimit['kind'], label: string, room: Room, look: Look): Span[] | undefined => {
  const limit = limitOf(data.usage, kind)
  if (limit === undefined) return undefined
  const reset = limit.resetsAt === undefined ? '' : formatReset(limit.resetsAt, data.now)

  return gaugeRow(label, limit.percentUsed, reset === '' ? [] : [dim(reset)], [], room, look)
}

/** The session's tokens, when a response has reported any. */
const tokensOf = (usage: HudUsage | undefined): HudTokens | undefined => {
  const held = usage?.tokens
  if (held === undefined) return undefined
  const tokens = { input: countOf(held.input), output: countOf(held.output), cacheRead: countOf(held.cacheRead), cacheWrite: countOf(held.cacheWrite) }

  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite > 0 ? tokens : undefined
}

/** Two counts after a label, each with its kind dim after it, the second count in the same column on every such row. */
const countsRow = (label: string, first: [number, string], second: [number, string], trailing: Span[], { card, edge }: Room): Span[] =>
  anchor(clip([
    ...labelled(label),
    plain(padStart(formatTokens(first[0]), TOKENS_WIDTH)),
    dim(padEnd(` ${first[1]}`, TOKEN_KIND_WIDTH)),
    plain(padStart(formatTokens(second[0]), TOKENS_WIDTH)),
    dim(` ${second[1]}`),
  ], card), trailing, edge)

// `tok   1.2M in     84k out                   11.7M total`: input read
// fresh and output, then everything the session's requests counted.
const tokensRow = (data: HudData, room: Room): Span[] | undefined => {
  const tokens = tokensOf(data.usage)
  if (tokens === undefined) return undefined
  const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite

  return countsRow('tok', [tokens.input, 'in'], [tokens.output, 'out'], [plain(formatTokens(total)), dim(' total')], room)
}

// `cache 9.8M read  640k write                    87% hit`: what the prompt
// cache served and took, and how much of all input it served.
const cacheRow = (data: HudData, room: Room): Span[] | undefined => {
  const tokens = tokensOf(data.usage)
  if (tokens === undefined || tokens.cacheRead + tokens.cacheWrite === 0) return undefined
  const input = tokens.input + tokens.cacheRead + tokens.cacheWrite
  const hit = Math.round((tokens.cacheRead / input) * 100)

  return countsRow('cache', [tokens.cacheRead, 'read'], [tokens.cacheWrite, 'write'], [plain(`${hit}%`), dim(' hit')], room)
}

// `tools Read ×41  Bash ×12  Edit ×9  +2          ● Bash 00:04`
const toolsRow = (data: HudData, { card, edge }: Room, look: Look): Span[] | undefined => {
  const byLabel = new Map<string, number>()
  const counts = data.tools?.counts
  if (typeof counts === 'object' && counts !== null) {
    for (const [name, value] of Object.entries(counts)) {
      const label = toolLabel(name, TOOL_COUNT_NAME_MAX)
      if (label !== '' && countOf(value) > 0) byLabel.set(label, (byLabel.get(label) ?? 0) + countOf(value))
    }
  }
  const ranked = [...byLabel].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
  const current = data.tools?.current
  const name = typeof current?.name === 'string' ? toolLabel(current.name, TOOL_NAME_MAX) : ''
  if (ranked.length === 0 && name === '') return undefined

  const head = labelled('tools')
  // The running tool's cell is held even when nothing runs, so the counts never
  // reflow as a tool starts or stops. Where holding it would leave the counts
  // too little room, the counts take the row and the running tool shows only
  // when it fits after them.
  const reserve = edge - widthOf(head) - (NOW_WIDTH + 2) >= COUNTS_MIN ? NOW_WIDTH : 0
  const nowCell: Span[] = name === ''
    ? []
    : [
        tint('●', ACCENT),
        plain(` ${name} `),
        dim(formatDuration(data.now - (isNumber(current?.since) ? current.since : data.now))),
      ]
  const room = (reserve > 0 ? edge - reserve - 2 : card) - widthOf(head)

  const items: Span[] = []
  let used = 0
  let shown = 0
  for (const [label, value] of ranked) {
    const gap = shown > 0 ? look.gap.length : 0
    const width = gap + displayWidth(label) + 2 + String(value).length
    const rest = ranked.length - shown - 1
    const marker = rest > 0 ? look.gap.length + 1 + String(rest).length : 0
    if (used + width + marker > room) break
    if (gap > 0) items.push(plain(look.gap))
    items.push(plain(label), dim(` ×${value}`))
    used += width
    shown += 1
  }
  const hidden = ranked.length - shown
  if (hidden > 0) items.push(...(shown > 0 ? [plain(look.gap)] : []), dim(`+${hidden}`))

  return anchor(clip([...head, ...items], card), nowCell, edge)
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
  const barCells = barWidthFor(columns, isNarrow)
  const look: Look = { isNarrow, bar: barCells, pips: isNarrow ? barCells : PIPS_MAX, gap: isNarrow ? ' ' : '  ' }

  // Wide and narrow draw the same sections in the same order; narrow stacks
  // the inventory on a row of its own. A short pane drops the motto, the
  // inventory, the cache, the tokens, tools, the place, then the limits; never
  // identity or ctx. The todo list is a section of its own under the HUD
  // (renderTodos).
  const lines: Line[] = [
    { id: 'identity', rank: 100, draw: room => identityRow(data, room) },
    { id: 'location', rank: 70, draw: room => locationRow(data, room, look) },
    { id: 'ctx', rank: 90, draw: room => contextRow(data, room, look) },
    ...LIMITS.map(({ kind, label, rank }): Line => ({ id: kind, rank, draw: room => limitRow(data, kind, label, room, look) })),
    { id: 'tokens', rank: 45, draw: room => tokensRow(data, room) },
    { id: 'cache', rank: 40, draw: room => cacheRow(data, room) },
    { id: 'tools', rank: 50, draw: room => toolsRow(data, room, look) },
    ...(isNarrow ? [{ id: 'inventory', rank: 30, draw: (room: Room) => inventoryRow(data, room) }] : []),
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
 * at most 100 characters (the last segments give way first). The caller
 * appends the agents summary.
 */
export const statusLineText = (data: HudData): string => {
  const segments: string[] = []
  const who = [modelLabel(clean(data.session?.model)), clean(data.session?.effort)].filter(one => one !== '').join(' · ')
  if (who !== '') segments.push(truncate(who, 32))

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
// the agents: `TODO:` bold, then one item per row, two cells in. Layout:
// docs/pane-sketch.md ("TODO").

/** How many todo items the section lists by default; the rest are counted. */
export const TODO_ROWS = 6

const TODO_GLYPH: Record<HudTodo['status'], string> = { in_progress: '◐', pending: '☐', completed: '☑' }
const TODO_ORDER: Record<HudTodo['status'], number> = { in_progress: 0, pending: 1, completed: 2 }

/** One row of the TODO section: its text (glyph and item, cut to the pane) and its state. */
export type TodoRow = { key: string; text: string; status?: HudTodo['status']; more?: number }

/**
 * The section's rows, header first: the items in progress (their active form),
 * then pending, then completed, at most `max`, then `+n more` for the rest.
 * Empty when there are no items.
 */
export const todoRows = (todos: HudData['todos'], columns: number, max = TODO_ROWS): TodoRow[] => {
  const items = todoItemsOf({ todos, now: 0 })
    .map((item, index) => ({ item, index }))
    .sort((a, b) => TODO_ORDER[a.item.status] - TODO_ORDER[b.item.status] || a.index - b.index)
  if (items.length === 0) return []
  const width = Math.max(1, Math.floor(columns))
  const cap = Math.max(1, Math.floor(max))
  const shown = items.slice(0, cap)
  const rows: TodoRow[] = shown.map(({ item, index }) => {
    const text = item.status === 'in_progress' ? clean(item.activeForm) || clean(item.content) : clean(item.content)

    return { key: `todo:${index}`, status: item.status, text: truncate(`  ${TODO_GLYPH[item.status]} ${text}`, width) }
  })
  const rest = items.length - shown.length

  return [
    { key: 'todo:header', text: truncate('TODO:', width) },
    ...rows,
    ...(rest > 0 ? [{ key: 'todo:more', text: truncate(`  +${rest} more`, width), more: rest }] : []),
  ]
}

/** The section as plain text, header first: what `renderTodos` draws, uncoloured. */
export const todoLines = (todos: HudData['todos'], columns: number, max = TODO_ROWS): string[] => todoRows(todos, columns, max).map(row => row.text)

/** A TODO row's runs: the header bold, `+n more` dim, a completed item dim and struck, one in progress its glyph in the accent. */
const todoSpans = (row: TodoRow): TextSpan[] => {
  if (row.key === 'todo:header') return [{ text: row.text, bold: true }]
  if (row.more !== undefined) return [{ text: row.text, dimColor: true }]
  if (row.status === 'completed') return [{ text: row.text, dimColor: true, strikethrough: true }]
  if (row.status === 'in_progress') return [{ text: row.text.slice(0, 4), color: ACCENT }, { text: row.text.slice(4) }]

  return [{ text: row.text }]
}

/**
 * The TODO section: a keyed column (`todos`) of one-row Boxes (`todo:header`,
 * `todo:0`, ...), each one Text cut to the pane, or with `ui.Svg` the row in
 * pixels. A completed item is struck through and dim, its `☑` included; one
 * in progress has its `◐` in the accent; `+n more` is dim. Undefined when
 * there is nothing to list.
 */
export const renderTodos = (ui: HudElements, todos: HudData['todos'], layout: { columns: number; max?: number }): { element?: RenderElement; rowCount: number } => {
  const rows = todoRows(todos, layout.columns, layout.max)
  if (rows.length === 0) return { rowCount: 0 }
  const { Box, Text, Svg } = ui
  if (Svg !== undefined) {
    const element = (
      <Box key="todos" flexDirection="column" flexShrink={0}>
        {rows.map(row => renderTextRow({ Box, Svg }, { key: row.key, cells: todoSpans(row) }))}
      </Box>
    )

    return { element, rowCount: rows.length }
  }
  const element = (
    <Box key="todos" flexDirection="column" flexShrink={0}>
      {rows.map(row => {
        const body = row.status === undefined ? row.text : row.text.slice(4)
        const lead = row.status === undefined ? '' : row.text.slice(0, 4)

        return (
          <Box key={row.key} height={1} flexShrink={0}>
            {row.key === 'todo:header'
              ? <Text bold wrap="truncate-end">{row.text}</Text>
              : row.more !== undefined
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
