import type { Beside, FigurePose } from './smooth-pose'
import { QUIRK_MS, QUIRK_SAYS } from './usagi-quirks'
import type { Quirk } from './usagi-quirks'

// Usagi's own motion in the smooth scene, over its eased pose
// (hooks/smooth-pose.ts): its quirks played out by time (hooks/usagi-quirks.ts
// says which and when), its sprint (wheel legs, arms pumping, ears
// streaming), and its ears' twitches. Each quirk eases in and out of the
// pose under it, so it starts from whatever Usagi was doing and goes back to
// it.

const wave = (t: number, period: number, phase = 0): number => Math.sin((2 * Math.PI * t) / period + phase)

const smooth = (x: number): number => {
  const k = Math.max(0, Math.min(1, x))

  return k * k * (3 - 2 * k)
}

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
 * squashes and wobbles); HUHHH? (it looms at you, head tilted, eyes wide);
 * Fuun (lids down, a smirk, leaning back, hands on hips, a huff); zoomies
 * (dashing either way on wheel legs, leaning into it); the twirl (two turns
 * on the spot, arms out); the backflip (a crouch, a turn over in the air, a
 * landing with arms up); the UNA! shake (a blur either way); at its laptop,
 * both hands hammering the keys. Its line burst out over its head.
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
    case 'zoom': {
      // Dashing either way and back, leaning into it on wheel legs.
      const go = Math.cos((2 * Math.PI * at) / 530)
      const way = go >= 0 ? 1 : -1

      return {
        ...pose,
        dx: pose.dx + 3.6 * weight * Math.sin((2 * Math.PI * at) / 530),
        tilt: pose.tilt + 0.24 * weight * go,
        run: Math.max(pose.run, weight),
        trail: -way * 3 * weight,
        eyes: weight > 0.5 ? 'squeeze' : pose.eyes,
        mouth: toward(pose.mouth, 1, weight),
        mouthShape: weight > 0.5 ? 'scream' : pose.mouthShape,
        beside: loud([{ kind: 'speed', dir: way }, { kind: 'dust', dir: way }]),
      }
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
 * Usagi's walk as a sprint (it covers twice Clawd's ground): wheel legs
 * (hooks/smooth-art.ts), leaning hard into its way, arms pumping, ears
 * streaming back, mouth open, dust kicked up and speed lines behind.
 */
export const sprintPose = (pose: FigurePose, t: number, facing: 'left' | 'right' | undefined, seed: number): FigurePose => {
  const dir = facing === 'left' ? -1 : 1
  const pump = wave(t, 180, seed)

  return {
    ...pose,
    run: 1,
    tilt: pose.tilt + 0.2 * dir,
    armL: 0.2 + 0.9 * pump,
    armR: 0.2 - 0.9 * pump,
    trail: -dir * 3,
    mouth: Math.max(pose.mouth, 0.55),
    beside: [...pose.beside, { kind: 'speed', dir }, { kind: 'dust', dir }],
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
