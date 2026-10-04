import type { CollisionMode, Hop, Memo } from './motion-types'

// Mascot movement as pure functions of where everyone stood a frame ago, the
// frame and each mascot's id: wandering, hops, flights and the bump rule. No
// randomness: every choice is a hash of (id, what is chosen, frame), so the
// same scene at the same frame moves the same way on every surface. Nothing
// here touches state: the pane keeps the result in its per-surface plan cache.
// State machine: docs/mascots.md ("Choreography").
//
// The scene is one open field: a mover has a column `x` and a depth `d`, the
// rows from the back of the field (0 the back), its floor that many rows below
// the back row's. Two movers only meet when they stand within a row of depth
// of each other (DEPTH_REACH): nearer or farther they pass freely, the nearer
// drawn over the farther. A one-row field is a line, as before.
//
// A mover has a lift: the rows its feet are above its own floor. At a lift of
// 0 or 1 it is on the ground, where nobody passes anybody within a row of
// depth and everyone keeps a gap; higher, it is in the air, over the others'
// heads: it passes over the ground freely and only meets fliers within a row
// of its own lift.

/** The least gap between two sprites within a row of depth of each other, in cells. */
export const GAP = 1
/** Movers further apart in depth than this never meet: no gap, no bump, no collision. */
export const DEPTH_REACH = 1
/** A walk changes depth a row every this many frames (its column every frame). */
export const DEPTH_FRAMES = 2
/** A row of depth weighs this many cells when the nearest free spot is sought. */
export const DEPTH_COST = 2
/** A pause between walks: 4 to 12 frames. */
export const PAUSE_MIN = 4
export const PAUSE_SPAN = 9
/** One walking frame in this many starts a leap: a hop, or a flight where there is room. */
export const LEAP_ONE_IN = 10
/** One leap in this many is a flight, where a flight fits. */
export const FLY_ONE_IN = 3
/** A flight cruises 6 to 10 frames at its altitude before it comes down. */
export const CRUISE_MIN = 6
export const CRUISE_SPAN = 5
/** A hop's apex, in rows: a mascot's height and one, enough to clear another. */
export const HOP_HEIGHT = 4
/** How far a hop goes when it passes nobody. */
export const HOP_REACH = 10
/** A hop's frames in the air: stretch, apex, apex, air (lifts 2 4 4 2 at its full height), between its two squashes. */
export const HOP_AIR = 4
/** Rows of sky a flight needs above the floor's line. */
export const FLY_SKY = 3
/** A flier's propeller turns a row above its cap: it flies this many rows under the top of the sky. */
export const PROPELLER_ROWS = 1
/** At this lift and above, a mover is in the air: over the heads of those on the ground. */
export const AIRBORNE = 2
/** How far a hop keeps from anyone already in the air, and a flier from a hop: room for a few frames' drift. */
export const AIR_MARGIN = 3
/** A cruise bobs a row up and down, two seconds a bob. */
export const BOB = [0, 0, 1, 1, 0, 0, -1, -1] as const
/** How many missed frames a redraw catches up on; more than this jumps. */
export const CATCH_UP = 16

/** The frame this many ms into a run of frames `frameMs` long: sprite cycles are keyed by elapsed time. */
export const frameAt = (ms: number, frameMs = 250): number => Math.floor(ms / frameMs)

/** A collision: knocked down (2), dizzy (8), getting up (2). */
export const FALL_TICKS = 2
export const DIZZY_TICKS = 8
export const RISE_TICKS = 2
export const KNOCKED_TICKS = FALL_TICKS + DIZZY_TICKS + RISE_TICKS
/** How long a pair waits before colliding again, by mode, in ms. */
export const CONTACT_COOLDOWN_MS: Readonly<Record<CollisionMode, number>> = { off: 0, rare: 30_000, normal: 10_000 }

/** The two ids of a pair, in a stable order. */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)

/** FNV-1a of the parts: the same parts, the same number, everywhere. */
export const hashOf = (...parts: readonly (string | number)[]): number => {
  let hash = 0x811c9dc5
  const text = parts.join('|')
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  // A final avalanche, so consecutive frames do not give consecutive numbers.
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x2c1b3c6d) >>> 0
  hash ^= hash >>> 12

  return hash >>> 0
}

/** A number in [0, span) chosen by `id` for `what` at frame `tick`. */
export const roll = (id: string, what: string, tick: number, span: number): number =>
  span <= 1 ? 0 : hashOf(id, what, tick) % span

/** How long a flier waits for clear ground before its neighbours walk aside to open the nearest gap for it. */
export const LANDING_PATIENCE = 80
/** Past this many frames of waiting it lands whatever the ground: only when no gap can open (a field packed past its room). */
export const LANDING_GIVE_UP = 3 * LANDING_PATIENCE
/** The smooth scene's flights wait four seconds for a clear spot before a gap is opened: a flight stays ten to thirty seconds. */
export const SMOOTH_LANDING_PATIENCE = 16

// The smooth scene's flights (rules.smooth): long, rare when idle, and with a meaning.
/** Once up, a flight lasts at least four seconds: no flicker between calls. */
export const FLIGHT_MIN_TICKS = 16
/** An idle wanderer's flight: one walking frame in this many (one leap in 40), rarer than sitting or a puff. */
export const IDLE_FLY_ONE_IN = 400
/** An idle flight cruises 10 to 30 seconds. */
export const IDLE_CRUISE_MIN = 40
export const IDLE_CRUISE_SPAN = 81
/** A cruise changes altitude every 3 to 6 seconds; one change in three is a loop. */
export const TURN_MIN = 12
export const TURN_SPAN = 13
export const LOOP_ONE_IN = 3
/** A loop lasts a second and a half: the renderer draws its circle. */
export const LOOP_TICKS = 6
/** A loop's circle rises this many rows over the flier's lift: the sky it needs over it. */
export const LOOP_ROWS = 3
/** A scene's errand flies over the floor when it would pass this many standing in the way. */
export const CROWD_OBSTACLES = 2
/** The session flies to a newcomer further than this across the field. */
export const FAR_CELLS = 30
/** Reading this long (only Read, Grep and Glob calls since), an agent lifts off. */
export const READING_STREAK_MS = 5000
/** An errand's flight crosses two cells a frame (8 a second); every other one cell. */
export const ERRAND_CELLS = 2

/** Whether a mover is knocked over at `tick`. */
export const isKnocked = (memo: Memo | undefined, tick: number): boolean =>
  memo?.fallFrom !== undefined && tick - memo.fallFrom < KNOCKED_TICKS

export const toward = (from: number, to: number): number => from + Math.sign(to - from)

/** A row of depth toward `to` on every DEPTH_FRAMES-th frame. */
export const towardDepth = (from: number, to: number, tick: number): number => (((tick % DEPTH_FRAMES) + DEPTH_FRAMES) % DEPTH_FRAMES === 0 ? toward(from, to) : from)

export const pauseOf = (id: string, tick: number): number => PAUSE_MIN + roll(id, 'pause', tick, PAUSE_SPAN)

export const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value))

/** Whether two depths are within a row of each other: the only ones that meet. */
export const nearDepth = (a: number, b: number): boolean => Math.abs(a - b) <= DEPTH_REACH

/**
 * A hop's lift at a step of its arc: 0 on its squashed first and last frames,
 * half its height on its first and last frames in the air, its height
 * between (0 2 4 4 2 0 for a full hop); a spring in place, its height.
 */
export const hopLift = (hop: Pick<Hop, 'air' | 'height'>, step: number): number => {
  if (step <= 0 || step > hop.air) return 0
  if (hop.air <= 2) return hop.height

  return step === 1 || step === hop.air ? Math.round(hop.height / 2) : hop.height
}

/** A hop's pose at a step of its arc. */
export const hopPose = (air: number, step: number): 'squash' | 'stretch' | 'apex' | 'air' => {
  if (step <= 0 || step > air) return 'squash'
  if (air <= 2) return 'apex'

  return step === 1 ? 'stretch' : step === air ? 'air' : 'apex'
}
