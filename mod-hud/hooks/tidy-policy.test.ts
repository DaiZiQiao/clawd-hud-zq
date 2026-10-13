import { describe, expect, test } from 'claude-code/testing'

import { priceOf } from './hud-ledger'
import { pricesAt } from './prices'
import { CACHE_TTL_MS } from './facts'
import { TIDY_AGAIN, TIDY_RESULT_MS, TIDY_SETTLE_MS, TIDY_WAITING_REASONS, TIDY_FEEDBACK_REASONS, tidyCostsOf, tidyDueOf, tidySafeReasonsOf, tidySavingOf } from './tidy-policy'
import type { TidyCostInputs, TidyPolicyInputs, TidySafeSnapshot } from './tidy-policy'

// T1, T2, T9's pure saving, and the individual safe-point conditions. The
// scheduler's complete blocker matrix and actions belong to Batch 4.

const costInputs = (extra: Partial<TidyCostInputs> = {}): TidyCostInputs => ({ model: 'claude-opus-5-5', tokens: 400_000, ttl: '1h', ...extra })
const policyInputs = (extra: Partial<TidyPolicyInputs> = {}): TidyPolicyInputs => ({ ...costInputs(), mode: 'auto', at: 150_000, requests: 0, interactive: true, promptCacheWorking: true, autoAllowed: true, ...extra })
const near = (actual: number, expected: number, tolerance: number): void => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)

const NOW = 1_000_000
const safeSnapshot = (extra: Partial<TidySafeSnapshot> = {}): TidySafeSnapshot => ({
  now: NOW,
  phase: 'poll',
  settleMs: 0,
  idleSince: NOW - 1000,
  mainBusy: false,
  lastTurnReason: 'answer',
  mainRequestAt: NOW - 1000,
  stop: { at: NOW - 500, requestAt: NOW - 1000, tasks: [], previousTaskIds: [], oneShotCrons: 0 },
  agents: [],
  workflowShadows: [],
  toolsInFlight: 0,
  draft: 'empty',
  compactionRunning: false,
  openTodos: 0,
  openTasks: 0,
  interactive: true,
  loadedAt: NOW - 1000,
  bandDrawnAt: NOW - 100,
  paneOpen: false,
  availability: { autoCompact: true, compactEnabled: true, notTeammate: true, bandSurfaces: true, priced: true, model: 'opus-5-5', ttlAllowed: true, promptCacheWorking: true },
  ...extra,
})
const stopWith = (extra: Partial<NonNullable<TidySafeSnapshot['stop']>>): NonNullable<TidySafeSnapshot['stop']> => ({ ...safeSnapshot().stop!, ...extra })

describe('T1: the cost model', () => {
  test('the six warm Opus rows and their one-hour cold costs', () => {
    const rows = [
      { after: 30_000, tokens: 150_000, K: 0.73, s: 0.020, payback: 37, coldCost: 1.20 },
      { after: 30_000, tokens: 400_000, K: 0.78, s: 0.070, payback: 12, coldCost: 3.20 },
      { after: 30_000, tokens: 800_000, K: 0.86, s: 0.150, payback: 6, coldCost: 6.40 },
      { after: 65_000, tokens: 150_000, K: 1.01, s: 0.013, payback: 78, coldCost: 1.20 },
      { after: 65_000, tokens: 400_000, K: 1.06, s: 0.063, payback: 17, coldCost: 3.20 },
      { after: 65_000, tokens: 800_000, K: 1.14, s: 0.143, payback: 8, coldCost: 6.40 },
    ]
    for (const row of rows) {
      const inputs = costInputs({ tokens: row.tokens, after: row.after })
      const costs = tidyCostsOf(inputs)!
      near(costs.K, row.K, 0.005)
      near(costs.s, row.s, 0.0005)
      expect(costs.payback).toBe(row.payback)
      near(costs.coldCost, 0, 0.005)
      near(tidyCostsOf({ ...inputs, gapMs: CACHE_TTL_MS['1h'] })!.coldCost, row.coldCost, 0.005)
    }
  })

  test('a cold Opus return, with and without the summarizer miss term', () => {
    const cold = costInputs({ gapMs: CACHE_TTL_MS['1h'] })
    expect(tidyCostsOf({ ...cold, miss: false })?.payback).toBe(-33)
    const missed = tidyCostsOf({ ...cold, miss: true })!
    near(missed.K, 2.98, 0.005)
    expect(missed.payback).toBe(-3)
  })

  test('Haiku prices S at the high tier and A+F at the low tier, including the 100k boundary', () => {
    expect(pricesAt('haiku-5-5', 100_000)).toEqual({ input: 0.1, write5m: 0.125, write1h: 0.2, read: 0.01, output: 0.5 })
    expect(pricesAt('claude-haiku-5-5[1m]', 100_001)).toEqual({ input: 0.5, write5m: 0.625, write1h: 1, read: 0.05, output: 2.5 })
    const costs = tidyCostsOf(costInputs({ model: 'haiku-5-5', tokens: 150_000 }))!
    near(costs.K, 0.062, 0.005)
    near(costs.s, 0.00665, 0.0005)
    expect(costs.payback).toBe(10)
    // An aggregated ledger cannot select a request's tier.
    expect(priceOf('haiku-5-5')).toBeUndefined()
    expect(priceOf('sonnet-5-5')?.cacheRead).toBe(0.1)
  })

  test('a measured A+F passed as after with fresh zero keeps the same hand values', () => {
    const costs = tidyCostsOf(costInputs({ after: 85_000, fresh: 0, summary: 15_000 }))!
    near(costs.K, 1.06, 0.005)
    near(costs.s, 0.063, 0.0005)
    expect(costs.payback).toBe(17)
  })

  test('no saving means never; an unknown model has no estimate', () => {
    for (const tokens of [85_000, 20_000]) expect(tidyCostsOf(costInputs({ tokens }))?.payback).toBeUndefined()
    expect(tidyCostsOf(costInputs({ model: 'some-model' }))).toBeUndefined()
    expect(pricesAt('some-model', 400_000)).toBeUndefined()
  })
})

describe('T2: the due rules', () => {
  test('unpriced or unavailable cache costs give idle interactive advisory offers only', () => {
    for (const row of [{ model: 'opus-9', why: 'unpriced' }, { ttl: 'off' as const, why: 'cache' }, { promptCacheWorking: false, why: 'cache' }]) {
      const { why, ...extra } = row
      for (const mode of ['auto', 'ask'] as const) expect(tidyDueOf(policyInputs({ ...extra, mode }))).toEqual([{ rule: 'advisory', why, automatic: false }])
      for (const gate of [{ interactive: false }, { mainBusy: true }, { tokens: 149_999 }, { mode: 'off' as const }, { compactDisabled: true }, { dismissedAt: 400_000 }, { lastAfter: 400_000 }]) expect(tidyDueOf(policyInputs({ ...extra, ...gate }))).toEqual([])
    }
  })

  test('D1 is due at 17 requests, not 16, past the floor and dismissal/growth gates', () => {
    expect(tidyDueOf(policyInputs({ requests: 16 }))).toEqual([])
    expect(tidyDueOf(policyInputs({ requests: 17 }))).toMatchObject([{ rule: 'D1', automatic: true }])
    expect(tidyDueOf(policyInputs({ requests: 17, mode: 'ask' }))).toMatchObject([{ rule: 'D1', automatic: false }])
    expect(tidyDueOf(policyInputs({ requests: 17, mode: 'off' }))).toEqual([])
    expect(tidyDueOf(policyInputs({ requests: 1000, tokens: 149_999 }))).toEqual([])
    expect(tidyDueOf(policyInputs({ requests: 1000, at: 0, tokens: 39_999, after: 0, fresh: 0 }))).toEqual([])
    expect(tidyDueOf(policyInputs({ requests: 17, dismissedAt: 400_000 - TIDY_AGAIN + 1 }))).toEqual([])
    expect(tidyDueOf(policyInputs({ requests: 17, lastAfter: 400_000 - TIDY_AGAIN + 1 }))).toEqual([])
  })

  test('D2 uses lambda 1 for an offer and lambda 2 for automatic tidying', () => {
    const cooling = policyInputs({ gapMs: CACHE_TTL_MS['1h'] - 2 * 60_000 })
    for (const row of [{ tokens: 400_000, automatic: true, K: 1.06, coldCostAtTtl: 3.2 }, { tokens: 150_000, automatic: false, K: 1.01, coldCostAtTtl: 1.2 }]) {
      const due = tidyDueOf({ ...cooling, tokens: row.tokens })
      expect(due).toMatchObject([{ rule: 'D2', automatic: row.automatic, costs: { cold: false } }])
      near(due[0]!.costs!.K, row.K, 0.005)
      near(due[0]!.costs!.coldCost, 0, 0.005)
      near(due[0]!.costs!.coldCostAtTtl, row.coldCostAtTtl, 0.005)
    }
    expect(tidyDueOf({ ...cooling, gapMs: cooling.gapMs! - 1 })).toEqual([])
    expect(tidyDueOf({ ...cooling, coolingDismissed: true })).toEqual([])
    expect(tidyDueOf({ ...cooling, assumed: true })).toEqual([])
  })

  test('assumed TTL uses one-hour writes for warm D1, not the certain five-minute payback', () => {
    const warm = policyInputs({ ttl: '5m', assumed: true, gapMs: CACHE_TTL_MS['5m'] - 1, requests: 17 })
    const costs = tidyCostsOf(warm)!
    near(costs.K, 1.06, 0.005)
    near(costs.s, 0.063, 0.0005)
    expect(costs.payback).toBe(17)
    expect(tidyCostsOf({ ...warm, assumed: false })?.payback).toBe(13)
    expect(tidyDueOf(warm)).toMatchObject([{ rule: 'D1', automatic: true }])
    expect(tidyDueOf({ ...warm, requests: 16 })).toEqual([])
  })

  test('assumed TTL is cold at five minutes, with one-hour K but five-minute coldCost', () => {
    const cold = policyInputs({ ttl: '1h', assumed: true, gapMs: CACHE_TTL_MS['5m'], miss: true, requests: 16 })
    const costs = tidyCostsOf(cold)!
    near(costs.K, 2.98, 0.005)
    near(costs.coldCost, 2, 0.005)
    near(costs.s, 0.063, 0.0005)
    expect(costs.payback).toBe(16)
    expect(costs.cold).toBe(true)
    expect(tidyDueOf(cold)).toMatchObject([{ rule: 'D3', automatic: false }])
    near(tidyDueOf(cold)[0]!.saving!, 0.028, 0.005)
    expect(tidyDueOf({ ...cold, requests: 15 })).toEqual([])
    near(15 * costs.s + costs.coldCost - costs.K, -0.035, 0.005)
    near(tidySavingOf('D3', costs, 15), 0, 0.005)
  })

  test('D3 forces a miss and is offer-only; a user-set window blocks D1 auto but not D2', () => {
    const cold = tidyDueOf(policyInputs({ gapMs: CACHE_TTL_MS['1h'], requests: 10, miss: false }))
    expect(cold).toMatchObject([{ rule: 'D3', automatic: false }])
    near(cold[0]!.costs!.K, 2.98, 0.005)
    for (const windowSource of ['env', 'settings']) {
      expect(tidyDueOf(policyInputs({ requests: 17, windowSource }))).toMatchObject([{ rule: 'D1', automatic: false }])
      expect(tidyDueOf(policyInputs({ gapMs: CACHE_TTL_MS['1h'] - 1, windowSource }))).toMatchObject([{ rule: 'D2', automatic: true }])
    }
  })
})

describe('T9: the saving', () => {
  test('D1 with no past requests clamps its saving to zero', () => {
    near(tidySavingOf('D1', tidyCostsOf(costInputs())!, 0), 0, 0.005)
  })

  test('D1 7.76, D2 2.14 and D3 0.85; every due rule has a non-negative saving', () => {
    const warm = tidyDueOf(policyInputs({ requests: 140 }))[0]!
    const cooling = tidyDueOf(policyInputs({ gapMs: CACHE_TTL_MS['1h'] - 1 }))[0]!
    const cold = tidyDueOf(policyInputs({ requests: 10, gapMs: CACHE_TTL_MS['1h'] }))[0]!
    near(warm.saving!, 7.76, 0.005)
    near(cooling.saving!, 2.14, 0.005)
    near(cold.saving!, 0.85, 0.005)
    for (const tokens of [150_000, 400_000, 800_000]) {
      for (const requests of [0, 10, 16, 17, 140]) {
        for (const gapMs of [0, CACHE_TTL_MS['1h'] - 1, CACHE_TTL_MS['1h']]) {
          for (const rule of tidyDueOf(policyInputs({ tokens, requests, gapMs }))) expect(rule.saving).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })
})

describe('the pure safe-point evaluator', () => {
  test('all conditions met: safe, including idle teammates and long-lived shells', () => {
    const task = { id: 'server', type: 'shell', status: 'running' }
    expect(tidySafeReasonsOf(safeSnapshot({ stop: stopWith({ tasks: [task], previousTaskIds: [task.id] }), agents: [{ id: 'idle', status: 'idle' }] }))).toEqual([])
  })

  test('SP1: a busy main loop blocks', () => {
    expect(tidySafeReasonsOf(safeSnapshot({ mainBusy: true }))).toEqual(['Claude is working'])
  })

  test('SP1: an aborted last turn was interrupted', () => {
    expect(tidySafeReasonsOf(safeSnapshot({ lastTurnReason: 'aborted' }))).toEqual(['last turn was interrupted'])
  })

  test('SP1: a missing last-turn reason waits for the next turn', () => {
    expect(tidySafeReasonsOf(safeSnapshot({ lastTurnReason: undefined }))).toEqual(['the next turn to end'])
  })

  test('SP1: an unrecognized last-turn reason waits for the next turn', () => {
    expect(tidySafeReasonsOf(safeSnapshot({ lastTurnReason: 'other' }))).toEqual(['the next turn to end'])
  })

  test('SP1: an error has its own reason', () => {
    expect(tidySafeReasonsOf(safeSnapshot({ lastTurnReason: 'error' }))).toEqual(['last turn ended in an error'])
  })

  test('SP1: a refusal has its own reason', () => {
    expect(tidySafeReasonsOf(safeSnapshot({ lastTurnReason: 'refusal' }))).toEqual(['last turn was refused'])
  })

  test('SP2: an absent or stale Stop fails closed', () => {
    const tasks = ['subagent', 'workflow', 'foo', 'shell', 'MCP task'].map(type => ({ id: type, type, status: 'running' }))
    for (const stop of [undefined, stopWith({ requestAt: NOW - 1001, tasks, oneShotCrons: 1 })]) {
      expect(tidySafeReasonsOf(safeSnapshot({ stop }))).toEqual(['the next turn to end'])
      expect(tidySafeReasonsOf(safeSnapshot({ stop, agents: [{ id: 'live', status: 'running' }], workflowShadows: [{ status: 'running', visible: true, live: true }], toolsInFlight: 1, draft: 'nonempty', queuedAt: NOW, openTodos: 1, openTasks: 1 }))).toEqual(['the next turn to end', '1 agent running', 'a workflow running', 'a tool is running', 'you are typing', 'a prompt is queued', '1 todo open', '1 task open'])
    }
  })

  test('SP2: a fresh Stop with no agents stays fresh after later events', () => {
    expect(tidySafeReasonsOf(safeSnapshot({ now: NOW + 500, agents: [] }))).toEqual([])
    expect(tidySafeReasonsOf(safeSnapshot({ now: NOW + 501, agents: [] }))).toEqual([])
  })

  test('SP3: Stop and live active agents count once per id; final Stop statuses do not block', () => {
    for (const status of ['running', 'completed']) expect(tidySafeReasonsOf(safeSnapshot({ stop: stopWith({ tasks: [{ id: 'a', type: 'subagent', status }] }), agents: [{ id: 'a', status: 'running' }, { id: 'b', status: 'waiting' }] }))).toEqual(['2 agents running'])
    for (const status of ['completed', 'failed', 'killed', 'stopped', 'done', 'idle', 'COMPLETED', 'IDLE']) {
      for (const type of ['subagent', 'teammate', 'cloud session', 'workflow', 'shell', 'monitor', 'MCP task', 'foo']) expect(tidySafeReasonsOf(safeSnapshot({ stop: stopWith({ tasks: [{ id: 'final', type, status }] }) }))).toEqual([])
    }
  })

  test('SP3: teammate and cloud agents block, housekeeping does not, unknown work fails closed', () => {
    for (const type of ['teammate', 'cloud session']) expect(tidySafeReasonsOf(safeSnapshot({ stop: stopWith({ tasks: [{ id: 'a', type, status: 'running' }] }) }))).toEqual(['1 agent running'])
    for (const type of ['dream', 'auto-mode scan', 'memory import']) expect(tidySafeReasonsOf(safeSnapshot({ stop: stopWith({ tasks: [{ id: 'h', type, status: 'running' }] }) }))).toEqual([])
    expect(tidySafeReasonsOf(safeSnapshot({ stop: stopWith({ tasks: [{ id: 'x', type: 'foo', status: 'running' }] }) }))).toEqual(['unknown background work'])
  })

  test('SP3: a failed or non-array agent list fails closed', () => {
    for (const agents of [undefined, {} as TidySafeSnapshot['agents']]) expect(tidySafeReasonsOf(safeSnapshot({ agents }))).toEqual(['cannot read the agent list'])
  })

  test('SP3: a Stop workflow or unknown background type blocks', () => {
    expect(tidySafeReasonsOf(safeSnapshot({ stop: stopWith({ tasks: [{ id: 'w', type: 'workflow', status: 'running' }] }) }))).toEqual(['a workflow running'])
    expect(tidySafeReasonsOf(safeSnapshot({ stop: stopWith({ tasks: [{ id: 'x', type: 'raw-label', status: 'running' }] }) }))).toEqual(['unknown background work'])
  })

  test('SP3b: a shell or monitor first listed this turn blocks', () => {
    for (const type of ['shell', 'monitor', 'MCP task']) {
      const task = { id: 'new', type, status: 'running' }
      expect(tidySafeReasonsOf(safeSnapshot({ stop: stopWith({ tasks: [task] }) }))).toEqual(['a job started this turn'])
      expect(tidySafeReasonsOf(safeSnapshot({ stop: stopWith({ tasks: [task], previousTaskIds: [task.id] }) }))).toEqual([])
    }
  })

  test('SP3c: a running workflow shadow must be visible and live to block', () => {
    expect(tidySafeReasonsOf(safeSnapshot({ workflowShadows: [{ status: 'running', visible: true, live: true }] }))).toEqual(['a workflow running'])
    expect(tidySafeReasonsOf(safeSnapshot({ workflowShadows: [{ status: 'running', visible: false, live: true }, { status: 'running', visible: true, live: false }] }))).toEqual([])
  })

  test('SP4: tools in flight block', () => {
    expect(tidySafeReasonsOf(safeSnapshot({ toolsInFlight: 1 }))).toEqual(['a tool is running'])
  })

  test('SP5: typing blocks and an unknown draft fails closed', () => {
    expect(tidySafeReasonsOf(safeSnapshot({ draft: 'nonempty' }))).toEqual(['you are typing'])
    expect(tidySafeReasonsOf(safeSnapshot({ draft: 'unknown' }))).toEqual(['cannot read the prompt box'])
  })

  test('SP6: a prompt submitted but not started blocks', () => {
    expect(tidySafeReasonsOf(safeSnapshot({ queuedAt: NOW - 1 }))).toEqual(['a prompt is queued'])
  })

  test('SP7: a running or recent compaction blocks, one reason at a time', () => {
    expect(tidySafeReasonsOf(safeSnapshot({ compactionRunning: true, compactionFinishedAt: NOW - 1 }))).toEqual(['a compaction is running'])
    expect(tidySafeReasonsOf(safeSnapshot({ compactionFinishedAt: NOW - TIDY_RESULT_MS + 1 }))).toEqual(['a compaction just finished'])
    expect(tidySafeReasonsOf(safeSnapshot({ compactionFinishedAt: NOW - TIDY_RESULT_MS }))).toEqual([])
  })

  test('SP8: open todos and tasks block with their counts', () => {
    expect(tidySafeReasonsOf(safeSnapshot({ openTodos: 3, openTasks: 2 }))).toEqual(['3 todos open', '2 tasks open'])
  })

  test('SP9: a one-shot cron blocks', () => {
    expect(tidySafeReasonsOf(safeSnapshot({ stop: stopWith({ oneShotCrons: 1 }) }))).toEqual(['a wakeup is scheduled'])
  })

  test('SP10: a headless session is unavailable, with no offer or automatic rule', () => {
    expect(tidySafeReasonsOf(safeSnapshot({ interactive: false }))).toEqual(['not an interactive session'])
    expect(tidyDueOf(policyInputs({ requests: 140, interactive: false }))).toEqual([])
  })

  test('SP11: the band must have drawn recently since load, unless the pane is open', () => {
    for (const bandDrawnAt of [undefined, NOW - 10_001, NOW - 1001]) expect(tidySafeReasonsOf(safeSnapshot({ bandDrawnAt }))).toEqual(['the HUD is not on screen'])
    expect(tidySafeReasonsOf(safeSnapshot({ bandDrawnAt: undefined, paneOpen: true }))).toEqual([])
  })

  test('SP11: start does not need a band; final needs a draw after the countdown starts', () => {
    expect(tidySafeReasonsOf(safeSnapshot({ phase: 'start', bandDrawnAt: undefined }))).toEqual([])
    expect(tidySafeReasonsOf(safeSnapshot({ phase: 'final', countdownSince: NOW - 50 }))).toEqual(['the HUD is not on screen'])
    expect(tidySafeReasonsOf(safeSnapshot({ phase: 'final', countdownSince: NOW - 100 }))).toEqual([])
  })

  test('SP13: the derived four-minute settle shows a static pause at 2m10s, but not at four minutes or when disabled', () => {
    expect(TIDY_SETTLE_MS).toBe(240_000)
    expect(tidySafeReasonsOf(safeSnapshot({ settleMs: TIDY_SETTLE_MS, idleSince: NOW - 130_000 }))).toEqual(['a 4-min pause after the turn'])
    expect(tidySafeReasonsOf(safeSnapshot({ settleMs: TIDY_SETTLE_MS, idleSince: NOW - 240_000 }))).toEqual([])
    expect(tidySafeReasonsOf(safeSnapshot({ settleMs: 0, idleSince: NOW }))).toEqual([])
    expect(tidySafeReasonsOf(safeSnapshot({ settleMs: TIDY_SETTLE_MS, idleSince: Number.NaN }))).toEqual(['a 4-min pause after the turn'])
  })

  test('SP14: a user-started tidy ignores open work and draft, but not busy or disabled compaction', () => {
    const snapshot = safeSnapshot({ userStarted: true, openTodos: 3, openTasks: 2, agents: [{ id: 'a', status: 'running' }], draft: 'nonempty', stop: undefined, lastTurnReason: undefined, interactive: false, phase: 'final', bandDrawnAt: undefined, settleMs: TIDY_SETTLE_MS, idleSince: NOW })
    expect(tidySafeReasonsOf(snapshot)).toEqual([])
    expect(tidySafeReasonsOf({ ...snapshot, mainBusy: true })).toEqual(['Claude is working'])
    expect(tidySafeReasonsOf({ ...snapshot, compactionRunning: true })).toEqual(['a compaction is running'])
    expect(tidySafeReasonsOf({ ...snapshot, availability: { ...snapshot.availability, compactEnabled: false } })).toEqual(['compaction disabled (DISABLE_COMPACT)'])
  })

  test('every waiting reason fits 30 characters with counts of 99 and the longest settle string', () => {
    for (const [key, reason] of Object.entries(TIDY_WAITING_REASONS)) {
      const text = typeof reason === 'function' ? reason(key === 'settle' ? 600_000 : 99) : reason
      expect(text.length).toBeLessThanOrEqual(30)
    }
    for (const text of Object.values(TIDY_FEEDBACK_REASONS)) expect(text.length + (text.match(/[≈·]/g)?.length ?? 0)).toBeLessThanOrEqual(46)
  })

  test('SP12: availability flags carry their exact reasons, after waiting reasons', () => {
    const availability = { autoCompact: false, compactEnabled: false, notTeammate: false, bandSurfaces: false, priced: false, model: 'some-model', ttlAllowed: false, promptCacheWorking: false }
    expect(tidySafeReasonsOf(safeSnapshot({ availability, mainBusy: true }))).toEqual([
      'Claude is working',
      'auto-compact is off in your settings',
      'compaction disabled (DISABLE_COMPACT)',
      'teammate session',
      'open on a surface without the band',
      'no price for some-model',
      'TTL is a guess: set cacheTtl',
      'prompt cache not working here',
    ])
    expect(tidyDueOf(policyInputs({ requests: 140, autoAllowed: false }))).toMatchObject([{ rule: 'D1', automatic: false }])
    expect(tidyDueOf(policyInputs({ requests: 140, compactDisabled: true }))).toEqual([])
    expect(tidyDueOf(policyInputs({ requests: 140, promptCacheWorking: false }))).toEqual([{ rule: 'advisory', why: 'cache', automatic: false }])
  })
})
