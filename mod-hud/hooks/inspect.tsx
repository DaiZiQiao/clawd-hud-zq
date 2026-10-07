import type { ButtonProps, ElementConstructor, RenderElement } from 'claude-code'

import type { HudDetailFacts, HudSelection, HudTab, HudTokenFacts, HudTrailStep } from '../types'
import type { CostModel, RunCounts } from './hud-ledger'
import { formatCost, formatTokens } from './hud'
import { displayWidth, padEnd, truncate } from './text-width'
import type { HudElements } from './hud'
import { renderTextRow } from './text-svg'
import type { TextCell } from './text-svg'

// Click to inspect: the trail of each agent's tool calls, as `mod-hud.trails`
// holds it, and the tabbed inspect view the pane draws under the HUD while an
// agent (or the session) is selected. Pure functions to rows of text parts and
// button cells; register.tsx reads and writes the atoms and maps a button's
// action back to them. Layout: docs/pane-sketch.md ("Inspect view").

/** The most calls one agent's trail keeps, the newest last. */
export const TRAIL_MAX = 200
/** The most calls all trails keep together: past it the oldest of other agents go first. */
export const TRAILS_TOTAL = 800
/** A call's main argument is cut to this many characters. */
export const ARG_MAX = 160
/** The Said tab lists this many of the last assistant messages. */
export const SAID_MAX = 10
/** Each message is kept to this many characters. */
export const SAID_CHARS = 2000
/** The prompt is kept to this many characters. */
export const PROMPT_CHARS = 8000
/** Below this many columns the header is stacked. */
export const DETAIL_NARROW_BELOW = 60

export type Trails = Record<string, HudTrailStep[]>

// Theme keys, as the rest of the pane uses them.
const ACCENT = 'claude'
const WARN = 'warning'
const HOT = 'error'

// Text from the world is one line of printable text.
const isControl = (cp: number): boolean => cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029

const flat = (text: string): string =>
  [...text].map(char => (isControl(char.codePointAt(0) ?? 0) ? ' ' : char)).join('').split(' ').filter(word => word !== '').join(' ')

/** `…` and the end of a text longer than `max` characters: a path's file name stays. */
const keepEnd = (text: string, max: number): string => ([...text].length <= max ? text : `…${[...text].slice(-(max - 1)).join('')}`)

/** `…` after the start of a text longer than `max` characters. */
const keepStart = (text: string, max: number): string => ([...text].length <= max ? text : `${[...text].slice(0, max - 1).join('')}…`)

const PATHS = ['file_path', 'notebook_path', 'path'] as const
const WORDS = ['command', 'pattern', 'url', 'query', 'to', 'skill', 'description', 'prompt'] as const

/**
 * A call's main argument, from its input as `tool.call` carries it: a file
 * path (its end kept), else the command, pattern, URL, query, recipient or
 * description (its start kept), one line of at most ARG_MAX characters.
 */
export const mainArgOf = (input: Readonly<Record<string, unknown>>): string | undefined => {
  if ((input.tool === 'Grep' || input.tool === 'Glob') && typeof input.pattern === 'string' && flat(input.pattern) !== '') return keepStart(flat(input.pattern), ARG_MAX)
  for (const key of PATHS) {
    const value = input[key]
    if (typeof value === 'string' && flat(value) !== '') return keepEnd(flat(value), ARG_MAX)
  }
  for (const key of WORDS) {
    const value = input[key]
    if (typeof value === 'string' && flat(value) !== '') return keepStart(flat(value), ARG_MAX)
  }

  return undefined
}

// Past TRAILS_TOTAL, the oldest calls of agents other than `keep` go first.
const totalCapped = (trails: Trails, keep: string): Trails => {
  const total = Object.values(trails).reduce((sum, steps) => sum + steps.length, 0)
  const excess = total - TRAILS_TOTAL
  if (excess <= 0) return trails
  const oldest = Object.entries(trails)
    .filter(([id]) => id !== keep)
    .flatMap(([id, steps]) => steps.map((step, index) => ({ id, index, at: step.at })))
    .sort((a, b) => a.at - b.at || a.index - b.index || a.id.localeCompare(b.id))
    .slice(0, excess)
  const dropped = new Map<string, number>()
  for (const one of oldest) dropped.set(one.id, (dropped.get(one.id) ?? 0) + 1)
  const next: Trails = {}
  for (const [id, steps] of Object.entries(trails)) {
    const kept = steps.slice(dropped.get(id) ?? 0)
    if (kept.length > 0) next[id] = kept
  }

  return next
}

/**
 * The trails with one more call for `id`, the newest last: at most TRAIL_MAX
 * for one agent and TRAILS_TOTAL for all; ids `keep` no longer names (gone
 * from the board and the workflow agents) are dropped in the same write.
 */
export const trailAdded = (trails: Readonly<Trails>, id: string, step: HudTrailStep, keep: (id: string) => boolean): Trails => {
  const next: Trails = {}
  for (const [one, steps] of Object.entries(trails)) if (one !== id && keep(one)) next[one] = steps
  next[id] = [...(trails[id] ?? []), step].slice(-TRAIL_MAX)

  return totalCapped(next, id)
}

/**
 * The trails with the call of `id` that started at `at` with `tool` ended:
 * its duration and outcome. The same object when no such open call is held.
 */
export const trailEnded = (trails: Readonly<Trails>, id: string, call: { tool: string; at: number }, end: { ms: number; outcome: NonNullable<HudTrailStep['outcome']> }): Trails => {
  const steps = trails[id]
  const index = steps?.findIndex(step => step.tool === call.tool && step.at === call.at && step.ms === undefined) ?? -1
  if (steps === undefined || index < 0) return trails as Trails
  const next = [...steps]
  next[index] = { ...steps[index] as HudTrailStep, ms: Math.max(0, Math.round(end.ms)), outcome: end.outcome }

  return { ...trails, [id]: next }
}

/** The trails without the ids `keep` no longer names: the same object when none goes. */
export const trailsPruned = (trails: Readonly<Trails>, keep: (id: string) => boolean): Trails => {
  const kept = Object.entries(trails).filter(([id]) => keep(id))

  return kept.length === Object.keys(trails).length ? (trails as Trails) : Object.fromEntries(kept)
}

/** `Read src/a.ts`: a trail step as the views list it. */
export const stepText = (step: Pick<HudTrailStep, 'tool' | 'arg'>): string => (step.arg === undefined ? step.tool : `${step.tool} ${step.arg}`)

type MessageRow = { role: string; text: string }

/** The last `max` assistant messages with text, oldest first, each at most SAID_CHARS characters. */
export const assistantTexts = (messages: readonly MessageRow[], max = SAID_MAX): string[] =>
  messages.filter(one => one.role === 'assistant' && one.text.trim() !== '').slice(-max).map(one => one.text.trim().slice(0, SAID_CHARS))

/** The last assistant message with text, from `$.session.messages({ agentId })`'s rows. */
export const lastAssistantText = (messages: readonly MessageRow[]): string | undefined => assistantTexts(messages, 1)[0]

/** The first user message with text: the agent's prompt, at most PROMPT_CHARS characters. */
export const promptOf = (messages: readonly MessageRow[]): string | undefined =>
  messages.find(one => one.role === 'user' && one.text.trim() !== '')?.text.trim().slice(0, PROMPT_CHARS)

// --- rows --------------------------------------------------------------------

/** A run of text in one look. */
export type Part = { text: string; color?: string; dimColor?: boolean; bold?: boolean; italic?: boolean }

/** What a press in the view asks for: Back, a tab, or a Cost-tree model opened or closed. */
export type InspectAction = { kind: 'back' } | { kind: 'tab'; tab: HudTab } | { kind: 'model'; model: string }

/**
 * A Button in a row: `primary` draws `[ label ]` (the active tab), else plain,
 * the label alone. `cover`: where the row is drawn in pixels, the Button takes
 * only the label's first this many cells, the rest drawn as text in its columns.
 */
export type ButtonCell = { button: { key: string; label: string; primary?: true; dimColor?: true; cover?: number; action: InspectAction } }

export type Cell = Part | ButtonCell

/** One row of the view: its key, and its cells left to right. */
export type InspectRow = { key: string; cells: Cell[] }

const isButton = (cell: Cell): cell is ButtonCell => 'button' in cell

const dim = (text: string): Part => ({ text, dimColor: true })

/** A cell as the terminal draws it: `[ label ]` for a primary Button, the label for a plain one. */
export const cellText = (cell: Cell): string => (isButton(cell) ? (cell.button.primary === true ? `[ ${cell.button.label} ]` : cell.button.label) : cell.text)

/** A row as plain text: what docs/pane-sketch.md shows. */
export const rowText = (row: InspectRow): string => row.cells.map(cellText).join('').trimEnd()

/** The rows as plain text. */
export const inspectLines = (rows: readonly InspectRow[]): string[] => rows.map(rowText)

/** Words wrapped into rows of at most `width` cells, at most `rows` rows, the last ending in `…` when cut. */
export const wrapText = (text: string, width: number, rows: number): string[] => {
  const words = flat(text).split(' ').filter(word => word !== '')
  const out: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line === '' ? word : `${line} ${word}`
    if (displayWidth(candidate) <= width) {
      line = candidate
      continue
    }
    if (line !== '') out.push(line)
    line = displayWidth(word) <= width ? word : truncate(word, width)
    if (out.length >= rows) break
  }
  if (line !== '' && out.length < rows) out.push(line)
  const cut = out.length > rows || (out.length === rows && out.join(' ').length < words.join(' ').length)
  const kept = out.slice(0, rows)
  if (cut && kept.length > 0) kept[kept.length - 1] = truncate(`${kept[kept.length - 1] ?? ''} …`, width).replace(/ …$/, '…')

  return kept
}

// A word wider than the row is broken into row-wide pieces.
const pieces = (word: string, width: number): string[] => {
  if (displayWidth(word) <= width) return [word]
  const out: string[] = []
  let piece = ''
  for (const char of word) {
    if (displayWidth(piece + char) > width && piece !== '') {
      out.push(piece)
      piece = ''
    }
    piece += char
  }

  return piece === '' ? out : [...out, piece]
}

/** One line's words wrapped to `width` cells, nothing cut: a long word breaks across rows. */
export const wrapLine = (text: string, width: number): string[] => {
  const room = Math.max(1, width)
  const out: string[] = []
  let line = ''
  for (const word of flat(text).split(' ').filter(one => one !== '').flatMap(one => pieces(one, room))) {
    const candidate = line === '' ? word : `${line} ${word}`
    if (displayWidth(candidate) <= room) line = candidate
    else {
      if (line !== '') out.push(line)
      line = word
    }
  }

  return line === '' ? out : [...out, line]
}

/** A text's paragraphs wrapped to `width`: its lines kept, a run of blank lines kept as one blank row. */
export const wrapAll = (text: string, width: number): string[] => {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const rows = wrapLine(line, width)
    if (rows.length > 0) out.push(...rows)
    else if (out.length > 0 && out.at(-1) !== '') out.push('')
  }
  while (out.at(-1) === '') out.pop()

  return out
}

const textRows = (key: string, lines: readonly string[], look: Omit<Part, 'text'> = {}, indent = ''): InspectRow[] =>
  lines.map((line, index) => ({ key: `${key}:${index}`, cells: [{ text: line === '' ? '' : `${indent}${line}`, ...look }] }))

const note = (key: string, text: string, columns: number): InspectRow[] => textRows(key, wrapLine(text, columns), { dimColor: true })

const gap = (key: string): InspectRow => ({ key, cells: [{ text: '' }] })

// --- header and tabs ----------------------------------------------------------

export const BACK = '◂ Back'
export const WORKFLOW_NOTE = 'conversation not exposed for workflow agents'

/** Who the view shows, for its header: the glyph, the name in its colour, then its facts. */
export type InspectHeader = { glyph: string; glyphColour: string; name: string; colour?: string; facts: readonly string[] }

/** The tabs of an agent's view and of the session's. */
export const AGENT_TABS: readonly HudTab[] = ['task', 'trail', 'said', 'agents']
export const SESSION_TABS: readonly HudTab[] = ['overview', 'cost', 'agents']

const TAB_LABELS: Readonly<Record<HudTab, string>> = { task: 'Task', trail: 'Trail', said: 'Said', agents: 'Agents', overview: 'Overview', cost: 'Cost' }

/** The tabs a selection has. */
export const tabsOf = (kind: HudSelection['kind']): readonly HudTab[] => (kind === 'main' ? SESSION_TABS : AGENT_TABS)

/** The tab a selection shows: its own when it has that tab, else its first. */
export const tabOf = (selection: HudSelection): HudTab => {
  const tabs = tabsOf(selection.kind)

  return selection.tab !== undefined && tabs.includes(selection.tab) ? selection.tab : (tabs[0] as HudTab)
}

/**
 * The header: Back, then the glyph, the name (bold, in its colour) and its
 * facts joined by ` · `, cut to the pane; below DETAIL_NARROW_BELOW the facts
 * take rows of their own, two cells in.
 */
export const headerRows = (header: InspectHeader, columns: number): InspectRow[] => {
  const back: ButtonCell = { button: { key: 'detail:back', label: BACK, action: { kind: 'back' } } }
  const lead = `${BACK}   `
  const name: Part = { text: header.name, bold: true, ...(header.colour === undefined ? {} : { color: header.colour }) }
  const glyph: Part = { text: `${header.glyph} `, color: header.glyphColour }
  const facts = header.facts.filter(one => one !== '')
  if (columns >= DETAIL_NARROW_BELOW) {
    const room = Math.max(1, columns - displayWidth(lead) - 2 - displayWidth(header.name))

    return [{ key: 'title', cells: [back, { text: '   ' }, glyph, name, ...(facts.length === 0 ? [] : [dim(truncate(` · ${facts.join(' · ')}`, room))])] }]
  }
  const shownName = truncate(header.name, Math.max(1, columns - displayWidth(lead) - 2))

  return [
    { key: 'title', cells: [back, { text: '   ' }, glyph, { ...name, text: shownName }] },
    ...textRows('title:facts', wrapLine(facts.join(' · '), Math.max(1, columns - 2)), { dimColor: true }, '  '),
  ]
}

/** The tab bar: the active tab a primary Button (`[ Task ]`), the rest plain and dim, two cells apart and one more after a plain one. */
export const tabRow = (tabs: readonly HudTab[], active: HudTab): InspectRow => ({
  key: 'tabs',
  cells: tabs.flatMap((tab, index): Cell[] => {
    const isActive = tab === active
    const button: ButtonCell = { button: { key: `tab:${tab}`, label: TAB_LABELS[tab], ...(isActive ? { primary: true as const } : { dimColor: true as const }), action: { kind: 'tab', tab } } }

    return index === tabs.length - 1 ? [button] : [button, { text: isActive ? '  ' : '   ' }]
  }),
})

// --- the agent's tabs -----------------------------------------------------------

/** What an agent's tabs show: its task, its trail, its conversation as fetched. */
export type AgentBody = {
  kind: 'agent' | 'shadow'
  description?: string
  trail: readonly HudTrailStep[]
  /** Whether it runs now: an open call in its trail is then its current one. */
  running: boolean
  /** Its conversation, when fetched for this agent. */
  detail?: HudDetailFacts
}

/** The Task tab: the description (bold), then the prompt it was given, wrapped, every row kept. */
export const taskRows = (body: AgentBody, columns: number): InspectRow[] => {
  const description = body.description?.trim() ?? ''
  if (body.kind === 'shadow') return note('task:note', 'a workflow agent has no task description, and its prompt is not exposed', columns)
  const prompt = body.detail?.prompt?.trim()
  const rows = description === '' ? [] : textRows('task:description', wrapAll(description, columns), { bold: true })
  const more = prompt !== undefined && prompt !== '' && flat(prompt) !== flat(description)
    ? textRows('task:prompt', wrapAll(prompt, columns))
    : body.detail === undefined
      ? note('task:reading', 'reading the prompt…', columns)
      : body.detail.deny === undefined ? [] : note('task:deny', body.detail.deny, columns)
  if (rows.length === 0 && more.length === 0) return note('task:none', '(no description)', columns)

  return rows.length === 0 || more.length === 0 ? [...rows, ...more] : [...rows, gap('task:gap'), ...more]
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** `14:02:11`, local time. */
export const clockOf = (at: number): string => {
  const date = new Date(at)

  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

/** `0.4s`, `42s`, `4m05`, `1h02`: five cells at most below 100 hours. */
export const spanOf = (ms: number): string => {
  const total = Math.max(0, ms)
  if (total < 10_000) return `${(total / 1000).toFixed(1)}s`
  const seconds = Math.floor(total / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${pad2(seconds % 60)}`

  return `${Math.floor(minutes / 60)}h${pad2(minutes % 60)}`
}

const TIME_WIDTH = 8
const SPAN_WIDTH = 5
const OUTCOME_WIDTH = 6
/** Time, two blanks, the span, a blank, the outcome, a blank: where the call's text starts. */
export const TRAIL_LEAD = TIME_WIDTH + 2 + SPAN_WIDTH + 1 + OUTCOME_WIDTH + 1
const OUTCOME_COLOURS: Readonly<Record<string, string>> = { denied: WARN, error: HOT }

/**
 * The Trail tab: every call held, the newest last, one per entry: its start
 * time, how long it took and how it ended, then the tool and its argument
 * wrapped under it. An open call of a running agent is the current one,
 * drawn in the accent with `now`; one whose end was never seen reads `?`.
 * Below DETAIL_NARROW_BELOW a call that does not fit its row puts its
 * argument on rows of its own, two cells in.
 */
export const trailRows = (body: AgentBody, columns: number, now: number): InspectRow[] => {
  if (body.trail.length === 0) return note('trail:none', 'no calls yet', columns)
  const room = columns - TRAIL_LEAD
  const narrow = columns < DETAIL_NARROW_BELOW

  return body.trail.flatMap((step, index): InspectRow[] => {
    const open = step.ms === undefined
    const current = open && body.running
    const span = !open ? spanOf(step.ms ?? 0) : current ? spanOf(now - step.at) : ''
    const outcome = step.outcome ?? (current ? 'now' : open ? '?' : '')
    const lead: Part[] = [
      { text: `${clockOf(step.at)}  `, ...(current ? { color: ACCENT } : { dimColor: true }) },
      { text: `${span.padStart(SPAN_WIDTH)} `, ...(current ? { color: ACCENT } : { dimColor: true }) },
      { text: outcome.padEnd(OUTCOME_WIDTH), ...(current ? { color: ACCENT, bold: true } : OUTCOME_COLOURS[outcome] === undefined ? { dimColor: true } : { color: OUTCOME_COLOURS[outcome] }) },
    ]
    const what = stepText(step)
    const look: Omit<Part, 'text'> = current ? { color: ACCENT, bold: true } : {}
    if (narrow && displayWidth(what) > room) {
      const tool = truncate(step.tool, Math.max(1, room))

      return [
        { key: `trail:${index}`, cells: [...lead, { text: ' ' }, { text: tool, ...look }] },
        ...wrapLine(step.arg ?? '', Math.max(1, columns - 2)).map((line, row) => ({ key: `trail:${index}:${row}`, cells: [{ text: `  ${line}`, ...look }] })),
      ]
    }
    const lines = wrapLine(what, Math.max(1, room))

    return lines.map((line, row) => ({
      key: row === 0 ? `trail:${index}` : `trail:${index}:${row}`,
      cells: row === 0 ? [...lead, { text: ' ' }, { text: line, ...look }] : [{ text: `${' '.repeat(TRAIL_LEAD)}${line}`, ...look }],
    }))
  })
}

/**
 * The Said tab: a subagent's last assistant messages, wrapped, the newest at
 * the bottom, a blank row between; a workflow agent's note instead.
 */
export const saidRows = (body: AgentBody, columns: number): InspectRow[] => {
  if (body.kind === 'shadow') return note('said:note', WORKFLOW_NOTE, columns)
  const detail = body.detail
  if (detail === undefined) return note('said:reading', 'reading the conversation…', columns)
  if (detail.deny !== undefined) return note('said:deny', detail.deny, columns)
  const said = detail.said ?? []
  if (said.length === 0) return note('said:none', 'nothing said yet', columns)

  return said.flatMap((text, index) => [...(index === 0 ? [] : [gap(`said:${index}:gap`)]), ...textRows(`said:${index}`, wrapAll(text, columns))])
}

// --- the session's tabs -----------------------------------------------------------

/** What the Overview tab reads, gathered by the pane. */
export type SessionOverview = {
  /** Since the session (or the last /clear) began. */
  duration?: number
  busy?: { busy: number; idle: number }
  turns?: number
  compactions: number
  /** Since the last main compaction. */
  sinceCompaction?: number
  context?: { used?: number; window?: number; percent?: number; perTurn?: number; turnsLeft?: number }
  tokens?: HudTokenFacts
  limits: readonly { label: string; percent: number; eta?: number; untilReset?: number; reset?: string }[]
  asks: number
  failures: { denied: number; error: number }
  runs: RunCounts
  /** Distinct files the main loop edited this conversation (moved here from the HUD in 1.2.0). */
  edited?: number
}

const LABEL = 9

/** `1h12m`, `14m`, `42s`. */
const agoOf = (ms: number): string => {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`

  return `${Math.floor(minutes / 60)}h${pad2(minutes % 60)}m`
}

/** `~2h10`, `~45m`. */
const etaOf = (ms: number): string => {
  const minutes = Math.max(1, Math.round(ms / 60_000))

  return minutes < 60 ? `~${minutes}m` : `~${Math.floor(minutes / 60)}h${pad2(minutes % 60)}`
}

const percentOf = (part: number, whole: number): string => `${whole > 0 ? Math.round((part / whole) * 100) : 0}%`

// Pieces joined by ` · `, a row filled before the next starts; a piece wider than the row is cut.
const flow = (items: readonly string[], width: number): string[] => {
  const rows: string[] = []
  let line = ''
  for (const item of items.filter(one => one !== '')) {
    const piece = truncate(item, width)
    const candidate = line === '' ? piece : `${line} · ${piece}`
    if (displayWidth(candidate) <= width) line = candidate
    else {
      rows.push(line)
      line = piece
    }
  }

  return line === '' ? rows : [...rows, line]
}

const labelled = (key: string, label: string, items: readonly string[], columns: number): InspectRow[] =>
  flow(items, Math.max(1, columns - LABEL)).map((line, index) => ({
    key: `${key}:${index}`,
    cells: [dim((index === 0 ? label : '').padEnd(LABEL)), { text: line }],
  }))

/** The Overview tab: the session's time, turns, context, tokens, limits, asks, failures and agents, a label column then ` · `-joined facts. */
export const overviewRows = (view: SessionOverview, columns: number): InspectRow[] => {
  const share = view.busy === undefined ? [] : [`busy ${percentOf(view.busy.busy, view.busy.busy + view.busy.idle)}`, `idle ${percentOf(view.busy.idle, view.busy.busy + view.busy.idle)}`]
  const context = view.context
  const used = context?.used === undefined ? undefined : `${formatTokens(context.used)}${context.window === undefined ? '' : ` / ${formatTokens(context.window)}`}`
  const tokens = view.tokens
  const input = tokens === undefined ? 0 : tokens.input + tokens.cacheRead + tokens.cacheWrite
  const runs = view.runs
  const limits = view.limits.length === 0
    ? labelled('limits', 'limits', ['none reported'], columns)
    : view.limits.flatMap((limit, index) => labelled(`limits:${index}`, index === 0 ? 'limits' : '', [
        `${limit.label} ${Math.round(limit.percent)}%`,
        limit.eta === undefined ? '—' : limit.untilReset !== undefined && limit.eta > limit.untilReset ? 'resets before the cap' : `cap in ${etaOf(limit.eta)}`,
        limit.reset ?? '',
      ], columns))

  return [
    ...labelled('time', 'time', [view.duration === undefined ? '—' : agoOf(view.duration), ...share], columns),
    ...labelled('turns', 'turns', [
      view.turns === undefined ? '0 turns' : `${view.turns} turn${view.turns === 1 ? '' : 's'}`,
      view.compactions === 0 ? 'no compactions' : `${view.compactions} compaction${view.compactions === 1 ? '' : 's'}`,
      view.compactions > 0 && view.sinceCompaction !== undefined ? `last ${agoOf(view.sinceCompaction)} ago` : '',
      view.edited !== undefined && view.edited > 0 ? `${view.edited} file${view.edited === 1 ? '' : 's'} edited` : '',
    ], columns),
    ...labelled('context', 'context', [
      used ?? '—',
      context?.percent === undefined ? '' : `${Math.round(context.percent)}%`,
      context?.perTurn === undefined ? '' : `+${formatTokens(context.perTurn)}/turn`,
      context?.turnsLeft === undefined ? '' : `compacts in ~${context.turnsLeft} turn${context.turnsLeft === 1 ? '' : 's'}`,
    ], columns),
    ...labelled('tokens', 'tokens', tokens === undefined ? ['—'] : [
      `${formatTokens(tokens.input)} in`,
      `${formatTokens(tokens.output)} out`,
      `${formatTokens(tokens.cacheRead)} cache read`,
      `${formatTokens(tokens.cacheWrite)} cache write`,
      `${percentOf(tokens.cacheRead, input)} cache hit`,
    ], columns),
    ...limits,
    ...labelled('asks', 'asks', [view.asks === 0 ? 'none waiting' : `${view.asks} waiting`], columns),
    ...labelled('failures', 'failures', view.failures.denied + view.failures.error === 0 ? ['none'] : [`${view.failures.denied} denied`, `${view.failures.error} error${view.failures.error === 1 ? '' : 's'}`], columns),
    ...labelled('agents', 'agents', [
      `${runs.spawned} spawned`,
      runs.running > 0 ? `${runs.running} running` : '',
      `${runs.done} done`,
      runs.failed > 0 ? `${runs.failed} failed` : '',
      `${Math.round(runs.ms / 60_000)} agent-min`,
    ], columns),
  ]
}

/** What the Cost tab reads: the session's total, its age, and the ledger priced by model. */
export type CostView = { totalUsd?: number; duration?: number; models: readonly CostModel[] }

/** The Cost tree is at most this wide: costs stay beside what they price. */
const COST_CARD = 60
const COST_WIDTH = 9
const SHARE_WIDTH = 5
export const COST_NOTE = 'The session total is split by model and agent using estimated list-price shares.'
export const COST_ESTIMATE_NOTE = 'Costs by model and agent are list-price estimates; no session total is available.'

/**
 * The Cost tab: the session's total and its rate an hour, then each model a
 * Button line (`▸ opus-5-5 … $248.30  74%`) that opens to its users by cost
 * (`• main`, `• frontend  Desktop: draw…`, `• workflow ×15`), costs in one
 * column; a dim note that the split is estimated.
 */
export const costRows = (view: CostView, columns: number, expanded: ReadonlySet<string>): InspectRow[] => {
  const width = Math.max(20, Math.min(columns, COST_CARD))
  const estimated = view.models.reduce((sum, one) => sum + one.usd, 0)
  const total = view.totalUsd ?? (estimated > 0 ? estimated : undefined)
  const scale = view.totalUsd === undefined ? 1 : estimated > 0 ? view.totalUsd / estimated : 0
  const hours = view.duration === undefined ? undefined : view.duration / 3_600_000
  const rate = total !== undefined && hours !== undefined && hours >= 1 / 60 ? `$${Math.round(total / hours)}/h` : undefined
  const head: InspectRow = {
    key: 'cost:total',
    cells: [{ text: 'Cost ', bold: true }, { text: total === undefined ? '—' : `${view.totalUsd === undefined ? '~' : ''}${formatCost(total)}`, bold: true }, ...(rate === undefined ? [] : [dim(` · ${rate}`)])],
  }
  if (view.models.length === 0) return [head, gap('cost:gap'), ...note('cost:none', 'no requests counted yet', columns)]
  const nameWidth = width - 2 - COST_WIDTH - SHARE_WIDTH
  const rows = view.models.flatMap((model): InspectRow[] => {
    const open = expanded.has(model.model)
    const cost = model.priced ? formatCost(model.usd * scale) : '—'
    const share = model.priced ? `${Math.round(model.share * 100)}%` : '—'
    const label = `${open ? '▾' : '▸'} ${truncate(model.model, nameWidth).padEnd(nameWidth)}${cost.padStart(COST_WIDTH)}${share.padStart(SHARE_WIDTH)}`
    // In pixels the Button is the glyph and the name; the costs stay in their columns.
    const cover = 2 + displayWidth(truncate(model.model, nameWidth))
    const line: InspectRow = { key: `cost:${model.model}`, cells: [{ button: { key: `cost:${model.model}`, label, cover, action: { kind: 'model', model: model.model } } }] }
    if (!open) return [line]
    const userWidth = width - 4 - COST_WIDTH - SHARE_WIDTH

    return [line, ...model.users.map((user): InspectRow => {
      const name = user.count === undefined ? user.label : `${user.label} ×${user.count}`
      const detail = user.detail === undefined || user.detail.trim() === '' ? '' : `  ${flat(user.detail)}`
      const text = truncate(`${name}${detail}`, userWidth)
      const shownName = text.startsWith(name) ? name : text
      const rest = text.slice(shownName.length)

      return {
        key: `cost:${model.model}:${user.key}`,
        cells: [dim('  • '), { text: shownName }, dim(padEnd(rest, userWidth - displayWidth(shownName))), { text: (model.priced ? formatCost(user.usd * scale) : '—').padStart(COST_WIDTH) }],
      }
    })]
  })

  return [head, gap('cost:gap'), ...rows, gap('cost:gap:note'), ...note('cost:note', view.totalUsd === undefined ? COST_ESTIMATE_NOTE : COST_NOTE, columns)]
}

// --- the view ---------------------------------------------------------------------

/** The view's rows: the header, the tab bar, a blank row, then the tab's body (the Agents tab's lists follow them). */
export const inspectRows = (header: InspectHeader, tabs: readonly HudTab[], active: HudTab, body: readonly InspectRow[], columns: number): InspectRow[] => [
  ...headerRows(header, columns),
  tabRow(tabs, active),
  gap('gap'),
  ...body,
]

const styleOf = (part: Part): Omit<Part, 'text'> => {
  const { text: _text, ...style } = part

  return Object.fromEntries(Object.entries(style).filter(([, one]) => one !== undefined && one !== false))
}

/** The label's first `cells` cells, and the rest. */
const splitAt = (label: string, cells: number): [string, string] => {
  let head = ''
  for (const char of label) {
    if (displayWidth(head + char) > cells) break
    head += char
  }

  return [head, label.slice(head.length)]
}

/** A row's cells for the pixel rows: its parts as runs, its Buttons laid over their cells (a covering one over its first cells only). */
const textCellsOf = (row: InspectRow, onAction: (action: InspectAction) => void): TextCell[] =>
  row.cells.flatMap((cell): TextCell[] => {
    if (!isButton(cell)) return [{ ...styleOf(cell), text: cell.text }]
    const { key, label, primary, dimColor, cover, action } = cell.button
    const [head, rest] = cover === undefined || primary === true ? [label, ''] : splitAt(label, cover)
    const button: TextCell = { button: { key, label: head.trimEnd() === '' ? label : head, ...(primary === true ? { primary } : {}), ...(dimColor === true ? { dimColor } : {}), onPress: () => onAction(action) } }

    return rest === '' || head.trimEnd() === '' ? [button] : [button, { text: rest, ...(dimColor === true ? { dimColor } : {}) }]
  })

/**
 * The view: a keyed column (`detail`) of one-row Boxes (`detail:<row>`), each
 * its parts in one Text cut to the pane and its Buttons inline, or with
 * `ui.Svg` the row in pixels and its Buttons laid over their cells; a press
 * runs `onAction` with what the Button asks for. `after` (the Agents tab's
 * lists) follows the rows inside the column.
 */
export const renderInspect = (
  ui: HudElements & { Button: ElementConstructor<ButtonProps> },
  rows: readonly InspectRow[],
  onAction: (action: InspectAction) => void,
  after?: RenderElement,
): RenderElement => {
  const { Box, Text, Button, Svg } = ui
  if (Svg !== undefined) {
    return (
      <Box key="detail" flexDirection="column" flexShrink={0}>
        {rows.map(row => renderTextRow({ Box, Svg, Button }, { key: `detail:${row.key}`, cells: textCellsOf(row, onAction) }))}
        {after}
      </Box>
    )
  }
  const texts = (parts: readonly Part[], index: number) => (
    <Text key={`text:${index}`} wrap="truncate-end">
      {parts.map(part => {
        const style = styleOf(part)

        return Object.keys(style).length === 0 ? part.text : <Text {...style}>{part.text}</Text>
      })}
    </Text>
  )

  return (
    <Box key="detail" flexDirection="column" flexShrink={0}>
      {rows.map(row => {
        // Neighbouring parts draw as one Text; a Button stands between them.
        const groups: (Part[] | ButtonCell)[] = []
        for (const cell of row.cells) {
          const last = groups.at(-1)
          if (isButton(cell)) groups.push(cell)
          else if (Array.isArray(last)) last.push(cell)
          else groups.push([cell])
        }

        return (
          <Box key={`detail:${row.key}`} height={1} flexShrink={0}>
            {groups.map((group, index) => {
              if (Array.isArray(group)) return texts(group, index)
              const { key, label, primary, dimColor, action } = group.button

              return <Button key={key} label={label} {...(primary === true ? { variant: 'primary' as const } : { plain: true as const })} {...(dimColor === true ? { dimColor: true } : {})} onPress={() => onAction(action)} />
            })}
          </Box>
        )
      })}
      {after}
    </Box>
  )
}
