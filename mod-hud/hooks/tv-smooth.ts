import { IDENTITY, applyTo, chain, coverOf, rasterOf, rotate, scale, translate } from './clawd-vector'
import type { Shape } from './clawd-vector'
import { BODY_WIDTH, BODY_X, BOX_ROWS, HAT_X, MINI, MINI_SCALE } from './mascot-sprites'
import type { MascotRole } from './scene-types'
import { EYE, accessoryShapes, browLine, crownShapes, figureShapes, propellerShapes, shade, strokeShapes, usagiCapShapes, usagiCrownShapes, usagiHatShapes, usagiMouthShapes } from './smooth-art'
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
// pictures the hooks draw the giant alone as pictures (`giantWindows`), the
// TV's module drawing its glass over them.

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
 * line), and how many rows under its box's top (its air row, where a click
 * says it stood) its feet stand, as the scene draws it.
 */
const FIGURE = {
  clawd: { w: 16, h: 14, below: 0, feet: BOX_ROWS - 0.5 },
  usagi: { w: 11.5, h: 20.2, below: 0.45, feet: BOX_ROWS },
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

/** How far shapes reach, each through its own placement, a line's or an outline's width and all. */
const reachOf = (shapes: readonly Shape[]): { left: number; top: number; right: number; bottom: number } => {
  const reach = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  for (const shape of shapes) {
    if (shape.kind === 'text') continue
    const pad = shape.kind === 'line' ? (shape.stroke ?? 0) / 2 : (shape.grow ?? 0) + (shape.outline?.width ?? 0) + (shape.ring ?? 0) / 2
    const corners = shape.kind === 'poly' || shape.kind === 'line' ? shape.points ?? [] : [[shape.x, shape.y], [shape.x + shape.w, shape.y], [shape.x, shape.y + shape.h], [shape.x + shape.w, shape.y + shape.h]] as const
    for (const [x, y] of corners) {
      const [px, py] = applyTo(shape.m ?? IDENTITY, x, y)
      reach.left = Math.min(reach.left, px - pad)
      reach.top = Math.min(reach.top, py - pad)
      reach.right = Math.max(reach.right, px + pad)
      reach.bottom = Math.max(reach.bottom, py + pad)
    }
  }

  return reach
}

/**
 * How big what a giant wears may be blown up (pixels a unit): `wanted`, or
 * less, so that drawn at `wear(1)`'s reach from its anchor (`x`, `y`) it
 * stays inside its box, over its head no higher than its box's top, and,
 * hanging down, no lower than `floor` (the TV's top).
 */
const wearScale = (wanted: number, reach: { left: number; top: number; right: number; bottom: number }, x: number, y: number, box: { left: number; top: number; right: number }, floor: number): number =>
  Math.max(
    1,
    Math.min(
      wanted,
      reach.right > 0 ? (box.right - x) / reach.right : Infinity,
      reach.left < 0 ? (x - box.left) / -reach.left : Infinity,
      reach.top < 0 ? (y - box.top) / -reach.top : Infinity,
      reach.bottom > 0 ? (floor - y) / reach.bottom : Infinity,
    ),
  )

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
  // What it wears over the corner of its head it is worn at, blown up from the scene's (its head 12 units across the body's
  // width, as tall as the rows over its head allow), no bigger than its box holds it; its side its own (a cap's peak to the
  // side it is worn at).
  const side = who.crown === true ? 'centre' : who.accessory === undefined ? 'left' : who.side ?? 'left'
  const across = side === 'centre' ? 0 : ((HAT_X[side] - HAT_X.centre) * 2 * body.w) / 12
  const anchor = { x: body.x + body.w / 2 + across, y: body.y }
  const worn = (k: number): Shape[] => {
    const head = chain(translate(anchor.x, anchor.y), scale(k), translate(0, 10))
    // Over the scene's head the side it is worn at: the anchor's own units across, a hair either way.
    const x = across === 0 ? 0 : Math.sign(across) * 0.001
    if (who.cap === true) return propellerShapes(chain(head, translate(x, -10)), capOf(who), turnOf(spin))
    if (who.crown === true) return crownShapes(head, x, -10)
    if (who.accessory !== undefined) return accessoryShapes(head, who.accessory, x, t)

    return []
  }
  const unit = reachOf(worn(1))
  const k = wearScale(Math.min(body.w / 12, (layout.body.y * CH) / 5), { left: unit.left - anchor.x, top: unit.top - anchor.y, right: unit.right - anchor.x, bottom: 0 }, anchor.x, anchor.y, { left: at.left, top: at.top, right: at.right }, Infinity)
  shapes.push(...worn(k))

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
    // Its brows: high over each eye (higher wide-eyed), level over the face's middle and falling away to the side; never
    // higher than the row between the TV and its eyes, the glass's bottom edge over it.
    const side = at < 0.5 ? -1 : 1
    const top = Math.max(y - CH + 4, cy - eh / 2 - eh * 1.1 - (eyes === 'wide' ? CH / 4 : 0))
    shapes.push(...strokeShapes([1, 0, 0, 1, 0, 0], browLine(cx - side * ew * 0.55, cx + side * ew * 1.75, top, eh * 0.8), 3.4, USAGI.line))
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
    const root = { x: middle + side * earW * 0.8, y: body.y + CH }
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
  // What it wears, blown up evenly from the scene's: as big as the rows over its head hold its ears (7.8 units), its head (10.6)
  // the body's width at most, and inside its box, hanging no lower than the TV's top; sat on its flat top, in front of its ears.
  const worn = (k: number): Shape[] => {
    const seat = chain(translate(middle, body.y + 0.25 * k), scale(k))
    if (who.cap === true) {
      const cap = usagiCapShapes(seat, capOf(who), turnOf(spin))

      return [...cap.cap, ...cap.propeller]
    }

    return who.hat === undefined ? [] : usagiHatShapes(seat, who.hat)
  }
  const unit = reachOf(worn(1))
  const tvTop = at.top + layout.tv.y * CH
  const k = wearScale(Math.min(body.w / 10.6, (body.y - at.top) / 7.8), { left: unit.left - middle, top: unit.top - body.y, right: unit.right - middle, bottom: unit.bottom - body.y }, middle, body.y, { left: at.left, top: at.top, right: at.right }, tvTop)
  shapes.push(...worn(k))
  if (who.crown === true && who.cap !== true) shapes.push(...usagiCrownShapes(chain(translate(middle - earW * 1.6, body.y + 0.1 * k), scale(k * 1.3), rotate(-0.35))))

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
  const { layout, who, from } = inputs
  const figure = FIGURE[who.character]
  // Its scene size, 4 pixels a unit (a child's mini smaller), as the scene draws it; grown, as big as the giant's box holds it.
  const own = from?.mini === true ? 4 * MINI_SCALE : 4
  const k = own + (Math.min((layout.width * CW) / figure.w, (layout.height * CH) / figure.h) - own) * scaleBy
  const centre = { x: (layout.left + layout.width / 2) * CW, y: (layout.top + layout.height / 2) * CH }
  // Where it stood: its middle half its body from its body's left (a mini's from its own left), its feet `figure.feet` rows down its box.
  const middle = from === undefined ? 0 : from.mini === true ? from.x - BODY_X + MINI / 2 : from.x + BODY_WIDTH / 2
  const start = from === undefined ? centre : { x: middle * CW, y: (from.y + figure.feet) * CH - (figure.h / 2 - figure.below) * own }
  const x = start.x + (centre.x - start.x) * travel
  const y = start.y + (centre.y - start.y) * travel
  const pose = { ...NEUTRAL, eyes: eyes === 'wide' ? 'wide' as const : 'normal' as const, eyeOpen: eyes === 'shut' ? 0.08 : 1, ...(who.cap === true ? { cap: (t / 1000) * 30 } : {}) }

  return figureShapes(pose, infoOf(who), chain(translate(x, y + (figure.h / 2 - figure.below) * k), scale(k)), t)
}

/**
 * The giant's cells as it is drawn smooth (eyes open), by `y * width + x` in
 * its box: a cell any of five points of which a shape covers. What of the
 * mascot round the TV a press lands on.
 */
export const giantCells = (who: Who, layout: TvLayout): Set<number> => {
  const covered = coverOf(giantShapes(who, layout))
  const cells = new Set<number>()
  for (let y = 0; y < layout.height; y += 1) {
    for (let x = 0; x < layout.width; x += 1) {
      const px = (layout.left + x) * CW
      const py = (layout.top + y) * CH
      const points = [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]] as const
      if (points.some(([fx, fy]) => covered(px + fx * CW, py + fy * CH))) cells.add(y * layout.width + x)
    }
  }

  return cells
}

/** The giant's frame as the pixels of its box (a cell 8 by 16 pixels), RGBA, as the desktop draws it, still (its propeller's blade at `spin`). */
export const giantPixels = (who: Who, layout: TvLayout, eyes: Eyes, scheme: 'dark' | 'light' = 'dark', spin = 0): Uint8Array =>
  rasterOf(giantShapes(who, layout, eyes, spin), Math.max(1, layout.width) * CW, Math.max(1, layout.height) * CH, translate(-layout.left * CW, -layout.top * CH), undefined, scheme)

/** A window onto the giant's picture: cells of its box, from the box's top left. */
export type GiantPiece = { x: number; y: number; w: number; h: number }

/** Windows onto the giant at most, each cut from one before only where that leaves at least `LEAST_FREED` more of the box's cells to the pane. */
const MOST_PIECES = 16
const LEAST_FREED = 8

/**
 * How far the terminal may draw a picture's pixels from where its cells are,
 * a cell away from the box's middle, in its pixels: it fits the whole picture
 * to its box keeping its shape, so where a cell is narrower than half its
 * height the picture is squeezed towards its middle row, and where wider
 * towards its middle column. A cell so shows pixels from further out than
 * its own, never further in. The cells left to the pane allow for most fonts
 * (`seen`: cells 0.444 to 0.53 as wide as high, up to 2 pixels a row or half
 * a column, and no blur); a window's picture keeps pixels for more (`kept`:
 * 0.4 to 0.625, 4 a row or 2 a column, and 2 pixels' blur), so where a font
 * squeezes further the giant's edge may be clipped a little but its windows
 * still meet with no seam.
 */
const SQUEEZE = { seen: { down: 2, across: 0.5, blur: 0 }, kept: { down: 4, across: 2, blur: 2 } } as const

/** The pixels cell `at` of `size` may show along one axis (`own` pixels a cell, squeezed up to `squeeze` a cell from the middle, blurred `blur` either side): its own and, on its side of the middle, those further out. */
const shownOf = (at: number, size: number, own: number, squeeze: number, blur: number): [number, number] => [
  Math.max(0, at * own + Math.min(0, Math.floor(squeeze * (at - size / 2))) - blur),
  Math.min(size * own, (at + 1) * own + Math.max(0, Math.ceil(squeeze * (at + 1 - size / 2))) + blur),
]

/** The cells of a box `width` by `height` that may show a pixel any of `frames` inks, as the terminal fits it (`shownOf`), row by row. */
const inkedCells = (frames: readonly Uint8Array[], width: number, height: number): Uint8Array => {
  const across = width * CW
  const down = height * CH
  const ink = new Uint8Array(across * down)
  for (const pixels of frames) for (let at = 0; at < ink.length; at += 1) if (pixels[at * 4 + 3] !== 0) ink[at] = 1
  // The inked pixels above and left of each pixel's corner: any in a box, four lookups.
  const sums = new Int32Array((across + 1) * (down + 1))
  for (let y = 0; y < down; y += 1) {
    let row = 0
    for (let x = 0; x < across; x += 1) {
      row += ink[y * across + x] ?? 0
      sums[(y + 1) * (across + 1) + x + 1] = (sums[y * (across + 1) + x + 1] ?? 0) + row
    }
  }
  const sum = (x: number, y: number): number => sums[y * (across + 1) + x] ?? 0
  const inked = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const [top, bottom] = shownOf(y, height, CH, SQUEEZE.seen.down, SQUEEZE.seen.blur)
    for (let x = 0; x < width; x += 1) {
      const [left, right] = shownOf(x, width, CW, SQUEEZE.seen.across, SQUEEZE.seen.blur)
      if (sum(right, bottom) - sum(left, bottom) - sum(right, top) + sum(left, top) > 0) inked[y * width + x] = 1
    }
  }

  return inked
}

/**
 * The windows the giant is drawn through, so the pane shows round it as it
 * does round the block giant: the box its inked cells take, cut in two (a row
 * or a column across) where that leaves the most cells out, again and again
 * while a cut leaves out `LEAST_FREED` or more, up to `MOST_PIECES`. Each
 * window holds all of its inked cells and none of another's.
 */
export const giantPieces = (inked: Uint8Array, width: number, height: number): GiantPiece[] => {
  // The inked cells a row (and a column) has before each cell: whether a run of it has any, one subtraction.
  const rows = new Int32Array(height * (width + 1))
  const columns = new Int32Array(width * (height + 1))
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ink = inked[y * width + x] ?? 0
      rows[y * (width + 1) + x + 1] = (rows[y * (width + 1) + x] ?? 0) + ink
      columns[x * (height + 1) + y + 1] = (columns[x * (height + 1) + y] ?? 0) + ink
    }
  }
  const rowHas = (y: number, from: number, to: number): boolean => (rows[y * (width + 1) + to] ?? 0) > (rows[y * (width + 1) + from] ?? 0)
  const columnHas = (x: number, from: number, to: number): boolean => (columns[x * (height + 1) + to] ?? 0) > (columns[x * (height + 1) + from] ?? 0)
  // The box the inked cells in `box` take; undefined, none.
  const tight = (box: GiantPiece): GiantPiece | undefined => {
    let top = box.y
    while (top < box.y + box.h && !rowHas(top, box.x, box.x + box.w)) top += 1
    if (top === box.y + box.h) return undefined
    let bottom = box.y + box.h - 1
    while (!rowHas(bottom, box.x, box.x + box.w)) bottom -= 1
    let left = box.x
    while (!columnHas(left, top, bottom + 1)) left += 1
    let right = box.x + box.w - 1
    while (!columnHas(right, top, bottom + 1)) right -= 1

    return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 }
  }
  const whole = tight({ x: 0, y: 0, w: width, h: height })
  const pieces = whole === undefined ? [] : [whole]
  while (pieces.length < MOST_PIECES) {
    let best = { freed: LEAST_FREED - 1, at: -1, parts: [] as GiantPiece[] }
    pieces.forEach((piece, at) => {
      const cuts = [
        ...Array.from({ length: piece.h - 1 }, (_, k): [GiantPiece, GiantPiece] => [{ ...piece, h: k + 1 }, { ...piece, y: piece.y + k + 1, h: piece.h - k - 1 }]),
        ...Array.from({ length: piece.w - 1 }, (_, k): [GiantPiece, GiantPiece] => [{ ...piece, w: k + 1 }, { ...piece, x: piece.x + k + 1, w: piece.w - k - 1 }]),
      ]
      for (const cut of cuts) {
        const parts = cut.flatMap(part => tight(part) ?? [])
        const freed = piece.w * piece.h - parts.reduce((sum, part) => sum + part.w * part.h, 0)
        if (freed > best.freed) best = { freed, at, parts }
      }
    })
    if (best.at < 0) break
    pieces.splice(best.at, 1, ...best.parts)
  }

  return pieces
}

/** The pixels a window's picture keeps: those its cells may show (`shownOf`, `SQUEEZE.kept`). */
const keptOf = (piece: GiantPiece, width: number, height: number): { left: number; right: number; top: number; bottom: number } => {
  const { across, down, blur } = SQUEEZE.kept
  const [left] = shownOf(piece.x, width, CW, across, blur)
  const [, right] = shownOf(piece.x + piece.w - 1, width, CW, across, blur)
  const [top] = shownOf(piece.y, height, CH, down, blur)
  const [, bottom] = shownOf(piece.y + piece.h - 1, height, CH, down, blur)

  return { left, right, top, bottom }
}

/** A window's picture: the frame's pixels it keeps (`keptOf`), the rest clear; the whole box's size, so the terminal fits each window's picture as it would the whole and shows each pixel where the whole would. */
const piecePicture = (pixels: Uint8Array, width: number, height: number, piece: GiantPiece): string => {
  const across = width * CW
  const { left, right, top, bottom } = keptOf(piece, width, height)
  const kept = new Uint8Array(pixels.length)
  for (let y = top; y < bottom; y += 1) kept.set(pixels.subarray((y * across + left) * 4, (y * across + right) * 4), (y * across + left) * 4)

  return base64Of(pngOf(kept, across, height * CH))
}

/**
 * The giant in a terminal that shows pictures: the windows it is drawn
 * through (`giantPieces`, from its eyes open and, `turns`, its blade's two
 * frames, so none leaves out what another draws) and each frame's pictures,
 * one a window (PNGs, base64), drawn as first asked for, a window's taken
 * from the first frame where its pixels are the same.
 */
export const giantWindows = (who: Who, layout: TvLayout, scheme: 'dark' | 'light', turns: boolean): { pieces: GiantPiece[]; frame: (eyes: Eyes, spin: number) => string[] } => {
  const width = Math.max(1, layout.width)
  const height = Math.max(1, layout.height)
  const drawn = new Map<string, Uint8Array>()
  const pixelsOf = (eyes: Eyes, spin: number): Uint8Array => {
    const key = `${eyes}:${spin}`
    const pixels = drawn.get(key) ?? giantPixels(who, layout, eyes, scheme, spin)
    drawn.set(key, pixels)

    return pixels
  }
  const first = pixelsOf('open', 0)
  const pieces = giantPieces(inkedCells(turns ? [first, pixelsOf('open', 1)] : [first], width, height), width, height)
  const firsts = pieces.map(piece => piecePicture(first, width, height, piece))
  const frames = new Map<string, string[]>([['open:0', firsts]])
  // Whether two frames' pixels are the same over what a window's picture keeps.
  const same = (a: Uint8Array, b: Uint8Array, piece: GiantPiece): boolean => {
    const { left, right, top, bottom } = keptOf(piece, width, height)
    for (let y = top; y < bottom; y += 1) {
      for (let at = (y * width * CW + left) * 4; at < (y * width * CW + right) * 4; at += 1) if (a[at] !== b[at]) return false
    }

    return true
  }

  return {
    pieces,
    frame: (eyes, spin) => {
      const key = `${eyes}:${spin}`
      let pictures = frames.get(key)
      if (pictures === undefined) {
        const pixels = pixelsOf(eyes, spin)
        drawn.delete(key)
        pictures = pieces.map((piece, at) => (same(pixels, first, piece) ? (firsts[at] as string) : piecePicture(pixels, width, height, piece)))
        frames.set(key, pictures)
      }

      return pictures
    },
  }
}
