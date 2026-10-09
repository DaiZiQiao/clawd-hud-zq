import { describe, expect, test } from 'claude-code/testing'

import type { ImagesProvenance, ImagesTile } from '../types'
import {
  EMPTY_PROVENANCE,
  FRESH_MS,
  PENDING_MS,
  POLL_DRAFT_MS,
  POLL_IDLE_MS,
  POLL_SHOWN_MS,
  POLL_WAITING_MS,
  PROVENANCE_CAP,
  markSentOf,
  pollDelayOf,
  reconcile,
  sameTilesOf,
} from './draft-reconcile'
import { NOW, READY_SHOT, factsOf, folderOf, inputOf, isJson, sessionOf } from './draft-reconcile.fixtures'

// Which chips are attached, refresh by refresh: a fresh paste (folder not yet
// made, file still `.tmp.`, file landed, decoded), a file already there at
// first sight, a chip sent and then recalled, a stale recall from another
// session, a late file, a file missing for a moment after its decode, no
// image folder at all; then the provenance cap, JSON-safety, the sent marks,
// tile comparison and the poll's pace.

const SHOT_TILE = { format: 'png', width: 1920, height: 1080 } as const

describe('a paste', () => {
  test('pending until its folder and file exist, read once the file lands, ready once decoded', () => {
    const session = sessionOf()
    const draftText = 'what is this? [Image #1]'
    const first = session.refresh(0, { draftText })
    expect(first.tiles).toEqual([{ id: 1, state: 'pending', seenAt: NOW }])
    expect([first.waiting, first.toDecode, pollDelayOf(draftText, first.tiles, first.waiting)]).toEqual([true, [], POLL_WAITING_MS])
    expect(first.prov).toEqual({ seen: { 1: NOW }, pasted: {}, sent: {} })
    const writing = session.refresh(20, { draftText, listing: folderOf('1.png.tmp.6feab4d7') })
    expect([writing.tiles, writing.waiting]).toEqual([[{ id: 1, state: 'pending', seenAt: NOW }], true])
    const landed = session.refresh(40, { draftText, listing: folderOf({ name: '1.png', mtimeMs: NOW + 30 }) })
    expect(landed.tiles).toEqual([{ id: 1, state: 'reading', format: 'png', seenAt: NOW }])
    expect(landed.toDecode.map(file => file.name)).toEqual(['1.png'])
    expect([landed.waiting, pollDelayOf(draftText, landed.tiles, landed.waiting)]).toEqual([false, POLL_SHOWN_MS])
    expect(landed.prov.pasted).toEqual({ 1: true })
    const decoding = session.refresh(60, { draftText, listing: folderOf({ name: '1.png', mtimeMs: NOW + 30 }), decoded: factsOf({ 1: { state: 'reading' } }) })
    expect([decoding.tiles, decoding.toDecode]).toEqual([[{ id: 1, state: 'reading', format: 'png', seenAt: NOW }], []])
    const ready = session.refresh(250, { draftText, listing: folderOf({ name: '1.png', mtimeMs: NOW + 30 }), decoded: factsOf({ 1: READY_SHOT }) })
    expect(ready.tiles).toEqual([{ id: 1, state: 'ready', ...SHOT_TILE, seenAt: NOW }])
  })

  test('a file already there at first sight counts as pasted when written up to FRESH_MS before', () => {
    const fresh = reconcile(inputOf({ draftText: '[Image #2]', listing: folderOf({ name: '2.jpg', mtimeMs: NOW - FRESH_MS }) }))
    expect([fresh.tiles, fresh.prov.pasted]).toEqual([[{ id: 2, state: 'reading', format: 'jpeg', seenAt: NOW }], { 2: true }])
    const stale = reconcile(inputOf({ draftText: '[Image #2]', listing: folderOf({ name: '2.jpg', mtimeMs: NOW - FRESH_MS - 1 }) }))
    expect([stale.tiles, stale.toDecode, stale.prov.pasted]).toEqual([[{ id: 2, state: 'not-attached', seenAt: NOW }], [], {}])
  })

  test('several chips: tiles and decodes in ascending id, each once, whatever the text says', () => {
    const output = reconcile(inputOf({ draftText: '[Image #3] vs [Image #1], again [Image #3] and [Image #2]', listing: folderOf('1.png', '2.gif', '3.webp') }))
    expect(output.tiles.map(tile => [tile.id, tile.state, tile.format])).toEqual([[1, 'reading', 'png'], [2, 'reading', 'gif'], [3, 'reading', 'webp']])
    expect(output.toDecode.map(file => file.id)).toEqual([1, 2, 3])
  })

  test('the decoder has the last word on format and failure: a reason always given', () => {
    const listing = folderOf('1.png', '2.webp', '3.png')
    const output = reconcile(inputOf({
      draftText: '[Image #1] [Image #2] [Image #3]',
      listing,
      prov: { seen: {}, pasted: { 1: true, 2: true, 3: true }, sent: {} },
      decoded: factsOf({
        1: { state: 'failed', reason: 'too big', format: 'png', width: 9000, height: 9000 },
        2: { state: 'failed', format: 'webp', width: 640, height: 480, reason: 'no preview' },
        3: { state: 'failed' },
      }),
    }))
    expect(output.tiles).toEqual([
      { id: 1, state: 'failed', format: 'png', width: 9000, height: 9000, reason: 'too big', seenAt: NOW },
      { id: 2, state: 'failed', format: 'webp', width: 640, height: 480, reason: 'no preview', seenAt: NOW },
      { id: 3, state: 'failed', format: 'png', reason: "can't read", seenAt: NOW },
    ])
    expect(output.toDecode).toEqual([])
  })
})

describe('chips that carry no picture', () => {
  test('sent, then recalled with Up: not attached, though the submit rewrote its file a moment ago', () => {
    const session = sessionOf()
    session.refresh(0, { draftText: '[Image #1] fix this', listing: folderOf('1.png') })
    expect(session.prov().pasted).toEqual({ 1: true })
    session.send([1])
    expect(session.refresh(900, { draftText: '' }).tiles).toEqual([])
    const recalled = session.refresh(2000, { draftText: '[Image #1] fix this', listing: folderOf({ name: '1.png', mtimeMs: NOW + 850 }), decoded: factsOf({ 1: READY_SHOT }) })
    expect([recalled.tiles, recalled.toDecode, recalled.waiting]).toEqual([[{ id: 1, state: 'not-attached', seenAt: NOW }], [], false])
  })

  test('sent, then a new paste beside the recalled chips: only the new one is attached', () => {
    const session = sessionOf()
    session.refresh(0, { draftText: 'look at [Image #4] [Image #5]', listing: folderOf('4.jpg', '5.gif') })
    session.send([4, 5])
    const listing = folderOf('4.jpg', '5.gif', { name: '6.webp', mtimeMs: NOW + 5000 })
    const output = session.refresh(5100, { draftText: 'look at  [Image #4] [Image #5][Image #6]', listing })
    expect(output.tiles.map(tile => [tile.id, tile.state])).toEqual([[4, 'not-attached'], [5, 'not-attached'], [6, 'reading']])
    expect(output.toDecode.map(file => file.name)).toEqual(['6.webp'])
  })

  test('recalled from another session: this session\'s own 4 and 5 are other pictures, written minutes ago', () => {
    const listing = folderOf({ name: '4.gif', mtimeMs: NOW - 300_000 }, { name: '5.gif', mtimeMs: NOW - 290_000 })
    const output = reconcile(inputOf({ draftText: 'look at  [Image #4] [Image #5]', listing }))
    expect(output.tiles).toEqual([{ id: 4, state: 'not-attached', seenAt: NOW }, { id: 5, state: 'not-attached', seenAt: NOW }])
    expect([output.toDecode, output.prov.pasted, output.waiting]).toEqual([[], {}, false])
  })

  test('recalled from another session with no such file here: pending for PENDING_MS, then not found, never a picture', () => {
    const session = sessionOf()
    const listing = folderOf('1.png')
    expect(session.refresh(0, { draftText: '[Image #9]', listing }).tiles).toEqual([{ id: 9, state: 'pending', seenAt: NOW }])
    expect(session.refresh(PENDING_MS, { draftText: '[Image #9]', listing }).tiles[0]?.state).toBe('pending')
    const over = session.refresh(PENDING_MS + 1, { draftText: '[Image #9]', listing })
    expect([over.tiles, over.waiting, over.toDecode]).toEqual([[{ id: 9, state: 'failed', reason: 'not found', seenAt: NOW }], false, []])
  })

  test('a chip typed by hand beside an old file: not attached', () => {
    const output = reconcile(inputOf({ now: NOW + 60_000, draftText: 'see [Image #1]', listing: folderOf('1.png') }))
    expect(output.tiles).toEqual([{ id: 1, state: 'not-attached', seenAt: NOW + 60_000 }])
  })
})

describe('a file that is slow, late or gone for a moment', () => {
  test('late: not found after PENDING_MS, then attached when the file lands fresh', () => {
    const session = sessionOf()
    const empty = folderOf('2.png')
    session.refresh(0, { draftText: '[Image #3]', listing: empty })
    expect(session.refresh(PENDING_MS + 1, { draftText: '[Image #3]', listing: empty }).tiles).toEqual([{ id: 3, state: 'failed', reason: 'not found', seenAt: NOW }])
    const late = session.refresh(5000, { draftText: '[Image #3]', listing: folderOf('2.png', { name: '3.png', mtimeMs: NOW + 4900 }) })
    expect([late.tiles, late.toDecode.map(file => file.name), late.prov.pasted]).toEqual([[{ id: 3, state: 'reading', format: 'png', seenAt: NOW }], ['3.png'], { 3: true }])
  })

  test('present only as .tmp: pending however long the write takes', () => {
    const session = sessionOf()
    session.refresh(0, { draftText: '[Image #7]', listing: folderOf('7.png.tmp.1a2b3c4d') })
    const later = session.refresh(10_000, { draftText: '[Image #7]', listing: folderOf('7.png.tmp.1a2b3c4d') })
    expect([later.tiles, later.waiting]).toEqual([[{ id: 7, state: 'pending', seenAt: NOW }], true])
  })

  test('no image folder: pending, then the reason the hooks give for it; a folder without the file is not found', () => {
    const session = sessionOf()
    session.refresh(0, { draftText: '[Image #1]' })
    expect(session.refresh(PENDING_MS + 1, { draftText: '[Image #1]', missingReason: 'no preview' }).tiles).toEqual([{ id: 1, state: 'failed', reason: 'no preview', seenAt: NOW }])
    expect(session.refresh(PENDING_MS + 2, { draftText: '[Image #1]' }).tiles[0]?.reason).toBe('not found')
    expect(session.refresh(PENDING_MS + 3, { draftText: '[Image #1]', missingReason: 'no preview', listing: folderOf() }).tiles[0]?.reason).toBe('not found')
  })

  test('a passing ENOENT after the decode never drops the picture, nor a known failure', () => {
    const prov: ImagesProvenance = { seen: { 1: NOW, 2: NOW }, pasted: { 1: true, 2: true }, sent: {} }
    const decoded = factsOf({ 1: READY_SHOT, 2: { state: 'failed', reason: 'too slow', format: 'png' } })
    for (const listing of [folderOf(), folderOf('2.png'), undefined]) {
      const output = reconcile(inputOf({ now: NOW + 60_000, draftText: '[Image #1] [Image #2]', prov, listing, decoded }))
      expect(output.tiles, String(listing?.files.size)).toEqual([
        { id: 1, state: 'ready', ...SHOT_TILE, seenAt: NOW },
        { id: 2, state: 'failed', format: 'png', reason: 'too slow', seenAt: NOW },
      ])
      expect([output.toDecode, output.waiting]).toEqual([[], false])
    }
  })

  test('attached, its picture lost with a reload and its file gone for a moment: not found, then read again when it is back', () => {
    const prov: ImagesProvenance = { seen: { 4: NOW }, pasted: { 4: true }, sent: {} }
    const gone = reconcile(inputOf({ now: NOW + 30_000, draftText: '[Image #4]', prov, listing: folderOf() }))
    expect(gone.tiles).toEqual([{ id: 4, state: 'failed', reason: 'not found', seenAt: NOW }])
    const back = reconcile(inputOf({ now: NOW + 30_250, draftText: '[Image #4]', prov, listing: folderOf({ name: '4.png', mtimeMs: NOW }) }))
    expect([back.tiles, back.toDecode.map(file => file.id)]).toEqual([[{ id: 4, state: 'reading', format: 'png', seenAt: NOW }], [4]])
  })

  test('cleared with Ctrl+C and restored with Up: still attached, still ready', () => {
    const session = sessionOf()
    session.refresh(0, { draftText: '[Image #6]', listing: folderOf('6.png') })
    expect(session.refresh(1000, { draftText: '' }).tiles).toEqual([])
    const restored = session.refresh(2000, { draftText: '[Image #6]', listing: folderOf('6.png'), decoded: factsOf({ 6: READY_SHOT }) })
    expect(restored.tiles).toEqual([{ id: 6, state: 'ready', ...SHOT_TILE, seenAt: NOW }])
  })

  test('the stated limit: dropped with Esc-Esc and recalled with Up, a pasted chip still reads as attached', () => {
    const session = sessionOf()
    session.refresh(0, { draftText: '[Image #2]', listing: folderOf('2.png') })
    session.refresh(1000, { draftText: '' })
    expect(session.refresh(2000, { draftText: '[Image #2]', listing: folderOf('2.png') }).tiles[0]?.state).toBe('reading')
  })
})

describe('the provenance record', () => {
  const crowdOf = (count: number): ImagesProvenance => {
    const prov: ImagesProvenance = { seen: {}, pasted: {}, sent: {} }
    for (let id = 1; id <= count; id += 1) {
      prov.seen[String(id)] = NOW - (count - id) * 1000
      prov.pasted[String(id)] = true
      prov.sent[String(id)] = true
    }

    return prov
  }

  test('each record keeps PROVENANCE_CAP entries, the oldest dropped, never a chip in the draft', () => {
    const output = reconcile(inputOf({ draftText: '[Image #1] [Image #2]', prov: crowdOf(300) }))
    for (const record of [output.prov.seen, output.prov.pasted, output.prov.sent]) {
      const ids = Object.keys(record).map(Number)
      expect(ids).toHaveLength(PROVENANCE_CAP)
      expect(ids.slice(0, 3)).toEqual([1, 2, 47])
      expect(ids.at(-1)).toBe(300)
    }
    expect(output.tiles.map(tile => tile.state)).toEqual(['not-attached', 'not-attached'])
  })

  test('a new chip is recorded and the oldest entry makes room for it', () => {
    const output = reconcile(inputOf({ draftText: '[Image #301]', prov: crowdOf(PROVENANCE_CAP) }))
    expect(Object.keys(output.prov.seen)).toHaveLength(PROVENANCE_CAP)
    expect([output.prov.seen['1'], output.prov.seen['2'], output.prov.seen['301']]).toEqual([undefined, NOW - 254_000, NOW])
  })

  test('a draft of more chips than the cap keeps every one of them', () => {
    const draftText = Array.from({ length: 300 }, (_, at) => `[Image #${at + 1}]`).join(' ')
    const output = reconcile(inputOf({ draftText, prov: crowdOf(300) }))
    expect(Object.keys(output.prov.sent)).toHaveLength(300)
    expect(output.tiles).toHaveLength(300)
  })

  test('the same object back when nothing changed: the hooks write state only when it did', () => {
    const first = reconcile(inputOf({ draftText: '[Image #1]', listing: folderOf('1.png') }))
    const again = reconcile(inputOf({ now: NOW + 250, draftText: '[Image #1]', prov: first.prov, listing: folderOf('1.png') }))
    expect(again.prov).toBe(first.prov)
    expect(sameTilesOf(first.tiles, again.tiles)).toBe(true)
    expect(reconcile(inputOf({ prov: EMPTY_PROVENANCE })).prov).toBe(EMPTY_PROVENANCE)
  })

  test('tiles and provenance are JSON: no key holds undefined', () => {
    const output = reconcile(inputOf({
      draftText: '[Image #1] [Image #2] [Image #3] [Image #4] [Image #5]',
      prov: { seen: {}, pasted: { 2: true }, sent: { 5: true } },
      listing: folderOf('1.png', '2.png', { name: '4.png', mtimeMs: NOW - 60_000 }),
      decoded: factsOf({ 2: { state: 'ready', format: 'png', width: 10, height: 10, reason: undefined } }),
    }))
    expect(output.tiles.map(tile => tile.state)).toEqual(['reading', 'ready', 'pending', 'not-attached', 'not-attached'])
    for (const value of [output.tiles, output.prov, EMPTY_PROVENANCE]) {
      expect(isJson(value)).toBe(true)
      expect(JSON.parse(JSON.stringify(value))).toStrictEqual(value)
    }
  })

  test('EMPTY_PROVENANCE cannot be written into', () => {
    expect([Object.isFrozen(EMPTY_PROVENANCE), Object.isFrozen(EMPTY_PROVENANCE.seen), Object.isFrozen(EMPTY_PROVENANCE.sent)]).toEqual([true, true, true])
  })
})

describe('sent marks', () => {
  test('markSentOf records ids as sent and keeps the rest; the same object when nothing is new', () => {
    const prov: ImagesProvenance = { seen: { 1: NOW }, pasted: { 1: true }, sent: { 7: true } }
    const marked = markSentOf(prov, [1, 3])
    expect(marked).toEqual({ seen: { 1: NOW }, pasted: { 1: true }, sent: { 1: true, 3: true, 7: true } })
    expect(prov.sent).toEqual({ 7: true })
    expect(markSentOf(marked, [3, 7])).toBe(marked)
    expect(markSentOf(prov, [])).toBe(prov)
  })

  test('markSentOf ignores what no chip can be', () => {
    expect(markSentOf(EMPTY_PROVENANCE, [0, -1, 1.5, Number.NaN, 2 ** 60])).toBe(EMPTY_PROVENANCE)
  })
})

describe('tile comparison', () => {
  const tile = (more: Partial<ImagesTile> = {}): ImagesTile => ({ id: 1, state: 'ready', ...SHOT_TILE, seenAt: NOW, ...more })

  test('sameTilesOf: equal lists are the same, whatever object they are', () => {
    expect(sameTilesOf([tile(), tile({ id: 2 })], [tile(), tile({ id: 2 })])).toBe(true)
    expect(sameTilesOf([], [])).toBe(true)
  })

  test('sameTilesOf: any field that draws differently makes them differ', () => {
    const changes: Partial<ImagesTile>[] = [{ id: 2 }, { state: 'reading' }, { format: 'jpeg' }, { width: 1919 }, { height: 1081 }, { reason: 'too big' }, { seenAt: NOW + 1 }]
    for (const change of changes) expect(sameTilesOf([tile()], [tile(change)]), JSON.stringify(change)).toBe(false)
    expect(sameTilesOf([tile()], [{ id: 1, state: 'ready', seenAt: NOW }])).toBe(false)
    expect(sameTilesOf([tile()], [tile(), tile()])).toBe(false)
  })
})

describe('the poll', () => {
  test('pollDelayOf: 100 ms while a chip waits, 250 while tiles show, 1 s with text, 3 s when empty', () => {
    const tiles = [{ id: 1, state: 'ready', seenAt: NOW } as const]
    expect(pollDelayOf('', [], true)).toBe(POLL_WAITING_MS)
    expect(pollDelayOf('[Image #1]', tiles, true)).toBe(POLL_WAITING_MS)
    expect(pollDelayOf('[Image #1]', tiles, false)).toBe(POLL_SHOWN_MS)
    expect(pollDelayOf('hello', [], false)).toBe(POLL_DRAFT_MS)
    expect(pollDelayOf('', [], false)).toBe(POLL_IDLE_MS)
    expect([POLL_WAITING_MS, POLL_SHOWN_MS, POLL_DRAFT_MS, POLL_IDLE_MS]).toEqual([100, 250, 1000, 3000])
  })
})
