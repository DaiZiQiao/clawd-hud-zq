// A smooth Clawd: the session's mascot drawn as shapes, not cells, for the
// surfaces that draw pictures (the desktop's `Svg`, a terminal's `Image`).
// Pure functions: shapes in world units to SVG markup, or to RGBA pixels with
// anti-aliased edges. hooks/clawd-moves.ts says where the shapes are.

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

const applyTo = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

const invert = (m: Matrix): Matrix | undefined => {
  const det = m[0] * m[3] - m[1] * m[2]
  if (!(Math.abs(det) > 1e-12)) return undefined

  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]
}

/**
 * One shape: a rectangle (its corners rounded by `r`) or an ellipse (the one
 * its box holds), in world units, filled with `fill` (`#rrggbb`) at `alpha`,
 * placed by `m`.
 */
export type Shape = {
  kind: 'rect' | 'ellipse'
  x: number
  y: number
  w: number
  h: number
  r?: number
  fill: string
  alpha?: number
  m?: Matrix
}

const round = (n: number): string => String(Math.round(n * 1000) / 1000)

/** The shapes as one SVG document `width` by `height` pixels, `view` mapping world units to them. */
export const svgOf = (shapes: readonly Shape[], width: number, height: number, view: Matrix): string => {
  const parts = shapes.flatMap(shape => {
    const alpha = shape.alpha ?? 1
    if (!(alpha > 0.004) || !(shape.w > 0) || !(shape.h > 0)) return []
    const m = multiply(view, shape.m ?? IDENTITY)
    const placed = ` transform="matrix(${m.map(round).join(' ')})" fill="${shape.fill}"${alpha < 1 ? ` fill-opacity="${round(alpha)}"` : ''}`
    if (shape.kind === 'ellipse') {
      return [`<ellipse cx="${round(shape.x + shape.w / 2)}" cy="${round(shape.y + shape.h / 2)}" rx="${round(shape.w / 2)}" ry="${round(shape.h / 2)}"${placed}/>`]
    }
    const r = Math.min(shape.r ?? 0, shape.w / 2, shape.h / 2)

    return [`<rect x="${round(shape.x)}" y="${round(shape.y)}" width="${round(shape.w)}" height="${round(shape.h)}"${r > 0 ? ` rx="${round(r)}"` : ''}${placed}/>`]
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`
}

const rgbOf = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1, 7), 16)

  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0]
}

/** How far a local point is outside a shape (negative inside), in local units. */
const distanceOf = (shape: Shape, x: number, y: number): number => {
  const cx = shape.x + shape.w / 2
  const cy = shape.y + shape.h / 2
  if (shape.kind === 'ellipse') {
    const rx = shape.w / 2
    const ry = shape.h / 2
    const k = Math.hypot((x - cx) / rx, (y - cy) / ry)

    return (k - 1) * Math.min(rx, ry)
  }
  const r = Math.min(shape.r ?? 0, shape.w / 2, shape.h / 2)
  const qx = Math.abs(x - cx) - (shape.w / 2 - r)
  const qy = Math.abs(y - cy) - (shape.h / 2 - r)

  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

/**
 * The shapes as `width` by `height` RGBA pixels (straight alpha, clear where
 * nothing is drawn), `view` mapping world units to pixels: each edge covers
 * its pixels as far as it reaches into them, so edges are smooth at any size.
 */
export const rasterOf = (shapes: readonly Shape[], width: number, height: number, view: Matrix): Uint8Array => {
  const pixels = new Uint8Array(width * height * 4)
  for (const shape of shapes) {
    const alpha = shape.alpha ?? 1
    if (!(alpha > 0.004) || !(shape.w > 0) || !(shape.h > 0)) continue
    const m = multiply(view, shape.m ?? IDENTITY)
    const back = invert(m)
    if (back === undefined) continue
    // A device pixel's size in local units, for the edge's coverage.
    const pixel = 1 / Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
    const corners = [applyTo(m, shape.x, shape.y), applyTo(m, shape.x + shape.w, shape.y), applyTo(m, shape.x, shape.y + shape.h), applyTo(m, shape.x + shape.w, shape.y + shape.h)]
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map(one => one[0]))) - 1)
    const x1 = Math.min(width - 1, Math.ceil(Math.max(...corners.map(one => one[0]))) + 1)
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map(one => one[1]))) - 1)
    const y1 = Math.min(height - 1, Math.ceil(Math.max(...corners.map(one => one[1]))) + 1)
    const [red, green, blue] = rgbOf(shape.fill)
    for (let py = y0; py <= y1; py += 1) {
      for (let px = x0; px <= x1; px += 1) {
        const [lx, ly] = applyTo(back, px + 0.5, py + 0.5)
        const cover = Math.min(1, Math.max(0, 0.5 - distanceOf(shape, lx, ly) / pixel))
        if (cover <= 0) continue
        const a = cover * alpha
        const at = (py * width + px) * 4
        const below = (pixels[at + 3] ?? 0) / 255
        const out = a + below * (1 - a)
        if (out <= 0) continue
        pixels[at] = Math.round((red * a + (pixels[at] ?? 0) * below * (1 - a)) / out)
        pixels[at + 1] = Math.round((green * a + (pixels[at + 1] ?? 0) * below * (1 - a)) / out)
        pixels[at + 2] = Math.round((blue * a + (pixels[at + 2] ?? 0) * below * (1 - a)) / out)
        pixels[at + 3] = Math.round(out * 255)
      }
    }
  }

  return pixels
}
