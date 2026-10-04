import { BODY_WIDTH, BODY_X, BOX_ROWS, MINI } from './mascot-sprites'
import type { Rect } from './motion-physics'
import { KNOCKED_TICKS, LOOP_TICKS, clamp, frameAt } from './motion-rules'
import type { Memo, Motion } from './motion-types'
import { sceneFromInputs } from './scene-model'
import { SCENE_FRAME_MS } from './scene-phases'
import { mascotPlan } from './scene-plan'
import type { MascotLayout, MascotPlan, MascotScene, Placement, SpriteView } from './scene-types'
import type { World } from './scene-world'

// The smooth scene's frame at the scene's time: the choreography's plans
// (hooks/scene-plan.ts) for the frame and the next, and each mascot glided
// between them (across, in depth, up a hop's arc, through a flier's loop) or
// where the person's body has it. hooks/scene-world.ts keeps the world.

export const CHOREO_MS = SCENE_FRAME_MS

/** A dangling mascot kicks its legs every 120 ms; a propeller turns every 125. */
const KICK_MS = 120
const BLADE_MS = 125

/** Where a mascot is this frame, as the contact rules see it. */
export type Seen = { id: string; kind: Placement['kind']; d: number; x: number; lift: number; rect: Rect; motion?: Motion['kind']; vy: number; descending: boolean; knocked: boolean }

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** The canvas row of the box top (its air row) of a mascot at depth `d` with its feet on its floor. */
export const floorTop = (plan: MascotPlan, d: number): number => plan.headroom + Math.round(d)

/** A sprite's body across: a full mascot's figure, a mini's whole width. */
const bodySpan = (kind: Placement['kind']): { dx: number; width: number } => (kind === 'mini' ? { dx: 0, width: MINI } : { dx: BODY_X, width: BODY_WIDTH })

/** The rect a mascot's body takes on the canvas: its head, torso and legs (the air row is the contact's slack). */
export const rectAt = (plan: MascotPlan, kind: Placement['kind'], d: number, x: number, lift: number): Rect => {
  const span = bodySpan(kind)

  return { x: x + span.dx, width: span.width, top: plan.headroom + d - lift + 1, height: BOX_ROWS - 1 }
}

export const layoutAt = (world: World, tick: number): MascotLayout => ({
  columns: world.props.columns,
  rows: world.props.rows,
  tick,
  wander: world.props.wander,
  scenes: world.props.scenes,
  collisions: world.props.collisions,
  motion: 'smooth',
  held: [...world.carried.keys()],
})

export const sceneAt = (world: World, now: number): MascotScene => sceneFromInputs(world.props, now)

/** The world's one contact history, in ms; predicted plans never commit contacts. */
export const rememberContacts = (world: World): void => {
  for (const [pair, at] of world.cur?.contacts ?? []) {
    const ms = at * CHOREO_MS
    if (ms <= world.sceneNow) world.contacts.set(pair, Math.max(ms, world.contacts.get(pair) ?? -Infinity))
  }
  for (const [pair, ms] of world.contacts) if (world.sceneNow - ms >= 30_000) world.contacts.delete(pair)
}

export const planAt = (world: World, tick: number, previous: MascotPlan | undefined): MascotPlan | undefined => {
  const contacts = new Map(previous?.contacts)
  for (const [pair, ms] of world.contacts) contacts.set(pair, Math.max(ms / CHOREO_MS, contacts.get(pair) ?? -Infinity))
  return mascotPlan(sceneAt(world, tick * CHOREO_MS), layoutAt(world, tick), previous === undefined ? undefined : { ...previous, contacts })
}

/** A hop's place at a moment (frames, fractional): along its line from take-off to landing, up its arc. */
const hopAt = (hop: NonNullable<Memo['hop']>, t: number): { x: number; lift: number; vy: number; pose: 'squash' | 'stretch' | 'apex' | 'air' } => {
  const u = (t - hop.from - 0.5) / hop.air
  const inAir = u > 0 && u < 1
  const lift = inAir ? hop.height * 4 * u * (1 - u) : 0
  const x = hop.x0 + (hop.x1 - hop.x0) * clamp((t - hop.from) / (hop.air + 1), 0, 1)
  const pose = !inAir || lift < 0.5 ? 'squash' : u < 0.25 ? 'stretch' : u <= 0.75 ? 'apex' : 'air'

  return { x, lift, vy: inAir ? hop.height * 4 * (1 - 2 * u) : 0, pose }
}

/**
 * Where everyone is at the scene's time: each placement glided between the
 * plan's frame and the next, across and in depth (hops up their arc, fliers
 * through their loops), the person's bodies where physics has them. The pipe
 * that brings and takes a mascot plays in the scene's own drawing
 * (`placedSprites`), by the scene's time.
 */
export const viewOf = (world: World): { sprites: Map<string, SpriteView>; seen: Map<string, Seen> } => {
  const sprites = new Map<string, SpriteView>()
  const seen = new Map<string, Seen>()
  const plan = world.cur
  if (plan === undefined) return { sprites, seen }
  if (world.view?.at === world.sceneNow) return world.view
  const t = world.sceneNow / CHOREO_MS
  const frac = clamp(t - plan.tick, 0, 1)
  const after = new Map(world.next?.placements.map(one => [one.id, one]))
  const blade = frameAt(world.ms, BLADE_MS)
  for (const one of plan.placements) {
    if (one.kind === 'strip') continue
    const carried = world.carried.get(one.id)
    if (carried !== undefined) {
      const { x, lift } = carried.body
      sprites.set(one.id, { x, d: carried.d, lift, pose: carried.mode === 'held' ? 'dangle' : 'tumble', kick: frameAt(world.ms, KICK_MS) })
      seen.set(one.id, { id: one.id, kind: one.kind, d: carried.d, x, lift, rect: rectAt(plan, one.kind, carried.d, x, lift), vy: carried.body.vy, descending: false, knocked: false })
      continue
    }
    const then = after.get(one.id)
    const same = then !== undefined && Math.abs(then.d - one.d) <= 1
    let x = same ? lerp(one.drawnX, then.drawnX, frac) : one.drawnX
    const d = same ? lerp(one.d, then.d, frac) : one.d
    let lift = same ? lerp(one.lift ?? 0, then.lift ?? 0, frac) : (one.lift ?? 0)
    let vy = 0
    const coming = same ? then.motion : one.motion
    let motion: Motion | undefined = coming
    const memo = world.next?.memo.get(one.id) ?? plan.memo.get(one.id)
    switch (coming?.kind) {
      case undefined:
        motion = one.motion?.kind === 'fallen' ? one.motion : undefined
        break
      case 'walk':
        lift = 0
        break
      case 'hop': {
        const hop = memo?.hop ?? plan.memo.get(one.id)?.hop
        if (hop !== undefined) {
          const arc = hopAt(hop, t)
          x = arc.x
          lift = arc.lift
          vy = arc.vy
          motion = { kind: 'hop', step: Math.floor(t - hop.from), lift: Math.round(lift), pose: arc.pose }
        }
        break
      }
      case 'fly': {
        const loop = then?.loop ?? one.loop
        if (loop !== undefined && t - loop >= 0 && t - loop < LOOP_TICKS) {
          const angle = (2 * Math.PI * (t - loop)) / LOOP_TICKS
          x += 3 * Math.sin(angle)
          lift += 1.5 * (1 - Math.cos(angle))
        }
        vy = (then?.lift ?? 0) - (one.lift ?? 0)
        motion = { kind: 'fly', step: blade, lift: Math.round(lift) }
        break
      }
      case 'land':
        lift = lerp(one.lift ?? 0, 0, frac)
        motion = lift >= 0.75 ? { kind: 'fly', step: blade, lift: Math.round(lift) } : { kind: 'land' }
        break
      case 'fallen':
        // Knocked over at the next frame: until then as it is now.
        motion = one.motion
        break
    }
    const touch = world.touches.get(one.id)
    if (touch?.squashUntil !== undefined && world.ms < touch.squashUntil && lift < 0.5) motion = { kind: 'land' }
    const nudge = touch?.wobbleUntil !== undefined && world.ms < touch.wobbleUntil ? (frameAt(world.ms, 100) % 2 === 0 ? -1 : 1) : undefined
    const flight = then?.flight ?? one.flight
    sprites.set(one.id, {
      x,
      d,
      lift,
      ...(motion === undefined ? {} : { motion }),
      ...(nudge === undefined ? {} : { nudge }),
      ...(flight === 'scan' ? { scanning: true } : {}),
      ...(then?.facing === undefined ? {} : { facing: then.facing }),
    })
    const knocked = motion?.kind === 'fallen' || (memo?.fallFrom !== undefined && plan.tick - memo.fallFrom < KNOCKED_TICKS)
    seen.set(one.id, { id: one.id, kind: one.kind, d, x, lift, rect: rectAt(plan, one.kind, d, x, lift), ...(motion === undefined ? {} : { motion: motion.kind }), vy, descending: memo?.fly?.stage === 'descend', knocked })
  }
  world.view = { at: world.sceneNow, sprites, seen }

  return world.view
}
