import { CLASSES, SCENE_THEMES, escapeText, isThemeKey, lightRule, num } from './svg-style'
import type { ThemeKey } from './svg-style'

// The smooth mascots' drawing: shapes in world units (a terminal quadrant is
// one unit wide and two tall, so a cell is 2 by 4, and a desktop pixel a
// quarter of a unit) to SVG markup for the desktop's `Svg`, or to RGBA pixels
// with anti-aliased edges for a terminal's `Image`. Pure functions.

/** A sine wave of `period` ms at time `t`, shifted by `phase`: what blinks, bobs and sways on. */
export const wave = (t: number, period: number, phase = 0): number => Math.sin((2 * Math.PI * t) / period + phase)

/** Smoothstep: 0 to 1 over `x` 0 to 1, easing in and out. */
export const smooth = (x: number): number => {
  const k = Math.max(0, Math.min(1, x))

  return k * k * (3 - 2 * k)
}

/** A 2D affine map `[a, b, c, d, e, f]`: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = readonly [number, number, number, number, number, number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** `m` after `n`: what `n` maps, `m` maps on. */
export const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]

/** The maps applied right to left: `chain(a, b, c)` is a·b·c, `c` first. */
export const chain = (...maps: readonly Matrix[]): Matrix => maps.reduce((all, one) => multiply(all, one), IDENTITY)

export const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y]
export const scale = (sx: number, sy = sx): Matrix => [sx, 0, 0, sy, 0, 0]
export const rotate = (radians: number): Matrix => {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  return [cos, sin, -sin, cos, 0, 0]
}
/** About a point: there, the map, back. */
export const about = (x: number, y: number, map: Matrix): Matrix => chain(translate(x, y), map, translate(-x, -y))

export const applyTo = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

const invert = (m: Matrix): Matrix | undefined => {
  const det = m[0] * m[3] - m[1] * m[2]
  if (!(Math.abs(det) > 1e-12)) return undefined

  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]
}

/** A colour: raw (`#rrggbb`), or a theme key, drawn in the page's scheme. */
export type Paint = string

/**
 * One shape, placed by `m`: a rectangle (corners rounded by `r`), an ellipse
 * (its box's; a ring `ring` thick instead of a disc), a polygon (`points`,
 * any simple one; grown `grow` all round, its corners rounded, as an outline
 * laid under it is; or with its `outline` laid under it, that far out round
 * it), a line through `points` `stroke` thick (its ends and bends round), or
 * a line of text (its baseline's middle, start or end at `x`, `y`; `size` its
 * height in units). Filled with `fill` at `alpha`; an outline's colour, and
 * a grown polygon's or a line's, raw (no theme key).
 */
export type Shape = {
  kind: 'rect' | 'ellipse' | 'poly' | 'line' | 'text'
  x: number
  y: number
  w: number
  h: number
  r?: number
  ring?: number
  points?: readonly (readonly [number, number])[]
  grow?: number
  outline?: { width: number; fill: string }
  stroke?: number
  text?: string
  size?: number
  anchor?: 'start' | 'middle' | 'end'
  bold?: boolean
  fill: Paint
  alpha?: number
  m?: Matrix
}

const hexOf = (fill: Paint, scheme: 'dark' | 'light' = 'dark'): string => (isThemeKey(fill) ? SCENE_THEMES[scheme][fill] : fill)

const matrixAttr = (m: Matrix | undefined): string =>
  m === undefined || m === IDENTITY ? '' : ` transform='matrix(${m.map(num).join(' ')})'`

/** One shape's element, without its group's transform. */
const elementOf = (shape: Shape): string => {
  const theme = isThemeKey(shape.fill) ? ` class='${CLASSES[shape.fill]}'` : ''
  const alpha = shape.alpha ?? 1
  const grow = shape.kind === 'poly' ? shape.grow ?? 0 : 0
  const outline = shape.kind === 'poly' ? shape.outline : undefined
  const paint = shape.kind === 'ellipse' && shape.ring !== undefined
    ? ` fill='none' stroke='${hexOf(shape.fill)}' stroke-width='${num(shape.ring)}'${alpha < 1 ? ` stroke-opacity='${num(alpha)}'` : ''}`
    : shape.kind === 'line'
      ? ` fill='none' stroke='${hexOf(shape.fill)}' stroke-width='${num(shape.stroke ?? 0)}' stroke-linecap='round' stroke-linejoin='round'${alpha < 1 ? ` stroke-opacity='${num(alpha)}'` : ''}`
      : grow > 0
        // Grown: its stroke as wide as twice the growth, round at the corners; seen through as one.
        ? `${theme} fill='${hexOf(shape.fill)}' stroke='${hexOf(shape.fill)}' stroke-width='${num(2 * grow)}' stroke-linejoin='round'${alpha < 1 ? ` opacity='${num(alpha)}'` : ''}`
        : outline !== undefined
          // Outlined: its stroke painted first, under its fill, twice as wide as the outline, round at the corners.
          ? `${theme} fill='${hexOf(shape.fill)}' stroke='${outline.fill}' stroke-width='${num(2 * outline.width)}' stroke-linejoin='round' paint-order='stroke'${alpha < 1 ? ` opacity='${num(alpha)}'` : ''}`
          : `${theme} fill='${hexOf(shape.fill)}'${alpha < 1 ? ` fill-opacity='${num(alpha)}'` : ''}`
  switch (shape.kind) {
    case 'rect': {
      const r = Math.min(shape.r ?? 0, shape.w / 2, shape.h / 2)

      return `<rect x='${num(shape.x)}' y='${num(shape.y)}' width='${num(shape.w)}' height='${num(shape.h)}'${r > 0 ? ` rx='${num(r)}'` : ''}${paint}/>`
    }
    case 'ellipse':
      return `<ellipse cx='${num(shape.x + shape.w / 2)}' cy='${num(shape.y + shape.h / 2)}' rx='${num(shape.w / 2)}' ry='${num(shape.h / 2)}'${paint}/>`
    case 'poly':
      return `<polygon points='${(shape.points ?? []).map(([x, y]) => `${num(x)},${num(y)}`).join(' ')}'${paint}/>`
    case 'line':
      return `<polyline points='${(shape.points ?? []).map(([x, y]) => `${num(x)},${num(y)}`).join(' ')}'${paint}/>`
    case 'text':
      return `<text x='${num(shape.x)}' y='${num(shape.y)}' font-size='${num(shape.size ?? 3)}'${shape.anchor === undefined || shape.anchor === 'middle' ? '' : ` text-anchor='${shape.anchor}'`}${shape.bold === true ? ` font-weight='700'` : ''}${paint}>${escapeText(shape.text ?? '')}</text>`
  }
}

const visible = (shape: Shape): boolean =>
  (shape.alpha ?? 1) > 0.004 &&
  (shape.kind === 'text'
    ? (shape.text ?? '') !== ''
    : shape.kind === 'poly'
      ? (shape.points?.length ?? 0) >= 3
      : shape.kind === 'line'
        ? (shape.points?.length ?? 0) >= 2 && (shape.stroke ?? 0) > 0
        : shape.w > 0 && shape.h > 0)

/**
 * The shapes as SVG markup to set in a document of one's own: shapes in a
 * row that share one placement in one group, under one group of `view`; the
 * theme keys used, for the document's light scheme's rule. Shapes past
 * `limit` characters are left out, the earliest kept.
 */
export const shapesMarkup = (shapes: readonly Shape[], view: Matrix, limit = Infinity): { markup: string; used: Set<ThemeKey> } => {
  const used = new Set<ThemeKey>()
  const parts: string[] = []
  let length = 0
  let index = 0
  const drawn = shapes.filter(visible)
  while (index < drawn.length) {
    const m = drawn[index]?.m
    let end = index
    while (end < drawn.length && drawn[end]?.m === m) end += 1
    const run = drawn.slice(index, end)
    const inner = run.map(elementOf).join('')
    const placed = matrixAttr(m)
    // One shape carries its own transform; several share a group's; unplaced ones need neither.
    const group = placed === '' ? inner : run.length > 1 ? `<g${placed}>${inner}</g>` : inner.startsWith('<text') ? inner.replace(/^<text/, `<text${placed}`) : inner.replace(/\/>$/, `${placed}/>`)
    index = end
    if (length + group.length > limit) continue
    for (const one of run) if (isThemeKey(one.fill)) used.add(one.fill)
    parts.push(group)
    length += group.length
  }

  return { markup: `<g transform='matrix(${view.map(num).join(' ')})'>${parts.join('')}</g>`, used }
}

/**
 * The shapes as one SVG document `width` by `height` CSS pixels, `view`
 * mapping world units to them (`shapesMarkup`); theme keys in the dark
 * scheme's colours, the light scheme's by the page's (`prefers-color-scheme`).
 */
export const svgOf = (shapes: readonly Shape[], width: number, height: number, view: Matrix, limit = Infinity, extra = ''): string => {
  const { markup, used } = shapesMarkup(shapes, view, limit)

  return `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}' pointer-events='none'${extra}>${lightRule(used)}${markup}</svg>`
}

const rgbOf = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1, 7), 16)

  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255]
}

/**
 * The stretches between points (round to the first again when `closed`),
 * packed five numbers each for the pixel loops: where each starts, its run
 * across and down, and one over its length squared (0 for none).
 */
const edgesOf = (points: readonly (readonly [number, number])[], closed: boolean): Float64Array => {
  const count = closed ? points.length : Math.max(0, points.length - 1)
  const edges = new Float64Array(count * 5)
  for (let i = 0; i < count; i += 1) {
    const [ax, ay] = points[i] ?? [0, 0]
    const [bx, by] = points[(i + 1) % points.length] ?? [ax, ay]
    const dx = bx - ax
    const dy = by - ay
    const length = dx * dx + dy * dy
    edges.set([ax, ay, dx, dy, length > 0 ? 1 / length : 0], i * 5)
  }

  return edges
}

/** How far a local point is outside a shape (negative inside), in local units: a function made once per shape, its constants worked out. */
const distanceTo = (shape: Shape): ((x: number, y: number) => number) => {
  const cx = shape.x + shape.w / 2
  const cy = shape.y + shape.h / 2
  switch (shape.kind) {
    case 'ellipse': {
      const rx = shape.w / 2
      const ry = shape.h / 2
      const small = Math.min(rx, ry)
      const ring = shape.ring

      return ring === undefined
        ? (x, y) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * small
        : (x, y) => Math.abs((Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * small) - ring / 2
    }
    case 'poly': {
      // Any simple polygon, convex or not (a stroke along an arc): the distance to its nearest edge, inside by its crossings;
      // grown, that much nearer.
      const points = shape.points ?? []
      const grow = shape.grow ?? 0
      const edges = edgesOf(points, true)

      return (x, y) => {
        let nearest = Infinity
        let inside = false
        for (let i = 0; i < edges.length; i += 5) {
          const ax = edges[i] ?? 0
          const ay = edges[i + 1] ?? 0
          const dx = edges[i + 2] ?? 0
          const dy = edges[i + 3] ?? 0
          const px = x - ax
          const py = y - ay
          const along = (px * dx + py * dy) * (edges[i + 4] ?? 0)
          const t = along < 0 ? 0 : along > 1 ? 1 : along
          const ex = px - t * dx
          const ey = py - t * dy
          const d = ex * ex + ey * ey
          if (d < nearest) nearest = d
          if (ay > y !== (edges[((i + 5) % edges.length) + 1] ?? 0) > y && x < ax + (py * dx) / dy) inside = !inside
        }
        const distance = Math.sqrt(nearest)

        return (inside ? -distance : distance) - grow
      }
    }
    case 'line': {
      // A line through its points: the distance to its nearest stretch, less half its width.
      const half = (shape.stroke ?? 0) / 2
      const stretches = edgesOf(shape.points ?? [], false)

      return (x, y) => {
        let nearest = Infinity
        for (let i = 0; i < stretches.length; i += 5) {
          const px = x - (stretches[i] ?? 0)
          const py = y - (stretches[i + 1] ?? 0)
          const dx = stretches[i + 2] ?? 0
          const dy = stretches[i + 3] ?? 0
          const along = (px * dx + py * dy) * (stretches[i + 4] ?? 0)
          const t = along < 0 ? 0 : along > 1 ? 1 : along
          const ex = px - t * dx
          const ey = py - t * dy
          const d = ex * ex + ey * ey
          if (d < nearest) nearest = d
        }

        return Math.sqrt(nearest) - half
      }
    }
    case 'rect': {
      const r = Math.min(shape.r ?? 0, shape.w / 2, shape.h / 2)
      const hx = shape.w / 2 - r
      const hy = shape.h / 2 - r

      return (x, y) => {
        const qx = Math.abs(x - cx) - hx
        const qy = Math.abs(y - cy) - hy

        return (qx > 0 || qy > 0 ? Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) : Math.max(qx, qy)) - r
      }
    }
    case 'text':
      return () => Infinity
  }
}

/** The local box a shape covers, for its pixels' bounds. */
const boundsOf = (shape: Shape): [number, number, number, number] => {
  if (shape.kind === 'poly' || shape.kind === 'line') {
    const xs = (shape.points ?? []).map(one => one[0])
    const ys = (shape.points ?? []).map(one => one[1])
    const pad = shape.kind === 'line' ? (shape.stroke ?? 0) / 2 : (shape.grow ?? 0) + (shape.outline?.width ?? 0)

    return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]
  }
  const pad = shape.ring ?? 0

  return [shape.x - pad, shape.y - pad, shape.x + shape.w + pad, shape.y + shape.h + pad]
}

/** A colour laid over pixel `at` of `pixels` at `a` (straight alpha). */
const layPixel = (pixels: Uint8Array, at: number, r: number, g: number, b: number, a: number): void => {
  const below = (pixels[at + 3] ?? 0) / 255
  if (a >= 1 || below === 0) {
    // Opaque over anything, or anything over nothing: the colour itself.
    pixels[at] = r
    pixels[at + 1] = g
    pixels[at + 2] = b
    pixels[at + 3] = Math.round(a * 255)
    return
  }
  const keep = below * (1 - a)
  const out = a + keep
  pixels[at] = Math.round((r * a + (pixels[at] ?? 0) * keep) / out)
  pixels[at + 1] = Math.round((g * a + (pixels[at + 1] ?? 0) * keep) / out)
  pixels[at + 2] = Math.round((b * a + (pixels[at + 2] ?? 0) * keep) / out)
  pixels[at + 3] = Math.round(out * 255)
}

/**
 * A square rectangle placed without turning, laid exactly as `layShape` lays
 * it (each pixel covered as far as its middle is inside, a pixel's width
 * blurring the edge) but with the distances across worked out once a column
 * and down once a row, and the rows it covers whole filled at once.
 */
const layRect = (pixels: Uint8Array, width: number, height: number, shape: Shape, m: Matrix, scheme: 'dark' | 'light'): void => {
  const alpha = shape.alpha ?? 1
  const pixel = 1 / Math.sqrt(Math.abs(m[0] * m[3]))
  const corners = [shape.x * m[0] + m[4], (shape.x + shape.w) * m[0] + m[4], shape.y * m[3] + m[5], (shape.y + shape.h) * m[3] + m[5]] as const
  const x0 = Math.max(0, Math.floor(Math.min(corners[0], corners[1])) - 1)
  const x1 = Math.min(width - 1, Math.ceil(Math.max(corners[0], corners[1])) + 1)
  const y0 = Math.max(0, Math.floor(Math.min(corners[2], corners[3])) - 1)
  const y1 = Math.min(height - 1, Math.ceil(Math.max(corners[2], corners[3])) + 1)
  if (x1 < x0 || y1 < y0) return
  const [red, green, blue] = rgbOf(hexOf(shape.fill, scheme))
  // How far outside the rect each column's middle is, across; the columns it covers whole (a run, a rectangle being convex).
  const qxs = Array.from({ length: x1 - x0 + 1 }, (_, i) => Math.abs((x0 + i + 0.5 - m[4]) / m[0] - shape.x - shape.w / 2) - shape.w / 2)
  const whole = qxs.map(qx => qx <= -0.5 * pixel)
  const first = whole.indexOf(true)
  const last = whole.lastIndexOf(true)
  for (let py = y0; py <= y1; py += 1) {
    const qy = Math.abs((py + 0.5 - m[5]) / m[3] - shape.y - shape.h / 2) - shape.h / 2
    // On a row it covers whole too, the run laid at once.
    const run = first >= 0 && qy <= -0.5 * pixel
    if (run) for (let at = (py * width + x0 + first) * 4, end = (py * width + x0 + last) * 4; at <= end; at += 4) layPixel(pixels, at, red, green, blue, alpha)
    for (let i = 0, px = x0; px <= x1; i += 1, px += 1) {
      if (run && i === first) {
        i = last
        px = x0 + last
        continue
      }
      const qx = qxs[i] ?? 0
      const d = qx > 0 || qy > 0 ? Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) : Math.max(qx, qy)
      const cover = 0.5 - d / pixel
      if (cover > 0) layPixel(pixels, (py * width + px) * 4, red, green, blue, (cover >= 1 ? 1 : cover) * alpha)
    }
  }
}

const layShape = (pixels: Uint8Array, width: number, height: number, shape: Shape, m: Matrix, scheme: 'dark' | 'light'): void => {
  if (shape.kind === 'rect' && (shape.r ?? 0) === 0 && m[1] === 0 && m[2] === 0 && m[0] !== 0 && m[3] !== 0) {
    layRect(pixels, width, height, shape, m, scheme)
    return
  }
  const back = invert(m)
  if (back === undefined) return
  const alpha = shape.alpha ?? 1
  // A device pixel's size in local units, for the edge's coverage.
  const pixel = 1 / Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
  const [lx0, ly0, lx1, ly1] = boundsOf(shape)
  const corners = [applyTo(m, lx0, ly0), applyTo(m, lx1, ly0), applyTo(m, lx0, ly1), applyTo(m, lx1, ly1)]
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map(one => one[0]))) - 1)
  const x1 = Math.min(width - 1, Math.ceil(Math.max(...corners.map(one => one[0]))) + 1)
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map(one => one[1]))) - 1)
  const y1 = Math.min(height - 1, Math.ceil(Math.max(...corners.map(one => one[1]))) + 1)
  const [red, green, blue] = rgbOf(hexOf(shape.fill, scheme))
  // An outlined polygon's outline, laid under its fill in the same pass: its colour and how far out it reaches.
  const outline = shape.kind === 'poly' ? shape.outline : undefined
  const [lineRed, lineGreen, lineBlue] = rgbOf(outline?.fill ?? '#000000')
  const reach = outline?.width ?? 0
  const distance = distanceTo(shape)
  const [b0, b1, b2, b3, b4, b5] = back
  // A plain polygon a row at a time: where its edges (in pixels) cross the row's middle says which pixels are inside it,
  // and only those near an edge are worked out exactly; the rest are wholly in or out.
  const scan = shape.kind === 'poly' && (shape.grow ?? 0) === 0 && outline === undefined ? edgesOf((shape.points ?? []).map(([x, y]) => applyTo(m, x, y)), true) : undefined
  const crossings: number[] = []
  const near = new Uint8Array(scan === undefined ? 0 : Math.max(0, x1 - x0 + 1))
  for (let py = y0; py <= y1; py += 1) {
    // The row's first pixel's middle, back in local units; each pixel on, a step along the row.
    let lx = b0 * (x0 + 0.5) + b2 * (py + 0.5) + b4
    let ly = b1 * (x0 + 0.5) + b3 * (py + 0.5) + b5
    let inside = false
    let crossed = 0
    if (scan !== undefined) {
      const middle = py + 0.5
      crossings.length = 0
      near.fill(0)
      for (let i = 0; i < scan.length; i += 5) {
        const ax = scan[i] ?? 0
        const ay = scan[i + 1] ?? 0
        const dx = scan[i + 2] ?? 0
        const dy = scan[i + 3] ?? 0
        // Crossed by the row's middle: its ends on either side, the end the next edge's start itself (not `ay + dy`, which may round to the other side of a vertex on the middle).
        if (ay > middle !== (scan[((i + 5) % scan.length) + 1] ?? 0) > middle) crossings.push(ax + ((middle - ay) * dx) / dy)
        // The pixels within one of it, a pixel above or below the row's middle: near.
        const top = Math.max(Math.min(ay, ay + dy), middle - 1)
        const bottom = Math.min(Math.max(ay, ay + dy), middle + 1)
        if (top > bottom) continue
        const xa = dy === 0 ? ax : ax + ((top - ay) * dx) / dy
        const xb = dy === 0 ? ax + dx : ax + ((bottom - ay) * dx) / dy
        for (let x = Math.max(x0, Math.floor(Math.min(xa, xb) - 1.5)), to = Math.min(x1, Math.ceil(Math.max(xa, xb) + 0.5)); x <= to; x += 1) near[x - x0] = 1
      }
      crossings.sort((a, b) => a - b)
    }
    for (let px = x0; px <= x1; px += 1, lx += b0, ly += b1) {
      if (scan !== undefined) {
        while (crossed < crossings.length && (crossings[crossed] ?? Infinity) < px + 0.5) {
          inside = !inside
          crossed += 1
        }
      }
      const exact = scan === undefined || near[px - x0] === 1
      if (!exact && !inside) continue
      const d = exact ? distance(lx, ly) : -Infinity
      const cover = 0.5 - d / pixel
      const at = (py * width + px) * 4
      // Its outline where its fill does not cover the pixel whole.
      if (outline !== undefined && (cover < 1 || alpha < 1)) {
        const under = 0.5 - (d - reach) / pixel
        if (under > 0) layPixel(pixels, at, lineRed, lineGreen, lineBlue, (under >= 1 ? 1 : under) * alpha)
      }
      if (cover > 0) layPixel(pixels, at, red, green, blue, (cover >= 1 ? 1 : cover) * alpha)
    }
  }
}

/**
 * Whether the shapes cover a point (world units), each through its own
 * placement, a shape seen through more than half not counted: a press's
 * test against what is drawn. Made once for the shapes.
 */
export const coverOf = (shapes: readonly Shape[]): ((x: number, y: number) => boolean) => {
  const tests = shapes.flatMap(shape => {
    if (!visible(shape) || shape.kind === 'text' || (shape.alpha ?? 1) < 0.5) return []
    const back = invert(shape.m ?? IDENTITY)
    if (back === undefined) return []
    const distance = distanceTo(shape)
    const reach = shape.kind === 'poly' ? shape.outline?.width ?? 0 : 0

    return [{ back, distance, reach }]
  })

  return (x, y) =>
    tests.some(({ back, distance, reach }) => {
      const [lx, ly] = applyTo(back, x, y)

      return distance(lx, ly) <= reach
    })
}

/**
 * The shapes as `width` by `height` RGBA pixels (straight alpha, clear where
 * nothing is drawn), `view` mapping world units to pixels: each edge covers
 * its pixels as far as it reaches into them, so edges are smooth at any size.
 * Theme keys in `scheme`'s colours; text in `glyphs`' shapes (in the text's
 * own frame), when given.
 */
export const rasterOf = (shapes: readonly Shape[], width: number, height: number, view: Matrix, glyphs?: (shape: Shape) => readonly Shape[], scheme: 'dark' | 'light' = 'dark'): Uint8Array => {
  const pixels = new Uint8Array(width * height * 4)
  for (const shape of shapes) {
    if (!visible(shape)) continue
    const m = multiply(view, shape.m ?? IDENTITY)
    if (shape.kind === 'text') {
      for (const one of glyphs?.(shape) ?? []) layShape(pixels, width, height, one, multiply(m, one.m ?? IDENTITY), scheme)
      continue
    }
    layShape(pixels, width, height, shape, m, scheme)
  }

  return pixels
}
