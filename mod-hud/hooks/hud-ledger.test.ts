import { expect, test } from 'claude-code/testing'

import type { HudLedger } from '../types'
import { shortModel } from './facts'
import {
  LEDGER_COMPACT_MS,
  LEDGER_MAX,
  NO_LEDGER,
  agentShareOf,
  costOf,
  costTree,
  ledgerBooked,
  ledgerCompacted,
  ledgerEnded,
  ledgerFailed,
  ledgerSummary,
  priceOf,
  runCounts,
} from './hud-ledger'

// What each loop spent, by model: prices, bookings, compaction and the Cost tree.

const NOW = 1_000_000

const MINUTE = 60_000

test('prices: by exact model id only, none for unknown versions or providers; cost per million', () => {
  expect(shortModel('claude-opus-5-5[1m]')).toBe('opus-5-5')
  expect(shortModel('claude-sonnet-4-5-20250929')).toBe('sonnet-4-5')
  expect(shortModel('anthropic.claude-haiku-4-5')).toBe('haiku-4-5')
  expect(priceOf('claude-opus-5-5')).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 })
  expect(priceOf('claude-sonnet-5-5-20260101')?.input).toBe(2)
  expect(priceOf('claude-opus-9')).toBe(undefined)
  expect(priceOf('gpt-6')).toBe(undefined)
  const cents = (usd: number | undefined): number | undefined => (usd === undefined ? undefined : Math.round(usd * 100))
  expect(cents(costOf('claude-opus-5-5', { input: 1_000_000, output: 100_000, cacheRead: 10_000_000, cacheWrite: 200_000 }))).toBe((4 + 2 + 2 + 1) * 100)
  expect(costOf('gpt-6', { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })).toBe(undefined)
})

const spent = (input: number, output: number, model = 'claude-opus-5-5') => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model })

test('the ledger books each request to its loop and model, a fork that shows as a workflow agent taking its name', () => {
  let ledger: HudLedger = NO_LEDGER
  ledger = ledgerBooked(ledger, 'main', spent(1000, 100), { kind: 'main' }, NOW)
  ledger = ledgerBooked(ledger, 'main', spent(1000, 100), { kind: 'main' }, NOW + 1)
  ledger = ledgerBooked(ledger, 'sub-1', spent(500, 50, 'claude-sonnet-5-5'), { kind: 'agent', name: 'frontend', description: 'Draw the mascots', startedAt: NOW - 5000 }, NOW)
  ledger = ledgerBooked(ledger, 'wf00000000000001', spent(200, 20), { kind: 'fork', name: 'wf-0001' }, NOW)
  expect(ledger.entries.main?.models['claude-opus-5-5']).toEqual({ input: 2000, output: 200, cacheRead: 0, cacheWrite: 0 })
  expect(ledger.entries['sub-1']).toMatchObject({ kind: 'agent', name: 'frontend', description: 'Draw the mascots', firstAt: NOW - 5000 })
  ledger = ledgerBooked(ledger, 'wf00000000000001', spent(200, 20), { kind: 'workflow', name: 'wf-0001' }, NOW + 2)
  expect(ledger.entries.wf00000000000001?.kind).toBe('workflow')
  // A response with no tokens, or none at all, books nothing.
  expect(ledgerBooked(ledger, 'main', spent(0, 0), { kind: 'main' }, NOW)).toBe(ledger)
  expect(ledgerBooked(ledger, 'main', null, { kind: 'main' }, NOW)).toBe(ledger)
  // A run's end, once; a loop never booked, or main, is left alone.
  const ended = ledgerEnded(ledger, 'sub-1', 'answer', NOW + 10)
  expect(ended.entries['sub-1']).toMatchObject({ status: 'done', endedAt: NOW + 10 })
  expect(ledgerEnded(ended, 'sub-1', 'answer', NOW + 20)).toBe(ended)
  expect(ledgerEnded(ended, 'ghost', 'answer', NOW)).toBe(ended)
  expect(ledgerEnded(ended, 'main', 'answer', NOW)).toBe(ended)
  // It asks again: running again.
  expect(ledgerBooked(ended, 'sub-1', spent(1, 1), { kind: 'agent' }, NOW + 30).entries['sub-1']?.status).toBe(undefined)
  expect(ledgerFailed(ledgerFailed(ended, 'denied'), 'error').failures).toEqual({ denied: 1, error: 1 })
})

test('a finished loop is compacted into its models\' others an hour after it ended, and past 500 loops the oldest finished go first', () => {
  let ledger: HudLedger = NO_LEDGER
  ledger = ledgerBooked(ledger, 'old', spent(1000, 100), { kind: 'agent', name: 'worker' }, NOW)
  ledger = ledgerEnded(ledger, 'old', 'answer', NOW + MINUTE)
  ledger = ledgerBooked(ledger, 'fork', spent(10, 1), { kind: 'fork' }, NOW)
  ledger = ledgerEnded(ledger, 'fork', 'answer', NOW + MINUTE)
  expect(ledgerCompacted(ledger, NOW + MINUTE + LEDGER_COMPACT_MS - 1)).toBe(ledger)
  const compacted = ledgerCompacted(ledger, NOW + MINUTE + LEDGER_COMPACT_MS)
  expect(Object.keys(compacted.entries)).toEqual([])
  expect(compacted.others['claude-opus-5-5']).toEqual({ input: 1010, output: 101, cacheRead: 0, cacheWrite: 0, agents: 2 })
  // The fork's tokens count; it was never an agent.
  expect(compacted.gone).toEqual({ agents: 1, done: 1, failed: 0, ms: MINUTE })

  let many: HudLedger = ledgerBooked(NO_LEDGER, 'main', spent(1, 1), { kind: 'main' }, NOW)
  for (let index = 0; index <= LEDGER_MAX; index += 1) {
    many = ledgerBooked(many, `a-${index}`, spent(1, 1), { kind: 'agent' }, NOW + index)
    if (index >= 1 && index <= 3) many = ledgerEnded(many, `a-${index}`, 'error', NOW + 1000 + index)
  }
  expect(Object.keys(many.entries)).toHaveLength(LEDGER_MAX)
  // The two oldest finished went; main, the oldest (still running) and the third finished stayed.
  expect(many.entries['a-0']).toBeDefined()
  expect(many.entries['a-1']).toBe(undefined)
  expect(many.entries['a-2']).toBe(undefined)
  expect(many.entries['a-3']).toBeDefined()
  expect(many.entries.main).toBeDefined()
  expect(many.gone).toMatchObject({ agents: 2, failed: 2 })
})

test('the cost tree prices each model, the costliest first, its users by cost: main, each agent, the workflow agents and others together', () => {
  let ledger: HudLedger = NO_LEDGER
  ledger = ledgerBooked(ledger, 'main', spent(1_000_000, 100_000), { kind: 'main' }, NOW)
  ledger = ledgerBooked(ledger, 'sub-1', spent(500_000, 50_000), { kind: 'agent', name: 'frontend', description: 'Desktop: draw mascots' }, NOW)
  ledger = ledgerBooked(ledger, 'wf-a', spent(100_000, 0, 'claude-sonnet-5-5'), { kind: 'workflow', name: 'wf-000a' }, NOW)
  ledger = ledgerBooked(ledger, 'wf-b', spent(100_000, 0, 'claude-sonnet-5-5'), { kind: 'workflow', name: 'wf-000b' }, NOW)
  ledger = ledgerBooked(ledger, 'gw', spent(100, 100, 'gpt-6'), { kind: 'agent', name: 'codex' }, NOW)
  ledger = { ...ledger, others: { 'claude-sonnet-5-5': { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, agents: 3 } } }
  const tree = costTree(ledger)
  expect(tree.map(one => one.model)).toEqual(['opus-5-5', 'sonnet-5-5', 'gpt-6'])
  expect(tree[0]).toMatchObject({ usd: 9, priced: true })
  expect(Math.round((tree[0]?.share ?? 0) * 1000)).toBe(Math.round((9 / 11.4) * 1000))
  expect(tree[0]?.users.map(one => [one.label, one.detail, one.usd])).toEqual([['main', undefined, 6], ['frontend', 'Desktop: draw mascots', 3]])
  expect(tree[1]?.users.map(one => [one.label, one.count, one.usd])).toEqual([['others', 3, 2], ['workflow', 2, 0.4]])
  expect(tree[2]).toMatchObject({ usd: 0, priced: false })
  // Counted runs: the subagents and workflow agents, the board's status first.
  ledger = ledgerEnded(ledger, 'sub-1', 'answer', NOW + 2 * MINUTE)
  expect(runCounts(ledger, NOW + 4 * MINUTE, id => (id === 'gw' ? 'failed' : undefined))).toEqual({ spawned: 4, running: 2, done: 1, failed: 1, ms: 2 * MINUTE + 2 * 4 * MINUTE })
  const summary = ledgerSummary(ledger, NOW)
  expect(summary).toMatchObject({ loops: 5, models: { 'opus-5-5': { usd: 9, input: 1_500_000, output: 150_000, users: 2 } } })
  expect((summary.models as Record<string, { usd?: number }>)['gpt-6']?.usd).toBe(undefined)
})

test('deployment suffixes normalize to exact older Claude list prices; unknown versions stay unpriced', () => {
  expect(shortModel('us.anthropic.claude-sonnet-4-20250514-v1:0')).toBe('sonnet-4')
  expect(priceOf('us.anthropic.claude-opus-4-1-20250805-v1:0')).toEqual({ input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 })
  for (const model of ['claude-sonnet-4-5', 'claude-sonnet-4', 'claude-3-7-sonnet-20250219']) expect(priceOf(model)).toEqual({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 })
  expect(priceOf('us.anthropic.claude-opus-99-v2:0')).toBe(undefined)
})

test('agentShareOf: the share of the estimated spend that is not the main loop\'s; none before anything priced', () => {
  expect(agentShareOf(NO_LEDGER)).toBe(undefined)
  const who = { kind: 'main' as const }
  let ledger = ledgerBooked(NO_LEDGER, 'main', spent(3_000_000, 0), who, NOW)
  expect(agentShareOf(ledger)).toBe(0)
  ledger = ledgerBooked(ledger, 'sub-1', spent(1_000_000, 0), { kind: 'agent', name: 'Explore' }, NOW)
  expect(Math.round((agentShareOf(ledger) ?? 0) * 1e6)).toBe(250_000)
  // Compacted loops still count as agents'.
  const later = ledgerCompacted(ledgerEnded(ledger, 'sub-1', 'answer', NOW), NOW + LEDGER_COMPACT_MS)
  expect(Object.keys(later.entries)).toEqual(['main'])
  expect(Math.round((agentShareOf(later) ?? 0) * 1e6)).toBe(250_000)
  // An unpriced model adds nothing to either side.
  expect(agentShareOf(ledgerBooked(NO_LEDGER, 'sub-2', spent(1_000, 0, 'gpt-6'), { kind: 'agent' }, NOW))).toBe(undefined)
})
