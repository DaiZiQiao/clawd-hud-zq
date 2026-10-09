import { atom, read, update } from 'claude-code'
import type { BuiltinToolResults, EngineInterface, ImageProps, JsonValue, ProcessRunResult, Register, RenderElement, Timer, ToolCallResult } from 'claude-code'

import type {
  AgentBoardEntry,
  HudAlerts,
  HudData,
  HudDetailFacts,
  HudGitFacts,
  HudLedger,
  HudListView,
  HudMainFacts,
  HudSelection,
  HudSessionFacts,
  HudTab,
  HudTidied,
  HudTidyFacts,
  HudTodoFacts,
  HudToolFacts,
  HudTrailStep,
  HudUsageFacts,
} from '../types'
import { listRows as listRowsOf, renderLists } from './agent-lists'
import { isRunning, isStalled, merge, summarize, workflowOf } from './agent-model'
import type { Agents } from './agent-model'
import {
  isShadowVisible,
  readingAfter,
  shadowCallEnded,
  shadowCallStarted,
  shadowCounts,
  shadowEnded,
  shadowName,
  shadowStepped,
  shadowsPruned,
  shownShadows,
} from './agent-shadows'
import type { Shadows } from './agent-shadows'
import {
  NO_FACTS,
  addTokens,
  afterClear,
  afterCompaction,
  accountAfter,
  afterMainTurn,
  applyMeasure,
  assembleHudData,
  CACHE_ENV,
  COMPACT_ENV,
  autoCompactOf,
  cacheTtlOf,
  debouncer,
  editedPathOf,
  effortFromSettings,
  effortOf,
  fileEdited,
  gitFactsOf,
  inventoryOf,
  noCurrentTool,
  parseGitStatus,
  parseTodos,
  parseCommitTime,
  parseShortstat,
  providerOf,
  sameFacts,
  seedTurnBaseline,
  throttleDue,
  todoFactsOf,
  toolSettled,
  toolStarted,
} from './facts'
import type { CacheSettings } from './facts'
import { cacheStateOf, renderHudBlock, renderTodos, statusLineText } from './hud'
import { FAILURE_WINDOW_MS, NO_LEDGER, agentShareOf, costTree, ledgerBooked, ledgerEnded, ledgerFailed, ledgerSummary, recentFailures } from './hud-ledger'
import type { LedgerWho } from './hud-ledger'
import { settingsOf } from './hud-options'
import type { Settings } from './hud-options'
import {
  assistantTexts,
  costRows,
  inspectRows,
  mainArgOf,
  overviewRows,
  promptOf,
  renderInspect,
  saidRows,
  tabOf,
  tabsOf,
  taskRows,
  trailAdded,
  trailEnded,
  trailRows,
  trailsPruned,
} from './inspect'
import type { AgentBody, InspectAction, InspectHeader, InspectRow, Trails } from './inspect'
import { inspectedOf, overviewOf } from './inspect-model'
import { STARTLED_MS } from './mascot-poses'
import { GRID_ROWS, SLOT } from './mascot-sprites'
import { IMAGE_FRAME_MS, createStage, hitsOf, refusedTiles, restage, stageHits, stageTick, stageTiles, workAhead } from './scene-image'
import type { HitPost, Stage, Tile } from './scene-image'
import { MOST_STEP_MS } from './scene-world'
import { sceneInputsOf, sceneOf } from './scene-model'
import { MESSAGE_TICKS, SCENE_FRAME_MS } from './scene-phases'
import { mascotPlan } from './scene-plan'
import { renderMascots, renderMascotsSvg } from './scene-render'
import type { MascotPlan, SceneEvent, SceneInputs } from './scene-types'
import { defined } from './state-json'
import { printable } from './text-width'
import { TIDY_COUNTDOWN_MS, TIDY_INSTRUCTIONS, bandLinesOf, bandTidyOf, isTidyDue } from './tidy'
import type { BandTidy, TidyInputs } from './tidy'
import type { Who } from './tv-figure'
import { tvLayoutOf, tvRowsOf } from './tv-model'
import type { TvInputs, TvLayout, TvRow } from './tv-model'
import { budgeted, tvHeadOf, tvRowOfInspect, tvWhoOf } from './tv-rows'
import { SCENE_THEMES, isThemeKey } from './svg-style'
import { casingOf, giantPicture } from './tv-smooth'
import { BLADE_MS, BLINK_EVERY_MS, BLINK_MS, tvPostOf } from './tv-world'

const PANE = 'hud'
const TWIN = 'mod-hud'

// A placed pane ticks each second; reconciliation and a closed pane's status
// refresh every RECONCILE_TICKS.
const TICK_MS = 1000
const RECONCILE_TICKS = 5
// A `session.append` from a subagent writes at most this often.
const ACTIVITY_THROTTLE_MS = 5000
const NARROW_BELOW = 60
const SUMMARY_MAX = 200

const AGENTS = { plugin: 'mod-hud', key: 'agents' } as const
const agents = atom(AGENTS, {})
// Workflow agents, beside the board: `agents` stays the board's alone.
const SHADOWS = { plugin: 'mod-hud', key: 'shadows' } as const
const shadows = atom(SHADOWS, {})
const tick = atom({ plugin: 'mod-hud', key: 'tick' } as const, 0)
const sceneTick = atom({ plugin: 'mod-hud', key: 'sceneTick' } as const, 0)
const dismissed = atom({ plugin: 'mod-hud', key: 'dismissed' } as const, [])
const SEEDED = { plugin: 'mod-hud', key: 'seeded' } as const
const seeded = atom(SEEDED, false)
const STATUS_TEXT = { plugin: 'mod-hud', key: 'statusText' } as const

// The HUD's facts, each its own value so a write redraws only what reads it.
const hudSession = atom({ plugin: 'mod-hud', key: 'session' } as const, NO_FACTS.session)
const hudUsage = atom({ plugin: 'mod-hud', key: 'usage' } as const, NO_FACTS.usage)
const hudGit = atom({ plugin: 'mod-hud', key: 'git' } as const, NO_FACTS.git)
const hudTools = atom({ plugin: 'mod-hud', key: 'tools' } as const, NO_FACTS.tools)
const hudTodos = atom({ plugin: 'mod-hud', key: 'todos' } as const, NO_FACTS.todos)
const hudInventory = atom({ plugin: 'mod-hud', key: 'inventory' } as const, NO_FACTS.inventory)
// The main loop's activity (busy and idle whatever the options; its compactions with mascots on); /clear also drops stale facts.
const NO_MAIN: HudMainFacts = {}
const mainFacts = atom({ plugin: 'mod-hud', key: 'main' } as const, NO_MAIN)
// Click to inspect: the selection (on a press or when its agent goes), the selected
// subagent's last answer (on selection and its turn ends), and the trails.
const SELECTED = { plugin: 'mod-hud', key: 'selected' } as const
const selected = atom(SELECTED, null)
const DETAIL = { plugin: 'mod-hud', key: 'detail' } as const
const detail = atom(DETAIL, null)
const TRAILS = { plugin: 'mod-hud', key: 'trails' } as const
const trails = atom(TRAILS, {})
// Which lists show every finished agent and which Cost-tree models are open: written on a press only.
const LIST_VIEW = { plugin: 'mod-hud', key: 'listView' } as const
const listView = atom(LIST_VIEW, {})
// What each loop spent, by model: one write per request, per agent turn end and per failed call.
const LEDGER = { plugin: 'mod-hud', key: 'ledger' } as const
const ledger = atom(LEDGER, NO_LEDGER)
// Tidying up (hooks/tidy.ts): a compaction running and the last that stood, Not now, the auto countdown
// and a failed ask, written as a compaction starts and ends, on a press and on a main turn's end; the
// band's clock, only while the band draws a tidy running, counting down or its result.
const NO_TIDY: HudTidyFacts = {}
const tidyFacts = atom({ plugin: 'mod-hud', key: 'tidy' } as const, NO_TIDY)
const bandTick = atom({ plugin: 'mod-hud', key: 'bandTick' } as const, 0)

// `git status` runs from its own timer, never the tick: at most once per
// GIT_DEBOUNCE_MS, after a tool that may have changed the tree or a main turn.
const GIT_DEBOUNCE_MS = 3000
const GIT_TIMEOUT_MS = 3000
const GIT_BACKOFF_MS = 30_000
const GIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'])
// The `summary` breakdown the inventory comes from, at most this often.
const INVENTORY_EVERY_MS = 5 * 60_000

const short = (tool: string): string => {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)

  return mcp === null ? tool : `${mcp[1]}:${mcp[2]}`
}

const firstLine = (text: string): string | undefined => {
  const line = text
    .split('\n')
    .map(one => printable(one))
    .find(one => one !== '')
  if (line === undefined) return undefined

  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1)}…` : line
}

// The status line, when switched on: the HUD's line, then the agents' summary.
// A HUD that cannot be read leaves the summary alone. The summary counts the
// stalled agents itself, so the HUD's `⚠ n` then leaves that alert out. With
// it, how long the prompt cache stays warm and how long until the oldest
// failure the `⚠` counts leaves its window, for the status line's own timer.
type StatusShown = { text: string | null; cacheLeftMs?: number; failureLeftMs?: number }
const statusOf = async ($: EngineInterface, settings: Settings, all: Agents, now: number): Promise<StatusShown> => {
  if (!settings.statusLine) return { text: null }
  const data = await attempt(() => hudDataOf($, settings, now))
  const held = settings.showWorkflows ? await attempt(() => read($, shadows)) : undefined
  const summary = summarize(Object.values(all), workflowOf(held, all, now), now, settings.stalledMs) ?? ''
  const skip = /\d+ stalled/.test(summary) ? ['stalled'] : []
  const parts = [data === undefined ? '' : statusLineText(data, skip), summary].filter(part => part !== '')
  const cache = data === undefined ? undefined : cacheStateOf(data)
  const failureLeftMs = settings.inspect ? await attempt(async () => failureLeftOf(await read($, ledger), now)) : undefined

  return { text: parts.length === 0 ? null : parts.join(' │ '), cacheLeftMs: cache?.leftMs, failureLeftMs }
}

// How long until the oldest failure still counted leaves the alert's window
// (`recentFailures` keeps one for FAILURE_WINDOW_MS, to the millisecond, then
// drops it); undefined with none counted.
const failureLeftOf = (held: HudLedger, now: number): number | undefined => {
  const recent = recentFailures(held.failures?.recent, now)

  return recent.length === 0 ? undefined : Math.min(...recent) + FAILURE_WINDOW_MS + 1 - now
}

const statusTextOf = async ($: EngineInterface, settings: Settings, all: Agents, now: number): Promise<string | null> =>
  (await statusOf($, settings, all, now)).text

// The status line's own timer: while the prompt cache is warm, its countdown
// is redrawn each minute and once more as it goes cold, and while the `⚠`
// counts a failed call, once more as the oldest one leaves its window, even
// with the pane closed and nothing running (when the tick is stopped). One
// timer at a time, due at the earlier of the two, re-armed by each redraw;
// none once the cache is cold and no failure is counted, or the line is off.
let statusTimer: Timer | undefined
let statusDueAt: number | undefined
const STATUS_CACHE_EVERY_MS = 60_000

const stopStatusTimer = (): void => {
  statusTimer?.cancel()
  statusTimer = undefined
  statusDueAt = undefined
}

const armStatusTimer = ($: EngineInterface, settings: Settings, now: number, leftMs: number | undefined, failureLeftMs?: number): void => {
  // The countdown reads in whole minutes (rounded up) until its last one, in
  // seconds then: the next redraw is where the minute shown changes, else at the cold mark.
  const cacheWait = leftMs === undefined || leftMs <= 0
    ? undefined
    : leftMs <= STATUS_CACHE_EVERY_MS ? leftMs : leftMs % STATUS_CACHE_EVERY_MS || STATUS_CACHE_EVERY_MS
  const waits = [cacheWait, failureLeftMs].filter((one): one is number => one !== undefined && one > 0)
  if (!settings.statusLine || waits.length === 0) return stopStatusTimer()
  const wait = Math.min(...waits)
  const dueAt = now + wait
  if (statusTimer !== undefined && statusDueAt === dueAt) return
  stopStatusTimer()
  const mine = $.clock.after(wait, () => {
    if (statusTimer !== mine) return
    statusTimer = undefined
    statusDueAt = undefined
    void quietly($, () => refreshStatus($, settings))
  })
  statusTimer = mine
  statusDueAt = dueAt
}

const showStatus = async ($: EngineInterface, settings: Settings, all: Agents, now: number, mine?: Timer): Promise<void> => {
  const { text, cacheLeftMs, failureLeftMs } = await statusOf($, settings, all, now)
  if (mine === undefined || timer === mine) armStatusTimer($, settings, now, cacheLeftMs, failureLeftMs)
  const held = await $.state.get(STATUS_TEXT)
  if ((held.value ?? null) === text || (mine !== undefined && timer !== mine)) return
  const written = await $.state.set(STATUS_TEXT, text, { ifVersion: held.version })
  if (written.isSet && (mine === undefined || timer === mine)) $.ui.status(text ?? undefined)
}

const patch = (
  $: EngineInterface,
  id: string,
  change: (entry: AgentBoardEntry) => AgentBoardEntry,
): Promise<Agents> =>
  update($, agents, all => {
    const entry = all[id]

    return entry === undefined ? all : { ...all, [id]: defined(change(entry)) }
  })

const prune = async ($: EngineInterface, settings: Settings, all: Agents): Promise<Agents> => {
  const finished = Object.values(all).filter(entry => !isRunning(entry))
    .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0) || a.id.localeCompare(b.id))
  const dropped = finished.slice(0, Math.max(0, finished.length - Math.max(settings.maxRows * 2, 20))).map(entry => entry.id)
  if (dropped.length === 0) return all
  await update($, dismissed, ids => [...new Set([...ids, ...dropped])])

  return update($, agents, current => Object.fromEntries(Object.entries(current)
    .filter(([id, entry]) => !dropped.includes(id) || isRunning(entry))))
}

const reconcile = async ($: EngineInterface, settings: Settings, now: number, mine?: Timer): Promise<Agents | undefined> => {
  // Clear advances the seed version even when its value stays true. Keep that
  // reset boundary when retrying a conflicting agents write, including startup.
  const seedAtStart = await $.state.get(SEEDED)
  let held = await $.state.get(AGENTS)
  const listed = await $.agent.list()
  listedIds = new Set(listed.map(info => info.id))
  for (let retry = 0; retry < 2; retry += 1) {
    if (mine !== undefined && timer !== mine) return undefined
    const seedNow = await $.state.get(SEEDED)
    if (seedNow.version !== seedAtStart.version) return read($, agents)
    const initial = seedNow.value !== true
    const hidden = await read($, dismissed)
    if (mine !== undefined && timer !== mine) return undefined
    const before = held.value ?? {}
    const all = merge(before, listed, now, initial, hidden)
    // merge preserves the input object when no entry changed.
    const written = all === before ? undefined : await $.state.set(AGENTS, all, { ifVersion: held.version })
    if (mine !== undefined && timer !== mine) return undefined
    if (written?.isSet === false) {
      if (retry === 0) held = await $.state.get(AGENTS)
      continue
    }
    if (initial) await update($, seeded, () => true)

    return prune($, settings, written === undefined ? await read($, agents) : all)
  }

  return read($, agents)
}

// Bookkeeping never gets to break the session: a failure is a debug line.
const quietly = async ($: EngineInterface, work: () => Promise<void>): Promise<void> => {
  try {
    await work()
  } catch (error) {
    try {
      $.ui.log(String(error), { to: 'debug' })
    } catch {
      // Nothing more to tell.
    }
  }
}

// The timer lives in the module (a hot reload cancels it with the old
// environment and `session.start` starts it again); what it draws from lives in
// `$.state`.
let timer: Timer | undefined
let sceneTimer: Timer | undefined
const scenePlans = new Map<string, MascotPlan>()
const sceneRendered = new Map<string, number>()
// The ids the latest `$.agent.list()` named: a loop it names is no workflow agent.
let listedIds: ReadonlySet<string> = new Set()

const stopSceneClock = (): void => {
  sceneTimer?.cancel()
  sceneTimer = undefined
  scenePlans.clear()
  sceneRendered.clear()
}

// The band's classic scene keeps its plans and its renders under these keys, beside the pane's (by surface).
const BAND_SCENE = 'band:'
const isBandKey = (key: string): boolean => key.startsWith(BAND_SCENE)

// The pane closed: its scenes' plans go, and the clock with them unless the band's classic scene still draws.
const dropPaneScenes = (): void => {
  for (const key of [...sceneRendered.keys(), ...scenePlans.keys()]) {
    if (isBandKey(key)) continue
    sceneRendered.delete(key)
    scenePlans.delete(key)
  }
  if (sceneRendered.size === 0) stopSceneClock()
}

// Only the rendered scene opts into this clock (the pane's, and the band's classic one). It touches no HUD
// facts, reconciliation or git, and the atom redraws only its readers.
const startSceneClock = ($: EngineInterface): void => {
  if (sceneTimer !== undefined) return
  const mine = $.clock.every(SCENE_FRAME_MS, () => {
    void (async () => {
      if (sceneTimer !== mine) return
      const visible = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced && pane.isShown)
      if (sceneTimer !== mine) return
      if (!visible && ![...sceneRendered.keys()].some(isBandKey)) return stopSceneClock()
      const now = await $.clock.now()
      if (sceneTimer !== mine) return
      // A smooth redraw on another surface must not stop this clock. The
      // classic reader keeps it alive through the pane's one-second redraws.
      if (![...sceneRendered.values()].some(at => now - at < 2000)) return stopSceneClock()
      await update($, sceneTick, held => sceneTimer === mine ? Math.floor(now / SCENE_FRAME_MS) : held)
    })().catch(() => {
      if (sceneTimer === mine) stopSceneClock()
    })
  })
  sceneTimer = mine
}

const stopTicking = (): void => {
  timer?.cancel()
  timer = undefined
}

const tickOnce = async ($: EngineInterface, settings: Settings, mine: Timer, count: number): Promise<void> => {
  if (timer !== mine) return

  const placed = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)
  if (timer !== mine) return
  if (!placed && !Object.values(await read($, agents)).some(isRunning) && !(await workflowHeld($, settings))) {
    stopTicking()

    return
  }
  if (!placed && count % RECONCILE_TICKS !== 0) return

  const now = await $.clock.now()
  if (timer !== mine) return

  const reconciling = count % RECONCILE_TICKS === 0
  const all = reconciling ? await reconcile($, settings, now, mine) : await read($, agents)
  if (timer !== mine || all === undefined) return
  // Workflow agents expire with the reconciliation, written only when one does.
  if (reconciling) await pruneShadows($, settings, all, now)
  if (reconciling) await quietly($, () => pruneTrails($, settings))
  if (timer !== mine) return

  await showStatus($, settings, all, now, mine)
  if (timer !== mine) return
  if (!placed && !Object.values(all).some(isRunning) && !(await workflowHeld($, settings))) {
    stopTicking()

    return
  }

  if (placed) await update($, tick, () => now)
}

const startTicking = ($: EngineInterface, settings: Settings): void => {
  if (timer !== undefined) return
  let count = 0
  const mine = $.clock.every(TICK_MS, () => {
    count += 1
    void tickOnce($, settings, mine, count).catch(() => {
      if (timer === mine) stopTicking()
    })
  })
  timer = mine
}

const startIfNeeded = async ($: EngineInterface, settings: Settings): Promise<void> => {
  if (timer !== undefined) return
  if (Object.values(await read($, agents)).some(isRunning) || (await workflowHeld($, settings))) {
    startTicking($, settings)

    return
  }
  const pane = (await $.ui.panes()).find(one => one.id === PANE)
  if (pane?.isPlaced) startTicking($, settings)
}

// The HUD's module memory: the git timer, when the inventory was last asked
// for, and the last main-loop step written. A reload starts it over; what the
// HUD draws lives in `$.state`.
let gitWindowMs = GIT_DEBOUNCE_MS
let gitRuns = debouncer(gitWindowMs)
let inventoryAskedAt: number | undefined
let lastStep: string | undefined
// The rate-limit windows the last `session.measure` carried, as the engine
// sent them, for `/mod-hud facts`; undefined until one arrives after a load.
let lastMeasureLimits: readonly { kind: string }[] | undefined
// Whether the main loop was last written busy (true) or idle (false), so a
// turn's later requests skip the state; undefined after a load reads it once.
let mainBusy: boolean | undefined
// A known subagent's calls in flight, by tool_use_id: `tool.check` names the
// call, not its loop.
const subagentCalls = new Map<string, string>()
const askingCalls = new Set<string>()
const askingTimers = new Map<string, Timer>()
const MAX_CALLS = 256
const ASK_PENDING_MS = 3000

const clearCalls = (): void => {
  for (const timer of askingTimers.values()) timer.cancel()
  askingTimers.clear()
  askingCalls.clear()
  subagentCalls.clear()
}

const forgetCall = (callId: string): void => {
  askingTimers.get(callId)?.cancel()
  askingTimers.delete(callId)
  askingCalls.delete(callId)
  subagentCalls.delete(callId)
}

const isAsking = (loop: string): boolean =>
  [...askingCalls].some(callId => subagentCalls.get(callId) === loop)

const syncAsking = ($: EngineInterface, loop: string): Promise<void> =>
  quietly($, async () => {
    await patch($, loop, entry => ({ ...entry, awaitingPermission: isRunning(entry) && isAsking(loop) ? true : undefined }))
  })

const trackCall = async ($: EngineInterface, callId: string, loop: string): Promise<void> => {
  subagentCalls.set(callId, loop)
  if (subagentCalls.size <= MAX_CALLS) return
  const oldest = subagentCalls.keys().next().value
  if (oldest === undefined) return
  const owner = subagentCalls.get(oldest)
  const wasAsking = askingCalls.has(oldest)
  forgetCall(oldest)
  if (wasAsking && owner !== undefined) await syncAsking($, owner)
}

const resetHud = (): void => {
  gitRuns.cancel()
  gitWindowMs = GIT_DEBOUNCE_MS
  gitRuns = debouncer(gitWindowMs)
  inventoryAskedAt = undefined
  lastStep = undefined
  lastMeasureLimits = undefined
  mainBusy = undefined
  clearCalls()
}

// A fact is written only when it changed, so an unchanged reading redraws
// nothing. One reviser per fact: the scan reads each atom at its own call.
type Change<T> = (held: T) => T

const changes = <T,>(held: T, change: Change<T>): boolean => !sameFacts(held, change(held))

const reviseSession = async ($: EngineInterface, change: Change<HudSessionFacts>): Promise<void> => {
  if (changes(await read($, hudSession), change)) await update($, hudSession, change)
}

const reviseUsage = async ($: EngineInterface, change: Change<HudUsageFacts>): Promise<void> => {
  if (changes(await read($, hudUsage), change)) await update($, hudUsage, change)
}

const reviseGit = async ($: EngineInterface, change: Change<HudGitFacts>): Promise<void> => {
  if (changes(await read($, hudGit), change)) await update($, hudGit, change)
}

const reviseTools = async ($: EngineInterface, change: Change<HudToolFacts>): Promise<void> => {
  if (changes(await read($, hudTools), change)) await update($, hudTools, change)
}

const reviseTodos = async ($: EngineInterface, change: Change<HudTodoFacts>): Promise<void> => {
  if (changes(await read($, hudTodos), change)) await update($, hudTodos, change)
}

const reviseMain = async ($: EngineInterface, change: Change<HudMainFacts>): Promise<void> => {
  if (changes(await read($, mainFacts), change)) await update($, mainFacts, change)
}

// The ledger's revisers return the ledger they were given when nothing changed.
const reviseLedger = async ($: EngineInterface, change: Change<HudLedger>): Promise<void> => {
  const held = await read($, ledger)
  if (change(held) !== held) await update($, ledger, change)
}

// The main loop at work from its turn's first request until the turn ends:
// one write each way per turn, none per request or tick.
const markMainBusy = async ($: EngineInterface): Promise<void> => {
  const now = await $.clock.now()
  await reviseMain($, held => (held.busySince === undefined ? defined({ ...held, busySince: now, idleSince: undefined }) : held))
  mainBusy = true
}

const markMainIdle = async ($: EngineInterface): Promise<void> => {
  const now = await $.clock.now()
  await reviseMain($, held => (held.busySince === undefined ? held : defined({ ...held, busySince: undefined, idleSince: now })))
  mainBusy = false
}

// One answer of the engine's, boxed so an unset value tells apart from a refusal (undefined).
const read1 = async <T,>(call: () => Promise<T>): Promise<{ value: T } | undefined> => {
  try {
    return { value: await call() }
  } catch {
    return undefined
  }
}

// One answer of the engine's, or undefined when the call fails.
const attempt = async <T,>(call: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await call()
  } catch {
    return undefined
  }
}

const gitWindow = (ms: number): void => {
  if (gitWindowMs === ms) return
  gitWindowMs = ms
  gitRuns.setWindow(ms)
}

// A promise's outcome, never a rejection: a git run that timed out (or could not start) reads as undefined.
const settled = <T,>(work: Promise<T>): Promise<{ value: T } | undefined> => work.then(value => ({ value }), () => undefined)

// One git reading: `git status` first, written as soon as it answers (with the
// line counts and the last commit as held), then the lines changed against
// HEAD and HEAD's commit time, which run beside it and are folded in when they
// answer. Any of the three timing out (or git missing) backs the timer off to
// GIT_BACKOFF_MS until a reading where all three answer.
const refreshGit = async ($: EngineInterface): Promise<void> => {
  const cwd = (await attempt(() => $.session.cwd())) ?? (await read($, hudSession)).cwd
  if (cwd === undefined || cwd === '') return
  // No index refresh, so these reads never hold a lock the agent's git wants.
  const git = (args: string[]): Promise<ProcessRunResult> =>
    $.process.run(['git', '-C', cwd, ...args], { timeoutMs: GIT_TIMEOUT_MS, env: { GIT_OPTIONAL_LOCKS: '0' } })
  const statusRun = settled(git(['status', '--porcelain=v2', '--branch']))
  const diffRun = settled(git(['diff', '--shortstat', 'HEAD']))
  // A signature check (log.showSignature) would print before the time: off for this read.
  const logRun = settled(git(['-c', 'log.showSignature=false', 'log', '-1', '--format=%ct']))
  const ran = (await statusRun)?.value
  if (ran === undefined) {
    // Git missing, or slower than its timeout: keep the reading and back off.
    gitWindow(GIT_BACKOFF_MS)
    return
  }
  // Not a repository (or git refused it): nothing to draw.
  if (ran.exitCode !== 0) {
    gitWindow(GIT_DEBOUNCE_MS)
    return reviseGit($, () => NO_FACTS.git)
  }
  const status = parseGitStatus(ran.stdout)
  const at = await $.clock.now()
  // The status now, the line counts and the last commit as held until theirs answer.
  await reviseGit($, held => gitFactsOf(held, defined({ ...status, linesAdded: held.linesAdded, linesDeleted: held.linesDeleted, lastCommitAt: held.lastCommitAt }), at))
  const [lines, commit] = await Promise.all([diffRun, logRun])
  gitWindow(lines === undefined || commit === undefined ? GIT_BACKOFF_MS : GIT_DEBOUNCE_MS)
  // A repository with no commit yet has neither: those cells stay away. One that timed out keeps what is held.
  const changed = lines === undefined ? undefined : lines.value.exitCode === 0 ? parseShortstat(lines.value.stdout) ?? null : null
  const committed = commit === undefined ? undefined : commit.value.exitCode === 0 ? parseCommitTime(commit.value.stdout) ?? null : null
  const now = await $.clock.now()
  await reviseGit($, held => gitFactsOf(held, defined({
    ...status,
    linesAdded: changed === undefined ? held.linesAdded : changed?.linesAdded,
    linesDeleted: changed === undefined ? held.linesDeleted : changed?.linesDeleted,
    lastCommitAt: committed === undefined ? held.lastCommitAt : committed ?? undefined,
  }), now))
}

// Asks for a git reading: every ask until the timer fires is the same run.
const requestGit = async ($: EngineInterface, settings: Settings, leading = false): Promise<void> => {
  if (!settings.showGit) {
    gitRuns.cancel()
    await reviseGit($, () => NO_FACTS.git)
    return
  }
  const now = await $.clock.now()
  const run = (): void => void quietly($, async () => {
    await refreshGit($)
    await refreshStatus($, settings)
  })
  gitRuns.request(now, (ms, fn) => $.clock.after(ms, fn), run, { leading })
}

// The inventory comes from a `summary` breakdown at most once per
// INVENTORY_EVERY_MS: the module counts its own asks, the state's `at` the
// last reading across reloads.
const refreshInventory = async ($: EngineInterface): Promise<void> => {
  const now = await $.clock.now()
  if (!throttleDue(inventoryAskedAt, now, INVENTORY_EVERY_MS)) return
  inventoryAskedAt = now
  const held = await read($, hudInventory)
  if (!throttleDue(held.at, now, INVENTORY_EVERY_MS)) {
    inventoryAskedAt = held.at
    return
  }
  const usage = await $.session.usage({ breakdown: 'summary' })
  const facts = inventoryOf(usage.context.breakdown, now)
  if (facts !== undefined) await update($, hudInventory, () => facts)
}

const requestInventory = async ($: EngineInterface): Promise<void> => {
  if (!throttleDue(inventoryAskedAt, await $.clock.now(), INVENTORY_EVERY_MS)) return
  $.clock.after(0, () => void quietly($, () => refreshInventory($)))
}

// Environment variables read by name: each key beside its own `$.env.get`
// (the engine lists a module's variables from those literal names), the
// record typed by the names facts.ts lists, so none can be missed or crossed.
// Undefined when any read is refused: then nothing inferred from them can be trusted.
type EnvReads<N extends string> = Record<N, () => Promise<string | undefined>>

const readEnv = async <N extends string>(reads: EnvReads<N>): Promise<Record<N, string | undefined> | undefined> => {
  const read = await Promise.all((Object.keys(reads) as N[]).map(async name => [name, await read1(reads[name])] as const))
  if (read.some(([, one]) => one === undefined)) return undefined

  return Object.fromEntries(read.map(([name, one]) => [name, one?.value])) as Record<N, string | undefined>
}

// What picks the prompt cache's TTL (facts.ts CACHE_ENV): only whether each is set is used, never a key's value.
const cacheEnvReads = ($: EngineInterface): EnvReads<(typeof CACHE_ENV)[number]> => ({
  DISABLE_PROMPT_CACHING: () => $.env.get('DISABLE_PROMPT_CACHING'),
  FORCE_PROMPT_CACHING_5M: () => $.env.get('FORCE_PROMPT_CACHING_5M'),
  CLAUDE_CODE_PROMPT_CACHE_TTL: () => $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'),
  ENABLE_PROMPT_CACHING_1H: () => $.env.get('ENABLE_PROMPT_CACHING_1H'),
  ENABLE_PROMPT_CACHING_1H_BEDROCK: () => $.env.get('ENABLE_PROMPT_CACHING_1H_BEDROCK'),
  ANTHROPIC_API_KEY: () => $.env.get('ANTHROPIC_API_KEY'),
  ANTHROPIC_AUTH_TOKEN: () => $.env.get('ANTHROPIC_AUTH_TOKEN'),
  CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR: () => $.env.get('CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR'),
  ANTHROPIC_BASE_URL: () => $.env.get('ANTHROPIC_BASE_URL'),
  CLAUDE_CODE_USE_BEDROCK: () => $.env.get('CLAUDE_CODE_USE_BEDROCK'),
  CLAUDE_CODE_USE_VERTEX: () => $.env.get('CLAUDE_CODE_USE_VERTEX'),
  CLAUDE_CODE_USE_FOUNDRY: () => $.env.get('CLAUDE_CODE_USE_FOUNDRY'),
  CLAUDE_CODE_USE_ANTHROPIC_AWS: () => $.env.get('CLAUDE_CODE_USE_ANTHROPIC_AWS'),
  CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD: () => $.env.get('CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD'),
  CLAUDE_CODE_USE_MANTLE: () => $.env.get('CLAUDE_CODE_USE_MANTLE'),
})

// What switches auto-compaction off (facts.ts COMPACT_ENV).
const compactEnvReads = ($: EngineInterface): EnvReads<(typeof COMPACT_ENV)[number]> => ({
  DISABLE_AUTO_COMPACT: () => $.env.get('DISABLE_AUTO_COMPACT'),
  DISABLE_COMPACT: () => $.env.get('DISABLE_COMPACT'),
})

// The session's facts at start and at each reload: who, where, and what the
// engine has measured so far. Git and the inventory follow from timers.
const startHud = async ($: EngineInterface, settings: Settings, startCwd: string): Promise<void> => {
  const [model, cwd, repo, usage, env, compactEnv, stored] = await Promise.all([
    attempt(() => $.session.model()),
    attempt(() => $.session.cwd()),
    attempt(() => $.session.repo()),
    attempt(() => $.session.usage()),
    readEnv(cacheEnvReads($)),
    readEnv(compactEnvReads($)),
    attempt(() => $.settings.read()),
  ])
  const baseUrl = env?.ANTHROPIC_BASE_URL
  const settingsRead = stored as (CacheSettings & { autoCompactEnabled?: unknown }) | undefined
  // An environment that cannot be read leaves the TTL unknown (the option may still name one).
  const ttl = env === undefined ? undefined : cacheTtlOf(env, settingsRead)
  await reviseSession($, held => defined({
    ...held,
    model: model ?? held.model,
    // A main step's effort is the one in use; the settings' stand in before one.
    effort: held.effort ?? effortFromSettings(stored, model ?? held.model),
    provider: providerOf(baseUrl),
    cacheTtl: ttl?.ttl,
    cacheTtlAssumed: ttl?.assumed,
    // What the figures read now say of the login (a load mid-session may hold a response's).
    account: usage === undefined ? held.account : accountAfter(held.account, usage),
    autoCompact: autoCompactOf(compactEnv, settingsRead),
    startedAt: usage?.startedAt ?? held.startedAt,
    cwd: cwd ?? startCwd,
    // null is outside a repository; undefined, a failed call that changes nothing.
    repoRoot: repo === undefined ? held.repoRoot : (repo?.root ?? undefined),
  }))
  if (usage !== undefined) {
    const now = await $.clock.now()
    // The cost first read is the next turn's baseline (a load mid-session), unless one is held.
    await reviseUsage($, held => seedTurnBaseline(applyMeasure(held, usage, now)))
  }
  await requestGit($, settings, true)
  // Read whatever the options: its auto-compact threshold bounds the runway.
  await requestInventory($)
}

// What the HUD draws, every fact read so a drawing that calls this redraws
// when any of them is written.
const readHudData = async ($: EngineInterface, now: number, cacheTtl: Settings['cacheTtl'] = 'auto'): Promise<HudData> =>
  assembleHudData({
    session: await read($, hudSession),
    usage: await read($, hudUsage),
    git: await read($, hudGit),
    tools: await read($, hudTools),
    todos: await read($, hudTodos),
    inventory: await read($, hudInventory),
  }, now, cacheTtl)

// What the alert strip counts that no HUD fact carries: running subagents
// waiting on a permission ask, subagents and workflow agents stalled, and the
// calls the ledger counted denied or failed in the last ten minutes (kept with
// inspect on). Undefined while every count is 0.
const alertCountsOf = async ($: EngineInterface, settings: Settings, now: number): Promise<HudAlerts | undefined> => {
  const all = await read($, agents)
  const board = Object.values(all)
  const asks = board.filter(entry => isRunning(entry) && entry.awaitingPermission === true).length
  const flow = settings.showWorkflows ? shadowCounts(workflowOf(await read($, shadows), all, now), now, settings.stalledMs).stalled : 0
  const stalled = board.filter(entry => isStalled(entry, now, settings.stalledMs)).length + flow
  // Calls denied or failed in the last ten minutes (FAILURE_WINDOW_MS): the alert clears on its own.
  const failed = settings.inspect ? (await read($, ledger)).failures : undefined
  const failures = recentFailures(failed?.recent, now).length
  const alerts = defined<HudAlerts>({
    asks: asks > 0 ? asks : undefined,
    stalled: stalled > 0 ? stalled : undefined,
    failures: failures > 0 ? failures : undefined,
  })

  return Object.keys(alerts).length === 0 ? undefined : alerts
}

// The HUD as the pane and the status line show it: the parts switched off
// left out, the main loop working or idle, what needs attention, and the
// motto, if any. The inventory is no longer drawn: its auto-compact threshold
// (read whatever the options) marks the ctx bar and bounds the runway; with
// `showInventory` on, its MCP servers and skills are printed by `/mod-hud facts`.
const hudDataOf = async ($: EngineInterface, settings: Settings, now: number): Promise<HudData> => {
  const data = await readHudData($, now, settings.cacheTtl)
  // The agents' share of the spend, from the ledger (kept with inspect on).
  const agentShare = settings.inspect ? await attempt(async () => agentShareOf(await read($, ledger))) : undefined
  const main = (await attempt(() => read($, mainFacts))) ?? NO_MAIN
  const working = main.busySince !== undefined || main.idleSince !== undefined
    ? defined({ busySince: main.busySince, idleSince: main.busySince === undefined ? main.idleSince : undefined })
    : undefined

  return defined<HudData>({
    ...data,
    usage: data.usage === undefined ? undefined : defined({ ...data.usage, agentShare }),
    git: settings.showGit ? data.git : undefined,
    tools: settings.showTools ? data.tools : undefined,
    todos: settings.showTodos ? data.todos : undefined,
    inventory: settings.showInventory ? data.inventory : compactOnly(data.inventory),
    main: working,
    alerts: await attempt(() => alertCountsOf($, settings, now)),
    motto: settings.motto === '' ? undefined : settings.motto,
  })
}

// With `showInventory` off, the inventory's threshold alone (none when it is unknown).
const compactOnly = (inventory: HudData['inventory']): HudData['inventory'] =>
  inventory?.compactAt === undefined && inventory?.autoCompact === undefined
    ? undefined
    : defined({ mcpServers: [], compactAt: inventory.compactAt, autoCompact: inventory.autoCompact })

// A HUD fact the status line shows changed: redraw it, when it is on.
const refreshStatus = async ($: EngineInterface, settings: Settings): Promise<void> => {
  if (!settings.statusLine) return
  await showStatus($, settings, await read($, agents), await $.clock.now())
}

// A `/clear`: tools, todos, compactions and context fill start over; who and
// where the session is, git and the inventory stay. The engine may still be
// reporting the old conversation, so accept its clock and cost only together.
const clearHud = async ($: EngineInterface, settings: Settings): Promise<void> => {
  // With `showTools` off only the files edited (the Overview's) were kept: they start over too.
  await reviseTools($, held => (settings.showTools ? NO_FACTS.tools : held.edited === undefined ? held : defined({ ...held, edited: undefined })))
  if (settings.showTodos) await reviseTodos($, () => NO_FACTS.todos)
  const usage = await attempt(() => $.session.usage())
  const heldStart = (await read($, hudSession)).startedAt
  const isNew = usage !== undefined && (heldStart === undefined || usage.startedAt > heldStart)
  const startedAt = isNew ? usage.startedAt : await $.clock.now()
  await reviseSession($, held => ({ ...held, startedAt }))
  await reviseUsage($, held => afterClear(defined({
    ...held,
    costUsd: isNew ? applyMeasure(held, usage).costUsd : undefined,
  })))
}

// A known subagent's call starting: activity, one more call, its current
// tool, and a finished agent resumes. False when the board does not know it.
const boardCallStarted = async ($: EngineInterface, settings: Settings, loop: string, label: string): Promise<boolean> => {
  let known: AgentBoardEntry | undefined
  try {
    known = (await read($, agents))[loop]
  } catch {
    // A failed board read must not interfere with the tool.
  }
  if (known === undefined) return false

  const resumed = !isRunning(known)
  await quietly($, async () => {
    const now = await $.clock.now()
    const written = await patch($, loop, entry => ({
      ...entry,
      status: 'running',
      endedAt: undefined,
      outcome: undefined,
      toolCalls: entry.toolCalls + 1,
      currentTool: label,
      lastActivityAt: now,
      // The scene's reading streak, in the same write: begun by a read, ended by any other call.
      readingSince: settings.mascots ? readingAfter(entry.readingSince, label, now) : undefined,
    }))
    if (resumed) {
      await showStatus($, settings, written, now)
      await startIfNeeded($, settings)
    }
  })

  return true
}

const boardCallEnded = ($: EngineInterface, loop: string, label: string): Promise<void> =>
  quietly($, async () => {
    const now = await $.clock.now()
    await patch($, loop, entry => ({
      ...entry,
      currentTool: entry.currentTool === label ? undefined : entry.currentTool,
      awaitingPermission: isRunning(entry) && isAsking(loop) ? true : undefined,
      lastActivityAt: now,
    }))
  })

// PermissionRequest has no call id in this contract and no resolution event.
// Fall back to a call's ask remaining in flight for three seconds, so quick
// classifier decisions do not flash a hand. No timer survives the call.
const markAsking = ($: EngineInterface, callId: string, loop: string): void => {
  if (askingTimers.has(callId) || askingCalls.has(callId)) return
  const timer = $.clock.after(ASK_PENDING_MS, () => {
    if (askingTimers.get(callId) !== timer) return
    askingTimers.delete(callId)
    if (subagentCalls.get(callId) !== loop) return
    askingCalls.add(callId)
    void syncAsking($, loop)
  })
  askingTimers.set(callId, timer)
}

// What an Agent call returned: a completed run settles its entry, a launched
// one fills its model.
const settleAgentCall = ($: EngineInterface, settings: Settings, outcome: ToolCallResult): Promise<void> =>
  quietly($, async () => {
    if (outcome.deny !== undefined || outcome.isError === true) return
    const record = outcome.result as BuiltinToolResults['Agent'] | undefined
    if (typeof record !== 'object' || record === null || !('agentId' in record)) return
    const now = await $.clock.now()

    if (record.status === 'completed') {
      // These provenance fields are internal; older results may omit them.
      const notes = typeof record.harnessNoteCount === 'number' && Number.isInteger(record.harnessNoteCount)
        && record.harnessNoteCount >= 0 ? record.harnessNoteCount : 0
      const text = typeof record.handbackReport?.text === 'string'
        ? record.handbackReport.text
        : record.content.slice(notes).find(block => block.type === 'text')?.text
      const written = await patch($, record.agentId, entry => {
        const wasRunning = isRunning(entry)

        return {
          ...entry,
          model: entry.model ?? record.resolvedModel,
          toolCalls: Math.max(entry.toolCalls, record.totalToolUseCount),
          summary: entry.summary ?? (text === undefined ? undefined : firstLine(text)),
          status: wasRunning ? 'done' : entry.status,
          outcome: entry.outcome ?? (wasRunning ? 'answer' : undefined),
          endedAt: entry.endedAt ?? now,
          currentTool: undefined,
        }
      })
      await showStatus($, settings, await prune($, settings, written), now)
    } else if (record.status === 'async_launched') {
      await patch($, record.agentId, entry => ({ ...entry, model: entry.model ?? record.resolvedModel }))
    }
  })

// --- workflow agents ---------------------------------------------------------
// A Workflow run's agents carry ids no list names, and are not the Agent
// tool's, whose `agent.spawn` would name them: their loops' steps, calls and
// turn ends are all there is. They are kept in `mod-hud.shadows`, never on
// the board, so `mod-hud.agents` stays as the mods that read it expect.

// One compare-and-set of the workflow agents: the record before and after,
// or undefined when the change kept it as it was and nothing was written.
const reviseShadows = async (
  $: EngineInterface,
  change: (held: Shadows) => Shadows,
): Promise<{ before: Shadows; after: Shadows } | undefined> => {
  for (let retry = 0; retry < 3; retry += 1) {
    const held = await $.state.get(SHADOWS)
    const before: Shadows = held.value ?? {}
    const after = change(before)
    if (after === before) return undefined
    const written = await $.state.set(SHADOWS, after, { ifVersion: held.version })
    if (written.isSet) return { before, after }
  }

  return undefined
}

// A workflow agent held that has shown (until a prune drops it) keeps the
// board's clock going, as a running subagent does: its time, its expiry.
const workflowHeld = async ($: EngineInterface, settings: Settings): Promise<boolean> =>
  settings.showWorkflows && Object.values(await read($, shadows)).some(isShadowVisible)

// Expired entries go, and any the board or the latest list now names.
const pruneShadows = async ($: EngineInterface, settings: Settings, all: Agents, now: number): Promise<void> => {
  if (!settings.showWorkflows) return
  await reviseShadows($, held => shadowsPruned(held, now, id => all[id] !== undefined || listedIds.has(id)))
}

// A change the summary shows (one more shown, or one ended): the status line,
// and the clock. Any other change (a call, a step) touches neither.
const shadowsChanged = async ($: EngineInterface, settings: Settings, change: { before: Shadows; after: Shadows } | undefined): Promise<void> => {
  if (change === undefined) return
  const now = await $.clock.now()
  const counts = (record: Shadows): string => {
    const { running, done, failed } = shadowCounts(shownShadows(record, now), now, settings.stalledMs)

    return `${running}/${done}/${failed}`
  }
  if (counts(change.before) === counts(change.after)) return
  if (settings.statusLine) await showStatus($, settings, await read($, agents), now)
  await startIfNeeded($, settings)
}

// A request in a loop neither the board nor the latest list knows: one write
// per step, made before the request goes, whatever its stream then yields.
const shadowStep = async ($: EngineInterface, settings: Settings, id: string, model: string, effort: string | undefined): Promise<void> => {
  if (listedIds.has(id) || (await read($, agents))[id] !== undefined) return
  const now = await $.clock.now()
  await shadowsChanged($, settings, await reviseShadows($, held => shadowStepped(held, id, { model, effort }, now)))
}

const shadowCallStart = async ($: EngineInterface, settings: Settings, id: string, label: string): Promise<void> => {
  const now = await $.clock.now()
  await shadowsChanged($, settings, await reviseShadows($, held => shadowCallStarted(held, id, label, now)))
}

const shadowCallEnd = async ($: EngineInterface, settings: Settings, id: string, label: string): Promise<void> => {
  const now = await $.clock.now()
  await shadowsChanged($, settings, await reviseShadows($, held => shadowCallEnded(held, id, label, now)))
}

const shadowTurnEnded = async ($: EngineInterface, settings: Settings, id: string, reason: string): Promise<void> => {
  const now = await $.clock.now()
  await shadowsChanged($, settings, await reviseShadows($, held => shadowEnded(held, id, reason, now)))
}

// Every session end: nothing of the old session's runs is kept.
const clearShadows = async ($: EngineInterface): Promise<void> => {
  await reviseShadows($, held => (Object.keys(held).length === 0 ? held : {}))
}

// --- click to inspect ----------------------------------------------------------
// A press on an agent's row or mascot selects it (`mod-hud.selected`); the
// pane then draws its detail view in place of the scene. A subagent's last
// answer is read on selection and at each of its turn ends, never per frame;
// every agent's last calls are kept as a trail, one write as each call starts.

// Messages between agents for the scene's bubbles: module memory, never state.
const MAX_EVENTS = 16
let sceneEvents: SceneEvent[] = []
// The smooth scene's `Client`: its key in the pane's tree, which a click's `ui.message` names.
const SCENE_KEY = 'mascots'

// The TV (hooks/tv-client.tsx): its `Client`'s key, which its posts' `ui.message` names. Module
// memory, never state, for what only its drawing reads: where the pressed mascot stood (the
// scene's click says, in the scene's cells) for it to fly from, and whether it was flying (its
// propeller cap on, the TV wearing it too); what each surface's glass can
// press, by key, from its last drawing; the surfaces it is up on and the pane's last scroll
// handed to it; the surfaces it failed on (the pane's own view there); and the mascot back
// from it, shaken till STARTLED_MS after.
const TV_KEY = 'tv'
let tvFrom: { id: string; x: number; y: number; mini?: true; cap?: true } | undefined
const tvPresses = new Map<string, Map<string, () => void>>()
const tvUp = new Set<string>()
/** Surfaces whose TV's module said its mascot grew into the giant (as it switches on), till it shrinks back: where pictures are drawn, the giant one under its glass. */
const tvGiants = new Set<string>()
let tvWheel: { seq: number; by: number; page?: true } = { seq: 0, by: 0 }
const tvFaulted = new Set<string>()
let startled: { id: string; at: number } | undefined
// Where the smooth scene's region starts in each surface's pane, from its last drawing: a click's cells from there.
const sceneTops = new Map<string, number>()

/** A click's post from the scene's surface module: `{ kind: 'inspect', id, at, cap }` (where the mascot stood, in its region's cells; whether it was flying), or undefined for anything else. */
const inspectAsk = (data: unknown): { id: string; at?: { x: number; y: number; mini?: true }; cap?: true } | undefined => {
  if (typeof data !== 'object' || data === null) return undefined
  const { kind, id, at, cap, mini } = data as { kind?: unknown; id?: unknown; at?: unknown; cap?: unknown; mini?: unknown }
  if (kind !== 'inspect' || typeof id !== 'string' || id === '' || id.length > 200) return undefined
  const { x, y } = (typeof at === 'object' && at !== null ? at : {}) as { x?: unknown; y?: unknown }
  const placed = typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 10_000 && Math.abs(y) < 10_000

  return { id, ...(placed ? { at: { x: Math.round(x), y: Math.round(y), ...(mini === true ? { mini: true as const } : {}) } } : {}), ...(cap === true ? { cap: true as const } : {}) }
}

const HUD_TABS: readonly HudTab[] = ['task', 'trail', 'said', 'agents', 'overview', 'cost']

// A call starting: one write, its start time returned so its end can find it.
const recordTrail = async ($: EngineInterface, settings: Settings, loop: string, label: string, input: Readonly<Record<string, unknown>>): Promise<number | undefined> => {
  if (!settings.inspect) return undefined
  const now = await $.clock.now()
  const board = await read($, agents)
  const held = settings.showWorkflows ? await read($, shadows) : {}
  const keep = (id: string): boolean => board[id] !== undefined || held[id] !== undefined
  if (!keep(loop)) return undefined
  const arg = mainArgOf(input)
  await update($, trails, all => trailAdded(all, loop, defined({ tool: label, arg, at: now }), keep))

  return now
}

// What a call's result says of how it ended: thrown or an error, denied, or ok.
const outcomeOf = (ran: ToolCallResult | undefined): NonNullable<HudTrailStep['outcome']> =>
  ran === undefined || ran.isError === true ? 'error' : ran.deny !== undefined ? 'denied' : 'ok'

// That call ending: one write when its step is still held; state has no patch API.
const endTrail = async ($: EngineInterface, loop: string, label: string, at: number, outcome: NonNullable<HudTrailStep['outcome']>): Promise<void> => {
  const ms = (await $.clock.now()) - at
  const end = (all: Trails): Trails => trailEnded(all, loop, { tool: label, at }, { ms, outcome })
  const held = await read($, trails)
  if (end(held) !== held) await update($, trails, end)
}

// Who a loop is, for its first booking in the ledger.
const ledgerWhoOf = async ($: EngineInterface, settings: Settings, id: string | undefined): Promise<LedgerWho> => {
  if (id === undefined) return { kind: 'main' }
  const entry = (await read($, agents))[id]
  if (entry !== undefined) return defined<LedgerWho>({ kind: 'agent', name: entry.type || entry.name, description: entry.description || undefined, startedAt: entry.startedAt })
  const held = settings.showWorkflows ? (await read($, shadows))[id] : undefined

  return held !== undefined && isShadowVisible(held) ? { kind: 'workflow', name: shadowName(held) } : { kind: 'fork', name: shadowName({ id }) }
}

// Trails of agents no longer on the board or among the workflow agents go,
// along with a selection that names one; written only when they change.
const pruneTrails = async ($: EngineInterface, settings: Settings): Promise<void> => {
  if (!settings.inspect) return
  const board = await read($, agents)
  const held = settings.showWorkflows ? await read($, shadows) : {}
  const keep = (id: string): boolean => board[id] !== undefined || held[id] !== undefined
  const all = await read($, trails)
  const kept = trailsPruned(all, keep)
  if (kept !== all) await update($, trails, () => kept)
  const choice = await read($, selected)
  // The session's own view never goes with an agent.
  if (choice !== null && choice.kind !== 'main' && !keep(choice.id)) {
    await update($, selected, () => null)
    if ((await read($, detail)) !== null) await update($, detail, () => null)
  }
}

// The selected subagent's prompt and last answers, as the engine reads its conversation.
const fetchDetail = async ($: EngineInterface, id: string): Promise<void> => {
  const now = await $.clock.now()
  let facts: HudDetailFacts
  try {
    const found = await $.session.messages({ agentId: id })
    facts = Array.isArray(found) ? defined<HudDetailFacts>({ id, said: assistantTexts(found), prompt: promptOf(found), at: now }) : { id, deny: found.deny, at: now }
  } catch (error) {
    facts = { id, deny: String(error), at: now }
  }
  const choice = await read($, selected)
  if (choice?.kind === 'agent' && choice.id === id) await update($, detail, () => facts)
}

// A press: select an agent or the session (on a tab, or its first), or clear
// the selection (Back). A subagent's conversation is read when it is newly
// selected or not yet held; a workflow agent's, and the session's, never.
const selectAgent = ($: EngineInterface, choice: HudSelection | null): Promise<void> =>
  quietly($, async () => {
    const before = await read($, selected)
    await update($, selected, () => choice)
    if (choice?.kind === 'agent') {
      if (before?.id !== choice.id || (await read($, detail))?.id !== choice.id) await fetchDetail($, choice.id)
    } else if ((await read($, detail)) !== null) await update($, detail, () => null)
  })

// A tab's press: the selection on that tab; a subagent's conversation is read
// for its Task and Said tabs when it is not held yet.
const selectTab = ($: EngineInterface, tab: HudTab): Promise<void> =>
  quietly($, async () => {
    const choice = await read($, selected)
    if (choice === null || tabOf(choice) === tab || !tabsOf(choice.kind).includes(tab)) return
    await update($, selected, held => (held === null || held.id !== choice.id ? held : { ...held, tab }))
    if (choice.kind === 'agent' && (tab === 'said' || tab === 'task') && (await read($, detail))?.id !== choice.id) await fetchDetail($, choice.id)
  })

// A group's `▸ n more` / `▾ collapse`: its finished agents all listed, or three.
const toggleGroup = ($: EngineInterface, group: 'agents' | 'workflow'): Promise<void> =>
  quietly($, async () => {
    await update($, listView, held => defined<HudListView>({ ...held, [group]: held[group] === true ? undefined : true }))
  })

// A group header's `▾` / `▸`: the group minimised to its header, or opened again.
const toggleMinimised = ($: EngineInterface, group: 'agents' | 'workflow'): Promise<void> =>
  quietly($, async () => {
    const key = group === 'agents' ? 'agentsMinimised' : 'workflowMinimised'
    await update($, listView, held => defined<HudListView>({ ...held, [key]: held[key] === true ? undefined : true }))
  })

// The TODO line's `▸` / `▾`: every item listed under the line, or the line alone.
const toggleTodos = ($: EngineInterface): Promise<void> =>
  quietly($, async () => {
    await update($, listView, held => defined<HudListView>({ ...held, todosExpanded: held.todosExpanded === true ? undefined : true }))
  })

// A Cost-tree model's line: its users listed, or not.
const toggleModel = ($: EngineInterface, model: string): Promise<void> =>
  quietly($, async () => {
    await update($, listView, held => {
      const open = held.models ?? []
      const models = open.includes(model) ? open.filter(one => one !== model) : [...open, model]

      return defined<HudListView>({ ...held, models: models.length === 0 ? undefined : models })
    })
  })

// A message sent to a known agent: a bubble from its sender to it.
const noteMessage = async ($: EngineInterface, settings: Settings, from: string | undefined, to: unknown): Promise<void> => {
  if (!settings.mascots || !settings.scenes || typeof to !== 'string' || to === '') return
  const board = await read($, agents)
  const target = board[to] ?? Object.values(board).find(entry => entry.name === to)
  const held = target === undefined && settings.showWorkflows ? (await read($, shadows))[to] : undefined
  const id = target?.id ?? held?.id
  if (id === undefined) return
  const tick = Math.floor((await $.clock.now()) / SCENE_FRAME_MS)
  sceneEvents = [...sceneEvents, { kind: 'message' as const, from: from ?? 'main', to: id, tick }].slice(-MAX_EVENTS)
}

// `/mod-hud facts`: what the HUD draws from, the workflow agents' record as
// held (`shadows`), the ledger's summary (`ledger`: each model's estimated
// cost and tokens, the loops counted, the failures) and the lists' expansion
// (`listView`), each left out while it is empty, as pretty JSON, then whether
// the last `session.measure` carried any rate limits.
const factsText = async ($: EngineInterface, settings: Settings): Promise<string> => {
  const now = await $.clock.now()
  const hud = await hudDataOf($, settings, now)
  const held = settings.showWorkflows ? await read($, shadows) : {}
  const spent = await read($, ledger)
  const view = await read($, listView)
  const booked = Object.keys(spent.entries).length > 0 || Object.keys(spent.others).length > 0 || spent.failures !== undefined
  const data = {
    ...hud,
    ...(Object.keys(held).length === 0 ? {} : { shadows: held }),
    ...(booked ? { ledger: ledgerSummary(spent, now) } : {}),
    ...(Object.keys(view).length === 0 ? {} : { listView: view }),
  }
  const limits = lastMeasureLimits
  const kinds = limits === undefined ? '' : [...new Set(limits.map(one => String(one.kind)))].join(', ')
  const measured = limits === undefined
    ? 'No session.measure has arrived since mod-hud loaded, so no rateLimits have been seen.'
    : limits.length === 0
      ? 'The last session.measure carried no rateLimits (0).'
      : `The last session.measure carried ${limits.length} rateLimits (${kinds}).`

  return `${JSON.stringify(data, null, 2)}\n${measured}`
}

// --- the band above the prompt -------------------------------------------------
// --- the vector scene as a picture ---------------------------------------------
// In a terminal that shows pictures (Ghostty, kitty), with the vector art,
// the pane's scene and the band's yard are each a picture of tiles, each an
// `Image` the hooks swap a frame into when it changed (hooks/scene-image.ts),
// the scene's world run here as the `Client` runs it on its surface; over the
// tiles a `Client` drawing nothing hands them the pointer
// (hooks/scene-hit.tsx). A terminal that draws the Image's alt instead (no
// pictures there) refuses the first swap: the scene's own `Client` and its
// blocks on that surface for the session. Module memory, never state: a
// picture is its drawing's alone.

const HIT_MODULE = 'hooks/scene-hit.tsx'
/**
 * Each picture by its site (`<requestId>:<surface>`): its stage, its tiles'
 * Images' key, frames left in which a swap may find it not yet mounted, since
 * when its swaps have all been refused, and when its world last stepped (the
 * hooks' clock).
 */
type Picture = { stage: Stage; requestId: string; surface: string; key: string; fresh: number; refusedSince?: number; stepped?: number }
const pictures = new Map<string, Picture>()
/** Surfaces whose terminal shows no pictures, or whose hit layer failed: the scene's `Client` there. */
const pictureless = new Set<string>()
/** A drawing just handed over may not be mounted for a few frames. */
const PICTURE_FRESH = 10
/** How long swaps refused, the alt's aside, give up on pictures there, ms. */
const PICTURE_GIVE_UP_MS = 3000

/** A tile's Image's key within its picture. */
const tileKey = (picture: { key: string }, tile: Tile): string => `${picture.key}:${tile.x}:${tile.y}`
/**
 * The TV's giant as a picture under its glass, by site: its Image's key, who
 * and where it was drawn for, its frames by eyes and propeller blade (each
 * drawn when first shown), the one shown, whether its blade turns (pressed in
 * flight), and its own clock for the blinks and the blade.
 */
type GiantPicture = { requestId: string; surface: string; key: string; drawn: string; frames: Map<string, string>; shown: string; turns: boolean; ms: number; draw: (eyes: 'open' | 'shut', blade: number) => string }

/** A giant's frame at its clock: its eyes shut a moment every few seconds, no shorter than the timer's frame so none is missed; its blade turning two frames a second (each frame the whole giant). */
const giantFrameOf = (giant: GiantPicture): { key: string; eyes: 'open' | 'shut'; blade: number } => {
  const eyes = giant.ms % BLINK_EVERY_MS < Math.max(BLINK_MS, IMAGE_FRAME_MS) ? 'shut' : 'open'
  const blade = giant.turns ? Math.floor(giant.ms / Math.max(BLADE_MS, 4 * IMAGE_FRAME_MS)) % 2 : 0

  return { key: `${eyes}:${blade}`, eyes, blade }
}

/** A giant's frame, drawn once. */
const giantPng = (giant: GiantPicture, frame: { key: string; eyes: 'open' | 'shut'; blade: number }): string => {
  const drawn = giant.frames.get(frame.key) ?? giant.draw(frame.eyes, frame.blade)
  giant.frames.set(frame.key, drawn)

  return drawn
}
const giantPictures = new Map<string, GiantPicture>()
/** The last event taken from each hit layer, by its name: kept past the stages, which a session's end clears while their layers live on. */
const hitSeqs = new Map<string, number>()
let pictureTimer: Timer | undefined
let pictureBusy = false
/** The person's theme as the picture's scheme (a light theme's colours on a light one), read again after ten seconds. */
let pictureScheme: { scheme: 'dark' | 'light'; at: number } | undefined

const stopPictures = (): void => {
  pictureTimer?.cancel()
  pictureTimer = undefined
}

/** Whether a refused swap says the terminal draws the Image's alt there: no pictures. */
const drawsAlt = (deny: string): boolean => /\balt\b|placeholder|cannot read/i.test(deny)

/** No pictures on `surface` from now on: its scenes' `Client`s again, drawn at once. */
const noPictures = ($: EngineInterface, surface: string, why: string): void => {
  if (pictureless.has(surface)) return
  pictureless.add(surface)
  for (const [site, picture] of pictures) if (picture.surface === surface) pictures.delete(site)
  for (const [site, giant] of giantPictures) if (giant.surface === surface) giantPictures.delete(site)
  if (pictures.size === 0 && giantPictures.size === 0) stopPictures()
  $.ui.log(`the scene's picture on ${surface} is refused (${printable(why).slice(0, 160)}): its blocks there`, { to: 'debug' })
  $.clock.after(0, () => $.ui.invalidate('ui.render'))
}

/** The pane closed: its scene's pictures go (one held paused while inspecting draws no frame to find it gone), and the TV's giant with them. */
const dropPanePictures = (): void => {
  for (const [site, picture] of pictures) if (picture.requestId === PANE) pictures.delete(site)
  giantPictures.clear()
  tvGiants.clear()
  if (pictures.size === 0) stopPictures()
}

// Every IMAGE_FRAME_MS each picture's world steps on and, when its frame is due
// and new, is swapped in; one no longer mounted is let go, the timer with the last.
// The TV's giant blinks as the module's would: its eyes shut a moment every few seconds.
const startPictures = ($: EngineInterface): void => {
  if (pictureTimer !== undefined) return
  // Its worlds on from now, not by the time the timer was stopped.
  for (const picture of pictures.values()) picture.stepped = undefined
  const mine = $.clock.every(IMAGE_FRAME_MS, () => {
    if (pictureBusy || pictureTimer !== mine) return
    pictureBusy = true
    void quietly($, async () => {
      try {
        const scheme = pictureScheme?.scheme ?? 'dark'
        const now = await $.clock.now()
        // Each picture's world on by the time gone, its changed tiles drawn when its frame is due; the scenery's work ahead; then all the swaps at once.
        const swaps: Promise<void>[] = []
        for (const [site, picture] of pictures) {
          if (picture.fresh > 0) picture.fresh -= 1
          // On by the time gone since the last (a late timer, a costly frame before it), so its world keeps the clock's time.
          const step = picture.stepped === undefined ? IMAGE_FRAME_MS : Math.max(0, Math.min(MOST_STEP_MS, now - picture.stepped))
          picture.stepped = now
          const tiles = stageTick(picture.stage, step, scheme)
          if (tiles.length === 0) continue
          swaps.push(
            (async () => {
              // A swap that throws is refused as much as one denied.
              const denies = await Promise.all(
                tiles.map(async tile => {
                  try {
                    return (await $.ui.blit({ requestId: picture.requestId, key: tileKey(picture, tile), source: { png: tile.png } })).deny
                  } catch (error) {
                    return String(error)
                  }
                }),
              )
              const deny = denies.find(one => one !== undefined)
              if (deny === undefined) {
                picture.refusedSince = undefined
                return
              }
              // A tile refused may show an old frame: it again next time.
              refusedTiles(tiles.filter((_, index) => denies[index] !== undefined))
              picture.refusedSince ??= now
              if (drawsAlt(deny)) noPictures($, picture.surface, deny)
              else if (/mount/i.test(deny) && picture.fresh === 0) pictures.delete(site)
              else if (now - picture.refusedSince >= PICTURE_GIVE_UP_MS) noPictures($, picture.surface, deny)
            })(),
          )
        }
        workAhead([...pictures.values()].map(picture => picture.stage))
        for (const [site, giant] of giantPictures) {
          giant.ms += IMAGE_FRAME_MS
          const frame = giantFrameOf(giant)
          if (frame.key === giant.shown) continue
          giant.shown = frame.key
          const png = giantPng(giant, frame)
          swaps.push(
            (async () => {
              let deny: string | undefined
              try {
                deny = (await $.ui.blit({ requestId: giant.requestId, key: giant.key, source: { png } })).deny
              } catch (error) {
                deny = String(error)
              }
              if (deny === undefined) return
              if (drawsAlt(deny)) noPictures($, giant.surface, deny)
              else giantPictures.delete(site)
            })(),
          )
        }
        await Promise.all(swaps)
        // Nothing to draw: no pictures, or only scenes held paused (their next drawing starts the timer again).
        const live = giantPictures.size > 0 || [...pictures.values()].some(picture => picture.stage.world.props.paused !== true)
        if (!live && pictureTimer === mine) stopPictures()
      } finally {
        pictureBusy = false
      }
    })
  })
  pictureTimer = mine
}

/** A colour as a picture draws it in `scheme`: a theme key's colour there, a raw one as it is. */
const rawColour = (colour: string, scheme: 'dark' | 'light'): string => (isThemeKey(colour) ? SCENE_THEMES[scheme][colour] : colour)

const schemeFor = async ($: EngineInterface, now: number): Promise<'dark' | 'light'> => {
  if (pictureScheme !== undefined && now - pictureScheme.at < 10_000) return pictureScheme.scheme
  const theme = (await attempt(() => $.config.list()))?.find(row => row.key === 'theme')?.value
  const scheme = typeof theme === 'string' && theme.startsWith('light') ? 'light' : 'dark'
  pictureScheme = { scheme, at: now }

  return scheme
}

/**
 * Whether the terminal shows pictures, read once a load off its environment:
 * kitty's and Ghostty's own variables (the terminals the engine draws an
 * `Image` in); never under tmux, which passes none through. Anything else
 * draws the blocks with no picture tried, and so no blank alt first.
 */
let picturesHere: boolean | undefined

const terminalShowsPictures = async ($: EngineInterface): Promise<boolean> => {
  if (picturesHere !== undefined) return picturesHere
  const term = (await attempt(() => $.env.get('TERM'))) ?? ''
  const program = (await attempt(() => $.env.get('TERM_PROGRAM'))) ?? ''
  const kitty = await attempt(() => $.env.get('KITTY_WINDOW_ID'))
  const ghostty = await attempt(() => $.env.get('GHOSTTY_RESOURCES_DIR'))
  const tmux = await attempt(() => $.env.get('TMUX'))
  picturesHere = tmux === undefined && (/kitty|ghostty/i.test(`${term} ${program}`) || kitty !== undefined || ghostty !== undefined)

  return picturesHere
}

/** An `Image` is 1 to 255 cells either way. */
const PICTURE_MOST = 255

/** Whether a region of `columns` by `rows` is a picture on this surface: the vector art, a terminal that shows pictures (`terminalShowsPictures`) whose table has `Image`, not refused there, the region no bigger than an `Image` is. */
const picturedOn = async ($: EngineInterface, settings: Settings, surface: string, table: object, columns: number, rows: number): Promise<boolean> =>
  settings.mascotArt === 'vector' && surface === 'terminal' && 'Image' in table && 'Client' in table && !pictureless.has(surface)
  && columns >= 1 && rows >= 1 && columns <= PICTURE_MOST && rows <= PICTURE_MOST
  && (await terminalShowsPictures($))

/** A picture's stage handed the props while it is not drawn (paused while inspecting): it keeps its world for when it is back, and no refusal from before, which says nothing of the drawing it comes back in. */
const holdPicture = (requestId: string, surface: string, inputs: SceneInputs): void => {
  const picture = pictures.get(`${requestId}:${surface}`)
  if (picture === undefined) return
  restage(picture.stage, { ...inputs, paused: true })
  picture.refusedSince = undefined
}

/**
 * The scene as a picture at `requestId`, `columns` by `rows` cells: its
 * stage made or handed the props, its last frame the Image's source, and
 * over it the hit layer under `key` (the key the scene's own `Client` takes,
 * so a click asks to inspect as from it); the timer swapping frames in.
 */
const pictureOf = async (
  $: EngineInterface,
  table: object,
  surface: string,
  requestId: string,
  key: string,
  inputs: SceneInputs,
  now: number,
): Promise<RenderElement> => {
  const scheme = await schemeFor($, now)
  const site = `${requestId}:${surface}`
  let picture = pictures.get(site)
  if (picture === undefined) {
    picture = { stage: createStage(inputs), requestId, surface, key: `${key}:picture`, fresh: PICTURE_FRESH }
    pictures.set(site, picture)
  } else {
    restage(picture.stage, inputs)
    picture.fresh = PICTURE_FRESH
  }
  const tiles = stageTiles(picture.stage, scheme)
  startPictures($)
  const { columns, rows } = inputs
  const { Box, Image, Client } = table as {
    Box: (props: Record<string, unknown>) => RenderElement
    Image: (props: ImageProps) => RenderElement
    Client: (props: { key: string; module: string; props?: unknown; width?: number; height?: number }) => RenderElement
  }

  const rowsOfTiles = [...new Set(tiles.map(tile => tile.y))].map(y => tiles.filter(tile => tile.y === y))

  return (
    <Box key={`${key}:stage`} width={columns} height={rows} flexShrink={0} flexDirection="column">
      {rowsOfTiles.map(row => (
        <Box key={`${picture.key}:row:${row[0]?.y ?? 0}`} flexDirection="row" height={row[0]?.rows ?? 1} flexShrink={0}>
          {row.map(tile => (
            <Image key={tileKey(picture, tile)} source={{ png: tile.png }} columns={tile.columns} rows={tile.rows} alt=" " />
          ))}
        </Box>
      ))}
      <Box position="absolute" top={0} left={0} width={columns} height={rows}>
        <Client key={key} module="./scene-hit.tsx" props={{ columns, rows }} width={columns} height={rows} />
      </Box>
    </Box>
  )
}

/**
 * The TV's giant as a picture at `requestId`, over its box in the TV's
 * region, under the module's glass: drawn afresh for another who, place or
 * scheme, eyes open (shut a moment as it blinks); the timer swapping the
 * blinks in.
 */
const giantPictureOf = async ($: EngineInterface, table: object, surface: string, requestId: string, layout: TvLayout, who: Who, now: number): Promise<RenderElement> => {
  const scheme = await schemeFor($, now)
  const site = `${requestId}:${surface}`
  const drawn = JSON.stringify([who, layout, scheme])
  let giant = giantPictures.get(site)
  if (giant === undefined || giant.drawn !== drawn) {
    const draw = (eyes: 'open' | 'shut', blade: number): string => giantPicture(who, layout, eyes, scheme, blade)
    // Its clock starts past a blink: the first comes a few seconds on.
    giant = { requestId, surface, key: `${TV_KEY}:giant`, drawn, frames: new Map(), shown: '', turns: who.cap === true, ms: Math.max(BLINK_MS, IMAGE_FRAME_MS), draw }
    giantPictures.set(site, giant)
  }
  // The frame its clock is at, the one the timer then swaps on from.
  const frame = giantFrameOf(giant)
  giant.shown = frame.key
  const shown = giantPng(giant, frame)
  startPictures($)
  const { Box, Image } = table as { Box: (props: Record<string, unknown>) => RenderElement; Image: (props: ImageProps) => RenderElement }

  return (
    <Box key="tv-giant" position="absolute" top={layout.top} left={layout.left} width={layout.width} height={layout.height}>
      <Image key={giant.key} source={{ png: shown }} columns={layout.width} rows={layout.height} alt=" " />
    </Box>
  )
}

/** The hit layer's events at `requestId` played on its picture's world; what that asks (a click's inspect), as the scene's `Client` would have posted it. */
const pictureHits = (requestId: string, surface: string, post: HitPost): JsonValue[] => {
  const picture = pictures.get(`${requestId}:${surface}`)
  if (picture === undefined) return []
  const asks: JsonValue[] = []
  stageHits(picture.stage, post, data => asks.push(data), hitSeqs)

  return asks
}

// The session's own mascot in its yard at the band's left (the `sessionMascot`
// option), and beside it what tidying up has to say (hooks/tidy.ts): the offer,
// the `auto` countdown, a compaction of the main conversation running, its
// result. The band's scene is the pane's own, cast with the session's mascot
// alone; the pane's scene then leaves it out, on each surface the band last
// drew it on (elsewhere, VS Code and mobile, which draw no band, it stays).

// The band's scene `Client`: its key, which a click's `ui.message` names.
const BAND_KEY = 'session'
// The yard is the band's width, less what tidying up has to say beside it, but never under YARD_COLUMNS.
const YARD_COLUMNS = 28
const TIDY_COLUMNS = 48
// With the scenery, a row more of sky, where the band has the room.
const BAND_ROWS = GRID_ROWS + 1
// On which surfaces the band last drew the session's mascot, and where its `Client` failed (the classic scene there).
const bandMascot = new Map<string, boolean>()
const bandFaulted = new Set<string>()
// The band's one-second clock and the `auto` countdown's timer.
let bandTimer: Timer | undefined
let countdownTimer: Timer | undefined
// Whether this module's `session.compact` hook saw the main conversation's compaction since `tidyNow` cleared it.
let compactSeen = false

const stopBandClock = (): void => {
  bandTimer?.cancel()
  bandTimer = undefined
}

const stopCountdown = (): void => {
  countdownTimer?.cancel()
  countdownTimer = undefined
}

// The facts a tidy is judged on (TidyInputs): the option, the context, the main loop's and the offer's.
const tidyInputsOf = async ($: EngineInterface, settings: Settings, now: number): Promise<TidyInputs> => ({
  mode: settings.tidy,
  at: settings.tidyAt,
  tokens: (await read($, hudUsage)).contextTokens,
  main: (await attempt(() => read($, mainFacts))) ?? NO_MAIN,
  tidy: await read($, tidyFacts),
  model: (await read($, hudSession)).model,
  now,
})

// The band's one-second clock, started by the band's drawing: while it draws
// a tidy running, counting down or its result (or why it did not run), one
// write a second the band reads; the last once nothing timed is left, so a
// result that expired goes.
const startBandClock = ($: EngineInterface, settings: Settings): void => {
  if (bandTimer !== undefined) return
  const mine = $.clock.every(TICK_MS, () => {
    void quietly($, async () => {
      if (bandTimer !== mine) return
      const now = await $.clock.now()
      const shown = bandTidyOf(await tidyInputsOf($, settings, now))
      if (bandTimer !== mine) return
      if (shown === undefined || shown.kind === 'offer') stopBandClock()
      await update($, bandTick, () => now)
    })
  })
  bandTimer = mine
}

// Why a tidy the mod asked for did not run: the band says so a while.
const failTidy = async ($: EngineInterface, reason: string): Promise<void> => {
  const now = await $.clock.now()
  const text = printable(reason).slice(0, 160)
  await update($, tidyFacts, held => defined({ ...held, runningSince: undefined, countdownSince: undefined, failed: { at: now, reason: text === '' ? 'the engine refused it' : text } }))
}

// A compaction of the main conversation starting (any trigger but `precompute`): one write; the mascot tidies up and the band says so.
const tidyStarted = async ($: EngineInterface): Promise<void> => {
  const now = await $.clock.now()
  stopCountdown()
  const held = await read($, tidyFacts)
  if (held.runningSince === undefined) await update($, tidyFacts, one => defined({ ...one, runningSince: now, countdownSince: undefined, failed: undefined }))
}

// It did not run (vetoed, or it threw): the mascot stops.
const tidyStopped = async ($: EngineInterface): Promise<void> => {
  if ((await read($, tidyFacts)).runningSince !== undefined) await update($, tidyFacts, held => defined({ ...held, runningSince: undefined }))
}

// It stood: counted, the session's mascot stretches (with mascots on), the
// band shows its size before and after (one write), and the offer starts over.
const compacted = async (
  $: EngineInterface,
  settings: Settings,
  trigger: HudTidied['trigger'],
  before: number | undefined,
  result: { tokensBefore?: number; tokensAfter?: number },
): Promise<void> => {
  await quietly($, async () => {
    await reviseUsage($, afterCompaction)
    await refreshStatus($, settings)
  })
  if (settings.mascots) await quietly($, async () => {
    const now = await $.clock.now()
    await reviseMain($, held => ({ ...held, compactedAt: now }))
  })
  await quietly($, async () => {
    const now = await $.clock.now()
    const last = defined<HudTidied>({ at: now, trigger, before: result.tokensBefore ?? before, after: result.tokensAfter })
    await update($, tidyFacts, () => ({ last }))
  })
}

// Tidy up now: the call `/compact` makes, told to keep the plan and the
// todos. Where the engine runs it past this module's own `session.compact`
// hook, the hook's bookkeeping is done here.
const tidyNow = async ($: EngineInterface, settings: Settings): Promise<void> => {
  stopCountdown()
  const before = (await read($, hudUsage)).contextTokens
  compactSeen = false
  await tidyStarted($)
  let result: Awaited<ReturnType<EngineInterface['session']['compact']>>
  try {
    result = await $.session.compact({ instructions: TIDY_INSTRUCTIONS })
  } catch (error) {
    return failTidy($, error instanceof Error ? error.message : String(error))
  }
  if (result.skip !== undefined) return failTidy($, result.skip)
  if (!compactSeen) await compacted($, settings, 'plugin', before, result)
}

// A load (or a session's end) mid-way: no compaction this module saw start is
// running any more as far as it knows, and no countdown's timer survived.
const tidyTimersGone = async ($: EngineInterface): Promise<void> => {
  const held = await read($, tidyFacts)
  if (held.runningSince !== undefined || held.countdownSince !== undefined) await update($, tidyFacts, one => defined({ ...one, runningSince: undefined, countdownSince: undefined }))
}

// Not now: the offer (or the countdown) goes until the context holds TIDY_AGAIN tokens more.
const dismissTidy = ($: EngineInterface): Promise<void> =>
  quietly($, async () => {
    stopCountdown()
    const tokens = (await read($, hudUsage)).contextTokens
    await update($, tidyFacts, held => defined({ ...held, countdownSince: undefined, dismissedAt: tokens ?? held.dismissedAt }))
  })

// `auto`: a main turn ended with a tidy due and no subagent running: the band
// counts down, then tidies up, unless the person said Not now or sent a
// prompt, a subagent started, or the tidy is no longer due.
const armCountdown = async ($: EngineInterface, settings: Settings): Promise<void> => {
  if (settings.tidy !== 'auto') return
  const now = await $.clock.now()
  if (!isTidyDue(await tidyInputsOf($, settings, now))) return
  if (Object.values(await read($, agents)).some(isRunning)) return
  await update($, tidyFacts, held => defined({ ...held, countdownSince: now, failed: undefined }))
  stopCountdown()
  const mine = $.clock.after(TIDY_COUNTDOWN_MS, () => {
    void quietly($, async () => {
      if (countdownTimer !== mine) return
      countdownTimer = undefined
      const inputs = await tidyInputsOf($, settings, await $.clock.now())
      if (inputs.tidy.countdownSince !== now) return
      if (!isTidyDue(inputs) || Object.values(await read($, agents)).some(isRunning)) {
        await update($, tidyFacts, held => defined({ ...held, countdownSince: undefined }))
        return
      }
      await tidyNow($, settings)
    })
  })
  countdownTimer = mine
}

// What the session's mascot reads of the HUD's facts: who, the context, the tool running.
const bandHudOf = async ($: EngineInterface, settings: Settings, now: number): Promise<HudData> =>
  assembleHudData({
    session: await read($, hudSession),
    usage: await read($, hudUsage),
    git: NO_FACTS.git,
    tools: await read($, hudTools),
    todos: NO_FACTS.todos,
    inventory: NO_FACTS.inventory,
  }, now, settings.cacheTtl)

// The band drew the session's mascot on a surface, or stopped: the pane's scene there leaves it out, or takes it back.
const noteBandMascot = ($: EngineInterface, surface: string, drawn: boolean): void => {
  if ((bandMascot.get(surface) ?? false) === drawn) return
  bandMascot.set(surface, drawn)
  $.clock.after(0, () => $.ui.invalidate('ui.render'))
}

// The session's mascot in its yard, `columns` across and a mascot's rows high:
// the smooth scene's `Client` where the surface has one, else the classic
// scene on the scene clock. Undefined where it does not fit.
const bandYard = async (
  $: EngineInterface,
  settings: Settings,
  surface: string,
  requestId: string,
  table: ReturnType<EngineInterface['ui']['resolve']>,
  columns: number,
  rows: number,
  now: number,
): Promise<RenderElement | undefined> => {
  const all = await read($, agents)
  const list = Object.values(all)
  const workflow = settings.showWorkflows ? workflowOf(await read($, shadows), all, now) : []
  const hud = await bandHudOf($, settings, now)
  const main = (await attempt(() => read($, mainFacts))) ?? NO_MAIN
  const tidyingSince = (await read($, tidyFacts)).runningSince
  const svg = surface === 'desktop' && 'Svg' in table ? table.Svg : undefined
  if (settings.motion === 'smooth' && 'Client' in table && !bandFaulted.has(surface)) {
    const props: SceneInputs = sceneInputsOf(list, workflow, hud, {
      now,
      columns,
      rows,
      main,
      events: [],
      stalledMs: settings.stalledMs,
      wander: settings.wander,
      scenes: settings.scenes,
      collisions: settings.collisions,
      inspect: settings.inspect,
      only: 'main',
      ...(tidyingSince === undefined ? {} : { tidyingSince }),
      ...(svg === undefined ? {} : { svg: true as const }),
      ...(settings.mascotArt === 'vector' ? { art: 'vector' as const } : {}),
      ...(settings.mascotArt === 'vector' && settings.scenery ? { scenery: settings.daylight } : {}),
      ...(settings.character === 'usagi' ? { character: 'usagi' as const } : {}),
    })
    // A terminal that shows pictures: the vector art as one, swapped frame by frame.
    if (await picturedOn($, settings, surface, table, props.columns, props.rows)) return pictureOf($, table, surface, requestId, BAND_KEY, props, now)
    const { Client } = table as { Client: (props: { key: string; module: string; props?: unknown; width?: number; height?: number }) => RenderElement }

    return <Client key={BAND_KEY} module="./scene-client.tsx" props={props} width={columns} height={rows} />
  }
  const key = `${BAND_SCENE}${surface}`
  const frame = await read($, sceneTick)
  const mascots = sceneOf(list, hud, now, { stalledMs: settings.stalledMs, main, shadows: workflow, scenes: settings.scenes, character: settings.character, only: 'main', ...(tidyingSince === undefined ? {} : { tidyingSince }) })
  const room = { columns, rows, tick: Math.max(frame, Math.floor(now / SCENE_FRAME_MS)), wander: settings.wander, scenes: settings.scenes, collisions: settings.collisions }
  const plan = mascotPlan(mascots, room, scenePlans.get(key))
  if (plan === undefined) {
    scenePlans.delete(key)
    sceneRendered.delete(key)
    return undefined
  }
  scenePlans.set(key, plan)
  sceneRendered.set(key, now)
  startSceneClock($)
  const { Box, Text } = table

  return svg === undefined ? renderMascots({ Box, Text }, mascots, room, plan) : renderMascotsSvg({ Box, Svg: svg }, mascots, room, plan)
}

// Serves `/mod-hud`: toggles the pane, `clear` drops finished agents, and
// `facts` shows what the HUD draws from.
const runBoard = async ($: EngineInterface, args: string, settings: Settings): Promise<{ text: string }> => {
  const argument = args.trim()
  if (argument === 'facts') return { text: await factsText($, settings) }
  if (argument === 'clear') {
    stopTicking()
    const now = await $.clock.now()
    const all = await read($, agents)
    const dropped = Object.values(all).filter(entry => !isRunning(entry)).map(entry => entry.id)
    await update($, dismissed, ids => [...new Set([...ids, ...dropped])])
    const written = await update($, agents, current =>
      Object.fromEntries(Object.entries(current).filter(([, entry]) => isRunning(entry))),
    )
    await showStatus($, settings, written, now)
    await startIfNeeded($, settings)
    await quietly($, () => pruneTrails($, settings))

    return { text: `Dropped ${dropped.length} finished ${dropped.length === 1 ? 'agent' : 'agents'} from the board.` }
  }
  if (argument !== '') return { text: 'Usage: /mod-hud [clear|facts]' }

  const pane = (await $.ui.panes()).find(one => one.id === PANE)
  if (pane?.isPlaced && pane.isShown) {
    try {
      await $.ui.close({ id: PANE })
    } catch {
      return { text: 'HUD is still open.' }
    }
    if ((await $.ui.panes()).some(one => one.id === PANE)) return { text: 'HUD is still open.' }

    return { text: 'HUD closed.' }
  }

  const opened = await $.ui.open({
    id: PANE,
    title: 'HUD',
    columns: 72,
    rows: 16,
    focus: pane?.isPlaced && !pane.isShown ? true : undefined,
  })
  if (!opened.isPlaced) return { text: `HUD is waiting: ${opened.reason}` }

  startTicking($, settings)

  return { text: 'HUD opened.' }
}

// A scene's post (its `Client`'s, or a picture's world's): a click asking to inspect a mascot.
const askedOf = async ($: EngineInterface, settings: Settings, component: string, element: string, data: unknown): Promise<void> => {
  const ask = inspectAsk(data)
  if (settings.inspect && settings.mascots && element === SCENE_KEY && ask !== undefined) {
    const asked = ask.id
    tvFrom = ask.at === undefined ? undefined : { id: asked, ...ask.at, ...(ask.cap === true ? { cap: true as const } : {}) }
    await quietly($, async () => {
      // The crowned mascot is the session's own.
      if (asked === 'main') return selectAgent($, { id: 'main', kind: 'main' })
      const board = await read($, agents)
      const held = board[asked] === undefined && settings.showWorkflows ? (await read($, shadows))[asked] : undefined
      if (board[asked] !== undefined) await selectAgent($, { id: asked, kind: 'agent' })
      else if (held !== undefined) await selectAgent($, { id: asked, kind: 'shadow' })
    })
  }
  // A click on the session's mascot in the band: the HUD opens (where it is
  // not) on the session's own inspect view.
  if (settings.inspect && component === 'AbovePrompt' && element === BAND_KEY && ask?.id === 'main') {
    tvFrom = undefined
    await quietly($, async () => {
      const pane = (await $.ui.panes()).find(one => one.id === PANE)
      if (!(pane?.isPlaced === true && pane.isShown)) {
        const opened = await $.ui.open({ id: PANE, title: 'HUD', columns: 72, rows: 16, ...(pane?.isPlaced === true ? { focus: true } : {}) })
        if (opened.isPlaced) startTicking($, settings)
      }
      await selectAgent($, { id: 'main', kind: 'main' })
    })
  }
}

export const register: Register = (on, options) => {
  const settings = settingsOf(options)

  // A reload starts this module afresh; a registration in a context that
  // already ran one drops what that left running.
  stopTicking()
  stopSceneClock()
  stopPictures()
  pictures.clear()
  giantPictures.clear()
  tvGiants.clear()
  picturesHere = undefined
  stopStatusTimer()
  stopBandClock()
  stopCountdown()
  resetHud()
  listedIds = new Set()
  bandMascot.clear()
  bandFaulted.clear()
  compactSeen = false

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: TWIN,
        description: 'Show or hide the HUD (session, context, limits, cost, git, tools, todos, and every subagent)',
        argumentHint: 'clear|facts',
        immediate: true,
      })
    } catch (error) {
      $.ui.log(`mod-hud: /${TWIN} was not registered: ${String(error)}`, { to: 'debug' })
    }

    await quietly($, async () => {
      const now = await $.clock.now()
      const all = await reconcile($, settings, now)
      if (all === undefined) return
      // What expired while nothing ran, or before a reload, goes now.
      await pruneShadows($, settings, all, now)
      await pruneTrails($, settings)
      const text = await statusTextOf($, settings, all, now)
      await $.state.set(STATUS_TEXT, text)
      $.ui.status(text ?? undefined)
      await startIfNeeded($, settings)
    })
    await quietly($, () => startHud($, settings, e.cwd))
    await quietly($, () => refreshStatus($, settings))
    await quietly($, () => tidyTimersGone($))

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.deny === undefined && spawned.agentId !== undefined) {
      const id = spawned.agentId
      await quietly($, async () => {
        const now = await $.clock.now()
        const written = await update($, agents, all => ({
          ...all,
          [id]: defined<AgentBoardEntry>({
            id,
            toolUseId: e.tool_use_id,
            parentId: e.parentAgentId,
            type: printable(e.subagentType),
            model: spawned.model,
            description: printable(e.description),
            name: e.name === undefined ? undefined : printable(e.name),
            background: e.background,
            startedAt: now,
            lastActivityAt: now,
            status: 'running',
            toolCalls: 0,
          }),
        }))
        // A first step that raced its spawn was taken for a workflow agent's.
        if (settings.showWorkflows) await reviseShadows($, held => shadowsPruned(held, now, one => one === id))
        await showStatus($, settings, written, now)
        await startIfNeeded($, settings)
      })
    }

    return spawned
  })

  // A known subagent's call is its activity and its current tool; a call in a
  // loop no list names is a workflow agent's, kept beside the board; a
  // main-loop call is the HUD's current tool and counts. Once it ends these
  // clear, a main-loop TodoWrite's list is kept, a tool that may have changed
  // the tree (any loop's) asks for a git reading, and an Agent result settles
  // its entry.
  on('tool.call', async ($, e, next) => {
    const name = String(e.tool)
    const label = short(name)
    const loop = e.agentId
    const isKnown = loop !== undefined && (await boardCallStarted($, settings, loop, label))
    const workflow = !isKnown && settings.showWorkflows && loop !== undefined && !listedIds.has(loop) ? loop : undefined
    if (workflow !== undefined) await quietly($, () => shadowCallStart($, settings, workflow, label))
    const trailAt = loop !== undefined && (isKnown || workflow !== undefined)
      ? await attempt(() => recordTrail($, settings, loop, label, e as unknown as Readonly<Record<string, unknown>>))
      : undefined
    if (name === 'SendMessage') await quietly($, () => noteMessage($, settings, loop, (e as { to?: unknown }).to))
    // A known subagent's call is tracked for its permission asks: the alert strip's and the mascot's raised hand alike.
    const callId = isKnown && typeof e.tool_use_id === 'string' ? e.tool_use_id : undefined
    if (callId !== undefined && loop !== undefined) await trackCall($, callId, loop)
    if (loop === undefined && settings.showTools) {
      await quietly($, async () => {
        const now = await $.clock.now()
        // The call's main argument (a path, a command, a pattern) rides with it, for the `now` row.
        const arg = mainArgOf(e as unknown as Readonly<Record<string, unknown>>)
        await update($, hudTools, held => toolStarted(held, label, e.tool_use_id, now, arg))
      })
    }

    let ran: ToolCallResult | undefined
    try {
      ran = await next(e)
    } finally {
      if (callId !== undefined) forgetCall(callId)
      if (isKnown) await boardCallEnded($, loop, label)
      if (workflow !== undefined) await quietly($, () => shadowCallEnd($, settings, workflow, label))
      const outcome = ran
      // Its trail step ends; a call denied or failed, in any loop, counts.
      const ended = outcomeOf(outcome)
      if (trailAt !== undefined && loop !== undefined) await quietly($, () => endTrail($, loop, label, trailAt, ended))
      // The status line's `⚠` counts it: redrawn now (nothing else may redraw it), and its timer re-armed for when it expires.
      if (settings.inspect && ended !== 'ok') await quietly($, async () => {
        const now = await $.clock.now()
        await reviseLedger($, held => ledgerFailed(held, ended, now))
        await refreshStatus($, settings)
      })
      await quietly($, async () => {
        const isDone = outcome !== undefined && outcome.deny === undefined && outcome.isError !== true
        // A main-loop edit that ended ok counts its file, in the same write that settles the call.
        const edited = loop === undefined && isDone ? editedPathOf(name, e as unknown as Readonly<Record<string, unknown>>) : undefined
        // The files edited are the Session tab's Overview's: counted whatever `showTools` says.
        if (loop === undefined && (settings.showTools || edited !== undefined)) {
          await reviseTools($, held => {
            const settled = settings.showTools ? toolSettled(held, label, e.tool_use_id) : held

            return edited === undefined ? settled : fileEdited(settled, edited)
          })
        }
        if (settings.showTodos && loop === undefined && isDone && e.tool === 'TodoWrite') {
          const items = parseTodos(e.todos)
          if (items !== undefined) {
            const now = await $.clock.now()
            await reviseTodos($, held => todoFactsOf(held, items, now))
            await refreshStatus($, settings)
          }
        }
        if (GIT_TOOLS.has(name) && outcome?.deny === undefined) await requestGit($, settings)
      })
    }

    if (name === 'Agent') await settleAgentCall($, settings, ran)

    return ran
  })

  // Only a lingering ask marks its agent waiting (the alert strip's count, and
  // with mascots on a raised hand), whatever the options; the verdict passes
  // through untouched.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    await quietly($, async () => {
      const callId = e.tool_use_id
      const loop = callId === undefined ? undefined : subagentCalls.get(callId)
      if (callId !== undefined && loop !== undefined && verdict?.decision === 'ask') markAsking($, callId, loop)
    })

    return verdict
  })

  // A prompt sent: the `auto` countdown stops at once, before the turn it starts is under way.
  on('prompt.submit', async ($, e, next) => {
    if (countdownTimer !== undefined) {
      stopCountdown()
      await quietly($, async () => {
        if ((await read($, tidyFacts)).countdownSince !== undefined) await update($, tidyFacts, held => defined({ ...held, countdownSince: undefined }))
      })
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) {
      await quietly($, async () => {
        if ((await read($, agents))[id] === undefined) {
          // A workflow agent's run ending; nothing for a loop never seen.
          if (settings.showWorkflows) await shadowTurnEnded($, settings, id, e.reason)
          return
        }
        const now = await $.clock.now()
        const written = await patch($, id, entry => ({
          ...entry,
          status: e.reason === 'answer' ? 'done' : 'failed',
          outcome: e.reason,
          endedAt: now,
          lastActivityAt: now,
          summary: firstLine(e.answer) ?? entry.summary,
          currentTool: undefined,
        }))
        await showStatus($, settings, await prune($, settings, written), now)
        if (settings.inspect && (await read($, selected))?.id === id) await fetchDetail($, id)
      })
      // The loop's run ended in the ledger (a subagent's, a workflow agent's or a fork's).
      if (settings.inspect) await quietly($, async () => {
        const now = await $.clock.now()
        await reviseLedger($, held => ledgerEnded(held, id, e.reason, now))
      })
    }
    // The header's working/idle cell (and the session's mascot) read it: kept whatever the options.
    if (id === undefined && mainBusy !== false) await quietly($, () => markMainIdle($))
    // One more turn for the Session tab, its time busy and the context's size: in one usage write.
    // With the usage section's last turn and the context's runway, kept whatever the options.
    if (id === undefined) await quietly($, () => reviseUsage($, held => afterMainTurn(held, e.durationMs)))
    // `tidy: auto`: a tidy due counts down in the band once the main loop is idle.
    if (id === undefined) await quietly($, () => armCountdown($, settings))
    // The main loop's end leaves no tool current and asks for a git reading
    // and, when due, the inventory.
    await quietly($, async () => {
      if (id !== undefined) return
      if (settings.showTools) await reviseTools($, noCurrentTool)
      await requestGit($, settings)
      await requestInventory($)
    })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    lastMeasureLimits = Array.isArray(e.rateLimits) ? [...e.rateLimits] : []
    await quietly($, async () => {
      const now = await $.clock.now()
      await reviseUsage($, held => applyMeasure(held, e, now))
      // What its rate limits say of the login firms up the automatic cache TTL.
      await reviseSession($, held => defined({ ...held, account: accountAfter(held.account, e) }))
      await refreshStatus($, settings)
    })

    return next(e)
  })

  // The main loop's model and effort, as each request names them; a request
  // in a loop no list names is a workflow agent's step. Both are written once,
  // before the request goes: the chunks then stream through untouched.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      if (mainBusy !== true) await quietly($, () => markMainBusy($))
      const effort = effortOf(e.effort)
      const step = `${e.model}\n${effort ?? ''}`
      if (step !== lastStep) {
        await quietly($, async () => {
          await reviseSession($, held => defined({ ...held, model: e.model, effort }))
          lastStep = step
          await refreshStatus($, settings)
        })
      }
    } else {
      const id = e.agentId
      const effort = effortOf(e.effort)
      if (settings.showWorkflows) await quietly($, () => shadowStep($, settings, id, e.model, effort))
      // A board agent's effort (and a model its spawn did not name), as its requests name them: written only when they change.
      await quietly($, async () => {
        const entry = (await read($, agents))[id]
        if (entry === undefined || (entry.effort === effort && entry.model !== undefined)) return
        await patch($, id, one => defined({ ...one, effort, model: one.model ?? e.model }))
      })
    }
    // The prompt cache's clock runs from when the main request is sent: the
    // API reads and refreshes (or writes) the cached prefix as it starts on the
    // request, not when the response has streamed out. This is the last point
    // the hooks see before that; it errs early, so the countdown never
    // overstates the time left.
    const sentAt = e.agentId === undefined ? await attempt(() => $.clock.now()) : undefined
    const result = yield* next(e)
    // What the request read, wrote and cached, whichever loop made it: the
    // session's tokens, and the ledger's for that loop and model.
    const spent = result.usage
    if (spent !== null && spent !== undefined) {
      // A main request restarts the prompt cache's clock, in the same write.
      await quietly($, async () => {
        const at = e.agentId === undefined ? (sentAt ?? await $.clock.now()) : undefined
        await reviseUsage($, held => addTokens(held, spent, at))
      })
      if (settings.inspect) await quietly($, async () => {
        const who = await ledgerWhoOf($, settings, e.agentId)
        const now = await $.clock.now()
        await reviseLedger($, held => ledgerBooked(held, e.agentId ?? 'main', spent, who, now))
      })
    }

    return result
  })

  // A main-loop compaction: the session's mascot tidies up while it runs; one
  // that took place counts, and the band shows its size before and after.
  // `precompute` installs nothing; a subagent's own is its own.
  on('session.compact', async ($, e, next) => {
    const trigger = e.trigger === 'precompute' ? undefined : e.trigger
    const mine = e.agentId === undefined && trigger !== undefined
    const before = mine ? await attempt(async () => (await read($, hudUsage)).contextTokens) : undefined
    if (mine) {
      compactSeen = true
      await quietly($, () => tidyStarted($))
    }
    let result: Awaited<ReturnType<typeof next>> | undefined
    try {
      result = await next(e)
    } finally {
      if (mine && result?.messages === undefined) await quietly($, () => tidyStopped($))
    }
    // Summarizer forks emit turn.step with their own agentId: book there only.
    if (mine && result.messages !== undefined) await compacted($, settings, trigger, before, result)

    return result
  })

  on('session.append', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) {
      await quietly($, async () => {
        const entry = (await read($, agents))[id]
        if (entry === undefined) return
        const now = await $.clock.now()
        if (now - entry.lastActivityAt > ACTIVITY_THROTTLE_MS) {
          await patch($, id, one => ({ ...one, lastActivityAt: now }))
        }
      })
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    stopSceneClock()
    stopCountdown()
    stopBandClock()
    // The pictures' worlds end with their session; the next drawing starts them afresh.
    stopPictures()
    pictures.clear()
    giantPictures.clear()
    tvGiants.clear()
    await quietly($, () => tidyTimersGone($))
    sceneEvents = []
    // Nothing selected, read or trailed outlives its session.
    await quietly($, async () => {
      if ((await read($, selected)) !== null) await update($, selected, () => null)
      if ((await read($, detail)) !== null) await update($, detail, () => null)
      if (Object.keys(await read($, trails)).length > 0) await update($, trails, () => ({}))
    })
    // Every end drops the workflow agents, first, so no status drawn after counts them.
    await quietly($, () => clearShadows($))
    const asking = [...new Set([...askingCalls].map(id => subagentCalls.get(id)).filter((id): id is string => id !== undefined))]
    clearCalls()
    if (e.reason !== 'clear') for (const loop of asking) await syncAsking($, loop)
    if (e.reason === 'clear') {
      mainBusy = undefined
      stopTicking()
      // Reset the board before spending any of the end-hook budget on the HUD.
      await quietly($, async () => {
        const ids = Object.keys(await read($, agents))
        await update($, dismissed, hidden => [...new Set([...hidden, ...ids])])
        await update($, seeded, () => true)
        await update($, agents, () => ({}))
        await showStatus($, settings, {}, await $.clock.now())
        await startIfNeeded($, settings)
      })
      await quietly($, () => reviseMain($, () => NO_MAIN))
      // The offer to tidy starts over with the conversation.
      await quietly($, async () => {
        if (!sameFacts(await read($, tidyFacts), NO_TIDY)) await update($, tidyFacts, () => NO_TIDY)
      })
      // The spend split starts over with the conversation; the lists' expansion stays.
      await quietly($, async () => {
        if (!sameFacts(await read($, ledger), NO_LEDGER)) await update($, ledger, () => NO_LEDGER)
      })
      await quietly($, () => clearHud($, settings))
      await quietly($, () => refreshStatus($, settings))
    }

    return next(e)
  })

  on('command.run', { command: TWIN }, ($, e) => runBoard($, e.args, settings))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined && !(await $.ui.panes()).some(pane => pane.id === PANE)) {
      dropPaneScenes()
      dropPanePictures()
      stopTicking()
      if (Object.values(await read($, agents)).some(isRunning) || (await workflowHeld($, settings))) startTicking($, settings)
    }

    return result
  })

  // A click on a mascot in the smooth scene: its surface module asks to inspect
  // that agent, and the selection (the hooks') follows, as a row's button does.
  on('ui.message', async ($, e, next) => {
    // A picture's hit layer: its pointer played on the picture's world; what that asks (a click's
    // inspect) read as the scene's `Client` posts it, the layer under the same key.
    const hits = e.module === HIT_MODULE ? hitsOf(e.data) : undefined
    if (hits !== undefined) {
      for (const data of pictureHits(e.requestId, e.surface, hits)) await askedOf($, settings, e.component, e.element, data)

      return next(e)
    }
    await askedOf($, settings, e.component, e.element, e.data)
    // The TV: closed (its mascot home, shaken), a channel, a press on its glass, or its mascot grown
    // into the giant or shrinking out of it (where pictures are drawn, the giant one under its glass).
    const tv = e.element === TV_KEY ? tvPostOf(e.data) : undefined
    if (tv !== undefined) {
      await quietly($, async () => {
        if ('close' in tv) {
          const choice = await read($, selected)
          if (choice !== null) startled = { id: choice.id, at: await $.clock.now() }
          tvFrom = undefined
          tvGiants.delete(e.surface)
          await selectAgent($, null)
        } else if ('giant' in tv) {
          // Only for a TV up on that surface: one torn down meanwhile (its agent gone, the session cleared) leaves none behind.
          if (tv.giant && tvUp.has(e.surface)) tvGiants.add(e.surface)
          else tvGiants.delete(e.surface)
          if (e.surface === 'terminal' && picturesHere === true && !pictureless.has(e.surface)) $.ui.invalidate('ui.render')
        } else if ('tab' in tv) {
          const tab = HUD_TABS.find(one => one === tv.tab)
          if (tab !== undefined) await selectTab($, tab)
        } else {
          tvPresses.get(e.surface)?.get(tv.press)?.()
        }
      })
    }

    return next(e)
  })

  // While the TV is up, the pane's wheel and scroll keys move its glass instead of the pane under it.
  on('ui.scroll', { requestId: PANE }, ($, e, next) => {
    if (tvUp.size === 0 || e.origin.kind !== 'person') return next(e)
    tvWheel = { seq: tvWheel.seq + 1, by: e.by, ...(Math.abs(e.by) >= Math.max(2, e.bodyRows) ? { page: true as const } : {}) }
    $.ui.invalidate('ui.render')

    return { deny: 'the TV scrolls its own glass' }
  })

  // A TV that failed on a surface: the pane's own inspect view there from now
  // on; the band's scene that failed, the classic scene there.
  on('ui.fault', ($, e, next) => {
    // A picture's hit layer that failed: no pictures there, the scene's own `Client` instead.
    if (e.module === HIT_MODULE) {
      noPictures($, e.surface, e.reason)

      return next(e)
    }
    if (e.element === TV_KEY && !tvFaulted.has(e.surface)) {
      tvFaulted.add(e.surface)
      $.ui.invalidate('ui.render')
    }
    if (e.component === 'AbovePrompt' && e.element === BAND_KEY && !bandFaulted.has(e.surface)) {
      bandFaulted.add(e.surface)
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    // The desktop sets the pane's text in a proportional font, so it draws its
    // text and its scene in pixels: `Svg`s (hooks/text-svg.ts, hooks/scene-svg.ts).
    const svg = e.surface === 'desktop' && 'Svg' in table ? table.Svg : undefined
    // The timer's write redraws the clocks even when no agent changed.
    await read($, tick)
    const all = await read($, agents)
    const now = await $.clock.now()
    const list = Object.values(all)
    // The workflow agents shown, under the subagents; with the option off, never read.
    const workflow = settings.showWorkflows ? workflowOf(await read($, shadows), all, now) : []

    // A pane that was waiting undrawn (a narrow terminal) is drawn once seated:
    // start the timer then even when there are no agents.
    startTicking($, settings)

    const columns = e.props.bodyColumns
    const isNarrow = columns < NARROW_BELOW

    // The HUD heads the pane, one blank row above the agents; it takes
    // at most half the known rows, or five when the height is unknown. Reading its facts here redraws it when one is
    // written. A HUD that draws nothing, or cannot be read, leaves the agents alone.
    const bodyRows = e.props.scroll.bodyRows
    const layout = { columns, rows: bodyRows ?? 10, isNarrow }
    let hud: ReturnType<typeof renderHudBlock>['element']
    let hudData: HudData | undefined
    let hudRows = 0
    try {
      hudData = await hudDataOf($, settings, now)
      const drawn = renderHudBlock({ Box, Text, Svg: svg }, hudData, layout)
      hud = drawn.element
      hudRows = drawn.rowCount
    } catch {
      // A failed HUD reading or drawing must not hide the board.
    }

    // The TODO section, between the HUD and the agents: counted like the list.
    // Folded to its progress line until its `▸` is pressed (`listView.todosExpanded`).
    const view = await read($, listView)
    let todos: ReturnType<typeof renderTodos>['element']
    let todoRowCount = 0
    try {
      const drawn = renderTodos({ Box, Text, Svg: svg, Button }, hudData?.todos, {
        columns,
        max: settings.todoRows,
        expanded: view.todosExpanded === true,
        onToggle: () => void toggleTodos($),
      })
      todos = drawn.element
      todoRowCount = drawn.rowCount
    } catch {
      // A failed todo list leaves the rest.
    }

    // With an agent (or the session) selected, the inspect view takes the
    // pane under the HUD: its header, its tabs and the tab's rows, which the
    // pane scrolls. Each tab reads only the facts it draws.
    const choice = settings.inspect ? await read($, selected) : null
    const kindOf = (id: string): HudSelection['kind'] => (id === 'main' ? 'main' : all[id] === undefined ? 'shadow' : 'agent')
    const needsMain = settings.mascots || choice?.kind === 'main'
    const main = needsMain ? ((await attempt(() => read($, mainFacts))) ?? NO_MAIN) : NO_MAIN
    let inspecting: { rows: InspectRow[]; agentsTab: boolean } | undefined
    // The TV where the surface can draw it (a `Client`) and the pane has room: the inspected one's mascot, grown, over the pane.
    const tvRoom = choice !== null && settings.inspectView === 'tv' && (e.surface === 'terminal' || e.surface === 'desktop') && 'Client' in table && bodyRows !== undefined && !tvFaulted.has(e.surface)
      ? tvLayoutOf(settings.character, columns, bodyRows)
      : undefined
    let tvShow: { header: InspectHeader; tab: HudTab; body: InspectRow[] } | undefined
    if (choice !== null) {
      try {
        const usage = choice.kind === 'main' ? await read($, hudUsage) : undefined
        const who = inspectedOf(choice, all, workflow, hudData, main, usage?.turns, now, settings)
        if (who !== undefined) {
          const tab = tabOf(choice)
          // The tab's rows as wide as they show: the glass's text, or the pane.
          const width = tvRoom?.content ?? columns
          let body: InspectRow[] = []
          if (who.body !== undefined && tab !== 'agents') {
            const trail = tab === 'trail' ? ((await read($, trails))[choice.id] ?? []) : []
            const said = choice.kind === 'agent' && (tab === 'task' || tab === 'said') ? await read($, detail) : null
            const agentBody: AgentBody = { ...who.body, trail, ...(said !== null && said.id === choice.id ? { detail: said } : {}) }
            body = tab === 'task' ? taskRows(agentBody, width) : tab === 'trail' ? trailRows(agentBody, width, now) : saidRows(agentBody, width)
          } else if (usage !== undefined && tab === 'overview') {
            const held = settings.showWorkflows ? await read($, shadows) : {}
            // The files edited, from the facts: kept, and shown here, whatever `showTools` says.
            const edited = (await read($, hudTools)).edited?.length
            body = overviewRows(overviewOf(usage, main, await read($, ledger), hudData?.inventory?.compactAt, hudData?.session?.startedAt, all, held, now, edited === 0 ? undefined : edited), width)
          } else if (usage !== undefined && tab === 'cost') {
            const startedAt = hudData?.session?.startedAt
            body = costRows({ totalUsd: usage.costUsd, duration: startedAt === undefined ? undefined : now - startedAt, models: costTree(await read($, ledger)) }, width, new Set(view.models ?? []))
          }
          if (tvRoom !== undefined) tvShow = { header: who.header, tab, body }
          else inspecting = { rows: inspectRows(who.header, tabsOf(choice.kind), tab, body, columns), agentsTab: tab === 'agents' }
        }
      } catch {
        // A view that cannot be drawn leaves the lists and the scene.
      }
    }
    const onAction = (action: InspectAction): void => {
      if (action.kind === 'back') void selectAgent($, null)
      else if (action.kind === 'tab') void selectTab($, action.tab)
      else void toggleModel($, action.model)
    }
    // The lists: under the HUD, or in the Agents tab, where a press keeps that tab.
    const lists = renderLists({
      ui: { Box, Text, Button, Svg: svg },
      settings,
      all,
      list,
      workflow,
      now,
      columns,
      isNarrow,
      view,
      choice,
      onSelect: (id, kind) => void selectAgent($, inspecting?.agentsTab === true ? { id, kind, tab: 'agents' } : { id, kind }),
      onToggle: group => void toggleGroup($, group),
      onMinimise: group => void toggleMinimised($, group),
    })

    // The mascots stand in the rows the HUD and the list leave, one blank row
    // under the list; with fewer than four left, or an unknown height, none.
    // While inspecting, the smooth scene keeps its Client, paused at no height,
    // in the room the lists would leave. A scene that cannot be read or drawn
    // leaves the board alone.
    const listRows = (todos === undefined ? 0 : todoRowCount + 1) + lists.rows
    let scene: ReturnType<typeof renderMascots>
    // The smooth scene where the surface draws a `Client` (terminal, desktop):
    // its surface module runs the motion on its own frame clock and the hooks
    // only hand it the scene's inputs. Elsewhere (and with `motion: classic`)
    // the Box/Text scene on the hooks' 250 ms clock.
    const smooth = settings.motion === 'smooth' && (e.surface === 'terminal' || e.surface === 'desktop') && 'Client' in table
    // The inspected one's mascot is in the TV, out of the scene; one back from it is shaken a while.
    const away = tvRoom !== undefined && tvShow !== undefined && choice !== null ? choice.id : undefined
    if (startled !== undefined && now - startled.at >= STARTLED_MS) startled = undefined
    const shaken = startled !== undefined && startled.id !== away ? startled : undefined
    // The session's mascot lives in the band where the band last drew it on this surface: the pane's scene is the agents' alone.
    const agentsOnly = settings.sessionMascot === 'band' && bandMascot.get(e.surface) === true
    // Where it is in the pane, it tidies up there while a compaction runs.
    const tidyingSince = settings.mascots && !agentsOnly ? (await attempt(() => read($, tidyFacts)))?.runningSince : undefined
    let sceneTop: number | undefined
    if (settings.mascots && (smooth || inspecting === undefined)) {
      try {
        if (smooth) {
          const spare = bodyRows === undefined ? 0 : bodyRows - (hud === undefined ? 0 : hudRows + 1) - listRows - 1
          if (spare >= 4 && columns >= SLOT) {
            const props: SceneInputs = sceneInputsOf(list, workflow, hudData, {
              now,
              columns,
              rows: spare,
              main,
              events: sceneEvents.filter(one => Math.floor(now / SCENE_FRAME_MS) - one.tick < MESSAGE_TICKS),
              stalledMs: settings.stalledMs,
              wander: settings.wander,
              scenes: settings.scenes,
              collisions: settings.collisions,
              inspect: settings.inspect,
              ...(inspecting === undefined ? {} : { paused: true }),
              ...(svg === undefined ? {} : { svg: true as const }),
              ...(settings.mascotArt === 'vector' ? { art: 'vector' as const } : {}),
              ...(settings.mascotArt === 'vector' && settings.scenery ? { scenery: settings.daylight } : {}),
              ...(settings.character === 'usagi' ? { character: 'usagi' as const } : {}),
              ...(away === undefined ? {} : { away }),
              ...(shaken === undefined ? {} : { startled: shaken }),
              ...(agentsOnly ? { only: 'agents' as const } : {}),
              ...(tidyingSince === undefined ? {} : { tidyingSince }),
            })
            const { Client } = table as { Client: (props: { key: string; module: string; props?: unknown; width?: number; height?: number }) => RenderElement }
            // A terminal that shows pictures: the vector art as one, swapped frame by frame; while
            // inspecting none is drawn, its world kept, paused, for when it is back.
            if (await picturedOn($, settings, e.surface, table, props.columns, props.rows)) {
              if (inspecting === undefined) scene = await pictureOf($, table, e.surface, e.requestId, SCENE_KEY, props, now)
              else holdPicture(e.requestId, e.surface, props)
            } else {
              scene = <Client key={SCENE_KEY} module="./scene-client.tsx" props={props} width={columns} height={inspecting === undefined ? spare : 0} />
            }
            sceneTop = bodyRows === undefined ? undefined : bodyRows - spare
          }
        } else {
          const frame = await read($, sceneTick)
          if (bodyRows !== undefined) {
            const spare = bodyRows - (hud === undefined ? 0 : hudRows + 1) - listRows - 1
            const mascots = sceneOf(list, hudData, now, { stalledMs: settings.stalledMs, main, shadows: workflow, scenes: settings.scenes, events: sceneEvents, character: settings.character, ...(agentsOnly ? { only: 'agents' as const } : {}), ...(tidyingSince === undefined ? {} : { tidyingSince }) })
            const room = {
              columns,
              rows: spare,
              tick: Math.max(frame, Math.floor(now / SCENE_FRAME_MS)),
              wander: settings.wander,
              scenes: settings.scenes,
              collisions: settings.collisions,
              ...(away === undefined && shaken === undefined ? {} : { held: [away, shaken?.id].filter((id): id is string => id !== undefined) }),
              ...(away === undefined ? {} : { away }),
              ...(shaken === undefined ? {} : { startled: { id: shaken.id, ms: now - shaken.at } }),
            }
            const plan = mascotPlan(mascots, room, scenePlans.get(e.surface))
            const pick = settings.inspect ? { Button, onPick: (id: string) => void selectAgent($, { id, kind: kindOf(id) }) } : undefined
            scene = svg === undefined ? renderMascots({ Box, Text }, mascots, room, plan, pick) : renderMascotsSvg({ Box, Svg: svg }, mascots, room, plan, pick)
            if (plan !== undefined) scenePlans.set(e.surface, plan)
            else scenePlans.delete(e.surface)
          }
        }
      } catch {
        // Nothing more to draw.
      }
    }
    // Only the classic scene ticks from the hooks; the smooth one has its surface's own clock.
    await quietly($, async () => {
      if (scene !== undefined && !smooth && (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced && pane.isShown)) {
        sceneRendered.set(e.surface, now)
        startSceneClock($)
      } else {
        scenePlans.delete(e.surface)
        sceneRendered.delete(e.surface)
      }
    })
    const inspected = inspecting === undefined ? undefined : renderInspect({ Box, Text, Button, Svg: svg }, inspecting.rows, onAction, inspecting.agentsTab ? lists.element : undefined)

    // The TV over the pane's window: its glass's rows (the Agents tab the lists, a press there keeping that
    // tab), its presses by key, where its mascot stood, the pane's last scroll.
    let tv: RenderElement | undefined
    if (tvRoom !== undefined && tvShow !== undefined && choice !== null && bodyRows !== undefined) {
      const presses = new Map<string, () => void>()
      const tabs = tabsOf(choice.kind)
      const head = tvHeadOf(tvShow.header, tabs, tvShow.tab, tvRoom.content)
      for (const one of tabs) presses.set(`tab:${one}`, () => void selectTab($, one))
      let body: TvRow[]
      if (tvShow.tab === 'agents') {
        const listed = tvRowsOf(listRowsOf({
          settings, all, list, workflow, now, columns: tvRoom.content, isNarrow: tvRoom.content < NARROW_BELOW, view, choice,
          onSelect: (id, kind) => void selectAgent($, { id, kind, tab: 'agents' }),
          onToggle: group => void toggleGroup($, group),
          onMinimise: group => void toggleMinimised($, group),
        }))
        body = listed.rows
        for (const [key, press] of listed.presses) presses.set(key, press)
      } else {
        body = tvShow.body.map(row => tvRowOfInspect(row, onAction, presses))
      }
      tvPresses.set(e.surface, presses)
      // A TV up afresh flies in first: no giant of an earlier one carried over.
      if (!tvUp.has(e.surface)) tvGiants.delete(e.surface)
      tvUp.add(e.surface)
      const offset = e.props.scroll.offset
      const top = sceneTops.get(e.surface)
      const from = tvFrom?.id === choice.id && top !== undefined ? { x: tvFrom.x, y: top + tvFrom.y - offset, ...(tvFrom.mini === true ? { mini: true as const } : {}) } : undefined
      // Pressed in flight, it wears its propeller cap in the TV too.
      const flying = tvFrom?.id === choice.id && tvFrom.cap === true
      const mascots = settings.mascots ? sceneOf(list, hudData, now, { stalledMs: settings.stalledMs, main, shadows: workflow, scenes: settings.scenes, character: settings.character }) : undefined
      const who: Who = { ...tvWhoOf(choice, mascots, settings.character), ...(flying ? { cap: true as const } : {}) }
      // Grown into the giant in a terminal that shows pictures: the giant one, smooth, under the module's glass.
      const pictured = tvGiants.has(e.surface) && (await picturedOn($, settings, e.surface, table, tvRoom.width, tvRoom.height))
      const giant = pictured ? await giantPictureOf($, table, e.surface, e.requestId, tvRoom, who, now) : undefined
      if (!pictured) giantPictures.delete(`${e.requestId}:${e.surface}`)
      const inputs: TvInputs = {
        columns,
        rows: bodyRows,
        layout: tvRoom,
        who,
        head,
        body: budgeted(head, body),
        tabs: [...tabs],
        tab: tvShow.tab,
        view: `${choice.id}:${tvShow.tab}`,
        ...(from === undefined ? {} : { from }),
        ...(tvWheel.seq === 0 ? {} : { wheel: tvWheel }),
        ...(svg === undefined ? {} : { svg: true as const }),
        ...(settings.mascotArt === 'vector' ? { art: 'vector' as const } : {}),
        // Pictured, the casing's colour as the picture has it (the scheme's own, not the terminal theme's), for the glass's edge rows.
        ...(pictured ? { pictured: true as const, casing: rawColour(casingOf(who), await schemeFor($, now)) } : {}),
      }
      const { Client } = table as { Client: (props: { key: string; module: string; props?: unknown; width?: number; height?: number }) => RenderElement }
      tv = (
        <Box key="tv-layer" position="absolute" top={offset} left={0} width={columns} height={bodyRows}>
          {giant}
          <Client key={TV_KEY} module="./tv-client.tsx" props={inputs} width={columns} height={bodyRows} />
        </Box>
      )
    } else {
      tvUp.delete(e.surface)
      tvPresses.delete(e.surface)
      // Gone without playing its closing out (the selection gone elsewhere): no giant left up.
      tvGiants.delete(e.surface)
      giantPictures.delete(`${e.requestId}:${e.surface}`)
    }
    if (sceneTop !== undefined) sceneTops.set(e.surface, sceneTop)

    return (
      <Box flexDirection="column" minHeight={e.props.scroll.bodyRows} gap={1}>
        {hud}
        {inspected === undefined && todos}
        {inspected === undefined && lists.element}
        {smooth && scene !== undefined ? <Box key="scene-region" flexDirection="column">{scene}{inspected}</Box> : inspected ?? scene}
        {tv}
      </Box>
    )
  })

  // The band above the prompt: the session's mascot in its yard (the
  // `sessionMascot` option, with mascots on) and what tidying up has to say
  // beside it, with Tidy up and Not now while one is offered or counting down.
  // Neither, or a survey holding the band: the engine's own.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    // The band's clock redraws the countdown, the time a tidy has run and a result as it expires.
    await read($, bandTick)
    const now = await $.clock.now()
    const columns = e.props.bodyColumns
    let shown: BandTidy | undefined
    try {
      shown = bandTidyOf(await tidyInputsOf($, settings, now))
    } catch {
      // A tidy that cannot be read leaves the mascot alone.
    }
    const lines = shown === undefined ? [] : bandLinesOf(shown, now)
    // The mascot walks the band's width above the prompt, what tidying up says beside it.
    const yardColumns = lines.length > 0 ? Math.max(Math.min(columns, YARD_COLUMNS), columns - TIDY_COLUMNS) : columns
    // A row more of sky for the world tour where the band draws it (the desktop's Svg, a terminal's picture) and has the room.
    const scenic = settings.scenery && settings.motion === 'smooth' && e.props.maxRows >= BAND_ROWS && !bandFaulted.has(e.surface)
      && ((e.surface === 'desktop' && settings.mascotArt === 'vector' && 'Svg' in table) || (await picturedOn($, settings, e.surface, table, yardColumns, BAND_ROWS)))
    const yardRows = scenic ? BAND_ROWS : GRID_ROWS
    let yard: RenderElement | undefined
    if (settings.mascots && settings.sessionMascot === 'band' && yardColumns >= SLOT) {
      try {
        yard = await bandYard($, settings, e.surface, e.requestId, table, yardColumns, yardRows, now)
      } catch {
        // Nothing more to draw.
      }
    }
    noteBandMascot($, e.surface, yard !== undefined)
    if (yard === undefined && shown === undefined) return next(e)

    // Something timed shown (a tidy running, counting down, its result): the band's clock redraws it.
    if (shown !== undefined && shown.kind !== 'offer') startBandClock($, settings)
    const asking = shown?.kind === 'offer' || shown?.kind === 'countdown'
    const runs = (line: ReturnType<typeof bandLinesOf>[number]) =>
      line.filter(run => run.text !== '').map(({ text, color, dim, bold }, index) => (
        <Text key={`run:${index}`} {...defined({ color, dimColor: dim, bold })}>{text}</Text>
      ))

    return (
      <Box key="band" flexDirection="row" flexShrink={0}>
        {yard !== undefined && <Box key="band:yard" width={yardColumns} height={yardRows} flexShrink={0}>{yard}</Box>}
        {lines.length > 0 && (
          <Box key="band:tidy" flexDirection="column" flexGrow={1} paddingLeft={yard === undefined ? 0 : 1} justifyContent="flex-end">
            {lines.map((line, index) => (
              <Box key={`tidy:${index}`} height={1} flexShrink={0}>
                <Text wrap="truncate-end">{runs(line)}</Text>
              </Box>
            ))}
            {asking && (
              <Box key="tidy:buttons" flexDirection="row" gap={1} height={1} flexShrink={0}>
                <Button key="tidy:now" label={shown?.kind === 'countdown' ? 'Tidy up now' : 'Tidy up'} onPress={() => void quietly($, () => tidyNow($, settings))} />
                <Button key="tidy:later" label="Not now" onPress={() => void dismissTidy($)} />
              </Box>
            )}
          </Box>
        )}
      </Box>
    )
  })
}
