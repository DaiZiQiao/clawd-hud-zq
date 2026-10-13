import type { ConfigRow, EngineInterface, Hook, Next } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { HudLedger, HudTidyGate, HudUsageFacts } from '../types'
import { register } from './register'
import { TIDY_INSTRUCTIONS } from './tidy'
import { START, TOGGLE, VIEWPORT, arrange, direct, mountPane } from './register.fixtures'

// T7: the two compaction paths measure the whole next main input, not the
// messages-only estimate, and book the summarizer once without a main clock.
for (const path of ['tidyNow', 'engine auto'] as const) {
  test(`T7 ${path}: first post-compaction A+F, Os and one summarizer booking`, { options: { inspect: true, tidy: 'ask' } }, async ($, on) => {
    const { clock, held } = arrange(on)
    const model = 'claude-opus-5-5'
    const summary = { input_tokens: 1000, output_tokens: 321, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 100 }
    let spent = { model, input_tokens: 7, output_tokens: 11, cache_read_input_tokens: 80_000, cache_creation_input_tokens: 3000 }
    let compactCalls = 0
    let reuse = false
    on('session.model', () => ({ value: model }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    on('session.compact', () => {
      compactCalls += 1

      return { messages: [{ role: 'assistant', text: 'summary', toolUses: [] }], tokensBefore: 182_000, tokensAfter: 123, ...(reuse ? {} : { usage: summary }) }
    })
    on('turn.step', async function* (_$, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: spent }
    })
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ key: 'engine' }))
    const gate = (): HudTidyGate => held.get('tidyGate')?.value as HudTidyGate
    const usage = (): HudUsageFacts => held.get('usage')?.value as HudUsageFacts
    const step = async (agentId?: string) => {
      const stream = $.turn.step({ turnId: 't1', index: 0, model, messageCount: 3, ...(agentId === undefined ? {} : { agentId }) } as Parameters<Engine['turn']['step']>[0])
      for await (const _chunk of stream) {
        // Drained: accounting follows the final result.
      }
    }
    await $.session.start(START)
    await clock.settle()
    held.set('session', { value: { model }, version: 50 })
    held.set('usage', { value: { contextTokens: 182_000, mainRequestAt: clock.now() - 1000, rateLimits: [], compactions: 0 }, version: 50 })
    held.set('session', { value: { model, cacheTtl: '1h', compactDisabled: false, isInteractive: true }, version: 51 })
    held.set('tidyGate', { value: { todos: [], tasks: [], precomputeSeen: false, teammate: false, mainRequests: 0, mainInput: 0, mainCacheRead: 0, ...(gate() as HudTidyGate | undefined), requestsSinceCompaction: 100 }, version: 51 })
    await $.session.measure({ context: { tokens: 182_000, window: 1_000_000 }, rateLimits: [], changed: ['context'] })
    const mainAt = usage().mainRequestAt
    if (path === 'tidyNow') {
      const band = await $.ui.mount({ plugin: 'mod-hud', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', viewport: VIEWPORT, props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} } })
      await band.press({ key: 'tidy:now' })
      await clock.settle()
      await band.unmount()
    } else {
      await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'the plan', toolUses: [] }] })
    }
    expect(compactCalls).toBe(1)
    expect(usage().tokens).toEqual({ input: 1000, output: 321, cacheRead: 90_000, cacheWrite: 100 })
    expect(gate().calibration?.summary).toBe(321)
    expect(gate().calibration?.after).toBeUndefined()
    expect(gate().awaitingAfter).toBe(true)
    expect(usage().mainRequestAt).toBe(mainAt)
    expect(usage().turnTokens).toBeUndefined()
    expect(usage().compactions).toBe(1)
    const ledger = held.get('ledger')?.value as HudLedger
    expect(ledger.entries.compact?.kind).toBe('fork')
    expect(ledger.entries.compact?.models[model]).toEqual({ input: 1000, output: 321, cacheRead: 90_000, cacheWrite: 100 })
    // An agent's response is not the next main request.
    await step('sub-1')
    expect(gate().calibration?.after).toBeUndefined()
    await step()
    expect(gate().calibration?.after).toBe(83_007)
    expect(gate().calibration?.summary).toBe(321)
    expect(gate().awaitingAfter).toBeUndefined()
    expect(gate().requestsSinceCompaction).toBe(1)
    expect(usage().tokens).toEqual({ input: 1014, output: 343, cacheRead: 250_000, cacheWrite: 6100 })
    spent = { ...spent, input_tokens: 9000 }
    await step()
    expect(gate().calibration?.after).toBe(83_007)
    expect(gate().requestsSinceCompaction).toBe(2)
    expect((held.get('ledger')?.value as HudLedger).entries.compact?.models[model]?.output).toBe(321)
    if (path === 'engine auto') {
      // Precompute spends now. Reusing it later has no usage and cannot book
      // it twice, reset Os, or measure A+F until the next main response.
      await $.session.compact({ trigger: 'precompute', messages: [{ role: 'user', text: 'the plan', toolUses: [] }] })
      expect(gate().precomputeSeen).toBe(true)
      expect(usage().compactions).toBe(1)
      expect((held.get('ledger')?.value as HudLedger).entries.compact?.models[model]?.output).toBe(642)
      reuse = true
      const tokensBeforeReuse = usage().tokens
      await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'the plan', toolUses: [] }] })
      expect(gate().precomputeSeen).toBe(false)
      expect(gate().requestsSinceCompaction).toBe(0)
      expect(gate().calibration?.summary).toBe(321)
      expect(usage().tokens).toEqual(tokensBeforeReuse)
      expect((held.get('ledger')?.value as HudLedger).entries.compact?.models[model]?.output).toBe(642)
      await step()
      expect(gate().calibration?.after).toBe(92_000)
    }
    // Calibration is local session state, retained by our clear handler.
    const calibration = gate().calibration
    await $.session.end({ reason: 'clear', sessionId: 's' } as Parameters<Engine['session']['end']>[0])
    expect(gate().calibration).toEqual(calibration)
    expect(gate().requestsSinceCompaction).toBe(0)
  })
}

test('resume and fork defer N_past until the first main start, including a failed read', async ($, on) => {
  const { clock, held } = arrange(on)
  let reads = 0
  let fail = false
  let malformed = false
  let roles: ('user' | 'assistant')[] = ['user', 'assistant', 'user', 'assistant', 'user', 'assistant']
  on('session.messages', (_$, e) => {
    reads += 1
    if (fail) throw new Error('transcript unavailable')
    if (malformed) return { value: [null] } as never

    return e.as === 'api'
      ? { value: roles.map(role => ({ role, content: [] })) }
      : { value: roles.map(role => ({ role, text: '', toolUses: [] })) }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('classic.SessionStart', () => ({}))
  await $.session.start(START)
  await clock.settle()
  const gate = (): HudTidyGate => held.get('tidyGate')?.value as HudTidyGate
  const baselineReads = reads
  await $.classic.SessionStart({ source: 'resume', context_tokens: 182_000, seconds_since_last_response: 60, prompt_cache_likely_expired: true })
  expect(reads).toBe(baselineReads)
  expect(gate().requestsSinceCompaction).toBe(0)
  expect(gate().seedPending).toBe(true)
  expect((held.get('usage')?.value as HudUsageFacts).mainRequestAt).toBe(clock.now() - 60_000)
  expect((held.get('usage')?.value as HudUsageFacts).contextTokens).toBe(182_000)
  // The resumed conversation replaces the departing one after SessionStart.
  roles = ['user', 'assistant', 'assistant', 'user', 'assistant']
  await $.turn.start({ turnId: 'resumed', text: 'continue' })
  expect(gate().requestsSinceCompaction).toBe(2)
  expect(gate().seedPending).toBeUndefined()
  expect(reads).toBe(baselineReads + 1)
  await $.turn.start({ turnId: 'next', text: 'continue' })
  expect(reads).toBe(baselineReads + 1)
  await $.classic.SessionStart({ source: 'fork' })
  expect(gate().requestsSinceCompaction).toBe(0)
  expect(gate().seedPending).toBe(true)
  fail = true
  await $.turn.start({ turnId: 'forked', text: 'continue' })
  expect(gate().requestsSinceCompaction).toBe(0)
  expect(gate().seedPending).toBeUndefined()
  await $.classic.SessionStart({ source: 'resume' })
  held.set('tidyGate', { value: { ...gate(), queuedAt: clock.now(), queuedWait: true }, version: 50 })
  fail = false
  malformed = true
  await $.turn.start({ turnId: 'malformed', text: 'continue' })
  expect(gate().requestsSinceCompaction).toBe(0)
  expect(gate().seedPending).toBeUndefined()
  expect(gate().queuedAt).toBeUndefined()
  expect(gate().queuedWait).toBeUndefined()
})

test('TaskCompleted keeps open work; an unknown TaskUpdate fails closed as main-created', async ($, on) => {
  const { clock, held, world } = arrange(on)
  on('classic.TaskCreated', () => ({}))
  on('classic.TaskCompleted', () => ({}))
  await $.session.start(START)
  await clock.settle()
  const gate = (): HudTidyGate => held.get('tidyGate')?.value as HudTidyGate
  await $.classic.TaskCreated({ task_id: '3', task_subject: 'work' })
  const version = held.get('tidyGate')?.version
  await $.classic.TaskCompleted({ task_id: '3', task_subject: 'work', teammate_name: 'peer' })
  expect(gate().tasks).toEqual([{ id: '3', subject: 'work', status: 'pending', creator: 'main' }])
  expect(held.get('tidyGate')?.version).toBe(version)
  world.tool = async () => ({ result: { success: true, taskId: '4', statusChange: { to: 'in_progress' } } })
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 'update-4', agentId: 'unseen', taskId: '4', status: 'in_progress' } as never)
  expect(gate().tasks.find(task => task.id === '4')?.creator).toBe('main')
  world.tool = async () => ({ result: { success: true, taskId: '3', statusChange: { to: 'completed' } } })
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 'update-3', taskId: '3', status: 'completed' } as never)
  expect(gate().tasks.some(task => task.id === '3')).toBe(false)
})

test('queued prompts persist wait, clear on consumption, drop and rejection, with bounded writes', async ($, on) => {
  const { clock, held, world } = arrange(on)
  let outcome = 'queued'
  on('prompt.submit', (_$, e) => {
    if (outcome === 'reject') throw new Error('submit rejected')

    return outcome === 'drop' ? { drop: 'dropped' } : { text: e.text }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  await $.session.start(START)
  await clock.settle()
  const gate = (): HudTidyGate => held.get('tidyGate')?.value as HudTidyGate
  const writes = () => world.writes.filter(key => key === 'tidyGate').length
  let before = writes()
  await $.prompt.submit({ text: 'wait', turnId: 't1', wait: true, origin: { kind: 'composer' } })
  expect(writes() - before).toBe(1)
  const queued = gate().queuedAt
  expect(gate().queuedWait).toBe(true)
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: '', isAborted: false, durationMs: 1 })
  expect(gate().queuedAt).toBe(queued)
  await $.turn.start({ turnId: 't2', text: 'wait' })
  expect(gate().queuedAt).toBeUndefined()
  expect(gate().queuedWait).toBeUndefined()
  await $.prompt.submit({ text: 'folded', turnId: 't2', wait: false, origin: { kind: 'composer' } })
  expect(gate().queuedWait).toBeUndefined()
  await $.turn.complete({ turnId: 't2', reason: 'answer', answer: '', isAborted: false, durationMs: 1 })
  expect(gate().queuedAt).toBeUndefined()
  outcome = 'drop'
  before = writes()
  await $.prompt.submit({ text: 'drop', wait: true, origin: { kind: 'composer' } })
  expect(gate().queuedAt).toBeUndefined()
  expect(writes() - before).toBe(2)
  outcome = 'reject'
  before = writes()
  await expect($.prompt.submit({ text: 'reject', wait: true, origin: { kind: 'composer' } })).rejects.toThrow('no implementation for prompt.submit')
  expect(gate().queuedAt).toBeUndefined()
  expect(writes() - before).toBe(2)
})

test('Stop stringifies task records and facts isolates unavailable tidy diagnostics', async ($, on) => {
  const { clock, held } = arrange(on)
  on('classic.Stop', () => ({}))
  await $.session.start(START)
  await clock.settle()
  held.set('usage', { value: { mainRequestAt: clock.now(), rateLimits: [] }, version: 40 })
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 7, type: 8, status: 9 }, { id: 10, type: 'shell' }] } as never)
  const gate = held.get('tidyGate')?.value as HudTidyGate
  expect(gate.stop?.tasks).toEqual([{ id: '7', type: '8', status: '9', kind: 'unknown' }, { id: '10', type: 'shell', status: '', kind: 'job' }])
  // An old or rewritten persisted record must not take down all facts.
  held.set('tidyGate', { value: { ...gate, stop: { ...gate.stop, tasks: [{ id: 'bad', type: 'shell', status: 4, kind: 'job' }] } }, version: 50 })
  held.set('usage', { value: { mainRequestAt: gate.stop?.requestAt, rateLimits: [] }, version: 50 })
  const result = await $.command.run({ ...TOGGLE, args: 'facts' })
  expect(result.text).toContain('"tidy": "unavailable"')
  expect(result.text).toContain('"session"')
})

for (const inspect of [true, false]) {
  test(`summary ledger respects inspect ${inspect} and the compacting loop model`, { options: { inspect } }, async ($, on) => {
    const { clock, held } = arrange(on)
    const mainModel = 'claude-opus-5-5'
    const agentModel = 'claude-haiku-5-5'
    const shadowModel = 'claude-sonnet-5-5'
    on('session.model', () => ({ value: mainModel }))
    on('session.compact', () => ({ messages: [{ role: 'assistant', text: 'summary', toolUses: [] }], usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }))
    await $.session.start(START)
    await clock.settle()
    held.set('agents', { value: { sub: { id: 'sub', model: agentModel } }, version: 50 })
    held.set('shadows', { value: { workflow: { id: 'workflow', model: shadowModel } }, version: 50 })
    const messages = [{ role: 'user' as const, text: 'work', toolUses: [] }]
    await $.session.compact({ trigger: 'auto', messages, agentId: 'sub' })
    await $.session.compact({ trigger: 'auto', messages, agentId: 'workflow' })
    await $.session.compact({ trigger: 'auto', messages, agentId: 'unknown' })
    expect((held.get('usage')?.value as HudUsageFacts).tokens).toEqual({ input: 3000, output: 300, cacheRead: 0, cacheWrite: 0 })
    const ledger = held.get('ledger')?.value as HudLedger | undefined
    if (inspect) {
      expect(ledger?.entries.compact?.models[agentModel]?.output).toBe(100)
      expect(ledger?.entries.compact?.models[shadowModel]?.output).toBe(100)
      expect(ledger?.entries.compact?.models[mainModel]).toBeUndefined()
    } else {
      expect(ledger?.entries.compact).toBeUndefined()
    }
    await $.session.compact({ trigger: 'auto', messages })
    expect((held.get('usage')?.value as HudUsageFacts).tokens).toEqual({ input: 4000, output: 400, cacheRead: 0, cacheWrite: 0 })
    const mainSummary = (held.get('ledger')?.value as HudLedger | undefined)?.entries.compact?.models[mainModel]
    if (inspect) expect(mainSummary?.output).toBe(100)
    else expect(mainSummary).toBeUndefined()
  })
}


// T3/T5/T6/T10 exercise the scheduler through the host's real hook chain.
const schedulerWorld = (on: Parameters<typeof arrange>[0], intro = false) => {
  const arranged = arrange(on)
  const store = new Map<string, unknown>(intro ? [] : [['autoTidyChosen', true]])
  const storeWrites: string[] = []
  const configWrites: { key: string; value: unknown; countdown?: number; pending?: string; chosen?: unknown }[] = []
  const state = {
    draft: '', promptFails: false, surfaces: ['terminal'], tools: ['TodoWrite'],
    autoCompact: true, env: {} as Record<string, string>, calls: [] as Record<string, unknown>[],
    trace: [] as string[], skip: undefined as string | undefined, reject: undefined as string | undefined,
    configRows: [] as ConfigRow[], configDeny: undefined as string | undefined, configReject: undefined as string | undefined,
    submit: 'accept', configDelay: 0, configPollDelay: 0, configSetDelay: 0, configFails: false, storeFails: false, compactDelay: 0,
    configRead: undefined as (() => Promise<void>) | undefined,
  }
  const record = (name: string) => state.trace.push(name)
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    storeWrites.push(e.key)
    record(`store:${e.key}`)
    if (state.storeFails && e.key === 'autoTidyChosen') throw new Error('store write failed')
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('config.set', async (_$, e) => {
    record('config.set')
    const tidy = arranged.held.get('tidy')?.value as import('../types').HudTidyFacts | undefined
    configWrites.push({ key: e.key, value: e.value, countdown: tidy?.countdownSince, pending: (arranged.held.get('tidyGate')?.value as HudTidyGate).pendingToggle, chosen: store.get('autoTidyChosen') })
    if (state.configSetDelay > 0) await arranged.clock.sleep(state.configSetDelay)
    if (state.configReject !== undefined) throw new Error(state.configReject)
    return state.configDeny === undefined ? { value: e.value } : { deny: state.configDeny }
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('env.get', (_$, e) => ({ value: state.env[e.name] }))
  on('prompt.read', () => {
    record('prompt')
    if (state.promptFails) throw new Error('draft unavailable')
    return { value: { text: state.draft, cursor: state.draft.length } }
  })
  on('session.surfaces', () => { record('surfaces'); return { value: state.surfaces } as never })
  on('tool.list', () => ({ value: state.tools.map(name => ({ name, description: name, mcp: false })) }))
  on('config.list', async () => {
    const delay = state.configDelay || state.configPollDelay
    state.configDelay = 0
    if (delay > 0) await arranged.clock.sleep(delay)
    const callback = state.configRead
    state.configRead = undefined
    if (callback !== undefined) await callback()
    record('config')
    if (state.configFails) throw new Error('settings unavailable')
    return { value: [{ key: 'autoCompact', label: 'Auto compact', kind: 'boolean', value: state.autoCompact, provider: { plugin: 'engine', tier: 'core' } }, ...state.configRows] } as never
  })
  on('session.usage', () => {
    record('usage')
    return { value: { startedAt: 0, context: { tokens: (arranged.held.get('usage')?.value as HudUsageFacts | undefined)?.contextTokens ?? 400_000, window: 1_000_000 }, rateLimits: [] } }
  })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('classic.Stop', () => ({}))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_$, e) => {
    if (state.submit === 'reject') throw new Error('submit rejected')
    return state.submit === 'drop' ? { drop: 'drop' } : { text: e.text }
  })
  on('session.compact', async (_$, e) => {
    record('compact')
    state.calls.push(e as unknown as Record<string, unknown>)
    if (state.compactDelay > 0) await arranged.clock.sleep(state.compactDelay)
    if (state.reject !== undefined) throw new Error(state.reject)
    return state.skip !== undefined ? { skip: state.skip } : { messages: [{ role: 'assistant', text: 'summary', toolUses: [] }], tokensBefore: 400_000, tokensAfter: 80_000 }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ key: 'engine' }))
  const gate = (): HudTidyGate => arranged.held.get('tidyGate')?.value as HudTidyGate
  const tidy = () => arranged.held.get('tidy')?.value as import('../types').HudTidyFacts | undefined
  const set = (key: string, value: unknown) => arranged.held.set(key, { value, version: (arranged.held.get(key)?.version ?? 0) + 1 })
  const seed = () => {
    const now = arranged.clock.now()
    set('session', { model: 'claude-opus-5-5', cacheTtl: '1h', compactDisabled: state.env.DISABLE_COMPACT === '1', isInteractive: true, autoCompact: true })
    set('usage', { contextTokens: 400_000, mainRequestAt: now, rateLimits: [], compactions: 0 })
    set('main', { idleSince: now - 240_000, lastTurnReason: 'answer' })
    set('tidyGate', { todos: [], tasks: [], precomputeSeen: false, teammate: false, requestsSinceCompaction: 140, mainRequests: 5, mainInput: 2_000_000, mainCacheRead: 2_000_000, stop: { at: now, requestAt: now, tasks: [], previousTaskIds: [], oneShotCrons: 0 } })
    arranged.world.panes = [{ id: 'hud', title: 'HUD', isShown: true, isPlaced: true, isFocused: false }]
  }
  const measure = ($: Engine, tokens = 400_000) => $.session.measure({ context: { tokens, window: 1_000_000 }, rateLimits: [], changed: ['context'] })
  const mount = ($: Engine) => $.ui.mount({ plugin: 'mod-hud', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', viewport: VIEWPORT, props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} } })
  return { ...arranged, state, gate, tidy, set, seed, measure, mount, store, storeWrites, configWrites }
}

const AUTO = { options: { tidy: 'auto', mascots: false, showGit: false } } as const
const ASK = { options: { tidy: 'ask', mascots: false, showGit: false } } as const

for (const [blocker, reason] of [
  ['busy', 'Claude is working'], ['queued', 'a prompt is queued'], ['aborted', 'last turn was interrupted'],
  ['agent', '1 agent running'], ['agent list', 'cannot read the agent list'],
  ['subagent', '1 agent running'], ['workflow', 'a workflow running'], ['unknown', 'unknown background work'],
  ['shell', 'a job started this turn'], ['MCP task', 'a job started this turn'], ['teammate task', '1 agent running'],
  ['stale Stop', 'the next turn to end'],
  ['draft', 'you are typing'], ['unreadable draft', 'cannot read the prompt box'],
  ['todo', '1 todo open'], ['task', '1 task open'], ['cron', 'a wakeup is scheduled'],
  ['compacting', 'a compaction is running'], ['recent compact', 'a compaction just finished'],
  ['settle', 'a 4-min pause after the turn'], ['workflow shadow', 'a workflow running'],
] as const) {
  test(`${['agent list', 'unreadable draft', 'compacting', 'recent compact', 'workflow shadow'].includes(blocker) ? 'T3b' : 'T3'} ${blocker}: due automatic D1 waits with its reason and never compacts`, AUTO, async ($, on) => {
    const w = schedulerWorld(on)
    await $.session.start(START)
    await w.clock.settle()
    w.seed()
    if (blocker === 'busy') await $.turn.start({ turnId: 'new', text: 'work' })
    if (blocker === 'queued') await $.prompt.submit({ text: 'work', turnId: 'new', wait: true, origin: { kind: 'task-notification', agentId: 'a' } } as never)
    if (blocker === 'aborted') w.set('main', { idleSince: w.clock.now(), lastTurnReason: 'aborted' })
    if (blocker === 'agent') w.world.agents = [{ id: 'a', status: 'running' }] as never
    if (blocker === 'agent list') w.world.denyList = true
    if (['subagent', 'workflow', 'unknown', 'shell', 'MCP task', 'teammate task'].includes(blocker)) {
      const type = blocker === 'teammate task' ? 'teammate' : blocker === 'unknown' ? 'new-kind' : blocker
      await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'work', type, status: 'running' }] } as never)
    }
    if (blocker === 'stale Stop') w.set('tidyGate', { ...w.gate(), stop: { ...w.gate().stop, requestAt: w.clock.now() - 1 } })
    if (blocker === 'draft') w.state.draft = 'writing'
    if (blocker === 'unreadable draft') w.state.promptFails = true
    if (blocker === 'todo') {
      w.world.tool = async () => ({ result: 'ok' })
      await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'finish', status: 'pending', activeForm: 'Finishing' }] } as never)
    }
    if (blocker === 'task') {
      w.world.tool = async () => ({ result: { task: { id: '1', subject: 'finish' } } })
      await $.tool.call({ tool: 'TaskCreate', subject: 'finish' } as never)
    }
    if (blocker === 'cron') w.set('tidyGate', { ...w.gate(), stop: { ...w.gate().stop, oneShotCrons: 1 } })
    if (blocker === 'compacting') w.set('tidy', { runningSince: w.clock.now() })
    if (blocker === 'recent compact') w.set('tidy', { last: { at: w.clock.now(), trigger: 'auto', after: 80_000 } })
    if (blocker === 'settle') { w.state.tools = []; w.set('main', { lastTurnReason: 'answer', idleSince: w.clock.now() }) }
    if (blocker === 'workflow shadow') w.set('shadows', { wf: { id: 'wf', status: 'running', firstSeen: w.clock.now(), lastSeen: w.clock.now(), steps: 1, toolCalls: 1 } })
    // agent.list failures are retried on the next event, not on a waiting poll.
    if (blocker === 'agent list') w.world.denyList = true
    await w.measure($)
    expect(w.tidy()?.pending?.state).toBe('waiting')
    expect(w.tidy()?.pending?.reasons).toContain(reason)
    expect(w.tidy()?.pending?.automatic).toBe(true)
    const gateWrites = w.world.writes.filter(key => key === 'tidyGate').length
    const tidyWrites = w.world.writes.filter(key => key === 'tidy').length
    await w.clock.advance(blocker === 'recent compact' ? 10_000 : 30_000)
    await w.clock.settle()
    expect(w.state.calls).toHaveLength(0)
    expect(w.world.writes.filter(key => key === 'tidyGate').length).toBe(gateWrites)
    expect(w.world.writes.filter(key => key === 'tidy').length).toBe(tidyWrites)
  })
}

for (const work of ['old shell', 'idle teammate', 'dream', 'ended fork'] as const) {
  test(`T3 ${work} does not block; exactly one tidy keeps static instructions and ended-loop open tasks`, AUTO, async ($, on) => {
    const w = schedulerWorld(on)
    await $.session.start(START)
    await w.clock.settle()
    w.seed()
    const stop = w.gate().stop!
    if (work !== 'ended fork') w.set('tidyGate', { ...w.gate(), stop: { ...stop, tasks: [{ id: 'a', type: work === 'old shell' ? 'shell' : work === 'dream' ? 'dream' : 'teammate', status: work === 'idle teammate' ? 'idle' : 'running' }], previousTaskIds: work === 'old shell' ? ['a'] : [] } })
    w.set('tidyGate', { ...w.gate(), tasks: [{ id: 'ended', subject: 'review the design', status: 'in_progress', creator: 'ended-agent' }] })
    if (work === 'ended fork') await $.turn.complete({ turnId: 'fork', agentId: 'ended-agent', reason: 'answer', answer: '', isAborted: false, durationMs: 1 })
    await w.measure($)
    expect(w.tidy()?.pending?.state).toBe('countdown')
    const writes = w.world.writes.filter(key => key === 'tidy').length
    await w.clock.advance(29_000)
    await w.clock.settle()
    expect(w.world.writes.filter(key => key === 'tidy').length).toBe(writes)
    expect(w.state.calls).toHaveLength(0)
    await w.clock.advance(1000)
    await w.clock.settle()
    expect(w.state.calls).toHaveLength(1)
    expect(w.state.calls[0]?.instructions).toContain(TIDY_INSTRUCTIONS)
    expect(w.state.calls[0]?.instructions).toContain('Task [in_progress]: review the design')
    expect(w.state.trace.slice(0, w.state.trace.lastIndexOf('compact'))).toEqual(expect.arrayContaining(['prompt', 'surfaces', 'config', 'usage']))
    await w.clock.advance(30_000)
    await w.clock.settle()
    expect(w.state.calls).toHaveLength(1)
  })
}

for (const interruption of ['draft', 'notification', 'engine compaction'] as const) {
  test(`${interruption === 'engine compaction' ? 'T16' : 'T3'} ${interruption} stops a countdown without Not-now or D2 suppression`, AUTO, async ($, on) => {
    const w = schedulerWorld(on)
    await $.session.start(START)
    await w.clock.settle()
    w.seed()
    await w.measure($)
    expect(w.tidy()?.pending?.state).toBe('countdown')
    if (interruption === 'draft') { w.state.draft = 'typing'; await w.clock.advance(1000); await w.clock.settle() }
    if (interruption === 'notification') await $.prompt.submit({ text: 'done', turnId: 'notice', origin: { kind: 'task-notification', agentId: 'a' } } as never)
    if (interruption === 'engine compaction') await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'work', toolUses: [] }] })
    expect(w.tidy()?.countdownSince).toBeUndefined()
    expect(w.tidy()?.dismissedAt).toBeUndefined()
    expect(w.tidy()?.coolingDismissedAt).toBeUndefined()
    if (interruption !== 'engine compaction') expect(w.tidy()?.pending?.state).toBe('waiting')
    await w.clock.advance(30_000)
    await w.clock.settle()
    expect(w.state.calls).toHaveLength(interruption === 'engine compaction' ? 1 : 0)
  })
}

test('T3 reload keeps blockers; a missing Stop fails closed; settle timer wakes D1 without a waiting poll', AUTO, async ($, on) => {
  const w = schedulerWorld(on)
  await $.session.start(START)
  await w.clock.settle()
  w.seed()
  w.state.tools = []
  w.set('main', { lastTurnReason: 'answer', idleSince: w.clock.now() })
  await w.measure($)
  expect(w.tidy()?.pending?.firstReason).toBe('a 4-min pause after the turn')
  // session.start is the host's reload callback; evidence is held by the host.
  await $.session.start(START)
  await w.clock.settle()
  expect(w.tidy()?.pending?.firstReason).toBe('a 4-min pause after the turn')
  const reads = w.state.trace.length
  await w.clock.advance(239_000)
  await w.clock.settle()
  expect(w.state.trace.length).toBe(reads)
  expect(w.state.calls).toHaveLength(0)
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(w.tidy()?.pending?.state).toBe('countdown')
  await w.clock.advance(30_000)
  await w.clock.settle()
  expect(w.state.calls).toHaveLength(1)
  w.seed()
  w.set('tidy', {})
  w.set('tidyGate', { ...w.gate(), stop: undefined })
  await $.session.start(START)
  await w.clock.settle()
  expect(w.tidy()?.pending?.state).toBe('waiting')
  expect(w.tidy()?.pending?.reasons).toContain('the next turn to end')
})

test('T3 a tool in flight holds waiting until its end; open tasks count only live creators', AUTO, async ($, on) => {
  const w = schedulerWorld(on)
  await $.session.start(START)
  await w.clock.settle()
  w.seed()
  w.world.tool = async () => { await w.clock.sleep(2000); return { result: 'ok' } }
  const running = $.tool.call({ tool: 'Read', file_path: '/work/file' } as never)
  await w.clock.settle()
  await w.measure($)
  expect(w.tidy()?.pending?.reasons).toContain('a tool is running')
  expect(w.state.calls).toHaveLength(0)
  await w.clock.advance(2000)
  await running
  await w.clock.settle()
  expect(w.tidy()?.pending?.state).toBe('countdown')
  w.world.agents = [{ id: 'peer', status: 'waiting' }] as never
  w.set('tidyGate', { ...w.gate(), tasks: [{ id: '1', subject: 'review', status: 'pending', creator: 'peer' }] })
  await w.measure($)
  expect(w.tidy()?.pending?.reasons).toContain('1 task open')
  w.world.agents = []
  w.set('agents', { peer: { id: 'peer', status: 'running' } })
  await w.measure($)
  expect(w.tidy()?.pending?.reasons).toContain('1 task open')
  w.set('agents', { peer: { id: 'peer', status: 'done' } })
  await w.measure($)
  expect(w.tidy()?.pending?.state).toBe('countdown')
})

test('T3 sticky queued wait survives same-turn submits and restores a replaced record on drop/rejection', AUTO, async ($, on) => {
  const w = schedulerWorld(on)
  await $.session.start(START)
  await w.clock.settle()
  w.seed()
  await $.prompt.submit({ text: 'wait', turnId: 't1', wait: true, origin: { kind: 'composer' } })
  await w.clock.advance(1)
  await $.prompt.submit({ text: 'fold', turnId: 't1', wait: false, origin: { kind: 'composer' } })
  expect(w.gate().queuedWait).toBe(true)
  const pending = { queuedAt: w.gate().queuedAt, queuedTurnId: w.gate().queuedTurnId, queuedWait: w.gate().queuedWait }
  for (const outcome of ['drop', 'reject', 'drop across turns', 'reject across turns']) {
    w.state.submit = outcome.split(' ')[0]!
    const before = w.world.writes.filter(key => key === 'tidyGate').length
    const submit = $.prompt.submit({ text: outcome, turnId: outcome.includes('across') ? 't2' : 't1', wait: false, origin: { kind: 'composer' } })
    if (outcome.startsWith('reject')) await expect(submit).rejects.toThrow()
    else await submit
    expect(w.world.writes.filter(key => key === 'tidyGate').length - before).toBeLessThanOrEqual(2)
    expect(w.gate()).toMatchObject(pending)
  }
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: '', isAborted: false, durationMs: 1 })
  expect(w.gate()).toMatchObject(pending)
  expect(w.tidy()?.pending?.reasons).toContain('a prompt is queued')
  expect(w.state.calls).toHaveLength(0)
  await $.turn.start({ turnId: 'next', text: 'wait' })
  expect(w.gate().queuedAt).toBeUndefined()
  expect(w.gate().queuedWait).toBeUndefined()
})

for (const condition of ['row off', 'breakdown off', 'environment off', 'disabled', 'mobile', 'desktop', 'teammate', 'headless', 'unpriced', 'broken cache', 'assumed TTL'] as const) {
  test(`${['row off', 'breakdown off', 'disabled'].includes(condition) ? 'T5' : condition === 'mobile' ? 'T3' : 'T11'} ${condition}: availability is reflected in the decision`, AUTO, async ($, on) => {
    const w = schedulerWorld(on)
    if (condition === 'disabled') w.state.env.DISABLE_COMPACT = '1'
    await $.session.start(START)
    await w.clock.settle()
    w.seed()
    if (condition === 'row off') w.state.autoCompact = false
    if (condition === 'breakdown off') w.set('inventory', { mcpServers: [], isAutoCompactEnabled: false })
    const session = w.held.get('session')!.value as Record<string, unknown>
    if (condition === 'environment off') w.set('session', { ...session, autoCompact: false })
    if (condition === 'headless') w.set('session', { ...session, isInteractive: false })
    if (condition === 'unpriced') w.set('session', { ...session, model: 'opus-9' })
    if (condition === 'assumed TTL') w.set('session', { ...session, cacheTtlAssumed: true })
    if (condition === 'broken cache') w.set('tidyGate', { ...w.gate(), mainCacheRead: 0 })
    if (condition === 'mobile' || condition === 'desktop') w.state.surfaces = [condition]
    if (condition === 'teammate') w.set('tidyGate', { ...w.gate(), teammate: true })
    await w.measure($)
    const pending = w.tidy()?.pending
    if (condition === 'disabled' || condition === 'headless') expect(pending).toBeUndefined()
    else if (condition === 'assumed TTL') {
      expect(pending?.state).toBe('countdown')
      expect(pending?.rule).toBe('D1')
      expect(pending?.availabilityReason).toBe('TTL is a guess: set cacheTtl')
      expect(Math.abs((pending?.costs?.K ?? 0) - 1.06) < 0.005).toBe(true)
    } else {
      expect(pending?.state).toBe('offer')
      expect(pending?.automatic).toBe(false)
      if (condition.includes('off')) expect(pending?.availabilityReason).toBe('auto-compact is off in your settings')
      if (condition === 'unpriced' || condition === 'broken cache') expect(pending?.rule).toBe('advisory')
    }
    const status = (await $.command.run({ ...TOGGLE, args: 'tidy' })).text
    const suffix = condition === 'row off' || condition === 'breakdown off' || condition === 'environment off' ? 'auto-compact is off in your settings'
      : condition === 'mobile' || condition === 'desktop' ? 'open on a surface without the band'
        : condition === 'teammate' ? 'teammate session'
          : condition === 'unpriced' ? 'no price for opus-9'
            : condition === 'broken cache' ? 'prompt cache not working here' : undefined
    if (suffix === undefined) expect(status).not.toContain('offers only:')
    else expect(status).toContain(` · offers only: ${suffix}`)
    if (condition === 'assumed TTL') {
      w.set('inventory', { mcpServers: [], autocompactSource: 'env' })
      await w.measure($)
      expect(w.tidy()?.pending).toMatchObject({ state: 'offer', rule: 'D1', automatic: false, availabilityReason: 'TTL is a guess: set cacheTtl' })
      expect((await $.command.run({ ...TOGGLE, args: 'tidy' })).text).not.toContain('offers only:')
    }
    await w.clock.advance(condition === 'assumed TTL' ? 1000 : 30_000)
    await w.clock.settle()
    expect(w.state.calls).toHaveLength(0)
  })
}

for (const mode of ['ask', 'off'] as const) {
  test(`T6 ${mode}: Option F respects trigger, instructions, precompute reuse and loop`, { options: { tidy: mode, mascots: false, showGit: false } }, async ($, on) => {
    const w = schedulerWorld(on)
    await $.session.start(START)
    await w.clock.settle()
    w.seed()
    const run = async (trigger: 'auto' | 'manual' | 'precompute', extra: Record<string, unknown> = {}) => {
      await $.session.compact({ trigger, messages: [{ role: 'user', text: 'work', toolUses: [] }], ...extra } as never)
      return w.state.calls.at(-1)?.instructions
    }
    expect(await run('auto')).toBe(mode === 'off' ? undefined : TIDY_INSTRUCTIONS)
    expect(await run('precompute')).toBe(mode === 'off' ? undefined : TIDY_INSTRUCTIONS)
    expect(w.gate().precomputeSeen).toBe(true)
    expect(await run('auto')).toBeUndefined()
    expect(await run('manual')).toBeUndefined()
    expect(await run('manual', { instructions: 'keep my exact words' })).toBe('keep my exact words')
    expect(await run('auto', { agentId: 'peer' })).toBeUndefined()
    expect(await run('precompute', { agentId: 'peer' })).toBeUndefined()
    expect(await run('auto', { instructions: 'custom' })).toBe('custom')
    w.set('session', { ...(w.held.get('session')!.value as object), compactDisabled: true })
    expect(await run('precompute')).toBeUndefined()
    expect(await run('auto')).toBeUndefined()
  })
}

test('T10 Tidy up now keeps open items and files, ignores agents/draft, and blocks busy with exact copy', AUTO, async ($, on) => {
  const w = schedulerWorld(on)
  await $.session.start(START)
  await w.clock.settle()
  w.seed()
  await w.measure($)
  const band = await w.mount($)
  w.set('tidyGate', { ...w.gate(), todos: [{ content: 'finish the code', status: 'in_progress' }], tasks: [{ id: '1', subject: 'review the code', status: 'pending', creator: 'main' }] })
  w.world.agents = [{ id: 'a', status: 'running' }] as never
  w.state.draft = 'I am typing'
  w.set('tools', { counts: {}, edited: Array.from({ length: 12 }, (_, index) => `/work/file-${index}`) })
  w.state.configDelay = 2000
  w.state.compactDelay = 2000
  await band.press({ key: 'tidy:now' })
  await w.clock.settle()
  await band.press({ key: 'tidy:now' })
  // An agent's tool activity changes the shared epoch, but not SP14's counter.
  await $.tool.call({ tool: 'Read', agentId: 'a', file_path: '/work/file' } as never)
  await w.clock.advance(2000)
  await w.clock.settle()
  expect(w.state.calls).toHaveLength(1)
  const runningSince = w.tidy()?.runningSince
  expect(runningSince).toBe(w.clock.now())
  await band.press({ key: 'tidy:now' })
  await w.clock.settle()
  expect(w.tidy()?.runningSince).toBe(runningSince)
  expect(w.tidy()?.failed).toBeUndefined()
  await w.measure($)
  expect(w.tidy()?.pending?.reasons).toContain('a compaction is running')
  await w.clock.advance(2000)
  await w.clock.settle()
  const instructions = w.state.calls[0]?.instructions as string
  expect(instructions).toContain(TIDY_INSTRUCTIONS)
  expect(instructions).toContain('Todo [in_progress]: finish the code')
  expect(instructions).toContain('Task [pending]: review the code')
  expect(instructions).toContain('File: /work/file-11')
  expect(instructions).not.toContain('File: /work/file-0\n')
  expect(instructions.length).toBeLessThanOrEqual(2000)
  await w.clock.advance(20_000)
  w.seed()
  w.state.compactDelay = 0
  w.state.draft = ''
  w.world.agents = []
  w.set('tidy', {})
  await w.measure($)
  await band.redraw()
  w.set('main', { busySince: w.clock.now() })
  // The old countdown action still exists when the busy fact changes.
  await band.press({ key: 'tidy:now' })
  await w.clock.settle()
  expect(w.state.calls).toHaveLength(1)
  expect(w.tidy()?.failed?.reason).toBe('Claude is working')
  w.set('main', { idleSince: w.clock.now() - 240_000, lastTurnReason: 'answer' })
  w.set('tidy', {})
  await w.measure($)
  await band.redraw()
  w.state.configPollDelay = 2000
  await band.press({ key: 'tidy:now' })
  await w.clock.settle()
  const first = $.prompt.submit({ text: 'first', turnId: 'first', wait: false, origin: { kind: 'composer' } })
  await w.clock.settle()
  await w.clock.advance(2000)
  await first
  await w.clock.settle()
  const second = $.prompt.submit({ text: 'second', turnId: 'second', wait: false, origin: { kind: 'composer' } })
  await w.clock.settle()
  await w.clock.advance(2000)
  await second
  await w.clock.settle()
  expect(w.state.calls).toHaveLength(1)
  expect(w.tidy()?.failed?.reason).toBe('Claude started working; try again')
  expect(w.tidy()?.backoff).toBeUndefined()
  w.state.configPollDelay = 0
  await band.unmount()
})

for (const from of ['measure', 'reload', 'main request'] as const) {
  test(`T12 cooling timer from ${from}: D2 beats D1, with no waiting poll and one compact`, { options: { ...AUTO.options, cacheTtl: '1h' } }, async ($, on) => {
    const w = schedulerWorld(on)
    on('turn.step', async function* (_$, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: { model: e.model, input_tokens: 0, output_tokens: 1, cache_read_input_tokens: 400_000, cache_creation_input_tokens: 0 } }
    })
    await $.session.start(START)
    await w.clock.settle()
    w.seed()
    const requestAt = w.clock.now() - (from === 'main request' ? 0 : 3_479_000)
    w.set('usage', { contextTokens: 400_000, mainRequestAt: requestAt, rateLimits: [] })
    w.set('tidyGate', { ...w.gate(), requestsSinceCompaction: 0, stop: { ...w.gate().stop, requestAt } })
    if (from === 'main request') {
      const stream = $.turn.step({ turnId: 'request', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as never)
      for await (const _chunk of stream) { /* The response books the request's clock. */ }
      await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] })
      await $.turn.complete({ turnId: 'request', reason: 'answer', answer: '', isAborted: false, durationMs: 1 })
    } else if (from === 'reload') await $.session.start(START)
    else await w.measure($)
    await w.clock.settle()
    expect(w.tidy()?.pending).toBeUndefined()
    const trace = w.state.trace.length
    const untilCool = from === 'main request' ? 3_480_000 : 1000
    await w.clock.advance(untilCool - 1)
    await w.clock.settle()
    expect(w.state.trace.length).toBe(trace)
    expect(w.state.calls).toHaveLength(0)
    // Make D1 due too, without an event: the cooling callback selects D2.
    w.set('tidyGate', { ...w.gate(), requestsSinceCompaction: 140 })
    await w.clock.advance(1)
    await w.clock.settle()
    expect(w.tidy()?.pending?.rule).toBe('D2')
    expect(w.tidy()?.pending?.automatic).toBe(true)
    expect(w.tidy()?.pending?.state).toBe('countdown')
    expect(w.tidy()?.pending?.endsAt).toBe(w.clock.now() + 30_000)
    expect(w.tidy()?.pending?.cacheExpiresAt).toBe(w.clock.now() + 120_000)
    await w.clock.advance(30_000)
    await w.clock.settle()
    expect(w.state.calls).toHaveLength(1)
    if (from === 'measure') {
      for (const [left, idle] of [[39_999, 240_000], [60_000, 200_000], [120_000, 200_000]] as const) {
        w.seed()
        w.set('tidy', {})
        const requestAt = w.clock.now() - 3_600_000 + left
        w.set('usage', { contextTokens: 400_000, mainRequestAt: requestAt, rateLimits: [] })
        w.set('main', { idleSince: w.clock.now() - idle, lastTurnReason: 'answer' })
        w.set('tidyGate', { ...w.gate(), stop: { ...w.gate().stop, requestAt } })
        w.state.tools = []
        await w.measure($)
        expect(w.tidy()?.pending?.rule).toBe('D2')
        expect(w.tidy()?.pending?.state).toBe(left === 120_000 ? 'waiting' : 'offer')
        if (left === 120_000) {
          expect(w.tidy()?.pending?.reasons).toContain('a 4-min pause after the turn')
          await w.clock.advance(40_000)
          await w.clock.settle()
          expect(w.tidy()?.pending?.state).toBe('countdown')
          await w.clock.advance(30_000)
          await w.clock.settle()
          expect(w.state.calls).toHaveLength(2)
        }
      }
      for (const [left, tools] of [[60_000, []], [39_999, ['TodoWrite']]] as const) {
        w.seed()
        w.set('tidy', {})
        const requestAt = w.clock.now() - 3_600_000 + left
        w.set('usage', { contextTokens: 400_000, mainRequestAt: requestAt, rateLimits: [] })
        w.set('main', { busySince: w.clock.now() })
        w.set('tidyGate', { ...w.gate(), stop: { ...w.gate().stop, requestAt } })
        w.state.tools = [...tools]
        const calls = w.state.calls.length
        await w.measure($)
        expect(w.tidy()?.pending?.rule).toBe('D2')
        expect(w.tidy()?.pending?.automatic).toBe(true)
        expect(w.tidy()?.pending?.state).toBe('waiting')
        expect(w.tidy()?.pending?.firstReason).toBe('Claude is working')
        expect(w.state.calls).toHaveLength(calls)
        w.set('main', { idleSince: w.clock.now(), lastTurnReason: 'answer' })
        await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] })
        await w.measure($)
        expect(w.tidy()?.pending?.rule).toBe('D2')
        expect(w.tidy()?.pending?.automatic).toBe(false)
        expect(w.tidy()?.pending?.state).toBe('offer')
        expect(w.state.calls).toHaveLength(calls)
      }
    }
  })
}

test('T15 countdown re-reads surfaces and the final config row; hidden HUD and changed settings stop safely', AUTO, async ($, on) => {
  const w = schedulerWorld(on)
  await $.session.start(START)
  await w.clock.settle()
  w.seed()
  await w.measure($)
  w.state.surfaces = ['terminal', 'mobile']
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(w.tidy()?.pending?.state).toBe('offer')
  expect(w.tidy()?.pending?.availabilityReason).toBe('open on a surface without the band')
  w.state.surfaces = ['terminal']
  await w.measure($)
  w.world.panes = []
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(w.tidy()?.pending?.state).toBe('waiting')
  expect(w.tidy()?.pending?.reasons).toContain('the HUD is not on screen')
  w.world.panes = [{ id: 'hud', title: 'HUD', isPlaced: true, isShown: true, isFocused: false }]
  await w.measure($)
  await w.clock.advance(29_000)
  await w.clock.settle()
  w.state.autoCompact = false
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(w.state.calls).toHaveLength(0)
  expect(w.tidy()?.pending?.state).toBe('offer')
  expect(w.tidy()?.pending?.availabilityReason).toBe('auto-compact is off in your settings')
  w.state.autoCompact = true
  w.state.configFails = true
  await w.measure($)
  expect(w.tidy()?.pending?.state).toBe('offer')
  expect(w.tidy()?.pending?.availabilityReason).toBe('cannot read your settings')
  w.state.configFails = false
  await w.measure($)
  expect(w.tidy()?.pending?.state).toBe('countdown')
})

for (const ttl of ['5m', '1h'] as const) {
  test(`T13 Cancel stops ${ttl} D2 for this gap; a new main request permits a new decision`, { options: { ...AUTO.options, cacheTtl: ttl } }, async ($, on) => {
    const w = schedulerWorld(on)
    await $.session.start(START)
    await w.clock.settle()
    w.seed()
    const requestAt = w.clock.now() - (ttl === '5m' ? 250_000 : 3_500_000)
    w.set('session', { ...(w.held.get('session')!.value as object), cacheTtl: ttl })
    w.set('usage', { contextTokens: 400_000, mainRequestAt: requestAt, rateLimits: [] })
    w.set('tidyGate', { ...w.gate(), requestsSinceCompaction: 0, stop: { ...w.gate().stop, requestAt } })
    await w.measure($)
    expect(w.tidy()?.pending?.rule).toBe('D2')
    const band = await w.mount($)
    await band.press({ key: 'tidy:later' })
    await w.clock.settle()
    expect(w.tidy()?.coolingDismissedAt).toBe(requestAt)
    expect(w.tidy()?.pending).toBeUndefined()
    await w.measure($)
    await w.clock.advance(30_000)
    await w.clock.settle()
    expect(w.state.calls).toHaveLength(0)
    const newer = w.clock.now()
    w.set('usage', { contextTokens: 450_000, mainRequestAt: newer, rateLimits: [] })
    w.set('tidyGate', { ...w.gate(), requestsSinceCompaction: 140, stop: { ...w.gate().stop, requestAt: newer } })
    await w.measure($, 450_000)
    expect(w.tidy()?.pending?.rule).toBe('D1')
    expect(w.tidy()?.pending?.state).toBe('countdown')
    await band.unmount()
  })
}

test('T14 skip reports its reason and backs off until growth or a new gap', AUTO, async ($, on) => {
  const w = schedulerWorld(on)
  await $.session.start(START)
  await w.clock.settle()
  w.seed()
  w.state.skip = 'summary could not be prepared'
  await w.measure($)
  await w.clock.advance(30_000)
  await w.clock.settle()
  expect(w.state.calls).toHaveLength(1)
  expect(w.tidy()?.failed?.reason).toBe('summary could not be prepared')
  expect(w.tidy()?.backoff).toEqual({ tokens: 400_000, requestAt: 1_000_000 })
  await w.measure($)
  await w.clock.advance(30_000)
  await w.clock.settle()
  expect(w.state.calls).toHaveLength(1)
  const newRequestAt = w.clock.now()
  w.set('usage', { contextTokens: 400_000, mainRequestAt: newRequestAt, rateLimits: [] })
  w.set('tidyGate', { ...w.gate(), stop: { ...w.gate().stop, requestAt: newRequestAt } })
  await w.measure($)
  expect(w.tidy()?.pending?.state).toBe('countdown')
  await w.clock.advance(30_000)
  await w.clock.settle()
  expect(w.state.calls).toHaveLength(2)
  expect(w.tidy()?.backoff?.requestAt).toBe(newRequestAt)
  await w.measure($, 450_000)
  expect(w.tidy()?.pending?.state).toBe('countdown')
  w.state.skip = undefined
  await w.clock.advance(30_000)
  await w.clock.settle()
  expect(w.state.calls).toHaveLength(3)
})

for (const interrupted of [false, true]) {
  test(`T15 final reads are all awaited; concurrent turn ${interrupted ? 'stops' : 'does not precede'} the final compact call`, AUTO, async ($, on) => {
    const w = schedulerWorld(on)
    await $.session.start(START)
    await w.clock.settle()
    w.seed()
    await w.measure($)
    await w.clock.advance(29_000)
    await w.clock.settle()
    w.state.configPollDelay = 2000
    await w.clock.advance(1000)
    await w.clock.settle()
    expect(w.state.calls).toHaveLength(0)
    if (interrupted) {
      w.state.configPollDelay = 0
      await $.turn.start({ turnId: 'new', text: 'work' })
    }
    await w.clock.advance(2000)
    await w.clock.settle()
    expect(w.state.calls).toHaveLength(interrupted ? 0 : 1)
    if (interrupted) expect(w.tidy()?.pending?.reasons).toContain('Claude is working')
  })
}

test('T13 a D2 Cancel also puts D1 on Not-now; a D3 Not-now survives growth in the same gap', AUTO, async ($, on) => {
  const w = schedulerWorld(on)
  await $.session.start(START)
  await w.clock.settle()
  w.seed()
  const at = w.clock.now() - 3_500_000
  w.set('usage', { contextTokens: 400_000, mainRequestAt: at, rateLimits: [] })
  w.set('tidyGate', { ...w.gate(), stop: { ...w.gate().stop, requestAt: at } })
  await w.measure($)
  expect(w.tidy()?.pending?.rule).toBe('D2')
  const band = await w.mount($)
  await band.press({ key: 'tidy:later' })
  await w.clock.settle()
  expect(w.tidy()?.dismissedAt).toBe(400_000)
  expect(w.tidy()?.coolingDismissedAt).toBe(at)
  expect(w.tidy()?.pending).toBeUndefined()
  await w.measure($)
  expect(w.tidy()?.pending).toBeUndefined()
  await w.clock.advance(30_000)
  await w.clock.settle()
  expect(w.state.calls).toHaveLength(0)
  const coldAt = w.clock.now() - 3_600_000
  w.set('tidy', {})
  w.set('usage', { contextTokens: 400_000, mainRequestAt: coldAt, rateLimits: [] })
  w.set('tidyGate', { ...w.gate(), stop: { ...w.gate().stop, requestAt: coldAt } })
  await w.measure($)
  expect(w.tidy()?.pending?.rule).toBe('D3')
  expect(w.tidy()?.pending?.automatic).toBe(false)
  await band.press({ key: 'tidy:later' })
  await w.clock.settle()
  await w.measure($, 450_000)
  expect(w.tidy()?.pending).toBeUndefined()
  w.set('usage', { contextTokens: 450_000, mainRequestAt: coldAt + 1, rateLimits: [] })
  await w.clock.advance(1)
  await w.measure($, 450_000)
  expect(w.tidy()?.pending?.rule).toBe('D3')
  expect(w.state.calls).toHaveLength(0)
  await band.unmount()
})

for (const benign of [true, false]) {
  test(`T14 engine rejection ${benign ? 'because a turn started is benign' : 'reports its reason and backs off'}`, async () => {
    for (const reason of benign ? [
      'mod-hud: $.session.compact: a turn is running (t1); the conversation compacts between turns, so call it from turn.complete or later',
      'mod-hud: $.session.compact: a turn is in flight; the conversation compacts between turns',
    ] : [
      'mod-hud: $.session.compact: compaction is switched off in this session (DISABLE_COMPACT), for /compact and plugins alike',
      'session gateway busy',
      'mod-hud: $.session.compact: a turn is in flight; the conversation compacts between turns',
      'mod-hud: $.session.compact: a newer turn began before the compaction could be applied',
      'mod-hud: $.session.compact: an external turn is driving the conversation; it compacts between turns',
    ]) {
      const d = direct()
      await register(d.on, { tidy: 'auto', mascots: false, showGit: false })
      const timers: (() => void)[] = []
      let calls = 0
      const put = (key: string, value: unknown) => d.held.set(key, { value, version: (d.held.get(key)?.version ?? 0) + 1 })
      put('session', { model: 'claude-opus-5-5', cacheTtl: '1h', isInteractive: true, compactDisabled: false })
      put('usage', { contextTokens: 400_000, mainRequestAt: d.world.now, rateLimits: [] })
      put('main', { lastTurnReason: 'answer', idleSince: d.world.now - 240_000 })
      put('tidyGate', { todos: [], tasks: [], precomputeSeen: false, teammate: false, requestsSinceCompaction: 140, mainRequests: 5, mainInput: 2_000_000, mainCacheRead: 2_000_000, stop: { at: d.world.now, requestAt: d.world.now, tasks: [], previousTaskIds: [], oneShotCrons: 0 } })
      const $ = {
        ...d.$,
        clock: { ...d.$.clock, every: (_ms: number, callback: () => void) => { timers.push(callback); return { cancel: () => {} } }, after: () => ({ cancel: () => {} }) },
        session: {
          usage: async () => ({ startedAt: 0, context: { tokens: 400_000, window: 1_000_000 }, rateLimits: [] }),
          surfaces: async () => ['terminal'],
          compact: () => {
            calls += 1
            if (benign) put('main', { busySince: d.world.now })
            throw new Error(reason)
          },
        },
        prompt: { read: async () => ({ text: '', cursor: 0 }) },
        tool: { list: async () => [{ name: 'TodoWrite', description: 'todos', mcp: false }] },
        config: { list: async () => [] },
        store: { get: async () => true },
      } as unknown as EngineInterface
      const measure = d.hooks.get('session.measure') as Hook<'session.measure'>
      const next = (async () => ({ changed: ['context'] })) as unknown as Next<'session.measure'>
      await measure($, { context: { tokens: 400_000, window: 1_000_000 }, rateLimits: [], changed: ['context'] }, next)
      d.world.now += 30_000
      const registrations = timers.length
      timers[0]?.()
      // Direct callbacks have no host clock to drain; their promises are all
      // in-memory reads/writes and settle in this bounded microtask drain.
      for (let step = 0; step < 200; step += 1) await Promise.resolve()
      const tidy = d.held.get('tidy')?.value as import('../types').HudTidyFacts
      expect(calls).toBe(1)
      expect(tidy.failed?.reason).toBe(benign ? 'Claude started working' : /compacts between turns|a newer turn began/i.exec(reason) !== null ? 'a turn was already running' : reason)
      if (benign) {
        expect(tidy.backoff).toBeUndefined()
        expect(tidy.pending?.reasons).toContain('Claude is working')
        put('main', { lastTurnReason: 'answer', idleSince: d.world.now - 240_000 })
        await measure($, { context: { tokens: 400_000, window: 1_000_000 }, rateLimits: [], changed: ['context'] }, next)
        const restarted = d.held.get('tidy')?.value as import('../types').HudTidyFacts
        expect(restarted.pending?.state).toBe('countdown')
        expect(restarted.failed).toBeUndefined()
        expect(calls).toBe(1)
      } else {
        expect(tidy.backoff).toEqual({ tokens: 400_000, requestAt: 1_000_000 })
        expect(tidy.pending).toBeUndefined()
        expect(timers.length).toBe(registrations)
        for (const callback of timers) callback()
        for (let step = 0; step < 200; step += 1) await Promise.resolve()
        expect(calls).toBe(1)
      }
    }
  })
}

const tidyRow = (key = 'mod-hud.tidy', plugin = 'mod-hud', isLocked = false): ConfigRow => ({ key, label: 'Tidy up', kind: 'choice', value: 'auto', options: ['auto', 'ask', 'off'], provider: { plugin, tier: 'user' }, isLocked })
const completeMain = ($: Engine, reason = 'answer') => $.turn.complete({ turnId: 'work', reason, answer: '', isAborted: reason === 'aborted', durationMs: 1 } as never)

for (const key of ['mod-hud.tidy', 'mod-hud@inline.tidy', 'mod-hud@clawd-hud-zq.tidy']) {
  for (const control of ['button', 'off', 'on'] as const) {
    test(`T4 ${control} saves the permanent mode through ${key}, countdown cleared before the single write`, control === 'on' ? ASK : AUTO, async ($, on) => {
      const w = schedulerWorld(on)
      await $.session.start(START)
      await w.clock.settle()
      w.seed()
      // Alternate key forms can be returned under a provider's qualified name.
      // Follow-up 12 row 19: other plugins' tidy rows must not match.
      w.state.configRows = [tidyRow(key, key === 'mod-hud.tidy' ? 'mod-hud' : 'mod-hud@qualified'), { ...tidyRow('mod-hud.mascots'), kind: 'boolean', value: true }, tidyRow('other-plugin.tidy', 'other-plugin'), tidyRow('mod-hud-extra.tidy', 'mod-hud-extra')]
      await w.measure($)
      const band = await w.mount($)
      if (control === 'on') w.set('tidy', { ...w.tidy(), countdownSince: w.clock.now(), pending: { ...w.tidy()!.pending!, state: 'countdown', countdownSince: w.clock.now(), endsAt: w.clock.now() + 30_000 } })
      expect(w.tidy()?.countdownSince).toBe(w.clock.now())
      if (control === 'button') {
        expect((await band.find({ type: 'Button', key: 'tidy:auto' }))?.props.label).toBe('Turn auto off')
        await band.press({ key: 'tidy:auto' })
      } else {
        const answer = await $.command.run({ ...TOGGLE, args: `tidy ${control}` })
        expect(answer.text).toBe(control === 'on' ? 'auto-tidy is on' : 'auto-tidy is off (ask mode)')
      }
      await w.clock.settle()
      expect(w.configWrites).toHaveLength(1)
      expect(w.configWrites[0]).toMatchObject({ key, value: control === 'on' ? 'auto' : 'ask', countdown: undefined, pending: undefined })
      expect(w.tidy()?.countdownSince).toBeUndefined()
      if (control === 'on') {
        expect(w.configWrites[0]?.chosen).toBe(true)
        expect(w.state.trace.slice(-2)).toEqual(['store:autoTidyChosen', 'config.set'])
      }
      await w.clock.advance(30_000)
      await w.clock.settle()
      expect(w.state.calls).toHaveLength(0)
      expect(w.configWrites).toHaveLength(1)
      await band.unmount()
    })
  }
}

for (const problem of ['missing', 'ambiguous', 'locked', 'deny', 'rejection', 'unreadable'] as const) {
  test(`T4 ${problem}: the toggle reports the config reason on row 2 without a session-only fallback`, AUTO, async ($, on) => {
    const w = schedulerWorld(on)
    await $.session.start(START)
    await w.clock.settle()
    w.seed()
    w.state.configRows = problem === 'missing' ? [] : problem === 'ambiguous' ? [tidyRow(), tidyRow('mod-hud@inline.tidy')] : [tidyRow('mod-hud.tidy', 'mod-hud', problem === 'locked')]
    if (problem === 'deny') w.state.configDeny = 'the toggle was refused'
    if (problem === 'rejection') w.state.configReject = 'settings write failed'
    await w.measure($)
    expect(w.tidy()?.pending?.state).toBe('countdown')
    if (problem === 'unreadable') w.state.configFails = true
    const delayed = problem === 'deny' || problem === 'rejection'
    if (delayed) w.state.configSetDelay = 40_000
    const command = $.command.run({ ...TOGGLE, args: 'tidy off' })
    if (delayed) {
      await w.clock.settle()
      expect(w.configWrites).toHaveLength(1)
      await w.measure($)
      expect(w.tidy()?.pending?.state).toBe('countdown')
      await w.clock.advance(31_000)
      await w.clock.settle()
      expect(w.state.calls).toHaveLength(0)
      await w.clock.advance(9000)
      await w.clock.settle()
    }
    const answer = await command
    // Follow-up 12 row 20: throwing harness hooks fall through to the engine's
    // missing-implementation message, not the injected rejection/read message.
    const expected = problem === 'missing' || problem === 'ambiguous' ? 'could not find the tidy option' : problem === 'locked' ? 'locked by your organization' : problem === 'deny' ? 'the toggle was refused' : `no implementation for config.${problem === 'unreadable' ? 'list' : 'set'}`
    expect(answer.text).toContain(expected)
    expect(w.tidy()?.toggle?.reason).toContain(expected)
    const band = await w.mount($)
    // Follow-up 12 row 1: failed off is Cancel, with standalone feedback.
    expect((await band.find({ type: 'Box', key: 'tidy:0' }))?.text).toContain('auto-tidy')
    expect((await band.find({ type: 'Box', key: 'tidy:1' }))?.text).toContain(expected)
    expect(await band.findAll({ type: 'Button' })).toHaveLength(0)
    expect(w.tidy()?.pending).toBeUndefined()
    expect(w.tidy()?.countdownSince).toBeUndefined()
    expect(w.tidy()?.dismissedAt).toBe(400_000)
    expect(w.tidy()?.coolingDismissedAt).toBe(1_000_000)
    expect(w.gate().pendingToggle).toBeUndefined()
    const writes = problem === 'deny' || problem === 'rejection' ? 1 : 0
    expect(w.configWrites).toHaveLength(writes)
    await w.clock.advance(30_000)
    await w.measure($)
    await w.clock.settle()
    expect(w.state.calls).toHaveLength(0)
    expect(w.tidy()?.pending).toBeUndefined()
    expect(w.configWrites).toHaveLength(writes)
    await band.unmount()
  })
}

for (const finish of ['answer', 'aborted', 'Stop', 'reload', 'queued', 'compaction'] as const) {
  test(`T4 pending toggle at ${finish} defers, survives reload, re-checks blockers and applies exactly once`, AUTO, async ($, on) => {
    const w = schedulerWorld(on)
    await $.session.start(START)
    await w.clock.settle()
    w.seed()
    w.state.configRows = [tidyRow()]
    await w.measure($)
    if (finish === 'compaction') {
      w.state.compactDelay = 2000
      await w.clock.advance(30_000)
      await w.clock.settle()
      expect(w.tidy()?.runningSince).toBeDefined()
    } else await $.turn.start({ turnId: 'work', text: 'work' })
    const answer = await $.command.run({ ...TOGGLE, args: 'tidy off' })
    expect(answer.text).toBe('auto off when this turn ends')
    expect(w.gate().pendingToggle).toBe('ask')
    expect(w.configWrites).toHaveLength(0)
    expect(w.tidy()?.countdownSince).toBeUndefined()
    if (finish === 'reload') {
      await $.session.start(START)
      await w.clock.settle()
      expect(w.gate().pendingToggle).toBe('ask')
      expect(w.configWrites).toHaveLength(0)
      // Follow-up 12 row 11: an idle reload applies before evaluation.
      w.set('main', { idleSince: w.clock.now(), lastTurnReason: 'answer' })
      await $.session.start(START)
    }
    if (finish === 'queued') {
      await $.prompt.submit({ text: 'queued work', turnId: 'work', wait: true, origin: { kind: 'composer' } })
      await completeMain($)
      // Follow-up 12 row 11: pending ask never starts a countdown.
      expect(w.tidy()?.countdownSince).toBeUndefined()
      expect(w.tidy()?.pending?.state).not.toBe('countdown')
      expect(w.tidy()?.pending?.state).toBe('offer')
      await w.clock.advance(0)
      await w.clock.settle()
      expect(w.tidy()?.pending?.state).toBe('offer')
      expect(w.gate().pendingToggle).toBe('ask')
      expect(w.configWrites).toHaveLength(0)
      await $.turn.start({ turnId: 'work', text: 'queued work' })
    }
    if (finish === 'compaction') {
      await w.clock.advance(2000)
      await w.clock.settle()
    } else if (finish === 'Stop') {
      // A Stop while still busy must leave the persisted request in place.
      await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
      await w.clock.advance(0)
      await w.clock.settle()
      expect(w.configWrites).toHaveLength(0)
      w.set('main', { idleSince: w.clock.now(), lastTurnReason: 'answer' })
      await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    } else if (finish !== 'reload') await completeMain($, finish === 'aborted' ? 'aborted' : 'answer')
    // Follow-up 12 row 11: check before the deferred write can run.
    expect(w.tidy()?.countdownSince).toBeUndefined()
    expect(w.tidy()?.pending?.state).not.toBe('countdown')
    await w.clock.advance(0)
    await w.clock.settle()
    expect(w.configWrites).toHaveLength(1)
    expect(w.configWrites[0]).toMatchObject({ key: 'mod-hud.tidy', value: 'ask', pending: undefined, countdown: undefined })
    expect(w.gate().pendingToggle).toBeUndefined()
    // Stop and complete can both fire; the cleared request cannot apply twice.
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    await w.clock.advance(0)
    await w.clock.settle()
    expect(w.configWrites).toHaveLength(1)
  })
}

test('T4 a deferred toggle is dropped when /config changed the tidy row before the turn end', AUTO, async ($, on) => {
  const w = schedulerWorld(on)
  await $.session.start(START)
  await w.clock.settle()
  w.seed()
  w.state.configRows = [tidyRow()]
  await $.turn.start({ turnId: 'work', text: 'work' })
  expect((await $.command.run({ ...TOGGLE, args: 'tidy off' })).text).toBe('auto off when this turn ends')
  expect(w.gate().pendingToggle).toBe('ask')
  expect(w.gate().pendingToggleFrom).toBe('auto')
  const dismissedAt = w.tidy()?.dismissedAt
  const coolingDismissedAt = w.tidy()?.coolingDismissedAt
  w.state.configRows = [{ ...tidyRow(), value: 'off' }]
  await completeMain($)
  await w.clock.advance(0)
  await w.clock.settle()
  expect(w.configWrites).toHaveLength(0)
  expect(w.storeWrites).toHaveLength(0)
  expect(w.gate().pendingToggle).toBeUndefined()
  expect(w.gate().pendingToggleFrom).toBeUndefined()
  expect(w.tidy()?.toggle?.reason).toBe('kept your /config change')
  expect(w.tidy()?.dismissedAt).toBe(dismissedAt)
  expect(w.tidy()?.coolingDismissedAt).toBe(coolingDismissedAt)
  // Old records without a row baseline still apply against the live value.
  await $.turn.start({ turnId: 'work', text: 'work' })
  w.set('tidyGate', { ...w.gate(), pendingToggle: 'ask' })
  await completeMain($)
  await w.clock.advance(0)
  await w.clock.settle()
  expect(w.configWrites).toHaveLength(1)
  expect(w.configWrites[0]?.value).toBe('ask')
  expect(w.gate().pendingToggle).toBeUndefined()
  expect(w.gate().pendingToggleFrom).toBeUndefined()
})

for (const control of ['Cancel', 'command'] as const) {
  test(`T4 ${control} cancels only the current tidy and never writes config`, AUTO, async ($, on) => {
    const w = schedulerWorld(on)
    await $.session.start(START)
    await w.clock.settle()
    w.seed()
    w.state.configRows = [tidyRow()]
    await w.measure($)
    const band = await w.mount($)
    if (control === 'Cancel') await band.press({ key: 'tidy:later' })
    else expect((await $.command.run({ ...TOGGLE, args: 'tidy cancel' })).text).toBe('tidy cancelled')
    await w.clock.settle()
    expect(w.tidy()?.dismissedAt).toBe(400_000)
    expect(w.tidy()?.countdownSince).toBeUndefined()
    expect(w.configWrites).toHaveLength(0)
    await w.clock.advance(30_000)
    await w.clock.settle()
    expect(w.state.calls).toHaveLength(0)
    expect(w.configWrites).toHaveLength(0)
    expect((await $.command.run({ ...TOGGLE, args: 'tidy cancel' })).text).toBe('nothing to cancel')
    // Follow-up 12 row 8: Cancel at the final config read invalidates its poll
    // before the intro clear can yield. The callback fires only once.
    await w.measure($, 450_000)
    expect(w.tidy()?.pending?.state).toBe('countdown')
    await band.redraw()
    await w.clock.advance(29_000)
    await w.clock.settle()
    w.state.configPollDelay = 2000
    let cancelled: Promise<unknown> | undefined
    w.state.configRead = async () => {
      w.state.configPollDelay = 0
      cancelled = control === 'Cancel'
        ? band.press({ key: 'tidy:later' })
        : $.command.run({ ...TOGGLE, args: 'tidy cancel' }).then(answer => { expect(answer.text).toBe('tidy cancelled') })
    }
    await w.clock.advance(1000)
    await w.clock.settle()
    expect(w.state.calls).toHaveLength(0)
    await w.clock.advance(2000)
    await w.clock.settle()
    expect(cancelled).toBeDefined()
    await cancelled
    expect(w.state.calls).toHaveLength(0)
    expect(w.tidy()?.dismissedAt).toBe(450_000)
    expect(w.configWrites).toHaveLength(0)
    w.state.configPollDelay = 0
    await band.unmount()
  })
}

test('T4 ask offer carries Turn auto on; plain status and unknown arguments do not change the option', ASK, async ($, on) => {
  const w = schedulerWorld(on)
  await $.session.start(START)
  await w.clock.settle()
  w.seed()
  w.state.configRows = [tidyRow()]
  await w.measure($)
  const band = await w.mount($)
  expect((await band.find({ type: 'Button', key: 'tidy:auto' }))?.props.label).toBe('Turn auto on')
  const pane = await mountPane($, 'terminal', 120, 60)
  const hud = await pane.find({ key: 'hud:context.tidy' })
  expect(hud?.text).toContain('ask · save ≈$')
  expect((await pane.find({ type: 'Button', key: 'hud:tidy:auto' }))?.props.label).toBe('Turn auto on')
  await pane.unmount()
  const status = await $.command.run({ ...TOGGLE, args: 'tidy' })
  expect(status.text).toContain('ask · offer')
  expect(status.text).toContain('save ≈$')
  expect((await $.command.run({ ...TOGGLE, args: 'tidy unknown' })).text).toBe('Usage: /mod-hud tidy [on|off|now|cancel]')
  expect(w.world.registered.at(-1)?.argumentHint).toContain('tidy [on|off|now|cancel]')
  expect(w.configWrites).toHaveLength(0)
  // Follow-up 12 row 2: failed on keeps the offer and applies no suppression.
  w.state.configDeny = 'the toggle was refused'
  await band.press({ key: 'tidy:auto' })
  await w.clock.settle()
  await band.redraw()
  expect(w.tidy()?.pending?.state).toBe('offer')
  expect((await band.find({ type: 'Box', key: 'tidy:1' }))?.text).toContain('the toggle was refused')
  expect(w.tidy()?.dismissedAt).toBeUndefined()
  expect(w.gate().pendingToggle).toBeUndefined()
  expect(w.configWrites).toHaveLength(1)
  w.state.configDeny = undefined
  w.state.storeFails = true
  await band.press({ key: 'tidy:auto' })
  await w.clock.settle()
  expect(w.configWrites).toHaveLength(2)
  expect(w.configWrites[1]?.value).toBe('auto')
  expect(w.state.trace.slice(-2)).toEqual(['store:autoTidyChosen', 'config.set'])
  expect(w.tidy()?.toggle).toBeUndefined()
  await band.unmount()
})

for (const end of ['turn', 'growth', 'Not now', 'Tidy up', 'toggle'] as const) {
  test(`T8 first due is an intro offer through reload and measurement; ${end} ends the episode`, AUTO, async ($, on) => {
    const w = schedulerWorld(on, true)
    await $.session.start(START)
    await w.clock.settle()
    w.seed()
    w.state.configRows = [tidyRow()]
    await w.measure($)
    expect(w.tidy()?.pending).toMatchObject({ state: 'offer', intro: true, automatic: false })
    expect(w.gate().introSince).toBe(w.clock.now())
    expect(w.gate().introTokens).toBe(400_000)
    expect(w.store.get('autoTidyIntroShown')).toBe(true)
    expect(w.storeWrites).toEqual(['autoTidyIntroShown'])
    expect(w.state.calls).toHaveLength(0)
    const band = await w.mount($)
    expect((await band.find({ type: 'Box', key: 'tidy:0' }))?.text).toContain('auto-tidy is now on')
    expect((await band.findAll({ type: 'Button' })).map(button => button.props.label)).toEqual(['Tidy up', 'Not now', 'Turn auto off'])
    await $.session.start(START)
    await w.measure($)
    await w.clock.advance(30_000)
    await w.clock.settle()
    expect(w.tidy()?.pending?.intro).toBe(true)
    expect(w.tidy()?.countdownSince).toBeUndefined()
    expect(w.state.calls).toHaveLength(0)
    expect(w.storeWrites).toEqual(['autoTidyIntroShown'])
    await band.redraw()
    if (end === 'turn') await completeMain($)
    if (end === 'growth') await w.measure($, 450_000)
    if (end === 'Not now') {
      await band.press({ key: 'tidy:later' })
      await w.clock.settle()
      expect(w.gate().introSince).toBeUndefined()
      expect(w.tidy()?.pending).toBeUndefined()
      await w.measure($, 450_000)
    }
    if (end === 'Tidy up') {
      await band.press({ key: 'tidy:now' })
      await w.clock.settle()
      expect(w.state.calls).toHaveLength(1)
      await w.clock.advance(20_000)
      w.seed()
      w.set('tidy', {})
      await w.measure($)
    }
    if (end === 'toggle') {
      await band.press({ key: 'tidy:auto' })
      await w.clock.settle()
      expect(w.configWrites).toHaveLength(1)
      // The engine reloads to ask on success; this harness does not reload options.
      await w.measure($)
    }
    await w.clock.settle()
    expect(w.gate().introSince).toBeUndefined()
    expect(w.gate().introTokens).toBeUndefined()
    expect(w.tidy()?.pending?.intro).toBeUndefined()
    expect(w.tidy()?.pending?.state).toBe('countdown')
    expect(w.storeWrites).toEqual(['autoTidyIntroShown'])
    await band.unmount()
  })
}

test('T8 autoTidyChosen suppresses the intro; while busy no intro flag is written', AUTO, async ($, on) => {
  const w = schedulerWorld(on, true)
  await $.session.start(START)
  await w.clock.settle()
  w.seed()
  await $.turn.start({ turnId: 'work', text: 'work' })
  await w.measure($)
  // Follow-up 12 row 12: before the intro, busy shows nothing.
  expect(w.tidy()?.pending).toBeUndefined()
  expect(w.storeWrites).toHaveLength(0)
  // A fresh registration reads the permanent choice without a config row;
  // session.start alone does not reload the host's module.
  const d = direct()
  await register(d.on, AUTO.options)
  const store = new Map<string, unknown>([['autoTidyChosen', true]])
  const storeWrites: string[] = []
  let calls = 0
  const put = (key: string, value: unknown) => d.held.set(key, { value, version: (d.held.get(key)?.version ?? 0) + 1 })
  put('session', { model: 'claude-opus-5-5', cacheTtl: '1h', isInteractive: true, compactDisabled: false })
  put('usage', { contextTokens: 400_000, mainRequestAt: d.world.now, rateLimits: [] })
  put('main', { lastTurnReason: 'answer', idleSince: d.world.now - 240_000 })
  put('tidyGate', { todos: [], tasks: [], precomputeSeen: false, teammate: false, requestsSinceCompaction: 140, mainRequests: 5, mainInput: 2_000_000, mainCacheRead: 2_000_000, stop: { at: d.world.now, requestAt: d.world.now, tasks: [], previousTaskIds: [], oneShotCrons: 0 } })
  const chosen = {
    ...d.$,
    clock: { ...d.$.clock, after: () => ({ cancel: () => {} }) },
    session: {
      usage: async () => ({ startedAt: 0, context: { tokens: 400_000, window: 1_000_000 }, rateLimits: [] }),
      surfaces: async () => ['terminal'],
      compact: async () => { calls += 1; return { messages: [], tokensBefore: 400_000, tokensAfter: 80_000 } },
    },
    prompt: { read: async () => ({ text: '', cursor: 0 }) },
    tool: { list: async () => [{ name: 'TodoWrite', description: 'todos', mcp: false }] },
    config: { list: async () => [] },
    store: {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: unknown) => { storeWrites.push(key); store.set(key, value) },
    },
  } as unknown as EngineInterface
  const measure = d.hooks.get('session.measure') as Hook<'session.measure'>
  const next = (async () => ({ changed: ['context'] })) as unknown as Next<'session.measure'>
  await measure(chosen, { context: { tokens: 400_000, window: 1_000_000 }, rateLimits: [], changed: ['context'] }, next)
  for (let step = 0; step < 200; step += 1) await Promise.resolve()
  const tidy = d.held.get('tidy')?.value as import('../types').HudTidyFacts
  expect(tidy.pending?.state).toBe('countdown')
  expect(tidy.pending?.intro).toBeUndefined()
  expect(storeWrites).toHaveLength(0)
  expect(calls).toBe(0)
  expect(w.storeWrites).toHaveLength(0)
  // A turn arriving while the offer is written must not consume the intro.
  await register(d.on, AUTO.options)
  store.delete('autoTidyChosen')
  put('tidy', {})
  let interrupt = true
  const interrupted = {
    ...chosen,
    state: {
      ...chosen.state,
      set: async (ref: { plugin: 'mod-hud'; key: string }, value: unknown, options?: { ifVersion?: number }) => {
        if (interrupt && ref.key === 'tidy' && (value as import('../types').HudTidyFacts)?.pending?.intro === true) {
          interrupt = false
          const start = d.hooks.get('turn.start') as Hook<'turn.start'>
          await start(interrupted, { turnId: 'interrupt', text: 'work' }, (async () => ({ turnId: 'interrupt' })) as unknown as Next<'turn.start'>)
        }
        return chosen.state.set(ref as never, value as never, options)
      },
    },
  } as unknown as EngineInterface
  const freshMeasure = d.hooks.get('session.measure') as Hook<'session.measure'>
  await freshMeasure(interrupted, { context: { tokens: 400_000, window: 1_000_000 }, rateLimits: [], changed: ['context'] }, next)
  for (let step = 0; step < 200; step += 1) await Promise.resolve()
  expect((d.held.get('tidyGate')?.value as HudTidyGate).introSince).toBeUndefined()
  expect((d.held.get('tidyGate')?.value as HudTidyGate).introTokens).toBeUndefined()
  expect(storeWrites).toHaveLength(0)
  put('main', { lastTurnReason: 'answer', idleSince: d.world.now - 240_000 })
  await freshMeasure(interrupted, { context: { tokens: 400_000, window: 1_000_000 }, rateLimits: [], changed: ['context'] }, next)
  expect((d.held.get('tidy')?.value as import('../types').HudTidyFacts).pending?.intro).toBe(true)
  expect((d.held.get('tidyGate')?.value as HudTidyGate).introSince).toBe(d.world.now)
  expect(storeWrites).toEqual(['autoTidyIntroShown'])
  await freshMeasure(interrupted, { context: { tokens: 400_000, window: 1_000_000 }, rateLimits: [], changed: ['context'] }, next)
  expect(storeWrites).toEqual(['autoTidyIntroShown'])
  // Follow-up 12 row 7: a losing intro-fields write stays, without a flag.
  await register(d.on, AUTO.options)
  store.delete('autoTidyIntroShown')
  storeWrites.length = 0
  put('tidy', {})
  put('tidyGate', { ...(d.held.get('tidyGate')?.value as HudTidyGate), introSince: undefined, introTokens: undefined })
  let interruptFields = true
  const fieldsInterrupted = {
    ...chosen,
    state: {
      ...chosen.state,
      set: async (ref: { plugin: 'mod-hud'; key: string }, value: unknown, options?: { ifVersion?: number }) => {
        if (interruptFields && ref.key === 'tidyGate' && (value as HudTidyGate).introSince !== undefined) {
          interruptFields = false
          const start = d.hooks.get('turn.start') as Hook<'turn.start'>
          await start(fieldsInterrupted, { turnId: 'fields-interrupt', text: 'work' }, (async () => ({ turnId: 'fields-interrupt' })) as unknown as Next<'turn.start'>)
        }
        return chosen.state.set(ref as never, value as never, options)
      },
    },
  } as unknown as EngineInterface
  const fieldsMeasure = d.hooks.get('session.measure') as Hook<'session.measure'>
  await fieldsMeasure(fieldsInterrupted, { context: { tokens: 400_000, window: 1_000_000 }, rateLimits: [], changed: ['context'] }, next)
  for (let step = 0; step < 200; step += 1) await Promise.resolve()
  expect((d.held.get('tidyGate')?.value as HudTidyGate).introSince).toBe(d.world.now)
  expect((d.held.get('tidyGate')?.value as HudTidyGate).introTokens).toBe(400_000)
  expect(storeWrites).toHaveLength(0)
  put('usage', { contextTokens: 0, mainRequestAt: d.world.now, rateLimits: [] })
  // This direct fixture's live usage is fixed at 400k. Withhold D1's request
  // count at the turn end so it clears the episode without opening a new one.
  put('tidyGate', { ...(d.held.get('tidyGate')?.value as HudTidyGate), requestsSinceCompaction: 0 })
  const complete = d.hooks.get('turn.complete') as Hook<'turn.complete'>
  await complete(fieldsInterrupted, { turnId: 'fields-interrupt', reason: 'answer', answer: '', isAborted: false, durationMs: 1 }, (async () => ({})) as unknown as Next<'turn.complete'>)
  expect((d.held.get('tidyGate')?.value as HudTidyGate).introSince).toBeUndefined()
  expect((d.held.get('tidyGate')?.value as HudTidyGate).introTokens).toBeUndefined()
  put('usage', { contextTokens: 400_000, mainRequestAt: d.world.now, rateLimits: [] })
  put('tidyGate', { ...(d.held.get('tidyGate')?.value as HudTidyGate), requestsSinceCompaction: 140 })
  await fieldsMeasure(fieldsInterrupted, { context: { tokens: 400_000, window: 1_000_000 }, rateLimits: [], changed: ['context'] }, next)
  expect((d.held.get('tidy')?.value as import('../types').HudTidyFacts).pending?.intro).toBe(true)
  expect(storeWrites).toEqual(['autoTidyIntroShown'])
})

for (const unavailable of ['cold', 'unpriced', 'autoCompact off'] as const) {
  test(`T8 ${unavailable}: a nonautomatic due moment is a plain offer and keeps the intro`, AUTO, async ($, on) => {
    const w = schedulerWorld(on, true)
    await $.session.start(START)
    await w.clock.settle()
    w.seed()
    if (unavailable === 'cold') w.set('usage', { contextTokens: 400_000, mainRequestAt: w.clock.now() - 3_600_000, rateLimits: [] })
    if (unavailable === 'unpriced') w.set('session', { ...(w.held.get('session')!.value as object), model: 'unpriced' })
    if (unavailable === 'autoCompact off') w.state.autoCompact = false
    await w.measure($)
    // Follow-up 12 row 10: nonautomatic due moments do not consume the intro.
    expect(w.tidy()?.pending).toMatchObject({ state: 'offer', automatic: false })
    expect(w.tidy()?.pending?.intro).toBeUndefined()
    expect(w.gate().introSince).toBeUndefined()
    expect(w.gate().introTokens).toBeUndefined()
    expect(w.storeWrites).toHaveLength(0)
    expect(w.state.calls).toHaveLength(0)
    w.seed()
    w.state.autoCompact = true
    await w.measure($)
    expect(w.tidy()?.pending).toMatchObject({ state: 'offer', automatic: false, intro: true })
    expect(w.storeWrites).toEqual(['autoTidyIntroShown'])
    await w.measure($)
    expect(w.storeWrites).toEqual(['autoTidyIntroShown'])
    expect(w.state.calls).toHaveLength(0)
  })
}

for (const control of ['press', 'command'] as const) {
  test(`T10 ${control} during an automatic compaction reports running, preserves the start and never compacts twice`, AUTO, async ($, on) => {
    const w = schedulerWorld(on)
    await $.session.start(START)
    await w.clock.settle()
    w.seed()
    w.state.compactDelay = 2000
    await w.measure($)
    const band = await w.mount($)
    await w.clock.advance(30_000)
    await w.clock.settle()
    const runningSince = w.tidy()?.runningSince
    expect(runningSince).toBe(w.clock.now())
    expect(w.state.calls).toHaveLength(1)
    if (control === 'press') await band.press({ key: 'tidy:now' })
    else expect((await $.command.run({ ...TOGGLE, args: 'tidy now' })).text).toBe('a compaction is running')
    await w.clock.settle()
    expect(w.tidy()?.failed?.reason).toBe('a compaction is running')
    expect(w.tidy()?.runningSince).toBe(runningSince)
    expect(w.state.calls).toHaveLength(1)
    await w.clock.advance(2000)
    await w.clock.settle()
    expect(w.state.calls).toHaveLength(1)
    await band.unmount()
  })
}
