import type { AgentInfo } from 'claude-code'

import type { AgentBoardEntry, AgentBoardOutcome, ShadowAgentEntry } from '../types'
import { shadowCounts, shownShadows } from './agent-shadows'
import type { Shadows } from './agent-shadows'
import { defined } from './state-json'
import { pad2, printable } from './text-width'

// The board's agents and the workflow agents as the lists, the status line
// and the inspect view read them: pure helpers with no `$`. What
// `$.agent.list()` says merged into the board, each agent's status, glyph,
// elapsed time, order and depth under its parent.

// The theme's accent, as the HUD draws it: one accent across the pane.
export const ACCENT = 'claude'
export const WARN = 'warning'
export const GOOD = 'success'
export const HOT = 'error'

const MAX_DEPTH = 3

export type Agents = Record<string, AgentBoardEntry>

export const humanize = (ms: number): string => {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${pad2(seconds % 60)}s`

  return `${Math.floor(minutes / 60)}h${pad2(minutes % 60)}m`
}

export const isRunning = (entry: AgentBoardEntry): boolean => entry.status === 'running'

export const isStalled = (entry: AgentBoardEntry, now: number, stalledMs: number): boolean =>
  isRunning(entry) && now - entry.lastActivityAt > stalledMs

export const elapsedOf = (entry: AgentBoardEntry, now: number): string =>
  entry.startedAt === 0 ? '?' : humanize((entry.endedAt ?? now) - entry.startedAt)

// The board's counts, then the workflow agents' (those shown), e.g.
// `agents · 1 running · 0 done · workflow 3 running, 1 done`.
export const summarize = (list: readonly AgentBoardEntry[], workflow: readonly ShadowAgentEntry[], now: number, stalledMs: number): string | undefined => {
  if (list.length === 0 && workflow.length === 0) return undefined
  const running = list.filter(isRunning).length
  const failed = list.filter(one => one.status === 'failed').length
  const done = list.filter(one => one.status === 'done').length
  const stalled = list.filter(one => isStalled(one, now, stalledMs)).length
  const flow = shadowCounts(workflow, now, stalledMs)
  const flowText = workflow.length === 0
    ? ''
    : ` · workflow ${flow.running} running${flow.done > 0 ? `, ${flow.done} done` : ''}${flow.failed > 0 ? `, ${flow.failed} failed` : ''}`

  return `agents · ${running} running · ${done} done${failed > 0 ? ` · ${failed} failed` : ''}${stalled > 0 ? ` · ${stalled} stalled` : ''}${flowText}`
}

// The workflow agents the pane shows at `now`: none on the board.
export const workflowOf = (record: Readonly<Shadows> | undefined, all: Agents, now: number): ShadowAgentEntry[] =>
  shownShadows(record, now).filter(entry => all[entry.id] === undefined)

// The statuses of a loop that has not ended: not started, in a turn, held,
// or between turns until a message wakes it (`AgentStatus`).
const LIVE: ReadonlySet<string> = new Set(['pending', 'running', 'waiting', 'idle'])

// What `$.agent.list()` says a settled agent's status means here; any status
// it may add later that is not live counts as ended.
const settledAs = (status: string): { status: 'done' | 'failed'; outcome: AgentBoardOutcome } | undefined => {
  if (LIVE.has(status)) return undefined

  return status === 'completed' ? { status: 'done', outcome: 'answer' } : { status: 'failed', outcome: status }
}

// Only the initial seed includes unknown settled agents. Later lists settle
// known runs and discover new running agents, never dismissed ids.
export const merge = (all: Agents, listed: readonly AgentInfo[], now: number, initial: boolean, hidden: readonly string[]): Agents => {
  let next = all
  for (const info of listed) {
    const entry = all[info.id]
    const settled = settledAs(info.status)
    if (entry === undefined) {
      if (hidden.includes(info.id) || (!initial && settled !== undefined)) continue
      next = {
        ...next,
        [info.id]: defined<AgentBoardEntry>({
          id: info.id,
          parentId: info.parentId,
          type: printable(info.type),
          description: printable(info.description),
          name: info.name === undefined ? undefined : printable(info.name),
          background: false,
          startedAt: 0,
          endedAt: settled === undefined ? undefined : now,
          lastActivityAt: now,
          status: settled?.status ?? 'running',
          outcome: settled?.outcome,
          toolCalls: 0,
        }),
      }
    } else if (isRunning(entry) && settled !== undefined) {
      next = {
        ...next,
        [info.id]: defined<AgentBoardEntry>({
          ...entry,
          status: settled.status,
          outcome: entry.outcome ?? settled.outcome,
          endedAt: entry.endedAt ?? now,
          currentTool: undefined,
        }),
      }
    }
  }

  return next
}

export const orderOf = (list: readonly AgentBoardEntry[]): AgentBoardEntry[] => {
  const rank = (entry: AgentBoardEntry): number => (isRunning(entry) ? 0 : 1)
  const recent = (entry: AgentBoardEntry): number => (isRunning(entry) ? entry.startedAt : (entry.endedAt ?? entry.startedAt))

  return [...list].sort((a, b) => rank(a) - rank(b) || recent(b) - recent(a) || a.id.localeCompare(b.id))
}

export const depthOf = (entry: AgentBoardEntry, all: Agents): number => {
  const seen = new Set<string>([entry.id])
  let current = entry
  let depth = 0
  while (current.parentId !== undefined && depth < MAX_DEPTH) {
    const parent = all[current.parentId]
    if (parent === undefined || seen.has(parent.id)) break
    seen.add(parent.id)
    current = parent
    depth += 1
  }

  return depth
}

const statusLook = (status: AgentBoardEntry['status'], stalled: boolean): { glyph: string; color: string } => {
  if (status === 'done') return { glyph: '✓', color: GOOD }
  if (status === 'failed') return { glyph: '✗', color: HOT }

  return stalled ? { glyph: '◌', color: WARN } : { glyph: '●', color: ACCENT }
}

export const lookOf = (entry: AgentBoardEntry, now: number, stalledMs: number): { glyph: string; color: string } =>
  statusLook(entry.status, isStalled(entry, now, stalledMs))

// A workflow agent quiet as long as a stalled subagent is drawn the same way.
export const shadowLookOf = (entry: ShadowAgentEntry, now: number, stalledMs: number): { glyph: string; color: string } =>
  statusLook(entry.status, entry.status === 'running' && now - entry.lastSeen > stalledMs)

// Workflow agents as the list orders them: running first, the newest first, as the board.
export const workflowOrderOf = (list: readonly ShadowAgentEntry[]): ShadowAgentEntry[] => {
  const rank = (entry: ShadowAgentEntry): number => (entry.status === 'running' ? 0 : 1)
  const recent = (entry: ShadowAgentEntry): number => (entry.status === 'running' ? entry.firstSeen : (entry.endedAt ?? entry.firstSeen))

  return [...list].sort((a, b) => rank(a) - rank(b) || recent(b) - recent(a) || a.id.localeCompare(b.id))
}

export const titleOf = (entry: AgentBoardEntry): string => printable(entry.description) || printable(entry.name) || '(no description)'
