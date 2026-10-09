import type { Gradient, Shape } from './clawd-vector'
import { rgbOf } from './clawd-vector'
import { hashOf } from './motion-rules'

// The world tour's stops (hooks/scenery.ts draws them): each a landmark and
// what is round it, drawn in daylight colours (the tour lights them for the
// hour there: golden low sun, dark night), its night lights apart, and what
// moves there. Coordinates: `placer`, `box` and `dot` take `[dx, up]` in the
// stop's own units from its middle and its horizon (up is up), scaled by
// `at.s`; a stop's stretch is 110 units, a landmark at most some 20 tall.

export type Weather = 'leaves' | 'rain' | 'petals' | 'snow' | 'fireflies'

/** Where a stop is drawn: its middle, the horizon its landmark stands on, its scale, and the bottom of the view. */
export type At = { x: number; y: number; s: number; bottom: number }

/**
 * The light at a stop: its hour (0 to 24), the sun's height (1 noon, 0 at
 * six, -1 midnight), how dark it is, how golden (the low sun), how much day.
 */
export type Light = { hour: number; sun: number; dark: number; golden: number; day: number }

export type Stop = {
  name: string
  /** Its longitude, east positive: its hour is Greenwich's and this over 15. The tour goes round the world eastward. */
  lon: number
  /** Its air: grey skies, desert haze, mountain mist, the cold of the far north; absent, clear. */
  climate?: 'overcast' | 'haze' | 'mist' | 'arctic'
  /** How many clouds drift over it (2 when unsaid). */
  clouds?: number
  ground: string
  /** What the ground is: tufts of grass, ripples of sand, drifts of snow, paving stones. */
  floor: 'grass' | 'sand' | 'snow' | 'stone'
  weather?: Weather
  /** Birds crossing its sky by day. */
  birds?: true
  /** Its landmark and what is round it, in daylight colours: lit for the hour by the tour. */
  draw: (at: At) => Shape[]
  /** What it lights at night (windows, floodlights, lanterns): fading in at dusk, never darkened. */
  lights?: (at: At) => Shape[]
  /** What moves there, in daylight colours (sails, a bus, mist, glints): lit for the hour each frame. */
  moving?: (at: At, now: number, light: Light) => Shape[]
  /** What moves and shines of itself (sparkles, a torch, the northern lights): never darkened. */
  glowing?: (at: At, now: number, light: Light) => Shape[]
}

export const mod = (a: number, n: number): number => ((a % n) + n) % n

/** A number in [0, 1) chosen by the parts. */
export const rnd = (...parts: readonly (string | number)[]): number => hashOf('scenery', ...parts) / 4_294_967_296

export const mix = (a: string, b: string, w: number): string => {
  if (w <= 0) return a
  if (w >= 1) return b
  const to = rgbOf(b)

  return `#${rgbOf(a).map((v, i) => Math.round(v + ((to[i] ?? 0) - v) * w).toString(16).padStart(2, '0')).join('')}`
}

export type Point = readonly [number, number]

export const rect = (x: number, y: number, w: number, h: number, fill: string, alpha = 1, r = 0): Shape => ({ kind: 'rect', x, y, w, h, fill, ...(alpha < 1 ? { alpha } : {}), ...(r > 0 ? { r } : {}) })
export const disc = (cx: number, cy: number, rx: number, ry: number, fill: string, alpha = 1): Shape => ({ kind: 'ellipse', x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry, fill, ...(alpha < 1 ? { alpha } : {}) })
export const poly = (points: readonly Point[], fill: string, alpha = 1, grad?: Gradient): Shape => ({ kind: 'poly', x: 0, y: 0, w: 0, h: 0, points, fill, ...(alpha < 1 ? { alpha } : {}), ...(grad === undefined ? {} : { grad }) })
export const line = (points: readonly Point[], stroke: number, fill: string, alpha = 1): Shape => ({ kind: 'line', x: 0, y: 0, w: 0, h: 0, points, stroke, fill, ...(alpha < 1 ? { alpha } : {}) })

/** A stop's points: each `[dx, up]` from its middle and horizon, in its scale. */
export const placer = ({ x, y, s }: At) => (points: readonly Point[]): Point[] => points.map(([dx, up]) => [x + dx * s, y - up * s])

/** A box from `[dx, up]` to `[dx2, up2]` in a stop's units. */
export const box = (at: At, dx: number, up: number, dx2: number, up2: number, fill: string, alpha = 1): Shape => rect(at.x + Math.min(dx, dx2) * at.s, at.y - Math.max(up, up2) * at.s, Math.abs(dx2 - dx) * at.s, Math.abs(up2 - up) * at.s, fill, alpha)

export const dot = (at: At, dx: number, up: number, rx: number, ry: number, fill: string, alpha = 1): Shape => disc(at.x + dx * at.s, at.y - up * at.s, rx * at.s, ry * at.s, fill, alpha)

/** A soft glow, `alpha` bright at its heart: rings, each fainter out to its edge. */
export const glow = (at: At, dx: number, up: number, rx: number, ry: number, fill: string, alpha: number): Shape[] =>
  [1, 0.76, 0.52, 0.3].map((k, i) => dot(at, dx, up, rx * k, ry * k, fill, alpha * (0.34 + 0.04 * i)))

/** A ridge across `from` to `to` (stop units), `up` high give or take `vary`, filled down to the horizon. */
export const ridge = (at: At, from: number, to: number, up: number, vary: number, fill: string, seed: number, grad?: Gradient): Shape => {
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
export const water = (at: At, from: number, to: number, deep: number, fill: string): Shape[] => [box(at, from, 0, to, deep, fill), box(at, from, deep - 0.25, to, deep, '#ffffff', 0.18)]

export const glints = (at: At, from: number, to: number, deep: number, now: number, colour = '#ffffff'): Shape[] =>
  Array.from({ length: Math.ceil((to - from) / 9) }, (_, i) => {
    const dx = from + 4 + i * 9 + 2 * Math.sin(now / 1500 + i * 1.7)
    const up = deep * (0.25 + 0.5 * rnd('glint', i, Math.floor(from)))

    return line(placer(at)([[dx - 1.2, up], [dx + 1.2, up]]), 0.18 * at.s, colour, 0.35 + 0.3 * Math.sin(now / 600 + i))
  })

export const palm = (at: At, dx: number, h: number, trunk = '#6a4a32', leaf = '#2f6a3a'): Shape[] => {
  const p = placer(at)
  const top: Point = [dx + 1.2, h]
  const fronds = [[-4, h - 1.6], [-3, h + 1], [0, h + 1.6], [3, h + 1.2], [4.2, h - 1.4], [2, h - 2.2], [-2, h - 2.4]] as const

  return [
    line(p([[dx, 0], [dx + 0.6, h * 0.5], top]), 0.55 * at.s, trunk),
    ...fronds.map(([fx, fy]) => line(p([top, [dx + 1.2 + fx * 0.55, (h + fy) / 2 + 0.6], [dx + 1.2 + fx, fy]]), 0.5 * at.s, leaf)),
  ]
}

export const cypress = (at: At, dx: number, h: number, fill = '#2a4a32'): Shape => poly(placer(at)([[dx - 0.9, 0.3], [dx - 1, h * 0.4], [dx - 0.4, h * 0.85], [dx, h], [dx + 0.4, h * 0.85], [dx + 1, h * 0.4], [dx + 0.9, 0.3]]), fill)

export const roundTree = (at: At, dx: number, h: number, crown: string, lit: string, trunk = '#4a3428'): Shape[] => [
  box(at, dx - 0.35, 0, dx + 0.35, h * 0.55, trunk),
  dot(at, dx - h * 0.2, h * 0.62, h * 0.3, h * 0.24, crown),
  dot(at, dx + h * 0.22, h * 0.6, h * 0.28, h * 0.23, crown),
  dot(at, dx, h * 0.76, h * 0.34, h * 0.26, crown),
  dot(at, dx - h * 0.1, h * 0.84, h * 0.17, h * 0.12, lit, 0.85),
]

export const pine = (at: At, dx: number, h: number, fill: string, snow = 0): Shape[] => {
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

/** Buildings in a row from `from` to `to`, `low` to `high` tall, their windows dim glass, or with `lit` the windows alone, lit. */
export const skyline = (at: At, from: number, to: number, low: number, high: number, fill: string, seed: number, lit = false): Shape[] => {
  const towers: Shape[] = []
  const windows: Shape[] = []
  for (let dx = from, i = 0; dx < to; i += 1) {
    const w = 2.4 + 2.4 * rnd('tower-w', seed, i)
    const h = low + (high - low) * rnd('tower-h', seed, i) ** 1.6
    towers.push(box(at, dx, 0, Math.min(to, dx + w), h, fill))
    for (let wy = 1; wy < h - 0.8; wy += 1.2) {
      for (let wx = dx + 0.5; wx < Math.min(to, dx + w) - 0.5; wx += 1) if (rnd('window', seed, i, wx, wy) < 0.45) windows.push(box(at, wx, wy, wx + 0.45, wy + 0.5, lit ? '#ffd78a' : '#8a9ab4', lit ? 0.85 : 0.5))
    }
    dx += w + 0.3
  }

  return lit ? windows : [...towers, ...windows]
}

/** Birds crossing the sky by day, wings beating. */
export const birds = (at: At, now: number, light: Light): Shape[] =>
  [0, 1, 2].map(i => {
    const dx = mod(now / 260 + i * 37 + 9 * rnd('bird', i), 120) - 60
    const up = 14 + 2.5 * i + Math.sin(now / 1100 + i) * 0.8
    const flap = Math.sin(now / 140 + i * 2) * 0.55

    return line(placer(at)([[dx - 0.9, up + flap], [dx, up], [dx + 0.9, up + flap]]), 0.2 * at.s, '#2a2a36', 0.8 * light.day)
  })

/** Mist drifting along the slopes. */
export const mist = (at: At, now: number, up: number, colour = '#ffffff'): Shape[] =>
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

/** Paris's rooftops: cream walls, grey mansards, their windows; with `lit` the windows alone, lit. */
const haussmann = (at: At, from: number, to: number, lit = false): Shape[] => {
  const walls: Shape[] = []
  const windows: Shape[] = []
  for (let dx = from; dx < to; dx += 7.4) {
    walls.push(box(at, dx, 0, dx + 7, 4.8, '#cdb898'), poly(placer(at)([[dx - 0.2, 4.8], [dx + 0.6, 6.2], [dx + 6.4, 6.2], [dx + 7.2, 4.8]]), '#5c6478'))
    for (let wx = dx + 0.8; wx < dx + 6.6; wx += 1.5) for (const wy of [1, 2.6]) windows.push(box(at, wx, wy, wx + 0.6, wy + 0.9, lit ? '#ffd48a' : '#6c7a92', 0.85))
  }

  return lit ? windows : [...walls, ...windows]
}

/** The tower lit gold at night, a glow round it. */
const eiffelLights = (at: At): Shape[] => [...glow(at, 0, 8, 8, 10, '#ffd27a', 0.16), ...eiffel(at).map(shape => ({ ...shape, fill: '#f6c25a', alpha: 0.75 * (shape.alpha ?? 1) }))]

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
  for (let dx = 3.2; dx < 21.5; dx += 1.6) for (const up of [1.6, 3.6]) shapes.push(box(at, dx, up, dx + 0.5, up + 1.2, '#5e6676', 0.8))
  for (const dx of [-1.2, -0.4, 0.4, 1.2]) shapes.push(line(p([[dx, 1], [dx, 11]]), 0.1 * at.s, shade, 0.7))

  return shapes
}

/** Westminster's windows lit, and its clock face glowing. */
const bigBenLights = (at: At): Shape[] => {
  const shapes: Shape[] = glow(at, 0, 13.1, 3, 3, '#fff0c0', 0.4)
  for (let dx = 3.2; dx < 21.5; dx += 1.6) for (const up of [1.6, 3.6]) shapes.push(box(at, dx, up, dx + 0.5, up + 1.2, '#ffd890', 0.8))

  return shapes
}

/** Its clock at the hour in London, and a red bus going by. */
const bigBenMoving = (at: At, now: number, light: Light): Shape[] => {
  const p = placer(at)
  const hand = (turns: number, length: number): Shape => line(p([[0, 13.1], [Math.sin(turns * 2 * Math.PI) * length, 13.1 + Math.cos(turns * 2 * Math.PI) * length]]), 0.18 * at.s, '#2a2a30')
  const bus = mod(now / 90, 140) - 70

  return [
    hand((light.hour % 12) / 12, 0.75),
    hand(light.hour % 1, 1.15),
    box(at, bus, 0.4, bus + 6, 3.6, '#d43a30'),
    dot(at, bus + 1.2, 0.45, 0.55, 0.55, '#202024'),
    dot(at, bus + 4.8, 0.45, 0.55, 0.55, '#202024'),
  ]
}

/** The bus's windows, glass by day and lit by night. */
const busWindows = (at: At, now: number, light: Light): Shape[] => {
  const bus = mod(now / 90, 140) - 70

  return [box(at, bus + 0.4, 2.3, bus + 5.6, 3.1, '#ffe2a0', 0.35 + 0.5 * light.dark), box(at, bus + 0.4, 1.2, bus + 5.6, 1.9, '#ffe2a0', 0.35 + 0.5 * light.dark)]
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

/** Amsterdam's gabled houses, their white-framed windows; with `lit` the windows alone, lit. */
const canalHouses = (at: At, from: number, lit = false): Shape[] => {
  const colours = ['#8a3a2a', '#2e4a3e', '#c8b490', '#3a4a6a', '#6a2a2a']

  return colours.flatMap((colour, i) => {
    const dx = from + i * 3.3
    const h = 6 + (i % 3)

    const windows = [1.4, 3.2, 5].filter(up => up < h - 0.4).flatMap(up => [box(at, dx + 0.5, up, dx + 1.2, up + 1, lit ? '#ffd27a' : '#f6f0e2', 0.85), box(at, dx + 1.9, up, dx + 2.6, up + 1, lit ? '#ffd27a' : '#f6f0e2', 0.85)])

    return lit ? windows : [poly(placer(at)([[dx, 0], [dx, h], [dx + 0.6, h], [dx + 0.6, h + 0.7], [dx + 1.2, h + 0.7], [dx + 1.2, h + 1.4], [dx + 1.9, h + 1.4], [dx + 1.9, h + 0.7], [dx + 2.5, h + 0.7], [dx + 2.5, h], [dx + 3.1, h], [dx + 3.1, 0]]), colour), ...windows]
  })
}

/** The Colosseum; with `lit` its arches alone, floodlit gold. */
const colosseum = (at: At, lit = false): Shape[] => {
  const p = placer(at)
  const stone = '#dcbc8c'
  const shapes: Shape[] = [
    // The inner wall seen over the broken side, then the outer wall, whole on the left and fallen on the right.
    poly(p([[-6, 0], [-6, 7.2], [10, 7.2], [12, 0]]), '#b89668'),
    poly(p([[-13, 0], [-13, 9], [2, 9], [3.5, 8], [5, 8.4], [7, 6.2], [9, 5.4], [11, 3.2], [13, 2.4], [13, 0]]), stone),
    box(at, -13, 8.4, 2, 9, '#c4a274'),
  ]
  const arches: Shape[] = []
  for (const [up, top] of [[0.4, 2.6], [3, 5.2], [5.6, 7.8]] as const) {
    for (let dx = -12.3; dx < 12.5; dx += 1.9) {
      const roof = 9 - (dx > 2 ? (dx - 2) * 0.6 : 0)
      if (top + 0.3 > roof) continue
      arches.push(rect(at.x + dx * at.s, at.y - top * at.s, 1.05 * at.s, (top - up) * at.s, lit ? '#ffb45c' : '#7a5434', lit ? 0.7 : 0.85, 0.5 * at.s))
    }
  }

  return lit ? [...glow(at, 0, 4, 19, 8, '#ffc070', 0.16), ...arches] : [...shapes, ...arches]
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
    poly(p([[-0.5, -0.4], [0.5, -0.4], [1, (at.y - at.bottom) / at.s * 0.6], [-1, (at.y - at.bottom) / at.s * 0.6]]), '#e8eef8', 0.35),
  )
  for (const dx of [-20, -16, 16, 20]) shapes.push(cypress(at, dx, 6, '#2e4632'))

  return shapes
}

/** The Great Wall's crest along its ridge, `dx` from the stop's middle. */
const crest = (dx: number): number => 5 + 3.2 * Math.sin(dx / 9 + 0.6) + 1.4 * Math.sin(dx / 4.3)
const WATCHTOWERS = [-38, -12, 15, 41] as const

const greatWall = (at: At): Shape[] => {
  const p = placer(at)
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
  for (const dx of WATCHTOWERS) {
    const up = crest(dx) + 0.4
    shapes.push(box(at, dx - 1.4, up, dx + 1.4, up + 3, '#c8b898'), box(at, dx - 0.4, up + 0.8, dx + 0.4, up + 1.9, '#5a4a3a'), box(at, dx - 1.6, up + 3, dx + 1.6, up + 3.5, '#a89878'))
  }

  return shapes
}

/** Lanterns in its watchtowers. */
const greatWallLights = (at: At): Shape[] => WATCHTOWERS.flatMap(dx => [...glow(at, dx, crest(dx) + 1.75, 2.6, 2, '#ffc870', 0.24), box(at, dx - 0.4, crest(dx) + 1.2, dx + 0.4, crest(dx) + 2.3, '#ffd27a', 0.9)])

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

/** The pagoda's windows lit, tier by tier. */
const pagodaLights = (at: At): Shape[] => Array.from({ length: 5 }, (_, tier) => box(at, -16.3, 0.9 + tier * 2.1, -15.7, 1.5 + tier * 2.1, '#ffcf70', 0.9))

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
]

const corcovado = (at: At): Shape[] => {
  const p = placer(at)

  return [
    ...water(at, 2, 55, 2, '#3a3a7a'),
    poly(p([[-30, 0], [-16, 6], [-9, 12.4], [-6.6, 13.2], [-4.4, 12], [2, 5], [10, 0]]), '#2a3a3a'),
    poly(p([[10, 0], [12, 5], [15, 8.4], [18, 8.8], [20.6, 7], [22.6, 2.4], [24, 0]]), '#2e3c40'),
    // The statue, arms out, its robe widening down.
    poly(p([[-7.25, 13.1], [-6.95, 16.2], [-6.25, 16.2], [-5.95, 13.1]]), '#f4eee4'),
    box(at, -8.8, 15.5, -4.4, 16.05, '#f4eee4'),
    dot(at, -6.6, 16.65, 0.48, 0.48, '#f4eee4'),
    ...glow(at, -6.6, 15.4, 3.4, 2.4, '#fff4dc', 0.22),
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
    ...skyline(at, -52, 4, 3, 12, '#5c6c88', 7),
    box(at, -27.6, 0, -24.4, 13, '#56647e'),
    box(at, -26.8, 13, -25.2, 15.6, '#56647e'),
    line(p([[-26, 15.6], [-26, 18]]), 0.2 * at.s, '#56647e'),
    ...water(at, -55, 55, 2.4, '#3a5a86'),
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

/** Its torch, flickering, brighter by night. */
const libertyTorch = (at: At, now: number, light: Light): Shape[] => {
  const flicker = 0.8 + 0.2 * Math.sin(now / 90) * Math.sin(now / 37)

  return [...glow(at, 15.1, 14.6, 2.6, 2.2, '#ffc860', (0.08 + 0.22 * light.dark) * flicker), dot(at, 15.1, 14.6, 0.5, 0.65 * flicker, '#ffd060')]
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

/** The northern lights by night: three curtains of thin rays, bright at their feet and fading up, rippling. */
const aurora = (at: At, now: number, light: Light): Shape[] => {
  if (light.dark < 0.05) return []
  // By brightness, foot to top: each drawn together.
  const glow: Shape[][] = [[], [], []]
  for (let i = 0; i < 3; i += 1) {
    const colour = ['#5cf2a0', '#4ae0c0', '#a080f0'][i] as string
    for (let dx = -60 + i * 0.7; dx < 60; dx += 2.1) {
      const wave = Math.sin(dx / 11 + now / (2400 + i * 700) + i * 2) * 2 + Math.sin(dx / 5 - now / 1900) * 0.7
      const foot = 11.5 - i * 1.2 + wave * 0.7
      const top = foot + 3 + 3.5 * rnd('ray', i, Math.round(dx * 10)) + wave * 0.3
      glow[0]?.push(box(at, dx, foot, dx + 1.3, foot + 1.2, colour, 0.34 * light.dark))
      glow[1]?.push(box(at, dx, foot + 1.2, dx + 1.3, (foot + top) / 2 + 0.6, colour, 0.17 * light.dark))
      glow[2]?.push(box(at, dx, (foot + top) / 2 + 0.6, dx + 1.3, top, colour, 0.07 * light.dark))
    }
  }

  return glow.flat()
}

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
    box(at, 2.2, 1.2, 3.6, 2.4, '#3a4658'),
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

// Round the world eastward, by longitude: each stop's hour close to its neighbours'.
export const STOPS: readonly Stop[] = [
  { name: 'EASTER ISLAND · CHILE', lon: -109.35, ground: '#4a5a3a', floor: 'grass', draw: at => [...water(at, -55, 55, 2.4, '#3a5a8a'), box(at, -14, 0, 14, 0.8, '#3a3232'), ...[-10.5, -5.2, 0, 5.2, 10.5].flatMap(dx => moai(at, dx, 6.6 + 1.2 * rnd('moai', dx)))], moving: (at, now) => glints(at, -55, 55, 2.4, now) },
  { name: 'CHICHEN ITZA · MEXICO', lon: -88.57, ground: '#4c6e3c', floor: 'grass', birds: true, draw: chichen },
  { name: 'NEW YORK · USA', lon: -74.04, ground: '#4a4c54', floor: 'stone', draw: liberty, lights: at => [...skyline(at, -52, 4, 3, 12, '#5c6c88', 7, true), dot(at, -26, 18.1, 0.3, 0.3, '#ff5a50'), ...glow(at, 13.5, 8, 5.5, 7, '#e8fff4', 0.14)], moving: (at, now) => glints(at, -55, 55, 2.4, now), glowing: libertyTorch },
  { name: 'MACHU PICCHU · PERU', lon: -72.55, climate: 'mist', ground: '#4e7a44', floor: 'grass', draw: machuPicchu, moving: (at, now) => mist(at, now, 6) },
  { name: 'RIO · BRAZIL', lon: -43.21, ground: '#d8b47c', floor: 'sand', birds: true, draw: corcovado, lights: at => [...glow(at, -6.6, 15.2, 3.6, 3, '#fff6dc', 0.4), ...Array.from({ length: 26 }, (_, i) => dot(at, -26 + 34 * rnd('rio-light', i), 0.5 + 2.6 * rnd('rio-up', i), 0.18, 0.18, '#ffd78a', 0.9))], moving: (at, now) => glints(at, 2, 55, 2, now) },
  { name: 'LONDON · UK', lon: -0.12, climate: 'overcast', clouds: 5, ground: '#41474e', floor: 'stone', weather: 'rain', draw: bigBen, lights: bigBenLights, moving: bigBenMoving, glowing: busWindows },
  { name: 'PARIS · FRANCE', lon: 2.29, ground: '#4a5240', floor: 'grass', weather: 'leaves', draw: at => [...haussmann(at, -54, -14), ...haussmann(at, 14, 54), ...roundTree(at, -12, 6, '#d87a32', '#f0b04a'), ...roundTree(at, 12, 5.6, '#c8522e', '#e8903a'), ...eiffel(at)], lights: at => [...haussmann(at, -54, -14, true), ...haussmann(at, 14, 54, true), ...eiffelLights(at)], glowing: (at, now, light) => Array.from({ length: 10 }, (_, i) => dot(at, (rnd('sparkle-x', i) - 0.5) * (5 - rnd('sparkle-y', i) * 4.4), 1 + rnd('sparkle-y', i) * 17, 0.22, 0.22, '#ffffff', light.dark * Math.max(0, Math.sin(now / 200 + i * 7)))) },
  { name: 'AMSTERDAM · NETHERLANDS', lon: 4.9, ground: '#4c7a3a', floor: 'grass', birds: true, draw: at => [...canalHouses(at, -48), ...windmill(at, -10, 1.15), ...windmill(at, 18, 0.9), ...tulips(at, -55, 55)], lights: at => canalHouses(at, -48, true), moving: (at, now) => [...sails(at, -10, 1.15, now, 9000), ...sails(at, 18, 0.9, now, 7000)] },
  { name: 'ROME · ITALY', lon: 12.49, ground: '#a48a5c', floor: 'stone', birds: true, draw: at => [...colosseum(at), cypress(at, -18, 8), cypress(at, -16, 6.6), cypress(at, 19, 7.4), ...umbrellaPine(at, -28, 7), ...umbrellaPine(at, 27, 6.4)], lights: at => colosseum(at, true) },
  { name: 'TROMSO · NORWAY', lon: 18.96, climate: 'arctic', clouds: 1, ground: '#b4c2d8', floor: 'snow', weather: 'snow', draw: fjord, lights: at => [box(at, 2.2, 1.2, 3.6, 2.4, '#ffd27a'), ...glow(at, 2.9, 1.8, 3, 2, '#ffd27a', 0.2)], glowing: aurora },
  { name: 'GIZA · EGYPT', lon: 31.13, climate: 'haze', clouds: 1, ground: '#d2a864', floor: 'sand', birds: true, draw: at => [...pyramid(at, -6, 8, 8.4, true), ...pyramid(at, 8, 11, 11), ...pyramid(at, 25, 5, 5), sphinx(at, -22), ...palm(at, -36, 6), ...palm(at, -33, 4.8), ...palm(at, 38, 5.6)] },
  { name: 'SERENGETI · TANZANIA', lon: 35, climate: 'haze', clouds: 1, ground: '#b8904a', floor: 'grass', birds: true, draw: savanna },
  { name: 'MOSCOW · RUSSIA', lon: 37.62, climate: 'arctic', ground: '#b8c4da', floor: 'snow', weather: 'snow', draw: stBasil, lights: at => [...glow(at, 0, 6, 16, 8, '#ffd090', 0.2), ...glow(at, 0, 3, 12, 3, '#ffe0a0', 0.18)] },
  { name: 'AGRA · INDIA', lon: 78.04, climate: 'haze', ground: '#5e7048', floor: 'grass', weather: 'fireflies', draw: tajMahal, lights: at => [...glow(at, 0, 7, 15, 9, '#ffe6d0', 0.22), ...glow(at, 0, 10, 4, 3, '#fff2e0', 0.3)] },
  { name: 'GREAT WALL · CHINA', lon: 116.57, climate: 'mist', ground: '#4a6a4e', floor: 'grass', birds: true, draw: greatWall, lights: greatWallLights, moving: (at, now) => mist(at, now, 4.2) },
  { name: 'MT FUJI · JAPAN', lon: 138.73, ground: '#5c8a4c', floor: 'grass', weather: 'petals', draw: fuji, lights: pagodaLights },
  { name: 'SYDNEY · AUSTRALIA', lon: 151.21, ground: '#8a8c88', floor: 'stone', birds: true, draw: operaHouse, lights: at => [...glow(at, -3, 4.5, 14, 6, '#fff4e0', 0.2), ...Array.from({ length: 13 }, (_, i) => dot(at, 18 + i * 2, 3 + 6.4 * Math.sin((i / 12) * Math.PI), 0.2, 0.2, '#ffe6a0', 0.95)), ...Array.from({ length: 15 }, (_, i) => dot(at, 15 + i * 2, 3, 0.16, 0.16, '#ffe6a0', 0.9))], moving: (at, now) => glints(at, -55, 55, 2.2, now) },
]
