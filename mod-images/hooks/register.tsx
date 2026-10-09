import { atom, read, update } from 'claude-code'
import type { EngineInterface, ImageSource, Register, Timer } from 'claude-code'

import type { ImagesStrip, ImagesTile } from '../types'
import { MASTER_SIDE, READ_CAP, imageHeaderOf, runSliced, startMaster } from './decode-drive'
import { chipIdsOf, chipKeyOf, sentIdsOf } from './draft-chips'
import { EMPTY_PROVENANCE, markSentOf, pollDelayOf, reconcile, sameTilesOf, unmarkSentOf } from './draft-reconcile'
import type { DecodeFacts } from './draft-reconcile'
import { FORMAT_NAMES, FORMAT_OF_EXT } from './image-types'
import type { Master } from './image-types'
import { bytesOf } from './images-bytes'
import { demoMastersOf } from './images-demo'
import { colourOf, modeOf, pasteKeysOf } from './images-mode'
import type { ModeChoice, TermEnv } from './images-mode'
import { settingsOf } from './images-options'
import { reportOf } from './images-report'
import type { ReportBand, ReportStore } from './images-report'
import { imagesDirOf, isUserDirName, joinPath, listingOf, projectDirOf, storeDoubtOf, storeOffReasonOf, tempBasesOf } from './store-path'
import type { StoreEnv, StoreFile, StoreListing } from './store-path'
import { pictureKeyOf, renderStrip } from './strip'
import type { TileDrawable } from './strip'
import { layoutOf, rowsCapOf } from './strip-layout'
import type { PlacedTile } from './strip-layout'
import { halfBlockCellsOf, kittyRgbaOf, kittySizeOf, swatchCellsOf } from './thumb-cells'

// mod-images: thumbnails of the images pasted into the prompt, drawn in the
// band above it before the prompt is sent (docs/strip.md).
//
// Claude Code saves each pasted image in a folder of the session's own the
// moment it is pasted (hooks/store-path.ts); nothing tells a plugin that it
// did, so the plugin watches what it can see (the prompt's hint line, the
// typeahead's check after a chip goes in, a light poll of the draft) and
// reads the draft's `[Image #N]` chips. Which chips are really attached is
// judged in hooks/draft-reconcile.ts; decoding runs in slices on a timer
// (hooks/decode-drive.ts) and never in a hook with a short budget.
//
// What the band draws from: the strip and the chips' provenance in `$.state`.
// The decoded pixels stay in module memory, a departure from drawing only from
// state: a picture would cost up to 4 MiB of state and tens of milliseconds a
// write, and after a reload the strip draws placeholders while `session.start`
// decodes again.

const TWIN = 'mod-images'
const BAND = 'above-prompt'

// A tile still waiting for its picture is drawn only after this long, so a
// typical paste (decoded in 20-150 ms) never flashes a placeholder first.
const PLACEHOLDER_DELAY_MS = 150
// A poll that has not ticked for this long is started again by the next trigger.
const WATCHDOG_MS = 8000
// The temporary folders are listed at most this often while the image folder is missing.
const SCAN_EVERY_MS = 1000
// A project folder with more entries than this is not searched for the session.
const SCAN_ENTRIES_CAP = 2000
// The pixels check: first try after a drawing, then retries while the engine is still asking the terminal.
const PROBE_DELAY_MS = 400
const PROBE_RETRY_MS = 1000
const PROBE_TRIES = 5
const DEMO_MS = 10_000
// A turn cancelled before any answer puts its prompt back in the box at once:
// its chips, seen there within this long, are the same pictures.
const RESTORE_MS = 2000
const MASTERS_CAP = 32
// Drawn thumbnails kept, the least recently drawn dropped first: at most this
// many, holding at most this many characters of base64 in all.
const DRAWABLES_CAP = 96
const DRAWABLES_CHARS_CAP = 8 * 1024 * 1024

const STRIP = { plugin: 'mod-images', key: 'strip' } as const
const EMPTY_STRIP: ImagesStrip = { sessionId: '', tiles: [] }
const strip = atom(STRIP, EMPTY_STRIP)
const PROVENANCE = { plugin: 'mod-images', key: 'provenance' } as const
const provenance = atom(PROVENANCE, EMPTY_PROVENANCE)
const DEMO = { plugin: 'mod-images', key: 'demo' } as const
const demo = atom(DEMO, null)
// Bumped to redraw the band when something only module memory holds changed:
// a placeholder old enough to show, the drawing mode, the end of a sample strip.
const PICTURES = { plugin: 'mod-images', key: 'pictures' } as const
const pictures = atom(PICTURES, 0)

type DecodeJob = { sid: string; dir: string; file: StoreFile }

// A listing of a folder Claude Code has not made yet: it makes the session's
// folder with its first picture, so no chip is attached until then.
const NO_FILES: StoreListing = { files: new Map(), tmpIds: new Set() }

// Module memory: timers, caches and facts about this process. A reload starts
// it afresh (`register` resets it) and `session.start` builds it again.
let active = false
let settings = settingsOf({})
let storeEnv: StoreEnv = {}
let termEnv: TermEnv = {}
let mode: ModeChoice = { mode: 'blocks', why: 'not started' }
let pixelsConfirmed = false
let pollTimer: Timer | undefined
let redrawTimer: Timer | undefined
let probeTimer: Timer | undefined
let lastTick = 0
let nextDelay = 1000
// The delay the poll was last armed with: a look that wants a shorter one arms it again.
let armedDelay = Infinity
let running: Promise<void> | undefined
let dirty = false
let lastChipKey = ''
let lastHint = ''
let currentSid = ''
let draftIds: ReadonlySet<number> = new Set()
// The `claude-<uid>` folder, once found: the same for the whole process.
let userDir: string | undefined
let scannedAt = -Infinity
let triedBases: readonly string[] = []
// The chips the folder was last looked for under every project for.
let deepScanKey = ''
// The chips of the last prompt sent with pictures, and those a cancelled turn
// may be about to put back, until when.
let lastSentIds: readonly number[] = []
let restoreIds: readonly number[] = []
let restoreUntil = 0
// This session's image folder, once found.
let sessionDir: { sid: string; root: string; dir?: string } | undefined
const decodeFacts = new Map<string, DecodeFacts>()
const masters = new Map<string, Master>()
const drawables = new Map<string, TileDrawable>()
let drawableChars = 0
const queue: DecodeJob[] = []
let draining = false
let previousLayout: { rows: number; count: number } | undefined
let lastBand: ReportBand | undefined
let lastStrip: { at: number; tiles: readonly ImagesTile[] } | undefined
let probe: { key: string; source: ImageSource; tries: number } | undefined
let demoMasters: readonly Master[] = []

const resetModule = (): void => {
  active = false
  settings = settingsOf({})
  storeEnv = {}
  termEnv = {}
  mode = { mode: 'blocks', why: 'not started' }
  pixelsConfirmed = false
  stopTimers()
  lastTick = 0
  nextDelay = 1000
  running = undefined
  dirty = false
  lastChipKey = ''
  lastHint = ''
  currentSid = ''
  draftIds = new Set()
  userDir = undefined
  scannedAt = -Infinity
  triedBases = []
  deepScanKey = ''
  lastSentIds = []
  restoreIds = []
  restoreUntil = 0
  sessionDir = undefined
  decodeFacts.clear()
  masters.clear()
  clearDrawables()
  queue.length = 0
  draining = false
  previousLayout = undefined
  lastBand = undefined
  lastStrip = undefined
  probe = undefined
  demoMasters = []
}

const stopTimers = (): void => {
  pollTimer?.cancel()
  pollTimer = undefined
  armedDelay = Infinity
  redrawTimer?.cancel()
  redrawTimer = undefined
  probeTimer?.cancel()
  probeTimer = undefined
}

// A new session id (a /clear, a resume): what belonged to the old one goes.
const forgetSession = (sid: string): void => {
  currentSid = sid
  sessionDir = undefined
  decodeFacts.clear()
  masters.clear()
  clearDrawables()
  queue.length = 0
  previousLayout = undefined
  lastChipKey = ''
  draftIds = new Set()
  lastSentIds = []
  restoreIds = []
}

// Bookkeeping never gets to break the session: a failure is a debug line.
const quietly = async ($: EngineInterface, work: () => Promise<unknown>): Promise<void> => {
  try {
    await work()
  } catch (error) {
    try {
      $.ui.log(`mod-images: ${String(error)}`, { to: 'debug' })
    } catch {
      // Nothing more to tell.
    }
  }
}

const keyOf = (sid: string, id: number): string => `${sid}:${id}`

const charsOf = (drawable: TileDrawable): number =>
  drawable.kind === 'cells' ? drawable.cells.length : drawable.kind === 'image' ? drawable.source.rgba.length : 0

const clearDrawables = (): void => {
  drawables.clear()
  drawableChars = 0
}

// A drawable kept as the most recently drawn, within both caps.
const keepDrawable = (key: string, drawable: TileDrawable): TileDrawable => {
  const held = drawables.get(key)
  if (held !== undefined) {
    drawables.delete(key)
    drawableChars -= charsOf(held)
  }
  drawables.set(key, drawable)
  drawableChars += charsOf(drawable)
  while (drawables.size > DRAWABLES_CAP || (drawableChars > DRAWABLES_CHARS_CAP && drawables.size > 1)) {
    const oldest = drawables.keys().next()
    if (oldest.done === true) break
    const gone = drawables.get(oldest.value)
    drawables.delete(oldest.value)
    if (gone !== undefined) drawableChars -= charsOf(gone)
  }

  return drawable
}

const remember = <T,>(cache: Map<string, T>, key: string, value: T, cap: number): T => {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > cap) {
    const oldest = cache.keys().next()
    if (oldest.done === true) break
    cache.delete(oldest.value)
  }

  return value
}

// Each variable by its literal name: the engine refuses any other spelling.
const readEnv = async ($: EngineInterface): Promise<{ store: StoreEnv; term: TermEnv }> => {
  const [
    claudeTmpdir, tmpdir, tmp, temp, localAppData, os, skipPromptHistory, childSession, forcePersistence,
    term, termProgram, kittyWindowId, colorterm, tmux, sty, forceImages, noColor, screenReader, wslDistro,
  ] = await Promise.all([
    $.env.get('CLAUDE_CODE_TMPDIR'),
    $.env.get('TMPDIR'),
    $.env.get('TMP'),
    $.env.get('TEMP'),
    $.env.get('LOCALAPPDATA'),
    $.env.get('OS'),
    $.env.get('CLAUDE_CODE_SKIP_PROMPT_HISTORY'),
    $.env.get('CLAUDE_CODE_CHILD_SESSION'),
    $.env.get('CLAUDE_CODE_FORCE_SESSION_PERSISTENCE'),
    $.env.get('TERM'),
    $.env.get('TERM_PROGRAM'),
    $.env.get('KITTY_WINDOW_ID'),
    $.env.get('COLORTERM'),
    $.env.get('TMUX'),
    $.env.get('STY'),
    $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES'),
    $.env.get('NO_COLOR'),
    $.env.get('CLAUDE_AX_SCREEN_READER'),
    $.env.get('WSL_DISTRO_NAME'),
  ])

  return {
    store: { claudeTmpdir, tmpdir, tmp, temp, localAppData, os, skipPromptHistory, childSession, forcePersistence },
    term: { term, termProgram, kittyWindowId, colorterm, tmux, sty, forceImages, noColor, screenReader, wslDistro, os },
  }
}

const existsAt = async ($: EngineInterface, path: string): Promise<boolean> => {
  try {
    return await $.fs.exists(path)
  } catch {
    return false
  }
}

// The session's image folder: `<temp>/claude-<uid>/<project>/<session>/images`.
// The uid is not known to a plugin, so the temporary folders are listed for a
// `claude-*` folder holding this project's folder: that one is kept for the
// process (it never changes), and only the session's own folder is checked
// after that.
const imagesDirFor = async ($: EngineInterface, sid: string, root: string, now: number, force = false): Promise<string | undefined> => {
  if (sessionDir !== undefined && sessionDir.sid === sid && sessionDir.root === root && sessionDir.dir !== undefined) return sessionDir.dir
  sessionDir = { sid, root }
  if (userDir !== undefined) {
    const dir = imagesDirOf(userDir, root, sid)
    if (await existsAt($, dir)) return (sessionDir.dir = dir)
    if (!force) return undefined
  }
  if (!force && now - scannedAt < SCAN_EVERY_MS) return undefined
  scannedAt = now
  triedBases = tempBasesOf(storeEnv, root)
  const owners: string[] = []
  for (const base of triedBases) {
    const entries = await $.fs.list(base).catch(() => [])
    for (const entry of entries) {
      if (!isUserDirName(entry.name) || (entry.kind !== 'dir' && !entry.isLink)) continue
      const candidate = joinPath(base, entry.name)
      owners.push(candidate)
      if (!(await existsAt($, projectDirOf(candidate, root)))) continue
      userDir = candidate
      const dir = imagesDirOf(candidate, root, sid)

      return (await existsAt($, dir)) ? (sessionDir.dir = dir) : undefined
    }
  }
  // No project folder by the root's name: the session's folder is looked for
  // under each project, once for each new set of chips.
  if (!force && lastChipKey === deepScanKey) return undefined
  deepScanKey = lastChipKey
  for (const owner of owners) {
    const projects = await $.fs.list(owner).catch(() => [])
    if (projects.length > SCAN_ENTRIES_CAP) continue
    for (const project of projects) {
      if (project.kind !== 'dir') continue
      const dir = joinPath(owner, project.name, sid, 'images')
      if (await existsAt($, dir)) {
        userDir = owner

        return (sessionDir.dir = dir)
      }
    }
  }

  return undefined
}

const bumpPictures = ($: EngineInterface): Promise<void> => quietly($, () => update($, pictures, count => count + 1))

const armRedraw = ($: EngineInterface, ms: number): void => {
  redrawTimer?.cancel()
  redrawTimer = $.clock.after(Math.max(1, Math.ceil(ms)), () => {
    redrawTimer = undefined
    void bumpPictures($)
  })
}

// One look at the draft: its chips, their files, what is attached, what to decode.
const refreshOnce = async ($: EngineInterface): Promise<void> => {
  const now = await $.clock.now()
  const { text } = await $.prompt.read()
  const ids = chipIdsOf(text)
  const chipKey = chipKeyOf(ids)
  lastChipKey = chipKey
  const sid = await $.session.id()
  const root = await $.session.root()
  if (sid !== currentSid) forgetSession(sid)
  draftIds = new Set(ids)
  let listing: StoreListing | undefined
  let missingReason = 'not found'
  if (ids.length > 0) {
    if (storeOffReasonOf(storeEnv) !== undefined) {
      missingReason = 'no preview'
    } else {
      const dir = await imagesDirFor($, sid, root, now)
      if (dir !== undefined) {
        const entries = await $.fs.list(dir).catch(() => undefined)
        listing = entries === undefined ? undefined : listingOf(entries)
      } else if (storeDoubtOf(storeEnv) !== undefined) {
        // A nested session may keep no folder: its pictures are sent all the same.
        missingReason = 'no preview'
      } else if (userDir !== undefined) {
        listing = NO_FILES
      }
    }
  }
  // The prompt a cancelled turn put back: its chips are the pictures it carried.
  if (restoreIds.length > 0 && (now > restoreUntil || chipKey === chipKeyOf(restoreIds))) {
    const taken = now > restoreUntil ? [] : restoreIds
    restoreIds = []
    if (taken.length > 0) await update($, provenance, prov => unmarkSentOf(prov ?? EMPTY_PROVENANCE, taken))
  }
  const decoded = (id: number): DecodeFacts | undefined => decodeFacts.get(keyOf(sid, id))
  const held = await read($, provenance)
  let out = reconcile({ now, draftText: text, prov: held, listing, missingReason, decoded })
  // `reconcile` hands back the record it was given when nothing changed.
  if (out.prov !== held) {
    // Judged again on the value written, so a sent mark landing meanwhile is kept.
    await update($, provenance, current => {
      out = reconcile({ now, draftText: text, prov: current ?? EMPTY_PROVENANCE, listing, missingReason, decoded })

      return out.prov
    })
  }
  const shown = await read($, strip)
  if (shown.sessionId !== sid || !sameTilesOf(shown.tiles, out.tiles)) await update($, strip, () => ({ sessionId: sid, tiles: out.tiles }))
  const dir = sessionDir?.dir
  if (dir !== undefined) for (const file of out.toDecode) enqueue($, { sid, dir, file })
  const young = out.tiles
    .filter(tile => tile.state === 'pending' || tile.state === 'reading')
    .map(tile => tile.seenAt + PLACEHOLDER_DELAY_MS - now)
    .filter(wait => wait > 0)
  if (young.length > 0) armRedraw($, Math.max(...young) + 10)
  nextDelay = pollDelayOf(text, out.tiles, out.waiting)
  // Tiles showing, or a file awaited: look again sooner than the poll was set to.
  if (active && nextDelay < armedDelay) armPoll($, nextDelay)
}

// Refreshes run one at a time; a trigger during one asks for one more after it.
const schedule = ($: EngineInterface): Promise<void> => {
  dirty = true
  running ??= (async () => {
    try {
      while (dirty) {
        dirty = false
        await quietly($, () => refreshOnce($))
      }
    } finally {
      running = undefined
    }
  })()

  return running
}

// The poll: each tick arms the next only once it is done, so ticks never overlap.
const armPoll = ($: EngineInterface, ms: number): void => {
  pollTimer?.cancel()
  armedDelay = ms
  pollTimer = $.clock.after(Math.max(1, ms), () => {
    lastTick = performance.now()
    armedDelay = Infinity
    void schedule($).then(() => {
      if (active) armPoll($, nextDelay)
    })
  })
}

const keepPolling = ($: EngineInterface): void => {
  if (active && (pollTimer === undefined || performance.now() - lastTick > WATCHDOG_MS + nextDelay)) armPoll($, 0)
}

const soon = ($: EngineInterface): void => {
  $.clock.after(0, () => void schedule($))
}

const enqueue = ($: EngineInterface, job: DecodeJob): void => {
  const key = keyOf(job.sid, job.file.id)
  if (decodeFacts.has(key)) return
  decodeFacts.set(key, { state: 'reading', format: FORMAT_OF_EXT[job.file.ext] })
  queue.push(job)
  if (!draining) void drain($)
}

const drain = async ($: EngineInterface): Promise<void> => {
  draining = true
  try {
    for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
      const current = job
      await quietly($, () => decode($, current))
    }
  } finally {
    draining = false
  }
}

const failed = (key: string, reason: string, facts: Omit<DecodeFacts, 'state' | 'reason'>): void => {
  decodeFacts.set(key, { ...facts, state: 'failed', reason })
}

// One image: read, check its header against the caps, decode in slices with a
// yield to the engine between them, keep the master. A chip that leaves the
// draft stops its decode at the next slice.
const decode = async ($: EngineInterface, { sid, dir, file }: DecodeJob): Promise<void> => {
  const key = keyOf(sid, file.id)
  const format = FORMAT_OF_EXT[file.ext]
  const isGone = (): boolean => currentSid !== sid || !draftIds.has(file.id)
  try {
    if (isGone()) {
      decodeFacts.delete(key)

      return
    }
    if (file.size > READ_CAP) return failed(key, 'too big', { format })
    const loaded = await $.fs.read(joinPath(dir, file.name), { as: 'bytes' }).catch(() => undefined)
    if (loaded === undefined) return failed(key, "can't read", { format })
    const bytes = bytesOf(loaded.base64)
    const header = imageHeaderOf(bytes)
    const facts = header === undefined ? { format } : { format: header.format, width: header.width, height: header.height }
    // The text line needs only the format and size.
    if (mode.mode === 'text') {
      if (header === undefined) return failed(key, "can't read", facts)
      decodeFacts.set(key, { ...facts, state: 'ready' })

      return
    }
    const started = startMaster(bytes, MASTER_SIDE)
    if ('failure' in started) return failed(key, started.failure, facts)
    decodeFacts.set(key, { ...facts, state: 'reading' })
    const outcome = await runSliced(started.step, () => $.clock.now(), { isAborted: isGone }).catch(() => 'broken' as const)
    if (outcome === 'aborted') {
      decodeFacts.delete(key)

      return
    }
    if (outcome === 'too slow') return failed(key, 'too slow', facts)
    if (outcome === 'broken') return failed(key, "can't read", facts)
    remember(masters, key, started.master(), MASTERS_CAP)
    decodeFacts.set(key, { ...facts, state: 'ready' })
  } finally {
    soon($)
  }
}

const masterOf = (key: string): Master | undefined => {
  const master = masters.get(key)

  return master === undefined ? undefined : remember(masters, key, master, MASTERS_CAP)
}

// Base64 of n bytes is 4 * ceil(n / 3) characters: a drawable of any other
// size would make the engine refuse the whole band.
const base64Length = (bytes: number): number => 4 * Math.ceil(bytes / 3)

const altOf = (tile: ImagesTile): string => {
  const name = tile.format === undefined ? '' : `, ${FORMAT_NAMES[tile.format]}`
  const size = tile.width === undefined || tile.height === undefined ? '' : `, ${tile.width} by ${tile.height}`

  return `Image #${tile.id}${name}${size}`
}

// The reason first: a tile three rows tall has room for one line.
const noteOf = (tile: ImagesTile): TileDrawable => {
  if (tile.state === 'not-attached') return { kind: 'note', lines: ['not attached'], dashed: true }
  const name = tile.format === undefined ? [] : [FORMAT_NAMES[tile.format]]

  return { kind: 'note', lines: [tile.reason ?? 'no preview', ...name], dashed: false }
}

const pictureOf = (tile: ImagesTile, placed: PlacedTile, master: Master, prefix: string, kittyBytes: number): TileDrawable => {
  // Pixels are keyed by the size they come out at, not the byte allowance,
  // which changes with every paste while the picture mostly does not.
  const size = mode.mode === 'pixels' ? kittySizeOf(master, placed.columns, placed.rows, kittyBytes) : undefined
  const cacheKey = `${prefix}:${mode.mode}:${placed.columns}x${placed.rows}${size === undefined ? '' : `:${size.width}x${size.height}`}`
  const held = drawables.get(cacheKey)
  if (held !== undefined) return keepDrawable(cacheKey, held)
  let drawable: TileDrawable
  if (mode.mode === 'pixels') {
    const source = kittyRgbaOf(master, placed.columns, placed.rows, kittyBytes)
    const fits = source.width >= 1 && source.height >= 1 && source.width <= 2048 && source.height <= 2048
      && source.rgba.length === base64Length(source.width * source.height * 4)
    drawable = fits ? { kind: 'image', source, alt: altOf(tile) } : { kind: 'note', lines: ["can't draw"], dashed: false }
  } else {
    const cells = halfBlockCellsOf(master, placed.columns, placed.rows)
    drawable = cells.length === base64Length(placed.columns * placed.rows * 12) ? { kind: 'cells', cells } : { kind: 'note', lines: ["can't draw"], dashed: false }
  }

  return keepDrawable(cacheKey, drawable)
}

const isBareEngine = (element: unknown): boolean =>
  typeof element === 'object' && element !== null && (element as { type?: unknown }).type === 'engine'

// The engine's answers to a blit on a drawn Image (2.1.295): `{}` where the
// terminal draws it; `the Image draws its alt here: the terminal draws no
// placeholder images (<why>)`, a guess still being checked while <why> ends
// `not asked yet` (its deadline settles it `..., not asked yet, no answer`);
// `... every 8-bit image id is in use`, for now; `the terminal has not yet
// said whether it reads files ...; asked now, blit again`; `the Image is not
// drawn under a terminal root` when the strip went meanwhile.
const STILL_ASKING = /not asked yet\)\s*$|asked now|not yet said/
const FOR_NOW = /every 8-bit image id is in use|not drawn under a terminal root/
const DRAWS_ALT = /draws its alt here/

// An answer's reason: inside its outer bracket (`probe: graphics reply OK,
// terminal kitty(0.26.5)`, less the `probe:`), else after its colon.
const denyDetailOf = (deny: string): string => {
  const open = deny.indexOf('(')
  const close = deny.lastIndexOf(')')

  return open >= 0 && close > open ? deny.slice(open + 1, close).replace(/^probe:\s*/, '') : deny.replace(/^[^:]*:\s*/, '')
}

// The pixels guess is checked once a picture is drawn. A settled answer that
// the terminal draws the alt switches to blocks for the session; one still
// being found out, or a passing one, is asked again, and an alt still drawn
// when the tries are spent switches too.
const probePixels = async ($: EngineInterface): Promise<void> => {
  probeTimer = undefined
  if (probe === undefined || pixelsConfirmed || mode.mode !== 'pixels') return
  probe.tries += 1
  const answer = await $.ui.blit({ requestId: BAND, key: probe.key, source: probe.source }).catch((error: unknown) => ({ deny: String(error) }))
  const deny = answer.deny
  if (deny === undefined) {
    pixelsConfirmed = true

    return
  }
  const isSettled = DRAWS_ALT.test(deny) && !STILL_ASKING.test(deny) && !FOR_NOW.test(deny)
  if (!isSettled && probe.tries < PROBE_TRIES) {
    probeTimer = $.clock.after(PROBE_RETRY_MS, () => void probePixels($))

    return
  }
  if (!DRAWS_ALT.test(deny)) return
  mode = { mode: 'blocks', why: `Claude Code draws no pictures here (${denyDetailOf(deny)})` }
  clearDrawables()
  previousLayout = undefined
  await bumpPictures($)
}

const armProbe = ($: EngineInterface, key: string, source: ImageSource): void => {
  if (pixelsConfirmed || mode.mode !== 'pixels') return
  if (probe === undefined || probe.key !== key) probe = { key, source, tries: 0 }
  else probe.source = source
  if (probeTimer === undefined && probe.tries < PROBE_TRIES) probeTimer = $.clock.after(PROBE_DELAY_MS, () => void probePixels($))
}

// A sent prompt's chips: recalled later, they are not attached.
const noteSent = async ($: EngineInterface, content: readonly { type: string; text?: unknown }[]): Promise<void> => {
  const ids = sentIdsOf(content)
  if (ids.length === 0) return
  lastSentIds = ids
  await quietly($, () => update($, provenance, prov => markSentOf(prov ?? EMPTY_PROVENANCE, ids)))
  soon($)
}

const demoTilesOf = (samples: readonly Master[]): ImagesTile[] =>
  samples.map((master, at) => ({ id: at + 1, state: 'ready', format: 'png', width: master.width, height: master.height, seenAt: 0 }))

const versionOf = async ($: EngineInterface): Promise<string | undefined> => {
  try {
    const manifest = JSON.parse(await $.fs.read(joinPath($.plugin.root, '.claude-plugin', 'plugin.json'))) as { version?: unknown }

    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

const reportFor = async ($: EngineInterface): Promise<string> => {
  const now = await $.clock.now()
  const claudeVersion = await $.session.version().then(version => version.version).catch(() => undefined)
  let store: ReportStore = { kind: 'unknown' }
  const off = storeOffReasonOf(storeEnv)
  if (off !== undefined) {
    store = { kind: 'off', reason: off }
  } else if (active) {
    const sid = await $.session.id()
    const root = await $.session.root()
    const dir = await imagesDirFor($, sid, root, now, true).catch(() => undefined)
    if (dir !== undefined) {
      const entries = await $.fs.list(dir).catch(() => [])
      store = { kind: 'found', dir, files: listingOf(entries).files.size }
    } else {
      const doubt = storeDoubtOf(storeEnv)
      store = { kind: 'not-found', tried: triedBases, ...(doubt === undefined ? {} : { doubt }) }
    }
  }

  return reportOf({
    version: await versionOf($),
    claudeVersion,
    active,
    mode,
    confirmed: pixelsConfirmed,
    colour: colourOf(termEnv),
    store,
    lastStrip: lastStrip === undefined ? undefined : { ageMs: now - lastStrip.at, tiles: lastStrip.tiles },
    band: lastBand,
    settings,
    pasteKeys: pasteKeysOf(termEnv),
  })
}

export const register: Register = (on, options) => {
  // A reload starts this module afresh; the engine cancels the old timers.
  resetModule()
  settings = settingsOf(options)

  on('session.start', async ($, e, next) => {
    stopTimers()
    try {
      await $.command.register({
        name: TWIN,
        description: 'Show what mod-images sees: the terminal, the image folder and the last strip (test: draw a sample strip)',
        argumentHint: 'test',
        immediate: true,
      })
    } catch (error) {
      $.ui.log(`mod-images: /${TWIN} was not registered: ${String(error)}`, { to: 'debug' })
    }
    await quietly($, async () => {
      const env = await readEnv($)
      storeEnv = env.store
      termEnv = env.term
      mode = modeOf(settings.pictures, termEnv)
      pixelsConfirmed = false
      // Only a person at a terminal sees the band: elsewhere every hook passes.
      active = e.isInteractive && (await $.session.surfaces()).includes('terminal')
      if (!active) return
      await schedule($)
      armPoll($, nextDelay)
      // A reload draws the band before this ran, with nothing: draw it again.
      await bumpPictures($)
    })

    return next(e)
  })

  on('session.end', ($, e, next) => {
    // The host drops the plugin's state with the old session; module memory goes too.
    if (e.reason === 'clear' || e.reason === 'resume') forgetSession('')
    else stopTimers()

    return next(e)
  })

  // A paste puts the chip in and then asks the typeahead about `#N]`: the
  // quickest sign of a new image. Nothing is awaited before `next`.
  on('prompt.autocomplete', ($, e, next) => {
    if (active) {
      const key = chipKeyOf(chipIdsOf(e.text))
      if (key !== lastChipKey) {
        lastChipKey = key
        soon($)
      }
      keepPolling($)
    }

    return next(e)
  })

  // The hint line under the prompt changes on every paste ('Pasting…') and
  // whenever the draft empties or fills (a send, Esc Esc, ctrl+c, a recall).
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    if (active) {
      const hint = `${e.props.isDraft ? 'draft' : 'empty'}:${e.props.hint}`
      if (hint !== lastHint) {
        lastHint = hint
        soon($)
      }
      keepPolling($)
    }

    return next(e)
  })

  // A prompt typed while a turn runs reaches the conversation by the door
  // `delivery`, the others by `prompt`.
  on('session.append', { door: ['prompt', 'delivery'] }, async ($, e, next) => {
    const stored = await next(e)
    if (active && e.agentId === undefined) await noteSent($, e.message.content)

    return stored
  })

  // Esc before any answer: Claude Code puts the prompt back in the box with
  // its pictures, so its chips seen there at once are attached again.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (active && e.agentId === undefined && e.isAborted && e.answer === '' && lastSentIds.length > 0) {
      restoreIds = lastSentIds
      restoreUntil = (await $.clock.now()) + RESTORE_MS
      soon($)
    }

    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    // Read before anything else: the reads subscribe this drawing to the
    // strip, and the band's first drawing comes before `session.start` ends.
    const shown = await read($, strip)
    const sample = await read($, demo)
    await read($, pictures)
    if (!active) return next(e)
    const now = await $.clock.now()
    const sampling = sample !== null && sample.until > now && demoMasters.length > 0
    const tiles = sampling
      ? demoTilesOf(demoMasters)
      : shown.tiles.filter(tile => !((tile.state === 'pending' || tile.state === 'reading') && now - tile.seenAt < PLACEHOLDER_DELAY_MS))
    if (tiles.length === 0) {
      previousLayout = undefined

      return next(e)
    }
    const below = await next(e)
    const layout = layoutOf({
      tiles,
      bodyColumns: e.props.bodyColumns,
      maxRows: e.props.maxRows,
      viewportRows: e.viewport?.rows,
      height: settings.height,
      mode: mode.mode,
      shared: e.props.hasSurvey || !isBareEngine(below),
      previous: previousLayout,
    })
    if (!sampling) {
      lastStrip = { at: now, tiles: shown.tiles }
      lastBand = {
        maxRows: rowsCapOf(e.props.maxRows, e.viewport?.rows),
        bodyColumns: e.props.bodyColumns,
        viewportRows: e.viewport?.rows,
        viewportColumns: e.viewport?.columns,
        isFullscreen: e.viewport?.isFullscreen,
        rows: layout.kind === 'strip' ? layout.rows : undefined,
        shape: layout.kind,
      }
    }
    if (layout.kind === 'none') return below
    if (layout.kind === 'strip') previousLayout = { rows: layout.rows, count: tiles.length }
    const byId = new Map(tiles.map(tile => [tile.id, tile]))
    const masterFor = (id: number): Master | undefined => (sampling ? demoMasters[id - 1] : masterOf(keyOf(shown.sessionId, id)))
    let probed = false
    const drawableOf = (placed: PlacedTile): TileDrawable => {
      const tile = byId.get(placed.id)
      if (tile === undefined) return { kind: 'wait' }
      if (tile.state === 'not-attached' || tile.state === 'failed') return noteOf(tile)
      const master = tile.state === 'ready' ? masterFor(tile.id) : undefined
      if (master === undefined) {
        // Dropped from memory with more pictures in play than it keeps: decoded again.
        if (tile.state === 'ready' && !sampling && decodeFacts.delete(keyOf(shown.sessionId, tile.id))) soon($)

        return { kind: 'wait' }
      }
      const drawable = pictureOf(tile, placed, master, sampling ? `demo:${tile.id}` : keyOf(shown.sessionId, tile.id), layout.kind === 'strip' ? layout.kittyBytes : 0)
      if (drawable.kind === 'image' && !probed) {
        probed = true
        armProbe($, pictureKeyOf(placed.id), drawable.source)
      }

      return drawable
    }
    const swatchOf = (id: number): string | undefined => {
      const master = masterFor(id)
      if (master === undefined) return undefined
      const cacheKey = `swatch:${sampling ? `demo:${id}` : keyOf(shown.sessionId, id)}`
      const held = drawables.get(cacheKey)
      if (held?.kind === 'cells') {
        keepDrawable(cacheKey, held)

        return held.cells
      }
      const cells = swatchCellsOf(master)
      if (cells.length !== base64Length(2 * 12)) return undefined
      keepDrawable(cacheKey, { kind: 'cells', cells })

      return cells
    }
    const ui = $.ui.resolve(e)
    const { Box } = ui

    return (
      <Box flexDirection="column">
        {below}
        {renderStrip(ui, layout, drawableOf, swatchOf)}
      </Box>
    )
  })

  // Claude Code puts the plugin's name before each reply: `mod-images: a sample strip ...`.
  on('command.run', { command: TWIN }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'test') {
      if (!active) return { text: 'it draws in a terminal session only.' }
      demoMasters = demoMastersOf()
      const now = await $.clock.now()
      await update($, demo, () => ({ until: now + DEMO_MS }))
      $.clock.after(DEMO_MS + 50, () => void bumpPictures($))

      return { text: 'a sample strip shows above the prompt for 10 seconds.' }
    }
    if (word !== '') return { text: 'usage: /mod-images, or /mod-images test for a sample strip.' }

    return { text: await reportFor($) }
  })
}
