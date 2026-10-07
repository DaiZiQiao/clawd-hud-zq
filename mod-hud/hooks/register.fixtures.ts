import type { AgentInfo, CommandSpec, Hook, Next, On, PaneOpenArgs, UiPane } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { AgentBoardEntry } from '../types'
import { rowSource, textLine, textRowsOf, textRuns } from './text-svg.fixtures'

// The engine beneath the plugin, as the hooks' tests answer it, and the pane they draw.

export const PANE = 'hud'
export const AGENTS = 'agents'
export const TICK = 'tick'
export const NOW = 1_000_000

export const PANE_PROPS = {
  title: 'HUD',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const
export const VIEWPORT = { columns: 160, rows: 40, isFullscreen: true }
export const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const
export const TOGGLE = {
  command: 'mod-hud',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const
export const SURFACES = ['terminal', 'desktop'] as const
// The status line is off unless asked for: a test that reads it asks.
export const STATUS_ON = { options: { statusLine: true } } as const

export type Entries = Record<string, AgentBoardEntry>

// The engine beneath the plugin: a clock that moves when the test says, and
// the pane, command, agent and turn calls answered the way a session would.
export const arrange = (on: On, isPlaced = true, now = NOW) => {
  const clock = mock.clock(on, { now })
  const world = {
    isPlaced,
    panes: [] as UiPane[],
    opens: [] as PaneOpenArgs[],
    registered: [] as CommandSpec[],
    statuses: [] as (string | undefined)[],
    writes: [] as string[],
    reads: [] as string[],
    agents: [] as AgentInfo[],
    listDelay: 0,
    writeDelay: 0,
    statusWriteDelay: 0,
    denyList: false,
    spawned: 0,
    tool: async (): Promise<{ result: unknown }> => ({ result: 'ok' }),
  }
  const held = new Map<string, { value: unknown; version: number }>()

  // Nothing in a test holds `$.state`: this is the host's side of it, in memory.
  on('state.get', (_$, e) => {
    world.reads.push(e.key)

    return { value: held.get(e.key) ?? { value: undefined, version: 0 } }
  })
  on('state.set', async (_$, e) => {
    if (e.key === AGENTS && world.writeDelay > 0) {
      const delay = world.writeDelay
      world.writeDelay = 0
      await clock.sleep(delay)
    }
    if (e.key === 'statusText' && world.statusWriteDelay > 0) {
      const delay = world.statusWriteDelay
      world.statusWriteDelay = 0
      await clock.sleep(delay)
    }
    const version = held.get(e.key)?.version ?? 0
    if (e.ifVersion !== undefined && e.ifVersion !== version) {
      return { value: { isSet: false as const, version } }
    }
    world.writes.push(e.key)
    held.set(e.key, { value: e.value, version: version + 1 })

    return { value: { isSet: true as const, version: version + 1 } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    world.registered.push(e)

    return { value: { command: e.name } }
  })
  on('ui.open', (_$, e) => {
    world.opens.push(e)
    const pane: UiPane = {
      id: e.id,
      title: e.title ?? e.id,
      isShown: true,
      isFocused: false,
      isPlaced: world.isPlaced,
    }
    world.panes = [...world.panes.filter(one => one.id !== e.id), pane]

    return {
      value: world.isPlaced
        ? { isPlaced: true as const }
        : { isPlaced: false as const, reason: 'terminal too narrow' },
    }
  })
  on('ui.close', (_$, e) => {
    world.panes = world.panes.filter(one => one.id !== e.id)

    return { value: undefined }
  })
  on('ui.panes', () => ({ value: world.panes }))
  on('ui.status', (_$, e) => {
    world.statuses.push(e.text)

    return { value: undefined }
  })
  on('agent.list', async () => {
    const delay = world.listDelay
    const denied = world.denyList
    world.listDelay = 0
    world.denyList = false
    if (delay > 0) await clock.sleep(delay)

    return denied ? { deny: 'list refused' } : { value: world.agents }
  })
  on('agent.spawn', () => {
    world.spawned += 1

    return { model: 'claude-sonnet-5-5', agentId: `sub-${world.spawned}` }
  })
  on('tool.call', () => world.tool())
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('ui.log', () => ({ value: undefined }))

  return { clock, world, held }
}

export type Held = ReturnType<typeof arrange>['held']

export const entriesOf = (held: Held): Entries => (held.get(AGENTS)?.value ?? {}) as Entries

export const entryOf = (held: Held, id: string): AgentBoardEntry | undefined => entriesOf(held)[id]

export const tickOf = (held: Held): number | undefined => {
  const value = held.get(TICK)?.value

  return typeof value === 'number' ? value : undefined
}

export const lastStatus = (world: ReturnType<typeof arrange>['world']): string | undefined => world.statuses.at(-1)

// The HUD keeps its own facts beside the board: a main-loop tool call writes
// those (the current tool, the counts) and leaves the board's values alone.
export const HUD_KEYS = ['session', 'usage', 'git', 'tools', 'todos', 'inventory']

export const boardWrites = (world: ReturnType<typeof arrange>['world']): number =>
  world.writes.filter(key => !HUD_KEYS.includes(key)).length

export const spawn = ($: Engine, extra: Record<string, unknown> = {}) =>
  $.agent.spawn({
    tool_use_id: 'tu-1',
    prompt: 'look around',
    description: 'Find the bug',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
    ...extra,
  } as Parameters<Engine['agent']['spawn']>[0])

export const complete = ($: Engine, agentId: string, extra: Record<string, unknown> = {}) =>
  $.turn.complete({
    answer: 'ok',
    durationMs: 5,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    agentId,
    ...extra,
  } as Parameters<Engine['turn']['complete']>[0])

// A subagent's tool call: `$.tool.call` carries `agentId` through as a loop would.
export const callTool = ($: Engine, agentId: string | undefined, tool = 'Bash') =>
  $.tool.call({ tool, command: 'ls', ...(agentId === undefined ? {} : { agentId }) } as never)

export const mountPane = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal', bodyColumns = 100, bodyRows?: number) =>
  $.ui.mount({
    plugin: 'mod-hud',
    surface,
    component: 'Pane',
    props: { ...PANE_PROPS, bodyColumns, ...(bodyRows === undefined ? {} : { scroll: { offset: 0, bodyRows } }) },
    requestId: PANE,
    viewport: VIEWPORT,
  })

export type Drawing = Awaited<ReturnType<typeof mountPane>>

// How many Text elements a drawn subtree holds, itself included.
export const countTexts = (node: unknown): number => {
  if (typeof node !== 'object' || node === null) return 0
  const { type, children } = node as { type?: string; children?: unknown[] }

  return (type === 'Text' ? 1 : 0) + (children ?? []).reduce<number>((sum, child) => sum + countTexts(child), 0)
}

export type Described = { type?: string; key?: string; props?: Record<string, unknown>; children?: unknown[] }

/** The row Boxes drawn in pixels under a node: each a Box holding its Svg and its Buttons' Boxes. */
export const pixelRows = (node: unknown): Described[] => {
  if (typeof node !== 'object' || node === null) return []
  const one = node as Described
  const children = (one.children ?? []) as Described[]
  if (one.type === 'Box' && children.some(child => child?.type === 'Svg' || child?.props?.position === 'absolute')) return [one]

  return children.flatMap(pixelRows)
}

/**
 * The board's texts on the desktop, whose rows are pixels: each row read
 * back from the cell after its leading Buttons (and the blanks after them),
 * then each of its runs, as the terminal's Texts would carry them.
 */
export const pixelTextsOf = async (ui: Drawing): Promise<{ text: string; props: Record<string, unknown> }[]> => {
  await ui.redraw()
  const rows = [...pixelRows(await ui.find({ type: 'Box', key: 'todos' })), ...pixelRows(await ui.find({ type: 'Box', key: 'agents' })).filter(row => (row.key ?? row.props?.key) !== 'session')]

  return rows.flatMap(row => {
    const source = rowSource(row)
    if (source === undefined) return []
    let start = 0
    for (const box of ((row.children ?? []) as Described[]).filter(child => child.props?.position === 'absolute').sort((a, b) => Number(a.props?.left) - Number(b.props?.left))) {
      if (Number(box.props?.left) === start) start += Number(box.props?.width)
    }
    const line = [...textLine(source)].slice(start).join('')

    return [
      { text: start > 0 ? line.trimStart() : line, props: { wrap: 'truncate-end' } },
      ...textRuns(source).map(run => ({ text: run.text, props: { ...run.props, wrap: 'truncate-end' } })),
    ]
  })
}

// The board's Texts: every Text drawn, less the HUD's above them, the
// session's row heading the lists, and the mascot scene's below them; on the
// desktop its rows read back (pixelTextsOf).
export const textsOf = async (ui: Drawing) => {
  if (ui.surface === 'desktop') return pixelTextsOf(ui)
  await ui.redraw()
  const count = (node: unknown): number => (node === undefined ? 0 : countTexts(node))
  const hud = count(await ui.find({ type: 'Box', key: 'hud' }))
  const todos = count(await ui.find({ type: 'Box', key: 'todos' }))
  const session = count(await ui.find({ type: 'Box', key: 'session' }))
  const scene = count(await ui.find({ type: 'Box', key: 'mascots' }))
  const all = await ui.findAll({ type: 'Text' })

  return [...all.slice(hud, hud + todos), ...all.slice(hud + todos + session, all.length - scene)]
}

// The test engine answers nothing beneath `session.append`, and loads the
// plugin once: direct-hook tests use a fake `$` with state in memory and a
// clock the test sets.
export const direct = () => {
  const hooks = new Map<string, unknown>()
  const on = ((name: string, ...args: unknown[]) => {
    hooks.set(`${name}${args.length > 1 ? JSON.stringify(args[0]) : ''}`, args[args.length - 1])

    return { catch: () => {} }
  }) as On
  const held = new Map<string, { value: unknown; version: number }>()
  const world = {
    now: NOW,
    writes: 0,
    failReads: false,
    timers: [] as { cancelled: boolean }[],
    statuses: [] as (string | undefined)[],
    panes: [{ id: PANE, title: 'HUD', isShown: true, isFocused: false, isPlaced: true }] as UiPane[],
  }
  const $ = {
    state: {
      get: async ({ key }: { key: string }) => {
        if (world.failReads) throw new Error('state refused')

        return held.get(key) ?? { value: undefined, version: 0 }
      },
      set: async ({ key }: { key: string }, value: unknown, options?: { ifVersion?: number }) => {
        const before = held.get(key)?.version ?? 0
        if (options?.ifVersion !== undefined && options.ifVersion !== before) return { isSet: false, version: before }
        world.writes += 1
        const version = before + 1
        held.set(key, { value, version })

        return { isSet: true, version }
      },
    },
    command: { register: async ({ name }: { name: string }) => ({ command: name }) },
    agent: { list: async () => [] },
    clock: {
      now: async () => world.now,
      every: () => {
        const timer = { cancelled: false, cancel: () => void (timer.cancelled = true) }
        world.timers.push(timer)

        return timer
      },
    },
    ui: {
      panes: async () => world.panes,
      status: (text: string | undefined) => void world.statuses.push(text),
      log: () => {},
    },
  } as unknown as Parameters<Hook<'session.start'>>[0]
  const hook = <E extends 'session.start' | 'agent.spawn' | 'session.append' | 'tool.call'>(name: E) => hooks.get(name) as Hook<E>
  const next = <E extends 'session.start' | 'agent.spawn' | 'session.append' | 'tool.call'>(answer: unknown) => {
    const calls: unknown[] = []
    const run = (async (e: unknown) => {
      calls.push(e)

      return answer
    }) as unknown as Next<E>

    return { run, calls }
  }
  const entries = (): Entries => (held.get(AGENTS)?.value ?? {}) as Entries

  return { on, hook, next, held, world, $, entries, hooks }
}

export const SPAWN_EVENT = {
  tool_use_id: 'tu-1',
  prompt: 'p',
  description: 'Find the bug',
  subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: false,
  fork: false,
} as unknown as Parameters<Hook<'agent.spawn'>>[1]

// The session's row, heading the lists with inspect on.
export const SESSION_ROW = '▸◆ Session'

export const shownText = (node: unknown): string => {
  if (typeof node === 'string') return node
  if (typeof node !== 'object' || node === null) return ''
  // A Button reads as its label: the inspect button that starts an agent row.
  if ((node as Described).type === 'Button') return String((node as Described).props?.label ?? '')

  return ((node as Described).children ?? []).map(shownText).join('')
}

// The pane as a person reads it, row by row: the HUD's rows, the blank rows
// the column's gap leaves under them, then the board's (a wide agent row's
// cells joined at their widths).
export const paneOf = async (ui: Drawing) => {
  await ui.redraw()
  const root = await ui.find({ type: 'Box' })
  const order = ((root?.children ?? []) as Described[]).map(child => child.props?.key)
  const hud = (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('hud:') === true).map(box => {
    const source = rowSource(box)

    return source === undefined ? box.text : textLine(source)
  })
  const board = ((await ui.find({ type: 'Box', key: 'agents' }))?.children ?? []).flatMap(child => {
    const node = child as Described
    // On the desktop a row is pixels: read back, its Buttons where they lie.
    const pixels = textRowsOf(node)
    if (pixels.length > 0) return pixels
    const indent = ' '.repeat(Number(node.props?.paddingLeft ?? 0))
    if (node.type === 'Text') return [shownText(node)]
    if (node.props?.flexDirection === 'column') return (node.children ?? []).map(line => indent + shownText(line))
    const cells = (node.children ?? []) as Described[]

    return [indent + cells.map(one => shownText(one).padEnd(Number(one.props?.width ?? 0))).join('').trimEnd()]
  })
  const gap = hud.length > 0 ? Number(root?.props.gap ?? 0) : 0

  return { order, gap, hud, board, rows: [...hud, ...Array.from({ length: gap }, () => ''), ...board] }
}

export const agentBoxes = async (ui: Drawing) =>
  (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('agent:') === true)

export const SHADOWS = 'shadows'

// The session beneath, its model answering each request in three chunks.
export const workflowWorld = (on: On, now = NOW) => {
  const arranged = arrange(on, true, now)
  on('turn.step', async function* (_$, e) {
    for (const text of ['Looking', ' at', ' it']) yield { kind: 'text' as const, index: 0, text }

    return { turnId: e.turnId, index: e.index, answer: 'Looking at it', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  const keyed = (key: string): number => arranged.world.writes.filter(one => one === key).length

  return { ...arranged, shadowWrites: () => keyed(SHADOWS), agentWrites: () => keyed(AGENTS) }
}

// One request in a workflow agent's loop, drained; how many chunks came through.
export const stepAs = async ($: Engine, agentId: string, extra: Record<string, unknown> = {}): Promise<number> => {
  const stream = $.turn.step({
    turnId: `turn-${agentId}`, index: 0, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 3, agentId, ...extra,
  } as Parameters<Engine['turn']['step']>[0])
  let chunks = 0
  for await (const _chunk of stream) chunks += 1

  return chunks
}
