// Where Claude Code keeps the images pasted into the prompt: a layout of its
// own, not a documented interface, read off Claude Code 2.1.295 and checked
// against the folders it made. Each session's pictures sit in
//
//   realpath(<temp base>/claude-<uid>)/<project key>/<session id>/images/<id>.<png|jpg|gif|webp>
//
// the temp base being CLAUDE_CODE_TMPDIR when set, else the runtime's temp
// folder (TMPDIR, TMP, TEMP or /tmp; on Windows TEMP or TMP), and the project
// key the launch folder (`$.session.root()`) made into one folder name. A
// hooks module knows neither the uid nor the realpath, so the hooks list
// each candidate base for `claude-*` folders and keep the one holding this
// session's folder. Pure: strings in, strings out.

/** The environment the image folder depends on, each value as `$.env.get` reads it. */
export type StoreEnv = {
  /** CLAUDE_CODE_TMPDIR: the temp base, and the only one, when set. */
  claudeTmpdir?: string
  /** TMPDIR: the runtime's temp folder outside Windows, when set. */
  tmpdir?: string
  /** TMP: the next one asked, outside Windows and on it. */
  tmp?: string
  /** TEMP: asked last outside Windows, first on it. */
  temp?: string
  /** LOCALAPPDATA: on Windows the usual temp folder is its `Temp`. */
  localAppData?: string
  /** OS: `Windows_NT` on Windows. */
  os?: string
  /** CLAUDE_CODE_SKIP_PROMPT_HISTORY: Claude Code keeps no transcript, and no image folder. */
  skipPromptHistory?: string
  /** CLAUDE_CODE_CHILD_SESSION: a nested session, which may keep neither. */
  childSession?: string
  /** CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: a nested session keeps them after all. */
  forcePersistence?: string
}

/** One of the pictures Claude Code stored, as its folder lists it. */
export type StoreFile = { id: number; name: string; ext: 'png' | 'jpg' | 'gif' | 'webp'; size: number; mtimeMs: number }

/**
 * A session's image folder as one listing saw it: the stored pictures by id,
 * and the ids still being written (`<id>.<ext>.tmp.<hex>`, renamed into place
 * a few milliseconds on).
 */
export type StoreListing = { files: ReadonlyMap<number, StoreFile>; tmpIds: ReadonlySet<number> }

// --- the folder's name -----------------------------------------------------

/** Longer than this, the project key is cut and a hash of the whole root added. */
const PROJECT_KEY_MAX = 200

// A switch as Claude Code reads one: `1`, `true`, `yes` or `on`, in any case.
const isOn = (value: string | undefined): boolean =>
  value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())

/**
 * Why Claude Code keeps no image folder in this session, or undefined when it
 * does or may: the pictures are still attached and sent, but never written
 * where the strip can read them.
 */
export const storeOffReasonOf = (env: StoreEnv): string | undefined =>
  isOn(env.skipPromptHistory) ? 'CLAUDE_CODE_SKIP_PROMPT_HISTORY is set' : undefined

/**
 * Why Claude Code may keep no image folder here, or undefined: a nested
 * session keeps none, but its marker is also inherited through tmux and set
 * for a teammate, which keep one, and the env cannot tell them apart. So the
 * folder is looked for all the same; only when none turns up does a chip read
 * `no preview` rather than `not found` or `not attached`.
 */
export const storeDoubtOf = (env: StoreEnv): string | undefined =>
  isOn(env.childSession) && !isOn(env.forcePersistence) ? 'CLAUDE_CODE_CHILD_SESSION is set: a nested session may keep none' : undefined

// The Java string hash Claude Code takes of the whole root, over UTF-16 code
// units, wrapping at 32 bits.
const hashOf = (text: string): number => {
  let hash = 0
  for (let at = 0; at < text.length; at += 1) hash = (((hash << 5) - hash) + text.charCodeAt(at)) | 0

  return hash
}

/**
 * The folder name Claude Code gives a project (its `SO`): every UTF-16 code
 * unit but a-z, A-Z and 0-9 made `-` (an accented letter one, an emoji two);
 * past 200 units, the first 200, a `-`, and the root's hash in base 36.
 * `/home/alice/proj` is `-home-alice-proj`, `C:\Users\alice\proj` is
 * `C--Users-alice-proj`.
 */
export const projectKeyOf = (root: string): string => {
  const key = root.replace(/[^a-zA-Z0-9]/g, '-')
  if (key.length <= PROJECT_KEY_MAX) return key

  return `${key.slice(0, PROJECT_KEY_MAX)}-${Math.abs(hashOf(root)).toString(36)}`
}

// --- paths -----------------------------------------------------------------

// A folder without its trailing separators, a root (`/`, `C:\`) kept whole.
const trimmedOf = (path: string): string => {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (trimmed === '') return path.slice(0, 1)
  if (/^[A-Za-z]:$/.test(trimmed)) return path.slice(0, 3)

  return trimmed
}

/**
 * The parts joined onto `base` with its own separator: `\` when the base has
 * one and no `/` (a Windows path), else `/`. No separator is doubled: the
 * base's trailing ones and each part's own at its ends are dropped, a root
 * (`/`, `C:\`) kept whole, an empty part skipped.
 */
export const joinPath = (base: string, ...parts: readonly string[]): string => {
  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/'
  const ends = separator === '\\' ? /^[\\/]+|[\\/]+$/g : /^\/+|\/+$/g
  let path = trimmedOf(base)
  for (const part of parts) {
    const piece = part.replace(ends, '')
    if (piece === '') continue
    path = path === '' || path.endsWith(separator) ? `${path}${piece}` : `${path}${separator}${piece}`
  }

  return path
}

// --- the temp bases --------------------------------------------------------

const DRIVE_ROOT = /^[A-Za-z]:([\\/]|$)/
const NETWORK_ROOT = /^\\\\/

/** Claude Code runs on Windows: OS is Windows_NT, or the root is a drive (`C:\`) or a network share (`\\server\share`). */
export const isWindowsLike = (env: StoreEnv, root: string): boolean =>
  env.os?.trim().toLowerCase() === 'windows_nt' || DRIVE_ROOT.test(root) || NETWORK_ROOT.test(root)

// A value set to something: unset and blank ones count for nothing.
const isFilled = (value: string | undefined): value is string => value !== undefined && value.trim() !== ''

/**
 * The folders Claude Code may keep its `claude-<uid>` folder in, the likeliest
 * first: CLAUDE_CODE_TMPDIR alone when set (Claude Code never looks further);
 * else TMPDIR, TMP, TEMP, then `/tmp`, or on Windows TEMP, TMP, then
 * LOCALAPPDATA's `Temp`. Unset and blank ones are skipped, trailing
 * separators trimmed, a folder named twice listed once.
 */
export const tempBasesOf = (env: StoreEnv, root: string): readonly string[] => {
  // Claude Code trims CLAUDE_CODE_TMPDIR and reads a blank one as unset.
  if (isFilled(env.claudeTmpdir)) return [trimmedOf(env.claudeTmpdir.trim())]
  const windows = isWindowsLike(env, root)
  const candidates = windows
    ? [env.temp, env.tmp, isFilled(env.localAppData) ? joinPath(env.localAppData, 'Temp') : undefined]
    : [env.tmpdir, env.tmp, env.temp, '/tmp']
  const bases: string[] = []
  const known = new Set<string>()
  for (const candidate of candidates) {
    if (!isFilled(candidate)) continue
    const base = trimmedOf(candidate)
    // Windows names a folder in any case, with either separator.
    const key = windows ? base.toLowerCase().replace(/\//g, '\\') : base
    if (known.has(key)) continue
    known.add(key)
    bases.push(base)
  }

  return bases
}

/** A folder name Claude Code's own temp folder may have in a temp base: `claude-0`, `claude-1000`, whatever the uid reads as. */
export const isUserDirName = (name: string): boolean => /^claude-./.test(name)

/** A project's folder under Claude Code's own temp folder (`/tmp/claude-1000`). */
export const projectDirOf = (userDir: string, root: string): string => joinPath(userDir, projectKeyOf(root))

/** A session's image folder under Claude Code's own temp folder (`/tmp/claude-1000`). */
export const imagesDirOf = (userDir: string, root: string, sessionId: string): string =>
  joinPath(userDir, projectKeyOf(root), sessionId, 'images')

// --- the folder's contents -------------------------------------------------

const STORED = /^(\d+)\.(png|jpg|gif|webp)$/
const WRITING = /^(\d+)\.[a-z]+\.tmp\./

const isStoredExt = (ext: string | undefined): ext is StoreFile['ext'] =>
  ext === 'png' || ext === 'jpg' || ext === 'gif' || ext === 'webp'

// An image's id from its file name: from 1 up, as its chip numbers it.
const idOf = (digits: string | undefined): number | undefined => {
  const id = Number(digits)

  return Number.isSafeInteger(id) && id >= 1 ? id : undefined
}

/**
 * What a listing of an image folder holds: each stored picture by id (a
 * regular file named `<id>.<png|jpg|gif|webp>`; of two for one id the newer,
 * a tie going to the name that sorts first), and the ids of `.tmp.` files
 * still being written. Anything else is not Claude Code's and is left out.
 */
export const listingOf = (entries: readonly { name: string; kind: string; size: number; mtimeMs: number }[]): StoreListing => {
  const files = new Map<number, StoreFile>()
  const tmpIds = new Set<number>()
  for (const entry of entries) {
    const writing = WRITING.exec(entry.name)
    if (writing !== null) {
      const id = idOf(writing[1])
      if (id !== undefined) tmpIds.add(id)
      continue
    }
    const stored = STORED.exec(entry.name)
    if (stored === null || entry.kind !== 'file') continue
    const id = idOf(stored[1])
    const ext = stored[2]
    if (id === undefined || !isStoredExt(ext)) continue
    const file: StoreFile = { id, name: entry.name, ext, size: entry.size, mtimeMs: entry.mtimeMs }
    const held = files.get(id)
    const isNewer = held === undefined || file.mtimeMs > held.mtimeMs || (file.mtimeMs === held.mtimeMs && file.name < held.name)
    if (isNewer) files.set(id, file)
  }

  return { files, tmpIds }
}
