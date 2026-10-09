import { BOX, LAPTOP_X, SLOT } from './mascot-sprites'
import { stepField } from './motion-arbitrate'
import { AIRBORNE, CATCH_UP, CROWD_OBSTACLES, FAR_CELLS, FLY_SKY, GAP, READING_STREAK_MS, isKnocked } from './motion-rules'
import type { CollisionMode, Memo, Motion, Mover } from './motion-types'
import { clearOf, depthsFor, dottedOf, fieldLayout, fieldOf, stripText } from './scene-layout'
import { ACCENT, isNumber } from './scene-model'
import { FAREWELL_TICKS, REVIEW_STAND_TICKS, REVIEW_WALK_TICKS, SCENE_FRAME_MS, SPARK_EVERY, arriveTicksOf, phaseOf, workTicks } from './scene-phases'
import type { Cue, Mark, MascotAgent, MascotLayout, MascotPlan, MascotScene, Phase, Placement, Slot } from './scene-types'

// Where everything stands at a frame (`mascotPlan`): the field laid out
// (hooks/scene-layout.ts), the previous frame's plan carried on, each
// mover's goal and flight asked, the field stepped (hooks/motion-arbitrate.ts)
// once per frame passed, and the scenes' cues and marks.

/** Phases in which a mascot stands on its floor and takes part in movement and bumping. */
export const SETTLED: ReadonlySet<Phase['kind']> = new Set(['work', 'stalled', 'take', 'setup', 'pack', 'deliver', 'hand', 'baton', 'cheer', 'sit'])
/** Done or failed, before the pipe: it stays where it stands (but for its walk back to its spawner). */
const FINISHING: ReadonlySet<Phase['kind']> = new Set(['pack', 'hand', 'baton', 'cheer', 'sit'])

const clampTo = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value))

/**
 * Where everything stands at this tick: the field as deep as `rows` holds;
 * undefined when not even the session's mascot fits (fewer than 4 rows, or
 * fewer columns than its slot). `previous` is the plan of an earlier frame
 * on this surface: slots, positions and intents carry on from it, one frame
 * of movement per tick passed, none on a redraw of the same tick.
 */
export const mascotPlan = (scene: MascotScene, layout: MascotLayout, previous?: MascotPlan): MascotPlan | undefined => {
  const columns = isNumber(layout.columns) ? Math.floor(layout.columns) : 0
  const rows = isNumber(layout.rows) ? Math.floor(layout.rows) : 0
  const tick = Math.floor(isNumber(layout.tick) ? layout.tick : 0)
  const field = fieldOf(columns, rows)
  if (field === undefined) return undefined
  const { depth, headroom } = field
  const wander = layout.wander === true
  const scenes = layout.scenes === true
  const collisions: CollisionMode = layout.collisions ?? 'rare'
  const smooth = layout.motion === 'smooth'
  const held = new Set(layout.held ?? [])
  if (previous?.columns !== columns || (!smooth && (previous.depth !== depth || previous.headroom !== headroom)) || previous.tick > tick || previous.wander !== wander || previous.scenes !== scenes || previous.collisions !== collisions || (previous.smooth ?? false) !== smooth) previous = undefined
  const before = new Map(previous?.placements.map(one => [one.id, one]))
  const byId = new Map(scene.agents.map(agent => [agent.id, agent]))
  // Gone once the pipe has taken it.
  const present = scene.agents.filter(agent => {
    const phase = phaseOf(agent, scenes)

    return phase.kind !== 'leave' || phase.step < FAREWELL_TICKS
  })
  const exits = new Map<string, Slot>()
  for (const agent of present) {
    if (phaseOf(agent, scenes).kind !== 'leave') continue
    const origin = previous?.exits.get(agent.id)
    const old = before.get(agent.id)
    if (origin !== undefined) exits.set(agent.id, { ...origin, d: Math.min(origin.d, depth - 1) })
    else if (old !== undefined && old.kind !== 'strip') exits.set(agent.id, { kind: old.kind, x: clampTo(old.drawnX, 0, columns - old.width), d: Math.min(old.d, depth - 1), width: old.width, body: old.body })
  }
  const occupied = (previous?.placements ?? []).filter(one => one.kind !== 'strip').map(one => ({ id: one.id, x: one.drawnX, d: Math.min(one.d, depth - 1), width: one.width }))
  const laid = fieldLayout({ ...scene, agents: present }, columns, depth, previous?.slots, occupied, exits)
  if (laid === undefined) return undefined

  const placements: Placement[] = []
  for (const unit of laid.units) {
    if (unit.kind === 'main') {
      const slot = laid.slots.get('main') as Slot
      placements.push({ id: 'main', kind: 'main', x: slot.x, slotD: slot.d, drawnX: slot.x, d: slot.d, width: SLOT, body: BOX })
      continue
    }
    if (unit.kind === 'strip') {
      const slot = laid.slots.get('strip') as Slot
      placements.push({ id: 'strip', kind: 'strip', x: slot.x, slotD: slot.d, drawnX: slot.x, d: slot.d, width: slot.width, body: slot.width, text: stripText(unit), dots: dottedOf(unit).map(agent => agent.id) })
      continue
    }
    const slot = laid.slots.get(unit.agent.id)
    if (slot === undefined) continue
    const phase = phaseOf(unit.agent, scenes)
    if (phase.kind === 'leave' && !exits.has(unit.agent.id)) exits.set(unit.agent.id, slot)
    placements.push({ id: unit.agent.id, kind: slot.kind, x: slot.x, slotD: slot.d, drawnX: slot.x, d: slot.d, width: slot.width, body: slot.body, phase })
  }
  const placed = new Map(placements.map(one => [one.id, one]))
  // Held or thrown by the person: out of the choreography until it is set down.
  const settled = placements.filter(one => !held.has(one.id) && (one.kind === 'main' || (one.phase !== undefined && SETTLED.has(one.phase.kind))))
  // Arriving or leaving by the pipe: standing obstacles, never moved.
  const fixedOnes = placements.filter(one => !held.has(one.id) && one.kind !== 'main' && one.kind !== 'strip' && one.phase !== undefined && !SETTLED.has(one.phase.kind))
  const homing = new Set([...(previous?.homing ?? [])].filter(id => placed.has(id) && !held.has(id)))
  const isChild = (one: Placement): boolean => {
    const parent = byId.get(one.id)?.parentId
    return parent !== undefined && placed.has(parent)
  }
  const rangeOf = (one: Placement): [number, number] => depthsFor(one.kind, depth, laid.minis, isChild(one))

  // Who may wander: the session's mascot while awake, an agent thinking away from its laptop; never one idle.
  const isFree = (one: Placement): boolean => {
    if (!wander) return false
    if (one.kind === 'main') return scene.main.mood !== 'idle' && scene.main.stretchMs === undefined && scene.main.tidyMs === undefined
    const agent = byId.get(one.id)

    return one.phase?.kind === 'work' && agent?.status === 'running' && agent.activity === 'thinking' && agent.idleMs === undefined
  }

  const pos = new Map<string, { x: number; d: number }>()
  const memo = new Map<string, Memo>()
  for (const one of settled) {
    const old = before.get(one.id)
    const kept = old?.kind === one.kind && old.width === one.width ? previous?.memo.get(one.id) : undefined
    const [dLo, dHi] = rangeOf(one)
    const at = kept !== undefined ? { x: kept.x, d: clampTo(kept.d ?? one.slotD, dLo, dHi) } : { x: one.x, d: one.slotD }
    pos.set(one.id, at)
    if (kept !== undefined) memo.set(one.id, { ...kept, d: at.d })
  }
  const posOf = (one: Placement): { x: number; d: number } => pos.get(one.id) ?? { x: one.drawnX, d: one.d }
  // Reflow can widen a mini or clamp two depths into one. Drop stale ground
  // positions until the remaining memos clear both neighbours and new slots.
  let reset = true
  while (reset) {
    reset = false
    for (const one of settled) {
      const kept = memo.get(one.id)
      if (kept === undefined || (kept.lift ?? 0) > 0) continue
      const at = posOf(one)
      const neighbours = placements.filter(other => other.id !== one.id && !held.has(other.id) && (memo.get(other.id)?.lift ?? 0) === 0).map(other => ({ ...posOf(other), width: other.width }))
      if (at.x >= 0 && at.x + one.width <= columns && clearOf(neighbours, { ...at, width: one.width })) continue
      pos.set(one.id, { x: one.x, d: one.slotD })
      memo.delete(one.id)
      reset = true
    }
  }

  // Beside another mascot at its depth, on the side the mover comes from.
  const knocked = (id: string | undefined, at: number): boolean => id !== undefined && isKnocked(memo.get(id), at)
  const beside = (target: Placement | undefined, mover: Placement): { x: number; d: number } | undefined => {
    if (target === undefined || target.kind === 'strip' || held.has(target.id)) return undefined
    // A mascot knocked over is no one's errand until it is up again.
    if (knocked(target.id, tick)) return undefined
    // A newcomer is met where it lands; a settled one where it stands.
    const there = target.phase !== undefined && !SETTLED.has(target.phase.kind) ? { x: target.drawnX, d: target.d } : posOf(target)
    const left = there.x - mover.width - GAP
    const right = there.x + target.width + GAP
    const x = posOf(mover).x <= there.x ? (left >= 0 ? left : right) : (right <= columns - mover.width ? right : left)

    return { x, d: clampTo(there.d, ...rangeOf(mover)) }
  }
  const spawnerOf = (agent: MascotAgent): Placement | undefined => (agent.spawner === undefined ? undefined : placed.get(agent.spawner))

  // A scene's errand for a mover this frame: where it walks to, if anywhere.
  const goalOf = (one: Placement): { x: number; d: number } | undefined => {
    if (!scenes) return undefined
    for (const other of placements) {
      const agent = byId.get(other.id)
      if (agent === undefined || other.phase === undefined || agent.spawner !== one.id) continue
      if (other.phase.kind === 'arrive' || other.phase.kind === 'take') return beside(other, one)
    }
    const agent = byId.get(one.id)
    if (agent === undefined || one.phase === undefined) return undefined
    if (one.phase.kind === 'deliver' || one.phase.kind === 'hand') return beside(spawnerOf(agent), one)
    const worked = workTicks(agent, scenes)
    if (agent.link !== undefined && one.phase.kind === 'work' && worked !== undefined && worked >= 0) {
      const target = placed.get(agent.link.target)
      if (agent.link.kind === 'review' && worked < REVIEW_WALK_TICKS + REVIEW_STAND_TICKS) return beside(target, one)
      if (agent.link.kind === 'fix') return beside(target, one)
    }

    return undefined
  }
  // Done or failed: it stays where it is until the pipe takes it.
  const finishing = (one: Placement): boolean => one.phase !== undefined && FINISHING.has(one.phase.kind)
  // Set down away from its place: one that does not wander walks back to its slot, errands first.
  const errandOf = (one: Placement): { x: number; d: number } | undefined => goalOf(one) ?? (homing.has(one.id) && !isFree(one) ? { x: one.x, d: one.slotD } : undefined)

  // The smooth scene asks a flight of a mover where the sky over its floor
  // has room: a fetch while it runs, an Explore or researcher agent at work,
  // a reading streak of five seconds; the session after a compaction and on
  // its way to a newcomer far across the field; an errand over a crowd.
  const askOf = (one: Placement, goal: { x: number; d: number } | undefined, others: readonly Placement[]): Mover['ask'] => {
    const at = posOf(one)
    if (!smooth || headroom + at.d < FLY_SKY || one.kind === 'mini' || knocked(one.id, tick)) return undefined
    if (one.kind === 'main') {
      if (scene.main.stretchMs !== undefined) return { reason: 'compaction' }
      if (goal !== undefined && Math.abs(goal.x - at.x) > FAR_CELLS) return { reason: 'errand' }
    } else {
      const agent = byId.get(one.id)
      if (agent !== undefined && one.phase?.kind === 'work' && agent.status === 'running' && agent.activity !== 'asking' && agent.idleMs === undefined && goal === undefined) {
        const home = { home: one.x, homeD: one.slotD }
        if (agent.activity === 'fetching') return { reason: 'fetch', ...home }
        if (agent.role === 'explorer') return { reason: 'scan', ...home }
        if ((agent.readingMs ?? 0) >= READING_STREAK_MS) return { reason: 'read', ...home }
      }
    }
    if (goal === undefined || (goal.x === at.x && goal.d === at.d)) return undefined
    // Standing in the way: on the ground across its path, within a row of the depths it crosses.
    const from = Math.min(at.x, goal.x)
    const to = Math.max(at.x, goal.x) + one.width
    const near = (d: number): boolean => d >= Math.min(at.d, goal.d) - 1 && d <= Math.max(at.d, goal.d) + 1
    const between = others.filter(other => other.id !== one.id && (memo.get(other.id)?.lift ?? 0) < AIRBORNE && near(posOf(other).d) && posOf(other).x + other.width > from && posOf(other).x < to)

    return between.length >= CROWD_OBSTACLES ? { reason: 'errand' } : undefined
  }

  const motions = new Map<string, Motion>()
  const lifts = new Map<string, number>()
  const facings = new Map<string, 'left' | 'right'>()
  const contacts = new Map<string, number>()
  for (const [pair, at] of previous?.contacts ?? []) if ((tick - at) * SCENE_FRAME_MS < 30_000) contacts.set(pair, at)
  const steps = previous === undefined ? 0 : Math.min(tick - previous.tick, CATCH_UP)
  if (steps === 0) {
    for (const one of settled) {
      const old = before.get(one.id)
      if (old?.motion !== undefined && previous?.tick === tick) motions.set(one.id, old.motion)
      if (old?.lift !== undefined && previous?.tick === tick) lifts.set(one.id, old.lift)
      if (old?.facing !== undefined) facings.set(one.id, old.facing)
    }
  }
  for (let frame = steps - 1; frame >= 0; frame -= 1) {
    const now = tick - frame
    motions.clear()
    lifts.clear()
    const movers: Mover[] = [
      ...settled.map((one): Mover => {
        const goal = errandOf(one)
        const ask = askOf(one, goal, settled)
        const at = posOf(one)
        const [dLo, dHi] = rangeOf(one)

        return {
          id: one.id,
          width: one.width,
          body: one.body,
          x: at.x,
          d: at.d,
          lo: 0,
          hi: columns - one.width,
          dLo,
          dHi,
          free: isFree(one),
          ...(goal !== undefined ? { goal: goal.x, goalD: goal.d } : wander || finishing(one) ? {} : { goal: one.x, goalD: one.slotD }),
          // The smooth scene's flights take the sky with wandering off too.
          sky: wander || smooth ? headroom + at.d : 0,
          ...(memo.has(one.id) ? { memo: memo.get(one.id) } : {}),
          ...(ask === undefined ? {} : { ask }),
        }
      }),
      ...fixedOnes.map((one): Mover => ({ id: one.id, width: one.width, body: one.body, x: one.drawnX, d: one.d, lo: 0, hi: columns - one.width, free: false, sky: 0, fixed: true })),
    ]
    const touched: string[] = []
    const results = stepField(movers, now, { collisions, lastContact: contacts, ...(smooth ? { smooth } : {}) }, touched)
    for (const pair of touched) contacts.set(pair, now)
    for (const one of settled) {
      const result = results.get(one.id)
      if (result === undefined) continue
      const from = pos.get(one.id)?.x ?? result.x
      if (result.x !== from) facings.set(one.id, result.x < from ? 'left' : 'right')
      pos.set(one.id, { x: result.x, d: result.d })
      memo.set(one.id, { ...result.memo, x: result.x, d: result.d })
      if (result.motion !== undefined) motions.set(one.id, result.motion)
      if (result.lift > 0) lifts.set(one.id, result.lift)
    }
  }

  for (const one of settled) {
    const at = posOf(one)
    one.drawnX = at.x
    one.d = at.d
    const motion = motions.get(one.id)
    if (motion !== undefined) one.motion = motion
    const lift = lifts.get(one.id)
    if (lift !== undefined) one.lift = lift
    const facing = facings.get(one.id)
    if (facing !== undefined) one.facing = facing
    const fly = memo.get(one.id)?.fly
    if (fly?.reason !== undefined && motion?.kind === 'fly') one.flight = fly.reason
    if (fly?.loop !== undefined && motion?.kind === 'fly') one.loop = fly.loop
    // Home again: it stops walking back.
    if (homing.has(one.id) && (isFree(one) || (one.drawnX === one.x && one.d === one.slotD))) homing.delete(one.id)
  }

  // Scene gestures and marks at this frame.
  const marks: Mark[] = []
  const cue = (id: string | undefined, gesture: Cue): void => {
    const one = id === undefined ? undefined : placed.get(id)
    // One in the person's hand plays no part in a scene.
    if (one === undefined || one.kind === 'strip' || held.has(one.id)) return
    one.cues = [...(one.cues ?? []), gesture]
  }
  const centre = (one: Placement): number => one.drawnX + Math.floor(one.body / 2)
  if (scenes) {
    for (const one of placements) {
      const agent = byId.get(one.id)
      if (agent === undefined || one.phase === undefined || held.has(one.id)) continue
      if (one.phase.kind === 'take' && one.phase.step === 0 && !knocked(agent.spawner, tick)) cue(agent.spawner, 'give-scroll')
      if (one.phase.kind === 'hand' && one.phase.step === 1) {
        cue(agent.spawner, 'take-report')
        cue(agent.spawner, 'nod')
      }
      if (one.phase.kind === 'baton' && one.phase.step === 1) cue(agent.squadNext, 'take-baton')
      // A child dropping out of the pipe: its parent points at it.
      if (one.phase.kind === 'arrive' && one.phase.step >= arriveTicksOf(agent) - 2 && agent.parentId !== undefined) cue(agent.parentId, 'point')
      const target = agent.link === undefined || held.has(agent.link.target) ? undefined : placed.get(agent.link.target)
      if (agent.link?.kind === 'review' && one.phase.kind === 'pack' && agent.status === 'done' && target !== undefined && target.kind !== 'strip') {
        // The stamp goes over the desk it reviewed: above the laptop's lid.
        const x = target.kind === 'full' ? target.drawnX + LAPTOP_X + 3 : centre(target)
        marks.push({ x, row: target.d, ch: '✓', ink: 'g', colour: agent.colour })
      }
      const worked = workTicks(agent, scenes)
      if (agent.link?.kind === 'fix' && one.phase.kind === 'work' && worked !== undefined && worked >= 0 && tick % SPARK_EVERY < 2
        && target !== undefined && target.d === one.d && target.kind !== 'strip') {
        const between = one.drawnX < target.drawnX ? one.drawnX + one.width : one.drawnX - 1
        marks.push({ x: between, row: one.d + 1, ch: '✦', ink: 'y', colour: agent.colour })
      }
    }
    for (const event of scene.events ?? []) {
      const from = placed.get(event.from)
      const to = placed.get(event.to)
      if (from === undefined || to === undefined || from.kind === 'strip' || to.kind === 'strip' || held.has(from.id) || held.has(to.id)) continue
      // From the sender's air row to the receiver's, a cell (or a row of depth) a frame.
      const start = centre(from)
      const end = centre(to)
      const elapsed = tick - event.tick
      const distance = Math.max(Math.abs(end - start), Math.abs(to.d - from.d))
      if (elapsed < 0) continue
      if (elapsed < distance) {
        const x = start + Math.sign(end - start) * Math.min(elapsed, Math.abs(end - start))
        marks.push({ x, row: from.d + Math.round(((to.d - from.d) * elapsed) / distance), ch: '○', ink: 'a', colour: ACCENT })
      } else if (elapsed === distance) cue(to.id, 'glance')
    }
  }

  return {
    depth,
    placements,
    collapsed: laid.collapsed.map(agent => agent.id),
    tick,
    columns,
    slots: laid.slots,
    minis: laid.minis,
    exits,
    memo,
    headroom,
    marks: marks.filter(mark => mark.x >= 0 && mark.x < columns),
    wander,
    scenes,
    collisions,
    contacts,
    ...(smooth ? { smooth, homing } : {}),
  }
}
