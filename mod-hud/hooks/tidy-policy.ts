import { CACHE_TTL_MS, cacheCoolAt } from './facts'
import { pricesAt } from './prices'
import type { Prices } from './prices'

// The cost and safe-point rules. All inputs are plain snapshots: the hooks
// gather evidence, these decide, and the scheduler acts after its final read.

/** Never offered below this many tokens, whatever `tidyAt` says: there is too little to save. */
export const TIDY_MIN = 40_000
/** Not now: offered again once the context holds this many tokens more. */
export const TIDY_AGAIN = 50_000
/** The result (or a failure) stays in the band this long. */
export const TIDY_RESULT_MS = 20_000
/** The summary the compaction writes, in tokens, for the estimate. */
export const TIDY_SUMMARY = 15_000
/** The context after a compaction, in tokens, for the estimate until one has been seen. */
export const TIDY_AFTER = 65_000
/** Fresh input after a compaction, in tokens, for the estimate until A+F has been measured. */
export const TIDY_FRESH = 20_000
/** The pause before automatic D1 without work-list tools, up to the short TTL's cooling window. */
export const TIDY_SETTLE_MS = CACHE_TTL_MS['5m'] - cacheCoolAt(CACHE_TTL_MS['5m'])

export type TidyCostInputs = {
  model?: string
  /** S: the last main response's whole input side, in tokens. */
  tokens: number
  /** A, F and Os: calibrated or default token counts. */
  after?: number
  fresh?: number
  summary?: number
  ttl: '5m' | '1h' | 'off'
  assumed?: boolean
  gapMs?: number
  miss?: boolean
}

export type TidyCosts = {
  K: number
  s: number
  coldCost: number
  /** coldCost(TTL): the avoided cold write, used by warm D2. */
  coldCostAtTtl: number
  cold: boolean
  /** Undefined means never: each later request saves nothing. Negative is valid when cold. */
  payback?: number
}

const writePrice = (rate: Prices, ttl: '5m' | '1h'): number => ttl === '1h' ? rate.write1h : rate.write5m

/**
 * K, s, coldCost(gap) and payback(gap), in dollars and main requests.
 * A measured A+F is passed as `after` with `fresh: 0`: the whole input side
 * of the first main request after a compaction, not the estimated tokensAfter.
 */
export const tidyCostsOf = ({ model, tokens, after = TIDY_AFTER, fresh = TIDY_FRESH, summary = TIDY_SUMMARY, ttl, assumed = false, gapMs = 0, miss = false }: TidyCostInputs): TidyCosts | undefined => {
  if (ttl === 'off' || ![tokens, after, fresh, summary, gapMs].every(value => Number.isFinite(value) && value >= 0)) return undefined
  const source = pricesAt(model, tokens)
  const compacted = pricesAt(model, after + fresh)
  if (source === undefined || compacted === undefined) return undefined
  const S = tokens / 1_000_000
  const C = (after + fresh) / 1_000_000
  const Os = summary / 1_000_000
  // A guessed TTL never makes tidying look cheaper: largest K, smallest coldCost.
  const cacheTtl = assumed ? '5m' : ttl
  const nextWrite = writePrice(compacted, assumed ? '1h' : ttl)
  const cold = gapMs >= CACHE_TTL_MS[cacheTtl]
  const K = source.read * S + source.output * Os + nextWrite * C + (miss ? (source.write5m - source.read) * S : 0)
  const s = source.read * S - compacted.read * C
  const coldCostAtTtl = writePrice(source, cacheTtl) * S
  const coldCost = cold ? coldCostAtTtl : 0

  return { K, s, coldCost, coldCostAtTtl, cold, payback: s <= 0 ? undefined : Math.ceil((K - coldCost) / s - 1e-9) }
}

export type TidyRule = 'D1' | 'D2' | 'D3'

/** Estimated saving for one due rule; cold D3 must be priced with its miss term. */
export const tidySavingOf = (rule: TidyRule, costs: TidyCosts, requests: number): number =>
  Math.max(0, rule === 'D1' ? requests * costs.s - costs.K : rule === 'D2' ? costs.coldCostAtTtl - costs.K : requests * costs.s + costs.coldCost - costs.K)

export type TidyPolicyInputs = TidyCostInputs & {
  mode: 'ask' | 'auto' | 'off'
  at: number
  requests: number
  mainBusy?: boolean
  dismissedAt?: number
  lastAfter?: number
  /** Cancel for D2 suppresses this gap until a new main request starts it. */
  coolingDismissed?: boolean
  windowSource?: string
  compactDisabled?: boolean
  interactive: boolean
  promptCacheWorking: boolean
  /** False for auto-compact off, a teammate, or an unsupported/unknown surface. */
  autoAllowed: boolean
}

export type TidyDue =
  | { rule: TidyRule; saving: number; automatic: boolean; costs: TidyCosts }
  | { rule: 'advisory'; automatic: false; why: 'unpriced' | 'cache'; saving?: never; costs?: never }

/** All due rules, D1 then D2 (or cold D3); the scheduler may prefer an automatic rule. */
export const tidyDueOf = (inputs: TidyPolicyInputs): TidyDue[] => {
  const { mode, tokens, at, requests, mainBusy, dismissedAt, lastAfter, windowSource } = inputs
  if (mode === 'off' || inputs.compactDisabled === true || !inputs.interactive
    || !Number.isFinite(tokens) || !Number.isFinite(at) || !Number.isFinite(requests) || requests < 0
    || tokens < Math.max(at, TIDY_MIN)
    || (dismissedAt !== undefined && tokens < dismissedAt + TIDY_AGAIN)
    || (lastAfter !== undefined && tokens < lastAfter + TIDY_AGAIN)) return []
  const costs = tidyCostsOf(inputs)
  const why = inputs.ttl === 'off' || !inputs.promptCacheWorking ? 'cache' : pricesAt(inputs.model, tokens) === undefined ? 'unpriced' : undefined
  if (why !== undefined) return mainBusy === true ? [] : [{ rule: 'advisory', automatic: false, why }]
  if (costs === undefined) return []
  const auto = mode === 'auto' && inputs.autoAllowed
  const due: TidyDue[] = []
  const add = (rule: TidyRule, priced: TidyCosts, automatic: boolean): void => {
    // An automatic rule can wait for the main loop; an offer is shown only idle.
    if (!automatic && mainBusy === true) return
    due.push({ rule, saving: tidySavingOf(rule, priced, requests), automatic, costs: priced })
  }
  if (costs.cold) {
    const missed = tidyCostsOf({ ...inputs, miss: true })
    if (missed?.payback !== undefined && missed.payback <= requests) add('D3', missed, false)

    return due
  }
  if (costs.payback !== undefined && costs.payback <= requests) add('D1', costs, auto && windowSource !== 'env' && windowSource !== 'settings')
  if (inputs.assumed !== true && inputs.ttl !== 'off' && inputs.gapMs !== undefined && inputs.coolingDismissed !== true) {
    const ttlMs = CACHE_TTL_MS[inputs.ttl]
    const coolMs = cacheCoolAt(ttlMs)
    if (ttlMs - inputs.gapMs <= coolMs && costs.coldCostAtTtl >= costs.K) add('D2', costs, auto && costs.coldCostAtTtl >= 2 * costs.K)
  }

  return due
}

export type TidyStopTaskKind = 'agent' | 'workflow' | 'job' | 'ignored' | 'unknown'

/** Stop's raw labels stay open; every unmapped kind fails closed. */
export const TIDY_STOP_TASK_KINDS: Readonly<Record<string, TidyStopTaskKind>> = {
  subagent: 'agent',
  teammate: 'agent',
  'cloud session': 'agent',
  workflow: 'workflow',
  shell: 'job',
  monitor: 'job',
  'MCP task': 'job',
  dream: 'ignored',
  'auto-mode scan': 'ignored',
  'memory import': 'ignored',
}

const stopTaskKind = (type: string): TidyStopTaskKind => Object.hasOwn(TIDY_STOP_TASK_KINDS, type) ? TIDY_STOP_TASK_KINDS[type] ?? 'unknown' : 'unknown'

export type TidyStopSnapshot = {
  at: number
  requestAt?: number
  tasks: readonly { id: string; type: string; status: string }[]
  previousTaskIds: readonly string[]
  oneShotCrons: number
}

export type TidyAvailability = {
  autoCompact: boolean
  compactEnabled: boolean
  notTeammate: boolean
  bandSurfaces: boolean
  priced: boolean
  model?: string
  /** A guessed TTL permits D1/D3, not D2. The caller fills this for the pending rule. */
  ttlAllowed: boolean
  promptCacheWorking: boolean
}

/** Persisted gate state plus the live reads, filled once before synchronous evaluation. */
export type TidySafeSnapshot = {
  now: number
  phase: 'start' | 'poll' | 'final'
  countdownSince?: number
  /** Zero unless automatic D1 needs a pause without work-list tools. */
  settleMs: number
  idleSince: number
  userStarted?: true
  mainBusy: boolean
  lastTurnReason?: string
  mainRequestAt?: number
  stop?: TidyStopSnapshot
  /** Undefined (or a non-array at runtime) means the read failed, not an empty list. */
  agents?: readonly { id: string; status: string }[]
  workflowShadows: readonly { status: string; visible: boolean; live: boolean }[]
  toolsInFlight: number
  draft: 'empty' | 'nonempty' | 'unknown'
  queuedAt?: number
  compactionRunning: boolean
  compactionFinishedAt?: number
  openTodos: number
  openTasks: number
  interactive: boolean
  loadedAt: number
  bandDrawnAt?: number
  paneOpen: boolean
  availability: TidyAvailability
}

/** Waiting copy in display order; counts and the settle time are the variable text. */
export const TIDY_WAITING_REASONS = {
  compacting: 'a compaction is running',
  compacted: 'a compaction just finished',
  busy: 'Claude is working',
  interrupted: 'last turn was interrupted',
  error: 'last turn ended in an error',
  refused: 'last turn was refused',
  stop: 'the next turn to end',
  agentsUnknown: 'cannot read the agent list',
  agents: (n: number): string => `${n} ${n === 1 ? 'agent' : 'agents'} running`,
  workflow: 'a workflow running',
  unknownTask: 'unknown background work',
  background: 'a job started this turn',
  tool: 'a tool is running',
  draftUnknown: 'cannot read the prompt box',
  draft: 'you are typing',
  queued: 'a prompt is queued',
  todos: (n: number): string => `${n} ${n === 1 ? 'todo' : 'todos'} open`,
  tasks: (n: number): string => `${n} ${n === 1 ? 'task' : 'tasks'} open`,
  cron: 'a wakeup is scheduled',
  settle: (settleMs: number): string => `a ${Math.max(1, Math.ceil(settleMs / 60_000))}-min pause after the turn`,
  visible: 'the HUD is not on screen',
} as const

/** Failure and toggle copy: row 2 allows 46 columns, not the waiting-reason limit. */
export const TIDY_FEEDBACK_REASONS = {
  settingsUnreadable: 'cannot read your settings',
  startedWorking: 'Claude started working',
  startedWorkingRetry: 'Claude started working; try again',
  turnAlreadyRunning: 'a turn was already running',
  optionMissing: 'could not find the tidy option',
  optionLocked: 'locked by your organization',
  configChanged: 'kept your /config change',
  deferredOff: 'auto off when this turn ends',
  deferredOn: 'auto on when this turn ends',
  keptOn: 'auto stays on',
  keptOff: 'auto stays off',
  pendingOff: 'auto off at turn end',
  pendingOn: 'auto on at turn end',
  engineRefused: 'the engine refused it',
} as const

/** Availability copy follows waiting copy, in this order. */
export const TIDY_AVAILABILITY_REASONS = {
  interactive: 'not an interactive session',
  autoCompact: 'auto-compact is off in your settings',
  compactEnabled: 'compaction disabled (DISABLE_COMPACT)',
  notTeammate: 'teammate session',
  bandSurfaces: 'open on a surface without the band',
  priced: (model: string): string => `no price for ${model}`,
  ttlAllowed: 'TTL is a guess: set cacheTtl',
  promptCacheWorking: 'prompt cache not working here',
} as const

/** Every unmet condition in display order; no reasons means it is safe. */
export const tidySafeReasonsOf = (snapshot: TidySafeSnapshot): string[] => {
  const { now, stop, agents, availability } = snapshot
  if (snapshot.userStarted === true) return [
    ...(snapshot.compactionRunning ? [TIDY_WAITING_REASONS.compacting] : []),
    ...(snapshot.mainBusy ? [TIDY_WAITING_REASONS.busy] : []),
    ...(!availability.compactEnabled ? [TIDY_AVAILABILITY_REASONS.compactEnabled] : []),
  ]
  const freshStop = stop !== undefined && snapshot.mainRequestAt !== undefined && stop.requestAt === snapshot.mainRequestAt && stop.at <= now
  const tasks = (freshStop ? stop.tasks : []).filter(task => !['completed', 'failed', 'killed', 'stopped', 'done', 'idle'].includes(task.status.toLowerCase())).map(task => ({ ...task, kind: stopTaskKind(task.type) }))
  const agentsKnown = Array.isArray(agents)
  const activeAgents = new Set(tasks.filter(task => task.kind === 'agent').map(task => task.id))
  if (agentsKnown) for (const agent of agents) if (['pending', 'running', 'waiting'].includes(agent.status)) activeAgents.add(agent.id)
  const recentlyCompacted = snapshot.compactionFinishedAt !== undefined && now - snapshot.compactionFinishedAt >= 0 && now - snapshot.compactionFinishedAt < TIDY_RESULT_MS
  const bandVisible = snapshot.bandDrawnAt !== undefined && snapshot.bandDrawnAt >= Math.max(snapshot.loadedAt, snapshot.countdownSince ?? snapshot.loadedAt) && now - snapshot.bandDrawnAt >= 0 && now - snapshot.bandDrawnAt <= 10_000
  const blocked: Record<keyof typeof TIDY_WAITING_REASONS, number | boolean> = {
    compacting: snapshot.compactionRunning,
    compacted: !snapshot.compactionRunning && recentlyCompacted,
    busy: snapshot.mainBusy,
    interrupted: snapshot.lastTurnReason === 'aborted',
    error: snapshot.lastTurnReason === 'error',
    refused: snapshot.lastTurnReason === 'refusal',
    stop: !freshStop || !['answer', 'aborted', 'error', 'refusal'].includes(snapshot.lastTurnReason ?? ''),
    agentsUnknown: !agentsKnown,
    agents: activeAgents.size,
    workflow: tasks.some(task => task.kind === 'workflow') || snapshot.workflowShadows.some(shadow => shadow.status === 'running' && shadow.visible && shadow.live),
    unknownTask: tasks.some(task => task.kind === 'unknown'),
    background: tasks.some(task => task.kind === 'job' && !stop?.previousTaskIds.includes(task.id)),
    tool: snapshot.toolsInFlight > 0,
    draftUnknown: snapshot.draft !== 'empty' && snapshot.draft !== 'nonempty',
    draft: snapshot.draft === 'nonempty',
    queued: snapshot.queuedAt !== undefined,
    todos: snapshot.openTodos,
    tasks: snapshot.openTasks,
    cron: freshStop && stop.oneShotCrons > 0,
    settle: snapshot.settleMs > 0 ? Number.isFinite(snapshot.idleSince) ? Math.max(0, snapshot.settleMs - (now - snapshot.idleSince)) : snapshot.settleMs : 0,
    visible: snapshot.phase !== 'start' && !snapshot.paneOpen && !bandVisible,
  }
  const reasons = (Object.keys(TIDY_WAITING_REASONS) as (keyof typeof TIDY_WAITING_REASONS)[]).flatMap(key => {
    const value = blocked[key]
    if (!value) return []
    const reason = TIDY_WAITING_REASONS[key]

    return [typeof reason === 'function' ? reason(key === 'settle' ? snapshot.settleMs : Number(value)) : reason]
  })
  for (const key of Object.keys(TIDY_AVAILABILITY_REASONS) as (keyof typeof TIDY_AVAILABILITY_REASONS)[]) {
    if (key === 'interactive' ? snapshot.interactive : availability[key]) continue
    const reason = TIDY_AVAILABILITY_REASONS[key]
    reasons.push(typeof reason === 'function' ? reason(availability.model ?? 'unknown') : reason)
  }

  return reasons
}
