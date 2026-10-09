import { chain, rasterOf, rotate, scale, translate } from './clawd-vector'
import type { Shape } from './clawd-vector'
import { BOX_ROWS, HAT_X, SKY } from './mascot-sprites'
import type { MascotRole } from './scene-types'
import { EYE, accessoryShapes, browLine, crownShapes, figureShapes, propellerShapes, shade, strokeShapes, usagiHatShapes, usagiMouthShapes } from './smooth-art'
import type { FigureInfo } from './smooth-art'
import { base64Of, pngOf } from './png'
import { NEUTRAL } from './smooth-pose'
import { capOf, clawdEyesOf, usagiEyesOf } from './tv-figure'
import type { Eyes, Who } from './tv-figure'
import type { TvInputs, TvLayout } from './tv-model'
import { ROLE_HATS, USAGI } from './usagi-sprites'
import type { HatName } from './usagi-sprites'

// The TV a pressed mascot becomes, drawn smooth (the vector art,
// hooks/smooth-art.ts) where the layout (hooks/tv-model.ts) places the block
// giant (hooks/tv-figure.ts): its body the casing, the TV on its forehead,
// its eyes under the TV, its arms, legs and what it wears around it; and on
// its way there, the scene's own figure flying in and growing. In the
// region's pixels, a cell 8 across and 16 down. In a terminal that shows
// pictures the hooks draw the giant alone as one (`giantPicture`), the TV's
// module drawing its glass over it.

const CW = 8
const CH = 16

/** Each role by the hat it wears: what the scene's figure needs to wear it. */
const ROLE_OF_HAT: ReadonlyMap<HatName, MascotRole> = new Map((Object.entries(ROLE_HATS) as [MascotRole, HatName][]).map(([role, hat]) => [hat, role]))

/** Who is in the TV as the scene's figure takes it. */
const infoOf = (who: Who): FigureInfo => ({
  character: who.character,
  colour: who.colour,
  energy: 0,
  ...(who.crown === true ? { crown: true as const } : {}),
  ...(who.accessory === undefined ? {} : { accessory: who.accessory, side: who.side ?? 'left' }),
  ...(who.hat === undefined ? {} : { role: ROLE_OF_HAT.get(who.hat) as MascotRole }),
})

/**
 * The scene's figure: its width and height in units with what it wears over
 * its head (its middle across at 0), how far of that is under its feet (its
 * line), and how many rows down its sprite its feet stand.
 */
const FIGURE = {
  clawd: { w: 16, h: 14, below: 0, feet: SKY + BOX_ROWS - 0.5 },
  usagi: { w: 11.5, h: 20.2, below: 0.45, feet: SKY + BOX_ROWS },
} as const

/** The propeller's turn, radians, by the TV's blade frame. */
const turnOf = (spin: number): number => spin * 1.1

/** The layout's boxes in the region's pixels. */
const pixelsOf = (layout: TvLayout) => {
  const left = layout.left * CW
  const top = layout.top * CH
  const body = { x: left + layout.body.x * CW, y: top + layout.body.y * CH, w: layout.body.w * CW, h: layout.body.h * CH }

  return { left, top, right: left + layout.width * CW, bottom: top + layout.height * CH, body, eyes: top + (layout.tv.y + layout.tv.h + 1) * CH }
}

/** Clawd's eyes under the TV: tall, notched dark as its head has them; wide, bigger; shut, a line. */
const clawdEyes = (layout: TvLayout, x: number, w: number, y: number, eyes: Eyes): Shape[] => {
  const size = clawdEyesOf(layout.body.w, eyes)
  const ew = size.w * (CW / 2)
  const eh = size.h * (CH / 2)

  return [0.27, 0.73].map((at): Shape => {
    const cx = x + w * at

    return eyes === 'shut'
      ? { kind: 'rect', x: cx - ew / 2, y: y + eh / 2 - 2, w: ew, h: 4, r: 2, fill: EYE }
      : { kind: 'rect', x: cx - ew / 2, y: y - (eyes === 'wide' ? CH / 4 : 0), w: ew, h: eh, r: Math.min(ew, eh) * 0.4, fill: EYE }
  })
}

/**
 * Clawd as the TV: its legs under its body to the box's floor, its arms out
 * of its torso's top to the box's edges, its body the casing (a deeper band
 * along its bottom, a glint along its top), its eyes a row under the TV, and
 * what it wears over its head, blown up from the scene's: the crown in the
 * middle, an accessory over the corner it is worn at, in flight its
 * propeller cap.
 */
const giantClawd = (who: Who, layout: TvLayout, eyes: Eyes, spin: number, t: number): Shape[] => {
  const at = pixelsOf(layout)
  const { body } = at
  const deep = shade(who.colour, 0.18)
  const legW = layout.body.w >= 40 ? 2 * CW : CW
  const arm = { y: body.y + body.h - 2 * CH, h: CH }
  const shapes: Shape[] = [
    ...[1 / 12, 3 / 12, 8 / 12, 10 / 12].map((share): Shape => ({ kind: 'rect', x: body.x + body.w * share, y: body.y + body.h - 6, w: legW, h: at.bottom - body.y - body.h + 6, r: legW * 0.4, fill: deep })),
    { kind: 'rect', x: at.left, y: arm.y, w: body.x - at.left + 12, h: arm.h, r: arm.h * 0.45, fill: who.colour },
    { kind: 'rect', x: body.x + body.w - 12, y: arm.y, w: at.right - body.x - body.w + 12, h: arm.h, r: arm.h * 0.45, fill: who.colour },
    { kind: 'rect', x: body.x, y: body.y, w: body.w, h: body.h, r: 14, fill: who.colour },
    { kind: 'rect', x: body.x, y: body.y + body.h * 0.9, w: body.w, h: body.h * 0.1, r: 14, fill: '#000000', alpha: 0.1 },
    { kind: 'rect', x: body.x + 10, y: body.y + 5, w: body.w - 20, h: 4, r: 2, fill: '#FFFFFF', alpha: 0.16 },
    ...clawdEyes(layout, body.x, body.w, at.eyes, eyes),
  ]
  // What it wears, its scene's head (12 units across) the body's width, as tall as the rows over the head allow.
  const k = Math.max(1, Math.min(body.w / 12, (layout.body.y * CH) / 5))
  const side = who.crown === true ? 'centre' : who.accessory === undefined ? 'left' : who.side ?? 'left'
  const across = side === 'centre' ? 0 : ((HAT_X[side] - HAT_X.centre) * 2 * body.w) / 12
  const head = chain(translate(body.x + body.w / 2 + across, body.y), scale(k), translate(0, 10))
  if (who.cap === true) shapes.push(...propellerShapes(chain(head, translate(0, -10)), capOf(who), turnOf(spin)))
  else if (who.crown === true) shapes.push(...crownShapes(head, 0, -10))
  else if (who.accessory !== undefined) shapes.push(...accessoryShapes(head, who.accessory, 0, t))

  return shapes
}

/** Usagi's outline on the giant, pixels: Chiikawa's bold near-black line. */
const GIANT_LINE = 5

/** The shapes, outlined as one: each grown by the line in its colour first, then each over them. */
const outlined = (shapes: readonly Shape[]): Shape[] => [
  ...shapes.map((shape): Shape => (shape.kind === 'rect' || shape.kind === 'ellipse'
    ? { ...shape, x: shape.x - GIANT_LINE, y: shape.y - GIANT_LINE, w: shape.w + 2 * GIANT_LINE, h: shape.h + 2 * GIANT_LINE, ...(shape.kind === 'rect' ? { r: (shape.r ?? 0) + GIANT_LINE } : {}), fill: USAGI.line }
    : { ...shape, fill: USAGI.line })),
  ...shapes,
]

/** A stroke along an arc about (`cx`, `cy`), `r` out, from angle `from` to `to` (radians, y down), `width` thick, in the line's colour. */
const arc = (cx: number, cy: number, r: number, from: number, to: number, width: number): Shape => {
  const steps = 12
  const at = (index: number, out: number): readonly [number, number] => {
    const a = from + ((to - from) * index) / steps

    return [cx + (r + out) * Math.cos(a), cy + (r + out) * Math.sin(a)]
  }

  return { kind: 'poly', x: 0, y: 0, w: 0, h: 0, points: [...Array.from({ length: steps + 1 }, (_, index) => at(index, width / 2)), ...Array.from({ length: steps + 1 }, (_, index) => at(steps - index, -width / 2))], fill: USAGI.line }
}

/** A shape turned `a` radians about (`x`, `y`). */
const turned = (a: number, x: number, y: number) => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), x - x * Math.cos(a) + y * Math.sin(a), y - x * Math.sin(a) - y * Math.cos(a)] as const

/**
 * Usagi's face under the TV, as Chiikawa draws it: its dot eyes with a small
 * glint in their top right under brows arched high over them (wide, bigger,
 * the brows higher; shut, lines), its cheeks blushing pink with three short
 * dark strokes, its small cat's mouth `ω` (open, wide-eyed).
 */
const usagiFace = (x: number, w: number, y: number, eyes: Eyes): Shape[] => {
  const size = usagiEyesOf(eyes)
  const ew = size.w * (CW / 2) * 1.0
  const eh = Math.max(ew * 1.22, size.h * (CH / 2))
  const shapes: Shape[] = []
  for (const at of [0.2, 0.8]) {
    const cx = x + w * at
    const cy = y + CH * 0.9
    shapes.push({ kind: 'ellipse', x: cx - 17, y: cy - 9, w: 34, h: 18, fill: USAGI.blush, alpha: 0.95 })
    for (const dx of [-8, 0, 8]) shapes.push({ kind: 'rect', x: cx + dx - 1.6, y: cy - 5, w: 3.2, h: 10, r: 1.6, fill: USAGI.line, m: turned(0.3, cx + dx, cy) })
  }
  for (const at of [0.34, 0.66] as const) {
    const cx = x + w * at
    const cy = y + CH / 2 - (eyes === 'wide' ? CH / 4 : 0)
    if (eyes === 'shut') shapes.push({ kind: 'rect', x: cx - ew / 2, y: cy - 2.5, w: ew, h: 5, r: 2.5, fill: USAGI.eye })
    else {
      shapes.push({ kind: 'ellipse', x: cx - ew / 2, y: cy - eh / 2, w: ew, h: eh, fill: USAGI.eye })
      shapes.push({ kind: 'ellipse', x: cx + ew * 0.04, y: cy - eh * 0.36, w: ew * 0.26, h: ew * 0.26, fill: '#FFFFFF', alpha: 0.95 })
    }
    // Its brows: high over each eye (higher wide-eyed), level over the face's middle and falling away to the side.
    const side = at < 0.5 ? -1 : 1
    const top = cy - eh / 2 - eh * 1.1 - (eyes === 'wide' ? CH / 4 : 0)
    shapes.push(...strokeShapes([1, 0, 0, 1, 0, 0], browLine(cx - side * ew * 1.0, cx + side * ew * 1.5, top, eh * 0.8), 4.5, USAGI.line))
  }
  // Its mouth as the scene's, its face's units blown up as its eyes are: its cat's `ω`; wide-eyed, a small `o`.
  const k = ew / 1.2
  shapes.push(...usagiMouthShapes([k, 0, 0, k, x + w / 2, y + CH * 0.95], eyes === 'wide' ? 'o' : 'cat'))

  return shapes
}

/**
 * Usagi as the TV, as Chiikawa draws it, cream with a thin dark line round
 * it: its long ears up out of the top of its head as the TV's own rabbit
 * ears (pink inside, a V), its arms nubs at its sides by its face, its feet,
 * its round body the casing, its face under the TV; over its ears' roots
 * its role's hat (in flight its propeller cap), its ears through it; the
 * session's crown by its left ear.
 */
const giantUsagi = (who: Who, layout: TvLayout, eyes: Eyes, spin: number): Shape[] => {
  const at = pixelsOf(layout)
  const { body } = at
  const middle = body.x + body.w / 2
  const earW = Math.max(2 * CW, Math.min(body.w * 0.075, 5 * CW))
  const earTop = at.top + GIANT_LINE + 5
  const earLength = body.y + CH - earTop
  const silhouette: Shape[] = []
  const inside: Shape[] = []
  for (const side of [-1, 1]) {
    // About the ear's root on the head's top: together, the two a V.
    const root = { x: middle + side * earW * 0.55, y: body.y + CH }
    const turn = side * 0.16
    const m = [Math.cos(turn), Math.sin(turn), -Math.sin(turn), Math.cos(turn), root.x - root.x * Math.cos(turn) + root.y * Math.sin(turn), root.y - root.x * Math.sin(turn) - root.y * Math.cos(turn)] as const
    silhouette.push({ kind: 'rect', x: root.x - earW / 2, y: root.y - earLength, w: earW, h: earLength, r: earW / 2, fill: USAGI.cream, m })
    inside.push({ kind: 'rect', x: root.x - earW * 0.19, y: root.y - earLength + earW * 0.45, w: earW * 0.38, h: Math.max(0, earLength - earW * 0.45 - CH * 1.6), r: earW * 0.19, fill: USAGI.ear, m })
  }
  const armY = at.eyes - CH / 2
  const footW = Math.max(2 * CW, body.w / 8)
  const shapes: Shape[] = outlined([
    ...silhouette,
    { kind: 'rect', x: at.left + GIANT_LINE, y: armY, w: body.x - at.left + 16, h: 2 * CH, r: CH, fill: USAGI.cream },
    { kind: 'rect', x: body.x + body.w - 16, y: armY, w: at.right - body.x - body.w + 16 - GIANT_LINE, h: 2 * CH, r: CH, fill: USAGI.cream },
    ...[0.3, 0.7].map((share): Shape => ({ kind: 'rect', x: body.x + body.w * share - footW / 2, y: body.y + body.h - 8, w: footW, h: at.bottom - body.y - body.h + 8 - GIANT_LINE, r: footW / 2, fill: USAGI.cream })),
    { kind: 'rect', x: body.x, y: body.y, w: body.w, h: body.h, r: Math.min(body.w, body.h) * 0.2, fill: USAGI.cream },
  ])
  // The ears' pink inside, over their own but under the head (the casing laid again over their roots).
  shapes.splice(shapes.length - 1, 0, ...inside)
  shapes.push(...usagiFace(body.x, body.w, at.eyes, eyes))
  // What it wears, blown up evenly from the scene's: as big as the rows over its head hold its ears (7.8 units), its head (10.6) the body's width at most.
  const k = Math.max(1, Math.min(body.w / 10.6, (body.y - at.top) / 7.8))
  const head = chain(translate(middle, body.y), scale(k), translate(0, 10))
  if (who.cap === true) shapes.push(...propellerShapes(chain(head, translate(0, -10)), capOf(who), turnOf(spin)))
  else if (who.hat !== undefined) shapes.push(...usagiHatShapes(head, who.hat))
  if (who.crown === true && who.cap !== true) shapes.push(...crownShapes(chain(translate(middle - earW * 1.6, body.y + 0.5 * k), scale(k), rotate(-0.35)), 0, 0, 0.9))

  return shapes
}

/** The smooth giant's casing colour: Clawd's own, Usagi's cream (the glass's round rows sit on it). */
export const casingOf = (who: Who): string => (who.character === 'usagi' ? USAGI.cream : who.colour)

/** The giant for a frame: Clawd's or Usagi's, eyes as asked, a propeller's blade turned `spin` frames. */
export const giantShapes = (who: Who, layout: TvLayout, eyes: Eyes = 'open', spin = 0, t = 0): Shape[] =>
  who.character === 'usagi' ? giantUsagi(who, layout, eyes, spin) : giantClawd(who, layout, eyes, spin, t)

/**
 * The scene's figure on its way, as the vector art draws it: its middle
 * `travel` of the way from where it stood (its body's left at `from`, its
 * sprite's top row) to the giant's, blown up `scale` of the way from its
 * scene size to as big as the giant's box holds it, its proportions kept;
 * eyes wide; in flight, its propeller cap turning.
 */
export const spriteShapes = (inputs: Pick<TvInputs, 'layout' | 'from' | 'who'>, travel: number, scaleBy: number, eyes: Eyes, t: number): Shape[] => {
  const { layout, who } = inputs
  const figure = FIGURE[who.character]
  // Its scene size, 4 pixels a unit, as the scene draws it; grown, as big as the giant's box holds it.
  const k = 4 + (Math.min((layout.width * CW) / figure.w, (layout.height * CH) / figure.h) - 4) * scaleBy
  const centre = { x: (layout.left + layout.width / 2) * CW, y: (layout.top + layout.height / 2) * CH }
  // Where it stood: its middle 4.5 cells from its body's left, its feet `figure.feet` rows down its sprite.
  const start = inputs.from === undefined ? centre : { x: (inputs.from.x + 4.5) * CW, y: (inputs.from.y + figure.feet) * CH - (figure.h / 2 - figure.below) * 4 }
  const x = start.x + (centre.x - start.x) * travel
  const y = start.y + (centre.y - start.y) * travel
  const pose = { ...NEUTRAL, eyes: eyes === 'wide' ? 'wide' as const : 'normal' as const, eyeOpen: eyes === 'shut' ? 0.08 : 1, ...(who.cap === true ? { cap: (t / 1000) * 30 } : {}) }

  return figureShapes(pose, infoOf(who), chain(translate(x, y + (figure.h / 2 - figure.below) * k), scale(k)), t)
}

/** The giant as a picture of its box (a cell 8 by 16 pixels), as the desktop draws it, still: a PNG, base64. */
export const giantPicture = (who: Who, layout: TvLayout, eyes: Eyes, scheme: 'dark' | 'light' = 'dark'): string => {
  const width = Math.max(1, layout.width) * CW
  const height = Math.max(1, layout.height) * CH
  const pixels = rasterOf(giantShapes(who, layout, eyes), width, height, translate(-layout.left * CW, -layout.top * CH), undefined, scheme)

  return base64Of(pngOf(pixels, width, height))
}
