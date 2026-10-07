import type { On, ProcessRunInit, SessionContextBreakdown, SessionUsage, UiPane } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { HudGitFacts, HudInventoryFacts, HudSessionFacts, HudTodoFacts, HudToolFacts, HudUsageFacts } from '../types'
import {
  EDITED_MAX,
  NO_FACTS,
  addTokens,
  afterClear,
  afterCompaction,
  afterMainTurn,
  applyMeasure,
  assembleHudData,
  busyIdleOf,
  contextGrowth,
  debouncer,
  editedPathOf,
  effortFromSettings,
  effortOf,
  fileEdited,
  gitFactsOf,
  inventoryOf,
  keptLimits,
  limitEta,
  limitSamplesAfter,
  noCurrentTool,
  parseGitStatus,
  parseTodos,
  providerOf,
  rateLimitsOf,
  sameFacts,
  throttleDue,
  todoFactsOf,
  toolSettled,
  toolStarted,
  turnsUntil,
} from './facts'
import type { Cancellable } from './facts'

// The HUD's facts: parsed, folded in and assembled, and gathered by the hooks.

const NOW = 1_000_000
const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const
const TOGGLE = {
  command: 'mod-hud',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const
const GIT_ARGV = ['git', '-C', '/work', 'status', '--porcelain=v2', '--branch']
const PORCELAIN = [
  '# branch.oid 0123456789abcdef0123456789abcdef01234567',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 aaaaaaa aaaaaaa src/a.ts',
  '1 A. N... 000000 100644 100644 0000000 bbbbbbb src/b.ts',
  '1 D. N... 100644 000000 000000 ccccccc 0000000 src/c.ts',
  '2 R. N... 100644 100644 100644 ddddddd ddddddd R100 src/e.ts\tsrc/d.ts',
  'u UU N... 100644 100644 100644 100644 eeeeeee eeeeeee eeeeeee src/f.ts',
  '? notes.txt',
  '! build/',
  '',
].join('\n')
const INVENTORY = {
  mcpTools: [
    { name: 'mcp__notion__search', serverName: 'notion', tokens: 10, isLoaded: true },
    { name: 'mcp__notion__fetch', serverName: 'notion', tokens: 10, isLoaded: false },
    { name: 'mcp__codex-relay__send', serverName: 'codex-relay', tokens: 10, isLoaded: true },
  ],
  skills: { totalSkills: 12, includedSkills: 10, tokens: 900, skillFrontmatter: [] },
} as unknown as SessionContextBreakdown

// ---------------------------------------------------------------------------
// The pure helpers.
// ---------------------------------------------------------------------------

test('git status porcelain v2 counts the branch, the upstream and the changed paths', async () => {
  expect(parseGitStatus(PORCELAIN)).toEqual({ branch: 'main', dirty: 6, added: 2, deleted: 1, ahead: 2, behind: 1 })

  // No upstream: no ahead or behind. A clean tree counts zeros.
  expect(parseGitStatus('# branch.oid 0123456789abcdef\n# branch.head topic\n')).toEqual({
    branch: 'topic', dirty: 0, added: 0, deleted: 0,
  })
  // A detached HEAD reads as its short commit; a fresh repository has no branch commit.
  expect(parseGitStatus('# branch.oid 0123456789abcdef\n# branch.head (detached)\n').branch).toBe('0123456')
  expect(parseGitStatus('# branch.oid (initial)\n# branch.head (detached)\n').branch).toBe(undefined)
  expect(parseGitStatus('# branch.oid (initial)\n# branch.head main\n? a\n')).toEqual({ branch: 'main', dirty: 1, added: 1, deleted: 0 })
  expect(parseGitStatus('')).toEqual({ dirty: 0, added: 0, deleted: 0 })
})

test('a git reading keeps the held facts, and their time, while nothing changed', async () => {
  const reading = parseGitStatus(PORCELAIN)
  const held: HudGitFacts = { ...reading, at: NOW }
  expect(gitFactsOf(held, reading, NOW + 5000)).toBe(held)
  expect(gitFactsOf(held, { ...reading, dirty: 7 }, NOW + 5000)).toEqual({ ...reading, dirty: 7, at: NOW + 5000 })
  expect(gitFactsOf({}, reading, NOW)).toEqual({ ...reading, at: NOW })
})

// A schedule in memory: timers fire when the test says.
const timers = () => {
  const pending: { at: number; fn: () => void; cancelled: boolean }[] = []
  let now = NOW
  const schedule = (ms: number, fn: () => void): Cancellable => {
    const timer = { at: now + ms, fn, cancelled: false }
    pending.push(timer)

    return { cancel: () => void (timer.cancelled = true) }
  }
  const advance = (ms: number): void => {
    now += ms
    for (const timer of pending.filter(one => !one.cancelled && one.at <= now)) {
      timer.cancelled = true
      timer.fn()
    }
  }

  return { schedule, advance, now: () => now, scheduled: () => pending.length }
}

test('the debouncer folds a burst into one run per window, and never runs inline', async () => {
  const clock = timers()
  const gate = debouncer(3000)
  let runs = 0
  const run = () => void (runs += 1)

  // Leading: the first ask of a fresh gate runs on a timer due at once.
  expect(gate.request(clock.now(), clock.schedule, run, { leading: true })).toBe('scheduled')
  expect(runs).toBe(0)
  clock.advance(0)
  expect(runs).toBe(1)

  // A burst inside the window is one run, a whole window after its first ask.
  expect(gate.request(clock.now(), clock.schedule, run)).toBe('scheduled')
  clock.advance(1000)
  expect(gate.request(clock.now(), clock.schedule, run)).toBe('coalesced')
  clock.advance(1000)
  expect(gate.request(clock.now(), clock.schedule, run)).toBe('coalesced')
  clock.advance(999)
  expect(runs).toBe(1)
  clock.advance(1)
  expect(runs).toBe(2)

  // Leading right after a run waits out the rest of the window.
  clock.advance(1000)
  gate.request(clock.now(), clock.schedule, run, { leading: true })
  clock.advance(1999)
  expect(runs).toBe(2)
  clock.advance(1)
  expect(runs).toBe(3)

  // Cancel drops the scheduled run.
  gate.request(clock.now(), clock.schedule, run)
  gate.cancel()
  clock.advance(10_000)
  expect(runs).toBe(3)
})

test('a debounced run whose timer never fired is given up a window past due', async () => {
  const gate = debouncer(3000)
  let runs = 0
  const lost = () => ({ cancel: () => {} })
  expect(gate.request(NOW, lost, () => void (runs += 1))).toBe('scheduled')
  expect(gate.request(NOW + 5999, lost, () => void (runs += 1))).toBe('coalesced')
  const clock = timers()
  clock.advance(6000)
  expect(gate.request(clock.now(), clock.schedule, () => void (runs += 1))).toBe('scheduled')
  clock.advance(3000)
  expect(runs).toBe(1)
})

test('throttleDue allows a first read, then one per period', async () => {
  expect(throttleDue(undefined, NOW, 300_000)).toBe(true)
  expect(throttleDue(NOW, NOW + 299_999, 300_000)).toBe(false)
  expect(throttleDue(NOW, NOW + 300_000, 300_000)).toBe(true)
  // A time from another clock (after now) never blocks.
  expect(throttleDue(NOW + 1, NOW, 300_000)).toBe(true)
})

test('the provider is a gateway when ANTHROPIC_BASE_URL holds anything', async () => {
  expect(providerOf('https://gateway.example')).toBe('gateway')
  expect(providerOf(undefined)).toBe(undefined)
  expect(providerOf('  ')).toBe(undefined)
})

test('effort reads from a step or from the settings, per model first', async () => {
  expect(effortOf('high')).toBe('high')
  expect(effortOf(2048)).toBe('2048')
  expect(effortOf('')).toBe(undefined)
  expect(effortOf(null)).toBe(undefined)
  const settings = { modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } }, effortLevel: 'low' }
  expect(effortFromSettings(settings, 'claude-opus-5-5[1m]')).toBe('xhigh')
  expect(effortFromSettings(settings, 'claude-opus-5-5')).toBe('xhigh')
  expect(effortFromSettings(settings, 'claude-sonnet-5-5')).toBe('low')
  expect(effortFromSettings({}, 'claude-opus-5-5')).toBe(undefined)
  expect(effortFromSettings(undefined, undefined)).toBe(undefined)
})

test('a main turn\'s end writes usage once (one more turn, its time, the context sampled); a subagent\'s writes none', async ($, on) => {
  const { clock, held } = arrange(on)
  await started($, clock)
  const before = held.get('usage') as { value: HudUsageFacts; version: number }
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }
  await completeTurn($, { usage, agentId: 'sub-9' })
  expect(held.get('usage')).toEqual(before)
  await completeTurn($, { usage, durationMs: 4000 })
  expect(held.get('usage')).toEqual({ value: { ...before.value, turns: 1, busyMs: 4000, contextSamples: [40_000] }, version: before.version + 1 })
})

test('with inspect off a main turn\'s end writes no usage', { options: { inspect: false } }, async ($, on) => {
  const { clock, held } = arrange(on)
  await started($, clock)
  const before = held.get('usage')
  await completeTurn($, { durationMs: 4000 })
  expect(held.get('usage')).toEqual(before)
})

test('a measurement replaces the context and cost, and leaves out what it lacks; the rate limits it reports replace those held', async () => {
  const held: HudUsageFacts = { ...NO_FACTS.usage, compactions: 2 }
  const full = applyMeasure(held, {
    context: { tokens: 50_000, window: 200_000, percent: 25 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-03T15:00:00Z' },
      { kind: 'seven_day', percentUsed: 7 },
      { kind: 'something_new', percentUsed: 1 },
    ],
    cost: { usd: 1.25 },
  })
  expect(full).toEqual({
    contextTokens: 50_000,
    contextPercent: 25,
    window: 200_000,
    rateLimits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-03T15:00:00Z' }, { kind: 'seven_day', percentUsed: 7 }],
    costUsd: 1.25,
    compactions: 2,
  })
  // No response yet, no ledger: those keys are absent, not zero. A reading
  // with no windows (a gateway answering for another provider) says nothing
  // of them: the last reading of each stays.
  const bare = applyMeasure(full, { context: { window: 200_000 }, rateLimits: [] }, Date.parse('2026-10-03T12:00:00Z'))
  expect(bare).toEqual({ window: 200_000, rateLimits: full.rateLimits, compactions: 2 })
  expect('contextTokens' in bare).toBe(false)
  expect('costUsd' in bare).toBe(false)
  expect(applyMeasure(NO_FACTS.usage, { context: { window: 200_000 }, rateLimits: [] })).toEqual({ window: 200_000, rateLimits: [], compactions: 0 })
  expect(rateLimitsOf(undefined)).toEqual([])
})

test('a window a reading does not report is kept until it resets; one it reports takes the new reading', async () => {
  const five = { kind: 'five_hour' as const, percentUsed: 40, resetsAt: '2026-10-03T15:00:00Z' }
  const seven = { kind: 'seven_day' as const, percentUsed: 12 }
  const spend = { kind: 'spend_limit' as const, percentUsed: 3, resetsAt: '2026-11-01T00:00:00Z' }
  const before = Date.parse('2026-10-03T14:59:00Z')
  const after = Date.parse('2026-10-03T15:00:00Z')
  // Nothing reported: all kept while due, in the kinds' order.
  expect(keptLimits([seven, five], [], before)).toEqual([five, seven])
  // Past its reset the five-hour reading no longer holds; one with no reset time stays.
  expect(keptLimits([five, seven], [], after)).toEqual([seven])
  // A gateway's spend limit and the subscription's windows each keep their own.
  expect(keptLimits([five, seven], [spend], before)).toEqual([five, seven, spend])
  expect(keptLimits([five, seven, spend], [{ ...five, percentUsed: 41 }], before)).toEqual([{ ...five, percentUsed: 41 }, seven, spend])
  // No clock: nothing is judged past its reset.
  expect(keptLimits([five], [])).toEqual([five])
})

test('each response\'s tokens add up by kind; a response with none changes nothing; /clear starts them over', async () => {
  const one = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }
  const first = addTokens(NO_FACTS.usage, one)
  expect(first).toEqual({ ...NO_FACTS.usage, tokens: { input: 10, output: 5, cacheRead: 100, cacheWrite: 20 } })
  expect(addTokens(first, { ...one, input_tokens: 2.9, output_tokens: -4 }).tokens).toEqual({ input: 12, output: 5, cacheRead: 200, cacheWrite: 40 })
  expect(addTokens(first, null)).toBe(first)
  expect(addTokens(first, undefined)).toBe(first)
  expect(addTokens(first, { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBe(first)
  expect(afterClear(first)).toEqual(NO_FACTS.usage)
  expect(afterCompaction(first).tokens).toEqual(first.tokens)
  expect(applyMeasure(first, { context: { window: 200_000 }, rateLimits: [] }).tokens).toEqual(first.tokens)
})

test('a compaction counts once and forgets the context fill', async () => {
  const held: HudUsageFacts = { ...NO_FACTS.usage, contextTokens: 190_000, contextPercent: 95, window: 200_000 }
  expect(afterCompaction(held)).toEqual({ rateLimits: [], compactions: 1, window: 200_000 })
  expect(afterCompaction(afterCompaction(held)).compactions).toBe(2)
})

test('a /clear forgets the compactions and the context fill, and keeps the rest', async () => {
  const rateLimits: HudUsageFacts['rateLimits'] = [{ kind: 'five_hour', percentUsed: 30 }]
  const held: HudUsageFacts = {
    contextTokens: 190_000, contextPercent: 95, window: 200_000, rateLimits, costUsd: 3, compactions: 2,
  }
  expect(afterClear(held)).toEqual({ window: 200_000, rateLimits, costUsd: 3, compactions: 0 })
  expect(afterClear(NO_FACTS.usage)).toEqual(NO_FACTS.usage)
})

test('TodoWrite todos keep the well-formed items', async () => {
  expect(parseTodos([
    { content: 'Write the parser', status: 'completed', activeForm: 'Writing the parser' },
    { content: 'Test it', status: 'in_progress' },
    { content: 'Bad status', status: 'blocked' },
    { status: 'pending' },
    'nonsense',
  ])).toEqual([
    { content: 'Write the parser', status: 'completed', activeForm: 'Writing the parser' },
    { content: 'Test it', status: 'in_progress' },
  ])
  expect(parseTodos(undefined)).toBe(undefined)
  expect(parseTodos([])).toEqual([])
  const held: HudTodoFacts = { items: [{ content: 'a', status: 'pending' }], at: NOW }
  expect(todoFactsOf(held, [{ content: 'a', status: 'pending' }], NOW + 1)).toBe(held)
  expect(todoFactsOf(held, [], NOW + 1)).toEqual({ items: [], at: NOW + 1 })
})

test('the current tool is the call that started last, and clears when that call ends', async () => {
  const one = toolStarted(NO_FACTS.tools, 'Bash', 't1', NOW)
  expect(one).toEqual({ current: { name: 'Bash', since: NOW, id: 't1' }, counts: { Bash: 1 } })
  const two = toolStarted(one, 'Read', 't2', NOW + 5)
  expect(two.counts).toEqual({ Bash: 1, Read: 1 })
  // The earlier call ending leaves the later one current.
  expect(toolSettled(two, 'Bash', 't1')).toBe(two)
  expect(toolSettled(two, 'Read', 't2')).toEqual({ counts: { Bash: 1, Read: 1 } })
  // Without ids, the name decides.
  expect(toolSettled(toolStarted(NO_FACTS.tools, 'Bash', undefined, NOW), 'Bash', undefined)).toEqual({ counts: { Bash: 1 } })
  expect(noCurrentTool(two)).toEqual({ counts: { Bash: 1, Read: 1 } })
  expect(noCurrentTool(NO_FACTS.tools)).toBe(NO_FACTS.tools)
})

test('the inventory lists each MCP server once, sorted, and the skill count', async () => {
  expect(inventoryOf(INVENTORY, NOW)).toEqual({ mcpServers: ['codex-relay', 'notion'], skills: 12, at: NOW })
  expect(inventoryOf(undefined, NOW)).toBe(undefined)
  expect(inventoryOf({ mcpTools: [] } as unknown as SessionContextBreakdown, NOW)).toEqual({ mcpServers: [], at: NOW })
})

test('sameFacts compares JSON values deeply, absent and undefined alike', async () => {
  expect(sameFacts({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true)
  expect(sameFacts({ a: 1, b: undefined }, { a: 1 })).toBe(true)
  expect(sameFacts({ a: 1 }, { a: 2 })).toBe(false)
  expect(sameFacts([1, 2], [2, 1])).toBe(false)
  expect(sameFacts([], {})).toBe(false)
})

test('assembleHudData hands the renderer the facts as held, without bookkeeping', async () => {
  expect(assembleHudData(NO_FACTS, NOW)).toEqual({
    session: {},
    usage: { rateLimits: [], compactions: 0 },
    git: {},
    tools: { counts: {} },
    todos: { items: [] },
    inventory: { mcpServers: [] },
    now: NOW,
  })
  const session: HudSessionFacts = { model: 'claude-opus-5-5[1m]', effort: 'xhigh', provider: 'gateway', startedAt: NOW - 1, cwd: '/w', repoRoot: '/w' }
  const tools: HudToolFacts = { current: { name: 'Bash', since: NOW, id: 't1' }, counts: { Bash: 3 } }
  const inventory: HudInventoryFacts = { mcpServers: ['notion'], skills: 4, at: NOW }
  const data = assembleHudData({
    ...NO_FACTS,
    session,
    git: { branch: 'main', dirty: 2, at: NOW },
    tools,
    todos: { items: [{ content: 'a', status: 'pending', activeForm: 'A-ing' }], at: NOW },
    inventory,
  }, NOW + 10)
  expect(data.session).toEqual(session)
  expect(data.git).toEqual({ branch: 'main', dirty: 2 })
  expect(data.tools).toEqual({ current: { name: 'Bash', since: NOW }, counts: { Bash: 3 } })
  expect(data.todos).toEqual({ items: [{ content: 'a', status: 'pending', activeForm: 'A-ing' }] })
  expect(data.inventory).toEqual({ mcpServers: ['notion'], skills: 4 })
  expect(data.now).toBe(NOW + 10)
})

// ---------------------------------------------------------------------------
// The hooks, against the engine: state, the session, git and the clock mocked.
// ---------------------------------------------------------------------------

type Run = { argv: string[]; init?: ProcessRunInit }

const arrange = (on: On) => {
  const clock = mock.clock(on, { now: NOW })
  const held = new Map<string, { value: unknown; version: number }>()
  const world = {
    runs: [] as Run[],
    git: { exitCode: 0, stdout: PORCELAIN, stderr: '' },
    gitRefused: false,
    usage: {
      startedAt: NOW - 60_000,
      context: { tokens: 40_000, window: 200_000, percent: 20 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 12 }],
      cost: { usd: 0.5 },
    } as SessionUsage,
    breakdowns: 0,
    beforeUsage: () => {},
    env: {} as Record<string, string>,
    settings: { modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } } as Record<string, unknown>,
    failHud: false,
    refuse: new Set<string>(),
    panes: [] as UiPane[],
    compacted: { messages: [{ role: 'assistant', text: 'summary', toolUses: [] }] } as unknown,
    /** What each step's request reports it cost: nothing, unless a test says. */
    stepUsage: null as (Record<string, number | string> | null),
    tool: async (): Promise<unknown> => ({ result: 'ok' }),
  }
  const isHud = (key: string): boolean => ['session', 'usage', 'git', 'tools', 'todos', 'inventory'].includes(key)

  on('state.get', (_$, e) => {
    if (world.failHud && isHud(e.key)) return { deny: 'state refused' }

    return { value: held.get(e.key) ?? { value: undefined, version: 0 } }
  })
  on('state.set', (_$, e) => {
    if (world.failHud && isHud(e.key)) return { deny: 'state refused' }
    const version = held.get(e.key)?.version ?? 0
    if (e.ifVersion !== undefined && e.ifVersion !== version) return { value: { isSet: false as const, version } }
    held.set(e.key, { value: e.value, version: version + 1 })

    return { value: { isSet: true as const, version: version + 1 } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.model', () => (world.refuse.has('session.model') ? { deny: 'refused' } : { value: 'claude-opus-5-5[1m]' }))
  on('session.cwd', () => (world.refuse.has('session.cwd') ? { deny: 'refused' } : { value: '/work' }))
  on('session.repo', () => (world.refuse.has('session.repo')
    ? { deny: 'refused' }
    : { value: { root: '/work', remote: null, internal: false, name: null } }))
  on('session.usage', (_$, e) => {
    world.beforeUsage()
    if (world.refuse.has('session.usage')) return { deny: 'refused' }
    if (e?.breakdown === undefined) return { value: world.usage }
    world.breakdowns += 1

    return { value: { ...world.usage, context: { ...world.usage.context, breakdown: INVENTORY } } }
  })
  on('env.get', (_$, e) => (world.refuse.has('env.get') ? { deny: 'refused' } : { value: world.env[e.name] }))
  on('settings.read', () => (world.refuse.has('settings.read') ? { deny: 'refused' } : { value: world.settings }))
  on('process.run', (_$, e) => {
    world.runs.push({ argv: [...e.argv], init: e.init })
    if (world.gitRefused) return { deny: 'git timed out' }

    return { value: { ...world.git, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'sub-1' }))
  on('ui.open', (_$, e) => {
    world.panes = [{ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true }]

    return { value: { isPlaced: true as const } }
  })
  on('ui.panes', () => ({ value: world.panes }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('tool.call', () => world.tool() as never)
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.compact', () => world.compacted as never)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: world.stepUsage as never }
  })

  const fact = <T>(key: string): T => held.get(key)?.value as T
  const gitRuns = (): Run[] => world.runs.filter(run => run.argv[0] === 'git')

  return { clock, world, held, fact, gitRuns }
}

const callTool = ($: Engine, tool: string, extra: Record<string, unknown> = {}) =>
  $.tool.call({ tool, tool_use_id: `tu-${tool}`, ...extra } as never)

const spawn = ($: Engine) =>
  $.agent.spawn({
    tool_use_id: 'tu-1',
    prompt: 'look around',
    description: 'Find the bug',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  } as Parameters<Engine['agent']['spawn']>[0])

const completeTurn = ($: Engine, extra: Record<string, unknown> = {}) =>
  $.turn.complete({
    answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', ...extra,
  } as Parameters<Engine['turn']['complete']>[0])

const step = async ($: Engine, extra: Record<string, unknown> = {}) => {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3, ...extra } as Parameters<Engine['turn']['step']>[0])
  for await (const _chunk of stream) {
    // Drained: the result is what matters.
  }

  return stream.result
}

const measure = ($: Engine, extra: Record<string, unknown> = {}) =>
  $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ['context'], ...extra } as Parameters<Engine['session']['measure']>[0])

const MESSAGES = [{ role: 'user', text: 'the plan so far', toolUses: [] }]

const compact = ($: Engine, extra: Record<string, unknown> = {}) =>
  $.session.compact({ trigger: 'manual', messages: MESSAGES, ...extra } as Parameters<Engine['session']['compact']>[0])

const started = async ($: Engine, clock: ReturnType<typeof mock.clock>) => {
  await $.session.start(START)
  await clock.settle()
}

test('session start gathers who, where and what was measured, then one git reading and the inventory', async ($, on) => {
  const { clock, world, fact, gitRuns } = arrange(on)
  world.env.ANTHROPIC_BASE_URL = 'https://gateway.example'
  await started($, clock)

  expect(fact<HudSessionFacts>('session')).toEqual({
    model: 'claude-opus-5-5[1m]',
    effort: 'xhigh',
    provider: 'gateway',
    startedAt: NOW - 60_000,
    cwd: '/work',
    repoRoot: '/work',
  })
  expect(fact<HudUsageFacts>('usage')).toEqual({
    contextTokens: 40_000,
    contextPercent: 20,
    window: 200_000,
    rateLimits: [{ kind: 'five_hour', percentUsed: 12 }],
    costUsd: 0.5,
    compactions: 0,
    // Sampled for the Session tab's burn rate.
    limitSamples: { five_hour: [{ at: NOW, percent: 12 }] },
  })
  expect(gitRuns()).toEqual([{ argv: GIT_ARGV, init: { timeoutMs: 3000, env: { GIT_OPTIONAL_LOCKS: '0' } } }])
  expect(fact<HudGitFacts>('git')).toEqual({ branch: 'main', dirty: 6, added: 2, deleted: 1, ahead: 2, behind: 1, at: NOW })
  expect(fact<HudInventoryFacts>('inventory')).toEqual({ mcpServers: ['codex-relay', 'notion'], skills: 12, at: NOW })
  expect(world.breakdowns).toBe(1)
})

test('the tick never runs git', async ($, on) => {
  const { clock, held, gitRuns } = arrange(on)
  await started($, clock)
  await $.command.run(TOGGLE as Parameters<Engine['command']['run']>[0])
  await spawn($)
  expect(gitRuns()).toHaveLength(1)

  await clock.advance(10_000)
  // The pane ticked every second all along; git ran only at the start.
  expect(held.get('tick')?.value).toBe(clock.now())
  expect(gitRuns()).toHaveLength(1)
})

test('a burst of tree-changing calls is one git run per three-second window', async ($, on) => {
  const { clock, world, gitRuns } = arrange(on)
  await started($, clock)
  expect(gitRuns()).toHaveLength(1)

  await callTool($, 'Bash', { command: 'make' })
  await clock.advance(1000)
  await callTool($, 'Edit', { file_path: '/work/a.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(1000)
  await callTool($, 'Write', { file_path: '/work/b.ts', content: '' })
  await callTool($, 'MultiEdit', { file_path: '/work/a.ts', edits: [] })
  await callTool($, 'NotebookEdit', { notebook_path: '/work/n.ipynb', new_source: '' })
  await clock.advance(999)
  expect(gitRuns()).toHaveLength(1)
  await clock.advance(1)
  expect(gitRuns()).toHaveLength(2)
  await clock.advance(10_000)
  expect(gitRuns()).toHaveLength(2)

  // A read-only tool asks for nothing; a main turn's end does.
  await callTool($, 'Read', { file_path: '/work/a.ts' })
  await clock.advance(5000)
  expect(gitRuns()).toHaveLength(2)
  await completeTurn($)
  await callTool($, 'Bash', { command: 'ls', agentId: 'sub-9' })
  await clock.advance(3000)
  expect(gitRuns()).toHaveLength(3)

  // A denied call changed nothing: no reading.
  world.tool = async () => ({ deny: 'not allowed' })
  await callTool($, 'Edit', { file_path: '/work/a.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(5000)
  expect(gitRuns()).toHaveLength(3)
})

test('outside a repository git clears; a git that cannot run keeps the last reading', async ($, on) => {
  const { clock, world, fact, gitRuns } = arrange(on)
  await started($, clock)
  expect(fact<HudGitFacts>('git').branch).toBe('main')

  world.gitRefused = true
  await callTool($, 'Bash', { command: 'ls' })
  await clock.advance(3000)
  expect(gitRuns()).toHaveLength(2)
  expect(fact<HudGitFacts>('git').branch).toBe('main')

  world.gitRefused = false
  world.git = { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' }
  await callTool($, 'Bash', { command: 'cd /' })
  await clock.advance(30_000)
  expect(gitRuns()).toHaveLength(3)
  expect(fact<HudGitFacts>('git')).toEqual({})
})

test('a main-loop tool is current while it runs, counts, and TodoWrite keeps its list', async ($, on) => {
  const { clock, world, fact } = arrange(on)
  await started($, clock)
  world.tool = async () => {
    await clock.sleep(500)

    return { result: 'ok' }
  }
  const running = callTool($, 'mcp__notion__search', { query: 'q' })
  await clock.settle()
  expect(fact<HudToolFacts>('tools')).toEqual({
    // Its main argument rides with it, for the HUD's `now` row.
    current: { name: 'notion:search', since: NOW, id: 'tu-mcp__notion__search', arg: 'q' },
    counts: { 'notion:search': 1 },
  })
  await clock.advance(500)
  await running
  expect(fact<HudToolFacts>('tools')).toEqual({ counts: { 'notion:search': 1 } })

  world.tool = async () => ({ result: { oldTodos: [], newTodos: [] } })
  const todos = [
    { content: 'Parse git', status: 'completed', activeForm: 'Parsing git' },
    { content: 'Write tests', status: 'in_progress', activeForm: 'Writing tests' },
  ]
  await callTool($, 'TodoWrite', { todos })
  expect(fact<HudTodoFacts>('todos')).toEqual({ items: todos, at: clock.now() })
  expect(fact<HudToolFacts>('tools').counts).toEqual({ 'notion:search': 1, TodoWrite: 1 })

  // A subagent's list and a denied write leave the main list as it is.
  await callTool($, 'TodoWrite', { todos: [{ content: 'Theirs', status: 'pending', activeForm: 'x' }], agentId: 'sub-9' })
  world.tool = async () => ({ deny: 'no' })
  await callTool($, 'TodoWrite', { todos: [] })
  expect(fact<HudTodoFacts>('todos').items).toEqual(todos)
  // A subagent's calls are the board's, not the HUD's.
  expect(fact<HudToolFacts>('tools').counts).toEqual({ 'notion:search': 1, TodoWrite: 2 })
})

test('a main-loop edit that ends ok counts its file once; a denied one, a failed one and a subagent\'s do not; /clear starts over', async ($, on) => {
  const { clock, world, fact } = arrange(on)
  await started($, clock)
  world.tool = async () => ({ result: 'ok' })
  await callTool($, 'Edit', { file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' })
  await callTool($, 'Write', { file_path: '/repo/b.ts', content: 'z' })
  await callTool($, 'Edit', { file_path: '/repo/a.ts', old_string: 'y', new_string: 'x' })
  await callTool($, 'NotebookEdit', { notebook_path: '/repo/c.ipynb', new_source: 'print(1)' })
  await callTool($, 'Read', { file_path: '/repo/d.ts' })
  await callTool($, 'Edit', { file_path: '/repo/e.ts', agentId: 'sub-9' })
  world.tool = async () => ({ deny: 'no' })
  await callTool($, 'Edit', { file_path: '/repo/f.ts' })
  world.tool = async () => ({ result: 'failed', isError: true })
  await callTool($, 'Write', { file_path: '/repo/g.ts' })
  expect(fact<HudToolFacts>('tools').edited).toEqual(['/repo/a.ts', '/repo/b.ts', '/repo/c.ipynb'])
  expect(assembleHudData({ ...NO_FACTS, tools: fact<HudToolFacts>('tools') }, NOW).tools?.edited).toBe(3)
  await $.session.end({ reason: 'clear', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
  expect(fact<HudToolFacts>('tools').edited).toBeUndefined()
})

test('editedPathOf and fileEdited: the edit tools\' path, each file once, the newest 500 kept', () => {
  expect(editedPathOf('Edit', { file_path: ' /repo/a.ts ' })).toBe('/repo/a.ts')
  expect(editedPathOf('MultiEdit', { file_path: '/repo/a.ts' })).toBe('/repo/a.ts')
  expect(editedPathOf('NotebookEdit', { notebook_path: '/repo/n.ipynb' })).toBe('/repo/n.ipynb')
  expect(editedPathOf('Read', { file_path: '/repo/a.ts' })).toBeUndefined()
  expect(editedPathOf('Write', { file_path: '' })).toBeUndefined()
  const once = fileEdited(NO_FACTS.tools, '/a')
  expect(fileEdited(once, '/a')).toBe(once)
  let many = NO_FACTS.tools
  for (let index = 0; index < EDITED_MAX + 5; index += 1) many = fileEdited(many, `/f${index}`)
  expect(many.edited).toHaveLength(EDITED_MAX)
  expect(many.edited?.[0]).toBe('/f5')
  expect(toolStarted(once, 'Bash', 't1', NOW, 'npm test').edited).toEqual(['/a'])
  expect(toolStarted(once, 'Bash', 't1', NOW, 'npm test').current).toEqual({ name: 'Bash', since: NOW, id: 't1', arg: 'npm test' })
})

test('absent facts stay absent: no rate limits, no context yet, no ledger', async ($, on) => {
  const { clock, world, held, fact } = arrange(on)
  world.usage = { startedAt: NOW, context: { window: 200_000 }, rateLimits: [] }
  await started($, clock)
  expect(fact<HudUsageFacts>('usage')).toEqual({ window: 200_000, rateLimits: [], compactions: 0 })
  const before = assembleHudData({ ...NO_FACTS, usage: fact<HudUsageFacts>('usage') }, NOW)
  expect(before.usage).toEqual({ window: 200_000, rateLimits: [], compactions: 0 })

  await measure($, {
    context: { tokens: 90_000, window: 200_000, percent: 45 },
    rateLimits: [{ kind: 'seven_day', percentUsed: 30, resetsAt: '2026-10-07T00:00:00Z' }],
    cost: { usd: 2 },
    changed: ['context', 'rateLimits', 'cost'],
  })
  expect(fact<HudUsageFacts>('usage')).toEqual({
    contextTokens: 90_000,
    contextPercent: 45,
    window: 200_000,
    rateLimits: [{ kind: 'seven_day', percentUsed: 30, resetsAt: '2026-10-07T00:00:00Z' }],
    costUsd: 2,
    compactions: 0,
    limitSamples: { seven_day: [{ at: NOW, percent: 30 }] },
  })

  // The fill unknown again, no ledger: those keys go. No windows reported:
  // the last reading (and its samples) stays until it resets.
  await measure($, { context: { window: 200_000 }, rateLimits: [] })
  const kept = [{ kind: 'seven_day', percentUsed: 30, resetsAt: '2026-10-07T00:00:00Z' }]
  expect(fact<HudUsageFacts>('usage')).toEqual({ window: 200_000, rateLimits: kept, compactions: 0, limitSamples: { seven_day: [{ at: NOW, percent: 30 }] } })

  // The same measurement again writes nothing.
  const version = held.get('usage')?.version
  await measure($, { context: { window: 200_000 }, rateLimits: [] })
  expect(held.get('usage')?.version).toBe(version)

  // Once it has reset, it goes.
  await clock.advance(Date.parse('2026-10-07T00:00:00Z') - clock.now())
  await measure($, { context: { window: 200_000 }, rateLimits: [] })
  expect(fact<HudUsageFacts>('usage')).toEqual({ window: 200_000, rateLimits: [], compactions: 0 })
})

test('a session that cannot answer leaves those facts out and starts all the same', async ($, on) => {
  const { clock, world, fact } = arrange(on)
  world.refuse = new Set(['session.model', 'session.cwd', 'session.repo', 'session.usage', 'env.get', 'settings.read'])
  expect(await $.session.start(START)).toEqual({ cwd: '/work' })
  await clock.settle()
  // What the start event said still holds: the directory, and git there.
  expect(fact<HudSessionFacts>('session')).toEqual({ cwd: '/work' })
  expect(fact<HudGitFacts>('git').branch).toBe('main')
  expect(fact<HudUsageFacts>('usage')).toBe(undefined)
  expect(fact<HudInventoryFacts>('inventory')).toBe(undefined)
})

test('compactions count only when the main conversation was compacted', async ($, on) => {
  const { clock, world, fact } = arrange(on)
  await started($, clock)
  await compact($)
  expect(fact<HudUsageFacts>('usage')).toEqual({
    window: 200_000, rateLimits: [{ kind: 'five_hour', percentUsed: 12 }], costUsd: 0.5, compactions: 1, limitSamples: { five_hour: [{ at: NOW, percent: 12 }] },
  })

  await compact($, { trigger: 'precompute' })
  await compact($, { agentId: 'sub-9' })
  world.compacted = { skip: 'vetoed' }
  await compact($, { trigger: 'auto' })
  expect(fact<HudUsageFacts>('usage').compactions).toBe(1)

  world.compacted = { messages: [{ role: 'assistant', text: 'summary', toolUses: [] }] }
  await compact($, { trigger: 'auto' })
  expect(fact<HudUsageFacts>('usage').compactions).toBe(2)
})

test('turn steps name the main model and effort; turn ends count main turns and leave the rest of usage unchanged', async ($, on) => {
  const { clock, fact } = arrange(on)
  await started($, clock)
  await step($, { model: 'claude-sonnet-5-5', effort: 'high' })
  expect(fact<HudSessionFacts>('session')).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'high' })
  await step($, { model: 'claude-haiku-4-5', agentId: 'sub-9' })
  expect(fact<HudSessionFacts>('session')).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'high' })
  // A model without effort clears it.
  await step($, { model: 'claude-haiku-4-5' })
  expect(fact<HudSessionFacts>('session').model).toBe('claude-haiku-4-5')
  expect(fact<HudSessionFacts>('session').effort).toBe(undefined)

  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, model: 'claude-opus-5-5' }
  const before = fact<HudUsageFacts>('usage')
  await completeTurn($, { usage })
  await completeTurn($, { usage, agentId: 'sub-9' })
  await completeTurn($)
  expect(fact<HudUsageFacts>('usage')).toEqual({ ...before, turns: 2, busyMs: 2, contextSamples: [40_000, 40_000] })
})

test('every response\'s tokens add up, whichever loop made the request, and a compaction\'s too', async ($, on) => {
  const { clock, fact, held, world } = arrange(on)
  const spent = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, model: 'claude-opus-5-5' }
  await started($, clock)
  world.stepUsage = spent
  await step($)
  await step($, { agentId: 'sub-9' })
  expect(fact<HudUsageFacts>('usage').tokens).toEqual({ input: 20, output: 10, cacheRead: 200, cacheWrite: 40 })
  // A step whose request got no response counts nothing, and writes nothing.
  world.stepUsage = null
  const version = held.get('usage')?.version
  await step($)
  expect(held.get('usage')?.version).toBe(version)
  // The summarizer's fork counts through turn.step; compact's repeated usage does not.
  const summaryUsage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  world.stepUsage = { ...summaryUsage, model: 'claude-opus-5-5' }
  await step($, { agentId: 'compaction-fork' })
  world.compacted = { messages: [{ role: 'assistant', text: 'summary', toolUses: [] }], usage: summaryUsage }
  await compact($)
  expect(fact<HudUsageFacts>('usage').tokens).toEqual({ input: 1020, output: 210, cacheRead: 200, cacheWrite: 40 })
  // Turn ends count nothing more: their tokens were each request's.
  await completeTurn($, { usage: spent })
  expect(fact<HudUsageFacts>('usage').tokens).toEqual({ input: 1020, output: 210, cacheRead: 200, cacheWrite: 40 })
})

test('the inventory is read at most once per five minutes', async ($, on) => {
  const { clock, world, fact } = arrange(on)
  await started($, clock)
  expect(world.breakdowns).toBe(1)
  await $.session.start(START)
  await completeTurn($)
  await clock.advance(60_000)
  expect(world.breakdowns).toBe(1)

  await clock.advance(240_000)
  await completeTurn($)
  await clock.settle()
  expect(world.breakdowns).toBe(2)
  expect(fact<HudInventoryFacts>('inventory').at).toBe(NOW + 300_000)
})

test('a HUD whose state fails never breaks the tool or the board', async ($, on) => {
  const { clock, world, held } = arrange(on)
  world.failHud = true
  expect(await $.session.start(START)).toEqual({ cwd: '/work' })
  await clock.settle()
  await spawn($)
  expect(await callTool($, 'Bash', { command: 'ls' })).toEqual({ result: 'ok' })
  expect((await callTool($, 'Bash', { command: 'ls', agentId: 'sub-1' })).result).toBe('ok')
  await completeTurn($, { usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' } })
  await measure($)
  await compact($)
  await clock.advance(3000)
  const board = held.get('agents')?.value as Record<string, { toolCalls: number }>
  expect(board['sub-1']?.toolCalls).toBe(1)
})

test('showGit false clears cached git and schedules no readings at start or after activity', {
  options: { showGit: false },
}, async ($, on) => {
  const { clock, held, fact, gitRuns } = arrange(on)
  held.set('git', { value: { branch: 'stale', dirty: 1 }, version: 1 })
  await started($, clock)
  expect(fact<HudGitFacts>('git')).toEqual({})
  expect(gitRuns()).toHaveLength(0)
  await callTool($, 'Bash', { command: 'make' })
  await callTool($, 'Edit', { file_path: '/work/a.ts', old_string: 'a', new_string: 'b' })
  await callTool($, 'Bash', { command: 'ls', agentId: 'sub-9' })
  await completeTurn($)
  await clock.advance(10_000)
  expect(gitRuns()).toHaveLength(0)
  expect(fact<HudGitFacts>('git')).toEqual({})
})

test('/clear refreshes the session clock and cost without restoring conversation facts', async ($, on) => {
  const { clock, world, fact } = arrange(on)
  await started($, clock)
  await completeTurn($, { usage: { input_tokens: 10, output_tokens: 5 } })
  await compact($)
  await clock.advance(5000)
  world.usage = { ...world.usage, startedAt: clock.now() - 1000, cost: { usd: 0.25 } }
  await $.session.end({ reason: 'clear', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
  expect(fact<HudSessionFacts>('session').startedAt).toBe(clock.now() - 1000)
  // The turns, their time and the context samples start over; the limits' samples stay with the limits.
  expect(fact<HudUsageFacts>('usage')).toEqual({
    window: 200_000, rateLimits: [{ kind: 'five_hour', percentUsed: 12 }], costUsd: 0.25, compactions: 0, limitSamples: { five_hour: [{ at: NOW, percent: 12 }] },
  })
  // A host without a ledger leaves cost unknown, not a stale value.
  world.usage = { startedAt: clock.now(), context: { window: 200_000 }, rateLimits: [] }
  await $.session.end({ reason: 'clear', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
  expect(fact<HudUsageFacts>('usage').costUsd).toBe(undefined)
})

test('/clear falls back to now when session usage cannot be read', async ($, on) => {
  const { clock, world, fact } = arrange(on)
  await started($, clock)
  await clock.advance(5000)
  world.refuse.add('session.usage')
  await $.session.end({ reason: 'clear', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
  expect(fact<HudSessionFacts>('session').startedAt).toBe(clock.now())
  expect(fact<HudUsageFacts>('usage').costUsd).toBe(undefined)
})

test('/clear rejects a stale engine clock and cost, after resetting the board', async ($, on) => {
  const { clock, world, held, fact } = arrange(on)
  await started($, clock)
  await spawn($)
  await compact($)
  await clock.advance(5000)
  let boardAtUsage: unknown
  world.beforeUsage = () => { boardAtUsage = held.get('agents')?.value }
  await $.session.end({ reason: 'clear', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
  expect(fact<HudSessionFacts>('session').startedAt).toBe(clock.now())
  expect(fact<HudUsageFacts>('usage').costUsd).toBe(undefined)
  expect(fact<HudUsageFacts>('usage').compactions).toBe(0)
  expect(boardAtUsage).toEqual({})
})

test('showInventory false never requests a summary at start or after a turn', {
  options: { showInventory: false },
}, async ($, on) => {
  const { clock, world, held } = arrange(on)
  await started($, clock)
  await clock.advance(300_000)
  await completeTurn($)
  await clock.settle()
  expect(world.breakdowns).toBe(0)
  expect(held.has('inventory')).toBe(false)
})

test('showTools false never writes tools, including at turn end and clear', {
  options: { showTools: false },
}, async ($, on) => {
  const { clock, held } = arrange(on)
  await started($, clock)
  const tools = { current: { name: 'Read', since: NOW }, counts: { Read: 1 } }
  held.set('tools', { value: tools, version: 1 })
  await callTool($, 'Read', { file_path: '/work/a.ts' })
  await completeTurn($)
  await $.session.end({ reason: 'clear', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
  expect(held.get('tools')).toEqual({ value: tools, version: 1 })
})

test('showTodos false never writes todos, including at clear', {
  options: { showTodos: false },
}, async ($, on) => {
  const { clock, held } = arrange(on)
  await started($, clock)
  const todos = { items: [{ content: 'Old task', status: 'pending' }] }
  held.set('todos', { value: todos, version: 1 })
  await callTool($, 'TodoWrite', { todos: [] })
  await $.session.end({ reason: 'clear', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
  expect(held.get('todos')).toEqual({ value: todos, version: 1 })
})

test('git timeouts back off to thirty seconds until a successful run', async ($, on) => {
  const { clock, world, gitRuns } = arrange(on)
  world.gitRefused = true
  await started($, clock)
  expect(gitRuns()).toHaveLength(1)
  await completeTurn($)
  await clock.advance(29_999)
  expect(gitRuns()).toHaveLength(1)
  await clock.advance(1)
  expect(gitRuns()).toHaveLength(2)
  world.gitRefused = false
  await completeTurn($)
  await clock.advance(29_999)
  expect(gitRuns()).toHaveLength(2)
  await clock.advance(1)
  expect(gitRuns()).toHaveLength(3)
  await completeTurn($)
  await clock.advance(2999)
  expect(gitRuns()).toHaveLength(3)
  await clock.advance(1)
  expect(gitRuns()).toHaveLength(4)
})

test('a repeated session start cannot bypass git timeout backoff', async ($, on) => {
  const { clock, world, gitRuns } = arrange(on)
  world.gitRefused = true
  await started($, clock)
  await $.session.start(START)
  await clock.settle()
  expect(gitRuns()).toHaveLength(1)
  await clock.advance(29_999)
  expect(gitRuns()).toHaveLength(1)
  await clock.advance(1)
  expect(gitRuns()).toHaveLength(2)
})

// ---------------------------------------------------------------------------
// The Session tab's pace: turns, the context's growth, the limits' burn.
// ---------------------------------------------------------------------------

const MINUTE = 60_000

test('a main turn counts once, sums its time and samples the context: at most eleven samples', () => {
  let usage: HudUsageFacts = { ...NO_FACTS.usage, contextTokens: 10_000 }
  for (let turn = 1; turn <= 13; turn += 1) usage = afterMainTurn({ ...usage, contextTokens: turn * 10_000 }, 1000)
  expect(usage.turns).toBe(13)
  expect(usage.busyMs).toBe(13_000)
  expect(usage.contextSamples).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(n => n * 10_000))
  // No context known (right after a compaction): counted, not sampled.
  const after = afterMainTurn({ ...usage, contextTokens: undefined })
  expect(after.turns).toBe(14)
  expect(after.busyMs).toBe(13_000)
  expect(after.contextSamples).toEqual(usage.contextSamples)
  // /clear starts them over.
  expect(afterClear(after)).toEqual({ rateLimits: [], compactions: 0 })
})

test('the context grows by the mean of the last turns\' deltas, a compaction\'s drop left out', () => {
  expect(contextGrowth(undefined)).toBe(undefined)
  expect(contextGrowth([50_000])).toBe(undefined)
  expect(contextGrowth([50_000, 60_000, 80_000])).toBe(15_000)
  // Across a compaction (a drop), the drop is no delta.
  expect(contextGrowth([700_000, 120_000, 130_000])).toBe(10_000)
  expect(contextGrowth([100_000, 100_000])).toBe(undefined)
  expect(turnsUntil(412_000, 950_000, 18_000)).toBe(30)
  expect(turnsUntil(412_000, 950_000, undefined)).toBe(undefined)
  expect(turnsUntil(960_000, 950_000, 18_000)).toBe(1)
})

test('a limit\'s samples follow its changes over the last 30 minutes, and its burn gives the time to the cap', () => {
  const at = (minutes: number): number => NOW + minutes * MINUTE
  let samples = limitSamplesAfter(undefined, [{ kind: 'five_hour', percentUsed: 20 }], at(0))
  expect(samples).toEqual({ five_hour: [{ at: at(0), percent: 20 }] })
  // The same percent again keeps them as they were: nothing to write.
  expect(limitSamplesAfter(samples, [{ kind: 'five_hour', percentUsed: 20 }], at(5))).toBe(samples)
  samples = limitSamplesAfter(samples, [{ kind: 'five_hour', percentUsed: 25 }], at(20))
  samples = limitSamplesAfter(samples, [{ kind: 'five_hour', percentUsed: 30 }], at(40))
  // 20 % at 0 is the percent the window (10 to 40 min) started at: kept as its base.
  expect(samples?.five_hour?.map(one => one.percent)).toEqual([20, 25, 30])
  samples = limitSamplesAfter(samples, [{ kind: 'five_hour', percentUsed: 31 }], at(71))
  expect(samples?.five_hour?.map(one => one.percent)).toEqual([30, 31])
  // From 30 % at 40 min (before the window) to 31 % now, at 71 min: 1 % in 30 min, 69 % to go: 34.5 h.
  expect(limitEta(samples?.five_hour, 31, at(71))).toBe(undefined)
  // Steady for longer than the window: no burn.
  expect(limitEta([{ at: at(0), percent: 31 }], 31, at(70))).toBe(undefined)
  // Within the window only: from its first sample, 10 % in 20 min, 60 % to go: 2 h.
  expect(Math.round(limitEta([{ at: at(0), percent: 30 }, { at: at(10), percent: 35 }, { at: at(20), percent: 40 }], 40, at(20)) ?? 0)).toBe(120 * MINUTE)
  // A drop (a reset) starts the samples over.
  expect(limitSamplesAfter(samples, [{ kind: 'five_hour', percentUsed: 2 }], at(80))).toEqual({ five_hour: [{ at: at(80), percent: 2 }] })
  // The applied measurement drops the samples of a window it no longer holds.
  const usage = applyMeasure({ ...NO_FACTS.usage, rateLimits: [{ kind: 'seven_day', percentUsed: 5, resetsAt: new Date(at(1)).toISOString() }], limitSamples: { seven_day: [{ at: at(0), percent: 5 }] } }, { rateLimits: [] }, at(2))
  expect(usage.limitSamples).toBe(undefined)
})

test('busy and idle share the session\'s time: the turns ended, then the one running', () => {
  const usage: HudUsageFacts = { ...NO_FACTS.usage, busyMs: 30 * MINUTE }
  expect(busyIdleOf(usage, {}, undefined, NOW)).toBe(undefined)
  expect(busyIdleOf(usage, {}, 60 * MINUTE, NOW)).toEqual({ busy: 30 * MINUTE, idle: 30 * MINUTE })
  expect(busyIdleOf(usage, { busySince: NOW - 6 * MINUTE }, 60 * MINUTE, NOW)).toEqual({ busy: 36 * MINUTE, idle: 24 * MINUTE })
})

test('limit ETA needs three changed measurements spanning five minutes, not just elapsed wall time', () => {
  const sample = (minute: number, percent: number) => ({ at: NOW + minute * MINUTE, percent })
  expect(limitEta([sample(0, 10), sample(10, 20)], 20, NOW + 10 * MINUTE)).toBe(undefined)
  expect(limitEta([sample(0, 10), sample(1, 11), sample(4, 14)], 14, NOW + 20 * MINUTE)).toBe(undefined)
  expect(limitEta([sample(0, 10), sample(2, 12), sample(5, 15)], 15, NOW + 5 * MINUTE)).toBe(85 * MINUTE)
})
