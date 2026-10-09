import { STRETCH_MS, stretchPose, tidyPose } from './clawd-moves'
import type { Prop } from './clawd-moves'
import { wave } from './clawd-vector'
import type { Look, MiniLook } from './mascot-poses'
import { MINI_OVERLAYS, OVERLAYS, THOUGHTS, THOUGHT_FRAMES } from './mascot-sprites'
import type { Overlay } from './mascot-sprites'
import type { Motion } from './motion-types'
import type { Cue, Phase } from './scene-types'
import { boundPose, earTwitch, toddlePose } from './usagi-moves'
import { DAZED, SHOUTS, STARTLED, USAGI_THOUGHTS } from './usagi-sprites'

// The smooth mascots' poses: the engine's look for a frame (hooks/mascot-poses.ts,
// the same for every renderer) read as a continuous pose (where the body, eyes,
// arms and legs are), eased frame to frame by springs so a squash bounces, a
// fall turns over and a glance slides; with what only time can draw on top
// (blinking, breathing, a walk's legs, a dangle's kicks, a propeller's turn)
// and what is beside it as props drawn by time, not stepped by frame.

/** The eyes' kind: their offset and openness are the pose's numbers; Usagi's squeezed shut (`> <`) and its smug half lids too. */
export type EyeKind = 'normal' | 'wide' | 'spiral' | 'happy' | 'down' | 'squeeze' | 'half'

/** Usagi's mouth: its small open one, wide open screaming, a round `o`, a smirk. */
export type MouthShape = 'dot' | 'scream' | 'o' | 'smirk'

/** What sits beside a mascot or in its hand, drawn smooth (hooks/smooth-art.ts). */
export type Beside =
  | { kind: 'thought'; text: string; grow: number }
  | { kind: 'shout'; text: string }
  | { kind: 'zzz' }
  | { kind: 'moon' }
  | { kind: 'sweat' }
  | { kind: 'clock'; floor?: true }
  | { kind: 'ask' }
  | { kind: 'tick' }
  | { kind: 'cross' }
  | { kind: 'startle' }
  | { kind: 'pointing' }
  | { kind: 'cigarette' }
  | { kind: 'dizzy' }
  | { kind: 'paper' }
  | { kind: 'scroll' }
  | { kind: 'baton' }
  | { kind: 'props'; props: readonly Prop[] }
  // Usagi's quirks and bounds (hooks/usagi-moves.ts): sparkles about it, dust kicked up (`dir` behind its way, 0 both sides), a huff, the keys flying, a shake's blur.
  | { kind: 'sparkles' }
  | { kind: 'dust'; dir: number }
  | { kind: 'huff' }
  | { kind: 'keys' }
  | { kind: 'jitter' }

/** A mascot's pose: numbers eased between frames, then the kinds that switch. */
export type FigurePose = {
  /** A cell aside, in units; lowered (sitting, crouched, under a blanket); squash and stretch; a lean; turned over onto its back (0 to 1); a free spin. */
  dx: number
  drop: number
  sx: number
  sy: number
  tilt: number
  flat: number
  spin: number
  eyeX: number
  eyeY: number
  eyeOpen: number
  /** Usagi's mouth: 0 small, 1 wide open. */
  mouth: number
  /** Each arm raised (radians, 0 at rest), and the right arm reaching out (0 to 1). */
  armL: number
  armR: number
  reach: number
  legs: readonly [number, number, number, number]
  /** Legs drawn up (1) or long (negative); folded away under it (1). */
  tuck: number
  hideLegs: number
  laptop: number
  blanket: number
  /** Usagi's ears: lowered (1), drooping (1), trailing a walk (−1 to 1, past it streaming); each turned outward a twitch or a quirk's worth (radians). */
  earsDown: number
  droop: number
  trail: number
  earL: number
  earR: number
  eyes: EyeKind
  /** Usagi's mouth's shape; absent, its small open one (wide open by `mouth`). */
  mouthShape?: MouthShape
  /** The propeller's turn while it flies. */
  cap?: number
  hatOff: boolean
  beside: readonly Beside[]
}

export const NEUTRAL: FigurePose = {
  dx: 0, drop: 0, sx: 1, sy: 1, tilt: 0, flat: 0, spin: 0, eyeX: 0, eyeY: 0, eyeOpen: 1, mouth: 0, armL: 0, armR: 0, reach: 0,
  legs: [0, 0, 0, 0], tuck: 0, hideLegs: 0, laptop: 0, blanket: 0, earsDown: 0, droop: 0, trail: 0, earL: 0, earR: 0, eyes: 'normal', hatOff: false, beside: [],
}

// --- what each overlay is ---------------------------------------------------------

type Known = { kind: Beside['kind'] | 'smoke' | 'tidy' | 'laptop'; text?: string; step?: number }

/** A line's text as its overlay lays it. */
const lineOf = (overlay: Overlay): string => overlay.art.join('').replace(/\s+/g, '')

/** Usagi's shouts on the cigarette's puffs, one per two puff frames, as hooks/usagi-glyphs.ts has them. */
const PUFF_LINES: readonly string[] = SHOUTS.map(lineOf)

/** The growth spell's steps: 1 1 2 2 3 3 3 3 (hooks/mascot-sprites.ts GROWING). */
const GROWING = [0, 0, 1, 1, 2, 2, 2, 2] as const

const KNOWN: ReadonlyMap<Overlay, Known> = new Map<Overlay, Known>([
  ...THOUGHT_FRAMES.flatMap((frames, phrase) => frames.map((frame, step): [Overlay, Known] => [frame, { kind: 'thought', text: THOUGHTS[phrase] ?? '', step: GROWING[step] ?? 2 }])),
  ...OVERLAYS.zzz.map((one): [Overlay, Known] => [one, { kind: 'zzz' }]),
  ...OVERLAYS.moon.map((one): [Overlay, Known] => [one, { kind: 'moon' }]),
  ...OVERLAYS.sweat.map((one): [Overlay, Known] => [one, { kind: 'sweat' }]),
  ...OVERLAYS.clock.map((one): [Overlay, Known] => [one, { kind: 'clock' }]),
  ...OVERLAYS.blanketClock.map((one): [Overlay, Known] => [one, { kind: 'clock', step: 1 }]),
  ...OVERLAYS.ask.map((one): [Overlay, Known] => [one, { kind: 'ask' }]),
  ...OVERLAYS.tick.map((one): [Overlay, Known] => [one, { kind: 'tick' }]),
  ...OVERLAYS.cross.map((one): [Overlay, Known] => [one, { kind: 'cross' }]),
  ...OVERLAYS.startle.map((one): [Overlay, Known] => [one, { kind: 'startle' }]),
  ...OVERLAYS.pointing.map((one): [Overlay, Known] => [one, { kind: 'pointing' }]),
  ...OVERLAYS.cigarette.map((one): [Overlay, Known] => [one, { kind: 'cigarette' }]),
  ...OVERLAYS.smoke.map((one, step): [Overlay, Known] => [one, { kind: 'smoke', step }]),
  ...OVERLAYS.dizzy.map((one): [Overlay, Known] => [one, { kind: 'dizzy' }]),
  ...OVERLAYS.tidy.map((one): [Overlay, Known] => [one, { kind: 'tidy' }]),
  ...MINI_OVERLAYS.thought.map((one): [Overlay, Known] => [one, { kind: 'thought', text: '', step: 1 }]),
  ...MINI_OVERLAYS.zzz.map((one): [Overlay, Known] => [one, { kind: 'zzz' }]),
  ...MINI_OVERLAYS.laptop.map((one): [Overlay, Known] => [one, { kind: 'laptop' }]),
  ...MINI_OVERLAYS.ask.map((one): [Overlay, Known] => [one, { kind: 'ask' }]),
  ...MINI_OVERLAYS.clock.map((one): [Overlay, Known] => [one, { kind: 'clock' }]),
  ...MINI_OVERLAYS.tick.map((one): [Overlay, Known] => [one, { kind: 'tick' }]),
  ...MINI_OVERLAYS.cross.map((one): [Overlay, Known] => [one, { kind: 'cross' }]),
  ...MINI_OVERLAYS.dizzy.map((one): [Overlay, Known] => [one, { kind: 'dizzy' }]),
])

/** Usagi barely talks: in its thought cloud, its phrase at the same place in its list (hooks/usagi-sprites.ts). */
const usagiLine = (phrase: string): string => USAGI_THOUGHTS[THOUGHTS.indexOf(phrase as (typeof THOUGHTS)[number])] ?? phrase

// --- a look as a pose ---------------------------------------------------------------

const HEAD_EYES: Readonly<Record<Look['head'], { x: number; y: number; open: number; eyes: EyeKind }>> = {
  open: { x: 0, y: 0, open: 1, eyes: 'normal' },
  left: { x: -0.7, y: 0, open: 1, eyes: 'normal' },
  right: { x: 0.7, y: 0, open: 1, eyes: 'normal' },
  up: { x: 0.25, y: -0.7, open: 1, eyes: 'normal' },
  shut: { x: 0, y: 0.2, open: 0.08, eyes: 'normal' },
  spiral: { x: 0, y: 0, open: 1, eyes: 'spiral' },
  spin: { x: 0, y: 0, open: 1, eyes: 'spiral' },
  down: { x: 0, y: 0.6, open: 0.6, eyes: 'down' },
  wide: { x: 0, y: -0.1, open: 1, eyes: 'wide' },
}

const ARMS: Readonly<Record<Look['arms'], [number, number, number]>> = {
  rest: [0, 0, 0],
  low: [-0.35, -0.35, 0],
  up: [1.45, 1.45, 0],
  raised: [0.05, 1.5, 0],
  point: [0, 0.08, 1],
}

/** What else the pose reads: who, its motion, the person's touches, the scene's cues and phase, the time. */
export type PoseContext = {
  character: 'clawd' | 'usagi'
  /** The scene's time, ms: what blinks, breathes, walks and spins run on. */
  now: number
  /** A number of its own, so no two blink or breathe together. */
  seed: number
  motion?: Motion
  facing?: 'left' | 'right'
  pose?: 'dangle' | 'tumble'
  cues?: readonly Cue[]
  phase?: Phase
  /** The session's tidy-up running this long, or its stretch after a compaction. */
  tidyMs?: number
  stretchMs?: number
  mini?: boolean
}


/** A blink every three to five seconds, its own times by `seed`. */
export const blinkAt = (t: number, seed: number): number => {
  const cycle = 4000
  const k = Math.floor((t + seed * 997) / cycle)
  const x = Math.sin(k * 127.1 + seed * 311.7) * 43758.5453
  const d = t + seed * 997 - (k * cycle + 600 + (x - Math.floor(x)) * 2600)
  if (d < 0 || d > 230) return 1
  if (d < 70) return 1 - 0.92 * (d / 70) ** 3
  if (d < 120) return 0.08

  return 0.08 + 0.92 * (1 - (1 - (d - 120) / 110) ** 3)
}

/**
 * What is beside it, by the overlays it has, Usagi's way for Usagi (hooks/usagi-glyphs.ts):
 * its phrases in the thought cloud, `Haa?!` startled, and for the
 * cigarette a shout on each puff (`puffing`, hands up); the scene's phase and
 * cues for what it holds.
 */
const besideOf = (overlays: readonly Overlay[], context: PoseContext, desk: boolean): { beside: Beside[]; laptop: boolean; tidy: boolean; puffing: boolean } => {
  const usagi = context.character === 'usagi'
  const beside: Beside[] = []
  let laptop = desk
  let tidy = false
  let smoking = false
  let cigarette = false
  let puff: number | undefined
  for (const overlay of overlays) {
    const known = KNOWN.get(overlay)
    if (known === undefined) continue
    switch (known.kind) {
      case 'thought': {
        const text = known.step === 2 ? (known.text ?? '') : ''
        beside.push({ kind: 'thought', text: usagi && text !== '' ? usagiLine(text) : text, grow: (known.step ?? 0) / 2 })
        break
      }
      case 'laptop':
        laptop = true
        break
      case 'tidy':
        tidy = true
        break
      case 'smoke':
        smoking = true
        if (overlay.art.some(row => row.trim() !== '')) puff = known.step
        break
      case 'clock':
        beside.push(known.step === 1 ? { kind: 'clock', floor: true } : { kind: 'clock' })
        break
      case 'cross':
        beside.push({ kind: 'cross' })
        break
      case 'startle':
        beside.push(usagi ? { kind: 'shout', text: lineOf(STARTLED) } : { kind: 'startle' })
        break
      case 'cigarette':
        cigarette = true
        break
      default:
        beside.push({ kind: known.kind } as Beside)
    }
  }
  // Clawd smokes; Usagi throws its hands up and shouts on each puff instead.
  const puffing = usagi && cigarette && puff !== undefined
  if (!usagi && (cigarette || smoking)) beside.push({ kind: 'cigarette' })
  if (puffing) beside.push({ kind: 'shout', text: PUFF_LINES[Math.floor((puff ?? 0) / 2)] ?? '' })
  // What changes hands in a scene: the report on its way back and handed over, the task held out, the baton.
  const phase = context.phase?.kind
  if (phase === 'deliver' || (phase === 'hand' && context.phase?.kind === 'hand' && context.phase.step === 0)) beside.push({ kind: 'paper' })
  if (phase === 'baton' && context.phase?.kind === 'baton' && context.phase.step === 0) beside.push({ kind: 'baton' })
  if (context.cues?.includes('give-scroll') === true) beside.push({ kind: 'scroll' })

  return { beside, laptop, tidy, puffing }
}

const LEG_LIFTS: Readonly<Record<Look['legs'], readonly [number, number, number, number]>> = {
  stand: [0, 0, 0, 0],
  step: [0.7, 0, 0.7, 0],
  pass: [0, 0, 0, 0],
  back: [0, 0.7, 0, 0.7],
  tuck: [0, 0, 0, 0],
  stretch: [0, 0, 0, 0],
  shuffleLeft: [0.5, 0, 0, 0.5],
  shuffleRight: [0, 0.5, 0.5, 0],
  none: [0, 0, 0, 0],
}

/** A full mascot's look as its pose's target, before easing: its eyes, arms, legs, how it stands, what is beside it. */
export const fullTarget = (look: Look, context: PoseContext): FigurePose => {
  const eyes = HEAD_EYES[look.head]
  const [armL, armR, reach] = look.armsUp === true ? [1.45, 1.45, 0] : ARMS[look.arms]
  const { beside, laptop, tidy, puffing } = besideOf(look.overlays, context, look.desk === true)
  const usagi = context.character === 'usagi'
  // Usagi getting up after a fall, crouched: dazed.
  if (usagi && look.pose === 'crouch') beside.push({ kind: 'shout', text: lineOf(DAZED) })
  const handsUp = puffing && (look.pose === 'stand' || look.pose === 'blanket')
  const pose: FigurePose = {
    ...NEUTRAL,
    dx: 2 * (look.nudge ?? 0),
    tilt: 0.07 * (look.lean ?? 0),
    eyeX: eyes.x,
    eyeY: eyes.y,
    eyeOpen: eyes.open,
    eyes: eyes.eyes,
    mouth: puffing || (look.armsUp === true && look.pose === 'stand') ? 1 : 0,
    armL: handsUp ? 1.45 : armL,
    armR: handsUp ? 1.45 : armR,
    reach: look.reach === true ? 0.6 : reach,
    legs: LEG_LIFTS[look.legs],
    tuck: look.legs === 'tuck' ? 1 : look.legs === 'stretch' ? -0.6 : 0,
    hideLegs: look.legs === 'none' ? 1 : 0,
    laptop: laptop ? 1 : 0,
    trail: usagi && look.lean !== undefined ? -look.lean : 0,
    ...(look.cap === undefined ? {} : { cap: 0 }),
    hatOff: look.hatOff === true,
    beside,
  }
  switch (look.pose) {
    case 'sit':
      Object.assign(pose, usagi ? { sx: 1.08, sy: 0.94, hideLegs: 1, earsDown: 1 } : { drop: 2.2, hideLegs: 1 })
      break
    case 'crouch':
      Object.assign(pose, usagi ? { sx: 1.1, sy: 0.9, hideLegs: 1, earsDown: 1, armL: -0.9, armR: -0.9 } : { drop: 1.4, tuck: 0.8, armL: -0.95, armR: -0.95 })
      break
    case 'squash':
      Object.assign(pose, { sx: 1.16, sy: 0.74, earsDown: usagi ? 1 : 0 })
      break
    case 'flat':
      Object.assign(pose, { flat: 1, earsDown: 0 })
      break
    case 'blanket':
      Object.assign(pose, { blanket: 1, drop: usagi ? 0 : 0.5, hideLegs: 1, earsDown: usagi ? 1 : 0, mouth: 0 })
      break
    case 'stand':
      break
  }
  // Usagi slumped under its cross: its ears droop, where no hat or crown holds them up (hooks/smooth-art.ts); unimpressed (`hmph`), they stay up.
  if (usagi && look.pose === 'sit' && look.lids !== 'hmph' && beside.some(one => one.kind === 'cross')) pose.droop = 1
  // Usagi's lids half down: bored, drowsy (eyes low), or unimpressed, `hmph`, a smug smile with them.
  if (usagi && look.lids !== undefined) Object.assign(pose, { eyes: 'half', eyeOpen: 1, eyeX: 0, eyeY: look.lids === 'drowsy' ? 0.2 : 0, ...(look.lids === 'hmph' ? { mouthShape: 'smirk', mouth: 0 } : {}) })
  if (tidy && context.tidyMs === undefined) pose.beside = [...pose.beside, { kind: 'props', props: tidyPose(0).props }]

  return pose
}

/** A mini's look as its pose's target. */
export const miniTarget = (look: MiniLook, context: PoseContext): FigurePose => {
  const eyes = HEAD_EYES[look.head === 'shut' ? 'shut' : look.head === 'left' ? 'left' : look.head === 'right' ? 'right' : 'open']
  const { beside, laptop } = besideOf(look.overlays, context, false)

  return {
    ...NEUTRAL,
    eyeX: eyes.x,
    eyeY: eyes.y,
    eyeOpen: eyes.open,
    legs: look.legs === 'step' ? [0.7, 0, 0.7, 0] : look.legs === 'tap' ? [0, 0.5, 0, 0.5] : [0, 0, 0, 0],
    hideLegs: look.sit || look.legs === 'none' ? 1 : 0,
    drop: look.sit && context.character === 'clawd' ? 2 : 0,
    earsDown: look.sit ? 1 : 0,
    laptop: laptop ? 1 : 0,
    beside,
  }
}

/**
 * The session's own: tidying up and its stretch after a compaction, drawn by
 * time (hooks/clawd-moves.ts), while it stands where it is (not walking,
 * flying, knocked down or in the person's hand: the look's own then).
 */
const sessionMoves = (pose: FigurePose, context: PoseContext): FigurePose => {
  if (context.motion !== undefined || context.pose !== undefined) return pose
  const moved = context.tidyMs !== undefined ? tidyPose(context.tidyMs) : context.stretchMs !== undefined && context.stretchMs < STRETCH_MS ? stretchPose(context.stretchMs) : undefined
  if (moved === undefined) return pose

  return {
    ...pose,
    dx: pose.dx + moved.x,
    sx: moved.sx,
    sy: moved.sy,
    tilt: moved.tilt,
    eyeX: moved.eyes.dx,
    eyeY: moved.eyes.dy,
    eyeOpen: moved.eyes.open,
    eyes: moved.eyes.happy === true ? 'happy' : 'normal',
    armL: moved.arms.left,
    armR: moved.arms.right,
    reach: 0,
    laptop: 0,
    mouth: moved.eyes.happy === true ? 1 : 0,
    beside: [...pose.beside.filter(one => one.kind !== 'props'), { kind: 'props', props: moved.props }],
  }
}

/** The look's target with what only time draws: the session's moves, a walk's legs, a dangle's kicks, a throw's spin, the propeller. */
export const targetOf = (look: Look | MiniLook, context: PoseContext, mini: boolean): FigurePose => {
  let pose = mini ? miniTarget(look as MiniLook, context) : fullTarget(look as Look, context)
  pose = sessionMoves(pose, context)
  const t = context.now
  // Usagi toddles, and bounds far (hooks/usagi-moves.ts).
  const usagi = context.character === 'usagi' && !mini && pose.flat === 0
  if (usagi && context.motion?.kind === 'walk') return toddlePose(pose, t, context.facing, context.seed)
  if (usagi && context.motion?.kind === 'hop' && context.motion.u !== undefined) return boundPose(pose, context.motion.u, context.motion.from ?? 0, context.facing, context.seed)
  if (context.motion?.kind === 'walk' && pose.hideLegs < 0.5 && pose.flat === 0) {
    const step = wave(t, 520, context.seed)
    const dir = context.facing === 'left' ? -1 : 1
    pose = { ...pose, legs: [0.75 * Math.max(0, step), 0.75 * Math.max(0, -step), 0.75 * Math.max(0, step), 0.75 * Math.max(0, -step)], tilt: pose.tilt + 0.05 * dir, armL: pose.armL + 0.25 * step, armR: pose.armR - 0.25 * step, trail: context.character === 'usagi' ? -dir : 0 }
  }
  if (context.pose === 'dangle') pose = { ...pose, legs: [0.9 * Math.max(0, wave(t, 240)), 0.9 * Math.max(0, -wave(t, 240)), 0.9 * Math.max(0, wave(t, 240)), 0.9 * Math.max(0, -wave(t, 240))], tilt: 0.12 * wave(t, 900) }
  if (context.pose === 'tumble') pose = { ...pose, spin: (t / 1000) * 7 }
  if (pose.cap !== undefined) pose = { ...pose, cap: (t / 1000) * 30 }
  if (pose.laptop > 0.5 && pose.reach > 0) pose = { ...pose, armR: pose.armR - 0.35 + 0.18 * wave(t, 400) }

  return pose
}

// --- easing between frames ---------------------------------------------------------------

/** The numbers a spring eases (overshooting, so a squash bounces back), and those that simply glide. */
const SPRUNG = ['dx', 'drop', 'sx', 'sy', 'tilt', 'flat'] as const
const GLIDING = { eyeX: 45, eyeY: 45, eyeOpen: 35, mouth: 60, armL: 70, armR: 70, reach: 80, tuck: 70, hideLegs: 90, laptop: 140, blanket: 220, earsDown: 90, droop: 160, trail: 120, earL: 50, earR: 50 } as const
/** Each spring's frequency (Hz) and damping. */
const SPRINGS: Readonly<Record<(typeof SPRUNG)[number], [number, number]>> = { dx: [7, 0.8], drop: [5, 0.55], sx: [6, 0.38], sy: [6, 0.38], tilt: [4, 0.5], flat: [2.6, 0.7] }

type Held = { pose: FigurePose; v: Record<(typeof SPRUNG)[number], number>; at: number }

/** One mascot's pose eased toward each frame's target: what a smooth scene keeps from frame to frame, by id. */
export type Smoother = { ease: (id: string, target: FigurePose, now: number) => FigurePose; keep: (ids: ReadonlySet<string>) => void }

export const createSmoother = (): Smoother => {
  const held = new Map<string, Held>()

  return {
    ease: (id, target, now) => {
      const before = held.get(id)
      // The same moment drawn again (a surface's redraw): the pose it already has.
      if (before !== undefined && now === before.at) return before.pose
      // New, or a jump in time (back, a pause, a reload): straight to the target.
      if (before === undefined || now < before.at || now - before.at > 500) {
        held.set(id, { pose: target, v: { dx: 0, drop: 0, sx: 0, sy: 0, tilt: 0, flat: 0 }, at: now })

        return target
      }
      const dt = now - before.at
      const pose: FigurePose = { ...target }
      const v = { ...before.v }
      for (const key of SPRUNG) {
        const [hz, damping] = SPRINGS[key]
        const k = (2 * Math.PI * hz) ** 2
        const c = 2 * damping * 2 * Math.PI * hz
        let x = before.pose[key]
        let speed = v[key]
        // Small steps, so a long frame stays stable.
        for (let left = dt; left > 0; left -= 8) {
          const h = Math.min(8, left) / 1000
          speed += (k * (target[key] - x) - c * speed) * h
          x += speed * h
        }
        pose[key] = x
        v[key] = speed
      }
      for (const [key, tau] of Object.entries(GLIDING) as [keyof typeof GLIDING, number][]) {
        const a = 1 - Math.exp(-dt / tau)
        pose[key] = before.pose[key] + (target[key] - before.pose[key]) * a
      }
      const a = 1 - Math.exp(-dt / 40)
      pose.legs = target.legs.map((one, index) => (before.pose.legs[index] ?? 0) + (one - (before.pose.legs[index] ?? 0)) * a) as unknown as FigurePose['legs']
      held.set(id, { pose, v, at: now })

      return pose
    },
    keep: ids => {
      for (const id of held.keys()) if (!ids.has(id)) held.delete(id)
    },
  }
}

/** Over the eased pose, what must never lag a frame: the blink and the breath; Usagi's ears' twitches. */
export const livelyOf = (pose: FigurePose, context: PoseContext, still: boolean): FigurePose => {
  const t = context.now
  const blink = pose.eyes === 'normal' && pose.eyeOpen > 0.5 ? blinkAt(t, context.seed) : 1
  const breath = still && pose.flat < 0.05 && pose.blanket < 0.5 ? wave(t, 2700, context.seed) : 0
  const [twitchL, twitchR] = context.character === 'usagi' && pose.blanket < 0.5 && pose.flat < 0.05 ? earTwitch(t, context.seed) : [0, 0]

  return { ...pose, eyeOpen: pose.eyeOpen * blink, sx: pose.sx * (1 - 0.01 * breath), sy: pose.sy * (1 + 0.018 * breath), earL: pose.earL + twitchL, earR: pose.earR + twitchR }
}
