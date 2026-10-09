import { about, chain, multiply, rotate, scale, translate } from './clawd-vector'
import type { Shape } from './clawd-vector'

// The smooth Clawd's motion: where its body, eyes, arms and legs are at a
// moment of each thing it does (idle, thinking, watching, asleep, walking,
// hopping, tidying up, stretching after a compaction), eased frame by frame
// rather than stepped cell by cell; and the shapes of that pose
// (hooks/clawd-vector.ts draws them).
//
// The figure keeps Claude Code's own proportions, its logo's 18 by 6
// quadrants read in square units (a terminal quadrant is one unit wide and
// two tall): a body 12 by 8, two eye slits 1 by 2 low in its head, stubby arms
// 2 by 2 at its shoulders, four legs 1 by 2. World units, the origin between
// its feet on the floor, y down.

export type Prop =
  /** The stack of pages it squashes: how many, and how squashed (0 to 1). */
  | { kind: 'pages'; x: number; count: number; squash: number }
  /** A page falling onto the stack. */
  | { kind: 'page'; x: number; y: number; angle: number; alpha: number }
  /** The squashed stack: a tidy bundle, ribbon round it. */
  | { kind: 'bundle'; x: number; y: number; size: number; alpha: number }
  | { kind: 'puff'; x: number; y: number; size: number; alpha: number }
  | { kind: 'spark'; x: number; y: number; size: number; angle: number; alpha: number }
  /** The thought cloud over its head: grown 0 to 1, its three dots lighting in turn. */
  | { kind: 'thought'; grow: number; dot: number }
  | { kind: 'z'; x: number; y: number; size: number; alpha: number }

export type Pose = {
  x: number
  /** Units above the floor. */
  lift: number
  /** Squash and stretch, about its feet. */
  sx: number
  sy: number
  /** Radians, about its feet. */
  tilt: number
  /** The eyes' offset, how open (0 shut to 1), or squeezed happy (`^ ^`). */
  eyes: { dx: number; dy: number; open: number; happy?: boolean }
  /** Each arm raised (radians: 0 at rest, π/2 straight up, negative down). */
  arms: { left: number; right: number }
  /** Each leg's lift, left to right. */
  legs: readonly [number, number, number, number]
  props: readonly Prop[]
}

export const CLAWD = {
  body: '#D77757',
  deep: '#B95E40',
  eye: '#2A1712',
  paper: '#F2ECE1',
  edge: '#C9BFAE',
  spark: '#FFD27A',
  dust: '#B9B2A6',
  cloud: '#E9E4DA',
  shadow: '#000000',
} as const

// --- easing ------------------------------------------------------------------

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
/** How far `t` is through `from` to `to`, 0 to 1. */
const span = (t: number, from: number, to: number): number => clamp01((t - from) / (to - from))
const mix = (a: number, b: number, u: number): number => a + (b - a) * u
const wave = (t: number, period: number): number => Math.sin((2 * Math.PI * t) / period)
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

const REST: Pose = { x: 0, lift: 0, sx: 1, sy: 1, tilt: 0, eyes: { dx: 0, dy: 0, open: 1 }, arms: { left: 0, right: 0 }, legs: [0, 0, 0, 0], props: [] }

/** A blink every three to five seconds: 70 ms closing, 50 ms shut, 110 ms opening. */
export const blinkOf = (t: number, seed = 0): number => {
  const cycle = 4000
  const k = Math.floor(t / cycle)
  const d = t - (k * cycle + 600 + hash01(k, seed) * 2600)
  if (d < 0 || d > 230) return 1
  if (d < 70) return mix(1, 0.08, easeIn(d / 70))
  if (d < 120) return 0.08

  return mix(0.08, 1, easeOut((d - 120) / 110))
}

const breathe = (t: number, period = 2800, depth = 1): Pick<Pose, 'sx' | 'sy'> => {
  const b = wave(t, period) * depth

  return { sx: 1 - 0.012 * b, sy: 1 + 0.022 * b }
}

/** Idle: breathing, blinking, now and then a look left and right. */
export const idlePose = (t: number): Pose => {
  const look = t % 7000
  const left = span(look, 4000, 4220) - span(look, 5200, 5420)
  const right = span(look, 5200, 5420) - span(look, 6400, 6620)

  return { ...REST, ...breathe(t), eyes: { dx: 0.55 * (easeInOut(right) - easeInOut(left)), dy: 0, open: blinkOf(t) }, arms: { left: 0.05 * wave(t, 2800), right: 0.05 * wave(t, 2800) } }
}

/** Watching the agents: eyes on them, leaning in a little. */
export const watchPose = (t: number): Pose => ({ ...REST, ...breathe(t, 2200), tilt: 0.03, eyes: { dx: 0.55, dy: 0.1, open: blinkOf(t, 3) } })

/** Thinking: eyes up, swaying, a thought cloud over its head with its dots lighting in turn. */
export const thinkPose = (t: number): Pose => ({
  ...REST,
  ...breathe(t, 3000),
  tilt: 0.035 * wave(t, 3400),
  eyes: { dx: 0.35, dy: -0.55, open: blinkOf(t, 5) },
  arms: { left: 0.08, right: -0.1 },
  props: [{ kind: 'thought', grow: easeOut(span(t, 0, 500)), dot: t }],
})

/** Asleep: sunk a little, eyes shut, breathing slow, z z Z rising. */
export const sleepPose = (t: number): Pose => ({
  ...REST,
  ...breathe(t, 3600, 1.4),
  sy: 0.93 + 0.02 * wave(t, 3600),
  eyes: { dx: 0, dy: 0.2, open: 0.08 },
  arms: { left: -0.12, right: -0.12 },
  props: [0, 1, 2].map((one): Prop => {
    const phase = ((t / 2600) + one / 3) % 1

    return { kind: 'z', x: 5 + 2.4 * phase + 0.5 * wave(t + one * 500, 1300), y: -11 - 7 * phase, size: 1 + 1.4 * phase, alpha: Math.sin(Math.PI * phase) }
  }),
})

/** Walking: two steps every 520 ms, legs in turn, a bob and a lean the way it goes. */
export const walkPose = (t: number, dir: 1 | -1, from = 0, speed = 0.0075): Pose => {
  const step = wave(t, 520)

  return {
    ...REST,
    x: from + dir * speed * t,
    lift: 0.35 * Math.abs(step),
    tilt: 0.06 * dir,
    sy: 1 + 0.02 * Math.abs(step),
    eyes: { dx: 0.5 * dir, dy: 0, open: blinkOf(t, 7) },
    arms: { left: 0.3 * step, right: -0.3 * step },
    legs: [0.75 * Math.max(0, step), 0.75 * Math.max(0, -step), 0.75 * Math.max(0, step), 0.75 * Math.max(0, -step)],
  }
}

/** A hop: crouch, spring up stretched, tuck in the air, land squashed and settle. */
export const HOP_MS = 760
export const hopPose = (t: number, height = 5, x = 0): Pose => {
  const crouch = span(t, 0, 140)
  const air = span(t, 140, 560)
  const land = span(t, 560, HOP_MS)
  if (t < 140) return { ...REST, x, sx: 1 + 0.1 * easeOut(crouch), sy: 1 - 0.17 * easeOut(crouch), eyes: { dx: 0, dy: 0.2, open: 0.85 }, arms: { left: -0.35 * crouch, right: -0.35 * crouch } }
  if (t < 560) {
    const up = 4 * air * (1 - air)
    const stretch = 0.14 * (1 - easeOut(Math.min(1, air * 2)))

    return { ...REST, x, lift: height * up, sx: 1 - 0.6 * stretch, sy: 1 + stretch, eyes: { dx: 0, dy: -0.2, open: 1 }, arms: { left: 0.9 * up, right: 0.9 * up }, legs: [0.5 * up, 0.5 * up, 0.5 * up, 0.5 * up] }
  }
  const squash = 1 - easeBack(land)

  return { ...REST, x, sx: 1 + 0.1 * squash, sy: 1 - 0.15 * squash, eyes: { dx: 0, dy: 0.1, open: mix(0.6, 1, land) }, arms: { left: -0.3 * squash, right: -0.3 * squash } }
}

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
  let lift = 0
  let lean = 0.04 * windUp
  if (p >= 350 && p < 470) {
    sy = mix(0.9, 1.12, slam)
    sx = mix(1.06, 0.95, slam)
    lift = 1.1 * Math.sin(Math.PI * slam)
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
    lift,
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

const LEG_X = [-5, -3, 2, 4] as const

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
    case 'thought': {
      const g = prop.grow
      const bubbles: Shape[] = [
        { kind: 'ellipse', x: 3.6, y: -11.6, w: 0.8 * g, h: 0.8 * g, fill: CLAWD.cloud },
        { kind: 'ellipse', x: 4.9, y: -13.5, w: 1.2 * g, h: 1.2 * g, fill: CLAWD.cloud },
      ]
      if (g < 0.6) return bubbles
      const cloud = easeBack(span(g, 0.6, 1))
      const m = chain(translate(8.5, -17), scale(cloud))
      const puffs: Shape[] = [[-3.4, -1.3, 3.4, 2.6], [-1.6, -2.2, 3.6, 3], [0.6, -1.6, 3.2, 2.6], [-2.6, -0.6, 5.6, 2]].map(([x, y, w, h]): Shape => ({ kind: 'ellipse', x: x ?? 0, y: y ?? 0, w: w ?? 1, h: h ?? 1, fill: CLAWD.cloud, m }))
      const dots = [0, 1, 2].map((one): Shape => {
        const lit = Math.max(0, Math.sin(Math.PI * (((prop.dot / 900) - one * 0.22) % 1)))

        return { kind: 'ellipse', x: -1.1 + one * 1.3 - 0.35, y: -0.6 - 0.5 * lit, w: 0.7, h: 0.7, fill: CLAWD.eye, alpha: 0.35 + 0.65 * lit, m }
      })

      return [...bubbles, ...puffs, ...dots]
    }
    case 'z': {
      const m = chain(translate(prop.x, prop.y), scale(prop.size))
      const bar = 0.22

      return [
        { kind: 'rect', x: -0.5, y: -0.5, w: 1, h: bar, fill: CLAWD.cloud, alpha: prop.alpha, m },
        { kind: 'rect', x: -0.5, y: 0.5 - bar, w: 1, h: bar, fill: CLAWD.cloud, alpha: prop.alpha, m },
        { kind: 'rect', x: -0.62, y: -bar / 2, w: 1.24, h: bar, fill: CLAWD.cloud, alpha: prop.alpha, m: multiply(m, rotate(-0.86)) },
      ]
    }
  }
}

/**
 * The pose's shapes, back to front: its shadow, its legs, its arms, its body
 * (a deeper band along its bottom, a glint along its top), its eyes; then what
 * is beside it. `colour` is its body's.
 */
export const clawdShapes = (pose: Pose, colour: string = CLAWD.body): Shape[] => {
  const body = chain(translate(pose.x, -pose.lift), rotate(pose.tilt), scale(pose.sx, pose.sy))
  const near = 1 / (1 + pose.lift * 0.18)
  const shapes: Shape[] = [
    { kind: 'ellipse', x: pose.x - 6.5 * near, y: -0.35, w: 13 * near, h: 0.7, fill: CLAWD.shadow, alpha: 0.2 * near },
    ...LEG_X.map((x, one): Shape => ({ kind: 'rect', x, y: -2.2 - (pose.legs[one] ?? 0), w: 1, h: 2.2, r: 0.28, fill: CLAWD.deep, m: body })),
    { kind: 'rect', x: -8, y: -6, w: 2.6, h: 2, r: 0.4, fill: colour, m: multiply(body, about(-6, -5, rotate(pose.arms.left))) },
    { kind: 'rect', x: 5.4, y: -6, w: 2.6, h: 2, r: 0.4, fill: colour, m: multiply(body, about(6, -5, rotate(-pose.arms.right))) },
    { kind: 'rect', x: -6, y: -10, w: 12, h: 8, r: 0.65, fill: colour, m: body },
    { kind: 'rect', x: -6, y: -3.5, w: 12, h: 1.5, r: 0.65, fill: CLAWD.deep, alpha: 0.3, m: body },
    { kind: 'rect', x: -5.1, y: -9.55, w: 10.2, h: 0.5, r: 0.25, fill: '#FFFFFF', alpha: 0.16, m: body },
  ]
  const { dx, dy, open, happy } = pose.eyes
  for (const x of [-4, 3]) {
    if (happy === true) {
      // Squeezed shut with joy: `^`.
      for (const side of [-1, 1]) {
        shapes.push({ kind: 'rect', x: -0.42, y: -0.15, w: 0.84, h: 0.3, r: 0.15, fill: CLAWD.eye, m: multiply(body, chain(translate(x + 0.5 + dx + side * 0.3, -7 + dy), rotate(side * 0.65))) })
      }
      continue
    }
    const h = 2 * Math.max(0.08, Math.min(1, open))
    shapes.push({ kind: 'rect', x: x + dx, y: -6.1 + dy - h, w: 1, h, r: Math.min(0.3, h / 2), fill: CLAWD.eye, m: body })
  }

  return [...shapes, ...pose.props.flatMap(propShapes)]
}
