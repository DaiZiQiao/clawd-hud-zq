import type { Hook, Next, On, UiPane } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { AgentBoardEntry, HudData, HudMainFacts } from '../types'
import { alertsOf, hudLines } from './hud'
import { CROWN, FRAME_TABLES, HEADS, SLOT, TORSOS } from './mascot-sprites'
import { register } from './register'
import { PALETTE, SCENE_COLOURS, colourFor, sceneOf } from './scene-model'
import { DONE_HOLD, NOW, entry, idleHud, trio, working } from './scene-model.fixtures'
import { PACK_TICKS, SCENE_FRAME_MS, phaseOf } from './scene-phases'
import { mascotLines } from './scene-render'
import { textsIn } from './scene-render.fixtures'
import type { Described } from './scene-render.fixtures'
import { svgCells, svgRows } from './scene-svg.fixtures'
import type { MascotLayout } from './scene-types'
import { stateCells } from './test-state'
import type { Held } from './test-state'
import { svgsOf, textRowsOf, textRuns } from './text-svg.fixtures'
import { displayWidth } from './text-width'

// The scene in the hooks: the pane's order, slots across redraws, the scene
// clock, raised hands for permission asks, workflow agents in the pane.

describe('the scene clock', () => {
  test('the frame clock writes only sceneTick while mascots wander and act: nothing per frame otherwise', async ($, on) => {
    const held = new Map<string, { value: unknown; version: number }>()
    const intervals: { ms: number; fn: () => void; cancelled: boolean }[] = []
    let now = NOW
    const panes = [{ id: 'hud', title: 'HUD', isShown: true, isFocused: false, isPlaced: true }]
    const hooks = new Map<string, unknown>()
    const fake = {
      state: {
        get: async ({ key }: { key: string }) => held.get(key) ?? { value: undefined, version: 0 },
        set: async ({ key }: { key: string }, value: unknown) => {
          const version = (held.get(key)?.version ?? 0) + 1
          held.set(key, { value, version })

          return { isSet: true, version }
        },
      },
      agent: { list: async () => [] },
      clock: {
        now: async () => now,
        every: (ms: number, fn: () => void) => {
          const timer = { ms, fn, cancelled: false }
          intervals.push(timer)

          return { cancel: () => void (timer.cancelled = true) }
        },
        after: () => ({ cancel: () => {} }),
      },
      ui: { panes: async () => panes, status: () => {}, log: () => {} },
    }
    await register(((name: string, ...args: unknown[]) => {
      hooks.set(`${name}${args.length > 1 ? JSON.stringify(args[0]) : ''}`, args[args.length - 1])

      return { catch: () => {} }
    }) as never, { motion: 'classic' })
    held.set('agents', { value: { a: entry('a'), b: entry('b'), c: entry('c', { status: 'done', endedAt: NOW }) }, version: 1 })
    const draw = hooks.get(`ui.render${JSON.stringify({ component: 'Pane', requestId: 'hud' })}`) as Hook<'ui.render'>
    on('ui.render', { component: 'Pane', requestId: 'frames' }, (host, e, next) => draw({ ...fake, ui: { ...fake.ui, resolve: host.ui.resolve } } as never, e, next as unknown as Next<'ui.render'>))
    const ui = await $.ui.mount({ plugin: 'mod-hud', surface: 'terminal', component: 'Pane', requestId: 'frames', props: { title: 'HUD', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }, viewport: { columns: 160, rows: 40, isFullscreen: true } })
    const fast = intervals.find(one => one.ms === SCENE_FRAME_MS && !one.cancelled)
    expect(fast).toBeDefined()
    const before = new Map([...held].map(([key, one]) => [key, one.version]))
    for (let frame = 0; frame < 40; frame += 1) {
      now += SCENE_FRAME_MS
      fast!.fn()
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
      await ui.redraw()
    }
    expect([...held.keys()].filter(key => held.get(key)?.version !== before.get(key))).toEqual(['sceneTick'])
    await ui.unmount()
  })
})

const SURFACES = ['terminal', 'desktop'] as const

const SECOND = 1000

const layout = (columns: number, rows = 8, tick = 0): MascotLayout => ({ columns, rows, tick })

const VIEWPORT = { columns: 160, rows: 40, isFullscreen: true }
const PANE_PROPS = { title: 'HUD', isFocused: false, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

const shownText = (node: unknown): string => {
  if (typeof node === 'string') return node
  if (typeof node !== 'object' || node === null) return ''

  return ((node as Described).children ?? []).map(shownText).join('')
}

/** A found element's text as a person reads it: its rows in pixels read back on the desktop, else its own. */
const readText = (node: { text: string } | undefined): string | undefined => {
  const pixels = textRowsOf(node)

  return pixels.length > 0 ? pixels.join('\n') : node?.text
}

const PANE = 'hud'
const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const
const TOGGLE = { command: 'mod-hud', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const
const HUD_KEYS = ['session', 'usage', 'git', 'tools', 'todos', 'inventory'] as const

// The engine beneath the plugin, as a session answers it: state in memory, a
// clock the test moves, panes, agents, tools and turns.
const arrange = (on: On) => {
  const clock = mock.clock(on, { now: NOW })
  const held: Held = new Map()
  const world = {
    panes: [] as UiPane[],
    writes: [] as string[],
    spawned: 0,
    tool: async (): Promise<{ result: unknown }> => ({ result: 'ok' }),
  }
  stateCells(on, held, world.writes)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => {
    world.panes = [{ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true }]

    return { value: { isPlaced: true as const } }
  })
  on('ui.close', () => {
    world.panes = []

    return { value: undefined }
  })
  on('ui.panes', () => ({ value: world.panes }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', () => {
    world.spawned += 1

    return { model: 'claude-sonnet-5-5', agentId: `sub-${world.spawned}` }
  })
  on('tool.call', () => world.tool())
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })
  on('session.compact', () => ({ messages: [{ role: 'assistant', text: 'summary', toolUses: [] }] }) as never)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))

  const board = (): Record<string, AgentBoardEntry> => (held.get('agents')?.value ?? {}) as Record<string, AgentBoardEntry>
  const main = (): HudMainFacts | undefined => held.get('main')?.value as HudMainFacts | undefined

  return { clock, world, held, board, main }
}

const seedHud = (held: Map<string, { value: unknown; version: number }>, data: HudData): void => {
  for (const key of HUD_KEYS) {
    const value = data[key]
    if (value !== undefined) held.set(key, { value, version: (held.get(key)?.version ?? 0) + 1 })
  }
}

const spawn = ($: Engine, subagentType = 'Explore', parentAgentId?: string) =>
  $.agent.spawn({
    tool_use_id: `tu-${subagentType}`,
    prompt: 'look around',
    description: `Work as ${subagentType}`,
    subagentType,
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
    ...(parentAgentId === undefined ? {} : { parentAgentId }),
  } as Parameters<Engine['agent']['spawn']>[0])

const step = async ($: Engine, extra: Record<string, unknown> = {}) => {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3, ...extra } as Parameters<Engine['turn']['step']>[0])
  for await (const _chunk of stream) {
    // Drained.
  }
}

const completeTurn = ($: Engine, extra: Record<string, unknown> = {}) =>
  $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', ...extra } as Parameters<Engine['turn']['complete']>[0])

const mountPane = ($: Engine, surface: (typeof SURFACES)[number], bodyColumns: number, bodyRows: number) =>
  $.ui.mount({
    plugin: 'mod-hud',
    surface,
    component: 'Pane',
    props: { ...PANE_PROPS, bodyColumns, scroll: { offset: 0, bodyRows } },
    requestId: PANE,
    viewport: VIEWPORT,
  })

type Drawing = Awaited<ReturnType<typeof mountPane>>

const orderOf = async (ui: Drawing): Promise<unknown[]> => {
  await ui.redraw()
  const root = await ui.find({ type: 'Box' })

  return ((root?.children ?? []) as Described[]).map(child => child.props?.key)
}

/** The absolute Boxes beneath a found element that hold a pick Button: where each pick is laid. */
const picksIn = (node: unknown): { top: number; left: number; label: string }[] => {
  if (typeof node !== 'object' || node === null) return []
  const one = node as Described
  const button = one.props?.position === 'absolute' ? (one.children ?? []).find(child => (child as Described).type === 'Button') as Described | undefined : undefined

  return [
    ...(button === undefined ? [] : [{ top: Number(one.props?.top), left: Number(one.props?.left), label: String(button.props?.label) }]),
    ...(one.children ?? []).flatMap(picksIn),
  ]
}

/** The scene's rows as text: its keyed Box rows, or on the desktop its Svg read back into cells, each pick's label laid where its Button is. */
const sceneRows = async (ui: Drawing): Promise<{ text: string }[]> => {
  await ui.redraw()
  // The scene's own Svg: the desktop draws the pane's text rows in Svgs too.
  const svg = svgsOf(await ui.find({ type: 'Box', key: 'mascots' }))[0]
  if (svg === undefined) return (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('mascots:') === true)
  const rows = svgRows(String(svg.props?.source)).map(row => [...row])
  for (const pick of picksIn(await ui.find({ type: 'Box', key: 'mascots' }))) {
    const row = rows[pick.top]
    if (row === undefined) continue
    while (row.length <= pick.left) row.push(' ')
    row[pick.left] = pick.label
  }

  return rows.map(row => ({ text: row.join('') }))
}

/** The colours the scene draws its sprites in: its Texts' on the terminal, its Svg's fills on the desktop. */
const sceneColours = async (ui: Drawing): Promise<Set<string>> => {
  const svg = svgsOf(await ui.find({ type: 'Box', key: 'mascots' }))[0]
  if (svg !== undefined) return new Set(svgCells(String(svg.props?.source)).cells.flat().flatMap(cell => (cell === undefined ? [] : [cell.fill])))

  return new Set(textsIn(await ui.find({ type: 'Box', key: 'mascots' })).flatMap(text => (typeof text.props?.color === 'string' ? [text.props.color] : [])))
}

describe('in the pane', () => {
  test('HUD, TODO, agents, then the scene: three running agents at 72×36, none at 72×12', { options: { wander: false, motion: 'classic' } }, async ($, on) => {
    const { clock, held } = arrange(on)
    await $.session.start(START)
    await clock.settle()
    seedHud(held, idleHud)
    // The TODO section opened: its header and five items.
    held.set('listView', { value: { todosExpanded: true }, version: 1 })
    await $.command.run(TOGGLE)
    for (const type of ['Explore', 'general-purpose', 'Explore']) await spawn($, type)
    // Past their arrival: all three stand in their slots, thinking (quiet under six seconds, so not idle yet).
    await clock.advance(5 * SECOND)
    const hudRows = hudLines({ ...idleHud, motto: undefined, now: clock.now() }, { columns: 72, rows: 36, isNarrow: false }).length

    for (const surface of SURFACES) {
      const ui = await mountPane($, surface, 72, 36)
      expect(await orderOf(ui)).toEqual(['hud', 'todos', 'agents', 'mascots'])
      // The scene stands in what is left (the 1.2.0 HUD is taller): 36 rows, less the HUD and its blank
      // row, the TODO section (header, five items) and its blank row, the
      // header and three agents, and the blank row above the scene.
      const spare = 36 - (hudRows + 1) - (6 + 1) - 4 - 1
      const rows = await sceneRows(ui)
      expect(spare).toBeGreaterThanOrEqual(4)
      // One line of four rows, and the sky row above it while a thought's (hmm) floats there.
      expect(rows.length).toBeGreaterThanOrEqual(4)
      expect(rows.length).toBeLessThanOrEqual(spare)
      const sky = rows.length - 4
      // The session watching, crowned, and three agents in spawn order a slot apart, thinking away from their laptops: eyes up, a thought beside.
      expect(rows[sky]?.text.slice(5, 8)).toBe(CROWN.art)
      expect(rows[sky + 1]?.text.slice(0, 11)).toBe(`  ${HEADS.right}`)
      expect(rows[sky + 1]?.text.match(new RegExp(HEADS.up.slice(1, 8), 'g'))).toHaveLength(3)
      expect(rows[sky + 2]?.text.match(/▝▜█████▛▘/g)).toHaveLength(4)
      expect([20, 38, 56].map(x => rows[sky + 2]?.text.slice(x, x + 9))).toEqual([TORSOS.rest, TORSOS.rest, TORSOS.rest])
      for (const id of ['sub-1', 'sub-2', 'sub-3']) {
        // The agent's name in the list, and its mascot, share its colour.
        const row = await ui.find({ key: `agent:${id}` })
        const name = textsIn(row).find(text => text.props?.color === colourFor(id))
        expect(shownText(name).trim(), id).toMatch(/^(Explore|general-purpose)$/)
        expect((await sceneColours(ui)).has(colourFor(id)), id).toBe(true)
      }
      await ui.unmount()

      const short = await mountPane($, surface, 72, 12)
      expect(await orderOf(short)).toEqual(['hud', 'todos', 'agents'])
      expect(await sceneRows(short)).toHaveLength(0)
      await short.unmount()
    }
  })

  test('the pane keeps slots across redraws; a finished agent goes up its pipe where it stands, the other stays put', { options: { wander: false, scenes: false, motion: 'classic' } }, async ($, on) => {
    const { clock, held } = arrange(on)
    await $.session.start(START)
    await clock.settle()
    seedHud(held, idleHud)
    held.set('agents', { value: {
      done: entry('done', { status: 'done', endedAt: NOW, startedAt: NOW - 10_000 }),
      stay: entry('stay', { startedAt: NOW - 5000 }),
    }, version: 1 })
    await $.command.run(TOGGLE)
    const panes = await Promise.all(SURFACES.map(surface => mountPane($, surface, 72, 30)))
    // Each pick button (between an agent's feet), counted from the scene's floor: the rows above it come and go with the sky.
    const picks = panes.map(() => [] as Set<string>[])
    let piped = 0
    for (let tick = 0; tick <= DONE_HOLD + 20; tick += 1) {
      if (tick > 0) await clock.advance(SCENE_FRAME_MS)
      for (const [index, ui] of panes.entries()) {
        const rows = await sceneRows(ui)
        picks[index]!.push(new Set(rows.flatMap((row, y) => [...row.text].flatMap((ch, x) => (ch === '▾' ? [`${rows.length - y},${x}`] : [])))))
        if (rows.some(row => row.text.includes('█████████'))) piped += 1
        expect((await sceneRows(ui)).map(row => row.text)).toEqual(rows.map(row => row.text))
      }
    }
    for (const frames of picks) {
      // Both stand at first; at the end the one that stays, in the very place it stood throughout.
      expect(frames[0]?.size).toBe(2)
      const stay = [...frames.at(-1)!]
      expect(stay).toHaveLength(1)
      frames.forEach((frame, tick) => expect(frame.has(stay[0]!), `frame ${tick}`).toBe(true))
    }
    // The pipe came for the finished one.
    expect(piped).toBeGreaterThan(0)
    for (const ui of panes) await ui.unmount()
  })

  test('agent rows label singular and plural calls wide, compact counts narrow', async ($, on) => {
    const { held } = arrange(on)
    for (const calls of [1, 91]) {
      held.set('agents', { value: { counted: entry('counted', { toolCalls: calls, currentTool: 'Read' }) }, version: calls })
      for (const surface of SURFACES) {
        const wide = await mountPane($, surface, 72, 30)
        const row = readText(await wide.find({ key: 'agent:counted' }))
        expect(row).toContain(`${calls} call${calls === 1 ? '' : 's'}`)
        expect(row).not.toContain(`${calls}×`)
        await wide.unmount()
        const narrow = await mountPane($, surface, 40, 30)
        expect(readText(await narrow.find({ key: 'agent:counted' }))).toContain(`${calls}c · Read`)
        await narrow.unmount()
      }
    }
  })

  test('with mascots off, no scene, no name colours, and nothing written for them; the header\'s working/idle cell still is', {
    options: { mascots: false },
  }, async ($, on) => {
    const { clock, world, main } = arrange(on)
    await $.session.start(START)
    await clock.settle()
    await spawn($)
    await step($)
    // The main loop at work: one write, read by the header.
    expect(main()).toEqual({ busySince: clock.now() })
    const { text = '' } = await $.command.run({ ...TOGGLE, args: 'facts' })
    const data = JSON.parse(text.split('\n').slice(0, -1).join('\n')) as HudData
    expect(data.main).toEqual({ busySince: clock.now() })
    expect(hudLines(data, { columns: 72, isNarrow: false })[0]).toMatch(/● working 00:00$/)
    await completeTurn($)
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'x', toolUses: [] }] } as Parameters<Engine['session']['compact']>[0])
    // Busy, then idle: two writes, and no compaction stamp (that one is the mascot's alone).
    expect(world.writes.filter(key => key === 'main')).toHaveLength(2)
    expect(main()).toEqual({ idleSince: clock.now() })
    for (const surface of SURFACES) {
      const ui = await mountPane($, surface, 72, 30)
      expect(await orderOf(ui)).toEqual(['hud', 'agents'])
      const row = await ui.find({ key: 'agent:sub-1' })
      expect(textsIn(row).some(text => text.props?.color === colourFor('sub-1'))).toBe(false)
      await ui.unmount()
    }
  })

  test('the session mascot wakes for a main turn, sleeps after it, and stretches after a compaction: one write each', { options: { wander: false, motion: 'classic' } }, async ($, on) => {
    const { clock, world, main } = arrange(on)
    await $.session.start(START)
    await clock.settle()
    // Tall enough for the scene once a step names the model and the HUD grows.
    const ui = await mountPane($, 'terminal', 40, 16)
    const scene = async () => (await sceneRows(ui)).map(row => row.text)
    const head = async () => (await scene()).find(row => /▐[▛▜▙▟█▬@ø][▜▛█]█[▜▛█][▜▛▙▟█▬@ø]▌/.test(row)) ?? ''
    const writes = () => world.writes.filter(key => key === 'main').length

    // Idle: its bits, no thought.
    expect(await head()).not.toBe('')
    expect((await scene()).join('\n')).not.toMatch(/[·∘]|\(hmm\)/)
    await step($)
    await step($, { index: 1 })
    // A subagent's request is not the main loop's.
    await step($, { index: 0, agentId: 'sub-9' })
    expect(main()).toEqual({ busySince: NOW })
    expect(writes()).toBe(1)
    // Eyes up at its thought, rising beside its head; the crown keeps the row above.
    expect(await head()).toBe(`  ${HEADS.up}·`)

    await clock.advance(2 * SECOND)
    await completeTurn($)
    await completeTurn($, { agentId: 'sub-9' })
    expect(main()).toEqual({ idleSince: NOW + 2 * SECOND })
    expect(writes()).toBe(2)
    // Another end with nothing at work writes nothing.
    await completeTurn($)
    expect(writes()).toBe(2)
    expect((await scene()).join('\n')).not.toMatch(/[·∘]|\(hmm\)/)

    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'x', toolUses: [] }] } as Parameters<Engine['session']['compact']>[0])
    expect(main()?.compactedAt).toBe(clock.now())
    expect(writes()).toBe(3)
    // The stretch: arms up beside the head, eyes shut; the crown on its head as ever.
    expect(await head()).toBe(`  ▐${HEADS.shut.slice(1, 8)}▌`)
    expect((await scene()).join('\n')).toContain(`     ${CROWN.art}`)
    await ui.unmount()
  })

})

// The test engine's `$.tool.call` does not raise `tool.check`, so the plugin's
// own hooks are called here as a session calls them: `tool.check` inside the
// call's `tool.call`, carrying the call's tool_use_id. A fake `$` holds state.
const direct = () => {
  const hooks = new Map<string, unknown>()
  const on = ((name: string, ...args: unknown[]) => {
    hooks.set(`${name}${args.length > 1 ? JSON.stringify(args[0]) : ''}`, args[args.length - 1])

    return { catch: () => {} }
  }) as On
  const held = new Map<string, { value: unknown; version: number }>()
  const world = { now: NOW, failReads: new Set<string>(), panes: [] as UiPane[], lists: 0, intervals: [] as { ms: number; fn: () => void; cancelled: boolean }[] }
  const timers: { at: number; fn: () => void; cancelled: boolean }[] = []
  const advance = async (ms: number) => {
    world.now += ms
    for (const timer of timers.filter(one => !one.cancelled && one.at <= world.now)) {
      timer.cancelled = true
      timer.fn()
    }
    for (let index = 0; index < 40; index += 1) await Promise.resolve()
  }
  const $ = {
    state: {
      get: async ({ key }: { key: string }) => {
        if (world.failReads.has(key)) throw new Error(`${key} refused`)

        return held.get(key) ?? { value: undefined, version: 0 }
      },
      set: async ({ key }: { key: string }, value: unknown, options?: { ifVersion?: number }) => {
        const before = held.get(key)?.version ?? 0
        if (options?.ifVersion !== undefined && options.ifVersion !== before) return { isSet: false, version: before }
        held.set(key, { value, version: before + 1 })

        return { isSet: true, version: before + 1 }
      },
    },
    agent: { list: async () => { world.lists += 1; return [] } },
    clock: {
      now: async () => world.now,
      every: (ms: number, fn: () => void) => {
        const timer = { ms, fn, cancelled: false }
        world.intervals.push(timer)

        return { cancel: () => void (timer.cancelled = true) }
      },
      after: (ms: number, fn: () => void) => {
        const timer = { at: world.now + ms, fn, cancelled: false }
        timers.push(timer)

        return { cancel: () => void (timer.cancelled = true) }
      },
    },
    ui: { panes: async () => world.panes, status: () => {}, log: () => {} },
  } as unknown as Parameters<Hook<'tool.call'>>[0]
  const board = (): Record<string, AgentBoardEntry> => (held.get('agents')?.value ?? {}) as Record<string, AgentBoardEntry>

  return { on, hooks, $, board, held, world, timers, advance }
}

const pendingCall = async (d: ReturnType<typeof direct>, id: string, verdict: unknown = { decision: 'ask' }, agentId = 'sub-1') => {
  const call = d.hooks.get('tool.call') as Hook<'tool.call'>
  const check = d.hooks.get('tool.check') as Hook<'tool.check'>
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const pending = new Promise<void>(resolve => { release = resolve })
  const running = call(d.$, { tool: 'Read', file_path: '/work/a.ts', tool_use_id: id, agentId } as never, (async () => {
    await check(d.$, { tool: 'Read', input: {}, tool_use_id: id } as never, (async () => verdict) as never)
    entered()
    await pending

    return { result: 'ok' }
  }) as never)
  await started

  return async () => { release(); await running }
}

const askingBoard = async () => {
  const d = direct()
  await register(d.on, {})
  d.held.set('agents', { value: { 'sub-1': entry('sub-1') }, version: 1 })

  return d
}

describe('review regressions', () => {
  test('classifier-settled asks never raise a hand; a pending ask waits three seconds', async () => {
    const d = await askingBoard()
    const finish = await pendingCall(d, 'fast')
    expect(d.board()['sub-1']?.awaitingPermission).toBe(undefined)
    await d.advance(2999)
    expect(d.board()['sub-1']?.awaitingPermission).toBe(undefined)
    await finish()
    await d.advance(1)
    expect(d.board()['sub-1']?.awaitingPermission).toBe(undefined)
    const finishSlow = await pendingCall(d, 'slow')
    await d.advance(2999)
    expect(d.board()['sub-1']?.awaitingPermission).toBe(undefined)
    await d.advance(1)
    expect(d.board()['sub-1']?.awaitingPermission).toBe(true)
    await finishSlow()
    expect(d.board()['sub-1']?.awaitingPermission).toBe(undefined)
  })

  test('unrelated and overlapping call ends preserve the remaining asking call', async () => {
    const d = await askingBoard()
    const first = await pendingCall(d, 'ask-1')
    const second = await pendingCall(d, 'ask-2')
    const unrelated = await pendingCall(d, 'allowed', { decision: 'allow' })
    await d.advance(3000)
    await unrelated()
    expect(d.board()['sub-1']?.awaitingPermission).toBe(true)
    await first()
    expect(d.board()['sub-1']?.awaitingPermission).toBe(true)
    await second()
    expect(d.board()['sub-1']?.awaitingPermission).toBe(undefined)
  })

  test('asking wins over stalled for full and mini mascots', () => {
    for (const parentId of [undefined, 'parent']) {
      const agent = working('ask', 'asking', { status: 'stalled', parentId })
      expect(phaseOf(agent)).toEqual({ kind: 'work' })
      const scene = { main: { mood: 'watching' as const, sweating: false }, agents: [...(parentId ? [working(parentId, 'thinking')] : []), agent] }
      expect(mascotLines(scene, layout(72, 4))?.join('\n')).toContain('?')
    }
  })

  test('a visible scene has exactly one 250 ms clock writing only sceneTick, cancelled on close', async ($, on) => {
    const d = direct()
    await register(d.on, { motion: 'classic' })
    const draw = d.hooks.get(`ui.render${JSON.stringify({ component: 'Pane', requestId: PANE })}`) as Hook<'ui.render'>
    on('ui.render', { component: 'Pane', requestId: 'scene-clock' }, (host, e, next) => draw({ ...d.$, ui: { ...d.$.ui, resolve: host.ui.resolve } }, e, next as unknown as Next<'ui.render'>))
    d.world.panes = [{ id: PANE, title: 'HUD', isShown: true, isFocused: false, isPlaced: true }]
    const ui = await $.ui.mount({ plugin: 'mod-hud', surface: 'terminal', component: 'Pane', requestId: 'scene-clock', props: PANE_PROPS, viewport: VIEWPORT })
    await ui.redraw()
    await ui.redraw()
    const fast = d.world.intervals.filter(timer => timer.ms === 250 && !timer.cancelled)
    expect(fast).toHaveLength(1)
    expect(d.world.intervals.filter(timer => timer.ms === 1000 && !timer.cancelled)).toHaveLength(1)
    const before = new Map(d.held)
    for (let index = 0; index < 8; index += 1) {
      d.world.now += 250
      fast[0]!.fn()
      await d.advance(0)
      await ui.redraw()
    }
    expect([...d.held.keys()].filter(key => d.held.get(key)?.version !== before.get(key)?.version)).toEqual(['sceneTick'])
    expect(d.held.get('sceneTick')?.version).toBe(8)
    expect(d.world.lists).toBe(0)
    expect(d.timers).toHaveLength(0)
    d.world.panes = []
    const close = d.hooks.get(`ui.close${JSON.stringify({ id: PANE })}`) as Hook<'ui.close'>
    await close(d.$, { id: PANE } as never, (async () => ({})) as never)
    expect(fast[0]?.cancelled).toBe(true)
    const after = d.held.get('sceneTick')?.version
    fast[0]!.fn()
    await d.advance(0)
    expect(d.held.get('sceneTick')?.version).toBe(after)
    await ui.unmount()
  })

  test('scene clock stops when spare rows disappear and restarts once; hiding also cancels it', async ($, on) => {
    const d = direct()
    await register(d.on, { motion: 'classic' })
    let bodyRows = 30
    const draw = d.hooks.get(`ui.render${JSON.stringify({ component: 'Pane', requestId: PANE })}`) as Hook<'ui.render'>
    on('ui.render', { component: 'Pane', requestId: 'resize-clock' }, (host, e, next) => draw({ ...d.$, ui: { ...d.$.ui, resolve: host.ui.resolve } }, {
      ...e, props: { ...e.props, scroll: { offset: 0, bodyRows } },
    }, next as unknown as Next<'ui.render'>))
    d.world.panes = [{ id: PANE, title: 'HUD', isShown: true, isFocused: false, isPlaced: true }]
    const ui = await $.ui.mount({ plugin: 'mod-hud', surface: 'terminal', component: 'Pane', requestId: 'resize-clock', props: PANE_PROPS, viewport: VIEWPORT })
    const active = () => d.world.intervals.filter(one => one.ms === 250 && !one.cancelled)
    expect(active()).toHaveLength(1)
    bodyRows = 6
    await ui.redraw()
    // The existing clock sees no recent classic reader and cancels itself.
    active()[0]!.fn()
    await d.advance(0)
    expect(active()).toHaveLength(0)
    bodyRows = 30
    await ui.redraw()
    await ui.redraw()
    expect(active()).toHaveLength(1)
    d.world.panes[0] = { ...d.world.panes[0]!, isShown: false }
    active()[0]!.fn()
    await d.advance(0)
    expect(active()).toHaveLength(0)
    expect(d.held.has('sceneTick')).toBe(false)
    await ui.unmount()
  })

  test('closed, hidden, short and mascot-disabled panes never start a scene clock', async ($, on) => {
    let draw: Hook<'ui.render'>
    let engine: ReturnType<typeof direct>['$']
    on('ui.render', { component: 'Pane', requestId: 'no-scene-clock' }, (host, e, next) => draw({ ...engine, ui: { ...engine.ui, resolve: host.ui.resolve } }, e, next as unknown as Next<'ui.render'>))
    for (const [mascots, open, shown, rows] of [[true, false, true, 30], [true, true, false, 30], [false, true, true, 30], [true, true, true, 6]] as const) {
      const d = direct()
      await register(d.on, { mascots, motion: 'classic' })
      d.world.panes = open ? [{ id: PANE, title: 'HUD', isShown: shown, isFocused: false, isPlaced: true }] : []
      draw = d.hooks.get(`ui.render${JSON.stringify({ component: 'Pane', requestId: PANE })}`) as Hook<'ui.render'>
      engine = d.$
      const ui = await $.ui.mount({ plugin: 'mod-hud', surface: 'terminal', component: 'Pane', requestId: 'no-scene-clock', props: { ...PANE_PROPS, scroll: { offset: 0, bodyRows: rows } }, viewport: VIEWPORT })
      expect(d.world.intervals.filter(timer => timer.ms === 250 && !timer.cancelled)).toHaveLength(0)
      await ui.unmount()
    }
  })

  test('mascots on and off leave identical HUD and agent trees apart from name colour', async ($, on) => {
    let draw: Hook<'ui.render'>
    let engine: ReturnType<typeof direct>['$']
    on('ui.render', { component: 'Pane', requestId: 'equivalence' }, (host, e, next) => draw({
      ...engine, ui: { ...engine.ui, resolve: host.ui.resolve },
    }, e, next as unknown as Next<'ui.render'>))
    const withoutNameColour = (node: unknown): unknown => {
      if (typeof node !== 'object' || node === null) return node
      const one = node as Described
      if (one.type === 'Text' && PALETTE.includes(one.props?.color as typeof PALETTE[number])) return shownText(one)
      // A row in pixels: its runs read back, a name in its mascot's colour taking the colour of the run before it (its glyph's), as a name without one inherits it.
      if (one.type === 'Svg') {
        const runs = textRuns(String(one.props?.source ?? ''))
        let inherited: unknown

        return { type: 'Svg', alt: one.props?.alt, width: one.props?.width, runs: runs.map(run => {
          const named = PALETTE.includes(run.props.color as typeof PALETTE[number])
          if (!named) inherited = run.props.color

          return named ? { ...run, props: { ...run.props, color: inherited } } : run
        }) }
      }
      const children: unknown[] = []
      for (const child of (one.children ?? []).map(withoutNameColour)) {
        if (typeof child === 'string' && typeof children.at(-1) === 'string') children[children.length - 1] += child
        else children.push(child)
      }

      return { type: one.type, props: one.props, children }
    }
    for (const columns of [40, 72, 100]) {
      for (const surface of SURFACES) {
        const trees: unknown[] = []
        for (const mascots of [false, true]) {
          const d = direct()
          await register(d.on, { mascots, motion: 'classic' })
          seedHud(d.held, idleHud)
          d.held.set('agents', { value: Object.fromEntries(trio.map(one => [one.id, one])), version: 1 })
          engine = d.$
          draw = d.hooks.get(`ui.render${JSON.stringify({ component: 'Pane', requestId: PANE })}`) as Hook<'ui.render'>
          const ui = await $.ui.mount({ plugin: 'mod-hud', surface, component: 'Pane', requestId: 'equivalence', props: { ...PANE_PROPS, bodyColumns: columns }, viewport: VIEWPORT })
          trees.push([withoutNameColour(await ui.find({ key: 'hud' })), withoutNameColour(await ui.find({ key: 'agents' }))])
          await ui.unmount()
        }
        expect(trees[1], `${surface} @${columns}`).toEqual(trees[0])
      }
    }
  })

  test('missing check verdicts pass through without throwing', async () => {
    const d = await askingBoard()
    const call = d.hooks.get('tool.call') as Hook<'tool.call'>
    const check = d.hooks.get('tool.check') as Hook<'tool.check'>
    await call(d.$, { tool: 'Read', tool_use_id: 'empty', agentId: 'sub-1' } as never, (async () => {
      expect(await check(d.$, { tool_use_id: 'empty' } as never, (async () => undefined) as never)).toBe(undefined)

      return { result: 'ok' }
    }) as never)
    expect(d.board()['sub-1']?.awaitingPermission).toBe(undefined)
  })

  test('tracking is capped at 256 calls and eviction clears only the evicted ask', async () => {
    const d = await askingBoard()
    d.held.set('agents', { value: { ...d.board(), other: entry('other') }, version: 2 })
    const finishes = [await pendingCall(d, 'oldest')]
    await d.advance(3000)
    expect(d.board()['sub-1']?.awaitingPermission).toBe(true)
    for (let index = 0; index < 256; index += 1) finishes.push(await pendingCall(d, `call-${index}`, { decision: 'ask' }, 'other'))
    expect(d.timers.filter(one => !one.cancelled)).toHaveLength(256)
    expect(d.board()['sub-1']?.awaitingPermission).toBe(undefined)
    const check = d.hooks.get('tool.check') as Hook<'tool.check'>
    await check(d.$, { tool_use_id: 'oldest' } as never, (async () => ({ decision: 'ask' })) as never)
    expect(d.timers.filter(one => !one.cancelled)).toHaveLength(256)
    await d.advance(3000)
    expect(d.board().other?.awaitingPermission).toBe(true)
    for (const finish of finishes) await finish()
    expect(d.board().other?.awaitingPermission).toBe(undefined)
  })

  test('every session end clears tracking and cancels pending asks', async () => {
    for (const reason of ['clear', 'other']) {
      const d = await askingBoard()
      const raised = await pendingCall(d, 'raised')
      await d.advance(3000)
      const pending = await pendingCall(d, 'pending')
      await (d.hooks.get('session.end') as Hook<'session.end'>)(d.$, { reason } as never, (async () => ({})) as never)
      expect(d.timers.filter(one => !one.cancelled)).toHaveLength(0)
      const check = d.hooks.get('tool.check') as Hook<'tool.check'>
      await check(d.$, { tool_use_id: 'pending' } as never, (async () => ({ decision: 'ask' })) as never)
      await d.advance(3000)
      expect(d.timers.filter(one => !one.cancelled)).toHaveLength(0)
      expect(d.board()['sub-1']?.awaitingPermission).toBe(undefined)
      await raised()
      await pending()
    }
  })

  test('main mascot failures cannot prevent tool cleanup, git or inventory refresh', async () => {
    const d = direct()
    await register(d.on, {})
    d.world.failReads.add('main')
    d.held.set('tools', { value: { current: { name: 'Read', since: NOW }, counts: { Read: 1 } }, version: 1 })
    await (d.hooks.get('turn.complete') as Hook<'turn.complete'>)(d.$, {} as never, (async () => ({ text: '' })) as never)
    expect(d.held.get('tools')?.value).toEqual({ counts: { Read: 1 } })
    expect(d.timers.map(one => one.at - NOW)).toEqual([3000, 0])
  })

  test('compaction HUD status and mascot writes fail independently', async () => {
    for (const failed of ['main', 'usage']) {
      const d = direct()
      await register(d.on, { statusLine: true })
      d.world.failReads.add(failed)
      d.held.set('session', { value: { model: 'claude-opus-5-5' }, version: 1 })
      const statuses: unknown[] = []
      d.$.ui.status = text => { statuses.push(text) }
      d.held.set('usage', { value: { rateLimits: [], compactions: 0, contextPercent: 90 }, version: 1 })
      const result = { messages: [] }
      expect(await (d.hooks.get('session.compact') as Hook<'session.compact'>)(d.$, { trigger: 'manual' } as never, (async () => result) as never)).toBe(result)
      if (failed === 'main') {
        expect(d.held.get('usage')?.value).toEqual({ rateLimits: [], compactions: 1 })
        expect(d.held.has('statusText')).toBe(true)
      } else expect(d.held.get('main')?.value).toEqual({ compactedAt: NOW })
    }
  })

  test('unknown spawn time does not hide a freshly finished agent', () => {
    for (const status of ['done', 'failed'] as const) {
      const scene = sceneOf([entry('seeded', { status, startedAt: 0, endedAt: NOW })], idleHud, NOW)
      expect(scene.agents).toHaveLength(1)
      // It packs up first (its laptop closes), then cheers or sits.
      expect(phaseOf(scene.agents[0]!)).toEqual({ kind: 'pack', step: 0 })
      const later = sceneOf([entry('seeded', { status, startedAt: 0, endedAt: NOW })], idleHud, NOW + PACK_TICKS * SCENE_FRAME_MS)
      expect(phaseOf(later.agents[0]!).kind).toBe(status === 'done' ? 'cheer' : 'sit')
    }
  })

  test('the palette has six distinct raw colours with 3:1 contrast on both backgrounds', () => {
    const luminance = (hex: string): number => {
      const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
      const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)

      return linear.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0)
    }
    expect(new Set(PALETTE).size).toBe(6)
    for (const colour of PALETTE) {
      expect(colour).toMatch(/^#[0-9A-F]{6}$/)
      for (const background of ['#282a36', '#eff1f5']) {
        const a = luminance(colour)
        const b = luminance(background)
        expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), `${colour} on ${background}`).toBeGreaterThanOrEqual(3)
      }
    }
    expect(SCENE_COLOURS).not.toContain('ide')
    expect(SCENE_COLOURS).not.toContain('permission')
  })

  test('the prop tables exclude ambiguous-width review glyphs', () => {
    for (const table of FRAME_TABLES) {
      for (const frame of table.frames) expect(frame.join('')).not.toMatch(/[Ψ■▤▥▦]/)
    }
  })

  test('/clear resets all main-loop mascot facts and the busy cache', async () => {
    const d = direct()
    await register(d.on, {})
    const step = d.hooks.get('turn.step') as Hook<'turn.step'>
    const runStep = async () => {
      const stream = step(d.$, { model: 'claude-opus-5-5' } as never, (async function* () { return {} }) as never)
      for await (const _chunk of stream) { /* Drained. */ }
    }
    await runStep()
    d.held.set('main', { value: { busySince: NOW, idleSince: NOW - 1000, compactedAt: NOW }, version: 2 })
    await (d.hooks.get('session.end') as Hook<'session.end'>)(d.$, { reason: 'clear' } as never, (async () => ({})) as never)
    expect(d.held.get('main')?.value).toEqual({})
    await d.advance(1000)
    await runStep()
    expect(d.held.get('main')?.value).toEqual({ busySince: NOW + 1000 })
  })
})

describe('permission', () => {
  test('a subagent call put to the decider raises its hand until the call ends', async () => {
    const d = direct()
    await register(d.on, {})
    const spawned = d.hooks.get('agent.spawn') as Hook<'agent.spawn'>
    const call = d.hooks.get('tool.call') as Hook<'tool.call'>
    const check = d.hooks.get('tool.check') as Hook<'tool.check'>
    expect(check).toBeDefined()
    await spawned(d.$, { tool_use_id: 'tu-1', description: 'Dig', subagentType: 'Explore', background: false } as never, (async () => ({ agentId: 'sub-1' })) as never)

    // The call's check, and what the board holds while the person decides.
    const run = async (verdict: 'ask' | 'allow', agentId?: string, id = 'tu-9') => {
      let during: AgentBoardEntry | undefined
      let answered: unknown
      await call(d.$, { tool: 'Read', file_path: '/work/a.ts', tool_use_id: id, ...(agentId === undefined ? {} : { agentId }) } as never, (async () => {
        answered = await check(d.$, { tool: 'Read', input: { file_path: '/work/a.ts' }, tool_use_id: id } as never, (async () => ({ decision: verdict })) as never)
        await d.advance(3000)
        during = d.board()['sub-1']

        return { result: 'ok' }
      }) as never)

      return { during, answered }
    }

    const asked = await run('ask', 'sub-1')
    // The verdict passes through untouched.
    expect(asked.answered).toEqual({ decision: 'ask' })
    expect(asked.during?.awaitingPermission).toBe(true)
    expect(sceneOf([asked.during as AgentBoardEntry], idleHud, NOW).agents[0]?.activity).toBe('asking')
    expect(d.board()['sub-1']?.awaitingPermission).toBe(undefined)

    expect((await run('allow', 'sub-1')).during?.awaitingPermission).toBe(undefined)
    // A main-loop call, or one of an agent the board never saw, raises nothing.
    expect((await run('ask')).during?.awaitingPermission).toBe(undefined)
    expect((await run('ask', 'ghost', 'tu-10')).during?.awaitingPermission).toBe(undefined)
  })

  test('with mascots off a lingering ask still marks its agent waiting: the alert strip counts it', async () => {
    const d = direct()
    await register(d.on, { mascots: false })
    expect(d.hooks.has('tool.check')).toBe(true)
    const spawned = d.hooks.get('agent.spawn') as Hook<'agent.spawn'>
    await spawned(d.$, { tool_use_id: 'tu-1', description: 'Dig', subagentType: 'Explore', background: false } as never, (async () => ({ agentId: 'sub-1' })) as never)
    const finish = await pendingCall(d, 'tu-9')
    await d.advance(3000)
    expect(d.board()['sub-1']?.awaitingPermission).toBe(true)
    // What the alert strip draws from, in `/mod-hud facts`.
    const run = d.hooks.get('command.run{"command":"mod-hud"}') as (($: unknown, e: unknown) => Promise<{ text: string }>)
    const facts = JSON.parse((await run(d.$, { command: 'mod-hud', args: 'facts' })).text.split('\n').slice(0, -1).join('\n')) as HudData
    expect(facts.alerts).toEqual({ asks: 1 })
    expect(alertsOf(facts)[0]?.text).toBe('1 agent waiting for permission')
    await finish()
    expect(d.board()['sub-1']?.awaitingPermission).toBe(undefined)
  })
})

describe('workflow agents in the pane', () => {
  test('in the pane, a workflow agent stands beside the session at work on its current tool, its name in its colour', { options: { wander: false, motion: 'classic' } }, async ($, on) => {
    const { clock, world, held } = arrange(on)
    world.tool = async () => {
      await clock.sleep(20 * SECOND)

      return { result: 'ok' }
    }
    await $.session.start(START)
    await clock.settle()
    seedHud(held, idleHud)
    await $.command.run(TOGGLE)
    const id = 'a8f3c2d19e7b4c21'
    const call = $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'a', new_string: 'b', agentId: id } as never)
    // Past its arrival: it stands in its slot, typing.
    await clock.advance(6 * SECOND)
    for (const surface of SURFACES) {
      const ui = await mountPane($, surface, 72, 30)
      const rows = (await sceneRows(ui)).map(row => row.text)
      expect(rows.length).toBeGreaterThanOrEqual(4)
      // The session's crown centred over its head, at the front-left of the field.
      expect(rows[rows.length - 4]?.slice(5, 8)).toBe(CROWN.art)
      // It faces its laptop, a cell to its right: the lid on the head row, the screen on the torso row, the deck on the floor.
      const desk = `${HEADS.right.trim()}  ▗▄▄▄▖`
      const head = rows.findIndex(row => row.includes(desk))
      expect(head).toBeGreaterThan(0)
      const x = [...rows[head]!].join('').indexOf(desk) - 3
      // No letter over its head.
      expect([...rows[head - 1]!][x + 6] ?? ' ').toBe(' ')
      expect([...rows[head + 1]!].slice(x + 12, x + 17).join('')).toBe('▐▒▒▒▌')
      // Its pick button sits between its feet, never on the laptop.
      expect([...rows[head + 2]!].slice(x, x + 17).join('')).toBe('    ▘▘▾▝▝  ▀▀▀▀▀▀')
      expect((await sceneColours(ui)).has(colourFor(id))).toBe(true)
      const row = await ui.find({ key: `workflow:${id}` })
      expect(shownText(textsIn(row).find(text => text.props?.color === colourFor(id))).trim()).toBe('wf-4c21')
      await ui.unmount()
    }
    await clock.advance(20 * SECOND)
    await call
  })

  test('with showWorkflows off there is no mascot for a workflow agent', { options: { showWorkflows: false, motion: 'classic' } }, async ($, on) => {
    const { clock, held } = arrange(on)
    await $.session.start(START)
    await clock.settle()
    seedHud(held, idleHud)
    await $.command.run(TOGGLE)
    await $.tool.call({ tool: 'Read', file_path: '/work/a.ts', agentId: 'a8f3c2d19e7b4c21' } as never)
    await clock.advance(6 * SECOND)
    const ui = await mountPane($, 'terminal', 72, 30)
    const rows = await sceneRows(ui)
    // The session alone: nothing drawn past its own slot.
    expect(rows.some(row => row.text.includes(CROWN.art))).toBe(true)
    for (const row of rows) expect(displayWidth(row.text)).toBeLessThanOrEqual(SLOT)
    expect(held.has('shadows')).toBe(false)
    await ui.unmount()
  })
})
