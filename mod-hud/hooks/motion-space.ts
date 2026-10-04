import { AIRBORNE, AIR_MARGIN, DEPTH_COST, DEPTH_REACH, GAP, PROPELLER_ROWS, clamp, nearDepth, roll } from './motion-rules'
import type { Mover } from './motion-types'

// Room on the field (hooks/motion-rules.ts has its rules): the free runs of
// a depth, the nearest clear spot, the packing that opens a gap for a lander,
// the depths and altitudes a mover may take. Pure functions of where
// everyone else stands.

/** Where everyone else on the field stood at the start of the frame: its sprite's width, and its body's. */
export type Other = { id: string; x: number; d: number; width: number; body: number; lift: number; altitude?: number; hopping?: boolean }

export const gapBetween = (a: { x: number; width: number }, b: { x: number; width: number }): number =>
  a.x <= b.x ? b.x - (a.x + a.width) : a.x - (b.x + b.width)

/** Whether a span at (`x`, `d`) keeps at least `need` cells from everyone on the ground within a row of depth but `except`. */
export const clearOnGround = (others: readonly Other[], x: number, d: number, width: number, need: number, except?: string): boolean =>
  others.every(one => one.id === except || one.lift >= AIRBORNE || !nearDepth(one.d, d) || gapBetween({ x, width }, one) >= need)

/** The columns in [lo, hi] where a span of `width` at depth `d` keeps `need` cells from everyone on the ground within `reach` rows of depth: free runs, left to right. */
const freeRuns = (others: readonly Other[], d: number, width: number, need: number, lo: number, hi: number, reach = DEPTH_REACH): [number, number][] => {
  const blocked = others
    .filter(one => one.lift < AIRBORNE && Math.abs(one.d - d) <= reach)
    .map((one): [number, number] => [one.x - width - need + 1, one.x + one.width + need - 1])
    .sort((a, b) => a[0] - b[0])
  const runs: [number, number][] = []
  let from = lo
  for (const [start, end] of blocked) {
    if (start > from) runs.push([from, Math.min(hi, start - 1)])
    from = Math.max(from, end + 1)
    if (from > hi) break
  }
  if (from <= hi) runs.push([from, hi])

  return runs.filter(([a, b]) => a <= b)
}

/** The free column nearest `x` in some runs (the left first among equals), or undefined. */
const nearestIn = (runs: readonly [number, number][], x: number): number | undefined => {
  let best: number | undefined
  for (const [a, b] of runs) {
    const at = clamp(x, a, b)
    if (best === undefined || Math.abs(at - x) < Math.abs(best - x) || (Math.abs(at - x) === Math.abs(best - x) && at < best)) best = at
  }

  return best
}

/**
 * The free ground spot nearest (`x`, `d`) that keeps `need` cells from
 * everyone near it, a row of depth weighing DEPTH_COST cells (the same depth
 * first among equals, then the farther back), or undefined.
 */
export const nearestClear = (others: readonly Other[], x: number, d: number, width: number, need: number, lo: number, hi: number, dLo = d, dHi = d, reach = DEPTH_REACH): { x: number; d: number } | undefined => {
  let best: { x: number; d: number; cost: number } | undefined
  for (let step = 0; step <= dHi - dLo; step += 1) {
    if (best !== undefined && step * DEPTH_COST > best.cost) break
    for (const depth of step === 0 ? [d] : [d - step, d + step]) {
      if (depth < dLo || depth > dHi) continue
      const at = nearestIn(freeRuns(others, depth, width, need, lo, hi, reach), x)
      if (at === undefined) continue
      const cost = Math.abs(at - x) + step * DEPTH_COST
      if (best === undefined || cost < best.cost) best = { x: at, d: depth, cost }
    }
  }

  return best === undefined ? undefined : { x: best.x, d: best.d }
}

/** What stands on the field, as a free spot is sought: its left column, its depth, its cells across. */
export type Footprint = { x: number; d: number; width: number }

/**
 * The cell nearest (`x`, `d`) where a span of `width` keeps `need` cells from
 * every footprint within `reach` rows of depth of it (DEPTH_REACH: those it
 * could meet), in columns [lo, hi] and depths [dLo, dHi] (a row of depth
 * weighing two cells), or undefined: where the layout puts a newcomer's slot.
 */
export const nearestSpot = (taken: readonly Footprint[], x: number, d: number, width: number, lo: number, hi: number, dLo = d, dHi = d, reach = DEPTH_REACH): { x: number; d: number } | undefined =>
  hi < lo ? undefined : nearestClear(taken.map((one, index) => ({ id: `\u0000${index}`, x: one.x, d: one.d, width: one.width, body: one.width, lift: 0 })), x, clamp(d, dLo, dHi), width, GAP, lo, hi, dLo, dHi, reach)

/** Whether a hop's sweep from `x` to `x1` at depth `d` keeps clear of everyone near it already off the ground. */
export const clearAbove = (others: readonly Other[], x: number, x1: number, body: number, d: number): boolean =>
  others.every(one => !nearDepth(one.d, d) || (one.lift < 1 && one.hopping !== true) || gapBetween({ x: Math.min(x, x1), width: Math.abs(x1 - x) + body }, { x: one.x, width: one.body }) >= AIR_MARGIN)

/**
 * Packs a row so every gap is at least GAP and everyone is in bounds:
 * pushed right left to right, then left right to left. The movers are in
 * left-to-right order; they fit (the layout put them in the field).
 */
export const packLine = (xs: number[], widths: readonly number[], lo: readonly number[], hi: readonly number[]): number[] => {
  const out = xs.map((x, index) => clamp(x, lo[index] ?? 0, hi[index] ?? x))
  for (let index = 1; index < out.length; index += 1) {
    const min = (out[index - 1] ?? 0) + (widths[index - 1] ?? 0) + GAP
    if ((out[index] ?? 0) < min) out[index] = min
  }
  for (let index = out.length - 1; index >= 0; index -= 1) {
    const max = Math.min(hi[index] ?? 0, index === out.length - 1 ? Infinity : (out[index + 1] ?? 0) - (widths[index] ?? 0) - GAP)
    if ((out[index] ?? 0) > max) out[index] = max
  }

  return out
}

/**
 * The nearest gap a lander can come down in at its depth when no spot is
 * clear: the left column whose packing of those near it (the others pushed
 * aside, never past their bounds) costs least, the cells the others are moved
 * and the cells the lander flies counted alike (the nearest first among
 * equals); undefined when no packing keeps it there.
 */
export const gapSpot = (others: readonly Other[], x: number, width: number, lo: number, hi: number, d = 0): number | undefined => {
  const ground = others.filter(one => one.lift < AIRBORNE && nearDepth(one.d, d)).sort((a, b) => a.x - b.x || a.id.localeCompare(b.id))
  let best: { at: number; cost: number } | undefined
  for (let at = lo; at <= hi; at += 1) {
    // Everyone else keeps to the field: 0 to the columns less its own width.
    const row = [...ground.map(one => ({ id: one.id, x: one.x, width: one.width, lo: 0, hi: hi + width - one.width })), { id: '\u0000lander', x: at, width, lo: at, hi: at }]
      .sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2) || (a.id === '\u0000lander' ? -1 : b.id === '\u0000lander' ? 1 : 0))
    const packed = packLine(row.map(one => one.x), row.map(one => one.width), row.map(one => one.lo), row.map(one => one.hi))
    const index = row.findIndex(one => one.id === '\u0000lander')
    if (packed[index] !== at) continue
    if (row.some((_, i) => (packed[i] ?? 0) < 0)) continue
    const cost = row.reduce((sum, one, i) => sum + Math.abs((packed[i] ?? one.x) - one.x), 0) + Math.abs(at - x)
    if (best === undefined || cost < best.cost || (cost === best.cost && Math.abs(at - x) < Math.abs(best.at - x))) best = { at, cost }
  }

  return best?.at
}

/** The altitudes a smooth flight may take: over the heads (from AIRBORNE) to a row under the sky's top, three rows from any other flier's near it where it can. */
export const altitudesFor = (mover: Mover, others: readonly Other[], d: number): number[] => {
  const top = mover.sky - PROPELLER_ROWS
  const all = Array.from({ length: Math.max(0, top - AIRBORNE + 1) }, (_, index) => AIRBORNE + index)
  const apart = all.filter(altitude => others.every(one => one.altitude === undefined || !nearDepth(one.d, d) || Math.abs(one.altitude - altitude) >= 3))

  return apart.length > 0 ? apart : all
}

/** The depths a mover may take. */
export const depthsOf = (mover: Mover): { d: number; dLo: number; dHi: number } => {
  const own = mover.d ?? 0
  const dLo = Math.min(own, mover.dLo ?? own)
  const dHi = Math.max(own, mover.dHi ?? own)

  return { d: clamp(own, dLo, dHi), dLo, dHi }
}

/** A depth to roam to, by a hash, where the mover may take more than one. */
export const rollDepth = (mover: Mover, what: string, tick: number): number | undefined => {
  const { dLo, dHi } = depthsOf(mover)

  return dHi > dLo ? dLo + roll(mover.id, what, tick, dHi - dLo + 1) : undefined
}
