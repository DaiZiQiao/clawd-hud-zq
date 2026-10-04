import { NOW, working } from './scene-model.fixtures'
import { SCENE_FRAME_MS } from './scene-phases'
import { mascotPlan } from './scene-plan'
import { mascotLines } from './scene-render'
import type { MascotLayout, MascotPlan, MascotScene } from './scene-types'

// The choreography for the tests: plans threaded frame to frame, and the scenes they move.

export const T0 = Math.floor(NOW / SCENE_FRAME_MS)

/** A frame's rows from the back row's box top (its air row) down to the front floor: past the sky rows drawn above it. */
export const lineRows = (frame: readonly string[], plan: MascotPlan): readonly string[] => frame.slice(frame.length - (plan.depth + 3))
export const room = (columns: number, rows: number, tick: number, extra: Partial<MascotLayout> = {}): MascotLayout => ({ columns, rows, tick, ...extra })

/** Plans for `frames` consecutive ticks, each threaded from the one before. */
export const run = (sceneAt: (tick: number) => MascotScene, layoutAt: (tick: number) => MascotLayout, frames: number): { plans: MascotPlan[]; lines: string[][] } => {
  const plans: MascotPlan[] = []
  const lines: string[][] = []
  let previous: MascotPlan | undefined
  for (let frame = 0; frame < frames; frame += 1) {
    const scene = sceneAt(frame)
    const layout = layoutAt(frame)
    const plan = mascotPlan(scene, layout, previous)
    if (plan === undefined) throw new Error(`no plan at ${frame}`)
    plans.push(plan)
    lines.push(mascotLines(scene, layout, plan) ?? [])
    previous = plan
  }

  return { plans, lines }
}

/** A plan whose slots stand where `at` says (columns, in a field a row deep): its next frames keep them. */
export const slotted = (scene: MascotScene, layout: MascotLayout, at: Record<string, number>): MascotPlan => {
  const first = mascotPlan(scene, layout)!
  const slots = new Map(first.slots)
  for (const [id, x] of Object.entries(at)) slots.set(id, { ...slots.get(id)!, x, d: 0 })
  const placements = first.placements.map(one => (at[one.id] === undefined ? one : { ...one, x: at[one.id]!, drawnX: at[one.id]!, d: 0, slotD: 0 }))

  return { ...first, slots, placements }
}

/** The session awake, watching three agents between tools. */
export const wanderers: MascotScene = {
  main: { mood: 'watching', sweating: false },
  agents: ['w1', 'w2', 'w3'].map(id => working(id, 'thinking', { colour: '#3681D1' })),
}
