// The shapes of mascot movement (hooks/motion-rules.ts has the rules): what
// a mascot remembers between frames, how it moves this frame, how the field
// step sees it and what it returns. Types only.

/**
 * Collisions: `off` keeps the bump rule (both step back a cell); `rare` (the
 * default) lets only two moving mascots collide, keeps wanderers two cells
 * apart and a pair 30 s apart between collisions; `normal` lets a moving
 * mascot knock over a standing one too, a pair 10 s apart. Only mascots on the
 * ground collide, and only within a row of depth of each other.
 */
export type CollisionMode = 'off' | 'rare' | 'normal'

/** A hop: its first frame, where it springs from and lands, its frames in the air and its apex. Its depth holds. */
export type Hop = {
  from: number
  x0: number
  x1: number
  air: number
  height: number
  /** The smooth scene: how many times its landing has been taken, on the way to clear ground. */
  blocked?: number
}

/**
 * Why a mascot flies (the smooth scene): `idle` a wanderer's rare flight for
 * fun; `fetch` a WebFetch or WebSearch running; `scan` an Explore or
 * researcher agent at work; `read` a streak of Read, Grep and Glob calls;
 * `compaction` the session's mascot after one; `errand` a scene's walk over a
 * crowded floor, or the session's to a newcomer far down the field.
 */
export type FlightReason = 'idle' | 'fetch' | 'scan' | 'read' | 'compaction' | 'errand'

/** A flight: its first frame, cruising altitude and cruise length; the stage it is in, since when. */
export type Flight = {
  from: number
  altitude: number
  cruise: number
  stage: 'climb' | 'cruise' | 'descend'
  since: number
  /** Frames it has hung a row up, waiting for clear ground to land on. */
  waited?: number
  /** Out of patience: the spot it lands in (and its depth) once its neighbours have walked aside to open it. */
  gap?: number
  gapD?: number
  /** The smooth scene's flights: why it flies, the frame before which it never lands, where it lands (column and depth). */
  reason?: FlightReason
  minUntil?: number
  home?: number
  homeD?: number
  /** The frame its next change of altitude is due. */
  turnAt?: number
  /** The frame a loop began: the renderer draws the loop's circle from it. */
  loop?: number
}

/** What one mascot remembers between frames, in the plan cache. */
export type Memo = {
  /** Its left column now. */
  x: number
  /** Its depth now: rows from the back of the field. */
  d?: number
  /** How many rows above its floor it is now. */
  lift?: number
  /** Where it is walking or flying to, when it is: the column, and the depth. */
  target?: number
  targetD?: number
  /** It stands still until this frame. */
  pauseUntil: number
  hop?: Hop
  fly?: Flight
  /** Knocked over in a collision at this frame: down, dizzy, then up again. */
  fallFrom?: number
}

/** How a mascot moves this frame, for its look; `lift` is rows above the floor. */
export type Motion =
  | { kind: 'walk' }
  /** A hop: squashed on take-off and landing, stretched leaving the ground, legs tucked at the apex, down again in the air. */
  | { kind: 'hop'; step: number; lift: number; pose: 'squash' | 'stretch' | 'apex' | 'air'; from?: number; u?: number }
  | { kind: 'fly'; step: number; lift: number }
  /** The bounce of a flight's landing: squashed. */
  | { kind: 'land' }
  /** Knocked over: 0 and 1 down, 2 to 9 dizzy, 10 and 11 getting up. */
  | { kind: 'fallen'; step: number }

/** One mascot on the field, as the movement step sees it. */
export type Mover = {
  id: string
  width: number
  /** Its body's width, when its sprite is wider (an agent's laptop place): what it takes up in the air. */
  body?: number
  /** Where it stands now: its memo, else its slot. */
  x: number
  /** Its depth now (absent: 0, the back). */
  d?: number
  /** Its bounds: 0 and the last column it can start at. */
  lo: number
  hi: number
  /** The depths it may take (absent: its own row only, a line). */
  dLo?: number
  dHi?: number
  /** It may wander (awake and between tools). */
  free: boolean
  /** A place a scene sends it to, or its slot when nothing wanders; overrides wandering. */
  goal?: number
  /** The depth of that place (absent: its own). */
  goalD?: number
  /** Rows of free sky above it: 0 with no room. */
  sky: number
  memo?: Memo
  /** A flight the scene asks of it this frame (the smooth scene): why, and where it lands when it is over. */
  ask?: { reason: FlightReason; home?: number; homeD?: number }
  /** Standing where it is whatever happens (arriving or leaving by the pipe): an obstacle, never moved, never knocked. */
  fixed?: boolean
  /** Usagi: it strolls, and bounds one walking frame in BOUND_ONE_IN, far and low (hooks/motion-rules.ts). */
  springy?: true
}

export type Moved = { x: number; d: number; lift: number; memo: Memo; motion?: Motion; bumped?: boolean; collided?: boolean }

/**
 * How a step treats contact, and the frame each pair last collided.
 * `smooth`: the smooth scene's rules (the `Client` surface): flights asked by
 * real signals, idle flights rare and long with altitude changes and loops,
 * hops free to meet fliers (the surface plays the contact) when collisions
 * are on, and the ground packed a cell a frame, never in one jump.
 */
export type Rules = { collisions?: CollisionMode; lastContact?: ReadonlyMap<string, number>; smooth?: boolean }
