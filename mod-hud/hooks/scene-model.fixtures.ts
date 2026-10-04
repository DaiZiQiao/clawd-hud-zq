import type { AgentBoardEntry, HudData } from '../types'
import { NOW, full } from './hud.fixtures'
import { PALETTE } from './scene-model'
import { BLANKET_AFTER_MS, CHEER_TICKS, FAIL_PACK_TICKS, FAREWELL_TICKS, LONG_IDLE_MS, PACK_TICKS, SCENE_FRAME_MS, SIT_TICKS, holdTicks } from './scene-phases'
import { PIPE_DROP_MS, PIPE_SLIDE_MS } from './scene-pipe'
import type { MascotActivity, MascotAgent, MascotScene } from './scene-types'

// The mascot scene's test fixtures: board entries as the hooks keep them, and
// scenes built directly for the renderer. Times are relative to the HUD
// fixtures' NOW.

export { NOW }

const MINUTE = 60_000

/** A running agent spawned a minute before NOW, heard from at NOW, thinking. */
export const entry = (id: string, extra: Partial<AgentBoardEntry> = {}): AgentBoardEntry => ({
  id,
  type: 'general-purpose',
  description: `Task ${id}`,
  background: false,
  startedAt: NOW - MINUTE,
  lastActivityAt: NOW,
  status: 'running',
  toolCalls: 0,
  ...extra,
})

/** Three agents at work: typing, a reviewer reading, and one running a shell. */
export const trio: AgentBoardEntry[] = [
  entry('typist', { currentTool: 'Edit', startedAt: NOW - 3 * MINUTE }),
  entry('critic', { type: 'reviewer', currentTool: 'Read', startedAt: NOW - 2 * MINUTE }),
  entry('lifter', { currentTool: 'Bash', startedAt: NOW - MINUTE }),
]

/** A parent, its child and its grandchild. */
export const family: AgentBoardEntry[] = [
  entry('parent', { type: 'Plan', startedAt: NOW - 3 * MINUTE }),
  entry('child', { parentId: 'parent', currentTool: 'Grep', startedAt: NOW - 2 * MINUTE }),
  entry('grandchild', { parentId: 'child', currentTool: 'WebFetch', startedAt: NOW - MINUTE }),
]

/** `count` agents spawned a second apart, the oldest first. */
export const crowd = (count: number): AgentBoardEntry[] =>
  Array.from({ length: count }, (_, index) => entry(`agent-${String(index).padStart(2, '0')}`, { startedAt: NOW - MINUTE + index * 1000 }))

/** The HUD's facts with nothing running on the main loop. */
export const idleHud: HudData = { ...full, tools: { counts: full.tools?.counts ?? {} } }

/** The HUD's facts with the context 85 % full. */
export const hotHud: HudData = {
  ...idleHud,
  usage: { ...(full.usage ?? { rateLimits: [], compactions: 0 }), contextTokens: 850_000, contextPercent: 85 },
}

/** A scene agent at work for a minute. */
export const working = (id: string, activity: MascotActivity, extra: Partial<MascotAgent> = {}): MascotAgent => ({
  id,
  colour: PALETTE[0],
  activity,
  status: 'running',
  ageMs: MINUTE,
  ...extra,
})

/** A scene with the session watching one agent. */
export const oneAgent = (agent: MascotAgent): MascotScene => ({ main: { mood: 'watching', sweating: false }, agents: [agent] })

/** Every activity, role, accessory, energy and lifecycle state at once, idle bits and the blanket too. */
export const everything: MascotScene = {
  main: { mood: 'watching', sweating: true, energy: 2 },
  agents: [
    working('a', 'typing', { colour: PALETTE[0], accessory: 'beanie', side: 'left', energy: 1 }),
    working('b', 'reading', { colour: PALETTE[1], role: 'reviewer', accessory: 'halo', side: 'right', energy: 2 }),
    working('c', 'searching', { colour: PALETTE[2], parentId: 'b', accessory: 'bow' }),
    working('d', 'lifting', { colour: PALETTE[3], role: 'debugger', accessory: 'cap', side: 'right' }),
    working('e', 'fetching', { colour: PALETTE[4], role: 'planner', accessory: 'tophat', side: 'left' }),
    working('f', 'asking', { colour: PALETTE[0], accessory: 'flower', side: 'right' }),
    working('g', 'thinking', { colour: PALETTE[1], status: 'stalled', accessory: 'note' }),
    working('h', 'thinking', { colour: PALETTE[2], status: 'done', endedMs: 0, accessory: 'propeller' }),
    working('i', 'thinking', { colour: PALETTE[3], status: 'failed', endedMs: 0 }),
    working('j', 'thinking', { colour: PALETTE[4], ageMs: 0 }),
    working('k', 'thinking', { colour: PALETTE[5], role: 'worker', accessory: 'cap', idleMs: 30_000 }),
    working('l', 'thinking', { colour: PALETTE[0], role: 'explorer', accessory: 'bow', idleMs: BLANKET_AFTER_MS }),
    working('m', 'thinking', { colour: PALETTE[2], idleMs: LONG_IDLE_MS, workflow: true }),
  ],
}

/** Frames a finished agent stays before its farewell walk, without the scenes: its pack, then its cheer or sit. */
export const DONE_HOLD = PACK_TICKS + CHEER_TICKS
export const FAIL_HOLD = FAIL_PACK_TICKS + SIT_TICKS

/** A scene in every state at once: at work, thinking, asking, stalled, idle, asleep, arriving, packing, dancing, slumped, leaving. */
export const everyState = (frame: number): MascotScene => ({
  main: { mood: frame % 3 === 0 ? 'thinking' : frame % 3 === 1 ? 'watching' : 'idle', sweating: frame % 2 === 0, energy: 2, idleMs: frame * 7000, ...(frame % 4 === 0 ? { stretchMs: frame * SCENE_FRAME_MS } : {}) },
  agents: [
    ...everything.agents,
    working('arriving', 'thinking', { ageMs: frame * SCENE_FRAME_MS, accessory: 'note', energy: 1 }),
    working('packing', 'typing', { status: 'done', endedMs: frame * SCENE_FRAME_MS, accessory: 'halo', side: 'right', role: 'frontend' }),
    working('slumped', 'thinking', { status: 'failed', endedMs: (FAIL_PACK_TICKS + frame) * SCENE_FRAME_MS, accessory: 'cap' }),
    working('dancing', 'thinking', { status: 'done', endedMs: (PACK_TICKS + frame) * SCENE_FRAME_MS, accessory: 'tophat', side: 'right', energy: 2 }),
    working('leaving', 'thinking', { status: 'done', endedMs: (DONE_HOLD + frame) * SCENE_FRAME_MS, accessory: 'flower' }),
  ],
})

/** Newcomers by the pipe (one alone, two sharing one), one leaving by it, done and failed, and some at work. */
export const busy = (tick: number): MascotScene => ({
  main: { mood: 'watching', sweating: false },
  agents: [
    working('t', 'typing'),
    working('e', 'reading', { role: 'explorer' }),
    working('n', 'thinking', { ageMs: (tick % 8) * SCENE_FRAME_MS }),
    working('p', 'thinking', { ageMs: (tick % 8) * SCENE_FRAME_MS + 100, pipe: { anchor: 'n', after: 0, drop: PIPE_SLIDE_MS, up: PIPE_SLIDE_MS + 2 * PIPE_DROP_MS } }),
    working('q', 'thinking', { ageMs: (tick % 8) * SCENE_FRAME_MS, pipe: { anchor: 'n', after: 100, drop: PIPE_SLIDE_MS + PIPE_DROP_MS, up: PIPE_SLIDE_MS + 2 * PIPE_DROP_MS } }),
    working('d', 'thinking', { status: 'done', endedMs: (holdTicks({ status: 'done' }) + (tick % FAREWELL_TICKS)) * SCENE_FRAME_MS }),
    working('f', 'thinking', { status: 'failed', endedMs: (holdTicks({ status: 'failed' }) + (tick % FAREWELL_TICKS)) * SCENE_FRAME_MS }),
    working('k', 'thinking', { parentId: 't', ageMs: (tick % 8) * SCENE_FRAME_MS }),
  ],
})
