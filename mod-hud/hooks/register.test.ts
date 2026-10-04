import type { AgentInfo, Hook } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { register } from './register'
import {
  NOW,
  PANE,
  SPAWN_EVENT,
  START,
  STATUS_ON,
  SURFACES,
  TOGGLE,
  arrange,
  boardWrites,
  callTool,
  complete,
  direct,
  entriesOf,
  entryOf,
  lastStatus,
  mountPane,
  spawn,
  stepAs,
  textsOf,
  tickOf,
  workflowWorld,
} from './register.fixtures'
import type { Drawing } from './register.fixtures'
import { textRowsOf } from './text-svg.fixtures'

// The hooks and the board: /mod-hud's pane, an agent's spawn, calls and end,
// the pane's clock, the rows wide and narrow, the seed, reloads and /clear.

const ACCENT = 'claude'

const linesOf = async (ui: Drawing): Promise<string[]> => (await textsOf(ui)).map(one => one.text)

const rowOf = async (ui: Drawing, id: string) => {
  await ui.redraw()

  return ui.find({ key: `agent:${id}` })
}

test('/mod-hud opens and closes the pane, raises a hidden tab, and reports a pane left waiting', async ($, on) => {
  const { world } = arrange(on)
  await $.session.start(START)
  // The board never opens unasked, and every command it declares is immediate.
  expect(world.panes).toEqual([])
  expect(world.opens).toEqual([])
  expect(world.registered.map(one => one.name)).toEqual(['mod-hud'])
  expect(world.registered.every(one => one.immediate === true)).toBe(true)
  expect(world.registered[0]?.description).toBe('Show or hide the HUD (session, context, limits, cost, git, tools, todos, and every subagent)')

  const opened = await $.command.run(TOGGLE)
  expect(opened.text).toBe('HUD opened.')
  expect(world.panes.map(one => one.id)).toEqual([PANE])
  expect(world.opens[0]?.focus).toBe(undefined)
  expect(world.opens[0]?.title).toBe('HUD')
  expect(world.opens[0]?.columns).toBe(72)
  expect(world.opens[0]?.rows).toBe(16)

  const closed = await $.command.run(TOGGLE)
  expect(closed.text).toBe('HUD closed.')
  expect(world.panes).toEqual([])

  await $.command.run({ ...TOGGLE, command: 'mod-hud' })
  world.panes = world.panes.map(one => ({ ...one, isShown: false }))
  const raised = await $.command.run(TOGGLE)
  expect(raised.text).toBe('HUD opened.')
  expect(world.panes.map(one => one.isShown)).toEqual([true])
  expect(world.opens[1]?.focus).toBe(undefined)
  expect(world.opens[2]?.focus).toBe(true)

  await $.command.run(TOGGLE)
  world.isPlaced = false
  const waiting = await $.command.run(TOGGLE)
  expect(waiting.text).toBe('HUD is waiting: terminal too narrow')
})

test('a spawn creates a running entry, the status line follows it, and the row is drawn', STATUS_ON, async ($, on) => {
  const { clock, world, held } = arrange(on)
  await $.session.start(START)
  expect(lastStatus(world)).toBe(undefined)

  const spawned = await spawn($)
  expect(spawned).toEqual({ model: 'claude-sonnet-5-5', agentId: 'sub-1' })
  expect(entryOf(held, 'sub-1')).toEqual({
    id: 'sub-1',
    toolUseId: 'tu-1',
    type: 'Explore',
    model: 'claude-sonnet-5-5',
    description: 'Find the bug',
    background: false,
    startedAt: clock.now(),
    lastActivityAt: clock.now(),
    status: 'running',
    toolCalls: 0,
  })
  expect(lastStatus(world)).toBe('agents · 1 running · 0 done')

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    const lines = await linesOf(ui)
    expect(lines[0]).toBe('Agents · 1 running · 0 done')
    expect(await rowOf(ui, 'sub-1')).toBeDefined()
    expect(lines.some(line => line.includes('Explore') && line.includes('sonnet-5-5'))).toBe(true)
    expect(lines.some(line => line.includes('thinking') && line.includes('Find the bug'))).toBe(true)
    // The header's counts are coloured (running green, done red); the row's glyph keeps the accent.
    const texts = await textsOf(ui)
    expect(texts.find(one => one.text === '1 running')?.props.color).toBe('success')
    expect(texts.find(one => one.text === '0 done')?.props.color).toBe('error')
    expect(texts.find(one => one.text === '●')?.props.color).toBe(ACCENT)
    await ui.unmount()
  }
})

test('a subagent tool call reads as the current tool while it runs and clears after', async ($, on) => {
  const { clock, world, held } = arrange(on)
  world.tool = async () => {
    await clock.sleep(500)

    return { result: 'ok' }
  }
  await $.session.start(START)
  await spawn($)

  const drawings = []
  for (const surface of SURFACES) drawings.push(await mountPane($, surface, 38))

  const call = callTool($, 'sub-1')
  await clock.settle()
  expect(entryOf(held, 'sub-1')?.currentTool).toBe('Bash')
  expect(entryOf(held, 'sub-1')?.toolCalls).toBe(1)
  for (const ui of drawings) expect(await linesOf(ui)).toContain('  1c · Bash')

  await clock.advance(500)
  await call
  expect(entryOf(held, 'sub-1')?.currentTool).toBe(undefined)
  expect(entryOf(held, 'sub-1')?.toolCalls).toBe(1)
  for (const ui of drawings) expect(await linesOf(ui)).toContain('  1c · thinking')

  // An MCP tool reads as server:tool.
  const mcp = callTool($, 'sub-1', 'mcp__notion__search')
  await clock.settle()
  expect(entryOf(held, 'sub-1')?.currentTool).toBe('notion:search')
  await clock.advance(500)
  await mcp
  expect(entryOf(held, 'sub-1')?.toolCalls).toBe(2)
  for (const ui of drawings) await ui.unmount()

  // The main loop's own calls leave the board alone.
  const writes = boardWrites(world)
  const own = callTool($, undefined)
  await clock.advance(500)
  await own
  expect(boardWrites(world)).toBe(writes)
})

test('turn.complete settles the entry, freezes its elapsed time and updates the status line', STATUS_ON, async ($, on) => {
  const { clock, world, held } = arrange(on)
  await $.session.start(START)
  await spawn($)
  await spawn($, { tool_use_id: 'tu-2', description: 'Fix it' })

  await clock.advance(5000)
  await complete($, 'sub-1', { answer: '\n  Found it in parser.ts\nand more detail' })
  const done = entryOf(held, 'sub-1')
  expect(done?.status).toBe('done')
  expect(done?.outcome).toBe('answer')
  expect(done?.summary).toBe('Found it in parser.ts')
  expect(done?.endedAt).toBe(clock.now())
  expect(done?.currentTool).toBe(undefined)
  expect(lastStatus(world)).toBe('agents · 1 running · 1 done')

  await complete($, 'sub-2', { reason: 'error', answer: '' })
  expect(entryOf(held, 'sub-2')?.status).toBe('failed')
  expect(entryOf(held, 'sub-2')?.outcome).toBe('error')
  expect(lastStatus(world)).toBe('agents · 0 running · 1 done · 1 failed')

  // A turn of the main loop or of an agent the board never saw changes nothing
  // on the board (the main turn counts in the HUD's usage).
  const writes = boardWrites(world)
  await complete($, 'ghost')
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't9', reason: 'answer' })
  expect(boardWrites(world)).toBe(writes)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    await clock.advance(60_000)
    const lines = await linesOf(ui)
    expect(lines[0]).toBe('Agents · 0 running · 1 done · 1 failed')
    expect(lines.some(line => line.includes('5s'))).toBe(true)
    expect(lines.some(line => line.includes('Find the bug — Found it in parser.ts'))).toBe(true)
    expect(lines.some(line => line.includes('Fix it — error'))).toBe(true)
    await ui.unmount()
  }
})

test('elapsed advances while the pane is placed and stops once it closes', async ($, on) => {
  const { clock, held } = arrange(on)
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await spawn($)

  const ui = await mountPane($)
  await clock.advance(3000)
  expect(tickOf(held)).toBe(clock.now())
  expect((await linesOf(ui)).some(line => line.includes(' 3s'))).toBe(true)
  await clock.advance(2000)
  expect((await linesOf(ui)).some(line => line.includes(' 5s'))).toBe(true)

  await $.command.run(TOGGLE)
  const stopped = tickOf(held)
  await clock.advance(5000)
  expect(tickOf(held)).toBe(stopped)
  await ui.unmount()
})

test('pane ticks stop when its pane is no longer placed', async ($, on) => {
  const { clock, world, held } = arrange(on)
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await spawn($)
  await clock.advance(1000)
  expect(tickOf(held)).toBe(clock.now())

  world.panes = world.panes.map(one => ({ ...one, isPlaced: false }))
  await clock.advance(10_000)
  const stopped = tickOf(held)
  await clock.advance(5000)
  expect(tickOf(held)).toBe(stopped)
})

test('a quiet agent is drawn stalled until it is heard from', { options: { stalledAfterSec: 5, statusLine: true } }, async ($, on) => {
  const { clock, world, held } = arrange(on)
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await spawn($)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect((await linesOf(ui)).some(line => line.includes('●'))).toBe(true)
    await ui.unmount()
  }

  await clock.advance(7000)
  expect(lastStatus(world)).toBe('agents · 1 running · 0 done · 1 stalled')
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    const lines = await linesOf(ui)
    expect(lines.some(line => line.includes('◌'))).toBe(true)
    expect(lines.some(line => line.includes('●'))).toBe(false)
    expect(lines[0]).toBe('Agents · 1 running · 0 done · 1 stalled')
    await ui.unmount()
  }

  // A call from the subagent is activity: it is no longer stalled.
  await callTool($, 'sub-1')
  await clock.advance(1000)
  expect(lastStatus(world)).toBe('agents · 1 running · 0 done')
  expect(entryOf(held, 'sub-1')?.lastActivityAt).toBe(NOW + 7000)
  const ui = await mountPane($)
  const lines = await linesOf(ui)
  expect(lines.some(line => line.includes('◌'))).toBe(false)
  expect(lines.some(line => line.includes('●'))).toBe(true)
  await ui.unmount()
})

test('a rejected tick stops its own timer', async ($, on) => {
  const { clock, world, held } = arrange(on)
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await spawn($)
  world.denyList = true
  await clock.advance(5000)
  const stopped = tickOf(held)
  await clock.advance(3000)
  expect(tickOf(held)).toBe(stopped)
})

test('a late tick rejection cannot stop a replacement timer', async ($, on) => {
  const { clock, world, held } = arrange(on)
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await spawn($)
  world.denyList = true
  world.listDelay = 2000
  await clock.advance(5000)
  // While the old timer's list call is out, the pane is closed and opened again.
  await $.command.run(TOGGLE)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const before = tickOf(held)
  await clock.advance(1000)
  expect(tickOf(held)).toBe(clock.now())
  expect(tickOf(held)).not.toBe(before)
})

test('narrow panes draw three lines per agent, wide ones one row, and nothing wraps', async ($, on) => {
  const { clock, world } = arrange(on)
  world.tool = async () => {
    await clock.sleep(500)

    return { result: 'ok' }
  }
  await $.session.start(START)
  await spawn($)
  await spawn($, { tool_use_id: 'tu-2', description: 'Fix it', subagentType: 'general-purpose' })
  await complete($, 'sub-2')
  const call = callTool($, 'sub-1')
  await clock.settle()

  for (const surface of SURFACES) {
    const narrow = await mountPane($, surface, 38)
    const texts = await textsOf(narrow)
    if (surface === 'desktop') {
      // In pixels: each agent a column of three rows of its own, none wider than the pane.
      for (const id of ['sub-1', 'sub-2']) {
        const box = await rowOf(narrow, id)
        expect(box?.props.flexDirection).toBe('column')
        const lines = textRowsOf(box)
        expect(lines).toHaveLength(3)
        for (const line of lines) expect(line.length).toBeLessThanOrEqual(38)
      }
      expect(textRowsOf(await rowOf(narrow, 'sub-1'))).toEqual(['▸● Explore · sonnet-5-5 · 0s', '  Find the bug', '  1c · Bash'])
      await narrow.unmount()
      const wide = await mountPane($, surface, 100)
      expect(await wide.findAll({ type: 'Box', key: 'agent:sub-2' })).toHaveLength(1)
      const rows = textRowsOf(await wide.find({ key: 'agents' }))
      expect(rows.some(line => line.startsWith('▸● Explore '))).toBe(true)
      expect(rows.some(line => line.startsWith('▸✓ general-purpose '))).toBe(true)
      expect(await wide.findAll({ type: 'Text' })).toEqual([])
      await wide.unmount()
      continue
    }
    // Three lines per agent, the first holding its name in the mascot's colour.
    // The header and its two coloured counts; per agent three lines and its coloured name; the done one's struck facts.
    expect(texts.length).toBe(3 + (3 + 1) * 2 + 1)
    for (const text of texts) expect(text.props.wrap).toBe('truncate-end')
    const row = await rowOf(narrow, 'sub-1')
    expect(row?.props.flexDirection).toBe('column')
    expect(row?.children.length).toBe(3)
    expect(texts.map(one => one.text)).toContain('  1c · Bash')
    expect(texts.map(one => one.text)).toContain('  Find the bug')
    await narrow.unmount()

    const wide = await mountPane($, surface, 100)
    const cells = await textsOf(wide)
    for (const text of cells) expect(text.props.wrap).toBe('truncate-end')
    const flat = await rowOf(wide, 'sub-1')
    expect(flat?.props.flexDirection).toBe(undefined)
    expect(flat?.children.length).toBe(3)
    expect(await wide.findAll({ type: 'Box', key: 'agent:sub-2' })).toHaveLength(1)
    expect(cells.map(one => one.text).some(line => line.startsWith('Explore '))).toBe(true)
    expect(cells.map(one => one.text).some(line => line.startsWith('general-purpose '))).toBe(true)
    await wide.unmount()
  }

  await clock.advance(500)
  await call
})

test('a nested spawn is indented under the board', async ($, on) => {
  const { held } = arrange(on)
  await $.session.start(START)
  await spawn($)
  await spawn($, { tool_use_id: 'tu-2', description: 'Dig deeper', parentAgentId: 'sub-1' })
  await spawn($, { tool_use_id: 'tu-3', description: 'Deeper still', parentAgentId: 'sub-2' })
  expect(entryOf(held, 'sub-2')?.parentId).toBe('sub-1')

  for (const surface of SURFACES) {
    for (const columns of [38, 100]) {
      const ui = await mountPane($, surface, columns)
      if (surface === 'desktop') {
        // In pixels the indent is the row's first blank cells, the inspect Button after them.
        for (const [id, indent] of [['sub-1', 0], ['sub-2', 2], ['sub-3', 4]] as const) {
          const first = textRowsOf(await rowOf(ui, id))[0] ?? ''
          expect(first.length - first.trimStart().length, `${id} @${columns}`).toBe(indent)
          expect(first.trimStart(), `${id} @${columns}`).toStartWith('▸●')
        }
        await ui.unmount()
        continue
      }
      expect((await rowOf(ui, 'sub-1'))?.props.paddingLeft).toBe(0)
      expect((await rowOf(ui, 'sub-2'))?.props.paddingLeft).toBe(2)
      expect((await rowOf(ui, 'sub-3'))?.props.paddingLeft).toBe(4)
      await ui.unmount()
    }
  }
})

test('session start seeds agents from the list and the 5 s tick reconciles them', STATUS_ON, async ($, on) => {
  const { clock, world, held } = arrange(on)
  world.agents = [
    { id: 'old-1', description: 'Old search', type: 'Explore', status: 'killed' },
    { id: 'old-2', description: 'Old build', type: 'general-purpose', status: 'running', parentId: 'old-1' },
  ]
  await $.session.start(START)
  expect(entryOf(held, 'old-1')).toMatchObject({
    status: 'failed',
    outcome: 'killed',
    startedAt: 0,
    toolCalls: 0,
    background: false,
  })
  expect(entryOf(held, 'old-1')?.model).toBe(undefined)
  expect(entryOf(held, 'old-2')).toMatchObject({ status: 'running', startedAt: 0, parentId: 'old-1' })
  expect(lastStatus(world)).toBe('agents · 1 running · 0 done · 1 failed')

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    const lines = await linesOf(ui)
    expect(lines.some(line => line.includes('Explore') && line.includes('?'))).toBe(true)
    await ui.unmount()
  }

  await $.command.run(TOGGLE)
  world.agents = [world.agents[0] as AgentInfo, { ...(world.agents[1] as AgentInfo), status: 'completed' }]
  await clock.advance(4000)
  expect(entryOf(held, 'old-2')?.status).toBe('running')
  await clock.advance(1000)
  expect(entryOf(held, 'old-2')).toMatchObject({ status: 'done', outcome: 'answer', endedAt: clock.now() })
  expect(lastStatus(world)).toBe('agents · 0 running · 1 done · 1 failed')

  // Nothing is running any more, but the open HUD still ticks.
  await clock.advance(5000)
  expect(tickOf(held)).toBe(clock.now())
  await $.command.run(TOGGLE)
  const stopped = tickOf(held)
  await clock.advance(5000)
  expect(tickOf(held)).toBe(stopped)
})

test('an Agent call on the main loop fills the summary, the count and a missing model', STATUS_ON, async ($, on) => {
  const { clock, world, held } = arrange(on)
  world.agents = [{ id: 'old-1', description: 'Old search', type: 'Explore', status: 'running' }]
  await $.session.start(START)
  await spawn($)
  await clock.advance(1000)

  world.tool = async () => ({
    result: {
      agentId: 'sub-1',
      agentType: 'Explore',
      status: 'completed',
      content: [{ type: 'text', text: 'Three files matter.\nThe rest is detail.' }],
      resolvedModel: 'claude-opus-5-5',
      totalToolUseCount: 7,
      totalDurationMs: 1000,
      totalTokens: 10,
      prompt: 'look around',
    },
  })
  await callTool($, undefined, 'Agent')
  expect(entryOf(held, 'sub-1')).toMatchObject({
    status: 'done',
    outcome: 'answer',
    summary: 'Three files matter.',
    toolCalls: 7,
    model: 'claude-sonnet-5-5',
    endedAt: clock.now(),
  })
  expect(lastStatus(world)).toBe('agents · 1 running · 1 done')

  world.tool = async () => ({
    result: {
      status: 'async_launched',
      agentId: 'old-1',
      description: 'Old search',
      resolvedModel: 'claude-haiku-4-5',
      prompt: 'look',
      outputFile: '/tmp/out',
    },
  })
  await callTool($, undefined, 'Agent')
  expect(entryOf(held, 'old-1')?.model).toBe('claude-haiku-4-5')
  expect(entryOf(held, 'old-1')?.status).toBe('running')

  // A denied or errored Agent call changes nothing on the board.
  const writes = boardWrites(world)
  world.tool = async () => ({ result: undefined })
  await callTool($, undefined, 'Agent')
  expect(boardWrites(world)).toBe(writes)
})

test('a /clear empties the board and status; the HUD ticks until its pane closes', STATUS_ON, async ($, on) => {
  const { clock, world, held } = arrange(on)
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await spawn($)
  await clock.advance(2000)
  expect(Object.keys(entriesOf(held))).toEqual(['sub-1'])

  await $.session.end({ reason: 'clear', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
  expect(entriesOf(held)).toEqual({})
  expect(lastStatus(world)).toBe(undefined)
  await clock.advance(1000)
  expect(tickOf(held)).toBe(clock.now())
  await $.command.run(TOGGLE)
  const stopped = tickOf(held)
  await clock.advance(5000)
  expect(tickOf(held)).toBe(stopped)

  const ui = await mountPane($)
  const lines = await linesOf(ui)
  expect(lines).toEqual(['Agents', 'No agents yet.'])
  await ui.unmount()

  // Any other end leaves the board as it is.
  await spawn($)
  await $.session.end({ reason: 'other', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
  expect(Object.keys(entriesOf(held))).toEqual(['sub-2'])
})

test('a hot reload keeps the entries and restarts the timer', async () => {
  const d = direct()
  const started = d.next<'session.start'>({ cwd: '/work' })
  const spawned = d.next<'agent.spawn'>({ model: 'claude-sonnet-5-5', agentId: 'sub-1' })

  await register(d.on, { statusLine: true })
  d.world.panes = []
  await d.hook('session.start')(d.$, START, started.run)
  expect(d.world.timers.length).toBe(0)
  await d.hook('agent.spawn')(d.$, SPAWN_EVENT, spawned.run)
  expect(d.world.timers.length).toBe(1)
  expect(Object.keys(d.entries())).toEqual(['sub-1'])

  // The reload: a fresh registration, and the session start that follows it.
  await register(d.on, { statusLine: true })
  expect(d.world.timers[0]?.cancelled).toBe(true)
  await d.hook('session.start')(d.$, START, started.run)
  expect(d.world.timers.length).toBe(2)
  expect(d.world.timers[1]?.cancelled).toBe(false)
  expect(Object.keys(d.entries())).toEqual(['sub-1'])
  expect(d.world.statuses.at(-1)).toBe('agents · 1 running · 0 done')
  expect(started.calls.length).toBe(2)
})

test('a session.append from a subagent counts as activity, throttled, and always continues the chain', async () => {
  const d = direct()
  const spawned = d.next<'agent.spawn'>({ model: 'claude-sonnet-5-5', agentId: 'sub-1' })
  const row = { message: { type: 'user', content: [] }, uuid: 'u1' }
  const stored = d.next<'session.append'>(row)
  const event = (agentId?: string) =>
    ({
      message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'hi' }] },
      door: 'note',
      origin: { kind: 'plugin', name: 'someone' },
      uuid: 'u1',
      ...(agentId === undefined ? {} : { agentId }),
    }) as unknown as Parameters<Hook<'session.append'>>[1]

  await register(d.on, {})
  await d.hook('agent.spawn')(d.$, SPAWN_EVENT, spawned.run)
  const append = (agentId?: string) => d.hook('session.append')(d.$, event(agentId), stored.run)

  // Under the throttle: the entry is not written.
  d.world.now = NOW + 4000
  const writes = d.world.writes
  expect(await append('sub-1')).toBe(row)
  expect(d.world.writes).toBe(writes)
  expect(d.entries()['sub-1']?.lastActivityAt).toBe(NOW)

  // Past it: one write, and the next one within five seconds is skipped again.
  d.world.now = NOW + 6000
  await append('sub-1')
  expect(d.world.writes).toBe(writes + 1)
  expect(d.entries()['sub-1']?.lastActivityAt).toBe(NOW + 6000)
  d.world.now = NOW + 9000
  await append('sub-1')
  expect(d.world.writes).toBe(writes + 1)
  d.world.now = NOW + 12_000
  await append('sub-1')
  expect(d.world.writes).toBe(writes + 2)

  // The main loop and an agent the board never saw write nothing.
  await append()
  await append('ghost')
  expect(d.world.writes).toBe(writes + 2)

  // A board that cannot read its state still lets the row through.
  d.world.failReads = true
  expect(await append('sub-1')).toBe(row)
  expect(stored.calls.length).toBe(7)
  for (const call of stored.calls) expect(call).toBeDefined()
})

test('maxRows caps the list and counts the rest', { options: { maxRows: 2 } }, async ($, on) => {
  const { clock } = arrange(on)
  await $.session.start(START)
  for (const description of ['One', 'Two', 'Three']) {
    await clock.advance(1000)
    await spawn($, { description })
  }

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    const lines = await linesOf(ui)
    expect(lines[0]).toBe('Agents · 3 running · 0 done')
    expect(await ui.findAll({ type: 'Box', key: 'agent:sub-3' })).toHaveLength(1)
    expect(await ui.findAll({ type: 'Box', key: 'agent:sub-2' })).toHaveLength(1)
    expect(await ui.findAll({ type: 'Box', key: 'agent:sub-1' })).toHaveLength(0)
    expect(lines.at(-1)).toBe('+1 more')
    await ui.unmount()
  }
})

test('the status line option switches the summary off, and /mod-hud clear drops finished agents', {
  options: { statusLine: false },
}, async ($, on) => {
  const { world, held } = arrange(on)
  await $.session.start(START)
  await spawn($)
  await spawn($, { tool_use_id: 'tu-2' })
  await complete($, 'sub-1')
  expect(world.statuses.every(text => text === undefined)).toBe(true)

  const dropped = await $.command.run({ ...TOGGLE, args: 'clear' })
  expect(dropped.text).toBe('Dropped 1 finished agent from the board.')
  expect(Object.keys(entriesOf(held))).toEqual(['sub-2'])

  const usage = await $.command.run({ ...TOGGLE, command: 'mod-hud', args: 'later' })
  expect(usage.text).toBe('Usage: /mod-hud [clear|facts]')
  expect(world.panes).toEqual([])
})

test('/agents keeps the built-in agent manager and opens no pane', async ($, on) => {
  const { world } = arrange(on)
  on('command.run', { command: 'agents' }, () => ({ text: 'built-in' }))
  await $.session.start(START)

  expect((await $.command.run({ ...TOGGLE, command: 'agents' })).text).toBe('built-in')
  expect(world.opens).toEqual([])
})

test('a subagent\'s requests record its effort on its entry, written only when it changes', async ($, on) => {
  const { held, agentWrites } = workflowWorld(on)
  await $.session.start(START)
  await spawn($)
  const before = agentWrites()
  await stepAs($, 'sub-1')
  expect(entryOf(held, 'sub-1')?.effort).toBe('high')
  await stepAs($, 'sub-1', { index: 1 })
  expect(agentWrites()).toBe(before + 1)
  await stepAs($, 'sub-1', { index: 2, effort: 'xhigh' })
  expect(entryOf(held, 'sub-1')?.effort).toBe('xhigh')
  expect(agentWrites()).toBe(before + 2)
  // A step that names none clears it, as the main loop's does.
  await stepAs($, 'sub-1', { index: 3, effort: undefined })
  expect(entryOf(held, 'sub-1')?.effort).toBe(undefined)
})
