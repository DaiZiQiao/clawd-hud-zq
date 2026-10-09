import type { On, UiPane } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Cell, InspectRow } from './inspect'
import { NOW } from './scene-model.fixtures'
import { stateCells } from './test-state'
import type { Held } from './test-state'
import { svgsOf, textRowOf, textRowsOf, textRuns } from './text-svg.fixtures'

// The pane as the inspect and list tests draw it.

export const PANE = 'hud'
export const SURFACES = ['terminal', 'desktop'] as const
export const WIDTHS = [100, 48] as const
export const VIEWPORT = { columns: 160, rows: 40, isFullscreen: true }
export const PANE_PROPS = { title: 'HUD', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

export const PROMPT = 'Find why the parser drops the last token.\n\nFix it, then run the tests and report what changed.'

/** A cell as the terminal draws it: `[ label ]` for a primary Button, the label for a plain one. */
const cellText = (cell: Cell): string => ('button' in cell ? (cell.button.primary === true ? `[ ${cell.button.label} ]` : cell.button.label) : cell.text)

/** A row as plain text: what docs/pane-sketch.md shows. */
export const rowText = (row: InspectRow): string => row.cells.map(cellText).join('').trimEnd()

/** The rows as plain text. */
export const inspectLines = (rows: readonly InspectRow[]): string[] => rows.map(rowText)

// The engine beneath the plugin, as a session answers it, counting reads of an agent's conversation.
export const arrange = (on: On) => {
  const clock = mock.clock(on, { now: NOW })
  const held: Held = new Map()
  const world = {
    panes: [] as UiPane[],
    writes: [] as string[],
    reads: [] as string[],
    slow: undefined as string | undefined,
    spawned: 0,
    model: 'claude-sonnet-5-5',
    fetches: [] as (string | undefined)[],
    said: ['Found it: the parser drops the last token.\n\nFixed in parser.ts.'],
    stepUsage: null as unknown,
    tool: async (): Promise<unknown> => ({ result: 'ok' }),
  }
  stateCells(on, held, world.writes, world.reads)
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

    return { model: world.model, agentId: `sub-${world.spawned}` }
  })
  on('tool.call', () => world.tool() as never)
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: world.stepUsage as never }
  })
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.messages', async (_$, e) => {
    world.fetches.push(e.agentId)
    const said = world.said
    if (e.agentId === world.slow) await clock.sleep(5000)

    return { value: [{ role: 'user' as const, text: PROMPT, toolUses: [] }, ...said.map(text => ({ role: 'assistant' as const, text, toolUses: [] }))] }
  })

  return { clock, held, world }
}

export const mount = ($: Engine, surface: (typeof SURFACES)[number], bodyColumns: number, bodyRows = 40) =>
  $.ui.mount({ plugin: 'mod-hud', surface, component: 'Pane', props: { ...PANE_PROPS, bodyColumns, scroll: { offset: 0, bodyRows } }, requestId: PANE, viewport: VIEWPORT })

export type Drawing = Awaited<ReturnType<typeof mount>>
export type Described = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

// A node as the terminal draws it: a Button `[ label ]`, a plain one its label alone;
// a row the desktop draws in pixels, read back with its Buttons where they lie.
export const shown = (node: unknown): string => {
  const pixels = textRowOf(node)
  if (pixels !== undefined) return pixels
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (typeof node !== 'object' || node === null) return ''
  const one = node as Described
  if (one.type === 'Button') return one.props?.plain === true ? String(one.props.label ?? '') : `[ ${String(one.props?.label ?? '')} ]`

  return (one.children ?? []).map(shown).join('')
}

// The lists as a person reads them: a wide row's cells joined at their widths, a narrow one's lines.
export const listRows = (box: Described): string[] => (box.children ?? []).flatMap(child => {
  const node = child as Described
  const pixels = textRowsOf(node)
  if (pixels.length > 0) return pixels
  const indent = ' '.repeat(Number(node.props?.paddingLeft ?? 0))
  if (node.type === 'Text') return [shown(node)]
  if (node.props?.flexDirection === 'column') return (node.children ?? []).map(line => indent + shown(line))

  return [indent + ((node.children ?? []) as Described[]).map(one => shown(one).padEnd(Number(one.props?.width ?? 0))).join('').trimEnd()]
})

/** Presses a Button and draws again, as the next frame would. */
export const press = async (ui: Drawing, key: string): Promise<void> => {
  await ui.press({ key })
  await ui.redraw()
}

/** The runs every row drawn in pixels carries, as Texts would: their text and their styles. */
export const pixelTexts = (node: unknown): { text: string; props: Record<string, unknown> }[] =>
  svgsOf(node).flatMap(svg => textRuns(String(svg.props?.source ?? '')))
