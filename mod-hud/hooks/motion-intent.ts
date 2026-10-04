import {
  AIRBORNE,
  AIR_MARGIN,
  BOB,
  CRUISE_MIN,
  CRUISE_SPAN,
  ERRAND_CELLS,
  FLIGHT_MIN_TICKS,
  FLY_ONE_IN,
  FLY_SKY,
  GAP,
  HOP_AIR,
  HOP_HEIGHT,
  HOP_REACH,
  IDLE_CRUISE_MIN,
  IDLE_CRUISE_SPAN,
  IDLE_FLY_ONE_IN,
  KNOCKED_TICKS,
  LANDING_GIVE_UP,
  LANDING_PATIENCE,
  LEAP_ONE_IN,
  LOOP_ONE_IN,
  LOOP_TICKS,
  PROPELLER_ROWS,
  SMOOTH_LANDING_PATIENCE,
  TURN_MIN,
  TURN_SPAN,
  clamp,
  hopLift,
  hopPose,
  nearDepth,
  pauseOf,
  roll,
  toward,
  towardDepth,
} from './motion-rules'
import { altitudesFor, clearAbove, clearOnGround, depthsOf, gapBetween, gapSpot, nearestClear, rollDepth } from './motion-space'
import type { Other } from './motion-space'
import type { Flight, FlightReason, Hop, Memo, Moved, Mover, Rules } from './motion-types'

// What one mover means to do this frame, before anyone bumps
// (hooks/motion-arbitrate.ts settles that): a hop, a take-off, a frame of a
// flight, a walk toward its goal or a wander. No randomness: every choice is
// a hash of (id, what is chosen, frame).

/** A hop starting this frame: its first, squashed frame. */
const startHop = (memo: Memo, tick: number, x: number, d: number, x1: number, height: number): Moved => {
  const air = x1 === x ? 1 : HOP_AIR
  const hop: Hop = { from: tick, x0: x, x1, air, height }

  return { x, d, lift: 0, memo: { x, d, lift: 0, ...(memo.target === undefined ? {} : { target: memo.target }), ...(memo.targetD === undefined ? {} : { targetD: memo.targetD }), pauseUntil: tick, hop }, motion: { kind: 'hop', step: 0, lift: 0, pose: 'squash' } }
}

/** A smooth flight taking off this frame, for `reason`: up a row, then the climb to an altitude of its own. */
const takeOff = (mover: Mover, tick: number, others: readonly Other[], reason: FlightReason, target: number, targetD: number | undefined, home?: number, homeD?: number): Moved => {
  const x = clamp(mover.x, mover.lo, mover.hi)
  const { d } = depthsOf(mover)
  const heights = altitudesFor(mover, others, d)
  // An errand or the session's little flight goes just over the heads; any other to an altitude of its own.
  const low = reason === 'errand' || reason === 'compaction'
  const altitude = low ? Math.min(Math.max(1, mover.sky - PROPELLER_ROWS), AIRBORNE + 2) : heights[roll(mover.id, 'altitude', tick, heights.length)] ?? AIRBORNE
  const cruise = reason === 'idle' ? IDLE_CRUISE_MIN + roll(mover.id, 'cruise', tick, IDLE_CRUISE_SPAN) : FLIGHT_MIN_TICKS
  const fly: Flight = {
    from: tick,
    altitude,
    cruise,
    stage: 'climb',
    since: tick,
    reason,
    minUntil: tick + FLIGHT_MIN_TICKS,
    ...(home === undefined ? {} : { home }),
    ...(homeD === undefined ? {} : { homeD }),
    turnAt: tick + TURN_MIN + roll(mover.id, 'turn', tick, TURN_SPAN),
  }

  return { x, d, lift: 1, memo: { x, d, lift: 1, target, ...(targetD === undefined ? {} : { targetD }), pauseUntil: tick, fly }, motion: { kind: 'fly', step: 0, lift: 1 } }
}

/**
 * One frame of a smooth flight: a climb two rows a second, a cruise that
 * changes altitude every few seconds (one change in three a loop) while it
 * roams the field or heads for its errand, then home and down a row a frame
 * where the ground is clear. A flight asked by a signal stays up while the
 * signal holds and never less than FLIGHT_MIN_TICKS; an idle one cruises its
 * own length. Its depth glides a row every DEPTH_FRAMES frames toward where it
 * is going; its lift is above the floor of the depth it is over.
 */
const flySmooth = (mover: Mover, memo: Memo, fly: Flight, tick: number, others: readonly Other[], need: number): Moved => {
  const x = clamp(mover.x, mover.lo, mover.hi)
  const { d, dLo, dHi } = depthsOf(mover)
  const before = memo.lift ?? 0
  const sky = mover.sky - PROPELLER_ROWS
  // A fresh signal during descent keeps it airborne, starting a new minimum.
  if (fly.stage === 'descend' && mover.ask !== undefined) {
    const heights = altitudesFor(mover, others, d)
    const altitude = heights[roll(mover.id, 'altitude', tick, heights.length)] ?? fly.altitude
    fly = { ...fly, reason: mover.ask.reason, home: mover.ask.home, homeD: mover.ask.homeD, stage: 'climb', since: tick, altitude: Math.max(before, altitude), minUntil: tick + FLIGHT_MIN_TICKS }
    delete fly.waited
    delete fly.gap
    delete fly.gapD
    delete fly.loop
    if (fly.home === undefined) delete fly.home
    if (fly.homeD === undefined) delete fly.homeD
  }
  const reason = fly.reason ?? 'idle'
  const held = tick < (fly.minUntil ?? fly.from + FLIGHT_MIN_TICKS)
  const asked = mover.ask?.reason === reason
  // Still up: a signal flight while asked (or its minimum not over), an idle one through its cruise, an errand until it gets there.
  const errandAt = reason === 'errand' && mover.goal !== undefined ? clamp(mover.goal, mover.lo, mover.hi) : undefined
  const errandD = errandAt === undefined ? undefined : clamp(mover.goalD ?? d, dLo, dHi)
  const staying = reason === 'idle' ? tick - fly.from < fly.cruise : reason === 'errand' ? errandAt !== undefined && (errandAt !== x || errandD !== d) : held || asked
  let stage = fly.stage
  let since = fly.since
  let altitude = Math.min(fly.altitude, Math.max(1, sky))
  let turnAt = fly.turnAt
  let loop = fly.loop
  let target = memo.target
  let targetD = memo.targetD
  let lift = before
  if (stage === 'climb' && !staying) {
    stage = 'cruise'
    since = tick
  }
  if (stage === 'climb') {
    // Two rows a second; an errand or the session's little flight a row a frame.
    const quick = reason === 'errand' || reason === 'compaction'
    lift = Math.min(altitude, before + (quick || (tick - since) % 2 === 0 ? 1 : 0))
    if (lift >= altitude) {
      stage = 'cruise'
      since = tick
    }
  } else if (stage === 'cruise') {
    if (turnAt !== undefined && tick >= turnAt && reason !== 'errand' && reason !== 'compaction') {
      const heights = altitudesFor(mover, others, d)
      altitude = heights[roll(mover.id, 'altitude', tick, heights.length)] ?? altitude
      if (roll(mover.id, 'loop', tick, LOOP_ONE_IN) === 0 && sky >= AIRBORNE + 2) loop = tick
      turnAt = tick + TURN_MIN + roll(mover.id, 'turn', tick, TURN_SPAN)
    }
    // Toward its altitude a row a frame, with the cruise's bob, never down into the ground's rows.
    const aim = clamp(altitude + (BOB[(tick - since) % BOB.length] ?? 0), AIRBORNE, Math.max(AIRBORNE, sky))
    lift = before + Math.sign(aim - before)
    if (!staying) {
      // Done: home (or where the errand ends), then down.
      const landAt = errandAt ?? fly.home ?? x
      const landD = errandD ?? fly.homeD ?? d
      target = clamp(landAt, mover.lo, mover.hi)
      targetD = clamp(landD, dLo, dHi)
      if (target === x && targetD === d) {
        stage = 'descend'
        since = tick
      }
    } else if (reason !== 'errand' && (target === undefined || (target === x && (targetD ?? d) === d))) {
      // Roaming the field while it is up.
      target = mover.lo + roll(mover.id, 'roam', tick, mover.hi - mover.lo + 1)
      targetD = rollDepth(mover, 'roam-depth', tick)
    } else if (errandAt !== undefined) {
      target = errandAt
      targetD = errandD
    }
  } else {
    lift = before - 1
  }
  const speed = reason === 'errand' ? ERRAND_CELLS : 1
  let next = target === undefined ? x : clamp(x + Math.max(-speed, Math.min(speed, target - x)), mover.lo, mover.hi)
  let nextD = targetD === undefined ? d : clamp(towardDepth(d, targetD, tick), dLo, dHi)
  // A row of depth forward is a row less sky: its room is over the shallower of the two depths.
  const room = sky + Math.min(0, nextD - d)
  lift = Math.min(lift, Math.max(1, room))
  let waited = fly.waited
  let gap = fly.gap
  let gapD = fly.gapD
  // Down into the ground's rows only where the ground is clear; out of patience, over the nearest gap its neighbours open.
  const landingGap = (fly.waited ?? 0) >= SMOOTH_LANDING_PATIENCE ? GAP : need
  if (stage === 'descend' && lift < AIRBORNE && room >= AIRBORNE && (fly.waited ?? 0) < LANDING_GIVE_UP && !clearOnGround(others, next, nextD, mover.width, landingGap)) {
    lift = AIRBORNE
    waited = (fly.waited ?? 0) + 1
    if (waited >= SMOOTH_LANDING_PATIENCE) {
      const open = nearestClear(others, next, nextD, mover.width, GAP, mover.lo, mover.hi, dLo, dHi)
      if (open !== undefined && gap === undefined) {
        target = open.x
        targetD = open.d
      } else {
        gap = gap ?? gapSpot(others, next, mover.width, mover.lo, mover.hi, nextD)
        gapD = gap === undefined ? gapD : (gapD ?? nextD)
        target = gap ?? target
        targetD = gap === undefined ? targetD : gapD
      }
    } else {
      const spot = nearestClear(others, next, nextD, mover.width, need, mover.lo, mover.hi, dLo, dHi)
      target = spot?.x ?? target ?? next
      targetD = spot?.d ?? targetD ?? nextD
    }
  }
  if (lift <= 0) {
    return { x, d, lift: 0, memo: { x, d, lift: 0, pauseUntil: tick + pauseOf(mover.id, tick) }, motion: { kind: 'land' } }
  }
  const flight: Flight = {
    ...fly,
    stage,
    since,
    altitude,
    ...(turnAt === undefined ? {} : { turnAt }),
    ...(loop === undefined || tick - loop >= LOOP_TICKS ? {} : { loop }),
    ...(waited === undefined ? {} : { waited }),
    ...(gap === undefined ? {} : { gap }),
    ...(gap === undefined || gapD === undefined ? {} : { gapD }),
  }
  if (loop === undefined || tick - loop >= LOOP_TICKS) delete flight.loop

  return { x: next, d: nextD, lift, memo: { x: next, d: nextD, lift, ...(target === undefined ? {} : { target }), ...(targetD === undefined ? {} : { targetD }), pauseUntil: tick, fly: flight }, motion: { kind: 'fly', step: tick - fly.from, lift } }
}

/** What one mover means to do this frame, before anyone bumps. `others` is everyone else on the field. */
export const intend = (mover: Mover, tick: number, others: readonly Other[], rules: Rules, slack = Infinity): Moved => {
  const { d, dLo, dHi } = depthsOf(mover)
  const memo = mover.memo ?? { x: mover.x, d, pauseUntil: tick + pauseOf(mover.id, tick) }
  const x = clamp(mover.x, mover.lo, mover.hi)
  const mode = rules.collisions ?? 'off'
  const wanders = mover.free && mover.goal === undefined
  const need = mode === 'rare' && wanders ? GAP + 1 : GAP
  const smooth = rules.smooth === true
  const near = others.filter(one => nearDepth(one.d, d))

  // Arriving or leaving by the pipe: where it stands, nothing else.
  if (mover.fixed === true) return { x, d, lift: 0, memo: { x, d, lift: 0, pauseUntil: Math.max(memo.pauseUntil, tick) } }

  // Knocked over: it sits where it fell until it is up again, errands waiting.
  if (memo.fallFrom !== undefined && tick - memo.fallFrom < KNOCKED_TICKS) {
    return { x, d, lift: 0, memo: { x, d, lift: 0, pauseUntil: memo.fallFrom + KNOCKED_TICKS, fallFrom: memo.fallFrom }, motion: { kind: 'fallen', step: tick - memo.fallFrom } }
  }

  // A hop carries on to its landing, whatever else is asked of it.
  if (memo.hop !== undefined) {
    const hop = memo.hop
    const step = tick - hop.from
    if (step >= 0 && step <= hop.air + 1) {
      const lift = Math.min(hopLift(hop, step), mover.sky)
      const at = step > hop.air ? hop.x1 : hop.x0 + Math.round(((hop.x1 - hop.x0) * step) / (hop.air + 1))
      const next = clamp(at, mover.lo, mover.hi)
      const pose = hopPose(hop.air, step)
      const done = step > hop.air
      const kept: Memo = { x: next, d, lift, ...(memo.target === undefined ? {} : { target: memo.target }), ...(memo.targetD === undefined ? {} : { targetD: memo.targetD }), pauseUntil: tick, ...(done ? {} : { hop }) }

      return { x: next, d, lift, memo: kept, motion: { kind: 'hop', step, lift, pose } }
    }
  }

  // The smooth scene: a flight a signal asks for takes off where the sky
  // allows (and nothing passes overhead); one in progress flies on its rules.
  if (smooth && memo.fly === undefined && mover.ask !== undefined && mover.sky >= FLY_SKY) {
    const overhead = near.some(one => (one.lift >= 1 || one.hopping === true) && gapBetween({ x, width: mover.body ?? mover.width }, { x: one.x, width: one.body }) < AIR_MARGIN)
    if (!overhead) {
      const errand = mover.ask.reason === 'errand' && mover.goal !== undefined
      const goal = errand ? clamp(mover.goal ?? x, mover.lo, mover.hi) : x
      const goalD = errand ? clamp(mover.goalD ?? d, dLo, dHi) : undefined
      return takeOff(mover, tick, others, mover.ask.reason, goal, goalD, mover.ask.home, mover.ask.homeD)
    }
  }
  if (smooth && memo.fly !== undefined) return flySmooth(mover, memo, memo.fly, tick, others, need)

  // A flight climbs two rows a second, cruises with a bob, comes down a row a
  // frame where the ground is clear, and lands with a bounce.
  if (memo.fly !== undefined) {
    const fly = memo.fly
    const before = memo.lift ?? 0
    // Its propeller needs the row over its cap.
    const sky = mover.sky - PROPELLER_ROWS
    let next = memo.target === undefined ? x : toward(x, memo.target)
    let nextD = memo.targetD === undefined ? d : clamp(towardDepth(d, memo.targetD, tick), dLo, dHi)
    let stage = fly.stage
    let since = fly.since
    let lift = before
    if (stage === 'climb') {
      lift = Math.min(fly.altitude, 1 + Math.floor((tick - fly.from) / 2))
      if (lift >= fly.altitude) {
        stage = 'cruise'
        since = tick
      }
    } else if (stage === 'cruise') {
      // The bob never dips a high flier into the ground's rows.
      lift = clamp(fly.altitude + (BOB[(tick - since) % BOB.length] ?? 0), fly.altitude >= AIRBORNE ? AIRBORNE : 1, Math.max(1, sky))
      if (tick - since >= fly.cruise) {
        stage = 'descend'
        since = tick
      }
    } else {
      lift = before - 1
    }
    // A row of depth forward is a row less sky: its room is over the shallower of the two depths.
    const room = sky + Math.min(0, nextD - d)
    lift = Math.min(lift, room)
    let target = memo.target
    let targetD = memo.targetD
    let waited = fly.waited
    let gap = fly.gap
    let gapD = fly.gapD
    // Coming down into the ground's rows: only where the ground is clear. Out
    // of patience it hangs over the nearest gap while its neighbours walk
    // aside a cell a frame to open it (stepField), never shoved in one jump.
    if (stage === 'descend' && lift < AIRBORNE && room >= AIRBORNE && (fly.waited ?? 0) < LANDING_GIVE_UP && !clearOnGround(others, next, nextD, mover.width, need)) {
      lift = AIRBORNE
      waited = (fly.waited ?? 0) + 1
      if (waited >= LANDING_PATIENCE) {
        gap = gap ?? gapSpot(others, next, mover.width, mover.lo, mover.hi, nextD)
        gapD = gap === undefined ? gapD : (gapD ?? nextD)
        target = gap ?? target
        targetD = gap === undefined ? targetD : gapD
      } else {
        // Off to the nearest clear spot; with none yet, it circles on to another place and looks again.
        const spot = nearestClear(others, next, nextD, mover.width, need, mover.lo, mover.hi, dLo, dHi)
        target = spot?.x ?? (target === undefined || target === next ? mover.lo + roll(mover.id, 'circle', tick, mover.hi - mover.lo + 1) : target)
        targetD = spot?.d ?? targetD
      }
    }
    if (lift <= 0) {
      return { x, d, lift: 0, memo: { x, d, lift: 0, pauseUntil: tick + pauseOf(mover.id, tick) }, motion: { kind: 'land' } }
    }
    const flight: Flight = { ...fly, stage, since, ...(waited === undefined ? {} : { waited }), ...(gap === undefined ? {} : { gap }), ...(gap === undefined || gapD === undefined ? {} : { gapD }) }

    return { x: next, d: nextD, lift, memo: { x: next, d: nextD, lift, ...(target === undefined ? {} : { target }), ...(targetD === undefined ? {} : { targetD }), pauseUntil: tick, fly: flight }, motion: { kind: 'fly', step: tick - fly.from, lift } }
  }

  // An errand, or a walk to a target: one cell a frame across and a row of
  // depth every other frame, hopping over whoever stands in the way where
  // there is the sky for it.
  const aim = mover.goal !== undefined ? clamp(mover.goal, mover.lo, mover.hi) : mover.free ? memo.target : undefined
  const aimD = clamp(mover.goal !== undefined ? (mover.goalD ?? d) : mover.free ? (memo.targetD ?? d) : d, dLo, dHi)
  if (mover.goal === undefined && !mover.free) return { x, d, lift: 0, memo: { x, d, lift: 0, pauseUntil: Math.max(memo.pauseUntil, tick) } }
  if (mover.goal === undefined) {
    if (tick < memo.pauseUntil) return { x, d, lift: 0, memo: { x, d, lift: 0, pauseUntil: memo.pauseUntil } }
    if (memo.target === undefined) {
      const targetD = rollDepth(mover, 'target-depth', tick)
      return { x, d, lift: 0, memo: { x, d, lift: 0, pauseUntil: tick, target: mover.lo + roll(mover.id, 'target', tick, mover.hi - mover.lo + 1), ...(targetD === undefined ? {} : { targetD }) } }
    }
    if (memo.target === x && aimD === d) return { x, d, lift: 0, memo: { x, d, lift: 0, pauseUntil: tick + pauseOf(mover.id, tick) } }
  }
  if (aim === undefined || (aim === x && aimD === d)) return { x, d, lift: 0, memo: { x, d, lift: 0, pauseUntil: tick } }
  const next = toward(x, aim)
  const nextD = towardDepth(d, aimD, tick)
  const direction = Math.sign(aim - x)
  // The smooth scene with collisions on: a hop need not keep clear of fliers; the surface plays their meeting.
  const meets = smooth && mode !== 'off'
  const walking: Memo = { x: next, d: nextD, lift: 0, ...(mover.goal === undefined && memo.target !== undefined ? { target: memo.target } : {}), ...(mover.goal === undefined && memo.targetD !== undefined ? { targetD: memo.targetD } : {}), pauseUntil: tick }

  // Someone in the way: hop over them, landing clear beyond, not past the errand's end.
  if (mover.sky >= HOP_HEIGHT && direction !== 0) {
    const ahead = near
      .filter(one => one.lift < AIRBORNE && (direction > 0 ? one.x >= x + mover.width : one.x + one.width <= x))
      .sort((a, b) => (direction > 0 ? a.x - b.x : b.x - a.x))[0]
    if (ahead !== undefined && gapBetween({ x: next, width: mover.width }, ahead) < need) {
      const x1 = direction > 0 ? ahead.x + ahead.width + need : ahead.x - mover.width - need
      // Only toward somewhere past them: never beyond where it is going.
      const worth = direction > 0 ? x1 <= aim : x1 >= aim
      if (x1 >= mover.lo && x1 <= mover.hi && worth && clearOnGround(others, x1, d, mover.width, need) && (meets || clearAbove(others, x, x1, mover.body ?? mover.width, d))) {
        return startHop(memo, tick, x, d, x1, HOP_HEIGHT)
      }
    }
  }

  // Now and then a wanderer leaps: a flight where the sky allows, else a hop;
  // a hop that goes anywhere, or a flight, only with room to land. Walking
  // only in depth, or with no room, a spring in place: up a row and down.
  const roomy = slack >= 2 * mover.width
  if (mover.goal === undefined && roll(mover.id, 'leap', tick, LEAP_ONE_IN) === 0) {
    // A flight takes an altitude of its own: three rows or more from any other flier's near it, so they pass over each other;
    // never so high its propeller leaves the sky.
    const heights = Array.from({ length: Math.max(0, mover.sky - PROPELLER_ROWS) }, (_, index) => index + 1)
      .filter(altitude => near.every(one => one.altitude === undefined || Math.abs(one.altitude - altitude) >= 3))
    // Never up into a hop or a flight passing over it.
    const overhead = near.some(one => (one.lift >= 1 || one.hopping === true) && gapBetween({ x: next, width: mover.body ?? mover.width }, { x: one.x, width: one.body }) < HOP_REACH)
    // The smooth scene: an idle flight is rare (one leap in 40) and long, its altitude its own.
    if (smooth) {
      if (roomy && mover.sky >= FLY_SKY && !overhead && roll(mover.id, 'fly', tick, IDLE_FLY_ONE_IN / LEAP_ONE_IN) === 0) return takeOff(mover, tick, others, 'idle', aim, aimD)
    } else if (roomy && mover.sky >= FLY_SKY && heights.length > 0 && !overhead && roll(mover.id, 'fly', tick, FLY_ONE_IN) === 0) {
      const altitude = heights[roll(mover.id, 'altitude', tick, heights.length)] ?? 1
      const cruise = CRUISE_MIN + roll(mover.id, 'cruise', tick, CRUISE_SPAN)
      const fly: Flight = { from: tick, altitude, cruise, stage: altitude <= 1 ? 'cruise' : 'climb', since: tick }

      return { x: next, d, lift: 1, memo: { x: next, d, lift: 1, target: memo.target ?? aim, targetD: memo.targetD ?? aimD, pauseUntil: tick, fly }, motion: { kind: 'fly', step: 0, lift: 1 } }
    }
    const height = Math.min(HOP_HEIGHT, mover.sky)
    const reach = Math.min(HOP_REACH, Math.abs(aim - x))
    const x1 = x + direction * reach
    const path = { x: Math.min(x, x1), width: Math.abs(x1 - x) + mover.width }
    const open = reach > 0 && roomy && mover.sky >= FLY_SKY && height >= AIRBORNE && near.every(one => one.lift >= AIRBORNE || gapBetween(path, one) >= need) && (meets || clearAbove(others, x, x1, mover.body ?? mover.width, d))

    return startHop(memo, tick, x, d, open ? x1 : x, open ? height : Math.min(1, mover.sky))
  }

  return { x: next, d: nextD, lift: 0, memo: walking, motion: { kind: 'walk' } }
}
