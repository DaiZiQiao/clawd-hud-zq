import { describe, expect, test } from 'claude-code/testing'

import { IDENTITY, rasterOf, scale, springAt, svgOf } from './clawd-vector'
import { mainLook, miniLook } from './mascot-poses'
import { MONO_ADVANCE, monoShapes } from './mono-font'
import { working } from './scene-model.fixtures'
import { figureShapes } from './smooth-art'
import type { FigureInfo } from './smooth-art'
import { KEY_MS, NEUTRAL, createSmoother, livelyOf, strokeAt, targetOf } from './smooth-pose'
import type { FigurePose, PoseContext } from './smooth-pose'
import { USAGI_THOUGHTS } from './usagi-sprites'

// The smooth scene's poses eased from frame to frame (hooks/smooth-pose.ts).

describe('easing between frames', () => {
  test('the same moment drawn again keeps the pose it has (a surface redrawing the frame its clock drew); a frame on it eases on; back in time, the target', () => {
    const smoother = createSmoother()
    const squashed = { ...NEUTRAL, sx: 1.2, sy: 0.7 }
    smoother.ease('a', NEUTRAL, 1000)
    const first = smoother.ease('a', squashed, 1033)
    // On its way, not there yet.
    expect(first.sy).toBeLessThan(1)
    expect(first.sy).toBeGreaterThan(0.7)
    expect(smoother.ease('a', squashed, 1033)).toEqual(first)
    expect(smoother.ease('a', squashed, 1066).sy).toBeLessThan(first.sy)
    expect(smoother.ease('a', NEUTRAL, 900)).toEqual(NEUTRAL)
  })
})

describe('typing', () => {
  test('a typing hand strikes a key every other stroke\'s time, now and then two running, and rests a burst in five or so; its own rhythm, the same at any frame rate', () => {
    const strokes = (seed: number) => Array.from({ length: 400 }, (_, slot) => strokeAt(slot * KEY_MS, seed))
    const one = strokes(1.3)
    const down = one.filter(key => key === 1).length / one.length
    expect(down).toBeGreaterThan(0.35)
    expect(down).toBeLessThan(0.65)
    // A rest: eight strokes' time with the hand up.
    expect(one.join('')).toMatch(/0{8}/)
    // Two running, now and then.
    expect(one.join('')).toMatch(/11/)
    expect(strokes(4.2)).not.toEqual(one)
    // Within a stroke's time, the same at any moment.
    for (const t of [0, 40, 80, 124]) expect(strokeAt(1000 * KEY_MS + t, 1.3)).toBe(strokeAt(1000 * KEY_MS, 1.3))
  })

  test('at its laptop typing, the near hand reaches the keys and comes down on each stroke; without the laptop, or not typing, its arms are its own', () => {
    const at = (key: number, seed = 1.3): number => {
      for (let slot = 0; ; slot += 1) if (strokeAt(slot * KEY_MS, seed) === key) return slot * KEY_MS
    }
    const typing = { ...NEUTRAL, laptop: 1, typing: 1.3 }
    const context = { character: 'clawd' as const, seed: 1.3, calm: true }
    const pressed = livelyOf(typing, { ...context, now: at(1) }, false)
    const lifted = livelyOf(typing, { ...context, now: at(0) }, false)
    expect([pressed.reach, lifted.reach]).toEqual([0.6, 0.6])
    expect(pressed.armR).toBeLessThan(lifted.armR)
    expect(lifted.armL).toBeGreaterThan(pressed.armL)
    for (const pose of [{ ...NEUTRAL, typing: 1.3 }, { ...NEUTRAL, laptop: 1 }]) {
      const still = livelyOf(pose, { ...context, now: at(1) }, false)
      expect([still.reach, still.armR, still.armL]).toEqual([0, 0, 0])
    }
  })
})

describe('thinking, as Claude Code\'s spinner says it', () => {
  const CONTEXT: PoseContext = { character: 'clawd', now: 1000, seed: 1.3 }
  const INFO: FigureInfo = { character: 'clawd', colour: '#D77757', energy: 0, crown: true }
  const look = mainLook({ mood: 'thinking', sweating: false }, 4)
  const thought = (pose: FigurePose) => pose.beside.find(one => one.kind === 'thought')

  test('Motion\'s spring: nothing before it starts; past 1 by its bounce and back, at rest soon after its visual duration; with no bounce, never past', () => {
    expect([springAt(-10, 300, 0.3), springAt(0, 300, 0.3)]).toEqual([0, 0])
    const curve = Array.from({ length: 200 }, (_, step) => springAt(step * 5, 300, 0.3))
    expect(Math.max(...curve)).toBeGreaterThan(1.02)
    expect(Math.max(...curve)).toBeLessThan(1.2)
    expect(Math.abs(springAt(900, 300, 0.3) - 1)).toBeLessThan(0.02)
    expect(Math.max(...Array.from({ length: 200 }, (_, step) => springAt(step * 5, 300, 0)))).toBeLessThanOrEqual(1)
  })

  test('its words in JetBrains Mono, a character a cell across: an o\'s hole clear inside its ring; a character the outlines lack keeps its place; even-odd in the SVG too', () => {
    const em = 2 / MONO_ADVANCE
    const pixels = rasterOf(monoShapes('o', 0, 3.1, em, () => ({ fill: '#D77757' })), 16, 32, scale(8, 8))
    const alphaAt = (x: number, y: number): number => pixels[(Math.floor(y * 8) * 16 + Math.floor(x * 8)) * 4 + 3] ?? 0
    // Its middle (half its x-height up from the baseline) clear; its bottom stroke drawn.
    expect(alphaAt(1, 3.1 - 0.275 * em)).toBe(0)
    expect(alphaAt(1, 3.1 - 0.02 * em)).toBeGreaterThan(200)
    const shapes = monoShapes('a b', 0, 3, em, () => ({ fill: '#D77757' }))
    expect(shapes).toHaveLength(2)
    expect(Math.min(...(shapes[1]?.points ?? []).map(([x]) => x))).toBeGreaterThan(2 * 2)
    expect(svgOf(monoShapes('o', 0, 3, em, () => ({ fill: '#D77757' })), 16, 32, IDENTITY)).toContain("fill-rule='evenodd'")
  })

  test('the session thinks the spinner\'s word; an agent one of Claude Code\'s verbs, held a while; Usagi a line of its own; a mini its dots alone', () => {
    expect(thought(targetOf(look, { ...CONTEXT, word: 'Sautéing' }, false))?.text).toBe('Sautéing')
    const verb = thought(targetOf(look, CONTEXT, false))?.text
    expect(verb).toMatch(/^[A-Z][a-z]+ing$/)
    expect(thought(targetOf(look, { ...CONTEXT, now: 19_000 }, false))?.text).toBe(verb)
    expect(USAGI_THOUGHTS as readonly string[]).toContain(thought(targetOf(look, { ...CONTEXT, character: 'usagi' }, false))?.text)
    const mini = miniLook(working('c', 'thinking', { parentId: 'p' }), { kind: 'work' }, 4)
    expect(thought(targetOf(mini, { ...CONTEXT, mini: true }, true))?.text).toBe('')
  })

  test('as it comes the dots spring in, then the pill, then its words (\u2731 and the word, in Claude\'s orange); it keeps when it came; the light sweeps back along the words and on', () => {
    const smoother = createSmoother()
    const poseAt = (now: number): FigurePose => smoother.ease('main', targetOf(look, { ...CONTEXT, now, word: 'Noodling' }, false), now)
    const drawn = (now: number) => figureShapes(poseAt(now), INFO, IDENTITY, now, 100)
    const pills = (shapes: ReturnType<typeof drawn>) => shapes.filter(shape => shape.kind === 'rect' && shape.ring !== undefined)
    const words = (shapes: ReturnType<typeof drawn>) => shapes.filter(shape => shape.kind === 'poly' && (shape.fill === 'claude' || shape.fill === 'shimmer') && (shape.alpha ?? 1) > 0.5)
    expect(pills(drawn(1000))).toHaveLength(0)
    for (let now = 1100; now < 1700; now += 100) drawn(now)
    const settled = drawn(1700)
    expect(thought(poseAt(1800))?.since).toBe(1000)
    expect(pills(settled)).toHaveLength(1)
    // Noodling… : nine characters, a polygon each (and the glyph's own when it is the six-pointed star).
    expect(words(settled).length).toBeGreaterThanOrEqual(9)
    // The light: three characters of the shimmer at a time while it crosses the words, none past them.
    const lit: number[] = []
    for (let now = 1800; now < 1800 + 29 * 200; now += 200) lit.push(drawn(now).filter(shape => shape.fill === 'shimmer').length)
    expect(Math.max(...lit)).toBeLessThanOrEqual(3)
    expect(lit.filter(count => count > 0).length).toBeGreaterThan(5)
    expect(lit.filter(count => count === 0).length).toBeGreaterThan(5)
  })
})
