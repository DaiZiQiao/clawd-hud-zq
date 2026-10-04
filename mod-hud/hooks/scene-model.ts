import type { AgentBoardEntry, HudData, ShadowAgentEntry } from '../types'
import { READ_TOOLS, isShadowLive, isShadowVisible } from './agent-shadows'
import { ACCESSORIES, ACCESSORY_NAMES, BLANKET, CROWN, LAPTOP_COLOUR, OVERLAYS } from './mascot-sprites'
import type { Accessory } from './mascot-sprites'
import { hashOf } from './motion-rules'
import {
  BATON_TICKS,
  CHEER_TICKS,
  DELIVER_TICKS,
  EXIT_TICKS,
  FAIL_PACK_TICKS,
  HAND_TICKS,
  IDLE_AFTER_MS,
  LINK_WINDOW_MS,
  MESSAGE_TICKS,
  PACK_TICKS,
  SCENE_FRAME_MS,
  SIT_TICKS,
  STRETCH_TICKS,
  holdTicks,
} from './scene-phases'
import { PIPE_BATCH_MS, PIPE_COLOUR, PIPE_SHINE, PIPE_SLIDE_MS, pipeBatch } from './scene-pipe'
import type {
  Energy,
  MascotActivity,
  MascotAgent,
  MascotMain,
  MascotRole,
  MascotScene,
  PipeShare,
  SceneActorInput,
  SceneHistory,
  SceneInputs,
  SceneOptions,
  SceneShadowInput,
} from './scene-types'
import { defined } from './state-json'
import { USAGI_COLOURS } from './usagi-sprites'

// The mascot scene drawn in the pane's spare rows, under the agent list: the
// session's own mascot first, then one per subagent and workflow agent, all
// pure functions of the board, the workflow agents, the HUD's facts and the
// time. Each agent's colour and accessory, what it does by its tool and its
// role by its type; the smooth scene's props and the scene made back from
// them. Phases: hooks/scene-phases.ts; layout and movement:
// hooks/scene-plan.ts; sprite sheet and state machine: docs/mascots.md.

// --- colours -----------------------------------------------------------------

// Theme keys, as the HUD uses them, so the scene follows the person's theme.
export const ACCENT = 'claude'
export const GOOD = 'success'
export const WARN = 'warning'
export const HOT = 'error'
/** Contract theme keys: the question is accented, the sweat drop a warning. */
export const ASK = 'claude'
export const DROP = 'warning'

/**
 * Raw identity colours avoid theme aliases (Dracula maps purple to `claude`
 * and blue/cyan to permission). Mid-tone blue, rose, olive, violet, teal and
 * copper are distinct from the usual bright status green/yellow/red and
 * orange/lavender accent. Each has WCAG sRGB contrast >= 3:1 on both #282a36
 * and #eff1f5 (tested); these are sprite colours, not a 4.5:1 text palette.
 * Names and state glyphs remain the non-colour identity/status cues.
 */
export const PALETTE = [
  '#3681D1',
  '#BF5D92',
  '#6D8632',
  '#886CD4',
  '#008D80',
  '#B26C4B',
] as const

/** The raw colours of what is worn and used: the accessories, the crown, the laptop, the blanket, the cigarette. */
export const KIT_COLOURS: readonly string[] = [
  ...new Set([
    ...Object.values(ACCESSORIES).map(one => one.colour),
    CROWN.colour,
    LAPTOP_COLOUR,
    BLANKET.colour,
    ...OVERLAYS.cigarette.map(one => one.colour ?? ''),
  ]),
].filter(colour => colour !== '')

/** Every colour the scene draws in, the palette, the kit and the red pipe included. */
export const SCENE_COLOURS: readonly string[] = [ACCENT, GOOD, WARN, HOT, ASK, DROP, ...PALETTE, ...KIT_COLOURS, PIPE_COLOUR, PIPE_SHINE, ...USAGI_COLOURS]

/**
 * An agent's colour, the same for the same id every time (an FNV-1a hash into
 * PALETTE): its mascot and its name in the list share it.
 */
export const colourFor = (agentId: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < agentId.length; index += 1) {
    hash ^= agentId.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return PALETTE[hash % PALETTE.length] ?? PALETTE[0]
}

/**
 * The accessories too close in hue to each body colour to be worn by it:
 * copper no beanie, bow or halo; rose no flower; violet no top hat; blue no
 * propeller; teal no note; olive any.
 */
export const CLASHES: Readonly<Record<string, readonly Accessory[]>> = {
  '#3681D1': ['propeller'],
  '#BF5D92': ['flower'],
  '#6D8632': [],
  '#886CD4': ['tophat'],
  '#008D80': ['note'],
  '#B26C4B': ['beanie', 'bow', 'halo'],
}

/**
 * An agent's accessory: of those its colour does not clash with, in an order
 * of its own (a hash of its id and each name), the first that `worn` (what
 * the agents before it wear) does not hold; a repeat only when all are worn.
 */
export const accessoryOf = (id: string, colour: string, worn: ReadonlySet<Accessory> = new Set()): Accessory => {
  const clash = new Set(CLASHES[colour] ?? [])
  const pool = ACCESSORY_NAMES
    .filter(name => !clash.has(name))
    .sort((a, b) => hashOf(id, 'accessory', a) - hashOf(id, 'accessory', b) || a.localeCompare(b))

  return pool.find(name => !worn.has(name)) ?? pool[0] ?? 'beanie'
}

/** Which end of the air row an agent's accessory sits at, by a hash of its id: its energy takes the other. */
export const sideOf = (id: string): 'left' | 'right' => (hashOf(id, 'side') % 2 === 0 ? 'left' : 'right')

// --- the scene ---------------------------------------------------------------

/** The context this full, as the HUD rounds it, and the mascot sweats. */
const SWEAT_PERCENT = 85
const STALLED_MS = 240_000
/** The longest a finished agent stays in the scene: its longest hold and its farewell. */
const LINGER_MS = (Math.max(FAIL_PACK_TICKS + SIT_TICKS, PACK_TICKS + DELIVER_TICKS + HAND_TICKS + BATON_TICKS + CHEER_TICKS) + EXIT_TICKS) * SCENE_FRAME_MS

const EDITS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const READS: ReadonlySet<string> = new Set(['Read'])
const SEARCHES: ReadonlySet<string> = new Set(['Grep', 'Glob'])
const SHELLS: ReadonlySet<string> = new Set(['Bash'])
const FETCHES: ReadonlySet<string> = new Set(['WebFetch', 'WebSearch'])

/** A tool, as the board names it, to what the mascot does; no tool, or one with no laptop of its own, is thinking. */
export const activityOf = (tool: string | undefined): MascotActivity => {
  if (tool === undefined || tool === '') return 'thinking'
  if (EDITS.has(tool)) return 'typing'
  if (READS.has(tool)) return 'reading'
  if (SEARCHES.has(tool)) return 'searching'
  if (SHELLS.has(tool)) return 'lifting'
  if (FETCHES.has(tool)) return 'fetching'

  return 'thinking'
}

/** A type's role, for its letter: `r` reviewer, `d` debugger, `p` Plan, `w` worker, `f` frontend, `e` Explore or researcher; none for any other. */
export const roleOf = (type: string | undefined): MascotRole | undefined => {
  const name = (type ?? '').toLowerCase()
  if (/review/.test(name)) return 'reviewer'
  if (/debug/.test(name)) return 'debugger'
  if (/plan/.test(name)) return 'planner'
  if (/frontend/.test(name)) return 'frontend'
  if (/worker/.test(name)) return 'worker'
  if (/explore|research/.test(name)) return 'explorer'

  return undefined
}

/**
 * The energy mark for a reasoning effort: none for low, medium or unknown;
 * `✦` for high; `✦✦` for xhigh, max and ultra. A numeric effort (a thinking
 * budget in tokens) maps by thresholds: under 16,384 none, under 32,768 one,
 * else two.
 */
export const energyOf = (effort: string | undefined): Energy => {
  const level = (effort ?? '').trim().toLowerCase()
  if (/^\d+(\.\d+)?$/.test(level)) {
    const budget = Number(level)

    return budget < 16_384 ? 0 : budget < 32_768 ? 1 : 2
  }
  if (level === 'high') return 1
  if (level === 'xhigh' || level.startsWith('max') || level === 'ultra') return 2

  return 0
}

/** A type whose desk a reviewer visits: one that writes or fixes. */
export const isMakerType = (type: string | undefined): boolean => /worker|frontend|debug/i.test(type ?? '')

export const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const contextPercentOf = (hud: HudData | undefined): number | undefined => {
  const usage = hud?.usage
  if (isNumber(usage?.contextPercent)) return usage.contextPercent
  if (isNumber(usage?.contextTokens) && isNumber(usage?.window) && usage.window > 0) return (usage.contextTokens / usage.window) * 100

  return undefined
}

/** What the scene reads of a board entry, or of a workflow agent made to look like one. */
type Actor = Pick<AgentBoardEntry, 'id' | 'parentId' | 'startedAt' | 'lastActivityAt' | 'status' | 'endedAt' | 'currentTool' | 'awaitingPermission' | 'effort' | 'readingSince'> & {
  type?: string
  workflow?: boolean
}

const actorOf = (entry: ShadowAgentEntry): Actor => ({
  id: entry.id,
  startedAt: entry.visibleAt ?? entry.firstSeen,
  lastActivityAt: entry.lastSeen,
  status: entry.status,
  endedAt: entry.endedAt,
  currentTool: entry.currentTool,
  effort: entry.effort,
  ...(entry.readingSince === undefined ? {} : { readingSince: entry.readingSince }),
  workflow: true,
})

/** The finished agent (of the types `wanted` accepts) that ended latest within the window before `start`. */
const linkedBefore = (list: readonly Actor[], start: number, wanted: (actor: Actor) => boolean): Actor | undefined =>
  list
    .filter(one => one.status !== 'running' && isNumber(one.endedAt) && wanted(one))
    .filter(one => start - (one.endedAt ?? 0) >= 0 && start - (one.endedAt ?? 0) <= LINK_WINDOW_MS)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0) || a.id.localeCompare(b.id))[0]

/**
 * Each agent's accessory, in spawn order: `accessoryOf` against what the
 * agents before it that were still in the scene at its spawn wear. What came
 * later never counts, and what was there at its spawn stays there, so an
 * agent's accessory holds while it is in the scene.
 */
const accessoriesOf = (list: readonly Actor[]): Map<string, Accessory> => {
  const worn = new Map<string, Accessory>()
  list.forEach((entry, index) => {
    const taken = new Set<Accessory>()
    for (const earlier of list.slice(0, index)) {
      const gone = earlier.status !== 'running' && isNumber(earlier.endedAt) && earlier.endedAt + LINGER_MS <= entry.startedAt
      const one = worn.get(earlier.id)
      if (!gone && one !== undefined) taken.add(one)
    }
    worn.set(entry.id, accessoryOf(entry.id, colourFor(entry.id), taken))
  })

  return worn
}

/** A debugger spawned soon after a reviewer finished: it goes to the latest maker's desk. */
const followsReview = (list: readonly Actor[], self: Actor): boolean =>
  linkedBefore(list, self.startedAt, one => roleOf(one.type) === 'reviewer') !== undefined

/**
 * The scene's actors at `now`: the board's agents and the workflow agents
 * shown, and those of them it may draw (running, or ended), in spawn order.
 */
const actorsOf = (board: readonly AgentBoardEntry[], held: SceneOptions['shadows'], now: number): { list: Actor[]; candidates: Actor[] } => {
  const onBoard = new Set(board.map(entry => entry.id))
  const shadows = held === undefined ? [] : Array.isArray(held) ? held : Object.values(held)
  const workflow = shadows
    .filter(entry => !onBoard.has(entry.id) && isShadowVisible(entry) && isShadowLive(entry, now))
    .map(actorOf)
  const list: Actor[] = [...board, ...workflow]
  const candidates = list
    .filter(entry => entry.status === 'running' || isNumber(entry.endedAt))
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))

  return { list, candidates }
}

/**
 * The scene at `now`: the session's mascot from the HUD's facts and the main
 * loop's, and one mascot per agent on the board or workflow agent still worth
 * drawing (running, or finished recently enough to still be leaving), in
 * spawn order (a workflow agent's first event standing for its spawn).
 */
export const sceneOf = (
  agents: readonly AgentBoardEntry[] | Readonly<Record<string, AgentBoardEntry>>,
  hud: HudData | undefined,
  now: number,
  options: SceneOptions = {},
): MascotScene => {
  const board = Array.isArray(agents) ? agents : Object.values(agents)
  const { list, candidates } = actorsOf(board, options.shadows, now)
  const stalledMs = options.stalledMs ?? STALLED_MS
  const facts = options.main ?? {}
  const scenes = options.scenes === true
  // The smooth scene's props carry what the agents they leave out settled.
  const history = options.history

  const known = new Set([...candidates.map(entry => entry.id), ...(history?.known ?? [])])
  const runningFlow = candidates.filter(entry => entry.workflow === true && entry.status === 'running')
  const worn = accessoriesOf(candidates)

  const drafted = candidates.map((entry): MascotAgent => {
    const quiet = now - entry.lastActivityAt
    const stalled = entry.status === 'running' && quiet > stalledMs
    const asking = entry.awaitingPermission === true
    // Idle: quiet a while with no tool running, or stalled (its laptop dropped); never while asking.
    const idle = entry.status === 'running' && !asking && (stalled || entry.currentTool === undefined) && quiet >= IDLE_AFTER_MS
    const role = entry.workflow === true ? undefined : roleOf(entry.type)
    const spawner = entry.workflow === true ? undefined : entry.parentId !== undefined && known.has(entry.parentId) ? entry.parentId : 'main'
    const accessory = history?.worn[entry.id] ?? worn.get(entry.id)
    const energy = energyOf(entry.effort)
    // A reading streak: only reads since `readingSince`, the current call one too (or none).
    const reading = entry.status === 'running' && isNumber(entry.readingSince) && (entry.currentTool === undefined || READ_TOOLS.has(entry.currentTool))
      ? Math.max(0, now - entry.readingSince) : undefined
    let squadNext: string | undefined
    if (entry.workflow === true && entry.status === 'done') {
      squadNext = (runningFlow.find(one => one.startedAt > entry.startedAt || (one.startedAt === entry.startedAt && one.id > entry.id)) ?? runningFlow[0])?.id
    }

    return {
      id: entry.id,
      colour: colourFor(entry.id),
      ...(entry.parentId !== undefined && known.has(entry.parentId) ? { parentId: entry.parentId } : {}),
      ...(role === undefined ? {} : { role }),
      ...(entry.type === undefined ? {} : { type: entry.type }),
      activity: asking ? 'asking' : activityOf(entry.currentTool),
      status: entry.status === 'running' ? (stalled ? 'stalled' : 'running') : entry.status,
      ...(energy === 0 ? {} : { energy }),
      ...(accessory === undefined ? {} : { accessory, side: sideOf(entry.id) }),
      ...(idle ? { idleMs: quiet } : {}),
      ...(entry.startedAt > 0 ? { ageMs: Math.max(0, now - entry.startedAt) } : {}),
      ...(entry.status !== 'running' && isNumber(entry.endedAt) ? { endedMs: Math.max(0, now - entry.endedAt) } : {}),
      ...(entry.workflow === true ? { workflow: true } : {}),
      ...(spawner === undefined ? {} : { spawner }),
      ...(squadNext === undefined ? {} : { squadNext }),
      ...(reading === undefined ? {} : { readingMs: reading }),
    }
  })

  // Still worth drawing: running, or finished and not yet past its farewell.
  const shown = drafted.filter(agent => {
    if (agent.status === 'running' || agent.status === 'stalled') return true
    const ended = agent.endedMs ?? -1

    return ended >= 0 && ended < (holdTicks(agent, scenes) + EXIT_TICKS) * SCENE_FRAME_MS
  })
  const ids = new Set(shown.map(agent => agent.id))
  const byId = new Map(list.map(entry => [entry.id, entry]))

  // A reviewer spawned soon after a maker finished visits its desk; a debugger
  // spawned soon after a reviewer finished goes to the latest maker's desk.
  const mascots = shown.map((agent): MascotAgent => {
    const self = byId.get(agent.id)
    if (!scenes || self === undefined || self.startedAt <= 0) return agent
    if (agent.role === 'reviewer') {
      const maker = linkedBefore(list, self.startedAt, one => one.id !== agent.id && isMakerType(one.type))
      if (maker !== undefined && ids.has(maker.id)) return { ...agent, link: { kind: 'review', target: maker.id } }
    }
    if (agent.role === 'debugger' && (history === undefined ? followsReview(list, self) : history.fixes.includes(agent.id))) {
      const desk = shown
        .filter(one => one.id !== agent.id && isMakerType(one.type))
        .sort((a, b) => (a.ageMs ?? Infinity) - (b.ageMs ?? Infinity))[0]
      if (desk !== undefined) return { ...agent, link: { kind: 'fix', target: desk.id } }
    }

    return agent
  })

  // Spawned within two seconds of the batch's first: one pipe, popping out one after another.
  const spawned = mascots.filter(agent => agent.ageMs !== undefined)
  const shared = new Map<string, PipeShare>()
  for (let index = 0; index < spawned.length;) {
    const first = spawned[index] as MascotAgent
    const start = now - (first.ageMs ?? 0)
    const batch: MascotAgent[] = []
    while (index < spawned.length && now - (spawned[index]?.ageMs ?? 0) - start < PIPE_BATCH_MS) batch.push(spawned[index++] as MascotAgent)
    if (batch.length < 2) continue
    const { drops, up } = pipeBatch(batch.map(agent => now - (agent.ageMs ?? 0) - start))
    batch.forEach((agent, at) => {
      const after = now - (agent.ageMs ?? 0) - start
      // Only while its pipe is there.
      if ((agent.ageMs ?? 0) + after < up + PIPE_SLIDE_MS) shared.set(agent.id, { anchor: first.id, after, drop: drops[at] ?? PIPE_SLIDE_MS, up })
    })
  }
  const piped = mascots.map(agent => (shared.has(agent.id) ? { ...agent, pipe: shared.get(agent.id) as PipeShare } : agent))

  const running = list.some(entry => entry.status === 'running')
  const working = facts.busySince !== undefined || hud?.tools?.current !== undefined
  const mood: MascotMain['mood'] = running ? 'watching' : working ? 'thinking' : 'idle'
  const idleFrom = facts.idleSince ?? hud?.session?.startedAt
  const percent = contextPercentOf(hud)
  const stretch = isNumber(facts.compactedAt) ? now - facts.compactedAt : undefined
  const tick = Math.floor(now / SCENE_FRAME_MS)
  const present = new Set(['main', ...ids])
  const events = (options.events ?? [])
    .filter(one => present.has(one.from) && present.has(one.to) && one.from !== one.to && tick - one.tick >= 0 && tick - one.tick < MESSAGE_TICKS)
  const energy = energyOf(hud?.session?.effort)

  return {
    main: {
      mood,
      ...(mood === 'idle' && isNumber(idleFrom) ? { idleMs: Math.max(0, now - idleFrom) } : {}),
      sweating: percent !== undefined && Math.round(percent) >= SWEAT_PERCENT,
      ...(stretch !== undefined && stretch >= 0 && stretch < STRETCH_TICKS * SCENE_FRAME_MS ? { stretchMs: stretch } : {}),
      ...(energy === 0 ? {} : { energy }),
    },
    agents: piped,
    ...(events.length === 0 ? {} : { events }),
    ...(options.character === 'usagi' ? { character: 'usagi' as const } : {}),
  }
}

// --- the smooth scene's inputs: what the hooks hand its surface module -----------

/** What the whole board settles for the agents `carried` (`SceneHistory`): only theirs, so the props stay small. */
const historyOf = (agents: readonly AgentBoardEntry[], shadows: readonly ShadowAgentEntry[], now: number, carried: ReadonlySet<string>): SceneHistory => {
  const { list, candidates } = actorsOf(agents, shadows, now)
  const worn = accessoriesOf(candidates)
  const known = new Set(candidates.map(entry => entry.id))
  const kept = candidates.filter(entry => carried.has(entry.id))

  return {
    worn: Object.fromEntries(kept.flatMap(entry => {
      const accessory = worn.get(entry.id)

      return accessory === undefined ? [] : [[entry.id, accessory]]
    })),
    known: [...new Set(kept.flatMap(entry => (entry.parentId !== undefined && known.has(entry.parentId) && !carried.has(entry.parentId) ? [entry.parentId] : [])))],
    fixes: kept.filter(entry => entry.workflow !== true && roleOf(entry.type) === 'debugger' && entry.startedAt > 0 && followsReview(list, entry)).map(entry => entry.id),
  }
}

/** The smooth scene's props from what the pane reads: only the fields the scene draws from. */
export const sceneInputsOf = (
  agents: readonly AgentBoardEntry[],
  shadows: readonly ShadowAgentEntry[],
  hud: HudData | undefined,
  room: Omit<SceneInputs, 'agents' | 'shadows' | 'hud'>,
): SceneInputs => {
  const percent = contextPercentOf(hud)
  const horizon = Math.max(LINK_WINDOW_MS, (holdTicks({ status: 'done', spawner: 'main', squadNext: 'next' }, room.scenes) + EXIT_TICKS) * SCENE_FRAME_MS)
  // Agents finished longer ago than the horizon are left out; what they settled for the rest goes as the history.
  const carried = agents.filter(entry => entry.status === 'running' || room.now - (entry.endedAt ?? entry.lastActivityAt) < horizon)
  const flow = shadows.filter(entry => entry.status === 'running' || room.now - (entry.endedAt ?? entry.lastSeen) < horizon)

  return {
    ...room,
    history: historyOf(agents, shadows, room.now, new Set([...carried, ...flow].map(entry => entry.id))),
    agents: carried.map(entry => defined<SceneActorInput>({
      id: entry.id,
      type: entry.type,
      startedAt: entry.startedAt,
      lastActivityAt: entry.lastActivityAt,
      status: entry.status,
      parentId: entry.parentId,
      endedAt: entry.endedAt,
      currentTool: entry.currentTool,
      awaitingPermission: entry.awaitingPermission,
      effort: entry.effort,
      readingSince: entry.readingSince,
    })),
    shadows: flow.map(entry => defined<SceneShadowInput>({
      id: entry.id,
      firstSeen: entry.firstSeen,
      visibleAt: entry.visibleAt,
      lastSeen: entry.lastSeen,
      steps: entry.steps,
      toolCalls: entry.toolCalls,
      status: entry.status,
      endedAt: entry.endedAt,
      currentTool: entry.currentTool,
      effort: entry.effort,
      readingSince: entry.readingSince,
    })),
    hud: defined({
      contextPercent: percent,
      effort: hud?.session?.effort,
      startedAt: hud?.session?.startedAt,
      toolRunning: hud?.tools?.current !== undefined ? true : undefined,
    }),
  }
}

/** The scene at `now` from the smooth scene's props: `sceneOf` over them, as the hooks would draw it. */
export const sceneFromInputs = (inputs: SceneInputs, now: number): MascotScene => {
  const agents: AgentBoardEntry[] = inputs.agents.map(one => ({ description: '', background: false, toolCalls: 0, ...one }))
  const hud: HudData = {
    now,
    session: defined({ effort: inputs.hud.effort, startedAt: inputs.hud.startedAt }),
    ...(inputs.hud.contextPercent === undefined ? {} : { usage: { contextPercent: inputs.hud.contextPercent, rateLimits: [], compactions: 0 } }),
    ...(inputs.hud.toolRunning === true ? { tools: { current: { name: 'tool', since: now }, counts: {} } } : {}),
  }

  return sceneOf(agents, hud, now, {
    stalledMs: inputs.stalledMs,
    main: inputs.main,
    shadows: inputs.shadows as ShadowAgentEntry[],
    scenes: inputs.scenes,
    events: inputs.events,
    ...(inputs.history === undefined ? {} : { history: inputs.history }),
    ...(inputs.character === undefined ? {} : { character: inputs.character }),
  })
}
