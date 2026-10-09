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
const placer = ({ x, y, s }: At) => (points: readonly Point[]): Point[] => points.map(([dx, up]) => [x + dx * s, y - up * s])

/** A box from `[dx, up]` to `[dx2, up2]` in a stop's units. */
const box = (at: At, dx: number, up: number, dx2: number, up2: number, fill: string, alpha = 1): Shape => rect(at.x + Math.min(dx, dx2) * at.s, at.y - Math.max(up, up2) * at.s, Math.abs(dx2 - dx) * at.s, Math.abs(up2 - up) * at.s, fill, alpha)

const dot = (at: At, dx: number, up: number, rx: number, ry: number, fill: string, alpha = 1): Shape => disc(at.x + dx * at.s, at.y - up * at.s, rx * at.s, ry * at.s, fill, alpha)

/** A soft glow, `alpha` bright at its heart: rings, each fainter out to its edge. */
const glow = (at: At, dx: number, up: number, rx: number, ry: number, fill: string, alpha: number): Shape[] =>
  [1, 0.76, 0.52, 0.3].map((k, i) => dot(at, dx, up, rx * k, ry * k, fill, alpha * (0.34 + 0.04 * i)))

/** How high an outline (its points left to right) stands `dx` across: between its points either side, its first's before them, `past` after them. */
const heightAlong = (outline: readonly Point[], dx: number, past = 0): number => {
  for (let i = 1; i < outline.length; i += 1) {
    const [x0, y0] = outline[i - 1] ?? [0, 0]
    const [x1, y1] = outline[i] ?? [0, 0]
    if (dx <= x1) return y0 + ((y1 - y0) * (Math.max(dx, x0) - x0)) / (x1 - x0)
  }

  return past
}

/** A ridge across `from` to `to` (stop units), `up` high give or take `vary`, filled down to the horizon. */
const ridge = (at: At, from: number, to: number, up: number, vary: number, fill: string, seed: number): Shape => {
  const points: Point[] = [[from, -0.2]]
  for (let dx = from; dx <= to; dx += 3) {
    const k = (dx - from) / (to - from)
    const edge = Math.sin(Math.PI * k) ** 0.6
    points.push([dx, (up + vary * (Math.sin(dx / 7 + seed) * 0.6 + Math.sin(dx / 3.1 + seed * 2) * 0.4)) * edge])
  }
  points.push([to, -0.2])

  return poly(placer(at)(points), fill)
}

/** Water from `from` to `to` (stop units), `deep` up from the horizon. */
const water = (at: At, from: number, to: number, deep: number, fill: string): Shape[] => [box(at, from, 0, to, deep, fill), box(at, from, deep - 0.25, to, deep, '#ffffff', 0.18)]

/** Glints swaying on water from `from` to `to`, each kept within it. */
const glints = (at: At, from: number, to: number, deep: number, now: number): Shape[] =>
  Array.from({ length: Math.max(0, Math.floor((to - from - 7.2) / 9) + 1) }, (_, i) => {
    const dx = from + 4 + i * 9 + 2 * Math.sin(now / 1500 + i * 1.7)
    const up = deep * (0.25 + 0.5 * rnd('glint', i, Math.floor(from)))

    return line(placer(at)([[dx - 1.2, up], [dx + 1.2, up]]), 0.18 * at.s, '#ffffff', 0.35 + 0.3 * Math.sin(now / 600 + i))
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

const roundTree = (at: At, dx: number, h: number, crown: string, lit: string): Shape[] => [
  box(at, dx - 0.35, 0, dx + 0.35, h * 0.55, '#4a3428'),
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

/** Buildings in a row from `from` to `to`, `low` to `high` tall, their windows dim glass, or with `lit` the windows alone, lit. */
const skyline = (at: At, from: number, to: number, low: number, high: number, fill: string, seed: number, lit = false): Shape[] => {
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

/** Birds crossing the sky by day, wings beating, fading in and out at the ends of their run. */
export const birds = (at: At, now: number, light: Light): Shape[] =>
  [0, 1, 2].map(i => {
    const dx = mod(now / 260 + i * 37 + 9 * rnd('bird', i), 120) - 60
    const up = 14 + 2.5 * i + Math.sin(now / 1100 + i) * 0.8
    const flap = Math.sin(now / 140 + i * 2) * 0.55

    return line(placer(at)([[dx - 0.9, up + flap], [dx, up], [dx + 0.9, up + flap]]), 0.2 * at.s, '#2a2a36', 0.8 * light.day * Math.min(1, (60 - Math.abs(dx)) / 6))
  })

/** Mist drifting along the slopes, thinning out to the stop's edges. */
const mist = (at: At, now: number, up: number): Shape[] =>
  [0, 1, 2].map(i => {
    const dx = mod(now / 400 + i * 41, 110) - 55

    return dot(at, dx, up + i * 2.2, 14, 1.3, '#ffffff', 0.22 * Math.min(1, (55 - Math.abs(dx)) / 20))
  })

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

/** Where London's bus is along Westminster, across the stop and round again, and how much of it shows: it fades in at one end and out at the other. */
const londonBus = (now: number): { dx: number; fade: number } => {
  const dx = mod(now / 90, 104) - 55

  return { dx, fade: Math.max(0, Math.min(1, (dx + 55) / 4, (49 - dx) / 4)) }
}

/** Its clock at the hour in London, and a red bus going by. */
const bigBenMoving = (at: At, now: number, light: Light): Shape[] => {
  const p = placer(at)
  const hand = (turns: number, length: number): Shape => line(p([[0, 13.1], [Math.sin(turns * 2 * Math.PI) * length, 13.1 + Math.cos(turns * 2 * Math.PI) * length]]), 0.18 * at.s, '#2a2a30')
  const { dx: bus, fade } = londonBus(now)

  return [
    hand((light.hour % 12) / 12, 0.75),
    hand(light.hour % 1, 1.15),
    ...(fade > 0 ? [box(at, bus, 0.4, bus + 6, 3.6, '#d43a30', fade), dot(at, bus + 1.2, 0.45, 0.55, 0.55, '#202024', fade), dot(at, bus + 4.8, 0.45, 0.55, 0.55, '#202024', fade)] : []),
  ]
}

/** The bus's windows, glass by day and lit by night. */
const busWindows = (at: At, now: number, light: Light): Shape[] => {
  const { dx: bus, fade } = londonBus(now)
  if (fade === 0) return []
  const alpha = (0.35 + 0.5 * light.dark) * fade

  return [box(at, bus + 0.4, 2.3, bus + 5.6, 3.1, '#ffe2a0', alpha), box(at, bus + 0.4, 1.2, bus + 5.6, 1.9, '#ffe2a0', alpha)]
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

/** The pyramids of Khufu, Khafre (its casing still on its cap) and Menkaure, the Sphinx before them. */
const gizaPyramids = (at: At): Shape[] => [...pyramid(at, -6, 8, 8.4, true), ...pyramid(at, 8, 11, 11), ...pyramid(at, 25, 5, 5), sphinx(at, -22)]

/** The pyramids and the Sphinx floodlit for the night's show. */
const gizaLights = (at: At): Shape[] => [...glow(at, 4, 5, 24, 8, '#ffcf80', 0.16), ...gizaPyramids(at).map(shape => ({ ...shape, fill: '#f0b860', alpha: 0.42 }))]

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
    // Its pool, narrowing to the horizon.
    poly(p([[-1.2, -0.2], [1.2, -0.2], [2.6, (at.y - at.bottom) / at.s], [-2.6, (at.y - at.bottom) / at.s]]), '#5a7cb0'),
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
    ...water(at, 2, 55, 2, '#2c6aa6'),
    // Corcovado's forest, its sunlit side, then Sugarloaf's bare granite.
    poly(p([[-30, 0], [-16, 6], [-9, 12.4], [-6.6, 13.2], [-4.4, 12], [2, 5], [10, 0]]), '#3a6a44'),
    poly(p([[-30, 0], [-16, 6], [-9, 12.4], [-6.6, 13.2], [-11, 7], [-18, 2.6]]), '#4a7c4e', 0.7),
    poly(p([[10, 0], [12, 5], [15, 8.4], [18, 8.8], [20.6, 7], [22.6, 2.4], [24, 0]]), '#7a8276'),
    poly(p([[10, 0], [12, 5], [15, 8.4], [14.6, 3.6], [16, 0]]), '#4a7248'),
    // The statue, arms out, its robe widening down.
    poly(p([[-7.25, 13.1], [-6.95, 16.2], [-6.25, 16.2], [-5.95, 13.1]]), '#f4eee4'),
    box(at, -8.8, 15.5, -4.4, 16.05, '#f4eee4'),
    dot(at, -6.6, 16.65, 0.48, 0.48, '#f4eee4'),
    ...palm(at, -40, 6),
    ...palm(at, 33, 5.4),
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
      // Thinning out to the curtain's ends, not cut off over the neighbours' skies.
      const shown = light.dark * Math.max(0, Math.min(1, (60 - Math.abs(dx + 0.65)) / 12))
      glow[0]?.push(box(at, dx, foot, dx + 1.3, foot + 1.2, colour, 0.34 * shown))
      glow[1]?.push(box(at, dx, foot + 1.2, dx + 1.3, (foot + top) / 2 + 0.6, colour, 0.17 * shown))
      glow[2]?.push(box(at, dx, (foot + top) / 2 + 0.6, dx + 1.3, top, colour, 0.07 * shown))
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
  const acacia = (dx: number, h: number): Shape[] => [line(p([[dx, 0], [dx - 0.3, h * 0.6], [dx - 1.6, h]]), 0.4 * at.s, '#5a4232'), line(p([[dx - 0.3, h * 0.6], [dx + 1.4, h]]), 0.35 * at.s, '#5a4232'), dot(at, dx, h + 0.4, 4.4, 0.9, '#4a6a2c'), dot(at, dx + 0.6, h + 0.9, 2.8, 0.6, '#5e7e36')]
  const giraffe = (dx: number, k: number): Shape[] => [dot(at, dx, 4.4 * k, 1.5 * k, 0.8 * k, '#d29a46'), line(p([[dx + 1 * k, 4.6 * k], [dx + 2.2 * k, 8 * k]]), 0.45 * at.s * k, '#d29a46'), dot(at, dx + 2.5 * k, 8.1 * k, 0.6 * k, 0.32 * k, '#c08838'), ...[-1, -0.6, 0.6, 1].map(lx => line(p([[dx + lx * k, 4 * k], [dx + lx * k * 1.1, 0]]), 0.22 * at.s, '#b07a34')), ...[[-0.6, 4.6], [0.3, 4.2], [0.9, 4.7]].map(([sx = 0, sy = 0]) => dot(at, dx + sx * k, sy * k, 0.28 * k, 0.2 * k, '#8a5426'))]

  return [
    poly(p([[-40, 0], [-18, 6.4], [-12, 7.2], [-6, 6.6], [16, 0]]), '#7a86a6'),
    poly(p([[-17, 5.8], [-12, 7.2], [-6.6, 6.6], [-9, 6.2], [-12, 6.6], [-14.6, 5.8]]), '#f6e8e4', 0.85),
    ...acacia(-26, 4.4),
    ...acacia(20, 5.4),
    ...acacia(38, 3.8),
    ...giraffe(6, 1),
    ...giraffe(11, 0.8),
  ]
}

/** El Castillo: its terraces, its stair, its temple. */
const castillo = (at: At): Shape[] => [
  ...Array.from({ length: 6 }, (_, step) => box(at, -10 + step * 1.3, step * 1.3, 10 - step * 1.3, step * 1.3 + 1.3, step % 2 === 0 ? '#c8b890' : '#b8a880')),
  box(at, -1.3, 0, 1.3, 7.8, '#a89870'),
  box(at, -2.6, 7.8, 2.6, 10.2, '#c8b890'),
  box(at, -2.9, 10.2, 2.9, 10.7, '#a89870'),
]

const chichen = (at: At): Shape[] => [
  ridge(at, -55, 55, 4.4, 1.2, '#2e5a34', 5),
  ...castillo(at),
  box(at, -0.7, 7.8, 0.7, 9.4, '#3a3028'),
  ...[-30, -22, 18, 27, 36].flatMap(dx => roundTree(at, dx, 5 + 2 * rnd('jungle', dx), '#2e6a3a', '#4a8a4a')),
]

/** El Castillo lit gold for the night's show, a glow round it, its temple's door dark. */
const chichenLights = (at: At): Shape[] => [...glow(at, 0, 5, 15, 7, '#ffc070', 0.2), ...castillo(at).map(shape => ({ ...shape, fill: '#f2b864', alpha: 0.55 })), box(at, -0.7, 7.8, 0.7, 9.4, '#2a2018')]

/** Diamond Head's skyline, west to east: the long notched rim rising to Le'ahi's summit, then its steep fall to the sea. */
const DIAMOND_HEAD: readonly Point[] = [[-26, 0], [-22, 1.2], [-18, 2.6], [-14, 3.8], [-10, 5], [-7, 5.9], [-5.6, 5.4], [-4, 6.5], [0, 7.5], [2.6, 7.9], [4, 7.2], [5.6, 8.4], [9, 9], [11, 8.9], [12.4, 8.1], [14, 9.4], [17, 10.3], [18.4, 9.8], [20, 11.3], [22, 12.2], [23.2, 12], [24.6, 11], [26.6, 8.8], [28.6, 6.4], [30.6, 4], [32.6, 2.2], [35, 0.8], [37, 0]]

/** Diamond Head over the bay, the Ko'olau range pale behind: its olive slopes fluted by gullies, its rim catching the light, Le'ahi's bare summit, the seaward face in shade, trees along its foot. */
const diamondHead = (at: At): Shape[] => {
  const p = placer(at)
  const shapes: Shape[] = [
    ridge(at, -55, 4, 8, 1.6, '#94b4bc', 2),
    poly(p(DIAMOND_HEAD), '#80895a'),
    // Its lower slopes greener, with kiawe scrub.
    poly(p([[-24, 0], ...DIAMOND_HEAD.slice(2, -2).map(([dx, up]): Point => [dx, 2.6 + (up - 2.6) * (0.36 + 0.06 * Math.sin(dx * 1.3))]), [35, 0]]), '#6c8248', 0.7),
    poly(p([[16, 10.1], [17, 10.3], [18.4, 9.8], [20, 11.3], [22, 12.2], [23.2, 12], [24.6, 11], [22.4, 9.2], [19, 8.6]]), '#a28c62', 0.85),
    poly(p([[22, 12.2], [23.2, 12], [24.6, 11], [26.6, 8.8], [28.6, 6.4], [30.6, 4], [32.6, 2.2], [35, 0.8], [37, 0], [23, 0]]), '#56643a', 0.55),
  ]
  // The gullies down its face, each with a sunlit ridge beside it.
  const ribs = [-6.6, -2.2, 2.2, 6.6, 11, 15, 18.8, 22, 25.4]
  for (const dx of ribs) shapes.push(line(p([[dx - 0.6, heightAlong(DIAMOND_HEAD, dx - 0.6) - 0.35], [dx - 0.6 + (dx - 6) * 0.09, 2.6]]), 0.38 * at.s, '#9ea66c', 0.5))
  for (const dx of ribs) shapes.push(line(p([[dx, heightAlong(DIAMOND_HEAD, dx) - 0.3], [dx + (dx - 6) * 0.1, 2.6]]), 0.32 * at.s, '#58683a', 0.6))
  shapes.push(line(p(DIAMOND_HEAD.slice(2, -2).map(([dx, up]): Point => [dx, up - 0.3])), 0.4 * at.s, '#b2a874', 0.55))
  for (let dx = -19; dx < 29; dx += 7) shapes.push(dot(at, dx + 2 * rnd('diamond-head-tree', dx), 2.9, 2 + rnd('diamond-head-tree-w', dx), 0.75, '#56743c'))

  return shapes
}

/** Waikiki's water: deep blue out by the reef, turquoise over the sand, the surf's white edge on the beach. */
const waikikiWater = (at: At): Shape[] => {
  const p = placer(at)

  return [
    poly(p([[-31, 0], [-25.5, 2.7], [55, 2.7], [55, 0]]), '#2d82b4'),
    poly(p([[-31, 0], [-28.4, 1.3], [55, 1.3], [55, 0]]), '#3cb4c2'),
    box(at, -25.5, 2.45, 55, 2.7, '#ffffff', 0.2),
    box(at, -31, 0, 55, 0.22, '#f4fbfb', 0.6),
  ]
}

/** Diamond Head's lighthouse at its seaward foot: a white tower, its lantern, its red cap. */
const diamondHeadLighthouse = (at: At): Shape[] => {
  const p = placer(at)

  return [
    poly(p([[29.6, 2.4], [30.4, 3], [32.6, 3.1], [33.4, 2.4]]), '#5a5248'),
    box(at, 31, 2.9, 32, 5.8, '#f6f4ec'),
    box(at, 30.7, 5.7, 32.3, 5.95, '#3a3e44'),
    box(at, 31.1, 5.95, 31.9, 6.45, '#3c4c5c'),
    poly(p([[30.9, 6.45], [31.5, 7.2], [32.1, 6.45]]), '#c03a2e'),
  ]
}

/** Waikiki's beachfront towers, `[from, to, high, wall]`, each with its balconies. */
const WAIKIKI_TOWERS = [[-52.4, -46.4, 4.6, '#dfe6e6'], [-45, -39.6, 10.6, '#f2f0e8'], [-38.8, -34.6, 7.6, '#f0e2cc']] as const

/** The Royal Hawaiian's arched windows: `[dx, up, top]`. */
const ROYAL_HAWAIIAN_ARCHES: readonly (readonly [number, number, number])[] = [
  ...[-32.8, -31.4, -27.2, -25.8].flatMap(dx => [[dx, 0.5, 1.9], [dx, 2.4, 3.5]] as const),
  [-29.6, 0.5, 2.6],
  [-29.6, 4.9, 6.1],
]

/** Waikiki's hotels: white towers with their balconies, and the pink Royal Hawaiian with its tower and arches; with `lit` their windows alone, lit. */
const waikikiHotels = (at: At, lit = false): Shape[] => {
  const p = placer(at)
  const walls: Shape[] = []
  const windows: Shape[] = []
  WAIKIKI_TOWERS.forEach(([from, to, high, wall], i) => {
    walls.push(box(at, from, 0, to, high, wall))
    if (high > 6) walls.push(box(at, to - (to - from) * 0.32, 0, to, high, '#9aa6b4', 0.3), box(at, from - 0.3, high, to + 0.3, high + 0.4, '#c8ccc8'))
    for (let up = 1; up < high - 0.6; up += 1.15) {
      if (!lit) windows.push(box(at, from + 0.3, up, to - 0.3, up + 0.45, '#6e92ae', 0.7))
      else for (let wx = from + 0.4; wx < to - 0.6; wx += 1.15) if (rnd('waikiki-window', i, wx, up) < 0.4) windows.push(box(at, wx, up, wx + 0.75, up + 0.5, '#ffd27a', 0.85))
    }
  })
  const arches = ROYAL_HAWAIIAN_ARCHES.map(([dx, up, top]) => rect(at.x + dx * at.s, at.y - top * at.s, 0.8 * at.s, (top - up) * at.s, lit ? '#ffd89a' : '#b86c7c', 0.85, 0.4 * at.s))
  if (lit) return [...windows, ...arches]
  walls.push(
    box(at, -33.6, 0, -25, 4.2, '#eea4b0'),
    box(at, -27.2, 0, -25, 4.2, '#c87888', 0.3),
    box(at, -33.8, 4, -24.8, 4.45, '#e08c9c'),
    box(at, -30.6, 4.2, -28.2, 6.9, '#eea4b0'),
    poly(p([[-30.8, 6.9], [-30.4, 7.6], [-29.4, 8.2], [-28.4, 7.6], [-28, 6.9]]), '#de8696'),
  )

  return [...walls, ...windows, ...arches]
}

/** The tiki torches along the beach. */
const WAIKIKI_TORCHES = [-36.8, -26.2, -16.6] as const

/** Waikiki's beach: palms, surfboards stood in the sand, a beach umbrella, and its torches on their poles. */
const waikikiBeach = (at: At): Shape[] => {
  const p = placer(at)
  const board = (dx: number, high: number, fill: string): Shape => rect(at.x + dx * at.s, at.y - high * at.s, 0.72 * at.s, high * at.s, fill, 1, 0.36 * at.s)

  return [
    ...palm(at, -23.4, 7.6, '#7a5a3e', '#3a7a40'),
    ...palm(at, -20, 5.8, '#7a5a3e', '#2f6a38'),
    ...palm(at, 40, 6.8, '#7a5a3e', '#3a7a40'),
    ...palm(at, 43.4, 5, '#7a5a3e', '#2f6a38'),
    board(-13.6, 3.3, '#f2c84a'),
    board(-12.7, 3.8, '#ee6a4e'),
    board(-11.8, 3.1, '#4ab4dc'),
    line(p([[-4, 0], [-3.8, 3]]), 0.16 * at.s, '#efe8dc'),
    poly(p([[-6.2, 2.6], [-5.4, 3.2], [-3.8, 3.5], [-2.2, 3.2], [-1.4, 2.6]]), '#e8504a'),
    ...WAIKIKI_TORCHES.map(dx => poly(p([[dx - 0.1, 0], [dx - 0.1, 2.4], [dx - 0.3, 2.85], [dx + 0.3, 2.85], [dx + 0.1, 2.4], [dx + 0.1, 0]]), '#4a3426')),
  ]
}

/** The lamps of the houses along Diamond Head's foot, across the water. */
const DIAMOND_HEAD_LAMPS = Array.from({ length: 8 }, (_, i): Point => [-19 + i * 6 + 2 * rnd('diamond-head-lamp', i), 2.9 + 0.5 * rnd('diamond-head-lamp-up', i)])

/** Waikiki by night: the hotels' windows, the Royal Hawaiian washed pink, lamps along Diamond Head's foot and the lighthouse, their light trailing across the water. */
const waikikiLights = (at: At): Shape[] => {
  const p = placer(at)
  // A light's reflection: a streak across the water toward the beach, fading as it comes.
  const streak = (dx: number, wide: number): Shape => poly(p([[dx - wide, 2.65], [dx + wide, 2.65], [dx + wide * 0.4, 0.4], [dx - wide * 0.4, 0.4]]), '#ffcf7a', 1, { x1: 0, y1: at.y - 2.65 * at.s, x2: 0, y2: at.y - 0.4 * at.s, stops: [[0, '#ffcf7a', 0.55], [1, '#ffcf7a', 0]] })

  return [
    ...glow(at, -37, 4.5, 16, 6, '#ffcf8a', 0.14),
    poly(p([[-33.6, 0], [-33.6, 4.45], [-30.6, 4.45], [-30.6, 6.9], [-29.4, 8.2], [-28.2, 6.9], [-28.2, 4.45], [-25, 4.45], [-25, 0]]), '#ff9fb4', 0.3),
    ...waikikiHotels(at, true),
    ...DIAMOND_HEAD_LAMPS.map(([dx]) => streak(dx, 0.22)),
    streak(31.5, 0.45),
    ...DIAMOND_HEAD_LAMPS.map(([dx, up]) => dot(at, dx, up, 0.2, 0.2, '#ffd78a', 0.9)),
  ]
}

/** Surf rolling in: white lines of foam coming ashore one after another, widening, fading as they break on the sand. */
const waikikiSurf = (at: At, now: number): Shape[] =>
  [0, 1, 2].map(i => {
    const t = now / 7000 + i / 3
    const k = mod(t, 1)
    const set = Math.floor(t)
    const dx = -2 + 32 * rnd('waikiki-surf', i, set)
    const up = 2.35 - 2.1 * k
    const half = 3 + 3 * rnd('waikiki-surf-w', i, set) + 2 * k

    return line(placer(at)([[dx - half, up - 0.1], [dx - half * 0.3, up + 0.1], [dx + half * 0.4, up + 0.06], [dx + half, up - 0.12]]), (0.22 + 0.2 * k) * at.s, '#ffffff', 0.8 * Math.sin(Math.PI * k))
  })

/** An outrigger canoe paddling across the bay, its float out alongside, its crew's paddles pulling together; home by nightfall. */
const waikikiCanoe = (at: At, now: number, light: Light): Shape[] => {
  const p = placer(at)
  const dx = mod(now / 480, 44) - 8
  const fade = Math.max(0, Math.min(1, (dx + 8) / 4, (36 - dx) / 4)) * (1 - light.dark)
  if (fade < 0.01) return []
  const up = 1.05 + 0.08 * Math.sin(now / 470)
  const pull = Math.sin(now / 300)
  const crew = [-1.6, 0, 1.6]

  return [
    line(p([[dx - 0.7, up + 0.45], [dx - 0.9, up + 1.05], [dx - 1.9, up + 1.05], [dx + 2.1, up + 1.05], [dx + 1.1, up + 1.05], [dx + 1, up + 0.45]]), 0.24 * at.s, '#e6dcc4', fade),
    poly(p([[dx - 3.4, up + 0.6], [dx - 2.9, up], [dx + 2.9, up], [dx + 3.6, up + 0.65], [dx + 2.6, up + 0.45], [dx - 2.6, up + 0.45]]), '#d04a30', fade),
    ...crew.map(cx => dot(at, dx + cx, up + 0.95, 0.24, 0.52, '#4a2e22', fade)),
    ...crew.map(cx => line(p([[dx + cx + 0.3, up + 1.05], [dx + cx - 0.1 + 0.5 * pull, up + 0.05]]), 0.14 * at.s, '#6a4a32', fade)),
  ]
}

/** A surfer riding a wave in toward the beach, crouched on the board, white water trailing; out of the water by night. */
const waikikiSurfer = (at: At, now: number, light: Light): Shape[] => {
  const p = placer(at)
  const k = mod(now / 11_000 + 0.3, 1)
  const dx = 36 - 24 * k
  const up = 2.1 - 1.2 * k
  const fade = Math.min(1, 3 * Math.sin(Math.PI * k)) * (1 - light.dark)
  if (fade < 0.01) return []
  const bob = 0.06 * Math.sin(now / 300)

  return [
    line(p([[dx - 0.3, up + 0.1], [dx + 1.4, up + 0.4], [dx + 3.8, up + 0.15]]), 0.5 * at.s, '#ffffff', 0.85 * fade),
    line(p([[dx - 0.9, up + 0.05 + bob], [dx + 0.9, up + 0.18 + bob]]), 0.24 * at.s, '#f2c84a', fade),
    line(p([[dx + 0.2, up + 0.25 + bob], [dx - 0.1, up + 0.9 + bob], [dx + 0.15, up + 1.45 + bob]]), 0.32 * at.s, '#5a3a2a', fade),
    dot(at, dx + 0.2, up + 1.75 + bob, 0.25, 0.25, '#5a3a2a', fade),
  ]
}

/** A rainbow over Diamond Head of a morning while the sun is low (none with it high), its far end behind the rim. */
const waikikiRainbow = (at: At, light: Light): Shape[] => {
  const alpha = 0.24 * light.day * Math.max(0, Math.min(1, (0.75 - light.sun) / 0.3))
  if (light.hour > 12 || alpha < 0.01) return []
  const p = placer(at)

  return ['#ff6a5a', '#ffaa4a', '#ffe066', '#7ad67a', '#5aa8f0', '#9a7ae8'].map((colour, i) => {
    const r = 16.4 - 0.42 * i
    const arc: Point[] = []
    for (let a = 0; a <= 180; a += 4) {
      const dx = 5 - r * Math.cos((a * Math.PI) / 180)
      const up = -3 + r * Math.sin((a * Math.PI) / 180)
      if (up > Math.max(2.8, heightAlong(DIAMOND_HEAD, dx) + 0.4)) arc.push([dx, up])
    }

    return line(p(arc), 0.44 * at.s, colour, alpha)
  })
}

/** The torches lit at sunset, flickering, and the lighthouse's lamp pulsing by night. */
const waikikiFlames = (at: At, now: number, light: Light): Shape[] => {
  const lit = light.hour > 12 ? Math.max(light.dark, 0.7 * light.golden) : light.dark
  const lamp = light.dark * (0.6 + 0.4 * Math.max(0, Math.sin(now / 900)))
  const flicker = (i: number): number => 0.8 + 0.2 * Math.sin(now / 80 + i * 2) * Math.sin(now / 33 + i)

  return [
    ...(lit < 0.02 ? [] : [...WAIKIKI_TORCHES.flatMap((dx, i) => glow(at, dx, 3.2, 1.3, 1.4, '#ffa040', 0.45 * lit * flicker(i))), ...WAIKIKI_TORCHES.map((dx, i) => dot(at, dx, 3.1 + 0.1 * flicker(i), 0.2, 0.42 * flicker(i), '#ffd47a', lit))]),
    ...(lamp < 0.01 ? [] : [...glow(at, 31.5, 6.2, 2.2, 1.8, '#fff2c0', 0.5 * lamp), dot(at, 31.5, 6.2, 0.36, 0.3, '#fffbe8', lamp)]),
  ]
}

/** Where the Golden Gate's towers stand. */
const GOLDEN_GATE_TOWERS = [-21, 21] as const
/** How high its towers stand. */
const GOLDEN_GATE_TOP = 15
/** How high the top of its deck is. */
const GOLDEN_GATE_DECK = 4.4

/** The main cable's height `dx` across: hung from the tower tops, sagging to just over the deck mid-span, and down the side spans to the pylons at 44. */
const goldenGateCable = (dx: number): number => {
  const x = Math.abs(dx)
  if (x <= 21) return 5 + (14.3 - 5) * (x / 21) ** 2
  const t = Math.min(1, (x - 21) / 23)

  return 14.3 + (5.4 - 14.3) * t - 1.6 * t * (1 - t)
}

/** The main cable from `from` to `to` across, as points along it. */
const goldenGateCablePath = (from: number, to: number): Point[] => {
  const steps = Math.round(Math.abs(to - from) / 1.5)

  return Array.from({ length: steps + 1 }, (_, i): Point => {
    const dx = from + ((to - from) * i) / steps

    return [dx, goldenGateCable(dx)]
  })
}

/** A tower of the bridge at `c`: two tapering legs and the portals stacked between them, shorter up to its crown; with `lit` its silhouette alone, floodlit. */
const goldenGateTower = (at: At, c: number, lit = false): Shape[] => {
  const p = placer(at)
  const fill = lit ? '#ff9c58' : '#c4382c'
  const alpha = lit ? 0.72 : 1
  const shapes: Shape[] = [
    // Each leg stepping in at its crown.
    ...[-1, 1].map(side => poly(p([[c + side * 1.9, 0], [c + side * 1.5, GOLDEN_GATE_TOP - 0.5], [c + side * 1.38, GOLDEN_GATE_TOP - 0.5], [c + side * 1.38, GOLDEN_GATE_TOP], [c + side * 0.74, GOLDEN_GATE_TOP], [c + side * 0.74, GOLDEN_GATE_TOP - 0.5], [c + side * 0.62, GOLDEN_GATE_TOP - 0.5], [c + side * 0.82, 0]]), fill, alpha)),
    ...([[2.4, 3], [7.1, 7.7], [10, 10.5], [12.2, 12.65], [13.9, 14.5]] as const).map(([up, top]) => box(at, c - 1.6, up, c + 1.6, top, fill, alpha)),
  ]
  if (lit) return shapes
  // Each leg's fluting, lit on the left and shaded on the right, and the shadow under each portal.
  for (const side of [-1, 1]) shapes.push(line(p([[c + side * 1.36 - 0.12, 0.2], [c + side * 1.06 - 0.1, GOLDEN_GATE_TOP - 0.7]]), 0.18 * at.s, '#e0624a', 0.7))
  for (const side of [-1, 1]) shapes.push(line(p([[c + side * 1.36 + 0.3, 0.2], [c + side * 1.06 + 0.25, GOLDEN_GATE_TOP - 0.7]]), 0.24 * at.s, '#7e2420', 0.6))
  for (const up of [7.1, 10, 12.2, 13.9]) shapes.push(box(at, c - 0.7, up, c + 0.7, up + 0.18, '#7e2420', 0.7))
  shapes.push(box(at, c - 2.5, 0, c + 2.5, 1.2, '#a8aaa4'), box(at, c - 2.5, 1, c + 2.5, 1.2, '#d0d2cc'))

  return shapes
}

/** The Golden Gate Bridge: its towers, the suspenders hung from its cables, the cables, its deck and the concrete pylons at either end. */
const goldenGate = (at: At): Shape[] => {
  const p = placer(at)
  // The suspenders as one shape: each a thin sliver up to the cable and back, joined along the deck.
  const hangers: Point[] = []
  for (let dx = -42.5; dx <= 42.5; dx += 1.5) {
    if (Math.abs(Math.abs(dx) - 21) < 1.8) continue
    const up = goldenGateCable(dx)
    hangers.push([dx - 0.06, GOLDEN_GATE_DECK], [dx - 0.06, up], [dx + 0.06, up], [dx + 0.06, GOLDEN_GATE_DECK])
  }

  return [
    ...GOLDEN_GATE_TOWERS.flatMap(c => goldenGateTower(at, c)),
    poly(p(hangers), '#b8443a', 0.85),
    ...([[-44, -21], [-21, 21], [21, 44]] as const).map(([from, to]) => line(p(goldenGateCablePath(from, to)), 0.44 * at.s, '#b03a30')),
    box(at, -48, 3.4, 48, GOLDEN_GATE_DECK, '#c4382c'),
    box(at, -48, 3.4, 48, 3.8, '#842a24', 0.85),
    box(at, -48, GOLDEN_GATE_DECK - 0.12, 48, GOLDEN_GATE_DECK + 0.08, '#e46a50', 0.8),
    // The pylons where the cables come down.
    ...[-1, 1].flatMap(side => [box(at, side * 43, 0, side * 45.2, 5.9, '#a29c8e'), box(at, side * 42.7, 5.5, side * 45.5, 5.9, '#bab4a6'), box(at, side * 44.4, 0, side * 45.2, 5.5, '#7e7a70', 0.5)]),
  ]
}

/** The shores: the Marin Headlands behind, pale with distance, nearer their golden-green slopes to the north; the Presidio's bluff and cypresses to the south, and the city beyond. */
const goldenGateShores = (at: At): Shape[] => {
  const p = placer(at)

  return [
    ridge(at, -8, 55, 9.5, 1.8, '#a4b6b6', 5),
    // The city far off: its towers and the Transamerica Pyramid.
    ...([[-42.4, -40.8, 5.8], [-36.8, -35.2, 6.8], [-34.8, -33.4, 5.4], [-33, -31.4, 6.2]] as const).map(([from, to, high]) => box(at, from, 0, to, high, '#a8b6c6')),
    poly(p([[-40.3, 0], [-38.8, 9.4], [-37.3, 0]]), '#b6c4d2'),
    poly(p([[24, 0], [28, 2.4], [32, 4.6], [36, 6.6], [40, 7.6], [44, 7.9], [48, 7.2], [51, 5.6], [53.4, 3.6], [55, 2.5], [55, 0]]), '#8a9a62'),
    poly(p([[34, 5.6], [36, 6.6], [40, 7.6], [44, 7.9], [48, 7.2], [46, 6.4], [41, 6.2]]), '#a8ac72', 0.8),
    ...([[33, 4.2], [38.5, 5.6], [49.5, 5]] as const).map(([dx, up]) => dot(at, dx, up, 1.6, 0.6, '#667a4a')),
    poly(p([[-55, 0], [-55, 2.6], [-51, 3.6], [-46, 4.3], [-41, 4], [-37.6, 2.8], [-34.6, 1.2], [-33, 0]]), '#56704a'),
    ...([[-51, 4.2], [-47.4, 4.9], [-43.6, 4.6], [-40.4, 4.2]] as const).map(([dx, up], i) => dot(at, dx, up, 1.7 + 0.5 * rnd('presidio-cypress', i), 0.85, '#36503a')),
    ...water(at, -55, 55, 2.4, '#2f5f8e'),
  ]
}

/** The bridge by night: its towers floodlit, a glow round them and in the water below, its cables catching the light, the lamps along its deck, the city's windows. */
const goldenGateLights = (at: At): Shape[] => [
  ...GOLDEN_GATE_TOWERS.flatMap(c => [...glow(at, c, 8.5, 4.6, 9, '#ffb070', 0.14), ...glow(at, c, 1, 3.6, 1.1, '#ffa860', 0.3), ...goldenGateTower(at, c, true)]),
  box(at, -48, GOLDEN_GATE_DECK, 48, GOLDEN_GATE_DECK + 0.6, '#ffcf80', 0.22),
  ...([[-44, -21], [-21, 21], [21, 44]] as const).map(([from, to]) => line(placer(at)(goldenGateCablePath(from, to)), 0.44 * at.s, '#ffb070', 0.3)),
  ...Array.from({ length: 17 }, (_, i) => -42 + i * 5.25).filter(dx => Math.abs(Math.abs(dx) - 21) > 1).map(dx => dot(at, dx, GOLDEN_GATE_DECK + 0.3, 0.17, 0.17, '#ffd27a', 0.95)),
  ...([[-41.6, 5], [-38.8, 6.2], [-36, 6], [-36, 5.1], [-34.1, 4.8], [-32.2, 5.5], [-32.2, 4.8]] as const).map(([dx, up]) => dot(at, dx, up, 0.18, 0.18, '#ffd78a', 0.85)),
]

/** The fog rolling in through the Gate: banks drifting low over the water and up through the towers, thinner by night. */
const goldenGateFog = (at: At, now: number, light: Light): Shape[] =>
  [1.6, 9.4, 4.4, 12.4].flatMap((up, i) => {
    const dx = mod(now / (360 + 70 * i) + i * 23, 88) - 44
    const wide = 9 + 4 * rnd('golden-gate-fog', i)
    const fade = Math.max(0, Math.min(1, (44 - Math.abs(dx)) / 14)) * (1 - 0.55 * light.dark)

    // Soft-edged: three layers, thicker toward its heart (each its own alpha, so none is merged into another's path).
    return [1, 0.72, 0.42].map((k, n) => dot(at, dx + (1 - k) * wide * 0.25, up + (1 - k) * 0.3, wide * k, 1.5 * k, '#f4f6f8', (0.12 + 0.02 * n) * fade))
  })

/** A yacht under sail crossing the bay. */
const goldenGateYacht = (at: At, now: number): Shape[] => {
  const p = placer(at)
  const dx = mod(now / 650, 88) - 44
  const fade = Math.max(0, Math.min(1, (44 - Math.abs(dx)) / 5))
  const up = 0.5 + 0.06 * Math.sin(now / 520)

  return [
    poly(p([[dx - 1.5, up + 0.45], [dx + 1.7, up + 0.45], [dx + 1.2, up], [dx - 1.1, up]]), '#f4f2ec', fade),
    poly(p([[dx - 0.1, up + 0.55], [dx - 0.1, up + 3.6], [dx - 1.4, up + 0.6]]), '#ffffff', fade),
    poly(p([[dx + 0.1, up + 3.2], [dx + 1.4, up + 0.6], [dx + 0.1, up + 0.6]]), '#e8eaee', 0.9 * fade),
  ]
}

/** The red aircraft lights blinking on the tower tops, and by night the cars' lights crossing the deck, white one way and red the other. */
const goldenGateBeacons = (at: At, now: number, light: Light): Shape[] => {
  const blink = (0.5 + 0.5 * Math.sin(now / 320)) ** 3 * (0.35 + 0.65 * light.dark)
  const cars = light.dark < 0.05 ? [] : Array.from({ length: 6 }, (_, i) => {
    const east = i % 2 === 0
    const dx = mod((east ? now : -now) / 70 + i * 16, 92) - 46

    return dot(at, dx, GOLDEN_GATE_DECK + 0.22, 0.24, 0.14, east ? '#fff4d0' : '#ff5a48', 0.9 * light.dark * Math.max(0, Math.min(1, (46 - Math.abs(dx)) / 3)))
  })

  return [...(blink < 0.01 ? [] : GOLDEN_GATE_TOWERS.flatMap(c => glow(at, c, GOLDEN_GATE_TOP + 0.2, 0.9, 0.8, '#ff4234', blink))), ...cars]
}

/** The canyon's rocks from the rim down to the river (the Kaibab's and Coconino's cream, the Hermit's and Supai's reds, the Redwall, the Tonto's grey-purple bench, the dark schist): how deep each reaches (0 the rim, 1 the river), its colour, and how far its slope spreads (a cliff little, the Tonto's bench far). */
const GRAND_CANYON_STRATA = [
  [0.08, '#e2d4b8', 0.5],
  [0.18, '#f2e0b6', 0.3],
  [0.28, '#c85c3a', 1.6],
  [0.45, '#de874c', 2.2],
  [0.64, '#ac4430', 0.5],
  [0.84, '#9a8290', 4],
  [1, '#5c4858', 1.2],
] as const

/** A butte or mesa: its middle, its top's half-width, how deep its top lies, and how far its slopes spread. */
type GrandCanyonMesa = readonly [number, number, number, number]

/** How deep the rock lies `dx` across a row of mesas: as shallow as the highest of them there, each stepping down stratum by stratum from its top. */
const grandCanyonDepth = (mesas: readonly GrandCanyonMesa[], dx: number): number =>
  Math.min(
    1.1,
    ...mesas.map(([middle, half, top, spread]) => {
      let left = Math.abs(dx - middle) - half
      let depth = top
      let from = 0
      for (const [to, , run] of GRAND_CANYON_STRATA) {
        if (to > depth && left > 0) {
          const reach = (run * spread * (to - depth)) / (to - from)
          depth = left < reach ? depth + ((to - depth) * left) / reach : to
          left -= reach
        }
        from = to
      }

      return left > 0 ? 1.1 : depth
    }),
  )

/** An edge's samples, those on a straight run between their neighbours left out. */
const grandCanyonEdge = (points: readonly Point[]): Point[] => {
  const kept: Point[] = []
  for (const [i, point] of points.entries()) {
    const last = kept[kept.length - 1]
    const next = points[i + 1]
    if (last !== undefined && next !== undefined && Math.abs((point[1] - last[1]) * (next[0] - last[0]) - (next[1] - last[1]) * (point[0] - last[0])) < 0.02) continue
    kept.push(point)
  }

  return kept
}

/** A row's edge between `low` and `high` up: a shape for each stretch of it that rises above `low`. */
const grandCanyonBand = (at: At, edge: readonly Point[], low: number, high: number, fill: string): Shape[] => {
  const runs: Point[][] = []
  let run: Point[] = []
  let last: Point | undefined
  for (const [dx, up] of edge) {
    const crossing = last !== undefined && (up > low) !== (last[1] > low) ? last[0] + ((dx - last[0]) * (low - last[1])) / (up - last[1]) : dx
    if (up > low && run.length === 0) run.push([crossing, low])
    if (up > low) run.push([dx, Math.min(high, up)])
    else if (run.length > 0) {
      runs.push([...run, [crossing, low]])
      run = []
    }
    last = [dx, up]
  }
  if (run.length > 0) runs.push([...run, [last?.[0] ?? 55, low]])

  return runs.map(points => poly(placer(at)(grandCanyonEdge(points)), fill))
}

/** A row of the canyon's buttes, its rim `rim` up and its river `drop` below that, hazed `haze` toward the distance: their strata, their right sides in shade `shade` wide, and with `deep` the haze of the depths over their feet that high. */
const grandCanyonRow = (at: At, mesas: readonly GrandCanyonMesa[], rim: number, drop: number, haze: number, shade: number, deep = 0): Shape[] => {
  const xs = Array.from({ length: 441 }, (_, i) => -55 + i * 0.25)
  // Down to the ground at the stop's very ends, so its neighbours meet it low.
  const upAt = (dx: number): number => Math.max(-0.2, Math.min(rim - drop * grandCanyonDepth(mesas, dx), (55 - Math.abs(dx)) * 1.5))
  const whole = xs.map((dx): Point => [dx, upAt(dx)])
  const lit = xs.map((dx): Point => [dx, upAt(dx + shade)])
  // Each stratum in shade over the whole row, then lit over the row moved left: its right sides left in shade.
  const strata = (edge: readonly Point[], tint: (colour: string) => string): Shape[] =>
    GRAND_CANYON_STRATA.flatMap(([to, colour], i) => {
      const high = rim - drop * (GRAND_CANYON_STRATA[i - 1]?.[0] ?? 0)

      return high > 0 ? grandCanyonBand(at, edge, Math.max(-0.2, rim - drop * to), high, tint(colour)) : []
    })

  return [
    ...strata(whole, colour => mix(mix(colour, '#4a2a44', 0.42), '#b8b6dc', haze)),
    ...strata(lit, colour => mix(colour, '#b8b6dc', haze)),
    ...(deep > 0 ? grandCanyonBand(at, whole, -0.2, deep, '#c4c0e2').map(shape => ({ ...shape, grad: { x1: 0, y1: at.y, x2: 0, y2: at.y - deep * at.s, stops: [[0, '#c4c0e2', 0.75], [1, '#c4c0e2', 0]] as const } })) : []),
  ]
}

/** The Desert View Watchtower: its round stone shaft and the low round kiva at its foot, lit from the left and shaded round to the right, the lookout at its top, its windows. */
const desertViewTower = (at: At): Shape[] => {
  const p = placer(at)
  const shade = '#7c6652'
  const dark = '#3e302a'
  // Stone round a drum from `left` to `right`: a highlight left of its middle, shade round to its right.
  const round = (shape: Shape, left: number, right: number): Shape => ({ ...shape, grad: { x1: at.x + left * at.s, y1: 0, x2: at.x + right * at.s, y2: 0, stops: [[0, '#a48c70', 1], [0.3, '#ccb698', 1], [0.6, '#ad957a', 1], [1, '#735f4c', 1]] as const } })

  return [
    round(poly(p([[21.8, 2.9], [21.8, 4.2], [22.6, 4.7], [24.1, 4.9], [25.6, 4.7], [26.4, 4.2], [26.4, 2.9]]), '#ad957a'), 21.8, 26.4),
    round(poly(p([[26.2, 2.9], [26.6, 10.6], [29.4, 10.6], [29.8, 2.9]]), '#ad957a'), 26.2, 29.8),
    round(poly(p([[26.3, 10.4], [26.1, 12.2], [29.9, 12.2], [29.7, 10.4]]), '#ad957a'), 26.1, 29.9),
    // Its parapet and the merlons along it.
    poly(p([[25.9, 12.2], [25.9, 12.6], ...[26.1, 27.2, 28.3, 29.4].flatMap((dx): Point[] => [[dx, 12.6], [dx, 13], [dx + 0.5, 13], [dx + 0.5, 12.6]]), [30.1, 12.6], [30.1, 12.2]]), shade),
    ...[26.7, 27.6, 28.5, 29.3].map(dx => box(at, dx, 10.9, dx + 0.45, 11.7, dark)),
    box(at, 27.1, 8, 27.6, 8.6, dark),
    box(at, 28.3, 6.2, 28.8, 6.8, dark),
    box(at, 27.3, 4.4, 27.8, 5, dark),
    box(at, 23, 3.4, 23.5, 4, dark),
  ]
}

/** The rim we look from, its pinyons, and the watchtower on its point; and a low ledge to the left. */
const grandCanyonRim = (at: At): Shape[] => {
  const p = placer(at)

  return [
    poly(p([[11, -0.2], [12.4, 1.2], [13.8, 2.2], [16.4, 2.7], [22, 3], [32, 3.1], [40, 2.6], [46, 1.6], [52, 0.5], [55, 0.1], [55, -0.2]]), '#8e7a64'),
    poly(p([[12.4, 1.2], [13.8, 2.2], [16.4, 2.7], [22, 3], [32, 3.1], [40, 2.6], [46, 1.6], [46, 1.2], [39, 2.1], [30, 2.5], [18, 2.2], [14.4, 1.6]]), '#b4a086'),
    poly(p([[11, -0.2], [12.4, 1.2], [13.8, 2.2], [15, 1.4], [14.2, 0.4], [14.8, -0.2]]), '#6a5a4c'),
    poly(p([[-55, -0.2], [-55, 0.4], [-48, 1.2], [-41, 1.5], [-36, 1.1], [-33, 0.2], [-32, -0.2]]), '#8a7660'),
    ...desertViewTower(at),
    ...([[17.6, 1.3], [35, 1.4], [42, 1.1], [-43, 1.2]] as const).flatMap(([dx, r]) => {
      const foot = dx < 0 ? 1.2 : 2.6

      return [dot(at, dx, foot + r * 0.7, r, r * 0.8, '#3e5636'), dot(at, dx - r * 0.25, foot + r, r * 0.55, r * 0.4, '#5a7448')]
    }),
  ]
}

/** The far rim's mesas: a long level line, notched by side canyons. */
const GRAND_CANYON_FAR_RIM: readonly GrandCanyonMesa[] = [[-33, 9.6, 0, 0.9], [-13, 7.6, 0, 0.9], [4.2, 4.4, 0, 0.9], [27, 15, 0, 0.9]]

/** The canyon from its south rim: the far rim and its forest, the temples, the river winding far down, the nearer buttes, the rim with its watchtower. */
const grandCanyon = (at: At): Shape[] => [
  ...grandCanyonRow(at, GRAND_CANYON_FAR_RIM, 12.4, 9, 0.7, 0.6, 7),
  ...GRAND_CANYON_FAR_RIM.map(([middle, half]) => poly(placer(at)([[middle - half + 0.2, 12.3], [middle - half + 0.6, 12.75], [middle + half - 0.6, 12.8], [middle + half - 0.2, 12.3]]), '#7c8a86')),
  ...grandCanyonRow(at, [[-25, 2, 0.14, 1], [-4, 0.5, 0.02, 0.75], [13, 2.4, 0.22, 0.9], [34, 4.4, 0.3, 1]], 11, 11, 0.26, 1, 5),
  // The Colorado in the inner gorge, wide where it comes out toward us, narrowing as it winds back behind the buttes.
  poly(placer(at)([[-3.6, -0.2], [3.6, -0.2], [3.2, 0.5], [4.6, 1], [7.2, 1.3], [8.6, 1.8], [8.6, 2.1], [6.8, 1.6], [3.6, 1.4], [1.6, 0.9], [0.2, 0.3]]), '#3e9a86'),
  ...grandCanyonRow(at, [[-30, 5, 0.3, 0.8], [-13, 2.6, 0.36, 0.8], [16, 3, 0.4, 0.8]], 9.6, 10, 0, 1.4),
  ...grandCanyonRim(at),
]

/** The watchtower's lookout lit, a window lower down, and the kiva's. */
const desertViewLights = (at: At): Shape[] => [
  ...glow(at, 28, 11.3, 4.4, 3.6, '#ffc870', 0.22),
  ...[26.7, 27.6, 28.5, 29.3].map(dx => box(at, dx, 10.9, dx + 0.45, 11.7, '#ffd27a', 0.9)),
  box(at, 27.1, 8, 27.6, 8.6, '#ffd27a', 0.8),
  box(at, 23, 3.4, 23.5, 4, '#ffd27a', 0.8),
]

/** Condors soaring in slow rings over the canyon, banking as they turn, and the river glinting. */
const grandCanyonMoving = (at: At, now: number, light: Light): Shape[] => {
  const p = placer(at)
  const wings: Point[] = [[-1.8, 0.4], [-1.2, 0.18], [-0.5, 0.1], [0, 0.22], [0.5, 0.1], [1.2, 0.18], [1.8, 0.4], [1.2, 0.02], [0.4, -0.14], [0, -0.3], [-0.4, -0.14], [-1.2, 0.02]]
  const condors = light.day <= 0 ? [] : ([[-14, 14.6, 0, 1], [6, 13, 2.6, -1]] as const).map(([cx, cy, phase, way]) => {
    const a = (way * now) / 7000 + phase
    const dx = cx + 7 * Math.cos(a)
    const up = cy + 1.4 * Math.sin(a)
    const bank = 0.22 * Math.sin(a)

    return poly(p(wings.map(([wx, wy]): Point => [dx + wx * Math.cos(bank) - wy * Math.sin(bank), up + wx * Math.sin(bank) + wy * Math.cos(bank)])), '#2a2224', light.day)
  })

  // Glints where the river comes toward us and up its bend.
  const sparkles = ([[0.2, 0.2, 1.1], [4.9, 1.2, 0.6]] as const).map(([cx, up, half], i) => {
    const dx = cx + half * 0.6 * Math.sin(now / 1700 + i * 2)

    return line(p([[dx - half, up], [dx + half, up + 0.05]]), 0.14 * at.s, '#e8fff8', 0.3 + 0.25 * Math.sin(now / 500 + i * 3))
  })

  return [...condors, ...sparkles]
}

/** The Milky Way over the canyon's dark sky by night: a pale band of light arching across the stars, higher on the left and lower toward the far rim on the right, fading out at its ends, its brightest stars twinkling. */
const grandCanyonMilkyWay = (at: At, now: number, light: Light): Shape[] => {
  if (light.dark < 0.05) return []
  const [ax, ay, bx, by] = [-46, 19.6, 50, 15.2]
  const run = Math.hypot(bx - ax, by - ay)
  const [nx, ny] = [(ay - by) / run, (bx - ax) / run]
  // A point `t` of the way along its arch, `off` to its side.
  const along = (t: number, off: number): Point => [ax + (bx - ax) * t + nx * off, ay + (by - ay) * t + 1.4 * Math.sin(Math.PI * t) + ny * off]
  const ts = Array.from({ length: 9 }, (_, i) => i / 8)
  // Bands of it, each narrower and so brighter toward its middle, each fading in from its ends.
  const bands = ([[2.6, '#aab8f0'], [1.6, '#c4ccf4'], [0.7, '#f4ecdc']] as const).map(([half, colour]) => ({
    ...poly(placer(at)([...ts.map(t => along(t, half)), ...[...ts].reverse().map(t => along(t, -half))]), colour),
    grad: { x1: at.x + ax * at.s, y1: at.y - ay * at.s, x2: at.x + bx * at.s, y2: at.y - by * at.s, stops: [[0, colour, 0], [0.3, colour, 0.06 * light.dark], [0.75, colour, 0.06 * light.dark], [1, colour, 0]] as const },
  }))

  return [
    ...bands,
    ...Array.from({ length: 8 }, (_, i) => {
      const [dx, up] = along(0.1 + (i + 0.5) / 10, 1.8 * (rnd('grand-canyon-star', i) - 0.5))

      return dot(at, dx, up, 0.18, 0.18, '#fff8ec', light.dark * (0.5 + 0.4 * Math.sin(now / (600 + 300 * rnd('grand-canyon-twinkle', i)) + 5 * i)))
    }),
  ]
}

/** A point round the Horseshoe: where it is across, its crest, its foot, and how square on to us the curtain is there (1 facing us, 0 edge on). */
type HorseshoeBrink = readonly [number, number, number, number]

/** The Horseshoe's curve, `u` 0 to 1 round it (the back of the horseshoe farther, so a little higher). */
const horseshoeAt = (u: number): HorseshoeBrink => {
  const turn = Math.PI * (u - 0.5) * 1.05
  const facing = Math.cos(turn)

  return [-6 + 16.5 * Math.sin(turn), 8 + 0.6 * facing, 2.4 + 0.6 * facing, Math.max(0, facing)]
}

/** The Horseshoe's points, round it. */
const HORSESHOE = Array.from({ length: 15 }, (_, i) => horseshoeAt(i / 14))

/** A band round the Horseshoe, between `top` and `bottom` up at each point. */
const horseshoeBand = (at: At, top: (point: HorseshoeBrink) => number, bottom: (point: HorseshoeBrink) => number, fill: string, alpha = 1): Shape =>
  poly(placer(at)([...HORSESHOE.map((point): Point => [point[0], top(point)]), ...[...HORSESHOE].reverse().map((point): Point => [point[0], bottom(point)])]), fill, alpha)

/** The American Falls' crest `dx` across, falling to their rocks 2.6 up. */
const americanFallsCrest = (dx: number): number => 6.6 + ((dx + 44) / 13) * 0.8

/** The Fallsview hotels behind the Skylon: each its left, right, top and colour. */
const NIAGARA_HOTELS = [
  [13, 16.6, 11.6, '#aab4c2'],
  [22, 26.4, 13.8, '#d6cec2'],
  [27.2, 30.4, 11, '#b0b8c4'],
  [35, 38, 10, '#d2cabc'],
] as const

/** Where the Skylon stands. */
const SKYLON = 19

/** The Skylon Tower: its shaft, its pod's dish, windows and cap, its mast. */
const skylonTower = (at: At): Shape[] => {
  const p = placer(at)
  const x = SKYLON

  return [
    poly(p([[x - 0.7, 8], [x - 0.5, 14.6], [x + 0.5, 14.6], [x + 0.7, 8]]), '#dcd8d0'),
    poly(p([[x, 8], [x, 14.6], [x + 0.5, 14.6], [x + 0.7, 8]]), '#b4b0a8'),
    poly(p([[x - 1.4, 14.3], [x - 2.8, 15.2], [x + 2.8, 15.2], [x + 1.4, 14.3]]), '#c4c0b8'),
    box(at, x - 2.8, 15.2, x + 2.8, 16.1, '#4e5e76'),
    poly(p([[x - 2.8, 16.1], [x - 2.2, 16.7], [x + 2.2, 16.7], [x + 2.8, 16.1]]), '#e2ded6'),
    box(at, x - 1, 16.7, x + 1, 17.3, '#c4c0b8'),
    line(p([[x, 17.3], [x, 18.9]]), 0.2 * at.s, '#8a8a90'),
  ]
}

/** Trees along a cliff's top from `from` to `to`, `up(dx)` its height there: dark crowns, then their sunlit tops. */
const niagaraTrees = (at: At, from: number, to: number, up: (dx: number) => number, seed: string): Shape[] => {
  const dark: Shape[] = []
  const lit: Shape[] = []
  for (let dx = from; dx < to; dx += 1.6 + 1.4 * rnd(seed, dx)) {
    const r = 0.9 + 0.8 * rnd(seed, 'r', dx)
    dark.push(dot(at, dx, up(dx) + r * 0.5, r, r * 0.85, '#3a6440'))
    lit.push(dot(at, dx - r * 0.3, up(dx) + r * 0.85, r * 0.5, r * 0.36, '#5e8c4c'))
  }

  return [...dark, ...lit]
}

/** A gorge wall: its grey rock, the darker shale low down, the green slope at its foot. */
const niagaraGorgeWall = (at: At, top: readonly Point[], shale: readonly Point[], talus: readonly Point[]): Shape[] => {
  const p = placer(at)
  const foot = (edge: readonly Point[]): Point[] => [[edge[0]?.[0] ?? 0, -0.2], ...edge, [edge[edge.length - 1]?.[0] ?? 0, -0.2]]

  return [poly(p(foot(top)), '#949088'), poly(p(foot(shale)), '#77716c'), poly(p(foot(talus)), '#4c7648')]
}

/** The water at a fall's crest, pale green, whitening as it falls: a gradient from `crest` down to `foot` up. */
const niagaraFalling = (at: At, crest: number, foot: number): Gradient => ({ x1: 0, y1: at.y - crest * at.s, x2: 0, y2: at.y - foot * at.s, stops: [[0, '#8ccab8', 1], [0.3, '#d6eee8', 1], [1, '#fafdfc', 1]] })

/** The falls from the Canadian shore: the far bank and the upper river's rapids; the Horseshoe's streaming curtain, shaded where it curves away, foaming at its foot; the American Falls on their rocks beyond Goat Island's wooded cliff; the Canadian cliff with its hotels and the Skylon; the green river below. */
const niagara = (at: At): Shape[] => {
  const p = placer(at)

  return [
    ridge(at, -48, 48, 10.4, 0.5, '#7a9a8c', 3),
    horseshoeBand(at, ([, crest]) => crest + 1, ([, crest]) => crest, '#5a9e96'),
    ...([0.08, 0.2, 0.33, 0.45, 0.58, 0.7, 0.83, 0.94] as const).map((u, i) => {
      const [dx, crest] = horseshoeAt(u)

      return line(p([[dx - 1.2, crest + 0.35 + 0.35 * (i % 2)], [dx + 1.2, crest + 0.35 + 0.35 * (i % 2)]]), 0.2 * at.s, '#eaf8f6', 0.8)
    }),
    { ...horseshoeBand(at, ([, crest]) => crest, ([, , foot]) => foot, '#e4f2f0'), grad: niagaraFalling(at, 8.6, 2.4) },
    // Its streaks, narrower where the curtain turns away.
    ...Array.from({ length: 12 }, (_, i) => {
      const [dx, crest, foot, facing] = horseshoeAt((i + 0.5) / 12)
      const half = 0.16 + 0.26 * facing

      return poly(p([[dx - half, crest - 0.8], [dx + half, crest - 0.8], [dx + half * 0.7, foot], [dx - half * 0.7, foot]]), '#bcdcd6', 0.8)
    }),
    // Shade where it curves away from us, at its two ends.
    { ...horseshoeBand(at, ([, crest]) => crest, ([, , foot]) => foot, '#4a8a84'), grad: { x1: at.x - 22.5 * at.s, y1: 0, x2: at.x + 10.5 * at.s, y2: 0, stops: [[0, '#4a8a84', 0.55], [0.22, '#4a8a84', 0], [0.78, '#4a8a84', 0], [1, '#4a8a84', 0.55]] as const } },
    horseshoeBand(at, ([, crest]) => crest + 0.1, ([, crest]) => crest - 0.5, '#5cbe9e'),
    // The foam where it lands, billowing up over its foot: a bank, its billows of all sizes, and fainter spray over them.
    poly(p([...HORSESHOE.map(([dx, , foot]): Point => [dx, foot + 0.3]), [10.4, 2.2], [-22.4, 2.2]]), '#ffffff', 0.92),
    ...Array.from({ length: 9 }, (_, i) => {
      const [dx, , foot] = horseshoeAt((i + 0.2 + 0.6 * rnd('niagara-foam', i)) / 9)

      return dot(at, dx, foot + 0.3 + 0.4 * rnd('niagara-foam-up', i), 1.4 + 1.6 * rnd('niagara-foam-w', i), 0.7 + 0.6 * rnd('niagara-foam-h', i), '#ffffff', 0.92)
    }),
    ...Array.from({ length: 4 }, (_, i) => {
      const [dx, , foot] = horseshoeAt(0.16 + i * 0.22 + 0.08 * rnd('niagara-spray', i))

      return dot(at, dx, foot + 1.4, 2.4 + 1.4 * rnd('niagara-spray-w', i), 1, '#ffffff', 0.42)
    }),
    ...NIAGARA_HOTELS.flatMap(([left, right, top, colour]) => [box(at, left, 7, right, top, colour), ...Array.from({ length: Math.floor((top - 8.6) / 1.3) }, (_, i) => box(at, left + 0.5, 8.8 + i * 1.3, right - 0.5, 9.3 + i * 1.3, '#6c7a90', 0.7))]),
    // The American shore and Goat Island on the left, the Canadian cliff by Table Rock on the right.
    ...niagaraGorgeWall(at, [[-55, 1.4], [-50, 4.2], [-46.4, 6.1], [-44, 6.6], [-31, 7.4], [-29.4, 8], [-25, 8.2], [-23.2, 8], [-22.4, 2.2]], [[-55, 1], [-46, 2.6], [-31, 4], [-22.4, 4.2]], [[-55, 0.6], [-46, 2.2], [-31, 2.8], [-27, 3.8], [-22.2, 2.4]]),
    ...niagaraGorgeWall(at, [[10.4, 2.2], [10.6, 8], [12, 8.2], [22, 8.3], [36, 8], [44, 6.6], [50, 4], [55, 1.4]], [[10.6, 4.2], [22, 5], [40, 4.8], [55, 1.2]], [[10.7, 2.4], [16, 3.6], [26, 4.3], [38, 4.4], [48, 3], [55, 0.8]]),
    poly(p([[10.6, 8], [12, 8.2], [22, 8.3], [36, 8], [44, 6.6], [50, 4], [50, 3.5], [44, 6.1], [36, 7.5], [22, 7.8], [12, 7.7]]), '#5e8a4a'),
    // The rock's joints, down both walls.
    ...([[-27.6, 7.2, 4.8], [-24.6, 6.6, 4.6], [15.2, 7, 5], [23.8, 7.4, 5.6], [27.4, 6.8, 5.4], [35.6, 7.2, 5.4], [41.8, 6, 4.8]] as const).map(([dx, top, foot]) => line(p([[dx, top], [dx + 0.3, (top + foot) / 2], [dx + 0.1, foot]]), 0.16 * at.s, '#6e6a64', 0.35)),
    // The American Falls: their curtain, its streaks, the rocks heaped at their foot and the foam on them.
    { ...poly(p([[-44, americanFallsCrest(-44)], [-31, americanFallsCrest(-31)], [-31, 2.6], [-44, 2.6]]), '#e4f2f0'), grad: niagaraFalling(at, 7.4, 2.6) },
    ...[-42.4, -39.8, -37.2, -34.6, -32.2].map(dx => poly(p([[dx - 0.4, americanFallsCrest(dx) - 0.6], [dx + 0.4, americanFallsCrest(dx) - 0.6], [dx + 0.3, 2.8], [dx - 0.3, 2.8]]), '#bcdcd6', 0.8)),
    poly(p([[-44, americanFallsCrest(-44) + 0.1], [-31, americanFallsCrest(-31) + 0.1], [-31, americanFallsCrest(-31) - 0.4], [-44, americanFallsCrest(-44) - 0.4]]), '#5cbe9e'),
    poly(p([[-45, 1.2], [-45, 2.5], [-43.4, 3.3], [-41.8, 2.8], [-40, 3.5], [-38, 2.9], [-36.2, 3.6], [-34.4, 3], [-32.6, 3.4], [-30.6, 2.5], [-30.6, 1.2]]), '#857a70'),
    ...[-43.2, -40.2, -36.6, -33.2].map((dx, i) => dot(at, dx, 2.9 + 0.3 * (i % 2), 1.9, 0.75, '#ffffff', 0.85)),
    ...niagaraTrees(at, -50, -45, dx => 1.4 + (dx + 55) * 0.52, 'prospect-park'),
    ...niagaraTrees(at, -30, -23.6, () => 8, 'goat-island'),
    ...skylonTower(at),
    ...niagaraTrees(at, 12.6, 17, () => 8.1, 'queen-victoria'),
    ...niagaraTrees(at, 31, 47, dx => 7.9 - Math.max(0, dx - 36) * 0.2, 'queen-victoria'),
    ...water(at, -55, 55, 2.4, '#3a8a7c'),
  ]
}

/** The night's lights: the Skylon's pod and beacon, the hotels' windows, lamps along the Canadian rim. */
const niagaraLights = (at: At): Shape[] => {
  const windows: Shape[] = []
  // On the rows of glass the hotels have by day.
  for (const [left, right, top] of NIAGARA_HOTELS) {
    for (let row = 0, up = 8.8; row < Math.floor((top - 8.6) / 1.3); row += 1, up += 1.3) for (let dx = left + 0.5; dx < right - 0.5; dx += 1) if (rnd('niagara-window', dx, up) < 0.6) windows.push(box(at, dx, up, dx + 0.5, up + 0.5, '#ffd27a', 0.85))
  }

  return [
    ...glow(at, SKYLON, 15.6, 4.6, 2.8, '#ffd27a', 0.24),
    box(at, SKYLON - 2.6, 15.3, SKYLON + 2.6, 16, '#ffd890', 0.85),
    dot(at, SKYLON, 18.9, 0.3, 0.3, '#ff4a40'),
    ...windows,
    ...[12, 17, 22, 28, 34, 40].map(dx => dot(at, dx, 8.7 - Math.max(0, dx - 36) * 0.2, 0.22, 0.22, '#fff0c0', 0.9)),
  ]
}

/** Where the Maid of the Mist is, and which way it faces: up toward the falls and back. */
const maidOfTheMist = (now: number): readonly [number, number] => [-1 + 12 * Math.sin(now / 12000), Math.cos(now / 12000) >= 0 ? 1 : -1]

/** The water streaming down both falls, the plume of spray billowing up, the Skylon's yellow lifts, the Maid of the Mist under the falls, facing the way it goes. */
const niagaraMoving = (at: At, now: number): Shape[] => {
  const p = placer(at)
  // Each streak's place across, its crest and its foot: nine down the Horseshoe, three down the American Falls.
  const falls: (readonly [number, number, number])[] = [
    ...Array.from({ length: 9 }, (_, i): readonly [number, number, number] => {
      const [dx, crest, foot] = horseshoeAt((i + 0.5) / 9)

      return [dx, crest, foot]
    }),
    ...[-41, -37.5, -34].map((dx): readonly [number, number, number] => [dx, americanFallsCrest(dx), 2.8]),
  ]
  const streaks: Shape[][] = [[], []]
  for (const [i, [dx, crest, foot]] of falls.entries()) {
    const k = mod(now / 900 + rnd('niagara-fall', i), 1)
    const up = crest - 0.5 - (crest - foot) * k
    // Each fading in as it comes over the crest, and out into the foam.
    streaks[i % 2]?.push(line(p([[dx, up], [dx, Math.max(foot, up - 1.4)]]), 0.3 * at.s, i % 2 === 0 ? '#ffffff' : '#8cc2c0', 0.85 * Math.sin(Math.PI * k)))
  }
  const plume = Array.from({ length: 5 }, (_, i) => {
    const t = mod(now / 7000 + i / 5, 1)

    return dot(at, -6 + 13 * (rnd('niagara-plume', i) - 0.5) + 3 * t, 4 + 9 * t, 3 + 4 * t, 1.6 + 1.8 * t, '#ffffff', 0.38 * Math.sin(Math.PI * t))
  })
  const lifts = [0, 1].map(i => {
    const up = 9 + 4.6 * (0.5 - 0.5 * Math.cos(now / 6000 + i * 2.4))

    return box(at, SKYLON - 1 + i * 1.6, up, SKYLON - 0.6 + i * 1.6, up + 0.6, '#f2c230')
  })
  const [boat, side] = maidOfTheMist(now)
  const hull = (dx: number, up: number): Point => [boat + side * dx, up]

  return [
    ...streaks.flat(),
    ...plume,
    ...lifts,
    poly(p([hull(-3, 0.5), hull(2.4, 0.5), hull(3.2, 1.4), hull(-3.2, 1.4)]), '#f4f4f0'),
    poly(p([hull(-2.2, 1.4), hull(2, 1.4), hull(2, 2.2), hull(-2.2, 2.2)]), '#3a6ad0'),
    poly(p([hull(-1.3, 2.2), hull(1.1, 2.2), hull(1.1, 2.6), hull(-1.3, 2.6)]), '#f4f4f0'),
    line(p([hull(-2.6, 2.6), hull(-2.6, 3.6)]), 0.12 * at.s, '#3a3a40'),
  ]
}

/** The colours the falls are lit in by night, each in turn. */
const NIAGARA_HUES = ['#4a7aff', '#ff4aa8', '#a05aff', '#3ae0c0', '#ffb040', '#ff5a6a'] as const

/** The colour `k` steps along the falls' lights at `now`: each colour held a while, then blending into the next, a step every 15 s. */
const niagaraHue = (now: number, k: number): string => {
  const turn = now / 15000 + k
  const step = Math.floor(turn)

  return mix(NIAGARA_HUES[mod(step, NIAGARA_HUES.length)] ?? '#ffffff', NIAGARA_HUES[mod(step + 1, NIAGARA_HUES.length)] ?? '#ffffff', Math.min(1, 2 * (turn - step)))
}

/** By day a rainbow in the spray; by night both falls and their mist lit in slowly changing colours, several across the Horseshoe at once, and the boat's windows. */
const niagaraGlowing = (at: At, now: number, light: Light): Shape[] => {
  const p = placer(at)
  const rainbow = light.day <= 0 ? [] : ['#ff5a4a', '#ffa040', '#ffe060', '#6ad070', '#5a9aff', '#9a6ad8'].map((colour, i) => {
    const r = 11.2 - i * 0.34

    return line(p(Array.from({ length: 13 }, (_, k): Point => [-6 + r * Math.cos(Math.PI * (0.18 + 0.64 * (k / 12))), 1 + r * 0.8 * Math.sin(Math.PI * (0.18 + 0.64 * (k / 12)))])), 0.36 * at.s, colour, light.day * (0.22 + 0.06 * Math.sin(now / 2500)))
  })
  if (light.dark <= 0.05) return rainbow
  const lit = 0.55 * light.dark
  // Across the Horseshoe, three colours at once, the light shimmering in bands down the falling water.
  const across = [niagaraHue(now, 0), niagaraHue(now, 1), niagaraHue(now, 2)] as const
  const bands = Array.from({ length: 17 }, (_, k) => {
    const t = k / 16

    return [t, t < 0.5 ? mix(across[0], across[1], 2 * t) : mix(across[1], across[2], 2 * t - 1), lit * (0.72 + 0.28 * Math.sin(now / 380 + k * 2.1))] as const
  })
  const [boat, side] = maidOfTheMist(now)

  return [
    ...rainbow,
    { ...horseshoeBand(at, ([, crest]) => crest, ([, , foot]) => foot, niagaraHue(now, 1)), grad: { x1: at.x - 22.5 * at.s, y1: 0, x2: at.x + 10.5 * at.s, y2: 0, stops: bands } },
    { ...poly(p([[-44, americanFallsCrest(-44)], [-31, americanFallsCrest(-31)], [-31, 2.6], [-44, 2.6]]), niagaraHue(now, 3)), grad: { x1: 0, y1: at.y - 6.6 * at.s, x2: 0, y2: at.y - 2.6 * at.s, stops: [[0, niagaraHue(now, 3), 0.5 * lit], [1, niagaraHue(now, 3), lit]] as const } },
    ...glow(at, -6, 4.4, 15, 4, niagaraHue(now, 1), 0.3 * light.dark),
    box(at, boat - side * 2, 1.6, boat + side * 1.8, 2, '#ffd890', 0.8 * light.dark),
  ]
}

/** A standing stone, each [from, to, base, top, lean]: across, its foot and its head up, and how far its head leans over. */
type Sarsen = readonly [number, number, number, number, number]
/** A lintel on its uprights: [from, to, up, thick]. */
type SarsenLintel = readonly [number, number, number, number]

/** The far side of the sarsen circle, paler across the circle, and its lintels. */
const STONEHENGE_FAR: readonly Sarsen[] = [[-18.4, -16.8, 1.4, 5.6, 0], [-14, -12.4, 1.4, 5.8, 0], [-9.6, -8, 1.4, 5.8, 0], [-4.4, -2.8, 1.4, 5.6, 0.1], [2.4, 4, 1.4, 5.7, 0], [11.6, 13.2, 1.4, 5.8, 0], [16.2, 17.8, 1.4, 5.6, -0.1]]
const STONEHENGE_FAR_LINTELS: readonly SarsenLintel[] = [[-14.3, -7.7, 5.8, 0.8], [11.3, 18.1, 5.7, 0.8]]
/** The horseshoe of trilithons within: two whole, and the Great Trilithon's one upright left standing, leaning. */
const STONEHENGE_INNER: readonly Sarsen[] = [[-10.6, -8.8, 0.8, 7.6, 0], [-8.4, -6.6, 0.8, 7.6, 0], [-1.6, 0.6, 0.8, 9.6, 0.35], [5.6, 7.4, 0.8, 8, 0], [7.8, 9.6, 0.8, 8, 0]]
const STONEHENGE_INNER_LINTELS: readonly SarsenLintel[] = [[-10.9, -6.3, 7.6, 1], [5.3, 9.9, 8, 1]]
/** The near side of the circle: a run still capped, gaps, a broken stump, a pair with its lintel, one leaning. */
const STONEHENGE_NEAR: readonly Sarsen[] = [[-21, -19.2, 0.3, 6.2, 0], [-18.2, -16.4, 0.3, 6.2, 0], [-15.4, -13.6, 0.3, 6.2, 0], [-12.6, -10.8, 0.3, 6.2, 0], [-4.9, -3.1, 0.3, 5.7, -0.15], [2.4, 4.1, 0.3, 3.1, 0], [10.4, 12.2, 0.3, 6, 0], [13.2, 15, 0.3, 6, 0], [18.4, 20, 0.3, 5.3, -0.7]]
const STONEHENGE_NEAR_LINTELS: readonly SarsenLintel[] = [[-21.3, -15.9, 6.2, 0.9], [-16.1, -10.5, 6.25, 0.9], [10.1, 15.3, 6, 0.9]]
/** The fallen: the Great Trilithon's other upright broken in two, a lintel, a stone lying askew. */
const STONEHENGE_FALLEN: readonly (readonly [Point, Point, Point, Point])[] = [
  [[0.8, -0.3], [1, 1.2], [5, 1.4], [5.2, -0.3]],
  [[5.6, -0.3], [5.7, 1], [9.1, 0.8], [9.3, -0.3]],
  [[-9.6, -0.2], [-9.5, 0.8], [-5.6, 0.9], [-5.4, -0.2]],
  [[15.6, -0.2], [16, 0.9], [20.4, 1.3], [20.6, 0.1]],
]
/** The bluestones between, small, each [dx, top]. */
const STONEHENGE_BLUESTONES = [[-23.2, 2], [-8.2, 2.6], [-6, 2.2], [-1.6, 2.4], [4.8, 2.8], [7.6, 2.3], [9.6, 2], [16.4, 2.6], [22, 1.8]] as const

/** A sarsen's outline: bulging a little at its waist, its shoulders rounded, its head rough. */
const sarsenOutline = ([from, to, base, top, lean]: Sarsen, seed: number): Point[] => {
  const rough = (k: number): number => rnd('stonehenge-rough', seed, k) - 0.5
  const waist = base + (top - base) * 0.45

  return [
    [from, base],
    [from - 0.12 + 0.2 * rough(0) + 0.4 * lean, waist],
    [from + 0.08 + lean, top - 0.7 + 0.4 * rough(1)],
    [from + 0.45 + lean, top + 0.25 * rough(2)],
    [(from + to) / 2 + lean + 0.4 * rough(3), top + 0.12 + 0.2 * rough(4)],
    [to - 0.4 + lean, top + 0.25 * rough(5)],
    [to - 0.08 + lean, top - 0.6 + 0.4 * rough(6)],
    [to + 0.1 + 0.2 * rough(7) + 0.4 * lean, waist],
    [to, base],
  ]
}

/** A row of sarsens, each its own grey: their faces, then their shaded right sides, so the shadows are drawn together. */
const sarsenRow = (at: At, stones: readonly Sarsen[], face: string, shade: string, seed: number): Shape[] => {
  const p = placer(at)

  return [
    ...stones.map((stone, i) => poly(p(sarsenOutline(stone, seed + i)), mix(face, '#6e6a5c', 0.22 * rnd('stonehenge-tone', seed + i)))),
    ...stones.map(([, to, base, top, lean]) => poly(p([[to - 0.55, base], [to - 0.5 + 0.9 * lean, top - 0.7], [to - 0.08 + lean, top - 0.7], [to + 0.05 + 0.4 * lean, base + (top - base) * 0.45], [to, base]]), shade, 0.55)),
  ]
}

/** A lintel's outline, its ends worn round. */
const sarsenLintel = ([from, to, up, thick]: SarsenLintel): Point[] => [[from + 0.05, up], [from - 0.05, up + thick * 0.55], [from + 0.2, up + thick], [to - 0.25, up + thick + 0.08], [to + 0.05, up + thick * 0.5], [to - 0.05, up]]

/** Lintels on their uprights, their tops catching the sky and their undersides in shadow. */
const sarsenLintels = (at: At, lintels: readonly SarsenLintel[], face: string, shade: string): Shape[] => [
  ...lintels.map(lintel => poly(placer(at)(sarsenLintel(lintel)), face)),
  ...lintels.map(([from, to, up, thick]) => box(at, from + 0.25, up + thick - 0.2, to - 0.3, up + thick, '#c8c6ba', 0.5)),
  ...lintels.map(([from, to, up]) => box(at, from + 0.2, up, to - 0.2, up + 0.25, shade, 0.6)),
]

/** The circle's own scale: its stones a fifth larger than the stop's units. */
const hengeAt = (at: At): At => ({ ...at, s: at.s * 1.2 })

/** The Heel Stone, apart on the avenue: rough, unworked, leaning toward the circle. */
const heelStone = (at: At): Point[] => placer(at)([[29.4, 0], [29.1, 2.2], [29.4, 4], [30.4, 4.9], [31.4, 4.5], [32.2, 2.6], [32.4, 0]])

/** Stonehenge on Salisbury Plain: the downs and their copses and barrows, the henge's bank, the sarsen circle far side to near, the trilithons and bluestones within, the fallen stones and the Heel Stone. */
const stonehenge = (at: At): Shape[] => {
  const henge = hengeAt(at)
  const p = placer(henge)

  return [
    ridge(at, -55, 55, 3.4, 1.2, '#a6b8ac', 3),
    // Copses of beeches on the downs, and the round barrows.
    ...([[-38, 3.4], [-34.6, 3], [36, 3.2], [39.4, 2.8], [42.4, 2.2]] as const).map(([dx, h]) => dot(at, dx, h * 0.6, 2.2, h * 0.6, '#5e7a5a')),
    ridge(at, -55, 55, 1.8, 0.7, '#7e9e66', 7),
    ...[-28, -24.4, 24.6].map(dx => dot(at, dx, 1.4, 2, 0.9, '#86a46c')),
    poly(p([[-25, 0], [-22, 0.8], [-12, 1.3], [12, 1.3], [22, 0.8], [25, 0]]), '#729a58'),
    ...sarsenRow(henge, STONEHENGE_FAR, '#b0b4b2', '#959aa0', 10),
    ...sarsenLintels(henge, STONEHENGE_FAR_LINTELS, '#b0b4b2', '#8c9096'),
    ...sarsenRow(henge, STONEHENGE_INNER, '#a49e8e', '#77726a', 20),
    ...sarsenLintels(henge, STONEHENGE_INNER_LINTELS, '#a49e8e', '#6a655c'),
    dot(henge, 0.1, 9.75, 0.45, 0.3, '#a49e8e'),
    ...STONEHENGE_BLUESTONES.map(([dx, top], i) => poly(p([[dx - 0.5, 0.4], [dx - 0.6, top - 0.5], [dx - 0.35, top], [dx + 0.3, top + 0.2 * (rnd('stonehenge-blue', i) - 0.5)], [dx + 0.55, top - 0.4], [dx + 0.5, 0.4]]), '#7c848a')),
    ...sarsenRow(henge, STONEHENGE_NEAR, '#958f7e', '#67635a', 30),
    ...sarsenLintels(henge, STONEHENGE_NEAR_LINTELS, '#958f7e', '#5c5850'),
    ...STONEHENGE_FALLEN.map(stone => poly(p(stone), '#8e8b7e')),
    ...STONEHENGE_FALLEN.map(([, left, right]) => line(p([left, right]), 0.3 * henge.s, '#b2ae9e', 0.6)),
    poly(heelStone(henge), '#968e7a'),
    poly(p([[31.6, 0], [31.8, 2.6], [31.4, 4.5], [32.2, 2.6], [32.4, 0]]), '#6e685a', 0.6),
  ]
}

/** Where the gathering's lanterns stand and are carried, [dx, up]: round the circle, within it, and up the avenue to the Heel Stone. */
const STONEHENGE_LANTERNS = [[-29.5, 0.9], [-9.4, 1.8], [2, 2.4], [12.4, 1.6], [28, 0.7], [33.4, 0.8]] as const

/** The stones' silhouettes, dark against the night. */
const sarsenShadows = (at: At, stones: readonly Sarsen[], lintels: readonly SarsenLintel[], seed: number): Shape[] => {
  const p = placer(at)

  return [...stones.map((stone, i) => poly(p(sarsenOutline(stone, seed + i)), '#161824', 0.88)), ...lintels.map(lintel => poly(p(sarsenLintel(lintel)), '#161824', 0.88))]
}

/** The solstice gathering by night: a fire's light warm in the circle, lighting the far stones' faces, the nearer stones dark against it, lanterns round it. */
const stonehengeLights = (at: At): Shape[] => {
  const henge = hengeAt(at)
  // Each ring of every lantern's glow together, so alike rings are drawn as one.
  const lanterns = STONEHENGE_LANTERNS.map(([dx, up]) => glow(at, dx, up, 2, 1.5, '#ffc870', 0.32))

  return [
    ...glow(at, -1, 4.6, 25, 7.6, '#ffb45a', 0.26),
    ...glow(at, -0.6, 1.2, 8, 2.8, '#ffc66a', 0.36),
    ...sarsenShadows(henge, STONEHENGE_INNER, STONEHENGE_INNER_LINTELS, 20),
    dot(henge, 0.1, 9.75, 0.45, 0.3, '#161824', 0.88),
    ...sarsenShadows(henge, STONEHENGE_NEAR, STONEHENGE_NEAR_LINTELS, 30),
    ...[0, 1, 2, 3].flatMap(ring => lanterns.flatMap(rings => rings.slice(ring, ring + 1))),
    ...STONEHENGE_LANTERNS.map(([dx, up]) => dot(at, dx, up, 0.24, 0.3, '#ffe2a0', 0.95)),
  ]
}

/** Sheep grazing the plain, wandering slowly, heads down to the grass and up. */
const stonehengeSheep = (at: At, now: number): Shape[] => {
  const p = placer(at)
  const flock = ([[-46, 1], [-40.5, 0.8], [-34, 1], [41.5, 0.75], [45, 1], [49, 0.8]] as const).map(([home, k], i) => {
    const t = now / 16_000 + 2.3 * i

    return { x: home + 1.6 * Math.sin(t), k, face: Math.cos(t) >= 0 ? 1 : -1, head: Math.max(0, Math.sin(now / 2600 + 1.7 * i)) }
  })

  // Their legs, their fleeces, their heads: each drawn together.
  return [
    ...flock.map(({ x, k }) => line(p([[x - 0.6 * k, 0], [x - 0.55 * k, 0.7 * k], [x + 0.55 * k, 0.7 * k], [x + 0.6 * k, 0]]), 0.2 * at.s, '#2e2a28')),
    ...flock.map(({ x, k }) => dot(at, x, k, k, 0.62 * k, '#f0ece0')),
    ...flock.map(({ x, k, face, head }) => dot(at, x + face * 0.95 * k, (0.5 + 0.55 * head) * k, 0.36 * k, 0.28 * k, '#2e2a28')),
  ]
}

/** The lanterns' flames, flickering. */
const stonehengeFlames = (at: At, now: number, light: Light): Shape[] =>
  light.dark < 0.05 ? [] : STONEHENGE_LANTERNS.map(([dx, up], i) => dot(at, dx, up + 0.05, 0.13, 0.2 * (0.8 + 0.2 * Math.sin(now / 80 + i * 3) * Math.sin(now / 33 + i)), '#fff6d8', light.dark))

/** A spire of the basilica, [middle, half width at its foot, foot, tip]. */
type GaudiSpire = readonly [number, number, number, number]

/** The Nativity façade's four bell towers, the inner pair the taller. */
const SAGRADA_NATIVITY: readonly GaudiSpire[] = [[-13.4, 0.8, 0, 10.8], [-10.8, 0.8, 0, 12.2], [-8.2, 0.8, 0, 12.2], [-5.6, 0.8, 0, 10.8]]
/** The central towers behind: an Evangelist's, Jesus's (the tallest), Mary's, another Evangelist's. */
const SAGRADA_CENTRAL: readonly GaudiSpire[] = [[-2.2, 1, 4, 14.8], [0.8, 1.4, 4, 17.4], [3.9, 1.1, 4, 15.2], [6.6, 0.95, 4, 14.2]]
/** The Passion façade's four bell towers, beyond. */
const SAGRADA_PASSION: readonly GaudiSpire[] = [[9.4, 0.72, 0, 9.6], [11.6, 0.72, 0, 10.8], [13.8, 0.72, 0, 10.8], [16, 0.72, 0, 9.6]]

/** How a Gaudí bell tower narrows up its height, [share of its half width, share of its height]: nearly straight, then curving in to its pinnacle. */
const SAGRADA_PROFILE = [[1, 0], [0.93, 0.55], [0.8, 0.74], [0.58, 0.87], [0.32, 0.96], [0.16, 1]] as const
/** How a central tower narrows: to a sharper point. */
const SAGRADA_POINTED = [[1, 0], [0.96, 0.52], [0.86, 0.68], [0.58, 0.84], [0.28, 0.94], [0.08, 1]] as const

/** A spire's outline. */
const sagradaSpire = ([c, w, foot, tip]: GaudiSpire, profile: readonly (readonly [number, number])[] = SAGRADA_PROFILE): Point[] => [
  ...profile.map(([k, u]): Point => [c - w * k, foot + (tip - foot) * u]),
  ...[...profile].reverse().map(([k, u]): Point => [c + w * k, foot + (tip - foot) * u]),
]

/** A spire's shaded right side. */
const sagradaShade = ([c, w, foot, tip]: GaudiSpire, profile: readonly (readonly [number, number])[] = SAGRADA_PROFILE): Point[] => [
  ...profile.map(([k, u]): Point => [c + 0.25 * w * k, foot + (tip - foot) * u]),
  ...[...profile].reverse().map(([k, u]): Point => [c + w * k, foot + (tip - foot) * u]),
]

/** A bell tower's mosaic pinnacle on its tip, `k` its size: a white mitre. */
const sagradaPinnacle = ([c, , , tip]: GaudiSpire, k: number): Point[] => [[c - 0.18, tip - 0.2], [c - 0.62 * k, tip + 0.7 * k], [c - 0.5 * k, tip + 1.5 * k], [c, tip + 2.1 * k], [c + 0.5 * k, tip + 1.5 * k], [c + 0.62 * k, tip + 0.7 * k], [c + 0.18, tip - 0.2]]

/** A bell tower's spiralling louvres, up its middle. */
const sagradaLouvres = ([c, w, foot, tip]: GaudiSpire): Point[] => {
  const points: Point[] = []
  for (let up = foot + 0.36 * (tip - foot), side = -1; up < foot + 0.76 * (tip - foot); up += 0.7, side = -side) points.push([c + side * 0.5 * w, up])

  return points
}

/** Bell towers: their bodies, shaded sides, and pinnacles white, red-banded and gold-tipped; the Nativity's with their louvres. */
const sagradaBellTowers = (at: At, spires: readonly GaudiSpire[], stone: string, shade: string, k: number, louvres: boolean): Shape[] => {
  const p = placer(at)

  return [
    ...spires.map(spire => poly(p(sagradaSpire(spire)), stone)),
    ...spires.map(spire => poly(p(sagradaShade(spire)), shade, 0.6)),
    ...(louvres ? spires.map(spire => line(p(sagradaLouvres(spire)), 0.24 * at.s, '#5e4a36', 0.55)) : []),
    ...spires.map(spire => poly(p(sagradaPinnacle(spire, k)), '#f4eee4')),
    ...spires.map(([c, , , tip]) => line(p([[c - 0.55 * k, tip + 0.9 * k], [c + 0.55 * k, tip + 0.9 * k]]), 0.3 * at.s * k, '#c8402e')),
    ...spires.map(([c, , , tip]) => dot(at, c, tip + 2.2 * k, 0.28 * k, 0.28 * k, '#e8b830')),
  ]
}

/** Barcelona's Eixample: blocks of six-storey houses in creams and ochres, flat-roofed, their windows; with `lit` the windows alone, some lit. */
const eixample = (at: At, from: number, to: number, seed: number, lit = false): Shape[] => {
  const colours = ['#e6d4b4', '#d4b088', '#ecdcc4', '#c89a70', '#dcc4a0']
  const walls: Shape[] = []
  const windows: Shape[] = []
  for (let dx = from, i = 0; dx < to - 2; i += 1) {
    const w = Math.min(to - dx, 5.4 + 2.4 * rnd('eixample-w', seed, i))
    const h = 4.4 + 1.8 * rnd('eixample-h', seed, i)
    walls.push(box(at, dx, 0, dx + w, h, colours[(seed + i) % colours.length] ?? '#e6d4b4'))
    for (const wy of [1.3, 3.1]) for (let wx = dx + 0.8; wx < dx + w - 0.9; wx += 1.7) if (rnd('eixample-window', seed, i, wx, wy) < (lit ? 0.36 : 0.55)) windows.push(box(at, wx, wy, wx + 0.55, wy + 0.85, lit ? '#ffd27a' : '#6e5e52', 0.85))
    dx += w + (i % 2 === 1 ? 1.4 : 0.15)
  }

  return lit ? windows : [...walls, ...windows]
}

/** Torre Glòries near the sea, a rounded bullet of glass: its body, and its foot in another colour. */
const torreGlories = (at: At, fill: string, foot: string, alpha = 1): Shape[] => {
  const p = placer(at)

  return [poly(p([[30, 0], [30, 6], [30.3, 7.8], [30.9, 9], [31.6, 9.4], [32.3, 9], [32.9, 7.8], [33.2, 6], [33.2, 0]]), fill, alpha), poly(p([[30, 0], [30, 3.4], [33.2, 3.4], [33.2, 0]]), foot, 0.6 * alpha)]
}

/** The nave's tall windows, round-headed, each its own colour (its stained glass by night, cool blues and greens to warm golds and reds). */
const sagradaWindows = (at: At, fills: readonly string[], alpha: number): Shape[] => [-2.9, -0.6, 1.7, 4, 6.3].map((dx, i) => rect(at.x + (dx - 0.4) * at.s, at.y - 4 * at.s, 0.8 * at.s, 2.6 * at.s, fills[i % fills.length] ?? '#6e5c4a', alpha, 0.4 * at.s))

/** The Jesus tower's cross. */
const sagradaCross = (at: At, fill: string, alpha = 1): Shape => poly(placer(at)([[0.55, 17.2], [0.55, 18.3], [-0.05, 18.3], [-0.05, 18.8], [0.55, 18.8], [0.55, 19.6], [1.05, 19.6], [1.05, 18.8], [1.65, 18.8], [1.65, 18.3], [1.05, 18.3], [1.05, 17.2]]), fill, alpha)

/** Mary's tower's twelve-pointed star. */
const sagradaStar = (at: At, fill: string, alpha = 1): Shape => poly(placer(at)(Array.from({ length: 24 }, (_, i): Point => [3.9 + Math.sin((i * Math.PI) / 12) * (i % 2 === 0 ? 0.8 : 0.4), 15.95 + Math.cos((i * Math.PI) / 12) * (i % 2 === 0 ? 0.8 : 0.4)])), fill, alpha)

/** The Sagrada Família: the pale central towers (Jesus's with its cross, Mary's with its star) rising over the nave, the Passion's bell towers beyond, the Nativity façade's in front, its portals and the green cypress of its Tree of Life. */
const sagrada = (at: At): Shape[] => {
  const p = placer(at)

  return [
    ...SAGRADA_CENTRAL.map(spire => poly(p(sagradaSpire(spire, SAGRADA_POINTED)), '#e4dccb')),
    ...SAGRADA_CENTRAL.map(([c, w, foot, tip]) => box(at, c - w * 0.8, foot + (tip - foot) * 0.62, c + w * 0.8, foot + (tip - foot) * 0.62 + 0.4, '#b8ae98')),
    ...SAGRADA_CENTRAL.map(spire => poly(p(sagradaShade(spire, SAGRADA_POINTED)), '#c2b8a2', 0.6)),
    dot(at, -2.2, 15.05, 0.38, 0.45, '#f6f2ea'),
    dot(at, 6.6, 14.45, 0.34, 0.4, '#f6f2ea'),
    sagradaCross(at, '#f6f4ee'),
    sagradaStar(at, '#eef2f6'),
    // The nave, its pinnacles along its roof, its tall windows.
    box(at, -14.6, 0, 17.4, 5.6, '#cdb48c'),
    poly(p([[-4.6, 5.4], ...Array.from({ length: 10 }, (_, i): Point[] => [[-4 + i * 2.1, 6.9], [-3 + i * 2.1, 5.6]]).flat(), [17.4, 5.4]]), '#c4aa80'),
    ...sagradaWindows(at, ['#6e5c4a'], 0.8),
    ...sagradaBellTowers(at, SAGRADA_PASSION, '#d2c6ae', '#a89a82', 0.65, false),
    ...sagradaBellTowers(at, SAGRADA_NATIVITY, '#b89a72', '#8e7254', 0.85, true),
    // The Nativity façade over the towers' feet: its wall, its three portals, its gable and the cypress on top.
    box(at, -14.6, 0, -4.6, 4.6, '#9e8466'),
    ...([[-12.1, 2.8], [-9.5, 3.6], [-6.9, 2.8]] as const).map(([dx, h]) => rect(at.x + (dx - 0.7) * at.s, at.y - h * at.s, 1.4 * at.s, h * at.s, '#5a4634', 0.85, 0.7 * at.s)),
    poly(p([[-11.6, 4.4], [-10.6, 6.4], [-9.5, 7.2], [-8.4, 6.4], [-7.4, 4.4]]), '#a88c6c'),
    poly(p([[-10.1, 6.6], [-9.85, 8.2], [-9.5, 9.4], [-9.15, 8.2], [-8.9, 6.6]]), '#3e7a4e'),
  ]
}

/** Where the crane stands, how high its jib, how long. */
const SAGRADA_CRANE = { dx: 19.8, up: 15.2, jib: 10 } as const

/** The crane's lattice tower and its cab. */
const sagradaCraneMast = (at: At): Shape[] => {
  const { dx, up } = SAGRADA_CRANE
  const lattice: Point[] = [[dx - 0.4, 0]]
  for (let y = 0.9, side = 1; y < up - 0.6; y += 0.9, side = -side) lattice.push([dx + side * 0.4, y])

  return [box(at, dx - 0.4, 0, dx + 0.4, up - 0.6, '#d89a2a', 0.3), line(placer(at)(lattice), 0.12 * at.s, '#d89a2a'), box(at, dx - 0.7, up - 0.8, dx + 0.7, up + 0.2, '#e8b040')]
}

/** The crane slewing its jib slowly to and fro over the basilica (seen foreshortened), its trolley running along it and a stone hoisted to the roofs; glints on the sea and a sail. */
const sagradaMoving = (at: At, now: number): Shape[] => {
  const p = placer(at)
  const { dx, up, jib } = SAGRADA_CRANE
  const reach = jib * (0.68 + 0.32 * Math.cos(now / 11_000))
  const back = 0.32 * reach
  const trolley = dx - reach * (0.5 + 0.3 * Math.sin(now / 7000))
  const load = 9.6 + 2.8 * Math.sin(now / 9000)
  const truss: Point[] = []
  for (let i = 0; i <= 8; i += 1) truss.push([dx - (reach * i) / 8, up + (i % 2 === 0 ? 0.2 : 0.9)])
  const sail = 45 + 4 * Math.sin(now / 15_000)

  return [
    line(p([[dx + back, up + 0.2], [dx - reach, up + 0.2]]), 0.2 * at.s, '#d89a2a'),
    line(p(truss), 0.12 * at.s, '#d89a2a'),
    line(p([[dx + back, up + 0.6], [dx, up + 2.4], [dx - reach, up + 0.8]]), 0.08 * at.s, '#8a8070'),
    line(p([[dx, up], [dx, up + 2.4]]), 0.22 * at.s, '#d89a2a'),
    box(at, dx + back - 1.3, up - 0.6, dx + back, up + 0.4, '#8a8478'),
    line(p([[trolley, up], [trolley, load + 0.6]]), 0.06 * at.s, '#4a4440'),
    box(at, trolley - 0.5, load - 0.3, trolley + 0.5, load + 0.6, '#cdb48c'),
    ...glints(at, 36, 52, 1.4, now),
    poly(p([[sail - 0.9, 0.4], [sail + 0.9, 0.4], [sail + 0.6, 0.1], [sail - 0.7, 0.1]]), '#f4f0e6'),
    poly(p([[sail, 0.45], [sail, 2.4], [sail + 0.9, 0.5]]), '#ffffff'),
  ]
}

/** The crane's warning light, blinking by night. */
const sagradaBeacon = (at: At, now: number, light: Light): Shape[] =>
  light.dark < 0.05 ? [] : [...glow(at, SAGRADA_CRANE.dx, SAGRADA_CRANE.up + 2.5, 0.9, 0.9, '#ff4a3a', 0.5 * light.dark * (mod(now, 1600) < 800 ? 1 : 0.15)), dot(at, SAGRADA_CRANE.dx, SAGRADA_CRANE.up + 2.5, 0.2, 0.2, '#ff6a50', light.dark)]

/** The basilica floodlit gold by night (the Nativity's old stone deeper, the Passion's paler), its central towers paler still, Mary's star and Jesus's cross shining, the nave's stained glass lit from within; the city's windows and Torre Glòries lit. */
const sagradaLights = (at: At): Shape[] => {
  const p = placer(at)

  return [
    ...glow(at, 1, 8, 14, 10, '#ffd27a', 0.14),
    ...SAGRADA_CENTRAL.map(spire => poly(p(sagradaSpire(spire, SAGRADA_POINTED)), '#ffe2b0', 0.62)),
    ...SAGRADA_CENTRAL.map(spire => poly(p(sagradaShade(spire, SAGRADA_POINTED)), '#d8a868', 0.4)),
    box(at, -4.6, 0, 17.4, 5.6, '#f6c25a', 0.28),
    ...sagradaWindows(at, ['#8cc4ec', '#96d8b4', '#ffd27a', '#ffae5e', '#ff8a6a'], 0.8),
    ...SAGRADA_PASSION.map(spire => poly(p(sagradaSpire(spire)), '#f8d27a', 0.66)),
    ...SAGRADA_NATIVITY.map(spire => poly(p(sagradaSpire(spire)), '#f0b44c', 0.7)),
    ...SAGRADA_NATIVITY.map(spire => line(p(sagradaLouvres(spire)), 0.24 * at.s, '#a8742e', 0.6)),
    box(at, -14.6, 0, -4.6, 4.6, '#f6c25a', 0.4),
    ...SAGRADA_PASSION.map(spire => poly(p(sagradaPinnacle(spire, 0.65)), '#fff2d0', 0.85)),
    ...SAGRADA_NATIVITY.map(spire => poly(p(sagradaPinnacle(spire, 0.85)), '#fff2d0', 0.85)),
    ...glow(at, 3.9, 15.95, 2.2, 2.2, '#e8f2ff', 0.5),
    sagradaStar(at, '#ffffff', 0.95),
    ...glow(at, 1.1, 18.4, 1.8, 2, '#fff6e0', 0.36),
    sagradaCross(at, '#fffaf0', 0.9),
    ...eixample(at, -47, -20, 1, true),
    ...eixample(at, 22, 38, 4, true),
    ...torreGlories(at, '#4a7af0', '#e0508a', 0.55),
  ]
}

/** Barcelona round the basilica: the Collserola hills behind, the Eixample's blocks either side, Torre Glòries and a glimpse of the Mediterranean, the crane, palms. */
const barcelona = (at: At): Shape[] => [
  ridge(at, -55, 4, 8.6, 1.4, '#a8b8c6', 4),
  ...water(at, 34, 55, 1.4, '#3a78b0'),
  ...torreGlories(at, '#7c90aa', '#c06a5a'),
  ...eixample(at, -47, -20, 1),
  ...eixample(at, 22, 38, 4),
  ...sagradaCraneMast(at),
  ...sagrada(at),
  ...palm(at, -22, 6.4),
  ...palm(at, 43.5, 4.6),
]

/** Wooded slopes along `outline` (its `[dx, up]` points), their pines' tips `tall` over it and `apart` apart, filled down to the horizon. */
const neuschwansteinWoods = (at: At, outline: readonly Point[], tall: number, fill: string, seed: string, apart = 1.3): Shape => {
  const points: Point[] = []
  for (let i = 1; i < outline.length; i += 1) {
    const [x0, y0] = outline[i - 1] ?? [0, 0]
    const [x1, y1] = outline[i] ?? [0, 0]
    const steps = Math.max(1, Math.round(Math.abs(x1 - x0) / apart))
    for (let k = 0; k < steps; k += 1) {
      const w = (x1 - x0) / steps
      const up = y0 + ((y1 - y0) * k) / steps
      points.push([x0 + w * k, up], [x0 + w * (k + 0.5), up + (y1 - y0) / steps / 2 + tall * (0.55 + 0.45 * rnd(seed, i, k))])
    }
  }
  const [firstX] = outline[0] ?? [0, 0]
  const [lastX, lastY] = outline[outline.length - 1] ?? [0, 0]

  return poly(placer(at)([[firstX, -0.2], ...points, [lastX, lastY], [lastX, -0.2]]), fill)
}

/** The Alps behind: pale blue peaks along the back, the highest under snow. */
const NEUSCHWANSTEIN_PEAKS: readonly Point[] = [[-55, 0], [-49, 3.4], [-43, 6.6], [-38, 5.4], [-31, 9.6], [-27, 8.4], [-21, 12.4], [-16.5, 10], [-12, 11.6], [-6, 10.2], [0, 11], [6, 9.8], [12, 12.6], [17, 10.8], [22.5, 15.2], [27, 12.2], [32, 13.6], [37.5, 9.6], [43, 7.4], [49, 3.6], [55, 0]]

/** The castle's white walls, each `[dx, up, dx2, up2]`: the Palas, its wing, the knights' house, the square tower. */
const NEUSCHWANSTEIN_WALLS = [
  [0.6, 5.6, 8.4, 14.6],
  [8.4, 5.6, 11.2, 10.2],
  [-5.6, 5.6, 0.6, 10.4],
  [-4.4, 5.6, -2, 13.4],
] as const

/** Its round towers, each `[dx, w, base, top, cone]`: the corner turret, the north tower, the wing's tower, the stair tower over all. */
const NEUSCHWANSTEIN_TOWERS = [
  [8.7, 1.2, 12.2, 15.4, 2.6],
  [2.4, 1, 14.4, 17.6, 1.9],
  [11.2, 1.2, 5.6, 11.4, 2.2],
  [0.4, 2, 5.6, 17.4, 3],
] as const

type NeuschwansteinWindow = readonly [number, number, number, number]

/** Its windows, each `[dx, up, w, h]`: the Palas's three floors, the stair tower's slits, the knights' house, the square tower, the gable. */
const NEUSCHWANSTEIN_WINDOWS: readonly NeuschwansteinWindow[] = [
  ...[1.6, 2.9, 4.2, 5.5, 6.8].flatMap(dx => [7.2, 9.4, 11.6].map((up): NeuschwansteinWindow => [dx, up, 0.6, 1.2])),
  ...[9, 11.6, 14.2].map((up): NeuschwansteinWindow => [0.15, up, 0.45, 1]),
  ...[-2.2, -1].flatMap(dx => [7.2, 8.8].map((up): NeuschwansteinWindow => [dx, up, 0.55, 1])),
  [-3.5, 9.6, 0.6, 1.1],
  [-3.5, 11.6, 0.6, 1.1],
  [9.4, 7.6, 0.55, 1],
  [6.15, 15.4, 0.5, 1.4],
]

/** Battlements along `up` from `from` to `to`, a merlon every `every`. */
const neuschwansteinMerlons = (at: At, from: number, to: number, up: number, every: number, fill: string): Shape => {
  const points: Point[] = []
  for (let dx = from; dx < to - every * 0.4; dx += every) points.push([dx, up + 0.6], [dx + every * 0.55, up + 0.6], [dx + every * 0.55, up], [dx + every, up])

  return poly(placer(at)([[from, up - 0.1], ...points, [to, up + 0.6], [to, up - 0.1]]), fill)
}

/** Slender round towers, each `[dx, w, base, top, cone]`, their walls `wall`, shaded on the right, under steep slate cones lit on the left: each layer together. */
const neuschwansteinTurrets = (at: At, towers: readonly (readonly [number, number, number, number, number])[], wall = '#f2eee4'): Shape[] => {
  const p = placer(at)

  return [
    ...towers.map(([dx, w, base, top]) => box(at, dx - w / 2, base, dx + w / 2, top, wall)),
    ...towers.map(([dx, w, base, top]) => box(at, dx + w * 0.1, base, dx + w / 2, top, '#2a3050', 0.14)),
    ...towers.map(([dx, w, , top, cone]) => poly(p([[dx - w / 2 - 0.3, top], [dx, top + cone], [dx + w / 2 + 0.3, top]]), '#566782')),
    ...towers.map(([dx, w, , top, cone]) => poly(p([[dx - w / 2 - 0.3, top], [dx, top + cone], [dx - w * 0.1, top]]), '#7a8cac', 0.6)),
  ]
}

/** The crag under the castle: grey rock, its cliffs in shade on the right, pines climbing its flanks. */
const neuschwansteinCrag = (at: At): Shape[] => {
  const p = placer(at)

  return [
    poly(p([[-13.6, 2.2], [-13, 4.4], [-12.4, 5.8], [12.6, 5.8], [13.6, 4.2], [14.4, 2.4], [9, 1.4], [3, 2], [-3, 1.6], [-9, 2.2]]), '#8a8276'),
    poly(p([[3.4, 5.8], [12.6, 5.8], [13.6, 4.2], [14.4, 2.4], [9, 1.4], [7.6, 3.2], [5.2, 4.2]]), '#4a4640', 0.35),
    poly(p([[-12.4, 5.8], [-10.6, 5.8], [-11.2, 4], [-12.2, 2.4], [-13, 4.4]]), '#4a4640', 0.25),
    neuschwansteinWoods(at, [[-22, 0.4], [-16, 2], [-13.4, 3.8], [-11, 2.6], [-6, 2], [0, 1.6], [6, 2], [10.6, 2.4], [13.6, 3.6], [16.4, 2], [21, 0.4]], 1.7, '#35573f', 'neuschwanstein-crag', 2.2),
  ]
}

/** Neuschwanstein on its crag: the gatehouse, the knights' house and square tower, the tall Palas under its steep roof, its slender turrets. */
const neuschwansteinCastle = (at: At): Shape[] => {
  const p = placer(at)
  const white = ([dx, up, dx2, up2]: readonly [number, number, number, number]): Shape => box(at, dx, up, dx2, up2, '#f2eee4')
  const [palas, wing, knights, square] = NEUSCHWANSTEIN_WALLS

  return [
    // The curtain wall along the crag's top, and the gatehouse in its warm brick, its battlements and its gate.
    box(at, -12, 5.4, 12.4, 6.4, '#d8d0c2'),
    box(at, -11.2, 5.6, -5.4, 10.4, '#dcae94'),
    neuschwansteinMerlons(at, -11.2, -5.4, 10.4, 1.15, '#dcae94'),
    box(at, -7.4, 5.6, -5.4, 11, '#2a3050', 0.12),
    rect(at.x - 8.9 * at.s, at.y - 7.8 * at.s, 1.2 * at.s, 2.2 * at.s, '#4a3a3a', 1, 0.55 * at.s),
    // The Palas, its steep roof and its tall gable; its wing; the knights' house and the square tower.
    white(palas),
    poly(p([[0.2, 14.6], [0.8, 17.2], [8.2, 17.2], [8.8, 14.6]]), '#566782'),
    poly(p([[0.2, 14.6], [0.8, 17.2], [4, 17.2], [4, 14.6]]), '#7a8cac', 0.45),
    poly(p([[4.9, 14.4], [6.4, 18.6], [7.9, 14.4]]), '#f2eee4'),
    poly(p([[6.4, 18.6], [7.9, 14.4], [7.2, 14.4]]), '#2a3050', 0.14),
    box(at, 4.6, 5.6, 8.4, 14.6, '#2a3050', 0.12),
    white(wing),
    poly(p([[8.3, 10.2], [8.6, 11.6], [11, 11.6], [11.3, 10.2]]), '#566782'),
    white(knights),
    poly(p([[-5.8, 10.4], [-5.5, 11.8], [0.4, 11.8], [0.7, 10.4]]), '#566782'),
    poly(p([[-5.8, 10.4], [-5.5, 11.8], [-2.6, 11.8], [-2.6, 10.4]]), '#7a8cac', 0.45),
    white(square),
    neuschwansteinMerlons(at, -4.6, -1.8, 13.4, 0.9, '#e4dfd4'),
    box(at, -3, 5.6, -2, 13.4, '#2a3050', 0.12),
    // The corner turret on its corbel, the north tower, the wing's tower, the gatehouse's turrets, and the stair tower over all.
    poly(p([[8.1, 12.2], [8.7, 11], [9.3, 12.2]]), '#e4dfd4'),
    ...neuschwansteinTurrets(at, [[-11.2, 1.2, 8, 11.8, 2.4], [-5.6, 1.2, 8, 12.4, 2.4]], '#dcae94'),
    ...neuschwansteinTurrets(at, NEUSCHWANSTEIN_TOWERS),
    ...NEUSCHWANSTEIN_WINDOWS.map(([dx, up, w, h]) => box(at, dx, up, dx + w, up + h, '#4e5a72')),
  ]
}

/** Hohenschwangau below: a little ochre castle on its wooded knoll, its towers; with `lit` floodlit, its windows lit. */
const hohenschwangau = (at: At, lit = false): Shape[] => {
  const wall = lit ? '#ffd890' : '#e6c16a'
  const alpha = lit ? 0.5 : 1
  const castle: Shape[] = [box(at, -33, 3.4, -27.6, 6.2, wall, alpha), box(at, -33.6, 3.4, -32.2, 7.2, wall, alpha), box(at, -28.4, 3.4, -27, 7, wall, alpha), box(at, -31.2, 3.4, -30.2, 7.6, wall, alpha)]
  const windows = [-32.4, -29.6, -28.2].map(dx => box(at, dx, 4.4, dx + 0.45, 5.2, lit ? '#ffd27a' : '#6a5a4a', lit ? 0.9 : 0.8))
  if (lit) return [...castle, ...windows]

  return [
    neuschwansteinWoods(at, [[-40, 1], [-36, 2.6], [-32, 3.4], [-28, 3.4], [-24, 2], [-20, 0.8]], 1.2, '#3f6448', 'hohenschwangau', 2.2),
    ...castle,
    poly(placer(at)([[-31.4, 7.6], [-30.7, 8.8], [-30, 7.6]]), '#a85a3a'),
    box(at, -28, 3.4, -27, 7, '#2a3050', 0.14),
    ...windows,
  ]
}

/** The Pöllat gorge right of the castle: a wooded hill cleft at its top, and the Marienbrücke high over the cleft. */
const marienbrucke = (at: At): Shape[] => {
  const p = placer(at)

  return [
    neuschwansteinWoods(at, [[15, 0.4], [19, 4.4], [22.4, 7.4], [24.6, 8.6], [26, 6], [27.2, 4.2], [28.4, 6.4], [29.6, 9.2], [32.4, 8.6], [37, 6], [43, 2.6], [48, 0.4]], 1.5, '#3d5f48', 'neuschwanstein-gorge', 1.9),
    line(p([[24.4, 8.8], [29.8, 8.8]]), 0.45 * at.s, '#3e3a3c'),
  ]
}

/** The castle and the hills, Hohenschwangau and the gorge, the pines nearest. */
const neuschwanstein = (at: At): Shape[] => {
  const p = placer(at)

  return [
    poly(p(NEUSCHWANSTEIN_PEAKS), '#a9b6d6'),
    // The snow on the highest peaks, ragged below.
    ...NEUSCHWANSTEIN_PEAKS.filter(([, up]) => up > 10).map(([dx, up]) => poly(p([[dx - 2.4, up - 2.1], [dx, up], [dx + 2.6, up - 2.3], [dx + 0.7, up - 1.6], [dx - 0.5, up - 2.4]]), '#f4f6fc')),
    poly(p([[-55, 0], [-40, 3.2], [-26, 5.6], [-10, 4], [8, 5.2], [26, 4.4], [42, 3], [55, 0]]), '#8c9fc4'),
    neuschwansteinWoods(at, [[-55, 0.4], [-44, 2.2], [-34, 3], [-22, 2.4], [-8, 3.2], [10, 2.6], [30, 3.6], [44, 2.4], [55, 0.4]], 0.9, '#5d7f74', 'neuschwanstein-far', 9),
    ...hohenschwangau(at),
    ...marienbrucke(at),
    ...neuschwansteinCrag(at),
    ...neuschwansteinCastle(at),
    // The nearest pines, darkest, along the foot of the view.
    neuschwansteinWoods(at, [[-55, 0.2], [-46, 1], [-38, 0.6], [-30, 0.4]], 1.8, '#2a4636', 'neuschwanstein-near-left', 2.8),
    neuschwansteinWoods(at, [[34, 0.4], [42, 1], [50, 0.8], [55, 0.2]], 2, '#2a4636', 'neuschwanstein-near-right', 2.8),
  ]
}

/** The castle's daylight colours floodlit, in the order they are lit: each one's lit colour and how bright, its slate silvered and its walls warm; the rest (shade, windows, its gate) left dark. */
const NEUSCHWANSTEIN_FLOODLIT = [
  ['#566782', '#aebce0', 0.3],
  ['#dcae94', '#ffc890', 0.55],
  ['#f2eee4', '#ffe8b8', 0.6],
  ['#e4dfd4', '#ffe8b8', 0.6],
] as const

/** Neuschwanstein by night: a glow round it, the castle floodlit, most of its windows lit, Hohenschwangau too, and the village below. */
const neuschwansteinLights = (at: At): Shape[] => {
  const castle = neuschwansteinCastle(at)

  return [
    ...glow(at, 1, 12, 13, 9, '#ffe2a8', 0.13),
    // Each colour's shapes together, so each is one path.
    ...NEUSCHWANSTEIN_FLOODLIT.flatMap(([day, fill, alpha]) => castle.filter(shape => shape.fill === day).map(shape => ({ ...shape, fill, alpha: alpha * (shape.alpha ?? 1) }))),
    ...NEUSCHWANSTEIN_WINDOWS.filter((_, i) => rnd('neuschwanstein-lit', i) < 0.7).map(([dx, up, w, h]) => box(at, dx, up, dx + w, up + h, '#ffc860', 0.95)),
    ...hohenschwangau(at, true),
    ...Array.from({ length: 7 }, (_, i) => {
      const dx = -50 + 30 * rnd('schwangau', i)
      const up = 0.3 + 0.9 * rnd('schwangau-up', i)

      return box(at, dx, up, dx + 0.36, up + 0.36, '#ffd78a', 0.9)
    }),
  ]
}

/** A hot-air balloon over the hills on the right, red with a gold stripe, drifting and bobbing, `alpha` seen. */
const neuschwansteinBalloon = (at: At, now: number, alpha: number): Shape[] => {
  const p = placer(at)
  const bx = 38 + 1.6 * Math.sin(now / 9000)
  const by = 12.6 + 0.5 * Math.sin(now / 3700)

  return [
    dot(at, bx, by + 1.9, 1.35, 1.45, '#d8463a', alpha),
    poly(p([[bx - 1.3, by + 1.6], [bx - 0.4, by + 0.3], [bx + 0.4, by + 0.3], [bx + 1.3, by + 1.6]]), '#d8463a', alpha),
    dot(at, bx, by + 1.9, 0.45, 1.45, '#f6c445', alpha),
    poly(p([[bx - 0.44, by + 1.6], [bx - 0.14, by + 0.3], [bx + 0.14, by + 0.3], [bx + 0.44, by + 1.6]]), '#f6c445', alpha),
    box(at, bx - 0.3, by - 0.5, bx + 0.3, by, '#6a4a32', alpha),
  ]
}

/** The balloon by day, and the Bavarian flag waving on the Palas's corner turret. */
const neuschwansteinMoving = (at: At, now: number, light: Light): Shape[] => {
  const p = placer(at)
  const wave = (k: number): number => 0.18 * Math.sin(now / 260 - k * 3)

  return [
    ...(light.day > 0.02 ? neuschwansteinBalloon(at, now, light.day) : []),
    line(p([[8.7, 17.8], [8.7, 19.4]]), 0.1 * at.s, '#3a3a44'),
    poly(p([[8.75, 19.4], [9.5, 19.4 + wave(0.5)], [10.2, 19.3 + wave(1)], [10.2, 18.7 + wave(1)], [9.5, 18.8 + wave(0.5)], [8.75, 18.8]]), '#f4f6fc'),
    poly(p([[8.75, 19.1], [9.5, 19.1 + wave(0.5)], [10.2, 19 + wave(1)], [10.2, 18.7 + wave(1)], [9.5, 18.8 + wave(0.5)], [8.75, 18.8]]), '#3a7ac8'),
  ]
}

/** The canal's far bank, where the palazzi stand out of the water. */
const VENICE_BANK = 2.4

/** Where the Campanile's bells hang, each arch's left. */
const VENICE_BELLS = [-5.4, -4.55, -3.7] as const

/** The palazzi along the Grand Canal, each `[from, to, high, wall]`: their pastel fronts, lower toward the stretch's ends. */
const VENICE_PALAZZI = [
  [-52, -46.6, 4.4, '#e8c890'],
  [-46.4, -40, 6, '#d8826a'],
  [-39.8, -33.6, 7.4, '#f0dcb4'],
  [-33.4, -26.6, 9.2, '#e4b45c'],
  [-26.4, -20.4, 8, '#c8644a'],
  [-20.2, -13.6, 9, '#e2a092'],
  [-13.4, -7.2, 7, '#f2e2c8'],
  [-7, -1.4, 5.4, '#f0d48a'],
  [-1.2, 4.2, 7.6, '#d8826a'],
  [26, 32.2, 7.2, '#e2a092'],
  [32.4, 38.4, 6, '#f0dcb4'],
  [38.6, 44.6, 5, '#e4b45c'],
  [44.8, 50.4, 3.8, '#c8644a'],
] as const

type VeniceWindow = readonly [number, number, number, number]

/** A palazzo's windows, each `[dx, up, w, h]`: tall gothic lancets on its noble floor, smaller ones over them on the taller, none on the lowest at the ends. */
const veniceWindows = (from: number, to: number, high: number): VeniceWindow[] => {
  if (high < 5) return []
  const count = Math.floor((to - from - 0.6) / 1.4)
  const left = (from + to) / 2 - ((count - 1) * 1.4) / 2
  const floors: [number, number, number][] = high > 7 ? [[2.6, 1.9, 0.6], [5.2, 1.3, 0.5]] : [[2.4, 1.7, 0.6]]

  return floors.flatMap(([up, h, w]) => Array.from({ length: count }, (_, i): VeniceWindow => [left + i * 1.4, VENICE_BANK + up, w, h]))
}

/** Windows as strokes, round-headed: the noble floor's together, then the upper floor's. */
const veniceWindowShapes = (at: At, windows: readonly VeniceWindow[], fill: string, alpha = 1): Shape[] =>
  [0.6, 0.5].flatMap(width => windows.filter(([, , w]) => w === width).map(([dx, up, w, h]) => line(placer(at)([[dx, up + w / 2], [dx, up + h - w / 2]]), w * at.s, fill, alpha)))

/** St Mark's Campanile rising behind the rooftops: its red-brick shaft, its white belfry and the bells' arches, its attic, its tall green spire and gold angel. */
const veniceCampanile = (at: At): Shape[] => {
  const p = placer(at)

  return [
    box(at, -5.5, VENICE_BANK, -3.1, 14.9, '#b4523c'),
    box(at, -3.9, VENICE_BANK, -3.1, 14.9, '#2a3050', 0.16),
    box(at, -5.75, 12.1, -2.85, 14.1, '#ece2cc'),
    box(at, -5.75, 12.1, -2.85, 12.4, '#d8ccb4'),
    ...VENICE_BELLS.map(dx => box(at, dx, 12.6, dx + 0.5, 13.8, '#5a4a48')),
    box(at, -5.75, 14.9, -2.85, 15.2, '#ece2cc'),
    poly(p([[-5.6, 15.2], [-4.3, 19.9], [-3, 15.2]]), '#5e9a7e'),
    poly(p([[-5.6, 15.2], [-4.3, 19.9], [-4.6, 15.2]]), '#86c0a2', 0.6),
    dot(at, -4.3, 20.15, 0.26, 0.32, '#e8c050'),
  ]
}

/** A dome's outline `r` round and `h` high on its base at `[dx, base]`, in `steps` along its curve. */
const domeCurve = (dx: number, base: number, r: number, h: number, steps = 8): Point[] => Array.from({ length: steps + 1 }, (_, i): Point => [dx - r * Math.cos((i * Math.PI) / steps), base + h * Math.sin((i * Math.PI) / steps)])

/** Santa Maria della Salute on the water: its white front and portal, the scrolls round its drum, its great lead dome and lantern, the little dome and bell towers behind. */
const veniceSalute = (at: At): Shape[] => {
  const p = placer(at)

  return [
    // Behind: the bell towers, the little dome on its drum.
    box(at, 21.6, VENICE_BANK, 22.5, 11, '#e6dfd0'),
    box(at, 25, VENICE_BANK, 25.9, 11, '#e6dfd0'),
    poly(p(domeCurve(22.05, 11, 0.6, 0.9, 4)), '#9aa6b8'),
    poly(p(domeCurve(25.45, 11, 0.6, 0.9, 4)), '#9aa6b8'),
    box(at, 22.4, VENICE_BANK, 25.2, 9.4, '#e6dfd0'),
    box(at, 22.4, VENICE_BANK, 25.2, 7, '#2a3050', 0.12),
    poly(p(domeCurve(23.8, 9.4, 1.6, 1.8, 6)), '#9aa6b8'),
    // The church: its front, its steps, the columns either side of the portal; its drum, the scrolls, the pediment, the dome and the lantern.
    box(at, 9.6, VENICE_BANK, 22.4, 8, '#f2ece0'),
    box(at, 18.6, VENICE_BANK, 22.4, 8, '#2a3050', 0.12),
    box(at, 9.2, VENICE_BANK, 22.8, 3.2, '#e2dace'),
    ...[13.4, 14.3, 17.4, 18.3].map(dx => box(at, dx, 3.2, dx + 0.3, 7.6, '#ddd4c4')),
    box(at, 15.2, 3.2, 16.8, 6.4, '#5e5850'),
    dot(at, 16, 6.4, 0.8, 0.8, '#5e5850'),
    box(at, 11.8, 8, 20.2, 10.8, '#ebe4d6'),
    ...[12.6, 18.6].map(dx => box(at, dx, 8.8, dx + 0.8, 10, '#6a6460')),
    ...[11.3, 20.7].map(dx => dot(at, dx, 9.2, 0.8, 0.8, '#e2dace')),
    poly(p([[12.8, 7.7], [16, 10.1], [19.2, 7.7]]), '#d6ccba'),
    poly(p([[13.5, 8], [16, 9.75], [18.5, 8]]), '#f6f0e6'),
    poly(p(domeCurve(16, 10.8, 4.4, 4.6)), '#9aa6b8'),
    poly(p([...domeCurve(16, 10.8, 4.4, 4.6).slice(0, 5), [15, 10.8]]), '#c6cfdc', 0.6),
    box(at, 15.4, 15.2, 16.6, 16.6, '#f2ece0'),
    poly(p(domeCurve(16, 16.6, 0.8, 0.8, 4)), '#9aa6b8'),
    line(p([[16, 17.4], [16, 18.4], [16, 18], [15.6, 18], [16.4, 18]]), 0.14 * at.s, '#c8a050'),
  ]
}

/** Where the striped mooring poles stand in the water: each `[dx, stripe]`, alike stripes together. */
const VENICE_POLES = [[-41, '#2a5aa8'], [-39.8, '#2a5aa8'], [5.6, '#2a5aa8'], [6.8, '#2a5aa8'], [-21.4, '#c83a32'], [-20.2, '#c83a32'], [33, '#c83a32']] as const

/** The Grand Canal: the palazzi in their pastels, cornices and roofs, gothic windows and water doors; the Campanile behind; the Salute; the striped poles and a moored gondola. */
const venice = (at: At): Shape[] => {
  const p = placer(at)
  const windows = VENICE_PALAZZI.flatMap(([from, to, high]) => veniceWindows(from, to, high))

  return [
    ...veniceCampanile(at),
    ...VENICE_PALAZZI.map(([from, to, high, wall]) => box(at, from, VENICE_BANK, to, VENICE_BANK + high, wall)),
    ...VENICE_PALAZZI.map(([from, to, high]) => box(at, from - 0.2, VENICE_BANK + high - 0.1, to + 0.2, VENICE_BANK + high + 0.35, '#f4ecdc')),
    ...VENICE_PALAZZI.map(([from, to, high]) => box(at, from, VENICE_BANK + high + 0.35, to, VENICE_BANK + high + 0.75, '#a8503a')),
    // The noble floor's balconies, white stone.
    ...VENICE_PALAZZI.filter(([, , high]) => high >= 5).map(([from, to]) => box(at, from + 0.4, VENICE_BANK + 2.1, to - 0.4, VENICE_BANK + 2.35, '#f4ecdc')),
    ...veniceWindowShapes(at, windows, '#4a4650'),
    ...VENICE_PALAZZI.map(([from, to]) => box(at, (from + to) / 2 - 0.5, VENICE_BANK, (from + to) / 2 + 0.5, VENICE_BANK + 1.3, '#3e3a44')),
    // A Venetian chimney here and there, wide at its top.
    ...[-31, -16.4, 0.4, 28].map(dx => {
      const top = VENICE_BANK + (VENICE_PALAZZI.find(([from, to]) => from <= dx && dx <= to)?.[2] ?? 6) + 0.75

      return poly(p([[dx - 0.25, top], [dx - 0.25, top + 0.9], [dx - 0.55, top + 1.5], [dx + 0.55, top + 1.5], [dx + 0.25, top + 0.9], [dx + 0.25, top]]), '#b8604a')
    }),
    ...veniceSalute(at),
    ...water(at, -55, 55, VENICE_BANK, '#3f8088'),
    // The poles, white with their stripes.
    ...VENICE_POLES.map(([dx]) => box(at, dx - 0.17, 0.2, dx + 0.17, 4.4, '#f4f0e8')),
    ...VENICE_POLES.flatMap(([dx, stripe]) => [1.4, 3].map(up => box(at, dx - 0.17, up, dx + 0.17, up + 0.6, stripe))),
    // A gondola moored at the poles.
    poly(p([[-24.8, 1.4], [-24.2, 0.6], [-19, 0.6], [-18.4, 1.2], [-18.7, 1.5], [-19.2, 0.95], [-24.2, 0.95]]), '#1e1c22'),
  ]
}

/** The palazzi's windows lit at night, each `[dx, up, w, h]`: most, not all. */
const VENICE_LIT: readonly VeniceWindow[] = VENICE_PALAZZI.flatMap(([from, to, high]) => veniceWindows(from, to, high).filter((_, i) => rnd('venice-lit', from, i) < 0.6))

/** Where lanterns hang by the palazzi's water doors. */
const VENICE_LANTERNS = [-42.3, -29.1, -16, 2.4, 30, 42.5] as const

/** Venice by night: the palazzi's windows lit and their lights in the water, lanterns by their water doors, the Campanile and the Salute floodlit, the Salute's light in the water. */
const veniceLights = (at: At): Shape[] => {
  const p = placer(at)

  return [
    ...glow(at, 16, 9.5, 10, 7, '#fff0d4', 0.12),
    box(at, 9.6, VENICE_BANK, 22.4, 8, '#ffe2ac', 0.6),
    box(at, 11.8, 8, 20.2, 10.8, '#ffe2ac', 0.6),
    box(at, 15.4, 15.2, 16.6, 16.6, '#ffe2ac', 0.6),
    poly(p(domeCurve(16, 10.8, 4.4, 4.6)), '#f4e6cc', 0.45),
    // The Campanile washed warm, its spire's copper glinting, its belfry glowing.
    box(at, -5.5, 8.6, -3.1, 14.9, '#ffb878', 0.4),
    poly(p([[-5.6, 15.2], [-4.3, 19.9], [-3, 15.2]]), '#b0e0c4', 0.25),
    ...glow(at, -4.3, 13.1, 3, 2.4, '#ffe0a0', 0.3),
    box(at, -5.75, 12.1, -2.85, 14.1, '#fff0c8', 0.6),
    ...VENICE_BELLS.map(dx => box(at, dx, 12.6, dx + 0.5, 13.8, '#ffd27a', 0.95)),
    ...veniceWindowShapes(at, VENICE_LIT, '#ffd27a', 0.85),
    // The lanterns, and their lights and the windows' in the water, broken by the ripples.
    ...VENICE_LANTERNS.map(dx => box(at, dx - 0.2, VENICE_BANK + 1.5, dx + 0.2, VENICE_BANK + 2, '#fff0b0', 0.95)),
    ...VENICE_LANTERNS.map(dx => line(p([[dx, 2.1], [dx, 0.5]]), 0.22 * at.s, '#ffc870', 0.5)),
    ...VENICE_LIT.filter(([, up], i) => up < VENICE_BANK + 3 && i % 2 === 0).map(([dx], i) => line(p([[dx - 0.4 + 0.2 * (i % 2), 1.7 - 0.7 * (i % 2)], [dx + 0.4 + 0.2 * (i % 2), 1.7 - 0.7 * (i % 2)]]), 0.24 * at.s, '#ffc870', 0.5)),
    ...[[11.5, 20.5, 1.8], [12.8, 19.2, 1.2], [14.6, 17.4, 0.6]].map(([from = 0, to = 0, up = 0]) => line(p([[from, up], [to, up]]), 0.3 * at.s, '#fff0d0', 0.3)),
  ]
}

/** Glints on the canal, drifting and twinkling: half of them bright as the other half dims, each half together. */
const veniceGlints = (at: At, now: number): Shape[] =>
  [0, 1].flatMap(half => {
    const alpha = 0.4 + 0.25 * Math.sin(now / 700 + half * Math.PI)

    return Array.from({ length: 6 }, (_, i) => {
      const dx = -50 + (i * 2 + half) * 8.4 + 1.5 * Math.sin(now / 1500 + i * 1.7 + half)
      const up = 0.5 + 1.4 * rnd('venice-glint', i, half)

      return line(placer(at)([[dx - 1.1, up], [dx + 1.1, up]]), 0.18 * at.s, '#ffffff', alpha)
    })
  })

/** Where the gondola is: gliding along the canal rightward, faded in and out at the stretch's ends. */
const veniceGondolaAt = (now: number): { dx: number; fade: number } => {
  const dx = mod(now / 420, 108) - 54

  return { dx, fade: Math.max(0, Math.min(1, (54 - Math.abs(dx)) / 5)) }
}

/** The gondola gliding by, its gondolier rowing at its stern in his striped shirt and boater; the glints on the canal. */
const veniceMoving = (at: At, now: number): Shape[] => {
  const p = placer(at)
  const { dx, fade } = veniceGondolaAt(now)
  const bob = 0.06 * Math.sin(now / 500)
  const stroke = Math.sin(now / 700)
  const hand: Point = [dx - 1.6 + 0.3 * stroke, 2.6 + bob]

  return [
    ...veniceGlints(at, now),
    poly(p([[dx - 3.2, 1.9 + bob], [dx - 2.6, 0.7 + bob], [dx + 2.4, 0.7 + bob], [dx + 3.2, 1.6 + bob], [dx + 2.9, 1.7 + bob], [dx + 2.3, 1.1 + bob], [dx - 2.4, 1.1 + bob], [dx - 2.9, 1.9 + bob]]), '#1e1c22', fade),
    line(p([[dx + 2.8, 1.6 + bob], [dx + 3.1, 2.3 + bob]]), 0.22 * at.s, '#d8dce4', fade),
    box(at, dx - 0.4, 1.1 + bob, dx + 0.8, 1.5 + bob, '#b8302a', fade),
    line(p([[dx - 2.1, 1.1 + bob], [dx - 2.1, 2 + bob]]), 0.3 * at.s, '#2a2a34', fade),
    box(at, dx - 2.45, 2 + bob, dx - 1.75, 3.1 + bob, '#f4f2ec', fade),
    box(at, dx - 2.45, 2.45 + bob, dx - 1.75, 2.7 + bob, '#2a4a8a', fade),
    dot(at, dx - 2.1, 3.45 + bob, 0.3, 0.32, '#e8b890', fade),
    poly(p([[dx - 2.6, 3.65 + bob], [dx - 2.35, 3.8 + bob], [dx - 2.35, 4.05 + bob], [dx - 1.85, 4.05 + bob], [dx - 1.85, 3.8 + bob], [dx - 1.6, 3.65 + bob]]), '#e8d088', fade),
    line(p([[dx - 2.1, 2.8 + bob], hand, [dx - 0.2 + 0.5 * stroke, 0.3]]), 0.14 * at.s, '#7a5a3a', fade),
  ]
}

/** The gondola's lantern at its prow, by night. */
const veniceLantern = (at: At, now: number, light: Light): Shape[] => {
  const { dx, fade } = veniceGondolaAt(now)
  if (light.dark * fade < 0.02) return []

  return [...glow(at, dx + 2.4, 2.4, 1.3, 1.3, '#ffcf70', 0.45 * light.dark * fade), dot(at, dx + 2.4, 2.4, 0.22, 0.26, '#ffe6a0', light.dark * fade)]
}

/** The caldera's rim at Oia: how high the cliff stands above the sea, `dx` across. */
const SANTORINI_RIM: readonly Point[] = [[-55, 1], [-50, 1.6], [-47.5, 4], [-45, 7.4], [-42, 9.8], [-38, 10.9], [-34, 11.5], [-29, 11.9], [-24, 12.6], [-18, 12.9], [-12, 13.3], [-6, 13.2], [0, 13], [5, 12.6], [9, 12], [12, 10.9], [14.5, 9.4], [17, 7.8], [19.5, 6.3], [22, 4.6], [24.5, 2.9], [27, 1.6], [29, 1]]

/** Oia's terraces, the top first: each `[up, from, to]`, where its houses stand. */
const SANTORINI_ROWS = [[12.2, -21, 5], [10.6, -27, 11], [9, -22, 14], [7.4, -14, 16.5], [5.8, -4, 19], [4.2, 5, 21], [2.8, 13, 22.6]] as const

/** Oia's churches among its houses, the big one on the second terrace with houses behind its dome: each `[row, from, to, tall, r]`, its walls and its dome's radius. */
const SANTORINI_CHURCHES = [[1, -6.6, -0.8, 1.9, 2], [2, 6.6, 10.2, 1.6, 1.45], [3, -11.8, -8.8, 1.4, 1.2]] as const

type SantoriniChurch = (typeof SANTORINI_CHURCHES)[number]

/** The bell tower, across the top terrace. */
const SANTORINI_TOWER = 1.8

/** Whether `from` to `to` on a terrace is clear of its church and the bell tower. */
const santoriniClear = (row: number, from: number, to: number): boolean =>
  SANTORINI_CHURCHES.every(([on, a, b]) => on !== row || to < a - 0.3 || from > b + 0.3) && (row > 0 || to < SANTORINI_TOWER - 1.3 || from > SANTORINI_TOWER + 1.3)

type SantoriniHouse = { dx: number; w: number; h: number; vault: boolean; wall: string; seed: string }

/** Oia's houses row by row down the cliff, white (now and then ochre or rose), some vaulted, each where the cliff is. */
const SANTORINI_HOUSES: readonly (readonly SantoriniHouse[])[] = SANTORINI_ROWS.map(([up, from, to], row) => {
  const houses: SantoriniHouse[] = []
  for (let dx = from + 1.5 * rnd('oia-start', row), i = 0; dx < to; i += 1) {
    const w = 2 + 1.5 * rnd('oia-w', row, i)
    const tint = rnd('oia-tint', row, i)
    if (santoriniClear(row, dx, dx + w) && heightAlong(SANTORINI_RIM, dx + w / 2, 1) > up + 0.6) houses.push({ dx, w, h: 1.5 + 0.9 * rnd('oia-h', row, i), vault: rnd('oia-vault', row, i) < 0.3, wall: tint < 0.1 ? '#efc48e' : tint < 0.17 ? '#eaa58c' : '#f8f6f0', seed: `${row}-${i}` })
    dx += w + 0.15 + 1.2 * rnd('oia-gap', row, i)
  }

  return houses
})

/** A house's outline on its terrace `up` high, from `from` of the way across it: a cube, or a vaulted roof over one. */
const santoriniHouse = ({ dx, w, h, vault }: SantoriniHouse, up: number, from = 0): Point[] => {
  const roof = (k: number): number => up + h - (vault ? 0.5 - 0.6 * Math.sin(Math.PI * k) : 0)

  return [[dx + from * w, up], ...[from, ...(vault ? [0.2, 0.5, 0.8] : []).filter(k => k > from), 1].map((k): Point => [dx + k * w, roof(k)]), [dx + w, up]]
}

type SantoriniOpening = readonly [number, number, number, number]

/** A house's door and window, each `[dx, up, w, h]`: a door low down, a window above it on the wider ones. */
const santoriniOpenings = ({ dx, w, h, seed }: SantoriniHouse, up: number): SantoriniOpening[] => {
  const door = dx + 0.3 + (w - 1.1) * rnd('oia-door', seed)

  return w > 2.9 ? [[door, up, 0.5, 0.95], [door > dx + w / 2 ? dx + 0.4 : dx + w - 1.1, up + h - 1.25, 0.45, 0.5]] : [[door, up, 0.5, 0.95]]
}

/** A blue church dome `r` round on its drum at `[dx, base]`, lit on its left, its cross over it. */
const santoriniDome = (at: At, dx: number, base: number, r: number, h: number): Shape[] => {
  const p = placer(at)
  const curve = domeCurve(dx, base, r, h)

  return [poly(p(curve), '#1f5bc6'), poly(p([...curve.slice(0, 4), [dx - r * 0.2, base]]), '#5a96e8', 0.6), line(p([[dx, base + h], [dx, base + h + 0.9], [dx, base + h + 0.6], [dx - 0.32, base + h + 0.6], [dx + 0.32, base + h + 0.6]]), 0.13 * at.s, '#f4f0e4')]
}

/** A church's terrace, the middle of its walls and the base of its dome. */
const santoriniChurchAt = ([row, from, to, tall]: SantoriniChurch): { base: number; mid: number; drum: number } => {
  const base = SANTORINI_ROWS[row][0]

  return { base, mid: (from + to) / 2, drum: base + tall + 0.5 }
}

/** A whitewashed church on its terrace: its walls, its drum, its door, and its blue dome. */
const santoriniChurch = (at: At, church: SantoriniChurch): Shape[] => {
  const [, from, to, tall, r] = church
  const { base, mid, drum } = santoriniChurchAt(church)

  return [
    box(at, from, base, to, base + tall, '#fbfaf6'),
    box(at, mid - r * 0.75, base + tall, mid + r * 0.75, drum, '#fbfaf6'),
    box(at, to - (to - from) * 0.3, base, to, base + tall, '#2a3050', 0.12),
    box(at, mid - 0.3, base, mid + 0.3, base + 1.1, '#3a5f94'),
    ...santoriniDome(at, mid, drum, r, r * 1.1),
  ]
}

/** The bell tower's openings, each `[dx, up, w, h]` from its foot: two over one, under its dome. */
const SANTORINI_BELLS = [[-0.6, 1.9, 0.5, 1], [0.1, 1.9, 0.5, 1], [-0.25, 3.7, 0.5, 0.75]] as const

/** Oia's bell tower on the top terrace: white tiers, their openings, a little blue dome. */
const santoriniBellTower = (at: At, base: number): Shape[] => {
  const dx = SANTORINI_TOWER

  return [
    box(at, dx - 0.95, base, dx + 0.95, base + 3.4, '#fbfaf6'),
    box(at, dx - 0.65, base + 3.4, dx + 0.65, base + 4.7, '#fbfaf6'),
    box(at, dx + 0.35, base, dx + 0.95, base + 3.4, '#2a3050', 0.12),
    ...SANTORINI_BELLS.map(([x, up, w, h]) => box(at, dx + x, base + up, dx + x + w, base + up + h, '#34466a')),
    ...santoriniDome(at, dx, base + 4.7, 0.65, 0.75),
  ]
}

/** Whether a house's door or window in `row` shows: no house or church on the terraces below standing in front of it. */
const santoriniSeen = (row: number, [dx, up, w]: SantoriniOpening): boolean => {
  const clear = (from: number, to: number, top: number): boolean => from > dx + w || to < dx || top < up + 0.25

  return (
    SANTORINI_HOUSES.every((houses, below) => below <= row || houses.every(house => clear(house.dx, house.dx + house.w, (SANTORINI_ROWS[below]?.[0] ?? 0) + house.h))) &&
    SANTORINI_CHURCHES.every(church => {
      const [below, from, to, tall, r] = church
      const { base, mid, drum } = santoriniChurchAt(church)

      return below <= row || (clear(from, to, base + tall) && clear(mid - r, mid + r, drum + 1.1 * r))
    })
  )
}

/** The windmills on the ridge, each `[dx, up, k]`, its foot and its size: the near one's sails turn, the far one stands bare. */
const SANTORINI_MILLS = [[-33, 11.2, 1], [-41.5, 9.7, 0.75]] as const

type SantoriniMill = (typeof SANTORINI_MILLS)[number]

/** A point on a mill's `k`th of six sails, turned `turn`: `r` out from its hub, `side` across. */
const santoriniSail = ([dx, base, size]: SantoriniMill, turn: number, k: number, r: number, side: number): Point => {
  const a = turn + (k * Math.PI) / 3

  return [dx + (Math.cos(a) * r - Math.sin(a) * side) * size, base + (4.4 + Math.sin(a) * r + Math.cos(a) * side) * size]
}

/** A mill's six spars, turned `turn`: from its hub out to each tip and back. */
const santoriniSpars = (mill: SantoriniMill, turn: number): Point[] => [0, 1, 2, 3, 4, 5].flatMap(k => [santoriniSail(mill, turn, k, 0, 0), santoriniSail(mill, turn, k, 3, 0)])

/** A windmill's door, `[dx, up, w, h]`. */
const santoriniMillDoor = ([dx, base, k]: SantoriniMill): SantoriniOpening => [dx - 0.35 * k, base - 0.4, 0.7 * k, 1.4 * k]

/** A windmill on the ridge: its round white tower, its thatched cap, its door. */
const santoriniMill = (at: At, mill: SantoriniMill): Shape[] => {
  const p = placer(at)
  const [dx, base, k] = mill
  const [doorX, doorUp, doorW, doorH] = santoriniMillDoor(mill)

  return [
    poly(p([[dx - 1.5 * k, base - 0.4], [dx - 1.2 * k, base + 3.8 * k], [dx + 1.2 * k, base + 3.8 * k], [dx + 1.5 * k, base - 0.4]]), '#f6f2e8'),
    poly(p([[dx + 0.4 * k, base - 0.4], [dx + 0.5 * k, base + 3.8 * k], [dx + 1.2 * k, base + 3.8 * k], [dx + 1.5 * k, base - 0.4]]), '#2a3050', 0.12),
    poly(p([[dx - 1.45 * k, base + 3.7 * k], [dx - 0.8 * k, base + 4.9 * k], [dx, base + 5.3 * k], [dx + 0.8 * k, base + 4.9 * k], [dx + 1.45 * k, base + 3.7 * k]]), '#8a6644'),
    box(at, doorX, doorUp, doorX + doorW, doorUp + doorH, '#3a5f94'),
  ]
}

/** The steps zigzagging down the cliff to the bay. */
const SANTORINI_STEPS: readonly Point[] = [[19.5, 6.4], [23, 4], [20.6, 3.4], [24.6, 2.4], [23, 1.7], [27, 1.2]]

/** Oia on its cliff over the caldera: the sea and the far isles, the cliff's dark and rusty layers, the houses stacked down it with their blue-domed churches, the bell tower and the windmill, the bay's tavernas at its foot. */
const santorini = (at: At): Shape[] => {
  const p = placer(at)
  // A layer of the cliff from `low` to `high`, wavering, the rim cutting it off.
  const edge = (high: number): Point[] => Array.from({ length: 29 }, (_, i): Point => [-54 + i * 3, Math.min(heightAlong(SANTORINI_RIM, -54 + i * 3, 1), high + 0.045 * i + 0.4 * Math.sin(i / 1.2 + high))])
  const layer = (low: number, high: number, fill: string): Shape => poly(p([...edge(high), ...edge(low).reverse()]), fill)
  const shapes: Shape[] = [
    // Thirasia across the caldera, the sea, the burnt isle in it.
    poly(p([[24, 2.4], [29, 3.6], [36, 4.5], [44, 4.2], [50, 3.2], [55, 2.4]]), '#8c9cc4'),
    ...water(at, -55, 55, 2.4, '#1f4f9c'),
    poly(p([[34, 1.2], [37, 2.3], [41, 2.7], [45, 2.1], [48, 1.2]]), '#5c5466'),
    poly(p([...SANTORINI_RIM, [-55, 1]]), '#3e3034'),
    layer(2.2, 3.6, '#6a3a32'),
    layer(4.6, 5.4, '#56403e'),
    layer(6.4, 8.4, '#83503c'),
    layer(9.4, 10.8, '#a06a50'),
    line(p(SANTORINI_STEPS), 0.28 * at.s, '#d8c4a8', 0.85),
    ...SANTORINI_MILLS.flatMap(mill => santoriniMill(at, mill)),
    line(p(santoriniSpars(SANTORINI_MILLS[1], 0.4)), 0.12 * at.s, '#5a4632'),
  ]
  SANTORINI_HOUSES.forEach((houses, row) => {
    const up = SANTORINI_ROWS[row]?.[0] ?? 0
    const white = houses.filter(house => house.wall === '#f8f6f0')
    if (white.length > 0) shapes.push(poly(p(white.flatMap(house => santoriniHouse(house, up))), '#f8f6f0'))
    shapes.push(
      ...houses.filter(house => house.wall !== '#f8f6f0').map(house => poly(p(santoriniHouse(house, up)), house.wall)),
      poly(p(houses.flatMap(house => santoriniHouse(house, up, 0.72))), '#2a3050', 0.13),
      ...houses.flatMap(house => santoriniOpenings(house, up)).filter(opening => santoriniSeen(row, opening)).map(([dx, base, w, h]) => box(at, dx, base, dx + w, base + h, '#3a5f94')),
      ...SANTORINI_CHURCHES.filter(([on]) => on === row).flatMap(church => santoriniChurch(at, church)),
      ...(row === 0 ? santoriniBellTower(at, up) : []),
    )
  })
  // Bougainvillea over the walls, and the bay's tavernas and boats at the cliff's foot.
  shapes.push(
    ...([[-17.6, 10.4], [-2.6, 7.2], [11.8, 6], [-21, 12.2]] as const).map(([dx, up]) => dot(at, dx, up, 0.6, 0.45, '#d4388a', 0.9)),
    box(at, 25.6, 1, 27.4, 2.2, '#f4efe4'),
    box(at, 27.6, 1, 29.4, 1.9, '#e8b890'),
    box(at, 26.1, 1.2, 26.6, 1.8, '#3a5f94'),
    box(at, 28.2, 1.2, 28.7, 1.6, '#3a5f94'),
    poly(p([[30.2, 0.9], [32.6, 0.9], [32.2, 0.5], [30.6, 0.5]]), '#c8402e'),
    poly(p([[22.4, 0.7], [24.4, 0.7], [24, 0.35], [22.8, 0.35]]), '#2e6ab8'),
  )

  return shapes
}

/** Oia by night: warm windows all down the cliff, the bells lit, the churches and their domes floodlit, lanterns down the steps, the tavernas' lights in the sea. */
const santoriniLights = (at: At): Shape[] => {
  const p = placer(at)
  const windows = SANTORINI_HOUSES.flatMap((houses, row) => houses.flatMap(house => santoriniOpenings(house, SANTORINI_ROWS[row]?.[0] ?? 0).filter((opening, i) => rnd('oia-lit', house.seed, i) < 0.85 && santoriniSeen(row, opening))))
  const top = SANTORINI_ROWS[0][0]
  const churches = SANTORINI_CHURCHES.map(church => ({ church, ...santoriniChurchAt(church) }))
  const lit = ([dx, up, w, h]: SantoriniOpening): Shape => box(at, dx, up, dx + w, up + h, '#ffd27a', 0.85)

  return [
    ...glow(at, -3, 8, 21, 5.4, '#ffc874', 0.09),
    // The churches' walls floodlit above the houses in front of them, and the bell tower.
    ...churches.flatMap(({ church: [, from, to, tall, r], base, mid, drum }) => [box(at, from, base + 0.8, to, base + tall, '#fff2d4', 0.3), box(at, mid - r * 0.75, base + tall, mid + r * 0.75, drum, '#fff2d4', 0.3)]),
    box(at, SANTORINI_TOWER - 0.95, top, SANTORINI_TOWER + 0.95, top + 3.4, '#fff2d4', 0.3),
    box(at, SANTORINI_TOWER - 0.65, top + 3.4, SANTORINI_TOWER + 0.65, top + 4.7, '#fff2d4', 0.3),
    ...churches.map(({ church: [, , , , r], mid, drum }) => poly(p(domeCurve(mid, drum, r, r * 1.1)), '#9cc2ff', 0.35)),
    ...windows.map(lit),
    ...SANTORINI_BELLS.map(([dx, up, w, h]) => lit([SANTORINI_TOWER + dx, top + up, w, h])),
    ...([[26.1, 1.2, 0.5, 0.6], [28.2, 1.2, 0.5, 0.4], ] as const).map(lit),
    ...SANTORINI_MILLS.map(mill => lit(santoriniMillDoor(mill))),
    ...SANTORINI_STEPS.map(([dx, up]) => dot(at, dx, up + 0.2, 0.24, 0.24, '#ffe0a0', 0.95)),
    // The tavernas' lights in the water.
    ...[25.9, 28.4].map(dx => line(p([[dx, 0.85], [dx, 0.15]]), 0.3 * at.s, '#ffc870', 0.4)),
  ]
}

/** Where the sailing boat is: crossing the bay leftward, faded in and out at the stretch's ends. */
const santoriniBoat = (now: number): { dx: number; fade: number } => {
  const dx = 52 - mod(now / 1000, 104)

  return { dx, fade: Math.max(0, Math.min(1, (52 - Math.abs(dx)) / 6)) }
}

/** The near windmill's sails turning, a sailing boat crossing the bay, and the glints on the sea. */
const santoriniMoving = (at: At, now: number): Shape[] => {
  const p = placer(at)
  const [mill] = SANTORINI_MILLS
  const turn = now / 2600
  const { dx, fade } = santoriniBoat(now)

  return [
    ...glints(at, -55, 52, 1, now),
    line(p(santoriniSpars(mill, turn)), 0.14 * at.s, '#5a4632'),
    ...[0, 1, 2, 3, 4, 5].map(k => poly(p([santoriniSail(mill, turn, k, 0.7, 0), santoriniSail(mill, turn, k, 3, 0), santoriniSail(mill, turn, k, 2.3, 1)]), '#f8f4ea', 0.95)),
    poly(p([[dx - 2.2, 0.9], [dx + 2, 0.9], [dx + 1.6, 0.2], [dx - 1.5, 0.2]]), '#f2efe8', fade),
    line(p([[dx + 0.3, 0.9], [dx + 0.3, 4.7]]), 0.14 * at.s, '#5a4a3a', fade),
    poly(p([[dx + 0.5, 1.2], [dx + 0.5, 4.5], [dx + 2.2, 1.2]]), '#fbf8f0', fade),
    poly(p([[dx + 0.1, 4.1], [dx - 1.9, 1.1], [dx + 0.1, 1.1]]), '#fbf8f0', fade),
  ]
}

/** The boat's lantern at its masthead, by night. */
const santoriniLantern = (at: At, now: number, light: Light): Shape[] => {
  const { dx, fade } = santoriniBoat(now)
  if (light.dark * fade < 0.02) return []

  return [...glow(at, dx + 0.3, 4.8, 1.3, 1.3, '#ffcf70', 0.45 * light.dark * fade), dot(at, dx + 0.3, 4.8, 0.26, 0.26, '#ffe6a0', light.dark * fade)]
}

/** The valley's walls of tuff either side, flat-topped, each with its fill. */
const CAPPADOCIA_MESAS = [
  [[[-55, 0], [-52, 4.2], [-48.5, 7], [-44, 7.7], [-36, 7.9], [-31.5, 7.2], [-28.5, 5], [-25.5, 2.4], [-23, 0]], '#d9a58c'],
  [[[21, 0], [24.5, 3], [28, 5.6], [32, 6.7], [42, 6.9], [47, 6.1], [51, 3.6], [55, 0]], '#dfb398'],
] as const

type CappadociaChimney = readonly [number, number, number, number, number]

/** The fairy chimneys, back to front: each `[dx, h, w, lean, cap]`, its cap's half-width (none, a cone of bare tuff). */
const CAPPADOCIA_CHIMNEYS: readonly CappadociaChimney[] = [
  [-40, 4.6, 2.4, 0, 0],
  [-35.5, 6, 2.8, 0.3, 0],
  [37.5, 5.2, 2.6, -0.2, 0],
  [43.5, 4.2, 2.2, 0, 0],
  [-24.5, 5.4, 2.6, -0.2, 1.1],
  [-19, 8.4, 5, 0.2, 0],
  [-14.4, 5.6, 3.4, 0.3, 0],
  [20.8, 6.8, 4, 0, 0],
  [16.2, 9.6, 3.4, 0.3, 1.5],
  [11.6, 5.4, 2.6, -0.2, 1.1],
  [-8.8, 9, 3.2, -0.3, 1.4],
  [5.6, 7.6, 3, 0.4, 1.3],
  [1.4, 11.2, 3.4, 0.3, 1.55],
  [-3.8, 13.6, 3.8, -0.2, 1.7],
]

/** A chimney's half-width `t` of the way up: a wide foot, its sides curving in to its neck under the cap; without one, a sugarloaf. */
const cappadociaHalf = ([, , w, , cap]: CappadociaChimney, t: number): number => (cap > 0 ? 0.6 * cap + (w - 0.6 * cap) * (1 - t) ** 1.7 : w * (1 - t ** 1.8) ** 0.75)

/** A chimney's own tone of tuff, cream to rose; the far ones paler. */
const cappadociaTone = ([dx, h]: CappadociaChimney): string => mix(mix('#f4e6ce', '#e6c6aa', rnd('chimney-tone', dx)), '#f2e8e0', Math.abs(dx) > 30 ? 0.3 : h < 6 ? 0.12 : 0)

/** A fairy chimney's outline: its left side up, its right side down; with `shade`, its shaded right side alone. */
const cappadociaCone = (chimney: CappadociaChimney, shade = false): Point[] => {
  const [dx, h, , lean] = chimney
  const steps = [0, 0.2, 0.4, 0.6, 0.8, 0.92, 1]
  const side = (k: number): Point[] => steps.map((t): Point => [dx + lean * t + k * cappadociaHalf(chimney, t), h * t])

  return [...(shade ? steps.map((t): Point => [dx + lean * t + 0.4 * cappadociaHalf(chimney, t), h * t]) : side(-1)), ...side(1).reverse()]
}

/** A chimney's dark basalt cap, overhanging its neck; or without one, its rounded tip in its own `tone`. */
const cappadociaCap = (at: At, [dx, h, , lean, c]: CappadociaChimney, tone: string): Shape => {
  const x = dx + lean
  const p = placer(at)

  return c > 0
    ? poly(p([[x - c, h - 0.3], [x - c * 0.95, h + 0.35], [x - c * 0.55, h + 0.95], [x + c * 0.15, h + 1.15], [x + c * 0.75, h + 0.8], [x + c, h + 0.1], [x + c * 0.9, h - 0.35]]), '#5a4642')
    : poly(p([[x - 0.6, h - 0.5], [x - 0.3, h - 0.1], [x, h], [x + 0.3, h - 0.1], [x + 0.6, h - 0.5]]), tone)
}

/** Whether a chimney, the `from`th or one after it (nearer), stands in front of `[dx, up]`. */
const cappadociaHides = (from: number, dx: number, up: number): boolean =>
  CAPPADOCIA_CHIMNEYS.slice(from).some(chimney => {
    const [cx, h, , lean] = chimney

    return up <= h && Math.abs(dx - cx - (lean * up) / h) < cappadociaHalf(chimney, up / h)
  })

type CappadociaCave = readonly [number, number, number, number]

/** The cave windows and doors cut in the rock, each `[dx, up, w, h]`: in the valley walls, then in the chimneys (a door at the foot of the big ones), all but those a nearer chimney hides. */
const CAPPADOCIA_CAVES: readonly CappadociaCave[] = [
  ...([[-50, 2.6, 0.6, 0.8], [-46.5, 4.8, 0.55, 0.7], [-42, 3, 0.6, 0.8], [-38.6, 5.4, 0.55, 0.7], [-31, 3.4, 0.6, 0.8], [-29.4, 5.4, 0.5, 0.6], [27, 2.4, 0.6, 0.8], [30.5, 4.4, 0.55, 0.7], [34, 2.6, 0.6, 0.8], [40.5, 4.6, 0.55, 0.7], [46, 3, 0.6, 0.8]] as const).filter(([dx, up, w, h]) => !cappadociaHides(0, dx + w / 2, up + h / 2)),
  ...CAPPADOCIA_CHIMNEYS.flatMap((chimney, j): CappadociaCave[] => {
    const [dx, h, , lean] = chimney
    if (Math.abs(dx) > 30) return []
    const count = Math.round(h / 3.6)
    const windows = Array.from({ length: count }, (_, i): CappadociaCave => {
      const t = 0.16 + (0.6 * (i + rnd('cave-up', dx, i) * 0.5)) / Math.max(1, count)
      const half = cappadociaHalf(chimney, t)

      return [dx + lean * t + (i % 2 === 0 ? -0.75 : 0.15) * half * (0.5 + 0.5 * rnd('cave-x', dx, i)), h * t, 0.52, 0.72]
    })
    const door: CappadociaCave = [dx - 0.4 + 0.3 * rnd('cave-door', dx), 0.15, 0.8, 1.3]

    return (h > 8 ? [...windows, door] : windows).filter(([x, up, w, tall]) => !cappadociaHides(j + 1, x + w / 2, up + tall / 2))
  }),
]

/** A cave window or door: a dark arch in the rock, or with `lit` a warm one (a polygon, so that all of them draw as one path). */
const cappadociaCave = (at: At, [dx, up, w, h]: CappadociaCave, lit: boolean): Shape =>
  poly(placer(at)([[dx, up], [dx, up + h - 0.4 * w], [dx + w / 2, up + h], [dx + w, up + h - 0.4 * w], [dx + w, up]]), lit ? '#ffcf70' : '#5c3e36', lit ? 0.9 : 0.85)

/** Cappadocia's valley: the far plateau in the haze, the rose and cream tuff walls in bands, the fairy chimneys under their basalt caps, cave windows cut in them, poplars and apricot trees on the valley floor. */
const cappadocia = (at: At): Shape[] => {
  const p = placer(at)
  const shapes: Shape[] = [ridge(at, -55, 55, 6.2, 1, '#d6bec2', 3)]
  for (const [outline, fill] of CAPPADOCIA_MESAS) {
    const from = outline[0]?.[0] ?? 0
    const to = outline[outline.length - 1]?.[0] ?? 0
    // A band of the tuff from `low` to `high`, the wall's own outline cutting it off.
    const band = (low: number, high: number): Point[] => {
      const edge = (up: number): Point[] => Array.from({ length: Math.round((to - from) / 3) + 1 }, (_, i): Point => [from + 3 * i, Math.min(heightAlong(outline, from + 3 * i), up + 0.25 * Math.sin((from + 3 * i) / 2.3))])

      return [...edge(high), ...edge(low).reverse()]
    }
    shapes.push(poly(p(outline), fill), poly(p(band(1.6, 2.6)), '#c78a76'), poly(p(band(3.8, 4.5)), '#f0dcc4'), poly(p(band(5.6, 6.1)), '#cf9884'))
  }
  for (const chimney of CAPPADOCIA_CHIMNEYS) {
    const tone = cappadociaTone(chimney)
    shapes.push(poly(p(cappadociaCone(chimney)), tone), poly(p(cappadociaCone(chimney, true)), '#9a6a58', 0.32), cappadociaCap(at, chimney, tone))
  }
  shapes.push(
    ...CAPPADOCIA_CAVES.map(cave => cappadociaCave(at, cave, false)),
    ...[-27.6, -25.8, 24.6, 26.4].map(dx => cypress(at, dx, 6 + 1.2 * rnd('poplar', dx), '#7e9448')),
    ...roundTree(at, -30, 4.2, '#6e8a46', '#9ab25a'),
    ...roundTree(at, 30.6, 3.8, '#6e8a46', '#9ab25a'),
    ...roundTree(at, -7.8, 3, '#6e8a46', '#9ab25a'),
  )

  return shapes
}

/** Cappadocia by night: its cave windows lit, the capped chimneys lit gold from their feet up, a glow over the valley floor, lanterns on the terraces. */
const cappadociaLights = (at: At): Shape[] => {
  const uplight: Gradient = { x1: 0, y1: at.y, x2: 0, y2: at.y - 14 * at.s, stops: [[0, '#ffb45c', 0.46], [0.45, '#ffc880', 0.2], [1, '#ffd8a0', 0.05]] }

  return [
    ...glow(at, -1, 3, 19, 5.5, '#ffbe70', 0.12),
    ...CAPPADOCIA_CHIMNEYS.filter(([, , , , cap]) => cap > 0).map(chimney => poly(placer(at)(cappadociaCone(chimney)), '#ffc888', 1, uplight)),
    ...CAPPADOCIA_CAVES.filter((_, i) => rnd('cappadocia-lit', i) < 0.85).map(cave => cappadociaCave(at, cave, true)),
    ...[-17, -9, -1.5, 4.4, 10, 16].map(dx => dot(at, dx, 0.5, 0.22, 0.22, '#ffe0a0', 0.95)),
  ]
}

type CappadociaBalloon = readonly [number, number, number, readonly [string, string, string]]

/** The balloons: each `[dx, up, r, colours]`, where it hangs, how big, its gores from the outside in. */
const CAPPADOCIA_BALLOONS: readonly CappadociaBalloon[] = [
  [16, 13.4, 2.4, ['#d8342e', '#f6c232', '#d8342e']],
  [-21, 15, 1.9, ['#2e62c4', '#f4f0e4', '#f6c232']],
  [33, 10.6, 1.4, ['#f6c232', '#d8342e', '#2e62c4']],
  [-37, 13.4, 0.9, ['#e8742e', '#f6d24a', '#e8742e']],
  [8, 16.4, 0.75, ['#7a3ab8', '#f6c232', '#7a3ab8']],
]

/** Where the `i`th balloon is now: rising and sinking, drifting to and fro, slowly. */
const cappadociaAloft = ([dx, up]: CappadociaBalloon, i: number, now: number): Point => [dx + 2.6 * Math.sin(now / (9000 + 2100 * i) + 1.7 * i), up + 2.2 * Math.sin(now / (7000 + 1300 * i) + 2.9 * i)]

/** A balloon's envelope `r` round at `[bx, by]`, round over its top and narrowing to its mouth; `k` across, a gore of it. */
const cappadociaEnvelope = (bx: number, by: number, r: number, k: number): Point[] => [
  ...[-35, 0, 30, 60, 90, 120, 150, 180, 215].map((a): Point => [bx + k * r * Math.cos((a * Math.PI) / 180), by + r * Math.sin((a * Math.PI) / 180)]),
  [bx - 0.3 * r * k, by - 1.4 * r],
  [bx + 0.3 * r * k, by - 1.4 * r],
]

/** The hot-air balloons, striped, their baskets hung under them, drifting over the valley. */
const cappadociaBalloons = (at: At, now: number): Shape[] => {
  const p = placer(at)

  return CAPPADOCIA_BALLOONS.flatMap((balloon, i) => {
    const [, , r, colours] = balloon
    const [bx, by] = cappadociaAloft(balloon, i, now)
    const basket = box(at, bx - 0.26 * r, by - 2.15 * r, bx + 0.26 * r, by - 1.82 * r, '#6a4630')

    return r < 1.2
      ? [poly(p(cappadociaEnvelope(bx, by, r, 1)), colours[0]), poly(p(cappadociaEnvelope(bx, by, r, 0.5)), colours[1]), basket]
      : [
          poly(p(cappadociaEnvelope(bx, by, r, 1)), colours[0]),
          poly(p(cappadociaEnvelope(bx, by, r, 0.66)), colours[1]),
          poly(p(cappadociaEnvelope(bx, by, r, 0.28)), colours[2]),
          line(p([[bx - 0.3 * r, by - 1.4 * r], [bx - 0.24 * r, by - 1.84 * r], [bx + 0.24 * r, by - 1.84 * r], [bx + 0.3 * r, by - 1.4 * r]]), 0.1 * at.s, '#4a3428'),
          basket,
        ]
  })
}

/** The burners flaring now and then, a flame at each big balloon's mouth: by day a glint of fire, fading as it darkens; by night every envelope aglow from within, the more as its burner flares. */
const cappadociaBurners = (at: At, now: number, light: Light): Shape[] =>
  CAPPADOCIA_BALLOONS.flatMap((balloon, i) => {
    const [, , r] = balloon
    const cycle = 6000 + 2300 * i
    const phase = mod(now + cycle * rnd('burner', i), cycle) / cycle
    // The far ones too small to see their flames.
    const flare = r >= 1.2 && phase < 0.2 ? Math.sin((Math.PI * phase) / 0.2) * (0.85 + 0.15 * Math.sin(now / 45)) : 0
    const [bx, by] = cappadociaAloft(balloon, i, now)
    const p = placer(at)
    const night = light.dark > 0.05 ? [poly(p(cappadociaEnvelope(bx, by, r, 1)), '#ff9a48', light.dark * (0.3 + 0.3 * flare))] : []
    if (flare <= 0) return night
    const day = Math.max(0, 1 - light.dark / 0.3) * flare

    return [
      ...night,
      ...(light.dark > 0.05 ? [poly(p(cappadociaEnvelope(bx, by - 0.25 * r, r * 0.62, 0.8)), '#ffd078', 0.55 * light.dark * flare)] : []),
      ...(day > 0 ? [dot(at, bx, by - 1.35 * r, 0.5 * r, 0.6 * r, '#ffb048', 0.2 * day), dot(at, bx, by - 1.35 * r, 0.3 * r, 0.36 * r, '#ffc860', 0.35 * day)] : []),
      poly(p([[bx - 0.2 * r, by - 1.62 * r], [bx - 0.08 * r, by - 1.2 * r], [bx, by - 0.95 * r], [bx + 0.08 * r, by - 1.2 * r], [bx + 0.2 * r, by - 1.62 * r]]), '#fff0a0', flare),
    ]
  })

/** Where the Treasury's six lower columns stand across. */
const KHAZNEH_COLUMNS = [-5, -3.3, -1.15, 1.15, 3.3, 5] as const

/** The Treasury's facade carved in the rose-red rock: six columns under a pediment, the tholos between broken pediments above, its dark doorway; with `lit`, its stone alone, warm in the candlelight below. */
const khazneh = (at: At, lit = false): Shape[] => {
  const p = placer(at)
  const stone = lit ? '#ffc47c' : '#e6a98a'
  const shade = lit ? '#f8a860' : '#c8866c'
  // The lower storey nearest the candles, the upper fainter.
  const low = lit ? 0.72 : 1
  const high = lit ? 0.5 : 1
  const shapes: Shape[] = lit
    ? [box(at, -0.75, 0.4, 0.75, 4.4, '#ffb050', 0.4)]
    : [
        poly(p([[-6.6, 0], [-6.6, 16.6], [-5.2, 18.4], [-2.2, 18.9], [2.2, 18.9], [5.2, 18.4], [6.6, 16.6], [6.6, 0]]), '#a65c48'),
        box(at, -5.8, 0.4, 5.8, 6.3, '#a8664f'),
        box(at, -3.6, 0.4, 3.6, 6.3, '#6e3a30'),
        box(at, -0.75, 0.4, 0.75, 4.4, '#3a201c'),
        box(at, -5.6, 9.2, 5.6, 14.4, '#874838'),
      ]
  // The upper storey: attic, the tholos's drum (dark by night, so its columns show), columns, broken pediments, roof, urn.
  shapes.push(
    box(at, -5.9, 7.8, 5.9, 9.2, shade, high),
    ...(lit ? [] : [box(at, -2.1, 9.2, 2.1, 13.8, shade)]),
    ...([[-5.05, 0.36], [-3.65, 0.36], [3.65, 0.36], [5.05, 0.36], [-1.65, 0.27], [-0.58, 0.27], [0.58, 0.27], [1.65, 0.27]] as const).map(([cx, half]) => box(at, cx - half, 9.2, cx + half, 13.6, stone, high)),
    ...([-1, 1] as const).map(side => poly(p([[side * 5.9, 13.6], [side * 5.9, 14.3], [side * 6.1, 14.3], [side * 3, 15.6], [side * 3, 13.6]]), stone, high)),
    poly(p([[-2.3, 13.8], [-2.3, 14.5], [-2.2, 14.5], [-1.1, 15.15], [-0.4, 15.75], [0, 16.15], [0.4, 15.75], [1.1, 15.15], [2.2, 14.5], [2.3, 14.5], [2.3, 13.8]]), stone, high),
    poly(p([[-0.25, 16], [-0.25, 16.6], [-0.6, 17], [-0.5, 17.5], [0, 17.8], [0.5, 17.5], [0.6, 17], [0.25, 16.6], [0.25, 16]]), stone, high),
    // The lower storey: its entablature and pediment, its columns.
    box(at, -6.2, 6.8, 6.2, 7.8, stone, low),
    poly(p([[-4.2, 7.8], [0, 9.9], [4.2, 7.8]]), stone, low),
    ...KHAZNEH_COLUMNS.map(cx => box(at, cx - 0.38, 0.4, cx + 0.38, lit ? 6.8 : 6.3, stone, low)),
    ...(lit ? [] : KHAZNEH_COLUMNS.map(cx => box(at, cx - 0.52, 6.3, cx + 0.52, 6.8, stone))),
  )
  if (lit) return shapes

  return [
    ...shapes,
    poly(p([[-3.3, 8], [0, 9.4], [3.3, 8]]), shade),
    box(at, -6.2, 6.8, 6.2, 7.05, shade),
    ...KHAZNEH_COLUMNS.map(cx => box(at, cx + 0.1, 0.4, cx + 0.38, 6.3, shade, 0.6)),
    box(at, -6.8, 0, 6.8, 0.4, shade),
  ]
}

/** The Siq's walls' sandstone weathered into bulging domes, `[across, half as wide, high]`, stepping down out to the stretch's edges. */
const SIQ_DOMES = [[13, 9, 18.2], [22, 8, 14], [31, 8.4, 10.2], [40, 7.6, 6.6], [48, 5.6, 3.2]] as const

/** How high the Siq's walls stand `dx` across: the tallest of their domes there, the right's a little out of step with the left's, down to nothing at the edges. */
const siqTop = (dx: number): number => {
  const x = Math.abs(dx) + (dx > 0 ? 1.2 : 0)

  return Math.max(0, ...SIQ_DOMES.map(([c, r, h]) => h * Math.sqrt(Math.max(0, 1 - ((x - c) / r) ** 2)))) * Math.max(0, Math.min(1, (52 - Math.abs(dx)) / 5))
}

/** One of the Siq's walls in its shade, `side` -1 left or 1 right: its rock, its swirling bands, the sun along its inner edge. */
const siqWall = (at: At, side: -1 | 1): Shape[] => {
  const p = placer(at)
  const top: Point[] = []
  for (let x = 52; x >= 11.5; x -= 1.5) top.push([side * x, siqTop(side * x)])
  const cleft = ([[11, siqTop(side * 11)], [10.3, 15.6], [10.9, 12], [10, 8.4], [10.7, 4.6], [9.9, 0]] as const).map(([x, up]): Point => [side * (x + (side > 0 ? 0.3 : 0)), up])
  const band = (k: number, wobble: number): Point[] => top.filter(([x]) => Math.abs(x) < 49).map(([x, up]): Point => [x, k * up + wobble * Math.sin(x * 0.45 + k * 9) * Math.min(1, up / 5)])

  return [
    poly(p([[side * 52, -0.2], ...top, ...cleft]), side < 0 ? '#8c4a3a' : '#94503e'),
    line(p(band(0.32, 0.5)), 0.5 * at.s, '#a65a46', 0.6),
    line(p(band(0.56, 0.6)), 0.35 * at.s, '#6e3628', 0.45),
    line(p(band(0.78, 0.4)), 0.45 * at.s, '#b0644c', 0.55),
    line(p(cleft.slice(0, 5)), 0.4 * at.s, '#c8785c', 0.7),
    ...[17.6, 26.6, 35.6].map(x => line(p([[side * x, siqTop(side * x) - 0.6], [side * (x + 0.8), siqTop(side * x) * 0.55], [side * (x + 0.3), 0.4]]), 0.22 * at.s, '#5e2e24', 0.5)),
  ]
}

/** An oleander in flower, pink in the dry wadi. */
const petraOleander = (at: At, dx: number, k: number): Shape[] => [
  dot(at, dx - 0.9 * k, 0.8 * k, 1.2 * k, 0.9 * k, '#4e6e3e'),
  dot(at, dx + 0.8 * k, 0.9 * k, 1.1 * k, 0.95 * k, '#4e6e3e'),
  dot(at, dx, 1.5 * k, 1.1 * k, 0.9 * k, '#5e7e48'),
  ...([[-1.2, 1.1], [0.2, 2], [1.1, 1.3], [-0.3, 0.9]] as const).map(([fx, fy]) => dot(at, dx + fx * k, fy * k, 0.32, 0.3, '#f08aa8')),
]

/** A camel couched in the sand, its red Bedouin blanket over its hump (its head and neck move apart). */
const petraCamel = (at: At): Shape[] => {
  const p = placer(at)

  return [
    line(p([[16.9, 1.7], [16.6, 0.9]]), 0.2 * at.s, '#a07448'),
    dot(at, 19.6, 0.45, 2.7, 0.45, '#a07448'),
    dot(at, 19.6, 1.35, 2.5, 1.05, '#c99e66'),
    dot(at, 19.1, 2.2, 1.35, 0.9, '#c99e66'),
    poly(p([[17.9, 2.1], [18.5, 2.95], [19.8, 2.95], [20.4, 2], [20.1, 0.9], [18.1, 0.9]]), '#b4362e'),
    line(p([[18.05, 1.4], [20.3, 1.4]]), 0.22 * at.s, '#f2c450'),
  ]
}

/** The camel's neck and head, chewing and looking about. */
const petraCamelHead = (at: At, now: number): Shape[] => {
  const p = placer(at)
  const nod = 0.25 * Math.sin(now / 1900) + 0.06 * Math.sin(now / 230)
  const head: Point = [23.2, 3.5 + nod]

  return [
    line(p([[21.3, 1.7], [22.4, 2.3], [head[0] - 0.4, head[1] - 0.1]]), 0.75 * at.s, '#c99e66'),
    dot(at, head[0], head[1], 0.85, 0.42, '#c99e66'),
    dot(at, head[0] - 0.5, head[1] + 0.35, 0.18, 0.28, '#a07448'),
  ]
}

/** The rose-red cliff the Treasury is carved from, its top weathered round. */
const KHAZNEH_CLIFF: readonly Point[] = [[-17, -0.2], [-17, 12], [-16, 15.2], [-14.2, 17.2], [-11.6, 18.4], [-9, 18.6], [-6.4, 19.5], [-3.6, 19.8], [-1, 19.5], [1.4, 19.9], [4.2, 19.7], [7, 19], [9.6, 18.6], [12, 18.2], [14.4, 16.8], [16.2, 14.6], [17, 12], [17, -0.2]]

/** Al-Khazneh in its cliff at the end of the Siq: the pale rock beyond, the Treasury's facade, the Siq's dark walls framing it, a camel resting, oleanders. */
const petra = (at: At): Shape[] => {
  const p = placer(at)
  const banding = (up: number, half: number, fill: string, alpha: number): Shape => line(p(Array.from({ length: 12 }, (_, i): Point => [-half + (i * 2 * half) / 11, up + 0.7 * Math.sin(i * 1.3 + up)])), 0.5 * at.s, fill, alpha)

  return [
    ridge(at, -55, -14, 7.5, 2, '#d6aa9c', 2),
    ridge(at, 14, 55, 8, 2, '#d0a296', 6),
    poly(p(KHAZNEH_CLIFF), '#c47860'),
    banding(4, 16, '#d8957a', 0.5),
    banding(10, 16, '#a85e4a', 0.4),
    banding(15.5, 13, '#dc9c80', 0.45),
    ...khazneh(at),
    ...siqWall(at, -1),
    ...siqWall(at, 1),
    dot(at, -12.4, 0.5, 1.8, 0.8, '#6e382c'),
    dot(at, 13.4, 0.4, 1.4, 0.6, '#6e382c'),
    ...petraOleander(at, -15.5, 1),
    ...petraOleander(at, 26, 0.8),
    ...petraCamel(at),
  ]
}

/** Petra by Night's candles in their paper bags: rows on the ground before the Treasury, wider and bigger nearer. */
const PETRA_CANDLES: readonly (readonly [number, number, number])[] = (
  [
    [0.35, 6, 0.15, 6],
    [-0.6, 8, 0.2, 7],
    [-1.8, 10, 0.25, 8],
    [-3.3, 12.5, 0.3, 9],
  ] as const
).flatMap(([up, half, r, n]) => Array.from({ length: n }, (_, i) => [-half + (2 * half * i) / (n - 1), up, r] as const))

/** The Treasury warm in the candlelight, its doorway glowing, the rows of candles before it. */
const petraLights = (at: At): Shape[] => [
  ...glow(at, 0, 5, 13, 10, '#ffa850', 0.2),
  ...khazneh(at, true),
  ...glow(at, 0, -1.4, 15, 2.8, '#ffb860', 0.3),
  ...PETRA_CANDLES.map(([dx, up, r]) => dot(at, dx, up, r * 1.2, r, '#ffd27a', 0.92)),
]

/** Some of the candles flickering, brighter a moment. */
const petraCandles = (at: At, now: number, light: Light): Shape[] => {
  const on = Math.max(0, Math.min(1, (light.dark - 0.2) / 0.6))
  if (on <= 0) return []

  return PETRA_CANDLES.filter((_, i) => i % 4 === 1).flatMap(([dx, up, r], i) => {
    const flicker = Math.max(0, Math.sin(now / (140 + 90 * rnd('petra-flicker', i)) + i * 2.3) * Math.sin(now / 410 + i))

    return [dot(at, dx, up, r * 3.4, r * 2.6, '#ffb050', 0.28 * on * flicker), dot(at, dx, up + r * 0.2, r * 0.7, r * 0.8, '#fff2c8', on * flicker)]
  })
}

/** The Burj Khalifa's setbacks on its left, each `[up to, half as wide]`: stepping in, spiralling, up to its spire. */
const BURJ_KHALIFA_LEFT = [[2.4, 1.85], [4.8, 1.6], [7, 1.35], [9.1, 1.12], [11, 0.9], [12.7, 0.69], [14.2, 0.5], [15.5, 0.32]] as const
/** Its setbacks on its right, at other heights than the left's as they spiral round. */
const BURJ_KHALIFA_RIGHT = [[1.3, 1.85], [3.6, 1.72], [5.9, 1.48], [8.1, 1.24], [10.1, 1.01], [11.9, 0.8], [13.5, 0.6], [14.9, 0.44], [15.5, 0.3]] as const

/** A side of the Burj Khalifa going up, its steps out to `side`. */
const burjKhalifaEdge = (steps: readonly (readonly [number, number])[], side: number): Point[] => {
  const points: Point[] = []
  let from = 0
  for (const [top, half] of steps) {
    points.push([side * half, from], [side * half, top])
    from = top
  }

  return points
}

/** How wide the Burj Khalifa is to a side at `up`. */
const burjKhalifaHalf = (steps: readonly (readonly [number, number])[], up: number): number => steps.find(([top]) => top > up)?.[1] ?? 0.3

/** The Burj Khalifa's outline: up its left side, its spire, down its right. */
const BURJ_KHALIFA: readonly Point[] = [...burjKhalifaEdge(BURJ_KHALIFA_LEFT, -1), [-0.16, 15.5], [-0.04, 20.2], [0.04, 20.2], [0.16, 15.5], ...burjKhalifaEdge(BURJ_KHALIFA_RIGHT, 1).reverse()]

/** The Burj Khalifa in silver glass: its shaded side, its bright middle wing, its podium. */
const burjKhalifa = (at: At): Shape[] => {
  const p = placer(at)

  return [
    poly(p(BURJ_KHALIFA), '#d8e0ea'),
    poly(p([[0.1, 0], [0.1, 15.5], [0.04, 20.2], [0.16, 15.5], ...burjKhalifaEdge(BURJ_KHALIFA_RIGHT, 1).reverse()]), '#8a98ae'),
    line(p([[-0.45, 0.6], [-0.45, 12], [-0.28, 13.8], [-0.14, 15.5]]), 0.2 * at.s, '#f6faff', 0.8),
    ...BURJ_KHALIFA_LEFT.slice(0, -1).map(([up, half]) => box(at, -half, up - 0.12, burjKhalifaHalf(BURJ_KHALIFA_RIGHT, up), up + 0.04, '#7e8ca0', 0.5)),
    box(at, -3, 0, 3, 1, '#a8b2c0'),
  ]
}

/** How a Dubai tower is topped. */
type DubaiTowerTop = 'flat' | 'slant' | 'peak' | 'round'

/** Dubai's towers, `[dx, wide, high, glass, top]`: the Emirates Towers' slanted peaks, glass blades, round crowns, the sandy blocks between. */
const DUBAI_TOWERS: readonly (readonly [number, number, number, string, DubaiTowerTop])[] = [
  [-31, 2.6, 4.6, '#a8b0ba', 'flat'],
  [-28, 2.2, 8.2, '#7890aa', 'peak'],
  [-25.4, 1.9, 6.8, '#7890aa', 'peak'],
  [-22.6, 2.6, 4.2, '#c2b49c', 'flat'],
  [-19.6, 2.3, 9.4, '#5f7fa2', 'round'],
  [-16.8, 2.6, 5.6, '#98a8ba', 'flat'],
  [-13.6, 2.1, 11, '#56769a', 'slant'],
  [-10.8, 2.6, 6.6, '#b0bcc8', 'flat'],
  [-7.6, 2.3, 9.6, '#7088a6', 'peak'],
  [4.6, 2.4, 8.6, '#62809f', 'round'],
  [7.6, 2.1, 10.6, '#4f7196', 'slant'],
  [10.4, 2.8, 6, '#a6b4c4', 'flat'],
  [13.8, 2.1, 8, '#7a92ac', 'peak'],
  [16.6, 2.6, 4.8, '#c4b8a2', 'flat'],
]

/** A tower's outline by its top. */
const dubaiTowerOutline = (dx: number, w: number, h: number, top: DubaiTowerTop): Point[] => {
  switch (top) {
    case 'flat':
      return [[dx, 0], [dx, h], [dx + w, h], [dx + w, 0]]
    case 'slant':
      return [[dx, 0], [dx, h - 1.6], [dx + w, h], [dx + w, 0]]
    case 'peak':
      return [[dx, 0], [dx, h - 1.4], [dx + w * 0.5, h], [dx + w, h - 1.4], [dx + w, 0]]
    case 'round':
      return [[dx, 0], [dx, h - 0.9], [dx + w * 0.15, h - 0.35], [dx + w * 0.5, h], [dx + w * 0.85, h - 0.35], [dx + w, h - 0.9], [dx + w, 0]]
  }
}

/** The towers far behind, `[dx, wide, high]`, pale in the haze, the Burj's place left clear. */
const DUBAI_FAR: readonly (readonly [number, number, number])[] = (() => {
  const far: [number, number, number][] = []
  for (let dx = -30, i = 0; dx < 18; i += 1) {
    const w = 2 + 1.4 * rnd('dubai-far-w', i)
    if (Math.abs(dx + w / 2) > 3) far.push([dx, w, 4 + 5.4 * rnd('dubai-far-h', i) ** 1.4])
    dx += w + 0.6
  }

  return far
})()

/** The city's glass towers round the Burj: the far ones pale in the haze, the near ones, each its glass catching the sun down one side. */
const dubaiCity = (at: At): Shape[] => {
  const p = placer(at)

  return [
    ...DUBAI_FAR.map(([dx, w, h]) => box(at, dx, 0, dx + w, h, '#c2cad6')),
    ...DUBAI_TOWERS.map(([dx, w, h, glass, top]) => poly(p(dubaiTowerOutline(dx, w, h, top)), glass)),
    ...DUBAI_TOWERS.map(([dx, w, h, , top]) => box(at, dx + w * 0.62, 0.4, dx + w, h - (top === 'flat' ? 0 : 1.6), '#1e2c40', 0.2)),
    ...DUBAI_TOWERS.map(([dx, , h, , top]) => box(at, dx + 0.3, 0.6, dx + 0.6, h - (top === 'flat' ? 0.5 : 1.8), '#eef4fa', 0.35)),
  ]
}

/** A dune: its windward slope in the sun up to a sharp crest, its slip face in shade. */
const dubaiDune = (at: At, dx: number, w: number, h: number, sun: string, shade: string): Shape[] => {
  const p = placer(at)

  return [
    poly(p([[dx - w, -0.2], [dx - w * 0.6, h * 0.35], [dx - w * 0.25, h * 0.82], [dx, h], [dx + w * 0.3, h * 0.55], [dx + w * 0.6, -0.2]]), sun),
    poly(p([[dx, h], [dx + w * 0.3, h * 0.55], [dx + w * 0.6, -0.2], [dx + w * 0.12, -0.2], [dx + w * 0.08, h * 0.5]]), shade),
  ]
}

/** The Burj Al Arab's sail, from its mast round its belly to its foot. */
const BURJ_AL_ARAB: readonly Point[] = [[31.8, 1], [32.6, 10.8], [33.6, 10.4], [34.9, 9.3], [35.9, 7.7], [36.5, 5.8], [36.6, 3.8], [36.3, 1]]

/** The Burj Al Arab's sail on its island: its mast behind, its white sail bellying to the sea, its helipad. */
const burjAlArab = (at: At): Shape[] => {
  const p = placer(at)

  return [
    line(p([[23, 0.5], [31.4, 0.7]]), 0.3 * at.s, '#c8c0b0'),
    poly(p([[30.8, 0.2], [31.4, 1.1], [37, 1.1], [37.6, 0.2]]), '#d8c8a4'),
    poly(p(BURJ_AL_ARAB), '#f6f8fb'),
    ...[3.6, 6, 8.2].map(up => line(p([[32 + up * 0.075, up], [36.6 - (up - 3.6) * 0.2 - (up > 7 ? 0.3 : 0), up - 0.5]]), 0.12 * at.s, '#c8d0dc', 0.8)),
    line(p([[31.6, 0.9], [32.6, 11], [32.4, 12.6]]), 0.42 * at.s, '#b4bcc8'),
    dot(at, 36.1, 8.6, 0.95, 0.24, '#dfe4ea'),
  ]
}

/** Dubai: the dunes at the edge of the desert, the city's towers, the Burj Khalifa over them all by its lake, palms, the sea and the Burj Al Arab. */
const dubai = (at: At): Shape[] => [
  ...dubaiDune(at, -40, 14, 4.8, '#ecd4a8', '#d6b486'),
  ...dubaiDune(at, -47, 8, 2.8, '#e6be84', '#c8975c'),
  ...dubaiDune(at, -35, 6.4, 2, '#e6be84', '#c8975c'),
  line(placer(at)([[-33.4, 0], [-33.4, 7.4]]), 0.2 * at.s, '#8a8e96'),
  ...dubaiCity(at),
  ...burjKhalifa(at),
  ...water(at, -9.4, 9.4, 0.8, '#3a86b0'),
  ...water(at, 19.6, 55, 1.6, '#2c92b8'),
  ...burjAlArab(at),
  ...palm(at, -11.6, 3.4, '#6a4a32', '#3a7a44'),
  ...palm(at, 10.8, 3, '#6a4a32', '#3a7a44'),
]

/** The city's lit floors by night: a few windows across each tower, as `rnd` has them. */
const DUBAI_WINDOWS: readonly (readonly [number, number, number])[] = DUBAI_TOWERS.flatMap(([dx, w, h], i) => {
  const lit: [number, number, number][] = []
  for (let up = 1, row = 0; up < h - 1.4; up += 1.3, row += 1) {
    if (rnd('dubai-lit', i, row) > 0.5) continue
    const long = 0.5 + (w - 1.1) * rnd('dubai-lit-w', i, row)
    const from = dx + 0.35 + (w - 0.7 - long) * rnd('dubai-lit-x', i, row)
    lit.push([from, up, from + long])
  }

  return lit
})

/** By night: the Burj Khalifa lit in bands up to its spire, the fountain's light on the lake, the Burj Al Arab's glow, the city's windows, lamps along the causeway. */
const dubaiLights = (at: At): Shape[] => {
  const bands: Shape[] = []
  for (let up = 1.8; up < 15.4; up += 1.4) bands.push(box(at, -burjKhalifaHalf(BURJ_KHALIFA_LEFT, up) + 0.08, up, burjKhalifaHalf(BURJ_KHALIFA_RIGHT, up) - 0.08, up + 0.36, '#eef4ff', 0.8))

  return [
    ...glow(at, 0, 8.5, 4.2, 11, '#c8dcff', 0.12),
    ...bands,
    line(placer(at)([[0, 15.5], [0, 19.9]]), 0.2 * at.s, '#e4ecff', 0.6),
    ...glow(at, 0, 1, 8, 2.4, '#ffe2a8', 0.3),
    ...glow(at, 34.3, 6, 4.6, 6.8, '#e4dcff', 0.22),
    ...DUBAI_WINDOWS.map(([from, up, to]) => box(at, from, up, to, up + 0.45, '#ffd890', 0.85)),
    ...DUBAI_FAR.filter((_, i) => i % 4 === 0).map(([dx, w, h]) => box(at, dx + w * 0.3, h - 1.6, dx + w * 0.7, h - 1.25, '#dce6ff', 0.6)),
    ...Array.from({ length: 4 }, (_, i) => dot(at, 24 + i * 2.1, 0.55 + i * 0.04, 0.16, 0.16, '#ffe6a0', 0.9)),
  ]
}

/** How far the fountain's and the sail's night colours are on: none until well into dusk. */
const dubaiLit = (light: Light): number => Math.max(0, Math.min(1, (light.dark - 0.2) / 0.6))

/** The Dubai Fountain's jets dancing in the lake below the Burj, swelling and falling, in `spray`. */
const dubaiFountain = (at: At, now: number, spray: string, alpha: number): Shape[] => {
  const p = placer(at)
  const swell = 0.6 + 0.4 * Math.sin(now / 4300)

  return Array.from({ length: 7 }, (_, i) => {
    const dx = -4.8 + i * 1.6
    const h = 1 + 3.6 * swell * (0.5 + 0.5 * Math.sin(now / 620 - Math.abs(i - 3) * 0.9))
    const sway = 0.6 * Math.sin(now / 1100 + i * 0.7)

    return line(p([[dx, 0.4], [dx + sway * 0.3, h * 0.6], [dx + sway, h]]), 0.24 * at.s, spray, alpha)
  })
}

/** The UAE's flag flying by the dunes: its red band at the pole, green, white and black, rippling. */
const uaeFlag = (at: At, now: number): Shape[] => {
  const p = placer(at)
  const flagPoint = (u: number, v: number): Point => [-33.3 + 2.8 * u, 7.3 - 1.6 * v + 0.22 * u * Math.sin(now / 260 - u * 4.5)]
  const stripe = (u0: number, u1: number, v0: number, v1: number, fill: string): Shape => {
    const along = [0, 1 / 3, 2 / 3, 1].map(k => u0 + (u1 - u0) * k)

    return poly(p([...along.map(u => flagPoint(u, v0)), ...[...along].reverse().map(u => flagPoint(u, v1))]), fill)
  }

  return [stripe(0.25, 1, 0, 1 / 3, '#00843d'), stripe(0.25, 1, 1 / 3, 2 / 3, '#f6f6f2'), stripe(0.25, 1, 2 / 3, 1, '#1e1e1e'), stripe(0, 0.25, 0, 1, '#d8262e')]
}

/** The flag; glints on the Gulf; a dhow under its lateen sail gliding along it, fading in and out at the ends of its run; by day the fountain's white spray. */
const dubaiMoving = (at: At, now: number, light: Light): Shape[] => {
  const p = placer(at)
  const dx = 22 + mod(now / 650, 30)
  const alpha = Math.max(0, Math.min(1, (dx - 22) / 3, (52 - dx) / 3))
  const bob = 0.1 * Math.sin(now / 700)
  const day = 1 - dubaiLit(light)

  return [
    ...uaeFlag(at, now),
    ...glints(at, 19.6, 55, 1.6, now),
    poly(p([[dx - 1.4, 0.7 + bob], [dx + 1.6, 0.7 + bob], [dx + 1.1, 0.2 + bob], [dx - 1, 0.2 + bob]]), '#6e4428', alpha),
    line(p([[dx, 0.7 + bob], [dx, 3 + bob]]), 0.14 * at.s, '#4a3020', alpha),
    poly(p([[dx - 1.2, 0.95 + bob], [dx + 1.3, 3.4 + bob], [dx + 0.9, 1 + bob]]), '#f2ead8', alpha),
    ...(day > 0.02 ? dubaiFountain(at, now, '#f2f8ff', 0.75 * day) : []),
  ]
}

/** The colours the Burj Al Arab's sail cycles through by night. */
const BURJ_AL_ARAB_COLOURS = ['#8ea0ff', '#c890f0', '#ff9ac0', '#ffe0b0', '#90e4ff'] as const

/** Red lights blinking on the Burj's tip and the tallest towers; by night the fountain lit warm, and the Burj Al Arab's sail lit in slowly changing colours. */
const dubaiGlowing = (at: At, now: number, light: Light): Shape[] => {
  const on = dubaiLit(light)
  const blink = mod(now, 1500) < 450 ? 1 : 0.12
  const reds = ([[0, 20.3, 0.3], [-11.7, 10.9, 0.2], [9.5, 10.5, 0.2]] as const).map(([dx, up, r]) => dot(at, dx, up, r, r, '#ff3a30', blink * (0.35 + 0.65 * light.dark)))
  if (on <= 0.02) return reds
  const turn = now / 7000
  const k = Math.floor(turn)
  const colour = mix(BURJ_AL_ARAB_COLOURS[mod(k, BURJ_AL_ARAB_COLOURS.length)] ?? '#ffffff', BURJ_AL_ARAB_COLOURS[mod(k + 1, BURJ_AL_ARAB_COLOURS.length)] ?? '#ffffff', Math.max(0, Math.min(1, (turn - k - 0.6) / 0.4)))

  return [
    dot(at, 0, 20.3, 1.1, 1.1, '#ff4a3a', 0.18 * blink * on),
    ...reds,
    ...dubaiFountain(at, now, '#fff0cc', 0.9 * on),
    poly(placer(at)(BURJ_AL_ARAB), colour, 0.45 * on),
  ]
}

/** A point `t` of the way from `a` to `b`. */
const everestLerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/** A range of peaks along `points` (stop units), each top over `snowline` capped with snow some `depth` down its slopes. */
const everestRange = (at: At, points: readonly Point[], fill: string, snow: string, snowline: number, depth: number): Shape[] => {
  const p = placer(at)
  const caps: Shape[] = []
  points.forEach((apex, i) => {
    const left = points[i - 1]
    const right = points[i + 1]
    if (left === undefined || right === undefined || apex[1] < snowline || apex[1] < left[1] || apex[1] < right[1]) return
    const l = everestLerp(apex, left, Math.min(0.7, depth / (apex[1] - left[1] + 0.01)))
    const r = everestLerp(apex, right, Math.min(0.7, depth / (apex[1] - right[1] + 0.01)))
    const along = (t: number, lift: number): Point => {
      const [x, up] = everestLerp(r, l, t)

      return [x, up + lift]
    }
    caps.push(poly(p([l, apex, r, along(0.25, -0.45 * depth), along(0.5, 0.15 * depth), along(0.75, -0.35 * depth)]), snow, 0.92))
  })

  return [poly(p(points), fill), ...caps]
}

/** The far Himalaya, palest and bluest; Pumori's snowy pyramid and Ama Dablam's horn and shoulders nearer. */
const everestFar = (at: At): Shape[] => {
  const p = placer(at)

  return [
    ...everestRange(at, [[-55, 0], [-50, 2], [-46, 4.6], [-43, 3.8], [-39, 7.2], [-36, 6.2], [-31, 10.2], [-28, 8.6], [-24, 11.4], [-20, 9.8], [-12, 13], [12, 13], [17, 11.6], [21, 12.6], [25, 9.8], [28, 10.6], [31, 8.4], [40, 9], [43, 6.2], [47, 4], [51, 1.8], [55, 0]], '#b4c0dc', '#e6ecf8', 6, 1.6),
    // Pumori, all snow above its rock.
    poly(p([[-49, 0], [-45, 2.4], [-41, 5.6], [-37.6, 8.8], [-35.4, 11.2], [-34.2, 12.3], [-33, 11.2], [-30.8, 8.8], [-28, 6.8], [-25, 4.4], [-21, 1.4], [-19, 0]]), '#8a98ba'),
    poly(p([[-34.2, 12.3], [-33, 11.2], [-30.8, 8.8], [-28, 6.8], [-25, 4.4], [-21, 1.4], [-19, 0], [-31, 0]]), '#6c7aa0', 0.55),
    poly(p([[-39.4, 7.2], [-37.6, 8.8], [-35.4, 11.2], [-34.2, 12.3], [-33, 11.2], [-30.8, 8.8], [-29.4, 7.8], [-30.8, 7.4], [-32, 8.6], [-33.4, 6.8], [-34.6, 8.4], [-36.2, 6.6], [-37.6, 7.4]]), '#f0f4fb'),
    // Ama Dablam: the horn, its two arms, the ice hanging under its top.
    poly(p([[21, 0], [24.6, 2.8], [27.4, 5.2], [29.6, 6.9], [30.8, 7.2], [32, 9], [32.9, 11], [33.6, 12.5], [34.3, 11.6], [34.9, 10], [35.6, 9.2], [37.2, 7.9], [38.6, 7.6], [40.6, 5.8], [43.4, 3.6], [46.4, 1.6], [49, 0]]), '#8a98ba'),
    poly(p([[33.6, 12.5], [34.3, 11.6], [34.9, 10], [35.6, 9.2], [37.2, 7.9], [38.6, 7.6], [40.6, 5.8], [43.4, 3.6], [46.4, 1.6], [49, 0], [36, 0], [34.4, 6]]), '#6c7aa0', 0.55),
    poly(p([[32, 9], [32.9, 11], [33.6, 12.5], [34.3, 11.6], [34.9, 10], [34, 10.4], [33.2, 9.6], [32.6, 8.4]]), '#f0f4fb'),
    poly(p([[29.4, 6.6], [30.8, 7.2], [31.6, 8.2], [30.6, 6.6]]), '#f0f4fb'),
    poly(p([[35.6, 9.2], [37.2, 7.9], [38.6, 7.6], [37.8, 7.1], [36.4, 7.8]]), '#f0f4fb'),
    dot(at, 34.1, 9.5, 0.7, 0.5, '#f6f8fc'),
  ]
}

/** Everest's dark summit pyramid and its snowfields, the South Col and Lhotse beside it. */
const everestMassif = (at: At): Shape[] => {
  const p = placer(at)
  const snow = '#eef2f9'
  const shadeSnow = '#c8d2e6'

  return [
    poly(p([[-21, 0], [-19.6, 5.4], [-15.6, 8.6], [-11.6, 11], [-8.4, 13], [-5.2, 14.9], [-2.4, 16.6], [-0.7, 17.6], [0.2, 18], [1.2, 17.7], [2.4, 17], [3.2, 16.9], [4.4, 15.9], [6.2, 14.3], [7.8, 13.1], [8.9, 12.9], [10.1, 13.5], [11.4, 14.5], [12.6, 15.4], [13.3, 15.2], [14.3, 14.5], [15.9, 13.1], [17.7, 11.1], [19.7, 8.9], [22, 6.3], [24.6, 3.6], [27, 1.3], [28.4, 0]]), '#383d52'),
    // The sunlit west faces of Everest and of Lhotse.
    poly(p([[-19.6, 5.4], [-15.6, 8.6], [-11.6, 11], [-8.4, 13], [-5.2, 14.9], [-2.4, 16.6], [-0.7, 17.6], [0.2, 18], [0.8, 15.6], [1.8, 12.6], [2.2, 9], [1.4, 4], [-20, 0]]), '#555c76'),
    poly(p([[8.9, 12.9], [10.1, 13.5], [11.4, 14.5], [12.6, 15.4], [12.2, 13], [12.6, 10], [11.8, 6.4], [9.4, 4], [7.6, 9]]), '#5c6480'),
    // Its snowfields: along the west ridge, across the face, under the south summit; Lhotse's ice face.
    poly(p([[-12.6, 10.4], [-11.6, 11], [-8.4, 13], [-5.2, 14.9], [-4.2, 14.5], [-5.8, 13.2], [-7.6, 12.3], [-9.2, 11.1], [-10.8, 10.2]]), snow),
    poly(p([[-4.4, 12.1], [-2.6, 13.6], [-0.6, 14.6], [0.2, 14.1], [-0.9, 12.8], [-2.8, 11.7]]), snow),
    poly(p([[-8.6, 10], [-6, 11.2], [-4.8, 10.7], [-6.8, 9.4]]), snow),
    poly(p([[-0.7, 17.6], [0.2, 18], [1.2, 17.7], [0.6, 17.1], [-0.1, 17.1]]), snow),
    poly(p([[1.2, 17.7], [2.4, 17], [3.2, 16.9], [4.4, 15.9], [6.2, 14.3], [7.8, 13.1], [8.9, 12.9], [7.6, 12.7], [5.6, 13.8], [4.2, 15.1], [2.6, 16.2], [1.6, 16.6]]), shadeSnow),
    poly(p([[2.6, 14.2], [4.4, 13.6], [3.6, 12.2], [2.6, 12.6]]), shadeSnow),
    poly(p([[9.4, 13.1], [10.6, 13.8], [11.6, 13.4], [10.8, 11.6], [11.6, 9.6], [10.4, 8.4], [9.6, 10.6]]), snow),
    poly(p([[12.6, 15.4], [13.3, 15.2], [14.3, 14.5], [15.2, 13.7], [14.2, 13.6], [13.2, 14.4]]), shadeSnow),
    poly(p([[16.2, 12.8], [17.7, 11.1], [19.7, 8.9], [18.8, 8.8], [17.2, 10.6], [15.8, 11.8]]), shadeSnow),
  ]
}

/** Nuptse's long snow wall in front of Everest, its fluted faces in shadow between its ribs. */
const nuptse = (at: At): Shape[] => {
  const p = placer(at)
  const shade = '#b6c2da'
  const rib = '#6e7690'

  return [
    poly(p([[-33, 0], [-29, 2.8], [-25.4, 5.4], [-21.8, 7.8], [-18.2, 9.6], [-15.2, 11.2], [-14.2, 10.7], [-12.8, 11.1], [-11.2, 10.3], [-9.4, 10.7], [-7.4, 9.7], [-5, 9.3], [-2.6, 8.5], [0, 7.5], [2.6, 6.3], [5.4, 4.9], [8.4, 3.3], [11.6, 1.8], [15, 0.6], [17, 0]]), '#dfe6f2'),
    poly(p([[-15.2, 11.2], [-14.2, 10.7], [-12.8, 11.1], [-11.2, 10.3], [-10.6, 7.6], [-11.6, 4.4], [-12.6, 1.6], [-13.4, 6.4]]), shade),
    poly(p([[-9.4, 10.7], [-7.4, 9.7], [-5, 9.3], [-4.6, 6.6], [-5.6, 3.2], [-6.4, 0.6], [-7.6, 5.6]]), shade),
    poly(p([[-2.6, 8.5], [0, 7.5], [2.6, 6.3], [5.4, 4.9], [8.4, 3.3], [11.6, 1.8], [15, 0.6], [17, 0], [1, 0], [-1.4, 4.2]]), shade),
    poly(p([[-21.8, 7.8], [-18.2, 9.6], [-17.6, 7.2], [-18.4, 4], [-19.6, 1.4], [-20.4, 5]]), shade),
    line(p([[-15.2, 11.2], [-13.4, 6.4], [-12.6, 1.6]]), 0.32 * at.s, rib, 0.7),
    line(p([[-9.4, 10.7], [-7.6, 5.6], [-6.4, 0.6]]), 0.3 * at.s, rib, 0.7),
    line(p([[-2.6, 8.5], [-1.4, 4.2], [-0.4, 0.8]]), 0.3 * at.s, rib, 0.7),
    line(p([[-21.8, 7.8], [-20.4, 5], [-19.6, 1.4]]), 0.26 * at.s, rib, 0.6),
  ]
}

/** The moraine of the Khumbu glacier, grey rubble with snow lying on it, and its boulders. */
const khumbuMoraine = (at: At): Shape[] => {
  const p = placer(at)

  return [
    poly(p([[-55, -0.2], [-50, 0.5], [-44, 1.3], [-38, 1], [-32, 2], [-26, 1.4], [-19, 2.2], [-12, 1.5], [-5, 2.3], [2, 1.4], [9, 2.4], [16, 1.6], [23, 2.2], [30, 1.3], [37, 1.8], [44, 1.1], [50, 0.5], [55, -0.2]]), '#8a8680'),
    poly(p([[-44, 1.3], [-38, 1], [-35, 1.5], [-38, 0.6], [-42, 0.8]]), '#eef2f8', 0.9),
    poly(p([[-12, 1.5], [-5, 2.3], [-1, 1.8], [-4, 1.3], [-8, 1.2]]), '#eef2f8', 0.9),
    poly(p([[9, 2.4], [16, 1.6], [14, 1.1], [11, 1.5]]), '#eef2f8', 0.9),
    poly(p([[37, 1.8], [44, 1.1], [41, 0.7], [38.6, 1.2]]), '#eef2f8', 0.9),
    ...([[-47, 0.4, 1.3], [-17, 0.6, 1.1], [-2.4, 0.4, 1.4], [6.6, 0.5, 1], [43, 0.4, 1.2]] as const).map(([dx, up, r]) => dot(at, dx, up, r, r * 0.5, '#a29c94')),
  ]
}

/** The stupa at base camp: whitewashed steps and dome, the Buddha's eyes on its tower, its gilded spire. */
const everestStupa = (at: At): Shape[] => {
  const p = placer(at)

  return [
    dot(at, -27, 2, 2.3, 2.3, '#f4f1e8'),
    dot(at, -26.2, 2.2, 1.3, 1.8, '#d8d6d2', 0.5),
    box(at, -30.2, 0, -23.8, 1.2, '#e8e4da'),
    box(at, -29.2, 1.2, -24.8, 2.1, '#f4f1e8'),
    box(at, -27, 0, -23.8, 1.2, '#cfcac0', 0.6),
    box(at, -27.8, 4.1, -26.2, 5.3, '#e8c45a'),
    box(at, -27.5, 4.6, -27.15, 4.8, '#2a3a6a'),
    box(at, -26.85, 4.6, -26.5, 4.8, '#2a3a6a'),
    poly(p([[-27.7, 5.3], [-27, 8.3], [-26.3, 5.3]]), '#d6a032'),
    line(p([[-27.5, 6], [-26.5, 6]]), 0.14 * at.s, '#a87a24'),
    line(p([[-27.35, 6.8], [-26.65, 6.8]]), 0.14 * at.s, '#a87a24'),
    dot(at, -27, 8.4, 0.35, 0.3, '#e8b84a'),
  ]
}

/** The prayer flags' strings: from the stupa's spire down to the ground either side, how much they sag, how many flags. */
const EVEREST_FLAG_STRINGS = [[[-27, 8.4], [-43, 0.4], 0.9, 8], [[-27, 8.4], [-11, 0.8], 1.1, 9], [[-27, 8.4], [-35, 0.3], 0.5, 5]] as const

/** A point `t` along a string from `from` to `to`, sagging `sag` in its middle. */
const everestAlong = (from: Point, to: Point, sag: number, t: number): Point => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t - 4 * sag * t * (1 - t)]

/** The strings the flags hang from. */
const everestStrings = (at: At): Shape[] => EVEREST_FLAG_STRINGS.map(([from, to, sag]) => line(placer(at)(Array.from({ length: 5 }, (_, i) => everestAlong(from, to, sag, i / 4))), 0.1 * at.s, '#5a5048', 0.8))

/** Base camp's tents on the glacier, the farther up the moraine and smaller: where, how big, their colour, how far up. */
const EVEREST_TENTS = [[15.7, 0.65, '#f2c12e', 0.9], [21.6, 0.6, '#3a6ac4', 1], [27.3, 0.65, '#ee8a2a', 0.9], [33.3, 0.6, '#f2c12e', 0.8], [39.6, 0.6, '#d8452e', 0.6], [12.6, 1, '#ee8a2a', 0], [18.8, 1.05, '#f2c12e', 0], [24.4, 0.9, '#d8452e', 0], [30.2, 1, '#f2c12e', 0], [36.4, 0.9, '#ee8a2a', 0], [-17.2, 0.85, '#ee8a2a', 0]] as const

/** A dome tent's outline `dx` across and `up` from the horizon, `k` its size. */
const everestTent = (dx: number, k: number, up: number): Point[] => ([[-1.5, 0], [-1.38, 0.72], [-0.92, 1.28], [0, 1.52], [0.92, 1.28], [1.38, 0.72], [1.5, 0]] as const).map(([x, y]): Point => [dx + x * k, up + y * k])

/** A tent's door, at its front. */
const everestDoor = (dx: number, k: number, up: number): Point[] => [[dx - 0.75 * k, up], [dx - 0.3 * k, up + 0.95 * k], [dx + 0.15 * k, up]]

/** The tents: their domes colour by colour (none overlaps another), their shaded sides, their doors. */
const everestTents = (at: At): Shape[] => {
  const p = placer(at)

  return [
    ...[...EVEREST_TENTS].sort((a, b) => a[2].localeCompare(b[2])).map(([dx, k, colour, up]) => poly(p(everestTent(dx, k, up)), colour)),
    ...EVEREST_TENTS.map(([dx, k, , up]) => poly(p([[dx, up + 1.52 * k], [dx + 1.1 * k, up + 1.1 * k], [dx + 1.5 * k, up], [dx + 0.3 * k, up]]), '#000000', 0.16)),
    ...EVEREST_TENTS.map(([dx, k, , up]) => poly(p(everestDoor(dx, k, up)), '#4a3a30', 0.8)),
  ]
}

/** A yak of the trekkers' caravans, shaggy and dark, a red blanket and a load on its back. */
const everestYak = (at: At, dx: number): Shape[] => {
  const p = placer(at)
  const hide = '#3a2e28'

  return [
    ...[-1.1, -0.5, 0.6, 1.2].map(lx => line(p([[dx + lx, 1.2], [dx + lx, 0]]), 0.32 * at.s, hide)),
    line(p([[dx - 1.6, 1.9], [dx - 2, 0.9]]), 0.24 * at.s, hide),
    dot(at, dx, 1.7, 1.8, 0.95, hide),
    dot(at, dx + 0.5, 2.3, 0.9, 0.55, hide),
    poly(p([[dx - 1.7, 1.5], [dx - 1.4, 0.6], [dx + 1.5, 0.6], [dx + 1.8, 1.4]]), hide),
    dot(at, dx + 2, 1.35, 0.62, 0.52, hide),
    line(p([[dx + 1.8, 1.7], [dx + 2.1, 2.3], [dx + 2.5, 2.4]]), 0.14 * at.s, '#f0e8d8'),
    box(at, dx - 1, 2.2, dx + 0.7, 2.9, '#c8402e'),
    box(at, dx - 0.7, 2.9, dx + 0.4, 3.5, '#d8b070'),
  ]
}

/** Everest over Nuptse's wall, Lhotse beside it and the far Himalaya behind; base camp below: the stupa, its prayer flags, a yak, the tents. */
const everest = (at: At): Shape[] => [...everestFar(at), ...everestMassif(at), ...nuptse(at), ...khumbuMoraine(at), ...everestYak(at, 4.6), ...everestStrings(at), ...everestStupa(at), ...everestTents(at)]

/** The tents glowing warm from within (their glows ring by ring, so alike rings go together), butter lamps at the stupa, climbers' headlamps on the ridge to the summit. */
const everestLights = (at: At): Shape[] => {
  const p = placer(at)
  const rings = EVEREST_TENTS.filter(([, k]) => k > 0.7).map(([dx, k, , up]) => glow(at, dx, up + 0.8 * k, 3.4 * k, 2.3 * k, '#ffb850', 0.24))

  return [
    ...[0, 1, 2, 3].flatMap(i => rings.flatMap(ring => ring.slice(i, i + 1))),
    ...EVEREST_TENTS.map(([dx, k, , up]) => poly(p(everestTent(dx, k, up)), '#ffc66a', 0.8)),
    ...EVEREST_TENTS.map(([dx, k, , up]) => poly(p(everestDoor(dx, k, up)), '#fff0c8', 0.9)),
    ...glow(at, -27, 1.2, 4, 2.4, '#ffc870', 0.22),
    ...[-29.4, -27, -24.6].map(dx => dot(at, dx, 0.5, 0.22, 0.28, '#ffd27a', 0.95)),
    ...([[7.9, 13.3], [7.3, 13.75], [5.7, 15], [4.9, 15.65]] as const).map(([dx, up]) => dot(at, dx, up, 0.19, 0.19, '#ffe8b0', 0.85)),
  ]
}

/** The plume of snow streaming east off the summit in the jet stream, thinning as it goes, puffs of it blowing away. */
const everestPlume = (at: At, now: number): Shape[] => {
  const p = placer(at)
  const mid = (x: number): number => 17.7 - 0.05 * x + 0.25 * Math.sin(now / 1300 - x / 3)
  const streak = (reach: number, thick: number, alpha: number): Shape => {
    const top: Point[] = []
    const bottom: Point[] = []
    for (let i = 0; i <= 8; i += 1) {
      const x = 0.3 + (reach * i) / 8
      const half = thick * (0.25 + 0.75 * (i / 8) ** 0.6) * (1 + 0.15 * Math.sin(now / 700 + i))
      top.push([x, mid(x) + half * 0.7])
      bottom.unshift([x, mid(x) - half])
    }
    const [[x1, y1] = [0, 0], [x2, y2] = [0, 0]] = p([[0.3, mid(0.3)], [0.3 + reach, mid(0.3 + reach)]])

    return poly(p([...top, ...bottom]), '#f8faff', 1, { x1, y1, x2, y2, stops: [[0, '#f8faff', alpha], [0.45, '#f4f7fc', alpha * 0.55], [1, '#f4f7fc', 0]] })
  }

  return [
    streak(17, 1.5, 0.55),
    streak(10, 0.8, 0.85),
    ...[0, 1, 2].map(i => {
      // Each puff swells in off the summit and thins away down the wind.
      const u = mod(now / 2600 + i / 3, 1)
      const x = 2 + 16 * u

      return dot(at, x, mid(x) - 0.1, 1.1 + 0.08 * x, 0.4 + 0.03 * x, '#f4f7fc', 0.32 * Math.sin(Math.PI * u) * (1 - 0.5 * u))
    }),
  ]
}

/** The prayer flags fluttering in the wind on their strings: blue, white, red, green, yellow; drawn colour by colour, so alike flags go together: a string's flags never overlap each other; where strings meet, the colours' order says which is in front. */
const everestFlags = (at: At, now: number): Shape[] => {
  const p = placer(at)
  const colours = ['#2e64c8', '#f2f2ee', '#d8382e', '#2a9a4e', '#f2c420']

  return EVEREST_FLAG_STRINGS.flatMap(([from, to, sag, count], s) => {
    const half = 0.42 / Math.hypot(to[0] - from[0], to[1] - from[1])

    return Array.from({ length: count }, (_, i) => {
      const t = (i + 0.7) / (count + 0.4)
      const a = everestAlong(from, to, sag, t - half)
      const b = everestAlong(from, to, sag, t + half)
      const flap = 0.28 + 0.22 * Math.sin(now / 210 + i * 1.7 + s * 2.3)
      const drop = 0.95 + 0.1 * Math.sin(now / 330 + i)

      return poly(p([a, b, [b[0] + flap, b[1] - drop], [a[0] + flap, a[1] - drop]]), colours[(i + s * 2) % colours.length] ?? '#f2f2ee', 0.95)
    })
  }).sort((a, b) => a.fill.localeCompare(b.fill))
}

/** Alpenglow: the summits of Everest and Lhotse catching the low sun at dawn and dusk, rose-gold above the shadowed valley. */
const everestAlpenglow = (at: At, light: Light): Shape[] => {
  const glow = 0.42 * light.golden * (1 - light.dark)
  if (glow < 0.02) return []
  const p = placer(at)
  // Brightest at the summit, fading down the faces toward the shadow.
  const [[x1, y1] = [0, 0], [x2, y2] = [0, 0]] = p([[0, 18], [0, 12.4]])
  const fade = { x1, y1, x2, y2, stops: [[0, '#ff9a6a', glow], [0.55, '#ff9a6a', 0.75 * glow], [1, '#ff9a6a', 0.1 * glow]] } as const

  return [
    poly(p([[-8.4, 13], [-5.2, 14.9], [-2.4, 16.6], [-0.7, 17.6], [0.2, 18], [1.2, 17.7], [2.4, 17], [3.2, 16.9], [4.4, 15.9], [6.2, 14.3], [2.2, 13.4], [-2.6, 12.6]]), '#ff9a6a', 1, fade),
    poly(p([[9.6, 13.2], [10.1, 13.5], [11.4, 14.5], [12.6, 15.4], [13.3, 15.2], [14.3, 14.5], [15.4, 13.4], [12.4, 12.6]]), '#ff9a6a', 1, fade),
  ]
}

/** A lotus bud's half-width up a tower, `t` of the way from its shrine to its tip: swelling a little, then curving in to a point. */
const ANGKOR_BUD = [[0, 1], [0.24, 1.04], [0.48, 0.9], [0.68, 0.66], [0.85, 0.38], [1, 0]] as const

/** Where the bud's tiers of petals meet, up it. */
const ANGKOR_TIERS = [0.22, 0.45, 0.66] as const

/** The five towers on the top terrace, the corner pairs first: across, base, tip, half-width. */
const ANGKOR_TOWERS = [[-10.2, 9.2, 13.4, 1.3], [10.2, 9.2, 13.4, 1.3], [-5.8, 9.2, 15, 1.55], [5.8, 9.2, 15, 1.55], [0, 9.2, 18.4, 2]] as const

/** The terraces' tops, bottom to top: each `[half-width, up]`. */
const ANGKOR_TERRACES = [[24, 3.3], [15.5, 5.3], [11.6, 9.2]] as const

/** The galleries' rows of openings, bottom to top: each half-width, foot, head, and the step from one to the next. */
const ANGKOR_GALLERIES = [[23.4, 0.8, 2.3, 2], [15, 3.4, 4.6, 1.9], [11, 7.85, 8.6, 1.8]] as const

/** A tower's outline `dx` across, from `base` to `top`, `half` wide: its shrine, then its bud, up the left and down the right. */
const angkorTowerOutline = (dx: number, base: number, top: number, half: number): Point[] => {
  const neck = base + 0.2 * (top - base)
  const side = ANGKOR_BUD.map(([t, r]): Point => [dx - half * r, neck + (top - neck) * t])

  return [[dx - half * 1.1, base], [dx - half * 1.1, neck], ...side, ...side.slice(0, -1).reverse().map(([x, up]): Point => [2 * dx - x, up]), [dx + half * 1.1, neck], [dx + half * 1.1, base]]
}

/** The temple's whole outline, roughly (enough for its reflection): its terraces stepping up, its five towers pointed along the top. */
const angkorSilhouette = (): Point[] => {
  const towers = [...ANGKOR_TOWERS].sort((a, b) => a[0] - b[0]).flatMap(([dx, base, top, half]): Point[] => [[dx - half, base], [dx - 0.9 * half, base + 0.6 * (top - base)], [dx, top], [dx + 0.9 * half, base + 0.6 * (top - base)], [dx + half, base]])
  const left = ANGKOR_TERRACES.flatMap(([half, up], i): Point[] => [[-half, ANGKOR_TERRACES[i - 1]?.[1] ?? 0], [-half, up]])

  return [...left, ...towers, ...left.map(([x, up]): Point => [-x, up]).reverse()]
}

/** A gallery's row of openings between pillars (or of each `every`th), `half` either side of the middle, `low` to `high`, joined along their foot: one shape. */
const angkorColonnade = (at: At, [half, low, high, step]: readonly [number, number, number, number], fill: string, alpha: number, every = 1): Shape => {
  const points: Point[] = [[-half, low]]
  for (let dx = -half + step * 0.25, i = 0; dx + step * 0.5 < half; dx += step, i += 1) if (i % every === 0) points.push([dx, low + 0.12], [dx, high], [dx + step * 0.5, high], [dx + step * 0.5, low + 0.12])
  points.push([half, low + 0.12], [half, low])

  return poly(placer(at)(points), fill, alpha)
}

/** The five towers: their shrines and lotus buds, shaded on their right, their doors, their tiers of petals; with `lit` floodlit gold, their shading and lower tiers still showing; alike shapes together. */
const angkorTowers = (at: At, lit = false): Shape[] => {
  const p = placer(at)
  const towers = ANGKOR_TOWERS.map(([dx, base, top, half]) => ({ dx, base, top, half, neck: base + 0.2 * (top - base), outline: angkorTowerOutline(dx, base, top, half) }))
  const tiers = towers.flatMap(({ dx, top, half, neck }) =>
    ANGKOR_TIERS.slice(0, lit ? 2 : 3).map(t => {
      const r = half * (1.06 - 0.6 * t ** 1.6)

      return line(p([[dx - r, neck + (top - neck) * t], [dx + r, neck + (top - neck) * t]]), 0.2 * at.s, lit ? '#9a6a2e' : '#6a5e4a', lit ? 0.55 : 0.75)
    }),
  )

  return [
    ...towers.map(({ outline }) => poly(p(outline), lit ? '#f8c060' : '#ab9b7c', lit ? 0.7 : 1)),
    ...towers.map(({ dx, base, half, outline }) => poly(p([[dx + half * 0.15, base], ...outline.slice(Math.floor(outline.length / 2))]), lit ? '#c07a32' : '#8c7d62', lit ? 0.45 : 1)),
    ...(lit ? tiers : [...towers.map(({ dx, base, half, neck }) => box(at, dx - half * 0.32, base, dx + half * 0.32, neck - 0.2, '#4e4536')), ...tiers, ...towers.map(({ dx, top }) => line(p([[dx, top], [dx, top + 0.6]]), 0.14 * at.s, '#6a5e4a'))]),
  ]
}

/** Angkor Wat: its galleries on their three terraces, the entrance pavilion, the steep stairs, the five towers. */
const angkorTemple = (at: At): Shape[] => {
  const p = placer(at)
  const stone = '#b4a382'
  const shade = '#988766'
  const dark = '#544a3a'
  const roof = '#8a7e64'

  return [
    // The outer gallery, its corner pavilions, its roof.
    box(at, -24.6, 0, 24.6, 0.7, shade),
    box(at, -24, 0.7, 24, 2.7, stone),
    angkorColonnade(at, ANGKOR_GALLERIES[0], dark, 0.75),
    poly(p([[-24.6, 2.7], [-23.6, 3.3], [23.6, 3.3], [24.6, 2.7]]), roof),
    ...[-24, 24].flatMap(dx => [box(at, dx - 1.6, 0.7, dx + 1.6, 3.6, stone), poly(p([[dx - 1.4, 3.6], [dx - 0.9, 5], [dx - 0.4, 5.6], [dx + 0.4, 5.6], [dx + 0.9, 5], [dx + 1.4, 3.6]]), roof), box(at, dx - 0.5, 0.7, dx + 0.5, 2.4, dark, 0.8)]),
    // The second terrace.
    box(at, -15.5, 3.3, 15.5, 5, stone),
    angkorColonnade(at, ANGKOR_GALLERIES[1], dark, 0.75),
    poly(p([[-15.9, 5], [-15.2, 5.4], [15.2, 5.4], [15.9, 5]]), roof),
    // The top terrace's steep base, its mouldings, its stairs, its gallery.
    poly(p([[-12.4, 5.3], [-11.7, 7.8], [11.7, 7.8], [12.4, 5.3]]), stone),
    poly(p([[4, 5.3], [4, 7.8], [11.7, 7.8], [12.4, 5.3]]), shade, 0.7),
    line(p([[-12.1, 6.2], [12.1, 6.2]]), 0.2 * at.s, roof, 0.8),
    line(p([[-11.9, 7], [11.9, 7]]), 0.2 * at.s, roof, 0.8),
    poly(p([[-1.3, 5.3], [-0.9, 7.8], [0.9, 7.8], [1.3, 5.3]]), shade),
    box(at, -11.4, 7.8, 11.4, 8.8, stone),
    angkorColonnade(at, ANGKOR_GALLERIES[2], dark, 0.7),
    poly(p([[-11.7, 8.8], [-11.2, 9.2], [11.2, 9.2], [11.7, 8.8]]), roof),
    ...angkorTowers(at),
    // The entrance pavilion in front, its stepped roof, its door.
    box(at, -3, 0.7, 3, 3.3, stone),
    poly(p([[-3.4, 3.3], [-2.6, 4.3], [-1.4, 4.9], [0, 5.3], [1.4, 4.9], [2.6, 4.3], [3.4, 3.3]]), roof),
    box(at, -0.75, 0.7, 0.75, 2.6, dark),
    box(at, 1.2, 0.7, 3, 3.3, shade, 0.6),
  ]
}

/** A stretch of jungle from `from` to `to`: round crowns some `up` high (`arc` their outline's points), filled down to the horizon. */
const angkorCanopy = (at: At, from: number, to: number, up: number, vary: number, r: number, fill: string, seed: string, arc: readonly number[] = [1, 0.75, 0.5, 0.25, 0]): Shape => {
  const points: Point[] = [[from, -0.2]]
  const count = Math.max(1, Math.round((to - from) / (1.5 * r)))
  for (let i = 0; i < count; i += 1) {
    const cx = from + ((i + 0.5) * (to - from)) / count
    const h = (up + vary * rnd(seed, i)) * Math.sin(Math.PI * ((i + 0.5) / count)) ** 0.4
    for (const a of arc) points.push([cx + r * Math.cos(a * Math.PI), h - 0.3 * r + 0.6 * r * Math.sin(a * Math.PI)])
  }
  points.push([to, -0.2])

  return poly(placer(at)(points), fill)
}

/** Sugar palms, each `[dx, h]`: their tall bare trunks, their round heads of fan leaves. */
const angkorSugarPalms = (at: At, palms: readonly (readonly [number, number])[]): Shape[] => {
  const p = placer(at)
  const head = (dx: number, up: number): Point[] => Array.from({ length: 14 }, (_, i): Point => [dx + Math.cos((i / 14) * 2 * Math.PI) * (i % 2 === 0 ? 2.4 : 1.3), up + Math.sin((i / 14) * 2 * Math.PI) * (i % 2 === 0 ? 2.1 : 1.15)])

  return [
    ...palms.map(([dx, h]) => line(p([[dx, 0], [dx + 0.15, h * 0.5], [dx + 0.1, h]]), 0.42 * at.s, '#4e4234')),
    ...palms.map(([dx, h]) => poly(p(head(dx + 0.1, h + 0.3)), '#2f5a32')),
    ...palms.map(([dx, h]) => dot(at, dx - 0.2, h + 0.8, 1.1, 0.75, '#4c7c42', 0.85)),
  ]
}

/** How deep the ground is below the horizon, in a stop's units. */
const angkorDeep = (at: At): number => (at.bottom - at.y) / at.s

/** How far across the causeway's edge is `down` below the horizon: it widens toward the viewer. */
const angkorCauseway = (down: number): number => 1.5 + 0.2 * down

/** How much the pools squash the temple's reflection, to fit it in them. */
const angkorSquash = (at: At): number => Math.min(1, (angkorDeep(at) - 0.6) / 18.6)

/** The temple mirrored upside down in the pools, squashed to fit. */
const angkorMirror = (at: At, points: readonly Point[]): Point[] => placer(at)(points.map(([dx, up]): Point => [dx, -0.3 - up * angkorSquash(at)]))

/** The two reflecting pools before it, the temple mirrored in them, lilies on them, and the causeway running between them to its door. */
const angkorPools = (at: At): Shape[] => {
  const p = placer(at)
  const deep = angkorDeep(at)
  const near = Math.min(deep, 19.5)
  const pool = (side: number): Shape => poly(p([[side * angkorCauseway(0.2), -0.2], [side * 25, -0.2], [side * (25 + 0.25 * near), -near], [side * angkorCauseway(near), -near]]), '#82a6c8')

  return [
    pool(-1),
    pool(1),
    poly(angkorMirror(at, angkorSilhouette()), '#9c8e70', 0.55),
    ...([[-20, 0.25], [-13, 0.55], [-23, 0.7], [14, 0.3], [21, 0.6], [11, 0.75]] as const).map(([dx, k]) => dot(at, dx * (1 + 0.012 * near * k), -near * k, 0.9 + 0.05 * near * k, 0.25 + 0.03 * near * k, '#4e7a3e')),
    ...([[-20.4, 0.25], [14.4, 0.3], [-22.6, 0.7]] as const).map(([dx, k]) => dot(at, dx * (1 + 0.012 * near * k), -near * k + 0.15, 0.3, 0.22, '#f29ab8')),
    poly(p([[-angkorCauseway(0), 0], [angkorCauseway(0), 0], [angkorCauseway(deep), -deep], [-angkorCauseway(deep), -deep]]), '#c8b896'),
    line(p([[-angkorCauseway(0), 0.15], [-angkorCauseway(deep), -deep]]), 0.35 * at.s, '#8a7a5c'),
    line(p([[angkorCauseway(0), 0.15], [angkorCauseway(deep), -deep]]), 0.35 * at.s, '#8a7a5c'),
  ]
}

/** Angkor Wat over its reflecting pools, the jungle and its sugar palms either side. */
const angkor = (at: At): Shape[] => [
  // The far jungle, seen only either side of the second terrace.
  angkorCanopy(at, -30, -14, 3.6, 1.2, 3, '#86a07e', 'angkor-far-left', [1, 0.66, 0.33, 0]),
  angkorCanopy(at, 14, 30, 3.6, 1.2, 3, '#86a07e', 'angkor-far-right', [1, 0.66, 0.33, 0]),
  ...angkorTemple(at),
  angkorCanopy(at, -50, -22, 4.6, 2.2, 2.2, '#46704a', 'angkor-left', [1, 0.7, 0.4, 0.15]),
  angkorCanopy(at, 22, 50, 4.6, 2.2, 2.2, '#46704a', 'angkor-right', [0.85, 0.6, 0.3, 0]),
  ...angkorSugarPalms(at, [[-41, 9.4], [-34.6, 11.6], [-29.4, 8.4], [29.4, 9], [35, 12], [41.2, 8.6]]),
  ...angkorPools(at),
]

/** Where the causeway's lanterns stand, each a share of the way down the ground toward the viewer. */
const ANGKOR_LANTERNS = [0.12, 0.45, 0.82] as const

/** The towers softly floodlit and mirrored in the pools, lamps in the lower galleries, lanterns along the causeway: their glows ring by ring, so alike rings go together. */
const angkorLights = (at: At): Shape[] => {
  const p = placer(at)
  const deep = angkorDeep(at)
  const lanterns = ANGKOR_LANTERNS.flatMap(k => [-1, 1].map((side): Point => [side * (angkorCauseway(deep * k) + 0.2), -deep * k + 0.6]))
  const rings = lanterns.map(([dx, up]) => glow(at, dx, up, 1.3 - 0.05 * up, 1 - 0.04 * up, '#ffb04a', 0.24))

  return [
    ...glow(at, 0, 10, 18, 8.4, '#ffcf8a', 0.14),
    // The floodlights' spill on the top terrace under the towers.
    poly(p([[-12.4, 5.3], [-11.7, 9.2], [11.7, 9.2], [12.4, 5.3]]), '#f0b060', 0.2),
    angkorColonnade(at, ANGKOR_GALLERIES[0], '#ffcf7a', 0.65, 2),
    angkorColonnade(at, ANGKOR_GALLERIES[1], '#ffcf7a', 0.65, 2),
    ...angkorTowers(at, true),
    // Mirrored where the pools are deep enough to show it (in a pane, not the band).
    ...ANGKOR_TOWERS.filter(([dx]) => dx !== 0 && angkorSquash(at) > 0.5).map(([dx, base, top, half]) => poly(angkorMirror(at, angkorTowerOutline(dx, base, top, half)), '#ffd690', 0.2)),
    ...[0, 1, 2, 3].flatMap(i => rings.flatMap(ring => ring.slice(i, i + 1))),
    ...lanterns.map(([dx, up]) => dot(at, dx, up, 0.22 - 0.014 * up, 0.28 - 0.018 * up, '#ffe2a0', 0.95)),
  ]
}

/** Ripples glinting on the pools, and monks in saffron under their parasols walking by, fading in and out at the stretch's ends. */
const angkorMoving = (at: At, now: number): Shape[] => {
  const p = placer(at)
  const near = Math.min(angkorDeep(at), 19.5)
  const ripples = Array.from({ length: 6 }, (_, i) => {
    const side = i % 2 === 0 ? -1 : 1
    const k = 0.15 + 0.7 * rnd('angkor-ripple', i)
    const dx = side * (7.5 + 15 * rnd('angkor-ripple-x', i) + 1.2 * Math.sin(now / 1700 + i * 2.1))

    return line(p([[dx - 1.4, -near * k], [dx + 1.4, -near * k]]), 0.16 * at.s, '#ffffff', 0.25 + 0.25 * Math.sin(now / 650 + i * 1.9))
  })
  const monks = [0, 1].flatMap(i => {
    const dx = 55 - mod(now / 380 + i * 3.4, 110)
    const step = 0.18 * Math.sin(now / 160 + i * 2)
    const seen = Math.max(0, Math.min(1, (53 - Math.abs(dx)) / 8))

    return [
      poly(p([[dx - 0.55, 0], [dx - 0.62, 1.3], [dx - 0.36, 1.75], [dx + 0.36, 1.75], [dx + 0.62, 1.3], [dx + 0.55 + step, 0]]), '#e8862a', seen),
      line(p([[dx - 0.4, 1.7], [dx + 0.5, 0.5]]), 0.22 * at.s, '#b85a1a', seen),
      dot(at, dx, 2.15, 0.36, 0.4, '#8a5a3a', seen),
      line(p([[dx + 0.5, 1.2], [dx + 0.35, 3]]), 0.1 * at.s, '#3a2a20', seen),
      poly(p([[dx - 1.1, 2.75], [dx - 0.5, 3.3], [dx + 0.35, 3.45], [dx + 1.2, 3.2], [dx + 1.75, 2.6]]), '#f2b432', seen),
    ]
  })

  return [...ripples, ...monks]
}

/** A karst island's outline standing on the water `base` up: undercut at the waterline, sheer sides rounding over into a lumpy crown `high` up, leaning `lean` across; in `steps` over its top (fewer far off). */
const halongKarst = (dx: number, wide: number, base: number, high: number, lean = 0, steps = 14): Point[] => {
  const points: Point[] = [[dx - wide * 0.84, base - 0.1], [dx - wide, base + 0.12 * (high - base)]]
  for (let i = 1; i < steps; i += 1) {
    const a = (Math.PI * i) / steps
    const rise = Math.sin(a) ** 0.5 * (1 + 0.07 * Math.sin(a * 2 + dx) * Math.sin(a) + 0.035 * Math.sin(a * 7 + dx * 3))
    points.push([dx - Math.cos(a) * wide * (1 - 0.12 * Math.sin(a) ** 6) + lean * rise ** 2, base + (high - base) * rise])
  }
  points.push([dx + wide, base + 0.12 * (high - base)], [dx + wide * 0.84, base - 0.1])

  return points
}

/** The jungle over a karst's crown (its outline's), hanging `deep` down its cliffs, its lower edge ragged, in tongues. */
const halongCap = (outline: readonly Point[], dx: number, base: number, high: number, deep: number): Point[] => {
  const crown = outline.filter(([, up]) => up > base + (high - base) * 0.66)

  return [...crown, ...[...crown].reverse().map(([x, up], i): Point => [dx + (x - dx) * 0.92, up - deep * (0.5 + 0.4 * (1 + Math.sin(i * 1.2 + dx * 1.3)))])]
}

/** The bay's islands, far to near: each row `[dx, wide, high, lean]`, on the water at its base. */
const HALONG_FAR = [[-47, 3, 6.4, 0], [-40, 2.4, 7.6, 0.4], [-33, 3.4, 6.8, 0], [-26, 2.6, 8.6, -0.3], [-18, 3.2, 7.4, 0], [-10, 2.2, 9, 0.3], [-3, 3, 7.6, 0], [5, 2.6, 9.4, -0.3], [12, 3.4, 7.8, 0], [20, 2.4, 8.8, 0.4], [27, 3.2, 7.4, 0], [34, 2.8, 8.2, -0.2], [42, 3, 6.6, 0], [49, 2.4, 5.2, 0]] as const
const HALONG_BACK = [[-44, 2.8, 6.8, 0.3], [-30, 3.6, 9.6, 0], [-15, 2.8, 10.6, -0.4], [-1, 3.2, 8.6, 0], [14, 2.6, 11.2, 0.3], [26, 3.6, 9.2, 0], [40, 3, 7.6, -0.3]] as const
const HALONG_MID = [[-39, 3.6, 9.4, 0.3], [-17, 3, 12, -0.3], [17, 3.2, 10.8, 0.4], [37, 3.8, 10.2, 0]] as const
const HALONG_NEAR = [[-27, 5.2, 14.4, 0.6], [3, 4.4, 16.8, -0.5], [28, 5, 12.6, 0.3]] as const

/** A bank of mist lying on the water from `from` up, thinning away by `to`. */
const halongMistBank = (at: At, from: number, to: number, alpha: number): Shape => ({
  ...poly(placer(at)([[-52, from], [-46, to], [46, to], [52, from]]), '#e8f0f0'),
  grad: { x1: 0, y1: at.y - from * at.s, x2: 0, y2: at.y - to * at.s, stops: [[0, '#e8f0f0', alpha], [1, '#e8f0f0', 0]] },
})

/** A near island: limestone, its far side in shade, its notch dark at the waterline, streaks down its cliffs, jungle over its crown and trailing down its gullies, tufts lit on top. */
const halongCrag = (at: At, [dx, wide, high, lean]: readonly [number, number, number, number], base: number): Shape[] => {
  const p = placer(at)
  const outline = halongKarst(dx, wide, base, high, lean)
  const tall = high - base

  return [
    poly(p(outline), '#8a9c90'),
    poly(p([...outline.slice(9), [dx + 0.25 * wide, base - 0.1]]), '#46585a', 0.35),
    line(p([[dx - wide * 0.86, base + 0.3], [dx + wide * 0.86, base + 0.3]]), 0.5 * at.s, '#45534f', 0.6),
    ...[-0.55, 0.1, 0.5].map(k => line(p([[dx + k * wide, base + tall * 0.68], [dx + k * wide * 1.06, base + tall * 0.22]]), 0.22 * at.s, '#64746c', 0.55)),
    ...([[-0.5, 0.3, 0.2], [0.42, 0.44, 0.16]] as const).map(([k, foot, w]) => {
      const x = dx + k * wide + lean * 0.4
      const top = base + tall * 0.72
      const low = base + tall * foot
      const half = w * wide

      return poly(p([[x - half, top], [x + half, top], [x + half * 0.75, (top + low) / 2], [x + half * 0.45, low + half * 0.5], [x, low], [x - half * 0.45, low + half * 0.5], [x - half * 0.75, (top + low) / 2]]), '#3e6e44')
    }),
    poly(p(halongCap(outline, dx, base, high, tall * 0.3)), '#3e6e44'),
    ...[5, 8, 11].map(i => outline[i] ?? [dx, high]).map(([x, up]) => dot(at, dx + (x - dx) * 0.75, up - 0.75, 0.85, 0.42, '#6a9a54', 0.85)),
  ]
}

/** The Fighting Cocks: two rocks rising from the water, swelling up from narrow feet to lean their heads together. */
const halongCocks = (at: At): Shape[] => {
  const p = placer(at)

  return [
    poly(p([[12.4, 0.5], [11.7, 2.2], [11.8, 4.4], [12.6, 6], [13.6, 6.7], [14.4, 6.3], [14.7, 5.1], [14.1, 3.4], [13.7, 1.8], [13.6, 0.5]]), '#7e8e86'),
    poly(p([[15.7, 0.5], [15.6, 1.8], [15.1, 3.2], [14.95, 4.6], [15.3, 5.6], [16.2, 6], [17, 5.3], [17.3, 3.6], [16.9, 1.8], [16.8, 0.5]]), '#74847c'),
    poly(p([[11.9, 4.9], [12.6, 6], [13.6, 6.7], [14.4, 6.3], [14.6, 5.4], [13.6, 5.6], [12.6, 5.2]]), '#3e6e44'),
    poly(p([[15.1, 5.1], [15.3, 5.6], [16.2, 6], [17, 5.3], [17.2, 4.6], [16.2, 5.1]]), '#3e6e44'),
  ]
}

/** The floating village's houses on their raft, `[dx, wall, roof]`. */
const HALONG_HOUSES = [[-37.4, '#7ab0cc', '#3a6a8a'], [-35.4, '#eac65c', '#c04a32'], [-33.4, '#9acca8', '#3a6a8a'], [-31.4, '#ee9e8c', '#c04a32']] as const

/** The floating fishing village at the foot of the left island: little painted houses on a raft, their windows dark glass, or with `lit` alone, lit. */
const halongVillage = (at: At, lit = false): Shape[] => {
  const windows = HALONG_HOUSES.map(([dx]) => box(at, dx + 0.45, 1.25, dx + 1.15, 1.75, lit ? '#ffd27a' : '#4a5a64', lit ? 0.9 : 0.75))
  if (lit) return windows

  return [
    box(at, -38, 0.6, -29.4, 1, '#6a4a34'),
    ...HALONG_HOUSES.map(([dx, wall]) => box(at, dx, 1, dx + 1.6, 2.2, wall)),
    ...HALONG_HOUSES.map(([dx, , roof]) => poly(placer(at)([[dx - 0.25, 2.1], [dx + 0.8, 2.8], [dx + 1.85, 2.1]]), roof)),
    ...windows,
  ]
}

/** Cruise junks moored out in the bay, `[dx, up]`: dark hulls, white decks, their sails furled. */
const HALONG_MOORED = [[-11, 2.2], [9.4, 2.5], [43, 2.5]] as const

/** The moored junks: their masts, hulls, decks and upper decks, each kind together. */
const halongMoored = (at: At): Shape[] => [
  ...HALONG_MOORED.map(([dx, up]) => line(placer(at)([[dx + 0.4, up + 1.2], [dx + 0.4, up + 3.4]]), 0.14 * at.s, '#4a3a30')),
  ...HALONG_MOORED.map(([dx, up]) => poly(placer(at)([[dx - 2.2, up + 0.8], [dx - 1.6, up], [dx + 1.8, up], [dx + 2.4, up + 0.8]]), '#5a3a2a')),
  ...HALONG_MOORED.map(([dx, up]) => box(at, dx - 1.5, up + 0.8, dx + 1.6, up + 1.6, '#eeeae0')),
  ...HALONG_MOORED.map(([dx, up]) => box(at, dx - 0.9, up + 1.6, dx + 1, up + 2.2, '#dcd6c8')),
]

/** Ha Long Bay: emerald water, its karst islands layered back into the mist, palest farthest, the near ones grey and green; a floating village and moored junks; the islands' shadows in the water. */
const halongBay = (at: At): Shape[] => {
  const p = placer(at)

  return [
    ...water(at, -55, 55, 3.4, '#3e8e7e'),
    { ...box(at, -55, 0.8, 55, 3.4, '#d6e6e2'), grad: { x1: 0, y1: at.y - 3.4 * at.s, x2: 0, y2: at.y - 0.8 * at.s, stops: [[0, '#d6e6e2', 0.7], [1, '#d6e6e2', 0]] } },
    ...HALONG_FAR.map(([dx, wide, high, lean]) => poly(p(halongKarst(dx, wide, 3.3, high, lean, 8)), '#c0d2d8')),
    halongMistBank(at, 3.3, 6, 0.6),
    ...HALONG_BACK.map(([dx, wide, high, lean]) => poly(p(halongKarst(dx, wide, 2.6, high, lean, 9)), '#9fb8be')),
    halongMistBank(at, 2.6, 5, 0.5),
    ...halongMoored(at),
    ...HALONG_MID.map(([dx, wide, high, lean]) => poly(p(halongKarst(dx, wide, 1.6, high, lean)), '#88a6a2')),
    ...HALONG_MID.map(([dx, wide, high, lean]) => poly(p(halongCap(halongKarst(dx, wide, 1.6, high, lean), dx, 1.6, high, (high - 1.6) * 0.26)), '#6a9478')),
    halongMistBank(at, 1.6, 3.6, 0.45),
    ...HALONG_NEAR.map(([dx, wide, high, lean]) => poly(p(halongKarst(dx, wide * 0.9, 0.2, high, lean).map(([x, up]): Point => [x, 0.2 - (up - 0.2) * 0.28])), '#1e4a40', 0.28)),
    ...HALONG_NEAR.flatMap(crag => halongCrag(at, crag, 0.2)),
    ...halongCocks(at),
    ...halongVillage(at),
  ]
}

/** A light's gleam on the water under it: dashes, each `[down, wide, bright]`, narrower and fainter going down. */
const HALONG_GLEAM = [[0, 1, 1], [0.55, 0.62, 0.6], [1.1, 0.32, 0.32]] as const

/** The gleams of lights on the water under them, each from `[dx, up]`, `wide` across at the top, `dashes` deep: the dashes at each depth together. */
const halongGleams = (at: At, lights: readonly Point[], wide: number, colour: string, alpha: number, dashes = 3): Shape[] =>
  HALONG_GLEAM.slice(0, dashes).flatMap(([down, w, k]) => lights.map(([dx, up]) => line(placer(at)([[dx - wide * w, up - down], [dx + wide * w, up - down]]), 0.3 * at.s, colour, alpha * k)))

/** The bay by night: the village's windows and its string of lanterns, the moored junks' portholes and mast lights, their light on the water. */
const halongLights = (at: At): Shape[] => [
  ...glow(at, -33.6, 1.8, 6.4, 2.6, '#ffc070', 0.24),
  ...HALONG_MOORED.flatMap(([dx, up]) => glow(at, dx, up + 1.4, 4.2, 1.9, '#ffd08a', 0.2)),
  ...halongVillage(at, true),
  ...HALONG_MOORED.flatMap(([dx, up]) => [...[-1.1, -0.2, 0.7].map(wx => box(at, dx + wx, up + 1, dx + wx + 0.5, up + 1.35, '#ffd27a', 0.9)), ...[-0.6, 0.4].map(wx => box(at, dx + wx, up + 1.75, dx + wx + 0.4, up + 2.05, '#ffd27a', 0.9))]),
  ...HALONG_MOORED.map(([dx, up]) => dot(at, dx + 0.4, up + 3.45, 0.22, 0.22, '#fff4d8', 0.95)),
  ...[-37.6, -35.6, -33.6, -31.6, -29.8].map((dx, i) => dot(at, dx, 2.55 - 0.15 * (i % 2), 0.22, 0.26, '#ff8a48', 0.95)),
  ...halongGleams(at, [[-36.6, 0.45], [-31.6, 0.45]], 0.7, '#ffc070', 0.6),
  ...halongGleams(at, HALONG_MOORED.map(([dx, up]): Point => [dx, up - 0.15]), 0.8, '#ffd08a', 0.55),
]

/** The junk's run across the bay: where it is at `now`, bobbing on the water, and how much it shows, fading in and out at its ends. */
const halongJunkAt = (now: number): { dx: number; up: number; fade: number } => {
  const dx = mod(now / 650, 112) - 56

  return { dx, up: 0.5 + 0.06 * Math.sin(now / 900), fade: Math.max(0, Math.min(1, (dx + 50) / 5, (48 - dx) / 5)) }
}

/** A junk under sail, `k` its size, its bow to `facing`: its dark hull high at the stern, its deckhouse, three fanned and ribbed orange sails, a pennant at the masthead; far off, its hull and two sails alone, paler in the mist. */
const halongJunk = (at: At, dx: number, up: number, now: number, alpha: number, k = 1, facing = 1, far = false): Shape[] => {
  const q = (points: readonly Point[]): Point[] => placer(at)(points.map(([x, y]): Point => [dx + x * k * facing, up + y * k]))
  const hue = (colour: string): string => (far ? mix(colour, '#c8d8da', 0.45) : colour)
  const shapes: Shape[] = far
    ? []
    : [
        line(q([[0.6, 1.3], [0.6, 8.2]]), 0.18 * at.s, '#3a2a20', alpha),
        poly(q([[0.6, 8.2], [-1 + 0.2 * Math.sin(now / 160), 7.95 + 0.15 * Math.sin(now / 210)], [0.6, 7.7]]), '#d8302a', alpha),
      ]
  shapes.push(poly(q([[-5.2, 2.1], [-4.4, 1.3], [3.2, 1.1], [5.4, 1.8], [4.7, 0.6], [3.6, 0], [-3.7, 0], [-4.7, 0.7]]), hue('#5a3424'), alpha))
  if (!far) shapes.push(poly(q([[-3.3, 1.15], [1.7, 1.15], [1.7, 1.95], [-3.3, 1.95]]), '#a8784a', alpha))
  for (const [mast, high, wide, fill] of ([[-3.2, 3.6, 1.9, '#d0522c'], [-0.1, 6, 3.2, '#e2602e'], [3, 4.4, 2.3, '#d0522c']] as const).filter(([, high]) => !far || high > 4)) {
    const foot = 2.2
    const leech = (f: number): Point => [mast - wide * (0.84 + 0.24 * Math.sin(Math.PI * f)), foot + high * f]
    const luff = (f: number): Point => [mast + 0.5 + 0.2 * f, foot + high * 0.84 * f]
    shapes.push(poly(q([luff(0), luff(1), leech(1), leech(0.75), leech(0.5), leech(0.25), leech(0)]), hue(fill), alpha))
    if (!far) shapes.push(line(q([luff(0.2), leech(0.2), leech(0.4), luff(0.4), luff(0.6), leech(0.6), leech(0.8), luff(0.8)]), 0.13 * at.s, '#7a2a18', 0.65 * alpha))
  }

  return shapes
}

/** The junk's shadow in the water under it and its wake behind, `alpha` showing. */
const halongWake = (at: At, dx: number, up: number, alpha: number): Shape[] => [
  poly(placer(at)([[dx - 4.4, up], [dx + 4.4, up], [dx + 3.4, up - 1.4], [dx - 3.6, up - 1.4]]), '#1e3a34', 0.3 * alpha),
  line(placer(at)([[dx - 5, up + 0.15], [dx - 7, up + 0.05], [dx - 9.5, up + 0.1]]), 0.22 * at.s, '#ffffff', 0.45 * alpha),
]

/** The other junk, small and far, sailing the other way, slower. */
const halongFarJunkAt = (now: number): { dx: number; fade: number } => {
  const dx = 50 - mod(now / 1100 + 40, 100)

  return { dx, fade: Math.max(0, Math.min(1, (dx + 50) / 5, (50 - dx) / 5)) }
}

/** A sampan rowed slowly across the near water, home by nightfall: its hull, its bamboo hood, the rower standing at the stern in a conical hat, the oar. */
const halongSampan = (at: At, now: number, light: Light): Shape[] => {
  const dx = 46 - mod(now / 900 + 20, 96)
  const fade = Math.max(0, Math.min(1, (dx + 46) / 4, (44 - dx) / 4, 1 - light.dark / 0.5))
  if (fade < 0.02) return []
  const q = (points: readonly Point[]): Point[] => placer(at)(points.map(([x, y]): Point => [dx + x, 0.15 + y + 0.04 * Math.sin(now / 500)]))
  const pull = 0.4 * Math.sin(now / 700)

  return [
    line(q([[1.5, 1.6], [2.8 + pull, -0.1]]), 0.12 * at.s, '#5a4030', fade),
    poly(q([[-2.4, 0.75], [-1.8, 0.1], [1.6, 0.1], [2.3, 0.8], [1.6, 0.45], [-1.7, 0.45]]), '#4a3426', fade),
    poly(q([[-1, 0.45], [-0.9, 1.1], [-0.4, 1.35], [0.4, 1.35], [0.9, 1.1], [1, 0.45]]), '#9a7a4a', fade),
    line(q([[1.6, 0.5], [1.7 + 0.1 * pull, 1.3], [1.65 + 0.15 * pull, 1.9]]), 0.32 * at.s, '#3a5a7a', fade),
    poly(q([[1.1 + 0.15 * pull, 1.95], [1.65 + 0.15 * pull, 2.4], [2.2 + 0.15 * pull, 1.95]]), '#e8d8a8', fade),
  ]
}

/** Mist drifting along the water between the islands, soft above and below, thinning out toward the bay's ends. */
const halongDrift = (at: At, now: number): Shape[] =>
  [0, 1, 2].map(i => {
    const dx = mod(now / 420 + i * 31, 90) - 45
    const up = 3.4 + i * 2
    const alpha = 0.3 * Math.min(1, (45 - Math.abs(dx)) / 12)

    return { ...dot(at, dx, up, 11, 1.3, '#f2f6f6'), grad: { x1: 0, y1: at.y - (up + 1.3) * at.s, x2: 0, y2: at.y - (up - 1.3) * at.s, stops: [[0, '#f2f6f6', 0], [0.5, '#f2f6f6', alpha], [1, '#f2f6f6', 0]] } }
  })

/** What moves on the bay: the junks gliding by (the far one lost in the dark by night, but for its lantern), a sampan, glints and the junk's wake by day, mist drifting between the islands. */
const halongMoving = (at: At, now: number, light: Light): Shape[] => {
  const near = halongJunkAt(now)
  const far = halongFarJunkAt(now)
  const day = Math.max(0, 1 - light.dark / 0.4)
  // The glints fading out as it darkens.
  const shine = Math.max(0, 1 - light.dark / 0.3)

  return [
    ...(shine > 0 ? glints(at, -31, 31, 3, now).map(glint => ({ ...glint, alpha: (glint.alpha ?? 1) * shine })) : []),
    ...(far.fade * (1 - light.dark) > 0.02 ? halongJunk(at, far.dx, 2.3, now, far.fade * (1 - light.dark), 0.36, -1, true) : []),
    ...halongDrift(at, now),
    ...(near.fade * day > 0.02 ? halongWake(at, near.dx, near.up, near.fade * day) : []),
    ...(near.fade > 0 ? halongJunk(at, near.dx, near.up, now, near.fade) : []),
    ...halongSampan(at, now, light),
  ]
}

/** The junks' lanterns lit at dusk, swaying a little, and their light rippling on the water. */
const halongLanterns = (at: At, now: number, light: Light): Shape[] => {
  if (light.dark < 0.05) return []
  const { dx, up, fade } = halongJunkAt(now)
  const far = halongFarJunkAt(now)
  const lit = light.dark * fade
  const lanterns = [[-4.6, 2.3], [-1.4, 2.05], [4.7, 2.1]] as const
  const sway = 0.06 * Math.sin(now / 700)

  return [
    ...(lit > 0.01
      ? [
          ...glow(at, dx - 0.6, up + 1.8, 6, 2.6, '#ffb060', 0.3 * lit),
          ...[-2.8, -1.3, 0.2].map(wx => box(at, dx + wx, up + 1.38, dx + wx + 0.8, up + 1.75, '#ffd27a', 0.85 * lit)),
          ...lanterns.map(([lx, ly]) => dot(at, dx + lx + sway, up + ly, 0.3, 0.38, '#ff8a40', lit)),
          ...halongGleams(at, lanterns.map(([lx], i): Point => [dx + lx + 0.12 * Math.sin(now / 400 + i), up - 0.2]), 0.5 + 0.08 * Math.sin(now / 300), '#ffa050', 0.75 * lit, 2),
        ]
      : []),
    ...(far.fade > 0 ? [dot(at, far.dx, 2.3 + 0.8, 0.16, 0.16, '#ffc070', light.dark * far.fade)] : []),
  ]
}

/** Uluru's skyline, east to west: its steep rounded east end, the long gently domed top, the west end stepping down by a shoulder. */
const ULURU: readonly Point[] = [[-27.4, 0], [-27.2, 1.4], [-26.8, 3], [-26, 4.8], [-24.8, 6.4], [-23.2, 7.6], [-21.2, 8.4], [-18.6, 8.9], [-15.6, 9.1], [-13, 9.5], [-10, 9.6], [-7, 10], [-3.6, 10.3], [-0.6, 10.2], [2.6, 10.4], [6, 10.1], [9.4, 9.9], [12.6, 9.4], [15.6, 8.8], [18, 8.1], [19.8, 7.3], [21, 6.7], [22.4, 6.4], [23.8, 5.7], [25, 4.5], [26, 2.9], [26.7, 1.3], [27, 0]]

/** Its gullies down its flanks, `[dx, how far down]`: long and splayed on its steep ends, long and short by turns along its sides. */
const ULURU_GULLIES = [[-23.8, 0.7], [-21.2, 0.55], [-17.8, 0.3], [-15, 0.62], [-11.6, 0.34], [-8.8, 0.7], [-5, 0.4], [-1.6, 0.56], [1.4, 0.28], [4.6, 0.66], [8.2, 0.38], [11.4, 0.6], [14.6, 0.32], [17.2, 0.7], [19.6, 0.5], [22.6, 0.62], [24.6, 0.76]] as const

/** A gully's line from Uluru's top `dx` across, `down` of the way to its foot, splaying outward toward the rock's ends. */
const uluruGully = (dx: number, down: number, shift = 0): Point[] => {
  const top = heightAlong(ULURU, dx + shift)
  const splay = 1.4 * (dx / 27) ** 3

  return [[dx + shift, top - 0.3], [dx + shift * 0.6 + splay * 0.4 - 0.15, top * (1 - down * 0.5)], [dx + splay, top * (1 - down)]]
}

/** A dome `wide` across and `high` tall, standing on the plain `dx` across and `base` up: Kata Tjuta's heads, a spinifex hummock. */
const uluruDome = (at: At, dx: number, wide: number, high: number, fill: string, base = 0): Shape =>
  poly(placer(at)(Array.from({ length: 11 }, (_, i): Point => [dx - Math.cos((Math.PI * i) / 10) * wide, base + high * Math.sin((Math.PI * i) / 10) ** 0.5])), fill)

/** Spinifex hummocks on the plain, each `wide` across, `dx` across and `base` up: their straw-green mounds, then their spiky crowns catching the light, each kind together. */
const uluruSpinifex = (at: At, hummocks: readonly (readonly [number, number, number])[]): Shape[] => [
  ...hummocks.map(([dx, wide, base]) => uluruDome(at, dx, wide, wide * 0.5, '#b2a254', base)),
  ...hummocks.map(([dx, wide, base]) => line(placer(at)([[dx - wide * 0.8, base + wide * 0.3], [dx - wide * 0.5, base + wide * 0.7], [dx - wide * 0.2, base + wide * 0.42], [dx + 0.1, base + wide * 0.8], [dx + wide * 0.4, base + wide * 0.44], [dx + wide * 0.7, base + wide * 0.66], [dx + wide * 0.85, base + wide * 0.3]]), 0.16 * at.s, '#d8c87a', 0.85)),
]

/** Kata Tjuta far off in the haze: its cluster of rounded heads, `[dx, wide, high]`. */
const KATA_TJUTA = [[33.6, 1.5, 2], [35.6, 2.1, 3.2], [38.2, 2.3, 4], [40.9, 1.9, 3.4], [43.1, 1.7, 2.6], [45, 1.3, 1.6]] as const

/** A grown desert oak: its dark rough trunk, its open crown of grey-green needles hanging in strands. */
const uluruOak = (at: At, dx: number, h: number): Shape[] => {
  const p = placer(at)
  const wide = h * 0.46
  const crown: Point[] = [
    ...Array.from({ length: 9 }, (_, i): Point => [dx - Math.cos((Math.PI * i) / 8) * wide, h * 0.72 + Math.sin((Math.PI * i) / 8) * h * 0.28]),
    ...Array.from({ length: 13 }, (_, i): Point => [dx + wide - (2 * wide * i) / 12, h * (i % 2 === 0 ? 0.66 : 0.44 + 0.1 * rnd('uluru-oak', dx, i))]),
  ]

  return [
    line(p([[dx, 0], [dx + 0.25, h * 0.4], [dx - 0.1, h * 0.8]]), 0.4 * at.s, '#3e302a'),
    line(p([[dx + 0.2, h * 0.4], [dx + wide * 0.55, h * 0.7]]), 0.22 * at.s, '#3e302a'),
    poly(p(crown), '#4a563c'),
    dot(at, dx - wide * 0.25, h * 0.9, wide * 0.5, h * 0.08, '#66744e', 0.8),
  ]
}

/** A young desert oak: a slender feathery column, its needles drooping. */
const uluruYoungOak = (at: At, dx: number, h: number): Shape[] => [
  line(placer(at)([[dx, 0], [dx, h * 0.3]]), 0.3 * at.s, '#3e302a'),
  poly(placer(at)([[dx - 0.35, h * 0.18], [dx - 0.8, h * 0.3], [dx - 0.55, h * 0.42], [dx - 0.95, h * 0.55], [dx - 0.6, h * 0.68], [dx - 0.7, h * 0.82], [dx - 0.2, h * 0.94], [dx, h], [dx + 0.3, h * 0.9], [dx + 0.65, h * 0.76], [dx + 0.5, h * 0.62], [dx + 0.9, h * 0.48], [dx + 0.6, h * 0.36], [dx + 0.75, h * 0.24], [dx + 0.3, h * 0.16]]), '#55603f'),
]

/** The spinifex hummocks along the plain at the rock's foot, `[dx, wide]`. */
const ULURU_SPINIFEX = [[-48, 1.4], [-31, 1.8], [-22.6, 1.5], [-13, 2], [-4.4, 1.6], [6.6, 1.9], [15.8, 1.5], [24.4, 1.8], [37.2, 1.6], [47, 1.3]] as const

/** Uluru on the red plain: the far line of scrub, Kata Tjuta pale in the haze, the rock red and glowing from its sunlit top down to its shadowed foot, its gullies and their sunlit ribs, its caves, the scrub round its foot, desert oaks, spinifex. */
const uluru = (at: At): Shape[] => {
  const p = placer(at)
  const top = Math.max(...ULURU.map(([, up]) => up))

  return [
    ridge(at, -55, 55, 0.8, 0.3, '#94784c', 1),
    // Kata Tjuta's heads by turns paler and darker, the darker in front, each together.
    ...[0, 1].flatMap(turn => KATA_TJUTA.filter((_, i) => i % 2 === turn).map(([dx, wide, high]) => uluruDome(at, dx, wide, high, turn === 0 ? '#bc949a' : '#aa848e'))),
    { ...poly(p(ULURU), '#c45a30'), grad: { x1: 0, y1: at.y - top * at.s, x2: 0, y2: at.y, stops: [[0, '#de7c42', 1], [0.5, '#c85c32', 1], [1, '#a2442a', 1]] } },
    line(p(ULURU.slice(3, -3).map(([dx, up]): Point => [dx, up - 0.3])), 0.4 * at.s, '#f0a464', 0.55),
    ...ULURU_GULLIES.map(([dx, down]) => line(p(uluruGully(dx, down)), 0.34 * at.s, '#8a3620', 0.6)),
    ...ULURU_GULLIES.map(([dx, down]) => line(p(uluruGully(dx, down * 0.6, 0.5)), 0.24 * at.s, '#ee9a5c', 0.4)),
    ...[-20.6, -12.4, -3, 5.6, 13.2, 21].map(dx => dot(at, dx, 1.2 + 0.8 * rnd('uluru-cave', dx), 0.8 + 0.6 * rnd('uluru-cave-w', dx), 0.42, '#6a2618', 0.55)),
    ridge(at, -31, 30, 1, 0.4, '#6e7440', 3),
    ...uluruOak(at, -41, 6.6),
    ...uluruYoungOak(at, -35.8, 5.4),
    ...uluruOak(at, 30.4, 4.6),
    ...uluruSpinifex(at, [
      ...ULURU_SPINIFEX.map(([dx, wide]) => [dx, wide, 0] as const),
      // A few hummocks on the plain nearer by.
      ...([[-45, 2.4, 0.7], [-17, 2.8, 0.45], [22, 3.2, 0.8]] as const).map(([dx, wide, down]) => [dx, wide, -Math.min(9, (at.bottom - at.y) / at.s - 1.6) * down] as const),
    ]),
  ]
}

/** The Field of Light's colours: lilac, sky blue, rose, warm white. */
const ULURU_FIELD_HUES = ['#c8b4ff', '#9ad6ff', '#ffa8d6', '#fff0c8'] as const

/** How far the Field of Light reaches down the plain toward the viewer, as far as the view goes. */
const uluruFieldDeep = (at: At): number => Math.min(5.5, (at.bottom - at.y) / at.s - 0.6)

/** One of the Field of Light's lamps, the `i`th: across, up (the nearer, the lower and the wider the field), and how big. */
const uluruLamp = (at: At, i: number): readonly [number, number, number] => {
  const deep = uluruFieldDeep(at)
  const near = rnd('uluru-field-near', i) ** 1.2

  return [(rnd('uluru-field-x', i) - 0.5) * (56 + 34 * near), 0.7 - near * (0.7 + deep), 0.2 + 0.22 * near]
}

/** The Field of Light by night: pools of its light lying over the plain before the rock, soft above and below, its colours shading one into the next, and its frosted lamps in soft colours, each colour together. */
const uluruField = (at: At): Shape[] => {
  const deep = uluruFieldDeep(at)
  const up = 0.5 - deep * 0.45
  const ry = 1 + deep * 0.6

  return [
    // Each pool twice, the inner over the outer, so its ends fade too.
    ...([[-25, '#b8a4ff'], [-9, '#8ccaff'], [8, '#ffa0d0'], [24, '#ffe2b0']] as const).flatMap(([dx, hue]) =>
      [22, 13].map(rx => ({
        ...dot(at, dx, up, rx, ry, hue),
        grad: { x1: 0, y1: at.y - (up + ry) * at.s, x2: 0, y2: at.y - (up - ry) * at.s, stops: [[0, hue, 0], [0.5, hue, 0.11], [1, hue, 0]] as const },
      })),
    ),
    ...ULURU_FIELD_HUES.flatMap((hue, k) =>
      Array.from({ length: 13 }, (_, n) => {
        const [dx, lampUp, r] = uluruLamp(at, n * 4 + k)

        return dot(at, dx, lampUp, r, r * 0.8, hue, 0.9)
      }),
    ),
  ]
}

/** A few of the lamps slowly changing colour, as the field's do, a soft halo round each. */
const uluruFieldShift = (at: At, now: number, light: Light): Shape[] => {
  if (light.dark < 0.05) return []
  const lamps = Array.from({ length: 8 }, (_, i) => {
    const [dx, up, r] = uluruLamp(at, 60 + i)
    const turn = mod(now / 4000 + i * 0.37, 1) * ULURU_FIELD_HUES.length
    const from = ULURU_FIELD_HUES[Math.floor(turn) % ULURU_FIELD_HUES.length] ?? '#ffffff'
    const to = ULURU_FIELD_HUES[(Math.floor(turn) + 1) % ULURU_FIELD_HUES.length] ?? '#ffffff'

    return { dx, up, r, hue: mix(from, to, turn % 1) }
  })

  return [
    ...lamps.map(({ dx, up, r, hue }) => dot(at, dx, up, r * 3, r * 2.3, hue, 0.1 * light.dark)),
    ...lamps.map(({ dx, up, r, hue }) => dot(at, dx, up, r * 1.9, r * 1.5, hue, 0.16 * light.dark)),
    ...lamps.map(({ dx, up, r, hue }) => dot(at, dx, up, r * 1.2, r, hue, light.dark)),
  ]
}

/** A red kangaroo's outline, facing right, crouched to land or spring: `[dx, up]` from its feet. */
const ULURU_KANGAROO_CROUCH: readonly Point[] = [[-2.6, 0.15], [-1.7, 0.5], [-1.2, 1], [-1.15, 1.65], [-0.6, 2.3], [0.1, 2.7], [0.4, 2.95], [0.45, 3.35], [0.35, 3.95], [0.7, 3.45], [0.95, 3.45], [1.45, 3.1], [1, 2.85], [0.8, 2.6], [0.85, 2.15], [1.2, 1.85], [0.8, 1.8], [0.8, 1.3], [1, 0.8], [1.1, 0.05], [-0.4, 0], [-0.3, 0.4], [-0.9, 0.35], [-2.6, 0]]
/** The same outline, point for point, stretched in mid-hop: its legs trailing, its tail out. */
const ULURU_KANGAROO_LEAP: readonly Point[] = [[-2.9, 1.45], [-1.8, 1.55], [-1.15, 1.75], [-0.95, 2.15], [-0.2, 2.5], [0.45, 2.6], [0.85, 2.75], [0.95, 3.1], [0.7, 3.65], [1.1, 3.2], [1.35, 3.15], [1.95, 2.85], [1.45, 2.6], [1.15, 2.35], [1.05, 2], [1.45, 1.6], [0.95, 1.7], [0.5, 1.55], [0.05, 1.2], [-1.2, 0.25], [-1.5, 0.45], [-0.7, 0.95], [-1.05, 1.3], [-2.9, 1.3]]

/** A red kangaroo bounding across the plain before the rock: crouching, springing, stretched out in the air, landing; its shadow under it. */
const uluruKangaroo = (at: At, now: number): Shape[] => {
  const dx = mod(now / 150, 180) - 75
  const fade = Math.max(0, Math.min(1, (dx + 52) / 4, (50 - dx) / 4))
  if (fade <= 0) return []
  const hop = mod(now / 720, 1)
  const air = Math.sin(Math.PI * hop)
  const stretch = air ** 0.7
  const lift = 1.6 * air
  const foot = -1.2
  const k = 1.1

  return [
    dot(at, dx, foot + 0.05, 1.5 - 0.5 * air, 0.22, '#5a2414', 0.3 * fade),
    poly(placer(at)(ULURU_KANGAROO_CROUCH.map(([x, y], i): Point => {
      const [lx, ly] = ULURU_KANGAROO_LEAP[i] ?? [x, y]

      return [dx + (x + (lx - x) * stretch) * k, foot + lift + (y + (ly - y) * stretch) * k]
    })), '#6e4c3c', fade),
  ]
}

// Round the world eastward, by longitude: each stop's hour close to its neighbours'.
export const STOPS: readonly Stop[] = [
  { name: 'HAWAII · USA', lon: -157.82, clouds: 3, ground: '#e2c88e', floor: 'sand', birds: true, draw: at => [...diamondHead(at), ...waikikiWater(at), ...diamondHeadLighthouse(at), ...waikikiHotels(at), ...waikikiBeach(at)], lights: waikikiLights, moving: (at, now, light) => [...waikikiSurf(at, now), ...waikikiCanoe(at, now, light), ...waikikiSurfer(at, now, light)], glowing: (at, now, light) => [...waikikiRainbow(at, light), ...waikikiFlames(at, now, light)] },
  { name: 'SAN FRANCISCO · USA', lon: -122.48, climate: 'mist', ground: '#5a6e4c', floor: 'grass', birds: true, draw: at => [...goldenGateShores(at), ...goldenGate(at)], lights: goldenGateLights, moving: (at, now, light) => [...goldenGateYacht(at, now), ...goldenGateFog(at, now, light)], glowing: goldenGateBeacons },
  { name: 'GRAND CANYON · USA', lon: -112.11, climate: 'haze', ground: '#9a8064', floor: 'stone', draw: grandCanyon, lights: desertViewLights, moving: grandCanyonMoving, glowing: grandCanyonMilkyWay },
  { name: 'EASTER ISLAND · CHILE', lon: -109.35, ground: '#4a5a3a', floor: 'grass', draw: at => [...water(at, -55, 55, 2.4, '#3a5a8a'), box(at, -14, 0, 14, 0.8, '#3a3232'), ...[-10.5, -5.2, 0, 5.2, 10.5].flatMap(dx => moai(at, dx, 6.6 + 1.2 * rnd('moai', dx)))], moving: (at, now) => glints(at, -55, 55, 2.4, now) },
  { name: 'CHICHEN ITZA · MEXICO', lon: -88.57, ground: '#4c6e3c', floor: 'grass', birds: true, draw: chichen, lights: chichenLights },
  { name: 'NIAGARA FALLS · CANADA', lon: -79.07, ground: '#4e7a44', floor: 'grass', birds: true, draw: niagara, lights: niagaraLights, moving: niagaraMoving, glowing: niagaraGlowing },
  { name: 'NEW YORK · USA', lon: -74.04, ground: '#4a4c54', floor: 'stone', draw: liberty, lights: at => [...skyline(at, -52, 4, 3, 12, '#5c6c88', 7, true), dot(at, -26, 18.1, 0.3, 0.3, '#ff5a50'), ...glow(at, 13.5, 8, 5.5, 7, '#e8fff4', 0.14)], moving: (at, now) => glints(at, -55, 55, 2.4, now), glowing: libertyTorch },
  { name: 'MACHU PICCHU · PERU', lon: -72.55, climate: 'mist', ground: '#4e7a44', floor: 'grass', draw: machuPicchu, moving: (at, now) => mist(at, now, 6) },
  { name: 'RIO · BRAZIL', lon: -43.21, ground: '#d8b47c', floor: 'sand', birds: true, draw: corcovado, lights: at => [...glow(at, -6.6, 15.2, 3.6, 3, '#fff6dc', 0.4), ...Array.from({ length: 26 }, (_, i) => dot(at, -26 + 34 * rnd('rio-light', i), 0.5 + 2.6 * rnd('rio-up', i), 0.18, 0.18, '#ffd78a', 0.9))], moving: (at, now) => glints(at, 2, 55, 2, now) },
  { name: 'STONEHENGE · UK', lon: -1.83, climate: 'overcast', clouds: 3, ground: '#5c8646', floor: 'grass', draw: stonehenge, lights: stonehengeLights, moving: stonehengeSheep, glowing: stonehengeFlames },
  { name: 'LONDON · UK', lon: -0.12, climate: 'overcast', clouds: 5, ground: '#41474e', floor: 'stone', weather: 'rain', draw: bigBen, lights: bigBenLights, moving: bigBenMoving, glowing: busWindows },
  { name: 'BARCELONA · SPAIN', lon: 2.17, ground: '#867a66', floor: 'stone', birds: true, draw: barcelona, lights: sagradaLights, moving: sagradaMoving, glowing: sagradaBeacon },
  { name: 'PARIS · FRANCE', lon: 2.29, ground: '#4a5240', floor: 'grass', weather: 'leaves', draw: at => [...haussmann(at, -54, -14), ...haussmann(at, 14, 54), ...roundTree(at, -12, 6, '#d87a32', '#f0b04a'), ...roundTree(at, 12, 5.6, '#c8522e', '#e8903a'), ...eiffel(at)], lights: at => [...haussmann(at, -54, -14, true), ...haussmann(at, 14, 54, true), ...eiffelLights(at)], glowing: (at, now, light) => Array.from({ length: 10 }, (_, i) => dot(at, (rnd('sparkle-x', i) - 0.5) * (5 - rnd('sparkle-y', i) * 4.4), 1 + rnd('sparkle-y', i) * 17, 0.22, 0.22, '#ffffff', light.dark * Math.max(0, Math.sin(now / 200 + i * 7)))) },
  { name: 'AMSTERDAM · NETHERLANDS', lon: 4.9, ground: '#4c7a3a', floor: 'grass', birds: true, draw: at => [...canalHouses(at, -48), ...windmill(at, -10, 1.15), ...windmill(at, 18, 0.9), ...tulips(at, -55, 55)], lights: at => canalHouses(at, -48, true), moving: (at, now) => [...sails(at, -10, 1.15, now, 9000), ...sails(at, 18, 0.9, now, 7000)] },
  { name: 'NEUSCHWANSTEIN · GERMANY', lon: 10.75, clouds: 3, ground: '#4a6a3e', floor: 'grass', birds: true, draw: neuschwanstein, lights: neuschwansteinLights, moving: neuschwansteinMoving },
  { name: 'VENICE · ITALY', lon: 12.34, ground: '#948e86', floor: 'stone', birds: true, draw: venice, lights: veniceLights, moving: veniceMoving, glowing: veniceLantern },
  { name: 'ROME · ITALY', lon: 12.49, ground: '#a48a5c', floor: 'stone', birds: true, draw: at => [...colosseum(at), cypress(at, -18, 8), cypress(at, -16, 6.6), cypress(at, 19, 7.4), ...umbrellaPine(at, -28, 7), ...umbrellaPine(at, 27, 6.4)], lights: at => colosseum(at, true) },
  { name: 'TROMSO · NORWAY', lon: 18.96, climate: 'arctic', clouds: 1, ground: '#b4c2d8', floor: 'snow', weather: 'snow', draw: fjord, lights: at => [box(at, 2.2, 1.2, 3.6, 2.4, '#ffd27a'), ...glow(at, 2.9, 1.8, 3, 2, '#ffd27a', 0.2)], glowing: aurora },
  { name: 'SANTORINI · GREECE', lon: 25.43, clouds: 1, ground: '#b8ab98', floor: 'stone', birds: true, draw: santorini, lights: santoriniLights, moving: santoriniMoving, glowing: santoriniLantern },
  { name: 'GIZA · EGYPT', lon: 31.13, climate: 'haze', clouds: 1, ground: '#d2a864', floor: 'sand', birds: true, draw: at => [...gizaPyramids(at), ...palm(at, -36, 6), ...palm(at, -33, 4.8), ...palm(at, 38, 5.6)], lights: gizaLights },
  { name: 'CAPPADOCIA · TURKEY', lon: 34.83, climate: 'haze', clouds: 1, ground: '#ccac8c', floor: 'sand', draw: cappadocia, lights: cappadociaLights, moving: cappadociaBalloons, glowing: cappadociaBurners },
  { name: 'SERENGETI · TANZANIA', lon: 35, climate: 'haze', clouds: 1, ground: '#b8904a', floor: 'grass', birds: true, draw: savanna },
  { name: 'PETRA · JORDAN', lon: 35.44, clouds: 1, ground: '#cca07a', floor: 'sand', birds: true, draw: petra, lights: petraLights, moving: petraCamelHead, glowing: petraCandles },
  { name: 'MOSCOW · RUSSIA', lon: 37.62, climate: 'arctic', ground: '#b8c4da', floor: 'snow', weather: 'snow', draw: stBasil, lights: at => [...glow(at, 0, 6, 16, 8, '#ffd090', 0.2), ...glow(at, 0, 3, 12, 3, '#ffe0a0', 0.18)] },
  { name: 'DUBAI · UAE', lon: 55.27, climate: 'haze', clouds: 1, ground: '#d8b482', floor: 'sand', draw: dubai, lights: dubaiLights, moving: dubaiMoving, glowing: dubaiGlowing },
  { name: 'AGRA · INDIA', lon: 78.04, climate: 'haze', ground: '#5e7048', floor: 'grass', weather: 'fireflies', draw: tajMahal, lights: at => [...glow(at, 0, 7, 15, 9, '#ffe6d0', 0.22), ...glow(at, 0, 10, 4, 3, '#fff2e0', 0.3)] },
  { name: 'EVEREST · NEPAL', lon: 86.92, climate: 'arctic', ground: '#c2cede', floor: 'snow', draw: everest, lights: everestLights, moving: (at, now) => [...everestPlume(at, now), ...everestFlags(at, now)], glowing: (at, _, light) => everestAlpenglow(at, light) },
  { name: 'ANGKOR WAT · CAMBODIA', lon: 103.87, climate: 'haze', ground: '#6a8a4a', floor: 'grass', weather: 'fireflies', birds: true, draw: angkor, lights: angkorLights, moving: angkorMoving },
  { name: 'HA LONG BAY · VIETNAM', lon: 107.08, climate: 'mist', clouds: 3, ground: '#2f7868', floor: 'stone', draw: halongBay, lights: halongLights, moving: halongMoving, glowing: halongLanterns },
  { name: 'GREAT WALL · CHINA', lon: 116.57, climate: 'mist', ground: '#4a6a4e', floor: 'grass', birds: true, draw: greatWall, lights: greatWallLights, moving: (at, now) => mist(at, now, 4.2) },
  { name: 'ULURU · AUSTRALIA', lon: 131.04, climate: 'haze', clouds: 1, ground: '#c4683a', floor: 'sand', birds: true, draw: uluru, lights: uluruField, moving: uluruKangaroo, glowing: uluruFieldShift },
  { name: 'MT FUJI · JAPAN', lon: 138.73, ground: '#5c8a4c', floor: 'grass', weather: 'petals', draw: fuji, lights: pagodaLights },
  { name: 'SYDNEY · AUSTRALIA', lon: 151.21, ground: '#8a8c88', floor: 'stone', birds: true, draw: operaHouse, lights: at => [...glow(at, -3, 4.5, 14, 6, '#fff4e0', 0.2), ...Array.from({ length: 13 }, (_, i) => dot(at, 18 + i * 2, 3 + 6.4 * Math.sin((i / 12) * Math.PI), 0.2, 0.2, '#ffe6a0', 0.95)), ...Array.from({ length: 15 }, (_, i) => dot(at, 15 + i * 2, 3, 0.16, 0.16, '#ffe6a0', 0.9))], moving: (at, now) => glints(at, -55, 55, 2.2, now) },
]
