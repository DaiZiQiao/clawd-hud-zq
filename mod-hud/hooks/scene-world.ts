import type { ClientPointerEvent, JsonValue } from 'claude-code'

import { BOX_ROWS } from './mascot-sprites'
import { CLICK_CELLS, CLICK_MS, airContact, cooled, descentContact, hitsAlong, isClick, released, step, velocityOf } from './motion-physics'
import type { Body, Landing, Rect, Sample } from './motion-physics'
import { AIRBORNE, CONTACT_COOLDOWN_MS, KNOCKED_TICKS, PAUSE_MIN, PROPELLER_ROWS, clamp, nearDepth, pairKey } from './motion-rules'
import type { Memo } from './motion-types'
import type { MascotPlan, Placement, SceneInputs, SpriteView } from './scene-types'
import { CHOREO_MS, floorTop, planAt, rectAt, rememberContacts, viewOf } from './scene-view'
import type { Seen } from './scene-view'

// The smooth scene's world: everything that moves, in the surface module's
// local state, and what the frame clock and the person's pointer do to it.
// The choreography's plans step in its 250 ms frames (hooks/scene-view.ts
// glides between them); the person's bodies (hooks/motion-physics.ts) step at
// FRAME_MS. docs/mascots.md, "Physics and controls".

/**
 * The frame clock: 50 ms, 20 frames a second. Inside 20 to 30, a third under
 * the engine's 30 visible-pane redraws a second (the pane's own one-second
 * tick shares it), and five frames to each 250 ms choreography frame, so every
 * frame of a walk, a hop or a flight is drawn at the same five steps.
 */
export const FRAME_MS = 50

/** A landing's squash, a wobble after a bounce, a flier's wobble after a bonk, a ride on a flier. */
export const SQUASH_MS = 150
export const WOBBLE_MS = 700
export const BUMP_MS = 800
export const RIDE_MS = 1000
/** A grip with no pointer move for this long is released on the existing frame clock. */
const GRIP_IDLE_MS = 10_000

/** What the person's press holds: who, since when, where, and whether it has been picked up yet. */
type Grip = {
  id: string
  downMs: number
  movedMs: number
  start: { x: number; y: number }
  samples: Sample[]
  lifted: boolean
  /** The pointer's place on the sprite: from its left column, and from its box's top row. */
  offset: { x: number; y: number }
}

/** A mascot out of the choreography: in the person's hand, thrown, falling, or riding a flier. */
export type Carried = {
  id: string
  mode: 'held' | 'thrown' | 'tumble' | 'ride'
  body: Body
  /** The depth it was taken from: its floor while it is out of the choreography (a throw keeps its depth). */
  d: number
  width: number
  kind: Placement['kind']
  /** Down and dizzy when it lands, however softly (it hit someone, or was knocked out of the air). */
  knock?: boolean
  /** Landed and sliding to a stop. */
  grounded?: boolean
  ride?: { on: string; dx: number; until: number }
  /** Who it already knocked over on this throw. */
  hit?: string[]
}

type Touch = { squashUntil?: number; wobbleUntil?: number }

/** The instance's local state: everything that moves, nothing the hooks keep. */
export type World = {
  /** The frame clock, ms since mount. */
  ms: number
  /** The hooks' time at a moment of the frame clock: the scene's time runs on from it. */
  anchor: { now: number; ms: number }
  /** The scene's time, in the hooks' clock, never going back. */
  sceneNow: number
  props: SceneInputs
  cur?: MascotPlan
  next?: MascotPlan
  carried: Map<string, Carried>
  grip?: Grip
  touches: Map<string, Touch>
  /** When each pair last met (ms of the scene's time), for the cooldown. */
  contacts: Map<string, number>
  view?: { at: number; sprites: Map<string, SpriteView>; seen: Map<string, Seen> }
  owners?: (string | undefined)[][]
}

/** A new instance's world: the scene at the hooks' time, nothing moving yet. */
export const createWorld = (props: SceneInputs): World => {
  const world: World = {
    ms: 0,
    anchor: { now: props.now, ms: 0 },
    sceneNow: props.now,
    props,
    carried: new Map(),
    touches: new Map(),
    contacts: new Map(),
  }
  advance(world)

  return world
}

/** The choreography caught up with the scene's time: `cur` at its frame, `next` the frame after. */
export const advance = (world: World): void => {
  rememberContacts(world)
  const tick = Math.floor(world.sceneNow / CHOREO_MS)
  const cur = world.cur
  if (cur === undefined || cur.tick > tick) {
    world.cur = planAt(world, tick, undefined)
    world.next = world.cur === undefined ? undefined : planAt(world, tick + 1, world.cur)

    return
  }
  if (cur.tick === tick) {
    if (world.next === undefined) world.next = planAt(world, tick + 1, cur)

    return
  }
  world.cur = world.next !== undefined && world.next.tick === tick && tick - cur.tick === 1 ? world.next : planAt(world, tick, cur)
  world.next = world.cur === undefined ? undefined : planAt(world, tick + 1, world.cur)
  world.view = undefined
}

/** New props from a redraw: keep motion, re-plan the geometry, and re-clamp bodies. */
export const receive = (world: World, props: SceneInputs): void => {
  if (props === world.props) return
  const wasPaused = world.props.paused === true
  world.props = props
  if (props.paused === true) return
  // The hooks' time moved, or Back after a pause: keep local physics time,
  // but catch the lifecycle clock up to the hooks, never going back.
  if (wasPaused || props.now !== world.anchor.now) {
    world.anchor = { now: props.now, ms: world.ms }
    world.sceneNow = Math.max(world.sceneNow, props.now)
  }
  rememberContacts(world)
  world.cur = planAt(world, Math.floor(world.sceneNow / CHOREO_MS), world.cur)
  world.next = world.cur === undefined ? undefined : planAt(world, world.cur.tick + 1, world.cur)
  refreshCarried(world)
  world.view = undefined
}

/** The plan's frame with one mascot's memo (and placement) replaced, and the frame after it planned again. */
export const inject = (world: World, id: string, memo: Memo, patch?: Partial<Placement>, home = false): void => {
  const cur = world.cur
  if (cur === undefined) return
  const memos = new Map(cur.memo)
  memos.set(id, memo)
  const placements = cur.placements.map(one => {
    if (one.id !== id || patch === undefined) return one
    const next: Placement = { ...one, ...patch }
    if (patch.motion === undefined && 'motion' in patch) delete next.motion

    return next
  })
  const homing = new Set(cur.homing ?? [])
  if (home) homing.add(id)
  world.cur = { ...cur, memo: memos, placements, homing }
  world.next = planAt(world, cur.tick + 1, world.cur)
  world.view = undefined
}

/** A mascot of the choreography taken out of it where it is now: into the person's hand, or falling. */
const take = (world: World, id: string, mode: Carried['mode'], velocity: { vx: number; vy: number } = { vx: 0, vy: 0 }, extra: Partial<Carried> = {}): Carried | undefined => {
  const plan = world.cur
  const one = plan?.placements.find(placement => placement.id === id)
  if (plan === undefined || one === undefined || one.kind === 'strip' || !grabbable(world, one)) return undefined
  const where = viewOf(world).seen.get(id)
  const x = where?.x ?? one.drawnX
  const lift = where?.lift ?? 0
  const before = world.carried.get(id)
  const d = before?.d ?? Math.round(where?.d ?? one.d)
  const body = released(x, lift, velocity.vx, velocity.vy, { minX: 0, maxX: plan.columns - one.width, maxLift: floorTop(plan, d) })
  const carried: Carried = { ...(before ?? {}), id, mode, body: before === undefined ? body : { ...before.body, vx: velocity.vx, vy: velocity.vy }, d, width: one.width, kind: one.kind, ...extra }
  world.carried.set(id, carried)
  world.next = planAt(world, plan.tick + 1, plan)
  world.view = undefined

  return carried
}

/** Down where it stands (or lies), dizzy: knocked over by a thrown mascot or a flier coming down on it. */
const knockDown = (world: World, id: string): void => {
  const plan = world.cur
  const where = viewOf(world).seen.get(id)
  const one = plan?.placements.find(placement => placement.id === id)
  if (plan === undefined || where === undefined || one === undefined) return
  if (where.lift >= 0.5) {
    take(world, id, 'tumble', { vx: 0, vy: 0 }, { knock: true })
    return
  }
  const x = clamp(Math.round(where.x), 0, plan.columns - one.width)
  const d = Math.round(where.d)
  inject(world, id, { x, d, lift: 0, pauseUntil: plan.tick + KNOCKED_TICKS, fallFrom: plan.tick }, { drawnX: x, d, lift: 0, motion: { kind: 'fallen', step: 0 } })
}

/** A body comes to rest: back into the choreography where it landed, knocked out, wobbling, or just set down; it walks home. */
export const settle = (world: World, carried: Carried, how: Landing): void => {
  const plan = world.cur
  world.carried.delete(carried.id)
  if (plan === undefined) return
  const x = clamp(Math.round(carried.body.x), 0, plan.columns - carried.width)
  const d = clamp(carried.d, 0, plan.depth - 1)
  const out = how === 'knockout' || carried.knock === true || carried.body.out === true
  const memo: Memo = out
    ? { x, d, lift: 0, pauseUntil: plan.tick + KNOCKED_TICKS, fallFrom: plan.tick }
    : { x, d, lift: 0, pauseUntil: plan.tick + PAUSE_MIN }
  inject(world, carried.id, memo, { drawnX: x, d, lift: 0, motion: out ? { kind: 'fallen', step: 0 } : undefined }, true)
  const touch: Touch = { ...(world.touches.get(carried.id) ?? {}) }
  if (!out) touch.squashUntil = world.ms + SQUASH_MS
  if (!out && carried.body.bounced === true) touch.wobbleUntil = world.ms + WOBBLE_MS
  world.touches.set(carried.id, touch)
}

const cooldownOf = (world: World): number => CONTACT_COOLDOWN_MS[world.props.collisions]

const meet = (world: World, a: string, b: string): boolean => {
  rememberContacts(world)
  const key = pairKey(a, b)
  if (!cooled(world.contacts.get(key), world.sceneNow, cooldownOf(world))) return false
  world.contacts.set(key, world.sceneNow)
  if (world.cur !== undefined) {
    const contacts = new Map(world.cur.contacts)
    contacts.set(key, world.sceneNow / CHOREO_MS)
    world.cur = { ...world.cur, contacts }
    world.next = planAt(world, world.cur.tick + 1, world.cur)
  }

  return true
}

/** A thrown mascot's sweep this step: everyone it passes through is knocked over, a flier knocked out of the air, and it goes down too. */
const bowl = (world: World, carried: Carried, from: Rect, to: Rect): void => {
  if (world.props.collisions === 'off') return
  const seen = viewOf(world).seen
  const targets = [...seen.values()]
    .filter(one => one.id !== carried.id && !world.carried.has(one.id) && contactable(world, one.id) && !one.knocked && !(carried.hit ?? []).includes(one.id) && nearDepth(Math.round(one.d), carried.d))
    .map(one => ({ id: one.id, rect: one.rect }))
  for (const id of hitsAlong(from, to, targets)) {
    if (!meet(world, carried.id, id)) continue
    carried.hit = [...(carried.hit ?? []), id]
    carried.knock = true
    const target = seen.get(id)
    if (target?.motion === 'fly') {
      // A flier hit drops, and so does what hit it.
      take(world, id, 'tumble', { vx: 0, vy: 0 }, { knock: true })
      carried.body = { ...carried.body, vx: 0, vy: Math.min(0, carried.body.vy), peak: carried.body.lift }
    } else {
      knockDown(world, id)
    }
  }
}

/** Reflow changes a body's floor and bounds, not its ownership or velocity. */
const refreshCarried = (world: World): void => {
  const plan = world.cur
  if (plan === undefined) return
  for (const carried of world.carried.values()) {
    const one = plan.placements.find(placement => placement.id === carried.id)
    if (one === undefined || one.kind === 'strip') {
      world.carried.delete(carried.id)
      if (world.grip?.id === carried.id) world.grip = undefined
      continue
    }
    carried.d = clamp(carried.d, 0, plan.depth - 1)
    const top = floorTop(plan, carried.d)
    const oldTop = carried.body.maxLift
    const maxX = Math.max(0, plan.columns - one.width)
    carried.width = one.width
    carried.kind = one.kind
    carried.body = { ...carried.body, minX: 0, maxX, maxLift: top, x: clamp(carried.body.x, 0, maxX), lift: clamp(carried.body.lift + top - oldTop, 0, top) }
  }
}

/** The person's bodies one frame on: thrown and falling ones under physics, riders on their fliers. */
const stepCarried = (world: World, dt: number): void => {
  const plan = world.cur
  if (plan === undefined) return
  for (const carried of [...world.carried.values()]) {
    if (carried.mode === 'held') continue
    if (carried.mode === 'ride' && carried.ride !== undefined) {
      const flier = viewOf(world).seen.get(carried.ride.on)
      if (flier === undefined || world.carried.has(carried.ride.on) || world.ms >= carried.ride.until) {
        // The ride is over: both tumble down, dizzy.
        carried.mode = 'tumble'
        carried.knock = true
        carried.body = { ...carried.body, vx: 0, vy: 0, peak: carried.body.lift }
        if (flier !== undefined && !world.carried.has(carried.ride.on)) take(world, carried.ride.on, 'tumble', { vx: 0, vy: 0 }, { knock: true })
        delete carried.ride
      } else {
        carried.body = { ...carried.body, x: clamp(flier.x + carried.ride.dx, carried.body.minX, carried.body.maxX), lift: clamp(flier.lift + BOX_ROWS, 0, carried.body.maxLift), vx: 0, vy: 0 }
      }
      continue
    }
    const from = rectAt(plan, carried.kind, carried.d, carried.body.x, carried.body.lift)
    const stepped = step(carried.body, dt)
    carried.body = stepped.body
    if (carried.mode === 'thrown') bowl(world, carried, from, rectAt(plan, carried.kind, carried.d, carried.body.x, carried.body.lift))
    if (stepped.landed === 'knockout') {
      settle(world, carried, 'knockout')
    } else if (stepped.landed !== undefined) {
      carried.grounded = true
      if (stepped.resting) settle(world, carried, stepped.landed)
    } else if (stepped.resting) {
      settle(world, carried, 'soft')
    }
  }
}

/**
 * Hops and fliers meet (with collisions on): a hop rising into a flier from
 * below bonks and drops, dizzy, the flier knocked up a row with a wobble; a
 * hop coming down onto one rides it a second as it sinks a row, then both
 * tumble, dizzy. A flier coming down onto one standing knocks both down.
 */
const meetInAir = (world: World): void => {
  const plan = world.cur
  if (plan === undefined || world.props.collisions === 'off') return
  const seen = [...viewOf(world).seen.values()].filter(one => !world.carried.has(one.id) && contactable(world, one.id))
  const hoppers = seen.filter(one => one.motion === 'hop' && one.lift >= 0.5)
  const fliers = seen.filter(one => one.motion === 'fly' && one.lift >= AIRBORNE - 0.5)
  for (const hopper of hoppers) {
    for (const flier of fliers) {
      if (hopper.id === flier.id || world.carried.has(hopper.id) || world.carried.has(flier.id) || !nearDepth(Math.round(hopper.d), Math.round(flier.d))) continue
      const sky = plan.headroom + Math.round(flier.d) - PROPELLER_ROWS
      const contact = airContact({ x: hopper.rect.x, width: hopper.rect.width, lift: hopper.lift, vy: hopper.vy }, { x: flier.rect.x, width: flier.rect.width, lift: flier.lift, vy: flier.vy })
      if (contact === undefined || !meet(world, hopper.id, flier.id)) continue
      const memo = (world.next?.memo.get(flier.id) ?? plan.memo.get(flier.id))
      const fly = memo?.fly
      if (contact === 'bonk') {
        take(world, hopper.id, 'tumble', { vx: 0, vy: 0 }, { knock: true })
        if (memo !== undefined && fly !== undefined) {
          inject(world, flier.id, { ...memo, lift: Math.min(sky, (memo.lift ?? 0) + 1), fly: { ...fly, altitude: Math.min(sky, fly.altitude + 1) } })
        }
        world.touches.set(flier.id, { ...(world.touches.get(flier.id) ?? {}), wobbleUntil: world.ms + BUMP_MS })
      } else {
        take(world, hopper.id, 'ride', { vx: 0, vy: 0 }, { ride: { on: flier.id, dx: hopper.x - flier.x, until: world.ms + RIDE_MS } })
        if (memo !== undefined && fly !== undefined) {
          inject(world, flier.id, { ...memo, lift: Math.max(AIRBORNE, (memo.lift ?? 0) - 1), fly: { ...fly, altitude: Math.max(AIRBORNE, fly.altitude - 1) } })
        }
      }
    }
  }
  if (world.props.collisions !== 'normal') return
  const standing = seen.filter(one => one.lift < 0.5 && one.motion !== 'hop' && one.motion !== 'fly' && !one.knocked)
  for (const flier of fliers) {
    if (!flier.descending || flier.vy >= 0 || world.carried.has(flier.id)) continue
    for (const one of standing) {
      if (one.id === flier.id || !nearDepth(Math.round(one.d), Math.round(flier.d)) || !descentContact({ x: flier.rect.x, width: flier.rect.width, lift: flier.lift, vy: flier.vy }, one.rect)) continue
      if (!meet(world, flier.id, one.id)) continue
      knockDown(world, one.id)
      take(world, flier.id, 'tumble', { vx: 0, vy: 0 }, { knock: true })
      break
    }
  }
}

/** The pressed mascot picked up: out of the choreography, dangling where it was. */
const pickUp = (world: World, grip: Grip): void => {
  const one = world.cur?.placements.find(placement => placement.id === grip.id)
  if (one === undefined || one.kind === 'strip' || !grabbable(world, one)) return
  if (take(world, grip.id, 'held') !== undefined) grip.lifted = true
}

/** Who can be picked up: the session's mascot, an agent at its place (not in the pipe, arriving or leaving), or one already in the air. */
const grabbable = (world: World, one: Placement): boolean => {
  if (world.carried.has(one.id)) return true
  if (one.kind === 'main') return true
  const phase = one.phase?.kind

  return phase !== undefined && phase !== 'arrive' && phase !== 'leave'
}

const contactable = (world: World, id: string): boolean => {
  const one = world.cur?.placements.find(placement => placement.id === id)
  return one !== undefined && one.kind !== 'strip' && grabbable(world, one)
}

/** The held mascot follows the pointer, inside the region and above its own floor. */
const dragTo = (world: World, grip: Grip, x: number, y: number): void => {
  const plan = world.cur
  const carried = world.carried.get(grip.id)
  if (plan === undefined || carried === undefined) return
  refreshCarried(world)
  const lift = floorTop(plan, carried.d) - (y - grip.offset.y)
  carried.body = { ...carried.body, x: clamp(x - grip.offset.x, carried.body.minX, carried.body.maxX), lift: clamp(lift, 0, carried.body.maxLift), vx: 0, vy: 0 }
  world.view = undefined
}

/** A missing pointer-up releases gently rather than inventing a flick. */
const releaseGrip = (world: World): boolean => {
  const grip = world.grip
  world.grip = undefined
  const carried = grip === undefined ? undefined : world.carried.get(grip.id)
  if (carried?.mode !== 'held') return false
  carried.mode = 'thrown'
  carried.hit = []
  carried.body = released(carried.body.x, carried.body.lift, 0, 0, carried.body)
  world.view = undefined
  return true
}

/** One frame of the frame clock: the scene's time on, the choreography caught up, bodies stepped, meetings played. */
export const tick = (world: World): void => {
  if (world.props.paused === true) return
  world.ms += FRAME_MS
  world.sceneNow = Math.max(world.sceneNow, world.anchor.now + (world.ms - world.anchor.ms))
  world.view = undefined
  advance(world)
  if (world.cur === undefined) return
  refreshCarried(world)
  if (world.grip !== undefined && world.ms - world.grip.movedMs >= GRIP_IDLE_MS) releaseGrip(world)
  const grip = world.grip
  if (grip !== undefined && !grip.lifted && world.ms - grip.downMs >= CLICK_MS) pickUp(world, grip)
  stepCarried(world, FRAME_MS / 1000)
  meetInAir(world)
  for (const [id, touch] of world.touches) {
    if ((touch.squashUntil ?? 0) <= world.ms && (touch.wobbleUntil ?? 0) <= world.ms) world.touches.delete(id)
  }
  world.view = undefined
}

/**
 * One pointer event, in the region's cells (`fine` sub-cell where the
 * terminal reports pixels): a press on a mascot grips it; past a cell of
 * movement or 300 ms it is picked up and follows the pointer; let go, it flies
 * on with the pointer's velocity over its last ~100 ms. A press let go sooner,
 * less than a cell from where it went down, is a click: on an agent it asks
 * the hooks to inspect it. True when the drawing changed.
 */
export const pointer = (world: World, event: ClientPointerEvent, post: (data: JsonValue) => void): boolean => {
  if (world.props.paused === true) return false
  const px = event.fine?.x ?? event.x + 0.5
  const py = event.fine?.y ?? event.y + 0.5
  const plan = world.cur
  switch (event.type) {
    case 'down': {
      const released = world.grip === undefined ? false : releaseGrip(world)
      if (plan === undefined) return released
      const id = world.owners?.[event.y]?.[event.x]
      const one = id === undefined ? undefined : plan.placements.find(placement => placement.id === id)
      if (id === undefined || one === undefined || one.kind === 'strip') return released
      const where = viewOf(world).seen.get(id)
      const x = where?.x ?? one.drawnX
      const top = floorTop(plan, world.carried.get(id)?.d ?? where?.d ?? one.d) - (where?.lift ?? 0)
      world.grip = { id, downMs: world.ms, movedMs: world.ms, start: { x: px, y: py }, samples: [{ ms: world.ms, x: px, y: py }], lifted: false, offset: { x: px - x, y: py - top } }

      return released
    }
    case 'move': {
      const grip = world.grip
      if (grip === undefined) return false
      grip.movedMs = world.ms
      grip.samples = [...grip.samples.filter(one => world.ms - one.ms <= 300), { ms: world.ms, x: px, y: py }]
      if (!grip.lifted && (Math.hypot(px - grip.start.x, py - grip.start.y) >= CLICK_CELLS || world.ms - grip.downMs >= CLICK_MS)) pickUp(world, grip)
      if (!grip.lifted) return false
      dragTo(world, grip, px, py)

      return true
    }
    case 'up': {
      const grip = world.grip
      if (grip === undefined) return false
      world.grip = undefined
      if (!grip.lifted) {
        const one = plan?.placements.find(placement => placement.id === grip.id)
        // An agent's mascot, or the session's (its id `main`): the hooks inspect it.
        const mascot = one !== undefined && (one.kind === 'full' || one.kind === 'mini' || one.kind === 'main')
        if (mascot && world.props.inspect && isClick(grip.downMs, world.ms, px - grip.start.x, py - grip.start.y)) post({ kind: 'inspect', id: grip.id })

        return false
      }
      const carried = world.carried.get(grip.id)
      if (carried === undefined) return true
      grip.samples.push({ ms: world.ms, x: px, y: py })
      const velocity = velocityOf(grip.samples, world.ms, FRAME_MS)
      // The region's rows grow downward; a lift grows up.
      carried.mode = 'thrown'
      carried.hit = []
      carried.body = released(carried.body.x, carried.body.lift, velocity.vx, -velocity.vy, carried.body)

      return true
    }
    default:
      return false
  }
}
