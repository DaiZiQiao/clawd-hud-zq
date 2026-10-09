import { CLAWD, propShapes } from './clawd-moves'
import { about, chain, multiply, rotate, scale, translate } from './clawd-vector'
import type { Matrix, Shape } from './clawd-vector'
import { ACCESSORIES, BLANKET, CROWN, LAPTOP_COLOUR } from './mascot-sprites'
import type { Accessory } from './mascot-sprites'
import { textWidth } from './raster-font'
import type { Beside, FigurePose } from './smooth-pose'
import type { Energy, MascotRole } from './scene-types'
import { CAP, HATS, ROLE_HATS, USAGI } from './usagi-sprites'
import type { HatName } from './usagi-sprites'

// The smooth mascots' art: Clawd and Usagi drawn as shapes from a pose
// (hooks/smooth-pose.ts), full size or as a child's mini, with what they wear
// and what is beside them. Local units, the origin between the feet on the
// floor, y down; a cell is 2 units across and 4 down. Clawd keeps Claude
// Code's own proportions (its logo's 18 by 6 quadrants); Usagi Chiikawa's:
// a big round head on a smaller round body, long ears close together, a thin
// dark line round it all.

/** Who a mascot is and what it wears. */
export type FigureInfo = {
  character: 'clawd' | 'usagi'
  /** Its body's colour (Clawd's; Usagi is always its own pale yellow). */
  colour: string
  role?: MascotRole
  letter?: string
  accessory?: Accessory
  side?: 'left' | 'right'
  /** The session's own: the crown. */
  crown?: true
  energy: Energy
}

export const EYE = '#2A1712'
const PAPER = CLAWD.paper
const EDGE = CLAWD.edge
const SPARK = 'warning'

const wave = (t: number, period: number, phase = 0): number => Math.sin((2 * Math.PI * t) / period + phase)

/** A colour `k` of the way to black: a leg's shade of its body. */
export const shade = (hex: string, k: number): string => {
  const n = Number.parseInt(hex.slice(1, 7), 16)
  if (!hex.startsWith('#') || !Number.isFinite(n)) return hex
  const part = (shift: number): string => Math.round(((n >> shift) & 255) * (1 - k)).toString(16).padStart(2, '0')

  return `#${part(16)}${part(8)}${part(0)}`
}

/** A four-pointed spark, `size` across. */
export const sparkShapes = (x: number, y: number, size: number, angle: number, fill = SPARK, alpha = 1): Shape[] => {
  const m = chain(translate(x, y), rotate(angle))

  return [0, Math.PI / 2].map((turn): Shape => ({ kind: 'ellipse', x: -size / 2, y: -size * 0.12, w: size, h: size * 0.24, fill, alpha, m: multiply(m, rotate(turn)) }))
}

/** A check mark, `size` tall, its bend at the origin. */
export const tickShapes = (m: Matrix, fill: string, size = 2.6): Shape[] => [
  { kind: 'rect', x: -size * 0.45, y: -size * 0.12, w: size * 0.5, h: size * 0.24, r: size * 0.12, fill, m: multiply(m, rotate(0.8)) },
  { kind: 'rect', x: -size * 0.1, y: -size * 0.12, w: size * 0.95, h: size * 0.24, r: size * 0.12, fill, m: multiply(m, rotate(-0.95)) },
]

/** A cross, `size` across. */
export const crossShapes = (m: Matrix, fill: string, size = 2.4): Shape[] =>
  [0.785, -0.785].map((turn): Shape => ({ kind: 'rect', x: -size / 2, y: -size * 0.12, w: size, h: size * 0.24, r: size * 0.12, fill, m: multiply(m, rotate(turn)) }))

// --- what it wears -------------------------------------------------------------------

/** Where a hat sits along the head's top: its left corner, centre, right corner (Clawd's HAT_X, in units). */
const HAT_AT = { left: -4, centre: 0, right: 4 } as const

/** The session's crown, three points on a band, about `x`, its band on the head's top `y`. */
export const crownShapes = (m: Matrix, x: number, y: number, size = 1): Shape[] => {
  const k = chain(m, translate(x, y), scale(size))
  const gold = CROWN.colour

  return [
    { kind: 'rect', x: -2.3, y: -1.2, w: 4.6, h: 1.3, r: 0.25, fill: gold, m: k },
    { kind: 'poly', x: 0, y: 0, w: 0, h: 0, points: [[-2.3, -1.1], [-1.6, -3.2], [-0.9, -1.1]], fill: gold, m: k },
    { kind: 'poly', x: 0, y: 0, w: 0, h: 0, points: [[-0.75, -1.1], [0, -3.6], [0.75, -1.1]], fill: gold, m: k },
    { kind: 'poly', x: 0, y: 0, w: 0, h: 0, points: [[0.9, -1.1], [1.6, -3.2], [2.3, -1.1]], fill: gold, m: k },
    { kind: 'ellipse', x: -0.35, y: -0.95, w: 0.7, h: 0.7, fill: '#D05454', m: k },
  ]
}

/** Clawd's accessory on its head's top at `x`. */
export const accessoryShapes = (m: Matrix, name: Accessory, x: number, t: number): Shape[] => {
  const colour = ACCESSORIES[name].colour
  const k = chain(m, translate(x, -10))
  switch (name) {
    case 'beanie':
      return [
        { kind: 'ellipse', x: -2.1, y: -2.5, w: 4.2, h: 3.4, fill: colour, m: k },
        { kind: 'rect', x: -2.3, y: -0.9, w: 4.6, h: 1, r: 0.4, fill: '#B04646', m: k },
        { kind: 'ellipse', x: -0.7, y: -3.6, w: 1.4, h: 1.4, fill: '#F2ECE1', m: k },
      ]
    case 'cap':
      return [
        { kind: 'ellipse', x: -2, y: -2.4, w: 4, h: 3.2, fill: colour, m: k },
        { kind: 'rect', x: x < 0 ? -4 : 0.5, y: -0.9, w: 3.5, h: 0.8, r: 0.35, fill: '#2C7046', m: k },
      ]
    case 'tophat':
      return [
        { kind: 'rect', x: -1.5, y: -4.2, w: 3, h: 3.6, r: 0.3, fill: colour, m: k },
        { kind: 'rect', x: -1.5, y: -1.6, w: 3, h: 0.6, fill: '#D05454', m: k },
        { kind: 'rect', x: -2.4, y: -0.8, w: 4.8, h: 0.8, r: 0.35, fill: colour, m: k },
      ]
    case 'flower':
      return [
        ...[0, 1, 2, 3, 4].map((petal): Shape => ({ kind: 'ellipse', x: -0.65, y: -2.1, w: 1.3, h: 1.9, fill: colour, m: chain(k, translate(0, -1.4), rotate((petal * 2 * Math.PI) / 5), translate(0, 0.3)) })),
        { kind: 'ellipse', x: -0.6, y: -2, w: 1.2, h: 1.2, fill: '#FFD27A', m: k },
      ]
    case 'bow':
      return [
        { kind: 'poly', x: 0, y: 0, w: 0, h: 0, points: [[0, -1.4], [-2.4, -2.6], [-2.4, -0.2]], fill: colour, m: k },
        { kind: 'poly', x: 0, y: 0, w: 0, h: 0, points: [[0, -1.4], [2.4, -2.6], [2.4, -0.2]], fill: colour, m: k },
        { kind: 'ellipse', x: -0.65, y: -2.05, w: 1.3, h: 1.3, fill: '#A84A34', m: k },
      ]
    case 'halo':
      return [{ kind: 'ellipse', x: -2.6, y: -3.3 - 0.3 * wave(t, 1600), w: 5.2, h: 1.6, ring: 0.45, fill: '#D9B45A', m: k }]
    case 'note': {
      const bob = chain(k, translate(0, -0.4 * Math.abs(wave(t, 1200))))

      return [
        { kind: 'ellipse', x: -2, y: -1.4, w: 1.5, h: 1.1, fill: colour, m: bob },
        { kind: 'ellipse', x: 0.4, y: -1.9, w: 1.5, h: 1.1, fill: colour, m: bob },
        { kind: 'rect', x: -0.7, y: -4.6, w: 0.35, h: 3.6, fill: colour, m: bob },
        { kind: 'rect', x: 1.7, y: -5.1, w: 0.35, h: 3.6, fill: colour, m: bob },
        { kind: 'poly', x: 0, y: 0, w: 0, h: 0, points: [[-0.7, -4.6], [2.05, -5.1], [2.05, -4.2], [-0.7, -3.7]], fill: colour, m: bob },
      ]
    }
    case 'propeller':
      return propellerShapes(k, colour, t / 1000 * 4)
  }
}

/** A propeller cap: the cap, its stalk and two blades turning (`turn`, radians). */
export const propellerShapes = (k: Matrix, colour: string, turn: number): Shape[] => {
  const spread = Math.abs(Math.cos(turn))

  return [
    { kind: 'ellipse', x: -2, y: -2.2, w: 4, h: 3, fill: colour, m: k },
    { kind: 'rect', x: -0.2, y: -3.6, w: 0.4, h: 1.6, fill: '#3E4A57', m: k },
    { kind: 'ellipse', x: -3.2 * spread, y: -4.2, w: 6.4 * spread + 0.4, h: 0.9, fill: '#D05454', m: k },
    { kind: 'ellipse', x: -0.45, y: -4.1, w: 0.9, h: 0.7, fill: '#3E4A57', m: k },
  ]
}

/** One effort mark or two at the head's other end from the hat. */
const energyShapes = (m: Matrix, energy: Energy, at: 'left' | 'right', y: number, t: number): Shape[] => {
  if (energy === 0) return []
  const xs = at === 'right' ? [4.6, 6.6] : [-4.6, -6.6]

  return xs.slice(0, energy).flatMap((x, one) => sparkShapes(x, y, 1.8 + 0.25 * wave(t, 900, one), 0.3 * one).map(shape => ({ ...shape, m: multiply(m, shape.m ?? [1, 0, 0, 1, 0, 0]) })))
}

/** Usagi's hat on its head's top (its ears through the brim), by name. */
export const usagiHatShapes = (m: Matrix, name: HatName): Shape[] => {
  const hat = HATS[name]
  const main = hat.colour
  const palette = hat.palette as Readonly<Record<string, string>>
  const k = chain(m, translate(0, -10))
  switch (name) {
    case 'hardhat':
      return [
        { kind: 'ellipse', x: -3.2, y: -4.4, w: 6.4, h: 5.6, fill: main, m: k },
        { kind: 'rect', x: -7.2, y: -1.4, w: 14.4, h: 1.6, r: 0.6, fill: main, m: k },
        { kind: 'rect', x: -0.4, y: -4.2, w: 0.8, h: 2.8, r: 0.3, fill: '#E08A3E', m: k },
      ]
    case 'fedora':
      return [
        { kind: 'rect', x: -3.2, y: -4.4, w: 6.4, h: 3.6, r: 1.2, fill: main, m: k },
        { kind: 'ellipse', x: -1, y: -5, w: 2, h: 1.6, fill: '#7A5230', m: k },
        { kind: 'rect', x: -3.2, y: -2, w: 6.4, h: 1, fill: palette.D ?? '#5C3D1E', m: k },
        { kind: 'rect', x: -7.6, y: -1.2, w: 15.2, h: 1.3, r: 0.6, fill: main, m: k },
      ]
    case 'mortarboard':
      return [
        { kind: 'rect', x: -3, y: -2.6, w: 6, h: 2.6, r: 0.5, fill: '#3E62A3', m: k },
        { kind: 'poly', x: 0, y: 0, w: 0, h: 0, points: [[-7.6, -3.6], [0, -5.2], [7.6, -3.6], [0, -2]], fill: main, m: k },
        { kind: 'rect', x: 6.6, y: -3.8, w: 0.3, h: 3, fill: CROWN.colour, m: k },
        { kind: 'ellipse', x: 6.2, y: -1.2, w: 1.1, h: 1.4, fill: CROWN.colour, m: k },
      ]
    case 'helmet':
      return [
        { kind: 'ellipse', x: -3.4, y: -4.6, w: 6.8, h: 5.8, fill: main, m: k },
        { kind: 'rect', x: -7.2, y: -1.4, w: 14.4, h: 1.6, r: 0.6, fill: main, m: k },
        { kind: 'ellipse', x: -1.1, y: -3.6, w: 2.2, h: 2, fill: palette.L ?? '#FFE27A', m: k },
        { kind: 'ellipse', x: -0.5, y: -3.2, w: 1, h: 0.9, fill: '#FFFFFF', alpha: 0.8, m: k },
      ]
    case 'tophat':
      return [
        { kind: 'rect', x: -3, y: -8, w: 6, h: 7, r: 0.5, fill: main, m: k },
        { kind: 'rect', x: -3, y: -3, w: 6, h: 1.4, fill: palette.R ?? '#D05454', m: k },
        { kind: 'rect', x: -7.2, y: -1.4, w: 14.4, h: 1.5, r: 0.6, fill: main, m: k },
      ]
    case 'beret':
      return [
        { kind: 'ellipse', x: -5, y: -3.4, w: 10, h: 3.6, fill: main, m: chain(k, rotate(-0.12)) },
        { kind: 'rect', x: -0.3, y: -5, w: 0.6, h: 1.8, r: 0.3, fill: main, m: chain(k, rotate(-0.12)) },
      ]
  }
}

// --- the figures ----------------------------------------------------------------------

/**
 * The eyes of either: `cx` their centres, `y` their middle's height, `w` and
 * `h` an open eye's; `shine` a glint in each open one (Usagi's dots).
 * Squeezed shut, `> <`; smug, half lidded.
 */
const eyeShapes = (m: Matrix, pose: FigurePose, cx: readonly [number, number], y: number, w: number, h: number, fill: string, shine = false): Shape[] => {
  const shapes: Shape[] = []
  for (const [index, x0] of cx.entries()) {
    const x = x0 + pose.eyeX
    const cy = y + pose.eyeY
    switch (pose.eyes) {
      case 'squeeze': {
        // Each a chevron pointing in: `>` the left, `<` the right.
        const point = index === 0 ? 1 : -1
        const k = chain(m, translate(x + point * 0.45, cy), scale(point, 1))
        for (const turn of [0.5, -0.5]) shapes.push({ kind: 'rect', x: -1.25, y: -0.17, w: 1.25, h: 0.34, r: 0.17, fill, m: multiply(k, rotate(turn)) })
        break
      }
      case 'half':
        shapes.push({ kind: 'ellipse', x: x - w / 2, y: cy - h * 0.05, w, h: h * 0.5, fill, m })
        shapes.push({ kind: 'rect', x: x - w * 0.8, y: cy - h * 0.12, w: w * 1.6, h: 0.26, r: 0.13, fill, m })
        break
      case 'happy':
        for (const side of [-1, 1]) shapes.push({ kind: 'rect', x: -0.45, y: -0.16, w: 0.9, h: 0.32, r: 0.16, fill, m: chain(m, translate(x + side * 0.32, cy), rotate(side * 0.7)) })
        break
      case 'wide':
        shapes.push({ kind: 'ellipse', x: x - w * 0.8, y: cy - h * 0.62, w: w * 1.6, h: h * 1.24, fill, m })
        // Clawd's glint big in its top left; Usagi's a small dot in its top right.
        shapes.push(shine
          ? { kind: 'ellipse', x: x + w * 0.2, y: cy - h * 0.42, w: w * 0.34, h: w * 0.34, fill: '#FFFFFF', alpha: 0.95, m }
          : { kind: 'ellipse', x: x - w * 0.45, y: cy - h * 0.45, w: w * 0.55, h: w * 0.55, fill: '#FFFFFF', alpha: 0.9, m })
        break
      case 'spiral':
        shapes.push({ kind: 'ellipse', x: x - w * 0.8, y: cy - w * 0.8, w: w * 1.6, h: w * 1.6, ring: w * 0.35, fill, m })
        shapes.push({ kind: 'ellipse', x: x - w * 0.18, y: cy - w * 0.18, w: w * 0.36, h: w * 0.36, fill, m })
        break
      case 'down':
      case 'normal': {
        const open = Math.max(0.08, Math.min(1.2, pose.eyeOpen))
        const eh = h * open
        shapes.push({ kind: shapeOfEye(w, eh), x: x - w / 2, y: cy - eh / 2, w, h: eh, r: Math.min(w, eh) * 0.45, fill, m })
        // Its glint: a small white dot in the eye's top right.
        if (shine && open > 0.6) shapes.push({ kind: 'ellipse', x: x + w * 0.04, y: cy - eh * 0.36, w: w * 0.26, h: w * 0.26, fill: '#FFFFFF', alpha: 0.95, m })
      }
    }
  }

  return shapes
}

const shapeOfEye = (w: number, h: number): 'rect' | 'ellipse' => (h > w * 1.3 ? 'rect' : 'ellipse')

/**
 * Clawd: legs, arms, its body (a deeper band along its bottom, a glint
 * along its top), its eyes; what it wears; its laptop and its blanket.
 */
const clawdShapes = (pose: FigurePose, info: FigureInfo, t: number): Shape[] => {
  const colour = info.colour
  const body = chain(translate(pose.dx, pose.drop + 2 * pose.flat), rotate(pose.tilt), about(0, -6, rotate(pose.spin)), scale(pose.sx, pose.sy), about(0, -6, rotate(Math.PI * pose.flat)))
  const legHeight = Math.max(0, 2.2 * (1 - 0.45 * pose.tuck) * (1 - pose.hideLegs))
  const deep = colour === CLAWD.body ? CLAWD.deep : shade(colour, 0.18)
  const shapes: Shape[] = [
    ...[-5, -3, 2, 4].map((x, one): Shape => ({ kind: 'rect', x, y: -legHeight - (pose.legs[one] ?? 0), w: 1, h: legHeight, r: 0.3, fill: deep, m: body })),
    { kind: 'rect', x: -8, y: -6, w: 2.6, h: 2, r: 0.45, fill: colour, m: multiply(body, about(-6, -5, rotate(pose.armL))) },
    { kind: 'rect', x: 5.4, y: -6, w: 2.6 + 1.8 * pose.reach, h: 2, r: 0.45, fill: colour, m: multiply(body, about(6, -5, rotate(-pose.armR))) },
    { kind: 'rect', x: -6, y: -10, w: 12, h: 8, r: 0.7, fill: colour, m: body },
    { kind: 'rect', x: -6, y: -3.6, w: 12, h: 1.6, r: 0.7, fill: '#000000', alpha: 0.12, m: body },
    { kind: 'rect', x: -5.1, y: -9.55, w: 10.2, h: 0.5, r: 0.25, fill: '#FFFFFF', alpha: 0.16, m: body },
    ...eyeShapes(body, pose, [-3.5, 3.5], -7, 1, 2, EYE),
  ]
  // What it wears, riding its head: the propeller cap in flight (its hat's colour, else gold), else the crown or its accessory; its letter; its energy.
  if (!pose.hatOff) {
    const side = info.crown === true ? 'centre' : info.side ?? 'left'
    if (pose.cap !== undefined) shapes.push(...propellerShapes(chain(body, translate(HAT_AT[side] * 0.5, -10)), info.accessory === undefined ? CROWN.colour : ACCESSORIES[info.accessory].colour, pose.cap))
    else if (info.crown === true) shapes.push(...crownShapes(body, 0, -10))
    else if (info.accessory !== undefined) shapes.push(...accessoryShapes(body, info.accessory, HAT_AT[side], t))
    if (info.letter !== undefined) shapes.push({ kind: 'text', x: 0, y: -10.8, w: 0, h: 0, text: info.letter, size: 3.4, bold: true, fill: 'text', m: body })
    shapes.push(...energyShapes(body, info.energy, side === 'right' ? 'left' : 'right', -11.4, t))
  } else if (info.crown === true || info.accessory !== undefined) {
    // Knocked flat: its hat on the floor beside it.
    const floor = chain(translate(pose.dx + 9.5, 0), rotate(0.4))
    shapes.push(...(info.crown === true ? crownShapes(floor, 0, 0, 0.8) : accessoryShapes(chain(floor, translate(0, 10)), info.accessory ?? 'beanie', 0, t)))
  }

  return shapes
}

/**
 * Usagi's legs sprinting, as a cartoon's run: a pale blur of a wheel under
 * it, dashes turning round its rim, and four legs turning about its hip five
 * times a second, each a foot's darker tip; `run` strong.
 */
const wheelShapes = (body: Matrix, run: number, t: number): Shape[] => {
  const turn = (t / 1000) * 2 * Math.PI * 5
  const hip = chain(body, translate(0, -2.2))
  const tip = shade(USAGI.cream, 0.2)

  return [
    { kind: 'ellipse', x: -3.3, y: -5.3, w: 6.6, h: 6.4, fill: '#FFF7DC', alpha: 0.55 * run, m: body },
    // Dashes round the rim, turning with it.
    ...[0, 1, 2, 3, 4, 5].map((one): Shape => ({ kind: 'rect', x: -0.6, y: -3.45, w: 1.2, h: 0.3, r: 0.15, fill: tip, alpha: 0.6 * run, m: multiply(hip, rotate(turn * 0.8 + (one * Math.PI) / 3)) })),
    ...[0, 1, 2, 3].flatMap((leg): Shape[] => {
      const m = multiply(hip, rotate(turn + (leg * Math.PI) / 2))
      const alpha = run * (leg % 2 === 0 ? 1 : 0.6)

      return [
        { kind: 'rect', x: -1.1, y: -0.25, w: 2.2, h: 3.4, r: 1.1, fill: USAGI.line, alpha, m },
        { kind: 'rect', x: -0.85, y: 0, w: 1.7, h: 2.9, r: 0.85, fill: USAGI.cream, alpha, m },
        { kind: 'ellipse', x: -0.8, y: 2.2, w: 1.6, h: 1, fill: tip, alpha, m },
      ]
    }),
  ]
}

/** Usagi's mouths as Chiikawa draws them: its cat's `ω` at rest, wide open shouting, a small round `o`, smug, a grin. */
export type UsagiMouth = 'cat' | 'scream' | 'o' | 'smirk' | 'grin'

/** Its mouth for a pose: as the pose says, else wide open past `mouth` 0.45, a grin with its eyes happy, else its `ω`. */
export const usagiMouthOf = (pose: FigurePose): { kind: UsagiMouth; open: number } => {
  const open = Math.max(0, Math.min(1, pose.mouth))
  const kind: UsagiMouth = pose.mouthShape === 'dot' ? 'cat' : pose.mouthShape ?? (open > 0.45 ? 'scream' : pose.eyes === 'happy' ? 'grin' : 'cat')

  return { kind, open }
}

/**
 * Usagi's mouth about its middle, in its face's units, drawn in its line:
 * its cat's `ω`, the ends curling up past its middle; shouting, wide open,
 * tall and round, outlined, its tongue at the bottom (`open` how wide); a
 * small round `o`; smug, a sideways smile hooked at its end, a dot under it;
 * a grin, two peaks side by side.
 */
export const usagiMouthShapes = (m: Matrix, kind: UsagiMouth, open = 1): Shape[] => {
  switch (kind) {
    case 'cat': {
      // A flat 3: from its middle's point either side a wide shallow lobe, its end turned up; a small curve under it, its chin.
      const lobe = (side: number): (readonly [number, number])[] => Array.from({ length: 15 }, (_, index) => {
        const a = (index / 14) * Math.PI * 1.12

        return [side * (0.48 - 0.48 * Math.cos(a)), -0.04 + 0.34 * Math.sin(a)] as const
      })
      const chin = Array.from({ length: 11 }, (_, index) => {
        const a = Math.PI * (0.15 + (0.7 * index) / 10)

        return [0.42 * Math.cos(a), 0.52 + 0.17 * Math.sin(a)] as const
      })

      return [...strokeShapes(m, lobe(-1), 0.24, USAGI.line), ...strokeShapes(m, lobe(1), 0.24, USAGI.line), ...strokeShapes(m, chin, 0.2, USAGI.line)]
    }
    case 'scream': {
      const size = Math.max(0.6, open)
      const w = 1.5 * size
      const h = 2 * size
      const mouth: Shape = { kind: 'rect', x: -w / 2, y: -0.55, w, h, r: w * 0.48, fill: USAGI.mouth, m }

      return [grownBy(mouth, 0.2, USAGI.line), mouth, { kind: 'ellipse', x: -w * 0.33, y: -0.55 + h * 0.6, w: w * 0.66, h: h * 0.32, fill: USAGI.blush, m }]
    }
    case 'o': {
      const mouth: Shape = { kind: 'rect', x: -0.45, y: -0.5, w: 0.9, h: 1.15, r: 0.45, fill: USAGI.mouth, m }

      return [grownBy(mouth, 0.18, USAGI.line), mouth]
    }
    case 'smirk':
      return [
        ...strokeShapes(m, [[-0.7, -0.02], [-0.42, 0.17], [0, 0.24], [0.36, 0.15], [0.6, -0.06], [0.55, -0.3]], 0.26, USAGI.line),
        { kind: 'ellipse', x: -0.15, y: 0.5, w: 0.26, h: 0.26, fill: USAGI.line, m },
      ]
    case 'grin':
      return [-1, 1].flatMap(side => strokeShapes(m, [[side * 0.04, 0.28], [side * 0.43, -0.22], [side * 0.84, 0.28]], 0.26, USAGI.line))
  }
}

/** Asleep: a bubble from Usagi's nose, swelling and shrinking with each breath, a glint on it. */
const noseBubbleShapes = (body: Matrix, t: number): Shape[] => {
  const swell = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 2600)
  const r = 0.35 + 1.5 * swell
  const cx = 1.4 + 0.8 * r
  const cy = -6.3 - 0.5 * r

  return [
    { kind: 'ellipse', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, fill: '#CDEBFF', alpha: 0.45, m: body },
    { kind: 'ellipse', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, ring: 0.16, fill: '#7FC8F8', alpha: 0.9, m: body },
    { kind: 'ellipse', x: cx - r * 0.55, y: cy - r * 0.6, w: r * 0.45, h: r * 0.35, fill: '#FFFFFF', alpha: 0.85, m: body },
  ]
}

/** Usagi's outline's width, units: Chiikawa's bold near-black line. */
const LINE = 0.45

/** A shape grown `g` all round, in `fill`: its outline, laid under it. */
const grownBy = (shape: Shape, g: number, fill: string): Shape =>
  shape.kind === 'rect' || shape.kind === 'ellipse'
    ? { ...shape, x: shape.x - g, y: shape.y - g, w: shape.w + 2 * g, h: shape.h + 2 * g, ...(shape.kind === 'rect' ? { r: (shape.r ?? 0) + g } : {}), fill }
    : { ...shape, fill }

/** A thin stroke along an arc about (`cx`, `cy`), `r` out, from angle `from` to `to` (radians, y down), `width` thick. */
const arcShapes = (m: Matrix, cx: number, cy: number, r: number, from: number, to: number, width: number, fill: string): Shape[] => {
  const steps = 8
  const at = (index: number, out: number): readonly [number, number] => {
    const a = from + ((to - from) * index) / steps

    return [cx + (r + out) * Math.cos(a), cy + (r + out) * Math.sin(a)]
  }
  const outer = Array.from({ length: steps + 1 }, (_, index) => at(index, width / 2))
  const inner = Array.from({ length: steps + 1 }, (_, index) => at(steps - index, -width / 2))

  return [{ kind: 'poly', x: 0, y: 0, w: 0, h: 0, points: [...outer, ...inner], fill, m }]
}

/** A stroke `width` thick along a line of points, its ends round. */
export const strokeShapes = (m: Matrix, points: readonly (readonly [number, number])[], width: number, fill: string): Shape[] => {
  const last = points.length - 1
  if (last < 1) return []
  // Each point pushed half the width out either side, square to the line there.
  const edge = (index: number, sign: number): readonly [number, number] => {
    const [x, y] = points[index] ?? [0, 0]
    const [ax, ay] = points[Math.max(0, index - 1)] ?? [x, y]
    const [bx, by] = points[Math.min(last, index + 1)] ?? [x, y]
    const length = Math.hypot(bx - ax, by - ay) || 1

    return [x - (sign * (by - ay) * width) / (2 * length), y + (sign * (bx - ax) * width) / (2 * length)]
  }
  const band = [...points.map((_, index) => edge(index, 1)), ...points.map((_, index) => edge(last - index, -1))]
  const ends = [points[0], points[last]].map(([x, y] = [0, 0]): Shape => ({ kind: 'ellipse', x: x - width / 2, y: y - width / 2, w: width, h: width, fill, m }))

  return [{ kind: 'poly', x: 0, y: 0, w: 0, h: 0, points: band, fill, m }, ...ends]
}

/**
 * A brow's line, as Chiikawa draws Usagi's: a quarter of an ellipse, level
 * at its end near the face's middle (`inner`, at `top`), curving down ever
 * faster to the side till it falls straight (`outer`, `drop` lower). Points
 * from the inner end out.
 */
export const browLine = (inner: number, outer: number, top: number, drop: number): (readonly [number, number])[] =>
  Array.from({ length: 15 }, (_, index) => {
    const turn = (index / 14) * (Math.PI / 2)

    return [inner + (outer - inner) * Math.sin(turn), top + drop * (1 - Math.cos(turn))] as const
  })

/** A cheek's blush: a pink oval, three short dark strokes on it. */
const blushShapes = (m: Matrix, cx: number, cy: number): Shape[] => [
  { kind: 'ellipse', x: cx - 1.25, y: cy - 0.72, w: 2.5, h: 1.44, fill: USAGI.blush, alpha: 0.95, m },
  ...[-0.55, 0, 0.55].map((dx): Shape => ({ kind: 'rect', x: -0.11, y: -0.38, w: 0.22, h: 0.76, r: 0.11, fill: USAGI.line, m: chain(m, translate(cx + dx, cy + 0.04), rotate(0.3)) })),
]

/** Its tail, at its back as it goes: a white puff, its edge tufted in short dark strokes, `alpha` seen. */
const tailShapes = (m: Matrix, cx: number, cy: number, alpha: number): Shape[] => [
  { kind: 'ellipse', x: cx - 0.9, y: cy - 0.9, w: 1.8, h: 1.8, fill: '#FFFFFF', alpha, m },
  ...Array.from({ length: 12 }, (_, index): Shape => {
    const a = (index * Math.PI) / 6

    return { kind: 'rect', x: -0.08, y: -0.27, w: 0.16, h: 0.42, r: 0.08, fill: USAGI.line, alpha, m: chain(m, translate(cx + 1.02 * Math.cos(a), cy + 1.02 * Math.sin(a)), rotate(a + Math.PI / 2 + (index % 2 === 0 ? 0.25 : -0.25))) }
  }),
]

/**
 * Usagi as Chiikawa draws it: a big round head on a small round body, its
 * long ears together (pink inside; lowered squatting, trailing a walk,
 * drooping slumped), its little feet, its hands nubs at its sides (raised
 * beside its face, out to its laptop), a thin dark line round it all; its dot
 * eyes with a glint under fine brows, its hatched pink cheeks, its small
 * mouth (wide open shouting); its hat (its ears through it), side crown,
 * energy.
 */
const usagiShapes = (pose: FigurePose, info: FigureInfo, t: number): Shape[] => {
  const hat = info.role === undefined || pose.hatOff || pose.cap !== undefined ? undefined : ROLE_HATS[info.role]
  const flat = pose.flat
  const body = chain(translate(pose.dx, pose.drop), rotate(pose.tilt), about(0, -6.2, rotate(pose.spin)), scale(pose.sx, pose.sy * (1 - 0.45 * flat)))
  // Its ears stand through a hat; only bare (no hat, no crown) do they droop.
  const earsDown = hat === undefined ? Math.max(pose.earsDown, 0) : 0
  const droop = hat === undefined && info.crown !== true ? pose.droop : 0
  const earLength = 7.8 - 3 * earsDown
  // Its silhouette, outlined as one: the outlines first, then the parts over them.
  const lines: Shape[] = []
  const parts: Shape[] = []
  const part = (shape: Shape): void => {
    lines.push(grownBy(shape, LINE, USAGI.line))
    parts.push(shape)
  }
  const inside: Shape[] = []
  for (const side of [-1, 1]) {
    const turn = side * 0.05 + 0.3 * pose.trail + side * (1.9 * droop + 1.45 * flat + (side < 0 ? pose.earL : pose.earR))
    // Close together, their lines touching.
    const ear = multiply(body, about(side * 0.95, -11.4, rotate(turn)))
    part({ kind: 'rect', x: side * 0.95 - 0.85, y: -11.4 - earLength, w: 1.7, h: earLength + 0.4, r: 0.85, fill: USAGI.cream, m: ear })
    inside.push({ kind: 'rect', x: side * 0.95 - 0.45, y: -10.95 - earLength, w: 0.9, h: Math.max(0.6, earLength - 2.2), r: 0.45, fill: USAGI.ear, m: ear })
  }
  const footHeight = Math.max(0, 1.2 * (1 - 0.45 * pose.tuck) * (1 - pose.hideLegs) * (1 - pose.run))
  for (const [index, x] of [[0, -1.3], [1, 1.3]] as const) {
    if (footHeight > 0.05) part({ kind: 'rect', x: x - 0.85, y: -footHeight - (pose.legs[index] ?? 0), w: 1.7, h: footHeight, r: Math.min(0.7, footHeight / 2), fill: USAGI.cream, m: body })
  }
  // Its body, small under its big head: some three fifths of the head's height, a little over half its width.
  part({ kind: 'ellipse', x: -2.88, y: -5.53, w: 5.76, h: 5.18, fill: USAGI.cream, m: body })
  part({ kind: 'ellipse', x: -5.3, y: -12.7, w: 10.6, h: 8.6, fill: USAGI.cream, m: body })
  // Its hands: nubs sticking out of its sides under its cheeks, raised beside its face, out to its laptop. At rest their
  // line is the silhouette's, under its body (only what sticks out is outlined); raised, in front of it, their line over it.
  const hands = [-1, 1].map(side => {
    const raise = side === -1 ? pose.armL : pose.armR
    const reach = side === 1 ? pose.reach : 0
    const hand = multiply(body, chain(translate(side * 2.55, -4.1), scale(side, 1), rotate(0.35 * (1 - reach) - raise)))
    const nub: Shape = { kind: 'rect', x: -0.9, y: -0.65, w: 2.5 + 3 * reach, h: 1.3, r: 0.65, fill: USAGI.cream, m: hand }

    return { nub, line: grownBy(nub, LINE, USAGI.line), front: Math.max(0, Math.min(1, (raise - 0.45) / 0.6)) }
  })
  const shapes: Shape[] = [...lines, ...hands.map(one => one.line), ...parts.slice(0, 2), ...inside, ...parts.slice(2)]
  for (const { nub, line, front } of hands) shapes.push(...(front > 0.01 ? [{ ...line, alpha: front }] : []), nub)
  // Going, its tail shows at its back: a white puff out of its side.
  const going = Math.min(1, Math.abs(pose.trail) / 1.5)
  if (going > 0.05) shapes.push(...tailShapes(body, Math.sign(pose.trail) * 2.95, -2.4, going))
  // Sprinting: its legs a spinning wheel under it, a blur and four legs turning five times a second.
  if (pose.run > 0.05) shapes.unshift(...wheelShapes(body, pose.run, t))
  // Its face: dot eyes with a small glint, its brows high over them (higher wide-eyed), level over the middle and falling
  // away to the sides, its cheeks blushing with three strokes, its mouth.
  const browTop = -10.75 + (pose.eyes === 'wide' ? -0.5 : 0)
  shapes.push(
    ...blushShapes(body, -3.7, -6.85),
    ...blushShapes(body, 3.7, -6.85),
    // Usagi never squeezes its eyes shut `> <`: through a burst its dots stay.
    ...eyeShapes(body, pose.eyes === 'squeeze' ? { ...pose, eyes: 'normal' } : pose, [-2.25, 2.25], -8.15, 0.95, 1.2, USAGI.eye, true),
    ...[-1, 1].flatMap(side => strokeShapes(body, browLine(side * 1.05 + pose.eyeX, side * 3.55 + pose.eyeX, browTop, 1.75), 0.4, USAGI.line)),
  )
  // Its mouth, turned with its eyes: small and open, wide open screaming, a round `o`, a smirk.
  if (pose.blanket < 0.5 && pose.eyes !== 'down') {
    const mouth = usagiMouthOf(pose)
    shapes.push(...usagiMouthShapes(chain(body, translate(0.5 * pose.eyeX, -6.75)), mouth.kind, mouth.open))
  }
  // Asleep: a bubble from its nose, swelling and shrinking with each breath.
  if (pose.blanket > 0.5) shapes.push(...noseBubbleShapes(chain(body, translate(-0.5, -1.4)), t))
  // What it wears on its head's top (two units over the sprite's), cut to its narrower head.
  const crown = chain(body, translate(0, -2), about(0, -10, scale(0.78, 0.9)))
  if (hat !== undefined) shapes.push(...usagiHatShapes(crown, hat))
  // The propeller cap in flight: its hat's colour, the crown's gold, or its own on a bare head.
  const capTone = info.role !== undefined ? HATS[ROLE_HATS[info.role]].colour : info.crown === true ? CROWN.colour : CAP.colour
  if (pose.cap !== undefined) shapes.push(...propellerShapes(chain(body, translate(0, -12)), capTone, pose.cap))
  if (info.crown === true && !pose.hatOff && flat < 0.5) shapes.push(...crownShapes(chain(body, translate(-3.5, -11.2), rotate(-0.35)), 0, 0, 0.62))
  if (!pose.hatOff) shapes.push(...energyShapes(body, info.energy, 'right', -13.2, t))
  // Knocked flat: its hat (or crown) on the floor beside it.
  const floor = chain(translate(pose.dx + 9, 0), rotate(0.35))
  if (pose.hatOff && info.role !== undefined) shapes.push(...usagiHatShapes(chain(floor, translate(0, 9.2), scale(0.75)), ROLE_HATS[info.role]))
  else if (pose.hatOff && info.crown === true) shapes.push(...crownShapes(floor, 0, 0, 0.8))

  return shapes
}

/** The laptop in front of it, opening (`open` 0 to 1), its screen lit, a key flickering under the near hand. */
const laptopShapes = (m: Matrix, open: number, t: number): Shape[] => {
  if (open <= 0.02) return []
  const lid = chain(m, translate(15, -1.6), scale(1, open))

  return [
    { kind: 'rect', x: -4, y: -7, w: 8, h: 7, r: 0.5, fill: LAPTOP_COLOUR, alpha: open, m: lid },
    { kind: 'rect', x: -3.3, y: -6.3, w: 6.6, h: 5.4, r: 0.3, fill: '#2B3440', alpha: open, m: lid },
    { kind: 'rect', x: -2.6, y: -5.4, w: 4.2, h: 0.5, r: 0.25, fill: '#7FC8F8', alpha: open * (0.5 + 0.3 * wave(t, 700)), m: lid },
    { kind: 'rect', x: -2.6, y: -4.2, w: 3, h: 0.5, r: 0.25, fill: '#D77757', alpha: open * 0.6, m: lid },
    { kind: 'rect', x: -2.6, y: -3, w: 3.6, h: 0.5, r: 0.25, fill: '#7FC8F8', alpha: open * 0.4, m: lid },
    { kind: 'rect', x: 9.4, y: -1.8, w: 12, h: 1.2, r: 0.5, fill: '#5F6872', alpha: open, m },
  ]
}

/** The blanket over it, breathing; its hem on the floor. */
const blanketShapes = (m: Matrix, cover: number, t: number, usagi: boolean): Shape[] => {
  if (cover <= 0.02) return []
  const rise = 0.35 * wave(t, 3200)
  const top = usagi ? -5 : -6.6

  return [
    { kind: 'rect', x: -7.6, y: top - rise, w: 15.2, h: -top + rise, r: 1.6, fill: BLANKET.colour, alpha: cover, m },
    { kind: 'rect', x: -6.8, y: top + 1.4 - rise, w: 13.6, h: 0.5, r: 0.25, fill: '#FFFFFF', alpha: 0.18 * cover, m },
    { kind: 'rect', x: -7.9, y: -1, w: 15.8, h: 1, r: 0.5, fill: '#4A6E97', alpha: cover, m },
  ]
}

// --- what is beside it ------------------------------------------------------------------

/** A cloud's rim: on a light page the cloud's own colour barely shows. */
const RIM = '#B8AE9C'

/** A cloud's lumps about its middle, `width` across, grown `g` all round. */
const lumpShapes = (m: Matrix, width: number, g: number, fill: string): Shape[] => [
  { kind: 'ellipse', x: -width / 2 - g, y: -2.6 - g, w: width + 2 * g, h: 5.2 + 2 * g, fill, m },
  { kind: 'ellipse', x: -width / 2 + 1 - g, y: -3.8 - g, w: width * 0.45 + 2 * g, h: 4.4 + 2 * g, fill, m },
  { kind: 'ellipse', x: -width * 0.05 - g, y: -3.6 - g, w: width * 0.5 + 2 * g, h: 4.2 + 2 * g, fill, m },
]

/** A bubble `d` across at `x`, `y` (its box's corner), rimmed. */
const bubbleShapes = (m: Matrix, x: number, y: number, d: number): Shape[] => [
  { kind: 'ellipse', x: x - 0.3, y: y - 0.3, w: d + 0.6, h: d + 0.6, fill: RIM, m },
  { kind: 'ellipse', x, y, w: d, h: d, fill: CLAWD.cloud, m },
]

/** A thought cloud with its phrase (or its dots), grown `grow` (0, ½, 1), rimmed. */
const thoughtShapes = (m: Matrix, text: string, grow: number, t: number): Shape[] => {
  const shapes: Shape[] = bubbleShapes(m, 5.8, -11.8, 1)
  if (grow >= 0.5) shapes.push(...bubbleShapes(m, 7.4, -14.2, 1.6))
  if (grow < 1) return shapes
  const width = Math.max(8, text.length * 1.95 + 4)
  const cx = 6 + width / 2
  const cloud = chain(m, translate(cx, -18.4))
  shapes.push(...lumpShapes(cloud, width, 0.3, RIM), ...lumpShapes(cloud, width, 0, CLAWD.cloud))
  if (text === '') {
    for (const one of [0, 1, 2]) {
      const lit = Math.max(0, Math.sin(Math.PI * ((t / 900 - one * 0.22) % 1)))
      shapes.push({ kind: 'ellipse', x: -1.65 + one * 1.3 - 0.35, y: -0.5 - 0.5 * lit, w: 0.7, h: 0.7, fill: EYE, alpha: 0.35 + 0.65 * lit, m: cloud })
    }
  } else {
    shapes.push({ kind: 'text', x: 0, y: 1.1, w: 0, h: 0, text, size: 3.1, fill: EYE, m: cloud })
  }

  return shapes
}

/**
 * A row of its box's middle from its feet, as the cells lay what is beside it
 * (row 0 the air row, −1 the sky row; hooks/mascot-sprites.ts OVERLAYS):
 * Usagi stands half a row lower in its box than Clawd (hooks/scene-smooth.ts).
 */
const rowY = (row: number, usagi: boolean): number => 4 * row - (usagi ? 14 : 12)

/** One thing beside it, in its head's frame (`m`: where it stands, lowered as it is, upright). */
const besideShapes = (one: Beside, m: Matrix, info: FigureInfo, t: number, usagi: boolean): Shape[] => {
  const row = (index: number): number => rowY(index, usagi)
  switch (one.kind) {
    case 'thought':
      return thoughtShapes(m, one.text, one.grow, t)
    case 'shout':
      return burstShapes(m, one.text, row(-1) + 1, t)
    case 'zzz':
      return [0, 1, 2].flatMap(index => {
        const phase = ((t / 2600) + index / 3) % 1
        const k = chain(m, translate(10 + 4 * phase + 0.5 * wave(t + index * 500, 1300), row(1) + (row(-1) - row(1)) * phase), scale(1 + phase))
        const alpha = Math.min(1, 2 * Math.sin(Math.PI * phase))

        return [
          { kind: 'rect', x: -0.8, y: -0.8, w: 1.6, h: 0.36, r: 0.1, fill: 'inactive', alpha, m: k },
          { kind: 'rect', x: -0.8, y: 0.44, w: 1.6, h: 0.36, r: 0.1, fill: 'inactive', alpha, m: k },
          { kind: 'rect', x: -0.98, y: -0.18, w: 1.96, h: 0.36, r: 0.1, fill: 'inactive', alpha, m: multiply(k, rotate(-0.86)) },
        ] satisfies Shape[]
      })
    case 'moon':
      return [0, 1, 2, 3, 4, 5].map((index): Shape => {
        const a = -1.1 + index * 0.44
        const size = 1.5 - Math.abs(index - 2.5) * 0.3

        return { kind: 'ellipse', x: -9 + 1.6 * Math.cos(a) - size / 2, y: row(0) - 1 + 1.8 * Math.sin(a) - size / 2, w: size, h: size, fill: 'warning', m }
      })
    case 'sweat': {
      const fall = (t % 900) / 900
      const k = chain(m, translate(usagi ? -7.4 : -6.9, -9 + 2.2 * fall))

      return [
        { kind: 'ellipse', x: -0.5, y: -0.5, w: 1, h: 1.2, fill: '#7FC8F8', alpha: 1 - fall * 0.7, m: k },
        { kind: 'poly', x: 0, y: 0, w: 0, h: 0, points: [[-0.42, -0.2], [0, -1.2], [0.42, -0.2]], fill: '#7FC8F8', alpha: 1 - fall * 0.7, m: k },
      ]
    }
    case 'clock': {
      const k = chain(m, one.floor === true ? translate(10, -1.6) : translate(10, row(0)))
      const hand = (t / 1000) * 3

      return [
        { kind: 'ellipse', x: -1.5, y: -1.5, w: 3, h: 3, fill: 'warning', m: k },
        { kind: 'ellipse', x: -1.1, y: -1.1, w: 2.2, h: 2.2, fill: '#FFF6D6', m: k },
        { kind: 'rect', x: -0.15, y: -0.95, w: 0.3, h: 1, fill: EYE, m: multiply(k, rotate(hand)) },
        { kind: 'rect', x: -0.15, y: -0.65, w: 0.3, h: 0.7, fill: EYE, m: multiply(k, rotate(hand / 12)) },
      ]
    }
    case 'ask':
      return [{ kind: 'text', x: 10, y: row(0) + 1.5 + 0.4 * wave(t, 700), w: 0, h: 0, text: '?', size: 4.4, bold: true, fill: 'claude', m }]
    case 'tick':
      return tickShapes(chain(m, translate(usagi ? 9.6 : 8.6, row(1) - 0.4)), 'success')
    case 'cross':
      return crossShapes(chain(m, translate(0, row(-1) + (usagi ? -1 : 1))), 'error')
    case 'startle': {
      const shake = 0.3 * wave(t, 120)

      return [{ kind: 'text', x: 9.4 + shake, y: row(0) + 1.4, w: 0, h: 0, text: '!?', size: 4.2, bold: true, fill: 'warning', m }]
    }
    case 'pointing':
      return [{ kind: 'poly', x: 0, y: 0, w: 0, h: 0, points: [[9.6, -6], [11.6, -4.8], [9.6, -3.6]], fill: info.colour, m }]
    case 'cigarette': {
      const glow = 0.6 + 0.4 * wave(t, 1100)

      return [
        { kind: 'rect', x: 7.6, y: -5.5, w: 3, h: 0.65, r: 0.2, fill: '#F2ECE1', m },
        { kind: 'rect', x: 10.3, y: -5.5, w: 0.55, h: 0.65, r: 0.2, fill: '#FF7A45', alpha: glow, m },
        ...[0, 1, 2].map((index): Shape => {
          const phase = ((t / 1800) + index / 3) % 1
          const size = 0.6 + 1.6 * phase

          return { kind: 'ellipse', x: 11 + 0.8 * wave(t + index * 300, 1400) - size / 2, y: -6.2 - 5 * phase - size / 2, w: size, h: size, fill: CLAWD.dust, alpha: 0.7 * (1 - phase), m }
        }),
      ]
    }
    case 'dizzy':
      return [0, 1, 2].flatMap(index => {
        const a = (t / 1000) * 3 + (index * 2 * Math.PI) / 3

        return sparkShapes(4.2 * Math.cos(a), (usagi ? -11 : -11.6) + 1.2 * Math.sin(a), 1.7, a, 'warning').map(shape => ({ ...shape, m: multiply(m, shape.m ?? [1, 0, 0, 1, 0, 0]) }))
      })
    case 'paper': {
      const k = chain(m, translate(9.4, -7.2), rotate(0.18))

      return [
        { kind: 'rect', x: -1.2, y: -1.6, w: 2.4, h: 3.2, r: 0.2, fill: PAPER, m: k },
        ...[-0.8, 0, 0.8].map((y): Shape => ({ kind: 'rect', x: -0.8, y, w: 1.6, h: 0.22, fill: EDGE, m: k })),
      ]
    }
    case 'scroll': {
      const k = chain(m, translate(9.6, -6), rotate(-0.25))

      return [
        { kind: 'rect', x: -1.8, y: -0.6, w: 3.6, h: 1.2, r: 0.3, fill: PAPER, m: k },
        { kind: 'ellipse', x: -2.2, y: -0.8, w: 0.9, h: 1.6, fill: EDGE, m: k },
        { kind: 'ellipse', x: 1.3, y: -0.8, w: 0.9, h: 1.6, fill: EDGE, m: k },
        { kind: 'rect', x: -0.25, y: -0.6, w: 0.5, h: 1.2, fill: '#D05454', m: k },
      ]
    }
    case 'baton': {
      const k = chain(m, translate(9.6, -6), rotate(-0.6))

      return [
        { kind: 'rect', x: -2, y: -0.4, w: 4, h: 0.8, r: 0.4, fill: 'claude', m: k },
        { kind: 'rect', x: 1.3, y: -0.4, w: 0.7, h: 0.8, r: 0.3, fill: '#2A2A2A', m: k },
      ]
    }
    case 'props':
      return one.props.flatMap(prop => propShapes(prop).map(shape => ({ ...shape, m: shape.m === undefined ? m : multiply(m, shape.m) })))
    case 'sparkles':
      return [0, 1, 2].flatMap(index => {
        const a = (t / 1000) * 2.2 + (index * 2 * Math.PI) / 3
        const twinkle = 1.2 + 0.6 * Math.abs(wave(t + index * 170, 420))

        return sparkShapes(8.5 * Math.cos(a), row(0) + 2 + 3.2 * Math.sin(a), twinkle, a, index === 1 ? '#F2A0AE' : 'warning').map(shape => ({ ...shape, m: multiply(m, shape.m ?? [1, 0, 0, 1, 0, 0]) }))
      })
    case 'speed':
      // Streaks behind it, flickering.
      return [-8.6, -5.8, -3].map((y, index): Shape => {
        const flicker = 0.35 + 0.45 * Math.abs(wave(t + index * 90, 260))
        const length = 3.4 + 1.6 * Math.abs(wave(t + index * 130, 340))

        return { kind: 'rect', x: one.dir > 0 ? -8.6 - length : 8.6, y, w: length, h: 0.32, r: 0.16, fill: 'inactive', alpha: flicker, m }
      })
    case 'dust': {
      // Puffs kicked up behind its feet (both sides, landing), each growing and fading.
      const sides = one.dir === 0 ? [-1, 1] : [-Math.sign(one.dir)]

      return sides.flatMap(side => [0, 1].map((index): Shape => {
        const phase = ((t / 340) + index / 2) % 1
        const size = 0.8 + 1.8 * phase

        return { kind: 'ellipse', x: side * (5.5 + 3 * phase) - size / 2, y: -size * 0.7 - 0.4 * phase, w: size, h: size * 0.75, fill: CLAWD.dust, alpha: 0.75 * (1 - phase), m }
      }))
    }
    case 'huff': {
      const phase = (t % 700) / 700

      return [0, 1].map((index): Shape => {
        const size = 0.9 + 0.7 * index + 0.8 * phase

        return { kind: 'ellipse', x: 3.4 + 2.2 * phase + index * 1.1 - size / 2, y: -6.6 - 0.8 * phase - size / 2, w: size, h: size * 0.8, fill: CLAWD.cloud, alpha: 0.85 * (1 - phase), m }
      })
    }
    case 'keys':
      // Keys flying off the laptop's deck, a spark among them.
      return [
        ...[0, 1, 2].map((index): Shape => {
          const phase = ((t / 420) + index / 3) % 1

          return { kind: 'rect', x: 11 + index * 3 + 1.5 * phase - 0.5, y: -2.4 - 4 * Math.sin(Math.PI * phase) - 0.5, w: 1, h: 0.8, r: 0.15, fill: '#C9CED6', alpha: 1 - phase * 0.6, m: chain(m, about(11 + index * 3, -2.4, rotate(phase * 3 * (index % 2 === 0 ? 1 : -1)))) }
        }),
        ...sparkShapes(13 + 2 * wave(t, 300), -5.4, 1.6 + 0.5 * Math.abs(wave(t, 170)), t / 200).map(shape => ({ ...shape, m: multiply(m, shape.m ?? [1, 0, 0, 1, 0, 0]) })),
      ]
    case 'jitter':
      // A shake's blur lines either side of it.
      return [-1, 1].flatMap(side => [-7.5, -4.5].map((y, index): Shape => ({ kind: 'rect', x: side * (8.6 + 0.4 * Math.abs(wave(t + index * 40, 80))) - 0.16, y: y - 1.2, w: 0.32, h: 2.4, r: 0.16, fill: 'inactive', alpha: 0.8, m })))
  }
}

/** A shout burst out over its head: a spiky balloon, a dark rim round it, its words bold inside; it pops in time. */
const burstShapes = (m: Matrix, text: string, y: number, t: number): Shape[] => {
  const size = 3
  const rx = textWidth(text, size) / 2 + 2
  const ry = 2.7
  const pop = 1 + 0.08 * Math.max(0, wave(t, 520))
  const k = chain(m, translate(9 + rx, y), scale(pop))
  const spikes = 11
  const layer = (grow: number, fill: string): Shape[] => [
    { kind: 'ellipse', x: -rx - grow, y: -ry - grow, w: 2 * (rx + grow), h: 2 * (ry + grow), fill, m: k },
    ...Array.from({ length: spikes }, (_, index): Shape => {
      const a = (2 * Math.PI * index) / spikes + 0.35
      const half = (Math.PI / spikes) * 0.55
      const at = (angle: number, r: number): readonly [number, number] => [Math.cos(angle) * (rx * r + grow), Math.sin(angle) * (ry * r + grow)]
      const reach = 1.4 + 0.25 * (index % 3)

      return { kind: 'poly', x: 0, y: 0, w: 0, h: 0, points: [at(a - half, 0.92), [Math.cos(a) * (rx + reach + grow * 1.6), Math.sin(a) * (ry + reach + grow * 1.6)], at(a + half, 0.92)], fill, m: k }
    }),
  ]

  return [
    ...layer(0.42, '#3B2A20'),
    ...layer(0, '#FFF8E7'),
    { kind: 'text', x: 0, y: size * 0.36, w: 0, h: 0, text, size, bold: true, fill: '#2A1712', m: k },
  ]
}

/**
 * One mascot's shapes, back to front: under its blanket's or laptop's,
 * its figure, then what is beside it, `m` placing its feet's middle (a
 * mini's scaled down).
 */
export const figureShapes = (pose: FigurePose, info: FigureInfo, m: Matrix, t: number): Shape[] => {
  const usagi = info.character === 'usagi'
  const figure = (usagi ? usagiShapes(pose, info, t) : clawdShapes(pose, info, t)).map(shape => ({ ...shape, m: shape.m === undefined ? m : multiply(m, shape.m) }))
  const ground = chain(m, translate(pose.dx, 0))
  const upright = chain(m, translate(pose.dx, pose.drop))

  return [
    ...figure,
    ...blanketShapes(chain(upright), pose.blanket, t, usagi),
    // Usagi narrower than Clawd, its laptop nearer.
    ...laptopShapes(usagi ? chain(ground, translate(-2.6, 0)) : ground, pose.laptop, t),
    ...pose.beside.flatMap(one => besideShapes(one, upright, info, t, usagi)),
  ]
}

/** The red pipe from the room's top down to its lip (`lip`, the lip's bottom), `width` across its lip, `x` its left. */
export const pipeShapes = (x: number, width: number, top: number, lip: number, colour: string, shine: string): Shape[] => {
  if (lip <= top) return []
  const shaft = width - 2

  return [
    { kind: 'rect', x: x + 1, y: top, w: shaft, h: lip - top - 3, fill: colour },
    { kind: 'rect', x: x + 1.8, y: top, w: 0.9, h: lip - top - 3, fill: shine },
    { kind: 'rect', x, y: lip - 4, w: width, h: 4, r: 0.6, fill: colour },
    { kind: 'rect', x: x + 0.8, y: lip - 3.4, w: 0.9, h: 2.8, r: 0.4, fill: shine },
    { kind: 'ellipse', x: x + 1, y: lip - 1.2, w: width - 2, h: 1.6, fill: '#000000', alpha: 0.35 },
  ]
}

/** A mark a scene lays down (`✓` a review passed, `✦` a fix's sparks, `○` a message on its way), at its cell's middle. */
export const markShapes = (ch: string, x: number, y: number, colour: string, t: number): Shape[] => {
  switch (ch) {
    case '✓':
      return tickShapes(translate(x, y + 0.6), 'success', 2.4)
    case '✦':
      return sparkShapes(x, y, 2 + 0.4 * wave(t, 500), t / 400)
    case '○': {
      const k = chain(translate(x, y + 0.4 * wave(t, 400)), rotate(0.08 * wave(t, 700)))

      return [
        { kind: 'rect', x: -1.6, y: -1.1, w: 3.2, h: 2.2, r: 0.3, fill: PAPER, m: k },
        { kind: 'poly', x: 0, y: 0, w: 0, h: 0, points: [[-1.5, -1], [0, 0.2], [1.5, -1]], fill: EDGE, m: k },
      ]
    }
    case '▸':
      return [{ kind: 'poly', x: 0, y: 0, w: 0, h: 0, points: [[x - 0.8, y - 1.2], [x + 1.2, y], [x - 0.8, y + 1.2]], fill: colour }]
    default:
      return [{ kind: 'text', x, y: y + 1.2, w: 0, h: 0, text: ch, size: 3.2, fill: colour.startsWith('#') ? colour : 'text' }]
  }
}
