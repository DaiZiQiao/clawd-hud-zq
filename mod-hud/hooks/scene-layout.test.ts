import { describe, expect, test } from 'claude-code/testing'

import { HEADS, SLOT } from './mascot-sprites'
import { sceneCanvas } from './scene-canvas'
import { fieldOf } from './scene-layout'
import { PALETTE, sceneOf } from './scene-model'
import { NOW, crowd, everything, idleHud, working } from './scene-model.fixtures'
import { SCENE_FRAME_MS } from './scene-phases'
import { placedSprites } from './scene-placement'
import { mascotPlan } from './scene-plan'
import { renderMascots } from './scene-render'
import { mascotLines } from './scene-render.fixtures'
import type { MascotLayout, MascotPlan, MascotScene } from './scene-types'
import { displayWidth } from './text-width'

// The field's layout: its depth and sky, everyone a cell apart within a row
// of depth, back to front, minis and the strip of dots when it is full.

const layout = (columns: number, rows = 8, tick = 0): MascotLayout => ({ columns, rows, tick })

describe('room', () => {
  test('fewer than 4 rows, or fewer columns than the session\'s slot, draws nothing', () => {
    const table = { Box: () => ({}), Text: () => ({}) } as unknown as Parameters<typeof renderMascots>[0]
    for (const rows of [-5, 0, 1, 2, 3]) {
      expect(mascotLines(everything, layout(72, rows))).toBe(undefined)
      expect(renderMascots(table, everything, layout(72, rows))).toBe(undefined)
    }
    expect(mascotLines(everything, layout(SLOT - 1, 12))).toBe(undefined)
    expect(mascotLines(everything, layout(SLOT, 4))).toHaveLength(4)
  })

  test('one open field: as deep as the rows leave under four of sky, shallow under sixty columns; the session front-left, the agents spread over it by their ids, a cell apart within a row of depth', () => {
    expect([[72, 4], [72, 8], [72, 9], [72, 20], [72, 40], [59, 20], [20, 12]].map(([columns, rows]) => fieldOf(columns!, rows!))).toEqual([
      { depth: 1, headroom: 0 }, { depth: 1, headroom: 4 }, { depth: 2, headroom: 4 }, { depth: 13, headroom: 4 }, { depth: 33, headroom: 4 }, { depth: 2, headroom: 15 }, { depth: 2, headroom: 7 },
    ])
    expect([fieldOf(72, 3), fieldOf(SLOT - 1, 12)]).toEqual([undefined, undefined])
    const scene = sceneOf(crowd(8), idleHud, NOW)
    const plan = mascotPlan(scene, layout(64, 12))!
    expect([plan.depth, plan.headroom]).toEqual([5, 4])
    expect(plan.collapsed).toEqual([])
    expect(plan.minis).toBe(false)
    const main = plan.placements.find(one => one.id === 'main')!
    expect([main.x, main.d]).toEqual([0, plan.depth - 1])
    // Every slot 17 cells, the session's too: in the field, a cell apart from any within a row of depth.
    const placed = plan.placements
    expect(placed.map(one => one.width)).toEqual(Array(9).fill(SLOT))
    for (const one of placed) {
      expect(one.x).toBeGreaterThanOrEqual(0)
      expect(one.x + one.width).toBeLessThanOrEqual(64)
      for (const other of placed) {
        if (one.id >= other.id || Math.abs(one.d - other.d) > 1) continue
        const gap = one.x <= other.x ? other.x - (one.x + one.width) : one.x - (other.x + other.width)
        expect(gap, `${one.id}/${other.id}`).toBeGreaterThanOrEqual(1)
      }
    }
    // Spread over its depth, not one line.
    expect(new Set(placed.map(one => one.d)).size).toBeGreaterThan(2)
    // The same scene, the same slots; where the field has room, a newcomer leaves the others where they are.
    expect(mascotPlan(scene, layout(64, 12))!.placements).toEqual(plan.placements)
    const wide = mascotPlan(scene, layout(100, 12))!
    const more = mascotPlan(sceneOf(crowd(9), idleHud, NOW), layout(100, 12, 1), wide)!
    for (const one of wide.placements) expect([one.id, more.placements.find(other => other.id === one.id)?.x]).toEqual([one.id, one.x])
  })

  test('back to front: a nearer mascot is drawn over a farther one, in the text and in the layers', () => {
    // Two at one column, three rows apart in depth: the farther's legs behind the nearer's head.
    const scene: MascotScene = { main: { mood: 'watching', sweating: false }, agents: [working('far', 'thinking', { idleMs: 2 * SCENE_FRAME_MS }), working('near', 'thinking', { idleMs: 2 * SCENE_FRAME_MS, colour: PALETTE[1] })] }
    const room = layout(72, 12)
    const base = mascotPlan(scene, room)!
    const at = (id: string, x: number, d: number) => ({ ...base.placements.find(one => one.id === id)!, x, drawnX: x, d, slotD: d })
    const plan: MascotPlan = { ...base, placements: [base.placements[0]!, at('near', 30, 4), at('far', 30, 1)] }
    const placed = placedSprites(scene, room, plan)!
    // By depth, then column: the session (front, column 0) before the nearer one at column 30.
    expect(placed.sprites.map(one => [one.id, one.d])).toEqual([['far', 1], ['main', 4], ['near', 4]])
    const lines = mascotLines(scene, room, plan)!
    // The farther's box rows (its air row at 4 + 1), the nearer's (at 4 + 4): the farther's legs row is the nearer's air row and the nearer's hat wins.
    const canvas = sceneCanvas(scene, { ...room, motion: undefined }, plan)!
    const top = (d: number) => canvas.grid.length - 4 - (plan.depth - 1 - d)
    expect(canvas.owners[top(4) + 1]?.[33]).toBe('near')
    expect(canvas.owners[top(1) + 1]?.[33]).toBe('far')
    expect(lines.join('\n')).toContain(HEADS.open.trim())
    // A layer keeps only what shows: none of the farther's cells under the nearer's.
    const far = canvas.layers.find(layer => layer.id === 'far')!
    far.cells.forEach((row, y) => row.forEach((cell, dx) => {
      if (cell !== undefined) expect(canvas.owners[Math.round(far.y) + y]?.[Math.round(far.x) + dx], `${dx},${y}`).toBe('far')
    }))
  })

  test('a full field: its back row turns to minis; still full, the oldest fold into a one-row strip of dots and a count', () => {
    const scene = sceneOf(crowd(10), idleHud, NOW, { stalledMs: 120_000 })
    // Room for all of them full size: no minis, nothing folded.
    expect(mascotPlan(scene, layout(100, 24))).toMatchObject({ minis: false, collapsed: [] })
    // Seventy-two by eight, a field a row deep: eight agents do not fit full size; its row (the back one) holds minis, packed from the left after the session.
    const eight = sceneOf(crowd(8), idleHud, NOW)
    const minis = mascotPlan(eight, layout(72, 8))!
    expect(minis).toMatchObject({ depth: 1, minis: true, collapsed: [] })
    expect(minis.placements.filter(one => one.kind === 'mini').map(one => one.x)).toEqual([18, 24, 30, 36, 42, 48, 54, 60])
    expect(minis.placements.find(one => one.id === 'main')?.kind).toBe('main')
    // Three fit full size: no minis.
    expect(mascotPlan(sceneOf(crowd(3), idleHud, NOW), layout(72, 8))!.minis).toBe(false)
    // In a deeper field only the back row's: the full ones stand in front of it.
    const deeper = mascotPlan(sceneOf(crowd(16), idleHud, NOW), layout(72, 10))!
    expect(deeper.minis).toBe(true)
    for (const one of deeper.placements.filter(placement => placement.kind !== 'strip')) expect(one.kind === 'mini' ? one.d === 0 : one.d >= 1, `${one.id} ${one.kind} ${one.d}`).toBe(true)
    // Forty by four: still full; as few fold as can, the oldest.
    const plan = mascotPlan(scene, layout(40, 4))!
    expect(plan.minis).toBe(true)
    const folded = plan.collapsed.length
    expect(folded).toBeGreaterThan(0)
    expect(plan.collapsed).toEqual(crowd(10).slice(0, folded).map(one => one.id))
    const strip = plan.placements.find(one => one.kind === 'strip')!
    expect(strip.text).toMatch(new RegExp(`^(● )*×${folded}$`))
    // The dots stand for the newest of the folded.
    expect(strip.dots).toEqual(plan.collapsed.slice(folded - (strip.dots?.length ?? 0)))
    expect(plan.placements.filter(one => one.kind === 'mini').map(one => one.id)).toEqual(crowd(10).slice(folded).map(one => one.id))
    expect(mascotLines(scene, layout(40, 4))?.[2]).toContain(`×${folded}`)
    // At 21 columns the count still fits beside the session; at 20 it stands alone.
    expect(mascotLines(scene, layout(21, 4))?.[2]?.slice(18)).toBe('×10')
    expect(mascotLines(scene, layout(20, 4))?.every(line => displayWidth(line) <= SLOT)).toBe(true)
  })

  test('a stalled, done or failed agent folds in as its status glyph', () => {
    const scene: MascotScene = {
      main: { mood: 'watching', sweating: false },
      agents: [
        working('a', 'thinking', { status: 'stalled' }),
        working('b', 'thinking', { status: 'done', endedMs: 0 }),
        working('c', 'thinking', { status: 'failed', endedMs: 0 }),
        working('d', 'thinking'),
        working('e', 'thinking'),
      ],
    }
    // The back row of minis after the strip: as few fold as can, as many dots as fit.
    const strip = (columns: number) => mascotPlan(scene, layout(columns, 4))!.placements.find(one => one.kind === 'strip')?.text
    expect(mascotPlan(scene, layout(42, 4))!.collapsed).toEqual(['a', 'b'])
    expect(strip(42)).toBe('◌ ✓ ×2')
    expect(mascotPlan(scene, layout(37, 4))!.collapsed).toEqual(['a', 'b', 'c'])
    expect(strip(37)).toBe('✓ ✗ ×3')
    // Narrower, the strip gives up dots before another agent folds.
    expect(mascotPlan(scene, layout(32, 4))!.collapsed).toEqual(['a', 'b', 'c'])
    expect(strip(32)).toBe('×3')
  })
})
