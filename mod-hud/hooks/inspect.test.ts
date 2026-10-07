import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { HudDetailFacts, HudLedger, HudListView, HudSelection, HudTrailStep, HudUsageFacts } from '../types'
import { AT_5H, AT_7D, clockOf, full } from './hud.fixtures'
import {
  ARG_MAX,
  COST_ESTIMATE_NOTE,
  COST_NOTE,
  SAID_CHARS,
  SAID_MAX,
  TRAILS_TOTAL,
  TRAIL_MAX,
  WORKFLOW_NOTE,
  costRows,
  headerRows,
  inspectLines,
  lastAssistantText,
  mainArgOf,
  overviewRows,
  promptOf,
  rowText,
  spanOf,
  tabOf,
  tabRow,
  trailAdded,
  trailEnded,
  trailRows,
  wrapAll,
  wrapText,
} from './inspect'
import { PROMPT, SURFACES, WIDTHS, arrange, listRows, mount, pixelTexts, press, shown } from './inspect.fixtures'
import type { Described, Drawing } from './inspect.fixtures'
import { NOW, entry } from './scene-model.fixtures'
import { SVG_MAX } from './scene-svg'
import { CELL_HEIGHT, CELL_WIDTH } from './svg-style'
import type { Held } from './test-state'
import { rowSource, svgsOf, textLine, textRowsOf, textRuns, textSvgSize } from './text-svg.fixtures'
import { displayWidth, truncate } from './text-width'

// Click to inspect: a press on an agent's row or mascot (or the session's
// row) selects it, and the pane draws its tabbed inspect view under the HUD
// in place of the lists and the scene.

const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const
const TOGGLE = { command: 'mod-hud', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const
const HUD_KEYS = ['session', 'usage', 'git', 'tools', 'todos', 'inventory'] as const
const MINUTE = 60_000

const spawn = ($: Engine, extra: Record<string, unknown> = {}) =>
  $.agent.spawn({
    tool_use_id: 'tu-1', prompt: 'look', description: 'Find the bug in the parser and fix it, then run the tests and report what changed',
    subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false, ...extra,
  } as Parameters<Engine['agent']['spawn']>[0])

const callAs = ($: Engine, agentId: string, tool: string, input: Record<string, unknown>) => $.tool.call({ tool, agentId, ...input } as never)

const complete = ($: Engine, agentId: string | undefined, extra: Record<string, unknown> = {}) =>
  $.turn.complete({ answer: 'Fixed in parser.ts', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer', ...(agentId === undefined ? {} : { agentId }), ...extra } as Parameters<Engine['turn']['complete']>[0])

const stepAs = async ($: Engine, agentId: string | undefined, extra: Record<string, unknown> = {}) => {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3, ...(agentId === undefined ? {} : { agentId }), ...extra } as Parameters<Engine['turn']['step']>[0])
  for await (const _chunk of stream) {
    // Drained: the result is what matters.
  }
}

// The inspect view as drawn: its rows, then (the Agents tab) the lists; empty when none is drawn.
const viewOf = async (ui: Drawing): Promise<string[]> => {
  await ui.redraw()
  const view = await ui.find({ type: 'Box', key: 'detail' })
  if (view === undefined) return []

  return (view.children as Described[]).flatMap(child => (child.props?.key === 'agents' ? listRows(child) : [shown(child).trimEnd()]))
}

/** Whether a row draws a run in that colour: a Text's on the terminal, a run's read back on the desktop. */
const coloured = (node: unknown, colour: string): boolean =>
  JSON.stringify(node ?? null).includes(`"color":"${colour}"`) || pixelTexts(node).some(run => run.props.color === colour)

const selection = (held: Held): HudSelection | null | undefined => held.get('selected')?.value as HudSelection | null | undefined

const seedHud = (held: Held): void => {
  for (const key of HUD_KEYS) held.set(key, { value: full[key], version: 1 })
}

// A session with one subagent at work: nine calls made (one failed, one denied), one running.
const busy = async ($: Engine, on: On) => {
  const arranged = arrange(on)
  await $.session.start(START)
  await arranged.clock.settle()
  await $.command.run(TOGGLE)
  await spawn($)
  await spawn($, { tool_use_id: 'tu-2', description: 'Review the fix', subagentType: 'reviewer' })
  await stepAs($, 'sub-1', { model: 'claude-sonnet-5-5', effort: 'high' })
  for (const [tool, input] of [
    ['Read', { file_path: '/work/src/a.ts' }], ['Grep', { pattern: 'parseToken' }], ['Read', { file_path: '/work/src/parser.ts' }],
    ['Edit', { file_path: '/work/src/parser.ts', old_string: 'a', new_string: 'b' }], ['Bash', { command: 'npm test' }],
    ['Glob', { pattern: 'src/**/*.ts' }], ['Read', { file_path: '/work/hooks/x.tsx' }], ['Edit', { file_path: '/work/hooks/x.tsx', old_string: 'a', new_string: 'b' }],
    ['Bash', { command: 'npm run lint' }],
  ] as const) {
    arranged.world.tool = async () => (tool === 'Bash' && input.command === 'npm test' ? { result: 'failed', isError: true } : tool === 'Glob' ? { deny: 'not here' } : { result: 'ok' })
    await callAs($, 'sub-1', tool, input)
  }
  arranged.world.tool = async () => {
    await arranged.clock.sleep(60_000)

    return { result: 'ok' }
  }
  const running = callAs($, 'sub-1', 'Read', { file_path: '/work/src/lexer.ts' })
  await arranged.clock.advance(2000)
  // A test ends with that call answered, so nothing of it outlives the test.
  const settled = async (): Promise<void> => {
    await arranged.clock.advance(60_000)
    await running
  }

  return { ...arranged, running, settled }
}

describe('trails', () => {
  test('a call\'s main argument: a path keeps its end, a command its start, at most 160 characters', () => {
    expect(ARG_MAX).toBe(160)
    expect(mainArgOf({ file_path: '/work/src/a.ts' })).toBe('/work/src/a.ts')
    expect(mainArgOf({ command: 'npm test' })).toBe('npm test')
    expect(mainArgOf({ pattern: 'parseToken' })).toBe('parseToken')
    expect(mainArgOf({ tool: 'Grep', pattern: 'parseToken', path: '/work/src' })).toBe('parseToken')
    expect(mainArgOf({ tool: 'Glob', pattern: '**/*.ts', path: '/work' })).toBe('**/*.ts')
    expect(mainArgOf({ url: 'https://example.com' })).toBe('https://example.com')
    expect(mainArgOf({ to: 'reviewer' })).toBe('reviewer')
    expect(mainArgOf({ old_string: 'a' })).toBe(undefined)
    const path = `/work/${'deep/'.repeat(60)}file.ts`
    expect([...(mainArgOf({ file_path: path }) ?? '')]).toHaveLength(ARG_MAX)
    expect(mainArgOf({ file_path: path })).toEndWith('file.ts')
    expect(mainArgOf({ command: `echo ${'x'.repeat(300)}` })).toEndWith('…')
    expect(mainArgOf({ command: 'a\nb\tc' })).toBe('a b c')
  })

  test('a trail keeps 200 calls an agent and 800 in all, the oldest of other agents first, and drops agents no longer kept', () => {
    expect(TRAIL_MAX).toBe(200)
    expect(TRAILS_TOTAL).toBe(800)
    let trails: Record<string, HudTrailStep[]> = { gone: [{ tool: 'Read', at: 0 }] }
    for (let index = 0; index < 205; index += 1) trails = trailAdded(trails, 'a', { tool: 'Read', arg: `f${index}`, at: index }, id => id !== 'gone')
    expect(trails.a).toHaveLength(200)
    expect(trails.a?.[0]?.arg).toBe('f5')
    expect(trails.a?.at(-1)?.arg).toBe('f204')
    expect(trails.gone).toBe(undefined)
    // Four agents of 200 calls fill the total; another agent's call drops the oldest call of all.
    let all: Record<string, HudTrailStep[]> = {}
    for (let agent = 0; agent < 4; agent += 1) {
      all[`x${agent}`] = Array.from({ length: 200 }, (_, index) => ({ tool: 'Read', at: agent * 1000 + index }))
    }
    all = trailAdded(all, 'y', { tool: 'Bash', at: 99_999 }, () => true)
    expect(Object.values(all).reduce((sum, steps) => sum + steps.length, 0)).toBe(800)
    expect(all.x0).toHaveLength(199)
    expect(all.x0?.[0]?.at).toBe(1)
    expect(all.x3).toHaveLength(200)
    expect(all.y).toHaveLength(1)
  })

  test('a call\'s end finds its open step by tool and start: its duration and outcome; else the trails as they were', () => {
    const trails = { a: [{ tool: 'Read', at: 5 }, { tool: 'Read', at: 9 }] }
    const ended = trailEnded(trails, 'a', { tool: 'Read', at: 9 }, { ms: 1234.4, outcome: 'denied' })
    expect(ended.a).toEqual([{ tool: 'Read', at: 5 }, { tool: 'Read', at: 9, ms: 1234, outcome: 'denied' }])
    expect(trailEnded(ended, 'a', { tool: 'Read', at: 9 }, { ms: 1, outcome: 'ok' })).toBe(ended)
    expect(trailEnded(ended, 'b', { tool: 'Read', at: 9 }, { ms: 1, outcome: 'ok' })).toBe(ended)
  })

  test('each call writes its trail as it starts and as it ends, with its time and outcome; dropped with the agent', async ($, on) => {
    const { held, world, clock, running } = await busy($, on)
    const trails = held.get('trails')?.value as Record<string, HudTrailStep[]>
    expect(trails['sub-1']).toHaveLength(10)
    expect(trails['sub-1']?.map(step => step.outcome)).toEqual(['ok', 'ok', 'ok', 'ok', 'error', 'denied', 'ok', 'ok', 'ok', undefined])
    expect(trails['sub-1']?.every((step, index) => index === 9 || step.ms === 0)).toBe(true)
    expect(trails['sub-1']?.at(-1)).toEqual({ tool: 'Read', arg: '/work/src/lexer.ts', at: NOW })
    // Two writes per ended call, one for the call still running.
    expect(world.writes.filter(key => key === 'trails')).toHaveLength(19)
    // A main-loop call writes none.
    world.tool = async () => ({ result: 'ok' })
    await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' } as never)
    expect(world.writes.filter(key => key === 'trails')).toHaveLength(19)
    // Its end: a minute later.
    await clock.advance(60_000)
    await running
    expect((held.get('trails')?.value as Record<string, HudTrailStep[]>)['sub-1']?.at(-1)).toMatchObject({ ms: 60_000, outcome: 'ok' })
    // Finished and cleared from the board: its trail goes with it.
    await complete($, 'sub-1')
    await $.command.run({ ...TOGGLE, args: 'clear' })
    expect((held.get('trails')?.value as Record<string, unknown>)['sub-1']).toBe(undefined)
  })

  test('with inspect off: no row, session or mascot button, no trail, no ledger, no selection', { options: { inspect: false } }, async ($, on) => {
    const { held, settled } = await busy($, on)
    expect(held.has('trails')).toBe(false)
    expect(held.has('ledger')).toBe(false)
    for (const surface of SURFACES) {
      const ui = await mount($, surface, 100)
      // The group header's minimise Button alone.
      expect((await ui.findAll({ type: 'Button' })).map(one => one.key)).toEqual(['group:agents'])
      expect(await ui.find({ key: 'session' })).toBe(undefined)
      await ui.unmount()
    }
    expect(held.has('selected')).toBe(false)
    await settled()
  })
})

describe('the inspect view', () => {
  test('a row\'s button selects its agent: the view takes the pane under the HUD (lists, TODO and scene hidden), at 100 and 48 columns, terminal and desktop', async ($, on) => {
    const { held, world, settled } = await busy($, on)
    seedHud(held)
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        const ui = await mount($, surface, columns)
        expect(await ui.find({ key: 'mascots' })).toBeDefined()
        expect(await viewOf(ui)).toEqual([])
        await press(ui, 'inspect:sub-1')
        expect(selection(held)).toEqual({ id: 'sub-1', kind: 'agent' })
        const rows = await viewOf(ui)
        // The HUD stays; the TODO section and the lists give way; the scene stays mounted, paused at no height.
        expect(await ui.find({ key: 'hud' })).toBeDefined()
        expect(await ui.find({ key: 'todos' })).toBe(undefined)
        expect(await ui.find({ key: 'agents' })).toBe(undefined)
        const paused = await ui.find({ key: 'mascots' })
        expect(paused?.type).toBe('Client')
        expect(paused?.props.height).toBe(0)
        expect((paused?.props.props as { paused?: boolean }).paused).toBe(true)
        if (columns >= 60) expect(rows[0]).toBe('◂ Back   ● Explore · sonnet-5-5 · high · running · 2s · 10 calls')
        else expect(rows.slice(0, 2)).toEqual(['◂ Back   ● Explore', '  sonnet-5-5 · high · running · 2s · 10 calls'])
        expect(rows).toContain('[ Task ]  Trail   Said   Agents')
        for (const row of rows) expect(displayWidth(row), `${surface} @${columns}: ${row}`).toBeLessThanOrEqual(columns)
        // The active tab is the primary Button, the rest plain and dim.
        expect((await ui.find({ key: 'tab:task' }))?.props.variant).toBe('primary')
        expect((await ui.find({ key: 'tab:trail' }))?.props).toMatchObject({ plain: true, dimColor: true })
        // Back clears the selection; the lists and the scene return.
        await press(ui, 'detail:back')
        expect(selection(held)).toBe(null)
        expect(await viewOf(ui)).toEqual([])
        expect(await ui.find({ key: 'agents' })).toBeDefined()
        expect((await ui.find({ key: 'mascots' }))?.props.height).toBeGreaterThan(0)
        await ui.unmount()
      }
    }
    expect(world.fetches.every(id => id === 'sub-1')).toBe(true)
    await settled()
  })

  test('Task: the description, then the prompt, every row kept and wrapped, at 100 and 48 columns on both surfaces', async ($, on) => {
    const { held, settled } = await busy($, on)
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        const ui = await mount($, surface, columns, 8)
        await press(ui, 'inspect:sub-1')
        const rows = await viewOf(ui)
        const body = rows.slice(rows.indexOf('[ Task ]  Trail   Said   Agents') + 2)
        const words = (lines: string[]): string => lines.join(' ').replace(/ +/g, ' ').trim()
        expect(words(body)).toBe(words(['Find the bug in the parser and fix it, then run the tests and report what changed', '', ...PROMPT.split('\n')]))
        // The prompt's paragraphs stay apart; nothing is cut, though the pane is eight rows tall: it scrolls.
        expect(body.filter(row => row === '')).toHaveLength(2)
        expect(body.some(row => row.includes('…'))).toBe(false)
        for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(columns)
        // The description is bold.
        const description = await ui.find({ key: 'detail:task:description:0' })
        if (surface === 'terminal') expect(description?.children).toMatchObject([{ children: [{ props: { bold: true } }] }])
        else expect(textRuns(rowSource(description) ?? '').every(run => run.props.bold === true)).toBe(true)
        await press(ui, 'detail:back')
        await ui.unmount()
      }
    }
    expect(selection(held)).toBe(null)
    await settled()
  })

  test('Trail: every call, the newest last, its time, span and outcome, the current one in the accent, at 100 and 48 columns on both surfaces', async ($, on) => {
    const { held, world, settled } = await busy($, on)
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        const ui = await mount($, surface, columns)
        await press(ui, 'inspect:sub-1')
        await press(ui, 'tab:trail')
        expect(selection(held)).toEqual({ id: 'sub-1', kind: 'agent', tab: 'trail' })
        const rows = await viewOf(ui)
        expect(rows).toContain('Task   [ Trail ]  Said   Agents')
        const calls = rows.filter(row => /^\d\d:\d\d:\d\d /.test(row))
        expect(calls).toHaveLength(10)
        expect(calls[0]).toMatch(new RegExp(`^${clockOf(NOW)} {3}0\\.0s ok {5}Read /work/src/a\\.ts$`))
        expect(calls[4]).toMatch(/ 0\.0s error {2}Bash npm test$/)
        expect(calls[5]).toMatch(/ 0\.0s denied Glob src\/\*\*\/\*\.ts$/)
        expect(calls[9]).toMatch(new RegExp(`^${clockOf(NOW)} {3}2\\.0s now {4}Read`))
        expect(rows.join('\n')).toContain('/work/src/lexer.ts')
        for (const row of rows) expect(displayWidth(row), `${surface} @${columns}: ${row}`).toBeLessThanOrEqual(columns)
        // The current call is drawn in the accent; a failure in the error colour, a denial in the warning one.
        expect(coloured(await ui.find({ key: 'detail:trail:9' }), 'claude')).toBe(true)
        expect(coloured(await ui.find({ key: 'detail:trail:4' }), 'error')).toBe(true)
        expect(coloured(await ui.find({ key: 'detail:trail:5' }), 'warning')).toBe(true)
        expect(coloured(await ui.find({ key: 'detail:trail:0' }), 'claude')).toBe(false)
        await press(ui, 'detail:back')
        await ui.unmount()
      }
    }
    // The trail is no reason to read the conversation again.
    expect(world.fetches).toEqual(['sub-1', 'sub-1', 'sub-1', 'sub-1'])
    await settled()
  })

  test('Said: the last ten assistant messages, wrapped, the newest at the bottom, at 100 and 48 columns on both surfaces', async ($, on) => {
    const { world, settled } = await busy($, on)
    world.said = Array.from({ length: 12 }, (_, index) => `Message ${index + 1}: ${'word '.repeat(20).trim()}`)
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        const ui = await mount($, surface, columns)
        await press(ui, 'inspect:sub-1')
        await press(ui, 'tab:said')
        const rows = await viewOf(ui)
        const firsts = rows.filter(row => row.startsWith('Message '))
        expect(firsts.map(row => row.split(':')[0])).toEqual(Array.from({ length: SAID_MAX }, (_, index) => `Message ${index + 3}`))
        // Wrapped, a blank row between messages.
        expect(rows.filter(row => row.startsWith('word')).length).toBeGreaterThan(0)
        for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(columns)
        await press(ui, 'detail:back')
        await ui.unmount()
      }
    }
    await settled()
  })

  test('Agents: the lists under the tabs; a row\'s press jumps to that agent on the same tab', async ($, on) => {
    const { held, settled } = await busy($, on)
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        const ui = await mount($, surface, columns)
        await press(ui, 'inspect:sub-1')
        await press(ui, 'tab:agents')
        const rows = await viewOf(ui)
        expect(rows).toContain('Task   Trail   Said   [ Agents ]')
        expect(rows).toContain('▸◆ Session')
        expect(rows.some(row => row.startsWith('▾ Agents · 2 running'))).toBe(true)
        expect(await ui.find({ key: 'agents' })).toBeDefined()
        await press(ui, 'inspect:sub-2')
        expect(selection(held)).toEqual({ id: 'sub-2', kind: 'agent', tab: 'agents' })
        expect((await viewOf(ui))[0]).toMatch(/^◂ Back {3}● reviewer/)
        await press(ui, 'detail:back')
        await ui.unmount()
      }
    }
    await settled()
  })

  test('the tabs switch on a press only: the active tab\'s press writes nothing; Back is the way out (no `[`, `]` or Esc reaches a pane)', async ($, on) => {
    const { held, world, settled } = await busy($, on)
    const ui = await mount($, 'terminal', 100)
    await press(ui, 'inspect:sub-1')
    const writes = (): number => world.writes.filter(key => key === 'selected').length
    const before = writes()
    await press(ui, 'tab:task')
    expect(writes()).toBe(before)
    for (const tab of ['trail', 'said', 'agents', 'task'] as const) {
      await press(ui, `tab:${tab}`)
      expect(tabOf(selection(held) as HudSelection)).toBe(tab)
    }
    expect(writes()).toBe(before + 4)
    // No tab carries a hotkey: a Button's is one digit or letter, and neither `[`, `]` nor Esc is one.
    for (const button of await ui.findAll({ type: 'Button' })) expect(button.props.hotkey).toBe(undefined)
    await ui.unmount()
    await settled()
  })

  test('the conversation is read on selection, on a tab that needs it when not held, and on that agent\'s turn ends; never per frame', async ($, on) => {
    const { world, clock, running, held } = await busy($, on)
    const ui = await mount($, 'terminal', 100)
    expect(world.fetches).toEqual([])
    await press(ui, 'inspect:sub-1')
    expect(world.fetches).toEqual(['sub-1'])
    for (const tab of ['trail', 'said', 'task', 'said', 'agents']) await press(ui, `tab:${tab}`)
    // The same agent's row again (in the Agents tab): it is held.
    await press(ui, 'inspect:sub-1')
    for (let frame = 0; frame < 12; frame += 1) {
      await clock.advance(250)
      await ui.redraw()
    }
    expect(world.fetches).toEqual(['sub-1'])
    // Held for another agent (a mascot's click switched): its Said tab reads it.
    held.set('detail', { value: { id: 'other', at: NOW }, version: 99 })
    await press(ui, 'tab:said')
    expect(world.fetches).toEqual(['sub-1', 'sub-1'])
    // Another agent's turn end reads nothing; its own reads once.
    await complete($, 'sub-2')
    expect(world.fetches).toEqual(['sub-1', 'sub-1'])
    world.said = ['All tests pass now.']
    await clock.advance(60_000)
    await running
    await complete($, 'sub-1')
    expect(world.fetches).toEqual(['sub-1', 'sub-1', 'sub-1'])
    expect((await viewOf(ui)).join('\n')).toContain('All tests pass now.')
    await ui.unmount()
  })

  test('a workflow agent: its trail, a note for its task and its conversation, which is never asked for', async ($, on) => {
    const { held, world, clock } = arrange(on)
    await $.session.start(START)
    await clock.settle()
    await $.command.run(TOGGLE)
    const id = 'a8f3c2d19e7b4c21'
    await callAs($, id, 'Read', { file_path: '/work/README.md' })
    await callAs($, id, 'Bash', { command: 'npm test' })
    for (const columns of [72, 48]) {
      const ui = await mount($, 'terminal', columns)
      await press(ui, `inspect:${id}`)
      expect(selection(held)).toEqual({ id, kind: 'shadow' })
      const task = await viewOf(ui)
      expect(task[0]).toMatch(/^◂ Back {3}● wf-4c21/)
      expect(task.join(' ')).toContain('workflow')
      expect(task.at(-1)).toMatch(/prompt is not exposed$/)
      await press(ui, 'tab:trail')
      const trail = (await viewOf(ui)).join('\n')
      expect(trail).toContain('Read /work/README.md')
      expect(trail).toContain('Bash npm test')
      await press(ui, 'tab:said')
      const said = await viewOf(ui)
      expect(said.at(-1)).toBe(WORKFLOW_NOTE)
      const note = (await ui.findAll({ type: 'Text' })).find(one => one.text.trim() === WORKFLOW_NOTE && one.props.dimColor === true)
      expect(note?.props.dimColor).toBe(true)
      await press(ui, 'detail:back')
      await ui.unmount()
    }
    expect(world.fetches).toEqual([])
  })

  test('the classic scene: a mascot\'s pick selects; Back returns the scene', { options: { motion: 'classic' } }, async ($, on) => {
    const { held, clock, settled } = await busy($, on)
    for (const surface of SURFACES) {
      const ui = await mount($, surface, 100)
      // A mascot still walking in has no pick: past their arrival, both stand in their slots.
      await clock.advance(2000)
      await ui.redraw()
      const picks = (await ui.findAll({ type: 'Button' })).filter(one => one.key?.startsWith('pick:') === true)
      expect(picks.map(one => one.key).sort()).toEqual(['pick:sub-1', 'pick:sub-2'])
      await press(ui, 'pick:sub-2')
      expect(selection(held)).toEqual({ id: 'sub-2', kind: 'agent' })
      // The classic scene is not drawn while inspecting.
      expect(await ui.find({ key: 'mascots' })).toBe(undefined)
      expect((await ui.find({ key: 'detail:back' }))?.props.role).toBe(undefined)
      await press(ui, 'detail:back')
      expect(await ui.find({ key: 'mascots' })).toBeDefined()
      await ui.unmount()
    }
    await settled()
  })

  test('clearing a selected finished agent clears its detail once and stops reading inspection facts on redraw', async ($, on) => {
    const { held, world, clock } = arrange(on)
    await $.session.start(START)
    await clock.settle()
    await $.command.run(TOGGLE)
    await spawn($)
    const ui = await mount($, 'terminal', 100)
    await press(ui, 'inspect:sub-1')
    await complete($, 'sub-1')
    const writes = world.writes.filter(key => key === 'selected' || key === 'detail').length
    await $.command.run({ ...TOGGLE, args: 'clear' })
    expect(selection(held)).toBe(null)
    expect(held.get('detail')?.value).toBe(null)
    expect(world.writes.filter(key => key === 'selected' || key === 'detail')).toHaveLength(writes + 2)
    await clock.advance(10_000)
    await $.command.run({ ...TOGGLE, args: 'clear' })
    expect(world.writes.filter(key => key === 'selected' || key === 'detail')).toHaveLength(writes + 2)
    world.reads.length = 0
    await ui.redraw()
    expect(world.reads).not.toContain('trails')
    expect(world.reads).not.toContain('detail')
    // The ledger is still read on redraw: the alert strip counts its failed calls.
    await ui.unmount()
  })

  test('a selection still on the board survives reconciliation and clear without inspection writes', async ($, on) => {
    const { held, world, clock } = arrange(on)
    await $.session.start(START)
    await clock.settle()
    await $.command.run(TOGGLE)
    await spawn($)
    const ui = await mount($, 'terminal', 100)
    await press(ui, 'inspect:sub-1')
    const facts = held.get('detail')?.value
    const writes = world.writes.filter(key => key === 'selected' || key === 'detail').length
    await clock.advance(10_000)
    await $.command.run({ ...TOGGLE, args: 'clear' })
    expect(selection(held)).toEqual({ id: 'sub-1', kind: 'agent' })
    expect(held.get('detail')?.value).toBe(facts)
    expect(world.writes.filter(key => key === 'selected' || key === 'detail')).toHaveLength(writes)
    await ui.unmount()
  })

  test('reconciliation clears an expired workflow selection and a returning agent does not reopen it', async ($, on) => {
    const { held, world, clock } = arrange(on)
    await $.session.start(START)
    await clock.settle()
    await $.command.run(TOGGLE)
    const id = 'workflow00000001'
    await callAs($, id, 'Read', { file_path: '/work/a.ts' })
    const ui = await mount($, 'terminal', 100)
    await press(ui, `inspect:${id}`)
    await complete($, id)
    const writes = world.writes.filter(key => key === 'selected').length
    await clock.advance(40_000)
    expect(selection(held)).toBe(null)
    expect((held.get('shadows')?.value as Record<string, unknown>)[id]).toBe(undefined)
    expect(world.writes.filter(key => key === 'selected')).toHaveLength(writes + 1)
    await callAs($, id, 'Read', { file_path: '/work/b.ts' })
    await clock.advance(10_000)
    expect(selection(held)).toBe(null)
    expect(world.writes.filter(key => key === 'selected')).toHaveLength(writes + 1)
    expect(await viewOf(ui)).toEqual([])
    await ui.unmount()
  })

  test('a slow conversation read cannot overwrite a newer selection', async ($, on) => {
    const { held, world, clock } = arrange(on)
    await $.session.start(START)
    await clock.settle()
    await $.command.run(TOGGLE)
    await spawn($)
    await spawn($, { tool_use_id: 'tu-2' })
    const ui = await mount($, 'terminal', 100)
    world.slow = 'sub-1'
    world.said = ['Answer from A']
    const first = ui.press({ key: 'inspect:sub-1' })
    await clock.advance(10)
    world.said = ['Answer from B']
    await ui.press({ key: 'inspect:sub-2' })
    const writes = world.writes.filter(key => key === 'detail').length
    await clock.advance(5000)
    await first
    expect(selection(held)).toEqual({ id: 'sub-2', kind: 'agent' })
    expect(held.get('detail')?.value as HudDetailFacts).toMatchObject({ id: 'sub-2', said: ['Answer from B'] })
    expect(world.writes.filter(key => key === 'detail')).toHaveLength(writes)
    await ui.redraw()
    await press(ui, 'tab:said')
    expect((await viewOf(ui)).join('\n')).toContain('Answer from B')
    await ui.unmount()
  })

  test('a slow conversation read cannot restore detail after Back or clear', async ($, on) => {
    const { held, world, clock } = arrange(on)
    await $.session.start(START)
    await clock.settle()
    await $.command.run(TOGGLE)
    await spawn($)
    const ui = await mount($, 'terminal', 100)
    await press(ui, 'inspect:sub-1')
    world.slow = 'sub-1'
    const ending = complete($, 'sub-1')
    await clock.advance(10)
    await press(ui, 'detail:back')
    await $.command.run({ ...TOGGLE, args: 'clear' })
    const writes = world.writes.filter(key => key === 'detail').length
    await clock.advance(5000)
    await ending
    expect(selection(held)).toBe(null)
    expect(held.get('detail')?.value).toBe(null)
    expect(world.writes.filter(key => key === 'detail')).toHaveLength(writes)
    await ui.unmount()
  })

  test('the stored conversation: the prompt, then the last ten messages, each at most 2,000 characters', async ($, on) => {
    const { held, world, clock } = arrange(on)
    await $.session.start(START)
    await clock.settle()
    await spawn($)
    world.said = ['x'.repeat(3000), ...Array.from({ length: 11 }, (_, index) => `m${index}`)]
    const ui = await mount($, 'terminal', 100)
    await press(ui, 'inspect:sub-1')
    const facts = held.get('detail')?.value as HudDetailFacts
    expect(facts.prompt).toBe(PROMPT)
    expect(facts.said).toEqual(Array.from({ length: 10 }, (_, index) => `m${index + 1}`))
    world.said = ['x'.repeat(3000)]
    await complete($, 'sub-1')
    expect((held.get('detail')?.value as HudDetailFacts).said).toEqual(['x'.repeat(SAID_CHARS)])
    await ui.unmount()
  })

  test('a cramped pane still draws every row of the view: the pane scrolls, the selection stays', {
    options: { showGit: false, showTools: false, showTodos: false, showInventory: false },
  }, async ($, on) => {
    const { held } = arrange(on)
    held.set('agents', { value: { x: entry('x', { type: 'worker', description: 'A long task '.repeat(12) }) }, version: 1 })
    held.set('selected', { value: { id: 'x', kind: 'agent' }, version: 1 })
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        const ui = await mount($, surface, columns, 3)
        const rows = await viewOf(ui)
        expect(rows.length).toBeGreaterThan(3)
        expect(rows.join(' ')).toContain('A long task A long task')
        expect(selection(held)).toEqual({ id: 'x', kind: 'agent' })
        await ui.unmount()
      }
    }
  })

  test('rows: the header and tabs as drawn; the trail\'s spans; wrapping keeps paragraphs and breaks long words', () => {
    const header = { glyph: '●', glyphColour: 'claude', name: 'frontend', facts: ['opus-5-5', 'high', 'running', '8m14s', '43 calls'] }
    expect(rowText(headerRows(header, 72)[0]!)).toBe('◂ Back   ● frontend · opus-5-5 · high · running · 8m14s · 43 calls')
    expect(inspectLines(headerRows(header, 48))).toEqual(['◂ Back   ● frontend', '  opus-5-5 · high · running · 8m14s · 43 calls'])
    expect(rowText(headerRows(header, 60)[0]!)).toBe('◂ Back   ● frontend · opus-5-5 · high · running · 8m14s · 4…')
    expect(rowText(tabRow(['task', 'trail', 'said', 'agents'], 'task'))).toBe('[ Task ]  Trail   Said   Agents')
    expect(rowText(tabRow(['overview', 'cost', 'agents'], 'cost'))).toBe('Overview   [ Cost ]  Agents')
    expect([0, 420, 9999, 12_000, 245_000, 3_720_000].map(spanOf)).toEqual(['0.0s', '0.4s', '10.0s', '12s', '4m05', '1h02'])
    expect(wrapAll('one two\n\n\nthree', 20)).toEqual(['one two', '', 'three'])
    expect(wrapAll(`a ${'x'.repeat(25)}`, 10)).toEqual(['a', 'xxxxxxxxxx', 'xxxxxxxxxx', 'xxxxx'])
    expect(wrapText('a b c', 3, 6)).toEqual(['a b', 'c'])
    expect(lastAssistantText([{ role: 'assistant', text: 'one' }, { role: 'assistant', text: '  ' }, { role: 'user', text: 'x' }])).toBe('one')
    expect(promptOf([{ role: 'user', text: ' ' }, { role: 'user', text: 'go' }])).toBe('go')
    // An open call of an agent no longer running reads `?`; one never ended is never `now`.
    const trail = trailRows({ kind: 'agent', running: false, trail: [{ tool: 'Read', arg: 'a.ts', at: NOW }] }, 72, NOW + 5000)
    expect(inspectLines(trail)).toEqual([`${clockOf(NOW)}${' '.repeat(8)}?${' '.repeat(6)}Read a.ts`])
    // Narrow, a call that does not fit puts its argument on rows of its own.
    const narrow = trailRows({ kind: 'agent', running: true, trail: [{ tool: 'Read', arg: '/work/hooks/scene-client.tsx', at: NOW, ms: 300, outcome: 'ok' }] }, 48, NOW)
    expect(inspectLines(narrow)).toEqual([`${clockOf(NOW)}   0.3s ok     Read`, '  /work/hooks/scene-client.tsx'])
  })
})

describe('the session tab', () => {
  test('the session\'s row heads the lists; its press, or the crowned mascot\'s click, opens the Overview; the session is never pruned', async ($, on) => {
    const { held, world, clock } = arrange(on)
    await $.session.start(START)
    await clock.settle()
    await $.command.run(TOGGLE)
    await spawn($)
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        const ui = await mount($, surface, columns)
        const lists = listRows((await ui.find({ key: 'agents' })) as Described)
        expect(lists[0]).toBe('▸◆ Session')
        expect(lists[1]).toMatch(/^▾ Agents · 1 running/)
        await press(ui, 'inspect:main')
        expect(selection(held)).toEqual({ id: 'main', kind: 'main' })
        const rows = await viewOf(ui)
        expect(rows[0]).toMatch(/^◂ Back {3}◆ Session/)
        expect(rows).toContain('[ Overview ]  Cost   Agents')
        await press(ui, 'detail:back')
        await ui.unmount()
      }
    }
    const ui = await mount($, 'terminal', 100)
    await ui.post({ kind: 'inspect', id: 'main' }, { in: 'mascots' })
    expect(selection(held)).toEqual({ id: 'main', kind: 'main' })
    // Reconciliation keeps it; its view reads no conversation.
    await clock.advance(10_000)
    expect(selection(held)).toEqual({ id: 'main', kind: 'main' })
    expect(world.fetches).toEqual([])
    await ui.unmount()
  })

  test('Overview: time and busy share, turns and compactions, the context\'s growth, tokens, the limits\' burn, asks, failures and agents', async ($, on) => {
    const { held, world, clock } = arrange(on)
    await $.session.start(START)
    await clock.settle()
    seedHud(held)
    held.set('usage', { value: {
      ...full.usage,
      tokens: { input: 1_200_000, output: 84_000, cacheRead: 9_800_000, cacheWrite: 640_000 },
      turns: 23,
      busyMs: 36 * MINUTE,
      contextSamples: [340_000, 358_000, 376_000, 394_000, 412_000],
      limitSamples: { five_hour: [{ at: NOW - 40 * MINUTE, percent: 25 }, { at: NOW - 20 * MINUTE, percent: 28 }, { at: NOW - 10 * MINUTE, percent: 31 }] },
    } as HudUsageFacts, version: 5 })
    held.set('main', { value: { compactedAt: NOW - 14 * MINUTE, idleSince: NOW - MINUTE }, version: 1 })
    held.set('inventory', { value: { ...full.inventory, compactAt: 950_000 }, version: 2 })
    await $.command.run(TOGGLE)
    await spawn($)
    // A denied call and a failed one, in any loop.
    world.tool = async () => ({ deny: 'no' })
    await callAs($, 'sub-1', 'Bash', { command: 'rm -rf /' })
    world.tool = async () => ({ result: 'x', isError: true })
    await $.tool.call({ tool: 'Bash', command: 'false' } as never)
    // A request each, and a run that ended.
    world.stepUsage = { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
    await stepAs($, 'sub-1')
    await spawn($, { tool_use_id: 'tu-2' })
    await stepAs($, 'sub-2')
    await clock.advance(2 * MINUTE)
    await complete($, 'sub-2')
    for (const columns of [72, 48]) {
      const ui = await mount($, 'terminal', columns)
      await press(ui, 'inspect:main')
      const rows = await viewOf(ui)
      // Each fact whole on one row; a label's facts flow onto more rows when the pane is narrow.
      const has = (label: string, ...pieces: string[]): void => {
        const at = rows.findIndex(row => row.startsWith(label.padEnd(9)))
        expect(at, `${label} @${columns}`).toBeGreaterThanOrEqual(0)
        const end = rows.findIndex((row, index) => index > at && !row.startsWith(' '.repeat(9)))
        const text = rows.slice(at, end < 0 ? undefined : end).join(' · ')
        for (const piece of pieces) expect(text, `${label} @${columns}`).toContain(piece)
      }
      has('time', '1h14m', 'busy 49%', 'idle 51%')
      has('turns', '23 turns', '3 compactions', 'last 16m ago')
      has('context', '412k / 1.0M', '41%', '+18k/turn', 'compacts in ~30 turns')
      has('tokens', '1.2M in', '84k out', '9.8M cache read', '640k cache write', '84% cache hit')
      // 25 % at the window's start, 31 % now: 6 % in 30 minutes, 69 % to go: 5h45, after its reset.
      has('limits', '5h 31%', 'resets before the cap', AT_5H, '7d 12%', '—', AT_7D)
      has('asks', 'none waiting')
      has('failures', '1 denied', '1 error')
      has('agents', '2 spawned', '1 running', '1 done', '4 agent-min')
      for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(columns)
      await press(ui, 'detail:back')
      await ui.unmount()
    }
  })

  test('the limits\' burn names the time to the cap when it comes before the reset', () => {
    const rows = overviewRows({
      compactions: 0, limits: [{ label: '5h', percent: 60, eta: 130 * MINUTE, untilReset: 200 * MINUTE, reset: '↻ 16:00' }], asks: 2, failures: { denied: 0, error: 0 },
      runs: { spawned: 0, running: 0, done: 0, failed: 0, ms: 0 },
    }, 72)
    expect(inspectLines(rows)).toContain('limits   5h 60% · cap in ~2h10 · ↻ 16:00')
    expect(inspectLines(rows)).toContain('asks     2 waiting')
  })

  test('the files the main loop edited, moved off the HUD in 1.2.0, count on the turns row; none, nothing', () => {
    const view = { compactions: 3, turns: 12, limits: [], asks: 0, failures: { denied: 0, error: 0 }, runs: { spawned: 0, running: 0, done: 0, failed: 0, ms: 0 } }
    expect(inspectLines(overviewRows({ ...view, edited: 7 }, 72))).toContain('turns    12 turns · 3 compactions · 7 files edited')
    expect(inspectLines(overviewRows({ ...view, edited: 1 }, 72))).toContain('turns    12 turns · 3 compactions · 1 file edited')
    expect(inspectLines(overviewRows(view, 72))).toContain('turns    12 turns · 3 compactions')
  })

  test('Cost: the session\'s total and rate, each model a Button that opens to its users by cost; open models written on a press only', async ($, on) => {
    const { held, world, clock } = arrange(on)
    await $.session.start(START)
    await clock.settle()
    seedHud(held)
    await $.command.run(TOGGLE)
    const book = async (agentId: string | undefined, model: string, input: number, output: number) => {
      world.stepUsage = { input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model }
      await stepAs($, agentId, { model })
    }
    world.model = 'claude-opus-5-5'
    await spawn($, { subagentType: 'frontend', description: 'Desktop: draw mascots in pixels, keep the terminal rows' })
    await book(undefined, 'claude-opus-5-5', 5_000_000, 200_000)
    await book('sub-1', 'claude-opus-5-5', 2_000_000, 100_000)
    for (let index = 0; index < 15; index += 1) {
      const id = `wf${String(index).padStart(14, '0')}`
      await callAs($, id, 'Read', { file_path: '/work/a.ts' })
      await book(id, 'claude-sonnet-5-5', 100_000, 10_000)
    }
    for (const surface of SURFACES) {
      for (const columns of [72, 48]) {
        const ui = await mount($, surface, columns)
        await press(ui, 'inspect:main')
        await press(ui, 'tab:cost')
        expect(selection(held)).toEqual({ id: 'main', kind: 'main', tab: 'cost' })
        const closed = await viewOf(ui)
        expect(closed).toContain('Overview   [ Cost ]  Agents')
        expect(closed).toContain('Cost $4.21 · $4/h')
        const opus = closed.find(row => row.startsWith('▸ opus-5-5'))
        expect(opus).toMatch(/\$3\.72 +88%$/)
        expect(closed.find(row => row.startsWith('▸ sonnet-5-5'))).toMatch(/\$0\.49 +12%$/)
        expect((await ui.find({ key: 'cost:opus-5-5' }))?.type).toBe('Button')
        const writes = world.writes.filter(key => key === 'listView').length
        await press(ui, 'cost:opus-5-5')
        await press(ui, 'cost:sonnet-5-5')
        expect(world.writes.filter(key => key === 'listView')).toHaveLength(writes + 2)
        expect((held.get('listView')?.value as HudListView).models).toEqual(['opus-5-5', 'sonnet-5-5'])
        const open = await viewOf(ui)
        const at = open.findIndex(row => row.startsWith('▾ opus-5-5'))
        expect(open[at + 1]).toMatch(/^ {2}• main +\$2\.62$/)
        expect(open[at + 2]).toMatch(/^ {2}• frontend {2}Desktop: draw .*… +\$1\.09$/)
        expect(open.find(row => row.includes('• workflow ×15'))).toMatch(/\$0\.49$/)
        expect(open.join(' ').replace(/\s+/g, ' ')).toContain(COST_NOTE)
        for (const row of open) expect(displayWidth(row), `${surface} @${columns}: ${row}`).toBeLessThanOrEqual(columns)
        // Ticks and redraws write nothing.
        await clock.advance(3000)
        await ui.redraw()
        expect(world.writes.filter(key => key === 'listView')).toHaveLength(writes + 2)
        await press(ui, 'cost:opus-5-5')
        await press(ui, 'cost:sonnet-5-5')
        expect(held.get('listView')?.value).toEqual({})
        await press(ui, 'detail:back')
        await ui.unmount()
      }
    }
  })

  test('the Cost tree with no requests counted, and with no total from the session', () => {
    expect(inspectLines(costRows({ models: [] }, 72, new Set()))).toEqual(['Cost —', '', 'no requests counted yet'])
    const rows = inspectLines(costRows({ duration: 30 * MINUTE, models: [{ model: 'opus-5-5', usd: 12.4, share: 1, priced: true, users: [] }] }, 72, new Set()))
    expect(rows[0]).toBe('Cost ~$12.40 · $25/h')
    expect(rows.join(' ').replace(/\s+/g, ' ')).toContain(COST_ESTIMATE_NOTE)
  })

  test('/clear empties the ledger and keeps the lists\' expansion; another end keeps both', async ($, on) => {
    const { held, world, clock } = arrange(on)
    await $.session.start(START)
    await clock.settle()
    world.stepUsage = { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
    await stepAs($, undefined)
    held.set('listView', { value: { agents: true, models: ['opus-5-5'] } satisfies HudListView, version: 1 })
    await $.session.end({ reason: 'other', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
    expect(Object.keys((held.get('ledger')?.value as HudLedger).entries)).toEqual(['main'])
    await $.session.end({ reason: 'clear', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
    expect(held.get('ledger')?.value).toEqual({ entries: {}, others: {} })
    expect(held.get('listView')?.value).toEqual({ agents: true, models: ['opus-5-5'] })
    // Nothing to clear the next time: no write.
    const writes = world.writes.filter(key => key === 'ledger').length
    await $.session.end({ reason: 'clear', sessionId: 's1' } as Parameters<Engine['session']['end']>[0])
    expect(world.writes.filter(key => key === 'ledger')).toHaveLength(writes)
  })

  test('/mod-hud facts includes the ledger\'s summary and the lists\' expansion once there are any', async ($, on) => {
    const { held, world, clock } = arrange(on)
    await $.session.start(START)
    await clock.settle()
    const factsOf = async () => {
      const { text = '' } = await $.command.run({ ...TOGGLE, args: 'facts' })

      return JSON.parse(text.split('\n').slice(0, -1).join('\n')) as { ledger?: Record<string, unknown>; listView?: HudListView }
    }
    expect((await factsOf()).ledger).toBe(undefined)
    expect((await factsOf()).listView).toBe(undefined)
    world.stepUsage = { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
    await stepAs($, undefined)
    held.set('listView', { value: { workflow: true }, version: 1 })
    const facts = await factsOf()
    expect(facts.ledger).toMatchObject({ loops: 1, models: { 'opus-5-5': { usd: 4, input: 1_000_000, users: 1 } }, runs: { spawned: 0 } })
    expect(facts.listView).toEqual({ workflow: true })
  })
})

describe('messages in the pane', () => {
  test('a SendMessage to a known agent\'s name sends a bubble across the scene; to an unknown one, none', { options: { wander: false, motion: 'classic' } }, async ($, on) => {
    const { clock } = arrange(on)
    await $.session.start(START)
    await clock.settle()
    await $.command.run(TOGGLE)
    await spawn($, { name: 'alpha' })
    await spawn($, { tool_use_id: 'tu-2', name: 'beta' })
    await clock.advance(8000)
    const bubbles = async (ui: Drawing): Promise<number> => {
      await ui.redraw()
      const scene = await ui.find({ key: 'mascots' })
      const accented = (node: unknown): number => {
        if (typeof node !== 'object' || node === null) return 0
        const one = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
        const own = one.type === 'Text' && one.props?.color === 'claude' && (one.children ?? []).join('').includes('○') ? 1 : 0

        return own + (one.children ?? []).reduce<number>((sum, child) => sum + accented(child), 0)
      }

      return accented(scene)
    }
    const ui = await mount($, 'terminal', 100, 30)
    expect(await bubbles(ui)).toBe(0)
    await callAs($, 'sub-1', 'SendMessage', { to: 'nobody', message: 'hi' })
    await clock.advance(250)
    expect(await bubbles(ui)).toBe(0)
    await callAs($, 'sub-2', 'SendMessage', { to: 'alpha', message: 'done with the parser' })
    await clock.advance(250)
    expect(await bubbles(ui)).toBe(1)
    await clock.advance(20 * 250)
    expect(await bubbles(ui)).toBe(0)
    await ui.unmount()
  })
})

test('a tool ending after its trail was evicted makes no trail write', async ($, on) => {
  const { held, world, clock } = arrange(on)
  await $.session.start(START)
  await clock.settle()
  await spawn($)
  world.tool = async () => { await clock.sleep(1000); return { result: 'ok' } }
  const running = callAs($, 'sub-1', 'Read', { file_path: '/work/a.ts' })
  await clock.settle()
  expect((held.get('trails')?.value as Record<string, unknown>)['sub-1']).toBeDefined()
  held.set('trails', { value: {}, version: 99 })
  const writes = world.writes.filter(key => key === 'trails').length
  await clock.advance(1000)
  await running
  expect(world.writes.filter(key => key === 'trails')).toHaveLength(writes)
})

test('a compaction fork request counts once, from turn.step, even when session.compact repeats its usage', async ($, on) => {
  const { held, world, clock } = arrange(on)
  world.stepUsage = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 30, model: 'claude-opus-5-5' }
  on('session.compact', async () => {
    await stepAs($, 'compact-fork')
    await complete($, 'compact-fork')
    return { messages: [{ role: 'assistant', text: 'summary', toolUses: [] }], usage: world.stepUsage as never }
  })
  await $.session.start(START)
  await clock.settle()
  seedHud(held)
  const before = (held.get('usage')?.value as HudUsageFacts).tokens?.input ?? 0
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'the plan', toolUses: [] }], instructions: 'keep the plan' })
  expect((held.get('usage')?.value as HudUsageFacts).tokens?.input).toBe(before + 1000)
  const ledger = held.get('ledger')?.value as HudLedger
  expect(Object.keys(ledger.entries)).toEqual(['compact-fork'])
  expect(ledger.entries['compact-fork']?.models['claude-opus-5-5']?.input).toBe(1000)
  expect((held.get('usage')?.value as HudUsageFacts).compactions).toBe(4)
})

// ---------------------------------------------------------------------------
// The desktop sets the pane's text in a proportional font, so it draws the
// lists and the inspect view in pixels (hooks/text-svg.ts): each row an Svg on
// the 8×16 grid, each Button an absolute one-row Box over its own cells.
// ---------------------------------------------------------------------------

/** Every Button laid over a row: its key and label, the row it is over, and its Box's place. */
type Overlay = { key: string; label: string; primary: boolean; row: string; top: number; left: number; width: number; height: number }

const overlaysIn = (node: unknown, row = ''): Overlay[] => {
  if (typeof node !== 'object' || node === null) return []
  const one = node as Described & { key?: string }
  const here = typeof one.props?.key === 'string' && one.props.position !== 'absolute' ? String(one.props.key) : row
  const button = one.props?.position === 'absolute' ? ((one.children ?? []) as Described[]).find(child => child.type === 'Button') : undefined

  return [
    ...(button === undefined
      ? []
      : [{
          key: String(button.props?.key),
          label: String(button.props?.label),
          primary: button.props?.variant === 'primary',
          row: here,
          top: Number(one.props?.top),
          left: Number(one.props?.left),
          width: Number(one.props?.width),
          height: Number(one.props?.height),
        }]),
    ...(one.children ?? []).flatMap(child => overlaysIn(child, here)),
  ]
}

describe('in pixels on the desktop', () => {
  test('the lists read as the terminal\'s, row for row; every Button an absolute Box over its own blank cells; a press there selects, as on the terminal', async ($, on) => {
    const { held, settled } = await busy($, on)
    seedHud(held)
    for (const columns of WIDTHS) {
      const terminal = await mount($, 'terminal', columns)
      const expected = listRows((await terminal.find({ key: 'agents' })) as Described)
      await terminal.unmount()
      const ui = await mount($, 'desktop', columns)
      const agents = await ui.find({ key: 'agents' })
      // The terminal's Texts are cut where Ink draws them; the desktop's rows are cut before they are drawn, at the same cells.
      const cut = (lines: readonly string[]): string[] => lines.map(line => truncate(line, columns - 1))
      expect(cut(textRowsOf(agents)), `@${columns}`).toEqual(cut(expected))
      for (const line of textRowsOf(agents)) expect(displayWidth(line), `@${columns}: ${line}`).toBeLessThanOrEqual(columns)
      // No Text anywhere: the HUD, the TODO section and the lists are pixels; the scene is its Client.
      expect(await ui.findAll({ type: 'Text' })).toEqual([])
      const overlays = overlaysIn(agents)
      expect(overlays.map(one => one.key).sort()).toEqual(['group:agents', 'inspect:main', 'inspect:sub-1', 'inspect:sub-2'])
      for (const overlay of overlays) {
        const where = `${overlay.key} @${columns}`
        expect([overlay.top, overlay.height], where).toEqual([0, 1])
        expect(overlay.width, where).toBe(displayWidth(overlay.label))
        // The row's own document leaves the Button's cells blank, so nothing is drawn twice.
        const box = await ui.find({ key: overlay.row })
        const drawn = [...textLine(rowSource(box) ?? '')]
        expect(drawn.slice(overlay.left, overlay.left + overlay.width).join('').trim(), where).toBe('')
      }
      // The inspect Button starts each agent row; the glyph, then one blank, then the name.
      const row = textRowsOf(await ui.find({ key: 'agent:sub-1' }))[0] ?? ''
      expect(row, `@${columns}`).toMatch(/^▸● Explore/)
      expect(overlays.find(one => one.key === 'inspect:sub-1')?.left).toBe(0)
      // Every row a row high, its Svg on the grid: 16 pixels down, 8 a cell across, never past the pane.
      for (const svg of svgsOf(agents)) {
        const size = textSvgSize(String(svg.props?.source))
        expect(svg.props?.height).toBe(CELL_HEIGHT)
        expect(Number(svg.props?.width) % CELL_WIDTH).toBe(0)
        expect(size.columns).toBeLessThanOrEqual(columns)
      }
      // The header's separators are middle dots (U+00B7), drawn on the row's one baseline.
      const header = rowSource(await ui.find({ key: 'header:agents' })) ?? ''
      expect(textLine(header)).toBe('  Agents · 2 running · 0 done')
      expect([...textLine(header)].filter(char => /[·.•∙⋅]/.test(char))).toEqual(['·', '·'])
      expect(header.match(/ y='12'/g)?.length).toBe(textRuns(header).length)
      await press(ui, 'inspect:sub-2')
      expect(selection(held)).toEqual({ id: 'sub-2', kind: 'agent' })
      await press(ui, 'detail:back')
      await press(ui, 'inspect:main')
      expect(selection(held)).toEqual({ id: 'main', kind: 'main' })
      await press(ui, 'detail:back')
      expect(selection(held)).toBe(null)
      await ui.unmount()
    }
    await settled()
  })

  test('the inspect view: Back and the tabs laid over the cells the terminal draws them in; presses switch tabs and go back; the cost lines keep their columns', async ($, on) => {
    const { held, settled } = await busy($, on)
    const ui = await mount($, 'desktop', 100)
    await press(ui, 'inspect:sub-1')
    const view = await ui.find({ key: 'detail' })
    expect(textRowsOf(view).slice(0, 2)).toEqual(['◂ Back   ● Explore · sonnet-5-5 · high · running · 2s · 10 calls', '[ Task ]  Trail   Said   Agents'])
    const overlays = overlaysIn(view)
    const at = (key: string) => overlays.find(one => one.key === key)
    expect(at('detail:back')).toMatchObject({ row: 'detail:title', left: 0, width: 6, label: '◂ Back', primary: false })
    expect(at('tab:task')).toMatchObject({ row: 'detail:tabs', left: 0, width: 8, label: 'Task', primary: true })
    expect(at('tab:trail')).toMatchObject({ row: 'detail:tabs', left: 10, width: 5, label: 'Trail', primary: false })
    expect(at('tab:said')).toMatchObject({ row: 'detail:tabs', left: 18, width: 4 })
    expect(at('tab:agents')).toMatchObject({ row: 'detail:tabs', left: 25, width: 6 })
    // The tab bar is Buttons alone: no document of its own.
    expect(svgsOf(await ui.find({ key: 'detail:tabs' }))).toEqual([])
    await press(ui, 'tab:trail')
    expect(selection(held)).toEqual({ id: 'sub-1', kind: 'agent', tab: 'trail' })
    expect(overlaysIn(await ui.find({ key: 'detail' })).find(one => one.key === 'tab:trail')).toMatchObject({ left: 7, width: 9, primary: true })
    await press(ui, 'tab:said')
    expect(selection(held)).toEqual({ id: 'sub-1', kind: 'agent', tab: 'said' })
    await press(ui, 'detail:back')
    expect(selection(held)).toBe(null)
    expect(await ui.find({ key: 'detail' })).toBe(undefined)
    await ui.unmount()
    await settled()
  })

  test('every Svg stays far under the cap with 40 agents, 40 long todos and a trail of 200 calls; the sizes read back', { options: { maxRows: 40, todoRows: 40 } }, async ($, on) => {
    const { held } = arrange(on)
    const long = 'Rewrite the reconciliation loop so a slow list call never resurrects a cleared agent, then prove it under load'
    held.set('todos', { value: { items: Array.from({ length: 40 }, (_, index) => ({ content: `${index} ${long}`, status: index % 3 === 0 ? 'completed' : index % 3 === 1 ? 'in_progress' : 'pending', activeForm: `Doing ${index} ${long}` })) }, version: 1 })
    for (const key of ['session', 'usage', 'git', 'tools', 'inventory'] as const) held.set(key, { value: full[key], version: 1 })
    // The TODO section opened, so every item draws its own row.
    held.set('listView', { value: { todosExpanded: true }, version: 1 })
    held.set('agents', { value: Object.fromEntries(Array.from({ length: 40 }, (_, index) => {
      const id = `agent-${String(index).padStart(2, '0')}`

      return [id, entry(id, { type: 'general-purpose', model: 'claude-opus-5-5', toolCalls: 1234, currentTool: 'mcp__github__create_issue', description: long })]
    })), version: 1 })
    const trail = Array.from({ length: TRAIL_MAX }, (_, index): HudTrailStep => ({ tool: 'Bash', arg: `${index} ${'npm run test -- --filter something-long '.repeat(4)}`.slice(0, ARG_MAX), at: NOW - (TRAIL_MAX - index) * 1000, ms: 420, outcome: index % 7 === 0 ? 'error' : 'ok' }))
    held.set('trails', { value: { 'agent-00': trail }, version: 1 })
    const ui = await mount($, 'desktop', 130, 40)
    const sizes = async (): Promise<number[]> => svgsOf(await ui.drawn()).filter(svg => !String(svg.props?.alt ?? '').includes('mascot')).map(svg => String(svg.props?.source).length)
    const pane = await sizes()
    expect(pane.length).toBeGreaterThan(40 + 40)
    for (const size of pane) {
      expect(size).toBeLessThan(SVG_MAX)
      expect(size).toBeLessThanOrEqual(131_072)
    }
    held.set('selected', { value: { id: 'agent-00', kind: 'agent', tab: 'trail' }, version: 1 })
    await ui.redraw()
    const rows = textRowsOf(await ui.find({ key: 'detail' }))
    expect(rows.filter(row => /^\d\d:\d\d:\d\d /.test(row))).toHaveLength(TRAIL_MAX)
    const view = await sizes()
    for (const size of view) expect(size).toBeLessThan(SVG_MAX)
    expect(Math.max(...pane, ...view)).toBeLessThan(4000)
    await ui.unmount()
  })
})
