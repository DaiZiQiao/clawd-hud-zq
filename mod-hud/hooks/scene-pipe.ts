import type { Cell } from './scene-types'

// The warp pipe an agent arrives by and, its work done, leaves by: a red pipe
// lowered from the top of the scene over its spot, mouth down. Arriving, the
// mascot drops out of the mouth to the floor and the pipe goes back up; done,
// the pipe comes down over it again, sucks it up, and goes. Pure: the art and
// the timeline, in rows above the mascot's place on its floor (its lift).

/** The pipe's red, and the lighter stripe down it: each 3:1 or more on #282a36 and #eff1f5. */
export const PIPE_COLOUR = '#D9382E'
export const PIPE_SHINE = '#E8584E'

/** The lip's cells across (the shaft a cell narrower each side), over a full mascot and over a mini. */
export const PIPE_WIDTH = { full: 9, mini: 5 } as const
/** Where the lip starts in the sprite's columns: over a full mascot's figure (box columns 2 to 10), over a mini's whole width. */
export const PIPE_X = { full: 2, mini: 0 } as const
const SHINE_X = { full: 2, mini: 1 } as const

/**
 * The pipe, `rows` tall from the ceiling down to its mouth: the shaft, the
 * lip's top half beside the shaft's last row, then the lip, all in the red
 * but for a lighter stripe down its left. A stretched mascot (arms up, legs
 * long) fits the shaft.
 */
export const pipeCells = (kind: keyof typeof PIPE_WIDTH, rows: number): (Cell | undefined)[][] => {
  const width = PIPE_WIDTH[kind]
  const count = Math.max(0, Math.floor(rows))
  const cell = (ch: string, x: number): Cell => ({ ch, ink: 'k', colour: x === SHINE_X[kind] ? PIPE_SHINE : PIPE_COLOUR })

  return Array.from({ length: count }, (_, y) => Array.from({ length: width }, (_, x) => {
    if (y === count - 1 || (x > 0 && x < width - 1)) return cell('█', x)

    return y === count - 2 ? cell('▄', x) : undefined
  }))
}

/** The pipe comes down, or goes back up, in this long; a mascot falls out of it in this long, and is sucked up in this long. */
export const PIPE_SLIDE_MS = 500
export const PIPE_DROP_MS = 500
export const PIPE_SUCK_MS = 1000
/** A farewell is over (the pipe gone) after this long. */
export const PIPE_FAREWELL_MS = PIPE_SLIDE_MS + PIPE_SUCK_MS + PIPE_SLIDE_MS
/** The most rows a mascot falls out of the pipe. */
export const PIPE_DROP_MAX = 3

/**
 * One moment of a pipe scene, in rows above the mascot's place on its floor:
 * `mouth` the lip's row (absent: no pipe drawn), `lift` the mascot's, and
 * `inside` while the mascot is hidden in the pipe.
 */
export type PipeFrame = { mouth?: number; lift: number; inside: boolean }

/**
 * Where the pipe hangs over a mascot with `sky` rows free above its box (the
 * first line's headroom; none on a lower line): its lip a row above the box
 * with up to three rows to fall, a row of shaft over it where there is room;
 * with no sky, on the box's own air row.
 */
export const pipeHang = (sky: number): { mouth: number; drop: number } => {
  const free = Math.max(0, Math.floor(sky))
  const drop = Math.min(PIPE_DROP_MAX, Math.max(0, free - 2))

  return { mouth: Math.min(drop + 1, free), drop }
}

const smooth = (t: number): number => {
  const u = Math.min(1, Math.max(0, t))

  return u * u * (3 - 2 * u)
}

/** The lip from just above the ceiling (`sky + 1`, out of sight) down to where it hangs, or back. */
const slid = (sky: number, hang: number, t: number): number | undefined => {
  const mouth = sky + 1 + (hang - sky - 1) * smooth(t)

  return mouth > sky + 0.5 ? undefined : mouth
}

/** Spawns this close after a batch's first share its pipe, popping out one after another. */
export const PIPE_BATCH_MS = 2000

/**
 * A batch sharing one pipe, from each one's spawn (ms on one clock, the first
 * the earliest): when each drops out of the mouth (never before it spawned,
 * never before the pipe is down, a drop's length after the one before), and
 * when the pipe goes back up (the last one on the floor). One alone drops at
 * PIPE_SLIDE_MS and the pipe goes up at PIPE_SLIDE_MS + PIPE_DROP_MS.
 */
export const pipeBatch = (spawns: readonly number[]): { drops: number[]; up: number } => {
  const start = spawns[0] ?? 0
  const drops: number[] = []
  for (const at of spawns) drops.push(Math.max(start + PIPE_SLIDE_MS, at, (drops.at(-1) ?? -Infinity) + PIPE_DROP_MS))

  return { drops, up: (drops.at(-1) ?? start + PIPE_SLIDE_MS) + PIPE_DROP_MS }
}

/**
 * A batch's pipe `ms` after its first spawn, in rows above the anchor's place
 * on its floor: coming down, hanging while the batch drops out, going back up
 * once the last is on the floor (`up` ms after the first spawn); undefined
 * while out of sight.
 */
export const batchPipeAt = (ms: number, sky: number, up: number): number | undefined => {
  const { mouth } = pipeHang(sky)
  const free = Math.max(0, Math.floor(sky))
  if (ms < 0) return undefined
  if (ms < PIPE_SLIDE_MS) return slid(free, mouth, ms / PIPE_SLIDE_MS)
  if (ms < up) return mouth
  if (ms < up + PIPE_SLIDE_MS) return slid(free, mouth, 1 - (ms - up) / PIPE_SLIDE_MS)

  return undefined
}

/**
 * One mascot of a batch `ms` after its own drop began: inside the pipe
 * before it, then out of the mouth, falling ever faster to the floor from the
 * hang's `drop` rows; `u` how far through its fall (0 to 1).
 */
export const droppedAt = (ms: number, sky: number): { lift: number; inside: boolean; u: number } => {
  const { drop } = pipeHang(sky)
  if (ms < 0) return { lift: drop, inside: true, u: 0 }
  const u = Math.min(1, ms / PIPE_DROP_MS)

  return { lift: drop * (1 - u * u), inside: false, u }
}

/**
 * A farewell `ms` into its leaving: the pipe comes down over the mascot, the
 * mascot is sucked up, faster and faster, through the mouth until its feet
 * are in, the pipe goes back up with it; from PIPE_FAREWELL_MS, nothing.
 */
export const farewellAt = (ms: number, sky: number): PipeFrame => {
  const { mouth } = pipeHang(sky)
  const free = Math.max(0, Math.floor(sky))
  // Its feet past the lip: the box's four rows above it.
  const top = mouth + 4
  if (ms < PIPE_SLIDE_MS) {
    const at = slid(free, mouth, ms / PIPE_SLIDE_MS)

    return { ...(at === undefined ? {} : { mouth: at }), lift: 0, inside: false }
  }
  if (ms < PIPE_SLIDE_MS + PIPE_SUCK_MS) {
    const u = (ms - PIPE_SLIDE_MS) / PIPE_SUCK_MS

    return { mouth, lift: top * u * u, inside: false }
  }
  if (ms < PIPE_FAREWELL_MS) {
    const at = slid(free, mouth, 1 - (ms - PIPE_SLIDE_MS - PIPE_SUCK_MS) / PIPE_SLIDE_MS)

    return { ...(at === undefined ? {} : { mouth: at }), lift: top, inside: true }
  }

  return { lift: top, inside: true }
}
