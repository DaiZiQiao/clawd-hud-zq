import type { ShadowAgentEntry } from '../types'
import { defined } from './state-json'

// Workflow agents as the pane keeps them (`mod-hud.shadows`): the loops whose
// events carry an `agentId` that no list names. Pure functions of the record
// held and the time; each returns the record it was given when nothing
// changed, so a caller writes only on a change.

export type Shadows = Record<string, ShadowAgentEntry>

/** With no event for this long, an entry is dropped. */
export const SHADOW_IDLE_MS = 10 * 60_000
/** A call without an end event cannot keep a workflow entry forever. */
export const SHADOW_CALL_MS = 60 * 60_000
/** A finished entry stays this long after it ended (its mascot's farewell is over by then). */
export const SHADOW_LINGER_MS = 30_000
/** The most entries held: the oldest finished go first. */
export const MAX_SHADOWS = 64

/** Shown once it called a tool or made a second request: a one-step fork never shows. */
export const isShadowVisible = (entry: ShadowAgentEntry): boolean => entry.toolCalls > 0 || entry.steps >= 2

/** Active calls get up to an hour without an event; otherwise ten minutes, or thirty seconds after ending. */
export const isShadowLive = (entry: ShadowAgentEntry, now: number): boolean =>
  now - entry.lastSeen < (entry.status === 'running' && entry.currentTool !== undefined ? SHADOW_CALL_MS : SHADOW_IDLE_MS) && (entry.status === 'running' || now - (entry.endedAt ?? entry.lastSeen) < SHADOW_LINGER_MS)

/** The entries the pane, the summary and the scene show at `now`. */
export const shownShadows = (record: Readonly<Shadows> | undefined, now: number): ShadowAgentEntry[] =>
  Object.values(record ?? {}).filter(entry => isShadowVisible(entry) && isShadowLive(entry, now))

export type ShadowCounts = { running: number; done: number; failed: number; stalled: number }

export const shadowCounts = (list: readonly ShadowAgentEntry[], now: number, stalledMs: number): ShadowCounts => ({
  running: list.filter(one => one.status === 'running').length,
  done: list.filter(one => one.status === 'done').length,
  failed: list.filter(one => one.status === 'failed').length,
  stalled: list.filter(one => one.status === 'running' && now - one.lastSeen > stalledMs).length,
})

const without = (record: Shadows, drop: (entry: ShadowAgentEntry) => boolean): Shadows => {
  const kept = Object.entries(record).filter(([, entry]) => !drop(entry))

  return kept.length === Object.keys(record).length ? record : Object.fromEntries(kept)
}

// Over the cap: finished first (oldest end first), then the never-shown, then
// the oldest heard from; never `keep`, the entry being written.
const capped = (record: Shadows, keep?: string): Shadows => {
  const excess = Object.keys(record).length - MAX_SHADOWS
  if (excess <= 0) return record
  const rank = (entry: ShadowAgentEntry): number => (entry.status !== 'running' ? 0 : isShadowVisible(entry) ? 2 : 1)
  const age = (entry: ShadowAgentEntry): number => (entry.status !== 'running' ? (entry.endedAt ?? entry.lastSeen) : entry.lastSeen)
  const dropped = new Set(Object.values(record)
    .filter(entry => entry.id !== keep)
    .sort((a, b) => rank(a) - rank(b) || age(a) - age(b) || a.id.localeCompare(b.id))
    .slice(0, excess)
    .map(entry => entry.id))

  return without(record, entry => dropped.has(entry.id))
}

/** Expired entries and those `isListed` names (now on the board or in a list) dropped, then the cap. */
export const shadowsPruned = (record: Shadows, now: number, isListed: (id: string) => boolean = () => false, keep?: string): Shadows =>
  capped(without(record, entry => entry.id !== keep && (!isShadowLive(entry, now) || isListed(entry.id))), keep)

const fresh = (id: string, now: number): ShadowAgentEntry => ({ id, firstSeen: now, lastSeen: now, steps: 0, toolCalls: 0, status: 'running' })

// An event from the loop: heard from now, and running again if it had ended.
const heard = (entry: ShadowAgentEntry, now: number): ShadowAgentEntry =>
  ({ ...entry, lastSeen: now, status: 'running', endedAt: undefined, reason: undefined })

const put = (record: Shadows, entry: ShadowAgentEntry, now: number): Shadows =>
  shadowsPruned({ ...record, [entry.id]: defined({ ...entry, ...(entry.visibleAt === undefined && isShadowVisible(entry) ? { visibleAt: now } : {}) }) }, now, undefined, entry.id)

/** A `turn.step` of the loop: one more request, on this model and effort. */
export const shadowStepped = (record: Shadows, id: string, step: { model?: string; effort?: string }, now: number): Shadows => {
  const entry = record[id] ?? fresh(id, now)

  return put(record, { ...heard(entry, now), steps: entry.steps + 1, model: step.model ?? entry.model, effort: step.effort }, now)
}

/** The tools of a reading streak (the mascot scene's): a run of only these calls. */
export const READ_TOOLS: ReadonlySet<string> = new Set(['Read', 'Grep', 'Glob'])

/** When a reading streak began, after a call of `tool`: kept through reads, begun by the first, ended by any other. */
export const readingAfter = (since: number | undefined, tool: string, now: number): number | undefined =>
  READ_TOOLS.has(tool) ? (since ?? now) : undefined

/** A `tool.call` of the loop starting: one more call, its tool current, and its reading streak. */
export const shadowCallStarted = (record: Shadows, id: string, tool: string, now: number): Shadows => {
  const entry = record[id] ?? fresh(id, now)

  return put(record, { ...heard(entry, now), toolCalls: entry.toolCalls + 1, currentTool: tool, lastTool: tool, readingSince: readingAfter(entry.readingSince, tool, now) }, now)
}

/** That call ending: its tool no longer current. Nothing for an id not held. */
export const shadowCallEnded = (record: Shadows, id: string, tool: string, now: number): Shadows => {
  const entry = record[id]
  if (entry === undefined) return record

  return put(record, { ...entry, lastSeen: now, currentTool: entry.currentTool === tool ? undefined : entry.currentTool }, now)
}

/**
 * The loop's `turn.complete`: `answer` is done, any other reason failed. One
 * never shown (a fork's single step) is dropped instead; nothing for an id not held.
 */
export const shadowEnded = (record: Shadows, id: string, reason: string, now: number): Shadows => {
  const entry = record[id]
  if (entry === undefined) return record
  if (!isShadowVisible(entry)) return without(record, one => one.id === id)

  return put(record, {
    ...entry,
    lastSeen: now,
    status: reason === 'answer' ? 'done' : 'failed',
    endedAt: now,
    reason,
    currentTool: undefined,
  }, now)
}

/** `wf-` and the id's last four characters: a workflow agent has no other name. */
export const shadowName = (entry: Pick<ShadowAgentEntry, 'id'>): string => `wf-${entry.id.slice(-4)}`

/** What it is doing now, or how it ended, and its last tool. */
export const shadowDetail = (entry: ShadowAgentEntry): string => {
  const last = entry.lastTool === undefined ? '' : ` · last ${entry.lastTool}`
  if (entry.status === 'running') return entry.currentTool ?? `thinking${last}`

  return `${entry.reason ?? entry.status}${last}`
}
