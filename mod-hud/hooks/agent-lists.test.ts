import { describe, expect, test } from 'claude-code/testing'

import type { AgentBoardEntry, ShadowAgentEntry } from '../types'
import { SURFACES, WIDTHS, arrange, listRows, mount, pixelTexts, press, shown } from './inspect.fixtures'
import type { Described, Drawing } from './inspect.fixtures'
import { NOW, entry } from './scene-model.fixtures'
import { textRowOf } from './text-svg.fixtures'

// The lists' rows: the calls column, the header's counts in colour, struck
// finished rows, and each group's collapse and minimise.

/** Whether a row draws anything struck through. */
const struckIn = (node: unknown): boolean =>
  JSON.stringify(node ?? null).includes('strikethrough') || pixelTexts(node).some(run => run.props.strikethrough === true)

describe('agent rows', () => {
  const rowText = async (ui: Drawing, key: string): Promise<string> => {
    const row = await ui.find({ key })
    const pixels = textRowOf(row)
    if (pixels !== undefined) return pixels
    type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
    const shownText = (node: unknown): string => {
      if (typeof node === 'string') return node
      const one = node as Node
      if (one.type === 'Button') return String(one.props?.label ?? '')

      return (one.children ?? []).map(shownText).join('')
    }

    return ((row?.children ?? []) as Node[]).map(cell => shownText(cell).padEnd(Number(cell.props?.width ?? 0))).join('')
  }

  test('the calls column holds four digits and keeps one blank cell before the detail', { timeoutMs: 20_000 }, async ($, on) => {
    const { held } = arrange(on)
    for (const calls of [1, 91, 138, 1234]) {
      held.set('agents', { value: { counted: entry('counted', { toolCalls: calls, currentTool: 'Read', description: 'Build the HUD' }) }, version: calls })
      for (const surface of SURFACES) {
        const ui = await mount($, surface, 100)
        const text = await rowText(ui, 'agent:counted')
        const label = `${calls} call${calls === 1 ? '' : 's'}`
        expect(text).toContain(`${label} `)
        expect(text).not.toContain(`${label}Read`)
        // The detail starts in the same column whatever the count: button, glyph, then the stats' 47 cells.
        expect(text.indexOf('Read  Build the HUD')).toBe(1 + 2 + 47)
        await ui.unmount()
      }
    }
  })

  test('header counts in colour: running green, done red; finished rows struck through and dim, glyph and name kept', async ($, on) => {
    const { held } = arrange(on)
    held.set('agents', { value: {
      live: entry('live', { currentTool: 'Read' }),
      over: entry('over', { status: 'done', endedAt: NOW, summary: 'Fixed it', type: 'worker' }),
    }, version: 1 })
    held.set('shadows', { value: {
      wf: { id: 'wf00000000000001', firstSeen: NOW - 5000, lastSeen: NOW, steps: 2, toolCalls: 1, status: 'done', endedAt: NOW, reason: 'answer' } satisfies ShadowAgentEntry,
    }, version: 1 })
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        const ui = await mount($, surface, columns)
        const texts = surface === 'terminal' ? await ui.findAll({ type: 'Text' }) : pixelTexts(await ui.find({ key: 'agents' }))
        expect(texts.find(one => one.text === '1 running')?.props.color).toBe('success')
        expect(texts.find(one => one.text === '1 done')?.props.color).toBe('error')
        const over = await ui.find({ key: 'agent:over' })
        const overTexts = surface === 'terminal'
          ? (await ui.findAll({ type: 'Text' })).filter(one => over !== undefined && JSON.stringify(over.children).includes(JSON.stringify(one.children)))
          : pixelTexts(over)
        const struck = overTexts.filter(one => one.props.strikethrough === true)
        expect(struck.length, `${surface} @${columns}`).toBeGreaterThan(0)
        expect(struck.every(one => one.props.dimColor === true)).toBe(true)
        // The glyph and the name are never struck.
        expect(texts.find(one => one.text === '✓')?.props.strikethrough).toBe(undefined)
        expect(overTexts.find(one => one.text.startsWith('worker'))?.props.strikethrough).toBe(undefined)
        expect(struckIn(await ui.find({ key: 'agent:live' }))).toBe(false)
        expect(struckIn(await ui.find({ key: 'workflow:wf00000000000001' }))).toBe(true)
        await ui.unmount()
      }
    }
  })
})

// The lists: each group's running agents whole, its three most recent finished, then a toggle.
describe('collapsed finished agents', () => {
  const board = (finished: number, running = 1): Record<string, AgentBoardEntry> => Object.fromEntries([
    ...Array.from({ length: running }, (_, index) => [`run-${index}`, entry(`run-${index}`, { type: 'worker', currentTool: 'Read' })]),
    ...Array.from({ length: finished }, (_, index) => [`done-${index}`, entry(`done-${index}`, { status: 'done', endedAt: NOW - (finished - index) * 1000, summary: `Result ${index}` })]),
  ])
  const flows = (finished: number): Record<string, ShadowAgentEntry> => Object.fromEntries(Array.from({ length: finished }, (_, index) => {
    const id = `wf-run-${String(index).padStart(9, '0')}`

    return [id, { id, firstSeen: NOW - 20_000, lastSeen: NOW, steps: 2, toolCalls: 1, status: 'done', endedAt: NOW - (finished - index) * 1000, reason: 'answer' } satisfies ShadowAgentEntry]
  }))

  test('a group lists its running whole and its three most recent finished, then `▸ n more`; a press lists all and `▾ collapse`, at 100 and 48 columns', { timeoutMs: 20_000 }, async ($, on) => {
    const { held, world } = arrange(on)
    held.set('agents', { value: board(15), version: 1 })
    held.set('shadows', { value: flows(5), version: 1 })
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        const ui = await mount($, surface, columns)
        const keys = async (prefix: string): Promise<string[]> => (await ui.findAll({ type: 'Box' })).flatMap(box => (box.key?.startsWith(prefix) === true ? [box.key] : []))
        expect(await keys('agent:')).toEqual(['agent:run-0', 'agent:done-14', 'agent:done-13', 'agent:done-12'])
        expect((await ui.find({ key: 'more:agents' }))?.props).toMatchObject({ label: '▸ 12 more', plain: true, dimColor: true })
        expect((await ui.find({ key: 'more:workflow' }))?.props.label).toBe('▸ 2 more')
        expect(await keys('workflow:')).toHaveLength(3)
        const lists = listRows((await ui.find({ key: 'agents' })) as Described)
        expect(lists).toContain('   ▸ 12 more')
        const writes = world.writes.filter(key => key === 'listView').length
        await press(ui, 'more:agents')
        expect(held.get('listView')?.value).toEqual({ agents: true })
        expect(await keys('agent:')).toHaveLength(16)
        expect((await ui.find({ key: 'more:agents' }))?.props.label).toBe('▾ collapse')
        // The other group is as it was.
        expect(await keys('workflow:')).toHaveLength(3)
        await press(ui, 'more:workflow')
        expect(await keys('workflow:')).toHaveLength(5)
        await press(ui, 'more:agents')
        await press(ui, 'more:workflow')
        expect(held.get('listView')?.value).toEqual({})
        expect(world.writes.filter(key => key === 'listView')).toHaveLength(writes + 4)
        await ui.unmount()
      }
    }
  })

  test('a group\'s header Button minimises it to that line and opens it again, each group on its own, written on a press only, at 100 and 48 columns', { timeoutMs: 20_000 }, async ($, on) => {
    const { held, world } = arrange(on)
    held.set('agents', { value: board(5), version: 1 })
    held.set('shadows', { value: flows(5), version: 1 })
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        const ui = await mount($, surface, columns)
        const where = `${surface} @${columns}`
        const keys = async (prefix: string): Promise<string[]> => (await ui.findAll({ type: 'Box' })).flatMap(box => (box.key?.startsWith(prefix) === true ? [box.key] : []))
        const lists = async (): Promise<string[]> => listRows((await ui.find({ key: 'agents' })) as Described)
        const header = async (group: string): Promise<string> => (await lists()).find(row => row.includes(`${group} · `)) ?? ''
        // Expanded: `▾` before each header, its counts coloured; the done-agent collapse inside.
        expect(await header('Agents'), where).toMatch(/^▾ Agents · 1 running · 5 done/)
        expect(await header('Workflow'), where).toBe('▾ Workflow · 0 running · 5 done')
        for (const group of ['agents', 'workflow']) expect((await ui.find({ key: `group:${group}` }))?.props, where).toMatchObject({ label: '▾', plain: true, dimColor: true })
        expect(await keys('agent:')).toHaveLength(4)
        expect(await keys('workflow:')).toHaveLength(3)
        const writes = world.writes.filter(key => key === 'listView').length

        await press(ui, 'group:agents')
        expect(held.get('listView')?.value, where).toEqual({ agentsMinimised: true })
        expect(await header('Agents'), where).toMatch(/^▸ Agents · 1 running · 5 done/)
        expect((await ui.find({ key: 'group:agents' }))?.props.label).toBe('▸')
        expect(await keys('agent:'), where).toEqual([])
        expect(await ui.find({ key: 'more:agents' })).toBe(undefined)
        // The other group is as it was.
        expect(await keys('workflow:')).toHaveLength(3)
        expect(await ui.find({ key: 'more:workflow' })).toBeDefined()
        // Minimised, the header keeps its coloured counts.
        const headerBox = await ui.find({ key: 'header:agents' })
        const textsUnder = (node: unknown): { text: string; props: Record<string, unknown> }[] => {
          const one = node as Described | undefined
          if (one === undefined) return []

          return [...(one.type === 'Text' ? [{ text: shown(one), props: one.props ?? {} }] : []), ...(one.children ?? []).flatMap(textsUnder)]
        }
        const counts = surface === 'terminal' ? textsUnder(headerBox) : pixelTexts(headerBox)
        expect(counts.find(one => one.text === '1 running')?.props.color, where).toBe('success')
        const done = counts.filter(one => one.text === '5 done')
        expect(done.length, where).toBeGreaterThan(0)
        expect(done.every(one => one.props.color === 'error'), where).toBe(true)

        await press(ui, 'group:workflow')
        expect(held.get('listView')?.value, where).toEqual({ agentsMinimised: true, workflowMinimised: true })
        expect(await lists(), where).toEqual([
          '▸◆ Session',
          ...(columns >= 60 || surface === 'terminal' ? ['▸ Agents · 1 running · 5 done · workflow 0 running, 5 done'] : ['▸ Agents · 1 running · 5 done · workflow 0 runn…']),
          '▸ Workflow · 0 running · 5 done',
        ])
        expect(await ui.find({ key: 'more:workflow' })).toBe(undefined)

        await press(ui, 'group:agents')
        await press(ui, 'group:workflow')
        expect(held.get('listView')?.value).toEqual({})
        expect(await keys('agent:')).toHaveLength(4)
        expect(await keys('workflow:')).toHaveLength(3)
        expect(world.writes.filter(key => key === 'listView')).toHaveLength(writes + 4)
        await ui.unmount()
      }
    }
  })

  test('a minimised group spends none of `maxRows` and adds nothing to `+n more`; the scene takes the rows it gives back', { options: { maxRows: 4 } }, async ($, on) => {
    const { held } = arrange(on)
    held.set('agents', { value: board(0, 6), version: 1 })
    const live = (index: number): ShadowAgentEntry => ({ id: `wf-live-${String(index).padStart(8, '0')}`, firstSeen: NOW - 5000, lastSeen: NOW, steps: 2, toolCalls: 1, status: 'running' })
    held.set('shadows', { value: Object.fromEntries([0, 1, 2].map(index => [live(index).id, live(index)])), version: 1 })
    for (const surface of SURFACES) {
      const ui = await mount($, surface, 100)
      const keys = async (prefix: string): Promise<string[]> => (await ui.findAll({ type: 'Box' })).flatMap(box => (box.key?.startsWith(prefix) === true ? [box.key] : []))
      const lists = async (): Promise<string[]> => listRows((await ui.find({ key: 'agents' })) as Described)
      const room = async (): Promise<number> => Number((await ui.find({ key: 'mascots' }))?.props.height)
      // Both open: four subagents fill the cap; two more and three workflow agents are counted.
      expect(await keys('agent:')).toHaveLength(4)
      expect(await keys('workflow:')).toHaveLength(0)
      expect((await lists()).at(-1)).toBe('+5 more')
      const open = await room()
      // Agents minimised: the workflow agents take the cap; the six subagents are no rows left out.
      await press(ui, 'group:agents')
      expect(await keys('agent:')).toHaveLength(0)
      expect(await keys('workflow:')).toHaveLength(3)
      expect((await lists()).some(row => row.endsWith('more'))).toBe(false)
      // Four agent rows and the `+5 more` gone, three workflow rows back: two rows more for the scene.
      expect(await room(), surface).toBe(open + 2)
      // Workflow minimised too: the headers alone.
      await press(ui, 'group:workflow')
      expect(await lists()).toEqual(['▸◆ Session', '▸ Agents · 6 running · 0 done · workflow 3 running', '▸ Workflow · 3 running · 0 done'])
      expect(await room(), surface).toBe(open + 5)
      // Workflow alone minimised: the subagents fill the cap and only their own two are counted.
      await press(ui, 'group:agents')
      expect(await keys('agent:')).toHaveLength(4)
      expect((await lists()).at(-1)).toBe('+2 more')
      await press(ui, 'group:workflow')
      await ui.unmount()
    }
  })

  test('three finished or fewer: no toggle; `maxRows` still caps the total and counts the rest', { options: { maxRows: 6 } }, async ($, on) => {
    const { held } = arrange(on)
    held.set('agents', { value: board(3, 2), version: 1 })
    const ui = await mount($, 'terminal', 100)
    expect(await ui.find({ key: 'more:agents' })).toBe(undefined)
    await ui.unmount()
    held.set('agents', { value: board(12, 5), version: 2 })
    held.set('listView', { value: { agents: true }, version: 1 })
    const capped = await mount($, 'terminal', 100)
    const lists = listRows((await capped.find({ key: 'agents' })) as Described)
    expect((await capped.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('agent:') === true)).toHaveLength(6)
    expect(lists.at(-1)).toBe('+11 more')
    expect((await capped.find({ key: 'more:agents' }))?.props.label).toBe('▾ collapse')
    await capped.unmount()
  })
})
