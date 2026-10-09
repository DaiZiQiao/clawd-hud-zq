import { hashOf } from './motion-rules'
import { PIPE_DROP_MS, PIPE_FAREWELL_MS, PIPE_SLIDE_MS } from './scene-pipe'
import type { MascotAgent, Phase, PipeShare } from './scene-types'

// Where each mascot is in its life, by the scene's quarter-second frames:
// arriving by the pipe, taking its task, at work, packing up, handing back,
// cheering or sitting, leaving by the pipe; and an idle mascot's bits. Pure
// functions of the agent and the frame.

// --- timing, in quarter-second frames ----------------------------------------

export const SCENE_FRAME_MS = 250
/**
 * Arriving by the red pipe (hooks/scene-pipe.ts): the pipe comes down over its slot
 * (2 frames) and it drops out to its floor (2); the pipe goes back up as it
 * starts. One of several spawned within two seconds waits its turn in the
 * shared pipe (`MascotAgent.pipe`).
 */
export const ARRIVE_TICKS = (PIPE_SLIDE_MS + PIPE_DROP_MS) / SCENE_FRAME_MS
/** Leaving by the pipe: it comes down over it (2), sucks it up (4) and goes (2). */
export const FAREWELL_TICKS = PIPE_FAREWELL_MS / SCENE_FRAME_MS
/** Delegation: the spawner holds out its hand, then the newcomer takes the task. */
export const HANDOFF_TICKS = 2
/** Start of work: it turns to its desk (1), then its laptop is there (2). */
export const SETUP_TICKS = 3
/** Done: at its laptop (2), then the laptop is gone (1). Failed: at its laptop (2). */
export const PACK_TICKS = 3
export const FAIL_PACK_TICKS = 2
/** Hand back: up to eight frames walking to the spawner, two handing over. */
export const DELIVER_TICKS = 8
export const HAND_TICKS = 2
/** A workflow agent hands on to the next of its squad: two frames. */
export const BATON_TICKS = 2
/** A finished agent dances under its `✓` for two seconds, then leaves by the pipe. */
export const CHEER_TICKS = 8
/** A failed one sits under its `✗` for five seconds, then leaves by the pipe. */
export const SIT_TICKS = 20
/** A farewell is over within three seconds: the pipe's takes two (FAREWELL_TICKS). */
export const EXIT_TICKS = 12
/** A compaction: the session's mascot stretches for three seconds. */
export const STRETCH_TICKS = 12
/** A compaction that started longer ago than this and never ended (a reload mid-way) is no longer drawn: no tidying up, no `tidying up` in the band. */
export const TIDY_STALE_MS = 15 * 60_000
/** Review: up to ten frames walking to the desk, then eight standing beside it. */
export const REVIEW_WALK_TICKS = 10
export const REVIEW_STAND_TICKS = 8
/** A reviewer or debugger links to a finished agent within this long of it ending. */
export const LINK_WINDOW_MS = 60_000
/** Debugger sparks: two frames in every eight. */
export const SPARK_EVERY = 8
/** A message's bubble is dropped this many frames after it was sent, wherever it got to. */
export const MESSAGE_TICKS = 40
/** Idle this long, the sleeping mascot gets a moon. */
export const LONG_IDLE_MS = 10 * 60_000
/** An agent quiet this long with no tool running (or stalled) does idle bits. */
export const IDLE_AFTER_MS = 6000
/** Idle time comes in slots this long, each with one bit. */
export const IDLE_SLOT_MS = 6000
/** Idle this long, a mascot sleeps under its blanket. */
export const BLANKET_AFTER_MS = 90_000

/** A pipe of its own: down over its slot, it drops out, the pipe goes up. */
export const soloPipe = (id: string): PipeShare => ({ anchor: id, after: 0, drop: PIPE_SLIDE_MS, up: PIPE_SLIDE_MS + PIPE_DROP_MS })

export const ticksOf = (ms: number | undefined): number | undefined => (ms === undefined ? undefined : Math.floor(ms / SCENE_FRAME_MS))

/** How long a finished agent stays before its farewell walk: its pack, scenes and cheer or sit. */
export const holdTicks = (agent: Pick<MascotAgent, 'status' | 'spawner' | 'workflow' | 'squadNext'>, scenes = false): number => {
  if (agent.status === 'failed') return FAIL_PACK_TICKS + SIT_TICKS
  const deliver = scenes && agent.spawner !== undefined && agent.workflow !== true ? DELIVER_TICKS + HAND_TICKS : 0
  const baton = scenes && agent.squadNext !== undefined ? BATON_TICKS : 0

  return PACK_TICKS + deliver + baton + CHEER_TICKS
}

// --- phases --------------------------------------------------------------------

/** Frames from its spawn until it is on its floor: its own pipe's, or its turn in a shared one. */
export const arriveTicksOf = (agent: Pick<MascotAgent, 'id' | 'pipe'>): number => {
  const share = agent.pipe ?? soloPipe(agent.id)

  return Math.ceil((share.drop + PIPE_DROP_MS - share.after) / SCENE_FRAME_MS)
}

/** The agent's phase at this moment of the scene; `scenes` adds the handoffs. */
export const phaseOf = (agent: MascotAgent, scenes = false): Phase => {
  const ended = ticksOf(agent.endedMs)
  if (agent.status === 'done' || agent.status === 'failed') {
    let at = ended ?? 0
    const pack = agent.status === 'done' ? PACK_TICKS : FAIL_PACK_TICKS
    // A seeded agent's end with no known time skips straight to its cheer or sit.
    if (ended !== undefined && at < pack) return { kind: 'pack', step: at }
    at -= ended === undefined ? 0 : pack
    if (agent.status === 'done' && scenes && agent.spawner !== undefined && agent.workflow !== true) {
      if (at < DELIVER_TICKS) return { kind: 'deliver', step: at }
      at -= DELIVER_TICKS
      if (at < HAND_TICKS) return { kind: 'hand', step: at }
      at -= HAND_TICKS
    }
    if (agent.status === 'done' && scenes && agent.squadNext !== undefined) {
      if (at < BATON_TICKS) return { kind: 'baton', step: at }
      at -= BATON_TICKS
    }
    const held = agent.status === 'done' ? CHEER_TICKS : SIT_TICKS
    if (at < held) return agent.status === 'done' ? { kind: 'cheer', step: at } : { kind: 'sit' }

    return { kind: 'leave', step: at - held }
  }
  const age = ticksOf(agent.ageMs)
  if (age !== undefined) {
    const arrive = arriveTicksOf(agent)
    if (age < arrive) return { kind: 'arrive', step: age }
    let at = age - arrive
    if (scenes && agent.spawner !== undefined) {
      if (at < HANDOFF_TICKS) return { kind: 'take', step: at }
      at -= HANDOFF_TICKS
    }
    if (at < SETUP_TICKS && agent.activity !== 'asking') return { kind: 'setup', step: at }
  }

  return agent.status === 'stalled' && agent.activity !== 'asking' ? { kind: 'stalled' } : { kind: 'work' }
}

/** Frames since the agent's work began (setup over), for the review and fix scenes; undefined when unknown. */
export const workTicks = (agent: MascotAgent, scenes: boolean): number | undefined => {
  const age = ticksOf(agent.ageMs)
  if (age === undefined) return undefined

  return age - arriveTicksOf(agent) - (scenes && agent.spawner !== undefined ? HANDOFF_TICKS : 0) - SETUP_TICKS
}

// --- idle bits -------------------------------------------------------------------

/** What an idle mascot does in a slot: look around, stretch, sit, have a puff; from 90 s, sleep under its blanket. */
export type IdleBit = 'look' | 'stretch' | 'sit' | 'puff' | 'blanket'
const BITS: readonly IdleBit[] = ['look', 'stretch', 'sit', 'puff', 'look']

/**
 * The bit a mascot idle `idleMs` does: the first 6 s slot looks around; each
 * later slot takes a bit by a hash of its id and the slot, never the one
 * before it again; from 90 s it sleeps under its blanket.
 */
export const idleBitOf = (id: string, idleMs: number): IdleBit => {
  if (idleMs >= BLANKET_AFTER_MS) return 'blanket'
  const slot = Math.floor(Math.max(0, idleMs) / IDLE_SLOT_MS)
  let bit: IdleBit = 'look'
  for (let one = 1; one <= slot; one += 1) {
    let index = hashOf(id, 'idle', one) % BITS.length
    while (BITS[index] === bit) index = (index + 1) % BITS.length
    bit = BITS[index] ?? 'look'
  }

  return bit
}
