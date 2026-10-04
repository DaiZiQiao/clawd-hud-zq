import type { On, UiPane } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { AgentBoardEntry } from '../types'
import { NOW } from './scene-model.fixtures'
import { svgRows } from './scene-svg.fixtures'
import { stateCells } from './test-state'
import type { Held } from './test-state'

// The pane with the smooth scene's `Client`, as the Client and pixel tests mount it.

const PANE = 'hud'
const VIEWPORT = { columns: 160, rows: 40, isFullscreen: true }
const PANE_PROPS = { title: 'HUD', isFocused: false, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 24 }, view: {} } as const

// The engine beneath the plugin, as a session answers it: state in memory, a clock the test moves, the pane placed.
export const arrange = (on: On, agents: readonly AgentBoardEntry[]) => {
  const clock = mock.clock(on, { now: NOW })
  const held: Held = new Map()
  const world = { panes: [{ id: PANE, title: 'HUD', isShown: true, isFocused: false, isPlaced: true }] as UiPane[], writes: [] as string[] }
  stateCells(on, held, world.writes)
  on('ui.panes', () => ({ value: world.panes }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('session.messages', () => ({ value: [{ role: 'assistant' as const, text: 'Fixed it.', toolUses: [] }] }))
  held.set('agents', { value: Object.fromEntries(agents.map(one => [one.id, one])), version: 1 })

  return { clock, held, world }
}

export const mount = <S extends 'terminal' | 'desktop' | 'vscode' | 'mobile'>($: Engine, surface: S, bodyColumns = 72, bodyRows = 24) =>
  $.ui.mount({ plugin: 'mod-hud', surface, component: 'Pane', props: { ...PANE_PROPS, bodyColumns, scroll: { offset: 0, bodyRows } }, requestId: PANE, viewport: VIEWPORT })

export type Found = { key: string | undefined; text: string; props: Record<string, unknown> }
export type Reads = { find: (query: { type: string; in: string }) => Promise<Found | undefined>; findAll: (query: { type: string; in: string }) => Promise<Found[]> }

/** The rows the scene's surface module drew, a row per row of its region: its Text rows, or on the desktop its Svg read back into cells. */
export const rowsOf = async (ui: Reads): Promise<string[]> => {
  const svg = await ui.find({ type: 'Svg', in: 'mascots' })
  if (svg !== undefined) return svgRows(String(svg.props.source))

  return (await ui.findAll({ type: 'Box', in: 'mascots' })).filter(box => box.key?.startsWith('mascots:') === true).map(box => box.text)
}

/** The cell in the middle of a head drawn in `rows` (the first match), as the pointer would press it. */
export const headAt = (rows: readonly string[], head: string | RegExp): { x: number; y: number } | undefined => {
  for (let y = 0; y < rows.length; y += 1) {
    const match = typeof head === 'string' ? { index: rows[y]!.indexOf(head) } : head.exec(rows[y]!)
    if (match !== null && match.index !== undefined && match.index >= 0) return { x: match.index + 3, y }
  }

  return undefined
}
