import { blankGrid, bobOf, drawLook, drawMini, wearOfAgent, wearOfMain } from './mascot-glyphs'
import { agentLook, mainLook, miniLook } from './mascot-poses'
import type { Look, LookContext, MiniLook } from './mascot-poses'
import { ACCESSORY_NAMES, BOX, BOX_ROWS, MINI, SKY, SLOT } from './mascot-sprites'
import type { Motion } from './motion-types'
import { ACCENT, PALETTE } from './scene-model'
import { BLANKET_AFTER_MS, CHEER_TICKS, IDLE_SLOT_MS, LONG_IDLE_MS, SCENE_FRAME_MS, STRETCH_TICKS, idleBitOf } from './scene-phases'
import type { IdleBit } from './scene-phases'
import type { Cell, Character, Grid, MascotActivity, MascotAgent, MascotMain, Phase } from './scene-types'
import { dressOfAgent, dressOfMain, drawUsagi, drawUsagiMini } from './usagi-glyphs'

// The sprite sheet: each look the scene can show, frame by frame, as
// docs/mascots.md prints it, Clawd's or Usagi's. For the docs and the tests;
// no surface draws it.

/** A grid as text, one row per grid row. */
const gridText = (grid: Grid): string[] => grid.map(row => row.map(cell => cell?.ch ?? ' ').join(''))

/** One frame for the sheet: its grid (a sky row and its box) and how many rows above the floor its box is drawn. */
type Shot = { grid: Grid; up: number }

/** One look of the sheet: its frames as text, and the same frames as cells. */
export type SheetEntry = { name: string; frames: string[][]; cells: (Cell | undefined)[][][] }

/** The sheet's sky: room for every rise. */
const SHEET_SKY = 8

/**
 * A look's frames, all one size: as many rows as its highest frame rises
 * (rows blank in every frame dropped from the top), and 13 cells across, or
 * 17 when anything stands right of the box (its laptop, its biggest thought).
 */
const framesOf = (name: string, shots: readonly Shot[]): SheetEntry => {
  const top = Math.max(0, ...shots.map(shot => shot.up))
  const height = SKY + top + BOX_ROWS
  const wide = Math.max(...shots.map(shot => shot.grid[0]?.length ?? 0))
  const canvases = shots.map(({ grid, up }) => {
    const canvas = blankGrid(wide, height)
    grid.forEach((row, y) => {
      const line = canvas[top - up + y]
      if (line !== undefined) row.forEach((cell, x) => { line[x] = cell })
    })

    return canvas
  })
  let first = 0
  while (first < height - BOX_ROWS && canvases.every(canvas => canvas[first]?.every(cell => cell === undefined))) first += 1
  const width = wide === MINI ? MINI : canvases.some(canvas => canvas.some(row => row.slice(BOX).some(cell => cell !== undefined))) ? SLOT : BOX
  const cut = canvases.map(canvas => canvas.slice(first).map(row => row.slice(0, width)))

  return { name, frames: cut.map(gridText), cells: cut }
}

/** Each look the scene can show, frame by frame, as the character draws it: the sheet in docs/mascots.md. */
export const spriteSheet = (character: Character = 'clawd'): SheetEntry[] => {
  const usagi = character === 'usagi'
  const worker: Partial<MascotAgent> = { role: 'worker', accessory: 'beanie', side: 'left' }
  const agent = (activity: MascotActivity, extra: Partial<MascotAgent> = {}): MascotAgent => ({
    id: 'sheet', colour: PALETTE[0], activity, status: 'running', ...worker, ...extra,
  })
  /** One frame of an agent or of the session, as the character draws it. */
  const shot = (look: Look, who: { agent: MascotAgent } | { main: MascotMain }, sky = SHEET_SKY): Shot => {
    const bob = bobOf(look, sky)
    const above = sky - look.lift - bob
    const grid = 'main' in who
      ? usagi ? drawUsagi(look, dressOfMain(who.main), above) : drawLook(look, wearOfMain(who.main), ACCENT, above)
      : usagi ? drawUsagi(look, dressOfAgent(who.agent), above) : drawLook(look, wearOfAgent(who.agent), who.agent.colour, above)

    return { grid, up: look.lift + bob }
  }
  const drawChild = (look: MiniLook, child: MascotAgent): Grid => (usagi ? drawUsagiMini(look, child) : drawMini(look, child, child.colour))
  const full = (one: MascotAgent, phase: Phase, tick: number, context: LookContext = {}, sky = SHEET_SKY): Shot =>
    shot(agentLook(one, phase, tick, context), { agent: one }, sky)
  const session = (main: Partial<MascotMain>, tick: number, context: LookContext = {}, sky = SHEET_SKY): Shot => {
    const one: MascotMain = { mood: 'watching', sweating: false, ...main }

    return shot(mainLook(one, tick, context), { main: one }, sky)
  }
  const ticks = (count: number, from = 0) => Array.from({ length: count }, (_, index) => from + index)
  const work = (name: string, activity: MascotActivity, count: number, extra: Partial<MascotAgent> = {}, sky = SHEET_SKY) =>
    framesOf(name, ticks(count).map(tick => full(agent(activity, extra), { kind: 'work' }, tick, {}, sky)))
  const phase = (one: Phase | ((tick: number) => Phase), count: number, extra: Partial<MascotAgent> = {}, context: LookContext = {}) =>
    ticks(count).map(tick => full(agent('thinking', extra), typeof one === 'function' ? one(tick) : one, tick, context))
  const motions = (list: readonly Motion[], extra: Partial<MascotAgent> = {}, facing: 'left' | 'right' = 'right') =>
    list.map((motion, tick) => full(agent('thinking', extra), { kind: 'work' }, tick, { motion, facing }))
  const small = (name: string, activity: MascotActivity, one: Phase, count: number, extra: Partial<MascotAgent> = {}, context: (tick: number) => LookContext = () => ({})) =>
    framesOf(name, ticks(count).map(tick => {
      const child = agent(activity, extra)
      const look = miniLook(child, one, tick, context(tick))

      return { grid: drawChild(look, child), up: look.lift }
    }))
  const main = (name: string, state: Partial<MascotMain>, count: number, context: LookContext = {}, sky = SHEET_SKY) =>
    framesOf(name, ticks(count).map(tick => session(state, tick, context, sky)))
  /** An idle mascot `slot` six-second slots in, frame by frame. */
  const idle = (bit: IdleBit, count: number): number => {
    for (let slot = 0; slot < 15; slot += 1) if (idleBitOf('sheet', slot * IDLE_SLOT_MS) === bit) return slot * IDLE_SLOT_MS
    throw new Error(`no ${bit} slot for the sheet (${count})`)
  }
  const bit = (name: string, which: IdleBit, count: number, step = 1) => {
    const from = idle(which, count)

    return framesOf(name, ticks(count).map(frame => full(agent('thinking', { idleMs: from + frame * step * SCENE_FRAME_MS }), { kind: 'work' }, frame)))
  }
  const hop = (step: number, lift: number, pose: 'squash' | 'stretch' | 'air' | 'apex'): Motion => ({ kind: 'hop', step, lift, pose })
  const fly = (step: number, lift: number): Motion => ({ kind: 'fly', step, lift })
  const roles = ['reviewer', 'debugger', 'planner', 'worker', 'frontend', 'explorer'] as const
  /** Idle a moment, eyes ahead: the still poses below. */
  const still = 2 * SCENE_FRAME_MS

  const byRole = [
    ...roles.map(role => full(agent('thinking', { role, idleMs: still }), { kind: 'work' }, 2)),
    full(agent('thinking', { role: undefined, idleMs: still }), { kind: 'work' }, 2),
  ]
  const dressed = usagi
    ? [
      framesOf('the figure: an agent (a worker, in its construction hat) and the session (its crown on the side of its head)', [full(agent('thinking', { idleMs: still }), { kind: 'work' }, 2), session({ mood: 'idle', idleMs: still }, 2)]),
      framesOf('hats by role, ears through the brim: reviewer mortarboard, debugger miner\'s helmet, Plan top hat, worker construction hat, frontend beret, Explore or researcher fedora; any other type and a workflow agent none', byRole),
    ]
    : [
      framesOf('the figure: an agent (worker w, beanie) and the session (crown)', [full(agent('thinking', { idleMs: still }), { kind: 'work' }, 2), session({ mood: 'idle', idleMs: still }, 2)]),
      framesOf('role letters above the head: reviewer r, debugger d, Plan p, worker w, frontend f, Explore or researcher e; any other type and a workflow agent none', byRole),
      framesOf('accessories, each in its own colour, at the left or right end by the agent\'s id: beanie, cap, top hat, flower, bow, halo, note, propeller', ACCESSORY_NAMES.map((accessory, index) => full(agent('thinking', { accessory, side: index % 2 === 0 ? 'left' : 'right', idleMs: still }), { kind: 'work' }, 2))),
    ]

  return [
    ...dressed,
    framesOf(usagi ? 'energy by effort, at the air row\'s right end: low, medium or unknown none; high ✦; xhigh or max ✦✦ (an agent, the session)' : 'energy by effort, at the end the hat leaves: low, medium or unknown none; high ✦; xhigh or max ✦✦ (hat left, hat right, the session)', [
      ...([0, 1, 2] as const).map(energy => full(agent('thinking', { energy, idleMs: still }), { kind: 'work' }, 2)),
      ...([1, 2] as const).map(energy => full(agent('thinking', { energy, side: 'right', idleMs: still }), { kind: 'work' }, 2)),
      ...([1, 2] as const).map(energy => session({ mood: 'idle', idleMs: still, energy }, 2)),
    ]),
    bit('idle · look around (8 frames, a 6 s slot loops it)', 'look', 8),
    bit('idle · stretch (8 frames, once a slot, then the rest frame)', 'stretch', 8),
    bit('idle · sit (16 frames, a blink on 12 and 13)', 'sit', 16),
    bit(usagi ? 'idle · a shout (on each of the puff bit\'s puffs of 500 ms, hands up, mouth wide: Ura!, Haa?, Pururu!, then a breath; shown every other frame)' : 'idle · a puff (4 puffs of 500 ms, shown every other frame)', 'puff', 4, 2),
    work('idle · asleep under the blanket, from 90 s (z, z z, z z Z, held; the quilt breathes every 4 frames)', 'thinking', 8, { idleMs: BLANKET_AFTER_MS }),
    work('idle · asleep, idle 10 minutes (the moon)', 'thinking', 8, { idleMs: LONG_IDLE_MS }),
    work('idle · asleep with no sky row free (the z z Z a row lower)', 'thinking', 8, { idleMs: BLANKET_AFTER_MS }, 0),
    work('agent · thinking (·, then ∘, then a phrase, held: 1 1 2 2 3 3 3 3)', 'thinking', 8),
    framesOf('agent · thinking phrases across spells (one full bubble per eight-frame spell)', ticks(8).map(spell => full(agent('thinking'), { kind: 'work' }, spell * 8 + 4))),
    work('agent · thinking with no sky row free (the thought a row lower)', 'thinking', 8, {}, 0),
    framesOf('agent · start of work (turns to its desk, then at its laptop)', phase(tick => ({ kind: 'setup', step: tick }), 3)),
    work('agent · at its laptop, any tool (the near hand on the keys every other frame)', 'typing', 4),
    work('agent · asking (waiting on permission)', 'asking', 1),
    framesOf('agent · stalled (its idle bits, a clock beside)', phase({ kind: 'stalled' }, 8)),
    framesOf('agent · stalled, asleep under its blanket (a stall is always past 90 s quiet): the clock turns on the floor beside it', phase({ kind: 'stalled' }, 8, { status: 'stalled', idleMs: BLANKET_AFTER_MS + 150_000 })),
    framesOf('agent · walking right (4 frames: the feet passing; a bob and a lean on 1 and 3)', motions([{ kind: 'walk' }, { kind: 'walk' }, { kind: 'walk' }, { kind: 'walk' }])),
    framesOf('agent · walking left', motions([{ kind: 'walk' }, { kind: 'walk' }, { kind: 'walk' }, { kind: 'walk' }], {}, 'left')),
    framesOf('agent · hop (6 frames, lifts 0 2 4 4 2 0: squash, stretch, apex, apex, air, squash)', motions([hop(0, 0, 'squash'), hop(1, 2, 'stretch'), hop(2, 4, 'apex'), hop(3, 4, 'apex'), hop(4, 2, 'air'), hop(5, 0, 'squash')])),
    framesOf('agent · flying under the propeller cap (climb two rows a second, cruise, come down, land with a bounce)', motions([fly(0, 1), fly(1, 1), fly(2, 2), fly(3, 2), fly(4, 3), fly(5, 3), fly(6, 2), fly(7, 1), { kind: 'land' }])),
    framesOf(usagi ? 'agent · knocked over (a stagger, flat with its hat knocked off, dizzy ×8: eyes crossing and rolling apart under three blinking stars; a crouch, dazed: Haa?; up at its laptop)' : 'agent · knocked over (a stagger, flat on its back with its hat knocked off, dizzy ×8: eyes crossing and rolling apart under three blinking stars; a crouch, up at its laptop)',
      ticks(12).map(step => full(agent('typing'), { kind: 'work' }, step, { motion: { kind: 'fallen', step } }))),
    framesOf('main · knocked over (the crown knocked off beside it, back on as it gets up)', [1, 2, 3, 10, 11].map(step => session({ mood: 'watching' }, step, { motion: { kind: 'fallen', step } }))),
    framesOf('agent · arriving by the pipe: it drops out of the mouth (eyes wide, arms up, legs tucked), falling ever faster to its floor; then it turns to its desk', [
      ...[3, 2, 1].map(lift => shot({ ...agentLook(agent('thinking'), { kind: 'arrive', step: 2 }, 2, { pipe: 'fall' }), lift }, { agent: agent('thinking') })),
      full(agent('thinking'), { kind: 'setup', step: 0 }, 0),
    ]),
    framesOf('agent · done (at its laptop, the laptop gone)', phase(tick => ({ kind: 'pack', step: tick }), 3, { status: 'done' })),
    framesOf('agent · cheer: a dance under its ✓ (8 frames: shuffle left, bounce, shuffle right, bounce); then eyes up at the pipe coming down, and sucked up it, stretched (arms up, legs long)', [
      ...phase(tick => ({ kind: 'cheer', step: tick }), CHEER_TICKS, { status: 'done' }),
      ...phase({ kind: 'leave', step: 0 }, 1, { status: 'done' }),
      ...[0, 2, 4].map(lift => shot({ ...agentLook(agent('thinking', { status: 'done' }), { kind: 'leave', step: 3 }, 3), lift }, { agent: agent('thinking') })),
    ]),
    framesOf('agent · failed (at its laptop, slumps under ✗, still slumped as the pipe comes down, then sucked up it, eyes shut)', [
      ...phase(tick => ({ kind: 'pack', step: tick }), 2, { status: 'failed' }),
      ...phase({ kind: 'sit' }, 1, { status: 'failed' }),
      ...phase({ kind: 'leave', step: 0 }, 1, { status: 'failed' }),
      ...[0, 2].map(lift => shot({ ...agentLook(agent('thinking', { status: 'failed' }), { kind: 'leave', step: 3 }, 3), lift }, { agent: agent('thinking') })),
    ]),
    framesOf('scenes · hands back (holds out a hand, nothing drawn in it), and a parent pointing at its child', [
      ...phase({ kind: 'hand', step: 0 }, 1, { status: 'done' }),
      full(agent('typing', { role: 'planner' }), { kind: 'work' }, 1, { pointing: true }),
      full(agent('typing', { role: 'planner' }), { kind: 'work' }, 2, { cues: ['point'] }),
    ]),
    framesOf('smooth · held up by the pointer: eyes wide, arms up, legs kicking, its laptop gone', ticks(4).map(tick => full(agent('typing'), { kind: 'work' }, tick, { pose: 'dangle', kick: tick }))),
    framesOf('smooth · thrown or falling: eyes wide, arms up, legs tucked', [full(agent('thinking'), { kind: 'work' }, 0, { pose: 'tumble' })]),
    framesOf('smooth · a wobble after a bounce (a cell aside and back, 100 ms each)', [-1, 1, -1, 1].map(nudge => full(agent('thinking', { idleMs: still }), { kind: 'work' }, 2, { nudge: nudge as -1 | 1 }))),
    framesOf('smooth · an Explore agent at work flies, scanning the floor (eyes down)', ticks(4).map(tick => full(agent('reading', { role: 'explorer' }), { kind: 'work' }, tick, { motion: fly(tick, 2 + Math.floor(tick / 2)), scanning: true }))),
    work('workflow agent (no badge, no letter: its colour and wf- name tell it) · thinking', 'thinking', 8, { role: undefined, workflow: true, accessory: 'note', colour: PALETTE[2] }),
    work('workflow agent · at its laptop', 'typing', 2, { role: undefined, workflow: true, accessory: 'note', colour: PALETTE[2] }),
    main('main · thinking', { mood: 'thinking' }, 8),
    main('main · watching (a blink every 2 s)', { mood: 'watching' }, 8),
    framesOf('main · idle: the same bits as an agent (here, looking around)', ticks(8).map(tick => session({ mood: 'idle', idleMs: tick * SCENE_FRAME_MS }, tick))),
    main('main · asleep under the blanket, idle 10 minutes', { mood: 'idle', idleMs: LONG_IDLE_MS }, 8),
    main('main · sweating (ctx ≥ 85 %)', { mood: 'thinking', sweating: true }, 4),
    framesOf('main · stretch after a compaction', ticks(STRETCH_TICKS).map(tick => session({ mood: 'idle', stretchMs: tick * SCENE_FRAME_MS }, tick))),
    framesOf('main · tidying up while a compaction runs (8 frames on a loop: arms up over a stack of pages, pressing it down, a cube on the floor, a spark, the next stack landing)', ticks(8).map(tick => session({ mood: 'thinking', tidyMs: tick * SCENE_FRAME_MS }, tick))),
    framesOf('main · delegating: holds out a hand, nods at a report, glances up at a message', [session({}, 0, { cues: ['give-scroll'] }), session({}, 0, { cues: ['take-report', 'nod'] }), session({}, 0, { cues: ['glance'] })]),
    usagi
      ? framesOf('child (mini, its role\'s hat a cell between its ears): reviewer, debugger, Plan, worker, frontend, Explore or researcher, none', [...roles, undefined].map(role => {
        const child = agent('thinking', { role })
        const look = miniLook(child, { kind: 'stalled' }, 2)

        return { grid: drawChild({ ...look, overlays: [] }, child), up: 0 }
      }))
      : framesOf('child (mini, its accessory\'s two cells): beanie, cap, top hat, flower, bow, halo, note, propeller', ACCESSORY_NAMES.map(accessory => {
        const child = agent('thinking', { accessory })
        const look = miniLook(child, { kind: 'stalled' }, 2)

        return { grid: drawChild({ ...look, overlays: [] }, child), up: 0 }
      })),
    small('child · thinking', 'thinking', { kind: 'work' }, 6),
    small('child · at its laptop, any tool', 'typing', { kind: 'work' }, 1),
    small('child · asking', 'asking', { kind: 'work' }, 1),
    small('child · stalled', 'thinking', { kind: 'stalled' }, 8),
    small('child · idle (looking about)', 'thinking', { kind: 'work' }, 6, { idleMs: 30_000 }),
    small('child · asleep, from 90 s idle', 'thinking', { kind: 'work' }, 4, { idleMs: BLANKET_AFTER_MS }),
    small('child · knocked over', 'thinking', { kind: 'work' }, 4, {}, tick => ({ motion: { kind: 'fallen', step: tick + 1 } })),
    small('child · done', 'thinking', { kind: 'cheer', step: 0 }, 1, { status: 'done' }),
    small('child · failed', 'thinking', { kind: 'sit' }, 1, { status: 'failed' }),
  ]
}
