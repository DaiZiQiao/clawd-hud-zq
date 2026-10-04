import { bobOf, drawLook, drawMini, wearOfAgent, wearOfMain } from './mascot-glyphs'
import { agentLook, mainLook, miniLook } from './mascot-poses'
import type { LookContext } from './mascot-poses'
import { BOX_ROWS, SKY } from './mascot-sprites'
import { GAP } from './motion-rules'
import { ACCENT, isNumber } from './scene-model'
import { SCENE_FRAME_MS, holdTicks, soloPipe } from './scene-phases'
import { PIPE_SLIDE_MS, PIPE_WIDTH, PIPE_X, batchPipeAt, droppedAt, farewellAt } from './scene-pipe'
import { SETTLED, mascotPlan } from './scene-plan'
import type { Cell, Mark, MascotAgent, MascotLayout, MascotPlan, MascotScene, Phase, PlacedPipe, PlacedSprite, Placement, SceneView } from './scene-types'

// The plan's frame as placed sprites, renderer-agnostic: each mascot's look
// drawn into cells (hooks/mascot-poses.ts, hooks/mascot-glyphs.ts) where it
// stands, the pipes over those arriving and leaving, and the scenes' marks.

// --- the pipe ----------------------------------------------------------------

/**
 * A mascot in the pipe's scene at the scene's own time: hidden inside it; or
 * out of it, where it is (its column and depth, to the fraction, falling out
 * from under the batch's pipe to its slot), its lift, and the lip's row
 * above which it is still inside (the stage for its look).
 */
type Piped = { stage: 'inside' | 'fall' | 'lower' | 'suck'; x: number; d: number; lift: number; lip?: number }

const pipeKind = (kind: Placement['kind']): 'full' | 'mini' => (kind === 'mini' ? 'mini' : 'full')

/** The middle of a pipe over a mascot of `kind`, from its left column: over its body's middle. */
const pipeMiddle = (kind: Placement['kind']): number => PIPE_X[pipeKind(kind)] + PIPE_WIDTH[pipeKind(kind)] / 2

/** The column a mascot of `kind` stands at, its body under the middle of the pipe over a mascot of `under` at `x`. */
const underPipe = (x: number, under: Placement['kind'], kind: Placement['kind']): number => x + pipeMiddle(under) - pipeMiddle(kind)

/** Over whose slot each batch's pipe hangs: its first's, or (that one folded into the strip) the first of it still placed. */
const anchorsOf = (scene: MascotScene, placed: ReadonlyMap<string, Placement>): Map<string, Placement> => {
  const anchors = new Map<string, Placement>()
  for (const agent of scene.agents) {
    const share = agent.pipe ?? soloPipe(agent.id)
    const one = placed.get(share.anchor) ?? placed.get(agent.id)
    if (one !== undefined && one.kind !== 'strip' && one.kind !== 'main' && !anchors.has(share.anchor)) anchors.set(share.anchor, one)
  }

  return anchors
}

/** Where an arriving or leaving mascot is in its pipe's scene, by the scene's time (its age, or how long since it ended). */
const pipedOf = (one: Placement, agent: MascotAgent, plan: MascotPlan, anchors: ReadonlyMap<string, Placement>): Piped | undefined => {
  if (one.phase?.kind === 'arrive') {
    const share = agent.pipe ?? soloPipe(agent.id)
    const anchor = anchors.get(share.anchor) ?? one
    const sky = plan.headroom + anchor.slotD
    const t = (agent.ageMs ?? 0) + share.after
    const fall = droppedAt(t - share.drop, sky)
    const mouth = batchPipeAt(t, sky, share.up)
    if (fall.inside) return { stage: 'inside', x: one.x, d: one.slotD, lift: 0 }
    const from = anchor === one ? one.x : underPipe(anchor.x, anchor.kind, one.kind)
    const u = fall.u

    return { stage: 'fall', x: from + (one.x - from) * u, d: anchor.slotD + (one.slotD - anchor.slotD) * u, lift: fall.lift, ...(mouth === undefined ? {} : { lip: anchor.slotD - mouth }) }
  }
  if (one.phase?.kind === 'leave') {
    const ms = agent.endedMs === undefined ? one.phase.step * SCENE_FRAME_MS : agent.endedMs - holdTicks(agent, plan.scenes) * SCENE_FRAME_MS
    const sky = plan.headroom + one.d
    const frame = farewellAt(ms, sky)
    const stage = frame.inside ? 'inside' : ms < PIPE_SLIDE_MS ? 'lower' : 'suck'

    return { stage, x: one.drawnX, d: one.d, lift: stage === 'suck' ? frame.lift : 0, ...(frame.mouth === undefined ? {} : { lip: one.d - frame.mouth }) }
  }

  return undefined
}

/**
 * The pipes this frame: one over each batch of newcomers (its first's slot,
 * the first of them still placed), from when it comes down until it is back
 * up; one over each mascot the pipe takes, while it is in sight.
 */
const pipesOf = (scene: MascotScene, plan: MascotPlan): PlacedPipe[] => {
  const placed = new Map(plan.placements.map(one => [one.id, one]))
  const anchors = anchorsOf(scene, placed)
  const pipes: PlacedPipe[] = []
  const batches = new Map<string, MascotAgent[]>()
  for (const agent of scene.agents) {
    if (agent.ageMs === undefined) continue
    const share = agent.pipe ?? soloPipe(agent.id)
    if (agent.ageMs + share.after >= share.up + PIPE_SLIDE_MS) continue
    batches.set(share.anchor, [...(batches.get(share.anchor) ?? []), agent])
  }
  for (const [anchorId, members] of batches) {
    const anchor = anchors.get(anchorId)
    const first = members[0]
    if (anchor === undefined || first === undefined) continue
    const share = first.pipe ?? soloPipe(first.id)
    const mouth = batchPipeAt((first.ageMs ?? 0) + share.after, plan.headroom + anchor.slotD, share.up)
    if (mouth !== undefined) pipes.push({ x: anchor.x + PIPE_X[pipeKind(anchor.kind)], kind: pipeKind(anchor.kind), lip: anchor.slotD - mouth })
  }
  for (const one of plan.placements) {
    const agent = scene.agents.find(other => other.id === one.id)
    if (agent === undefined || one.phase?.kind !== 'leave' || one.kind === 'strip' || one.kind === 'main') continue
    const piped = pipedOf(one, agent, plan, anchors)
    if (piped?.lip !== undefined) pipes.push({ x: one.drawnX + PIPE_X[pipeKind(one.kind)], kind: pipeKind(one.kind), lip: piped.lip })
  }

  return pipes
}

// --- placed sprites: what any renderer draws ------------------------------------

/** A row to the cell as the text canvas rounds it (a half down): a lift a half up. Never -0. */
export const rowOf = (exact: number): number => Math.ceil(exact - 0.5) + 0

/**
 * Every sprite, pipe and mark of the plan at its tick, sprites in drawing
 * order (back to front, those in the person's hand last); undefined when
 * nothing fits. `view` lays the smooth scene's in-between frame over it.
 */
export const placedSprites = (scene: MascotScene, layout: MascotLayout, plan = mascotPlan(scene, layout), view?: SceneView): { sprites: PlacedSprite[]; pipes: PlacedPipe[]; marks: Mark[]; depth: number; headroom: number } | undefined => {
  if (plan === undefined) return undefined
  const tick = Math.floor(isNumber(layout.tick) ? layout.tick : 0)
  const byId = new Map(scene.agents.map(agent => [agent.id, agent]))
  const anchors = anchorsOf(scene, new Map(plan.placements.map(one => [one.id, one])))
  const marks = [...plan.marks]

  // Without the scenes, a parent points at the child standing right beside it at its depth, both in their slots.
  const pointing = new Set<string>()
  if (!plan.scenes) {
    for (const one of plan.placements) {
      if (one.kind !== 'full' && one.kind !== 'main') continue
      const next = plan.placements.find(other => other.kind === 'mini' && byId.get(other.id)?.parentId === one.id && other.d === one.d && other.drawnX === one.drawnX + one.width + GAP)
      // Both standing in their slots: neither arriving nor leaving by the pipe.
      const standing = (placement: Placement): boolean => placement.phase === undefined || SETTLED.has(placement.phase.kind)
      if (next === undefined || !standing(one) || !standing(next) || one.drawnX !== one.x || one.d !== one.slotD || next.drawnX !== next.x || next.d !== next.slotD) continue
      pointing.add(one.id)
      const agent = byId.get(one.id)
      const gap = one.x + one.width
      if (agent !== undefined && gap < plan.columns) marks.push({ x: gap, row: one.d + 2, ch: '▸', ink: 'b', colour: agent.colour })
    }
  }

  const sprites: PlacedSprite[] = []
  for (const placement of plan.placements) {
    const seen = view?.get(placement.id)
    if (seen?.hidden === true) continue
    const one: Placement = seen === undefined ? placement : {
      ...placement,
      drawnX: seen.x === undefined ? placement.drawnX : Math.round(seen.x),
      ...(seen.motion === undefined ? {} : { motion: seen.motion }),
      ...(seen.facing === undefined ? {} : { facing: seen.facing }),
    }
    if (one.kind === 'strip') {
      // `● ◌ ✓ ×12` on the body row: each dot in its agent's colour, the count dim.
      const row: (Cell | undefined)[] = []
      const dots = one.dots ?? []
      ;[...(one.text ?? '')].forEach((glyph, index) => {
        const agent = index % 2 === 0 ? byId.get(dots[index / 2] ?? '') : undefined
        row.push(glyph === ' ' ? undefined : agent === undefined ? { ch: glyph, ink: 'd', colour: ACCENT } : { ch: glyph, ink: 'b', colour: agent.colour })
      })
      const cells = [[], [], row, []] as (Cell | undefined)[][]
      sprites.push({ id: one.id, kind: 'strip', d: one.d, x: one.x, top: one.d, cells, moving: false })
      continue
    }
    const agent = one.kind === 'main' ? undefined : byId.get(one.id)
    if (one.kind !== 'main' && (agent === undefined || one.phase === undefined)) continue
    // In the pipe's scene: by the scene's own time, over any view.
    const piped = agent === undefined ? undefined : pipedOf(one, agent, plan, anchors)
    if (piped?.stage === 'inside') continue
    const context: LookContext = {
      pointing: pointing.has(one.id),
      ...(one.facing === undefined ? {} : { facing: one.facing }),
      ...(one.motion === undefined || piped !== undefined ? {} : { motion: one.motion }),
      ...(one.cues === undefined ? {} : { cues: one.cues }),
      ...(seen?.pose === undefined ? {} : { pose: seen.pose }),
      ...(seen?.kick === undefined ? {} : { kick: seen.kick }),
      ...(seen?.nudge === undefined ? {} : { nudge: seen.nudge }),
      ...(seen?.scanning === true ? { scanning: true } : {}),
      ...(piped === undefined ? {} : { pipe: piped.stage }),
    }
    const free = seen?.pose !== undefined
    // Its lift and place, to the fraction: the pipe's, the view's, or the plan's.
    const liftExact = piped !== undefined ? piped.lift : seen?.lift
    const xExact = piped !== undefined ? piped.x : seen?.x
    const dExact = piped !== undefined ? piped.d : seen?.d ?? one.d
    const drawnX = xExact === undefined ? one.drawnX : Math.round(xExact)
    const lifted = <T extends { lift: number },>(look: T): T => (liftExact === undefined ? look : { ...look, lift: Math.max(0, Math.round(liftExact)) })
    const posed: Pick<PlacedSprite, 'pose'> = seen?.pose === undefined ? {} : { pose: seen.pose }
    const leaping = one.motion?.kind === 'hop' || one.motion?.kind === 'fly'
    const moving = (one.phase !== undefined && !SETTLED.has(one.phase.kind)) || one.motion !== undefined || free
    // The rows free above its box: the sky over its own floor.
    const sky = plan.headroom + Math.round(dExact)
    // The smooth scene's Explore or researcher agent at work: scanning, in flight or on foot.
    if (agent !== undefined && plan.smooth && one.phase?.kind === 'work' && agent.role === 'explorer' && agent.status === 'running' && agent.activity !== 'asking' && agent.idleMs === undefined) context.scanning = true
    let cells: (Cell | undefined)[][]
    let lift: number
    let bob = 0
    if (one.kind === 'main') {
      const look = lifted(mainLook(scene.main, tick, context))
      bob = bobOf(look, sky)
      cells = drawLook(look, wearOfMain(scene.main), ACCENT, sky - look.lift - bob)
      lift = look.lift
    } else if (one.kind === 'mini') {
      const look = lifted(miniLook(agent as MascotAgent, one.phase as Phase, tick, context))
      cells = drawMini(look, agent as MascotAgent, (agent as MascotAgent).colour)
      lift = look.lift
    } else {
      const self = agent as MascotAgent
      const look = lifted(agentLook(self, one.phase as Phase, tick, context))
      bob = bobOf(look, sky)
      cells = drawLook(look, wearOfAgent(self), self.colour, sky - look.lift - bob)
      lift = look.lift
    }
    const topExact = dExact - (liftExact ?? lift) - bob - SKY
    const top = rowOf(topExact)
    const exact = seen !== undefined && (seen.x !== undefined || seen.lift !== undefined || seen.d !== undefined) || piped !== undefined ? { exact: { x: xExact ?? one.drawnX, top: topExact } } : {}
    // A pick under the body's centre on the legs row, for an agent standing on its floor: never mid-air, arriving or leaving, never on its laptop.
    const middle = drawnX + Math.floor(one.body / 2)
    const pickable = one.kind !== 'main' && one.phase !== undefined && SETTLED.has(one.phase.kind) && lift === 0 && !leaping && middle >= 0 && middle < plan.columns
    sprites.push({
      id: one.id,
      kind: one.kind,
      d: dExact,
      x: drawnX,
      top,
      cells,
      moving: moving || drawnX !== one.x || one.d !== one.slotD,
      ...(pickable ? { pick: { x: middle, row: Math.round(dExact) + BOX_ROWS - 1 } } : {}),
      ...(free ? { free } : {}),
      ...exact,
      ...posed,
      ...(piped?.lip === undefined ? {} : { clip: rowOf(piped.lip) }),
    })
  }

  // Back to front: by depth, the settled before those on the move at a depth, then by column; any in the person's hand last.
  const order = sprites
    .map((one, index) => ({ one, index }))
    .sort((a, b) => Number(a.one.free === true) - Number(b.one.free === true) || a.one.d - b.one.d || Number(a.one.moving) - Number(b.one.moving) || a.one.x - b.one.x || a.index - b.index)
    .map(({ one }) => one)

  return { sprites: order, pipes: pipesOf(scene, plan), marks, depth: plan.depth, headroom: plan.headroom }
}
