import { describe, expect, test } from 'claude-code/testing'

import { SHADOW_IDLE_MS, shadowCallEnded, shadowCallStarted, shadowsPruned, shownShadows } from './agent-shadows'
import { HEADS, MINI_HEADS, MINI_LEGS } from './mascot-sprites'
import { sceneCanvas } from './scene-canvas'
import { NOW, busy, entry, oneAgent, working } from './scene-model.fixtures'
import { LINK_WINDOW_MS, SCENE_FRAME_MS } from './scene-phases'
import { PIPE_COLOUR, PIPE_SHINE, PIPE_WIDTH } from './scene-pipe'
import { placedSprites } from './scene-placement'
import { mascotPlan } from './scene-plan'
import { canvasLines } from './scene-render'
import { layerSvg, sceneSvg } from './scene-svg'
import { svgRects, svgRows } from './scene-svg.fixtures'
import type { MascotLayout, MascotPlan, MascotScene } from './scene-types'
import { tallInputs } from './scene-world.fixtures'

// The plan's frame placed: the Client's props, scanning explorers, marks
// clear of every sprite, the pipes in the room, leaps from their own floor.

describe('props and paint regressions', () => {
  test('finished actors older than the link/farewell horizon stay out of Client props', () => {
    const recent = entry('recent', { status: 'done', endedAt: NOW - LINK_WINDOW_MS + 1 })
    const stale = Array.from({ length: 80 }, (_, i) => entry(`old${i}`, { status: 'done', endedAt: NOW - LINK_WINDOW_MS - 1 }))
    const props = tallInputs([entry('live'), recent, ...stale])
    expect(props.agents.map(one => one.id)).toEqual(['live', 'recent'])
    expect(JSON.stringify(props).length).toBeLessThan(2000)
  })

  test('explorers scan on foot without a laptop in low sky, lower lines and minis', () => {
    for (const [columns, rows, count] of [[72, 4, 1], [40, 12, 4], [40, 4, 5]]) {
      const scene: MascotScene = { main: { mood: 'watching', sweating: false }, agents: Array.from({ length: count! }, (_, i) => working(`e${i}`, 'reading', { role: 'explorer' })) }
      const room = { columns: columns!, rows: rows!, tick: 1000, motion: 'smooth' as const }
      const sprites = placedSprites(scene, room)!
      for (const sprite of sprites.sprites.filter(one => one.kind !== 'main' && one.kind !== 'strip')) {
        const text = sprite.cells.map(row => row.map(cell => cell?.ch ?? ' ').join('')).join('\n')
        expect(text).not.toMatch(/▗▄▄▄▖|▐▒▒▒▌|▀▀▀▀▀▀/)
      }
      const full = sprites.sprites.find(one => one.kind === 'full')
      if (full) expect(full.cells.flat().map(cell => cell?.ch ?? ' ').join('')).toContain(HEADS.down.trim())
    }
  })

  test('mini explorers really use the scanning-on-foot look', () => {
    const scene: MascotScene = { main: { mood: 'watching', sweating: false }, agents: [working('parent', 'typing'), working('mini', 'reading', { role: 'explorer', parentId: 'parent' })] }
    const sprites = placedSprites(scene, { columns: 72, rows: 4, tick: 1000, motion: 'smooth' })!
    const mini = sprites.sprites.find(one => one.id === 'mini')!
    expect(mini.kind).toBe('mini')
    const text = mini.cells.map(row => row.map(cell => cell?.ch ?? ' ').join('')).join('\n')
    expect(text).not.toContain('▐▒▒▒▌')
    expect(text).toContain(MINI_HEADS.right)
    expect(text).toContain(MINI_LEGS.stand)
  })

  test('held targets and senders suppress stamps, sparks and message bubbles', () => {
    // A field a row deep: the debugger beside the desk it fixes from the first frame.
    const room = { columns: 100, rows: 8, tick: 1000, scenes: true, motion: 'smooth' as const }
    for (const kind of ['review', 'fix', 'message'] as const) {
      const scene: MascotScene = {
        main: { mood: 'watching', sweating: false },
        agents: [working('target', 'typing'), working('source', 'thinking', { role: kind === 'review' ? 'reviewer' : 'debugger', ...(kind === 'message' ? {} : { link: { kind, target: 'target' } }), ...(kind === 'review' ? { status: 'done', endedMs: 0 } : {}) })],
        ...(kind === 'message' ? { events: [{ kind: 'message', from: 'source', to: 'target', tick: 1000 }] } : {}),
      }
      expect(mascotPlan(scene, room)!.marks.length).toBeGreaterThan(0)
      for (const id of ['target', 'source']) expect(mascotPlan(scene, { ...room, held: [id] })!.marks).toEqual([])
    }
  })

  test('marks avoid all occupied sprite cells in the grid and SVG layers', () => {
    const scene: MascotScene = { main: { mood: 'watching', sweating: false }, agents: [] }
    const room = { columns: 40, rows: 12, tick: 1000, motion: 'smooth' as const }
    const plan = mascotPlan(scene, room)!
    const base = sceneCanvas(scene, room, plan)!
    const at = base.owners.flatMap((row, y) => row.map((id, x) => ({ id, x, y }))).find(one => one.id === 'main' && base.grid[one.y]![one.x]!.hat !== true)!
    const marked = sceneCanvas(scene, room, { ...plan, marks: [{ x: at.x, row: at.y - plan.headroom, ch: '○', ink: 'a', colour: '#123456' }] })!
    expect(marked.grid[at.y]![at.x]).toEqual(base.grid[at.y]![at.x])
    for (const layer of marked.layers.filter(one => one.id === undefined)) {
      if (layer.cells[0]?.[0]?.ch === '○') expect(base.grid[layer.y]?.[layer.x]).toBe(undefined)
    }
    expect(canvasLines(marked.grid).length).toBe(12)
  })

  test('an in-flight workflow call survives idle expiry, with a sixty-minute cap', () => {
    const record = shadowCallStarted({}, 'wf', 'Bash', NOW)
    expect(shownShadows(record, NOW + SHADOW_IDLE_MS + 1)).toHaveLength(1)
    expect(shadowsPruned(record, NOW + 59 * 60_000).wf).toBeDefined()
    expect(shadowsPruned(record, NOW + 60 * 60_000).wf).toBe(undefined)
    const ended = shadowCallEnded(record, 'wf', 'Bash', NOW + 12 * 60_000)
    expect(shadowsPruned(ended, NOW + 23 * 60_000).wf).toBe(undefined)
  })
})

// ---------------------------------------------------------------------------
// The field and the pipe, across the room.
// ---------------------------------------------------------------------------

describe('the field and the pipe', () => {
  /** Plans for `frames` consecutive ticks, each threaded from the one before. */
  const plans = (scene: (tick: number) => MascotScene, room: (tick: number) => MascotLayout, frames: number): MascotPlan[] => {
    const out: MascotPlan[] = []
    let previous: MascotPlan | undefined
    for (let tick = 0; tick < frames; tick += 1) {
      previous = mascotPlan(scene(tick), room(tick), previous)
      if (previous === undefined) throw new Error(`no plan at ${tick}`)
      out.push(previous)
    }

    return out
  }
  const T0 = Math.floor(NOW / SCENE_FRAME_MS)
  const wanderers: MascotScene = { main: { mood: 'watching', sweating: false }, agents: ['w1', 'w2', 'w3', 'w4'].map(id => working(id, 'thinking')) }
  test('a pipe never leaves the room: its cells inside the columns, from the top of the region down to its lip', { timeoutMs: 60_000 }, () => {
    for (let columns = 20; columns <= 130; columns += 3) {
      for (const rows of [4, 8, 12, 20, 40]) {
        for (const tick of [1, 2, 4, 5]) {
          const room = { columns, rows, tick: T0 + tick, scenes: true, motion: 'smooth' as const }
          const placed = placedSprites(busy(tick), room)
          if (placed === undefined) continue
          for (const pipe of placed.pipes) {
            expect(pipe.x, `${columns}x${rows}`).toBeGreaterThanOrEqual(0)
            expect(pipe.x + (pipe.kind === 'mini' ? PIPE_WIDTH.mini : PIPE_WIDTH.full), `${columns}x${rows}`).toBeLessThanOrEqual(columns)
          }
          const canvas = sceneCanvas(busy(tick), room, mascotPlan(busy(tick), room))!
          for (const layer of canvas.layers.filter(one => one.pipe === true)) {
            layer.cells.forEach(row => row.forEach((cell, dx) => {
              if (cell !== undefined) {
                expect(layer.x + dx).toBeGreaterThanOrEqual(0)
                expect(layer.x + dx).toBeLessThan(columns)
              }
            }))
            // From above the top (out of sight) down to the lip.
            expect(layer.y).toBeLessThan(0)
          }
        }
      }
    }
  })

  test('in pixels the pipe is red rects, its shine a lighter stripe; read back into cells, the text rows', () => {
    const scene = oneAgent(working('n', 'typing', { ageMs: 700 }))
    const room = { columns: 72, rows: 12, tick: T0, motion: 'smooth' as const }
    const canvas = sceneCanvas(scene, room, mascotPlan(scene, room))!
    const pipe = canvas.layers.find(layer => layer.pipe === true)!
    expect(pipe).toBeDefined()
    const drawn = layerSvg(pipe)
    expect(drawn).toContain(`fill='${PIPE_COLOUR}'`)
    expect(drawn).toContain(`fill='${PIPE_SHINE}'`)
    expect(drawn).not.toContain('<text')
    expect(svgRects(drawn).length).toBeGreaterThan(0)
    const svg = sceneSvg(canvas.layers, { columns: 72, rows: 12 }, 'a pipe')
    expect(svgRows(svg.source)).toEqual(canvasLines(canvas.grid).map(row => row.trimEnd()))
    expect(svgRows(svg.source).join('\n')).toContain('█████████')
  })

  test('hops and flights rise from the mascot\'s own floor: its box that many rows over its depth\'s floor', () => {
    let leaps = 0
    for (const motion of [undefined, 'smooth'] as const) {
      const room = (tick: number): MascotLayout => ({ columns: 112, rows: 20, tick: T0 + tick, wander: true, collisions: 'off', ...(motion === undefined ? {} : { motion }) })
      const all = plans(() => wanderers, room, 600)
      all.forEach((plan, tick) => {
        const placed = placedSprites(wanderers, room(tick), plan)!
        for (const one of plan.placements.filter(placement => placement.motion?.kind === 'hop' || placement.motion?.kind === 'fly')) {
          const sprite = placed.sprites.find(other => other.id === one.id)!
          // Its grid's first row (the sky row over its box) at its floor's box top, less its lift.
          expect(sprite.top, `${one.id} @${tick}`).toBe(one.d - (one.lift ?? 0) - 1)
          leaps += 1
        }
      })
    }
    expect(leaps).toBeGreaterThan(20)
  })
})
