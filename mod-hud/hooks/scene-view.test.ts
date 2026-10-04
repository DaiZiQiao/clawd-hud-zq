import { describe, expect, test } from 'claude-code/testing'

import { HEADS } from './mascot-sprites'
import { HOP_AIR, HOP_HEIGHT, HOP_REACH, LOOP_TICKS } from './motion-rules'
import { NOW, entry } from './scene-model.fixtures'
import { SCENE_FRAME_MS, holdTicks } from './scene-phases'
import { PIPE_ARRIVAL_MS, PIPE_FAREWELL_MS } from './scene-pipe'
import { viewOf } from './scene-view'
import { FRAME_MS, createWorld, inject, tick } from './scene-world'
import { LAPTOP, TYPIST, frameLines, inputs, memoOf, ticks } from './scene-world.fixtures'

// The smooth scene between the choreography's frames: a walk glides, the
// same frames draw the same scene, the red pipe, flights and loops, and a hop
// whose landing is taken.

describe('motion', () => {
  test('20 frames a second: a walk glides a fifth of a cell a frame between the choreography\'s cells, drawn at the nearest', () => {
    const world = createWorld(inputs([entry('w', { startedAt: NOW - 60_000 })], { wander: true }))
    let walked = false
    for (let frame = 0; frame < 400 && !walked; frame += 1) {
      tick(world)
      const cur = world.cur!.placements.find(one => one.id === 'w')!
      const next = world.next!.placements.find(one => one.id === 'w')!
      if (next.motion?.kind !== 'walk' || next.drawnX === cur.drawnX || world.sceneNow % SCENE_FRAME_MS !== 0) continue
      walked = true
      const xs = [0, 1, 2, 3, 4].map(step => {
        if (step > 0) tick(world)
        return viewOf(world).sprites.get('w')!.x!
      })
      const stride = (next.drawnX - cur.drawnX) / 5
      xs.forEach((x, index) => expect(Math.abs(x - (cur.drawnX + stride * index))).toBeLessThan(1e-6))
    }
    expect(walked).toBe(true)
    expect(FRAME_MS).toBe(50)
    expect(SCENE_FRAME_MS / FRAME_MS).toBe(5)
  })

  test('the same props and the same frames, the same scene: deterministic', () => {
    const run = (): string[][] => {
      const world = createWorld(inputs([TYPIST, entry('w', { startedAt: NOW - 60_000 }), entry('f', { currentTool: 'WebFetch', startedAt: NOW - 50_000 })], { wander: true }))
      return Array.from({ length: 120 }, () => {
        tick(world)
        return frameLines(world)
      })
    }
    expect(run()).toEqual(run())
  })

  test('a newcomer comes by the red pipe: down over its slot, out of the mouth falling ever faster to its floor, the pipe back up; a finished one is sucked up it after its cheer', () => {
    const LIP = '█████████'
    const FALLING = '▐▌███▐▌'
    const world = createWorld(inputs([entry('n', { startedAt: NOW, currentTool: 'Edit' })]))
    const frames: { at: number; pipe: boolean; head: number; desk: boolean }[] = []
    for (let ms = FRAME_MS; ms <= PIPE_ARRIVAL_MS + 500; ms += FRAME_MS) {
      tick(world)
      const lines = frameLines(world)
      frames.push({ at: ms, pipe: lines.some(row => row.includes(LIP)), head: lines.findIndex(row => row.includes(FALLING)), desk: lines.some(row => row.includes(LAPTOP)) })
    }
    const piped = frames.filter(one => one.pipe).map(one => one.at)
    // The pipe in sight for most of its 1.5 s, gone after.
    expect(Math.min(...piped)).toBeLessThanOrEqual(250)
    expect(Math.max(...piped)).toBeLessThan(PIPE_ARRIVAL_MS)
    expect(piped.length).toBeGreaterThan(20)
    // Out of the mouth in the fall look, under the pipe, never back up.
    const falling = frames.filter(one => one.head >= 0)
    expect(falling.length).toBeGreaterThan(3)
    expect(falling.every(one => one.pipe)).toBe(true)
    falling.forEach((one, index) => index > 0 && expect(one.head).toBeGreaterThanOrEqual(falling[index - 1]!.head))
    // Then at its laptop at its slot, the pipe gone.
    const slot = world.cur!.placements.find(one => one.id === 'n')!
    expect(frames.at(-1)).toMatchObject({ pipe: false, head: -1, desk: true })
    expect([slot.drawnX, slot.d]).toEqual([slot.x, slot.slotD])
    // The farewell: done 2.5 s before, it cheers for the rest of its hold, then the pipe comes down over it and sucks it up.
    const leaving = createWorld(inputs([entry('d', { status: 'done', startedAt: NOW - 60_000, endedAt: NOW - 2500 })]))
    const legs: number[] = []
    let cheered = false
    let piping = false
    let gone = -1
    for (let frame = 1; frame < 120; frame += 1) {
      tick(leaving)
      const lines = frameLines(leaving)
      if (lines.some(row => row.includes('✓'))) cheered = true
      if (lines.some(row => row.includes(LIP))) piping = true
      // Stretched, legs long: sucked up, its legs higher every frame.
      const leg = lines.findIndex(row => row.includes('▐▌ ▐▌'))
      if (leg >= 0) legs.push(leg)
      if (leaving.cur!.placements.every(one => one.id !== 'd')) {
        gone = frame * FRAME_MS
        break
      }
    }
    expect(cheered).toBe(true)
    expect(piping).toBe(true)
    expect(legs.length).toBeGreaterThan(5)
    legs.forEach((row, index) => index > 0 && expect(row).toBeLessThanOrEqual(legs[index - 1]!))
    expect(legs[0]! - legs.at(-1)!).toBeGreaterThan(2)
    // Gone once the pipe is back up: its hold, then the pipe's two seconds.
    expect(gone).toBeGreaterThan(0)
    expect(gone + 2500).toBeLessThanOrEqual(holdTicks({ status: 'done' }) * SCENE_FRAME_MS + PIPE_FAREWELL_MS + SCENE_FRAME_MS)
  })

  test('an Explore agent at work flies under its propeller cap, scanning the floor: eyes down', () => {
    const world = createWorld(inputs([entry('e', { type: 'Explore', currentTool: 'Read', startedAt: NOW - 60_000 })], { rows: 14 }))
    ticks(world, 30)
    const lines = frameLines(world)
    expect(viewOf(world).sprites.get('e')?.motion?.kind).toBe('fly')
    expect(viewOf(world).sprites.get('e')?.scanning).toBe(true)
    expect(lines.some(row => row.includes(HEADS.down.trim()))).toBe(true)
    expect(lines.some(row => row.includes('▄▄▄ e'))).toBe(true)
  })

  test('a flier\'s loop is drawn as a circle over a second and a half', () => {
    const world = createWorld(inputs([entry('f', { currentTool: 'WebFetch', startedAt: NOW - 60_000 })], { rows: 18 }))
    ticks(world, 60)
    const memo = memoOf(world, 'f')!
    expect(memo.fly).toBeDefined()
    inject(world, 'f', { ...memo, fly: { ...memo.fly!, loop: world.cur!.tick, stage: 'cruise', turnAt: world.cur!.tick + 40 } })
    const path: { x: number; lift: number }[] = []
    for (let frame = 0; frame < (LOOP_TICKS * SCENE_FRAME_MS) / FRAME_MS; frame += 1) {
      tick(world)
      const seen = viewOf(world).sprites.get('f')!
      path.push({ x: seen.x!, lift: seen.lift! })
    }
    const rise = Math.max(...path.map(one => one.lift)) - Math.min(...path.map(one => one.lift))
    expect(rise).toBeGreaterThan(2)
  })

  test('a hop whose landing is taken glides on from where it is drawn, at a hop\'s pace at most: no jump toward clear ground', () => {
    const world = createWorld(inputs([TYPIST, entry('w', { startedAt: NOW - 60_000 })], { wander: true, rows: 9 }))
    ticks(world, 5)
    while (world.sceneNow % SCENE_FRAME_MS !== 0) tick(world)
    const typist = world.cur!.placements.find(one => one.id === 'a')!
    // A hop a frame from landing on the typist at its laptop: clear ground is a typist's width away.
    const at = typist.drawnX - 4
    const hop = { from: world.cur!.tick - HOP_AIR, x0: typist.drawnX - 20, x1: typist.drawnX, height: HOP_HEIGHT, air: HOP_AIR }
    inject(world, 'w', { x: at, d: typist.d, lift: 2, pauseUntil: world.cur!.tick, hop }, { drawnX: at, d: typist.d, lift: 2, motion: { kind: 'hop', step: HOP_AIR, lift: 2, pose: 'air' } })
    let x = at
    let frames = 0
    // Half a cell a 50 ms frame at most: a hop's reach over its four frames in the air, five frames to each.
    while (frames < 120 && memoOf(world, 'w')?.hop !== undefined) {
      const drawn = viewOf(world).sprites.get('w')!.x!
      expect(Math.abs(drawn - x), `${frames}`).toBeLessThanOrEqual(HOP_REACH / HOP_AIR / (SCENE_FRAME_MS / FRAME_MS) + 0.01)
      x = drawn
      tick(world)
      frames += 1
    }
    expect(frames).toBeGreaterThan(5)
    expect(memoOf(world, 'w')?.hop).toBe(undefined)
  })
})
