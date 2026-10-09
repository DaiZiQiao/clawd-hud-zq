import { smooth, wave } from './clawd-vector'
import { BOUND_AIR } from './motion-rules'
import type { Beside, FigurePose } from './smooth-pose'
import { QUIRK_MS, QUIRK_SAYS } from './usagi-quirks'
import type { Quirk } from './usagi-quirks'

// Usagi's own motion in the smooth scene, over its eased pose
// (hooks/smooth-pose.ts): its quirks played out by time (hooks/usagi-quirks.ts
// says which and when), its toddle and its bounds, and its ears' twitches.
// Each quirk eases in and out of the pose under it, so it starts from
// whatever Usagi was doing and goes back to it.

/** A quirk's weight `at` ms into it: in over its first `inMs`, out over its last `outMs`. */
const envelope = (at: number, length: number, inMs = 140, outMs = 220): number => smooth(Math.min(at / inMs, (length - at) / outMs, 1))

/** A damped bounce after a landing, `ms` since it, `depth` deep. */
const landing = (ms: number, depth: number): number => depth * Math.exp(-ms / 140) * Math.cos(ms / 45)

/** The pose under a quirk, blended toward the quirk's own by its weight. */
const toward = (base: number, to: number, weight: number): number => base + (to - base) * weight

/**
 * Usagi's pose `quirk.at` ms into a quirk, over its own: the Yaha! dance
 * (arms waving in turn, swaying and bouncing, eyes squeezed shut, mouth
 * wide); the Ura! leap (a crouch, a jump with arms flung up, a landing that
 * squashes and wobbles); Haa? (it looms at you, head tilted, eyes wide);
 * Fuun (lids down, a smirk, leaning back, hands on hips, a huff); the twirl
 * (two turns on the spot, arms out); the backflip (a crouch, a turn over in
 * the air, a landing with arms up); the Pururu! shake (a trembling blur
 * either way); at its laptop, both hands hammering the keys. Its line burst
 * out over its head.
 */
export const quirkPose = (pose: FigurePose, quirk: Quirk, facing: 'left' | 'right' | undefined): FigurePose => {
  const { kind, at } = quirk
  const length = QUIRK_MS[kind]
  const weight = envelope(at, length)
  const shout: Beside = { kind: 'shout', text: QUIRK_SAYS[kind] }
  const loud = (extra: readonly Beside[] = []): Beside[] => [...pose.beside.filter(one => one.kind !== 'shout'), ...(at > 120 ? [shout] : []), ...extra]
  const dir = facing === 'left' ? -1 : 1
  switch (kind) {
    case 'yaha': {
      const beat = (Math.PI * at) / 320

      return {
        ...pose,
        armL: toward(pose.armL, 1.15 + 0.6 * Math.max(0, Math.sin(beat)), weight),
        armR: toward(pose.armR, 1.15 + 0.6 * Math.max(0, -Math.sin(beat)), weight),
        tilt: pose.tilt + weight * 0.16 * Math.sin(beat),
        dx: pose.dx + weight * 0.9 * Math.sin(beat),
        drop: pose.drop - weight * 1.3 * Math.abs(Math.sin(beat)),
        eyes: weight > 0.5 ? 'squeeze' : pose.eyes,
        mouth: toward(pose.mouth, 1, weight),
        mouthShape: weight > 0.5 ? 'scream' : pose.mouthShape,
        earL: pose.earL + weight * 0.25 * Math.max(0, Math.sin(beat)),
        earR: pose.earR + weight * 0.25 * Math.max(0, -Math.sin(beat)),
        beside: loud([{ kind: 'sparkles' }]),
      }
    }
    case 'ura':
    case 'flip': {
      // A crouch, the jump (the backflip turns over in it), the landing.
      const crouch = kind === 'ura' ? 260 : 200
      const air = kind === 'ura' ? 740 : 850
      const height = kind === 'ura' ? 7.5 : 8.5
      if (at < crouch) {
        const c = smooth(at / crouch)

        return { ...pose, sx: pose.sx * (1 + 0.14 * c), sy: pose.sy * (1 - 0.2 * c), drop: pose.drop + 0.7 * c, armL: toward(pose.armL, -0.7, c), armR: toward(pose.armR, -0.7, c), eyes: 'squeeze', beside: loud() }
      }
      if (at < crouch + air) {
        const u = (at - crouch) / air
        const rise = Math.sin(Math.PI * u)

        return {
          ...pose,
          drop: pose.drop - height * rise,
          sx: pose.sx * (u < 0.3 ? 0.9 : 1),
          sy: pose.sy * (u < 0.3 ? 1.12 : 1),
          spin: pose.spin + (kind === 'flip' ? -dir * 2 * Math.PI * smooth(u) : 0),
          armL: kind === 'flip' && u > 0.25 && u < 0.8 ? 0.4 : 1.65,
          armR: kind === 'flip' && u > 0.25 && u < 0.8 ? 0.4 : 1.65,
          tuck: 1,
          eyes: 'squeeze',
          mouth: 1,
          mouthShape: 'scream',
          // Going up its ears stream down behind it; coming down they fly up.
          earL: pose.earL + (u < 0.5 ? 0.55 : -0.2),
          earR: pose.earR + (u < 0.5 ? 0.55 : -0.2),
          beside: loud(kind === 'ura' && u < 0.4 ? [{ kind: 'dust', dir: 0 }] : []),
        }
      }
      const since = at - crouch - air
      const squash = landing(since, 0.22) * weight

      return {
        ...pose,
        sx: pose.sx * (1 + squash * 0.8),
        sy: pose.sy * (1 - squash),
        armL: kind === 'flip' ? toward(pose.armL, 1.6, weight) : pose.armL,
        armR: kind === 'flip' ? toward(pose.armR, 1.6, weight) : pose.armR,
        eyes: kind === 'flip' ? 'happy' : pose.eyes,
        mouth: kind === 'flip' ? 1 : pose.mouth,
        earL: pose.earL - 0.5 * Math.exp(-since / 160) * Math.cos(since / 60),
        earR: pose.earR - 0.5 * Math.exp(-since / 160) * Math.cos(since / 60),
        beside: loud(since < 200 ? [{ kind: 'dust', dir: 0 }] : []),
      }
    }
    case 'huh':
      return {
        ...pose,
        sx: pose.sx * (1 + 0.18 * weight),
        sy: pose.sy * (1 + 0.18 * weight),
        tilt: pose.tilt + 0.14 * weight,
        drop: pose.drop - 0.5 * weight,
        eyes: weight > 0.4 ? 'wide' : pose.eyes,
        eyeX: 0,
        eyeY: 0,
        mouth: 0,
        mouthShape: weight > 0.4 ? 'o' : pose.mouthShape,
        beside: loud(),
      }
    case 'fuun':
      return {
        ...pose,
        tilt: pose.tilt - 0.1 * weight,
        drop: pose.drop - 0.3 * weight,
        armL: toward(pose.armL, -0.55, weight),
        armR: toward(pose.armR, -0.55, weight),
        eyes: weight > 0.4 ? 'half' : pose.eyes,
        mouth: 0,
        mouthShape: weight > 0.4 ? 'smirk' : pose.mouthShape,
        beside: loud(at > 500 && at < 1300 ? [{ kind: 'huff' }] : []),
      }
    case 'twirl': {
      const turn = 2 * 2 * Math.PI * smooth(at / length)

      return {
        ...pose,
        // Turning, it narrows to a sliver of itself edge on, its other side coming round.
        sx: pose.sx * (1 - weight + weight * Math.sign(Math.cos(turn) || 1) * Math.max(0.22, Math.abs(Math.cos(turn)))),
        drop: pose.drop - 0.8 * weight * Math.sin((Math.PI * at) / length),
        armL: toward(pose.armL, 0.95, weight),
        armR: toward(pose.armR, 0.95, weight),
        eyes: weight > 0.5 ? 'happy' : pose.eyes,
        mouth: toward(pose.mouth, 0.6, weight),
        beside: loud([{ kind: 'sparkles' }]),
      }
    }
    case 'shake':
      return {
        ...pose,
        dx: pose.dx + 0.55 * weight * wave(at, 70),
        sx: pose.sx * (1 + 0.05 * weight),
        eyes: weight > 0.4 ? 'squeeze' : pose.eyes,
        mouth: toward(pose.mouth, 1, weight),
        mouthShape: weight > 0.4 ? 'scream' : pose.mouthShape,
        earL: pose.earL + 0.2 * weight * wave(at, 90),
        earR: pose.earR - 0.2 * weight * wave(at, 90),
        beside: loud([{ kind: 'jitter' }]),
      }
    case 'bash': {
      const hit = wave(at, 170)

      return {
        ...pose,
        armL: toward(pose.armL, 0.25 + 1.1 * Math.max(0, hit), weight),
        armR: toward(pose.armR, 0.25 + 1.1 * Math.max(0, -hit), weight),
        reach: 0,
        drop: pose.drop - 0.35 * weight * Math.abs(hit),
        eyes: weight > 0.4 ? 'squeeze' : pose.eyes,
        mouth: toward(pose.mouth, 1, weight),
        mouthShape: weight > 0.4 ? 'scream' : pose.mouthShape,
        beside: loud([{ kind: 'keys' }]),
      }
    }
  }
}

/**
 * Usagi's walk, an unhurried toddle: short quick steps, a waddle side to
 * side, its hands swinging a little and its ears lagging a touch behind.
 */
export const toddlePose = (pose: FigurePose, t: number, facing: 'left' | 'right' | undefined, seed: number): FigurePose => {
  const dir = facing === 'left' ? -1 : 1
  const step = wave(t, TODDLE_MS, seed)

  return {
    ...pose,
    legs: [0.55 * Math.max(0, step), 0.55 * Math.max(0, -step), 0, 0],
    tilt: pose.tilt + 0.07 * step + 0.03 * dir,
    armL: pose.armL + 0.3 * step,
    armR: pose.armR - 0.3 * step,
    trail: -0.6 * dir,
    earL: pose.earL + 0.06 * step,
    earR: pose.earR - 0.06 * step,
  }
}

/** A toddle's two steps, ms. */
export const TODDLE_MS = 440

/** How far over its hips (the art's spin) its middle is, in units. */
const FLIP_RISE = 2.8

/** What it cries as it bounds, by the bound: mostly its Yaha!, as it does leaping out in the anime. */
const BOUND_CRIES = ['Yaha!', 'Iyaha!', 'Yaha!', 'Ura!'] as const

/**
 * Usagi bounding (its hop, far and low): crouched to spring, then off the
 * ground stretched, legs tucked, hands flung up, ears streaming back, eyes
 * squeezed and mouth wide on its Yaha!; one full bound in three turned over
 * in the air; down again squashed, dust kicked up either side. `u` how far
 * through its `air` frames in the air (under 0 crouched, over 1 landed),
 * `from` its first frame. A spring in place (a frame in the air) neither
 * cries out nor turns over.
 */
export const boundPose = (pose: FigurePose, u: number, air: number, from: number, facing: 'left' | 'right' | undefined, seed: number): FigurePose => {
  const dir = facing === 'left' ? -1 : 1
  if (u <= 0) return { ...pose, sx: pose.sx * 1.14, sy: pose.sy * 0.84, drop: pose.drop + 0.6, armL: -0.5, armR: -0.5, eyes: 'squeeze', tuck: 0 }
  if (u >= 1) {
    // Landed: the last half frame of the hop, squashed and springing back.
    const since = Math.min(1, ((u - 1) * air) / 0.5)

    return { ...pose, sx: pose.sx * (1 + 0.16 * (1 - since)), sy: pose.sy * (1 - 0.2 * (1 - since)), tuck: 0, beside: [...pose.beside, { kind: 'dust', dir: 0 }] }
  }
  // A forward flip high in the arc, turned about its middle (its big head and small body), not its hips as a tumble is.
  const turn = air >= BOUND_AIR && Math.floor(seed * 97 + from) % 3 === 0 ? dir * 2 * Math.PI * smooth((u - 0.1) / 0.6) : 0
  const rising = u < 0.5

  return {
    ...pose,
    dx: pose.dx - FLIP_RISE * Math.sin(turn),
    drop: pose.drop + FLIP_RISE * (Math.cos(turn) - 1),
    sx: pose.sx * (rising ? 0.92 : 1),
    sy: pose.sy * (rising ? 1.1 : 1),
    spin: pose.spin + turn,
    tuck: 1,
    armL: 1.35,
    armR: 1.35,
    trail: -1.8 * dir,
    eyes: 'squeeze',
    mouth: 1,
    mouthShape: 'scream',
    beside: [...pose.beside.filter(one => one.kind !== 'shout'), ...(air > 1 && u < 0.8 ? [{ kind: 'shout' as const, text: BOUND_CRIES[Math.abs(from) % BOUND_CRIES.length] ?? 'Yaha!' }] : [])],
  }
}

/** Now and then one ear flicks (every three to six seconds, an ear of its own), as a rabbit's do: [left, right], outward radians. */
export const earTwitch = (t: number, seed: number): [number, number] => {
  const flick = (side: number): number => {
    const cycle = 3000 + ((seed * 977 + side * 1709) % 3000)
    const into = (t + seed * 331 + side * 1201) % cycle
    if (into > 220) return 0

    return 0.4 * Math.sin((Math.PI * into) / 220)
  }

  return [flick(0), flick(1)]
}
