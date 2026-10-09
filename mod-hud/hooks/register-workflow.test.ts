import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { HudData, ShadowAgentEntry } from '../types'
import { MAX_SHADOWS, shadowCallStarted, shadowStepped, shadowsPruned } from './agent-shadows'
import {
  NOW,
  SESSION_ROW,
  SHADOWS,
  START,
  STATUS_ON,
  SURFACES,
  TOGGLE,
  agentBoxes,
  callTool,
  complete,
  entriesOf,
  entryOf,
  lastStatus,
  mountPane,
  paneOf,
  spawn,
  stepAs,
  tickOf,
  workflowWorld,
} from './register.fixtures'
import type { Drawing, Held } from './register.fixtures'

// Workflow agents in the hooks: shown after their first call, their tools
// and ends, the Workflow group, expiry and the cap, facts, and the option off.

// Names read `wf-` and the id's last four characters.
const WF_A = 'a8f3c2d19e7b4c21'
const WF_B = 'b19e0f7a3c5d9e02'
const WF_C = 'c7d2e4f6a8b0c1d3'
const IDLE_MS = 10 * 60_000
const LINGER_MS = 30_000

type ShadowRecord = Record<string, ShadowAgentEntry>

const shadowsOf = (held: Held): ShadowRecord => (held.get(SHADOWS)?.value ?? {}) as ShadowRecord

const workflowRows = async (ui: Drawing) =>
  (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('workflow:') === true)

test('a workflow agent shows after its first tool call, never after one step, and never writes the board', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock, held, shadowWrites, agentWrites } = workflowWorld(on)
  await $.session.start(START)
  const board = agentWrites()

  // One write for a request whatever its stream yields; the chunks pass untouched.
  expect(await stepAs($, WF_A)).toBe(3)
  expect(shadowWrites()).toBe(1)
  expect(shadowsOf(held)[WF_A]).toEqual({
    id: WF_A, model: 'claude-sonnet-5-5', effort: 'high', firstSeen: NOW, lastSeen: NOW, steps: 1, toolCalls: 0, status: 'running',
  })
  const ui = await mountPane($)
  expect((await paneOf(ui)).board).toEqual([SESSION_ROW, '▾ Agents', 'No agents yet.'])
  expect(await workflowRows(ui)).toHaveLength(0)

  // Its first call shows it: one write as it starts, one as it ends.
  await clock.advance(2000)
  await callTool($, WF_A, 'Read')
  expect(shadowWrites()).toBe(3)
  expect(shadowsOf(held)[WF_A]).toEqual({
    id: WF_A, model: 'claude-sonnet-5-5', effort: 'high', firstSeen: NOW, visibleAt: NOW + 2000, lastSeen: NOW + 2000,
    steps: 1, toolCalls: 1, lastTool: 'Read', readingSince: NOW + 2000, status: 'running',
  })
  expect((await paneOf(ui)).board).toEqual([
    SESSION_ROW,
    '▾ Agents · 0 running · 0 done · workflow 1 running',
    '▾ Workflow · 1 running · 0 done',
    '▸● wf-4c21          sonnet-5-5      2s 1 call     thinking · last Read',
  ])
  expect(await workflowRows(ui)).toHaveLength(1)
  expect(await agentBoxes(ui)).toHaveLength(0)
  await ui.unmount()

  // `mod-hud.agents`, which other mods read, was never written for it.
  expect(agentWrites()).toBe(board)
  expect(entriesOf(held)).toEqual({})
})

test('a workflow agent\'s current tool reads while its call runs; a second step alone also shows one', async ($, on) => {
  const { clock, world, held } = workflowWorld(on)
  world.tool = async () => {
    await clock.sleep(500)

    return { result: 'ok' }
  }
  await $.session.start(START)
  const call = callTool($, WF_A, 'mcp__notion__search')
  await clock.settle()
  expect(shadowsOf(held)[WF_A]).toMatchObject({ currentTool: 'notion:search', lastTool: 'notion:search', toolCalls: 1, steps: 0 })
  const ui = await mountPane($, 'terminal', 100)
  expect((await paneOf(ui)).board.at(-1)).toMatch(/^▸● wf-4c21 +- +0s 1 call +notion:search$/)
  await clock.advance(500)
  await call
  expect(shadowsOf(held)[WF_A]?.currentTool).toBe(undefined)

  // Two requests and no call: shown too, a fork's single step is not.
  await stepAs($, WF_B)
  expect(await workflowRows(ui)).toHaveLength(0 + 1)
  await stepAs($, WF_B, { index: 1, model: 'claude-haiku-4-5', effort: undefined })
  expect(shadowsOf(held)[WF_B]).toMatchObject({ steps: 2, toolCalls: 0, model: 'claude-haiku-4-5' })
  expect(shadowsOf(held)[WF_B]?.effort).toBe(undefined)
  await ui.redraw()
  expect(await workflowRows(ui)).toHaveLength(2)
  expect((await paneOf(ui)).board).toContain('▾ Workflow · 2 running · 0 done')
  await ui.unmount()
})

test('turn.complete marks a workflow agent done; a refusal or an error marks it failed; a fork leaves nothing', async ($, on) => {
  const { clock, held, shadowWrites } = workflowWorld(on)
  await $.session.start(START)
  for (const id of [WF_A, WF_B, WF_C]) await callTool($, id, 'Bash')
  await clock.advance(3000)
  await complete($, WF_A)
  await complete($, WF_B, { reason: 'refusal', refusal: { category: null, explanation: null } })
  await complete($, WF_C, { reason: 'error' })
  expect(shadowsOf(held)[WF_A]).toMatchObject({ status: 'done', reason: 'answer', endedAt: clock.now(), lastTool: 'Bash' })
  expect(shadowsOf(held)[WF_B]).toMatchObject({ status: 'failed', reason: 'refusal', endedAt: clock.now() })
  expect(shadowsOf(held)[WF_C]).toMatchObject({ status: 'failed', reason: 'error', endedAt: clock.now() })

  const ui = await mountPane($)
  const board = (await paneOf(ui)).board
  expect(board.slice(0, 3)).toEqual([SESSION_ROW, '▾ Agents · 0 running · 0 done · workflow 0 running, 1 done, 2 failed', '▾ Workflow · 0 running · 1 done · 2 failed'])
  expect(board.some(row => /^▸✓ wf-4c21 .* 3s 1 call +answer · last Bash$/.test(row))).toBe(true)
  expect(board.some(row => /^▸✗ wf-9e02 .* refusal · last Bash$/.test(row))).toBe(true)
  expect(board.some(row => /^▸✗ wf-c1d3 .* error · last Bash$/.test(row))).toBe(true)
  await ui.unmount()

  // A loop's single step, then its end: a fork, dropped, never shown.
  await stepAs($, 'fork-0001')
  expect(shadowsOf(held)['fork-0001']?.steps).toBe(1)
  await complete($, 'fork-0001')
  expect(shadowsOf(held)['fork-0001']).toBe(undefined)
  // An end for a loop never seen writes nothing.
  const writes = shadowWrites()
  await complete($, 'never-seen')
  expect(shadowWrites()).toBe(writes)
})

test('the pane draws the Workflow group under the subagents with its counts, at 100 and 48 columns', STATUS_ON, async ($, on) => {
  const { clock, world, held } = workflowWorld(on)
  await $.session.start(START)
  await spawn($)
  await callTool($, WF_A, 'Read')
  expect(lastStatus(world)).toBe('agents · 1 running · 0 done · workflow 1 running')
  await stepAs($, WF_B)
  await stepAs($, WF_B, { index: 1 })
  await callTool($, WF_C, 'Edit')
  await clock.advance(4000)
  await complete($, WF_B)
  await clock.advance(1000)
  await complete($, WF_C, { reason: 'error' })
  expect(lastStatus(world)).toBe('agents · 1 running · 0 done · workflow 1 running, 1 done, 1 failed')
  // A step or call of a running one changes no count: the status line is left alone.
  const statuses = world.statuses.length
  await stepAs($, WF_A, { index: 1 })
  await callTool($, WF_A, 'Grep')
  expect(world.statuses.length).toBe(statuses)
  expect(Object.keys(shadowsOf(held)).sort()).toEqual([WF_A, WF_B, WF_C])

  for (const surface of SURFACES) {
    const wideUi = await mountPane($, surface, 100)
    const wide = await paneOf(wideUi)
    await wideUi.unmount()
    expect(wide.board).toEqual([
      SESSION_ROW,
      '▾ Agents · 1 running · 0 done · workflow 1 running, 1 done, 1 failed',
      '▸● Explore          sonnet-5-5      5s 0 calls    thinking  Find the bug',
      '▾ Workflow · 1 running · 1 done · 1 failed',
      '▸● wf-4c21          sonnet-5-5      5s 2 calls    thinking · last Grep',
      '▸✗ wf-c1d3          -               5s 1 call     error · last Edit',
      '▸✓ wf-9e02          sonnet-5-5      4s 0 calls    answer',
    ])

    const narrowUi = await mountPane($, surface, 48)
    const narrow = await paneOf(narrowUi)
    await narrowUi.unmount()
    expect(narrow.board).toEqual([
      SESSION_ROW,
      // Wider than the pane: the terminal's Text cuts it as it draws; the desktop's row is cut to the pane before it is drawn.
      surface === 'terminal' ? '▾ Agents · 1 running · 0 done · workflow 1 running, 1 done, 1 failed' : '▾ Agents · 1 running · 0 done · workflow 1 runn…',
      '▸● Explore · sonnet-5-5 · 5s',
      '  Find the bug',
      '  0c · thinking',
      '▾ Workflow · 1 running · 1 done · 1 failed',
      '▸● wf-4c21 · sonnet-5-5 · 5s',
      '  2c · thinking · last Grep',
      '▸✗ wf-c1d3 · 5s',
      '  1c · error · last Edit',
      '▸✓ wf-9e02 · sonnet-5-5 · 4s',
      '  0c · answer',
    ])
  }
})

test('maxRows caps subagents and workflow agents together, the subagents first', { options: { maxRows: 3 } }, async ($, on) => {
  const { clock } = workflowWorld(on)
  await $.session.start(START)
  await spawn($)
  await spawn($, { description: 'Two' })
  for (const id of [WF_A, WF_B, WF_C]) {
    await clock.advance(1000)
    await callTool($, id, 'Read')
  }
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    const pane = await paneOf(ui)
    expect(await agentBoxes(ui)).toHaveLength(2)
    // The newest workflow agent is the one listed.
    expect((await workflowRows(ui)).map(box => box.key)).toEqual([`workflow:${WF_C}`])
    expect(pane.board.slice(-3)).toEqual([
      '▾ Workflow · 3 running · 0 done',
      '▸● wf-c1d3          -               0s 1 call     thinking · last Read',
      '+2 more',
    ])
    await ui.unmount()
  }
})

test('a workflow agent quiet for ten minutes is dropped, and a held one keeps a closed pane\'s clock until then', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock, world, held, shadowWrites } = workflowWorld(on)
  await $.session.start(START)
  await callTool($, WF_A, 'Read')
  expect(tickOf(held)).toBe(undefined)
  const writes = shadowWrites()

  await clock.advance(IDLE_MS - 5000)
  expect(shadowsOf(held)[WF_A]).toBeDefined()
  // Nothing written for it while it waits: no write per tick.
  expect(shadowWrites()).toBe(writes)
  const ui = await mountPane($)
  expect(await workflowRows(ui)).toHaveLength(1)
  await ui.unmount()

  await clock.advance(5000)
  // Expired: no longer drawn, and dropped at the next reconciliation.
  const late = await mountPane($)
  expect(await workflowRows(late)).toHaveLength(0)
  await late.unmount()
  await clock.advance(5000)
  expect(shadowsOf(held)).toEqual({})
  expect(shadowWrites()).toBe(writes + 1)
  // The clock it kept going has stopped.
  const reads = world.reads.length
  await clock.advance(10_000)
  expect(world.reads.length).toBe(reads)
})

test('a finished workflow agent stays 30 s after it ended, then goes; ticks never write it', async ($, on) => {
  const { clock, held, shadowWrites } = workflowWorld(on)
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await callTool($, WF_A, 'Edit')
  await callTool($, WF_B, 'Read')
  await complete($, WF_A)
  const ui = await mountPane($)
  const writes = shadowWrites()

  await clock.advance(LINGER_MS - 1000)
  expect(shadowWrites()).toBe(writes)
  expect(shadowsOf(held)[WF_A]?.status).toBe('done')
  expect((await paneOf(ui)).board).toContain('▾ Workflow · 1 running · 1 done')
  await clock.advance(1000)
  expect((await paneOf(ui)).board).toContain('▾ Workflow · 1 running · 0 done')
  await clock.advance(5000)
  expect(Object.keys(shadowsOf(held))).toEqual([WF_B])
  expect(shadowWrites()).toBe(writes + 1)
  await ui.unmount()
})

test('at most 64 workflow agents are held, the oldest finished dropped first', async ($, on) => {
  const { clock, held } = workflowWorld(on)
  await $.session.start(START)
  const ids = Array.from({ length: 66 }, (_, index) => `wf-run-${String(index).padStart(2, '0')}`)
  for (const [index, id] of ids.entries()) {
    await clock.advance(1)
    await callTool($, id, 'Read')
    if (index < 10) await complete($, id)
  }
  const kept = Object.keys(shadowsOf(held))
  expect(kept).toHaveLength(64)
  // The two oldest to finish went; every running one stayed.
  expect(kept).not.toContain(ids[0])
  expect(kept).not.toContain(ids[1])
  for (const id of ids.slice(2)) expect(kept).toContain(id)
})

test('with nothing finished, the cap drops the never-shown, then the one heard from longest ago', () => {
  expect(MAX_SHADOWS).toBe(64)
  let record: ShadowRecord = {}
  for (let index = 0; index < 63; index += 1) record = shadowCallStarted(record, `run-${index}`, 'Read', NOW + index)
  record = shadowStepped(record, 'fork', {}, NOW + 100)
  expect(Object.keys(record)).toHaveLength(64)
  // One more: the fork's single step goes, though it is the newest.
  record = shadowCallStarted(record, 'run-63', 'Read', NOW + 200)
  expect(Object.keys(record)).toHaveLength(64)
  expect(record.fork).toBe(undefined)
  // And another: the run quietest longest goes, never the one being written.
  record = shadowCallStarted(record, 'run-64', 'Read', NOW + 300)
  expect(record['run-0']).toBe(undefined)
  expect(record['run-64']?.toolCalls).toBe(1)
  // Pruning alone writes nothing when nothing expired.
  expect(shadowsPruned(record, NOW + 300)).toBe(record)
})

test('the board and the list come first: a known subagent, a listed loop and a spawn that raced its first steps are no workflow agents', async ($, on) => {
  const { clock, world, held } = workflowWorld(on)
  await $.session.start(START)
  await $.command.run(TOGGLE)

  // A subagent on the board: its steps and calls stay the board's.
  await spawn($)
  await stepAs($, 'sub-1')
  await callTool($, 'sub-1', 'Read')
  expect(shadowsOf(held)).toEqual({})

  // Steps that ran before their spawn's hook wrote the board: gone once it does.
  await stepAs($, 'sub-2')
  await stepAs($, 'sub-2', { index: 1 })
  expect(shadowsOf(held)['sub-2']?.steps).toBe(2)
  await spawn($)
  expect(shadowsOf(held)['sub-2']).toBe(undefined)
  expect(entryOf(held, 'sub-2')?.status).toBe('running')

  // A loop the list names on its next reconciliation leaves the workflow group for the board.
  await callTool($, 'teammate-1', 'Read')
  expect(shadowsOf(held)['teammate-1']?.toolCalls).toBe(1)
  world.agents = [{ id: 'teammate-1', description: 'Teammate', type: 'teammate', status: 'running' }]
  await clock.advance(5000)
  expect(shadowsOf(held)['teammate-1']).toBe(undefined)
  expect(entryOf(held, 'teammate-1')?.status).toBe('running')
  // Listed, its calls are never taken for a workflow agent's again.
  await $.command.run({ ...TOGGLE, args: 'clear' })
  await callTool($, 'teammate-1', 'Read')
  expect(shadowsOf(held)).toEqual({})
})

test('/clear and every other session end drop the workflow agents', STATUS_ON, async ($, on) => {
  const { world, held } = workflowWorld(on)
  await $.session.start(START)
  await callTool($, WF_A, 'Read')
  await stepAs($, WF_B)
  await stepAs($, WF_B, { index: 1 })
  expect(lastStatus(world)).toBe('agents · 0 running · 0 done · workflow 2 running')

  await $.session.end({ reason: 'clear', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
  expect(shadowsOf(held)).toEqual({})
  expect(lastStatus(world)).toBe(undefined)
  const ui = await mountPane($)
  expect((await paneOf(ui)).board).toEqual([SESSION_ROW, '▾ Agents', 'No agents yet.'])
  await ui.unmount()

  await callTool($, WF_C, 'Read')
  expect(Object.keys(shadowsOf(held))).toEqual([WF_C])
  await $.session.end({ reason: 'other', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
  expect(shadowsOf(held)).toEqual({})
})

test('/mod-hud facts includes the workflow agents as held', async ($, on) => {
  const { clock } = workflowWorld(on)
  await $.session.start(START)
  const factsOf = async () => {
    const { text = '' } = await $.command.run({ ...TOGGLE, args: 'facts' })

    return JSON.parse(text.split('\n').slice(0, -1).join('\n')) as HudData & { shadows?: ShadowRecord }
  }
  expect((await factsOf()).shadows).toBe(undefined)
  await stepAs($, WF_A)
  await clock.advance(1000)
  await callTool($, WF_A, 'Bash')
  // The record whole, a single-step entry included.
  await stepAs($, WF_B)
  const facts = await factsOf()
  expect(facts.shadows?.[WF_A]).toEqual({
    id: WF_A, model: 'claude-sonnet-5-5', effort: 'high', firstSeen: NOW, visibleAt: NOW + 1000, lastSeen: NOW + 1000,
    steps: 1, toolCalls: 1, lastTool: 'Bash', status: 'running',
  })
  expect(facts.shadows?.[WF_B]?.steps).toBe(1)
  expect(facts.now).toBe(clock.now())
})

test('with showWorkflows off, workflow agents are neither kept, drawn, counted nor shown in facts', {
  options: { showWorkflows: false, statusLine: true },
}, async ($, on) => {
  const { world, shadowWrites } = workflowWorld(on)
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await stepAs($, WF_A)
  await stepAs($, WF_A, { index: 1 })
  await callTool($, WF_A, 'Read')
  await complete($, WF_A)
  expect(shadowWrites()).toBe(0)
  expect(world.reads.filter(key => key === SHADOWS)).toEqual([])
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect((await paneOf(ui)).board).toEqual([SESSION_ROW, '▾ Agents', 'No agents yet.'])
    await ui.unmount()
  }
  expect(world.statuses.some(text => text?.includes('workflow') === true)).toBe(false)
  const { text = '' } = await $.command.run({ ...TOGGLE, args: 'facts' })
  expect(text).not.toContain('shadows')
})
