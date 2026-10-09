import type { Gradient, Shape } from './clawd-vector'
import { hashOf } from './motion-rules'

// The world behind the smooth scene (the `scenery` option): the mascots on
// a tour of the world's wonders. The tour stays at each stop (a landmark in
// its own light and weather: the Eiffel Tower at dusk under falling leaves,
// Big Ben in the rain, Mount Fuji in cherry blossom, the northern lights over
// Tromsø) for STAY_MS, its name shown a while, then pans on to the next,
// STOP units along the world's strip, over PAN_MS; a wide view shows the stops
// either side too. Pure: a function of the size and the time, so the band and
// the pane are always at the same stop. World units, as the mascots': a cell
// is 2 across and 4 down, y down from the top.

/** How long the tour stays at a stop, and takes to pan on to the next, ms. */
export const STAY_MS = 45_000
const PAN_MS = 7000
const LEG_MS = STAY_MS + PAN_MS
/** A stop's stretch of the world's strip, in units. */
const STOP = 110

/**
 * A layer: what stands still, drawn once per `key` and kept, `span` units
 * across, seen from `shift` units into it, its last `detail` shapes a
 * texture a drawing short of room may leave out; and what moves, drawn over
 * it each frame in the view's own units.
 */
export type Layer = { key: string; still: Shape[]; span: number; shift: number; detail: number; moving: Shape[] }

/** The scenery of a frame, back to front: the sky, the land, then (after the mascots) the weather nearest the eye. */
export type Scenery = { sky: Layer; land: Layer; front: Shape[] }

type Weather = 'leaves' | 'rain' | 'petals' | 'snow' | 'fireflies'

/** Where a stop is drawn: its middle, the horizon its landmark stands on, its scale, and the bottom of the view. */
type At = { x: number; y: number; s: number; bottom: number }

type Stop = {
  name: string
  /** The sky from the top down to the horizon. */
  sky: readonly [string, string, string, string]
  /** The sun or the moon: where in the sky (shares of the width and of the height down to the horizon), how big. */
  body?: { moon?: true; x: number; y: number; r: number; colour: string }
  /** How dark it is: the stars. */
  night: number
  cloud?: string
  ground: string
  /** What the ground is: tufts of grass, ripples of sand, drifts of snow, paving stones. */
  floor: 'grass' | 'sand' | 'snow' | 'stone'
  weather?: Weather
  /** Birds crossing its sky. */
  birds?: true
  draw: (at: At) => Shape[]
  moving?: (at: At, now: number) => Shape[]
}

// --- drawing -------------------------------------------------------------------

const mod = (a: number, n: number): number => ((a % n) + n) % n

/** A number in [0, 1) chosen by the parts. */
const rnd = (...parts: readonly (string | number)[]): number => hashOf('scenery', ...parts) / 4_294_967_296

const ease = (t: number): number => {
  const k = Math.max(0, Math.min(1, t))

  return k * k * (3 - 2 * k)
}

const rgbOf = (hex: string): number[] => {
  const n = Number.parseInt(hex.slice(1), 16)

  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const mix = (a: string, b: string, w: number): string => {
  if (w <= 0) return a
  if (w >= 1) return b
  const to = rgbOf(b)

  return `#${rgbOf(a).map((v, i) => Math.round(v + ((to[i] ?? 0) - v) * w).toString(16).padStart(2, '0')).join('')}`
}

type Point = readonly [number, number]

const rect = (x: number, y: number, w: number, h: number, fill: string, alpha = 1, r = 0): Shape => ({ kind: 'rect', x, y, w, h, fill, ...(alpha < 1 ? { alpha } : {}), ...(r > 0 ? { r } : {}) })
const disc = (cx: number, cy: number, rx: number, ry: number, fill: string, alpha = 1): Shape => ({ kind: 'ellipse', x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry, fill, ...(alpha < 1 ? { alpha } : {}) })
const poly = (points: readonly Point[], fill: string, alpha = 1, grad?: Gradient): Shape => ({ kind: 'poly', x: 0, y: 0, w: 0, h: 0, points, fill, ...(alpha < 1 ? { alpha } : {}), ...(grad === undefined ? {} : { grad }) })
const line = (points: readonly Point[], stroke: number, fill: string, alpha = 1): Shape => ({ kind: 'line', x: 0, y: 0, w: 0, h: 0, points, stroke, fill, ...(alpha < 1 ? { alpha } : {}) })

/** A stop's points: each `[dx, up]` from its middle and horizon, in its scale. */
const placer = ({ x, y, s }: At) => (points: readonly Point[]): Point[] => points.map(([dx, up]) => [x + dx * s, y - up * s])

/** A box from `[dx, up]` to `[dx2, up2]` in a stop's units. */
const box = (at: At, dx: number, up: number, dx2: number, up2: number, fill: string, alpha = 1): Shape => rect(at.x + Math.min(dx, dx2) * at.s, at.y - Math.max(up, up2) * at.s, Math.abs(dx2 - dx) * at.s, Math.abs(up2 - up) * at.s, fill, alpha)

const dot = (at: At, dx: number, up: number, rx: number, ry: number, fill: string, alpha = 1): Shape => disc(at.x + dx * at.s, at.y - up * at.s, rx * at.s, ry * at.s, fill, alpha)

/** A ridge across `from` to `to` (stop units), `up` high give or take `vary`, filled down to the horizon. */
const ridge = (at: At, from: number, to: number, up: number, vary: number, fill: string, seed: number, grad?: Gradient): Shape => {
  const points: Point[] = [[from, -0.2]]
  for (let dx = from; dx <= to; dx += 3) {
    const k = (dx - from) / (to - from)
    const edge = Math.sin(Math.PI * k) ** 0.6
    points.push([dx, (up + vary * (Math.sin(dx / 7 + seed) * 0.6 + Math.sin(dx / 3.1 + seed * 2) * 0.4)) * edge])
  }
  points.push([to, -0.2])

  return poly(placer(at)(points), fill, 1, grad)
}

/** Water from `from` to `to` (stop units), `deep` up from the horizon. */
const water = (at: At, from: number, to: number, deep: number, fill: string): Shape[] => [box(at, from, 0, to, deep, fill), box(at, from, deep - 0.25, to, deep, '#ffffff', 0.18)]

const glints = (at: At, from: number, to: number, deep: number, now: number, colour = '#ffffff'): Shape[] =>
  Array.from({ length: Math.ceil((to - from) / 9) }, (_, i) => {
    const dx = from + 4 + i * 9 + 2 * Math.sin(now / 1500 + i * 1.7)
    const up = deep * (0.25 + 0.5 * rnd('glint', i, Math.floor(from)))

    return line(placer(at)([[dx - 1.2, up], [dx + 1.2, up]]), 0.18 * at.s, colour, 0.35 + 0.3 * Math.sin(now / 600 + i))
  })

const palm = (at: At, dx: number, h: number, trunk = '#6a4a32', leaf = '#2f6a3a'): Shape[] => {
  const p = placer(at)
  const top: Point = [dx + 1.2, h]
  const fronds = [[-4, h - 1.6], [-3, h + 1], [0, h + 1.6], [3, h + 1.2], [4.2, h - 1.4], [2, h - 2.2], [-2, h - 2.4]] as const

  return [
    line(p([[dx, 0], [dx + 0.6, h * 0.5], top]), 0.55 * at.s, trunk),
    ...fronds.map(([fx, fy]) => line(p([top, [dx + 1.2 + fx * 0.55, (h + fy) / 2 + 0.6], [dx + 1.2 + fx, fy]]), 0.5 * at.s, leaf)),
  ]
}

const cypress = (at: At, dx: number, h: number, fill = '#2a4a32'): Shape => poly(placer(at)([[dx - 0.9, 0.3], [dx - 1, h * 0.4], [dx - 0.4, h * 0.85], [dx, h], [dx + 0.4, h * 0.85], [dx + 1, h * 0.4], [dx + 0.9, 0.3]]), fill)

const roundTree = (at: At, dx: number, h: number, crown: string, lit: string, trunk = '#4a3428'): Shape[] => [
  box(at, dx - 0.35, 0, dx + 0.35, h * 0.55, trunk),
  dot(at, dx - h * 0.2, h * 0.62, h * 0.3, h * 0.24, crown),
  dot(at, dx + h * 0.22, h * 0.6, h * 0.28, h * 0.23, crown),
  dot(at, dx, h * 0.76, h * 0.34, h * 0.26, crown),
  dot(at, dx - h * 0.1, h * 0.84, h * 0.17, h * 0.12, lit, 0.85),
]

const pine = (at: At, dx: number, h: number, fill: string, snow = 0): Shape[] => {
  const p = placer(at)
  const shapes: Shape[] = [box(at, dx - 0.3, 0, dx + 0.3, 1.2, '#3a2a24')]
  for (let tier = 0; tier < 3; tier += 1) {
    const base = 0.8 + tier * h * 0.25
    const half = h * 0.28 * (1 - tier * 0.25)
    const tip = base + h * 0.4
    shapes.push(poly(p([[dx - half, base], [dx, tip], [dx + half, base]]), fill))
    if (snow > 0) shapes.push(poly(p([[dx - half * 0.5, tip - (tip - base) * 0.5], [dx, tip], [dx + half * 0.5, tip - (tip - base) * 0.5], [dx, tip - (tip - base) * 0.3]]), '#eef4ff', snow))
  }

  return shapes
}

/** Buildings in a row from `from` to `to`, `low` to `high` tall, windows lit by `lit` (0 none). */
const skyline = (at: At, from: number, to: number, low: number, high: number, fill: string, window: string, lit: number, seed: number): Shape[] => {
  const towers: Shape[] = []
  const windows: Shape[] = []
  for (let dx = from, i = 0; dx < to; i += 1) {
    const w = 2.4 + 2.4 * rnd('tower-w', seed, i)
    const h = low + (high - low) * rnd('tower-h', seed, i) ** 1.6
    towers.push(box(at, dx, 0, Math.min(to, dx + w), h, fill))
    for (let wy = 1; lit > 0 && wy < h - 0.8; wy += 1.2) {
      for (let wx = dx + 0.5; wx < Math.min(to, dx + w) - 0.5; wx += 1) if (rnd('window', seed, i, wx, wy) < 0.45) windows.push(box(at, wx, wy, wx + 0.45, wy + 0.5, window, lit))
    }
    dx += w + 0.3
  }

  return [...towers, ...windows]
}

/** Birds crossing the sky, wings beating. */
const birds = (at: At, now: number): Shape[] =>
  [0, 1, 2].map(i => {
    const dx = mod(now / 260 + i * 37 + 9 * rnd('bird', i), 120) - 60
    const up = 14 + 2.5 * i + Math.sin(now / 1100 + i) * 0.8
    const flap = Math.sin(now / 140 + i * 2) * 0.55

    return line(placer(at)([[dx - 0.9, up + flap], [dx, up], [dx + 0.9, up + flap]]), 0.2 * at.s, '#2a2a36', 0.8)
  })

/** Mist drifting along the slopes. */
const mist = (at: At, now: number, up: number, colour = '#ffffff'): Shape[] =>
  [0, 1, 2].map(i => dot(at, mod(now / 400 + i * 41, 110) - 55, up + i * 2.2, 14, 1.3, colour, 0.22))

// --- the stops -------------------------------------------------------------------

const eiffel = (at: At): Shape[] => {
  const p = placer(at)
  const iron = '#b07a4a'
  const lit = '#e8b06a'
  const lattice = '#6a4632'
  const shapes: Shape[] = [
    poly(p([[-5, 0], [-3.4, 2.6], [-2.2, 5.2], [2.2, 5.2], [3.4, 2.6], [5, 0], [3, 0], [1.6, 2.5], [0, 3.1], [-1.6, 2.5], [-3, 0]]), iron),
    poly(p([[-2.1, 5.8], [-1.1, 10.6], [1.1, 10.6], [2.1, 5.8]]), iron),
    poly(p([[-0.95, 11.1], [-0.32, 17.2], [0.32, 17.2], [0.95, 11.1]]), iron),
    poly(p([[0.4, 5.2], [2.2, 5.2], [3.4, 2.6], [5, 0], [3, 0], [1.6, 2.5]]), lit, 0.55),
    box(at, -2.8, 5.1, 2.8, 5.9, lattice),
    box(at, -1.5, 10.5, 1.5, 11.1, lattice),
    box(at, -0.45, 17.1, 0.45, 17.8, lattice),
    line(p([[0, 17.8], [0, 19.2]]), 0.18 * at.s, lattice),
  ]
  for (const [from, to] of [[[-4.2, 1.2], [-2.4, 5]], [[4.2, 1.2], [2.4, 5]], [[-1.8, 6.2], [-0.7, 10.4]], [[1.8, 6.2], [0.7, 10.4]], [[-0.8, 11.5], [0.6, 16.8]], [[0.8, 11.5], [-0.6, 16.8]]] as const) shapes.push(line(p([from, to]), 0.12 * at.s, lattice, 0.6))

  return shapes
}

/** Paris's rooftops: cream walls, grey mansards, lit windows. */
const haussmann = (at: At, from: number, to: number): Shape[] => {
  const walls: Shape[] = []
  const windows: Shape[] = []
  for (let dx = from; dx < to; dx += 7.4) {
    walls.push(box(at, dx, 0, dx + 7, 4.8, '#cdb898'), poly(placer(at)([[dx - 0.2, 4.8], [dx + 0.6, 6.2], [dx + 6.4, 6.2], [dx + 7.2, 4.8]]), '#5c6478'))
    for (let wx = dx + 0.8; wx < dx + 6.6; wx += 1.5) for (const wy of [1, 2.6]) windows.push(box(at, wx, wy, wx + 0.6, wy + 0.9, '#ffd48a', 0.8))
  }

  return [...walls, ...windows]
}

const bigBen = (at: At): Shape[] => {
  const p = placer(at)
  const stone = '#c2a266'
  const shade = '#9a7c48'
  const shapes: Shape[] = [
    // Westminster's long front, its pinnacles, and the Victoria Tower at its end.
    box(at, 2, 0, 24, 6, stone),
    box(at, 2, 0, 24, 0.8, shade),
    box(at, 22, 0, 26, 12.5, stone),
    poly(p([[21.6, 12.5], [24, 14], [26.4, 12.5]]), '#4c5262'),
    box(at, -1.7, 0, 1.7, 11.6, stone),
    box(at, 0.2, 0, 1.7, 11.6, shade, 0.6),
    box(at, -2.1, 11.6, 2.1, 14.6, '#d6b878'),
    box(at, -1.8, 14.6, 1.8, 16, stone),
    poly(p([[-2, 16], [0, 19.6], [2, 16]]), '#4c5262'),
    line(p([[0, 19.6], [0, 20.4]]), 0.16 * at.s, '#e8c060'),
    dot(at, 0, 13.1, 1.45, 1.45, '#f4ecd0'),
    dot(at, 0, 13.1, 1.75, 1.75, '#e8c060', 0.25),
  ]
  for (let dx = 3; dx < 22; dx += 1.6) shapes.push(poly(p([[dx - 0.3, 6], [dx, 7.4], [dx + 0.3, 6]]), shade))
  for (let dx = 3.2; dx < 21.5; dx += 1.6) for (const up of [1.6, 3.6]) shapes.push(box(at, dx, up, dx + 0.5, up + 1.2, '#ffd890', 0.55))
  for (const dx of [-1.2, -0.4, 0.4, 1.2]) shapes.push(line(p([[dx, 1], [dx, 11]]), 0.1 * at.s, shade, 0.7))

  return shapes
}

/** Its clock at the local time, and a red bus going by. */
const bigBenMoving = (at: At, now: number): Shape[] => {
  const p = placer(at)
  const time = new Date(now)
  const minutes = time.getMinutes() + time.getSeconds() / 60
  const hours = (time.getHours() % 12) + minutes / 60
  const hand = (turns: number, length: number): Shape => line(p([[0, 13.1], [Math.sin(turns * 2 * Math.PI) * length, 13.1 + Math.cos(turns * 2 * Math.PI) * length]]), 0.18 * at.s, '#2a2a30')
  const bus = mod(now / 90, 140) - 70

  return [
    hand(hours / 12, 0.75),
    hand(minutes / 60, 1.15),
    box(at, bus, 0.4, bus + 6, 3.6, '#d43a30'),
    box(at, bus + 0.4, 2.3, bus + 5.6, 3.1, '#ffe2a0', 0.7),
    box(at, bus + 0.4, 1.2, bus + 5.6, 1.9, '#ffe2a0', 0.7),
    dot(at, bus + 1.2, 0.45, 0.55, 0.55, '#202024'),
    dot(at, bus + 4.8, 0.45, 0.55, 0.55, '#202024'),
  ]
}

const windmill = (at: At, dx: number, h: number): Shape[] => {
  const p = placer(at)

  return [
    poly(p([[dx - 1.8 * h, 0], [dx - 1.05 * h, 6.6 * h], [dx + 1.05 * h, 6.6 * h], [dx + 1.8 * h, 0]]), '#4a3e3a'),
    poly(p([[dx + 0.1 * h, 0], [dx + 1.05 * h, 6.6 * h], [dx + 1.8 * h, 0]]), '#ffffff', 0.08),
    poly(p([[dx - 1.4 * h, 6.6 * h], [dx - 0.8 * h, 7.9 * h], [dx + 0.8 * h, 7.9 * h], [dx + 1.4 * h, 6.6 * h]]), '#6a5a48'),
    box(at, dx - 0.5 * h, 0, dx + 0.5 * h, 1.8 * h, '#2a2220'),
    box(at, dx - 2.2 * h, 2.8 * h, dx + 2.2 * h, 3.2 * h, '#3a302c'),
  ]
}

const sails = (at: At, dx: number, h: number, now: number, speed: number): Shape[] => {
  const hub: Point = [at.x + dx * at.s, at.y - 7.2 * h * at.s]
  const shapes: Shape[] = []
  for (let i = 0; i < 4; i += 1) {
    const a = (now / speed) * 2 * Math.PI + (i * Math.PI) / 2
    const along = (r: number, side: number): Point => [hub[0] + (Math.cos(a) * r - Math.sin(a) * side) * h * at.s, hub[1] + (Math.sin(a) * r + Math.cos(a) * side) * h * at.s]
    shapes.push(line([hub, along(6.4, 0)], 0.22 * at.s, '#3a2e2a'), poly([along(1.6, 0.15), along(6.4, 0.15), along(6.4, 1.4), along(1.6, 1.1)], '#f2ead8', 0.92))
  }

  return shapes
}

/** The tulip fields: stripes of red, yellow, pink and orange running back to the horizon, the nearer ones wider. */
const tulips = (at: At, from: number, to: number): Shape[] => {
  const colours = ['#e2384a', '#f6c832', '#f27aa8', '#f28a2a']
  const deep = (at.bottom - at.y) / at.s
  const shapes: Shape[] = []
  for (let row = 0, down = 0.7; row < 7 && down < deep; row += 1, down += 1.4 + row * 0.5) {
    const up = -down
    const thick = 0.6 + row * 0.22
    shapes.push(poly(placer(at)([[from, up + thick / 2], [to, up + thick / 2], [to, up - thick / 2], [from, up - thick / 2]]), colours[row % colours.length] as string, 0.85))
  }

  return shapes
}

const canalHouses = (at: At, from: number): Shape[] => {
  const colours = ['#8a3a2a', '#2e4a3e', '#c8b490', '#3a4a6a', '#6a2a2a']

  return colours.flatMap((colour, i) => {
    const dx = from + i * 3.3
    const h = 6 + (i % 3)

    return [
      poly(placer(at)([[dx, 0], [dx, h], [dx + 0.6, h], [dx + 0.6, h + 0.7], [dx + 1.2, h + 0.7], [dx + 1.2, h + 1.4], [dx + 1.9, h + 1.4], [dx + 1.9, h + 0.7], [dx + 2.5, h + 0.7], [dx + 2.5, h], [dx + 3.1, h], [dx + 3.1, 0]]), colour),
      ...[1.4, 3.2, 5].filter(up => up < h - 0.4).flatMap(up => [box(at, dx + 0.5, up, dx + 1.2, up + 1, '#f6f0e2', 0.85), box(at, dx + 1.9, up, dx + 2.6, up + 1, '#f6f0e2', 0.85)]),
    ]
  })
}

const colosseum = (at: At): Shape[] => {
  const p = placer(at)
  const stone = '#dcbc8c'
  const shapes: Shape[] = [
    // The inner wall seen over the broken side, then the outer wall, whole on the left and fallen on the right.
    poly(p([[-6, 0], [-6, 7.2], [10, 7.2], [12, 0]]), '#b89668'),
    poly(p([[-13, 0], [-13, 9], [2, 9], [3.5, 8], [5, 8.4], [7, 6.2], [9, 5.4], [11, 3.2], [13, 2.4], [13, 0]]), stone),
    box(at, -13, 8.4, 2, 9, '#c4a274'),
  ]
  for (const [up, top] of [[0.4, 2.6], [3, 5.2], [5.6, 7.8]] as const) {
    for (let dx = -12.3; dx < 12.5; dx += 1.9) {
      const roof = 9 - (dx > 2 ? (dx - 2) * 0.6 : 0)
      if (top + 0.3 > roof) continue
      shapes.push(rect(at.x + dx * at.s, at.y - top * at.s, 1.05 * at.s, (top - up) * at.s, '#7a5434', 0.85, 0.5 * at.s))
    }
  }

  return shapes
}

const umbrellaPine = (at: At, dx: number, h: number): Shape[] => [line(placer(at)([[dx, 0], [dx + 0.4, h * 0.7], [dx + 0.9, h - 0.6]]), 0.45 * at.s, '#5a3e2c'), dot(at, dx + 0.9, h, 3.6, 1.3, '#3e5a34'), dot(at, dx + 0.3, h + 0.4, 2.2, 0.8, '#5a7a44', 0.8)]

const pyramid = (at: At, dx: number, w: number, h: number, cap = false): Shape[] => {
  const p = placer(at)

  return [
    poly(p([[dx - w, 0], [dx, h], [dx + w * 0.3, 0]]), '#e6c07a'),
    poly(p([[dx + w * 0.3, 0], [dx, h], [dx + w, 0]]), '#b4884a'),
    ...(cap ? [poly(p([[dx - w * 0.12, h * 0.88], [dx, h], [dx + w * 0.12, h * 0.88]]), '#f4e4c0')] : []),
  ]
}

const sphinx = (at: At, dx: number): Shape => poly(placer(at)([[dx - 5, 0], [dx - 5, 1.4], [dx - 1.8, 1.8], [dx - 1.4, 2.6], [dx - 1.2, 4], [dx - 0.2, 4.4], [dx + 0.6, 3.8], [dx + 0.9, 2.4], [dx + 2.6, 1], [dx + 3, 0]]), '#c4964e')

const tajMahal = (at: At): Shape[] => {
  const p = placer(at)
  const marble = '#f6e4dc'
  const shade = '#d8bcb6'
  const onion = (dx: number, base: number, r: number, h: number): Shape => poly(p([[dx - r * 0.7, base], [dx - r, base + h * 0.35], [dx - r * 0.85, base + h * 0.6], [dx - r * 0.35, base + h * 0.85], [dx, base + h], [dx + r * 0.35, base + h * 0.85], [dx + r * 0.85, base + h * 0.6], [dx + r, base + h * 0.35], [dx + r * 0.7, base]]), marble)
  const shapes: Shape[] = [box(at, -12.5, 0, 12.5, 1.2, shade)]
  for (const dx of [-11.6, 11.6]) shapes.push(poly(p([[dx - 0.55, 1.2], [dx - 0.4, 9.6], [dx + 0.4, 9.6], [dx + 0.55, 1.2]]), marble), onion(dx, 9.6, 0.7, 1.4), box(at, dx - 0.65, 4.6, dx + 0.65, 4.9, shade), box(at, dx - 0.65, 7.4, dx + 0.65, 7.7, shade))
  shapes.push(
    box(at, -6.4, 1.2, 6.4, 7, marble),
    box(at, 3, 1.2, 6.4, 7, shade, 0.5),
    poly(p([[-1.7, 1.2], [-1.7, 5], [0, 6.2], [1.7, 5], [1.7, 1.2]]), '#b89c98'),
    ...[-4.6, 4.6].flatMap(dx => [poly(p([[dx - 0.9, 1.6], [dx - 0.9, 3.4], [dx, 4], [dx + 0.9, 3.4], [dx + 0.9, 1.6]]), '#c8aca6'), poly(p([[dx - 0.9, 4.4], [dx - 0.9, 5.8], [dx, 6.3], [dx + 0.9, 5.8], [dx + 0.9, 4.4]]), '#c8aca6')]),
    box(at, -2.7, 7, 2.7, 7.8, marble),
    onion(0, 7.8, 3.3, 5),
    line(p([[0, 12.8], [0, 13.8]]), 0.16 * at.s, '#d8a850'),
    onion(-4.6, 7, 1, 1.8),
    onion(4.6, 7, 1, 1.8),
    // Its pool, narrowing to the horizon, the sunset in it.
    poly(p([[-1.2, -0.2], [1.2, -0.2], [2.6, (at.y - at.bottom) / at.s], [-2.6, (at.y - at.bottom) / at.s]]), '#7a6aa0'),
    poly(p([[-0.5, -0.4], [0.5, -0.4], [1, (at.y - at.bottom) / at.s * 0.6], [-1, (at.y - at.bottom) / at.s * 0.6]]), '#f6c6a8', 0.4),
  )
  for (const dx of [-20, -16, 16, 20]) shapes.push(cypress(at, dx, 6, '#2e4632'))

  return shapes
}

const greatWall = (at: At): Shape[] => {
  const p = placer(at)
  const crest = (dx: number): number => 5 + 3.2 * Math.sin(dx / 9 + 0.6) + 1.4 * Math.sin(dx / 4.3)
  const path: Point[] = []
  for (let dx = -55; dx <= 55; dx += 1.5) path.push([dx, crest(dx) + 0.6])
  const shapes: Shape[] = [
    ridge(at, -55, 55, 13, 3, '#a8a4c4', 1),
    ridge(at, -55, 55, 9.5, 2.4, '#7a86a8', 4),
    poly(p([[-55, -0.2], ...path.map(([dx, up]): Point => [dx, up - 0.6]), [55, -0.2]]), '#4c6a56'),
    line(p(path), 1.3 * at.s, '#b8a888'),
    line(p(path.map(([dx, up]): Point => [dx, up - 0.55])), 0.3 * at.s, '#8a7a5c'),
  ]
  for (let dx = -54; dx < 54; dx += 1.5) shapes.push(box(at, dx, crest(dx) + 1.1, dx + 0.6, crest(dx) + 1.6, '#b8a888'))
  for (const dx of [-38, -12, 15, 41]) {
    const up = crest(dx) + 0.4
    shapes.push(box(at, dx - 1.4, up, dx + 1.4, up + 3, '#c8b898'), box(at, dx - 0.4, up + 0.8, dx + 0.4, up + 1.9, '#5a4a3a'), box(at, dx - 1.6, up + 3, dx + 1.6, up + 3.5, '#a89878'))
  }

  return shapes
}

const fuji = (at: At): Shape[] => {
  const p = placer(at)
  const shapes: Shape[] = [
    poly(p([[-30, 0], [-12, 7], [-4.2, 13], [4.2, 13.2], [12, 7], [30, 0]]), '#5c6aa4'),
    poly(p([[0.5, 13.2], [4.2, 13.2], [12, 7], [30, 0], [8, 0]]), '#4a5690', 0.6),
    poly(p([[-8.6, 8.8], [-6.4, 8], [-5, 8.9], [-3.4, 7.7], [-1.8, 8.8], [0.2, 7.6], [2.2, 8.7], [3.8, 7.8], [5.6, 8.9], [7.4, 8.2], [8.8, 8.9], [4.2, 13.2], [-4.2, 13]]), '#f4f6fc'),
  ]
  // A five-storeyed pagoda.
  for (let tier = 0; tier < 5; tier += 1) {
    const up = 0.5 + tier * 2.1
    const half = 2.4 - tier * 0.3
    shapes.push(box(at, -16 - half * 0.6, up, -16 + half * 0.6, up + 1.4, '#b8452e'), poly(p([[-16 - half - 0.8, up + 1.2], [-16 - half, up + 1.7], [-16 + half, up + 1.7], [-16 + half + 0.8, up + 1.2]]), '#3a2a2e'))
  }
  shapes.push(line(p([[-16, 11], [-16, 13]]), 0.2 * at.s, '#3a2a2e'))
  // A torii.
  shapes.push(box(at, 13, 0, 13.7, 7, '#d8432a'), box(at, 18.3, 0, 19, 7, '#d8432a'), box(at, 12.4, 5.4, 19.6, 6, '#d8432a'), poly(p([[11.4, 7.4], [12.2, 6.8], [19.8, 6.8], [20.6, 7.4], [20.4, 7.9], [11.6, 7.9]]), '#2a2226'))
  for (const [dx, h] of [[-24, 6], [-8, 5.4], [24, 6.4]] as const) shapes.push(...roundTree(at, dx, h, '#f2a6c4', '#fbd4e4'))

  return shapes
}

const operaHouse = (at: At): Shape[] => {
  const p = placer(at)
  const shell = (dx: number, w: number, h: number, lean: number): Shape[] => {
    const tip: Point = [dx + lean, h]
    const curve: Point[] = Array.from({ length: 7 }, (_, i) => {
      const t = i / 6

      return [dx + (lean + 0.2 * w) * Math.sin((t * Math.PI) / 2) - 0.1 * w * t, 1.6 + (h - 1.6) * Math.sin((t * Math.PI) / 2)]
    })

    return [poly(p([[dx, 1.6], ...curve, tip, [dx + w, 1.6]]), '#f6f4ee'), line(p([[dx + w * 0.55, 1.6], tip]), 0.12 * at.s, '#c8ccd4', 0.8)]
  }

  return [
    ...water(at, -55, 55, 2.2, '#2c6aa6'),
    box(at, -12, 0, 10, 1.8, '#c8b8a0'),
    ...shell(-11, 4, 6.4, 3.6),
    ...shell(-7, 4.4, 8.2, 3.8),
    ...shell(-2.6, 4.2, 7.2, 3.4),
    ...shell(1.8, 3.4, 5.6, 2.8),
    ...shell(5, 3, 4.2, 2.4),
    // The Harbour Bridge: its arch, its deck, its pylons.
    line(p(Array.from({ length: 13 }, (_, i): Point => [18 + i * 2, 3 + 6.4 * Math.sin((i / 12) * Math.PI)])), 0.7 * at.s, '#6a7282'),
    line(p([[15, 3], [45, 3]]), 0.5 * at.s, '#5a6272'),
    ...Array.from({ length: 11 }, (_, i) => line(p([[20 + i * 2, 3], [20 + i * 2, 3 + 6.4 * Math.sin(((i + 1) / 12) * Math.PI)]]), 0.1 * at.s, '#6a7282', 0.7)),
    box(at, 15.5, 0, 18, 5.4, '#a8a090'),
    box(at, 42, 0, 44.5, 5.4, '#a8a090'),
  ]
}

const moai = (at: At, dx: number, h: number): Shape[] => [
  box(at, dx - 1.1, 0.8, dx + 1.1, 0.8 + h * 0.55, '#4e403e'),
  poly(placer(at)([[dx - 1.3, 0.8 + h * 0.5], [dx - 1.25, 0.8 + h], [dx + 1.25, 0.8 + h], [dx + 1.3, 0.8 + h * 0.5]]), '#5a4a46'),
  box(at, dx - 1.3, 0.8 + h * 0.74, dx + 1.3, 0.8 + h * 0.82, '#2e2626'),
  box(at, dx - 0.3, 0.8 + h * 0.5, dx + 0.3, 0.8 + h * 0.76, '#3a302e'),
  box(at, dx + 0.6, 0.8 + h * 0.2, dx + 1.3, 0.8 + h, '#f2a060', 0.25),
]

const corcovado = (at: At): Shape[] => {
  const p = placer(at)

  return [
    ...water(at, 2, 55, 2, '#3a3a7a'),
    poly(p([[-30, 0], [-16, 6], [-9, 12.4], [-6.6, 13.2], [-4.4, 12], [2, 5], [10, 0]]), '#2a3a3a'),
    poly(p([[10, 0], [12, 5], [15, 8.4], [18, 8.8], [20.6, 7], [22.6, 2.4], [24, 0]]), '#2e3c40'),
    // The statue, arms out.
    box(at, -6.85, 13.2, -6.35, 15.4, '#f4eee4'),
    box(at, -8.2, 14.6, -5, 15, '#f4eee4'),
    dot(at, -6.6, 15.75, 0.35, 0.35, '#f4eee4'),
    dot(at, -6.6, 14.8, 2.4, 1.6, '#fff4dc', 0.18),
    ...palm(at, -40, 6, '#3a2a22', '#1e3a2a'),
    ...palm(at, 33, 5.4, '#3a2a22', '#1e3a2a'),
  ]
}

const machuPicchu = (at: At): Shape[] => {
  const p = placer(at)
  const shapes: Shape[] = [
    ridge(at, -55, 55, 10, 2.2, '#5a7a8a', 2),
    poly(p([[-6, 0], [2, 9], [5, 14.4], [7.6, 15], [10, 13], [14, 6], [20, 0]]), '#3a6a46'),
    poly(p([[6, 15], [7.6, 15], [10, 13], [14, 6], [20, 0], [12, 0]]), '#2a5236', 0.7),
    poly(p([[-30, 0], [-22, 3.4], [-6, 3.6], [0, 0]]), '#5a8a52'),
  ]
  for (let row = 0; row < 4; row += 1) shapes.push(line(p([[-27 + row * 2, 0.6 + row * 0.8], [-6 - row * 0.8, 0.6 + row * 0.8]]), 0.25 * at.s, '#a8a094'))
  for (const dx of [-19, -15.6, -12.2, -9]) shapes.push(box(at, dx, 3.4, dx + 2.6, 5.2, '#a8a094'), poly(p([[dx, 5.2], [dx + 1.3, 6.4], [dx + 2.6, 5.2]]), '#8a8478'))
  // A llama.
  shapes.push(dot(at, -36, 1.8, 1.6, 0.9, '#f2ead8'), line(p([[-34.8, 2.2], [-34.4, 4]]), 0.45 * at.s, '#f2ead8'), dot(at, -34.2, 4.1, 0.55, 0.35, '#f2ead8'), ...[-37, -36.4, -35.6, -35].map(dx => line(p([[dx, 1.2], [dx, 0]]), 0.22 * at.s, '#f2ead8')))

  return shapes
}

const liberty = (at: At): Shape[] => {
  const p = placer(at)

  return [
    ...skyline(at, -52, 4, 3, 12, '#1a2444', '#ffd78a', 0.75, 7),
    box(at, -27.6, 0, -24.4, 13, '#1e2848'),
    box(at, -26.8, 13, -25.2, 15.6, '#1e2848'),
    line(p([[-26, 15.6], [-26, 18]]), 0.2 * at.s, '#1e2848'),
    ...water(at, -55, 55, 2.4, '#16244a'),
    // Liberty on her pedestal, her torch up.
    poly(p([[10.6, 0], [11.2, 3.6], [15.8, 3.6], [16.4, 0]]), '#8a8270'),
    box(at, 12.2, 3.6, 14.8, 5.6, '#9a927e'),
    poly(p([[12.4, 5.6], [12.9, 9.8], [13.3, 11.6], [14.1, 11.6], [14.4, 9.6], [14.6, 5.6]]), '#5ea48e'),
    line(p([[14.1, 10.6], [14.9, 12.6], [15.1, 14.2]]), 0.42 * at.s, '#5ea48e'),
    dot(at, 13.7, 12.2, 0.6, 0.6, '#5ea48e'),
    ...[-0.8, -0.4, 0, 0.4, 0.8].map(k => line(p([[13.7, 12.5], [13.7 + k * 1.5, 13.6 - Math.abs(k) * 0.4]]), 0.14 * at.s, '#5ea48e')),
    poly(p([[12.6, 8.6], [12.2, 9.8], [12.9, 9.9]]), '#4a8c78'),
  ]
}

const libertyTorch = (at: At, now: number): Shape[] => {
  const flicker = 0.8 + 0.2 * Math.sin(now / 90) * Math.sin(now / 37)

  return [dot(at, 15.1, 14.6, 2.4, 2, '#ffc860', 0.18 * flicker), dot(at, 15.1, 14.6, 0.5, 0.65 * flicker, '#ffd060')]
}

const stBasil = (at: At): Shape[] => {
  const p = placer(at)
  const shapes: Shape[] = []
  const onion = (dx: number, base: number, r: number, h: number, colour: string, stripe: string): void => {
    shapes.push(poly(p([[dx - r * 0.6, base], [dx - r, base + h * 0.35], [dx - r * 0.7, base + h * 0.65], [dx, base + h], [dx + r * 0.7, base + h * 0.65], [dx + r, base + h * 0.35], [dx + r * 0.6, base]]), colour))
    for (const k of [-0.5, 0, 0.5]) shapes.push(line(p([[dx + k * r, base + 0.2], [dx + k * r * 0.5, base + h * 0.6], [dx, base + h]]), 0.22 * at.s, stripe, 0.8))
    shapes.push(line(p([[dx, base + h], [dx, base + h + 1]]), 0.12 * at.s, '#e8c060'))
  }
  shapes.push(box(at, -12, 0, 12, 4, '#b84a3a'), box(at, -12, 3.6, 12, 4, '#f2eee4'))
  // The tall tent of the middle, its tower, its snow.
  shapes.push(box(at, -1.6, 4, 1.6, 9, '#c85a44'), poly(p([[-1.8, 9], [0, 16], [1.8, 9]]), '#d8c09a'), poly(p([[-1.8, 9], [-0.6, 13], [0, 9]]), '#2e7a5a', 0.6), dot(at, 0, 16.4, 0.5, 0.5, '#e8c060'))
  for (const [dx, base, r, h, colour, stripe] of [[-8.6, 7, 1.6, 3.4, '#2e8a5a', '#f2eee4'], [-4.4, 8.4, 1.5, 3.2, '#d8402e', '#f2eee4'], [4.4, 8.4, 1.5, 3.2, '#2e5ab8', '#f6d24a'], [8.6, 7, 1.6, 3.4, '#e8a02e', '#2e8a5a']] as const) {
    shapes.push(box(at, dx - 1.1, 3.6, dx + 1.1, base, '#c85a44'), box(at, dx - 1.1, base - 0.5, dx + 1.1, base, '#f2eee4'))
    onion(dx, base, r, h, colour, stripe)
  }
  for (const dx of [-11, -6.4, 6.4, 11]) shapes.push(poly(p([[dx - 1.4, 4], [dx, 4.6], [dx + 1.4, 4]]), '#f4f8ff', 0.85))

  return shapes
}

const aurora = (at: At, now: number): Shape[] =>
  [0, 1, 2].map(i => {
    const top: Point[] = []
    const bottom: Point[] = []
    for (let dx = -60; dx <= 60; dx += 4) {
      const wave = Math.sin(dx / 11 + now / (2400 + i * 700) + i * 2) * 2 + Math.sin(dx / 5 - now / 1900) * 0.7
      top.push([dx, 17 - i * 1.5 + wave])
      bottom.push([dx, 11.5 - i * 1.2 + wave * 0.7])
    }
    const colour = ['#5cf2a0', '#4ae0c0', '#a080f0'][i] as string

    return poly(placer(at)([...bottom, ...top.reverse()]), colour, 1, { x1: 0, y1: at.y - 17 * at.s, x2: 0, y2: at.y - 11 * at.s, stops: [[0, colour, 0], [0.7, colour, 0.28], [1, colour, 0.5]] })
  })

const fjord = (at: At): Shape[] => {
  const p = placer(at)

  return [
    poly(p([[-55, 0], [-40, 7], [-30, 10.6], [-22, 6], [-14, 8.8], [-4, 0]]), '#8a9cc0'),
    poly(p([[-44, 4.8], [-40, 7], [-30, 10.6], [-26, 8.2], [-32, 8.6], [-38, 6.2]]), '#f2f6ff', 0.9),
    poly(p([[6, 0], [18, 8], [26, 12], [36, 7.4], [55, 0]]), '#7a8cb4'),
    poly(p([[14, 5.4], [18, 8], [26, 12], [30, 9.8], [24, 9.4], [19, 6.6]]), '#f2f6ff', 0.9),
    ...[-12, -9, 22, 26, 29].flatMap(dx => pine(at, dx, 5 + 1.5 * rnd('fjord', dx), '#1e3638', 0.9)),
    box(at, 1, 0, 7, 3.6, '#a8322a'),
    poly(p([[0.4, 3.4], [4, 5.8], [7.6, 3.4]]), '#f2f6ff'),
    box(at, 2.2, 1.2, 3.6, 2.4, '#ffd27a'),
    dot(at, 2.9, 1.8, 2.4, 1.6, '#ffd27a', 0.15),
  ]
}

const savanna = (at: At): Shape[] => {
  const p = placer(at)
  const acacia = (dx: number, h: number): Shape[] => [line(p([[dx, 0], [dx - 0.3, h * 0.6], [dx - 1.6, h]]), 0.4 * at.s, '#2a1a1a'), line(p([[dx - 0.3, h * 0.6], [dx + 1.4, h]]), 0.35 * at.s, '#2a1a1a'), dot(at, dx, h + 0.4, 4.4, 0.9, '#2a1a1a'), dot(at, dx + 0.6, h + 0.9, 2.8, 0.6, '#2a1a1a')]
  const giraffe = (dx: number, k: number): Shape[] => [dot(at, dx, 4.4 * k, 1.5 * k, 0.8 * k, '#2a1a1a'), line(p([[dx + 1 * k, 4.6 * k], [dx + 2.2 * k, 8 * k]]), 0.45 * at.s * k, '#2a1a1a'), dot(at, dx + 2.5 * k, 8.1 * k, 0.6 * k, 0.32 * k, '#2a1a1a'), ...[-1, -0.6, 0.6, 1].map(lx => line(p([[dx + lx * k, 4 * k], [dx + lx * k * 1.1, 0]]), 0.22 * at.s, '#2a1a1a'))]

  return [
    poly(p([[-40, 0], [-18, 6.4], [-12, 7.2], [-6, 6.6], [16, 0]]), '#8a5a6a'),
    poly(p([[-17, 5.8], [-12, 7.2], [-6.6, 6.6], [-9, 6.2], [-12, 6.6], [-14.6, 5.8]]), '#f6e8e4', 0.85),
    ...acacia(-26, 4.4),
    ...acacia(20, 5.4),
    ...acacia(38, 3.8),
    ...giraffe(6, 1),
    ...giraffe(11, 0.8),
  ]
}

const chichen = (at: At): Shape[] => {
  const p = placer(at)
  const shapes: Shape[] = [ridge(at, -55, 55, 4.4, 1.2, '#2e5a34', 5)]
  for (let step = 0; step < 6; step += 1) shapes.push(box(at, -10 + step * 1.3, step * 1.3, 10 - step * 1.3, step * 1.3 + 1.3, step % 2 === 0 ? '#c8b890' : '#b8a880'))
  shapes.push(poly(p([[-1.3, 0], [-1.3, 7.8], [1.3, 7.8], [1.3, 0]]), '#a89870'), box(at, -2.6, 7.8, 2.6, 10.2, '#c8b890'), box(at, -0.7, 7.8, 0.7, 9.4, '#3a3028'), box(at, -2.9, 10.2, 2.9, 10.7, '#a89870'))
  for (const dx of [-30, -22, 18, 27, 36]) shapes.push(...roundTree(at, dx, 5 + 2 * rnd('jungle', dx), '#2e6a3a', '#4a8a4a'))

  return shapes
}

const STOPS: readonly Stop[] = [
  { name: 'PARIS · FRANCE', sky: ['#1a1c48', '#4a3a7c', '#c46a8c', '#f4a868'], body: { x: 0.78, y: 0.82, r: 2.6, colour: '#ffb070' }, night: 0.4, cloud: '#e8a0a8', ground: '#4a5240', floor: 'grass', weather: 'leaves', draw: at => [...haussmann(at, -54, -14), ...haussmann(at, 14, 54), ...roundTree(at, -12, 6, '#d87a32', '#f0b04a'), ...roundTree(at, 12, 5.6, '#c8522e', '#e8903a'), ...eiffel(at)], moving: (at, now) => Array.from({ length: 10 }, (_, i) => dot(at, (rnd('sparkle-x', i) - 0.5) * (5 - rnd('sparkle-y', i) * 4.4), 1 + rnd('sparkle-y', i) * 17, 0.22, 0.22, '#ffffff', Math.max(0, Math.sin(now / 200 + i * 7)))) },
  { name: 'LONDON · UK', sky: ['#262c3a', '#3e4656', '#646e80', '#8a92a0'], night: 0.1, cloud: '#5a6272', ground: '#41474e', floor: 'stone', weather: 'rain', draw: bigBen, moving: bigBenMoving },
  { name: 'AMSTERDAM · NETHERLANDS', sky: ['#2c62a4', '#5e9ad2', '#a4cce8', '#e6eef0'], body: { x: 0.2, y: 0.4, r: 2.2, colour: '#fff4c0' }, night: 0, cloud: '#ffffff', ground: '#4c7a3a', floor: 'grass', birds: true, draw: at => [...canalHouses(at, -48), ...windmill(at, -10, 1.15), ...windmill(at, 18, 0.9), ...tulips(at, -55, 55)], moving: (at, now) => [...sails(at, -10, 1.15, now, 9000), ...sails(at, 18, 0.9, now, 7000)] },
  { name: 'TROMSO · NORWAY', sky: ['#04081a', '#0a1430', '#142446', '#1e3254'], body: { moon: true, x: 0.82, y: 0.3, r: 1.6, colour: '#f2f2e6' }, night: 1, ground: '#b4c2d8', floor: 'snow', weather: 'snow', draw: fjord, moving: aurora },
  { name: 'MOSCOW · RUSSIA', sky: ['#0c1430', '#1e2c5c', '#3a4a7a', '#5a6894'], body: { moon: true, x: 0.2, y: 0.32, r: 1.7, colour: '#f2f2e6' }, night: 0.9, ground: '#b8c4da', floor: 'snow', weather: 'snow', draw: stBasil },
  { name: 'ROME · ITALY', sky: ['#2e6aaa', '#6aa6d6', '#b8d6e8', '#f2dcb0'], body: { x: 0.25, y: 0.45, r: 2.4, colour: '#fff0b8' }, night: 0, cloud: '#ffffff', ground: '#a48a5c', floor: 'stone', birds: true, draw: at => [...colosseum(at), cypress(at, -18, 8), cypress(at, -16, 6.6), cypress(at, 19, 7.4), ...umbrellaPine(at, -28, 7), ...umbrellaPine(at, 27, 6.4)] },
  { name: 'GIZA · EGYPT', sky: ['#2462a2', '#5a9ed4', '#a6cce0', '#f2e0b0'], body: { x: 0.7, y: 0.25, r: 3, colour: '#fff6c8' }, night: 0, ground: '#d2a864', floor: 'sand', birds: true, draw: at => [...pyramid(at, -6, 8, 8.4, true), ...pyramid(at, 8, 11, 11), ...pyramid(at, 25, 5, 5), sphinx(at, -22), ...palm(at, -36, 6), ...palm(at, -33, 4.8), ...palm(at, 38, 5.6)] },
  { name: 'SERENGETI · TANZANIA', sky: ['#2e1838', '#7a2e4a', '#d8603a', '#f8b44a'], body: { x: 0.62, y: 0.86, r: 4.2, colour: '#ffb84a' }, night: 0.2, ground: '#b8904a', floor: 'grass', birds: true, draw: savanna },
  { name: 'AGRA · INDIA', sky: ['#2a2050', '#7a4a7a', '#e2848a', '#ffcc8a'], body: { x: 0.3, y: 0.85, r: 2.4, colour: '#ffc07a' }, night: 0.3, cloud: '#f4a8a8', ground: '#5e7048', floor: 'grass', weather: 'fireflies', draw: tajMahal },
  { name: 'GREAT WALL · CHINA', sky: ['#4c5a7e', '#8a92b2', '#d4c4c8', '#f6dcc0'], body: { x: 0.74, y: 0.62, r: 2, colour: '#fff0d8' }, night: 0, ground: '#4a6a4e', floor: 'grass', birds: true, draw: greatWall, moving: (at, now) => mist(at, now, 4.2) },
  { name: 'MT FUJI · JAPAN', sky: ['#4a7ec0', '#8ab8e2', '#cce2f2', '#fbe2ea'], body: { x: 0.85, y: 0.4, r: 2.2, colour: '#fff4d8' }, night: 0, cloud: '#ffffff', ground: '#5c8a4c', floor: 'grass', weather: 'petals', draw: fuji },
  { name: 'SYDNEY · AUSTRALIA', sky: ['#145cac', '#4a9ae0', '#9ccdf0', '#d4ecf8'], body: { x: 0.18, y: 0.3, r: 2.6, colour: '#fff8d0' }, night: 0, cloud: '#ffffff', ground: '#8a8c88', floor: 'stone', birds: true, draw: operaHouse, moving: (at, now) => glints(at, -55, 55, 2.2, now) },
  { name: 'EASTER ISLAND · CHILE', sky: ['#24204a', '#6a3a6a', '#e0705a', '#f8c070'], body: { x: 0.5, y: 0.96, r: 3.6, colour: '#ffa850' }, night: 0.3, cloud: '#e88a7a', ground: '#4a5a3a', floor: 'grass', draw: at => [...water(at, -55, 55, 2.4, '#4a3a6a'), box(at, -14, 0, 14, 0.8, '#3a3232'), ...[-10.5, -5.2, 0, 5.2, 10.5].flatMap(dx => moai(at, dx, 6.6 + 1.2 * rnd('moai', dx)))], moving: (at, now) => glints(at, -55, 55, 2.4, now, '#ffc890') },
  { name: 'MACHU PICCHU · PERU', sky: ['#56708e', '#90a8bc', '#c8d4d8', '#eef0e4'], night: 0, cloud: '#ffffff', ground: '#4e7a44', floor: 'grass', draw: machuPicchu, moving: (at, now) => mist(at, now, 6) },
  { name: 'CHICHEN ITZA · MEXICO', sky: ['#2266b0', '#5ea2dc', '#a8d2ee', '#e4f2f4'], body: { x: 0.8, y: 0.3, r: 2.6, colour: '#fff6c8' }, night: 0, cloud: '#ffffff', ground: '#4c6e3c', floor: 'grass', birds: true, draw: chichen },
  { name: 'RIO · BRAZIL', sky: ['#1e1e5a', '#6a3a8a', '#e06a8a', '#f8a85a'], body: { x: 0.74, y: 0.8, r: 3, colour: '#ffb060' }, night: 0.3, cloud: '#f0909a', ground: '#d8b47c', floor: 'sand', birds: true, draw: corcovado, moving: (at, now) => glints(at, 2, 55, 2, now, '#ffc0a0') },
  { name: 'NEW YORK · USA', sky: ['#060c26', '#10204a', '#22325e', '#3a4670'], body: { moon: true, x: 0.68, y: 0.22, r: 1.8, colour: '#f4f2e6' }, night: 0.85, ground: '#34363e', floor: 'stone', draw: liberty, moving: (at, now) => [...libertyTorch(at, now), ...glints(at, -55, 55, 2.4, now, '#ffd78a')] },
]

// --- the tour --------------------------------------------------------------------

const stopAt = (j: number): Stop => STOPS[mod(j, STOPS.length)] as Stop

/** Where the tour is at `now`: the stop it stays at or pans on from (`leg`), how far into the leg, and how far it has panned on (eased). */
const tourAt = (now: number): { leg: number; into: number; pan: number } => {
  const leg = Math.floor(now / LEG_MS)
  const into = now - leg * LEG_MS

  return { leg, into, pan: into < STAY_MS ? 0 : ease((into - STAY_MS) / PAN_MS) }
}

/** The left of the view along the world's strip at a leg's start: its stop in the middle. */
const leftOf = (leg: number, width: number): number => leg * STOP + STOP / 2 - width / 2

/** The land's scale: the band's few rows, a pane's many. */
const scaleOf = (horizon: number): number => Math.max(0.6, Math.min(1.5, horizon / 21))

/** The stops seen from `left`, `width` across: each where it is drawn. */
const stopsIn = (left: number, width: number, horizon: number, bottom: number): { stop: Stop; at: At }[] => {
  const s = scaleOf(horizon)
  const seen: { stop: Stop; at: At }[] = []
  for (let j = Math.floor((left - STOP / 2) / STOP); j * STOP <= left + width + STOP / 2; j += 1) seen.push({ stop: stopAt(j), at: { x: j * STOP + STOP / 2 - left, y: horizon, s, bottom } })

  return seen
}

/** The ground's texture over a stop's stretch, sparser and smaller toward the horizon; alike marks together, so a document draws each kind as one path. */
const floorShapes = (stop: Stop, at: At, j: number): Shape[] => {
  const light: Shape[] = []
  const dark: Shape[] = []
  const flowers: Shape[] = []
  const pale = mix(stop.ground, '#ffffff', stop.floor === 'snow' ? 0.5 : 0.18)
  const deep = mix(stop.ground, '#000000', 0.22)
  for (let y = at.y + 1.2, row = 0; y < at.bottom - 0.3; row += 1) {
    const near = Math.min(1.6, 0.6 + (y - at.y) / 16)
    for (let x = at.x - STOP / 2 + 3 * rnd('floor', j, row); x < at.x + STOP / 2; x += (4 + 5 * rnd('floor-gap', j, row, Math.floor(x))) * near) {
      const k = rnd('floor-kind', j, row, Math.floor(x))
      switch (stop.floor) {
        case 'grass':
          light.push(line([[x - 0.5 * near, y], [x - 0.2 * near, y - 0.9 * near], [x, y], [x + 0.3 * near, y - 1.1 * near], [x + 0.5 * near, y]], 0.2 * near, pale, 0.7))
          if (k < 0.2) flowers.push(disc(x + 1, y - 0.4 * near, 0.32 * near, 0.28 * near, '#ffe8a0', 0.85))
          break
        case 'sand':
          ;(k < 0.5 ? light : dark).push(line([[x - 1.4 * near, y], [x, y - 0.35 * near], [x + 1.4 * near, y]], 0.18, k < 0.5 ? pale : deep, 0.6))
          break
        case 'snow':
          light.push(disc(x, y, 1.6 * near, 0.4 * near, pale, 0.35))
          if (k < 0.3) flowers.push(disc(x + 0.8, y - 0.3, 0.16, 0.16, '#ffffff', 0.9))
          break
        case 'stone':
          ;(k < 0.5 ? light : dark).push(line([[x - 1.5 * near, y], [x + 1.5 * near, y]], 0.14, k < 0.5 ? pale : deep, 0.45))
          break
      }
    }
    y += 1.4 + (y - at.y) * 0.18
  }

  return [...light, ...dark, ...flowers]
}

/** A colour along the strip, `span` across from `left`: each stop's own over its middle, blended into the next's over the last stretch between them. */
const groundOf = (left: number, span: number): Gradient => {
  const stops: [number, string, number][] = []
  for (let j = Math.floor(left / STOP) - 1; j * STOP <= left + span + STOP; j += 1) {
    const edge = (j + 1) * STOP
    for (const [x, colour] of [[edge - 14, stopAt(j).ground], [edge + 14, stopAt(j + 1).ground]] as const) stops.push([Math.max(0, Math.min(1, (x - left) / span)), colour, 1])
  }

  return { x1: 0, y1: 0, x2: span, y2: 0, stops }
}

/** The land's still shapes, and how many of the last are its texture (`Layer.detail`). */
const landStill = (left: number, span: number, height: number, horizon: number): { shapes: Shape[]; detail: number } => {
  const seen = stopsIn(left, span, horizon, height)
  // The ground, nearer darker, its edge catching the light; on it each stop's landmark, then the ground's texture.
  const shapes: Shape[] = [
    { ...rect(0, horizon - 0.1, span, height - horizon + 0.1, '#000000'), grad: groundOf(left, span) },
    { ...rect(0, horizon, span, height - horizon, '#000000'), grad: { x1: 0, y1: horizon, x2: 0, y2: Math.max(height, horizon + 1), stops: [[0, '#000000', 0], [1, '#000000', 0.32]] } },
    rect(0, horizon - 0.1, span, 0.3, '#ffffff', 0.1),
  ]
  for (const { stop, at } of seen) shapes.push(...stop.draw(at))
  const texture = seen.flatMap(({ stop, at }) => floorShapes(stop, at, Math.round((left + at.x - STOP / 2) / STOP)))

  return { shapes: [...shapes, ...texture], detail: texture.length }
}

/** How far into a stop's stretch `x` is (0 its left edge, 1 its right), and how much it fades there: none over its middle, out to its edges. */
const edgeFade = (x: number, at: At): number => {
  const u = (x - at.x) / STOP + 0.5

  return Math.max(0, Math.min(1, Math.min(u, 1 - u) * 5))
}

/** A sky's gradient down to the horizon, fading in from the terminal's own background at the top. */
const skyGradient = (sky: readonly string[], horizon: number): Gradient => ({
  x1: 0,
  y1: 0,
  x2: 0,
  y2: horizon,
  stops: [[0, sky[0] ?? '#000000', 0.3], [0.22, sky[0] ?? '#000000', 1], [0.42, sky[1] ?? '#000000', 1], [0.78, sky[2] ?? '#000000', 1], [1, sky[3] ?? '#000000', 1]],
})

/** Between two stops, their skies blend over this many units either side of the seam, in slices SLICE wide. */
const SEAM = 12
const SLICE = 2

const skyStill = (left: number, span: number, height: number, horizon: number): Shape[] => {
  const shapes: Shape[] = []
  for (const { stop, at } of stopsIn(left, span, horizon, height)) {
    const from = Math.max(0, at.x - STOP / 2 + SEAM)
    const to = Math.min(span, at.x + STOP / 2 - SEAM)
    if (to > from) shapes.push({ ...rect(from, 0, to - from, horizon + 1, '#000000'), grad: skyGradient(stop.sky, horizon) })
    const next = stopAt(Math.round((left + at.x + STOP / 2) / STOP))
    for (let x = Math.max(at.x + STOP / 2 - SEAM, -SLICE); x < Math.min(at.x + STOP / 2 + SEAM, span); x += SLICE) {
      const w = ease((x + SLICE / 2 - (at.x + STOP / 2 - SEAM)) / (2 * SEAM))
      shapes.push({ ...rect(x, 0, SLICE + 0.05, horizon + 1, '#000000'), grad: skyGradient(stop.sky.map((colour, i) => mix(colour, next.sky[i] ?? colour, w)), horizon) })
    }
  }

  return shapes
}

const bodyShapes = (stop: Stop, at: At, horizon: number): Shape[] => {
  const body = stop.body
  if (body === undefined) return []
  const x = at.x + (body.x - 0.5) * STOP * 0.8
  const y = horizon * body.y
  const r = body.r * at.s
  const glow = [disc(x, y, r * 3.4, r * 2.6, body.colour, 0.07), disc(x, y, r * 2, r * 1.6, body.colour, 0.13)]
  if (body.moon !== true) return [...glow, disc(x, y, r, r * 0.8, body.colour)]
  // A crescent: the moon, and the night over part of it.
  return [...glow, disc(x, y, r, r * 0.8, body.colour), disc(x + r * 0.45, y - r * 0.18, r * 0.82, r * 0.68, stop.sky[0])]
}

/** Each stop's stars, twinkling as dark as it is, its sun or moon, and its clouds drifting across it; all fading at its edges. */
const skyMoving = (view: number, width: number, height: number, horizon: number, now: number): Shape[] => {
  const shapes: Shape[] = []
  for (const { stop, at } of stopsIn(view, width, horizon, height)) {
    const j = Math.round((view + at.x - STOP / 2) / STOP)
    // Its stars, twinkling: in four brightnesses, each drawn together.
    const stars: Shape[][] = [[], [], [], []]
    for (let i = 0; stop.night > 0.05 && i < STOP / 6; i += 1) {
      const x = at.x + (rnd('sx', j, i) - 0.5) * STOP
      const level = Math.round(3 * stop.night * (0.55 + 0.45 * Math.sin(now / (500 + 400 * rnd('twinkle', i)) + 7 * rnd('phase', i))) * edgeFade(x, at))
      const r = 0.16 + 0.2 * rnd('star', i)
      if (level > 0) stars[level]?.push(disc(x, rnd('sy', j, i) * horizon * 0.62, r, r * 0.8, '#f4f0ff', level / 3))
    }
    shapes.push(...stars.flat())
    shapes.push(...bodyShapes(stop, at, horizon))
    for (let i = 0; stop.cloud !== undefined && i < 3; i += 1) {
      const x = at.x - STOP / 2 + mod(rnd('cloud-x', j, i) * STOP + now * (0.0005 + 0.0004 * rnd('cloud-speed', i)), STOP)
      const y = horizon * (0.14 + 0.28 * rnd('cloud-y', j, i))
      const size = (1.8 + 1.4 * rnd('cloud-size', j, i)) * at.s
      const alpha = 0.4 * edgeFade(x, at)
      for (const [dx, dy, k] of [[0, 0, 1], [-1.5, 0.45, 0.7], [1.6, 0.4, 0.75], [0.5, -0.5, 0.65]] as const) shapes.push(disc(x + dx * size, y + dy * size * 0.5, 1.5 * size * k, 0.72 * size * k, stop.cloud, alpha))
    }
  }

  return shapes
}

/**
 * One of the weather's motes, as the stop it starts its run over says: each
 * runs from the top to the bottom (a firefly hovers over the field and
 * fades), taking its kind at its run's start.
 */
const moteShapes = (i: number, width: number, height: number, horizon: number, now: number, near: boolean, weatherAt: (x: number) => Weather | undefined): Shape[] => {
  const speed = 0.0025 + 0.0025 * rnd('mote-speed', i)
  const period = (height + 10) / speed
  const at = now + rnd('mote-phase', i) * period
  const run = Math.floor(at / period)
  const u = at / period - run
  const x0 = rnd('mote-x', i, run) * (width + 30) - 15
  const kind = weatherAt(x0)
  const size = (near ? 1.35 : 0.85) * (0.7 + 0.6 * rnd('mote-size', i))
  const sway = Math.sin(now / (700 + 500 * rnd('mote-sway', i)) + 6 * rnd('mote-p', i))
  const y = -4 + u * (height + 8)
  switch (kind) {
    case 'petals': {
      const x = x0 + u * 18 + sway * 1.6
      const turn = now / 600 + i

      return [{ kind: 'ellipse', x: -0.45 * size, y: -0.25 * size, w: 0.9 * size, h: 0.5 * size, fill: '#f8bcd4', alpha: 0.9, m: [Math.cos(turn), Math.sin(turn), -Math.sin(turn) * 0.6, Math.cos(turn) * 0.6, x, y] }]
    }
    case 'fireflies': {
      if (near) return []
      const glow = Math.sin(Math.PI * u) * (0.5 + 0.5 * Math.sin(now / 420 + 5 * i))
      const fx = x0 + 3 * Math.sin(now / 2100 + i) + sway
      const fy = horizon + 1 - 6 * rnd('fly-y', i, run) + 1.5 * Math.sin(now / 1700 + 2 * i)

      return [disc(fx, fy, 1.1, 0.9, '#fff3a0', 0.18 * glow), disc(fx, fy, 0.3, 0.26, '#fffbd0', 0.95 * glow)]
    }
    case 'leaves': {
      const x = x0 + u * 10 + sway * 2.6
      const turn = now / 300 + 3 * i
      const c = Math.cos(turn)
      const s = Math.sin(turn)
      const leaf = ([[-0.8, 0], [0, -0.42], [0.8, 0], [0, 0.42]] as const).map(([lx, ly]): Point => [x + (lx * c - ly * s * 0.7) * size, y + (lx * s + ly * c) * size * 0.8])

      return [poly(leaf, ['#e2762c', '#c8452e', '#f0b040', '#b85a26'][i % 4] as string, 0.92)]
    }
    case 'rain': {
      // Rain falls three times as fast, slanting.
      const ry = -4 + mod(u * 3, 1) * (height + 8)
      const x = x0 - mod(u * 3, 1) * 6

      return [line([[x, ry], [x - 0.5, ry + 2.2]], 0.16 * size, '#b8c8dc', 0.55)]
    }
    case 'snow':
      return [disc(x0 + sway * 1.4 + u * 4, y, 0.42 * size, 0.36 * size, '#ffffff', 0.9)]
    case undefined:
      return []
  }
}

const weather = (width: number, height: number, horizon: number, now: number, near: boolean, weatherAt: (x: number) => Weather | undefined): Shape[] => {
  const shapes: Shape[] = []
  const count = Math.min(80, Math.ceil((width * height) / 100))
  for (let i = 0; i < count; i += 1) if ((rnd('mote-near', i) < 0.3) === near) shapes.push(...moteShapes(i, width, height, horizon, now, near, weatherAt))

  return shapes
}

/** The name of the stop the tour has just come to, a while after it arrives, by a pin. */
const caption = (stop: Stop, into: number, horizon: number): Shape[] => {
  const alpha = Math.min(ease((into - 600) / 900), ease((10_500 - into) / 1500))
  if (alpha <= 0.01) return []
  const size = Math.min(3.4, Math.max(2.6, horizon / 7))
  const y = size * 1.25

  return [
    disc(2.6, y - size * 0.55, size * 0.3, size * 0.3, '#e8463a', alpha),
    poly([[2.6 - size * 0.27, y - size * 0.45], [2.6, y + size * 0.1], [2.6 + size * 0.27, y - size * 0.45]], '#e8463a', alpha),
    disc(2.6, y - size * 0.55, size * 0.11, size * 0.11, '#ffffff', alpha),
    { kind: 'text', x: 4, y, w: 0, h: 0, text: stop.name, size, anchor: 'start', bold: true, fill: '#ffffff', alpha: 0.9 * alpha },
  ]
}

/**
 * The scenery of a frame `width` by `height` units at `now` (ms), its ground
 * from `horizon` down: the sky and the land each a still layer (the land
 * the whole leg's strip, seen from where the pan has got to) and what moves
 * over it, and the weather nearest the eye.
 */
export const sceneryOf = (width: number, height: number, horizon: number, now: number): Scenery => {
  const { leg, into, pan } = tourAt(now)
  const left = leftOf(leg, width)
  const span = width + (pan > 0 ? STOP : 0)
  const view = left + pan * STOP
  const key = `${width}x${height}@${horizon}:${leg}:${span}`
  const moving: Shape[] = []
  for (const { stop, at } of stopsIn(view, width, horizon, height)) moving.push(...(stop.moving?.(at, now) ?? []), ...(stop.birds === true ? birds(at, now) : []))
  // The weather of the stop each mote starts over.
  const weatherAt = (x: number): Weather | undefined => stopAt(Math.floor((view + x) / STOP)).weather

  const land = kept(`land:${key}`, () => landStill(left, span, height, horizon))

  return {
    sky: { key: `sky:${key}`, still: kept(`sky:${key}`, () => ({ shapes: skyStill(left, span, height, horizon), detail: 0 })).shapes, span, shift: pan * STOP, detail: 0, moving: skyMoving(view, width, height, horizon, now) },
    land: {
      key: `land:${key}`,
      still: land.shapes,
      span,
      shift: pan * STOP,
      detail: land.detail,
      moving: [...moving, ...weather(width, height, horizon, now, false, weatherAt), ...(pan === 0 ? caption(stopAt(leg), into, horizon) : [])],
    },
    front: weather(width, height, horizon, now, true, weatherAt),
  }
}

/** The still layers as last made, by key: made once, not every frame. */
const made = new Map<string, { shapes: Shape[]; detail: number }>()

const kept = (key: string, make: () => { shapes: Shape[]; detail: number }): { shapes: Shape[]; detail: number } => {
  const shapes = made.get(key) ?? make()
  made.delete(key)
  made.set(key, shapes)
  for (const old of made.keys()) if (made.size > 8) made.delete(old)

  return shapes
}
