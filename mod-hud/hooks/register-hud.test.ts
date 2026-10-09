import type { Hook, Next, On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { HudData } from '../types'
import { hudLines, statusLineText } from './hud'
import { NOW as SKETCH_NOW, full } from './hud.fixtures'
import { register } from './register'
import {
  HUD_KEYS,
  PANE,
  PANE_PROPS,
  SESSION_ROW,
  SPAWN_EVENT,
  START,
  STATUS_ON,
  SURFACES,
  TICK,
  TOGGLE,
  VIEWPORT,
  agentBoxes,
  arrange,
  callTool,
  complete,
  direct,
  entriesOf,
  entryOf,
  lastStatus,
  mountPane,
  paneOf,
  spawn,
  textsOf,
  tickOf,
} from './register.fixtures'
import type { Held } from './register.fixtures'
import { rowSource, textRowOf, textRuns } from './text-svg.fixtures'

// The HUD in the pane and the status line: above the agents with one blank
// row between, its switches, /clear, /mod-hud facts, its clock, the motto.

const NARROW_BELOW = 60
const BODY_ROWS = PANE_PROPS.scroll.bodyRows
const MOTTO = 'ship small, ship often'
// The motto that was the default before 1.2.0; left unset, the motto is now none.
const OLD_MOTTO = 'Don\'t be afraid to do tedious work.'
// The files the sketch's main loop edited, as the hooks keep them: paths, which the HUD counts.
const EDITED_PATHS = Array.from({ length: 7 }, (_, index) => `/Users/daiziqiao/.claude/mods/mod-hud/hooks/file-${index}.ts`)

// The HUD's facts as the hooks keep them, written straight into the host's
// state: the sketch's (docs/pane-sketch.md), every part of it known; the
// edited files as paths, the main loop's activity under `main`, and the
// cache as its TTL (with the session) and its last main request (with the
// usage). The agents' share of the spend is the ledger's, so it is left out.
const seedHud = (held: Held, data: HudData = full): void => {
  for (const key of HUD_KEYS) {
    const raw = data[key as keyof HudData]
    const value = key === 'tools' && data.tools !== undefined
      ? { ...data.tools, edited: EDITED_PATHS.slice(0, data.tools.edited ?? 0) }
      : key === 'usage' && data.usage !== undefined
        ? { ...data.usage, agentShare: undefined, mainRequestAt: data.cache?.lastAt }
        : key === 'session' && data.session !== undefined ? { ...data.session, cacheTtl: data.cache?.ttl } : raw
    if (value !== undefined) held.set(key, { value, version: (held.get(key)?.version ?? 0) + 1 })
  }
  if (data.main !== undefined) held.set('main', { value: data.main, version: (held.get('main')?.version ?? 0) + 1 })
}

// What the pane's HUD draws from those facts at `now`, with the motto configured
// (none unless given). The sketch's two permission asks need running agents that
// ask, so they are left out; the 5h window still runs out before its reset.
const sketchAt = (now: number, motto?: string): HudData => ({ ...full, usage: { ...full.usage!, agentShare: undefined }, alerts: undefined, motto, now })

const layoutOf = (columns: number, rows: number | undefined = BODY_ROWS) => ({ columns, rows, isNarrow: columns < NARROW_BELOW })

// The HUD's facts written, then a session in progress: one agent running, one done.
const sketched = async ($: Engine, on: On) => {
  const arranged = arrange(on, true, SKETCH_NOW)
  await $.session.start(START)
  await arranged.clock.settle()
  seedHud(arranged.held)

  return arranged
}

test('the pane draws the HUD above the agents with one blank row between, on every surface and width', {
  options: { motto: MOTTO },
}, async ($, on) => {
  const { clock } = await sketched($, on)
  await spawn($)
  await spawn($, { tool_use_id: 'tu-2', description: 'Fix it', subagentType: 'general-purpose' })
  await clock.advance(4000)
  await complete($, 'sub-2', { answer: 'Fixed in parser.ts' })

  for (const surface of SURFACES) {
    for (const columns of [100, 56, 48]) {
      const ui = await mountPane($, surface, columns)
      const pane = await paneOf(ui)
      const expected = hudLines(sketchAt(clock.now(), MOTTO), layoutOf(columns))
      // Twenty rows: the HUD takes ten, the least needed rows (the motto among them) left out.
      expect(expected).toHaveLength(10)
      expect(expected[0]).toStartWith('◆ opus 5.5')
      // The TODO section, folded to its progress line, stands between the HUD
      // and the agents; the mascots take the rows it leaves.
      expect(pane.order.slice(0, 3)).toEqual(['hud', 'todos', 'agents'])
      const todoHeader = await ui.find({ key: 'todo:header' })
      // The desktop leaves the Button's cell blank in the row's document.
      expect(surface === 'terminal' ? todoHeader?.text : textRowOf(todoHeader)).toMatch(/^ todo [▸ ] +(━+─+ {2})?3\/5$/)
      expect(pane.gap).toBe(1)
      expect(pane.hud).toEqual(expected)
      expect(pane.rows[expected.length]).toBe('')
      expect(pane.rows[expected.length + 1]).toBe(SESSION_ROW)
      expect(pane.rows[expected.length + 2]).toBe('▾ Agents · 1 running · 1 done')
      expect(pane.board.some(row => row.includes('Find the bug'))).toBe(true)
      expect(pane.board.some(row => row.includes('Fixed in parser.ts'))).toBe(true)
      expect(await agentBoxes(ui)).toHaveLength(2)
      await ui.unmount()
    }
  }
})

test('fifty agents leave the HUD whole: the list keeps its cap and counts the rest', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock } = await sketched($, on)
  const alone = new Map<string, string[]>()
  for (const surface of SURFACES) {
    for (const columns of [100, 48]) {
      const ui = await mountPane($, surface, columns)
      alone.set(`${surface}:${columns}`, (await paneOf(ui)).hud)
      await ui.unmount()
    }
  }

  for (let index = 0; index < 50; index += 1) await spawn($, { tool_use_id: `tu-${index}` })
  for (const surface of SURFACES) {
    for (const columns of [100, 48]) {
      const ui = await mountPane($, surface, columns)
      const pane = await paneOf(ui)
      expect(pane.hud).toEqual(alone.get(`${surface}:${columns}`))
      expect(pane.hud).toEqual(hudLines(sketchAt(clock.now()), layoutOf(columns)))
      expect(pane.hud.length).toBeGreaterThan(0)
      expect((await ui.find({ type: 'Box', key: 'hud' }))?.props.flexShrink).toBe(0)
      expect(pane.gap).toBe(1)
      expect(pane.board[0]).toBe(SESSION_ROW)
      expect(pane.board[1]).toBe('▾ Agents · 50 running · 0 done')
      expect(await agentBoxes(ui)).toHaveLength(40)
      expect(pane.board.at(-1)).toBe('+10 more')
      await ui.unmount()
    }
  }
})

test('docked and inline, the HUD leaves an agent visible within eight rows', async ($, on) => {
  const { clock } = await sketched($, on)
  await spawn($)
  for (const surface of SURFACES) {
    for (const placement of ['dock', 'inline'] as const) {
      const ui = await $.ui.mount({
        plugin: 'mod-hud',
        surface,
        component: 'Pane',
        props: { ...PANE_PROPS, placement, scroll: { offset: 0, bodyRows: 8 } },
        requestId: PANE,
        viewport: VIEWPORT,
      })
      const pane = await paneOf(ui)
      expect(pane.hud).toEqual(hudLines(sketchAt(clock.now()), layoutOf(100, 8)))
      expect(pane.hud).toHaveLength(4)
      expect(pane.rows.slice(0, 8).some(row => row.includes('Find the bug'))).toBe(true)
      await ui.unmount()
    }
  }
})

test('with nothing known the HUD and its blank row are left out, and the board stands alone', async ($, on) => {
  arrange(on)
  await $.session.start({ ...START, cwd: '' })
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    const pane = await paneOf(ui)
    // The session's mascot sleeps in the spare rows under the board.
    expect(pane.order).toEqual(['agents', 'scene-region'])
    expect((await ui.find({ type: 'Client', key: 'mascots' }))?.props.height).toBeGreaterThanOrEqual(4)
    expect(pane.rows).toEqual([SESSION_ROW, '▾ Agents', 'No agents yet.'])
    await ui.unmount()
  }
})

test('the status line is off by default: nothing is pinned under the prompt', async ($, on) => {
  const { clock, world, held } = await sketched($, on)
  await spawn($)
  await complete($, 'sub-1')
  await spawn($, { tool_use_id: 'tu-2' })
  await $.command.run({ ...TOGGLE, args: 'clear' })
  await clock.advance(10_000)
  expect(world.statuses.length).toBeGreaterThan(0)
  expect(world.statuses.every(text => text === undefined)).toBe(true)
  expect(held.get('statusText')?.value ?? null).toBe(null)
  // A closed pane never writes redraw ticks, even while agents reconcile.
  expect(tickOf(held)).toBe(undefined)
})

test('with the status line on, it reads the HUD line, then the agents, and follows the HUD', STATUS_ON, async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const { clock, world } = await sketched($, on)
  await spawn($)
  const hud = statusLineText(sketchAt(clock.now()))
  expect(hud).toBe('opus 5.5 · xhigh │ ⚠ 1 │ ctx 41% │ 5h 31% · 7d 12% │ $4.21 │ main* +3 −1 ↑2 │ todo 3/5 │ cache 42m')
  expect(lastStatus(world)).toBe(`${hud} │ agents · 1 running · 0 done`)

  // A measurement moves the HUD's half without an agent stirring; one that
  // reports no windows (a gateway's response) keeps the last ones.
  await $.session.measure({
    context: { tokens: 500_000, window: 1_000_000, percent: 50 },
    rateLimits: [],
    cost: { usd: 5 },
    changed: ['context', 'rateLimits', 'cost'],
  } as Parameters<Engine['session']['measure']>[0])
  expect(lastStatus(world)).toBe('opus 5.5 · xhigh │ ⚠ 1 │ ctx 50% │ 5h 31% · 7d 12% │ $5.00 │ main* +3 −1 ↑2 │ todo 3/5 │ cache 42m │ agents · 1 running · 0 done')
})

test('switches leave git, tools, todos and the inventory out of the pane and the status line; the motto is the last row', {
  options: { showGit: false, showTools: false, showTodos: false, showInventory: false, motto: '  keep going  ', statusLine: true },
}, async ($, on) => {
  const { clock, world } = await sketched($, on)
  await spawn($)
  // The inventory's auto-compact threshold stays (the runway and the ctx bar's mark read it); its MCP servers and skills go.
  const shown: HudData = { ...sketchAt(clock.now(), 'keep going'), git: undefined, tools: undefined, todos: undefined, inventory: { mcpServers: [], compactAt: full.inventory?.compactAt } }
  expect(lastStatus(world)).toBe(`${statusLineText(shown)} │ agents · 1 running · 0 done`)
  expect(lastStatus(world)).toBe('opus 5.5 · xhigh │ ⚠ 1 │ ctx 41% │ 5h 31% · 7d 12% │ $4.21 │ cache 42m │ agents · 1 running · 0 done')

  for (const surface of SURFACES) {
    for (const columns of [100, 48]) {
      const ui = await mountPane($, surface, columns, 40)
      const pane = await paneOf(ui)
      expect(pane.hud).toEqual(hudLines(shown, layoutOf(columns, 40)))
      expect(pane.hud.at(-1)).toBe('  keep going')
      expect(pane.hud.some(row => /main|mcp|skills|tools|todo/.test(row))).toBe(false)
      expect(await ui.find({ type: 'Box', key: 'hud:tools' })).toBe(undefined)
      expect(await ui.find({ type: 'Box', key: 'hud:todo' })).toBe(undefined)
      await ui.unmount()
    }
  }
})

test('a /clear starts the HUD\'s conversation over and keeps who, where, git and the inventory', async ($, on) => {
  const { clock, held } = await sketched($, on)
  const fact = (key: string): unknown => held.get(key)?.value

  // Any other end leaves the HUD as it is.
  await $.session.end({ reason: 'other', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
  expect(fact('tools')).toEqual({ ...full.tools, edited: EDITED_PATHS })
  expect(fact('usage')).toEqual({ ...full.usage, agentShare: undefined, mainRequestAt: full.cache?.lastAt })

  await $.session.end({ reason: 'clear', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
  expect(fact('tools')).toEqual({ counts: {} })
  expect(fact('todos')).toEqual({ items: [] })
  // The limits' samples stay with their windows; the context's start over.
  expect(fact('usage')).toEqual({ window: 1_000_000, rateLimits: full.usage?.rateLimits, limitSamples: full.usage?.limitSamples, compactions: 0 })
  expect(fact('session')).toEqual({ ...full.session, cacheTtl: full.cache?.ttl, startedAt: clock.now() })
  expect(fact('git')).toEqual(full.git)
  expect(fact('inventory')).toEqual(full.inventory)

  const ui = await mountPane($)
  const pane = await paneOf(ui)
  expect((await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('hud:') === true).map(box => box.key))
    .toEqual(['hud:header', 'hud:alerts', 'hud:gap', 'hud:session.repo', 'hud:session.branch', 'hud:context.used', 'hud:limits.5h', 'hud:limits.7d', 'hud:usage.cost'])
  // The context starts over (its runway, its cache clock and the last turn with it); the 5h
  // window's burn, kept with the window, still runs out before it resets.
  expect(pane.hud[1]).toMatch(/^ {2}⚠ 5h out ~\d\d:\d\d, before ↻\d\d:\d\d$/)
  expect(pane.hud[2]).toBe('')
  expect(pane.hud[5]).toBe(' context  used    —')
  // The engine still reports the old conversation's cost: unknown until a fresh one, the clock from the clear.
  expect(pane.hud[8]).toBe(' usage    cost    —                  00:00')
  expect(pane.board).toEqual([SESSION_ROW, '▾ Agents', 'No agents yet.'])
  await ui.unmount()
})

test('/mod-hud facts shows what the HUD draws from, and whether the last measurement carried rate limits', async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const { clock, world } = await sketched($, on)
  const factsOf = async () => {
    const { text = '' } = await $.command.run({ ...TOGGLE, args: 'facts' })
    const lines = text.split('\n')

    return { data: JSON.parse(lines.slice(0, -1).join('\n')) as HudData, last: lines.at(-1), text }
  }

  // Before any measurement: the facts as held, pretty-printed, and no limits seen.
  const before = await factsOf()
  expect(before.data).toEqual(JSON.parse(JSON.stringify(sketchAt(clock.now()))))
  expect(before.text).toStartWith('{\n  "session": {\n')
  expect(before.last).toBe('No session.measure has arrived since mod-hud loaded, so no rateLimits have been seen.')

  // A measurement that carries no limits (off a subscription, or a gateway's
  // response): the HUD keeps the windows it last saw, and says none came.
  await $.session.measure({
    context: { tokens: 230_000, window: 1_000_000, percent: 23 },
    rateLimits: [],
    cost: { usd: 52.6 },
    changed: ['context', 'cost'],
  } as Parameters<Engine['session']['measure']>[0])
  const none = await factsOf()
  expect(none.data.usage?.rateLimits).toEqual(before.data.usage?.rateLimits)
  expect(none.data.usage?.costUsd).toBe(52.6)
  expect(none.data.usage?.contextPercent).toBe(23)
  expect(none.last).toBe('The last session.measure carried no rateLimits (0).')

  // One that carries them: counted, and their kinds named.
  await $.session.measure({
    context: { tokens: 230_000, window: 1_000_000, percent: 23 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 31 }, { kind: 'seven_day', percentUsed: 12 }],
    cost: { usd: 52.6 },
    changed: ['rateLimits'],
  } as Parameters<Engine['session']['measure']>[0])
  const two = await factsOf()
  expect(two.data.usage?.rateLimits.map(one => one.kind)).toEqual(['five_hour', 'seven_day'])
  expect(two.last).toBe('The last session.measure carried 2 rateLimits (five_hour, seven_day).')

  // Asking for the facts opens nothing.
  expect(world.panes).toEqual([])
  expect(world.opens).toEqual([])
})


test('an open HUD with no agents advances its clock and running-tool row after sixty ticks', async ($, on) => {
  const { clock, world, held } = await sketched($, on)
  await $.command.run(TOGGLE)
  const ui = await mountPane($)
  const before = await paneOf(ui)
  expect(before.hud.some(row => / cost {4}\$4\.21 +\$3\.51 \/ h · 1h 12m$/.test(row))).toBe(true)
  expect(before.hud.some(row => / now {5}Bash · npm test -- hud +00:04$/.test(row))).toBe(true)
  const ticks = world.writes.filter(key => key === TICK).length

  await clock.advance(60_000)
  expect(entriesOf(held)).toEqual({})
  expect(tickOf(held)).toBe(clock.now())
  expect(world.writes.filter(key => key === TICK).length - ticks).toBe(60)
  const after = await paneOf(ui)
  // A minute on, the rate an hour eases as the clock runs.
  expect(after.hud.some(row => / cost {4}\$4\.21 +\$3\.46 \/ h · 1h 13m$/.test(row))).toBe(true)
  expect(after.hud.some(row => / now {5}Bash · npm test -- hud +01:04$/.test(row))).toBe(true)
  await ui.unmount()
  await $.command.run(TOGGLE)
  const reads = world.reads.length
  await clock.advance(10_000)
  expect(world.reads.length).toBe(reads)
})

test('agent glyphs use theme colours on both surfaces and layouts', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock } = arrange(on)
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await spawn($)
  await complete($, 'sub-1')
  await spawn($)
  await complete($, 'sub-2', { reason: 'error' })
  await spawn($)
  // Past the default stall time (240 s): the running agent is drawn stalled.
  await clock.advance(241_000)
  for (const surface of SURFACES) {
    for (const columns of [38, 100]) {
      const ui = await mountPane($, surface, columns)
      const texts = await textsOf(ui)
      for (const [glyph, color] of [['✓', 'success'], ['✗', 'error'], ['◌', 'warning']] as const) {
        expect(texts.find(one => one.text.startsWith(glyph) && one.props.color !== undefined)?.props.color).toBe(color)
      }
      await ui.unmount()
    }
  }
})

test('running agents reconcile with the pane closed and status line off, then stop polling', async ($, on) => {
  const { clock, world, held } = arrange(on)
  await $.session.start(START)
  await spawn($)
  world.agents = [{ id: 'sub-1', description: 'Stopped', type: 'Explore', status: 'killed' }]
  await clock.advance(5000)
  expect(entryOf(held, 'sub-1')?.status).toBe('failed')
  expect(tickOf(held)).toBe(undefined)
  const reads = world.reads.length
  await clock.advance(10_000)
  expect(world.reads.length).toBe(reads)
})

test('clearing finished agents keeps an idle open HUD ticking', async ($, on) => {
  const { clock, held } = arrange(on)
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await spawn($)
  await complete($, 'sub-1')
  await $.command.run({ ...TOGGLE, args: 'clear' })
  await clock.advance(1000)
  expect(entriesOf(held)).toEqual({})
  expect(tickOf(held)).toBe(clock.now())
})


test('a hot reload restarts the open HUD clock even without agents', async () => {
  const d = direct()
  const started = d.next<'session.start'>({ cwd: '/work' })
  await register(d.on, {})
  await d.hook('session.start')(d.$, START, started.run)
  expect(d.entries()).toEqual({})
  expect(d.world.timers).toHaveLength(1)
  await register(d.on, {})
  expect(d.world.timers[0]?.cancelled).toBe(true)
  await d.hook('session.start')(d.$, START, started.run)
  expect(d.world.timers).toHaveLength(2)
  expect(d.world.timers[1]?.cancelled).toBe(false)
})


test('a plain main-loop tool call writes exactly two tools values and nothing else', async ($, on) => {
  const { clock, world } = arrange(on)
  await $.session.start(START)
  await clock.settle()
  const before = world.writes.length
  await callTool($, undefined, 'Read')
  expect(world.writes.slice(before)).toEqual(['tools', 'tools'])
})

test('a HUD renderer throw leaves the agent rows intact', async ($, on) => {
  const d = direct()
  await register(d.on, { motion: 'classic' })
  d.world.now = SKETCH_NOW
  seedHud(d.held)
  await d.hook('agent.spawn')(d.$, SPAWN_EVENT, d.next<'agent.spawn'>({ agentId: 'sub-1' }).run)
  const draw = d.hooks.get(`ui.render${JSON.stringify({ component: 'Pane', requestId: PANE })}`) as Hook<'ui.render'>
  let throws = 0
  d.held.set('usage', { version: 1, value: {
    ...full.usage,
    rateLimits: [{ kind: 'five_hour', get percentUsed(): number { throws += 1; throw new Error('renderer failed') } }],
  } })
  // A getter survives assembleHudData's shallow rate-limit copy, then throws
  // in the renderer. Feed it directly, bypassing the host's JSON state boundary.
  on('ui.render', { component: 'Pane', requestId: 'broken-hud' }, (engine, e, next) => draw({
    ...d.$,
    ui: { ...d.$.ui, resolve: engine.ui.resolve },
  }, e, next as unknown as Next<'ui.render'>))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'mod-hud', surface, component: 'Pane',
      props: PANE_PROPS, requestId: 'broken-hud', viewport: VIEWPORT,
    })
    const pane = await paneOf(ui)
    expect(throws).toBeGreaterThan(0)
    // The TODO section and the scene still stand: neither reads the rate limits.
    expect(pane.order).toEqual(['todos', 'agents', 'mascots'])
    expect(pane.board.some(row => row.includes('Find the bug'))).toBe(true)
    expect(await agentBoxes(ui)).toHaveLength(1)
    await ui.unmount()
  }
})


test('a pane without a known height caps the HUD at five rows', async ($, on) => {
  await sketched($, on)
  await spawn($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'mod-hud', surface, component: 'Pane',
      props: { ...PANE_PROPS, placement: 'inline', scroll: { offset: 0 } } as unknown as typeof PANE_PROPS,
      requestId: PANE, viewport: VIEWPORT,
    })
    const pane = await paneOf(ui)
    expect(pane.hud).toHaveLength(5)
    expect(pane.board.some(row => row.includes('Find the bug'))).toBe(true)
    await ui.unmount()
  }
})

test('the motto left unset draws none: the default is empty since 1.2.0', async ($, on) => {
  await sketched($, on)
  for (const surface of SURFACES) {
    for (const columns of [100, 48]) {
      const ui = await mountPane($, surface, columns, 40)
      expect(await ui.find({ key: 'hud:motto' })).toBe(undefined)
      expect((await paneOf(ui)).hud.at(-1)).toMatch(/^ +cache +\d+% hit$/)
      await ui.unmount()
    }
  }
})

test('a motto set is the HUD\'s last row, dim and italic', { options: { motto: OLD_MOTTO } }, async ($, on) => {
  await sketched($, on)
  for (const surface of SURFACES) {
    for (const columns of [100, 48]) {
      // Forty rows: the HUD has room for every row, the motto the last.
      const ui = await mountPane($, surface, columns, 40)
      expect((await paneOf(ui)).hud.at(-1)).toBe(`  ${OLD_MOTTO}`)
      const motto = surface === 'terminal'
        ? (await ui.findAll({ type: 'Text' })).find(one => one.text === OLD_MOTTO)
        : textRuns(rowSource(await ui.find({ key: 'hud:motto' })) ?? '').find(one => one.text === OLD_MOTTO)
      expect(motto?.props).toEqual({ dimColor: true, italic: true })
      await ui.unmount()
    }
  }
})

test('an empty motto draws none; with nothing else known the motto is no HUD of its own', { options: { motto: '' } }, async ($, on) => {
  await sketched($, on)
  const ui = await mountPane($)
  expect(await ui.find({ key: 'hud:motto' })).toBe(undefined)
  await ui.unmount()
})

test('with nothing known, a motto alone draws no HUD', { options: { motto: OLD_MOTTO } }, async ($, on) => {
  arrange(on)
  await $.session.start({ ...START, cwd: '' })
  const ui = await mountPane($)
  expect(await ui.find({ key: 'hud' })).toBe(undefined)
  expect((await paneOf(ui)).rows).toEqual([SESSION_ROW, '▾ Agents', 'No agents yet.'])
  await ui.unmount()
})

test('the TODO line\'s ▸ opens the list and ▾ folds it: written to listView on a press only, at 100 and 48 columns', { options: { motto: '' } }, async ($, on) => {
  const { held, world } = await sketched($, on)
  for (const surface of SURFACES) {
    for (const columns of [100, 48]) {
      const ui = await mountPane($, surface, columns)
      const rowsOf = async () => (await ui.findAll({ type: 'Box' })).filter(box => /^todo:/.test(box.key ?? '')).map(box => box.key)
      // Folded: the label row and the item in progress, its toggle a Button.
      expect(await rowsOf()).toEqual(['todo:header', 'todo:3'])
      expect((await ui.find({ key: 'todos:toggle' }))?.props.label).toBe('▸')
      const writes = world.writes.filter(key => key === 'listView').length
      await ui.redraw()
      expect(world.writes.filter(key => key === 'listView')).toHaveLength(writes)

      await ui.press({ key: 'todos:toggle' })
      await ui.redraw()
      expect((held.get('listView')?.value as { todosExpanded?: true } | undefined)?.todosExpanded).toBe(true)
      expect(await rowsOf()).toEqual(['todo:header', 'todo:3', 'todo:4', 'todo:0', 'todo:1', 'todo:2'])
      expect((await ui.find({ key: 'todos:toggle' }))?.props.label).toBe('▾')

      await ui.press({ key: 'todos:toggle' })
      await ui.redraw()
      expect((held.get('listView')?.value as { todosExpanded?: true } | undefined)?.todosExpanded).toBe(undefined)
      expect(await rowsOf()).toEqual(['todo:header', 'todo:3'])
      expect(world.writes.filter(key => key === 'listView')).toHaveLength(writes + 2)
      await ui.unmount()
    }
  }
})

test('the alert strip counts asks and stalls from the board and failed calls from the ledger; the status line counts them', { ...STATUS_ON, timeoutMs: 20_000 }, async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const { held, clock, world } = await sketched($, on)
  await spawn($)
  await spawn($, { tool_use_id: 'tu-2', description: 'Fix it', subagentType: 'general-purpose' })
  // One agent waits on a permission ask; the ledger counts two failed calls.
  const board = held.get('agents')?.value as Record<string, Record<string, unknown>>
  held.set('agents', { value: { ...board, 'sub-1': { ...board['sub-1'], awaitingPermission: true } }, version: (held.get('agents')?.version ?? 0) + 1 })
  const ledger = (held.get('ledger')?.value ?? { entries: {}, others: {} }) as Record<string, unknown>
  held.set('ledger', { value: { ...ledger, failures: { denied: 1, error: 1, recent: [clock.now() - 1000, clock.now()] } }, version: (held.get('ledger')?.version ?? 0) + 1 })

  const ui = await mountPane($, 'terminal', 130)
  const alerts = (await paneOf(ui)).hud[1] ?? ''
  expect(alerts).toStartWith('  ⚠ 1 agent waiting for permission · 5h out ~')
  await ui.unmount()
  const wide = await mountPane($, 'terminal', 100)
  expect(await wide.find({ key: 'hud:alerts' })).toBeDefined()
  await wide.unmount()
  // The strip is cut to the card; its counts as data, in full:
  const { text = '' } = await $.command.run({ ...TOGGLE, args: 'facts' })
  expect(JSON.parse(text.split('\n').slice(0, -1).join('\n')).alerts).toEqual({ asks: 1, failures: 2 })

  // Four minutes quiet: both agents stalled too.
  await clock.advance(241_000)
  const later = await $.command.run({ ...TOGGLE, args: 'facts' })
  expect(JSON.parse((later.text ?? '').split('\n').slice(0, -1).join('\n')).alerts).toEqual({ asks: 1, stalled: 2, failures: 2 })
  await $.session.measure({ context: { tokens: 412_000, window: 1_000_000, percent: 41.2 }, rateLimits: [], cost: { usd: 4.21 }, changed: ['cost'] } as Parameters<Engine['session']['measure']>[0])
  expect(lastStatus(world)).toMatch(/^opus 5\.5 · xhigh │ ⚠ \d │ ctx 41%/)
  // The summary says `2 stalled` itself, so the HUD's ⚠ leaves that alert out: the ask, the 5h window and the failures.
  expect(lastStatus(world)).toMatch(/^opus 5\.5 · xhigh │ ⚠ 3 │ .* │ agents · 2 running · 0 done · 2 stalled$/)

  // Ten minutes after the failures, with none since: that alert clears on its own.
  await clock.advance(360_000)
  const cleared = await $.command.run({ ...TOGGLE, args: 'facts' })
  expect(JSON.parse((cleared.text ?? '').split('\n').slice(0, -1).join('\n')).alerts).toEqual({ asks: 1, stalled: 2 })
})

test('a call denied or failed raises the alert for ten minutes; the conversation\'s count stays for the Overview', async ($, on) => {
  const { clock, held, world } = await sketched($, on)
  const alertsNow = async () => JSON.parse(((await $.command.run({ ...TOGGLE, args: 'facts' })).text ?? '').split('\n').slice(0, -1).join('\n')).alerts
  world.tool = async () => ({ deny: 'no' }) as never
  await callTool($, undefined)
  expect(await alertsNow()).toEqual({ failures: 1 })
  await clock.advance(5 * 60_000)
  world.tool = async () => ({ result: 'ok', isError: true }) as never
  await callTool($, undefined)
  expect(await alertsNow()).toEqual({ failures: 2 })
  // Ten minutes after the first: only the second still counts; ten after that, none.
  await clock.advance(5 * 60_000 + 1)
  expect(await alertsNow()).toEqual({ failures: 1 })
  await clock.advance(5 * 60_000)
  expect(await alertsNow()).toBe(undefined)
  expect((held.get('ledger')?.value as { failures?: { denied: number; error: number } }).failures).toMatchObject({ denied: 1, error: 1 })
})

test('with the status line on, a warm cache counts down and reads cold with the pane closed, nothing running and no redraws', STATUS_ON, async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const { clock, world, held } = await sketched($, on)
  // Something the status line shows changed: it is drawn with 42 minutes left (the sketch's last request 18 minutes ago).
  await $.session.measure({ context: { tokens: 412_000, window: 1_000_000, percent: 41.2 }, rateLimits: [], cost: { usd: 4.21 }, changed: ['cost'] } as Parameters<Engine['session']['measure']>[0])
  expect(lastStatus(world)).toMatch(/│ cache 42m$/)
  // No pane, no agents: the board's clock is not running.
  expect(tickOf(held)).toBe(undefined)
  await clock.advance(10 * 60_000)
  expect(lastStatus(world)).toMatch(/│ cache 32m$/)
  // Seventy minutes on, nothing else having happened: cold, not a frozen `cache 1h`.
  await clock.advance(60 * 60_000)
  expect(lastStatus(world)).toMatch(/│ cache cold$/)
  expect(tickOf(held)).toBe(undefined)
  // Cold, its timer is done: nothing more is written.
  const writes = world.statuses.length
  await clock.advance(60 * 60_000)
  expect(world.statuses.length).toBe(writes)
})

// The sketch's usage with no rate-limit windows: no alert of their own.
const QUIET_USAGE = { ...full.usage!, rateLimits: [], limitSamples: undefined }

test('with the status line on, a call denied or failed redraws its ⚠ at once, and the alert leaving its window redraws it again: pane closed, cache cold', STATUS_ON, async ($, on) => {
  const { clock, world, held } = arrange(on, true, SKETCH_NOW)
  await $.session.start(START)
  await clock.settle()
  // The sketch's facts with no main request answered yet (no cache, so no cache
  // timer) and no rate-limit windows (no alert of their own): only failures alert.
  seedHud(held, { ...full, cache: undefined, usage: QUIET_USAGE })
  const alertOf = () => /│ ⚠ (\d+) │/.exec(lastStatus(world) ?? '')?.[1]
  world.tool = async () => ({ deny: 'no' }) as never
  await callTool($, undefined)
  // Nothing else redraws it: the failure itself does, with one more alert than before it.
  expect(lastStatus(world)).not.toMatch(/cache/)
  const raised = Number(alertOf())
  expect(raised).toBe(1)
  expect(tickOf(held)).toBe(undefined)
  // Ten minutes on, the call still counts; a millisecond past them, the status line drops it, by its own timer.
  await clock.advance(10 * 60_000)
  expect(Number(alertOf())).toBe(raised)
  await clock.advance(1)
  expect(Number(alertOf() ?? 0)).toBe(raised - 1)
  expect(tickOf(held)).toBe(undefined)
  // Nothing counted and the cache cold: its timer is done.
  const writes = world.statuses.length
  await clock.advance(60 * 60_000)
  expect(world.statuses.length).toBe(writes)
})

test('the status line\'s timer runs for the earlier of the cache\'s minute and the oldest failure\'s expiry, and on for the failure once the cache is cold', STATUS_ON, async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const { clock, world, held } = arrange(on, true, SKETCH_NOW)
  await $.session.start(START)
  await clock.settle()
  // A 5-minute cache, its last request just answered.
  seedHud(held, { ...full, cache: { ttl: '5m', lastAt: SKETCH_NOW }, usage: QUIET_USAGE })
  world.tool = async () => ({ result: 'boom', isError: true }) as never
  await clock.advance(30_000)
  await callTool($, undefined)
  const alertOf = () => Number(/│ ⚠ (\d+) │/.exec(lastStatus(world) ?? '')?.[1] ?? 0)
  const raised = alertOf()
  expect(raised).toBe(1)
  expect(lastStatus(world)).toMatch(/│ cache 5m$/)
  // The cache's minutes come first: each redraws on its own.
  await clock.advance(30_000)
  expect(lastStatus(world)).toMatch(/│ cache 4m$/)
  await clock.advance(4 * 60_000)
  expect(lastStatus(world)).toMatch(/│ cache cold$/)
  expect(alertOf()).toBe(raised)
  // Cold (4½ minutes after the failure), the timer runs on for it: ten minutes after it, the ⚠ drops it.
  await clock.advance(10 * 60_000 - 270_000)
  expect(alertOf()).toBe(raised)
  await clock.advance(1)
  expect(alertOf()).toBe(raised - 1)
  const writes = world.statuses.length
  await clock.advance(60 * 60_000)
  expect(world.statuses.length).toBe(writes)
})
