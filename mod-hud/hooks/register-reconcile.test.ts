import type { AgentStatus, Hook, Next } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { register } from './register'
import {
  AGENTS,
  SPAWN_EVENT,
  START,
  STATUS_ON,
  TICK,
  TOGGLE,
  arrange,
  boardWrites,
  callTool,
  complete,
  direct,
  entriesOf,
  entryOf,
  lastStatus,
  spawn,
  tickOf,
} from './register.fixtures'

// The board kept right under races: /clear and /mod-hud clear against a
// reconcile or a seed in flight, compare-and-set retries, pruning, and what an
// Agent call's result settles.

test('/mod-hud clear stays cleared across reconcile and reload', async ($, on) => {
  const { clock, world, held } = arrange(on)
  world.agents = [
    { id: 'old', description: 'Finished', type: 'Explore', status: 'completed' },
    { id: 'live', description: 'Working', type: 'Explore', status: 'running' },
  ]
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await $.command.run({ ...TOGGLE, args: 'clear' })
  expect(entryOf(held, 'old')).toBe(undefined)
  await clock.advance(5000)
  expect(entryOf(held, 'old')).toBe(undefined)
  await $.session.start(START)
  expect(entryOf(held, 'old')).toBe(undefined)
  expect(entryOf(held, 'live')?.status).toBe('running')
})

test('/clear dismisses both running and settled agents across reload', STATUS_ON, async ($, on) => {
  const { clock, world, held } = arrange(on)
  world.agents = [
    { id: 'old', description: 'Finished', type: 'Explore', status: 'completed' },
    { id: 'live', description: 'Working', type: 'Explore', status: 'running' },
  ]
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await $.session.end({ reason: 'clear', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
  await clock.advance(5000)
  await $.session.start(START)
  expect(entriesOf(held)).toEqual({})
  expect(lastStatus(world)).toBe(undefined)
})

test('a reconcile returning after /clear cannot write or resurrect entries', async ($, on) => {
  const { clock, world, held } = arrange(on)
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await spawn($)
  world.agents = [{ id: 'late', description: 'Late result', type: 'Explore', status: 'running' }]
  world.listDelay = 2000
  await clock.advance(5000)
  await $.session.end({ reason: 'clear', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
  const writes = world.writes.filter(key => key !== TICK).length
  await clock.advance(2000)
  expect(world.writes.filter(key => key !== TICK).length).toBe(writes)
  expect(tickOf(held)).toBe(clock.now())
  expect(entriesOf(held)).toEqual({})
})

test('a reconcile already waiting to commit cannot undo a reset', STATUS_ON, async ($, on) => {
  const { clock, world, held } = arrange(on)
  await $.session.start(START)
  await spawn($)
  world.agents = [{ id: 'late', description: 'Late run', type: 'Explore', status: 'running' }]
  world.writeDelay = 2000
  await clock.advance(5000)
  await $.session.end({ reason: 'clear', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
  const writes = world.writes.length
  await clock.advance(2000)
  expect(entriesOf(held)).toEqual({})
  expect(world.writes.length).toBe(writes)
})

test('a session-start list returning after clear cannot restore the old session', STATUS_ON, async ($, on) => {
  const { clock, world, held } = arrange(on)
  world.agents = [{ id: 'old', description: 'Old run', type: 'Explore', status: 'running' }]
  world.listDelay = 2000
  const starting = $.session.start(START)
  await clock.settle()
  await $.session.end({ reason: 'clear', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
  await clock.advance(2000)
  await starting
  expect(entriesOf(held)).toEqual({})
  expect(lastStatus(world)).toBe(undefined)
})

test('only the first session seed includes unknown settled agents', async ($, on) => {
  const { clock, world, held } = arrange(on)
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await spawn($)
  world.agents = [
    { id: 'settled', description: 'Unseen result', type: 'Explore', status: 'completed' },
    { id: 'running', description: 'Unseen run', type: 'Explore', status: 'running' },
  ]
  await clock.advance(5000)
  expect(entryOf(held, 'settled')).toBe(undefined)
  expect(entryOf(held, 'running')?.status).toBe('running')
  await $.session.start(START)
  expect(entryOf(held, 'settled')).toBe(undefined)
})

// With workflow agents on, such a call is a workflow agent's (see below).
test('an unknown subagent tool call costs at most one read and no writes', { options: { showWorkflows: false } }, async ($, on) => {
  const { world } = arrange(on)
  await $.session.start(START)
  const reads = world.reads.length
  const writes = world.writes.length
  await callTool($, 'ghost')
  expect(world.writes.length - writes).toBe(0)
  expect(world.reads.length - reads <= 1).toBe(true)
})

test('a finished agent resumes on its next tool call and keeps the newest answer', STATUS_ON, async ($, on) => {
  const { clock, world, held } = arrange(on)
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await spawn($)
  await complete($, 'sub-1', { answer: 'First answer' })
  await clock.advance(1000)
  world.tool = async () => {
    await clock.sleep(500)

    return { result: 'resumed' }
  }
  const call = callTool($, 'sub-1')
  await clock.settle()
  expect(entryOf(held, 'sub-1')?.status).toBe('running')
  expect(entryOf(held, 'sub-1')?.endedAt).toBe(undefined)
  expect(entryOf(held, 'sub-1')?.outcome).toBe(undefined)
  expect(lastStatus(world)).toBe('agents · 1 running · 0 done')
  await clock.advance(500)
  await call
  await clock.advance(500)
  expect(tickOf(held)).toBe(clock.now())
  await complete($, 'sub-1', { answer: '\nSecond answer\nMore detail' })
  expect(entryOf(held, 'sub-1')?.status).toBe('done')
  expect(entryOf(held, 'sub-1')?.summary).toBe('Second answer')
  expect(lastStatus(world)).toBe('agents · 0 running · 1 done')
})

test('the closed-pane status stalls, recovers, and emits only changed text', {
  options: { stalledAfterSec: 5, statusLine: true },
}, async ($, on) => {
  const { clock, world, held } = arrange(on)
  await $.session.start(START)
  await spawn($)
  const statuses = world.statuses.length
  const writes = world.writes.length
  await clock.advance(4000)
  expect(world.writes.length).toBe(writes)
  expect(world.statuses.length).toBe(statuses)
  await clock.advance(1000)
  expect(world.statuses.length).toBe(statuses)
  await clock.advance(5000)
  expect(lastStatus(world)).toBe('agents · 1 running · 0 done · 1 stalled')
  expect(world.statuses.length).toBe(statuses + 1)
  await callTool($, 'sub-1')
  await clock.advance(5000)
  expect(lastStatus(world)).toBe('agents · 1 running · 0 done')
  expect(world.statuses.length).toBe(statuses + 2)
  expect(tickOf(held)).toBe(undefined)
  expect(world.panes).toEqual([])
})

test('a listed killed agent settles while its pane is closed', STATUS_ON, async ($, on) => {
  const { clock, world, held } = arrange(on)
  await $.session.start(START)
  await spawn($)
  world.agents = [{ id: 'sub-1', description: 'Stopped', type: 'Explore', status: 'killed' }]
  await clock.advance(5000)
  expect(entryOf(held, 'sub-1')).toMatchObject({ status: 'failed', outcome: 'killed' })
  expect(lastStatus(world)).toBe('agents · 0 running · 0 done · 1 failed')
  expect(tickOf(held)).toBe(undefined)
})

test('settling prunes the oldest finished entries, never running ones, and dismisses their ids', {
  options: { maxRows: 2, statusLine: true },
}, async ($, on) => {
  const { clock, world, held } = arrange(on)
  await $.session.start(START)
  for (let index = 0; index < 23; index += 1) await spawn($)
  // Finish out of spawn order: sub-2 is the oldest finished entry.
  for (const id of ['sub-2', 'sub-1', ...Array.from({ length: 19 }, (_, index) => `sub-${index + 3}`)]) {
    await clock.advance(1)
    await complete($, id)
  }
  expect(Object.values(entriesOf(held)).filter(entry => entry.status !== 'running')).toHaveLength(20)
  expect(entryOf(held, 'sub-2')).toBe(undefined)
  expect(entryOf(held, 'sub-1')?.status).toBe('done')
  expect(entryOf(held, 'sub-22')?.status).toBe('running')
  expect(entryOf(held, 'sub-23')?.status).toBe('running')
  expect(held.get('dismissed')?.value).toContain('sub-2')
  world.agents = [{ id: 'sub-2', description: 'Oldest', type: 'Explore', status: 'completed' }]
  await clock.advance(5000)
  await $.session.start(START)
  expect(entryOf(held, 'sub-2')).toBe(undefined)
})

test('reconcile and Agent completion prune at twice maxRows above the floor', {
  options: { maxRows: 12 },
}, async ($, on) => {
  const { world, held } = arrange(on)
  world.agents = Array.from({ length: 25 }, (_, index) => ({
    id: `old-${String(index).padStart(2, '0')}`, description: 'Old result', type: 'Explore', status: 'completed' as const,
  }))
  await $.session.start(START)
  expect(Object.keys(entriesOf(held))).toHaveLength(24)
  expect(entryOf(held, 'old-00')).toBe(undefined)
  expect(held.get('dismissed')?.value).toContain('old-00')
  await spawn($)
  world.tool = async () => ({
    result: { agentId: 'sub-1', status: 'completed', content: [{ type: 'text', text: 'Done' }], totalToolUseCount: 1 },
  })
  await callTool($, undefined, 'Agent')
  expect(Object.keys(entriesOf(held))).toHaveLength(24)
  expect(entryOf(held, 'old-01')).toBe(undefined)
  expect(entryOf(held, 'sub-1')?.status).toBe('done')
  expect(held.get('dismissed')?.value).toContain('old-01')
})

test('Agent result summaries skip harness blocks and prefer a delivered handback', async ($, on) => {
  const { world, held } = arrange(on)
  await $.session.start(START)
  await spawn($)
  await spawn($)
  const result = {
    agentId: 'sub-1',
    status: 'completed',
    harnessNoteCount: 1,
    content: [{ type: 'text', text: 'Harness bookkeeping' }, { type: 'text', text: 'Actual answer' }],
    totalToolUseCount: 0,
  }
  world.tool = async () => ({ result })
  await callTool($, undefined, 'Agent')
  expect(entryOf(held, 'sub-1')?.summary).toBe('Actual answer')
  world.tool = async () => ({ result: { ...result, agentId: 'sub-2', handbackReport: { text: 'Delivered answer' } } })
  await callTool($, undefined, 'Agent')
  expect(entryOf(held, 'sub-2')?.summary).toBe('Delivered answer')
})

test('concurrent lifecycle updates do not emit duplicate status text', async () => {
  const d = direct()
  await register(d.on, { statusLine: true })
  const spawned = d.next<'agent.spawn'>({ agentId: 'sub-1' })
  await Promise.all([
    d.hook('agent.spawn')(d.$, SPAWN_EVENT, spawned.run),
    d.hook('agent.spawn')(d.$, SPAWN_EVENT, spawned.run),
  ])
  expect(d.world.statuses).toEqual(['agents · 1 running · 0 done'])
})

test('subagent tool results retain identity, including denial and error results', async () => {
  const d = direct()
  await register(d.on, {})
  await d.hook('agent.spawn')(d.$, SPAWN_EVENT, d.next<'agent.spawn'>({ agentId: 'sub-1' }).run)
  const event = { tool: 'Bash', command: 'ls', tool_use_id: 't1', agentId: 'sub-1' } as Parameters<Hook<'tool.call'>>[1]
  for (const result of [{ result: { stdout: 'ok' } }, { deny: 'denied' }, { result: 'failed', isError: true }]) {
    const next = d.next<'tool.call'>(result)
    expect(await d.hook('tool.call')(d.$, event, next.run)).toBe(result)
    expect(next.calls).toEqual([event])
    expect(d.entries()['sub-1']?.currentTool).toBe(undefined)
  }
  d.world.failReads = true
  const result = { result: 'still runs' }
  expect(await d.hook('tool.call')(d.$, event, d.next<'tool.call'>(result).run)).toBe(result)
})

test('a thrown subagent tool error is preserved and its current tool clears', async () => {
  const d = direct()
  await register(d.on, {})
  await d.hook('agent.spawn')(d.$, SPAWN_EVENT, d.next<'agent.spawn'>({ agentId: 'sub-1' }).run)
  const event = { tool: 'Bash', command: 'ls', tool_use_id: 't1', agentId: 'sub-1' } as Parameters<Hook<'tool.call'>>[1]
  const error = new Error('tool failed')
  let caught: unknown
  try {
    await d.hook('tool.call')(d.$, event, (async () => { throw error }) as unknown as Next<'tool.call'>)
  } catch (one) {
    caught = one
  }
  expect(caught).toBe(error)
  expect(d.entries()['sub-1']?.currentTool).toBe(undefined)
  expect(d.entries()['sub-1']?.toolCalls).toBe(1)
})

test('a delayed status compare-and-set cannot restore stale text after clear', {
  options: { stalledAfterSec: 5, statusLine: true },
}, async ($, on) => {
  const { clock, world, held } = arrange(on)
  await $.session.start(START)
  await spawn($)
  world.statusWriteDelay = 2000
  await clock.advance(10_000)
  await $.session.end({ reason: 'clear', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
  const writes = world.writes.length
  const statuses = world.statuses.length
  await clock.advance(2000)
  expect(lastStatus(world)).toBe(undefined)
  expect(held.get('statusText')?.value).toBe(null)
  expect(world.statuses.length).toBe(statuses)
  expect(world.writes.length).toBe(writes)
})

test('session.start repins unchanged status after reload, including an empty board', STATUS_ON, async ($, on) => {
  const { world } = arrange(on)
  await $.session.start(START)
  world.statuses.length = 0
  await $.session.start(START)
  expect(world.statuses).toEqual([undefined])
  await spawn($)
  world.statuses.length = 0
  await $.session.start(START)
  expect(world.statuses).toEqual(['agents · 1 running · 0 done'])
})

test('unchanged reconciliation never writes the agents state', STATUS_ON, async ($, on) => {
  const { clock, world } = arrange(on)
  await $.session.start(START)
  await spawn($)
  world.agents = [{ id: 'sub-1', description: 'Running', type: 'Explore', status: 'running' }]
  const writes = world.writes.filter(key => key === AGENTS).length
  await clock.advance(15_000)
  expect(world.writes.filter(key => key === AGENTS).length).toBe(writes)
})

test('reconciliation retries one missed compare-and-set against fresh activity', STATUS_ON, async ($, on) => {
  const { clock, world, held } = arrange(on)
  await $.session.start(START)
  await spawn($)
  world.agents = [{ id: 'sub-1', description: 'Stopped', type: 'Explore', status: 'killed' }]
  world.listDelay = 2000
  await clock.advance(5000)
  await callTool($, 'sub-1')
  await clock.advance(2000)
  expect(entryOf(held, 'sub-1')).toMatchObject({ status: 'failed', outcome: 'killed', toolCalls: 1 })
})

test('a loop not started, held or between turns is still running, at the seed and after it', STATUS_ON, async ($, on) => {
  const { clock, world, held } = arrange(on)
  world.agents = [{ id: 'held', description: 'Held', type: 'Explore', status: 'waiting' }]
  await $.session.start(START)
  expect(entryOf(held, 'held')).toMatchObject({ status: 'running' })
  for (const status of ['pending', 'waiting', 'idle', 'running'] as const) {
    world.agents = [
      { id: 'held', description: 'Held', type: 'Explore', status },
      { id: 'sub-1', description: 'Find the bug', type: 'Explore', status },
    ]
    if (entryOf(held, 'sub-1') === undefined) await spawn($)
    await clock.advance(5000)
    expect(entryOf(held, 'held'), status).toMatchObject({ status: 'running' })
    expect(entryOf(held, 'sub-1'), status).toMatchObject({ status: 'running' })
    expect(entryOf(held, 'sub-1')?.endedAt, status).toBeUndefined()
  }
  expect(lastStatus(world)).toBe('agents · 2 running · 0 done')
})

// Statuses the engine may add later: a status `AgentStatus` does not name.
const unlisted = (status: string): AgentStatus => status as AgentStatus

test('other engine terminal statuses settle entries and stop the timer', STATUS_ON, async ($, on) => {
  const { clock, world, held } = arrange(on)
  world.agents = [
    { id: 'old', description: 'Cancelled', type: 'Explore', status: unlisted('cancelled') },
    { id: 'failed', description: 'Failed', type: 'Explore', status: 'failed' },
  ]
  await $.session.start(START)
  expect(entryOf(held, 'old')).toMatchObject({ status: 'failed', outcome: 'cancelled' })
  expect(entryOf(held, 'failed')).toMatchObject({ status: 'failed', outcome: 'failed' })
  await spawn($)
  world.agents.push({ id: 'sub-1', description: 'Timed out', type: 'Explore', status: unlisted('timed_out') })
  await clock.advance(5000)
  expect(entryOf(held, 'sub-1')).toMatchObject({ status: 'failed', outcome: 'timed_out' })
  expect(lastStatus(world)).toBe('agents · 0 running · 0 done · 3 failed')
  const reads = world.reads.length
  await clock.advance(10_000)
  expect(world.reads.length).toBe(reads)
})

test('a remote_launched result passes through without inventing a local agent', async ($, on) => {
  const { world, held } = arrange(on)
  await $.session.start(START)
  const result = {
    status: 'remote_launched', taskId: 'remote-1', sessionUrl: 'https://example.test/session',
    description: 'Remote work', prompt: 'work', outputFile: '/work/out',
  }
  world.tool = async () => ({ result })
  const writes = boardWrites(world)
  expect((await callTool($, undefined, 'Agent')).result).toEqual(result)
  expect(entriesOf(held)).toEqual({})
  expect(boardWrites(world)).toBe(writes)
})
