import { graded, smooth } from './clawd-vector'
import type { Grade, Gradient, Shape } from './clawd-vector'
import { STOPS, birds, disc, line, mix, mod, poly, rect, rnd } from './scenery-stops'
import type { At, Light, Point, Stop, Weather } from './scenery-stops'

// The world behind the smooth scene (the `scenery` option): the mascots on
// a tour of the world's wonders, round it eastward (hooks/scenery-stops.ts
// draws them). The tour stays at each stop (a landmark in its own weather:
// Big Ben in the rain, Mount Fuji in cherry blossom, Tromsø's snow) for
// STAY_MS, its name and hour shown a while, then pans on to the next, a
// stop's stretch along the world's strip (STOP units at its scale), over
// PAN_MS; a wide view shows the stops either side too. Each stop is at its own time of day, by its longitude
// (the `daylight` option: a world day in 24 minutes, or the real one): its
// sky, its sun or moon and stars, its land golden in the low sun and dim by
// night, its lights coming on at dusk. Pure: a function of the size and the
// time, so the band and the pane are always at the same stop at the same
// hour. World units, as the mascots': a cell is 2 across and 4 down, y down
// from the top.

/** How long the tour stays at a stop, and takes to pan on to the next, ms. */
export const STAY_MS = 45_000
const PAN_MS = 7000
const LEG_MS = STAY_MS + PAN_MS
/** A stop's stretch of the world's strip at scale 1, in units: its art's -55 to 55. */
const STOP = 110

/** How the day goes by: `fast`, a world day in 24 minutes; `real`, each stop at its time of day now (by its sun). */
export type Daylight = 'fast' | 'real'

/** How a stretch of the land is lit: its colours graded (absent, as drawn), and how bright its lights, 0 to 1. */
export type Lit = { grade?: Grade; glow: number }

/**
 * The land: what stands still, drawn once per `key` in daylight colours and
 * kept, `span` units across, seen from `shift` units into it, its last
 * `detail` shapes a texture a drawing short of room may leave out; its night
 * lights, still too; how both are lit `x` units into it (`litAt`), and a key
 * that changes as that light does, in steps too fine to see, for a drawing
 * that lights the shapes themselves; and what moves on it, drawn over it
 * each frame in the view's own units, lit already.
 */
export type Land = { key: string; still: Shape[]; detail: number; lights: Shape[]; span: number; shift: number; litAt: (x: number) => Lit; litKey: string; moving: Shape[] }

/**
 * The scenery of a frame, back to front: the sky (its colours, a rect to a
 * stretch, all of them fading in from the terminal's own background down to
 * `top` units; then its stars, sun or moon and clouds), the land, the
 * weather behind the mascots, then (after them) the weather nearest the eye;
 * whether the tour is panning on; keys that change when the sky and the land
 * (`still`), or all of it behind the mascots (`behind`), would be drawn
 * otherwise: a drawing keeps what it drew under them till then; and the
 * scenery as the next leg begins, for a drawing to draw its land ahead.
 */
export type Scenery = { sky: { fill: Shape[]; top: number; moving: Shape[] }; land: Land; weather: Shape[]; front: Shape[]; panning: boolean; still: string; behind: string; upcoming: () => Scenery }

/** How often the sky and the light move on (its sun, moon, stars and clouds), ms: a step too small to see. */
export const SKY_MS = 500

// --- the light -------------------------------------------------------------------

/** The hour at Greenwich at `now`: a world day in 24 minutes, or the real one. */
const worldHour = (now: number, daylight: Daylight): number => mod(now / (daylight === 'real' ? 3_600_000 : 60_000), 24)

/** The light at an hour: the sun's height (as at the equator), dark from the end of twilight, golden low, day well up. */
const lightAt = (hour: number): Light => {
  const sun = Math.sin((2 * Math.PI * (hour - 6)) / 24)

  return { hour, sun, dark: 1 - smooth((sun + 0.22) / 0.27), golden: Math.max(0, 1 - Math.abs(sun - 0.06) / 0.22), day: smooth((sun - 0.04) / 0.36) }
}

type Rgb = readonly [number, number, number]

/** Each air's own by day: how much greyer its land, how much dimmer, and the haze it adds. */
const AIRS: Record<NonNullable<Stop['climate']> | 'clear', { grey: number; dim: number; haze: Rgb }> = {
  clear: { grey: 0, dim: 1, haze: [0, 0, 0] },
  overcast: { grey: 0.3, dim: 0.86, haze: [0, 0, 0] },
  haze: { grey: 0.1, dim: 0.92, haze: [24, 16, 4] },
  mist: { grey: 0.2, dim: 0.86, haze: [30, 32, 36] },
  arctic: { grey: 0, dim: 1, haze: [0, 0, 0] },
}

/** How a stop's land is lit: warmer in the low sun; greyer, bluer and dim by night; as its air has it by day. Absent, as drawn. */
const gradeOf = (light: Light, climate: Stop['climate']): Grade | undefined => {
  const { dark } = light
  const air = AIRS[climate ?? 'clear']
  const warm = light.golden * (1 - dark) * (climate === 'overcast' ? 0.3 : 1)
  if (warm === 0 && dark === 0 && air.dim === 1 && air.grey === 0) return undefined
  const grey = 0.5 * dark + air.grey * (1 - dark)
  const day = (1 - dark) * air.dim
  // Each channel its gain times the colour, greyed toward its brightness.
  const row = (gain: number, own: 0 | 1 | 2): Rgb => [0.3, 0.59, 0.11].map((share, i) => gain * ((i === own ? 1 - grey : 0) + grey * share)) as unknown as Rgb
  const [hazeRed, hazeGreen, hazeBlue] = air.haze

  return {
    m: [row((1 + 0.08 * warm) * day + 0.26 * dark, 0), row((1 - 0.08 * warm) * day + 0.31 * dark, 1), row((1 - 0.26 * warm) * day + 0.46 * dark, 2)],
    add: [6 * dark + hazeRed * (1 - dark), 10 * dark + hazeGreen * (1 - dark), 28 * dark + hazeBlue * (1 - dark)],
  }
}

const IDENTITY: Grade = { m: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], add: [0, 0, 0] }

/** Between two lights, `w` of the way. */
const blend = (a: Lit, b: Lit, w: number): Lit => {
  const glow = a.glow + (b.glow - a.glow) * w
  if (a.grade === undefined && b.grade === undefined) return { glow }
  const from = a.grade ?? IDENTITY
  const to = b.grade ?? IDENTITY
  const lerp = (p: Rgb, q: Rgb): Rgb => [p[0] + (q[0] - p[0]) * w, p[1] + (q[1] - p[1]) * w, p[2] + (q[2] - p[2]) * w]

  return { grade: { m: [lerp(from.m[0], to.m[0]), lerp(from.m[1], to.m[1]), lerp(from.m[2], to.m[2])], add: lerp(from.add, to.add) }, glow }
}

const relit = (shapes: readonly Shape[], grade: Grade | undefined): Shape[] =>
  grade === undefined
    ? [...shapes]
    : shapes.map(shape => ({ ...shape, fill: graded(shape.fill, grade), ...(shape.grad === undefined ? {} : { grad: { ...shape.grad, stops: shape.grad.stops.map(([at, colour, alpha]) => [at, graded(colour, grade), alpha] as const) } }) }))

/** The clear sky by the sun's height, top to horizon: night, twilight's blues, the sunset's reds and golds, morning's and noon's blues. */
const SKIES: readonly (readonly [number, readonly string[]])[] = [
  [-0.4, ['#02040f', '#060b22', '#0c1634', '#142244']],
  [-0.2, ['#060a26', '#111a46', '#27305e', '#3e3c68']],
  [-0.08, ['#121a4a', '#2e3470', '#7a5288', '#d0707a']],
  [0.02, ['#22306c', '#4a5294', '#d06e78', '#ffa456']],
  [0.12, ['#2e5ea6', '#6890c8', '#e2a890', '#ffcf86']],
  [0.3, ['#2466b0', '#5a9ad8', '#a2cdec', '#dcecf2']],
  [1, ['#145cac', '#4a9ae0', '#9ccdf0', '#d4ecf8']],
]
const OVERCAST_DAY = ['#5c6676', '#7c8696', '#9ca4b0', '#b4bac2']
const OVERCAST_NIGHT = ['#0a0c14', '#121622', '#1a202e', '#242a3a']

/** A stop's sky at its light, top to horizon: grey under cloud, dusty low in haze, pale low in mist. */
const skyOf = (light: Light, climate: Stop['climate']): readonly string[] => {
  const next = Math.max(1, SKIES.findIndex(([sun]) => sun >= light.sun))
  const [low, below] = SKIES[next - 1] ?? [0, []]
  const [high, above] = SKIES[next] ?? [low, below]
  const sky = below.map((colour, i) => mix(colour, above[i] ?? colour, Math.max(0, Math.min(1, (light.sun - low) / (high - low)))))
  const clear = 1 - light.dark
  switch (climate) {
    case 'overcast':
      return sky.map((colour, i) => mix(colour, mix(OVERCAST_NIGHT[i] ?? colour, OVERCAST_DAY[i] ?? colour, clear * (0.5 + 0.5 * light.day)), 0.8))
    case 'haze':
    case 'mist':
      return sky.map((colour, i) => (i < 2 ? colour : mix(colour, climate === 'haze' ? '#e6cc98' : '#e2e8ee', 0.35 * clear)))
    default:
      return sky
  }
}

/** A stop's clouds at its light: white by day (grey under cloud), lit from below in the low sun, dark by night. */
const cloudOf = (light: Light, climate: Stop['climate']): string => mix(mix(climate === 'overcast' ? '#a4aab4' : '#ffffff', '#ffb08a', 0.7 * light.golden), '#232a40', light.dark)

/** A new moon, and the moon's month: its phase, 0 new, 0.5 full. */
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14)
const MONTH_MS = 29.530_589 * 86_400_000

// --- the tour --------------------------------------------------------------------

const stopAt = (j: number): Stop => STOPS[mod(j, STOPS.length)] as Stop

/**
 * Where the tour is at `now`: the stop it stays at or pans on from (`leg`),
 * how far into the leg, and how far it has panned on (eased); when it `pans`
 * not, at the next stop from halfway through the pan, as if its leg had
 * begun (its name not yet shown).
 */
const tourAt = (now: number, pans = true): { leg: number; into: number; pan: number } => {
  const leg = Math.floor(now / LEG_MS)
  const into = now - leg * LEG_MS
  if (!pans && into >= STAY_MS + PAN_MS / 2) return { leg: leg + 1, into: into - LEG_MS, pan: 0 }

  return { leg, into, pan: into < STAY_MS || !pans ? 0 : smooth((into - STAY_MS) / PAN_MS) }
}

/** The land's scale: the band's few rows, a pane's many. */
const scaleOf = (horizon: number): number => Math.max(0.6, Math.min(1.5, horizon / 21))

type Seen = { stop: Stop; at: At; j: number }

/** The stops whose stretch, or `reach` units past it, is seen from `left`, `width` across: where each is drawn, and its place along the world's strip. */
const stopsIn = (left: number, width: number, horizon: number, bottom: number, reach = 0): Seen[] => {
  const s = scaleOf(horizon)
  const stretch = STOP * s
  const seen: Seen[] = []
  for (let j = Math.floor((left - reach) / stretch); j * stretch < left + width + reach; j += 1) seen.push({ stop: stopAt(j), at: { x: (j + 0.5) * stretch - left, y: horizon, s, bottom }, j })

  return seen
}

/** The ground's texture over a stop's stretch (what of it lies between `from` and `to`), sparser and smaller toward the horizon; alike marks together, so a document draws each kind as one path. */
const floorShapes = (stop: Stop, at: At, j: number, from: number, to: number): Shape[] => {
  const light: Shape[] = []
  const dark: Shape[] = []
  const flowers: Shape[] = []
  const pale = mix(stop.ground, '#ffffff', stop.floor === 'snow' ? 0.5 : 0.18)
  const deep = mix(stop.ground, '#000000', 0.22)
  for (let y = at.y + 1.2, row = 0; y < at.bottom - 0.3; row += 1) {
    const near = Math.min(1.6, 0.6 + (y - at.y) / 16)
    for (let x = at.x - (STOP / 2) * at.s + 3 * rnd('floor', j, row); x < at.x + (STOP / 2) * at.s; x += (4 + 5 * rnd('floor-gap', j, row, Math.floor(x))) * near) {
      const k = rnd('floor-kind', j, row, Math.floor(x))
      if (x < from || x > to) continue
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

/** A colour along the strip, `span` across from `left`, `stretch` a stop: each stop's own over its middle, blended into the next's over the seam between them. */
const groundOf = (left: number, span: number, stretch: number): Gradient => {
  const stops: [number, string, number][] = []
  for (let j = Math.floor(left / stretch) - 1; j * stretch <= left + span + stretch; j += 1) {
    const edge = (j + 1) * stretch
    for (const [x, colour] of [[edge - stretch * 0.13, stopAt(j).ground], [edge + stretch * 0.13, stopAt(j + 1).ground]] as const) stops.push([Math.max(0, Math.min(1, (x - left) / span)), colour, 1])
  }

  return { x1: 0, y1: 0, x2: span, y2: 0, stops }
}

/** The land's still shapes in daylight, how many of the last are its texture (`Land.detail`), and its night lights: of the stops whose art reaches the strip. */
const landStill = (left: number, span: number, height: number, horizon: number): { shapes: Shape[]; detail: number; lights: Shape[] } => {
  const seen = stopsIn(left, span, horizon, height, REACH * scaleOf(horizon))
  // The ground first (`litStill` lights it stop by stop), nearer darker, its edge catching the light; on it each stop's
  // landmark, then the ground's texture.
  const shapes: Shape[] = [
    { ...rect(0, horizon - 0.1, span, height - horizon + 0.1, '#000000'), grad: groundOf(left, span, STOP * scaleOf(horizon)) },
    { ...rect(0, horizon, span, height - horizon, '#000000'), grad: { x1: 0, y1: horizon, x2: 0, y2: Math.max(height, horizon + 1), stops: [[0, '#000000', 0], [1, '#000000', 0.32]] } },
    rect(0, horizon - 0.1, span, 0.3, '#ffffff', 0.1),
  ]
  for (const { stop, at } of seen) shapes.push(...stop.draw(at))
  const texture = seen.flatMap(({ stop, at, j }) => floorShapes(stop, at, j, -2, span + 2))

  return { shapes: [...shapes, ...texture], detail: texture.length, lights: seen.flatMap(({ stop, at }) => stop.lights?.(at) ?? []) }
}

/** How far into a stop's stretch `x` is (0 its left edge, 1 its right), and how much it fades there: none over its middle, out to its edges. */
const edgeFade = (x: number, at: At): number => {
  const u = (x - at.x) / (STOP * at.s) + 0.5

  return Math.max(0, Math.min(1, Math.min(u, 1 - u) * 5))
}

/** A sky's gradient down to the horizon. */
const skyGradient = ([top = '#000000', high = top, low = high, horizonward = low]: readonly string[], horizon: number): Gradient => ({
  x1: 0,
  y1: 0,
  x2: 0,
  y2: horizon,
  stops: [[0.22, top, 1], [0.42, high, 1], [0.78, low, 1], [1, horizonward, 1]],
})

/** Between two stops, their skies and lights blend over this many units (at scale 1) either side of the seam. */
const SEAM = 12
/** How far past its stretch a stop's art may reach, at scale 1: a bus driving off, the northern lights. */
const REACH = 6

/** The sky's colours over the view: each stop's own over its stretch (on to the end of the seam after it), and the next's faded in over that seam. */
const skyFill = (seen: readonly Seen[], width: number, horizon: number, skyAt: (j: number) => readonly string[]): Shape[] => {
  const own = (x: number, to: number, j: number): Shape => ({ ...rect(Math.max(0, x), 0, Math.min(width, to) - Math.max(0, x), horizon + 1, '#000000'), grad: skyGradient(skyAt(j), horizon) })
  // Each stop's seam with the next: from its end less SEAM to its end and SEAM more.
  const seamOf = ({ at }: Seen): [number, number] => [at.x + (STOP / 2 - SEAM) * at.s, at.x + (STOP / 2 + SEAM) * at.s]
  const shown = seen.filter(one => seamOf(one)[1] > 0 && seamOf(one)[1] - STOP * one.at.s < width)

  return [
    ...shown.map(one => own(seamOf(one)[1] - STOP * one.at.s, seamOf(one)[1], one.j)),
    ...shown.filter(one => seamOf(one)[0] < width).map(one => ({ ...own(...seamOf(one), one.j + 1), fade: seamOf(one) })),
  ]
}

/** Where the sun is in a stop's sky at its hour (or the moon, `behind` it by its phase): rising on the left, setting on the right; and its height. */
const arcOf = (at: At, hour: number, horizon: number, behind = 0): [number, number, number] => {
  const angle = (2 * Math.PI * (hour - 6)) / 24 - 2 * Math.PI * behind
  const up = Math.sin(angle)

  return [at.x - Math.cos(angle) * STOP * at.s * 0.3, horizon * (1 - 0.82 * up), up]
}

/** A soft halo `r` round, `alpha` bright at its heart: rings, each fainter out to its edge. */
const halo = (x: number, y: number, r: number, colour: string, alpha: number): Shape[] => [1, 0.72, 0.48].map((k, i) => disc(x, y, r * k, r * k, colour, alpha * (0.3 + 0.05 * i)))

/** The moon's lit part at its phase (0 new, 0.5 full): its disc less the shadow's, lit on the right as it waxes, on the left as it wanes. */
const moonOf = (x: number, y: number, r: number, phase: number, alpha: number): Shape => {
  const d = 4 * r * Math.min(phase, 1 - phase)
  if (d >= 1.96 * r) return disc(x, y, r, r, '#f2f0e4', alpha)
  const side = phase < 0.5 ? 1 : -1
  const lit = Math.acos(-d / (2 * r))
  const shadow = Math.acos(d / (2 * r))
  const points: Point[] = []
  for (let i = 0; i <= 12; i += 1) points.push([x + side * r * Math.cos(-lit + (lit * i) / 6), y + r * Math.sin(-lit + (lit * i) / 6)])
  for (let i = 0; i <= 8; i += 1) points.push([x + side * (r * Math.cos(shadow - (shadow * i) / 4) - d), y + r * Math.sin(shadow - (shadow * i) / 4)])

  return poly(points, '#f2f0e4', alpha)
}

/**
 * Each stop's stars, twinkling as dark as it is; its sun and moon on their
 * arcs, the one the view is at's alone (the next's taking over as the tour
 * pans on to it); its clouds drifting across it; the stars and clouds fading
 * at its edges.
 */
const skyMoving = (seen: readonly Seen[], width: number, horizon: number, now: number, lightOf: (j: number) => { light: Light }): Shape[] => {
  const shapes: Shape[] = []
  const phase = mod((now - NEW_MOON) / MONTH_MS, 1)
  for (const { stop, at, j } of seen) {
    const { light } = lightOf(j)
    const veil = stop.climate === 'overcast' ? 0.15 : stop.climate === 'mist' ? 0.5 : 1
    // Its stars, twinkling: in four brightnesses, each drawn together.
    const stars: Shape[][] = [[], [], [], []]
    for (let i = 0; light.dark * veil > 0.05 && i < STOP / 6; i += 1) {
      const x = at.x + (rnd('sx', j, i) - 0.5) * STOP * at.s
      const level = Math.round(3 * light.dark * veil * (0.55 + 0.45 * Math.sin(now / (500 + 400 * rnd('twinkle', i)) + 7 * rnd('phase', i))) * edgeFade(x, at))
      const r = 0.16 + 0.2 * rnd('star', i)
      if (level > 0) stars[level]?.push(disc(x, rnd('sy', j, i) * horizon * 0.62, r, r * 0.8, '#f4f0ff', level / 3))
    }
    shapes.push(...stars.flat())
    // The sun, big and gold as it sets; the moon at its phase, pale by day; both dim through cloud.
    const shine = Math.max(veil, 0.3) * smooth((0.75 * STOP * at.s - Math.abs(at.x - width / 2)) / (0.5 * STOP * at.s))
    const [sx, sy, sun] = arcOf(at, light.hour, horizon)
    if (sun > -0.12 && shine > 0) {
      const r = (1.9 + 0.8 * light.golden) * at.s
      const colour = mix('#fff6d8', '#ffa048', light.golden)
      shapes.push(...halo(sx, sy, r * 3.6, colour, (0.2 + 0.12 * light.golden) * shine), disc(sx, sy, r, r, colour, shine))
    }
    const [mx, my, moon] = arcOf(at, light.hour, horizon, phase)
    if (moon > -0.12 && shine > 0 && Math.min(phase, 1 - phase) > 0.03) {
      const r = 1.6 * at.s
      shapes.push(...halo(mx, my, r * 2.8, '#f2f0e4', 0.16 * light.dark * shine), moonOf(mx, my, r, phase, (0.3 + 0.7 * light.dark) * shine))
    }
    const cloud = cloudOf(light, stop.climate)
    for (let i = 0; i < (stop.clouds ?? 2); i += 1) {
      const x = at.x + STOP * at.s * (mod(rnd('cloud-x', j, i) + (now * (0.0005 + 0.0004 * rnd('cloud-speed', i))) / STOP, 1) - 0.5)
      const y = horizon * (0.14 + 0.28 * rnd('cloud-y', j, i))
      const size = (1.8 + 1.4 * rnd('cloud-size', j, i)) * at.s
      const alpha = (stop.climate === 'overcast' ? 0.6 : 0.4) * edgeFade(x, at)
      for (const [dx, dy, k] of [[0, 0, 1], [-1.5, 0.45, 0.7], [1.6, 0.4, 0.75], [0.5, -0.5, 0.65]] as const) shapes.push(disc(x + dx * size, y + dy * size * 0.5, 1.5 * size * k, 0.72 * size * k, cloud, alpha))
    }
  }

  return shapes
}

type Weathered = { weather?: Weather; lit: Lit }

/**
 * One of the weather's motes, as the stop it starts its run over says: each
 * runs from the top to the bottom (a firefly hovers over the field, glowing
 * by night), taking its kind at its run's start, lit as that stop is.
 */
const moteShapes = (i: number, width: number, height: number, horizon: number, now: number, near: boolean, weatherAt: (x: number) => Weathered): Shape[] => {
  const speed = 0.0025 + 0.0025 * rnd('mote-speed', i)
  const period = (height + 10) / speed
  const at = now + rnd('mote-phase', i) * period
  const run = Math.floor(at / period)
  const u = at / period - run
  const x0 = rnd('mote-x', i, run) * (width + 30) - 15
  const { weather: kind, lit } = weatherAt(x0)
  const size = (near ? 1.35 : 0.85) * (0.7 + 0.6 * rnd('mote-size', i))
  const sway = Math.sin(now / (700 + 500 * rnd('mote-sway', i)) + 6 * rnd('mote-p', i))
  const y = -4 + u * (height + 8)
  switch (kind) {
    case 'petals': {
      const x = x0 + u * 18 + sway * 1.6
      const turn = now / 600 + i

      return relit([{ kind: 'ellipse', x: -0.45 * size, y: -0.25 * size, w: 0.9 * size, h: 0.5 * size, fill: '#f8bcd4', alpha: 0.9, m: [Math.cos(turn), Math.sin(turn), -Math.sin(turn) * 0.6, Math.cos(turn) * 0.6, x, y] }], lit.grade)
    }
    case 'fireflies': {
      const glow = lit.glow * Math.sin(Math.PI * u) * (0.5 + 0.5 * Math.sin(now / 420 + 5 * i))
      if (near || glow <= 0.01) return []
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

      return relit([poly(leaf, ['#e2762c', '#c8452e', '#f0b040', '#b85a26'][i % 4] as string, 0.92)], lit.grade)
    }
    case 'rain': {
      // Rain falls three times as fast, slanting.
      const ry = -4 + mod(u * 3, 1) * (height + 8)
      const x = x0 - mod(u * 3, 1) * 6

      return relit([line([[x, ry], [x - 0.5, ry + 2.2]], 0.16 * size, '#b8c8dc', 0.55)], lit.grade)
    }
    case 'snow':
      return relit([disc(x0 + sway * 1.4 + u * 4, y, 0.42 * size, 0.36 * size, '#ffffff', 0.9)], lit.grade)
    case undefined:
      return []
  }
}

const weather = (width: number, height: number, horizon: number, now: number, near: boolean, weatherAt: (x: number) => Weathered): Shape[] => {
  const shapes: Shape[] = []
  const count = Math.min(80, Math.ceil((width * height) / 100))
  for (let i = 0; i < count; i += 1) if ((rnd('mote-near', i) < 0.3) === near) shapes.push(...moteShapes(i, width, height, horizon, now, near, weatherAt))

  return shapes
}

/** An hour as a clock shows it. */
const clockOf = (hour: number): string => {
  const minutes = Math.floor(hour * 60) % 1440

  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** The name of the stop the tour has just come to and its hour there, a while after it arrives, by a pin. */
const caption = (stop: Stop, hour: number, into: number, horizon: number): Shape[] => {
  const alpha = Math.min(smooth((into - 600) / 900), smooth((10_500 - into) / 1500))
  if (alpha <= 0.01) return []
  const size = Math.min(3.4, Math.max(2.6, horizon / 7))
  const y = size * 1.25

  return [
    disc(2.6, y - size * 0.55, size * 0.3, size * 0.3, '#e8463a', alpha),
    poly([[2.6 - size * 0.27, y - size * 0.45], [2.6, y + size * 0.1], [2.6 + size * 0.27, y - size * 0.45]], '#e8463a', alpha),
    disc(2.6, y - size * 0.55, size * 0.11, size * 0.11, '#ffffff', alpha),
    { kind: 'text', x: 4, y, w: 0, h: 0, text: `${stop.name} · ${clockOf(hour)}`, size, anchor: 'start', bold: true, fill: '#ffffff', alpha: 0.9 * alpha },
  ]
}

/**
 * The scenery of a frame `width` by `height` units at `now` (ms), its ground
 * from `horizon` down, each stop at its hour by `daylight`: the sky; the
 * land, still (the whole leg's strip, seen from where the pan has got to)
 * and lit for the hour, and what moves on it; and the weather nearest the
 * eye. The tour pans on by `now` (or, for a drawing that `pans` not, goes on
 * to the next stop at once halfway); all else is as it was at `held` (a
 * drawing holds it a while, so as not to draw it all every frame), the sky
 * and the light as at the last SKY_MS step.
 */
export const sceneryOf = (width: number, height: number, horizon: number, now: number, daylight: Daylight = 'fast', held = now, pans = true): Scenery => {
  const { leg, into, pan } = tourAt(now, pans)
  const sky = Math.floor(held / SKY_MS) * SKY_MS
  const stretch = STOP * scaleOf(horizon)
  // The view's left along the world's strip at the leg's start (its stop in the middle), and now; the strip the
  // whole leg's, its stay and its pan, drawn once.
  const left = (leg + 0.5) * stretch - width / 2
  const span = width + (pans ? stretch : 0)
  const view = left + pan * stretch
  const key = `land:${width}x${height}@${horizon}:${leg}:${span}`
  const hour = worldHour(sky, daylight)
  // Each stop's light now, by its place along the strip: made as first asked for.
  const lights = new Map<number, { light: Light; lit: Lit; sky: readonly string[] }>()
  const lightOf = (j: number): { light: Light; lit: Lit; sky: readonly string[] } => {
    const kept = lights.get(j)
    if (kept !== undefined) return kept
    const stop = stopAt(j)
    const light = lightAt(mod(hour + stop.lon / 15, 24))
    const grade = gradeOf(light, stop.climate)
    const made = { light, lit: { ...(grade === undefined ? {} : { grade }), glow: smooth((light.dark - 0.1) / 0.6) }, sky: skyOf(light, stop.climate) }
    lights.set(j, made)

    return made
  }
  // The still land's light `x` units into its strip: its stop's, blended into its neighbour's about the seam.
  const seam = (SEAM * stretch) / STOP
  const litAt = (x: number): Lit => {
    const j = Math.floor((left + x) / stretch)
    const u = left + x - j * stretch
    if (u < seam) return blend(lightOf(j - 1).lit, lightOf(j).lit, smooth((u + seam) / (2 * seam)))
    if (u > stretch - seam) return blend(lightOf(j).lit, lightOf(j + 1).lit, smooth((u - stretch + seam) / (2 * seam)))

    return lightOf(j).lit
  }
  // The light changes the still land only from late in the night to well into the morning, and back: in steps of a two-hundredth of the sun's height.
  const litKey = stopsIn(left, span, horizon, height, stretch).map(({ j }) => Math.round(200 * Math.max(-0.23, Math.min(0.29, lightOf(j).light.sun)))).join(',')

  // The stops whose art reaches the view, and those whose sky does.
  const seen = stopsIn(view, width, horizon, height, REACH * scaleOf(horizon))
  const moving: Shape[] = []
  for (const { stop, at, j } of seen) {
    const { light, lit } = lightOf(j)
    moving.push(...relit(stop.moving?.(at, held, light) ?? [], lit.grade), ...(stop.birds === true && light.day > 0 ? birds(at, held, light) : []), ...(stop.glowing?.(at, held, light) ?? []))
  }
  // The weather of the stop each mote starts over, lit as it is.
  const weatherAt = (x: number): Weathered => {
    const j = Math.floor((view + x) / stretch)
    const kind = stopAt(j).weather

    return { ...(kind === undefined ? {} : { weather: kind }), lit: lightOf(j).lit }
  }
  const land = keptIn(made, key, () => landStill(left, span, height, horizon))

  return {
    sky: { fill: skyFill(stopsIn(view, width, horizon, height, stretch / 2), width, horizon, j => lightOf(j).sky), top: 0.22 * horizon, moving: skyMoving(seen, width, horizon, sky, lightOf) },
    land: {
      key,
      still: land.shapes,
      detail: land.detail,
      lights: land.lights,
      span,
      shift: pan * stretch,
      litAt,
      litKey,
      moving: [...moving, ...(pan === 0 ? caption(stopAt(leg), lightOf(leg).light.hour, into - (now - held), horizon) : [])],
    },
    weather: weather(width, height, horizon, held, false, weatherAt),
    front: weather(width, height, horizon, held, true, weatherAt),
    panning: pan > 0,
    upcoming: () => sceneryOf(width, height, horizon, (leg + 1) * LEG_MS, daylight, (leg + 1) * LEG_MS, pans),
    still: `${key}:${daylight}:${pan * stretch}:${sky}`,
    behind: `${key}:${daylight}:${pan * stretch}:${sky}:${held}`,
  }
}

/** A shape's middle across. */
const middleOf = (shape: Shape): number => {
  const points = shape.points
  if (points === undefined || points.length === 0) return shape.x + shape.w / 2

  return points.reduce((sum, [x]) => sum + x, 0) / points.length
}

/**
 * The land's still shapes (with its texture, or without) lit for the hour,
 * each by the light at its middle, the ground (the first) stop by stop of its
 * gradient: for a drawing that cannot grade its pixels as `litAt` says.
 */
export const litStill = (land: Land, texture = true): Shape[] =>
  (texture ? land.still : land.still.slice(0, land.still.length - land.detail)).map((shape, index) => {
    if (index > 0 || shape.grad === undefined) return relit([shape], land.litAt(middleOf(shape)).grade)[0] ?? shape
    const stops = shape.grad.stops.map(([at, colour, alpha]) => {
      const grade = land.litAt(at * land.span).grade

      return [at, grade === undefined ? colour : graded(colour, grade), alpha] as const
    })

    return { ...shape, grad: { ...shape.grad, stops } }
  })

/** The land's night lights as bright as each is now: none by day. */
export const litLights = (land: Land): Shape[] =>
  land.lights.flatMap(shape => {
    const glow = land.litAt(middleOf(shape)).glow

    return glow > 0.01 ? [{ ...shape, alpha: (shape.alpha ?? 1) * glow }] : []
  })

/** The still land as last made, by key: made once, not every frame. */
const made = new Map<string, { shapes: Shape[]; detail: number; lights: Shape[] }>()

/** `map`'s value at `key`, else made (and kept); the `most` used last kept, the rest let go. */
export const keptIn = <T>(map: Map<string, T>, key: string, make: () => T, most = 8): T => {
  const value = map.get(key) ?? make()
  map.delete(key)
  map.set(key, value)
  for (const old of map.keys()) if (map.size > most) map.delete(old)

  return value
}
