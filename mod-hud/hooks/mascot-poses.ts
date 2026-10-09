import { MINI_OVERLAYS, OVERLAYS, THOUGHTS, THOUGHT_FRAMES, WALK_LEGS } from './mascot-sprites'
import type { Arms, Head, Legs, MiniHead, MiniLegs, Overlay } from './mascot-sprites'
import { DIZZY_TICKS, FALL_TICKS, KNOCKED_TICKS, roll } from './motion-rules'
import type { Motion } from './motion-types'
import { BLANKET_AFTER_MS, IDLE_SLOT_MS, LONG_IDLE_MS, SCENE_FRAME_MS, idleBitOf, ticksOf } from './scene-phases'
import { PIPE_SLIDE_MS } from './scene-pipe'
import type { Cue, MascotAgent, MascotMain, Phase } from './scene-types'

// A mascot's look for one frame: its eyes, arms, legs and pose, what is laid
// beside it and how far it rises; for a full agent, a mini (a child) and the
// session's own, from its phase (hooks/scene-phases.ts), its motion and the
// scene's cues. hooks/mascot-glyphs.ts draws a look into cells.

/** How the figure stands: upright, sitting or crouched a row lower, squashed a row shorter, flat on its back, under its blanket. */
type Pose = 'stand' | 'sit' | 'crouch' | 'squash' | 'flat' | 'blanket'

/**
 * One frame of a full mascot: its eyes, arms, legs and pose; what is laid
 * beside it; how many rows above the floor it is; and the touches of motion
 * (the walk's bob and lean, the dance's nudge, arms up), its laptop while it
 * works, its propeller cap while it flies, its hat knocked off while it is
 * down, the blanket's breath.
 */
export type Look = {
  head: Head
  arms: Arms
  legs: Legs
  pose: Pose
  overlays: readonly Overlay[]
  lift: number
  /** One row up for the frame, where a row is free above: the walk's and the dance's bounce. */
  bob?: boolean
  /** Its torso a cell toward where it walks. */
  lean?: -1 | 1
  /** The whole figure a cell aside: the dance. */
  nudge?: -1 | 1
  /** Both arms up beside its head. */
  armsUp?: boolean
  desk?: boolean
  /** Its near hand on the keys. */
  reach?: boolean
  /** Flying under its propeller cap: the frame the blade is at. */
  cap?: number
  /** Down on its back: its hat on the floor beside its head. */
  hatOff?: boolean
  /** Under the blanket: which of the quilt's two patterns, a breath apart. */
  breath?: number
}
export type MiniLook = { head: MiniHead; legs: MiniLegs; overlays: readonly Overlay[]; lift: number; sit: boolean }

/** What else shapes a look this frame: movement, facing and scene cues; in the smooth scene, the person's hand and flights. */
export type LookContext = {
  pointing?: boolean
  facing?: 'left' | 'right'
  motion?: Motion
  cues?: readonly Cue[]
  /** Flying eyes down, scanning the floor (an Explore or researcher agent at work). */
  scanning?: boolean
  /** Held up by the pointer (dangling, legs kicking), or thrown (tumbling): eyes wide, arms up. */
  pose?: 'dangle' | 'tumble'
  /** The kick's frame while it dangles. */
  kick?: number
  /** A wobble's lean after a bounce: the whole figure a cell aside. */
  nudge?: -1 | 1
  /**
   * In the pipe's scene, as its exact timeline has it: falling out of its
   * mouth, the pipe coming down over it, or being sucked up.
   */
  pipe?: 'fall' | 'lower' | 'suck'
  /** Back from the TV this long ago (ms): shaken, within STARTLED_MS. */
  startled?: number
}

export const at = <T,>(frames: readonly T[], tick: number): T => frames[((tick % frames.length) + frames.length) % frames.length] as T

const STAND: Look = { head: 'open', arms: 'rest', legs: 'stand', pose: 'stand', overlays: [], lift: 0 }

/** What stays with a mascot in the air: the sweat drop. */
const ALOFT: ReadonlySet<Overlay> = new Set<Overlay>(OVERLAYS.sweat)

/** One hash choice per spell; alternating halves avoid repeating the last phrase. */
const thoughtOf = (id: string, tick: number): Overlay => {
  const spell = Math.floor(tick / 8)
  const half = Math.ceil(THOUGHTS.length / 2)
  const start = THOUGHTS.length > 1 && spell % 2 !== 0 ? half : 0
  const count = start === 0 ? half : THOUGHTS.length - half
  const phrase = start + roll(id, 'thought', spell, count)

  return at(THOUGHT_FRAMES[phrase]!, tick)
}

/** Thinking: eyes up at a thought growing beside its head. */
const thinkLook = (id: string, tick: number): Look => ({ ...STAND, head: 'up', overlays: [thoughtOf(id, tick)] })

/** At its laptop, facing it, the near hand on the keys every other frame. */
const deskLook = (tick: number): Look => ({ ...STAND, head: 'right', desk: true, ...(tick % 2 === 0 ? { arms: 'point' as const, reach: true } : {}) })

/** The walk, four frames: the feet passing, and on frames 1 and 3 a bob up and the torso leaning a cell the way it goes. */
const walkLook = (tick: number, facing: 'left' | 'right', extra: Partial<Look> = {}): Look => {
  const frame = ((tick % 4) + 4) % 4
  const lifted = frame % 2 === 1

  return { ...STAND, head: facing, legs: WALK_LEGS[frame] ?? 'stand', ...(lifted ? { bob: true, lean: facing === 'left' ? -1 as const : 1 as const } : {}), ...extra }
}

/** The stretch, eight frames: arms up, eyes shut (4); arms down (2); at rest (2). */
const stretchLook = (frame: number): Look => {
  if (frame < 4) return { ...STAND, head: 'shut', arms: 'up', armsUp: true }
  if (frame < 6) return { ...STAND, head: 'shut', arms: 'low' }

  return { ...STAND }
}

/**
 * Tidying up, eight frames on a loop beside its pile of pages (OVERLAYS.tidy):
 * arms up over the stack (2), the arm coming down on it, eyes shut with the
 * effort (2), arms low over the cube it made (1), looking at it, pleased (2),
 * watching the next stack land (1).
 */
const tidyLook = (frame: number): Look => {
  const step = ((frame % 8) + 8) % 8
  const overlays = [OVERLAYS.tidy[step] as Overlay]
  if (step < 2) return { ...STAND, head: 'right', arms: 'up', armsUp: true, overlays }
  if (step < 4) return { ...STAND, head: 'shut', arms: 'point', overlays }
  if (step < 5) return { ...STAND, head: 'shut', arms: 'low', overlays }
  if (step < 7) return { ...STAND, head: 'right', overlays }

  return { ...STAND, head: 'up', overlays }
}

/**
 * The cheer's dance, eight frames, a tick beside its head throughout: a
 * shuffle a cell left, a bounce with its arms up, a shuffle a cell right, a
 * bounce, and again.
 */
const cheerLook = (frame: number): Look => {
  const step = ((frame % 8) + 8) % 8
  if (step % 2 === 1) return { ...STAND, arms: 'up', armsUp: true, bob: true, overlays: OVERLAYS.tick }
  const left = step % 4 === 0

  return { ...STAND, nudge: left ? -1 : 1, legs: left ? 'shuffleLeft' : 'shuffleRight', overlays: OVERLAYS.tick }
}

const LOOK_AROUND: readonly Head[] = ['left', 'left', 'open', 'open', 'right', 'right', 'up', 'open']

/**
 * An idle mascot's look: its bit for the slot, keyed by its idle time so a
 * bit starts at its first frame; the blanket breathes and its `z`s rise by
 * the tick, with the moon after ten minutes.
 */
const idleLook = (id: string, idleMs: number, tick: number): Look => {
  const bit = idleBitOf(id, idleMs)
  const frame = Math.floor((Math.max(0, idleMs) % IDLE_SLOT_MS) / SCENE_FRAME_MS)
  switch (bit) {
    case 'look':
      return { ...STAND, head: at(LOOK_AROUND, frame) }
    case 'stretch':
      // Once a slot, then at rest.
      return stretchLook(Math.min(frame, 7))
    case 'sit':
      return { ...STAND, pose: 'sit', arms: 'low', head: frame % 16 === 12 || frame % 16 === 13 ? 'shut' : 'open' }
    case 'puff':
      return { ...STAND, head: 'shut', overlays: [...OVERLAYS.cigarette, at(OVERLAYS.smoke, frame)] }
    case 'blanket':
      return { ...STAND, head: 'shut', pose: 'blanket', breath: Math.floor(tick / 4) % 2, overlays: [...(idleMs >= LONG_IDLE_MS ? OVERLAYS.moon : []), at(OVERLAYS.zzz, tick)] }
  }
}

/**
 * Stalled: its idle bits, and a turning clock beside its head where the bit
 * leaves the side free; under its blanket (a stall is always past 90 s quiet)
 * the clock turns beside the quilt instead, clear of its z z Z.
 */
const stalledLook = (agent: MascotAgent, tick: number): Look => {
  const idleMs = agent.idleMs ?? 0
  const look = idleLook(agent.id, idleMs, tick)
  const bit = idleBitOf(agent.id, idleMs)
  if (bit === 'puff') return look
  if (bit === 'blanket') return { ...look, overlays: [...look.overlays, at(OVERLAYS.blanketClock, tick)] }

  return { ...look, overlays: [...look.overlays, at(OVERLAYS.clock, tick)] }
}

/** At work: idle bits once quiet a while; at its laptop while a tool runs; thinking, eyes up at its thought; asking, a hand up. */
const workLook = (agent: MascotAgent, tick: number): Look => {
  if (agent.activity === 'asking') return { ...STAND, arms: 'raised', overlays: OVERLAYS.ask }
  if (agent.idleMs !== undefined) return idleLook(agent.id, agent.idleMs, tick)
  switch (agent.activity) {
    case 'typing':
    case 'reading':
    case 'searching':
    case 'lifting':
    case 'fetching':
      return deskLook(tick)
    case 'thinking':
      return thinkLook(agent.id, tick)
  }
}

/**
 * Knocked over: a stagger, eyes shut (1); flat on its back, its hat knocked
 * off beside it (1); dizzy, its eyes crossing and rolling apart a frame at a time under
 * three stars that blink in turn (8); crouched, hands on the floor, eyes
 * back (1); then up, at its laptop again if it was at work.
 */
const knockedLook = (look: Look, step: number): Look => {
  if (step === 0) return { ...STAND, head: 'shut', arms: 'low' }
  if (step < FALL_TICKS) return { ...STAND, pose: 'flat', head: 'shut', hatOff: true }
  if (step < FALL_TICKS + DIZZY_TICKS) {
    const frame = step - FALL_TICKS

    return { ...STAND, pose: 'flat', head: frame % 2 === 0 ? 'spiral' : 'spin', hatOff: true, overlays: [at(OVERLAYS.dizzy, frame)] }
  }
  if (step < KNOCKED_TICKS - 1) return { ...STAND, pose: 'crouch', arms: 'low' }

  return look.desk === true ? deskLook(step) : { ...STAND }
}

/** A walk, a hop, a flight or a landing laid over a look: it rises the rows the motion says. */
const moved = (look: Look, motion: Motion | undefined, tick: number, facing: 'left' | 'right'): Look => {
  // In the air: its eyes (or the way it faces), the sweat drop, nothing else beside it.
  const aloft: Look = { ...STAND, head: look.head === 'left' || look.head === 'right' ? look.head : 'open', overlays: look.overlays.filter(one => ALOFT.has(one)) }
  switch (motion?.kind) {
    case undefined:
      return look
    case 'walk': {
      if (look.pose === 'sit' || look.pose === 'crouch' || look.pose === 'flat') return look
      const step = walkLook(tick, facing)

      return { ...look, pose: 'stand', legs: step.legs, desk: false, reach: false, arms: look.arms === 'point' && look.reach === true ? 'rest' : look.arms, bob: step.bob, lean: step.lean }
    }
    case 'hop':
      // Squashed on take-off and landing; arms up in the air, legs long, then tucked, then down.
      return motion.pose === 'squash'
        ? { ...aloft, pose: 'squash' }
        : { ...aloft, arms: 'up', armsUp: true, legs: motion.pose === 'stretch' ? 'stretch' : motion.pose === 'apex' ? 'tuck' : 'stand', lift: motion.lift }
    case 'fly':
      // Under the propeller cap, its blade turning a frame at a time; legs tucked.
      return { ...aloft, legs: 'tuck', cap: motion.step, lift: motion.lift }
    case 'land':
      // The bounce on landing: squashed for a frame.
      return { ...aloft, pose: 'squash' }
    case 'fallen':
      return knockedLook(look, motion.step)
  }
}

const withCues = (look: Look, cues: readonly Cue[] | undefined): Look => {
  let next = look
  for (const cue of cues ?? []) {
    switch (cue) {
      case 'give-scroll':
        // A hand held out: the task changes hands, nothing drawn in it.
        next = { ...next, arms: 'point', reach: false }
        break
      case 'take-report':
      case 'take-baton':
        break
      case 'nod':
        next = { ...next, head: 'shut' }
        break
      case 'glance':
        next = { ...next, head: 'up' }
        break
      case 'point':
        next = { ...next, arms: 'point', reach: false, overlays: [...next.overlays, ...OVERLAYS.pointing] }
        break
    }
  }

  return next
}

/** Falling out of the pipe's mouth: eyes wide, arms up, legs tucked. */
const FALL_LOOK: Look = { ...STAND, head: 'wide', arms: 'up', armsUp: true, legs: 'tuck' }

/** The pipe coming down over it: done, eyes up at it under its `✓`; failed, still slumped under its `✗`. */
const lowerLook = (agent: MascotAgent): Look =>
  agent.status === 'failed' ? { ...STAND, head: 'shut', arms: 'low', pose: 'sit', overlays: OVERLAYS.cross } : { ...STAND, head: 'up', overlays: OVERLAYS.tick }

/** Sucked up the pipe: stretched, arms up beside its head and legs long, eyes up (shut, failed); nothing beside it. */
const suckLook = (agent: MascotAgent): Look => ({ ...STAND, head: agent.status === 'failed' ? 'shut' : 'up', arms: 'up', armsUp: true, legs: 'stretch' })

/** The farewell's stage at a frame of it, where no exact time is known: the pipe coming down, then the suck. */
const leaveStage = (step: number): 'lower' | 'suck' => (step * SCENE_FRAME_MS < PIPE_SLIDE_MS ? 'lower' : 'suck')

const phaseLook = (agent: MascotAgent, phase: Phase, tick: number, facing: 'left' | 'right', pipe?: LookContext['pipe']): Look => {
  switch (phase.kind) {
    case 'arrive':
      return FALL_LOOK
    case 'take':
      return phase.step === 0 ? { ...STAND, head: 'left' } : { ...STAND }
    case 'setup':
      return phase.step === 0 ? { ...STAND, head: 'right' } : deskLook(tick)
    case 'stalled':
      return stalledLook(agent, tick)
    case 'pack':
      return phase.step < 2 ? deskLook(tick) : { ...STAND }
    case 'deliver':
      return walkLook(tick, facing)
    case 'hand':
    case 'baton':
      return phase.step === 0 ? { ...STAND, arms: 'point' } : { ...STAND }
    case 'cheer':
      return cheerLook(phase.step)
    case 'sit':
      return { ...STAND, head: 'shut', arms: 'low', pose: 'sit', overlays: OVERLAYS.cross }
    case 'leave':
      return (pipe ?? leaveStage(phase.step)) === 'lower' ? lowerLook(agent) : suckLook(agent)
    case 'work':
      return workLook(agent, tick)
  }
}

/** How long a mascot back from the TV stays shaken, and of that how long it shakes its head (a turn each SHAKE_STEP_MS). */
export const STARTLED_MS = 3000
export const SHAKE_MS = 1500
export const SHAKE_STEP_MS = 150

/**
 * Back from the TV, wondering what just happened: for SHAKE_MS it shakes its
 * head (looking left, then right, its whole figure a cell with its look every
 * other turn), then stands wide-eyed, arms down, to STARTLED_MS; a sweat drop
 * and a `!?` beside its head all along.
 */
export const startledLook = (ms: number): Look => {
  const turn = Math.floor(ms / SHAKE_STEP_MS)
  const shaking = ms < SHAKE_MS
  const head: Head = shaking ? (turn % 2 === 0 ? 'left' : 'right') : 'wide'

  return {
    ...STAND,
    head,
    arms: shaking ? 'rest' : 'low',
    ...(shaking && Math.floor(turn / 2) % 2 === 0 ? { nudge: turn % 2 === 0 ? (-1 as const) : (1 as const) } : {}),
    overlays: [at(OVERLAYS.sweat, Math.floor(ms / 250)), ...OVERLAYS.startle],
  }
}

/**
 * The smooth scene's touches over a look: held or thrown (eyes wide, arms up,
 * legs kicking while it dangles, tucked while it flies through the air; its
 * laptop gone), scanning eyes down in flight, a wobble's lean; shaken, back
 * from the TV (on its feet, wherever it was: not while the person holds it).
 */
const handled = (look: Look, context: LookContext): Look => {
  let next = look
  if (context.startled !== undefined && context.startled >= 0 && context.startled < STARTLED_MS && context.pose === undefined) return startledLook(context.startled)
  if (context.pose !== undefined) {
    const legs: Legs = context.pose === 'dangle' ? ((context.kick ?? 0) % 2 === 0 ? 'step' : 'stand') : 'tuck'
    next = { ...STAND, head: 'wide', arms: 'up', armsUp: true, legs, overlays: look.overlays.filter(one => ALOFT.has(one)), lift: look.lift }
  }
  if (context.scanning === true && context.motion?.kind === 'fly' && context.pose === undefined) next = { ...next, head: 'down' }
  if (context.nudge !== undefined && next.nudge === undefined && next.pose === 'stand') next = { ...next, nudge: context.nudge }

  return next
}

/** A full agent's look at this tick. `pointing`: its child stands right beside it. */
export const agentLook = (agent: MascotAgent, phase: Phase, tick: number, context: LookContext = {}): Look => {
  const facing = context.facing ?? 'right'
  const motion = context.motion
  // On the move at work (a wander, an errand, a leap): no laptop, and no idle bit.
  const travelling = phase.kind === 'work' && motion !== undefined && motion.kind !== 'fallen'
  let look = travelling ? walkLook(tick, facing, agent.activity === 'thinking' && agent.idleMs === undefined ? { overlays: [thoughtOf(agent.id, tick)] } : {}) : context.scanning && phase.kind === 'work' ? { ...STAND, head: 'down' as const } : phaseLook(agent, phase, tick, facing, context.pipe)
  look = withCues(moved(look, motion, tick, facing), context.cues)

  const standing = look.pose === 'stand' && look.lift === 0 && look.bob !== true
  if (context.pointing === true && standing && look.arms === 'rest') look = { ...look, arms: 'point' }

  return handled(look, context)
}

const MINI_SCAN: readonly MiniHead[] = ['left', 'left', 'open', 'right', 'right', 'open']
const MINI_STEPS: readonly MiniLegs[] = ['step', 'step', 'stand', 'stand']

const miniPhaseLook = (agent: MascotAgent, phase: Phase, tick: number, facing: 'left' | 'right', pipe?: LookContext['pipe']): MiniLook => {
  const base: MiniLook = { head: 'open', legs: 'stand', overlays: [], lift: 0, sit: false }
  switch (phase.kind) {
    case 'arrive':
      return { ...base, legs: 'step' }
    case 'deliver':
      return { ...base, head: facing === 'left' ? 'left' : 'right', legs: at(MINI_STEPS, tick) }
    case 'take':
    case 'setup':
    case 'pack':
    case 'hand':
    case 'baton':
      return base
    case 'stalled':
      return { ...base, head: at(MINI_SCAN, tick), legs: at<MiniLegs>(['stand', 'stand', 'tap', 'tap'], tick), overlays: [at(MINI_OVERLAYS.clock, tick)] }
    case 'cheer':
      return { ...base, overlays: MINI_OVERLAYS.tick }
    case 'sit':
      return { ...base, head: 'shut', sit: true, overlays: MINI_OVERLAYS.cross }
    case 'leave':
      // The pipe coming down: under its ✓, or slumped under its ✗; then sucked up, legs kicking.
      if ((pipe ?? leaveStage(phase.step)) === 'lower') return agent.status === 'done' ? { ...base, overlays: MINI_OVERLAYS.tick } : { ...base, head: 'shut', sit: true, overlays: MINI_OVERLAYS.cross }
      return { ...base, head: agent.status === 'done' ? 'open' : 'shut', legs: 'step' }
    case 'work':
      if (agent.activity === 'asking') return { ...base, overlays: MINI_OVERLAYS.ask }
      // Idle: looking about; from 90 s, eyes shut, its z rising.
      if (agent.idleMs !== undefined) {
        return agent.idleMs >= BLANKET_AFTER_MS ? { ...base, head: 'shut', overlays: [at(MINI_OVERLAYS.zzz, tick)] } : { ...base, head: at(MINI_SCAN, tick) }
      }
      // A tool running: its laptop in front of it, the same for every tool.
      return agent.activity === 'thinking' ? { ...base, overlays: [at(MINI_OVERLAYS.thought, tick)] } : { ...base, legs: 'none', overlays: MINI_OVERLAYS.laptop }
  }
}

export const miniLook = (agent: MascotAgent, phase: Phase, tick: number, context: LookContext = {}): MiniLook => {
  let look = miniPhaseLook(agent, phase, tick, context.facing ?? 'right', context.pipe)
  if (context.scanning && phase.kind === 'work') look = { ...look, head: at(MINI_SCAN, tick), legs: 'stand', overlays: [] }
  const motion = context.motion
  if (motion?.kind === 'walk' && look.legs !== 'none') look = { ...look, legs: at(MINI_STEPS, tick) }
  if ((motion?.kind === 'hop' || motion?.kind === 'fly') && motion.lift > 0) look = { ...look, lift: motion.lift }
  if (motion?.kind === 'fallen' && motion.step < KNOCKED_TICKS - 1) {
    const dizzy = motion.step >= FALL_TICKS && motion.step < FALL_TICKS + DIZZY_TICKS
    look = { ...look, head: 'shut', legs: 'none', sit: true, lift: 0, overlays: dizzy ? [at(MINI_OVERLAYS.dizzy, motion.step)] : [] }
  }
  // Held or thrown: upright, legs kicking or tucked, nothing beside it.
  if (context.pose !== undefined) look = { head: 'open', legs: context.pose === 'dangle' && (context.kick ?? 0) % 2 === 1 ? 'step' : 'stand', overlays: [], lift: look.lift, sit: false }
  // Back from the TV: shaking its head, then still.
  else if (context.startled !== undefined && context.startled >= 0 && context.startled < STARTLED_MS) {
    look = { head: context.startled < SHAKE_MS ? (Math.floor(context.startled / SHAKE_STEP_MS) % 2 === 0 ? 'left' : 'right') : 'open', legs: 'stand', overlays: [], lift: 0, sit: false }
  }

  return look
}

/** The session's mascot at this tick: its mood, then any motion and cue. Its crown is in what it wears. */
export const mainLook = (main: MascotMain, tick: number, context: LookContext = {}): Look => {
  const sweat = main.sweating ? [at(OVERLAYS.sweat, tick)] : []
  const stretched = ticksOf(main.stretchMs)
  const tidying = ticksOf(main.tidyMs)
  let look: Look
  if (tidying !== undefined) {
    look = tidyLook(tidying)
  } else if (stretched !== undefined) {
    look = stretchLook(Math.min(stretched, 7))
  } else {
    switch (main.mood) {
      case 'idle':
        look = idleLook('main', main.idleMs ?? 0, tick)
        break
      case 'thinking':
        look = thinkLook('main', tick)
        break
      case 'watching':
        // Eyes on the agents to its right, a blink every two seconds.
        look = { ...STAND, head: context.facing === 'left' ? 'left' : tick % 8 === 7 ? 'shut' : 'right' }
        break
    }
  }
  look = { ...look, overlays: [...sweat, ...look.overlays] }

  return handled(withCues(moved(look, context.motion, tick, context.facing ?? 'right'), context.cues), context)
}
