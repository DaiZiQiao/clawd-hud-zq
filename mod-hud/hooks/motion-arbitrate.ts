import { intend } from './motion-intent'
import {
  AIRBORNE,
  AIR_MARGIN,
  CONTACT_COOLDOWN_MS,
  GAP,
  HOP_AIR,
  HOP_REACH,
  KNOCKED_TICKS,
  LANDING_GIVE_UP,
  LANDING_PATIENCE,
  LOOP_ROWS,
  PAUSE_MIN,
  PROPELLER_ROWS,
  SMOOTH_LANDING_PATIENCE,
  TURN_MIN,
  clamp,
  hopLift,
  nearDepth,
  pairKey,
  roll,
} from './motion-rules'
import { clearOnGround, depthsOf, gapBetween, gapSpot, nearestClear, packLine } from './motion-space'
import type { Other } from './motion-space'
import type { Flight, Hop, Motion, Moved, Mover, Rules } from './motion-types'

// One frame of the whole field: every mover's intent (hooks/motion-intent.ts),
// then contact between them, on the ground and in the air.
// State machine: docs/mascots.md ("Choreography").

const FRAME_MS = 250

/**
 * One frame of the field: each mover's intent, then contact. On the ground,
 * two within a row of depth that would come closer than the gap either bump
 * (both step back a cell and pause) or, by the rules, collide (both knocked
 * over where they stand); anything still too close stays where it stood;
 * then a crowd from before (a newcomer, a landing, a set-down) is walked
 * apart a cell a frame. Nobody passes anybody on the ground within a row of
 * depth; farther apart in depth they pass freely. In the air, fliers within
 * a row of each other's lift and depth hold back rather than overlap.
 * `contacts` gets each pair that collided this frame.
 */
export const stepField = (movers: readonly Mover[], tick: number, rules: Rules = {}, contacts: string[] = []): Map<string, Moved> => {
  const mode = rules.collisions ?? 'off'
  const dOf = (mover: Mover): number => depthsOf(mover).d
  const all = [...movers].sort((a, b) => a.x - b.x || dOf(a) - dOf(b) || a.id.localeCompare(b.id))
  const rank = new Map(movers.map((mover, index) => [mover.id, index]))
  const asOther = (one: Mover): Other => ({
    id: one.id, x: clamp(one.x, one.lo, one.hi), d: dOf(one), width: one.width, body: one.body ?? one.width, lift: one.memo?.lift ?? 0,
    ...(one.memo?.fly === undefined ? {} : { altitude: one.memo.fly.altitude }),
    ...(one.memo?.hop === undefined ? {} : { hopping: true }),
  })
  const everyone = all.map(asOther)
  const others = (self: Mover): Other[] => everyone.filter(one => one.id !== self.id)
  // Room to spare at a mover's depth: a leap needs somewhere to come down.
  const columns = Math.max(0, ...all.map(one => one.hi + one.width))
  const slackOf = (self: Mover): number => {
    const near = all.filter(one => nearDepth(dOf(one), dOf(self)))
    return columns - near.reduce((sum, one) => sum + one.width, 0) - Math.max(0, near.length - 1) * GAP
  }
  const intents = new Map(all.map(mover => [mover.id, intend(mover, tick, others(mover), rules, slackOf(mover))]))
  const liftBefore = (mover: Mover): number => mover.memo?.lift ?? 0
  const intentOf = (mover: Mover): Moved => intents.get(mover.id) as Moved

  // In the smooth scene with collisions on, a hop and a flier may meet (the surface plays it): only fliers keep apart.
  const meetInAir = rules.smooth === true && mode !== 'off'
  // Two leaps decided in the same frame: a new hop gives way to anyone else near it going up near its path.
  for (const mover of all) {
    if (meetInAir) break
    const hop = intentOf(mover).memo.hop
    if (hop?.from !== tick || hop.x1 === hop.x0) continue
    const sweep = { x: Math.min(hop.x0, hop.x1), width: Math.abs(hop.x1 - hop.x0) + (mover.body ?? mover.width) }
    const crossed = all.some(other => {
      if (other === mover || !nearDepth(intentOf(other).d, dOf(mover))) return false
      const intent = intentOf(other)
      const up = intent.lift >= 1 || intent.motion?.kind === 'fly' || (intent.motion?.kind === 'hop' && intent.memo.hop?.x1 !== intent.memo.hop?.x0)

      return up && gapBetween(sweep, { x: intent.x, width: other.body ?? other.width }) < AIR_MARGIN
    })
    if (crossed) {
      const x = clamp(mover.x, mover.lo, mover.hi)
      const d = dOf(mover)
      intents.set(mover.id, { x, d, lift: 0, memo: { x, d, lift: 0, pauseUntil: tick + PAUSE_MIN } })
    }
  }

  // On the ground this frame: walkers (on the ground before too) meet; landers come down after them.
  const walkers = all.filter(mover => intentOf(mover).lift < AIRBORNE && liftBefore(mover) < AIRBORNE)
  const landers = all.filter(mover => intentOf(mover).lift < AIRBORNE && liftBefore(mover) >= AIRBORNE)

  const order = walkers
  const widths = order.map(mover => mover.width)
  const current = order.map(mover => clamp(mover.x, mover.lo, mover.hi))
  const currentD = order.map(mover => dOf(mover))
  const next = order.map(mover => intentOf(mover).x)
  const nextD = order.map(mover => intentOf(mover).d)
  const bumped = new Set<string>()
  const collided = new Set<string>()
  const knocked = (index: number): boolean => intentOf(order[index] as Mover).motion?.kind === 'fallen'
  const fixed = (index: number): boolean => order[index]?.fixed === true
  const flying = (index: number): boolean => intentOf(order[index] as Mover).motion?.kind === 'fly'
  const moved = (index: number): boolean => next[index] !== current[index] || nextD[index] !== currentD[index]
  const moving = (index: number): boolean => moved(index) || intentOf(order[index] as Mover).motion?.kind === 'hop' || flying(index)
  const wanders = (index: number): boolean => order[index]?.free === true && order[index]?.goal === undefined
  const revert = (index: number): void => {
    next[index] = current[index] ?? 0
    nextD[index] = currentD[index] ?? 0
  }
  // In `rare`, wanderers keep two cells between them and anyone.
  const gapFor = (left: number, right: number): number => (mode === 'rare' && (wanders(left) || wanders(right)) ? GAP + 1 : GAP)
  const gapOf = (a: number, b: number): number => gapBetween({ x: next[a] ?? 0, width: widths[a] ?? 0 }, { x: next[b] ?? 0, width: widths[b] ?? 0 })
  /** Whether `a`'s own step brings it nearer where `b` is going: closer across, or into its row of depth. */
  const closer = (a: number, b: number): boolean =>
    !nearDepth(currentD[a] ?? 0, nextD[b] ?? 0) || gapBetween({ x: current[a] ?? 0, width: widths[a] ?? 0 }, { x: next[b] ?? 0, width: widths[b] ?? 0 }) > gapOf(a, b)
  /** Pairs within a row of depth at their next places, left (by where they stood) first. */
  const pairs = (): [number, number][] => {
    const out: [number, number][] = []
    for (let a = 0; a < order.length; a += 1) {
      for (let b = a + 1; b < order.length; b += 1) if (nearDepth(nextD[a] ?? 0, nextD[b] ?? 0)) out.push([a, b])
    }
    return out
  }

  // A low flier keeps clear of all a hop has still to cross, as it does in the
  // air (below): it holds back, never under an arc it could only climb into.
  const arcs = meetInAir ? [] : all.flatMap(mover => {
    const intent = intentOf(mover)
    const hop = intent.memo.hop
    return hop === undefined ? [] : [{ id: mover.id, d: intent.d, x: Math.min(intent.x, hop.x1), width: Math.abs(hop.x1 - intent.x) + (mover.body ?? mover.width) }]
  })
  order.forEach((mover, index) => {
    const span = { x: next[index] ?? 0, width: mover.body ?? mover.width }
    if (flying(index) && moved(index) && arcs.some(arc => arc.id !== mover.id && nearDepth(arc.d, nextD[index] ?? 0) && gapBetween(span, arc) < AIR_MARGIN)) revert(index)
  })

  for (const [index, right] of pairs()) {
    const gap = gapOf(index, right)
    if (gap >= gapFor(index, right)) continue
    // A low flier just holds back: it neither bumps nor is knocked down.
    if (flying(index) || flying(right)) {
      if (flying(index)) revert(index)
      if (flying(right)) revert(right)
      continue
    }
    // Inside the wider `rare` gap but not touching: a wanderer coming closer
    // stops short; one walking away walks on (stopped with it, the two would
    // pause and set off together again, and again).
    if (gap >= GAP) {
      if (wanders(index) && closer(index, right)) revert(index)
      if (wanders(right) && closer(right, index)) revert(right)
      continue
    }
    // Nobody moved: a crowd from before, left to the walking apart below.
    if (!moving(index) && !moving(right)) continue
    // One arriving or leaving by the pipe is only met: the walker stops.
    if (fixed(index) || fixed(right)) {
      if (!fixed(index)) revert(index)
      if (!fixed(right)) revert(right)
      continue
    }
    const leftMover = order[index]
    const rightMover = order[right]
    if (leftMover === undefined || rightMover === undefined) continue
    const key = pairKey(leftMover.id, rightMover.id)
    const last = rules.lastContact?.get(key)
    const cooling = last !== undefined && (tick - last) * FRAME_MS < CONTACT_COOLDOWN_MS[mode]
    const eligible = mode === 'normal' ? moving(index) || moving(right) : mode === 'rare' ? moving(index) && moving(right) : false
    if (eligible && !cooling && !knocked(index) && !knocked(right) && !collided.has(leftMover.id) && !collided.has(rightMover.id)) {
      revert(index)
      revert(right)
      collided.add(leftMover.id)
      collided.add(rightMover.id)
      contacts.push(key)
      continue
    }
    // The bump: two moving into each other both step back one cell; one standing is just met.
    const leftFirst = (current[index] ?? 0) <= (current[right] ?? 0)
    const [lo, hi] = leftFirst ? [index, right] : [right, index]
    const was = [moving(index), moving(right)]
    revert(lo)
    revert(hi)
    next[lo] = Math.max(order[lo]!.lo, (current[lo] ?? 0) - (wanders(lo) && !knocked(lo) ? 1 : 0))
    next[hi] = Math.min(order[hi]!.hi, (current[hi] ?? 0) + (wanders(hi) && !knocked(hi) ? 1 : 0))
    if (was[0] === true) bumped.add(leftMover.id)
    if (was[1] === true) bumped.add(rightMover.id)
  }
  // A flier out of patience hangs over its gap: whoever stands in it (within a
  // row of its depth) walks aside a cell a frame (the packing that keeps the
  // gap, a step at a time), whatever else it meant to do; never in one jump.
  const patience = rules.smooth === true ? SMOOTH_LANDING_PATIENCE : LANDING_PATIENCE
  const pushed = new Set<number>()
  // Held open until it is down: hanging over it, or coming down into it.
  const reserved = all.flatMap(mover => {
    const fly = intentOf(mover).memo.fly ?? (intentOf(mover).lift < AIRBORNE && intentOf(mover).lift > 0 ? mover.memo?.fly : undefined)
    return fly?.gap !== undefined && (fly.waited ?? 0) >= patience ? [{ x: fly.gap, d: fly.gapD ?? dOf(mover), width: mover.width }] : []
  })
  for (const gap of reserved) {
    const row = [
      ...order.flatMap((mover, index) => (nearDepth(currentD[index] ?? 0, gap.d) ? [{ index, x: current[index] ?? 0, width: mover.width, lo: mover.lo, hi: mover.hi }] : [])),
      { index: -1, x: gap.x, width: gap.width, lo: gap.x, hi: gap.x },
    ].sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2) || a.index - b.index)
    if (row.length < 2) continue
    const targets = packLine(row.map(one => one.x), row.map(one => one.width), row.map(one => one.lo), row.map(one => one.hi))
    row.forEach((one, at) => {
      if (one.index < 0 || pushed.has(one.index) || knocked(one.index) || fixed(one.index) || intentOf(order[one.index] as Mover).motion?.kind === 'hop') return
      const from = current[one.index] ?? 0
      const target = targets[at] ?? from
      if (target === from) return
      next[one.index] = from + Math.sign(target - from)
      nextD[one.index] = currentD[one.index] ?? 0
      pushed.add(one.index)
    })
  }
  // Whoever still crowds a neighbour stays put (one walking aside for a gap
  // last); nobody walks into a gap being opened.
  for (let pass = 0; pass < 2 * order.length; pass += 1) {
    let changed = false
    for (let index = 0; index < order.length; index += 1) {
      if (!moved(index) || pushed.has(index)) continue
      const span = { x: next[index] ?? 0, width: widths[index] ?? 0 }
      const before = { x: current[index] ?? 0, width: span.width }
      if (reserved.some(gap => nearDepth(gap.d, nextD[index] ?? 0) && gapBetween(span, gap) < GAP && (!nearDepth(gap.d, currentD[index] ?? 0) || gapBetween(before, gap) >= gapBetween(span, gap)))) {
        revert(index)
        changed = true
      }
    }
    for (const [index, right] of pairs()) {
      if (gapOf(index, right) >= GAP) continue
      const free = [index, right].filter(one => moved(one) && !pushed.has(one))
      for (const one of free.length > 0 ? free : [index, right]) {
        if (moved(one)) {
          revert(one)
          pushed.delete(one)
          changed = true
        }
      }
    }
    if (!changed) break
  }

  // A landing only where the ground is clear: otherwise it stays a row up,
  // over everyone's heads, and makes for the nearest clear spot.
  const standing: Other[] = order.map((mover, index) => ({ id: mover.id, x: next[index] ?? mover.x, d: nextD[index] ?? 0, width: mover.width, body: mover.body ?? mover.width, lift: 0 }))
  const ground = [...walkers]
  for (const lander of landers) {
    const intent = intentOf(lander)
    const before = lander.memo?.fly
    const waited = (before?.waited ?? 0) + 1
    const { dLo, dHi } = depthsOf(lander)
    // Only on clear ground (with no row to hang in, or past all hope of a gap, it comes down anyway).
    if (clearOnGround(standing, intent.x, intent.d, lander.width, GAP) || lander.sky < AIRBORNE || waited > LANDING_GIVE_UP) {
      standing.push({ id: lander.id, x: intent.x, d: intent.d, width: lander.width, body: lander.body ?? lander.width, lift: 0 })
      ground.push(lander)
      continue
    }
    // No clear spot yet: it circles on and looks again, a while; out of
    // patience, it makes for the nearest gap, which its neighbours open.
    const open = before?.gap === undefined ? nearestClear(standing, intent.x, intent.d, lander.width, GAP, lander.lo, lander.hi, dLo, dHi) : undefined
    const gap = before?.gap ?? (open === undefined && waited >= patience ? gapSpot(standing, intent.x, lander.width, lander.lo, lander.hi, intent.d) : undefined)
    const gapD = gap === undefined ? undefined : (before?.gapD ?? intent.d)
    const spot = gap !== undefined ? { x: gap, d: gapD ?? intent.d } : open ?? { x: lander.lo + roll(lander.id, 'circle', tick, lander.hi - lander.lo + 1), d: intent.d }
    // It stays where it was, as a flight on its way down.
    const x = clamp(lander.x, lander.lo, lander.hi)
    const d = dOf(lander)
    const lift = Math.max(AIRBORNE, liftBefore(lander))
    if (rules.smooth === true && before === undefined) {
      // A blocked hop stays a hop, tucked at its apex, on toward the spot a
      // hop's reach at most; no propeller without a reason. Its line runs on
      // from where it was a frame ago, the same cells a frame to its landing:
      // drawn without a jump, never across the field at once.
      const old = lander.memo?.hop
      const air = old?.air ?? HOP_AIR
      const step = Math.floor(air / 2)
      const x1 = clamp(x + clamp(spot.x - x, -HOP_REACH, HOP_REACH), lander.lo, lander.hi)
      const pace = (x1 - x) / (air + 2 - step)
      const hop: Hop = { from: tick - step, x0: x - (step - 1) * pace, x1, air, height: lift }
      const at = Math.round(x + pace)
      intents.set(lander.id, { x: at, d, lift, memo: { x: at, d, lift, target: spot.x, targetD: spot.d, pauseUntil: tick, hop }, motion: { kind: 'hop', step, lift, pose: 'apex' } })
      continue
    }
    const fly: Flight = { ...(before ?? {}), from: before?.from ?? tick - 2 * (lift - 1), altitude: lift, cruise: before?.cruise ?? 0, stage: 'descend', since: tick, waited, ...(gap === undefined ? {} : { gap, gapD: gapD ?? d }) }
    intents.set(lander.id, { x, d, lift, memo: { x, d, lift, target: spot.x, targetD: spot.d, pauseUntil: tick, fly }, motion: { kind: 'fly', step: tick - fly.from, lift } })
  }
  // A low flier held back keeps flying: its stage and all, as it was.
  const holding = new Set(order.filter((_, index) => flying(index)).map(mover => mover.id))
  const air = all.filter(mover => intentOf(mover).lift >= AIRBORNE)

  // The ground placed, landings and all; a crowd from before walked apart.
  const placed = new Map<string, { x: number; d: number }>(order.map((mover, index) => [mover.id, { x: next[index] ?? mover.x, d: nextD[index] ?? 0 }]))
  for (const mover of ground) if (!placed.has(mover.id)) placed.set(mover.id, { x: intentOf(mover).x, d: intentOf(mover).d })
  const steady = (mover: Mover): boolean => mover.fixed === true || intentOf(mover).motion?.kind === 'fallen' || intentOf(mover).motion?.kind === 'hop'
  const apart: string[] = []
  for (let a = 0; a < ground.length; a += 1) {
    for (let b = a + 1; b < ground.length; b += 1) {
      const one = ground[a] as Mover
      const two = ground[b] as Mover
      const p = placed.get(one.id)
      const q = placed.get(two.id)
      if (p === undefined || q === undefined || !nearDepth(p.d, q.d) || gapBetween({ x: p.x, width: one.width }, { x: q.x, width: two.width }) >= GAP) continue
      // Who walks: never one standing fast; a wanderer before one at work; else the later on the field.
      const choices = [one, two].filter(mover => !steady(mover))
      if (choices.length === 0) continue
      const yielder = choices.length === 1 ? choices[0]! : [...choices].sort((m, n) => Number(n.free && n.goal === undefined) - Number(m.free && m.goal === undefined) || (rank.get(n.id) ?? 0) - (rank.get(m.id) ?? 0))[0]!
      if (!apart.includes(yielder.id)) apart.push(yielder.id)
    }
  }
  for (const id of apart) {
    const mover = all.find(one => one.id === id) as Mover
    const at = placed.get(id)
    if (at === undefined) continue
    const rest = ground.filter(one => one.id !== id).flatMap((one): Other[] => {
      const there = placed.get(one.id)
      return there === undefined ? [] : [{ id: one.id, x: there.x, d: there.d, width: one.width, body: one.body ?? one.width, lift: 0 }]
    })
    if (clearOnGround(rest, at.x, at.d, mover.width, GAP)) continue
    const { dLo, dHi } = depthsOf(mover)
    const spot = nearestClear(rest, at.x, at.d, mover.width, GAP, mover.lo, mover.hi, dLo, dHi)
    if (spot === undefined) continue
    // A cell (and a row) a frame toward it: nobody jumps.
    placed.set(id, { x: at.x + Math.sign(spot.x - at.x), d: at.d + Math.sign(spot.d - at.d) })
  }

  // In the air only bodies count (no laptop goes up). A flier never overlaps
  // another mascot in the air within a row of it, lift and depth: one flier
  // holds where it was (the later first, then the other, then both); a hop
  // keeps its arc.
  const airX = new Map(air.map(mover => [mover.id, clamp(intentOf(mover).x, mover.lo, mover.hi)]))
  const airD = new Map(air.map(mover => [mover.id, intentOf(mover).d]))
  const airLift = new Map(air.map(mover => [mover.id, intentOf(mover).lift]))
  const yields = new Map<string, number>()
  const bodyOf = (mover: Mover): number => mover.body ?? mover.width
  const flies = (mover: Mover): boolean => intentOf(mover).motion?.kind === 'fly'
  const liftOf = (mover: Mover): number => airLift.get(mover.id) ?? 0
  const bodyAt = (mover: Mover): { x: number; width: number } => ({ x: airX.get(mover.id) ?? 0, width: bodyOf(mover) })
  // A hop from here to its landing: the cells it has still to cross, the rows it has still to pass through.
  const arcOf = (mover: Mover): { x: number; width: number; low: number; high: number } => {
    const hop = intentOf(mover).memo.hop
    if (hop === undefined) return { ...bodyAt(mover), low: liftOf(mover), high: liftOf(mover) }
    const x = airX.get(mover.id) ?? 0
    const step = tick - hop.from
    const lifts = [liftOf(mover), ...Array.from({ length: Math.max(0, hop.air + 2 - step) }, (_, k) => hopLift(hop, step + k))]
    return { x: Math.min(x, hop.x1), width: Math.abs(hop.x1 - x) + bodyOf(mover), low: Math.min(...lifts), high: Math.max(...lifts) }
  }
  // A flier keeps a little further from a hop, whose arc it cannot stop: from
  // all the arc has still to cross, wherever it comes within a row of the
  // flier's lift (a hop rises and drops two rows a frame: a flier held where
  // it was must be clear of it). Two hops keep their arcs.
  const clash = (one: Mover, two: Mover): boolean => {
    if (!nearDepth(airD.get(one.id) ?? 0, airD.get(two.id) ?? 0)) return false
    if (flies(one) && flies(two)) return Math.abs(liftOf(one) - liftOf(two)) <= 1 && gapBetween(bodyAt(one), bodyAt(two)) < GAP
    const flier = flies(one) ? one : flies(two) ? two : undefined
    if (flier === undefined || meetInAir) return false
    const arc = arcOf(flier === one ? two : one)

    return liftOf(flier) >= arc.low - 1 && liftOf(flier) <= arc.high + 1 && gapBetween(bodyAt(flier), arc) < AIR_MARGIN
  }
  const hold = (mover: Mover): void => {
    airX.set(mover.id, clamp(mover.x, mover.lo, mover.hi))
    airD.set(mover.id, dOf(mover))
    airLift.set(mover.id, Math.max(1, liftBefore(mover)))
  }
  const restore = (mover: Mover, x: number | undefined, d: number | undefined, lift: number | undefined): void => {
    if (x !== undefined) airX.set(mover.id, x)
    if (d !== undefined) airD.set(mover.id, d)
    if (lift !== undefined) airLift.set(mover.id, lift)
  }
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false
    for (let a = 0; a < air.length; a += 1) {
      for (let b = a + 1; b < air.length; b += 1) {
        const one = air[a] as Mover
        const two = air[b] as Mover
        if (!clash(one, two)) continue
        const fliers = [two, one].filter(flies)
        if (fliers.length === 0) continue
        if (rules.smooth === true && fliers.length === 2) {
          const opposed = Math.sign((intentOf(one).memo.target ?? one.x) - one.x) * Math.sign((intentOf(two).memo.target ?? two.x) - two.x) < 0
          // Up over the other where its sky has room: a looper keeps its circle's rows.
          const yielder = [one, two].sort((a, b) => a.id.localeCompare(b.id)).find(mover => {
            const other = mover === one ? two : one
            const loops = intentOf(mover).memo.fly?.loop !== undefined
            return mover.sky - PROPELLER_ROWS - (loops ? LOOP_ROWS : 0) >= liftBefore(other) + 2
          })
          if (opposed && yielder !== undefined) {
            const other = yielder === one ? two : one
            hold(one)
            hold(two)
            const altitude = liftBefore(other) + 2
            airLift.set(yielder.id, Math.min(altitude, liftBefore(yielder) + 1))
            yields.set(yielder.id, altitude)
            if (!clash(one, two)) continue
          }
        }
        changed = true
        let clear = false
        for (const yielder of fliers) {
          const x = airX.get(yielder.id)
          const d = airD.get(yielder.id)
          const lift = airLift.get(yielder.id)
          hold(yielder)
          if (!clash(one, two)) {
            clear = true
            break
          }
          restore(yielder, x, d, lift)
        }
        if (!clear) for (const yielder of fliers) hold(yielder)
      }
    }
    if (!changed) break
  }
  for (const [id, x] of airX) placed.set(id, { x, d: airD.get(id) ?? 0 })

  const pushedIds = new Set([...pushed].map(index => (order[index] as Mover).id))
  const out = new Map<string, Moved>()
  for (const mover of all) {
    const intent = intentOf(mover)
    const yielded = yields.get(mover.id)
    if (yielded !== undefined && intent.memo.fly !== undefined) intent.memo = { ...intent.memo, fly: { ...intent.memo.fly, altitude: yielded, turnAt: tick + TURN_MIN } }
    const where = placed.get(mover.id) ?? { x: mover.x, d: dOf(mover) }
    const { x, d } = where
    const lift = airLift.get(mover.id) ?? intent.lift
    if (collided.has(mover.id)) {
      out.set(mover.id, { x, d, lift: 0, memo: { x, d, lift: 0, pauseUntil: tick + KNOCKED_TICKS, fallFrom: tick }, motion: { kind: 'fallen', step: 0 }, collided: true })
      continue
    }
    const down = intent.motion?.kind === 'fallen'
    if (bumped.has(mover.id) && !down) {
      out.set(mover.id, { x, d, lift: 0, memo: { x, d, lift: 0, pauseUntil: tick + PAUSE_MIN }, bumped: true })
      continue
    }
    if (holding.has(mover.id)) {
      out.set(mover.id, { x, d, lift, memo: { ...intent.memo, x, d, lift }, ...(intent.motion === undefined ? {} : { motion: intent.motion }) })
      continue
    }
    if ((pushedIds.has(mover.id) || apart.includes(mover.id)) && (x !== clamp(mover.x, mover.lo, mover.hi) || d !== dOf(mover)) && intent.motion?.kind !== 'fly') {
      // Walking aside for a lander's gap, or out of a crowd: a step, then on with what it was doing.
      out.set(mover.id, { x, d, lift: 0, memo: { x, d, lift: 0, ...(intent.memo.target === undefined ? {} : { target: intent.memo.target }), ...(intent.memo.targetD === undefined ? {} : { targetD: intent.memo.targetD }), pauseUntil: tick }, motion: { kind: 'walk' } })
      continue
    }
    const walked = intent.motion === undefined || intent.motion.kind === 'walk'
    const held = (x !== intent.x || d !== intent.d) && walked && liftBefore(mover) < AIRBORNE
    if (held && !down) {
      // Stopped short on the ground: it pauses where it is.
      out.set(mover.id, { x, d, lift: 0, memo: { x, d, lift: 0, pauseUntil: tick + PAUSE_MIN } })
      continue
    }
    const motion: Motion | undefined = intent.motion?.kind === 'fly' && lift !== intent.lift ? { ...intent.motion, lift } : intent.motion
    out.set(mover.id, { x, d, lift, memo: { ...intent.memo, x, d, lift }, ...(motion === undefined ? {} : { motion }) })
  }

  return out
}
