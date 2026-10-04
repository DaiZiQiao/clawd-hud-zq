import { BOX, BOX_ROWS, MINI, SLOT } from './mascot-sprites'
import { GAP, HOP_HEIGHT, nearDepth, roll } from './motion-rules'
import { gapBetween, nearestSpot } from './motion-space'
import type { Footprint } from './motion-space'
import type { MascotAgent, MascotScene, Placement, Slot } from './scene-types'

// --- the field ---------------------------------------------------------------
//
// One open field, a plaza: each mascot stands at a column `x` and a depth `d`,
// the rows from the back of the field (0 the back, `depth - 1` the front); its
// floor is `d` rows below the back row's. Sprites are painted back to front
// (depth, then column), so a nearer one stands over a farther one. Above the
// back row's box is the sky (`headroom`): a mascot at depth `d` has
// `headroom + d` rows of it over its box, which hops and flights rise into.

/** Rows of sky the field leaves over its back row's box, where the rows allow: a hop's apex. */
export const FIELD_SKY = HOP_HEIGHT
/** Narrower than this, the field is shallow: SHALLOW_DEPTH rows at most. */
export const NARROW_FIELD = 60
export const SHALLOW_DEPTH = 2

/**
 * The field in `columns` by `rows`: its depth (every row a box and its sky
 * leave, at least one; at most SHALLOW_DEPTH under NARROW_FIELD columns) and
 * the sky over its back row's box; undefined when not even the session's
 * mascot fits (fewer than 4 rows, or fewer columns than its slot).
 */
export const fieldOf = (columns: number, rows: number): { depth: number; headroom: number } | undefined => {
  if (!(rows >= BOX_ROWS) || !(columns >= SLOT)) return undefined
  const room = Math.floor(rows) - BOX_ROWS
  const deep = Math.max(1, room + 1 - FIELD_SKY)
  const depth = Math.floor(columns) < NARROW_FIELD ? Math.min(deep, SHALLOW_DEPTH) : deep

  return { depth, headroom: room - (depth - 1) }
}

/** The strip shows at most this many collapsed agents as dots, then counts them all. */
const STRIP_DOTS = 5
/** A newcomer's slot keeps clear of every box within this many rows of depth where the field has room: no overlap at all. */
const SPREAD = BOX_ROWS - 1

type Unit =
  | { kind: 'main' }
  | { kind: 'agent'; agent: MascotAgent; child: boolean }
  | { kind: 'strip'; agents: MascotAgent[]; dots: number }

const STATUS_DOT: Record<MascotAgent['status'], string> = { running: '●', stalled: '◌', done: '✓', failed: '✗' }

/** The collapsed agents drawn as dots: the newest of them, `dots` at most. */
export const dottedOf = (unit: Extract<Unit, { kind: 'strip' }>): MascotAgent[] => unit.agents.slice(unit.agents.length - unit.dots)

/** `● ● ● ×3`: a dot per agent shown (its status glyph), then how many folded in all. */
export const stripText = (unit: Extract<Unit, { kind: 'strip' }>): string => {
  const dots = dottedOf(unit).map(agent => STATUS_DOT[agent.status]).join(' ')

  return `${dots}${dots === '' ? '' : ' '}×${unit.agents.length}`
}

/** Top-level agents with their descendants after them (depth first), each group in spawn order. */
const groupsOf = (agents: readonly MascotAgent[]): MascotAgent[][] => {
  const children = new Map<string, MascotAgent[]>()
  for (const agent of agents) {
    if (agent.parentId === undefined) continue
    children.set(agent.parentId, [...(children.get(agent.parentId) ?? []), agent])
  }
  const walk = (agent: MascotAgent, seen: Set<string>): MascotAgent[] => {
    if (seen.has(agent.id)) return []
    seen.add(agent.id)

    return [agent, ...(children.get(agent.id) ?? []).flatMap(child => walk(child, seen))]
  }
  const seen = new Set<string>()
  const groups = agents.filter(agent => agent.parentId === undefined).map(agent => walk(agent, seen))

  // One no root reaches (parents that name each other) still stands, on its own.
  const stray = agents.filter(agent => !seen.has(agent.id)).map(agent => walk({ ...agent, parentId: undefined }, seen))

  return [...groups, ...stray].filter(group => group.length > 0)
}

const unitsOf = (groups: readonly MascotAgent[][]): Unit[] =>
  groups.flatMap(group => group.map((agent, index): Unit => ({ kind: 'agent', agent, child: index > 0 })))

/** Whether a slot keeps a cell from every footprint within a row of depth. */
export const clearOf = (taken: readonly Footprint[], slot: Footprint): boolean =>
  taken.every(one => !nearDepth(one.d, slot.d) || gapBetween(one, slot) >= GAP)

/** The depths a slot's kind may take: with the back row of minis, full mascots in front of it and the back row's minis in it. */
export const depthsFor = (kind: Placement['kind'], depth: number, minis: boolean, child: boolean): [number, number] => {
  if (!minis || depth <= 1 || kind === 'strip') return [0, depth - 1]
  if (kind === 'mini') return child ? [0, depth - 1] : [0, 0]

  return [1, depth - 1]
}

/**
 * Slots for the units, in order, or undefined when one finds no clear cell:
 * the session's at the front-left; one leaving where it stands; the strip at
 * the back-left; each agent where it was while that stays clear, else a child
 * right of its parent at its depth and any other at a cell of its own by a
 * hash of its id, the nearest clear cell to it (away from where everyone
 * stands now, where it can). `packed` lays them out as tight as the field
 * holds instead: lane by lane from the front, every other row, left to right.
 * With `minis`, the back row holds minis, packed from the left: a full mascot
 * takes the rows in front of it, and one with none clear there stands in the
 * back row as a mini.
 */
const allocate = (
  units: readonly Unit[],
  columns: number,
  depth: number,
  minis: boolean,
  previous: ReadonlyMap<string, Slot> | undefined,
  occupied: readonly (Footprint & { id: string })[],
  exits: ReadonlyMap<string, Slot>,
  packed = false,
  strict = false,
): Map<string, Slot> | undefined => {
  const slots = new Map<string, Slot>()
  const taken: Footprint[] = []
  const take = (id: string, slot: Slot): void => {
    slots.set(id, slot)
    taken.push({ x: slot.x, d: slot.d, width: slot.width })
  }
  // Clear of every box it would overlap where the field has room (SPREAD rows of depth), else (unless `strict`) of
  // those it could meet; away from where everyone stands now where it can.
  const spot = (id: string, x: number, d: number, width: number, [dLo, dHi]: [number, number]): { x: number; d: number } | undefined => {
    const now = [...taken, ...occupied.filter(one => one.id !== id)]
    const hi = columns - width
    const apart = nearestSpot(now, x, d, width, 0, hi, dLo, dHi, SPREAD)
    if (apart !== undefined || strict) return apart

    return nearestSpot(now, x, d, width, 0, hi, dLo, dHi) ?? nearestSpot(taken, x, d, width, 0, hi, dLo, dHi)
  }
  // Lane by lane: the front row, every other row back from it (every fourth, `strict`), then the rows between; the leftmost clear cell in each.
  const step = strict ? SPREAD + 1 : 2
  const lanes = Array.from({ length: depth }, (_, index) => depth - 1 - index).sort((a, b) => ((depth - 1 - a) % step === 0 ? 0 : 1) - ((depth - 1 - b) % step === 0 ? 0 : 1) || b - a)
  const firstFit = (width: number, [dLo, dHi]: [number, number]): { x: number; d: number } | undefined => {
    for (const d of lanes) {
      if (d < dLo || d > dHi) continue
      const at = nearestSpot(taken, 0, d, width, 0, columns - width, d, d, strict ? SPREAD : undefined)
      if (at !== undefined) return at
    }

    return undefined
  }
  for (const unit of units) {
    if (unit.kind === 'main') {
      take('main', { kind: 'main', x: 0, d: depth - 1, width: SLOT, body: BOX })
      continue
    }
    if (unit.kind === 'strip') {
      const width = [...stripText(unit)].length
      if (width > columns) return undefined
      const at = spot('strip', 0, 0, width, [0, depth - 1])
      if (at === undefined) return undefined
      take('strip', { kind: 'strip', ...at, width, body: width })
      continue
    }
    const agent = unit.agent
    const exit = exits.get(agent.id)
    if (exit !== undefined) {
      take(agent.id, exit)
      continue
    }
    const kinds: Placement['kind'][] = unit.child ? ['mini'] : minis ? (depth > 1 ? ['full', 'mini'] : ['mini']) : ['full']
    let placed = false
    for (const kind of kinds) {
      const width = kind === 'mini' ? MINI : SLOT
      const body = kind === 'mini' ? MINI : BOX
      const range = depthsFor(kind, depth, minis, unit.child)
      const before = previous?.get(agent.id)
      if (before !== undefined && before.kind === kind && before.d >= range[0] && before.d <= range[1] && before.x >= 0 && before.x + width <= columns && clearOf(taken, before)) {
        take(agent.id, before)
        placed = true
        break
      }
      const parent = unit.child && agent.parentId !== undefined ? slots.get(agent.parentId) : undefined
      // The back row's minis pack from its left.
      const backRow = minis && kind === 'mini' && !unit.child
      const x = parent !== undefined ? parent.x + parent.width + GAP : backRow ? 0 : roll(agent.id, 'slot', 0, columns - width + 1)
      const d = parent !== undefined ? parent.d : range[0] + roll(agent.id, 'slot-depth', 0, range[1] - range[0] + 1)
      const at = (packed || backRow) && parent === undefined ? firstFit(width, range) : spot(agent.id, x, d, width, range)
      if (at === undefined) continue
      take(agent.id, { kind, ...at, width, body })
      placed = true
      break
    }
    if (!placed) return undefined
  }

  return slots
}

type Laid = { units: Unit[]; slots: Map<string, Slot>; collapsed: MascotAgent[]; minis: boolean }

/** One way `allocate` lays the field out: the back row as minis, packed tight, clear of every box it would overlap. */
type Attempt = { minis: boolean; packed: boolean; strict: boolean }

/**
 * Lays the field out: everyone full size where the field has a clear cell for
 * them all: none overlapping another where it can (where they stood, or laid
 * out afresh, packed), else a nearer one over a farther one (where they stood,
 * else packed tight); else its back row as minis; else the oldest (whole
 * families) fold into the strip, as few as can, as many dots as fit; else the
 * session's mascot alone.
 */
export const fieldLayout = (
  scene: MascotScene,
  columns: number,
  depth: number,
  previous: ReadonlyMap<string, Slot> | undefined,
  occupied: readonly (Footprint & { id: string })[],
  exits: ReadonlyMap<string, Slot>,
): Laid | undefined => {
  const groups = groupsOf(scene.agents)
  const main: Unit = { kind: 'main' }
  const units = [main, ...unitsOf(groups)]
  // Laid out afresh, packed without overlaps before anyone stands over another; a field already laid out keeps its slots.
  const tries: Attempt[] = [
    { minis: false, packed: false, strict: true },
    ...(previous === undefined ? [{ minis: false, packed: true, strict: true }] : []),
    { minis: false, packed: false, strict: false },
    { minis: false, packed: true, strict: false },
    { minis: true, packed: false, strict: false },
    { minis: true, packed: true, strict: false },
  ]
  for (const { minis, packed, strict } of tries) {
    const slots = allocate(units, columns, depth, minis, packed ? undefined : previous, occupied, exits, packed, strict)
    if (slots !== undefined) return { units, slots, collapsed: [], minis }
  }
  const folding = (folded: number, dots: number): Laid | undefined => {
    const gone = groups.slice(0, folded).flat()
    const units = [main, { kind: 'strip' as const, agents: gone, dots: Math.min(dots, gone.length) }, ...unitsOf(groups.slice(folded))]
    const slots = allocate(units, columns, depth, true, undefined, occupied, exits, true)

    return slots === undefined ? undefined : { units, slots, collapsed: gone, minis: true }
  }
  // The fewest folded that fit (with the narrowest strip), then as many dots as fit.
  let lo = 1
  let hi = groups.length
  let fewest: number | undefined
  while (lo <= hi) {
    const middle = (lo + hi) >> 1
    if (folding(middle, 0) !== undefined) {
      fewest = middle
      hi = middle - 1
    } else {
      lo = middle + 1
    }
  }
  if (fewest !== undefined) {
    for (let dots = STRIP_DOTS; dots >= 0; dots -= 1) {
      const laid = folding(fewest, dots)
      if (laid !== undefined) return laid
    }
  }
  // Not even the strip fits beside the session's mascot: it stands alone.
  const slots = allocate([main], columns, depth, false, undefined, [], new Map())

  return slots === undefined ? undefined : { units: [main], slots, collapsed: [...scene.agents], minis: false }
}
