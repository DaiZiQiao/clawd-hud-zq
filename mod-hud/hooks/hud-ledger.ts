import type { ModelUsage } from 'claude-code'

import type { HudLedger, HudLedgerEntry, HudTokenFacts } from '../types'
import { counted, shortModel } from './facts'
import { defined } from './state-json'

// What each loop spent, by model (`mod-hud.ledger`): pure helpers with no
// `$`. The hooks in register.tsx book every request's tokens to the loop and
// model that made it, end its run and count failed calls; these fold the
// bookings in, compact old loops, and price the ledger for the Session tab's
// Cost tree and `/mod-hud facts`. Prices are estimates (`PRICES`).

/** USD per million tokens: fresh input, output, cache reads, cache writes (five-minute). */
export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number }

const price = (input: number, output: number, cacheRead: number): Price => ({ input, output, cacheRead, cacheWrite: input * 1.25 })

/**
 * Approximate list prices, USD per million tokens, by short model id. They are
 * an estimate for splitting the spend by model and agent only: Anthropic's
 * first-party rates as of late 2026, cache writes taken at 1.25× input; a
 * gateway, a partner cloud, fast mode or a discount prices differently.
 * `costUsd` from `$.session.usage()` stays the session's real total.
 */
export const PRICES: Readonly<Record<string, Price>> = {
  'fable-5-1': price(10, 50, 0.25),
  'fable-5': price(10, 50, 1),
  'mythos-5-1': price(10, 50, 0.25),
  'opus-5-5': price(4, 20, 0.2),
  'opus-5': price(5, 25, 0.5),
  'opus-4-8': price(5, 25, 0.5),
  'opus-4-7': price(5, 25, 0.5),
  'opus-4-6': price(5, 25, 0.5),
  'opus-4-5': price(5, 25, 0.5),
  'sonnet-5-5': price(2, 10, 0.2),
  'sonnet-5': price(2, 10, 0.2),
  'sonnet-4-6': price(3, 15, 0.3),
  'sonnet-4-5': price(3, 15, 0.3),
  'sonnet-4': price(3, 15, 0.3),
  '3-7-sonnet': price(3, 15, 0.3),
  'opus-4-1': price(15, 75, 1.5),
  'haiku-4-5': price(1, 5, 0.1),
}

// Unknown versions stay unpriced rather than borrowing a family's latest rate.
export const priceOf = (model: string): Price | undefined => PRICES[shortModel(model) ?? '']

export const costOf = (model: string, tokens: HudTokenFacts): number | undefined => {
  const rate = priceOf(model)
  if (rate === undefined) return undefined

  return (tokens.input * rate.input + tokens.output * rate.output + tokens.cacheRead * rate.cacheRead + tokens.cacheWrite * rate.cacheWrite) / 1_000_000
}

export const NO_LEDGER: HudLedger = { entries: {}, others: {} }
/** The most loops the ledger holds by name; past it, the oldest finished are compacted first. */
export const LEDGER_MAX = 500
/** A finished loop is compacted into its models' `others` this long after it ended. */
export const LEDGER_COMPACT_MS = 60 * 60_000

const tokensOf = (spent: ModelUsage): HudTokenFacts => ({
  input: counted(spent.input_tokens),
  output: counted(spent.output_tokens),
  cacheRead: counted(spent.cache_read_input_tokens),
  cacheWrite: counted(spent.cache_creation_input_tokens),
})

const plus = (a: HudTokenFacts | undefined, b: HudTokenFacts): HudTokenFacts => ({
  input: (a?.input ?? 0) + b.input,
  output: (a?.output ?? 0) + b.output,
  cacheRead: (a?.cacheRead ?? 0) + b.cacheRead,
  cacheWrite: (a?.cacheWrite ?? 0) + b.cacheWrite,
})

/** Who a loop is, when its first request is booked. */
export type LedgerWho = { kind: HudLedgerEntry['kind']; name?: string; description?: string; startedAt?: number }

const KIND_RANK: Readonly<Record<HudLedgerEntry['kind'], number>> = { fork: 0, workflow: 1, agent: 2, main: 3 }

/**
 * The ledger with one request's tokens booked to loop `id` (`main` for the
 * session's) under the model that answered; a finished loop that asks again
 * runs again. What is due for compaction goes in the same write.
 */
export const ledgerBooked = (ledger: HudLedger, id: string, spent: (ModelUsage & { model?: string }) | null | undefined, who: LedgerWho, now: number): HudLedger => {
  if (spent === null || spent === undefined) return ledger
  const more = tokensOf(spent)
  if (more.input + more.output + more.cacheRead + more.cacheWrite === 0) return ledger
  const model = typeof spent.model === 'string' && spent.model !== '' ? spent.model : 'unknown'
  const held = ledger.entries[id]
  // A loop seen better takes the new names: a fork that showed as a workflow
  // agent, or one the board came to know (its spawn raced its first steps).
  const known = held !== undefined && KIND_RANK[who.kind] > KIND_RANK[held.kind]
  const entry: HudLedgerEntry = defined({
    kind: held === undefined || known ? who.kind : held.kind,
    name: known ? (who.name ?? held?.name) : (held?.name ?? who.name),
    description: known ? (who.description ?? held?.description) : (held?.description ?? who.description),
    models: { ...held?.models, [model]: plus(held?.models[model], more) },
    firstAt: held?.firstAt ?? (who.startedAt !== undefined && who.startedAt > 0 ? Math.min(who.startedAt, now) : now),
    lastAt: now,
    endedAt: undefined,
    status: undefined,
  })

  return ledgerCompacted({ ...ledger, entries: { ...ledger.entries, [id]: entry } }, now, id)
}

/** Loop `id`'s run ended (`answer` done, any other reason failed); the ledger as it was for a loop it never booked. */
export const ledgerEnded = (ledger: HudLedger, id: string, reason: string, now: number): HudLedger => {
  const held = ledger.entries[id]
  if (held === undefined || id === 'main') return ledger
  const status = reason === 'answer' ? 'done' : 'failed'
  if (held.status === status && held.endedAt !== undefined) return ledger

  return { ...ledger, entries: { ...ledger.entries, [id]: { ...held, endedAt: now, status } } }
}

/** One more tool call ended denied or in an error. */
export const ledgerFailed = (ledger: HudLedger, outcome: 'denied' | 'error'): HudLedger => {
  const held = ledger.failures ?? { denied: 0, error: 0 }

  return { ...ledger, failures: { ...held, [outcome]: held[outcome] + 1 } }
}

/**
 * Finished loops an hour past their end, then (past LEDGER_MAX) the oldest
 * finished and the quietest, folded into their models' `others` and counted
 * in `gone`; never `main` or `keep`. The same ledger when nothing goes.
 */
export const ledgerCompacted = (ledger: HudLedger, now: number, keep?: string): HudLedger => {
  const ids = Object.keys(ledger.entries)
  const due = new Set(ids.filter(id => {
    const entry = ledger.entries[id]

    return id !== 'main' && id !== keep && entry?.endedAt !== undefined && now - entry.endedAt >= LEDGER_COMPACT_MS
  }))
  const excess = ids.length - due.size - LEDGER_MAX
  if (excess > 0) {
    const rank = (entry: HudLedgerEntry): number => (entry.endedAt === undefined ? 1 : 0)
    ids
      .filter(id => id !== 'main' && id !== keep && !due.has(id))
      .map(id => ({ id, entry: ledger.entries[id] as HudLedgerEntry }))
      .sort((a, b) => rank(a.entry) - rank(b.entry) || (a.entry.endedAt ?? a.entry.lastAt) - (b.entry.endedAt ?? b.entry.lastAt) || a.id.localeCompare(b.id))
      .slice(0, excess)
      .forEach(one => due.add(one.id))
  }
  if (due.size === 0) return ledger
  const entries: Record<string, HudLedgerEntry> = {}
  const others = { ...ledger.others }
  const gone = { ...(ledger.gone ?? { agents: 0, done: 0, failed: 0, ms: 0 }) }
  for (const [id, entry] of Object.entries(ledger.entries)) {
    if (!due.has(id)) {
      entries[id] = entry
      continue
    }
    for (const [model, tokens] of Object.entries(entry.models)) {
      const held = others[model]
      others[model] = { ...plus(held, tokens), agents: (held?.agents ?? 0) + 1 }
    }
    // A fork's tokens count; it was never an agent.
    if (entry.kind === 'fork') continue
    gone.agents += 1
    if (entry.status === 'done') gone.done += 1
    if (entry.status === 'failed') gone.failed += 1
    gone.ms += Math.max(0, (entry.endedAt ?? entry.lastAt) - entry.firstAt)
  }

  return { ...ledger, entries, others, gone }
}

/** One user of a model in the Cost tree: the session, an agent, the workflow agents together, or the compacted. */
export type CostUser = { key: string; label: string; detail?: string; usd: number; count?: number }

/** One model of the Cost tree: its short id, its estimated cost and share, and its users by cost. */
export type CostModel = { model: string; usd: number; share: number; priced: boolean; users: CostUser[] }

/**
 * The ledger priced by model (short ids, the costliest first) with each
 * model's users by cost: `main`, each subagent, the workflow agents together
 * (`workflow ×n`), and the compacted (`others ×n`).
 */
export const costTree = (ledger: HudLedger): CostModel[] => {
  const byModel = new Map<string, { usd: number; priced: boolean; users: Map<string, CostUser> }>()
  const add = (model: string, tokens: HudTokenFacts, user: Omit<CostUser, 'usd'>, count = 0): void => {
    const name = shortModel(model) ?? model
    const usd = costOf(model, tokens)
    const held = byModel.get(name) ?? { usd: 0, priced: true, users: new Map<string, CostUser>() }
    held.usd += usd ?? 0
    held.priced &&= usd !== undefined
    const one = held.users.get(user.key)
    held.users.set(user.key, defined<CostUser>({ ...user, usd: (one?.usd ?? 0) + (usd ?? 0), count: count > 0 ? (one?.count ?? 0) + count : undefined }))
    byModel.set(name, held)
  }
  for (const [id, entry] of Object.entries(ledger.entries)) {
    for (const [model, tokens] of Object.entries(entry.models)) {
      if (entry.kind === 'main') add(model, tokens, { key: 'main', label: 'main' })
      else if (entry.kind === 'workflow') add(model, tokens, { key: 'workflow', label: 'workflow' }, 1)
      else if (entry.kind === 'fork') add(model, tokens, { key: 'forks', label: 'forks' }, 1)
      else add(model, tokens, defined({ key: `agent:${id}`, label: entry.name || id, detail: entry.description }))
    }
  }
  for (const [model, tokens] of Object.entries(ledger.others)) add(model, tokens, { key: 'others', label: 'others' }, tokens.agents)
  const total = [...byModel.values()].reduce((sum, one) => sum + one.usd, 0)

  return [...byModel.entries()]
    .map(([model, one]) => ({
      model,
      usd: one.usd,
      share: total > 0 ? one.usd / total : 0,
      priced: one.priced,
      users: [...one.users.values()].sort((a, b) => b.usd - a.usd || a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => b.usd - a.usd || a.model.localeCompare(b.model))
}

/** The loops the ledger has seen, beside the session's: how many, how they ended, how long they ran (ms). */
export type RunCounts = { spawned: number; running: number; done: number; failed: number; ms: number }

/** Run counts from the ledger and the compacted; a loop the board or the workflow record shows running counts as running. */
export const runCounts = (ledger: HudLedger, now: number, statusOf: (id: string) => 'running' | 'done' | 'failed' | undefined = () => undefined): RunCounts => {
  const gone = ledger.gone ?? { agents: 0, done: 0, failed: 0, ms: 0 }
  const counts: RunCounts = { spawned: gone.agents, running: 0, done: gone.done, failed: gone.failed, ms: gone.ms }
  for (const [id, entry] of Object.entries(ledger.entries)) {
    if (entry.kind === 'main' || entry.kind === 'fork') continue
    const status = statusOf(id) ?? entry.status ?? 'running'
    counts.spawned += 1
    counts[status] += 1
    const end = status === 'running' ? now : (entry.endedAt ?? entry.lastAt)
    counts.ms += Math.max(0, end - entry.firstAt)
  }

  return counts
}

/** `/mod-hud facts`'s ledger: each model's estimated cost and tokens, the loops counted, the failures. */
export const ledgerSummary = (ledger: HudLedger, now: number): Record<string, unknown> => {
  const byModel: Record<string, HudTokenFacts> = {}
  for (const entry of Object.values(ledger.entries)) for (const [model, tokens] of Object.entries(entry.models)) byModel[shortModel(model) ?? model] = plus(byModel[shortModel(model) ?? model], tokens)
  for (const [model, tokens] of Object.entries(ledger.others)) byModel[shortModel(model) ?? model] = plus(byModel[shortModel(model) ?? model], tokens)
  const tree = costTree(ledger)

  return defined({
    loops: Object.keys(ledger.entries).length,
    models: Object.fromEntries(tree.map(one => [one.model, defined({
      usd: one.priced ? Math.round(one.usd * 100) / 100 : undefined,
      ...byModel[one.model],
      users: one.users.length,
    })])),
    runs: runCounts(ledger, now),
    failures: ledger.failures,
  })
}
