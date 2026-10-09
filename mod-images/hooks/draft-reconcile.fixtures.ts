import type { ImagesProvenance } from '../types'
import { EMPTY_PROVENANCE, markSentOf, reconcile } from './draft-reconcile'
import type { DecodeFacts, ReconcileInput, ReconcileOutput } from './draft-reconcile'
import { listingOf } from './store-path'
import type { StoreListing } from './store-path'

// The reconciler's test fixtures: one fixed instant, the image folder as a
// listing of names, the decoder's facts by id, and a session that threads its
// provenance from one refresh to the next as the hooks module does.

/** Saturday 3 October 2026, 12:00 UTC: when the first chip is seen. */
export const NOW = Date.UTC(2026, 9, 3, 12, 0, 0)

/** A stored file's bytes, whatever they are. */
const SIZE = 48_213

/** The image folder holding these names, each written at its `mtimeMs` (NOW for a bare name). */
export const folderOf = (...entries: readonly (string | { name: string; mtimeMs: number; kind?: string })[]): StoreListing =>
  listingOf(entries.map(entry => typeof entry === 'string'
    ? { name: entry, kind: 'file', size: SIZE, mtimeMs: NOW }
    : { name: entry.name, kind: entry.kind ?? 'file', size: SIZE, mtimeMs: entry.mtimeMs }))

/** The decoder knows these ids. */
export const factsOf = (facts: Readonly<Record<number, DecodeFacts>>): ((id: number) => DecodeFacts | undefined) => id => facts[id]

/** A decoded 1920 x 1080 PNG. */
export const READY_SHOT: DecodeFacts = { state: 'ready', format: 'png', width: 1920, height: 1080 }

/** One refresh's input: an empty draft and folder, nothing decoded, at NOW. */
export const inputOf = (more: Partial<ReconcileInput>): ReconcileInput => ({
  now: NOW,
  draftText: '',
  prov: EMPTY_PROVENANCE,
  listing: undefined,
  missingReason: 'not found',
  decoded: () => undefined,
  ...more,
})

/** A session whose refreshes carry their provenance on, as the hooks module keeps it in `$.state`. */
export const sessionOf = (prov: ImagesProvenance = EMPTY_PROVENANCE) => {
  let held = prov

  return {
    /** A refresh: the draft, the folder and the decoder as they stand `at` ms after NOW. */
    refresh: (at: number, more: Partial<ReconcileInput>): ReconcileOutput => {
      const output = reconcile(inputOf({ ...more, now: NOW + at, prov: held }))
      held = output.prov

      return output
    },
    /** A transcript row carried these chips with its images. */
    send: (ids: readonly number[]): void => {
      held = markSentOf(held, ids)
    },
    prov: (): ImagesProvenance => held,
  }
}

/** Nothing in the value is `undefined`: it goes into `$.state` as it is. */
export const isJson = (value: unknown): boolean =>
  value === null || typeof value !== 'object'
    ? value !== undefined && (typeof value !== 'number' || Number.isFinite(value))
    : Object.values(value).every(isJson)
