import { chain, multiply, rotate, scale, translate, wave } from './clawd-vector'
import type { Shape } from './clawd-vector'

// The smooth Clawd's session moves: where its body, eyes and arms are at a
// moment of tidying up and of its stretch after a compaction, eased frame by
// frame rather than stepped cell by cell (hooks/smooth-pose.ts takes them
// in); and the shapes of what is beside it then (hooks/clawd-vector.ts draws
// them). World units, as the figure's (hooks/smooth-art.ts): its body 12 by
// 8, the origin between its feet on the floor, y down.

export type Prop =
  /** The stack of pages it squashes: how many, and how squashed (0 to 1). */
  | { kind: 'pages'; x: number; count: number; squash: number }
  /** A page falling onto the stack. */
  | { kind: 'page'; x: number; y: number; angle: number; alpha: number }
  /** The squashed stack: a tidy bundle, ribbon round it. */
  | { kind: 'bundle'; x: number; y: number; size: number; alpha: number }
  | { kind: 'puff'; x: number; y: number; size: number; alpha: number }
  | { kind: 'spark'; x: number; y: number; size: number; angle: number; alpha: number }

export type Pose = {
  x: number
  /** Squash and stretch, about its feet. */
  sx: number
  sy: number
  /** Radians, about its feet. */
  tilt: number
  /** The eyes' offset, how open (0 shut to 1), or squeezed happy (`^ ^`). */
  eyes: { dx: number; dy: number; open: number; happy?: boolean }
  /** Each arm raised (radians: 0 at rest, π/2 straight up, negative down). */
  arms: { left: number; right: number }
  props: readonly Prop[]
}

export const CLAWD = {
  body: '#D77757',
  deep: '#B95E40',
  paper: '#F2ECE1',
  edge: '#C9BFAE',
  spark: '#FFD27A',
  dust: '#B9B2A6',
  cloud: '#E9E4DA',
} as const

// --- easing ------------------------------------------------------------------

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
/** How far `t` is through `from` to `to`, 0 to 1. */
const span = (t: number, from: number, to: number): number => clamp01((t - from) / (to - from))
const mix = (a: number, b: number, u: number): number => a + (b - a) * u
const easeIn = (u: number): number => u * u * u
const easeOut = (u: number): number => 1 - (1 - u) ** 3
const easeInOut = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2)
/** Past the mark and back: a settle with a little overshoot. */
const easeBack = (u: number): number => 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2
/** A pseudo-random 0 to 1, the same for the same `n`. */
const hash01 = (n: number, salt = 0): number => {
  const x = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453

  return x - Math.floor(x)
}

// --- the things it does --------------------------------------------------------

const REST: Pose = { x: 0, sx: 1, sy: 1, tilt: 0, eyes: { dx: 0, dy: 0, open: 1 }, arms: { left: 0, right: 0 }, props: [] }

/** Tidying up: one squash of the pages every TIDY_LOOP_MS, while a compaction runs. */
export const TIDY_LOOP_MS = 1800
/** Where the stack of pages stands, right of it. */
const STACK_X = 11

/**
 * Tidying up, on a loop: it winds up, arm raised over a stack of pages; slams
 * it down; the stack squashes into a bundle in a puff of dust while it bounces
 * back; the bundle glints, it beams; the bundle hops off and fades, and the
 * next pages flutter down onto the stack.
 */
export const tidyPose = (t: number): Pose => {
  const p = t % TIDY_LOOP_MS
  const windUp = easeOut(span(p, 0, 350))
  const slam = easeIn(span(p, 350, 470))
  const impact = span(p, 470, 760)
  const squash = easeIn(span(p, 470, 600))
  const recover = easeBack(impact)
  const happy = p >= 900 && p < 1300
  const props: Prop[] = []

  // The stack: whole until the slam lands, squashing as it does; empty while the bundle is out; filling as pages land.
  const landed = [0, 1, 2, 3].filter(one => p >= 1350 + one * 100 + 260).length
  if (p < 600) props.push({ kind: 'pages', x: STACK_X, count: 4, squash })
  else if (landed > 0) props.push({ kind: 'pages', x: STACK_X, count: landed, squash: 0 })
  for (let one = 0; one < 4; one += 1) {
    const fall = span(p, 1350 + one * 100, 1350 + one * 100 + 260)
    if (fall <= 0 || fall >= 1) continue
    // Into its place on the stack (a page's centre, as `pages` lays them).
    props.push({ kind: 'page', x: STACK_X + 0.6 * wave(p + one * 90, 520) * (1 - fall), y: mix(-17, -(one + 0.5), easeIn(fall)), angle: (one % 2 === 0 ? 0.55 : -0.5) * (1 - fall), alpha: clamp01(fall * 3) })
  }
  // The bundle: pops up as the stack goes, glints, hops off right and fades.
  if (p >= 560 && p < 1500) {
    const pop = easeBack(span(p, 560, 760))
    const off = easeIn(span(p, 1250, 1500))
    props.push({ kind: 'bundle', x: STACK_X + 3 * off, y: -2.2 * Math.sin(Math.PI * off), size: pop, alpha: 1 - off })
  }
  // Dust from under the stack as it squashes.
  if (p >= 470 && p < 900) {
    const puff = span(p, 470, 900)
    for (const side of [-1, 1]) props.push({ kind: 'puff', x: STACK_X + side * (2.2 + 1.6 * easeOut(puff)), y: -0.6 - 0.8 * puff, size: 0.5 + 1.3 * easeOut(puff), alpha: 0.75 * (1 - puff) })
  }
  // The glint on the bundle.
  if (p >= 820 && p < 1180) {
    const glint = span(p, 820, 1180)
    props.push({ kind: 'spark', x: STACK_X + 1.2, y: -3.4, size: 2.2 * Math.sin(Math.PI * glint), angle: glint * 1.2, alpha: 1 })
  }

  // Its body: crouch to wind up, rise and lean into the slam, squashed by it, bouncing back.
  let sy = 1 - 0.1 * windUp
  let sx = 1 + 0.06 * windUp
  let lean = 0.04 * windUp
  if (p >= 350 && p < 470) {
    sy = mix(0.9, 1.12, slam)
    sx = mix(1.06, 0.95, slam)
    lean = mix(0.04, 0.16, slam)
  } else if (p >= 470) {
    sy = mix(0.84, 1, recover)
    sx = mix(1.08, 1, recover)
    lean = mix(0.16, 0, recover)
  }
  const raised = p < 350 ? 1.5 * windUp : p < 470 ? mix(1.5, -0.6, slam) : mix(-0.6, 0, easeOut(impact))

  return {
    ...REST,
    x: 0.8 * Math.sin(Math.PI * Math.min(1, p / 760)),
    sx,
    sy,
    tilt: lean,
    eyes: { dx: 0.6, dy: 0.15, open: p >= 470 && p < 620 ? 0.35 : 1, ...(happy ? { happy: true } : {}) },
    arms: { left: 0.2 * windUp, right: raised },
    props,
  }
}

/** The stretch after a compaction stood: arms up, standing tall, beaming, sparkles round it; then settling. */
export const STRETCH_MS = 1600
export const stretchPose = (t: number): Pose => {
  const up = easeOut(span(t, 0, 300))
  const down = easeInOut(span(t, 1100, STRETCH_MS))
  const tall = up * (1 - down)

  return {
    ...REST,
    sx: 1 - 0.05 * tall,
    sy: 1 + 0.09 * tall,
    tilt: 0.03 * wave(t, 900) * tall,
    eyes: { dx: 0, dy: -0.1, open: 1, ...(tall > 0.3 ? { happy: true } : {}) },
    arms: { left: 1.45 * tall, right: 1.45 * tall },
    props: [[-9, -10, 0], [9.5, -12, 260], [7, -4, 520]].flatMap(([x, y, delay]): Prop[] => {
      const twinkle = span(t, 200 + (delay ?? 0), 900 + (delay ?? 0))
      if (twinkle <= 0 || twinkle >= 1) return []

      return [{ kind: 'spark', x: x ?? 0, y: y ?? 0, size: 2 * Math.sin(Math.PI * twinkle), angle: twinkle, alpha: 1 }]
    }),
  }
}

// --- the shapes ------------------------------------------------------------------

/** A spark: two thin ellipses across each other, turning. */
const sparkShapes = (one: Extract<Prop, { kind: 'spark' }>): Shape[] => {
  const m = chain(translate(one.x, one.y), rotate(one.angle))

  return [0, Math.PI / 2].map((turn): Shape => ({ kind: 'ellipse', x: -one.size / 2, y: -one.size * 0.11, w: one.size, h: one.size * 0.22, fill: CLAWD.spark, alpha: one.alpha, m: multiply(m, rotate(turn)) }))
}

/** A page: paper with its edge under it. */
const pageShapes = (x: number, y: number, angle: number, alpha: number, squash = 1): Shape[] => {
  const m = chain(translate(x, y), rotate(angle), scale(1, squash))

  return [
    { kind: 'rect', x: -2, y: -0.4, w: 4, h: 0.8, r: 0.15, fill: CLAWD.paper, alpha, m },
    { kind: 'rect', x: -2, y: 0.25, w: 4, h: 0.15, fill: CLAWD.edge, alpha, m },
  ]
}

export const propShapes = (prop: Prop): Shape[] => {
  switch (prop.kind) {
    case 'pages': {
      const pitch = mix(1, 0.2, prop.squash)

      return Array.from({ length: prop.count }, (_, one) => pageShapes(prop.x + 0.3 * (hash01(one, 9) - 0.5), -(one + 0.5) * pitch, 0, 1, mix(1, 0.4, prop.squash))).flat()
    }
    case 'page':
      return pageShapes(prop.x, prop.y, prop.angle, prop.alpha)
    case 'bundle': {
      const m = chain(translate(prop.x, prop.y), scale(prop.size))

      return [
        { kind: 'rect', x: -1.8, y: -2.8, w: 3.6, h: 2.8, r: 0.35, fill: CLAWD.paper, alpha: prop.alpha, m },
        { kind: 'rect', x: -1.8, y: -0.5, w: 3.6, h: 0.5, r: 0.2, fill: CLAWD.edge, alpha: prop.alpha, m },
        { kind: 'rect', x: -0.35, y: -2.8, w: 0.7, h: 2.8, fill: CLAWD.body, alpha: prop.alpha, m },
      ]
    }
    case 'puff':
      return [{ kind: 'ellipse', x: prop.x - prop.size / 2, y: prop.y - prop.size / 2, w: prop.size, h: prop.size * 0.8, fill: CLAWD.dust, alpha: prop.alpha }]
    case 'spark':
      return sparkShapes(prop)
  }
}
