import { atom, read, update } from 'claude-code'
import type { BuiltinToolResults, EngineInterface, ProcessRunResult, Register, RenderElement, Timer, ToolCallResult } from 'claude-code'

import type {
  AgentBoardEntry,
  HudData,
  HudDetailFacts,
  HudGitFacts,
  HudLedger,
  HudListView,
  HudMainFacts,
  HudSelection,
  HudSessionFacts,
  HudTab,
  HudTodoFacts,
  HudToolFacts,
  HudTrailStep,
  HudUsageFacts,
} from '../types'
import { renderLists } from './agent-lists'
import { isRunning, merge, summarize, workflowOf } from './agent-model'
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
  afterMainTurn,
  applyMeasure,
  assembleHudData,
  debouncer,
  effortFromSettings,
  effortOf,
  gitFactsOf,
  inventoryOf,
  noCurrentTool,
  parseGitStatus,
  parseTodos,
  providerOf,
  sameFacts,
  throttleDue,
  todoFactsOf,
  toolSettled,
  toolStarted,
} from './facts'
import { renderHudBlock, renderTodos, statusLineText } from './hud'
import { NO_LEDGER, costTree, ledgerBooked, ledgerEnded, ledgerFailed, ledgerSummary } from './hud-ledger'
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
import type { AgentBody, InspectAction, InspectRow, Trails } from './inspect'
import { inspectedOf, overviewOf } from './inspect-model'
import { SLOT } from './mascot-sprites'
import { sceneInputsOf, sceneOf } from './scene-model'
import { MESSAGE_TICKS, SCENE_FRAME_MS } from './scene-phases'
import { mascotPlan } from './scene-plan'
import { renderMascots, renderMascotsSvg } from './scene-render'
import type { MascotPlan, SceneEvent, SceneInputs } from './scene-types'
import { defined } from './state-json'
import { printable } from './text-width'

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
// The main loop's activity, written with mascots on; /clear also drops stale facts.
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
// A HUD that cannot be read leaves the summary alone.
const statusTextOf = async ($: EngineInterface, settings: Settings, all: Agents, now: number): Promise<string | null> => {
  if (!settings.statusLine) return null
  const data = await attempt(() => hudDataOf($, settings, now))
  const held = settings.showWorkflows ? await attempt(() => read($, shadows)) : undefined
  const parts = [data === undefined ? '' : statusLineText(data), summarize(Object.values(all), workflowOf(held, all, now), now, settings.stalledMs) ?? '']
    .filter(part => part !== '')

  return parts.length === 0 ? null : parts.join(' │ ')
}

const showStatus = async ($: EngineInterface, settings: Settings, all: Agents, now: number, mine?: Timer): Promise<void> => {
  const text = await statusTextOf($, settings, all, now)
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

// Only the rendered scene opts into this clock. It touches no HUD facts,
// reconciliation or git, and the atom redraws only its reader (this pane).
const startSceneClock = ($: EngineInterface): void => {
  if (sceneTimer !== undefined) return
  const mine = $.clock.every(SCENE_FRAME_MS, () => {
    void (async () => {
      if (sceneTimer !== mine) return
      const visible = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced && pane.isShown)
      if (sceneTimer !== mine) return
      if (!visible) return stopSceneClock()
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

const refreshGit = async ($: EngineInterface): Promise<void> => {
  const cwd = (await attempt(() => $.session.cwd())) ?? (await read($, hudSession)).cwd
  if (cwd === undefined || cwd === '') return
  let ran: ProcessRunResult
  try {
    ran = await $.process.run(['git', '-C', cwd, 'status', '--porcelain=v2', '--branch'], {
      timeoutMs: GIT_TIMEOUT_MS,
      // No index refresh, so this read never holds a lock the agent's git wants.
      env: { GIT_OPTIONAL_LOCKS: '0' },
    })
  } catch {
    // Git missing, or slower than its timeout: keep the reading and back off.
    gitWindow(GIT_BACKOFF_MS)
    return
  }
  // Not a repository (or git refused it): nothing to draw.
  if (ran.exitCode !== 0) return reviseGit($, () => NO_FACTS.git)
  gitWindow(GIT_DEBOUNCE_MS)
  const reading = parseGitStatus(ran.stdout)
  const now = await $.clock.now()
  await reviseGit($, held => gitFactsOf(held, reading, now))
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

// The session's facts at start and at each reload: who, where, and what the
// engine has measured so far. Git and the inventory follow from timers.
const startHud = async ($: EngineInterface, settings: Settings, startCwd: string): Promise<void> => {
  const [model, cwd, repo, usage, baseUrl, stored] = await Promise.all([
    attempt(() => $.session.model()),
    attempt(() => $.session.cwd()),
    attempt(() => $.session.repo()),
    attempt(() => $.session.usage()),
    attempt(() => $.env.get('ANTHROPIC_BASE_URL')),
    attempt(() => $.settings.read()),
  ])
  await reviseSession($, held => defined({
    ...held,
    model: model ?? held.model,
    // A main step's effort is the one in use; the settings' stand in before one.
    effort: held.effort ?? effortFromSettings(stored, model ?? held.model),
    provider: providerOf(baseUrl),
    startedAt: usage?.startedAt ?? held.startedAt,
    cwd: cwd ?? startCwd,
    // null is outside a repository; undefined, a failed call that changes nothing.
    repoRoot: repo === undefined ? held.repoRoot : (repo?.root ?? undefined),
  }))
  if (usage !== undefined) {
    const now = await $.clock.now()
    await reviseUsage($, held => applyMeasure(held, usage, now))
  }
  await requestGit($, settings, true)
  if (settings.showInventory) await requestInventory($)
}

// What the HUD draws, every fact read so a drawing that calls this redraws
// when any of them is written.
const readHudData = async ($: EngineInterface, now: number): Promise<HudData> =>
  assembleHudData({
    session: await read($, hudSession),
    usage: await read($, hudUsage),
    git: await read($, hudGit),
    tools: await read($, hudTools),
    todos: await read($, hudTodos),
    inventory: await read($, hudInventory),
  }, now)

// The HUD as the pane and the status line show it: the parts switched off
// left out, and the motto, if any.
const hudDataOf = async ($: EngineInterface, settings: Settings, now: number): Promise<HudData> => {
  const data = await readHudData($, now)

  return defined<HudData>({
    ...data,
    git: settings.showGit ? data.git : undefined,
    tools: settings.showTools ? data.tools : undefined,
    todos: settings.showTodos ? data.todos : undefined,
    inventory: settings.showInventory ? data.inventory : undefined,
    motto: settings.motto === '' ? undefined : settings.motto,
  })
}

// A HUD fact the status line shows changed: redraw it, when it is on.
const refreshStatus = async ($: EngineInterface, settings: Settings): Promise<void> => {
  if (!settings.statusLine) return
  await showStatus($, settings, await read($, agents), await $.clock.now())
}

// A `/clear`: tools, todos, compactions and context fill start over; who and
// where the session is, git and the inventory stay. The engine may still be
// reporting the old conversation, so accept its clock and cost only together.
const clearHud = async ($: EngineInterface, settings: Settings): Promise<void> => {
  if (settings.showTools) await reviseTools($, () => NO_FACTS.tools)
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

/** A click's post from the scene's surface module: `{ kind: 'inspect', id }`, or undefined for anything else. */
const inspectAsk = (data: unknown): string | undefined => {
  if (typeof data !== 'object' || data === null) return undefined
  const { kind, id } = data as { kind?: unknown; id?: unknown }

  return kind === 'inspect' && typeof id === 'string' && id !== '' && id.length <= 200 ? id : undefined
}

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

export const register: Register = (on, options) => {
  const settings = settingsOf(options)

  // A reload starts this module afresh; a registration in a context that
  // already ran one drops what that left running.
  stopTicking()
  stopSceneClock()
  resetHud()
  listedIds = new Set()

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
    const callId = isKnown && settings.mascots && typeof e.tool_use_id === 'string' ? e.tool_use_id : undefined
    if (callId !== undefined && loop !== undefined) await trackCall($, callId, loop)
    if (loop === undefined && settings.showTools) {
      await quietly($, async () => {
        const now = await $.clock.now()
        await update($, hudTools, held => toolStarted(held, label, e.tool_use_id, now))
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
      if (settings.inspect && ended !== 'ok') await quietly($, () => reviseLedger($, held => ledgerFailed(held, ended)))
      await quietly($, async () => {
        if (loop === undefined && settings.showTools) await reviseTools($, held => toolSettled(held, label, e.tool_use_id))
        const isDone = outcome !== undefined && outcome.deny === undefined && outcome.isError !== true
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

  // Only a lingering ask raises a hand; the verdict passes through untouched.
  if (settings.mascots) {
    on('tool.check', async ($, e, next) => {
      const verdict = await next(e)
      await quietly($, async () => {
        const callId = e.tool_use_id
        const loop = callId === undefined ? undefined : subagentCalls.get(callId)
        if (callId !== undefined && loop !== undefined && verdict?.decision === 'ask') markAsking($, callId, loop)
      })

      return verdict
    })
  }

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
    // The main loop's end leaves no tool current and asks for a git reading
    // and, when due, the inventory.
    if (id === undefined && settings.mascots && mainBusy !== false) await quietly($, () => markMainIdle($))
    // One more turn for the Session tab, its time busy and the context's size: in one usage write.
    if (id === undefined && settings.inspect) await quietly($, () => reviseUsage($, held => afterMainTurn(held, e.durationMs)))
    await quietly($, async () => {
      if (id !== undefined) return
      if (settings.showTools) await reviseTools($, noCurrentTool)
      await requestGit($, settings)
      if (settings.showInventory) await requestInventory($)
    })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    lastMeasureLimits = Array.isArray(e.rateLimits) ? [...e.rateLimits] : []
    await quietly($, async () => {
      const now = await $.clock.now()
      await reviseUsage($, held => applyMeasure(held, e, now))
      await refreshStatus($, settings)
    })

    return next(e)
  })

  // The main loop's model and effort, as each request names them; a request
  // in a loop no list names is a workflow agent's step. Both are written once,
  // before the request goes: the chunks then stream through untouched.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      if (settings.mascots && mainBusy !== true) await quietly($, () => markMainBusy($))
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
    const result = yield* next(e)
    // What the request read, wrote and cached, whichever loop made it: the
    // session's tokens, and the ledger's for that loop and model.
    const spent = result.usage
    if (spent !== null && spent !== undefined) {
      await quietly($, () => reviseUsage($, held => addTokens(held, spent)))
      if (settings.inspect) await quietly($, async () => {
        const who = await ledgerWhoOf($, settings, e.agentId)
        const now = await $.clock.now()
        await reviseLedger($, held => ledgerBooked(held, e.agentId ?? 'main', spent, who, now))
      })
    }

    return result
  })

  // A main-loop compaction that took place counts; `precompute` installs nothing.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    // Summarizer forks emit turn.step with their own agentId: book there only.
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.messages !== undefined) {
      await quietly($, async () => {
        await reviseUsage($, afterCompaction)
        await refreshStatus($, settings)
      })
      if (settings.mascots) await quietly($, async () => {
        const now = await $.clock.now()
        await reviseMain($, held => ({ ...held, compactedAt: now }))
      })
    }

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
      stopSceneClock()
      stopTicking()
      if (Object.values(await read($, agents)).some(isRunning) || (await workflowHeld($, settings))) startTicking($, settings)
    }

    return result
  })

  // A click on a mascot in the smooth scene: its surface module asks to inspect
  // that agent, and the selection (the hooks') follows, as a row's button does.
  on('ui.message', async ($, e, next) => {
    const asked = inspectAsk(e.data)
    if (settings.inspect && settings.mascots && e.element === SCENE_KEY && asked !== undefined) {
      await quietly($, async () => {
        // The crowned mascot is the session's own.
        if (asked === 'main') return selectAgent($, { id: 'main', kind: 'main' })
        const board = await read($, agents)
        const held = board[asked] === undefined && settings.showWorkflows ? (await read($, shadows))[asked] : undefined
        if (board[asked] !== undefined) await selectAgent($, { id: asked, kind: 'agent' })
        else if (held !== undefined) await selectAgent($, { id: asked, kind: 'shadow' })
      })
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
    let todos: ReturnType<typeof renderTodos>['element']
    let todoRowCount = 0
    try {
      const drawn = renderTodos({ Box, Text, Svg: svg }, hudData?.todos, { columns, max: settings.todoRows })
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
    const view = await read($, listView)
    const needsMain = settings.mascots || choice?.kind === 'main'
    const main = needsMain ? ((await attempt(() => read($, mainFacts))) ?? NO_MAIN) : NO_MAIN
    let inspecting: { rows: InspectRow[]; agentsTab: boolean } | undefined
    if (choice !== null) {
      try {
        const usage = choice.kind === 'main' ? await read($, hudUsage) : undefined
        const who = inspectedOf(choice, all, workflow, hudData, main, usage?.turns, now, settings)
        if (who !== undefined) {
          const tab = tabOf(choice)
          let body: InspectRow[] = []
          if (who.body !== undefined && tab !== 'agents') {
            const trail = tab === 'trail' ? ((await read($, trails))[choice.id] ?? []) : []
            const said = choice.kind === 'agent' && (tab === 'task' || tab === 'said') ? await read($, detail) : null
            const agentBody: AgentBody = { ...who.body, trail, ...(said !== null && said.id === choice.id ? { detail: said } : {}) }
            body = tab === 'task' ? taskRows(agentBody, columns) : tab === 'trail' ? trailRows(agentBody, columns, now) : saidRows(agentBody, columns)
          } else if (usage !== undefined && tab === 'overview') {
            const held = settings.showWorkflows ? await read($, shadows) : {}
            body = overviewRows(overviewOf(usage, main, await read($, ledger), (await read($, hudInventory)).compactAt, hudData?.session?.startedAt, all, held, now), columns)
          } else if (usage !== undefined && tab === 'cost') {
            const startedAt = hudData?.session?.startedAt
            body = costRows({ totalUsd: usage.costUsd, duration: startedAt === undefined ? undefined : now - startedAt, models: costTree(await read($, ledger)) }, columns, new Set(view.models ?? []))
          }
          inspecting = { rows: inspectRows(who.header, tabsOf(choice.kind), tab, body, columns), agentsTab: tab === 'agents' }
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
              ...(settings.character === 'usagi' ? { character: 'usagi' as const } : {}),
            })
            const { Client } = table as { Client: (props: { key: string; module: string; props?: unknown; width?: number; height?: number }) => RenderElement }
            scene = <Client key={SCENE_KEY} module="./scene-client.tsx" props={props} width={columns} height={inspecting === undefined ? spare : 0} />
          }
        } else {
          const frame = await read($, sceneTick)
          if (bodyRows !== undefined) {
            const spare = bodyRows - (hud === undefined ? 0 : hudRows + 1) - listRows - 1
            const mascots = sceneOf(list, hudData, now, { stalledMs: settings.stalledMs, main, shadows: workflow, scenes: settings.scenes, events: sceneEvents, character: settings.character })
            const room = { columns, rows: spare, tick: Math.max(frame, Math.floor(now / SCENE_FRAME_MS)), wander: settings.wander, scenes: settings.scenes, collisions: settings.collisions }
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

    return (
      <Box flexDirection="column" minHeight={e.props.scroll.bodyRows} gap={1}>
        {hud}
        {inspected === undefined && todos}
        {inspected === undefined && lists.element}
        {smooth && scene !== undefined ? <Box key="scene-region" flexDirection="column">{scene}{inspected}</Box> : inspected ?? scene}
      </Box>
    )
  })
}
