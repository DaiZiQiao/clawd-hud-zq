import { describe, expect, test } from 'claude-code/testing'

import type { AgentBoardEntry, HudData, HudMainFacts, ShadowAgentEntry } from '../types'
import { rowsOf, spriteOf } from './mascot-glyphs.fixtures'
import { LAPTOP_COLOUR, OVERLAYS } from './mascot-sprites'
import { PALETTE, SCENE_COLOURS, activityOf, colourFor, sceneFromInputs, sceneInputsOf, sceneOf } from './scene-model'
import { DONE_HOLD, FAIL_HOLD, NOW, entry, everyState, family, hotHud, idleHud, oneAgent, trio, working } from './scene-model.fixtures'
import { EXIT_TICKS, IDLE_AFTER_MS, LONG_IDLE_MS, PACK_TICKS, SCENE_FRAME_MS, phaseOf } from './scene-phases'
import { mascotColours, mascotLines } from './scene-render'
import type { MascotLayout } from './scene-types'

// The scene from the board, the workflow agents and the HUD's facts
// (`sceneOf`): activities, roles, idle and stalled, what stays, the
// session's mood; each agent's colour.

const layout = (columns: number, rows = 8, tick = 0): MascotLayout => ({ columns, rows, tick })

describe('sceneOf', () => {
  test('tools map to activities; MCP and other tools read as thinking', () => {
    for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) expect(activityOf(tool)).toBe('typing')
    expect(activityOf('Read')).toBe('reading')
    for (const tool of ['Grep', 'Glob']) expect(activityOf(tool)).toBe('searching')
    expect(activityOf('Bash')).toBe('lifting')
    for (const tool of ['WebFetch', 'WebSearch']) expect(activityOf(tool)).toBe('fetching')
    for (const tool of [undefined, '', 'Agent', 'notion:search', 'TodoWrite']) expect(activityOf(tool)).toBe('thinking')
  })

  test('agents keep spawn order, their colour, activity, role, and their parent only when it is drawn too', () => {
    const scene = sceneOf([...family].reverse(), idleHud, NOW)
    expect(scene.agents.map(one => one.id)).toEqual(['parent', 'child', 'grandchild'])
    expect(scene.agents.map(one => one.activity)).toEqual(['thinking', 'searching', 'fetching'])
    expect(scene.agents.map(one => one.parentId)).toEqual([undefined, 'parent', 'child'])
    expect(scene.agents[0]?.role).toBe('planner')
    for (const one of scene.agents) expect(one.colour).toBe(colourFor(one.id))

    const orphan = sceneOf([entry('kid', { parentId: 'gone' })], idleHud, NOW)
    expect(orphan.agents[0]?.parentId).toBe(undefined)
  })

  test('a call put to the decider is asking; a quiet agent is stalled', () => {
    const scene = sceneOf([
      entry('asker', { currentTool: 'Bash', awaitingPermission: true }),
      entry('quiet', { lastActivityAt: NOW - 6000 }),
    ], idleHud, NOW, { stalledMs: 5000 })
    expect(scene.agents.map(one => [one.activity, one.status])).toEqual([['asking', 'running'], ['thinking', 'stalled']])
  })

  test('idle: quiet 6 s with no tool running, or stalled (its laptop dropped); never with a tool running or asking', () => {
    expect(IDLE_AFTER_MS).toBe(6000)
    const idleOf = (extra: Partial<AgentBoardEntry>, stalledMs = 240_000) => sceneOf([entry('a', extra)], idleHud, NOW, { stalledMs }).agents[0]?.idleMs
    expect(idleOf({ lastActivityAt: NOW - 5999 })).toBe(undefined)
    expect(idleOf({ lastActivityAt: NOW - 6000 })).toBe(6000)
    expect(idleOf({ lastActivityAt: NOW - 91_000 })).toBe(91_000)
    expect(idleOf({ lastActivityAt: NOW - 30_000, currentTool: 'Bash' })).toBe(undefined)
    expect(idleOf({ lastActivityAt: NOW - 30_000, currentTool: 'Bash' }, 20_000)).toBe(30_000)
    expect(idleOf({ lastActivityAt: NOW - 30_000, awaitingPermission: true })).toBe(undefined)
    expect(idleOf({ lastActivityAt: NOW - 30_000, status: 'done', endedAt: NOW })).toBe(undefined)
    // A stalled agent at its laptop drops it for its idle bits.
    const stalled = sceneOf([entry('a', { lastActivityAt: NOW - 30_000, currentTool: 'Edit' })], idleHud, NOW, { stalledMs: 20_000 })
    expect(mascotLines(stalled, layout(40, 4))?.join('\n')).not.toMatch(/▗▄▄▄▖|▐▒▒▒▌/)
  })

  test('finished agents stay only while they leave, including unknown spawn times', () => {
    expect(EXIT_TICKS).toBe(12)
    const done = entry('done', { status: 'done', endedAt: NOW })
    const failed = entry('failed', { status: 'failed', endedAt: NOW })
    const seeded = entry('seeded', { status: 'done', startedAt: 0, endedAt: NOW })
    const ids = (now: number) => sceneOf([done, failed, seeded], idleHud, now).agents.map(one => one.id)
    expect(ids(NOW)).toEqual(['seeded', 'done', 'failed'])
    expect(ids(NOW + (DONE_HOLD + EXIT_TICKS) * SCENE_FRAME_MS - 1)).toEqual(['seeded', 'done', 'failed'])
    expect(ids(NOW + (DONE_HOLD + EXIT_TICKS) * SCENE_FRAME_MS)).toEqual(['failed'])
    expect(ids(NOW + (FAIL_HOLD + EXIT_TICKS) * SCENE_FRAME_MS)).toEqual([])
    // A running agent seeded from the list has no spawn time: it is just there.
    expect(sceneOf([entry('old', { startedAt: 0 })], idleHud, NOW).agents[0]?.ageMs).toBe(undefined)
  })

  test('the session mascot: idle, thinking while the main loop works alone, watching while agents run', () => {
    expect(sceneOf([], idleHud, NOW).main.mood).toBe('idle')
    expect(sceneOf([], idleHud, NOW, { main: { busySince: NOW - 1000 } }).main.mood).toBe('thinking')
    // A main-loop tool running counts as work too.
    expect(sceneOf([], { ...idleHud, tools: { current: { name: 'Bash', since: NOW }, counts: {} } }, NOW).main.mood).toBe('thinking')
    expect(sceneOf(trio, idleHud, NOW, { main: { busySince: NOW } }).main.mood).toBe('watching')
    expect(sceneOf([entry('done', { status: 'done', endedAt: NOW })], idleHud, NOW).main.mood).toBe('idle')
  })

  test('idle time, sweat at 85 % as the HUD rounds it, and the stretch after a compaction', () => {
    const main: HudMainFacts = { idleSince: NOW - LONG_IDLE_MS }
    expect(sceneOf([], idleHud, NOW, { main }).main.idleMs).toBe(LONG_IDLE_MS)
    // Before any turn, idle since the session started.
    expect(sceneOf([], idleHud, NOW).main.idleMs).toBe(NOW - (idleHud.session?.startedAt ?? 0))

    expect(sceneOf([], hotHud, NOW).main.sweating).toBe(true)
    const percent = (contextPercent: number): HudData => ({ ...hotHud, usage: { ...(hotHud.usage ?? { rateLimits: [], compactions: 0 }), contextPercent } })
    expect(sceneOf([], percent(84.4), NOW).main.sweating).toBe(false)
    expect(sceneOf([], percent(84.5), NOW).main.sweating).toBe(true)
    expect(sceneOf([], idleHud, NOW).main.sweating).toBe(false)

    expect(sceneOf([], idleHud, NOW, { main: { compactedAt: NOW - 1000 } }).main.stretchMs).toBe(1000)
    expect(sceneOf([], idleHud, NOW, { main: { compactedAt: NOW - 3000 } }).main.stretchMs).toBe(undefined)
  })
})

describe('colours', () => {
  test('an agent keeps its colour, one of the palette, and the palette is all used', () => {
    const ids = Array.from({ length: 200 }, (_, index) => `a${index.toString(16)}f${index * 7919}`)
    for (const id of ids) {
      expect(PALETTE).toContain(colourFor(id))
      expect(colourFor(id)).toBe(colourFor(id))
      expect(colourFor(String(id))).toBe(colourFor(id))
    }
    expect(new Set(ids.map(colourFor)).size).toBe(PALETTE.length)
    expect(sceneOf(trio, idleHud, NOW).agents.map(one => one.colour)).toEqual(sceneOf(trio, idleHud, NOW + 60_000).agents.map(one => one.colour))
  })

  test('the scene draws only contract keys, raw identity colours and the kit\'s, each agent in its own colour, the session in the accent', () => {
    const scene = sceneOf(trio, hotHud, NOW)
    const colours = mascotColours(scene, layout(72, 4))
    for (const colour of colours) expect(SCENE_COLOURS).toContain(colour)
    for (const one of trio) expect(colours.has(colourFor(one.id))).toBe(true)
    expect(colours.has('claude')).toBe(true)
    expect(colours.has(LAPTOP_COLOUR)).toBe(true)
    for (let frame = 0; frame < 16; frame += 1) for (const colour of mascotColours(everyState(frame), layout(130, 9, frame))) expect(SCENE_COLOURS).toContain(colour)
  })
})

/** A workflow agent as `mod-hud.shadows` holds it: first seen a minute before NOW, one call made. */
const shadow = (id: string, extra: Partial<ShadowAgentEntry> = {}): ShadowAgentEntry => ({
  id,
  firstSeen: NOW - 60_000,
  lastSeen: NOW,
  steps: 1,
  toolCalls: 1,
  status: 'running',
  ...extra,
})

describe('workflow agents', () => {
  test('sceneOf takes the shown ones as more agents: their colour, activity, status and accessory, in first-seen order', () => {
    const scene = sceneOf([entry('sub', { startedAt: NOW - 30_000 })], idleHud, NOW, {
      shadows: {
        typist: shadow('typist', { currentTool: 'Edit', firstSeen: NOW - 90_000 }),
        reader: shadow('reader', { currentTool: 'Read' }),
        // A single step and no call: a fork, never shown.
        fork: shadow('fork', { toolCalls: 0, steps: 1 }),
        // Quiet ten minutes: dropped.
        gone: shadow('gone', { lastSeen: NOW - 10 * 60_000 }),
        // On the board too: the board's entry stands for it.
        sub: shadow('sub', { currentTool: 'Bash' }),
      },
    })
    expect(scene.agents.map(one => one.id)).toEqual(['typist', 'reader', 'sub'])
    expect(scene.agents.map(one => one.activity)).toEqual(['typing', 'reading', 'thinking'])
    expect(scene.agents.map(one => one.workflow)).toEqual([true, true, undefined])
    expect(scene.agents.map(one => one.role)).toEqual([undefined, undefined, undefined])
    for (const one of scene.agents) {
      expect(one.colour).toBe(colourFor(one.id))
      expect(one.accessory).toBeDefined()
    }
    expect(scene.agents[0]?.ageMs).toBe(90_000)
    // The session watches while only workflow agents run.
    expect(sceneOf([], idleHud, NOW, { shadows: [shadow('alone')] }).main.mood).toBe('watching')
    expect(sceneOf([], idleHud, NOW, { shadows: [shadow('fork', { toolCalls: 0 })] }).main.mood).toBe('idle')
  })

  test('a finished one cheers or sits, then leaves, as a subagent does; a quiet one stalls', () => {
    const at = (now: number) => sceneOf([], idleHud, now, {
      stalledMs: 5000,
      shadows: [
        shadow('done', { status: 'done', endedAt: NOW, reason: 'answer' }),
        shadow('failed', { status: 'failed', endedAt: NOW, reason: 'error' }),
        shadow('quiet', { lastSeen: NOW - 6000 }),
      ],
    }).agents
    expect(at(NOW).map(one => [one.id, one.status, phaseOf(one).kind])).toEqual([
      ['done', 'done', 'pack'], ['failed', 'failed', 'pack'], ['quiet', 'stalled', 'stalled'],
    ])
    expect(at(NOW + PACK_TICKS * SCENE_FRAME_MS).map(one => phaseOf(one).kind)).toEqual(['cheer', 'sit', 'stalled'])
    expect(at(NOW + DONE_HOLD * SCENE_FRAME_MS).map(one => phaseOf(one).kind)).toEqual(['leave', 'sit', 'stalled'])
    expect(at(NOW + (FAIL_HOLD + EXIT_TICKS) * SCENE_FRAME_MS).map(one => one.id)).toEqual(['quiet'])
  })

  test('a workflow agent wears no badge and no letter, in any state: its air row holds only its accessory', () => {
    expect(Object.keys(OVERLAYS)).not.toContain('badge')
    const states = [
      ...(['thinking', 'typing', 'reading', 'searching', 'lifting', 'fetching', 'asking'] as const).map(activity => ({ activity })),
      { activity: 'thinking' as const, status: 'done' as const, endedMs: 0 },
      { activity: 'thinking' as const, status: 'failed' as const, endedMs: 0 },
      { activity: 'thinking' as const, status: 'stalled' as const },
      { activity: 'thinking' as const, idleMs: 30_000 },
    ]
    for (const { activity, ...extra } of states) {
      for (let tick = 0; tick < 8; tick += 1) {
        const sprite = spriteOf(oneAgent(working('w', activity, { workflow: true, accessory: 'note', side: 'left', ...extra })), 'w', tick)
        const air = rowsOf(sprite)[1] ?? ''
        expect(air.slice(0, 11).replace('♫', '').replace(/[✗?▚▞]/g, '').trim(), `${activity} ${JSON.stringify(extra)} @${tick}: "${air}"`).toBe('')
      }
    }
  })
})

describe('the smooth scene\'s props', () => {
  const MINUTE = 60_000
  // A session of agents: five gone two minutes ago that were there when `mid` spawned; a
  // child whose parent ended long ago; a debugger spawned just after a reviewer finished.
  const board: AgentBoardEntry[] = [
    ...['e1', 'e2', 'e3', 'e4', 'e5'].map((id, at) => entry(id, { startedAt: NOW - 10 * MINUTE + at * 1000, status: 'done', endedAt: NOW - 2 * MINUTE })),
    entry('mid', { startedAt: NOW - 5 * MINUTE, currentTool: 'Edit' }),
    entry('late', { startedAt: NOW - MINUTE, currentTool: 'Read' }),
    entry('parent', { startedAt: NOW - 9 * MINUTE, status: 'done', endedAt: NOW - 3 * MINUTE }),
    entry('child', { parentId: 'parent', startedAt: NOW - 8 * MINUTE, currentTool: 'Bash' }),
    entry('builder', { type: 'worker', startedAt: NOW - 7 * MINUTE, currentTool: 'Write' }),
    entry('critic', { type: 'reviewer', startedAt: NOW - 6 * MINUTE, status: 'done', endedAt: NOW - 4 * MINUTE }),
    entry('fixer', { type: 'debugger', startedAt: NOW - 4 * MINUTE + 20_000, currentTool: 'Edit' }),
  ]

  test('make the hooks\' scene whatever they leave out: accessories, parents and a fix visit stay as they were', () => {
    for (const later of [0, 3_000, 61_000, 5 * MINUTE]) {
      const now = NOW + later
      const props = sceneInputsOf(board, [], undefined, { now, columns: 100, rows: 20, main: {}, events: [], stalledMs: 240_000, wander: true, scenes: true, collisions: 'rare', inspect: true })
      // Left out: the agents finished more than a minute before.
      expect(props.agents.map(one => one.id), `+${later}`).not.toContain('e1')
      expect(props.agents.map(one => one.id), `+${later}`).not.toContain('critic')
      const scene = sceneOf(board, undefined, now, { stalledMs: 240_000, main: {}, scenes: true, events: [] })
      expect(sceneFromInputs(props, now), `+${later}`).toEqual(scene)
      const child = scene.agents.find(one => one.id === 'child')
      expect([child?.parentId, child?.spawner], `+${later}`).toEqual(['parent', 'parent'])
      expect(scene.agents.find(one => one.id === 'fixer')?.link, `+${later}`).toEqual({ kind: 'fix', target: 'builder' })
    }
  })
})
