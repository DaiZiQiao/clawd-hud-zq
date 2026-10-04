import type { ButtonProps, ElementConstructor, RenderElement } from 'claude-code'

import type { AgentBoardEntry, HudListView, HudSelection, ShadowAgentEntry } from '../types'
import { ACCENT, GOOD, HOT, WARN, depthOf, elapsedOf, humanize, isRunning, lookOf, orderOf, shadowLookOf, summarize, titleOf, workflowOrderOf } from './agent-model'
import type { Agents } from './agent-model'
import { shadowCounts, shadowDetail, shadowName } from './agent-shadows'
import { shortModel } from './facts'
import type { HudElements } from './hud'
import type { Settings } from './hud-options'
import { colourFor } from './scene-model'
import { clipped, fitted, renderTextRow } from './text-svg'
import type { TextCell, TextStyle, TextSvgElements } from './text-svg'

// The lists under the HUD: the session's row, the Agents group (the board's
// subagents, indented under their parents) and the Workflow group, each its
// running agents whole and its three most recent finished. One plan of what
// is listed, drawn as Box/Text rows on the terminal or as rows in pixels
// (hooks/text-svg.ts) on the desktop. register.tsx maps a row's presses back
// to the atoms. Layout: docs/pane-sketch.md.

const INDENT = 2

// The wide row: glyph, then "type model elapsed calls" in fixed cells, then the
// rest of the line for the detail.
const GLYPH_WIDTH = 2
const TYPE_WIDTH = 16
const MODEL_WIDTH = 11
const ELAPSED_WIDTH = 6
// `1234 calls`: four digits, then one blank cell before the detail.
const CALLS_WIDTH = 10
const STATS_WIDTH = TYPE_WIDTH + MODEL_WIDTH + ELAPSED_WIDTH + CALLS_WIDTH + 4
// The one-cell inspect Button that starts every agent row, with inspect on.
const INSPECT_WIDTH = 1
const INSPECT_LABEL = '▸'
// A group lists its running agents whole and only this many of its finished ones, until expanded.
const FINISHED_SHOWN = 3

// A header's counts in colour: running green, done red, failed red, stalled
// amber; the rest of the header as it was, bold.
const COUNT_COLOURS: Readonly<Record<string, string>> = { running: GOOD, done: HOT, failed: HOT, stalled: WARN }

const countParts = (text: string): { text: string; color?: string }[] =>
  text.split(/(\d+ (?:running|done|failed|stalled))/).filter(part => part !== '').map(part => {
    const kind = /^\d+ (running|done|failed|stalled)$/.exec(part)?.[1]

    return kind === undefined ? { text: part } : { text: part, color: COUNT_COLOURS[kind] }
  })

const cell = (text: string, width: number): string =>
  text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width)

const workflowHeaderOf = (list: readonly ShadowAgentEntry[], now: number, stalledMs: number): string => {
  const { running, done, failed, stalled } = shadowCounts(list, now, stalledMs)

  return `Workflow · ${running} running · ${done} done${failed > 0 ? ` · ${failed} failed` : ''}${stalled > 0 ? ` · ${stalled} stalled` : ''}`
}

// A wide row's fixed cells after the name: model, elapsed time, calls.
const statsOf = (model: string | undefined, elapsed: string, calls: number): string => [
  cell(model ?? '-', MODEL_WIDTH),
  elapsed.padStart(ELAPSED_WIDTH),
  `${calls} call${calls === 1 ? '' : 's'}`.padEnd(CALLS_WIDTH),
].join(' ')

const capitalize = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

type Elements = HudElements & { Button: ElementConstructor<ButtonProps> }

/** What the lists are drawn from, and what their presses do. */
type ListsInput = {
  ui: Elements
  settings: Settings
  all: Agents
  list: readonly AgentBoardEntry[]
  workflow: readonly ShadowAgentEntry[]
  now: number
  columns: number
  isNarrow: boolean
  view: HudListView
  choice: HudSelection | null
  onSelect: (id: string, kind: HudSelection['kind']) => void
  onToggle: (group: 'agents' | 'workflow') => void
  onMinimise: (group: 'agents' | 'workflow') => void
}

// A group's rows in order: the running whole, then its three most recent
// finished (every one, expanded); how many finished it has and keeps back.
const grouped = <T,>(ordered: readonly T[], isLive: (one: T) => boolean, expanded: boolean): { rows: T[]; finished: number; hidden: number } => {
  const live = ordered.filter(isLive)
  const finished = ordered.filter(one => !isLive(one))
  const listed = expanded ? finished : finished.slice(0, FINISHED_SHOWN)

  return { rows: [...live, ...listed], finished: finished.length, hidden: finished.length - listed.length }
}

// A group's header starts with a Button: `▾` minimises the group to its header, `▸` opens it again; two cells with the blank after it.
const GROUP_MINIMISE = '▾'
const GROUP_OPEN = '▸'
const GROUP_WIDTH = 2

const moreLabel = (hidden: number): string => (hidden > 0 ? `▸ ${hidden} more` : '▾ collapse')

/** What a subagent's row says: its stats and detail wide; narrow, its model and time, and its last line. */
const agentWords = (entry: AgentBoardEntry, now: number) => {
  const running = isRunning(entry)
  const model = shortModel(entry.model)
  const elapsed = elapsedOf(entry, now)

  return {
    running,
    stats: statsOf(model, elapsed, entry.toolCalls),
    detail: running ? `${entry.currentTool ?? 'thinking'}  ${titleOf(entry)}` : `${titleOf(entry)} — ${entry.summary ?? entry.outcome ?? ''}`,
    rest: [model, elapsed].filter(part => part !== undefined && part !== '').join(' · '),
    last: running ? `${entry.toolCalls}c · ${entry.currentTool ?? 'thinking'}` : (entry.summary ?? entry.outcome ?? ''),
  }
}

/** What a workflow agent's row says: its name, stats and detail; narrow, its model and time. */
const shadowWords = (entry: ShadowAgentEntry, now: number) => {
  const model = shortModel(entry.model)
  const elapsed = humanize((entry.endedAt ?? now) - entry.firstSeen)

  return {
    name: shadowName(entry),
    stats: statsOf(model, elapsed, entry.toolCalls),
    detail: shadowDetail(entry),
    rest: [model, elapsed].filter(part => part !== undefined && part !== '').join(' · '),
  }
}

type Grouped<T> = { rows: T[]; finished: number; hidden: number }

/** What `renderLists` decided to list, for the rows in pixels. */
type ListPlan = {
  minimised: Record<'agents' | 'workflow', boolean>
  board: Grouped<AgentBoardEntry>
  shown: readonly AgentBoardEntry[]
  flow: Grouped<ShadowAgentEntry>
  flowShown: readonly ShadowAgentEntry[]
  overflow: number
  header: string
  flowHeader: string
  isEmpty: boolean
}

/**
 * The lists in pixels, row for row as the terminal draws them (hooks/text-svg.ts):
 * the same cells, colours and keys, each Button laid over its own cells.
 */
const listTextRows = (input: ListsInput, ui: TextSvgElements & { Button: ElementConstructor<ButtonProps> }, plan: ListPlan): RenderElement[] => {
  const { settings, all, now, columns, isNarrow, choice } = input
  const lead = settings.inspect ? INSPECT_WIDTH : 0
  const draw = (key: string, cells: readonly TextCell[]): RenderElement => renderTextRow(ui, { key, cells: clipped(cells, columns) })
  const struck = (finished: boolean): TextStyle => (finished ? { dimColor: true, strikethrough: true } : {})
  const nameColour = (id: string, color: string): string => (settings.mascots ? colourFor(id) : color)
  const inspectCells = (id: string, kind: HudSelection['kind']): TextCell[] =>
    settings.inspect ? [{ button: { key: `inspect:${id}`, label: INSPECT_LABEL, dimColor: choice?.id !== id, onPress: () => input.onSelect(id, kind) } }] : []
  const glyphCells = (id: string, kind: HudSelection['kind'], glyph: string, color: string): TextCell[] => [...inspectCells(id, kind), ...fitted([{ text: glyph, color }], GLYPH_WIDTH)]
  const headerRow = (group: 'agents' | 'workflow', text: string): RenderElement => draw(`header:${group}`, [
    { button: { key: `group:${group}`, label: plan.minimised[group] ? GROUP_OPEN : GROUP_MINIMISE, dimColor: true, onPress: () => input.onMinimise(group) } },
    { text: ' '.repeat(GROUP_WIDTH - 1) },
    ...countParts(text).map(part => ({ text: part.text, bold: true, ...(part.color === undefined ? {} : { color: part.color }) })),
  ])
  const toggleRow = (group: 'agents' | 'workflow', finished: number, hidden: number): RenderElement[] =>
    !plan.minimised[group] && finished > FINISHED_SHOWN
      ? [draw(`toggle:${group}`, [{ text: ' '.repeat(lead + GLYPH_WIDTH) }, { button: { key: `more:${group}`, label: moreLabel(hidden), dimColor: true, onPress: () => input.onToggle(group) } }])]
      : []

  const agentRows = plan.shown.map(entry => {
    const { glyph, color } = lookOf(entry, now, settings.stalledMs)
    const indent = depthOf(entry, all) * INDENT
    const words = agentWords(entry, now)
    const finished = !words.running
    const pad: TextCell = { text: ' '.repeat(indent) }
    if (isNarrow) {
      return ui.Box({
        key: `agent:${entry.id}`,
        flexDirection: 'column',
        children: [
          draw(`line:${entry.id}:0`, [
            pad,
            ...inspectCells(entry.id, 'agent'),
            { text: `${glyph} `, color },
            entry.type === '' ? { text: words.rest, color, ...struck(finished) } : { text: entry.type, color: nameColour(entry.id, color) },
            ...(entry.type !== '' && words.rest !== '' ? [{ text: ` · ${words.rest}`, color, ...struck(finished) }] : []),
          ]),
          draw(`line:${entry.id}:1`, [pad, { text: `  ${titleOf(entry)}`, dimColor: true, ...struck(finished) }]),
          draw(`line:${entry.id}:2`, [pad, { text: `  ${words.last}`, dimColor: true, ...struck(finished) }]),
        ],
      })
    }

    return draw(`agent:${entry.id}`, [
      pad,
      ...glyphCells(entry.id, 'agent', glyph, color),
      ...fitted([{ text: cell(entry.type, TYPE_WIDTH), color: nameColour(entry.id, color) }, { text: ` ${words.stats}`, color, ...struck(finished) }], STATS_WIDTH),
      ...fitted([{ text: words.detail, dimColor: true, ...struck(finished) }], Math.max(1, columns - indent - lead - GLYPH_WIDTH - STATS_WIDTH - 1)),
    ])
  })

  const flowRows = plan.flowShown.map(entry => {
    const { glyph, color } = shadowLookOf(entry, now, settings.stalledMs)
    const words = shadowWords(entry, now)
    const finished = entry.status !== 'running'
    if (isNarrow) {
      return ui.Box({
        key: `workflow:${entry.id}`,
        flexDirection: 'column',
        children: [
          draw(`line:${entry.id}:0`, [
            ...inspectCells(entry.id, 'shadow'),
            { text: `${glyph} `, color },
            { text: words.name, color: nameColour(entry.id, color) },
            ...(words.rest !== '' ? [{ text: ` · ${words.rest}`, color, ...struck(finished) }] : []),
          ]),
          draw(`line:${entry.id}:1`, [{ text: `  ${entry.toolCalls}c · ${words.detail}`, dimColor: true, ...struck(finished) }]),
        ],
      })
    }

    return draw(`workflow:${entry.id}`, [
      ...glyphCells(entry.id, 'shadow', glyph, color),
      ...fitted([{ text: cell(words.name, TYPE_WIDTH), color: nameColour(entry.id, color) }, { text: ` ${words.stats}`, color, ...struck(finished) }], STATS_WIDTH),
      ...fitted([{ text: words.detail, dimColor: true, ...struck(finished) }], Math.max(1, columns - lead - GLYPH_WIDTH - STATS_WIDTH - 1)),
    ])
  })

  return [
    ...(settings.inspect ? [draw('session', [...glyphCells('main', 'main', '◆', ACCENT), { text: 'Session' }])] : []),
    headerRow('agents', plan.header),
    ...(!plan.minimised.agents && plan.isEmpty ? [draw('none', [{ text: 'No agents yet.', dimColor: true }])] : []),
    ...agentRows,
    ...toggleRow('agents', plan.board.finished, plan.board.hidden),
    ...(input.workflow.length > 0 ? [headerRow('workflow', plan.flowHeader)] : []),
    ...flowRows,
    ...toggleRow('workflow', plan.flow.finished, plan.flow.hidden),
    ...(plan.overflow > 0 ? [draw('overflow', [{ text: `+${plan.overflow} more`, dimColor: true }])] : []),
  ]
}

/**
 * The lists under the HUD (key `agents`): the session's row (with inspect
 * on), the Agents group and the Workflow group, each its running agents whole
 * and its three most recent finished, then `▸ n more` (or `▾ collapse`);
 * `maxRows` caps both groups together, the subagents first, and `+n more`
 * counts what it left out. Each group's header starts with a Button that
 * minimises the group to that line (`▾`) or opens it again (`▸`); a minimised
 * group spends none of `maxRows` and adds nothing to `+n more`. With `ui.Svg`
 * the rows are drawn in pixels. Its rows are counted for the scene's room.
 */
export const renderLists = (input: ListsInput): { element: RenderElement; rows: number } => {
  const { ui: { Box, Text, Button, Svg }, settings, all, list, workflow, now, columns, isNarrow, view, choice } = input
  // A minimised group draws its header alone: none of its rows, and none of `maxRows` spent on them.
  const minimised = { agents: view.agentsMinimised === true, workflow: view.workflowMinimised === true }
  const board = grouped(orderOf(list), isRunning, view.agents === true)
  const shown = minimised.agents ? [] : board.rows.slice(0, settings.maxRows)
  const flow = grouped(workflowOrderOf(workflow), one => one.status === 'running', view.workflow === true)
  const flowShown = minimised.workflow ? [] : flow.rows.slice(0, Math.max(0, settings.maxRows - shown.length))
  const overflow = (minimised.agents ? 0 : board.rows.length - shown.length) + (minimised.workflow ? 0 : flow.rows.length - flowShown.length)
  const header = capitalize(summarize(list, workflow, now, settings.stalledMs) ?? 'Agents')
  const flowHeader = workflowHeaderOf(workflow, now, settings.stalledMs)
  const isEmpty = list.length === 0 && workflow.length === 0
  // With mascots on, an agent's name takes its mascot's colour.
  const named = (id: string, text: string) =>
    settings.mascots ? <Text color={colourFor(id)} wrap="truncate-end">{text}</Text> : text
  // With inspect on, every row starts with a one-cell Button that selects its agent.
  const lead = settings.inspect ? INSPECT_WIDTH : 0
  // A finished agent's row is struck through and dim, its glyph and name excepted.
  const struck = (finished: boolean, text: string) => (finished ? <Text dimColor strikethrough wrap="truncate-end">{text}</Text> : text)
  const strike = (finished: boolean) => (finished ? { strikethrough: true } : {})
  const inspectButton = (id: string, kind: HudSelection['kind']) =>
    settings.inspect
      ? <Button key={`inspect:${id}`} label={INSPECT_LABEL} plain dimColor={choice?.id !== id} onPress={() => input.onSelect(id, kind)} />
      : undefined
  // A group's header starts with a Button that minimises the group to it, or opens it again.
  const groupButton = (group: 'agents' | 'workflow') => (
    <Button key={`group:${group}`} label={minimised[group] ? GROUP_OPEN : GROUP_MINIMISE} plain dimColor onPress={() => input.onMinimise(group)} />
  )
  const rows = (settings.inspect ? 1 : 0) + 1
    + (minimised.agents ? 0 : (isEmpty ? 1 : shown.length * (isNarrow ? 3 : 1)) + (board.finished > FINISHED_SHOWN ? 1 : 0))
    + (workflow.length === 0 ? 0 : 1 + (minimised.workflow ? 0 : flowShown.length * (isNarrow ? 2 : 1) + (flow.finished > FINISHED_SHOWN ? 1 : 0)))
    + (overflow > 0 ? 1 : 0)

  if (Svg !== undefined) {
    const element = (
      <Box key="agents" flexDirection="column">
        {listTextRows(input, { Box, Svg, Button }, { minimised, board, shown, flow, flowShown, overflow, header, flowHeader, isEmpty })}
      </Box>
    )

    return { element, rows }
  }

  // Under a group's rows, at the names' column: its finished agents all listed, or three.
  const toggle = (group: 'agents' | 'workflow', finished: number, hidden: number) =>
    !minimised[group] && finished > FINISHED_SHOWN && (
      <Box key={`toggle:${group}`} paddingLeft={lead + GLYPH_WIDTH}>
        <Button key={`more:${group}`} label={moreLabel(hidden)} plain dimColor onPress={() => input.onToggle(group)} />
      </Box>
    )

  const element = (
    <Box key="agents" flexDirection="column">
      {settings.inspect && (
        <Box key="session">
          <Box width={lead + GLYPH_WIDTH}>
            {inspectButton('main', 'main')}
            <Text color={ACCENT} wrap="truncate-end">
              ◆
            </Text>
          </Box>
          <Text wrap="truncate-end">Session</Text>
        </Box>
      )}
      <Box key="header:agents">
        <Box width={GROUP_WIDTH} flexShrink={0}>
          {groupButton('agents')}
        </Box>
        <Text bold wrap="truncate-end">
          {countParts(header).map(part => (part.color === undefined ? part.text : <Text color={part.color} wrap="truncate-end">{part.text}</Text>))}
        </Text>
      </Box>
      {!minimised.agents && isEmpty && (
        <Text dimColor wrap="truncate-end">
          No agents yet.
        </Text>
      )}
      {shown.map(entry => {
        const { glyph, color } = lookOf(entry, now, settings.stalledMs)
        const indent = depthOf(entry, all) * INDENT
        const words = agentWords(entry, now)
        const running = words.running

        if (isNarrow) {
          return (
            <Box key={`agent:${entry.id}`} flexDirection="column" paddingLeft={indent}>
              <Box>
                {inspectButton(entry.id, 'agent')}
                <Text color={color} wrap="truncate-end">
                  {`${glyph} `}
                  {entry.type === '' ? struck(!running, words.rest) : named(entry.id, entry.type)}
                  {entry.type !== '' && words.rest !== '' && struck(!running, ` · ${words.rest}`)}
                </Text>
              </Box>
              <Text dimColor wrap="truncate-end" {...strike(!running)}>
                {`  ${titleOf(entry)}`}
              </Text>
              <Text dimColor wrap="truncate-end" {...strike(!running)}>
                {`  ${words.last}`}
              </Text>
            </Box>
          )
        }

        return (
          <Box key={`agent:${entry.id}`} paddingLeft={indent}>
            <Box width={lead + GLYPH_WIDTH}>
              {inspectButton(entry.id, 'agent')}
              <Text color={color} wrap="truncate-end">
                {glyph}
              </Text>
            </Box>
            <Box width={STATS_WIDTH}>
              <Text color={color} wrap="truncate-end">
                {named(entry.id, cell(entry.type, TYPE_WIDTH))}
                {struck(!running, ` ${words.stats}`)}
              </Text>
            </Box>
            <Box width={Math.max(1, columns - indent - lead - GLYPH_WIDTH - STATS_WIDTH - 1)}>
              <Text dimColor wrap="truncate-end" {...strike(!running)}>
                {words.detail}
              </Text>
            </Box>
          </Box>
        )
      })}
      {toggle('agents', board.finished, board.hidden)}
      {workflow.length > 0 && (
        <Box key="header:workflow">
          <Box width={GROUP_WIDTH} flexShrink={0}>
            {groupButton('workflow')}
          </Box>
          <Text key="workflow" bold wrap="truncate-end">
            {countParts(flowHeader).map(part => (part.color === undefined ? part.text : <Text color={part.color} wrap="truncate-end">{part.text}</Text>))}
          </Text>
        </Box>
      )}
      {flowShown.map(entry => {
        const { glyph, color } = shadowLookOf(entry, now, settings.stalledMs)
        const words = shadowWords(entry, now)
        const running = entry.status === 'running'

        // Narrow, two lines: there is no task description to give a line to.
        if (isNarrow) {
          return (
            <Box key={`workflow:${entry.id}`} flexDirection="column">
              <Box>
                {inspectButton(entry.id, 'shadow')}
                <Text color={color} wrap="truncate-end">
                  {`${glyph} `}
                  {named(entry.id, words.name)}
                  {words.rest !== '' && struck(!running, ` · ${words.rest}`)}
                </Text>
              </Box>
              <Text dimColor wrap="truncate-end" {...strike(!running)}>
                {`  ${entry.toolCalls}c · ${words.detail}`}
              </Text>
            </Box>
          )
        }

        return (
          <Box key={`workflow:${entry.id}`}>
            <Box width={lead + GLYPH_WIDTH}>
              {inspectButton(entry.id, 'shadow')}
              <Text color={color} wrap="truncate-end">
                {glyph}
              </Text>
            </Box>
            <Box width={STATS_WIDTH}>
              <Text color={color} wrap="truncate-end">
                {named(entry.id, cell(words.name, TYPE_WIDTH))}
                {struck(!running, ` ${words.stats}`)}
              </Text>
            </Box>
            <Box width={Math.max(1, columns - lead - GLYPH_WIDTH - STATS_WIDTH - 1)}>
              <Text dimColor wrap="truncate-end" {...strike(!running)}>
                {words.detail}
              </Text>
            </Box>
          </Box>
        )
      })}
      {toggle('workflow', flow.finished, flow.hidden)}
      {overflow > 0 && (
        <Text dimColor wrap="truncate-end">
          {`+${overflow} more`}
        </Text>
      )}
    </Box>
  )

  return { element, rows }
}
