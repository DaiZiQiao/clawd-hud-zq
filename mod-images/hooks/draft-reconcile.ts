import type { ImagesFormat, ImagesProvenance, ImagesTile } from '../types'
import { chipIdsOf } from './draft-chips'
import type { StoreFile, StoreListing } from './store-path'

// Which of the draft's chips Claude Code will send a picture for, and what
// the strip shows for each. Claude Code attaches an image when it is pasted
// or dragged in and writes it to the session's image folder in the same
// moment; a chip that arrives any other way (typed, recalled from history,
// an id of another session) carries no image, and its number may name a
// different picture in this session's folder. So a chip counts as attached
// once it is seen together with a fresh write of its file (`pasted`), and
// stops counting once a sent prompt carried it (`sent`): a chip recalled after
// that is plain text. Both marks are sticky and live in `$.state` with the
// time each chip was first seen; /clear wipes them with the draft.
//
// Every refresh reconciles the draft's text, one listing of the image folder
// and what the decoder knows into the tiles. A file missing for a moment (the
// write still under way, a scanner holding it, the rewrite at submit) never
// costs a decoded picture, and a missing file is looked for again on every
// call. Pure: the hooks module brings the draft, the listing, the clock and
// the decoder's facts.

/** A file written this long before its chip was first seen still counts as pasted with it. */
export const FRESH_MS = 10_000
/** A chip waits this long for its file before its tile reads `not attached` (`not found` when it was pasted, or with no folder). */
export const PENDING_MS = 3_000
/** Entries each provenance record keeps, the oldest dropped first; never those of chips in the draft. */
export const PROVENANCE_CAP = 256

/** A refresh this often while a chip waits for its file. */
export const POLL_WAITING_MS = 100
/** This often while the strip shows tiles: a chip backspaced away goes within it. */
export const POLL_SHOWN_MS = 250
/** This often while the draft has text but no chips. */
export const POLL_DRAFT_MS = 1_000
/** This often while the draft is empty: a safety net under the events that wake a refresh. */
export const POLL_IDLE_MS = 3_000

/** Provenance with nothing seen, pasted or sent: a new session's. */
export const EMPTY_PROVENANCE: ImagesProvenance = Object.freeze({
  seen: Object.freeze({}),
  pasted: Object.freeze({}),
  sent: Object.freeze({}),
})

/** What the decoder knows of an attached chip's picture: under way, in memory, or not to be had (and why). */
export type DecodeFacts = { state: 'reading' | 'ready' | 'failed'; format?: ImagesFormat; width?: number; height?: number; reason?: string }

export type ReconcileInput = {
  /** `$.clock.now()`. */
  now: number
  /** `$.prompt.read().text`. */
  draftText: string
  prov: ImagesProvenance
  /** The session's image folder as listed now; undefined when there is none (yet, or at all). */
  listing: StoreListing | undefined
  /** A tile's reason when there is no listing and its wait is over: `not found`, or `no preview` when Claude Code keeps no folder. */
  missingReason: string
  /** The decoder's facts for an id, or undefined when it holds none. */
  decoded: (id: number) => DecodeFacts | undefined
}

export type ReconcileOutput = {
  /** The draft's chips, ascending id. */
  tiles: ImagesTile[]
  /** First sights and pastes recorded, every record capped: JSON, and the input object itself when nothing changed. */
  prov: ImagesProvenance
  /** Attached chips with a file and no decode facts, ascending id: what to decode. */
  toDecode: StoreFile[]
  /** Some chip still waits for its file: refresh soon. */
  waiting: boolean
}

/** A failed picture with no reason given reads as this. */
const UNREADABLE = "can't read"
/** A pasted chip whose file the listing in hand lacks, once the wait is over. */
const NOT_FOUND = 'not found'

const FORMAT_OF_EXT: Record<StoreFile['ext'], ImagesFormat> = { png: 'png', jpg: 'jpeg', gif: 'gif', webp: 'webp' }

// A tile as `$.state` holds it: JSON, every key left out rather than
// undefined (or a size that is not a number JSON can carry).
const tileOf = (id: number, state: ImagesTile['state'], seenAt: number, facts: Partial<DecodeFacts> = {}): ImagesTile => ({
  id,
  state,
  ...(facts.format === undefined ? {} : { format: facts.format }),
  ...(facts.width === undefined || !Number.isFinite(facts.width) ? {} : { width: facts.width }),
  ...(facts.height === undefined || !Number.isFinite(facts.height) ? {} : { height: facts.height }),
  ...(state !== 'failed' ? {} : { reason: facts.reason ?? UNREADABLE }),
  seenAt,
})

// The record without its oldest entries past the cap, by when each id was
// first seen (an id never seen the oldest of all, ties by id); those in
// `kept` stay whatever their age.
const cappedOf = <T>(record: Readonly<Record<string, T>>, seen: Readonly<Record<string, number>>, kept: ReadonlySet<string>): Record<string, T> => {
  const keys = Object.keys(record)
  if (keys.length <= PROVENANCE_CAP) return record
  const ageOf = (key: string): number => seen[key] ?? -Infinity
  const droppable = keys.filter(key => !kept.has(key)).sort((a, b) => (ageOf(a) - ageOf(b)) || (Number(a) - Number(b)))
  const dropped = new Set(droppable.slice(0, keys.length - PROVENANCE_CAP))

  return Object.fromEntries(Object.entries(record).filter(([key]) => !dropped.has(key)))
}

/**
 * The tiles for the draft's chips and what to do next. Each chip, first seen
 * at `seenAt`:
 * - sent: `not-attached`, whatever its file;
 * - pasted, or its file written no earlier than FRESH_MS before `seenAt`
 *   (then recorded as pasted): attached; a file older than that makes it
 *   `not-attached`;
 * - attached: the decoder's facts when it has them, even with the file
 *   missing from this listing; else, with a file, `reading` and decoded;
 * - no file yet: `pending` while its `.tmp.` file is being written or for
 *   PENDING_MS after `seenAt`. Then, with the folder listed, `not-attached`:
 *   Claude Code writes an image's file the moment it attaches it, so a chip
 *   whose file never came carries none; but a pasted chip whose file has
 *   gone is `failed`, `not found`. With no listing, `failed`: `missingReason`.
 *   A file that turns up later is judged as above.
 * A tile's `format` is its file's until the decoder says otherwise.
 */
export const reconcile = (input: ReconcileInput): ReconcileOutput => {
  const { now, listing, prov } = input
  const ids = chipIdsOf(input.draftText)
  const seen = { ...prov.seen }
  const pasted = { ...prov.pasted }
  let isChanged = false
  const tiles: ImagesTile[] = []
  const toDecode: StoreFile[] = []
  for (const id of ids) {
    const key = String(id)
    const seenAt = seen[key] ?? now
    if (seen[key] === undefined) {
      seen[key] = seenAt
      isChanged = true
    }
    if (prov.sent[key] === true) {
      tiles.push(tileOf(id, 'not-attached', seenAt))
      continue
    }
    const file = listing?.files.get(id)
    if (pasted[key] !== true && file !== undefined) {
      if (file.mtimeMs < seenAt - FRESH_MS) {
        tiles.push(tileOf(id, 'not-attached', seenAt))
        continue
      }
      pasted[key] = true
      isChanged = true
    }
    const fileFormat = file === undefined ? undefined : FORMAT_OF_EXT[file.ext]
    // Only an attached chip has a picture to decode: an unknown one has no file yet.
    const facts = pasted[key] === true ? input.decoded(id) : undefined
    if (facts !== undefined) {
      tiles.push(tileOf(id, facts.state, seenAt, { ...facts, format: facts.format ?? fileFormat }))
      continue
    }
    if (file !== undefined) {
      tiles.push(tileOf(id, 'reading', seenAt, { format: fileFormat }))
      toDecode.push(file)
      continue
    }
    const isWriting = listing?.tmpIds.has(id) === true
    if (isWriting || now - seenAt <= PENDING_MS) tiles.push(tileOf(id, 'pending', seenAt))
    else if (listing === undefined) tiles.push(tileOf(id, 'failed', seenAt, { reason: input.missingReason }))
    else tiles.push(pasted[key] === true ? tileOf(id, 'failed', seenAt, { reason: NOT_FOUND }) : tileOf(id, 'not-attached', seenAt))
  }
  const kept = new Set(ids.map(String))
  const capped = {
    seen: cappedOf(seen, seen, kept),
    pasted: cappedOf(pasted, seen, kept),
    sent: cappedOf(prov.sent, seen, kept),
  }
  const isCapped = capped.seen !== seen || capped.pasted !== pasted || capped.sent !== prov.sent

  return {
    tiles,
    prov: isChanged || isCapped ? capped : prov,
    toDecode,
    waiting: tiles.some(tile => tile.state === 'pending'),
  }
}

/**
 * Provenance with `ids` recorded as sent (`sentIdsOf` a transcript row); the
 * same object when they all were already. The next `reconcile` caps the
 * record, keeping the draft's chips.
 */
export const markSentOf = (prov: ImagesProvenance, ids: readonly number[]): ImagesProvenance => {
  const fresh = ids.filter(id => Number.isSafeInteger(id) && id >= 1 && prov.sent[String(id)] !== true)
  if (fresh.length === 0) return prov
  const sent: Record<string, true> = { ...prov.sent }
  for (const id of fresh) sent[String(id)] = true

  return { ...prov, sent }
}

/**
 * Provenance with `ids` no longer recorded as sent: Claude Code put the
 * prompt that carried them back in the box, pictures and all (a turn
 * cancelled before any answer). The same object when none was.
 */
export const unmarkSentOf = (prov: ImagesProvenance, ids: readonly number[]): ImagesProvenance => {
  const marked = ids.filter(id => prov.sent[String(id)] === true)
  if (marked.length === 0) return prov
  const sent: Record<string, true> = { ...prov.sent }
  for (const id of marked) delete sent[String(id)]

  return { ...prov, sent }
}

/** The two tile lists draw the same: a refresh writes `$.state` only when they do not. */
export const sameTilesOf = (a: readonly ImagesTile[], b: readonly ImagesTile[]): boolean =>
  a.length === b.length && a.every((tile, at) => {
    const other = b[at]

    return other !== undefined
      && tile.id === other.id
      && tile.state === other.state
      && tile.format === other.format
      && tile.width === other.width
      && tile.height === other.height
      && tile.reason === other.reason
      && tile.seenAt === other.seenAt
  })

/** How long the poll waits before its next refresh: soon while a chip waits for its file, then by what the strip and the draft hold. */
export const pollDelayOf = (draftText: string, tiles: readonly ImagesTile[], waiting: boolean): number =>
  waiting
    ? POLL_WAITING_MS
    : tiles.length > 0
      ? POLL_SHOWN_MS
      : draftText !== ''
        ? POLL_DRAFT_MS
        : POLL_IDLE_MS
