import { clamp } from './motion-rules'

// The mascot scene's physics, for what the person does with the pointer and
// what happens when bodies meet in the air: pure functions of a body, the
// room and a fixed time step, no randomness. The `Client` surface module
// (hooks/scene-client.tsx) steps them on its own frame clock; nothing here
// touches state. Units: cells across, rows up (a lift: rows above the body's
// own floor), seconds; velocities in cells (rows) per second.
//
// docs/mascots.md, "Physics and controls".

/** Downward pull, rows per second per second. */
export const GRAVITY = 30
/** Air drag: the share of its speed a body keeps after a second in the air (a little lost). */
export const AIR_KEEP = 0.85
/** A bounce keeps this share of the speed into the floor, a wall or the ceiling. */
export const RESTITUTION = 0.4
/** On a bounce off the floor a body keeps this share of its speed across (friction). */
export const BOUNCE_FRICTION = 0.7
/** Sliding on the floor slows a body by this many cells per second each second. */
export const SLIDE_FRICTION = 40
/** Below this speed into the floor, a landing is soft (a squash, no bounce). */
export const SOFT_SPEED = 8
/** At this speed or more against a wall or the floor, a body is knocked out (down, dizzy, up). */
export const KNOCKOUT_SPEED = 16
/** A drop from fewer rows than this is set down gently, however it lands. */
export const GENTLE_DROP_ROWS = 3
/** No throw is faster than this, cells (rows) per second. */
export const MAX_SPEED = 60
/** A release's velocity is measured over the pointer's last ~100 ms. */
export const SAMPLE_MS = 100
/** A press is a click when it comes up within 300 ms and less than a cell from where it went down. */
export const CLICK_MS = 300
export const CLICK_CELLS = 1
/** A body at rest on the floor: slower than this across. */
const REST_SPEED = 0.5

/** A body in flight: where it is, how fast it goes, its bounds, and what happened to it so far. */
export type Body = {
  /** Its left column (fractional). */
  x: number
  /** Rows its feet are above its floor (fractional, 0 on the floor). */
  lift: number
  /** Cells per second across (right positive), rows per second up. */
  vx: number
  vy: number
  /** The lowest and highest left column it may take, and the highest lift (its top at the region's top). */
  minX: number
  maxX: number
  maxLift: number
  /** The highest lift since it was let go or last bounced: a drop is measured from it. */
  peak: number
  /** It bounced at least once: it wobbles when it settles. */
  bounced?: boolean
  /** Knocked out against a wall or by another body: it falls and stays down. */
  out?: boolean
}

/** What one step did: hit a wall, the ceiling, or the floor (and how hard), or came to rest. */
export type Impact = { kind: 'wall' | 'ceiling' | 'floor'; speed: number }

/** How a landing ends: set down (soft), a bounce with a wobble after, or knocked out. */
export type Landing = 'soft' | 'bounce' | 'knockout'

export type Stepped = { body: Body; impacts: Impact[]; landed?: Landing; resting: boolean }

/** A velocity no faster than MAX_SPEED either way. */
export const capped = (v: number): number => clamp(v, -MAX_SPEED, MAX_SPEED)

/**
 * How a body landing at `speed` (its speed down into the floor) after falling
 * `dropRows` lands: knocked out at KNOCKOUT_SPEED or more; else soft below
 * SOFT_SPEED or from a gentle drop (fewer than GENTLE_DROP_ROWS rows); else a
 * bounce, and a wobble once it settles.
 */
export const landingOf = (speed: number, dropRows: number): Landing => {
  if (speed >= KNOCKOUT_SPEED) return 'knockout'
  if (speed < SOFT_SPEED || dropRows < GENTLE_DROP_ROWS) return 'soft'

  return 'bounce'
}

/** A body let go at (x, lift) with a velocity, bounded by the room. */
export const released = (x: number, lift: number, vx: number, vy: number, bounds: { minX: number; maxX: number; maxLift: number }): Body => ({
  x: clamp(x, bounds.minX, bounds.maxX),
  lift: clamp(lift, 0, Math.max(0, bounds.maxLift)),
  vx: capped(vx),
  vy: capped(vy),
  minX: bounds.minX,
  maxX: bounds.maxX,
  maxLift: Math.max(0, bounds.maxLift),
  peak: clamp(lift, 0, Math.max(0, bounds.maxLift)),
})

/**
 * One fixed step of `dt` seconds: gravity, a little air drag, then the walls,
 * the ceiling and the floor. Into a wall it bounces back (RESTITUTION); at
 * KNOCKOUT_SPEED or more it is knocked out and drops. Onto the floor it lands
 * by `landingOf`: soft settles it (sliding to a stop by SLIDE_FRICTION), a
 * bounce sends it back up at RESTITUTION of its speed (BOUNCE_FRICTION across),
 * knocked out settles it where it hit. Semi-implicit Euler: the same body and
 * step, the same result, everywhere.
 */
export const step = (body: Body, dt: number): Stepped => {
  const impacts: Impact[] = []
  let { x, lift, vx, vy, peak } = body
  let bounced = body.bounced
  let out = body.out
  let landed: Landing | undefined
  const onFloor = lift <= 0 && vy <= 0
  if (onFloor) {
    // Sliding: friction slows it to rest.
    const slow = SLIDE_FRICTION * dt
    vx = Math.abs(vx) <= slow ? 0 : vx - Math.sign(vx) * slow
    vy = 0
    lift = 0
  } else {
    vy -= GRAVITY * dt
    const keep = AIR_KEEP ** dt
    vx *= keep
    vy *= keep
  }
  x += vx * dt
  lift += vy * dt
  if (lift > peak) peak = lift
  if (x < body.minX || x > body.maxX) {
    const speed = Math.abs(vx)
    impacts.push({ kind: 'wall', speed })
    x = clamp(x, body.minX, body.maxX)
    if (speed >= KNOCKOUT_SPEED) {
      out = true
      vx = 0
      vy = Math.min(vy, 0)
    } else {
      vx = -vx * RESTITUTION
    }
  }
  if (lift > body.maxLift) {
    impacts.push({ kind: 'ceiling', speed: Math.abs(vy) })
    lift = body.maxLift
    vy = -Math.abs(vy) * RESTITUTION
  }
  if (lift < 0 && !onFloor) {
    // Into the floor: the speed down, as into a wall the speed across.
    const speed = Math.abs(vy)
    impacts.push({ kind: 'floor', speed })
    lift = 0
    const how: Landing = out === true ? 'knockout' : landingOf(speed, peak)
    if (how === 'bounce') {
      bounced = true
      vy = Math.abs(vy) * RESTITUTION
      vx *= BOUNCE_FRICTION
      peak = 0
      // Too slow to leave the floor again: it has landed.
      if (vy * vy < 2 * GRAVITY * 0.25) {
        vy = 0
        landed = 'soft'
      }
    } else {
      landed = how
      vy = 0
      if (how === 'knockout') vx = 0
    }
  }
  const next: Body = { ...body, x, lift, vx, vy, peak, ...(bounced === true ? { bounced } : {}), ...(out === true ? { out } : {}) }
  const resting = next.lift <= 0 && next.vy <= 0 && Math.abs(next.vx) < REST_SPEED

  return { body: next, impacts, ...(landed === undefined ? {} : { landed }), resting }
}

/** One pointer position at a moment of the frame clock. */
export type Sample = { ms: number; x: number; y: number }

/**
 * The pointer's velocity over its last SAMPLE_MS: cells per second across and
 * rows per second down (the region's rows grow downward). Samples within one
 * frame share its time: the span is never taken as less than `frameMs`.
 */
export const velocityOf = (samples: readonly Sample[], nowMs: number, frameMs: number): { vx: number; vy: number } => {
  const recent = samples.filter(one => nowMs - one.ms <= SAMPLE_MS)
  const last = recent.at(-1) ?? samples.at(-1)
  const first = recent[0] ?? last
  if (last === undefined || first === undefined) return { vx: 0, vy: 0 }
  const span = Math.max(frameMs, last.ms - first.ms) / 1000

  return { vx: capped((last.x - first.x) / span), vy: capped((last.y - first.y) / span) }
}

/** Whether a press was a click: up within CLICK_MS, and moved less than CLICK_CELLS. */
export const isClick = (downMs: number, upMs: number, dx: number, dy: number): boolean =>
  upMs - downMs < CLICK_MS && Math.hypot(dx, dy) < CLICK_CELLS

/** A body's extent on the canvas: its columns [x, x + width) and rows [top, top + height). */
export type Rect = { x: number; width: number; top: number; height: number }

/**
 * Whether two rects meet, the rows within `slack` of each other (a thrown body
 * passing a row over a head still knocks it).
 */
export const meets = (a: Rect, b: Rect, slack = 1): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.top < b.top + b.height + slack && b.top < a.top + a.height + slack

/** The rect a body sweeps moving from `from` to `to` in one step: both ends and all between. */
export const swept = (from: Rect, to: Rect): Rect => {
  const x = Math.min(from.x, to.x)
  const top = Math.min(from.top, to.top)

  return { x, width: Math.max(from.x + from.width, to.x + to.width) - x, top, height: Math.max(from.top + from.height, to.top + to.height) - top }
}

/** One target a moving body may hit: its id and its rect. */
export type Target = { id: string; rect: Rect }

/** Every target the body's sweep meets this step (within a row), bowling-pin style, in the order given. */
export const hitsAlong = (from: Rect, to: Rect, targets: readonly Target[], slack = 1): string[] => {
  const path = swept(from, to)

  return targets.filter(one => meets(path, one.rect, slack)).map(one => one.id)
}

/** A body in the air as the contact rules see it: its body's columns, its lift (feet) and which way it moves up or down. */
export type Airborne = { x: number; width: number; lift: number; vy: number }

/** A full mascot's box is four rows from its feet to its air row; the flying cap's blade one more. */
export const BOX_TALL = 4

/**
 * A hop meeting a flier: `bonk` rising into it from below (the hopper's head
 * reaches the flier's feet), `ride` coming down onto it from above (the
 * hopper's feet on its cap), else none. Only bodies that overlap across meet.
 */
export const airContact = (hopper: Airborne, flier: Airborne): 'bonk' | 'ride' | undefined => {
  if (!(hopper.x < flier.x + flier.width && flier.x < hopper.x + hopper.width)) return undefined
  const head = hopper.lift + BOX_TALL - 1
  if (hopper.vy > 0 && hopper.lift < flier.lift && head >= flier.lift) return 'bonk'
  if (hopper.vy <= 0 && hopper.lift >= flier.lift + 2 && hopper.lift <= flier.lift + BOX_TALL) return 'ride'

  return undefined
}

/** A flier coming down onto one standing on the floor: at its lowest hover (two rows) or under, overlapping across. */
export const descentContact = (flier: Airborne, standing: { x: number; width: number }): boolean =>
  flier.vy <= 0 && flier.lift <= 2 && flier.x < standing.x + standing.width && standing.x < flier.x + flier.width

/** Whether a pair may meet again: not within `cooldownMs` of the last time (ms on the scene's clock). */
export const cooled = (last: number | undefined, nowMs: number, cooldownMs: number): boolean =>
  last === undefined || nowMs - last >= cooldownMs
