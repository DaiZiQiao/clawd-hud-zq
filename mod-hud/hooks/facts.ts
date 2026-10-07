import type { ModelUsage, SessionContextBreakdown, SessionContextUsage, SessionCost, SessionRateLimit, Settings } from 'claude-code'

import type {
  HudData,
  HudGitFacts,
  HudInventoryFacts,
  HudMainFacts,
  HudRateLimitFact,
  HudSessionFacts,
  HudTodoFacts,
  HudTodoItemFact,
  HudTokenFacts,
  HudToolFacts,
  HudUsageFacts,
} from '../types'
import { defined } from './state-json'

// The HUD's facts, shaped: pure helpers with no `$`. The hooks in register.tsx
// gather what the engine says and keep it in `$.state`; these parse it, fold it
// in, and assemble what the renderer draws.

/** Every fact the HUD keeps, one `$.state` value per key. */
export type HudFacts = {
  session: HudSessionFacts
  usage: HudUsageFacts
  git: HudGitFacts
  tools: HudToolFacts
  todos: HudTodoFacts
  inventory: HudInventoryFacts
}

/** What each fact reads as before anything is known. */
export const NO_FACTS: HudFacts = {
  session: {},
  usage: { rateLimits: [], compactions: 0 },
  git: {},
  tools: { counts: {} },
  todos: { items: [] },
  inventory: { mcpServers: [] },
}

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

/** Deep equality over JSON values, where a key held as `undefined` counts as absent. */
export const sameFacts = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const left = Object.entries(a).filter(([, one]) => one !== undefined)
  const right = Object.entries(b).filter(([, one]) => one !== undefined)
  if (left.length !== right.length) return false
  const other = b as Record<string, unknown>

  return left.every(([key, one]) => sameFacts(one, other[key]))
}

// --- git ---------------------------------------------------------------------

/** A `git status` reading, without the time it was taken. */
export type GitReading = Omit<HudGitFacts, 'at'>

/**
 * Counts `git status --porcelain=v2 --branch` output: the branch (the short
 * commit on a detached HEAD), ahead and behind when there is an upstream, and
 * the changed paths: every entry (`?` untracked included, `!` ignored not),
 * those added (`A`, or untracked) and those deleted (`D`).
 */
export const parseGitStatus = (stdout: string): GitReading => {
  let head: string | undefined
  let oid: string | undefined
  let ahead: number | undefined
  let behind: number | undefined
  let dirty = 0
  let added = 0
  let deleted = 0
  for (const line of stdout.split('\n')) {
    if (line.startsWith('# ')) {
      const [key = '', ...rest] = line.slice(2).split(' ')
      const value = rest.join(' ').trim()
      if (key === 'branch.head') head = value
      else if (key === 'branch.oid') oid = value
      else if (key === 'branch.ab') {
        const counts = /^\+(\d+) -(\d+)$/.exec(value)
        if (counts !== null) {
          ahead = Number(counts[1])
          behind = Number(counts[2])
        }
      }
    } else if (line.startsWith('? ')) {
      dirty += 1
      added += 1
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const xy = line.slice(2, 4)
      dirty += 1
      if (xy.includes('A')) added += 1
      if (xy.includes('D')) deleted += 1
    } else if (line.startsWith('u ')) {
      dirty += 1
    }
  }
  const detached = head === '(detached)'
  const branch = !detached
    ? head || undefined
    : oid !== undefined && /^[0-9a-f]{7,}$/.test(oid) ? oid.slice(0, 7) : undefined

  return defined({ branch, dirty, added, deleted, ahead, behind })
}

/** `git diff --shortstat HEAD`: the lines inserted and deleted (each 0 when the line leaves it out); undefined for anything else. */
export const parseShortstat = (stdout: string): { linesAdded: number; linesDeleted: number } | undefined => {
  const text = stdout.trim()
  if (text === '') return { linesAdded: 0, linesDeleted: 0 }
  if (!/files? changed/.test(text)) return undefined
  const added = /(\d+) insertions?\(\+\)/.exec(text)
  const deleted = /(\d+) deletions?\(-\)/.exec(text)

  return { linesAdded: added === null ? 0 : Number(added[1]), linesDeleted: deleted === null ? 0 : Number(deleted[1]) }
}

/**
 * `git log -1 --format=%ct`: the commit time in milliseconds, from the last
 * line that is all digits (with `log.showSignature` on, git prints the
 * signature's check before it); undefined when there is none.
 */
export const parseCommitTime = (stdout: string): number | undefined => {
  const text = stdout.split('\n').map(line => line.trim()).filter(line => /^\d+$/.test(line)).at(-1)
  if (text === undefined) return undefined
  const ms = Number(text) * 1000

  return ms > 0 ? ms : undefined
}

/** The held facts when the reading says the same, else the reading stamped `now`. */
export const gitFactsOf = (held: HudGitFacts, reading: GitReading, now: number): HudGitFacts => {
  const { at: _at, ...last } = held

  return sameFacts(last, reading) ? held : { ...reading, at: now }
}

// --- timing ------------------------------------------------------------------

/** A timer as `$.clock.after` hands it back. */
export type Cancellable = { cancel: () => void }

/** `$.clock.after`'s shape: call `fn` once after `ms`. */
export type Schedule = (ms: number, fn: () => void) => Cancellable

export type Debouncer = {
  /**
   * Asks for a run: one is scheduled `windowMs` on (with `leading`, as soon as
   * the window since the last run allows, which may be at once), and every
   * request until it fires folds into it.
   */
  request: (now: number, schedule: Schedule, run: () => void, options?: { leading?: boolean }) => 'scheduled' | 'coalesced'
  /** Changes the window and drops a queued run, preserving the last run time. */
  setWindow: (ms: number) => void
  /** Drops the scheduled run, if any. */
  cancel: () => void
}

/**
 * At most one run per `windowMs`, always from a timer. A scheduled run that
 * never fired (its timer refused, or lost to a reload) is given up once it is
 * a whole window overdue, so a lost timer cannot stop the runs for good.
 */
export const debouncer = (windowMs: number): Debouncer => {
  let pending: { timer: Cancellable; dueAt: number } | undefined
  let lastRunAt: number | undefined
  const cancel = (): void => {
    pending?.timer.cancel()
    pending = undefined
  }

  return {
    request: (now, schedule, run, options = {}) => {
      if (pending !== undefined && now < pending.dueAt + windowMs) return 'coalesced'
      cancel()
      // A last run "after" now is another clock's: read it as no run at all.
      const since = lastRunAt === undefined || lastRunAt > now ? windowMs : now - lastRunAt
      const wait = options.leading === true ? Math.max(0, windowMs - since) : windowMs
      const dueAt = now + wait
      const timer = schedule(wait, () => {
        if (pending?.timer !== timer) return
        pending = undefined
        lastRunAt = dueAt
        run()
      })
      pending = { timer, dueAt }

      return 'scheduled'
    },
    setWindow: ms => {
      cancel()
      windowMs = ms
    },
    cancel,
  }
}

/** Whether a fact last read at `lastAt` may be read again: `everyMs` has passed, or it never was. */
export const throttleDue = (lastAt: number | undefined, now: number, everyMs: number): boolean =>
  lastAt === undefined || now < lastAt || now - lastAt >= everyMs

// --- session -----------------------------------------------------------------

/** 'gateway' when `ANTHROPIC_BASE_URL` holds anything, else nothing. */
export const providerOf = (baseUrl: string | undefined): 'gateway' | undefined =>
  baseUrl !== undefined && baseUrl.trim() !== '' ? 'gateway' : undefined

/** An effort as `turn.step` or the settings spell it: a level, or a number. */
export const effortOf = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim()

  return finite(value) === undefined ? undefined : String(value)
}

/**
 * The effort the settings give `model`: `modelSettings[model].effortLevel`
 * (the model as `/model` names it, or without its `[1m]`-style suffix), else
 * the top-level `effortLevel`.
 */
export const effortFromSettings = (settings: Settings | undefined, model: string | undefined): string | undefined => {
  const perModel = recordOf(settings?.modelSettings)
  if (perModel !== undefined && model !== undefined) {
    for (const key of new Set([model, model.replace(/\[[^\]]*\]$/, '')])) {
      const effort = effortOf(recordOf(perModel[key])?.effortLevel)
      if (effort !== undefined) return effort
    }
  }

  return effortOf(settings?.effortLevel)
}

// --- the prompt cache ----------------------------------------------------------

/** The prompt cache's lifetimes, in milliseconds. */
export const CACHE_TTL_MS: Readonly<Record<'5m' | '1h', number>> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }

const isOn = (value: string | undefined): boolean => value !== undefined && /^(?:1|true|yes|on)$/i.test(value.trim())
const isSet = (value: string | undefined): boolean => value !== undefined && value.trim() !== ''
const ttlIn = (value: unknown): '5m' | '1h' | undefined => (value === '5m' || value === '1h' ? value : undefined)

/** The environment variables `cacheTtlOf` reads. */
export const CACHE_ENV = [
  'DISABLE_PROMPT_CACHING',
  'FORCE_PROMPT_CACHING_5M',
  'CLAUDE_CODE_PROMPT_CACHE_TTL',
  'ENABLE_PROMPT_CACHING_1H',
  'ENABLE_PROMPT_CACHING_1H_BEDROCK',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  'CLAUDE_CODE_USE_MANTLE',
] as const

/** The partner clouds' switches: any of them on, no Claude subscription is in use. */
const PARTNER_ENV = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  'CLAUDE_CODE_USE_MANTLE',
] as const

/** The settings `cacheTtlOf` reads, as `$.settings.read()` hands them back. */
export type CacheSettings = { promptCacheTtl?: unknown; apiKeyHelper?: unknown }

/** The main prompt cache's TTL as inferred, and whether that is a guess (`assumed`). */
export type CacheTtl = { ttl: '5m' | '1h' | 'off'; assumed?: true }

/**
 * The main conversation's prompt-cache TTL, inferred the way Claude Code
 * 2.1.292 picks it for the main thread: `off` with DISABLE_PROMPT_CACHING;
 * 5m with FORCE_PROMPT_CACHING_5M; else CLAUDE_CODE_PROMPT_CACHE_TTL, else the
 * `promptCacheTtl` setting; 1h with ENABLE_PROMPT_CACHING_1H (any provider),
 * or on Bedrock with ENABLE_PROMPT_CACHING_1H_BEDROCK. Else automatic: 1h only
 * for a Claude subscription's OAuth login within its limits, 5m for anything
 * else. An API key or auth token in the environment, an API key file
 * descriptor, an `apiKeyHelper` setting or a partner cloud rule the
 * subscription out: 5m, certain. A base URL usually means a gateway: 5m, but
 * assumed (a proxy in front of a subscription still gets 1h). With none of
 * these, 1h is assumed: a Console (API-key) login, or a subscription drawing on
 * usage credits past its limits, gets 5m, and neither is readable by a mod.
 */
export const cacheTtlOf = (env: Readonly<Record<string, string | undefined>>, stored?: CacheSettings): CacheTtl => {
  if (isOn(env.DISABLE_PROMPT_CACHING)) return { ttl: 'off' }
  if (isOn(env.FORCE_PROMPT_CACHING_5M)) return { ttl: '5m' }
  const chosen = ttlIn(env.CLAUDE_CODE_PROMPT_CACHE_TTL?.trim()) ?? ttlIn(stored?.promptCacheTtl)
  if (chosen !== undefined) return { ttl: chosen }
  if (isOn(env.ENABLE_PROMPT_CACHING_1H) || (isOn(env.CLAUDE_CODE_USE_BEDROCK) && isOn(env.ENABLE_PROMPT_CACHING_1H_BEDROCK))) return { ttl: '1h' }
  const helper = typeof stored?.apiKeyHelper === 'string' && stored.apiKeyHelper.trim() !== ''
  const viaApi = isSet(env.ANTHROPIC_API_KEY) || isSet(env.ANTHROPIC_AUTH_TOKEN) || isSet(env.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR)
    || helper || PARTNER_ENV.some(name => isOn(env[name]))
  if (viaApi) return { ttl: '5m' }

  return isSet(env.ANTHROPIC_BASE_URL) ? { ttl: '5m', assumed: true } : { ttl: '1h', assumed: true }
}

/** The environment variables that switch auto-compaction off (DISABLE_COMPACT turns off `/compact` too). */
export const COMPACT_ENV = ['DISABLE_AUTO_COMPACT', 'DISABLE_COMPACT'] as const

/** False when the environment or the `autoCompactEnabled` setting switch auto-compaction off; undefined otherwise. */
export const autoCompactOf = (env: Readonly<Record<string, string | undefined>> | undefined, stored?: { autoCompactEnabled?: unknown }): false | undefined =>
  COMPACT_ENV.some(name => isOn(env?.[name])) || stored?.autoCompactEnabled === false ? false : undefined

// --- usage -------------------------------------------------------------------

const RATE_LIMIT_KINDS: readonly HudRateLimitFact['kind'][] = ['five_hour', 'seven_day', 'spend_limit']

/** The windows of a kind the HUD knows, each with a usable percentage. */
export const rateLimitsOf = (list: readonly SessionRateLimit[] | undefined): HudRateLimitFact[] =>
  (list ?? []).flatMap(one => {
    const kind = RATE_LIMIT_KINDS.find(known => known === one.kind)
    const percentUsed = finite(one.percentUsed)
    if (kind === undefined || percentUsed === undefined) return []

    return [defined<HudRateLimitFact>({ kind, percentUsed, resetsAt: typeof one.resetsAt === 'string' ? one.resetsAt : undefined })]
  })

/** What `session.measure` and `$.session.usage()` both carry. */
export type Measured = {
  context?: SessionContextUsage
  rateLimits?: readonly SessionRateLimit[]
  cost?: SessionCost
}

/**
 * The windows a reading reports, and each held one it does not: a response
 * that carries no rate limits (one a gateway answered for another provider)
 * says nothing of them. A held window goes once it has reset (at `now`), as
 * its reading no longer holds; one with no reset time stays.
 */
export const keptLimits = (held: readonly HudRateLimitFact[], fresh: readonly HudRateLimitFact[], now?: number): HudRateLimitFact[] => {
  const reported = new Set(fresh.map(one => one.kind))
  const current = (one: HudRateLimitFact): boolean => {
    const at = one.resetsAt === undefined ? Number.NaN : Date.parse(one.resetsAt)

    return now === undefined || !Number.isFinite(at) || at > now
  }
  const kept = held.filter(one => !reported.has(one.kind) && current(one))

  return RATE_LIMIT_KINDS.flatMap(kind => [...fresh, ...kept].filter(one => one.kind === kind).slice(0, 1))
}

/**
 * The usage with the context and cost replaced by a measurement's, a figure
 * it leaves out (no response yet, no ledger) going too; the rate limits it
 * reports replace those held, the rest kept until they reset (`keptLimits`).
 * With `now`, a limit whose percent changed is sampled for its burn.
 */
export const applyMeasure = (usage: HudUsageFacts, measured: Measured, now?: number): HudUsageFacts => {
  const fresh = rateLimitsOf(measured.rateLimits)
  const rateLimits = keptLimits(usage.rateLimits, fresh, now)
  const sampled = now === undefined ? usage.limitSamples : limitSamplesAfter(usage.limitSamples, fresh, now)
  // A window no longer held (it reset) takes its samples with it.
  const samples = sampled === undefined ? undefined : Object.fromEntries(Object.entries(sampled).filter(([kind]) => rateLimits.some(one => one.kind === kind)))

  return defined({
    ...usage,
    contextTokens: finite(measured.context?.tokens),
    contextPercent: finite(measured.context?.percent),
    window: finite(measured.context?.window),
    rateLimits,
    costUsd: finite(measured.cost?.usd),
    limitSamples: samples === undefined || Object.keys(samples).length === 0 ? undefined : samples,
  })
}

const NO_TOKENS: HudTokenFacts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

export const counted = (value: unknown): number => {
  const n = finite(value)

  return n === undefined || n <= 0 ? 0 : Math.floor(n)
}

/**
 * One response's token counts (a request's, a compaction's) added to the
 * session's; the usage as it was when the response reported none. With
 * `mainAt` (a main-loop request: when it was sent, the best point the hooks
 * see before the API reads or writes the cache) the prompt cache's clock
 * restarts and the turn's own tokens count it too.
 */
export const addTokens = (usage: HudUsageFacts, spent: ModelUsage | null | undefined, mainAt?: number): HudUsageFacts => {
  if (spent === null || spent === undefined) return usage
  const more: HudTokenFacts = {
    input: counted(spent.input_tokens),
    output: counted(spent.output_tokens),
    cacheRead: counted(spent.cache_read_input_tokens),
    cacheWrite: counted(spent.cache_creation_input_tokens),
  }
  if (more.input + more.output + more.cacheRead + more.cacheWrite === 0) return usage
  const held = usage.tokens ?? NO_TOKENS
  const main = finite(mainAt) === undefined
    ? {}
    : { mainRequestAt: mainAt, turnTokens: (usage.turnTokens ?? 0) + more.input + more.cacheWrite + more.output }

  return {
    ...usage,
    ...main,
    tokens: {
      input: held.input + more.input,
      output: held.output + more.output,
      cacheRead: held.cacheRead + more.cacheRead,
      cacheWrite: held.cacheWrite + more.cacheWrite,
    },
  }
}

/** One more compaction; the context fill is unknown until the next response. */
export const afterCompaction = (usage: HudUsageFacts): HudUsageFacts =>
  defined({ ...usage, compactions: usage.compactions + 1, contextTokens: undefined, contextPercent: undefined })

/**
 * A `/clear`: the conversation's compactions, context fill, tokens, turns,
 * context samples, last turn and cache clock start over; the window, the
 * rate limits (and their samples) and the cost stay, the next turn's cost
 * measured from it.
 */
export const afterClear = (usage: HudUsageFacts): HudUsageFacts =>
  defined({
    ...usage,
    compactions: 0,
    contextTokens: undefined,
    contextPercent: undefined,
    tokens: undefined,
    turns: undefined,
    busyMs: undefined,
    contextSamples: undefined,
    mainRequestAt: undefined,
    turnTokens: undefined,
    lastTurn: undefined,
    // The next turn's cost runs from here.
    costAtTurnEnd: usage.costUsd,
  })

// --- the session's pace --------------------------------------------------------
// What the Session tab's Overview reads: turns, the context's growth, the
// limits' burn. Each sample is taken with a write the HUD makes anyway (a main
// turn's end, a changed limit), never on a tick.

/** The context samples kept: eleven, for the last ten turns' deltas. */
export const CONTEXT_SAMPLES = 11
/** A limit's burn is read over this window. */
export const LIMIT_WINDOW_MS = 30 * 60_000
const LIMIT_SAMPLES_MAX = 32

/**
 * A main turn ended after `durationMs`: one more turn, its time busy, the
 * context's tokens sampled when known, and the turn kept as `lastTurn` (what
 * the session spent since the turn before ended, how long it ran, its tokens).
 * The cost is measured from `costAtTurnEnd`, seeded when the mod first reads
 * the session's cost (`seedTurnBaseline`); with no baseline the turn's cost is
 * left out, and this turn's end becomes the next one's baseline.
 */
export const afterMainTurn = (usage: HudUsageFacts, durationMs?: number): HudUsageFacts => {
  const tokens = finite(usage.contextTokens)
  const samples = tokens === undefined ? usage.contextSamples : [...(usage.contextSamples ?? []), Math.floor(tokens)].slice(-CONTEXT_SAMPLES)
  const spent = finite(durationMs)
  const cost = finite(usage.costUsd)
  const lastTurn = defined({
    // No baseline yet (the mod loaded mid-session and could not read the cost then): no cost, rather than the whole session's.
    costUsd: cost === undefined || usage.costAtTurnEnd === undefined ? undefined : Math.max(0, cost - usage.costAtTurnEnd),
    durationMs: spent === undefined || spent <= 0 ? undefined : Math.round(spent),
    tokens: usage.turnTokens,
  })

  return defined({
    ...usage,
    turns: (usage.turns ?? 0) + 1,
    busyMs: spent === undefined || spent <= 0 ? usage.busyMs : (usage.busyMs ?? 0) + Math.round(spent),
    contextSamples: samples,
    costAtTurnEnd: cost ?? usage.costAtTurnEnd,
    turnTokens: undefined,
    lastTurn: Object.keys(lastTurn).length === 0 ? undefined : lastTurn,
  })
}

/**
 * The first cost the mod reads (at start, or after a reload mid-session) is
 * the next turn's baseline, so that turn's `last` is its own cost and not the
 * whole session's; a baseline already held stays.
 */
export const seedTurnBaseline = (usage: HudUsageFacts): HudUsageFacts => {
  const cost = finite(usage.costUsd)

  return usage.costAtTurnEnd !== undefined || cost === undefined ? usage : { ...usage, costAtTurnEnd: cost }
}

/** The context's mean growth per turn over the samples (a compaction's drop left out); undefined with no growth seen. */
export const contextGrowth = (samples: readonly number[] | undefined): number | undefined => {
  const deltas: number[] = []
  const list = samples ?? []
  for (let index = 1; index < list.length; index += 1) {
    const delta = (list[index] ?? 0) - (list[index - 1] ?? 0)
    if (delta >= 0) deltas.push(delta)
  }
  if (deltas.length === 0) return undefined
  const mean = deltas.reduce((sum, one) => sum + one, 0) / deltas.length

  return mean > 0 ? mean : undefined
}

/** Turns until the context reaches `cap` at `perTurn`, at least one; undefined without growth or a cap above it. */
export const turnsUntil = (used: number | undefined, cap: number | undefined, perTurn: number | undefined): number | undefined => {
  if (used === undefined || cap === undefined || perTurn === undefined || perTurn <= 0 || cap <= 0) return undefined

  return Math.max(1, Math.ceil((cap - used) / perTurn))
}

type LimitSamples = NonNullable<HudUsageFacts['limitSamples']>

/**
 * The limits' samples with each fresh reading's percent appended when it
 * changed (a drop, a reset, starts the list over); the samples are trimmed to
 * the window (and the one before it) only then, so an unchanged reading
 * rewrites nothing.
 */
export const limitSamplesAfter = (held: LimitSamples | undefined, fresh: readonly HudRateLimitFact[], now: number): LimitSamples | undefined => {
  let next = held
  for (const one of fresh) {
    const list = held?.[one.kind] ?? []
    const last = list.at(-1)
    if (last !== undefined && last.percent === one.percentUsed) continue
    const base = last !== undefined && one.percentUsed < last.percent ? [] : list
    const older = base.filter(sample => now - sample.at > LIMIT_WINDOW_MS)
    const kept = [...older.slice(-1), ...base.filter(sample => now - sample.at <= LIMIT_WINDOW_MS), { at: now, percent: one.percentUsed }].slice(-LIMIT_SAMPLES_MAX)
    next = { ...next, [one.kind]: kept }
  }

  return next
}

/**
 * How long until a window at `percent` reaches 100 at its burn over the last
 * 30 minutes, in ms; undefined without three samples spanning five minutes,
 * or while it is not rising. The percent at the
 * window's start is the newest sample before it, else the oldest held.
 */
export const limitEta = (samples: readonly { at: number; percent: number }[] | undefined, percent: number, now: number): number | undefined => {
  const list = samples ?? []
  if (list.length < 3 || percent >= 100 || (list.at(-1)?.at ?? 0) - (list[0]?.at ?? 0) < 5 * 60_000) return undefined
  const before = list.filter(sample => now - sample.at > LIMIT_WINDOW_MS).at(-1)
  const base = before ?? list[0]
  if (base === undefined) return undefined
  const span = before === undefined ? now - base.at : LIMIT_WINDOW_MS
  const rate = span > 0 ? (percent - base.percent) / span : 0

  return rate > 0 ? (100 - percent) / rate : undefined
}

/**
 * The main loop's busy and idle time over the session's `duration`: its ended
 * turns' time, and the turn running now (`main.busySince`, kept
 * whatever the options); idle is the rest. Undefined before any time passed.
 */
export const busyIdleOf = (usage: HudUsageFacts, main: HudMainFacts | undefined, duration: number | undefined, now: number): { busy: number; idle: number } | undefined => {
  if (duration === undefined || duration <= 0) return undefined
  const running = main?.busySince === undefined ? 0 : Math.max(0, now - main.busySince)
  const busy = Math.min(duration, (usage.busyMs ?? 0) + running)

  return { busy, idle: Math.max(0, duration - busy) }
}

// --- models -------------------------------------------------------------------

/** `claude-sonnet-5-5-20260101` (or `claude-opus-5-5[1m]`) reads as `sonnet-5-5`. */
export const shortModel = (model: string | undefined): string | undefined =>
  model === undefined || model === ''
    ? undefined
    : model
        .replace(/\[[^\]]*\]$/, '')
        .replace(/^(?:[a-z]+\.)?anthropic\./, '')
        .replace(/-v\d+(?::\d+)?$/, '')
        .replace(/^claude-/, '')
        .replace(/-\d{8}$/, '')
        .replace(/@\d{8}$/, '')

// --- tools and todos ---------------------------------------------------------

/** A call starting: it is the current tool (with its main argument, when it has one), and its count goes up. */
export const toolStarted = (tools: HudToolFacts, name: string, id: string | undefined, now: number, arg?: string): HudToolFacts =>
  defined({
    ...tools,
    current: defined({ name, since: now, id, arg: arg === undefined || arg === '' ? undefined : arg }),
    counts: { ...tools.counts, [name]: (tools.counts[name] ?? 0) + 1 },
  })

/** The tools whose calls edit a file: their `file_path` (or `notebook_path`) counts for the `now` row's `N files edited`. */
export const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** The edited files kept: past this many, the oldest go (the count stays honest up to it). */
export const EDITED_MAX = 500

/** The file an edit call changed: its `file_path`, else its `notebook_path`; undefined for any other tool. */
export const editedPathOf = (tool: string, input: Readonly<Record<string, unknown>>): string | undefined => {
  if (!EDIT_TOOLS.has(tool)) return undefined
  const path = typeof input.file_path === 'string' ? input.file_path : input.notebook_path
  if (typeof path !== 'string' || path.trim() === '') return undefined

  return path.trim()
}

/** A file edited: added once to the list; the tools as they were when it is already there. */
export const fileEdited = (tools: HudToolFacts, path: string): HudToolFacts => {
  const held = tools.edited ?? []
  if (held.includes(path)) return tools

  return { ...tools, edited: [...held, path].slice(-EDITED_MAX) }
}

/** A call ending: the current tool clears if it is this call (by id, else by name). */
export const toolSettled = (tools: HudToolFacts, name: string, id: string | undefined): HudToolFacts => {
  const current = tools.current
  if (current === undefined) return tools
  const isThis = current.id !== undefined && id !== undefined ? current.id === id : current.name === name

  return isThis ? defined({ ...tools, current: undefined }) : tools
}

/** The main loop between tools: nothing is current. */
export const noCurrentTool = (tools: HudToolFacts): HudToolFacts =>
  tools.current === undefined ? tools : defined({ ...tools, current: undefined })

const TODO_STATUSES: readonly HudTodoItemFact['status'][] = ['pending', 'in_progress', 'completed']

/** TodoWrite's `todos`, the well-formed items kept; undefined when it is not a list. */
export const parseTodos = (value: unknown): HudTodoItemFact[] | undefined => {
  if (!Array.isArray(value)) return undefined

  return value.flatMap(one => {
    const item = recordOf(one)
    const status = TODO_STATUSES.find(known => known === item?.status)
    if (item === undefined || typeof item.content !== 'string' || status === undefined) return []

    return [defined<HudTodoItemFact>({
      content: item.content,
      status,
      activeForm: typeof item.activeForm === 'string' ? item.activeForm : undefined,
    })]
  })
}

/** The held list when the items are the same, else the items stamped `now`. */
export const todoFactsOf = (held: HudTodoFacts, items: HudTodoItemFact[], now: number): HudTodoFacts =>
  sameFacts(held.items, items) ? held : { items, at: now }

// --- inventory ---------------------------------------------------------------

/** The MCP servers (sorted, once each) and the skill count a breakdown names. */
export const inventoryOf = (breakdown: SessionContextBreakdown | undefined, now: number): HudInventoryFacts | undefined => {
  if (breakdown === undefined) return undefined
  const servers = (breakdown.mcpTools ?? [])
    .map(tool => tool.serverName)
    .filter((name): name is string => typeof name === 'string' && name !== '')

  return defined({
    mcpServers: [...new Set(servers)].sort(),
    skills: finite(breakdown.skills?.totalSkills),
    compactAt: breakdown.isAutoCompactEnabled === false ? undefined : finite(breakdown.autoCompactThreshold),
    autoCompact: breakdown.isAutoCompactEnabled === false ? false as const : undefined,
    at: now,
  })
}

// --- the renderer's input ----------------------------------------------------

/**
 * What the renderer draws, from the facts as held and the time now. The
 * prompt cache's TTL is `cacheTtl` (the option) unless that is `auto`, when
 * the one inferred at start stands; the cache is drawn once a main request
 * answered under a TTL that is not `off`.
 */
export const assembleHudData = (facts: HudFacts, now: number, cacheTtl: 'auto' | '5m' | '1h' = 'auto'): HudData => {
  const { at: _gitAt, ...git } = facts.git
  const { cacheTtl: _ttl, cacheTtlAssumed: _assumed, autoCompact: sessionCompact, ...session } = facts.session
  const current = facts.tools.current
  // The Session tab's counts are not the HUD's to draw; the samples are: the
  // context's for the ctx row's runway, the limits' for the alert strip's ETA.
  const { turns: _turns, busyMs: _busyMs, mainRequestAt: _at, turnTokens: _turnTokens, costAtTurnEnd: _costAt, contextSamples, limitSamples, lastTurn, ...usage } = facts.usage
  const edited = facts.tools.edited?.length ?? 0
  const ttl = cacheTtl === 'auto' ? facts.session.cacheTtl : cacheTtl
  // Only the inferred TTL can be a guess; one the option names is the person's word.
  const assumed = cacheTtl === 'auto' && facts.session.cacheTtlAssumed === true
  const cacheAt = facts.usage.mainRequestAt
  // Auto-compaction off (the environment, the settings, or the breakdown): no threshold, no runway.
  const compactOff = sessionCompact === false || facts.inventory.autoCompact === false

  return {
    session: defined({ ...session }),
    usage: defined({
      ...usage,
      rateLimits: [...usage.rateLimits],
      tokens: usage.tokens === undefined ? undefined : { ...usage.tokens },
      lastTurn: lastTurn === undefined ? undefined : { ...lastTurn },
      contextSamples: contextSamples === undefined || contextSamples.length === 0 ? undefined : [...contextSamples],
      limitSamples: limitSamples === undefined
        ? undefined
        : Object.fromEntries(Object.entries(limitSamples).map(([kind, list]) => [kind, (list ?? []).map(one => ({ ...one }))])),
    }),
    git: defined(git),
    tools: defined({
      current: current === undefined ? undefined : defined({ name: current.name, since: current.since, arg: current.arg }),
      counts: { ...facts.tools.counts },
      edited: edited > 0 ? edited : undefined,
    }),
    todos: { items: facts.todos.items.map(item => defined({ ...item })) },
    inventory: defined({
      mcpServers: [...facts.inventory.mcpServers],
      skills: facts.inventory.skills,
      compactAt: compactOff ? undefined : facts.inventory.compactAt,
      autoCompact: compactOff ? false as const : undefined,
    }),
    ...(cacheAt !== undefined && (ttl === '5m' || ttl === '1h') ? { cache: defined({ ttl, lastAt: cacheAt, assumed: assumed ? true as const : undefined }) } : {}),
    now,
  }
}
