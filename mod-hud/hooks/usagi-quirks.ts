import type { Look } from './mascot-poses'
import { OVERLAYS } from './mascot-sprites'
import type { Overlay } from './mascot-sprites'
import { hashOf } from './motion-rules'
import { SCENE_FRAME_MS } from './scene-phases'
import { QUIRK_SHOUTS } from './usagi-sprites'

// Usagi's quirks: as Chiikawa's Usagi does, out of nowhere, a burst of
// something. Standing free: the Yaha! dance, an Ura! leap, a HUHHH? lean-in,
// a smug Fuun, zoomies, a twirl, a backflip, an UNA! shake; at its laptop,
// bashing the keys. Which, when and for how long by its id and the scene's
// time alone, so the cells (`quirkLook`, hooks/scene-placement.ts) and the
// shapes (hooks/usagi-moves.ts) play the same one at the same moment.

export type QuirkKind = 'yaha' | 'ura' | 'huh' | 'fuun' | 'zoom' | 'twirl' | 'flip' | 'shake' | 'bash'

/** How long each lasts, ms. */
export const QUIRK_MS: Readonly<Record<QuirkKind, number>> = { yaha: 2000, ura: 1400, huh: 1300, fuun: 1700, zoom: 1600, twirl: 1200, flip: 1300, shake: 1000, bash: 1500 }

/** What it shouts through each. */
export const QUIRK_SAYS: Readonly<Record<QuirkKind, string>> = { yaha: 'Yaha!', ura: 'Ura!', huh: 'HUHHH?', fuun: 'Fuun', zoom: 'Uraaa!', twirl: 'Puruya', flip: 'Yaha!', shake: 'UNA!', bash: 'Ura!' }

/** Where it is when one comes over it: standing free (anything goes), or at its laptop (what it can do there). */
export type QuirkPlace = 'free' | 'desk'

/** Each place's quirks and how likely each is. */
const KINDS: Readonly<Record<QuirkPlace, readonly (readonly [QuirkKind, number])[]>> = {
  free: [['yaha', 3], ['ura', 3], ['huh', 2], ['fuun', 2], ['zoom', 2], ['twirl', 2], ['flip', 1], ['shake', 2]],
  desk: [['bash', 4], ['huh', 2], ['shake', 2], ['yaha', 1]],
}

/** Three five-second windows in four have a quirk somewhere in them (one every six or seven seconds); one ends before its window does. */
export const QUIRK_WINDOW_MS = 5000
const QUIRK_CHANCE = 75
const LONGEST = Math.max(...Object.values(QUIRK_MS))

/** A quirk under way: which, and how far into it (ms). */
export type Quirk = { kind: QuirkKind; at: number }

const pick = (table: readonly (readonly [QuirkKind, number])[], roll: number): QuirkKind => {
  const total = table.reduce((sum, [, weight]) => sum + weight, 0)
  let left = roll % total
  for (const [kind, weight] of table) {
    if (left < weight) return kind
    left -= weight
  }

  return table[0]?.[0] ?? 'yaha'
}

/** The quirk Usagi `id` is in at `now` (the scene's time, ms) where it is; undefined between them. */
export const quirkAt = (id: string, now: number, place: QuirkPlace): Quirk | undefined => {
  // Each Usagi's windows start at a time of its own, so no two burst out together.
  const offset = hashOf(id, 'quirk') % QUIRK_WINDOW_MS
  const window = Math.floor((now + offset) / QUIRK_WINDOW_MS)
  if (hashOf(id, 'quirk', window) % 100 >= QUIRK_CHANCE) return undefined
  const kind = pick(KINDS[place], hashOf(id, 'quirk-kind', window))
  const start = window * QUIRK_WINDOW_MS - offset + (hashOf(id, 'quirk-at', window) % (QUIRK_WINDOW_MS - LONGEST))
  const at = now - start

  return at >= 0 && at < QUIRK_MS[kind] ? { kind, at } : undefined
}

/** What may be beside it while a quirk comes over it: its sweat drop, its laptop's. */
const KEPT: ReadonlySet<Overlay> = new Set<Overlay>(OVERLAYS.sweat)

/**
 * Where a look leaves Usagi room for a quirk: standing on its floor with
 * nothing beside it but its sweat drop, free or at its laptop; none while
 * it thinks, asks, sleeps, sits, is down, done or failed (`look` alone
 * tells), nor while the scene moves it or the person holds it (the caller's).
 */
export const quirkPlaceOf = (look: Look): QuirkPlace | undefined => {
  if (look.pose !== 'stand' || look.lift !== 0 || look.cap !== undefined || look.armsUp === true || look.arms === 'raised') return undefined
  if (look.overlays.some(one => !KEPT.has(one))) return undefined

  return look.desk === true ? 'desk' : 'free'
}

/**
 * A quirk as the cells draw it: the look it changes, frame by frame (a
 * SCENE_FRAME_MS each), its line over its head. The Yaha! dance and the
 * shake a cell either way in turn; the leap and the backflip a row up where
 * the sky has one, a squash either side; zoomies a cell either way in
 * stride; the twirl its head and arms either way; at the laptop, its hands
 * up and down on the keys.
 */
export const quirkLook = (look: Look, quirk: Quirk): Look => {
  const frame = Math.floor(quirk.at / SCENE_FRAME_MS)
  const last = Math.ceil(QUIRK_MS[quirk.kind] / SCENE_FRAME_MS) - 1
  const says = QUIRK_SHOUTS[QUIRK_SAYS[quirk.kind]]
  const overlays = says === undefined ? look.overlays : [...look.overlays, says]
  const turn = frame % 2 === 0
  switch (quirk.kind) {
    case 'yaha':
      return { ...look, arms: 'up', armsUp: true, nudge: turn ? -1 : 1, head: 'shut', overlays }
    case 'ura':
      return frame === 0 || frame >= last ? { ...look, pose: 'squash', overlays } : { ...look, arms: 'up', armsUp: true, bob: true, head: 'wide', overlays }
    case 'huh':
      return { ...look, head: 'wide', overlays }
    case 'fuun':
      return { ...look, head: 'shut', arms: 'low', overlays }
    case 'zoom':
      return { ...look, nudge: turn ? -1 : 1, legs: turn ? 'step' : 'back', lean: turn ? -1 : 1, overlays }
    case 'twirl':
      return { ...look, head: turn ? 'left' : 'right', arms: turn ? 'point' : 'rest', overlays }
    case 'flip':
      return frame === 0 || frame >= last ? { ...look, pose: 'squash', overlays } : { ...look, arms: 'up', armsUp: true, bob: true, head: 'shut', overlays }
    case 'shake':
      return { ...look, nudge: turn ? -1 : 1, head: 'shut', overlays }
    case 'bash':
      return turn ? { ...look, arms: 'up', armsUp: true, reach: false, head: 'shut', overlays } : { ...look, reach: true, head: 'shut', overlays }
  }
}
